/**
 * Pure, transport-injected helpers for an FBA-only Subscribe & Save audit.
 *
 * Amazon's public Replenishment v2022-11-07 model is the contract used here:
 * - listOffers exposes the current offer configuration and active-subscription
 *   snapshot, but does not expose a seller/merchant fulfilment filter.
 * - listOfferMetrics accepts fulfillmentChannelTypes=["AMAZON"], but a row for
 *   a past month only proves that month's fulfillment channel. It must never be
 *   treated as proof that the offer is currently FBA. Current inclusion always
 *   requires an independently proven current FBA SKU set (for example, from an
 *   FBA-only inventory report fetched in the same audit run).
 * - listOfferMetrics can query one ISO calendar month at a time and supports
 *   only the trailing two years. It does not expose an offer-enrolment date or
 *   an unlimited "since inception" monthly subscription history.
 *
 * This module deliberately owns no credential or network access. Main-process
 * integration must inject the existing authenticated, allowlisted SP-API
 * transport and must not expose access tokens to the renderer.
 */

export const REPLENISHMENT_OFFERS_PATH =
  "/replenishment/2022-11-07/offers/search";
export const REPLENISHMENT_OFFER_METRICS_PATH =
  "/replenishment/2022-11-07/offers/metrics/search";

export const OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES = Object.freeze({
  ATVPDKIKX0DER: "USD", // US
  A2EUQ1WTGCTBG2: "CAD", // CA
  A1RKKUPIHCS9HS: "EUR", // ES
  A1F83G8C2ARO7P: "GBP", // UK
  A13V1IB3VIYZZH: "EUR", // FR
  APJ6JRA9NG5V4: "EUR", // IT
  A21TJRUUN4KGV: "INR", // IN
  A1PA6795UKMFR9: "EUR", // DE
  A1VC38T7YXB528: "JPY", // JP
} as const);

export type SellerReplenishmentMarketplaceId =
  keyof typeof OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES;

export const SUBSCRIPTION_AUDIT_DISCOUNT_BUCKETS = [
  0, 5, 10, 15, 20,
] as const;
export type SubscriptionAuditDiscountBucket =
  (typeof SUBSCRIPTION_AUDIT_DISCOUNT_BUCKETS)[number];

const OFFER_PAGE_SIZE = 100;
const METRIC_PAGE_SIZE = 500;
const MAX_PAGE_OFFSET = 9_000;
const MAX_OFFER_RESULTS = MAX_PAGE_OFFSET + OFFER_PAGE_SIZE;
const MAX_METRIC_RESULTS = MAX_PAGE_OFFSET + METRIC_PAGE_SIZE;
// A full current month is not available, so 23 complete months are the
// guaranteed maximum that can fit wholly inside an exact trailing-two-year
// horizon. The API may allow part of a 24th month, but we never label it as a
// complete calendar-month datapoint.
const MAX_MONTHLY_HISTORY = 23;
const MAX_TEXT_LENGTH = 512;

const ELIGIBILITIES = new Set([
  "ELIGIBLE",
  "INELIGIBLE",
  "SUSPENDED",
  "REPLENISHMENT_ONLY_ORDERING",
]);
const ENROLLMENT_METHODS = new Set(["MANUAL", "AUTOMATIC"]);
const AUTO_ENROLLMENT_PREFERENCES = new Set(["OPTED_IN", "OPTED_OUT"]);
const DELIVERY_CONDITIONS = new Set([
  "NEXT_30_DAYS_DELIVERIES_PAUSED_PRICING",
  "NEXT_30_DAYS_DELIVERIES_PAUSED_NON_BUYABLE",
  "NEXT_30_DAYS_DELIVERIES_AT_LOW_INVENTORY_RISK_ONLY",
  "NEXT_30_DAYS_DELIVERIES_AT_LOW_INVENTORY_RISK",
  "NO_ISSUES_FOR_NEXT_30_DAYS_DELIVERIES",
]);

export type ReplenishmentAuditErrorCode =
  | "MARKETPLACE_UNSUPPORTED"
  | "REQUEST_INVALID"
  | "RESPONSE_INVALID"
  | "PAGINATION_CHANGED"
  | "PAGINATION_LIMIT_EXCEEDED"
  | "DUPLICATE_SKU";

export class ReplenishmentAuditError extends Error {
  readonly code: ReplenishmentAuditErrorCode;

  constructor(code: ReplenishmentAuditErrorCode, message: string) {
    super(message);
    this.name = "ReplenishmentAuditError";
    this.code = code;
  }
}

export type OfficialMonthlyInterval = {
  startDate: string;
  endDate: string;
  month: string;
};

export type ReplenishmentPageRequest = {
  operation: "listOffers" | "listOfferMetrics";
  path: string;
  offset: number;
  limit: number;
  body: Record<string, unknown>;
};

export type ReplenishmentPageTransport = (
  request: ReplenishmentPageRequest,
) => Promise<unknown>;

export type CurrentSubscriptionOffer = {
  marketplaceId: SellerReplenishmentMarketplaceId;
  sellerSku: string;
  asin: string;
  eligibility: string;
  enrollmentMethod: string | null;
  autoEnrollment: string | null;
  price: { amount: number; currencyCode: string };
  sellerFundedBaseDiscount: number | null;
  sellerFundedTieredDiscount: number | null;
  currentActiveSubscriptions: number;
  inventory: number | null;
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
};

export type OfficialMonthlyOfferMetric = {
  marketplaceId: SellerReplenishmentMarketplaceId;
  sellerSku: string;
  asin: string;
  fulfillmentChannelType: "AMAZON";
  interval: OfficialMonthlyInterval;
  currencyCode: string | null;
  subscriptionRevenue: number | null;
  shippedSubscriptionUnits: number | null;
  activeSubscriptionsAtPeriodEnd: number | null;
  notDeliveredDueToOosPercent: number | null;
  lostRevenueDueToOos: number | null;
  revenuePenetrationPercent: number | null;
  couponRevenuePenetrationPercent: number | null;
  shareOfCouponSubscriptionsPercent: number | null;
};

export type SubscriptionRevenueCoverage = {
  status: "complete" | "partial" | "unavailable";
  expectedOfferMonths: number;
  reportedOfferMonths: number;
};

export type FbaSubscriptionAuditRow = CurrentSubscriptionOffer & {
  fbaEvidence: "CURRENT_FBA_SKU_SET";
  monthlyPerformance: OfficialMonthlyOfferMetric | null;
};

export type ReplenishmentAuditExclusion = {
  sellerSku: string;
  fbaEvidence: "CURRENT_FBA_SKU_SET";
  reason:
    | "FBA_NOT_PROVEN"
    | "METRIC_WITHOUT_CURRENT_OFFER"
    | "ASIN_MISMATCH";
};

export type ReplenishmentUpstreamCoverage = {
  status: "complete" | "partial";
  returnedOfferRows: number;
  acceptedOfferRows: number;
  returnedMetricRows: number;
  acceptedMetricRows: number;
  /** Rows with an exact Seller SKU whose offer values could not be parsed safely. */
  invalidOfferRows: ReplenishmentInvalidOfferRow[];
  /**
   * Exact Seller SKUs isolated from the usable scope. Offer problems exclude
   * the current offer; invalid or duplicate metrics exclude only the affected
   * month.
   * `problem` is a local, sanitized explanation and never contains upstream
   * response bodies or raw field values.
   */
  problemSkuRows: ReplenishmentProblemSkuRow[];
  /**
   * Aggregate-only upstream problems whose exact Seller SKU was not present in
   * the same-run current FBA evidence. Identifiers are deliberately omitted so
   * an FBA-only audit never surfaces an unproven (possibly FBM) SKU.
   */
  unprovenExactSkuProblems: ReplenishmentUnprovenProblemSummary;
  rejectedSellerSkuRows: number;
  /**
   * Lower bound only. Offer rows and metric rows without an exact Seller SKU
   * cannot be joined, so their unresolved SKU-month sets may not overlap.
   */
  minimumUnresolvedOfferMonths: number;
  notice: string;
};

