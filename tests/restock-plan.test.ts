import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceId } from "../src/shared/marketplaces";
import {
  fbaInventoryReadIdentity,
  type FbaInventoryReplenishmentAdapter,
} from "../src/main/amazon/fba-inventory-replenishment";
import type { ListingPriceSnapshot } from
  "../src/main/amazon/listing-price-types";
import {
  createRestockPlanPort,
  type RestockPlanDependencies,
} from "../src/main/amazon/restock-plan";

const US_MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");

function listingPrice(input: {
  sellerSku: string;
  mode?: "live" | "demo";
  quantity?: number | null;
}): ListingPriceSnapshot {
  return {
    mode: input.mode ?? "demo",
    marketplaceId: US_MARKETPLACE_ID,
    sellerSku: input.sellerSku,
    asin: "B000000001",
    title: "FBA test item",
    productType: "PET_SUPPLIES",
    status: ["BUYABLE", "DISCOVERABLE"],
    createdAt: null,
    updatedAt: null,
    standardPrice: { amount: 19.99, currencyCode: "USD" },
    effectivePrice: { amount: 19.99, currencyCode: "USD" },
    minimumPrice: null,
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice: null,
    discountedPricePresence: "absent",
    hasDiscountedPrice: false,
    hasAutomatedPricing: false,
    fetchedAt: NOW.toISOString(),
    requestId: null,
    issues: [],
    fulfillmentAvailability: [
      {
        channelCode: "AMAZON_NA",
        quantity: input.quantity ?? 10.9,
        fulfillment: "FBA",
        editable: false,
      },
    ],
    notice: null,
  };
}

function unreachableInventoryAdapter(): FbaInventoryReplenishmentAdapter {
  return {
    async readInventory() {
      throw new Error("Inventory should not be read in this test.");
    },
    async readReplenishment() {
      throw new Error("Replenishment should not be read in this test.");
    },
  };
}

function dependencies(
  overrides: Partial<RestockPlanDependencies> = {},
): RestockPlanDependencies {
  return {
    resolveMode: () => "demo",
    readDemoListingPrice: (_marketplaceId, sellerSku) =>
      listingPrice({ sellerSku }),
    readLiveListingPrice: async (_marketplaceId, sellerSku) =>
      listingPrice({ sellerSku, mode: "live" }),
    inventoryAdapter: unreachableInventoryAdapter(),
    getAccessToken: async () => "TEST_ACCESS_TOKEN",
    invalidateAccessToken: () => undefined,
    isSkillConnected: () => false,
    clock: () => new Date(NOW),
    ...overrides,
  };
}

