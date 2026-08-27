import { throwIfAborted } from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import {
  type AmazonListingItem,
  type AmazonListingSearchResponse,
  assertExactListingIdentity,
  assertFbaListingPrice,
  isRecord,
  listingPriceIsFba,
  normalizeListingPrice,
} from "./listing-item-projection";
import type { ListingPriceSnapshot } from "./listing-price-types";
import {
  exactListingEnvelopeIdentity,
  readListingsItem,
  searchListingsItems,
  type ListingsReadAdapter,
  type ListingsSearchReadResult,
} from "./listings-reads";
import { throwListingsReadError } from "./listings-response-error";
import { SpApiError } from "./sp-api-error";

export type ListingBatchSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  requestedSkus: string[];
  items: ListingPriceSnapshot[];
  notFound: string[];
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string | null;
};

export interface ListingItemReads {
  fetchLiveListingItem(
    marketplaceId: MarketplaceId,
    sellerSku: string,
    signal?: AbortSignal,
  ): Promise<{ payload: AmazonListingItem; requestId: string | null }>;
  fetchLiveListingPrice(
    marketplaceId: MarketplaceId,
    sellerSku: string,
  ): Promise<ListingPriceSnapshot>;
  executeListingsSearchRequest(
    marketplaceId: MarketplaceId,
    sellerSkus: string[],
    signal?: AbortSignal,
  ): Promise<ListingsSearchReadResult>;
  verifyListingsAccess(
    marketplaceId: MarketplaceId,
  ): Promise<{ requestId: string | null; compatibilityFallback: boolean }>;
  fetchLiveListingBatch(
    marketplaceId: MarketplaceId,
    sellerSkus: string[],
  ): Promise<ListingBatchSnapshot>;
}

export function createListingItemReads(dependencies: Readonly<{
  listings: ListingsReadAdapter;
  usesDemoMode(marketplaceId: MarketplaceId): boolean;
  now?: () => Date;
}>): ListingItemReads {
  const now = dependencies.now ?? (() => new Date());

  async function fetchLiveListingItem(
    marketplaceId: MarketplaceId,
    sellerSku: string,
    signal?: AbortSignal,
  ): Promise<{ payload: AmazonListingItem; requestId: string | null }> {
    const result = await readListingsItem(dependencies.listings, {
      intent: "listing",
      marketplaceId,
      sellerSku,
      signal,
    });
    throwIfAborted(signal);
    if (result.status < 200 || result.status >= 300) {
      return throwListingsReadError(result, "getListingsItem");
    }
    if (!isRecord(result.envelope)) {
      throw new SpApiError("Amazon 回傳了無法辨識的 Listing 資料。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId: result.requestId,
      });
    }
    const payload = result.envelope as AmazonListingItem;
    assertExactListingIdentity(payload, marketplaceId, sellerSku);
    return { payload, requestId: result.requestId };
  }

  async function fetchLiveListingPrice(
    marketplaceId: MarketplaceId,
    sellerSku: string,
  ): Promise<ListingPriceSnapshot> {
    const { payload, requestId } = await fetchLiveListingItem(
      marketplaceId,
      sellerSku,
    );
    const listing = normalizeListingPrice(payload, marketplaceId, requestId);
    assertFbaListingPrice(listing);
    return listing;
  }

  async function executeListingsSearchRequest(
    marketplaceId: MarketplaceId,
    sellerSkus: string[],
    signal?: AbortSignal,
  ): Promise<ListingsSearchReadResult> {
    return searchListingsItems(dependencies.listings, {
      intent: "sku-batch",
      marketplaceId,
      sellerSkus,
      signal,
    });
  }

  async function verifyListingsAccess(
    marketplaceId: MarketplaceId,
  ): Promise<{ requestId: string | null; compatibilityFallback: boolean }> {
    if (dependencies.usesDemoMode(marketplaceId)) {
      return { requestId: null, compatibilityFallback: false };
    }
    const result = await searchListingsItems(dependencies.listings, {
      intent: "access-probe",
      marketplaceId,
    });
    if (result.status < 200 || result.status >= 300) {
      return throwListingsReadError(result, "searchListingsItems");
    }
    return {
      requestId: result.requestId,
      compatibilityFallback: result.profile === "minimal",
    };
  }

  async function fetchLiveListingBatch(
    marketplaceId: MarketplaceId,
    sellerSkus: string[],
  ): Promise<ListingBatchSnapshot> {
    const result = await executeListingsSearchRequest(
      marketplaceId,
      sellerSkus,
    );
    if (result.status < 200 || result.status >= 300) {
      return throwListingsReadError(result, "searchListingsItems");
    }

    const payload = isRecord(result.envelope)
      ? result.envelope as AmazonListingSearchResponse
      : null;
    if (!payload || !Array.isArray(payload.items)) {
      throw new SpApiError("Amazon 回傳了無法辨識的批次 Listing 資料。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId: result.requestId,
      });
    }
    if (
      Boolean(payload.pagination?.nextToken) ||
      (typeof payload.numberOfResults === "number" &&
        payload.numberOfResults !== payload.items.length)
    ) {
      throw new SpApiError(
        "Amazon 批次 Listing 回應含未完成分頁或列數不一致，已停止使用。",
        {
          status: 502,
          code: "UPSTREAM_UNAVAILABLE",
          requestId: result.requestId,
        },
      );
    }
    const returnedSkus = new Set<string>();
    for (const item of payload.items) {
      const sellerSku = typeof item.sku === "string" ? item.sku : "";
      if (
        !sellerSkus.includes(sellerSku) ||
        returnedSkus.has(sellerSku) ||
        !exactListingEnvelopeIdentity(item, marketplaceId, sellerSku)
      ) {
        throw new SpApiError(
          "Amazon 批次 Listing 回應的 SKU、ASIN、商品類型或站點身分不完整，已停止使用。",
          {
            status: 409,
            code: "LISTING_IDENTITY_MISMATCH",
            requestId: result.requestId,
          },
        );
      }
      returnedSkus.add(sellerSku);
    }
    const normalized = payload.items
      .map((item) => normalizeListingPrice(item, marketplaceId, result.requestId))
      .filter(listingPriceIsFba);
    const bySku = new Map(normalized.map((item) => [item.sellerSku, item]));
    const items = sellerSkus
      .map((sellerSku) => bySku.get(sellerSku))
      .filter((item): item is ListingPriceSnapshot => Boolean(item));

    return {
      mode: "live",
      marketplaceId,
      requestedSkus: sellerSkus,
      items,
      notFound: sellerSkus.filter((sellerSku) => !bySku.has(sellerSku)),
      fetchedAt: now().toISOString(),
      requestId: result.requestId,
      rateLimit: result.rateLimit,
      notice: null,
    };
  }

  return Object.freeze({
    fetchLiveListingItem,
    fetchLiveListingPrice,
    executeListingsSearchRequest,
    verifyListingsAccess,
    fetchLiveListingBatch,
  });
}
