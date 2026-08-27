import type {
  ApiRequest,
  ApiResponse,
  ConnectionTestResult,
  CredentialSummary,
} from "../shared/contracts";
import type { AdvertisingGateway } from "./amazon/ads-api";
import { CredentialVault } from "./credential-vault";
import { LocalStore } from "./local-store";
import {
  MainWriteGate,
  MainWriteGateError,
  type MainWriteGatePort,
  type WriteBinding,
  type WriteOperation,
  type WritePreviewFamily,
} from "./write-gate";
import {
  publicSpApiError,
  SpApiError,
  SpApiPreCommitError,
} from "./amazon/sp-api-error";
import {
  createProductionSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
  type SpExecutionContextInvalidationReason,
} from "./amazon/sp-execution-context";
import {
  createRouterRequestContextAdapter,
  type RouterRequestContextAdapter,
} from "./router-request-context";
import {
  StatelessCapabilityRoutes,
  type StatelessCapabilityRoutesPort,
} from "./stateless-capability-routes";
import {
  LocalImageUpload,
  type LocalImageUploadPort,
} from "./local-image-upload";
import {
  SystemHealthRoute,
  type SystemHealthRoutePort,
} from "./system-health-route";
import {
  PlanningCapabilityRoutes,
  type PlanningCapabilityRoutesPort,
} from "./planning-capability-routes";
import {
  ProductMasterRoutes,
  type ProductMasterRoutesPort,
} from "./product-master-routes";
import { SkuCommand } from "./amazon/sku-command";
import {
  SkuCommandRoute,
  type SkuCommandRoutePort,
} from "./sku-command-route";
import {
  bodyRecord,
  integer,
  isPlainRecord,
  multiLineText,
  optionalInteger,
  parseAsin,
  parseMarketplace,
  parseSellerSku,
  reportIdentifier,
  shortText,
  type JsonRecord,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  createListingPriceMutations,
  type ListingPriceMutationsPort,
} from "./listing-price-mutations";
import {
  createListingImageMutations,
  type ListingImageMutationsPort,
} from "./listing-image-mutations";
import {
  createVariationMoveMutations,
  type VariationMoveMutationsPort,
} from "./variation-move-mutations";
import {
  createBusinessPricingMutations,
  type BusinessPricingMutationsPort,
} from "./business-pricing-mutations";
import {
  createListingContentMutations,
  type ListingContentMutationsPort,
} from "./listing-content-mutations";
import {
  createListingContentBatchMutations,
  type ListingContentBatchMutationsPort,
} from "./listing-content-batch-mutations";
import {
  FbaSalesMetricsRoutes,
  type FbaSalesMetricsRoutesPort,
} from "./fba-sales-metrics-routes";
import {
  createBrandSalesCoordinator,
  type BrandSalesCoordinatorPort,
  type BrandSalesDemoSource,
} from "./brand-sales-coordinator";
export {
  parseAsin,
  parseMarketplace,
  parseSellerSku,
} from "./route-input";
import {
  MARKETPLACES,
  catalogListingsReadAdapterProduction,
  catalogReportsDemoSource,
  getFbaVariationGroupingData,
  aplusContentPageAdapterProduction,
  businessPricingGatewayProduction,
  customerFeedbackPageAdapterProduction,
  isConfiguredForMarketplace,
  getRestockPlan,
  getSalesTrend,
  getFbaSubscriptionAudit,
  getDemoUnboundVariationAuditData,
  getSubscribeAndSaveOffer,
  getVariationFamilyPlanner,
  isMarketplaceId,
  invalidateSpApiCredentialCaches,
  listingImageGatewayProduction,
  listingContentGatewayProduction,
  listingPriceGatewayProduction,
  variationMoveGatewayProduction,
  fbaInboundExternalReadAdapterProduction,
  reportsRuntimeProductionAdapter,
  ordersPageAdapterProduction,
  searchListingsBySku,
  usesDemoMode,
  verifyListingsAccess,
  type MarketplaceId,
} from "./amazon/sp-api";
import {
  AgedInventoryReads,
  type AgedInventoryReadsPort,
} from "./amazon/aged-inventory-reads";
import { FbaInboundReads } from "./amazon/fba-inbound-reads";
import {
  FbaInboundCoordinator,
  type FbaInboundCoordinatorPort,
  type FbaInboundReadsPort,
} from "./fba-inbound-coordinator";
import {
  ReviewAuditCoordinator,
  type ReviewAuditCandidateSource,
  type ReviewAuditCoordinatorPort,
} from "./review-audit-coordinator";
import {
  ReadOnlyAdvertisingCoordinator,
  type AdvertisingCoordinatorPort,
  type AdvertisingStrategySourceGateway,
} from "./advertising-read-coordinator";
import {
  StandaloneAuditCoordinator,
  type StandaloneAuditCoordinatorPort,
} from "./standalone-audit-coordinator";
import {
  SalesAndTrafficReports,
  type SalesAndTrafficDemoSource,
  type SalesAndTrafficDocumentReader,
} from "./amazon/sales-and-traffic-reports";
import { createSalesAndTrafficDemoSource } from
  "./amazon/sales-and-traffic-demo";
import { createBrandSalesDemoSource } from "./amazon/brand-sales-demo";
import {
  FbaCatalogReports,
  type FbaCatalogReportsDemoSource,
} from "./amazon/fba-catalog-reports";
import type {
  BusinessPricingAuditSnapshot,
  CatalogListingsReadAdapter,
} from "./amazon/catalog-report-reads";
import {
  getDemoFbaReviewAuditCandidates,
  readUnboundVariationAudit,
  verifyFbaReviewAuditSeeds,
  type UnboundVariationAuditSnapshot,
} from "./amazon/variation-catalog-reads";
import {
  CustomerFeedbackReads,
  type CustomerFeedbackReadsPort,
} from "./amazon/customer-feedback-reads";
import { OrdersReads, type OrdersReadsPort } from "./amazon/orders-reads";
import { DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT } from
  "./amazon/inbound-noncompliance";
import { ReplenishmentAuditError } from "./amazon/replenishment-audit";
import {
  AplusContentReads,
  type AplusContentReadsPort,
} from "./amazon/a-plus-content-reads";
import { AuditSuiteCatalogResources } from
  "./amazon/audit-suite-resources";
