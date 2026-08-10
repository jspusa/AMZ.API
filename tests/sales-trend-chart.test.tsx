import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SalesTrendChart, {
  customDayCountError,
  earliestComparableStartDate,
  nearestTrendPointIndex,
  nextSkaterIndex,
  previousYearDateKey,
  salesTrendFailureMessage,
  startDateForDayCount,
  submitTrendCustomRange,
  trendCustomRangeError,
  type SalesTrendPoint,
  type SalesTrendSnapshot,
  type TrendRangeSelection,
} from "../src/renderer/src/components/sales-trend-chart";

function dateKeys(startDate: string, count: number): string[] {
  const [year, month, day] = startDate.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, day + index));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  });
}

function point(date: string, amount: number, index: number, partial = false): SalesTrendPoint {
  return {
    date,
    interval: `${date}T00:00:00-07:00--${date}T23:59:59-07:00`,
    totalSales: { amount, currencyCode: "USD" },
    unitCount: index + 1,
    orderItemCount: index + 1,
    orderCount: index + 1,
    partial,
  };
}

function totals(points: SalesTrendPoint[]) {
  return {
    totalSales: {
      amount: points.reduce((sum, item) => sum + item.totalSales.amount, 0),
      currencyCode: "USD",
    },
    unitCount: points.reduce((sum, item) => sum + item.unitCount, 0),
    orderItemCount: points.reduce((sum, item) => sum + item.orderItemCount, 0),
    orderCount: points.reduce((sum, item) => sum + item.orderCount, 0),
  };
}

function snapshot(input: {
  amounts: number[];
  startDate?: string;
  presetDays?: 7 | 14 | 30 | 90 | null;
  comparisonAmounts?: number[] | null;
  comparisonPoints?: SalesTrendPoint[];
}): SalesTrendSnapshot {
  const presetDays = input.presetDays === undefined
    ? (input.amounts.length as 7 | 14 | 30 | 90)
    : input.presetDays;
  const dates = dateKeys(input.startDate ?? "2026-08-01", input.amounts.length);
  const points = input.amounts.map((amount, index) =>
    point(dates[index], amount, index, index === input.amounts.length - 1),
  );
  const generatedComparison = (input.comparisonAmounts ?? input.amounts.map((amount) => amount * 0.8))
    ?.map((amount, index) => {
      const comparisonDate = previousYearDateKey(dates[index]);
      return comparisonDate ? point(comparisonDate, amount, index) : null;
    })
    .filter((item): item is SalesTrendPoint => item !== null);
  const comparisonPoints = input.comparisonPoints ?? generatedComparison ?? [];
  const comparison = input.comparisonAmounts === null
    ? null
    : {
        kind: "previous-year" as const,
        range: {
          startDate: comparisonPoints[0]?.date ?? "2025-08-01",
          endDate: comparisonPoints.at(-1)?.date ?? "2025-08-07",
          dayCount: comparisonPoints.length,
          presetDays,
        },
        points: comparisonPoints,
        totals: totals(comparisonPoints),
        requestId: null,
        rateLimit: null,
      };

  return {
    schemaVersion: 2,
    mode: "live",
    marketplaceId: "ATVPDKIKX0DER",
    days: input.amounts.length,
    range: {
      startDate: dates[0],
      endDate: dates.at(-1)!,
      dayCount: dates.length,
      presetDays,
    },
    timeZone: "America/Los_Angeles",
    points,
    totals: totals(points),
    comparison,
    fetchedAt: "2026-08-06T00:00:00.000Z",
    requestId: null,
    rateLimit: null,
    notice: "僅包含 Amazon 配送（AFN/FBA），今日數字仍會變動。",
  };
}