export type ReplenishmentInvalidOfferRow = {
  sellerSku: string;
  problem: string;
};

export type ReplenishmentProblemSkuRow = {
  sellerSku: string;
  fbaEvidence: "CURRENT_FBA_SKU_SET";
  affectedOfferRows: number;
  affectedMetricRows: number;
  metricMonths: string[];
  problem: string;
};

export type ReplenishmentUnprovenProblemSummary = {
  exactSkuCount: number;
  affectedOfferRows: number;
  affectedMetricRows: number;
  minimumUnresolvedOfferMonths: number;
};

export type FbaSubscriptionAuditSnapshot = {
  marketplaceId: SellerReplenishmentMarketplaceId;
  metricInterval: OfficialMonthlyInterval;
  offers: FbaSubscriptionAuditRow[];
  excluded: ReplenishmentAuditExclusion[];
  upstreamCoverage: ReplenishmentUpstreamCoverage;
  summary: {
    currentActiveSubscriptions: number;
    provenSubscriptionRevenue: number | null;
    revenueCurrencyCode: string | null;
    revenueCoverage: SubscriptionRevenueCoverage;
  };
  historyCapability: {
    supportsSinceEnrollmentMonthlySeries: false;
    maximumOfficialLookbackMonths: 23;
    replacement: "REQUESTED_COMPLETE_CALENDAR_MONTHS";
    notice: string;
  };
};

export type FbaSubscriptionAuditHistoryRow = CurrentSubscriptionOffer & {
  fbaEvidence: "CURRENT_FBA_SKU_SET";
  /** Only months actually returned by Amazon. Missing months are omitted. */
  monthlySeries: OfficialMonthlyOfferMetric[];
};

export type FbaSubscriptionAuditHistorySnapshot = {
  marketplaceId: SellerReplenishmentMarketplaceId;
  intervals: OfficialMonthlyInterval[];
  offers: FbaSubscriptionAuditHistoryRow[];
  excluded: ReplenishmentAuditExclusion[];
  upstreamCoverage: ReplenishmentUpstreamCoverage;
  summary: {
    currentActiveSubscriptions: number;
    provenSubscriptionRevenue: number | null;
    revenueCurrencyCode: string | null;
    revenueCoverage: SubscriptionRevenueCoverage;
    monthly: Array<{
      month: string;
      provenSubscriptionRevenue: number | null;
      revenueCoverage: SubscriptionRevenueCoverage;
      shippedSubscriptionUnits: number | null;
      activeSubscriptionsAtPeriodEnd: number | null;
    }>;
  };
  historyCapability: FbaSubscriptionAuditSnapshot["historyCapability"];
};

export const REPLENISHMENT_PUBLIC_CAPABILITY = Object.freeze({
  version: "2022-11-07",
  regions: ["NA", "EU", "FE"] as const,
  rolesAnyOf: ["Brand Analytics", "Inventory and Order Tracking"] as const,
  availability: "FBA selling partners where Subscribe & Save is supported",
  officialSource:
    "https://developer-docs.amazon.com/sp-api/docs/replenishment-api-v2022-11-07-use-case-guide",
  removedReportTypes: {
    reportTypes: [
      "GET_FBA_SNS_FORECAST_DATA",
      "GET_FBA_SNS_PERFORMANCE_DATA",
    ] as const,
    emptySince: "2025-07-25",
    removedOn: "2025-12-11",
    allMarketplaces: true,
    replacement: "Replenishment v2022-11-07",
    officialSource:
      "https://developer-docs.amazon.com/sp-api/changelog/deprecation-of-two-fba-subscribe-and-save-report-types",
  },
});

type ParsedPage<T> = {
  items: T[];
  totalResults: number;
  sourceItemCount: number;
  rejectedSellerSkuRows: number;
  invalidOfferRows: ReplenishmentInvalidOfferRow[];
  invalidMetricRows: ReplenishmentInvalidMetricRow[];
};

type FetchedPages<T> = {
  items: T[];
  sourceRows: number;
  rejectedSellerSkuRows: number;
  invalidOfferRows: ReplenishmentInvalidOfferRow[];
  problems: FetchedPageProblem[];
};

type FetchedPageProblem = {
  sellerSku: string;
  kind: "INVALID_OFFER" | "INVALID_METRIC" | "DUPLICATE";
  source: "OFFER" | "METRIC";
  metricMonth: string | null;
  affectedRows: number;
  problem: string;
};

type ReplenishmentInvalidMetricRow = {
  sellerSku: string;
  problem: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      `${label} 必須是物件。`,
    );
  }
  return value as Record<string, unknown>;
}

function requestRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      `${label} 必須是物件。`,
    );
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = MAX_TEXT_LENGTH): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  ) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      `${label} 缺少、過長或含有不可接受字元。`,
    );
  }
  return value;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return text(value, label);
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1_000_000_000_000
  ) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      `${label} 不是安全的非負數。`,
    );
  }
  return value;
}

function optionalNonNegativeNumber(
  value: unknown,
  label: string,
): number | null {
  if (value === undefined || value === null) return null;
  return nonNegativeNumber(value, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = nonNegativeNumber(value, label);
  if (!Number.isSafeInteger(parsed)) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      `${label} 不是安全整數。`,
    );
  }
  return parsed;
}

function optionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | null {
  if (value === undefined || value === null) return null;
  return nonNegativeInteger(value, label);
}

function optionalPercentage(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  const parsed = nonNegativeNumber(value, label);
  if (parsed > 100) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      `${label} 不可超過 100%。`,
    );
  }
  return parsed;
}

function optionalIntegerPercentage(
  value: unknown,
  label: string,
): number | null {
  const parsed = optionalPercentage(value, label);
  if (parsed !== null && !Number.isSafeInteger(parsed)) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      `${label} 必須是 Amazon model 定義的整數百分比。`,
    );
  }
  return parsed;
}

function enumText(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string {
  const parsed = text(value, label);
  if (!allowed.has(parsed)) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      `${label} 含有不支援的值。`,
    );
  }
  return parsed;
}

function optionalEnumText(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return enumText(value, allowed, label);
}

function sellerSku(value: unknown): string {
  return text(value, "Seller SKU", 256);
}

function upstreamSellerSku(value: unknown): string | null {
  try {
    return sellerSku(value);
  } catch (error) {
    if (error instanceof ReplenishmentAuditError) return null;
    throw error;
  }
}

function asin(value: unknown): string {
  const parsed = text(value, "ASIN", 10);
  if (!/^[A-Z0-9]{10}$/u.test(parsed)) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "ASIN 格式無效。",
    );
  }
  return parsed;
}

function marketplaceCurrency(
  marketplaceId: string,
): {
  marketplaceId: SellerReplenishmentMarketplaceId;
  currencyCode: string;
} {
  if (!(marketplaceId in OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES)) {
    throw new ReplenishmentAuditError(
      "MARKETPLACE_UNSUPPORTED",
      "所選站點不在 Amazon 公開的 Seller Replenishment 支援清單。",
    );
  }
  const supported = marketplaceId as SellerReplenishmentMarketplaceId;
  return {
    marketplaceId: supported,
    currencyCode: OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES[supported],
  };
}

function exactMarketplace(
  value: unknown,
  expected: SellerReplenishmentMarketplaceId,
): SellerReplenishmentMarketplaceId {
  if (value !== expected) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "Amazon Replenishment 回應混入其他站點。",
    );
  }
  return expected;
}

function exactCurrency(
  value: unknown,
  expected: string,
  label: string,
): string {
  const parsed = text(value, label, 3);
  if (!/^[A-Z]{3}$/u.test(parsed) || parsed !== expected) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      `${label} 與所選站點不一致。`,
    );
  }
  return parsed;
}

