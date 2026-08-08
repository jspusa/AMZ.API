import { createHash, randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  ApiRequest,
  ApiResponse,
  ConnectionTestResult,
  CredentialSummary,
} from "../shared/contracts";
import { CredentialVault } from "./credential-vault";
import { LocalStore, type ProductMasterState } from "./local-store";
import {
  PUBLIC_ACCOUNTING_CAPABILITIES,
  buildAccountingAccessPlan,
  type AccountingAccessPlan,
  type AccountingCapability,
  type AccountingCapabilityId,
} from "./amazon/accounting-capabilities";
import { auditListingContentRows } from "./amazon/content-quality";
import { auditListingImageRows } from "./amazon/image-audit";
import {
  auditAdvertisingCoverage,
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
  getFbaShipmentSalesReportStatus,
  getListingContent,
  getListingImages,
  getListingPrice,
  getRestockPlan,
  getSalesTrend,
  getFbaSubscriptionAudit,
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
  type RestockPlanSnapshot,
  type SalesTrendComparisonMode,
  type SalesTrendPresetDays,
  type SubscribeAndSaveOfferSnapshot,
  type SubscriptionAuditSnapshot,
  type UpdateListingSalePriceInput,
  type UnboundVariationAuditSnapshot,
  type VariationMoveInput,
} from "./amazon/sp-api";
import {
  ReplenishmentAuditError,
  subscriptionAuditDiscountBucket,
} from "./amazon/replenishment-audit";
import { createSubscriptionAuditWorkbook } from "./amazon/subscription-audit-xlsx";
import {
  createAgedInventoryWorkbook,
  createImageAuditWorkbook,
  createListingsWorkbook,
  createUnboundVariationWorkbook,
} from "./amazon/xlsx";

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

type JsonRecord = Record<string, unknown>;

const JSON_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

const MARKETPLACE_CODES: Record<MarketplaceId, string> = {
  ATVPDKIKX0DER: "US",
  A1VC38T7YXB528: "JP",
  A2EUQ1WTGCTBG2: "CA",
  A19VAU5U5O7RUS: "SG",
  A39IBJ37TRP1C6: "AU",
  A1F83G8C2ARO7P: "GB",
  A1PA6795UKMFR9: "DE",
};

const SUBSCRIPTION_AUDIT_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
const UNBOUND_VARIATION_AUDIT_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
const IMAGE_AUDIT_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
const BRAND_SALES_JOB_TTL_MS = 30 * 60 * 1_000;

type ImageAuditSnapshot = ReturnType<typeof auditListingImageRows>;

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
  return json({ code: "INTERNAL_ERROR", message: fallback }, 500);
}

