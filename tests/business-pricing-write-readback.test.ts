import { describe, expect, it } from "vitest";
import { businessPriceReadbackDecision } from "../src/main/business-pricing-mutations";

const identity = {
  mode: "live" as const,
  marketplaceId: "ATVPDKIKX0DER" as const,
  sellerSku: "SKU-1",
};

describe("business pricing write readback", () => {
  it("verifies the exact B2B price while preserving standard price and quantity discounts", () => {
    const result = {
      ...identity,
      status: "ACCEPTED" as const,
      asin: "B012345678",
      productType: "PET_FOOD",
      standardPrice: { amount: 30, currencyCode: "USD" },
      previousBusinessPrice: { amount: 28, currencyCode: "USD" },
      requestedBusinessPrice: { amount: 27.5, currencyCode: "USD" },
      previousQuantityDiscountPlan: null,
      previousQuantityDiscountPlanHash: null,
      requestedQuantityDiscountPlan: null,
      quantityDiscountPlanChange: "preserve" as const,
      businessOfferGuardHash: "quantity-discounts-before-write",
      businessOfferProtectedHash: "protected-offers-before-write",
    };
    const snapshot = {
      ...identity,
      asin: "B012345678",
      productType: "PET_FOOD",
      issues: [],
      standardPrice: { amount: 30, currencyCode: "USD" },
      businessPrice: { amount: 27.5, currencyCode: "USD" },
      businessOfferPresence: "present" as const,
      businessOfferGuardHash: "quantity-discounts-before-write",
    };

    expect(businessPriceReadbackDecision(result as never, snapshot as never))
      .toBe("verified");
    expect(businessPriceReadbackDecision({
      ...result,
      quantityDiscountPlanChange: undefined,
    } as never, snapshot as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      standardPrice: { amount: 31, currencyCode: "USD" },
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      asin: "B087654321",
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      businessOfferGuardHash: "quantity-discounts-changed",
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "INVALID_B2B_OFFER",
        severity: "ERROR",
        message: "invalid",
        attributeNames: ["purchasable_offer"],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "DUAL_ATTRIBUTE_SCOPE",
        severity: "ERROR",
        message: "Legacy price scope must not be discarded.",
        attributeNames: [],
        attributeName: "purchasable_offer",
        categories: ["INVALID_ATTRIBUTE"],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "UNSCOPED_ERROR",
        severity: "ERROR",
        message: "Amazon returned an unscoped error.",
        attributeNames: [],
        categories: [],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "INVALID_B2B_SELECTOR",
        severity: "ERROR",
        message: "Business audience is invalid.",
        attributeNames: ["audience"],
        categories: ["INVALID_ATTRIBUTE"],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "INVALID_QDP",
        severity: "ERROR",
        message: "invalid quantity discounts",
        attributeNames: ["quantity_discount_plan"],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "18027",
        severity: "ERROR",
        message: "Image is invalid.",
        attributeNames: [],
        categories: ["INVALID_IMAGE"],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("verified");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "90220",
        severity: "ERROR",
        message: "Price is invalid.",
        attributeNames: [],
        categories: ["INVALID_PRICE"],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("pending");
  });

  it("verifies a combined B2B price and explicit percent-tier readback", () => {
    const requestedPlan = {
      discountType: "percent" as const,
      levels: [
        { lowerBound: 5, value: 5 },
        { lowerBound: 10, value: 10 },
        { lowerBound: 15, value: 15 },
        { lowerBound: 20, value: 20 },
      ],
    };
    const result = {
      ...identity,
      status: "ACCEPTED" as const,
      asin: "B012345678",
      productType: "PET_FOOD",
      standardPrice: { amount: 30, currencyCode: "USD" },
      previousBusinessPrice: { amount: 28, currencyCode: "USD" },
      requestedBusinessPrice: { amount: 29, currencyCode: "USD" },
      previousQuantityDiscountPlan: {
        discountType: "fixed" as const,
        levels: [{ lowerBound: 5, value: 25 }],
      },
      previousQuantityDiscountPlanHash: "old-plan-hash",
      requestedQuantityDiscountPlan: requestedPlan,
      quantityDiscountPlanChange: "replace" as const,
      businessOfferGuardHash: "old-guard-includes-old-plan",
      businessOfferProtectedHash: "protected-unrelated-offers",
    };
    const snapshot = {
      ...identity,
      asin: "B012345678",
      productType: "PET_FOOD",
      issues: [],
      standardPrice: { amount: 30, currencyCode: "USD" },
      businessPrice: { amount: 29, currencyCode: "USD" },
      businessOfferPresence: "present" as const,
      quantityDiscountPlan: requestedPlan,
      quantityDiscountPlanPresence: "canonical" as const,
      quantityDiscountPlanHash: "new-plan-hash",
      businessOfferGuardHash: "new-guard-includes-new-plan",
      businessOfferProtectedHash: "protected-unrelated-offers",
    };

    expect(businessPriceReadbackDecision(result as never, snapshot as never))
      .toBe("verified");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      quantityDiscountPlan: {
        ...requestedPlan,
        levels: requestedPlan.levels.slice(0, 3),
      },
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      businessOfferProtectedHash: "unrelated-offer-drifted",
    } as never)).toBe("pending");
  });
});
