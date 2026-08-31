import {
  abortableDelay,
  throwIfAborted,
} from "../abort-utils";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { businessPricingRecommendationFlags } from "../../shared/business-pricing-recommendations";
import {
  canonicalBusinessStandardPrice,
  isPricingListingError,
  listingSubmissionIssuesAreWellFormed,
  normalizeBusinessOfferReadEvidence,
  sameBusinessQuantityDiscountPlan,
  sameMarketplacePrice,
  type BusinessOfferReadEvidence,
} from "./business-pricing-evidence";
import { planExactSellerSkuBatches } from "./exact-seller-sku-batches";
import {
  exactListingEnvelopeIdentity,
  readListingsItem,
  searchListingsItems,
  type ListingsReadAdapter,
  type ListingsSearchReadResult,
} from "./listings-reads";
import { throwListingsReadError } from "./listings-response-error";
import { publicSpApiRequestId, SpApiError } from "./sp-api-error";

const EXACT_SELLER_SKU =
  /^(?!.*[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]).+$/u;
const FBA_FULFILLMENT_CHANNEL = /^(?:AMAZON|AFN)(?:_|$)/iu;
const DOCUMENTED_FULFILLMENT_CHANNEL =
  /^(?:AMAZON|AFN|DEFAULT|MFN)(?:[_-].*)?$/iu;
const CONTENT_TEXT_ATTRIBUTE_NAMES = [
  "item_name",
  "title_differentiation",
  "bullet_point",
  "product_description",
  "ingredients",
] as const;
const IMAGE_ATTRIBUTE_NAMES = [
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
const LISTINGS_BATCH_SIZE = 20;
const LISTINGS_PACE_MILLISECONDS = 220;

export type CatalogListingsReadAdapter = Pick<
  ListingsReadAdapter,
  "readItem" | "searchItems"
>;

export type CatalogExportReadError = Readonly<{
  code: "LISTING_QUERY_FAILED" | "LISTING_CONTENT_NOT_RETURNED";
  message: string;
}>;

export type CatalogExportRow = {
  marketplace: string;
  sellerSku: string;
  asin: string;
  productType: string;
  title: string;
  itemHighlight: string;
  bulletPoints: string[];
  productDescription: string;
  ingredients: string;
  imageUrls: string[];
  status: string;
  updatedAt: string;
  readStatus: "complete" | "incomplete";
  readErrors: CatalogExportReadError[];
};

export type CatalogExportError = Readonly<{
  sellerSku: string;
  kind: string;
  message: string;
}>;

export type CatalogExportProgress = Readonly<{
  phase: "report-downloaded" | "listings";
  completedUnits: number;
  totalUnits: number;
}>;

export type FbaCatalogExport = Readonly<{
  rows: CatalogExportRow[];
  errors: CatalogExportError[];
  fetchedAt: string;
}>;

export type FbaCatalogIdentitySnapshot = Readonly<{
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  rows: Array<{
    sellerSku: string;
    asin: string;
    title: string;
  }>;
  notice: string;
}>;

export type Money = {
  amount: number;
  currencyCode: string;
};

export type BusinessQuantityDiscountLevel = {
  lowerBound: number;
  value: number;
};

export type BusinessQuantityDiscountPlan = {
  discountType: "percent" | "fixed";
  levels: BusinessQuantityDiscountLevel[];
};

export type BusinessPricingAuditRow = {
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  standardPrice: Money | null;
  businessPrice: Money | null;
  businessOfferPresence: "absent" | "present" | "ambiguous";
  quantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanPresence: "absent" | "canonical" | "ambiguous";
  recommendedPriceMismatch: boolean;
  recommendedQuantityDiscountMismatch: boolean;
  status:
    | "configured"
    | "above_standard"
    | "missing"
    | "unsupported"
    | "incomplete";
  editable: false;
  reason: string;
};

export type BusinessPricingAuditSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  rows: BusinessPricingAuditRow[];
  summary: {
    totalFbaSkuCount: number;
    configured: number;
    aboveStandard: number;
    missing: number;
    unsupported: number;
    incomplete: number;
    recommendedPriceMismatch: number;
    recommendedQuantityDiscountMismatch: number;
  };
  notice: string;
};

export type ReadFbaCatalogExportInput = Readonly<{
  marketplaceId: MarketplaceId;
  mode: "live";
  document: string;
  signal?: AbortSignal;
  onProgress?: (
    progress: CatalogExportProgress,
  ) => void | Promise<void>;
  pace?: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  now?: () => Date;
}>;

export type FbaCatalogSeed = Readonly<{
  sellerSku: string;
  asin: string;
  title: string;
}>;

type ListingReportBusinessPriceEvidence =
  | Readonly<{ presence: "unavailable" | "absent" | "ambiguous"; amount: null }>
  | Readonly<{ presence: "present"; amount: number }>;

type ListingReportQuantityDiscountEvidence =
  | Readonly<{
      presence: "unavailable" | "absent" | "ambiguous";
      plan: null;
    }>
  | Readonly<{
      presence: "canonical";
      plan: BusinessQuantityDiscountPlan;
    }>;

type ListingReportQuantityDiscountColumns =
  | Readonly<{ presence: "unavailable" }>
  | Readonly<{ presence: "ambiguous" }>
  | Readonly<{
      presence: "available";
      typeIndex: number;
      levels: readonly Readonly<{
        lowerBoundIndex: number;
        valueIndex: number;
      }>[];
    }>;

type ParsedFbaCatalogReport = Readonly<{
  seeds: FbaCatalogSeed[];
  businessPriceEvidenceBySku: Map<string, ListingReportBusinessPriceEvidence>;
  quantityDiscountEvidenceBySku: Map<
    string,
    ListingReportQuantityDiscountEvidence
  >;
}>;

type ListingEnvelope = Readonly<{
  sku?: string;
  summaries?: Array<{
    marketplaceId?: string;
    asin?: string;
    productType?: string;
    status?: string[];
    itemName?: string;
    lastUpdatedDate?: string;
  }>;
  productTypes?: Array<{
    marketplaceId?: string;
    productType?: string;
  }>;
  attributes?: Record<string, unknown>;
  offers?: unknown;
  issues?: unknown;
  fulfillmentAvailability?: Array<{
    fulfillmentChannelCode?: string;
    quantity?: number;
  }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/u, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "\t" && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.length)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) {
    throw new SpApiError("Amazon 全商品報表含有未結束的引號欄位。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  if (value.length || row.length) {
    row.push(value);
    if (row.some((cell) => cell.length)) rows.push(row);
  }
  return rows;
}

function normalizedReportHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
}

function matchingReportColumns(
  headers: string[],
  candidates: readonly string[],
): number[] {
  const accepted = new Set(candidates.map(normalizedReportHeader));
  return headers
    .map(normalizedReportHeader)
    .map((header, index) => accepted.has(header) ? index : -1)
    .filter((index) => index >= 0);
}

function reportColumn(
  headers: string[],
  candidates: readonly string[],
): number {
  return matchingReportColumns(headers, candidates)[0] ?? -1;
}

function uniqueReportColumn(
  headers: string[],
  candidates: readonly string[],
): number {
  const matches = matchingReportColumns(headers, candidates);
  return matches.length === 1 ? matches[0]! : -1;
}

function listingReportBusinessPriceEvidence(
  row: readonly string[],
  businessPriceIndex: number,
): ListingReportBusinessPriceEvidence {
  if (businessPriceIndex < 0) {
    return { presence: "unavailable", amount: null };
  }
  const raw = row[businessPriceIndex]?.trim() ?? "";
  if (!raw) return { presence: "absent", amount: null };
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/u.test(raw)) {
    return { presence: "ambiguous", amount: null };
  }
  const amount = Number(raw.replace(/,/gu, ""));
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000
    ? { presence: "present", amount }
    : { presence: "ambiguous", amount: null };
}

