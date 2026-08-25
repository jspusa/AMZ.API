import type { ApiRequest, ApiResponse } from "../../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
} from "../abort-utils";
import { bodyRecord, parseMarketplace, reportIdentifier } from "../route-input";
import { invalid, json, routeError } from "../route-response";
import type {
  AgedInventorySnapshot,
} from "./aged-inventory-reads";
import { ContextBoundAuditSnapshotStore } from
  "./context-bound-audit-snapshot";
import type { ReportsRuntimeReceipt } from "./reports-runtime";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";
import type {
  StandaloneAuditJobBoundContext,
  StandaloneAuditJobProgress,
} from "./standalone-audit-job";
import { createAgedInventoryWorkbook } from "./xlsx";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_DIRECT_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_STANDALONE_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_POLL_LIMIT = 900;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export type AgedInventoryBeginReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  explicitRetry: boolean;
  freshCompleted?: boolean;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>) => Promise<ReportsRuntimeReceipt>;

export type AgedInventoryStatusReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>) => Promise<ReportsRuntimeReceipt>;

export type AgedInventoryReadReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>) => Promise<AgedInventorySnapshot>;

export type AgedInventoryAuditCapture = Readonly<{
  exportId: string;
  snapshot: AgedInventorySnapshot;
}>;

export type AgedInventoryStandaloneSnapshot =
  AgedInventorySnapshot & Readonly<{ exportId: string }>;

export type AgedInventoryStandaloneInput = Readonly<{
  context: StandaloneAuditJobBoundContext;
  signal: AbortSignal;
  heartbeat(): void;
  updateProgress(progress: StandaloneAuditJobProgress): void;
}>;

export interface AgedInventoryAuditPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  statusDataOrDownload(request: ApiRequest): Promise<ApiResponse>;
  capture(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<AgedInventoryAuditCapture>;
  runStandalone(
    input: AgedInventoryStandaloneInput,
  ): Promise<AgedInventoryStandaloneSnapshot>;
  clear(): void;
}

export type AgedInventoryAuditDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  beginReport: AgedInventoryBeginReport;
  statusReport: AgedInventoryStatusReport;
  readReport: AgedInventoryReadReport;
  directTtlMs?: number;
  standaloneTtlMs?: number;
  now?: () => number;
  createId?: () => string;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  pollLimit?: number;
}>;

function xlsx(value: Uint8Array, headers: Record<string, string>): ApiResponse {
  return {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": XLSX_CONTENT_TYPE,
      "x-content-type-options": "nosniff",
      ...headers,
    },
    body: { kind: "bytes", value },
  };
}

function contextInvalidated(): SpExecutionContextError {
  return new SpExecutionContextError(
    "SP_CONTEXT_INVALIDATED",
    "Amazon 執行環境已更新；請重新開始這次操作。",
  );
}

