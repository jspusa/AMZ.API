import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Dashboard, {
  DEFAULT_MARKETPLACE_ID,
  connectionEvidenceAfterHealthRefresh,
  connectionEvidenceFromConnectionTest,
  connectionEvidenceFromHealth,
  connectionEvidenceFromSales,
  dashboardConnectionBadgeCopy,
  isSalesTrendSnapshotForSelection,
  salesTrendQuery,
  shouldRunExactConnectionProbe,
} from "../src/renderer/src/components/dashboard";
import type {
  SalesTrendPoint,
  SalesTrendSnapshot,
  TrendRangeSelection,
} from "../src/renderer/src/components/sales-trend-chart";

const SELECTION: TrendRangeSelection = { kind: "preset", days: 7 };

function points(year: number): SalesTrendPoint[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const nextDay = String(index + 2).padStart(2, "0");
    return {
      date: `${year}-08-${day}`,
      interval: `${year}-08-${day}T00:00:00-07:00--${year}-08-${nextDay}T00:00:00-07:00`,
      totalSales: { amount: 100 + index, currencyCode: "USD" },
      unitCount: 2,
      orderItemCount: 2,
      orderCount: 1,
      partial: index === 6,
    };
  });
}

function pointTotals(input: SalesTrendPoint[]) {
  return {
    totalSales: {
      amount: input.reduce((sum, point) => sum + point.totalSales.amount, 0),
      currencyCode: input[0]?.totalSales.currencyCode ?? "USD",
    },
    unitCount: input.reduce((sum, point) => sum + point.unitCount, 0),
    orderItemCount: input.reduce((sum, point) => sum + point.orderItemCount, 0),
    orderCount: input.reduce((sum, point) => sum + point.orderCount, 0),
  };
}

function dateRangePoints(startDate: string, dayCount: number): SalesTrendPoint[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const nextDate = new Date(date);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const dateKey = date.toISOString().slice(0, 10);
    const nextDateKey = nextDate.toISOString().slice(0, 10);
    return {
      date: dateKey,
      interval: `${dateKey}T00:00:00Z--${nextDateKey}T00:00:00Z`,
      totalSales: { amount: 100 + index, currencyCode: "USD" },
      unitCount: 2,
      orderItemCount: 2,
      orderCount: 1,
      partial: false,
    };
  });
}

function snapshot(): SalesTrendSnapshot {
  const currentPoints = points(2026);
  const previousPoints = points(2025);
  const totals = {
    totalSales: { amount: 721, currencyCode: "USD" },
    unitCount: 14,
    orderItemCount: 14,
    orderCount: 7,
  };
  return {
    schemaVersion: 2,
    mode: "live",
    marketplaceId: DEFAULT_MARKETPLACE_ID,
    days: 7,
    timeZone: "America/Los_Angeles",
    range: {
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      dayCount: 7,
      presetDays: 7,
    },
    points: currentPoints,
    totals,
    comparison: {
      kind: "previous-year",
      range: {
        startDate: "2025-08-01",
        endDate: "2025-08-07",
        dayCount: 7,
        presetDays: null,
      },
      points: previousPoints,
      totals,
      requestId: null,
      rateLimit: "0.5",
    },
    fetchedAt: "2026-08-07T12:00:00.000Z",
    requestId: null,
    rateLimit: "0.5",
    notice: "僅包含 Amazon 配送（AFN/FBA）。",
  };
}

