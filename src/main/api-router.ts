import { createHash, randomUUID } from "node:crypto";
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
  auditListingContentRows,
} from "./amazon/content-quality";
import {
  IMAGE_AUDIT_MINIMUM_IMAGES,
  auditListingImageRows,
} from "./amazon/image-audit";
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
  optionalDate,
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
  getListingContent,
  getListingImages,
  getListingPrice,
  getBusinessPricing,
  aplusContentPageAdapterProduction,
  customerFeedbackPageAdapterProduction,
  isConfiguredForMarketplace,
  getRestockPlan,
  getSalesTrend,
  getFbaSubscriptionAudit,
  getDemoUnboundVariationAuditData,
  getSubscribeAndSaveOffer,
  getVariationFamilyPlanner,
  getVariationMovePreparation,
  isMarketplaceId,
  invalidateSpApiCredentialCaches,
  previewListingContentUpdate,
  previewBusinessPriceUpdate,
  previewListingImageUpdate,
  previewListingPriceUpdate,
  previewListingSalePriceUpdate,
  previewVariationMove,
  fbaInboundExternalReadAdapterProduction,
  reportsRuntimeProductionAdapter,
  ordersPageAdapterProduction,
  searchListingsBySku,
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
  type SubscriptionAuditSnapshot,
  type UpdateListingContentInput,
  type UpdateBusinessPriceInput,
  type UpdateListingSalePriceInput,
  type FbaVariationGroupingData,
  type VariationMoveInput,
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
  type FbaCatalogReportsPurpose,
} from "./amazon/fba-catalog-reports";
import type {
  BusinessPricingAuditSnapshot,
  CatalogExportProgress,
  CatalogListingsReadAdapter,
  FbaCatalogExport,
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
import {
  ReplenishmentAuditError,
  subscriptionAuditDiscountBucket,
} from "./amazon/replenishment-audit";
import {
  ContentAuditWorkbookError,
  parseContentAuditWorkbook,
  type ParsedContentAuditValues,
} from "./amazon/content-audit-workbook-parser";
import {
  createAuditSuiteWorkbook,
  type APlusAuditProblemRow,
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
  type AplusAuditSnapshot,
} from "./amazon/a-plus-content-reads";
import {
  AplusContentReads,
  type AplusContentPageOperation,
  type AplusContentReadsPort,
} from "./amazon/a-plus-content-reads";
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
  contentAuditEvidenceRowDigest,
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
import type { AuditSuiteContext } from "./amazon/audit-suite-context";
import {
  MARKETPLACES as MARKETPLACE_METADATA,
  marketplaceByCode,
} from "../shared/marketplaces";
import {
  abortableDelay as waitMilliseconds,
  throwIfAborted as assertBackgroundActive,
} from "./abort-utils";

type WriteApproval = (reason: string) => Promise<void>;

type PreviewTicket = {
  path: string;
  context: SpExecutionContext;
  fingerprint: string;
  expiresAt: number;
  reserved: boolean;
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
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  accountScope: string;
  idempotencyKey: string;
  fingerprint: string;
  changes: ContentBatchChange[];
  expiresAt: number;
  state: "ready" | "committing" | "completed";
  result: ContentBatchCommitResult | null;
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

const MARKETPLACE_CODES = Object.fromEntries(
  MARKETPLACE_METADATA.map((marketplace) => [
    marketplace.id,
    marketplace.code === "UK" ? "GB" : marketplace.code,
  ]),
) as Record<MarketplaceId, string>;

const CONTENT_BATCH_PREVIEW_TTL_MS = 15 * 60 * 1_000;
const CONTENT_BATCH_MAX_CHANGED_SKUS = 500;

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
function assertAuditSuiteActive(control: AuditSuiteRunControl): void {
  assertBackgroundActive(control.signal);
}

function aplusAuditFenceAbort(): Error {
  const error = new Error("A+ 健檢的帳號、站點或模式 context 已改變。");
  error.name = "AbortError";
  return error;
}

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
  if (error instanceof AuditSuiteCoordinatorError) {
    const publicError = publicRouterError(error, fallback);
    return json(
      { code: publicError.code, message: publicError.message },
      publicError.status,
    );
  }
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

export class ApiRouter {
  private readonly store: LocalStore;
  private readonly vault: CredentialVault;
  private readonly approveWrite: WriteApproval;
  private readonly spExecutionContext: RouterRequestContextAdapter;
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
  private readonly auditSuite: AuditSuiteCoordinator;
  private readonly aPlusAuditCoordinator: AplusAuditCoordinatorPort;
  private readonly standaloneAuditCoordinator: StandaloneAuditCoordinatorPort;
  private readonly previews = new Map<string, PreviewTicket>();
  private readonly listingAttributeWriteReservations = new Map<string, string>();
  private readonly contentBatchPlans = new Map<string, ContentBatchPlan>();
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
    advertising?: AdvertisingGateway;
    spExecutionContext?: SpExecutionContextAdapter;
  }) {
    this.store = input.store;
    this.vault = input.vault;
    this.approveWrite = input.approveWrite;
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
          this.auditSuiteListings(context, control),
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
          price: getListingPrice,
          content: getListingContent,
          images: getListingImages,
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
    this.auditSuite = new AuditSuiteCoordinator({
      runners: {
        content: (context, control) => this.runAuditSuiteContent(context, control),
        image: (context, control) => this.runAuditSuiteImage(context, control),
        aplus: (context, control) => this.runAuditSuiteAplus(context, control),
        variation: (context, control) => this.runAuditSuiteVariation(context, control),
        subscription: (context, control) => this.runAuditSuiteSubscription(context, control),
        businessPricing: (context, control) =>
          this.runAuditSuiteBusinessPricing(context, control),
        advertising: (context, control) =>
          this.advertisingCoordinator.runAuditSuite(context, control),
      },
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
    this.previews.clear();
    this.listingAttributeWriteReservations.clear();
    this.contentBatchPlans.clear();
    this.fbaInboundCoordinator.clear();
    this.auditSuite.clear();
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
        return this.listingPrice(request);
      case "POST /api/sp-api/listings":
        return this.previewPrice(request);
      case "PATCH /api/sp-api/listings":
        return this.commitPrice(request);
      case "POST /api/sp-api/business-pricing-audit":
        return this.businessPricingAuditOwner.start(request);
      case "GET /api/sp-api/business-pricing-audit":
        return this.businessPricingAuditOwner.statusOrData(request);
      case "GET /api/sp-api/business-pricing-audit/export":
        return this.businessPricingAuditOwner.download(request);
      case "GET /api/sp-api/business-pricing":
        return this.businessPricing(request);
      case "POST /api/sp-api/business-pricing":
        return this.previewBusinessPricing(request);
      case "PATCH /api/sp-api/business-pricing":
        return this.commitBusinessPricing(request);
      case "POST /api/sp-api/listings/batch":
        return this.statelessCapabilities.batchListings(request);
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
        return this.variationMovePreparation(request);
      case "POST /api/sp-api/variation-move":
        return this.previewVariationMove(request);
      case "PATCH /api/sp-api/variation-move":
        return this.commitVariationMove(request);
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
        return this.startAuditSuite(request);
      case "GET /api/sp-api/audit-suite":
        return this.auditSuiteStatus(request);
      case "GET /api/sp-api/audit-suite/export":
        return this.auditSuiteExport(request);
      case "POST /api/sp-api/standalone-audit":
        return this.standaloneAuditCoordinator.start(request);
      case "GET /api/sp-api/standalone-audit":
        return this.standaloneAuditCoordinator.observe(request);
      default:
        return invalid("此 App 版本不支援這個操作。", 404, "NOT_FOUND");
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
      const { context, value: snapshot } = await this.runContextBoundWork(
        identity.marketplaceId,
        () => getListingPrice(identity),
      );
      await this.reconcilePriceWrites(snapshot, context);
      return json(snapshot);
    } catch (error) {
      return apiError(error, "查詢 SKU 價格時發生未預期的錯誤。");
    }
  }

  private async businessPricing(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    try {
      const { context, value: snapshot } = await this.runContextBoundWork(
        identity.marketplaceId,
        () => getBusinessPricing(identity),
      );
      await this.reconcilePriceWrites(snapshot, context);
      await this.reconcileBusinessPriceWrites(snapshot, context);
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
      const { context, value: result } = await this.runContextBoundWork(
        input.marketplaceId,
        () => previewBusinessPriceUpdate(input),
      );
      const scoped = this.scopedFingerprintForContext(
        context,
        this.businessPricingFingerprint(input, result),
      );
      await this.issuePreview(
        request.path,
        input.idempotencyKey,
        scoped.fingerprint,
        context,
      );
      return json(result);
    } catch (error) {
      return apiError(error, "Amazon Business 價格預檢時發生未預期的錯誤。");
    }
  }

  private async commitBusinessPricing(request: ApiRequest): Promise<ApiResponse> {
    const input = this.businessPricingInput(request);
    if ("status" in input) return input;
    let evidence: BusinessPriceValidationResult;
    let context: SpExecutionContext;
    try {
      const bound = await this.runContextBoundWork(
        input.marketplaceId,
        () => previewBusinessPriceUpdate(input),
      );
      context = bound.context;
      evidence = bound.value;
    } catch (error) {
      return apiError(
        error,
        "正式確認前重新執行 Amazon Business 價格預檢時發生未預期的錯誤。",
      );
    }
    const scoped = this.scopedFingerprintForContext(
      context,
      this.businessPricingFingerprint(input, evidence),
    );
    const ticketError = await this.approveReservedPreview(
      request.path,
      input.idempotencyKey,
      scoped.fingerprint,
      scoped.context,
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
          commit: () => updateBusinessPrice(input, evidence, {
            assertCurrent: () =>
              this.spExecutionContext.assertCurrent(scoped.context),
          }),
          onAccepted: recordAccepted,
          assertCurrent: () => this.spExecutionContext.assertCurrent(scoped.context),
          read: () => getBusinessPricing(input),
          decide: businessPriceReadbackDecision,
        }),
      });
      return json(result);
    } catch (error) {
      return apiError(error, "送出 Amazon Business 價格更新時發生未預期的錯誤。");
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
      const { value } = await this.runContextBoundWork(
        marketplaceId,
        () => getVariationMovePreparation({
          marketplaceId,
          sellerSku,
          targetParentSku,
        }),
      );
      return json(value);
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
      const { context, value: result } = await this.runContextBoundWork(
        input.marketplaceId,
        () => previewVariationMove(input),
      );
      const scoped = this.scopedFingerprintForContext(
        context,
        this.variationMoveFingerprint(input),
      );
      await this.issuePreview(
        request.path,
        input.idempotencyKey,
        scoped.fingerprint,
        context,
      );
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
      scoped.context,
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
        execute: () => updateVariationMove(input, {
          assertCurrent: () =>
            this.spExecutionContext.assertCurrent(scoped.context),
        }),
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
      const { context, value: result } = await this.runContextBoundWork(
        input.marketplaceId,
        () => previewListingPriceUpdate(input),
      );
      const scoped = this.scopedFingerprintForContext(
        context,
        this.priceFingerprint(input),
      );
      await this.issuePreview(
        request.path,
        input.idempotencyKey,
        scoped.fingerprint,
        context,
      );
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
      scoped.context,
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
          commit: () => updateListingPrice(input, {
            assertCurrent: () =>
              this.spExecutionContext.assertCurrent(scoped.context),
          }),
          onAccepted: recordAccepted,
          assertCurrent: () => this.spExecutionContext.assertCurrent(scoped.context),
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
      const { context, value: snapshot } = await this.runContextBoundWork(
        identity.marketplaceId,
        () => getListingContent(identity),
      );
      await this.reconcileContentWrites(snapshot, context);
      return json(snapshot);
    } catch (error) {
      return apiError(error, "查詢商品內容時發生未預期的錯誤。");
    }
  }

  private async previewContent(request: ApiRequest): Promise<ApiResponse> {
    const input = this.contentInput(request);
    if ("status" in input) return input;
    try {
      const { context, value: result } = await this.runContextBoundWork(
        input.marketplaceId,
        () => previewListingContentUpdate(input),
      );
      const scoped = this.scopedFingerprintForContext(
        context,
        this.contentFingerprint(input),
      );
      await this.issuePreview(
        request.path,
        input.idempotencyKey,
        scoped.fingerprint,
        context,
      );
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
        scoped.context,
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
            commit: () => updateListingContent(input, {
              assertCurrent: () =>
                this.spExecutionContext.assertCurrent(scoped.context),
            }),
            onAccepted: recordAccepted,
            assertCurrent: () => this.spExecutionContext.assertCurrent(scoped.context),
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
      const context = await this.spExecutionContext.capture(marketplaceId);
      const { accountScope, mode } = context;
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
          contentAuditEvidenceRowDigest({
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
          await this.spExecutionContext.assertCurrent(context);
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
          if (error instanceof SpExecutionContextError) throw error;
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
      await this.spExecutionContext.assertCurrent(context);
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
        context,
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
    const context = await this.spExecutionContext.capture(marketplaceId);
    try {
      await this.spExecutionContext.assertCurrent(plan.context);
    } catch (error) {
      this.contentBatchPlans.delete(previewId);
      throw error;
    }
    const { accountScope } = context;
    if (plan.accountScope !== accountScope) {
      this.contentBatchPlans.delete(previewId);
      throw new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "Amazon 帳號範圍已改變；本次操作已停止。",
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
          await this.spExecutionContext.assertCurrent(context);
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

      await this.spExecutionContext.assertCurrent(context);
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

      await this.spExecutionContext.assertCurrent(context);

      const rows: ContentBatchRowResult[] = plan.changes.map((change) => ({
        sellerSku: change.input.sellerSku,
        state: "not-started",
        result: null,
        error: null,
      }));
      let status: ContentBatchCommitResult["status"] = "COMPLETED";
      for (let index = 0; index < plan.changes.length; index += 1) {
        const change = plan.changes[index]!;
        await this.spExecutionContext.assertCurrent(context);
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
                  commit: () => updateListingContent(change.input, {
                    assertCurrent: () =>
                      this.spExecutionContext.assertCurrent(context),
                  }),
                  onAccepted: recordAccepted,
                  assertCurrent: () => this.spExecutionContext.assertCurrent(context),
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
      const { context, value: snapshot } = await this.runContextBoundWork(
        identity.marketplaceId,
        () => getListingImages(identity),
      );
      await this.reconcileImageWrites(snapshot, context);
      return json(snapshot);
    } catch (error) {
      return apiError(error, "查詢商品圖片時發生未預期的錯誤。");
    }
  }

  private async previewImages(request: ApiRequest): Promise<ApiResponse> {
    const input = this.imageInput(request);
    if ("status" in input) return input;
    try {
      const { context, value: result } = await this.runContextBoundWork(
        input.marketplaceId,
        () => previewListingImageUpdate(input),
      );
      const scoped = this.scopedFingerprintForContext(
        context,
        this.imageFingerprint(input),
      );
      await this.issuePreview(
        request.path,
        input.idempotencyKey,
        scoped.fingerprint,
        context,
      );
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
        scoped.context,
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
            commit: () => updateListingImages(input, {
              assertCurrent: () =>
                this.spExecutionContext.assertCurrent(scoped.context),
            }),
            onAccepted: recordAccepted,
            assertCurrent: () => this.spExecutionContext.assertCurrent(scoped.context),
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
      const { context, value: result } = await this.runContextBoundWork(
        input.marketplaceId,
        () => previewListingSalePriceUpdate(input),
      );
      const scoped = this.scopedFingerprintForContext(
        context,
        this.saleFingerprint(input),
      );
      await this.issuePreview(
        request.path,
        input.idempotencyKey,
        scoped.fingerprint,
        context,
      );
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
      scoped.context,
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
          commit: () => updateListingSalePrice(input, {
            assertCurrent: () =>
              this.spExecutionContext.assertCurrent(scoped.context),
          }),
          onAccepted: recordAccepted,
          assertCurrent: () => this.spExecutionContext.assertCurrent(scoped.context),
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

  private pruneContentBatchPlans(now = Date.now()): void {
    for (const [previewId, plan] of this.contentBatchPlans) {
      if (plan.expiresAt <= now && plan.state !== "committing") {
        this.contentBatchPlans.delete(previewId);
      }
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
    generation: number;
    mode: "live" | "demo";
  }> {
    const revision = this.contextStateRevision;
    const context = await this.spExecutionContext.capture(marketplaceId);
    await this.spExecutionContext.assertCurrent(context);
    this.assertContextStateRevision(revision);
    return {
      accountScope: context.accountScope,
      generation: context.generation,
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
    const revision = this.contextStateRevision;
    const context = await this.currentAuditSuiteContext(marketplaceId);
    this.assertContextStateRevision(revision);
    const started = this.auditSuite.start({
      marketplaceId,
      accountScope: context.accountScope,
      generation: context.generation,
      mode: context.mode,
    });
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
    if (current.generation !== context.generation) {
      throw new Error("Amazon 執行環境已更新，本次綜合健檢已停止。");
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
    let expectedContext: SpExecutionContext;
    try {
      expectedContext = await this.spExecutionContext.capture(marketplaceId);
      if (
        expectedContext.accountScope !== context.accountScope ||
        expectedContext.mode !== context.mode
      ) {
        throw new Error("A+ 綜合健檢 context 已改變。");
      }
    } catch {
      throw aplusAuditFenceAbort();
    }
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
      snapshot = await this.aplusContentReads.read({
        marketplaceId,
        expectedContext,
        fetchedAt: listing.data.fetchedAt,
        fbaSnapshotId,
        rows: buildAplusAuditSeedsFromFbaGrouping(listing.grouping.rows),
        signal: control.signal,
        onControlledWait: (operation) => control.heartbeat({
          message: controlledWaitMessages[operation],
        }),
        onProgress: (progress) => control.heartbeat({
          message: `正在核對 A+ publish records（${progress.completedAsins}／${progress.totalAsins} ASIN）。`,
          completedUnits: progress.completedAsins,
          totalUnits: progress.totalAsins,
        }),
      });
    } catch (error) {
      try {
        await this.assertAuditSuiteContext(context);
      } catch {
        throw aplusAuditFenceAbort();
      }
      throw error;
    }

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


  private async scopedFingerprint(
    marketplaceId: MarketplaceId,
    operationFingerprint: string,
  ): Promise<{
    context: SpExecutionContext;
    accountScope: string;
    fingerprint: string;
  }> {
    const context = await this.spExecutionContext.capture(marketplaceId);
    return this.scopedFingerprintForContext(context, operationFingerprint);
  }

  private scopedFingerprintForContext(
    context: SpExecutionContext,
    operationFingerprint: string,
  ): {
    context: SpExecutionContext;
    accountScope: string;
    fingerprint: string;
  } {
    const { accountScope } = context;
    return {
      context,
      accountScope,
      fingerprint: stableFingerprint([accountScope, operationFingerprint]),
    };
  }

  private async runContextBoundWork<T>(
    marketplaceId: MarketplaceId,
    work: () => Promise<T>,
  ): Promise<{ context: SpExecutionContext; value: T }> {
    const context = await this.spExecutionContext.capture(marketplaceId);
    const value = await work();
    await this.spExecutionContext.assertCurrent(context);
    return { context, value };
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

  private async reconcilePriceWrites(
    snapshot: ListingPriceSnapshot,
    context: SpExecutionContext,
  ): Promise<void> {
    try {
      if (context.marketplaceId !== snapshot.marketplaceId) return;
      await this.store.reconcileIdempotentOperations({
        operationTypes: ["price", "sale_price"],
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        accountScope: context.accountScope,
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
    context: SpExecutionContext,
  ): Promise<void> {
    try {
      if (context.marketplaceId !== snapshot.marketplaceId) return;
      await this.store.reconcileIdempotentOperations({
        operationTypes: ["business_price"],
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        accountScope: context.accountScope,
        reconcile: (response) => reconcileBusinessPriceWrite(response, snapshot),
      });
    } catch {
      // Keep unresolved Business-price evidence locked unless an exact
      // canonical B2B readback proves both the target and every guard field.
    }
  }

  private async reconcileContentWrites(
    snapshot: ListingContentSnapshot,
    context: SpExecutionContext,
  ): Promise<void> {
    try {
      if (context.marketplaceId !== snapshot.marketplaceId) return;
      await this.store.reconcileIdempotentOperations({
        operationTypes: ["content"],
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        accountScope: context.accountScope,
        reconcile: (response) => reconcileContentWrite(response, snapshot),
      });
    } catch {
      // Keep unresolved evidence locked when canonical reconciliation fails.
    }
  }

  private async reconcileImageWrites(
    snapshot: ListingImageSnapshot,
    context: SpExecutionContext,
  ): Promise<void> {
    try {
      if (context.marketplaceId !== snapshot.marketplaceId) return;
      await this.store.reconcileIdempotentOperations({
        operationTypes: ["images"],
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        accountScope: context.accountScope,
        reconcile: (response) => reconcileImageWrite(response, snapshot),
      });
    } catch {
      // Keep unresolved evidence locked when canonical reconciliation fails.
    }
  }

  private samePreviewContext(
    left: SpExecutionContext,
    right: SpExecutionContext,
  ): boolean {
    return left.marketplaceId === right.marketplaceId &&
      left.region === right.region &&
      left.mode === right.mode &&
      left.accountScope === right.accountScope &&
      left.generation === right.generation;
  }

  private async issuePreview(
    path: string,
    rawKey: string,
    fingerprint: string,
    context: SpExecutionContext,
  ): Promise<void> {
    const key = idempotencyKey(rawKey);
    if (!key) return;
    const stateRevision = this.contextStateRevision;
    await this.spExecutionContext.assertCurrent(context);
    if (stateRevision !== this.contextStateRevision) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    const now = Date.now();
    for (const [ticketKey, value] of this.previews) {
      if (value.expiresAt < now) this.previews.delete(ticketKey);
    }
    this.previews.set(`${path}:${key}`, {
      path,
      context,
      fingerprint,
      expiresAt: now + 2 * 60_000,
      reserved: false,
    });
  }

  private async approveReservedPreview(
    path: string,
    key: string,
    fingerprint: string,
    context: SpExecutionContext,
    reason: string,
  ): Promise<ApiResponse | null> {
    const stateRevision = this.contextStateRevision;
    const reservationError = this.reservePreview(
      path,
      key,
      fingerprint,
      context,
    );
    if (reservationError) return reservationError;
    try {
      await this.approveWrite(reason);
    } catch {
      this.releasePreview(path, key, fingerprint, context);
      return invalid(
        "操作已取消；Amazon 沒有收到任何變更。",
        409,
        "ACTION_CANCELLED",
      );
    }
    await this.spExecutionContext.assertCurrent(context);
    if (stateRevision !== this.contextStateRevision) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    return this.consumePreview(path, key, fingerprint, context);
  }

  private reservePreview(
    path: string,
    key: string,
    fingerprint: string,
    context: SpExecutionContext,
  ): ApiResponse | null {
    const ticket = this.previews.get(`${path}:${key}`);
    if (!ticket || ticket.path !== path || ticket.expiresAt < Date.now()) {
      return invalid(
        "這次 Amazon 預檢已過期，請重新預檢後再送出。",
        409,
        "PREVIEW_EXPIRED",
      );
    }
    if (!this.samePreviewContext(ticket.context, context)) {
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

  private releasePreview(
    path: string,
    key: string,
    fingerprint: string,
    context: SpExecutionContext,
  ): void {
    const ticketKey = `${path}:${key}`;
    const ticket = this.previews.get(ticketKey);
    if (
      !ticket ||
      ticket.fingerprint !== fingerprint ||
      !this.samePreviewContext(ticket.context, context)
    ) return;
    if (ticket.expiresAt < Date.now()) this.previews.delete(ticketKey);
    else ticket.reserved = false;
  }

  private consumePreview(
    path: string,
    key: string,
    fingerprint: string,
    context: SpExecutionContext,
  ): ApiResponse | null {
    const ticketKey = `${path}:${key}`;
    const ticket = this.previews.get(ticketKey);
    if (!ticket || ticket.path !== path || ticket.expiresAt < Date.now()) {
      if (ticket?.expiresAt && ticket.expiresAt < Date.now()) {
        this.previews.delete(ticketKey);
      }
      return invalid(
        "這次 Amazon 預檢已過期，請重新預檢後再送出。",
        409,
        "PREVIEW_EXPIRED",
      );
    }
    if (!this.samePreviewContext(ticket.context, context)) {
      return invalid(
        "這次 Amazon 預檢已過期，請重新預檢後再送出。",
        409,
        "PREVIEW_EXPIRED",
      );
    }
    this.previews.delete(ticketKey);
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
