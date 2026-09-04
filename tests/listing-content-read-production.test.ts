import { describe, expect, it, vi } from "vitest";
import type { MarketplaceId } from "../src/shared/marketplaces";
import type {
  ContentCapabilities,
  ListingContentCapabilitiesPort,
} from "../src/main/amazon/listing-content-capabilities";
import type {
  AmazonListingItem,
} from "../src/main/amazon/listing-item-projection";
import type { ListingItemReads } from
  "../src/main/amazon/listing-item-reads";
import { createListingContentReadProduction } from
  "../src/main/amazon/listing-content-read-production";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as MarketplaceId;
const SELLER_SKU = "CONTENT READ SKU/01";

function fieldCapability(languageTags: string[] = ["en_US"]) {
  return {
    supported: true,
    editable: true,
    required: false,
    minItems: null,
    maxItems: null,
    minLength: null,
    maxLength: null,
    maxUtf8Bytes: null,
    languageTags,
    reason: null,
  } as const;
}

function capabilities(): ContentCapabilities {
  return {
    title: fieldCapability(),
    itemHighlight: fieldCapability(),
    bulletPoints: fieldCapability(),
    productDescription: fieldCapability(),
    ingredients: fieldCapability(),
    images: [],
    schemaChecksum: "CONTENT-READ-SCHEMA",
  };
}

function listingPayload(
  fulfillmentChannelCode = "AMAZON_NA",
): AmazonListingItem {
  return {
    sku: SELLER_SKU,
    summaries: [{
      marketplaceId: MARKETPLACE_ID,
      asin: "B000000001",
      productType: "SUMMARY_PRODUCT_TYPE",
      itemName: "Summary title",
      status: ["BUYABLE"],
    }],
    productTypes: [{
      marketplaceId: MARKETPLACE_ID,
      productType: "PET_FOOD",
    }],
    attributes: {
      item_name: [{
        value: "Listing attribute title",
        language_tag: "en_US",
        marketplace_id: MARKETPLACE_ID,
      }],
      bullet_point: [{
        value: "Listing bullet",
        language_tag: "en_US",
        marketplace_id: MARKETPLACE_ID,
      }],
    },
    fulfillmentAvailability: [{ fulfillmentChannelCode, quantity: 3 }],
    issues: [],
  };
}

function createDependencies(input: Readonly<{
  payload?: AmazonListingItem;
  degradedReason?: string | null;
}> = {}) {
  const payload = input.payload ?? listingPayload();
  const fetchLiveListingItem = vi.fn(async () => ({
    payload,
    requestId: "CONTENT-READ-REQUEST",
  }));
  const readCapabilities = vi.fn(async () => ({
    capabilities: capabilities(),
    degradedReason: input.degradedReason ?? null,
  }));
  const listingItems = {
    fetchLiveListingItem,
  } satisfies Pick<ListingItemReads, "fetchLiveListingItem">;
  const contentCapabilities = {
    read: readCapabilities,
    clear: vi.fn(),
  } satisfies ListingContentCapabilitiesPort;
  return {
    payload,
    fetchLiveListingItem,
    readCapabilities,
    reader: createListingContentReadProduction({
      listingItems,
      contentCapabilities,
    }),
  };
}

describe("Listing Content production read context", () => {
  it("reads one exact FBA listing and forwards schema policy flags", async () => {
    const dependencies = createDependencies({
      degradedReason: "Amazon 目前只提供通用商品欄位規格；內容可唯讀。",
    });

    const refreshScope = {};
    const result = await dependencies.reader.read({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      allowReadOnlySchema: true,
      forceCapabilityRefresh: true,
      capabilityRefreshScope: refreshScope,
    });

    expect(dependencies.fetchLiveListingItem).toHaveBeenCalledOnce();
    expect(dependencies.fetchLiveListingItem).toHaveBeenCalledWith(
      MARKETPLACE_ID,
      SELLER_SKU,
    );
    expect(dependencies.readCapabilities).toHaveBeenCalledWith({
      marketplaceId: MARKETPLACE_ID,
      productType: "PET_FOOD",
      allowGenericFallback: true,
      forceRefresh: true,
      refreshScope,
    });
    expect(result.payload).toBe(dependencies.payload);
    expect(result.listing).toMatchObject({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      productType: "PET_FOOD",
      title: "Listing attribute title",
      bulletPoints: ["Listing bullet"],
      requestId: "CONTENT-READ-REQUEST",
      notice:
        "Amazon 目前只提供通用商品欄位規格；內容可唯讀。 內容仍取自 Amazon Listing attributes。",
    });
  });

  it("uses strict schema defaults and the normal live notice", async () => {
    const dependencies = createDependencies();

    const result = await dependencies.reader.read({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(dependencies.readCapabilities).toHaveBeenCalledWith({
      marketplaceId: MARKETPLACE_ID,
      productType: "PET_FOOD",
      allowGenericFallback: false,
      forceRefresh: false,
    });
    expect(result.listing.notice).toBe(
      "內容取自你提交給 Amazon 的 Listing attributes；買家頁採用結果可能稍後更新。",
    );
  });

  it("fails closed before a schema read when the listing is not proven FBA", async () => {
    const dependencies = createDependencies({
      payload: listingPayload("DEFAULT"),
    });

    await expect(dependencies.reader.read({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).rejects.toMatchObject({
      status: 422,
      code: "FBA_ONLY",
    });
    expect(dependencies.readCapabilities).not.toHaveBeenCalled();
  });
});
