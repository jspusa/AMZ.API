import { createHash } from "node:crypto";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { isDateOnly } from "./marketplace-calendar";
import {
  canonicalBusinessStandardPrice as canonicalBusinessStandardPriceEvidence,
  normalizeBusinessOfferReadEvidence,
} from "./business-pricing-evidence";
import type { BusinessPricingListingSnapshot } from
  "./business-pricing-types";
import type { ContentCapabilities } from "./listing-content-capabilities";
import type { ListingContentSnapshot } from "./listing-content-types";
import type {
  FulfillmentAvailability,
  ListingPriceSnapshot,
  Money,
  SalePriceSchedule,
} from "./listing-price-types";
import { normalizeListingIssues } from "./listings-response-error";
import { exactListingEnvelopeIdentity } from "./listings-reads";
import { SpApiError } from "./sp-api-error";

export type AmazonListingIssue = {
  code?: string;
  severity?: string;
  message?: string;
  attributeName?: string;
  attributeNames?: string[];
  categories?: string[];
  marketplaceIds?: string[];
};

export type AmazonPriceSchedule = {
  schedule?: Array<{
    value_with_tax?: string | number;
    start_at?: string;
    end_at?: string;
  }>;
};

export type AmazonQuantityDiscountPlan = {
  schedule?: Array<{
    discount_type?: string;
    levels?: Array<{
      lower_bound?: string | number;
      value?: string | number;
    }>;
  }>;
};

export type AmazonPurchasableOffer = {
  marketplace_id?: string;
  currency?: string;
  audience?: string;
  our_price?: AmazonPriceSchedule[];
  discounted_price?: AmazonPriceSchedule[];
  minimum_seller_allowed_price?: AmazonPriceSchedule[];
  maximum_seller_allowed_price?: AmazonPriceSchedule[];
  quantity_discount_plan?: AmazonQuantityDiscountPlan[];
  automated_pricing_merchandising_rule_plan?: unknown[];
};

export type AmazonListingItem = {
  sku?: string;
  summaries?: Array<{
    marketplaceId?: string;
    asin?: string;
    productType?: string;
    status?: string[];
    itemName?: string;
    createdDate?: string;
    lastUpdatedDate?: string;
  }>;
  attributes?: {
    purchasable_offer?: AmazonPurchasableOffer[];
    [key: string]: unknown;
  };
  productTypes?: Array<{
    marketplaceId?: string;
    productType?: string;
  }>;
  offers?: Array<{
    marketplaceId?: string;
    offerType?: string;
    price?: {
      currencyCode?: string;
      currency?: string;
      amount?: string | number;
    };
    audience?: { value?: string; displayName?: string };
  }>;
  issues?: AmazonListingIssue[];
  relationships?: Array<{
    marketplaceId?: string;
    relationships?: Array<{
      type?: string;
      childSkus?: string[];
      parentSkus?: string[];
      variationTheme?: {
        attributes?: string[];
        theme?: string;
      };
    }>;
  }>;
  fulfillmentAvailability?: Array<{
    fulfillmentChannelCode?: string;
    quantity?: number;
  }>;
};

export type AmazonListingSearchResponse = {
  items?: AmazonListingItem[];
  numberOfResults?: number;
  pagination?: { nextToken?: string; previousToken?: string };
};

export const IMAGE_ATTRIBUTE_NAMES = [
  "main_product_image_locator",
  "other_product_image_locator_1",
  "other_product_image_locator_2",
  "other_product_image_locator_3",
  "other_product_image_locator_4",
  "other_product_image_locator_5",
  "other_product_image_locator_6",
  "other_product_image_locator_7",
  "other_product_image_locator_8",
] as const;

export const CONTENT_TEXT_ATTRIBUTE_NAMES = [
  "item_name",
  "title_differentiation",
  "bullet_point",
  "product_description",
  "ingredients",
] as const;

export type ListingContentAttributeName =
  typeof CONTENT_TEXT_ATTRIBUTE_NAMES[number];
