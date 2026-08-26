import type { ApiRequest, ApiResponse } from "../../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  forwardAbort,
  throwIfAborted,
} from "../abort-utils";
import { integer, parseMarketplace, reportIdentifier } from
  "../route-input";
import { invalid, json, routeError } from "../route-response";
import { ContextBoundAuditSnapshotStore } from
  "./context-bound-audit-snapshot";
import type { AuditSuiteContext } from "./audit-suite-context";
import type {
  AuditSuiteRunControl,
  AuditSuiteSectionRunners,
} from "./audit-suite-coordinator";
import {
  ReplenishmentAuditError,
  subscriptionAuditDiscountBucket,
  type FbaSubscriptionAuditHistorySnapshot,
} from "./replenishment-audit";
import {
  publicSpApiError,
  SpApiError,
} from "./sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";
import {
  createSubscriptionAuditWorkbook,
  type CreateSubscriptionAuditWorkbookInput,
} from "./subscription-audit-xlsx";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const SUBSCRIPTION_AUDIT_DIRECT_TTL_MS = 10 * 60 * 1_000;
export const SUBSCRIPTION_AUDIT_STANDALONE_TTL_MS = 30 * 60 * 1_000;

export type SubscriptionAuditMonths = 6 | 12 | 23;

export type SubscriptionAuditSnapshot = Omit<
  FbaSubscriptionAuditHistorySnapshot,
  "marketplaceId"
> & Readonly<{
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  requestedMonths: number;
  fetchedAt: string;
  inventoryEvidence: Readonly<{
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION";
    coverage: "complete" | "partial";
    returnedInventoryRows: number;
    provenSkuCount: number;
    unrecognizedSellerSkuRows: number;
    verifiableReplenishmentOfferCount: number;
    unverifiedFbaSkuCount: number;
  }>;
  notice: string;
}>;

export type SubscriptionAuditSnapshotReader = (
  input: Readonly<{
    marketplaceId: MarketplaceId;
    months: SubscriptionAuditMonths;
    signal?: AbortSignal;
    expectedContext: SpExecutionContext;
  }>,
) => Promise<SubscriptionAuditSnapshot>;

export type SubscriptionAuditStandaloneInput = Readonly<{
  marketplaceId: MarketplaceId;
  months?: SubscriptionAuditMonths;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>;

type SubscriptionAuditPublicOffer = Omit<
  SubscriptionAuditSnapshot["offers"][number],
  "monthlySeries"
> & Readonly<{
  monthlySeries: ReadonlyArray<Readonly<{
    month: string;
    subscriptionRevenue: number | null;
    shippedSubscriptionUnits: number | null;
    activeSubscriptionsAtPeriodEnd: number | null;
    currencyCode: string | null;
  }>>;
}>;

export type SubscriptionAuditPublicSnapshot = Omit<
  SubscriptionAuditSnapshot,
  "offers"
> & Readonly<{
  offers: ReadonlyArray<SubscriptionAuditPublicOffer>;
  exportId: string;
}>;

export interface SubscriptionAuditOwnerPort {
  read(request: ApiRequest): Promise<ApiResponse>;
  download(request: ApiRequest): Promise<ApiResponse>;
  runStandalone(
    input: SubscriptionAuditStandaloneInput,
  ): Promise<SubscriptionAuditPublicSnapshot>;
  runAuditSuite: AuditSuiteSectionRunners["subscription"];
  clear(): void;
}

type SubscriptionAuditOwnerInput = Readonly<{
  context: SpExecutionContextAdapter;
  readSnapshot: SubscriptionAuditSnapshotReader;
  createWorkbook?: (
    input: CreateSubscriptionAuditWorkbookInput,
  ) => Uint8Array;
  directTtlMs?: number;
  standaloneTtlMs?: number;
  now?: () => number;
  createId?: () => string;
}>;

type CapturedSubscriptionAudit = Readonly<{
  exportId: string;
  snapshot: SubscriptionAuditSnapshot;
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
  snapshot: SubscriptionAuditSnapshot,
  exportId: string,
): SubscriptionAuditPublicSnapshot {
  const stable = structuredClone(snapshot);
  return {
    ...stable,
    offers: stable.offers.map((offer) => ({
      ...offer,
      monthlySeries: offer.monthlySeries.map((metric) => ({
        month: metric.interval.month,
        subscriptionRevenue: metric.subscriptionRevenue,
        shippedSubscriptionUnits: metric.shippedSubscriptionUnits,
        activeSubscriptionsAtPeriodEnd: metric.activeSubscriptionsAtPeriodEnd,
        currencyCode: metric.currencyCode,
      })),
    })),
    exportId,
  };
}

function replenishmentStatus(code: ReplenishmentAuditError["code"]): number {
  if (code === "MARKETPLACE_UNSUPPORTED" || code === "REQUEST_INVALID") {
    return 422;
  }
  if (code === "PAGINATION_CHANGED" || code === "DUPLICATE_SKU") return 409;
  return 502;
}

function subscriptionRouteError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof ReplenishmentAuditError) {
    const publicError = publicSpApiError(new SpApiError(error.message, {
      status: replenishmentStatus(error.code),
      code: `REPLENISHMENT_${error.code}`,
    }), fallback);
    return json(
      { code: publicError.code, message: publicError.message },
      publicError.status,
    );
  }
  return routeError(error, fallback);
}

