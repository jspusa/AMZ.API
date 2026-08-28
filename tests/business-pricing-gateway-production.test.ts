import { describe, expect, it, vi } from "vitest";
import type { BusinessPricingCapabilitiesPort } from
  "../src/main/amazon/business-pricing-capabilities";
import {
  businessPricingPatchBody,
  type BusinessPricePatch,
} from "../src/main/amazon/business-pricing-gateway";
import {
  createBusinessPricingGatewayProduction,
  type BusinessPricingGatewayProductionDependencies,
} from "../src/main/amazon/business-pricing-gateway-production";
import type { BusinessPricingCapability } from
  "../src/main/amazon/business-pricing-types";
import type { AmazonListingItem } from
  "../src/main/amazon/listing-item-projection";
import type { ListingPriceSnapshot } from
  "../src/main/amazon/listing-price-types";
import type {
  ListingsCommitOnceCommand,
  ListingsValidationPreviewCommand,
  ListingsWriteProduction,
  ListingsWriteReceipt,
} from "../src/main/amazon/listings-write-production";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const IDENTITY = {
  marketplaceId: MARKETPLACE_ID,
  sellerSku: "AA",
} as const;

const CAPABILITY: BusinessPricingCapability = {
  supported: true,
  editable: true,
  reason: null,
  quantityDiscountsSupported: true,
  quantityDiscountsEditable: true,
  quantityDiscountsReason: null,
  schemaChecksum: "live-schema",
};

const RECEIPT: ListingsWriteReceipt = {
  ok: true,
  status: 202,
  requestId: "request-1",
  retryAfter: null,
  payload: { submissionId: "submission-1" },
};

function demoPrice(
  sellerSku: string = IDENTITY.sellerSku,
): ListingPriceSnapshot {
  return {
    mode: "demo",
    marketplaceId: MARKETPLACE_ID,
    sellerSku,
    asin: "B012345678",
    title: "Demo FBA listing",
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    createdAt: null,
    updatedAt: null,
    standardPrice: { amount: 100, currencyCode: "USD" },
    effectivePrice: { amount: 100, currencyCode: "USD" },
    minimumPrice: null,
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice: null,
    discountedPricePresence: "absent",
    hasDiscountedPrice: false,
    hasAutomatedPricing: false,
    fetchedAt: "2026-08-27T00:00:00.000Z",
    requestId: null,
    issues: [],
    fulfillmentAvailability: [{
      channelCode: "AMAZON_NA",
      quantity: 12,
      fulfillment: "FBA",
      editable: false,
    }],
    notice: "Demo only",
  };
}

function livePayload(
  overrides: Partial<AmazonListingItem> = {},
): AmazonListingItem {
  return {
    sku: IDENTITY.sellerSku,
    summaries: [{
      marketplaceId: MARKETPLACE_ID,
      asin: "B012345678",
      productType: "PET_FOOD",
      status: ["BUYABLE"],
      itemName: "Live FBA listing",
    }],
    attributes: {
      purchasable_offer: [
        {
          audience: "ALL",
          currency: "USD",
          marketplace_id: MARKETPLACE_ID,
          our_price: [{ schedule: [{ value_with_tax: 30 }] }],
        },
        {
          audience: "B2B",
          currency: "USD",
          marketplace_id: MARKETPLACE_ID,
          our_price: [{ schedule: [{ value_with_tax: 28 }] }],
          quantity_discount_plan: [{
            schedule: [{
              discount_type: "fixed",
              levels: [{ lower_bound: 5, value: 25 }],
            }],
          }],
        },
      ],
    },
    offers: [{
      marketplaceId: MARKETPLACE_ID,
      offerType: "B2C",
      price: { currencyCode: "USD", amount: "30.00" },
    }],
    issues: [],
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 12,
    }],
    ...overrides,
  };
}