export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function safeText(
  value: string | undefined,
  fallback: string,
): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJsonValue(value)))
    .digest("hex");
}

export function listingSummary(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
) {
  return (
    payload.summaries?.find((item) => item.marketplaceId === marketplaceId) ??
    payload.summaries?.[0]
  );
}

export function listingProductType(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
): string {
  const productType = payload.productTypes?.find(
    (item) => item.marketplaceId === marketplaceId,
  )?.productType;
  const summaryProductType = payload.summaries?.find(
    (item) => item.marketplaceId === marketplaceId,
  )?.productType;
  return safeText(productType ?? summaryProductType, "PRODUCT");
}

export function attributeObjects(
  payload: AmazonListingItem,
  name: string,
  marketplaceId: MarketplaceId,
): JsonRecord[] {
  const raw = payload.attributes?.[name];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is JsonRecord => {
    if (!isRecord(item)) return false;
    const itemMarketplace = item.marketplace_id;
    return typeof itemMarketplace !== "string" ||
      !itemMarketplace ||
      itemMarketplace === marketplaceId;
  });
}

export function payloadHasFbaAvailability(
  payload: AmazonListingItem,
): boolean {
  return Array.isArray(payload.fulfillmentAvailability) &&
    payload.fulfillmentAvailability.some((availability) =>
      isRecord(availability) && /^(AMAZON|AFN)(?:_|$)/i.test(
        typeof availability.fulfillmentChannelCode === "string"
          ? availability.fulfillmentChannelCode
          : "",
      )
    );
}

export function assertFbaListingPayload(payload: AmazonListingItem): void {
  if (payloadHasFbaAvailability(payload)) return;
  throw new SpApiError(
    "此 SKU 無法確認為 FBA 商品；純 FBA 管理台不會讀取或修改它。",
    { status: 422, code: "FBA_ONLY" },
  );
}

export function listingPriceIsFba(listing: ListingPriceSnapshot): boolean {
  return listing.fulfillmentAvailability.some(
    (availability) => availability.fulfillment === "FBA",
  );
}

export function assertFbaListingPrice(listing: ListingPriceSnapshot): void {
  if (listingPriceIsFba(listing)) return;
  throw new SpApiError(
    "此 SKU 無法確認為 FBA 商品；純 FBA 管理台不會讀取或修改它。",
    { status: 422, code: "FBA_ONLY" },
  );
}

export function canonicalBusinessStandardPrice(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
): Money | null {
  return canonicalBusinessStandardPriceEvidence(
    payload.attributes?.purchasable_offer,
    marketplaceId,
  );
}

export function businessOfferSnapshot(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
): Pick<
  BusinessPricingListingSnapshot,
  | "businessPrice"
  | "businessOfferPresence"
  | "businessPricingManagedByAutomation"
  | "quantityDiscountPlan"
  | "quantityDiscountPlanPresence"
  | "quantityDiscountPlanHash"
  | "businessOfferGuardHash"
  | "businessOfferProtectedHash"
> {
  const allOffers = payload.attributes?.purchasable_offer ?? [];
  const evidence = normalizeBusinessOfferReadEvidence(
    payload.attributes?.purchasable_offer,
    marketplaceId,
  );
  return {
    ...evidence,
    quantityDiscountPlanHash: evidence.quantityDiscountPlan
      ? canonicalSha256(evidence.quantityDiscountPlan)
      : null,
    businessOfferGuardHash: businessOfferGuardHash(allOffers, marketplaceId),
    businessOfferProtectedHash: businessOfferProtectedHash(
      allOffers,
      marketplaceId,
    ),
  };
}

