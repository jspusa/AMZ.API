import { describe, expect, it } from "vitest";
import {
  ReplenishmentAuditError,
  REPLENISHMENT_PUBLIC_CAPABILITY,
  assertOfficialMonthlyIntervalAvailable,
  assertReplenishmentRequestBody,
  buildReplenishmentOfferMetricsPageRequest,
  buildReplenishmentOffersPageRequest,
  fetchFbaSubscriptionAudit,
  fetchFbaSubscriptionAuditHistory,
  officialCompleteMonthlyIntervals,
  parseReplenishmentOfferMetricsPage,
  parseReplenishmentOffersPage,
  subscriptionAuditDiscountBucket,
  type OfficialMonthlyInterval,
  type ReplenishmentPageRequest,
} from "../src/main/amazon/replenishment-audit";

const US = "ATVPDKIKX0DER";
const MONTH: OfficialMonthlyInterval = {
  month: "2026-07",
  startDate: "2026-07-01T00:00:00Z",
  endDate: "2026-07-31T23:59:59Z",
};
const NOW = new Date("2026-08-08T12:00:00Z");

function sku(index: number): string {
  return `SNS-${String(index).padStart(4, "0")}`;
}

function asin(index: number): string {
  return `B${String(index).padStart(9, "0")}`;
}

function offer(index: number, overrides: Record<string, unknown> = {}) {
  return {
    marketplaceId: US,
    programType: "SUBSCRIBE_AND_SAVE",
    sku: sku(index),
    asin: asin(index),
    eligibility: "ELIGIBLE",
    price: 17.99,
    priceCurrencyCode: "USD",
    subscriptions: index,
    inventory: 100,
    offerProgramConfiguration: {
      enrollmentMethod: "MANUAL",
      preferences: { autoEnrollment: "OPTED_IN" },
      promotions: {
        sellingPartnerFundedBaseDiscount: { percentage: 5 },
        sellingPartnerFundedTieredDiscount: { percentage: 10 },
      },
    },
    forecastDeliveries: {
      next15DaysDeliveries: 1,
      next30DaysDeliveries: 2,
      next60DaysDeliveries: 3,
      next90DaysDeliveries: 4,
    },
    ...overrides,
  };
}

function metric(index: number, overrides: Record<string, unknown> = {}) {
  return {
    marketplaceId: US,
    programType: "SUBSCRIBE_AND_SAVE",
    sku: sku(index),
    asin: asin(index),
    fulfillmentChannelType: "AMAZON",
    timeInterval: {
      startDate: MONTH.startDate,
      endDate: MONTH.endDate,
    },
    currencyCode: "USD",
    totalSubscriptionsRevenue: index + 0.5,
    shippedSubscriptionUnits: index,
    activeSubscriptions: index + 1,
    notDeliveredDueToOOS: 1.5,
    lostRevenueDueToOOS: 2.5,
    ...overrides,
  };
}

function page(offers: unknown[], totalResults = offers.length) {
  return { offers, pagination: { totalResults } };
}