function buildAuditSuiteRows(snapshot: SubscriptionAuditSnapshot) {
  const problemsBySku = new Map(
    snapshot.upstreamCoverage.problemSkuRows.map((problem) => {
      if (problem.fbaEvidence !== "CURRENT_FBA_SKU_SET") {
        throw new Error("訂閱問題 SKU 缺少同次 CURRENT_FBA 證據。");
      }
      return [problem.sellerSku, problem] as const;
    }),
  );
  const emittedSkus = new Set<string>();
  const offerRows = snapshot.offers.map((offer) => {
    emittedSkus.add(offer.sellerSku);
    const problem = problemsBySku.get(offer.sellerSku);
    const bucket = subscriptionAuditDiscountBucket(
      offer.sellerFundedBaseDiscount,
    );
    const anomaly = problem
      ? `上游問題：${problem.problem}`
      : offer.sellerFundedBaseDiscount === null
        ? "Amazon 未回傳 Seller 基礎折扣"
        : bucket === null
          ? `非標準 Seller 基礎折扣 ${offer.sellerFundedBaseDiscount}%`
          : `${bucket}% Seller 基礎折扣組`;
    return {
      sellerSku: offer.sellerSku,
      title: "",
      asin: offer.asin,
      anomaly,
      sellerFundedBaseDiscountPercent: offer.sellerFundedBaseDiscount,
      currentActiveSubscriptions: offer.currentActiveSubscriptions,
      currentPrice: offer.price.amount,
      notice: problem
        ? "此 exact SKU 具同次 CURRENT_FBA 證據；問題列已隔離，對應月份未補 0 或重複加總。"
        : snapshot.notice,
    };
  });
  const excludedRows = snapshot.excluded.flatMap((row) => {
    if (row.reason === "FBA_NOT_PROVEN") return [];
    if (row.fbaEvidence !== "CURRENT_FBA_SKU_SET") {
      throw new Error("訂閱未納入 SKU 缺少同次 CURRENT_FBA 證據。");
    }
    if (problemsBySku.has(row.sellerSku) || emittedSkus.has(row.sellerSku)) {
      return [];
    }
    emittedSkus.add(row.sellerSku);
    return [{
      sellerSku: row.sellerSku,
      title: "",
      asin: "",
      anomaly: `未納入：${row.reason}`,
      sellerFundedBaseDiscountPercent: null,
      currentActiveSubscriptions: null,
      currentPrice: null,
      notice: "此 exact SKU 具同次 CURRENT_FBA 證據，但訂閱 offer／metric identity 無法安全合併。",
    }];
  });
  const problemOnlyRows = snapshot.upstreamCoverage.problemSkuRows.flatMap(
    (problem) => {
      if (emittedSkus.has(problem.sellerSku)) return [];
      emittedSkus.add(problem.sellerSku);
      return [{
        sellerSku: problem.sellerSku,
        title: "",
        asin: "",
        anomaly: `上游問題：${problem.problem}`,
        sellerFundedBaseDiscountPercent: null,
        currentActiveSubscriptions: null,
        currentPrice: null,
        notice: "此 exact SKU 具同次 CURRENT_FBA 證據；問題 offer 已排除，其他商品仍已完成。",
      }];
    },
  );
  return [...offerRows, ...excludedRows, ...problemOnlyRows];
}

/**
 * Complete main-only owner of the short-lived Subscribe & Save audit snapshot.
 * Direct and standalone reads share one capture/publish path, and downloads can
 * only use the resulting context-bound opaque capability.
 */
