import { describe, expect, it } from "vitest";
import {
  businessPricingRecommendationFlags,
  recommendedBusinessPriceDetermination,
  recommendedBusinessPriceMismatch,
  recommendedQuantityDiscountMismatch,
} from "../src/shared/business-pricing-recommendations";

describe("Jasper B2B recommendation categories", () => {
  it("flags only a known USD Business Price that is not exactly standard minus one dollar", () => {
    expect(recommendedBusinessPriceDetermination({
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      businessPrice: { amount: 18.99, currencyCode: "USD" },
    })).toBe("matches");
    expect(recommendedBusinessPriceDetermination({
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      businessPrice: { amount: 17.99, currencyCode: "USD" },
    })).toBe("mismatch");
    expect(recommendedBusinessPriceDetermination({
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      businessPrice: null,
    })).toBe("unknown");
    expect(recommendedBusinessPriceMismatch({
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      businessPrice: { amount: 18.99, currencyCode: "USD" },
    })).toBe(false);
    expect(recommendedBusinessPriceMismatch({
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      businessPrice: { amount: 17.99, currencyCode: "USD" },
    })).toBe(true);
    expect(recommendedBusinessPriceMismatch({
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      businessPrice: null,
    })).toBe(false);
    expect(recommendedBusinessPriceMismatch({
      standardPrice: { amount: 19.99, currencyCode: "CAD" },
      businessPrice: { amount: 18.99, currencyCode: "CAD" },
    })).toBe(false);
  });

  it("flags a proven missing or non-exact percent quantity plan but not ambiguous evidence", () => {
    expect(recommendedQuantityDiscountMismatch({
      plan: null,
      presence: "absent",
    })).toBe(true);
    expect(recommendedQuantityDiscountMismatch({
      plan: null,
      presence: "ambiguous",
    })).toBe(false);
    expect(recommendedQuantityDiscountMismatch({
      presence: "canonical",
      plan: {
        discountType: "percent",
        levels: [
          { lowerBound: 5, value: 5 },
          { lowerBound: 10, value: 10 },
          { lowerBound: 15, value: 15 },
          { lowerBound: 20, value: 20 },
        ],
      },
    })).toBe(false);
    expect(recommendedQuantityDiscountMismatch({
      presence: "canonical",
      plan: {
        discountType: "fixed",
        levels: [{ lowerBound: 5, value: 18.49 }],
      },
    })).toBe(true);
  });

  it("returns independent flags so one SKU can appear in both categories", () => {
    expect(businessPricingRecommendationFlags({
      standardPrice: { amount: 20, currencyCode: "USD" },
      businessPrice: { amount: 17, currencyCode: "USD" },
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
    })).toEqual({
      recommendedPriceMismatch: true,
      recommendedQuantityDiscountMismatch: true,
    });
  });
});
