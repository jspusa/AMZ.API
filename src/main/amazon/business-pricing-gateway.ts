import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  BusinessPricingListingSnapshot,
  BusinessQuantityDiscountLevel,
} from "./business-pricing-types";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";

export type BusinessPricingIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

export type BusinessPercentQuantityDiscountPlan = Readonly<{
  discountType: "percent";
  levels: readonly BusinessQuantityDiscountLevel[];
}>;

type BusinessPricePatchBase = BusinessPricingIdentity & Readonly<{
  asin: string;
  productType: string;
  currencyCode: string;
  amount: number;
}>;

export type BusinessPricePatch =
  | (BusinessPricePatchBase & Readonly<{
      kind: "price-only";
      quantityDiscountPlan: null;
    }>)
  | (BusinessPricePatchBase & Readonly<{
      kind: "combined";
      quantityDiscountPlan: BusinessPercentQuantityDiscountPlan;
    }>);

export type BusinessPricingGatewayReply = Readonly<{
  ok: boolean;
  status: number;
  requestId: string | null;
  retryAfter: string | null;
  payload: unknown;
}>;

export function businessPricingPatchBody(
  patch: BusinessPricePatch,
): Readonly<{ productType: string; patches: readonly unknown[] }> {
  return {
    productType: patch.productType,
    patches: [{
      op: "merge",
      path: "/attributes/purchasable_offer",
      value: [{
        marketplace_id: patch.marketplaceId,
        currency: patch.currencyCode,
        audience: "B2B",
        our_price: [{ schedule: [{ value_with_tax: patch.amount }] }],
        ...(patch.kind === "combined"
          ? {
              quantity_discount_plan: [{
                schedule: [{
                  discount_type: "percent",
                  levels: patch.quantityDiscountPlan.levels.map((level) => ({
                    lower_bound: level.lowerBound,
                    value: level.value,
                  })),
                }],
              }],
            }
          : {}),
      }],
    }],
  };
}

/**
 * Fixed production boundary below the complete Business Pricing mutation
 * domain. Callers cannot select an endpoint, method, token, retry policy or
 * arbitrary Listings body.
 */
export interface BusinessPricingGateway {
  mode(marketplaceId: MarketplaceId): "live" | "demo";
  read(
    identity: BusinessPricingIdentity,
    purpose: "read-only" | "mutation",
  ): Promise<BusinessPricingListingSnapshot>;
  quantityDiscountPlanSupported(input: Readonly<{
    marketplaceId: MarketplaceId;
    productType: string;
    schemaChecksum: string;
    plan: BusinessPercentQuantityDiscountPlan;
  }>): boolean;
  validationPreview(
    patch: BusinessPricePatch,
  ): Promise<BusinessPricingGatewayReply>;
  commitOnce(
    patch: BusinessPricePatch,
    fence: ListingWriteExecutionFence,
    recordDispatch: () => Promise<void>,
  ): Promise<BusinessPricingGatewayReply>;
  replaceDemoContribution(
    patch: BusinessPricePatch,
    fence: ListingWriteExecutionFence,
  ): Promise<void>;
}
