import { createHash } from "node:crypto";
import {
  type VariationFamilyMember,
  type VariationFamilySnapshot,
} from "./variation-family";
import {
  assertReplenishmentRequestBody,
  fetchFbaSubscriptionAuditHistory,
  officialCompleteMonthlyIntervals,
  type FbaSubscriptionAuditHistorySnapshot,
} from "./replenishment-audit";
import {
  abortableDelay as wait,
  throwIfAborted as assertNotAborted,
} from "../abort-utils";
import {
  MARKETPLACES as MARKETPLACE_METADATA,
  marketplaceByCode,
  marketplaceById,
  type MarketplaceId,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  businessPricingRecommendationFlags,
} from "../../shared/business-pricing-recommendations";
import { spApiUserAgent } from "./sp-api-runtime";
import {
  isDateOnly,
} from "./marketplace-calendar";
import {
  FbaSalesPlanningError,
  planFbaSalesTrend,
  type SalesTrendComparisonMode,
  type SalesTrendPresetDays,
  type SalesTrendRange,
  type SalesTrendWindow,
} from "./fba-sales-calendar";
import {
  FbaSalesMetricsError,
  readFbaSalesVelocity,
  readFbaSalesTrend,
  type SalesTrendPoint as FbaSalesTrendPoint,
  type SalesTrendSnapshot as FbaSalesTrendSnapshot,
  type SalesTrendTotals as FbaSalesTrendTotals,
} from "./fba-sales-metrics";
import { createDeterministicFbaSalesMetricsDemoAdapter } from "./fba-sales-metrics-demo";
import { createFbaSalesMetricsProductionAdapter } from "./fba-sales-metrics-production";
import {
  assertSellerReplenishmentMarketplace,
  readFbaSubscriptionAuditInputs,
  readReplenishmentInventoryInputs,
  readSubscribeAndSaveOffer as readLiveSubscribeAndSaveOffer,
  subscriptionInventoryEvidence,
  type CurrentFbaSkuEvidence,
  type SubscribeAndSaveOfferSnapshot,
} from "./fba-inventory-replenishment";
import { createFbaInventoryReplenishmentProductionAdapter } from "./fba-inventory-replenishment-production";
import { createFbaInboundReadsProductionAdapter } from "./fba-inbound-reads-production";
import { createReportsRuntimeProductionAdapter } from "./reports-runtime-production";
import type { ReportsAdapter } from "./reports-runtime";
import { createAplusContentReadProductionAdapter } from
  "./a-plus-content-reads-production";
import { createCustomerFeedbackReadProductionAdapter } from
  "./customer-feedback-reads-production";
import { createOrdersReadProductionAdapter } from
  "./orders-reads-production";
import { demoFbaCatalogRows } from "./demo-fba-catalog";
import type { FbaCatalogReportsDemoSource } from "./fba-catalog-reports";
import {
  exactListingEnvelopeIdentity,
  readListingsItem,
  readProductTypeDefinition,
  searchListingsItems,
  type ListingsSearchReadResult,
} from "./listings-reads";
import { createListingsReadProductionAdapter } from "./listings-reads-production";
import {
  canonicalBusinessStandardPrice as canonicalBusinessStandardPriceEvidence,
  isPricingListingError as isPricingListingErrorEvidence,
  listingSubmissionIssuesAreWellFormed as listingSubmissionIssuesAreWellFormedEvidence,
  normalizeBusinessOfferReadEvidence,
} from "./business-pricing-evidence";
import {
  summarizeBusinessPricingAuditRows,
  type BusinessPricingAuditRow,
  type BusinessPricingAuditSnapshot,
  type CatalogListingsReadAdapter,
  type CatalogExportError as ListingExportError,
  type CatalogExportRow as ListingExportRow,
  type FbaCatalogIdentitySnapshot as FbaListingIdentitySnapshot,
} from "./catalog-report-reads";
import {
  normalizeListingIssues,
  throwListingsPayloadError,
  throwListingsReadError,
} from "./listings-response-error";
import {
  buildUnboundVariationSearchBatches,
  classifyUnboundVariationSearchBatch,
  completeVariationGroupingRow,
  readFbaVariationGroupingData as readLiveFbaVariationGroupingData,
  readVariationFamily,
  resolveVariationSellerSkuByAsin,
  sellerSkuFromAsinSearchPayload,
  type FbaVariationGroupingData as VariationGroupingData,
  type FbaVariationGroupingRow as VariationGroupingRow,
  type ReviewAuditCandidateSnapshot,
  type UnboundVariationAuditIncompleteRow,
  type UnboundVariationAuditRow,
  type UnboundVariationAuditSnapshot,
} from "./variation-catalog-reads";
import {
  SpApiError,
  SpApiPreCommitError,
  type ListingIssue,
  type SpApiOperation,
} from "./sp-api-error";
import type {
  FulfillmentAvailability,
  ListingPriceSnapshot,
  Money,
  SalePriceSchedule,
} from "./listing-price-types";
import type {
  BusinessPricingCapability,
  BusinessPricingListingSnapshot,
  BusinessQuantityDiscountLevel,
  BusinessQuantityDiscountPlan,
} from "./business-pricing-types";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";
import type {
  VariationMoveGateway,
} from "./variation-move-gateway";
import { createVariationMoveGatewayProduction } from
  "./variation-move-gateway-production";
import {
  listingPricePatchBody,
  type ListingPriceGateway,
} from "./listing-price-gateway";
import type {
  ListingImageFieldCapability,
  ListingImageSnapshot,
} from "./listing-image-types";
import type {
  ListingImageGateway,
  ListingImageGatewayRead,
  ListingImageGatewayReply,
  ListingImagePatchDescriptor,
  ListingImageSourceEvidence,
  ListingImageUrlVector,
} from "./listing-image-gateway";
import {
  businessPricingPatchBody,
  type BusinessPricingGateway,
} from "./business-pricing-gateway";

export { MAX_SALES_TREND_DAY_COUNT } from "./fba-sales-calendar";
export { SpApiError, SpApiPreCommitError } from "./sp-api-error";
export type {
  SalesTrendComparisonMode,
  SalesTrendPresetDays,
  SalesTrendRange,
  SalesTrendWindow,
} from "./fba-sales-calendar";
export type { ListingIssue, SpApiOperation } from "./sp-api-error";
export type {
  FulfillmentAvailability,
  ListingPriceSnapshot,
  ListingWriteExecutionFence,
  Money,
  PriceUpdateResult,
  PriceValidationResult,
  SalePriceSchedule,
  SalePriceUpdateResult,
  SalePriceValidationResult,
  UpdateListingPriceInput,
  UpdateListingSalePriceInput,
} from "./listing-price-types";
export type {
  BusinessPricePrecommitEvidence,
  BusinessPriceUpdateResult,
  BusinessPriceValidationResult,
  BusinessPricingCapability,
  BusinessPricingListingSnapshot,
  BusinessQuantityDiscountLevel,
  BusinessQuantityDiscountPlan,
  UpdateBusinessPriceInput,
} from "./business-pricing-types";
export type {
  VariationAttachInput,
  VariationDetachInput,
  VariationMoveAction,
  VariationMoveExecutionFence,
  VariationMoveInput,
  VariationMovePreparation,
  VariationMovePreview,
  VariationMoveResult,
} from "./variation-move-types";
export type {
  ListingImageFieldCapability,
  ListingImageIdentity,
  ListingImageSnapshot,
  ListingImageUpdateResult,
  UpdateListingImagesInput,
} from "./listing-image-types";
export type { SubscribeAndSaveOfferSnapshot } from "./fba-inventory-replenishment";
export {
  buildUnboundVariationSearchBatches,
  classifyUnboundVariationSearchBatch,
  sellerSkuFromAsinSearchPayload,
} from "./variation-catalog-reads";

import {
  buildAllVariationFamilyRows,
  type VerifiedVariationFamilyMember,
} from "./unbound-variation-audit";

export type {
  VariationDimension,
  VariationFamilyMember,
  VariationFamilySnapshot,
  VariationRole,
} from "./variation-family";

export type SpApiRegion = MarketplaceRegion;
export type { MarketplaceId } from "../../shared/marketplaces";

export type SalesTrendDays = SalesTrendPresetDays;

export type SalesTrendPoint = FbaSalesTrendPoint;
export type SalesTrendTotals = FbaSalesTrendTotals;
export type SalesTrendSnapshot = FbaSalesTrendSnapshot;

export type SubscriptionAuditSnapshot = Omit<
  FbaSubscriptionAuditHistorySnapshot,
  "marketplaceId"
> & {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  requestedMonths: number;
  fetchedAt: string;
  inventoryEvidence: {
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION";
    coverage: "complete" | "partial";
    returnedInventoryRows: number;
    provenSkuCount: number;
    unrecognizedSellerSkuRows: number;
    verifiableReplenishmentOfferCount: number;
    unverifiedFbaSkuCount: number;
  };
  notice: string;
};

export type ListingBatchSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  requestedSkus: string[];
  items: ListingPriceSnapshot[];
  notFound: string[];
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string | null;
};

export type ListingContentFieldCapability = {
  supported: boolean;
  editable: boolean;
  required: boolean;
  minItems: number | null;
  maxItems: number | null;
  minLength: number | null;
  maxLength: number | null;
  maxUtf8Bytes: number | null;
  languageTags: string[];
  reason: string | null;
};

export type ListingContentField =
  | "title"
  | "itemHighlight"
  | "bulletPoints"
  | "productDescription"
  | "ingredients";

export type ListingContentSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string;
  status: string[];
  title: string;
  itemHighlight: string;
  bulletPoints: string[];
  productDescription: string;
  ingredients: string;
  languageTag: string;
  attributePresence: {
    title: boolean;
    itemHighlight: boolean;
    bulletPoints: boolean;
    productDescription: boolean;
    ingredients: boolean;
  };
  capabilities: {
    title: ListingContentFieldCapability;
    itemHighlight: ListingContentFieldCapability;
    bulletPoints: ListingContentFieldCapability;
    productDescription: ListingContentFieldCapability;
    ingredients: ListingContentFieldCapability;
    images: ListingImageFieldCapability[];
    schemaChecksum: string | null;
  };
  createdAt: string | null;
  updatedAt: string | null;
  fetchedAt: string;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string | null;
};

export type ListingContentValues = {
  title: string;
  itemHighlight: string;
  bulletPoints: string[];
  productDescription: string;
  ingredients: string;
};

export type UpdateListingContentInput = ListingContentValues & {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedTitle: string;
  expectedItemHighlight: string;
  expectedBulletPoints: string[];
  expectedProductDescription: string;
  expectedIngredients: string;
};

export type ListingContentValidationResult = {
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: ListingContentField[];
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};

export type ListingContentUpdateResult = {
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: ListingContentField[];
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

export type ListingReportStatus = {
  mode: "live" | "demo";
  ready: boolean;
  reportId: string;
  documentId: string | null;
  status: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL";
  notice: string;
};

export type {
  FbaReviewAuditSeed,
  ReviewAuditCandidateSnapshot,
  UnboundVariationAuditIncompleteRow,
  UnboundVariationAuditRow,
  UnboundVariationAuditSnapshot,
} from "./variation-catalog-reads";

export type RestockPlanSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  fnSku: string | null;
  title: string;
  targetDays: number;
  leadTimeDays: number;
  safetyDays: number;
  casePack: number;
  inventory: {
    fulfillable: number;
    reserved: number;
    inboundWorking: number;
    inboundShipped: number;
    inboundReceiving: number;
    unfulfillable: number;
    researching: number;
    inventoryPosition: number;
  };
  demand: {
    lookbackDays: number;
    units: number;
    averageDailyUnits: number;
    ordersScanned: number;
    partial: boolean;
  };
  daysOfCover: number | null;
  reorderPoint: number;
  recommendedUnits: number;
  forecastStockoutAt: string | null;
  action: "RESTOCK_NOW" | "WATCH" | "HEALTHY" | "NO_DEMAND";
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string;
  skillConnected: boolean;
};

type SpApiMarketplace = {
  label: string;
  shortLabel: string;
  name: string;
  currency: string;
  region: SpApiRegion;
  issueLocale: string;
  timeZone: string;
};

export const MARKETPLACES = Object.freeze(
  Object.fromEntries(
    MARKETPLACE_METADATA.map((marketplace) => [
      marketplace.id,
      {
        label: marketplace.label.replace(/站$/u, ""),
        shortLabel: marketplace.shortLabel,
        name: marketplace.name,
        currency: marketplace.currency,
        region: marketplace.region,
        issueLocale: marketplace.locale.replace("-", "_"),
        timeZone: marketplace.timeZone,
      },
    ]),
  ) as Record<MarketplaceId, SpApiMarketplace>,
);

const JP_MARKETPLACE_ID = marketplaceByCode("JP").id;

const REGION_ENDPOINTS: Record<SpApiRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};


type AmazonListingIssue = {
  code?: string;
  severity?: string;
  message?: string;
  attributeName?: string;
  attributeNames?: string[];
  categories?: string[];
  marketplaceIds?: string[];
};

type AmazonPriceSchedule = {
  schedule?: Array<{
    value_with_tax?: string | number;
    start_at?: string;
    end_at?: string;
  }>;
};

type AmazonQuantityDiscountPlan = {
  schedule?: Array<{
    discount_type?: string;
    levels?: Array<{
      lower_bound?: string | number;
      value?: string | number;
    }>;
  }>;
};

type AmazonPurchasableOffer = {
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

type AmazonListingItem = {
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

type AmazonListingSearchResponse = {
  items?: AmazonListingItem[];
  numberOfResults?: number;
  pagination?: { nextToken?: string; previousToken?: string };
};

type AmazonListingSubmission = {
  sku?: string;
  status?: string;
  submissionId?: string;
  issues?: AmazonListingIssue[];
  identifiers?: Array<{ marketplaceId?: string; asin?: string }>;
};

type AmazonProductTypeDefinition = {
  schema?: {
    link?: { resource?: string };
    checksum?: string;
  };
  productType?: string;
  productTypeVersion?: { version?: string };
};

type ListingsWriteRequestInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  method: "PATCH";
  body?: unknown;
  validationPreview?: boolean;
  validationPreviewIdentifiers?: boolean;
  assertBeforeSend?: () => Promise<void>;
  recordBeforeSend?: () => Promise<void>;
  captureResponseJson?: boolean;
};

const LISTINGS_WRITE_DEADLINE_MS = 12_000;
const LISTINGS_WRITE_RESPONSE_MAX_BYTES = 1_048_576;
const listingsWriteResponsePayloads = new WeakMap<Response, unknown | null>();

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
};

const tokenCache = new Map<SpApiRegion, TokenCacheEntry>();
const tokenRequests = new Map<SpApiRegion, Promise<TokenCacheEntry>>();
let credentialGeneration = 0;

export function invalidateSpApiCredentialCaches(
  options: Readonly<{ preserveRateLimitPacing?: boolean }> = {},
): void {
  credentialGeneration += 1;
  tokenCache.clear();
  tokenRequests.clear();
  if (!options.preserveRateLimitPacing) {
    aplusContentPageAdapterProduction.clearPacing();
  }
  clearProductTypeCapabilityCache();
  demoPriceOverrides.clear();
  demoBusinessPriceOverrides.clear();
  demoBusinessQuantityDiscountOverrides.clear();
  demoSalePriceOverrides.clear();
  demoContentOverrides.clear();
  demoImageOverrides.clear();
}

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

const CONTENT_TEXT_ATTRIBUTE_NAMES = [
  "item_name",
  "title_differentiation",
  "bullet_point",
  "product_description",
  "ingredients",
] as const;

type ListingContentAttributeName = typeof CONTENT_TEXT_ATTRIBUTE_NAMES[number];

async function prepareListingCommit<T>(
  prepare: () => Promise<T>,
  fallbackMessage: string,
): Promise<T> {
  try {
    return await prepare();
  } catch (error) {
    if (error instanceof SpApiPreCommitError) throw error;
    const cause = error instanceof SpApiError
      ? error
      : new SpApiError(fallbackMessage, {
          status: 500,
          code: "PRECOMMIT_FAILED",
          operation: "patchListingsItemPreview",
        });
    throw new SpApiPreCommitError(cause);
  }
}

function getRefreshToken(region: SpApiRegion): string | undefined {
  const regionalKey = `SP_API_REFRESH_TOKEN_${region.toUpperCase()}`;
  return process.env[regionalKey] || process.env.SP_API_REFRESH_TOKEN;
}

function getSellerId(region: SpApiRegion): string | undefined {
  const regionalKey = `SP_API_SELLER_ID_${region.toUpperCase()}`;
  const sellerId = process.env[regionalKey] || process.env.SP_API_SELLER_ID;
  if (!sellerId) return undefined;
  if (sellerId in MARKETPLACES) {
    throw new SpApiError(
      "目前保存的 Seller ID 是 Marketplace ID；請在 Seller Central 重新貼入 Merchant Token。",
      { status: 422, code: "INVALID_SELLER_ID" },
    );
  }
  if (/\s|[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(sellerId)) {
    throw new SpApiError(
      "目前保存的 Seller ID 含有空白或不可見字元；請重新複製 Merchant Token。",
      { status: 422, code: "INVALID_SELLER_ID" },
    );
  }
  return sellerId;
}

export function isConfiguredForMarketplace(marketplaceId: MarketplaceId): boolean {
  const region = MARKETPLACES[marketplaceId].region;
  return Boolean(
    process.env.SP_API_LWA_CLIENT_ID &&
      process.env.SP_API_LWA_CLIENT_SECRET &&
      getRefreshToken(region),
  );
}

function shouldUseDemoMode(marketplaceId: MarketplaceId): boolean {
  if (process.env.SP_API_MODE?.toLowerCase() === "demo") return true;
  return !isConfiguredForMarketplace(marketplaceId);
}

export function usesDemoMode(marketplaceId: MarketplaceId): boolean {
  return shouldUseDemoMode(marketplaceId);
}

function toAmzDate(date = new Date()): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function safeText(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function listingSubmissionIssuesAreWellFormed(issues: unknown): boolean {
  return listingSubmissionIssuesAreWellFormedEvidence(issues);
}

export function isPricingListingError(
  rawIssue: unknown,
  marketplaceId: MarketplaceId,
): boolean {
  return isPricingListingErrorEvidence(rawIssue, marketplaceId);
}

function parseScheduledPrice(
  values: AmazonPriceSchedule[] | undefined,
  currencyCode: string | undefined,
): Money | null {
  const amount = finiteNumericValue(
    values?.[0]?.schedule?.[0]?.value_with_tax,
  );
  if (amount === null || !currencyCode) return null;
  return { amount, currencyCode };
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
  if (canonical && legacy && canonical !== legacy) return null;
  return canonical ?? legacy;
}

function canonicalJsonValue(value: unknown): unknown {
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

function canonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJsonValue(value)))
    .digest("hex");
}

