export type SpApiRegion = "na" | "eu" | "fe";

export type Money = {
  amount: number;
  currencyCode: string;
};

export type DashboardOrderItem = {
  orderItemId: string;
  asin: string;
  sellerSku: string;
  title: string;
  quantity: number;
  unitPrice: Money | null;
  lineTotal: Money | null;
};

export type DashboardOrder = {
  orderId: string;
  createdTime: string;
  lastUpdatedTime: string;
  marketplaceId: string;
  marketplaceName: string;
  programs: string[];
  fulfillmentStatus: string;
  fulfilledBy: string;
  fulfillmentServiceLevel: string;
  shipBy: string | null;
  deliverBy: string | null;
  total: Money | null;
  items: DashboardOrderItem[];
};

export type OrdersSnapshot = {
  mode: "live" | "demo";
  orders: DashboardOrder[];
  marketplaceId: string;
  fetchedAt: string;
  nextToken: string | null;
  lastUpdatedBefore: string | null;
  requestId: string | null;
  rateLimit: string | null;
  notice: string | null;
};

export type SalesTrendDays = 7 | 14 | 30;

export type SalesTrendPoint = {
  date: string;
  interval: string;
  totalSales: Money;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
  partial: boolean;
};

export type SalesTrendSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  days: SalesTrendDays;
  timeZone: string;
  points: SalesTrendPoint[];
  totals: {
    totalSales: Money;
    unitCount: number;
    orderItemCount: number;
    orderCount: number;
  };
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string;
};

export type ListingIssue = {
  code: string | null;
  severity: string;
  message: string;
  attributeNames: string[];
};

export type FulfillmentAvailability = {
  channelCode: string;
  quantity: number | null;
  fulfillment: "FBA" | "OTHER";
  editable: boolean;
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
  discountedPrice: SalePriceSchedule | null;
  hasDiscountedPrice: boolean;
  hasAutomatedPricing: boolean;
  fetchedAt: string;
  requestId: string | null;
  issues: ListingIssue[];
  fulfillmentAvailability: FulfillmentAvailability[];
  notice: string | null;
};

export type SalePriceSchedule = {
  price: Money;
  startAt: string | null;
  endAt: string | null;
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

export type ListingImageFieldCapability = {
  attributeName: string;
  label: string;
  supported: boolean;
  editable: boolean;
  required: boolean;
  reason: string | null;
};

export type ListingImageSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string;
  title: string;
  images: Array<{
    attributeName: string;
    label: string;
    url: string | null;
    capability: ListingImageFieldCapability;
  }>;
  fetchedAt: string;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

export type UpdateListingImagesInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedUrls: Array<string | null>;
  urls: Array<string | null>;
};

export type ListingImageUpdateResult = {
  mode: "live" | "demo";
  status: "VALID" | "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previousUrls: Array<string | null>;
  requestedUrls: Array<string | null>;
  changedSlots: number[];
  completedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

export type ListingContentSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string;
  status: string[];
  title: string;
  bulletPoints: string[];
  ingredients: string;
  languageTag: string;
  attributePresence: {
    title: boolean;
    bulletPoints: boolean;
    ingredients: boolean;
  };
  capabilities: {
    title: ListingContentFieldCapability;
    bulletPoints: ListingContentFieldCapability;
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
  bulletPoints: string[];
  ingredients: string;
};

export type UpdateListingContentInput = ListingContentValues & {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedTitle: string;
  expectedBulletPoints: string[];
  expectedIngredients: string;
};

export type ListingContentValidationResult = {
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: Array<"title" | "bulletPoints" | "ingredients">;
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
  changedFields: Array<"title" | "bulletPoints" | "ingredients">;
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

export type ListingExportRow = {
  marketplace: string;
  sellerSku: string;
  asin: string;
  productType: string;
  title: string;
  bulletPoints: string[];
  ingredients: string;
  status: string;
  updatedAt: string;
};

export type ListingExportError = {
  sellerSku: string;
  kind: string;
  message: string;
};

export type ListingReportStatus = {
  mode: "live" | "demo";
  ready: boolean;
  reportId: string;
  documentId: string | null;
  status: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL";
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

export type SubscribeAndSaveOfferSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  found: boolean;
  asin: string | null;
  eligibility: string | null;
  enrollmentMethod: string | null;
  autoEnrollment: string | null;
  sellerFundedBaseDiscount: number | null;
  sellerFundedTieredDiscount: number | null;
  amazonFundedBaseDiscount: number | null;
  amazonFundedTieredDiscount: number | null;
  price: Money | null;
  inventory: number | null;
  subscriptions: number | null;
  stockRisk: string | null;
  forecastDeliveries: {
    next15Days: number | null;
    next30Days: number | null;
    next60Days: number | null;
    next90Days: number | null;
  } | null;
  deliveryConditions: Array<{
    condition: string;
    next30DaysDeliveries: number | null;
  }>;
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string;
  writable: false;
};

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

export const MARKETPLACES = {
  ATVPDKIKX0DER: {
    label: "美國",
    shortLabel: "US",
    name: "Amazon.com",
    currency: "USD",
    region: "na" as const,
    issueLocale: "en_US",
    timeZone: "America/Los_Angeles",
  },
  A1VC38T7YXB528: {
    label: "日本",
    shortLabel: "JP",
    name: "Amazon.co.jp",
    currency: "JPY",
    region: "fe" as const,
    issueLocale: "ja_JP",
    timeZone: "Asia/Tokyo",
  },
  A2EUQ1WTGCTBG2: {
    label: "加拿大",
    shortLabel: "CA",
    name: "Amazon.ca",
    currency: "CAD",
    region: "na" as const,
    issueLocale: "en_CA",
    timeZone: "America/Vancouver",
  },
  A19VAU5U5O7RUS: {
    label: "新加坡",
    shortLabel: "SG",
    name: "Amazon.sg",
    currency: "SGD",
    region: "fe" as const,
    issueLocale: "en_SG",
    timeZone: "Asia/Singapore",
  },
  A39IBJ37TRP1C6: {
    label: "澳洲",
    shortLabel: "AU",
    name: "Amazon.com.au",
    currency: "AUD",
    region: "fe" as const,
    issueLocale: "en_AU",
    timeZone: "Australia/Sydney",
  },
  A1F83G8C2ARO7P: {
    label: "英國",
    shortLabel: "UK",
    name: "Amazon.co.uk",
    currency: "GBP",
    region: "eu" as const,
    issueLocale: "en_GB",
    timeZone: "Europe/London",
  },
  A1PA6795UKMFR9: {
    label: "德國",
    shortLabel: "DE",
    name: "Amazon.de",
    currency: "EUR",
    region: "eu" as const,
    issueLocale: "de_DE",
    timeZone: "Europe/Berlin",
  },
} as const;

export type MarketplaceId = keyof typeof MARKETPLACES;

const REGION_ENDPOINTS: Record<SpApiRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const LISTING_ITEM_INCLUDED_DATA =
  "summaries,attributes,offers,issues,fulfillmentAvailability";
const LISTING_SEARCH_INCLUDED_DATA =
  `${LISTING_ITEM_INCLUDED_DATA},productTypes`;

export function listingIncludedData(
  operation: "item" | "search",
): string {
  return operation === "item"
    ? LISTING_ITEM_INCLUDED_DATA
    : LISTING_SEARCH_INCLUDED_DATA;
}

export function shouldFallbackListingsExport(status: number): boolean {
  return status === 400;
}

const VALID_STATUSES = new Set([
  "PENDING_AVAILABILITY",
  "PENDING",
  "UNSHIPPED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "CANCELLED",
  "UNFULFILLABLE",
]);

type SearchOrdersInput = {
  marketplaceId: MarketplaceId;
  lastUpdatedAfter: string;
  fulfillmentStatus?: string | null;
  fulfilledBy?: "AMAZON" | null;
  paginationToken?: string | null;
  maxResultsPerPage?: number;
};

type AmazonMoney = {
  amount?: string | number;
  currencyCode?: string;
};

type AmazonOrderItem = {
  orderItemId?: string;
  quantityOrdered?: number;
  product?: {
    asin?: string;
    title?: string;
    sellerSku?: string;
    price?: { unitPrice?: AmazonMoney };
  };
  proceeds?: {
    proceedsTotal?: AmazonMoney;
  };
};

type AmazonOrder = {
  orderId?: string;
  createdTime?: string;
  lastUpdatedTime?: string;
  programs?: string[];
  salesChannel?: {
    marketplaceId?: string;
    marketplaceName?: string;
  };
  proceeds?: {
    grandTotal?: AmazonMoney;
  };
  fulfillment?: {
    fulfillmentStatus?: string;
    fulfilledBy?: string;
    fulfillmentServiceLevel?: string;
    shipByWindow?: { latestDateTime?: string };
    deliverByWindow?: { latestDateTime?: string };
  };
  orderItems?: AmazonOrderItem[];
};

type SearchOrdersResponse = {
  orders?: AmazonOrder[];
  pagination?: { nextToken?: string };
  lastUpdatedBefore?: string;
};

type AmazonListingIssue = {
  code?: string;
  severity?: string;
  message?: string;
  attributeName?: string;
  attributeNames?: string[];
};

type AmazonPriceSchedule = {
  schedule?: Array<{
    value_with_tax?: string | number;
    start_at?: string;
    end_at?: string;
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
    price?: { currency?: string; amount?: string | number };
  }>;
  issues?: AmazonListingIssue[];
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
};

type AmazonProductTypeDefinition = {
  schema?: {
    link?: { resource?: string };
    checksum?: string;
  };
  productType?: string;
  productTypeVersion?: { version?: string };
};

type AmazonReport = {
  reportId?: string;
  reportType?: string;
  marketplaceIds?: string[];
  processingStatus?: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL";
  reportDocumentId?: string;
};

type AmazonReportDocument = {
  url?: string;
  compressionAlgorithm?: "GZIP";
};

type AmazonReplenishmentOffer = {
  sku?: string;
  asin?: string;
  marketplaceId?: string;
  eligibility?: string;
  programType?: string;
  offerProgramConfiguration?: {
    preferences?: { autoEnrollment?: string };
    promotions?: {
      sellingPartnerFundedBaseDiscount?: { percentage?: number };
      sellingPartnerFundedTieredDiscount?: { percentage?: number };
      amazonFundedBaseDiscount?: { percentage?: number };
      amazonFundedTieredDiscount?: { percentage?: number };
    };
    enrollmentMethod?: string;
  };
  price?: number;
  priceCurrencyCode?: string;
  inventory?: number;
  subscriptions?: number;
  stockRisk?: string;
  forecastDeliveries?: {
    next15DaysDeliveries?: number;
    next30DaysDeliveries?: number;
    next60DaysDeliveries?: number;
    next90DaysDeliveries?: number;
  };
  deliveriesConditions?: Array<{
    condition?: string;
    next30DaysDeliveries?: number;
  }>;
};

type AmazonReplenishmentOffersResponse = {
  offers?: AmazonReplenishmentOffer[];
  pagination?: { totalResults?: number };
};

type AmazonInventorySummary = {
  asin?: string;
  fnSku?: string;
  sellerSku?: string;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    inboundReceivingQuantity?: number;
    reservedQuantity?: { totalReservedQuantity?: number };
    unfulfillableQuantity?: { totalUnfulfillableQuantity?: number };
    researchingQuantity?: { totalResearchingQuantity?: number };
  };
};

type AmazonInventorySummariesResponse = {
  payload?: {
    inventorySummaries?: AmazonInventorySummary[];
  };
  pagination?: { nextToken?: string };
  errors?: Array<{ code?: string; message?: string; details?: string }>;
};

function hasValidOptionalInventoryQuantity(
  record: Record<string, unknown>,
  key: string,
): boolean {
  return record[key] === undefined || finiteNonNegativeInteger(record[key]) !== null;
}

function hasValidOptionalInventoryGroup(
  record: Record<string, unknown>,
  key: string,
  totalKey: string,
): boolean {
  const group = record[key];
  return (
    group === undefined ||
    (isRecord(group) && hasValidOptionalInventoryQuantity(group, totalKey))
  );
}

function isAmazonInventorySummary(value: unknown): value is AmazonInventorySummary {
  if (!isRecord(value) || typeof value.sellerSku !== "string" || !value.sellerSku) {
    return false;
  }
  const details = value.inventoryDetails;
  return (
    isRecord(details) &&
    [
      "fulfillableQuantity",
      "inboundWorkingQuantity",
      "inboundShippedQuantity",
      "inboundReceivingQuantity",
    ].every((key) => hasValidOptionalInventoryQuantity(details, key)) &&
    hasValidOptionalInventoryGroup(
      details,
      "reservedQuantity",
      "totalReservedQuantity",
    ) &&
    hasValidOptionalInventoryGroup(
      details,
      "unfulfillableQuantity",
      "totalUnfulfillableQuantity",
    ) &&
    hasValidOptionalInventoryGroup(
      details,
      "researchingQuantity",
      "totalResearchingQuantity",
    )
  );
}

export function inventorySummariesFromResponse(
  response: unknown,
): AmazonInventorySummary[] | null {
  if (!isRecord(response)) {
    return null;
  }
  if (Array.isArray(response.errors) && response.errors.length) return null;
  const payload = response.payload;
  if (!isRecord(payload)) return null;
  const summaries = payload.inventorySummaries;
  return Array.isArray(summaries) && summaries.every(isAmazonInventorySummary)
    ? summaries
    : null;
}

export function findExactInventorySummary(
  summaries: AmazonInventorySummary[],
  sellerSku: string,
): AmazonInventorySummary | null {
  return summaries.find((item) => item.sellerSku === sellerSku) ?? null;
}

type AmazonSalesMetric = {
  interval?: string;
  unitCount?: number;
  orderItemCount?: number;
  orderCount?: number;
  totalSales?: AmazonMoney;
};

type AmazonSalesMetricsResponse = {
  payload?: AmazonSalesMetric[];
  errors?: Array<{ code?: string; message?: string; details?: string }>;
};

type ListingsRequestInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  method?: "GET" | "PATCH";
  body?: unknown;
  validationPreview?: boolean;
};

type UpdateListingPriceInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  newPrice: number;
  expectedPrice: number;
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

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
};

const tokenCache = new Map<SpApiRegion, TokenCacheEntry>();
const tokenRequests = new Map<SpApiRegion, Promise<TokenCacheEntry>>();
let credentialGeneration = 0;

export function invalidateSpApiCredentialCaches(): void {
  credentialGeneration += 1;
  tokenCache.clear();
  tokenRequests.clear();
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

export class SpApiError extends Error {
  status: number;
  code: string;
  requestId: string | null;
  retryAfter: string | null;
  issues: ListingIssue[];

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      requestId?: string | null;
      retryAfter?: string | null;
      issues?: ListingIssue[];
    } = {},
  ) {
    super(message);
    this.name = "SpApiError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "UPSTREAM_UNAVAILABLE";
    this.requestId = options.requestId ?? null;
    this.retryAfter = options.retryAfter ?? null;
    this.issues = options.issues ?? [];
  }
}

function getRefreshToken(region: SpApiRegion): string | undefined {
  const regionalKey = `SP_API_REFRESH_TOKEN_${region.toUpperCase()}`;
  return process.env[regionalKey] || process.env.SP_API_REFRESH_TOKEN;
}

function getSellerId(region: SpApiRegion): string | undefined {
  const regionalKey = `SP_API_SELLER_ID_${region.toUpperCase()}`;
  return process.env[regionalKey] || process.env.SP_API_SELLER_ID;
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

function parseMoney(value: AmazonMoney | undefined): Money | null {
  const amount = Number(value?.amount);
  if (!Number.isFinite(amount) || !value?.currencyCode) return null;
  return { amount, currencyCode: value.currencyCode };
}

function safeText(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeListingIssues(
  issues: AmazonListingIssue[] | undefined,
): ListingIssue[] {
  return (issues ?? []).map((issue) => ({
    code: typeof issue.code === "string" ? issue.code : null,
    severity: safeText(issue.severity, "INFO").toUpperCase(),
    message: safeText(issue.message, "Amazon 未提供問題說明。"),
    attributeNames: Array.isArray(issue.attributeNames)
      ? issue.attributeNames.filter(
          (name): name is string => typeof name === "string" && Boolean(name),
        )
      : issue.attributeName
        ? [issue.attributeName]
        : [],
  }));
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
  if (!candidate) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
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

function samePrice(left: number, right: number, currencyCode: string): boolean {
  const precision = currencyCode === "JPY" ? 0 : 2;
  const factor = 10 ** precision;
  return Math.round(left * factor) === Math.round(right * factor);
}

function listingErrorMessage(
  status: number,
  operation: "read" | "write",
): { code: string; message: string } {
  if (status === 401 || status === 403) {
    return {
      code: "UNAUTHORIZED",
      message:
        "Amazon 拒絕了這次 Listing 請求，請確認 Product Listing 角色、refresh token 與 Seller ID。",
    };
  }
  if (status === 404) {
    return {
      code: "SKU_NOT_FOUND",
      message: "這個站點找不到該 SKU，請確認大小寫與 Seller SKU 完全一致。",
    };
  }
  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "Amazon Listings API 正在限流，請稍後再試。",
    };
  }
  if ([400, 413, 415, 422].includes(status)) {
    return {
      code: operation === "write" ? "UPDATE_REJECTED" : "INVALID_LISTING_REQUEST",
      message:
        operation === "write"
          ? "Amazon 拒絕了這次 Listing 更新，尚未寫入變更。"
          : "Amazon 無法驗證這次 Listing 請求。",
    };
  }
  return {
    code: operation === "write" ? "UPDATE_STATUS_UNKNOWN" : "UPSTREAM_UNAVAILABLE",
    message:
      operation === "write"
        ? "Amazon 未確認這次 Listing 更新結果。請先重新查詢 SKU，再決定是否重送。"
        : "Amazon Listings API 暫時無法完成查詢。",
  };
}

function normalizeOrders(
  orders: AmazonOrder[] | undefined,
  fallbackMarketplaceId: MarketplaceId,
): DashboardOrder[] {
  const marketplace = MARKETPLACES[fallbackMarketplaceId];

  return (orders ?? []).map((order, orderIndex) => {
    const items = (order.orderItems ?? []).map((item, itemIndex) => {
      const unitPrice = parseMoney(item.product?.price?.unitPrice);
      const quantity = Number.isFinite(item.quantityOrdered)
        ? Math.max(0, Number(item.quantityOrdered))
        : 0;
      const suppliedLineTotal = parseMoney(item.proceeds?.proceedsTotal);
      const lineTotal =
        suppliedLineTotal ??
        (unitPrice
          ? {
              amount: unitPrice.amount * quantity,
              currencyCode: unitPrice.currencyCode,
            }
          : null);

      return {
        orderItemId: safeText(
          item.orderItemId,
          `item-${orderIndex + 1}-${itemIndex + 1}`,
        ),
        asin: safeText(item.product?.asin, "—"),
        sellerSku: safeText(item.product?.sellerSku, "—"),
        title: safeText(item.product?.title, "未提供商品名稱"),
        quantity,
        unitPrice,
        lineTotal,
      };
    });

    const calculatedTotal = items.reduce<Money | null>((total, item) => {
      if (!item.lineTotal) return total;
      if (!total) return { ...item.lineTotal };
      if (total.currencyCode !== item.lineTotal.currencyCode) return total;
      return {
        amount: total.amount + item.lineTotal.amount,
        currencyCode: total.currencyCode,
      };
    }, null);

    return {
      orderId: safeText(order.orderId, `unknown-${orderIndex + 1}`),
      createdTime: safeText(order.createdTime, new Date(0).toISOString()),
      lastUpdatedTime: safeText(
        order.lastUpdatedTime,
        safeText(order.createdTime, new Date(0).toISOString()),
      ),
      marketplaceId: safeText(
        order.salesChannel?.marketplaceId,
        fallbackMarketplaceId,
      ),
      marketplaceName: safeText(
        order.salesChannel?.marketplaceName,
        marketplace.name,
      ),
      programs: Array.isArray(order.programs) ? order.programs : [],
      fulfillmentStatus: safeText(
        order.fulfillment?.fulfillmentStatus,
        "UNKNOWN",
      ),
      fulfilledBy: safeText(order.fulfillment?.fulfilledBy, "UNKNOWN"),
      fulfillmentServiceLevel: safeText(
        order.fulfillment?.fulfillmentServiceLevel,
        "—",
      ),
      shipBy: order.fulfillment?.shipByWindow?.latestDateTime ?? null,
      deliverBy: order.fulfillment?.deliverByWindow?.latestDateTime ?? null,
      total: parseMoney(order.proceeds?.grandTotal) ?? calculatedTotal,
      items,
    };
  });
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

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callListingsApi(
  input: ListingsRequestInput,
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
  const query = new URLSearchParams({
    marketplaceIds: input.marketplaceId,
    issueLocale: marketplace.issueLocale,
  });
  if ((input.method ?? "GET") === "GET") {
    // getListingsItem and searchListingsItems expose different IncludedData
    // enums. `productTypes` is valid for search, but Amazon rejects it on the
    // single-item endpoint with HTTP 400 "Invalid parameters provided".
    query.set("includedData", listingIncludedData("item"));
  } else {
    query.set("includedData", "issues");
  }
  if (input.validationPreview) query.set("mode", "VALIDATION_PREVIEW");

  const url = `${REGION_ENDPOINTS[region]}/listings/2021-08-01/items/${encodeURIComponent(
    sellerId,
  )}/${encodeURIComponent(input.sellerSku)}?${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const method = input.method ?? "GET";

  try {
    return await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(method === "PATCH" ? { "content-type": "application/json" } : {}),
        "x-amz-access-token": token,
        "x-amz-date": toAmzDate(),
        "user-agent":
          process.env.SP_API_USER_AGENT ||
          "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
      },
      body: method === "PATCH" ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const isCommit = method === "PATCH" && !input.validationPreview;
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

async function executeListingsRequest(
  input: ListingsRequestInput,
): Promise<Response> {
  let response = await callListingsApi(input);

  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[input.marketplaceId].region);
    response = await callListingsApi(input, true);
  }

  const canRetry = (input.method ?? "GET") === "GET" || input.validationPreview;
  if (canRetry) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (![429, 500, 503].includes(response.status)) break;
      await wait(retryDelayMs(response, attempt));
      response = await callListingsApi(input);
    }
  }

  return response;
}

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
): Promise<never> {
  const requestId = response.headers.get("x-amzn-requestid");
  const fallback = listingErrorMessage(response.status, operation);
  const payload = await parseResponseJson<{
    issues?: AmazonListingIssue[];
    errors?: Array<{ code?: string; message?: string }>;
  }>(response);
  const issues = normalizeListingIssues(payload?.issues);
  const upstreamMessage = payload?.errors?.find(
    (error) => typeof error.message === "string" && error.message.trim(),
  )?.message;

  throw new SpApiError(
    upstreamMessage ? `${fallback.message}（${upstreamMessage}）` : fallback.message,
    {
      status: response.status,
      code: fallback.code,
      requestId,
      retryAfter: response.headers.get("retry-after"),
      issues,
    },
  );
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
    )?.productType ?? payload.productTypes?.[0]?.productType;
  return safeText(productType ?? listingSummary(payload, marketplaceId)?.productType, "PRODUCT");
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
  return (payload.fulfillmentAvailability ?? []).some((availability) =>
    /^(AMAZON|AFN)(?:_|$)/i.test(
      typeof availability.fulfillmentChannelCode === "string"
        ? availability.fulfillmentChannelCode
        : "",
    ),
  );
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
  const availableLanguages = ["item_name", "bullet_point", "ingredients"]
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
  for (const name of ["item_name", "bullet_point", "ingredients"]) {
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
): Promise<{ payload: AmazonListingItem; requestId: string | null }> {
  const response = await executeListingsRequest({ marketplaceId, sellerSku });
  if (!response.ok) return throwListingsError(response, "read");
  const payload = await parseResponseJson<AmazonListingItem>(response);
  if (!payload) {
    throw new SpApiError("Amazon 回傳了無法辨識的 Listing 資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  return {
    payload,
    requestId: response.headers.get("x-amzn-requestid"),
  };
}

function normalizeListingPrice(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  requestId: string | null,
): ListingPriceSnapshot {
  const marketplace = MARKETPLACES[marketplaceId];
  const summary = listingSummary(payload, marketplaceId);
  const purchasableOffer =
    payload.attributes?.purchasable_offer?.find(
      (offer) =>
        offer.marketplace_id === marketplaceId &&
        (!offer.audience || offer.audience === "ALL"),
    );
  const effectiveOffer =
    payload.offers?.find(
      (offer) =>
        offer.marketplaceId === marketplaceId && offer.offerType === "B2C",
    ) ??
    payload.offers?.find(
      (offer) => offer.marketplaceId === marketplaceId && !offer.offerType,
    );
  const standardCurrency = purchasableOffer?.currency ?? marketplace.currency;
  const discountedPrice = parseDiscountedPrice(
    purchasableOffer?.discounted_price,
    standardCurrency,
  );
  const effectiveAmount = Number(effectiveOffer?.price?.amount);
  const effectiveCurrency =
    effectiveOffer?.price?.currency ?? marketplace.currency;
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
    effectivePrice: Number.isFinite(effectiveAmount)
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
    discountedPrice,
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

const productTypeCapabilityCache = new Map<
  string,
  { expiresAt: number; capabilities: ContentCapabilities }
>();

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

async function callProductTypeDefinitionApi(
  marketplaceId: MarketplaceId,
  productType: string,
  forceTokenRefresh = false,
): Promise<Response> {
  const marketplace = MARKETPLACES[marketplaceId];
  const sellerId = getSellerId(marketplace.region);
  if (!sellerId) {
    throw new SpApiError(
      `${marketplace.label}站尚未設定 Seller ID，商品內容編輯仍未啟用。`,
      { status: 503, code: "LISTINGS_NOT_CONFIGURED" },
    );
  }
  const token = await requestAccessToken(
    marketplace.region,
    forceTokenRefresh,
  );
  const query = new URLSearchParams({
    sellerId,
    marketplaceIds: marketplaceId,
    productTypeVersion: "LATEST",
    requirements: "LISTING_PRODUCT_ONLY",
    requirementsEnforced: "NOT_ENFORCED",
    locale: marketplace.issueLocale,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(
      `${REGION_ENDPOINTS[marketplace.region]}/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}?${query}`,
      {
        headers: {
          accept: "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(),
          "user-agent":
            process.env.SP_API_USER_AGENT ||
            "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon 商品欄位規格查詢逾時，請稍後再試。", {
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    throw new SpApiError("目前無法讀取 Amazon 商品欄位規格。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchContentCapabilities(
  marketplaceId: MarketplaceId,
  productType: string,
): Promise<ContentCapabilities> {
  const cacheKey = `${marketplaceId}:${productType}`;
  const cached = productTypeCapabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.capabilities;

  const marketplace = MARKETPLACES[marketplaceId];
  let response = await callProductTypeDefinitionApi(marketplaceId, productType);
  if (response.status === 401) {
    tokenCache.delete(marketplace.region);
    response = await callProductTypeDefinitionApi(
      marketplaceId,
      productType,
      true,
    );
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(retryDelayMs(response, attempt));
    response = await callProductTypeDefinitionApi(marketplaceId, productType);
  }
  if (!response.ok) return throwListingsError(response, "read");
  const definition = await parseResponseJson<AmazonProductTypeDefinition>(
    response,
  );
  const schemaUrl = definition?.schema?.link?.resource;
  if (!schemaUrl) {
    throw new SpApiError("Amazon 沒有回傳可用的商品欄位規格。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }

  let schemaResponse: Response;
  try {
    schemaResponse = await fetch(schemaUrl, {
      headers: { accept: "application/schema+json, application/json" },
      cache: "no-store",
    });
  } catch {
    throw new SpApiError("Amazon 商品欄位規格下載失敗，請稍後再試。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
    });
  }
  if (!schemaResponse.ok) {
    throw new SpApiError("Amazon 商品欄位規格暫時無法下載。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
    });
  }
  const schema = await parseResponseJson<JsonRecord>(schemaResponse);
  if (!schema || !isRecord(schema.properties)) {
    throw new SpApiError("Amazon 商品欄位規格格式無法辨識。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
    });
  }
  const capabilities: ContentCapabilities = {
    title: contentCapability(schema, "item_name"),
    bulletPoints: contentCapability(schema, "bullet_point"),
    ingredients: contentCapability(schema, "ingredients"),
    images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) =>
      imageCapability(schema, attributeName, index),
    ),
    schemaChecksum: definition?.schema?.checksum ?? null,
  };
  productTypeCapabilityCache.set(cacheKey, {
    expiresAt: Date.now() + 15 * 60_000,
    capabilities,
  });
  return capabilities;
}

function normalizeListingContent(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  requestId: string | null,
  capabilities: ContentCapabilities,
  mode: "live" | "demo" = "live",
): ListingContentSnapshot {
  const summary = listingSummary(payload, marketplaceId);
  const allowedLanguages = [
    ...capabilities.title.languageTags,
    ...capabilities.bulletPoints.languageTags,
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
    bulletPoints: attributeTextValuesForLanguage(
      payload,
      "bullet_point",
      marketplaceId,
      languageTag,
    ).slice(0, 5),
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
      bulletPoints:
        attributeObjects(payload, "bullet_point", marketplaceId).length > 0,
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
      mode === "live"
        ? "內容取自你提交給 Amazon 的 Listing attributes；買家頁採用結果可能稍後更新。"
        : "展示內容只供操作測試，不會變更 Amazon。",
  };
}

async function fetchLiveListingContent(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): Promise<ListingContentSnapshot> {
  return (await fetchLiveListingContentContext(marketplaceId, sellerSku))
    .listing;
}

async function fetchLiveListingContentContext(
  marketplaceId: MarketplaceId,
  sellerSku: string,
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
  const capabilities = await fetchContentCapabilities(
    marketplaceId,
    productType,
  );
  return {
    payload,
    listing: normalizeListingContent(
      payload,
      marketplaceId,
      requestId,
      capabilities,
    ),
  };
}

async function callListingsSearchApi(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
  forceTokenRefresh = false,
  accessProbe = false,
): Promise<Response> {
  const marketplace = MARKETPLACES[marketplaceId];
  const region = marketplace.region;
  const sellerId = getSellerId(region);

  if (!sellerId) {
    throw new SpApiError(
      `${marketplace.label}站尚未設定 Seller ID，SKU 查詢功能仍未啟用。`,
      { status: 503, code: "LISTINGS_NOT_CONFIGURED" },
    );
  }

  const token = await requestAccessToken(region, forceTokenRefresh);
  const query = new URLSearchParams({
    marketplaceIds: marketplaceId,
    issueLocale: marketplace.issueLocale,
    includedData: accessProbe ? "summaries" : listingIncludedData("search"),
    pageSize: accessProbe ? "1" : String(sellerSkus.length),
  });
  if (!accessProbe) {
    query.set("identifiers", sellerSkus.join(","));
    query.set("identifiersType", "SKU");
  }
  const url = `${REGION_ENDPOINTS[region]}/listings/2021-08-01/items/${encodeURIComponent(
    sellerId,
  )}?${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    return await fetch(url, {
      headers: {
        accept: "application/json",
        "x-amz-access-token": token,
        "x-amz-date": toAmzDate(),
        "user-agent":
          process.env.SP_API_USER_AGENT ||
          "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon 批次 SKU 查詢逾時，請稍後再試。", {
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    throw new SpApiError("目前無法連線至 Amazon Listings API。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function executeListingsSearchRequest(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
): Promise<Response> {
  let response = await callListingsSearchApi(marketplaceId, sellerSkus);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callListingsSearchApi(marketplaceId, sellerSkus, true);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(retryDelayMs(response, attempt));
    response = await callListingsSearchApi(marketplaceId, sellerSkus);
  }
  return response;
}

/**
 * Verify the part of the SP-API connection that actually uses Seller ID and
 * Product Listing permissions. Orders API calls do not use the configured
 * Seller ID, so an Orders-only connection test can otherwise produce a false
 * green status while every Listings request fails.
 */
export async function verifyListingsAccess(
  marketplaceId: MarketplaceId,
): Promise<{ requestId: string | null }> {
  if (shouldUseDemoMode(marketplaceId)) return { requestId: null };
  let response = await callListingsSearchApi(marketplaceId, [], false, true);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callListingsSearchApi(marketplaceId, [], true, true);
  }
  if (!response.ok) return throwListingsError(response, "read");
  return { requestId: response.headers.get("x-amzn-requestid") };
}

async function fetchLiveListingBatch(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
): Promise<ListingBatchSnapshot> {
  const response = await executeListingsSearchRequest(marketplaceId, sellerSkus);
  if (!response.ok) return throwListingsError(response, "read");

  const payload = await parseResponseJson<AmazonListingSearchResponse>(response);
  if (!payload || !Array.isArray(payload.items)) {
    throw new SpApiError("Amazon 回傳了無法辨識的批次 Listing 資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  const normalized = payload.items
    .map((item) =>
      normalizeListingPrice(
        item,
        marketplaceId,
        response.headers.get("x-amzn-requestid"),
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
    requestId: response.headers.get("x-amzn-requestid"),
    rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
    notice: null,
  };
}

function buildPricePatch(
  listing: ListingPriceSnapshot,
  newPrice: number,
): { productType: string; patches: unknown[] } {
  const marketplace = MARKETPLACES[listing.marketplaceId];
  return {
    productType: listing.productType || "PRODUCT",
    patches: [
      {
        op: "merge",
        path: "/attributes/purchasable_offer",
        value: [
          {
            marketplace_id: listing.marketplaceId,
            currency: marketplace.currency,
            audience: "ALL",
            our_price: [
              {
                schedule: [{ value_with_tax: newPrice }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function verifyPriceChange(
  listing: ListingPriceSnapshot,
  input: UpdateListingPriceInput,
): Money {
  const standardPrice = listing.standardPrice;
  const currencyCode = MARKETPLACES[input.marketplaceId].currency;

  if (!standardPrice) {
    throw new SpApiError(
      "這個 Listing 沒有可核對的標準售價，為避免誤改，本次不允許直接寫入。",
      { status: 422, code: "PRICE_UNAVAILABLE" },
    );
  }
  if (standardPrice.currencyCode !== currencyCode) {
    throw new SpApiError("Listing 幣別與站點幣別不一致，已停止調價。", {
      status: 409,
      code: "CURRENCY_MISMATCH",
    });
  }
  if (!samePrice(standardPrice.amount, input.expectedPrice, currencyCode)) {
    throw new SpApiError(
      "目前價格已在查詢後發生變動。請重新查詢 SKU，再確認一次新價格。",
      { status: 409, code: "PRICE_CHANGED" },
    );
  }
  if (samePrice(standardPrice.amount, input.newPrice, currencyCode)) {
    throw new SpApiError("新價格與目前標準售價相同。", {
      status: 400,
      code: "PRICE_UNCHANGED",
    });
  }
  if (
    listing.minimumPrice &&
    input.newPrice < listing.minimumPrice.amount
  ) {
    throw new SpApiError("新價格低於此 Listing 的最低允許售價。", {
      status: 422,
      code: "BELOW_MINIMUM_PRICE",
    });
  }
  if (
    listing.maximumPrice &&
    input.newPrice > listing.maximumPrice.amount
  ) {
    throw new SpApiError("新價格高於此 Listing 的最高允許售價。", {
      status: 422,
      code: "ABOVE_MAXIMUM_PRICE",
    });
  }

  return standardPrice;
}

async function prepareLivePriceUpdate(input: UpdateListingPriceInput): Promise<{
  listing: ListingPriceSnapshot;
  previousPrice: Money;
  requestedPrice: Money;
  body: { productType: string; patches: unknown[] };
  issues: ListingIssue[];
}> {
  const listing = await fetchLiveListingPrice(
    input.marketplaceId,
    input.sellerSku,
  );
  const previousPrice = verifyPriceChange(listing, input);
  const requestedPrice = {
    amount: input.newPrice,
    currencyCode: MARKETPLACES[input.marketplaceId].currency,
  };
  const body = buildPricePatch(listing, input.newPrice);
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body,
    validationPreview: true,
  });
  if (!response.ok) return throwListingsError(response, "read");

  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError("Amazon 回傳了無法辨識的價格預檢結果。", {
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
        "Amazon 價格預檢未通過，尚未寫入任何變更。",
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
      "Amazon 價格預檢沒有回傳明確的 VALID 狀態，為避免誤改，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }

  return { listing, previousPrice, requestedPrice, body, issues };
}

function isDateOnly(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function saleScheduleMatches(
  current: SalePriceSchedule | null,
  input: UpdateListingSalePriceInput,
  currencyCode: string,
): boolean {
  if (!current) {
    return (
      input.expectedDiscountedPrice === null &&
      input.expectedStartAt === null &&
      input.expectedEndAt === null
    );
  }
  return (
    input.expectedDiscountedPrice !== null &&
    samePrice(
      current.price.amount,
      input.expectedDiscountedPrice,
      currencyCode,
    ) &&
    current.startAt === input.expectedStartAt &&
    current.endAt === input.expectedEndAt
  );
}

function verifySalePriceChange(
  listing: ListingPriceSnapshot,
  input: UpdateListingSalePriceInput,
): Money {
  const currencyCode = MARKETPLACES[input.marketplaceId].currency;
  const standardPrice = listing.standardPrice;
  if (!standardPrice) {
    throw new SpApiError(
      "這個 Listing 沒有可核對的標準售價，為避免誤設折扣，本次不允許寫入。",
      { status: 422, code: "PRICE_UNAVAILABLE" },
    );
  }
  if (standardPrice.currencyCode !== currencyCode) {
    throw new SpApiError("Listing 幣別與站點幣別不一致，已停止建立折扣。", {
      status: 409,
      code: "CURRENCY_MISMATCH",
    });
  }
  if (!samePrice(standardPrice.amount, input.expectedPrice, currencyCode)) {
    throw new SpApiError(
      "標準售價已在查詢後發生變動。請重新查詢 SKU，再確認一次折扣。",
      { status: 409, code: "PRICE_CHANGED" },
    );
  }
  if (!saleScheduleMatches(listing.discountedPrice, input, currencyCode)) {
    throw new SpApiError(
      "目前限時折扣已在查詢後發生變動。請重新查詢 SKU，避免覆蓋其他活動。",
      { status: 409, code: "SALE_PRICE_CHANGED" },
    );
  }

  if (input.action === "cancel") {
    if (!listing.discountedPrice) {
      throw new SpApiError("這個 SKU 目前沒有可取消的限時折扣。", {
        status: 400,
        code: "SALE_PRICE_UNAVAILABLE",
      });
    }
    return standardPrice;
  }

  if (
    input.salePrice === null ||
    !isDateOnly(input.startAt) ||
    !isDateOnly(input.endAt)
  ) {
    throw new SpApiError("請提供有效的折扣價、開始日期與結束日期。", {
      status: 400,
      code: "INVALID_SALE_PRICE",
    });
  }
  if (input.endAt <= input.startAt) {
    throw new SpApiError("折扣結束日期必須晚於開始日期。", {
      status: 400,
      code: "INVALID_SALE_DATES",
    });
  }
  if (input.salePrice >= standardPrice.amount) {
    throw new SpApiError("限時折扣價必須低於標準售價。", {
      status: 422,
      code: "SALE_PRICE_NOT_LOWER",
    });
  }
  if (listing.minimumPrice && input.salePrice < listing.minimumPrice.amount) {
    throw new SpApiError("限時折扣價低於此 Listing 的最低允許售價。", {
      status: 422,
      code: "BELOW_MINIMUM_PRICE",
    });
  }
  if (
    listing.discountedPrice &&
    samePrice(listing.discountedPrice.price.amount, input.salePrice, currencyCode) &&
    listing.discountedPrice.startAt === input.startAt &&
    listing.discountedPrice.endAt === input.endAt
  ) {
    throw new SpApiError("新折扣設定與目前限時折扣相同。", {
      status: 400,
      code: "SALE_PRICE_UNCHANGED",
    });
  }
  return standardPrice;
}

function requestedSaleSchedule(
  input: UpdateListingSalePriceInput,
): SalePriceSchedule | null {
  if (
    input.action === "cancel" ||
    input.salePrice === null ||
    !input.startAt ||
    !input.endAt
  ) {
    return null;
  }
  return {
    price: {
      amount: input.salePrice,
      currencyCode: MARKETPLACES[input.marketplaceId].currency,
    },
    startAt: input.startAt,
    endAt: input.endAt,
  };
}

function buildSalePricePatch(
  listing: ListingPriceSnapshot,
  input: UpdateListingSalePriceInput,
): { productType: string; patches: unknown[] } {
  const marketplace = MARKETPLACES[input.marketplaceId];
  const nextSale = requestedSaleSchedule(input);
  return {
    productType: listing.productType || "PRODUCT",
    patches: [
      {
        op: "merge",
        path: "/attributes/purchasable_offer",
        value: [
          {
            marketplace_id: input.marketplaceId,
            currency: marketplace.currency,
            audience: "ALL",
            discounted_price: nextSale
              ? [
                  {
                    schedule: [
                      {
                        start_at: nextSale.startAt,
                        end_at: nextSale.endAt,
                        value_with_tax: nextSale.price.amount,
                      },
                    ],
                  },
                ]
              : null,
          },
        ],
      },
    ],
  };
}

async function prepareLiveSalePriceUpdate(
  input: UpdateListingSalePriceInput,
): Promise<{
  listing: ListingPriceSnapshot;
  standardPrice: Money;
  requestedDiscountedPrice: SalePriceSchedule | null;
  body: { productType: string; patches: unknown[] };
  issues: ListingIssue[];
}> {
  const listing = await fetchLiveListingPrice(
    input.marketplaceId,
    input.sellerSku,
  );
  const standardPrice = verifySalePriceChange(listing, input);
  const requestedDiscountedPrice = requestedSaleSchedule(input);
  const body = buildSalePricePatch(listing, input);
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body,
    validationPreview: true,
  });
  if (!response.ok) return throwListingsError(response, "read");

  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError("Amazon 回傳了無法辨識的折扣預檢結果。", {
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
        "Amazon 折扣預檢未通過，尚未寫入任何變更。",
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
      "Amazon 折扣預檢沒有回傳明確的 VALID 狀態，為避免誤改，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }
  return {
    listing,
    standardPrice,
    requestedDiscountedPrice,
    body,
    issues,
  };
}

async function callOrdersApi(
  input: SearchOrdersInput,
  forceTokenRefresh = false,
): Promise<Response> {
  const marketplace = MARKETPLACES[input.marketplaceId];
  const region = marketplace.region;
  const token = await requestAccessToken(region, forceTokenRefresh);
  const query = new URLSearchParams({
    lastUpdatedAfter: input.lastUpdatedAfter,
    marketplaceIds: input.marketplaceId,
    maxResultsPerPage: String(input.maxResultsPerPage ?? 50),
    includedData: "PROCEEDS,FULFILLMENT,CANCELLATION,PROMOTION",
  });

  if (input.fulfillmentStatus && VALID_STATUSES.has(input.fulfillmentStatus)) {
    query.set("fulfillmentStatuses", input.fulfillmentStatus);
  }
  if (input.fulfilledBy === "AMAZON") {
    query.set("fulfilledBy", input.fulfilledBy);
  }
  if (input.paginationToken) {
    query.set("paginationToken", input.paginationToken);
  }

  const url = `${REGION_ENDPOINTS[region]}/orders/2026-01-01/orders?${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    return await fetch(url, {
      headers: {
        accept: "application/json",
        "x-amz-access-token": token,
        "x-amz-date": toAmzDate(),
        "user-agent":
          process.env.SP_API_USER_AGENT ||
          "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon SP-API 回應逾時，請稍後再試。", {
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    throw new SpApiError("目前無法連線至 Amazon SP-API。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLiveOrders(input: SearchOrdersInput): Promise<OrdersSnapshot> {
  let response = await callOrdersApi(input);

  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[input.marketplaceId].region);
    response = await callOrdersApi(input, true);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(retryDelayMs(response, attempt));
    response = await callOrdersApi(input);
  }

  const requestId = response.headers.get("x-amzn-requestid");
  const rateLimit = response.headers.get("x-amzn-ratelimit-limit");

  if (!response.ok) {
    const status = response.status;
    const code =
      status === 401 || status === 403
        ? "UNAUTHORIZED"
        : status === 429
          ? "RATE_LIMITED"
          : "UPSTREAM_UNAVAILABLE";
    const message =
      status === 401 || status === 403
        ? "Amazon 拒絕了這次請求，請確認 app 角色、refresh token 與站點授權。"
        : status === 429
          ? "Amazon API 正在限流，請稍後再重新整理。"
          : "Amazon SP-API 暫時無法完成請求。";

    throw new SpApiError(message, {
      status,
      code,
      requestId,
      retryAfter: response.headers.get("retry-after"),
    });
  }

  const payload = (await response.json()) as SearchOrdersResponse;
  const orders = normalizeOrders(payload.orders, input.marketplaceId).filter(
    (order) => order.fulfilledBy === "AMAZON",
  );
  return {
    mode: "live",
    orders,
    marketplaceId: input.marketplaceId,
    fetchedAt: new Date().toISOString(),
    nextToken: payload.pagination?.nextToken ?? null,
    lastUpdatedBefore: payload.lastUpdatedBefore ?? null,
    requestId,
    rateLimit,
    notice: null,
  };
}

type SalesTrendWindow = {
  timeZone: string;
  startAt: string;
  endAt: string;
  dateKeys: string[];
  intervals: string[];
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  let formatter = zonedFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA-u-hc-h23", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatterCache.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const instant = new Date(Math.floor(date.getTime() / 1_000) * 1_000);
  const parts = zonedDateParts(instant, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((representedAsUtc - instant.getTime()) / 60_000);
}

function offsetText(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(
    absolute % 60,
  ).padStart(2, "0")}`;
}

function zonedIso(date: Date, timeZone: string): string {
  const parts = zonedDateParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(
    parts.minute,
  )}:${pad(parts.second)}${offsetText(timeZoneOffsetMinutes(date, timeZone))}`;
}

function dateKey(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return dateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

function zonedMidnight(value: string, timeZone: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  let instant = localMidnightAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next =
      localMidnightAsUtc -
      timeZoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export function buildSalesTrendWindow(
  marketplaceId: MarketplaceId,
  days: SalesTrendDays,
  now = new Date(),
): SalesTrendWindow {
  if (![7, 14, 30].includes(days) || Number.isNaN(now.getTime())) {
    throw new TypeError("銷售趨勢日期範圍無效。");
  }
  const timeZone = MARKETPLACES[marketplaceId].timeZone;
  const today = zonedDateParts(now, timeZone);
  const todayKey = dateKey(today.year, today.month, today.day);
  const firstKey = shiftDateKey(todayKey, -(days - 1));
  const dateKeys = Array.from({ length: days }, (_, index) =>
    shiftDateKey(firstKey, index),
  );
  const endAt = zonedIso(now, timeZone);
  const intervals = dateKeys.map((key, index) => {
    const start = zonedIso(zonedMidnight(key, timeZone), timeZone);
    const end =
      index === dateKeys.length - 1
        ? endAt
        : zonedIso(zonedMidnight(dateKeys[index + 1], timeZone), timeZone);
    return `${start}--${end}`;
  });
  return {
    timeZone,
    startAt: intervals[0].slice(0, intervals[0].indexOf("--", 10)),
    endAt,
    dateKeys,
    intervals,
  };
}

export function buildSalesTrendQuery(
  marketplaceId: MarketplaceId,
  window: SalesTrendWindow,
): URLSearchParams {
  return new URLSearchParams({
    marketplaceIds: marketplaceId,
    interval: `${window.startAt}--${window.endAt}`,
    granularityTimeZone: window.timeZone,
    granularity: "Day",
    buyerType: "All",
    fulfillmentNetwork: "AFN",
  });
}

function salesMetricDate(value: unknown, timeZone: string): string | null {
  if (typeof value !== "string") return null;
  const delimiter = value.indexOf("--", 10);
  if (delimiter < 0) return null;
  const start = value.slice(0, delimiter);
  const end = value.slice(delimiter + 2);
  const startInstant = new Date(start);
  const endInstant = new Date(end);
  if (
    Number.isNaN(startInstant.getTime()) ||
    Number.isNaN(endInstant.getTime()) ||
    startInstant.getTime() >= endInstant.getTime()
  ) {
    return null;
  }
  const localStart = zonedDateParts(startInstant, timeZone);
  if (localStart.hour !== 0 || localStart.minute !== 0 || localStart.second !== 0) {
    return null;
  }
  return dateKey(localStart.year, localStart.month, localStart.day);
}

function salesTrendTotals(
  points: SalesTrendPoint[],
  currencyCode: string,
): SalesTrendSnapshot["totals"] {
  const totals = points.reduce(
    (result, point) => ({
      amount: result.amount + point.totalSales.amount,
      unitCount: result.unitCount + point.unitCount,
      orderItemCount: result.orderItemCount + point.orderItemCount,
      orderCount: result.orderCount + point.orderCount,
    }),
    { amount: 0, unitCount: 0, orderItemCount: 0, orderCount: 0 },
  );
  const precision = currencyCode === "JPY" ? 0 : 2;
  return {
    totalSales: {
      amount: Number(totals.amount.toFixed(precision)),
      currencyCode,
    },
    unitCount: totals.unitCount,
    orderItemCount: totals.orderItemCount,
    orderCount: totals.orderCount,
  };
}

export function normalizeSalesTrendResponse(input: {
  response: unknown;
  marketplaceId: MarketplaceId;
  days: SalesTrendDays;
  window: SalesTrendWindow;
}): { points: SalesTrendPoint[]; totals: SalesTrendSnapshot["totals"] } {
  if (!input.response || typeof input.response !== "object" || Array.isArray(input.response)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 銷售趨勢。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  const response = input.response as JsonRecord;
  if (response.errors !== undefined && !Array.isArray(response.errors)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 銷售趨勢。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  if (Array.isArray(response.errors) && response.errors.length) {
    const upstreamMessage = response.errors.find(
      (error) =>
        isRecord(error) &&
        typeof error.message === "string" &&
        error.message.trim(),
    );
    throw new SpApiError(
      (isRecord(upstreamMessage) && typeof upstreamMessage.message === "string"
        ? upstreamMessage.message.trim()
        : "") ||
        "Amazon 無法完成 FBA 銷售趨勢查詢。",
      { status: 502, code: "UPSTREAM_UNAVAILABLE" },
    );
  }
  if (!Array.isArray(response.payload)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 銷售趨勢。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }

  const currencyCode = MARKETPLACES[input.marketplaceId].currency;
  const expectedDates = new Set(input.window.dateKeys);
  const byDate = new Map<string, SalesTrendPoint>();
  for (const rawMetric of response.payload) {
    if (!isRecord(rawMetric)) {
      throw new SpApiError("Amazon 回傳了無法辨識的 FBA 銷售趨勢。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    const metric = rawMetric as AmazonSalesMetric;
    const metricDate = salesMetricDate(metric.interval, input.window.timeZone);
    const amount = finiteNumericValue(metric.totalSales?.amount);
    const unitCount = finiteNonNegativeInteger(metric.unitCount);
    const orderItemCount = finiteNonNegativeInteger(metric.orderItemCount);
    const orderCount = finiteNonNegativeInteger(metric.orderCount);
    if (
      !metricDate ||
      !expectedDates.has(metricDate) ||
      byDate.has(metricDate) ||
      amount === null ||
      amount < 0 ||
      metric.totalSales?.currencyCode !== currencyCode ||
      unitCount === null ||
      orderItemCount === null ||
      orderCount === null
    ) {
      throw new SpApiError("Amazon 回傳了無法辨識的 FBA 銷售趨勢。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    byDate.set(metricDate, {
      date: metricDate,
      interval: metric.interval!,
      totalSales: { amount, currencyCode },
      unitCount,
      orderItemCount,
      orderCount,
      partial: metricDate === input.window.dateKeys.at(-1),
    });
  }

  const points = input.window.dateKeys.map((key, index) =>
    byDate.get(key) ?? {
      date: key,
      interval: input.window.intervals[index],
      totalSales: { amount: 0, currencyCode },
      unitCount: 0,
      orderItemCount: 0,
      orderCount: 0,
      partial: index === input.window.dateKeys.length - 1,
    },
  );
  return { points, totals: salesTrendTotals(points, currencyCode) };
}

async function callSalesTrendApi(
  marketplaceId: MarketplaceId,
  window: SalesTrendWindow,
  forceTokenRefresh = false,
): Promise<Response> {
  const marketplace = MARKETPLACES[marketplaceId];
  const token = await requestAccessToken(marketplace.region, forceTokenRefresh);
  const query = buildSalesTrendQuery(marketplaceId, window);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(
      `${REGION_ENDPOINTS[marketplace.region]}/sales/v1/orderMetrics?${query}`,
      {
        headers: {
          accept: "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(),
          "user-agent":
            process.env.SP_API_USER_AGENT ||
            "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon FBA 銷售趨勢查詢逾時，請稍後再試。", {
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    throw new SpApiError("目前無法連線至 Amazon Sales API。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLiveSalesTrend(input: {
  marketplaceId: MarketplaceId;
  days: SalesTrendDays;
}): Promise<SalesTrendSnapshot> {
  const window = buildSalesTrendWindow(input.marketplaceId, input.days);
  let response = await callSalesTrendApi(input.marketplaceId, window);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[input.marketplaceId].region);
    response = await callSalesTrendApi(input.marketplaceId, window, true);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(retryDelayMs(response, attempt));
    response = await callSalesTrendApi(input.marketplaceId, window);
  }
  const requestId = response.headers.get("x-amzn-requestid");
  if (!response.ok) {
    const payload = await parseResponseJson<AmazonSalesMetricsResponse>(response);
    const upstreamMessage = payload?.errors?.find(
      (error) => typeof error?.message === "string" && error.message.trim(),
    )?.message;
    const message =
      response.status === 401 || response.status === 403
        ? "Amazon 拒絕 FBA 銷售趨勢查詢。請確認 Private SP-API App 具有 Inventory and Order Tracking（或 Product Listing）角色並重新授權。"
        : response.status === 429
          ? "Amazon Sales API 正在限流，請稍後再試。"
          : upstreamMessage || "Amazon 暫時無法完成 FBA 銷售趨勢查詢。";
    throw new SpApiError(message, {
      status: response.status,
      code:
        response.status === 401 || response.status === 403
          ? "SALES_METRICS_UNAUTHORIZED"
          : response.status === 429
            ? "RATE_LIMITED"
            : "UPSTREAM_UNAVAILABLE",
      requestId,
      retryAfter: response.headers.get("retry-after"),
    });
  }
  const payload = await parseResponseJson<AmazonSalesMetricsResponse>(response);
  const normalized = normalizeSalesTrendResponse({
    response: payload,
    marketplaceId: input.marketplaceId,
    days: input.days,
    window,
  });
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    days: input.days,
    timeZone: window.timeZone,
    ...normalized,
    fetchedAt: new Date().toISOString(),
    requestId,
    rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
    notice: "Sales API 以站點當地日界彙總；僅包含 Amazon 配送（AFN/FBA），今日數字仍會變動。",
  };
}

async function callFbaInventoryApi(
  marketplaceId: MarketplaceId,
  sellerSku: string,
  forceTokenRefresh = false,
): Promise<Response> {
  const marketplace = MARKETPLACES[marketplaceId];
  const token = await requestAccessToken(marketplace.region, forceTokenRefresh);
  const query = new URLSearchParams({
    granularityType: "Marketplace",
    granularityId: marketplaceId,
    marketplaceIds: marketplaceId,
    details: "true",
    sellerSkus: sellerSku,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(
      `${REGION_ENDPOINTS[marketplace.region]}/fba/inventory/v1/summaries?${query}`,
      {
        headers: {
          accept: "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(),
          "user-agent":
            process.env.SP_API_USER_AGENT ||
            "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon FBA 庫存查詢逾時，請稍後再試。", {
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    throw new SpApiError("目前無法連線至 Amazon FBA Inventory API。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLiveFbaInventorySummary(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): Promise<{
  summary: AmazonInventorySummary;
  requestId: string | null;
  rateLimit: string | null;
}> {
  let response = await callFbaInventoryApi(marketplaceId, sellerSku);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callFbaInventoryApi(marketplaceId, sellerSku, true);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(retryDelayMs(response, attempt));
    response = await callFbaInventoryApi(marketplaceId, sellerSku);
  }
  const requestId = response.headers.get("x-amzn-requestid");
  if (!response.ok) {
    const payload = await parseResponseJson<{
      errors?: Array<{ message?: string }>;
    }>(response);
    const upstreamMessage = payload?.errors?.find((item) => item.message)?.message;
    throw new SpApiError(
      response.status === 401 || response.status === 403
        ? "Amazon 拒絕 FBA 庫存查詢。請確認 app 具有 Amazon Fulfillment 角色並重新授權。"
        : response.status === 429
          ? "Amazon FBA Inventory API 正在限流，請稍後再試。"
          : upstreamMessage || "Amazon 暫時無法完成 FBA 庫存查詢。",
      {
        status: response.status,
        code:
          response.status === 401 || response.status === 403
            ? "FBA_INVENTORY_UNAUTHORIZED"
            : response.status === 429
              ? "RATE_LIMITED"
              : "UPSTREAM_UNAVAILABLE",
        requestId,
        retryAfter: response.headers.get("retry-after"),
      },
    );
  }
  const payload = await parseResponseJson<AmazonInventorySummariesResponse>(
    response,
  );
  const summaries = inventorySummariesFromResponse(payload);
  if (!summaries) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 庫存資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId,
    });
  }
  const summary = findExactInventorySummary(summaries, sellerSku);
  if (!summary) {
    throw new SpApiError("Amazon FBA 庫存中找不到這個 SKU。", {
      status: 404,
      code: "FBA_SKU_NOT_FOUND",
      requestId,
    });
  }
  return {
    summary,
    requestId,
    rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
  };
}

const SELLER_REPLENISHMENT_MARKETPLACES = new Set<MarketplaceId>([
  "ATVPDKIKX0DER",
  "A1VC38T7YXB528",
  "A2EUQ1WTGCTBG2",
  "A1F83G8C2ARO7P",
  "A1PA6795UKMFR9",
]);

async function callReplenishmentOffersApi(
  marketplaceId: MarketplaceId,
  sellerSku: string,
  forceTokenRefresh = false,
): Promise<Response> {
  const marketplace = MARKETPLACES[marketplaceId];
  const token = await requestAccessToken(
    marketplace.region,
    forceTokenRefresh,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const url = `${REGION_ENDPOINTS[marketplace.region]}/replenishment/2022-11-07/offers/search`;
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-amz-access-token": token,
        "x-amz-date": toAmzDate(),
        "user-agent":
          process.env.SP_API_USER_AGENT ||
          "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
      },
      body: JSON.stringify({
        pagination: { limit: 20, offset: 0 },
        filters: {
          marketplaceId,
          programTypes: ["SUBSCRIBE_AND_SAVE"],
          skus: [sellerSku],
        },
        sort: { order: "ASC", key: "ASIN" },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon Subscribe & Save 查詢逾時，請稍後再試。", {
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    throw new SpApiError("目前無法連線至 Amazon Replenishment API。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function executeReplenishmentOffersRequest(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): Promise<Response> {
  let response = await callReplenishmentOffersApi(marketplaceId, sellerSku);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callReplenishmentOffersApi(marketplaceId, sellerSku, true);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(retryDelayMs(response, attempt));
    response = await callReplenishmentOffersApi(marketplaceId, sellerSku);
  }
  return response;
}

async function throwReplenishmentError(response: Response): Promise<never> {
  const payload = await parseResponseJson<{
    errors?: Array<{ code?: string; message?: string }>;
  }>(response);
  const requestId = response.headers.get("x-amzn-requestid");
  const upstreamMessage = payload?.errors?.find(
    (error) => typeof error.message === "string" && error.message.trim(),
  )?.message;
  if (response.status === 401 || response.status === 403) {
    throw new SpApiError(
      "Amazon 拒絕 Subscribe & Save 查詢。請確認 app 具備 Inventory and Order Tracking 或 Brand Analytics 角色，並重新授權 refresh token。",
      {
        status: response.status,
        code: "REPLENISHMENT_UNAUTHORIZED",
        requestId,
      },
    );
  }
  if (response.status === 429) {
    throw new SpApiError("Amazon Replenishment API 正在限流，請稍後再試。", {
      status: 429,
      code: "RATE_LIMITED",
      requestId,
      retryAfter: response.headers.get("retry-after"),
    });
  }
  throw new SpApiError(
    upstreamMessage
      ? `Amazon 無法完成 Subscribe & Save 查詢。（${upstreamMessage}）`
      : "Amazon 無法完成 Subscribe & Save 查詢。",
    {
      status: response.status,
      code: "UPSTREAM_UNAVAILABLE",
      requestId,
    },
  );
}

function normalizeSubscribeAndSaveOffer(
  marketplaceId: MarketplaceId,
  sellerSku: string,
  offer: AmazonReplenishmentOffer | undefined,
  response: Response,
): SubscribeAndSaveOfferSnapshot {
  const promotions = offer?.offerProgramConfiguration?.promotions;
  const forecast = offer?.forecastDeliveries;
  const rawPrice = finiteNumericValue(offer?.price);
  const priceCurrency =
    typeof offer?.priceCurrencyCode === "string" && offer.priceCurrencyCode
      ? offer.priceCurrencyCode
      : MARKETPLACES[marketplaceId].currency;
  return {
    mode: "live",
    marketplaceId,
    sellerSku,
    found: Boolean(offer),
    asin: offer?.asin?.trim() || null,
    eligibility: offer?.eligibility?.trim() || null,
    enrollmentMethod:
      offer?.offerProgramConfiguration?.enrollmentMethod?.trim() || null,
    autoEnrollment:
      offer?.offerProgramConfiguration?.preferences?.autoEnrollment?.trim() ||
      null,
    sellerFundedBaseDiscount: finitePercentage(
      promotions?.sellingPartnerFundedBaseDiscount?.percentage,
    ),
    sellerFundedTieredDiscount: finitePercentage(
      promotions?.sellingPartnerFundedTieredDiscount?.percentage,
    ),
    amazonFundedBaseDiscount: finitePercentage(
      promotions?.amazonFundedBaseDiscount?.percentage,
    ),
    amazonFundedTieredDiscount: finitePercentage(
      promotions?.amazonFundedTieredDiscount?.percentage,
    ),
    price: rawPrice !== null
      ? { amount: rawPrice, currencyCode: priceCurrency }
      : null,
    inventory: finiteNonNegativeInteger(offer?.inventory),
    subscriptions: finiteNonNegativeInteger(offer?.subscriptions),
    stockRisk: offer?.stockRisk?.trim() || null,
    forecastDeliveries: forecast
      ? {
          next15Days: finiteNonNegativeInteger(forecast.next15DaysDeliveries),
          next30Days: finiteNonNegativeInteger(forecast.next30DaysDeliveries),
          next60Days: finiteNonNegativeInteger(forecast.next60DaysDeliveries),
          next90Days: finiteNonNegativeInteger(forecast.next90DaysDeliveries),
        }
      : null,
    deliveryConditions: (offer?.deliveriesConditions ?? [])
      .filter(
        (condition) =>
          typeof condition.condition === "string" &&
          Boolean(condition.condition.trim()),
      )
      .map((condition) => ({
        condition: condition.condition!.trim(),
        next30DaysDeliveries: finiteNonNegativeInteger(
          condition.next30DaysDeliveries,
        ),
      })),
    fetchedAt: new Date().toISOString(),
    requestId: response.headers.get("x-amzn-requestid"),
    rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
    notice: offer
      ? "Replenishment API 是唯讀查詢；啟用、停用與折扣調整仍需在 Seller Central 完成。"
      : "Amazon 未回傳此 SKU 的 Subscribe & Save offer；不代表一定不符合資格。",
    writable: false,
  };
}

async function fetchLiveSubscribeAndSaveOffer(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): Promise<SubscribeAndSaveOfferSnapshot> {
  if (!SELLER_REPLENISHMENT_MARKETPLACES.has(marketplaceId)) {
    throw new SpApiError(
      `${MARKETPLACES[marketplaceId].label}站目前不在 Amazon 公開的 Seller Replenishment API 支援清單。`,
      { status: 422, code: "REPLENISHMENT_MARKETPLACE_UNSUPPORTED" },
    );
  }
  const response = await executeReplenishmentOffersRequest(
    marketplaceId,
    sellerSku,
  );
  if (!response.ok) return throwReplenishmentError(response);
  const payload = await parseResponseJson<AmazonReplenishmentOffersResponse>(
    response,
  );
  if (!payload || !Array.isArray(payload.offers)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 Subscribe & Save 資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  const offer = payload.offers.find((item) => item.sku === sellerSku);
  return normalizeSubscribeAndSaveOffer(
    marketplaceId,
    sellerSku,
    offer,
    response,
  );
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function buildDemoOrders(marketplaceId: MarketplaceId): DashboardOrder[] {
  const marketplace = MARKETPLACES[marketplaceId];
  const isJapan = marketplaceId === "A1VC38T7YXB528";
  const products = isJapan
    ? [
        ["AFA100-JP", "B0JPFA1001", "Afreschi 七面鳥筋肉ジャーキー 100g", 1680],
        ["GTC454-JP", "B0JPGTC454", "GooToE チキンジャーキー 454g", 2980],
        ["AFA285-JP", "B0JPFA2851", "Afreschi ターキーテンドン 285g", 3680],
        ["HERZ-SC-JP", "B0JPHERZ01", "HERZ ソフトチキントリーツ", 1280],
      ]
    : [
        ["AFA-TRKY-4OZ", "B0USAFA004", "Afreschi Turkey Tendon Jerky, 4 oz", 13.99],
        ["GTC-CHKN-1LB", "B0USGTC001", "GooToE Chicken Jerky Treats, 1 lb", 14.99],
        ["AFA-TRKY-285G", "B0USAFA285", "Afreschi Turkey Tendon, 10 oz", 29.99],
        ["ACTL-TRAIN-8OZ", "B0USACTL08", "Afreschi Training-Friendly Chicken Treats", 16.49],
      ];
  const statuses = [
    "UNSHIPPED",
    "SHIPPED",
    "SHIPPED",
    "PARTIALLY_SHIPPED",
    "CANCELLED",
    "PENDING",
    "SHIPPED",
    "UNSHIPPED",
  ];

  return statuses.map((status, index) => {
    const product = products[index % products.length];
    const quantity = (index % 3) + 1;
    const unitAmount = Number(product[3]);
    const itemTotal = status === "CANCELLED" ? 0 : unitAmount * quantity;
    const createdTime = isoHoursAgo(3 + index * 11);

    return {
      orderId: `DEMO-${isJapan ? "JP" : "US"}-${String(840215 + index).padStart(7, "0")}`,
      createdTime,
      lastUpdatedTime: isoHoursAgo(1 + index * 8),
      marketplaceId,
      marketplaceName: marketplace.name,
      programs: index % 2 === 0 ? ["PRIME"] : [],
      fulfillmentStatus: status,
      fulfilledBy: "AMAZON",
      fulfillmentServiceLevel: index % 2 === 0 ? "EXPEDITED" : "STANDARD",
      shipBy:
        status === "CANCELLED"
          ? null
          : new Date(Date.now() + (index + 1) * 8 * 3_600_000).toISOString(),
      deliverBy:
        status === "CANCELLED"
          ? null
          : new Date(Date.now() + (index + 2) * 24 * 3_600_000).toISOString(),
      total: { amount: itemTotal, currencyCode: marketplace.currency },
      items: [
        {
          orderItemId: `DEMO-ITEM-${index + 1}`,
          sellerSku: String(product[0]),
          asin: String(product[1]),
          title: String(product[2]),
          quantity,
          unitPrice: { amount: unitAmount, currencyCode: marketplace.currency },
          lineTotal: { amount: itemTotal, currencyCode: marketplace.currency },
        },
      ],
    };
  });
}

const demoPriceOverrides = new Map<string, number>();
const demoSalePriceOverrides = new Map<
  string,
  { amount: number; startAt: string; endAt: string } | null
>();
const demoContentOverrides = new Map<string, ListingContentValues>();
const demoImageOverrides = new Map<string, Array<string | null>>();

function demoPriceKey(marketplaceId: MarketplaceId, sellerSku: string): string {
  return `${marketplaceId}:${sellerSku}`;
}

function getDemoListingPrice(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): ListingPriceSnapshot {
  const marketplace = MARKETPLACES[marketplaceId];
  const item = buildDemoOrders(marketplaceId)
    .flatMap((order) => order.items)
    .find((candidate) => candidate.sellerSku === sellerSku);

  if (!item || !item.unitPrice) {
    const sampleSku =
      marketplaceId === "A1VC38T7YXB528" ? "AFA100-JP" : "AFA-TRKY-4OZ";
    throw new SpApiError(
      `展示資料找不到這個 SKU。可先試用 ${sampleSku}。`,
      { status: 404, code: "SKU_NOT_FOUND" },
    );
  }

  const amount =
    demoPriceOverrides.get(demoPriceKey(marketplaceId, sellerSku)) ??
    item.unitPrice.amount;
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
      : marketplaceId === "A1VC38T7YXB528"
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
    discountedPrice,
    hasDiscountedPrice: Boolean(discountedPrice),
    hasAutomatedPricing: false,
    fetchedAt: new Date().toISOString(),
    requestId: null,
    issues,
    fulfillmentAvailability: [
      {
        channelCode:
          marketplaceId === "A1VC38T7YXB528" ? "AMAZON_JP" : "AMAZON_NA",
        quantity,
        fulfillment: "FBA",
        editable: false,
      },
    ],
    notice: "展示模式只會模擬價格與商品內容變更，不會更動 Amazon。",
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
  const isJapan = marketplaceId === "A1VC38T7YXB528";
  const base: ListingContentValues = {
    title: listing.title,
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
    bulletPoints: content.bulletPoints,
    ingredients: content.ingredients,
    languageTag,
    attributePresence: {
      title: true,
      bulletPoints: true,
      ingredients: true,
    },
    capabilities: {
      title: demoCapability({
        maxLength: 200,
        languageTags: [languageTag],
      }),
      bulletPoints: demoCapability({
        minItems: 1,
        maxItems: 5,
        maxLength: 500,
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
  if (!SELLER_REPLENISHMENT_MARKETPLACES.has(marketplaceId)) {
    throw new SpApiError(
      `${MARKETPLACES[marketplaceId].label}站目前不在 Amazon 公開的 Seller Replenishment API 支援清單。`,
      { status: 422, code: "REPLENISHMENT_MARKETPLACE_UNSUPPORTED" },
    );
  }
  const listing = getDemoListingPrice(marketplaceId, sellerSku);
  const fba = listing.fulfillmentAvailability.find(
    (availability) => availability.fulfillment === "FBA",
  );
  const found = Boolean(fba);
  const isJapan = marketplaceId === "A1VC38T7YXB528";
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
  return fetchLiveSubscribeAndSaveOffer(
    input.marketplaceId,
    input.sellerSku,
  );
}

export async function getListingPrice(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
}): Promise<ListingPriceSnapshot> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    return getDemoListingPrice(input.marketplaceId, input.sellerSku);
  }
  return fetchLiveListingPrice(input.marketplaceId, input.sellerSku);
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
    bulletPoints: values.bulletPoints
      .map(normalizeContentText)
      .filter(Boolean)
      .slice(0, 5),
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
  changedFields: Array<"title" | "bulletPoints" | "ingredients">;
} {
  const previous = normalizeContentValues({
    title: listing.title,
    bulletPoints: listing.bulletPoints,
    ingredients: listing.ingredients,
  });
  const expected = normalizeContentValues({
    title: input.expectedTitle,
    bulletPoints: input.expectedBulletPoints,
    ingredients: input.expectedIngredients,
  });
  const requested = normalizeContentValues(input);
  if (
    previous.title !== expected.title ||
    !sameTextArray(previous.bulletPoints, expected.bulletPoints) ||
    previous.ingredients !== expected.ingredients
  ) {
    throw new SpApiError(
      "商品內容已在查詢後發生變動。請重新查詢 SKU，再確認一次。",
      { status: 409, code: "CONTENT_CHANGED" },
    );
  }

  const changedFields: Array<"title" | "bulletPoints" | "ingredients"> = [];
  if (requested.title !== previous.title) changedFields.push("title");
  if (!sameTextArray(requested.bulletPoints, previous.bulletPoints)) {
    changedFields.push("bulletPoints");
  }
  if (requested.ingredients !== previous.ingredients) {
    changedFields.push("ingredients");
  }
  if (!changedFields.length) {
    throw new SpApiError("標題、五大賣點與成分都沒有變更。", {
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
  changedFields: Array<"title" | "bulletPoints" | "ingredients">,
): { productType: string; patches: unknown[] } {
  const value = (text: string) => ({
    value: text,
    language_tag: listing.languageTag,
    marketplace_id: listing.marketplaceId,
  });
  const attributeValue = (
    attributeName: "item_name" | "bullet_point" | "ingredients",
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
  changedFields: Array<"title" | "bulletPoints" | "ingredients">;
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
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body,
    validationPreview: true,
  });
  if (!response.ok) return throwListingsError(response, "read");
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
  const value = attributeObjects(payload, attributeName, marketplaceId)
    .map((item) => item.media_location)
    .find((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return value?.trim() || null;
}

function normalizeImageUrls(values: Array<string | null>): Array<string | null> {
  return IMAGE_ATTRIBUTE_NAMES.map((_, index) => {
    const value = values[index];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  });
}

function assertImageUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SpApiError(`${label}不是有效的圖片 URL。`, {
      status: 422,
      code: "INVALID_IMAGE_URL",
    });
  }
  if (url.protocol !== "https:" && url.protocol !== "s3:") {
    throw new SpApiError(`${label}必須使用 HTTPS 或已授權的 S3 URL。`, {
      status: 422,
      code: "INVALID_IMAGE_URL",
    });
  }
  if (value.length > 2_000) {
    throw new SpApiError(`${label} URL 過長。`, {
      status: 422,
      code: "INVALID_IMAGE_URL",
    });
  }
}

function imageUrlsEqual(
  left: Array<string | null>,
  right: Array<string | null>,
): boolean {
  const a = normalizeImageUrls(left);
  const b = normalizeImageUrls(right);
  return a.every((value, index) => value === b[index]);
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
      listing.mode === "live"
        ? "圖片 URL 取自 Listing attributes；Amazon 接受後仍會非同步下載與審核。"
        : "展示模式可測試排序與預檢，不會更動 Amazon。",
  };
}

export async function getListingImages(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
}): Promise<ListingImageSnapshot> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    return imageSnapshotFromContext(
      getDemoListingContent(input.marketplaceId, input.sellerSku),
    );
  }
  const context = await fetchLiveListingContentContext(
    input.marketplaceId,
    input.sellerSku,
  );
  return imageSnapshotFromContext(context.listing, context.payload);
}

function verifyImageChange(
  snapshot: ListingImageSnapshot,
  input: UpdateListingImagesInput,
): {
  previousUrls: Array<string | null>;
  requestedUrls: Array<string | null>;
  changedSlots: number[];
} {
  const previousUrls = snapshot.images.map((item) => item.url);
  const expectedUrls = normalizeImageUrls(input.expectedUrls);
  if (!imageUrlsEqual(previousUrls, expectedUrls)) {
    throw new SpApiError(
      "Amazon 圖片已被其他人更新。請重新查詢 SKU，再套用這次排序。",
      { status: 409, code: "STALE_LISTING" },
    );
  }
  const requestedUrls = normalizeImageUrls(input.urls);
  if (!requestedUrls[0]) {
    throw new SpApiError("主圖不可留空。請先上傳或貼上主圖 URL。", {
      status: 422,
      code: "MAIN_IMAGE_REQUIRED",
    });
  }
  requestedUrls.forEach((url, index) => {
    if (url) assertImageUrl(url, index === 0 ? "主圖" : `副圖 ${index}`);
  });
  const changedSlots = requestedUrls.flatMap((url, index) =>
    url === previousUrls[index] ? [] : [index],
  );
  if (!changedSlots.length) {
    throw new SpApiError("圖片與 Amazon 目前內容相同，沒有需要送出的變更。", {
      status: 422,
      code: "NO_CHANGES",
    });
  }
  for (const index of changedSlots) {
    const capability = snapshot.images[index]?.capability;
    if (!capability?.supported || !capability.editable) {
      throw new SpApiError(
        capability?.reason || `${index === 0 ? "主圖" : `副圖 ${index}`}不可由 API 修改。`,
        { status: 422, code: "IMAGE_FIELD_READ_ONLY" },
      );
    }
    if (!requestedUrls[index] && capability.required) {
      throw new SpApiError(`${capability.label}是 Amazon 必填欄位，不能清除。`, {
        status: 422,
        code: "MAIN_IMAGE_REQUIRED",
      });
    }
  }
  return { previousUrls, requestedUrls, changedSlots };
}

function buildImagePatchBody(
  snapshot: ListingImageSnapshot,
  verified: ReturnType<typeof verifyImageChange>,
  payload: AmazonListingItem,
) {
  return {
    productType: snapshot.productType,
    patches: verified.changedSlots.map((index) => {
      const attributeName = snapshot.images[index].attributeName;
      const requested = verified.requestedUrls[index];
      const previous = verified.previousUrls[index];
      if (!requested) {
        const existing = attributeObjects(
          payload,
          attributeName,
          snapshot.marketplaceId,
        );
        return {
          op: "delete",
          path: `/attributes/${attributeName}`,
          value: existing.length
            ? existing
            : [{ media_location: previous, marketplace_id: snapshot.marketplaceId }],
        };
      }
      return {
        op: previous ? "replace" : "add",
        path: `/attributes/${attributeName}`,
        value: [
          {
            media_location: requested,
            marketplace_id: snapshot.marketplaceId,
          },
        ],
      };
    }),
  };
}

async function prepareLiveImageUpdate(input: UpdateListingImagesInput) {
  const context = await fetchLiveListingContentContext(
    input.marketplaceId,
    input.sellerSku,
  );
  const snapshot = imageSnapshotFromContext(context.listing, context.payload);
  const verified = verifyImageChange(snapshot, input);
  const body = buildImagePatchBody(snapshot, verified, context.payload);
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body,
    validationPreview: true,
  });
  if (!response.ok) return throwListingsError(response, "write");
  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError("Amazon 圖片預檢回應無法辨識，已停止送出。", {
      status: 502,
      code: "VALIDATION_STATUS_UNKNOWN",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  const issues = normalizeListingIssues(payload.issues);
  if (
    payload.status !== "VALID" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 圖片預檢未通過，尚未寫入任何變更。",
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }
  return { snapshot, verified, body, issues };
}

export async function previewListingImageUpdate(
  input: UpdateListingImagesInput,
): Promise<ListingImageUpdateResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const snapshot = await getListingImages(input);
    const verified = verifyImageChange(snapshot, input);
    return {
      mode: "demo",
      status: "SIMULATED",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      ...verified,
      completedAt: new Date().toISOString(),
      submissionId: null,
      requestId: null,
      issues: [],
      notice: "展示預檢已通過；最終送出只會模擬。",
    };
  }
  const prepared = await prepareLiveImageUpdate(input);
  return {
    mode: "live",
    status: "VALID",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    ...prepared.verified,
    completedAt: new Date().toISOString(),
    submissionId: null,
    requestId: null,
    issues: prepared.issues,
    notice: "Amazon 圖片預檢通過；尚未寫入 Listing。",
  };
}

export async function updateListingImages(
  input: UpdateListingImagesInput,
): Promise<ListingImageUpdateResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const snapshot = await getListingImages(input);
    const verified = verifyImageChange(snapshot, input);
    demoImageOverrides.set(
      demoPriceKey(input.marketplaceId, input.sellerSku),
      verified.requestedUrls,
    );
    return {
      mode: "demo",
      status: "SIMULATED",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      ...verified,
      completedAt: new Date().toISOString(),
      submissionId: null,
      requestId: null,
      issues: [],
      notice: "模擬圖片更新完成；Amazon 真實圖片沒有變更。",
    };
  }
  const prepared = await prepareLiveImageUpdate(input);
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body: prepared.body,
  });
  if (!response.ok) return throwListingsError(response, "write");
  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError(
      "Amazon 已收到圖片請求，但回應無法辨識。請重新查詢 SKU，不要直接重送。",
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
        "Amazon 未接受這次圖片更新。",
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
    ...prepared.verified,
    completedAt: new Date().toISOString(),
    submissionId: payload.submissionId ?? null,
    requestId: response.headers.get("x-amzn-requestid"),
    issues,
    notice: "Amazon 已接受圖片更新；圖片下載與審核完成前，買家頁可能仍顯示舊圖。",
  };
}

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

  const prepared = await prepareLiveContentUpdate(input);
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body: prepared.body,
  });
  if (!response.ok) return throwListingsError(response, "write");
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

type ReportsRequestInput = {
  marketplaceId: MarketplaceId;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  forceTokenRefresh?: boolean;
};

async function callReportsApi(input: ReportsRequestInput): Promise<Response> {
  const marketplace = MARKETPLACES[input.marketplaceId];
  const token = await requestAccessToken(
    marketplace.region,
    input.forceTokenRefresh ?? false,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const method = input.method ?? "GET";
  try {
    return await fetch(
      `${REGION_ENDPOINTS[marketplace.region]}/reports/2021-06-30${input.path}`,
      {
        method,
        headers: {
          accept: "application/json",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(),
          "user-agent":
            process.env.SP_API_USER_AGENT ||
            "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
        },
        body: method === "POST" ? JSON.stringify(input.body) : undefined,
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon 全商品報表查詢逾時，請稍後再試。", {
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    throw new SpApiError("目前無法連線至 Amazon Reports API。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function executeReportsRequest(
  input: ReportsRequestInput,
): Promise<Response> {
  let response = await callReportsApi(input);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[input.marketplaceId].region);
    response = await callReportsApi({ ...input, forceTokenRefresh: true });
  }
  if ((input.method ?? "GET") === "GET") {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (![429, 500, 503].includes(response.status)) break;
      await wait(retryDelayMs(response, attempt));
      response = await callReportsApi(input);
    }
  }
  return response;
}

async function throwReportsError(response: Response): Promise<never> {
  const payload = await parseResponseJson<{
    errors?: Array<{ code?: string; message?: string }>;
  }>(response);
  const upstreamMessage = payload?.errors?.find(
    (error) => typeof error.message === "string" && error.message.trim(),
  )?.message;
  const message =
    response.status === 429
      ? "Amazon 正在限制報表請求頻率，請稍後再試。"
      : response.status === 401 || response.status === 403
        ? "Amazon 拒絕報表查詢，請確認 app 已有 Product Listing 權限並重新授權。"
        : "Amazon 無法完成全商品報表。";
  throw new SpApiError(
    upstreamMessage ? `${message}（${upstreamMessage}）` : message,
    {
      status: response.status,
      code: response.status === 429 ? "RATE_LIMITED" : "REPORT_FAILED",
      requestId: response.headers.get("x-amzn-requestid"),
      retryAfter: response.headers.get("retry-after"),
    },
  );
}

export async function startAllListingsReport(input: {
  marketplaceId: MarketplaceId;
}): Promise<ListingReportStatus> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    return {
      mode: "demo",
      ready: true,
      reportId: `demo-${input.marketplaceId}`,
      documentId: `demo-${input.marketplaceId}`,
      status: "DONE",
      notice: "展示報表已準備完成。",
    };
  }
  const response = await executeReportsRequest({
    marketplaceId: input.marketplaceId,
    path: "/reports",
    method: "POST",
    body: {
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      marketplaceIds: [input.marketplaceId],
      reportOptions: {
        preferredReportDocumentLocale: "en_US",
      },
    },
  });
  if (!response.ok) return throwReportsError(response);
  const payload = await parseResponseJson<AmazonReport>(response);
  if (!payload?.reportId) {
    throw new SpApiError("Amazon 沒有回傳有效的報表編號。", {
      status: 502,
      code: "REPORT_FAILED",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  return {
    mode: "live",
    ready: false,
    reportId: payload.reportId,
    documentId: null,
    status: "IN_QUEUE",
    notice: "Amazon 正在準備全商品清單，完成後會自動下載。",
  };
}

export async function getAllListingsReportStatus(input: {
  marketplaceId: MarketplaceId;
  reportId: string;
}): Promise<ListingReportStatus> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    return {
      mode: "demo",
      ready: true,
      reportId: input.reportId,
      documentId: `demo-${input.marketplaceId}`,
      status: "DONE",
      notice: "展示報表已準備完成。",
    };
  }
  const response = await executeReportsRequest({
    marketplaceId: input.marketplaceId,
    path: `/reports/${encodeURIComponent(input.reportId)}`,
  });
  if (!response.ok) return throwReportsError(response);
  const payload = await parseResponseJson<AmazonReport>(response);
  if (
    payload?.reportType !== "GET_MERCHANT_LISTINGS_ALL_DATA" ||
    !Array.isArray(payload.marketplaceIds) ||
    payload.marketplaceIds.length !== 1 ||
    payload.marketplaceIds[0] !== input.marketplaceId
  ) {
    throw new SpApiError(
      "這份 Amazon 報表不屬於目前選擇的站點或商品清單類型，已停止下載。",
      {
        status: 409,
        code: "REPORT_MISMATCH",
        requestId: response.headers.get("x-amzn-requestid"),
      },
    );
  }
  const status = payload?.processingStatus;
  if (!status) {
    throw new SpApiError("Amazon 回傳了無法辨識的報表狀態。", {
      status: 502,
      code: "REPORT_FAILED",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  if (status === "CANCELLED" || status === "FATAL") {
    throw new SpApiError("Amazon 未能產生這份全商品報表，請重新匯出。", {
      status: 422,
      code: "REPORT_FAILED",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  const ready = status === "DONE" && Boolean(payload.reportDocumentId);
  return {
    mode: "live",
    ready,
    reportId: input.reportId,
    documentId: payload.reportDocumentId ?? null,
    status,
    notice: ready
      ? "Amazon 全商品清單已就緒，正在整理 Excel。"
      : "Amazon 正在準備全商品清單，完成後會自動下載。",
  };
}

async function downloadReportDocument(
  marketplaceId: MarketplaceId,
  documentId: string,
): Promise<string> {
  const response = await executeReportsRequest({
    marketplaceId,
    path: `/documents/${encodeURIComponent(documentId)}`,
  });
  if (!response.ok) return throwReportsError(response);
  const document = await parseResponseJson<AmazonReportDocument>(response);
  if (!document?.url) {
    throw new SpApiError("Amazon 沒有回傳可下載的報表文件。", {
      status: 502,
      code: "REPORT_FAILED",
    });
  }
  let reportUrl: URL;
  try {
    reportUrl = new URL(document.url);
  } catch {
    throw new SpApiError("Amazon 回傳的報表網址無效。", {
      status: 502,
      code: "REPORT_FAILED",
    });
  }
  const allowedAwsHost =
    reportUrl.hostname === "amazonaws.com" ||
    reportUrl.hostname.endsWith(".amazonaws.com") ||
    reportUrl.hostname.endsWith(".amazonaws.com.cn") ||
    reportUrl.hostname.endsWith(".cloudfront.net");
  if (
    reportUrl.protocol !== "https:" ||
    reportUrl.username ||
    reportUrl.password ||
    reportUrl.port ||
    !allowedAwsHost
  ) {
    throw new SpApiError("Amazon 報表網址未通過安全檢查。", {
      status: 502,
      code: "REPORT_FAILED",
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let fileResponse: Response;
  try {
    fileResponse = await fetch(reportUrl, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof SpApiError) throw error;
    throw new SpApiError("Amazon 報表文件下載失敗。", {
      status: 502,
      code: "REPORT_FAILED",
    });
  }
  if (!fileResponse.ok) {
    clearTimeout(timeout);
    throw new SpApiError("Amazon 報表文件暫時無法下載。", {
      status: 502,
      code: "REPORT_FAILED",
    });
  }
  try {
    const compressed = await readResponseWithLimit(fileResponse, 100 * 1024 * 1024);
    let decoded = compressed;
    if (document.compressionAlgorithm === "GZIP") {
      if (typeof DecompressionStream === "undefined") {
        throw new SpApiError("目前執行環境無法解壓 Amazon 報表。", {
          status: 500,
          code: "REPORT_FAILED",
        });
      }
      const stream = new Response(Uint8Array.from(compressed).buffer).body?.pipeThrough(
        new DecompressionStream("gzip"),
      );
      if (!stream) {
        throw new SpApiError("Amazon 報表文件內容為空。", {
          status: 502,
          code: "REPORT_FAILED",
        });
      }
      decoded = await readResponseWithLimit(new Response(stream), 256 * 1024 * 1024);
    } else if (document.compressionAlgorithm) {
      throw new SpApiError("Amazon 回傳了不支援的報表壓縮格式。", {
        status: 502,
        code: "REPORT_FAILED",
      });
    }
    return new TextDecoder().decode(decoded);
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseWithLimit(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new SpApiError("Amazon 報表超過這個 App 的安全大小上限。", {
      status: 413,
      code: "REPORT_TOO_LARGE",
    });
  }
  if (!response.body) {
    throw new SpApiError("Amazon 報表文件內容為空。", {
      status: 502,
      code: "REPORT_FAILED",
    });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new SpApiError("Amazon 報表超過這個 App 的安全大小上限。", {
        status: 413,
        code: "REPORT_TOO_LARGE",
      });
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
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
  if (value.length || row.length) {
    row.push(value);
    if (row.some((cell) => cell.length)) rows.push(row);
  }
  return rows;
}

function normalizedReportHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function reportColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizedReportHeader);
  return candidates
    .map((candidate) => normalized.indexOf(candidate))
    .find((index) => index >= 0) ?? -1;
}

type ListingReportSeed = {
  sellerSku: string;
  asin: string;
  title: string;
};

function reportSeeds(text: string): ListingReportSeed[] {
  const rows = parseTsv(text);
  const headers = rows[0] ?? [];
  let skuIndex = reportColumn(headers, ["seller-sku", "sku"]);
  let asinIndex = reportColumn(headers, ["asin1", "asin"]);
  let titleIndex = reportColumn(headers, ["item-name", "title"]);
  let fulfillmentIndex = reportColumn(headers, [
    "fulfillment-channel",
    "fulfillment-channel-code",
  ]);
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
      /^(?:AMAZON|AFN|DEFAULT|MFN)(?:[_-].*)?$/i.test(value),
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
      {
        status: 502,
        code: "REPORT_FORMAT_UNSUPPORTED",
      },
    );
  }
  const seen = new Set<string>();
  const seeds: ListingReportSeed[] = [];
  for (const row of rows.slice(1)) {
    const sellerSku = row[skuIndex]?.trim();
    if (!sellerSku || seen.has(sellerSku)) continue;
    const fulfillment = row[fulfillmentIndex]?.trim() ?? "";
    if (!/^(AMAZON|AFN)(?:_|$)/i.test(fulfillment)) {
      continue;
    }
    seen.add(sellerSku);
    seeds.push({
      sellerSku,
      asin: asinIndex >= 0 ? row[asinIndex]?.trim() ?? "" : "",
      title: titleIndex >= 0 ? row[titleIndex]?.trim() ?? "" : "",
    });
  }
  return seeds;
}

function exportRowFromListing(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
): ListingExportRow {
  const summary = listingSummary(payload, marketplaceId);
  const languageTag = preferredLanguageTag(payload, marketplaceId);
  return {
    marketplace: MARKETPLACES[marketplaceId].name,
    sellerSku: safeText(payload.sku, "—"),
    asin: summary?.asin?.trim() || "",
    productType: listingProductType(payload, marketplaceId),
    title:
      attributeTextValuesForLanguage(
        payload,
        "item_name",
        marketplaceId,
        languageTag,
      )[0] ??
      safeText(summary?.itemName, ""),
    bulletPoints: attributeTextValuesForLanguage(
      payload,
      "bullet_point",
      marketplaceId,
      languageTag,
    ).slice(0, 5),
    ingredients:
      attributeTextValuesForLanguage(
        payload,
        "ingredients",
        marketplaceId,
        languageTag,
      )[0] ?? "",
    status: Array.isArray(summary?.status) ? summary.status.join(", ") : "",
    updatedAt: summary?.lastUpdatedDate ?? "",
  };
}

async function fetchExportRows(
  marketplaceId: MarketplaceId,
  seeds: ListingReportSeed[],
): Promise<{ rows: ListingExportRow[]; errors: ListingExportError[] }> {
  const bySku = new Map<string, ListingExportRow>();
  const excludedNonFbaSkus = new Set<string>();
  const errors: ListingExportError[] = [];
  const recordListing = (listing: AmazonListingItem): void => {
    const sellerSku = safeText(listing.sku, "—");
    if (!payloadHasFbaAvailability(listing)) {
      excludedNonFbaSkus.add(sellerSku);
      errors.push({
        sellerSku,
        kind: "非 FBA，已略過",
        message: "即時 Listing 資料無法確認為 FBA，因此沒有加入匯出。",
      });
      return;
    }
    const item = exportRowFromListing(listing, marketplaceId);
    bySku.set(item.sellerSku, item);
  };
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
    if (batch.length === 20) {
      batches.push(batch);
      batch = [];
    }
  }
  if (batch.length) batches.push(batch);

  for (const sellerSkus of batches) {
    try {
      if (sellerSkus.length === 1 && sellerSkus[0].includes(",")) {
        const { payload } = await fetchLiveListingItem(
          marketplaceId,
          sellerSkus[0],
        );
        recordListing(payload);
      } else {
        const response = await executeListingsSearchRequest(
          marketplaceId,
          sellerSkus,
        );
        // Some seller accounts reject otherwise-valid multi-SKU search
        // parameters with HTTP 400. Export is read-only, so safely fall back
        // to Amazon's documented getListingsItem endpoint one SKU at a time.
        if (shouldFallbackListingsExport(response.status)) {
          for (const sellerSku of sellerSkus) {
            try {
              const { payload } = await fetchLiveListingItem(
                marketplaceId,
                sellerSku,
              );
              recordListing(payload);
            } catch (error) {
              errors.push({
                sellerSku,
                kind: "查詢失敗",
                message: error instanceof Error ? error.message : "商品內容查詢失敗。",
              });
            }
            await wait(220);
          }
          continue;
        }
        if (!response.ok) return throwListingsError(response, "read");
        const payload = await parseResponseJson<AmazonListingSearchResponse>(
          response,
        );
        if (!payload || !Array.isArray(payload.items)) {
          throw new SpApiError("Amazon 回傳了無法辨識的 Listing 批次資料。", {
            status: 502,
            code: "UPSTREAM_UNAVAILABLE",
          });
        }
        for (const listing of payload.items) {
          recordListing(listing);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "商品內容查詢失敗。";
      sellerSkus.forEach((sellerSku) =>
        errors.push({ sellerSku, kind: "查詢失敗", message }));
    }
    await wait(220);
  }

  const rows = seeds.flatMap((seed) => {
    if (excludedNonFbaSkus.has(seed.sellerSku)) return [];
    const found = bySku.get(seed.sellerSku);
    if (found) {
      if (!found.ingredients) {
        errors.push({
          sellerSku: seed.sellerSku,
          kind: "缺少成分",
          message: "此商品沒有可匯出的 ingredients 值，或商品類型不適用。",
        });
      }
      return [found];
    }
    errors.push({
      sellerSku: seed.sellerSku,
      kind: "內容未回傳",
      message: "報表中有此 FBA SKU，但 Listings Items API 未回傳完整 attributes。",
    });
    return [{
      marketplace: MARKETPLACES[marketplaceId].name,
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      productType: "",
      title: seed.title,
      bulletPoints: [],
      ingredients: "",
      status: "",
      updatedAt: "",
    }];
  });
  return { rows, errors };
}

export async function getAllListingsExportData(input: {
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
}): Promise<{
  rows: ListingExportRow[];
  errors: ListingExportError[];
  fetchedAt: string;
}> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const sellerSkus = [
      ...new Set(
        buildDemoOrders(input.marketplaceId)
          .flatMap((order) => order.items)
          .map((item) => item.sellerSku),
      ),
    ];
    const rows = sellerSkus.map((sellerSku) => {
      const listing = getDemoListingContent(input.marketplaceId, sellerSku);
      return {
        marketplace: MARKETPLACES[input.marketplaceId].name,
        sellerSku,
        asin: listing.asin ?? "",
        productType: listing.productType,
        title: listing.title,
        bulletPoints: listing.bulletPoints,
        ingredients: listing.ingredients,
        status: listing.status.join(", "),
        updatedAt: listing.updatedAt ?? "",
      };
    });
    return { rows, errors: [], fetchedAt: new Date().toISOString() };
  }

  const status = await getAllListingsReportStatus({
    marketplaceId: input.marketplaceId,
    reportId: input.reportId,
  });
  if (!status.ready || status.documentId !== input.documentId) {
    throw new SpApiError("報表尚未完成，或下載資訊已失效。", {
      status: 409,
      code: "REPORT_NOT_READY",
    });
  }
  const report = await downloadReportDocument(
    input.marketplaceId,
    input.documentId,
  );
  const seeds = reportSeeds(report);
  if (!seeds.length) {
    return {
      rows: [],
      errors: [
        {
          sellerSku: "",
          kind: "沒有 FBA 商品",
          message: "Amazon 報表中沒有找到此站點的 FBA SKU。",
        },
      ],
      fetchedAt: new Date().toISOString(),
    };
  }
  const result = await fetchExportRows(input.marketplaceId, seeds);
  return { ...result, fetchedAt: new Date().toISOString() };
}

export async function previewListingSalePriceUpdate(
  input: UpdateListingSalePriceInput,
): Promise<SalePriceValidationResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const listing = getDemoListingPrice(input.marketplaceId, input.sellerSku);
    const standardPrice = verifySalePriceChange(listing, input);
    return {
      mode: "demo",
      status: "SIMULATED",
      action: input.action,
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      standardPrice,
      previousDiscountedPrice: listing.discountedPrice,
      requestedDiscountedPrice: requestedSaleSchedule(input),
      validatedAt: new Date().toISOString(),
      issues: [],
      notice: "展示預檢已通過；最終按鈕只會模擬，不會寫入 Amazon。",
    };
  }
  const prepared = await prepareLiveSalePriceUpdate(input);
  return {
    mode: "live",
    status: "VALID",
    action: input.action,
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    standardPrice: prepared.standardPrice,
    previousDiscountedPrice: prepared.listing.discountedPrice,
    requestedDiscountedPrice: prepared.requestedDiscountedPrice,
    validatedAt: new Date().toISOString(),
    issues: prepared.issues,
    notice: prepared.issues.length
      ? "Amazon 預檢通過，但有警告需要確認。"
      : "Amazon 預檢通過，尚未建立或取消折扣。",
  };
}

export async function updateListingSalePrice(
  input: UpdateListingSalePriceInput,
): Promise<SalePriceUpdateResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const listing = getDemoListingPrice(input.marketplaceId, input.sellerSku);
    const standardPrice = verifySalePriceChange(listing, input);
    const requestedDiscountedPrice = requestedSaleSchedule(input);
    demoSalePriceOverrides.set(
      demoPriceKey(input.marketplaceId, input.sellerSku),
      requestedDiscountedPrice
        ? {
            amount: requestedDiscountedPrice.price.amount,
            startAt: requestedDiscountedPrice.startAt ?? "",
            endAt: requestedDiscountedPrice.endAt ?? "",
          }
        : null,
    );
    return {
      mode: "demo",
      status: "SIMULATED",
      action: input.action,
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      standardPrice,
      previousDiscountedPrice: listing.discountedPrice,
      requestedDiscountedPrice,
      acceptedAt: new Date().toISOString(),
      submissionId: null,
      requestId: null,
      issues: [],
      notice:
        input.action === "cancel"
          ? "模擬取消折扣完成；Amazon 真實活動沒有變更。"
          : "模擬限時折扣建立完成；Amazon 真實活動沒有變更。",
    };
  }

  const prepared = await prepareLiveSalePriceUpdate(input);
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body: prepared.body,
  });
  if (!response.ok) return throwListingsError(response, "write");

  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError(
      "Amazon 已收到請求，但回應無法辨識。請重新查詢 SKU 確認折扣。",
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
        "Amazon 未接受這次折扣更新。",
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
    action: input.action,
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    standardPrice: prepared.standardPrice,
    previousDiscountedPrice: prepared.listing.discountedPrice,
    requestedDiscountedPrice: prepared.requestedDiscountedPrice,
    acceptedAt: new Date().toISOString(),
    submissionId: payload.submissionId ?? null,
    requestId: response.headers.get("x-amzn-requestid"),
    issues,
    notice:
      input.action === "cancel"
        ? "Amazon 已接受取消折扣，正在處理；重新查詢確認後才代表完成。"
        : "Amazon 已接受限時折扣，正在處理；重新查詢看到新折扣後才代表生效。",
  };
}

export async function previewListingPriceUpdate(
  input: UpdateListingPriceInput,
): Promise<PriceValidationResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const listing = getDemoListingPrice(input.marketplaceId, input.sellerSku);
    const previousPrice = verifyPriceChange(listing, input);
    return {
      mode: "demo",
      status: "SIMULATED",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      previousPrice,
      requestedPrice: {
        amount: input.newPrice,
        currencyCode: MARKETPLACES[input.marketplaceId].currency,
      },
      validatedAt: new Date().toISOString(),
      issues: [],
      notice: "展示預檢已通過；最終按鈕只會模擬，不會寫入 Amazon。",
    };
  }

  const prepared = await prepareLivePriceUpdate(input);
  return {
    mode: "live",
    status: "VALID",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    previousPrice: prepared.previousPrice,
    requestedPrice: prepared.requestedPrice,
    validatedAt: new Date().toISOString(),
    issues: prepared.issues,
    notice: prepared.issues.length
      ? "Amazon 預檢通過，但有警告需要確認。"
      : "Amazon 預檢通過，尚未寫入價格。",
  };
}

export async function updateListingPrice(
  input: UpdateListingPriceInput,
): Promise<PriceUpdateResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const listing = getDemoListingPrice(input.marketplaceId, input.sellerSku);
    const previousPrice = verifyPriceChange(listing, input);
    demoPriceOverrides.set(
      demoPriceKey(input.marketplaceId, input.sellerSku),
      input.newPrice,
    );
    return {
      mode: "demo",
      status: "SIMULATED",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      previousPrice,
      requestedPrice: {
        amount: input.newPrice,
        currencyCode: MARKETPLACES[input.marketplaceId].currency,
      },
      acceptedAt: new Date().toISOString(),
      submissionId: null,
      requestId: null,
      issues: [],
      notice: "模擬調價完成；Amazon 真實價格沒有變更。",
    };
  }

  const prepared = await prepareLivePriceUpdate(input);
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body: prepared.body,
  });
  if (!response.ok) return throwListingsError(response, "write");

  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError(
      "Amazon 已收到請求，但回應無法辨識。請重新查詢 SKU 確認價格。",
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
        "Amazon 未接受這次價格更新。",
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
    previousPrice: prepared.previousPrice,
    requestedPrice: prepared.requestedPrice,
    acceptedAt: new Date().toISOString(),
    submissionId: payload.submissionId ?? null,
    requestId: response.headers.get("x-amzn-requestid"),
    issues,
    notice:
      "Amazon 已接受調價請求，正在處理；重新查詢確認後才代表價格已生效。",
  };
}

export async function searchOrders(
  input: SearchOrdersInput,
): Promise<OrdersSnapshot> {
  const fbaInput: SearchOrdersInput = { ...input, fulfilledBy: "AMAZON" };
  if (shouldUseDemoMode(input.marketplaceId)) {
    let orders = buildDemoOrders(input.marketplaceId);
    if (fbaInput.fulfillmentStatus) {
      orders = orders.filter(
        (order) => order.fulfillmentStatus === fbaInput.fulfillmentStatus,
      );
    }
    orders = orders.filter((order) => order.fulfilledBy === "AMAZON");
    return {
      mode: "demo",
      orders,
      marketplaceId: input.marketplaceId,
      fetchedAt: new Date().toISOString(),
      nextToken: null,
      lastUpdatedBefore: new Date().toISOString(),
      requestId: null,
      rateLimit: null,
      notice: isConfiguredForMarketplace(input.marketplaceId)
        ? "目前由 SP_API_MODE 強制使用展示資料。"
        : `${MARKETPLACES[input.marketplaceId].label}站尚未在 Mac Keychain 加入 refresh token，因此顯示展示資料。`,
    };
  }

  return fetchLiveOrders(fbaInput);
}

export async function getSalesTrend(input: {
  marketplaceId: MarketplaceId;
  days: SalesTrendDays;
}): Promise<SalesTrendSnapshot> {
  if (!shouldUseDemoMode(input.marketplaceId)) {
    return fetchLiveSalesTrend(input);
  }

  const window = buildSalesTrendWindow(input.marketplaceId, input.days);
  const currencyCode = MARKETPLACES[input.marketplaceId].currency;
  const base = currencyCode === "JPY" ? 18_000 : 180;
  const points = window.dateKeys.map((date, index): SalesTrendPoint => {
    const unitCount = 8 + ((index * 7 + input.days) % 13);
    const amount = Number(
      (base * (0.72 + ((index * 11 + input.days) % 9) / 10)).toFixed(
        currencyCode === "JPY" ? 0 : 2,
      ),
    );
    return {
      date,
      interval: window.intervals[index],
      totalSales: { amount, currencyCode },
      unitCount,
      orderItemCount: Math.max(1, unitCount - (index % 3)),
      orderCount: Math.max(1, unitCount - 2 - (index % 4)),
      partial: index === window.dateKeys.length - 1,
    };
  });
  return {
    mode: "demo",
    marketplaceId: input.marketplaceId,
    days: input.days,
    timeZone: window.timeZone,
    points,
    totals: salesTrendTotals(points, currencyCode),
    fetchedAt: new Date().toISOString(),
    requestId: null,
    rateLimit: null,
    notice: isConfiguredForMarketplace(input.marketplaceId)
      ? "目前由 SP_API_MODE 強制使用展示資料；趨勢只供版面測試。"
      : `${MARKETPLACES[input.marketplaceId].label}站尚未在 Mac Keychain 加入 refresh token，因此顯示展示趨勢。`,
  };
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
          ? "訂單量超過本次安全掃描上限，銷速可能被低估；大量 SKU 建議改接 Restock report。"
          : "建議量已扣除 FBA 可售與 working／shipped／receiving 在途庫存。",
      skillConnected
        ? "已偵測到補貨 Skill 接點；正式送出仍應先人工審核。"
        : "工作區未找到既有補貨 Skill，目前直接使用 FBA Inventory 與 FBA 訂單資料。",
    ].join(" "),
    skillConnected,
  };
}

async function fetchLiveSalesVelocity(
  marketplaceId: MarketplaceId,
  sellerSku: string,
  lookbackDays = 30,
): Promise<RestockPlanSnapshot["demand"]> {
  const cutoff = Date.now() - lookbackDays * 86_400_000;
  let token: string | null = null;
  let units = 0;
  let ordersScanned = 0;
  let page = 0;
  do {
    const snapshot = await fetchLiveOrders({
      marketplaceId,
      lastUpdatedAfter: new Date(cutoff).toISOString(),
      fulfilledBy: "AMAZON",
      paginationToken: token,
      maxResultsPerPage: 50,
    });
    ordersScanned += snapshot.orders.length;
    for (const order of snapshot.orders) {
      if (
        order.fulfillmentStatus === "CANCELLED" ||
        new Date(order.createdTime).getTime() < cutoff
      ) {
        continue;
      }
      units += order.items
        .filter((item) => item.sellerSku === sellerSku)
        .reduce((sum, item) => sum + item.quantity, 0);
    }
    token = snapshot.nextToken;
    page += 1;
  } while (token && page < 5);
  return {
    lookbackDays,
    units,
    averageDailyUnits: units / lookbackDays,
    ordersScanned,
    partial: Boolean(token),
  };
}

export async function getRestockPlan(
  input: RestockPlanInput,
): Promise<RestockPlanSnapshot> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const listing = getDemoListingPrice(input.marketplaceId, input.sellerSku);
    const fba = listing.fulfillmentAvailability.find(
      (item) => item.fulfillment === "FBA",
    );
    const fulfillable = inventoryQuantity(fba?.quantity);
    const averageDailyUnits =
      input.marketplaceId === "A1VC38T7YXB528" ? 1.3 : 1.8;
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
      demand: {
        lookbackDays: 30,
        units: Math.round(averageDailyUnits * 30),
        averageDailyUnits,
        ordersScanned: 37,
        partial: false,
      },
      requestId: null,
      rateLimit: null,
    });
  }

  const [listing, inventoryResult, demand] = await Promise.all([
    fetchLiveListingPrice(input.marketplaceId, input.sellerSku),
    fetchLiveFbaInventorySummary(input.marketplaceId, input.sellerSku),
    fetchLiveSalesVelocity(input.marketplaceId, input.sellerSku),
  ]);
  const details = inventoryResult.summary.inventoryDetails;
  return createRestockPlan(input, {
    mode: "live",
    listing,
    fnSku: inventoryResult.summary.fnSku?.trim() || null,
    inventory: {
      fulfillable: inventoryQuantity(details?.fulfillableQuantity),
      reserved: inventoryQuantity(
        details?.reservedQuantity?.totalReservedQuantity,
      ),
      inboundWorking: inventoryQuantity(details?.inboundWorkingQuantity),
      inboundShipped: inventoryQuantity(details?.inboundShippedQuantity),
      inboundReceiving: inventoryQuantity(details?.inboundReceivingQuantity),
      unfulfillable: inventoryQuantity(
        details?.unfulfillableQuantity?.totalUnfulfillableQuantity,
      ),
      researching: inventoryQuantity(
        details?.researchingQuantity?.totalResearchingQuantity,
      ),
    },
    demand,
    requestId: inventoryResult.requestId,
    rateLimit: inventoryResult.rateLimit,
  });
}

export function isMarketplaceId(value: string): value is MarketplaceId {
  return value in MARKETPLACES;
}

export function isFulfillmentStatus(value: string): boolean {
  return VALID_STATUSES.has(value);
}
