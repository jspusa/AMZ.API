import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingIssue } from "./sp-api-error";

export type Money = {
  amount: number;
  currencyCode: string;
};

export type FulfillmentAvailability = {
  channelCode: string;
  quantity: number | null;
  fulfillment: "FBA" | "OTHER";
  editable: boolean;
};

export type SalePriceSchedule = {
  price: Money;
  startAt: string | null;
  endAt: string | null;
};

export type ListingPriceSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  title: string;
  productType: string;
  status: string[];
  createdAt: string | null;
  updatedAt: string | null;
  standardPrice: Money | null;
  effectivePrice: Money | null;
  minimumPrice: Money | null;
  maximumPrice: Money | null;
  purchasableOfferPresence: "absent" | "present" | "ambiguous";
  discountedPrice: SalePriceSchedule | null;
  discountedPricePresence: "absent" | "valid" | "invalid";
  hasDiscountedPrice: boolean;
  hasAutomatedPricing: boolean;
  fetchedAt: string;
  requestId: string | null;
  issues: ListingIssue[];
  fulfillmentAvailability: FulfillmentAvailability[];
  notice: string | null;
};

export type ListingWriteExecutionFence = Readonly<{
  assertCurrent(): Promise<void>;
}>;

export type UpdateListingPriceInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  newPrice: number;
  expectedPrice: number;
};

export type PriceValidationResult = {
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previousPrice: Money;
  requestedPrice: Money;
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};

export type PriceUpdateResult = {
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previousPrice: Money;
  requestedPrice: Money;
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

export type UpdateListingSalePriceInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  action: "set" | "cancel";
  expectedPrice: number;
  expectedDiscountedPrice: number | null;
  expectedStartAt: string | null;
  expectedEndAt: string | null;
  salePrice: number | null;
  startAt: string | null;
  endAt: string | null;
};

export type SalePriceValidationResult = {
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  action: "set" | "cancel";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  standardPrice: Money;
  previousDiscountedPrice: SalePriceSchedule | null;
  requestedDiscountedPrice: SalePriceSchedule | null;
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};

export type SalePriceUpdateResult = {
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  action: "set" | "cancel";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  standardPrice: Money;
  previousDiscountedPrice: SalePriceSchedule | null;
  requestedDiscountedPrice: SalePriceSchedule | null;
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};
