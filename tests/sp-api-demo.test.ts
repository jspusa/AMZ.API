import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getListingContent,
  getListingImages,
  getListingPrice,
  invalidateSpApiCredentialCaches,
  listingIncludedData,
  previewListingPriceUpdate,
  previewListingSalePriceUpdate,
  searchOrders,
  shouldFallbackListingsExport,
  updateListingPrice,
} from "../src/main/amazon/sp-api";

const SP_ENV_KEYS = Object.keys(process.env).filter((key) => key.startsWith("SP_API_"));
const savedEnvironment = new Map(SP_ENV_KEYS.map((key) => [key, process.env[key]]));

describe("SP-API demo safety boundary", () => {
  beforeEach(() => {
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("always returns FBA-only orders when credentials are absent", async () => {
    const snapshot = await searchOrders({
      marketplaceId: "ATVPDKIKX0DER",
      lastUpdatedAfter: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      fulfilledBy: "AMAZON",
      maxResultsPerPage: 50,
    });

    expect(snapshot.mode).toBe("demo");
    expect(snapshot.orders.length).toBeGreaterThan(0);
    expect(snapshot.orders.every((order) => order.fulfilledBy === "AMAZON")).toBe(true);
  });

  it("keeps price changes behind preview and expected-price checks", async () => {
    const current = await getListingPrice({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA-TRKY-4OZ",
    });
    expect(current.mode).toBe("demo");
    expect(current.standardPrice).not.toBeNull();
    const expectedPrice = current.standardPrice!.amount;
    const newPrice = expectedPrice + 1;

    const preview = await previewListingPriceUpdate({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: current.sellerSku,
      expectedPrice,
      newPrice,
    });
    expect(preview.status).toBe("SIMULATED");

    const result = await updateListingPrice({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: current.sellerSku,
      expectedPrice,
      newPrice,
    });
    expect(result.status).toBe("SIMULATED");
    expect(result.previousPrice.amount).toBe(expectedPrice);
    expect(result.requestedPrice.amount).toBe(newPrice);
  });

  it("clears context-bound demo writes when the SP execution context is invalidated", async () => {
    const identity = {
      marketplaceId: "ATVPDKIKX0DER" as const,
      sellerSku: "AFA-TRKY-4OZ",
    };
    const original = await getListingPrice(identity);
    const expectedPrice = original.standardPrice!.amount;
    await updateListingPrice({
      ...identity,
      expectedPrice,
      newPrice: expectedPrice + 3,
    });
    expect((await getListingPrice(identity)).standardPrice?.amount).toBe(expectedPrice + 3);

    invalidateSpApiCredentialCaches();

    expect((await getListingPrice(identity)).standardPrice?.amount).toBe(expectedPrice);
  });

  it("preserves valid Marketplace Day literals in a Sale Price preview", async () => {
    const current = await getListingPrice({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA-TRKY-4OZ",
    });
    const preview = await previewListingSalePriceUpdate({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: current.sellerSku,
      action: "set",
      expectedPrice: current.standardPrice!.amount,
      expectedDiscountedPrice: current.discountedPrice?.price.amount ?? null,
      expectedStartAt: current.discountedPrice?.startAt ?? null,
      expectedEndAt: current.discountedPrice?.endAt ?? null,
      salePrice: current.standardPrice!.amount - 1,
      startAt: "2026-03-08",
      endAt: "2026-03-09",
    });

    expect(preview.status).toBe("SIMULATED");
    expect(preview.requestedDiscountedPrice).toMatchObject({
      startAt: "2026-03-08",
      endAt: "2026-03-09",
    });
  });

  it("rejects an impossible Sale Price date during preview", async () => {
    const current = await getListingPrice({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA-TRKY-4OZ",
    });

    await expect(
      previewListingSalePriceUpdate({
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: current.sellerSku,
        action: "set",
        expectedPrice: current.standardPrice!.amount,
        expectedDiscountedPrice: current.discountedPrice?.price.amount ?? null,
        expectedStartAt: current.discountedPrice?.startAt ?? null,
        expectedEndAt: current.discountedPrice?.endAt ?? null,
        salePrice: current.standardPrice!.amount - 1,
        startAt: "2026-02-30",
        endAt: "2026-03-09",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SALE_PRICE" });
  });

  it("provides content and nine ordered image slots", async () => {
    const identity = {
      marketplaceId: "ATVPDKIKX0DER" as const,
      sellerSku: "AFA-TRKY-4OZ",
    };
    const [content, images] = await Promise.all([
      getListingContent(identity),
      getListingImages(identity),
    ]);
    expect(content.mode).toBe("demo");
    expect(content.itemHighlight).not.toBe("");
    expect(content.bulletPoints.length).toBeLessThanOrEqual(5);
    expect(content.productDescription).not.toBe("");
    expect(content.capabilities.itemHighlight.maxLength).toBe(125);
    expect(content.capabilities.productDescription.supported).toBe(true);
    expect(images.images).toHaveLength(9);
    expect(images.images[0].attributeName).toBe("main_product_image_locator");
  });

  it("keeps search-only productTypes off single-item listing requests", () => {
    expect(listingIncludedData("item").split(",")).toEqual([
      "summaries",
      "attributes",
      "offers",
      "issues",
      "fulfillmentAvailability",
    ]);
    expect(listingIncludedData("search").split(",")).toContain("productTypes");
  });

  it("falls back to single-item reads only for invalid batch parameters", () => {
    expect(shouldFallbackListingsExport(400)).toBe(true);
    expect(shouldFallbackListingsExport(401)).toBe(false);
    expect(shouldFallbackListingsExport(403)).toBe(false);
    expect(shouldFallbackListingsExport(429)).toBe(false);
  });
});