function harness(
  overrides: Partial<BusinessPricingGatewayProductionDependencies> = {},
) {
  let mode: "live" | "demo" = "demo";
  let generation = 0;
  let payload = livePayload();
  const capabilityReads: unknown[] = [];
  const quantityChecks: unknown[] = [];
  const previewCommands: ListingsValidationPreviewCommand[] = [];
  const commitCommands: ListingsCommitOnceCommand[] = [];
  const capabilities: BusinessPricingCapabilitiesPort = {
    read: async (input) => {
      capabilityReads.push(input);
      return CAPABILITY;
    },
    quantityDiscountPlanSupported: (input) => {
      quantityChecks.push(input);
      return true;
    },
    clear: () => undefined,
  };
  const write: ListingsWriteProduction = {
    validationPreview: async (command) => {
      previewCommands.push(command);
      return RECEIPT;
    },
    commitOnce: async (command) => {
      commitCommands.push(command);
      return RECEIPT;
    },
  };
  const runtime = createBusinessPricingGatewayProduction({
    listingItems: {
      fetchLiveListingItem: async () => ({
        payload,
        requestId: "listing-request-1",
      }),
    },
    capabilities,
    readDemoPrice: (identity) => demoPrice(identity.sellerSku),
    resolveMode: () => mode,
    credentialGeneration: () => generation,
    write,
    ...overrides,
  });
  return {
    runtime,
    capabilityReads,
    quantityChecks,
    previewCommands,
    commitCommands,
    setMode(nextMode: "live" | "demo") {
      mode = nextMode;
    },
    setGeneration(nextGeneration: number) {
      generation = nextGeneration;
    },
    setPayload(nextPayload: AmazonListingItem) {
      payload = nextPayload;
    },
  };
}

function combinedPatch(): BusinessPricePatch {
  return {
    kind: "combined",
    marketplaceId: MARKETPLACE_ID,
    sellerSku: IDENTITY.sellerSku,
    asin: "B012345678",
    productType: "PET_FOOD",
    currencyCode: "USD",
    amount: 80,
    quantityDiscountPlan: {
      discountType: "percent",
      levels: [
        { lowerBound: 2, value: 5 },
        { lowerBound: 5, value: 10 },
      ],
    },
  };
}

