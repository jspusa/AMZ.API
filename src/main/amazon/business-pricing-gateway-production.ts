import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import type { BusinessPricingCapabilitiesPort } from
  "./business-pricing-capabilities";
import {
  businessPricingPatchBody,
  businessPricingValidationPreviewBody,
  type BusinessMinimumPricePatch,
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
  canonicalJsonValue,
  canonicalSha256,
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

type MinimumPriceMetadata = Readonly<{
  presence: "absent" | "canonical" | "ambiguous";
  protectedHash: string;
  allOffer: AmazonPurchasableOffer | null;
}>;

function exactMinimumPriceAmount(value: unknown): number | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const price = value[0];
  if (!isRecord(price) || Object.keys(price).length !== 1 ||
      !Array.isArray(price.schedule) || price.schedule.length !== 1) {
    return null;
  }
  const schedule = price.schedule[0];
  if (!isRecord(schedule) || Object.keys(schedule).length !== 1) return null;
  const amount = Number(schedule.value_with_tax);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function minimumPriceMetadata(
  offers: readonly AmazonPurchasableOffer[],
  marketplaceId: MarketplaceId,
  currencyCode: string,
): MinimumPriceMetadata {
  const matching = offers.filter((offer) =>
    offer.marketplace_id === marketplaceId &&
    (offer.audience === undefined || offer.audience === "ALL")
  );
  const protectedOffers = offers
    .map((offer) => {
      if (matching.length === 1 && offer === matching[0]) {
        const {
          minimum_seller_allowed_price: _minimumPrice,
          ...protectedOffer
        } = offer;
        return canonicalJsonValue(protectedOffer);
      }
      return canonicalJsonValue(offer);
    })
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );
  const protectedHash = canonicalSha256(protectedOffers);
  if (
    matching.length !== 1 ||
    matching[0]!.currency !== currencyCode
  ) {
    return { presence: "ambiguous", protectedHash, allOffer: null };
  }
  const allOffer = matching[0]!;
  if (allOffer.minimum_seller_allowed_price === undefined) {
    return {
      presence: "absent",
      protectedHash,
      allOffer: structuredClone(allOffer),
    };
  }
  return exactMinimumPriceAmount(allOffer.minimum_seller_allowed_price) === null
    ? { presence: "ambiguous", protectedHash, allOffer: null }
    : {
        presence: "canonical",
        protectedHash,
        allOffer: structuredClone(allOffer),
      };
}

function minimumPricePatchBody(
  patch: BusinessMinimumPricePatch,
  contribution: AmazonPurchasableOffer,
): Readonly<{ productType: string; patches: readonly unknown[] }> {
  return {
    productType: patch.productType,
    patches: [{
      op: "replace",
      path: "/attributes/purchasable_offer",
      value: [structuredClone(contribution)],
    }],
  };
}

