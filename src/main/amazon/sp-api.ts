import {
  applyVariationDimensionNames,
  normalizeVariationMember,
  variationRelationshipEvidenceConflict,
  variationSearchIncludesDeclaredChildren,
  type VariationFamilyMember,
  type VariationFamilySnapshot,
  type VariationListingPayload,
} from "./variation-family";
import {
  assertVariationAttached,
  assertVariationDetached,
  buildVariationAttachBody,
  buildVariationDetachBody,
  variationDimensionSignature,
  variationFieldDescriptors,
  VariationUpdateValidationError,
  type VariationFieldDescriptor,
  type VariationPatchBody,
} from "./variation-update";
import {
  assertReplenishmentRequestBody,
  fetchFbaSubscriptionAuditHistory,
  officialCompleteMonthlyIntervals,
  type FbaSubscriptionAuditHistorySnapshot,
  type ReplenishmentPageRequest,
} from "./replenishment-audit";
import {
  buildBrandSalesSnapshot,
  parseCurrentFbaListingTitles,
  parseFbaShipmentSalesReport,
  type BrandSalesSnapshot,
} from "./brand-sales";
import {
  dedupeFbaReviewCandidates,
  type DedupedFbaReviewCandidate,
  type FbaReviewCandidate,
  type ReviewAuditCandidateCoverage,
  type ReviewAuditFetchResult,
  type ReviewAuditRelationshipIncompleteRow,
} from "./review-audit";

export type { BrandSalesSnapshot } from "./brand-sales";
import { classifyUnboundVariationEvidence } from "./unbound-variation-audit";

export type {
  VariationDimension,
  VariationFamilyMember,
  VariationFamilySnapshot,
  VariationRole,
} from "./variation-family";

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

export type SalesTrendPresetDays = 7 | 14 | 30 | 90;
export type SalesTrendDays = SalesTrendPresetDays;
export type SalesTrendComparisonMode = "none" | "previous-year";

// Amazon Sales API permits non-hour intervals that begin within the last two
// years. This app keeps a one-year daily cap so the paired previous-year query
// remains inside that horizon and the renderer stays responsive. The exact
// comparison horizon is still checked again in getSalesTrend.
export const MAX_SALES_TREND_DAY_COUNT = 365;

export type SalesTrendRange = {
  startDate: string;
  endDate: string;
  dayCount: number;
  presetDays: SalesTrendPresetDays | null;
};

export type SalesTrendPoint = {
  date: string;
  interval: string;
  totalSales: Money;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
  partial: boolean;
};

export type SalesTrendTotals = {
  totalSales: Money;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
};

export type SalesTrendSnapshot = {
  schemaVersion: 2;
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  days: number;
  range: SalesTrendRange;
  timeZone: string;
  points: SalesTrendPoint[];
  totals: SalesTrendTotals;
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  comparison: null | {
    kind: "previous-year";
    range: SalesTrendRange;
    points: SalesTrendPoint[];
    totals: SalesTrendTotals;
    requestId: string | null;
    rateLimit: string | null;
  };
  notice: string;
};

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
  imageUrls: string[];
  status: string;
  updatedAt: string;
  readStatus: "complete" | "incomplete";
  readErrors: ListingExportReadError[];
};

export type ListingExportReadError = {
  code: "LISTING_QUERY_FAILED" | "LISTING_CONTENT_NOT_RETURNED";
  message: string;
};

export type ListingExportError = {
  sellerSku: string;
  kind: string;
  message: string;
};

export type VariationMoveAction = "detach" | "attach";

export type VariationDetachInput = {
  action: "detach";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedSourceParentSku: string;
  targetParentSku: null;
  variationTheme: null;
  dimensionNames: [];
  dimensionValues: Record<string, never>;
};

export type VariationAttachInput = {
  action: "attach";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedSourceParentSku: null;
  targetParentSku: string;
  variationTheme: string;
  dimensionNames: string[];
  dimensionValues: Record<string, unknown>;
};

export type VariationMoveInput = VariationDetachInput | VariationAttachInput;

export type VariationMovePreparation = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string;
  productType: string;
  variationTheme: string;
  dimensionNames: string[];
  fields: VariationFieldDescriptor[];
  preparedAt: string;
  requestIds: string[];
  writable: boolean;
  blockers: string[];
  warnings: string[];
  notice: string;
};

export type VariationMovePreview = {
  mode: "live" | "demo";
  action: VariationMoveAction;
  status: "VALID" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};

export type VariationMoveResult = {
  mode: "live" | "demo";
  action: VariationMoveAction;
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
  verified: true;
  completedAt: string;
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

export type ReviewAuditCandidateSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sourceCandidateCount: number;
  candidates: DedupedFbaReviewCandidate[];
  relationshipIncompleteRows: ReviewAuditRelationshipIncompleteRow[];
  coverage: ReviewAuditCandidateCoverage;
  notice: string;
};

export type FbaReviewAuditSeed = {
  sellerSku: string;
  asin: string;
  title: string;
};

export type FbaReviewAuditRelationshipBatch = {
  status: number;
  payload: unknown;
  requestId: string | null;
};

export type BrandSalesReportStatus = ListingReportStatus & {
  dataStartTime: string;
  dataEndTime: string;
};

export type UnboundVariationAuditRow = {
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  relationshipEvidence: "relationships";
  notice: string;
};

export type UnboundVariationAuditIncompleteRow = {
  sellerSku: string;
  asin: string;
  title: string;
  code:
    | "RELATIONSHIPS_NOT_RETURNED"
    | "RELATIONSHIPS_COMPATIBILITY_FALLBACK"
    | "RELATIONSHIP_QUERY_FAILED"
    | "RELATIONSHIP_RESPONSE_INVALID"
    | "FULFILLMENT_EVIDENCE_CONFLICT";
  message: string;
  requestId: string | null;
};

export type UnboundVariationAuditSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  rows: UnboundVariationAuditRow[];
  incompleteRows: UnboundVariationAuditIncompleteRow[];
  summary: {
    totalFbaListings: number;
    completed: number;
    unbound: number;
    boundChildren: number;
    parentContainers: number;
    incomplete: number;
  };
  notice: string;
};

export type AgedInventoryBucket = {
  key: string;
  label: string;
  units: number;
  over180: boolean;
};

export type AgedInventorySurchargeBucket = {
  key: string;
  label: string;
  quantity: number | null;
  estimatedCharge: number | null;
};

export type AgedInventoryFeeAvailability =
  | "complete"
  | "partial"
  | "unavailable";

export type AgedInventoryRow = {
  sellerSku: string;
  fnSku: string;
  asin: string;
  title: string;
  condition: string;
  available: number | null;
  totalAgedUnits: number;
  agedOver180: number;
  ageBuckets: AgedInventoryBucket[];
  estimatedExcessQuantity: number | null;
  recommendedRemovalQuantity: number | null;
  daysOfSupply: number | null;
  currencyCode: string | null;
  estimatedStorageCostNextMonth: number | null;
  estimatedAgedSurcharge: number | null;
  agedSurchargeBuckets: AgedInventorySurchargeBucket[];
  alert: string;
  recommendedAction: string;
  snapshotDate: string | null;
};

export type AgedInventorySnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  rows: AgedInventoryRow[];
  summary: {
    skuCount: number;
    agedOver180SkuCount: number;
    totalAgedUnits: number;
    agedOver180: number;
    excessAvailability: AgedInventoryFeeAvailability;
    estimatedExcessQuantity: number | null;
    excessReportedSkuCount: number;
    currencyCode: string | null;
    storageCostAvailability: AgedInventoryFeeAvailability;
    estimatedStorageCostNextMonth: number | null;
    storageCostReportedSkuCount: number;
    agedSurchargeAvailability: AgedInventoryFeeAvailability;
    estimatedAgedSurcharge: number | null;
    agedSurchargeReportedSkuCount: number;
  };
  expiration: {
    currentFbaExpirationDatesAvailable: false;
    nearExpiryUnits: null;
    expiredUnits: null;
    inboundPlanExpirationDatesAvailable: true;
    notice: string;
  };
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
const UNBOUND_VARIATION_SEARCH_INCLUDED_DATA =
  "relationships,summaries,fulfillmentAvailability,productTypes";
const UNBOUND_VARIATION_SEARCH_BATCH_SIZE = 20;

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
  dataStartTime?: string;
  dataEndTime?: string;
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
  if (!isRecord(value)) return false;
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

function exactInventorySellerSku(value: unknown): string | null {
  return typeof value === "string" &&
      Boolean(value) &&
      value.length <= 256 &&
      value === value.trim() &&
      !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
    ? value
    : null;
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
  clearProductTypeCapabilityCache();
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

export type SpApiOperation =
  | "getListingsItem"
  | "searchListingsItems"
  | "getItemReviewTopics"
  | "getDefinitionsProductType"
  | "patchListingsItemPreview"
  | "patchListingsItem";

export class SpApiError extends Error {
  status: number;
  code: string;
  requestId: string | null;
  retryAfter: string | null;
  issues: ListingIssue[];
  operation: SpApiOperation | null;
  upstreamCode: string | null;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      requestId?: string | null;
      retryAfter?: string | null;
      issues?: ListingIssue[];
      operation?: SpApiOperation | null;
      upstreamCode?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "SpApiError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "UPSTREAM_UNAVAILABLE";
    this.requestId = options.requestId ?? null;
    this.retryAfter = options.retryAfter ?? null;
    this.issues = options.issues ?? [];
    this.operation = options.operation ?? null;
    this.upstreamCode = options.upstreamCode ?? null;
  }
}

export class SpApiPreCommitError extends SpApiError {
  readonly commitPatchSent = false;