function subscriptionRevenueCoverage(
  expectedOfferMonths: number,
  reportedOfferMonths: number,
  sourceIncomplete = false,
): SubscriptionRevenueCoverage {
  if (!sourceIncomplete && reportedOfferMonths === expectedOfferMonths) {
    return { status: "complete", expectedOfferMonths, reportedOfferMonths };
  }
  return {
    status: reportedOfferMonths === 0 ? "unavailable" : "partial",
    expectedOfferMonths,
    reportedOfferMonths,
  };
}

function discountFrom(
  promotions: Record<string, unknown> | null,
  key: string,
  label: string,
): number | null {
  if (!promotions || promotions[key] === undefined) return null;
  const funding = record(promotions[key], label);
  return optionalIntegerPercentage(funding.percentage, `${label} percentage`);
}

function parseCurrentOffer(
  value: unknown,
  expectedMarketplace: SellerReplenishmentMarketplaceId,
  expectedCurrency: string,
  validatedSellerSku: string,
): CurrentSubscriptionOffer {
  const raw = record(value, "Subscribe & Save offer");
  exactMarketplace(raw.marketplaceId, expectedMarketplace);
  if (raw.programType !== "SUBSCRIBE_AND_SAVE") {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "Replenishment offer 不是 Subscribe & Save。",
    );
  }
  const configuration =
    raw.offerProgramConfiguration === undefined
      ? null
      : record(raw.offerProgramConfiguration, "offerProgramConfiguration");
  const preferences =
    configuration?.preferences === undefined
      ? null
      : record(configuration.preferences, "offer preferences");
  const promotions =
    configuration?.promotions === undefined
      ? null
      : record(configuration.promotions, "offer promotions");
  const rawForecast =
    raw.forecastDeliveries === undefined
      ? null
      : record(raw.forecastDeliveries, "forecastDeliveries");
  const rawConditions = raw.deliveriesConditions ?? [];
  if (!Array.isArray(rawConditions) || rawConditions.length > 20) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "deliveriesConditions 格式無效。",
    );
  }
  return {
    marketplaceId: expectedMarketplace,
    sellerSku: validatedSellerSku,
    asin: asin(raw.asin),
    eligibility: enumText(raw.eligibility, ELIGIBILITIES, "eligibility"),
    enrollmentMethod: optionalEnumText(
      configuration?.enrollmentMethod,
      ENROLLMENT_METHODS,
      "enrollmentMethod",
    ),
    autoEnrollment: optionalEnumText(
      preferences?.autoEnrollment,
      AUTO_ENROLLMENT_PREFERENCES,
      "autoEnrollment",
    ),
    price: {
      amount: nonNegativeNumber(raw.price, "offer price"),
      currencyCode: exactCurrency(
        raw.priceCurrencyCode,
        expectedCurrency,
        "offer currency",
      ),
    },
    sellerFundedBaseDiscount: discountFrom(
      promotions,
      "sellingPartnerFundedBaseDiscount",
      "seller funded base discount",
    ),
    sellerFundedTieredDiscount: discountFrom(
      promotions,
      "sellingPartnerFundedTieredDiscount",
      "seller funded tiered discount",
    ),
    currentActiveSubscriptions: nonNegativeInteger(
      raw.subscriptions,
      "current active subscriptions",
    ),
    inventory: optionalNonNegativeInteger(raw.inventory, "offer inventory"),
    stockRisk: optionalText(raw.stockRisk, "stockRisk"),
    forecastDeliveries: rawForecast
      ? {
          next15Days: optionalNonNegativeInteger(
            rawForecast.next15DaysDeliveries,
            "next 15 days deliveries",
          ),
          next30Days: optionalNonNegativeInteger(
            rawForecast.next30DaysDeliveries,
            "next 30 days deliveries",
          ),
          next60Days: optionalNonNegativeInteger(
            rawForecast.next60DaysDeliveries,
            "next 60 days deliveries",
          ),
          next90Days: optionalNonNegativeInteger(
            rawForecast.next90DaysDeliveries,
            "next 90 days deliveries",
          ),
        }
      : null,
    deliveryConditions: rawConditions.map((item) => {
      const condition = record(item, "delivery condition");
      return {
        condition: enumText(
          condition.condition,
          DELIVERY_CONDITIONS,
          "delivery condition",
        ),
        next30DaysDeliveries: optionalNonNegativeInteger(
          condition.next30DaysDeliveries,
          "delivery condition count",
        ),
      };
    }),
  };
}

function parsePagination(
  value: unknown,
  maximum: number,
): number {
  const pagination = record(value, "pagination");
  const totalResults = nonNegativeInteger(
    pagination.totalResults,
    "pagination.totalResults",
  );
  if (totalResults > maximum) {
    throw new ReplenishmentAuditError(
      "PAGINATION_LIMIT_EXCEEDED",
      `Amazon 回傳 ${totalResults} 筆資料，超過公開 offset 可完整讀取的 ${maximum} 筆上限。`,
    );
  }
  return totalResults;
}

export function parseReplenishmentOffersPage(
  value: unknown,
  marketplaceId: string,
): ParsedPage<CurrentSubscriptionOffer> {
  const supported = marketplaceCurrency(marketplaceId);
  const raw = record(value, "listOffers response");
  if (!Array.isArray(raw.offers) || raw.offers.length > OFFER_PAGE_SIZE) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "listOffers.offers 格式或頁面大小無效。",
    );
  }
  const items: CurrentSubscriptionOffer[] = [];
  const invalidOfferRows: ReplenishmentInvalidOfferRow[] = [];
  let rejectedSellerSkuRows = 0;
  for (const offer of raw.offers) {
    const candidate = record(offer, "Subscribe & Save offer");
    exactMarketplace(candidate.marketplaceId, supported.marketplaceId);
    if (candidate.programType !== "SUBSCRIBE_AND_SAVE") {
      throw new ReplenishmentAuditError(
        "RESPONSE_INVALID",
        "Replenishment offer 不是 Subscribe & Save。",
      );
    }
    const sku = upstreamSellerSku(candidate.sku);
    if (sku === null) {
      rejectedSellerSkuRows += 1;
      continue;
    }
    try {
      items.push(
        parseCurrentOffer(
          candidate,
          supported.marketplaceId,
          supported.currencyCode,
          sku,
        ),
      );
    } catch (error) {
      if (!(error instanceof ReplenishmentAuditError) || error.code !== "RESPONSE_INVALID") {
        throw error;
      }
      invalidOfferRows.push({ sellerSku: sku, problem: error.message });
    }
  }
  return {
    items,
    totalResults: parsePagination(raw.pagination, MAX_OFFER_RESULTS),
    sourceItemCount: raw.offers.length,
    rejectedSellerSkuRows,
    invalidOfferRows,
    invalidMetricRows: [],
  };
}

function validateOfficialMonth(
  interval: OfficialMonthlyInterval,
): OfficialMonthlyInterval {
  const match = /^(\d{4})-(\d{2})$/.exec(interval.month);
  if (!match) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "月份必須使用 YYYY-MM。",
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || month < 1 || month > 12) {
    throw new ReplenishmentAuditError("REQUEST_INVALID", "月份無效。");
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const expectedStart = `${interval.month}-01T00:00:00Z`;
  // Replenishment TimeInterval canonicalizes a MONTH boundary to the last
  // calendar day at midnight UTC (not to the last second of that day).
  const expectedEnd = `${interval.month}-${String(lastDay).padStart(2, "0")}T00:00:00Z`;
  if (interval.startDate !== expectedStart || interval.endDate !== expectedEnd) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "月度 Replenishment 指標必須涵蓋一個完整 ISO calendar month。",
    );
  }
  return interval;
}

