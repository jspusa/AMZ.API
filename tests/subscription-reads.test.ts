import { describe, expect, it, vi } from "vitest";
import {
  createScriptedFbaInventoryReplenishmentAdapter,
  type FbaInventoryReplenishmentAdapter,
} from "../src/main/amazon/fba-inventory-replenishment";
import { createSubscriptionReads } from
  "../src/main/amazon/subscription-reads";
import type { MarketplaceId } from "../src/shared/marketplaces";

const US = "ATVPDKIKX0DER" as const;
const JP = "A1VC38T7YXB528" as const;
const SG = "A19VAU5U5O7RUS" as const;
const NOW = new Date("2026-08-24T12:34:56.000Z");

const unusedAdapter: FbaInventoryReplenishmentAdapter = {
  async readInventory() {
    throw new Error("Demo mode must not read FBA Inventory.");
  },
  async readReplenishment() {
    throw new Error("Demo mode must not read Replenishment.");
  },
};

function demoListing(
  marketplaceId: MarketplaceId = US,
  quantity = 38,
) {
  return {
    asin: "B000000001",
    standardPrice: {
      amount: marketplaceId === JP ? 1_980 : 17.99,
      currencyCode: marketplaceId === JP ? "JPY" : "USD",
    },
    fulfillmentAvailability: [{
      channelCode: marketplaceId === JP ? "AMAZON_JP" : "AMAZON_NA",
      quantity,
      fulfillment: "FBA" as const,
      editable: false,
    }],
  };
}