  constructor(cause: SpApiError) {
    super(
      `${cause.message} 正式 commit PATCH 尚未送出；可重新預檢後再試。`,
      {
        status: cause.status,
        code: cause.code,
        requestId: cause.requestId,
        retryAfter: cause.retryAfter,
        issues: cause.issues,
        operation: cause.operation,
        upstreamCode: cause.upstreamCode,
      },
    );
    this.name = "SpApiPreCommitError";
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
      code: operation === "write" ? "UPDATE_STATUS_UNKNOWN" : "RATE_LIMITED",
      message:
        operation === "write"
          ? "Amazon 對這次 Listing 寫入回傳限流；系統無法安全證明請求未被處理，請先回查 SKU，不要直接重送。"
          : "Amazon Listings API 正在限流，請稍後再試。",
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
  readProfile: "full" | "essential" | "minimal" = "full",
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
  const method = input.method ?? "GET";
  const query = new URLSearchParams({ marketplaceIds: input.marketplaceId });
  if (method === "GET") {
    // Keep the single-item baseline to the fields AMZ.API actually consumes.
    // A prior production account rejected the extra `productTypes` dataset.
    if (readProfile === "full") {
      query.set("issueLocale", marketplace.issueLocale);
      query.set("includedData", listingIncludedData("item"));
    } else if (readProfile === "essential") {
      // Amazon documents the full profile above. A small number of accounts
      // nevertheless reject one of its optional datasets with HTTP 400. A
      // read-only retry keeps only the datasets required to prove FBA and
      // render contributed content; writes never use this compatibility path.
      query.set(
        "includedData",
        "summaries,attributes,fulfillmentAvailability",
      );
    }
  } else {
    query.set("issueLocale", marketplace.issueLocale);
    query.set("includedData", "issues");
  }
  if (input.validationPreview) query.set("mode", "VALIDATION_PREVIEW");

  const url = `${REGION_ENDPOINTS[region]}/listings/2021-08-01/items/${encodeURIComponent(
    sellerId,
  )}/${encodeURIComponent(input.sellerSku)}?${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
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
  const canRetry = (input.method ?? "GET") === "GET" || input.validationPreview;

  if (response.status === 401 && canRetry) {
    tokenCache.delete(MARKETPLACES[input.marketplaceId].region);
    response = await callListingsApi(input, true);
  }

  if ((input.method ?? "GET") === "GET" && response.status === 400) {
    response = await callListingsApi(input, false, "essential");
    if (response.status === 400) {
      const minimalResponse = await callListingsApi(input, false, "minimal");
      if (minimalResponse.ok) {
        throw new SpApiError(
          "Amazon 已接受 Seller ID、SKU 與站點，但拒絕商品內容所需的 Listings 資料集；已停止在唯讀診斷階段。",
          {
            status: 409,
            code: "LISTINGS_REQUIRED_DATA_UNAVAILABLE",
            requestId: minimalResponse.headers.get("x-amzn-requestid"),
            operation: "getListingsItem",
          },
        );
      }
      response = minimalResponse;
    }
  }
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
  apiOperation: SpApiOperation,
): Promise<never> {
  const requestId = response.headers.get("x-amzn-requestid");
  const fallback = listingErrorMessage(response.status, operation);
  const payload = await parseResponseJson<{
    issues?: AmazonListingIssue[];
    errors?: Array<{ code?: string; message?: string }>;
  }>(response);
  const issues = normalizeListingIssues(payload?.issues);
  const upstreamError = payload?.errors?.find(
    (error) =>
      (typeof error.message === "string" && Boolean(error.message.trim())) ||
      (typeof error.code === "string" && Boolean(error.code.trim())),
  );
  const upstreamMessage = upstreamError?.message?.trim();
  const upstreamCode = upstreamError?.code?.trim() || null;
  const stageMessage =
    response.status === 400 && operation === "read"
      ? apiOperation === "searchListingsItems"
        ? "Amazon 無法驗證 Listings 搜尋／連線請求。"
        : apiOperation === "getDefinitionsProductType"
          ? "Amazon 無法驗證 Product Type Definitions 商品欄位規格請求。"
          : apiOperation === "getListingsItem"
            ? "Amazon 無法驗證 getListingsItem 商品查詢。"
            : fallback.message
      : fallback.message;

  throw new SpApiError(
    upstreamMessage ? `${stageMessage}（${upstreamMessage}）` : stageMessage,
    {
      status: response.status,
      code: fallback.code,
      requestId,
      retryAfter: response.headers.get("retry-after"),
      issues,
      operation: apiOperation,
      upstreamCode,
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

function payloadFulfillmentEvidence(
  payload: AmazonListingItem,
): "FBA" | "OTHER" | "MISSING" {
  const channelCodes = (payload.fulfillmentAvailability ?? [])
    .map((availability) =>
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
  if (!response.ok) {
    return throwListingsError(response, "read", "getListingsItem");
  }
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

type ContentCapabilityResult = {
  capabilities: ContentCapabilities;
  degradedReason: string | null;
};

const productTypeCapabilityCache = new Map<
  string,
  { expiresAt: number; capabilities: ContentCapabilities }
>();

function clearProductTypeCapabilityCache(): void {
  productTypeCapabilityCache.clear();
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
    bulletPoints: field(source?.bulletPoints),
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

async function callProductTypeDefinitionApi(
  marketplaceId: MarketplaceId,
  productType: string,
  forceTokenRefresh = false,
  includeSellerId = true,
  options: {
    requirements?: "LISTING" | "LISTING_PRODUCT_ONLY";
    requirementsEnforced?: "ENFORCED" | "NOT_ENFORCED";
    parentageLevel?: "CHILD" | "PARENT" | "NONE";
  } = {},
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
    marketplaceIds: marketplaceId,
    productTypeVersion: "LATEST",
    requirements: options.requirements ?? "LISTING_PRODUCT_ONLY",
    requirementsEnforced: options.requirementsEnforced ?? "NOT_ENFORCED",
    locale: marketplace.issueLocale,
  });
  if (options.parentageLevel) {
    query.set("parentageLevel", options.parentageLevel);
  }
  if (includeSellerId) query.set("sellerId", sellerId);
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
        operation: "getDefinitionsProductType",
      });
    }
    throw new SpApiError("目前無法讀取 Amazon 商品欄位規格。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchContentCapabilities(
  marketplaceId: MarketplaceId,
  productType: string,
  options: { allowGenericFallback?: boolean } = {},
): Promise<ContentCapabilityResult> {
  const cacheKey = `${marketplaceId}:${productType}`;
  const cached = productTypeCapabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { capabilities: cached.capabilities, degradedReason: null };
  }

  const marketplace = MARKETPLACES[marketplaceId];
  let usedGenericDefinition = false;
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
  if (response.status === 400 && options.allowGenericFallback) {
    usedGenericDefinition = true;
    response = await callProductTypeDefinitionApi(
      marketplaceId,
      productType,
      false,
      false,
    );
    if (response.status === 401) {
      tokenCache.delete(marketplace.region);
      response = await callProductTypeDefinitionApi(
        marketplaceId,
        productType,
        true,
        false,
      );
    }
  }
  if (!response.ok) {
    return throwListingsError(response, "read", "getDefinitionsProductType");
  }
  const definition = await parseResponseJson<AmazonProductTypeDefinition>(
    response,
  );
  const schemaUrl = definition?.schema?.link?.resource;
  if (!schemaUrl) {
    throw new SpApiError("Amazon 沒有回傳可用的商品欄位規格。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
      operation: "getDefinitionsProductType",
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
      operation: "getDefinitionsProductType",
    });
  }
  if (!schemaResponse.ok) {
    throw new SpApiError("Amazon 商品欄位規格暫時無法下載。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  const schema = await parseResponseJson<JsonRecord>(schemaResponse);
  if (!schema || !isRecord(schema.properties)) {
    throw new SpApiError("Amazon 商品欄位規格格式無法辨識。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  let capabilities: ContentCapabilities = {
    title: contentCapability(schema, "item_name"),
    bulletPoints: contentCapability(schema, "bullet_point"),
    ingredients: contentCapability(schema, "ingredients"),
    images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) =>
      imageCapability(schema, attributeName, index),
    ),
    schemaChecksum: definition?.schema?.checksum ?? null,
  };
  if (usedGenericDefinition) {
    const reason =
      "Amazon 目前只提供通用商品欄位規格；內容可唯讀，所有寫入已停用。";
    capabilities = readOnlyContentCapabilities(reason, capabilities);
    return { capabilities, degradedReason: reason };
  }
  productTypeCapabilityCache.set(cacheKey, {
    expiresAt: Date.now() + 15 * 60_000,
    capabilities,
  });
  return { capabilities, degradedReason: null };
}

async function fetchVariationChildSchema(
  marketplaceId: MarketplaceId,
  productType: string,
): Promise<{
  schema: JsonRecord;
  checksum: string | null;
  requestId: string | null;
}> {
  const marketplace = MARKETPLACES[marketplaceId];
  const definitionOptions = {
    requirements: "LISTING" as const,
    requirementsEnforced: "ENFORCED" as const,
    parentageLevel: "CHILD" as const,
  };
  let response = await callProductTypeDefinitionApi(
    marketplaceId,
    productType,
    false,
    true,
    definitionOptions,
  );
  if (response.status === 401) {
    tokenCache.delete(marketplace.region);
    response = await callProductTypeDefinitionApi(
      marketplaceId,
      productType,
      true,
      true,
      definitionOptions,
    );
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(retryDelayMs(response, attempt));
    response = await callProductTypeDefinitionApi(
      marketplaceId,
      productType,
      false,
      true,
      definitionOptions,
    );
  }
  if (!response.ok) {
    return throwListingsError(response, "read", "getDefinitionsProductType");
  }
  const definition = await parseResponseJson<AmazonProductTypeDefinition>(response);
  const schemaUrl = definition?.schema?.link?.resource;
  if (!schemaUrl) {
    throw new SpApiError("Amazon CHILD PTD 沒有回傳可用的 schema。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
      operation: "getDefinitionsProductType",
    });
  }
  let schemaResponse: Response;
  try {
    schemaResponse = await fetch(schemaUrl, {
      headers: { accept: "application/schema+json, application/json" },
      cache: "no-store",
    });
  } catch {
    throw new SpApiError("Amazon CHILD PTD schema 下載失敗，已停止變體操作。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  if (!schemaResponse.ok) {
    throw new SpApiError("Amazon CHILD PTD schema 暫時無法下載。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  const schema = await parseResponseJson<JsonRecord>(schemaResponse);
  if (!schema || !isRecord(schema.properties)) {
    throw new SpApiError("Amazon CHILD PTD schema 格式無法辨識。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  return {
    schema,
    checksum: definition.schema?.checksum ?? null,
    requestId: response.headers.get("x-amzn-requestid"),
  };
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

async function callListingsSearchApi(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
  forceTokenRefresh = false,
  accessProbe = false,
  probeProfile: "standard" | "minimal" = "standard",
  includedDataOverride?: string,
  identifiersType: "SKU" | "ASIN" = "SKU",
  pageSizeOverride?: number,
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
  const query = new URLSearchParams({ marketplaceIds: marketplaceId });
  if (!accessProbe || probeProfile === "standard") {
    query.set("issueLocale", marketplace.issueLocale);
    query.set(
      "includedData",
      accessProbe
        ? "summaries"
        : includedDataOverride ?? listingIncludedData("search"),
    );
    query.set(
      "pageSize",
      accessProbe ? "1" : String(pageSizeOverride ?? sellerSkus.length),
    );
  }
  if (!accessProbe) {
    query.set("identifiers", sellerSkus.join(","));
    query.set("identifiersType", identifiersType);
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

export function buildUnboundVariationSearchBatches(
  sellerSkus: readonly string[],
): { batches: string[][]; unqueryableSellerSkus: string[] } {
  const batches: string[][] = [];
  const unqueryableSellerSkus: string[] = [];
  const seen = new Set<string>();
  let batch: string[] = [];
  for (const sellerSku of sellerSkus) {
    if (seen.has(sellerSku)) {
      throw new SpApiError("未綁變體批次含有重複 Seller SKU。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    seen.add(sellerSku);
    const queryable =
      typeof sellerSku === "string" &&
      Boolean(sellerSku) &&
      sellerSku.length <= 40 &&
      sellerSku === sellerSku.trim() &&
      !sellerSku.includes(",") &&
      !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
        sellerSku,
      );
    if (!queryable) {
      unqueryableSellerSkus.push(sellerSku);
      continue;
    }
    batch.push(sellerSku);
    if (batch.length === UNBOUND_VARIATION_SEARCH_BATCH_SIZE) {
      batches.push(batch);
      batch = [];
    }
  }
  if (batch.length) batches.push(batch);
  return { batches, unqueryableSellerSkus };
}

export function unboundVariationSearchIncludedData(): string {
  return UNBOUND_VARIATION_SEARCH_INCLUDED_DATA;
}

async function executeUnboundVariationSearchRequest(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
): Promise<Response> {
  if (
    sellerSkus.length < 1 ||
    sellerSkus.length > UNBOUND_VARIATION_SEARCH_BATCH_SIZE
  ) {
    throw new SpApiError("未綁變體批次必須包含 1 到 20 個 Seller SKU。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  let response = await callListingsSearchApi(
    marketplaceId,
    sellerSkus,
    false,
    false,
    "standard",
    UNBOUND_VARIATION_SEARCH_INCLUDED_DATA,
  );
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callListingsSearchApi(
      marketplaceId,
      sellerSkus,
      true,
      false,
      "standard",
      UNBOUND_VARIATION_SEARCH_INCLUDED_DATA,
    );
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
): Promise<{ requestId: string | null; compatibilityFallback: boolean }> {
  if (shouldUseDemoMode(marketplaceId)) {
    return { requestId: null, compatibilityFallback: false };
  }
  let compatibilityFallback = false;
  let response = await callListingsSearchApi(marketplaceId, [], false, true);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callListingsSearchApi(marketplaceId, [], true, true);
  }
  if (response.status === 400) {
    compatibilityFallback = true;
    response = await callListingsSearchApi(
      marketplaceId,
      [],
      false,
      true,
      "minimal",
    );
  }
  if (!response.ok) {
    return throwListingsError(response, "read", "searchListingsItems");
  }
  return {
    requestId: response.headers.get("x-amzn-requestid"),
    compatibilityFallback,
  };
}

async function fetchLiveListingBatch(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
): Promise<ListingBatchSnapshot> {
  const response = await executeListingsSearchRequest(marketplaceId, sellerSkus);
  if (!response.ok) {
    return throwListingsError(response, "read", "searchListingsItems");
  }

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

type VariationReadProfile = "relationships" | "attributes";

type VariationReadInput = {
  marketplaceId: MarketplaceId;
  sellerSku?: string;
  variationParentSku?: string;
  pageToken?: string | null;
};

async function callVariationReadApi(
  input: VariationReadInput,
  forceTokenRefresh = false,
  profile: VariationReadProfile = "relationships",
): Promise<Response> {
  const marketplace = MARKETPLACES[input.marketplaceId];
  const region = marketplace.region;
  const sellerId = getSellerId(region);
  if (!sellerId) {
    throw new SpApiError(
      `${marketplace.label}站尚未設定 Seller ID，變體規劃查詢仍未啟用。`,
      { status: 503, code: "LISTINGS_NOT_CONFIGURED" },
    );
  }

  const token = await requestAccessToken(region, forceTokenRefresh);
  const singleSku = input.sellerSku?.trim() || null;
  const parentSku = input.variationParentSku?.trim() || null;
  if (!singleSku && !parentSku) {
    throw new SpApiError("變體查詢缺少 Seller SKU。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  const isSingleItem = Boolean(singleSku);
  const includedData = isSingleItem
    ? profile === "relationships"
      ? "summaries,attributes,issues,fulfillmentAvailability,relationships"
      : "summaries,attributes,issues,fulfillmentAvailability"
    : profile === "relationships"
      ? "summaries,attributes,issues,fulfillmentAvailability,relationships,productTypes"
      : "summaries,attributes,issues,fulfillmentAvailability,productTypes";
  const query = new URLSearchParams({
    marketplaceIds: input.marketplaceId,
    issueLocale: marketplace.issueLocale,
    includedData,
  });
  if (parentSku) {
    query.set("variationParentSku", parentSku);
    query.set("pageSize", "20");
    if (input.pageToken) query.set("pageToken", input.pageToken);
  }
  const itemPath = singleSku
    ? `/${encodeURIComponent(singleSku)}`
    : "";
  const url = `${REGION_ENDPOINTS[region]}/listings/2021-08-01/items/${encodeURIComponent(
    sellerId,
  )}${itemPath}?${query}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, {
      method: "GET",
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
      throw new SpApiError("Amazon 變體關係查詢逾時，請稍後再試。", {
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

async function executeVariationRead(
  input: VariationReadInput,
): Promise<{ response: Response; profile: VariationReadProfile }> {
  let profile: VariationReadProfile = "relationships";
  let response = await callVariationReadApi(input, false, profile);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[input.marketplaceId].region);
    response = await callVariationReadApi(input, true, profile);
  }
  if (response.status === 400) {
    // Some established seller accounts reject the optional relationships
    // dataset. The documented attributes and variationParentSku lookup remain
    // read-only fallbacks; the UI reports the reduced evidence explicitly.
    profile = "attributes";
    response = await callVariationReadApi(input, false, profile);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(retryDelayMs(response, attempt));
    response = await callVariationReadApi(input, false, profile);
  }
  return { response, profile };
}

function normalizeVariationPayload(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  fallbackSku: string,
  source: "relationships" | "attributes" | "variationParentSku",
): VariationFamilyMember {
  const conflict = variationRelationshipEvidenceConflict(
    payload as VariationListingPayload,
    marketplaceId,
  );
  if (conflict) {
    throw new SpApiError(conflict, {
      status: 409,
      code: "VARIATION_RELATIONSHIP_CONFLICT",
    });
  }
  const member = normalizeVariationMember(
    payload as VariationListingPayload,
    marketplaceId,
    source,
  );
  return { ...member, sellerSku: member.sellerSku || fallbackSku };
}

async function fetchVariationItem(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): Promise<{
  payload: AmazonListingItem;
  member: VariationFamilyMember;
  requestId: string | null;
  profile: VariationReadProfile;
}> {
  const { response, profile } = await executeVariationRead({
    marketplaceId,
    sellerSku,
  });
  if (!response.ok) {
    return throwListingsError(response, "read", "getListingsItem");
  }
  const payload = await parseResponseJson<AmazonListingItem>(response);
  if (!payload) {
    throw new SpApiError("Amazon 回傳了無法辨識的變體 Listing 資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  return {
    payload,
    member: normalizeVariationPayload(
      payload,
      marketplaceId,
      sellerSku,
      profile === "relationships" ? "relationships" : "attributes",
    ),
    requestId: response.headers.get("x-amzn-requestid"),
    profile,
  };
}

function assertExplicitStandaloneVariationSource(
  sourceResult: Awaited<ReturnType<typeof fetchVariationItem>>,
  marketplaceId: MarketplaceId,
): void {
  const evidence = classifyUnboundVariationEvidence({
    marketplaceId,
    profile: sourceResult.profile,
    relationships: sourceResult.payload.relationships,
    role: sourceResult.member.role,
    listingFulfillmentEvidence: sourceResult.member.fba ? "FBA" : "OTHER",
  });
  if (
    evidence.kind !== "unbound" ||
    sourceResult.member.role !== "standalone" ||
    sourceResult.member.parentSku !== null
  ) {
    throw new SpApiError(
      "Amazon relationships 尚未同時證明來源 SKU 為 standalone 且 parentSku 為空；已停止加入新 parent。",
      {
        status: 409,
        code: "VARIATION_NOT_DETACHED",
        requestId: sourceResult.requestId,
      },
    );
  }
}

async function fetchVariationChildren(
  marketplaceId: MarketplaceId,
  parentSku: string,
): Promise<{
  rows: Array<{ payload: AmazonListingItem; member: VariationFamilyMember }>;
  requestIds: string[];
  familyComplete: boolean;
  usedCompatibilityFallback: boolean;
}> {
  const rows: Array<{
    payload: AmazonListingItem;
    member: VariationFamilyMember;
  }> = [];
  const requestIds: string[] = [];
  let pageToken: string | null = null;
  let page = 0;
  let usedCompatibilityFallback = false;
  do {
    const { response, profile } = await executeVariationRead({
      marketplaceId,
      variationParentSku: parentSku,
      pageToken,
    });
    usedCompatibilityFallback ||= profile === "attributes";
    if (!response.ok) {
      return throwListingsError(response, "read", "searchListingsItems");
    }
    const requestId = response.headers.get("x-amzn-requestid");
    if (requestId) requestIds.push(requestId);
    const payload = await parseResponseJson<AmazonListingSearchResponse>(response);
    if (!payload || !Array.isArray(payload.items)) {
      throw new SpApiError("Amazon 回傳了無法辨識的變體子商品清單。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId,
      });
    }
    for (const item of payload.items) {
      const fallbackSku = item.sku?.trim() ?? "";
      rows.push({
        payload: item,
        member: normalizeVariationPayload(
          item,
          marketplaceId,
          fallbackSku,
          "variationParentSku",
        ),
      });
    }
    pageToken = payload.pagination?.nextToken?.trim() || null;
    page += 1;
  } while (pageToken && page < 10);

  return {
    rows,
    requestIds,
    familyComplete: !pageToken,
    usedCompatibilityFallback,
  };
}

async function fetchLiveVariationFamily(
  marketplaceId: MarketplaceId,
  sellerSku: string,
): Promise<VariationFamilySnapshot> {
  const queriedResult = await fetchVariationItem(marketplaceId, sellerSku);
  let queried = queriedResult.member;
  if (queried.role !== "parent" && !queried.fba) {
    throw new SpApiError(
      "此 SKU 無法確認為 FBA 子商品；變體規劃不會讀取 FBM 商品。",
      { status: 422, code: "FBA_ONLY", requestId: queriedResult.requestId },
    );
  }

  let parentResult: Awaited<ReturnType<typeof fetchVariationItem>> | null = null;
  let parent: VariationFamilyMember | null = null;
  let childrenResult: Awaited<ReturnType<typeof fetchVariationChildren>> | null = null;
  const parentSku = queried.role === "parent" ? queried.sellerSku : queried.parentSku;
  if (queried.role === "child" && parentSku) {
    parentResult = await fetchVariationItem(marketplaceId, parentSku);
    parent = { ...parentResult.member, role: "parent" };
  } else if (queried.role === "parent") {
    parent = queried;
  }
  if (parentSku) {
    childrenResult = await fetchVariationChildren(marketplaceId, parentSku);
  }

  const rawChildren = childrenResult?.rows ?? [];
  const dimensionContext = [
    ...(parent?.dimensions ?? []),
    ...queried.dimensions,
    ...rawChildren.flatMap((row) => row.member.dimensions),
  ];
  const dimensionNames = [
    ...new Set(dimensionContext.map((dimension) => dimension.name)),
  ];
  const variationTheme =
    parent?.variationTheme ??
    queried.variationTheme ??
    rawChildren.map((row) => row.member.variationTheme).find(Boolean) ??
    null;
  queried = applyVariationDimensionNames(
    queriedResult.payload as VariationListingPayload,
    marketplaceId,
    queried,
    variationTheme,
    dimensionNames,
  );
  if (parentResult && parent) {
    parent = applyVariationDimensionNames(
      parentResult.payload as VariationListingPayload,
      marketplaceId,
      parent,
      variationTheme,
      dimensionNames,
    );
  } else if (parent?.sellerSku === queried.sellerSku) {
    parent = queried;
  }

  const excludedChildren: VariationFamilySnapshot["excludedChildren"] = [];
  const childMap = new Map<string, VariationFamilyMember>();
  for (const row of rawChildren) {
    const member = applyVariationDimensionNames(
      row.payload as VariationListingPayload,
      marketplaceId,
      {
        ...row.member,
        role: row.member.role === "parent" ? "parent" : "child",
        parentSku: row.member.parentSku ?? parentSku,
      },
      variationTheme,
      dimensionNames,
    );
    if (!member.sellerSku) {
      excludedChildren.push({
        sellerSku: "（Amazon 未回傳 SKU）",
        reason: "Amazon 子商品資料缺少 Seller SKU，已停止加入規劃。",
      });
    } else if (member.role === "parent") {
      excludedChildren.push({
        sellerSku: member.sellerSku,
        reason: "Amazon 搜尋結果把此項標記為 parent，不能當作子商品拖移。",
      });
    } else if (!member.fba) {
      excludedChildren.push({
        sellerSku: member.sellerSku,
        reason: "無法確認為 FBA 子商品，純 FBA 規劃已排除。",
      });
    } else {
      childMap.set(member.sellerSku, member);
    }
  }
  if (queried.role === "child" && queried.fba) {
    childMap.set(queried.sellerSku, queried);
  }

  const requestIds = [
    queriedResult.requestId,
    parentResult?.requestId,
    ...(childrenResult?.requestIds ?? []),
  ].filter((value): value is string => Boolean(value));
  const compatibilityFallback =
    queriedResult.profile === "attributes" ||
    parentResult?.profile === "attributes" ||
    childrenResult?.usedCompatibilityFallback;
  return {
    mode: "live",
    marketplaceId,
    queriedSku: sellerSku,
    queriedRole: queried.role,
    queried,
    parent,
    children: [...childMap.values()].sort((left, right) =>
      left.sellerSku.localeCompare(right.sellerSku),
    ),
    excludedChildren,
    variationTheme,
    dimensionNames,
    familyComplete:
      (childrenResult?.familyComplete ?? true) &&
      variationSearchIncludesDeclaredChildren(
        parent,
        rawChildren.map((row) => row.member),
      ),
    fetchedAt: new Date().toISOString(),
    requestIds: [...new Set(requestIds)],
    writable: false,
    boundaries: [
      "Family 快照本身是唯讀資料；只有固定的變體改掛流程可送出 allowlisted PATCH。",
      "既有子商品改掛另一個 parent 需要先移除舊關係再重建，屬於非原子流程。",
      "解除與加入各自都必須重新讀取、Amazon Validation Preview、Touch ID、持久防重送與送出後唯讀回查。",
      "Parent 僅作為不可售的唯讀容器例外；所有可拖移 child 都必須可確認為 FBA。",
    ],
    notice: compatibilityFallback
      ? "Amazon 拒絕 relationships 資料集；目前以 Listing attributes 與 variationParentSku 唯讀結果交叉整理。"
      : "關係取自 Listings Items relationships、attributes 與 variationParentSku 唯讀查詢。",
  };
}

function throwVariationValidation(error: unknown): never {
  if (error instanceof VariationUpdateValidationError) {
    const conflictCodes = new Set([
      "VARIATION_RELATIONSHIP_CHANGED",
      "VARIATION_RELATIONSHIP_CONFLICT",
      "VARIATION_NOT_DETACHED",
      "VARIATION_DETACH_NOT_VERIFIED",
      "VARIATION_ATTACH_NOT_VERIFIED",
    ]);
    throw new SpApiError(error.message, {
      status: conflictCodes.has(error.code) ? 409 : 422,
      code: error.code,
    });
  }
  throw error;
}

function exactDimensionNames(left: string[], right: string[]): boolean {
  const normalize = (values: string[]) => [...new Set(values.map((value) => value.trim()))]
    .filter(Boolean)
    .sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function variationTargetParent(
  family: VariationFamilySnapshot,
): VariationFamilyMember | null {
  return family.queried.role === "parent" ? family.queried : family.parent;
}

async function prepareLiveVariationContext(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  targetParentSku: string;
}, options: { requireStandaloneSource?: boolean } = {}): Promise<{
  sourceResult: Awaited<ReturnType<typeof fetchVariationItem>>;
  sourceFamily: VariationFamilySnapshot;
  targetFamily: VariationFamilySnapshot;
  targetParent: VariationFamilyMember;
  variationTheme: string;
  dimensionNames: string[];
  fields: VariationFieldDescriptor[];
  schemaChecksum: string | null;
  requestIds: string[];
}> {
  const [sourceResult, sourceFamily, targetFamily] = await Promise.all([
    fetchVariationItem(input.marketplaceId, input.sellerSku),
    fetchLiveVariationFamily(input.marketplaceId, input.sellerSku),
    fetchLiveVariationFamily(input.marketplaceId, input.targetParentSku),
  ]);
  const source = sourceResult.member;
  const targetParent = variationTargetParent(targetFamily);
  if (source.role === "parent") {
    throw new SpApiError("Parent 是不可售容器，不能移動成另一個 parent 的 child。", {
      status: 422,
      code: "VARIATION_PARENT_NOT_MOVABLE",
    });
  }
  if (!source.fba) {
    throw new SpApiError("來源 SKU 無法確認為 FBA；變體工具不會加入 FBM。", {
      status: 422,
      code: "FBA_ONLY",
      requestId: sourceResult.requestId,
    });
  }
  if (options.requireStandaloneSource) {
    assertExplicitStandaloneVariationSource(sourceResult, input.marketplaceId);
  }
  if (!sourceFamily.familyComplete || !targetFamily.familyComplete) {
    throw new SpApiError("來源或目標 family 清單不完整，已停止變體寫入準備。", {
      status: 409,
      code: "VARIATION_FAMILY_INCOMPLETE",
    });
  }
  if (!targetParent || targetParent.sellerSku !== input.targetParentSku) {
    throw new SpApiError("目標 SKU 不是可核對的 parent 容器。", {
      status: 422,
      code: "VARIATION_TARGET_NOT_PARENT",
    });
  }
  if (
    !source.productType ||
    !targetParent.productType ||
    source.productType === "PRODUCT" ||
    targetParent.productType === "PRODUCT" ||
    source.productType !== targetParent.productType
  ) {
    throw new SpApiError("來源 child 與目標 parent 的 Amazon product type 無法確認完全一致。", {
      status: 422,
      code: "VARIATION_PRODUCT_TYPE_MISMATCH",
    });
  }
  if (source.parentSku === targetParent.sellerSku) {
    throw new SpApiError("此 child 已屬於目標 parent，沒有可執行的變體改掛。", {
      status: 409,
      code: "VARIATION_UNCHANGED",
    });
  }
  const variationTheme = targetParent.variationTheme ?? targetFamily.variationTheme;
  const dimensionNames = targetFamily.dimensionNames;
  if (!variationTheme || !dimensionNames.length) {
    throw new SpApiError("目標 parent 缺少可核對的 variation theme 或必要維度。", {
      status: 422,
      code: "VARIATION_DIMENSIONS_UNKNOWN",
    });
  }
  const childSchema = await fetchVariationChildSchema(
    input.marketplaceId,
    source.productType,
  );
  let fields: VariationFieldDescriptor[];
  try {
    fields = variationFieldDescriptors({
      productTypeDefinition: childSchema.schema,
      dimensionNames,
      attributes: sourceResult.payload.attributes,
      marketplaceId: input.marketplaceId,
    });
  } catch (error) {
    return throwVariationValidation(error);
  }
  const readOnlyField = fields.find((field) => !field.editable);
  if (readOnlyField) {
    throw new SpApiError(
      `Amazon CHILD PTD 將 ${readOnlyField.name} 標示為唯讀，不能安全改掛此 SKU。`,
      { status: 422, code: "VARIATION_FIELD_READ_ONLY" },
    );
  }
  return {
    sourceResult,
    sourceFamily,
    targetFamily,
    targetParent,
    variationTheme,
    dimensionNames,
    fields,
    schemaChecksum: childSchema.checksum,
    requestIds: [
      sourceResult.requestId,
      childSchema.requestId,
      ...sourceFamily.requestIds,
      ...targetFamily.requestIds,
    ].filter((value): value is string => Boolean(value)),
  };
}

function getDemoVariationMovePreparation(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  targetParentSku: string;
}): VariationMovePreparation {
  const sourceFamily = getDemoVariationFamily(input.marketplaceId, input.sellerSku);
  const targetFamily = getDemoVariationFamily(input.marketplaceId, input.targetParentSku);
  const source = sourceFamily.queried;
  const parent = variationTargetParent(targetFamily);
  if (!parent) {
    throw new SpApiError("展示資料找不到目標 parent。", {
      status: 422,
      code: "VARIATION_TARGET_NOT_PARENT",
    });
  }
  const dimensionNames = targetFamily.dimensionNames;
  const fields: VariationFieldDescriptor[] = dimensionNames.map((name) => {
    const current = source.dimensions.find((dimension) => dimension.name === name)?.values[0] ?? null;
    return {
      name,
      label: name.split("_").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" "),
      editable: true,
      values: current ? [{ value: current, marketplace_id: input.marketplaceId }] : [],
      leaves: [{
        path: ["value"],
        label: "Value",
        type: "string",
        required: true,
        enumValues: [],
        currentValue: current,
      }],
      jsonFallback: false,
    };
  });
  return {
    mode: "demo",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    sourceParentSku: source.parentSku,
    targetParentSku: parent.sellerSku,
    productType: source.productType,
    variationTheme: targetFamily.variationTheme ?? "SIZE_NAME",
    dimensionNames,
    fields,
    preparedAt: new Date().toISOString(),
    requestIds: [],
    writable: false,
    blockers: ["目前為展示模式；只能檢視流程，Amazon 不會收到變體寫入。"],
    warnings: ["正式模式會分成解除與加入兩個非原子階段。"],
    notice: "展示資料模擬 CHILD PTD 欄位；不會寫入 Amazon。",
  };
}

export async function getVariationMovePreparation(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  targetParentSku: string;
}): Promise<VariationMovePreparation> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    return getDemoVariationMovePreparation(input);
  }
  const context = await prepareLiveVariationContext(input);
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    sourceParentSku: context.sourceResult.member.parentSku,
    targetParentSku: context.targetParent.sellerSku,
    productType: context.sourceResult.member.productType,
    variationTheme: context.variationTheme,
    dimensionNames: context.dimensionNames,
    fields: context.fields,
    preparedAt: new Date().toISOString(),
    requestIds: [...new Set(context.requestIds)],
    writable: true,
    blockers: [],
    warnings: [
      context.sourceResult.member.parentSku
        ? "解除舊 parent 與加入新 parent 是兩個非原子階段；每階段都會獨立預檢、Touch ID 與回查。"
        : "此 SKU 目前沒有 parent；加入新 parent 前仍會重新確認為獨立 FBA SKU。",
      `必要欄位來自 Amazon CHILD PTD${context.schemaChecksum ? `（schema ${context.schemaChecksum.slice(0, 12)}…）` : ""}。`,
    ],
    notice: "已核對來源與目標 family、FBA 證據、product type、variation theme 與 CHILD PTD。",
  };
}