function businessOfferGuardHash(
  offers: readonly AmazonPurchasableOffer[],
  marketplaceId: MarketplaceId,
): string {
  const marketplace = MARKETPLACES[marketplaceId];
  const protectedOffers = offers
    .map((offer) => {
      if (
        offer.marketplace_id !== marketplaceId ||
        offer.audience !== "B2B" ||
        offer.currency !== marketplace.currency
      ) {
        return offer;
      }
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
  const marketplace = MARKETPLACES[marketplaceId];
  const protectedOffers = offers
    .map((offer) => {
      if (
        offer.marketplace_id !== marketplaceId ||
        offer.audience !== "B2B" ||
        offer.currency !== marketplace.currency
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
    // Listings Items may return a full ISO timestamp even though sale-price
    // inputs are marketplace dates. Keep one canonical YYYY-MM-DD contract so
    // preview, conflict detection and post-write verification agree.
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
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  const number = finiteNumericValue(value);
  return number !== null && Number.isInteger(number) && number >= 0
    ? number
    : null;
}

function finitePercentage(value: unknown): number | null {
  const number = finiteNumericValue(value);
  return number !== null && number >= 0 && number <= 100
    ? number
    : null;
}

async function requestAccessToken(
  region: SpApiRegion,
  forceRefresh = false,
): Promise<string> {
  const requestGeneration = credentialGeneration;
  const now = Date.now();
  const cached = tokenCache.get(region);
  if (!forceRefresh && cached && cached.expiresAt > now + 120_000) {
    return cached.accessToken;
  }

  if (!forceRefresh) {
    const inFlight = tokenRequests.get(region);
    if (inFlight) return (await inFlight).accessToken;
  }

  const clientId = process.env.SP_API_LWA_CLIENT_ID;
  const clientSecret = process.env.SP_API_LWA_CLIENT_SECRET;
  const refreshToken = getRefreshToken(region);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new SpApiError("此站點尚未設定 Amazon SP-API 憑證。", {
      status: 503,
      code: "NOT_CONFIGURED",
    });
  }

  const tokenPromise = (async (): Promise<TokenCacheEntry> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetch("https://api.amazon.com/auth/o2/token", {
        method: "POST",
        headers: {
          "content-type":
            "application/x-www-form-urlencoded;charset=UTF-8",
          accept: "application/json",
        },
        body,
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SpApiError(
          response.status === 400 || response.status === 401
            ? "LWA 憑證或 refresh token 無效，請重新檢查授權。"
            : "Amazon LWA 暫時無法完成驗證。",
          {
            status: response.status === 400 ? 401 : response.status,
            code:
              response.status === 400 || response.status === 401
                ? "UNAUTHORIZED"
                : "UPSTREAM_UNAVAILABLE",
          },
        );
      }

      const payload = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };

      if (!payload.access_token) {
        throw new SpApiError("Amazon LWA 回傳了無效的驗證結果。", {
          status: 502,
          code: "UPSTREAM_UNAVAILABLE",
        });
      }

      const entry = {
        accessToken: payload.access_token,
        expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
      };
      if (requestGeneration !== credentialGeneration) {
        throw new SpApiError("Amazon 憑證已在連線期間更新，請重新執行這次查詢。", {
          status: 409,
          code: "CREDENTIALS_CHANGED",
        });
      }
      tokenCache.set(region, entry);
      return entry;
    } catch (error) {
      if (error instanceof SpApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SpApiError("Amazon LWA 驗證逾時，請稍後再試。", {
          status: 504,
          code: "UPSTREAM_UNAVAILABLE",
        });
      }
      throw new SpApiError("無法連線至 Amazon LWA。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    } finally {
      clearTimeout(timeout);
    }
  })();

  tokenRequests.set(region, tokenPromise);
  try {
    return (await tokenPromise).accessToken;
  } finally {
    if (tokenRequests.get(region) === tokenPromise) {
      tokenRequests.delete(region);
    }
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 8_000);
  }
  return Math.min(500 * 2 ** attempt + Math.random() * 250, 5_000);
}

async function readListingsWriteResponseJson(
  response: Response,
  signal: AbortSignal,
  isCommit: boolean,
): Promise<unknown | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;
  let rejectAborted: ((reason: Error) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => rejectAborted?.(new Error("Listings write aborted"));
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > LISTINGS_WRITE_RESPONSE_MAX_BYTES) {
        throw new SpApiError(
          isCommit
            ? "Amazon Listing 更新回應超過安全上限，送出結果無法確認。請先回查 SKU。"
            : "Amazon Listings API 回應超過安全上限。",
          {
            status: isCommit ? 503 : 502,
            code: isCommit
              ? "UPDATE_STATUS_UNKNOWN"
              : "UPSTREAM_UNAVAILABLE",
            operation: "patchListingsItem",
          },
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof SpApiError) throw error;
    throw new SpApiError(
      signal.aborted
        ? isCommit
          ? "Amazon Listing 更新請求逾時，結果可能仍在處理。請先重新查詢 SKU，不要直接重送。"
          : "Amazon Listings API 回應逾時，請稍後再試。"
        : isCommit
          ? "Amazon Listing 更新回應中斷，結果可能仍在處理。請先重新查詢 SKU。"
          : "Amazon Listings API 回應中斷，請稍後再試。",
      {
        status: signal.aborted ? 504 : 502,
        code: isCommit ? "UPDATE_STATUS_UNKNOWN" : "UPSTREAM_UNAVAILABLE",
        operation: "patchListingsItem",
      },
    );
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function assertListingsWriteBeforeSend(
  assertion: (() => Promise<void>) | undefined,
): Promise<void> {
  if (!assertion) return;
  try {
    await assertion();
  } catch (error) {
    const cause = error instanceof SpApiError
      ? error
      : new SpApiError(
          "Amazon 執行環境在正式 Listing PATCH 前改變，已停止送出。",
          { status: 409, code: "SP_CONTEXT_INVALIDATED" },
        );
    throw new SpApiPreCommitError(cause);
  }
}

async function callListingsWriteApi(
  input: ListingsWriteRequestInput,
  forceTokenRefresh = false,
): Promise<Response> {
  const marketplace = MARKETPLACES[input.marketplaceId];
  const region = marketplace.region;
  const sellerId = getSellerId(region);

  if (!sellerId) {
    throw new SpApiError(
      `${marketplace.label}站尚未設定 Seller ID，SKU 寫入功能仍未啟用。`,
      { status: 503, code: "LISTINGS_NOT_CONFIGURED" },
    );
  }

  const token = await requestAccessToken(region, forceTokenRefresh);
  const query = new URLSearchParams({ marketplaceIds: input.marketplaceId });
  query.set("issueLocale", marketplace.issueLocale);
  query.set(
    "includedData",
    input.validationPreview && input.validationPreviewIdentifiers
      ? "identifiers,issues"
      : "issues",
  );
  if (input.validationPreview) query.set("mode", "VALIDATION_PREVIEW");

  const url = `${REGION_ENDPOINTS[region]}/listings/2021-08-01/items/${encodeURIComponent(
    sellerId,
  )}/${encodeURIComponent(input.sellerSku)}?${query}`;
  await assertListingsWriteBeforeSend(input.assertBeforeSend);
  if (input.recordBeforeSend) {
    try {
      await input.recordBeforeSend();
    } catch {
      throw new SpApiPreCommitError(new SpApiError(
        "正式 Listing PATCH 送出前無法保存防重送證據，已停止送出。",
        { status: 500, code: "PRECOMMIT_FAILED" },
      ));
    }
  }
  await assertListingsWriteBeforeSend(input.assertBeforeSend);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LISTINGS_WRITE_DEADLINE_MS,
  );
  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-amz-access-token": token,
        "x-amz-date": toAmzDate(),
        "user-agent": spApiUserAgent(),
      },
      body: JSON.stringify(input.body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (input.captureResponseJson) {
      listingsWriteResponsePayloads.set(
        response,
        await readListingsWriteResponseJson(
          response,
          controller.signal,
          !input.validationPreview,
        ),
      );
    }
    return response;
  } catch (error) {
    const isCommit = !input.validationPreview;
    if (error instanceof SpApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError(
        isCommit
          ? "Amazon Listing 更新請求逾時，結果可能仍在處理。請先重新查詢 SKU，不要直接重送。"
          : "Amazon Listings API 回應逾時，請稍後再試。",
        {
          status: 504,
          code: isCommit ? "UPDATE_STATUS_UNKNOWN" : "UPSTREAM_UNAVAILABLE",
        },
      );
    }
    throw new SpApiError(
      isCommit
        ? "Listing 更新連線中斷，結果可能仍在處理。請先重新查詢 SKU。"
        : "目前無法連線至 Amazon Listings API。",
      {
        status: 502,
        code: isCommit ? "UPDATE_STATUS_UNKNOWN" : "UPSTREAM_UNAVAILABLE",
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function executeListingsWriteRequest(
  input: ListingsWriteRequestInput,
): Promise<Response> {
  let response = await callListingsWriteApi(input);

  if (response.status === 401 && input.validationPreview) {
    tokenCache.delete(MARKETPLACES[input.marketplaceId].region);
    response = await callListingsWriteApi(input, true);
  }

  if (input.validationPreview) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (![429, 500, 503].includes(response.status)) break;
      await wait(retryDelayMs(response, attempt));
      response = await callListingsWriteApi(input);
    }
  }

  return response;
}

const listingsReadAdapter = createListingsReadProductionAdapter({
  getAccessToken: requestAccessToken,
  invalidateAccessToken: (region) => tokenCache.delete(region),
  getSellerId: (region) => getSellerId(region) ?? null,
});

export const catalogListingsReadAdapterProduction:
  CatalogListingsReadAdapter = listingsReadAdapter;

const fbaInventoryReplenishmentAdapter =
  createFbaInventoryReplenishmentProductionAdapter({
    getAccessToken: requestAccessToken,
    invalidateAccessToken: (region) => tokenCache.delete(region),
  });

export const fbaInboundExternalReadAdapterProduction =
  createFbaInboundReadsProductionAdapter({
    getAccessToken: requestAccessToken,
    invalidateAccessToken: (region) => tokenCache.delete(region),
  });

export const reportsRuntimeProductionAdapter: ReportsAdapter =
  createReportsRuntimeProductionAdapter({
    getAccessToken: requestAccessToken,
    invalidateAccessToken: (region) => tokenCache.delete(region),
  });

export const aplusContentPageAdapterProduction =
  createAplusContentReadProductionAdapter({
    getAccessToken: requestAccessToken,
    invalidateAccessToken: (region) => tokenCache.delete(region),
    resolveMode: (marketplaceId) =>
      shouldUseDemoMode(marketplaceId) ? "demo" : "live",
  });

/** One long-lived adapter preserves the global Customer Feedback quota fence. */
export const customerFeedbackPageAdapterProduction =
  createCustomerFeedbackReadProductionAdapter({
    getAccessToken: requestAccessToken,
    invalidateAccessToken: (region) => tokenCache.delete(region),
    resolveMode: (marketplaceId) =>
      shouldUseDemoMode(marketplaceId) ? "demo" : "live",
  });

export const ordersPageAdapterProduction =
  createOrdersReadProductionAdapter({
    getAccessToken: requestAccessToken,
    invalidateAccessToken: (region) => tokenCache.delete(region),
    resolveMode: (marketplaceId) =>
      shouldUseDemoMode(marketplaceId) ? "demo" : "live",
  });

async function parseResponseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function throwListingsError(
  response: Response,
  operation: "read" | "write",
  apiOperation: SpApiOperation,
): Promise<never> {
  const payload = await parseResponseJson<{
    issues?: AmazonListingIssue[];
    errors?: Array<{ code?: string; message?: string }>;
  }>(response);
  return throwListingsPayloadError({
    status: response.status,
    operation,
    apiOperation,
    requestId: response.headers.get("x-amzn-requestid"),
    retryAfter: response.headers.get("retry-after"),
    payload,
  });
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function listingSummary(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
) {
  return (
    payload.summaries?.find((item) => item.marketplaceId === marketplaceId) ??
    payload.summaries?.[0]
  );
}

function listingProductType(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
): string {
  const productType =
    payload.productTypes?.find(
      (item) => item.marketplaceId === marketplaceId,
    )?.productType;
  const summaryProductType = payload.summaries?.find(
    (item) => item.marketplaceId === marketplaceId,
  )?.productType;
  return safeText(productType ?? summaryProductType, "PRODUCT");
}

function attributeObjects(
  payload: AmazonListingItem,
  name: string,
  marketplaceId: MarketplaceId,
): JsonRecord[] {
  const raw = payload.attributes?.[name];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is JsonRecord => {
    if (!isRecord(item)) return false;
    const itemMarketplace = item.marketplace_id;
    return (
      typeof itemMarketplace !== "string" ||
      !itemMarketplace ||
      itemMarketplace === marketplaceId
    );
  });
}

function attributeTextValuesForLanguage(
  payload: AmazonListingItem,
  name: string,
  marketplaceId: MarketplaceId,
  languageTag: string,
): string[] {
  const items = attributeObjects(payload, name, marketplaceId);
  const localized = items.filter(
    (item) => item.language_tag === languageTag,
  );
  const selected = localized.length
    ? localized
    : items.filter(
        (item) =>
          typeof item.language_tag !== "string" || !item.language_tag.trim(),
      );
  return selected
    .map((item) => item.value)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function payloadHasFbaAvailability(payload: AmazonListingItem): boolean {
  return Array.isArray(payload.fulfillmentAvailability) &&
    payload.fulfillmentAvailability.some((availability) =>
      isRecord(availability) && /^(AMAZON|AFN)(?:_|$)/i.test(
        typeof availability.fulfillmentChannelCode === "string"
          ? availability.fulfillmentChannelCode
          : "",
      )
    );
}

function payloadFulfillmentEvidence(
  payload: AmazonListingItem,
): "FBA" | "OTHER" | "MISSING" {
  const availability = Array.isArray(payload.fulfillmentAvailability)
    ? payload.fulfillmentAvailability
    : [];
  const channelCodes = availability
    .map((availability) =>
      isRecord(availability) &&
        typeof availability.fulfillmentChannelCode === "string"
        ? availability.fulfillmentChannelCode.trim()
        : "",
    )
    .filter(Boolean);
  if (
    channelCodes.some((channelCode) =>
      /^(AMAZON|AFN)(?:_|$)/i.test(channelCode),
    )
  ) {
    return "FBA";
  }
  return channelCodes.length ? "OTHER" : "MISSING";
}

function assertFbaListingPayload(payload: AmazonListingItem): void {
  if (payloadHasFbaAvailability(payload)) return;
  throw new SpApiError(
    "此 SKU 無法確認為 FBA 商品；純 FBA 管理台不會讀取或修改它。",
    { status: 422, code: "FBA_ONLY" },
  );
}

function listingPriceIsFba(listing: ListingPriceSnapshot): boolean {
  return listing.fulfillmentAvailability.some(
    (availability) => availability.fulfillment === "FBA",
  );
}

function assertFbaListingPrice(listing: ListingPriceSnapshot): void {
  if (listingPriceIsFba(listing)) return;
  throw new SpApiError(
    "此 SKU 無法確認為 FBA 商品；純 FBA 管理台不會讀取或修改它。",
    { status: 422, code: "FBA_ONLY" },
  );
}

function preferredLanguageTag(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  allowed: string[] = [],
): string {
  const marketplaceLanguage = MARKETPLACES[marketplaceId].issueLocale;
  const availableLanguages = CONTENT_TEXT_ATTRIBUTE_NAMES
    .flatMap((name) => attributeObjects(payload, name, marketplaceId))
    .map((item) => item.language_tag)
    .filter(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    );
  if (
    availableLanguages.includes(marketplaceLanguage) &&
    (!allowed.length || allowed.includes(marketplaceLanguage))
  ) {
    return marketplaceLanguage;
  }
  for (const name of CONTENT_TEXT_ATTRIBUTE_NAMES) {
    const languageTag = attributeObjects(payload, name, marketplaceId)
      .map((item) => item.language_tag)
      .find(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      );
    if (languageTag && (!allowed.length || allowed.includes(languageTag))) {
      return languageTag;
    }
  }
  return allowed.includes(marketplaceLanguage)
    ? marketplaceLanguage
    : (allowed[0] ?? marketplaceLanguage);
}

async function fetchLiveListingItem(
  marketplaceId: MarketplaceId,
  sellerSku: string,
  signal?: AbortSignal,
): Promise<{ payload: AmazonListingItem; requestId: string | null }> {
  const result = await readListingsItem(listingsReadAdapter, {
    intent: "listing",
    marketplaceId,
    sellerSku,
    signal,
  });
  assertNotAborted(signal);
  if (result.status < 200 || result.status >= 300) {
    return throwListingsReadError(result, "getListingsItem");
  }
  if (!isRecord(result.envelope)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 Listing 資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: result.requestId,
    });
  }
  const payload = result.envelope as AmazonListingItem;
  assertExactListingIdentity(payload, marketplaceId, sellerSku);
  return {
    payload,
    requestId: result.requestId,
  };
}

function normalizeListingPrice(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  requestId: string | null,
): ListingPriceSnapshot {
  const marketplace = MARKETPLACES[marketplaceId];
  const summary = listingSummary(payload, marketplaceId);
  const matchingPurchasableOffers =
    payload.attributes?.purchasable_offer?.filter(
      (offer) =>
        offer.marketplace_id === marketplaceId &&
        (!offer.audience || offer.audience === "ALL"),
    ) ?? [];
  const purchasableOffer = matchingPurchasableOffers.length === 1
    ? matchingPurchasableOffers[0]
    : undefined;
  const effectiveOffer =
    payload.offers?.find(
      (offer) =>
        offer.marketplaceId === marketplaceId && offer.offerType === "B2C",
    ) ??
    payload.offers?.find(
      (offer) => offer.marketplaceId === marketplaceId && !offer.offerType,
    );
  const standardCurrency = purchasableOffer?.currency ?? marketplace.currency;
  const rawDiscountedPrice = purchasableOffer?.discounted_price;
  const discountedPrice = parseDiscountedPrice(
    rawDiscountedPrice,
    standardCurrency,
  );
  const effectiveAmount = Number(effectiveOffer?.price?.amount);
  const effectiveCurrency = listingOfferCurrencyCode(effectiveOffer?.price);
  const rawFulfillmentAvailability = payload.fulfillmentAvailability ?? [];
  const fulfillmentAvailability = rawFulfillmentAvailability.map(
    (availability): FulfillmentAvailability => {
      const channelCode = safeText(
        availability.fulfillmentChannelCode,
        "UNKNOWN",
      );
      const quantity = Number(availability.quantity);
      const isFba = /^(AMAZON|AFN)(?:_|$)/i.test(channelCode);
      return {
        channelCode,
        quantity:
          Number.isInteger(quantity) && quantity >= 0 ? quantity : null,
        fulfillment: isFba ? "FBA" : "OTHER",
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

function canonicalBusinessStandardPrice(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
): Money | null {
  return canonicalBusinessStandardPriceEvidence(
    payload.attributes?.purchasable_offer,
    marketplaceId,
  );
}

function businessOfferSnapshot(
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
  const guardHash = businessOfferGuardHash(allOffers, marketplaceId);
  const protectedHash = businessOfferProtectedHash(allOffers, marketplaceId);
  const evidence = normalizeBusinessOfferReadEvidence(
    payload.attributes?.purchasable_offer,
    marketplaceId,
  );
  return {
    ...evidence,
    quantityDiscountPlanHash: evidence.quantityDiscountPlan
      ? canonicalSha256(evidence.quantityDiscountPlan)
      : null,
    businessOfferGuardHash: guardHash,
    businessOfferProtectedHash: protectedHash,
  };
}

function assertExactListingIdentity(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  sellerSku: string,
): void {
  if (!exactListingEnvelopeIdentity(payload, marketplaceId, sellerSku)) {
    throw new SpApiError(
      "Amazon Listing 回應的 SKU、ASIN、商品類型或站點身分不完整，已停止使用。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
}

async function fetchLiveListingPrice(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): Promise<ListingPriceSnapshot> {
  const { payload, requestId } = await fetchLiveListingItem(
    marketplaceId,
    sellerSku,
  );
  const listing = normalizeListingPrice(payload, marketplaceId, requestId);
  assertFbaListingPrice(listing);
  return listing;
}

type ContentCapabilities = ListingContentSnapshot["capabilities"];

type ContentCapabilityResult = {
  capabilities: ContentCapabilities;
  degradedReason: string | null;
};

const productTypeCapabilityCache = new Map<
  string,
  { expiresAt: number; capabilities: ContentCapabilities }
>();
const businessPricingCapabilityCache = new Map<
  string,
  {
    expiresAt: number;
    capability: BusinessPricingCapability;
    schema: JsonRecord;
  }
>();

function businessPricingCapabilityCacheKey(
  generation: number,
  sellerId: string,
  marketplaceId: MarketplaceId,
  productType: string,
): string {
  const sellerScope = createHash("sha256")
    .update(sellerId)
    .digest("hex")
    .slice(0, 24);
  return `${generation}:${sellerScope}:${marketplaceId}:${productType}`;
}

function cachedBusinessPricingSchema(
  marketplaceId: MarketplaceId,
  productType: string,
  checksum: string,
): JsonRecord | null {
  const marketplace = MARKETPLACES[marketplaceId];
  const sellerId = getSellerId(marketplace.region);
  if (!sellerId) return null;
  const cached = businessPricingCapabilityCache.get(
    businessPricingCapabilityCacheKey(
      credentialGeneration,
      sellerId,
      marketplaceId,
      productType,
    ),
  );
  return cached && cached.expiresAt > Date.now() &&
      cached.capability.schemaChecksum === checksum
    ? cached.schema
    : null;
}

function clearProductTypeCapabilityCache(): void {
  productTypeCapabilityCache.clear();
  businessPricingCapabilityCache.clear();
}

function readOnlyContentCapabilities(
  reason: string,
  source?: ContentCapabilities,
): ContentCapabilities {
  const field = (
    capability?: ListingContentFieldCapability,
  ): ListingContentFieldCapability => ({
    supported: capability?.supported ?? true,
    editable: false,
    required: capability?.required ?? false,
    minItems: capability?.minItems ?? null,
    maxItems: capability?.maxItems ?? null,
    minLength: capability?.minLength ?? null,
    maxLength: capability?.maxLength ?? null,
    maxUtf8Bytes: capability?.maxUtf8Bytes ?? null,
    languageTags: capability?.languageTags ?? [],
    reason,
  });
  return {
    title: field(source?.title),
    itemHighlight: field(source?.itemHighlight),
    bulletPoints: field(source?.bulletPoints),
    productDescription: field(source?.productDescription),
    ingredients: field(source?.ingredients),
    images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) => {
      const capability = source?.images[index];
      return {
        attributeName,
        label: index === 0 ? "主圖" : `副圖 ${index}`,
        supported: capability?.supported ?? true,
        editable: false,
        required: capability?.required ?? false,
        reason,
      };
    }),
    schemaChecksum: source?.schemaChecksum ?? null,
  };
}

function jsonPointer(root: JsonRecord, ref: string): unknown {
  if (!ref.startsWith("#/")) return null;
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, part) =>
      isRecord(current) ? current[part] : undefined, root);
}

function schemaCandidates(
  root: JsonRecord,
  value: unknown,
  seen = new Set<string>(),
): JsonRecord[] {
  if (!isRecord(value)) return [];
  const candidates: JsonRecord[] = [value];
  if (typeof value.$ref === "string" && !seen.has(value.$ref)) {
    const nextSeen = new Set(seen).add(value.$ref);
    candidates.push(...schemaCandidates(root, jsonPointer(root, value.$ref), nextSeen));
  }
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    if (!Array.isArray(value[key])) continue;
    for (const branch of value[key]) {
      candidates.push(...schemaCandidates(root, branch, new Set(seen)));
    }
  }
  return candidates;
}

function schemaProperty(
  root: JsonRecord,
  node: unknown,
  propertyName: string,
): unknown {
  for (const candidate of schemaCandidates(root, node)) {
    if (
      isRecord(candidate.properties) &&
      propertyName in candidate.properties
    ) {
      return candidate.properties[propertyName];
    }
  }
  return undefined;
}

function schemaValue(
  root: JsonRecord,
  node: unknown,
  key: string,
): unknown {
  for (const candidate of schemaCandidates(root, node)) {
    if (key in candidate) return candidate[key];
  }
  return undefined;
}

function schemaNumber(
  root: JsonRecord,
  node: unknown,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = schemaValue(root, node, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function contentCapability(
  root: JsonRecord,
  attributeName: string,
): ListingContentFieldCapability {
  const attribute = schemaProperty(root, root, attributeName);
  if (!attribute) {
    return {
      supported: false,
      editable: false,
      required: false,
      minItems: null,
      maxItems: null,
      minLength: null,
      maxLength: null,
      maxUtf8Bytes: null,
      languageTags: [],
      reason: `此商品類型不提供 ${attributeName} 欄位。`,
    };
  }
  const itemSchema = schemaValue(root, attribute, "items");
  const valueSchema = schemaProperty(root, itemSchema, "value");
  const languageSchema = schemaProperty(root, itemSchema, "language_tag");
  const editableFlags = [attribute, itemSchema, valueSchema]
    .flatMap((node) => schemaCandidates(root, node))
    .map((node) => node.editable)
    .filter((value): value is boolean => typeof value === "boolean");
  const editable = !editableFlags.includes(false);
  const languageTags = schemaCandidates(root, languageSchema)
    .flatMap((node) => (Array.isArray(node.enum) ? node.enum : []))
    .filter((value): value is string => typeof value === "string");
  const rootRequired = Array.isArray(root.required) ? root.required : [];
  const minItems = schemaNumber(root, attribute, "minItems");
  return {
    supported: true,
    editable,
    required: rootRequired.includes(attributeName) || (minItems ?? 0) > 0,
    minItems,
    maxItems: schemaNumber(root, attribute, "maxItems"),
    minLength: schemaNumber(root, valueSchema, "minLength"),
    maxLength: schemaNumber(root, valueSchema, "maxLength"),
    maxUtf8Bytes: schemaNumber(
      root,
      valueSchema,
      "maxUtf8ByteLength",
      "maxUtf8Bytes",
    ),
    languageTags: [...new Set(languageTags)],
    reason: editable ? null : `Amazon 將 ${attributeName} 標示為唯讀。`,
  };
}

function imageCapability(
  root: JsonRecord,
  attributeName: string,
  index: number,
): ListingImageFieldCapability {
  const attribute = schemaProperty(root, root, attributeName);
  const label = index === 0 ? "主圖" : `副圖 ${index}`;
  if (!attribute) {
    return {
      attributeName,
      label,
      supported: false,
      editable: false,
      required: false,
      reason: `此商品類型不提供 ${label}欄位。`,
    };
  }
  const itemSchema = schemaValue(root, attribute, "items");
  const mediaSchema = schemaProperty(root, itemSchema, "media_location");
  const editableFlags = [attribute, itemSchema, mediaSchema]
    .flatMap((node) => schemaCandidates(root, node))
    .map((node) => node.editable)
    .filter((value): value is boolean => typeof value === "boolean");
  const editable = !editableFlags.includes(false);
  const rootRequired = Array.isArray(root.required) ? root.required : [];
  const minItems = schemaNumber(root, attribute, "minItems");
  return {
    attributeName,
    label,
    supported: true,
    editable,
    required: rootRequired.includes(attributeName) || (minItems ?? 0) > 0,
    reason: editable ? null : `Amazon 將 ${label}標示為唯讀。`,
  };
}

async function fetchContentCapabilities(
  marketplaceId: MarketplaceId,
  productType: string,
  options: { allowGenericFallback?: boolean } = {},
): Promise<ContentCapabilityResult> {
  const startedGeneration = credentialGeneration;
  const cacheKey = `${startedGeneration}:${marketplaceId}:${productType}`;
  const cached = productTypeCapabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { capabilities: cached.capabilities, degradedReason: null };
  }

  const result = await readProductTypeDefinition(listingsReadAdapter, {
    intent: options.allowGenericFallback ? "content-read" : "content-write",
    marketplaceId,
    productType,
  });
  if (result.status < 200 || result.status >= 300) {
    return throwListingsReadError(result, "getDefinitionsProductType");
  }
  const definition = isRecord(result.envelope)
    ? result.envelope as AmazonProductTypeDefinition
    : null;
  if (!definition?.schema?.link?.resource) {
    throw new SpApiError("Amazon 沒有回傳可用的商品欄位規格。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      requestId: result.requestId,
      operation: "getDefinitionsProductType",
    });
  }
  if (!isRecord(result.schemaEnvelope) ||
    !isRecord(result.schemaEnvelope.properties)) {
    throw new SpApiError("Amazon 商品欄位規格格式無法辨識。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  const schema = result.schemaEnvelope;
  let capabilities: ContentCapabilities = {
    title: contentCapability(schema, "item_name"),
    itemHighlight: contentCapability(schema, "title_differentiation"),
    bulletPoints: contentCapability(schema, "bullet_point"),
    productDescription: contentCapability(schema, "product_description"),
    ingredients: contentCapability(schema, "ingredients"),
    images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) =>
      imageCapability(schema, attributeName, index),
    ),
    schemaChecksum: definition?.schema?.checksum ?? null,
  };
  if (!result.sellerSpecific) {
    const reason =
      "Amazon 目前只提供通用商品欄位規格；內容可唯讀，所有寫入已停用。";
    capabilities = readOnlyContentCapabilities(reason, capabilities);
    return { capabilities, degradedReason: reason };
  }
  if (startedGeneration !== credentialGeneration) {
    throw new SpApiError(
      "Amazon 憑證已在商品欄位規格查詢期間改變；舊結果已丟棄。",
      { status: 409, code: "CREDENTIALS_CHANGED" },
    );
  }
  productTypeCapabilityCache.set(cacheKey, {
    expiresAt: Date.now() + 15 * 60_000,
    capabilities,
  });
  return { capabilities, degradedReason: null };
}

const BUSINESS_SCHEMA_MAX_VISITS = 4_096;
const BUSINESS_SCHEMA_MAX_DEPTH = 48;

type BusinessSchemaTraversal = {
  remaining: number;
  exhausted: boolean;
  safe: boolean;
};

type ExactStringEvaluation = {
  matches: boolean | null;
  constrained: boolean;
};

type BusinessOfferSelector = {
  audience: "B2B";
  marketplaceId: MarketplaceId;
  currencyCode: string;
};

type BusinessOfferPriceBranch = {
  offerPath: readonly unknown[];
  offerSchema: JsonRecord;
  price: unknown;
  quantityDiscountPlan: unknown;
  selectorProven: boolean;
};

const BUSINESS_PRICE_ONLY_OFFER_PROPERTIES = [
  "marketplace_id",
  "currency",
  "audience",
  "our_price",
] as const;

const BUSINESS_COMBINED_OFFER_PROPERTIES = [
  ...BUSINESS_PRICE_ONLY_OFFER_PROPERTIES,
  "quantity_discount_plan",
] as const;

function newBusinessSchemaTraversal(): BusinessSchemaTraversal {
  return {
    remaining: BUSINESS_SCHEMA_MAX_VISITS,
    exhausted: false,
    safe: true,
  };
}

function consumeBusinessSchemaNode(
  traversal: BusinessSchemaTraversal,
  depth: number,
): boolean {
  if (depth > BUSINESS_SCHEMA_MAX_DEPTH || traversal.remaining <= 0) {
    traversal.exhausted = true;
    traversal.safe = false;
    return false;
  }
  traversal.remaining -= 1;
  return true;
}

function reserveBusinessSchemaCollection(
  traversal: BusinessSchemaTraversal,
  length: number,
): boolean {
  if (
    !Number.isSafeInteger(length) || length < 0 ||
    length > traversal.remaining
  ) {
    traversal.exhausted = true;
    traversal.safe = false;
    return false;
  }
  return true;
}

function directEditableFlags(node: unknown): boolean[] {
  if (!isRecord(node)) return [];
  const flags = typeof node.editable === "boolean" ? [node.editable] : [];
  if (node.readOnly === true) flags.push(false);
  return flags;
}

function conjunctExactStringEvaluations(
  evaluations: readonly ExactStringEvaluation[],
): ExactStringEvaluation {
  if (evaluations.some((evaluation) => evaluation.matches === false)) {
    return { matches: false, constrained: true };
  }
  if (evaluations.some((evaluation) => evaluation.matches === null)) {
    return {
      matches: null,
      constrained: evaluations.some((evaluation) => evaluation.constrained),
    };
  }
  return {
    matches: true,
    constrained: evaluations.some((evaluation) => evaluation.constrained),
  };
}

const BUSINESS_SELECTOR_SCHEMA_KEYS = new Set([
  "$anchor",
  "$comment",
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "$lifecycle",
  "allOf",
  "anyOf",
  "const",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "default",
  "deprecated",
  "description",
  "editable",
  "else",
  "enum",
  "enumDeprecated",
  "enumNames",
  "examples",
  "format",
  "hidden",
  "if",
  "maxLength",
  "maxUtf8ByteLength",
  "minLength",
  "minUtf8ByteLength",
  "not",
  "oneOf",
  "pattern",
  "readOnly",
  "replacedBy",
  "replaces",
  "selectors",
  "then",
  "title",
  "type",
  "writeOnly",
]);

const BUSINESS_REF_ANNOTATION_KEYS = new Set([
  "$anchor",
  "$comment",
  "$id",
  "$ref",
  "$schema",
  "$lifecycle",
  "default",
  "deprecated",
  "description",
  "editable",
  "enumDeprecated",
  "enumNames",
  "examples",
  "hidden",
  "readOnly",
  "replacedBy",
  "replaces",
  "selectors",
  "title",
  "writeOnly",
]);

const BUSINESS_OFFER_SCHEMA_KEYS = new Set([
  ...BUSINESS_REF_ANNOTATION_KEYS,
  "additionalProperties",
  "allOf",
  "anyOf",
  "editable",
  "hidden",
  "items",
  "maxItems",
  "maxUniqueItems",
  "minItems",
  "minUniqueItems",
  "oneOf",
  "properties",
  "required",
  "selectors",
  "type",
  "uniqueItems",
]);

const BUSINESS_PRICE_PATH_SCHEMA_KEYS = new Set([
  ...BUSINESS_REF_ANNOTATION_KEYS,
  "$defs",
  "additionalProperties",
  "const",
  "editable",
  "enum",
  "enumNames",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "hidden",
  "items",
  "maximum",
  "maxItems",
  "maxUniqueItems",
  "maxLength",
  "maxProperties",
  "minimum",
  "minItems",
  "minUniqueItems",
  "minLength",
  "minProperties",
  "multipleOf",
  "pattern",
  "properties",
  "required",
  "selectors",
  "type",
  "uniqueItems",
]);

// Attribute discovery is intentionally narrower than a general JSON Schema
// evaluator. Unknown assertions or applicators at the PTD root can change
// whether `purchasable_offer` is valid, so they make B2B writes read-only.
const BUSINESS_ATTRIBUTE_ROOT_SCHEMA_KEYS = new Set([
  ...BUSINESS_REF_ANNOTATION_KEYS,
  "$defs",
  "additionalProperties",
  "definitions",
  "editable",
  "hidden",
  "properties",
  "required",
  "selectors",
  "type",
]);

function hasBusinessRefSiblings(node: JsonRecord): boolean {
  return typeof node.$ref === "string" &&
    Object.keys(node).some((key) => !BUSINESS_REF_ANNOTATION_KEYS.has(key));
}

type BusinessStructuralType =
  | "array"
  | "object"
  | "number"
  | "integer"
  | "string";

function businessSchemaAllowsType(
  node: JsonRecord,
  expected: BusinessStructuralType,
): boolean {
  if (!("type" in node)) return true;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  return types.length > 0 && types.every((type) => typeof type === "string") &&
    types.includes(expected);
}

function businessSchemaAllowsArrayLengthRange(
  node: JsonRecord,
  minimumRequested: number,
  maximumRequested: number,
): boolean {
  if (
    !Number.isSafeInteger(minimumRequested) || minimumRequested < 0 ||
    !Number.isSafeInteger(maximumRequested) ||
    maximumRequested < minimumRequested
  ) return false;
  const minItems = "minItems" in node ? node.minItems : 0;
  const maxItems = "maxItems" in node ? node.maxItems : Number.POSITIVE_INFINITY;
  const minUniqueItems = "minUniqueItems" in node ? node.minUniqueItems : 0;
  const maxUniqueItems = "maxUniqueItems" in node
    ? node.maxUniqueItems
    : Number.POSITIVE_INFINITY;
  const uniqueItems = "uniqueItems" in node ? node.uniqueItems : false;
  return typeof minItems === "number" && Number.isSafeInteger(minItems) &&
    minItems >= 0 && minItems <= minimumRequested &&
    typeof maxItems === "number" &&
    (maxItems === Number.POSITIVE_INFINITY || Number.isSafeInteger(maxItems)) &&
    maxItems >= maximumRequested &&
    typeof minUniqueItems === "number" &&
    Number.isSafeInteger(minUniqueItems) && minUniqueItems >= 0 &&
    minUniqueItems <= minimumRequested &&
    typeof maxUniqueItems === "number" &&
    (maxUniqueItems === Number.POSITIVE_INFINITY ||
      Number.isSafeInteger(maxUniqueItems)) &&
    maxUniqueItems >= maximumRequested &&
    typeof uniqueItems === "boolean";
}

function businessSchemaAllowsSingleArrayItem(node: JsonRecord): boolean {
  return businessSchemaAllowsArrayLengthRange(node, 1, 1);
}

function businessSchemaAllowsObjectProperties(
  node: JsonRecord,
  propertyNames: readonly string[],
): boolean {
  if (
    propertyNames.length < 1 ||
    new Set(propertyNames).size !== propertyNames.length
  ) return false;
  const minProperties = "minProperties" in node ? node.minProperties : 0;
  const maxProperties = "maxProperties" in node
    ? node.maxProperties
    : Number.POSITIVE_INFINITY;
  const required = "required" in node ? node.required : [];
  const propertyCount = propertyNames.length;
  return typeof minProperties === "number" &&
    Number.isSafeInteger(minProperties) && minProperties >= 0 &&
    minProperties <= propertyCount &&
    typeof maxProperties === "number" &&
    (maxProperties === Number.POSITIVE_INFINITY ||
      Number.isSafeInteger(maxProperties)) && maxProperties >= propertyCount &&
    (!("additionalProperties" in node) ||
      typeof node.additionalProperties === "boolean") &&
    Array.isArray(required) &&
    required.every((value) =>
      typeof value === "string" && propertyNames.includes(value)
    );
}

function businessOfferAllowsExactProperties(
  node: JsonRecord,
  propertyNames: readonly string[],
): boolean {
  const properties = isRecord(node.properties) ? node.properties : null;
  return properties !== null &&
    propertyNames.every((propertyName) => propertyName in properties) &&
    businessSchemaAllowsObjectProperties(node, propertyNames) &&
    (!("additionalProperties" in node) ||
      typeof node.additionalProperties === "boolean");
}

// This deliberately small Draft 2019-09 evaluator is used only for the three
// string selectors that identify the B2B contribution. Every applicable
// selector constraint must be understood; an unknown one makes the branch
// read-only instead of being ignored.
function schemaExactStringConstraint(
  root: JsonRecord,
  node: unknown,
  expected: string,
  traversal: BusinessSchemaTraversal,
  seenRefs = new Set<string>(),
  depth = 0,
): ExactStringEvaluation {
  if (!consumeBusinessSchemaNode(traversal, depth)) {
    return { matches: null, constrained: false };
  }
  if (node === false) return { matches: false, constrained: true };
  if (node === true) return { matches: true, constrained: false };
  if (!isRecord(node)) {
    traversal.safe = false;
    return { matches: null, constrained: false };
  }

  const constraints: ExactStringEvaluation[] = [];
  if ("type" in node) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    constraints.push({
      matches: types.every((type) => typeof type === "string")
        ? types.includes("string")
        : null,
      constrained: true,
    });
  }
  if ("const" in node) {
    constraints.push({ matches: node.const === expected, constrained: true });
  }
  if ("enum" in node) {
    constraints.push({
      matches: Array.isArray(node.enum)
        ? node.enum.includes(expected)
        : null,
      constrained: true,
    });
  }
  const length = Array.from(expected).length;
  if ("minLength" in node) {
    const minLength = node.minLength;
    constraints.push({
      matches: typeof minLength === "number" &&
          Number.isSafeInteger(minLength) && minLength >= 0
        ? length >= minLength
        : null,
      constrained: true,
    });
  }
  if ("maxLength" in node) {
    const maxLength = node.maxLength;
    constraints.push({
      matches: typeof maxLength === "number" &&
          Number.isSafeInteger(maxLength) && maxLength >= 0
        ? length <= maxLength
        : null,
      constrained: true,
    });
  }
  const utf8Length = new TextEncoder().encode(expected).byteLength;
  if ("minUtf8ByteLength" in node) {
    const minUtf8ByteLength = node.minUtf8ByteLength;
    constraints.push({
      matches: typeof minUtf8ByteLength === "number" &&
          Number.isSafeInteger(minUtf8ByteLength) && minUtf8ByteLength >= 0
        ? utf8Length >= minUtf8ByteLength
        : null,
      constrained: true,
    });
  }
  if ("maxUtf8ByteLength" in node) {
    const maxUtf8ByteLength = node.maxUtf8ByteLength;
    constraints.push({
      matches: typeof maxUtf8ByteLength === "number" &&
          Number.isSafeInteger(maxUtf8ByteLength) && maxUtf8ByteLength >= 0
        ? utf8Length <= maxUtf8ByteLength
        : null,
      constrained: true,
    });
  }
  if ("pattern" in node) {
    let patternMatches: boolean | null = null;
    if (typeof node.pattern === "string") {
      try {
        patternMatches = new RegExp(node.pattern, "u").test(expected);
      } catch {
        patternMatches = null;
      }
    }
    constraints.push({ matches: patternMatches, constrained: true });
  }

  if (typeof node.$ref === "string") {
    if (seenRefs.has(node.$ref)) {
      traversal.exhausted = true;
      traversal.safe = false;
      return { matches: null, constrained: false };
    }
    constraints.push(schemaExactStringConstraint(
      root,
      jsonPointer(root, node.$ref),
      expected,
      traversal,
      new Set(seenRefs).add(node.$ref),
      depth + 1,
    ));
  }

  if ("allOf" in node && !Array.isArray(node.allOf)) {
    constraints.push({ matches: null, constrained: true });
  } else if (Array.isArray(node.allOf)) {
    if (!reserveBusinessSchemaCollection(traversal, node.allOf.length)) {
      constraints.push({ matches: null, constrained: true });
    } else {
      for (const branch of node.allOf) {
        if (traversal.exhausted) break;
        constraints.push(schemaExactStringConstraint(
          root,
          branch,
          expected,
          traversal,
          new Set(seenRefs),
          depth + 1,
        ));
      }
    }
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    if (!(key in node)) continue;
    if (!Array.isArray(node[key])) {
      constraints.push({ matches: null, constrained: true });
      continue;
    }
    if (!reserveBusinessSchemaCollection(traversal, node[key].length)) {
      constraints.push({ matches: null, constrained: true });
      continue;
    }
    const branchResults: ExactStringEvaluation[] = [];
    for (const branch of node[key]) {
      if (traversal.exhausted) break;
      branchResults.push(schemaExactStringConstraint(
        root,
        branch,
        expected,
        traversal,
        new Set(seenRefs),
        depth + 1,
      ));
    }
    if (traversal.exhausted) {
      constraints.push({ matches: null, constrained: true });
      continue;
    }
    const matches = branchResults.filter((result) =>
      result.matches === true
    ).length;
    const unknown = branchResults.some((result) => result.matches === null);
    if (key === "oneOf") {
      constraints.push({
        matches: unknown ? null : matches === 1,
        constrained: true,
      });
    } else {
      constraints.push({
        matches: matches > 0 ? true : unknown ? null : false,
        constrained: branchResults.every((result) => result.constrained),
      });
    }
  }

  if ("not" in node) {
    const rejected = schemaExactStringConstraint(
      root,
      node.not,
      expected,
      traversal,
      new Set(seenRefs),
      depth + 1,
    );
    constraints.push({
      matches: rejected.matches === null ? null : !rejected.matches,
      constrained: true,
    });
  }
  if (
    "if" in node || "then" in node || "else" in node ||
    "dependentSchemas" in node || "dependentRequired" in node ||
    "format" in node || "contentEncoding" in node ||
    "contentMediaType" in node || "contentSchema" in node
  ) {
    constraints.push({ matches: null, constrained: true });
  }
  if (Object.keys(node).some((key) => !BUSINESS_SELECTOR_SCHEMA_KEYS.has(key))) {
    constraints.push({ matches: null, constrained: true });
  }

  return conjunctExactStringEvaluations(constraints.length > 0
    ? constraints
    : [{ matches: true, constrained: false }]);
}

function businessBranchAudienceEvaluation(
  root: JsonRecord,
  node: unknown,
  traversal: BusinessSchemaTraversal,
  seenRefs = new Set<string>(),
  depth = 0,
): ExactStringEvaluation {
  if (!consumeBusinessSchemaNode(traversal, depth)) {
    return { matches: null, constrained: false };
  }
  if (node === false) return { matches: false, constrained: true };
  if (node === true) return { matches: true, constrained: false };
  if (!isRecord(node)) {
    traversal.safe = false;
    return { matches: null, constrained: false };
  }
  if (!businessSchemaAllowsType(node, "object")) {
    return { matches: false, constrained: true };
  }
  if (
    "allOf" in node || "anyOf" in node || "oneOf" in node ||
    "if" in node || "then" in node || "else" in node || "not" in node ||
    "dependentSchemas" in node || "dependentRequired" in node
  ) {
    return { matches: null, constrained: false };
  }
  const evaluations: ExactStringEvaluation[] = [];
  if (isRecord(node.properties) && "audience" in node.properties) {
    evaluations.push(schemaExactStringConstraint(
      root,
      node.properties.audience,
      "B2B",
      traversal,
      new Set(seenRefs),
      depth + 1,
    ));
  }
  if (typeof node.$ref === "string") {
    if (seenRefs.has(node.$ref)) {
      traversal.exhausted = true;
      traversal.safe = false;
      return { matches: null, constrained: false };
    }
    evaluations.push(businessBranchAudienceEvaluation(
      root,
      jsonPointer(root, node.$ref),
      traversal,
      new Set(seenRefs).add(node.$ref),
      depth + 1,
    ));
  }
  return conjunctExactStringEvaluations(evaluations.length > 0
    ? evaluations
    : [{ matches: true, constrained: false }]);
}

function businessOfferPriceBranches(
  root: JsonRecord,
  node: unknown,
  selector: BusinessOfferSelector,
  traversal: BusinessSchemaTraversal,
  seenRefs = new Set<string>(),
  depth = 0,
  ancestors: readonly unknown[] = [],
  expectedType: "array" | "object" = "array",
): BusinessOfferPriceBranch[] {
  if (!consumeBusinessSchemaNode(traversal, depth)) {
    return [];
  }
  if (node === false) {
    traversal.safe = false;
    return [];
  }
  if (node === true || !isRecord(node)) {
    if (node !== true) traversal.safe = false;
    return [];
  }
  if (
    !businessSchemaAllowsType(node, expectedType) ||
    (expectedType === "array" && !businessSchemaAllowsSingleArrayItem(node))
  ) {
    traversal.safe = false;
    return [];
  }
  const currentPath = [...ancestors, node];
  const found: BusinessOfferPriceBranch[] = [];
  if (hasBusinessRefSiblings(node)) traversal.safe = false;
  if (Object.keys(node).some((key) => !BUSINESS_OFFER_SCHEMA_KEYS.has(key))) {
    traversal.safe = false;
  }
  if (
    "if" in node || "then" in node || "else" in node || "not" in node ||
    "dependentSchemas" in node || "dependentRequired" in node
  ) {
    traversal.safe = false;
  }
  const properties = isRecord(node.properties) ? node.properties : null;
  const audienceConstraint = properties && "audience" in properties
    ? schemaExactStringConstraint(
        root,
        properties.audience,
        selector.audience,
        traversal,
        new Set(seenRefs),
        depth + 1,
      )
    : null;
  const hasDirectOfferDefinition = expectedType === "object" && Boolean(
    properties && "audience" in properties && "our_price" in properties,
  );
  if (properties) {
    const partialSelectorOrPrice = [
      "audience",
      "currency",
      "marketplace_id",
      "our_price",
    ].some((key) => key in properties);
    if (partialSelectorOrPrice && !hasDirectOfferDefinition) {
      traversal.safe = false;
    }
  }
  if (
    hasDirectOfferDefinition &&
    ("$ref" in node || "allOf" in node || "anyOf" in node ||
      "oneOf" in node)
  ) {
    traversal.safe = false;
  }
  if (
    hasDirectOfferDefinition &&
    audienceConstraint?.matches === true &&
    audienceConstraint.constrained
  ) {
    const marketplaceConstraint = properties && "marketplace_id" in properties
      ? schemaExactStringConstraint(
          root,
          properties.marketplace_id,
          selector.marketplaceId,
          traversal,
          new Set(seenRefs),
          depth + 1,
        )
      : { matches: null, constrained: false };
    const currencyConstraint = properties && "currency" in properties
      ? schemaExactStringConstraint(
          root,
          properties.currency,
          selector.currencyCode,
          traversal,
          new Set(seenRefs),
          depth + 1,
        )
      : { matches: null, constrained: false };
    found.push({
      offerPath: currentPath,
      offerSchema: node,
      price: properties?.our_price,
      quantityDiscountPlan: properties?.quantity_discount_plan,
      selectorProven:
        marketplaceConstraint.matches === true &&
        marketplaceConstraint.constrained &&
        currencyConstraint.matches === true &&
        currencyConstraint.constrained,
    });
  }

  if (typeof node.$ref === "string") {
    if (seenRefs.has(node.$ref)) {
      traversal.exhausted = true;
      traversal.safe = false;
    } else {
      found.push(...businessOfferPriceBranches(
        root,
        jsonPointer(root, node.$ref),
        selector,
        traversal,
        new Set(seenRefs).add(node.$ref),
        depth + 1,
        currentPath,
        expectedType,
      ));
    }
  }
  if ("items" in node) {
    if (expectedType !== "array") {
      traversal.safe = false;
      return found;
    }
    const items = Array.isArray(node.items) ? node.items : [node.items];
    if (items.length !== 1) traversal.safe = false;
    if (!reserveBusinessSchemaCollection(traversal, items.length)) {
      return found;
    }
    for (const item of items) {
      if (traversal.exhausted) break;
      found.push(...businessOfferPriceBranches(
        root,
        item,
        selector,
        traversal,
        new Set(seenRefs),
        depth + 1,
        currentPath,
        "object",
      ));
    }
  }
  if ("allOf" in node) {
    traversal.safe = false;
    if (Array.isArray(node.allOf)) {
      if (!reserveBusinessSchemaCollection(traversal, node.allOf.length)) {
        return found;
      }
      for (const branch of node.allOf) {
        if (traversal.exhausted) break;
        found.push(...businessOfferPriceBranches(
          root,
          branch,
          selector,
          traversal,
          new Set(seenRefs),
          depth + 1,
          currentPath,
          expectedType,
        ));
      }
    }
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    if (!(key in node)) continue;
    if (!Array.isArray(node[key])) {
      traversal.safe = false;
      continue;
    }
    if (!reserveBusinessSchemaCollection(traversal, node[key].length)) {
      continue;
    }
    const evaluated: Array<{
      branch: unknown;
      audience: ExactStringEvaluation;
    }> = [];
    for (const branch of node[key]) {
      if (traversal.exhausted) break;
      evaluated.push({
        branch,
        audience: businessBranchAudienceEvaluation(
        root,
        branch,
        traversal,
        new Set(seenRefs),
        depth + 1,
        ),
      });
    }
    if (traversal.exhausted) continue;
    const matching = evaluated.filter(({ audience }) =>
      audience.matches === true
    );
    const exact = matching.filter(({ audience }) => audience.constrained);
    const excluded = evaluated.filter(({ audience }) =>
      audience.matches === false
    );
    const uniquelySelected = exact.length === 1 && matching.length === 1 &&
      excluded.length === evaluated.length - 1;
    if (!uniquelySelected) traversal.safe = false;
    for (const { branch } of exact) {
      found.push(...businessOfferPriceBranches(
        root,
        branch,
        selector,
        traversal,
        new Set(seenRefs),
        depth + 1,
        currentPath,
        expectedType,
      ));
    }
  }
  return found;
}

function businessOfferAttributeSchemas(
  root: JsonRecord,
  traversal: BusinessSchemaTraversal,
): { schemas: unknown[]; safe: boolean } {
  const schemas: unknown[] = [];
  let safe = true;
  const walk = (
    node: unknown,
    seenRefs = new Set<string>(),
    depth = 0,
  ): void => {
    if (!consumeBusinessSchemaNode(traversal, depth)) return;
    if (node === false) {
      safe = false;
      traversal.safe = false;
      return;
    }
    if (!isRecord(node)) {
      if (node !== true) traversal.safe = false;
      return;
    }
    if (
      !businessSchemaAllowsType(node, "object") ||
      hasBusinessRefSiblings(node) ||
      Object.keys(node).some((key) =>
        !BUSINESS_ATTRIBUTE_ROOT_SCHEMA_KEYS.has(key)
      ) ||
      node.editable === false ||
      node.readOnly === true ||
      ("properties" in node && !isRecord(node.properties)) ||
      ("required" in node &&
        (!Array.isArray(node.required) ||
          node.required.some((value) => typeof value !== "string"))) ||
      ("additionalProperties" in node &&
        typeof node.additionalProperties !== "boolean" &&
        !isRecord(node.additionalProperties))
    ) {
      safe = false;
      traversal.safe = false;
    }
    if (
      "if" in node || "then" in node || "else" in node || "not" in node ||
      "dependentSchemas" in node || "dependentRequired" in node ||
      "patternProperties" in node || "propertyNames" in node ||
      "unevaluatedProperties" in node
    ) {
      safe = false;
      traversal.safe = false;
    }
    if (
      isRecord(node.properties) &&
      "purchasable_offer" in node.properties
    ) {
      schemas.push(node.properties.purchasable_offer);
    }
    if (typeof node.$ref === "string") {
      if (seenRefs.has(node.$ref)) {
        traversal.exhausted = true;
        traversal.safe = false;
      } else {
        walk(
          jsonPointer(root, node.$ref),
          new Set(seenRefs).add(node.$ref),
          depth + 1,
        );
      }
    }
    if ("allOf" in node) {
      safe = false;
      traversal.safe = false;
    }
    if (Array.isArray(node.allOf)) {
      if (!reserveBusinessSchemaCollection(traversal, node.allOf.length)) {
        return;
      }
      for (const branch of node.allOf) {
        if (traversal.exhausted) break;
        walk(branch, new Set(seenRefs), depth + 1);
      }
    }
    if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf)) {
      safe = false;
      traversal.safe = false;
    }
  };
  walk(root);
  return {
    schemas,
    safe: safe && traversal.safe && !traversal.exhausted,
  };
}