import {
  AuditSuiteCompatibilityCoordinator,
  type AuditSuiteCompatibilityCoordinatorPort,
} from "./audit-suite-compatibility-coordinator";
import {
  AplusAuditCoordinator,
  type AplusAuditCoordinatorPort,
} from "./a-plus-audit-coordinator";
import {
  BusinessPricingAudit,
  type BusinessPricingAuditPort,
} from "./amazon/business-pricing-audit";
import {
  SubscriptionAuditOwner,
  type SubscriptionAuditOwnerPort,
} from "./amazon/subscription-audit-owner";
import {
  UnboundVariationAuditOwner,
  type UnboundVariationAuditOwnerPort,
} from "./amazon/unbound-variation-audit-owner";
import {
  AgedInventoryAudit,
  type AgedInventoryAuditPort,
} from "./amazon/aged-inventory-audit";
import {
  ContentAuditOwner,
  type ContentAuditOwnerPort,
} from "./amazon/content-audit-owner";
import {
  ImageAuditOwner,
  type ImageAuditOwnerPort,
} from "./amazon/image-audit-owner";
import {
  ListingsExport,
  type ListingsExportPort,
} from "./amazon/listings-export";
import {
  type DurableReportGatewayStatus,
  type DurableReportStatus,
} from "./amazon/report-lifecycle";
import {
  reportsAdapterIdentity,
  type ReportsAdapter,
  type ReportsIntentPlan,
} from "./amazon/reports-runtime";
import { FixedReportBroker } from "./amazon/report-broker";
import { testRegionConnections } from "./amazon/connection-health";
import { marketplaceByCode } from "../shared/marketplaces";
import {
  abortableDelay as waitMilliseconds,
  throwIfAborted as assertBackgroundActive,
} from "./abort-utils";

type WriteApproval = (reason: string) => Promise<void>;

type DemoFixedReportStart = (input: Readonly<{
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>) => Promise<DurableReportGatewayStatus>;

type DemoFixedReportStatus = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
}>) => Promise<DurableReportGatewayStatus>;

type DemoAllListingsReportGateway = {
  start: DemoFixedReportStart;
  status: DemoFixedReportStatus;
};

type BusinessPricingActiveListingsReportGateway = {
  start: DemoFixedReportStart;
  status: DemoFixedReportStatus;
};

type InboundNoncomplianceDemoReportGateway = {
  start(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>): Promise<DurableReportGatewayStatus>;
  status(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
  }>): Promise<DurableReportGatewayStatus>;
  document(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
  }>): Promise<string>;
};

function demoReportReference(
  intent: "all-listings" | "active-business-listings" | "aged-inventory",
  marketplaceId: MarketplaceId,
): string {
  switch (intent) {
    case "all-listings":
      return `demo-${marketplaceId}`;
    case "active-business-listings":
      return `demo-b2b-active-${marketplaceId}`;
    case "aged-inventory":
      return `demo-aged-${marketplaceId}`;
  }
}