export class SubscriptionAuditOwner implements SubscriptionAuditOwnerPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly readSnapshot: SubscriptionAuditSnapshotReader;
  private readonly createWorkbook: (
    input: CreateSubscriptionAuditWorkbookInput,
  ) => Uint8Array;
  private readonly standaloneTtlMs: number;
  private readonly snapshots: ContextBoundAuditSnapshotStore<
    SubscriptionAuditSnapshot
  >;
  private readonly controls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: SubscriptionAuditOwnerInput) {
    this.context = input.context;
    this.readSnapshot = input.readSnapshot;
    this.createWorkbook = input.createWorkbook ?? createSubscriptionAuditWorkbook;
    this.standaloneTtlMs = input.standaloneTtlMs ??
      SUBSCRIPTION_AUDIT_STANDALONE_TTL_MS;
    if (!Number.isSafeInteger(this.standaloneTtlMs) || this.standaloneTtlMs < 1) {
      throw new Error("Subscription audit retention must be a positive integer.");
    }
    this.snapshots = new ContextBoundAuditSnapshotStore({
      context: input.context,
      ttlMs: input.directTtlMs ?? SUBSCRIPTION_AUDIT_DIRECT_TTL_MS,
      now: input.now,
      createId: input.createId,
      expiredMessage:
        "Subscribe & Save 健檢快照已過期或站點不符，請重新同步。",
    });
  }

  clear(): void {
    this.lifecycleRevision += 1;
    const reason = contextInvalidated();
    for (const control of this.controls) control.abort(reason);
    this.controls.clear();
    this.snapshots.clear();
  }

  async read(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const requestedMonths = integer(request.query.months, 6, 1, 23);
    const months = requestedMonths !== null &&
        (requestedMonths === 6 || requestedMonths === 12 || requestedMonths === 23)
      ? requestedMonths
      : null;
    if (!marketplaceId || months === null) {
      return invalid(
        "請選擇支援的站點；月度歷史只能選最近 6、12 或 23 個完整月份。",
      );
    }
    try {
      const captured = await this.captureAndPublish({ marketplaceId, months });
      return json(publicSnapshot(captured.snapshot, captured.exportId));
    } catch (error) {
      return subscriptionRouteError(
        error,
        "載入全站 FBA Subscribe & Save 健檢時發生未預期的錯誤。",
      );
    }
  }

  async download(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const snapshotId = reportIdentifier(
      request.query.exportId ?? request.query.snapshotId,
    );
    if (!marketplaceId || !snapshotId) {
      return invalid("Subscribe & Save 匯出資訊無效，請重新執行健檢。");
    }

    let snapshot: SubscriptionAuditSnapshot;
    try {
      snapshot = await this.snapshots.read({ snapshotId, marketplaceId });
    } catch (error) {
      if (error instanceof SpExecutionContextError) {
        return invalid(
          error.code === "ACCOUNT_SCOPE_CHANGED"
            ? "Amazon 帳號範圍已改變，舊健檢快照不可匯出。"
            : error.message,
          409,
          error.code,
        );
      }
      if (error instanceof SpApiError && error.code === "SNAPSHOT_EXPIRED") {
        return invalid(error.message, 410, "SNAPSHOT_EXPIRED");
      }
      return subscriptionRouteError(
        error,
        "建立 Subscribe & Save 健檢 Excel 時發生未預期的錯誤。",
      );
    }

    const metricMonths = snapshot.intervals.map((interval) => interval.month);
    if (!metricMonths.length) {
      return invalid(
        "健檢快照缺少官方完整月份，請重新同步。",
        409,
        "SNAPSHOT_INVALID",
      );
    }
    const problems = snapshot.offers.map((offer) => {
      const rawDiscount = offer.sellerFundedBaseDiscount;
      const exactBucket = subscriptionAuditDiscountBucket(rawDiscount);
      return {
        bucket: exactBucket,
        problem: rawDiscount === null
          ? "Amazon 未回傳 Seller 基礎折扣；只列入問題 SKU，並非 0%。"
          : exactBucket === null
            ? `Amazon 回傳非標準 Seller 基礎折扣 ${rawDiscount}%；只列入問題 SKU。`
            : `${exactBucket}% Seller 基礎折扣組`,
        sellerSku: offer.sellerSku,
        asin: offer.asin,
        currentPrice: offer.price.amount,
        currencyCode: offer.price.currencyCode,
        sellerFundedBaseDiscount: offer.sellerFundedBaseDiscount,
        sellerFundedTieredDiscount: offer.sellerFundedTieredDiscount,
        currentActiveSubscriptions: offer.currentActiveSubscriptions,
        monthlySeries: offer.monthlySeries.map((metric) => ({
          month: metric.interval.month,
          revenueCurrencyCode: metric.currencyCode,
          subscriptionRevenue: metric.subscriptionRevenue,
          shippedSubscriptionUnits: metric.shippedSubscriptionUnits,
          activeSubscriptionsAtPeriodEnd: metric.activeSubscriptionsAtPeriodEnd,
        })),
        forecastDeliveries: offer.forecastDeliveries,
        fbaEvidence: offer.fbaEvidence,
      };
    });

    try {
      const marketplace = marketplaceById(marketplaceId);
      if (!marketplace) throw new Error("Subscription audit marketplace is invalid.");
      const workbook = this.createWorkbook({
        marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
        generatedAt: snapshot.fetchedAt,
        metricMonths,
        currentActiveSubscriptions: snapshot.summary.currentActiveSubscriptions,
        provenSubscriptionRevenue: snapshot.summary.provenSubscriptionRevenue,
        revenueCurrencyCode: snapshot.summary.revenueCurrencyCode,
        revenueCoverage: snapshot.summary.revenueCoverage,
        inventoryEvidence: snapshot.inventoryEvidence,
        upstreamCoverage: snapshot.upstreamCoverage,
        excluded: snapshot.excluded.flatMap((row) =>
          row.reason === "FBA_NOT_PROVEN" ? [] : [{
            sellerSku: row.sellerSku,
            fbaEvidence: row.fbaEvidence,
            reason: row.reason,
          }]),
        problems,
      });
      const filename =
        `amazon-fba-subscribe-save-audit-${marketplace.shortLabel.toLowerCase()}-${snapshot.fetchedAt.slice(0, 10)}.xlsx`;
      return bytes(workbook, {
        "content-disposition": `attachment; filename="${filename}"`,
        "x-exported-fba-offer-count": String(snapshot.offers.length),
        "x-subscription-audit-months": String(snapshot.requestedMonths),
      });
    } catch (error) {
      return subscriptionRouteError(
        error,
        "建立 Subscribe & Save 健檢 Excel 時發生未預期的錯誤。",
      );
    }
  }

  async runStandalone(
    input: SubscriptionAuditStandaloneInput,
  ): Promise<SubscriptionAuditPublicSnapshot> {
    const months = input.months ?? 6;
    const captured = await this.captureAndPublish({
      marketplaceId: input.marketplaceId,
      months,
      signal: input.signal,
      expectedContext: input.expectedContext,
      retentionMs: this.standaloneTtlMs,
    });
    return publicSnapshot(captured.snapshot, captured.exportId);
  }

  async runAuditSuite(
    bound: AuditSuiteContext,
    parentControl: AuditSuiteRunControl,
  ): ReturnType<AuditSuiteSectionRunners["subscription"]> {
    const marketplace = marketplaceById(bound.marketplaceId);
    if (!marketplace) throw contextInvalidated();
    const revision = this.lifecycleRevision;
    const control = new AbortController();
    const unlinkCaller = forwardAbort(control, parentControl.signal);
    this.controls.add(control);
    let context: SpExecutionContext | null = null;
    try {
      throwIfAborted(control.signal);
      context = await this.context.capture(marketplace.id);
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      this.assertAuditSuiteContext(bound, context);
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      this.assertAuditSuiteContext(bound, context);
      const snapshot = await this.readSnapshot({
        marketplaceId: marketplace.id,
        months: 6,
        signal: control.signal,
        expectedContext: context,
      });
      throwIfAborted(control.signal);
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      this.assertAuditSuiteContext(bound, context);
      this.assertSnapshotIdentity(snapshot, context, 6);
      const partial = snapshot.inventoryEvidence.coverage !== "complete" ||
        snapshot.upstreamCoverage.status !== "complete" ||
        snapshot.summary.revenueCoverage.status !== "complete";
      return {
        ...bound,
        status: partial ? "partial" : "completed",
        fetchedAt: snapshot.fetchedAt,
        notice: partial
          ? `訂閱資料範圍未完整。${snapshot.notice}`
          : snapshot.notice,
        payload: buildAuditSuiteRows(snapshot),
      };
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

  private async captureAndPublish(input: Readonly<{
    marketplaceId: MarketplaceId;
    months: SubscriptionAuditMonths;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
    retentionMs?: number;
  }>): Promise<CapturedSubscriptionAudit> {
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
      const snapshot = await this.readSnapshot({
        marketplaceId: input.marketplaceId,
        months: input.months,
        signal: control.signal,
        expectedContext: context,
      });
      throwIfAborted(control.signal);
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      this.assertSnapshotIdentity(snapshot, context, input.months);
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
    snapshot: SubscriptionAuditSnapshot,
    context: SpExecutionContext,
    months: SubscriptionAuditMonths,
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
    if (snapshot.requestedMonths !== months) {
      throw new SpApiError("Subscribe & Save 健檢月份與固定選擇不一致。", {
        status: 409,
        code: "SNAPSHOT_INVALID",
      });
    }
  }

  private assertAuditSuiteContext(
    bound: AuditSuiteContext,
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

  private assertLifecycleCurrent(expected: number): void {
    if (this.lifecycleRevision === expected) return;
    throw contextInvalidated();
  }
}
