import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  BusinessMinimumPricePresenceWire,
  BusinessPriceUpdateWire,
  BusinessPriceValidationWire,
  BusinessPriceWriteBodyWire,
  BusinessPriceWriteStatusWire,
  BusinessPricingCapabilityWire,
  BusinessPricingListingWire,
  BusinessQuantityDiscountLevelWire,
  BusinessQuantityDiscountPlanWire,
} from "../../shared/business-pricing-wire";
import type { ListingPriceSnapshot } from "./listing-price-types";
import type { ListingIssue } from "./sp-api-error";

// Main keeps its mutable domain structures and narrowed identities; the public
// field vocabulary is owned by the browser-safe wire contract.
type MutableWire<T> = T extends readonly (infer Item)[]
  ? MutableWire<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: MutableWire<T[Key]> }
    : T;

type MainPayload<T> = Omit<MutableWire<T>, "marketplaceId" | "issues"> & {
  marketplaceId: MarketplaceId;
  issues: ListingIssue[];
};

export type BusinessPricingCapability = MutableWire<BusinessPricingCapabilityWire>;
export type BusinessQuantityDiscountLevel = MutableWire<BusinessQuantityDiscountLevelWire>;
export type BusinessQuantityDiscountPlan = MutableWire<BusinessQuantityDiscountPlanWire>;

export type BusinessPricingListingSnapshot = ListingPriceSnapshot &
  Omit<MutableWire<BusinessPricingListingWire>, "marketplaceId" | "minimumPricePresence" | "writeStatus"> & {
    minimumPricePresence?: BusinessMinimumPricePresenceWire;
    minimumPriceProtectedHash?: string;
  };

export type BusinessPriceValidationResult = MainPayload<BusinessPriceValidationWire>;

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

export type BusinessPriceUpdateResult = MainPayload<BusinessPriceUpdateWire>;

/** Main-only identity narrowing preserves the public redacted lifecycle shape. */
export type BusinessPriceWriteStatus =
  Omit<MutableWire<BusinessPriceWriteStatusWire>, "marketplaceId"> & {
    marketplaceId: MarketplaceId;
  };

export type UpdateBusinessPriceInput =
  Omit<MutableWire<BusinessPriceWriteBodyWire>, "marketplaceId" | "idempotencyKey"> & {
    marketplaceId: MarketplaceId;
  };