function businessSimpleSchemaChain(
  root: JsonRecord,
  node: unknown,
  traversal: BusinessSchemaTraversal,
  expectedType: BusinessStructuralType,
  expectedProperties: readonly string[] = [],
  expectedArrayLengthRange: readonly [number, number] = [1, 1],
  seenRefs = new Set<string>(),
  depth = 0,
): { nodes: JsonRecord[]; safe: boolean } {
  if (!consumeBusinessSchemaNode(traversal, depth)) {
    return { nodes: [], safe: false };
  }
  if (node === false || node === true || !isRecord(node)) {
    traversal.safe = false;
    return { nodes: [], safe: false };
  }
  let safe = true;
  if (
    !businessSchemaAllowsType(node, expectedType) ||
    (expectedType === "array" && !businessSchemaAllowsArrayLengthRange(
      node,
      expectedArrayLengthRange[0],
      expectedArrayLengthRange[1],
    )) ||
    (expectedType === "object" &&
      !businessSchemaAllowsObjectProperties(node, expectedProperties)) ||
    ((expectedType === "array" || expectedType === "object") &&
      ("const" in node || "enum" in node)) ||
    hasBusinessRefSiblings(node)
  ) {
    traversal.safe = false;
    safe = false;
  }
  if (
    Object.keys(node).some((key) =>
      !BUSINESS_PRICE_PATH_SCHEMA_KEYS.has(key)
    )
  ) {
    traversal.safe = false;
    safe = false;
  }
  if (
    "allOf" in node || "anyOf" in node || "oneOf" in node ||
    "if" in node || "then" in node || "else" in node || "not" in node ||
    "dependentSchemas" in node || "dependentRequired" in node
  ) {
    traversal.safe = false;
    safe = false;
  }
  const nodes = [node];
  if (typeof node.$ref === "string") {
    if (seenRefs.has(node.$ref)) {
      traversal.exhausted = true;
      traversal.safe = false;
      return { nodes, safe: false };
    }
    const referenced = businessSimpleSchemaChain(
      root,
      jsonPointer(root, node.$ref),
      traversal,
      expectedType,
      expectedProperties,
      expectedArrayLengthRange,
      new Set(seenRefs).add(node.$ref),
      depth + 1,
    );
    nodes.push(...referenced.nodes);
    safe &&= referenced.safe;
  }
  return { nodes, safe };
}