function valuesForDimensions(
  payload: AmazonListingItem,
  marketplaceId: MarketplaceId,
  dimensionNames: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    dimensionNames.map((name) => [
      name,
      attributeObjects(payload, name, marketplaceId),
    ]),
  );
}

async function assertNoDuplicateTargetDimensions(input: VariationMoveInput): Promise<void> {
  if (input.action !== "attach") return;
  const children = await fetchVariationChildren(
    input.marketplaceId,
    input.targetParentSku,
  );
  if (!children.familyComplete) {
    throw new SpApiError("目標 family 分頁未完整回傳，無法安全檢查重複變體維度。", {
      status: 409,
      code: "VARIATION_FAMILY_INCOMPLETE",
    });
  }
  let requestedSignature: string;
  try {
    requestedSignature = variationDimensionSignature({
      dimensionNames: input.dimensionNames,
      dimensionValues: input.dimensionValues,
      marketplaceId: input.marketplaceId,
    });
  } catch (error) {
    return throwVariationValidation(error);
  }
  for (const row of children.rows) {
    if (row.member.sellerSku === input.sellerSku) continue;
    let existingSignature: string;
    try {
      existingSignature = variationDimensionSignature({
        dimensionNames: input.dimensionNames,
        dimensionValues: valuesForDimensions(
          row.payload,
          input.marketplaceId,
          input.dimensionNames,
        ),
        marketplaceId: input.marketplaceId,
      });
    } catch {
      throw new SpApiError(
        `目標 family 的 ${row.member.sellerSku} 缺少可核對的必要維度，已停止避免重複 child。`,
        { status: 409, code: "VARIATION_TARGET_DIMENSIONS_INCOMPLETE" },
      );
    }
    if (existingSignature === requestedSignature) {
      throw new SpApiError(
        `目標 family 的 ${row.member.sellerSku} 已有相同變體維度值。`,
        { status: 409, code: "VARIATION_DUPLICATE_DIMENSIONS" },
      );
    }
  }
}

async function prepareLiveVariationDetach(input: VariationDetachInput): Promise<{
  body: VariationPatchBody;
  issues: ListingIssue[];
  sourceParentSku: string;
  targetParentSku: null;
  variationTheme: null;
}> {
  const [sourceResult, sourceFamily] = await Promise.all([
    fetchVariationItem(input.marketplaceId, input.sellerSku),
    fetchLiveVariationFamily(input.marketplaceId, input.sellerSku),
  ]);
  const source = sourceResult.member;
  if (source.role === "parent") {
    throw new SpApiError("Parent 是不可售容器，不能移入解除變體存放區。", {
      status: 422,
      code: "VARIATION_PARENT_NOT_MOVABLE",
    });
  }
  if (!source.fba) {
    throw new SpApiError("來源 SKU 無法確認為 FBA；變體工具不會加入 FBM。", {
      status: 422,
      code: "FBA_ONLY",
      requestId: sourceResult.requestId,
    });
  }
  if (!sourceFamily.familyComplete) {
    throw new SpApiError("來源 family 清單不完整，已停止解除變體。", {
      status: 409,
      code: "VARIATION_FAMILY_INCOMPLETE",
    });
  }
  if (
    source.role !== "child" ||
    !source.parentSku ||
    source.parentSku !== input.expectedSourceParentSku
  ) {
    throw new SpApiError("來源 child 的 parent 已在查詢後變更，請重新讀取。", {
      status: 409,
      code: "VARIATION_RELATIONSHIP_CHANGED",
      requestId: sourceResult.requestId,
    });
  }
  if (!source.productType || source.productType === "PRODUCT") {
    throw new SpApiError("來源 child 的 Amazon product type 無法確認，已停止解除變體。", {
      status: 422,
      code: "VARIATION_PRODUCT_TYPE_UNKNOWN",
      requestId: sourceResult.requestId,
    });
  }
  let body: VariationPatchBody;
  try {
    body = buildVariationDetachBody({
      productType: source.productType,
      marketplaceId: input.marketplaceId,
      expectedParentSku: input.expectedSourceParentSku,
      attributes: sourceResult.payload.attributes,
    });
  } catch (error) {
    return throwVariationValidation(error);
  }
  const response = await executeListingsRequest({
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
    throw new SpApiError("Amazon 變體預檢回應無法辨識，已停止送出。", {
      status: 502,
      code: "VALIDATION_STATUS_UNKNOWN",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  const issues = normalizeListingIssues(payload.issues);
  if (payload.status !== "VALID" || issues.some((issue) => issue.severity === "ERROR")) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 解除變體 Validation Preview 未通過，尚未寫入任何關係。",
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }
  return {
    body,
    issues,
    sourceParentSku: input.expectedSourceParentSku,
    targetParentSku: null,
    variationTheme: null,
  };
}

async function prepareLiveVariationAction(input: VariationMoveInput): Promise<{
  body: VariationPatchBody;
  issues: ListingIssue[];
  sourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
}> {
  if (input.action === "detach") {
    return prepareLiveVariationDetach(input);
  }
  const context = await prepareLiveVariationContext(input, {
    requireStandaloneSource: true,
  });
  if (
    context.targetParent.sellerSku !== input.targetParentSku ||
    context.variationTheme !== input.variationTheme ||
    !exactDimensionNames(context.dimensionNames, input.dimensionNames)
  ) {
    throw new SpApiError("目標 family 的 parent、theme 或必要維度已在準備後變更。", {
      status: 409,
      code: "VARIATION_TARGET_CHANGED",
    });
  }
  let body: VariationPatchBody;
  try {
    assertVariationDetached({
      marketplaceId: input.marketplaceId,
      attributes: context.sourceResult.payload.attributes,
    });
    variationFieldDescriptors({
      productTypeDefinition: (await fetchVariationChildSchema(
        input.marketplaceId,
        context.sourceResult.member.productType,
      )).schema,
      dimensionNames: input.dimensionNames,
      attributes: context.sourceResult.payload.attributes,
      marketplaceId: input.marketplaceId,
    });
    await assertNoDuplicateTargetDimensions(input);
    body = buildVariationAttachBody({
      productType: context.sourceResult.member.productType,
      marketplaceId: input.marketplaceId,
      targetParentSku: input.targetParentSku,
      variationTheme: input.variationTheme,
      dimensionNames: input.dimensionNames,
      dimensionValues: input.dimensionValues,
      existingAttributes: context.sourceResult.payload.attributes,
    });
  } catch (error) {
    return throwVariationValidation(error);
  }
  const response = await executeListingsRequest({
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
    throw new SpApiError("Amazon 變體預檢回應無法辨識，已停止送出。", {
      status: 502,
      code: "VALIDATION_STATUS_UNKNOWN",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  const issues = normalizeListingIssues(payload.issues);
  if (payload.status !== "VALID" || issues.some((issue) => issue.severity === "ERROR")) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 變體 Validation Preview 未通過，尚未寫入任何關係。",
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }
  return {
    body,
    issues,
    sourceParentSku: input.expectedSourceParentSku,
    targetParentSku: input.targetParentSku,
    variationTheme: input.variationTheme,
  };
}

function throwVariationPreCommitFailure(error: unknown): never {
  const cause = error instanceof SpApiError
    ? error
    : new SpApiError("變體正式寫入前的重新讀取或 Validation Preview 失敗。", {
        status: 500,
        code: "PRECOMMIT_FAILED",
        operation: "patchListingsItemPreview",
      });
  throw new SpApiPreCommitError(cause);
}

export async function previewVariationMove(
  input: VariationMoveInput,
): Promise<VariationMovePreview> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    if (input.action === "detach") {
      const source = getDemoVariationFamily(
        input.marketplaceId,
        input.sellerSku,
      ).queried;
      if (
        source.role !== "child" ||
        !source.parentSku ||
        source.parentSku !== input.expectedSourceParentSku ||
        !source.fba
      ) {
        throw new SpApiError("展示 child 的來源 parent 已變更，請重新讀取。", {
          status: 409,
          code: "VARIATION_RELATIONSHIP_CHANGED",
        });
      }
    } else {
      await getVariationMovePreparation({
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        targetParentSku: input.targetParentSku,
      });
    }
    return {
      mode: "demo",
      action: input.action,
      status: "SIMULATED",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      sourceParentSku: input.expectedSourceParentSku,
      targetParentSku: input.action === "attach" ? input.targetParentSku : null,
      variationTheme: input.action === "attach" ? input.variationTheme : null,
      validatedAt: new Date().toISOString(),
      issues: [],
      notice: "展示模式預檢完成；Amazon 不會收到變體寫入。",
    };
  }
  const prepared = await prepareLiveVariationAction(input);
  return {
    mode: "live",
    action: input.action,
    status: "VALID",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    sourceParentSku: prepared.sourceParentSku,
    targetParentSku: prepared.targetParentSku,
    variationTheme: prepared.variationTheme,
    validatedAt: new Date().toISOString(),
    issues: prepared.issues,
    notice: `Amazon 已通過${input.action === "detach" ? "解除舊 parent" : "加入新 parent"}預檢；尚未寫入。`,
  };
}

async function verifyVariationMoveReadback(input: VariationMoveInput): Promise<void> {
  let lastMismatch: unknown = null;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    if (attempt > 0) await wait(Math.min(700 + attempt * 300, 2_000));
    let latest: Awaited<ReturnType<typeof fetchVariationItem>>;
    try {
      latest = await fetchVariationItem(input.marketplaceId, input.sellerSku);
    } catch (error) {
      const detail = error instanceof Error ? `（${error.message}）` : "";
      throw new SpApiError(
        `Amazon 已接受變體請求，但唯讀回查無法完成${detail}。系統已禁止直接重送。`,
        {
          status: 503,
          code: "UPDATE_STATUS_UNKNOWN",
          requestId: error instanceof SpApiError ? error.requestId : null,
          operation: "getListingsItem",
        },
      );
    }
    try {
      if (input.action === "detach") {
        assertExplicitStandaloneVariationSource(latest, input.marketplaceId);
        assertVariationDetached({
          marketplaceId: input.marketplaceId,
          attributes: latest.payload.attributes,
        });
      } else {
        assertVariationAttached({
          marketplaceId: input.marketplaceId,
          targetParentSku: input.targetParentSku,
          variationTheme: input.variationTheme,
          dimensionNames: input.dimensionNames,
          dimensionValues: input.dimensionValues,
          attributes: latest.payload.attributes,
        });
      }
      return;
    } catch (error) {
      lastMismatch = error;
    }
  }
  const detail = lastMismatch instanceof Error ? `（${lastMismatch.message}）` : "";
  throw new SpApiError(
    `Amazon 已接受變體請求，但回查尚未證明完成${detail}。系統已禁止直接重送。`,
    { status: 409, code: "UPDATE_STATUS_UNKNOWN" },
  );
}

export async function updateVariationMove(
  input: VariationMoveInput,
): Promise<VariationMoveResult> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    await previewVariationMove(input);
    return {
      mode: "demo",
      action: input.action,
      status: "SIMULATED",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      sourceParentSku: input.expectedSourceParentSku,
      targetParentSku: input.action === "attach" ? input.targetParentSku : null,
      variationTheme: input.action === "attach" ? input.variationTheme : null,
      verified: true,
      completedAt: new Date().toISOString(),
      submissionId: null,
      requestId: null,
      issues: [],
      notice: "展示模式完成；Amazon 真實變體關係沒有變更。",
    };
  }
  let prepared: Awaited<ReturnType<typeof prepareLiveVariationAction>>;
  try {
    prepared = await prepareLiveVariationAction(input);
  } catch (error) {
    return throwVariationPreCommitFailure(error);
  }
  const response = await executeListingsRequest({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    method: "PATCH",
    body: prepared.body,
  });
  if (!response.ok) {
    return throwListingsError(response, "write", "patchListingsItem");
  }
  const payload = await parseResponseJson<AmazonListingSubmission>(response);
  if (!payload) {
    throw new SpApiError(
      "Amazon 已收到變體請求，但回應無法辨識。請先重新讀取，不要直接重送。",
      {
        status: 502,
        code: "UPDATE_STATUS_UNKNOWN",
        requestId: response.headers.get("x-amzn-requestid"),
      },
    );
  }
  const issues = normalizeListingIssues(payload.issues);
  if (payload.status !== "ACCEPTED" || issues.some((issue) => issue.severity === "ERROR")) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 未接受這次變體關係更新。",
      {
        status: 422,
        code: "UPDATE_REJECTED",
        requestId: response.headers.get("x-amzn-requestid"),
        issues,
      },
    );
  }
  await verifyVariationMoveReadback(input);
  return {
    mode: "live",
    action: input.action,
    status: "ACCEPTED",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    sourceParentSku: input.expectedSourceParentSku,
    targetParentSku: input.action === "attach" ? input.targetParentSku : null,
    variationTheme: input.action === "attach" ? input.variationTheme : null,
    verified: true,
    completedAt: new Date().toISOString(),
    submissionId: payload.submissionId ?? null,
    requestId: response.headers.get("x-amzn-requestid"),
    issues,
    notice: input.action === "detach"
      ? "Amazon 已接受解除，且唯讀回查確認 parent 關係欄位已移除。"
      : `Amazon 已接受加入，且唯讀回查確認 parent 為 ${input.targetParentSku}、theme 與必要維度一致。`,
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
  if (!response.ok) {
    return throwListingsError(response, "read", "patchListingsItemPreview");
  }

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
  if (!response.ok) {
    return throwListingsError(response, "read", "patchListingsItemPreview");
  }

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

export type SalesTrendWindow = {
  timeZone: string;
  range: SalesTrendRange;
  startAt: string;
  endAt: string;
  dateKeys: string[];
  intervals: string[];
  partialDateKey: string | null;
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

function zonedLocalInstant(
  value: string,
  timeZone: string,
  time: Pick<ZonedDateParts, "hour" | "minute" | "second"> = {
    hour: 0,
    minute: 0,
    second: 0,
  },
): Date {
  const [year, month, day] = value.split("-").map(Number);
  const localAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    time.hour,
    time.minute,
    time.second,
  );
  let instant = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next =
      localAsUtc -
      timeZoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

function zonedMidnight(value: string, timeZone: string): Date {
  return zonedLocalInstant(value, timeZone);
}

function calendarDayCount(startDate: string, endDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  return (
    Math.round(
      (Date.UTC(endYear, endMonth - 1, endDay) -
        Date.UTC(startYear, startMonth - 1, startDay)) /
        86_400_000,
    ) + 1
  );
}

function exactYearShift(value: string, years: number): string | null {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year + years, month - 1, day));
  return shifted.getUTCMonth() === month - 1 && shifted.getUTCDate() === day
    ? dateKey(shifted.getUTCFullYear(), month, day)
    : null;
}

function clampedYearShift(value: string, years: number): string {
  const exact = exactYearShift(value, years);
  if (exact) return exact;
  const [year, month] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return dateKey(year + years, month, lastDay);
}

function invalidSalesTrendRange(message: string): never {
  throw new SpApiError(message, {
    status: 400,
    code: "INVALID_SALES_TREND_RANGE",
  });
}

function assertSalesTrendApiHorizon(
  range: SalesTrendRange,
  todayKey: string,
): void {
  const firstConservativeDate = shiftDateKey(
    clampedYearShift(todayKey, -2),
    1,
  );
  if (range.startDate < firstConservativeDate) {
    invalidSalesTrendRange(
      "Sales API 每日資料的開始日必須晚於距今兩年的同一站點日期；請將開始日往後調整至少一天。",
    );
  }
}

export function resolveSalesTrendRange(
  input: {
    marketplaceId: MarketplaceId;
    days?: number | null;
    startDate?: string | null;
    endDate?: string | null;
  },
  now = new Date(),
): SalesTrendRange {
  if (Number.isNaN(now.getTime())) {
    invalidSalesTrendRange("銷售趨勢日期範圍無效。");
  }
  const hasDays = input.days !== null && input.days !== undefined;
  const hasStart = input.startDate !== null && input.startDate !== undefined;
  const hasEnd = input.endDate !== null && input.endDate !== undefined;
  if (hasDays && (hasStart || hasEnd)) {
    invalidSalesTrendRange("預設天數與自訂日期不可同時使用。");
  }
  if (hasStart !== hasEnd) {
    invalidSalesTrendRange("自訂日期必須同時提供開始日與結束日。");
  }

  const timeZone = MARKETPLACES[input.marketplaceId].timeZone;
  const today = zonedDateParts(now, timeZone);
  const todayKey = dateKey(today.year, today.month, today.day);
  if (!hasStart) {
    const days = hasDays ? input.days! : 7;
    if (![7, 14, 30, 90].includes(days)) {
      invalidSalesTrendRange("銷售趨勢只支援最近 7、14、30 或 90 天。");
    }
    const presetDays = days as SalesTrendPresetDays;
    const range = {
      startDate: shiftDateKey(todayKey, -(presetDays - 1)),
      endDate: todayKey,
      dayCount: presetDays,
      presetDays,
    } satisfies SalesTrendRange;
    assertSalesTrendApiHorizon(range, todayKey);
    return range;
  }

  const startDate = input.startDate!;
  const endDate = input.endDate!;
  if (!isDateOnly(startDate) || !isDateOnly(endDate)) {
    invalidSalesTrendRange("自訂日期必須使用 YYYY-MM-DD 格式。");
  }
  const dayCount = calendarDayCount(startDate, endDate);
  if (dayCount < 1 || dayCount > MAX_SALES_TREND_DAY_COUNT) {
    invalidSalesTrendRange(
      `自訂日期範圍必須介於 1 到 ${MAX_SALES_TREND_DAY_COUNT} 天。`,
    );
  }
  if (endDate > todayKey) {
    invalidSalesTrendRange("自訂日期不可包含未來日期。");
  }
  const range = {
    startDate,
    endDate,
    dayCount,
    presetDays: null,
  } satisfies SalesTrendRange;
  assertSalesTrendApiHorizon(range, todayKey);
  return range;
}

function buildSalesTrendRangeWindow(
  marketplaceId: MarketplaceId,
  range: SalesTrendRange,
  partialEnd: Date | null,
): SalesTrendWindow {
  const timeZone = MARKETPLACES[marketplaceId].timeZone;
  const dateKeys = Array.from({ length: range.dayCount }, (_, index) =>
    shiftDateKey(range.startDate, index),
  );
  const endAt = partialEnd
    ? zonedIso(partialEnd, timeZone)
    : zonedIso(zonedMidnight(shiftDateKey(range.endDate, 1), timeZone), timeZone);
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
    range,
    startAt: zonedIso(zonedMidnight(range.startDate, timeZone), timeZone),
    endAt,
    dateKeys,
    intervals,
    partialDateKey: partialEnd ? range.endDate : null,
  };
}

export function buildSalesTrendWindow(
  marketplaceId: MarketplaceId,
  days: SalesTrendPresetDays,
  now = new Date(),
): SalesTrendWindow {
  const range = resolveSalesTrendRange({ marketplaceId, days }, now);
  return buildSalesTrendRangeWindow(marketplaceId, range, now);
}

export function buildCustomSalesTrendWindow(
  marketplaceId: MarketplaceId,
  startDate: string,
  endDate: string,
  now = new Date(),
): SalesTrendWindow {
  const range = resolveSalesTrendRange(
    { marketplaceId, startDate, endDate },
    now,
  );
  const timeZone = MARKETPLACES[marketplaceId].timeZone;
  const today = zonedDateParts(now, timeZone);
  const todayKey = dateKey(today.year, today.month, today.day);
  return buildSalesTrendRangeWindow(
    marketplaceId,
    range,
    range.endDate === todayKey ? now : null,
  );
}

export function buildPreviousYearSalesTrendWindow(
  marketplaceId: MarketplaceId,
  current: SalesTrendWindow,
): SalesTrendWindow {
  const range = {
    startDate: clampedYearShift(current.range.startDate, -1),
    endDate: clampedYearShift(current.range.endDate, -1),
    dayCount: 0,
    presetDays: null,
  } satisfies SalesTrendRange;
  range.dayCount = calendarDayCount(range.startDate, range.endDate);

  let partialEnd: Date | null = null;
  const exactEndDate = exactYearShift(current.range.endDate, -1);
  if (current.partialDateKey && exactEndDate) {
    const currentEnd = new Date(current.endAt);
    const time = zonedDateParts(currentEnd, current.timeZone);
    partialEnd = zonedLocalInstant(exactEndDate, current.timeZone, time);
  }
  return buildSalesTrendRangeWindow(marketplaceId, range, partialEnd);
}