function exactMetricInterval(
  value: unknown,
  expected: OfficialMonthlyInterval,
): OfficialMonthlyInterval {
  const interval = record(value, "metric timeInterval");
  if (
    interval.startDate !== expected.startDate ||
    interval.endDate !== expected.endDate
  ) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "Amazon 調整或混入了不同的月度指標區間，已停止把它標成完整月份。",
    );
  }
  return expected;
}

function parseMetric(
  value: unknown,
  expectedMarketplace: SellerReplenishmentMarketplaceId,
  expectedCurrency: string,
  interval: OfficialMonthlyInterval,
  validatedSellerSku: string,
): OfficialMonthlyOfferMetric {
  const raw = record(value, "Subscribe & Save offer metric");
  // The official ListOfferMetricsResponseOffer model does not define
  // marketplaceId or programType on each row. The POST request fixes both
  // scopes; if Amazon does echo either field, it still has to match exactly.
  if (raw.marketplaceId !== undefined) {
    exactMarketplace(raw.marketplaceId, expectedMarketplace);
  }
  if (
    raw.programType !== undefined &&
    raw.programType !== "SUBSCRIBE_AND_SAVE"
  ) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "Replenishment metric 不是 Subscribe & Save。",
    );
  }
  if (raw.fulfillmentChannelType !== "AMAZON") {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "listOfferMetrics 回應含有非 Amazon fulfillment 資料。",
    );
  }
  const revenue = optionalNonNegativeNumber(
    raw.totalSubscriptionsRevenue,
    "subscription revenue",
  );
  const lostRevenue = optionalNonNegativeNumber(
    raw.lostRevenueDueToOOS,
    "lost revenue due to OOS",
  );
  const currencyCode =
    raw.currencyCode === undefined || raw.currencyCode === null
      ? null
      : exactCurrency(raw.currencyCode, expectedCurrency, "metric currency");
  if ((revenue !== null || lostRevenue !== null) && currencyCode === null) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "Amazon 回傳金額指標但缺少幣別。",
    );
  }
  return {
    marketplaceId: expectedMarketplace,
    sellerSku: validatedSellerSku,
    asin: asin(raw.asin),
    fulfillmentChannelType: "AMAZON",
    interval: exactMetricInterval(raw.timeInterval, interval),
    currencyCode,
    subscriptionRevenue: revenue,
    shippedSubscriptionUnits: optionalNonNegativeInteger(
      raw.shippedSubscriptionUnits,
      "shipped subscription units",
    ),
    activeSubscriptionsAtPeriodEnd: optionalNonNegativeInteger(
      raw.activeSubscriptions,
      "active subscriptions at period end",
    ),
    notDeliveredDueToOosPercent: optionalPercentage(
      raw.notDeliveredDueToOOS,
      "not delivered due to OOS",
    ),
    lostRevenueDueToOos: lostRevenue,
    revenuePenetrationPercent: optionalPercentage(
      raw.revenuePenetration,
      "revenue penetration",
    ),
    couponRevenuePenetrationPercent: optionalPercentage(
      raw.couponsRevenuePenetration,
      "coupon revenue penetration",
    ),
    shareOfCouponSubscriptionsPercent: optionalPercentage(
      raw.shareOfCouponSubscriptions,
      "share of coupon subscriptions",
    ),
  };
}

export function parseReplenishmentOfferMetricsPage(
  value: unknown,
  marketplaceId: string,
  interval: OfficialMonthlyInterval,
): ParsedPage<OfficialMonthlyOfferMetric> {
  const supported = marketplaceCurrency(marketplaceId);
  validateOfficialMonth(interval);
  const raw = record(value, "listOfferMetrics response");
  if (!Array.isArray(raw.offers) || raw.offers.length > METRIC_PAGE_SIZE) {
    throw new ReplenishmentAuditError(
      "RESPONSE_INVALID",
      "listOfferMetrics.offers 格式或頁面大小無效。",
    );
  }
  const items: OfficialMonthlyOfferMetric[] = [];
  const invalidMetricRows: ReplenishmentInvalidMetricRow[] = [];
  let rejectedSellerSkuRows = 0;
  for (const metric of raw.offers) {
    const candidate = record(metric, "Subscribe & Save offer metric");
    if (candidate.marketplaceId !== undefined) {
      exactMarketplace(candidate.marketplaceId, supported.marketplaceId);
    }
    if (
      candidate.programType !== undefined &&
      candidate.programType !== "SUBSCRIBE_AND_SAVE"
    ) {
      throw new ReplenishmentAuditError(
        "RESPONSE_INVALID",
        "Replenishment metric 不是 Subscribe & Save。",
      );
    }
    if (candidate.fulfillmentChannelType !== "AMAZON") {
      throw new ReplenishmentAuditError(
        "RESPONSE_INVALID",
        "listOfferMetrics 回應含有非 Amazon fulfillment 資料。",
      );
    }
    const sku = upstreamSellerSku(candidate.sku);
    if (sku === null) {
      rejectedSellerSkuRows += 1;
      continue;
    }
    try {
      items.push(
        parseMetric(
          candidate,
          supported.marketplaceId,
          supported.currencyCode,
          interval,
          sku,
        ),
      );
    } catch (error) {
      if (
        !(error instanceof ReplenishmentAuditError) ||
        error.code !== "RESPONSE_INVALID"
      ) {
        throw error;
      }
      invalidMetricRows.push({ sellerSku: sku, problem: error.message });
    }
  }
  return {
    items,
    totalResults: parsePagination(raw.pagination, MAX_METRIC_RESULTS),
    sourceItemCount: raw.offers.length,
    rejectedSellerSkuRows,
    invalidOfferRows: [],
    invalidMetricRows,
  };
}

function paginationInput(offset: number, limit: number): {
  offset: number;
  limit: number;
} {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_PAGE_OFFSET ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  ) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "Replenishment 分頁參數無效。",
    );
  }
  return { offset, limit };
}

export function buildReplenishmentOffersPageRequest(
  marketplaceId: string,
  offset: number,
): ReplenishmentPageRequest {
  const supported = marketplaceCurrency(marketplaceId);
  return {
    operation: "listOffers",
    path: REPLENISHMENT_OFFERS_PATH,
    offset,
    limit: OFFER_PAGE_SIZE,
    body: {
      pagination: paginationInput(offset, OFFER_PAGE_SIZE),
      filters: {
        marketplaceId: supported.marketplaceId,
        programTypes: ["SUBSCRIBE_AND_SAVE"],
      },
      sort: { order: "ASC", key: "ASIN" },
    },
  };
}

export function buildReplenishmentOfferMetricsPageRequest(
  marketplaceId: string,
  interval: OfficialMonthlyInterval,
  offset: number,
): ReplenishmentPageRequest {
  const supported = marketplaceCurrency(marketplaceId);
  const exactInterval = validateOfficialMonth(interval);
  return {
    operation: "listOfferMetrics",
    path: REPLENISHMENT_OFFER_METRICS_PATH,
    offset,
    limit: METRIC_PAGE_SIZE,
    body: {
      pagination: paginationInput(offset, METRIC_PAGE_SIZE),
      filters: {
        aggregationFrequency: "MONTH",
        timeInterval: {
          startDate: exactInterval.startDate,
          endDate: exactInterval.endDate,
        },
        timePeriodType: "PERFORMANCE",
        marketplaceId: supported.marketplaceId,
        programTypes: ["SUBSCRIBE_AND_SAVE"],
        fulfillmentChannelTypes: ["AMAZON"],
      },
      sort: { order: "DESC", key: "TOTAL_SUBSCRIPTIONS_REVENUE" },
    },
  };
}

function assertPageShape(
  pageLength: number,
  offset: number,
  pageSize: number,
  totalResults: number,
): void {
  const expectedLength = Math.min(pageSize, Math.max(0, totalResults - offset));
  if (pageLength !== expectedLength) {
    throw new ReplenishmentAuditError(
      "PAGINATION_CHANGED",
      "Amazon Replenishment 的 totalResults 與分頁內容不一致；資料可能在掃描期間改變，請重新同步。",
    );
  }
}

