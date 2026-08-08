import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SubscriptionAuditPanel, {
  SubscriberHistoryChart,
  subscriptionRevenueSummary,
} from "../src/renderer/src/components/subscription-audit-panel";
import {
  isSubscriptionAuditMarketplaceSupported,
  parseSubscriptionAuditSnapshot,
  type SubscriptionAuditSnapshot,
} from "../src/renderer/src/subscription-audit";

const INTERVALS = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map((month) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    month,
    startDate: `${month}-01T00:00:00Z`,
    endDate: `${month}-${String(lastDay).padStart(2, "0")}T23:59:59Z`,
  };
});

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "live",
    marketplaceId: "ATVPDKIKX0DER",
    fetchedAt: "2026-08-08T08:00:00.000Z",
    requestedMonths: 6,
    exportId: "audit-12345678",
    intervals: INTERVALS,
    offers: [
      {
        sellerSku: "AFA12AM",
        asin: "B000000001",
        eligibility: "ELIGIBLE",
        price: { amount: 17.99, currencyCode: "USD" },
        sellerFundedBaseDiscount: 5,
        sellerFundedTieredDiscount: 10,
        currentActiveSubscriptions: 42,
        fbaEvidence: "CURRENT_FBA_SKU_SET",
        monthlySeries: [
          {
            month: "2026-02",
            subscriptionRevenue: 120,
            shippedSubscriptionUnits: 9,
            activeSubscriptionsAtPeriodEnd: 35,
            currencyCode: "USD",
          },
          {
            month: "2026-04",
            subscriptionRevenue: 150,
            shippedSubscriptionUnits: 11,
            activeSubscriptionsAtPeriodEnd: 38,
            currencyCode: "USD",
          },
          {
            month: "2026-05",
            subscriptionRevenue: null,
            shippedSubscriptionUnits: null,
            activeSubscriptionsAtPeriodEnd: 40,
            currencyCode: null,
          },
        ],
      },
    ],
    summary: {
      currentActiveSubscriptions: 42,
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 6,
        reportedOfferMonths: 2,
      },
    },
    historyCapability: {
      supportsSinceEnrollmentMonthlySeries: false,
      maximumOfficialLookbackMonths: 23,
      notice: "Amazon 公開 API 只支援最近 23 個完整月；缺月不得補值。",
    },
    ...overrides,
  };
}

