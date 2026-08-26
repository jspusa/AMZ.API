import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";

export type BusinessMoney = {
  amount: number;
  currencyCode: string;
};

export type BusinessQuantityDiscountPlan = {
  discountType: "percent" | "fixed";
  levels: Array<{
    lowerBound: number;
    value: number;
  }>;
};

export type BusinessOfferReadEvidence = {
  businessPrice: BusinessMoney | null;
  businessOfferPresence: "absent" | "present" | "ambiguous";
  businessPricingManagedByAutomation: boolean;
  quantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanPresence: "absent" | "canonical" | "ambiguous";
};

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_TOKEN_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactToken(value: unknown): value is string {
  return typeof value === "string" &&
    Boolean(value) &&
    value === value.trim() &&
    !FORBIDDEN_TOKEN_CHARACTERS.test(value);
}

function finiteNumericValue(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rawOfferRecords(value: unknown): JsonRecord[] | null {
  return Array.isArray(value) && value.every(isRecord) ? value : null;
}

function offerDiscriminatorsAreWellFormed(offers: readonly JsonRecord[]): boolean {
  return offers.every((offer) =>
    (!("audience" in offer) ||
      offer.audience === undefined ||
      exactToken(offer.audience)) &&
    (!("marketplace_id" in offer) ||
      offer.marketplace_id === undefined ||
      exactToken(offer.marketplace_id))
  );
}

/**
 * Validates the raw Listings Items `issues` envelope before any issue is used
 * as pricing evidence. Missing issues are valid; present issues must retain
 * exact identifiers and the documented scope arrays.
 */
export function listingSubmissionIssuesAreWellFormed(
  issues: unknown,
): boolean {
  if (issues === undefined) return true;
  return Array.isArray(issues) && issues.every((issue) => {
    if (
      !isRecord(issue) ||
      !exactToken(issue.code) ||
      typeof issue.message !== "string" ||
      !issue.message.trim() ||
      !exactToken(issue.severity) ||
      !["ERROR", "WARNING", "INFO"].includes(issue.severity.toUpperCase()) ||
      !Array.isArray(issue.categories) ||
      issue.categories.some((value) => !exactToken(value))
    ) {
      return false;
    }
    for (const key of ["attributeNames", "categories", "marketplaceIds"]) {
      if (
        key in issue &&
        (!Array.isArray(issue[key]) ||
          issue[key].some((value) => !exactToken(value)))
      ) {
        return false;
      }
    }
    if ("attributeNames" in issue && "attributeName" in issue) return false;
    return !("attributeName" in issue) ||
      issue.attributeName === undefined ||
      exactToken(issue.attributeName);
  });
}

/**
 * Separates listing-wide ERROR issues from errors that can affect exact price
 * evidence. Malformed or unscoped ERROR data fails closed as pricing-related.
 */
export function isPricingListingError(
  rawIssue: unknown,
  marketplaceId: MarketplaceId,
): boolean {
  if (!isRecord(rawIssue) || typeof rawIssue.severity !== "string") {
    return true;
  }
  if (rawIssue.severity.toUpperCase() !== "ERROR") return false;

  if (
    "marketplaceIds" in rawIssue &&
    (!Array.isArray(rawIssue.marketplaceIds) ||
      rawIssue.marketplaceIds.some((value) => typeof value !== "string"))
  ) {
    return true;
  }
  if (
    Array.isArray(rawIssue.marketplaceIds) &&
    rawIssue.marketplaceIds.length > 0 &&
    !rawIssue.marketplaceIds.includes(marketplaceId)
  ) {
    return false;
  }

  if (
    "attributeNames" in rawIssue &&
    (!Array.isArray(rawIssue.attributeNames) ||
      rawIssue.attributeNames.some((value) => typeof value !== "string"))
  ) {
    return true;
  }
  if (
    "attributeName" in rawIssue &&
    rawIssue.attributeName !== undefined &&
    typeof rawIssue.attributeName !== "string"
  ) {
    return true;
  }
  const attributeNames = [...new Set([
    ...(Array.isArray(rawIssue.attributeNames)
      ? rawIssue.attributeNames.filter(
          (name): name is string => typeof name === "string",
        )
      : []),
    ...(typeof rawIssue.attributeName === "string"
      ? [rawIssue.attributeName]
      : []),
  ])];
  if (
    attributeNames.some((name) => {
      const normalized = name.toLowerCase();
      return [
        "purchasable_offer",
        "our_price",
        "discounted_price",
        "quantity_discount_plan",
        "minimum_seller_allowed_price",
        "maximum_seller_allowed_price",
        "automated_pricing_merchandising_rule_plan",
        "audience",
        "currency",
        "marketplace_id",
      ].some((attribute) => normalized.includes(attribute));
    })
  ) {
    return true;
  }

  if (
    "categories" in rawIssue &&
    (!Array.isArray(rawIssue.categories) ||
      rawIssue.categories.some((value) => typeof value !== "string"))
  ) {
    return true;
  }
  const categories = Array.isArray(rawIssue.categories)
    ? rawIssue.categories.filter(
        (category): category is string => typeof category === "string",
      )
    : [];
  if (
    categories.some((category) => {
      const normalized = category.toUpperCase();
      return normalized === "INVALID_PRICE" || normalized === "MISSING_PRICE";
    })
  ) {
    return true;
  }
  if (attributeNames.length > 0) return false;
  if (
    categories.length > 0 &&
    categories.every((category) =>
      /(?:^|_)IMAGE(?:_|$)/u.test(category.toUpperCase())
    )
  ) {
    return false;
  }
  return true;
}

function canonicalSingleBasePriceAmount(value: unknown): number | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const priceBlock = value[0];
  if (
    !isRecord(priceBlock) ||
    Object.keys(priceBlock).length !== 1 ||
    !("schedule" in priceBlock) ||
    !Array.isArray(priceBlock.schedule) ||
    priceBlock.schedule.length !== 1
  ) {
    return null;
  }
  const schedule = priceBlock.schedule[0];
  if (
    !isRecord(schedule) ||
    Object.keys(schedule).length !== 1 ||
    !("value_with_tax" in schedule)
  ) {
    return null;
  }
  const amount = finiteNumericValue(schedule.value_with_tax);
  return amount !== null && amount > 0 ? amount : null;
}

