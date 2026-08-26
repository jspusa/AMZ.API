import { createHash, randomUUID } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { MarketplaceId } from "../shared/marketplaces";
import { throwIfAborted as assertBackgroundActive } from "./abort-utils";
import {
  type FbaInboundNoncomplianceReadResult,
  type FbaInboundReads,
} from "./amazon/fba-inbound-reads";
import type { FbaInboundShipmentSnapshot } from
  "./amazon/fba-inbound-shipments";
import {
  buildInboundIssueReportSnapshot,
  type InboundIssueReportSnapshot,
} from "./amazon/inbound-noncompliance";
import { marketplaceCalendar } from "./amazon/marketplace-calendar";
import { SpApiError } from "./amazon/sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import {
  bodyRecord,
  optionalDate,
  parseMarketplace,
  reportIdentifier,
} from "./route-input";
import { invalid, json } from "./route-response";

const ACTIVE_TTL_MS = 60 * 60 * 1_000;
const TERMINAL_TTL_MS = 30 * 60 * 1_000;
const UNAVAILABLE_RETRY_TTL_MS = 35 * 60 * 1_000;

export type FbaInboundReadsPort = Pick<
  FbaInboundReads,
  "readShipments" | "readNoncompliance"
>;

type InboundShipmentProgress = Readonly<{
  phase: "shipments" | "items" | "issues";
  completed: number;
  total: number | null;
}>;

type InboundShipmentJobState = "running" | "completed" | "partial" | "failed";

type InboundShipmentFailure = Readonly<{
  code: string;
  requestId: string | null;
}>;

type InboundShipmentResultSnapshot = FbaInboundShipmentSnapshot & Readonly<{
  schemaVersion: 1;
  issueReport: InboundIssueReportSnapshot;
}>;

type InboundShipmentJob = {
  jobId: string;
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  accountScope: string;
  mode: "live" | "demo";
  startDate: string;
  endDate: string;
  retryIssueReport: boolean;
  shipmentSeed: FbaInboundShipmentSnapshot | null;
  state: InboundShipmentJobState;
  progress: InboundShipmentProgress;
  snapshot: InboundShipmentResultSnapshot | null;
  notice: string;
  failure: InboundShipmentFailure | null;
  expiresAt: number;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
  flight: Promise<void> | null;
};

export interface FbaInboundCoordinatorPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  status(request: ApiRequest): Promise<ApiResponse>;
  clear(): void;
}

function selectionFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Main-only owner of the complete FBA Inbound background workflow. Job
 * identity, exact selection, abort/expiry lifecycle, verified shipment rows,
 * issue-report merge, progress, and terminal snapshots remain one state unit.
 */
export class FbaInboundCoordinator implements FbaInboundCoordinatorPort {
  private readonly reads: FbaInboundReadsPort;
  private readonly context: SpExecutionContextAdapter;
  private readonly jobs = new Map<string, InboundShipmentJob>();
  private readonly selections = new Map<string, string>();
  private lifecycleRevision = 0;

  constructor(input: Readonly<{
    reads: FbaInboundReadsPort;
    context: SpExecutionContextAdapter;
  }>) {
    this.reads = input.reads;
    this.context = input.context;
  }

  clear(): void {
    this.lifecycleRevision += 1;
    for (const job of [...this.jobs.values()]) {
      job.controller.abort(
        new Error("FBA 入庫貨件工作已因安全 context 變更而停止。"),
      );
      this.removeJob(job.jobId);
    }
    this.selections.clear();
  }

  private assertLifecycleCurrent(expectedRevision: number): void {
    if (this.lifecycleRevision === expectedRevision) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  private removeJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    job.expiryTimer = null;
    job.shipmentSeed = null;
    this.jobs.delete(jobId);
    for (const [selection, selectedJobId] of this.selections) {
      if (selectedJobId === jobId) this.selections.delete(selection);
    }
  }

  private touchJob(job: InboundShipmentJob): void {
    if (
      job.state !== "running" ||
      job.controller.signal.aborted ||
      this.jobs.get(job.jobId) !== job
    ) {
      return;
    }
    job.expiresAt = Date.now() + ACTIVE_TTL_MS;
  }

