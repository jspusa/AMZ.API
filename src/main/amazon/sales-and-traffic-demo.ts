import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import type { SalesAndTrafficDemoSource } from "./sales-and-traffic-reports";
import type { SalesAndTrafficSnapshot } from "./sales-and-traffic-reads";
import type { FbaCatalogSeed } from "./catalog-report-reads";
import { SpApiError } from "./sp-api-error";

export function createSalesAndTrafficDemoSource(dependencies: Readonly<{
  listings(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>): readonly FbaCatalogSeed[] | Promise<readonly FbaCatalogSeed[]>;
}>): SalesAndTrafficDemoSource {
  return Object.freeze({
    async read(input: Readonly<{
      marketplaceId: MarketplaceId;
      startDate: string;
      endDate: string;
      signal?: AbortSignal;
    }>): Promise<SalesAndTrafficSnapshot> {
      if (input.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const marketplace = marketplaceById(input.marketplaceId);
      if (!marketplace) {
        throw new SpApiError("展示銷售與流量站點無法辨識。", {
          status: 400,
          code: "INVALID_INPUT",
        });
      }
      const listings = await dependencies.listings({
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      });
      return Object.freeze({
        mode: "demo",
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        fetchedAt: new Date().toISOString(),
        rows: listings.map((listing, index) => {
          const unitsOrdered = Math.max(1, 12 - index * 2);
          return Object.freeze({
            sellerSku: listing.sellerSku,
            childAsin: listing.asin,
            unitsOrdered,
            orderedProductSales: Number(
              (unitsOrdered * (24.99 + index * 5)).toFixed(2),
            ),
            currencyCode: marketplace.currency,
          });
        }),
        notice: "展示資料只供廣告策略表版面測試，不是你的真實 Amazon 銷售。",
      });
    },
  });
}
