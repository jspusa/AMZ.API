import { createHash, randomUUID } from "node:crypto";
import type {
  AdvertisingConnectionTestResult,
  ApiRequest,
  ApiResponse,
} from "../shared/contracts";
import {
  AdvertisingApiError,
  type AdvertisingGateway,
} from "./amazon/ads-api";
import {
  auditAdvertisingCoverage,
  AdvertisingCoverageInputError,
  prepareAdvertisingCoverageListings,
  type AdvertisingCoverageCampaign,
} from "./amazon/advertising-coverage";
import {
  publicSpApiError,
  SpApiError,
} from "./amazon/sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import {
  bodyRecord,
  optionalDate,
  parseMarketplace,
  parseSellerSku,
  reportIdentifier,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  MARKETPLACES as MARKETPLACE_METADATA,
  type MarketplaceId,
} from "../shared/marketplaces";
import {
  abortableDelay,
  throwIfAborted as assertBackgroundActive,
} from "./abort-utils";
import type {
  AdvertisingCoverageAuditRow,
  ValidatedAuditSuiteSnapshot,
} from "./amazon/audit-suite-xlsx";
import type { AuditSuiteContext } from "./amazon/audit-suite-context";
import type {
  AuditSuiteRunControl,
  AuditSuiteSectionRunners,
} from "./amazon/audit-suite-coordinator";
import type { StandaloneAuditJobGateway } from
  "./amazon/standalone-audit-job";
import type { ListingsExportPort } from "./amazon/listings-export";
import type { FbaCatalogReports } from "./amazon/fba-catalog-reports";
import type {
  FbaCatalogExport,
  FbaCatalogIdentitySnapshot as FbaListingIdentitySnapshot,
} from "./amazon/catalog-report-reads";
import type {
  SalesAndTrafficReports,
} from "./amazon/sales-and-traffic-reports";
import type {
  SalesAndTrafficSnapshot,
} from "./amazon/sales-and-traffic-reads";
import {
  planCompletedSalesAndTrafficWindow,
} from "./amazon/revenue-report-windows";
import {
  buildAdvertisingStrategySnapshot,
  type AdvertisingStrategySnapshot,
} from "./amazon/advertising-strategy";
import type {
  DurableReportStatus,
} from "./amazon/report-lifecycle";
import type {
  AdvertisedProductAccountBinding,
  AdvertisedProductReportData,
  FixedReportBroker,
} from "./amazon/report-broker";

type AdvertisingStrategyReportGateway = AdvertisingGateway & Required<Pick<
  AdvertisingGateway,
  | "getCombinedAccountIdentity"
  | "createSponsoredProductsAdvertisedProductReport"
  | "getSponsoredProductsAdvertisedProductReportStatus"
  | "downloadSponsoredProductsAdvertisedProductReport"
>>;

export type AdvertisingStrategySourceGateway = {
  fbaListings(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<FbaListingIdentitySnapshot>;
};

type AdvertisingStrategyProgress = Readonly<{
  phase: "fba" | "sales" | "ads" | "building";
  completed: number;
  total: 4;
}>;

type AdvertisingStrategyJobState = "running" | "completed" | "failed";

type AdvertisingStrategyJob = {
  jobId: string;
  revision: number;
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  marketplaceCode: string;
  spAccountScope: string;
  adsReportBinding: AdvertisedProductAccountBinding;
  mode: "live" | "demo";
  startDate: string;
  endDate: string;
  state: AdvertisingStrategyJobState;
  progress: AdvertisingStrategyProgress;
  notice: string;
  errorCode: string | null;
  snapshot: AdvertisingStrategySnapshot | null;
  controller: AbortController;
  expiresAt: number;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  flight: Promise<void> | null;
};

const MARKETPLACE_CODES = Object.fromEntries(
  MARKETPLACE_METADATA.map((marketplace) => [
    marketplace.id,
    marketplace.code === "UK" ? "GB" : marketplace.code,
  ]),
) as Record<MarketplaceId, string>;

const MARKETPLACE_CURRENCIES = Object.fromEntries(
  MARKETPLACE_METADATA.map((marketplace) => [
    marketplace.id,
    marketplace.currency,
  ]),
) as Record<MarketplaceId, string>;

const ADVERTISING_STRATEGY_REPORT_WAIT_MS =
  3 * 60 * 60 * 1_000 + 5 * 60 * 1_000;
const ADVERTISING_STRATEGY_ACTIVE_TTL_MS =
  3 * 60 * 60 * 1_000 + 30 * 60 * 1_000;
const ADVERTISING_STRATEGY_TERMINAL_TTL_MS = 30 * 60 * 1_000;
const ADVERTISING_STRATEGY_RETRY_TTL_MS = 35 * 60 * 1_000;

function advertisingStrategyPollDelay(attempt: number): number {
  if (attempt < 30) return 2_000;
  if (attempt < 90) return 5_000;
  return 15_000;
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertAuditSuiteActive(control: AuditSuiteRunControl): void {
  assertBackgroundActive(control.signal);
}

function suiteSnapshot<TPayload>(input: {
  context: AuditSuiteContext;
  status: "completed" | "partial";
  fetchedAt: string;
  notice: string;
  payload: TPayload;
}): ValidatedAuditSuiteSnapshot<TPayload> {
  return {
    ...input.context,
    status: input.status,
    fetchedAt: input.fetchedAt,
    notice: input.notice,
    payload: input.payload,
  };
}

function publicRouterError(
  error: Readonly<{
    message: string;
    status: number;
    code: string;
    requestId?: string | null;
    retryAfter?: string | null;
  }>,
  fallback: string,
) {
  return publicSpApiError(new SpApiError(error.message, {
    status: error.status,
    code: error.code,
    requestId: error.requestId ?? null,
    retryAfter: error.retryAfter ?? null,
  }), fallback);
}

function advertisingApiError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof SpApiError) return routeError(error, fallback);
  if (error instanceof AdvertisingApiError) {
    const publicError = publicRouterError(error, fallback);
    return json({
      code: publicError.code,
      message: publicError.message,
      requestId: publicError.requestId,
    }, publicError.status);
  }
  if (error instanceof AdvertisingCoverageInputError) {
    const publicError = publicRouterError({
      status: 422,
      code: error.code,
      message: error.message,
    }, fallback);
    return json({
      code: publicError.code,
      message: publicError.message,
    }, publicError.status);
  }
  return json({ code: "INTERNAL_ERROR", message: fallback }, 500);
}

function isContextFenceError(error: unknown): error is SpApiError {
  return error instanceof SpApiError && [
    "ACCOUNT_SCOPE_CHANGED",
    "REPORT_MODE_CHANGED",
    "SP_CONTEXT_INVALIDATED",
  ].includes(error.code);
}

type AdvertisingAuditSuiteSource = Readonly<{
  fetchedAt: string;
  rows: readonly Readonly<{
    sellerSku: string;
    asin: string;
    title: string;
    readStatus: "complete" | "incomplete";
    readErrors: readonly Readonly<{ message: string }>[];
  }>[];
  errors: readonly Readonly<{
    sellerSku: string;
    kind: string;
    message: string;
  }>[];
}>;