function inventoryAdapter(input: {
  sellerSku: string;
  beforeRead?: () => Promise<void>;
}): FbaInventoryReplenishmentAdapter {
  return {
    async readInventory(plan) {
      await input.beforeRead?.();
      return {
        identity: fbaInventoryReadIdentity(plan),
        envelope: {
          payload: {
            inventorySummaries: [
              {
                asin: "B000000001",
                fnSku: "X000000001",
                sellerSku: input.sellerSku,
                inventoryDetails: {
                  fulfillableQuantity: 7,
                  inboundWorkingQuantity: 2,
                  inboundShippedQuantity: 3,
                  inboundReceivingQuantity: 4,
                  reservedQuantity: { totalReservedQuantity: 1 },
                  unfulfillableQuantity: { totalUnfulfillableQuantity: 0 },
                  researchingQuantity: { totalResearchingQuantity: 0 },
                },
              },
            ],
          },
        },
        requestId: "inventory-request",
        rateLimit: "inventory-rate",
      };
    },
    async readReplenishment() {
      throw new Error("Restock planning must not read replenishment offers.");
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("restock plan semantic port", () => {
  it("preserves FBA inventory-position math, case-pack rounding, and action", async () => {
    const port = createRestockPlanPort(dependencies());

    const snapshot = await port.get({
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku: "CASE-PACK-SKU",
      targetDays: 60,
      leadTimeDays: 4,
      safetyDays: 2,
      casePack: 8,
    });

    expect(snapshot.inventory).toEqual({
      fulfillable: 10,
      reserved: 4,
      inboundWorking: 12,
      inboundShipped: 18,
      inboundReceiving: 6,
      unfulfillable: 1,
      researching: 0,
      inventoryPosition: 46,
    });
    expect(snapshot.demand).toMatchObject({
      lookbackDays: 30,
      units: 54,
      averageDailyUnits: 1.8,
      ordersScanned: 37,
      partial: false,
    });
    expect(snapshot).toMatchObject({
      action: "RESTOCK_NOW",
      daysOfCover: 10 / 1.8,
      reorderPoint: 11,
      recommendedUnits: 64,
      forecastStockoutAt: "2026-03-16T01:20:00.000Z",
      fetchedAt: NOW.toISOString(),
      skillConnected: false,
    });
  });

  it("keeps demo reads local and reports the optional Skill connection", async () => {
    const readDemoListingPrice = vi.fn(
      (_marketplaceId: MarketplaceId, sellerSku: string) =>
        listingPrice({ sellerSku }),
    );
    const readLiveListingPrice = vi.fn();
    const inventory = unreachableInventoryAdapter();
    const readInventory = vi.spyOn(inventory, "readInventory");
    const getAccessToken = vi.fn(async () => "TEST_ACCESS_TOKEN");
    const port = createRestockPlanPort(dependencies({
      readDemoListingPrice,
      readLiveListingPrice,
      inventoryAdapter: inventory,
      getAccessToken,
      isSkillConnected: () => true,
    }));

    const snapshot = await port.get({
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku: "DEMO-SKU",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
    });

    expect(readDemoListingPrice).toHaveBeenCalledOnce();
    expect(readLiveListingPrice).not.toHaveBeenCalled();
    expect(readInventory).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      mode: "demo",
      requestId: null,
      rateLimit: null,
      skillConnected: true,
    });
    expect(snapshot.notice).toContain("已偵測到補貨 Skill 接點");
  });

  it("starts live Sales, Listings, and FBA Inventory reads concurrently", async () => {
    const sellerSku = "LIVE-SKU";
    const accessToken = deferred<string>();
    const listing = deferred<ListingPriceSnapshot>();
    const inventory = deferred<void>();
    const started = new Set<string>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ payload: [] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-amzn-requestid": "sales-request",
            "x-amzn-ratelimit-limit": "sales-rate",
          },
        })),
    );
    const port = createRestockPlanPort(dependencies({
      resolveMode: () => "live",
      getAccessToken: async () => {
        started.add("sales");
        return accessToken.promise;
      },
      readLiveListingPrice: async () => {
        started.add("listing");
        return listing.promise;
      },
      inventoryAdapter: inventoryAdapter({
        sellerSku,
        beforeRead: async () => {
          started.add("inventory");
          return inventory.promise;
        },
      }),
    }));

    const result = port.get({
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku,
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
    });

    expect([...started].sort()).toEqual(["inventory", "listing", "sales"]);
    accessToken.resolve("TEST_ACCESS_TOKEN");
    listing.resolve(listingPrice({ sellerSku, mode: "live", quantity: 7 }));
    inventory.resolve();

    await expect(result).resolves.toMatchObject({
      mode: "live",
      requestId: "inventory-request",
      rateLimit: "inventory-rate",
      demand: {
        lookbackDays: 30,
        units: 0,
        averageDailyUnits: 0,
        ordersScanned: 0,
        partial: false,
      },
      action: "NO_DEMAND",
      daysOfCover: null,
      reorderPoint: 0,
      recommendedUnits: 0,
    });
  });

  it("maps Sales planning and API failures to the public SpApiError contract", async () => {
    const demoPort = createRestockPlanPort(dependencies());
    await expect(demoPort.get({
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku: " ",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
    })).rejects.toMatchObject({
      name: "SpApiError",
      status: 400,
      code: "INVALID_SALES_TREND_RANGE",
      message: "FBA Sales Velocity 必須使用完整且精確的 Seller SKU。",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ errors: [] }), {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-amzn-requestid": "sales-denied",
          },
        })),
    );
    const livePort = createRestockPlanPort(dependencies({
      resolveMode: () => "live",
      inventoryAdapter: inventoryAdapter({ sellerSku: "LIVE-SKU" }),
    }));
    await expect(livePort.get({
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku: "LIVE-SKU",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
    })).rejects.toMatchObject({
      name: "SpApiError",
      status: 403,
      code: "SALES_METRICS_UNAUTHORIZED",
      requestId: "sales-denied",
    });
  });
});
