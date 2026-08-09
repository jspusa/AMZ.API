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
    expect(parseReplenishmentOffersPage(
      page([offer(1, { priceCurrencyCode: "CAD" })]),
      US,
    )).toMatchObject({
      items: [],
      invalidOfferRows: [{ sellerSku: sku(1), problem: expect.stringMatching(/currency/u) }],
    });
    expect(parseReplenishmentOffersPage(
      page([offer(1, { subscriptions: 1.2 })]),
      US,
    )).toMatchObject({
      items: [],
      invalidOfferRows: [{ sellerSku: sku(1), problem: expect.stringMatching(/整數/u) }],
    });
  });

  it("isolates exact-SKU offer value failures while keeping scope violations global", async () => {
    const parsed = parseReplenishmentOffersPage(
      page([offer(1), offer(2, { price: "17.99" })]),
      US,
    );
    expect(parsed).toMatchObject({
      sourceItemCount: 2,
      rejectedSellerSkuRows: 0,
      items: [expect.objectContaining({ sellerSku: sku(1) })],
      invalidOfferRows: [{
        sellerSku: sku(2),
        problem: expect.stringContaining("offer price"),
      }],
    });
    expect(() => parseReplenishmentOffersPage(
      page([offer(2, { marketplaceId: "A2EUQ1WTGCTBG2", price: "17.99" })]),
      US,
    )).toThrow(/其他站點/u);
    expect(() => parseReplenishmentOffersPage(
      page([offer(2, { programType: "OTHER", price: "17.99" })]),
      US,
    )).toThrow(/不是 Subscribe & Save/u);

    const intervals = officialCompleteMonthlyIntervals(2, NOW);
    const snapshot = await fetchFbaSubscriptionAuditHistory({
      marketplaceId: US,
      metricIntervals: intervals,
      now: NOW,
      knownFbaSkus: new Set([sku(1), sku(2)]),
      transport: async (request) => {
        if (request.operation === "listOffers") {
          return page([offer(1), offer(2, { price: "17.99" })]);
        }
        const timeInterval = (request.body.filters as Record<string, unknown>)
          .timeInterval as Record<string, unknown>;
        return page([1, 2].map((index) => metric(index, {
          timeInterval: {
            startDate: timeInterval.startDate,
            endDate: timeInterval.endDate,
          },
        })));
      },
    });
    expect(snapshot.offers.map(({ sellerSku }) => sellerSku)).toEqual([sku(1)]);
    expect(snapshot.upstreamCoverage).toMatchObject({
      status: "partial",
      returnedOfferRows: 2,
      acceptedOfferRows: 1,
      rejectedSellerSkuRows: 0,
      minimumUnresolvedOfferMonths: 2,
      invalidOfferRows: [{ sellerSku: sku(2) }],
    });
    expect(snapshot.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: { status: "partial" },
      monthly: [
        { provenSubscriptionRevenue: null, revenueCoverage: { status: "partial" } },
        { provenSubscriptionRevenue: null, revenueCoverage: { status: "partial" } },
      ],
    });
  });

  it("isolates one exact SKU when a duplicate row has invalid values", async () => {
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set([sku(1)]),
      transport: async (request) => request.operation === "listOffers"
        ? page([offer(1), offer(1, { price: "17.99" })])
        : page([metric(1)]),
    });
    expect(snapshot.offers).toEqual([]);
    expect(snapshot.upstreamCoverage).toMatchObject({
      status: "partial",
      returnedOfferRows: 2,
      acceptedOfferRows: 0,
      problemSkuRows: [{
        sellerSku: sku(1),
        affectedOfferRows: 2,
        affectedMetricRows: 0,
      }],
    });
    expect(snapshot.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: { status: "unavailable" },
    });
  });

  it.each([
    ["identical", offer(1)],
    ["conflicting", offer(1, { price: 18.99 })],
  ])("isolates a cross-page %s duplicate offer without stopping valid SKUs", async (_kind, duplicate) => {
    const offerRows = [
      ...Array.from({ length: 100 }, (_, index) => offer(index + 1)),
      duplicate,
    ];
    const metricRows = Array.from({ length: 100 }, (_, index) => metric(index + 1));
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set(metricRows.map((row) => String(row.sku))),
      transport: async (request) => request.operation === "listOffers"
        ? page(
            offerRows.slice(request.offset, request.offset + request.limit),
            offerRows.length,
          )
        : page(metricRows),
    });

    expect(snapshot.offers).toHaveLength(99);
    expect(snapshot.offers.some(({ sellerSku }) => sellerSku === sku(1))).toBe(false);
    expect(snapshot.offers.some(({ sellerSku }) => sellerSku === sku(2))).toBe(true);
    expect(snapshot.upstreamCoverage).toMatchObject({
      status: "partial",
      returnedOfferRows: 101,
      acceptedOfferRows: 99,
      problemSkuRows: [{
        sellerSku: sku(1),
        affectedOfferRows: 2,
        affectedMetricRows: 0,
        metricMonths: [],
      }],
    });
    expect(snapshot.upstreamCoverage.problemSkuRows).toHaveLength(1);
    expect(snapshot.upstreamCoverage.problemSkuRows[0]!.problem).toContain(
      "其他商品仍已繼續完成",
    );
    expect(snapshot.summary.provenSubscriptionRevenue).toBeNull();
    expect(snapshot.summary.revenueCoverage.status).toBe("partial");
  });

  it.each([
    ["identical", metric(1)],
    ["conflicting", metric(1, { totalSubscriptionsRevenue: 999 })],
  ])("keeps a %s duplicated metric month blank without double counting other SKUs", async (_kind, duplicate) => {
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set([sku(1), sku(2)]),
      transport: async (request) => request.operation === "listOffers"
        ? page([offer(1), offer(2)])
        : page([
            metric(1),
            duplicate,
            metric(2),
          ]),
    });

    expect(snapshot.offers).toHaveLength(2);
    expect(snapshot.offers.find(({ sellerSku }) => sellerSku === sku(1)))
      .toMatchObject({ monthlyPerformance: null });
    expect(snapshot.offers.find(({ sellerSku }) => sellerSku === sku(2)))
      .toMatchObject({ monthlyPerformance: { subscriptionRevenue: 2.5 } });
    expect(snapshot.upstreamCoverage).toMatchObject({
      status: "partial",
      returnedMetricRows: 3,
      acceptedMetricRows: 1,
      problemSkuRows: [{
        sellerSku: sku(1),
        affectedOfferRows: 0,
        affectedMetricRows: 2,
        metricMonths: [MONTH.month],
      }],
    });
    expect(snapshot.upstreamCoverage.problemSkuRows).toHaveLength(1);
    expect(snapshot.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 2,
        reportedOfferMonths: 1,
      },
    });
  });

  it("reports only a lower-bound gap when optional-SKU offer and metric rows may not overlap", async () => {
    const offerWithoutSellerSku = {
      marketplaceId: US,
      programType: "SUBSCRIBE_AND_SAVE",
      asin: asin(2),
      eligibility: "ELIGIBLE",
      offerProgramConfiguration: {
        enrollmentMethod: "AUTOMATIC",
        preferences: { autoEnrollment: "OPTED_IN" },
      },
    };
    const metricWithoutSellerSku = {
      asin: asin(2),
      fulfillmentChannelType: "AMAZON",
      timeInterval: {
        startDate: MONTH.startDate,
        endDate: MONTH.endDate,
      },
      currencyCode: "USD",
      totalSubscriptionsRevenue: 10,
    };
    const parsedOffers = parseReplenishmentOffersPage(
      page([offer(1), offerWithoutSellerSku]),
      US,
    );
    expect(parsedOffers).toMatchObject({
      sourceItemCount: 2,
      rejectedSellerSkuRows: 1,
      items: [expect.objectContaining({ sellerSku: sku(1) })],
    });

    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set([sku(1)]),
      transport: async (request) =>
        request.operation === "listOffers"
          ? page([offer(1), offerWithoutSellerSku])
          : page([metric(1), metricWithoutSellerSku]),
    });
    expect(snapshot.offers).toHaveLength(1);
    expect(snapshot.offers[0]).toMatchObject({
      sellerSku: sku(1),
      fbaEvidence: "CURRENT_FBA_SKU_SET",
    });
    expect(snapshot.upstreamCoverage).toMatchObject({
      status: "partial",
      returnedOfferRows: 2,
      acceptedOfferRows: 1,
      returnedMetricRows: 2,
      acceptedMetricRows: 1,
      rejectedSellerSkuRows: 2,
      minimumUnresolvedOfferMonths: 1,
    });
    expect(snapshot.upstreamCoverage.notice).toContain("未提供可原樣核對的 Seller SKU");
    expect(snapshot.upstreamCoverage.notice).toContain("至少 1 個 SKU 月份");
    expect(snapshot.upstreamCoverage.notice).toContain("實際缺口無法精確計算");
    expect(snapshot.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 1,
        reportedOfferMonths: 1,
      },
    });
  });

  it("keeps malformed FBA evidence separate from optional upstream SKU rows", async () => {
    await expect(
      fetchFbaSubscriptionAudit({
        marketplaceId: US,
        metricInterval: MONTH,
        now: NOW,
        knownFbaSkus: new Set([`BAD\u200bSKU`]),
        transport: async () => page([]),
      }),
    ).rejects.toThrow(/FBA Inventory Seller SKU/u);
  });

  it("does not call matched S&S offers a complete total when another proven FBA SKU has no verifiable offer", async () => {
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set([sku(1), sku(2)]),
      transport: async (request) =>
        request.operation === "listOffers" ? page([offer(1)]) : page([metric(1)]),
    });

    expect(snapshot.offers.map(({ sellerSku }) => sellerSku)).toEqual([sku(1)]);
    expect(snapshot.upstreamCoverage.status).toBe("complete");
    expect(snapshot.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 1,
        reportedOfferMonths: 1,
      },
    });
  });

  it("accepts only exact complete-month AMAZON performance rows", () => {
    const {
      marketplaceId: _marketplaceId,
      programType: _programType,
      ...officialMetricShape
    } = metric(1);
    const parsed = parseReplenishmentOfferMetricsPage(
      page([officialMetricShape]),
      US,
      MONTH,
    );
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

  it.each([
    ["ASIN", { asin: "NOT-AN-ASIN" }, /ASIN/u],
    ["revenue", { totalSubscriptionsRevenue: "17.99" }, /subscription revenue/u],
    ["count", { shippedSubscriptionUnits: 1.2 }, /整數/u],
  ])("isolates an exact-SKU invalid metric %s value without rejecting valid rows", (
    _field,
    overrides,
    expectedProblem,
  ) => {
    const parsed = parseReplenishmentOfferMetricsPage(
      page([metric(1), metric(2, overrides)]),
      US,
      MONTH,
    );
    expect(parsed).toMatchObject({
      sourceItemCount: 2,
      rejectedSellerSkuRows: 0,
      items: [expect.objectContaining({ sellerSku: sku(1) })],
      invalidMetricRows: [{
        sellerSku: sku(2),
        problem: expect.stringMatching(expectedProblem),
      }],
    });
  });

  it("keeps other current offers when one exact-SKU metric row is invalid", async () => {
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set([sku(1), sku(2)]),
      transport: async (request) => request.operation === "listOffers"
        ? page([offer(1), offer(2)])
        : page([
            metric(1),
            metric(2, { activeSubscriptions: 1.2 }),
          ]),
    });

    expect(snapshot.offers.map(({ sellerSku }) => sellerSku)).toEqual([
      sku(1),
      sku(2),
    ]);
    expect(snapshot.offers[1]).toMatchObject({
      sellerSku: sku(2),
      monthlyPerformance: null,
    });
    expect(snapshot.upstreamCoverage).toMatchObject({
      status: "partial",
      returnedOfferRows: 2,
      acceptedOfferRows: 2,
      returnedMetricRows: 2,
      acceptedMetricRows: 1,
      rejectedSellerSkuRows: 0,
      minimumUnresolvedOfferMonths: 1,
      problemSkuRows: [{
        sellerSku: sku(2),
        affectedOfferRows: 0,
        affectedMetricRows: 1,
        metricMonths: [MONTH.month],
        problem: expect.stringContaining("月度指標"),
      }],
    });
    expect(snapshot.upstreamCoverage.problemSkuRows).toHaveLength(1);
    expect(snapshot.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 2,
        reportedOfferMonths: 1,
      },
    });
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
    expect(snapshot.excluded).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("SNS-0101");
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

  it("keeps history totals incomplete when a proven FBA SKU has no verifiable current offer", async () => {
    const intervals = officialCompleteMonthlyIntervals(2, NOW);
    const snapshot = await fetchFbaSubscriptionAuditHistory({
      marketplaceId: US,
      metricIntervals: intervals,
      now: NOW,
      knownFbaSkus: new Set([sku(1), sku(2)]),
      transport: async (request) => {
        if (request.operation === "listOffers") return page([offer(1)]);
        const timeInterval = (request.body.filters as Record<string, unknown>)
          .timeInterval as Record<string, unknown>;
        return page([
          metric(1, {
            timeInterval: {
              startDate: timeInterval.startDate,
              endDate: timeInterval.endDate,
            },
          }),
        ]);
      },
    });

    expect(snapshot.offers.map(({ sellerSku }) => sellerSku)).toEqual([sku(1)]);
    expect(snapshot.upstreamCoverage.status).toBe("complete");
    expect(snapshot.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 2,
        reportedOfferMonths: 2,
      },
      monthly: [
        {
          provenSubscriptionRevenue: null,
          revenueCoverage: {
            status: "partial",
            expectedOfferMonths: 1,
            reportedOfferMonths: 1,
          },
        },
        {
          provenSubscriptionRevenue: null,
          revenueCoverage: {
            status: "partial",
            expectedOfferMonths: 1,
            reportedOfferMonths: 1,
          },
        },
      ],
    });
  });

  it("keeps complete matched metrics partial when Inventory contains an unrecognizable Seller SKU row", async () => {
    const intervals = officialCompleteMonthlyIntervals(2, NOW);
    const snapshot = await fetchFbaSubscriptionAuditHistory({
      marketplaceId: US,
      metricIntervals: intervals,
      now: NOW,
      knownFbaSkus: new Set([sku(1)]),
      knownFbaSkuCoverage: "partial",
      transport: async (request) => {
        if (request.operation === "listOffers") return page([offer(1)]);
        const timeInterval = (request.body.filters as Record<string, unknown>)
          .timeInterval as Record<string, unknown>;
        return page([metric(1, {
          timeInterval: {
            startDate: timeInterval.startDate,
            endDate: timeInterval.endDate,
          },
        })]);
      },
    });

    expect(snapshot.offers).toHaveLength(1);
    expect(snapshot.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 2,
        reportedOfferMonths: 2,
      },
      monthly: [
        { revenueCoverage: { status: "partial" } },
        { revenueCoverage: { status: "partial" } },
      ],
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
    expect(snapshot.excluded).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain(sku(1));
  });

  it("does not surface an unproven metric-only Seller SKU inside the FBA audit", async () => {
    const snapshot = await fetchFbaSubscriptionAudit({
      marketplaceId: US,
      metricInterval: MONTH,
      now: NOW,
      knownFbaSkus: new Set([sku(1)]),
      transport: async (request) =>
        request.operation === "listOffers"
          ? page([offer(1)])
          : page([metric(1), metric(2)]),
    });

    expect(snapshot.offers.map(({ sellerSku }) => sellerSku)).toEqual([sku(1)]);
    expect(snapshot.excluded).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain(sku(2));
    expect(snapshot.summary.revenueCoverage.status).toBe("complete");
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
