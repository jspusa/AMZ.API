import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { MarketplaceId } from "../shared/marketplaces";
import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
} from "./abort-utils";
import {
  AplusAuditJobCoordinator,
  AplusAuditJobCoordinatorError,
  type AplusAuditFbaSeedSnapshot,
  type AplusAuditJobBoundContext,
  type AplusAuditJobMode,
} from "./amazon/a-plus-audit-job";
import type { AuditSuiteContext } from "./amazon/audit-suite-context";
import type {
  AuditSuiteRunControl,
  AuditSuiteSectionRunners,
} from "./amazon/audit-suite-coordinator";
import type { AuditSuiteGroupingResource } from
  "./amazon/audit-suite-resources";
import {
  buildAplusAuditSeedsFromFbaGrouping,
  type AplusAuditProgress,
  type AplusAuditSnapshot,
  type AplusContentPageOperation,
  type AplusContentReadsPort,
} from "./amazon/a-plus-content-reads";
import type { APlusAuditProblemRow } from "./amazon/audit-suite-xlsx";
import type { CatalogExportRow } from "./amazon/catalog-report-reads";
import type { ListingsExportPort } from "./amazon/listings-export";
import { publicSpApiError, SpApiError } from "./amazon/sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import type { FbaVariationGroupingData } from
  "./amazon/variation-catalog-reads";
import {
  bodyRecord,
  parseMarketplace,
  reportIdentifier,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";

const DEFAULT_POLL_LIMIT = 180;
const REPORT_POLL_INTERVAL_MS = 1_000;

type AplusListingsExportPort = Pick<
  ListingsExportPort,
  "startReusable" | "status" | "data"
>;

export type AplusAuditGroupingReader = (input: Readonly<{
  marketplaceId: MarketplaceId;
  rows: readonly CatalogExportRow[];
  signal: AbortSignal;
  onProgress?: (progress: Readonly<{
    completedBatches: number;
    totalBatches: number;
  }>) => void | Promise<void>;
}>) => Promise<FbaVariationGroupingData<CatalogExportRow>>;

export interface AplusAuditCoordinatorPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  observe(request: ApiRequest): Promise<ApiResponse>;
  runAuditSuite(input: Readonly<{
    context: AuditSuiteContext;
    control: AuditSuiteRunControl;
    grouping: AuditSuiteGroupingResource;
  }>): ReturnType<AuditSuiteSectionRunners["aplus"]>;
  clear(): void;
}

export type AplusAuditCoordinatorDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  listingsExport: AplusListingsExportPort;
  readGrouping: AplusAuditGroupingReader;
  contentReads: AplusContentReadsPort;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  pollLimit?: number;
  jobTtlMs?: number;
}>;

function contextKey(context: AplusAuditJobBoundContext): string {
  return JSON.stringify([
    context.accountScope,
    context.generation,
    context.marketplaceId,
    context.mode,
  ]);
}

function contextInvalidated(): SpExecutionContextError {
  return new SpExecutionContextError(
    "SP_CONTEXT_INVALIDATED",
    "Amazon 執行環境已更新；請重新開始這次操作。",
  );
}

function coordinatorError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof AplusAuditJobCoordinatorError) {
    const publicError = publicSpApiError(new SpApiError(error.message, {
      status: error.status,
      code: error.code,
    }), fallback);
    return json(
      { code: publicError.code, message: publicError.message },
      publicError.status,
      publicError.retryAfter ? { "retry-after": publicError.retryAfter } : {},
    );
  }
  return routeError(error, fallback);
}