function render(input: {
  data?: SalesTrendSnapshot | null;
  selection?: TrendRangeSelection;
  loading?: boolean;
  error?: string | null;
}) {
  return renderToStaticMarkup(
    <SalesTrendChart
      snapshot={input.data ?? null}
      selection={input.selection ?? { kind: "preset", days: 7 }}
      loading={input.loading ?? false}
      error={input.error ?? null}
      onSelectionChange={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
}

describe("sales trend comparison chart", () => {
  it("renders orange current and gray previous-year lines, legend, and a dual-period accessible table", () => {
    const markup = render({
      data: snapshot({ amounts: [10, 20, 15, 30, 25, 35, 18], presetDays: 7 }),
    });

    expect(markup).toContain("每日 FBA 銷售與去年同期比較折線圖");
    expect(markup).toContain('class="sales-trend-line is-current"');
    expect(markup).toContain('class="sales-trend-line is-comparison"');
    expect(markup).toContain("本期 2026");
    expect(markup).toContain("去年同期 2025");
    expect(markup).toContain("sales-trend-a11y-table");
    expect(markup).toContain("sales-trend-plot-scroll");
    expect(markup).toContain("sales-trend-plot");
    expect(markup).toContain("本期銷售額");
    expect(markup).toContain("去年同期銷售額");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("迷你滑板");
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain("sales-skater-controls");
    expect(markup).not.toContain("本頁銷售");
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it("clamps the optional skater to valid chart points", () => {
    expect(nextSkaterIndex(0, -1, 7)).toBe(0);
    expect(nextSkaterIndex(0, 1, 7)).toBe(1);
    expect(nextSkaterIndex(6, 1, 7)).toBe(6);
    expect(nextSkaterIndex(99, -1, 7)).toBe(5);
    expect(nextSkaterIndex(0, 1, 0)).toBe(0);
  });

  it("enables WASD controls across the chart without hijacking text fields", async () => {
    const source = await readFile(
      new URL("../src/renderer/src/components/sales-trend-chart.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('key === "a" || key === "d"');
    expect(source).toContain('key === "w"');
    expect(source).toContain('key === "s"');
    expect(source).toContain('["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)');
    expect(source).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(source).toContain("event.defaultPrevented");
    expect(source).toContain("A D 或左右鍵移動");
    expect(source).toContain('setSkaterMotion(direction < 0 ? "left" : "right")');
    expect(source).toContain("is-rolling");
    expect(source).toContain("const HEIGHT = 250");
    expect(source).toContain("top: 88");
  });

  it("moves performance details below the plot while skater mode is enabled", async () => {
    const [source, css] = await Promise.all([
      readFile(
        new URL("../src/renderer/src/components/sales-trend-chart.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/renderer/src/app.css", import.meta.url), "utf8"),
    ]);

    expect(source).toContain("active ?? skaterCoordinate");
    expect(source).toContain("active && !skaterEnabled && tooltipPlacement");
    expect(source).toContain('className="sales-trend-detail-strip"');
    expect(source).toContain("滑板業績資訊");
    expect(source).toContain("detailCoordinate.comparisonPoint");
    expect(css).toMatch(
      /\.sales-trend-detail-strip\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/s,
    );
    expect(css).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.sales-trend-detail-strip\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it("offers 7, 14, 30, and 90 day presets and marks the selected 90-day range", () => {
    const amounts = Array.from({ length: 90 }, (_, index) => 100 + index);
    const markup = render({
      data: snapshot({ amounts, startDate: "2026-05-09", presetDays: 90 }),
      selection: { kind: "preset", days: 90 },
    });

    for (const days of [7, 14, 30, 90]) expect(markup).toContain(`>${days} 天</button>`);
    expect(markup).toContain(">自訂</button>");
    expect(markup).toContain('aria-pressed="true">90 天');
    expect(markup).toContain('class="is-dense"');
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it("renders labeled inclusive custom date controls with an apply action", () => {
    const data = snapshot({
      amounts: [10, 12, 14],
      startDate: "2026-07-01",
      presetDays: null,
    });
    const markup = render({
      data,
      selection: {
        kind: "custom",
        startDate: "2026-07-01",
        endDate: "2026-07-03",
      },
    });

    expect(markup).toContain("開始日");
    expect(markup).toContain("結束日");
    expect(markup).toContain("最近天數");
    expect(markup).toContain('type="number"');
    expect(markup).toContain('min="1"');
    expect(markup).toContain('max="365"');
    expect(markup).toContain('value="3"');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('value="2026-07-01"');
    expect(markup).toContain('value="2026-07-03"');
    expect(markup).toContain(">套用</button>");
    expect(markup).toContain("可直接輸入 1–365 天");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>自訂/);
    expect(trendCustomRangeError("2026-07-01", "2026-07-03")).toBeNull();
    expect(trendCustomRangeError("2026-07-03", "2026-07-01")).toContain("不可早於");
    expect(trendCustomRangeError("2026-01-01", "2026-04-01")).toBeNull();
    expect(trendCustomRangeError("2025-03-11", "2026-03-10")).toBeNull();
    expect(trendCustomRangeError("2025-03-10", "2026-03-10")).toContain("最多 365 天");
    expect(customDayCountError("1")).toBeNull();
    expect(customDayCountError("365")).toBeNull();
    expect(customDayCountError("0")).toContain("1 到 365");
    expect(customDayCountError("366")).toContain("1 到 365");
    expect(customDayCountError("1.5")).toContain("整數");
    expect(startDateForDayCount("2026-08-07", 1)).toBe("2026-08-07");
    expect(startDateForDayCount("2026-08-07", 365)).toBe("2025-08-08");
    expect(startDateForDayCount("2026-08-07", 366)).toBeNull();
  });

  it("keeps a preset-derived earliest date for a queryable previous-year comparison", () => {
    const data = snapshot({
      amounts: [10, 12, 14, 16, 18, 20, 22],
      startDate: "2026-08-01",
      presetDays: 7,
    });
    const markup = render({
      data,
      selection: {
        kind: "custom",
        startDate: "2025-08-07",
        endDate: "2025-08-10",
      },
    });

    expect(earliestComparableStartDate("2026-08-07")).toBe("2025-08-08");
    expect(earliestComparableStartDate("2024-02-29")).toBe("2023-03-01");
    expect(markup.match(/min="2025-08-08"/g)).toHaveLength(2);
    expect(markup.match(/max="2026-08-07"/g)).toHaveLength(2);
    expect(markup).toContain("開始日最早為 2025-08-08");
    expect(markup).toContain("目前資料截至 2026-08-07");
    expect(markup).toMatch(/<button type="button">套用<\/button>/);
    expect(
      trendCustomRangeError("2025-08-07", "2025-08-10", "2025-08-08"),
    ).toContain("開始日最早可選 2025-08-08");
    expect(
      trendCustomRangeError("2025-08-08", "2025-08-10", "2025-08-08"),
    ).toBeNull();
  });

  it("rejects dates after the latest snapshot day without notifying the dashboard", () => {
    const latestAvailableDate = "2026-08-07";
    const earliestStartDate = "2025-08-08";
    const onSelectionChange = vi.fn();

    expect(
      trendCustomRangeError(
        "2026-08-01",
        "2026-08-08",
        earliestStartDate,
        latestAvailableDate,
      ),
    ).toBe(
      "目前僅有截至 2026-08-07 的資料；之後日期尚未有資料，請調整結束日。",
    );
    expect(
      submitTrendCustomRange({
        startDate: "2026-08-01",
        endDate: "2026-08-08",
        earliestStartDate,
        latestAvailableDate,
        currentSelection: { kind: "preset", days: 7 },
        onSelectionChange,
      }),
    ).toBe(false);
    expect(onSelectionChange).not.toHaveBeenCalled();

    expect(
      submitTrendCustomRange({
        startDate: "2026-08-01",
        endDate: latestAvailableDate,
        earliestStartDate,
        latestAvailableDate,
        currentSelection: { kind: "preset", days: 7 },
        onSelectionChange,
      }),
    ).toBe(true);
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: "custom",
      startDate: "2026-08-01",
      endDate: latestAvailableDate,
    });
  });

  it("aligns comparison points by calendar date and leaves February 29 as a gap", () => {
    const comparisonPoints = [
      point("2023-02-28", 8, 0),
      point("2023-03-01", 12, 1),
    ];
    const markup = render({
      data: snapshot({
        amounts: [10, 20, 30],
        startDate: "2024-02-28",
        presetDays: null,
        comparisonPoints,
      }),
      selection: {
        kind: "custom",
        startDate: "2024-02-28",
        endDate: "2024-03-01",
      },
    });

    expect(previousYearDateKey("2024-02-29")).toBeNull();
    expect(previousYearDateKey("2024-03-01")).toBe("2023-03-01");
    expect(markup).toContain("2024-02-29");
    expect(markup).toContain("無對應日期");
    const comparisonPath = markup.match(/sales-trend-line is-comparison[^>]+d="([^"]+)"/)?.[1];
    expect(comparisonPath?.match(/M/g)).toHaveLength(2);
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it("keeps an all-zero comparison valid without invalid SVG coordinates", () => {
    const markup = render({ data: snapshot({ amounts: [0, 0, 0, 0, 0, 0, 0] }) });

    expect(markup).toContain("這兩段期間尚無 FBA 銷售");
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it("separates loading and API errors from chart data", () => {
    expect(render({ loading: true })).toContain("正在彙整每日 FBA 銷售");
    const errorMarkup = render({ error: "請安裝新版 AMZ.API。" });
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("請安裝新版 AMZ.API");
  });

  it("maps pointer positions to one clamped point index without adding per-point tab stops", () => {
    expect(nearestTrendPointIndex(100, 100, 700, 90)).toBe(0);
    expect(nearestTrendPointIndex(800, 100, 700, 90)).toBe(89);
    expect(nearestTrendPointIndex(473, 100, 700, 90)).toBe(45);
    expect(nearestTrendPointIndex(0, 0, 0, 90)).toBeNull();

    const markup = render({ data: snapshot({ amounts: [10, 20, 30, 40, 50, 60, 70] }) });
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toContain("sales-trend-hit-overlay");
  });

  it("keeps mobile plot text readable and the zero-state overlay pointer-transparent", async () => {
    const css = await readFile(
      new URL("../src/renderer/src/app.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain(".sales-trend-plot-scroll");
    expect(css).toContain(".sales-trend-plot { min-width: 640px; }");
    expect(css).toMatch(
      /\.sales-trend svg\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;[^}]*min-height:\s*0;/s,
    );
    expect(css).toMatch(/\.sales-trend-zero\s*\{[^}]*pointer-events:\s*none;/s);
  });

  it("reveals an invalid custom-range alert before returning and never disables apply for validation", async () => {
    const source = await readFile(
      new URL(
        "../src/renderer/src/components/sales-trend-chart.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const applyStart = source.indexOf("const applyCustomRange");
    const touched = source.indexOf("setCustomTouched(true);", applyStart);
    const validationReturn = source.indexOf(
      "if (loading || customError) return;",
      applyStart,
    );
    const submission = source.indexOf("submitTrendCustomRange({", applyStart);

    expect(applyStart).toBeGreaterThan(-1);
    expect(touched).toBeGreaterThan(applyStart);
    expect(validationReturn).toBeGreaterThan(touched);
    expect(submission).toBeGreaterThan(validationReturn);
    expect(source).toContain("onClick={applyCustomRange}");
    expect(source).toContain("disabled={loading}");
    expect(source).not.toContain("disabled={loading || Boolean(customError)}");
  });

  it("only treats the old bridge NOT_FOUND response as an upgrade prompt", () => {
    expect(
      salesTrendFailureMessage(404, {
        code: "NOT_FOUND",
        message: "此 App 版本不支援這個操作。",
      }),
    ).toContain("請安裝新版");
    expect(
      salesTrendFailureMessage(404, {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Amazon 暫時無法完成 FBA 銷售趨勢查詢。",
      }),
    ).toBe("Amazon 暫時無法完成 FBA 銷售趨勢查詢。");
  });
});
