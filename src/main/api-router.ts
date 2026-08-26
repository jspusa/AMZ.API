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
import type { BusinessPricingMutationsPort } from
  "./business-pricing-mutations";
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
  isMarketplaceId,
  invalidateSpApiCredentialCaches,
  listingImageGatewayProduction,
  listingPriceGatewayProduction,
  variationMoveGatewayProduction,
  previewListingContentUpdate,
  previewBusinessPriceUpdate,
  fbaInboundExternalReadAdapterProduction,
  reportsRuntimeProductionAdapter,
  ordersPageAdapterProduction,
  searchListingsBySku,
  updateListingContent,
  updateBusinessPrice,
  usesDemoMode,
  verifyListingsAccess,
  type ListingContentSnapshot,
  type BusinessPricingListingSnapshot,
  type BusinessPricePrecommitEvidence,
  type BusinessPriceValidationResult,
  type ListingContentValidationResult,
  type ListingContentUpdateResult,
  type MarketplaceId,
  type UpdateListingContentInput,
  type UpdateBusinessPriceInput,
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
  ContentAuditWorkbookError,
  parseContentAuditWorkbook,
  type ParsedContentAuditValues,
} from "./amazon/content-audit-workbook-parser";
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
  reconcileContentWrite,
  reconcileBusinessPriceWrite,
} from "./amazon/listing-write-readback";
import {
  MARKETPLACES as MARKETPLACE_METADATA,
  marketplaceByCode,
} from "../shared/marketplaces";
import {
  abortableDelay as waitMilliseconds,
  throwIfAborted as assertBackgroundActive,
} from "./abort-utils";

type WriteApproval = (reason: string) => Promise<void>;