export function buildSalesTrendQuery(
  marketplaceId: MarketplaceId,
  window: SalesTrendWindow,
  options: { sellerSku?: string } = {},
): URLSearchParams {
  const query = new URLSearchParams({
    marketplaceIds: marketplaceId,
    interval: `${window.startAt}--${window.endAt}`,
    granularityTimeZone: window.timeZone,
    granularity: "Day",
    buyerType: "All",
    fulfillmentNetwork: "AFN",
  });
  if (options.sellerSku) query.set("sku", options.sellerSku);
  return query;
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
      partial: metricDate === input.window.partialDateKey,
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
      partial: key === input.window.partialDateKey,
    },
  );
  return { points, totals: salesTrendTotals(points, currencyCode) };
}

async function callSalesTrendApi(
  marketplaceId: MarketplaceId,
  window: SalesTrendWindow,
  forceTokenRefresh = false,
  sellerSku?: string,
): Promise<Response> {
  const marketplace = MARKETPLACES[marketplaceId];
  const token = await requestAccessToken(marketplace.region, forceTokenRefresh);
  const query = buildSalesTrendQuery(marketplaceId, window, { sellerSku });
  const controller = new AbortController();
  // Long custom daily ranges return substantially more buckets. Keep one
  // Sales API request per series (rather than multiplying rate-limited calls),
  // but give Amazon a bounded amount of extra response time.
  const timeoutMilliseconds = Math.min(
    30_000,
    12_000 + window.range.dayCount * 40,
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
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

export function salesTrendRetryDelayMs(
  response: Pick<Response, "headers">,
  attempt: number,
  now = Date.now(),
): number {
  const retryAfter = response.headers.get("retry-after")?.trim();
  let requestedDelay: number | null = null;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      requestedDelay = seconds * 1_000;
    } else {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt) && retryAt > now) {
        requestedDelay = retryAt - now;
      }
    }
  }
  if (requestedDelay !== null) {
    return Math.min(Math.max(Math.ceil(requestedDelay), 2_000), 60_000);
  }
  return Math.min(
    2_000 * 2 ** Math.max(0, attempt) + Math.random() * 250,
    10_000,
  );
}

type SalesTrendSeriesResult = {
  points: SalesTrendPoint[];
  totals: SalesTrendSnapshot["totals"];
  requestId: string | null;
  rateLimit: string | null;
};

type SalesTrendComparisonResult = SalesTrendSeriesResult & {
  range: SalesTrendRange;
};

function comparablePreviousYearSeries(
  currentWindow: SalesTrendWindow,
  comparisonWindow: SalesTrendWindow,
  rawSeries: SalesTrendSeriesResult,
): SalesTrendComparisonResult {
  const comparableDates = new Set(
    currentWindow.dateKeys
      .map((value) => exactYearShift(value, -1))
      .filter((value): value is string => value !== null),
  );
  const points = rawSeries.points.filter((point) => comparableDates.has(point.date));
  return {
    ...rawSeries,
    range: {
      startDate: points[0]?.date ?? comparisonWindow.range.startDate,
      endDate: points.at(-1)?.date ?? comparisonWindow.range.endDate,
      dayCount: points.length,
      presetDays: null,
    },
    points,
    totals: salesTrendTotals(
      points,
      rawSeries.totals.totalSales.currencyCode,
    ),
  };
}

function salesTrendComparisonNotice(
  currentWindow: SalesTrendWindow,
  hasComparison: boolean,
): string | null {
  if (!hasComparison) return null;
  if (
    currentWindow.partialDateKey &&
    !exactYearShift(currentWindow.partialDateKey, -1)
  ) {
    return "今天是 2 月 29 日，去年沒有相同月日；該日的去年同期會留空，不套用相同時分的 cutoff。";
  }
  if (currentWindow.partialDateKey) {
    return "本期包含今天時，去年同期也只計到相同站點當地時間；無法按相同月日對應的閏日會留空。";
  }
  return "去年同期只保留可按相同月日精確對應的日期；無法對應的閏日會留空。";
}

async function fetchLiveSalesTrendSeries(
  marketplaceId: MarketplaceId,
  window: SalesTrendWindow,
  sellerSku?: string,
): Promise<SalesTrendSeriesResult> {
  let response = await callSalesTrendApi(
    marketplaceId,
    window,
    false,
    sellerSku,
  );
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callSalesTrendApi(
      marketplaceId,
      window,
      true,
      sellerSku,
    );
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (![429, 500, 503].includes(response.status)) break;
    await wait(
      response.status === 429
        ? salesTrendRetryDelayMs(response, attempt)
        : retryDelayMs(response, attempt),
    );
    response = await callSalesTrendApi(
      marketplaceId,
      window,
      false,
      sellerSku,
    );
  }
  const requestId = response.headers.get("x-amzn-requestid");
  if (!response.ok) {
    const payload = await parseResponseJson<AmazonSalesMetricsResponse>(response);
    const upstreamMessage = payload?.errors?.find(
      (error) => typeof error?.message === "string" && error.message.trim(),
    )?.message;
    const message =
      response.status === 401 || response.status === 403
        ? "Amazon 拒絕 FBA 銷售趨勢查詢。請確認 Private SP-API App 已具備 Pricing、Inventory and Order Tracking 或 Product Listing 角色，並重新授權。"
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
    marketplaceId,
    window,
  });
  return {
    ...normalized,
    requestId,
    rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
  };
}