export function buildAplusAuditSuiteResult(
  snapshot: AplusAuditSnapshot,
): Readonly<{
  status: "completed" | "partial";
  fetchedAt: string;
  notice: string;
  payload: readonly APlusAuditProblemRow[];
}> {
  const payload = snapshot.rows
    .filter((row) => row.status !== "published")
    .map((row): APlusAuditProblemRow => ({
      sellerSku: row.sellerSku,
      title: row.title,
      asin: row.asin ?? "",
      finding: row.status === "missing"
        ? "未找到已發布 A+"
        : row.status === "unavailable"
          ? "A+ API 權限不可用"
          : row.reasonCode === "A_PLUS_WARNING_PRESENT"
            ? "Amazon 回應警告，請到 A+ 管理員確認"
            : "資料未完成",
      notice: row.reason,
    }));
  const partial = snapshot.summary.incomplete > 0 ||
    snapshot.summary.unavailable > 0 ||
    snapshot.rows.some((row) =>
      row.status !== "published" && row.sourceCompleteness === "partial"
    );
  return {
    status: partial ? "partial" : "completed",
    fetchedAt: snapshot.fetchedAt,
    notice: snapshot.notice,
    payload,
  };
}

/**
 * Renderer-facing owner of the complete long-running A+ audit workflow.
 * Route DTOs, exact execution context, one FBA catalog report lifecycle,
 * relationship-proven seeds, A+ pagination, heartbeat and job retention stay
 * behind the four-method interface.
 */
