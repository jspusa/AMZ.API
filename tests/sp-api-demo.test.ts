import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getBusinessPricing,
  getListingContent,
  getListingImages,
  getListingPrice,
  invalidateSpApiCredentialCaches,
  previewListingPriceUpdate,
  previewListingSalePriceUpdate,
  updateBusinessPrice,
  updateListingImages,
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

  it("does not republish a demo image override after context invalidation", async () => {
    const identity = {
      marketplaceId: "ATVPDKIKX0DER" as const,
      sellerSku: "AFA-TRKY-4OZ",
    };
    const before = await getListingImages(identity);
    const expectedUrls = before.images.map((image) => image.url);
    const update = updateListingImages({
      ...identity,
      expectedUrls,
      urls: ["https://example.com/main.jpg", ...expectedUrls.slice(1)],
    });

    invalidateSpApiCredentialCaches();

    await expect(update).rejects.toMatchObject({ code: "CREDENTIALS_CHANGED" });
    expect((await getListingImages(identity)).images.map((image) => image.url))
      .toEqual(expectedUrls);
  });

  it("does not republish demo B2B overrides after context invalidation", async () => {
    const identity = {
      marketplaceId: "ATVPDKIKX0DER" as const,
      sellerSku: "AFA-TRKY-4OZ",
    };
    const before = await getBusinessPricing(identity);
    if (!before.standardPrice) throw new Error("Expected demo standard price");
    const update = updateBusinessPrice({
      ...identity,
      expectedStandardPrice: before.standardPrice.amount,
      expectedBusinessPrice: before.businessPrice?.amount ?? null,
      newBusinessPrice: Number((before.standardPrice.amount - 1).toFixed(2)),
    });

    invalidateSpApiCredentialCaches();

    await expect(update).rejects.toMatchObject({ code: "CREDENTIALS_CHANGED" });
    expect((await getBusinessPricing(identity)).businessPrice?.amount ?? null)
      .toBe(before.businessPrice?.amount ?? null);
  });

});
