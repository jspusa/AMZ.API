import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingPriceSnapshot, Money } from "./listing-price-types";
import type { ListingIssue } from "./sp-api-error";

export type BusinessPricingCapability = {
  supported: boolean;
  editable: boolean;
  reason: string | null;
  quantityDiscountsSupported: boolean;
  quantityDiscountsEditable: boolean;
  quantityDiscountsReason: string | null;
  schemaChecksum: string | null;
};

export type BusinessQuantityDiscountLevel = {
  lowerBound: number;
  value: number;
};

export type BusinessQuantityDiscountPlan = {
  discountType: "percent" | "fixed";
  levels: BusinessQuantityDiscountLevel[];
};

export type BusinessPricingListingSnapshot = ListingPriceSnapshot & {
  minimumPricePresence?: "absent" | "canonical" | "ambiguous";
  minimumPriceProtectedHash?: string;
  businessPrice: Money | null;
  businessOfferPresence: "absent" | "present" | "ambiguous";
  businessPricingManagedByAutomation: boolean;
  quantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanPresence:
    | "absent"
    | "canonical"
    | "duplicate"
    | "ambiguous";
  quantityDiscountPlanHash: string | null;
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  businessPricingCapability: BusinessPricingCapability;
};

export type BusinessPriceValidationResult = {
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string;
  productType: string;
  standardPrice: Money;
  previousBusinessPrice: Money | null;
  requestedBusinessPrice: Money;
  previousMinimumPrice: Money | null;
  requestedMinimumPrice: Money | null;
  lowestTierUnitPrice: Money | null;
  minimumPriceChange: "preserve" | "lower";
  minimumPriceProtectedHash: string | null;
  minimumPriceCanonicalPatchHash: string | null;
  businessPriceValidation:
    | "validated"
    | "final-state-validated"
    | "deferred-until-minimum-price";
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  previousQuantityDiscountPlanHash: string | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanPresence:
    | "absent"
    | "canonical"
    | "duplicate"
    | "ambiguous";
  quantityDiscountPlanChange: "preserve" | "replace";
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  schemaChecksum: string;
  fbaEvidenceHash: string;
  canonicalPatchHash: string;
  validationIssuesHash: string;
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};

export type BusinessPricePrecommitEvidence = Pick<
  BusinessPriceValidationResult,
  | "asin"
  | "productType"
  | "businessOfferGuardHash"
  | "businessOfferProtectedHash"
  | "minimumPriceProtectedHash"
  | "minimumPriceCanonicalPatchHash"
  | "businessPriceValidation"
  | "previousQuantityDiscountPlanHash"
  | "quantityDiscountPlanPresence"
  | "quantityDiscountPlanChange"
  | "schemaChecksum"
  | "fbaEvidenceHash"
  | "canonicalPatchHash"
  | "validationIssuesHash"
>;

export type BusinessPriceUpdateResult = {
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string;
  productType: string;
  standardPrice: Money;
  previousBusinessPrice: Money | null;
  requestedBusinessPrice: Money;
  previousMinimumPrice: Money | null;
  requestedMinimumPrice: Money | null;
  lowestTierUnitPrice: Money | null;
  minimumPriceChange: "preserve" | "lower";
  minimumPriceProtectedHash: string | null;
  minimumPriceCanonicalPatchHash: string | null;
  businessPriceValidation: "validated";
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  previousQuantityDiscountPlanHash: string | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanChange: "preserve" | "replace";
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  schemaChecksum: string;
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

/**
 * Public, redacted lifecycle projection for a previously authorized Business
 * Pricing write. `PROCESSING` proves Amazon returned an ACCEPTED receipt but
 * does not claim the requested values are live yet. `VERIFIED` is emitted only
 * after a later canonical GET matches the durable target exactly.
 */
export type BusinessPriceWriteStatus = {
  mode: "live";
  status: "PROCESSING" | "VERIFIED";
  stage: "minimum_price" | "business_price";
  marketplaceId: MarketplaceId;
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
  previousBusinessPrice: Money | null;
  requestedBusinessPrice: Money | null;
  previousMinimumPrice: Money | null;
  requestedMinimumPrice: Money | null;
  lowestTierUnitPrice: Money | null;
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanChange: "preserve" | "replace" | null;
  notice: string;
};

export type UpdateBusinessPriceInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedStandardPrice: number;
  expectedBusinessPrice: number | null;
  newBusinessPrice: number;
  expectedMinimumPrice?: number | null;
  expectedQuantityDiscountPlanHash?: string | null;
  quantityDiscountTiers?: Array<{
    lowerBound: number;
    percent: number;
  }>;
};
