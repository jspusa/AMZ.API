import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  buildBrandSalesSnapshot,
  type BrandSalesListing,
  type BrandSalesSnapshot,
  type BrandShipmentSale,
} from "./brand-sales";
import type { FbaCatalogSeed } from "./catalog-report-reads";
import {
  assertFbaShipmentSalesWindow,
  type FbaShipmentSalesWindow,
} from "./revenue-report-windows";
import { SpApiError } from "./sp-api-error";
import type { BrandSalesDemoSource } from "./fba-revenue-reports";

export function createBrandSalesDemoSource(dependencies: Readonly<{
  listings(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>): readonly FbaCatalogSeed[] | Promise<readonly FbaCatalogSeed[]>;
}>): BrandSalesDemoSource {
  return Object.freeze({
    async read(
      input: Readonly<FbaShipmentSalesWindow & { signal?: AbortSignal }>,
    ) {
      if (input.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const window = assertFbaShipmentSalesWindow(input);
      const marketplace = marketplaceById(
        input.marketplaceId as MarketplaceId,
      );
      if (!marketplace) {
        throw new SpApiError("展示品牌營收站點無法辨識。", {
          status: 400,
          code: "INVALID_INPUT",
        });
      }
      const listings: BrandSalesListing[] = (
        await dependencies.listings({
          marketplaceId: input.marketplaceId,
          signal: input.signal,
        })
      ).map(({ sellerSku, title }) => ({ sellerSku, title }));
      const sales: BrandShipmentSale[] = listings.map((listing, index) => ({
        shipmentDate: input.startDate,
        sellerSku: listing.sellerSku,
        quantity: index + 1,
        unitPrice: marketplace.currency === "JPY"
          ? 1_280 + index * 300
          : 12.99 + index * 2.5,
        currencyCode: marketplace.currency,
      }));
      return buildBrandSalesSnapshot({
        mode: "demo",
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        currencyCode: marketplace.currency,
        listings,
        sales,
        dataThrough: window.dataEndTime,
        rangeFreshness: window.rangeFreshness,
      });
    },
  });
}
