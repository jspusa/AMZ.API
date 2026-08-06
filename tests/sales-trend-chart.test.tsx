import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SalesTrendChart, {
  salesTrendFailureMessage,
  type SalesTrendSnapshot,
} from "../src/renderer/src/components/sales-trend-chart";

function snapshot(amounts: number[]): SalesTrendSnapshot {
  const points = amounts.map((amount, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    interval: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00-07:00--2026-08-${String(index + 2).padStart(2, "0")}T00:00:00-07:00`,
    totalSales: { amount, currencyCode: "USD" },
    unitCount: index + 1,
    orderItemCount: index + 1,
    orderCount: index + 1,
    partial: index === amounts.length - 1,
  }));
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const count = points.reduce((sum, point) => sum + point.unitCount, 0);
  return {
    mode: "live",
    marketplaceId: "ATVPDKIKX0DER",
    days: 7,
    timeZone: "America/Los_Angeles",
    points,
    totals: {
      totalSales: { amount: total, currencyCode: "USD" },
      unitCount: count,
      orderItemCount: count,
      orderCount: count,
    },
    fetchedAt: "2026-08-06T00:00:00.000Z",
    requestId: null,
    rateLimit: null,
    notice: "僅包含 Amazon 配送（AFN/FBA），今日數字仍會變動。",
  };
}

function render(input: {
  data?: SalesTrendSnapshot | null;
  loading?: boolean;
  error?: string | null;
}) {
  return renderToStaticMarkup(
    <SalesTrendChart
      snapshot={input.data ?? null}
      days={7}
      loading={input.loading ?? false}
      error={input.error ?? null}
      onDaysChange={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
}

describe("sales trend chart", () => {
  it("renders a line chart, selected range, and accessible daily table", () => {
    const markup = render({ data: snapshot([10, 20, 15, 30, 25, 35, 18]) });

    expect(markup).toContain("最近 7 天每日 FBA 銷售折線圖");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("sales-trend-a11y-table");
    expect(markup).toContain("今日即時");
    expect(markup).not.toContain("本頁銷售");
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it("keeps an all-zero period valid without invalid SVG coordinates", () => {
    const markup = render({ data: snapshot([0, 0, 0, 0, 0, 0, 0]) });

    expect(markup).toContain("這段期間尚無 FBA 銷售");
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it("separates loading and API errors from the orders table", () => {
    expect(render({ loading: true })).toContain("正在彙整每日 FBA 銷售");
    const errorMarkup = render({ error: "請安裝新版 Mac App。" });
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("請安裝新版 Mac App");
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
