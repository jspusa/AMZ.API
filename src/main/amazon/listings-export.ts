import type { ApiResponse } from "../../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
} from "../abort-utils";
import type {
  CatalogExportProgress,
  FbaCatalogExport,
} from "./catalog-report-reads";
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
import { createListingsWorkbook } from "./xlsx";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_DIRECT_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_STANDALONE_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_POLL_LIMIT = 180;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export type ListingsExportStartReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  explicitRetry: boolean;
  freshCompleted?: boolean;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>) => Promise<ReportsRuntimeReceipt>;

export type ListingsExportStatusReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>) => Promise<ReportsRuntimeReceipt>;

export type ListingsExportReadReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
  onProgress?: (
    progress: CatalogExportProgress,
  ) => void | Promise<void>;
}>) => Promise<FbaCatalogExport>;

/** Main-only capture; callers must never serialize `context` to the renderer. */
export type ListingsExportCapture = Readonly<{
  exportId: string;
  context: SpExecutionContext;
  snapshot: FbaCatalogExport;
}>;

export type ListingsExportStandaloneInput = Readonly<{
  context: StandaloneAuditJobBoundContext;
  signal: AbortSignal;
  heartbeat(): void;
  updateProgress(progress: StandaloneAuditJobProgress): void;
}>;

export type ListingsExportReportIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
  onProgress?: (
    progress: CatalogExportProgress,
  ) => void | Promise<void>;
}>;

export type ListingsExportDownloadInput =
  | ListingsExportReportIdentity
  | Readonly<{
      marketplaceId: MarketplaceId;
      exportId: string;
    }>;

export interface ListingsExportPort {
  start(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt>;
  startReusable(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt>;
  status(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt>;
  capture(input: ListingsExportReportIdentity): Promise<ListingsExportCapture>;
  data(input: ListingsExportReportIdentity): Promise<FbaCatalogExport>;
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
  }>): Promise<FbaCatalogExport>;
  download(input: ListingsExportDownloadInput): Promise<ApiResponse>;
  runStandalone(
    input: ListingsExportStandaloneInput,
  ): Promise<ListingsExportCapture>;
  clear(): void;
}

export type ListingsExportDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  startReport: ListingsExportStartReport;
  statusReport: ListingsExportStatusReport;
  readReport: ListingsExportReadReport;
  directTtlMs?: number;
  standaloneTtlMs?: number;
  now?: () => number;
  createId?: () => string;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  pollLimit?: number;
}>;