describe("dashboard operations pulse data flow", () => {
  it("builds only the version-two sales trend query with previous-year comparison", () => {
    const preset = salesTrendQuery(DEFAULT_MARKETPLACE_ID, SELECTION);
    expect(preset.get("marketplaceId")).toBe(DEFAULT_MARKETPLACE_ID);
    expect(preset.get("days")).toBe("7");
    expect(preset.get("comparison")).toBe("previous-year");
    expect(preset.has("startDate")).toBe(false);
    expect(preset.has("endDate")).toBe(false);

    const custom = salesTrendQuery(DEFAULT_MARKETPLACE_ID, {
      kind: "custom",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
    expect(custom.get("startDate")).toBe("2026-07-01");
    expect(custom.get("endDate")).toBe("2026-07-31");
    expect(custom.get("comparison")).toBe("previous-year");
    expect(custom.has("days")).toBe(false);
  });

  it("fails closed for old, mismatched, or comparison-free bridge responses", () => {
    const valid = snapshot();
    expect(
      isSalesTrendSnapshotForSelection(valid, DEFAULT_MARKETPLACE_ID, SELECTION),
    ).toBe(true);

    expect(
      isSalesTrendSnapshotForSelection(
        { ...valid, schemaVersion: 1 },
        DEFAULT_MARKETPLACE_ID,
        SELECTION,
      ),
    ).toBe(false);
    expect(
      isSalesTrendSnapshotForSelection(
        { ...valid, marketplaceId: "A1VC38T7YXB528" },
        DEFAULT_MARKETPLACE_ID,
        SELECTION,
      ),
    ).toBe(false);
    expect(
      isSalesTrendSnapshotForSelection(
        { ...valid, comparison: null },
        DEFAULT_MARKETPLACE_ID,
        SELECTION,
      ),
    ).toBe(false);
    expect(
      isSalesTrendSnapshotForSelection(
        { ...valid, range: { ...valid.range, presetDays: 14 } },
        DEFAULT_MARKETPLACE_ID,
        SELECTION,
      ),
    ).toBe(false);

    const wrongComparisonPoints = points(2024);
    expect(
      isSalesTrendSnapshotForSelection(
        {
          ...valid,
          comparison: {
            ...valid.comparison!,
            range: {
              startDate: "2024-08-01",
              endDate: "2024-08-07",
              dayCount: 7,
              presetDays: null,
            },
            points: wrongComparisonPoints,
            totals: pointTotals(wrongComparisonPoints),
          },
        },
        DEFAULT_MARKETPLACE_ID,
        SELECTION,
      ),
    ).toBe(false);

    expect(
      isSalesTrendSnapshotForSelection(
        {
          ...valid,
          totals: {
            ...valid.totals,
            totalSales: {
              ...valid.totals.totalSales,
              amount: valid.totals.totalSales.amount + 1,
            },
          },
        },
        DEFAULT_MARKETPLACE_ID,
        SELECTION,
      ),
    ).toBe(false);

    expect(
      isSalesTrendSnapshotForSelection(
        {
          ...valid,
          comparison: {
            ...valid.comparison!,
            points: valid.comparison!.points.map((point) => ({
              ...point,
              totalSales: { ...point.totalSales, currencyCode: "CAD" },
            })),
            totals: {
              ...valid.comparison!.totals,
              totalSales: {
                ...valid.comparison!.totals.totalSales,
                currencyCode: "CAD",
              },
            },
          },
        },
        DEFAULT_MARKETPLACE_ID,
        SELECTION,
      ),
    ).toBe(false);
  });

  it("accepts a zero-point comparison when the only current day is February 29", () => {
    const currentPoint: SalesTrendPoint = {
      date: "2024-02-29",
      interval:
        "2024-02-29T00:00:00-08:00--2024-03-01T00:00:00-08:00",
      totalSales: { amount: 25, currencyCode: "USD" },
      unitCount: 2,
      orderItemCount: 2,
      orderCount: 1,
      partial: false,
    };
    const leapSnapshot: SalesTrendSnapshot = {
      ...snapshot(),
      days: 1,
      range: {
        startDate: "2024-02-29",
        endDate: "2024-02-29",
        dayCount: 1,
        presetDays: null,
      },
      points: [currentPoint],
      totals: pointTotals([currentPoint]),
      comparison: {
        kind: "previous-year",
        range: {
          startDate: "2023-02-28",
          endDate: "2023-02-28",
          dayCount: 0,
          presetDays: null,
        },
        points: [],
        totals: {
          totalSales: { amount: 0, currencyCode: "USD" },
          unitCount: 0,
          orderItemCount: 0,
          orderCount: 0,
        },
        requestId: null,
        rateLimit: null,
      },
    };

    expect(
      isSalesTrendSnapshotForSelection(
        leapSnapshot,
        DEFAULT_MARKETPLACE_ID,
        {
          kind: "custom",
          startDate: "2024-02-29",
          endDate: "2024-02-29",
        },
      ),
    ).toBe(true);
  });

  it("accepts exact previous-year points that sparsely cross an excluded February 29", () => {
    const currentPoints = dateRangePoints("2025-01-01", 90);
    const comparisonPoints = currentPoints.map((point) => {
      const date = `2024${point.date.slice(4)}`;
      return {
        ...point,
        date,
        interval: `${date}T00:00:00Z--${date}T23:59:59Z`,
      };
    });
    const sparseSnapshot: SalesTrendSnapshot = {
      ...snapshot(),
      days: 90,
      range: {
        startDate: "2025-01-01",
        endDate: "2025-03-31",
        dayCount: 90,
        presetDays: null,
      },
      points: currentPoints,
      totals: pointTotals(currentPoints),
      comparison: {
        kind: "previous-year",
        range: {
          startDate: "2024-01-01",
          endDate: "2024-03-31",
          dayCount: 90,
          presetDays: null,
        },
        points: comparisonPoints,
        totals: pointTotals(comparisonPoints),
        requestId: null,
        rateLimit: null,
      },
    };
    const selection: TrendRangeSelection = {
      kind: "custom",
      startDate: "2025-01-01",
      endDate: "2025-03-31",
    };

    expect(comparisonPoints.map((point) => point.date)).not.toContain("2024-02-29");
    expect(
      isSalesTrendSnapshotForSelection(
        sparseSnapshot,
        DEFAULT_MARKETPLACE_ID,
        selection,
      ),
    ).toBe(true);

    expect(
      isSalesTrendSnapshotForSelection(
        {
          ...sparseSnapshot,
          comparison: {
            ...sparseSnapshot.comparison!,
            range: { ...sparseSnapshot.comparison!.range, dayCount: 91 },
          },
        },
        DEFAULT_MARKETPLACE_ID,
        selection,
      ),
    ).toBe(false);

    const unexpectedLeapPoint = {
      ...comparisonPoints[58],
      date: "2024-02-29",
    };
    expect(
      isSalesTrendSnapshotForSelection(
        {
          ...sparseSnapshot,
          comparison: {
            ...sparseSnapshot.comparison!,
            range: { ...sparseSnapshot.comparison!.range, dayCount: 91 },
            points: [
              ...comparisonPoints.slice(0, 59),
              unexpectedLeapPoint,
              ...comparisonPoints.slice(59),
            ],
          },
        },
        DEFAULT_MARKETPLACE_ID,
        selection,
      ),
    ).toBe(false);
  });

  it("accepts a complete 365-day paired snapshot but rejects a 366-day bridge payload", () => {
    const currentPoints = dateRangePoints("2025-03-11", 365);
    const comparisonPoints = dateRangePoints("2024-03-11", 365);
    const selection: TrendRangeSelection = {
      kind: "custom",
      startDate: "2025-03-11",
      endDate: "2026-03-10",
    };
    const annualSnapshot: SalesTrendSnapshot = {
      ...snapshot(),
      days: 365,
      range: {
        startDate: "2025-03-11",
        endDate: "2026-03-10",
        dayCount: 365,
        presetDays: null,
      },
      points: currentPoints,
      totals: pointTotals(currentPoints),
      comparison: {
        kind: "previous-year",
        range: {
          startDate: "2024-03-11",
          endDate: "2025-03-10",
          dayCount: 365,
          presetDays: null,
        },
        points: comparisonPoints,
        totals: pointTotals(comparisonPoints),
        requestId: null,
        rateLimit: null,
      },
    };

    expect(
      isSalesTrendSnapshotForSelection(
        annualSnapshot,
        DEFAULT_MARKETPLACE_ID,
        selection,
      ),
    ).toBe(true);

    const tooLongPoints = dateRangePoints("2025-03-10", 366);
    const tooLongComparisonPoints = dateRangePoints("2024-03-10", 366);
    expect(
      isSalesTrendSnapshotForSelection(
        {
          ...annualSnapshot,
          days: 366,
          range: {
            startDate: "2025-03-10",
            endDate: "2026-03-10",
            dayCount: 366,
            presetDays: null,
          },
          points: tooLongPoints,
          totals: pointTotals(tooLongPoints),
          comparison: {
            ...annualSnapshot.comparison!,
            range: {
              startDate: "2024-03-10",
              endDate: "2025-03-10",
              dayCount: 366,
              presetDays: null,
            },
            points: tooLongComparisonPoints,
            totals: pointTotals(tooLongComparisonPoints),
          },
        },
        DEFAULT_MARKETPLACE_ID,
        {
          kind: "custom",
          startDate: "2025-03-10",
          endDate: "2026-03-10",
        },
      ),
    ).toBe(false);
  });

  it("does not mislabel a failed initial Sales request as live or demo", () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={null}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
        initialError="Sales API 暫時無法同步。"
      />,
    );

    expect(markup).toContain("連線狀態待確認");
    expect(markup).toContain("狀態未知");
    expect(markup).toContain("Sales API 暫時無法同步");
    expect(markup).not.toContain('mode-badge live');
    expect(markup).not.toContain('mode-badge demo');
  });

  it("reserves the connected badge for a successful live Amazon read", () => {
    const configured = connectionEvidenceFromHealth(null, "live");
    expect(configured).toBe("configured-live");
    expect(dashboardConnectionBadgeCopy(configured, false)).toEqual({
      title: "Live 憑證已設定",
      detail: "尚未驗證 · 本機安全連線",
      ariaLabel: "Live 憑證已設定，Amazon 尚未驗證",
      className: "configured",
    });

    const verified = connectionEvidenceFromSales("live");
    expect(verified).toBe("verified-live");
    expect(connectionEvidenceFromHealth(verified, "live")).toBe("verified-live");
    expect(dashboardConnectionBadgeCopy(verified, false).title).toBe(
      "Amazon 已連線",
    );

    expect(connectionEvidenceFromSales("demo")).toBe("demo");
    expect(connectionEvidenceFromHealth(null, "demo")).toBe("demo");
    expect(dashboardConnectionBadgeCopy("demo", false).title).toBe("展示資料");
  });

  it("accepts only an exact-marketplace successful main-process connection probe", () => {
    const result = {
      ok: true,
      testedAt: "2026-08-28T00:00:00.000Z",
      marketplaceId: DEFAULT_MARKETPLACE_ID,
      regions: {
        na: {
          ok: true,
          message: "Orders 與 Listings 連線成功。",
          requestId: "connection-request-id",
        },
      },
    } as const;

    expect(
      connectionEvidenceFromConnectionTest(result, DEFAULT_MARKETPLACE_ID),
    ).toBe("verified-live");
    expect(
      connectionEvidenceFromConnectionTest(result, "A2EUQ1WTGCTBG2"),
    ).toBeNull();
    expect(
      connectionEvidenceFromConnectionTest(
        {
          ...result,
          regions: { na: { ...result.regions.na, ok: false } },
        },
        DEFAULT_MARKETPLACE_ID,
      ),
    ).toBeNull();
  });

  it("demotes stale probe evidence while preserving a successful live Sales read", () => {
    expect(
      connectionEvidenceAfterHealthRefresh("verified-live", "live", false),
    ).toBe("configured-live");
    expect(
      connectionEvidenceAfterHealthRefresh("verified-live", "live", true),
    ).toBe("verified-live");
    expect(
      connectionEvidenceAfterHealthRefresh("verified-live", "demo", true),
    ).toBe("demo");
  });

  it("waits for a pending Sales attempt before using the fallback probe", () => {
    expect(shouldRunExactConnectionProbe("live", false, true)).toBe(false);
    expect(shouldRunExactConnectionProbe("live", false, false)).toBe(true);
    expect(shouldRunExactConnectionProbe("live", true, false)).toBe(false);
    expect(shouldRunExactConnectionProbe("demo", false, false)).toBe(false);
  });

  it("asks the trusted Notebook bridge to verify the selected marketplace", async () => {
    const dashboardSource = await readFile(
      new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).toContain(
      "window.fbaOS.credentials.test(targetMarketplaceId)",
    );
  });

  it("places the FBA brand mix beside sales and binds it to the visible range", () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={snapshot()}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
      />,
    );

    expect(markup).toContain("品牌營收占比");
    expect(markup).toContain("2026-08-01 – 2026-08-07");
    expect(markup).toContain("等待自動更新");
    expect(markup).not.toContain("同步品牌");
    expect(markup).toContain('class="operations-overview-grid has-companion"');
    expect(markup).toContain('aria-label="近期營運延伸資訊"');
  });

  it("keeps connection truth separate from a failed Sales refresh", () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={snapshot()}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
        initialError="Sales API 重新同步失敗。"
      />,
    );

    expect(markup).toContain("Amazon 已連線");
    expect(markup).toContain("Live · 本機安全連線");
    expect(markup).toContain("Sales API 重新同步失敗");
    expect(markup).toContain('mode-badge workspace-connection-status live');
    expect(markup).not.toContain('mode-badge demo');
  });

  it("contains no dashboard Orders fetch, filters, pagination, table, or detail drawer", async () => {
    const [appSource, dashboardSource, systemSource] = await Promise.all([
      readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/renderer/src/components/system-health-control.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    const source = `${appSource}\n${dashboardSource}\n${systemSource}`;

    expect(source).not.toContain("/api/sp-api/orders");
    expect(source).not.toContain("loadSnapshot");
    expect(source).not.toContain("pulse-table");
    expect(source).not.toContain("ORDER DETAIL");
    expect(source).not.toContain("pagination-row");
    expect(source).toContain("銷售趨勢自動同步");
    expect(source).toContain("銷售趨勢最後同步");
    expect(appSource).toContain("abortRef.current?.abort()");
    expect(dashboardSource).toContain("salesTrendAbortRef.current?.abort()");
  });
});