async function fetchLiveSalesTrend(input: {
  marketplaceId: MarketplaceId;
  range: SalesTrendRange;
  window: SalesTrendWindow;
  comparisonWindow: SalesTrendWindow | null;
}): Promise<SalesTrendSnapshot> {
  const current = await fetchLiveSalesTrendSeries(
    input.marketplaceId,
    input.window,
  );
  const rawPrevious = input.comparisonWindow
    ? await fetchLiveSalesTrendSeries(input.marketplaceId, input.comparisonWindow)
    : null;
  const previous =
    rawPrevious && input.comparisonWindow
      ? comparablePreviousYearSeries(
          input.window,
          input.comparisonWindow,
          rawPrevious,
        )
      : null;
  const comparisonNotice = salesTrendComparisonNotice(
    input.window,
    Boolean(input.comparisonWindow),
  );
  return {
    schemaVersion: 2,
    mode: "live",
    marketplaceId: input.marketplaceId,
    days: input.range.dayCount,
    range: input.range,
    timeZone: input.window.timeZone,
    points: current.points,
    totals: current.totals,
    fetchedAt: new Date().toISOString(),
    requestId: current.requestId,
    rateLimit: current.rateLimit,
    comparison:
      previous && input.comparisonWindow
        ? {
            kind: "previous-year",
            range: previous.range,
            points: previous.points,
            totals: previous.totals,
            requestId: previous.requestId,
            rateLimit: previous.rateLimit,
          }
        : null,
    notice: comparisonNotice
      ? `Sales API 以站點當地日界彙總；僅包含 Amazon 配送（AFN/FBA）。${comparisonNotice}`
      : "Sales API 以站點當地日界彙總；僅包含 Amazon 配送（AFN/FBA），今日數字仍會變動。",
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

const FBA_INVENTORY_AUDIT_MAX_PAGES = 200;

async function callFbaInventoryAuditPage(
  marketplaceId: MarketplaceId,
  nextToken: string | null,
  forceTokenRefresh = false,
): Promise<Response> {
  const marketplace = MARKETPLACES[marketplaceId];
  const token = await requestAccessToken(marketplace.region, forceTokenRefresh);
  const query = new URLSearchParams({
    granularityType: "Marketplace",
    granularityId: marketplaceId,
    marketplaceIds: marketplaceId,
    details: "true",
  });
  if (nextToken) query.set("nextToken", nextToken);
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
      throw new SpApiError("Amazon FBA 全站庫存證據查詢逾時，已停止健檢。", {
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

function inventoryNextTokenFromResponse(value: unknown): string | null {
  if (!isRecord(value)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 庫存分頁資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  if (value.pagination === undefined || value.pagination === null) return null;
  if (!isRecord(value.pagination)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 庫存分頁資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  const nextToken = value.pagination.nextToken;
  if (nextToken === undefined || nextToken === null || nextToken === "") return null;
  if (
    typeof nextToken !== "string" ||
    nextToken.length > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(nextToken)
  ) {
    throw new SpApiError("Amazon 回傳了無效的 FBA 庫存 nextToken。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  return nextToken;
}

async function throwFbaInventoryAuditError(response: Response): Promise<never> {
  const payload = await parseResponseJson<{
    errors?: Array<{ message?: string }>;
  }>(response);
  const requestId = response.headers.get("x-amzn-requestid");
  const upstreamMessage = payload?.errors?.find((item) => item.message)?.message;
  throw new SpApiError(
    response.status === 401 || response.status === 403
      ? "Amazon 拒絕 FBA 全站庫存證據查詢。請確認 Amazon Fulfillment 角色並重新授權。"
      : response.status === 429
        ? "Amazon FBA Inventory API 正在限流；本次健檢已停止，沒有自動重送。"
        : upstreamMessage || "Amazon 暫時無法完成 FBA 全站庫存證據查詢。",
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

export type CurrentFbaSkuEvidence = {
  knownFbaSkus: Set<string>;
  returnedInventoryRows: number;
  unrecognizedSellerSkuRows: number;
};

async function fetchLiveCurrentFbaSkuEvidence(
  marketplaceId: MarketplaceId,
): Promise<CurrentFbaSkuEvidence> {
  return collectCurrentFbaSkuEvidence(async (nextToken) => {
    let response = await callFbaInventoryAuditPage(marketplaceId, nextToken);
    // One explicit credential refresh is allowed; 429/5xx/timeouts are never
    // automatically replayed by this audit path.
    if (response.status === 401) {
      tokenCache.delete(MARKETPLACES[marketplaceId].region);
      response = await callFbaInventoryAuditPage(marketplaceId, nextToken, true);
    }
    if (!response.ok) return throwFbaInventoryAuditError(response);
    const payload = await parseResponseJson<AmazonInventorySummariesResponse>(response);
    return payload;
  });
}

export async function collectCurrentFbaSkuEvidence(
  transport: (nextToken: string | null) => Promise<unknown>,
): Promise<CurrentFbaSkuEvidence> {
  const sellerSkus = new Set<string>();
  const seenTokens = new Set<string>();
  let returnedInventoryRows = 0;
  let unrecognizedSellerSkuRows = 0;
  let nextToken: string | null = null;
  for (let page = 0; page < FBA_INVENTORY_AUDIT_MAX_PAGES; page += 1) {
    const payload = await transport(nextToken);
    const summaries = inventorySummariesFromResponse(payload);
    if (!summaries) {
      throw new SpApiError("Amazon 回傳了無法辨識的 FBA 全站庫存資料。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    for (const summary of summaries) {
      returnedInventoryRows += 1;
      if (!Number.isSafeInteger(returnedInventoryRows)) {
        throw new SpApiError("FBA Inventory 回傳列數超過安全上限。", {
          status: 502,
          code: "UPSTREAM_UNAVAILABLE",
        });
      }
      const sku = exactInventorySellerSku(summary.sellerSku);
      if (!sku) {
        unrecognizedSellerSkuRows += 1;
        continue;
      }
      if (sellerSkus.has(sku)) {
        throw new SpApiError("FBA Inventory 分頁重複回傳同一 SKU，已停止健檢。", {
          status: 409,
          code: "PAGINATION_CHANGED",
        });
      }
      sellerSkus.add(sku);
    }
    nextToken = inventoryNextTokenFromResponse(payload);
    if (!nextToken) {
      return {
        knownFbaSkus: sellerSkus,
        returnedInventoryRows,
        unrecognizedSellerSkuRows,
      };
    }
    if (summaries.length === 0) {
      throw new SpApiError("FBA Inventory 回傳空白分頁但仍有 nextToken，已停止健檢。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    if (seenTokens.has(nextToken)) {
      throw new SpApiError("FBA Inventory 分頁 nextToken 重複，已停止健檢。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    seenTokens.add(nextToken);
  }
  throw new SpApiError("FBA Inventory 分頁超過安全上限，無法證明已完整讀取。", {
    status: 409,
    code: "PAGINATION_LIMIT_EXCEEDED",
  });
}

export async function collectCurrentFbaSkuSet(
  transport: (nextToken: string | null) => Promise<unknown>,
): Promise<Set<string>> {
  return (await collectCurrentFbaSkuEvidence(transport)).knownFbaSkus;
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

async function callReplenishmentAuditPage(
  marketplaceId: MarketplaceId,
  request: ReplenishmentPageRequest,
  forceTokenRefresh = false,
): Promise<Response> {
  // This assertion compares the entire request to the canonical module-built
  // request. The transport cannot be used as a generic SP-API POST tunnel.
  assertReplenishmentRequestBody(request);
  const marketplace = MARKETPLACES[marketplaceId];
  const token = await requestAccessToken(marketplace.region, forceTokenRefresh);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(`${REGION_ENDPOINTS[marketplace.region]}${request.path}`, {
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
      body: JSON.stringify(request.body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon Subscribe & Save 全站健檢逾時，已停止讀取。", {
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

async function executeReplenishmentAuditPage(
  marketplaceId: MarketplaceId,
  request: ReplenishmentPageRequest,
): Promise<unknown> {
  let response = await callReplenishmentAuditPage(marketplaceId, request);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callReplenishmentAuditPage(marketplaceId, request, true);
  }
  // No 429/5xx/timeout replay: every metrics month either succeeds once or
  // fails the whole requested-period snapshot visibly.
  if (!response.ok) return throwReplenishmentError(response);
  const payload = await parseResponseJson<unknown>(response);
  if (payload === null) {
    throw new SpApiError("Amazon 回傳了無法辨識的 Subscribe & Save 健檢資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  return payload;
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

function demoVariationFamilies(marketplaceId: MarketplaceId): Array<{
  parentSku: string;
  theme: string;
  dimensionName: string;
  children: Array<{ sellerSku: string; value: string }>;
}> {
  return marketplaceId === "A1VC38T7YXB528"
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
      "正式模式只允許固定的兩階段 Validation Preview、Touch ID、持久防重送、單次 PATCH 與唯讀回查。",
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

function subscriptionInventoryEvidence(
  currentFba: CurrentFbaSkuEvidence,
  verifiableReplenishmentOfferCount: number,
): SubscriptionAuditSnapshot["inventoryEvidence"] {
  if (
    !Number.isSafeInteger(verifiableReplenishmentOfferCount) ||
    verifiableReplenishmentOfferCount < 0 ||
    verifiableReplenishmentOfferCount > currentFba.knownFbaSkus.size ||
    !Number.isSafeInteger(currentFba.returnedInventoryRows) ||
    !Number.isSafeInteger(currentFba.unrecognizedSellerSkuRows) ||
    currentFba.returnedInventoryRows < 0 ||
    currentFba.unrecognizedSellerSkuRows < 0 ||
    currentFba.returnedInventoryRows !==
      currentFba.knownFbaSkus.size + currentFba.unrecognizedSellerSkuRows
  ) {
    throw new SpApiError(
      "Subscribe & Save offer 範圍與同次 FBA Inventory 證據不一致。",
      { status: 502, code: "UPSTREAM_UNAVAILABLE" },
    );
  }
  return {
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION",
    coverage:
      currentFba.unrecognizedSellerSkuRows === 0 ? "complete" : "partial",
    returnedInventoryRows: currentFba.returnedInventoryRows,
    provenSkuCount: currentFba.knownFbaSkus.size,
    unrecognizedSellerSkuRows: currentFba.unrecognizedSellerSkuRows,
    verifiableReplenishmentOfferCount,
    unverifiedFbaSkuCount:
      currentFba.knownFbaSkus.size - verifiableReplenishmentOfferCount,
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
}): Promise<SubscriptionAuditSnapshot> {
  const now = input.now ? new Date(input.now.getTime()) : new Date();
  const intervals = officialCompleteMonthlyIntervals(input.months, now);
  if (!SELLER_REPLENISHMENT_MARKETPLACES.has(input.marketplaceId)) {
    throw new SpApiError(
      `${MARKETPLACES[input.marketplaceId].label}站目前不在 Amazon 公開的 Seller Replenishment API 支援清單。`,
      { status: 422, code: "REPLENISHMENT_MARKETPLACE_UNSUPPORTED" },
    );
  }
  if (shouldUseDemoMode(input.marketplaceId)) {
    return getDemoSubscriptionAudit(input.marketplaceId, input.months, now);
  }
  // Current FBA evidence and Replenishment are both fetched during this single
  // audit invocation. Incomplete Inventory pagination aborts before any offer
  // can be represented as currently FBA.
  const currentFba = await fetchLiveCurrentFbaSkuEvidence(input.marketplaceId);
  const audit = await fetchFbaSubscriptionAuditHistory({
    marketplaceId: input.marketplaceId,
    metricIntervals: intervals,
    knownFbaSkus: currentFba.knownFbaSkus,
    knownFbaSkuCoverage:
      currentFba.unrecognizedSellerSkuRows === 0 ? "complete" : "partial",
    now,
    transport: (request) => executeReplenishmentAuditPage(input.marketplaceId, request),
  });
  return {
    ...audit,
    mode: "live",
    marketplaceId: input.marketplaceId,
    requestedMonths: input.months,
    fetchedAt: now.toISOString(),
    inventoryEvidence: subscriptionInventoryEvidence(
      currentFba,
      audit.offers.length,
    ),
    notice: currentFba.unrecognizedSellerSkuRows > 0
      ? `本頁已完整讀取同次 FBA Inventory 分頁；其中 ${currentFba.unrecognizedSellerSkuRows} 列 Seller SKU 無法原樣辨識，已保留為覆蓋不完整，未 trim、改名、推定不符合資格或計為 0。其餘可原樣核對的 FBA SKU 照常比對；月度 PERFORMANCE 缺值維持缺值。`
      : "本頁以同次完整分頁 FBA Inventory API 作為總範圍，分開顯示可核對 Replenishment offer 與未取得可核對 offer（未回傳或資料值無法安全解析）的 FBA SKU；後者不代表不符合資格或 0 訂閱。Replenishment offers 全站只抓一次；月度 PERFORMANCE 缺值維持缺值，不補 0。",
  };
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

function exactAsin(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9]{10}$/u.test(value)
    ? value
    : null;
}

export function sellerSkuFromAsinSearchPayload(input: {
  marketplaceId: MarketplaceId;
  asin: string;
  payload: unknown;
  requestId?: string | null;
}): string {
  const requestId = input.requestId ?? null;
  if (!exactAsin(input.asin)) {
    throw new SpApiError("ASIN 必須是原樣 10 碼大寫英數字。", {
      status: 400,
      code: "INVALID_INPUT",
      requestId,
    });
  }
  if (!isRecord(input.payload) || !Array.isArray(input.payload.items)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 ASIN Listing 查詢資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId,
    });
  }
  const pagination = input.payload.pagination;
  const numberOfResults = input.payload.numberOfResults;
  if (
    (pagination !== undefined &&
      !isRecord(pagination)) ||
    (numberOfResults !== undefined &&
      (typeof numberOfResults !== "number" ||
        !Number.isSafeInteger(numberOfResults) ||
        numberOfResults < 0))
  ) {
    throw new SpApiError(
      "Amazon ASIN Listing 查詢的分頁或列數格式無法辨識。",
      { status: 502, code: "UPSTREAM_UNAVAILABLE", requestId },
    );
  }
  if (input.payload.items.length === 0) {
    if (
      (typeof numberOfResults === "number" && numberOfResults !== 0) ||
      (isRecord(pagination) && pagination.nextToken)
    ) {
      throw new SpApiError(
        "Amazon ASIN Listing 查詢列數與回傳明細不一致，無法唯一解析 SKU。",
        { status: 502, code: "UPSTREAM_UNAVAILABLE", requestId },
      );
    }
    throw new SpApiError("此 ASIN 找不到這個賣家帳號的 Listing。", {
      status: 404,
      code: "ASIN_NOT_FOUND",
      requestId,
    });
  }
  const sellerSkus: string[] = [];
  for (const value of input.payload.items) {
    if (!isRecord(value) || !Array.isArray(value.summaries)) {
      throw new SpApiError("Amazon ASIN Listing 查詢缺少可核對的 summary。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId,
      });
    }
    const exactSummary = value.summaries.find(
      (summary) => isRecord(summary) &&
        summary.marketplaceId === input.marketplaceId &&
        summary.asin === input.asin,
    );
    const sellerSku =
      typeof value.sku === "string" &&
        Boolean(value.sku) &&
        value.sku.length <= 40 &&
        value.sku === value.sku.trim() &&
        !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
          value.sku,
        )
        ? value.sku
        : null;
    if (!exactSummary || !sellerSku) {
      throw new SpApiError(
        "Amazon ASIN Listing 查詢的 ASIN 或 Seller SKU 無法原樣核對。",
        { status: 502, code: "UPSTREAM_UNAVAILABLE", requestId },
      );
    }
    sellerSkus.push(sellerSku);
  }
  if (new Set(sellerSkus).size !== sellerSkus.length) {
    throw new SpApiError("Amazon ASIN Listing 查詢重複回傳相同 Seller SKU。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId,
    });
  }
  if (
    sellerSkus.length > 1 ||
    (typeof numberOfResults === "number" && numberOfResults > 1) ||
    (isRecord(pagination) && Boolean(pagination.nextToken))
  ) {
    throw new SpApiError(
      "此 ASIN 對應多個 Seller SKU；請選擇確切 SKU 後再開啟變體 family。",
      { status: 409, code: "ASIN_AMBIGUOUS", requestId },
    );
  }
  if (numberOfResults !== undefined && numberOfResults !== 1) {
    throw new SpApiError(
      "Amazon ASIN Listing 查詢列數與唯一明細不一致，無法解析 SKU。",
      { status: 502, code: "UPSTREAM_UNAVAILABLE", requestId },
    );
  }
  return sellerSkus[0]!;
}

async function resolveLiveSellerSkuByAsin(
  marketplaceId: MarketplaceId,
  asin: string,
): Promise<string> {
  let response = await callListingsSearchApi(
    marketplaceId,
    [asin],
    false,
    false,
    "standard",
    UNBOUND_VARIATION_SEARCH_INCLUDED_DATA,
    "ASIN",
    20,
  );
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[marketplaceId].region);
    response = await callListingsSearchApi(
      marketplaceId,
      [asin],
      true,
      false,
      "standard",
      UNBOUND_VARIATION_SEARCH_INCLUDED_DATA,
      "ASIN",
      20,
    );
  }
  if (!response.ok) {
    return throwListingsError(response, "read", "searchListingsItems");
  }
  const payload = await parseResponseJson<AmazonListingSearchResponse>(response);
  return sellerSkuFromAsinSearchPayload({
    marketplaceId,
    asin,
    payload,
    requestId: response.headers.get("x-amzn-requestid"),
  });
}

function resolveDemoSellerSkuByAsin(
  marketplaceId: MarketplaceId,
  asin: string,
): string {
  if (!exactAsin(asin)) {
    throw new SpApiError("ASIN 必須是原樣 10 碼大寫英數字。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  const sellerSkus = [
    ...new Set(
      buildDemoOrders(marketplaceId)
        .flatMap((order) => order.items)
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
    await resolveLiveSellerSkuByAsin(input.marketplaceId, input.asin!);
  return fetchLiveVariationFamily(input.marketplaceId, sellerSku);
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
      listing.notice?.includes("寫入已停用")
        ? listing.notice
        : listing.mode === "live"
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
    true,
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
  if (!response.ok) {
    return throwListingsError(response, "write", "patchListingsItemPreview");
  }
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
  if (!response.ok) {
    return throwListingsError(response, "write", "patchListingsItem");
  }
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

async function throwReportsError(
  response: Response,
  purpose: "listings" | "aged-inventory" | "brand-sales" = "listings",
): Promise<never> {
  const payload = await parseResponseJson<{
    errors?: Array<{ code?: string; message?: string }>;
  }>(response);
  const upstreamMessage = payload?.errors?.find(
    (error) => typeof error.message === "string" && error.message.trim(),
  )?.message;
  const subject = purpose === "aged-inventory"
    ? "FBA 庫齡報表"
    : purpose === "brand-sales"
      ? "FBA 品牌出貨報表"
      : "全商品報表";
  const message =
    response.status === 429
      ? `Amazon 正在限制${subject}請求頻率，請稍後再試。`
      : response.status === 401 || response.status === 403
        ? purpose === "listings"
          ? "Amazon 拒絕報表查詢，請確認 app 已有 Product Listing 權限並重新授權。"
          : `Amazon 拒絕${subject}查詢，請確認 app 已有 Amazon Fulfillment 角色並重新授權。`
        : `Amazon 無法完成${subject}。`;
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
      code: status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL",
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

const CUSTOMER_FEEDBACK_SUPPORTED_MARKETPLACES = new Set<MarketplaceId>([
  "ATVPDKIKX0DER",
  "A1VC38T7YXB528",
  "A1F83G8C2ARO7P",
  "A1PA6795UKMFR9",
]);

function demoReviewAuditCandidates(
  marketplaceId: MarketplaceId,
): ReviewAuditCandidateSnapshot {
  const seeds = Array.from({ length: 6 }, (_, index) => ({
    sellerSku: `DEMO-REVIEW-${index + 1}`,
    asin: `B0DEMOREV${index + 1}`,
    title: `展示用 FBA 評論主題商品 ${index + 1}`,
    relationshipRole: index % 2 === 0 ? "child" as const : "standalone" as const,
  }));
  return {
    mode: "demo",
    marketplaceId,
    sourceCandidateCount: seeds.length,
    candidates: dedupeFbaReviewCandidates(seeds),
    relationshipIncompleteRows: [],
    coverage: {
      sourceFbaListings: seeds.length,
      verifiedNonParentListings: seeds.length,
      verifiedChildListings: seeds.filter(({ relationshipRole }) =>
        relationshipRole === "child").length,
      verifiedStandaloneListings: seeds.filter(({ relationshipRole }) =>
        relationshipRole === "standalone").length,
      excludedParentContainers: 0,
      relationshipIncomplete: 0,
    },
    notice: "展示資料僅供非 parent FBA ASIN 版面與 Excel 測試，沒有呼叫 Amazon。",
  };
}

/**
 * Downloads the already-validated all-listings report, then batch-verifies
 * every AMAZON/AFN row with Listings summaries and relationships before any
 * Customer Feedback request is allowed.
 */
export async function getFbaReviewAuditCandidates(input: {
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
}): Promise<ReviewAuditCandidateSnapshot> {
  if (!CUSTOMER_FEEDBACK_SUPPORTED_MARKETPLACES.has(input.marketplaceId)) {
    throw new SpApiError(
      "Amazon Customer Feedback API 尚不支援此站點；未改用父變體或私有接口。",
      { status: 422, code: "MARKETPLACE_UNSUPPORTED" },
    );
  }
  if (shouldUseDemoMode(input.marketplaceId)) {
    const expected = `demo-${input.marketplaceId}`;
    if (input.reportId !== expected || input.documentId !== expected) {
      throw new SpApiError("展示用 FBA 評論報表資訊不相符。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    return demoReviewAuditCandidates(input.marketplaceId);
  }
  const status = await getAllListingsReportStatus({
    marketplaceId: input.marketplaceId,
    reportId: input.reportId,
  });
  if (!status.ready || status.documentId !== input.documentId) {
    throw new SpApiError("全商品報表尚未就緒或文件資訊已改變。", {
      status: 409,
      code: "REPORT_NOT_READY",
    });
  }
  const document = await downloadReportDocument(
    input.marketplaceId,
    input.documentId,
  );
  return verifyFbaReviewAuditSeeds({
    marketplaceId: input.marketplaceId,
    seeds: parseFbaListingReportSeeds(document),
  });
}

type CustomerFeedbackRequestInput = {
  marketplaceId: MarketplaceId;
  asin: string;
  forceTokenRefresh?: boolean;
};

const CUSTOMER_FEEDBACK_REQUEST_INTERVAL_MS = 1_050;

async function callCustomerFeedbackApi(
  input: CustomerFeedbackRequestInput,
): Promise<Response> {
  const marketplace = MARKETPLACES[input.marketplaceId];
  const token = await requestAccessToken(
    marketplace.region,
    input.forceTokenRefresh ?? false,
  );
  const query = new URLSearchParams({
    marketplaceId: input.marketplaceId,
    sortBy: "STAR_RATING_IMPACT",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(
      `${REGION_ENDPOINTS[marketplace.region]}/customerFeedback/2024-06-01/items/${encodeURIComponent(input.asin)}/reviews/topics?${query}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(),
          "user-agent": process.env.SP_API_USER_AGENT ||
            "AmazonFBAOS/0.1 (Language=TypeScript; Platform=macOS)",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SpApiError("Amazon Customer Feedback API 回應逾時。", {
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
        operation: "getItemReviewTopics",
      });
    }
    throw new SpApiError("目前無法連線至 Amazon Customer Feedback API。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      operation: "getItemReviewTopics",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function executeCustomerFeedbackRequest(
  input: CustomerFeedbackRequestInput & { expectedMode: "live" | "demo" },
): Promise<Response> {
  assertCustomerFeedbackMode(input.marketplaceId, input.expectedMode);
  let response = await callCustomerFeedbackApi(input);
  if (response.status === 401) {
    tokenCache.delete(MARKETPLACES[input.marketplaceId].region);
    await wait(CUSTOMER_FEEDBACK_REQUEST_INTERVAL_MS);
    assertCustomerFeedbackMode(input.marketplaceId, input.expectedMode);
    response = await callCustomerFeedbackApi({ ...input, forceTokenRefresh: true });
  }
  if ([500, 503].includes(response.status)) {
    await wait(Math.max(
      CUSTOMER_FEEDBACK_REQUEST_INTERVAL_MS,
      retryDelayMs(response, 0),
    ));
    assertCustomerFeedbackMode(input.marketplaceId, input.expectedMode);
    response = await callCustomerFeedbackApi(input);
  }
  return response;
}

function assertCustomerFeedbackMode(
  marketplaceId: MarketplaceId,
  expectedMode: "live" | "demo",
): "live" | "demo" {
  const currentMode = shouldUseDemoMode(marketplaceId) ? "demo" : "live";
  if (currentMode !== expectedMode) {
    throw new SpApiError(
      "App 展示／真實模式已改變，已停止舊評論健檢。",
      { status: 409, code: "REPORT_MODE_CHANGED" },
    );
  }
  return currentMode;
}

function demoCustomerFeedbackResult(input: {
  marketplaceId: MarketplaceId;
  candidate: DedupedFbaReviewCandidate;
}): ReviewAuditFetchResult {
  const ordinal = Number(input.candidate.asin.at(-1));
  if (ordinal === 6) {
    return { candidate: input.candidate, response: null, noContent: true };
  }
  return {
    candidate: input.candidate,
    response: {
      asin: input.candidate.asin,
      itemName: input.candidate.title,
      marketplaceId: input.marketplaceId,
      countryCode: REPORT_LIBRARY_MARKETPLACE_CODE[input.marketplaceId],
      dateRange: {
        startDate: "2026-02-01T00:00:00.000Z",
        endDate: "2026-08-01T00:00:00.000Z",
      },
      topics: {
        positiveTopics: [{
          topic: ordinal % 2 === 0 ? "Taste" : "Quality",
          asinMetrics: {
            numberOfMentions: 8 + ordinal,
            occurrencePercentage: 12 + ordinal,
            starRatingImpact: 3 + ordinal / 10,
          },
          reviewSnippets: ["Demo positive topic evidence"],
        }],
        negativeTopics: [{
          topic: ordinal % 2 === 0 ? "Smell" : "Size",
          asinMetrics: {
            numberOfMentions: 2 + ordinal,
            occurrencePercentage: 3 + ordinal,
            starRatingImpact: -(0.5 + ordinal / 10),
          },
          reviewSnippets: ["Demo negative topic evidence"],
        }],
      },
    },
  };
}

const REPORT_LIBRARY_MARKETPLACE_CODE: Record<MarketplaceId, string> = {
  ATVPDKIKX0DER: "US",
  A1VC38T7YXB528: "JP",
  A2EUQ1WTGCTBG2: "CA",
  A19VAU5U5O7RUS: "SG",
  A39IBJ37TRP1C6: "AU",
  A1F83G8C2ARO7P: "GB",
  A1PA6795UKMFR9: "DE",
};

/** One public Customer Feedback request for one relationships-proven non-parent FBA ASIN. */
export async function getCustomerFeedbackReviewTopics(input: {
  marketplaceId: MarketplaceId;
  candidate: DedupedFbaReviewCandidate;
  expectedMode: "live" | "demo";
}): Promise<ReviewAuditFetchResult> {
  if (!CUSTOMER_FEEDBACK_SUPPORTED_MARKETPLACES.has(input.marketplaceId)) {
    return {
      candidate: input.candidate,
      response: null,
      error: {
        code: "MARKETPLACE_UNSUPPORTED",
        message: "Amazon Customer Feedback API 尚不支援此站點。",
      },
    };
  }
  const currentMode = assertCustomerFeedbackMode(
    input.marketplaceId,
    input.expectedMode,
  );
  if (currentMode === "demo") {
    return demoCustomerFeedbackResult(input);
  }
  try {
    const response = await executeCustomerFeedbackRequest({
      marketplaceId: input.marketplaceId,
      asin: input.candidate.asin,
      expectedMode: input.expectedMode,
    });
    const requestId = response.headers.get("x-amzn-requestid");
    if (response.status === 204) {
      return {
        candidate: input.candidate,
        response: null,
        noContent: true,
        requestId,
      };
    }
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "Amazon 拒絕評論主題查詢；請確認 App 至少已取得 Selling Partner Insights 或 Brand Analytics 其一角色並重新授權。"
        : response.status === 404
          ? "Amazon 沒有找到此非 parent ASIN 的 Customer Feedback 資源；未改用父變體資料。"
          : response.status === 429
            ? "Amazon Customer Feedback API 正在限流；請稍後繼續這個快照。"
            : "Amazon Customer Feedback API 未完成此非 parent ASIN 查詢。";
      return {
        candidate: input.candidate,
        response: null,
        requestId,
        error: {
          code: response.status === 401 || response.status === 403
            ? "UNAUTHORIZED"
            : response.status === 429
              ? "RATE_LIMITED"
              : "QUERY_FAILED",
          message,
          requestId,
        },
      };
    }
    const payload = await parseResponseJson<unknown>(response);
    return payload === null
      ? {
          candidate: input.candidate,
          response: null,
          requestId,
          error: {
            code: "RESPONSE_INVALID",
            message: "Amazon Customer Feedback API 回應不是可驗證的 JSON。",
            requestId,
          },
        }
      : { candidate: input.candidate, response: payload, requestId };
  } catch (error) {
    if (error instanceof SpApiError && error.code === "REPORT_MODE_CHANGED") {
      throw error;
    }
    return {
      candidate: input.candidate,
      response: null,
      error: {
        code: error instanceof SpApiError ? error.code : "UPSTREAM_UNAVAILABLE",
        message: error instanceof SpApiError
          ? error.message
          : "Amazon Customer Feedback API 查詢失敗。",
        requestId: error instanceof SpApiError ? error.requestId : null,
      },
    };
  }
}

const AGED_INVENTORY_REPORT_TYPE = "GET_FBA_INVENTORY_PLANNING_DATA";

export async function startAgedInventoryReport(input: {
  marketplaceId: MarketplaceId;
}): Promise<ListingReportStatus> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    return {
      mode: "demo",
      ready: true,
      reportId: `demo-aged-${input.marketplaceId}`,
      documentId: `demo-aged-${input.marketplaceId}`,
      status: "DONE",
      notice: "展示用 FBA 庫齡報表已準備完成。",
    };
  }
  const response = await executeReportsRequest({
    marketplaceId: input.marketplaceId,
    path: "/reports",
    method: "POST",
    body: {
      reportType: AGED_INVENTORY_REPORT_TYPE,
      marketplaceIds: [input.marketplaceId],
    },
  });
  if (!response.ok) return throwReportsError(response, "aged-inventory");
  const payload = await parseResponseJson<AmazonReport>(response);
  if (!payload?.reportId) {
    throw new SpApiError("Amazon 沒有回傳有效的 FBA 庫齡報表編號。", {
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
    notice: "Amazon 正在準備 FBA 庫齡資料；完成後會自動顯示。",
  };
}

export async function getAgedInventoryReportStatus(input: {
  marketplaceId: MarketplaceId;
  reportId: string;
}): Promise<ListingReportStatus> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const expected = `demo-aged-${input.marketplaceId}`;
    if (input.reportId !== expected) {
      throw new SpApiError("這份展示報表不屬於目前選擇的站點。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    return {
      mode: "demo",
      ready: true,
      reportId: input.reportId,
      documentId: expected,
      status: "DONE",
      notice: "展示用 FBA 庫齡報表已準備完成。",
    };
  }
  const response = await executeReportsRequest({
    marketplaceId: input.marketplaceId,
    path: `/reports/${encodeURIComponent(input.reportId)}`,
  });
  if (!response.ok) return throwReportsError(response, "aged-inventory");
  const payload = await parseResponseJson<AmazonReport>(response);
  if (
    payload?.reportType !== AGED_INVENTORY_REPORT_TYPE ||
    !Array.isArray(payload.marketplaceIds) ||
    payload.marketplaceIds.length !== 1 ||
    payload.marketplaceIds[0] !== input.marketplaceId
  ) {
    throw new SpApiError(
      "這份 Amazon 報表不屬於目前站點或不是 FBA 庫齡報表，已停止讀取。",
      {
        status: 409,
        code: "REPORT_MISMATCH",
        requestId: response.headers.get("x-amzn-requestid"),
      },
    );
  }
  const status = payload.processingStatus;
  if (!status) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 庫齡報表狀態。", {
      status: 502,
      code: "REPORT_FAILED",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  if (status === "CANCELLED" || status === "FATAL") {
    throw new SpApiError("Amazon 未能產生 FBA 庫齡報表，請重新同步。", {
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
      ? "Amazon FBA 庫齡資料已就緒，正在整理 180 天以上庫存。"
      : "Amazon 正在準備 FBA 庫齡資料；完成後會自動顯示。",
  };
}

const FBA_SHIPMENT_SALES_REPORT_TYPE =
  "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA";

function demoBrandSalesReference(input: {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
}): string {
  return `demo-brand-${input.marketplaceId}-${input.startDate}-${input.endDate}`;
}

function exactBrandSalesWindow(input: {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  now?: Date;
}): SalesTrendWindow {
  return buildCustomSalesTrendWindow(
    input.marketplaceId,
    input.startDate,
    input.endDate,
    input.now,
  );
}

export function getBrandSalesReportWindow(input: {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  now?: Date;
}): { dataStartTime: string; dataEndTime: string } {
  const window = exactBrandSalesWindow(input);
  return {
    dataStartTime: window.startAt,
    dataEndTime: window.endAt,
  };
}

function parseFixedBrandSalesTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.exec(
    value,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() + 1 !== month ||
    calendarDate.getUTCDate() !== day ||
    (match[4] !== "Z" && match[4].slice(1, 3) === "14" && match[4].slice(4) !== "00")
  ) {
    return null;
  }
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function validateFixedBrandSalesWindow(input: {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  dataStartTime: string;
  dataEndTime: string;
  windowCreatedAt: number;
}): { startTime: number; endTime: number } {
  const startTime = parseFixedBrandSalesTime(input.dataStartTime);
  const endTime = parseFixedBrandSalesTime(input.dataEndTime);
  if (
    startTime === null ||
    endTime === null ||
    !Number.isSafeInteger(input.windowCreatedAt) ||
    input.windowCreatedAt < 0 ||
    input.windowCreatedAt > Date.now() + 1_000
  ) {
    throw new SpApiError("FBA 品牌出貨報表的固定查詢時間無效。", {
      status: 400,
      code: "INVALID_DATE_RANGE",
    });
  }
  const createdAt = new Date(input.windowCreatedAt);
  resolveSalesTrendRange(
    {
      marketplaceId: input.marketplaceId,
      startDate: input.startDate,
      endDate: input.endDate,
    },
    createdAt,
  );
  const timeZone = MARKETPLACES[input.marketplaceId].timeZone;
  const createdParts = zonedDateParts(createdAt, timeZone);
  const createdDate = dateKey(createdParts.year, createdParts.month, createdParts.day);
  const expectedStart = zonedMidnight(input.startDate, timeZone).getTime();
  const expectedEnd = input.endDate === createdDate
    ? Math.floor(input.windowCreatedAt / 1_000) * 1_000
    : zonedMidnight(shiftDateKey(input.endDate, 1), timeZone).getTime();
  if (
    startTime !== expectedStart ||
    endTime !== expectedEnd ||
    endTime <= startTime
  ) {
    throw new SpApiError("FBA 品牌出貨報表的固定查詢時間無效。", {
      status: 400,
      code: "INVALID_DATE_RANGE",
    });
  }
  return { startTime, endTime };
}

export async function startFbaShipmentSalesReport(input: {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  dataStartTime: string;
  dataEndTime: string;
  windowCreatedAt: number;
}): Promise<BrandSalesReportStatus> {
  validateFixedBrandSalesWindow(input);
  if (shouldUseDemoMode(input.marketplaceId)) {
    const reference = demoBrandSalesReference(input);
    return {
      mode: "demo",
      ready: true,
      reportId: reference,
      documentId: reference,
      status: "DONE",
      dataStartTime: input.dataStartTime,
      dataEndTime: input.dataEndTime,
      notice: "展示用 FBA 品牌出貨報表已準備完成。",
    };
  }
  const response = await executeReportsRequest({
    marketplaceId: input.marketplaceId,
    path: "/reports",
    method: "POST",
    body: {
      reportType: FBA_SHIPMENT_SALES_REPORT_TYPE,
      marketplaceIds: [input.marketplaceId],
      dataStartTime: input.dataStartTime,
      dataEndTime: input.dataEndTime,
    },
  });
  if (!response.ok) return throwReportsError(response, "brand-sales");
  const payload = await parseResponseJson<AmazonReport>(response);
  if (!payload?.reportId) {
    throw new SpApiError("Amazon 沒有回傳有效的 FBA 品牌出貨報表編號。", {
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
    dataStartTime: input.dataStartTime,
    dataEndTime: input.dataEndTime,
    notice: "Amazon 正在準備 FBA 已出貨商品資料。",
  };
}

export async function getFbaShipmentSalesReportStatus(input: {
  marketplaceId: MarketplaceId;
  reportId: string;
  startDate: string;
  endDate: string;
  dataStartTime: string;
  dataEndTime: string;
  windowCreatedAt: number;
}): Promise<BrandSalesReportStatus> {
  const {
    startTime: expectedStartTime,
    endTime: expectedEndTime,
  } = validateFixedBrandSalesWindow(input);
  if (shouldUseDemoMode(input.marketplaceId)) {
    const expected = demoBrandSalesReference(input);
    if (input.reportId !== expected) {
      throw new SpApiError("展示 FBA 品牌出貨報表與目前站點或日期不一致。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    return {
      mode: "demo",
      ready: true,
      reportId: expected,
      documentId: expected,
      status: "DONE",
      dataStartTime: input.dataStartTime,
      dataEndTime: input.dataEndTime,
      notice: "展示用 FBA 品牌出貨報表已準備完成。",
    };
  }
  const response = await executeReportsRequest({
    marketplaceId: input.marketplaceId,
    path: `/reports/${encodeURIComponent(input.reportId)}`,
  });
  if (!response.ok) return throwReportsError(response, "brand-sales");
  const payload = await parseResponseJson<AmazonReport>(response);
  const startTime = parseFixedBrandSalesTime(payload?.dataStartTime ?? "");
  const endTime = parseFixedBrandSalesTime(payload?.dataEndTime ?? "");
  if (
    payload?.reportType !== FBA_SHIPMENT_SALES_REPORT_TYPE ||
    !Array.isArray(payload.marketplaceIds) ||
    payload.marketplaceIds.length !== 1 ||
    payload.marketplaceIds[0] !== input.marketplaceId ||
    startTime === null ||
    endTime === null ||
    startTime !== expectedStartTime ||
    endTime !== expectedEndTime
  ) {
    throw new SpApiError(
      "這份 Amazon 報表不屬於目前站點、日期或 FBA 出貨銷售類型。",
      {
        status: 409,
        code: "REPORT_MISMATCH",
        requestId: response.headers.get("x-amzn-requestid"),
      },
    );
  }
  const status = payload.processingStatus;
  if (!status) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 品牌出貨報表狀態。", {
      status: 502,
      code: "REPORT_FAILED",
      requestId: response.headers.get("x-amzn-requestid"),
    });
  }
  if (status === "CANCELLED") {
    throw new SpApiError(
      "Amazon 已取消 FBA 品牌出貨報表；近即時區間可能仍在約 30 分鐘的報表產生間隔內，或該區間沒有資料。請稍後再按一次同步，只建立一次新報表；系統不會自動重送建立請求。",
      {
        status: 422,
        code: "REPORT_CANCELLED",
        requestId: response.headers.get("x-amzn-requestid"),
      },
    );
  }
  if (status === "FATAL") {
    throw new SpApiError("Amazon 處理 FBA 品牌出貨報表失敗；請稍後重新同步。", {
      status: 422,
      code: "REPORT_FATAL",
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
    dataStartTime: input.dataStartTime,
    dataEndTime: input.dataEndTime,
    notice: ready
      ? "Amazon FBA 已出貨商品資料已就緒。"
      : "Amazon 正在準備 FBA 已出貨商品資料。",
  };
}

function shipmentDateKey(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const instant = new Date(value);
  const local = zonedDateParts(instant, timeZone);
  return dateKey(local.year, local.month, local.day);
}

export async function getBrandSalesData(input: {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  listingReportId: string;
  listingDocumentId: string;
  shipmentReportId: string;
  shipmentDocumentId: string;
  shipmentDataStartTime: string;
  shipmentDataEndTime: string;
  windowCreatedAt: number;
}): Promise<BrandSalesSnapshot> {
  validateFixedBrandSalesWindow({
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
    dataStartTime: input.shipmentDataStartTime,
    dataEndTime: input.shipmentDataEndTime,
    windowCreatedAt: input.windowCreatedAt,
  });
  if (shouldUseDemoMode(input.marketplaceId)) {
    const listingReference = `demo-${input.marketplaceId}`;
    const shipmentReference = demoBrandSalesReference(input);
    if (
      input.listingReportId !== listingReference ||
      input.listingDocumentId !== listingReference ||
      input.shipmentReportId !== shipmentReference ||
      input.shipmentDocumentId !== shipmentReference
    ) {
      throw new SpApiError("展示品牌營收報表與目前站點或日期不一致。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    const listingData = await getAllListingsExportData({
      marketplaceId: input.marketplaceId,
      reportId: listingReference,
      documentId: listingReference,
    });
    const listings = listingData.rows.map((row) => ({
      sellerSku: row.sellerSku,
      title: row.title,
    }));
    const currencyCode = MARKETPLACES[input.marketplaceId].currency;
    const sales = listings.map((listing, index) => ({
      shipmentDate: `${input.startDate}T12:00:00.000Z`,
      sellerSku: listing.sellerSku,
      quantity: index + 1,
      unitPrice: currencyCode === "JPY" ? 1_280 + index * 300 : 12.99 + index * 2.5,
      currencyCode,
    }));
    return buildBrandSalesSnapshot({
      mode: "demo",
      marketplaceId: input.marketplaceId,
      startDate: input.startDate,
      endDate: input.endDate,
      currencyCode,
      listings,
      sales,
    });
  }

  const [listingStatus, shipmentStatus] = await Promise.all([
    getAllListingsReportStatus({
      marketplaceId: input.marketplaceId,
      reportId: input.listingReportId,
    }),
    getFbaShipmentSalesReportStatus({
      marketplaceId: input.marketplaceId,
      reportId: input.shipmentReportId,
      startDate: input.startDate,
      endDate: input.endDate,
      dataStartTime: input.shipmentDataStartTime,
      dataEndTime: input.shipmentDataEndTime,
      windowCreatedAt: input.windowCreatedAt,
    }),
  ]);
  if (
    !listingStatus.ready ||
    listingStatus.documentId !== input.listingDocumentId ||
    !shipmentStatus.ready ||
    shipmentStatus.documentId !== input.shipmentDocumentId
  ) {
    throw new SpApiError("品牌營收報表尚未完成，或文件資訊已失效。", {
      status: 409,
      code: "REPORT_NOT_READY",
    });
  }
  const [listingReport, shipmentReport] = await Promise.all([
    downloadReportDocument(input.marketplaceId, input.listingDocumentId),
    downloadReportDocument(input.marketplaceId, input.shipmentDocumentId),
  ]);
  const listings = parseCurrentFbaListingTitles(listingReport);
  const timeZone = MARKETPLACES[input.marketplaceId].timeZone;
  const sales = parseFbaShipmentSalesReport(shipmentReport).filter((sale) => {
    const key = shipmentDateKey(sale.shipmentDate, timeZone);
    return key >= input.startDate && key <= input.endDate;
  });
  return buildBrandSalesSnapshot({
    mode: "live",
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
    currencyCode: MARKETPLACES[input.marketplaceId].currency,
    listings,
    sales,
  });
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

function reportIntegerCell(
  row: string[],
  index: number,
  label: string,
): number | null {
  if (index < 0) return null;
  const raw = row[index]?.trim() ?? "";
  if (!raw) return null;
  const normalized = raw.replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」不是有效數量。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」超出安全範圍。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

function requiredReportIntegerCell(
  row: string[],
  index: number,
  label: string,
): number {
  const value = reportIntegerCell(row, index, label);
  if (value === null) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」缺值。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

function reportDecimalCell(
  row: string[],
  index: number,
  label: string,
): number | null {
  if (index < 0) return null;
  const raw = row[index]?.trim() ?? "";
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」不是有效數字。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

type ParsedAgedInventoryReport = {
  rows: AgedInventoryRow[];
  ageBucketKeys: string[];
  agedSurchargeBucketKeys: string[];
  excessAvailability: AgedInventoryFeeAvailability;
  storageCostAvailability: AgedInventoryFeeAvailability;
  agedSurchargeAvailability: AgedInventoryFeeAvailability;
  currencyCode: string | null;
};

const REGIONAL_AGED_INVENTORY_MARKETPLACES = new Set<MarketplaceId>([
  "ATVPDKIKX0DER", // US
  "A1F83G8C2ARO7P", // UK
  "A1PA6795UKMFR9", // DE
]);

function validateAgedInventoryRegionSchema(
  parsed: ParsedAgedInventoryReport,
  marketplaceId: MarketplaceId,
): void {
  const expectsRegionalTail =
    REGIONAL_AGED_INVENTORY_MARKETPLACES.has(marketplaceId);
  const ageKeys = new Set(parsed.ageBucketKeys);
  const ageHasRegionalTail =
    ageKeys.has("366-455") && ageKeys.has("456-plus");
  const ageHasGlobalTail = ageKeys.has("365-plus");
  const surchargeKeys = new Set(parsed.agedSurchargeBucketKeys);
  const surchargeHasRegionalTail =
    surchargeKeys.has("366-455") && surchargeKeys.has("456-plus");
  const surchargeHasGlobalTail = surchargeKeys.has("365-plus");
  if (
    (expectsRegionalTail && (!ageHasRegionalTail || ageHasGlobalTail)) ||
    (!expectsRegionalTail && (!ageHasGlobalTail || ageHasRegionalTail)) ||
    (surchargeKeys.size > 0 &&
      ((expectsRegionalTail &&
        (!surchargeHasRegionalTail || surchargeHasGlobalTail)) ||
        (!expectsRegionalTail &&
          (!surchargeHasGlobalTail || surchargeHasRegionalTail))))
  ) {
    throw new SpApiError(
      "Amazon FBA 庫齡報表的區域庫齡欄位與目前站點不一致，已停止顯示。",
      { status: 409, code: "REPORT_MISMATCH" },
    );
  }
}

type ReportAgeColumn = {
  key: string;
  header: string;
  label: string;
  over180: boolean;
  index: number;
};

type ReportSurchargeColumn = {
  key: string;
  label: string;
  quantityIndex: number;
  estimatedIndex: number;
};

function feeAvailability(
  columnSetPresent: boolean,
  values: Array<number | null>,
): AgedInventoryFeeAvailability {
  if (!columnSetPresent) return "unavailable";
  return values.every((value) => value !== null) ? "complete" : "partial";
}

function reportCurrencyCell(row: string[], index: number): string | null {
  if (index < 0) return null;
  const value = row[index]?.trim().toUpperCase() ?? "";
  if (!value) return null;
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new SpApiError("Amazon FBA 庫齡報表的幣別格式無效。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

export function parseAgedInventoryReportData(
  text: string,
  marketplaceId?: MarketplaceId,
): ParsedAgedInventoryReport {
  const rows = parseTsv(text);
  const headers = rows[0] ?? [];
  const skuIndex = reportColumn(headers, ["sku", "seller-sku", "merchant-sku"]);
  if (skuIndex < 0) {
    throw new SpApiError("Amazon FBA 庫齡報表找不到 Seller SKU 欄位。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }

  const ageColumns = (
    definitions: Array<Omit<ReportAgeColumn, "index">>,
  ): ReportAgeColumn[] =>
    definitions.map((item) => ({
      ...item,
      index: reportColumn(headers, [item.header]),
    }));
  const recentDetailedAgeColumns = ageColumns([
    { key: "0-30", header: "inv-age-0-to-30-days", label: "0–30 天", over180: false },
    { key: "31-60", header: "inv-age-31-to-60-days", label: "31–60 天", over180: false },
    { key: "61-90", header: "inv-age-61-to-90-days", label: "61–90 天", over180: false },
  ]);
  const recentAggregateAgeColumn = ageColumns([
    { key: "0-90", header: "inv-age-0-to-90-days", label: "0–90 天", over180: false },
  ])[0];
  const midAgeColumn = ageColumns([
    { key: "91-180", header: "inv-age-91-to-180-days", label: "91–180 天", over180: false },
  ])[0];
  const standardBaseAgeColumns = ageColumns([
    { key: "181-270", header: "inv-age-181-to-270-days", label: "181–270 天", over180: true },
    { key: "271-365", header: "inv-age-271-to-365-days", label: "271–365 天", over180: true },
  ]);
  const alternateBaseAgeColumns = ageColumns([
    { key: "181-330", header: "inv-age-181-to-330-days", label: "181–330 天", over180: true },
    { key: "331-365", header: "inv-age-331-to-365-days", label: "331–365 天", over180: true },
  ]);
  const regionalTailAgeColumns = ageColumns([
    { key: "366-455", header: "inv-age-366-to-455-days", label: "366–455 天", over180: true },
    { key: "456-plus", header: "inv-age-456-plus-days", label: "456 天以上", over180: true },
  ]);
  const globalTailAgeColumn = ageColumns([
    { key: "365-plus", header: "inv-age-365-plus-days", label: "365 天以上（Amazon 欄位）", over180: true },
  ])[0];
  const hasRecentDetailed = recentDetailedAgeColumns.every(
    (item) => item.index >= 0,
  );
  const selectedRecentAgeColumns = hasRecentDetailed
    ? recentDetailedAgeColumns
    : recentAggregateAgeColumn.index >= 0
      ? [recentAggregateAgeColumn]
      : [];
  const hasStandardBase = standardBaseAgeColumns.every(
    (item) => item.index >= 0,
  );
  const hasAlternateBase =
    alternateBaseAgeColumns.every((item) => item.index >= 0);
  const hasRegionalTail = regionalTailAgeColumns.every(
    (item) => item.index >= 0,
  );
  const hasGlobalTail = globalTailAgeColumn.index >= 0;
  // Amazon publishes overlapping aggregate and detailed bucket generations.
  // Select one complete, non-overlapping route through the headers so the same
  // units can never be counted twice. Regional 366+/456+ fields win when both
  // regional and 365+ tails appear.
  const selectedBaseAgeColumns = hasStandardBase
    ? standardBaseAgeColumns
    : hasAlternateBase
      ? alternateBaseAgeColumns
      : [];
  const selectedTailAgeColumns = hasRegionalTail
    ? regionalTailAgeColumns
    : hasGlobalTail
      ? [globalTailAgeColumn]
      : [];
  if (
    !selectedRecentAgeColumns.length ||
    midAgeColumn.index < 0 ||
    !selectedBaseAgeColumns.length ||
    !selectedTailAgeColumns.length
  ) {
    throw new SpApiError(
      "Amazon FBA 庫齡報表缺少完整且不重疊的庫齡區間，已停止顯示。",
      { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
    );
  }
  const selectedAgeColumns = [
    ...selectedRecentAgeColumns,
    midAgeColumn,
    ...selectedBaseAgeColumns,
    ...selectedTailAgeColumns,
  ];

  const surchargeColumns = (
    definitions: Array<{ key: string; label: string }>,
  ): ReportSurchargeColumn[] =>
    definitions.map((item) => ({
      ...item,
      quantityIndex: reportColumn(headers, [
        `quantity-to-be-charged-ais-${item.key}-days`,
      ]),
      estimatedIndex: reportColumn(headers, [
        `estimated-ais-${item.key}-days`,
      ]),
    }));
  const commonSurchargeColumns = surchargeColumns([
    { key: "181-210", label: "AIS 181–210 天" },
    { key: "211-240", label: "AIS 211–240 天" },
    { key: "241-270", label: "AIS 241–270 天" },
    { key: "271-300", label: "AIS 271–300 天" },
    { key: "301-330", label: "AIS 301–330 天" },
    { key: "331-365", label: "AIS 331–365 天" },
  ]);
  const regionalSurchargeTail = surchargeColumns([
    { key: "366-455", label: "AIS 366–455 天" },
    { key: "456-plus", label: "AIS 456 天以上" },
  ]);
  const globalSurchargeTail = surchargeColumns([
    { key: "365-plus", label: "AIS 365 天以上（Amazon 欄位）" },
  ]);
  const everySurchargeColumnPresent = (items: ReportSurchargeColumn[]) =>
    items.every((item) => item.quantityIndex >= 0 && item.estimatedIndex >= 0);
  const allSurchargeCandidates = [
    ...commonSurchargeColumns,
    ...regionalSurchargeTail,
    ...globalSurchargeTail,
  ];
  const anySurchargeColumnPresent = allSurchargeCandidates.some(
    (item) => item.quantityIndex >= 0 || item.estimatedIndex >= 0,
  );
  const selectedSurchargeTail = everySurchargeColumnPresent(regionalSurchargeTail)
    ? regionalSurchargeTail
    : everySurchargeColumnPresent(globalSurchargeTail)
      ? globalSurchargeTail
      : [];
  const selectedSurchargeColumns = anySurchargeColumnPresent &&
    everySurchargeColumnPresent(commonSurchargeColumns) &&
    selectedSurchargeTail.length
    ? [...commonSurchargeColumns, ...selectedSurchargeTail]
    : [];
  if (anySurchargeColumnPresent && !selectedSurchargeColumns.length) {
    throw new SpApiError(
      "Amazon FBA 庫齡報表的 AIS 預估附加費欄位不完整，已停止加總。",
      { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
    );
  }

  const fnSkuIndex = reportColumn(headers, ["fnsku", "fulfillment-channel-sku"]);
  const asinIndex = reportColumn(headers, ["asin"]);
  const titleIndex = reportColumn(headers, ["product-name", "item-name", "title"]);
  const conditionIndex = reportColumn(headers, ["condition"]);
  const availableIndex = reportColumn(headers, ["available"]);
  const excessIndex = reportColumn(headers, ["estimated-excess-quantity"]);
  const removalIndex = reportColumn(headers, ["recommended-removal-quantity"]);
  const daysOfSupplyIndex = reportColumn(headers, [
    "days-of-supply",
    "total-days-of-supply-(including-units-from-open-shipments)",
  ]);
  const currencyIndex = reportColumn(headers, ["currency", "currency-code"]);
  const storageCostIndex = reportColumn(headers, [
    "estimated-storage-cost-next-month",
  ]);
  const storageVolumeIndex = reportColumn(headers, ["storage-volume"]);
  const alertIndex = reportColumn(headers, ["alert"]);
  const recommendedActionIndex = reportColumn(headers, ["recommended-action"]);
  const snapshotDateIndex = reportColumn(headers, [
    "inventory-age-snapshot-date",
    "snapshot-date",
  ]);

  const result: AgedInventoryRow[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const sellerSku = row[skuIndex] ?? "";
    if (
      !sellerSku ||
      sellerSku.length > 40 ||
      sellerSku !== sellerSku.trim() ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
        sellerSku,
      )
    ) {
      throw new SpApiError(
        "Amazon FBA 庫齡報表有商品列缺少或無法原樣辨識 Seller SKU。",
        {
        status: 502,
        code: "REPORT_FORMAT_UNSUPPORTED",
        },
      );
    }
    if (seen.has(sellerSku)) {
      throw new SpApiError("Amazon FBA 庫齡報表含有重複 Seller SKU，已停止顯示。", {
        status: 502,
        code: "REPORT_FORMAT_UNSUPPORTED",
      });
    }
    const ageBuckets = selectedAgeColumns
      .map((item) => ({
        key: item.key,
        label: item.label,
        units: requiredReportIntegerCell(row, item.index, item.label),
        over180: item.over180,
      }));
    const totalAgedUnits = ageBuckets.reduce((sum, item) => sum + item.units, 0);
    const agedOver180 = ageBuckets
      .filter((item) => item.over180)
      .reduce((sum, item) => sum + item.units, 0);
    const currencyCode = reportCurrencyCell(row, currencyIndex);
    const storageVolume = reportDecimalCell(
      row,
      storageVolumeIndex,
      "Amazon storage volume",
    );
    const reportedStorageCostNextMonth = reportDecimalCell(
      row,
      storageCostIndex,
      "下月預估倉儲成本",
    );
    // The report documents both the charge basis and estimate as optional per
    // row. A blank estimate is safely zero only when Amazon explicitly reports
    // a zero basis; a positive or missing basis remains unknown and partial.
    const estimatedStorageCostNextMonth =
      reportedStorageCostNextMonth ?? (storageVolume === 0 ? 0 : null);
    const agedSurchargeBuckets = selectedSurchargeColumns.map((item) => {
      const quantity = reportIntegerCell(
        row,
        item.quantityIndex,
        `${item.label}計費數量`,
      );
      const reportedCharge = reportDecimalCell(
        row,
        item.estimatedIndex,
        `${item.label}預估附加費`,
      );
      return {
        key: item.key,
        label: item.label,
        quantity,
        estimatedCharge: reportedCharge ?? (quantity === 0 ? 0 : null),
      };
    });
    const estimatedAgedSurcharge = agedSurchargeBuckets.length > 0 &&
      agedSurchargeBuckets.every(
        (item) => item.quantity !== null && item.estimatedCharge !== null,
      )
      ? Number(
          agedSurchargeBuckets
            .reduce((sum, item) => sum + item.estimatedCharge!, 0)
            .toFixed(2),
        )
      : null;
    if (
      ((estimatedStorageCostNextMonth ?? 0) > 0 ||
        agedSurchargeBuckets.some((item) => (item.estimatedCharge ?? 0) > 0)) &&
      !currencyCode
    ) {
      throw new SpApiError("Amazon FBA 庫齡報表有費用但缺少幣別，已停止加總。", {
        status: 502,
        code: "REPORT_FORMAT_UNSUPPORTED",
      });
    }
    seen.add(sellerSku);
    result.push({
      sellerSku,
      fnSku: fnSkuIndex >= 0 ? row[fnSkuIndex]?.trim() ?? "" : "",
      asin: asinIndex >= 0 ? row[asinIndex]?.trim() ?? "" : "",
      title: titleIndex >= 0 ? row[titleIndex]?.trim() ?? "" : "",
      condition: conditionIndex >= 0 ? row[conditionIndex]?.trim() ?? "" : "",
      available: reportIntegerCell(row, availableIndex, "可售庫存"),
      totalAgedUnits,
      agedOver180,
      ageBuckets,
      estimatedExcessQuantity: reportIntegerCell(
        row,
        excessIndex,
        "Amazon 預估冗餘",
      ),
      recommendedRemovalQuantity: reportIntegerCell(
        row,
        removalIndex,
        "建議移除數量",
      ),
      daysOfSupply: reportDecimalCell(row, daysOfSupplyIndex, "可售天數"),
      currencyCode,
      estimatedStorageCostNextMonth,
      estimatedAgedSurcharge,
      agedSurchargeBuckets,
      alert: alertIndex >= 0 ? row[alertIndex]?.trim() ?? "" : "",
      recommendedAction:
        recommendedActionIndex >= 0
          ? row[recommendedActionIndex]?.trim() ?? ""
          : "",
      snapshotDate:
        snapshotDateIndex >= 0
          ? row[snapshotDateIndex]?.trim() || null
          : null,
    });
  }
  result.sort((left, right) => {
    const excessDifference =
      (right.estimatedExcessQuantity ?? -1) -
      (left.estimatedExcessQuantity ?? -1);
    return (
      excessDifference ||
      right.agedOver180 - left.agedOver180 ||
      left.sellerSku.localeCompare(right.sellerSku)
    );
  });
  const currencyCodes = new Set(
    result
      .map((row) => row.currencyCode)
      .filter((value): value is string => value !== null),
  );
  if (currencyCodes.size > 1) {
    throw new SpApiError("同一站點的 FBA 庫齡報表包含多種幣別，已停止加總。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  const parsed = {
    rows: result,
    ageBucketKeys: selectedAgeColumns.map((item) => item.key),
    agedSurchargeBucketKeys: selectedSurchargeColumns.map((item) => item.key),
    excessAvailability: feeAvailability(
      excessIndex >= 0,
      result.map((row) => row.estimatedExcessQuantity),
    ),
    storageCostAvailability: feeAvailability(
      storageCostIndex >= 0,
      result.map((row) => row.estimatedStorageCostNextMonth),
    ),
    agedSurchargeAvailability: feeAvailability(
      selectedSurchargeColumns.length > 0,
      result.map((row) => row.estimatedAgedSurcharge),
    ),
    currencyCode: [...currencyCodes][0] ?? null,
  };
  if (marketplaceId) validateAgedInventoryRegionSchema(parsed, marketplaceId);
  return parsed;
}

export function parseAgedInventoryReportDocument(
  text: string,
  marketplaceId?: MarketplaceId,
): AgedInventoryRow[] {
  return parseAgedInventoryReportData(text, marketplaceId).rows;
}

function demoAgedInventorySnapshot(
  marketplaceId: MarketplaceId,
): AgedInventorySnapshot {
  const ageBuckets: AgedInventoryBucket[] =
    REGIONAL_AGED_INVENTORY_MARKETPLACES.has(marketplaceId)
      ? [
          { key: "0-30", label: "0–30 天", units: 80, over180: false },
          { key: "31-60", label: "31–60 天", units: 30, over180: false },
          { key: "61-90", label: "61–90 天", units: 22, over180: false },
          { key: "91-180", label: "91–180 天", units: 0, over180: false },
          { key: "181-270", label: "181–270 天", units: 60, over180: true },
          { key: "271-365", label: "271–365 天", units: 36, over180: true },
          { key: "366-455", label: "366–455 天", units: 12, over180: true },
          { key: "456-plus", label: "456 天以上", units: 0, over180: true },
        ]
      : [
          { key: "0-90", label: "0–90 天", units: 132, over180: false },
          { key: "91-180", label: "91–180 天", units: 0, over180: false },
          { key: "181-270", label: "181–270 天", units: 60, over180: true },
          { key: "271-365", label: "271–365 天", units: 36, over180: true },
          {
            key: "365-plus",
            label: "365 天以上（Amazon 欄位）",
            units: 12,
            over180: true,
          },
        ];
  const rows: AgedInventoryRow[] = [
    {
      sellerSku: "DEMO-FBA-AGED-01",
      fnSku: "DEMO-FNSKU-AGED-01",
      asin: "B0DEMOAGED1",
      title: "展示用 FBA 庫齡商品",
      condition: "New",
      available: 240,
      totalAgedUnits: 240,
      agedOver180: 108,
      ageBuckets,
      estimatedExcessQuantity: 82,
      recommendedRemovalQuantity: 18,
      daysOfSupply: 216,
      currencyCode: null,
      estimatedStorageCostNextMonth: null,
      estimatedAgedSurcharge: null,
      agedSurchargeBuckets: [],
      alert: "",
      recommendedAction: "Create sale",
      snapshotDate: new Date().toISOString().slice(0, 10),
    },
  ];
  return {
    mode: "demo",
    marketplaceId,
    fetchedAt: new Date().toISOString(),
    rows,
    summary: {
      skuCount: rows.length,
      agedOver180SkuCount: rows.filter((row) => row.agedOver180 > 0).length,
      totalAgedUnits: rows.reduce((sum, row) => sum + row.totalAgedUnits, 0),
      agedOver180: rows.reduce((sum, row) => sum + row.agedOver180, 0),
      excessAvailability: "complete",
      estimatedExcessQuantity: rows.reduce(
        (sum, row) => sum + (row.estimatedExcessQuantity ?? 0),
        0,
      ),
      excessReportedSkuCount: rows.length,
      currencyCode: null,
      storageCostAvailability: "unavailable",
      estimatedStorageCostNextMonth: null,
      storageCostReportedSkuCount: 0,
      agedSurchargeAvailability: "unavailable",
      estimatedAgedSurcharge: null,
      agedSurchargeReportedSkuCount: 0,
    },
    expiration: agedInventoryExpirationBoundary(),
    notice:
      "展示資料只供版面測試。費用欄位刻意留空；庫齡與 Amazon 預估冗餘是不同指標，不會自動建立促銷或移除訂單。",
  };
}

function agedInventoryExpirationBoundary(): AgedInventorySnapshot["expiration"] {
  return {
    currentFbaExpirationDatesAvailable: false,
    nearExpiryUnits: null,
    expiredUnits: null,
    inboundPlanExpirationDatesAvailable: true,
    notice:
      "Amazon 公開的 FBA Inventory 與 Manage Inventory Health report 不提供目前 FC 庫存的逐 SKU／批次到期日、近效期或已過期數量。Fulfillment Inbound API 只會回傳入庫計畫中填寫的日期，收貨後無法證明目前剩餘批次，因此本頁不把庫齡或 Amazon alert 當成到期資料。",
  };
}

export async function getAgedInventoryData(input: {
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
}): Promise<AgedInventorySnapshot> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const expected = `demo-aged-${input.marketplaceId}`;
    if (input.reportId !== expected || input.documentId !== expected) {
      throw new SpApiError("展示 FBA 庫齡報表資訊不相符。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    return demoAgedInventorySnapshot(input.marketplaceId);
  }
  const status = await getAgedInventoryReportStatus({
    marketplaceId: input.marketplaceId,
    reportId: input.reportId,
  });
  if (!status.ready || status.documentId !== input.documentId) {
    throw new SpApiError("FBA 庫齡報表尚未完成，或文件資訊已失效。", {
      status: 409,
      code: "REPORT_NOT_READY",
    });
  }
  const document = await downloadReportDocument(
    input.marketplaceId,
    input.documentId,
  );
  const parsed = parseAgedInventoryReportData(document, input.marketplaceId);
  const rows = parsed.rows;
  if (
    parsed.currencyCode &&
    parsed.currencyCode !== MARKETPLACES[input.marketplaceId].currency
  ) {
    throw new SpApiError("FBA 庫齡報表幣別與目前站點不一致，已停止加總。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    fetchedAt: new Date().toISOString(),
    rows,
    summary: {
      skuCount: rows.length,
      agedOver180SkuCount: rows.filter((row) => row.agedOver180 > 0).length,
      totalAgedUnits: rows.reduce((sum, row) => sum + row.totalAgedUnits, 0),
      agedOver180: rows.reduce((sum, row) => sum + row.agedOver180, 0),
      excessAvailability: parsed.excessAvailability,
      estimatedExcessQuantity: parsed.excessAvailability === "unavailable"
        ? null
        : rows.some((row) => row.estimatedExcessQuantity !== null)
          ? rows.reduce(
              (sum, row) => sum + (row.estimatedExcessQuantity ?? 0),
              0,
            )
          : null,
      excessReportedSkuCount: rows.filter(
        (row) => row.estimatedExcessQuantity !== null,
      ).length,
      currencyCode: parsed.currencyCode,
      storageCostAvailability: parsed.storageCostAvailability,
      estimatedStorageCostNextMonth: parsed.storageCostAvailability === "unavailable"
        ? null
        : rows.some((row) => row.estimatedStorageCostNextMonth !== null)
          ? Number(
              rows
                .reduce(
                  (sum, row) => sum + (row.estimatedStorageCostNextMonth ?? 0),
                  0,
                )
                .toFixed(2),
            )
          : null,
      storageCostReportedSkuCount: rows.filter(
        (row) => row.estimatedStorageCostNextMonth !== null,
      ).length,
      agedSurchargeAvailability: parsed.agedSurchargeAvailability,
      estimatedAgedSurcharge: parsed.agedSurchargeAvailability === "unavailable"
        ? null
        : rows.some((row) => row.estimatedAgedSurcharge !== null)
          ? Number(
              rows
                .reduce((sum, row) => sum + (row.estimatedAgedSurcharge ?? 0), 0)
                .toFixed(2),
            )
          : null,
      agedSurchargeReportedSkuCount: rows.filter(
        (row) => row.estimatedAgedSurcharge !== null,
      ).length,
    },
    expiration: agedInventoryExpirationBoundary(),
    notice:
      "資料取自 Amazon FBA Manage Inventory Health report。庫齡桶與 estimated excess 顯示報表原值；費用空白只有在同列官方 storage volume／AIS 計費數量明確為 0 時才安全呈現 0，其餘缺欄或缺值不推算。本頁唯讀，不會建立促銷或移除訂單。",
  };
}

type ListingReportSeed = {
  sellerSku: string;
  asin: string;
  title: string;
};

export function parseFbaListingReportSeeds(text: string): ListingReportSeed[] {
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
    const fulfillment = row[fulfillmentIndex]?.trim() ?? "";
    if (!/^(AMAZON|AFN)(?:_|$)/i.test(fulfillment)) {
      continue;
    }
    const sellerSku = row[skuIndex] ?? "";
    if (
      !sellerSku ||
      sellerSku.length > 40 ||
      sellerSku !== sellerSku.trim() ||
      /[\u0000-\u001f\u007f]/u.test(sellerSku) ||
      seen.has(sellerSku)
    ) {
      throw new SpApiError(
        "Amazon 全商品報表含有缺少、重複或無法精確辨識的 FBA Seller SKU；為避免改寫識別或少算商品，已停止讀取。",
        { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
      );
    }
    seen.add(sellerSku);
    seeds.push({
      sellerSku,
      // Preserve report identity exactly. Canonical review-audit validation
      // decides whether the raw ASIN is safe to query; it must never be fixed
      // by trimming before the report/Listings equality check.
      asin: asinIndex >= 0 ? row[asinIndex] ?? "" : "",
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
    imageUrls: IMAGE_ATTRIBUTE_NAMES
      .map((attributeName) => listingImageUrl(payload, attributeName, marketplaceId))
      .filter((url): url is string => Boolean(url)),
    status: Array.isArray(summary?.status) ? summary.status.join(", ") : "",
    updatedAt: summary?.lastUpdatedDate ?? "",
    readStatus: "complete",
    readErrors: [],
  };
}

async function fetchExportRows(
  marketplaceId: MarketplaceId,
  seeds: ListingReportSeed[],
): Promise<{ rows: ListingExportRow[]; errors: ListingExportError[] }> {
  const bySku = new Map<string, ListingExportRow>();
  const excludedNonFbaSkus = new Set<string>();
  const errors: ListingExportError[] = [];
  const readErrorsBySku = new Map<string, ListingExportReadError[]>();
  const recordReadError = (
    sellerSku: string,
    message: string,
    code: ListingExportReadError["code"] = "LISTING_QUERY_FAILED",
  ): void => {
    const current = readErrorsBySku.get(sellerSku) ?? [];
    if (!current.some((error) => error.code === code && error.message === message)) {
      current.push({ code, message });
      readErrorsBySku.set(sellerSku, current);
    }
  };
  const recordListing = (listing: AmazonListingItem): void => {
    const sellerSku = safeText(listing.sku, "—");
    const fulfillmentEvidence = payloadFulfillmentEvidence(listing);
    if (fulfillmentEvidence === "OTHER") {
      excludedNonFbaSkus.add(sellerSku);
      errors.push({
        sellerSku,
        kind: "非 FBA，已略過",
        message: "即時 Listing 資料無法確認為 FBA，因此沒有加入匯出。",
      });
      return;
    }
    const item = exportRowFromListing(listing, marketplaceId);
    if (fulfillmentEvidence === "MISSING") {
      const message =
        "報表已確認此 SKU 為 FBA，但 Listings Items API 未回傳可核對的 fulfillmentAvailability。";
      errors.push({
        sellerSku,
        kind: "履約資料未回傳",
        message,
      });
      recordReadError(
        sellerSku,
        message,
        "LISTING_CONTENT_NOT_RETURNED",
      );
    }
    if (!isRecord(listing.attributes)) {
      const message =
        "Listings Items API 回應成功，但未回傳 attributes，無法確認商品內容完整性。";
      errors.push({
        sellerSku,
        kind: "內容未回傳",
        message,
      });
      recordReadError(
        sellerSku,
        message,
        "LISTING_CONTENT_NOT_RETURNED",
      );
    }
    const readErrors = readErrorsBySku.get(sellerSku) ?? [];
    if (readErrors.length) {
      item.readStatus = "incomplete";
      item.readErrors = [...readErrors];
    }
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
              const message =
                error instanceof Error ? error.message : "商品內容查詢失敗。";
              errors.push({
                sellerSku,
                kind: "查詢失敗",
                message,
              });
              recordReadError(sellerSku, message);
            }
            await wait(220);
          }
          continue;
        }
        if (!response.ok) {
          return throwListingsError(response, "read", "searchListingsItems");
        }
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
      sellerSkus.forEach((sellerSku) => {
        errors.push({ sellerSku, kind: "查詢失敗", message });
        recordReadError(sellerSku, message);
      });
    }
    await wait(220);
  }

  const rows = seeds.flatMap((seed) => {
    if (excludedNonFbaSkus.has(seed.sellerSku)) return [];
    const found = bySku.get(seed.sellerSku);
    if (found) {
      if (found.readStatus === "complete" && !found.ingredients) {
        errors.push({
          sellerSku: seed.sellerSku,
          kind: "缺少成分",
          message: "此商品沒有可匯出的 ingredients 值，或商品類型不適用。",
        });
      }
      return [found];
    }
    const incompleteMessage =
      "報表中有此 FBA SKU，但 Listings Items API 未回傳完整 attributes。";
    errors.push({
      sellerSku: seed.sellerSku,
      kind: "內容未回傳",
      message: incompleteMessage,
    });
    recordReadError(
      seed.sellerSku,
      incompleteMessage,
      "LISTING_CONTENT_NOT_RETURNED",
    );
    return [{
      marketplace: MARKETPLACES[marketplaceId].name,
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      productType: "",
      title: seed.title,
      bulletPoints: [],
      ingredients: "",
      imageUrls: [],
      status: "",
      updatedAt: "",
      readStatus: "incomplete" as const,
      readErrors: [...(readErrorsBySku.get(seed.sellerSku) ?? [])],
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
    const expectedReference = `demo-${input.marketplaceId}`;
    if (
      input.reportId !== expectedReference ||
      input.documentId !== expectedReference
    ) {
      throw new SpApiError("展示全商品報表與目前站點快照不一致。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    const sellerSkus = [
      ...new Set(
        buildDemoOrders(input.marketplaceId)
          .flatMap((order) => order.items)
          .map((item) => item.sellerSku),
      ),
    ];
    const rows = sellerSkus.map((sellerSku, index) => {
      const listing = getDemoListingContent(input.marketplaceId, sellerSku);
      return {
        marketplace: MARKETPLACES[input.marketplaceId].name,
        sellerSku,
        asin: listing.asin ?? "",
        productType: listing.productType,
        title: listing.title,
        bulletPoints: listing.bulletPoints,
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
  const seeds = parseFbaListingReportSeeds(report);
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

type UnboundVariationSearchSeed = {
  sellerSku: string;
  asin: string;
  title: string;
};

export type VerifiedFbaVariationRelationshipRow = {
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  role: "parent" | "child" | "standalone";
  relationshipEvidence: "relationships";
  requestId: string | null;
};

export type UnboundVariationSearchBatchResult = {
  verifiedRows: VerifiedFbaVariationRelationshipRow[];
  rows: UnboundVariationAuditRow[];
  incompleteRows: UnboundVariationAuditIncompleteRow[];
  boundChildren: number;
  parentContainers: number;
};

function incompleteVariationBatch(
  seeds: readonly UnboundVariationSearchSeed[],
  code: UnboundVariationAuditIncompleteRow["code"],
  message: string,
  requestId: string | null,
): UnboundVariationSearchBatchResult {
  return {
    verifiedRows: [],
    rows: [],
    incompleteRows: seeds.map((seed) => ({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: seed.title,
      code,
      message,
      requestId,
    })),
    boundChildren: 0,
    parentContainers: 0,
  };
}

type UnboundVariationMarketplaceSummary = NonNullable<
  AmazonListingItem["summaries"]
>[number];

function exactUnboundVariationMarketplaceSummary(input: {
  payload: AmazonListingItem;
  marketplaceId: MarketplaceId;
}):
  | { summary: UnboundVariationMarketplaceSummary; error: null }
  | { summary: null; error: string } {
  if (input.payload.summaries === undefined) {
    return {
      summary: null,
      error: "Amazon summaries 沒有回傳目前站點的 ASIN 證據。",
    };
  }
  if (!Array.isArray(input.payload.summaries)) {
    return {
      summary: null,
      error:
        "Amazon summaries 格式無法辨識，無法精確核對目前站點。",
    };
  }

  const summaries: UnboundVariationMarketplaceSummary[] = [];
  for (const value of input.payload.summaries) {
    if (
      !isRecord(value) ||
      typeof value.marketplaceId !== "string" ||
      !value.marketplaceId ||
      value.marketplaceId !== value.marketplaceId.trim() ||
      /[\u0000-\u001f\u007f]/u.test(value.marketplaceId) ||
      typeof value.asin !== "string" ||
      !/^[A-Z0-9]{10}$/u.test(value.asin)
    ) {
      return {
        summary: null,
        error:
          "Amazon summaries 含有站點不明或格式不完整的列，無法唯一辨識目前站點。",
      };
    }
    summaries.push(value as UnboundVariationMarketplaceSummary);
  }

  const currentMarketplaceSummaries = summaries.filter(
    (summary) => summary.marketplaceId === input.marketplaceId,
  );
  if (currentMarketplaceSummaries.length !== 1) {
    return {
      summary: null,
      error: currentMarketplaceSummaries.length === 0
        ? "Amazon summaries 沒有回傳目前站點的唯一 summary；其他站點資料不會被當成本站資料。"
        : "Amazon summaries 同時回傳多個目前站點 summary，無法唯一辨識本站資料。",
    };
  }
  return { summary: currentMarketplaceSummaries[0]!, error: null };
}

export function classifyUnboundVariationSearchBatch(input: {
  marketplaceId: MarketplaceId;
  seeds: readonly UnboundVariationSearchSeed[];
  status: number;
  payload: unknown;
  requestId: string | null;
}): UnboundVariationSearchBatchResult {
  if (input.status === 400) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIPS_COMPATIBILITY_FALLBACK",
      "Amazon 拒絕官方 searchListingsItems relationships 批次參數；本次未降級為逐 SKU 或 attributes 猜測。",
      input.requestId,
    );
  }
  if (input.status < 200 || input.status >= 300) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIP_QUERY_FAILED",
      `Amazon relationships 批次查詢失敗（HTTP ${input.status}）；此批次未作任何推定。`,
      input.requestId,
    );
  }
  if (!isRecord(input.payload) || !Array.isArray(input.payload.items)) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIP_RESPONSE_INVALID",
      "Amazon relationships 批次回應格式無法辨識；此批次未作任何推定。",
      input.requestId,
    );
  }
  const pagination = input.payload.pagination;
  const numberOfResults = input.payload.numberOfResults;
  if (
    (pagination !== undefined &&
      (!isRecord(pagination) ||
        (pagination.nextToken !== undefined && pagination.nextToken !== null &&
          pagination.nextToken !== ""))) ||
    (numberOfResults !== undefined &&
      (!Number.isSafeInteger(numberOfResults) ||
        numberOfResults !== input.payload.items.length))
  ) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIP_RESPONSE_INVALID",
      "Amazon relationships 批次回應顯示仍有未讀頁面或列數不一致；此批次未作任何推定。",
      input.requestId,
    );
  }
  const seedBySku = new Map(input.seeds.map((seed) => [seed.sellerSku, seed]));
  if (seedBySku.size !== input.seeds.length) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIP_RESPONSE_INVALID",
      "未綁變體批次含有重複 Seller SKU；此批次已停止判定。",
      input.requestId,
    );
  }
  const itemBySku = new Map<string, AmazonListingItem>();
  for (const value of input.payload.items) {
    if (!isRecord(value)) {
      return incompleteVariationBatch(
        input.seeds,
        "RELATIONSHIP_RESPONSE_INVALID",
        "Amazon relationships 批次回應含有無法辨識的 Listing 列；此批次未作任何推定。",
        input.requestId,
      );
    }
    const sellerSku =
      typeof value.sku === "string" &&
        Boolean(value.sku) &&
        value.sku.length <= 40 &&
        value.sku === value.sku.trim() &&
        !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
          value.sku,
        )
        ? value.sku
        : null;
    if (
      !sellerSku ||
      !seedBySku.has(sellerSku) ||
      itemBySku.has(sellerSku)
    ) {
      return incompleteVariationBatch(
        input.seeds,
        "RELATIONSHIP_RESPONSE_INVALID",
        "Amazon relationships 批次回應的 Seller SKU 缺少、重複或與請求不一致；此批次未作任何推定。",
        input.requestId,
      );
    }
    itemBySku.set(sellerSku, value as AmazonListingItem);
  }

  const verifiedRows: VerifiedFbaVariationRelationshipRow[] = [];
  const rows: UnboundVariationAuditRow[] = [];
  const incompleteRows: UnboundVariationAuditIncompleteRow[] = [];
  let boundChildren = 0;
  let parentContainers = 0;
  for (const seed of input.seeds) {
    const payload = itemBySku.get(seed.sellerSku);
    if (!payload) {
      incompleteRows.push({
        sellerSku: seed.sellerSku,
        asin: seed.asin,
        title: seed.title,
        code: "RELATIONSHIPS_NOT_RETURNED",
        message:
          "Amazon searchListingsItems 未回傳此報表 SKU；缺列不會被視為 standalone。",
        requestId: input.requestId,
      });
      continue;
    }
    try {
      const summarySelection = exactUnboundVariationMarketplaceSummary({
        payload,
        marketplaceId: input.marketplaceId,
      });
      if (summarySelection.summary === null) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message: summarySelection.error,
          requestId: input.requestId,
        });
        continue;
      }
      const liveAsin = summarySelection.summary.asin;
      if (
        !/^[A-Z0-9]{10}$/u.test(seed.asin) ||
        liveAsin !== seed.asin
      ) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message:
            "Amazon summaries 回傳的 ASIN 與同次 FBA 報表不一致；已停止判定，不會用任一方覆蓋或冒充。",
          requestId: input.requestId,
        });
        continue;
      }
      const conflict = variationRelationshipEvidenceConflict(
        payload as VariationListingPayload,
        input.marketplaceId,
      );
      if (conflict) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message: conflict,
          requestId: input.requestId,
        });
        continue;
      }
      const member = normalizeVariationMember(
        payload as VariationListingPayload,
        input.marketplaceId,
        "relationships",
      );
      if (member.sellerSku !== seed.sellerSku) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message: "Amazon relationships 回應的 Seller SKU 與報表不一致。",
          requestId: input.requestId,
        });
        continue;
      }
      const classification = classifyUnboundVariationEvidence({
        marketplaceId: input.marketplaceId,
        profile: "relationships",
        relationships: payload.relationships,
        role: member.role,
        listingFulfillmentEvidence: payloadFulfillmentEvidence(payload),
      });
      const verified: VerifiedFbaVariationRelationshipRow = {
        sellerSku: seed.sellerSku,
        asin: liveAsin,
        title: member.title || seed.title || "Amazon 未提供商品名稱",
        productType: member.productType,
        role: member.role,
        relationshipEvidence: "relationships",
        requestId: input.requestId,
      };
      if (classification.kind === "unbound") {
        verifiedRows.push(verified);
        rows.push({
          sellerSku: seed.sellerSku,
          asin: verified.asin,
          title: verified.title,
          productType: member.productType,
          relationshipEvidence: "relationships",
          notice: "Amazon relationships 已完整回傳，且沒有 parent 關係。",
        });
      } else if (classification.kind === "bound-child") {
        verifiedRows.push(verified);
        boundChildren += 1;
      } else if (classification.kind === "parent-container") {
        verifiedRows.push(verified);
        parentContainers += 1;
      } else {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: member.asin ?? seed.asin,
          title: member.title || seed.title,
          code: classification.code,
          message: classification.message,
          requestId: input.requestId,
        });
      }
    } catch (error) {
      incompleteRows.push({
        sellerSku: seed.sellerSku,
        asin: seed.asin,
        title: seed.title,
        code: "RELATIONSHIP_RESPONSE_INVALID",
        message: error instanceof Error
          ? error.message
          : "Amazon relationships 回應無法安全判定。",
        requestId: input.requestId,
      });
    }
  }
  return { verifiedRows, rows, incompleteRows, boundChildren, parentContainers };
}

async function fetchFbaReviewRelationshipBatch(
  marketplaceId: MarketplaceId,
  sellerSkus: string[],
): Promise<FbaReviewAuditRelationshipBatch> {
  const response = await executeUnboundVariationSearchRequest(
    marketplaceId,
    sellerSkus,
  );
  return {
    status: response.status,
    payload: response.ok
      ? await parseResponseJson<AmazonListingSearchResponse>(response)
      : null,
    requestId: response.headers.get("x-amzn-requestid"),
  };
}

/**
 * Proves every review-audit candidate with the same strict, batched Listings
 * relationships contract used by the unbound-variation audit. Parent
 * containers and incomplete relationship evidence are never returned as
 * Customer Feedback candidates.
 */
export async function verifyFbaReviewAuditSeeds(input: {
  marketplaceId: MarketplaceId;
  seeds: readonly FbaReviewAuditSeed[];
  searchBatch?: (
    sellerSkus: string[],
  ) => Promise<FbaReviewAuditRelationshipBatch>;
  pace?: (milliseconds: number) => Promise<void>;
}): Promise<ReviewAuditCandidateSnapshot> {
  const relationshipIncompleteRows: ReviewAuditRelationshipIncompleteRow[] = [];
  const seedBySku = new Map<string, FbaReviewAuditSeed>();
  for (const seed of input.seeds) {
    if (seedBySku.has(seed.sellerSku)) {
      throw new SpApiError("評論健檢來源含有重複 Seller SKU。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    seedBySku.set(seed.sellerSku, seed);
  }
  const validAsinSeeds = input.seeds.filter((seed) => {
    if (/^[A-Z0-9]{10}$/u.test(seed.asin)) return true;
    relationshipIncompleteRows.push({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: seed.title || "Amazon 未提供商品名稱",
      code: "REPORT_ASIN_INVALID",
      message:
        "Amazon FBA 全商品報表沒有可與 Listings summary 原樣比對的十碼 ASIN；此 SKU 未查詢評論主題。",
      requestId: null,
    });
    return false;
  });
  const { batches, unqueryableSellerSkus } =
    buildUnboundVariationSearchBatches(
      validAsinSeeds.map(({ sellerSku }) => sellerSku),
    );
  const unqueryable = new Set(unqueryableSellerSkus);
  for (const sellerSku of unqueryableSellerSkus) {
    const seed = seedBySku.get(sellerSku)!;
    relationshipIncompleteRows.push({
      sellerSku,
      asin: seed.asin,
      title: seed.title || "Amazon 未提供商品名稱",
      code: "SELLER_SKU_UNQUERYABLE",
      message:
        "此 Seller SKU 無法不失真地放入官方 identifiers 批次參數；未 trim、改名或降級為逐 SKU 查詢。",
      requestId: null,
    });
  }
  const verifiedRows: VerifiedFbaVariationRelationshipRow[] = [];
  const searchBatch = input.searchBatch ?? ((sellerSkus) =>
    fetchFbaReviewRelationshipBatch(input.marketplaceId, sellerSkus));
  const pace = input.pace ?? wait;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const sellerSkus = batches[batchIndex]!;
    const batchSeeds = sellerSkus.map((sellerSku) => seedBySku.get(sellerSku)!);
    try {
      const response = await searchBatch([...sellerSkus]);
      const result = classifyUnboundVariationSearchBatch({
        marketplaceId: input.marketplaceId,
        seeds: batchSeeds,
        status: response.status,
        payload: response.payload,
        requestId: response.requestId,
      });
      verifiedRows.push(...result.verifiedRows);
      relationshipIncompleteRows.push(...result.incompleteRows);
    } catch (error) {
      const failed = incompleteVariationBatch(
        batchSeeds,
        "RELATIONSHIP_QUERY_FAILED",
        error instanceof Error
          ? error.message
          : "Amazon relationships 批次查詢失敗。",
        error instanceof SpApiError ? error.requestId : null,
      );
      relationshipIncompleteRows.push(...failed.incompleteRows);
    }
    if (batchIndex + 1 < batches.length) await pace(220);
  }

  const byAsin = new Map<string, VerifiedFbaVariationRelationshipRow[]>();
  for (const row of verifiedRows) {
    const group = byAsin.get(row.asin) ?? [];
    group.push(row);
    byAsin.set(row.asin, group);
  }
  const candidatesBeforeDedupe: FbaReviewCandidate[] = [];
  let excludedParentContainers = 0;
  for (const rows of byAsin.values()) {
    const roles = new Set(rows.map(({ role }) => role));
    if (roles.size !== 1) {
      relationshipIncompleteRows.push(...rows.map((row) => ({
        sellerSku: row.sellerSku,
        asin: row.asin,
        title: seedBySku.get(row.sellerSku)?.title || row.title,
        code: "RELATIONSHIP_ROLE_CONFLICT" as const,
        message:
          "同一 ASIN 的 Seller SKU 在同次 Listings relationships 回應中出現不同 parent／child／standalone 角色；未合併，也未查詢評論主題。",
        requestId: row.requestId,
      })));
      continue;
    }
    const role = rows[0]!.role;
    if (role === "parent") {
      excludedParentContainers += rows.length;
      continue;
    }
    candidatesBeforeDedupe.push(...rows.map((row) => ({
      sellerSku: row.sellerSku,
      asin: row.asin,
      title: seedBySku.get(row.sellerSku)?.title || row.title,
      relationshipRole: role,
    })));
  }
  const candidates = dedupeFbaReviewCandidates(candidatesBeforeDedupe);
  const verifiedChildListings = candidatesBeforeDedupe.filter(
    ({ relationshipRole }) => relationshipRole === "child",
  ).length;
  const verifiedStandaloneListings =
    candidatesBeforeDedupe.length - verifiedChildListings;
  const coverage: ReviewAuditCandidateCoverage = {
    sourceFbaListings: input.seeds.length,
    verifiedNonParentListings: candidatesBeforeDedupe.length,
    verifiedChildListings,
    verifiedStandaloneListings,
    excludedParentContainers,
    relationshipIncomplete: relationshipIncompleteRows.length,
  };
  if (
    coverage.sourceFbaListings !==
      coverage.verifiedNonParentListings +
        coverage.excludedParentContainers +
        coverage.relationshipIncomplete ||
    unqueryable.size !== unqueryableSellerSkus.length
  ) {
    throw new SpApiError(
      "評論健檢的 relationship 覆蓋無法與 FBA 來源逐列對齊，已停止輸出。",
      { status: 502, code: "RELATIONSHIP_RESPONSE_INVALID" },
    );
  }
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    sourceCandidateCount: input.seeds.length,
    candidates,
    relationshipIncompleteRows: relationshipIncompleteRows
      .map((row) => ({
        ...row,
        asin: row.asin.length <= 40 && row.asin === row.asin.trim() &&
            !/[\u0000-\u001f\u007f]/u.test(row.asin)
          ? row.asin
          : "",
        title: row.title || "Amazon 未提供商品名稱",
      }))
      .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku, "en")),
    coverage,
    notice:
      "FBA 範圍取自同次全商品報表；每批最多 20 個 Seller SKU 以官方 searchListingsItems 核對 summaries 與 relationships。只將已證明為 child 或 standalone 的非 parent ASIN 送往 Customer Feedback；parent 容器與證據未完成列不會送出。",
  };
}

export async function getUnboundVariationAuditData(input: {
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
}): Promise<UnboundVariationAuditSnapshot> {
  if (shouldUseDemoMode(input.marketplaceId)) {
    const sellerSkus = [
      ...new Set(
        buildDemoOrders(input.marketplaceId)
          .flatMap((order) => order.items)
          .map((item) => item.sellerSku),
      ),
    ];
    const rows: UnboundVariationAuditRow[] = [];
    let boundChildren = 0;
    let parentContainers = 0;
    for (const sellerSku of sellerSkus) {
      const family = getDemoVariationFamily(input.marketplaceId, sellerSku);
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

  const status = await getAllListingsReportStatus({
    marketplaceId: input.marketplaceId,
    reportId: input.reportId,
  });
  if (!status.ready || status.documentId !== input.documentId) {
    throw new SpApiError("報表尚未完成，或未綁變體健檢文件資訊已失效。", {
      status: 409,
      code: "REPORT_NOT_READY",
    });
  }
  const report = await downloadReportDocument(
    input.marketplaceId,
    input.documentId,
  );
  const seeds = parseFbaListingReportSeeds(report);
  const rows: UnboundVariationAuditRow[] = [];
  const incompleteRows: UnboundVariationAuditIncompleteRow[] = [];
  let boundChildren = 0;
  let parentContainers = 0;
  const seedBySku = new Map(seeds.map((seed) => [seed.sellerSku, seed]));
  const { batches, unqueryableSellerSkus } =
    buildUnboundVariationSearchBatches(seeds.map((seed) => seed.sellerSku));
  for (const sellerSku of unqueryableSellerSkus) {
    const seed = seedBySku.get(sellerSku)!;
    incompleteRows.push({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: seed.title,
      code: "RELATIONSHIP_QUERY_FAILED",
      message:
        "此 Seller SKU 無法不失真地放入官方 identifiers 批次參數；未 trim、改名或降級為逐 SKU 猜測。",
      requestId: null,
    });
  }

  for (const sellerSkus of batches) {
    const batchSeeds = sellerSkus.map((sellerSku) => seedBySku.get(sellerSku)!);
    try {
      const response = await executeUnboundVariationSearchRequest(
        input.marketplaceId,
        sellerSkus,
      );
      const requestId = response.headers.get("x-amzn-requestid");
      const payload = response.ok
        ? await parseResponseJson<AmazonListingSearchResponse>(response)
        : null;
      const result = classifyUnboundVariationSearchBatch({
        marketplaceId: input.marketplaceId,
        seeds: batchSeeds,
        status: response.status,
        payload,
        requestId,
      });
      rows.push(...result.rows);
      incompleteRows.push(...result.incompleteRows);
      boundChildren += result.boundChildren;
      parentContainers += result.parentContainers;
    } catch (error) {
      const failed = incompleteVariationBatch(
        batchSeeds,
        "RELATIONSHIP_QUERY_FAILED",
        error instanceof Error
          ? error.message
          : "Amazon relationships 批次查詢失敗。",
        error instanceof SpApiError ? error.requestId : null,
      );
      incompleteRows.push(...failed.incompleteRows);
    }
    await wait(220);
  }

  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    fetchedAt: new Date().toISOString(),
    rows: rows.sort((left, right) => left.sellerSku.localeCompare(right.sellerSku)),
    incompleteRows: incompleteRows.sort((left, right) =>
      left.sellerSku.localeCompare(right.sellerSku),
    ),
    summary: {
      totalFbaListings: seeds.length,
      completed: seeds.length - incompleteRows.length,
      unbound: rows.length,
      boundChildren,
      parentContainers,
      incomplete: incompleteRows.length,
    },
    notice:
      "FBA 範圍取自同次 Amazon 全商品報表；每次以官方 searchListingsItems 最多 20 個 Seller SKU 批次讀取。只有 relationships 明確完整且沒有 parent 的 SKU 才列為未綁變體；缺列、400 相容性或批次錯誤皆另列未完成，不會降級猜測。",
  };
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
  if (!response.ok) {
    return throwListingsError(response, "write", "patchListingsItem");
  }

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
  if (!response.ok) {
    return throwListingsError(response, "write", "patchListingsItem");
  }

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

function buildDemoSalesTrendSeries(
  marketplaceId: MarketplaceId,
  window: SalesTrendWindow,
  seed: number,
): Pick<SalesTrendSeriesResult, "points" | "totals"> {
  const currencyCode = MARKETPLACES[marketplaceId].currency;
  const base = currencyCode === "JPY" ? 18_000 : 180;
  const points = window.dateKeys.map((date, index): SalesTrendPoint => {
    const unitCount = 8 + ((index * 7 + seed) % 13);
    const amount = Number(
      (base * (0.72 + ((index * 11 + seed) % 9) / 10)).toFixed(
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
      partial: date === window.partialDateKey,
    };
  });
  return { points, totals: salesTrendTotals(points, currencyCode) };
}

export async function getSalesTrend(input: {
  marketplaceId: MarketplaceId;
  days?: SalesTrendPresetDays | null;
  startDate?: string | null;
  endDate?: string | null;
  comparison?: SalesTrendComparisonMode;
}): Promise<SalesTrendSnapshot> {
  const now = new Date();
  const comparisonMode = input.comparison ?? "none";
  if (!(["none", "previous-year"] as string[]).includes(comparisonMode)) {
    invalidSalesTrendRange("不支援這個銷售趨勢比較方式。");
  }
  const range = resolveSalesTrendRange(input, now);
  const timeZone = MARKETPLACES[input.marketplaceId].timeZone;
  const today = zonedDateParts(now, timeZone);
  const todayKey = dateKey(today.year, today.month, today.day);
  const window = buildSalesTrendRangeWindow(
    input.marketplaceId,
    range,
    range.endDate === todayKey ? now : null,
  );
  const comparisonWindow =
    comparisonMode === "previous-year"
      ? buildPreviousYearSalesTrendWindow(input.marketplaceId, window)
      : null;
  if (comparisonWindow) {
    assertSalesTrendApiHorizon(comparisonWindow.range, todayKey);
  }

  if (!shouldUseDemoMode(input.marketplaceId)) {
    return fetchLiveSalesTrend({
      marketplaceId: input.marketplaceId,
      range,
      window,
      comparisonWindow,
    });
  }

  const current = buildDemoSalesTrendSeries(
    input.marketplaceId,
    window,
    range.dayCount,
  );
  const rawPrevious = comparisonWindow
    ? buildDemoSalesTrendSeries(
        input.marketplaceId,
        comparisonWindow,
        range.dayCount + 5,
      )
    : null;
  const previous =
    rawPrevious && comparisonWindow
      ? comparablePreviousYearSeries(window, comparisonWindow, {
          ...rawPrevious,
          requestId: null,
          rateLimit: null,
        })
      : null;
  const comparisonNotice = salesTrendComparisonNotice(
    window,
    Boolean(comparisonWindow),
  );
  return {
    schemaVersion: 2,
    mode: "demo",
    marketplaceId: input.marketplaceId,
    days: range.dayCount,
    range,
    timeZone: window.timeZone,
    points: current.points,
    totals: current.totals,
    fetchedAt: new Date().toISOString(),
    requestId: null,
    rateLimit: null,
    comparison:
      previous && comparisonWindow
        ? {
            kind: "previous-year",
            range: previous.range,
            points: previous.points,
            totals: previous.totals,
            requestId: null,
            rateLimit: null,
          }
        : null,
    notice: `${
      isConfiguredForMarketplace(input.marketplaceId)
        ? "目前由 SP_API_MODE 強制使用展示資料；趨勢只供版面測試。"
        : `${MARKETPLACES[input.marketplaceId].label}站尚未在 Mac Keychain 加入 refresh token，因此顯示展示趨勢。`
    }${comparisonNotice ? ` ${comparisonNotice}` : ""}`,
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
          ? "Sales API 沒有提供完整的近 30 個站點日，銷速可能被低估，請人工複核。"
          : "近 30 個完整站點日的銷速取自 Sales API 精確 SKU 查詢；建議量已扣除 FBA 可售與 working／shipped／receiving 在途庫存。",
      skillConnected
        ? "已偵測到補貨 Skill 接點；正式送出仍應先人工審核。"
        : "工作區未找到既有補貨 Skill，目前直接使用 FBA Inventory 與 Sales API AFN/FBA 資料。",
    ].join(" "),
    skillConnected,
  };
}

async function fetchLiveSalesVelocity(
  marketplaceId: MarketplaceId,
  sellerSku: string,
  lookbackDays = 30,
): Promise<RestockPlanSnapshot["demand"]> {
  const now = new Date();
  const timeZone = MARKETPLACES[marketplaceId].timeZone;
  const today = zonedDateParts(now, timeZone);
  const todayKey = dateKey(today.year, today.month, today.day);
  // Use complete marketplace-local days so a partial current day does not
  // artificially depress average daily demand. Sales API's exact SKU filter
  // avoids the previous five-page Orders scan, which could miss a valid SKU in
  // a high-volume account and incorrectly leave days of cover blank.
  const endDate = shiftDateKey(todayKey, -1);
  const startDate = shiftDateKey(endDate, -(lookbackDays - 1));
  const range = resolveSalesTrendRange(
    { marketplaceId, startDate, endDate },
    now,
  );
  const window = buildSalesTrendRangeWindow(marketplaceId, range, null);
  const series = await fetchLiveSalesTrendSeries(
    marketplaceId,
    window,
    sellerSku,
  );
  const units = series.totals.unitCount;
  return {
    lookbackDays,
    units,
    averageDailyUnits: units / lookbackDays,
    ordersScanned: series.totals.orderCount,
    partial: false,
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
