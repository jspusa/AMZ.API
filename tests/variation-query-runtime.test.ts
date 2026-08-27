import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListingPriceSnapshot } from
  "../src/main/amazon/listing-price-types";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { VariationDemoRuntime } from
  "../src/main/amazon/variation-demo-runtime";
import type { VariationFamilySnapshot } from
  "../src/main/amazon/variation-family";
import {
  createVariationQueryRuntime,
  type VariationQueryLivePort,
} from "../src/main/amazon/variation-query-runtime";

const US = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-08-27T07:08:09.000Z");

function family(sellerSku: string, mode: "live" | "demo"):
  VariationFamilySnapshot {
  return {
    mode,
    marketplaceId: US,
    queriedSku: sellerSku,
    queriedRole: "standalone",
    queried: {
      sellerSku,
      asin: "B000000001",
      title: `Listing ${sellerSku}`,
      productType: "PET_SUPPLIES",
      status: ["BUYABLE"],
      role: "standalone",
      parentSku: null,
      childSkus: [],
      variationTheme: null,
      dimensions: [],
      fba: true,
      issues: [],
      relationshipSources: [],
    },
    parent: null,
    children: [],
    excludedChildren: [],
    variationTheme: null,
    dimensionNames: [],
    familyComplete: true,
    fetchedAt: NOW.toISOString(),
    requestIds: [],
    writable: false,
    boundaries: [],
    notice: `${mode} family`,
  };
}

function listing(sellerSku: string): ListingPriceSnapshot {
  return {
    mode: "demo",
    marketplaceId: US,
    sellerSku,
    asin: "B000000001",
    title: `Listing ${sellerSku}`,
    productType: "PET_SUPPLIES",
    status: ["BUYABLE"],
    createdAt: null,
    updatedAt: null,
    standardPrice: { amount: 10, currencyCode: "USD" },
    effectivePrice: { amount: 10, currencyCode: "USD" },
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
    fulfillmentAvailability: [{
      channelCode: "AMAZON_NA",
      quantity: 1,
      fulfillment: "FBA",
      editable: false,
    }],
    notice: null,
  };
}