describe("FBA subscription audit renderer", () => {
  it("strictly parses current FBA offers and preserves missing months", () => {
    const snapshot = parseSubscriptionAuditSnapshot(response());
    expect(snapshot.offers[0]).toMatchObject({
      sellerSku: "AFA12AM",
      currentActiveSubscriptions: 42,
      fbaEvidence: "CURRENT_FBA_SKU_SET",
    });
    expect(snapshot.offers[0].monthlySeries.map(({ month }) => month)).toEqual([
      "2026-02",
      "2026-04",
      "2026-05",
    ]);
    expect(snapshot.offers[0].monthlySeries).toHaveLength(3);
    expect(snapshot.historyCapability).toMatchObject({
      supportsSinceEnrollmentMonthlySeries: false,
      maximumOfficialLookbackMonths: 23,
    });
  });

  it("preserves a missing revenue point when Amazon still returns its currency", () => {
    const raw = response();
    const rawOffer = (raw.offers as Array<Record<string, unknown>>)[0];
    const missingRevenue = (rawOffer.monthlySeries as Array<Record<string, unknown>>)[2];
    missingRevenue.currencyCode = "USD";

    const snapshot = parseSubscriptionAuditSnapshot(raw);
    expect(snapshot.offers[0].monthlySeries[2]).toMatchObject({
      month: "2026-05",
      subscriptionRevenue: null,
      currencyCode: "USD",
    });
    expect(snapshot.summary.revenueCoverage).toEqual({
      status: "partial",
      expectedOfferMonths: 6,
      reportedOfferMonths: 2,
    });

    missingRevenue.subscriptionRevenue = 25;
    missingRevenue.currencyCode = null;
    expect(() => parseSubscriptionAuditSnapshot(raw)).toThrow(/營收有值時必須包含幣別/u);

    missingRevenue.currencyCode = "EUR";
    expect(() => parseSubscriptionAuditSnapshot(raw)).toThrow(/幣別與商品價格不一致/u);
  });

  it("fails closed on missing current FBA evidence or contradictory totals", () => {
    const withoutFba = response();
    (withoutFba.offers as Array<Record<string, unknown>>)[0].fbaEvidence = "HISTORICAL_METRIC";
    expect(() => parseSubscriptionAuditSnapshot(withoutFba)).toThrow(/沒有目前 FBA 證據/u);

    expect(() => parseSubscriptionAuditSnapshot(response({
      summary: {
        currentActiveSubscriptions: 41,
        provenSubscriptionRevenue: null,
        revenueCurrencyCode: null,
        revenueCoverage: {
          status: "partial",
          expectedOfferMonths: 6,
          reportedOfferMonths: 2,
        },
      },
    }))).toThrow(/摘要與 SKU 明細不一致/u);

    expect(() => parseSubscriptionAuditSnapshot(response({
      summary: {
        currentActiveSubscriptions: 42,
        provenSubscriptionRevenue: 270,
        revenueCurrencyCode: "USD",
        revenueCoverage: {
          status: "partial",
          expectedOfferMonths: 6,
          reportedOfferMonths: 2,
        },
      },
    }))).toThrow(/不可顯示部分總額/u);
  });

  it("rejects a fake since-enrollment history claim and more than the supported choices", () => {
    expect(() => parseSubscriptionAuditSnapshot(response({
      historyCapability: {
        supportsSinceEnrollmentMonthlySeries: true,
        maximumOfficialLookbackMonths: 999,
        notice: "fake",
      },
    }))).toThrow(/能力邊界/u);
    expect(() => parseSubscriptionAuditSnapshot(response({ requestedMonths: 24 }))).toThrow(/6、12 或 23/u);
  });

  it("renders a discontinuous line and exposes exact values to keyboard and hover users", () => {
    const snapshot = parseSubscriptionAuditSnapshot(response());
    const markup = renderToStaticMarkup(createElement(SubscriberHistoryChart, {
      snapshot: snapshot as SubscriptionAuditSnapshot,
      offer: snapshot.offers[0],
    }));
    expect(markup).toContain("缺月保持空白，不補 0");
    expect(markup.match(/<polyline/g)).toHaveLength(2);
    expect(markup).toContain("2026年2月月底有效訂閱 35");
    expect(markup).toContain("S&amp;S 營收");
  });

  it("shows coverage instead of turning partial monthly revenue into a total", () => {
    const snapshot = parseSubscriptionAuditSnapshot(response());
    expect(subscriptionRevenueSummary(snapshot)).toEqual({
      label: "所選期間 S&S 營收",
      value: "資料不完整",
      note: "Amazon 只回傳 2／6 個 SKU 月份；不以部分資料冒充總額。",
    });
  });

  it("shows a numeric total only when every selected SKU-month has revenue", () => {
    const raw = response();
    const rawOffer = (raw.offers as Array<Record<string, unknown>>)[0];
    rawOffer.monthlySeries = INTERVALS.map(({ month }) => ({
      month,
      subscriptionRevenue: 10,
      shippedSubscriptionUnits: 1,
      activeSubscriptionsAtPeriodEnd: 40,
      currencyCode: "USD",
    }));
    raw.summary = {
      currentActiveSubscriptions: 42,
      provenSubscriptionRevenue: 60,
      revenueCurrencyCode: "USD",
      revenueCoverage: {
        status: "complete",
        expectedOfferMonths: 6,
        reportedOfferMonths: 6,
      },
    };
    const display = subscriptionRevenueSummary(parseSubscriptionAuditSnapshot(raw));
    expect(display.label).toBe("所選期間完整 S&S 營收");
    expect(display.value).toContain("60");
    expect(display.note).toContain("全部 6 個 SKU 月份");
  });

  it("explains the snapshot meaning, 23-month limit and main-owned Excel export", () => {
    const markup = renderToStaticMarkup(createElement(SubscriptionAuditPanel, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
    }));
    expect(markup).toContain("全站訂閱價格健檢");
    expect(markup).toContain("目前有效訂閱」是查詢當下快照");
    expect(markup).toContain("最多提供 23 個完整月");
    expect(markup).toContain("同步 US 全部 FBA S&amp;S");
  });

  it("shows SG and AU as unsupported before a request and disables every scan control", () => {
    expect(isSubscriptionAuditMarketplaceSupported("A19VAU5U5O7RUS")).toBe(false);
    expect(isSubscriptionAuditMarketplaceSupported("A39IBJ37TRP1C6")).toBe(false);
    expect(isSubscriptionAuditMarketplaceSupported("ATVPDKIKX0DER")).toBe(true);

    const markup = renderToStaticMarkup(createElement(SubscriptionAuditPanel, {
      marketplaceId: "A19VAU5U5O7RUS",
      marketplaceShort: "SG",
    }));
    expect(markup).toContain("Subscribe &amp; Save 能力說明");
    expect(markup).toContain("SG 站不在 Amazon 官方 Seller Replenishment API 支援清單");
    expect(markup).toContain("Amazon 官方 API 不支援 SG");
    expect(markup).toContain("不會改用 Seller Central 私有接口");
    expect(markup).not.toContain("同步 SG 全部 FBA S&amp;S");
    expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(4);
  });

  it("releases the busy state when a marketplace change aborts the old request", async () => {
    const source = await readFile(
      new URL(
        "../src/renderer/src/components/subscription-audit-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?abortRef\.current\?\.abort\(\);[\s\S]*?setBusy\(null\);[\s\S]*?\}, \[marketplaceId\]\);/u,
    );
  });
});
