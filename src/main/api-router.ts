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
  MARKETPLACES,
  SpApiError,
  getAllListingsExportData,
  getAllListingsReportStatus,
  getListingContent,
  getListingImages,
  getListingPrice,
  getRestockPlan,
  getSalesTrend,
  getSubscribeAndSaveOffer,
  isFulfillmentStatus,
  isMarketplaceId,
  previewListingContentUpdate,
  previewListingImageUpdate,
  previewListingPriceUpdate,
  previewListingSalePriceUpdate,
  searchListingsBySku,
  searchOrders,
  startAllListingsReport,
  updateListingContent,
  updateListingImages,
  updateListingPrice,
  updateListingSalePrice,
  usesDemoMode,
  verifyListingsAccess,
  type ListingContentSnapshot,
  type ListingImageSnapshot,
  type ListingPriceSnapshot,
  type MarketplaceId,
  type RestockPlanSnapshot,
  type SalesTrendDays,
  type SubscribeAndSaveOfferSnapshot,
  type UpdateListingSalePriceInput,
} from "./amazon/sp-api";
import { createListingsWorkbook } from "./amazon/xlsx";

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
      },
      status,
      error.retryAfter ? { "retry-after": error.retryAfter } : {},
    );
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
        ? { code: error.code, message: error.message, requestId: error.requestId }
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
            ? "Orders 與 Listings 連線成功。"
            : "目前仍是展示模式。",
          requestId: listings.requestId ?? snapshot.requestId,
        };
      } catch (error) {
        result.regions[region] = {
          ok: false,
          message: error instanceof SpApiError
            ? `Listings 驗證失敗：${error.message} 請核對 Seller ID 與 Product Listing 權限。`
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
      case "GET /api/sp-api/replenishment-plan":
        return this.replenishment(request);
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
    const days = integer(request.query.days, 7, 7, 30);
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");
    if (days === null || ![7, 14, 30].includes(days)) {
      return invalid("銷售趨勢只支援最近 7、14 或 30 天。");
    }
    try {
      return json(
        await getSalesTrend({
          marketplaceId,
          days: days as SalesTrendDays,
        }),
      );
    } catch (error) {
      return apiError(error, "載入 FBA 銷售趨勢時發生未預期的錯誤。");
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
        confirmationSku: string;
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
      confirmationSku: typeof body.confirmationSku === "string" ? body.confirmationSku : "",
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
    if (input.confirmationSku !== input.sellerSku) {
      return invalid("送出商品內容前，請重新輸入完整 SKU。", 400, "CONFIRMATION_REQUIRED");
    }
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

  private async exportStatusOrDownload(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const reportId = this.reportIdentifier(request.query.reportId);
    if (!marketplaceId || !reportId) {
      return invalid("報表查詢資訊無效，請重新匯出。");
    }
    if (request.query.download !== "1") {
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
        "Amazon SP-API 連線",
        live ? "ready" : "attention",
        "automatic",
        live
          ? `${marketplace.label}已使用 macOS Keychain 中的 ${region.toUpperCase()} 憑證。`
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
      notice: "自我檢查只讀取本機設定狀態，不會修改 Amazon、廣告或實體入庫。",
    });
  }

  private async adsStatus(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon Ads 站點。");
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
      notice:
        "Amazon Ads 需要獨立申請與授權，不能沿用 SP-API。這個極簡版保留狀態檢查與一鍵開啟官方 Ads Console；SP 繼續由 Helium 10 管理。",
    });
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