export function buildAdvertisingAuditSuiteResult(input: {
  marketplaceId: MarketplaceId;
  marketplaceCode: string;
  source: AdvertisingAuditSuiteSource;
  campaigns: AdvertisingCoverageCampaign[];
}): Readonly<{
  status: "completed" | "partial";
  fetchedAt: string;
  notice: string;
  payload: readonly AdvertisingCoverageAuditRow[];
}> {
  const errorsBySku = new Map<string, string[]>();
  for (const error of input.source.errors) {
    if (!parseSellerSku(error.sellerSku)) {
      throw new Error("廣告覆蓋的 FBA 商品錯誤缺少可核對 Seller SKU；此 section 已停止。");
    }
    const messages = errorsBySku.get(error.sellerSku) ?? [];
    messages.push(`${error.kind}：${error.message}`);
    errorsBySku.set(error.sellerSku, messages);
  }
  const verifiableRows = input.source.rows.filter((row) =>
    /^[A-Z0-9]{10}$/u.test(row.asin) &&
    row.readStatus === "complete" &&
    !errorsBySku.has(row.sellerSku),
  );
  const incompleteBySku = new Map<string, AdvertisingCoverageAuditRow>(input.source.rows
    .filter((row) => !verifiableRows.includes(row))
    .map((row) => [row.sellerSku, {
      sellerSku: row.sellerSku,
      title: row.title,
      asin: row.asin,
      finding: "未完成",
      evidence: [
        ...row.readErrors.map((error) => error.message),
        ...(errorsBySku.get(row.sellerSku) ?? []),
      ].join("；") || "FBA 商品 ASIN／內容證據未完整。",
      notice: "FBA 商品證據未完整，不判定為未覆蓋。",
    }] as const));
  for (const [sellerSku, messages] of errorsBySku) {
    if (incompleteBySku.has(sellerSku)) continue;
    incompleteBySku.set(sellerSku, {
      sellerSku,
      title: "",
      asin: "",
      finding: "未完成",
      evidence: messages.join("；"),
      notice: "FBA 商品資料錯誤未能對應完整 listing；不判定為未覆蓋。",
    });
  }
  const audit = auditAdvertisingCoverage({
    mode: "live",
    marketplaceId: input.marketplaceId,
    marketplaceCode: input.marketplaceCode,
    listings: verifiableRows.map((row) => ({
      sellerSku: row.sellerSku,
      asin: row.asin,
      title: row.title,
    })),
    campaigns: input.campaigns,
    fetchedAt: input.source.fetchedAt,
  });
  const incompleteRows = [...incompleteBySku.values()];
  return {
    status: incompleteRows.length ? "partial" : "completed",
    fetchedAt: audit.fetchedAt,
    notice: incompleteRows.length
      ? `${incompleteRows.length} 個 FBA SKU 無法安全判定廣告覆蓋；未當成 0。${audit.notice}`
      : audit.notice,
    payload: [
      ...audit.rows.map((row) => ({
        sellerSku: row.sellerSku,
        title: row.title,
        asin: row.asin,
        finding: row.covered ? "已有廣告覆蓋" : "未找到廣告覆蓋",
        evidence: row.evidence
          ? `${row.evidence.kind === "seller-sku" ? "同 SKU" : "同 ASIN"}：${row.evidence.campaignName}`
          : "沒有符合 ProductAI 命名與站點規則的 ENABLED SP 活動",
        notice: audit.rule,
      })),
      ...incompleteRows,
    ],
  };
}

export type AdvertisingAuditSuiteListingsLoader = (
  context: AuditSuiteContext,
  control: AuditSuiteRunControl,
) => Promise<Readonly<{ data: FbaCatalogExport }>>;

export interface AdvertisingCoordinatorPort {
  status(request: ApiRequest): Promise<ApiResponse>;
  coverage(request: ApiRequest): Promise<ApiResponse>;
  startStrategy(request: ApiRequest): Promise<ApiResponse>;
  observeStrategy(request: ApiRequest): Promise<ApiResponse>;
  runStandalone: StandaloneAuditJobGateway["run"];
  runAuditSuite: AuditSuiteSectionRunners["advertising"];
  clear(): void;
}

export type AdvertisingCoordinatorDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  advertising: AdvertisingGateway | null;
  reports: Pick<
    FixedReportBroker,
    | "bindAdvertisedProductAccount"
    | "assertAdvertisedProductBinding"
    | "startAdvertisedProduct"
    | "statusAdvertisedProduct"
    | "readAdvertisedProductData"
  >;
  catalog: Pick<
    FbaCatalogReports,
    "begin" | "status" | "read" | "readExistingExport"
  >;
  salesAndTraffic: Pick<
    SalesAndTrafficReports,
    "begin" | "status" | "read"
  >;
  listingsExport: Pick<ListingsExportPort, "runStandalone">;
  loadAuditSuiteListings: AdvertisingAuditSuiteListingsLoader;
  strategySources?: Partial<AdvertisingStrategySourceGateway>;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  createId?: () => string;
  now?: () => number;
}>;

