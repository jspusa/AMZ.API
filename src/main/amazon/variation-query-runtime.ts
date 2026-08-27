import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingBatchSnapshot } from "./listing-item-reads";
import type { ListingPriceIdentity } from "./listing-price-gateway";
import type { ListingPriceSnapshot } from "./listing-price-types";
import { SpApiError } from "./sp-api-error";
import type { VariationDemoRuntime } from "./variation-demo-runtime";
import type { VariationFamilySnapshot } from "./variation-family";

export type VariationFamilyQuery = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku?: string;
  asin?: string;
}>;

export type ListingSkuBatchQuery = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSkus: string[];
}>;

/** Fixed semantic live reads; no caller can provide transport controls. */
export type VariationQueryLivePort = Readonly<{
  readFamily(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): Promise<VariationFamilySnapshot>;
  resolveSellerSkuByAsin(input: Readonly<{
    marketplaceId: MarketplaceId;
    asin: string;
  }>): Promise<string>;
  fetchListingBatch(
    marketplaceId: MarketplaceId,
    sellerSkus: string[],
  ): Promise<ListingBatchSnapshot>;
}>;

export type VariationQueryRuntimeDependencies = Readonly<{
  resolveMode(marketplaceId: MarketplaceId): "live" | "demo";
  demo: VariationDemoRuntime;
  live: VariationQueryLivePort;
  readDemoListingPrice(identity: ListingPriceIdentity): ListingPriceSnapshot;
}>;

export type VariationQueryRuntime = Readonly<{
  getFamily(input: VariationFamilyQuery): Promise<VariationFamilySnapshot>;
  searchBySku(input: ListingSkuBatchQuery): Promise<ListingBatchSnapshot>;
}>;

async function getFamily(
  dependencies: VariationQueryRuntimeDependencies,
  input: VariationFamilyQuery,
): Promise<VariationFamilySnapshot> {
  if (Boolean(input.sellerSku) === Boolean(input.asin)) {
    throw new SpApiError(
      "變體 family 必須且只能提供 Seller SKU 或 ASIN 其中一項。",
      { status: 400, code: "INVALID_INPUT" },
    );
  }
  if (dependencies.resolveMode(input.marketplaceId) === "demo") {
    const sellerSku = input.sellerSku ??
      dependencies.demo.resolveSellerSkuByAsin(
        input.marketplaceId,
        input.asin!,
      );
    return dependencies.demo.readFamily(input.marketplaceId, sellerSku);
  }
  const sellerSku = input.sellerSku ??
    await dependencies.live.resolveSellerSkuByAsin({
      marketplaceId: input.marketplaceId,
      asin: input.asin!,
    });
  return dependencies.live.readFamily({
    marketplaceId: input.marketplaceId,
    sellerSku,
  });
}

async function searchBySku(
  dependencies: VariationQueryRuntimeDependencies,
  input: ListingSkuBatchQuery,
): Promise<ListingBatchSnapshot> {
  if (!input.sellerSkus.length || input.sellerSkus.length > 20) {
    throw new SpApiError("批次查詢一次必須包含 1 到 20 個 SKU。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  if (dependencies.resolveMode(input.marketplaceId) === "demo") {
    const items: ListingPriceSnapshot[] = [];
    const notFound: string[] = [];
    for (const sellerSku of input.sellerSkus) {
      try {
        items.push(dependencies.readDemoListingPrice({
          marketplaceId: input.marketplaceId,
          sellerSku,
        }));
      } catch (error) {
        if (error instanceof SpApiError && error.code === "SKU_NOT_FOUND") {
          notFound.push(sellerSku);
          continue;
        }
        throw error;
      }
    }
    return {
      mode: "demo",
      marketplaceId: input.marketplaceId,
      requestedSkus: input.sellerSkus,
      items,
      notFound,
      fetchedAt: new Date().toISOString(),
      requestId: null,
      rateLimit: null,
      notice: "展示資料只供操作測試，不會讀取或變更 Amazon。",
    };
  }
  return dependencies.live.fetchListingBatch(
    input.marketplaceId,
    input.sellerSkus,
  );
}

/** Owns the fixed demo/live selection for variation and SKU batch queries. */
export function createVariationQueryRuntime(
  dependencies: VariationQueryRuntimeDependencies,
): VariationQueryRuntime {
  return Object.freeze({
    getFamily: (input) => getFamily(dependencies, input),
    searchBySku: (input) => searchBySku(dependencies, input),
  });
}
