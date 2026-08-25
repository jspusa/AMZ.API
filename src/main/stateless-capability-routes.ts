import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  DEFAULT_MARKETPLACE_ID,
  type MarketplaceId,
} from "../shared/marketplaces";
import {
  isOrderFulfillmentStatus,
  type OrderFulfillmentStatus,
  type OrdersReadsPort,
} from "./amazon/orders-reads";
import { MARKETPLACES } from "./amazon/sp-api";
import type { RouterRequestContextAdapter } from "./router-request-context";
import {
  bodyRecord,
  integer,
  parseAsin,
  parseMarketplace,
  parseSellerSku,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";

export interface StatelessCapabilityRoutesPort {
  orders(request: ApiRequest): Promise<ApiResponse>;
  batchListings(request: ApiRequest): Promise<ApiResponse>;
  subscribeSave(request: ApiRequest): Promise<ApiResponse>;
  variationFamily(request: ApiRequest): Promise<ApiResponse>;
}

export type StatelessCapabilityRoutesDependencies = Readonly<{
  context: RouterRequestContextAdapter;
  orders: OrdersReadsPort;
  searchListings(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSkus: string[];
  }>): Promise<unknown>;
  readSubscription(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): Promise<unknown>;
  readVariationFamily(input:
    | Readonly<{
        marketplaceId: MarketplaceId;
        sellerSku: string;
      }>
    | Readonly<{
        marketplaceId: MarketplaceId;
        asin: string;
      }>): Promise<unknown>;
}>;

/** Semantic owner for stateless, read-only Amazon capability routes. */
export class StatelessCapabilityRoutes implements StatelessCapabilityRoutesPort {
  private readonly context: RouterRequestContextAdapter;
  private readonly ordersReads: OrdersReadsPort;
  private readonly searchListings:
    StatelessCapabilityRoutesDependencies["searchListings"];
  private readonly readSubscription:
    StatelessCapabilityRoutesDependencies["readSubscription"];
  private readonly readVariationFamily:
    StatelessCapabilityRoutesDependencies["readVariationFamily"];

  constructor(input: StatelessCapabilityRoutesDependencies) {
    this.context = input.context;
    this.ordersReads = input.orders;
    this.searchListings = input.searchListings;
    this.readSubscription = input.readSubscription;
    this.readVariationFamily = input.readVariationFamily;
  }

  async orders(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(
      request.query.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
    );
    const days = integer(request.query.days, 14, 1, 90);
    const requestedFulfillmentStatus = request.query.status || null;
    let fulfillmentStatus: OrderFulfillmentStatus | null = null;
    const paginationToken = request.query.paginationToken || null;
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");
    if (days === null) return invalid("日期範圍必須介於 1 到 90 天。");
    if (requestedFulfillmentStatus) {
      if (!isOrderFulfillmentStatus(requestedFulfillmentStatus)) {
        return invalid("不支援這個訂單狀態。");
      }
      fulfillmentStatus = requestedFulfillmentStatus;
    }
    if (paginationToken && paginationToken.length > 4_096) {
      return invalid("分頁資訊無效，請重新查詢。");
    }
    try {
      const snapshot = await this.ordersReads.read({
        intent: "dashboard-page",
        marketplaceId,
        days,
        fulfillmentStatus,
        paginationToken,
      });
      return json({ ...snapshot, marketplace: MARKETPLACES[marketplaceId] });
    } catch (error) {
      return routeError(error, "載入訂單時發生未預期的錯誤。");
    }
  }

  async batchListings(request: ApiRequest): Promise<ApiResponse> {
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
      const context = await this.context.capture(marketplaceId);
      const value = await this.searchListings({ marketplaceId, sellerSkus: skus });
      await this.context.assertCurrent(context);
      return json(value);
    } catch (error) {
      return routeError(error, "批次查詢 SKU 時發生未預期的錯誤。");
    }
  }

  async subscribeSave(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    if (!marketplaceId || !sellerSku) {
      return invalid("請選擇站點並輸入完整 SKU。");
    }
    try {
      const context = await this.context.capture(marketplaceId);
      const value = await this.readSubscription({ marketplaceId, sellerSku });
      await this.context.assertCurrent(context);
      return json(value);
    } catch (error) {
      return routeError(error, "查詢 Subscribe & Save 時發生未預期的錯誤。");
    }
  }

  async variationFamily(request: ApiRequest): Promise<ApiResponse> {
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
      const context = await this.context.capture(marketplaceId);
      const value = await this.readVariationFamily({
        marketplaceId,
        ...(sellerSku ? { sellerSku } : { asin: asin! }),
      });
      await this.context.assertCurrent(context);
      return json(value);
    } catch (error) {
      return routeError(error, "查詢變體 family 時發生未預期的錯誤。");
    }
  }
}
