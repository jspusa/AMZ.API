import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import type { BusinessPricingCapabilitiesPort } from
  "./business-pricing-capabilities";
import {
  businessPricingPatchBody,
  businessPricingValidationPreviewBody,
  type BusinessPricingGateway,
  type BusinessPricingIdentity,
} from "./business-pricing-gateway";
import {
  listingSubmissionIssuesAreWellFormed,
} from "./business-pricing-evidence";
import type {
  BusinessPricingListingSnapshot,
  BusinessQuantityDiscountPlan,
} from "./business-pricing-types";
import {
  assertExactListingIdentity,
  assertFbaListingPayload,
  businessOfferSnapshot,
  canonicalBusinessStandardPrice,
  isRecord,
  normalizeListingPrice,
  type AmazonPurchasableOffer,
} from "./listing-item-projection";
import type { ListingItemReads } from "./listing-item-reads";
import type { ListingPriceSnapshot } from "./listing-price-types";
import type { ListingsWriteProduction } from
  "./listings-write-production";
import { SpApiError } from "./sp-api-error";

type BusinessPricingMode = "live" | "demo";

export type BusinessPricingGatewayProductionDependencies = Readonly<{
  listingItems: Pick<ListingItemReads, "fetchLiveListingItem">;
  capabilities: BusinessPricingCapabilitiesPort;
  readDemoPrice(identity: BusinessPricingIdentity): ListingPriceSnapshot;
  resolveMode(marketplaceId: MarketplaceId): BusinessPricingMode;
  credentialGeneration(): number;
  write: ListingsWriteProduction;
}>;

export type BusinessPricingGatewayProductionRuntime = Readonly<{
  gateway: BusinessPricingGateway;
  readDemo(
    identity: BusinessPricingIdentity,
  ): BusinessPricingListingSnapshot;
  clear(): void;
}>;

function demoKey(identity: BusinessPricingIdentity): string {
  return `${identity.marketplaceId}:${identity.sellerSku}`;
}

/**
 * Fixed Business Pricing production boundary.
 *
 * The domain can ask only for a canonical B2B read, a fixed validation
 * preview, or one fenced commit. Raw Listings URLs, methods, tokens and bodies
 * never cross this boundary. Demo writes share the same private contribution
 * state as demo reads and are discarded when credential generation changes.
 */