  private retainTerminalJob(job: InboundShipmentJob, ttl: number): void {
    if (this.jobs.get(job.jobId) !== job || job.state === "running") return;
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    const expiresAt = Date.now() + ttl;
    job.expiresAt = expiresAt;
    job.expiryTimer = setTimeout(() => {
      if (
        this.jobs.get(job.jobId) === job &&
        job.state !== "running" &&
        job.expiresAt === expiresAt &&
        job.expiresAt <= Date.now()
      ) {
        this.removeJob(job.jobId);
      }
    }, ttl);
    job.expiryTimer.unref?.();
  }

  private pruneJobs(now = Date.now()): void {
    for (const job of this.jobs.values()) {
      if (job.expiresAt > now) continue;
      if (job.state === "running") {
        job.controller.abort(
          new Error("FBA 入庫貨件背景工作超過安全保留時間。"),
        );
        job.state = "failed";
        job.snapshot = null;
        job.notice = "FBA 入庫貨件背景工作等待逾時；Amazon 沒有收到任何寫入。";
        job.failure = {
          code: "INBOUND_SHIPMENT_JOB_TIMEOUT",
          requestId: null,
        };
        this.retainTerminalJob(job, TERMINAL_TTL_MS);
      } else {
        this.removeJob(job.jobId);
      }
    }
  }

  private reply(job: InboundShipmentJob): ApiResponse {
    return json({
      jobId: job.jobId,
      marketplaceId: job.marketplaceId,
      dateRange: { startDate: job.startDate, endDate: job.endDate },
      state: job.state,
      progress: { ...job.progress },
      snapshot: job.snapshot ? structuredClone(job.snapshot) : null,
      notice: job.notice,
      failure: job.failure ? { ...job.failure } : null,
    }, job.state === "running" ? 202 : 200);
  }

  private async assertJobContext(
    job: InboundShipmentJob,
    signal?: AbortSignal,
  ): Promise<void> {
    assertBackgroundActive(signal);
    await this.context.assertCurrent(job.context);
    assertBackgroundActive(signal);
    if (
      job.context.marketplaceId !== job.marketplaceId ||
      job.context.mode !== job.mode ||
      job.context.accountScope !== job.accountScope
    ) {
      throw new SpApiError(
        "FBA 入庫貨件工作與目前帳號、站點或模式不一致。",
        { status: 409, code: "INBOUND_SHIPMENT_JOB_MISMATCH" },
      );
    }
  }

  private unavailableIssueReport(error: unknown): InboundIssueReportSnapshot {
    let publicReason = "Amazon 每日 FBA 入庫瑕疵報表目前無法讀取。";
    if (error instanceof SpApiError) {
      if (error.code === "REPORT_RETRY_WAIT") {
        publicReason = "Amazon 報表建立仍在安全間隔內；請稍後明確重試，系統不會重複建立。";
      } else if (
        [
          "SHARED_REPORT_RETRY_REQUIRED",
          "REPORT_CANCELLED",
          "REPORT_FATAL",
        ].includes(error.code)
      ) {
        publicReason = "上次每日 FBA 入庫瑕疵報表未完成；系統不會自動重建，需明確重試。";
      } else if (error.code === "RATE_LIMITED" || error.status === 429) {
        publicReason = "Amazon 暫時限制每日 FBA 入庫瑕疵報表請求頻率，請稍後再試。";
      } else if (error.status === 401 || error.status === 403) {
        publicReason = "Amazon 拒絕每日 FBA 入庫瑕疵報表查詢，請檢查 Amazon Fulfillment 角色與授權。";
      } else if (error.code === "INBOUND_NONCOMPLIANCE_PENDING") {
        publicReason = "Amazon 每日 FBA 入庫瑕疵報表仍在準備中。";
      }
    }
    return {
      state: "unavailable",
      fetchedAt: null,
      dataThrough: null,
      excludedShipmentCount: null,
      notice: `${publicReason} 商品接收數量仍可查看；瑕疵來源是每日報表，不能拿缺值冒充 Seller Central 即時「沒有瑕疵」。`,
      shipment: [],
      carton: [],
      product: [],
    };
  }

  private async loadIssueReport(
    job: InboundShipmentJob,
    signal: AbortSignal,
  ): Promise<FbaInboundNoncomplianceReadResult> {
    await this.assertJobContext(job, signal);
    return this.reads.readNoncompliance({
      marketplaceId: job.marketplaceId,
      explicitRetry: job.retryIssueReport,
      expectedContext: job.context,
      signal,
      onProgress: () => this.touchJob(job),
    });
  }

