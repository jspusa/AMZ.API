import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  AdvertisingConnectionTestResult,
  ApiRequest,
  ApiResponse,
  ConnectionTestResult,
  CredentialSummary,
} from "../shared/contracts";
import {
  AdvertisingApiError,
  SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
  type AdvertisingGateway,
  type SponsoredProductsAdvertisedProductReport,
  type SponsoredProductsAdvertisedProductReportReference,
} from "./amazon/ads-api";
import { CredentialVault } from "./credential-vault";
import {
  isBrandSalesIncompatibleJob,
  LocalStore,
  type BrandSalesIncompatibleJobRecord,
  type BrandSalesJobRecord,
  type BrandSalesReportLeg,
  type ProductMasterState,
} from "./local-store";
import {
  PUBLIC_ACCOUNTING_CAPABILITIES,
  buildAccountingAccessPlan,
  type AccountingAccessPlan,
  type AccountingCapability,
  type AccountingCapabilityId,
} from "./amazon/accounting-capabilities";
import {
  CURRENT_APP_EXPORTS,
  PUBLIC_REPORT_CATALOG,
  REPORT_LIBRARY_NOTICE,
  REPORT_LIBRARY_UNAVAILABLE_DOCUMENTS,
  buildReportAccessPlan,
} from "./amazon/report-library";
import {
  REVIEW_AUDIT_CAPABILITY,
  buildReviewAuditSnapshot,
  customerFeedbackMarketplaceSupported,
  type DedupedFbaReviewCandidate,
  type ReviewAuditCandidateCoverage,
  type ReviewAuditFetchResult,
  type ReviewAuditRelationshipIncompleteRow,
  type ReviewAuditSnapshot,
} from "./amazon/review-audit";
import {
  auditListingContentRows,
  type ContentQualityAudit,
  type ContentQualityRow,
} from "./amazon/content-quality";
import {
  IMAGE_AUDIT_MINIMUM_IMAGES,
  auditListingImageRows,
} from "./amazon/image-audit";
import {
  auditAdvertisingCoverage,
  AdvertisingCoverageInputError,
  prepareAdvertisingCoverageListings,
  type AdvertisingCoverageCampaign,
} from "./amazon/advertising-coverage";
import {
  publicSpApiError,
  SpApiError,
  SpApiPreCommitError,
} from "./amazon/sp-api-error";
import {
  createProductionSpExecutionContextAdapter,
  type SpExecutionContextAdapter,
  type SpExecutionContextInvalidationReason,
} from "./amazon/sp-execution-context";
import {
  MARKETPLACES,
  catalogListingsReadAdapterProduction,
  catalogReportsDemoSource,
  getAgedInventoryData,
  getAgedInventoryDataFromDocument,
  getAgedInventoryReportStatus,
  getBrandSalesDataFromDocuments,
  getBrandSalesReportWindow,
  getFbaVariationGroupingData,
  getFbaShipmentSalesReportStatus,
  getFbaInboundShipmentSnapshot,
  getInboundNoncomplianceReportDocument,
  getInboundNoncomplianceReportStatus,
  getListingContent,
  getListingImages,
  getListingPrice,
  getBusinessPricing,
  getAplusContentDocumentAsinRelationsPage,
  getAplusContentDocumentsPage,
  getAplusContentPublishRecordsPage,
  getRestockPlan,
  getSalesTrend,
  getSalesAndTrafficReportData,
  getSalesAndTrafficReportDataFromDocument,
  getSalesAndTrafficReportStatus,
  getFbaSubscriptionAudit,
  getCustomerFeedbackReviewTopics,
  getDemoFbaReviewAuditCandidates,
  getDemoUnboundVariationAuditData,
  getSubscribeAndSaveOffer,
  getVariationFamilyPlanner,
  getVariationMovePreparation,
  isFulfillmentStatus,
  isMarketplaceId,
  invalidateSpApiCredentialCaches,
  previewListingContentUpdate,
  previewBusinessPriceUpdate,
  previewListingImageUpdate,
  previewListingPriceUpdate,
  previewListingSalePriceUpdate,
  previewVariationMove,
  reportsRuntimeProductionAdapter,
  searchListingsBySku,
  searchOrders,
  startAgedInventoryReport,
  startFbaShipmentSalesReport,
  startInboundNoncomplianceReport,
  startSalesAndTrafficReport,
  updateListingContent,
  updateBusinessPrice,
  updateListingImages,
  updateListingPrice,
  updateListingSalePrice,
  updateVariationMove,
  usesDemoMode,
  verifyListingsAccess,
  type ListingContentSnapshot,
  type BusinessPricingListingSnapshot,
  type BusinessPricePrecommitEvidence,
  type BusinessPriceValidationResult,
  type ListingContentValidationResult,
  type ListingContentUpdateResult,
  type ListingImageSnapshot,
  type ListingPriceSnapshot,
  type MarketplaceId,
  type BrandSalesSnapshot,
  type FbaInboundShipmentSnapshot,
  type RestockPlanSnapshot,
  type SalesTrendComparisonMode,
  type SalesTrendPresetDays,
  type SalesAndTrafficSnapshot,
  type SubscribeAndSaveOfferSnapshot,
  type SubscriptionAuditSnapshot,
  type UpdateListingContentInput,
  type UpdateBusinessPriceInput,
  type UpdateListingSalePriceInput,
  type FbaVariationGroupingData,
  type VariationMoveInput,
} from "./amazon/sp-api";
import {
  FbaCatalogReports,
  type FbaCatalogReportsDemoSource,
  type FbaCatalogReportsPurpose,
} from "./amazon/fba-catalog-reports";
import type {
  BusinessPricingAuditSnapshot,
  CatalogExportProgress,
  CatalogListingsReadAdapter,
  FbaCatalogExport,
  FbaCatalogIdentitySnapshot as FbaListingIdentitySnapshot,
} from "./amazon/catalog-report-reads";
import {
  readUnboundVariationAudit,
  verifyFbaReviewAuditSeeds,
  type FbaReviewAuditSeed,
  type ReviewAuditCandidateSnapshot,
  type UnboundVariationAuditSnapshot,
} from "./amazon/variation-catalog-reads";
import {
  isDateOnly,
  marketplaceCalendar,
} from "./amazon/marketplace-calendar";
import {
  buildAdvertisingStrategySnapshot,
  type AdvertisingStrategySnapshot,
} from "./amazon/advertising-strategy";
import {
  buildInboundIssueReportSnapshot,
  parseInboundNoncomplianceReport,
  type InboundIssueReportSnapshot,
  type ParsedInboundNoncomplianceReport,
} from "./amazon/inbound-noncompliance";
import {
  ReplenishmentAuditError,
  subscriptionAuditDiscountBucket,
} from "./amazon/replenishment-audit";
import { createSubscriptionAuditWorkbook } from "./amazon/subscription-audit-xlsx";
import { createBusinessPricingAuditWorkbook } from "./amazon/business-pricing-audit-xlsx";
import { createReviewAuditWorkbook } from "./amazon/review-audit-xlsx";
import {
  createAgedInventoryWorkbook,
  createImageAuditWorkbook,
  createListingsWorkbook,
  createUnboundVariationWorkbook,
} from "./amazon/xlsx";
import {
  ContentAuditWorkbookError,
  parseContentAuditWorkbook,
  type ParsedContentAuditValues,
} from "./amazon/content-audit-workbook-parser";
import {
  createAuditSuiteWorkbook,
  type APlusAuditProblemRow,
  type AdvertisingCoverageAuditRow,
  type AuditSuiteWorkbookInput,
  type ValidatedAuditSuiteSnapshot,
} from "./amazon/audit-suite-xlsx";
import {
  AuditSuiteCoordinator,
  AuditSuiteCoordinatorError,
  createAuditSuiteResourceKey,
  type AuditSuiteRunControl,
} from "./amazon/audit-suite-coordinator";
import {
  buildAplusAuditSeedsFromFbaGrouping,
  runAplusAudit,
  type AplusAuditSnapshot,
  type AplusAuditSeed,
  type AplusContentDocumentFetchInput,
  type AplusContentDocumentRelationFetchInput,
  type AplusPublishRecordFetchInput,
} from "./amazon/a-plus-audit";
import {
  AplusAuditJobCoordinator,
  AplusAuditJobCoordinatorError,
  type AplusAuditJobBoundContext,
  type AplusAuditJobGateway,
  type AplusAuditJobMode,
} from "./amazon/a-plus-audit-job";
import {
  StandaloneAuditJobCoordinator,
  StandaloneAuditJobCoordinatorError,
  type StandaloneAuditJobBoundContext,
  type StandaloneAuditJobGateway,
  type StandaloneAuditKind,
} from "./amazon/standalone-audit-job";
import {
  DurableReportLifecycle,
  type DurableReportGatewayStatus,
  type DurableReportIdentity,
  type DurableReportStatus,
} from "./amazon/report-lifecycle";
import {
  ReportsRuntime,
  reportsAdapterIdentity,
  type ReportsAdapter,
  type ReportsIntentPlan,
} from "./amazon/reports-runtime";
import { testRegionConnections } from "./amazon/connection-health";
import {
  businessPriceReadbackDecision,
  commitWithCanonicalReadback,
  contentReadbackDecision,
  imageReadbackDecision,
  priceReadbackDecision,
  reconcileContentWrite,
  reconcileBusinessPriceWrite,
  reconcileImageWrite,
  reconcilePriceWrite,
  reconcileSalePriceWrite,
  salePriceReadbackDecision,
} from "./amazon/listing-write-readback";
import type { AuditSuiteContext } from "../shared/audit-suite";
import {
  DEFAULT_MARKETPLACE_ID,
  MARKETPLACES as MARKETPLACE_METADATA,
  marketplaceByCode,
} from "../shared/marketplaces";
import {
  abortableDelay as waitMilliseconds,
  throwIfAborted as assertBackgroundActive,
  waitForPromiseWithSignal,
} from "./abort-utils";

type WriteApproval = (reason: string) => Promise<void>;

type PreviewTicket = {
  path: string;
  fingerprint: string;
  expiresAt: number;
  reserved: boolean;
};

type ContentAuditVariationGrouping = {
  variationRole: "parent" | "child" | "standalone" | "unknown";
  variationParentSku: string | null;
  variationFamilyKey: string | null;
  variationTheme: string | null;
  relationshipStatus: "complete" | "incomplete";
  relationshipMessage: string | null;
};

type ContentBatchChange = {
  input: UpdateListingContentInput;
  fingerprint: string;
  ledgerKey: string;
  validation: ListingContentValidationResult;
};

type ContentBatchRowResult = {
  sellerSku: string;
  state: "verified" | "simulated" | "rejected" | "unknown" | "not-started";
  result: ListingContentUpdateResult | null;
  error: { code: string; message: string; requestId: string | null } | null;
};

type ContentBatchCommitResult = {
  previewId: string;
  marketplaceId: MarketplaceId;
  status: "COMPLETED" | "STOPPED_REJECTED" | "STOPPED_UNKNOWN";
  rows: ContentBatchRowResult[];
  completedAt: string;
  notice: string;
};

type ContentBatchPlan = {
  previewId: string;
  exportId: string;
  marketplaceId: MarketplaceId;
  accountScope: string;
  idempotencyKey: string;
  fingerprint: string;
  changes: ContentBatchChange[];
  expiresAt: number;
  state: "ready" | "committing" | "completed";
  result: ContentBatchCommitResult | null;
};

type CommandTask = {
  id: string;
  title: string;
  detail: string;
  automation: "automatic" | "one_click" | "manual";
  severity: "info" | "warning" | "critical";
  tool: "restock" | "copy" | "images" | "price" | "promotion" | null;
};

type ReviewAuditJob = {
  marketplaceId: MarketplaceId;
  accountScope: string;
  expiresAt: number;
  mode: "live" | "demo";
  listingReportId: string;
  listingDocumentId: string | null;
  listingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE";
  candidates: DedupedFbaReviewCandidate[] | null;
  sourceCandidateCount: number;
  candidateCoverage: ReviewAuditCandidateCoverage | null;
  relationshipIncompleteRows: ReviewAuditRelationshipIncompleteRow[];
  results: ReviewAuditFetchResult[];
  nextCandidateIndex: number;
  nextQueryAt: number;
  snapshot: ReviewAuditSnapshot | null;
  signal: AbortSignal;
  abort(): void;
  retainWhileActive: boolean;
};

type BrandSalesRuntimeJob = BrandSalesJobRecord & {
  snapshot: BrandSalesSnapshot | null;
};

type DemoFixedReportStart = (input: Readonly<{
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>) => Promise<DurableReportGatewayStatus>;

type DemoFixedReportStatus = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
}>) => Promise<DurableReportGatewayStatus>;

type BrandSalesReportGateway = {
  startListing: DemoFixedReportStart;
  startShipment: typeof startFbaShipmentSalesReport;
  getListingStatus: DemoFixedReportStatus;
  getShipmentStatus: typeof getFbaShipmentSalesReportStatus;
  getDataFromDocuments: typeof getBrandSalesDataFromDocuments;
  reportWindow: typeof getBrandSalesReportWindow;
};

type AgedInventoryReportGateway = {
  start: typeof startAgedInventoryReport;
  status: typeof getAgedInventoryReportStatus;
};

type BusinessPricingActiveListingsReportGateway = {
  start: DemoFixedReportStart;
  status: DemoFixedReportStatus;
};

type SalesAndTrafficReportGateway = {
  start: typeof startSalesAndTrafficReport;
  status: typeof getSalesAndTrafficReportStatus;
  data: typeof getSalesAndTrafficReportData;
  dataFromDocument: typeof getSalesAndTrafficReportDataFromDocument;
};

type AdvertisingStrategyReportGateway = AdvertisingGateway & Required<Pick<
  AdvertisingGateway,
  | "getCombinedAccountIdentity"
  | "createSponsoredProductsAdvertisedProductReport"
  | "getSponsoredProductsAdvertisedProductReportStatus"
  | "downloadSponsoredProductsAdvertisedProductReport"
>>;

type AdvertisingStrategySourceGateway = {
  fbaListings(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
  }>): Promise<FbaListingIdentitySnapshot>;
};

type ReviewAuditCandidateSource = (
  input: Readonly<{
    marketplaceId: MarketplaceId;
    mode: "live" | "demo";
    seeds: readonly FbaReviewAuditSeed[];
    signal?: AbortSignal;
  }>,
) => Promise<ReviewAuditCandidateSnapshot>;

type InboundShipmentGateway = {
  snapshot: typeof getFbaInboundShipmentSnapshot;
};

type InboundNoncomplianceReportGateway = {
  start: typeof startInboundNoncomplianceReport;
  status: typeof getInboundNoncomplianceReportStatus;
  document: typeof getInboundNoncomplianceReportDocument;
};

function demoReportReference(
  intent: "all-listings" | "active-business-listings",
  marketplaceId: MarketplaceId,
): string {
  return intent === "all-listings"
    ? `demo-${marketplaceId}`
    : `demo-b2b-active-${marketplaceId}`;
}

async function startDemoFixedReport(input: Readonly<{
  intent: "all-listings" | "active-business-listings";
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
      : "展示 Active Listings 報表已準備完成。",
  };
}