describe("Business Pricing production gateway", () => {
  it("normalizes one exact live FBA listing and refreshes PTD for mutation reads", async () => {
    const state = harness();
    state.setMode("live");

    const snapshot = await state.runtime.gateway.read(IDENTITY, "mutation");

    expect(snapshot).toMatchObject({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: IDENTITY.sellerSku,
      asin: "B012345678",
      productType: "PET_FOOD",
      standardPrice: { amount: 30, currencyCode: "USD" },
      businessPrice: { amount: 28, currencyCode: "USD" },
      businessOfferPresence: "present",
      quantityDiscountPlan: {
        discountType: "fixed",
        levels: [{ lowerBound: 5, value: 25 }],
      },
      businessPricingCapability: CAPABILITY,
    });
    expect(state.capabilityReads).toEqual([{
      marketplaceId: MARKETPLACE_ID,
      productType: "PET_FOOD",
      forceRefresh: true,
    }]);
  });

  it("uses the exact live B2B offer projection when attributes only contain the ALL offer", async () => {
    const state = harness();
    state.setMode("live");
    state.setPayload(livePayload({
      attributes: {
        purchasable_offer: [{
          audience: "ALL",
          currency: "USD",
          marketplace_id: MARKETPLACE_ID,
          our_price: [{ schedule: [{ value_with_tax: 19.99 }] }],
        }],
      },
      offers: [{
        marketplaceId: MARKETPLACE_ID,
        offerType: "B2C",
        price: { currencyCode: "USD", amount: "19.99" },
        audience: { value: "ALL", displayName: "Sell on Amazon" },
      }, {
        marketplaceId: MARKETPLACE_ID,
        offerType: "B2B",
        price: { currencyCode: "USD", amount: "17.99" },
        audience: {
          value: "B2B",
          displayName: "Amazon Business (B2B)",
        },
        quantityDiscountPlan: {
          discountType: "FIXED",
          levels: [{ lowerBound: 3, value: "16" }],
        },
      }] as unknown as AmazonListingItem["offers"],
    }));

    await expect(state.runtime.gateway.read(IDENTITY, "mutation"))
      .resolves.toMatchObject({
        standardPrice: { amount: 19.99, currencyCode: "USD" },
        businessPrice: { amount: 17.99, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlan: {
          discountType: "fixed",
          levels: [{ lowerBound: 3, value: 16 }],
        },
        quantityDiscountPlanPresence: "canonical",
      });
  });

  it("fails rich B2B offer projection conflicts and malformed tiers closed", async () => {
    const state = harness();
    state.setMode("live");
    const conflict = livePayload();
    conflict.offers = [{
      marketplaceId: MARKETPLACE_ID,
      offerType: "B2B",
      price: { currencyCode: "USD", amount: "28.00" },
      audience: { value: "B2B" },
      quantityDiscountPlan: {
        discountType: "FIXED",
        levels: [{ lowerBound: 5, value: "24" }],
      },
    }];
    state.setPayload(conflict);
    await expect(state.runtime.gateway.read(IDENTITY, "mutation"))
      .resolves.toMatchObject({
        businessPrice: null,
        businessOfferPresence: "ambiguous",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "ambiguous",
      });

    const malformed = livePayload({
      attributes: {
        purchasable_offer: [{
          audience: "ALL",
          currency: "USD",
          marketplace_id: MARKETPLACE_ID,
          our_price: [{ schedule: [{ value_with_tax: 30 }] }],
        }],
      },
      offers: [{
        marketplaceId: MARKETPLACE_ID,
        offerType: "B2B",
        price: { currencyCode: "USD", amount: "28.00" },
        audience: { value: "B2B" },
        quantityDiscountPlan: {
          discountType: "FIXED",
          levels: [{ lowerBound: 3, value: "not-a-price" }],
        },
      }],
    });
    state.setPayload(malformed);
    await expect(state.runtime.gateway.read(IDENTITY, "mutation"))
      .resolves.toMatchObject({
        businessPrice: { amount: 28, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "ambiguous",
      });
  });

  it("guards rich current quantity discounts while excluding them from combined protection", async () => {
    const state = harness();
    state.setMode("live");
    const firstPayload = livePayload({
      attributes: {
        purchasable_offer: [{
          audience: "ALL",
          currency: "USD",
          marketplace_id: MARKETPLACE_ID,
          our_price: [{ schedule: [{ value_with_tax: 19.99 }] }],
        }],
      },
      offers: [{
        marketplaceId: MARKETPLACE_ID,
        offerType: "B2B",
        price: { currencyCode: "USD", amount: "17.99" },
        audience: { value: "B2B" },
        quantityDiscountPlan: {
          discountType: "FIXED",
          levels: [{ lowerBound: 3, value: "16" }],
        },
      }],
    });
    state.setPayload(firstPayload);
    const before = await state.runtime.gateway.read(IDENTITY, "mutation");

    const changed = structuredClone(firstPayload);
    changed.offers![0]!.quantityDiscountPlan!.levels![0]!.value = "15";
    state.setPayload(changed);
    const after = await state.runtime.gateway.read(IDENTITY, "mutation");

    expect(after.businessOfferGuardHash).not.toBe(
      before.businessOfferGuardHash,
    );
    expect(after.businessOfferProtectedHash).toBe(
      before.businessOfferProtectedHash,
    );
  });

  it("fails closed on identity, fulfillment, FBA and standard-price evidence", async () => {
    const state = harness();
    state.setMode("live");

    state.setPayload(livePayload({ sku: "WRONG-SKU" }));
    await expect(state.runtime.gateway.read(IDENTITY, "read-only"))
      .rejects.toMatchObject({ code: "LISTING_IDENTITY_MISMATCH" });

    state.setPayload(livePayload({ fulfillmentAvailability: undefined }));
    await expect(state.runtime.gateway.read(IDENTITY, "read-only"))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });

    state.setPayload(livePayload({
      fulfillmentAvailability: [{
        fulfillmentChannelCode: "DEFAULT",
        quantity: 12,
      }],
    }));
    await expect(state.runtime.gateway.read(IDENTITY, "read-only"))
      .rejects.toMatchObject({ code: "FBA_ONLY" });

    const ambiguous = livePayload();
    const offers = ambiguous.attributes!.purchasable_offer!;
    offers[0].our_price = [{
      schedule: [
        { value_with_tax: 30 },
        { value_with_tax: 29, start_at: "2026-09-01" },
      ],
    }];
    state.setPayload(ambiguous);
    await expect(state.runtime.gateway.read(IDENTITY, "read-only"))
      .rejects.toMatchObject({ code: "B2B_PRICE_EVIDENCE_INCOMPLETE" });
  });

  it("round-trips demo Business Price and QDP contributions and clears them", async () => {
    const { runtime } = harness();
    const initial = await runtime.gateway.read(IDENTITY, "read-only");
    expect(initial.businessPrice).toEqual({
      amount: 90,
      currencyCode: "USD",
    });
    expect(initial.quantityDiscountPlan).toBeNull();

    await runtime.gateway.replaceDemoContribution(combinedPatch(), {
      assertCurrent: async () => undefined,
    });
    expect(await runtime.gateway.read(IDENTITY, "read-only")).toMatchObject({
      businessPrice: { amount: 80, currencyCode: "USD" },
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [
          { lowerBound: 2, value: 5 },
          { lowerBound: 5, value: 10 },
        ],
      },
    });

    await runtime.gateway.replaceDemoContribution({
      ...combinedPatch(),
      kind: "price-only",
      amount: 75,
      quantityDiscountPlan: null,
    }, { assertCurrent: async () => undefined });
    expect(await runtime.gateway.read(IDENTITY, "read-only")).toMatchObject({
      businessPrice: { amount: 75, currencyCode: "USD" },
      quantityDiscountPlan: {
        levels: [
          { lowerBound: 2, value: 5 },
          { lowerBound: 5, value: 10 },
        ],
      },
    });

    runtime.clear();
    expect(await runtime.gateway.read(IDENTITY, "read-only")).toMatchObject({
      businessPrice: { amount: 90, currencyCode: "USD" },
      quantityDiscountPlan: null,
    });
  });

  it("discards demo reads when the credential generation changes", async () => {
    const state = harness();
    const pending = state.runtime.gateway.read(IDENTITY, "read-only");
    state.setGeneration(1);

    await expect(pending).rejects.toMatchObject({
      code: "CREDENTIALS_CHANGED",
    });
  });

  it("does not publish a demo override after a stale fence", async () => {
    const state = harness();
    const pending = state.runtime.gateway.replaceDemoContribution(
      combinedPatch(),
      {
        assertCurrent: async () => {
          state.setGeneration(1);
        },
      },
    );

    await expect(pending).rejects.toMatchObject({
      code: "CREDENTIALS_CHANGED",
    });
    expect(state.runtime.readDemo(IDENTITY).businessPrice).toEqual({
      amount: 90,
      currencyCode: "USD",
    });
  });

  it("maps QDP capability checks without exposing the schema", () => {
    const state = harness();
    const input = {
      marketplaceId: MARKETPLACE_ID,
      productType: "PET_FOOD",
      schemaChecksum: "schema-1",
      plan: {
        discountType: "percent" as const,
        levels: [{ lowerBound: 2, value: 5 }],
      },
    };

    expect(state.runtime.gateway.quantityDiscountPlanSupported(input)).toBe(
      true,
    );
    expect(state.quantityChecks).toEqual([]);

    state.setMode("live");
    expect(state.runtime.gateway.quantityDiscountPlanSupported(input)).toBe(
      true,
    );
    expect(state.quantityChecks).toEqual([{
      marketplaceId: MARKETPLACE_ID,
      productType: "PET_FOOD",
      schemaChecksum: "schema-1",
      levels: [{ lowerBound: 2, value: 5 }],
    }]);
  });

  it("uses only the fixed preview and durable commit write commands", async () => {
    const state = harness();
    const patch = combinedPatch();
    const events: string[] = [];
    const fence = {
      assertCurrent: vi.fn(async () => {
        events.push("fence");
      }),
    };
    const recordDispatch = vi.fn(async () => {
      events.push("record");
    });

    await expect(state.runtime.gateway.validationPreview(patch))
      .resolves.toEqual(RECEIPT);
    await expect(state.runtime.gateway.commitOnce(
      patch,
      fence,
      recordDispatch,
    )).resolves.toEqual(RECEIPT);

    expect(state.previewCommands).toEqual([{
      marketplaceId: MARKETPLACE_ID,
      sellerSku: IDENTITY.sellerSku,
      patchBody: businessPricingPatchBody(patch),
      includeIdentifiers: true,
    }]);
    const commit = state.commitCommands[0];
    expect(commit).toMatchObject({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: IDENTITY.sellerSku,
      patchBody: businessPricingPatchBody(patch),
    });
    await commit.assertBeforeSend();
    await commit.recordBeforeSend?.();
    expect(events).toEqual(["fence", "record"]);
    expect(fence.assertCurrent).toHaveBeenCalledTimes(1);
    expect(recordDispatch).toHaveBeenCalledTimes(1);
  });
});