function listingReportQuantityDiscountColumns(
  headers: string[],
): ListingReportQuantityDiscountColumns {
  const typeMatches = matchingReportColumns(headers, ["quantity-price-type"]);
  const slots = Array.from({ length: 5 }, (_, offset) => {
    const level = offset + 1;
    return {
      lowerBoundMatches: matchingReportColumns(headers, [
        `quantity-lower-bound-${level}`,
        `quantity-lower-bound${level}`,
      ]),
      valueMatches: matchingReportColumns(headers, [
        `quantity-price-${level}`,
        `quantity-price${level}`,
      ]),
    };
  });
  const hasAnyQuantityHeader = typeMatches.length > 0 || slots.some((slot) =>
    slot.lowerBoundMatches.length > 0 || slot.valueMatches.length > 0
  );
  if (!hasAnyQuantityHeader) return { presence: "unavailable" };
  if (
    typeMatches.length !== 1 ||
    slots.some((slot) =>
      slot.lowerBoundMatches.length > 1 || slot.valueMatches.length > 1
    )
  ) {
    return { presence: "ambiguous" };
  }
  const levels: Array<{ lowerBoundIndex: number; valueIndex: number }> = [];
  let sawHeaderGap = false;
  for (const slot of slots) {
    const hasLowerBound = slot.lowerBoundMatches.length === 1;
    const hasValue = slot.valueMatches.length === 1;
    if (hasLowerBound !== hasValue) return { presence: "ambiguous" };
    if (!hasLowerBound) {
      sawHeaderGap = true;
      continue;
    }
    if (sawHeaderGap) return { presence: "ambiguous" };
    levels.push({
      lowerBoundIndex: slot.lowerBoundMatches[0]!,
      valueIndex: slot.valueMatches[0]!,
    });
  }
  return levels.length > 0
    ? { presence: "available", typeIndex: typeMatches[0]!, levels }
    : { presence: "ambiguous" };
}

function listingReportPositiveNumber(rawValue: string): number | null {
  const raw = rawValue.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/u.test(raw)) {
    return null;
  }
  const value = Number(raw.replace(/,/gu, ""));
  return Number.isFinite(value) && value > 0 && value <= 1_000_000_000
    ? value
    : null;
}

function listingReportQuantityDiscountEvidence(
  row: readonly string[],
  columns: ListingReportQuantityDiscountColumns,
): ListingReportQuantityDiscountEvidence {
  if (columns.presence === "unavailable") {
    return { presence: "unavailable", plan: null };
  }
  if (columns.presence === "ambiguous") {
    return { presence: "ambiguous", plan: null };
  }
  const rawType = row[columns.typeIndex]?.trim().toLowerCase() ?? "";
  const rawLevels = columns.levels.map((level) => ({
    lowerBound: row[level.lowerBoundIndex]?.trim() ?? "",
    value: row[level.valueIndex]?.trim() ?? "",
  }));
  if (!rawType && rawLevels.every((level) => !level.lowerBound && !level.value)) {
    return { presence: "absent", plan: null };
  }
  const discountType = rawType === "percent" || rawType === "percentage"
    ? "percent"
    : rawType === "fixed"
      ? "fixed"
      : null;
  if (!discountType) return { presence: "ambiguous", plan: null };

  const levels: BusinessQuantityDiscountLevel[] = [];
  let sawValueGap = false;
  for (const rawLevel of rawLevels) {
    if (!rawLevel.lowerBound && !rawLevel.value) {
      sawValueGap = true;
      continue;
    }
    if (!rawLevel.lowerBound || !rawLevel.value || sawValueGap) {
      return { presence: "ambiguous", plan: null };
    }
    const lowerBound = listingReportPositiveNumber(rawLevel.lowerBound);
    const value = listingReportPositiveNumber(rawLevel.value);
    if (
      lowerBound === null ||
      !Number.isSafeInteger(lowerBound) ||
      value === null ||
      (discountType === "percent" && value >= 100)
    ) {
      return { presence: "ambiguous", plan: null };
    }
    const previous = levels.at(-1);
    if (
      previous &&
      (lowerBound <= previous.lowerBound ||
        (discountType === "percent"
          ? value <= previous.value
          : value >= previous.value))
    ) {
      return { presence: "ambiguous", plan: null };
    }
    levels.push({ lowerBound, value });
  }
  return levels.length > 0
    ? { presence: "canonical", plan: { discountType, levels } }
    : { presence: "ambiguous", plan: null };
}