async function statusDemoFixedReport(input: Readonly<{
  intent: "all-listings" | "active-business-listings";
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
      : "展示 Active Listings 報表已準備完成。",
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

function routerDemoReportsAdapter(input: Readonly<{
  brand: BrandSalesReportGateway;
  aged: AgedInventoryReportGateway;
  activeBusiness: BusinessPricingActiveListingsReportGateway;
  salesAndTraffic: SalesAndTrafficReportGateway;
  inboundNoncompliance: InboundNoncomplianceReportGateway;
}>): ReportsAdapter {
  const identity = (
    request: ReportsIntentPlan & { mode: "live" | "demo" },
    result?: Readonly<{
      mode: "live" | "demo";
      dataStartTime?: string;
      dataEndTime?: string;
    }>,
  ) => {
    const expected = reportsAdapterIdentity(
      request as unknown as ReportsIntentPlan,
      result?.mode ?? request.mode,
    );
    return request.intent === "fba-shipment-sales" && result
      ? {
          ...expected,
          dataStartTime: result.dataStartTime ?? "",
          dataEndTime: result.dataEndTime ?? "",
        }
      : expected;
  };
  return {
    async create(request) {
      assertDemoReportsRequest(request);
      const result = request.intent === "all-listings"
        ? await input.brand.startListing({
            marketplaceId: request.marketplaceId,
            signal: request.signal,
          })
        : request.intent === "active-business-listings"
          ? await input.activeBusiness.start({
              marketplaceId: request.marketplaceId,
              signal: request.signal,
            })
          : request.intent === "aged-inventory"
            ? await input.aged.start({
                marketplaceId: request.marketplaceId,
                signal: request.signal,
              })
            : request.intent === "inbound-noncompliance"
              ? await input.inboundNoncompliance.start({
                  marketplaceId: request.marketplaceId,
                  signal: request.signal,
                })
              : request.intent === "sales-and-traffic-daily-sku"
                ? await input.salesAndTraffic.start({
                    marketplaceId: request.marketplaceId,
                    startDate: request.startDate,
                    endDate: request.endDate,
                    signal: request.signal,
                  })
                : await input.brand.startShipment({
                    marketplaceId: request.marketplaceId,
                    startDate: request.startDate,
                    endDate: request.endDate,
                    dataStartTime: request.dataStartTime,
                    dataEndTime: request.dataEndTime,
                    windowCreatedAt: request.windowCreatedAt,
                  });
      return { ...result, identity: identity(request, result) };
    },
    async status(request) {
      assertDemoReportsRequest(request);
      const result = request.intent === "all-listings"
        ? await input.brand.getListingStatus({
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
            ? await input.aged.status({
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
                ? await input.salesAndTraffic.status({
                    marketplaceId: request.marketplaceId,
                    reportId: request.reportId,
                    startDate: request.startDate,
                    endDate: request.endDate,
                    signal: request.signal,
                  })
                : await input.brand.getShipmentStatus({
                    marketplaceId: request.marketplaceId,
                    reportId: request.reportId,
                    startDate: request.startDate,
                    endDate: request.endDate,
                    dataStartTime: request.dataStartTime,
                    dataEndTime: request.dataEndTime,
                    windowCreatedAt: request.windowCreatedAt,
                  });
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

type AdvertisingStrategyProgress = Readonly<{
  phase: "fba" | "sales" | "ads" | "building";
  completed: number;
  total: 4;
}>;

type AdvertisingStrategyJobState = "running" | "completed" | "failed";

type AdvertisingStrategyJob = {
  jobId: string;
  marketplaceId: MarketplaceId;
  marketplaceCode: string;
  spAccountScope: string;
  adsAccountScope: string;
  adsProfileFingerprint: string;
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

type JsonRecord = Record<string, unknown>;

const JSON_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

const MARKETPLACE_CODES = Object.fromEntries(
  MARKETPLACE_METADATA.map((marketplace) => [
    marketplace.id,
    marketplace.code === "UK" ? "GB" : marketplace.code,
  ]),
) as Record<MarketplaceId, string>;

const SUBSCRIPTION_AUDIT_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
const UNBOUND_VARIATION_AUDIT_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
const IMAGE_AUDIT_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
const CONTENT_BATCH_PREVIEW_TTL_MS = 15 * 60 * 1_000;
const CONTENT_BATCH_MAX_CHANGED_SKUS = 500;
const CONTENT_AUDIT_STANDALONE_FAMILY_KEY = "STANDALONE";
const CONTENT_AUDIT_INCOMPLETE_FAMILY_KEY = "DATA_INCOMPLETE";

function contentAuditRowValues(row: ContentQualityRow): ParsedContentAuditValues {
  return {
    title: row.title,
    itemHighlight: row.itemHighlight,
    bulletPoints: Array.from(
      { length: 5 },
      (_value, index) => row.bulletPoints[index] ?? "",
    ),
    productDescription: row.productDescription,
    ingredients: row.ingredients,
  };
}

function sameContentAuditValues(
  left: ParsedContentAuditValues,
  right: ParsedContentAuditValues,
): boolean {
  return left.title === right.title &&
    left.itemHighlight === right.itemHighlight &&
    left.productDescription === right.productDescription &&
    left.ingredients === right.ingredients &&
    left.bulletPoints.length === right.bulletPoints.length &&
    left.bulletPoints.every((value, index) => value === right.bulletPoints[index]);
}

function contentAuditWorkbookFamilyKey(
  row: ContentQualityRow & ContentAuditVariationGrouping,
): string {
  if (row.variationRole === "standalone" && row.relationshipStatus === "complete") {
    return CONTENT_AUDIT_STANDALONE_FAMILY_KEY;
  }
  if (
    row.variationRole === "child" &&
    row.relationshipStatus === "complete" &&
    row.variationFamilyKey
  ) {
    return row.variationFamilyKey;
  }
  return CONTENT_AUDIT_INCOMPLETE_FAMILY_KEY;
}

function contentAuditSnapshotRowDigest(input: {
  accountScope: string;
  marketplaceId: MarketplaceId;
  mode: "live" | "demo";
  exportId: string;
  fetchedAt: string;
  sellerSku: string;
  asin: string;
  productType: string;
  variationFamilyKey: string;
  values: ParsedContentAuditValues;
  readStatus: "complete" | "incomplete";
}): string {
  return stableFingerprint([
    "content-audit-snapshot-row-v1",
    input.accountScope,
    input.marketplaceId,
    input.mode,
    input.exportId,
    input.fetchedAt,
    input.sellerSku,
    input.asin,
    input.productType,
    input.variationFamilyKey,
    input.values.title,
    input.values.itemHighlight,
    input.values.bulletPoints,
    input.values.productDescription,
    input.values.ingredients,
    input.readStatus,
  ]);
}

const CONTENT_AUDIT_LEGACY_LINE_BREAK_CANDIDATES = [
  "\r",
  "\r\n",
  "\u0085",
  "\u2028",
  "\u2029",
] as const;
const CONTENT_AUDIT_LEGACY_MAX_NORMALIZED_BREAKS = 64;
const CONTENT_AUDIT_LEGACY_MAX_RECOVERED_ROWS = 500;
const CONTENT_AUDIT_LEGACY_MAX_CANDIDATE_WORK = 500;
const CONTENT_AUDIT_LEGACY_MAX_HASH_WORK = 1_000;
const CONTENT_AUDIT_LEGACY_MAX_CANDIDATE_BYTES = 2 * 1024 * 1024;

/**
 * Older v2 workbooks could pass literal XML line-break code points through a
 * spreadsheet consumer that normalized them to LF. These candidates never
 * authorize a row by themselves: the caller must find exactly one candidate
 * whose complete immutable digest already exists in the main-owned snapshot.
 */
function* legacyContentAuditSourceCandidates(
  values: ParsedContentAuditValues,
): Generator<ParsedContentAuditValues> {
  type StringField =
    | "title"
    | "itemHighlight"
    | "productDescription"
    | "ingredients";
  const locations: Array<
    | { field: StringField; index: number }
    | { field: "bulletPoints"; bulletIndex: number; index: number }
  > = [];
  const collect = (
    value: string,
    createLocation: (index: number) => (typeof locations)[number],
  ) => {
    let index = value.indexOf("\n");
    while (index >= 0) {
      locations.push(createLocation(index));
      if (locations.length > CONTENT_AUDIT_LEGACY_MAX_NORMALIZED_BREAKS) return;
      index = value.indexOf("\n", index + 1);
    }
  };
  collect(values.title, (index) => ({ field: "title", index }));
  collect(values.itemHighlight, (index) => ({ field: "itemHighlight", index }));
  values.bulletPoints.forEach((value, bulletIndex) =>
    collect(value, (index) => ({
      field: "bulletPoints",
      bulletIndex,
      index,
    })));
  collect(values.productDescription, (index) => ({
    field: "productDescription",
    index,
  }));
  collect(values.ingredients, (index) => ({ field: "ingredients", index }));
  if (
    !locations.length ||
    locations.length > CONTENT_AUDIT_LEGACY_MAX_NORMALIZED_BREAKS
  ) {
    return;
  }

  const clone = (): ParsedContentAuditValues => ({
    title: values.title,
    itemHighlight: values.itemHighlight,
    bulletPoints: [...values.bulletPoints],
    productDescription: values.productDescription,
    ingredients: values.ingredients,
  });
  const replaceAt = (value: string, index: number, replacement: string) =>
    `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;

  for (const location of locations) {
    for (const replacement of CONTENT_AUDIT_LEGACY_LINE_BREAK_CANDIDATES) {
      const candidate = clone();
      if (location.field === "bulletPoints") {
        candidate.bulletPoints[location.bulletIndex] = replaceAt(
          candidate.bulletPoints[location.bulletIndex] ?? "",
          location.index,
          replacement,
        );
      } else {
        candidate[location.field] = replaceAt(
          candidate[location.field],
          location.index,
          replacement,
        );
      }
      yield candidate;
    }
  }
  for (const replacement of CONTENT_AUDIT_LEGACY_LINE_BREAK_CANDIDATES) {
    yield {
      title: values.title.replaceAll("\n", replacement),
      itemHighlight: values.itemHighlight.replaceAll("\n", replacement),
      bulletPoints: values.bulletPoints.map((value) =>
        value.replaceAll("\n", replacement)),
      productDescription: values.productDescription.replaceAll("\n", replacement),
      ingredients: values.ingredients.replaceAll("\n", replacement),
    };
  }
}

function contentAuditProposedWithRecoveredSource(input: {
  parsedOriginal: ParsedContentAuditValues;
  recoveredOriginal: ParsedContentAuditValues;
  proposed: ParsedContentAuditValues;
}): ParsedContentAuditValues {
  const recoverUnchanged = (parsed: string, recovered: string, proposed: string) =>
    proposed === parsed ? recovered : proposed;
  return {
    title: recoverUnchanged(
      input.parsedOriginal.title,
      input.recoveredOriginal.title,
      input.proposed.title,
    ),
    itemHighlight: recoverUnchanged(
      input.parsedOriginal.itemHighlight,
      input.recoveredOriginal.itemHighlight,
      input.proposed.itemHighlight,
    ),
    bulletPoints: input.proposed.bulletPoints.map((value, index) =>
      recoverUnchanged(
        input.parsedOriginal.bulletPoints[index] ?? "",
        input.recoveredOriginal.bulletPoints[index] ?? "",
        value,
      )),
    productDescription: recoverUnchanged(
      input.parsedOriginal.productDescription,
      input.recoveredOriginal.productDescription,
      input.proposed.productDescription,
    ),
    ingredients: recoverUnchanged(
      input.parsedOriginal.ingredients,
      input.recoveredOriginal.ingredients,
      input.proposed.ingredients,
    ),
  };
}

function contentAuditLegacyRecoveredFieldWasEdited(input: {
  parsedOriginal: ParsedContentAuditValues;
  recoveredOriginal: ParsedContentAuditValues;
  proposed: ParsedContentAuditValues;
}): boolean {
  const editedRecovered = (parsed: string, recovered: string, proposed: string) =>
    recovered !== parsed && proposed !== parsed;
  return editedRecovered(
      input.parsedOriginal.title,
      input.recoveredOriginal.title,
      input.proposed.title,
    ) ||
    editedRecovered(
      input.parsedOriginal.itemHighlight,
      input.recoveredOriginal.itemHighlight,
      input.proposed.itemHighlight,
    ) ||
    input.proposed.bulletPoints.some((value, index) =>
      editedRecovered(
        input.parsedOriginal.bulletPoints[index] ?? "",
        input.recoveredOriginal.bulletPoints[index] ?? "",
        value,
      )) ||
    editedRecovered(
      input.parsedOriginal.productDescription,
      input.recoveredOriginal.productDescription,
      input.proposed.productDescription,
    ) ||
    editedRecovered(
      input.parsedOriginal.ingredients,
      input.recoveredOriginal.ingredients,
      input.proposed.ingredients,
    );
}
const BRAND_SALES_REUSE_WINDOW_MS = 30 * 60 * 1_000;
const BRAND_SALES_NEAR_REUSE_BOUNDARY_MS = 2 * 60 * 1_000;
const BRAND_SALES_JOB_RETENTION_MS = 60 * 60 * 1_000;
const REVIEW_AUDIT_JOB_TTL_MS = 30 * 60 * 1_000;
const REVIEW_AUDIT_LIVE_REQUEST_INTERVAL_MS = 1_050;
const INBOUND_SHIPMENT_ACTIVE_TTL_MS = 60 * 60 * 1_000;
const INBOUND_SHIPMENT_TERMINAL_TTL_MS = 30 * 60 * 1_000;
const INBOUND_SHIPMENT_UNAVAILABLE_RETRY_TTL_MS = 35 * 60 * 1_000;
const ADVERTISING_STRATEGY_REPORT_WAIT_MS = 3 * 60 * 60 * 1_000 + 5 * 60 * 1_000;
const ADVERTISING_STRATEGY_ACTIVE_TTL_MS = 3 * 60 * 60 * 1_000 + 30 * 60 * 1_000;
const ADVERTISING_STRATEGY_TERMINAL_TTL_MS = 30 * 60 * 1_000;
const ADVERTISING_STRATEGY_RETRY_TTL_MS = 35 * 60 * 1_000;

function advertisingStrategyPollDelay(attempt: number): number {
  if (attempt < 30) return 2_000;
  if (attempt < 90) return 5_000;
  return 15_000;
}

function assertAuditSuiteActive(control: AuditSuiteRunControl): void {
  assertBackgroundActive(control.signal);
}

function aplusAuditFenceAbort(): Error {
  const error = new Error("A+ 健檢的帳號、站點或模式 context 已改變。");
  error.name = "AbortError";
  return error;
}

type ImageAuditSnapshot = ReturnType<typeof auditListingImageRows>;
type AuditSuiteListingsData = FbaCatalogExport;
const AUDIT_SUITE_LISTINGS_RESOURCE = createAuditSuiteResourceKey<{
  reportId: string;
  documentId: string;
  data: AuditSuiteListingsData;
}>("audit-suite-verified-listings");
const AUDIT_SUITE_FBA_GROUPING_RESOURCE = createAuditSuiteResourceKey<{
  reportId: string;
  documentId: string;
  data: AuditSuiteListingsData;
  grouping: FbaVariationGroupingData;
}>("audit-suite-fba-relationship-grouping");

function json(value: unknown, status = 200, headers: Record<string, string> = {}): ApiResponse {
  return {
    status,
    headers: { ...JSON_HEADERS, ...headers },
    body: { kind: "json", value },
  };
}

function bytes(
  value: Uint8Array,
  contentType: string,
  headers: Record<string, string> = {},
): ApiResponse {
  return {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      ...headers,
    },
    body: { kind: "bytes", value },
  };
}

function apiError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof StandaloneAuditJobCoordinatorError) {
    return json({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof AplusAuditJobCoordinatorError) {
    return json({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof AuditSuiteCoordinatorError) {
    return json({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof SpApiError) {
    const publicError = publicSpApiError(error, fallback);
    return json(
      {
        code: publicError.code,
        message: publicError.message,
        requestId: publicError.requestId,
        issues: publicError.issues,
        operation: publicError.operation,
        upstreamCode: publicError.upstreamCode,
      },
      publicError.status,
      publicError.retryAfter ? { "retry-after": publicError.retryAfter } : {},
    );
  }
  if (error instanceof ReplenishmentAuditError) {
    const status = error.code === "MARKETPLACE_UNSUPPORTED" || error.code === "REQUEST_INVALID"
      ? 422
      : error.code === "PAGINATION_CHANGED" || error.code === "DUPLICATE_SKU"
        ? 409
        : 502;
    return json({ code: `REPLENISHMENT_${error.code}`, message: error.message }, status);
  }
  if (error instanceof AdvertisingApiError) {
    return json(
      { code: error.code, message: error.message, requestId: error.requestId },
      error.status >= 400 && error.status < 600 ? error.status : 502,
    );
  }
  if (error instanceof AdvertisingCoverageInputError) {
    return json({ code: error.code, message: error.message }, 422);
  }
  return json({ code: "INTERNAL_ERROR", message: fallback }, 500);
}

function invalid(message: string, status = 400, code = "INVALID_INPUT"): ApiResponse {
  return json({ code, message }, status);
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

export function buildSubscriptionAuditSuiteRows(
  snapshot: SubscriptionAuditSnapshot,
): NonNullable<
  NonNullable<AuditSuiteWorkbookInput["sections"]["subscription"]>["payload"]
> {
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
    const bucket = subscriptionAuditDiscountBucket(offer.sellerFundedBaseDiscount);
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
    if (row.reason === "FBA_NOT_PROVEN") {
      return [];
    }
    if (row.fbaEvidence !== "CURRENT_FBA_SKU_SET") {
      throw new Error("訂閱未納入 SKU 缺少同次 CURRENT_FBA 證據。");
    }
    if (problemsBySku.has(row.sellerSku) || emittedSkus.has(row.sellerSku)) return [];
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
  const problemOnlyRows = snapshot.upstreamCoverage.problemSkuRows.flatMap((problem) => {
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
  });
  return [...offerRows, ...excludedRows, ...problemOnlyRows];
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function bodyRecord(request: ApiRequest): JsonRecord | null {
  return request.body?.kind === "json" && isPlainRecord(request.body.value)
    ? request.body.value
    : null;
}

export function parseMarketplace(value: unknown): MarketplaceId | null {
  return typeof value === "string" && isMarketplaceId(value) ? value : null;
}

function parseAccountingCapabilityId(value: unknown): AccountingCapabilityId | null {
  if (typeof value !== "string") return null;
  return PUBLIC_ACCOUNTING_CAPABILITIES.some((capability) => capability.id === value)
    ? value as AccountingCapabilityId
    : null;
}

function canonicalIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value || value !== value.trim()) return null;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

function accountingCatalogState(
  capability: AccountingCapability,
): AccountingAccessPlan["state"] {
  if (capability.availability !== "CONFIGURED_FBA_MARKETPLACES") {
    return "UNAVAILABLE";
  }
  if (capability.id === "FINANCES_TRANSACTIONS") {
    return "MAIN_FBA_FILTER_REQUIRED";
  }
  if (capability.access === "SELLER_CENTRAL_PREREQUISITE") {
    return "MANUAL_PREREQUISITE";
  }
  if (
    capability.access === "LIST_AMAZON_GENERATED_REPORT" &&
    capability.fbaSafety === "ACCOUNT_WIDE_NOT_FBA_SAFE"
  ) {
    return "FBA_FILTER_NOT_IMPLEMENTED";
  }
  if (capability.access === "LIST_AMAZON_GENERATED_REPORT") {
    return "READY_LIST_GENERATED";
  }
  if (capability.access === "CREATE_PUBLIC_REPORT") {
    return "READY_CREATE_REPORT";
  }
  return capability.access === "DIRECT_PUBLIC_API"
    ? "READY_PUBLIC_API"
    : "UNAVAILABLE";
}

function accountingPlanNextStep(state: AccountingAccessPlan["state"]): string | null {
  switch (state) {
    case "READY_PUBLIC_API":
      return "這裡只完成公開 API 與日期規則的安全規劃；尚未讀取交易，也不會輸出未證明為 FBA 的金額。";
    case "READY_CREATE_REPORT":
      return "這裡只完成公開 Reports API、日期與 FBA allowlist 驗證；尚未建立、輪詢或下載 Amazon 報表。";
    case "READY_LIST_GENERATED":
      return "這裡只完成列出 Amazon 已產生報表的安全規劃；尚未查詢或下載文件。";
    case "MAIN_FBA_FILTER_REQUIRED":
      return "必須先在 main process 完成逐項 AFN 證據過濾；目前不讀取，也不會把帳戶總額送到畫面。";
    case "FBA_FILTER_NOT_IMPLEMENTED":
      return "文件可能混有非 FBA 資料；在逐列 FBA 過濾完成前維持禁止下載。";
    case "MANUAL_PREREQUISITE":
      return "必須先由你在 Amazon 官方介面產生文件；AMZ.API 不會使用 Seller Central 私有接口。";
    case "UNAVAILABLE":
      return "目前沒有符合此站點與 FBA-only 邊界的 Amazon 公開下載 API。";
  }
}

export function parseSellerSku(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sellerSku = value.trim();
  if (!sellerSku || sellerSku.length > 40 || /[\u0000-\u001f\u007f]/.test(sellerSku)) {
    return null;
  }
  return sellerSku;
}

export function parseAsin(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9]{10}$/u.test(value)
    ? value
    : null;
}

function parsePrice(value: unknown, currencyCode: string): number | null {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return null;
  const pattern = currencyCode === "JPY" ? /^\d{1,9}$/ : /^\d{1,9}(?:\.\d{1,2})?$/;
  if (!pattern.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function optionalPrice(value: unknown, currency: string): number | null | undefined {
  if (value === null || value === "" || value === undefined) return null;
  const parsed = parsePrice(value, currency);
  return parsed === null ? undefined : parsed;
}

function optionalDate(value: unknown): string | null | undefined {
  if (value === null || value === "" || value === undefined) return null;
  return isDateOnly(value) ? value : undefined;
}

function integer(
  value: unknown,
  fallback: number | null,
  minimum: number,
  maximum: number,
): number | null {
  if ((value === null || value === undefined || value === "") && fallback !== null) {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function optionalInteger(value: unknown, minimum: number, maximum: number): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const parsed = integer(value, null, minimum, maximum);
  return parsed === null ? undefined : parsed;
}

function shortText(value: unknown, maximum: number): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    return undefined;
  }
  return result;
}

function multiLineText(value: unknown, maximum: number): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const result = value.replace(/\r\n?/g, "\n").trim();
  if (
    !result ||
    result.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)
  ) {
    return undefined;
  }
  return result;
}

function parseText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || value.length > maximum) return null;
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    ? null
    : value;
}

function parseBullets(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const result: string[] = [];
  for (const item of value) {
    const parsed = parseText(item, 5_000);
    if (parsed === null) return null;
    result.push(parsed);
  }
  return result;
}

function parseUrls(value: unknown): Array<string | null> | null {
  if (!Array.isArray(value) || value.length > 9) return null;
  const urls: Array<string | null> = [];
  for (const item of value) {
    if (item === null || item === "") {
      urls.push(null);
    } else if (
      typeof item === "string" &&
      item.length <= 2_000 &&
      !/[\u0000-\u001f\u007f]/.test(item)
    ) {
      urls.push(item.trim() || null);
    } else {
      return null;
    }
  }
  return urls;
}

function parseVariationDimensionNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return null;
  const names: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !/^[a-z][a-z0-9_]{0,79}$/.test(item) ||
      names.includes(item)
    ) {
      return null;
    }
    names.push(item);
  }
  return names;
}

function variationJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "string" ||
      (value.length <= 5_000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 30 && value.every((item) => variationJsonSafe(item, depth + 1));
  }
  if (!isPlainRecord(value) || Object.keys(value).length > 30) return false;
  return Object.entries(value).every(
    ([key, child]) =>
      /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key) &&
      !["__proto__", "constructor", "prototype"].includes(key) &&
      variationJsonSafe(child, depth + 1),
  );
}

function parseVariationDimensionValues(
  value: unknown,
  dimensionNames: string[],
): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value).sort();
  const expected = [...dimensionNames].sort();
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    !variationJsonSafe(value)
  ) {
    return null;
  }
  const serialized = JSON.stringify(value);
  return serialized.length <= 64_000 ? structuredClone(value) : null;
}

function idempotencyKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/.test(value)
    ? value
    : null;
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceResult<T>(result: PromiseSettledResult<T>) {
  if (result.status === "fulfilled") return { data: result.value, error: null };
  const error = result.reason;
  const publicError = error instanceof SpApiError
    ? publicSpApiError(
        error,
        "這項 Amazon 資料暫時無法讀取，其他結果仍可使用。",
      )
    : null;
  return {
    data: null,
    error: publicError
        ? {
            code: publicError.code,
            message: publicError.message,
            requestId: publicError.requestId,
            operation: publicError.operation,
            upstreamCode: publicError.upstreamCode,
          }
        : {
            code: "UPSTREAM_UNAVAILABLE",
            message: "這項 Amazon 資料暫時無法讀取，其他結果仍可使用。",
            requestId: null,
          },
  };
}

export class ApiRouter {
  private readonly store: LocalStore;
  private readonly vault: CredentialVault;
  private readonly approveWrite: WriteApproval;
  private readonly spExecutionContext: SpExecutionContextAdapter;
  private readonly brandSalesReports: BrandSalesReportGateway;
  private readonly agedInventoryReports: AgedInventoryReportGateway;
  private readonly businessPricingActiveListingsReports:
    BusinessPricingActiveListingsReportGateway;
  private readonly salesAndTrafficReports: SalesAndTrafficReportGateway;
  private readonly advertisingStrategySources: AdvertisingStrategySourceGateway;
  private readonly reviewAuditCandidates: ReviewAuditCandidateSource;
  private readonly advertisingStrategyWait: typeof waitMilliseconds;
  private readonly inboundShipments: InboundShipmentGateway;
  private readonly inboundNoncomplianceReports: InboundNoncomplianceReportGateway;
  private readonly reportLifecycle: DurableReportLifecycle;
  private readonly reportsRuntime: ReportsRuntime;
  private readonly catalogListings: CatalogListingsReadAdapter;
  private readonly fbaCatalogReports: FbaCatalogReports;
  private readonly advertising: AdvertisingGateway | null;
  private readonly auditSuite: AuditSuiteCoordinator;
  private readonly aplusAuditJobs: AplusAuditJobCoordinator;
  private readonly standaloneAuditJobs: StandaloneAuditJobCoordinator;
  private readonly previews = new Map<string, PreviewTicket>();
  private readonly listingAttributeWriteReservations = new Map<string, string>();
  private readonly subscriptionAuditSnapshots = new Map<
    string,
    {
      marketplaceId: MarketplaceId;
      accountScope: string;
      expiresAt: number;
      snapshot: SubscriptionAuditSnapshot;
    }
  >();
  private readonly unboundVariationAuditSnapshots = new Map<
    string,
    {
      marketplaceId: MarketplaceId;
      accountScope: string;
      expiresAt: number;
      snapshot: UnboundVariationAuditSnapshot;
    }
  >();
  private readonly imageAuditSnapshots = new Map<
    string,
    {
      marketplaceId: MarketplaceId;
      accountScope: string;
      expiresAt: number;
      snapshot: ImageAuditSnapshot;
    }
  >();
  private readonly contentBatchPlans = new Map<string, ContentBatchPlan>();
  private readonly brandSalesJobs = new Map<string, BrandSalesRuntimeJob>();
  private readonly brandSalesStartFlights = new Map<string, Promise<ApiResponse>>();
  private readonly brandSalesPollFlights = new Map<
    string,
    Promise<ApiResponse | null>
  >();
  private readonly brandSalesDataFlights = new Map<string, Promise<ApiResponse>>();
  private readonly reviewAuditJobs = new Map<string, ReviewAuditJob>();
  private readonly reviewAuditPollFlights = new Map<string, Promise<ApiResponse>>();
  private readonly reviewAuditRunnerTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private reviewAuditFeedbackQueue: Promise<void> = Promise.resolve();
  private reviewAuditFeedbackNextStartAt = 0;
  private readonly inboundShipmentJobs = new Map<string, InboundShipmentJob>();
  private readonly inboundShipmentSelections = new Map<string, string>();
  private readonly advertisingStrategyJobs = new Map<string, AdvertisingStrategyJob>();
  private readonly advertisingStrategySelections = new Map<string, string>();

  constructor(input: {
    store: LocalStore;
    vault: CredentialVault;
    approveWrite: WriteApproval;
    brandSalesReports?: Partial<BrandSalesReportGateway>;
    agedInventoryReports?: Partial<AgedInventoryReportGateway>;
    businessPricingActiveListingsReports?: Partial<
      BusinessPricingActiveListingsReportGateway
    >;
    salesAndTrafficReports?: Partial<SalesAndTrafficReportGateway>;
    advertisingStrategySources?: Partial<AdvertisingStrategySourceGateway>;
    reviewAuditCandidates?: ReviewAuditCandidateSource;
    advertisingStrategyWait?: typeof waitMilliseconds;
    inboundShipments?: Partial<InboundShipmentGateway>;
    inboundNoncomplianceReports?: Partial<InboundNoncomplianceReportGateway>;
    reportsAdapter?: ReportsAdapter;
    catalogListings?: CatalogListingsReadAdapter;
    catalogDemo?: Partial<FbaCatalogReportsDemoSource>;
    catalogPace?: (
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void>;
    catalogNow?: () => Date;
    aplusAudit?: Partial<AplusAuditJobGateway>;
    standaloneAudit?: Partial<StandaloneAuditJobGateway>;
    advertising?: AdvertisingGateway;
    spExecutionContext?: SpExecutionContextAdapter;
  }) {
    this.store = input.store;
    this.vault = input.vault;
    this.approveWrite = input.approveWrite;
    this.spExecutionContext = input.spExecutionContext
      ?? createProductionSpExecutionContextAdapter({
        getOpaqueAccountScope: (region) => this.vault.getAccountScope(region),
        resolveMode: (marketplaceId) => usesDemoMode(marketplaceId) ? "demo" : "live",
        onContextChanged: () => {
          invalidateSpApiCredentialCaches({ preserveRateLimitPacing: true });
          this.clearPreviews();
        },
      });
    this.advertising = input.advertising ?? null;
    this.reportLifecycle = new DurableReportLifecycle(this.store);
    this.brandSalesReports = {
      startListing: (request) => startDemoFixedReport({
        intent: "all-listings",
        ...request,
      }),
      startShipment: startFbaShipmentSalesReport,
      getListingStatus: (request) => statusDemoFixedReport({
        intent: "all-listings",
        ...request,
      }),
      getShipmentStatus: getFbaShipmentSalesReportStatus,
      getDataFromDocuments: getBrandSalesDataFromDocuments,
      reportWindow: getBrandSalesReportWindow,
      ...input.brandSalesReports,
    };
    this.agedInventoryReports = {
      start: startAgedInventoryReport,
      status: getAgedInventoryReportStatus,
      ...input.agedInventoryReports,
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
    this.salesAndTrafficReports = {
      start: startSalesAndTrafficReport,
      status: getSalesAndTrafficReportStatus,
      data: getSalesAndTrafficReportData,
      dataFromDocument: getSalesAndTrafficReportDataFromDocument,
      ...input.salesAndTrafficReports,
    };
    this.advertisingStrategyWait = input.advertisingStrategyWait ?? waitMilliseconds;
    this.inboundShipments = {
      snapshot: getFbaInboundShipmentSnapshot,
      ...input.inboundShipments,
    };
    this.inboundNoncomplianceReports = {
      start: startInboundNoncomplianceReport,
      status: getInboundNoncomplianceReportStatus,
      document: getInboundNoncomplianceReportDocument,
      ...input.inboundNoncomplianceReports,
    };
    const compatibilityReportsAdapter = routerDemoReportsAdapter({
      brand: this.brandSalesReports,
      aged: this.agedInventoryReports,
      activeBusiness: this.businessPricingActiveListingsReports,
      salesAndTraffic: this.salesAndTrafficReports,
      inboundNoncompliance: this.inboundNoncomplianceReports,
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
    this.reportsRuntime = new ReportsRuntime({
      store: this.store,
      lifecycle: this.reportLifecycle,
      context: this.spExecutionContext,
      adapter: reportsAdapter,
    });
    const defaultCatalogDemo: FbaCatalogReportsDemoSource = {
      ...catalogReportsDemoSource,
      ...input.catalogDemo,
    };
    this.catalogListings = input.catalogListings ??
      catalogListingsReadAdapterProduction;
    this.fbaCatalogReports = new FbaCatalogReports({
      reports: this.reportsRuntime,
      context: this.spExecutionContext,
      listings: this.catalogListings,
      demo: defaultCatalogDemo,
      pace: input.catalogPace,
      now: input.catalogNow,
    });
    this.advertisingStrategySources = {
      fbaListings: (request) => this.fbaCatalogReports.read({
        view: "identity",
        ...request,
      }),
      ...input.advertisingStrategySources,
    };
    this.reviewAuditCandidates = input.reviewAuditCandidates ?? (async (request) =>
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
    this.aplusAuditJobs = new AplusAuditJobCoordinator({
      gateway: {
        bindContext: input.aplusAudit?.bindContext ?? ((identity) =>
          this.bindAplusAuditContext(identity)),
        loadFbaSeeds: input.aplusAudit?.loadFbaSeeds ?? ((job) =>
          this.loadAplusAuditFbaSeeds(
            job.context,
            job.signal,
            job.heartbeat,
          )),
        fetchPublishRecords: input.aplusAudit?.fetchPublishRecords ?? ((job) =>
          this.fetchAplusAuditPublishRecords(
            job.context,
            job.request,
            job.heartbeat,
          )),
        fetchContentDocuments: input.aplusAudit?.fetchContentDocuments ?? ((job) =>
          this.fetchAplusAuditContentDocuments(
            job.context,
            job.request,
            job.heartbeat,
          )),
        fetchContentDocumentAsinRelations:
          input.aplusAudit?.fetchContentDocumentAsinRelations ?? ((job) =>
            this.fetchAplusAuditContentDocumentAsinRelations(
              job.context,
              job.request,
              job.heartbeat,
            )),
      },
    });
    this.standaloneAuditJobs = new StandaloneAuditJobCoordinator({
      gateway: {
        bindContext: input.standaloneAudit?.bindContext ?? ((identity) =>
          this.bindStandaloneAuditContext(identity)),
        run: input.standaloneAudit?.run ?? ((job) =>
          this.runStandaloneAudit(job)),
      },
    });
    this.auditSuite = new AuditSuiteCoordinator({
      runners: {
        content: (context, control) => this.runAuditSuiteContent(context, control),
        image: (context, control) => this.runAuditSuiteImage(context, control),
        aplus: (context, control) => this.runAuditSuiteAplus(context, control),
        variation: (context, control) => this.runAuditSuiteVariation(context, control),
        subscription: (context, control) => this.runAuditSuiteSubscription(context, control),
        businessPricing: (context, control) =>
          this.runAuditSuiteBusinessPricing(context, control),
        advertising: (context, control) => this.runAuditSuiteAdvertising(context, control),
      },
    });
  }

  clearPreviews(): void {
    this.reportsRuntime.clear();
    this.aplusAuditJobs.clear();
    this.standaloneAuditJobs.clear();
    this.previews.clear();
    this.listingAttributeWriteReservations.clear();
    this.subscriptionAuditSnapshots.clear();
    this.unboundVariationAuditSnapshots.clear();
    this.imageAuditSnapshots.clear();
    this.contentBatchPlans.clear();
    this.brandSalesJobs.clear();
    this.brandSalesStartFlights.clear();
    this.brandSalesPollFlights.clear();
    this.brandSalesDataFlights.clear();
    for (const jobId of [...this.reviewAuditJobs.keys()]) {
      this.deleteReviewAuditJob(jobId);
    }
    this.reviewAuditPollFlights.clear();
    for (const job of [...this.inboundShipmentJobs.values()]) {
      job.controller.abort(new Error("FBA 入庫貨件工作已因安全 context 變更而停止。"));
      this.removeInboundShipmentJob(job.jobId);
    }
    this.inboundShipmentSelections.clear();
    for (const job of [...this.advertisingStrategyJobs.values()]) {
      job.controller.abort(new Error("FBA 廣告策略工作已因安全 context 變更而停止。"));
      this.removeAdvertisingStrategyJob(job.jobId);
    }
    this.advertisingStrategySelections.clear();
    this.auditSuite.clear();
    this.advertising?.invalidate();
    // Do not reset the Customer Feedback queue or its next slot. A credential
    // change must not let a new account overtake an already-started request or
    // bypass the App-session-wide one-request-per-second boundary.
  }

  invalidateSpExecutionContext(reason: SpExecutionContextInvalidationReason): void {
    this.spExecutionContext.invalidate(reason);
    invalidateSpApiCredentialCaches({ preserveRateLimitPacing: true });
    this.clearPreviews();
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    if (!this.validEnvelope(request)) {
      return invalid("App 內部請求格式無效。", 400, "INVALID_REQUEST");
    }
    try {
      return await this.route(request);
    } catch (error) {
      return apiError(error, "執行本機 Amazon 操作時發生未預期的錯誤。");
    }
  }

  async testConnections(): Promise<ConnectionTestResult> {
    const summary = await this.vault.getSummary();
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
      if (!summary.regions[region].configured) continue;
      result.regions[region] = await testRegionConnections({
        orders: () => searchOrders({
          marketplaceId: representatives[region],
          lastUpdatedAfter: new Date(Date.now() - 86_400_000).toISOString(),
          fulfilledBy: "AMAZON",
          maxResultsPerPage: 1,
        }),
        listings: () => verifyListingsAccess(representatives[region]),
      });
    }
    const tested = Object.values(result.regions);
    result.ok = tested.length > 0 && tested.every((item) => item?.ok);
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
        isPlainRecord(request.query) &&
        isPlainRecord(request.headers),
    );
  }

  private async route(request: ApiRequest): Promise<ApiResponse> {
    const key = `${request.method} ${request.path}`;
    switch (key) {
      case "GET /api/sp-api/orders":
        return this.orders(request);
      case "GET /api/sp-api/sales-trend":
        return this.salesTrend(request);
      case "POST /api/sp-api/brand-sales":
        return this.startBrandSales(request);
      case "GET /api/sp-api/brand-sales":
        return this.brandSalesStatusOrData(request);
      case "POST /api/sp-api/inbound-shipments":
        return this.startInboundShipments(request);
      case "GET /api/sp-api/inbound-shipments":
        return this.inboundShipmentsStatus(request);
      case "GET /api/sp-api/listings":
        return this.listingPrice(request);
      case "POST /api/sp-api/listings":
        return this.previewPrice(request);
      case "PATCH /api/sp-api/listings":
        return this.commitPrice(request);
      case "POST /api/sp-api/business-pricing-audit":
        return this.startBusinessPricingAudit(request);
      case "GET /api/sp-api/business-pricing-audit":
        return this.businessPricingAuditStatusOrData(request);
      case "GET /api/sp-api/business-pricing-audit/export":
        return this.businessPricingAuditExport(request);
      case "GET /api/sp-api/business-pricing":
        return this.businessPricing(request);
      case "POST /api/sp-api/business-pricing":
        return this.previewBusinessPricing(request);
      case "PATCH /api/sp-api/business-pricing":
        return this.commitBusinessPricing(request);
      case "POST /api/sp-api/listings/batch":
        return this.batchListings(request);
      case "GET /api/sp-api/listing-content":
        return this.listingContent(request);
      case "POST /api/sp-api/listing-content":
        return this.previewContent(request);
      case "PATCH /api/sp-api/listing-content":
        return this.commitContent(request);
      case "POST /api/sp-api/listing-content/import":
        return this.previewContentWorkbookImport(request);
      case "PATCH /api/sp-api/listing-content/import":
        return this.commitContentWorkbookImport(request);
      case "GET /api/sp-api/listing-images":
        return this.listingImages(request);
      case "POST /api/sp-api/listing-images":
        return this.previewImages(request);
      case "PATCH /api/sp-api/listing-images":
        return this.commitImages(request);
      case "POST /api/sp-api/sale-price":
        return this.previewSalePrice(request);
      case "PATCH /api/sp-api/sale-price":
        return this.commitSalePrice(request);
      case "GET /api/sp-api/subscribe-save":
        return this.subscribeSave(request);
      case "GET /api/sp-api/subscription-audit":
        return this.subscriptionAudit(request);
      case "GET /api/sp-api/subscription-audit/export":
        return this.subscriptionAuditExport(request);
      case "GET /api/sp-api/accounting/capabilities":
        return this.accountingCapabilities(request);
      case "POST /api/sp-api/accounting/access-plan":
        return this.accountingAccessPlan(request);
      case "GET /api/sp-api/report-library":
        return this.reportLibrary(request);
      case "POST /api/sp-api/report-library/access-plan":
        return this.reportLibraryAccessPlan(request);
      case "POST /api/sp-api/review-audit":
        return this.startReviewAudit(request);
      case "GET /api/sp-api/review-audit":
        return this.reviewAuditStatusOrData(request);
      case "GET /api/sp-api/review-audit/export":
        return this.reviewAuditExport(request);
      case "GET /api/sp-api/replenishment-plan":
        return this.replenishment(request);
      case "POST /api/sp-api/aged-inventory":
        return this.startAgedInventory(request);
      case "GET /api/sp-api/aged-inventory":
        return this.agedInventoryStatusOrData(request);
      case "GET /api/sp-api/variation-family":
        return this.variationFamily(request);
      case "POST /api/sp-api/variation-audit":
        return this.startUnboundVariationAudit(request);
      case "GET /api/sp-api/variation-audit":
        return this.unboundVariationAuditStatusDataOrDownload(request);
      case "GET /api/sp-api/variation-move":
        return this.variationMovePreparation(request);
      case "POST /api/sp-api/variation-move":
        return this.previewVariationMove(request);
      case "PATCH /api/sp-api/variation-move":
        return this.commitVariationMove(request);
      case "GET /api/sp-api/sku-command":
        return this.skuCommand(request);
      case "GET /api/product-master":
        return this.getProductMaster(request);
      case "PUT /api/product-master":
        return this.putProductMaster(request);
      case "POST /api/uploads/listing-images":
        return this.uploadImage(request);
      case "POST /api/sp-api/listing-content/export":
        return this.startExport(request);
      case "GET /api/sp-api/listing-content/export":
        return this.exportStatusOrDownload(request);
      case "GET /api/system/health":
        return this.systemHealth(request);
      case "GET /api/amazon-ads/status":
        return this.adsStatus(request);
      case "GET /api/amazon-ads/coverage":
        return this.adsCoverage(request);
      case "POST /api/amazon-ads/strategy":
        return this.startAdvertisingStrategy(request);
      case "GET /api/amazon-ads/strategy":
        return this.advertisingStrategyStatus(request);
      case "POST /api/sp-api/a-plus-audit":
        return this.startAplusAudit(request);
      case "GET /api/sp-api/a-plus-audit":
        return this.aplusAuditStatus(request);
      case "POST /api/sp-api/audit-suite":
        return this.startAuditSuite(request);
      case "GET /api/sp-api/audit-suite":
        return this.auditSuiteStatus(request);
      case "GET /api/sp-api/audit-suite/export":
        return this.auditSuiteExport(request);
      case "POST /api/sp-api/standalone-audit":
        return this.startStandaloneAudit(request);
      case "GET /api/sp-api/standalone-audit":
        return this.standaloneAuditStatus(request);
      default:
        return invalid("此 App 版本不支援這個操作。", 404, "NOT_FOUND");
    }
  }

  private removeInboundShipmentJob(jobId: string): void {
    const job = this.inboundShipmentJobs.get(jobId);
    if (!job) return;
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    job.expiryTimer = null;
    job.shipmentSeed = null;
    this.inboundShipmentJobs.delete(jobId);
    for (const [selection, selectedJobId] of this.inboundShipmentSelections) {
      if (selectedJobId === jobId) this.inboundShipmentSelections.delete(selection);
    }
  }

  private touchInboundShipmentJob(job: InboundShipmentJob): void {
    if (
      job.state !== "running" ||
      job.controller.signal.aborted ||
      this.inboundShipmentJobs.get(job.jobId) !== job
    ) {
      return;
    }
    job.expiresAt = Date.now() + INBOUND_SHIPMENT_ACTIVE_TTL_MS;
  }

  private retainInboundShipmentTerminalJob(
    job: InboundShipmentJob,
    ttl: number,
  ): void {
    if (this.inboundShipmentJobs.get(job.jobId) !== job || job.state === "running") {
      return;
    }
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    const expiresAt = Date.now() + ttl;
    job.expiresAt = expiresAt;
    job.expiryTimer = setTimeout(() => {
      if (
        this.inboundShipmentJobs.get(job.jobId) === job &&
        job.state !== "running" &&
        job.expiresAt === expiresAt &&
        job.expiresAt <= Date.now()
      ) {
        this.removeInboundShipmentJob(job.jobId);
      }
    }, ttl);
    job.expiryTimer.unref?.();
  }

  private pruneInboundShipmentJobs(now = Date.now()): void {
    for (const job of this.inboundShipmentJobs.values()) {
      if (job.expiresAt > now) continue;
      if (job.state === "running") {
        job.controller.abort(new Error("FBA 入庫貨件背景工作超過安全保留時間。"));
        job.state = "failed";
        job.snapshot = null;
        job.notice = "FBA 入庫貨件背景工作等待逾時；Amazon 沒有收到任何寫入。";
        job.failure = {
          code: "INBOUND_SHIPMENT_JOB_TIMEOUT",
          requestId: null,
        };
        this.retainInboundShipmentTerminalJob(
          job,
          INBOUND_SHIPMENT_TERMINAL_TTL_MS,
        );
      } else {
        this.removeInboundShipmentJob(job.jobId);
      }
    }
  }

  private inboundShipmentJobReply(job: InboundShipmentJob): ApiResponse {
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

  private async assertInboundShipmentJobContext(
    job: InboundShipmentJob,
    signal?: AbortSignal,
  ): Promise<void> {
    assertBackgroundActive(signal);
    const mode = usesDemoMode(job.marketplaceId) ? "demo" : "live";
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[job.marketplaceId].region,
    );
    assertBackgroundActive(signal);
    if (mode !== job.mode || accountScope !== job.accountScope) {
      throw new SpApiError("FBA 入庫貨件工作與目前帳號、站點或模式不一致。", {
        status: 409,
        code: "INBOUND_SHIPMENT_JOB_MISMATCH",
      });
    }
  }

  private unavailableInboundIssueReport(error: unknown): InboundIssueReportSnapshot {
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

  private async loadInboundIssueReport(
    job: InboundShipmentJob,
    signal: AbortSignal,
  ): Promise<Readonly<{
    parsed: ParsedInboundNoncomplianceReport;
    fetchedAt: string;
  }>> {
    await this.assertInboundShipmentJobContext(job, signal);
    const plan = {
      intent: "inbound-noncompliance" as const,
      marketplaceId: job.marketplaceId,
      signal,
    };
    let report = await this.reportsRuntime.start(plan, {
      explicitRetry: job.retryIssueReport,
      freshCompleted: job.retryIssueReport,
    });
    this.touchInboundShipmentJob(job);
    for (let attempt = 0; !report.ready && attempt < 150; attempt += 1) {
      if (report.status !== "IN_QUEUE" && report.status !== "IN_PROGRESS") {
        throw new SpApiError("Amazon 未能完成每日 FBA 入庫瑕疵報表。", {
          status: 502,
          code: "INBOUND_NONCOMPLIANCE_UNAVAILABLE",
        });
      }
      await waitMilliseconds(2_000, signal);
      await this.assertInboundShipmentJobContext(job, signal);
      report = await this.reportsRuntime.status(plan, report.reportId);
      this.touchInboundShipmentJob(job);
    }
    if (!report.ready || !report.documentId || report.mode !== job.mode) {
      throw new SpApiError("Amazon 每日 FBA 入庫瑕疵報表仍在準備中。", {
        status: 504,
        code: "INBOUND_NONCOMPLIANCE_PENDING",
      });
    }
    await this.assertInboundShipmentJobContext(job, signal);
    const document = await this.reportsRuntime.readDocument(plan, {
      reportId: report.reportId,
      documentId: report.documentId,
    });
    await this.assertInboundShipmentJobContext(job, signal);
    if (document.mode !== job.mode) {
      throw new SpApiError("FBA 入庫瑕疵報表模式已改變。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }
    return {
      parsed: parseInboundNoncomplianceReport(document.text),
      fetchedAt: new Date().toISOString(),
    };
  }

  private inboundJobFailure(error: unknown): Readonly<{
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
          ? this.reportIdentifier(error.requestId)
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

  private async runInboundShipmentJob(job: InboundShipmentJob): Promise<void> {
    const signal = job.controller.signal;
    const issueOutcome = this.loadInboundIssueReport(job, signal).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    );
    try {
      await this.assertInboundShipmentJobContext(job, signal);
      let shipmentSnapshot: FbaInboundShipmentSnapshot;
      if (job.shipmentSeed) {
        shipmentSnapshot = job.shipmentSeed;
        job.shipmentSeed = null;
      } else {
        shipmentSnapshot = await this.inboundShipments.snapshot({
            marketplaceId: job.marketplaceId,
            startDate: job.startDate,
            endDate: job.endDate,
            signal,
            onProgress: (progress) => {
              if (
                job.state !== "running" ||
                !["shipments", "items"].includes(progress.phase) ||
                !Number.isSafeInteger(progress.completed) ||
                progress.completed < 0 ||
                (progress.total !== null &&
                  (!Number.isSafeInteger(progress.total) || progress.total < progress.completed))
              ) {
                return;
              }
              job.progress = {
                phase: progress.phase,
                completed: progress.completed,
                total: progress.total,
              };
              this.touchInboundShipmentJob(job);
            },
          });
      }
      await this.assertInboundShipmentJobContext(job, signal);
      job.progress = { phase: "issues", completed: 0, total: 1 };
      this.touchInboundShipmentJob(job);
      const issue = await issueOutcome;
      assertBackgroundActive(signal);
      await this.assertInboundShipmentJobContext(job, signal);
      const issueReport = issue.value
        ? buildInboundIssueReportSnapshot({
            ...issue.value,
            allowedShipmentIds: new Set(
              shipmentSnapshot.shipments.map((shipment) => shipment.shipmentId),
            ),
          })
        : this.unavailableInboundIssueReport(issue.error);
      job.progress = { phase: "issues", completed: 1, total: 1 };
      job.snapshot = {
        ...shipmentSnapshot,
        schemaVersion: 1,
        issueReport,
      };
      const partial =
        shipmentSnapshot.shipmentListScope !== "selected-date-range" ||
        shipmentSnapshot.coverage.state === "partial" ||
        issueReport.state !== "completed";
      job.state = partial ? "partial" : "completed";
      job.notice = `${shipmentSnapshot.notice} ${issueReport.notice}`;
      job.failure = null;
      this.retainInboundShipmentTerminalJob(job,
        issueReport.state === "unavailable"
          ? INBOUND_SHIPMENT_UNAVAILABLE_RETRY_TTL_MS
          : INBOUND_SHIPMENT_TERMINAL_TTL_MS,
      );
    } catch (error) {
      job.shipmentSeed = null;
      job.controller.abort(error);
      if (this.inboundShipmentJobs.get(job.jobId) !== job) return;
      job.state = "failed";
      job.snapshot = null;
      const failure = this.inboundJobFailure(error);
      job.notice = failure.notice;
      job.failure = failure.diagnostic;
      this.retainInboundShipmentTerminalJob(
        job,
        INBOUND_SHIPMENT_TERMINAL_TTL_MS,
      );
    }
  }

  private async startInboundShipments(request: ApiRequest): Promise<ApiResponse> {
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
    this.pruneInboundShipmentJobs();
    const mode = usesDemoMode(marketplaceId) ? "demo" : "live";
    const accountScope = await this.vault.getAccountScope(MARKETPLACES[marketplaceId].region);
    const selection = stableFingerprint({
      accountScope,
      marketplaceId,
      mode,
      startDate,
      endDate,
    });
    const existingId = this.inboundShipmentSelections.get(selection);
    const existing = existingId ? this.inboundShipmentJobs.get(existingId) : null;
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
      return this.inboundShipmentJobReply(existing);
    }
    if (existing) this.removeInboundShipmentJob(existing.jobId);
    for (const candidate of [...this.inboundShipmentJobs.values()]) {
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
      this.removeInboundShipmentJob(candidate.jobId);
    }
    const controller = new AbortController();
    const job: InboundShipmentJob = {
      jobId: randomUUID(),
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
      expiresAt: Date.now() + INBOUND_SHIPMENT_ACTIVE_TTL_MS,
      expiryTimer: null,
      controller,
      flight: null,
    };
    this.inboundShipmentJobs.set(job.jobId, job);
    this.inboundShipmentSelections.set(selection, job.jobId);
    job.flight = this.runInboundShipmentJob(job).finally(() => {
      job.flight = null;
    });
    void job.flight;
    return this.inboundShipmentJobReply(job);
  }

  private async inboundShipmentsStatus(request: ApiRequest): Promise<ApiResponse> {
    const allowedKeys = new Set(["marketplaceId", "jobId", "startDate", "endDate"]);
    if (Object.keys(request.query).some((key) => !allowedKeys.has(key))) {
      return invalid("FBA 入庫貨件工作查詢包含不支援的欄位。");
    }
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = this.reportIdentifier(request.query.jobId);
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
    this.pruneInboundShipmentJobs();
    const job = this.inboundShipmentJobs.get(jobId);
    if (!job || job.marketplaceId !== marketplaceId) {
      return invalid("找不到這份 FBA 入庫貨件工作，請重新同步。", 404, "JOB_NOT_FOUND");
    }
    if (job.startDate !== startDate || job.endDate !== endDate) {
      return invalid(
        "FBA 入庫貨件工作與所選日期區間不一致，請重新同步。",
        409,
        "JOB_MISMATCH",
      );
    }
    try {
      await this.assertInboundShipmentJobContext(job);
    } catch {
      job.controller.abort(new Error("FBA 入庫貨件工作 context 已變更。"));
      this.removeInboundShipmentJob(job.jobId);
      return invalid(
        "FBA 入庫貨件工作不屬於目前帳號、站點或模式，請重新同步。",
        409,
        "JOB_MISMATCH",
      );
    }
    return this.inboundShipmentJobReply(job);
  }

  private async orders(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(
      request.query.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
    );
    const days = integer(request.query.days, 14, 1, 90);
    const fulfillmentStatus = request.query.status || null;
    const paginationToken = request.query.paginationToken || null;
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");
    if (days === null) return invalid("日期範圍必須介於 1 到 90 天。");
    if (fulfillmentStatus && !isFulfillmentStatus(fulfillmentStatus)) {
      return invalid("不支援這個訂單狀態。");
    }
    if (paginationToken && paginationToken.length > 4_096) {
      return invalid("分頁資訊無效，請重新查詢。");
    }
    try {
      const snapshot = await searchOrders({
        marketplaceId,
        lastUpdatedAfter: new Date(Date.now() - days * 86_400_000).toISOString(),
        fulfillmentStatus,
        fulfilledBy: "AMAZON",
        paginationToken,
        maxResultsPerPage: 50,
      });
      return json({ ...snapshot, marketplace: MARKETPLACES[marketplaceId] });
    } catch (error) {
      return apiError(error, "載入訂單時發生未預期的錯誤。");
    }
  }

  private async salesTrend(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(
      request.query.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
    );
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");

    const supplied = (name: string) =>
      Object.prototype.hasOwnProperty.call(request.query, name);
    const hasDays = supplied("days");
    const hasStartDate = supplied("startDate");
    const hasEndDate = supplied("endDate");
    if (hasDays && (hasStartDate || hasEndDate)) {
      return invalid("預設天數與自訂日期不可同時使用。");
    }
    if (hasStartDate !== hasEndDate) {
      return invalid("自訂日期必須同時提供開始日與結束日。");
    }

    let days: SalesTrendPresetDays | null = null;
    let startDate: string | null = null;
    let endDate: string | null = null;
    if (hasDays) {
      if (!/^(?:7|14|30|90)$/.test(request.query.days)) {
        return invalid("銷售趨勢只支援最近 7、14、30 或 90 天。");
      }
      days = Number(request.query.days) as SalesTrendPresetDays;
    } else if (hasStartDate && hasEndDate) {
      const parsedStart = optionalDate(request.query.startDate);
      const parsedEnd = optionalDate(request.query.endDate);
      if (typeof parsedStart !== "string" || typeof parsedEnd !== "string") {
        return invalid("自訂日期必須使用 YYYY-MM-DD 格式。");
      }
      startDate = parsedStart;
      endDate = parsedEnd;
    } else {
      days = 7;
    }

    const comparison = request.query.comparison ?? "none";
    if (comparison !== "none" && comparison !== "previous-year") {
      return invalid("不支援這個銷售趨勢比較方式。");
    }
    try {
      return json(
        await getSalesTrend({
          marketplaceId,
          days,
          startDate,
          endDate,
          comparison: comparison as SalesTrendComparisonMode,
        }),
      );
    } catch (error) {
      return apiError(error, "載入 FBA 銷售趨勢時發生未預期的錯誤。");
    }
  }

  private pruneBrandSalesJobs(now = Date.now()): void {
    for (const [jobId, job] of this.brandSalesJobs) {
      if (job.expiresAt <= now) this.brandSalesJobs.delete(jobId);
    }
  }

  private brandSalesRuntimeJob(record: BrandSalesJobRecord): BrandSalesRuntimeJob {
    const current = this.brandSalesJobs.get(record.jobId);
    if (current) {
      const snapshot = current.snapshot;
      Object.assign(current, structuredClone(record));
      current.snapshot = snapshot;
      return current;
    }
    const job: BrandSalesRuntimeJob = {
      ...structuredClone(record),
      snapshot: null,
    };
    this.brandSalesJobs.set(job.jobId, job);
    return job;
  }

  private brandSalesLegReusable(leg: BrandSalesReportLeg): boolean {
    return (
      Boolean(leg.reportId) &&
      leg.terminal === null &&
      (leg.status === "IN_QUEUE" ||
        leg.status === "IN_PROGRESS" ||
        (leg.status === "DONE" && Boolean(leg.documentId)))
    );
  }

  private brandSalesJobReady(job: BrandSalesRuntimeJob): boolean {
    return (
      job.listing.status === "DONE" &&
      Boolean(job.listing.reportId) &&
      Boolean(job.listing.documentId) &&
      job.shipment.status === "DONE" &&
      Boolean(job.shipment.reportId) &&
      Boolean(job.shipment.documentId)
    );
  }

  private brandSalesJobReply(job: BrandSalesRuntimeJob): ApiResponse {
    const ready = this.brandSalesJobReady(job);
    const status = ready
      ? "DONE"
      : job.listing.status === "IN_PROGRESS" || job.shipment.status === "IN_PROGRESS"
        ? "IN_PROGRESS"
        : "IN_QUEUE";
    return json(
      {
        jobId: job.jobId,
        mode: job.mode,
        marketplaceId: job.marketplaceId,
        startDate: job.startDate,
        endDate: job.endDate,
        expiresAt: new Date(job.expiresAt).toISOString(),
        ready,
        status,
        message: ready
          ? "Amazon FBA 品牌出貨資料已就緒。"
          : "Amazon 正在準備 FBA 品牌出貨與目前商品清單。",
      },
      ready ? 200 : 202,
    );
  }

  private incompatibleBrandSalesRetryWait(
    job: BrandSalesIncompatibleJobRecord,
    now: number,
  ): number {
    const lastPossibleCreateAt = Math.max(
      job.createdAt,
      job.listing.createdAt ?? 0,
      job.shipment.createdAt ?? 0,
    );
    return Math.max(
      0,
      lastPossibleCreateAt + BRAND_SALES_REUSE_WINDOW_MS - now,
    );
  }

  private brandSalesWaitReply(milliseconds: number): ApiResponse {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1_000));
    return json(
      {
        code: "REPORT_RETRY_WAIT",
        message: `Amazon 報表建立仍在 30 分鐘安全間隔內；請約 ${Math.ceil(seconds / 60)} 分鐘後再重試，系統不會重複建立。`,
      },
      409,
      { "retry-after": String(seconds) },
    );
  }

  private async saveBrandSalesLeg(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    value: BrandSalesReportLeg,
    now = Date.now(),
    extendRetention = false,
  ): Promise<void> {
    const snapshot = job.snapshot;
    const persisted = await this.store.updateBrandSalesJobLeg({
      jobId: job.jobId,
      leg,
      value,
      updatedAt: now,
      ...(extendRetention
        ? { expiresAt: Math.max(job.expiresAt, now + BRAND_SALES_JOB_RETENTION_MS) }
        : {}),
    });
    Object.assign(job, persisted);
    job.snapshot = snapshot;
  }

  private brandSalesReportPlan(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    signal?: AbortSignal,
  ): ReportsIntentPlan {
    const marketplaceId = job.marketplaceId as MarketplaceId;
    return leg === "listing"
      ? { intent: "all-listings", marketplaceId, signal }
      : {
          intent: "fba-shipment-sales",
          marketplaceId,
          startDate: job.startDate,
          endDate: job.endDate,
          dataStartTime: job.shipmentDataStartTime,
          dataEndTime: job.shipmentDataEndTime,
          windowCreatedAt: job.createdAt,
          signal,
        };
  }

  private async mirrorBrandSalesReceipt(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    status: DurableReportStatus,
  ): Promise<void> {
    await this.saveBrandSalesLeg(job, leg, {
      reportId: status.reportId,
      documentId: status.documentId,
      status: status.status,
      createdAt: job[leg].createdAt ?? Date.now(),
      terminal: null,
      terminalAt: null,
    });
  }

  private async normalizeBrandSalesLeg(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
  ): Promise<void> {
    const legacy = job[leg];
    if (
      legacy.status === "NOT_STARTED" &&
      !legacy.reportId &&
      !legacy.terminal
    ) return;
    const plan = this.brandSalesReportPlan(job, leg);
    const opaque = legacy.reportId?.startsWith("report-lease.") ?? false;
    if (!opaque) {
      await this.reportsRuntime.adopt(plan, {
        report: legacy,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        expiresAt: job.expiresAt,
      });
    }
    const projected = await this.reportsRuntime.projectDurableLeg(plan);
    if (!projected) {
      throw new SpApiError("品牌營收報表 lease 已失效。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    if (
      opaque &&
      (projected.reportId !== legacy.reportId ||
        (legacy.documentId !== null &&
          projected.documentId !== legacy.documentId))
    ) {
      throw new SpApiError("品牌營收工作與 Reports runtime 不一致。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    if (JSON.stringify(projected) !== JSON.stringify(legacy)) {
      await this.saveBrandSalesLeg(job, leg, projected);
    }
  }

  private async normalizeBrandSalesJob(
    job: BrandSalesRuntimeJob,
  ): Promise<void> {
    await Promise.all([
      this.normalizeBrandSalesLeg(job, "listing"),
      this.normalizeBrandSalesLeg(job, "shipment"),
    ]);
  }

  private async startBrandSalesLeg(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    explicitRetry: boolean,
  ): Promise<unknown | null> {
    try {
      const plan = this.brandSalesReportPlan(job, leg);
      const status = await this.reportsRuntime.start(
        plan,
        { explicitRetry },
      );
      await this.mirrorBrandSalesReceipt(job, leg, status);
      return null;
    } catch (error) {
      try {
        const projected = await this.reportsRuntime.projectDurableLeg(
          this.brandSalesReportPlan(job, leg),
        );
        if (projected) await this.saveBrandSalesLeg(job, leg, projected);
      } catch {
        // Preserve the originating Reports error. The runtime lease remains
        // authoritative even if the compatibility job projection cannot save.
      }
      return error;
    }
  }

  private async startSharedAllListingsReport(
    marketplaceId: MarketplaceId,
    explicitRetry: boolean,
    signal?: AbortSignal,
    options: Readonly<{
      freshCompleted?: boolean;
      purpose?: FbaCatalogReportsPurpose;
    }> = {},
  ): Promise<DurableReportStatus> {
    assertBackgroundActive(signal);
    return this.fbaCatalogReports.begin({
      purpose: options.purpose ?? "catalog",
      marketplaceId,
      explicitRetry,
      freshCompleted: options.freshCompleted,
      signal,
    });
  }

  private async getSharedAllListingsReportStatus(input: {
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
  }): Promise<DurableReportStatus> {
    assertBackgroundActive(input.signal);
    return this.fbaCatalogReports.status(input);
  }

  private async getSharedAllListingsExportData(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      reportId: string;
      documentId: string;
      signal?: AbortSignal;
      onProgress?: (
        progress: CatalogExportProgress,
      ) => void | Promise<void>;
    }>,
  ): Promise<FbaCatalogExport> {
    return this.fbaCatalogReports.read({
      view: "export",
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      documentId: input.documentId,
      signal: input.signal,
      onProgress: input.onProgress,
    });
  }

  private async getSharedUnboundVariationAuditData(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      reportId: string;
      documentId: string;
      signal?: AbortSignal;
    }>,
  ): Promise<UnboundVariationAuditSnapshot> {
    const seeds = await this.fbaCatalogReports.read({
      view: "seeds",
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      documentId: input.documentId,
      signal: input.signal,
    });
    if (usesDemoMode(input.marketplaceId)) {
      return getDemoUnboundVariationAuditData({
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      });
    }
    return readUnboundVariationAudit(this.catalogListings, {
      marketplaceId: input.marketplaceId,
      seeds,
      signal: input.signal,
    });
  }

  private async getSharedBusinessPricingAuditData(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      reportId: string;
      documentId: string;
      signal?: AbortSignal;
      heartbeat?: () => void;
    }>,
  ): Promise<BusinessPricingAuditSnapshot> {
    return this.fbaCatalogReports.read({
      view: "business-pricing-audit",
      marketplaceId: input.marketplaceId,
      reportId: input.reportId,
      documentId: input.documentId,
      signal: input.signal,
      heartbeat: input.heartbeat,
    });
  }

  private async ensureBrandSalesListingLeg(
    job: BrandSalesRuntimeJob,
    explicitRetry: boolean,
  ): Promise<unknown | null> {
    if (this.brandSalesLegReusable(job.listing)) return null;
    return this.startBrandSalesLeg(job, "listing", explicitRetry);
  }

  private async startBrandSalesSelection(input: {
    accountScope: string;
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    retry: boolean;
  }): Promise<ApiResponse> {
    const now = Date.now();
    const mode = usesDemoMode(input.marketplaceId) ? "demo" : "live";
    this.pruneBrandSalesJobs(now);
    let stored = await this.store.getBrandSalesJob(input);
    let incompatibleToReplace: BrandSalesIncompatibleJobRecord | null = null;
    if (stored && stored.mode !== mode) {
      if (stored.mode === "demo" && mode === "live") {
        await this.store.deleteBrandSalesJob(stored.jobId);
        this.brandSalesJobs.delete(stored.jobId);
        stored = null;
      } else {
        return invalid(
          "尚有真實 Amazon 品牌營收工作紀錄；展示模式不會覆蓋或重送它。",
          409,
          "REPORT_MODE_CHANGED",
        );
      }
    }
    if (stored && isBrandSalesIncompatibleJob(stored)) {
      if (!input.retry) {
        return invalid(
          "上次品牌營收工作缺少新版不可變時間窗；已保留 Amazon 報表識別，不會自動重建。請明確重試。",
          409,
          "BRAND_REPORT_WINDOW_INCOMPATIBLE",
        );
      }
      const wait = this.incompatibleBrandSalesRetryWait(stored, now);
      if (wait > 0) return this.brandSalesWaitReply(wait);
      incompatibleToReplace = stored;
      stored = null;
    }
    if (
      stored &&
      stored.expiresAt <= now &&
      stored.listing.status === "DONE" &&
      stored.shipment.status === "DONE" &&
      this.brandSalesLegReusable(stored.listing) &&
      this.brandSalesLegReusable(stored.shipment)
    ) {
      // Completed documents may be refreshed after the local reuse window.
      // Unresolved/active records remain durable tombstones instead.
      await this.store.deleteBrandSalesJob(stored.jobId);
      this.brandSalesJobs.delete(stored.jobId);
      stored = null;
    }
    let job = stored ? this.brandSalesRuntimeJob(stored) : null;

    if (job) {
      await this.normalizeBrandSalesJob(job);
      const bothReusable =
        this.brandSalesLegReusable(job.listing) &&
        this.brandSalesLegReusable(job.shipment);
      if (bothReusable) {
        const retentionRemaining = job.expiresAt - now;
        const activeLeg = (["listing", "shipment"] as const).find((leg) =>
          job![leg].status === "IN_QUEUE" || job![leg].status === "IN_PROGRESS"
        );
        if (
          activeLeg &&
          retentionRemaining <= BRAND_SALES_NEAR_REUSE_BOUNDARY_MS
        ) {
          await this.saveBrandSalesLeg(
            job,
            activeLeg,
            job[activeLeg],
            now,
            true,
          );
          return this.brandSalesJobReply(job);
        }
        if (retentionRemaining > BRAND_SALES_NEAR_REUSE_BOUNDARY_MS) {
          return this.brandSalesJobReply(job);
        }
        if (retentionRemaining > 0) {
          return this.brandSalesWaitReply(retentionRemaining);
        }
      }
    }

    if (!job) {
      const window = this.brandSalesReports.reportWindow({
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        now: new Date(now),
      });
      const emptyLeg = (): BrandSalesReportLeg => ({
        reportId: null,
        documentId: null,
        status: "NOT_STARTED",
        createdAt: null,
        terminal: null,
        terminalAt: null,
      });
      const candidate: BrandSalesJobRecord = {
        jobId: randomUUID(),
        accountScope: input.accountScope,
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        mode,
        shipmentDataStartTime: window.dataStartTime,
        shipmentDataEndTime: window.dataEndTime,
        listing: emptyLeg(),
        shipment: emptyLeg(),
        createdAt: now,
        updatedAt: now,
        expiresAt: now + BRAND_SALES_JOB_RETENTION_MS,
      };
      const claimed = incompatibleToReplace
        ? await this.store.replaceIncompatibleBrandSalesJob({
            expectedJobId: incompatibleToReplace.jobId,
            replacement: candidate,
          })
        : await this.store.createBrandSalesJobIfAbsent(candidate, now);
      job = this.brandSalesRuntimeJob(claimed.job);
      if (!claimed.created) {
        return this.startBrandSalesSelection(input);
      }
    }

    const results = await Promise.all([
      this.ensureBrandSalesListingLeg(job, input.retry),
      this.brandSalesLegReusable(job.shipment)
        ? Promise.resolve(null)
        : this.startBrandSalesLeg(job, "shipment", input.retry),
    ]);
    const failure = results.find((value) => value !== null);
    if (failure) {
      if (
        failure instanceof SpApiError &&
        failure.code === "SHARED_REPORT_RETRY_REQUIRED"
      ) {
        return invalid(
          "上次品牌營收工作只完成一部分；已保留成功報表，請按重試只補齊缺少的一側。",
          409,
          "BRAND_REPORT_RETRY_REQUIRED",
        );
      }
      return apiError(failure, "開始整理 FBA 品牌營收時發生未預期的錯誤。");
    }
    return this.brandSalesJobReply(job);
  }

  private async startBrandSales(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    const startDate = optionalDate(body?.startDate);
    const endDate = optionalDate(body?.endDate);
    if (
      !body ||
      !marketplaceId ||
      typeof startDate !== "string" ||
      typeof endDate !== "string" ||
      (body.retry !== undefined && body.retry !== true)
    ) {
      return invalid("品牌營收需要有效站點與完整 YYYY-MM-DD 日期範圍。");
    }
    try {
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[marketplaceId].region,
      );
      const mode = usesDemoMode(marketplaceId) ? "demo" : "live";
      // The exact account/market/mode/date selection has one creation flight.
      // A concurrent explicit retry must never bypass an automatic start that
      // is already claiming the same durable job.
      const flightKey = `${accountScope}:${marketplaceId}:${mode}:${startDate}:${endDate}`;
      const existing = this.brandSalesStartFlights.get(flightKey);
      if (existing) return existing;
      const flight = this.startBrandSalesSelection({
        accountScope,
        marketplaceId,
        startDate,
        endDate,
        retry: body.retry === true,
      }).finally(() => {
        if (this.brandSalesStartFlights.get(flightKey) === flight) {
          this.brandSalesStartFlights.delete(flightKey);
        }
      });
      this.brandSalesStartFlights.set(flightKey, flight);
      return flight;
    } catch (error) {
      return apiError(error, "開始整理 FBA 品牌營收時發生未預期的錯誤。");
    }
  }

  private async loadBrandSalesJob(jobId: string): Promise<BrandSalesRuntimeJob | null> {
    const cached = this.brandSalesJobs.get(jobId);
    if (cached) return cached;
    const stored = await this.store.getBrandSalesJobById(jobId);
    return stored && !isBrandSalesIncompatibleJob(stored)
      ? this.brandSalesRuntimeJob(stored)
      : null;
  }

  private async markBrandSalesPollFailure(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    error: unknown,
  ): Promise<void> {
    if (
      !(error instanceof SpApiError) ||
      (error.code !== "REPORT_CANCELLED" &&
        error.code !== "REPORT_FATAL")
    ) {
      return;
    }
    const terminal = error.code === "REPORT_CANCELLED" ? "CANCELLED" : "FATAL";
    await this.saveBrandSalesLeg(job, leg, {
      reportId: job[leg].reportId,
      documentId: null,
      status: terminal,
      createdAt: job[leg].createdAt,
      terminal,
      terminalAt: Date.now(),
    });
  }

  private async pollBrandSalesJobState(
    job: BrandSalesRuntimeJob,
  ): Promise<ApiResponse | null> {
    const marketplaceId = job.marketplaceId as MarketplaceId;
    try {
      const mode = usesDemoMode(marketplaceId) ? "demo" : "live";
      if (job.mode !== mode) {
        throw new SpApiError("App 展示／真實模式已改變，已停止讀取舊報表。", {
          status: 409,
          code: "REPORT_MODE_CHANGED",
        });
      }
      if (
        (job.listing.status === "IN_QUEUE" || job.listing.status === "IN_PROGRESS") &&
        job.listing.reportId
      ) {
        try {
          const listing = await this.getSharedAllListingsReportStatus({
            marketplaceId,
            reportId: job.listing.reportId,
          });
          if (
            listing.status !== "IN_QUEUE" &&
            listing.status !== "IN_PROGRESS" &&
            listing.status !== "DONE"
          ) {
            throw new SpApiError("Amazon 未能產生目前 FBA 商品清單。", {
              status: 422,
              code: listing.status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL",
            });
          }
          if (listing.status === "DONE" && !listing.documentId) {
            throw new SpApiError("Amazon FBA 商品清單已完成但缺少文件編號。", {
              status: 502,
              code: "REPORT_FAILED",
            });
          }
          if (
            job.listing.status !== listing.status ||
            job.listing.documentId !== listing.documentId
          ) {
            await this.saveBrandSalesLeg(job, "listing", {
              ...job.listing,
              documentId: listing.documentId,
              status: listing.status,
            });
          }
        } catch (error) {
          await this.markBrandSalesPollFailure(job, "listing", error);
          throw error;
        }
      }
      if (
        (job.shipment.status === "IN_QUEUE" || job.shipment.status === "IN_PROGRESS") &&
        job.shipment.reportId
      ) {
        try {
          const shipment = await this.reportsRuntime.status(
            this.brandSalesReportPlan(job, "shipment"),
            job.shipment.reportId,
          );
          if (
            job.shipment.status !== shipment.status ||
            job.shipment.documentId !== shipment.documentId
          ) {
            await this.saveBrandSalesLeg(job, "shipment", {
              ...job.shipment,
              documentId: shipment.documentId,
              status: shipment.status,
            });
          }
        } catch (error) {
          await this.markBrandSalesPollFailure(job, "shipment", error);
          throw error;
        }
      }
      return null;
    } catch (error) {
      return apiError(error, "整理 FBA 品牌營收時發生未預期的錯誤。");
    }
  }

  private async loadBrandSalesData(
    job: BrandSalesRuntimeJob,
  ): Promise<ApiResponse> {
    const marketplaceId = job.marketplaceId as MarketplaceId;
    try {
      const mode = usesDemoMode(marketplaceId) ? "demo" : "live";
      if (job.mode !== mode) {
        throw new SpApiError("App 展示／真實模式已改變，已停止讀取舊報表。", {
          status: 409,
          code: "REPORT_MODE_CHANGED",
        });
      }
      if (
        !this.brandSalesJobReady(job) ||
        !job.listing.reportId ||
        !job.listing.documentId ||
        !job.shipment.reportId ||
        !job.shipment.documentId
      ) {
        return invalid("Amazon 品牌營收報表尚未完成。", 409, "REPORT_NOT_READY");
      }
      if (!job.snapshot) {
        const [listingDocument, shipmentDocument] = await Promise.all([
          this.reportsRuntime.readDocument(
            { intent: "all-listings", marketplaceId },
            {
              reportId: job.listing.reportId,
              documentId: job.listing.documentId,
            },
          ),
          this.reportsRuntime.readDocument(
            this.brandSalesReportPlan(job, "shipment"),
            {
              reportId: job.shipment.reportId,
              documentId: job.shipment.documentId,
            },
          ),
        ]);
        if (
          listingDocument.mode !== job.mode ||
          shipmentDocument.mode !== job.mode
        ) {
          throw new SpApiError("品牌營收報表模式已改變。", {
            status: 409,
            code: "REPORT_MODE_CHANGED",
          });
        }
        job.snapshot = await this.brandSalesReports.getDataFromDocuments({
          marketplaceId,
          mode: job.mode,
          startDate: job.startDate,
          endDate: job.endDate,
          listingDocument: listingDocument.text,
          shipmentDocument: shipmentDocument.text,
          shipmentDataStartTime: job.shipmentDataStartTime,
          shipmentDataEndTime: job.shipmentDataEndTime,
          windowCreatedAt: job.createdAt,
        });
      }
      return json(structuredClone(job.snapshot));
    } catch (error) {
      return apiError(error, "整理 FBA 品牌營收時發生未預期的錯誤。");
    }
  }

  private async brandSalesStatusOrData(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = this.reportIdentifier(request.query.jobId);
    if (!marketplaceId || !jobId) {
      return invalid("品牌營收工作資訊無效，請重新同步。");
    }
    this.pruneBrandSalesJobs();
    const job = await this.loadBrandSalesJob(jobId);
    if (!job || job.marketplaceId !== marketplaceId) {
      return invalid(
        "品牌營收工作已過期或站點不符，請重新同步。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    const mode = usesDemoMode(marketplaceId) ? "demo" : "live";
    if (job.mode !== mode) {
      if (job.mode === "demo" && mode === "live") {
        await this.store.deleteBrandSalesJob(job.jobId);
        this.brandSalesJobs.delete(job.jobId);
      }
      return invalid(
        "App 展示／真實模式已改變，舊品牌營收工作不可繼續。",
        409,
        "REPORT_MODE_CHANGED",
      );
    }
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    if (job.accountScope !== accountScope) {
      this.brandSalesJobs.delete(jobId);
      return invalid(
        "Amazon 帳號範圍已改變，舊品牌營收工作不可繼續。",
        409,
        "ACCOUNT_SCOPE_CHANGED",
      );
    }
    try {
      await this.normalizeBrandSalesJob(job);
    } catch (error) {
      return apiError(error, "整理 FBA 品牌營收時發生未預期的錯誤。");
    }
    const now = Date.now();
    if (job.expiresAt <= now && this.brandSalesJobReady(job)) {
      await this.store.deleteBrandSalesJob(job.jobId);
      this.brandSalesJobs.delete(job.jobId);
      return invalid(
        "品牌營收快照已過期，請重新同步。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    if (job.expiresAt <= now) {
      const activeLeg = (["listing", "shipment"] as const).find((leg) =>
        job[leg].status === "IN_QUEUE" || job[leg].status === "IN_PROGRESS"
      );
      if (activeLeg) {
        await this.saveBrandSalesLeg(
          job,
          activeLeg,
          job[activeLeg],
          now,
          true,
        );
      } else if (!job.listing.terminal && !job.shipment.terminal) {
        return invalid(
          "上次品牌營收工作狀態未完成；系統已禁止自動重送，請回到品牌區明確重試。",
          409,
          "BRAND_REPORT_RETRY_REQUIRED",
        );
      }
    }
    if (job.listing.terminal || job.shipment.terminal) {
      const terminal = job.shipment.terminal ?? job.listing.terminal;
      return invalid(
        terminal === "CANCELLED"
          ? "Amazon 已取消 FBA 品牌出貨報表；已保留另一側成功結果，不會自動重建。"
          : "Amazon 品牌營收報表工作未完成；已保留成功的一側，請明確重試。",
        409,
        terminal === "CANCELLED" ? "REPORT_CANCELLED" : terminal === "FATAL" ? "REPORT_FATAL" : "BRAND_REPORT_RETRY_REQUIRED",
      );
    }
    let pollFlight = this.brandSalesPollFlights.get(jobId);
    if (!pollFlight) {
      pollFlight = this.pollBrandSalesJobState(job).finally(() => {
        if (this.brandSalesPollFlights.get(jobId) === pollFlight) {
          this.brandSalesPollFlights.delete(jobId);
        }
      });
      this.brandSalesPollFlights.set(jobId, pollFlight);
    }
    const pollError = await pollFlight;
    if (pollError) return pollError;

    if (request.query.data !== "1") return this.brandSalesJobReply(job);
    let dataFlight = this.brandSalesDataFlights.get(jobId);
    if (!dataFlight) {
      dataFlight = this.loadBrandSalesData(job).finally(() => {
        if (this.brandSalesDataFlights.get(jobId) === dataFlight) {
          this.brandSalesDataFlights.delete(jobId);
        }
      });
      this.brandSalesDataFlights.set(jobId, dataFlight);
    }
    return dataFlight;
  }

  private listingIdentity(request: ApiRequest):
    | { marketplaceId: MarketplaceId; sellerSku: string }
    | ApiResponse {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    return marketplaceId && sellerSku
      ? { marketplaceId, sellerSku }
      : invalid("請選擇站點並輸入完整 SKU。");
  }

  private async listingPrice(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    try {
      const snapshot = await getListingPrice(identity);
      await this.reconcilePriceWrites(snapshot);
      return json(snapshot);
    } catch (error) {
      return apiError(error, "查詢 SKU 價格時發生未預期的錯誤。");
    }
  }

  private async startBusinessPricingAudit(
    request: ApiRequest,
  ): Promise<ApiResponse> {
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
      const status = await this.startSharedAllListingsReport(
        marketplaceId,
        true,
        undefined,
        { purpose: "business-pricing-audit" },
      );
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return apiError(error, "開始建立 B2B 價格健檢報表時發生未預期的錯誤。");
    }
  }

  private async businessPricingAuditStatusOrData(
    request: ApiRequest,
  ): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const reportId = this.reportIdentifier(request.query.reportId);
    if (!marketplaceId || !reportId) {
      return invalid("B2B 價格健檢報表資訊無效，請重新掃描。");
    }
    if (request.query.data !== "1") {
      try {
        const status = await this.getSharedAllListingsReportStatus({
          marketplaceId,
          reportId,
        });
        return json({ ...status, message: status.notice });
      } catch (error) {
        return apiError(error, "查詢 B2B 價格健檢進度時發生未預期的錯誤。");
      }
    }
    const documentId = this.reportIdentifier(request.query.documentId);
    if (!documentId) {
      return invalid("B2B 價格健檢文件資訊無效，請重新掃描。");
    }
    try {
      return json(await this.getSharedBusinessPricingAuditData({
        marketplaceId,
        reportId,
        documentId,
      }));
    } catch (error) {
      return apiError(error, "整理 B2B 價格健檢資料時發生未預期的錯誤。");
    }
  }

  private async businessPricingAuditExport(
    request: ApiRequest,
  ): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const mode = request.query.mode === "live" || request.query.mode === "demo"
      ? request.query.mode
      : null;
    const jobId = this.reportIdentifier(request.query.jobId);
    const contextId = this.reportIdentifier(request.query.contextId);
    if (!marketplaceId || !mode || !jobId || !contextId) {
      return invalid("B2B 價格 Excel 工作資訊無效，請重新執行健檢。");
    }
    try {
      const receipt = await this.standaloneAuditJobs.get({
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
      const snapshot = receipt.snapshot as BusinessPricingAuditSnapshot;
      const marketplace = MARKETPLACES[marketplaceId];
      const workbook = createBusinessPricingAuditWorkbook({
        marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
        snapshot,
      });
      const date = snapshot.fetchedAt.slice(0, 10);
      const filename = `amazon-fba-business-pricing-audit-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
      const localizedFilename = `FBA-B2B價格健檢-${marketplace.shortLabel}-${date}.xlsx`;
      return bytes(
        workbook,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        {
          "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(localizedFilename)}`,
          "x-exported-fba-sku-count": String(snapshot.summary.totalFbaSkuCount),
          "x-b2b-price-mismatch-count": String(
            snapshot.summary.recommendedPriceMismatch,
          ),
          "x-b2b-tier-mismatch-count": String(
            snapshot.summary.recommendedQuantityDiscountMismatch,
          ),
        },
      );
    } catch (error) {
      return apiError(error, "建立 B2B 價格健檢 Excel 時發生未預期的錯誤。");
    }
  }

  private async businessPricing(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    try {
      const snapshot = await getBusinessPricing(identity);
      await this.reconcilePriceWrites(snapshot);
      await this.reconcileBusinessPriceWrites(snapshot);
      return json(snapshot);
    } catch (error) {
      return apiError(error, "查詢 Amazon Business 價格時發生未預期的錯誤。");
    }
  }

  private businessPricingInput(request: ApiRequest):
    | (UpdateBusinessPriceInput & { idempotencyKey: string })
    | ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "B2B 價格請求必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const allowedKeys = new Set([
      "marketplaceId",
      "sellerSku",
      "expectedStandardPrice",
      "expectedBusinessPrice",
      "newBusinessPrice",
      "expectedQuantityDiscountPlanHash",
      "quantityDiscountTiers",
      "idempotencyKey",
    ]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return invalid("B2B 價格請求包含不支援的欄位。");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const key = idempotencyKey(body.idempotencyKey);
    if (!marketplaceId || !sellerSku || !key) {
      return invalid("請提供有效的 Amazon 站點、完整 SKU 與預檢識別碼。");
    }
    const currency = MARKETPLACES[marketplaceId].currency;
    const expectedStandardPrice = parsePrice(
      body.expectedStandardPrice,
      currency,
    );
    const expectedBusinessPrice = body.expectedBusinessPrice === null
      ? null
      : parsePrice(body.expectedBusinessPrice, currency);
    const newBusinessPrice = parsePrice(body.newBusinessPrice, currency);
    if (
      expectedStandardPrice === null ||
      (body.expectedBusinessPrice !== null && expectedBusinessPrice === null) ||
      newBusinessPrice === null
    ) {
      return invalid(
        currency === "JPY"
          ? "一般售價與 B2B 價格必須是大於 0 的整數。"
          : "一般售價與 B2B 價格必須大於 0，且最多只能有兩位小數。",
        400,
        "INVALID_PRICE",
      );
    }
    const hasExpectedPlanHash = Object.prototype.hasOwnProperty.call(
      body,
      "expectedQuantityDiscountPlanHash",
    );
    const hasTiers = Object.prototype.hasOwnProperty.call(
      body,
      "quantityDiscountTiers",
    );
    if (hasExpectedPlanHash !== hasTiers) {
      return invalid(
        "數量折扣更新必須同時提供舊方案 hash 與完整 tiers；省略兩者才代表價格-only 並保留原方案。",
        400,
        "INVALID_QUANTITY_DISCOUNT",
      );
    }
    let expectedQuantityDiscountPlanHash: string | null | undefined;
    let quantityDiscountTiers: UpdateBusinessPriceInput["quantityDiscountTiers"];
    if (hasTiers) {
      expectedQuantityDiscountPlanHash = body.expectedQuantityDiscountPlanHash ===
          null
        ? null
        : typeof body.expectedQuantityDiscountPlanHash === "string" &&
            /^[a-f0-9]{64}$/u.test(body.expectedQuantityDiscountPlanHash)
          ? body.expectedQuantityDiscountPlanHash
          : undefined;
      if (
        expectedQuantityDiscountPlanHash === undefined ||
        !Array.isArray(body.quantityDiscountTiers) ||
        body.quantityDiscountTiers.length < 1 ||
        body.quantityDiscountTiers.length > 5
      ) {
        return invalid(
          "數量折扣必須提供 1–5 階完整方案與可核對的舊方案 hash。",
          400,
          "INVALID_QUANTITY_DISCOUNT",
        );
      }
      const parsedTiers: NonNullable<
        UpdateBusinessPriceInput["quantityDiscountTiers"]
      > = [];
      for (const rawTier of body.quantityDiscountTiers) {
        if (!isPlainRecord(rawTier) ||
            Object.keys(rawTier).length !== 2 ||
            !("lowerBound" in rawTier) || !("percent" in rawTier)) {
          return invalid(
            "每一階數量折扣只能包含 lowerBound 與 percent。",
            400,
            "INVALID_QUANTITY_DISCOUNT",
          );
        }
        const lowerBound = rawTier.lowerBound;
        const percent = rawTier.percent;
        const previous = parsedTiers.at(-1);
        if (
          !Number.isSafeInteger(lowerBound) || Number(lowerBound) <= 0 ||
          Number(lowerBound) > 999_999_999 ||
          typeof percent !== "number" || !Number.isFinite(percent) ||
          percent <= 0 || percent >= 100 ||
          Number(percent.toFixed(2)) !== percent ||
          (previous !== undefined &&
            (Number(lowerBound) <= previous.lowerBound ||
              percent <= previous.percent))
        ) {
          return invalid(
            "數量折扣件數與百分比必須合法且逐階嚴格遞增（百分比最多兩位小數）。",
            400,
            "INVALID_QUANTITY_DISCOUNT",
          );
        }
        parsedTiers.push({ lowerBound: Number(lowerBound), percent });
      }
      quantityDiscountTiers = parsedTiers;
    }
    return {
      marketplaceId,
      sellerSku,
      expectedStandardPrice,
      expectedBusinessPrice,
      newBusinessPrice,
      ...(hasTiers ? {
        expectedQuantityDiscountPlanHash,
        quantityDiscountTiers,
      } : {}),
      idempotencyKey: key,
    };
  }

  private businessPricingFingerprint(
    input: UpdateBusinessPriceInput,
    evidence: BusinessPricePrecommitEvidence,
  ): string {
    return stableFingerprint([
      input.marketplaceId,
      input.sellerSku,
      input.expectedStandardPrice,
      input.expectedBusinessPrice,
      input.newBusinessPrice,
      input.quantityDiscountTiers === undefined
        ? "quantity-discount:preserve"
        : `quantity-discount:replace:${input.expectedQuantityDiscountPlanHash ?? "absent"}`,
      input.quantityDiscountTiers === undefined
        ? null
        : input.quantityDiscountTiers.map((tier) => [
          tier.lowerBound,
          tier.percent,
        ]),
      evidence.asin,
      evidence.productType,
      evidence.businessOfferGuardHash,
      evidence.businessOfferProtectedHash,
      evidence.previousQuantityDiscountPlanHash,
      evidence.schemaChecksum,
      evidence.fbaEvidenceHash,
      evidence.canonicalPatchHash,
      evidence.validationIssuesHash,
    ]);
  }

  private async previewBusinessPricing(request: ApiRequest): Promise<ApiResponse> {
    const input = this.businessPricingInput(request);
    if ("status" in input) return input;
    try {
      const result = await previewBusinessPriceUpdate(input);
      const scoped = await this.scopedFingerprint(
        input.marketplaceId,
        this.businessPricingFingerprint(input, result),
      );
      this.issuePreview(request.path, input.idempotencyKey, scoped.fingerprint);
      return json(result);
    } catch (error) {
      return apiError(error, "Amazon Business 價格預檢時發生未預期的錯誤。");
    }
  }

  private async commitBusinessPricing(request: ApiRequest): Promise<ApiResponse> {
    const input = this.businessPricingInput(request);
    if ("status" in input) return input;
    let evidence: BusinessPriceValidationResult;
    try {
      evidence = await previewBusinessPriceUpdate(input);
    } catch (error) {
      return apiError(
        error,
        "正式確認前重新執行 Amazon Business 價格預檢時發生未預期的錯誤。",
      );
    }
    const scoped = await this.scopedFingerprint(
      input.marketplaceId,
      this.businessPricingFingerprint(input, evidence),
    );
    const ticketError = await this.approveReservedPreview(
      request.path,
      input.idempotencyKey,
      scoped.fingerprint,
      `確認 B2B 調價｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜一般售價維持 ${input.expectedStandardPrice}｜B2B ${input.expectedBusinessPrice ?? "未設定"} → ${input.newBusinessPrice} ${MARKETPLACES[input.marketplaceId].currency}｜數量折扣 ${evidence.quantityDiscountPlanChange === "preserve" ? "維持原方案" : `${evidence.previousQuantityDiscountPlan ? `${evidence.previousQuantityDiscountPlan.discountType} ${evidence.previousQuantityDiscountPlan.levels.map((level) => `${level.lowerBound}件=${level.value}`).join("、")}` : "未設定"} → ${evidence.requestedQuantityDiscountPlan?.levels.map((level) => `${level.lowerBound}件=${level.value}%`).join("、") ?? "未設定"}`}`,
    );
    if (ticketError) return ticketError;
    try {
      const result = await this.store.runIdempotentOperation({
        idempotencyKey: input.idempotencyKey,
        operationType: "business_price",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        accountScope: scoped.accountScope,
        fingerprint: scoped.fingerprint,
        execute: ({ recordAccepted }) => commitWithCanonicalReadback({
          commit: () => updateBusinessPrice(input, evidence),
          onAccepted: recordAccepted,
          read: () => getBusinessPricing(input),
          decide: businessPriceReadbackDecision,
        }),
      });
      return json(result);
    } catch (error) {
      return apiError(error, "送出 Amazon Business 價格更新時發生未預期的錯誤。");
    }
  }

  private async variationFamily(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const hasSku = request.query.sku !== undefined;
    const hasAsin = request.query.asin !== undefined;
    const sellerSku = hasSku ? parseSellerSku(request.query.sku) : null;
    const asin = hasAsin ? parseAsin(request.query.asin) : null;
    if (
      !marketplaceId ||
      hasSku === hasAsin ||
      (hasSku && !sellerSku) ||
      (hasAsin && !asin)
    ) {
      return invalid(
        "請選擇站點，並且只提供完整 Seller SKU 或原樣 10 碼 ASIN 其中一項。",
      );
    }
    try {
      return json(await getVariationFamilyPlanner({
        marketplaceId,
        ...(sellerSku ? { sellerSku } : { asin: asin! }),
      }));
    } catch (error) {
      return apiError(error, "查詢變體 family 時發生未預期的錯誤。");
    }
  }

  private pruneUnboundVariationAuditSnapshots(now = Date.now()): void {
    for (const [id, entry] of this.unboundVariationAuditSnapshots) {
      if (entry.expiresAt <= now) this.unboundVariationAuditSnapshots.delete(id);
    }
  }

  private async startUnboundVariationAudit(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) {
      return invalid("請選擇要健檢未綁變體的 Amazon 站點。");
    }
    try {
      const status = await this.startSharedAllListingsReport(marketplaceId, true);
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return apiError(error, "開始建立未綁變體健檢報表時發生未預期的錯誤。");
    }
  }

  private async unboundVariationAuditStatusDataOrDownload(
    request: ApiRequest,
  ): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("未綁變體健檢站點無效，請重新掃描。");
    if (request.query.download === "1") {
      const exportId = this.reportIdentifier(request.query.exportId);
      if (!exportId) {
        return invalid("未綁變體 Excel 快照資訊無效，請重新掃描。");
      }
      this.pruneUnboundVariationAuditSnapshots();
      const stored = this.unboundVariationAuditSnapshots.get(exportId);
      if (!stored || stored.marketplaceId !== marketplaceId) {
        return invalid(
          "未綁變體健檢快照已過期或站點不符，請重新掃描。",
          410,
          "SNAPSHOT_EXPIRED",
        );
      }
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[marketplaceId].region,
      );
      if (stored.accountScope !== accountScope) {
        this.unboundVariationAuditSnapshots.delete(exportId);
        return invalid(
          "Amazon 帳號範圍已改變，舊未綁變體快照不可匯出。",
          409,
          "ACCOUNT_SCOPE_CHANGED",
        );
      }
      try {
        const marketplace = MARKETPLACES[marketplaceId];
        const workbook = createUnboundVariationWorkbook({
          marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
          fetchedAt: stored.snapshot.fetchedAt,
          rows: stored.snapshot.rows,
          incompleteRows: stored.snapshot.incompleteRows,
          allVariationRows: stored.snapshot.allVariationRows,
        });
        const date = stored.snapshot.fetchedAt.slice(0, 10);
        const filename = `amazon-fba-unbound-variation-audit-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
        const localizedFilename = `FBA-未綁變體健檢-${marketplace.shortLabel}-${date}.xlsx`;
        return bytes(
          workbook,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          {
            "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(localizedFilename)}`,
            "x-exported-unbound-fba-sku-count": String(stored.snapshot.rows.length),
            "x-exported-incomplete-sku-count": String(
              stored.snapshot.incompleteRows.length,
            ),
          },
        );
      } catch (error) {
        return apiError(error, "建立未綁變體健檢 Excel 時發生未預期的錯誤。");
      }
    }

    const reportId = this.reportIdentifier(request.query.reportId);
    if (!reportId) return invalid("未綁變體報表資訊無效，請重新掃描。");
    if (request.query.data !== "1") {
      try {
        const status = await this.getSharedAllListingsReportStatus({ marketplaceId, reportId });
        return json({ ...status, message: status.notice });
      } catch (error) {
        return apiError(error, "查詢未綁變體報表狀態時發生未預期的錯誤。");
      }
    }
    const documentId = this.reportIdentifier(request.query.documentId);
    if (!documentId) return invalid("未綁變體報表文件資訊無效，請重新掃描。");
    try {
      const snapshot = await this.getSharedUnboundVariationAuditData({
        marketplaceId,
        reportId,
        documentId,
      });
      const exportId = randomUUID();
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[marketplaceId].region,
      );
      this.pruneUnboundVariationAuditSnapshots();
      this.unboundVariationAuditSnapshots.set(exportId, {
        marketplaceId,
        accountScope,
        expiresAt: Date.now() + UNBOUND_VARIATION_AUDIT_SNAPSHOT_TTL_MS,
        snapshot: structuredClone(snapshot),
      });
      return json({ ...snapshot, exportId });
    } catch (error) {
      return apiError(error, "整理未綁變體健檢資料時發生未預期的錯誤。");
    }
  }

  private async variationMovePreparation(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    const targetParentSku = parseSellerSku(request.query.targetSku);
    if (!marketplaceId || !sellerSku || !targetParentSku) {
      return invalid("請選擇站點並提供來源 SKU 與目標 parent SKU。");
    }
    if (sellerSku === targetParentSku) {
      return invalid("來源 SKU 與目標 parent 不能相同。");
    }
    try {
      return json(await getVariationMovePreparation({
        marketplaceId,
        sellerSku,
        targetParentSku,
      }));
    } catch (error) {
      return apiError(error, "準備變體必要欄位時發生未預期的錯誤。");
    }
  }

  private variationMoveInput(request: ApiRequest):
    | (VariationMoveInput & { idempotencyKey: string })
    | ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid("變體請求必須使用 JSON。", 415, "UNSUPPORTED_MEDIA_TYPE");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const action = body.action === "detach" || body.action === "attach"
      ? body.action
      : null;
    if (!marketplaceId || !sellerSku || !action) {
      return invalid("變體請求缺少有效的站點、Seller SKU 或操作階段。");
    }
    const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    if (action === "detach") {
      const expectedSourceParentSku = parseSellerSku(body.expectedSourceParentSku);
      if (
        !expectedSourceParentSku ||
        sellerSku === expectedSourceParentSku ||
        body.targetParentSku !== null ||
        body.variationTheme !== null ||
        !Array.isArray(body.dimensionNames) ||
        body.dimensionNames.length !== 0 ||
        !isPlainRecord(body.dimensionValues) ||
        Object.keys(body.dimensionValues).length !== 0
      ) {
        return invalid(
          "解除變體請求必須只包含查詢時核對的舊 parent，不可夾帶目標 family 資料。",
        );
      }
      return {
        action,
        marketplaceId,
        sellerSku,
        expectedSourceParentSku,
        targetParentSku: null,
        variationTheme: null,
        dimensionNames: [],
        dimensionValues: {},
        idempotencyKey: key,
      };
    }
    const targetParentSku = parseSellerSku(body.targetParentSku);
    const variationTheme = typeof body.variationTheme === "string" &&
      body.variationTheme.trim().length > 0 &&
      body.variationTheme.trim().length <= 120 &&
      !/[\u0000-\u001f\u007f]/.test(body.variationTheme)
      ? body.variationTheme.trim()
      : null;
    const dimensionNames = parseVariationDimensionNames(body.dimensionNames);
    const dimensionValues = dimensionNames
      ? parseVariationDimensionValues(body.dimensionValues, dimensionNames)
      : null;
    if (
      !targetParentSku ||
      !variationTheme ||
      !dimensionNames ||
      !dimensionValues ||
      sellerSku === targetParentSku ||
      body.expectedSourceParentSku !== null
    ) {
      return invalid("綁定變體請求缺少有效的目標 parent、theme 或必要維度資料。");
    }
    return {
      action,
      marketplaceId,
      sellerSku,
      expectedSourceParentSku: null,
      targetParentSku,
      variationTheme,
      dimensionNames,
      dimensionValues,
      idempotencyKey: key,
    };
  }

  private variationMoveFingerprint(input: VariationMoveInput): string {
    return stableFingerprint([
      input.action,
      input.marketplaceId,
      input.sellerSku,
      input.expectedSourceParentSku,
      input.targetParentSku,
      input.variationTheme,
      [...input.dimensionNames].sort(),
      input.dimensionValues,
    ]);
  }

  private async previewVariationMove(request: ApiRequest): Promise<ApiResponse> {
    const input = this.variationMoveInput(request);
    if ("status" in input) return input;
    try {
      const result = await previewVariationMove(input);
      const scoped = await this.scopedFingerprint(
        input.marketplaceId,
        this.variationMoveFingerprint(input),
      );
      this.issuePreview(request.path, input.idempotencyKey, scoped.fingerprint);
      return json(result);
    } catch (error) {
      return apiError(error, "Amazon 變體預檢時發生未預期的錯誤。");
    }
  }

  private async commitVariationMove(request: ApiRequest): Promise<ApiResponse> {
    const input = this.variationMoveInput(request);
    if ("status" in input) return input;
    const key = idempotencyKey(input.idempotencyKey);
    if (!key) return invalid("這次變體預檢確認資訊已失效，請重新執行。");
    const scoped = await this.scopedFingerprint(
      input.marketplaceId,
      this.variationMoveFingerprint(input),
    );
    const reason = input.action === "detach"
      ? `確認解除變體｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜原 parent ${input.expectedSourceParentSku}`
      : `確認加入變體｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku} → ${input.targetParentSku}｜${input.variationTheme}`;
    const ticketError = await this.approveReservedPreview(
      request.path,
      key,
      scoped.fingerprint,
      reason,
    );
    if (ticketError) return ticketError;
    try {
      const result = await this.store.runIdempotentOperation({
        idempotencyKey: key,
        operationType: input.action === "detach" ? "variation_detach" : "variation_attach",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        accountScope: scoped.accountScope,
        fingerprint: scoped.fingerprint,
        execute: () => updateVariationMove(input),
      });
      return json(result);
    } catch (error) {
      return apiError(error, "Amazon 變體寫入或回查時發生未預期的錯誤。");
    }
  }

  private priceInput(request: ApiRequest):
    | {
        marketplaceId: MarketplaceId;
        sellerSku: string;
        newPrice: number;
        expectedPrice: number;
        confirmationSku: string;
        idempotencyKey: string;
      }
    | ApiResponse {
    const body = bodyRecord(request);
    if (!body) return invalid("價格請求必須使用 JSON。", 415, "UNSUPPORTED_MEDIA_TYPE");
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    if (!marketplaceId || !sellerSku) {
      return invalid("請提供有效的 Amazon 站點與完整 SKU。");
    }
    const currency = MARKETPLACES[marketplaceId].currency;
    const newPrice = parsePrice(body.newPrice, currency);
    const expectedPrice = parsePrice(body.expectedPrice, currency);
    if (newPrice === null || expectedPrice === null) {
      return invalid(
        currency === "JPY"
          ? "日圓價格必須是大於 0 的整數。"
          : "價格必須大於 0，且最多只能有兩位小數。",
        400,
        "INVALID_PRICE",
      );
    }
    return {
      marketplaceId,
      sellerSku,
      newPrice,
      expectedPrice,
      confirmationSku: typeof body.confirmationSku === "string" ? body.confirmationSku : "",
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
    };
  }

  private async previewPrice(request: ApiRequest): Promise<ApiResponse> {
    const input = this.priceInput(request);
    if ("status" in input) return input;
    try {
      const result = await previewListingPriceUpdate(input);
      const scoped = await this.scopedFingerprint(
        input.marketplaceId,
        this.priceFingerprint(input),
      );
      this.issuePreview(request.path, input.idempotencyKey, scoped.fingerprint);
      return json(result);
    } catch (error) {
      return apiError(error, "價格預檢時發生未預期的錯誤。");
    }
  }

  private async commitPrice(request: ApiRequest): Promise<ApiResponse> {
    const input = this.priceInput(request);
    if ("status" in input) return input;
    const key = idempotencyKey(input.idempotencyKey);
    if (!key) return invalid("這次調價的確認資訊已失效，請重新預檢。");
    const changeRatio = Math.abs(input.newPrice - input.expectedPrice) / input.expectedPrice;
    if (changeRatio >= 0.2 && input.confirmationSku !== input.sellerSku) {
      return invalid("價格變動達 20%，請重新輸入完整 SKU 才能送出。", 400, "CONFIRMATION_REQUIRED");
    }
    const scoped = await this.scopedFingerprint(
      input.marketplaceId,
      this.priceFingerprint(input),
    );
    const fingerprint = scoped.fingerprint;
    const ticketError = await this.approveReservedPreview(
      request.path,
      key,
      fingerprint,
      `確認調價｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜${input.expectedPrice} → ${input.newPrice} ${MARKETPLACES[input.marketplaceId].currency}`,
    );
    if (ticketError) return ticketError;
    try {
      const result = await this.store.runIdempotentOperation({
        idempotencyKey: key,
        operationType: "price",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        accountScope: scoped.accountScope,
        fingerprint,
        execute: ({ recordAccepted }) => commitWithCanonicalReadback({
          commit: () => updateListingPrice(input),
          onAccepted: recordAccepted,
          read: () => getListingPrice(input),
          decide: priceReadbackDecision,
        }),
      });
      return json(result);
    } catch (error) {
      return apiError(error, "送出價格更新時發生未預期的錯誤。");
    }
  }

  private priceFingerprint(input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
    newPrice: number;
    expectedPrice: number;
  }): string {
    return stableFingerprint([
      input.marketplaceId,
      input.sellerSku,
      input.expectedPrice,
      input.newPrice,
    ]);
  }

  private async batchListings(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId || !Array.isArray(body.skus)) {
      return invalid("請選擇站點並提供 SKU 清單。");
    }
    const skus: string[] = [];
    for (const value of body.skus) {
      const sku = parseSellerSku(value);
      if (!sku) return invalid("SKU 清單包含空白或無效內容。");
      if (!skus.includes(sku)) skus.push(sku);
    }
    if (!skus.length || skus.length > 20) {
      return invalid("一次可查詢 1 到 20 個不重複 SKU。");
    }
    try {
      return json(await searchListingsBySku({ marketplaceId, sellerSkus: skus }));
    } catch (error) {
      return apiError(error, "批次查詢 SKU 時發生未預期的錯誤。");
    }
  }

  private contentInput(request: ApiRequest):
    | {
        marketplaceId: MarketplaceId;
        sellerSku: string;
        title: string;
        expectedTitle: string;
        itemHighlight: string;
        expectedItemHighlight: string;
        bulletPoints: string[];
        expectedBulletPoints: string[];
        productDescription: string;
        expectedProductDescription: string;
        ingredients: string;
        expectedIngredients: string;
        idempotencyKey: string;
      }
    | ApiResponse {
    const body = bodyRecord(request);
    if (!body) return invalid("商品內容請求必須使用 JSON。", 415, "UNSUPPORTED_MEDIA_TYPE");
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const title = parseText(body.title, 2_000);
    const expectedTitle = parseText(body.expectedTitle, 2_000);
    const itemHighlight = parseText(body.itemHighlight, 2_000);
    const expectedItemHighlight = parseText(body.expectedItemHighlight, 2_000);
    const bulletPoints = parseBullets(body.bulletPoints);
    const expectedBulletPoints = parseBullets(body.expectedBulletPoints);
    const productDescription = parseText(body.productDescription, 50_000);
    const expectedProductDescription = parseText(
      body.expectedProductDescription,
      50_000,
    );
    const ingredients = parseText(body.ingredients, 20_000);
    const expectedIngredients = parseText(body.expectedIngredients, 20_000);
    if (
      !marketplaceId ||
      !sellerSku ||
      title === null ||
      expectedTitle === null ||
      itemHighlight === null ||
      expectedItemHighlight === null ||
      bulletPoints === null ||
      expectedBulletPoints === null ||
      productDescription === null ||
      expectedProductDescription === null ||
      ingredients === null ||
      expectedIngredients === null
    ) {
      return invalid(
        "請提供有效的站點、SKU、產品名稱、產品亮點、最多五個產品要點、產品敘述與成分。",
      );
    }
    return {
      marketplaceId,
      sellerSku,
      title,
      expectedTitle,
      itemHighlight,
      expectedItemHighlight,
      bulletPoints,
      expectedBulletPoints,
      productDescription,
      expectedProductDescription,
      ingredients,
      expectedIngredients,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
    };
  }

  private async listingContent(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    try {
      const snapshot = await getListingContent(identity);
      await this.reconcileContentWrites(snapshot);
      return json(snapshot);
    } catch (error) {
      return apiError(error, "查詢商品內容時發生未預期的錯誤。");
    }
  }

  private async previewContent(request: ApiRequest): Promise<ApiResponse> {
    const input = this.contentInput(request);
    if ("status" in input) return input;
    try {
      const result = await previewListingContentUpdate(input);
      const scoped = await this.scopedFingerprint(
        input.marketplaceId,
        this.contentFingerprint(input),
      );
      this.issuePreview(request.path, input.idempotencyKey, scoped.fingerprint);
      return json(result);
    } catch (error) {
      return apiError(error, "商品內容預檢時發生未預期的錯誤。");
    }
  }

  private async commitContent(request: ApiRequest): Promise<ApiResponse> {
    const input = this.contentInput(request);
    if ("status" in input) return input;
    const key = idempotencyKey(input.idempotencyKey);
    if (!key) return invalid("這次預檢已失效，請重新預檢。");
    const reservationOwner = randomUUID();
    const reservationError = this.reserveListingAttributeWrites(
      input.marketplaceId,
      [input.sellerSku],
      reservationOwner,
    );
    if (reservationError) return reservationError;
    try {
      const scoped = await this.scopedFingerprint(
        input.marketplaceId,
        this.contentFingerprint(input),
      );
      const fingerprint = scoped.fingerprint;
      const changedFields = [
        input.title !== input.expectedTitle ? "產品名稱" : null,
        input.itemHighlight !== input.expectedItemHighlight ? "產品亮點" : null,
        JSON.stringify(input.bulletPoints) !== JSON.stringify(input.expectedBulletPoints)
          ? "產品要點"
          : null,
        input.productDescription !== input.expectedProductDescription
          ? "產品敘述"
          : null,
        input.ingredients !== input.expectedIngredients ? "成分" : null,
      ].filter(Boolean).join("、");
      const ticketError = await this.approveReservedPreview(
        request.path,
        key,
        fingerprint,
        `確認文案｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜${changedFields}｜驗證碼 ${fingerprint.slice(0, 12)}`,
      );
      if (ticketError) return ticketError;
      try {
        const result = await this.store.runIdempotentOperation({
          idempotencyKey: key,
          operationType: "content",
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          accountScope: scoped.accountScope,
          fingerprint,
          execute: ({ recordAccepted }) => commitWithCanonicalReadback({
            commit: () => updateListingContent(input),
            onAccepted: recordAccepted,
            read: () => getListingContent(input),
            decide: contentReadbackDecision,
          }),
        });
        return json(result);
      } catch (error) {
        return apiError(error, "送出商品內容時發生未預期的錯誤。");
      }
    } finally {
      this.releaseListingAttributeWrites(
        input.marketplaceId,
        [input.sellerSku],
        reservationOwner,
      );
    }
  }

  private contentFingerprint(input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
    title: string;
    expectedTitle: string;
    itemHighlight: string;
    expectedItemHighlight: string;
    bulletPoints: string[];
    expectedBulletPoints: string[];
    productDescription: string;
    expectedProductDescription: string;
    ingredients: string;
    expectedIngredients: string;
  }): string {
    return stableFingerprint([
      input.marketplaceId,
      input.sellerSku,
      input.expectedTitle,
      input.expectedItemHighlight,
      input.expectedBulletPoints,
      input.expectedProductDescription,
      input.expectedIngredients,
      input.title,
      input.itemHighlight,
      input.bulletPoints,
      input.productDescription,
      input.ingredients,
    ]);
  }

  private contentBatchPreviewPayload(plan: ContentBatchPlan) {
    return {
      previewId: plan.previewId,
      exportId: plan.exportId,
      marketplaceId: plan.marketplaceId,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      changes: plan.changes.map((change) => ({
        sellerSku: change.input.sellerSku,
        changedFields: change.validation.changedFields,
        previous: change.validation.previous,
        requested: change.validation.requested,
        issues: change.validation.issues,
      })),
      notice:
        `已逐 SKU 完成 Amazon Validation Preview；${plan.changes.length.toLocaleString()} 個 SKU 尚未寫入。`,
    };
  }

  private async previewContentWorkbookImport(
    request: ApiRequest,
  ): Promise<ApiResponse> {
    if (request.body?.kind !== "multipart") {
      return invalid(
        "文案 Excel 預檢必須使用單一 .xlsx 檔案表單。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(request.body.fields.marketplaceId);
    const key = idempotencyKey(request.body.fields.idempotencyKey);
    if (!marketplaceId || !key) {
      return invalid("Excel 預檢缺少有效站點或批次確認碼。");
    }
    const file = request.body.file;
    try {
      const parsed = parseContentAuditWorkbook({
        bytes: file.bytes,
        fileName: file.name,
        mediaType: file.type,
      });
      if (parsed.metadata.marketplaceId !== marketplaceId) {
        return invalid(
          "Excel 所屬站點與目前選擇的 Amazon 站點不同，已停止預檢。",
          409,
          "MARKETPLACE_CHANGED",
        );
      }
      this.pruneContentBatchPlans();
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[marketplaceId].region,
      );
      const mode = usesDemoMode(marketplaceId) ? "demo" : "live";
      const lookup = await this.store.getContentAuditSnapshotEvidence({
        exportId: parsed.metadata.exportId,
        marketplaceId,
        accountScope,
        mode,
      });
      if (lookup.status === "account-scope-changed") {
        return invalid(
          "Amazon 帳號範圍已改變，舊 Excel 不可用於更新。",
          409,
          "ACCOUNT_SCOPE_CHANGED",
        );
      }
      if (lookup.status === "marketplace-changed") {
        return invalid(
          "Excel 掃描快照所屬站點已改變，請重新執行全站健檢。",
          409,
          "MARKETPLACE_CHANGED",
        );
      }
      if (lookup.status === "mode-changed") {
        return invalid(
          "App 展示／真實模式已改變，舊 Excel 不可用於更新。",
          409,
          "REPORT_MODE_CHANGED",
        );
      }
      if (lookup.status !== "available") {
        return invalid(
          "這份文案 Excel 的掃描快照已過期，請重新執行全站健檢。",
          410,
          "SNAPSHOT_EXPIRED",
        );
      }
      const stored = lookup.evidence;
      if (stored.fetchedAt !== parsed.metadata.fetchedAt) {
        return invalid(
          "Excel 的掃描時間已被修改或與本機快照不符。",
          409,
          "WORKBOOK_TAMPERED",
        );
      }

      const rowDigests = new Set(stored.rowDigests);
      const inputRows: UpdateListingContentInput[] = [];
      let legacyRecoveredRows = 0;
      let legacyCandidateWork = 0;
      let legacyHashWork = 0;
      let legacyCandidateBytes = 0;
      for (const row of parsed.rows) {
        const digest = (
          values: ParsedContentAuditValues,
          readStatus: "complete" | "incomplete",
        ) =>
          contentAuditSnapshotRowDigest({
            accountScope,
            marketplaceId,
            mode,
            exportId: parsed.metadata.exportId,
            fetchedAt: parsed.metadata.fetchedAt,
            sellerSku: row.sellerSku,
            asin: row.asin,
            productType: row.productType,
            variationFamilyKey: row.variationFamilyKey,
            values,
            readStatus,
          });
        const sourceMatches: Array<{
          readStatus: "complete" | "incomplete";
          values: ParsedContentAuditValues;
        }> = [];
        const seenCandidateMatches = new Set<string>();
        const collectMatches = (candidates: readonly ParsedContentAuditValues[]) => {
          for (const values of candidates) {
            for (const readStatus of ["complete", "incomplete"] as const) {
              if (!rowDigests.has(digest(values, readStatus))) continue;
              const matchKey = JSON.stringify([readStatus, values]);
              if (seenCandidateMatches.has(matchKey)) continue;
              seenCandidateMatches.add(matchKey);
              sourceMatches.push({ readStatus, values });
            }
          }
        };
        // The common path is exact and does no compatibility expansion. This
        // also prevents a large unmodified workbook from consuming legacy work.
        collectMatches([row.original]);
        if (sourceMatches.length === 0) {
          for (const values of legacyContentAuditSourceCandidates(row.original)) {
            legacyCandidateWork += 1;
            legacyHashWork += 2;
            legacyCandidateBytes += Buffer.byteLength(
              JSON.stringify(values),
              "utf8",
            );
            if (
              legacyCandidateWork > CONTENT_AUDIT_LEGACY_MAX_CANDIDATE_WORK ||
              legacyHashWork > CONTENT_AUDIT_LEGACY_MAX_HASH_WORK ||
              legacyCandidateBytes > CONTENT_AUDIT_LEGACY_MAX_CANDIDATE_BYTES
            ) {
              return invalid(
                "舊版 Excel 相容核對超過安全上限；請重新執行全站健檢並匯出新檔。",
                409,
                "WORKBOOK_REEXPORT_REQUIRED",
              );
            }
            collectMatches([values]);
          }
        }
        if (sourceMatches.length !== 1) {
          return invalid(
            `SKU ${row.sellerSku} 的識別欄、變體分類或原始文案已被修改；已停止整批預檢。`,
            409,
            "WORKBOOK_TAMPERED",
          );
        }
        const [{ readStatus: sourceReadStatus, values: sourceOriginal }] =
          sourceMatches;
        const recoveredLegacySource = !sameContentAuditValues(
          row.original,
          sourceOriginal,
        );
        if (recoveredLegacySource) {
          legacyRecoveredRows += 1;
          if (legacyRecoveredRows > CONTENT_AUDIT_LEGACY_MAX_RECOVERED_ROWS) {
            return invalid(
              "這份舊版 Excel 有過多列需要相容復原；請重新執行全站健檢並匯出新檔。",
              409,
              "WORKBOOK_REEXPORT_REQUIRED",
            );
          }
        }
        if (
          recoveredLegacySource &&
          contentAuditLegacyRecoveredFieldWasEdited({
            parsedOriginal: row.original,
            recoveredOriginal: sourceOriginal,
            proposed: row.proposed,
          })
        ) {
          return invalid(
            `SKU ${row.sellerSku} 的舊版 Excel 換行字元欄位同時被編輯；無法唯一復原原文，請重新匯出 Excel 後再修改。`,
            409,
            "WORKBOOK_REEXPORT_REQUIRED",
          );
        }
        const proposed = contentAuditProposedWithRecoveredSource({
          parsedOriginal: row.original,
          recoveredOriginal: sourceOriginal,
          proposed: row.proposed,
        });
        if (sameContentAuditValues(sourceOriginal, proposed)) continue;
        if (sourceReadStatus !== "complete") {
          return invalid(
            `SKU ${row.sellerSku} 的 Amazon 文案讀取未完成，不可由 Excel 回寫。`,
            422,
            "CONTENT_READ_INCOMPLETE",
          );
        }
        const title = parseText(proposed.title, 2_000);
        const expectedTitle = parseText(sourceOriginal.title, 2_000);
        const itemHighlight = parseText(proposed.itemHighlight, 2_000);
        const expectedItemHighlight = parseText(sourceOriginal.itemHighlight, 2_000);
        const bulletPoints = parseBullets(proposed.bulletPoints);
        const expectedBulletPoints = parseBullets(sourceOriginal.bulletPoints);
        const productDescription = parseText(proposed.productDescription, 50_000);
        const expectedProductDescription = parseText(
          sourceOriginal.productDescription,
          50_000,
        );
        const ingredients = parseText(proposed.ingredients, 20_000);
        const expectedIngredients = parseText(sourceOriginal.ingredients, 20_000);
        if (
          title === null ||
          expectedTitle === null ||
          itemHighlight === null ||
          expectedItemHighlight === null ||
          bulletPoints === null ||
          expectedBulletPoints === null ||
          productDescription === null ||
          expectedProductDescription === null ||
          ingredients === null ||
          expectedIngredients === null
        ) {
          return invalid(
            `SKU ${row.sellerSku} 的更新文案含有不支援的控制字元或超過本機安全長度。`,
            422,
            "CONTENT_INVALID",
          );
        }
        inputRows.push({
          marketplaceId,
          sellerSku: row.sellerSku,
          title,
          expectedTitle,
          itemHighlight,
          expectedItemHighlight,
          bulletPoints,
          expectedBulletPoints,
          productDescription,
          expectedProductDescription,
          ingredients,
          expectedIngredients,
        });
      }
      if (!inputRows.length) {
        return invalid(
          "Excel 完整性核對通過；更新欄位與原始值相同，沒有需要預檢的變更。請只在「更新…」欄位填入新文案後再試。",
          422,
          "CONTENT_UNCHANGED",
        );
      }
      if (inputRows.length > CONTENT_BATCH_MAX_CHANGED_SKUS) {
        return invalid(
          `一次最多更新 ${CONTENT_BATCH_MAX_CHANGED_SKUS} 個 SKU；請先保留本批要更新的列。`,
          413,
          "CONTENT_BATCH_TOO_LARGE",
        );
      }

      const changes: ContentBatchChange[] = [];
      const validationErrors: Array<{
        sellerSku: string;
        code: string;
        message: string;
        requestId: string | null;
      }> = [];
      for (const input of inputRows) {
        try {
          const validation = await previewListingContentUpdate(input);
          const fingerprint = stableFingerprint([
            accountScope,
            this.contentFingerprint(input),
          ]);
          changes.push({
            input,
            fingerprint,
            ledgerKey: `content-batch-${stableFingerprint([
              key,
              input.sellerSku,
              fingerprint,
            ]).slice(0, 56)}`,
            validation,
          });
        } catch (error) {
          const publicError = error instanceof SpApiError
            ? publicSpApiError(error, "Amazon 預檢失敗。")
            : null;
          validationErrors.push({
            sellerSku: input.sellerSku,
            code: publicError?.code ?? "INTERNAL_ERROR",
            message: publicError?.message ?? "Amazon 預檢失敗。",
            requestId: publicError?.requestId ?? null,
          });
        }
      }
      if (validationErrors.length) {
        return json(
          {
            code: "CONTENT_BATCH_VALIDATION_FAILED",
            message:
              `${validationErrors.length.toLocaleString()} 個 SKU 未通過預檢；整批仍為零寫入。`,
            rows: validationErrors,
            writeCount: 0,
          },
          422,
        );
      }

      const batchFingerprint = stableFingerprint([
        marketplaceId,
        parsed.metadata.exportId,
        key,
        changes.map((change) => [
          change.input.sellerSku,
          change.fingerprint,
          change.validation.changedFields,
        ]),
      ]);
      const conflictingPlan = [...this.contentBatchPlans.values()].find(
        (plan) =>
          plan.accountScope === accountScope &&
          plan.marketplaceId === marketplaceId &&
          plan.idempotencyKey === key &&
          plan.state !== "completed",
      );
      if (conflictingPlan) {
        if (conflictingPlan.fingerprint === batchFingerprint) {
          return json(this.contentBatchPreviewPayload(conflictingPlan));
        }
        return invalid(
          "這個批次確認碼已用於另一份 Excel。",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
      }
      const plan: ContentBatchPlan = {
        previewId: randomUUID(),
        exportId: parsed.metadata.exportId,
        marketplaceId,
        accountScope,
        idempotencyKey: key,
        fingerprint: batchFingerprint,
        changes,
        expiresAt: Date.now() + CONTENT_BATCH_PREVIEW_TTL_MS,
        state: "ready",
        result: null,
      };
      this.contentBatchPlans.set(plan.previewId, plan);
      return json(this.contentBatchPreviewPayload(plan));
    } catch (error) {
      if (error instanceof ContentAuditWorkbookError) {
        return json({ code: error.code, message: error.message }, error.status);
      }
      return apiError(error, "文案 Excel 預檢時發生未預期的錯誤。");
    }
  }

  private async commitContentWorkbookImport(
    request: ApiRequest,
  ): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "文案 Excel 更新必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const previewId = this.reportIdentifier(body.previewId);
    const key = idempotencyKey(body.idempotencyKey);
    if (!marketplaceId || !previewId || !key) {
      return invalid("Excel 更新缺少有效的站點、previewId 或批次確認碼。");
    }
    this.pruneContentBatchPlans();
    const plan = this.contentBatchPlans.get(previewId);
    if (!plan || plan.expiresAt <= Date.now()) {
      this.contentBatchPlans.delete(previewId);
      return invalid(
        "Excel 批次預檢已過期，請重新上傳並預檢。",
        410,
        "PREVIEW_EXPIRED",
      );
    }
    if (
      plan.marketplaceId !== marketplaceId ||
      plan.idempotencyKey !== key
    ) {
      return invalid(
        "Excel 批次預檢與目前的站點或確認碼不一致。",
        409,
        "PREVIEW_CHANGED",
      );
    }
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    if (plan.accountScope !== accountScope) {
      this.contentBatchPlans.delete(previewId);
      return invalid(
        "Amazon 帳號範圍已改變，舊預檢不可送出。",
        409,
        "ACCOUNT_SCOPE_CHANGED",
      );
    }
    if (plan.state === "completed" && plan.result) return json(plan.result);
    if (plan.state === "committing") {
      return invalid(
        "這份 Excel 批次正在處理，已阻止重複送出。",
        409,
        "OPERATION_IN_PROGRESS",
      );
    }

    const ownerToken = randomUUID();
    const sellerSkus = plan.changes.map((change) => change.input.sellerSku);
    const reservationError = this.reserveListingAttributeWrites(
      marketplaceId,
      sellerSkus,
      ownerToken,
    );
    if (reservationError) return reservationError;
    plan.state = "committing";
    try {
      await this.store.assertIdempotentOperationsAvailable(
        plan.changes.map((change) => ({
          idempotencyKey: change.ledgerKey,
          operationType: "content" as const,
          marketplaceId,
          sellerSku: change.input.sellerSku,
          accountScope,
          fingerprint: change.fingerprint,
        })),
      );

      try {
        for (const change of plan.changes) {
          change.validation = await previewListingContentUpdate(change.input);
        }
      } catch (error) {
        this.contentBatchPlans.delete(previewId);
        const response = apiError(
          error,
          "整批送出前的 Amazon 重新讀取或 Validation Preview 失敗。",
        );
        if (response.body.kind === "json" && isPlainRecord(response.body.value)) {
          return json({
            ...response.body.value,
            message:
              `${String(response.body.value.message ?? "整批重新預檢失敗。")} Amazon 寫入數為 0，請重新上傳 Excel。`,
            writeCount: 0,
          }, response.status, response.headers);
        }
        return response;
      }

      try {
        const shownSkus = sellerSkus.slice(0, 5).join("、");
        const remaining = Math.max(0, sellerSkus.length - 5);
        await this.approveWrite(
          `確認 Excel 批次文案｜${MARKETPLACE_CODES[marketplaceId]}｜${sellerSkus.length} 個 SKU｜${shownSkus}${remaining ? ` 等另 ${remaining} 個` : ""}｜驗證碼 ${plan.fingerprint.slice(0, 12)}`,
        );
      } catch {
        plan.state = "ready";
        return invalid(
          "操作已取消；Amazon 沒有收到任何文案變更。",
          409,
          "ACTION_CANCELLED",
        );
      }

      const rows: ContentBatchRowResult[] = plan.changes.map((change) => ({
        sellerSku: change.input.sellerSku,
        state: "not-started",
        result: null,
        error: null,
      }));
      let status: ContentBatchCommitResult["status"] = "COMPLETED";
      for (let index = 0; index < plan.changes.length; index += 1) {
        const change = plan.changes[index]!;
        try {
          const result = await this.store.runIdempotentOperation<
            ListingContentUpdateResult
          >({
            idempotencyKey: change.ledgerKey,
            operationType: "content",
            marketplaceId,
            sellerSku: change.input.sellerSku,
            accountScope,
            fingerprint: change.fingerprint,
            execute: async ({ recordAccepted }) => {
              try {
                return await commitWithCanonicalReadback({
                  commit: () => updateListingContent(change.input),
                  onAccepted: recordAccepted,
                  read: () => getListingContent(change.input),
                  decide: contentReadbackDecision,
                });
              } catch (error) {
                if (
                  error instanceof SpApiError &&
                  !(error instanceof SpApiPreCommitError) &&
                  [401, 429].includes(error.status) &&
                  error.code !== "UPDATE_STATUS_UNKNOWN"
                ) {
                  throw new SpApiError(
                    `${error.message} Amazon 可能已收到這筆 PATCH；系統已禁止重送，請先回查。`,
                    {
                      status: error.status,
                      code: "UPDATE_STATUS_UNKNOWN",
                      requestId: error.requestId,
                      retryAfter: error.retryAfter,
                      issues: error.issues,
                      operation: error.operation,
                      upstreamCode: error.upstreamCode,
                    },
                  );
                }
                throw error;
              }
            },
          });
          rows[index] = {
            sellerSku: change.input.sellerSku,
            state: result.mode === "demo" ? "simulated" : "verified",
            result,
            error: null,
          };
        } catch (error) {
          const unknown =
            !(error instanceof SpApiPreCommitError) &&
            (!(error instanceof SpApiError) ||
              error.code === "UPDATE_STATUS_UNKNOWN" ||
              error.status >= 500 ||
              [401, 429].includes(error.status));
          const publicError = error instanceof SpApiError
            ? publicSpApiError(
                error,
                unknown
                  ? "Amazon 寫入結果尚未確認。"
                  : "Amazon 拒絕這筆商品內容變更。",
              )
            : null;
          rows[index] = {
            sellerSku: change.input.sellerSku,
            state: unknown ? "unknown" : "rejected",
            result: null,
            error: {
              code: publicError?.code ?? "UPDATE_STATUS_UNKNOWN",
              message: publicError?.message ?? "Amazon 寫入結果尚未確認。",
              requestId: publicError?.requestId ?? null,
            },
          };
          status = unknown ? "STOPPED_UNKNOWN" : "STOPPED_REJECTED";
          break;
        }
      }
      const completedCount = rows.filter((row) =>
        row.state === "verified" || row.state === "simulated").length;
      const result: ContentBatchCommitResult = {
        previewId,
        marketplaceId,
        status,
        rows,
        completedAt: new Date().toISOString(),
        notice: status === "COMPLETED"
          ? `已完成 ${completedCount.toLocaleString()} 個 SKU；每筆皆經正式回讀或展示模擬核對。`
          : status === "STOPPED_UNKNOWN"
            ? `已完成 ${completedCount.toLocaleString()} 個 SKU；遇到一筆結果不明後已停止，後續 SKU 沒有送出。請先回查 Amazon，勿重送。`
            : `已完成 ${completedCount.toLocaleString()} 個 SKU；遇到一筆已知拒絕後已停止，後續 SKU 沒有送出。`,
      };
      plan.result = result;
      plan.state = "completed";
      return json(result);
    } catch (error) {
      if (plan.state === "committing") plan.state = "ready";
      return apiError(error, "Excel 批次文案更新時發生未預期的錯誤。");
    } finally {
      this.releaseListingAttributeWrites(marketplaceId, sellerSkus, ownerToken);
    }
  }

  private imageInput(request: ApiRequest):
    | {
        marketplaceId: MarketplaceId;
        sellerSku: string;
        expectedUrls: Array<string | null>;
        urls: Array<string | null>;
        confirmationSku: string;
        idempotencyKey: string;
      }
    | ApiResponse {
    const body = bodyRecord(request);
    if (!body) return invalid("商品圖片請求必須使用 JSON。", 415, "UNSUPPORTED_MEDIA_TYPE");
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const expectedUrls = parseUrls(body.expectedUrls);
    const urls = parseUrls(body.urls);
    if (!marketplaceId || !sellerSku || !expectedUrls || !urls) {
      return invalid("請提供有效的站點、SKU 與最多九個圖片 URL。");
    }
    const populated = urls.filter((value): value is string => Boolean(value));
    if (new Set(populated).size !== populated.length) {
      return invalid("同一個圖片網址不能重複放在不同位置。", 422, "DUPLICATE_IMAGE_URL");
    }
    return {
      marketplaceId,
      sellerSku,
      expectedUrls,
      urls,
      confirmationSku: typeof body.confirmationSku === "string" ? body.confirmationSku : "",
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
    };
  }

  private async listingImages(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    try {
      const snapshot = await getListingImages(identity);
      await this.reconcileImageWrites(snapshot);
      return json(snapshot);
    } catch (error) {
      return apiError(error, "查詢商品圖片時發生未預期的錯誤。");
    }
  }

  private async previewImages(request: ApiRequest): Promise<ApiResponse> {
    const input = this.imageInput(request);
    if ("status" in input) return input;
    try {
      const result = await previewListingImageUpdate(input);
      const scoped = await this.scopedFingerprint(
        input.marketplaceId,
        this.imageFingerprint(input),
      );
      this.issuePreview(request.path, input.idempotencyKey, scoped.fingerprint);
      return json(result);
    } catch (error) {
      return apiError(error, "商品圖片預檢時發生未預期的錯誤。");
    }
  }

  private async commitImages(request: ApiRequest): Promise<ApiResponse> {
    const input = this.imageInput(request);
    if ("status" in input) return input;
    const key = idempotencyKey(input.idempotencyKey);
    if (!key) return invalid("這次預檢已失效，請重新預檢。");
    if (input.confirmationSku !== input.sellerSku) {
      return invalid("送出圖片前，請重新輸入完整 SKU。", 400, "CONFIRMATION_REQUIRED");
    }
    const reservationOwner = randomUUID();
    const reservationError = this.reserveListingAttributeWrites(
      input.marketplaceId,
      [input.sellerSku],
      reservationOwner,
    );
    if (reservationError) return reservationError;
    try {
      const scoped = await this.scopedFingerprint(
        input.marketplaceId,
        this.imageFingerprint(input),
      );
      const fingerprint = scoped.fingerprint;
      const changedSlots = input.urls
        .map((value, index) => (value !== input.expectedUrls[index] ? index + 1 : null))
        .filter((value): value is number => value !== null);
      const ticketError = await this.approveReservedPreview(
        request.path,
        key,
        fingerprint,
        `確認圖片｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜位置 ${changedSlots.join("、")}｜驗證碼 ${fingerprint.slice(0, 12)}`,
      );
      if (ticketError) return ticketError;
      try {
        const result = await this.store.runIdempotentOperation({
          idempotencyKey: key,
          operationType: "images",
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          accountScope: scoped.accountScope,
          fingerprint,
          execute: ({ recordAccepted }) => commitWithCanonicalReadback({
            commit: () => updateListingImages(input),
            onAccepted: recordAccepted,
            read: () => getListingImages(input),
            decide: imageReadbackDecision,
          }),
        });
        return json(result);
      } catch (error) {
        return apiError(error, "送出商品圖片時發生未預期的錯誤。");
      }
    } finally {
      this.releaseListingAttributeWrites(
        input.marketplaceId,
        [input.sellerSku],
        reservationOwner,
      );
    }
  }

  private imageFingerprint(input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
    expectedUrls: Array<string | null>;
    urls: Array<string | null>;
  }): string {
    return stableFingerprint([
      input.marketplaceId,
      input.sellerSku,
      input.expectedUrls,
      input.urls,
    ]);
  }

  private salePriceInput(request: ApiRequest):
    | (UpdateListingSalePriceInput & {
        confirmationSku: string;
        idempotencyKey: string;
      })
    | ApiResponse {
    const body = bodyRecord(request);
    if (!body) return invalid("折扣請求必須使用 JSON。", 415, "UNSUPPORTED_MEDIA_TYPE");
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const action = body.action === "set" || body.action === "cancel" ? body.action : null;
    if (!marketplaceId || !sellerSku || !action) {
      return invalid("請提供有效的站點、SKU 與折扣操作。");
    }
    const currency = MARKETPLACES[marketplaceId].currency;
    const expectedPrice = parsePrice(body.expectedPrice, currency);
    const expectedDiscountedPrice = optionalPrice(body.expectedDiscountedPrice, currency);
    const expectedStartAt = optionalDate(body.expectedStartAt);
    const expectedEndAt = optionalDate(body.expectedEndAt);
    const salePrice = optionalPrice(body.salePrice, currency);
    const startAt = optionalDate(body.startAt);
    const endAt = optionalDate(body.endAt);
    if (
      expectedPrice === null ||
      expectedDiscountedPrice === undefined ||
      expectedStartAt === undefined ||
      expectedEndAt === undefined ||
      salePrice === undefined ||
      startAt === undefined ||
      endAt === undefined
    ) {
      return invalid(
        currency === "JPY"
          ? "請確認折扣金額為整數，且日期格式正確。"
          : "請確認折扣金額最多兩位小數，且日期格式正確。",
      );
    }
    if (action === "set" && (salePrice === null || !startAt || !endAt)) {
      return invalid("建立折扣需要折扣價、開始日與結束日。");
    }
    return {
      marketplaceId,
      sellerSku,
      action,
      expectedPrice,
      expectedDiscountedPrice,
      expectedStartAt,
      expectedEndAt,
      salePrice: action === "set" ? salePrice : null,
      startAt: action === "set" ? startAt : null,
      endAt: action === "set" ? endAt : null,
      confirmationSku: typeof body.confirmationSku === "string" ? body.confirmationSku : "",
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
    };
  }

  private async previewSalePrice(request: ApiRequest): Promise<ApiResponse> {
    const input = this.salePriceInput(request);
    if ("status" in input) return input;
    try {
      const result = await previewListingSalePriceUpdate(input);
      const scoped = await this.scopedFingerprint(
        input.marketplaceId,
        this.saleFingerprint(input),
      );
      this.issuePreview(request.path, input.idempotencyKey, scoped.fingerprint);
      return json(result);
    } catch (error) {
      return apiError(error, "折扣預檢時發生未預期的錯誤。");
    }
  }

  private async commitSalePrice(request: ApiRequest): Promise<ApiResponse> {
    const input = this.salePriceInput(request);
    if ("status" in input) return input;
    const key = idempotencyKey(input.idempotencyKey);
    if (!key) return invalid("這次折扣的確認資訊已失效，請重新預檢。");
    const discountRatio =
      input.action === "set" && input.salePrice !== null
        ? (input.expectedPrice - input.salePrice) / input.expectedPrice
        : 0;
    if (
      (input.action === "cancel" || discountRatio >= 0.2) &&
      input.confirmationSku !== input.sellerSku
    ) {
      return invalid(
        input.action === "cancel"
          ? "取消折扣前，請重新輸入完整 SKU。"
          : "折扣達 20%，請重新輸入完整 SKU 才能送出。",
        400,
        "CONFIRMATION_REQUIRED",
      );
    }
    const scoped = await this.scopedFingerprint(
      input.marketplaceId,
      this.saleFingerprint(input),
    );
    const fingerprint = scoped.fingerprint;
    const ticketError = await this.approveReservedPreview(
      request.path,
      key,
      fingerprint,
      input.action === "cancel"
        ? `確認取消折扣｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜目前 ${input.expectedDiscountedPrice ?? "—"}`
        : `確認折扣｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜${input.expectedPrice} → ${input.salePrice} ${MARKETPLACES[input.marketplaceId].currency}｜${input.startAt}～${input.endAt}`,
    );
    if (ticketError) return ticketError;
    try {
      const result = await this.store.runIdempotentOperation({
        idempotencyKey: key,
        operationType: "sale_price",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        accountScope: scoped.accountScope,
        fingerprint,
        execute: ({ recordAccepted }) => commitWithCanonicalReadback({
          commit: () => updateListingSalePrice(input),
          onAccepted: recordAccepted,
          read: () => getListingPrice(input),
          decide: salePriceReadbackDecision,
        }),
      });
      return json(result);
    } catch (error) {
      return apiError(error, "送出折扣更新時發生未預期的錯誤。");
    }
  }

  private saleFingerprint(input: UpdateListingSalePriceInput): string {
    return stableFingerprint([
      input.marketplaceId,
      input.sellerSku,
      input.action,
      input.expectedPrice,
      input.expectedDiscountedPrice,
      input.expectedStartAt,
      input.expectedEndAt,
      input.salePrice,
      input.startAt,
      input.endAt,
    ]);
  }

  private async subscribeSave(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    try {
      return json(await getSubscribeAndSaveOffer(identity));
    } catch (error) {
      return apiError(error, "查詢 Subscribe & Save 時發生未預期的錯誤。");
    }
  }

  private pruneSubscriptionAuditSnapshots(now = Date.now()): void {
    for (const [id, entry] of this.subscriptionAuditSnapshots) {
      if (entry.expiresAt <= now) this.subscriptionAuditSnapshots.delete(id);
    }
  }

  private async subscriptionAudit(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const requestedMonths = integer(request.query.months, 6, 1, 23);
    const months = requestedMonths !== null && [6, 12, 23].includes(requestedMonths)
      ? requestedMonths
      : null;
    if (!marketplaceId || months === null) {
      return invalid("請選擇支援的站點；月度歷史只能選最近 6、12 或 23 個完整月份。");
    }
    try {
      const snapshot = await getFbaSubscriptionAudit({ marketplaceId, months });
      const exportId = randomUUID();
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[marketplaceId].region,
      );
      this.pruneSubscriptionAuditSnapshots();
      this.subscriptionAuditSnapshots.set(exportId, {
        marketplaceId,
        accountScope,
        expiresAt: Date.now() + SUBSCRIPTION_AUDIT_SNAPSHOT_TTL_MS,
        snapshot: structuredClone(snapshot),
      });
      return json({
        ...snapshot,
        offers: snapshot.offers.map((offer) => ({
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
      });
    } catch (error) {
      return apiError(error, "載入全站 FBA Subscribe & Save 健檢時發生未預期的錯誤。");
    }
  }

  private async subscriptionAuditExport(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const snapshotId = this.reportIdentifier(
      request.query.exportId ?? request.query.snapshotId,
    );
    if (!marketplaceId || !snapshotId) {
      return invalid("Subscribe & Save 匯出資訊無效，請重新執行健檢。");
    }
    this.pruneSubscriptionAuditSnapshots();
    const stored = this.subscriptionAuditSnapshots.get(snapshotId);
    if (!stored || stored.marketplaceId !== marketplaceId) {
      return invalid(
        "Subscribe & Save 健檢快照已過期或站點不符，請重新同步。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    if (stored.accountScope !== accountScope) {
      this.subscriptionAuditSnapshots.delete(snapshotId);
      return invalid(
        "Amazon 帳號範圍已改變，舊健檢快照不可匯出。",
        409,
        "ACCOUNT_SCOPE_CHANGED",
      );
    }
    const snapshot = stored.snapshot;
    const metricMonths = snapshot.intervals.map((interval) => interval.month);
    if (!metricMonths.length) {
      return invalid("健檢快照缺少官方完整月份，請重新同步。", 409, "SNAPSHOT_INVALID");
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
      const marketplace = MARKETPLACES[marketplaceId];
      const workbook = createSubscriptionAuditWorkbook({
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
      const filename = `amazon-fba-subscribe-save-audit-${marketplace.shortLabel.toLowerCase()}-${snapshot.fetchedAt.slice(0, 10)}.xlsx`;
      return bytes(
        workbook,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        {
          "content-disposition": `attachment; filename="${filename}"`,
          "x-exported-fba-offer-count": String(snapshot.offers.length),
          "x-subscription-audit-months": String(snapshot.requestedMonths),
        },
      );
    } catch (error) {
      return apiError(error, "建立 Subscribe & Save 健檢 Excel 時發生未預期的錯誤。");
    }
  }

  private accountingCapabilities(request: ApiRequest): ApiResponse {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");
    return json({
      marketplaceId,
      fetchedAt: new Date().toISOString(),
      capabilities: PUBLIC_ACCOUNTING_CAPABILITIES.map((capability) => ({
        ...capability,
        roles: [...capability.roles],
        state: accountingCatalogState(capability),
      })),
      notice:
        "這裡只列出 Amazon 公開 SP-API 的 FBA 帳務能力與安全規劃狀態；尚未建立、輪詢或下載報表，也不使用 Seller Central 私有接口。",
    });
  }

  private accountingAccessPlan(request: ApiRequest): ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid("帳務規劃必須使用 JSON。", 400, "INVALID_ACCOUNTING_PLAN");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const capabilityId = parseAccountingCapabilityId(body.capabilityId);
    if (!marketplaceId || !capabilityId) {
      return invalid(
        "請提供有效的站點與公開 API 帳務能力。",
        400,
        "INVALID_ACCOUNTING_PLAN",
      );
    }
    const startPresent = body.dataStartTime !== undefined;
    const endPresent = body.dataEndTime !== undefined;
    const dataStartTime = startPresent
      ? canonicalIsoTimestamp(body.dataStartTime)
      : undefined;
    const dataEndTime = endPresent
      ? canonicalIsoTimestamp(body.dataEndTime)
      : undefined;
    if ((startPresent && !dataStartTime) || (endPresent && !dataEndTime)) {
      return invalid(
        "帳務日期必須是完整、標準的 ISO 時間。",
        400,
        "INVALID_ACCOUNTING_DATE",
      );
    }
    try {
      const plan = buildAccountingAccessPlan({
        capabilityId,
        marketplaceId,
        ...(dataStartTime ? { dataStartTime } : {}),
        ...(dataEndTime ? { dataEndTime } : {}),
      });
      return json({
        capabilityId,
        marketplaceId,
        state: plan.state,
        notice: plan.capability.notice,
        nextStep: accountingPlanNextStep(plan.state),
      });
    } catch (error) {
      if (error instanceof TypeError) {
        return invalid(error.message, 400, "INVALID_ACCOUNTING_PLAN");
      }
      return apiError(error, "建立公開 API 帳務規劃時發生未預期的錯誤。");
    }
  }

  private reportLibrary(request: ApiRequest): ApiResponse {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("文件庫站點無效。");
    return json({
      schemaVersion: 1,
      marketplaceId,
      fetchedAt: new Date().toISOString(),
      officialCatalog: {
        uniqueReportTypeCount: PUBLIC_REPORT_CATALOG.length,
        verifiedAt: "2026-08-09",
        officialPageUpdatedLabel: "Amazon 官方頁面於驗證時標示 Updated 5 days ago",
        source: "https://developer-docs.amazon.com/sp-api/docs/report-type-values",
        changeNotice: "Amazon 官方 report type 清單可能隨時更新；此版本依 2026-08-09 驗證的 109 個唯一類型。",
      },
      currentAppExports: CURRENT_APP_EXPORTS.map((item) => ({ ...item })),
      reports: PUBLIC_REPORT_CATALOG.map((report) => {
        const plan = buildReportAccessPlan({
          marketplaceId,
          reportType: report.reportType,
        });
        return {
          ...report,
          categories: [...report.categories],
          roles: [...report.roles],
          supportedConfiguredMarketplaces:
            report.supportedConfiguredMarketplaces === null
              ? null
              : [...report.supportedConfiguredMarketplaces],
          prerequisites: [...report.prerequisites],
          state: plan.state,
          amazonPublicArtifactAvailable: plan.amazonPublicArtifactAvailable,
          appDownloadImplemented: plan.appDownloadImplemented,
          stateNotice: plan.notice,
        };
      }),
      unavailableDocuments: REPORT_LIBRARY_UNAVAILABLE_DOCUMENTS.map((item) => ({ ...item })),
      reviewAuditCapability: {
        ...REVIEW_AUDIT_CAPABILITY,
        roles: [...REVIEW_AUDIT_CAPABILITY.roles],
        supportedConfiguredMarketplaces: [
          ...REVIEW_AUDIT_CAPABILITY.supportedConfiguredMarketplaces,
        ],
        supportedForMarketplace: customerFeedbackMarketplaceSupported(marketplaceId),
      },
      notice: REPORT_LIBRARY_NOTICE,
    });
  }

  private reportLibraryAccessPlan(request: ApiRequest): ApiResponse {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    const reportType = typeof body?.reportType === "string" &&
      /^[A-Z0-9_]{3,120}$/u.test(body.reportType)
      ? body.reportType
      : null;
    if (!body || !marketplaceId || !reportType) {
      return invalid(
        "請提供有效站點與 Amazon 公開 reportType。",
        400,
        "INVALID_REPORT_PLAN",
      );
    }
    try {
      return json(buildReportAccessPlan({ marketplaceId, reportType }));
    } catch (error) {
      return error instanceof TypeError
        ? invalid(error.message, 400, "INVALID_REPORT_PLAN")
        : apiError(error, "建立文件庫能力規劃時發生未預期的錯誤。");
    }
  }

  private pruneReviewAuditJobs(now = Date.now()): void {
    for (const [jobId, job] of this.reviewAuditJobs) {
      if (job.signal.aborted) {
        this.deleteReviewAuditJob(jobId);
        continue;
      }
      if (job.retainWhileActive || !job.snapshot) continue;
      if (job.expiresAt <= now) this.deleteReviewAuditJob(jobId);
    }
  }

  private deleteReviewAuditJob(jobId: string): void {
    const timer = this.reviewAuditRunnerTimers.get(jobId);
    if (timer) clearTimeout(timer);
    this.reviewAuditRunnerTimers.delete(jobId);
    const job = this.reviewAuditJobs.get(jobId);
    this.reviewAuditJobs.delete(jobId);
    job?.abort();
  }

  private reviewAuditFlight(
    jobId: string,
    job: ReviewAuditJob,
  ): Promise<ApiResponse> {
    let flight = this.reviewAuditPollFlights.get(jobId);
    if (!flight) {
      flight = this.advanceReviewAuditJob(jobId, job, job.signal).finally(() => {
        if (this.reviewAuditPollFlights.get(jobId) === flight) {
          this.reviewAuditPollFlights.delete(jobId);
        }
      });
      this.reviewAuditPollFlights.set(jobId, flight);
    }
    return flight;
  }

  private scheduleReviewAuditRunner(jobId: string, delay = 25): void {
    if (
      this.reviewAuditRunnerTimers.has(jobId) ||
      !this.reviewAuditJobs.has(jobId)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      this.reviewAuditRunnerTimers.delete(jobId);
      void this.runReviewAuditBackground(jobId);
    }, Math.max(0, delay));
    timer.unref?.();
    this.reviewAuditRunnerTimers.set(jobId, timer);
  }

  private async runReviewAuditBackground(jobId: string): Promise<void> {
    this.pruneReviewAuditJobs();
    const job = this.reviewAuditJobs.get(jobId);
    if (!job || job.snapshot) return;
    try {
      const response = await this.reviewAuditFlight(jobId, job);
      if (
        response.status >= 400 ||
        job.snapshot ||
        this.reviewAuditJobs.get(jobId) !== job
      ) {
        return;
      }
      const paceDelay = job.candidates
        ? Math.max(25, job.nextQueryAt - Date.now())
        : 1_150;
      this.scheduleReviewAuditRunner(jobId, paceDelay);
    } catch {
      // A later explicit status read can surface the same fail-closed error.
      // Do not auto-restart reports or retry a failed Customer Feedback call.
    }
  }

  private async runReviewAuditFeedbackRequest(input: {
    mode: ReviewAuditJob["mode"];
    marketplaceId: MarketplaceId;
    candidate: DedupedFbaReviewCandidate;
    signal?: AbortSignal;
  }): Promise<ReviewAuditFetchResult> {
    assertBackgroundActive(input.signal);
    if (input.mode === "demo") {
      return getCustomerFeedbackReviewTopics({
        marketplaceId: input.marketplaceId,
        candidate: input.candidate,
        expectedMode: input.mode,
        signal: input.signal,
      });
    }

    let releaseTurn: () => void = () => {};
    const turn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const previous = this.reviewAuditFeedbackQueue;
    this.reviewAuditFeedbackQueue = previous
      .catch(() => undefined)
      .then(() => turn);
    let dispatched = false;
    try {
      await waitForPromiseWithSignal(previous.catch(() => undefined), input.signal);
      assertBackgroundActive(input.signal);
      await waitMilliseconds(
        this.reviewAuditFeedbackNextStartAt - Date.now(),
        input.signal,
      );
      assertBackgroundActive(input.signal);
      dispatched = true;
      return await getCustomerFeedbackReviewTopics({
        marketplaceId: input.marketplaceId,
        candidate: input.candidate,
        expectedMode: input.mode,
        signal: input.signal,
      });
    } finally {
      // Measure from completion rather than initial dispatch. This remains safe
      // when the gateway performs its single 401 token-refresh retry.
      if (dispatched) {
        this.reviewAuditFeedbackNextStartAt =
          Date.now() + REVIEW_AUDIT_LIVE_REQUEST_INTERVAL_MS;
      }
      releaseTurn();
    }
  }

  private reviewAuditJobReply(jobId: string, job: ReviewAuditJob): ApiResponse {
    const total = job.candidates?.length ?? null;
    const completed = job.nextCandidateIndex;
    const ready = Boolean(job.snapshot);
    return json({
      jobId,
      exportId: ready ? jobId : null,
      mode: job.mode,
      marketplaceId: job.marketplaceId,
      ready,
      status: ready
        ? "DONE"
        : job.candidates
          ? "READING_NON_PARENT_TOPICS"
          : job.listingStatus,
      progress: {
        completed,
        total,
        percent: total === null || total === 0
          ? ready ? 100 : 0
          : Math.round((completed / total) * 100),
      },
      message: ready
        ? "FBA 非 parent ASIN 評論主題健檢已完成。"
        : job.candidates
          ? `正在依 Amazon 官方 1 request/second 限制讀取已驗證的非 parent ASIN 主題（${completed} / ${total}）。`
          : "Amazon 正在準備目前 FBA 商品清單。",
      capabilityNotice:
        "資料每週更新且僅英文；前／後五名使用 Amazon 主題影響值。它不是商品總星等或 1–5 星制；負數是此負向主題對星等下降方向的影響值，不是商品負星等，也不會轉成 0 或絕對值。關閉健檢小視窗後，本機主程序仍會在背景繼續。",
    }, ready ? 200 : 202);
  }

  private reviewAuditModeFence(
    jobId: string,
    job: ReviewAuditJob,
  ): ApiResponse | null {
    const mode = usesDemoMode(job.marketplaceId) ? "demo" : "live";
    if (mode === job.mode) return null;
    this.deleteReviewAuditJob(jobId);
    return invalid(
      "App 展示／真實模式已改變，舊評論健檢不可繼續或匯出。",
      409,
      "REPORT_MODE_CHANGED",
    );
  }

  private async startReviewAudit(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) {
      return invalid("請選擇要健檢評論主題的 Amazon 站點。");
    }
    if (!customerFeedbackMarketplaceSupported(marketplaceId)) {
      return invalid(
        "Amazon Customer Feedback API 僅支援本 App 的 US、JP、UK 與 DE 站；未改用父變體或私有 Seller Central 資料。",
        422,
        "MARKETPLACE_UNSUPPORTED",
      );
    }
    try {
      const [accountScope, status] = await Promise.all([
        this.vault.getAccountScope(MARKETPLACES[marketplaceId].region),
        this.startSharedAllListingsReport(marketplaceId, true),
      ]);
      if (
        status.status !== "IN_QUEUE" &&
        status.status !== "IN_PROGRESS" &&
        status.status !== "DONE"
      ) {
        return invalid("Amazon 未能開始建立 FBA 商品清單。", 422, "REPORT_FAILED");
      }
      const jobId = randomUUID();
      const controller = new AbortController();
      const job: ReviewAuditJob = {
        marketplaceId,
        accountScope,
        expiresAt: Date.now() + REVIEW_AUDIT_JOB_TTL_MS,
        mode: status.mode,
        listingReportId: status.reportId,
        listingDocumentId: status.documentId,
        listingStatus: status.status,
        candidates: null,
        sourceCandidateCount: 0,
        candidateCoverage: null,
        relationshipIncompleteRows: [],
        results: [],
        nextCandidateIndex: 0,
        nextQueryAt: 0,
        snapshot: null,
        signal: controller.signal,
        abort: () => controller.abort(),
        retainWhileActive: false,
      };
      this.pruneReviewAuditJobs();
      this.reviewAuditJobs.set(jobId, job);
      this.scheduleReviewAuditRunner(jobId);
      return this.reviewAuditJobReply(jobId, job);
    } catch (error) {
      return apiError(error, "開始 FBA 評論主題健檢時發生未預期的錯誤。");
    }
  }

  private async reviewAuditStatusOrData(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = this.reportIdentifier(request.query.jobId);
    if (!marketplaceId || !jobId) {
      return invalid("評論主題健檢工作資訊無效。");
    }
    this.pruneReviewAuditJobs();
    const job = this.reviewAuditJobs.get(jobId);
    if (!job || job.marketplaceId !== marketplaceId) {
      return invalid(
        "評論主題健檢已過期或站點不符，請重新掃描。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    const modeError = this.reviewAuditModeFence(jobId, job);
    if (modeError) return modeError;
    return this.reviewAuditFlight(jobId, job);
  }

  private async advanceReviewAuditJob(
    jobId: string,
    job: ReviewAuditJob,
    signal?: AbortSignal,
  ): Promise<ApiResponse> {
    assertBackgroundActive(signal);
    const marketplaceId = job.marketplaceId;
    const initialModeError = this.reviewAuditModeFence(jobId, job);
    if (initialModeError) return initialModeError;
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    assertBackgroundActive(signal);
    if (accountScope !== job.accountScope) {
      this.deleteReviewAuditJob(jobId);
      return invalid(
        "Amazon 帳號範圍已改變，舊評論健檢不可繼續。",
        409,
        "ACCOUNT_SCOPE_CHANGED",
      );
    }
    const accountModeError = this.reviewAuditModeFence(jobId, job);
    if (accountModeError) return accountModeError;
    if (job.snapshot) {
      return json({ ...structuredClone(job.snapshot), exportId: jobId });
    }
    try {
      if (job.listingStatus !== "DONE" || !job.listingDocumentId) {
        const status = await this.getSharedAllListingsReportStatus({
          marketplaceId,
          reportId: job.listingReportId,
          signal,
        });
        assertBackgroundActive(signal);
        if (
          status.status !== "IN_QUEUE" &&
          status.status !== "IN_PROGRESS" &&
          status.status !== "DONE"
        ) {
          return invalid("Amazon 未能產生 FBA 商品清單。", 422, "REPORT_FAILED");
        }
        job.listingStatus = status.status;
        job.listingDocumentId = status.documentId;
        const listingModeError = this.reviewAuditModeFence(jobId, job);
        if (listingModeError) return listingModeError;
        if (!status.ready || !status.documentId) {
          return this.reviewAuditJobReply(jobId, job);
        }
      }
      if (!job.candidates) {
        const seeds = await this.fbaCatalogReports.read({
          view: "seeds",
          marketplaceId,
          reportId: job.listingReportId,
          documentId: job.listingDocumentId!,
          signal,
        });
        const candidateSnapshot = await this.reviewAuditCandidates({
          marketplaceId,
          mode: job.mode,
          seeds,
          signal,
        });
        assertBackgroundActive(signal);
        if (candidateSnapshot.mode !== job.mode) {
          return invalid(
            "FBA 商品清單與評論健檢模式不一致，已停止。",
            409,
            "REPORT_MISMATCH",
          );
        }
        job.candidates = candidateSnapshot.candidates;
        job.sourceCandidateCount = candidateSnapshot.sourceCandidateCount;
        job.candidateCoverage = candidateSnapshot.coverage;
        job.relationshipIncompleteRows = candidateSnapshot.relationshipIncompleteRows;
        const candidateModeError = this.reviewAuditModeFence(jobId, job);
        if (candidateModeError) return candidateModeError;
      }
      const candidates = job.candidates;
      if (
        job.mode === "live" &&
        job.nextCandidateIndex < candidates.length &&
        Date.now() < job.nextQueryAt
      ) {
        return this.reviewAuditJobReply(jobId, job);
      }
      const quota = job.mode === "demo"
        ? candidates.length - job.nextCandidateIndex
        : Math.min(1, candidates.length - job.nextCandidateIndex);
      for (let count = 0; count < quota; count += 1) {
        const candidate = candidates[job.nextCandidateIndex];
        if (!candidate) break;
        const queryModeError = this.reviewAuditModeFence(jobId, job);
        if (queryModeError) return queryModeError;
        const result = await this.runReviewAuditFeedbackRequest({
          mode: job.mode,
          marketplaceId,
          candidate,
          signal,
        });
        assertBackgroundActive(signal);
        const resultModeError = this.reviewAuditModeFence(jobId, job);
        if (resultModeError) return resultModeError;
        if (result.error?.code === "RATE_LIMITED") {
          job.nextQueryAt = Date.now() + 2_000;
          return this.reviewAuditJobReply(jobId, job);
        }
        job.results.push(result);
        job.nextCandidateIndex += 1;
        if (result.error?.code === "UNAUTHORIZED") {
          while (job.nextCandidateIndex < candidates.length) {
            const remaining = candidates[job.nextCandidateIndex]!;
            job.results.push({
              candidate: remaining,
              response: null,
              error: {
                code: "UNAUTHORIZED",
                message: result.error.message,
                requestId: result.error.requestId ?? null,
              },
            });
            job.nextCandidateIndex += 1;
          }
          break;
        }
      }
      job.nextQueryAt = Date.now() + REVIEW_AUDIT_LIVE_REQUEST_INTERVAL_MS;
      if (job.nextCandidateIndex >= candidates.length) {
        job.snapshot = buildReviewAuditSnapshot({
          mode: job.mode,
          marketplaceId,
          fetchedAt: new Date(),
          results: job.results,
          relationshipIncompleteRows: job.relationshipIncompleteRows,
          candidateCoverage: job.candidateCoverage ?? undefined,
          sourceCandidateCount: job.sourceCandidateCount,
        });
        job.expiresAt = Date.now() + REVIEW_AUDIT_JOB_TTL_MS;
        return json({ ...structuredClone(job.snapshot), exportId: jobId });
      }
      return this.reviewAuditJobReply(jobId, job);
    } catch (error) {
      // A detected account or mode transition clears and aborts the old job.
      // Preserve that classified context error instead of replacing it with
      // the abort reason raised by the cleanup it intentionally triggered.
      if (!(error instanceof SpApiError)) assertBackgroundActive(signal);
      return apiError(error, "整理 FBA 評論主題時發生未預期的錯誤。");
    }
  }

  private async reviewAuditExport(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const exportId = this.reportIdentifier(request.query.exportId);
    if (!marketplaceId || !exportId) {
      return invalid("評論主題 Excel 快照資訊無效。");
    }
    this.pruneReviewAuditJobs();
    const job = this.reviewAuditJobs.get(exportId);
    if (!job || job.marketplaceId !== marketplaceId || !job.snapshot) {
      return invalid(
        "評論主題健檢尚未完成、已過期或站點不符。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    const modeError = this.reviewAuditModeFence(exportId, job);
    if (modeError) return modeError;
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    if (accountScope !== job.accountScope) {
      this.deleteReviewAuditJob(exportId);
      return invalid(
        "Amazon 帳號範圍已改變，舊評論健檢不可匯出。",
        409,
        "ACCOUNT_SCOPE_CHANGED",
      );
    }
    const accountModeError = this.reviewAuditModeFence(exportId, job);
    if (accountModeError) return accountModeError;
    try {
      const marketplace = MARKETPLACES[marketplaceId];
      const workbook = createReviewAuditWorkbook({
        marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
        snapshot: job.snapshot,
      });
      const filename = `amazon-fba-review-topic-audit-${marketplace.shortLabel.toLowerCase()}-${job.snapshot.fetchedAt.slice(0, 10)}.xlsx`;
      return bytes(
        workbook,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        {
          "content-disposition": `attachment; filename="${filename}"`,
          "x-exported-fba-non-parent-asin-count": String(job.snapshot.rows.length),
          "x-review-topic-incomplete-count": String(job.snapshot.summary.incomplete),
        },
      );
    } catch (error) {
      return apiError(error, "建立 FBA 評論主題 Excel 時發生未預期的錯誤。");
    }
  }

  private async replenishment(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    const targetDays = integer(request.query.targetDays, 60, 14, 180);
    // The restock endpoint receives the effective lead time. AWD profiles add
    // up to 60 days to the basic 1–120 day supplier lead time.
    const leadTimeDays = integer(request.query.leadTimeDays, 35, 1, 180);
    const safetyDays = integer(request.query.safetyDays, 14, 0, 90);
    const casePack = integer(request.query.casePack, 1, 1, 10_000);
    if (
      !marketplaceId ||
      !sellerSku ||
      targetDays === null ||
      leadTimeDays === null ||
      safetyDays === null ||
      casePack === null
    ) {
      return invalid("請提供有效的站點、SKU、目標天數、交期、安全天數與箱入數。");
    }
    if (targetDays < leadTimeDays + safetyDays) {
      return invalid(
        "目標庫存天數不能小於補貨交期加安全庫存，否則補貨建議會互相矛盾。",
        400,
        "INVALID_RESTOCK_WINDOW",
      );
    }
    try {
      return json(
        await getRestockPlan({
          marketplaceId,
          sellerSku,
          targetDays,
          leadTimeDays,
          safetyDays,
          casePack,
        }),
      );
    } catch (error) {
      return apiError(error, "建立 FBA 補貨建議時發生未預期的錯誤。");
    }
  }

  private async skuCommand(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    const { marketplaceId, sellerSku } = identity;
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    const profileState = await this.store.getProductMaster(
      accountScope,
      marketplaceId,
      sellerSku,
    );
    const profile = profileState.profile;
    const effectiveLead =
      profile.leadTimeDays +
      (profile.supplyRoute === "AWD_TO_FBA" ? profile.awdBufferDays : 0);
    const settled = await Promise.allSettled([
      getListingPrice(identity),
      getListingContent(identity),
      getListingImages(identity),
      getSubscribeAndSaveOffer(identity),
      getRestockPlan({
        marketplaceId,
        sellerSku,
        targetDays: profile.targetDays,
        leadTimeDays: effectiveLead,
        safetyDays: profile.safetyDays,
        casePack: profile.casePack,
      }),
    ] as const);
    const price = sourceResult<ListingPriceSnapshot>(settled[0]);
    const content = sourceResult<ListingContentSnapshot>(settled[1]);
    const images = sourceResult<ListingImageSnapshot>(settled[2]);
    const subscribeSave = sourceResult<SubscribeAndSaveOfferSnapshot>(settled[3]);
    const restock = sourceResult<RestockPlanSnapshot>(settled[4]);
    const identityData = {
      displayName: price.data?.title ?? content.data?.title ?? restock.data?.title ?? null,
      asin: price.data?.asin ?? content.data?.asin ?? restock.data?.asin ?? null,
      fnSku: restock.data?.fnSku ?? null,
    };
    const synced = await this.store.syncProductIdentity({
      accountScope,
      marketplaceId,
      sellerSku,
      ...identityData,
    });
    const effectiveProfile: ProductMasterState = {
      ...synced,
      profile: {
        ...synced.profile,
        settingsConfigured: profile.settingsConfigured,
      },
    };
    const tasks = this.commandTasks({
      profile: effectiveProfile,
      price,
      content,
      images,
      subscribeSave,
      restock,
    });
    const sources = [price, content, images, subscribeSave, restock];
    const sourceReady = sources.filter((item) => item.data).length;
    return json({
      mode: usesDemoMode(marketplaceId) ? "demo" : "live",
      marketplaceId,
      sellerSku,
      fetchedAt: new Date().toISOString(),
      profile: effectiveProfile,
      price,
      content,
      images,
      subscribeSave,
      restock,
      tasks,
      summary: {
        score: Math.round((sourceReady / sources.length) * 100),
        sourceReady,
        sourceTotal: sources.length,
        critical: tasks.filter((item) => item.severity === "critical").length,
        warning: tasks.filter((item) => item.severity === "warning").length,
        manual: tasks.filter((item) => item.automation === "manual").length,
        overall: tasks.some((item) => item.severity === "critical")
          ? "critical"
          : tasks.some((item) => item.severity === "warning")
            ? "attention"
            : "ready",
      },
      notice: "這是只讀整合掃描；只有完成預檢、確認與 Notebook 鑰匙（Touch ID／Windows Hello）本機授權後，才可能寫入 Amazon。",
    });
  }

  private commandTasks(input: {
    profile: ProductMasterState;
    price: ReturnType<typeof sourceResult<ListingPriceSnapshot>>;
    content: ReturnType<typeof sourceResult<ListingContentSnapshot>>;
    images: ReturnType<typeof sourceResult<ListingImageSnapshot>>;
    subscribeSave: ReturnType<typeof sourceResult<SubscribeAndSaveOfferSnapshot>>;
    restock: ReturnType<typeof sourceResult<RestockPlanSnapshot>>;
  }): CommandTask[] {
    const tasks: CommandTask[] = [];
    const add = (task: CommandTask) => {
      if (!tasks.some((item) => item.id === task.id)) tasks.push(task);
    };
    if (!input.profile.profile.settingsConfigured) {
      add({
        id: "profile-settings",
        title: "儲存一次商品補貨規格",
        detail: "設定箱入數、交期、安全天數與 AWD 緩衝後，之後會自動套用。",
        automation: "one_click",
        severity: "info",
        tool: null,
      });
    }
    const sourceEntries = [
      ["price", input.price, "價格", "price"],
      ["content", input.content, "文案", "copy"],
      ["images", input.images, "圖片", "images"],
      ["subscribe", input.subscribeSave, "訂閱", "price"],
      ["restock", input.restock, "補貨", "restock"],
    ] as const;
    for (const [id, source, label, tool] of sourceEntries) {
      if (!source.error) continue;
      add({
        id: `source-${id}`,
        title: `${label}資料未完成`,
        detail: source.error.message,
        automation: "automatic",
        severity: id === "price" || id === "restock" ? "warning" : "info",
        tool,
      });
    }
    if (input.content.data) {
      const content = input.content.data;
      const missing = [
        content.capabilities.title.supported && !content.title.trim() ? "標題" : null,
        content.capabilities.bulletPoints.supported &&
        content.bulletPoints.filter(Boolean).length <
          Math.min(5, content.capabilities.bulletPoints.maxItems ?? 5)
          ? `五大賣點（目前 ${content.bulletPoints.filter(Boolean).length}）`
          : null,
        content.capabilities.ingredients.supported && !content.ingredients.trim()
          ? "成分"
          : null,
      ].filter(Boolean);
      if (missing.length) {
        add({
          id: "content-missing",
          title: "商品內容不完整",
          detail: `缺少：${missing.join("、")}。可直接帶入文案工具修正。`,
          automation: "one_click",
          severity: "warning",
          tool: "copy",
        });
      }
      const errors = content.issues.filter((issue) => issue.severity.toUpperCase() === "ERROR");
      if (errors.length) {
        add({
          id: "listing-errors",
          title: `Amazon 回報 ${errors.length} 個 Listing 錯誤`,
          detail: errors[0]?.message || "請打開文案工具查看 Amazon issue。",
          automation: "manual",
          severity: "critical",
          tool: "copy",
        });
      }
    }
    if (input.images.data) {
      const count = input.images.data.images.filter((item) => item.url).length;
      const hasMain = Boolean(input.images.data.images[0]?.url);
      if (!hasMain || count < 6) {
        add({
          id: "images-incomplete",
          title: hasMain ? "商品圖片可以再補強" : "商品缺少主圖",
          detail: hasMain
            ? `目前 ${count} 張；可直接拖拉補到建議的 6 張以上。`
            : "主圖是必備欄位，系統已準備好拖拉上傳與格式檢查。",
          automation: "one_click",
          severity: hasMain ? "info" : "critical",
          tool: "images",
        });
      }
    }
    if (input.price.data && !input.price.data.standardPrice) {
      add({
        id: "price-missing",
        title: "查不到可核對的標準售價",
        detail: "為避免誤改，價格寫入已自動停止。",
        automation: "manual",
        severity: "critical",
        tool: "price",
      });
    }
    if (input.restock.data) {
      const restock = input.restock.data;
      if (restock.action === "RESTOCK_NOW" || restock.action === "WATCH") {
        add({
          id: restock.action === "RESTOCK_NOW" ? "restock-now" : "restock-watch",
          title:
            restock.action === "RESTOCK_NOW"
              ? `建議現在補貨 ${restock.recommendedUnits.toLocaleString()} 件`
              : `準備補貨 ${restock.recommendedUnits.toLocaleString()} 件`,
          detail: `目前可售約 ${restock.daysOfCover?.toFixed(1) ?? "—"} 天；已依每箱 ${restock.casePack} 件向上取整。`,
          automation: "one_click",
          severity: restock.action === "RESTOCK_NOW" ? "critical" : "warning",
          tool: "restock",
        });
      }
    }
    if (!tasks.length) {
      add({
        id: "all-clear",
        title: "這個 SKU 目前沒有明顯異常",
        detail: "價格、內容、圖片與 FBA 補貨訊號已完成掃描。",
        automation: "automatic",
        severity: "info",
        tool: null,
      });
    }
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return tasks.sort((left, right) => rank[left.severity] - rank[right.severity]);
  }

  private async getProductMaster(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("請選擇有效的 Amazon 站點。");
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    if (Object.prototype.hasOwnProperty.call(request.query, "sku")) {
      const sellerSku = parseSellerSku(request.query.sku);
      if (!sellerSku) return invalid("請輸入有效的 Seller SKU。");
      return json(
        await this.store.getProductMaster(accountScope, marketplaceId, sellerSku),
      );
    }
    const query = (request.query.q ?? "").trim();
    const limit = integer(request.query.limit, 8, 1, 20);
    if (query.length > 80 || limit === null) return invalid("商品主檔搜尋條件無效。");
    return json(
      await this.store.listProductMasters({ accountScope, marketplaceId, query, limit }),
    );
  }

  private async putProductMaster(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body) return invalid("商品主檔請求必須使用 JSON。", 415, "UNSUPPORTED_MEDIA_TYPE");
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const supplyRoute =
      body.supplyRoute === "DIRECT_FBA" || body.supplyRoute === "AWD_TO_FBA"
        ? body.supplyRoute
        : null;
    const settings = {
      casePack: integer(body.casePack, null, 1, 10_000),
      cartonsPerPallet: integer(body.cartonsPerPallet, null, 1, 1_000),
      leadTimeDays: integer(body.leadTimeDays, null, 1, 120),
      safetyDays: integer(body.safetyDays, null, 0, 90),
      targetDays: integer(body.targetDays, null, 14, 180),
      supplyRoute,
      awdBufferDays: integer(body.awdBufferDays, null, 0, 60),
      shelfLifeDays: optionalInteger(body.shelfLifeDays, 1, 3_650),
      minimumRemainingDays: optionalInteger(body.minimumRemainingDays, 1, 3_650),
      factory: shortText(body.factory, 80),
      notes: multiLineText(body.notes, 500),
    };
    const displayName = shortText(body.displayName, 300);
    const asin = shortText(body.asin, 20);
    const fnSku = shortText(body.fnSku, 40);
    if (
      !marketplaceId ||
      !sellerSku ||
      !supplyRoute ||
      settings.casePack === null ||
      settings.cartonsPerPallet === null ||
      settings.leadTimeDays === null ||
      settings.safetyDays === null ||
      settings.targetDays === null ||
      settings.awdBufferDays === null ||
      settings.shelfLifeDays === undefined ||
      settings.minimumRemainingDays === undefined ||
      settings.factory === undefined ||
      settings.notes === undefined ||
      displayName === undefined ||
      asin === undefined ||
      fnSku === undefined
    ) {
      return invalid("商品主檔內有格式或範圍不正確的欄位。");
    }
    if (
      supplyRoute === "AWD_TO_FBA" &&
      marketplaceId !== marketplaceByCode("US").id
    ) {
      return invalid("AWD→FBA 目前只開放美國站。", 422, "AWD_US_ONLY");
    }
    const effectiveLead =
      settings.leadTimeDays! +
      (supplyRoute === "AWD_TO_FBA" ? settings.awdBufferDays! : 0);
    if (settings.targetDays! < effectiveLead + settings.safetyDays!) {
      return invalid(
        "目標庫存不能小於補貨交期、AWD 緩衝與安全庫存的合計。",
        422,
        "INVALID_RESTOCK_WINDOW",
      );
    }
    if (
      settings.shelfLifeDays &&
      settings.minimumRemainingDays &&
      settings.minimumRemainingDays > settings.shelfLifeDays
    ) {
      return invalid(
        "到倉最低剩餘效期不能大於商品總效期。",
        422,
        "INVALID_SHELF_LIFE",
      );
    }
    return json(
      await this.store.saveProductMaster({
        accountScope: await this.vault.getAccountScope(
          MARKETPLACES[marketplaceId].region,
        ),
        marketplaceId,
        sellerSku,
        settings: {
          casePack: settings.casePack!,
          cartonsPerPallet: settings.cartonsPerPallet!,
          leadTimeDays: settings.leadTimeDays!,
          safetyDays: settings.safetyDays!,
          targetDays: settings.targetDays!,
          supplyRoute,
          awdBufferDays: settings.awdBufferDays!,
          shelfLifeDays: settings.shelfLifeDays!,
          minimumRemainingDays: settings.minimumRemainingDays!,
          factory: settings.factory!,
          notes: settings.notes!,
        },
        displayName,
        asin,
        fnSku,
      }),
    );
  }

  private async uploadImage(request: ApiRequest): Promise<ApiResponse> {
    if (request.body?.kind !== "multipart") {
      return invalid("圖片上傳必須使用 multipart/form-data。", 415, "UNSUPPORTED_MEDIA_TYPE");
    }
    const marketplaceId = parseMarketplace(request.body.fields.marketplaceId);
    const sellerSku = parseSellerSku(request.body.fields.sellerSku);
    const file = request.body.file;
    if (!marketplaceId || !sellerSku || !file || !(file.bytes instanceof Uint8Array)) {
      return invalid("請提供有效的站點、SKU 與圖片檔案。");
    }
    if (file.bytes.byteLength <= 0 || file.bytes.byteLength > 10 * 1024 * 1024) {
      return invalid("圖片必須小於 10 MB。", 413, "IMAGE_TOO_LARGE");
    }
    const contentType = this.imageContentType(file.bytes);
    if (!contentType) {
      return invalid("只接受內容有效的 JPEG 或 PNG 圖片。", 415, "INVALID_IMAGE");
    }
    const dimensions = this.imageDimensions(file.bytes, contentType);
    if (!dimensions || dimensions.width < 500 || dimensions.height < 500) {
      return invalid(
        "Amazon 圖片寬高都必須至少 500px；建議 1000px 以上。",
        422,
        "IMAGE_TOO_SMALL",
      );
    }
    const skuHash = createHash("sha256").update(sellerSku).digest("hex").slice(0, 16);
    const extension = contentType === "image/png" ? "png" : "jpg";
    const key = `listing-images/${marketplaceId}/${skuHash}/${randomUUID()}.${extension}`;
    const previewUrl = `data:${contentType};base64,${Buffer.from(file.bytes).toString("base64")}`;
    const storage = await this.vault.getImageStorage();
    let amazonUrl: string | null = null;
    if (storage) {
      const expectedHost = `${storage.accountId}.r2.cloudflarestorage.com`;
      const endpoint = new URL(`https://${expectedHost}`);
      if (
        endpoint.protocol !== "https:" ||
        endpoint.hostname !== expectedHost ||
        endpoint.username ||
        endpoint.password ||
        endpoint.port
      ) {
        return invalid("R2 endpoint 未通過安全檢查。", 422, "INVALID_IMAGE_STORAGE");
      }
      const client = new S3Client({
        region: "auto",
        endpoint: endpoint.toString(),
        credentials: {
          accessKeyId: storage.accessKeyId,
          secretAccessKey: storage.secretAccessKey,
        },
      });
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: storage.bucket,
            Key: key,
            Body: file.bytes,
            ContentType: contentType,
            CacheControl: "public, max-age=31536000, immutable",
            Metadata: {
              marketplace: marketplaceId,
              sku: skuHash,
              width: String(dimensions.width),
              height: String(dimensions.height),
            },
          }),
        );
        amazonUrl = `${storage.publicBaseUrl.replace(/\/$/, "")}/${key}`;
      } finally {
        client.destroy();
      }
    }
    return json({
      key,
      previewUrl,
      amazonUrl,
      width: dimensions.width,
      height: dimensions.height,
      contentType,
      readyForAmazon: Boolean(amazonUrl),
      notice: amazonUrl
        ? "圖片已上傳到你自己的 R2，送出後仍需等待 Amazon 下載與驗證。"
        : "圖片已在這台電腦完成格式與像素檢查；設定自己的 R2 公開網域後即可一鍵送交 Amazon。",
    });
  }

  private imageContentType(bytesValue: Uint8Array): "image/png" | "image/jpeg" | null {
    if (
      bytesValue.length >= 24 &&
      bytesValue[0] === 0x89 &&
      bytesValue[1] === 0x50 &&
      bytesValue[2] === 0x4e &&
      bytesValue[3] === 0x47 &&
      bytesValue[4] === 0x0d &&
      bytesValue[5] === 0x0a &&
      bytesValue[6] === 0x1a &&
      bytesValue[7] === 0x0a
    ) {
      return "image/png";
    }
    return bytesValue.length >= 4 &&
      bytesValue[0] === 0xff &&
      bytesValue[1] === 0xd8 &&
      bytesValue[2] === 0xff
      ? "image/jpeg"
      : null;
  }

  private imageDimensions(
    bytesValue: Uint8Array,
    type: "image/png" | "image/jpeg",
  ): { width: number; height: number } | null {
    if (type === "image/png") {
      const view = new DataView(
        bytesValue.buffer,
        bytesValue.byteOffset,
        bytesValue.byteLength,
      );
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    let offset = 2;
    while (offset + 8 < bytesValue.length) {
      if (bytesValue[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytesValue[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytesValue.length) break;
      const length = (bytesValue[offset] << 8) | bytesValue[offset + 1];
      if (length < 2 || offset + length > bytesValue.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        return {
          height: (bytesValue[offset + 3] << 8) | bytesValue[offset + 4],
          width: (bytesValue[offset + 5] << 8) | bytesValue[offset + 6],
        };
      }
      offset += length;
    }
    return null;
  }

  private async startExport(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) return invalid("請選擇要匯出的 Amazon 站點。");
    try {
      const status = await this.startSharedAllListingsReport(marketplaceId, true);
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return apiError(error, "開始建立全商品 Excel 時發生未預期的錯誤。");
    }
  }

  private async startSharedAgedInventoryReport(
    marketplaceId: MarketplaceId,
    options: Readonly<{
      explicitRetry: boolean;
      freshCompleted?: boolean;
      signal?: AbortSignal;
    }>,
  ) {
    return this.reportsRuntime.start(
      {
        intent: "aged-inventory",
        marketplaceId,
        signal: options.signal,
      },
      {
        explicitRetry: options.explicitRetry,
        freshCompleted: options.freshCompleted,
      },
    );
  }

  private async getSharedAgedInventoryReportStatus(input: {
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
  }) {
    return this.reportsRuntime.status(
      {
        intent: "aged-inventory",
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      },
      input.reportId,
    );
  }

  private async getSharedAgedInventoryData(
    input: Parameters<typeof getAgedInventoryData>[0],
  ): ReturnType<typeof getAgedInventoryData> {
    const document = await this.reportsRuntime.readDocument(
      {
        intent: "aged-inventory",
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      },
      { reportId: input.reportId, documentId: input.documentId },
    );
    return getAgedInventoryDataFromDocument({
      marketplaceId: input.marketplaceId,
      mode: document.mode,
      document: document.text,
      signal: input.signal,
    });
  }

  private async startAgedInventory(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) {
      return invalid("請選擇要查詢庫齡的 Amazon 站點。");
    }
    try {
      const status = await this.startSharedAgedInventoryReport(
        marketplaceId,
        { explicitRetry: true, freshCompleted: true },
      );
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return apiError(error, "開始建立 FBA 庫齡報表時發生未預期的錯誤。");
    }
  }

  private async agedInventoryStatusOrData(
    request: ApiRequest,
  ): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const reportId = this.reportIdentifier(request.query.reportId);
    if (!marketplaceId || !reportId) {
      return invalid("FBA 庫齡報表查詢資訊無效，請重新同步。");
    }
    const dataRequested = request.query.data === "1";
    const downloadRequested = request.query.download === "1";
    if (!dataRequested && !downloadRequested) {
      try {
        const status = await this.getSharedAgedInventoryReportStatus({
          marketplaceId,
          reportId,
        });
        return json({ ...status, message: status.notice });
      } catch (error) {
        return apiError(error, "查詢 FBA 庫齡報表狀態時發生未預期的錯誤。");
      }
    }
    const documentId = this.reportIdentifier(request.query.documentId);
    if (!documentId) {
      return invalid("FBA 庫齡報表文件資訊無效，請重新同步。");
    }
    try {
      const snapshot = await this.getSharedAgedInventoryData({
        marketplaceId,
        reportId,
        documentId,
      });
      if (!downloadRequested) return json(snapshot);
      const marketplace = MARKETPLACES[marketplaceId];
      const workbook = createAgedInventoryWorkbook({
        marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
        fetchedAt: snapshot.fetchedAt,
        rows: snapshot.rows,
        excessAvailability: snapshot.summary.excessAvailability,
        excessReportedSkuCount: snapshot.summary.excessReportedSkuCount,
        storageCostAvailability: snapshot.summary.storageCostAvailability,
        storageCostReportedSkuCount: snapshot.summary.storageCostReportedSkuCount,
        agedSurchargeAvailability: snapshot.summary.agedSurchargeAvailability,
        agedSurchargeReportedSkuCount: snapshot.summary.agedSurchargeReportedSkuCount,
        expirationNotice: snapshot.expiration.notice,
      });
      const date = snapshot.fetchedAt.slice(0, 10);
      const filename = `amazon-fba-inventory-age-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
      return bytes(
        workbook,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        {
          "content-disposition": `attachment; filename="${filename}"`,
          "x-exported-fba-sku-count": String(snapshot.rows.length),
        },
      );
    } catch (error) {
      return apiError(error, "整理或匯出 FBA 庫齡資料時發生未預期的錯誤。");
    }
  }

  private pruneImageAuditSnapshots(now = Date.now()): void {
    for (const [exportId, entry] of this.imageAuditSnapshots) {
      if (entry.expiresAt <= now) this.imageAuditSnapshots.delete(exportId);
    }
  }

  private pruneContentBatchPlans(now = Date.now()): void {
    for (const [previewId, plan] of this.contentBatchPlans) {
      if (plan.expiresAt <= now && plan.state !== "committing") {
        this.contentBatchPlans.delete(previewId);
      }
    }
  }

  private async downloadImageAuditSnapshot(
    marketplaceId: MarketplaceId,
    exportId: string,
  ): Promise<ApiResponse> {
    this.pruneImageAuditSnapshots();
    const stored = this.imageAuditSnapshots.get(exportId);
    if (!stored || stored.marketplaceId !== marketplaceId) {
      return invalid(
        "圖片健檢 Excel 快照已過期或站點不符，請重新掃描。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    if (stored.accountScope !== accountScope) {
      this.imageAuditSnapshots.delete(exportId);
      return invalid(
        "Amazon 帳號範圍已改變，舊圖片健檢快照不可匯出。",
        409,
        "ACCOUNT_SCOPE_CHANGED",
      );
    }
    const marketplace = MARKETPLACES[marketplaceId];
    const snapshot = stored.snapshot;
    const workbook = createImageAuditWorkbook({
      marketplaceId,
      marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
      fetchedAt: snapshot.fetchedAt,
      minimumImages: snapshot.minimumImages,
      rows: snapshot.rows,
    });
    const date = snapshot.fetchedAt.slice(0, 10);
    const filename = `amazon-fba-image-audit-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
    return bytes(
      workbook,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      {
        "content-disposition": `attachment; filename="${filename}"`,
        "x-exported-fba-sku-count": String(snapshot.summary.total),
        "x-image-audit-under-minimum-count": String(snapshot.summary.underMinimum),
        "x-image-audit-incomplete-count": String(snapshot.summary.incomplete),
      },
    );
  }

  private async exportStatusOrDownload(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const auditRequested = request.query.audit === "1";
    const imageAuditRequested = request.query.imageAudit === "1";
    if (!marketplaceId) return invalid("報表站點資訊無效，請重新匯出。");
    if (auditRequested && imageAuditRequested) {
      return invalid("一次只能執行一種全站健檢。");
    }
    if (imageAuditRequested && request.query.download === "1") {
      const exportId = this.reportIdentifier(request.query.exportId);
      if (!exportId) {
        return invalid("圖片健檢 Excel 快照資訊無效，請重新掃描。");
      }
      try {
        return await this.downloadImageAuditSnapshot(marketplaceId, exportId);
      } catch (error) {
        return apiError(error, "建立圖片健檢 Excel 時發生未預期的錯誤。");
      }
    }
    const reportId = this.reportIdentifier(request.query.reportId);
    if (!reportId) return invalid("報表查詢資訊無效，請重新匯出。");
    if (request.query.download !== "1" && !auditRequested && !imageAuditRequested) {
      try {
        const status = await this.getSharedAllListingsReportStatus({ marketplaceId, reportId });
        return json({ ...status, message: status.notice });
      } catch (error) {
        return apiError(error, "查詢全商品報表狀態時發生未預期的錯誤。");
      }
    }
    const documentId = this.reportIdentifier(request.query.documentId);
    if (!documentId) return invalid("報表文件資訊無效，請重新匯出。");
    try {
      const data = await this.getSharedAllListingsExportData({ marketplaceId, reportId, documentId });
      if (auditRequested) {
        const grouping = await getFbaVariationGroupingData({
          marketplaceId,
          rows: data.rows,
        });
        const groupingBySku = new Map(
          grouping.rows.map((row) => [row.sellerSku, row] as const),
        );
        const auditableRows = grouping.rows.filter((row) => row.role !== "parent");
        const audit = auditListingContentRows({
          marketplaceId,
          fetchedAt: data.fetchedAt,
          rows: auditableRows,
        });
        const exportId = randomUUID();
        const snapshot = {
          ...audit,
          exportId,
          rows: audit.rows.map((row) => {
            const relationship = groupingBySku.get(row.sellerSku);
            return {
              ...row,
              variationRole: relationship?.role ?? "unknown",
              variationParentSku: relationship?.parentSku ?? null,
              variationFamilyKey: relationship?.familyKey ?? row.sellerSku,
              variationTheme: relationship?.theme ?? null,
              relationshipStatus: relationship?.status ?? "incomplete",
              relationshipMessage: relationship?.message ??
                "Amazon relationships 未與文案列完整對齊；本列不會被猜入任一變體 family。",
            };
          }),
        };
        const accountScope = await this.vault.getAccountScope(
          MARKETPLACES[marketplaceId].region,
        );
        const mode = usesDemoMode(marketplaceId) ? "demo" : "live";
        await this.store.saveContentAuditSnapshotEvidence({
          exportId,
          marketplaceId,
          accountScope,
          mode,
          fetchedAt: snapshot.fetchedAt,
          rowDigests: snapshot.rows.map((row) =>
            contentAuditSnapshotRowDigest({
              accountScope,
              marketplaceId,
              mode,
              exportId,
              fetchedAt: snapshot.fetchedAt,
              sellerSku: row.sellerSku,
              asin: row.asin,
              productType: row.productType,
              variationFamilyKey: contentAuditWorkbookFamilyKey(row),
              values: contentAuditRowValues(row),
              readStatus: row.readStatus,
            })),
        });
        return json(snapshot);
      }
      if (imageAuditRequested) {
        const snapshot = auditListingImageRows({
          marketplaceId,
          fetchedAt: data.fetchedAt,
          rows: data.rows.map((row) => ({
            sellerSku: row.sellerSku,
            asin: row.asin,
            productType: row.productType,
            title: row.title,
            imageUrls: row.imageUrls,
            readStatus: row.readStatus,
            readErrors: row.readErrors,
          })),
          minimumImages: IMAGE_AUDIT_MINIMUM_IMAGES,
        });
        const exportId = randomUUID();
        const accountScope = await this.vault.getAccountScope(
          MARKETPLACES[marketplaceId].region,
        );
        this.pruneImageAuditSnapshots();
        this.imageAuditSnapshots.set(exportId, {
          marketplaceId,
          accountScope,
          expiresAt: Date.now() + IMAGE_AUDIT_SNAPSHOT_TTL_MS,
          snapshot: structuredClone(snapshot),
        });
        return json({ ...snapshot, exportId });
      }
      const marketplace = MARKETPLACES[marketplaceId];
      const workbook = createListingsWorkbook({
        marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
        fetchedAt: data.fetchedAt,
        rows: data.rows.map((row) => ({
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
        errors: data.errors.map((error) => ({
          sku: error.sellerSku,
          type: error.kind,
          description: error.message,
        })),
      });
      const date = data.fetchedAt.slice(0, 10);
      const filename = `amazon-listing-content-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
      return bytes(
        workbook,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        {
          "content-disposition": `attachment; filename="${filename}"`,
          "x-exported-listing-count": String(data.rows.length),
          "x-export-warning-count": String(data.errors.length),
        },
      );
    } catch (error) {
      return apiError(error, "建立全商品 Excel 時發生未預期的錯誤。");
    }
  }

  private reportIdentifier(value: unknown): string | null {
    // Amazon reportDocumentId values commonly use the `amzn1.spdoc...`
    // namespace, so a dot is expected and is not a path separator here.
    return typeof value === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(value)
      ? value
      : null;
  }

  private async systemHealth(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(
      request.query.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
    );
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");
    const marketplace = MARKETPLACES[marketplaceId];
    const summary = await this.vault.getSummary();
    const region = marketplace.region;
    const live = summary.regions[region].configured && !usesDemoMode(marketplaceId);
    type Check = {
      id: string;
      label: string;
      state: "ready" | "attention" | "manual";
      automation: "automatic" | "one_click" | "manual";
      detail: string;
      action: string | null;
    };
    const check = (
      id: string,
      label: string,
      state: Check["state"],
      automation: Check["automation"],
      detail: string,
      action: string | null = null,
    ): Check => ({ id, label, state, automation, detail, action });
    const checks: Check[] = [
      check(
        "fba-only",
        "FBA-only 守門",
        "ready",
        "automatic",
        "所有訂單、庫存與補貨查詢都固定為 Amazon 履約；沒有 FBM 操作入口。",
      ),
      check(
        "sp-api",
        "Amazon SP-API 憑證設定",
        live ? "ready" : "attention",
        "automatic",
        live
          ? `${marketplace.label}已設定本機系統安全儲存區中的 ${region.toUpperCase()} 憑證；本項只核對本機設定，未代表即時驗證 Amazon 連線。`
          : "尚未輸入此區域的 LWA、Refresh Token 與 Seller ID，目前使用展示資料。",
        live ? null : "開啟右上角本機安全連線，輸入 SP-API 憑證",
      ),
      check(
        "keychain",
        "本機系統安全儲存區加密",
        summary.encryptionAvailable ? "ready" : "attention",
        "automatic",
        summary.encryptionAvailable
          ? "Refresh Token 與 Client Secret 只以加密密文保存於這台電腦。"
          : "本機系統安全儲存區不可用；系統已拒絕保存任何 API 憑證。",
      ),
      check(
        "operation-ledger",
        "本機防重送帳本",
        "ready",
        "automatic",
        "已確認結果保留 24 小時；未確認寫入會持續鎖定，直到主程序唯讀回查證明完成，絕不盲目重送。",
      ),
      check(
        "product-master",
        "中央 SKU 商品主檔",
        "ready",
        "automatic",
        "箱入數、交期、AWD 緩衝與效期設定保存在這台電腦，所有補貨工具共用。",
      ),
      check(
        "image-storage",
        "圖片拖拉與公開來源",
        summary.imageStorageConfigured ? "ready" : "attention",
        "one_click",
        summary.imageStorageConfigured
          ? "圖片會在本機驗證後上傳到你自己的 R2 公開網域，再交由 Amazon 讀取。"
          : "本機拖拉與格式檢查可用；正式送出圖片前需設定自己的 R2 公開 HTTPS 網域。",
        summary.imageStorageConfigured ? null : "本機安全連線 → 圖片空間 → 加入 R2 設定",
      ),
      check(
        "replenishment-engine",
        "FBA 補貨引擎",
        "ready",
        "automatic",
        summary.replenishmentSkillConfigured
          ? "內建 FBA 計算已就緒，外部補貨 Skill 接點也已設定。"
          : "內建 FBA 庫存、在途與近 30 天銷速計算已就緒；外部 Skill 為選配。",
      ),
      check(
        "amazon-ads",
        "SB／SD 廣告授權",
        "manual",
        "manual",
        "Amazon Ads 需要獨立 Direct Advertiser、LWA client 與站點 Profile；SP 仍建議留在 Helium 10。",
        "一鍵開啟 Amazon Ads Console",
      ),
    ];
    const actionable = checks.filter((item) => item.state !== "manual");
    const readyCount = actionable.filter((item) => item.state === "ready").length;
    const attentionCount = actionable.length - readyCount;
    return json({
      marketplaceId,
      marketplaceLabel: marketplace.label,
      mode: live ? "live" : "demo",
      overall: attentionCount ? "attention" : "ready",
      checkedAt: new Date().toISOString(),
      score: Math.round((readyCount / Math.max(1, actionable.length)) * 100),
      summary: {
        ready: readyCount,
        attention: attentionCount,
        manual: checks.filter((item) => item.state === "manual").length,
      },
      checks,
      safeguards: [
        "本機 App 內部 IPC 白名單",
        "本機系統安全儲存區加密",
        "FBA-only 固定條件",
        "精確 Seller SKU 驗證",
        "Amazon Validation Preview",
        "舊值衝突檢查",
        "本機持久 Idempotency 防重送",
        "大幅調價二次確認",
        "Notebook 鑰匙（Touch ID／Windows Hello）系統確認",
        "送出後只讀回查，不自動重送",
      ],
      notice: "自我檢查只讀取本機設定狀態，未代表即時驗證 Amazon 連線；不會修改 Amazon、廣告或實體入庫。",
    });
  }

  private standaloneAuditKind(value: unknown): StandaloneAuditKind | null {
    return value === "content" ||
      value === "image" ||
      value === "variation" ||
      value === "subscription" ||
      value === "businessPricing" ||
      value === "advertising" ||
      value === "agedInventory"
      ? value
      : null;
  }

  private async bindStandaloneAuditContext(input: Readonly<{
    marketplaceId: string;
    mode: "live" | "demo";
  }>): Promise<StandaloneAuditJobBoundContext> {
    if (!isMarketplaceId(input.marketplaceId)) {
      throw new StandaloneAuditJobCoordinatorError("單項健檢站點無效。", {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    const current = await this.currentAuditSuiteContext(input.marketplaceId);
    return {
      accountScope: current.accountScope,
      marketplaceId: input.marketplaceId,
      mode: current.mode,
    };
  }

  private async startStandaloneAudit(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (
      !body ||
      Object.keys(body).some((key) =>
        key !== "kind" &&
        key !== "marketplaceId" &&
        key !== "mode" &&
        key !== "options") ||
      !Object.hasOwn(body, "kind") ||
      !Object.hasOwn(body, "marketplaceId") ||
      !Object.hasOwn(body, "mode")
    ) {
      return invalid(
        "單項健檢只接受 kind、marketplaceId、mode 與受限 options；帳號由 main process 綁定。",
      );
    }
    const kind = this.standaloneAuditKind(body.kind);
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const mode = body.mode === "live" || body.mode === "demo" ? body.mode : null;
    let options: { months?: 6 | 12 | 23 } | undefined;
    if (body.options !== undefined) {
      if (!body.options || typeof body.options !== "object" || Array.isArray(body.options)) {
        return invalid("單項健檢 options 格式無效。");
      }
      const source = body.options as Record<string, unknown>;
      if (Object.keys(source).some((key) => key !== "months")) {
        return invalid("單項健檢 options 欄位無效。");
      }
      if (source.months !== undefined) {
        if (source.months !== 6 && source.months !== 12 && source.months !== 23) {
          return invalid("Subscribe & Save 月數只能選 6、12 或 23。");
        }
        options = { months: source.months };
      } else {
        options = {};
      }
    }
    if (!kind || !marketplaceId || !mode) {
      return invalid("單項健檢種類、站點或模式無效。");
    }
    try {
      const receipt = await this.standaloneAuditJobs.start({
        kind,
        marketplaceId,
        mode,
        options,
      });
      return json(receipt, 202, { "retry-after": "1" });
    } catch (error) {
      return apiError(error, "開始單項健檢時發生未預期的錯誤。");
    }
  }

  private async standaloneAuditStatus(request: ApiRequest): Promise<ApiResponse> {
    const kind = this.standaloneAuditKind(request.query.kind);
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const mode = request.query.mode === "live" || request.query.mode === "demo"
      ? request.query.mode
      : null;
    const jobId = this.reportIdentifier(request.query.jobId);
    const contextId = this.reportIdentifier(request.query.contextId);
    if (!kind || !marketplaceId || !mode || !jobId || !contextId) {
      return invalid("單項健檢工作資訊無效。");
    }
    try {
      const receipt = await this.standaloneAuditJobs.get({
        kind,
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
      return apiError(error, "查詢單項健檢進度時發生未預期的錯誤。");
    }
  }

  private async assertStandaloneAuditContext(
    context: StandaloneAuditJobBoundContext,
    signal: AbortSignal,
  ): Promise<MarketplaceId> {
    assertBackgroundActive(signal);
    if (!isMarketplaceId(context.marketplaceId)) {
      throw new Error("單項健檢工作站點無法安全辨識。");
    }
    const current = await this.currentAuditSuiteContext(context.marketplaceId);
    assertBackgroundActive(signal);
    if (
      current.accountScope !== context.accountScope ||
      current.mode !== context.mode
    ) {
      throw new Error("單項健檢工作與目前帳號或展示／真實模式不一致。");
    }
    return context.marketplaceId;
  }

  private async standaloneListingReport(input: Readonly<{
    context: StandaloneAuditJobBoundContext;
    signal: AbortSignal;
    heartbeat(): void;
    updateProgress: Parameters<StandaloneAuditJobGateway["run"]>[0]["updateProgress"];
  }>, purpose: FbaCatalogReportsPurpose = "catalog"): Promise<{
    reportId: string;
    documentId: string;
  }> {
    const marketplaceId = await this.assertStandaloneAuditContext(
      input.context,
      input.signal,
    );
    input.updateProgress({
      stage: "amazon_report",
      message: "Amazon 正在準備 FBA 全商品報表。",
      completedUnits: 0,
      totalUnits: 1,
    });
    let status = await this.startSharedAllListingsReport(
      marketplaceId,
      false,
      input.signal,
      { purpose },
    );
    input.heartbeat();
    for (let attempt = 0; !status.ready && attempt < 180; attempt += 1) {
      if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
        throw new Error("Amazon 未能產生本次單項健檢所需的 FBA 全商品報表。");
      }
      input.heartbeat();
      await waitMilliseconds(1_000, input.signal);
      status = await this.getSharedAllListingsReportStatus({
        marketplaceId,
        reportId: status.reportId,
        signal: input.signal,
      });
      input.heartbeat();
    }
    if (
      !status.ready ||
      !status.reportId ||
      !status.documentId ||
      status.mode !== input.context.mode
    ) {
      throw new Error("Amazon FBA 全商品報表未完成或 context 已改變。");
    }
    return { reportId: status.reportId, documentId: status.documentId };
  }

  private async standaloneListings(input: Readonly<{
    context: StandaloneAuditJobBoundContext;
    signal: AbortSignal;
    heartbeat(): void;
    updateProgress: Parameters<StandaloneAuditJobGateway["run"]>[0]["updateProgress"];
  }>): Promise<{
    reportId: string;
    documentId: string;
    data: AuditSuiteListingsData;
  }> {
    const marketplaceId = await this.assertStandaloneAuditContext(
      input.context,
      input.signal,
    );
    const report = await this.standaloneListingReport(input);
    input.updateProgress({
      stage: "listing_rows",
      message: "正在下載並核對 FBA 商品資料。",
      completedUnits: 0,
      totalUnits: 1,
    });
    const data = await this.getSharedAllListingsExportData({
      marketplaceId,
      reportId: report.reportId,
      documentId: report.documentId,
      signal: input.signal,
      onProgress: () => input.heartbeat(),
    });
    await this.assertStandaloneAuditContext(input.context, input.signal);
    input.updateProgress({
      stage: "listing_rows",
      message: `已取得 ${data.rows.length.toLocaleString()} 個 FBA 商品，正在執行健檢。`,
      completedUnits: 1,
      totalUnits: 1,
    });
    return {
      ...report,
      data,
    };
  }

  private async standaloneGrouping(input: Readonly<{
    context: StandaloneAuditJobBoundContext;
    signal: AbortSignal;
    heartbeat(): void;
    updateProgress: Parameters<StandaloneAuditJobGateway["run"]>[0]["updateProgress"];
  }>): Promise<{
    reportId: string;
    documentId: string;
    data: AuditSuiteListingsData;
    grouping: FbaVariationGroupingData;
  }> {
    const listing = await this.standaloneListings(input);
    const marketplaceId = input.context.marketplaceId as MarketplaceId;
    input.updateProgress({
      stage: "relationships",
      message: "正在核對 FBA parent／child relationships。",
      completedUnits: 0,
      totalUnits: null,
    });
    const grouping = await getFbaVariationGroupingData({
      marketplaceId,
      rows: listing.data.rows,
      signal: input.signal,
      onProgress: ({ completedBatches, totalBatches }) => input.updateProgress({
        stage: "relationships",
        message: `正在核對 FBA relationships（${completedBatches}／${totalBatches} 批）。`,
        completedUnits: completedBatches,
        totalUnits: totalBatches,
      }),
    });
    await this.assertStandaloneAuditContext(input.context, input.signal);
    return { ...listing, grouping };
  }

  private async runStandaloneAudit(
    input: Parameters<StandaloneAuditJobGateway["run"]>[0],
  ): Promise<unknown> {
    const marketplaceId = await this.assertStandaloneAuditContext(
      input.context,
      input.signal,
    );
    if (input.kind === "subscription") {
      input.updateProgress({
        stage: "subscription",
        message: "正在核對全站 FBA Subscribe & Save。",
        completedUnits: 0,
        totalUnits: null,
      });
      const snapshot = await getFbaSubscriptionAudit({
        marketplaceId,
        months: input.options.months ?? 6,
        signal: input.signal,
      });
      await this.assertStandaloneAuditContext(input.context, input.signal);
      const exportId = randomUUID();
      this.pruneSubscriptionAuditSnapshots();
      this.subscriptionAuditSnapshots.set(exportId, {
        marketplaceId,
        accountScope: input.context.accountScope,
        expiresAt: Date.now() + SUBSCRIPTION_AUDIT_SNAPSHOT_TTL_MS,
        snapshot: structuredClone(snapshot),
      });
      input.updateProgress({
        stage: "complete",
        message: "Subscribe & Save 健檢完成。",
        completedUnits: snapshot.offers.length,
        totalUnits: snapshot.offers.length,
      });
      return {
        ...snapshot,
        offers: snapshot.offers.map((offer) => ({
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

    if (input.kind === "agedInventory") {
      input.updateProgress({
        stage: "amazon_report",
        message: "Amazon 正在準備 FBA 庫齡報表。",
        completedUnits: 0,
        totalUnits: 1,
      });
      let status = await this.startSharedAgedInventoryReport(marketplaceId, {
        explicitRetry: false,
        signal: input.signal,
      });
      for (let attempt = 0; !status.ready && attempt < 900; attempt += 1) {
        if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
          throw new Error("Amazon 未能產生本次 FBA 庫齡報表。");
        }
        input.heartbeat();
        await waitMilliseconds(2_000, input.signal);
        status = await this.getSharedAgedInventoryReportStatus({
          marketplaceId,
          reportId: status.reportId,
          signal: input.signal,
        });
      }
      if (
        !status.ready ||
        !status.reportId ||
        !status.documentId ||
        status.mode !== input.context.mode
      ) {
        throw new Error("Amazon FBA 庫齡報表未完成或 context 已改變。");
      }
      const snapshot = await this.getSharedAgedInventoryData({
        marketplaceId,
        reportId: status.reportId,
        documentId: status.documentId,
        signal: input.signal,
      });
      await this.assertStandaloneAuditContext(input.context, input.signal);
      input.updateProgress({
        stage: "complete",
        message: "FBA 庫齡健檢完成。",
        completedUnits: snapshot.rows.length,
        totalUnits: snapshot.rows.length,
      });
      return snapshot;
    }

    if (input.kind === "content") {
      const listing = await this.standaloneGrouping(input);
      const groupingBySku = new Map(
        listing.grouping.rows.map((row) => [row.sellerSku, row] as const),
      );
      const audit = auditListingContentRows({
        marketplaceId,
        fetchedAt: listing.data.fetchedAt,
        rows: listing.grouping.rows.filter((row) => row.role !== "parent"),
      });
      const exportId = randomUUID();
      const snapshot = {
        ...audit,
        exportId,
        rows: audit.rows.map((row) => {
          const relationship = groupingBySku.get(row.sellerSku);
          return {
            ...row,
            variationRole: relationship?.role ?? "unknown",
            variationParentSku: relationship?.parentSku ?? null,
            variationFamilyKey: relationship?.familyKey ?? row.sellerSku,
            variationTheme: relationship?.theme ?? null,
            relationshipStatus: relationship?.status ?? "incomplete",
            relationshipMessage: relationship?.message ??
              "Amazon relationships 未與文案列完整對齊；本列不會被猜入任一變體 family。",
          };
        }),
      };
      await this.store.saveContentAuditSnapshotEvidence({
        exportId,
        marketplaceId,
        accountScope: input.context.accountScope,
        mode: input.context.mode,
        fetchedAt: snapshot.fetchedAt,
        rowDigests: snapshot.rows.map((row) =>
          contentAuditSnapshotRowDigest({
            accountScope: input.context.accountScope,
            marketplaceId,
            mode: input.context.mode,
            exportId,
            fetchedAt: snapshot.fetchedAt,
            sellerSku: row.sellerSku,
            asin: row.asin,
            productType: row.productType,
            variationFamilyKey: contentAuditWorkbookFamilyKey(row),
            values: contentAuditRowValues(row),
            readStatus: row.readStatus,
          })),
      });
      input.updateProgress({
        stage: "complete",
        message: "全站文案健檢完成。",
        completedUnits: snapshot.rows.length,
        totalUnits: snapshot.rows.length,
      });
      return snapshot;
    }

    if (input.kind === "image") {
      const listing = await this.standaloneGrouping(input);
      const auditable = new Set(
        listing.grouping.rows
          .filter((row) => row.role !== "parent")
          .map((row) => row.sellerSku),
      );
      const snapshot = auditListingImageRows({
        marketplaceId,
        fetchedAt: listing.data.fetchedAt,
        rows: listing.data.rows
          .filter((row) => auditable.has(row.sellerSku))
          .map((row) => ({
            sellerSku: row.sellerSku,
            asin: row.asin,
            productType: row.productType,
            title: row.title,
            imageUrls: row.imageUrls,
            readStatus: row.readStatus,
            readErrors: row.readErrors,
          })),
        minimumImages: IMAGE_AUDIT_MINIMUM_IMAGES,
      });
      const exportId = randomUUID();
      this.pruneImageAuditSnapshots();
      this.imageAuditSnapshots.set(exportId, {
        marketplaceId,
        accountScope: input.context.accountScope,
        expiresAt: Date.now() + IMAGE_AUDIT_SNAPSHOT_TTL_MS,
        snapshot: structuredClone(snapshot),
      });
      input.updateProgress({
        stage: "complete",
        message: "全站圖片健檢完成。",
        completedUnits: snapshot.rows.length,
        totalUnits: snapshot.rows.length,
      });
      return { ...snapshot, exportId };
    }

    if (input.kind === "variation") {
      const report = await this.standaloneListingReport(input);
      input.updateProgress({
        stage: "relationships",
        message: "正在核對未綁變體與完整變體 family。",
        completedUnits: 0,
        totalUnits: null,
      });
      const snapshot = await this.getSharedUnboundVariationAuditData({
        marketplaceId,
        reportId: report.reportId,
        documentId: report.documentId,
        signal: input.signal,
      });
      await this.assertStandaloneAuditContext(input.context, input.signal);
      const exportId = randomUUID();
      this.pruneUnboundVariationAuditSnapshots();
      this.unboundVariationAuditSnapshots.set(exportId, {
        marketplaceId,
        accountScope: input.context.accountScope,
        expiresAt: Date.now() + UNBOUND_VARIATION_AUDIT_SNAPSHOT_TTL_MS,
        snapshot: structuredClone(snapshot),
      });
      input.updateProgress({
        stage: "complete",
        message: "未綁變體健檢完成。",
        completedUnits: snapshot.allVariationRows.length,
        totalUnits: snapshot.allVariationRows.length,
      });
      return { ...snapshot, exportId };
    }

    if (input.kind === "businessPricing") {
      const report = await this.standaloneListingReport(
        input,
        "business-pricing-audit",
      );
      input.updateProgress({
        stage: "business_pricing",
        message: "正在核對全部 FBA 商品的 B2B 價格與數量折扣。",
        completedUnits: 0,
        totalUnits: null,
      });
      const snapshot = await this.getSharedBusinessPricingAuditData({
        marketplaceId,
        reportId: report.reportId,
        documentId: report.documentId,
        signal: input.signal,
        heartbeat: input.heartbeat,
      });
      await this.assertStandaloneAuditContext(input.context, input.signal);
      input.updateProgress({
        stage: "complete",
        message: "B2B 價格健檢完成。",
        completedUnits: snapshot.rows.length,
        totalUnits: snapshot.rows.length,
      });
      return snapshot;
    }

    if (input.kind === "advertising") {
      const listing = await this.standaloneListings(input);
      if (input.context.mode === "live" && !this.advertising) {
        throw new Error("Amazon Ads API 尚未連線。");
      }
      if (input.context.mode === "live") {
        const summary = await this.advertising!.getCredentialSummary();
        if (!summary.configured) throw new Error("Amazon Ads 憑證尚未完整設定。");
      }
      const listings = prepareAdvertisingCoverageListings({
        rows: listing.data.rows,
        errors: listing.data.errors,
      });
      input.updateProgress({
        stage: "advertising",
        message: "正在核對 FBA 商品與啟用中的 Sponsored Products 活動。",
        completedUnits: 0,
        totalUnits: listings.length,
      });
      const campaigns: AdvertisingCoverageCampaign[] = input.context.mode === "demo"
        ? listings
            .filter((_, index) => index % 2 === 0)
            .map((row, index) => ({
              campaignId: `demo-productai-${index + 1}`,
              name: `[ProductAI] ${MARKETPLACE_CODES[marketplaceId]}-${row.asin}-${row.sellerSku}-SP-PAT-Aug92026`,
              state: "ENABLED",
              adProduct: "SPONSORED_PRODUCTS",
            }))
        : await this.advertising!.listEnabledSponsoredProductCampaigns(
            marketplaceId,
            input.signal,
          );
      await this.assertStandaloneAuditContext(input.context, input.signal);
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

    throw new Error("不支援這個單項健檢種類。");
  }

  private async bindAplusAuditContext(input: Readonly<{
    marketplaceId: string;
    mode: AplusAuditJobMode;
  }>): Promise<AplusAuditJobBoundContext> {
    if (!isMarketplaceId(input.marketplaceId)) {
      throw new AplusAuditJobCoordinatorError("A+ 健檢站點無效。", {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    const current = await this.currentAuditSuiteContext(input.marketplaceId);
    return {
      accountScope: current.accountScope,
      marketplaceId: input.marketplaceId,
      mode: current.mode,
    };
  }

  private async assertAplusAuditContext(
    context: AplusAuditJobBoundContext,
  ): Promise<MarketplaceId> {
    if (!isMarketplaceId(context.marketplaceId)) {
      throw new Error("A+ 健檢工作站點無法安全辨識。");
    }
    const current = await this.currentAuditSuiteContext(context.marketplaceId);
    if (
      current.accountScope !== context.accountScope ||
      current.mode !== context.mode
    ) {
      throw new Error("A+ 健檢工作與目前帳號或展示／真實模式不一致。");
    }
    return context.marketplaceId;
  }

  private async loadAplusAuditFbaSeeds(
    context: AplusAuditJobBoundContext,
    signal: AbortSignal,
    heartbeat: () => void,
  ): Promise<{
    fetchedAt: string;
    fbaSnapshotId: string;
    rows: readonly AplusAuditSeed[];
  }> {
    const marketplaceId = await this.assertAplusAuditContext(context);
    assertBackgroundActive(signal);
    heartbeat();
    let status = await this.startSharedAllListingsReport(
      marketplaceId,
      false,
      signal,
    );
    assertBackgroundActive(signal);
    heartbeat();
    for (let attempt = 0; !status.ready && attempt < 180; attempt += 1) {
      if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
        throw new Error("Amazon 未能產生本次 A+ 健檢所需的 FBA 全商品報表。");
      }
      heartbeat();
      await waitMilliseconds(1_000, signal);
      assertBackgroundActive(signal);
      status = await this.getSharedAllListingsReportStatus({
        marketplaceId,
        reportId: status.reportId,
        signal,
      });
      assertBackgroundActive(signal);
      heartbeat();
    }
    if (
      !status.ready ||
      !status.reportId ||
      !status.documentId ||
      status.mode !== context.mode
    ) {
      throw new Error("A+ 健檢的 FBA 全商品報表未完成或 context 已改變。");
    }
    heartbeat();
    const data = await this.getSharedAllListingsExportData({
      marketplaceId,
      reportId: status.reportId,
      documentId: status.documentId,
      signal,
      onProgress: () => heartbeat(),
    });
    assertBackgroundActive(signal);
    heartbeat();
    const grouping = await getFbaVariationGroupingData({
      marketplaceId,
      rows: data.rows,
      signal,
      onProgress: () => heartbeat(),
    });
    assertBackgroundActive(signal);
    heartbeat();
    await this.assertAplusAuditContext(context);
    assertBackgroundActive(signal);
    heartbeat();
    return {
      fetchedAt: data.fetchedAt,
      fbaSnapshotId: createHash("sha256").update(JSON.stringify([
        context.accountScope,
        marketplaceId,
        status.reportId,
        status.documentId,
        data.fetchedAt,
      ])).digest("hex"),
      rows: buildAplusAuditSeedsFromFbaGrouping(grouping.rows),
    };
  }

  private async fetchAplusAuditPublishRecords(
    context: AplusAuditJobBoundContext,
    request: AplusPublishRecordFetchInput,
    heartbeat: () => void,
  ) {
    let marketplaceId: MarketplaceId;
    try {
      marketplaceId = await this.assertAplusAuditContext(context);
    } catch {
      throw aplusAuditFenceAbort();
    }
    if (request.marketplaceId !== marketplaceId) {
      throw new Error("A+ 健檢 ASIN request 與工作站點不一致。");
    }
    heartbeat();
    const response = await getAplusContentPublishRecordsPage({
      marketplaceId,
      asin: request.asin,
      pageToken: request.pageToken,
      expectedMode: context.mode,
      signal: request.signal,
      onControlledWait: heartbeat,
    });
    heartbeat();
    try {
      await this.assertAplusAuditContext(context);
    } catch {
      throw aplusAuditFenceAbort();
    }
    heartbeat();
    return { status: response.status, payload: response.payload };
  }

  private async fetchAplusAuditContentDocuments(
    context: AplusAuditJobBoundContext,
    request: AplusContentDocumentFetchInput,
    heartbeat: () => void,
  ) {
    let marketplaceId: MarketplaceId;
    try {
      marketplaceId = await this.assertAplusAuditContext(context);
    } catch {
      throw aplusAuditFenceAbort();
    }
    if (request.marketplaceId !== marketplaceId) {
      throw new Error("A+ 文件 request 與工作站點不一致。");
    }
    heartbeat();
    const response = await getAplusContentDocumentsPage({
      marketplaceId,
      pageToken: request.pageToken,
      expectedMode: context.mode,
      signal: request.signal,
      onControlledWait: heartbeat,
    });
    heartbeat();
    try {
      await this.assertAplusAuditContext(context);
    } catch {
      throw aplusAuditFenceAbort();
    }
    heartbeat();
    return {
      status: response.status,
      payload: response.payload,
      requestId: response.requestId,
    };
  }

  private async fetchAplusAuditContentDocumentAsinRelations(
    context: AplusAuditJobBoundContext,
    request: AplusContentDocumentRelationFetchInput,
    heartbeat: () => void,
  ) {
    let marketplaceId: MarketplaceId;
    try {
      marketplaceId = await this.assertAplusAuditContext(context);
    } catch {
      throw aplusAuditFenceAbort();
    }
    if (request.marketplaceId !== marketplaceId) {
      throw new Error("A+ 文件 ASIN 關聯 request 與工作站點不一致。");
    }
    heartbeat();
    const response = await getAplusContentDocumentAsinRelationsPage({
      marketplaceId,
      contentReferenceKey: request.contentReferenceKey,
      pageToken: request.pageToken,
      expectedMode: context.mode,
      signal: request.signal,
      onControlledWait: heartbeat,
    });
    heartbeat();
    try {
      await this.assertAplusAuditContext(context);
    } catch {
      throw aplusAuditFenceAbort();
    }
    heartbeat();
    return {
      status: response.status,
      payload: response.payload,
      requestId: response.requestId,
    };
  }

  private async startAplusAudit(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (
      !body ||
      Object.keys(body).length !== 2 ||
      !("marketplaceId" in body) ||
      !("mode" in body)
    ) {
      return invalid("A+ 健檢只接受 marketplaceId 與 mode；帳號和 FBA 快照由 main process 綁定。");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const mode = body.mode === "live" || body.mode === "demo" ? body.mode : null;
    if (!marketplaceId || !mode) return invalid("A+ 健檢站點或模式無效。");
    try {
      const receipt = await this.aplusAuditJobs.start({ marketplaceId, mode });
      return json(receipt, 202, { "retry-after": "1" });
    } catch (error) {
      return apiError(error, "開始全站 A+ 健檢時發生未預期的錯誤。");
    }
  }

  private async aplusAuditStatus(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const mode = request.query.mode === "live" || request.query.mode === "demo"
      ? request.query.mode
      : null;
    const jobId = this.reportIdentifier(request.query.jobId);
    const contextId = this.reportIdentifier(request.query.contextId);
    if (!marketplaceId || !mode || !jobId || !contextId) {
      return invalid("A+ 健檢工作資訊無效。");
    }
    try {
      const receipt = await this.aplusAuditJobs.get({
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
      return apiError(error, "查詢全站 A+ 健檢進度時發生未預期的錯誤。");
    }
  }

  private auditSuiteRequestIdentity(request: ApiRequest): {
    marketplaceId: MarketplaceId;
    runId: string;
    contextId: string;
  } | null {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const runId = this.reportIdentifier(request.query.runId);
    const contextId = this.reportIdentifier(request.query.contextId);
    return marketplaceId && runId && contextId
      ? { marketplaceId, runId, contextId }
      : null;
  }

  private async currentAuditSuiteContext(marketplaceId: MarketplaceId): Promise<{
    accountScope: string;
    mode: "live" | "demo";
  }> {
    const context = await this.spExecutionContext.capture(marketplaceId);
    return {
      accountScope: context.accountScope,
      mode: context.mode,
    };
  }

  private async startAuditSuite(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body || Object.keys(body).length !== 1 || !("marketplaceId" in body)) {
      return invalid("綜合健檢只接受 marketplaceId；帳號、模式與快照由 main process 綁定。");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    if (!marketplaceId) return invalid("請選擇支援的 Amazon 站點。");
    const context = await this.currentAuditSuiteContext(marketplaceId);
    const started = this.auditSuite.start({ marketplaceId, ...context });
    return json(started.run, 202, { "retry-after": "1" });
  }

  private async auditSuiteStatus(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.auditSuiteRequestIdentity(request);
    if (!identity) return invalid("綜合健檢工作資訊無效。");
    const context = await this.currentAuditSuiteContext(identity.marketplaceId);
    return json(this.auditSuite.get({ ...identity, ...context }));
  }

  private async auditSuiteExport(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.auditSuiteRequestIdentity(request);
    if (!identity) return invalid("綜合健檢 Excel 工作資訊無效。");
    const context = await this.currentAuditSuiteContext(identity.marketplaceId);
    const marketplace = MARKETPLACES[identity.marketplaceId];
    const input = this.auditSuite.workbookInput({
      ...identity,
      ...context,
      marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
    });
    const workbook = createAuditSuiteWorkbook(input);
    const filename = `amazon-fba-audit-suite-${marketplace.shortLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return bytes(
      workbook,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { "content-disposition": `attachment; filename="${filename}"` },
    );
  }

  private async assertAuditSuiteContext(context: AuditSuiteContext): Promise<void> {
    const current = await this.currentAuditSuiteContext(context.marketplaceId as MarketplaceId);
    if (current.accountScope !== context.accountScope) {
      throw new Error("Amazon 帳號範圍已改變，本次綜合健檢已停止。");
    }
    if (current.mode !== context.mode) {
      throw new Error("App 展示／真實模式已改變，本次綜合健檢已停止。");
    }
  }

  private auditSuiteListings(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): Promise<{
    reportId: string;
    documentId: string;
    data: AuditSuiteListingsData;
  }> {
    return control.resource(AUDIT_SUITE_LISTINGS_RESOURCE, async () => {
      const marketplaceId = context.marketplaceId as MarketplaceId;
      assertAuditSuiteActive(control);
      await this.assertAuditSuiteContext(context);
      assertAuditSuiteActive(control);
      let status = await this.startSharedAllListingsReport(
        marketplaceId,
        false,
        control.signal,
      );
      assertAuditSuiteActive(control);
      for (let attempt = 0; !status.ready && attempt < 180; attempt += 1) {
        if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
          throw new Error("Amazon 未能產生本次共用 FBA 全商品報表。");
        }
        control.heartbeat({
          message: "Amazon 正在準備本次共用 FBA 全商品報表。",
          completedUnits: 0,
          totalUnits: 1,
        });
        await waitMilliseconds(1_000, control.signal);
        assertAuditSuiteActive(control);
        status = await this.getSharedAllListingsReportStatus({
          marketplaceId,
          reportId: status.reportId,
          signal: control.signal,
        });
        assertAuditSuiteActive(control);
      }
      if (!status.ready || !status.reportId || !status.documentId) {
        throw new Error("Amazon FBA 全商品報表等待逾時；未建立假快照。");
      }
      if (status.mode !== context.mode) {
        throw new Error("FBA 全商品報表與綜合健檢模式不一致。");
      }
      const data = await this.getSharedAllListingsExportData({
        marketplaceId,
        reportId: status.reportId,
        documentId: status.documentId,
        signal: control.signal,
      });
      assertAuditSuiteActive(control);
      await this.assertAuditSuiteContext(context);
      assertAuditSuiteActive(control);
      control.heartbeat({
        message: "本次共用 FBA 全商品報表已完成。",
        completedUnits: 1,
        totalUnits: 1,
      });
      return { reportId: status.reportId, documentId: status.documentId, data };
    });
  }

  private auditSuiteFbaGrouping(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): Promise<{
    reportId: string;
    documentId: string;
    data: AuditSuiteListingsData;
    grouping: FbaVariationGroupingData;
  }> {
    return control.resource(AUDIT_SUITE_FBA_GROUPING_RESOURCE, async () => {
      const listing = await this.auditSuiteListings(context, control);
      assertAuditSuiteActive(control);
      const marketplaceId = context.marketplaceId as MarketplaceId;
      const grouping = await getFbaVariationGroupingData({
        marketplaceId,
        rows: listing.data.rows,
        signal: control.signal,
        onProgress: ({ completedBatches, totalBatches }) => control.heartbeat({
          message: `正在核對 FBA relationships（${completedBatches}／${totalBatches} 批）。`,
        }),
      });
      assertAuditSuiteActive(control);
      await this.assertAuditSuiteContext(context);
      assertAuditSuiteActive(control);
      if (grouping.marketplaceId !== marketplaceId) {
        throw new Error("FBA relationships 與綜合健檢站點不一致。");
      }
      return { ...listing, grouping };
    });
  }

  private async runAuditSuiteSubscription(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const marketplaceId = context.marketplaceId as MarketplaceId;
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    const snapshot = await getFbaSubscriptionAudit({
      marketplaceId,
      months: 6,
      signal: control.signal,
    });
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    if (snapshot.mode !== context.mode || snapshot.marketplaceId !== marketplaceId) {
      throw new Error("訂閱健檢快照與本次綜合健檢 context 不一致。");
    }
    const rows = buildSubscriptionAuditSuiteRows(snapshot);
    const partial = snapshot.inventoryEvidence.coverage !== "complete" ||
      snapshot.upstreamCoverage.status !== "complete" ||
      snapshot.summary.revenueCoverage.status !== "complete";
    return suiteSnapshot({
      context,
      status: partial ? "partial" : "completed",
      fetchedAt: snapshot.fetchedAt,
      notice: partial ? `訂閱資料範圍未完整。${snapshot.notice}` : snapshot.notice,
      payload: rows,
    });
  }

  private async runAuditSuiteContent(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const { data } = await this.auditSuiteListings(context, control);
    const audit = auditListingContentRows({
      marketplaceId: context.marketplaceId,
      fetchedAt: data.fetchedAt,
      rows: data.rows,
    });
    const fieldLabel = {
      title: "產品名稱",
      itemHighlight: "產品亮點",
      bulletPoints: "產品要點",
      productDescription: "產品敘述",
      ingredients: "成分",
    } as const;
    const rows = audit.rows.flatMap((row) => row.issues.map((issue) => ({
      sellerSku: row.sellerSku,
      title: row.title,
      asin: row.asin,
      problemType: issue.kind === "SUSPECTED_TYPO" ? "疑似錯字" : issue.message,
      field: fieldLabel[issue.field],
      originalText: issue.field === "title"
        ? row.title
        : issue.field === "itemHighlight"
          ? row.itemHighlight
          : issue.field === "bulletPoints"
            ? issue.bulletIndex === undefined
              ? row.bulletPoints.join("\n")
              : row.bulletPoints[issue.bulletIndex] ?? ""
            : issue.field === "productDescription"
              ? row.productDescription
              : row.ingredients,
      description: issue.suggestion ? `${issue.message} 建議：${issue.suggestion}` : issue.message,
    })));
    const scopeNotice = audit.summary.incomplete
      ? `另有 ${audit.summary.incomplete} 個 SKU 文案讀取未完成；未知不視為無問題。`
      : "Amazon 基礎文案欄位已完成讀取。";
    return suiteSnapshot({
      context,
      status: "partial",
      fetchedAt: audit.fetchedAt,
      notice: `${scopeNotice} 本機字典錯字結果需個別文案健檢補充`,
      payload: rows,
    });
  }

  private async runAuditSuiteImage(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const { data } = await this.auditSuiteListings(context, control);
    const audit = auditListingImageRows({
      marketplaceId: context.marketplaceId,
      fetchedAt: data.fetchedAt,
      rows: data.rows,
      minimumImages: IMAGE_AUDIT_MINIMUM_IMAGES,
    });
    const rows = audit.rows
      .filter((row) => row.readStatus === "incomplete" || row.imageCount < audit.minimumImages)
      .map((row) => ({
        sellerSku: row.sellerSku,
        title: row.title,
        asin: row.asin,
        imageCount: row.readStatus === "complete" ? row.imageCount : null,
        finding: row.readStatus === "complete" ? `少於 ${audit.minimumImages} 張` : "讀取未完成",
        notice: row.readErrors.map((error) => error.message).join("；") ||
          `已核對圖片 ${row.imageCount} 張。`,
      }));
    return suiteSnapshot({
      context,
      status: audit.summary.incomplete ? "partial" : "completed",
      fetchedAt: audit.fetchedAt,
      notice: audit.summary.incomplete
        ? `${audit.summary.incomplete} 個 SKU 圖片讀取未完成；圖片數保持未知。`
        : `已核對 ${audit.summary.total} 個 FBA SKU 的圖片數。`,
      payload: rows,
    });
  }

  private async runAuditSuiteAplus(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const marketplaceId = context.marketplaceId as MarketplaceId;
    const listing = await this.auditSuiteFbaGrouping(context, control);
    const fbaSnapshotId = createHash("sha256").update(JSON.stringify([
      context.accountScope,
      marketplaceId,
      listing.reportId,
      listing.documentId,
      listing.data.fetchedAt,
    ])).digest("hex");
    const snapshot = await runAplusAudit({
      mode: context.mode,
      marketplaceId,
      fetchedAt: listing.data.fetchedAt,
      fbaSnapshotId,
      rows: buildAplusAuditSeedsFromFbaGrouping(listing.grouping.rows),
      signal: control.signal,
      fetchPublishRecords: async (request) => {
        assertAuditSuiteActive(control);
        try {
          await this.assertAuditSuiteContext(context);
        } catch {
          throw aplusAuditFenceAbort();
        }
        assertAuditSuiteActive(control);
        if (request.marketplaceId !== marketplaceId) {
          throw new Error("A+ 健檢 request 與綜合健檢站點不一致。");
        }
        const response = await getAplusContentPublishRecordsPage({
          marketplaceId,
          asin: request.asin,
          pageToken: request.pageToken,
          expectedMode: context.mode,
          signal: request.signal,
          onControlledWait: () => control.heartbeat({
            message: "Amazon A+ API 要求延後重試；Notebook 鑰匙仍在受控等待。",
          }),
        });
        assertAuditSuiteActive(control);
        try {
          await this.assertAuditSuiteContext(context);
        } catch {
          throw aplusAuditFenceAbort();
        }
        return { status: response.status, payload: response.payload };
      },
      fetchContentDocuments: async (request) => {
        assertAuditSuiteActive(control);
        try {
          await this.assertAuditSuiteContext(context);
        } catch {
          throw aplusAuditFenceAbort();
        }
        if (request.marketplaceId !== marketplaceId) {
          throw new Error("A+ 文件 request 與綜合健檢站點不一致。");
        }
        const response = await getAplusContentDocumentsPage({
          marketplaceId,
          pageToken: request.pageToken,
          expectedMode: context.mode,
          signal: request.signal,
          onControlledWait: () => control.heartbeat({
            message: "Amazon A+ API 要求延後文件讀取；Notebook 鑰匙仍在受控等待。",
          }),
        });
        assertAuditSuiteActive(control);
        try {
          await this.assertAuditSuiteContext(context);
        } catch {
          throw aplusAuditFenceAbort();
        }
        return {
          status: response.status,
          payload: response.payload,
          requestId: response.requestId,
        };
      },
      fetchContentDocumentAsinRelations: async (request) => {
        assertAuditSuiteActive(control);
        try {
          await this.assertAuditSuiteContext(context);
        } catch {
          throw aplusAuditFenceAbort();
        }
        if (request.marketplaceId !== marketplaceId) {
          throw new Error("A+ 文件 ASIN 關聯 request 與綜合健檢站點不一致。");
        }
        const response = await getAplusContentDocumentAsinRelationsPage({
          marketplaceId,
          contentReferenceKey: request.contentReferenceKey,
          pageToken: request.pageToken,
          expectedMode: context.mode,
          signal: request.signal,
          onControlledWait: () => control.heartbeat({
            message: "Amazon A+ API 要求延後關聯讀取；Notebook 鑰匙仍在受控等待。",
          }),
        });
        assertAuditSuiteActive(control);
        try {
          await this.assertAuditSuiteContext(context);
        } catch {
          throw aplusAuditFenceAbort();
        }
        return {
          status: response.status,
          payload: response.payload,
          requestId: response.requestId,
        };
      },
      onProgress: (progress) => control.heartbeat({
        message: `正在核對 A+ publish records（${progress.completedAsins}／${progress.totalAsins} ASIN）。`,
        completedUnits: progress.completedAsins,
        totalUnits: progress.totalAsins,
      }),
    });
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    if (snapshot.mode !== context.mode || snapshot.marketplaceId !== marketplaceId) {
      throw new Error("A+ 健檢快照與本次綜合健檢 context 不一致。");
    }
    const result = buildAplusAuditSuiteResult(snapshot);
    return suiteSnapshot({
      context,
      ...result,
    });
  }

  private async runAuditSuiteVariation(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const marketplaceId = context.marketplaceId as MarketplaceId;
    const listing = await this.auditSuiteFbaGrouping(context, control);
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    const incompleteRows = listing.grouping.rows.filter((row) =>
      row.status === "incomplete"
    );
    const rows = listing.grouping.rows.filter((row) =>
      row.status === "complete" && row.role === "standalone"
    );
    return suiteSnapshot({
      context,
      status: incompleteRows.length ? "partial" : "completed",
      fetchedAt: listing.grouping.fetchedAt,
      notice: incompleteRows.length
        ? `${incompleteRows.length} 個 SKU relationships 無法安全判定；只列已驗證未綁變體。${listing.grouping.notice}`
        : listing.grouping.notice,
      payload: rows.map((row) => ({
        sellerSku: row.sellerSku,
        title: row.title,
        asin: row.asin,
        productType: row.productType,
        notice: row.message,
      })),
    });
  }

  private async runAuditSuiteBusinessPricing(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const marketplaceId = context.marketplaceId as MarketplaceId;
    control.heartbeat({
      message: "Amazon 正在準備 B2B 健檢所需的全商品與 Active Listings 報表。",
    });
    await this.startSharedAllListingsReport(
      marketplaceId,
      false,
      control.signal,
      { purpose: "business-pricing-audit" },
    );
    assertAuditSuiteActive(control);
    const listing = await this.auditSuiteListings(context, control);
    assertAuditSuiteActive(control);
    const snapshot = await this.getSharedBusinessPricingAuditData({
      marketplaceId,
      reportId: listing.reportId,
      documentId: listing.documentId,
      signal: control.signal,
      heartbeat: () => control.heartbeat({
        message: "Amazon 正在讀取既有 Active Listings Business Price 報表。",
      }),
    });
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    if (snapshot.mode !== context.mode || snapshot.marketplaceId !== marketplaceId) {
      throw new Error("B2B 價格健檢快照與本次綜合健檢 context 不一致。");
    }
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
    return suiteSnapshot({
      context,
      status: snapshot.summary.incomplete ? "partial" : "completed",
      fetchedAt: snapshot.fetchedAt,
      notice: snapshot.notice,
      payload: rows,
    });
  }

  private async runAuditSuiteAdvertising(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const marketplaceId = context.marketplaceId as MarketplaceId;
    if (context.mode !== "live") {
      throw new Error("廣告覆蓋需已驗證的真實 Amazon Ads 連線；綜合健檢不以 demo 活動冒充結果。");
    }
    if (!this.advertising) {
      throw new Error("Amazon Ads API 尚未連線；未用 demo 或 0 冒充廣告覆蓋。");
    }
    assertAuditSuiteActive(control);
    const summary = await this.advertising.getCredentialSummary();
    assertAuditSuiteActive(control);
    if (!summary.configured) {
      throw new Error("Amazon Ads 憑證尚未完整設定；廣告覆蓋未執行。");
    }
    const listing = await this.auditSuiteListings(context, control);
    assertAuditSuiteActive(control);
    const campaigns = await this.advertising.listEnabledSponsoredProductCampaigns(
      marketplaceId,
      control.signal,
    );
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    const result = buildAdvertisingAuditSuiteResult({
      marketplaceId,
      marketplaceCode: MARKETPLACE_CODES[marketplaceId],
      source: listing.data,
      campaigns,
    });
    return suiteSnapshot({
      context,
      ...result,
    });
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
      job.state !== "running" ||
      job.controller.signal.aborted ||
      this.advertisingStrategyJobs.get(job.jobId) !== job
    ) {
      return;
    }
    job.expiresAt = Date.now() + ADVERTISING_STRATEGY_ACTIVE_TTL_MS;
  }

  private retainAdvertisingStrategyJob(
    job: AdvertisingStrategyJob,
    ttl = ADVERTISING_STRATEGY_TERMINAL_TTL_MS,
  ): void {
    if (this.advertisingStrategyJobs.get(job.jobId) !== job || job.state === "running") {
      return;
    }
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    const expiresAt = Date.now() + ttl;
    job.expiresAt = expiresAt;
    job.expiryTimer = setTimeout(() => {
      if (
        this.advertisingStrategyJobs.get(job.jobId) === job &&
        job.state !== "running" &&
        job.expiresAt === expiresAt &&
        job.expiresAt <= Date.now()
      ) {
        this.removeAdvertisingStrategyJob(job.jobId);
      }
    }, ttl);
    job.expiryTimer.unref?.();
  }

  private pruneAdvertisingStrategyJobs(now = Date.now()): void {
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

  private async advertisingCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AdvertisingApiError) {
        throw new SpApiError(error.message, {
          status: error.status,
          code: error.status >= 500 ? "UPSTREAM_UNAVAILABLE" : error.code,
          requestId: error.requestId,
        });
      }
      throw error;
    }
  }

  private parseAdvertisingStrategyRange(input: {
    marketplaceId: MarketplaceId;
    startDate: unknown;
    endDate: unknown;
  }): { startDate: string; endDate: string } {
    const startDate = optionalDate(input.startDate);
    const endDate = optionalDate(input.endDate);
    if (typeof startDate !== "string" || typeof endDate !== "string") {
      throw new SpApiError("請提供有效的廣告策略開始日與結束日。", {
        status: 400,
        code: "ADS_STRATEGY_DATE_INVALID",
      });
    }
    const calendar = marketplaceCalendar(input.marketplaceId);
    const inclusiveDays = calendar.inclusiveDayCount(startDate, endDate);
    const today = calendar.dayAt(new Date(Date.now()));
    const latest = calendar.shiftDate(today, -1);
    const earliest = calendar.shiftDate(latest, -94);
    if (
      startDate > endDate ||
      inclusiveDays < 1 ||
      inclusiveDays > 31 ||
      endDate > latest ||
      startDate < earliest
    ) {
      throw new SpApiError(
        "廣告策略一次只能讀取最近 95 天內的 1 到 31 個完整日，結束日最多到站點昨天。",
        { status: 400, code: "ADS_STRATEGY_DATE_INVALID" },
      );
    }
    return { startDate, endDate };
  }

  private advertisedProductIdentity(job: AdvertisingStrategyJob): DurableReportIdentity {
    return {
      // The Ads client folds the Ads vault, SP account and exact Seller Profile
      // into a fixed-size scope. Derive a separate lifecycle key so LocalStore
      // never receives credential material or a raw Profile identifier.
      accountScope: stableFingerprint(["ads-strategy", job.adsAccountScope]),
      marketplaceId: job.marketplaceId,
      mode: job.mode,
      reportType: "ADS_SP_ADVERTISED_PRODUCT",
      optionsKey: `reportTypeId=spAdvertisedProduct;timeUnit=SUMMARY;version=1;start=${job.startDate};end=${job.endDate}`,
    };
  }

  private advertisedProductReference(
    job: AdvertisingStrategyJob,
    reportId: string,
  ): SponsoredProductsAdvertisedProductReportReference {
    return {
      reportId,
      marketplaceId: job.marketplaceId,
      combinedAccountScope: job.adsAccountScope,
      startDate: job.startDate,
      endDate: job.endDate,
      configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
    };
  }

  private async assertAdvertisingStrategyContext(
    job: AdvertisingStrategyJob,
    signal?: AbortSignal,
  ): Promise<void> {
    assertBackgroundActive(signal);
    const gateway = this.advertisingStrategyGateway();
    const mode = usesDemoMode(job.marketplaceId) ? "demo" : "live";
    const [spAccountScope, adsIdentity] = await Promise.all([
      this.vault.getAccountScope(MARKETPLACES[job.marketplaceId].region),
      this.advertisingCall(() =>
        gateway.getCombinedAccountIdentity(job.marketplaceId, signal)),
    ]);
    assertBackgroundActive(signal);
    if (
      mode !== job.mode ||
      spAccountScope !== job.spAccountScope ||
      adsIdentity.combinedAccountScope !== job.adsAccountScope ||
      adsIdentity.adsProfileFingerprint !== job.adsProfileFingerprint
    ) {
      throw new SpApiError("廣告策略工作與目前 SP-API／Ads 帳號或模式不一致。", {
        status: 409,
        code: "ADS_STRATEGY_CONTEXT_CHANGED",
      });
    }
  }

  private async startSalesAndTrafficStrategyReport(
    job: AdvertisingStrategyJob,
    input: { refresh: boolean; explicitRetry: boolean },
  ): Promise<DurableReportStatus> {
    return this.reportsRuntime.start(
      {
        intent: "sales-and-traffic-daily-sku",
        marketplaceId: job.marketplaceId,
        startDate: job.startDate,
        endDate: job.endDate,
        signal: job.controller.signal,
      },
      {
        explicitRetry: input.explicitRetry,
        freshCompleted: input.refresh,
      },
    );
  }

  private async startAdvertisedProductStrategyReport(
    job: AdvertisingStrategyJob,
    input: { refresh: boolean; explicitRetry: boolean },
  ): Promise<DurableReportStatus> {
    const gateway = this.advertisingStrategyGateway();
    return this.reportLifecycle.start({
      identity: this.advertisedProductIdentity(job),
      explicitRetry: input.explicitRetry,
      freshCompleted: input.refresh,
      signal: job.controller.signal,
      create: async ({ signal }): Promise<DurableReportGatewayStatus> => {
        const reference = await this.advertisingCall(() =>
          gateway.createSponsoredProductsAdvertisedProductReport({
            marketplaceId: job.marketplaceId,
            startDate: job.startDate,
            endDate: job.endDate,
            signal,
          }));
        if (
          reference.combinedAccountScope !== job.adsAccountScope ||
          reference.marketplaceId !== job.marketplaceId ||
          reference.startDate !== job.startDate ||
          reference.endDate !== job.endDate
        ) {
          throw new SpApiError("Amazon Ads 報表 context 不一致，已停止。", {
            status: 409,
            code: "REPORT_MISMATCH",
          });
        }
        return {
          mode: "live",
          ready: false,
          reportId: reference.reportId,
          documentId: null,
          status: "IN_QUEUE",
          notice: "Amazon Ads 正在準備 Sponsored Products 商品報表。",
        };
      },
      notices: {
        pending: "Amazon Ads 正在準備 Sponsored Products 商品報表。",
        done: "Amazon Ads Sponsored Products 商品報表已就緒。",
      },
    });
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
      status = await this.getSharedAllListingsReportStatus({
        marketplaceId: job.marketplaceId,
        reportId: status.reportId,
        signal: job.controller.signal,
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
      status = await this.reportsRuntime.status(
        {
          intent: "sales-and-traffic-daily-sku",
          marketplaceId: job.marketplaceId,
          startDate: job.startDate,
          endDate: job.endDate,
          signal: job.controller.signal,
        },
        status.reportId,
      );
      this.touchAdvertisingStrategyJob(job);
    }
    if (!status.ready || !status.documentId) {
      throw new SpApiError("Amazon SKU 銷售與流量報表仍在準備中。", {
        status: 504,
        code: "REPORT_PENDING",
      });
    }
    await this.assertAdvertisingStrategyContext(job, job.controller.signal);
    const plan = {
      intent: "sales-and-traffic-daily-sku" as const,
      marketplaceId: job.marketplaceId,
      startDate: job.startDate,
      endDate: job.endDate,
      signal: job.controller.signal,
    };
    const document = await this.reportsRuntime.readDocument(
      plan,
      { reportId: status.reportId, documentId: status.documentId },
    );
    return this.salesAndTrafficReports.dataFromDocument({
      marketplaceId: job.marketplaceId,
      mode: document.mode,
      startDate: job.startDate,
      endDate: job.endDate,
      document: document.text,
      signal: job.controller.signal,
    });
  }

  private async waitForStrategyAds(
    job: AdvertisingStrategyJob,
    initial: DurableReportStatus,
  ): Promise<SponsoredProductsAdvertisedProductReport> {
    const gateway = this.advertisingStrategyGateway();
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
      status = await this.reportLifecycle.status({
        identity: this.advertisedProductIdentity(job),
        reportId: status.reportId,
        signal: job.controller.signal,
        poll: async ({ reportId, signal }): Promise<DurableReportGatewayStatus> => {
          const result = await this.advertisingCall(() =>
            gateway.getSponsoredProductsAdvertisedProductReportStatus(
              this.advertisedProductReference(job, reportId),
              signal,
            ));
          const mappedStatus = result.status === "PENDING"
            ? "IN_QUEUE"
            : result.status === "PROCESSING"
              ? "IN_PROGRESS"
              : result.status === "COMPLETED"
                ? "DONE"
                : "FATAL";
          return {
            mode: "live",
            ready: mappedStatus === "DONE",
            reportId,
            documentId: mappedStatus === "DONE" ? reportId : null,
            status: mappedStatus,
            notice: mappedStatus === "DONE"
              ? "Amazon Ads Sponsored Products 商品報表已就緒。"
              : "Amazon Ads 正在準備 Sponsored Products 商品報表。",
          };
        },
        notices: {
          pending: "Amazon Ads 正在準備 Sponsored Products 商品報表。",
          done: "Amazon Ads Sponsored Products 商品報表已就緒。",
        },
      });
      this.touchAdvertisingStrategyJob(job);
    }
    if (!status.ready) {
      throw new SpApiError("Amazon Ads Sponsored Products 商品報表仍在準備中。", {
        status: 504,
        code: "REPORT_PENDING",
      });
    }
    await this.assertAdvertisingStrategyContext(job, job.controller.signal);
    return this.advertisingCall(() =>
      gateway.downloadSponsoredProductsAdvertisedProductReport(
        this.advertisedProductReference(job, status.reportId),
        job.controller.signal,
      ));
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
        this.startSharedAllListingsReport(
          job.marketplaceId,
          input.explicitRetry,
          signal,
          { freshCompleted: input.refresh },
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
      const adsFetchedAt = new Date().toISOString();
      await this.assertAdvertisingStrategyContext(job, signal);
      job.progress = { phase: "building", completed: 3, total: 4 };
      job.notice = "三份唯讀來源已完成；正在套用可見的 T1–T4 預設規則。";
      this.touchAdvertisingStrategyJob(job);

      const snapshot = buildAdvertisingStrategySnapshot({
        marketplaceId: job.marketplaceId,
        marketplaceCode: job.marketplaceCode,
        dateRange: { startDate: job.startDate, endDate: job.endDate },
        currencyCode: MARKETPLACES[job.marketplaceId].currency,
        fetchedAt: new Date().toISOString(),
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
          currencyCode: MARKETPLACES[job.marketplaceId].currency,
        })),
      });
      await this.assertAdvertisingStrategyContext(job, signal);
      if (this.advertisingStrategyJobs.get(job.jobId) !== job) return;
      job.snapshot = snapshot;
      job.state = "completed";
      job.progress = { phase: "building", completed: 4, total: 4 };
      job.notice = "FBA 廣告策略表已完成；SB／SD 與規格欄位保留人工決策，不會自動寫回 Amazon。";
      job.errorCode = null;
      this.retainAdvertisingStrategyJob(job);
    } catch (error) {
      if (this.advertisingStrategyJobs.get(job.jobId) !== job) return;
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

  private async startAdvertisingStrategy(request: ApiRequest): Promise<ApiResponse> {
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
      return apiError(error, "廣告策略日期無效。");
    }
    if (usesDemoMode(marketplaceId)) {
      return invalid(
        "展示模式不會產生看似真實的 FBA 廣告策略表。",
        422,
        "ADS_STRATEGY_LIVE_REQUIRED",
      );
    }

    this.pruneAdvertisingStrategyJobs();
    const gateway = this.advertisingStrategyGateway();
    const [spAccountScope, adsIdentity] = await Promise.all([
      this.vault.getAccountScope(MARKETPLACES[marketplaceId].region),
      this.advertisingCall(() =>
        gateway.getCombinedAccountIdentity(
          marketplaceId,
          undefined,
          { refreshProfile: true },
        )),
    ]);
    const adsAccountScope = adsIdentity.combinedAccountScope;
    const selection = stableFingerprint({
      spAccountScope,
      adsAccountScope,
      adsProfileFingerprint: adsIdentity.adsProfileFingerprint,
      marketplaceId,
      startDate: range.startDate,
      endDate: range.endDate,
    });
    const existingId = this.advertisingStrategySelections.get(selection);
    const existing = existingId ? this.advertisingStrategyJobs.get(existingId) : null;
    if (existing?.state === "running" && existing.expiresAt > Date.now()) {
      return this.advertisingStrategyReply(existing);
    }
    if (explicitRetry && !(
      existing?.state === "failed" &&
      (existing.errorCode === "REPORT_RETRY_REQUIRED" || existing.errorCode === "REPORT_RETRY_WAIT") &&
      existing.expiresAt > Date.now()
    )) {
      return invalid(
        "目前沒有同帳號、站點與日期範圍的報表重試資格。",
        409,
        "REPORT_RETRY_NOT_ALLOWED",
      );
    }
    if (existing && !refresh) return this.advertisingStrategyReply(existing);
    if (existing) this.removeAdvertisingStrategyJob(existing.jobId);
    for (const candidate of [...this.advertisingStrategyJobs.values()]) {
      if (candidate.marketplaceId !== marketplaceId) continue;
      if (candidate.state === "running") {
        candidate.controller.abort(new Error("同一站點已改用新的廣告策略日期範圍。"));
      }
      this.removeAdvertisingStrategyJob(candidate.jobId);
    }

    const job: AdvertisingStrategyJob = {
      jobId: randomUUID(),
      marketplaceId,
      marketplaceCode: MARKETPLACE_CODES[marketplaceId],
      spAccountScope,
      adsAccountScope,
      adsProfileFingerprint: adsIdentity.adsProfileFingerprint,
      mode: "live",
      startDate: range.startDate,
      endDate: range.endDate,
      state: "running",
      progress: { phase: "fba", completed: 0, total: 4 },
      notice: "正在建立三份唯讀資料來源；你可以關閉這個面板或先使用其他功能。",
      errorCode: null,
      snapshot: null,
      controller: new AbortController(),
      expiresAt: Date.now() + ADVERTISING_STRATEGY_ACTIVE_TTL_MS,
      expiryTimer: null,
      flight: null,
    };
    this.advertisingStrategyJobs.set(job.jobId, job);
    this.advertisingStrategySelections.set(selection, job.jobId);
    job.flight = this.runAdvertisingStrategyJob(job, { refresh, explicitRetry }).finally(() => {
      job.flight = null;
    });
    void job.flight;
    return this.advertisingStrategyReply(job);
  }

  private async advertisingStrategyStatus(request: ApiRequest): Promise<ApiResponse> {
    const allowedKeys = new Set(["marketplaceId", "jobId", "startDate", "endDate"]);
    if (Object.keys(request.query).some((key) => !allowedKeys.has(key))) {
      return invalid("廣告策略工作查詢包含不支援的欄位。");
    }
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = this.reportIdentifier(request.query.jobId);
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
      await this.assertAdvertisingStrategyContext(job);
    } catch {
      job.controller.abort(new Error("廣告策略工作 context 已變更。"));
      this.removeAdvertisingStrategyJob(job.jobId);
      return invalid(
        "廣告策略工作不屬於目前 SP-API／Ads 帳號、站點或模式。",
        409,
        "JOB_MISMATCH",
      );
    }
    return this.advertisingStrategyReply(job);
  }

  private async adsStatus(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon Ads 站點。");
    const demo = usesDemoMode(marketplaceId);
    const summary = demo || !this.advertising
      ? null
      : await this.advertising.getCredentialSummary();
    let verification: AdvertisingConnectionTestResult | null = null;
    if (!demo && summary?.configured && this.advertising) {
      verification = await this.advertising.probeMarketplace(marketplaceId);
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

  private async adsCoverage(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon Ads 站點。");
    const demo = usesDemoMode(marketplaceId);
    if (!demo && !this.advertising) {
      return invalid(
        "Amazon Ads API 尚未連線；廣告覆蓋健檢已備妥，但不會用展示活動冒充真實資料。",
        422,
        "ADS_API_NOT_CONNECTED",
      );
    }
    try {
      let reportId: string;
      let documentId: string;
      if (demo) {
        const status = await this.startSharedAllListingsReport(
          marketplaceId,
          false,
        );
        if (
          status.mode !== "demo" ||
          !status.ready ||
          !status.reportId ||
          !status.documentId
        ) {
          return invalid(
            "展示用 FBA 全商品報表尚未完成。",
            409,
            "REPORT_NOT_READY",
          );
        }
        reportId = status.reportId;
        documentId = status.documentId;
      } else {
        const summary = await this.advertising!.getCredentialSummary();
        if (!summary.configured) {
          return invalid(
            "Amazon Ads 憑證尚未完整設定。",
            422,
            "ADS_API_NOT_CONNECTED",
          );
        }
        let status = await this.startSharedAllListingsReport(marketplaceId, true);
        if (!status.ready && status.reportId) {
          status = await this.getSharedAllListingsReportStatus({
            marketplaceId,
            reportId: status.reportId,
          });
        }
        if (status.mode !== "live") {
          return invalid(
            "全商品報表模式與 Ads 真實健檢不一致。",
            409,
            "REPORT_MODE_CHANGED",
          );
        }
        if (!status.ready || !status.reportId || !status.documentId) {
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
        reportId = status.reportId;
        documentId = status.documentId;
      }
      const data = await this.getSharedAllListingsExportData({
        marketplaceId,
        reportId,
        documentId,
      });
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
        : await this.advertising!.listEnabledSponsoredProductCampaigns(marketplaceId);
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
      return apiError(error, "執行 Amazon Ads 覆蓋健檢時發生未預期錯誤。");
    }
  }

  private async scopedFingerprint(
    marketplaceId: MarketplaceId,
    operationFingerprint: string,
  ): Promise<{ accountScope: string; fingerprint: string }> {
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    return {
      accountScope,
      fingerprint: stableFingerprint([accountScope, operationFingerprint]),
    };
  }

  private reserveListingAttributeWrites(
    marketplaceId: MarketplaceId,
    sellerSkus: readonly string[],
    ownerToken: string,
  ): ApiResponse | null {
    const keys = sellerSkus.map((sellerSku) => `${marketplaceId}\u0000${sellerSku}`);
    if (new Set(keys).size !== keys.length) {
      return invalid(
        "批次包含重複 SKU，已停止送出。",
        409,
        "IDEMPOTENCY_CONFLICT",
      );
    }
    if (keys.some((key) => this.listingAttributeWriteReservations.has(key))) {
      return invalid(
        "同一 SKU 的商品內容或圖片正在處理，系統已阻止重疊送出。",
        409,
        "OPERATION_IN_PROGRESS",
      );
    }
    keys.forEach((key) => this.listingAttributeWriteReservations.set(key, ownerToken));
    return null;
  }

  private releaseListingAttributeWrites(
    marketplaceId: MarketplaceId,
    sellerSkus: readonly string[],
    ownerToken: string,
  ): void {
    for (const sellerSku of sellerSkus) {
      const key = `${marketplaceId}\u0000${sellerSku}`;
      if (this.listingAttributeWriteReservations.get(key) === ownerToken) {
        this.listingAttributeWriteReservations.delete(key);
      }
    }
  }

  private async reconcilePriceWrites(snapshot: ListingPriceSnapshot): Promise<void> {
    try {
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[snapshot.marketplaceId].region,
      );
      await this.store.reconcileIdempotentOperations({
        operationTypes: ["price", "sale_price"],
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        accountScope,
        reconcile: (response, operationType) => operationType === "price"
          ? reconcilePriceWrite(response, snapshot)
          : reconcileSalePriceWrite(response, snapshot),
      });
    } catch {
      // Reconciliation is fail-closed: the GET result remains useful, while a
      // ledger entry that cannot be proven stays locked instead of being reset.
    }
  }

  private async reconcileBusinessPriceWrites(
    snapshot: BusinessPricingListingSnapshot,
  ): Promise<void> {
    try {
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[snapshot.marketplaceId].region,
      );
      await this.store.reconcileIdempotentOperations({
        operationTypes: ["business_price"],
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        accountScope,
        reconcile: (response) => reconcileBusinessPriceWrite(response, snapshot),
      });
    } catch {
      // Keep unresolved Business-price evidence locked unless an exact
      // canonical B2B readback proves both the target and every guard field.
    }
  }

  private async reconcileContentWrites(
    snapshot: ListingContentSnapshot,
  ): Promise<void> {
    try {
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[snapshot.marketplaceId].region,
      );
      await this.store.reconcileIdempotentOperations({
        operationTypes: ["content"],
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        accountScope,
        reconcile: (response) => reconcileContentWrite(response, snapshot),
      });
    } catch {
      // Keep unresolved evidence locked when canonical reconciliation fails.
    }
  }

  private async reconcileImageWrites(snapshot: ListingImageSnapshot): Promise<void> {
    try {
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[snapshot.marketplaceId].region,
      );
      await this.store.reconcileIdempotentOperations({
        operationTypes: ["images"],
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        accountScope,
        reconcile: (response) => reconcileImageWrite(response, snapshot),
      });
    } catch {
      // Keep unresolved evidence locked when canonical reconciliation fails.
    }
  }

  private issuePreview(path: string, rawKey: string, fingerprint: string): void {
    const key = idempotencyKey(rawKey);
    if (!key) return;
    const now = Date.now();
    for (const [ticketKey, value] of this.previews) {
      if (value.expiresAt < now) this.previews.delete(ticketKey);
    }
    this.previews.set(`${path}:${key}`, {
      path,
      fingerprint,
      expiresAt: now + 2 * 60_000,
      reserved: false,
    });
  }

  private async approveReservedPreview(
    path: string,
    key: string,
    fingerprint: string,
    reason: string,
  ): Promise<ApiResponse | null> {
    const reservationError = this.reservePreview(path, key, fingerprint);
    if (reservationError) return reservationError;
    try {
      await this.approveWrite(reason);
    } catch {
      this.releasePreview(path, key, fingerprint);
      return invalid(
        "操作已取消；Amazon 沒有收到任何變更。",
        409,
        "ACTION_CANCELLED",
      );
    }
    return this.consumePreview(path, key, fingerprint);
  }

  private reservePreview(path: string, key: string, fingerprint: string): ApiResponse | null {
    const ticket = this.previews.get(`${path}:${key}`);
    if (!ticket || ticket.path !== path || ticket.expiresAt < Date.now()) {
      return invalid(
        "這次 Amazon 預檢已過期，請重新預檢後再送出。",
        409,
        "PREVIEW_EXPIRED",
      );
    }
    if (ticket.fingerprint !== fingerprint) {
      return invalid(
        "預檢後的內容已改變，系統已停止送出；請重新預檢。",
        409,
        "PREVIEW_CHANGED",
      );
    }
    if (ticket.reserved) {
      return invalid(
        "同一筆操作正在等待本機確認，系統已阻止重複送出。",
        409,
        "OPERATION_IN_PROGRESS",
      );
    }
    ticket.reserved = true;
    return null;
  }

  private releasePreview(path: string, key: string, fingerprint: string): void {
    const ticketKey = `${path}:${key}`;
    const ticket = this.previews.get(ticketKey);
    if (!ticket || ticket.fingerprint !== fingerprint) return;
    if (ticket.expiresAt < Date.now()) this.previews.delete(ticketKey);
    else ticket.reserved = false;
  }

  private consumePreview(path: string, key: string, fingerprint: string): ApiResponse | null {
    const ticketKey = `${path}:${key}`;
    const ticket = this.previews.get(ticketKey);
    this.previews.delete(ticketKey);
    if (!ticket || ticket.path !== path || ticket.expiresAt < Date.now()) {
      return invalid(
        "這次 Amazon 預檢已過期，請重新預檢後再送出。",
        409,
        "PREVIEW_EXPIRED",
      );
    }
    if (ticket.fingerprint !== fingerprint) {
      return invalid(
        "預檢後的內容已改變，系統已停止送出；請重新預檢。",
        409,
        "PREVIEW_CHANGED",
      );
    }
    if (!ticket.reserved) {
      return invalid(
        "這次 Amazon 預檢尚未完成本機確認。",
        409,
        "PREVIEW_NOT_RESERVED",
      );
    }
    return null;
  }
}