async function fetchAllPages<T>(input: {
  pageSize: number;
  maximumResults: number;
  request: (offset: number) => ReplenishmentPageRequest;
  parse: (value: unknown) => ParsedPage<T>;
  key: (item: T) => string;
  source: "OFFER" | "METRIC";
  metricMonth?: string;
  transport: ReplenishmentPageTransport;
}): Promise<FetchedPages<T>> {
  const acceptedBySku = new Map<string, T>();
  const seenRowsBySku = new Map<string, number>();
  const problemsBySku = new Map<string, FetchedPageProblem>();
  let expectedTotal: number | null = null;
  let sourceRows = 0;
  let rejectedSellerSkuRows = 0;
  const duplicateProblem = (sellerSkuValue: string, affectedRows: number) => ({
    sellerSku: sellerSkuValue,
    kind: "DUPLICATE" as const,
    source: input.source,
    metricMonth: input.source === "METRIC" ? input.metricMonth ?? null : null,
    affectedRows,
    problem: input.source === "OFFER"
      ? "Amazon Replenishment offers 分頁重複回傳此 Seller SKU；相同或衝突列均未採用。該 SKU 已單獨排除，其他商品仍繼續完成。"
      : `Amazon Replenishment 在 ${input.metricMonth ?? "所選月份"} 月度指標重複回傳此 Seller SKU；相同或衝突列均未採用，該月保持缺值，其他商品仍繼續完成。`,
  });
  const registerInvalidRow = (
    invalid: ReplenishmentInvalidOfferRow | ReplenishmentInvalidMetricRow,
  ) => {
    const seenRows = (seenRowsBySku.get(invalid.sellerSku) ?? 0) + 1;
    seenRowsBySku.set(invalid.sellerSku, seenRows);
    acceptedBySku.delete(invalid.sellerSku);
    if (seenRows > 1) {
      problemsBySku.set(
        invalid.sellerSku,
        duplicateProblem(invalid.sellerSku, seenRows),
      );
      return;
    }
    problemsBySku.set(invalid.sellerSku, {
      sellerSku: invalid.sellerSku,
      kind: input.source === "OFFER" ? "INVALID_OFFER" : "INVALID_METRIC",
      source: input.source,
      metricMonth: input.source === "METRIC" ? input.metricMonth ?? null : null,
      affectedRows: 1,
      problem: invalid.problem,
    });
  };
  const registerAcceptedItem = (item: T) => {
    const key = input.key(item);
    const seenRows = (seenRowsBySku.get(key) ?? 0) + 1;
    seenRowsBySku.set(key, seenRows);
    if (seenRows > 1) {
      acceptedBySku.delete(key);
      problemsBySku.set(key, duplicateProblem(key, seenRows));
      return;
    }
    acceptedBySku.set(key, item);
  };
  for (let offset = 0; ; offset += input.pageSize) {
    if (offset > MAX_PAGE_OFFSET) {
      throw new ReplenishmentAuditError(
        "PAGINATION_LIMIT_EXCEEDED",
        `Amazon 公開 Replenishment offset 無法完整讀取超過 ${input.maximumResults} 筆資料。`,
      );
    }
    const request = input.request(offset);
    const page = input.parse(await input.transport(request));
    if (expectedTotal === null) expectedTotal = page.totalResults;
    else if (page.totalResults !== expectedTotal) {
      throw new ReplenishmentAuditError(
        "PAGINATION_CHANGED",
        "Amazon Replenishment 的 totalResults 在掃描期間改變，請重新同步。",
      );
    }
    assertPageShape(
      page.sourceItemCount,
      offset,
      input.pageSize,
      expectedTotal,
    );
    sourceRows += page.sourceItemCount;
    rejectedSellerSkuRows += page.rejectedSellerSkuRows;
    const invalidRows = input.source === "OFFER"
      ? page.invalidOfferRows
      : page.invalidMetricRows;
    for (const invalid of invalidRows) registerInvalidRow(invalid);
    for (const item of page.items) registerAcceptedItem(item);
    if (sourceRows === expectedTotal) {
      const problems = [...problemsBySku.values()].sort((left, right) =>
        left.sellerSku.localeCompare(right.sellerSku));
      return {
        items: [...acceptedBySku.values()],
        sourceRows,
        rejectedSellerSkuRows,
        invalidOfferRows: problems
          .filter((problem) => problem.kind === "INVALID_OFFER")
          .map(({ sellerSku: sellerSkuValue, problem }) => ({
            sellerSku: sellerSkuValue,
            problem,
          })),
        problems,
      };
    }
  }
}

function validateKnownFbaSkus(value: ReadonlySet<string> | undefined): void {
  if (!value) return;
  for (const sku of value) text(sku, "FBA Inventory Seller SKU", 256);
}

function problemSummary(parts: readonly string[]): string {
  const suffix = "其他商品仍已繼續完成；未補 0、未雙重加總。";
  const details = parts.join(" ");
  const complete = details ? `${details} ${suffix}` : suffix;
  if (complete.length <= 2_000) return complete;
  const budget = 2_000 - suffix.length - 3;
  return `${details.slice(0, Math.max(0, budget))}… ${suffix}`;
}