function businessSingleSchemaValue(
  root: JsonRecord,
  node: unknown,
  kind: "items" | "property",
  traversal: BusinessSchemaTraversal,
  propertyName?: string,
  expectedArrayLengthRange: readonly [number, number] = [1, 1],
): { value: unknown; nodes: JsonRecord[]; safe: boolean } {
  const expectedType = kind === "items" ? "array" : "object";
  const chain = businessSimpleSchemaChain(
    root,
    node,
    traversal,
    expectedType,
    kind === "property" && propertyName ? [propertyName] : [],
    expectedArrayLengthRange,
  );
  const values: unknown[] = [];
  for (const candidate of chain.nodes) {
    if (kind === "items") {
      if (!("items" in candidate)) continue;
      const candidateItems = Array.isArray(candidate.items)
        ? candidate.items
        : [candidate.items];
      if (
        candidateItems.length !== 1 ||
        !reserveBusinessSchemaCollection(traversal, candidateItems.length)
      ) {
        traversal.safe = false;
        continue;
      }
      values.push(candidateItems[0]);
      continue;
    }
    if (propertyName && isRecord(candidate.properties) &&
        propertyName in candidate.properties
    ) {
      values.push(candidate.properties[propertyName]);
    }
  }
  const safe = chain.safe && values.length === 1;
  if (!safe) traversal.safe = false;
  return { value: values[0], nodes: chain.nodes, safe };
}

function businessSchemaPropertyValues(
  root: JsonRecord,
  node: unknown,
  traversal: BusinessSchemaTraversal,
  propertyNames: readonly string[],
): {
  values: Readonly<Record<string, unknown>>;
  nodes: JsonRecord[];
  safe: boolean;
} {
  const chain = businessSimpleSchemaChain(
    root,
    node,
    traversal,
    "object",
    propertyNames,
  );
  const values = new Map<string, unknown[]>();
  for (const propertyName of propertyNames) values.set(propertyName, []);
  for (const candidate of chain.nodes) {
    if (!isRecord(candidate.properties)) continue;
    for (const propertyName of propertyNames) {
      if (propertyName in candidate.properties) {
        values.get(propertyName)!.push(candidate.properties[propertyName]);
      }
    }
  }
  const safe = chain.safe && propertyNames.every((propertyName) =>
    values.get(propertyName)?.length === 1
  );
  if (!safe) traversal.safe = false;
  return {
    values: Object.fromEntries(propertyNames.map((propertyName) => [
      propertyName,
      values.get(propertyName)?.[0],
    ])),
    nodes: chain.nodes,
    safe,
  };
}

function businessNumericSchemaAccepts(
  nodes: readonly JsonRecord[],
  value: number,
): boolean {
  for (const node of nodes) {
    if ("const" in node && node.const !== value) return false;
    if ("enum" in node &&
        (!Array.isArray(node.enum) || !node.enum.includes(value))) return false;
    for (const [key, predicate] of [
      ["minimum", (limit: number) => value >= limit],
      ["exclusiveMinimum", (limit: number) => value > limit],
      ["maximum", (limit: number) => value <= limit],
      ["exclusiveMaximum", (limit: number) => value < limit],
    ] as const) {
      if (!(key in node)) continue;
      const limit = node[key];
      if (typeof limit !== "number" || !Number.isFinite(limit) ||
          !predicate(limit)) return false;
    }
    if ("multipleOf" in node) {
      const multiple = node.multipleOf;
      if (typeof multiple !== "number" || !Number.isFinite(multiple) ||
          multiple <= 0) return false;
      const quotient = value / multiple;
      if (Math.abs(quotient - Math.round(quotient)) >
          Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4) return false;
    }
  }
  return true;
}

function businessPriceBranchEditable(
  root: JsonRecord,
  branch: BusinessOfferPriceBranch,
  traversal: BusinessSchemaTraversal,
): boolean {
  if (!branch.selectorProven || !traversal.safe) return false;
  const pathNodes: JsonRecord[] = branch.offerPath.filter(isRecord);
  const priceItem = businessSingleSchemaValue(
    root,
    branch.price,
    "items",
    traversal,
  );
  pathNodes.push(...priceItem.nodes);
  if (!priceItem.safe) return false;
  const schedule = businessSingleSchemaValue(
    root,
    priceItem.value,
    "property",
    traversal,
    "schedule",
  );
  pathNodes.push(...schedule.nodes);
  if (!schedule.safe) return false;
  const scheduleItem = businessSingleSchemaValue(
    root,
    schedule.value,
    "items",
    traversal,
  );
  pathNodes.push(...scheduleItem.nodes);
  if (!scheduleItem.safe) return false;
  const valueWithTax = businessSingleSchemaValue(
    root,
    scheduleItem.value,
    "property",
    traversal,
    "value_with_tax",
  );
  pathNodes.push(...valueWithTax.nodes);
  if (!valueWithTax.safe) return false;
  const leaf = businessSimpleSchemaChain(
    root,
    valueWithTax.value,
    traversal,
    "number",
    [],
  );
  pathNodes.push(...leaf.nodes);
  if (!leaf.safe || !traversal.safe) return false;
  const flags = pathNodes.flatMap(directEditableFlags);
  const leafFlags = leaf.nodes.flatMap(directEditableFlags);
  return leafFlags.includes(true) && !flags.includes(false);
}

function businessQuantityDiscountBranchEditable(
  root: JsonRecord,
  branch: BusinessOfferPriceBranch,
  traversal: BusinessSchemaTraversal,
  proposedLevels: readonly BusinessQuantityDiscountLevel[] = [
    { lowerBound: 5, value: 5 },
    { lowerBound: 10, value: 10 },
    { lowerBound: 15, value: 15 },
    { lowerBound: 20, value: 20 },
  ],
): boolean {
  if (!branch.selectorProven || !traversal.safe) return false;
  const pathNodes: JsonRecord[] = branch.offerPath.filter(isRecord);
  const planItem = businessSingleSchemaValue(
    root,
    branch.quantityDiscountPlan,
    "items",
    traversal,
  );
  pathNodes.push(...planItem.nodes);
  if (!planItem.safe) return false;
  const schedule = businessSingleSchemaValue(
    root,
    planItem.value,
    "property",
    traversal,
    "schedule",
  );
  pathNodes.push(...schedule.nodes);
  if (!schedule.safe) return false;
  const scheduleItem = businessSingleSchemaValue(
    root,
    schedule.value,
    "items",
    traversal,
  );
  pathNodes.push(...scheduleItem.nodes);
  if (!scheduleItem.safe) return false;
  const scheduleFields = businessSchemaPropertyValues(
    root,
    scheduleItem.value,
    traversal,
    ["discount_type", "levels"],
  );
  pathNodes.push(...scheduleFields.nodes);
  if (!scheduleFields.safe) return false;
  const discountType = businessSimpleSchemaChain(
    root,
    scheduleFields.values.discount_type,
    traversal,
    "string",
  );
  pathNodes.push(...discountType.nodes);
  if (!discountType.safe) return false;
  const percent = schemaExactStringConstraint(
    root,
    scheduleFields.values.discount_type,
    "percent",
    traversal,
  );
  const percentExplicitlyDeclared = discountType.nodes.some((node) =>
    node.const === "percent" ||
    (Array.isArray(node.enum) && node.enum.includes("percent"))
  );
  if (percent.matches !== true || !percentExplicitlyDeclared) return false;
  const levelItem = businessSingleSchemaValue(
    root,
    scheduleFields.values.levels,
    "items",
    traversal,
    undefined,
    [1, 5],
  );
  pathNodes.push(...levelItem.nodes);
  if (!levelItem.safe) return false;
  const levelFields = businessSchemaPropertyValues(
    root,
    levelItem.value,
    traversal,
    ["lower_bound", "value"],
  );
  pathNodes.push(...levelFields.nodes);
  if (!levelFields.safe) return false;
  const lowerBound = businessSimpleSchemaChain(
    root,
    levelFields.values.lower_bound,
    traversal,
    "integer",
  );
  const value = businessSimpleSchemaChain(
    root,
    levelFields.values.value,
    traversal,
    "number",
  );
  pathNodes.push(...lowerBound.nodes, ...value.nodes);
  if (!lowerBound.safe || !value.safe || !traversal.safe) return false;
  if (
    !proposedLevels.every((level) =>
      businessNumericSchemaAccepts(lowerBound.nodes, level.lowerBound) &&
      businessNumericSchemaAccepts(value.nodes, level.value)
    )
  ) return false;
  const flags = pathNodes.flatMap(directEditableFlags);
  const discountFlags = discountType.nodes.flatMap(directEditableFlags);
  const lowerBoundFlags = lowerBound.nodes.flatMap(directEditableFlags);
  const valueFlags = value.nodes.flatMap(directEditableFlags);
  return discountFlags.includes(true) && lowerBoundFlags.includes(true) &&
    valueFlags.includes(true) && !flags.includes(false);
}

