import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  ListingContentCapabilitiesPort,
} from "./listing-content-capabilities";
import type { ListingContentSnapshot } from "./listing-content-types";
import type { ListingItemReads } from "./listing-item-reads";
import {
  assertFbaListingPayload,
  listingProductType,
  normalizeListingContent,
  type AmazonListingItem,
} from "./listing-item-projection";

export type ListingContentReadProductionInput = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
  allowReadOnlySchema?: boolean;
  forceCapabilityRefresh?: boolean;
  capabilityRefreshScope?: object;
}>;

export type ListingContentReadProductionResult = Readonly<{
  listing: ListingContentSnapshot;
  payload: AmazonListingItem;
}>;

export interface ListingContentReadProduction {
  read(
    input: ListingContentReadProductionInput,
  ): Promise<ListingContentReadProductionResult>;
}

export function createListingContentReadProduction(
  dependencies: Readonly<{
    listingItems: Pick<ListingItemReads, "fetchLiveListingItem">;
    contentCapabilities: Pick<ListingContentCapabilitiesPort, "read">;
  }>,
): ListingContentReadProduction {
  return Object.freeze({
    async read(input: ListingContentReadProductionInput) {
      const { payload, requestId } =
        await dependencies.listingItems.fetchLiveListingItem(
          input.marketplaceId,
          input.sellerSku,
        );
      assertFbaListingPayload(payload);
      const productType = listingProductType(payload, input.marketplaceId);
      const capabilityResult = await dependencies.contentCapabilities.read({
        marketplaceId: input.marketplaceId,
        productType,
        allowGenericFallback: input.allowReadOnlySchema ?? false,
        forceRefresh: input.forceCapabilityRefresh ?? false,
        ...(input.capabilityRefreshScope
          ? { refreshScope: input.capabilityRefreshScope }
          : {}),
      });
      const notice = capabilityResult.degradedReason
        ? `${capabilityResult.degradedReason} 內容仍取自 Amazon Listing attributes。`
        : null;
      return {
        payload,
        listing: normalizeListingContent(
          payload,
          input.marketplaceId,
          requestId,
          capabilityResult.capabilities,
          "live",
          notice,
        ),
      };
    },
  });
}
