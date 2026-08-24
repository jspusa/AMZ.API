import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readFbaSalesTrend,
  type FbaSalesDailyReadPlan,
  type FbaSalesDailyReadResult,
  type FbaSalesMetricsAdapter,
} from "../src/main/amazon/fba-sales-metrics";
import { planFbaSalesTrend } from "../src/main/amazon/fba-sales-calendar";
import { createDeterministicFbaSalesMetricsDemoAdapter } from "../src/main/amazon/fba-sales-metrics-demo";
import { createFbaSalesMetricsProductionAdapter } from "../src/main/amazon/fba-sales-metrics-production";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");

class ScriptedFbaSalesMetricsAdapter implements FbaSalesMetricsAdapter {
  readonly requests: FbaSalesDailyReadPlan[] = [];

  constructor(private readonly results: FbaSalesDailyReadResult[]) {}

  async readDaily(plan: FbaSalesDailyReadPlan): Promise<FbaSalesDailyReadResult> {
    this.requests.push(plan);
    const result = this.results.shift();
    if (!result) throw new Error("Missing scripted FBA Sales Metrics result.");
    return result;
  }
}

function metric(interval: string, amount: string, units: number) {
  return {
    interval,
    unitCount: units,
    orderItemCount: units,
    orderCount: Math.max(1, units - 1),
    totalSales: { amount, currencyCode: "USD" },
  };
}

