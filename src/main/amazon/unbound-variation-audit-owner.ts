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
import {
  bodyRecord,
  parseMarketplace,
  reportIdentifier,
} from "../route-input";
import { invalid, json, routeError } from "../route-response";
import { ContextBoundAuditSnapshotStore } from
  "./context-bound-audit-snapshot";
import type { ReportsRuntimeReceipt } from "./reports-runtime";
import { SpApiError } from "./sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";
import type { UnboundVariationAuditSnapshot } from
  "./variation-catalog-reads";
import {
  createUnboundVariationWorkbook,
  type CreateUnboundVariationWorkbookInput,
} from "./xlsx";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const UNBOUND_VARIATION_AUDIT_DIRECT_TTL_MS = 10 * 60 * 1_000;
export const UNBOUND_VARIATION_AUDIT_STANDALONE_TTL_MS = 30 * 60 * 1_000;

export type UnboundVariationAuditSource = Readonly<{
  begin(input: Readonly<{
    marketplaceId: MarketplaceId;
    explicitRetry: boolean;
    signal?: AbortSignal;
    expectedContext: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt>;
  status(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
    expectedContext: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt>;
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
    expectedContext: SpExecutionContext;
  }>): Promise<UnboundVariationAuditSnapshot>;
}>;

export type UnboundVariationAuditStandaloneProgress = Readonly<{
  stage: "amazon_report" | "relationships" | "complete";
  message: string;
  completedUnits: number | null;
  totalUnits: number | null;
}>;

export type UnboundVariationAuditStandaloneInput = Readonly<{
  marketplaceId: MarketplaceId;
  signal: AbortSignal;
  expectedContext?: SpExecutionContext;
  heartbeat?(): void;
  updateProgress?(progress: UnboundVariationAuditStandaloneProgress): void;
}>;

export type UnboundVariationAuditPublicSnapshot =
  UnboundVariationAuditSnapshot & Readonly<{ exportId: string }>;

export interface UnboundVariationAuditOwnerPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  statusDataOrDownload(request: ApiRequest): Promise<ApiResponse>;
  runStandalone(
    input: UnboundVariationAuditStandaloneInput,
  ): Promise<UnboundVariationAuditPublicSnapshot>;
  clear(): void;
}

type UnboundVariationAuditOwnerInput = Readonly<{
  context: SpExecutionContextAdapter;
  source: UnboundVariationAuditSource;
  createWorkbook?: (
    input: CreateUnboundVariationWorkbookInput,
  ) => Uint8Array;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  directTtlMs?: number;
  standaloneTtlMs?: number;
  now?: () => number;
  createId?: () => string;
}>;

type CapturedUnboundVariationAudit = Readonly<{
  exportId: string;
  snapshot: UnboundVariationAuditSnapshot;
}>;