describe("official Replenishment FBA Subscribe & Save audit", () => {
  it("records the current roles and refuses the removed legacy S&S reports", () => {
    expect(REPLENISHMENT_PUBLIC_CAPABILITY.rolesAnyOf).toEqual([
      "Brand Analytics",
      "Inventory and Order Tracking",
    ]);
    expect(REPLENISHMENT_PUBLIC_CAPABILITY.removedReportTypes).toMatchObject({
      reportTypes: [
        "GET_FBA_SNS_FORECAST_DATA",
        "GET_FBA_SNS_PERFORMANCE_DATA",
      ],
      removedOn: "2025-12-11",
      allMarketplaces: true,
      replacement: "Replenishment v2022-11-07",
    });
  });

  it("pins the public operations, S&S program and AMAZON fulfillment filter", () => {
    const current = buildReplenishmentOffersPageRequest(US, 0);
    const history = buildReplenishmentOfferMetricsPageRequest(US, MONTH, 0);
    expect(current.path).toBe("/replenishment/2022-11-07/offers/search");
    expect(history.path).toBe(
      "/replenishment/2022-11-07/offers/metrics/search",
    );
    expect(history.body).toMatchObject({
      filters: {
        programTypes: ["SUBSCRIBE_AND_SAVE"],
        fulfillmentChannelTypes: ["AMAZON"],
        aggregationFrequency: "MONTH",
        timePeriodType: "PERFORMANCE",
      },
    });
    expect(() => assertReplenishmentRequestBody(current)).not.toThrow();
    expect(() => assertReplenishmentRequestBody(history)).not.toThrow();
    expect(() => buildReplenishmentOffersPageRequest("A39IBJ37TRP1C6", 0)).toThrow(
      ReplenishmentAuditError,
    );
  });

  it("strictly parses the current offer fields needed by the audit", () => {
    const parsed = parseReplenishmentOffersPage(page([offer(1)]), US);
    expect(parsed.items[0]).toMatchObject({
      sellerSku: "SNS-0001",
      asin: "B000000001",
      currentActiveSubscriptions: 1,
      price: { amount: 17.99, currencyCode: "USD" },
      sellerFundedBaseDiscount: 5,
      sellerFundedTieredDiscount: 10,
      forecastDeliveries: { next90Days: 4 },
    });
    expect(() =>
      parseReplenishmentOffersPage(
        page([offer(1, { priceCurrencyCode: "CAD" })]),
        US,
      ),
    ).toThrow(/currency/u);
    expect(() =>
      parseReplenishmentOffersPage(
        page([offer(1, { subscriptions: 1.2 })]),
        US,
      ),
    ).toThrow(/整數/u);
  });

  it("accepts only exact complete-month AMAZON performance rows", () => {
    const parsed = parseReplenishmentOfferMetricsPage(page([metric(1)]), US, MONTH);
    expect(parsed.items[0]).toMatchObject({
      fulfillmentChannelType: "AMAZON",
      subscriptionRevenue: 1.5,
      shippedSubscriptionUnits: 1,
      activeSubscriptionsAtPeriodEnd: 2,
      currencyCode: "USD",
    });
    expect(() =>
      parseReplenishmentOfferMetricsPage(
        page([metric(1, { fulfillmentChannelType: "MERCHANT" })]),
        US,
        MONTH,
      ),
    ).toThrow(/非 Amazon fulfillment/u);
    expect(() =>
      parseReplenishmentOfferMetricsPage(
        page([
          metric(1, {
            timeInterval: {
              startDate: MONTH.startDate,
              endDate: "2026-07-30T23:59:59Z",
            },
          }),
        ]),
        US,
        MONTH,
      ),
    ).toThrow(/完整月份/u);
    expect(() =>
      parseReplenishmentOfferMetricsPage(
        page([metric(1, { marketplaceId: "A2EUQ1WTGCTBG2" })]),
        US,
        MONTH,
      ),
    ).toThrow(/混入其他站點/u);
    expect(() =>
      parseReplenishmentOfferMetricsPage(
        page([metric(1, { programType: "UNKNOWN_PROGRAM" })]),
        US,
        MONTH,
      ),
    ).toThrow(/不是 Subscribe & Save/u);
  });

  it("paginates all offers and refuses to call an unproven offer FBA", async () => {
    const offerRows = Array.from({ length: 101 }, (_, index) => offer(index + 1));
    const metricRows = Array.from({ length: 100 }, (_, index) => metric(index + 1));
    const requests: ReplenishmentPageRequest[] = [];
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set(metricRows.map((row) => String(row.sku))),
      transport: async (request) => {
        requests.push(request);
        if (request.operation === "listOffers") {
          return page(
            offerRows.slice(request.offset, request.offset + request.limit),
            offerRows.length,
          );
        }
        return page(
          metricRows.slice(request.offset, request.offset + request.limit),
          metricRows.length,
        );
      },
    });
    expect(
      requests
        .filter((request) => request.operation === "listOffers")
        .map((request) => request.offset),
    ).toEqual([0, 100]);
    expect(snapshot.offers).toHaveLength(100);
    expect(snapshot.excluded).toContainEqual({
      sellerSku: "SNS-0101",
      reason: "FBA_NOT_PROVEN",
    });
    expect(snapshot.summary).toEqual({
      currentActiveSubscriptions: 5_050,
      provenSubscriptionRevenue: 5_100,
      revenueCurrencyCode: "USD",
      revenueCoverage: {
        status: "complete",
        expectedOfferMonths: 100,
        reportedOfferMonths: 100,
      },
    });
  });

  it("allows independent FBA proof but never invents missing monthly revenue", async () => {
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set([sku(1)]),
      transport: async (request) =>
        request.operation === "listOffers" ? page([offer(1)]) : page([]),
    });
    expect(snapshot.offers[0]).toMatchObject({
      fbaEvidence: "CURRENT_FBA_SKU_SET",
      monthlyPerformance: null,
    });
    expect(snapshot.summary.provenSubscriptionRevenue).toBeNull();
    expect(snapshot.summary.revenueCoverage).toEqual({
      status: "unavailable",
      expectedOfferMonths: 1,
      reportedOfferMonths: 0,
    });
    expect(snapshot.historyCapability.supportsSinceEnrollmentMonthlySeries).toBe(
      false,
    );
    expect(snapshot.historyCapability.maximumOfficialLookbackMonths).toBe(23);
  });

  it("fetches current offers once across multiple months and leaves missing months absent", async () => {
    const intervals = officialCompleteMonthlyIntervals(3, NOW);
    const offerRequests: ReplenishmentPageRequest[] = [];
    const snapshot = await fetchFbaSubscriptionAuditHistory({
      marketplaceId: US,
      metricIntervals: intervals,
      now: NOW,
      knownFbaSkus: new Set([sku(1)]),
      transport: async (request) => {
        if (request.operation === "listOffers") {
          offerRequests.push(request);
          return page([offer(1)]);
        }
        const timeInterval = (request.body.filters as Record<string, unknown>)
          .timeInterval as Record<string, unknown>;
        const month = String(timeInterval.startDate).slice(0, 7);
        if (month === intervals[1]!.month) return page([]);
        return page([
          metric(1, {
            timeInterval: {
              startDate: timeInterval.startDate,
              endDate: timeInterval.endDate,
            },
            totalSubscriptionsRevenue: month === intervals[0]!.month ? 10 : 30,
          }),
        ]);
      },
    });
    expect(offerRequests).toHaveLength(1);
    expect(snapshot.offers[0]!.monthlySeries.map((item) => item.interval.month)).toEqual([
      intervals[0]!.month,
      intervals[2]!.month,
    ]);
    expect(snapshot.summary.provenSubscriptionRevenue).toBeNull();
    expect(snapshot.summary.revenueCurrencyCode).toBeNull();
    expect(snapshot.summary.revenueCoverage).toEqual({
      status: "partial",
      expectedOfferMonths: 3,
      reportedOfferMonths: 2,
    });
    expect(snapshot.summary.monthly[1]).toMatchObject({
      month: intervals[1]!.month,
      provenSubscriptionRevenue: null,
      revenueCoverage: {
        status: "unavailable",
        expectedOfferMonths: 1,
        reportedOfferMonths: 0,
      },
    });
  });

  it("does not treat a historical AMAZON metric as proof of current FBA", async () => {
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      transport: async (request) =>
        request.operation === "listOffers" ? page([offer(1)]) : page([metric(1)]),
    });
    expect(snapshot.offers).toEqual([]);
    expect(snapshot.excluded).toContainEqual({
      sellerSku: sku(1),
      reason: "FBA_NOT_PROVEN",
    });
  });

  it("uses only completed months inside the exact trailing-two-year horizon", () => {
    expect(officialCompleteMonthlyIntervals(3, NOW).map(({ month }) => month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
    expect(() => officialCompleteMonthlyIntervals(24, NOW)).toThrow(/近兩年/u);
    expect(() =>
      assertOfficialMonthlyIntervalAvailable(
        {
          month: "2024-08",
          startDate: "2024-08-01T00:00:00Z",
          endDate: "2024-08-31T23:59:59Z",
        },
        NOW,
      ),
    ).toThrow(/近兩年/u);
  });

  it("only accepts the five Amazon-configured problem buckets", () => {
    expect([0, 5, 10, 15, 20].map(subscriptionAuditDiscountBucket)).toEqual([
      0, 5, 10, 15, 20,
    ]);
    expect(subscriptionAuditDiscountBucket(12)).toBeNull();
    expect(subscriptionAuditDiscountBucket(null)).toBeNull();
  });

  it("rejects a mutated request even when its path and program still look allowlisted", () => {
    const request = buildReplenishmentOffersPageRequest(US, 0);
    request.body = {
      ...request.body,
      filters: {
        ...(request.body.filters as Record<string, unknown>),
        skus: ["renderer-injected"],
      },
    };
    expect(() => assertReplenishmentRequestBody(request)).toThrow(/builder/u);
  });
});