type ContentBatchChange = {
  input: UpdateListingContentInput;
  proposalFingerprint: string;
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

function parsePrice(value: unknown, currencyCode: string): number | null {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return null;
  const pattern = currencyCode === "JPY" ? /^\d{1,9}$/ : /^\d{1,9}(?:\.\d{1,2})?$/;
  if (!pattern.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
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
  private readonly spExecutionContext: RouterRequestContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly priceMutations: ListingPriceMutationsPort;
  private readonly listingImageMutations: ListingImageMutationsPort;
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
    legacyAuditSuiteCompatibility?: AuditSuiteCompatibilityCoordinatorPort;
    advertising?: AdvertisingGateway;
    spExecutionContext?: SpExecutionContextAdapter;
    writeGate?: MainWriteGatePort;
    priceMutations?: ListingPriceMutationsPort;
    listingImageMutations?: ListingImageMutationsPort;
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
    this.variationMoveMutations = input.variationMoveMutations ??
      createVariationMoveMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        gateway: variationMoveGatewayProduction,
      });
    this.businessPricingMutations = input.businessPricingMutations ?? {
      handle: ({ operation, request }) => operation === "read"
        ? this.businessPricing(request)
        : operation === "preview"
          ? this.previewBusinessPricing(request)
          : this.commitBusinessPricing(request),
    };
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
          content: getListingContent,
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
    this.contentBatchPlans.clear();
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

  private listingIdentity(request: ApiRequest):
    | { marketplaceId: MarketplaceId; sellerSku: string }
    | ApiResponse {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    return marketplaceId && sellerSku
      ? { marketplaceId, sellerSku }
      : invalid("請選擇站點並輸入完整 SKU。");
  }

  private async businessPricing(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    try {
      const { context, value: snapshot } = await this.runContextBoundWork(
        identity.marketplaceId,
        () => getBusinessPricing(identity),
      );
      await this.priceMutations.observeCanonical(identity, snapshot, context);
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
      await this.stageWritePreview(this.writeBinding({
        family: "business-price",
        operation: "business_price",
        context,
        sellerSku: input.sellerSku,
        idempotencyKey: input.idempotencyKey,
        proposalFingerprint: this.businessPricingFingerprint(input, result),
      }));
      return json(result);
    } catch (error) {
      return writeApiError(
        error,
        "Amazon Business 價格預檢時發生未預期的錯誤。",
      );
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
    const binding = this.writeBinding({
      family: "business-price",
      operation: "business_price",
      context,
      sellerSku: input.sellerSku,
      idempotencyKey: input.idempotencyKey,
      proposalFingerprint: this.businessPricingFingerprint(input, evidence),
    });
    try {
      const result = await this.writeGate.execute({
        binding,
        approvalReason: `確認 B2B 調價｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜一般售價維持 ${input.expectedStandardPrice}｜B2B ${input.expectedBusinessPrice ?? "未設定"} → ${input.newBusinessPrice} ${MARKETPLACES[input.marketplaceId].currency}｜數量折扣 ${evidence.quantityDiscountPlanChange === "preserve" ? "維持原方案" : `${evidence.previousQuantityDiscountPlan ? `${evidence.previousQuantityDiscountPlan.discountType} ${evidence.previousQuantityDiscountPlan.levels.map((level) => `${level.lowerBound}件=${level.value}`).join("、")}` : "未設定"} → ${evidence.requestedQuantityDiscountPlan?.levels.map((level) => `${level.lowerBound}件=${level.value}%`).join("、") ?? "未設定"}`}`,
        run: (session) => session.attempt({
          intentId: "primary",
          execute: ({ recordAccepted, assertCurrent }) =>
            commitWithCanonicalReadback({
              commit: () => updateBusinessPrice(input, evidence, {
                assertCurrent,
              }),
              onAccepted: recordAccepted,
              assertCurrent,
              read: () => getBusinessPricing(input),
              decide: businessPriceReadbackDecision,
            }),
        }),
      });
      return json(result);
    } catch (error) {
      return writeApiError(
        error,
        "送出 Amazon Business 價格更新時發生未預期的錯誤。",
      );
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
      await this.stageWritePreview(this.writeBinding({
        family: "content",
        operation: "content",
        context,
        sellerSku: input.sellerSku,
        idempotencyKey: input.idempotencyKey,
        proposalFingerprint: this.contentFingerprint(input),
      }));
      return json(result);
    } catch (error) {
      return writeApiError(error, "商品內容預檢時發生未預期的錯誤。");
    }
  }

  private async commitContent(request: ApiRequest): Promise<ApiResponse> {
    const input = this.contentInput(request);
    if ("status" in input) return input;
    const key = idempotencyKey(input.idempotencyKey);
    if (!key) return invalid("這次預檢已失效，請重新預檢。");
    const context = await this.spExecutionContext.capture(input.marketplaceId);
    const binding = this.writeBinding({
      family: "content",
      operation: "content",
      context,
      sellerSku: input.sellerSku,
      idempotencyKey: key,
      proposalFingerprint: this.contentFingerprint(input),
    });
    try {
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
      const result = await this.writeGate.execute({
        binding,
        approvalReason: (verificationCode) =>
          `確認文案｜${MARKETPLACE_CODES[input.marketplaceId]} ${input.sellerSku}｜${changedFields}｜驗證碼 ${verificationCode}`,
        run: (session) => session.attempt({
          intentId: "primary",
          execute: ({ recordAccepted, assertCurrent }) =>
            commitWithCanonicalReadback({
              commit: () => updateListingContent(input, { assertCurrent }),
              onAccepted: recordAccepted,
              assertCurrent,
              read: () => getListingContent(input),
              decide: contentReadbackDecision,
            }),
        }),
      });
      return json(result);
    } catch (error) {
      return writeApiError(error, "送出商品內容時發生未預期的錯誤。");
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
          const proposalFingerprint = this.contentFingerprint(input);
          changes.push({
            input,
            proposalFingerprint,
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
          stableFingerprint([accountScope, change.proposalFingerprint]),
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
      await this.stageWritePreview(this.contentBatchWriteBinding(plan));
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

    const sellerSkus = plan.changes.map((change) => change.input.sellerSku);
    const shownSkus = sellerSkus.slice(0, 5).join("、");
    const remaining = Math.max(0, sellerSkus.length - 5);
    let preflightResponse: ApiResponse | null = null;
    plan.state = "committing";
    try {
      const result = await this.writeGate.execute<ContentBatchCommitResult>({
        binding: this.contentBatchWriteBinding(plan),
        approvalReason:
          `確認 Excel 批次文案｜${MARKETPLACE_CODES[marketplaceId]}｜${sellerSkus.length} 個 SKU｜${shownSkus}${remaining ? ` 等另 ${remaining} 個` : ""}｜驗證碼 ${plan.fingerprint.slice(0, 12)}`,
        cancellationMessage: "操作已取消；Amazon 沒有收到任何文案變更。",
        beforeApproval: async () => {
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
            preflightResponse = response.body.kind === "json" &&
                isPlainRecord(response.body.value)
              ? json({
                  ...response.body.value,
                  message:
                    `${String(response.body.value.message ?? "整批重新預檢失敗。")} Amazon 寫入數為 0，請重新上傳 Excel。`,
                  writeCount: 0,
                }, response.status, response.headers)
              : response;
            throw error;
          }
        },
        run: async (session) => {
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
              const rowResult = await session.attempt<ListingContentUpdateResult>({
                intentId: change.input.sellerSku,
                execute: ({ recordAccepted, assertCurrent }) =>
                  commitWithCanonicalReadback({
                    commit: () => updateListingContent(change.input, {
                      assertCurrent,
                    }),
                    onAccepted: recordAccepted,
                    assertCurrent,
                    read: () => getListingContent(change.input),
                    decide: contentReadbackDecision,
                  }),
              });
              rows[index] = {
                sellerSku: change.input.sellerSku,
                state: rowResult.mode === "demo" ? "simulated" : "verified",
                result: rowResult,
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
          return {
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
        },
      });
      plan.result = result;
      plan.state = "completed";
      return json(result);
    } catch (error) {
      if (plan.state === "committing") plan.state = "ready";
      if (preflightResponse) return preflightResponse;
      return writeApiError(
        error,
        "Excel 批次文案更新時發生未預期的錯誤。",
      );
    }
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

  private async stageWritePreview(binding: WriteBinding): Promise<void> {
    if (binding.intents.some((intent) => !idempotencyKey(intent.idempotencyKey))) {
      return;
    }
    await this.writeGate.stagePreview(binding);
  }

  private contentBatchWriteBinding(plan: ContentBatchPlan): WriteBinding {
    const intents = plan.changes.map((change) => ({
      intentId: change.input.sellerSku,
      operation: "content" as const,
      marketplaceId: plan.marketplaceId,
      sellerSku: change.input.sellerSku,
      idempotencyKey: plan.idempotencyKey,
      proposalFingerprint: change.proposalFingerprint,
    }));
    const first = intents[0];
    if (!first) throw new Error("Content batch plan has no write intents.");
    return {
      family: "content-batch",
      previewKey: plan.previewId,
      context: plan.context,
      intents: [first, ...intents.slice(1)],
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

  private async reconcileBusinessPriceWrites(
    snapshot: BusinessPricingListingSnapshot,
    context: SpExecutionContext,
  ): Promise<void> {
    await this.writeGate.reconcile({
      context,
      marketplaceId: snapshot.marketplaceId,
      sellerSku: snapshot.sellerSku,
      operations: ["business_price"],
      snapshot,
      project: (response, _operationType, canonical) =>
        reconcileBusinessPriceWrite(response, canonical),
    });
  }

  private async reconcileContentWrites(
    snapshot: ListingContentSnapshot,
    context: SpExecutionContext,
  ): Promise<void> {
    await this.writeGate.reconcile({
      context,
      marketplaceId: snapshot.marketplaceId,
      sellerSku: snapshot.sellerSku,
      operations: ["content"],
      snapshot,
      project: (response, _operationType, canonical) =>
        reconcileContentWrite(response, canonical),
    });
  }

}
