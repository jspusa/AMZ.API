import { describe, expect, it, vi } from "vitest";
import {
  MAX_SALES_TREND_DAY_COUNT,
  SpApiError,
  buildCustomSalesTrendWindow,
  buildPreviousYearSalesTrendWindow,
  buildSalesTrendQuery,
  buildSalesTrendWindow,
  getSalesTrend,
  normalizeSalesTrendResponse,
  resolveSalesTrendRange,
  salesTrendRetryDelayMs,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");

async function demoSalesTrendAt(
  now: Date,
  input: Parameters<typeof getSalesTrend>[0],
) {
  const savedMode = process.env.SP_API_MODE;
  process.env.SP_API_MODE = "demo";
  vi.useFakeTimers();
  vi.setSystemTime(now);
  try {
    return await getSalesTrend(input);
  } finally {
    vi.useRealTimers();
    if (savedMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = savedMode;
  }
}

describe("FBA sales trend contract", () => {
  it("builds one AFN-only daily Sales API request with an optional exact SKU", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    const query = buildSalesTrendQuery(MARKETPLACE_ID, window);
    const skuQuery = buildSalesTrendQuery(MARKETPLACE_ID, window, {
      sellerSku: "AFA12AM",
    });

    expect(query.getAll("marketplaceIds")).toEqual([MARKETPLACE_ID]);
    expect(query.get("granularity")).toBe("Day");
    expect(query.get("buyerType")).toBe("All");
    expect(query.get("fulfillmentNetwork")).toBe("AFN");
    expect(query.get("granularityTimeZone")).toBe("America/Los_Angeles");
    expect(query.has("sku")).toBe(false);
    expect(skuQuery.get("sku")).toBe("AFA12AM");
    expect(skuQuery.get("fulfillmentNetwork")).toBe("AFN");
  });

  it("uses marketplace calendar days and preserves DST offsets", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);

    expect(window.dateKeys).toEqual([
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(window.startAt).toBe("2026-03-04T00:00:00-08:00");
    expect(window.endAt).toBe("2026-03-10T05:00:00-07:00");
    expect(window.intervals[3]).toContain(
      "2026-03-07T00:00:00-08:00--2026-03-08T00:00:00-08:00",
    );
    expect(window.intervals[4]).toContain(
      "2026-03-08T00:00:00-08:00--2026-03-09T00:00:00-07:00",
    );
  });

  it("maps equivalent UTC intervals back to the marketplace calendar date", () => {
    const marketplaceId = "A1VC38T7YXB528" as const;
    const window = buildSalesTrendWindow(
      marketplaceId,
      7,
      new Date("2026-08-06T03:00:00.000Z"),
    );
    const [start, end] = window.intervals[0].split("--");
    const interval = `${new Date(start).toISOString()}--${new Date(end).toISOString()}`;
    const normalized = normalizeSalesTrendResponse({
      marketplaceId,
      window,
      response: {
        payload: [
          {
            interval,
            unitCount: 1,
            orderItemCount: 1,
            orderCount: 1,
            totalSales: { amount: "1200", currencyCode: "JPY" },
          },
        ],
      },
    });

    expect(normalized.points[0]).toMatchObject({
      date: window.dateKeys[0],
      totalSales: { amount: 1200, currencyCode: "JPY" },
    });
  });

  it("zero-fills missing dates and totals all daily buckets", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    const normalized = normalizeSalesTrendResponse({
      marketplaceId: MARKETPLACE_ID,
      window,
      response: {
        payload: [
          {
            interval: window.intervals[0],
            unitCount: 2,
            orderItemCount: 2,
            orderCount: 2,
            totalSales: { amount: "35.98", currencyCode: "USD" },
          },
          {
            interval: window.intervals[6],
            unitCount: 3,
            orderItemCount: 3,
            orderCount: 2,
            totalSales: { amount: "53.97", currencyCode: "USD" },
          },
        ],
      },
    });

    expect(normalized.points).toHaveLength(7);
    expect(normalized.points[1].totalSales.amount).toBe(0);
    expect(normalized.points[6].partial).toBe(true);
    expect(normalized.totals).toEqual({
      totalSales: { amount: 89.95, currencyCode: "USD" },
      unitCount: 5,
      orderItemCount: 5,
      orderCount: 4,
    });
  });

  it("rejects payload errors and cross-currency buckets", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    expect(() =>
      normalizeSalesTrendResponse({
        marketplaceId: MARKETPLACE_ID,
        window,
        response: { errors: [{ code: "InvalidInput", message: "Invalid metrics" }], payload: [] },
      }),
    ).toThrow(SpApiError);

    expect(() =>
      normalizeSalesTrendResponse({
        marketplaceId: MARKETPLACE_ID,
        window,
        response: {
          payload: [
            {
              interval: window.intervals[0],
              unitCount: 1,
              orderItemCount: 1,
              orderCount: 1,
              totalSales: { amount: "10", currencyCode: "CAD" },
            },
          ],
        },
      }),
    ).toThrow(SpApiError);
  });

  it("rejects malformed array entries as upstream data errors", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    expect(() =>
      normalizeSalesTrendResponse({
        marketplaceId: MARKETPLACE_ID,
        window,
        response: { payload: [null] },
      }),
    ).toThrow(SpApiError);
    expect(() =>
      normalizeSalesTrendResponse({
        marketplaceId: MARKETPLACE_ID,
        window,
        response: { errors: [null], payload: [] },
      }),
    ).toThrow("Amazon 無法完成 FBA 銷售趨勢查詢");
  });

  it("accepts the supported 7, 14, 30, and 90 day presets", () => {
    expect(buildSalesTrendWindow(MARKETPLACE_ID, 14, NOW).dateKeys).toHaveLength(14);
    expect(buildSalesTrendWindow(MARKETPLACE_ID, 30, NOW).dateKeys).toHaveLength(30);
    expect(buildSalesTrendWindow(MARKETPLACE_ID, 90, NOW).dateKeys).toHaveLength(90);
    expect(() => buildSalesTrendWindow(MARKETPLACE_ID, 10 as 7, NOW)).toThrow(
      "銷售趨勢只支援最近 7、14、30 或 90 天",
    );
  });

  it("builds inclusive custom ranges and does not mark historical tails partial", () => {
    const window = buildCustomSalesTrendWindow(
      MARKETPLACE_ID,
      "2026-02-01",
      "2026-02-03",
      NOW,
    );

    expect(window.range).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-03",
      dayCount: 3,
      presetDays: null,
    });
    expect(window.dateKeys).toEqual(["2026-02-01", "2026-02-02", "2026-02-03"]);
    expect(window.startAt).toBe("2026-02-01T00:00:00-08:00");
    expect(window.endAt).toBe("2026-02-04T00:00:00-08:00");
    expect(window.partialDateKey).toBeNull();

    const normalized = normalizeSalesTrendResponse({
      marketplaceId: MARKETPLACE_ID,
      window,
      response: { payload: [] },
    });
    expect(normalized.points.every((point) => point.partial === false)).toBe(true);
  });

  it("accepts 365 custom days but rejects 366 before issuing a Sales API request", () => {
    expect(MAX_SALES_TREND_DAY_COUNT).toBe(365);
    expect(
      resolveSalesTrendRange(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2025-03-11",
          endDate: "2026-03-10",
        },
        NOW,
      ),
    ).toEqual({
      startDate: "2025-03-11",
      endDate: "2026-03-10",
      dayCount: 365,
      presetDays: null,
    });
    expect(() =>
      resolveSalesTrendRange(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2025-03-10",
          endDate: "2026-03-10",
        },
        NOW,
      ),
    ).toThrow("自訂日期範圍必須介於 1 到 365 天");
  });

  it("keeps the paired 365-day previous-year request inside the Sales API two-year horizon", async () => {
    const snapshot = await demoSalesTrendAt(NOW, {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2025-03-11",
      endDate: "2026-03-10",
      comparison: "previous-year",
    });

    expect(snapshot.range.dayCount).toBe(365);
    expect(snapshot.comparison?.range.startDate).toBe("2024-03-11");
    expect(snapshot.comparison?.range.endDate).toBe("2025-03-10");
    expect(snapshot.comparison?.points).toHaveLength(365);
  });

  it("validates mixed modes, strict dates, future dates, and the Sales API horizon", () => {

    expect(() =>
      resolveSalesTrendRange(
        {
          marketplaceId: MARKETPLACE_ID,
          days: 7,
          startDate: "2026-03-01",
          endDate: "2026-03-10",
        },
        NOW,
      ),
    ).toThrow("預設天數與自訂日期不可同時使用");

    expect(() =>
      resolveSalesTrendRange(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2026-3-01",
          endDate: "2026-03-10",
        },
        NOW,
      ),
    ).toThrow("自訂日期必須使用 YYYY-MM-DD 格式");

    expect(() =>
      resolveSalesTrendRange(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2026-03-10",
          endDate: "2026-03-11",
        },
        NOW,
      ),
    ).toThrow("自訂日期不可包含未來日期");

    expect(() =>
      resolveSalesTrendRange(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2024-03-10",
          endDate: "2024-03-10",
        },
        NOW,
      ),
    ).toThrow("開始日必須晚於距今兩年的同一站點日期");
    expect(
      resolveSalesTrendRange(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2024-03-11",
          endDate: "2024-03-11",
        },
        NOW,
      ).dayCount,
    ).toBe(1);
  });

  it("uses the same marketplace-local cutoff for the previous-year series", () => {
    const current = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    const previous = buildPreviousYearSalesTrendWindow(MARKETPLACE_ID, current);
    const query = buildSalesTrendQuery(MARKETPLACE_ID, previous);

    expect(previous.range).toEqual({
      startDate: "2025-03-04",
      endDate: "2025-03-10",
      dayCount: 7,
      presetDays: null,
    });
    expect(previous.endAt).toBe("2025-03-10T05:00:00-07:00");
    expect(previous.partialDateKey).toBe("2025-03-10");
    expect(query.get("fulfillmentNetwork")).toBe("AFN");
    expect(query.get("granularity")).toBe("Day");
  });

  it("keeps leap-day comparison dates unique instead of mapping Feb 29 onto Feb 28", () => {
    const leapNow = new Date("2024-03-02T20:00:00.000Z");
    const current = buildCustomSalesTrendWindow(
      MARKETPLACE_ID,
      "2024-02-28",
      "2024-03-01",
      leapNow,
    );
    const previous = buildPreviousYearSalesTrendWindow(MARKETPLACE_ID, current);

    expect(current.dateKeys).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(previous.dateKeys).toEqual(["2023-02-28", "2023-03-01"]);
    expect(new Set(previous.dateKeys).size).toBe(previous.dateKeys.length);
    expect(previous.dateKeys.filter((date) => date === "2023-02-28")).toHaveLength(1);
  });

  it("filters a raw 91-day leap-year query to the 90 exactly comparable dates", async () => {
    const now = new Date("2025-03-31T19:00:00.000Z");
    const current = buildCustomSalesTrendWindow(
      MARKETPLACE_ID,
      "2025-01-01",
      "2025-03-31",
      now,
    );
    const rawPrevious = buildPreviousYearSalesTrendWindow(MARKETPLACE_ID, current);
    expect(current.dateKeys).toHaveLength(90);
    expect(rawPrevious.dateKeys).toHaveLength(91);
    expect(rawPrevious.dateKeys).toContain("2024-02-29");

    const snapshot = await demoSalesTrendAt(now, {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2025-01-01",
      endDate: "2025-03-31",
      comparison: "previous-year",
    });
    const comparison = snapshot.comparison!;
    expect(comparison.points).toHaveLength(90);
    expect(comparison.points.map((point) => point.date)).not.toContain("2024-02-29");
    expect(comparison.range).toEqual({
      startDate: "2024-01-01",
      endDate: "2024-03-31",
      dayCount: 90,
      presetDays: null,
    });
    expect(comparison.totals.unitCount).toBe(
      comparison.points.reduce((total, point) => total + point.unitCount, 0),
    );
    expect(comparison.totals.totalSales.amount).toBe(
      Number(
        comparison.points
          .reduce((total, point) => total + point.totalSales.amount, 0)
          .toFixed(2),
      ),
    );
  });

  it("leaves today's Feb 29 comparison empty instead of inventing a prior date", async () => {
    const snapshot = await demoSalesTrendAt(
      new Date("2024-02-29T20:00:00.000Z"),
      {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2024-02-29",
        endDate: "2024-02-29",
        comparison: "previous-year",
      },
    );

    expect(snapshot.comparison?.points).toEqual([]);
    expect(snapshot.comparison?.range).toEqual({
      startDate: "2023-02-28",
      endDate: "2023-02-28",
      dayCount: 0,
      presetDays: null,
    });
    expect(snapshot.comparison?.totals).toEqual({
      totalSales: { amount: 0, currencyCode: "USD" },
      unitCount: 0,
      orderItemCount: 0,
      orderCount: 0,
    });
    expect(snapshot.notice).toContain("今天是 2 月 29 日");
    expect(snapshot.notice).toContain("去年同期會留空");
    expect(snapshot.notice).not.toContain("去年同期也只計到相同站點當地時間");
  });

  it("uses a Sales-specific two-second throttle floor and honors Retry-After", () => {
    const fallback = salesTrendRetryDelayMs(
      new Response(null, { status: 429 }),
      0,
      NOW.getTime(),
    );
    expect(fallback).toBeGreaterThanOrEqual(2_000);
    expect(fallback).toBeLessThanOrEqual(2_250);

    expect(
      salesTrendRetryDelayMs(
        new Response(null, { status: 429, headers: { "retry-after": "7" } }),
        0,
        NOW.getTime(),
      ),
    ).toBe(7_000);
    expect(
      salesTrendRetryDelayMs(
        new Response(null, {
          status: 429,
          headers: {
            "retry-after": new Date(NOW.getTime() + 5_000).toUTCString(),
          },
        }),
        0,
        NOW.getTime(),
      ),
    ).toBe(5_000);
  });
});