/** Complete main-only owner for direct and standalone FBA aged-inventory audits. */
export class AgedInventoryAudit implements AgedInventoryAuditPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly beginReport: AgedInventoryBeginReport;
  private readonly statusReport: AgedInventoryStatusReport;
  private readonly readReport: AgedInventoryReadReport;
  private readonly snapshots: ContextBoundAuditSnapshotStore<AgedInventorySnapshot>;
  private readonly standaloneTtlMs: number;
  private readonly wait: NonNullable<AgedInventoryAuditDependencies["wait"]>;
  private readonly pollLimit: number;
  private readonly controls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: AgedInventoryAuditDependencies) {
    this.context = input.context;
    this.beginReport = input.beginReport;
    this.statusReport = input.statusReport;
    this.readReport = input.readReport;
    this.standaloneTtlMs = input.standaloneTtlMs ?? DEFAULT_STANDALONE_TTL_MS;
    if (!Number.isSafeInteger(this.standaloneTtlMs) || this.standaloneTtlMs < 1) {
      throw new Error("Aged inventory standalone retention must be positive.");
    }
    this.wait = input.wait ?? abortableDelay;
    this.pollLimit = input.pollLimit ?? DEFAULT_POLL_LIMIT;
    if (!Number.isSafeInteger(this.pollLimit) || this.pollLimit < 1) {
      throw new Error("Aged inventory poll limit must be a positive integer.");
    }
    this.snapshots = new ContextBoundAuditSnapshotStore({
      context: input.context,
      ttlMs: input.directTtlMs ?? DEFAULT_DIRECT_TTL_MS,
      now: input.now,
      createId: input.createId,
      expiredMessage: "FBA 庫齡 Excel 快照已失效，請重新同步。",
    });
  }

  clear(): void {
    this.lifecycleRevision += 1;
    const reason = contextInvalidated();
    for (const control of this.controls) control.abort(reason);
    this.controls.clear();
    this.snapshots.clear();
  }

  private assertRevision(revision: number): void {
    if (revision !== this.lifecycleRevision) throw contextInvalidated();
  }

  private async execute<T>(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>, operation: (
    context: SpExecutionContext,
    signal: AbortSignal,
    revision: number,
  ) => Promise<T>): Promise<T> {
    const revision = this.lifecycleRevision;
    const control = new AbortController();
    const unlinkCaller = forwardAbort(control, input.signal);
    this.controls.add(control);
    let captured: SpExecutionContext | null = null;
    try {
      throwIfAborted(control.signal);
      if (input.expectedContext) {
        if (input.expectedContext.marketplaceId !== input.marketplaceId) {
          throw contextInvalidated();
        }
        captured = input.expectedContext;
        await this.context.assertCurrent(captured);
      } else {
        captured = await this.context.capture(input.marketplaceId);
      }
      this.assertRevision(revision);
      throwIfAborted(control.signal);
      const result = await operation(captured, control.signal, revision);
      await this.context.assertCurrent(captured);
      this.assertRevision(revision);
      throwIfAborted(control.signal);
      return result;
    } catch (error) {
      if (error instanceof SpExecutionContextError) throw error;
      if (captured) await this.context.assertCurrent(captured);
      this.assertRevision(revision);
      throw error;
    } finally {
      unlinkCaller();
      this.controls.delete(control);
    }
  }

  private assertSnapshotContext(
    snapshot: AgedInventorySnapshot,
    context: SpExecutionContext,
  ): void {
    if (
      snapshot.marketplaceId !== context.marketplaceId ||
      snapshot.mode !== context.mode
    ) {
      throw contextInvalidated();
    }
  }

  private async captureInContext(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal: AbortSignal;
    context: SpExecutionContext;
    revision: number;
    standalone: boolean;
  }>): Promise<AgedInventoryAuditCapture> {
    const snapshot = await this.readReport({
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      documentId: input.documentId,
      signal: input.signal,
      expectedContext: input.context,
    });
    await this.context.assertCurrent(input.context);
    this.assertRevision(input.revision);
    throwIfAborted(input.signal);
    this.assertSnapshotContext(snapshot, input.context);
    const exportId = this.snapshots.publish({
      context: input.context,
      marketplaceId: input.marketplaceId,
      snapshot,
      ...(input.standalone ? { ttlMs: this.standaloneTtlMs } : {}),
    });
    return { exportId, snapshot: structuredClone(snapshot) };
  }

  async capture(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<AgedInventoryAuditCapture> {
    return this.execute(input, (context, signal, revision) =>
      this.captureInContext({
        marketplaceId: input.marketplaceId,
        reportId: input.reportId,
        documentId: input.documentId,
        signal,
        context,
        revision,
        standalone: false,
      }));
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) {
      return invalid("請選擇要查詢庫齡的 Amazon 站點。");
    }
    try {
      const status = await this.execute(
        { marketplaceId },
        (context, signal) => this.beginReport({
          marketplaceId,
          explicitRetry: true,
          freshCompleted: true,
          signal,
          expectedContext: context,
        }),
      );
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return routeError(
        error,
        "開始建立 FBA 庫齡報表時發生未預期的錯誤。",
      );
    }
  }

  private async workbook(
    marketplaceId: MarketplaceId,
    exportId: string,
  ): Promise<ApiResponse> {
    const snapshot = await this.snapshots.read({
      snapshotId: exportId,
      marketplaceId,
    });
    const marketplace = marketplaceById(marketplaceId);
    if (!marketplace) throw contextInvalidated();
    const workbook = createAgedInventoryWorkbook({
      marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
      fetchedAt: snapshot.fetchedAt,
      rows: snapshot.rows,
      excessAvailability: snapshot.summary.excessAvailability,
      excessReportedSkuCount: snapshot.summary.excessReportedSkuCount,
      storageCostAvailability: snapshot.summary.storageCostAvailability,
      storageCostReportedSkuCount: snapshot.summary.storageCostReportedSkuCount,
      agedSurchargeAvailability: snapshot.summary.agedSurchargeAvailability,
      agedSurchargeReportedSkuCount:
        snapshot.summary.agedSurchargeReportedSkuCount,
      expirationNotice: snapshot.expiration.notice,
    });
    const date = snapshot.fetchedAt.slice(0, 10);
    const filename =
      `amazon-fba-inventory-age-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
    const localizedFilename =
      `FBA-庫齡與預估冗餘健檢-${marketplace.shortLabel}-${date}.xlsx`;
    return xlsx(workbook, {
      "content-disposition":
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(localizedFilename)}`,
      "x-exported-fba-sku-count": String(snapshot.rows.length),
    });
  }

  async statusDataOrDownload(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) {
      return invalid("FBA 庫齡報表查詢資訊無效，請重新同步。");
    }
    if (request.query.exportId !== undefined) {
      const exportId = reportIdentifier(request.query.exportId);
      if (request.query.download !== "1" || !exportId) {
        return invalid("FBA 庫齡 Excel 快照資訊無效，請重新執行健檢。");
      }
      try {
        return await this.workbook(marketplaceId, exportId);
      } catch (error) {
        return routeError(
          error,
          "整理或匯出 FBA 庫齡資料時發生未預期的錯誤。",
        );
      }
    }
    const reportId = reportIdentifier(request.query.reportId);
    if (!reportId) {
      return invalid("FBA 庫齡報表查詢資訊無效，請重新同步。");
    }
    const dataRequested = request.query.data === "1";
    const downloadRequested = request.query.download === "1";
    if (!dataRequested && !downloadRequested) {
      try {
        const status = await this.execute(
          { marketplaceId },
          (context, signal) => this.statusReport({
            marketplaceId,
            reportId,
            signal,
            expectedContext: context,
          }),
        );
        return json({ ...status, message: status.notice });
      } catch (error) {
        return routeError(
          error,
          "查詢 FBA 庫齡報表狀態時發生未預期的錯誤。",
        );
      }
    }
    const documentId = reportIdentifier(request.query.documentId);
    if (!documentId) {
      return invalid("FBA 庫齡報表文件資訊無效，請重新同步。");
    }
    try {
      const captured = await this.capture({
        marketplaceId,
        reportId,
        documentId,
      });
      return downloadRequested
        ? await this.workbook(marketplaceId, captured.exportId)
        : json(captured.snapshot);
    } catch (error) {
      return routeError(
        error,
        "整理或匯出 FBA 庫齡資料時發生未預期的錯誤。",
      );
    }
  }

  private assertStandaloneContext(
    bound: StandaloneAuditJobBoundContext,
    current: SpExecutionContext,
  ): void {
    if (
      bound.marketplaceId !== current.marketplaceId ||
      bound.generation !== current.generation
    ) {
      throw contextInvalidated();
    }
    if (bound.accountScope !== String(current.accountScope)) {
      throw new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "Amazon 帳號範圍已改變；本次操作已停止。",
      );
    }
    if (bound.mode !== current.mode) {
      throw new SpExecutionContextError(
        "REPORT_MODE_CHANGED",
        "App 展示／真實模式已改變；本次操作已停止。",
      );
    }
  }

  async runStandalone(
    input: AgedInventoryStandaloneInput,
  ): Promise<AgedInventoryStandaloneSnapshot> {
    const marketplace = marketplaceById(input.context.marketplaceId);
    if (!marketplace) throw contextInvalidated();
    return this.execute(
      { marketplaceId: marketplace.id, signal: input.signal },
      async (context, signal, revision) => {
        this.assertStandaloneContext(input.context, context);
        input.updateProgress({
          stage: "amazon_report",
          message: "Amazon 正在準備 FBA 庫齡報表。",
          completedUnits: 0,
          totalUnits: 1,
        });
        let status = await this.beginReport({
          marketplaceId: marketplace.id,
          explicitRetry: false,
          signal,
          expectedContext: context,
        });
        for (
          let attempt = 0;
          !status.ready && attempt < this.pollLimit;
          attempt += 1
        ) {
          if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
            throw new Error("Amazon 未能產生本次 FBA 庫齡報表。");
          }
          input.heartbeat();
          await this.wait(DEFAULT_POLL_INTERVAL_MS, signal);
          status = await this.statusReport({
            marketplaceId: marketplace.id,
            reportId: status.reportId,
            signal,
            expectedContext: context,
          });
          await this.context.assertCurrent(context);
          this.assertRevision(revision);
        }
        if (
          !status.ready ||
          !status.documentId ||
          status.mode !== input.context.mode
        ) {
          throw new Error(
            "Amazon FBA 庫齡報表未完成或 context 已改變。",
          );
        }
        const captured = await this.captureInContext({
          marketplaceId: marketplace.id,
          reportId: status.reportId,
          documentId: status.documentId,
          signal,
          context,
          revision,
          standalone: true,
        });
        input.updateProgress({
          stage: "complete",
          message: "FBA 庫齡健檢完成。",
          completedUnits: captured.snapshot.rows.length,
          totalUnits: captured.snapshot.rows.length,
        });
        return { ...captured.snapshot, exportId: captured.exportId };
      },
    );
  }
}