function parseFbaCatalogReport(document: string): ParsedFbaCatalogReport {
  const rows = parseTsv(document);
  const headers = rows[0] ?? [];
  const skuHeaders = ["seller-sku", "sku"];
  const asinHeaders = ["asin1", "asin"];
  const fulfillmentHeaders = [
    "fulfillment-channel",
    "fulfillment-channel-code",
  ];
  const businessPriceHeaders = ["business-price"];

  if (
    [skuHeaders, asinHeaders, fulfillmentHeaders, businessPriceHeaders].some(
      (candidates) => matchingReportColumns(headers, candidates).length > 1,
    )
  ) {
    throw new SpApiError(
      "Amazon 全商品報表含有重複的 SKU、ASIN、履約管道或 Business Price 欄位，已停止讀取。",
      { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
    );
  }

  let skuIndex = uniqueReportColumn(headers, skuHeaders);
  let asinIndex = uniqueReportColumn(headers, asinHeaders);
  let titleIndex = reportColumn(headers, ["item-name", "title"]);
  let fulfillmentIndex = uniqueReportColumn(headers, fulfillmentHeaders);
  const businessPriceIndex = uniqueReportColumn(
    headers,
    businessPriceHeaders,
  );
  const quantityDiscountColumns = listingReportQuantityDiscountColumns(headers);
  const fixedLayoutRows = rows.slice(1).filter((row) => row.some(Boolean));
  const fixedFulfillmentValues = fixedLayoutRows
    .map((row) => row[26]?.trim() ?? "")
    .filter(Boolean);
  const matchesDocumentedFixedLayout =
    headers.length >= 28 &&
    fixedLayoutRows.length > 0 &&
    fixedLayoutRows.every((row) => Boolean(row[3]?.trim())) &&
    fixedFulfillmentValues.length > 0 &&
    fixedFulfillmentValues.every((value) =>
      DOCUMENTED_FULFILLMENT_CHANNEL.test(value)
    );
  if (matchesDocumentedFixedLayout) {
    if (skuIndex < 0) skuIndex = 3;
    if (asinIndex < 0) asinIndex = 16;
    if (titleIndex < 0) titleIndex = 0;
    if (fulfillmentIndex < 0) fulfillmentIndex = 26;
  }

  if (skuIndex < 0) {
    throw new SpApiError("Amazon 全商品報表找不到 SKU 欄位。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  if (fulfillmentIndex < 0) {
    throw new SpApiError(
      "Amazon 全商品報表找不到履約管道欄位，為避免混入 FBM 商品，已停止匯出。",
      { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
    );
  }

  const seen = new Set<string>();
  const seeds: FbaCatalogSeed[] = [];
  const businessPriceEvidenceBySku = new Map<
    string,
    ListingReportBusinessPriceEvidence
  >();
  const quantityDiscountEvidenceBySku = new Map<
    string,
    ListingReportQuantityDiscountEvidence
  >();
  for (const row of rows.slice(1)) {
    const fulfillment = row[fulfillmentIndex]?.trim() ?? "";
    if (!FBA_FULFILLMENT_CHANNEL.test(fulfillment)) continue;

    const sellerSku = row[skuIndex] ?? "";
    if (
      !sellerSku ||
      sellerSku.length > 40 ||
      sellerSku !== sellerSku.trim() ||
      !EXACT_SELLER_SKU.test(sellerSku) ||
      seen.has(sellerSku)
    ) {
      throw new SpApiError(
        "Amazon 全商品報表含有缺少、重複或無法精確辨識的 FBA Seller SKU；為避免改寫識別或少算商品，已停止讀取。",
        { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
      );
    }
    seen.add(sellerSku);
    businessPriceEvidenceBySku.set(
      sellerSku,
      listingReportBusinessPriceEvidence(row, businessPriceIndex),
    );
    quantityDiscountEvidenceBySku.set(
      sellerSku,
      listingReportQuantityDiscountEvidence(row, quantityDiscountColumns),
    );
    seeds.push({
      sellerSku,
      // Keep report identity byte-for-byte. The Listings equality guard below
      // decides whether it is safe; trimming would silently change identity.
      asin: asinIndex >= 0 ? row[asinIndex] ?? "" : "",
      title: titleIndex >= 0 ? row[titleIndex]?.trim() ?? "" : "",
    });
  }
  return {
    seeds,
    businessPriceEvidenceBySku,
    quantityDiscountEvidenceBySku,
  };
}

function parseBusinessPricingActiveListingsReport(
  document: string,
  seeds: readonly FbaCatalogSeed[],
): Readonly<{
  businessPriceEvidenceBySku: Map<
    string,
    ListingReportBusinessPriceEvidence
  >;
  quantityDiscountEvidenceBySku: Map<
    string,
    ListingReportQuantityDiscountEvidence
  >;
}> {
  const businessPriceEvidenceBySku = new Map<
    string,
    ListingReportBusinessPriceEvidence
  >(
    seeds.map((seed) => [
      seed.sellerSku,
      { presence: "unavailable" as const, amount: null },
    ]),
  );
  const quantityDiscountEvidenceBySku = new Map<
    string,
    ListingReportQuantityDiscountEvidence
  >(
    seeds.map((seed) => [
      seed.sellerSku,
      { presence: "unavailable" as const, plan: null },
    ]),
  );
  const seedBySku = new Map(seeds.map((seed) => [seed.sellerSku, seed]));
  const rows = parseTsv(document);
  const headers = rows[0] ?? [];
  const skuMatches = matchingReportColumns(headers, ["seller-sku", "sku"]);
  const asinMatches = matchingReportColumns(headers, [
    "asin1",
    "asin-1",
    "asin",
  ]);
  const fulfillmentMatches = matchingReportColumns(headers, [
    "fulfillment-channel",
    "fulfillment-channel-code",
  ]);
  const businessPriceMatches = matchingReportColumns(headers, [
    "business-price",
  ]);
  const businessPriceIndex = businessPriceMatches.length === 1
    ? businessPriceMatches[0]!
    : -1;
  const quantityDiscountColumns = listingReportQuantityDiscountColumns(headers);

  if (
    [skuMatches, asinMatches, fulfillmentMatches].some(
      (matches) => matches.length > 1,
    )
  ) {
    for (const seed of seeds) {
      businessPriceEvidenceBySku.set(
        seed.sellerSku,
        { presence: "ambiguous", amount: null },
      );
      quantityDiscountEvidenceBySku.set(
        seed.sellerSku,
        { presence: "ambiguous", plan: null },
      );
    }
    return { businessPriceEvidenceBySku, quantityDiscountEvidenceBySku };
  }
  if (businessPriceMatches.length > 1) {
    for (const seed of seeds) {
      businessPriceEvidenceBySku.set(
        seed.sellerSku,
        { presence: "ambiguous", amount: null },
      );
    }
  }
  if (
    skuMatches.length === 0 ||
    asinMatches.length === 0 ||
    fulfillmentMatches.length === 0
  ) {
    return { businessPriceEvidenceBySku, quantityDiscountEvidenceBySku };
  }

  const skuIndex = skuMatches[0]!;
  const asinIndex = asinMatches[0]!;
  const fulfillmentIndex = fulfillmentMatches[0]!;
  const seenTargetSkus = new Set<string>();
  for (const row of rows.slice(1)) {
    const sellerSku = row[skuIndex] ?? "";
    const seed = seedBySku.get(sellerSku);
    if (!seed) continue;
    if (seenTargetSkus.has(sellerSku)) {
      businessPriceEvidenceBySku.set(
        sellerSku,
        { presence: "ambiguous", amount: null },
      );
      quantityDiscountEvidenceBySku.set(
        sellerSku,
        { presence: "ambiguous", plan: null },
      );
      continue;
    }
    seenTargetSkus.add(sellerSku);
    const asin = row[asinIndex] ?? "";
    const fulfillment = row[fulfillmentIndex] ?? "";
    if (
      sellerSku.length > 40 ||
      sellerSku !== sellerSku.trim() ||
      !/^[A-Z0-9]{10}$/u.test(asin) ||
      asin !== seed.asin ||
      !FBA_FULFILLMENT_CHANNEL.test(fulfillment)
    ) {
      businessPriceEvidenceBySku.set(
        sellerSku,
        { presence: "ambiguous", amount: null },
      );
      quantityDiscountEvidenceBySku.set(
        sellerSku,
        { presence: "ambiguous", plan: null },
      );
      continue;
    }
    if (businessPriceMatches.length <= 1) {
      businessPriceEvidenceBySku.set(
        sellerSku,
        listingReportBusinessPriceEvidence(row, businessPriceIndex),
      );
    }
    quantityDiscountEvidenceBySku.set(
      sellerSku,
      listingReportQuantityDiscountEvidence(row, quantityDiscountColumns),
    );
  }
  return { businessPriceEvidenceBySku, quantityDiscountEvidenceBySku };
}

function reconcileBusinessPriceReportEvidence(
  primary: ListingReportBusinessPriceEvidence,
  fallback: ListingReportBusinessPriceEvidence,
  currencyCode: string,
): ListingReportBusinessPriceEvidence {
  if (primary.presence === "unavailable") {
    return fallback.presence === "present"
      ? fallback
      : { presence: "unavailable", amount: null };
  }
  if (primary.presence === "ambiguous") {
    return { presence: "ambiguous", amount: null };
  }
  if (primary.presence === "present") {
    if (fallback.presence !== "present") return primary;
    return sameMarketplacePrice(primary.amount, fallback.amount, currencyCode)
      ? primary
      : { presence: "ambiguous", amount: null };
  }
  return fallback.presence === "present"
    ? { presence: "ambiguous", amount: null }
    : primary;
}

function reconcileBusinessQuantityDiscountReportEvidence(
  primary: ListingReportQuantityDiscountEvidence,
  fallback: ListingReportQuantityDiscountEvidence,
): ListingReportQuantityDiscountEvidence {
  if (primary.presence === "unavailable") return fallback;
  if (primary.presence === "ambiguous") {
    return { presence: "ambiguous", plan: null };
  }
  if (primary.presence === "canonical") {
    if (fallback.presence === "ambiguous") {
      return { presence: "ambiguous", plan: null };
    }
    if (fallback.presence !== "canonical") return primary;
    return sameBusinessQuantityDiscountPlan(primary.plan, fallback.plan)
      ? primary
      : { presence: "ambiguous", plan: null };
  }
  if (fallback.presence === "canonical" || fallback.presence === "ambiguous") {
    return { presence: "ambiguous", plan: null };
  }
  return primary;
}

function reconcileListingsAndReportQuantityDiscountEvidence(
  listings: Pick<
    BusinessOfferReadEvidence,
    "quantityDiscountPlan" | "quantityDiscountPlanPresence"
  >,
  report: ListingReportQuantityDiscountEvidence,
): Pick<
  BusinessPricingAuditRow,
  "quantityDiscountPlan" | "quantityDiscountPlanPresence"
> {
  if (report.presence === "unavailable") {
    return {
      quantityDiscountPlan: listings.quantityDiscountPlan,
      quantityDiscountPlanPresence: listings.quantityDiscountPlanPresence,
    };
  }
  if (report.presence === "ambiguous") {
    return {
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
    };
  }
  if (report.presence === "canonical") {
    if (listings.quantityDiscountPlanPresence === "absent") {
      return {
        quantityDiscountPlan: report.plan,
        quantityDiscountPlanPresence: "canonical",
      };
    }
    if (
      listings.quantityDiscountPlanPresence === "canonical" &&
      listings.quantityDiscountPlan &&
      sameBusinessQuantityDiscountPlan(
        report.plan,
        listings.quantityDiscountPlan,
      )
    ) {
      return {
        quantityDiscountPlan: report.plan,
        quantityDiscountPlanPresence: "canonical",
      };
    }
    return {
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
    };
  }
  return listings.quantityDiscountPlanPresence === "absent"
    ? { quantityDiscountPlan: null, quantityDiscountPlanPresence: "absent" }
    : { quantityDiscountPlan: null, quantityDiscountPlanPresence: "ambiguous" };
}

export function summarizeBusinessPricingAuditRows(
  rows: readonly BusinessPricingAuditRow[],
): BusinessPricingAuditSnapshot["summary"] {
  return {
    totalFbaSkuCount: rows.length,
    configured: rows.filter((row) => row.status === "configured").length,
    aboveStandard: rows.filter((row) => row.status === "above_standard").length,
    missing: rows.filter((row) => row.status === "missing").length,
    unsupported: rows.filter((row) => row.status === "unsupported").length,
    incomplete: rows.filter((row) => row.status === "incomplete").length,
    recommendedPriceMismatch: rows.filter(
      (row) => row.recommendedPriceMismatch,
    ).length,
    recommendedQuantityDiscountMismatch: rows.filter(
      (row) => row.recommendedQuantityDiscountMismatch,
    ).length,
  };
}

type BusinessPricingAuditRowWithoutRecommendations = Omit<
  BusinessPricingAuditRow,
  "recommendedPriceMismatch" | "recommendedQuantityDiscountMismatch"
>;

function withBusinessPricingRecommendations(
  row: BusinessPricingAuditRowWithoutRecommendations,
): BusinessPricingAuditRow {
  return {
    ...row,
    ...businessPricingRecommendationFlags({
      standardPrice: row.standardPrice,
      businessPrice: row.businessPrice,
      quantityDiscountPlan: row.quantityDiscountPlan,
      quantityDiscountPlanPresence: row.quantityDiscountPlanPresence,
    }),
  };
}

function incompleteBusinessPricingAuditRow(
  seed: FbaCatalogSeed,
  reason: string,
  listing?: ListingEnvelope,
  marketplaceId?: MarketplaceId,
): BusinessPricingAuditRow {
  const summary = marketplaceId && listing
    ? listingSummary(listing, marketplaceId)
    : undefined;
  const productType = marketplaceId && listing
    ? listingProductType(listing, marketplaceId)
    : "";
  return withBusinessPricingRecommendations({
    sellerSku: seed.sellerSku,
    asin: seed.asin,
    title: safeText(summary?.itemName, seed.title),
    productType: productType === "PRODUCT" && !summary?.productType
      ? ""
      : productType,
    standardPrice: null,
    businessPrice: null,
    businessOfferPresence: "ambiguous",
    quantityDiscountPlan: null,
    quantityDiscountPlanPresence: "ambiguous",
    status: "incomplete",
    editable: false,
    reason,
  });
}

function unavailableListingsBusinessPricingAuditRow(input: Readonly<{
  seed: FbaCatalogSeed;
  marketplaceId: MarketplaceId;
  reason: string;
  reportBusinessPrice: ListingReportBusinessPriceEvidence;
  activeListingsBusinessPrice: ListingReportBusinessPriceEvidence;
  reportQuantityDiscount: ListingReportQuantityDiscountEvidence;
}>): BusinessPricingAuditRow {
  if (
    input.reportBusinessPrice.presence === "present" &&
    /^[A-Z0-9]{10}$/u.test(input.seed.asin)
  ) {
    const reportSource = input.activeListingsBusinessPrice.presence === "present"
      ? "Amazon Active Listings 報表"
      : "Amazon 全商品報表";
    const reportQuantityDiscount = input.reportQuantityDiscount.presence ===
        "canonical"
      ? {
          quantityDiscountPlan: input.reportQuantityDiscount.plan,
          quantityDiscountPlanPresence: "canonical" as const,
        }
      : {
          quantityDiscountPlan: null,
          quantityDiscountPlanPresence: "ambiguous" as const,
        };
    return withBusinessPricingRecommendations({
      sellerSku: input.seed.sellerSku,
      asin: input.seed.asin,
      title: "",
      productType: "",
      standardPrice: null,
      businessPrice: {
        amount: input.reportBusinessPrice.amount,
        currencyCode: marketplaceById(input.marketplaceId)!.currency,
      },
      businessOfferPresence: "present",
      ...reportQuantityDiscount,
      status: "configured",
      editable: false,
      reason:
        `${reportSource}已以 exact SKU／ASIN／FBA 證據確認 Business Price；${input.reason}商品名稱、商品類型與一般售價保持未知${input.reportQuantityDiscount.presence === "canonical" ? "，數量折扣已由同一報表確認" : "，數量折扣保持未知"}。`,
    });
  }
  return incompleteBusinessPricingAuditRow(input.seed, input.reason);
}

type ExactBusinessPricingAuditPayload = Readonly<{
  title: string;
  productType: string;
  standardPrice: Money | null;
  standardPriceComplete: boolean;
  business: BusinessOfferReadEvidence;
}>;

function exactBusinessPricingAuditPayload(input: Readonly<{
  seed: FbaCatalogSeed;
  listing: ListingEnvelope;
  marketplaceId: MarketplaceId;
}>): ExactBusinessPricingAuditPayload | string {
  const { seed, listing, marketplaceId } = input;
  if (
    !exactListingEnvelopeIdentity(
      listing,
      marketplaceId,
      seed.sellerSku,
      seed.asin,
    )
  ) {
    return "Amazon Listings 的 SKU／ASIN／商品類型／站點身分與同次 FBA 報表不一致。";
  }
  if (
    !Array.isArray(listing.fulfillmentAvailability) ||
    !listing.fulfillmentAvailability.every(isRecord)
  ) {
    return "Amazon Listings 沒有回傳可辨識的 fulfillmentAvailability，無法再次確認 FBA。";
  }
  if (fulfillmentEvidence(listing) !== "FBA") {
    return "Amazon Listings 與 FBA 報表的履約證據不一致。";
  }
  const attributes = listing.attributes;
  const purchasableOffers = isRecord(attributes)
    ? attributes.purchasable_offer
    : undefined;
  if (
    (attributes !== undefined && !isRecord(attributes)) ||
    (purchasableOffers !== undefined &&
      (!Array.isArray(purchasableOffers) ||
        !purchasableOffers.every(isRecord))) ||
    (listing.offers !== undefined &&
      (!Array.isArray(listing.offers) || !listing.offers.every(isRecord))) ||
    !listingSubmissionIssuesAreWellFormed(listing.issues)
  ) {
    return "Amazon Listings 已回傳但 attributes、optional offers 或 issues 格式無法辨識。";
  }
  const productType = listingProductType(listing, marketplaceId);
  if (!productType || productType === "PRODUCT") {
    return "Amazon Listings 沒有唯一、可核對的商品類型。";
  }
  const standardPrice = canonicalBusinessStandardPrice(
    purchasableOffers,
    marketplaceId,
  );
  const issues = Array.isArray(listing.issues) ? listing.issues : [];
  const hasPricingError = issues.some((issue) =>
    isPricingListingError(issue, marketplaceId)
  );
  return {
    title: safeText(listingSummary(listing, marketplaceId)?.itemName, ""),
    productType,
    standardPrice: standardPrice && !hasPricingError ? standardPrice : null,
    standardPriceComplete: Boolean(standardPrice && !hasPricingError),
    business: normalizeBusinessOfferReadEvidence(
      purchasableOffers,
      marketplaceId,
    ),
  };
}

function completeBusinessPricingAuditRow(input: Readonly<{
  seed: FbaCatalogSeed;
  listing: ExactBusinessPricingAuditPayload;
  marketplaceId: MarketplaceId;
  reportBusinessPrice: ListingReportBusinessPriceEvidence;
  activeListingsBusinessPrice: ListingReportBusinessPriceEvidence;
  reportQuantityDiscount: ListingReportQuantityDiscountEvidence;
}>): BusinessPricingAuditRow {
  const {
    seed,
    listing,
    marketplaceId,
    reportBusinessPrice,
    activeListingsBusinessPrice,
    reportQuantityDiscount,
  } = input;
  const business = listing.business;
  if (activeListingsBusinessPrice.presence === "ambiguous") {
    return withBusinessPricingRecommendations({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      status: "incomplete",
      editable: false,
      reason:
        "Amazon Active Listings 報表的 exact SKU／ASIN／FBA／Business Price 證據重複、衝突或無法辨識；即使 Listings attributes 有正向 B2B 證據也不會忽略此衝突。",
    });
  }
  if (business.businessOfferPresence === "ambiguous") {
    return withBusinessPricingRecommendations({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      status: "incomplete",
      editable: false,
      reason:
        "Amazon 回傳多個、幣別不符或價格無法解析的 B2B offer，已停止編輯。",
    });
  }
  if (reportBusinessPrice.presence === "ambiguous") {
    return withBusinessPricingRecommendations({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      status: "incomplete",
      editable: false,
      reason:
        "Amazon Active Listings／全商品報表的 Business Price 證據不一致或無法精確辨識，已停止分類。",
    });
  }

  const currencyCode = marketplaceById(marketplaceId)!.currency;
  const reportMoney = reportBusinessPrice.presence === "present"
    ? { amount: reportBusinessPrice.amount, currencyCode }
    : null;
  const reportSource = activeListingsBusinessPrice.presence === "present"
    ? "Amazon Active Listings 報表"
    : "Amazon 全商品報表";
  const quantityDiscount = reconcileListingsAndReportQuantityDiscountEvidence(
    business,
    reportQuantityDiscount,
  );
  if (
    reportMoney &&
    business.businessOfferPresence === "present" &&
    (!business.businessPrice ||
      business.businessPrice.currencyCode !== reportMoney.currencyCode ||
      !sameMarketplacePrice(
        business.businessPrice.amount,
        reportMoney.amount,
        reportMoney.currencyCode,
      ))
  ) {
    if (activeListingsBusinessPrice.presence === "present") {
      const aboveStandard = Boolean(
        listing.standardPrice &&
          reportMoney.amount > listing.standardPrice.amount,
      );
      return withBusinessPricingRecommendations({
        sellerSku: seed.sellerSku,
        asin: seed.asin,
        title: listing.title,
        productType: listing.productType,
        standardPrice: listing.standardPrice,
        businessPrice: reportMoney,
        businessOfferPresence: "present",
        ...quantityDiscount,
        status: aboveStandard ? "above_standard" : "configured",
        editable: false,
        reason: aboveStandard
          ? "Amazon Active Listings 報表已確認現行 Business Price，且目前高於一般售價；Listings attributes 的價格 contribution 尚未同步。"
          : "Amazon Active Listings 報表已確認現行 Business Price；Listings attributes 的價格 contribution 尚未同步。",
      });
    }
    return withBusinessPricingRecommendations({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      status: "incomplete",
      editable: false,
      reason:
        `${reportSource}的 Business Price 與 Listings attributes 的 exact B2B contribution 不一致，已停止分類。`,
    });
  }
  if (reportMoney && business.businessOfferPresence === "absent") {
    const aboveStandard = Boolean(
      listing.standardPrice && reportMoney.amount > listing.standardPrice.amount,
    );
    const reportOnlyQuantityDiscount = reportQuantityDiscount.presence ===
        "canonical"
      ? {
          quantityDiscountPlan: reportQuantityDiscount.plan,
          quantityDiscountPlanPresence: "canonical" as const,
        }
      : reportQuantityDiscount.presence === "absent"
        ? {
            quantityDiscountPlan: null,
            quantityDiscountPlanPresence: "absent" as const,
          }
        : {
            quantityDiscountPlan: null,
            quantityDiscountPlanPresence: "ambiguous" as const,
          };
    return withBusinessPricingRecommendations({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: reportMoney,
      businessOfferPresence: "present",
      ...reportOnlyQuantityDiscount,
      status: aboveStandard ? "above_standard" : "configured",
      editable: false,
      reason: aboveStandard
        ? `${reportSource}已確認此 SKU 設有 Business Price，且目前高於一般售價；數量折扣請至 Amazon 後台核對。`
        : `${reportSource}已確認此 SKU 設有 Business Price；一般售價或數量折扣未完整回傳時，請至 Amazon 後台核對。`,
    });
  }

  const configured = business.businessOfferPresence === "present";
  if (!configured && activeListingsBusinessPrice.presence === "unavailable") {
    return withBusinessPricingRecommendations({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      status: "incomplete",
      editable: false,
      reason:
        "Amazon Active Listings 的 exact Business Price 證據目前無法取得，且 Listings／全商品報表沒有其他正向 Business Price 證據；不能判定為未設定。",
    });
  }
  if (!configured && !listing.standardPriceComplete) {
    return withBusinessPricingRecommendations({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      status: "incomplete",
      editable: false,
      reason:
        "Amazon Listings 未完整回傳一般售價，且沒有其他正向 Business Price 證據；請至 Amazon 後台核對。",
    });
  }
  const aboveStandard = configured && Boolean(
    listing.standardPrice &&
      business.businessPrice &&
      business.businessPrice.amount > listing.standardPrice.amount,
  );
  return withBusinessPricingRecommendations({
    sellerSku: seed.sellerSku,
    asin: seed.asin,
    title: listing.title,
    productType: listing.productType,
    standardPrice: listing.standardPrice,
    businessPrice: business.businessPrice,
    businessOfferPresence: business.businessOfferPresence,
    ...quantityDiscount,
    status: aboveStandard
      ? "above_standard"
      : configured
        ? "configured"
        : "missing",
    editable: false,
    reason: aboveStandard
      ? "Amazon Business 價格高於一般售價。"
      : configured
        ? business.businessPricingManagedByAutomation
          ? "已設定 Amazon Business 價格，並由 Amazon Automate Pricing 管理。"
          : "已設定 Amazon Business 價格。"
        : "尚未設定 Amazon Business 價格。",
  });
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function listingSummary(
  listing: ListingEnvelope,
  marketplaceId: MarketplaceId,
) {
  return listing.summaries?.find(
    (summary) => summary.marketplaceId === marketplaceId,
  );
}

function listingProductType(
  listing: ListingEnvelope,
  marketplaceId: MarketplaceId,
): string {
  const productType = listing.productTypes?.find(
    (item) => item.marketplaceId === marketplaceId,
  )?.productType ?? listingSummary(listing, marketplaceId)?.productType;
  return safeText(productType, "PRODUCT");
}

function attributeObjects(
  listing: ListingEnvelope,
  name: string,
  marketplaceId: MarketplaceId,
): Record<string, unknown>[] {
  const raw = listing.attributes?.[name];
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is Record<string, unknown> => {
    if (!isRecord(value)) return false;
    return typeof value.marketplace_id !== "string" ||
      !value.marketplace_id ||
      value.marketplace_id === marketplaceId;
  });
}

function preferredLanguageTag(
  listing: ListingEnvelope,
  marketplaceId: MarketplaceId,
): string {
  const marketplace = marketplaceById(marketplaceId);
  const marketplaceLanguage = marketplace?.locale.replace("-", "_") ?? "";
  const availableLanguages = CONTENT_TEXT_ATTRIBUTE_NAMES
    .flatMap((name) => attributeObjects(listing, name, marketplaceId))
    .map((item) => item.language_tag)
    .filter(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    );
  if (availableLanguages.includes(marketplaceLanguage)) {
    return marketplaceLanguage;
  }
  return availableLanguages[0] ?? marketplaceLanguage;
}

function attributeTextValues(
  listing: ListingEnvelope,
  name: string,
  marketplaceId: MarketplaceId,
  languageTag: string,
): string[] {
  const items = attributeObjects(listing, name, marketplaceId);
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

function listingImageUrl(
  listing: ListingEnvelope,
  name: string,
  marketplaceId: MarketplaceId,
): string | null {
  const value = attributeObjects(listing, name, marketplaceId)
    .map((item) => item.media_location)
    .find(
      (item): item is string =>
        typeof item === "string" && Boolean(item.trim()),
    );
  return value?.trim() || null;
}

function fulfillmentEvidence(
  listing: ListingEnvelope,
): "FBA" | "OTHER" | "MISSING" {
  const channelCodes = Array.isArray(listing.fulfillmentAvailability)
    ? listing.fulfillmentAvailability
      .map((availability) =>
        typeof availability?.fulfillmentChannelCode === "string"
          ? availability.fulfillmentChannelCode.trim()
          : ""
      )
      .filter(Boolean)
    : [];
  if (channelCodes.some((value) => FBA_FULFILLMENT_CHANNEL.test(value))) {
    return "FBA";
  }
  return channelCodes.length ? "OTHER" : "MISSING";
}

function exportRowFromListing(
  listing: ListingEnvelope,
  marketplaceId: MarketplaceId,
): CatalogExportRow {
  const marketplace = marketplaceById(marketplaceId)!;
  const summary = listingSummary(listing, marketplaceId);
  const languageTag = preferredLanguageTag(listing, marketplaceId);
  return {
    marketplace: marketplace.name,
    sellerSku: safeText(listing.sku, "—"),
    asin: summary?.asin?.trim() || "",
    productType: listingProductType(listing, marketplaceId),
    title: attributeTextValues(
      listing,
      "item_name",
      marketplaceId,
      languageTag,
    )[0] ?? safeText(summary?.itemName, ""),
    itemHighlight: attributeTextValues(
      listing,
      "title_differentiation",
      marketplaceId,
      languageTag,
    )[0] ?? "",
    bulletPoints: attributeTextValues(
      listing,
      "bullet_point",
      marketplaceId,
      languageTag,
    ).slice(0, 5),
    productDescription: attributeTextValues(
      listing,
      "product_description",
      marketplaceId,
      languageTag,
    )[0] ?? "",
    ingredients: attributeTextValues(
      listing,
      "ingredients",
      marketplaceId,
      languageTag,
    )[0] ?? "",
    imageUrls: IMAGE_ATTRIBUTE_NAMES
      .map((name) => listingImageUrl(listing, name, marketplaceId))
      .filter((value): value is string => Boolean(value)),
    status: Array.isArray(summary?.status) ? summary.status.join(", ") : "",
    updatedAt: summary?.lastUpdatedDate ?? "",
    readStatus: "complete",
    readErrors: [],
  };
}

function planBatches(seeds: readonly FbaCatalogSeed[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  for (const seed of seeds) {
    if (seed.sellerSku.includes(",")) {
      if (batch.length) batches.push(batch);
      batch = [];
      batches.push([seed.sellerSku]);
      continue;
    }
    batch.push(seed.sellerSku);
    if (batch.length === LISTINGS_BATCH_SIZE) {
      batches.push(batch);
      batch = [];
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function readFailureMessage(error: unknown): string {
  const requestId = error instanceof SpApiError
    ? publicSpApiRequestId(error.requestId)
    : null;
  return `Amazon Listings 商品內容查詢失敗${
    requestId ? `（Request ID: ${requestId}）` : ""
  }。`;
}

function canRecoverCatalogBatchWithExactReads(error: unknown): boolean {
  if (!(error instanceof SpApiError)) return false;
  if (error.code === "LISTING_IDENTITY_MISMATCH") return true;
  return [400, 404, 413, 415, 422].includes(error.status) &&
    ["INVALID_LISTING_REQUEST", "SKU_NOT_FOUND"].includes(error.code);
}

function canContinueCatalogExactRecovery(error: unknown): boolean {
  if (!(error instanceof SpApiError)) return false;
  if (error.code === "LISTING_IDENTITY_MISMATCH") return true;
  return [400, 404, 422].includes(error.status) &&
    ["INVALID_LISTING_REQUEST", "SKU_NOT_FOUND"].includes(error.code);
}

function listingEnvelope(value: unknown): ListingEnvelope {
  if (!isRecord(value)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 Listing 商品資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  return value as ListingEnvelope;
}

function searchItems(result: ListingsSearchReadResult): ListingEnvelope[] {
  if (!isRecord(result.envelope) || !Array.isArray(result.envelope.items)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 Listing 批次資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  return result.envelope.items.map(listingEnvelope);
}

async function fetchCatalogRows(
  adapter: CatalogListingsReadAdapter,
  input: ReadFbaCatalogExportInput,
  seeds: readonly FbaCatalogSeed[],
): Promise<Pick<FbaCatalogExport, "rows" | "errors">> {
  const bySku = new Map<string, CatalogExportRow>();
  const seedBySku = new Map(seeds.map((seed) => [seed.sellerSku, seed]));
  const excludedNonFbaSkus = new Set<string>();
  const errors: CatalogExportError[] = [];
  const readErrorsBySku = new Map<string, CatalogExportReadError[]>();
  const batches = planBatches(seeds);
  const pace = input.pace ?? abortableDelay;
  let requestStarted = false;

  const beforeRequest = async (): Promise<void> => {
    throwIfAborted(input.signal);
    if (requestStarted) {
      await pace(LISTINGS_PACE_MILLISECONDS, input.signal);
      throwIfAborted(input.signal);
    }
    requestStarted = true;
  };
  const recordReadError = (
    sellerSku: string,
    message: string,
    code: CatalogExportReadError["code"] = "LISTING_QUERY_FAILED",
  ): void => {
    const current = readErrorsBySku.get(sellerSku) ?? [];
    if (!current.some((error) => error.code === code && error.message === message)) {
      current.push({ code, message });
      readErrorsBySku.set(sellerSku, current);
    }
  };
  const recordListing = (listing: ListingEnvelope): void => {
    const sellerSku = safeText(listing.sku, "—");
    const seed = seedBySku.get(sellerSku);
    if (
      !seed ||
      !exactListingEnvelopeIdentity(
        listing,
        input.marketplaceId,
        sellerSku,
        seed.asin,
      )
    ) {
      const message =
        "Listings Items 回應的 Seller SKU、ASIN、商品類型或站點身分無法與 FBA 報表原樣核對。";
      errors.push({ sellerSku, kind: "身分不一致", message });
      if (seed) recordReadError(sellerSku, message);
      return;
    }

    const evidence = fulfillmentEvidence(listing);
    if (evidence === "OTHER") {
      excludedNonFbaSkus.add(sellerSku);
      errors.push({
        sellerSku,
        kind: "非 FBA，已略過",
        message: "即時 Listing 資料無法確認為 FBA，因此沒有加入匯出。",
      });
      return;
    }

    const row = exportRowFromListing(listing, input.marketplaceId);
    if (evidence === "MISSING") {
      const message =
        "報表已確認此 SKU 為 FBA，但 Listings Items API 未回傳可核對的 fulfillmentAvailability。";
      errors.push({ sellerSku, kind: "履約資料未回傳", message });
      recordReadError(sellerSku, message, "LISTING_CONTENT_NOT_RETURNED");
    }
    if (!isRecord(listing.attributes)) {
      const message =
        "Listings Items API 回應成功，但未回傳 attributes，無法確認商品內容完整性。";
      errors.push({ sellerSku, kind: "內容未回傳", message });
      recordReadError(sellerSku, message, "LISTING_CONTENT_NOT_RETURNED");
    }
    const readErrors = readErrorsBySku.get(sellerSku) ?? [];
    if (readErrors.length) {
      row.readStatus = "incomplete";
      row.readErrors = [...readErrors];
    }
    bySku.set(sellerSku, row);
  };
  const readOne = async (sellerSku: string): Promise<ListingEnvelope> => {
    await beforeRequest();
    const result = await readListingsItem(adapter, {
      intent: "listing",
      marketplaceId: input.marketplaceId,
      sellerSku,
      signal: input.signal,
    });
    throwIfAborted(input.signal);
    if (result.status < 200 || result.status >= 300) {
      return throwListingsReadError(result, "getListingsItem");
    }
    return listingEnvelope(result.envelope);
  };
  const readBatch = async (
    sellerSkus: readonly string[],
  ): Promise<ListingsSearchReadResult> => {
    await beforeRequest();
    const result = await searchListingsItems(adapter, {
      intent: "sku-batch",
      marketplaceId: input.marketplaceId,
      sellerSkus,
      signal: input.signal,
    });
    throwIfAborted(input.signal);
    return result;
  };
  const clearProvisionalListingErrors = (sellerSku: string): void => {
    bySku.delete(sellerSku);
    readErrorsBySku.delete(sellerSku);
    for (let index = errors.length - 1; index >= 0; index -= 1) {
      const error = errors[index]!;
      if (
        error.sellerSku === sellerSku &&
        ["身分不一致", "履約資料未回傳", "內容未回傳", "查詢失敗"].includes(
          error.kind,
        )
      ) {
        errors.splice(index, 1);
      }
    }
  };
  const recoverExactListings = async (
    sellerSkus: readonly string[],
  ): Promise<void> => {
    for (let index = 0; index < sellerSkus.length; index += 1) {
      const sellerSku = sellerSkus[index]!;
      throwIfAborted(input.signal);
      try {
        const listing = await readOne(sellerSku);
        clearProvisionalListingErrors(sellerSku);
        excludedNonFbaSkus.delete(sellerSku);
        recordListing(listing);
      } catch (error) {
        rethrowCatalogReadFence(error, input.signal);
        const message = readFailureMessage(error);
        errors.push({ sellerSku, kind: "查詢失敗", message });
        recordReadError(sellerSku, message);
        if (!canContinueCatalogExactRecovery(error)) {
          const stoppedMessage =
            "前一筆精確補讀遇到系統性錯誤，因此已停止其餘補讀；此 SKU 未送出 Listings Items request。";
          for (const unrecoveredSku of sellerSkus.slice(index + 1)) {
            errors.push({
              sellerSku: unrecoveredSku,
              kind: "補讀已停止",
              message: stoppedMessage,
            });
            recordReadError(unrecoveredSku, stoppedMessage);
          }
          return;
        }
      }
    }
  };

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const sellerSkus = batches[batchIndex]!;
    const usesExactItemRead =
      sellerSkus.length === 1 && sellerSkus[0]!.includes(",");
    throwIfAborted(input.signal);
    try {
      if (usesExactItemRead) {
        recordListing(await readOne(sellerSkus[0]!));
      } else {
        const result = await readBatch(sellerSkus);
        if (result.status === 400) {
          await recoverExactListings(sellerSkus);
        } else {
          if (result.status < 200 || result.status >= 300) {
            throwListingsReadError(result, "searchListingsItems");
          }
          for (const listing of searchItems(result)) recordListing(listing);
          const incompleteSellerSkus = sellerSkus.filter((sellerSku) =>
            !excludedNonFbaSkus.has(sellerSku) &&
            (!bySku.has(sellerSku) || bySku.get(sellerSku)?.readStatus === "incomplete")
          );
          if (incompleteSellerSkus.length) {
            await recoverExactListings(incompleteSellerSkus);
          }
        }
      }
    } catch (error) {
      rethrowCatalogReadFence(error, input.signal);
      if (!usesExactItemRead && canRecoverCatalogBatchWithExactReads(error)) {
        await recoverExactListings(sellerSkus);
        throwIfAborted(input.signal);
        await input.onProgress?.({
          phase: "listings",
          completedUnits: batchIndex + 1,
          totalUnits: batches.length,
        });
        throwIfAborted(input.signal);
        continue;
      }
      const message = readFailureMessage(error);
      for (const sellerSku of sellerSkus) {
        errors.push({ sellerSku, kind: "查詢失敗", message });
        recordReadError(sellerSku, message);
      }
    }

    throwIfAborted(input.signal);
    await input.onProgress?.({
      phase: "listings",
      completedUnits: batchIndex + 1,
      totalUnits: batches.length,
    });
    throwIfAborted(input.signal);
  }

  const rows = seeds.flatMap((seed): CatalogExportRow[] => {
    if (excludedNonFbaSkus.has(seed.sellerSku)) return [];
    const found = bySku.get(seed.sellerSku);
    if (found) {
      const readErrors = readErrorsBySku.get(seed.sellerSku) ?? [];
      if (readErrors.length) {
        found.readStatus = "incomplete";
        found.readErrors = [...readErrors];
      }
      if (found.readStatus === "complete" && !found.ingredients) {
        errors.push({
          sellerSku: seed.sellerSku,
          kind: "缺少成分",
          message: "此商品沒有可匯出的 ingredients 值，或商品類型不適用。",
        });
      }
      return [found];
    }

    const message =
      "報表中有此 FBA SKU，但 Listings Items API 未回傳完整 attributes。";
    errors.push({ sellerSku: seed.sellerSku, kind: "內容未回傳", message });
    recordReadError(
      seed.sellerSku,
      message,
      "LISTING_CONTENT_NOT_RETURNED",
    );
    return [{
      marketplace: marketplaceById(input.marketplaceId)!.name,
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      productType: "",
      title: seed.title,
      itemHighlight: "",
      bulletPoints: [],
      productDescription: "",
      ingredients: "",
      imageUrls: [],
      status: "",
      updatedAt: "",
      readStatus: "incomplete",
      readErrors: [...(readErrorsBySku.get(seed.sellerSku) ?? [])],
    }];
  });
  return { rows, errors };
}

function fetchedAt(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new SpApiError("Catalog read clock 無法辨識。", {
      status: 500,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  return value.toISOString();
}

function assertCatalogReadIdentity(
  marketplaceId: MarketplaceId,
  mode: "live",
): void {
  if (!marketplaceById(marketplaceId)) {
    throw new SpApiError("Amazon 站點無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  if (mode !== "live" && mode !== "demo") {
    throw new SpApiError("Catalog read mode 無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
}

/**
 * Returns the exact current-FBA seed set for downstream read-only domains that
 * apply their own ASIN completeness rules. Seller SKU validation and FBA
 * membership remain owned by this parser.
 */
export function readFbaCatalogSeeds(
  document: string,
  signal?: AbortSignal,
): FbaCatalogSeed[] {
  throwIfAborted(signal);
  const seeds = parseFbaCatalogReport(document).seeds;
  throwIfAborted(signal);
  return seeds;
}

/**
 * Projects only the report-owned current-FBA identities. It deliberately has
 * no Listings adapter because Seller SKU, ASIN and title already belong to the
 * same All Listings document and need no per-item network fan-out.
 */
export function readFbaCatalogIdentity(input: Readonly<{
  marketplaceId: MarketplaceId;
  mode: "live";
  document: string;
  signal?: AbortSignal;
  now?: () => Date;
}>): FbaCatalogIdentitySnapshot {
  throwIfAborted(input.signal);
  assertCatalogReadIdentity(input.marketplaceId, input.mode);
  const rows = parseFbaCatalogReport(input.document).seeds;
  if (rows.some((row) => !/^[A-Z0-9]{10}$/u.test(row.asin))) {
    throw new SpApiError(
      "Amazon FBA 全商品報表含缺失或無效 ASIN，已停止產生廣告策略。",
      { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
    );
  }
  throwIfAborted(input.signal);
  return {
    mode: input.mode,
    marketplaceId: input.marketplaceId,
    fetchedAt: fetchedAt(input.now ?? (() => new Date())),
    rows,
    notice:
      "Seller SKU、ASIN 與商品名稱來自同次 Amazon FBA 全商品報表；沒有呼叫逐品項寫入 API。",
  };
}

function isCatalogReadFenceError(error: unknown): boolean {
  return error instanceof SpApiError && [
    "ACCOUNT_SCOPE_CHANGED",
    "REPORT_MODE_CHANGED",
    "SP_CONTEXT_INVALIDATED",
  ].includes(error.code);
}

function rethrowCatalogReadFence(error: unknown, signal?: AbortSignal): void {
  if (
    isCatalogReadFenceError(error) ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    throw error;
  }
  throwIfAborted(signal);
}

function stableAuditReadFailure(error: unknown, prefix: string): string {
  const requestId = error instanceof SpApiError
    ? publicSpApiRequestId(error.requestId)
    : null;
  return `${prefix}${requestId ? `（Request ID: ${requestId}）` : ""}。`;
}

/**
 * Builds a live, read-only B2B audit from one All Listings document, optional
 * Active Listings evidence and the fixed Listings read adapter. Report
 * lifecycle, document handles and demo state remain outside this seam.
 */
export async function readFbaBusinessPricingAudit(
  adapter: CatalogListingsReadAdapter,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    mode: "live";
    allListingsDocument: string;
    activeListingsDocument?: string | null;
    signal?: AbortSignal;
    pace?: (
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void>;
    now?: () => Date;
  }>,
): Promise<BusinessPricingAuditSnapshot> {
  throwIfAborted(input.signal);
  assertCatalogReadIdentity(input.marketplaceId, input.mode);
  const marketplace = marketplaceById(input.marketplaceId)!;
  const parsed = parseFbaCatalogReport(input.allListingsDocument);
  const seeds = parsed.seeds;
  const activeEvidence = input.activeListingsDocument == null
    ? {
        businessPriceEvidenceBySku:
          new Map<string, ListingReportBusinessPriceEvidence>(),
        quantityDiscountEvidenceBySku:
          new Map<string, ListingReportQuantityDiscountEvidence>(),
      }
    : parseBusinessPricingActiveListingsReport(
        input.activeListingsDocument,
        seeds,
      );
  throwIfAborted(input.signal);

  const unavailableBusinessPriceEvidence: ListingReportBusinessPriceEvidence = {
    presence: "unavailable",
    amount: null,
  };
  const unavailableQuantityDiscountEvidence:
    ListingReportQuantityDiscountEvidence = {
      presence: "unavailable",
      plan: null,
    };
  const businessPriceEvidenceBySku = new Map(
    seeds.map((seed) => [
      seed.sellerSku,
      reconcileBusinessPriceReportEvidence(
        activeEvidence.businessPriceEvidenceBySku.get(seed.sellerSku) ??
          unavailableBusinessPriceEvidence,
        parsed.businessPriceEvidenceBySku.get(seed.sellerSku) ??
          unavailableBusinessPriceEvidence,
        marketplace.currency,
      ),
    ] as const),
  );
  const quantityDiscountEvidenceBySku = new Map(
    seeds.map((seed) => [
      seed.sellerSku,
      reconcileBusinessQuantityDiscountReportEvidence(
        activeEvidence.quantityDiscountEvidenceBySku.get(seed.sellerSku) ??
          unavailableQuantityDiscountEvidence,
        parsed.quantityDiscountEvidenceBySku.get(seed.sellerSku) ??
          unavailableQuantityDiscountEvidence,
      ),
    ] as const),
  );

  const seedBySku = new Map(seeds.map((seed) => [seed.sellerSku, seed]));
  const listingBySku = new Map<string, ListingEnvelope>();
  const unavailableReasonBySku = new Map<string, string>();
  const { batches, unqueryableSellerSkus } = planExactSellerSkuBatches(
    seeds.map((seed) => seed.sellerSku),
  );
  for (const sellerSku of unqueryableSellerSkus) {
    unavailableReasonBySku.set(
      sellerSku,
      "Seller SKU 無法不失真地放入官方 Listings 批次參數。",
    );
  }

  const pace = input.pace ?? abortableDelay;
  let requestStarted = false;
  const beforeRequest = async (): Promise<void> => {
    throwIfAborted(input.signal);
    if (requestStarted) {
      await pace(LISTINGS_PACE_MILLISECONDS, input.signal);
      throwIfAborted(input.signal);
    }
    requestStarted = true;
  };
  const readExact = async (sellerSku: string): Promise<ListingEnvelope> => {
    await beforeRequest();
    const result = await readListingsItem(adapter, {
      intent: "listing",
      marketplaceId: input.marketplaceId,
      sellerSku,
      signal: input.signal,
    });
    throwIfAborted(input.signal);
    if (result.status < 200 || result.status >= 300) {
      return throwListingsReadError(result, "getListingsItem");
    }
    return listingEnvelope(result.envelope);
  };

  for (const sellerSkus of batches) {
    throwIfAborted(input.signal);
    const batchSeeds = sellerSkus.map((sellerSku) => seedBySku.get(sellerSku)!);
    try {
      await beforeRequest();
      const result = await searchListingsItems(adapter, {
        intent: "sku-batch",
        marketplaceId: input.marketplaceId,
        sellerSkus,
        signal: input.signal,
      });
      throwIfAborted(input.signal);
      if (result.status === 400) {
        for (const seed of batchSeeds) {
          try {
            listingBySku.set(seed.sellerSku, await readExact(seed.sellerSku));
          } catch (error) {
            rethrowCatalogReadFence(error, input.signal);
            unavailableReasonBySku.set(
              seed.sellerSku,
              stableAuditReadFailure(error, "Amazon exact Listings 查詢失敗"),
            );
          }
        }
        continue;
      }
      if (result.status < 200 || result.status >= 300) {
        const requestId = publicSpApiRequestId(result.requestId);
        for (const seed of batchSeeds) {
          unavailableReasonBySku.set(
            seed.sellerSku,
            `Amazon Listings 批次查詢未完成${requestId ? `（Request ID: ${requestId}）` : ""}。`,
          );
        }
        continue;
      }
      const payload = isRecord(result.envelope) ? result.envelope : null;
      const rawItems = payload?.items;
      const items = Array.isArray(rawItems)
        ? rawItems.map(listingEnvelope)
        : null;
      const pagination = isRecord(payload?.pagination)
        ? payload.pagination
        : null;
      const numberOfResults = payload?.numberOfResults;
      const malformedBatch =
        !payload ||
        !items ||
        Boolean(pagination?.nextToken) ||
        (typeof numberOfResults === "number" &&
          numberOfResults !== items.length) ||
        items.some((item) =>
          typeof item.sku !== "string" || !sellerSkus.includes(item.sku)) ||
        new Set(items.map((item) => item.sku)).size !== items.length;
      if (malformedBatch || !items) {
        for (const seed of batchSeeds) {
          unavailableReasonBySku.set(
            seed.sellerSku,
            "Amazon Listings 批次回應含缺頁、額外列、重複列或無法辨識的列數。",
          );
        }
        continue;
      }
      for (const item of items) listingBySku.set(item.sku!, item);
      for (const seed of batchSeeds) {
        if (!listingBySku.has(seed.sellerSku)) {
          unavailableReasonBySku.set(
            seed.sellerSku,
            "Amazon Listings 批次沒有回傳此 FBA Seller SKU。",
          );
        }
      }
    } catch (error) {
      rethrowCatalogReadFence(error, input.signal);
      for (const seed of batchSeeds) {
        unavailableReasonBySku.set(
          seed.sellerSku,
          stableAuditReadFailure(error, "Amazon Listings 批次查詢失敗"),
        );
      }
    }
  }

  const rowsBySku = new Map<string, BusinessPricingAuditRow>();
  const exactBySku = new Map<string, ExactBusinessPricingAuditPayload>();
  for (const seed of seeds) {
    const listing = listingBySku.get(seed.sellerSku);
    if (!listing) continue;
    const exact = exactBusinessPricingAuditPayload({
      seed,
      listing,
      marketplaceId: input.marketplaceId,
    });
    if (typeof exact === "string") {
      rowsBySku.set(
        seed.sellerSku,
        incompleteBusinessPricingAuditRow(
          seed,
          exact,
          listing,
          input.marketplaceId,
        ),
      );
    } else {
      exactBySku.set(seed.sellerSku, exact);
    }
  }

  for (const seed of seeds) {
    if (rowsBySku.has(seed.sellerSku)) continue;
    const unavailableReason = unavailableReasonBySku.get(seed.sellerSku);
    if (unavailableReason) {
      rowsBySku.set(
        seed.sellerSku,
        unavailableListingsBusinessPricingAuditRow({
          seed,
          marketplaceId: input.marketplaceId,
          reason: unavailableReason,
          reportBusinessPrice:
            businessPriceEvidenceBySku.get(seed.sellerSku) ??
              unavailableBusinessPriceEvidence,
          activeListingsBusinessPrice:
            activeEvidence.businessPriceEvidenceBySku.get(seed.sellerSku) ??
              unavailableBusinessPriceEvidence,
          reportQuantityDiscount:
            quantityDiscountEvidenceBySku.get(seed.sellerSku) ??
              unavailableQuantityDiscountEvidence,
        }),
      );
      continue;
    }
    const listing = exactBySku.get(seed.sellerSku);
    if (!listing) {
      rowsBySku.set(
        seed.sellerSku,
        incompleteBusinessPricingAuditRow(
          seed,
          "Amazon B2B 價格資料沒有產生終局分類。",
        ),
      );
      continue;
    }
    rowsBySku.set(
      seed.sellerSku,
      completeBusinessPricingAuditRow({
        seed,
        listing,
        marketplaceId: input.marketplaceId,
        reportBusinessPrice:
          businessPriceEvidenceBySku.get(seed.sellerSku) ??
            unavailableBusinessPriceEvidence,
        activeListingsBusinessPrice:
          activeEvidence.businessPriceEvidenceBySku.get(seed.sellerSku) ??
            unavailableBusinessPriceEvidence,
        reportQuantityDiscount:
          quantityDiscountEvidenceBySku.get(seed.sellerSku) ??
            unavailableQuantityDiscountEvidence,
      }),
    );
  }

  const rows = seeds
    .map((seed) => rowsBySku.get(seed.sellerSku)!)
    .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku));
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    fetchedAt: fetchedAt(input.now ?? (() => new Date())),
    rows,
    summary: summarizeBusinessPricingAuditRows(rows),
    notice:
      "FBA 範圍取自 Amazon 全商品報表；Business Price 以 Listings Items 的 exact B2B contribution 與 Active Listings 報表交叉核對。一般售價／Buy Box 錯誤不會抹除另一來源已確認的 Business Price；來源衝突或身分不完整仍標示資料未完成。本報表不會修改 Amazon。",
  };
}

/**
 * Builds the read-only FBA catalog export from one already-owned All Listings
 * document. Report lifecycle and document download stay outside this domain
 * seam; this function can only parse text and call fixed Listings read plans.
 */
export async function readFbaCatalogExport(
  adapter: CatalogListingsReadAdapter,
  input: ReadFbaCatalogExportInput,
): Promise<FbaCatalogExport> {
  throwIfAborted(input.signal);
  assertCatalogReadIdentity(input.marketplaceId, input.mode);

  const seeds = parseFbaCatalogReport(input.document).seeds;
  await input.onProgress?.({
    phase: "report-downloaded",
    completedUnits: 1,
    totalUnits: 1,
  });
  throwIfAborted(input.signal);

  const now = input.now ?? (() => new Date());
  if (!seeds.length) {
    return {
      rows: [],
      errors: [{
        sellerSku: "",
        kind: "沒有 FBA 商品",
        message: "Amazon 報表中沒有找到此站點的 FBA SKU。",
      }],
      fetchedAt: fetchedAt(now),
    };
  }

  const result = await fetchCatalogRows(adapter, input, seeds);
  throwIfAborted(input.signal);
  return { ...result, fetchedAt: fetchedAt(now) };
}
