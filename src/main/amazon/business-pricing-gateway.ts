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

function businessPricingPatchBodyWithOperation(
  patch: BusinessPricePatch,
  operation: "merge" | "replace",
): Readonly<{ productType: string; patches: readonly unknown[] }> {
  return {
    productType: patch.productType,
    patches: [{
      op: operation,
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

export function businessPricingPatchBody(
  patch: BusinessPricePatch,
): Readonly<{ productType: string; patches: readonly unknown[] }> {
  return businessPricingPatchBodyWithOperation(patch, "merge");
}

/**
 * Amazon accepts merge for the persisted Listings Items mutation, but rejects
 * merge when mode=VALIDATION_PREVIEW. Preview the exact proposed B2B
 * contribution with replace, then keep the persisted mutation on merge so ALL
 * and other audience contributions are not replaced.
 */
export function businessPricingValidationPreviewBody(
  patch: BusinessPricePatch,
): Readonly<{ productType: string; patches: readonly unknown[] }> {
  return businessPricingPatchBodyWithOperation(patch, "replace");
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
