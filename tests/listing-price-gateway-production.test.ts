import { describe, expect, it, vi } from "vitest";
import type {
  ListingPricePatch,
} from "../src/main/amazon/listing-price-gateway";
import {
  createListingPriceGatewayProduction,
} from "../src/main/amazon/listing-price-gateway-production";
import type { ListingPriceSnapshot } from
  "../src/main/amazon/listing-price-types";
import type {
  ListingsCommitOnceCommand,
  ListingsValidationPreviewCommand,
  ListingsWriteProduction,
} from "../src/main/amazon/listings-write-production";

const US_IDENTITY = {
  marketplaceId: "ATVPDKIKX0DER" as const,
  sellerSku: "AFA-TRKY-4OZ",
};

function liveSnapshot(): ListingPriceSnapshot {
  return {
    mode: "live",
    marketplaceId: US_IDENTITY.marketplaceId,
    sellerSku: US_IDENTITY.sellerSku,
    asin: "B000000002",
    title: "Live listing",
    productType: "PET_SUPPLIES",
    status: ["BUYABLE"],
    createdAt: null,
    updatedAt: null,
    standardPrice: { amount: 21, currencyCode: "USD" },
    effectivePrice: { amount: 21, currencyCode: "USD" },
    minimumPrice: null,
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice: null,
    discountedPricePresence: "absent",
    hasDiscountedPrice: false,
    hasAutomatedPricing: false,
    fetchedAt: "2026-08-27T00:00:00.000Z",
    requestId: "PRICE-LIVE-READ",
    issues: [],
    fulfillmentAvailability: [{
      channelCode: "AMAZON_NA",
      quantity: 2,
      fulfillment: "FBA",
      editable: false,
    }],
    notice: null,
  };
}

function writePort(overrides: Partial<ListingsWriteProduction> = {}) {
  return {
    validationPreview: vi.fn(async () => ({
      ok: true,
      status: 200,
      requestId: "PRICE-PREVIEW",
      retryAfter: null,
      payload: { status: "VALID" },
    })),
    commitOnce: vi.fn(async () => ({
      ok: true,
      status: 202,
      requestId: "PRICE-COMMIT",
      retryAfter: null,
      payload: { status: "ACCEPTED" },
    })),
    ...overrides,
  } satisfies ListingsWriteProduction;
}

describe("Listing Price production gateway", () => {
  it("owns the exact deterministic demo snapshot", () => {
    const runtime = createListingPriceGatewayProduction({
      resolveMode: () => "demo",
      readLive: vi.fn(),
      write: writePort(),
    });

    expect(runtime.readDemo(US_IDENTITY)).toMatchObject({
      mode: "demo",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA-TRKY-4OZ",
      asin: "B0USAFA004",
      title: "Afreschi Turkey Tendon Jerky, 4 oz",
      productType: "PET_SUPPLIES",
      status: ["BUYABLE", "DISCOVERABLE"],
      standardPrice: { amount: 13.99, currencyCode: "USD" },
      effectivePrice: { amount: 13.99, currencyCode: "USD" },
      discountedPrice: null,
      discountedPricePresence: "absent",
      fulfillmentAvailability: [{
        channelCode: "AMAZON_NA",
        quantity: 38,
        fulfillment: "FBA",
        editable: false,
      }],
      notice: "展示模式只會模擬價格與商品內容變更，不會更動 Amazon。",
    });
  });

  it("shares Standard and Sale Price demo state and clears both together", async () => {
    const runtime = createListingPriceGatewayProduction({
      resolveMode: () => "demo",
      readLive: vi.fn(),
      write: writePort(),
    });
    runtime.gateway.setDemoStandardPrice({ ...US_IDENTITY, amount: 17.5 });
    runtime.gateway.setDemoSalePrice({
      ...US_IDENTITY,
      schedule: {
        price: { amount: 15, currencyCode: "USD" },
        startAt: "2026-09-01T00:00:00Z",
        endAt: null,
      },
    });

    const mutated = await runtime.gateway.read(US_IDENTITY);
    expect(mutated.standardPrice).toEqual({ amount: 17.5, currencyCode: "USD" });
    expect(mutated.discountedPrice).toEqual({
      price: { amount: 15, currencyCode: "USD" },
      startAt: "2026-09-01T00:00:00Z",
      endAt: "",
    });
    expect(runtime.readDemo(US_IDENTITY).effectivePrice?.amount).toBe(15);

    runtime.clear();

    const cleared = runtime.readDemo(US_IDENTITY);
    expect(cleared.standardPrice?.amount).toBe(13.99);
    expect(cleared.discountedPrice).toBeNull();
    expect(cleared.effectivePrice?.amount).toBe(13.99);
  });

  it("uses only the injected fixed live-read port in live mode", async () => {
    const readLive = vi.fn(async () => liveSnapshot());
    const runtime = createListingPriceGatewayProduction({
      resolveMode: () => "live",
      readLive,
      write: writePort(),
    });

    await expect(runtime.gateway.read(US_IDENTITY)).resolves.toEqual(
      liveSnapshot(),
    );
    expect(readLive).toHaveBeenCalledOnce();
    expect(readLive).toHaveBeenCalledWith(US_IDENTITY);
  });

  it("delegates fixed patch bodies and the final execution fence", async () => {
    let previewCommand: ListingsValidationPreviewCommand | null = null;
    let commitCommand: ListingsCommitOnceCommand | null = null;
    const write = writePort({
      validationPreview: vi.fn(async (command) => {
        previewCommand = command;
        return {
          ok: true,
          status: 200,
          requestId: "PRICE-PREVIEW",
          retryAfter: null,
          payload: { status: "VALID" },
        };
      }),
      commitOnce: vi.fn(async (command) => {
        commitCommand = command;
        await command.assertBeforeSend();
        return {
          ok: true,
          status: 202,
          requestId: "PRICE-COMMIT",
          retryAfter: null,
          payload: { status: "ACCEPTED" },
        };
      }),
    });
    const runtime = createListingPriceGatewayProduction({
      resolveMode: () => "demo",
      readLive: vi.fn(),
      write,
    });
    const standardPatch: ListingPricePatch = {
      ...US_IDENTITY,
      kind: "standard-price",
      productType: "PET_SUPPLIES",
      currencyCode: "USD",
      amount: 18.25,
    };
    const saleCancelPatch: ListingPricePatch = {
      ...US_IDENTITY,
      kind: "sale-price",
      productType: "PET_SUPPLIES",
      currencyCode: "USD",
      discountedPrice: null,
    };
    const assertCurrent = vi.fn(async () => undefined);

    await runtime.gateway.validationPreview(standardPatch);
    await runtime.gateway.commitOnce(saleCancelPatch, { assertCurrent });

    expect(previewCommand).toEqual({
      ...US_IDENTITY,
      patchBody: {
        productType: "PET_SUPPLIES",
        patches: [{
          op: "merge",
          path: "/attributes/purchasable_offer",
          value: [{
            marketplace_id: US_IDENTITY.marketplaceId,
            currency: "USD",
            audience: "ALL",
            our_price: [{ schedule: [{ value_with_tax: 18.25 }] }],
          }],
        }],
      },
    });
    expect(commitCommand).toMatchObject({
      ...US_IDENTITY,
      patchBody: {
        productType: "PET_SUPPLIES",
        patches: [{
          op: "merge",
          path: "/attributes/purchasable_offer",
          value: [{
            marketplace_id: US_IDENTITY.marketplaceId,
            currency: "USD",
            audience: "ALL",
            discounted_price: null,
          }],
        }],
      },
    });
    expect(assertCurrent).toHaveBeenCalledOnce();
  });
});
