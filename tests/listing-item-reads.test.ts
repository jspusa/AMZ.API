import { describe, expect, it } from "vitest";
import {
  assertFbaListingPrice,
  normalizeListingPrice,
  type AmazonListingItem,
} from "../src/main/amazon/listing-item-projection";
import { createListingItemReads } from
  "../src/main/amazon/listing-item-reads";
import { createScriptedListingsReadAdapter } from
  "../src/main/amazon/listings-reads";

const US = "ATVPDKIKX0DER" as const;

function listingItem(
  sellerSku: string,
  fulfillmentChannelCode: string,
): AmazonListingItem {
  return {
    sku: sellerSku,
    summaries: [{
      marketplaceId: US,
      asin: sellerSku === "SKU-FBA" ? "B000000001" : "B000000002",
      productType: "PET_FOOD",
      status: ["BUYABLE"],
      itemName: sellerSku,
    }],
    productTypes: [{ marketplaceId: US, productType: "PET_FOOD" }],
    attributes: {
      purchasable_offer: [{
        marketplace_id: US,
        currency: "USD",
        our_price: [{ schedule: [{ value_with_tax: "12.34" }] }],
      }],
    },
    fulfillmentAvailability: [{ fulfillmentChannelCode, quantity: 7 }],
    issues: [],
  };
}

describe("listing item read seam", () => {
  it("keeps raw item transport behind the fixed read adapter", async () => {
    const adapter = createScriptedListingsReadAdapter([{
      operation: "item",
      result: {
        status: 200,
        envelope: listingItem("SKU-FBA", "AMAZON_NA"),
        requestId: "item-request",
        rateLimit: "5",
        retryAfter: null,
        profile: "full",
      },
    }]);
    const reads = createListingItemReads({
      listings: adapter,
      usesDemoMode: () => false,
    });

    await expect(reads.fetchLiveListingItem(US, "SKU-FBA"))
      .resolves.toMatchObject({ requestId: "item-request" });
    expect(adapter.requests).toEqual([{
      operation: "item",
      intent: "listing",
      marketplaceId: US,
      sellerSku: "SKU-FBA",
    }]);
  });

  it("filters non-FBA batch rows while preserving requested order and metadata", async () => {
    const adapter = createScriptedListingsReadAdapter([{
      operation: "search",
      result: {
        status: 200,
        envelope: {
          items: [
            listingItem("SKU-OTHER", "DEFAULT"),
            listingItem("SKU-FBA", "AMAZON_NA"),
          ],
          numberOfResults: 2,
        },
        requestId: "batch-request",
        rateLimit: "0.5",
        retryAfter: null,
        profile: "listing",
      },
    }]);
    const reads = createListingItemReads({
      listings: adapter,
      usesDemoMode: () => false,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
    });

    await expect(
      reads.fetchLiveListingBatch(US, ["SKU-FBA", "SKU-OTHER"]),
    ).resolves.toMatchObject({
      requestedSkus: ["SKU-FBA", "SKU-OTHER"],
      items: [{ sellerSku: "SKU-FBA" }],
      notFound: ["SKU-OTHER"],
      fetchedAt: "2026-08-27T00:00:00.000Z",
      requestId: "batch-request",
      rateLimit: "0.5",
    });
  });

  it("keeps the Seller ID/Listings access probe demo shortcut and fallback flag", async () => {
    const demoAdapter = createScriptedListingsReadAdapter([]);
    const demoReads = createListingItemReads({
      listings: demoAdapter,
      usesDemoMode: () => true,
    });
    await expect(demoReads.verifyListingsAccess(US)).resolves.toEqual({
      requestId: null,
      compatibilityFallback: false,
    });
    expect(demoAdapter.requests).toEqual([]);

    const liveAdapter = createScriptedListingsReadAdapter([{
      operation: "search",
      result: {
        status: 200,
        envelope: { items: [], numberOfResults: 0 },
        requestId: "probe-request",
        rateLimit: null,
        retryAfter: null,
        profile: "minimal",
      },
    }]);
    const liveReads = createListingItemReads({
      listings: liveAdapter,
      usesDemoMode: () => false,
    });
    await expect(liveReads.verifyListingsAccess(US)).resolves.toEqual({
      requestId: "probe-request",
      compatibilityFallback: true,
    });
  });

  it("preserves the exact FBA-only rejection after projection", () => {
    const snapshot = normalizeListingPrice(
      listingItem("SKU-OTHER", "DEFAULT"),
      US,
      "item-request",
    );
    expect(() => assertFbaListingPrice(snapshot)).toThrow(
      "此 SKU 無法確認為 FBA 商品；純 FBA 管理台不會讀取或修改它。",
    );
  });
});
