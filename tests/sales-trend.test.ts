import { describe, expect, it, vi } from "vitest";
import { getSalesTrend } from "../src/main/amazon/sp-api";
import {
  MAX_SALES_TREND_DAY_COUNT,
  planFbaSalesTrend,
} from "../src/main/amazon/fba-sales-calendar";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");

function presetWindow(days: 7 | 14 | 30 | 90, now = NOW) {
  return planFbaSalesTrend({ marketplaceId: MARKETPLACE_ID, days }, now).window;
}

function customPlan(startDate: string, endDate: string, now = NOW) {
  return planFbaSalesTrend(
    { marketplaceId: MARKETPLACE_ID, startDate, endDate },
    now,
  );
}

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
  it("uses marketplace calendar days and preserves DST offsets", () => {
    const window = presetWindow(7);

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

  it("accepts the supported 7, 14, 30, and 90 day presets", () => {
    expect(presetWindow(14).dateKeys).toHaveLength(14);
    expect(presetWindow(30).dateKeys).toHaveLength(30);
    expect(presetWindow(90).dateKeys).toHaveLength(90);
    expect(() => presetWindow(10 as 7)).toThrow(
      "銷售趨勢只支援最近 7、14、30 或 90 天",
    );
  });

  it("builds inclusive custom ranges and does not mark historical tails partial", () => {
    const window = customPlan("2026-02-01", "2026-02-03").window;

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

  });

  it("accepts 365 custom days but rejects 366 before issuing a Sales API request", () => {
    expect(MAX_SALES_TREND_DAY_COUNT).toBe(365);
    expect(
      planFbaSalesTrend(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2025-03-11",
          endDate: "2026-03-10",
        },
        NOW,
      ).range,
    ).toEqual({
      startDate: "2025-03-11",
      endDate: "2026-03-10",
      dayCount: 365,
      presetDays: null,
    });
    expect(() =>
      planFbaSalesTrend(
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
      planFbaSalesTrend(
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
      planFbaSalesTrend(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2026-3-01",
          endDate: "2026-03-10",
        },
        NOW,
      ),
    ).toThrow("自訂日期必須使用 YYYY-MM-DD 格式");

    expect(() =>
      planFbaSalesTrend(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2026-03-10",
          endDate: "2026-03-11",
        },
        NOW,
      ),
    ).toThrow("自訂日期不可包含未來日期");

    expect(() =>
      planFbaSalesTrend(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2024-03-10",
          endDate: "2024-03-10",
        },
        NOW,
      ),
    ).toThrow("開始日必須晚於距今兩年的同一站點日期");
    expect(
      planFbaSalesTrend(
        {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2024-03-11",
          endDate: "2024-03-11",
        },
        NOW,
      ).range.dayCount,
    ).toBe(1);
  });

  it("uses the same marketplace-local cutoff for the previous-year series", () => {
    const plan = planFbaSalesTrend(
      { marketplaceId: MARKETPLACE_ID, days: 7, comparison: "previous-year" },
      NOW,
    );
    const previous = plan.comparisonWindow!;
    expect(previous.range).toEqual({
      startDate: "2025-03-04",
      endDate: "2025-03-10",
      dayCount: 7,
      presetDays: null,
    });
    expect(previous.endAt).toBe("2025-03-10T05:00:00-07:00");
    expect(previous.partialDateKey).toBe("2025-03-10");
  });

  it("keeps leap-day comparison dates unique instead of mapping Feb 29 onto Feb 28", () => {
    const leapNow = new Date("2024-03-02T20:00:00.000Z");
    const plan = planFbaSalesTrend(
      {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2024-02-28",
        endDate: "2024-03-01",
        comparison: "previous-year",
      },
      leapNow,
    );
    const current = plan.window;
    const previous = plan.comparisonWindow!;

    expect(current.dateKeys).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(previous.dateKeys).toEqual(["2023-02-28", "2023-03-01"]);
    expect(new Set(previous.dateKeys).size).toBe(previous.dateKeys.length);
    expect(previous.dateKeys.filter((date) => date === "2023-02-28")).toHaveLength(1);
  });

  it("filters a raw 91-day leap-year query to the 90 exactly comparable dates", async () => {
    const now = new Date("2025-03-31T19:00:00.000Z");
    const plan = planFbaSalesTrend(
      {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2025-01-01",
        endDate: "2025-03-31",
        comparison: "previous-year",
      },
      now,
    );
    const current = plan.window;
    const rawPrevious = plan.comparisonWindow!;
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

});