describe("SubscriptionReads", () => {
  it("builds the unchanged deterministic single-offer DTO through injected demo reads and clock", async () => {
    const readDemoListingPrice = vi.fn(() => demoListing());
    const reads = createSubscriptionReads({
      resolveMode: () => "demo",
      inventoryAdapter: unusedAdapter,
      readDemoListingPrice,
      clock: () => new Date(NOW.getTime()),
    });

    const snapshot = await reads.getSubscribeAndSaveOffer({
      marketplaceId: US,
      sellerSku: "EXACT-FBA-SKU",
    });

    expect(readDemoListingPrice).toHaveBeenCalledWith(US, "EXACT-FBA-SKU");
    expect(snapshot).toMatchObject({
      mode: "demo",
      marketplaceId: US,
      sellerSku: "EXACT-FBA-SKU",
      found: true,
      asin: "B000000001",
      eligibility: "ELIGIBLE",
      inventory: 38,
      subscriptions: 42,
      fetchedAt: NOW.toISOString(),
      requestId: null,
      rateLimit: "1 request/second",
      writable: false,
    });
  });

  it("preserves Japan demo values and zero-inventory suspension semantics", async () => {
    const reads = createSubscriptionReads({
      resolveMode: () => "demo",
      inventoryAdapter: unusedAdapter,
      readDemoListingPrice: (marketplaceId) => demoListing(marketplaceId, 0),
      clock: () => new Date(NOW.getTime()),
    });

    await expect(reads.getSubscribeAndSaveOffer({
      marketplaceId: JP,
      sellerSku: "AFA100-JP",
    })).resolves.toMatchObject({
      eligibility: "SUSPENDED",
      inventory: 0,
      subscriptions: 19,
      stockRisk: "HIGH",
      forecastDeliveries: {
        next15Days: 7,
        next30Days: 13,
        next60Days: 26,
        next90Days: 38,
      },
    });
  });

  it("rejects unsupported official Replenishment marketplaces before any demo listing read", async () => {
    const readDemoListingPrice = vi.fn(() => demoListing());
    const reads = createSubscriptionReads({
      resolveMode: () => "demo",
      inventoryAdapter: unusedAdapter,
      readDemoListingPrice,
    });

    await expect(reads.getSubscribeAndSaveOffer({
      marketplaceId: SG,
      sellerSku: "EXACT-FBA-SKU",
    })).rejects.toMatchObject({
      status: 422,
      code: "REPLENISHMENT_MARKETPLACE_UNSUPPORTED",
    });
    expect(readDemoListingPrice).not.toHaveBeenCalled();
  });

  it("keeps demo audit month, coverage, missing-month and fetchedAt semantics", async () => {
    const reads = createSubscriptionReads({
      resolveMode: () => "demo",
      inventoryAdapter: unusedAdapter,
      readDemoListingPrice: () => demoListing(),
      clock: () => new Date(NOW.getTime()),
    });

    const snapshot = await reads.getFbaSubscriptionAudit({
      marketplaceId: US,
      months: 2,
    });

    expect(snapshot).toMatchObject({
      mode: "demo",
      marketplaceId: US,
      requestedMonths: 2,
      fetchedAt: NOW.toISOString(),
      inventoryEvidence: {
        coverage: "complete",
        returnedInventoryRows: 5,
        provenSkuCount: 5,
        verifiableReplenishmentOfferCount: 5,
        unverifiedFbaSkuCount: 0,
      },
    });
    expect(snapshot.intervals.map(({ month }) => month)).toEqual([
      "2026-06",
      "2026-07",
    ]);
    expect(snapshot.offers).toHaveLength(5);
    expect(snapshot.offers[4]?.monthlySeries).toHaveLength(1);
  });

  it("preserves live adapter orchestration, clock injection and abort fences", async () => {
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      {
        operation: "inventory",
        result: {
          envelope: {
            payload: {
              inventorySummaries: [{
                sellerSku: "EXACT-FBA-SKU",
                asin: "B000000001",
                fnSku: "X000000001",
                inventoryDetails: {
                  fulfillableQuantity: 0,
                  inboundWorkingQuantity: 0,
                  inboundShippedQuantity: 0,
                  inboundReceivingQuantity: 0,
                  reservedQuantity: { totalReservedQuantity: 0 },
                  unfulfillableQuantity: { totalUnfulfillableQuantity: 0 },
                  researchingQuantity: { totalResearchingQuantity: 0 },
                },
              }],
            },
            pagination: {},
          },
          requestId: "inventory-request",
          rateLimit: "2",
        },
      },
      {
        operation: "replenishment",
        result: {
          envelope: {
            offers: [{
              marketplaceId: US,
              programType: "SUBSCRIBE_AND_SAVE",
              sku: "EXACT-FBA-SKU",
              asin: "B000000001",
              eligibility: "ELIGIBLE",
              price: 17.99,
            }],
          },
          requestId: "replenishment-request",
          rateLimit: "1",
        },
      },
    ]);
    const reads = createSubscriptionReads({
      resolveMode: () => "live",
      inventoryAdapter: adapter,
      readDemoListingPrice: () => {
        throw new Error("Live mode must not read demo listings.");
      },
      clock: () => new Date(NOW.getTime()),
    });

    await expect(reads.getSubscribeAndSaveOffer({
      marketplaceId: US,
      sellerSku: "EXACT-FBA-SKU",
    })).resolves.toMatchObject({
      mode: "live",
      fetchedAt: NOW.toISOString(),
      requestId: "replenishment-request",
    });
    expect(adapter.requests.map(({ intent }) => intent)).toEqual([
      "item",
      "single-offer",
    ]);

    const controller = new AbortController();
    controller.abort(new Error("subscription audit cancelled"));
    await expect(reads.getFbaSubscriptionAudit({
      marketplaceId: US,
      months: 2,
      signal: controller.signal,
    })).rejects.toThrow(/subscription audit cancelled/u);
  });

  it("keeps the official 23-complete-month validation boundary", async () => {
    const reads = createSubscriptionReads({
      resolveMode: () => "demo",
      inventoryAdapter: unusedAdapter,
      readDemoListingPrice: () => demoListing(),
      clock: () => new Date(NOW.getTime()),
    });

    await expect(reads.getFbaSubscriptionAudit({
      marketplaceId: US,
      months: 24,
    })).rejects.toThrow(/1 到 23/u);
  });
});