  private jobFailure(error: unknown): Readonly<{
    notice: string;
    diagnostic: InboundShipmentFailure;
  }> {
    const diagnostic: InboundShipmentFailure = {
      code:
        error instanceof SpApiError && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code)
          ? error.code
          : "INBOUND_SHIPMENT_FAILED",
      requestId:
        error instanceof SpApiError
          ? reportIdentifier(error.requestId)
          : null,
    };
    if (error instanceof Error && error.name === "AbortError") {
      return {
        notice: "FBA 入庫貨件背景工作已安全停止。",
        diagnostic: { code: "INBOUND_SHIPMENT_ABORTED", requestId: null },
      };
    }
    if (error instanceof SpApiError) {
      if (error.status === 401 || error.status === 403) {
        return {
          notice: "Amazon 拒絕 FBA 入庫貨件查詢，請檢查 Amazon Fulfillment 角色與授權；Amazon 沒有收到任何寫入。",
          diagnostic,
        };
      }
      if (error.status === 429 || error.code === "RATE_LIMITED") {
        return {
          notice: "Amazon 暫時限制 FBA 入庫貨件查詢頻率；已停止後續讀取，請稍後只按一次重新同步。Amazon 沒有收到任何寫入。",
          diagnostic,
        };
      }
      if (error.code === "FBA_INBOUND_ITEM_CIRCUIT_OPEN") {
        return {
          notice: "Amazon FBA 入庫商品明細連續異常；已停止後續讀取，避免大量無效請求。Amazon 沒有收到任何寫入。",
          diagnostic,
        };
      }
      if (error.code === "FBA_INBOUND_FORMAT_UNSUPPORTED") {
        return {
          notice: "Amazon 回傳的 FBA 入庫資料格式目前無法安全辨識；已停止並保留未知值，不會補 0。Amazon 沒有收到任何寫入。",
          diagnostic,
        };
      }
      if (error.code === "PAGINATION_CHANGED") {
        return {
          notice: "Amazon FBA 入庫分頁資料前後不一致；已停止，避免重複或漏算貨件。Amazon 沒有收到任何寫入。",
          diagnostic,
        };
      }
      if (error.code === "PAGINATION_LIMIT_EXCEEDED") {
        return {
          notice: "Amazon FBA 入庫資料超過本次安全讀取上限；請縮短日期範圍後再同步。Amazon 沒有收到任何寫入。",
          diagnostic,
        };
      }
      if (error.code === "FBA_INBOUND_UPSTREAM_UNAVAILABLE") {
        return {
          notice:
            error.status === 400 || error.status === 422
              ? "Amazon 無法驗證這次 FBA 入庫貨件唯讀請求；請確認日期範圍後再按一次重新同步。Amazon 沒有收到任何寫入。"
              : "Amazon FBA 入庫服務暫時無法回應；已在有限次唯讀重試後停止。請稍後只按一次重新同步；Amazon 沒有收到任何寫入。",
          diagnostic,
        };
      }
    }
    return {
      notice: "FBA 入庫貨件同步未完成，Notebook Key 無法安全判定原因；請不要連續重試。Amazon 沒有收到任何寫入。",
      diagnostic,
    };
  }

  private async runJob(job: InboundShipmentJob): Promise<void> {
    const signal = job.controller.signal;
    let issueContextError: SpExecutionContextError | null = null;
    const issueOutcome = this.loadIssueReport(job, signal).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => {
        if (error instanceof SpExecutionContextError) {
          issueContextError = error;
          if (!signal.aborted) job.controller.abort(error);
        }
        return { value: null, error };
      },
    );
    try {
      await this.assertJobContext(job, signal);
      let shipmentSnapshot: FbaInboundShipmentSnapshot;
      let shipmentState: "complete" | "partial";
      if (job.shipmentSeed) {
        shipmentSnapshot = job.shipmentSeed;
        shipmentState =
          shipmentSnapshot.shipmentListScope === "selected-date-range" &&
            shipmentSnapshot.coverage.state === "complete"
            ? "complete"
            : "partial";
        job.shipmentSeed = null;
      } else {
        const shipmentResult = await this.reads.readShipments({
          marketplaceId: job.marketplaceId,
          startDate: job.startDate,
          endDate: job.endDate,
          expectedContext: job.context,
          signal,
          onProgress: (progress) => {
            if (
              job.state !== "running" ||
              !["shipments", "items"].includes(progress.phase) ||
              !Number.isSafeInteger(progress.completed) ||
              progress.completed < 0 ||
              (progress.total !== null &&
                (!Number.isSafeInteger(progress.total) ||
                  progress.total < progress.completed))
            ) {
              return;
            }
            job.progress = {
              phase: progress.phase,
              completed: progress.completed,
              total: progress.total,
            };
            this.touchJob(job);
          },
        });
        shipmentSnapshot = shipmentResult.snapshot;
        shipmentState = shipmentResult.state;
      }
      await this.assertJobContext(job, signal);
      job.progress = { phase: "issues", completed: 0, total: 1 };
      this.touchJob(job);
      const issue = await issueOutcome;
      if (issue.error instanceof SpExecutionContextError) throw issue.error;
      assertBackgroundActive(signal);
      await this.assertJobContext(job, signal);
      const issueReport = issue.value
        ? buildInboundIssueReportSnapshot({
            ...issue.value,
            allowedShipmentIds: new Set(
              shipmentSnapshot.shipments.map(({ shipmentId }) => shipmentId),
            ),
          })
        : this.unavailableIssueReport(issue.error);
      job.progress = { phase: "issues", completed: 1, total: 1 };
      job.snapshot = {
        ...shipmentSnapshot,
        schemaVersion: 1,
        issueReport,
      };
      const partial =
        shipmentState === "partial" || issueReport.state !== "completed";
      job.state = partial ? "partial" : "completed";
      job.notice = `${shipmentSnapshot.notice} ${issueReport.notice}`;
      job.failure = null;
      this.retainTerminalJob(
        job,
        issueReport.state === "unavailable"
          ? UNAVAILABLE_RETRY_TTL_MS
          : TERMINAL_TTL_MS,
      );
    } catch (error) {
      job.shipmentSeed = null;
      if (this.jobs.get(job.jobId) !== job || job.state !== "running") return;
      const terminalError = issueContextError ?? error;
      job.controller.abort(terminalError);
      job.state = "failed";
      job.snapshot = null;
      const failure = this.jobFailure(terminalError);
      job.notice = failure.notice;
      job.failure = failure.diagnostic;
      this.retainTerminalJob(job, TERMINAL_TTL_MS);
    }
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body) return invalid("FBA 入庫貨件查詢格式無效。");
    const allowedKeys = new Set([
      "marketplaceId",
      "startDate",
      "endDate",
      "retryIssueReport",
    ]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return invalid("FBA 入庫貨件查詢包含不支援的欄位。");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const startDate = optionalDate(body.startDate);
    const endDate = optionalDate(body.endDate);
    if (
      body.retryIssueReport !== undefined &&
      typeof body.retryIssueReport !== "boolean"
    ) {
      return invalid("FBA 入庫瑕疵報表重試意圖格式無效。");
    }
    const retryIssueReport = body.retryIssueReport === true;
    if (!marketplaceId || typeof startDate !== "string" || typeof endDate !== "string") {
      return invalid("請提供有效站點、開始日期與結束日期。");
    }
    const calendar = marketplaceCalendar(marketplaceId);
    const inclusiveDays = calendar.inclusiveDayCount(startDate, endDate);
    if (inclusiveDays < 1 || inclusiveDays > 180) {
      return invalid("FBA 入庫貨件日期範圍必須介於 1 到 180 天。");
    }
    const marketplaceToday = calendar.dayAt(new Date(Date.now()));
    if (endDate > marketplaceToday) {
      return invalid("FBA 入庫貨件結束日期不可晚於目前 Amazon 站點日期。");
    }
    this.pruneJobs();
    const lifecycleRevision = this.lifecycleRevision;
    const context = await this.context.capture(marketplaceId);
    this.assertLifecycleCurrent(lifecycleRevision);
    const { accountScope, mode } = context;
    const selection = selectionFingerprint({
      accountScope,
      generation: context.generation,
      marketplaceId,
      mode,
      startDate,
      endDate,
    });
    const existingId = this.selections.get(selection);
    const existing = existingId ? this.jobs.get(existingId) : null;
    if (
      retryIssueReport &&
      (
        !existing ||
        existing.state !== "partial" ||
        existing.snapshot?.issueReport.state !== "unavailable" ||
        existing.expiresAt <= Date.now()
      )
    ) {
      return invalid(
        "目前沒有同帳號、站點與日期區間的瑕疵報表未完成快照，不能建立重試工作。",
        409,
        "ISSUE_REPORT_RETRY_NOT_ALLOWED",
      );
    }
    let shipmentSeed: FbaInboundShipmentSnapshot | null = null;
    if (retryIssueReport && existing?.snapshot) {
      const { issueReport: _issueReport, ...verifiedShipmentSnapshot } =
        existing.snapshot;
      shipmentSeed = verifiedShipmentSnapshot;
    }
    if (existing && existing.state === "running" && existing.expiresAt > Date.now()) {
      return this.reply(existing);
    }
    if (existing) this.removeJob(existing.jobId);
    for (const candidate of [...this.jobs.values()]) {
      if (
        candidate.accountScope !== accountScope ||
        candidate.marketplaceId !== marketplaceId ||
        candidate.mode !== mode
      ) {
        continue;
      }
      if (candidate.state === "running") {
        candidate.controller.abort(
          new Error("相同帳號與站點已改用新的 FBA 入庫貨件日期區間。"),
        );
      }
      this.removeJob(candidate.jobId);
    }
    const controller = new AbortController();
    const job: InboundShipmentJob = {
      jobId: randomUUID(),
      context,
      marketplaceId,
      accountScope,
      mode,
      startDate,
      endDate,
      retryIssueReport,
      shipmentSeed,
      state: "running",
      progress: retryIssueReport
        ? { phase: "issues", completed: 0, total: 1 }
        : { phase: "shipments", completed: 0, total: null },
      snapshot: null,
      notice: retryIssueReport
        ? "只重新讀取每日 FBA 入庫瑕疵報表；既有貨件與商品接收數量快照不會重抓。"
        : "正在讀取 FBA 入庫貨件與商品接收數量；你可以關閉這個面板或先使用其他功能，Notebook 鑰匙仍會在背景繼續。",
      failure: null,
      expiresAt: Date.now() + ACTIVE_TTL_MS,
      expiryTimer: null,
      controller,
      flight: null,
    };
    this.jobs.set(job.jobId, job);
    this.selections.set(selection, job.jobId);
    job.flight = this.runJob(job).finally(() => {
      job.flight = null;
    });
    void job.flight;
    return this.reply(job);
  }

  async status(request: ApiRequest): Promise<ApiResponse> {
    const allowedKeys = new Set([
      "marketplaceId",
      "jobId",
      "startDate",
      "endDate",
    ]);
    if (Object.keys(request.query).some((key) => !allowedKeys.has(key))) {
      return invalid("FBA 入庫貨件工作查詢包含不支援的欄位。");
    }
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = reportIdentifier(request.query.jobId);
    const startDate = optionalDate(request.query.startDate);
    const endDate = optionalDate(request.query.endDate);
    if (
      !marketplaceId ||
      !jobId ||
      typeof startDate !== "string" ||
      typeof endDate !== "string"
    ) {
      return invalid("FBA 入庫貨件工作資訊無效，請重新同步。");
    }
    this.pruneJobs();
    const job = this.jobs.get(jobId);
    if (!job || job.marketplaceId !== marketplaceId) {
      return invalid(
        "找不到這份 FBA 入庫貨件工作，請重新同步。",
        404,
        "JOB_NOT_FOUND",
      );
    }
    if (job.startDate !== startDate || job.endDate !== endDate) {
      return invalid(
        "FBA 入庫貨件工作與所選日期區間不一致，請重新同步。",
        409,
        "JOB_MISMATCH",
      );
    }
    const lifecycleRevision = this.lifecycleRevision;
    try {
      await this.assertJobContext(job);
      this.assertLifecycleCurrent(lifecycleRevision);
      if (this.jobs.get(job.jobId) !== job) {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "Amazon 執行環境已更新；請重新開始這次操作。",
        );
      }
    } catch {
      job.controller.abort(new Error("FBA 入庫貨件工作 context 已變更。"));
      this.removeJob(job.jobId);
      return invalid(
        "FBA 入庫貨件工作不屬於目前帳號、站點或模式，請重新同步。",
        409,
        "JOB_MISMATCH",
      );
    }
    return this.reply(job);
  }
}