function bytes(
  value: Uint8Array,
  headers: Record<string, string>,
): ApiResponse {
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

/**
 * Shared FBA All Listings snapshot owner. Its report functions are semantic
 * catalog operations, so callers cannot select report type, transport, host,
 * path, method, or credentials.
 */
export class ListingsExport implements ListingsExportPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly startReport: ListingsExportStartReport;
  private readonly statusReport: ListingsExportStatusReport;
  private readonly readReport: ListingsExportReadReport;
  private readonly snapshots: ContextBoundAuditSnapshotStore<FbaCatalogExport>;
  private readonly standaloneTtlMs: number;
  private readonly wait: NonNullable<ListingsExportDependencies["wait"]>;
  private readonly pollLimit: number;
  private readonly controls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: ListingsExportDependencies) {
    this.context = input.context;
    this.startReport = input.startReport;
    this.statusReport = input.statusReport;
    this.readReport = input.readReport;
    this.standaloneTtlMs = input.standaloneTtlMs ??
      DEFAULT_STANDALONE_TTL_MS;
    if (!Number.isSafeInteger(this.standaloneTtlMs) || this.standaloneTtlMs < 1) {
      throw new Error("Listings standalone retention must be positive.");
    }
    this.wait = input.wait ?? abortableDelay;
    this.pollLimit = input.pollLimit ?? DEFAULT_POLL_LIMIT;
    if (!Number.isSafeInteger(this.pollLimit) || this.pollLimit < 1) {
      throw new Error("Listings poll limit must be a positive integer.");
    }
    this.snapshots = new ContextBoundAuditSnapshotStore({
      context: input.context,
      ttlMs: input.directTtlMs ?? DEFAULT_DIRECT_TTL_MS,
      now: input.now,
      createId: input.createId,
      expiredMessage: "全商品 Excel 快照已失效，請重新匯出。",
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

  async start(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt> {
    return this.execute(input, (context, signal) => this.startReport({
      marketplaceId: input.marketplaceId,
      explicitRetry: true,
      signal,
      expectedContext: context,
    }));
  }

  /** Starts or reuses the fixed Listings lease without authorizing a retry. */
  async startReusable(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt> {
    return this.execute(input, (context, signal) => this.startReport({
      marketplaceId: input.marketplaceId,
      explicitRetry: false,
      signal,
      expectedContext: context,
    }));
  }

  async status(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt> {
    return this.execute(input, (context, signal) => this.statusReport({
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      signal,
      expectedContext: context,
    }));
  }

  private async captureInContext(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal: AbortSignal;
    context: SpExecutionContext;
    revision: number;
    standalone: boolean;
    onProgress?: (
      progress: CatalogExportProgress,
    ) => void | Promise<void>;
  }>): Promise<ListingsExportCapture> {
    const snapshot = await this.readReport({
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      documentId: input.documentId,
      signal: input.signal,
      expectedContext: input.context,
      onProgress: input.onProgress,
    });
    await this.context.assertCurrent(input.context);
    this.assertRevision(input.revision);
    throwIfAborted(input.signal);
    const exportId = this.snapshots.publish({
      context: input.context,
      marketplaceId: input.marketplaceId,
      snapshot,
      ...(input.standalone ? { ttlMs: this.standaloneTtlMs } : {}),
    });
    return {
      exportId,
      context: input.context,
      snapshot: structuredClone(snapshot),
    };
  }

  async capture(input: ListingsExportReportIdentity): Promise<ListingsExportCapture> {
    return this.execute(input, (context, signal, revision) =>
      this.captureInContext({
        marketplaceId: input.marketplaceId,
        reportId: input.reportId,
        documentId: input.documentId,
        signal,
        context,
        revision,
        standalone: false,
        onProgress: input.onProgress,
      }));
  }

  async data(input: ListingsExportReportIdentity): Promise<FbaCatalogExport> {
    return (await this.capture(input)).snapshot;
  }

  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
  }>): Promise<FbaCatalogExport> {
    return this.snapshots.read({
      marketplaceId: input.marketplaceId,
      snapshotId: input.exportId,
    });
  }

  private async workbook(
    marketplaceId: MarketplaceId,
    exportId: string,
  ): Promise<ApiResponse> {
    const snapshot = await this.read({ marketplaceId, exportId });
    const marketplace = marketplaceById(marketplaceId);
    if (!marketplace) throw contextInvalidated();
    const workbook = createListingsWorkbook({
      marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
      fetchedAt: snapshot.fetchedAt,
      rows: snapshot.rows.map((row) => ({
        marketplaceLabel: row.marketplace,
        sku: row.sellerSku,
        asin: row.asin,
        productType: row.productType,
        title: row.title,
        bulletPoints: row.bulletPoints,
        ingredients: row.ingredients,
        status: row.status,
        lastUpdated: row.updatedAt || null,
      })),
      errors: snapshot.errors.map((error) => ({
        sku: error.sellerSku,
        type: error.kind,
        description: error.message,
      })),
    });
    const date = snapshot.fetchedAt.slice(0, 10);
    const filename =
      `amazon-listing-content-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
    return bytes(workbook, {
      "content-disposition": `attachment; filename="${filename}"`,
      "x-exported-listing-count": String(snapshot.rows.length),
      "x-export-warning-count": String(snapshot.errors.length),
    });
  }

  async download(input: ListingsExportDownloadInput): Promise<ApiResponse> {
    if ("exportId" in input) {
      return this.workbook(input.marketplaceId, input.exportId);
    }
    const captured = await this.capture(input);
    return this.workbook(input.marketplaceId, captured.exportId);
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
    input: ListingsExportStandaloneInput,
  ): Promise<ListingsExportCapture> {
    const marketplace = marketplaceById(input.context.marketplaceId);
    if (!marketplace) throw contextInvalidated();
    return this.execute(
      { marketplaceId: marketplace.id, signal: input.signal },
      async (context, signal, revision) => {
        this.assertStandaloneContext(input.context, context);
        input.updateProgress({
          stage: "amazon_report",
          message: "Amazon 正在準備 FBA 全商品報表。",
          completedUnits: 0,
          totalUnits: 1,
        });
        let status = await this.startReport({
          marketplaceId: marketplace.id,
          explicitRetry: false,
          signal,
          expectedContext: context,
        });
        input.heartbeat();
        for (
          let attempt = 0;
          !status.ready && attempt < this.pollLimit;
          attempt += 1
        ) {
          if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
            throw new Error(
              "Amazon 未能產生本次單項健檢所需的 FBA 全商品報表。",
            );
          }
          input.heartbeat();
          await this.wait(DEFAULT_POLL_INTERVAL_MS, signal);
          status = await this.statusReport({
            marketplaceId: marketplace.id,
            reportId: status.reportId,
            signal,
            expectedContext: context,
          });
          input.heartbeat();
          await this.context.assertCurrent(context);
          this.assertRevision(revision);
        }
        if (
          !status.ready ||
          !status.documentId ||
          status.mode !== input.context.mode
        ) {
          throw new Error(
            "Amazon FBA 全商品報表未完成或 context 已改變。",
          );
        }
        input.updateProgress({
          stage: "listing_rows",
          message: "正在下載並核對 FBA 商品資料。",
          completedUnits: 0,
          totalUnits: 1,
        });
        return this.captureInContext({
          marketplaceId: marketplace.id,
          reportId: status.reportId,
          documentId: status.documentId,
          signal,
          context,
          revision,
          standalone: true,
          onProgress: () => input.heartbeat(),
        });
      },
    );
  }
}