export function assertExactListingIdentity(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  sellerSku: string,
): void {
  if (exactListingEnvelopeIdentity(payload, marketplaceId, sellerSku)) return;
  throw new SpApiError(
    "Amazon Listing 回應的 SKU、ASIN、商品類型或站點身分不完整，已停止使用。",
    { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
  );
}

export function normalizeListingPrice(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  requestId: string | null,
): ListingPriceSnapshot {
  const marketplace = marketplaceById(marketplaceId)!;
  const summary = listingSummary(payload, marketplaceId);
  const matchingPurchasableOffers = payload.attributes?.purchasable_offer
    ?.filter((offer) =>
      offer.marketplace_id === marketplaceId &&
      (!offer.audience || offer.audience === "ALL")
    ) ?? [];
  const purchasableOffer = matchingPurchasableOffers.length === 1
    ? matchingPurchasableOffers[0]
    : undefined;
  const effectiveOffer = payload.offers?.find((offer) =>
    offer.marketplaceId === marketplaceId && offer.offerType === "B2C"
  ) ?? payload.offers?.find((offer) =>
    offer.marketplaceId === marketplaceId && !offer.offerType
  );
  const standardCurrency = purchasableOffer?.currency ?? marketplace.currency;
  const rawDiscountedPrice = purchasableOffer?.discounted_price;
  const discountedPrice = parseDiscountedPrice(
    rawDiscountedPrice,
    standardCurrency,
  );
  const effectiveAmount = Number(effectiveOffer?.price?.amount);
  const effectiveCurrency = listingOfferCurrencyCode(effectiveOffer?.price);
  const fulfillmentAvailability = (payload.fulfillmentAvailability ?? []).map(
    (availability): FulfillmentAvailability => {
      const channelCode = safeText(
        availability.fulfillmentChannelCode,
        "UNKNOWN",
      );
      const quantity = Number(availability.quantity);
      return {
        channelCode,
        quantity: Number.isInteger(quantity) && quantity >= 0 ? quantity : null,
        fulfillment: /^(AMAZON|AFN)(?:_|$)/i.test(channelCode)
          ? "FBA"
          : "OTHER",
        editable: false,
      };
    },
  );

  return {
    mode: "live",
    marketplaceId,
    sellerSku: safeText(payload.sku, "—"),
    asin: summary?.asin?.trim() || null,
    title: safeText(summary?.itemName, "Amazon Listing"),
    productType: listingProductType(payload, marketplaceId),
    status: Array.isArray(summary?.status) ? summary.status : [],
    createdAt: summary?.createdDate ?? null,
    updatedAt: summary?.lastUpdatedDate ?? null,
    standardPrice: parseScheduledPrice(
      purchasableOffer?.our_price,
      standardCurrency,
    ),
    effectivePrice: Number.isFinite(effectiveAmount) && effectiveCurrency
      ? { amount: effectiveAmount, currencyCode: effectiveCurrency }
      : null,
    minimumPrice: parseScheduledPrice(
      purchasableOffer?.minimum_seller_allowed_price,
      standardCurrency,
    ),
    maximumPrice: parseScheduledPrice(
      purchasableOffer?.maximum_seller_allowed_price,
      standardCurrency,
    ),
    purchasableOfferPresence: matchingPurchasableOffers.length === 0
      ? "absent"
      : matchingPurchasableOffers.length === 1
        ? "present"
        : "ambiguous",
    discountedPrice,
    discountedPricePresence: rawDiscountedPrice === undefined
      ? "absent"
      : discountedPrice
        ? "valid"
        : "invalid",
    hasDiscountedPrice: Boolean(discountedPrice),
    hasAutomatedPricing: Boolean(
      purchasableOffer?.automated_pricing_merchandising_rule_plan?.length,
    ),
    fetchedAt: new Date().toISOString(),
    requestId,
    issues: normalizeListingIssues(payload.issues),
    fulfillmentAvailability,
    notice: null,
  };
}

export function normalizeListingContent(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  requestId: string | null,
  capabilities: ContentCapabilities,
  mode: "live" | "demo" = "live",
  noticeOverride: string | null = null,
): ListingContentSnapshot {
  const summary = listingSummary(payload, marketplaceId);
  const allowedLanguages = [
    ...capabilities.title.languageTags,
    ...capabilities.itemHighlight.languageTags,
    ...capabilities.bulletPoints.languageTags,
    ...capabilities.productDescription.languageTags,
    ...capabilities.ingredients.languageTags,
  ];
  const languageTag = preferredLanguageTag(
    payload,
    marketplaceId,
    [...new Set(allowedLanguages)],
  );
  const title = attributeTextValuesForLanguage(
    payload,
    "item_name",
    marketplaceId,
    languageTag,
  )[0] ?? safeText(summary?.itemName, "Amazon Listing");
  return {
    mode,
    marketplaceId,
    sellerSku: safeText(payload.sku, "—"),
    asin: summary?.asin?.trim() || null,
    productType: listingProductType(payload, marketplaceId),
    status: Array.isArray(summary?.status) ? summary.status : [],
    title,
    itemHighlight: attributeTextValuesForLanguage(
      payload,
      "title_differentiation",
      marketplaceId,
      languageTag,
    )[0] ?? "",
    bulletPoints: attributeTextValuesForLanguage(
      payload,
      "bullet_point",
      marketplaceId,
      languageTag,
    ).slice(0, 5),
    productDescription: attributeTextValuesForLanguage(
      payload,
      "product_description",
      marketplaceId,
      languageTag,
    )[0] ?? "",
    ingredients: attributeTextValuesForLanguage(
      payload,
      "ingredients",
      marketplaceId,
      languageTag,
    )[0] ?? "",
    languageTag,
    attributePresence: {
      title: attributeObjects(payload, "item_name", marketplaceId).length > 0,
      itemHighlight:
        attributeObjects(payload, "title_differentiation", marketplaceId)
          .length > 0,
      bulletPoints:
        attributeObjects(payload, "bullet_point", marketplaceId).length > 0,
      productDescription:
        attributeObjects(payload, "product_description", marketplaceId)
          .length > 0,
      ingredients:
        attributeObjects(payload, "ingredients", marketplaceId).length > 0,
    },
    capabilities,
    createdAt: summary?.createdDate ?? null,
    updatedAt: summary?.lastUpdatedDate ?? null,
    fetchedAt: new Date().toISOString(),
    requestId,
    issues: normalizeListingIssues(payload.issues),
    notice: noticeOverride ?? (mode === "live"
      ? "內容取自你提交給 Amazon 的 Listing attributes；買家頁採用結果可能稍後更新。"
      : "展示內容只供操作測試，不會變更 Amazon。"),
  };
}

function marketplaceCurrency(marketplaceId: MarketplaceId): string {
  return marketplaceById(marketplaceId)!.currency;
}

function marketplaceIssueLocale(marketplaceId: MarketplaceId): string {
  return marketplaceById(marketplaceId)!.locale.replace("-", "_");
}

function parseScheduledPrice(
  values: AmazonPriceSchedule[] | undefined,
  currencyCode: string | undefined,
): Money | null {
  const amount = finiteNumericValue(values?.[0]?.schedule?.[0]?.value_with_tax);
  return amount === null || !currencyCode ? null : { amount, currencyCode };
}

function listingOfferCurrencyCode(
  price: { currencyCode?: string; currency?: string } | undefined,
): string | null {
  const canonical = typeof price?.currencyCode === "string" &&
      price.currencyCode.trim()
    ? price.currencyCode
    : null;
  const legacy = typeof price?.currency === "string" && price.currency.trim()
    ? price.currency
    : null;
  return canonical && legacy && canonical !== legacy
    ? null
    : canonical ?? legacy;
}

function businessOfferGuardHash(
  offers: readonly AmazonPurchasableOffer[],
  marketplaceId: MarketplaceId,
): string {
  const protectedOffers = offers
    .map((offer) => {
      if (
        offer.marketplace_id !== marketplaceId ||
        offer.audience !== "B2B" ||
        offer.currency !== marketplaceCurrency(marketplaceId)
      ) return offer;
      const { our_price: _targetBusinessPrice, ...protectedOffer } = offer;
      const protectedFieldNames = Object.keys(protectedOffer).filter(
        (key) => !["marketplace_id", "audience", "currency"].includes(key),
      );
      return protectedFieldNames.length ? protectedOffer : null;
    })
    .filter((offer): offer is AmazonPurchasableOffer => offer !== null)
    .map(canonicalJsonValue)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );
  return createHash("sha256")
    .update(JSON.stringify(protectedOffers))
    .digest("hex");
}

