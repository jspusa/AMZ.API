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
import { createBusinessPricingAuditWorkbook } from
  "./business-pricing-audit-xlsx";
import type { AuditSuiteContext } from "./audit-suite-context";
import type {
  AuditSuiteRunControl,
  AuditSuiteSectionRunners,
} from "./audit-suite-coordinator";
import type { AuditSuiteListingsResource } from "./audit-suite-resources";
import type { BusinessPricingAuditSnapshot } from
  "./catalog-report-reads";
import { ContextBoundAuditSnapshotStore } from
  "./context-bound-audit-snapshot";
import type { ReportsRuntimeReceipt } from "./reports-runtime";
import { publicSpApiError, SpApiError } from "./sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";
import {
  StandaloneAuditJobCoordinatorError,
  type StandaloneAuditJobBoundContext,
  type StandaloneAuditJobProgress,
} from "./standalone-audit-job";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_DIRECT_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_STANDALONE_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_POLL_LIMIT = 180;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export type BusinessPricingAuditStartReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  explicitRetry: boolean;
  freshCompleted?: boolean;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>) => Promise<ReportsRuntimeReceipt>;

export type BusinessPricingAuditStatusReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>) => Promise<ReportsRuntimeReceipt>;

export type BusinessPricingAuditReadReport = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
  heartbeat?: () => void;
}>) => Promise<BusinessPricingAuditSnapshot>;

export type BusinessPricingStandaloneJobReceipt = Readonly<{
  ready: boolean;
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  snapshot?: unknown;
}>;

export type BusinessPricingAuditCapture = Readonly<{
  exportId: string;
  snapshot: BusinessPricingAuditSnapshot;
}>;

export type BusinessPricingAuditStandaloneSnapshot =
  BusinessPricingAuditSnapshot & Readonly<{ exportId: string }>;

export type BusinessPricingAuditStandaloneInput = Readonly<{
  context: StandaloneAuditJobBoundContext;
  signal: AbortSignal;
  heartbeat(): void;
  updateProgress(progress: StandaloneAuditJobProgress): void;
}>;

export interface BusinessPricingAuditPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  statusOrData(request: ApiRequest): Promise<ApiResponse>;
  download(request: ApiRequest): Promise<ApiResponse>;
  capture(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
    heartbeat?: () => void;
  }>): Promise<BusinessPricingAuditCapture>;
  runStandalone(
    input: BusinessPricingAuditStandaloneInput,
  ): Promise<BusinessPricingAuditStandaloneSnapshot>;
  runAuditSuite(input: Readonly<{
    context: AuditSuiteContext;
    control: AuditSuiteRunControl;
    loadListings(): Promise<AuditSuiteListingsResource>;
  }>): ReturnType<AuditSuiteSectionRunners["businessPricing"]>;
  clear(): void;
}

export type BusinessPricingAuditDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  startReport: BusinessPricingAuditStartReport;
  statusReport: BusinessPricingAuditStatusReport;
  readReport: BusinessPricingAuditReadReport;
  getStandaloneJob(input: Readonly<{
    kind: "businessPricing";
    marketplaceId: MarketplaceId;
    mode: "live" | "demo";
    jobId: string;
    contextId: string;
  }>): Promise<BusinessPricingStandaloneJobReceipt>;
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

/**
 * Main-only owner for the complete FBA Business Pricing audit lifecycle.
 * The injected report functions are already fixed to the B2B semantic report
 * family; this module has no transport, credential, or arbitrary report-type
 * capability.
 */
