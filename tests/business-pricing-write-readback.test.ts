import { describe, expect, it } from "vitest";
import {
  businessPriceReadbackDecision,
  reconcileBusinessPriceWrite,
  reconcileMinimumPriceWrite,
} from "../src/main/business-pricing-mutations";

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
      previousMinimumPrice: null,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: null,
      minimumPriceChange: "preserve" as const,
      minimumPriceProtectedHash: null,
      minimumPriceCanonicalPatchHash: null,
      businessPriceValidation: "validated" as const,
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
      minimumPrice: null,
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
      previousMinimumPrice: null,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: null,
      minimumPriceChange: "preserve" as const,
      minimumPriceProtectedHash: null,
      minimumPriceCanonicalPatchHash: null,
      businessPriceValidation: "validated" as const,
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
      minimumPrice: null,
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
      quantityDiscountPlanPresence: "duplicate",
    } as never)).toBe("pending");
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

  it("refuses malformed durable evidence and non-FBA canonical snapshots", () => {
    const evidence = {
      version: 1,
      marketplaceId: identity.marketplaceId,
      sellerSku: identity.sellerSku,
      asin: "B012345678",
      productType: "PET_FOOD",
      fulfillment: "FBA",
      standardPrice: { amount: 30, currencyCode: "USD" },
      previousBusinessPrice: { amount: 28, currencyCode: "USD" },
      requestedBusinessPrice: { amount: 27, currencyCode: "USD" },
      previousMinimumPrice: null,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: null,
      minimumPriceChange: "preserve",
      minimumPriceProtectedHash: null,
      minimumPriceCanonicalPatchHash: null,
      businessPriceValidation: "validated",
      previousQuantityDiscountPlan: null,
      previousQuantityDiscountPlanHash: null,
      requestedQuantityDiscountPlan: null,
      quantityDiscountPlanChange: "preserve",
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "b".repeat(64),
      schemaChecksum: "seller-specific-checksum",
    };
    const durable = {
      ...identity,
      status: "DISPATCHED",
      asin: evidence.asin,
      productType: evidence.productType,
      standardPrice: evidence.standardPrice,
      previousBusinessPrice: evidence.previousBusinessPrice,
      requestedBusinessPrice: evidence.requestedBusinessPrice,
      previousMinimumPrice: null,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: null,
      minimumPriceChange: "preserve",
      minimumPriceProtectedHash: null,
      minimumPriceCanonicalPatchHash: null,
      businessPriceValidation: "validated",
      previousQuantityDiscountPlan: null,
      previousQuantityDiscountPlanHash: null,
      requestedQuantityDiscountPlan: null,
      quantityDiscountPlanChange: "preserve",
      businessOfferGuardHash: evidence.businessOfferGuardHash,
      businessOfferProtectedHash: evidence.businessOfferProtectedHash,
      schemaChecksum: evidence.schemaChecksum,
      acceptedAt: "2026-08-27T00:00:00.000Z",
      submissionId: null,
      requestId: null,
      issues: [],
      notice: "durable fixture",
      _writeEvidence: evidence,
    };
    const canonical = {
      ...identity,
      asin: evidence.asin,
      productType: evidence.productType,
      standardPrice: evidence.standardPrice,
      minimumPrice: null,
      businessPrice: evidence.requestedBusinessPrice,
      businessOfferPresence: "present",
      businessOfferGuardHash: evidence.businessOfferGuardHash,
      issues: [],
      fulfillmentAvailability: [{ fulfillment: "FBA" }],
    };

    expect(reconcileBusinessPriceWrite(
      durable,
      canonical as never,
    )).toMatchObject({ status: "ACCEPTED" });
    expect(reconcileBusinessPriceWrite({
      ...durable,
      _writeEvidence: { ...evidence, unexpected: true },
    }, canonical as never)).toBeNull();
    expect(reconcileBusinessPriceWrite({
      ...durable,
      unexpected: true,
    }, canonical as never)).toBeNull();
    expect(reconcileBusinessPriceWrite({
      ...durable,
      asin: "B087654321",
    }, canonical as never)).toBeNull();
    expect(reconcileBusinessPriceWrite({
      ...durable,
      standardPrice: { amount: 31, currencyCode: "USD" },
    }, canonical as never)).toBeNull();
    expect(reconcileBusinessPriceWrite({
      ...durable,
      submissionId: "fabricated-before-acceptance",
    }, canonical as never)).toBeNull();
    expect(reconcileBusinessPriceWrite({
      ...durable,
      status: "ACCEPTED",
      submissionId: null,
    }, canonical as never)).toBeNull();
    expect(reconcileBusinessPriceWrite(durable, {
      ...canonical,
      fulfillmentAvailability: [{ fulfillment: "MFN" }],
    } as never)).toBeNull();
  });

  it("reconciles an exact minimum-price target despite unrelated offer normalization", () => {
    const plan = {
      discountType: "percent" as const,
      levels: [{ lowerBound: 5, value: 5 }],
    };
    const evidence = {
      version: 1,
      marketplaceId: identity.marketplaceId,
      sellerSku: identity.sellerSku,
      asin: "B012345678",
      productType: "PET_FOOD",
      fulfillment: "FBA",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      previousMinimumPrice: { amount: 18, currencyCode: "USD" },
      requestedMinimumPrice: { amount: 14.19, currencyCode: "USD" },
      lowestTierUnitPrice: { amount: 15.19, currencyCode: "USD" },
      previousBusinessPrice: { amount: 17.99, currencyCode: "USD" },
      previousQuantityDiscountPlan: plan,
      previousQuantityDiscountPlanHash: "f".repeat(64),
      minimumPriceProtectedHash: "7".repeat(64),
      minimumPriceCanonicalPatchHash: "8".repeat(64),
    };
    const durable = {
      ...identity,
      status: "DISPATCHED",
      asin: evidence.asin,
      productType: evidence.productType,
      standardPrice: evidence.standardPrice,
      previousMinimumPrice: evidence.previousMinimumPrice,
      requestedMinimumPrice: evidence.requestedMinimumPrice,
      lowestTierUnitPrice: evidence.lowestTierUnitPrice,
      previousBusinessPrice: evidence.previousBusinessPrice,
      previousQuantityDiscountPlan: evidence.previousQuantityDiscountPlan,
      previousQuantityDiscountPlanHash:
        evidence.previousQuantityDiscountPlanHash,
      minimumPriceProtectedHash: evidence.minimumPriceProtectedHash,
      minimumPriceCanonicalPatchHash:
        evidence.minimumPriceCanonicalPatchHash,
      acceptedAt: "2026-08-31T00:00:00.000Z",
      submissionId: null,
      requestId: null,
      issues: [],
      notice: "durable minimum-price fixture",
      _minimumWriteEvidence: evidence,
    };
    const canonical = {
      ...identity,
      asin: evidence.asin,
      productType: evidence.productType,
      standardPrice: evidence.standardPrice,
      minimumPrice: evidence.requestedMinimumPrice,
      minimumPricePresence: "canonical",
      minimumPriceProtectedHash: evidence.minimumPriceProtectedHash,
      businessPrice: evidence.previousBusinessPrice,
      quantityDiscountPlan: plan,
      issues: [],
      fulfillmentAvailability: [{ fulfillment: "FBA" }],
    };

    expect(reconcileMinimumPriceWrite(durable, canonical as never))
      .toMatchObject({
        status: "ACCEPTED",
        requestedMinimumPrice: evidence.requestedMinimumPrice,
        writeLifecycle: { verified: true, authoritative: true },
      });
    expect(reconcileMinimumPriceWrite(durable, {
      ...canonical,
      minimumPrice: { amount: 14.2, currencyCode: "USD" },
    } as never)).toBeNull();
    expect(reconcileMinimumPriceWrite(durable, {
      ...canonical,
      minimumPriceProtectedHash: "9".repeat(64),
      businessPrice: { amount: 16.15, currencyCode: "USD" },
      quantityDiscountPlan: {
        discountType: "fixed",
        levels: [{ lowerBound: 3, value: 16.14 }],
      },
    } as never)).toMatchObject({
      status: "ACCEPTED",
      requestedMinimumPrice: evidence.requestedMinimumPrice,
      writeLifecycle: { verified: true, authoritative: true },
    });
    expect(reconcileMinimumPriceWrite(durable, {
      ...canonical,
      minimumPriceProtectedHash: "9".repeat(64),
    } as never)).toMatchObject({
      status: "ACCEPTED",
      writeLifecycle: { verified: true, authoritative: true },
    });
    expect(reconcileMinimumPriceWrite(durable, {
      ...canonical,
      standardPrice: { amount: 20.99, currencyCode: "USD" },
    } as never)).toMatchObject({
      status: "ACCEPTED",
      writeLifecycle: { verified: true, authoritative: true },
    });
    expect(reconcileMinimumPriceWrite(durable, {
      ...canonical,
      asin: "B087654321",
    } as never)).toBeNull();
    expect(reconcileMinimumPriceWrite({
      ...durable,
      unexpected: true,
    }, canonical as never)).toBeNull();
  });
});
