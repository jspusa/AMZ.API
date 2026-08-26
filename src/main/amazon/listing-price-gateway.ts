import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  ListingPriceSnapshot,
  SalePriceSchedule,
} from "./listing-price-types";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";

export type ListingPriceIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

export type ListingPricePatch =
  | (ListingPriceIdentity & Readonly<{
      kind: "standard-price";
      productType: string;
      currencyCode: string;
      amount: number;
    }>)
  | (ListingPriceIdentity & Readonly<{
      kind: "sale-price";
      productType: string;
      currencyCode: string;
      discountedPrice: Readonly<{
        amount: number;
        startAt: string;
        endAt: string;
      }> | null;
    }>);

export function listingPricePatchBody(
  input: ListingPricePatch,
): Readonly<{ productType: string; patches: readonly unknown[] }> {
  const value = input.kind === "standard-price"
    ? {
        marketplace_id: input.marketplaceId,
        currency: input.currencyCode,
        audience: "ALL",
        our_price: [{ schedule: [{ value_with_tax: input.amount }] }],
      }
    : {
        marketplace_id: input.marketplaceId,
        currency: input.currencyCode,
        audience: "ALL",
        discounted_price: input.discountedPrice
          ? [{
              schedule: [{
                start_at: input.discountedPrice.startAt,
                end_at: input.discountedPrice.endAt,
                value_with_tax: input.discountedPrice.amount,
              }],
            }]
          : null,
      };
  return {
    productType: input.productType,
    patches: [{
      op: "merge",
      path: "/attributes/purchasable_offer",
      value: [value],
    }],
  };
}

export type ListingPriceGatewayReply = Readonly<{
  ok: boolean;
  status: number;
  requestId: string | null;
  retryAfter: string | null;
  payload: unknown;
}>;

/**
 * Fixed production boundary below the Standard/Sale Price domain.
 *
 * The domain chooses the exact canonical patch. This port owns only one
 * Listings Items endpoint, Validation Preview transport, at-most-once commit
 * transport, the shared canonical read, and the single shared demo state.
 */
export interface ListingPriceGateway {
  mode(marketplaceId: MarketplaceId): "live" | "demo";
  read(input: ListingPriceIdentity): Promise<ListingPriceSnapshot>;
  setDemoStandardPrice(input: ListingPriceIdentity & Readonly<{
    amount: number;
  }>): void;
  setDemoSalePrice(input: ListingPriceIdentity & Readonly<{
    schedule: SalePriceSchedule | null;
  }>): void;
  validationPreview(input: ListingPricePatch): Promise<ListingPriceGatewayReply>;
  commitOnce(
    input: ListingPricePatch,
    fence: ListingWriteExecutionFence,
  ): Promise<ListingPriceGatewayReply>;
}