describe("FBA Sales Metrics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a semantic Daily-AFN trend and normalizes scripted raw envelopes", async () => {
    const planned = planFbaSalesTrend(
      { marketplaceId: MARKETPLACE_ID, days: 7 },
      NOW,
    );
    const adapter = new ScriptedFbaSalesMetricsAdapter([
      {
        envelope: {
          payload: [
            metric(planned.window.intervals[0], "35.98", 2),
            metric(planned.window.intervals[6], "53.97", 3),
          ],
        },
        requestId: "request-current",
        rateLimit: "0.5",
      },
    ]);

    const snapshot = await readFbaSalesTrend(
      { marketplaceId: MARKETPLACE_ID, days: 7 },
      {
        adapter,
        mode: "live",
        clock: () => new Date(NOW),
      },
    );

    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]).toMatchObject({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: null,
      series: "current",
      trendDayCount: 7,
    });
    for (const transportKey of [
      "host",
      "path",
      "method",
      "granularity",
      "buyerType",
      "fulfillmentNetwork",
    ]) {
      expect(adapter.requests[0]).not.toHaveProperty(transportKey);
    }
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      days: 7,
      requestId: "request-current",
      rateLimit: "0.5",
      totals: {
        totalSales: { amount: 89.95, currencyCode: "USD" },
        unitCount: 5,
        orderItemCount: 5,
        orderCount: 3,
      },
    });
    expect(snapshot.points).toHaveLength(7);
    expect(snapshot.points[1].totalSales.amount).toBe(0);
    expect(snapshot.points[6].partial).toBe(true);
  });

  it("reads and aligns the previous-year series through the same adapter", async () => {
    const planned = planFbaSalesTrend(
      {
        marketplaceId: MARKETPLACE_ID,
        days: 7,
        comparison: "previous-year",
      },
      NOW,
    );
    const previousWindow = planned.comparisonWindow!;
    const adapter = new ScriptedFbaSalesMetricsAdapter([
      {
        envelope: { payload: [] },
        requestId: "request-current",
        rateLimit: "0.5",
      },
      {
        envelope: {
          payload: [metric(previousWindow.intervals[0], "25.50", 2)],
        },
        requestId: "request-previous",
        rateLimit: "0.4",
      },
    ]);

    const snapshot = await readFbaSalesTrend(
      {
        marketplaceId: MARKETPLACE_ID,
        days: 7,
        comparison: "previous-year",
      },
      {
        adapter,
        mode: "live",
        clock: () => new Date(NOW),
      },
    );

    expect(adapter.requests.map(({ series }) => series)).toEqual([
      "current",
      "previous-year",
    ]);
    expect(snapshot.comparison).toMatchObject({
      kind: "previous-year",
      range: previousWindow.range,
      requestId: "request-previous",
      rateLimit: "0.4",
      totals: {
        totalSales: { amount: 25.5, currencyCode: "USD" },
        unitCount: 2,
      },
    });
    expect(snapshot.comparison?.points).toHaveLength(7);
    expect(snapshot.notice).toContain("去年同期也只計到相同站點當地時間");
  });

  it("builds deterministic demo data as a raw envelope before normalization", async () => {
    const createSnapshot = () =>
      readFbaSalesTrend(
        {
          marketplaceId: MARKETPLACE_ID,
          days: 7,
          comparison: "previous-year",
        },
        {
          adapter: createDeterministicFbaSalesMetricsDemoAdapter(),
          mode: "demo",
          clock: () => new Date(NOW),
          demoNotice: "展示資料。",
        },
      );

    const first = await createSnapshot();
    const second = await createSnapshot();

    expect(first).toEqual(second);
    expect(first.mode).toBe("demo");
    expect(first.points).toHaveLength(7);
    expect(first.points.every((point) => point.totalSales.amount > 0)).toBe(true);
    expect(first.comparison?.points).toHaveLength(7);
    expect(first.notice).toContain("展示資料。");
  });

  it("keeps the production request fixed to GET Daily-All-AFN", async () => {
    const planned = planFbaSalesTrend(
      { marketplaceId: MARKETPLACE_ID, days: 7 },
      NOW,
    );
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push({
          url: new URL(input instanceof Request ? input.url : String(input)),
          init,
        });
        return new Response(JSON.stringify({ payload: [] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-amzn-requestid": "request-live",
            "x-amzn-ratelimit-limit": "0.5",
          },
        });
      }),
    );
    const adapter = createFbaSalesMetricsProductionAdapter({
      getAccessToken: async () => "FAKE_ACCESS_TOKEN",
      invalidateAccessToken: () => undefined,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
    });

    const result = await adapter.readDaily({
      marketplaceId: MARKETPLACE_ID,
      window: planned.window,
      sellerSku: null,
      series: "current",
      trendDayCount: 7,
    });

    expect(requests).toHaveLength(1);
    const [{ url, init }] = requests;
    expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(url.pathname).toBe("/sales/v1/orderMetrics");
    expect(init?.method ?? "GET").toBe("GET");
    expect(url.searchParams.getAll("marketplaceIds")).toEqual([
      MARKETPLACE_ID,
    ]);
    expect(url.searchParams.get("interval")).toBe(
      `${planned.window.startAt}--${planned.window.endAt}`,
    );
    expect(url.searchParams.get("granularityTimeZone")).toBe(
      planned.window.timeZone,
    );
    expect(url.searchParams.get("granularity")).toBe("Day");
    expect(url.searchParams.get("buyerType")).toBe("All");
    expect(url.searchParams.get("fulfillmentNetwork")).toBe("AFN");
    expect(url.searchParams.has("sku")).toBe(false);
    expect(result).toEqual({
      envelope: { payload: [] },
      requestId: "request-live",
      rateLimit: "0.5",
    });
  });

  it.each([
    ["duplicate date", (interval: string) => ({
      payload: [metric(interval, "10", 1), metric(interval, "11", 1)],
    })],
    ["wrong currency", (interval: string) => ({
      payload: [{
        ...metric(interval, "10", 1),
        totalSales: { amount: "10", currencyCode: "CAD" },
      }],
    })],
    ["malformed row", () => ({ payload: [null] })],
  ])("fails closed on a %s raw envelope", async (_label, envelope) => {
    const planned = planFbaSalesTrend(
      { marketplaceId: MARKETPLACE_ID, days: 7 },
      NOW,
    );
    const adapter = new ScriptedFbaSalesMetricsAdapter([
      {
        envelope: envelope(planned.window.intervals[0]),
        requestId: "request-invalid",
        rateLimit: null,
      },
    ]);

    await expect(
      readFbaSalesTrend(
        { marketplaceId: MARKETPLACE_ID, days: 7 },
        {
          adapter,
          mode: "live",
          clock: () => new Date(NOW),
        },
      ),
    ).rejects.toMatchObject({
      name: "FbaSalesMetricsError",
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Amazon 回傳了無法辨識的 FBA 銷售趨勢。",
    });
  });
});