/**
 * Reads the one canonical ALL-audience base price from a raw
 * `attributes.purchasable_offer` value. Any duplicate, malformed, scheduled,
 * wrong-currency or otherwise non-canonical contribution returns null.
 */
export function canonicalBusinessStandardPrice(
  rawPurchasableOffers: unknown,
  marketplaceId: MarketplaceId,
): BusinessMoney | null {
  const marketplace = marketplaceById(marketplaceId);
  const offers = rawOfferRecords(rawPurchasableOffers);
  if (
    !marketplace ||
    !offers ||
    !offerDiscriminatorsAreWellFormed(offers)
  ) {
    return null;
  }
  const standardOffers = offers.filter((offer) =>
    offer.marketplace_id === marketplaceId &&
    (offer.audience === undefined || offer.audience === "ALL")
  );
  if (
    standardOffers.length !== 1 ||
    standardOffers[0]!.currency !== marketplace.currency
  ) {
    return null;
  }
  const amount = canonicalSingleBasePriceAmount(standardOffers[0]!.our_price);
  return amount === null
    ? null
    : { amount, currencyCode: marketplace.currency };
}

function canonicalBusinessQuantityDiscountPlan(value: unknown): {
  plan: BusinessQuantityDiscountPlan | null;
  presence: "absent" | "canonical" | "ambiguous";
} {
  if (value === undefined) return { plan: null, presence: "absent" };
  if (!Array.isArray(value) || value.length !== 1) {
    return { plan: null, presence: "ambiguous" };
  }
  const plan = value[0];
  if (
    !isRecord(plan) ||
    Object.keys(plan).length !== 1 ||
    !("schedule" in plan) ||
    !Array.isArray(plan.schedule) ||
    plan.schedule.length !== 1
  ) {
    return { plan: null, presence: "ambiguous" };
  }
  const schedule = plan.schedule[0];
  if (
    !isRecord(schedule) ||
    Object.keys(schedule).some((key) =>
      key !== "discount_type" && key !== "levels"
    ) ||
    (schedule.discount_type !== "percent" &&
      schedule.discount_type !== "fixed") ||
    !Array.isArray(schedule.levels) ||
    schedule.levels.length < 1 ||
    schedule.levels.length > 5
  ) {
    return { plan: null, presence: "ambiguous" };
  }

  const levels: BusinessQuantityDiscountPlan["levels"] = [];
  for (const rawLevel of schedule.levels) {
    if (
      !isRecord(rawLevel) ||
      Object.keys(rawLevel).length !== 2 ||
      !("lower_bound" in rawLevel) ||
      !("value" in rawLevel)
    ) {
      return { plan: null, presence: "ambiguous" };
    }
    const lowerBound = finiteNumericValue(rawLevel.lower_bound);
    const levelValue = finiteNumericValue(rawLevel.value);
    if (
      lowerBound === null ||
      !Number.isSafeInteger(lowerBound) ||
      lowerBound <= 0 ||
      levelValue === null ||
      levelValue <= 0 ||
      (schedule.discount_type === "percent" && levelValue >= 100)
    ) {
      return { plan: null, presence: "ambiguous" };
    }
    const previous = levels.at(-1);
    if (
      previous &&
      (lowerBound <= previous.lowerBound ||
        (schedule.discount_type === "percent"
          ? levelValue <= previous.value
          : levelValue >= previous.value))
    ) {
      return { plan: null, presence: "ambiguous" };
    }
    levels.push({ lowerBound, value: levelValue });
  }
  return {
    plan: { discountType: schedule.discount_type, levels },
    presence: "canonical",
  };
}

