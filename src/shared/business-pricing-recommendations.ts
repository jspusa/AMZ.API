export const RECOMMENDED_BUSINESS_PRICE_DISCOUNT_USD = 1;

export const RECOMMENDED_BUSINESS_QUANTITY_TIERS = [
  { lowerBound: 5, value: 5 },
  { lowerBound: 10, value: 10 },
  { lowerBound: 15, value: 15 },
  { lowerBound: 20, value: 20 },
] as const;

type Money = Readonly<{
  amount: number;
  currencyCode: string;
}>;

type QuantityDiscountPlan = Readonly<{
  discountType: "percent" | "fixed";
  levels: readonly Readonly<{
    lowerBound: number;
    value: number;
  }>[];
}>;

function usdCents(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    return null;
  }
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) <= 1e-6 ? cents : null;
}

export function recommendedBusinessPriceDetermination(input: Readonly<{
  standardPrice: Money | null;
  businessPrice: Money | null;
}>): "matches" | "mismatch" | "unknown" {
  const { standardPrice, businessPrice } = input;
  if (
    !standardPrice ||
    !businessPrice ||
    standardPrice.currencyCode !== "USD" ||
    businessPrice.currencyCode !== "USD"
  ) return "unknown";
  const standardCents = usdCents(standardPrice.amount);
  const businessCents = usdCents(businessPrice.amount);
  if (
    standardCents === null ||
    businessCents === null ||
    standardCents <= RECOMMENDED_BUSINESS_PRICE_DISCOUNT_USD * 100
  ) return "unknown";
  return businessCents ===
      standardCents - RECOMMENDED_BUSINESS_PRICE_DISCOUNT_USD * 100
    ? "matches"
    : "mismatch";
}

export function recommendedBusinessPriceMismatch(input: Readonly<{
  standardPrice: Money | null;
  businessPrice: Money | null;
}>): boolean {
  return recommendedBusinessPriceDetermination(input) === "mismatch";
}

export function recommendedQuantityDiscountMismatch(input: Readonly<{
  plan: QuantityDiscountPlan | null;
  presence: "absent" | "canonical" | "ambiguous";
}>): boolean {
  if (input.presence === "ambiguous") return false;
  if (input.presence === "absent") return true;
  const plan = input.plan;
  if (
    !plan ||
    plan.discountType !== "percent" ||
    plan.levels.length !== RECOMMENDED_BUSINESS_QUANTITY_TIERS.length
  ) return true;
  return RECOMMENDED_BUSINESS_QUANTITY_TIERS.some((recommended, index) => {
    const actual = plan.levels[index];
    return !actual ||
      actual.lowerBound !== recommended.lowerBound ||
      actual.value !== recommended.value;
  });
}

export function businessPricingRecommendationFlags(input: Readonly<{
  standardPrice: Money | null;
  businessPrice: Money | null;
  quantityDiscountPlan: QuantityDiscountPlan | null;
  quantityDiscountPlanPresence: "absent" | "canonical" | "ambiguous";
}>): Readonly<{
  recommendedPriceMismatch: boolean;
  recommendedQuantityDiscountMismatch: boolean;
}> {
  return {
    recommendedPriceMismatch: recommendedBusinessPriceMismatch(input),
    recommendedQuantityDiscountMismatch: recommendedQuantityDiscountMismatch({
      plan: input.quantityDiscountPlan,
      presence: input.quantityDiscountPlanPresence,
    }),
  };
}