export class BusinessPricingAudit implements BusinessPricingAuditPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly startReport: BusinessPricingAuditStartReport;
  private readonly statusReport: BusinessPricingAuditStatusReport;
  private readonly readReport: BusinessPricingAuditReadReport;
  private readonly getStandaloneJob:
    BusinessPricingAuditDependencies["getStandaloneJob"];
  private readonly snapshots: ContextBoundAuditSnapshotStore<
    BusinessPricingAuditSnapshot
  >;
  private readonly standaloneTtlMs: number;
  private readonly wait: NonNullable<BusinessPricingAuditDependencies["wait"]>;
  private readonly pollLimit: number;
  private readonly controls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: BusinessPricingAuditDependencies) {
    this.context = input.context;
    this.startReport = input.startReport;
    this.statusReport = input.statusReport;
    this.readReport = input.readReport;
    this.getStandaloneJob = input.getStandaloneJob;
    this.standaloneTtlMs = input.standaloneTtlMs ??
      DEFAULT_STANDALONE_TTL_MS;
    if (!Number.isSafeInteger(this.standaloneTtlMs) || this.standaloneTtlMs < 1) {
      throw new Error("B2B standalone snapshot retention must be positive.");
    }
    this.wait = input.wait ?? abortableDelay;
    this.pollLimit = input.pollLimit ?? DEFAULT_POLL_LIMIT;
    if (!Number.isSafeInteger(this.pollLimit) || this.pollLimit < 1) {
      throw new Error("B2B audit poll limit must be a positive integer.");
    }
    this.snapshots = new ContextBoundAuditSnapshotStore({
      context: input.context,
      ttlMs: input.directTtlMs ?? DEFAULT_DIRECT_TTL_MS,
      now: input.now,
      createId: input.createId,
      expiredMessage: "B2B 價格健檢 Excel 快照已失效，請重新執行健檢。",
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
    snapshot: BusinessPricingAuditSnapshot,
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
    heartbeat?: () => void;
    standalone: boolean;
  }>): Promise<BusinessPricingAuditCapture> {
    const snapshot = await this.readReport({
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      documentId: input.documentId,
      signal: input.signal,
      expectedContext: input.context,
      heartbeat: input.heartbeat,
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
    heartbeat?: () => void;
  }>): Promise<BusinessPricingAuditCapture> {
    return this.execute(input, (context, signal, revision) =>
      this.captureInContext({
        ...input,
        signal,
        context,
        revision,
        standalone: false,
      }));
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      !("marketplaceId" in body)
    ) {
      return invalid(
        "B2B 價格健檢只接受 marketplaceId；帳號與報表身分由主程序綁定。",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    if (!marketplaceId) return invalid("請選擇要健檢的 Amazon 站點。");
    try {
      const status = await this.execute(
        { marketplaceId },
        (context, signal) => this.startReport({
          marketplaceId,
          explicitRetry: true,
          signal,
          expectedContext: context,
        }),
      );
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return routeError(
        error,
        "開始建立 B2B 價格健檢報表時發生未預期的錯誤。",
      );
    }
  }

  async statusOrData(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const reportId = reportIdentifier(request.query.reportId);
    if (!marketplaceId || !reportId) {
      return invalid("B2B 價格健檢報表資訊無效，請重新掃描。");
    }
    if (request.query.data !== "1") {
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
          "查詢 B2B 價格健檢進度時發生未預期的錯誤。",
        );
      }
    }
    const documentId = reportIdentifier(request.query.documentId);
    if (!documentId) {
      return invalid("B2B 價格健檢文件資訊無效，請重新掃描。");
    }
    try {
      const captured = await this.capture({
        marketplaceId,
        reportId,
        documentId,
      });
      return json(captured.snapshot);
    } catch (error) {
      return routeError(
        error,
        "整理 B2B 價格健檢資料時發生未預期的錯誤。",
      );
    }
  }

  private async snapshotWorkbook(
    marketplaceId: MarketplaceId,
    exportId: string,
  ): Promise<ApiResponse> {
    const snapshot = await this.snapshots.read({
      snapshotId: exportId,
      marketplaceId,
    });
    return this.workbookResponse(marketplaceId, snapshot);
  }

  private workbookResponse(
    marketplaceId: MarketplaceId,
    snapshot: BusinessPricingAuditSnapshot,
  ): ApiResponse {
    const marketplace = marketplaceById(marketplaceId);
    if (!marketplace) throw contextInvalidated();
    const workbook = createBusinessPricingAuditWorkbook({
      marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
      snapshot,
    });
    const date = snapshot.fetchedAt.slice(0, 10);
    const filename =
      `amazon-fba-business-pricing-audit-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
    const localizedFilename =
      `FBA-B2B價格健檢-${marketplace.shortLabel}-${date}.xlsx`;
    return xlsx(workbook, {
      "content-disposition":
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(localizedFilename)}`,
      "x-exported-fba-sku-count": String(snapshot.summary.totalFbaSkuCount),
      "x-b2b-price-mismatch-count": String(
        snapshot.summary.recommendedPriceMismatch,
      ),
      "x-b2b-tier-mismatch-count": String(
        snapshot.summary.recommendedQuantityDiscountMismatch,
      ),
    });
  }

  private legacyCompletedSnapshot(
    value: unknown,
    marketplaceId: MarketplaceId,
    mode: "live" | "demo",
  ): BusinessPricingAuditSnapshot | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (
      "exportId" in candidate ||
      "reportId" in candidate ||
      "documentId" in candidate ||
      candidate.marketplaceId !== marketplaceId ||
      candidate.mode !== mode ||
      typeof candidate.fetchedAt !== "string" ||
      !Array.isArray(candidate.rows) ||
      !candidate.summary ||
      typeof candidate.summary !== "object" ||
      Array.isArray(candidate.summary) ||
      typeof candidate.notice !== "string"
    ) {
      return null;
    }
    return structuredClone(value) as BusinessPricingAuditSnapshot;
  }

  async download(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const mode = request.query.mode === "live" || request.query.mode === "demo"
      ? request.query.mode
      : null;
    const jobId = reportIdentifier(request.query.jobId);
    const contextId = reportIdentifier(request.query.contextId);
    if (!marketplaceId || !mode || !jobId || !contextId) {
      return invalid("B2B 價格 Excel 工作資訊無效，請重新執行健檢。");
    }
    try {
      const receipt = await this.getStandaloneJob({
        kind: "businessPricing",
        marketplaceId,
        mode,
        jobId,
        contextId,
      });
      if (!receipt.ready || receipt.status !== "completed") {
        return invalid(
          "B2B 價格健檢尚未完成，不能匯出不完整快照。",
          409,
          "SNAPSHOT_NOT_READY",
        );
      }
      const candidate = receipt.snapshot;
      const exportId = candidate && typeof candidate === "object" &&
          "exportId" in candidate
        ? reportIdentifier((candidate as { exportId?: unknown }).exportId)
        : null;
      if (exportId) {
        return await this.snapshotWorkbook(marketplaceId, exportId);
      }
      const legacy = this.legacyCompletedSnapshot(
        receipt.snapshot,
        marketplaceId,
        mode,
      );
      if (legacy) {
        return await this.execute(
          { marketplaceId },
          async (context) => {
            if (context.mode !== mode) {
              throw new SpExecutionContextError(
                "REPORT_MODE_CHANGED",
                "App 展示／真實模式已改變；本次操作已停止。",
              );
            }
            this.assertSnapshotContext(legacy, context);
            return this.workbookResponse(marketplaceId, legacy);
          },
        );
      }
      throw new SpApiError(
        "B2B 價格健檢 Excel 快照已失效，請重新執行健檢。",
        { status: 410, code: "SNAPSHOT_EXPIRED" },
      );
    } catch (error) {
      if (error instanceof StandaloneAuditJobCoordinatorError) {
        const publicError = publicSpApiError(
          new SpApiError(error.message, {
            status: error.status,
            code: error.code,
          }),
          "建立 B2B 價格健檢 Excel 時發生未預期的錯誤。",
        );
        return json(
          { code: publicError.code, message: publicError.message },
          publicError.status,
        );
      }
      return routeError(error, "建立 B2B 價格健檢 Excel 時發生未預期的錯誤。");
    }
  }

  private assertStandaloneContext(
    bound: StandaloneAuditJobBoundContext,
    current: SpExecutionContext,
  ): void {
    if (
      bound.marketplaceId !== current.marketplaceId ||
      current.generation !== bound.generation
    ) {
      throw contextInvalidated();
    }
    if (String(current.accountScope) !== bound.accountScope) {
      throw new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "Amazon 帳號範圍已改變；本次操作已停止。",
      );
    }
    if (current.mode !== bound.mode) {
      throw new SpExecutionContextError(
        "REPORT_MODE_CHANGED",
        "App 展示／真實模式已改變；本次操作已停止。",
      );
    }
  }

  async runAuditSuite(input: Readonly<{
    context: AuditSuiteContext;
    control: AuditSuiteRunControl;
    loadListings(): Promise<AuditSuiteListingsResource>;
  }>): ReturnType<AuditSuiteSectionRunners["businessPricing"]> {
    const marketplace = marketplaceById(input.context.marketplaceId);
    if (!marketplace) throw contextInvalidated();
    return this.execute(
      { marketplaceId: marketplace.id, signal: input.control.signal },
      async (context, signal, revision) => {
        this.assertStandaloneContext(input.context, context);
        this.assertRevision(revision);
        input.control.heartbeat({
          message:
            "Amazon 正在準備 B2B 健檢所需的全商品與 Active Listings 報表。",
        });
        const started = await this.startReport({
          marketplaceId: marketplace.id,
          explicitRetry: false,
          signal,
          expectedContext: context,
        });
        await this.context.assertCurrent(context);
        this.assertRevision(revision);
        throwIfAborted(signal);
        if (started.mode !== context.mode) {
          throw new SpExecutionContextError(
            "REPORT_MODE_CHANGED",
            "App 展示／真實模式已改變；本次綜合健檢已停止。",
          );
        }
        input.control.heartbeat({
          message: "正在沿用本次綜合健檢的 FBA 全商品快照。",
        });
        const listings = await input.loadListings();
        await this.context.assertCurrent(context);
        this.assertRevision(revision);
        throwIfAborted(signal);
        const snapshot = await this.readReport({
          marketplaceId: marketplace.id,
          reportId: listings.reportId,
          documentId: listings.documentId,
          signal,
          expectedContext: context,
          heartbeat: () => {
            this.assertRevision(revision);
            throwIfAborted(signal);
            input.control.heartbeat({
              message:
                "Amazon 正在讀取既有 Active Listings Business Price 報表。",
            });
          },
        });
        await this.context.assertCurrent(context);
        this.assertRevision(revision);
        throwIfAborted(signal);
        this.assertStandaloneContext(input.context, context);
        this.assertSnapshotContext(snapshot, context);
        const rows = snapshot.rows
          .filter((row) =>
            row.status !== "configured" ||
            row.recommendedPriceMismatch ||
            row.recommendedQuantityDiscountMismatch
          )
          .map((row) => ({
            sellerSku: row.sellerSku,
            title: row.title,
            asin: row.asin,
            standardPrice: row.standardPrice?.amount ?? null,
            businessPrice: row.businessPrice?.amount ?? null,
            currencyCode: row.businessPrice?.currencyCode ??
              row.standardPrice?.currencyCode ?? null,
            finding: [
              ...(row.status === "above_standard"
                ? ["B2B 價格高於一般售價"]
                : row.status === "missing"
                  ? ["尚未設定 B2B 價格"]
                  : row.status === "unsupported"
                    ? ["請至 Amazon 後台確認"]
                    : row.status === "incomplete" ? ["資料未完成"] : []),
              ...(row.recommendedPriceMismatch
                ? ["不符建議 B2B 價格"]
                : []),
              ...(row.recommendedQuantityDiscountMismatch
                ? ["未正確設定階梯折扣"]
                : []),
            ].join("；"),
            editable: row.editable,
            notice: row.reason,
          }));
        return {
          ...input.context,
          status: snapshot.summary.incomplete ? "partial" : "completed",
          fetchedAt: snapshot.fetchedAt,
          notice: snapshot.notice,
          payload: rows,
        };
      },
    );
  }

  async runStandalone(
    input: BusinessPricingAuditStandaloneInput,
  ): Promise<BusinessPricingAuditStandaloneSnapshot> {
    const marketplace = marketplaceById(input.context.marketplaceId);
    if (!marketplace) throw contextInvalidated();
    return this.execute(
      { marketplaceId: marketplace.id, signal: input.signal },
      async (context, signal, revision) => {
        this.assertStandaloneContext(input.context, context);
        this.assertRevision(revision);
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
          stage: "business_pricing",
          message: "正在核對全部 FBA 商品的 B2B 價格與數量折扣。",
          completedUnits: 0,
          totalUnits: null,
        });
        const captured = await this.captureInContext({
          marketplaceId: marketplace.id,
          reportId: status.reportId,
          documentId: status.documentId,
          signal,
          context,
          revision,
          heartbeat: input.heartbeat,
          standalone: true,
        });
        input.updateProgress({
          stage: "complete",
          message: "B2B 價格健檢完成。",
          completedUnits: captured.snapshot.rows.length,
          totalUnits: captured.snapshot.rows.length,
        });
        return { ...captured.snapshot, exportId: captured.exportId };
      },
    );
  }
}
