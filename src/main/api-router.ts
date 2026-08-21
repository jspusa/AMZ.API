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
import { auditListingContentRows } from "./amazon/content-quality";
import { auditListingImageRows } from "./amazon/image-audit";
import {
  auditAdvertisingCoverage,
  AdvertisingCoverageInputError,
  prepareAdvertisingCoverageListings,
  type AdvertisingCoverageCampaign,
} from "./amazon/advertising-coverage";
import {
  MARKETPLACES,
  SpApiError,
  getAgedInventoryData,
  getAgedInventoryReportStatus,
  getAllListingsExportData,
  getAllListingsReportStatus,
  getBrandSalesData,
  getBrandSalesReportWindow,
  getFbaListingIdentitySnapshot,
  getFbaShipmentSalesReportStatus,
  getFbaInboundShipmentSnapshot,
  getInboundNoncomplianceReportDocument,
  getInboundNoncomplianceReportStatus,
  getListingContent,
  getListingImages,
  getListingPrice,
  getRestockPlan,
  getSalesTrend,
  getSalesAndTrafficReportData,
  getSalesAndTrafficReportStatus,
  getFbaSubscriptionAudit,
  getCustomerFeedbackReviewTopics,
  getFbaReviewAuditCandidates,
  getSubscribeAndSaveOffer,
  getUnboundVariationAuditData,
  getVariationFamilyPlanner,
  getVariationMovePreparation,
  isFulfillmentStatus,
  isMarketplaceId,
  previewListingContentUpdate,
  previewListingImageUpdate,
  previewListingPriceUpdate,
  previewListingSalePriceUpdate,
  previewVariationMove,
  searchListingsBySku,
  searchOrders,
  startAgedInventoryReport,
  startAllListingsReport,
  startFbaShipmentSalesReport,
  startInboundNoncomplianceReport,
  startSalesAndTrafficReport,
  updateListingContent,
  updateListingImages,
  updateListingPrice,
  updateListingSalePrice,
  updateVariationMove,
  usesDemoMode,
  verifyListingsAccess,
  type ListingContentSnapshot,
  type ListingImageSnapshot,
  type ListingPriceSnapshot,
  type MarketplaceId,
  type BrandSalesSnapshot,
  type FbaInboundShipmentSnapshot,
  type FbaListingIdentitySnapshot,
  type RestockPlanSnapshot,
  type SalesTrendComparisonMode,
  type SalesTrendPresetDays,
  type SalesAndTrafficSnapshot,
  type SubscribeAndSaveOfferSnapshot,
  type SubscriptionAuditSnapshot,
  type UpdateListingSalePriceInput,
  type UnboundVariationAuditSnapshot,
  type VariationMoveInput,
} from "./amazon/sp-api";
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
import { createReviewAuditWorkbook } from "./amazon/review-audit-xlsx";
import {
  createAgedInventoryWorkbook,
  createImageAuditWorkbook,
  createListingsWorkbook,
  createUnboundVariationWorkbook,
} from "./amazon/xlsx";
import {
  createAuditSuiteWorkbook,
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
  DurableReportLifecycle,
  type DurableReportGatewayStatus,
  type DurableReportIdentity,
  type DurableReportStatus,
} from "./amazon/report-lifecycle";
import { testRegionConnections } from "./amazon/connection-health";
import {
  commitWithCanonicalReadback,
  contentReadbackDecision,
  imageReadbackDecision,
  priceReadbackDecision,
  reconcileContentWrite,
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

type BrandSalesReportGateway = {
  startListing: typeof startAllListingsReport;
  startShipment: typeof startFbaShipmentSalesReport;
  getListingStatus: typeof getAllListingsReportStatus;
  getShipmentStatus: typeof getFbaShipmentSalesReportStatus;
  getData: typeof getBrandSalesData;
  reportWindow: typeof getBrandSalesReportWindow;
};

type AgedInventoryReportGateway = {
  start: typeof startAgedInventoryReport;
  status: typeof getAgedInventoryReportStatus;
};

type SalesAndTrafficReportGateway = {
  start: typeof startSalesAndTrafficReport;
  status: typeof getSalesAndTrafficReportStatus;
  data: typeof getSalesAndTrafficReportData;
};

type AdvertisingStrategyReportGateway = AdvertisingGateway & Required<Pick<
  AdvertisingGateway,
  | "getCombinedAccountIdentity"
  | "createSponsoredProductsAdvertisedProductReport"
  | "getSponsoredProductsAdvertisedProductReportStatus"
  | "downloadSponsoredProductsAdvertisedProductReport"
>>;

type AdvertisingStrategySourceGateway = {
  fbaListings: typeof getFbaListingIdentitySnapshot;
};

type InboundShipmentGateway = {
  snapshot: typeof getFbaInboundShipmentSnapshot;
};

type InboundNoncomplianceReportGateway = {
  start: typeof startInboundNoncomplianceReport;
  status: typeof getInboundNoncomplianceReportStatus;
  document: typeof getInboundNoncomplianceReportDocument;
};

type InboundShipmentProgress = Readonly<{
  phase: "shipments" | "items" | "issues";
  completed: number;
  total: number | null;
}>;

type InboundShipmentJobState = "running" | "completed" | "partial" | "failed";

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

type ImageAuditSnapshot = ReturnType<typeof auditListingImageRows>;
type AuditSuiteListingsData = Awaited<ReturnType<typeof getAllListingsExportData>>;
const AUDIT_SUITE_LISTINGS_RESOURCE = createAuditSuiteResourceKey<{
  reportId: string;
  documentId: string;
  data: AuditSuiteListingsData;
}>("audit-suite-verified-listings");

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
  if (error instanceof AuditSuiteCoordinatorError) {
    return json({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof SpApiError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 500;
    return json(
      {
        code: error.code,
        message: error.message,
        requestId: error.requestId,
        issues: error.issues,
        operation: error.operation,
        upstreamCode: error.upstreamCode,
      },
      status,
      error.retryAfter ? { "retry-after": error.retryAfter } : {},
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
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const key = `${parts.year ?? ""}-${parts.month ?? ""}-${parts.day ?? ""}`;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(key)) {
    throw new Error("無法判定 Amazon 站點目前日期。");
  }
  return key;
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
  return {
    data: null,
    error:
      error instanceof SpApiError
        ? {
            code: error.code,
            message: error.message,
            requestId: error.requestId,
            operation: error.operation,
            upstreamCode: error.upstreamCode,
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
  private readonly brandSalesReports: BrandSalesReportGateway;
  private readonly agedInventoryReports: AgedInventoryReportGateway;
  private readonly salesAndTrafficReports: SalesAndTrafficReportGateway;
  private readonly advertisingStrategySources: AdvertisingStrategySourceGateway;
  private readonly advertisingStrategyWait: typeof waitMilliseconds;
  private readonly inboundShipments: InboundShipmentGateway;
  private readonly inboundNoncomplianceReports: InboundNoncomplianceReportGateway;
  private readonly reportLifecycle: DurableReportLifecycle;
  private readonly advertising: AdvertisingGateway | null;
  private readonly auditSuite: AuditSuiteCoordinator;
  private readonly previews = new Map<string, PreviewTicket>();
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
    salesAndTrafficReports?: Partial<SalesAndTrafficReportGateway>;
    advertisingStrategySources?: Partial<AdvertisingStrategySourceGateway>;
    advertisingStrategyWait?: typeof waitMilliseconds;
    inboundShipments?: Partial<InboundShipmentGateway>;
    inboundNoncomplianceReports?: Partial<InboundNoncomplianceReportGateway>;
    advertising?: AdvertisingGateway;
  }) {
    this.store = input.store;
    this.vault = input.vault;
    this.approveWrite = input.approveWrite;
    this.advertising = input.advertising ?? null;
    this.reportLifecycle = new DurableReportLifecycle(this.store);
    this.brandSalesReports = {
      startListing: startAllListingsReport,
      startShipment: startFbaShipmentSalesReport,
      getListingStatus: getAllListingsReportStatus,
      getShipmentStatus: getFbaShipmentSalesReportStatus,
      getData: getBrandSalesData,
      reportWindow: getBrandSalesReportWindow,
      ...input.brandSalesReports,
    };
    this.agedInventoryReports = {
      start: startAgedInventoryReport,
      status: getAgedInventoryReportStatus,
      ...input.agedInventoryReports,
    };
    this.salesAndTrafficReports = {
      start: startSalesAndTrafficReport,
      status: getSalesAndTrafficReportStatus,
      data: getSalesAndTrafficReportData,
      ...input.salesAndTrafficReports,
    };
    this.advertisingStrategySources = {
      fbaListings: getFbaListingIdentitySnapshot,
      ...input.advertisingStrategySources,
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
    this.auditSuite = new AuditSuiteCoordinator({
      runners: {
        subscription: (context, control) => this.runAuditSuiteSubscription(context, control),
        inventory: (context, control) => this.runAuditSuiteInventory(context, control),
        content: (context, control) => this.runAuditSuiteContent(context, control),
        image: (context, control) => this.runAuditSuiteImage(context, control),
        variation: (context, control) => this.runAuditSuiteVariation(context, control),
        review: (context, control) => this.runAuditSuiteReview(context, control),
        advertising: (context, control) => this.runAuditSuiteAdvertising(context, control),
      },
    });
  }

  clearPreviews(): void {
    this.reportLifecycle.clear();
    this.previews.clear();
    this.subscriptionAuditSnapshots.clear();
    this.unboundVariationAuditSnapshots.clear();
    this.imageAuditSnapshots.clear();
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
      case "POST /api/sp-api/listings/batch":
        return this.batchListings(request);
      case "GET /api/sp-api/listing-content":
        return this.listingContent(request);
      case "POST /api/sp-api/listing-content":
        return this.previewContent(request);
      case "PATCH /api/sp-api/listing-content":
        return this.commitContent(request);
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
      case "POST /api/sp-api/audit-suite":
        return this.startAuditSuite(request);
      case "GET /api/sp-api/audit-suite":
        return this.auditSuiteStatus(request);
      case "GET /api/sp-api/audit-suite/export":
        return this.auditSuiteExport(request);
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

  private inboundNoncomplianceIdentity(job: InboundShipmentJob): DurableReportIdentity {
    return {
      accountScope: job.accountScope,
      marketplaceId: job.marketplaceId,
      mode: job.mode,
      reportType: "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA",
      optionsKey: "marketplaceIds=selected;daily-inbound-noncompliance",
    };
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
    const identity = this.inboundNoncomplianceIdentity(job);
    let report = await this.reportLifecycle.start({
      identity,
      explicitRetry: job.retryIssueReport,
      freshCompleted: job.retryIssueReport,
      signal,
      create: ({ signal: lifecycleSignal }) => this.inboundNoncomplianceReports.start({
        marketplaceId: job.marketplaceId,
        signal: lifecycleSignal,
      }),
      notices: {
        pending: "Amazon 正在準備每日 FBA 入庫瑕疵報表。",
        done: "Amazon 每日 FBA 入庫瑕疵報表已就緒。",
      },
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
      report = await this.reportLifecycle.status({
        identity,
        reportId: report.reportId,
        signal,
        poll: ({ reportId, signal: lifecycleSignal }) =>
          this.inboundNoncomplianceReports.status({
            marketplaceId: job.marketplaceId,
            reportId,
            signal: lifecycleSignal,
          }),
        notices: {
          pending: "Amazon 正在準備每日 FBA 入庫瑕疵報表。",
          done: "Amazon 每日 FBA 入庫瑕疵報表已就緒。",
        },
      });
      this.touchInboundShipmentJob(job);
    }
    if (!report.ready || !report.documentId || report.mode !== job.mode) {
      throw new SpApiError("Amazon 每日 FBA 入庫瑕疵報表仍在準備中。", {
        status: 504,
        code: "INBOUND_NONCOMPLIANCE_PENDING",
      });
    }
    await this.assertInboundShipmentJobContext(job, signal);
    const text = await this.inboundNoncomplianceReports.document({
      marketplaceId: job.marketplaceId,
      reportId: report.reportId,
      documentId: report.documentId,
      signal,
    });
    await this.assertInboundShipmentJobContext(job, signal);
    return {
      parsed: parseInboundNoncomplianceReport(text),
      fetchedAt: new Date().toISOString(),
    };
  }

  private inboundJobFailureNotice(error: unknown): string {
    if (error instanceof Error && error.name === "AbortError") {
      return "FBA 入庫貨件背景工作已安全停止。";
    }
    if (error instanceof SpApiError) {
      if (error.status === 401 || error.status === 403) {
        return "Amazon 拒絕 FBA 入庫貨件查詢，請檢查 Amazon Fulfillment 角色與授權。";
      }
      if (error.status === 429 || error.code === "RATE_LIMITED") {
        return "Amazon 暫時限制 FBA 入庫貨件查詢頻率；已停止後續讀取。";
      }
      if (error.code === "FBA_INBOUND_ITEM_CIRCUIT_OPEN") {
        return "Amazon FBA 入庫商品明細連續異常；已停止後續讀取，避免大量無效請求。";
      }
    }
    return "FBA 入庫貨件目前無法完成；Amazon 沒有收到任何寫入。";
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
      const partial = shipmentSnapshot.coverage.state === "partial" ||
        issueReport.state !== "completed";
      job.state = partial ? "partial" : "completed";
      job.notice = `${shipmentSnapshot.notice} ${issueReport.notice}`;
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
      job.notice = this.inboundJobFailureNotice(error);
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
    const start = Date.parse(`${startDate}T00:00:00.000Z`);
    const end = Date.parse(`${endDate}T00:00:00.000Z`);
    const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
    if (end < start || inclusiveDays < 1 || inclusiveDays > 180) {
      return invalid("FBA 入庫貨件日期範圍必須介於 1 到 180 天。");
    }
    const marketplaceToday = dateKeyInTimeZone(
      new Date(Date.now()),
      MARKETPLACES[marketplaceId].timeZone,
    );
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

  private brandSalesRetryWait(leg: BrandSalesReportLeg, now: number): number {
    if (
      leg.status !== "CREATING" &&
      leg.status !== "CREATION_UNKNOWN" &&
      leg.status !== "CANCELLED" &&
      leg.status !== "FATAL"
    ) {
      return 0;
    }
    return Math.max(
      0,
      (leg.createdAt ?? now) + BRAND_SALES_REUSE_WINDOW_MS - now,
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

  private brandSalesCreationFailure(error: unknown, createdAt: number): BrandSalesReportLeg {
    const unknown =
      !(error instanceof SpApiError) ||
      error.status >= 500 ||
      error.code === "UPSTREAM_UNAVAILABLE";
    const status = unknown ? "CREATION_UNKNOWN" : "CREATE_FAILED";
    return {
      reportId: null,
      documentId: null,
      status,
      createdAt,
      terminal: status,
      terminalAt: Date.now(),
    };
  }

  private async createBrandSalesLeg(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
  ): Promise<unknown | null> {
    const createdAt = Date.now();
    await this.saveBrandSalesLeg(
      job,
      leg,
      {
        reportId: null,
        documentId: null,
        status: "CREATING",
        createdAt,
        terminal: null,
        terminalAt: null,
      },
      createdAt,
      true,
    );
    let returnedStatus:
      | Awaited<ReturnType<BrandSalesReportGateway["startListing"]>>
      | Awaited<ReturnType<BrandSalesReportGateway["startShipment"]>>
      | null = null;
    try {
      const status = leg === "listing"
        ? await this.brandSalesReports.startListing({ marketplaceId: job.marketplaceId as MarketplaceId })
        : await this.brandSalesReports.startShipment({
            marketplaceId: job.marketplaceId as MarketplaceId,
            startDate: job.startDate,
            endDate: job.endDate,
            dataStartTime: job.shipmentDataStartTime,
            dataEndTime: job.shipmentDataEndTime,
            windowCreatedAt: job.createdAt,
          });
      returnedStatus = status;
      if (
        status.mode !== job.mode ||
        (status.status !== "IN_QUEUE" &&
          status.status !== "IN_PROGRESS" &&
          status.status !== "DONE") ||
        !status.reportId ||
        (status.status === "DONE" && !status.documentId)
      ) {
        throw new SpApiError("品牌營收報表建立回應不完整，已停止重試。", {
          status: 409,
          code: "REPORT_MISMATCH",
        });
      }
      if (
        leg === "shipment" &&
        (!("dataStartTime" in status) ||
          !("dataEndTime" in status) ||
          status.dataStartTime !== job.shipmentDataStartTime ||
          status.dataEndTime !== job.shipmentDataEndTime)
      ) {
        throw new SpApiError("品牌營收報表的固定日期邊界不一致。", {
          status: 409,
          code: "REPORT_MISMATCH",
        });
      }
      await this.saveBrandSalesLeg(job, leg, {
        reportId: status.reportId,
        documentId: status.documentId,
        status: status.status,
        createdAt,
        terminal: null,
        terminalAt: null,
      });
      return null;
    } catch (error) {
      await this.saveBrandSalesLeg(
        job,
        leg,
        returnedStatus?.reportId
          ? {
              reportId: returnedStatus.reportId,
              documentId: null,
              status: "CREATION_UNKNOWN",
              createdAt,
              terminal: "CREATION_UNKNOWN",
              terminalAt: Date.now(),
            }
          : this.brandSalesCreationFailure(error, createdAt),
      );
      return error;
    }
  }

  private async startSharedAllListingsReport(
    marketplaceId: MarketplaceId,
    explicitRetry: boolean,
    signal?: AbortSignal,
    options: Readonly<{ freshCompleted?: boolean }> = {},
  ): Promise<DurableReportStatus> {
    assertBackgroundActive(signal);
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    assertBackgroundActive(signal);
    return this.reportLifecycle.start({
      identity: {
        accountScope,
        marketplaceId,
        mode: usesDemoMode(marketplaceId) ? "demo" : "live",
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
        optionsKey: "preferredReportDocumentLocale=en_US",
      },
      explicitRetry,
      freshCompleted: options.freshCompleted,
      signal,
      create: ({ signal: lifecycleSignal }) => this.brandSalesReports.startListing({
        marketplaceId,
        signal: lifecycleSignal,
      }),
      notices: {
        pending: "Amazon 正在準備全商品清單。",
        done: "Amazon 全商品清單已就緒。",
      },
    });
  }

  private async getSharedAllListingsReportStatus(input: {
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
  }): Promise<DurableReportStatus> {
    assertBackgroundActive(input.signal);
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[input.marketplaceId].region,
    );
    assertBackgroundActive(input.signal);
    return this.reportLifecycle.status({
      identity: {
        accountScope,
        marketplaceId: input.marketplaceId,
        mode: usesDemoMode(input.marketplaceId) ? "demo" : "live",
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
        optionsKey: "preferredReportDocumentLocale=en_US",
      },
      reportId: input.reportId,
      signal: input.signal,
      poll: ({ reportId, signal }) => this.brandSalesReports.getListingStatus({
        marketplaceId: input.marketplaceId,
        reportId,
        signal,
      }),
      notices: {
        pending: "Amazon 正在準備全商品清單。",
        done: "Amazon 全商品清單已就緒。",
      },
    });
  }

  private async ensureBrandSalesListingLeg(
    job: BrandSalesRuntimeJob,
    explicitRetry: boolean,
  ): Promise<unknown | null> {
    if (this.brandSalesLegReusable(job.listing)) return null;
    try {
      await this.startSharedAllListingsReport(
        job.marketplaceId as MarketplaceId,
        explicitRetry,
      );
      const lease = await this.store.getSharedAllListingsReport({
        accountScope: job.accountScope,
        marketplaceId: job.marketplaceId,
      });
      if (!lease || !this.brandSalesLegReusable(lease.report)) {
        throw new SpApiError("全商品報表共用紀錄不完整。", {
          status: 409,
          code: "REPORT_MISMATCH",
        });
      }
      await this.saveBrandSalesLeg(job, "listing", lease.report);
      return null;
    } catch (error) {
      return error;
    }
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
      } else if (!input.retry) {
        const terminal = [job.shipment, job.listing].find((leg) => leg.terminal);
        const code = terminal?.terminal === "CANCELLED"
          ? "REPORT_CANCELLED"
          : terminal?.terminal === "FATAL"
            ? "REPORT_FATAL"
            : "BRAND_REPORT_RETRY_REQUIRED";
        return invalid(
          code === "REPORT_CANCELLED"
            ? "Amazon 已取消上次 FBA 品牌出貨報表；系統不會自動重建，請稍後明確重試。"
            : code === "REPORT_FATAL"
              ? "Amazon 無法完成上次 FBA 品牌出貨報表；系統不會自動重建。"
              : "上次品牌營收工作只完成一部分；已保留成功報表，請按重試只補齊缺少的一側。",
          409,
          code,
        );
      } else {
        const wait = Math.max(
          this.brandSalesRetryWait(job.listing, now),
          this.brandSalesRetryWait(job.shipment, now),
        );
        if (wait > 0) return this.brandSalesWaitReply(wait);
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
        : this.createBrandSalesLeg(job, "shipment"),
    ]);
    const failure = results.find((value) => value !== null);
    if (failure) {
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
          const shipment = await this.brandSalesReports.getShipmentStatus({
            marketplaceId,
            reportId: job.shipment.reportId,
            startDate: job.startDate,
            endDate: job.endDate,
            dataStartTime: job.shipmentDataStartTime,
            dataEndTime: job.shipmentDataEndTime,
            windowCreatedAt: job.createdAt,
          });
          if (shipment.mode !== job.mode) {
            throw new SpApiError("品牌營收報表模式與本機紀錄不一致。", {
              status: 409,
              code: "REPORT_MODE_CHANGED",
            });
          }
          if (
            shipment.status !== "IN_QUEUE" &&
            shipment.status !== "IN_PROGRESS" &&
            shipment.status !== "DONE"
          ) {
            throw new SpApiError("Amazon 未能產生 FBA 品牌出貨報表。", {
              status: 422,
              code: shipment.status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL",
            });
          }
          if (
            shipment.dataStartTime !== job.shipmentDataStartTime ||
            shipment.dataEndTime !== job.shipmentDataEndTime
          ) {
            throw new SpApiError("品牌營收報表日期邊界已改變，已停止讀取。", {
              status: 409,
              code: "REPORT_MISMATCH",
            });
          }
          if (shipment.status === "DONE" && !shipment.documentId) {
            throw new SpApiError("Amazon FBA 品牌出貨報表已完成但缺少文件編號。", {
              status: 502,
              code: "REPORT_FAILED",
            });
          }
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
        job.snapshot = await this.brandSalesReports.getData({
          marketplaceId,
          startDate: job.startDate,
          endDate: job.endDate,
          listingReportId: job.listing.reportId,
          listingDocumentId: job.listing.documentId,
          shipmentReportId: job.shipment.reportId,
          shipmentDocumentId: job.shipment.documentId,
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
      const snapshot = await getUnboundVariationAuditData({
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
        bulletPoints: string[];
        expectedBulletPoints: string[];
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
    const bulletPoints = parseBullets(body.bulletPoints);
    const expectedBulletPoints = parseBullets(body.expectedBulletPoints);
    const ingredients = parseText(body.ingredients, 20_000);
    const expectedIngredients = parseText(body.expectedIngredients, 20_000);
    if (
      !marketplaceId ||
      !sellerSku ||
      title === null ||
      expectedTitle === null ||
      bulletPoints === null ||
      expectedBulletPoints === null ||
      ingredients === null ||
      expectedIngredients === null
    ) {
      return invalid("請提供有效的站點、SKU、標題、最多五個賣點與成分。");
    }
    return {
      marketplaceId,
      sellerSku,
      title,
      expectedTitle,
      bulletPoints,
      expectedBulletPoints,
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
    const scoped = await this.scopedFingerprint(
      input.marketplaceId,
      this.contentFingerprint(input),
    );
    const fingerprint = scoped.fingerprint;
    const changedFields = [
      input.title !== input.expectedTitle ? "標題" : null,
      JSON.stringify(input.bulletPoints) !== JSON.stringify(input.expectedBulletPoints)
        ? "五大賣點"
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
  }

  private contentFingerprint(input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
    title: string;
    expectedTitle: string;
    bulletPoints: string[];
    expectedBulletPoints: string[];
    ingredients: string;
    expectedIngredients: string;
  }): string {
    return stableFingerprint([
      input.marketplaceId,
      input.sellerSku,
      input.expectedTitle,
      input.expectedBulletPoints,
      input.expectedIngredients,
      input.title,
      input.bulletPoints,
      input.ingredients,
    ]);
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
        const candidateSnapshot = await getFbaReviewAuditCandidates({
          marketplaceId,
          reportId: job.listingReportId,
          documentId: job.listingDocumentId!,
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
      assertBackgroundActive(signal);
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

  private async agedInventoryReportIdentity(
    marketplaceId: MarketplaceId,
    signal?: AbortSignal,
  ): Promise<DurableReportIdentity> {
    assertBackgroundActive(signal);
    const accountScope = await this.vault.getAccountScope(
      MARKETPLACES[marketplaceId].region,
    );
    assertBackgroundActive(signal);
    return {
      accountScope,
      marketplaceId,
      mode: usesDemoMode(marketplaceId) ? "demo" : "live",
      reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
      optionsKey: "marketplaceIds=selected",
    };
  }

  private async startSharedAgedInventoryReport(
    marketplaceId: MarketplaceId,
    options: Readonly<{
      explicitRetry: boolean;
      freshCompleted?: boolean;
      signal?: AbortSignal;
    }>,
  ) {
    const identity = await this.agedInventoryReportIdentity(
      marketplaceId,
      options.signal,
    );
    return this.reportLifecycle.start({
      identity,
      explicitRetry: options.explicitRetry,
      freshCompleted: options.freshCompleted,
      signal: options.signal,
      create: ({ signal: lifecycleSignal }) => this.agedInventoryReports.start({
        marketplaceId,
        signal: lifecycleSignal,
      }),
      notices: {
        pending: "Amazon 正在準備 FBA 庫齡資料；完成後會自動顯示。",
        done: "Amazon FBA 庫齡資料已就緒，正在整理 180 天以上庫存。",
      },
    });
  }

  private async getSharedAgedInventoryReportStatus(input: {
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
  }) {
    const identity = await this.agedInventoryReportIdentity(
      input.marketplaceId,
      input.signal,
    );
    return this.reportLifecycle.status({
      identity,
      reportId: input.reportId,
      signal: input.signal,
      poll: ({ reportId, signal }) => this.agedInventoryReports.status({
        marketplaceId: input.marketplaceId,
        reportId,
        signal,
      }),
      notices: {
        pending: "Amazon 正在準備 FBA 庫齡資料；完成後會自動顯示。",
        done: "Amazon FBA 庫齡資料已就緒，正在整理 180 天以上庫存。",
      },
      classifyTerminal: (error) => error instanceof SpApiError &&
        error.status === 422 &&
        error.code === "REPORT_FAILED"
        ? "FATAL"
        : null,
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
      const snapshot = await getAgedInventoryData({
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
      const data = await getAllListingsExportData({ marketplaceId, reportId, documentId });
      if (auditRequested) {
        return json(
          auditListingContentRows({
            marketplaceId,
            fetchedAt: data.fetchedAt,
            rows: data.rows,
          }),
        );
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
          minimumImages: 5,
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
    return {
      accountScope: await this.vault.getAccountScope(MARKETPLACES[marketplaceId].region),
      mode: usesDemoMode(marketplaceId) ? "demo" : "live",
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
      const data = await getAllListingsExportData({
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

  private async runAuditSuiteInventory(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const marketplaceId = context.marketplaceId as MarketplaceId;
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    let report = await this.startSharedAgedInventoryReport(
      marketplaceId,
      { explicitRetry: false, signal: control.signal },
    );
    assertAuditSuiteActive(control);
    for (let attempt = 0; !report.ready && attempt < 180; attempt += 1) {
      if (report.status !== "IN_QUEUE" && report.status !== "IN_PROGRESS") {
        throw new Error("Amazon 未能產生 FBA 庫齡報表。");
      }
      control.heartbeat({
        message: "Amazon 正在準備 FBA 庫齡報表。",
        completedUnits: 0,
        totalUnits: 1,
      });
      await waitMilliseconds(1_000, control.signal);
      assertAuditSuiteActive(control);
      report = await this.getSharedAgedInventoryReportStatus({
        marketplaceId,
        reportId: report.reportId,
        signal: control.signal,
      });
      assertAuditSuiteActive(control);
    }
    if (!report.ready || !report.documentId || report.mode !== context.mode) {
      throw new Error("FBA 庫齡報表尚未完成或模式不一致。");
    }
    const snapshot = await getAgedInventoryData({
      marketplaceId,
      reportId: report.reportId,
      documentId: report.documentId,
      signal: control.signal,
    });
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    if (snapshot.mode !== context.mode || snapshot.marketplaceId !== marketplaceId) {
      throw new Error("庫齡快照與本次綜合健檢 context 不一致。");
    }
    const over180Rows = snapshot.rows.flatMap((row) => row.ageBuckets
      .filter((bucket) => bucket.over180 && bucket.units > 0)
      .map((bucket) => ({
        sellerSku: row.sellerSku,
        title: row.title,
        asin: row.asin,
        ageBucket: bucket.label,
        quantity: bucket.units,
        notice: row.alert || snapshot.notice,
      })));
    const estimatedExcessRows = snapshot.rows
      .filter((row) => row.estimatedExcessQuantity !== null && row.estimatedExcessQuantity > 0)
      .map((row) => ({
        sellerSku: row.sellerSku,
        title: row.title,
        asin: row.asin,
        estimatedExcessQuantity: row.estimatedExcessQuantity,
        daysOfSupply: row.daysOfSupply,
        recommendedAction: row.recommendedAction,
        notice: row.alert || snapshot.notice,
      }));
    const partial = snapshot.summary.excessAvailability !== "complete";
    return suiteSnapshot({
      context,
      status: partial ? "partial" : "completed",
      fetchedAt: snapshot.fetchedAt,
      notice: partial
        ? `Amazon 預估冗餘欄位覆蓋為 ${snapshot.summary.excessAvailability}；未知未補 0。${snapshot.notice}`
        : snapshot.notice,
      payload: { over180Rows, estimatedExcessRows },
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
    const fieldLabel = { title: "商品標題", bulletPoints: "賣點", ingredients: "成分" } as const;
    const rows = audit.rows.flatMap((row) => row.issues.map((issue) => ({
      sellerSku: row.sellerSku,
      title: row.title,
      asin: row.asin,
      problemType: issue.kind === "SUSPECTED_TYPO" ? "疑似錯字" : issue.message,
      field: fieldLabel[issue.field],
      originalText: issue.field === "title"
        ? row.title
        : issue.field === "bulletPoints"
          ? row.bulletPoints.join("\n")
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
      minimumImages: 5,
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

  private async runAuditSuiteVariation(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const marketplaceId = context.marketplaceId as MarketplaceId;
    const listing = await this.auditSuiteListings(context, control);
    const snapshot = await getUnboundVariationAuditData({
      marketplaceId,
      reportId: listing.reportId,
      documentId: listing.documentId,
      signal: control.signal,
    });
    assertAuditSuiteActive(control);
    await this.assertAuditSuiteContext(context);
    assertAuditSuiteActive(control);
    if (snapshot.mode !== context.mode || snapshot.marketplaceId !== marketplaceId) {
      throw new Error("未綁變體快照與本次綜合健檢 context 不一致。");
    }
    return suiteSnapshot({
      context,
      status: snapshot.incompleteRows.length ? "partial" : "completed",
      fetchedAt: snapshot.fetchedAt,
      notice: snapshot.incompleteRows.length
        ? `${snapshot.incompleteRows.length} 個 SKU relationships 無法安全判定；只列已驗證未綁變體。${snapshot.notice}`
        : snapshot.notice,
      payload: snapshot.rows.map((row) => ({
        sellerSku: row.sellerSku,
        title: row.title,
        asin: row.asin,
        productType: row.productType,
        notice: row.notice,
      })),
    });
  }

  private async runAuditSuiteReview(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) {
    const marketplaceId = context.marketplaceId as MarketplaceId;
    if (!customerFeedbackMarketplaceSupported(marketplaceId)) {
      throw new Error("Amazon Customer Feedback API 不支援此站點；未改用 parent 或私有資料。");
    }
    const listing = await this.auditSuiteListings(context, control);
    const reviewJobId = `suite-review-${context.runId}`;
    const job: ReviewAuditJob = {
      marketplaceId,
      accountScope: context.accountScope,
      expiresAt: Date.now() + REVIEW_AUDIT_JOB_TTL_MS,
      mode: context.mode,
      listingReportId: listing.reportId,
      listingDocumentId: listing.documentId,
      listingStatus: "DONE",
      candidates: null,
      sourceCandidateCount: 0,
      candidateCoverage: null,
      relationshipIncompleteRows: [],
      results: [],
      nextCandidateIndex: 0,
      nextQueryAt: 0,
      snapshot: null,
      signal: control.signal,
      abort: () => undefined,
      retainWhileActive: true,
    };
    this.reviewAuditJobs.set(reviewJobId, job);
    try {
      for (let attempt = 0; !job.snapshot && attempt < 2_000; attempt += 1) {
        assertAuditSuiteActive(control);
        const response = await this.reviewAuditFlight(reviewJobId, job);
        assertAuditSuiteActive(control);
        if (response.status >= 400) {
          const value = response.body.kind === "json" && isPlainRecord(response.body.value)
            ? response.body.value
            : null;
          throw new Error(typeof value?.message === "string"
            ? value.message
              : "評論主題健檢未完成。");
        }
        const totalUnits = job.candidates?.length ?? 1;
        const completedUnits = job.candidates
          ? Math.min(job.nextCandidateIndex, totalUnits)
          : 0;
        control.heartbeat({
          message: job.candidates
            ? `正在依 Amazon 官方限制讀取評論主題（${completedUnits} / ${totalUnits}）。`
            : "Amazon 正在準備評論健檢候選清單。",
          completedUnits,
          totalUnits,
        });
        if (!job.snapshot) {
          await waitMilliseconds(
            Math.max(25, job.nextQueryAt - Date.now()),
            control.signal,
          );
        }
      }
      assertAuditSuiteActive(control);
      if (!job.snapshot) throw new Error("評論主題健檢等待逾時；未建立假快照。");
      const snapshot = job.snapshot;
      const resultRows = snapshot.rows.flatMap((row) => row.sellerSkus.flatMap((sellerSku) => [
        ...row.positiveTopics.map((topic) => ({
          sellerSku,
          title: row.title,
          asin: row.asin,
          topic: topic.topic,
          sentiment: "正向" as const,
          starRatingImpact: topic.starRatingImpact,
          mentions: topic.numberOfMentions,
          occurrencePercent: topic.occurrencePercentage,
          notice: "Amazon Customer Feedback 非 parent ASIN 主題證據。",
        })),
        ...row.negativeTopics.map((topic) => ({
          sellerSku,
          title: row.title,
          asin: row.asin,
          topic: topic.topic,
          sentiment: "負向" as const,
          starRatingImpact: topic.starRatingImpact,
          mentions: topic.numberOfMentions,
          occurrencePercent: topic.occurrencePercentage,
          notice: "Amazon Customer Feedback 非 parent ASIN 主題證據。",
        })),
      ]));
      const incompleteRows = [
        ...snapshot.relationshipIncompleteRows.map((row) => ({
          sellerSku: row.sellerSku,
          title: row.title,
          asin: row.asin,
          code: row.code,
          message: row.message,
        })),
        ...snapshot.rows.flatMap((row) => row.status === "INCOMPLETE" && row.incompleteReason
          ? row.sellerSkus.map((sellerSku) => ({
              sellerSku,
              title: row.title,
              asin: row.asin,
              code: row.incompleteReason!.code,
              message: row.incompleteReason!.message,
            }))
          : []),
      ];
      return suiteSnapshot({
        context,
        status: snapshot.summary.totalIncomplete ? "partial" : "completed",
        fetchedAt: snapshot.fetchedAt,
        notice: snapshot.summary.totalIncomplete
          ? `${snapshot.summary.totalIncomplete} 個非 parent FBA 項目未完成；其餘結果可核對。`
          : snapshot.notice,
        payload: { resultRows, incompleteRows },
      });
    } finally {
      this.deleteReviewAuditJob(reviewJobId);
    }
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
    const start = Date.parse(`${startDate}T00:00:00.000Z`);
    const end = Date.parse(`${endDate}T00:00:00.000Z`);
    const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
    const today = dateKeyInTimeZone(
      new Date(Date.now()),
      MARKETPLACES[input.marketplaceId].timeZone,
    );
    const yesterday = new Date(`${today}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const latest = yesterday.toISOString().slice(0, 10);
    const earliestDate = new Date(yesterday);
    earliestDate.setUTCDate(earliestDate.getUTCDate() - 94);
    const earliest = earliestDate.toISOString().slice(0, 10);
    if (
      start > end ||
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

  private salesAndTrafficIdentity(job: AdvertisingStrategyJob): DurableReportIdentity {
    return {
      accountScope: job.spAccountScope,
      marketplaceId: job.marketplaceId,
      mode: job.mode,
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      optionsKey: `dateGranularity=DAY;asinGranularity=SKU;start=${job.startDate};end=${job.endDate}`,
    };
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
    return this.reportLifecycle.start({
      identity: this.salesAndTrafficIdentity(job),
      explicitRetry: input.explicitRetry,
      freshCompleted: input.refresh,
      signal: job.controller.signal,
      create: ({ signal }) => this.salesAndTrafficReports.start({
        marketplaceId: job.marketplaceId,
        startDate: job.startDate,
        endDate: job.endDate,
        signal,
      }),
      notices: {
        pending: "Amazon 正在準備 SKU 銷售與流量報表。",
        done: "Amazon SKU 銷售與流量報表已就緒。",
      },
    });
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
      status = await this.reportLifecycle.status({
        identity: this.salesAndTrafficIdentity(job),
        reportId: status.reportId,
        signal: job.controller.signal,
        poll: ({ reportId, signal }) => this.salesAndTrafficReports.status({
          marketplaceId: job.marketplaceId,
          reportId,
          startDate: job.startDate,
          endDate: job.endDate,
          signal,
        }),
        notices: {
          pending: "Amazon 正在準備 SKU 銷售與流量報表。",
          done: "Amazon SKU 銷售與流量報表已就緒。",
        },
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
    return this.salesAndTrafficReports.data({
      marketplaceId: job.marketplaceId,
      reportId: status.reportId,
      documentId: status.documentId,
      startDate: job.startDate,
      endDate: job.endDate,
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
        return { notice: error.message, code: "REPORT_RETRY_WAIT" };
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
        reportId = `demo-${marketplaceId}`;
        documentId = reportId;
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
      const data = await getAllListingsExportData({
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