function businessPricingCapabilityFromSchema(
  schema: JsonRecord,
  checksum: string | null,
  selector: BusinessOfferSelector,
  proposedQuantityDiscountLevels?: readonly BusinessQuantityDiscountLevel[],
): BusinessPricingCapability {
  const traversal = newBusinessSchemaTraversal();
  const attributes = businessOfferAttributeSchemas(schema, traversal);
  if (attributes.schemas.length === 0) {
    return {
      supported: false,
      editable: false,
      reason: "Amazon seller-specific PTD 沒有提供 purchasable_offer。",
      quantityDiscountsSupported: false,
      quantityDiscountsEditable: false,
      quantityDiscountsReason:
        "Amazon seller-specific PTD 沒有提供 quantity_discount_plan。",
      schemaChecksum: checksum,
    };
  }
  const branchesByAttribute = attributes.schemas.map((attribute) =>
    businessOfferPriceBranches(
      schema,
      attribute,
      selector,
      traversal,
    )
  );
  const branches = branchesByAttribute.flat();
  if (branches.length === 0) {
    return {
      supported: false,
      editable: false,
      reason:
        "Amazon seller-specific PTD 未提供 B2B audience 或 Business Price 欄位；此帳號／站點／商品類型不可寫入。",
      quantityDiscountsSupported: false,
      quantityDiscountsEditable: false,
      quantityDiscountsReason:
        "Amazon seller-specific PTD 未提供可唯一選取的 B2B quantity_discount_plan。",
      schemaChecksum: checksum,
    };
  }
  const rootFlags = attributes.schemas.flatMap(directEditableFlags);
  const hasUncomposedAttributeConstraint =
    attributes.schemas.length > 1 &&
    branchesByAttribute.some((attributeBranches) =>
      attributeBranches.length === 0
    );
  const editable = attributes.safe && traversal.safe && !traversal.exhausted &&
    !rootFlags.includes(false) && !hasUncomposedAttributeConstraint &&
    branches.every((branch) =>
      businessOfferAllowsExactProperties(
        branch.offerSchema,
        BUSINESS_PRICE_ONLY_OFFER_PROPERTIES,
      ) &&
      businessPriceBranchEditable(schema, branch, traversal)
    ) && traversal.safe && !traversal.exhausted;
  const quantityDiscountsSupported = branches.every((branch) =>
    isRecord(branch.quantityDiscountPlan)
  );
  const quantityDiscountsEditable = editable && quantityDiscountsSupported &&
    branches.every((branch) =>
      businessOfferAllowsExactProperties(
        branch.offerSchema,
        BUSINESS_COMBINED_OFFER_PROPERTIES,
      ) &&
      businessQuantityDiscountBranchEditable(
        schema,
        branch,
        traversal,
        proposedQuantityDiscountLevels,
      )
    );
  return {
    supported: true,
    editable,
    reason: editable
      ? null
      : "Amazon seller-specific PTD 未能明確證明 B2B 價格可編輯。",
    quantityDiscountsSupported,
    quantityDiscountsEditable,
    quantityDiscountsReason: quantityDiscountsEditable
      ? null
      : "Amazon seller-specific PTD 未能明確證明數量折扣可編輯。",
    schemaChecksum: checksum,
  };
}

async function fetchBusinessPricingCapability(
  marketplaceId: MarketplaceId,
  productType: string,
  options: { forceRefresh?: boolean } = {},
): Promise<BusinessPricingCapability> {
  const marketplace = MARKETPLACES[marketplaceId];
  const startedGeneration = credentialGeneration;
  const sellerId = getSellerId(marketplace.region);
  if (!sellerId) {
    throw new SpApiError(
      `${marketplace.label}站尚未設定 Seller ID，無法取得 seller-specific B2B PTD。`,
      { status: 503, code: "LISTINGS_NOT_CONFIGURED" },
    );
  }
  const cacheKey = businessPricingCapabilityCacheKey(
    startedGeneration,
    sellerId,
    marketplaceId,
    productType,
  );
  const cached = businessPricingCapabilityCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.capability;
  }
  const result = await readProductTypeDefinition(listingsReadAdapter, {
    intent: "business-offer",
    marketplaceId,
    productType,
  });
  if (result.status < 200 || result.status >= 300) {
    return throwListingsReadError(result, "getDefinitionsProductType");
  }
  const definition = isRecord(result.envelope)
    ? result.envelope as AmazonProductTypeDefinition
    : null;
  const schemaUrl = definition?.schema?.link?.resource;
  const checksum = definition?.schema?.checksum ?? null;
  const schemaBytes = result.schemaBytes;
  if (!schemaUrl || !checksum || !schemaBytes) {
    throw new SpApiError(
      "Amazon B2B seller-specific PTD 沒有回傳可核對的 schema 與 checksum。",
      {
        status: 502,
        code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
        requestId: result.requestId,
        operation: "getDefinitionsProductType",
      },
    );
  }
  const actualChecksum = createHash("md5")
    .update(schemaBytes)
    .digest("base64");
  if (actualChecksum !== checksum) {
    throw new SpApiError(
      "Amazon B2B seller-specific PTD schema 與官方 checksum 不一致，已停止使用。",
      {
        status: 502,
        code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
        operation: "getDefinitionsProductType",
      },
    );
  }
  let schemaText: string;
  try {
    schemaText = new TextDecoder("utf-8", { fatal: true }).decode(schemaBytes);
  } catch {
    throw new SpApiError("Amazon B2B seller-specific PTD schema 不是有效 UTF-8。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  let parsedSchema: unknown;
  try {
    parsedSchema = JSON.parse(schemaText);
  } catch {
    parsedSchema = null;
  }
  if (!isRecord(parsedSchema) || !isRecord(parsedSchema.properties)) {
    throw new SpApiError("Amazon B2B seller-specific PTD schema 格式無法辨識。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  const schema = parsedSchema;
  const capability = businessPricingCapabilityFromSchema(schema, checksum, {
    audience: "B2B",
    marketplaceId,
    currencyCode: marketplace.currency,
  });
  if (
    startedGeneration !== credentialGeneration ||
    getSellerId(marketplace.region) !== sellerId
  ) {
    throw new SpApiError(
      "Amazon 憑證或 Seller ID 已在 B2B PTD 查詢期間改變；舊結果已丟棄。",
      { status: 409, code: "CREDENTIALS_CHANGED" },
    );
  }
  businessPricingCapabilityCache.set(cacheKey, {
    expiresAt: Date.now() + 15 * 60_000,
    capability,
    schema,
  });
  return capability;
}

function normalizeListingContent(
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
  const title =
    attributeTextValuesForLanguage(
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
    itemHighlight:
      attributeTextValuesForLanguage(
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
    productDescription:
      attributeTextValuesForLanguage(
        payload,
        "product_description",
        marketplaceId,
        languageTag,
      )[0] ?? "",
    ingredients:
      attributeTextValuesForLanguage(
        payload,
        "ingredients",
        marketplaceId,
        languageTag,
      )[0] ?? "",
    languageTag,
    attributePresence: {
      title: attributeObjects(payload, "item_name", marketplaceId).length > 0,
      itemHighlight:
        attributeObjects(payload, "title_differentiation", marketplaceId).length > 0,
      bulletPoints:
        attributeObjects(payload, "bullet_point", marketplaceId).length > 0,
      productDescription:
        attributeObjects(payload, "product_description", marketplaceId).length > 0,
      ingredients:
        attributeObjects(payload, "ingredients", marketplaceId).length > 0,
    },
    capabilities,
    createdAt: summary?.createdDate ?? null,
    updatedAt: summary?.lastUpdatedDate ?? null,
    fetchedAt: new Date().toISOString(),
    requestId,
    issues: normalizeListingIssues(payload.issues),
    notice:
      noticeOverride ??
      (mode === "live"
        ? "內容取自你提交給 Amazon 的 Listing attributes；買家頁採用結果可能稍後更新。"
        : "展示內容只供操作測試，不會變更 Amazon。"),
  };
}

async function fetchLiveListingContent(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): Promise<ListingContentSnapshot> {
  return (await fetchLiveListingContentContext(marketplaceId, sellerSku, true))
    .listing;
}

async function fetchLiveListingContentContext(
  marketplaceId: MarketplaceId,
  sellerSku: string,
  allowReadOnlySchema = false,
): Promise<{
  listing: ListingContentSnapshot;
  payload: AmazonListingItem;
}> {
  const { payload, requestId } = await fetchLiveListingItem(
    marketplaceId,
    sellerSku,
  );
  assertFbaListingPayload(payload);
  const productType = listingProductType(payload, marketplaceId);
  let capabilityResult: ContentCapabilityResult;
  try {
    capabilityResult = await fetchContentCapabilities(
      marketplaceId,
      productType,
      { allowGenericFallback: allowReadOnlySchema },
    );
  } catch (error) {
    if (!allowReadOnlySchema || !(error instanceof SpApiError)) throw error;
    const reason =
      "Amazon 商品欄位規格暫時不可用；Listing 內容可唯讀，所有寫入已停用。";
    capabilityResult = {
      capabilities: readOnlyContentCapabilities(reason),
      degradedReason: reason,
    };
  }
  const notice = capabilityResult.degradedReason
    ? `${capabilityResult.degradedReason} 內容仍取自 Amazon Listing attributes。`
    : null;
  return {
    payload,
    listing: normalizeListingContent(
      payload,
      marketplaceId,
      requestId,
      capabilityResult.capabilities,
      "live",
      notice,
    ),
  };
}

async function executeListingsSearchRequest(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
  signal?: AbortSignal,
): Promise<ListingsSearchReadResult> {
  return searchListingsItems(listingsReadAdapter, {
    intent: "sku-batch",
    marketplaceId,
    sellerSkus,
    signal,
  });
}

/**
 * Verify the part of the SP-API connection that actually uses Seller ID and
 * Product Listing permissions. Orders API calls do not use the configured
 * Seller ID, so an Orders-only connection test can otherwise produce a false
 * green status while every Listings request fails.
 */
export async function verifyListingsAccess(
  marketplaceId: MarketplaceId,
): Promise<{ requestId: string | null; compatibilityFallback: boolean }> {
  if (shouldUseDemoMode(marketplaceId)) {
    return { requestId: null, compatibilityFallback: false };
  }
  const result = await searchListingsItems(listingsReadAdapter, {
    intent: "access-probe",
    marketplaceId,
  });
  if (result.status < 200 || result.status >= 300) {
    return throwListingsReadError(result, "searchListingsItems");
  }
  return {
    requestId: result.requestId,
    compatibilityFallback: result.profile === "minimal",
  };
}

async function fetchLiveListingBatch(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
): Promise<ListingBatchSnapshot> {
  const result = await executeListingsSearchRequest(marketplaceId, sellerSkus);
  if (result.status < 200 || result.status >= 300) {
    return throwListingsReadError(result, "searchListingsItems");
  }

  const payload = isRecord(result.envelope)
    ? result.envelope as AmazonListingSearchResponse
    : null;
  if (!payload || !Array.isArray(payload.items)) {
    throw new SpApiError("Amazon 回傳了無法辨識的批次 Listing 資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: result.requestId,
    });
  }
  if (
    Boolean(payload.pagination?.nextToken) ||
    (typeof payload.numberOfResults === "number" &&
      payload.numberOfResults !== payload.items.length)
  ) {
    throw new SpApiError(
      "Amazon 批次 Listing 回應含未完成分頁或列數不一致，已停止使用。",
      {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId: result.requestId,
      },
    );
  }
  const returnedSkus = new Set<string>();
  for (const item of payload.items) {
    const sellerSku = typeof item.sku === "string" ? item.sku : "";
    if (
      !sellerSkus.includes(sellerSku) ||
      returnedSkus.has(sellerSku) ||
      !exactListingEnvelopeIdentity(item, marketplaceId, sellerSku)
    ) {
      throw new SpApiError(
        "Amazon 批次 Listing 回應的 SKU、ASIN、商品類型或站點身分不完整，已停止使用。",
        {
          status: 409,
          code: "LISTING_IDENTITY_MISMATCH",
          requestId: result.requestId,
        },
      );
    }
    returnedSkus.add(sellerSku);
  }
  const normalized = payload.items
    .map((item) =>
      normalizeListingPrice(
        item,
        marketplaceId,
        result.requestId,
      ),
    )
    .filter(listingPriceIsFba);
  const bySku = new Map(normalized.map((item) => [item.sellerSku, item]));
  const items = sellerSkus
    .map((sellerSku) => bySku.get(sellerSku))
    .filter((item): item is ListingPriceSnapshot => Boolean(item));

  return {
    mode: "live",
    marketplaceId,
    requestedSkus: sellerSkus,
    items,
    notFound: sellerSkus.filter((sellerSku) => !bySku.has(sellerSku)),
    fetchedAt: new Date().toISOString(),
    requestId: result.requestId,
    rateLimit: result.rateLimit,
    notice: null,
  };
}

export const variationMoveGatewayProduction: VariationMoveGateway =
  createVariationMoveGatewayProduction({
    listings: listingsReadAdapter,
    resolveMode: (marketplaceId) =>
      shouldUseDemoMode(marketplaceId) ? "demo" : "live",
    credentialGeneration: () => credentialGeneration,
    readDemoFamily: getDemoVariationFamily,
    write: async (input) => {
      let response: Response;
      try {
        response = await executeListingsWriteRequest({
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          method: "PATCH",
          body: input.body,
          validationPreview: input.validationPreview,
          captureResponseJson: true,
          ...(input.fence
            ? { assertBeforeSend: () => input.fence!.assertCurrent() }
            : {}),
          ...(input.recordBeforeSend
            ? { recordBeforeSend: input.recordBeforeSend }
            : {}),
        });
      } catch (error) {
        if (
          input.validationPreview ||
          error instanceof SpApiPreCommitError ||
          (error instanceof SpApiError &&
            error.code === "UPDATE_STATUS_UNKNOWN")
        ) {
          throw error;
        }
        const cause = error instanceof SpApiError
          ? error
          : new SpApiError(
            "變體正式 PATCH 送出前的 Amazon transport 準備失敗。",
            {
              status: 500,
              code: "PRECOMMIT_FAILED",
              operation: "patchListingsItem",
            },
          );
        throw new SpApiPreCommitError(cause);
      }
      return {
        ok: response.ok,
        status: response.status,
        requestId: response.headers.get("x-amzn-requestid"),
        retryAfter: response.headers.get("retry-after"),
        payload: listingsWriteResponsePayloads.has(response)
          ? listingsWriteResponsePayloads.get(response) ?? null
          : null,
      };
    },
  });
function invalidSalesTrendRange(message: string): never {
  throw new SpApiError(message, {
    status: 400,
    code: "INVALID_SALES_TREND_RANGE",
  });
}

function planFbaSalesTrendOrThrow(
  input: Parameters<typeof planFbaSalesTrend>[0],
  now: Date,
): ReturnType<typeof planFbaSalesTrend> {
  try {
    return planFbaSalesTrend(input, now);
  } catch (error) {
    if (error instanceof FbaSalesPlanningError) {
      invalidSalesTrendRange(error.message);
    }
    throw error;
  }
}

function throwFbaSalesFacadeError(error: unknown): never {
  if (error instanceof FbaSalesPlanningError) {
    invalidSalesTrendRange(error.message);
  }
  if (error instanceof FbaSalesMetricsError) {
    throw new SpApiError(error.message, {
      status: error.status,
      code: error.code,
      requestId: error.requestId,
      retryAfter: error.retryAfter,
    });
  }
  throw error;
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const demoPriceOverrides = new Map<string, number>();
const demoBusinessPriceOverrides = new Map<string, number>();
const demoBusinessQuantityDiscountOverrides = new Map<
  string,
  BusinessQuantityDiscountPlan
>();
const demoSalePriceOverrides = new Map<
  string,
  { amount: number; startAt: string; endAt: string } | null
>();
const demoContentOverrides = new Map<string, ListingContentValues>();
const demoImageOverrides = new Map<string, Array<string | null>>();

function demoPriceKey(marketplaceId: MarketplaceId, sellerSku: string): string {
  return `${marketplaceId}:${sellerSku}`;
}

function demoBusinessPriceAmount(listing: ListingPriceSnapshot): number | null {
  if (!listing.standardPrice) return null;
  const key = demoPriceKey(listing.marketplaceId, listing.sellerSku);
  const override = demoBusinessPriceOverrides.get(key);
  if (override !== undefined) return override;
  const configuredByDefault = [...listing.sellerSku]
    .reduce((sum, character) => sum + character.codePointAt(0)!, 0) % 2 === 0;
  if (!configuredByDefault) return null;
  return Number((listing.standardPrice.amount * 0.9).toFixed(
    listing.standardPrice.currencyCode === "JPY" ? 0 : 2,
  ));
}

function getDemoListingPrice(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): ListingPriceSnapshot {
  const marketplace = MARKETPLACES[marketplaceId];
  const item = demoFbaCatalogRows(marketplaceId)
    .find((candidate) => candidate.sellerSku === sellerSku);

  if (!item) {
    const sampleSku =
      marketplaceById(marketplaceId)?.sampleSku ?? MARKETPLACE_METADATA[0].sampleSku;
    throw new SpApiError(
      `展示資料找不到這個 SKU。可先試用 ${sampleSku}。`,
      { status: 404, code: "SKU_NOT_FOUND" },
    );
  }

  const amount =
    demoPriceOverrides.get(demoPriceKey(marketplaceId, sellerSku)) ??
    item.unitAmount;
  const price = { amount, currencyCode: marketplace.currency };
  const saleKey = demoPriceKey(marketplaceId, sellerSku);
  const demoSale = demoSalePriceOverrides.has(saleKey)
    ? (demoSalePriceOverrides.get(saleKey) ?? null)
    : null;
  const discountedPrice: SalePriceSchedule | null = demoSale
    ? {
        price: {
          amount: demoSale.amount,
          currencyCode: marketplace.currency,
        },
        startAt: demoSale.startAt,
        endAt: demoSale.endAt,
      }
    : null;
  const isUnavailable = sellerSku.startsWith("ACTL") || sellerSku.startsWith("HERZ");
  const hasWarning = sellerSku.includes("285");
  const baseQuantity = isUnavailable
    ? 0
    : sellerSku.includes("285")
      ? 7
      : marketplaceId === JP_MARKETPLACE_ID
        ? 24
        : 38;
  const quantity = baseQuantity;
  const issues: ListingIssue[] = isUnavailable
    ? [
        {
          code: "DEMO_NO_INVENTORY",
          severity: "ERROR",
          message: "目前沒有可售庫存，商品暫時無法購買。",
          attributeNames: ["fulfillment_availability"],
        },
      ]
    : hasWarning
      ? [
          {
            code: "DEMO_ATTRIBUTE_WARNING",
            severity: "WARNING",
            message: "建議補充包裝尺寸，避免商品資訊不完整。",
            attributeNames: ["item_package_dimensions"],
          },
        ]
      : [];

  return {
    mode: "demo",
    marketplaceId,
    sellerSku,
    asin: item.asin,
    title: item.title,
    productType: "PET_SUPPLIES",
    status: isUnavailable ? ["DISCOVERABLE"] : ["BUYABLE", "DISCOVERABLE"],
    createdAt: isoHoursAgo(24 * 180),
    updatedAt: isoHoursAgo(hasWarning ? 72 : 12),
    standardPrice: price,
    effectivePrice: discountedPrice?.price ?? price,
    minimumPrice: null,
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice,
    discountedPricePresence: discountedPrice ? "valid" : "absent",
    hasDiscountedPrice: Boolean(discountedPrice),
    hasAutomatedPricing: false,
    fetchedAt: new Date().toISOString(),
    requestId: null,
    issues,
    fulfillmentAvailability: [
      {
        channelCode:
          marketplaceId === JP_MARKETPLACE_ID ? "AMAZON_JP" : "AMAZON_NA",
        quantity,
        fulfillment: "FBA",
        editable: false,
      },
    ],
    notice: "展示模式只會模擬價格與商品內容變更，不會更動 Amazon。",
  };
}

function demoVariationFamilies(marketplaceId: MarketplaceId): Array<{
  parentSku: string;
  theme: string;
  dimensionName: string;
  children: Array<{ sellerSku: string; value: string }>;
}> {
  return marketplaceId === JP_MARKETPLACE_ID
    ? [
        {
          parentSku: "DEMO-JP-TURKEY-PARENT",
          theme: "SIZE_NAME",
          dimensionName: "size_name",
          children: [
            { sellerSku: "AFA100-JP", value: "100 g" },
            { sellerSku: "AFA285-JP", value: "285 g" },
          ],
        },
        {
          parentSku: "DEMO-JP-CHICKEN-PARENT",
          theme: "SIZE_NAME",
          dimensionName: "size_name",
          children: [{ sellerSku: "GTC454-JP", value: "454 g" }],
        },
      ]
    : [
        {
          parentSku: "DEMO-US-TURKEY-PARENT",
          theme: "SIZE_NAME",
          dimensionName: "size_name",
          children: [
            { sellerSku: "AFA-TRKY-4OZ", value: "4 oz" },
            { sellerSku: "AFA-TRKY-285G", value: "10 oz" },
          ],
        },
        {
          parentSku: "DEMO-US-CHICKEN-PARENT",
          theme: "SIZE_NAME",
          dimensionName: "size_name",
          children: [{ sellerSku: "GTC-CHKN-1LB", value: "1 lb" }],
        },
      ];
}

function demoVariationChild(
  marketplaceId: MarketplaceId,
  family: ReturnType<typeof demoVariationFamilies>[number],
  child: { sellerSku: string; value: string },
): VariationFamilyMember {
  const listing = getDemoListingPrice(marketplaceId, child.sellerSku);
  return {
    sellerSku: child.sellerSku,
    asin: listing.asin,
    title: listing.title,
    productType: listing.productType,
    status: listing.status,
    role: "child",
    parentSku: family.parentSku,
    childSkus: [],
    variationTheme: family.theme,
    dimensions: [
      {
        name: family.dimensionName,
        label: "Size Name",
        values: [child.value],
      },
    ],
    fba: true,
    issues: listing.issues,
    relationshipSources: ["relationships", "attributes", "variationParentSku"],
  };
}

function demoVariationParent(
  marketplaceId: MarketplaceId,
  family: ReturnType<typeof demoVariationFamilies>[number],
): VariationFamilyMember {
  return {
    sellerSku: family.parentSku,
    asin: null,
    title: `${MARKETPLACES[marketplaceId].shortLabel} 展示 Parent 容器`,
    productType: "PET_SUPPLIES",
    status: [],
    role: "parent",
    parentSku: null,
    childSkus: family.children.map((child) => child.sellerSku),
    variationTheme: family.theme,
    dimensions: [
      { name: family.dimensionName, label: "Size Name", values: [] },
    ],
    fba: false,
    issues: [],
    relationshipSources: ["relationships", "attributes"],
  };
}

function getDemoVariationFamily(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): VariationFamilySnapshot {
  const families = demoVariationFamilies(marketplaceId);
  const family = families.find(
    (candidate) =>
      candidate.parentSku === sellerSku ||
      candidate.children.some((child) => child.sellerSku === sellerSku),
  );
  let queried: VariationFamilyMember;
  let parent: VariationFamilyMember | null = null;
  let children: VariationFamilyMember[] = [];
  if (family) {
    parent = demoVariationParent(marketplaceId, family);
    children = family.children.map((child) =>
      demoVariationChild(marketplaceId, family, child),
    );
    queried =
      sellerSku === family.parentSku
        ? parent
        : children.find((child) => child.sellerSku === sellerSku) ?? children[0];
  } else {
    const listing = getDemoListingPrice(marketplaceId, sellerSku);
    queried = {
      sellerSku,
      asin: listing.asin,
      title: listing.title,
      productType: listing.productType,
      status: listing.status,
      role: "standalone",
      parentSku: null,
      childSkus: [],
      variationTheme: null,
      dimensions: [],
      fba: true,
      issues: listing.issues,
      relationshipSources: [],
    };
  }
  return {
    mode: "demo",
    marketplaceId,
    queriedSku: sellerSku,
    queriedRole: queried.role,
    queried,
    parent,
    children,
    excludedChildren: [],
    variationTheme: family?.theme ?? null,
    dimensionNames: family ? [family.dimensionName] : [],
    familyComplete: true,
    fetchedAt: new Date().toISOString(),
    requestIds: [],
    writable: false,
    boundaries: [
      "展示 family 快照與預檢不會送出 PUT、PATCH 或 DELETE。",
      "既有子商品改掛另一個 parent 需要先移除舊關係再重建，屬於非原子流程。",
      "正式模式只允許固定的兩階段 Validation Preview、Notebook 鑰匙（Touch ID／Windows Hello）確認、持久防重送、單次 PATCH 與唯讀回查。",
      "Parent 僅作為不可售的唯讀容器例外；所有可拖移 child 都必須可確認為 FBA。",
    ],
    notice: "展示 family 只供拖拉規劃測試；Amazon 不會收到任何變更。",
  };
}

function demoCapability(
  options: Partial<ListingContentFieldCapability> = {},
): ListingContentFieldCapability {
  return {
    supported: true,
    editable: true,
    required: false,
    minItems: 1,
    maxItems: 1,
    minLength: 1,
    maxLength: 500,
    maxUtf8Bytes: null,
    languageTags: [],
    reason: null,
    ...options,
  };
}

function getDemoListingContent(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): ListingContentSnapshot {
  const listing = getDemoListingPrice(marketplaceId, sellerSku);
  const isJapan = marketplaceId === JP_MARKETPLACE_ID;
  const base: ListingContentValues = {
    title: listing.title,
    itemHighlight: isJapan
      ? "単一原料で仕上げた、噛みごたえのある毎日のおやつ。"
      : "Single-ingredient, naturally chewy rewards for everyday treating.",
    bulletPoints: isJapan
      ? [
          "厳選した単一原料を使用した、シンプルでおいしい犬用おやつです。",
          "噛みごたえのある食感で、毎日のごほうびに適しています。",
          "人工着色料・人工香料を使用していません。",
          "小分けしやすく、トレーニングにも便利です。",
          "品質管理された施設で丁寧に製造しています。",
        ]
      : [
          "Single-ingredient dog treats made with carefully selected cuts.",
          "Naturally chewy texture for a satisfying everyday reward.",
          "No artificial colors or artificial flavors.",
          "Easy to portion for training, walks, and enrichment.",
          "Prepared in a quality-controlled facility.",
        ],
    productDescription: isJapan
      ? "厳選した七面鳥の腱を使用し、素材本来の風味と噛みごたえを大切に仕上げた犬用おやつです。毎日のごほうびやトレーニングに合わせて与える量を調整してください。"
      : "A simple dog treat made from carefully selected turkey tendon. The naturally chewy texture makes it suitable for everyday rewards, training, walks, and enrichment. Portion appropriately for your dog's size and supervise while treating.",
    ingredients: isJapan ? "七面鳥腱。" : "Turkey tendon.",
  };
  const content =
    demoContentOverrides.get(demoPriceKey(marketplaceId, sellerSku)) ?? base;
  const languageTag = MARKETPLACES[marketplaceId].issueLocale;
  return {
    mode: "demo",
    marketplaceId,
    sellerSku,
    asin: listing.asin,
    productType: listing.productType,
    status: listing.status,
    title: content.title,
    itemHighlight: content.itemHighlight,
    bulletPoints: content.bulletPoints,
    productDescription: content.productDescription,
    ingredients: content.ingredients,
    languageTag,
    attributePresence: {
      title: true,
      itemHighlight: true,
      bulletPoints: true,
      productDescription: true,
      ingredients: true,
    },
    capabilities: {
      title: demoCapability({
        maxLength: 75,
        languageTags: [languageTag],
      }),
      itemHighlight: demoCapability({
        maxLength: 125,
        languageTags: [languageTag],
      }),
      bulletPoints: demoCapability({
        minItems: 1,
        maxItems: 5,
        maxLength: 500,
        languageTags: [languageTag],
      }),
      productDescription: demoCapability({
        maxLength: 10_000,
        languageTags: [languageTag],
      }),
      ingredients: demoCapability({
        maxLength: 5_000,
        languageTags: [languageTag],
      }),
      images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) => ({
        attributeName,
        label: index === 0 ? "主圖" : `副圖 ${index}`,
        supported: true,
        editable: true,
        required: index === 0,
        reason: null,
      })),
      schemaChecksum: "demo-schema",
    },
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
    fetchedAt: new Date().toISOString(),
    requestId: null,
    issues: listing.issues,
    notice: "展示內容只供操作測試，不會變更 Amazon。",
  };
}

function getDemoSubscribeAndSaveOffer(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): SubscribeAndSaveOfferSnapshot {
  assertSellerReplenishmentMarketplace(marketplaceId);
  const listing = getDemoListingPrice(marketplaceId, sellerSku);
  const fba = listing.fulfillmentAvailability.find(
    (availability) => availability.fulfillment === "FBA",
  );
  const found = Boolean(fba);
  const isJapan = marketplaceId === JP_MARKETPLACE_ID;
  const hasInventory = (fba?.quantity ?? 0) > 0;
  return {
    mode: "demo",
    marketplaceId,
    sellerSku,
    found,
    asin: found ? listing.asin : null,
    eligibility: found ? (hasInventory ? "ELIGIBLE" : "SUSPENDED") : null,
    enrollmentMethod: found ? "AUTOMATIC" : null,
    autoEnrollment: found ? "OPTED_IN" : null,
    sellerFundedBaseDiscount: found ? 5 : null,
    sellerFundedTieredDiscount: found ? 5 : null,
    amazonFundedBaseDiscount: found ? 0 : null,
    amazonFundedTieredDiscount: found ? 5 : null,
    price: found ? listing.standardPrice : null,
    inventory: found ? (fba?.quantity ?? null) : null,
    subscriptions: found ? (isJapan ? 19 : 42) : null,
    stockRisk: found ? (hasInventory ? "LOW" : "HIGH") : null,
    forecastDeliveries: found
      ? {
          next15Days: isJapan ? 7 : 14,
          next30Days: isJapan ? 13 : 27,
          next60Days: isJapan ? 26 : 53,
          next90Days: isJapan ? 38 : 78,
        }
      : null,
    deliveryConditions: found
      ? [
          {
            condition: hasInventory
              ? "NO_ISSUES_FOR_NEXT_30_DAYS_DELIVERIES"
              : "NEXT_30_DAYS_DELIVERIES_AT_LOW_INVENTORY_RISK",
            next30DaysDeliveries: isJapan ? 13 : 27,
          },
        ]
      : [],
    fetchedAt: new Date().toISOString(),
    requestId: null,
    rateLimit: "1 request/second",
    notice: found
      ? "展示資料模擬 Replenishment API；此頁不會變更 Amazon Subscribe & Save。"
      : "展示資料中，此 SKU 沒有 Subscribe & Save offer；真實模式會向 Amazon 查詢。",
    writable: false,
  };
}

export async function getSubscribeAndSaveOffer(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
}): Promise<SubscribeAndSaveOfferSnapshot> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    return getDemoSubscribeAndSaveOffer(
      input.marketplaceId,
      input.sellerSku,
    );
  }
  return readLiveSubscribeAndSaveOffer(input, {
    adapter: fbaInventoryReplenishmentAdapter,
  });
}