function ambiguousBusinessOfferEvidence(
  managedByAutomation = false,
): BusinessOfferReadEvidence {
  return {
    businessPrice: null,
    businessOfferPresence: "ambiguous",
    businessPricingManagedByAutomation: managedByAutomation,
    quantityDiscountPlan: null,
    quantityDiscountPlanPresence: "ambiguous",
  };
}

/**
 * Normalizes the exact-marketplace B2B contribution from a raw
 * `attributes.purchasable_offer` value. Unknown and malformed evidence never
 * becomes an absent or configured result.
 */
export function normalizeBusinessOfferReadEvidence(
  rawPurchasableOffers: unknown,
  marketplaceId: MarketplaceId,
): BusinessOfferReadEvidence {
  const marketplace = marketplaceById(marketplaceId);
  if (!marketplace) return ambiguousBusinessOfferEvidence();
  if (rawPurchasableOffers === undefined) {
    return {
      businessPrice: null,
      businessOfferPresence: "absent",
      businessPricingManagedByAutomation: false,
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
    };
  }
  const offers = rawOfferRecords(rawPurchasableOffers);
  if (!offers || !offerDiscriminatorsAreWellFormed(offers)) {
    return ambiguousBusinessOfferEvidence();
  }
  const businessOffers = offers.filter((offer) => offer.audience === "B2B");
  if (businessOffers.some((offer) => !exactToken(offer.marketplace_id))) {
    return ambiguousBusinessOfferEvidence();
  }
  const marketplaceOffers = businessOffers.filter(
    (offer) => offer.marketplace_id === marketplaceId,
  );
  if (marketplaceOffers.length === 0) {
    return {
      businessPrice: null,
      businessOfferPresence: "absent",
      businessPricingManagedByAutomation: false,
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
    };
  }
  if (
    marketplaceOffers.length !== 1 ||
    marketplaceOffers[0]!.currency !== marketplace.currency
  ) {
    return ambiguousBusinessOfferEvidence();
  }

  const offer = marketplaceOffers[0]!;
  if (
    offer.automated_pricing_merchandising_rule_plan !== undefined &&
    !Array.isArray(offer.automated_pricing_merchandising_rule_plan)
  ) {
    return ambiguousBusinessOfferEvidence();
  }
  const managedByAutomation = Boolean(
    Array.isArray(offer.automated_pricing_merchandising_rule_plan) &&
      offer.automated_pricing_merchandising_rule_plan.length,
  );
  const amount = canonicalSingleBasePriceAmount(offer.our_price);
  if (amount === null) {
    return ambiguousBusinessOfferEvidence(managedByAutomation);
  }
  const quantityDiscount = canonicalBusinessQuantityDiscountPlan(
    offer.quantity_discount_plan,
  );
  return {
    businessPrice: { amount, currencyCode: marketplace.currency },
    businessOfferPresence: "present",
    businessPricingManagedByAutomation: managedByAutomation,
    quantityDiscountPlan: quantityDiscount.plan,
    quantityDiscountPlanPresence: quantityDiscount.presence,
  };
}

export function sameMarketplacePrice(
  left: number,
  right: number,
  currencyCode: string,
): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const precision = currencyCode === "JPY" ? 0 : 2;
  const factor = 10 ** precision;
  return Math.round(left * factor) === Math.round(right * factor);
}

export function sameBusinessQuantityDiscountPlan(
  left: BusinessQuantityDiscountPlan,
  right: BusinessQuantityDiscountPlan,
): boolean {
  return left.discountType === right.discountType &&
    left.levels.length === right.levels.length &&
    left.levels.every((level, index) => {
      const other = right.levels[index];
      return Boolean(
        other &&
          level.lowerBound === other.lowerBound &&
          level.value === other.value,
      );
    });
}
