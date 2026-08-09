import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  createSubscriptionAuditWorkbook,
  type SubscriptionAuditProblemWorkbookRow,
} from "../src/main/amazon/subscription-audit-xlsx";

function problem(
  bucket: SubscriptionAuditProblemWorkbookRow["bucket"],
  sellerSku: string,
  monthlySeries: SubscriptionAuditProblemWorkbookRow["monthlySeries"],
  sellerFundedBaseDiscount: number | null = bucket,
): SubscriptionAuditProblemWorkbookRow {
  return {
    bucket,
    problem: bucket === 0 ? "沒有 Seller 折扣" : "檢查折扣設定",
    sellerSku,
    asin: "B000000001",
    currentPrice: 17.99,
    currencyCode: "USD",
    sellerFundedBaseDiscount,
    sellerFundedTieredDiscount: bucket === 5 ? 10 : null,
    currentActiveSubscriptions: 12,
    monthlySeries,
    forecastDeliveries: {
      next15Days: 1,
      next30Days: 2,
      next60Days: 3,
      next90Days: 4,
    },
    fbaEvidence: "CURRENT_FBA_SKU_SET",
  };
}

function point(month: string, revenue: number | null) {
  return {
    month,
    revenueCurrencyCode: revenue === null ? null : "USD",
    subscriptionRevenue: revenue,
    shippedSubscriptionUnits: revenue === null ? null : 8,
    activeSubscriptionsAtPeriodEnd: revenue === null ? null : 11,
  };
}

function inventoryEvidence(
  verifiableReplenishmentOfferCount: number,
  unverifiedFbaSkuCount = 0,
  unrecognizedSellerSkuRows = 0,
) {
  const provenSkuCount =
    verifiableReplenishmentOfferCount + unverifiedFbaSkuCount;
  return {
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION" as const,
    coverage: unrecognizedSellerSkuRows === 0
      ? "complete" as const
      : "partial" as const,
    returnedInventoryRows: provenSkuCount + unrecognizedSellerSkuRows,
    provenSkuCount,
    unrecognizedSellerSkuRows,
    verifiableReplenishmentOfferCount,
    unverifiedFbaSkuCount,
  };
}