function demoSubscriptionAuditOffer(
  marketplaceId: MarketplaceId,
  index: number,
): Record<string, unknown> {
  const discount = [0, 5, 10, 15, 20][index] ?? 0;
  return {
    marketplaceId,
    programType: "SUBSCRIBE_AND_SAVE",
    sku: `DEMO-SNS-${index + 1}`,
    asin: `B${String(index + 1).padStart(9, "0")}`,
    eligibility: "ELIGIBLE",
    price: MARKETPLACES[marketplaceId].currency === "JPY"
      ? 1_980 + index * 100
      : 17.99 + index,
    priceCurrencyCode: MARKETPLACES[marketplaceId].currency,
    subscriptions: 12 + index * 7,
    inventory: 100 + index * 10,
    stockRisk: "LOW",
    offerProgramConfiguration: {
      enrollmentMethod: "MANUAL",
      preferences: { autoEnrollment: "OPTED_IN" },
      promotions: {
        sellingPartnerFundedBaseDiscount: { percentage: discount },
        sellingPartnerFundedTieredDiscount: { percentage: discount },
      },
    },
    forecastDeliveries: {
      next15DaysDeliveries: 3 + index,
      next30DaysDeliveries: 6 + index,
      next60DaysDeliveries: 12 + index,
      next90DaysDeliveries: 18 + index,
    },
    deliveriesConditions: [],
  };
}

async function getDemoSubscriptionAudit(
  marketplaceId: MarketplaceId,
  months: number,
  now: Date,
): Promise<SubscriptionAuditSnapshot> {
  const intervals = officialCompleteMonthlyIntervals(months, now);
  const offers = Array.from({ length: 5 }, (_, index) =>
    demoSubscriptionAuditOffer(marketplaceId, index),
  );
  const knownFbaSkus = new Set(offers.map((offer) => String(offer.sku)));
  const currentFba: CurrentFbaSkuEvidence = {
    knownFbaSkus,
    returnedInventoryRows: knownFbaSkus.size,
    unrecognizedSellerSkuRows: 0,
  };
  const audit = await fetchFbaSubscriptionAuditHistory({
    marketplaceId,
    metricIntervals: intervals,
    knownFbaSkus,
    now,
    transport: async (request) => {
      assertReplenishmentRequestBody(request);
      if (request.operation === "listOffers") {
        return { offers, pagination: { totalResults: offers.length } };
      }
      const filters = request.body.filters as Record<string, unknown>;
      const interval = filters.timeInterval as Record<string, unknown>;
      const month = String(interval.startDate).slice(0, 7);
      const monthIndex = intervals.findIndex((item) => item.month === month);
      const metricRows = offers
        // Deliberately omit one real datapoint to prove the renderer must not
        // manufacture a zero for a missing Amazon month.
        .filter((_offer, index) => !(index === 4 && monthIndex === 0))
        .map((offer, index) => ({
          marketplaceId,
          programType: "SUBSCRIBE_AND_SAVE",
          sku: offer.sku,
          asin: offer.asin,
          fulfillmentChannelType: "AMAZON",
          timeInterval: {
            startDate: interval.startDate,
            endDate: interval.endDate,
          },
          currencyCode: MARKETPLACES[marketplaceId].currency,
          totalSubscriptionsRevenue: 500 + monthIndex * 35 + index * 15,
          shippedSubscriptionUnits: 20 + monthIndex + index,
          activeSubscriptions: 12 + monthIndex + index * 7,
          notDeliveredDueToOOS: 0,
          lostRevenueDueToOOS: 0,
        }));
      return { offers: metricRows, pagination: { totalResults: metricRows.length } };
    },
  });
  return {
    ...audit,
    mode: "demo",
    marketplaceId,
    requestedMonths: months,
    fetchedAt: now.toISOString(),
    inventoryEvidence: subscriptionInventoryEvidence(
      currentFba,
      audit.offers.length,
    ),
    notice:
      "展示資料只用來驗證全站 FBA Subscribe & Save 健檢、FBA／offer 覆蓋、缺月與 Excel 流程；未取得可核對 offer（未回傳或資料值無法安全解析）不代表不符合資格或 0 訂閱，也不會連線或寫入 Amazon。",
  };
}

export async function getFbaSubscriptionAudit(input: {
  marketplaceId: MarketplaceId;
  months: number;
  now?: Date;
  signal?: AbortSignal;
}): Promise<SubscriptionAuditSnapshot> {
  assertNotAborted(input.signal);
  const now = input.now ? new Date(input.now.getTime()) : new Date();
  officialCompleteMonthlyIntervals(input.months, now);
  assertSellerReplenishmentMarketplace(input.marketplaceId);
  if (shouldUseDemoMode(input.marketplaceId)) {
    assertNotAborted(input.signal);
    return getDemoSubscriptionAudit(input.marketplaceId, input.months, now);
  }
  const { audit, currentFba, inventoryEvidence } =
    await readFbaSubscriptionAuditInputs(
      {
        marketplaceId: input.marketplaceId,
        months: input.months,
        now,
        signal: input.signal,
      },
      { adapter: fbaInventoryReplenishmentAdapter },
    );
  assertNotAborted(input.signal);
  return {
    ...audit,
    mode: "live",
    marketplaceId: input.marketplaceId,
    requestedMonths: input.months,
    fetchedAt: now.toISOString(),
    inventoryEvidence,
    notice: currentFba.unrecognizedSellerSkuRows > 0
      ? `本頁已完整讀取同次 FBA Inventory 分頁；其中 ${currentFba.unrecognizedSellerSkuRows} 列 Seller SKU 無法原樣辨識，已保留為覆蓋不完整，未 trim、改名、推定不符合資格或計為 0。其餘可原樣核對的 FBA SKU 照常比對；月度 PERFORMANCE 缺值維持缺值。`
      : "本頁以同次完整分頁 FBA Inventory API 作為總範圍，分開顯示可核對 Replenishment offer 與未取得可核對 offer（未回傳或資料值無法安全解析）的 FBA SKU；後者不代表不符合資格或 0 訂閱。Replenishment offers 全站只抓一次；月度 PERFORMANCE 缺值維持缺值，不補 0。",
  };
}

async function readListingPrice(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
}): Promise<ListingPriceSnapshot> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    return getDemoListingPrice(input.marketplaceId, input.sellerSku);
  }
  return fetchLiveListingPrice(input.marketplaceId, input.sellerSku);
}

export const listingPriceGatewayProduction: ListingPriceGateway = {
  mode: (marketplaceId) =>
    shouldUseDemoMode(marketplaceId) ? "demo" : "live",
  read: readListingPrice,
  setDemoStandardPrice: (input) => {
    demoPriceOverrides.set(
      demoPriceKey(input.marketplaceId, input.sellerSku),
      input.amount,
    );
  },
  setDemoSalePrice: (input) => {
    demoSalePriceOverrides.set(
      demoPriceKey(input.marketplaceId, input.sellerSku),
      input.schedule
        ? {
            amount: input.schedule.price.amount,
            startAt: input.schedule.startAt ?? "",
            endAt: input.schedule.endAt ?? "",
          }
        : null,
    );
  },
  validationPreview: async (input) => {
    const response = await executeListingsWriteRequest({
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      method: "PATCH",
      body: listingPricePatchBody(input),
      validationPreview: true,
    });
    return {
      ok: response.ok,
      status: response.status,
      requestId: response.headers.get("x-amzn-requestid"),
      retryAfter: response.headers.get("retry-after"),
      payload: await parseResponseJson<unknown>(response),
    };
  },
  commitOnce: async (input, fence) => {
    const response = await executeListingsWriteRequest({
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      method: "PATCH",
      body: listingPricePatchBody(input),
      assertBeforeSend: () => fence.assertCurrent(),
    });
    return {
      ok: response.ok,
      status: response.status,
      requestId: response.headers.get("x-amzn-requestid"),
      retryAfter: response.headers.get("retry-after"),
      payload: await parseResponseJson<unknown>(response),
    };
  },
};

