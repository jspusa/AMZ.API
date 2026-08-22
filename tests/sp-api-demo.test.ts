import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getListingContent,
  getListingImages,
  getListingPrice,
  listingIncludedData,
  previewListingPriceUpdate,
  searchOrders,
  shouldFallbackListingsExport,
  updateListingPrice,
} from "../src/main/amazon/sp-api";

const SP_ENV_KEYS = Object.keys(process.env).filter((key) => key.startsWith("SP_API_"));
const savedEnvironment = new Map(SP_ENV_KEYS.map((key) => [key, process.env[key]]));

describe("SP-API demo safety boundary", () => {
  beforeEach(() => {
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