export class AplusAuditCoordinator implements AplusAuditCoordinatorPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly listingsExport: AplusListingsExportPort;
  private readonly readGrouping: AplusAuditGroupingReader;
  private readonly contentReads: AplusContentReadsPort;
  private readonly wait: NonNullable<AplusAuditCoordinatorDependencies["wait"]>;
  private readonly pollLimit: number;
  private readonly jobs: AplusAuditJobCoordinator;
  private readonly contexts = new Map<string, SpExecutionContext>();
  private readonly auditSuiteControls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: AplusAuditCoordinatorDependencies) {
    this.context = input.context;
    this.listingsExport = input.listingsExport;
    this.readGrouping = input.readGrouping;
    this.contentReads = input.contentReads;
    this.wait = input.wait ?? abortableDelay;
    this.pollLimit = input.pollLimit ?? DEFAULT_POLL_LIMIT;
    if (!Number.isSafeInteger(this.pollLimit) || this.pollLimit < 1) {
      throw new Error("A+ report poll limit must be a positive integer.");
    }
    this.jobs = new AplusAuditJobCoordinator({
      gateway: {
        bindContext: (identity) => this.bindContext(identity),
        loadFbaSeeds: (job) => this.loadFbaSeeds(
          job.context,
          job.signal,
          job.heartbeat,
        ),
        read: (job) => this.readAudit(
          job.context,
          job.seed,
          job.signal,
          job.heartbeat,
          job.onProgress,
        ),
      },
      ...(input.jobTtlMs === undefined ? {} : { ttlMs: input.jobTtlMs }),
    });
  }

  clear(): void {
    this.lifecycleRevision += 1;
    const reason = contextInvalidated();
    for (const control of this.auditSuiteControls) control.abort(reason);
    this.auditSuiteControls.clear();
    this.jobs.clear();
    this.contexts.clear();
  }

  private assertLifecycleCurrent(revision: number): void {
    if (revision !== this.lifecycleRevision) throw contextInvalidated();
  }

  private boundContext(context: SpExecutionContext): AplusAuditJobBoundContext {
    return {
      accountScope: String(context.accountScope),
      generation: context.generation,
      marketplaceId: context.marketplaceId,
      mode: context.mode,
    };
  }

  private async bindContext(input: Readonly<{
    marketplaceId: string;
    mode: AplusAuditJobMode;
  }>): Promise<AplusAuditJobBoundContext> {
    const marketplaceId = parseMarketplace(input.marketplaceId);
    if (!marketplaceId) {
      throw new AplusAuditJobCoordinatorError("A+ 健檢站點無效。", {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    const revision = this.lifecycleRevision;
    const captured = await this.context.capture(marketplaceId);
    this.assertLifecycleCurrent(revision);
    await this.context.assertCurrent(captured);
    this.assertLifecycleCurrent(revision);
    const bound = this.boundContext(captured);
    const key = contextKey(bound);
    const existing = this.contexts.get(key);
    if (existing) {
      await this.context.assertCurrent(existing);
      this.assertLifecycleCurrent(revision);
      return bound;
    }
    this.contexts.set(key, captured);
    return bound;
  }

  private async exactContext(
    bound: AplusAuditJobBoundContext,
    signal: AbortSignal,
  ): Promise<Readonly<{ context: SpExecutionContext; revision: number }>> {
    const revision = this.lifecycleRevision;
    throwIfAborted(signal);
    const captured = this.contexts.get(contextKey(bound));
    if (!captured) throw contextInvalidated();
    await this.context.assertCurrent(captured);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(signal);
    if (
      captured.marketplaceId !== bound.marketplaceId ||
      captured.generation !== bound.generation ||
      String(captured.accountScope) !== bound.accountScope ||
      captured.mode !== bound.mode
    ) {
      throw contextInvalidated();
    }
    return { context: captured, revision };
  }

  private async fence(
    context: SpExecutionContext,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    await this.context.assertCurrent(context);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(signal);
    if (this.contexts.get(contextKey(this.boundContext(context))) !== context) {
      throw contextInvalidated();
    }
  }

  private assertAuditSuiteContext(
    bound: AuditSuiteContext,
    exact: SpExecutionContext,
  ): void {
    if (
      bound.marketplaceId !== exact.marketplaceId ||
      bound.generation !== exact.generation
    ) {
      throw contextInvalidated();
    }
    if (bound.accountScope !== String(exact.accountScope)) {
      throw new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "Amazon 帳號範圍已改變；本次綜合健檢已停止。",
      );
    }
    if (bound.mode !== exact.mode) {
      throw new SpExecutionContextError(
        "REPORT_MODE_CHANGED",
        "App 展示／真實模式已改變；本次綜合健檢已停止。",
      );
    }
  }

  private async captureAuditSuiteContext(
    bound: AuditSuiteContext,
    signal: AbortSignal,
    revision: number,
  ): Promise<SpExecutionContext> {
    throwIfAborted(signal);
    const marketplaceId = parseMarketplace(bound.marketplaceId);
    if (!marketplaceId) throw contextInvalidated();
    const exact = await this.context.capture(marketplaceId);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(signal);
    this.assertAuditSuiteContext(bound, exact);
    await this.context.assertCurrent(exact);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(signal);
    this.assertAuditSuiteContext(bound, exact);
    return exact;
  }

  private async fenceAuditSuiteContext(
    bound: AuditSuiteContext,
    exact: SpExecutionContext,
    signal: AbortSignal,
    revision: number,
  ): Promise<void> {
    this.assertAuditSuiteContext(bound, exact);
    await this.context.assertCurrent(exact);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(signal);
    this.assertAuditSuiteContext(bound, exact);
  }

  private async loadFbaSeeds(
    bound: AplusAuditJobBoundContext,
    signal: AbortSignal,
    heartbeat: () => void,
  ): Promise<AplusAuditFbaSeedSnapshot> {
    const exact = await this.exactContext(bound, signal);
    const marketplaceId = exact.context.marketplaceId;
    heartbeat();
    let status = await this.listingsExport.startReusable({
      marketplaceId,
      signal,
      expectedContext: exact.context,
    });
    await this.fence(exact.context, exact.revision, signal);
    heartbeat();
    const reportId = status.reportId;
    if (!reportId) {
      throw new Error("A+ 健檢的 FBA 全商品報表沒有固定 report identity。");
    }
    for (let attempt = 0; !status.ready && attempt < this.pollLimit; attempt += 1) {
      if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
        throw new Error("Amazon 未能產生本次 A+ 健檢所需的 FBA 全商品報表。");
      }
      await this.wait(REPORT_POLL_INTERVAL_MS, signal);
      await this.fence(exact.context, exact.revision, signal);
      heartbeat();
      status = await this.listingsExport.status({
        marketplaceId,
        reportId,
        signal,
        expectedContext: exact.context,
      });
      await this.fence(exact.context, exact.revision, signal);
      heartbeat();
    }
    if (
      !status.ready ||
      status.status !== "DONE" ||
      status.reportId !== reportId ||
      !status.documentId ||
      status.mode !== exact.context.mode
    ) {
      throw new Error("A+ 健檢的 FBA 全商品報表未完成或 context 已改變。");
    }
    const data = await this.listingsExport.data({
      marketplaceId,
      reportId,
      documentId: status.documentId,
      signal,
      expectedContext: exact.context,
      onProgress: () => heartbeat(),
    });
    await this.fence(exact.context, exact.revision, signal);
    heartbeat();
    const grouping = await this.readGrouping({
      marketplaceId,
      rows: data.rows,
      signal,
      onProgress: () => heartbeat(),
    });
    await this.fence(exact.context, exact.revision, signal);
    heartbeat();
    if (
      grouping.marketplaceId !== marketplaceId ||
      !Array.isArray(grouping.rows)
    ) {
      throw new Error("A+ 健檢 relationships 分組與 FBA 快照不一致。");
    }
    return {
      fetchedAt: data.fetchedAt,
      fbaSnapshotId: createHash("sha256").update(JSON.stringify([
        String(exact.context.accountScope),
        marketplaceId,
        reportId,
        status.documentId,
        data.fetchedAt,
      ])).digest("hex"),
      rows: buildAplusAuditSeedsFromFbaGrouping(grouping.rows),
    };
  }

  private async readAudit(
    bound: AplusAuditJobBoundContext,
    seed: AplusAuditFbaSeedSnapshot,
    signal: AbortSignal,
    heartbeat: () => void,
    onProgress: (progress: AplusAuditProgress) => void,
  ): Promise<AplusAuditSnapshot> {
    const exact = await this.exactContext(bound, signal);
    heartbeat();
    const snapshot = await this.contentReads.read({
      marketplaceId: exact.context.marketplaceId,
      expectedContext: exact.context,
      fetchedAt: seed.fetchedAt,
      fbaSnapshotId: seed.fbaSnapshotId,
      rows: seed.rows,
      signal,
      onControlledWait: () => {
        this.assertLifecycleCurrent(exact.revision);
        throwIfAborted(signal);
        heartbeat();
      },
      onProgress: (progress) => {
        this.assertLifecycleCurrent(exact.revision);
        throwIfAborted(signal);
        onProgress(progress);
        heartbeat();
      },
    });
    await this.fence(exact.context, exact.revision, signal);
    heartbeat();
    return snapshot;
  }

  async runAuditSuite(input: Readonly<{
    context: AuditSuiteContext;
    control: AuditSuiteRunControl;
    grouping: AuditSuiteGroupingResource;
  }>): ReturnType<AuditSuiteSectionRunners["aplus"]> {
    const revision = this.lifecycleRevision;
    const operation = new AbortController();
    const unlinkCaller = forwardAbort(operation, input.control.signal);
    this.auditSuiteControls.add(operation);
    const ownedInput = {
      ...input,
      control: {
        signal: operation.signal,
        heartbeat: (update) => input.control.heartbeat(update),
        resource: (key, load) => input.control.resource(key, load),
      } satisfies AuditSuiteRunControl,
    };
    try {
      const result = await this.runAuditSuiteOwned(ownedInput, revision);
      this.assertLifecycleCurrent(revision);
      throwIfAborted(operation.signal);
      return result;
    } catch (error) {
      if (error instanceof SpExecutionContextError) throw error;
      this.assertLifecycleCurrent(revision);
      throwIfAborted(operation.signal);
      throw error;
    } finally {
      unlinkCaller();
      this.auditSuiteControls.delete(operation);
    }
  }

  private async runAuditSuiteOwned(input: Readonly<{
    context: AuditSuiteContext;
    control: AuditSuiteRunControl;
    grouping: AuditSuiteGroupingResource;
  }>, revision: number): ReturnType<AuditSuiteSectionRunners["aplus"]> {
    const exact = await this.captureAuditSuiteContext(
      input.context,
      input.control.signal,
      revision,
    );
    if (input.grouping.grouping.marketplaceId !== exact.marketplaceId) {
      throw contextInvalidated();
    }
    const fbaSnapshotId = createHash("sha256").update(JSON.stringify([
      input.context.accountScope,
      exact.marketplaceId,
      input.grouping.reportId,
      input.grouping.documentId,
      input.grouping.data.fetchedAt,
    ])).digest("hex");
    const controlledWaitMessages: Record<AplusContentPageOperation, string> = {
      "publish-records":
        "Amazon A+ API 要求延後重試；Notebook 鑰匙仍在受控等待。",
      "content-documents":
        "Amazon A+ API 要求延後文件讀取；Notebook 鑰匙仍在受控等待。",
      "document-relations":
        "Amazon A+ API 要求延後關聯讀取；Notebook 鑰匙仍在受控等待。",
    };
    let snapshot: AplusAuditSnapshot;
    try {
      snapshot = await this.contentReads.read({
        marketplaceId: exact.marketplaceId,
        expectedContext: exact,
        fetchedAt: input.grouping.data.fetchedAt,
        fbaSnapshotId,
        rows: buildAplusAuditSeedsFromFbaGrouping(input.grouping.grouping.rows),
        signal: input.control.signal,
        onControlledWait: (operation) => {
          this.assertLifecycleCurrent(revision);
          throwIfAborted(input.control.signal);
          input.control.heartbeat({ message: controlledWaitMessages[operation] });
        },
        onProgress: (progress) => {
          this.assertLifecycleCurrent(revision);
          throwIfAborted(input.control.signal);
          input.control.heartbeat({
            message:
              `正在核對 A+ publish records（${progress.completedAsins}／${progress.totalAsins} ASIN）。`,
            completedUnits: progress.completedAsins,
            totalUnits: progress.totalAsins,
          });
        },
      });
    } catch (error) {
      await this.fenceAuditSuiteContext(
        input.context,
        exact,
        input.control.signal,
        revision,
      );
      throw error;
    }
    await this.fenceAuditSuiteContext(
      input.context,
      exact,
      input.control.signal,
      revision,
    );
    if (
      snapshot.mode !== exact.mode ||
      snapshot.marketplaceId !== exact.marketplaceId
    ) {
      throw contextInvalidated();
    }
    return {
      ...input.context,
      ...buildAplusAuditSuiteResult(snapshot),
    };
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (
      !body ||
      Object.keys(body).length !== 2 ||
      !("marketplaceId" in body) ||
      !("mode" in body)
    ) {
      return invalid(
        "A+ 健檢只接受 marketplaceId 與 mode；帳號和 FBA 快照由 main process 綁定。",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const mode = body.mode === "live" || body.mode === "demo" ? body.mode : null;
    if (!marketplaceId || !mode) {
      return invalid("A+ 健檢站點或模式無效。");
    }
    try {
      const receipt = await this.jobs.start({ marketplaceId, mode });
      return json(receipt, 202, { "retry-after": "1" });
    } catch (error) {
      return coordinatorError(
        error,
        "開始全站 A+ 健檢時發生未預期的錯誤。",
      );
    }
  }

  async observe(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const mode = request.query.mode === "live" || request.query.mode === "demo"
      ? request.query.mode
      : null;
    const jobId = reportIdentifier(request.query.jobId);
    const contextId = reportIdentifier(request.query.contextId);
    if (!marketplaceId || !mode || !jobId || !contextId) {
      return invalid("A+ 健檢工作資訊無效。");
    }
    try {
      const receipt = await this.jobs.get({
        marketplaceId,
        mode,
        jobId,
        contextId,
      });
      return json(
        receipt,
        receipt.ready ? 200 : 202,
        receipt.ready ? {} : { "retry-after": "1" },
      );
    } catch (error) {
      return coordinatorError(
        error,
        "查詢全站 A+ 健檢進度時發生未預期的錯誤。",
      );
    }
  }
}