function upstreamCoverage(
  offers: FetchedPages<CurrentSubscriptionOffer>,
  metrics: {
    sourceRows: number;
    rejectedSellerSkuRows: number;
    acceptedRows: number;
    problems: FetchedPageProblem[];
  },
  intervalCount: number,
  knownFbaSkus: ReadonlySet<string> | undefined,
): ReplenishmentUpstreamCoverage {
  const rejectedSellerSkuRows =
    offers.rejectedSellerSkuRows + metrics.rejectedSellerSkuRows;
  const grouped = new Map<string, {
    affectedOfferRows: number;
    affectedMetricRows: number;
    metricMonths: Set<string>;
    invalidOfferProblems: Set<string>;
    invalidMetricProblems: Map<string, Set<string>>;
    duplicateOffer: boolean;
    duplicateMetricMonths: Set<string>;
  }>();
  for (const problem of [...offers.problems, ...metrics.problems]) {
    const current = grouped.get(problem.sellerSku) ?? {
      affectedOfferRows: 0,
      affectedMetricRows: 0,
      metricMonths: new Set<string>(),
      invalidOfferProblems: new Set<string>(),
      invalidMetricProblems: new Map<string, Set<string>>(),
      duplicateOffer: false,
      duplicateMetricMonths: new Set<string>(),
    };
    if (problem.source === "OFFER") {
      current.affectedOfferRows += problem.affectedRows;
      if (problem.kind === "INVALID_OFFER") {
        current.invalidOfferProblems.add(problem.problem);
      } else {
        current.duplicateOffer = true;
      }
    } else {
      current.affectedMetricRows += problem.affectedRows;
      if (problem.metricMonth) {
        current.metricMonths.add(problem.metricMonth);
        if (problem.kind === "INVALID_METRIC") {
          const messages = current.invalidMetricProblems.get(problem.metricMonth) ??
            new Set<string>();
          messages.add(problem.problem);
          current.invalidMetricProblems.set(problem.metricMonth, messages);
        } else {
          current.duplicateMetricMonths.add(problem.metricMonth);
        }
      }
    }
    grouped.set(problem.sellerSku, current);
  }
  const allProblemSkuRows = [...grouped.entries()]
    .map(([sellerSkuValue, problem]) => {
      const parts: string[] = [];
      if (problem.invalidOfferProblems.size > 0) {
        parts.push(
          `Amazon Replenishment offer 資料無法安全解析：${[...problem.invalidOfferProblems].join("；")}`,
        );
      }
      if (problem.duplicateOffer) {
        parts.push(
          "Amazon Replenishment offers 分頁重複回傳此 Seller SKU；相同或衝突列均未採用，該 SKU 已單獨排除。",
        );
      }
      const metricMonths = [...problem.metricMonths].sort();
      const invalidMetricMonths = [...problem.invalidMetricProblems.keys()].sort();
      if (invalidMetricMonths.length > 0) {
        parts.push(...invalidMetricMonths.map((month) =>
          `Amazon Replenishment 月度指標於 ${month} 資料無法安全解析：${[
            ...(problem.invalidMetricProblems.get(month) ?? []),
          ].join("；")}`));
      }
      const duplicateMetricMonths = [...problem.duplicateMetricMonths].sort();
      if (duplicateMetricMonths.length > 0) {
        parts.push(
          `Amazon Replenishment 月度指標於 ${duplicateMetricMonths.join("、")} 重複回傳此 Seller SKU；相同或衝突列均未採用，對應月份保持缺值。`,
        );
      }
      return {
        sellerSku: sellerSkuValue,
        affectedOfferRows: problem.affectedOfferRows,
        affectedMetricRows: problem.affectedMetricRows,
        metricMonths,
        problem: problemSummary(parts),
      };
    })
    .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku));
  const problemSkuRows: ReplenishmentProblemSkuRow[] = allProblemSkuRows
    .filter(({ sellerSku: sellerSkuValue }) => knownFbaSkus?.has(sellerSkuValue))
    .map((problem) => ({
      ...problem,
      fbaEvidence: "CURRENT_FBA_SKU_SET" as const,
    }));
  const unprovenProblemRows = allProblemSkuRows.filter(
    ({ sellerSku: sellerSkuValue }) => !knownFbaSkus?.has(sellerSkuValue),
  );
  const unprovenExactSkuProblems: ReplenishmentUnprovenProblemSummary = {
    exactSkuCount: unprovenProblemRows.length,
    affectedOfferRows: unprovenProblemRows.reduce(
      (sum, problem) => sum + problem.affectedOfferRows,
      0,
    ),
    affectedMetricRows: unprovenProblemRows.reduce(
      (sum, problem) => sum + problem.affectedMetricRows,
      0,
    ),
    minimumUnresolvedOfferMonths: unprovenProblemRows.reduce(
      (sum, problem) => sum + (problem.affectedOfferRows > 0
        ? intervalCount
        : problem.metricMonths.length),
      0,
    ),
  };
  const invalidOfferRows = offers.invalidOfferRows
    .filter(({ sellerSku: sellerSkuValue }) => knownFbaSkus?.has(sellerSkuValue))
    .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku));
  const exactProblemOfferMonths = allProblemSkuRows.reduce(
    (sum, problem) => sum + (problem.affectedOfferRows > 0
      ? intervalCount
      : problem.metricMonths.length),
    0,
  );
  const minimumUnresolvedOfferMonths = Math.max(
    exactProblemOfferMonths,
    offers.rejectedSellerSkuRows * intervalCount,
    metrics.rejectedSellerSkuRows,
  );
  const incompleteRows = rejectedSellerSkuRows + allProblemSkuRows.length;
  return {
    status: incompleteRows === 0 ? "complete" : "partial",
    returnedOfferRows: offers.sourceRows,
    acceptedOfferRows: offers.items.length,
    returnedMetricRows: metrics.sourceRows,
    acceptedMetricRows: metrics.acceptedRows,
    invalidOfferRows,
    problemSkuRows,
    unprovenExactSkuProblems,
    rejectedSellerSkuRows,
    minimumUnresolvedOfferMonths,
    notice: incompleteRows === 0
      ? "Amazon Replenishment 回應中的 Seller SKU 均可原樣核對。"
      : `Amazon Replenishment 有 ${rejectedSellerSkuRows} 列未提供可原樣核對的 Seller SKU；${problemSkuRows.length} 個具同次 CURRENT_FBA 證據的精確問題 SKU 已逐 SKU 隔離，另有 ${unprovenExactSkuProblems.exactSkuCount} 個精確問題 SKU 缺少同次 CURRENT_FBA 證據，因此只計數、不輸出 identifier。至少 ${minimumUnresolvedOfferMonths} 個 SKU 月份無法核對，且實際缺口無法精確計算。其他商品仍已繼續完成；整體範圍保持不完整，未接受別名、trim、改寫 identifier、重複加總或用 0 代替錯誤值。`,
  };
}

export async function fetchFbaSubscriptionAudit(input: {
  marketplaceId: string;
  metricInterval: OfficialMonthlyInterval;
  transport: ReplenishmentPageTransport;
  knownFbaSkus?: ReadonlySet<string>;
  now?: Date;
}): Promise<FbaSubscriptionAuditSnapshot> {
  const supported = marketplaceCurrency(input.marketplaceId);
  const metricInterval = validateOfficialMonth(input.metricInterval);
  assertOfficialMonthlyIntervalAvailable(metricInterval, input.now);
  validateKnownFbaSkus(input.knownFbaSkus);
  const [currentPages, metricPages] = await Promise.all([
    fetchAllPages({
      pageSize: OFFER_PAGE_SIZE,
      maximumResults: MAX_OFFER_RESULTS,
      request: (offset) =>
        buildReplenishmentOffersPageRequest(supported.marketplaceId, offset),
      parse: (value) =>
        parseReplenishmentOffersPage(value, supported.marketplaceId),
      key: (offer) => offer.sellerSku,
      source: "OFFER",
      transport: input.transport,
    }),
    fetchAllPages({
      pageSize: METRIC_PAGE_SIZE,
      maximumResults: MAX_METRIC_RESULTS,
      request: (offset) =>
        buildReplenishmentOfferMetricsPageRequest(
          supported.marketplaceId,
          metricInterval,
          offset,
        ),
      parse: (value) =>
        parseReplenishmentOfferMetricsPage(
          value,
          supported.marketplaceId,
          metricInterval,
        ),
      key: (metric) => metric.sellerSku,
      source: "METRIC",
      metricMonth: metricInterval.month,
      transport: input.transport,
    }),
  ]);
  const currentOffers = currentPages.items;
  const metrics = metricPages.items;
  const sourceCoverage = upstreamCoverage(
    currentPages,
    {
      sourceRows: metricPages.sourceRows,
      rejectedSellerSkuRows: metricPages.rejectedSellerSkuRows,
      acceptedRows: metricPages.items.length,
      problems: metricPages.problems,
    },
    1,
    input.knownFbaSkus,
  );
  const metricBySku = new Map(metrics.map((metric) => [metric.sellerSku, metric]));
  const offerBySku = new Map(
    currentOffers.map((offer) => [offer.sellerSku, offer]),
  );
  const offers: FbaSubscriptionAuditRow[] = [];
  const excluded: ReplenishmentAuditExclusion[] = [];
  for (const offer of currentOffers) {
    const metric = metricBySku.get(offer.sellerSku) ?? null;
    const currentFba = input.knownFbaSkus?.has(offer.sellerSku) ?? false;
    if (!currentFba) {
      continue;
    }
    if (metric && metric.asin !== offer.asin) {
      excluded.push({
        sellerSku: offer.sellerSku,
        fbaEvidence: "CURRENT_FBA_SKU_SET",
        reason: "ASIN_MISMATCH",
      });
      continue;
    }
    offers.push({
      ...offer,
      fbaEvidence: "CURRENT_FBA_SKU_SET",
      monthlyPerformance: metric,
    });
  }
  for (const metric of metrics) {
    if (!offerBySku.has(metric.sellerSku)) {
      if (!input.knownFbaSkus?.has(metric.sellerSku)) continue;
      excluded.push({
        sellerSku: metric.sellerSku,
        fbaEvidence: "CURRENT_FBA_SKU_SET",
        reason: "METRIC_WITHOUT_CURRENT_OFFER",
      });
    }
  }
  const revenueRows = offers
    .map((offer) => offer.monthlyPerformance)
    .filter(
      (metric): metric is OfficialMonthlyOfferMetric =>
        metric !== null && metric.subscriptionRevenue !== null,
    );
  const revenueCoverage = subscriptionRevenueCoverage(
    offers.length,
    revenueRows.length,
    sourceCoverage.status === "partial" ||
      (input.knownFbaSkus !== undefined && offers.length !== input.knownFbaSkus.size),
  );
  return {
    marketplaceId: supported.marketplaceId,
    metricInterval,
    offers: offers.sort((left, right) =>
      left.sellerSku.localeCompare(right.sellerSku),
    ),
    excluded: excluded.sort((left, right) =>
      left.sellerSku.localeCompare(right.sellerSku),
    ),
    upstreamCoverage: sourceCoverage,
    summary: {
      currentActiveSubscriptions: offers.reduce(
        (sum, offer) => sum + offer.currentActiveSubscriptions,
        0,
      ),
      provenSubscriptionRevenue: revenueCoverage.status === "complete"
        ? revenueRows.reduce(
            (sum, metric) => sum + (metric.subscriptionRevenue ?? 0),
            0,
          )
        : null,
      revenueCurrencyCode:
        revenueCoverage.status === "complete" ? supported.currencyCode : null,
      revenueCoverage,
    },
    historyCapability: {
      supportsSinceEnrollmentMonthlySeries: false,
      maximumOfficialLookbackMonths: MAX_MONTHLY_HISTORY,
      replacement: "REQUESTED_COMPLETE_CALENDAR_MONTHS",
      notice:
        "Amazon 公開 API 沒有 offer 加入日起的無限月度訂閱序列；只能逐月請求精確落在近兩年內的完整月 PERFORMANCE。因當月尚未完成，安全上限是 23 個完整月。activeSubscriptions 是期末快照，revenue 與 shipped units 是該月指標，缺月不得補值。",
    },
  };
}

