/**
 * Browser-safe public B2B payload knowledge. This module contains no Amazon
 * adapters, execution context, credential data or write authority. Runtime
 * decoders and exact preview/identity checks remain at their existing seams.
 */
export type BusinessPricingMoneyWire = Readonly<{
  amount: number;
  currencyCode: string;
}>;

export type BusinessMinimumPricePresenceWire = "absent" | "canonical" | "ambiguous";

export type BusinessPricingCapabilityWire = Readonly<{
  supported: boolean;
  editable: boolean;
  reason: string | null;
  schemaChecksum: string | null;
  quantityDiscountsSupported: boolean;
  quantityDiscountsEditable: boolean;
  quantityDiscountsReason: string | null;
}>;

export type BusinessQuantityDiscountTierWire = Readonly<{
  lowerBound: number;
  percent: number;
}>;

export type BusinessQuantityDiscountLevelWire = Readonly<{
  lowerBound: number;
  value: number;
}>;

export type BusinessQuantityDiscountPlanWire = Readonly<{
  discountType: "percent" | "fixed";
  levels: readonly BusinessQuantityDiscountLevelWire[];
}>;

export type BusinessPricingListingWire = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  title: string;
  productType: string;
  standardPrice: BusinessPricingMoneyWire | null;
  minimumPrice: BusinessPricingMoneyWire | null;
  minimumPricePresence: BusinessMinimumPricePresenceWire;
  businessPrice: BusinessPricingMoneyWire | null;
  businessOfferPresence: "absent" | "present" | "ambiguous";
  businessPricingManagedByAutomation: boolean;
  quantityDiscountPlan: BusinessQuantityDiscountPlanWire | null;
  quantityDiscountPlanPresence: "absent" | "canonical" | "duplicate" | "ambiguous";
  quantityDiscountPlanHash: string | null;
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  businessPricingCapability: BusinessPricingCapabilityWire;
  fetchedAt: string;
  notice: string | null;
  writeStatus: BusinessPriceWriteStatusWire | null;
}>;

export type BusinessPriceWriteBodyWire = Readonly<{
  marketplaceId: string;
  sellerSku: string;
  expectedStandardPrice: number;
  expectedBusinessPrice: number | null;
  newBusinessPrice: number;
  expectedMinimumPrice?: number | null;
  expectedQuantityDiscountPlanHash?: string | null;
  quantityDiscountTiers?: readonly BusinessQuantityDiscountTierWire[];
  idempotencyKey: string;
}>;

export type BusinessPriceIssueWire = Readonly<{
  severity: string;
  message: string;
}>;

export type BusinessPriceValidationWire = Readonly<{
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  marketplaceId: string;
  sellerSku: string;
  asin: string;
  productType: string;
  standardPrice: BusinessPricingMoneyWire;
  previousBusinessPrice: BusinessPricingMoneyWire | null;
  requestedBusinessPrice: BusinessPricingMoneyWire;
  previousMinimumPrice: BusinessPricingMoneyWire | null;
  requestedMinimumPrice: BusinessPricingMoneyWire | null;
  lowestTierUnitPrice: BusinessPricingMoneyWire | null;
  minimumPriceChange: "preserve" | "lower";
  minimumPriceProtectedHash: string | null;
  minimumPriceCanonicalPatchHash: string | null;
  businessPriceValidation: "validated" | "final-state-validated" | "deferred-until-minimum-price";
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlanWire | null;
  previousQuantityDiscountPlanHash: string | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlanWire | null;
  quantityDiscountPlanPresence: "absent" | "canonical" | "duplicate" | "ambiguous";
  quantityDiscountPlanChange: "preserve" | "replace";
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  schemaChecksum: string;
  fbaEvidenceHash: string;
  canonicalPatchHash: string;
  validationIssuesHash: string;
  validatedAt: string;
  issues: readonly BusinessPriceIssueWire[];
  notice: string;
}>;

export type BusinessPriceUpdateWire = Readonly<
  Omit<BusinessPriceValidationWire,
    | "status"
    | "businessPriceValidation"
    | "quantityDiscountPlanPresence"
    | "fbaEvidenceHash"
    | "canonicalPatchHash"
    | "validationIssuesHash"
    | "validatedAt"
  > & {
    status: "ACCEPTED" | "SIMULATED";
    businessPriceValidation: "validated";
    acceptedAt: string;
    submissionId: string | null;
    requestId: string | null;
  }
>;

/** ACCEPTED/PROCESSING is never interchangeable with canonical VERIFIED. */
export type BusinessPriceWriteStatusWire = Readonly<{
  mode: "live";
  status: "PROCESSING" | "VERIFIED";
  stage: "minimum_price" | "business_price";
  marketplaceId: string;
  sellerSku: string;
  asin: string;
  productType: string;
  acceptedAt: string;
  verifiedAt: string | null;
  requestId: string | null;
  submissionId: string | null;
  verified: boolean;
  authoritative: boolean;
  canResend: false;
  businessPriceSubmitted: boolean;
  previousBusinessPrice: BusinessPricingMoneyWire | null;
  requestedBusinessPrice: BusinessPricingMoneyWire | null;
  previousMinimumPrice: BusinessPricingMoneyWire | null;
  requestedMinimumPrice: BusinessPricingMoneyWire | null;
  lowestTierUnitPrice: BusinessPricingMoneyWire | null;
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlanWire | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlanWire | null;
  quantityDiscountPlanChange: "preserve" | "replace" | null;
  notice: string;
}>;
