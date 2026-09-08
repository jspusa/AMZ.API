import type { OperationsReadMetadata } from "./operations-intelligence";

export type PriceHealthMoney = Readonly<{ amount: number; currencyCode: string }>;
export type PriceHealthSegment = Readonly<{
  membership: "PRIME" | "NON_PRIME" | "DEFAULT" | "unknown";
  isOwnSeller: boolean | null;
  fulfillment: "AFN" | "MFN" | "unknown";
  listingPrice: PriceHealthMoney | null;
  shippingPrice: PriceHealthMoney | null;
  glanceViewWeightPercentage: number | null;
}>;
export type PriceHealthReference = Readonly<{
  name: "CompetitivePriceThreshold" | "CompetitivePrice" | "WasPrice" | "unknown";
  price: PriceHealthMoney | null;
}>;
export type PriceHealthRow = Readonly<{
  sellerSku: string;
  asin: string;
  status: "observed" | "needs-review" | "insufficient-evidence";
  availability: "complete" | "partial" | "unavailable";
  /** Competitive Summary is not our current exact-SKU listing-price source. */
  currentPrice: PriceHealthMoney | null;
  overallEligibility: "unknown";
  featuredObservation: "own-observed" | "other-observed" | "mixed-observed" | "unknown";
  segments: readonly PriceHealthSegment[];
  referencePrices: readonly PriceHealthReference[];
  warnings: readonly string[];
}>;
export type PriceHealthSnapshot = OperationsReadMetadata & Readonly<{
  rows: readonly PriceHealthRow[];
}>;