/**
 * Fetches the whole current offer catalogue exactly once, then reads each
 * requested complete month. Current FBA proof is independent and mandatory;
 * a historical AMAZON metric never promotes an unproven current SKU to FBA.
 */
export async function fetchFbaSubscriptionAuditHistory(input: {
  marketplaceId: string;
  metricIntervals: readonly OfficialMonthlyInterval[];
  transport: ReplenishmentPageTransport;
  knownFbaSkus: ReadonlySet<string>;
  knownFbaSkuCoverage?: "complete" | "partial";
  now?: Date;
}): Promise<FbaSubscriptionAuditHistorySnapshot> {
  const supported = marketplaceCurrency(input.marketplaceId);
  validateKnownFbaSkus(input.knownFbaSkus);
  if (
    input.knownFbaSkuCoverage !== undefined &&
    input.knownFbaSkuCoverage !== "complete" &&
    input.knownFbaSkuCoverage !== "partial"
  ) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "FBA Inventory Seller SKU 覆蓋狀態無法辨識。",
    );
  }
  const inventoryCoverageIncomplete =
    input.knownFbaSkuCoverage === "partial";
  if (
    !Array.isArray(input.metricIntervals) ||
    input.metricIntervals.length < 1 ||
    input.metricIntervals.length > MAX_MONTHLY_HISTORY
  ) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      `月度健檢只能包含 1 到 ${MAX_MONTHLY_HISTORY} 個完整月份。`,
    );
  }
  const intervals = input.metricIntervals.map((interval) => {
    const exact = validateOfficialMonth(interval);
    assertOfficialMonthlyIntervalAvailable(exact, input.now);
    return exact;
  });
  if (
    new Set(intervals.map(({ month }) => month)).size !== intervals.length ||
    intervals.some(
      (interval, index) => index > 0 && interval.month <= intervals[index - 1]!.month,
    )
  ) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "月度健檢月份必須不重複並依時間由舊到新排列。",
    );
  }

  const currentPages = await fetchAllPages({
    pageSize: OFFER_PAGE_SIZE,
    maximumResults: MAX_OFFER_RESULTS,
    request: (offset) =>
      buildReplenishmentOffersPageRequest(supported.marketplaceId, offset),
    parse: (value) =>
      parseReplenishmentOffersPage(value, supported.marketplaceId),
    key: (offer) => offer.sellerSku,
    source: "OFFER",
    transport: input.transport,
  });
  const currentOffers = currentPages.items;
  const metricsByMonth = new Map<string, OfficialMonthlyOfferMetric[]>();
  const rejectedMetricsByMonth = new Map<string, number>();
  const problemMetricsByMonth = new Map<string, number>();
  const metricProblems: FetchedPageProblem[] = [];
  let metricSourceRows = 0;
  let metricRejectedSellerSkuRows = 0;
  let metricAcceptedRows = 0;
  // Deliberately sequential: the public API rate is low and this read path has
  // no automatic retry. A failed month fails the snapshot rather than silently
  // displaying a partial result as a complete requested period.
  for (const interval of intervals) {
    const metricPages = await fetchAllPages({
      pageSize: METRIC_PAGE_SIZE,
      maximumResults: MAX_METRIC_RESULTS,
      request: (offset) =>
        buildReplenishmentOfferMetricsPageRequest(
          supported.marketplaceId,
          interval,
          offset,
        ),
      parse: (value) =>
        parseReplenishmentOfferMetricsPage(
          value,
          supported.marketplaceId,
          interval,
        ),
      key: (metric) => metric.sellerSku,
      source: "METRIC",
      metricMonth: interval.month,
      transport: input.transport,
    });
    metricsByMonth.set(interval.month, metricPages.items);
    rejectedMetricsByMonth.set(
      interval.month,
      metricPages.rejectedSellerSkuRows,
    );
    problemMetricsByMonth.set(interval.month, metricPages.problems.length);
    metricProblems.push(...metricPages.problems);
    metricSourceRows += metricPages.sourceRows;
    metricRejectedSellerSkuRows += metricPages.rejectedSellerSkuRows;
    metricAcceptedRows += metricPages.items.length;
  }
  const sourceCoverage = upstreamCoverage(
    currentPages,
    {
      sourceRows: metricSourceRows,
      rejectedSellerSkuRows: metricRejectedSellerSkuRows,
      acceptedRows: metricAcceptedRows,
      problems: metricProblems,
    },
    intervals.length,
    input.knownFbaSkus,
  );

  const offerBySku = new Map(currentOffers.map((offer) => [offer.sellerSku, offer]));
  const excluded: ReplenishmentAuditExclusion[] = [];
  const excludedKeys = new Set<string>();
  const exclude = (sellerSkuValue: string, reason: ReplenishmentAuditExclusion["reason"]) => {
    const key = `${sellerSkuValue}\0${reason}`;
    if (excludedKeys.has(key)) return;
    excludedKeys.add(key);
    excluded.push({
      sellerSku: sellerSkuValue,
      fbaEvidence: "CURRENT_FBA_SKU_SET",
      reason,
    });
  };
  const metricsBySku = new Map<string, OfficialMonthlyOfferMetric[]>();
  for (const metrics of metricsByMonth.values()) {
    for (const metric of metrics) {
      const offer = offerBySku.get(metric.sellerSku);
      if (!offer) {
        if (!input.knownFbaSkus.has(metric.sellerSku)) continue;
        exclude(metric.sellerSku, "METRIC_WITHOUT_CURRENT_OFFER");
        continue;
      }
      if (metric.asin !== offer.asin) {
        if (!input.knownFbaSkus.has(metric.sellerSku)) continue;
        exclude(metric.sellerSku, "ASIN_MISMATCH");
        continue;
      }
      const existing = metricsBySku.get(metric.sellerSku) ?? [];
      existing.push(metric);
      metricsBySku.set(metric.sellerSku, existing);
    }
  }
  const offers: FbaSubscriptionAuditHistoryRow[] = [];
  for (const offer of currentOffers) {
    if (!input.knownFbaSkus.has(offer.sellerSku)) {
      continue;
    }
    offers.push({
      ...offer,
      fbaEvidence: "CURRENT_FBA_SKU_SET",
      monthlySeries: (metricsBySku.get(offer.sellerSku) ?? []).sort((left, right) =>
        left.interval.month.localeCompare(right.interval.month),
      ),
    });
  }
  offers.sort((left, right) => left.sellerSku.localeCompare(right.sellerSku));
  excluded.sort((left, right) => left.sellerSku.localeCompare(right.sellerSku));

  const monthly = intervals.map((interval) => {
    const metrics = offers.flatMap((offer) =>
      offer.monthlySeries.filter((metric) => metric.interval.month === interval.month),
    );
    const revenue = metrics
      .map((metric) => metric.subscriptionRevenue)
      .filter((value): value is number => value !== null);
    const shipped = metrics
      .map((metric) => metric.shippedSubscriptionUnits)
      .filter((value): value is number => value !== null);
    const active = metrics
      .map((metric) => metric.activeSubscriptionsAtPeriodEnd)
      .filter((value): value is number => value !== null);
    const revenueCoverage = subscriptionRevenueCoverage(
      offers.length,
      revenue.length,
      inventoryCoverageIncomplete ||
        currentPages.rejectedSellerSkuRows > 0 ||
        currentPages.problems.length > 0 ||
        (rejectedMetricsByMonth.get(interval.month) ?? 0) > 0 ||
        (problemMetricsByMonth.get(interval.month) ?? 0) > 0 ||
        offers.length !== input.knownFbaSkus.size,
    );
    return {
      month: interval.month,
      provenSubscriptionRevenue: revenueCoverage.status === "complete"
        ? revenue.reduce((sum, value) => sum + value, 0)
        : null,
      revenueCoverage,
      shippedSubscriptionUnits: shipped.length
        ? shipped.reduce((sum, value) => sum + value, 0)
        : null,
      activeSubscriptionsAtPeriodEnd: active.length
        ? active.reduce((sum, value) => sum + value, 0)
        : null,
    };
  });
  const revenueCoverage = subscriptionRevenueCoverage(
    offers.length * intervals.length,
    monthly.reduce(
      (sum, month) => sum + month.revenueCoverage.reportedOfferMonths,
      0,
    ),
    inventoryCoverageIncomplete ||
      sourceCoverage.status === "partial" ||
      offers.length !== input.knownFbaSkus.size,
  );
  return {
    marketplaceId: supported.marketplaceId,
    intervals: intervals.map((interval) => ({ ...interval })),
    offers,
    excluded,
    upstreamCoverage: sourceCoverage,
    summary: {
      currentActiveSubscriptions: offers.reduce(
        (sum, offer) => sum + offer.currentActiveSubscriptions,
        0,
      ),
      provenSubscriptionRevenue: revenueCoverage.status === "complete"
        ? monthly.reduce(
            (sum, month) => sum + (month.provenSubscriptionRevenue ?? 0),
            0,
          )
        : null,
      revenueCurrencyCode:
        revenueCoverage.status === "complete" ? supported.currencyCode : null,
      revenueCoverage,
      monthly,
    },
    historyCapability: {
      supportsSinceEnrollmentMonthlySeries: false,
      maximumOfficialLookbackMonths: MAX_MONTHLY_HISTORY,
      replacement: "REQUESTED_COMPLETE_CALENDAR_MONTHS",
      notice:
        "Amazon 公開 API 沒有 offer 加入日起的無限月度訂閱序列；只能逐月請求精確落在近兩年內的完整月 PERFORMANCE。因當月尚未完成，安全上限是 23 個完整月。activeSubscriptions 是期末快照，revenue 與 shipped units 是該月指標，缺月不得補值。",
    },
  };
}