function finalBusinessPricingPreviewBody(
  patch: Parameters<typeof businessPricingValidationPreviewBody>[0],
  contribution: AmazonPurchasableOffer,
): Readonly<{ productType: string; patches: readonly unknown[] }> {
  const body = businessPricingValidationPreviewBody(patch);
  const operation = body.patches[0] as Readonly<{
    op: string;
    path: string;
    value: readonly unknown[];
  }>;
  return {
    productType: body.productType,
    patches: [{
      ...operation,
      value: [structuredClone(contribution), ...operation.value],
    }],
  };
}

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
  const demoMinimumPriceOverrides = new Map<string, number>();
  const snapshotMinimumPriceMetadata = new WeakMap<
    BusinessPricingListingSnapshot,
    MinimumPriceMetadata
  >();
  const minimumPriceContributions = new WeakMap<
    BusinessMinimumPricePatch,
    AmazonPurchasableOffer
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
    const minimumPrice = demoMinimumPriceOverrides.has(demoKey(identity))
      ? {
          amount: demoMinimumPriceOverrides.get(demoKey(identity))!,
          currencyCode: marketplace.currency,
        }
      : listing.minimumPrice;
    const demoAllOffer: AmazonPurchasableOffer = {
      marketplace_id: identity.marketplaceId,
      currency: marketplace.currency,
      audience: "ALL",
      ...(listing.standardPrice
        ? {
            our_price: [{
              schedule: [{ value_with_tax: listing.standardPrice.amount }],
            }],
          }
        : {}),
      ...(minimumPrice
        ? {
            minimum_seller_allowed_price: [{
              schedule: [{ value_with_tax: minimumPrice.amount }],
            }],
          }
        : {}),
    };
    const minimumMetadata = minimumPriceMetadata(
      [demoAllOffer, ...demoOffers],
      identity.marketplaceId,
      marketplace.currency,
    );
    const snapshot: BusinessPricingListingSnapshot = {
      ...listing,
      minimumPrice,
      minimumPricePresence: minimumMetadata.presence,
      minimumPriceProtectedHash: minimumMetadata.protectedHash,
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
    snapshotMinimumPriceMetadata.set(snapshot, minimumMetadata);
    return snapshot;
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
    const minimumMetadata = minimumPriceMetadata(
      payload.attributes.purchasable_offer,
      identity.marketplaceId,
      marketplaceById(identity.marketplaceId)!.currency,
    );
    const snapshot: BusinessPricingListingSnapshot = {
      ...listing,
      standardPrice,
      minimumPrice: minimumMetadata.presence === "canonical"
        ? listing.minimumPrice
        : null,
      minimumPricePresence: minimumMetadata.presence,
      minimumPriceProtectedHash: minimumMetadata.protectedHash,
      ...business,
      businessPricingCapability: capability,
    };
    snapshotMinimumPriceMetadata.set(snapshot, minimumMetadata);
    return snapshot;
  }

  function minimumContribution(
    patch: BusinessMinimumPricePatch,
  ): AmazonPurchasableOffer {
    const contribution = minimumPriceContributions.get(patch);
    if (
      !contribution ||
      contribution.marketplace_id !== patch.marketplaceId ||
      contribution.currency !== patch.currencyCode ||
      (contribution.audience !== undefined &&
        contribution.audience !== "ALL") ||
      exactMinimumPriceAmount(
        contribution.minimum_seller_allowed_price,
      ) !== patch.amount ||
      canonicalSha256(minimumPricePatchBody(patch, contribution)) !==
        patch.canonicalPatchHash
    ) {
      throw new SpApiError(
        "最低允許售價寫入描述已失效；請重新讀取並預檢。",
        { status: 409, code: "PREVIEW_CHANGED" },
      );
    }
    return contribution;
  }

  function assertMinimumPricePair(
    patch: Parameters<typeof businessPricingValidationPreviewBody>[0],
    minimumPricePatch: BusinessMinimumPricePatch,
  ): void {
    if (
      patch.marketplaceId !== minimumPricePatch.marketplaceId ||
      patch.sellerSku !== minimumPricePatch.sellerSku ||
      patch.asin !== minimumPricePatch.asin ||
      patch.productType !== minimumPricePatch.productType ||
      patch.currencyCode !== minimumPricePatch.currencyCode
    ) {
      throw new SpApiError(
        "B2B 價格與最低允許售價不是同一個 exact Listing；請重新讀取並預檢。",
        { status: 409, code: "PREVIEW_CHANGED" },
      );
    }
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
    mintMinimumPricePatch: (snapshot, amount) => {
      const metadata = snapshotMinimumPriceMetadata.get(snapshot);
      const current = snapshot.minimumPrice;
      if (
        snapshot.mode !== dependencies.resolveMode(snapshot.marketplaceId) ||
        snapshot.minimumPricePresence !== "canonical" ||
        !metadata || metadata.presence !== "canonical" ||
        !metadata.allOffer || !current ||
        current.currencyCode !== "USD" ||
        !Number.isFinite(amount) || amount <= 0 ||
        Math.round(amount * 100) / 100 !== amount ||
        amount >= current.amount ||
        !snapshot.asin
      ) return null;
      const contribution = structuredClone(metadata.allOffer);
      contribution.minimum_seller_allowed_price = [{
        schedule: [{ value_with_tax: amount }],
      }];
      const patchBase = {
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        asin: snapshot.asin,
        productType: snapshot.productType,
        currencyCode: "USD",
        previousAmount: current.amount,
        amount,
        protectedHash: metadata.protectedHash,
      };
      const canonicalPatchHash = canonicalSha256(minimumPricePatchBody(
        {
          ...patchBase,
          canonicalPatchHash: "pending",
        },
        contribution,
      ));
      const patch = Object.freeze({ ...patchBase, canonicalPatchHash });
      minimumPriceContributions.set(patch, contribution);
      return patch;
    },
    minimumPriceProtectedHash: (snapshot) =>
      snapshotMinimumPriceMetadata.get(snapshot)?.protectedHash ?? null,
    validationPreview: async (patch) =>
      dependencies.write.validationPreview({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: businessPricingValidationPreviewBody(patch),
        includeIdentifiers: true,
      }),
    finalStateValidationPreview: async (patch, minimumPricePatch) => {
      assertMinimumPricePair(patch, minimumPricePatch);
      return dependencies.write.validationPreview({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: finalBusinessPricingPreviewBody(
          patch,
          minimumContribution(minimumPricePatch),
        ),
        includeIdentifiers: true,
      });
    },
    minimumPriceValidationPreview: async (patch) =>
      dependencies.write.validationPreview({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: minimumPricePatchBody(
          patch,
          minimumContribution(patch),
        ),
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
    commitMinimumPriceOnce: async (patch, fence, recordDispatch) =>
      dependencies.write.commitOnce({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: minimumPricePatchBody(
          patch,
          minimumContribution(patch),
        ),
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
    replaceDemoMinimumPrice: async (patch, fence) => {
      const startedGeneration = dependencies.credentialGeneration();
      minimumContribution(patch);
      await fence.assertCurrent();
      if (startedGeneration !== dependencies.credentialGeneration()) {
        throw new SpApiError(
          "Amazon 憑證已在展示最低允許售價更新期間改變；舊結果已丟棄。",
          { status: 409, code: "CREDENTIALS_CHANGED" },
        );
      }
      demoMinimumPriceOverrides.set(demoKey(patch), patch.amount);
    },
  };

  return Object.freeze({
    gateway,
    readDemo,
    clear: () => {
      demoBusinessPriceOverrides.clear();
      demoQuantityDiscountOverrides.clear();
      demoMinimumPriceOverrides.clear();
    },
  });
}