function bytes(value: Uint8Array, headers: Record<string, string>): ApiResponse {
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

function publicSnapshot(
  snapshot: UnboundVariationAuditSnapshot,
  exportId: string,
): UnboundVariationAuditPublicSnapshot {
  return { ...structuredClone(snapshot), exportId };
}

/**
 * Complete main-only owner of the short-lived unbound-variation audit. The
 * fixed report source stays injected; this module owns direct route DTOs,
 * standalone polling, one semantic capture/publish path, workbook and headers.
 */
export class UnboundVariationAuditOwner
  implements UnboundVariationAuditOwnerPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly source: UnboundVariationAuditSource;
  private readonly createWorkbook: (
    input: CreateUnboundVariationWorkbookInput,
  ) => Uint8Array;
  private readonly wait: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly standaloneTtlMs: number;
  private readonly snapshots: ContextBoundAuditSnapshotStore<
    UnboundVariationAuditSnapshot
  >;
  private readonly controls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: UnboundVariationAuditOwnerInput) {
    this.context = input.context;
    this.source = input.source;
    this.createWorkbook = input.createWorkbook ?? createUnboundVariationWorkbook;
    this.wait = input.wait ?? abortableDelay;
    this.standaloneTtlMs = input.standaloneTtlMs ??
      UNBOUND_VARIATION_AUDIT_STANDALONE_TTL_MS;
    if (!Number.isSafeInteger(this.standaloneTtlMs) || this.standaloneTtlMs < 1) {
      throw new Error(
        "Unbound variation audit retention must be a positive integer.",
      );
    }
    this.snapshots = new ContextBoundAuditSnapshotStore({
      context: input.context,
      ttlMs: input.directTtlMs ?? UNBOUND_VARIATION_AUDIT_DIRECT_TTL_MS,
      now: input.now,
      createId: input.createId,
      expiredMessage:
        "未綁變體健檢快照已過期或站點不符，請重新掃描。",
    });
  }

  clear(): void {
    this.lifecycleRevision += 1;
    const reason = contextInvalidated();
    for (const control of this.controls) control.abort(reason);
    this.controls.clear();
    this.snapshots.clear();
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
    let context: SpExecutionContext | null = null;
    try {
      throwIfAborted(control.signal);
      context = await this.executionContext(
        input.marketplaceId,
        input.expectedContext,
      );
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      const result = await operation(context, control.signal, revision);
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      return result;
    } catch (error) {
      if (error instanceof SpExecutionContextError) throw error;
      if (context) await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      throw error;
    } finally {
      unlinkCaller();
      this.controls.delete(control);
    }
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) {
      return invalid("請選擇要健檢未綁變體的 Amazon 站點。");
    }
    try {
      const status = await this.execute(
        { marketplaceId },
        (context, signal) => this.source.begin({
          marketplaceId,
          explicitRetry: true,
          signal,
          expectedContext: context,
        }),
      );
      return json(
        { ...status, message: status.notice },
        status.ready ? 200 : 202,
      );
    } catch (error) {
      return routeError(
        error,
        "開始建立未綁變體健檢報表時發生未預期的錯誤。",
      );
    }
  }

  async statusDataOrDownload(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) {
      return invalid("未綁變體健檢站點無效，請重新掃描。");
    }
    if (request.query.download === "1") {
      return this.download(marketplaceId, request.query.exportId);
    }

    const reportId = reportIdentifier(request.query.reportId);
    if (!reportId) return invalid("未綁變體報表資訊無效，請重新掃描。");
    if (request.query.data !== "1") {
      try {
        const status = await this.execute(
          { marketplaceId },
          (context, signal) => this.source.status({
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
          "查詢未綁變體報表狀態時發生未預期的錯誤。",
        );
      }
    }

    const documentId = reportIdentifier(request.query.documentId);
    if (!documentId) {
      return invalid("未綁變體報表文件資訊無效，請重新掃描。");
    }
    try {
      const captured = await this.captureAndPublish({
        marketplaceId,
        reportId,
        documentId,
      });
      return json(publicSnapshot(captured.snapshot, captured.exportId));
    } catch (error) {
      return routeError(
        error,
        "整理未綁變體健檢資料時發生未預期的錯誤。",
      );
    }
  }

  async runStandalone(
    input: UnboundVariationAuditStandaloneInput,
  ): Promise<UnboundVariationAuditPublicSnapshot> {
    return this.execute(
      {
        marketplaceId: input.marketplaceId,
        signal: input.signal,
        expectedContext: input.expectedContext,
      },
      async (context, signal, revision) => {
        input.updateProgress?.({
          stage: "amazon_report",
          message: "Amazon 正在準備 FBA 全商品報表。",
          completedUnits: 0,
          totalUnits: 1,
        });
        let status = await this.source.begin({
          marketplaceId: input.marketplaceId,
          explicitRetry: false,
          signal,
          expectedContext: context,
        });
        input.heartbeat?.();
        for (let attempt = 0; !status.ready && attempt < 180; attempt += 1) {
          if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
            throw new Error(
              "Amazon 未能產生本次單項健檢所需的 FBA 全商品報表。",
            );
          }
          this.assertLifecycleCurrent(revision);
          input.heartbeat?.();
          await this.wait(1_000, signal);
          status = await this.source.status({
            marketplaceId: input.marketplaceId,
            reportId: status.reportId,
            signal,
            expectedContext: context,
          });
          input.heartbeat?.();
        }
        if (
          !status.ready ||
          !status.reportId ||
          !status.documentId ||
          status.mode !== context.mode
        ) {
          throw new Error("Amazon FBA 全商品報表未完成或 context 已改變。");
        }
        await this.context.assertCurrent(context);
        this.assertLifecycleCurrent(revision);
        input.updateProgress?.({
          stage: "relationships",
          message: "正在核對未綁變體與完整變體 family。",
          completedUnits: 0,
          totalUnits: null,
        });
        const captured = await this.captureAndPublish({
          marketplaceId: input.marketplaceId,
          reportId: status.reportId,
          documentId: status.documentId,
          signal,
          expectedContext: context,
          retentionMs: this.standaloneTtlMs,
          expectedLifecycleRevision: revision,
        });
        input.updateProgress?.({
          stage: "complete",
          message: "未綁變體健檢完成。",
          completedUnits: captured.snapshot.allVariationRows.length,
          totalUnits: captured.snapshot.allVariationRows.length,
        });
        this.assertLifecycleCurrent(revision);
        return publicSnapshot(captured.snapshot, captured.exportId);
      },
    );
  }

  private async download(
    marketplaceId: MarketplaceId,
    exportIdValue: unknown,
  ): Promise<ApiResponse> {
    const exportId = reportIdentifier(exportIdValue);
    if (!exportId) {
      return invalid("未綁變體 Excel 快照資訊無效，請重新掃描。");
    }
    let snapshot: UnboundVariationAuditSnapshot;
    try {
      snapshot = await this.snapshots.read({
        snapshotId: exportId,
        marketplaceId,
      });
    } catch (error) {
      if (error instanceof SpExecutionContextError) {
        return invalid(
          error.code === "ACCOUNT_SCOPE_CHANGED"
            ? "Amazon 帳號範圍已改變，舊未綁變體快照不可匯出。"
            : error.message,
          409,
          error.code,
        );
      }
      if (error instanceof SpApiError && error.code === "SNAPSHOT_EXPIRED") {
        return invalid(error.message, 410, "SNAPSHOT_EXPIRED");
      }
      return routeError(
        error,
        "建立未綁變體健檢 Excel 時發生未預期的錯誤。",
      );
    }

    try {
      const marketplace = marketplaceById(marketplaceId);
      if (!marketplace) {
        throw new Error("Unbound variation audit marketplace is invalid.");
      }
      const workbook = this.createWorkbook({
        marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
        fetchedAt: snapshot.fetchedAt,
        rows: snapshot.rows,
        incompleteRows: snapshot.incompleteRows,
        allVariationRows: snapshot.allVariationRows,
      });
      const date = snapshot.fetchedAt.slice(0, 10);
      const filename =
        `amazon-fba-unbound-variation-audit-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
      const localizedFilename =
        `FBA-未綁變體健檢-${marketplace.shortLabel}-${date}.xlsx`;
      return bytes(workbook, {
        "content-disposition":
          `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(localizedFilename)}`,
        "x-exported-unbound-fba-sku-count": String(snapshot.rows.length),
        "x-exported-incomplete-sku-count": String(
          snapshot.incompleteRows.length,
        ),
      });
    } catch (error) {
      return routeError(
        error,
        "建立未綁變體健檢 Excel 時發生未預期的錯誤。",
      );
    }
  }

  private async captureAndPublish(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
    retentionMs?: number;
    expectedLifecycleRevision?: number;
  }>): Promise<CapturedUnboundVariationAudit> {
    const revision = input.expectedLifecycleRevision ?? this.lifecycleRevision;
    const control = new AbortController();
    const unlinkCaller = forwardAbort(control, input.signal);
    this.controls.add(control);
    let context: SpExecutionContext | null = null;
    try {
      throwIfAborted(control.signal);
      context = await this.executionContext(
        input.marketplaceId,
        input.expectedContext,
      );
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      const snapshot = await this.source.read({
        marketplaceId: input.marketplaceId,
        reportId: input.reportId,
        documentId: input.documentId,
        signal: control.signal,
        expectedContext: context,
      });
      throwIfAborted(control.signal);
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      this.assertSnapshotIdentity(snapshot, context);
      const stableSnapshot = structuredClone(snapshot);
      const exportId = this.snapshots.publish({
        context,
        marketplaceId: input.marketplaceId,
        snapshot: stableSnapshot,
        ttlMs: input.retentionMs,
      });
      return { exportId, snapshot: stableSnapshot };
    } catch (error) {
      if (error instanceof SpExecutionContextError) throw error;
      if (context) await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      throw error;
    } finally {
      unlinkCaller();
      this.controls.delete(control);
    }
  }

  private async executionContext(
    marketplaceId: MarketplaceId,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    if (!expected) return this.context.capture(marketplaceId);
    if (expected.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    await this.context.assertCurrent(expected);
    return expected;
  }

  private assertSnapshotIdentity(
    snapshot: UnboundVariationAuditSnapshot,
    context: SpExecutionContext,
  ): void {
    if (snapshot.marketplaceId !== context.marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    if (snapshot.mode !== context.mode) {
      throw new SpExecutionContextError(
        "REPORT_MODE_CHANGED",
        "App 展示／真實模式已改變；本次操作已停止。",
      );
    }
  }

  private assertLifecycleCurrent(expected: number): void {
    if (this.lifecycleRevision === expected) return;
    throw contextInvalidated();
  }
}