describe("Subscribe & Save problem Excel", () => {
  it("creates exactly the five requested discount sheets with official summaries", () => {
    const bytes = createSubscriptionAuditWorkbook({
      marketplaceLabel: "US · Amazon.com",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-06", "2026-07"],
      currentActiveSubscriptions: 1_009,
      provenSubscriptionRevenue: 225,
      revenueCurrencyCode: "USD",
      revenueCoverage: {
        status: "complete",
        expectedOfferMonths: 4,
        reportedOfferMonths: 4,
      },
      inventoryEvidence: inventoryEvidence(2),
      problems: [
        problem(0, "SNS-ZERO", [point("2026-06", 25), point("2026-07", 50)]),
        problem(5, "SNS-FIVE", [point("2026-06", 100), point("2026-07", 50)]),
      ],
    });
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const archive = unzipSync(bytes);
    const workbook = strFromU8(archive["xl/workbook.xml"]);
    expect(workbook.match(/<sheet /gu)).toHaveLength(5);
    for (const name of ["0%", "5%", "10%", "15%", "20%"] as const) {
      expect(workbook).toContain(`name="${name}"`);
    }
    const zero = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const five = strFromU8(archive["xl/worksheets/sheet2.xml"]);
    const ten = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    expect(zero).toContain("SNS-ZERO");
    expect(zero).not.toContain("SNS-FIVE");
    expect(five).toContain("SNS-FIVE");
    expect(five).toContain("全站目前有效訂閱");
    expect(five).toContain("所選期間 S&amp;S 營收");
    expect(five).toContain("<v>225</v>");
    expect(five).toContain("2026-06");
    expect(five).toContain("2026-07");
    expect(five).toContain("該月營收已回傳");
    expect(ten).not.toContain("SNS-ZERO");
    expect(ten).not.toContain("SNS-FIVE");
    expect(five).not.toContain("<f>");
  });

  it("keeps unavailable official revenue visibly unavailable and neutralizes formulas", () => {
    const row = problem(20, "=FORMULA", [point("2026-07", null)]);
    const bytes = createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-07"],
      currentActiveSubscriptions: 12,
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "unavailable",
        expectedOfferMonths: 1,
        reportedOfferMonths: 0,
      },
      inventoryEvidence: inventoryEvidence(1),
      problems: [row],
    });
    const archive = unzipSync(bytes);
    const sheet = strFromU8(archive["xl/worksheets/sheet5.xml"]);
    expect(sheet).toContain("Amazon 未回傳可證明的所選期間營收");
    expect(sheet).toContain("該月已回傳，營收未回傳");
    expect(sheet).toContain("&apos;=FORMULA");
  });

  it("exports every selected month and does not label a partial sum as the period total", () => {
    const bytes = createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-06", "2026-07"],
      currentActiveSubscriptions: 12,
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 2,
        reportedOfferMonths: 1,
      },
      inventoryEvidence: inventoryEvidence(1),
      problems: [problem(10, "SNS-PARTIAL", [point("2026-07", 25)])],
    });
    const archive = unzipSync(bytes);
    const sheet = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    expect(sheet).toContain("資料涵蓋不完整；未將部分加總冒充完整總額");
    expect(sheet).toContain("不完整（1 / 2 個 SKU 月份）");
    expect(sheet).toContain("Amazon 未回傳此 SKU 月度列");
    expect(sheet).toContain("<v>25</v>");
    expect(sheet).toContain("2026-06");
    expect(sheet).toContain("2026-07");
  });

  it("does not call matched offers full-site data when another proven FBA SKU has no verifiable offer", () => {
    const bytes = createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-07"],
      currentActiveSubscriptions: 12,
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 1,
        reportedOfferMonths: 1,
      },
      inventoryEvidence: inventoryEvidence(1, 1),
      problems: [problem(10, "SNS-MATCHED", [point("2026-07", 25)])],
    });
    const archive = unzipSync(bytes);
    const sheet = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    expect(sheet).toContain("已核對目前有效訂閱（範圍不完整）");
    expect(sheet).not.toContain("全站目前有效訂閱");
    expect(sheet).toContain("已證明 FBA 2 個；可核對 offer 1 個；未取得可核對 offer 1 個");
    expect(sheet).toContain("已核對資料（1 / 1 個 SKU 月份）");
    expect(sheet).toContain("不能據此判定資格或 0 訂閱");
    expect(sheet).toContain("未輸出全站總額");
  });

  it("exports unrecognizable Inventory Seller SKU rows as incomplete without assigning zero", () => {
    const bytes = createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-07"],
      currentActiveSubscriptions: 12,
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 1,
        reportedOfferMonths: 1,
      },
      inventoryEvidence: inventoryEvidence(1, 0, 1),
      problems: [problem(10, "SNS-MATCHED", [point("2026-07", 25)])],
    });
    const archive = unzipSync(bytes);
    const sheet = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    expect(sheet).toContain("Inventory 共回傳 2 列");
    expect(sheet).toContain("Seller SKU 無法原樣辨識 1 列");
    expect(sheet).toContain("不能 trim、改名、判定資格或計為 0");
    expect(sheet).toContain("未輸出全站總額");
  });

  it("writes missing upstream Seller SKU coverage into every workbook sheet", () => {
    const bytes = createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-06", "2026-07"],
      currentActiveSubscriptions: 12,
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 2,
        reportedOfferMonths: 2,
      },
      inventoryEvidence: inventoryEvidence(1, 1),
      upstreamCoverage: {
        status: "partial",
        returnedOfferRows: 2,
        acceptedOfferRows: 1,
        returnedMetricRows: 3,
        acceptedMetricRows: 2,
        invalidOfferRows: [],
        rejectedSellerSkuRows: 2,
        minimumUnresolvedOfferMonths: 2,
        notice: "Amazon 有 2 列未提供可原樣核對的 Seller SKU。",
      },
      problems: [problem(10, "SNS-PARTIAL-SOURCE", [
        point("2026-06", 20),
        point("2026-07", 25),
      ])],
    });
    const archive = unzipSync(bytes);
    const sheet = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    expect(sheet).toContain("Amazon 回應完整度");
    expect(sheet).toContain("不完整；排除 2 列");
    expect(sheet).toContain("未提供可原樣核對的 Seller SKU");
    expect(sheet).toContain("已核對目前有效訂閱（範圍不完整）");
    expect(sheet).not.toContain("全站目前有效訂閱");
    expect(sheet).toContain("已證明 FBA 2 個；可核對 offer 1 個；未取得可核對 offer 1 個");
    expect(sheet).toContain("未取得可核對 offer 不代表不符合資格，也不代表 0 訂閱");
    expect(sheet).toContain("已核對資料（2 / 2 個 SKU 月份）");
    expect(sheet).toContain("另有 1 個已證明 FBA SKU 未取得可核對 offer");
    expect(sheet).toContain("另至少 2 個 SKU 月份無法核對，實際缺口未知");
    expect(sheet).toContain("offer 與月度缺列可能不重疊");
    expect(sheet).not.toContain("2 / 4 個 SKU 月份");
  });

  it("lists exact-SKU offer value failures without replacing them with zero", () => {
    const bytes = createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-06", "2026-07"],
      currentActiveSubscriptions: 12,
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 2,
        reportedOfferMonths: 2,
      },
      inventoryEvidence: inventoryEvidence(1, 1),
      upstreamCoverage: {
        status: "partial",
        returnedOfferRows: 2,
        acceptedOfferRows: 1,
        returnedMetricRows: 2,
        acceptedMetricRows: 2,
        invalidOfferRows: [{
          sellerSku: "SNS-BAD-PRICE",
          problem: "offer price 不是安全的非負數。",
        }],
        rejectedSellerSkuRows: 0,
        minimumUnresolvedOfferMonths: 2,
        notice: "一列 offer 資料值無法安全解析。",
      },
      problems: [problem(10, "SNS-GOOD", [
        point("2026-06", 20),
        point("2026-07", 25),
      ])],
    });
    const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet3.xml"]);
    expect(sheet).toContain("未完成 offer");
    expect(sheet).toContain("SNS-BAD-PRICE");
    expect(sheet).toContain("offer price 不是安全的非負數");
    expect(sheet).toContain("1 列有精確 SKU 但 offer 資料值無法安全解析");
  });

  it("keeps an unknown Seller base discount blank instead of manufacturing zero", () => {
    const unknown = problem(
      0,
      "SNS-UNKNOWN",
      [point("2026-07", 10)],
      null,
    );
    unknown.problem =
      "Amazon 未回傳 Seller 基礎折扣；為保留資料暫列 0% 工作表，並非 0%。";
    const bytes = createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-07"],
      currentActiveSubscriptions: 12,
      provenSubscriptionRevenue: 10,
      revenueCurrencyCode: "USD",
      revenueCoverage: {
        status: "complete",
        expectedOfferMonths: 1,
        reportedOfferMonths: 1,
      },
      inventoryEvidence: inventoryEvidence(1),
      problems: [unknown],
    });
    const archive = unzipSync(bytes);
    const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain(unknown.problem);
    expect(sheet).toContain(
      '<c r="F9" s="0" t="inlineStr"><is><t xml:space="preserve"></t></is></c>',
    );
  });

  it("accepts a complete cent-accurate total despite floating-point addition order", () => {
    const metricMonths = Array.from({ length: 23 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 8 + index, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    const monthlyTotals = Array<number>(metricMonths.length).fill(0);
    let seed = 7_927;
    const problems = Array.from({ length: 707 }, (_, offerIndex) => {
      const monthlySeries = metricMonths.map((month, monthIndex) => {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        const revenue = (seed % 1_000_000) / 100;
        monthlyTotals[monthIndex] += revenue;
        return point(month, revenue);
      });
      return problem(
        0,
        `SNS-${String(offerIndex + 1).padStart(4, "0")}`,
        monthlySeries,
      );
    });
    const monthlyFirstTotal = monthlyTotals.reduce((sum, value) => sum + value, 0);
    const offerFirstTotal = problems.reduce(
      (sum, row) =>
        sum + row.monthlySeries.reduce(
          (rowSum, metric) => rowSum + (metric.subscriptionRevenue ?? 0),
          0,
        ),
      0,
    );
    expect(monthlyFirstTotal).not.toBe(offerFirstTotal);
    expect(Math.round(monthlyFirstTotal * 100)).toBe(
      Math.round(offerFirstTotal * 100),
    );

    expect(() => createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths,
      currentActiveSubscriptions: 0,
      provenSubscriptionRevenue: monthlyFirstTotal,
      revenueCurrencyCode: "USD",
      revenueCoverage: {
        status: "complete",
        expectedOfferMonths: problems.length * metricMonths.length,
        reportedOfferMonths: problems.length * metricMonths.length,
      },
      inventoryEvidence: inventoryEvidence(problems.length),
      problems,
    })).not.toThrow();
  });

  it("rejects a complete selected-period total that differs by one cent", () => {
    expect(() => createSubscriptionAuditWorkbook({
      marketplaceLabel: "US",
      generatedAt: "2026-08-08T12:00:00Z",
      metricMonths: ["2026-07"],
      currentActiveSubscriptions: 1,
      provenSubscriptionRevenue: 10.01,
      revenueCurrencyCode: "USD",
      revenueCoverage: {
        status: "complete",
        expectedOfferMonths: 1,
        reportedOfferMonths: 1,
      },
      inventoryEvidence: inventoryEvidence(1),
      problems: [problem(5, "SNS-CENT", [point("2026-07", 10)])],
    })).toThrow(/does not match the complete series/u);
  });

  it("rejects duplicate SKU rows so totals cannot silently double count", () => {
    expect(() =>
      createSubscriptionAuditWorkbook({
        marketplaceLabel: "US",
        generatedAt: "2026-08-08T12:00:00Z",
        metricMonths: ["2026-07"],
        currentActiveSubscriptions: 0,
        provenSubscriptionRevenue: 0,
        revenueCurrencyCode: "USD",
        revenueCoverage: {
          status: "complete",
          expectedOfferMonths: 2,
          reportedOfferMonths: 2,
        },
        inventoryEvidence: inventoryEvidence(2),
        problems: [
          problem(0, "DUPLICATE", [point("2026-07", 0)]),
          problem(5, "DUPLICATE", [point("2026-07", 0)]),
        ],
      }),
    ).toThrow(/Duplicate problem SKU/u);
  });
});
