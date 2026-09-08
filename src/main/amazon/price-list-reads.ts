import type { MarketplaceId } from "../../shared/marketplaces";
import { canonicalBusinessStandardPrice } from "./business-pricing-evidence";
import {
  exactListingEnvelopeIdentity,
  readListingsItem,
  type ListingsReadAdapter,
} from "./listings-reads";
import { throwListingsReadError } from "./listings-response-error";
import { SpApiError } from "./sp-api-error";

export type PriceListListingFacts = Readonly<{
  standardPrice: number | null;
  minimumPrice: number | null;
  minimumPriceStatus: "set" | "not-set" | "unavailable";
  imageUrl: string | null;
}>;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Only Amazon-hosted product-image bytes may be fetched for the local workbook. */
export function priceListAmazonImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      [
        "m.media-amazon.com",
        "images-na.ssl-images-amazon.com",
        "images-fe.ssl-images-amazon.com",
        "images-eu.ssl-images-amazon.com",
      ].includes(url.hostname) &&
      /^\/images\/I\/[A-Za-z0-9+%_.!,()-]+\.(?:jpg|jpeg|png)$/iu.test(
        url.pathname,
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function minimum(
  offers: unknown,
  marketplaceId: MarketplaceId,
): Pick<PriceListListingFacts, "minimumPrice" | "minimumPriceStatus"> {
  const unavailable = {
    minimumPrice: null,
    minimumPriceStatus: "unavailable" as const,
  };
  if (
    !Array.isArray(offers) ||
    !offers.every(record) ||
    offers.some(
      (offer) =>
        typeof offer.marketplace_id !== "string" ||
        (offer.audience !== undefined && typeof offer.audience !== "string"),
    )
  )
    return unavailable;
  const all = offers.filter(
    (offer) =>
      offer.marketplace_id === marketplaceId &&
      (offer.audience === "ALL" || offer.audience === undefined),
  );
  if (all.length !== 1 || all[0]!.currency !== "USD") return unavailable;
  const raw = all[0]!.minimum_seller_allowed_price;
  if (raw === undefined)
    return { minimumPrice: null, minimumPriceStatus: "not-set" };
  if (
    !Array.isArray(raw) ||
    raw.length !== 1 ||
    !record(raw[0]) ||
    Object.keys(raw[0]).length !== 1 ||
    !Array.isArray(raw[0].schedule) ||
    raw[0].schedule.length !== 1
  )
    return unavailable;
  const schedule = raw[0].schedule[0];
  if (!record(schedule) || Object.keys(schedule).length !== 1)
    return unavailable;
  const value = schedule.value_with_tax;
  if (
    (typeof value !== "number" &&
      (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/u.test(value))) ||
    !Number.isFinite(Number(value)) ||
    Number(value) <= 0 ||
    Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) > 1e-6
  )
    return unavailable;
  return { minimumPrice: Number(value), minimumPriceStatus: "set" };
}

/** Caller proves the current FBA set; this fixed GET rechecks exact SKU/ASIN identity. */
export async function readPriceListListing(
  adapter: Pick<ListingsReadAdapter, "readItem">,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
    asin: string;
    signal?: AbortSignal;
  }>,
): Promise<PriceListListingFacts> {
  const reply = await readListingsItem(adapter, {
    intent: "listing",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    signal: input.signal,
  });
  if (reply.status < 200 || reply.status >= 300)
    throwListingsReadError(reply, "getListingsItem");
  if (
    !exactListingEnvelopeIdentity(
      reply.envelope,
      input.marketplaceId,
      input.sellerSku,
      input.asin,
    )
  ) {
    throw new SpApiError("Amazon 商品身分與價目表本次 FBA 對應不一致。", {
      status: 422,
      code: "PRICE_LIST_IDENTITY_MISMATCH",
    });
  }
  const envelope = reply.envelope as Record<string, unknown>;
  const attributes = record(envelope.attributes) ? envelope.attributes : {};
  const standard = canonicalBusinessStandardPrice(
    attributes.purchasable_offer,
    input.marketplaceId,
  );
  const rawImages = attributes.main_product_image_locator;
  const images =
    Array.isArray(rawImages) && rawImages.every(record)
      ? rawImages.filter(
          (entry) => entry.marketplace_id === input.marketplaceId,
        )
      : [];
  const summary = (envelope.summaries as Record<string, unknown>[]).find(
    (entry) => entry.marketplaceId === input.marketplaceId,
  )!;
  const canonicalImage = record(summary.mainImage)
    ? priceListAmazonImageUrl(summary.mainImage.link)
    : null;
  const imageUrl =
    canonicalImage ??
    (images.length === 1
      ? priceListAmazonImageUrl(images[0]!.media_location)
      : null);
  return {
    standardPrice: standard?.currencyCode === "USD" ? standard.amount : null,
    ...minimum(attributes.purchasable_offer, input.marketplaceId),
    imageUrl,
  };
}