function testPorts(mode: "live" | "demo") {
  const demo: VariationDemoRuntime = {
    readFamily: vi.fn((_, sellerSku) => family(sellerSku, "demo")),
    resolveSellerSkuByAsin: vi.fn(() => "DEMO-ASIN-SKU"),
  };
  const live: VariationQueryLivePort = {
    readFamily: vi.fn(async ({ sellerSku }) => family(sellerSku, "live")),
    resolveSellerSkuByAsin: vi.fn(async () => "LIVE-ASIN-SKU"),
    fetchListingBatch: vi.fn(async (marketplaceId, sellerSkus) => ({
      mode: "live" as const,
      marketplaceId,
      requestedSkus: sellerSkus,
      items: [],
      notFound: sellerSkus,
      fetchedAt: NOW.toISOString(),
      requestId: "LIVE-BATCH-REQUEST",
      rateLimit: "5",
      notice: null,
    })),
  };
  const readDemoListingPrice = vi.fn(({ sellerSku }) => listing(sellerSku));
  return {
    demo,
    live,
    readDemoListingPrice,
    runtime: createVariationQueryRuntime({
      resolveMode: () => mode,
      demo,
      live,
      readDemoListingPrice,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("variation query runtime", () => {
  it("requires exactly one Seller SKU or ASIN before selecting a mode", async () => {
    const { runtime, demo, live } = testPorts("demo");

    for (const input of [
      { marketplaceId: US },
      { marketplaceId: US, sellerSku: "SKU-ONE", asin: "B000000001" },
    ]) {
      await expect(runtime.getFamily(input)).rejects.toMatchObject({
        status: 400,
        code: "INVALID_INPUT",
        message: "變體 family 必須且只能提供 Seller SKU 或 ASIN 其中一項。",
      });
    }
    expect(demo.readFamily).not.toHaveBeenCalled();
    expect(demo.resolveSellerSkuByAsin).not.toHaveBeenCalled();
    expect(live.readFamily).not.toHaveBeenCalled();
    expect(live.resolveSellerSkuByAsin).not.toHaveBeenCalled();
  });

  it("uses the demo runtime for exact SKU and ASIN family queries", async () => {
    const { runtime, demo, live } = testPorts("demo");

    await expect(runtime.getFamily({
      marketplaceId: US,
      sellerSku: "EXACT-DEMO-SKU",
    })).resolves.toEqual(family("EXACT-DEMO-SKU", "demo"));
    await expect(runtime.getFamily({
      marketplaceId: US,
      asin: "B000000001",
    })).resolves.toEqual(family("DEMO-ASIN-SKU", "demo"));

    expect(demo.resolveSellerSkuByAsin).toHaveBeenCalledOnce();
    expect(demo.resolveSellerSkuByAsin).toHaveBeenCalledWith(
      US,
      "B000000001",
    );
    expect(demo.readFamily).toHaveBeenNthCalledWith(
      1,
      US,
      "EXACT-DEMO-SKU",
    );
    expect(demo.readFamily).toHaveBeenNthCalledWith(
      2,
      US,
      "DEMO-ASIN-SKU",
    );
    expect(live.readFamily).not.toHaveBeenCalled();
  });

  it("resolves an ASIN through the fixed live port before reading its family", async () => {
    const { runtime, demo, live } = testPorts("live");

    await expect(runtime.getFamily({
      marketplaceId: US,
      asin: "B000000001",
    })).resolves.toEqual(family("LIVE-ASIN-SKU", "live"));

    expect(live.resolveSellerSkuByAsin).toHaveBeenCalledWith({
      marketplaceId: US,
      asin: "B000000001",
    });
    expect(live.readFamily).toHaveBeenCalledWith({
      marketplaceId: US,
      sellerSku: "LIVE-ASIN-SKU",
    });
    expect(demo.readFamily).not.toHaveBeenCalled();
  });

  it("rejects empty or oversized SKU batches before any read", async () => {
    const { runtime, readDemoListingPrice, live } = testPorts("demo");

    for (const sellerSkus of [[], Array.from({ length: 21 }, (_, i) =>
      `SKU-${i}`)]) {
      await expect(runtime.searchBySku({ marketplaceId: US, sellerSkus }))
        .rejects.toMatchObject({
          status: 400,
          code: "INVALID_INPUT",
          message: "批次查詢一次必須包含 1 到 20 個 SKU。",
        });
    }
    expect(readDemoListingPrice).not.toHaveBeenCalled();
    expect(live.fetchListingBatch).not.toHaveBeenCalled();
  });

  it("keeps demo item and not-found order, duplicates, DTO and notice exact", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { runtime, readDemoListingPrice } = testPorts("demo");
    readDemoListingPrice.mockImplementation(({ sellerSku }) => {
      if (sellerSku === "MISSING") {
        throw new SpApiError("展示資料找不到這個 SKU。", {
          status: 404,
          code: "SKU_NOT_FOUND",
        });
      }
      return listing(sellerSku);
    });
    const sellerSkus = ["SKU-B", "MISSING", "SKU-A", "SKU-B"];

    const snapshot = await runtime.searchBySku({
      marketplaceId: US,
      sellerSkus,
    });

    expect(snapshot).toEqual({
      mode: "demo",
      marketplaceId: US,
      requestedSkus: sellerSkus,
      items: [listing("SKU-B"), listing("SKU-A"), listing("SKU-B")],
      notFound: ["MISSING"],
      fetchedAt: NOW.toISOString(),
      requestId: null,
      rateLimit: null,
      notice: "展示資料只供操作測試，不會讀取或變更 Amazon。",
    });
    expect(snapshot.requestedSkus).toBe(sellerSkus);
    expect(readDemoListingPrice.mock.calls.map(([identity]) => identity))
      .toEqual(sellerSkus.map((sellerSku) => ({
        marketplaceId: US,
        sellerSku,
      })));
  });

  it("only converts an actual SKU_NOT_FOUND SpApiError into notFound", async () => {
    const { runtime, readDemoListingPrice } = testPorts("demo");
    const upstream = new SpApiError("Demo read failed.", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
    readDemoListingPrice.mockImplementation(() => {
      throw upstream;
    });

    await expect(runtime.searchBySku({
      marketplaceId: US,
      sellerSkus: ["SKU-A"],
    })).rejects.toBe(upstream);

    readDemoListingPrice.mockImplementation(() => {
      throw Object.assign(new Error("Not a SpApiError"), {
        code: "SKU_NOT_FOUND",
      });
    });
    await expect(runtime.searchBySku({
      marketplaceId: US,
      sellerSkus: ["SKU-A"],
    })).rejects.toThrow("Not a SpApiError");
  });

  it("returns the fixed live batch DTO without reconstructing it", async () => {
    const { runtime, live, readDemoListingPrice } = testPorts("live");
    const sellerSkus = ["SKU-B", "SKU-A"];
    const expected = {
      mode: "live" as const,
      marketplaceId: US,
      requestedSkus: sellerSkus,
      items: [listing("SKU-B")],
      notFound: ["SKU-A"],
      fetchedAt: NOW.toISOString(),
      requestId: "LIVE-BATCH-REQUEST",
      rateLimit: "5",
      notice: null,
    };
    vi.mocked(live.fetchListingBatch).mockResolvedValueOnce(expected);

    const snapshot = await runtime.searchBySku({ marketplaceId: US, sellerSkus });

    expect(snapshot).toBe(expected);
    expect(live.fetchListingBatch).toHaveBeenCalledWith(US, sellerSkus);
    expect(readDemoListingPrice).not.toHaveBeenCalled();
  });
});