async function fetchLiveBusinessPricing(
  input: { marketplaceId: MarketplaceId; sellerSku: string },
  options: { forceCapabilityRefresh?: boolean } = {},
): Promise<BusinessPricingListingSnapshot> {
  const { payload, requestId } = await fetchLiveListingItem(
    input.marketplaceId,
    input.sellerSku,
  );
  assertExactListingIdentity(
    payload,
    input.marketplaceId,
    input.sellerSku,
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
  const listing = normalizeListingPrice(payload, input.marketplaceId, requestId);
  const standardPrice = canonicalBusinessStandardPrice(
    payload,
    input.marketplaceId,
  );
  if (!standardPrice) {
    throw new SpApiError(
      "Amazon 一般售價不是唯一、無日期的標準價格，已停止 B2B 預檢。",
      { status: 409, code: "B2B_PRICE_EVIDENCE_INCOMPLETE" },
    );
  }
  const business = businessOfferSnapshot(payload, input.marketplaceId);
  const capability = await fetchBusinessPricingCapability(
    input.marketplaceId,
    listing.productType,
    { forceRefresh: options.forceCapabilityRefresh },
  );
  return {
    ...listing,
    standardPrice,
    ...business,
    businessPricingCapability: capability,
  };
}

function demoBusinessPricing(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): BusinessPricingListingSnapshot {
  const listing = getDemoListingPrice(marketplaceId, sellerSku);
  const amount = demoBusinessPriceAmount(listing);
  const quantityDiscountPlan = demoBusinessQuantityDiscountOverrides.get(
    demoPriceKey(marketplaceId, sellerSku),
  ) ?? null;
  const demoOffers: AmazonPurchasableOffer[] = amount
    ? [{
        marketplace_id: marketplaceId,
        currency: MARKETPLACES[marketplaceId].currency,
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
  }, marketplaceId);
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
}

export const businessPricingGatewayProduction: BusinessPricingGateway = {
  mode: (marketplaceId) =>
    shouldUseDemoMode(marketplaceId) ? "demo" : "live",
  read: async (identity, purpose) => {
    if (!shouldUseDemoMode(identity.marketplaceId)) {
      return fetchLiveBusinessPricing(identity, {
        forceCapabilityRefresh: purpose === "mutation",
      });
    }
    const startedGeneration = credentialGeneration;
    const snapshot = demoBusinessPricing(
      identity.marketplaceId,
      identity.sellerSku,
    );
    await Promise.resolve();
    if (startedGeneration !== credentialGeneration) {
      throw new SpApiError(
        "Amazon 憑證已在展示 B2B 價格讀取期間改變；舊結果已丟棄。",
        { status: 409, code: "CREDENTIALS_CHANGED" },
      );
    }
    return snapshot;
  },
  quantityDiscountPlanSupported: (input) => {
    if (shouldUseDemoMode(input.marketplaceId)) return true;
    const schema = cachedBusinessPricingSchema(
      input.marketplaceId,
      input.productType,
      input.schemaChecksum,
    );
    if (!schema) return false;
    return businessPricingCapabilityFromSchema(
      schema,
      input.schemaChecksum,
      {
        audience: "B2B",
        marketplaceId: input.marketplaceId,
        currencyCode: MARKETPLACES[input.marketplaceId].currency,
      },
      input.plan.levels,
    ).quantityDiscountsEditable;
  },
  validationPreview: async (patch) => {
    const response = await executeListingsWriteRequest({
      marketplaceId: patch.marketplaceId,
      sellerSku: patch.sellerSku,
      method: "PATCH",
      body: businessPricingPatchBody(patch),
      validationPreview: true,
      validationPreviewIdentifiers: true,
      captureResponseJson: true,
    });
    return {
      ok: response.ok,
      status: response.status,
      requestId: response.headers.get("x-amzn-requestid"),
      retryAfter: response.headers.get("retry-after"),
      payload: listingsWriteResponsePayloads.get(response) ?? null,
    };
  },
  commitOnce: async (patch, fence, recordDispatch) => {
    const response = await executeListingsWriteRequest({
      marketplaceId: patch.marketplaceId,
      sellerSku: patch.sellerSku,
      method: "PATCH",
      body: businessPricingPatchBody(patch),
      assertBeforeSend: () => fence.assertCurrent(),
      recordBeforeSend: recordDispatch,
      captureResponseJson: true,
    });
    return {
      ok: response.ok,
      status: response.status,
      requestId: response.headers.get("x-amzn-requestid"),
      retryAfter: response.headers.get("retry-after"),
      payload: listingsWriteResponsePayloads.get(response) ?? null,
    };
  },
  replaceDemoContribution: async (patch, fence) => {
    const startedGeneration = credentialGeneration;
    await fence.assertCurrent();
    if (startedGeneration !== credentialGeneration) {
      throw new SpApiError(
        "Amazon 憑證已在展示 B2B 價格更新期間改變；舊結果已丟棄。",
        { status: 409, code: "CREDENTIALS_CHANGED" },
      );
    }
    demoBusinessPriceOverrides.set(
      demoPriceKey(patch.marketplaceId, patch.sellerSku),
      patch.amount,
    );
    if (patch.kind === "combined") {
      demoBusinessQuantityDiscountOverrides.set(
        demoPriceKey(patch.marketplaceId, patch.sellerSku),
        {
          discountType: "percent",
          levels: patch.quantityDiscountPlan.levels.map((level) => ({
            lowerBound: level.lowerBound,
            value: level.value,
          })),
        },
      );
    }
  },
};

function demoBusinessPricingAuditData(
  marketplaceId: MarketplaceId,
  signal?: AbortSignal,
): BusinessPricingAuditSnapshot {
  assertNotAborted(signal);
  const listingData = demoAllListingsExportData(marketplaceId);
  const rows = listingData.rows.map((row) => {
      const listing = demoBusinessPricing(
        marketplaceId,
        row.sellerSku,
      );
      const status: BusinessPricingAuditRow["status"] =
        listing.businessOfferPresence === "present"
          ? listing.standardPrice && listing.businessPrice &&
              listing.businessPrice.amount > listing.standardPrice.amount
            ? "above_standard"
            : "configured"
          : listing.businessOfferPresence === "absent"
            ? "missing"
            : "incomplete";
      const auditRow = {
        sellerSku: listing.sellerSku,
        asin: listing.asin ?? "",
        title: listing.title,
        productType: listing.productType,
        standardPrice: listing.standardPrice,
        businessPrice: listing.businessPrice,
        businessOfferPresence: listing.businessOfferPresence,
        quantityDiscountPlan: listing.quantityDiscountPlan,
        quantityDiscountPlanPresence: listing.quantityDiscountPlanPresence,
        status,
        editable: false as const,
        reason: status === "above_standard"
          ? "Amazon Business 價格高於一般售價；展示資料僅供檢視，不會寫入 Amazon。"
          : status === "configured"
          ? "已設定 Amazon Business 價格；展示資料僅供檢視，不會寫入 Amazon。"
          : status === "missing"
            ? "尚未設定 Amazon Business 價格；展示資料僅供檢視，不會寫入 Amazon。"
            : "B2B offer 證據不完整，展示模式已停止編輯。",
      };
      return {
        ...auditRow,
        ...businessPricingRecommendationFlags({
          standardPrice: auditRow.standardPrice,
          businessPrice: auditRow.businessPrice,
          quantityDiscountPlan: auditRow.quantityDiscountPlan,
          quantityDiscountPlanPresence:
            auditRow.quantityDiscountPlanPresence,
        }),
      };
    });
  assertNotAborted(signal);
  return {
    mode: "demo",
    marketplaceId,
    fetchedAt: listingData.fetchedAt,
    rows,
    summary: summarizeBusinessPricingAuditRows(rows),
    notice: "展示快照只供 B2B 價格健檢版面與安全流程測試，不是 Amazon 真實 Business Price。",
  };
}

function resolveDemoSellerSkuByAsin(
  marketplaceId: MarketplaceId,
  asin: string,
): string {
  if (!/^[A-Z0-9]{10}$/u.test(asin)) {
    throw new SpApiError("ASIN 必須是原樣 10 碼大寫英數字。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  const sellerSkus = [
    ...new Set(
      demoFbaCatalogRows(marketplaceId)
        .filter((item) => item.asin === asin)
        .map((item) => item.sellerSku),
    ),
  ];
  if (sellerSkus.length === 0) {
    throw new SpApiError("展示資料找不到這個 ASIN。", {
      status: 404,
      code: "ASIN_NOT_FOUND",
    });
  }
  if (sellerSkus.length > 1) {
    throw new SpApiError(
      "展示 ASIN 對應多個 Seller SKU；請選擇確切 SKU。",
      { status: 409, code: "ASIN_AMBIGUOUS" },
    );
  }
  return sellerSkus[0]!;
}

export async function getVariationFamilyPlanner(input: {
  marketplaceId: MarketplaceId;
  sellerSku?: string;
  asin?: string;
}): Promise<VariationFamilySnapshot> {
  if (Boolean(input.sellerSku) === Boolean(input.asin)) {
    throw new SpApiError("變體 family 必須且只能提供 Seller SKU 或 ASIN 其中一項。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  if (shouldUseDemoMode(input.marketplaceId)) {
    const sellerSku = input.sellerSku ??
      resolveDemoSellerSkuByAsin(input.marketplaceId, input.asin!);
    return getDemoVariationFamily(input.marketplaceId, sellerSku);
  }
  const sellerSku = input.sellerSku ??
    await resolveVariationSellerSkuByAsin(listingsReadAdapter, {
      marketplaceId: input.marketplaceId,
      asin: input.asin!,
    });
  return readVariationFamily(listingsReadAdapter, {
    marketplaceId: input.marketplaceId,
    sellerSku,
  });
}

export async function searchListingsBySku(input: {
  marketplaceId: MarketplaceId;
  sellerSkus: string[];
}): Promise<ListingBatchSnapshot> {
  if (!input.sellerSkus.length || input.sellerSkus.length > 20) {
    throw new SpApiError("批次查詢一次必須包含 1 到 20 個 SKU。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  if (shouldUseDemoMode(input.marketplaceId)) {
    const items: ListingPriceSnapshot[] = [];
    const notFound: string[] = [];
    for (const sellerSku of input.sellerSkus) {
      try {
        items.push(getDemoListingPrice(input.marketplaceId, sellerSku));
      } catch (error) {
        if (error instanceof SpApiError && error.code === "SKU_NOT_FOUND") {
          notFound.push(sellerSku);
          continue;
        }
        throw error;
      }
    }
    return {
      mode: "demo",
      marketplaceId: input.marketplaceId,
      requestedSkus: input.sellerSkus,
      items,
      notFound,
      fetchedAt: new Date().toISOString(),
      requestId: null,
      rateLimit: null,
      notice: "展示資料只供操作測試，不會讀取或變更 Amazon。",
    };
  }
  return fetchLiveListingBatch(input.marketplaceId, input.sellerSkus);
}

function normalizeContentText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function normalizeContentValues(values: ListingContentValues): ListingContentValues {
  return {
    title: normalizeContentText(values.title),
    itemHighlight: normalizeContentText(values.itemHighlight),
    bulletPoints: values.bulletPoints
      .map(normalizeContentText)
      .filter(Boolean)
      .slice(0, 5),
    productDescription: normalizeContentText(values.productDescription),
    ingredients: normalizeContentText(values.ingredients),
  };
}

function sameTextArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function verifyContentLength(
  label: string,
  value: string,
  capability: ListingContentFieldCapability,
) {
  if (capability.minLength !== null && value.length < capability.minLength) {
    throw new SpApiError(`${label}至少需要 ${capability.minLength} 個字元。`, {
      status: 422,
      code: "CONTENT_LIMIT_EXCEEDED",
    });
  }
  if (capability.maxLength !== null && value.length > capability.maxLength) {
    throw new SpApiError(`${label}最多可輸入 ${capability.maxLength} 個字元。`, {
      status: 422,
      code: "CONTENT_LIMIT_EXCEEDED",
    });
  }
  if (
    capability.maxUtf8Bytes !== null &&
    new TextEncoder().encode(value).byteLength > capability.maxUtf8Bytes
  ) {
    throw new SpApiError(
      `${label}超過 Amazon 允許的 ${capability.maxUtf8Bytes} UTF-8 bytes。`,
      { status: 422, code: "CONTENT_LIMIT_EXCEEDED" },
    );
  }
}

function assertContentEditable(
  label: string,
  capability: ListingContentFieldCapability,
) {
  if (!capability.supported || !capability.editable) {
    throw new SpApiError(
      capability.reason || `${label}不支援由 API 修改。`,
      { status: 422, code: "CONTENT_FIELD_READ_ONLY" },
    );
  }
}

function verifyContentChange(
  listing: ListingContentSnapshot,
  input: UpdateListingContentInput,
): {
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: ListingContentField[];
} {
  const previous = normalizeContentValues({
    title: listing.title,
    itemHighlight: listing.itemHighlight,
    bulletPoints: listing.bulletPoints,
    productDescription: listing.productDescription,
    ingredients: listing.ingredients,
  });
  const expected = normalizeContentValues({
    title: input.expectedTitle,
    itemHighlight: input.expectedItemHighlight,
    bulletPoints: input.expectedBulletPoints,
    productDescription: input.expectedProductDescription,
    ingredients: input.expectedIngredients,
  });
  const requested = normalizeContentValues(input);
  if (
    previous.title !== expected.title ||
    previous.itemHighlight !== expected.itemHighlight ||
    !sameTextArray(previous.bulletPoints, expected.bulletPoints) ||
    previous.productDescription !== expected.productDescription ||
    previous.ingredients !== expected.ingredients
  ) {
    throw new SpApiError(
      "商品內容已在查詢後發生變動。請重新查詢 SKU，再確認一次。",
      { status: 409, code: "CONTENT_CHANGED" },
    );
  }

  const changedFields: ListingContentField[] = [];
  if (requested.title !== previous.title) changedFields.push("title");
  if (requested.itemHighlight !== previous.itemHighlight) {
    changedFields.push("itemHighlight");
  }
  if (!sameTextArray(requested.bulletPoints, previous.bulletPoints)) {
    changedFields.push("bulletPoints");
  }
  if (requested.productDescription !== previous.productDescription) {
    changedFields.push("productDescription");
  }
  if (requested.ingredients !== previous.ingredients) {
    changedFields.push("ingredients");
  }
  if (!changedFields.length) {
    throw new SpApiError("商品名稱、產品亮點、產品要點、產品敘述與成分都沒有變更。", {
      status: 400,
      code: "CONTENT_UNCHANGED",
    });
  }

  if (changedFields.includes("title")) {
    assertContentEditable("商品標題", listing.capabilities.title);
    if (!requested.title) {
      throw new SpApiError("商品標題不可留白。", {
        status: 422,
        code: "CONTENT_REQUIRED",
      });
    }
    verifyContentLength("商品標題", requested.title, listing.capabilities.title);
  }
  if (changedFields.includes("itemHighlight")) {
    const capability = listing.capabilities.itemHighlight;
    assertContentEditable("產品亮點", capability);
    if (!requested.itemHighlight) {
      throw new SpApiError("產品亮點不可直接清空；請輸入更新後內容。", {
        status: 422,
        code: "CONTENT_REQUIRED",
      });
    }
    verifyContentLength("產品亮點", requested.itemHighlight, capability);
  }
  if (changedFields.includes("bulletPoints")) {
    const capability = listing.capabilities.bulletPoints;
    assertContentEditable("五大賣點", capability);
    const minimum = Math.max(1, capability.minItems ?? 1);
    const maximum = Math.min(5, capability.maxItems ?? 5);
    if (
      requested.bulletPoints.length < minimum ||
      requested.bulletPoints.length > maximum
    ) {
      throw new SpApiError(
        `此商品類型需要 ${minimum} 到 ${maximum} 個賣點。`,
        { status: 422, code: "CONTENT_LIMIT_EXCEEDED" },
      );
    }
    requested.bulletPoints.forEach((value, index) =>
      verifyContentLength(`賣點 ${index + 1}`, value, capability));
  }
  if (changedFields.includes("productDescription")) {
    const capability = listing.capabilities.productDescription;
    assertContentEditable("產品敘述", capability);
    if (!requested.productDescription) {
      throw new SpApiError("產品敘述不可直接清空；請輸入更新後內容。", {
        status: 422,
        code: "CONTENT_REQUIRED",
      });
    }
    verifyContentLength("產品敘述", requested.productDescription, capability);
  }
  if (changedFields.includes("ingredients")) {
    const capability = listing.capabilities.ingredients;
    assertContentEditable("成分", capability);
    if (!requested.ingredients) {
      throw new SpApiError(
        "為避免誤刪法規相關資料，成分不可直接清空；請輸入更新後內容。",
        { status: 422, code: "CONTENT_REQUIRED" },
      );
    }
    verifyContentLength("成分", requested.ingredients, capability);
  }
  return { previous, requested, changedFields };
}

function buildContentPatch(
  payload: AmazonListingItem,
  listing: ListingContentSnapshot,
  requested: ListingContentValues,
  changedFields: ListingContentField[],
): { productType: string; patches: unknown[] } {
  const value = (text: string) => ({
    value: text,
    language_tag: listing.languageTag,
    marketplace_id: listing.marketplaceId,
  });
  const attributeValue = (
    attributeName: ListingContentAttributeName,
    label: string,
    texts: string[],
  ) => {
    const existing = attributeObjects(
      payload,
      attributeName,
      listing.marketplaceId,
    );
    if (
      existing.some(
        (item) =>
          typeof item.language_tag !== "string" || !item.language_tag.trim(),
      )
    ) {
      throw new SpApiError(
        `${label}的現有語系標記不完整，為避免覆蓋其他內容，請先到 Seller Central 檢查。`,
        { status: 422, code: "CONTENT_SELECTOR_UNSAFE" },
      );
    }
    const selectedLanguageValues = existing.filter(
      (item) => item.language_tag === listing.languageTag,
    );
    if (
      attributeName === "bullet_point" &&
      selectedLanguageValues.length > 5
    ) {
      throw new SpApiError(
        "此語系目前有超過 5 個賣點，簡易編輯器不會自動刪除多出的內容；請先到 Seller Central 檢查。",
        { status: 422, code: "CONTENT_SELECTOR_UNSAFE" },
      );
    }
    const preservedLanguages = existing.filter(
      (item) => item.language_tag !== listing.languageTag,
    );
    return {
      exists: existing.length > 0,
      values: [...preservedLanguages, ...texts.map(value)],
    };
  };
  const patches: unknown[] = [];
  if (changedFields.includes("title")) {
    const next = attributeValue("item_name", "商品標題", [requested.title]);
    patches.push({
      op: next.exists ? "replace" : "add",
      path: "/attributes/item_name",
      value: next.values,
    });
  }
  if (changedFields.includes("itemHighlight")) {
    const next = attributeValue(
      "title_differentiation",
      "產品亮點",
      [requested.itemHighlight],
    );
    patches.push({
      op: next.exists ? "replace" : "add",
      path: "/attributes/title_differentiation",
      value: next.values,
    });
  }
  if (changedFields.includes("bulletPoints")) {
    const next = attributeValue(
      "bullet_point",
      "五大賣點",
      requested.bulletPoints,
    );
    patches.push({
      op: next.exists ? "replace" : "add",
      path: "/attributes/bullet_point",
      value: next.values,
    });
  }
  if (changedFields.includes("productDescription")) {
    const next = attributeValue(
      "product_description",
      "產品敘述",
      [requested.productDescription],
    );
    patches.push({
      op: next.exists ? "replace" : "add",
      path: "/attributes/product_description",
      value: next.values,
    });
  }
  if (changedFields.includes("ingredients")) {
    const next = attributeValue("ingredients", "成分", [requested.ingredients]);
    patches.push({
      op: next.exists ? "replace" : "add",
      path: "/attributes/ingredients",
      value: next.values,
    });
  }
  return { productType: listing.productType, patches };
}

async function prepareLiveContentUpdate(
  input: UpdateListingContentInput,
): Promise<{
  listing: ListingContentSnapshot;
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: ListingContentField[];
  body: { productType: string; patches: unknown[] };
  issues: ListingIssue[];
}> {
  const context = await fetchLiveListingContentContext(
    input.marketplaceId,
    input.sellerSku,
  );
  const listing = context.listing;
  const verified = verifyContentChange(listing, input);
  const body = buildContentPatch(
    context.payload,
    listing,
    verified.requested,
    verified.changedFields,
  );
  const response = await executeListingsWriteRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body,
    validationPreview: true,
  });
  if (!response.ok) {
    return throwListingsError(response, "read", "patchListingsItemPreview");
  }
  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError("Amazon 回傳了無法辨識的商品內容預檢結果。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  const issues = normalizeListingIssues(payload.issues);
  if (
    payload.status === "INVALID" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 商品內容預檢未通過，尚未寫入任何變更。",
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }
  if (payload.status !== "VALID") {
    throw new SpApiError(
      "Amazon 預檢沒有回傳明確的 VALID 狀態，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }
  return { listing, ...verified, body, issues };
}

export async function getListingContent(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
}): Promise<ListingContentSnapshot> {
  return shouldUseDemoMode(input.marketplaceId)
    ? getDemoListingContent(input.marketplaceId, input.sellerSku)
    : fetchLiveListingContent(input.marketplaceId, input.sellerSku);
}

function listingImageUrl(
  payload: AmazonListingItem,
  attributeName: string,
  marketplaceId: MarketplaceId,
): string | null {
  const raw = payload.attributes?.[attributeName];
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) {
    throw new SpApiError(
      "Amazon 圖片欄位不是可精確核對的 current-market locator 陣列，已停止使用。",
      { status: 409, code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" },
    );
  }
  const currentMarket: string[] = [];
  for (const item of raw) {
    if (!isRecord(item) ||
        typeof item.marketplace_id !== "string" ||
        !item.marketplace_id.trim() ||
        item.marketplace_id !== item.marketplace_id.trim() ||
        !marketplaceById(item.marketplace_id)) {
      throw new SpApiError(
        "Amazon 圖片欄位含有無法確認站點的 locator，已停止使用。",
        { status: 409, code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" },
      );
    }
    if (item.marketplace_id !== marketplaceId) continue;
    if (typeof item.media_location !== "string" ||
        !item.media_location.trim() ||
        item.media_location !== item.media_location.trim()) {
      throw new SpApiError(
        "Amazon 圖片欄位含有無法精確核對的 locator，已停止使用。",
        { status: 409, code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" },
      );
    }
    currentMarket.push(item.media_location);
  }
  if (currentMarket.length > 1) {
    throw new SpApiError(
      "Amazon 同一圖片位置回傳多個 current-market locator，已停止預檢與回查。",
      { status: 409, code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" },
    );
  }
  return currentMarket[0] ?? null;
}

function normalizeImageUrls(values: Array<string | null>): Array<string | null> {
  return IMAGE_ATTRIBUTE_NAMES.map((_, index) => {
    const value = values[index];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  });
}

function imageSnapshotFromContext(
  listing: ListingContentSnapshot,
  payload?: AmazonListingItem,
): ListingImageSnapshot {
  const override = demoImageOverrides.get(
    demoPriceKey(listing.marketplaceId, listing.sellerSku),
  );
  const urls = payload
    ? IMAGE_ATTRIBUTE_NAMES.map((name) =>
        listingImageUrl(payload, name, listing.marketplaceId),
      )
    : normalizeImageUrls(override ?? []);
  return {
    mode: listing.mode,
    marketplaceId: listing.marketplaceId,
    sellerSku: listing.sellerSku,
    asin: listing.asin,
    productType: listing.productType,
    title: listing.title,
    attributesPresent: listing.mode === "demo" || isRecord(payload?.attributes),
    images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) => ({
      attributeName,
      label: index === 0 ? "主圖" : `副圖 ${index}`,
      url: urls[index] ?? null,
      capability: listing.capabilities.images[index] ?? {
        attributeName,
        label: index === 0 ? "主圖" : `副圖 ${index}`,
        supported: false,
        editable: false,
        required: false,
        reason: "Amazon 商品類型規格未提供此圖片欄位。",
      },
    })),
    fetchedAt: listing.fetchedAt,
    requestId: listing.requestId,
    issues: listing.issues,
    notice:
      listing.notice?.includes("寫入已停用")
        ? listing.notice
        : listing.mode === "live"
          ? "圖片 URL 取自 Listing attributes；Amazon 接受後仍會非同步下載與審核。"
          : "展示模式可測試排序與預檢，不會更動 Amazon。",
  };
}

type ProductionListingImageEvidence = Readonly<{
  mode: "live" | "demo";
  purpose: "read-only" | "mutation";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string;
  previousUrls: ListingImageUrlVector;
  generation: number;
  payload: AmazonListingItem | null;
}>;

const listingImageEvidence = new WeakMap<object, ProductionListingImageEvidence>();

function imageUrlVector(
  values: readonly (string | null)[],
): ListingImageUrlVector {
  return normalizeImageUrls([...values]) as unknown as ListingImageUrlVector;
}

function imageExpectedOldHash(values: ListingImageUrlVector): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function mintListingImageEvidence(
  evidence: ProductionListingImageEvidence,
): ListingImageSourceEvidence {
  const token = Object.freeze(Object.create(null)) as object;
  listingImageEvidence.set(token, evidence);
  return token as ListingImageSourceEvidence;
}

function listingImageGatewayObservation(
  snapshot: ListingImageSnapshot,
  input: Readonly<{
    purpose: "read-only" | "mutation";
    payload: AmazonListingItem | null;
  }>,
): ListingImageGatewayRead {
  const previousUrls = imageUrlVector(
    snapshot.images.map((image) => image.url),
  );
  return {
    snapshot,
    fulfillment: "FBA",
    sourceEvidence: mintListingImageEvidence({
      mode: snapshot.mode,
      purpose: input.purpose,
      marketplaceId: snapshot.marketplaceId,
      sellerSku: snapshot.sellerSku,
      asin: snapshot.asin,
      productType: snapshot.productType,
      previousUrls,
      generation: credentialGeneration,
      payload: input.payload,
    }),
  };
}

function exactImagePatchChanges(
  patch: ListingImagePatchDescriptor,
): boolean {
  if (patch.previousUrls.length !== IMAGE_ATTRIBUTE_NAMES.length ||
      patch.requestedUrls.length !== IMAGE_ATTRIBUTE_NAMES.length ||
      !patch.previousUrls.every((value) =>
        value === null || typeof value === "string") ||
      !patch.requestedUrls.every((value) =>
        value === null || typeof value === "string") ||
      patch.changes.length === 0) return false;
  const expectedSlots = patch.requestedUrls.flatMap((url, index) =>
    url === patch.previousUrls[index] ? [] : [index]
  );
  return patch.changes.length === expectedSlots.length &&
    patch.changes.every((change, index) =>
      change.slot === expectedSlots[index] &&
      change.previousUrl === patch.previousUrls[change.slot] &&
      change.requestedUrl === patch.requestedUrls[change.slot]
    );
}

function resolveListingImageEvidence(
  patch: ListingImagePatchDescriptor,
  expectedMode: "live" | "demo",
): ProductionListingImageEvidence {
  const evidence = listingImageEvidence.get(patch.sourceEvidence as object);
  if (evidence && evidence.generation !== credentialGeneration) {
    throw new SpApiError(
      "Amazon 執行環境已在商品圖片操作期間改變；舊證據已丟棄。",
      { status: 409, code: "CREDENTIALS_CHANGED" },
    );
  }
  if (!evidence ||
      evidence.purpose !== "mutation" ||
      evidence.mode !== expectedMode ||
      evidence.marketplaceId !== patch.marketplaceId ||
      evidence.sellerSku !== patch.sellerSku ||
      evidence.asin !== patch.asin ||
      evidence.productType !== patch.productType ||
      patch.expectedOldHash !== imageExpectedOldHash(evidence.previousUrls) ||
      JSON.stringify(patch.previousUrls) !==
        JSON.stringify(evidence.previousUrls) ||
      !exactImagePatchChanges(patch)) {
    throw new SpApiError(
      "商品圖片來源證據已失效或與這次 SKU／圖片位置不一致，請重新預檢。",
      { status: 409, code: "LISTING_IMAGE_EVIDENCE_INVALID" },
    );
  }
  return evidence;
}

function listingImageGatewayPatchBody(
  patch: ListingImagePatchDescriptor,
  evidence: ProductionListingImageEvidence,
): Readonly<{ productType: string; patches: unknown[] }> {
  return {
    productType: patch.productType,
    patches: patch.changes.map((change) => {
      const attributeName = IMAGE_ATTRIBUTE_NAMES[change.slot];
      if (change.requestedUrl === null) {
        const existing = evidence.payload
          ? attributeObjects(
              evidence.payload,
              attributeName,
              patch.marketplaceId,
            )
          : [];
        return {
          op: "delete",
          path: `/attributes/${attributeName}`,
          value: existing.length
            ? existing
            : [{
                media_location: change.previousUrl,
                marketplace_id: patch.marketplaceId,
              }],
        };
      }
      return {
        op: change.previousUrl ? "replace" : "add",
        path: `/attributes/${attributeName}`,
        value: [{
          media_location: change.requestedUrl,
          marketplace_id: patch.marketplaceId,
        }],
      };
    }),
  };
}

async function listingImageGatewayReply(
  response: Response,
): Promise<ListingImageGatewayReply> {
  return {
    ok: response.ok,
    status: response.status,
    requestId: response.headers.get("x-amzn-requestid"),
    retryAfter: response.headers.get("retry-after"),
    payload: await parseResponseJson<unknown>(response),
  };
}

export const listingImageGatewayProduction: ListingImageGateway = {
  mode: (marketplaceId) =>
    shouldUseDemoMode(marketplaceId) ? "demo" : "live",
  read: async (identity, purpose) => {
    if (shouldUseDemoMode(identity.marketplaceId)) {
      return listingImageGatewayObservation(
        imageSnapshotFromContext(
          getDemoListingContent(identity.marketplaceId, identity.sellerSku),
        ),
        { purpose, payload: null },
      );
    }
    const context = await fetchLiveListingContentContext(
      identity.marketplaceId,
      identity.sellerSku,
      purpose === "read-only",
    );
    return listingImageGatewayObservation(
      imageSnapshotFromContext(context.listing, context.payload),
      { purpose, payload: context.payload },
    );
  },
  validationPreview: async (patch) => {
    const evidence = resolveListingImageEvidence(patch, "live");
    const response = await executeListingsWriteRequest({
      marketplaceId: patch.marketplaceId,
      sellerSku: patch.sellerSku,
      method: "PATCH",
      body: listingImageGatewayPatchBody(patch, evidence),
      validationPreview: true,
    });
    return listingImageGatewayReply(response);
  },
  commitOnce: async (patch, fence) => {
    const evidence = resolveListingImageEvidence(patch, "live");
    const response = await executeListingsWriteRequest({
      marketplaceId: patch.marketplaceId,
      sellerSku: patch.sellerSku,
      method: "PATCH",
      body: listingImageGatewayPatchBody(patch, evidence),
      assertBeforeSend: () => fence.assertCurrent(),
    });
    return listingImageGatewayReply(response);
  },
  replaceDemoImages: async (patch, fence) => {
    const evidence = resolveListingImageEvidence(patch, "demo");
    await fence.assertCurrent();
    if (evidence.generation !== credentialGeneration) {
      throw new SpApiError(
        "Amazon 執行環境已在展示圖片更新期間改變；舊結果已丟棄。",
        { status: 409, code: "CREDENTIALS_CHANGED" },
      );
    }
    demoImageOverrides.set(
      demoPriceKey(patch.marketplaceId, patch.sellerSku),
      [...patch.requestedUrls],
    );
  },
};

export async function previewListingContentUpdate(
  input: UpdateListingContentInput,
): Promise<ListingContentValidationResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const listing = getDemoListingContent(input.marketplaceId, input.sellerSku);
    const verified = verifyContentChange(listing, input);
    return {
      mode: "demo",
      status: "SIMULATED",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      ...verified,
      validatedAt: new Date().toISOString(),
      issues: [],
      notice: "展示預檢已通過；最終按鈕只會模擬，不會寫入 Amazon。",
    };
  }
  const prepared = await prepareLiveContentUpdate(input);
  return {
    mode: "live",
    status: "VALID",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    previous: prepared.previous,
    requested: prepared.requested,
    changedFields: prepared.changedFields,
    validatedAt: new Date().toISOString(),
    issues: prepared.issues,
    notice: prepared.issues.length
      ? "Amazon 預檢通過，但有警告需要確認。"
      : "Amazon 預檢通過，尚未寫入商品內容。",
  };
}

export async function updateListingContent(
  input: UpdateListingContentInput,
  fence?: ListingWriteExecutionFence,
): Promise<ListingContentUpdateResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const listing = getDemoListingContent(input.marketplaceId, input.sellerSku);
    const verified = verifyContentChange(listing, input);
    demoContentOverrides.set(
      demoPriceKey(input.marketplaceId, input.sellerSku),
      verified.requested,
    );
    return {
      mode: "demo",
      status: "SIMULATED",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      ...verified,
      acceptedAt: new Date().toISOString(),
      submissionId: null,
      requestId: null,
      issues: [],
      notice: "模擬商品內容更新完成；Amazon 真實內容沒有變更。",
    };
  }

  const prepared = await prepareListingCommit(
    () => prepareLiveContentUpdate(input),
    "商品內容正式寫入前的重新讀取或 Validation Preview 失敗。",
  );
  const response = await executeListingsWriteRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body: prepared.body,
    ...(fence
      ? { assertBeforeSend: () => fence.assertCurrent() }
      : {}),
  });
  if (!response.ok) {
    return throwListingsError(response, "write", "patchListingsItem");
  }
  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError(
      "Amazon 已收到請求，但回應無法辨識。請重新查詢 SKU 確認商品內容。",
      {
        status: 502,
        code: "UPDATE_STATUS_UNKNOWN",
        requestId: response.headers.get("x-amzn-requestid"),
      },
    );
  }
  const issues = normalizeListingIssues(payload.issues);
  if (
    payload.status !== "ACCEPTED" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 未接受這次商品內容更新。",
      {
        status: 422,
        code: "UPDATE_REJECTED",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }
  return {
    mode: "live",
    status: "ACCEPTED",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    previous: prepared.previous,
    requested: prepared.requested,
    changedFields: prepared.changedFields,
    acceptedAt: new Date().toISOString(),
    submissionId: payload.submissionId ?? null,
    requestId: response.headers.get("x-amzn-requestid"),
    issues,
    notice:
      "Amazon 已接受商品內容更新；重新查詢看到新內容且沒有 ERROR 才代表完成。",
  };
}