function businessOfferProtectedHash(
  offers: readonly AmazonPurchasableOffer[],
  marketplaceId: MarketplaceId,
): string {
  const protectedOffers = offers
    .map((offer) => {
      if (
        offer.marketplace_id !== marketplaceId ||
        offer.audience !== "B2B" ||
        offer.currency !== marketplaceCurrency(marketplaceId)
      ) return offer;
      const {
        our_price: _targetBusinessPrice,
        quantity_discount_plan: _targetQuantityDiscounts,
        ...protectedOffer
      } = offer;
      const protectedFieldNames = Object.keys(protectedOffer).filter(
        (key) => !["marketplace_id", "audience", "currency"].includes(key),
      );
      return protectedFieldNames.length ? protectedOffer : null;
    })
    .filter((offer): offer is AmazonPurchasableOffer => offer !== null)
    .map(canonicalJsonValue)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );
  return canonicalSha256(protectedOffers);
}

function parseDiscountedPrice(
  values: AmazonPriceSchedule[] | undefined,
  currencyCode: string | undefined,
): SalePriceSchedule | null {
  const schedule = values?.[0]?.schedule?.[0];
  const amount = finiteNumericValue(schedule?.value_with_tax);
  if (amount === null || !currencyCode) return null;
  return {
    price: { amount, currencyCode },
    startAt: canonicalSaleDate(schedule?.start_at),
    endAt: canonicalSaleDate(schedule?.end_at),
  };
}

function canonicalSaleDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})$/)?.[1];
  const isoDate = value.match(
    /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
  )?.[1];
  const candidate = dateOnly ?? isoDate;
  return candidate && isDateOnly(candidate) ? candidate : null;
}

function finiteNumericValue(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function attributeTextValuesForLanguage(
  payload: AmazonListingItem,
  name: string,
  marketplaceId: MarketplaceId,
  languageTag: string,
): string[] {
  const items = attributeObjects(payload, name, marketplaceId);
  const localized = items.filter((item) => item.language_tag === languageTag);
  const selected = localized.length
    ? localized
    : items.filter((item) =>
      typeof item.language_tag !== "string" || !item.language_tag.trim()
    );
  return selected
    .map((item) => item.value)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function preferredLanguageTag(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  allowed: string[] = [],
): string {
  const marketplaceLanguage = marketplaceIssueLocale(marketplaceId);
  const availableLanguages = CONTENT_TEXT_ATTRIBUTE_NAMES
    .flatMap((name) => attributeObjects(payload, name, marketplaceId))
    .map((item) => item.language_tag)
    .filter((value): value is string =>
      typeof value === "string" && Boolean(value.trim())
    );
  if (
    availableLanguages.includes(marketplaceLanguage) &&
    (!allowed.length || allowed.includes(marketplaceLanguage))
  ) return marketplaceLanguage;
  for (const name of CONTENT_TEXT_ATTRIBUTE_NAMES) {
    const languageTag = attributeObjects(payload, name, marketplaceId)
      .map((item) => item.language_tag)
      .find((value): value is string =>
        typeof value === "string" && Boolean(value.trim())
      );
    if (languageTag && (!allowed.length || allowed.includes(languageTag))) {
      return languageTag;
    }
  }
  return allowed.includes(marketplaceLanguage)
    ? marketplaceLanguage
    : (allowed[0] ?? marketplaceLanguage);
}