export function officialCompleteMonthlyIntervals(
  count: number,
  now = new Date(),
): OfficialMonthlyInterval[] {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_MONTHLY_HISTORY ||
    Number.isNaN(now.getTime())
  ) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      `官方近兩年的月度替代資料只能選擇最近 1 到 ${MAX_MONTHLY_HISTORY} 個完整月份。`,
    );
  }
  const intervals = Array.from({ length: count }, (_, index) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - index, 1),
    );
    const year = date.getUTCFullYear();
    const monthNumber = date.getUTCMonth() + 1;
    const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
      month,
      startDate: `${month}-01T00:00:00Z`,
      endDate: `${month}-${String(lastDay).padStart(2, "0")}T00:00:00Z`,
    };
  }).reverse();
  for (const interval of intervals) {
    assertOfficialMonthlyIntervalAvailable(interval, now);
  }
  return intervals;
}

export function assertOfficialMonthlyIntervalAvailable(
  interval: OfficialMonthlyInterval,
  now = new Date(),
): void {
  const exact = validateOfficialMonth(interval);
  if (Number.isNaN(now.getTime())) {
    throw new ReplenishmentAuditError("REQUEST_INVALID", "now 無效。");
  }
  const horizon = new Date(now.getTime());
  horizon.setUTCFullYear(horizon.getUTCFullYear() - 2);
  const start = new Date(exact.startDate);
  const end = new Date(exact.endDate);
  if (start < horizon || end >= now) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "完整月指標必須已結束，且月初不得早於 Amazon 近兩年的精確開始時間。",
    );
  }
}

export function subscriptionAuditDiscountBucket(
  value: number | null,
): SubscriptionAuditDiscountBucket | null {
  return SUBSCRIPTION_AUDIT_DISCOUNT_BUCKETS.find((bucket) => bucket === value) ?? null;
}

export function assertReplenishmentRequestBody(
  request: ReplenishmentPageRequest,
): void {
  // Small exported assertion for route integration tests: it proves that a
  // caller did not mutate the fixed path, program, marketplace or FBA filter.
  const body = requestRecord(request.body, "Replenishment request body");
  const filters = requestRecord(body.filters, "Replenishment filters");
  if (
    !Array.isArray(filters.programTypes) ||
    filters.programTypes.length !== 1 ||
    filters.programTypes[0] !== "SUBSCRIBE_AND_SAVE"
  ) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "Replenishment request 必須固定為 SUBSCRIBE_AND_SAVE。",
    );
  }
  if (filters.marketplaceId !== marketplaceCurrency(String(filters.marketplaceId)).marketplaceId) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "Replenishment request 站點無效。",
    );
  }
  let expected: ReplenishmentPageRequest;
  if (request.operation === "listOfferMetrics") {
    if (
      request.path !== REPLENISHMENT_OFFER_METRICS_PATH ||
      !Array.isArray(filters.fulfillmentChannelTypes) ||
      filters.fulfillmentChannelTypes.length !== 1 ||
      filters.fulfillmentChannelTypes[0] !== "AMAZON"
    ) {
      throw new ReplenishmentAuditError(
        "REQUEST_INVALID",
        "listOfferMetrics 必須固定為 Amazon fulfillment。",
      );
    }
    const timeInterval = requestRecord(
      filters.timeInterval,
      "Replenishment metric timeInterval",
    );
    const startDate = String(timeInterval.startDate ?? "");
    const endDate = String(timeInterval.endDate ?? "");
    expected = buildReplenishmentOfferMetricsPageRequest(
      String(filters.marketplaceId),
      { month: startDate.slice(0, 7), startDate, endDate },
      request.offset,
    );
  } else if (request.operation === "listOffers") {
    if (request.path !== REPLENISHMENT_OFFERS_PATH) {
      throw new ReplenishmentAuditError(
        "REQUEST_INVALID",
        "listOffers path 不在白名單。",
      );
    }
    expected = buildReplenishmentOffersPageRequest(
      String(filters.marketplaceId),
      request.offset,
    );
  } else {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "Replenishment operation 不在白名單。",
    );
  }
  if (JSON.stringify(request) !== JSON.stringify(expected)) {
    throw new ReplenishmentAuditError(
      "REQUEST_INVALID",
      "Replenishment request 必須完全由 allowlisted request builder 建立。",
    );
  }
}