function invalid(message: string, status = 400, code = "INVALID_INPUT"): ApiResponse {
  return json({ code, message }, status);
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
  private readonly brandSalesJobs = new Map<
    string,
    {
      marketplaceId: MarketplaceId;
      accountScope: string;
      expiresAt: number;
      startDate: string;
      endDate: string;
      mode: "live" | "demo";
      listingReportId: string;
      listingDocumentId: string | null;
      listingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE";
      shipmentReportId: string;
      shipmentDocumentId: string | null;
      shipmentStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE";
      shipmentDataStartTime: string;
      shipmentDataEndTime: string;
      snapshot: BrandSalesSnapshot | null;
    }
  >();

  constructor(input: {
    store: LocalStore;
    vault: CredentialVault;
    approveWrite: WriteApproval;
  }) {
    this.store = input.store;
    this.vault = input.vault;
    this.approveWrite = input.approveWrite;
  }

  clearPreviews(): void {
    this.previews.clear();
    this.subscriptionAuditSnapshots.clear();
    this.unboundVariationAuditSnapshots.clear();
    this.imageAuditSnapshots.clear();
    this.brandSalesJobs.clear();
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
      na: "ATVPDKIKX0DER",
      fe: "A1VC38T7YXB528",
      eu: "A1F83G8C2ARO7P",
    };
    const result: ConnectionTestResult = {
      ok: false,
      testedAt: new Date().toISOString(),
      regions: {},
    };
    for (const region of ["na", "fe", "eu"] as const) {
      if (!summary.regions[region].configured) continue;
      try {
        const snapshot = await searchOrders({
          marketplaceId: representatives[region],
          lastUpdatedAfter: new Date(Date.now() - 86_400_000).toISOString(),
          fulfilledBy: "AMAZON",
          maxResultsPerPage: 1,
        });
        const listings = await verifyListingsAccess(representatives[region]);
        result.regions[region] = {
          ok: snapshot.mode === "live",
          message: snapshot.mode === "live"
            ? listings.compatibilityFallback
              ? "Orders 與 Listings 連線成功；Listings 使用唯讀相容參數。"
              : "Orders 與 Listings 連線成功。"
            : "目前仍是展示模式。",
          requestId: listings.requestId ?? snapshot.requestId,
        };
      } catch (error) {
        result.regions[region] = {
          ok: false,
          message: error instanceof SpApiError
            ? error.status === 400
              ? `Listings 驗證失敗：${error.message} 請核對 Merchant Token 是否與目前 Refresh Token 屬於同一 Seller 帳號。`
              : error.status === 401 || error.status === 403
                ? `Listings 驗證失敗：${error.message} 請確認 Product Listing 角色後重新授權 App。`
                : `Listings 驗證失敗：${error.message}`
            : "連線測試失敗。",
          requestId: error instanceof SpApiError ? error.requestId : null,
        };
      }
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
      default:
        return invalid("此 App 版本不支援這個操作。", 404, "NOT_FOUND");
    }
  }

  private async orders(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId ?? "ATVPDKIKX0DER");
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
    const marketplaceId = parseMarketplace(request.query.marketplaceId ?? "ATVPDKIKX0DER");
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

  private brandSalesJobReply(
    jobId: string,
    job: (typeof this.brandSalesJobs extends Map<string, infer Entry> ? Entry : never),
  ): ApiResponse {
    const ready =
      job.listingStatus === "DONE" &&
      Boolean(job.listingDocumentId) &&
      job.shipmentStatus === "DONE" &&
      Boolean(job.shipmentDocumentId);
    const status = ready
      ? "DONE"
      : job.listingStatus === "IN_PROGRESS" || job.shipmentStatus === "IN_PROGRESS"
        ? "IN_PROGRESS"
        : "IN_QUEUE";
    return json(
      {
        jobId,
        mode: job.mode,
        marketplaceId: job.marketplaceId,
        startDate: job.startDate,
        endDate: job.endDate,
        ready,
        status,
        message: ready
          ? "Amazon FBA 品牌出貨資料已就緒。"
          : "Amazon 正在準備 FBA 品牌出貨與目前商品清單。",
      },
      ready ? 200 : 202,
    );
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
      typeof endDate !== "string"
    ) {
      return invalid("品牌營收需要有效站點與完整 YYYY-MM-DD 日期範圍。");
    }
    try {
      const accountScope = await this.vault.getAccountScope(
        MARKETPLACES[marketplaceId].region,
      );
      const [listing, shipment] = await Promise.all([
        startAllListingsReport({ marketplaceId }),
        startFbaShipmentSalesReport({ marketplaceId, startDate, endDate }),
      ]);
      if (listing.mode !== shipment.mode) {
        return invalid(
          "品牌營收的 FBA 商品與出貨報表模式不一致，已停止合併。",
          409,
          "REPORT_MISMATCH",
        );
      }
      if (
        (listing.status !== "IN_QUEUE" &&
          listing.status !== "IN_PROGRESS" &&
          listing.status !== "DONE") ||
        (shipment.status !== "IN_QUEUE" &&
          shipment.status !== "IN_PROGRESS" &&
          shipment.status !== "DONE")
      ) {
        return invalid("Amazon 未能開始建立品牌營收報表。", 422, "REPORT_FAILED");
      }
      const jobId = randomUUID();
      this.pruneBrandSalesJobs();
      const job = {
        marketplaceId,
        accountScope,
        expiresAt: Date.now() + BRAND_SALES_JOB_TTL_MS,
        startDate,
        endDate,
        mode: shipment.mode,
        listingReportId: listing.reportId,
        listingDocumentId: listing.documentId,
        listingStatus: listing.status,
        shipmentReportId: shipment.reportId,
        shipmentDocumentId: shipment.documentId,
        shipmentStatus: shipment.status,
        shipmentDataStartTime: shipment.dataStartTime,
        shipmentDataEndTime: shipment.dataEndTime,
        snapshot: null,
      };
      this.brandSalesJobs.set(jobId, job);
      return this.brandSalesJobReply(jobId, job);
    } catch (error) {
      return apiError(error, "開始整理 FBA 品牌營收時發生未預期的錯誤。");
    }
  }

  private async brandSalesStatusOrData(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = this.reportIdentifier(request.query.jobId);
    if (!marketplaceId || !jobId) {
      return invalid("品牌營收工作資訊無效，請重新同步。");
    }
    this.pruneBrandSalesJobs();
    const job = this.brandSalesJobs.get(jobId);
    if (!job || job.marketplaceId !== marketplaceId) {
      return invalid(
        "品牌營收工作已過期或站點不符，請重新同步。",
        410,
        "SNAPSHOT_EXPIRED",
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
      if (job.listingStatus !== "DONE" || !job.listingDocumentId) {
        const listing = await getAllListingsReportStatus({
          marketplaceId,
          reportId: job.listingReportId,
        });
        if (
          listing.status !== "IN_QUEUE" &&
          listing.status !== "IN_PROGRESS" &&
          listing.status !== "DONE"
        ) {
          return invalid("Amazon 未能產生目前 FBA 商品清單。", 422, "REPORT_FAILED");
        }
        job.listingStatus = listing.status;
        job.listingDocumentId = listing.documentId;
      }
      if (job.shipmentStatus !== "DONE" || !job.shipmentDocumentId) {
        const shipment = await getFbaShipmentSalesReportStatus({
          marketplaceId,
          reportId: job.shipmentReportId,
          startDate: job.startDate,
          endDate: job.endDate,
          dataStartTime: job.shipmentDataStartTime,
          dataEndTime: job.shipmentDataEndTime,
        });
        if (
          shipment.status !== "IN_QUEUE" &&
          shipment.status !== "IN_PROGRESS" &&
          shipment.status !== "DONE"
        ) {
          return invalid("Amazon 未能產生 FBA 品牌出貨報表。", 422, "REPORT_FAILED");
        }
        job.shipmentStatus = shipment.status;
        job.shipmentDocumentId = shipment.documentId;
      }
      const ready =
        job.listingStatus === "DONE" &&
        Boolean(job.listingDocumentId) &&
        job.shipmentStatus === "DONE" &&
        Boolean(job.shipmentDocumentId);
      if (request.query.data !== "1") return this.brandSalesJobReply(jobId, job);
      if (!ready || !job.listingDocumentId || !job.shipmentDocumentId) {
        return invalid("Amazon 品牌營收報表尚未完成。", 409, "REPORT_NOT_READY");
      }
      if (!job.snapshot) {
        job.snapshot = await getBrandSalesData({
          marketplaceId,
          startDate: job.startDate,
          endDate: job.endDate,
          listingReportId: job.listingReportId,
          listingDocumentId: job.listingDocumentId,
          shipmentReportId: job.shipmentReportId,
          shipmentDocumentId: job.shipmentDocumentId,
          shipmentDataStartTime: job.shipmentDataStartTime,
          shipmentDataEndTime: job.shipmentDataEndTime,
        });
      }
      return json(structuredClone(job.snapshot));
    } catch (error) {
      return apiError(error, "整理 FBA 品牌營收時發生未預期的錯誤。");
    }
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
      return json(await getListingPrice(identity));
    } catch (error) {
      return apiError(error, "查詢 SKU 價格時發生未預期的錯誤。");
    }
  }

  private async variationFamily(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.listingIdentity(request);
    if ("status" in identity) return identity;
    try {
      return json(await getVariationFamilyPlanner(identity));
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
      const status = await startAllListingsReport({ marketplaceId });
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
        const filename = `amazon-fba-unbound-variation-audit-${marketplace.shortLabel.toLowerCase()}-${stored.snapshot.fetchedAt.slice(0, 10)}.xlsx`;
        return bytes(
          workbook,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          {
            "content-disposition": `attachment; filename="${filename}"`,
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
        const status = await getAllListingsReportStatus({ marketplaceId, reportId });
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
        execute: () => updateListingPrice(input),
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
      return json(await getListingContent(identity));
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
        execute: () => updateListingContent(input),
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
      return json(await getListingImages(identity));
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
        execute: () => updateListingImages(input),
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
        execute: () => updateListingSalePrice(input),
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
    const months = integer(request.query.months, 6, 1, 23);
    if (!marketplaceId || months === null) {
      return invalid("請選擇支援的站點；月度歷史只能選 1 到 23 個完整月份。");
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
      const bucket = exactBucket ?? 0;
      return {
        bucket,
        problem: rawDiscount === null
          ? "Amazon 未回傳 Seller 基礎折扣；為保留資料暫列 0% 工作表，並非 0%。"
          : exactBucket === null
            ? `Amazon 回傳非標準 Seller 基礎折扣 ${rawDiscount}%；為保留資料暫列 0% 工作表，並非 0%。`
            : `${bucket}% Seller 基礎折扣組`,
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
      notice: "這是只讀整合掃描；只有完成預檢、確認與 macOS 本機授權後，才可能寫入 Amazon。",
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
    if (supplyRoute === "AWD_TO_FBA" && marketplaceId !== "ATVPDKIKX0DER") {
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
        : "圖片已在 Mac 本機完成格式與像素檢查；設定自己的 R2 公開網域後即可一鍵送交 Amazon。",
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
      const status = await startAllListingsReport({ marketplaceId });
      return json({ ...status, message: status.notice }, status.ready ? 200 : 202);
    } catch (error) {
      return apiError(error, "開始建立全商品 Excel 時發生未預期的錯誤。");
    }
  }

  private async startAgedInventory(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) {
      return invalid("請選擇要查詢庫齡的 Amazon 站點。");
    }
    try {
      const status = await startAgedInventoryReport({ marketplaceId });
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
        const status = await getAgedInventoryReportStatus({
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
        storageCostAvailability: snapshot.summary.storageCostAvailability,
        agedSurchargeAvailability: snapshot.summary.agedSurchargeAvailability,
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
        const status = await getAllListingsReportStatus({ marketplaceId, reportId });
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
    const marketplaceId = parseMarketplace(request.query.marketplaceId ?? "ATVPDKIKX0DER");
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
          ? `${marketplace.label}已設定 macOS Keychain 中的 ${region.toUpperCase()} 憑證；本項只核對本機設定，未代表即時驗證 Amazon 連線。`
          : "尚未輸入此區域的 LWA、Refresh Token 與 Seller ID，目前使用展示資料。",
        live ? null : "開啟右上角 Mac 安全連線，輸入 SP-API 憑證",
      ),
      check(
        "keychain",
        "macOS Keychain 加密",
        summary.encryptionAvailable ? "ready" : "attention",
        "automatic",
        summary.encryptionAvailable
          ? "Refresh Token 與 Client Secret 只以加密密文保存於這台 Mac。"
          : "Keychain 不可用；系統已拒絕保存任何 API 憑證。",
      ),
      check(
        "operation-ledger",
        "本機防重送帳本",
        "ready",
        "automatic",
        "每筆 Amazon 寫入都有確認碼、內容指紋與 24 小時結果狀態；不會盲目重送。",
      ),
      check(
        "product-master",
        "中央 SKU 商品主檔",
        "ready",
        "automatic",
        "箱入數、交期、AWD 緩衝與效期設定保存在這台 Mac，所有補貨工具共用。",
      ),
      check(
        "image-storage",
        "圖片拖拉與公開來源",
        summary.imageStorageConfigured ? "ready" : "attention",
        "one_click",
        summary.imageStorageConfigured
          ? "圖片會在 Mac 驗證後上傳到你自己的 R2 公開網域，再交由 Amazon 讀取。"
          : "本機拖拉與格式檢查可用；正式送出圖片前需設定自己的 R2 公開 HTTPS 網域。",
        summary.imageStorageConfigured ? null : "Mac 安全連線 → 圖片空間 → 加入 R2 設定",
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
        "Mac App 內部 IPC 白名單",
        "macOS Keychain 加密",
        "FBA-only 固定條件",
        "精確 Seller SKU 驗證",
        "Amazon Validation Preview",
        "舊值衝突檢查",
        "本機持久 Idempotency 防重送",
        "大幅調價二次確認",
        "Touch ID／系統確認",
        "送出後只讀回查，不自動重送",
      ],
      notice: "自我檢查只讀取本機設定狀態，未代表即時驗證 Amazon 連線；不會修改 Amazon、廣告或實體入庫。",
    });
  }

  private async adsStatus(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon Ads 站點。");
    const coverageAuditAvailable =
      process.env.SP_API_MODE?.toLowerCase() === "demo";
    return json({
      marketplaceId,
      marketplaceCode: MARKETPLACE_CODES[marketplaceId],
      configured: false,
      verified: false,
      lwaConfigured: false,
      profileConfigured: false,
      writeEnabled: false,
      scope: "advertising::campaign_management",
      supportedProducts: ["SPONSORED_BRANDS", "SPONSORED_DISPLAY"],
      separateFromSpApi: true,
      coverageAuditAvailable,
      coverageAuditNotice: coverageAuditAvailable
        ? "目前是展示模式，可驗證 ProductAI 命名與同 ASIN 覆蓋規則；結果不是你的真實 Amazon Ads 資料。"
        : "廣告覆蓋引擎已完成，但 Amazon Ads API 尚未連線；目前不會用展示結果冒充真實覆蓋。",
      notice:
        "Amazon Ads 需要獨立申請與授權，不能沿用 SP-API。這個極簡版保留狀態檢查與一鍵開啟官方 Ads Console；SP 繼續由 Helium 10 管理。",
    });
  }

  private async adsCoverage(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon Ads 站點。");
    if (process.env.SP_API_MODE?.toLowerCase() !== "demo") {
      return invalid(
        "Amazon Ads API 尚未連線；廣告覆蓋健檢已備妥，但不會用展示活動冒充真實資料。",
        422,
        "ADS_API_NOT_CONNECTED",
      );
    }
    try {
      const reference = `demo-${marketplaceId}`;
      const data = await getAllListingsExportData({
        marketplaceId,
        reportId: reference,
        documentId: reference,
      });
      const listings = data.rows
        .filter((row) => /^[A-Z0-9]{10}$/u.test(row.asin))
        .map((row) => ({
          sellerSku: row.sellerSku,
          asin: row.asin,
          title: row.title,
        }));
      const campaigns: AdvertisingCoverageCampaign[] = listings
        .filter((_, index) => index % 2 === 0)
        .map((listing, index) => ({
          campaignId: `demo-productai-${index + 1}`,
          name: `[ProductAI] ${MARKETPLACE_CODES[marketplaceId]}-${listing.asin}-${listing.sellerSku}-SP-PAT-Aug92026`,
          state: "ENABLED",
          adProduct: "SPONSORED_PRODUCTS",
        }));
      return json(
        auditAdvertisingCoverage({
          mode: "demo",
          marketplaceId,
          marketplaceCode: MARKETPLACE_CODES[marketplaceId],
          listings,
          campaigns,
        }),
      );
    } catch (error) {
      return apiError(error, "執行展示廣告覆蓋健檢時發生未預期的錯誤。");
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