export function createBusinessPricingGatewayProduction(
  dependencies: BusinessPricingGatewayProductionDependencies,
): BusinessPricingGatewayProductionRuntime {
  const demoBusinessPriceOverrides = new Map<string, number>();
  const demoQuantityDiscountOverrides = new Map<
    string,
    BusinessQuantityDiscountPlan
  >();

  function demoBusinessPriceAmount(
    listing: ListingPriceSnapshot,
  ): number | null {
    if (!listing.standardPrice) return null;
    const override = demoBusinessPriceOverrides.get(demoKey(listing));
    if (override !== undefined) return override;
    const configuredByDefault = [...listing.sellerSku]
      .reduce(
        (sum, character) => sum + character.codePointAt(0)!,
        0,
      ) % 2 === 0;
    if (!configuredByDefault) return null;
    return Number((listing.standardPrice.amount * 0.9).toFixed(
      listing.standardPrice.currencyCode === "JPY" ? 0 : 2,
    ));
  }

  const readDemo = (
    identity: BusinessPricingIdentity,
  ): BusinessPricingListingSnapshot => {
    const marketplace = marketplaceById(identity.marketplaceId);
    if (!marketplace) {
      throw new SpApiError("不支援的 Amazon 站點。", {
        status: 400,
        code: "UNSUPPORTED_MARKETPLACE",
      });
    }
    const listing = dependencies.readDemoPrice(identity);
    const amount = demoBusinessPriceAmount(listing);
    const quantityDiscountPlan = demoQuantityDiscountOverrides.get(
      demoKey(identity),
    ) ?? null;
    const demoOffers: AmazonPurchasableOffer[] = amount
      ? [{
          marketplace_id: identity.marketplaceId,
          currency: marketplace.currency,
          audience: "B2B",
          our_price: [{ schedule: [{ value_with_tax: amount }] }],
          ...(quantityDiscountPlan
            ? {
                quantity_discount_plan: [{
                  schedule: [{
                    discount_type: quantityDiscountPlan.discountType,
                    levels: quantityDiscountPlan.levels.map((level) => ({
                      lower_bound: level.lowerBound,
                      value: level.value,
                    })),
                  }],
                }],
              }
            : {}),
        }]
      : [];
    const business = businessOfferSnapshot({
      attributes: { purchasable_offer: demoOffers },
    }, identity.marketplaceId);
    return {
      ...listing,
      ...business,
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: true,
        quantityDiscountsReason: null,
        schemaChecksum: "demo-business-pricing-schema",
      },
    };
  };

  async function readLive(
    identity: BusinessPricingIdentity,
    purpose: "read-only" | "mutation",
  ): Promise<BusinessPricingListingSnapshot> {
    const { payload, requestId } =
      await dependencies.listingItems.fetchLiveListingItem(
        identity.marketplaceId,
        identity.sellerSku,
      );
    assertExactListingIdentity(
      payload,
      identity.marketplaceId,
      identity.sellerSku,
    );
    if (
      !Array.isArray(payload.fulfillmentAvailability) ||
      !payload.fulfillmentAvailability.every(isRecord)
    ) {
      throw new SpApiError(
        "Amazon B2B 價格回應的 fulfillmentAvailability 格式無法辨識。",
        { status: 502, code: "UPSTREAM_UNAVAILABLE" },
      );
    }
    assertFbaListingPayload(payload);
    if (
      !isRecord(payload.attributes) ||
      !Array.isArray(payload.attributes.purchasable_offer) ||
      !payload.attributes.purchasable_offer.every(isRecord) ||
      (payload.offers !== undefined &&
        (!Array.isArray(payload.offers) || !payload.offers.every(isRecord))) ||
      !listingSubmissionIssuesAreWellFormed(payload.issues)
    ) {
      throw new SpApiError(
        "Amazon B2B 價格回應缺少 attributes，或 optional offers／issues 格式無法辨識。",
        { status: 502, code: "UPSTREAM_UNAVAILABLE" },
      );
    }
    const listing = normalizeListingPrice(
      payload,
      identity.marketplaceId,
      requestId,
    );
    const standardPrice = canonicalBusinessStandardPrice(
      payload,
      identity.marketplaceId,
    );
    if (!standardPrice) {
      throw new SpApiError(
        "Amazon 一般售價不是唯一、無日期的標準價格，已停止 B2B 預檢。",
        { status: 409, code: "B2B_PRICE_EVIDENCE_INCOMPLETE" },
      );
    }
    const business = businessOfferSnapshot(payload, identity.marketplaceId);
    const capability = await dependencies.capabilities.read({
      marketplaceId: identity.marketplaceId,
      productType: listing.productType,
      forceRefresh: purpose === "mutation",
    });
    return {
      ...listing,
      standardPrice,
      ...business,
      businessPricingCapability: capability,
    };
  }

  const gateway: BusinessPricingGateway = {
    mode: dependencies.resolveMode,
    read: async (identity, purpose) => {
      if (dependencies.resolveMode(identity.marketplaceId) === "live") {
        return readLive(identity, purpose);
      }
      const startedGeneration = dependencies.credentialGeneration();
      const snapshot = readDemo(identity);
      await Promise.resolve();
      if (startedGeneration !== dependencies.credentialGeneration()) {
        throw new SpApiError(
          "Amazon 憑證已在展示 B2B 價格讀取期間改變；舊結果已丟棄。",
          { status: 409, code: "CREDENTIALS_CHANGED" },
        );
      }
      return snapshot;
    },
    quantityDiscountPlanSupported: (input) => {
      if (dependencies.resolveMode(input.marketplaceId) === "demo") {
        return true;
      }
      return dependencies.capabilities.quantityDiscountPlanSupported({
        marketplaceId: input.marketplaceId,
        productType: input.productType,
        schemaChecksum: input.schemaChecksum,
        levels: input.plan.levels,
      });
    },
    validationPreview: async (patch) =>
      dependencies.write.validationPreview({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: businessPricingValidationPreviewBody(patch),
        includeIdentifiers: true,
      }),
    commitOnce: async (patch, fence, recordDispatch) =>
      dependencies.write.commitOnce({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: businessPricingPatchBody(patch),
        assertBeforeSend: () => fence.assertCurrent(),
        recordBeforeSend: recordDispatch,
      }),
    replaceDemoContribution: async (patch, fence) => {
      const startedGeneration = dependencies.credentialGeneration();
      await fence.assertCurrent();
      if (startedGeneration !== dependencies.credentialGeneration()) {
        throw new SpApiError(
          "Amazon 憑證已在展示 B2B 價格更新期間改變；舊結果已丟棄。",
          { status: 409, code: "CREDENTIALS_CHANGED" },
        );
      }
      demoBusinessPriceOverrides.set(demoKey(patch), patch.amount);
      if (patch.kind === "combined") {
        demoQuantityDiscountOverrides.set(demoKey(patch), {
          discountType: "percent",
          levels: patch.quantityDiscountPlan.levels.map((level) => ({
            lowerBound: level.lowerBound,
            value: level.value,
          })),
        });
      }
    },
  };

  return Object.freeze({
    gateway,
    readDemo,
    clear: () => {
      demoBusinessPriceOverrides.clear();
      demoQuantityDiscountOverrides.clear();
    },
  });
}