function demoAllListingsExportData(
  marketplaceId: MarketplaceId,
): {
  rows: ListingExportRow[];
  errors: ListingExportError[];
  fetchedAt: string;
} {
  const sellerSkus = [
    ...new Set(
      demoFbaCatalogRows(marketplaceId)
        .map((item) => item.sellerSku),
    ),
  ];
  const rows = sellerSkus.map((sellerSku, index) => {
    const listing = getDemoListingContent(marketplaceId, sellerSku);
    return {
      marketplace: MARKETPLACES[marketplaceId].name,
      sellerSku,
      asin: listing.asin ?? "",
      productType: listing.productType,
      title: listing.title,
      itemHighlight: listing.itemHighlight,
      bulletPoints: listing.bulletPoints,
      productDescription: listing.productDescription,
      ingredients: listing.ingredients,
      imageUrls: Array.from(
        { length: index === 0 ? 4 : 7 },
        (_, imageIndex) =>
          `https://images.example.invalid/${encodeURIComponent(sellerSku)}/${imageIndex + 1}.jpg`,
      ),
      status: listing.status.join(", "),
      updatedAt: listing.updatedAt ?? "",
      readStatus: "complete" as const,
      readErrors: [],
    };
  });
  return { rows, errors: [], fetchedAt: new Date().toISOString() };
}

function demoFbaCatalogIdentity(
  marketplaceId: MarketplaceId,
  signal?: AbortSignal,
): FbaListingIdentitySnapshot {
  assertNotAborted(signal);
  const data = demoAllListingsExportData(marketplaceId);
  return {
    mode: "demo",
    marketplaceId,
    fetchedAt: data.fetchedAt,
    rows: data.rows.map(({ sellerSku, asin, title }) => ({
      sellerSku,
      asin,
      title,
    })),
    notice: "展示資料只供廣告策略表版面測試，不是你的真實 FBA 商品。",
  };
}

export const catalogReportsDemoSource: FbaCatalogReportsDemoSource = {
  export: ({ marketplaceId, signal }) => {
    assertNotAborted(signal);
    return demoAllListingsExportData(marketplaceId);
  },
  identity: ({ marketplaceId, signal }) =>
    demoFbaCatalogIdentity(marketplaceId, signal),
  seeds: ({ marketplaceId, signal }) => {
    assertNotAborted(signal);
    return demoAllListingsExportData(marketplaceId).rows.map(
      ({ sellerSku, asin, title }) => ({ sellerSku, asin, title }),
    );
  },
  businessPricingAudit: ({ marketplaceId, signal }) =>
    demoBusinessPricingAuditData(marketplaceId, signal),
};

export type FbaVariationGroupingRow = VariationGroupingRow<ListingExportRow>;
export type FbaVariationGroupingData = VariationGroupingData<ListingExportRow>;
export type {
  UnboundVariationSearchBatchResult,
  VerifiedFbaVariationRelationshipRow,
} from "./variation-catalog-reads";

function incompleteDemoVariationGroupingRow(
  row: ListingExportRow,
  message: string,
): FbaVariationGroupingRow {
  return {
    ...row,
    role: "unknown",
    parentSku: null,
    familyKey: row.sellerSku,
    theme: null,
    status: "incomplete",
    message,
  };
}

/**
 * Keeps demo selection and environment ownership in the facade while the live
 * catalog relationship read is delegated to the fixed semantic module.
 */
export async function getFbaVariationGroupingData(input: {
  marketplaceId: MarketplaceId;
  rows: readonly ListingExportRow[];
  signal?: AbortSignal;
  onProgress?: (progress: Readonly<{
    completedBatches: number;
    totalBatches: number;
  }>) => void | Promise<void>;
}): Promise<FbaVariationGroupingData> {
  assertNotAborted(input.signal);
  if (shouldUseDemoMode(input.marketplaceId)) {
    const seenSellerSkus = new Set<string>();
    const rows = input.rows.map((row) => {
      assertNotAborted(input.signal);
      if (seenSellerSkus.has(row.sellerSku)) {
        throw new SpApiError("全商品匯出含有重複 Seller SKU，已停止變體分組。", {
          status: 409,
          code: "PAGINATION_CHANGED",
        });
      }
      seenSellerSkus.add(row.sellerSku);
      try {
        const member = getDemoVariationFamily(
          input.marketplaceId,
          row.sellerSku,
        ).queried;
        if (
          member.sellerSku !== row.sellerSku ||
          (member.asin ?? "") !== row.asin
        ) {
          return incompleteDemoVariationGroupingRow(
            row,
            "展示 relationships 的 SKU／ASIN 與匯出列不一致；未建立 family 分組。",
          );
        }
        return completeVariationGroupingRow(row, member);
      } catch (error) {
        return incompleteDemoVariationGroupingRow(
          row,
          error instanceof SpApiError
            ? error.message
            : "展示 relationships 無法安全判定。",
        );
      }
    });
    return {
      marketplaceId: input.marketplaceId,
      fetchedAt: new Date().toISOString(),
      rows,
      notice:
        "展示資料沿用內建 parent／child relationships；不以商品名稱或 ASIN 相似度猜測 family。",
    };
  }
  return readLiveFbaVariationGroupingData(listingsReadAdapter, input);
}

function demoUnboundVariationAuditSnapshot(input: {
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}): UnboundVariationAuditSnapshot {
  const sellerSkus = [
    ...new Set(
      demoFbaCatalogRows(input.marketplaceId)
        .map((item) => item.sellerSku),
    ),
  ];
  const rows: UnboundVariationAuditRow[] = [];
  const verifiedVariationMembers: VerifiedVariationFamilyMember[] = [];
  let boundChildren = 0;
  let parentContainers = 0;
  for (const sellerSku of sellerSkus) {
    assertNotAborted(input.signal);
    const family = getDemoVariationFamily(input.marketplaceId, sellerSku);
    verifiedVariationMembers.push({
      sellerSku: family.queried.sellerSku,
      title: family.queried.title,
      productType: family.queried.productType,
      role: family.queried.role,
      parentSku: family.queried.parentSku,
      variationTheme: family.queried.variationTheme,
    });
    if (family.queried.role === "standalone") {
      rows.push({
        sellerSku,
        asin: family.queried.asin ?? "",
        title: family.queried.title,
        productType: family.queried.productType,
        relationshipEvidence: "relationships",
        notice: "展示 relationships 明確沒有 parent；不會寫入 Amazon。",
      });
    } else if (family.queried.role === "child") {
      boundChildren += 1;
    } else {
      parentContainers += 1;
    }
  }
  return {
    mode: "demo",
    marketplaceId: input.marketplaceId,
    fetchedAt: new Date().toISOString(),
    rows,
    incompleteRows: [],
    allVariationRows: buildAllVariationFamilyRows(verifiedVariationMembers),
    summary: {
      totalFbaListings: sellerSkus.length,
      completed: sellerSkus.length,
      unbound: rows.length,
      boundChildren,
      parentContainers,
      incomplete: 0,
    },
    notice:
      "展示結果只驗證流程；正式模式會以官方 searchListingsItems 每批最多 20 個 SKU 要求 Amazon relationships 證據。",
  };
}

export function getDemoUnboundVariationAuditData(input: {
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}): UnboundVariationAuditSnapshot {
  return demoUnboundVariationAuditSnapshot(input);
}

export async function getSalesTrend(input: {
  marketplaceId: MarketplaceId;
  days?: SalesTrendPresetDays | null;
  startDate?: string | null;
  endDate?: string | null;
  comparison?: SalesTrendComparisonMode;
}): Promise<SalesTrendSnapshot> {
  const demoMode = shouldUseDemoMode(input.marketplaceId);
  const adapter = demoMode
    ? createDeterministicFbaSalesMetricsDemoAdapter()
    : createFbaSalesMetricsProductionAdapter({
        getAccessToken: requestAccessToken,
        invalidateAccessToken: (region) => tokenCache.delete(region),
      });
  try {
    return await readFbaSalesTrend(input, {
      adapter,
      mode: demoMode ? "demo" : "live",
      demoNotice: demoMode
        ? isConfiguredForMarketplace(input.marketplaceId)
          ? "目前由 SP_API_MODE 強制使用展示資料；趨勢只供版面測試。"
          : `${MARKETPLACES[input.marketplaceId].label}站尚未在本機系統安全儲存區加入 refresh token，因此顯示展示趨勢。`
        : undefined,
    });
  } catch (error) {
    throwFbaSalesFacadeError(error);
  }
}

type RestockPlanInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  targetDays: number;
  leadTimeDays: number;
  safetyDays: number;
  casePack: number;
};

function inventoryQuantity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function createRestockPlan(
  input: RestockPlanInput,
  context: {
    mode: "live" | "demo";
    listing: ListingPriceSnapshot;
    fnSku: string | null;
    inventory: Omit<RestockPlanSnapshot["inventory"], "inventoryPosition">;
    demand: RestockPlanSnapshot["demand"];
    requestId: string | null;
    rateLimit: string | null;
  },
): RestockPlanSnapshot {
  const inventoryPosition =
    context.inventory.fulfillable +
    context.inventory.inboundWorking +
    context.inventory.inboundShipped +
    context.inventory.inboundReceiving;
  const daily = context.demand.averageDailyUnits;
  const daysOfCover = daily > 0 ? context.inventory.fulfillable / daily : null;
  const reorderPoint = Math.ceil(daily * (input.leadTimeDays + input.safetyDays));
  const rawRecommended = Math.max(
    0,
    Math.ceil(daily * input.targetDays - inventoryPosition),
  );
  const recommendedUnits =
    rawRecommended > 0
      ? Math.ceil(rawRecommended / input.casePack) * input.casePack
      : 0;
  const action: RestockPlanSnapshot["action"] =
    daily <= 0
      ? "NO_DEMAND"
      : (daysOfCover ?? 0) <= input.leadTimeDays + input.safetyDays
        ? "RESTOCK_NOW"
        : (daysOfCover ?? 0) <= input.targetDays
          ? "WATCH"
          : "HEALTHY";
  const skillConnected = Boolean(
    process.env.AMAZON_REPLENISHMENT_SKILL_URL?.trim(),
  );
  return {
    mode: context.mode,
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    asin: context.listing.asin,
    fnSku: context.fnSku,
    title: context.listing.title,
    targetDays: input.targetDays,
    leadTimeDays: input.leadTimeDays,
    safetyDays: input.safetyDays,
    casePack: input.casePack,
    inventory: { ...context.inventory, inventoryPosition },
    demand: context.demand,
    daysOfCover,
    reorderPoint,
    recommendedUnits,
    forecastStockoutAt:
      daysOfCover !== null
        ? new Date(Date.now() + daysOfCover * 86_400_000).toISOString()
        : null,
    action,
    fetchedAt: new Date().toISOString(),
    requestId: context.requestId,
    rateLimit: context.rateLimit,
    notice: [
      context.mode === "demo"
        ? "展示建議只供操作測試，不會建立 FBA 入庫。"
        : context.demand.partial
          ? "Sales API 沒有提供完整的近 30 個站點日，銷速可能被低估，請人工複核。"
          : "近 30 個完整站點日的銷速取自 Sales API 精確 SKU 查詢；建議量已扣除 FBA 可售與 working／shipped／receiving 在途庫存。",
      skillConnected
        ? "已偵測到補貨 Skill 接點；正式送出仍應先人工審核。"
        : "工作區未找到既有補貨 Skill，目前直接使用 FBA Inventory 與 Sales API AFN/FBA 資料。",
    ].join(" "),
    skillConnected,
  };
}

async function readRestockSalesVelocity(
  marketplaceId: MarketplaceId,
  sellerSku: string,
  demoMode: boolean,
): Promise<RestockPlanSnapshot["demand"]> {
  const adapter = demoMode
    ? createDeterministicFbaSalesMetricsDemoAdapter()
    : createFbaSalesMetricsProductionAdapter({
        getAccessToken: requestAccessToken,
        invalidateAccessToken: (region) => tokenCache.delete(region),
      });
  const velocity = await readFbaSalesVelocity(
    { marketplaceId, sellerSku },
    { adapter },
  );
  return {
    lookbackDays: velocity.completedDayCount,
    units: velocity.units,
    averageDailyUnits: velocity.averageDailyUnits,
    ordersScanned: velocity.orderCount,
    partial: false,
  };
}

export async function getRestockPlan(
  input: RestockPlanInput,
): Promise<RestockPlanSnapshot> {
  const demoMode = shouldUseDemoMode(input.marketplaceId);
  try {
    if (demoMode) {
      const demand = await readRestockSalesVelocity(
        input.marketplaceId,
        input.sellerSku,
        true,
      );
      const listing = getDemoListingPrice(
        input.marketplaceId,
        input.sellerSku,
      );
      const fba = listing.fulfillmentAvailability.find(
        (item) => item.fulfillment === "FBA",
      );
      const fulfillable = inventoryQuantity(fba?.quantity);
      return createRestockPlan(input, {
        mode: "demo",
        listing,
        fnSku: listing.asin ? `X00${listing.asin.slice(-7)}` : null,
        inventory: {
          fulfillable,
          reserved: 4,
          inboundWorking: fulfillable > 0 ? 12 : 0,
          inboundShipped: fulfillable > 0 ? 18 : 0,
          inboundReceiving: 6,
          unfulfillable: 1,
          researching: 0,
        },
        demand,
        requestId: null,
        rateLimit: null,
      });
    }

    const [demand, listing, inventoryResult] = await Promise.all([
      readRestockSalesVelocity(input.marketplaceId, input.sellerSku, false),
      fetchLiveListingPrice(input.marketplaceId, input.sellerSku),
      readReplenishmentInventoryInputs(
        {
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
        },
        { adapter: fbaInventoryReplenishmentAdapter },
      ),
    ]);
    return createRestockPlan(input, {
      mode: "live",
      listing,
      fnSku: inventoryResult.fnSku,
      inventory: inventoryResult.inventory,
      demand,
      requestId: inventoryResult.requestId,
      rateLimit: inventoryResult.rateLimit,
    });
  } catch (error) {
    throwFbaSalesFacadeError(error);
  }
}

export function isMarketplaceId(value: string): value is MarketplaceId {
  return value in MARKETPLACES;
}