export class ReadOnlyAdvertisingCoordinator
  implements AdvertisingCoordinatorPort {
  private readonly spExecutionContext: SpExecutionContextAdapter;
  private readonly advertising: AdvertisingGateway | null;
  private readonly reportBroker: AdvertisingCoordinatorDependencies["reports"];
  private readonly fbaCatalogReports: AdvertisingCoordinatorDependencies["catalog"];
  private readonly salesAndTraffic: AdvertisingCoordinatorDependencies["salesAndTraffic"];
  private readonly listingsExportOwner: AdvertisingCoordinatorDependencies["listingsExport"];
  private readonly loadAuditSuiteListings: AdvertisingAuditSuiteListingsLoader;
  private readonly advertisingStrategySources: AdvertisingStrategySourceGateway;
  private readonly advertisingStrategyWait:
    (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly advertisingStrategyJobs = new Map<
    string,
    AdvertisingStrategyJob
  >();
  private readonly advertisingStrategySelections = new Map<string, string>();
  private readonly operationControllers = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: AdvertisingCoordinatorDependencies) {
    this.spExecutionContext = input.context;
    this.advertising = input.advertising;
    this.reportBroker = input.reports;
    this.fbaCatalogReports = input.catalog;
    this.salesAndTraffic = input.salesAndTraffic;
    this.listingsExportOwner = input.listingsExport;
    this.loadAuditSuiteListings = input.loadAuditSuiteListings;
    this.advertisingStrategyWait = input.wait ?? abortableDelay;
    this.createId = input.createId ?? randomUUID;
    this.now = input.now ?? Date.now;
    this.advertisingStrategySources = {
      fbaListings: (request) => this.fbaCatalogReports.read({
        view: "identity",
        ...request,
      }) as Promise<FbaListingIdentitySnapshot>,
      ...input.strategySources,
    };
  }

  clear(): void {
    this.lifecycleRevision += 1;
    for (const controller of this.operationControllers) {
      controller.abort(new Error("Amazon Ads execution context changed."));
    }
    this.operationControllers.clear();
    for (const job of [...this.advertisingStrategyJobs.values()]) {
      job.controller.abort(new Error(
        "Amazon Ads execution context changed.",
      ));
      this.removeAdvertisingStrategyJob(job.jobId);
    }
    this.advertisingStrategySelections.clear();
    this.advertising?.invalidate();
  }

  async status(request: ApiRequest): Promise<ApiResponse> {
    const revision = this.lifecycleRevision;
    const controller = this.beginOperation();
    try {
      const response = await this.adsStatus(request, controller.signal);
      this.assertLifecycleRevision(revision);
      return response;
    } catch (error) {
      return this.publicOperationError(
        error,
        revision,
        "執行本機 Amazon 操作時發生未預期的錯誤。",
      );
    } finally {
      this.operationControllers.delete(controller);
    }
  }

  async coverage(request: ApiRequest): Promise<ApiResponse> {
    const revision = this.lifecycleRevision;
    const controller = this.beginOperation();
    try {
      const response = await this.adsCoverage(request, controller.signal);
      this.assertLifecycleRevision(revision);
      return response;
    } catch (error) {
      return this.publicOperationError(
        error,
        revision,
        "執行 Amazon Ads 覆蓋健檢時發生未預期錯誤。",
      );
    } finally {
      this.operationControllers.delete(controller);
    }
  }

  async startStrategy(request: ApiRequest): Promise<ApiResponse> {
    const revision = this.lifecycleRevision;
    const controller = this.beginOperation();
    try {
      const response = await this.startAdvertisingStrategy(
        request,
        controller.signal,
      );
      this.assertLifecycleRevision(revision);
      return response;
    } catch (error) {
      return this.publicOperationError(
        error,
        revision,
        "執行本機 Amazon 操作時發生未預期的錯誤。",
      );
    } finally {
      this.operationControllers.delete(controller);
    }
  }

  async observeStrategy(request: ApiRequest): Promise<ApiResponse> {
    const revision = this.lifecycleRevision;
    const controller = this.beginOperation();
    try {
      const response = await this.advertisingStrategyStatus(
        request,
        controller.signal,
      );
      this.assertLifecycleRevision(revision);
      return response;
    } catch (error) {
      return this.publicOperationError(
        error,
        revision,
        "執行本機 Amazon 操作時發生未預期的錯誤。",
      );
    } finally {
      this.operationControllers.delete(controller);
    }
  }

  async runStandalone(
    input: Parameters<StandaloneAuditJobGateway["run"]>[0],
  ): Promise<unknown> {
    const revision = this.lifecycleRevision;
    const controller = this.beginOperation();
    const unlink = this.linkOperationSignal(controller, input.signal);
    try {
      const result = await this.runStandaloneOwned({
        ...input,
        signal: controller.signal,
      });
      this.assertLifecycleRevision(revision);
      return result;
    } catch (error) {
      throw this.lifecycleDominantError(error, revision);
    } finally {
      unlink();
      this.operationControllers.delete(controller);
    }
  }

  private async runStandaloneOwned(
    input: Parameters<StandaloneAuditJobGateway["run"]>[0],
  ): Promise<unknown> {
    const revision = this.lifecycleRevision;
    if (input.kind !== "advertising") {
      throw new Error("唯讀 Amazon Ads coordinator 不支援這個單項健檢種類。");
    }
    const marketplaceId = parseMarketplace(input.context.marketplaceId);
    if (!marketplaceId) throw new Error("單項廣告健檢站點無效。");
    assertBackgroundActive(input.signal);
    const captured = await this.listingsExportOwner.runStandalone(input);
    this.assertLifecycleRevision(revision);
    input.updateProgress({
      stage: "listing_rows",
      message:
        `已取得 ${captured.snapshot.rows.length.toLocaleString()} 個 FBA 商品，正在執行健檢。`,
      completedUnits: 1,
      totalUnits: 1,
    });
    await this.assertStandaloneContext(
      input.context,
      captured.context,
      input.signal,
    );
    this.assertLifecycleRevision(revision);
    if (input.context.mode === "live" && !this.advertising) {
      throw new Error("Amazon Ads API 尚未連線。");
    }
    if (input.context.mode === "live") {
      const { value: summary } = await this.runContextBoundWork(
        captured.context,
        () => this.advertising!.getCredentialSummary(),
        input.signal,
      );
      this.assertLifecycleRevision(revision);
      await this.assertStandaloneContext(
        input.context,
        captured.context,
        input.signal,
      );
      this.assertLifecycleRevision(revision);
      if (!summary.configured) {
        throw new Error("Amazon Ads 憑證尚未完整設定。");
      }
    }
    const listings = prepareAdvertisingCoverageListings({
      rows: captured.snapshot.rows,
      errors: captured.snapshot.errors,
    });
    input.updateProgress({
      stage: "advertising",
      message: "正在核對 FBA 商品與啟用中的 Sponsored Products 活動。",
      completedUnits: 0,
      totalUnits: listings.length,
    });
    const campaigns: AdvertisingCoverageCampaign[] =
      input.context.mode === "demo"
        ? listings
            .filter((_, index) => index % 2 === 0)
            .map((row, index) => ({
              campaignId: `demo-productai-${index + 1}`,
              name:
                `[ProductAI] ${MARKETPLACE_CODES[marketplaceId]}-${row.asin}-${row.sellerSku}-SP-PAT-Aug92026`,
              state: "ENABLED",
              adProduct: "SPONSORED_PRODUCTS",
            }))
        : (await this.runContextBoundWork(
            captured.context,
            () => this.advertising!.listEnabledSponsoredProductCampaigns(
              marketplaceId,
              input.signal,
            ),
            input.signal,
          )).value;
    this.assertLifecycleRevision(revision);
    await this.assertStandaloneContext(
      input.context,
      captured.context,
      input.signal,
    );
    this.assertLifecycleRevision(revision);
    const snapshot = auditAdvertisingCoverage({
      mode: input.context.mode,
      marketplaceId,
      marketplaceCode: MARKETPLACE_CODES[marketplaceId],
      listings,
      campaigns,
    });
    input.updateProgress({
      stage: "complete",
      message: "Amazon Ads 覆蓋健檢完成。",
      completedUnits: listings.length,
      totalUnits: listings.length,
    });
    return snapshot;
  }

  async runAuditSuite(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): ReturnType<AuditSuiteSectionRunners["advertising"]> {
    const revision = this.lifecycleRevision;
    const controller = this.beginOperation();
    const unlink = this.linkOperationSignal(controller, control.signal);
    const ownedControl: AuditSuiteRunControl = {
      signal: controller.signal,
      heartbeat: (update) => control.heartbeat(update),
      resource: (key, load) => control.resource(key, load),
    };
    try {
      const result = await this.runAuditSuiteOwned(context, ownedControl);
      this.assertLifecycleRevision(revision);
      return result;
    } catch (error) {
      throw this.lifecycleDominantError(error, revision);
    } finally {
      unlink();
      this.operationControllers.delete(controller);
    }
  }

  private async runAuditSuiteOwned(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): ReturnType<AuditSuiteSectionRunners["advertising"]> {
    const revision = this.lifecycleRevision;
    const marketplaceId = parseMarketplace(context.marketplaceId);
    if (!marketplaceId) throw new Error("廣告覆蓋綜合健檢站點無效。");
    if (context.mode !== "live") {
      throw new Error(
        "廣告覆蓋需已驗證的真實 Amazon Ads 連線；綜合健檢不以 demo 活動冒充結果。",
      );
    }
    if (!this.advertising) {
      throw new Error(
        "Amazon Ads API 尚未連線；未用 demo 或 0 冒充廣告覆蓋。",
      );
    }
    assertAuditSuiteActive(control);
    const expectedContext = await this.assertAuditSuiteContext(context);
    this.assertLifecycleRevision(revision);
    assertAuditSuiteActive(control);
    const { value: summary } = await this.runContextBoundWork(
      expectedContext,
      () => this.advertising!.getCredentialSummary(),
      control.signal,
    );
    this.assertLifecycleRevision(revision);
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context, expectedContext);
    this.assertLifecycleRevision(revision);
    if (!summary.configured) {
      throw new Error("Amazon Ads 憑證尚未完整設定；廣告覆蓋未執行。");
    }
    const listing = await this.loadAuditSuiteListings(context, control);
    this.assertLifecycleRevision(revision);
    assertAuditSuiteActive(control);
    const campaigns =
      (await this.runContextBoundWork(
        expectedContext,
        () => this.advertising!.listEnabledSponsoredProductCampaigns(
          marketplaceId,
          control.signal,
        ),
        control.signal,
      )).value;
    this.assertLifecycleRevision(revision);
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context, expectedContext);
    this.assertLifecycleRevision(revision);
    assertAuditSuiteActive(control);
    const result = buildAdvertisingAuditSuiteResult({
      marketplaceId,
      marketplaceCode: MARKETPLACE_CODES[marketplaceId],
      source: listing.data,
      campaigns,
    });
    return suiteSnapshot({ context, ...result });
  }

  private async assertStandaloneContext(
    bound: Parameters<StandaloneAuditJobGateway["run"]>[0]["context"],
    expected: SpExecutionContext,
    signal: AbortSignal,
  ): Promise<void> {
    assertBackgroundActive(signal);
    await this.spExecutionContext.assertCurrent(expected);
    assertBackgroundActive(signal);
    if (
      bound.marketplaceId !== expected.marketplaceId ||
      bound.accountScope !== expected.accountScope ||
      bound.mode !== expected.mode ||
      bound.generation !== expected.generation
    ) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；本次操作已停止。",
      );
    }
  }

  private async assertAuditSuiteContext(
    bound: AuditSuiteContext,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    const marketplaceId = parseMarketplace(bound.marketplaceId);
    if (!marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；本次操作已停止。",
      );
    }
    const current = expected ??
      await this.spExecutionContext.capture(marketplaceId);
    if (expected) await this.spExecutionContext.assertCurrent(expected);
    if (
      current.accountScope !== bound.accountScope ||
      current.mode !== bound.mode ||
      current.generation !== bound.generation
    ) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；本次操作已停止。",
      );
    }
    return current;
  }

  private assertLifecycleRevision(expected: number): void {
    if (expected === this.lifecycleRevision) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；本次操作已停止。",
    );
  }

  private beginOperation(): AbortController {
    const controller = new AbortController();
    this.operationControllers.add(controller);
    return controller;
  }

  private linkOperationSignal(
    controller: AbortController,
    parent: AbortSignal,
  ): () => void {
    const relay = () => {
      if (!controller.signal.aborted) controller.abort(parent.reason);
    };
    if (parent.aborted) {
      relay();
      return () => undefined;
    }
    parent.addEventListener("abort", relay, { once: true });
    return () => parent.removeEventListener("abort", relay);
  }

  private lifecycleDominantError(
    error: unknown,
    revision: number,
  ): unknown {
    if (isContextFenceError(error)) return error;
    try {
      this.assertLifecycleRevision(revision);
    } catch (contextError) {
      return contextError;
    }
    return error;
  }

  private publicOperationError(
    error: unknown,
    revision: number,
    fallback: string,
  ): ApiResponse {
    const dominant = this.lifecycleDominantError(error, revision);
    if (isContextFenceError(dominant) && revision === this.lifecycleRevision) {
      if (dominant instanceof SpExecutionContextError) throw dominant;
      throw new SpExecutionContextError(
        dominant.code as
          | "ACCOUNT_SCOPE_CHANGED"
          | "REPORT_MODE_CHANGED"
          | "SP_CONTEXT_INVALIDATED",
        dominant.message,
      );
    }
    return advertisingApiError(dominant, fallback);
  }

  private assertOwnedJob(job: AdvertisingStrategyJob): void {
    this.assertLifecycleRevision(job.revision);
    if (this.advertisingStrategyJobs.get(job.jobId) !== job) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；本次操作已停止。",
      );
    }
  }

  private async startAllListingsReport(
    marketplaceId: MarketplaceId,
    explicitRetry: boolean,
    signal?: AbortSignal,
    options: Readonly<{ freshCompleted?: boolean }> = {},
    expectedContext?: SpExecutionContext,
  ): Promise<DurableReportStatus> {
    return this.fbaCatalogReports.begin({
      purpose: "catalog",
      marketplaceId,
      explicitRetry,
      freshCompleted: options.freshCompleted,
      signal,
      expectedContext,
    });
  }

  private async getAllListingsReportStatus(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<DurableReportStatus> {
    return this.fbaCatalogReports.status(input);
  }

  private async runContextBoundWork<T>(
    context: SpExecutionContext,
    work: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<{ context: SpExecutionContext; value: T }> {
    assertBackgroundActive(signal);
    await this.spExecutionContext.assertCurrent(context);
    assertBackgroundActive(signal);
    try {
      const value = await work();
      await this.spExecutionContext.assertCurrent(context);
      assertBackgroundActive(signal);
      return { context, value };
    } catch (error) {
      if (isContextFenceError(error)) throw error;
      try {
        await this.spExecutionContext.assertCurrent(context);
      } catch (contextError) {
        throw contextError;
      }
      assertBackgroundActive(signal);
      throw error;
    }
  }

  private removeAdvertisingStrategyJob(jobId: string): void {
    const job = this.advertisingStrategyJobs.get(jobId);
    if (!job) return;
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    job.expiryTimer = null;
    this.advertisingStrategyJobs.delete(jobId);
    for (const [selection, selectedJobId] of this.advertisingStrategySelections) {
      if (selectedJobId === jobId) this.advertisingStrategySelections.delete(selection);
    }
  }

  private touchAdvertisingStrategyJob(job: AdvertisingStrategyJob): void {
    if (
      job.revision !== this.lifecycleRevision ||
      job.state !== "running" ||
      job.controller.signal.aborted ||
      this.advertisingStrategyJobs.get(job.jobId) !== job
    ) {
      return;
    }
    job.expiresAt = this.now() + ADVERTISING_STRATEGY_ACTIVE_TTL_MS;
  }

  private retainAdvertisingStrategyJob(
    job: AdvertisingStrategyJob,
    ttl = ADVERTISING_STRATEGY_TERMINAL_TTL_MS,
  ): void {
    if (
      job.revision !== this.lifecycleRevision ||
      this.advertisingStrategyJobs.get(job.jobId) !== job ||
      job.state === "running"
    ) {
      return;
    }
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    const expiresAt = this.now() + ttl;
    job.expiresAt = expiresAt;
    job.expiryTimer = setTimeout(() => {
      if (
        this.advertisingStrategyJobs.get(job.jobId) === job &&
        job.state !== "running" &&
        job.expiresAt === expiresAt &&
        job.expiresAt <= this.now()
      ) {
        this.removeAdvertisingStrategyJob(job.jobId);
      }
    }, ttl);
    job.expiryTimer.unref?.();
  }

  private pruneAdvertisingStrategyJobs(now = this.now()): void {
    for (const job of [...this.advertisingStrategyJobs.values()]) {
      if (job.expiresAt > now) continue;
      if (job.state === "running") {
        job.controller.abort(new Error("FBA 廣告策略背景工作超過安全保留時間。"));
        job.state = "failed";
        job.snapshot = null;
        job.notice = "FBA 廣告策略背景工作等待逾時；沒有建立、修改或啟用任何廣告。";
        job.errorCode = "STRATEGY_TIMEOUT";
        this.retainAdvertisingStrategyJob(job);
      } else {
        this.removeAdvertisingStrategyJob(job.jobId);
      }
    }
  }

  private advertisingStrategyReply(job: AdvertisingStrategyJob): ApiResponse {
    return json({
      schemaVersion: 1,
      jobId: job.jobId,
      marketplaceId: job.marketplaceId,
      marketplaceCode: job.marketplaceCode,
      dateRange: { startDate: job.startDate, endDate: job.endDate },
      state: job.state,
      progress: { ...job.progress },
      notice: job.notice,
      snapshot: job.snapshot ? structuredClone(job.snapshot) : null,
      errorCode: job.errorCode,
    }, job.state === "running" ? 202 : 200);
  }

  private advertisingStrategyGateway(): AdvertisingStrategyReportGateway {
    const gateway = this.advertising;
    if (
      !gateway?.getCombinedAccountIdentity ||
      !gateway.createSponsoredProductsAdvertisedProductReport ||
      !gateway.getSponsoredProductsAdvertisedProductReportStatus ||
      !gateway.downloadSponsoredProductsAdvertisedProductReport
    ) {
      throw new SpApiError(
        "目前 Notebook 鑰匙版本尚未提供 Sponsored Products 報表；更新後才可產生策略。",
        { status: 422, code: "ADS_STRATEGY_APP_UPDATE_REQUIRED" },
      );
    }
    return gateway as AdvertisingStrategyReportGateway;
  }

  private parseAdvertisingStrategyRange(input: {
    marketplaceId: MarketplaceId;
    startDate: unknown;
    endDate: unknown;
  }): { startDate: string; endDate: string } {
    return planCompletedSalesAndTrafficWindow({
      ...input,
      now: new Date(this.now()),
    });
  }

  private advertisedProductPlan(job: AdvertisingStrategyJob) {
    return {
      intent: "ads-sp-advertised-product" as const,
      marketplaceId: job.marketplaceId,
      startDate: job.startDate,
      endDate: job.endDate,
      signal: job.controller.signal,
    };
  }

  private async assertAdvertisingStrategyContext(
    job: AdvertisingStrategyJob,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertOwnedJob(job);
    assertBackgroundActive(signal);
    this.advertisingStrategyGateway();
    await this.spExecutionContext.assertCurrent(job.context);
    await this.reportBroker.assertAdvertisedProductBinding({
      binding: job.adsReportBinding,
      marketplaceId: job.marketplaceId,
      signal,
      expectedContext: job.context,
    });
    await this.spExecutionContext.assertCurrent(job.context);
    this.assertOwnedJob(job);
    assertBackgroundActive(signal);
  }

  private async startSalesAndTrafficStrategyReport(
    job: AdvertisingStrategyJob,
    input: { refresh: boolean; explicitRetry: boolean },
  ): Promise<DurableReportStatus> {
    return this.salesAndTraffic.begin({
      marketplaceId: job.marketplaceId,
      startDate: job.startDate,
      endDate: job.endDate,
      signal: job.controller.signal,
      explicitRetry: input.explicitRetry,
      freshCompleted: input.refresh,
      expectedContext: job.context,
    });
  }

  private async startAdvertisedProductStrategyReport(
    job: AdvertisingStrategyJob,
    input: { refresh: boolean; explicitRetry: boolean },
  ): Promise<DurableReportStatus> {
    this.advertisingStrategyGateway();
    return this.reportBroker.startAdvertisedProduct(
      this.advertisedProductPlan(job),
      {
        binding: job.adsReportBinding,
        explicitRetry: input.explicitRetry,
        freshCompleted: input.refresh,
        expectedContext: job.context,
      },
    );
  }

  private async waitForStrategyListings(
    job: AdvertisingStrategyJob,
    initial: DurableReportStatus,
  ): Promise<FbaListingIdentitySnapshot> {
    let status = initial;
    let waited = 0;
    for (let attempt = 0; !status.ready && waited < ADVERTISING_STRATEGY_REPORT_WAIT_MS; attempt += 1) {
      const delay = Math.min(
        advertisingStrategyPollDelay(attempt),
        ADVERTISING_STRATEGY_REPORT_WAIT_MS - waited,
      );
      await this.advertisingStrategyWait(delay, job.controller.signal);
      waited += delay;
      await this.assertAdvertisingStrategyContext(job, job.controller.signal);
      status = await this.getAllListingsReportStatus({
        marketplaceId: job.marketplaceId,
        reportId: status.reportId,
        signal: job.controller.signal,
        expectedContext: job.context,
      });
      this.touchAdvertisingStrategyJob(job);
    }
    if (!status.ready || !status.documentId) {
      throw new SpApiError("Amazon FBA 全商品報表仍在準備中。", {
        status: 504,
        code: "REPORT_PENDING",
      });
    }
    await this.assertAdvertisingStrategyContext(job, job.controller.signal);
    return this.advertisingStrategySources.fbaListings({
      marketplaceId: job.marketplaceId,
      reportId: status.reportId,
      documentId: status.documentId,
      signal: job.controller.signal,
      expectedContext: job.context,
    });
  }

  private async waitForStrategySales(
    job: AdvertisingStrategyJob,
    initial: DurableReportStatus,
  ): Promise<SalesAndTrafficSnapshot> {
    let status = initial;
    let waited = 0;
    for (let attempt = 0; !status.ready && waited < ADVERTISING_STRATEGY_REPORT_WAIT_MS; attempt += 1) {
      const delay = Math.min(
        advertisingStrategyPollDelay(attempt),
        ADVERTISING_STRATEGY_REPORT_WAIT_MS - waited,
      );
      await this.advertisingStrategyWait(delay, job.controller.signal);
      waited += delay;
      await this.assertAdvertisingStrategyContext(job, job.controller.signal);
      status = await this.salesAndTraffic.status({
        marketplaceId: job.marketplaceId,
        startDate: job.startDate,
        endDate: job.endDate,
        reportId: status.reportId,
        signal: job.controller.signal,
        expectedContext: job.context,
      });
      this.touchAdvertisingStrategyJob(job);
    }
    if (!status.ready || !status.documentId) {
      throw new SpApiError("Amazon SKU 銷售與流量報表仍在準備中。", {
        status: 504,
        code: "REPORT_PENDING",
      });
    }
    await this.assertAdvertisingStrategyContext(job, job.controller.signal);
    return this.salesAndTraffic.read({
      marketplaceId: job.marketplaceId,
      startDate: job.startDate,
      endDate: job.endDate,
      reportId: status.reportId,
      documentId: status.documentId,
      signal: job.controller.signal,
      expectedContext: job.context,
    });
  }

  private async waitForStrategyAds(
    job: AdvertisingStrategyJob,
    initial: DurableReportStatus,
  ): Promise<AdvertisedProductReportData> {
    let status = initial;
    let waited = 0;
    for (let attempt = 0; !status.ready && waited < ADVERTISING_STRATEGY_REPORT_WAIT_MS; attempt += 1) {
      const delay = Math.min(
        advertisingStrategyPollDelay(attempt),
        ADVERTISING_STRATEGY_REPORT_WAIT_MS - waited,
      );
      await this.advertisingStrategyWait(delay, job.controller.signal);
      waited += delay;
      await this.assertAdvertisingStrategyContext(job, job.controller.signal);
      status = await this.reportBroker.statusAdvertisedProduct(
        this.advertisedProductPlan(job),
        status.reportId,
        { binding: job.adsReportBinding, expectedContext: job.context },
      );
      this.touchAdvertisingStrategyJob(job);
    }
    if (!status.ready || !status.documentId) {
      throw new SpApiError("Amazon Ads Sponsored Products 商品報表仍在準備中。", {
        status: 504,
        code: "REPORT_PENDING",
      });
    }
    await this.assertAdvertisingStrategyContext(job, job.controller.signal);
    return this.reportBroker.readAdvertisedProductData(
      this.advertisedProductPlan(job),
      { reportId: status.reportId, documentId: status.documentId },
      { binding: job.adsReportBinding, expectedContext: job.context },
    );
  }

  private strategyFailure(error: unknown): { notice: string; code: string } {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        notice: "FBA 廣告策略背景工作已安全停止。",
        code: "STRATEGY_ABORTED",
      };
    }
    if (error instanceof SpApiError) {
      if (error.code === "REPORT_RETRY_WAIT") {
        return {
          notice: publicSpApiError(
            error,
            "Amazon 報表仍在安全重試間隔內。",
          ).message,
          code: "REPORT_RETRY_WAIT",
        };
      }
      if (
        [
          "SHARED_REPORT_RETRY_REQUIRED",
          "REPORT_CANCELLED",
          "REPORT_FATAL",
          "UPSTREAM_UNAVAILABLE",
          "ADS_UPSTREAM_FAILED",
          "ADS_AUTHORIZATION_FAILED",
          "ADS_RATE_LIMITED",
        ].includes(error.code)
      ) {
        return {
          notice: "上次 Amazon 報表建立或讀取未能確定完成；系統不會自動重建，請使用明確重試。",
          code: "REPORT_RETRY_REQUIRED",
        };
      }
      if (error.status === 401 || error.status === 403) {
        return {
          notice: "Amazon 拒絕廣告策略資料查詢，請檢查 SP-API Reports 與 Amazon Ads Viewer 授權。",
          code: "ADS_STRATEGY_AUTHORIZATION_FAILED",
        };
      }
      if (error.code === "REPORT_PENDING") {
        return {
          notice: "Amazon 報表準備時間超過本次等待上限；既有報表不會被重複建立，可重新接回。",
          code: "REPORT_PENDING",
        };
      }
    }
    if (error instanceof AdvertisingApiError) {
      return {
        notice: "Amazon Ads 報表目前無法完成；沒有建立、修改或啟用任何 campaign。",
        code: "ADS_STRATEGY_FAILED",
      };
    }
    return {
      notice: "FBA 廣告策略目前無法完成；缺值沒有被補成 0，也沒有修改任何廣告。",
      code: "ADS_STRATEGY_FAILED",
    };
  }

  private async runAdvertisingStrategyJob(
    job: AdvertisingStrategyJob,
    input: { refresh: boolean; explicitRetry: boolean },
  ): Promise<void> {
    try {
      const signal = job.controller.signal;
      await this.assertAdvertisingStrategyContext(job, signal);
      const [listingsReport, salesReport, adsReport] = await Promise.all([
        this.startAllListingsReport(
          job.marketplaceId,
          input.explicitRetry,
          signal,
          { freshCompleted: input.refresh },
          job.context,
        ),
        this.startSalesAndTrafficStrategyReport(job, input),
        this.startAdvertisedProductStrategyReport(job, input),
      ]);

      job.progress = { phase: "fba", completed: 0, total: 4 };
      job.notice = "正在核對同一站點目前可證明為 FBA 的 Seller SKU。";
      const fba = await this.waitForStrategyListings(job, listingsReport);
      await this.assertAdvertisingStrategyContext(job, signal);
      job.progress = { phase: "sales", completed: 1, total: 4 };
      job.notice = "FBA 商品已核對；正在整理 SKU 粒度銷售與營業額。";
      this.touchAdvertisingStrategyJob(job);

      const sales = await this.waitForStrategySales(job, salesReport);
      await this.assertAdvertisingStrategyContext(job, signal);
      job.progress = { phase: "ads", completed: 2, total: 4 };
      job.notice = "SKU 銷售已整理；正在讀取 Sponsored Products 實際花費。";
      this.touchAdvertisingStrategyJob(job);

      const ads = await this.waitForStrategyAds(job, adsReport);
      const adsFetchedAt = new Date(this.now()).toISOString();
      await this.assertAdvertisingStrategyContext(job, signal);
      job.progress = { phase: "building", completed: 3, total: 4 };
      job.notice = "三份唯讀來源已完成；正在套用可見的 T1–T4 預設規則。";
      this.touchAdvertisingStrategyJob(job);

      const snapshot = buildAdvertisingStrategySnapshot({
        marketplaceId: job.marketplaceId,
        marketplaceCode: job.marketplaceCode,
        dateRange: { startDate: job.startDate, endDate: job.endDate },
        currencyCode: MARKETPLACE_CURRENCIES[job.marketplaceId],
        fetchedAt: new Date(this.now()).toISOString(),
        sourceFetchedAt: {
          fba: fba.fetchedAt,
          sales: sales.fetchedAt,
          ads: adsFetchedAt,
        },
        listings: fba.rows,
        salesRows: sales.rows.map((row) => ({
          sellerSku: row.sellerSku,
          childAsin: row.childAsin,
          unitsSold: row.unitsOrdered,
          salesAmount: row.orderedProductSales,
          currencyCode: row.currencyCode,
        })),
        spAdvertisedProductRows: ads.rows.map((row) => ({
          sellerSku: row.advertisedSku,
          asin: row.advertisedAsin,
          spend: row.cost,
          sales14d: row.sales14d,
          purchases14d: row.purchases14d,
          currencyCode: MARKETPLACE_CURRENCIES[job.marketplaceId],
        })),
      });
      await this.assertAdvertisingStrategyContext(job, signal);
      if (
        job.revision !== this.lifecycleRevision ||
        job.state !== "running" ||
        this.advertisingStrategyJobs.get(job.jobId) !== job
      ) return;
      job.snapshot = snapshot;
      job.state = "completed";
      job.progress = { phase: "building", completed: 4, total: 4 };
      job.notice = "FBA 廣告策略表已完成；SB／SD 與規格欄位保留人工決策，不會自動寫回 Amazon。";
      job.errorCode = null;
      this.retainAdvertisingStrategyJob(job);
    } catch (error) {
      if (
        job.revision !== this.lifecycleRevision ||
        job.state !== "running" ||
        this.advertisingStrategyJobs.get(job.jobId) !== job
      ) return;
      const failure = this.strategyFailure(error);
      job.controller.abort(error);
      job.state = "failed";
      job.snapshot = null;
      job.notice = failure.notice;
      job.errorCode = failure.code;
      this.retainAdvertisingStrategyJob(
        job,
        failure.code === "REPORT_RETRY_REQUIRED" || failure.code === "REPORT_RETRY_WAIT"
          ? ADVERTISING_STRATEGY_RETRY_TTL_MS
          : ADVERTISING_STRATEGY_TERMINAL_TTL_MS,
      );
    }
  }

  private async startAdvertisingStrategy(
    request: ApiRequest,
    operationSignal: AbortSignal,
  ): Promise<ApiResponse> {
    const revision = this.lifecycleRevision;
    const body = bodyRecord(request);
    if (!body) return invalid("廣告策略查詢格式無效。");
    const allowedKeys = new Set([
      "marketplaceId",
      "startDate",
      "endDate",
      "refresh",
      "explicitRetry",
    ]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return invalid("廣告策略查詢包含不支援的欄位。");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon Ads 站點。");
    if (
      (body.refresh !== undefined && typeof body.refresh !== "boolean") ||
      (body.explicitRetry !== undefined && typeof body.explicitRetry !== "boolean")
    ) {
      return invalid("廣告策略重新產生意圖格式無效。");
    }
    const refresh = body.refresh === true;
    const explicitRetry = body.explicitRetry === true;
    if (explicitRetry && !refresh) {
      return invalid("明確重試必須由重新產生操作觸發。");
    }
    let range: { startDate: string; endDate: string };
    try {
      range = this.parseAdvertisingStrategyRange({
        marketplaceId,
        startDate: body.startDate,
        endDate: body.endDate,
      });
    } catch (error) {
      return advertisingApiError(error, "廣告策略日期無效。");
    }
    const context = await this.spExecutionContext.capture(marketplaceId);
    this.assertLifecycleRevision(revision);
    assertBackgroundActive(operationSignal);
    if (context.mode === "demo") {
      return invalid(
        "展示模式不會產生看似真實的 FBA 廣告策略表。",
        422,
        "ADS_STRATEGY_LIVE_REQUIRED",
      );
    }

    this.pruneAdvertisingStrategyJobs();
    this.advertisingStrategyGateway();
    const adsReportBinding = await this.reportBroker
      .bindAdvertisedProductAccount({
        marketplaceId,
        signal: operationSignal,
        expectedContext: context,
      });
    this.assertLifecycleRevision(revision);
    await this.spExecutionContext.assertCurrent(context);
    this.assertLifecycleRevision(revision);
    assertBackgroundActive(operationSignal);
    const spAccountScope = context.accountScope;
    const selection = stableFingerprint({
      spAccountScope,
      adsReportBinding,
      marketplaceId,
      startDate: range.startDate,
      endDate: range.endDate,
    });
    const existingId = this.advertisingStrategySelections.get(selection);
    const existing = existingId ? this.advertisingStrategyJobs.get(existingId) : null;
    if (existing?.state === "running" && existing.expiresAt > this.now()) {
      return this.advertisingStrategyReply(existing);
    }
    if (explicitRetry && !(
      existing?.state === "failed" &&
      (existing.errorCode === "REPORT_RETRY_REQUIRED" || existing.errorCode === "REPORT_RETRY_WAIT") &&
      existing.expiresAt > this.now()
    )) {
      return invalid(
        "目前沒有同帳號、站點與日期範圍的報表重試資格。",
        409,
        "REPORT_RETRY_NOT_ALLOWED",
      );
    }
    if (existing && !refresh) return this.advertisingStrategyReply(existing);
    // The renderer also sends refresh when the user changes a date selection.
    // Only an exact selection that is already known locally is an explicit
    // request to replace compatible completed report leases. A -> B -> A must
    // reconnect to A's existing DAY+SKU report instead of issuing a third POST.
    const freshCompleted = refresh && Boolean(existing);
    if (existing) this.removeAdvertisingStrategyJob(existing.jobId);
    for (const candidate of [...this.advertisingStrategyJobs.values()]) {
      if (candidate.marketplaceId !== marketplaceId) continue;
      if (candidate.state === "running") {
        candidate.controller.abort(new Error("同一站點已改用新的廣告策略日期範圍。"));
      }
      this.removeAdvertisingStrategyJob(candidate.jobId);
    }

    const job: AdvertisingStrategyJob = {
      jobId: this.createId(),
      revision,
      context,
      marketplaceId,
      marketplaceCode: MARKETPLACE_CODES[marketplaceId],
      spAccountScope,
      adsReportBinding,
      mode: "live",
      startDate: range.startDate,
      endDate: range.endDate,
      state: "running",
      progress: { phase: "fba", completed: 0, total: 4 },
      notice: "正在建立三份唯讀資料來源；你可以關閉這個面板或先使用其他功能。",
      errorCode: null,
      snapshot: null,
      controller: new AbortController(),
      expiresAt: this.now() + ADVERTISING_STRATEGY_ACTIVE_TTL_MS,
      expiryTimer: null,
      flight: null,
    };
    this.advertisingStrategyJobs.set(job.jobId, job);
    this.advertisingStrategySelections.set(selection, job.jobId);
    const flight = this.runAdvertisingStrategyJob(job, {
      refresh: freshCompleted,
      explicitRetry,
    }).finally(() => {
      if (
        this.lifecycleRevision === revision &&
        this.advertisingStrategyJobs.get(job.jobId) === job &&
        job.flight === flight
      ) {
        job.flight = null;
      }
    });
    job.flight = flight;
    void job.flight;
    return this.advertisingStrategyReply(job);
  }

  private async advertisingStrategyStatus(
    request: ApiRequest,
    operationSignal: AbortSignal,
  ): Promise<ApiResponse> {
    const allowedKeys = new Set(["marketplaceId", "jobId", "startDate", "endDate"]);
    if (Object.keys(request.query).some((key) => !allowedKeys.has(key))) {
      return invalid("廣告策略工作查詢包含不支援的欄位。");
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
      return invalid("廣告策略工作資訊無效，請重新產生。");
    }
    this.pruneAdvertisingStrategyJobs();
    const job = this.advertisingStrategyJobs.get(jobId);
    if (!job || job.marketplaceId !== marketplaceId) {
      return invalid("找不到這份廣告策略工作，請重新產生。", 404, "JOB_NOT_FOUND");
    }
    if (job.startDate !== startDate || job.endDate !== endDate) {
      return invalid("廣告策略工作與所選日期不一致。", 409, "JOB_MISMATCH");
    }
    try {
      await this.assertAdvertisingStrategyContext(job, operationSignal);
    } catch (error) {
      job.controller.abort(new Error("廣告策略工作 context 已變更。"));
      this.removeAdvertisingStrategyJob(job.jobId);
      if (isContextFenceError(error)) throw error;
      return invalid(
        "廣告策略工作不屬於目前 SP-API／Ads 帳號、站點或模式。",
        409,
        "JOB_MISMATCH",
      );
    }
    this.pruneAdvertisingStrategyJobs();
    if (
      job.revision !== this.lifecycleRevision ||
      this.advertisingStrategyJobs.get(job.jobId) !== job
    ) {
      return invalid(
        "找不到這份廣告策略工作，請重新產生。",
        404,
        "JOB_NOT_FOUND",
      );
    }
    return this.advertisingStrategyReply(job);
  }

  private async adsStatus(
    request: ApiRequest,
    operationSignal: AbortSignal,
  ): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon Ads 站點。");
    const context = await this.spExecutionContext.capture(marketplaceId);
    assertBackgroundActive(operationSignal);
    const demo = context.mode === "demo";
    const summary = demo || !this.advertising
      ? null
      : (await this.runContextBoundWork(
          context,
          () => this.advertising!.getCredentialSummary(),
          operationSignal,
        )).value;
    let verification: AdvertisingConnectionTestResult | null = null;
    if (!demo && summary?.configured && this.advertising) {
      verification = (await this.runContextBoundWork(
        context,
        () => this.advertising!.probeMarketplace(marketplaceId),
        operationSignal,
      )).value;
    }
    const coverageAuditAvailable = demo || Boolean(verification?.ok);
    return json({
      marketplaceId,
      marketplaceCode: MARKETPLACE_CODES[marketplaceId],
      configured: Boolean(summary?.configured),
      verified: Boolean(verification?.ok),
      lwaConfigured: Boolean(summary?.lwaConfigured),
      profileConfigured: Boolean(verification?.ok),
      writeEnabled: false,
      scope: "advertising::campaign_management",
      requiredPermission: "Campaign manager Viewer",
      permissionVerified: false,
      supportedProducts: ["SPONSORED_PRODUCTS"],
      separateFromSpApi: true,
      testedAt: verification?.testedAt ?? null,
      requestId: verification?.requestId ?? null,
      coverageAuditAvailable,
      coverageAuditNotice: coverageAuditAvailable
        ? demo
          ? "目前是展示模式，可驗證 ProductAI 命名與同 ASIN 覆蓋規則；結果不是你的真實 Amazon Ads 資料。"
          : "已用這個站點自動找到的 Seller Profile 驗證唯讀 Campaign 查詢。"
        : verification?.message ?? "Amazon Ads API 尚未完成獨立授權；不會用展示結果冒充真實覆蓋。",
      notice: demo
        ? "展示模式不會呼叫 Amazon Ads。"
        : verification?.message ?? "Amazon Ads 需要獨立 LWA App；Profile ID 由主程式自動發現，不需要輸入。",
    });
  }

  private async adsCoverage(
    request: ApiRequest,
    operationSignal: AbortSignal,
  ): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon Ads 站點。");
    const context = await this.spExecutionContext.capture(marketplaceId);
    assertBackgroundActive(operationSignal);
    const demo = context.mode === "demo";
    if (!demo && !this.advertising) {
      return invalid(
        "Amazon Ads API 尚未連線；廣告覆蓋健檢已備妥，但不會用展示活動冒充真實資料。",
        422,
        "ADS_API_NOT_CONNECTED",
      );
    }
    try {
      if (!demo) {
        const { value: summary } = await this.runContextBoundWork(
            context,
            () => this.advertising!.getCredentialSummary(),
            operationSignal,
        );
        if (!summary.configured) {
          return invalid(
            "Amazon Ads 憑證尚未完整設定。",
            422,
            "ADS_API_NOT_CONNECTED",
          );
        }
      }
      const existing = await this.fbaCatalogReports.readExistingExport({
        marketplaceId,
        signal: operationSignal,
        expectedContext: context,
      });
      if (existing.state === "missing") {
        return invalid(
          "目前沒有可安全接回的 FBA 全商品報表；請先從具明確啟動動作的功能建立報表。",
          409,
          "REPORT_NOT_READY",
        );
      }
      if (existing.state === "pending") {
        return json(
          {
            state: "processing",
            marketplaceId,
            message: "Amazon 正在準備 FBA 全商品清單，稍後會自動繼續。",
          },
          202,
          { "retry-after": "2" },
        );
      }
      const data = existing.data;
      const listings = prepareAdvertisingCoverageListings({
        rows: data.rows,
        errors: data.errors,
      });
      const campaigns: AdvertisingCoverageCampaign[] = demo
        ? listings
            .filter((_, index) => index % 2 === 0)
            .map((listing, index) => ({
              campaignId: `demo-productai-${index + 1}`,
              name: `[ProductAI] ${MARKETPLACE_CODES[marketplaceId]}-${listing.asin}-${listing.sellerSku}-SP-PAT-Aug92026`,
              state: "ENABLED",
              adProduct: "SPONSORED_PRODUCTS",
            }))
        : (await this.runContextBoundWork(
            context,
            () => this.advertising!.listEnabledSponsoredProductCampaigns(
              marketplaceId,
              operationSignal,
            ),
            operationSignal,
          )).value;
      return json(
        auditAdvertisingCoverage({
          mode: demo ? "demo" : "live",
          marketplaceId,
          marketplaceCode: MARKETPLACE_CODES[marketplaceId],
          listings,
          campaigns,
        }),
      );
    } catch (error) {
      if (isContextFenceError(error)) throw error;
      return advertisingApiError(
        error,
        "執行 Amazon Ads 覆蓋健檢時發生未預期錯誤。",
      );
    }
  }

}