async function startDemoFixedReport(input: Readonly<{
  intent: "all-listings" | "active-business-listings" | "aged-inventory";
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>): Promise<DurableReportGatewayStatus> {
  assertBackgroundActive(input.signal);
  const reference = demoReportReference(input.intent, input.marketplaceId);
  return {
    mode: "demo",
    ready: true,
    reportId: reference,
    documentId: reference,
    status: "DONE",
    notice: input.intent === "all-listings"
      ? "展示報表已準備完成。"
      : input.intent === "active-business-listings"
        ? "展示 Active Listings 報表已準備完成。"
        : "展示用 FBA 庫齡報表已準備完成。",
  };
}

async function statusDemoFixedReport(input: Readonly<{
  intent: "all-listings" | "active-business-listings" | "aged-inventory";
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
}>): Promise<DurableReportGatewayStatus> {
  assertBackgroundActive(input.signal);
  return {
    mode: "demo",
    ready: true,
    reportId: input.reportId,
    documentId: demoReportReference(input.intent, input.marketplaceId),
    status: "DONE",
    notice: input.intent === "all-listings"
      ? "展示報表已準備完成。"
      : input.intent === "active-business-listings"
        ? "展示 Active Listings 報表已準備完成。"
        : "展示用 FBA 庫齡報表已準備完成。",
  };
}

function assertDemoReportsRequest(request: Readonly<{ mode: "live" | "demo" }>): void {
  if (request.mode !== "demo") {
    throw new SpApiError("展示 Reports adapter 不接受正式 Amazon 請求。", {
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
  }
}

function demoRevenueReportReference(
  request: Extract<
    ReportsIntentPlan,
    { intent: "fba-shipment-sales" | "sales-and-traffic-daily-sku" }
  >,
): string {
  return request.intent === "fba-shipment-sales"
    ? `demo-brand-${request.marketplaceId}-${request.startDate}-${request.endDate}`
    : `demo-sales-traffic-${request.marketplaceId}-${request.startDate}-${request.endDate}`;
}

function demoRevenueReportStatus(
  request: Extract<
    ReportsIntentPlan,
    { intent: "fba-shipment-sales" | "sales-and-traffic-daily-sku" }
  >,
  reportId?: string,
): DurableReportGatewayStatus {
  const reference = demoRevenueReportReference(request);
  if (reportId !== undefined && reportId !== reference) {
    throw new SpApiError("展示營收報表與目前站點或日期不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  return {
    mode: "demo",
    ready: true,
    reportId: reference,
    documentId: reference,
    status: "DONE",
    notice: request.intent === "fba-shipment-sales"
      ? "展示用 FBA 品牌出貨報表已準備完成。"
      : "展示用銷售與流量報表已準備完成。",
  };
}

function demoInboundNoncomplianceReference(
  marketplaceId: MarketplaceId,
): string {
  return `demo-inbound-noncompliance-${marketplaceId}`;
}

async function startDemoInboundNoncomplianceReport(input: Readonly<{
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>): Promise<DurableReportGatewayStatus> {
  assertBackgroundActive(input.signal);
  const reference = demoInboundNoncomplianceReference(input.marketplaceId);
  return {
    mode: "demo",
    ready: true,
    reportId: reference,
    documentId: reference,
    status: "DONE",
    notice: "展示用 FBA 入庫瑕疵報表已準備完成。",
  };
}

async function statusDemoInboundNoncomplianceReport(input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
}>): Promise<DurableReportGatewayStatus> {
  assertBackgroundActive(input.signal);
  const reference = demoInboundNoncomplianceReference(input.marketplaceId);
  if (input.reportId !== reference) {
    throw new SpApiError("展示報表編號與目前站點不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  return startDemoInboundNoncomplianceReport(input);
}

async function readDemoInboundNoncomplianceDocument(input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
  signal?: AbortSignal;
}>): Promise<string> {
  assertBackgroundActive(input.signal);
  const reference = demoInboundNoncomplianceReference(input.marketplaceId);
  if (input.reportId !== reference || input.documentId !== reference) {
    throw new SpApiError("展示報表文件與目前站點不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  return DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT;
}

function routerDemoReportsAdapter(input: Readonly<{
  allListings: DemoAllListingsReportGateway;
  activeBusiness: BusinessPricingActiveListingsReportGateway;
  inboundNoncompliance: InboundNoncomplianceDemoReportGateway;
}>): ReportsAdapter {
  const identity = (
    request: ReportsIntentPlan & { mode: "live" | "demo" },
    result?: Readonly<{ mode: "live" | "demo" }>,
  ) =>
    reportsAdapterIdentity(
      request as unknown as ReportsIntentPlan,
      result?.mode ?? request.mode,
    );
  return {
    async create(request) {
      assertDemoReportsRequest(request);
      const result = request.intent === "all-listings"
        ? await input.allListings.start({
            marketplaceId: request.marketplaceId,
            signal: request.signal,
          })
        : request.intent === "active-business-listings"
          ? await input.activeBusiness.start({
              marketplaceId: request.marketplaceId,
              signal: request.signal,
            })
          : request.intent === "aged-inventory"
            ? await startDemoFixedReport({
                intent: "aged-inventory",
                marketplaceId: request.marketplaceId,
                signal: request.signal,
              })
            : request.intent === "inbound-noncompliance"
              ? await input.inboundNoncompliance.start({
                  marketplaceId: request.marketplaceId,
                  signal: request.signal,
                })
              : request.intent === "sales-and-traffic-daily-sku"
                ? demoRevenueReportStatus(request)
                : demoRevenueReportStatus(request);
      return { ...result, identity: identity(request, result) };
    },
    async status(request) {
      assertDemoReportsRequest(request);
      const result = request.intent === "all-listings"
        ? await input.allListings.status({
            marketplaceId: request.marketplaceId,
            reportId: request.reportId,
            signal: request.signal,
          })
        : request.intent === "active-business-listings"
          ? await input.activeBusiness.status({
              marketplaceId: request.marketplaceId,
              reportId: request.reportId,
              signal: request.signal,
            })
          : request.intent === "aged-inventory"
            ? await statusDemoFixedReport({
                intent: "aged-inventory",
                marketplaceId: request.marketplaceId,
                reportId: request.reportId,
                signal: request.signal,
              })
            : request.intent === "inbound-noncompliance"
              ? await input.inboundNoncompliance.status({
                  marketplaceId: request.marketplaceId,
                  reportId: request.reportId,
                  signal: request.signal,
                })
              : request.intent === "sales-and-traffic-daily-sku"
                ? demoRevenueReportStatus(request, request.reportId)
                : demoRevenueReportStatus(request, request.reportId);
      return { ...result, identity: identity(request, result) };
    },
    async readDocument(request) {
      assertDemoReportsRequest(request);
      return {
        identity: identity(request),
        reportId: request.reportId,
        documentId: request.documentId,
        text: request.intent === "inbound-noncompliance"
          ? await input.inboundNoncompliance.document({
              marketplaceId: request.marketplaceId,
              reportId: request.reportId,
              documentId: request.documentId,
              signal: request.signal,
            })
          : "",
      };
    },
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

function apiError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof SpApiError) {
    return routeError(error, fallback);
  }
  if (error instanceof ReplenishmentAuditError) {
    const status = error.code === "MARKETPLACE_UNSUPPORTED" || error.code === "REQUEST_INVALID"
      ? 422
      : error.code === "PAGINATION_CHANGED" || error.code === "DUPLICATE_SKU"
        ? 409
        : 502;
    const publicError = publicRouterError({
      status,
      code: `REPLENISHMENT_${error.code}`,
      message: error.message,
    }, fallback);
    return json(
      { code: publicError.code, message: publicError.message },
      publicError.status,
    );
  }
  return json({ code: "INTERNAL_ERROR", message: fallback }, 500);
}

function writeApiError(error: unknown, fallback: string): ApiResponse {
  return error instanceof MainWriteGateError
    ? invalid(error.message, error.status, error.code)
    : apiError(error, fallback);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string");
}

function validApiBody(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.kind === "json") return isPlainRecord(value.value);
  if (
    value.kind !== "multipart" ||
    !isStringRecord(value.fields) ||
    !isPlainRecord(value.file)
  ) {
    return false;
  }
  return (
    typeof value.file.name === "string" &&
    typeof value.file.type === "string" &&
    value.file.bytes instanceof Uint8Array
  );
}

export class ApiRouter {
  private readonly store: LocalStore;
  private readonly vault: CredentialVault;
  private readonly spExecutionContext: RouterRequestContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly priceMutations: ListingPriceMutationsPort;
  private readonly listingImageMutations: ListingImageMutationsPort;
  private readonly listingContentMutations: ListingContentMutationsPort;
  private readonly listingContentBatchMutations:
    ListingContentBatchMutationsPort;
  private readonly variationMoveMutations: VariationMoveMutationsPort;
  private readonly businessPricingMutations: BusinessPricingMutationsPort;
  private readonly allListingsDemoReports: DemoAllListingsReportGateway;
  private readonly agedInventoryReads: AgedInventoryReadsPort;
  private readonly aplusContentReads: AplusContentReadsPort;
  private readonly businessPricingActiveListingsReports:
    BusinessPricingActiveListingsReportGateway;
  private readonly ordersReads: OrdersReadsPort;
  private readonly statelessCapabilities: StatelessCapabilityRoutesPort;
  private readonly imageUpload: LocalImageUploadPort;
  private readonly health: SystemHealthRoutePort;
  private readonly planningCapabilities: PlanningCapabilityRoutesPort;
  private readonly productMasterRoutes: ProductMasterRoutesPort;
  private readonly skuCommandRoute: SkuCommandRoutePort;
  private readonly fbaSalesMetricsRoutes: FbaSalesMetricsRoutesPort;
  private readonly fbaInboundCoordinator: FbaInboundCoordinatorPort;
  private readonly reportBroker: FixedReportBroker;
  private readonly salesAndTraffic: SalesAndTrafficReports;
  private readonly catalogListings: CatalogListingsReadAdapter;
  private readonly fbaCatalogReports: FbaCatalogReports;
  private readonly brandSalesCoordinator: BrandSalesCoordinatorPort;
  private readonly businessPricingAuditOwner: BusinessPricingAuditPort;
  private readonly subscriptionAuditOwner: SubscriptionAuditOwnerPort;
  private readonly unboundVariationAuditOwner: UnboundVariationAuditOwnerPort;
  private readonly agedInventoryAuditOwner: AgedInventoryAuditPort;
  private readonly contentAuditOwner: ContentAuditOwnerPort;
  private readonly imageAuditOwner: ImageAuditOwnerPort;
  private readonly listingsExportOwner: ListingsExportPort;
  private readonly reviewAuditCoordinator: ReviewAuditCoordinatorPort;
  private readonly advertisingCoordinator: AdvertisingCoordinatorPort;
  private readonly legacyAuditSuiteCompatibility:
    AuditSuiteCompatibilityCoordinatorPort;
  private readonly aPlusAuditCoordinator: AplusAuditCoordinatorPort;
  private readonly standaloneAuditCoordinator: StandaloneAuditCoordinatorPort;
  private contextStateRevision = 0;

  constructor(input: {
    store: LocalStore;
    vault: CredentialVault;
    approveWrite: WriteApproval;
    allListingsDemoReports?: Partial<DemoAllListingsReportGateway>;
    agedInventoryReads?: AgedInventoryReadsPort;
    businessPricingActiveListingsReports?: Partial<
      BusinessPricingActiveListingsReportGateway
    >;
    salesAndTrafficRead?: SalesAndTrafficDocumentReader;
    salesAndTrafficDemo?: Partial<SalesAndTrafficDemoSource>;
    advertisingStrategySources?: Partial<AdvertisingStrategySourceGateway>;
    advertisingCoordinator?: AdvertisingCoordinatorPort;
    reviewAuditCoordinator?: ReviewAuditCoordinatorPort;
    reviewAuditCandidates?: ReviewAuditCandidateSource;
    customerFeedbackReads?: CustomerFeedbackReadsPort;
    ordersReads?: OrdersReadsPort;
    statelessCapabilities?: StatelessCapabilityRoutesPort;
    imageUpload?: LocalImageUploadPort;
    health?: SystemHealthRoutePort;
    planningCapabilities?: PlanningCapabilityRoutesPort;
    productMasterRoutes?: ProductMasterRoutesPort;
    skuCommandRoute?: SkuCommandRoutePort;
    fbaSalesMetricsRoutes?: FbaSalesMetricsRoutesPort;
    brandSalesCoordinator?: BrandSalesCoordinatorPort;
    fbaInboundCoordinator?: FbaInboundCoordinatorPort;
    businessPricingAudit?: BusinessPricingAuditPort;
    subscriptionAudit?: SubscriptionAuditOwnerPort;
    unboundVariationAudit?: UnboundVariationAuditOwnerPort;
    agedInventoryAudit?: AgedInventoryAuditPort;
    contentAudit?: ContentAuditOwnerPort;
    imageAudit?: ImageAuditOwnerPort;
    listingsExport?: ListingsExportPort;
    advertisingStrategyWait?: typeof waitMilliseconds;
    fbaInboundReads?: Partial<FbaInboundReadsPort>;
    inboundNoncomplianceDemoReports?: Partial<
      InboundNoncomplianceDemoReportGateway
    >;
    reportsAdapter?: ReportsAdapter;
    demoReportsAdapter?: ReportsAdapter;
    catalogListings?: CatalogListingsReadAdapter;
    catalogDemo?: Partial<FbaCatalogReportsDemoSource>;
    brandSalesDemo?: Partial<BrandSalesDemoSource>;
    catalogPace?: (
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void>;
    catalogNow?: () => Date;
    aplusContentReads?: AplusContentReadsPort;
    aPlusAuditCoordinator?: AplusAuditCoordinatorPort;
    standaloneAuditCoordinator?: StandaloneAuditCoordinatorPort;
    legacyAuditSuiteCompatibility?: AuditSuiteCompatibilityCoordinatorPort;
    advertising?: AdvertisingGateway;
    spExecutionContext?: SpExecutionContextAdapter;
    writeGate?: MainWriteGatePort;
    priceMutations?: ListingPriceMutationsPort;
    listingImageMutations?: ListingImageMutationsPort;
    listingContentMutations?: ListingContentMutationsPort;
    listingContentBatchMutations?: ListingContentBatchMutationsPort;
    variationMoveMutations?: VariationMoveMutationsPort;
    businessPricingMutations?: BusinessPricingMutationsPort;
  }) {
    this.store = input.store;
    this.vault = input.vault;
    const baseSpExecutionContext = input.spExecutionContext
      ?? createProductionSpExecutionContextAdapter({
        getOpaqueAccountScope: (region) => this.vault.getAccountScope(region),
        resolveMode: (marketplaceId) => usesDemoMode(marketplaceId) ? "demo" : "live",
        onContextChanged: (reason) => {
          this.invalidateContextBoundState(reason, true);
        },
      });
    this.spExecutionContext = createRouterRequestContextAdapter(
      baseSpExecutionContext,
    );
    this.writeGate = input.writeGate ?? new MainWriteGate({
      store: this.store,
      context: this.spExecutionContext,
      approveWrite: input.approveWrite,
    });
    this.priceMutations = input.priceMutations ?? createListingPriceMutations({
      context: this.spExecutionContext,
      writeGate: this.writeGate,
      gateway: listingPriceGatewayProduction,
    });
    this.listingImageMutations = input.listingImageMutations ??
      createListingImageMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        gateway: listingImageGatewayProduction,
      });
    this.listingContentMutations = input.listingContentMutations ??
      createListingContentMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        gateway: listingContentGatewayProduction,
      });
    this.listingContentBatchMutations = input.listingContentBatchMutations ??
      createListingContentBatchMutations({
        evidence: this.store,
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        content: this.listingContentMutations,
      });
    this.variationMoveMutations = input.variationMoveMutations ??
      createVariationMoveMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        gateway: variationMoveGatewayProduction,
      });
    this.businessPricingMutations = input.businessPricingMutations ??
      createBusinessPricingMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        priceObserver: this.priceMutations,
        gateway: businessPricingGatewayProduction,
      });
    const advertising = input.advertising ?? null;
    this.allListingsDemoReports = {
      start: (request) => startDemoFixedReport({
        intent: "all-listings",
        ...request,
      }),
      status: (request) => statusDemoFixedReport({
        intent: "all-listings",
        ...request,
      }),
      ...input.allListingsDemoReports,
    };
    this.businessPricingActiveListingsReports = {
      start: (request) => startDemoFixedReport({
        intent: "active-business-listings",
        ...request,
      }),
      status: (request) => statusDemoFixedReport({
        intent: "active-business-listings",
        ...request,
      }),
      ...input.businessPricingActiveListingsReports,
    };
    const inboundNoncomplianceDemoReports = {
      start: startDemoInboundNoncomplianceReport,
      status: statusDemoInboundNoncomplianceReport,
      document: readDemoInboundNoncomplianceDocument,
      ...input.inboundNoncomplianceDemoReports,
    };
    const compatibilityReportsAdapter = input.demoReportsAdapter ?? routerDemoReportsAdapter({
      allListings: this.allListingsDemoReports,
      activeBusiness: this.businessPricingActiveListingsReports,
      inboundNoncompliance: inboundNoncomplianceDemoReports,
    });
    const liveReportsAdapter = input.reportsAdapter ??
      reportsRuntimeProductionAdapter;
    const reportsAdapter: ReportsAdapter = {
      create: (request) => (request.mode === "live"
        ? liveReportsAdapter
        : compatibilityReportsAdapter).create(request),
      status: (request) => (request.mode === "live"
        ? liveReportsAdapter
        : compatibilityReportsAdapter).status(request),
      readDocument: (request) => (request.mode === "live"
        ? liveReportsAdapter
        : compatibilityReportsAdapter).readDocument(request),
    };
    this.reportBroker = new FixedReportBroker({
      store: this.store,
      context: this.spExecutionContext,
      reportsAdapter,
      advertising,
    });
    this.agedInventoryReads = input.agedInventoryReads ?? new AgedInventoryReads({
      reports: this.reportBroker,
      context: this.spExecutionContext,
    });
    const defaultFbaInboundReads = new FbaInboundReads({
      adapter: fbaInboundExternalReadAdapterProduction,
      reports: this.reportBroker,
      context: this.spExecutionContext,
    });
    const fbaInboundReads: FbaInboundReadsPort = {
      readShipments: (request) => defaultFbaInboundReads.readShipments(request),
      readNoncompliance: (request) =>
        defaultFbaInboundReads.readNoncompliance(request),
      ...input.fbaInboundReads,
    };
    this.fbaInboundCoordinator = input.fbaInboundCoordinator ??
      new FbaInboundCoordinator({
        reads: fbaInboundReads,
        context: this.spExecutionContext,
      });
    const defaultCatalogDemo: FbaCatalogReportsDemoSource = {
      ...catalogReportsDemoSource,
      ...input.catalogDemo,
    };
    this.salesAndTraffic = new SalesAndTrafficReports({
      reports: this.reportBroker,
      context: this.spExecutionContext,
      liveReader: input.salesAndTrafficRead,
      demo: {
        ...createSalesAndTrafficDemoSource({
          listings: async ({ marketplaceId, signal }) =>
            (await defaultCatalogDemo.identity({ marketplaceId, signal })).rows,
        }),
        ...input.salesAndTrafficDemo,
      },
    });
    this.catalogListings = input.catalogListings ??
      catalogListingsReadAdapterProduction;
    this.fbaCatalogReports = new FbaCatalogReports({
      reports: this.reportBroker,
      context: this.spExecutionContext,
      listings: this.catalogListings,
      demo: defaultCatalogDemo,
      pace: input.catalogPace,
      now: input.catalogNow,
    });
    const auditSuiteResources = new AuditSuiteCatalogResources({
      context: this.spExecutionContext,
      catalog: this.fbaCatalogReports,
      readGrouping: (request) => getFbaVariationGroupingData(request),
    });
    this.subscriptionAuditOwner = input.subscriptionAudit ??
      new SubscriptionAuditOwner({
        context: this.spExecutionContext,
        readSnapshot: async ({ marketplaceId, months, signal }) =>
          getFbaSubscriptionAudit({ marketplaceId, months, signal }),
      });
    this.unboundVariationAuditOwner = input.unboundVariationAudit ??
      new UnboundVariationAuditOwner({
        context: this.spExecutionContext,
        source: {
          begin: (request) => this.fbaCatalogReports.begin({
            purpose: "catalog",
            ...request,
        }),
          status: (request) => this.fbaCatalogReports.status(request),
          read: (request) => this.getSharedUnboundVariationAuditData(request),
        },
      });
    this.businessPricingAuditOwner = input.businessPricingAudit ??
      new BusinessPricingAudit({
        context: this.spExecutionContext,
        startReport: (request) => this.fbaCatalogReports.begin({
          purpose: "business-pricing-audit",
          ...request,
        }),
        statusReport: (request) => this.fbaCatalogReports.status(request),
        readReport: (request) => this.getSharedBusinessPricingAuditData(request),
        getStandaloneJob: (request) =>
          this.standaloneAuditCoordinator.getJob(request),
      });
    this.agedInventoryAuditOwner = input.agedInventoryAudit ??
      new AgedInventoryAudit({
        context: this.spExecutionContext,
        beginReport: (request) => this.agedInventoryReads.begin(request),
        statusReport: (request) => this.agedInventoryReads.status(request),
        readReport: (request) => this.agedInventoryReads.read(request),
      });
    this.listingsExportOwner = input.listingsExport ?? new ListingsExport({
      context: this.spExecutionContext,
      startReport: (request) => this.fbaCatalogReports.begin({
        purpose: "catalog",
        ...request,
      }),
      statusReport: (request) => this.fbaCatalogReports.status(request),
      readReport: (request) => this.fbaCatalogReports.read({
        view: "export",
        ...request,
      }),
    });
    this.contentAuditOwner = input.contentAudit ?? new ContentAuditOwner({
      context: this.spExecutionContext,
      readGrouping: (request) => getFbaVariationGroupingData(request),
      evidence: {
        saveContentAuditSnapshotEvidence: (evidence) =>
          this.store.saveContentAuditSnapshotEvidence(evidence),
      },
    });
    this.imageAuditOwner = input.imageAudit ?? new ImageAuditOwner({
      context: this.spExecutionContext,
      readGrouping: (request) => getFbaVariationGroupingData(request),
    });
    this.brandSalesCoordinator = input.brandSalesCoordinator ??
      createBrandSalesCoordinator({
        store: this.store,
        reports: this.reportBroker,
        catalog: this.fbaCatalogReports,
        context: this.spExecutionContext,
        demo: {
          ...createBrandSalesDemoSource({
            listings: ({ marketplaceId, signal }) =>
              defaultCatalogDemo.seeds({ marketplaceId, signal }),
        }),
          ...input.brandSalesDemo,
        },
      });
    this.advertisingCoordinator = input.advertisingCoordinator ??
      new ReadOnlyAdvertisingCoordinator({
        context: this.spExecutionContext,
        advertising,
        reports: this.reportBroker,
        catalog: this.fbaCatalogReports,
        salesAndTraffic: this.salesAndTraffic,
        listingsExport: this.listingsExportOwner,
        loadAuditSuiteListings: (context, control) =>
          auditSuiteResources.listings(context, control),
        strategySources: {
          fbaListings: (request) => this.fbaCatalogReports.read({
            view: "identity",
            ...request,
          }),
          ...input.advertisingStrategySources,
        },
        wait: input.advertisingStrategyWait,
      });
    const reviewAuditCandidates = input.reviewAuditCandidates ?? (async (request) =>
      request.mode === "demo"
        ? getDemoFbaReviewAuditCandidates({
            marketplaceId: request.marketplaceId,
            signal: request.signal,
          })
        : verifyFbaReviewAuditSeeds(this.catalogListings, {
            marketplaceId: request.marketplaceId,
            seeds: request.seeds,
            signal: request.signal,
          }));
    const customerFeedbackReads = input.customerFeedbackReads ??
      new CustomerFeedbackReads({
        context: this.spExecutionContext,
        live: customerFeedbackPageAdapterProduction,
      });
    this.reviewAuditCoordinator = input.reviewAuditCoordinator ??
      new ReviewAuditCoordinator({
        context: this.spExecutionContext,
        resolveMode: (marketplaceId) =>
          usesDemoMode(marketplaceId) ? "demo" : "live",
        listings: this.listingsExportOwner,
        readCatalogSeeds: (request) => this.fbaCatalogReports.read({
          view: "seeds",
          ...request,
        }),
        readCandidates: reviewAuditCandidates,
        customerFeedback: customerFeedbackReads,
      });
    this.ordersReads = input.ordersReads ?? new OrdersReads({
      context: this.spExecutionContext,
      live: ordersPageAdapterProduction,
      isConfiguredForMarketplace,
    });
    this.statelessCapabilities = input.statelessCapabilities ??
      new StatelessCapabilityRoutes({
        context: this.spExecutionContext,
        orders: this.ordersReads,
        searchListings: searchListingsBySku,
        readSubscription: getSubscribeAndSaveOffer,
        readVariationFamily: getVariationFamilyPlanner,
      });
    this.imageUpload = input.imageUpload ?? new LocalImageUpload({
      context: this.spExecutionContext,
      vault: this.vault,
    });
    this.health = input.health ?? new SystemHealthRoute({
      getCredentialSummary: () => this.vault.getSummary(),
      usesDemoMode,
    });
    this.planningCapabilities = input.planningCapabilities ??
      new PlanningCapabilityRoutes();
    this.productMasterRoutes = input.productMasterRoutes ??
      new ProductMasterRoutes({
        context: this.spExecutionContext,
        store: this.store,
      });
    this.skuCommandRoute = input.skuCommandRoute ?? new SkuCommandRoute({
      command: new SkuCommand({
        context: this.spExecutionContext,
        productMaster: {
          get: (accountScope, marketplaceId, sellerSku) =>
            this.store.getProductMaster(
              accountScope,
              marketplaceId,
              sellerSku,
            ),
          syncIdentity: (identity) => this.store.syncProductIdentity(identity),
        },
        reads: {
          price: (identity, context) =>
            this.priceMutations.read(identity, context),
          content: (identity, context) =>
            this.listingContentMutations.readOne(identity, context),
          images: (identity, context) =>
            this.listingImageMutations.read(identity, context),
          subscribeSave: getSubscribeAndSaveOffer,
          restock: getRestockPlan,
        },
      }),
    });
    this.fbaSalesMetricsRoutes = input.fbaSalesMetricsRoutes ??
      new FbaSalesMetricsRoutes({
        context: this.spExecutionContext,
        salesTrend: getSalesTrend,
        replenishment: getRestockPlan,
      });
    this.aplusContentReads = input.aplusContentReads ?? new AplusContentReads({
      context: this.spExecutionContext,
      live: aplusContentPageAdapterProduction,
    });
    this.aPlusAuditCoordinator = input.aPlusAuditCoordinator ??
      new AplusAuditCoordinator({
        context: this.spExecutionContext,
        listingsExport: this.listingsExportOwner,
        readGrouping: (request) => getFbaVariationGroupingData(request),
        contentReads: this.aplusContentReads,
      });
    this.standaloneAuditCoordinator = input.standaloneAuditCoordinator ??
      new StandaloneAuditCoordinator({
        context: this.spExecutionContext,
        subscription: this.subscriptionAuditOwner,
        agedInventory: this.agedInventoryAuditOwner,
        listingsExport: this.listingsExportOwner,
        content: this.contentAuditOwner,
        image: this.imageAuditOwner,
        variation: this.unboundVariationAuditOwner,
        businessPricing: this.businessPricingAuditOwner,
        advertising: this.advertisingCoordinator,
      });
    this.legacyAuditSuiteCompatibility =
      input.legacyAuditSuiteCompatibility ??
        new AuditSuiteCompatibilityCoordinator({
          context: this.spExecutionContext,
          resources: auditSuiteResources,
          content: this.contentAuditOwner,
          image: this.imageAuditOwner,
          aplus: this.aPlusAuditCoordinator,
          variation: this.unboundVariationAuditOwner,
          subscription: this.subscriptionAuditOwner,
          businessPricing: this.businessPricingAuditOwner,
          advertising: this.advertisingCoordinator,
        });
  }

  private clearContextBoundState(): void {
    this.contextStateRevision += 1;
    this.reportBroker.clear();
    this.advertisingCoordinator.clear();
    this.brandSalesCoordinator.clear();
    this.businessPricingAuditOwner.clear();
    this.subscriptionAuditOwner.clear();
    this.unboundVariationAuditOwner.clear();
    this.agedInventoryAuditOwner.clear();
    this.contentAuditOwner.clear();
    this.imageAuditOwner.clear();
    this.reviewAuditCoordinator.clear();
    this.aPlusAuditCoordinator.clear();
    this.listingsExportOwner.clear();
    this.standaloneAuditCoordinator.clear();
    this.writeGate.clearEphemeral();
    this.listingContentBatchMutations.clear();
    this.fbaInboundCoordinator.clear();
    this.legacyAuditSuiteCompatibility.clear();
    // The long-lived Customer Feedback production adapter intentionally keeps
    // its pacing slot. A context change must not bypass the App-session-wide
    // one-request-per-second boundary.
  }

  private invalidateContextBoundState(
    reason: SpExecutionContextInvalidationReason,
    contextAlreadyInvalidated: boolean,
  ): void {
    if (!contextAlreadyInvalidated) this.spExecutionContext.invalidate(reason);
    invalidateSpApiCredentialCaches({ preserveRateLimitPacing: true });
    this.clearContextBoundState();
  }

  invalidateContext(reason: SpExecutionContextInvalidationReason): void {
    this.invalidateContextBoundState(reason, false);
  }

  dispose(): void {
    this.clearContextBoundState();
  }

  private assertContextStateRevision(expected: number): void {
    if (expected === this.contextStateRevision) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    if (!this.validEnvelope(request)) {
      return invalid("App 內部請求格式無效。", 400, "INVALID_REQUEST");
    }
    const operationStateRevision = this.contextStateRevision;
    try {
      return await this.spExecutionContext.runOperation(async () => {
        let response: ApiResponse;
        try {
          response = await this.route(request);
        } catch (error) {
          try {
            await this.spExecutionContext.assertOperationCurrent();
          } catch (contextError) {
            if (
              contextError instanceof SpExecutionContextError &&
              this.contextStateRevision === operationStateRevision
            ) {
              this.clearContextBoundState();
            }
          }
          throw error;
        }
        if (response.status < 400) {
          await this.spExecutionContext.assertOperationCurrent();
        }
        return response;
      });
    } catch (error) {
      if (
        error instanceof SpExecutionContextError &&
        this.contextStateRevision === operationStateRevision
      ) {
        this.clearContextBoundState();
      }
      return apiError(error, "執行本機 Amazon 操作時發生未預期的錯誤。");
    }
  }

  async testConnections(): Promise<ConnectionTestResult> {
    const operationStateRevision = this.contextStateRevision;
    const summary = await this.vault.getSummary();
    this.assertContextStateRevision(operationStateRevision);
    const representatives: Record<"na" | "fe" | "eu", MarketplaceId> = {
      na: marketplaceByCode("US").id,
      fe: marketplaceByCode("JP").id,
      eu: marketplaceByCode("UK").id,
    };
    const result: ConnectionTestResult = {
      ok: false,
      testedAt: new Date().toISOString(),
      regions: {},
    };
    for (const region of ["na", "fe", "eu"] as const) {
      this.assertContextStateRevision(operationStateRevision);
      if (!summary.regions[region].configured) continue;
      result.regions[region] = await this.spExecutionContext.runOperation(async () => {
        this.assertContextStateRevision(operationStateRevision);
        const marketplaceId = representatives[region];
        const context = await this.spExecutionContext.capture(marketplaceId);
        const regionResult = await testRegionConnections({
          orders: () => this.ordersReads.read({
            intent: "connection-probe",
            marketplaceId,
          }),
          listings: () => verifyListingsAccess(marketplaceId),
        });
        await this.spExecutionContext.assertCurrent(context);
        this.assertContextStateRevision(operationStateRevision);
        return regionResult;
      });
      this.assertContextStateRevision(operationStateRevision);
    }
    const tested = Object.values(result.regions);
    result.ok = tested.length > 0 && tested.every((item) => item?.ok);
    this.assertContextStateRevision(operationStateRevision);
    return result;
  }

  private validEnvelope(request: ApiRequest): boolean {
    return Boolean(
      request &&
        isPlainRecord(request) &&
        typeof request.requestId === "string" &&
        /^[A-Za-z0-9-]{8,100}$/.test(request.requestId) &&
        ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        typeof request.path === "string" &&
        request.path.startsWith("/api/") &&
        request.path.length <= 200 &&
        isStringRecord(request.query) &&
        isStringRecord(request.headers) &&
        (request.body === undefined || validApiBody(request.body)),
    );
  }

  private async route(request: ApiRequest): Promise<ApiResponse> {
    const key = `${request.method} ${request.path}`;
    switch (key) {
      case "GET /api/sp-api/orders":
        return this.statelessCapabilities.orders(request);
      case "GET /api/sp-api/sales-trend":
        return this.fbaSalesMetricsRoutes.salesTrend(request);
      case "POST /api/sp-api/brand-sales":
        return this.brandSalesCoordinator.start(request);
      case "GET /api/sp-api/brand-sales":
        return this.brandSalesCoordinator.observe(request);
      case "POST /api/sp-api/inbound-shipments":
        return this.fbaInboundCoordinator.start(request);
      case "GET /api/sp-api/inbound-shipments":
        return this.fbaInboundCoordinator.status(request);
      case "GET /api/sp-api/listings":
        return this.priceMutations.handle({
          family: "standard-price",
          operation: "read",
          request,
        });
      case "POST /api/sp-api/listings":
        return this.priceMutations.handle({
          family: "standard-price",
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/listings":
        return this.priceMutations.handle({
          family: "standard-price",
          operation: "commit",
          request,
        });
      case "POST /api/sp-api/business-pricing-audit":
        return this.businessPricingAuditOwner.start(request);
      case "GET /api/sp-api/business-pricing-audit":
        return this.businessPricingAuditOwner.statusOrData(request);
      case "GET /api/sp-api/business-pricing-audit/export":
        return this.businessPricingAuditOwner.download(request);
      case "GET /api/sp-api/business-pricing":
        return this.businessPricingMutations.handle({
          operation: "read",
          request,
        });
      case "POST /api/sp-api/business-pricing":
        return this.businessPricingMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/business-pricing":
        return this.businessPricingMutations.handle({
          operation: "commit",
          request,
        });
      case "POST /api/sp-api/listings/batch":
        return this.statelessCapabilities.batchListings(request);
      case "GET /api/sp-api/listing-content":
        return this.listingContentMutations.handle({
          operation: "read",
          request,
        });
      case "POST /api/sp-api/listing-content":
        return this.listingContentMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/listing-content":
        return this.listingContentMutations.handle({
          operation: "commit",
          request,
        });
      case "POST /api/sp-api/listing-content/import":
        return this.listingContentBatchMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/listing-content/import":
        return this.listingContentBatchMutations.handle({
          operation: "commit",
          request,
        });
      case "GET /api/sp-api/listing-images":
        return this.listingImageMutations.handle({
          operation: "read",
          request,
        });
      case "POST /api/sp-api/listing-images":
        return this.listingImageMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/listing-images":
        return this.listingImageMutations.handle({
          operation: "commit",
          request,
        });
      case "POST /api/sp-api/sale-price":
        return this.priceMutations.handle({
          family: "sale-price",
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/sale-price":
        return this.priceMutations.handle({
          family: "sale-price",
          operation: "commit",
          request,
        });
      case "GET /api/sp-api/subscribe-save":
        return this.statelessCapabilities.subscribeSave(request);
      case "GET /api/sp-api/subscription-audit":
        return this.subscriptionAuditOwner.read(request);
      case "GET /api/sp-api/subscription-audit/export":
        return this.subscriptionAuditOwner.download(request);
      case "GET /api/sp-api/accounting/capabilities":
        return this.planningCapabilities.accountingCapabilities(request);
      case "POST /api/sp-api/accounting/access-plan":
        return this.planningCapabilities.accountingAccessPlan(request);
      case "GET /api/sp-api/report-library":
        return this.planningCapabilities.reportLibrary(request);
      case "POST /api/sp-api/report-library/access-plan":
        return this.planningCapabilities.reportLibraryAccessPlan(request);
      case "POST /api/sp-api/review-audit":
        return this.reviewAuditCoordinator.start(request);
      case "GET /api/sp-api/review-audit":
        return this.reviewAuditCoordinator.observe(request);
      case "GET /api/sp-api/review-audit/export":
        return this.reviewAuditCoordinator.download(request);
      case "GET /api/sp-api/replenishment-plan":
        return this.fbaSalesMetricsRoutes.replenishment(request);
      case "POST /api/sp-api/aged-inventory":
        return this.agedInventoryAuditOwner.start(request);
      case "GET /api/sp-api/aged-inventory":
        return this.agedInventoryAuditOwner.statusDataOrDownload(request);
      case "GET /api/sp-api/variation-family":
        return this.statelessCapabilities.variationFamily(request);
      case "POST /api/sp-api/variation-audit":
        return this.unboundVariationAuditOwner.start(request);
      case "GET /api/sp-api/variation-audit":
        return this.unboundVariationAuditOwner.statusDataOrDownload(request);
      case "GET /api/sp-api/variation-move":
        return this.variationMoveMutations.handle({
          operation: "prepare",
          request,
        });
      case "POST /api/sp-api/variation-move":
        return this.variationMoveMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/variation-move":
        return this.variationMoveMutations.handle({
          operation: "commit",
          request,
        });
      case "GET /api/sp-api/sku-command":
        return this.skuCommandRoute.skuCommand(request);
      case "GET /api/product-master":
        return this.productMasterRoutes.getProductMaster(request);
      case "PUT /api/product-master":
        return this.productMasterRoutes.putProductMaster(request);
      case "POST /api/uploads/listing-images":
        return this.imageUpload.uploadImage(request);
      case "POST /api/sp-api/listing-content/export":
        return this.startExport(request);
      case "GET /api/sp-api/listing-content/export":
        return this.exportStatusOrDownload(request);
      case "GET /api/system/health":
        return this.health.systemHealth(request);
      case "GET /api/amazon-ads/status":
        return this.advertisingCoordinator.status(request);
      case "GET /api/amazon-ads/coverage":
        return this.advertisingCoordinator.coverage(request);
      case "POST /api/amazon-ads/strategy":
        return this.advertisingCoordinator.startStrategy(request);
      case "GET /api/amazon-ads/strategy":
        return this.advertisingCoordinator.observeStrategy(request);
      case "POST /api/sp-api/a-plus-audit":
        return this.aPlusAuditCoordinator.start(request);
      case "GET /api/sp-api/a-plus-audit":
        return this.aPlusAuditCoordinator.observe(request);
      case "POST /api/sp-api/audit-suite":
        return this.legacyAuditSuiteCompatibility.start(request);
      case "GET /api/sp-api/audit-suite":
        return this.legacyAuditSuiteCompatibility.observe(request);
      case "GET /api/sp-api/audit-suite/export":
        return this.legacyAuditSuiteCompatibility.download(request);
      case "POST /api/sp-api/standalone-audit":
        return this.standaloneAuditCoordinator.start(request);
      case "GET /api/sp-api/standalone-audit":
        return this.standaloneAuditCoordinator.observe(request);
      default:
        return invalid("此 App 版本不支援這個操作。", 404, "NOT_FOUND");
    }
  }

  private async getSharedUnboundVariationAuditData(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      reportId: string;
      documentId: string;
      signal?: AbortSignal;
      expectedContext?: SpExecutionContext;
    }>,
  ): Promise<UnboundVariationAuditSnapshot> {
    const context = input.expectedContext ??
      await this.spExecutionContext.capture(input.marketplaceId);
    if (input.expectedContext) {
      await this.spExecutionContext.assertCurrent(input.expectedContext);
    }
    const seeds = await this.fbaCatalogReports.read({
      view: "seeds",
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      documentId: input.documentId,
      signal: input.signal,
      expectedContext: context,
    });
    if (context.mode === "demo") {
      const snapshot = await getDemoUnboundVariationAuditData({
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      });
      await this.spExecutionContext.assertCurrent(context);
      return snapshot;
    }
    const snapshot = await readUnboundVariationAudit(this.catalogListings, {
      marketplaceId: input.marketplaceId,
      seeds,
      signal: input.signal,
    });
    await this.spExecutionContext.assertCurrent(context);
    return snapshot;
  }

  private async getSharedBusinessPricingAuditData(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      reportId: string;
      documentId: string;
      signal?: AbortSignal;
      heartbeat?: () => void;
      expectedContext?: SpExecutionContext;
    }>,
  ): Promise<BusinessPricingAuditSnapshot> {
    return this.fbaCatalogReports.read({
      view: "business-pricing-audit",
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      documentId: input.documentId,
      signal: input.signal,
      heartbeat: input.heartbeat,
      expectedContext: input.expectedContext,
    });
  }

  private async startExport(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) return invalid("請選擇要匯出的 Amazon 站點。");
    try {
      const status = await this.listingsExportOwner.start({ marketplaceId });
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return apiError(error, "開始建立全商品 Excel 時發生未預期的錯誤。");
    }
  }

  private async exportStatusOrDownload(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const auditRequested = request.query.audit === "1";
    const imageAuditRequested = request.query.imageAudit === "1";
    if (!marketplaceId) return invalid("報表站點資訊無效，請重新匯出。");
    if (auditRequested && imageAuditRequested) {
      return invalid("一次只能執行一種全站健檢。");
    }
    if (auditRequested && request.query.download === "1") {
      const exportId = this.reportIdentifier(request.query.exportId);
      if (!exportId) {
        return invalid("文案健檢 Excel 快照資訊無效，請重新掃描。");
      }
      try {
        return await this.contentAuditOwner.download({ marketplaceId, exportId });
      } catch (error) {
        return apiError(error, "建立文案健檢 Excel 時發生未預期的錯誤。");
      }
    }
    if (imageAuditRequested && request.query.download === "1") {
      const exportId = this.reportIdentifier(request.query.exportId);
      if (!exportId) {
        return invalid("圖片健檢 Excel 快照資訊無效，請重新掃描。");
      }
      try {
        return await this.imageAuditOwner.download({ marketplaceId, exportId });
      } catch (error) {
        return apiError(error, "建立圖片健檢 Excel 時發生未預期的錯誤。");
      }
    }
    const reportId = this.reportIdentifier(request.query.reportId);
    if (!reportId) return invalid("報表查詢資訊無效，請重新匯出。");
    if (request.query.download !== "1" && !auditRequested && !imageAuditRequested) {
      try {
        const status = await this.listingsExportOwner.status({
          marketplaceId,
          reportId,
        });
        return json({ ...status, message: status.notice });
      } catch (error) {
        return apiError(error, "查詢全商品報表狀態時發生未預期的錯誤。");
      }
    }
    const documentId = this.reportIdentifier(request.query.documentId);
    if (!documentId) return invalid("報表文件資訊無效，請重新匯出。");
    try {
      const captured = await this.listingsExportOwner.capture({
        marketplaceId,
        reportId,
        documentId,
      });
      const { context, snapshot: data } = captured;
      if (auditRequested || imageAuditRequested) {
        if (auditRequested) {
          return json(await this.contentAuditOwner.captureFromListings({
            context,
            marketplaceId,
            listings: data,
          }));
        }
        return json(await this.imageAuditOwner.captureFromListings({
          context,
          marketplaceId,
          listings: data,
        }));
      }
      return await this.listingsExportOwner.download({
        marketplaceId,
        exportId: captured.exportId,
      });
    } catch (error) {
      return apiError(error, "建立全商品 Excel 時發生未預期的錯誤。");
    }
  }

  private reportIdentifier(value: unknown): string | null {
    return reportIdentifier(value);
  }

  private writeBinding(input: Readonly<{
    family: WritePreviewFamily;
    operation: WriteOperation;
    context: SpExecutionContext;
    sellerSku: string;
    idempotencyKey: string;
    proposalFingerprint: string;
  }>): WriteBinding {
    return {
      family: input.family,
      previewKey: input.idempotencyKey,
      context: input.context,
      intents: [{
        intentId: "primary",
        operation: input.operation,
        marketplaceId: input.context.marketplaceId,
        sellerSku: input.sellerSku,
        idempotencyKey: input.idempotencyKey,
        proposalFingerprint: input.proposalFingerprint,
      }],
    };
  }

}
