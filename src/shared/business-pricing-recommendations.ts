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

export type RecommendedBusinessPricingConfigurationState =
  | "correct"
  | "needs_adjustment"
  | "needs_confirmation";

export const RECOMMENDED_BUSINESS_PRICING_CONFIGURATION_LABELS = {
  correct: "正確設定",
  needs_adjustment: "已設定但需調整",
  needs_confirmation: "已設定但待確認",
} as const satisfies Record<
  RecommendedBusinessPricingConfigurationState,
  string
>;

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
  presence: "absent" | "canonical" | "duplicate" | "ambiguous";
}>): boolean {
  if (input.presence === "ambiguous") return false;
  if (input.presence === "duplicate") return true;
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

export function recommendedBusinessPricingConfigurationState(input: Readonly<{
  status:
    | "configured"
    | "above_standard"
    | "missing"
    | "unsupported"
    | "incomplete";
  businessOfferPresence: "absent" | "present" | "ambiguous";
  standardPrice: Money | null;
  businessPrice: Money | null;
  quantityDiscountPlan: QuantityDiscountPlan | null;
  quantityDiscountPlanPresence:
    | "absent"
    | "canonical"
    | "duplicate"
    | "ambiguous";
}>): RecommendedBusinessPricingConfigurationState {
  if (input.status !== "configured") {
    return input.status === "missing" || input.status === "above_standard"
      ? "needs_adjustment"
      : "needs_confirmation";
  }
  if (input.businessOfferPresence !== "present") {
    return "needs_confirmation";
  }
  const price = recommendedBusinessPriceDetermination({
    standardPrice: input.standardPrice,
    businessPrice: input.businessPrice,
  });
  const quantityMismatch = recommendedQuantityDiscountMismatch({
    plan: input.quantityDiscountPlan,
    presence: input.quantityDiscountPlanPresence,
  });
  if (price === "mismatch" || quantityMismatch) return "needs_adjustment";
  return price === "matches" &&
      input.quantityDiscountPlanPresence === "canonical"
    ? "correct"
    : "needs_confirmation";
}

export function businessPricingRecommendationFlags(input: Readonly<{
  standardPrice: Money | null;
  businessPrice: Money | null;
  quantityDiscountPlan: QuantityDiscountPlan | null;
  quantityDiscountPlanPresence:
    | "absent"
    | "canonical"
    | "duplicate"
    | "ambiguous";
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
