import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fbaSalesDailyReadIdentity,
  type FbaSalesDailyReadPlan,
} from "../src/main/amazon/fba-sales-metrics";
import { createFbaSalesMetricsProductionAdapter } from "../src/main/amazon/fba-sales-metrics-production";
import {
  planCompletedFbaSalesVelocity,
  planFbaSalesTrend,
} from "../src/main/amazon/fba-sales-calendar";
import type { MarketplaceRegion } from "../src/shared/marketplaces";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");

function dailyPlan(): FbaSalesDailyReadPlan {
  const planned = planFbaSalesTrend(
    { marketplaceId: MARKETPLACE_ID, days: 7 },
    NOW,
  );
  return {
    marketplaceId: MARKETPLACE_ID,
    window: planned.window,
    sellerSku: null,
    series: "current",
    trendDayCount: 7,
  };
}

function velocityPlan(): FbaSalesDailyReadPlan {
  const planned = planCompletedFbaSalesVelocity(
    { marketplaceId: MARKETPLACE_ID, sellerSku: "EXACT-SKU" },
    NOW,
  );
  return {
    marketplaceId: MARKETPLACE_ID,
    window: planned.window,
    sellerSku: planned.sellerSku,
    series: "velocity",
    trendDayCount: planned.completedDayCount,
  };
}

function jsonResponse(
  status: number,
  envelope: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("FBA Sales Metrics production adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends exact-SKU velocity through the fixed GET Daily-All-AFN request", async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push({
          url: new URL(input instanceof Request ? input.url : String(input)),
          init,
        });
        return jsonResponse(200, { payload: [] });
      }),
    );
    const adapter = createFbaSalesMetricsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
    });
    const plan = velocityPlan();

    const result = await adapter.readDaily(plan);

    expect(requests).toHaveLength(1);
    const [{ url, init }] = requests;
    expect(url.pathname).toBe("/sales/v1/orderMetrics");
    expect(init?.method).toBe("GET");
    expect(url.searchParams.get("sku")).toBe("EXACT-SKU");
    expect(url.searchParams.get("granularity")).toBe("Day");
    expect(url.searchParams.get("buyerType")).toBe("All");
    expect(url.searchParams.get("fulfillmentNetwork")).toBe("AFN");
    expect(url.searchParams.get("interval")).toBe(
      `${plan.window.startAt}--${plan.window.endAt}`,
    );
    expect(result.identity).toEqual(fbaSalesDailyReadIdentity(plan));
  });

  it("invalidates and force-refreshes the regional token exactly once after an initial 401", async () => {
    const forceRefreshes: boolean[] = [];
    const invalidations: MarketplaceRegion[] = [];
    const responses = [
      jsonResponse(401, { errors: [{ message: "expired" }] }),
      jsonResponse(200, { payload: [] }, { "x-amzn-requestid": "final" }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => responses.shift()!),
    );
    const adapter = createFbaSalesMetricsProductionAdapter({
      getAccessToken: async (_region, forceRefresh) => {
        forceRefreshes.push(forceRefresh);
        return forceRefresh ? "REFRESHED_TOKEN" : "CACHED_TOKEN";
      },
      invalidateAccessToken: (region) => invalidations.push(region),
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
    });

    await expect(adapter.readDaily(dailyPlan())).resolves.toMatchObject({
      requestId: "final",
    });
    expect(forceRefreshes).toEqual([false, true]);
    expect(invalidations).toEqual(["na"]);
  });

  it("shares one two-retry budget and preserves only the final response metadata", async () => {
    const responses = [
      jsonResponse(429, {}, { "retry-after": "0", "x-amzn-requestid": "first" }),
      jsonResponse(500, {}, { "x-amzn-requestid": "second" }),
      jsonResponse(
        200,
        { payload: [] },
        {
          "x-amzn-requestid": "final",
          "x-amzn-ratelimit-limit": "0.4",
        },
      ),
    ];
    const delays: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createFbaSalesMetricsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    await expect(adapter.readDaily(dailyPlan())).resolves.toEqual({
      identity: fbaSalesDailyReadIdentity(dailyPlan()),
      envelope: { payload: [] },
      requestId: "final",
      rateLimit: "0.4",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([2_000, 1_000]);
  });

  it.each([
    ["delta seconds", "7", 7_000],
    [
      "HTTP date",
      new Date(NOW.getTime() + 8_000).toUTCString(),
      8_000,
    ],
  ])(
    "honors a Sales Retry-After %s through the adapter",
    async (_label, retryAfter, expectedDelay) => {
      const responses = [
        jsonResponse(429, {}, { "retry-after": retryAfter }),
        jsonResponse(200, { payload: [] }),
      ];
      const delays: number[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => responses.shift()!),
      );
      const adapter = createFbaSalesMetricsProductionAdapter({
        getAccessToken: async () => "TOKEN",
        invalidateAccessToken: () => undefined,
        userAgent: () => "AMZ.API/test",
        now: () => new Date(NOW),
        random: () => 0,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      });

      await expect(adapter.readDaily(dailyPlan())).resolves.toMatchObject({
        envelope: { payload: [] },
      });
      expect(delays).toEqual([expectedDelay]);
    },
  );

  it("stops after two transient retries and reports the final upstream failure", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        503,
        { errors: [{ message: "Amazon still unavailable" }] },
        { "x-amzn-requestid": "final-failure" },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createFbaSalesMetricsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      random: () => 0,
      sleep: async () => undefined,
    });

    await expect(adapter.readDaily(dailyPlan())).rejects.toMatchObject({
      name: "FbaSalesMetricsError",
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: "final-failure",
      message: "Amazon still unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not start a token refresh when a retry response becomes 401", async () => {
    const forceRefreshes: boolean[] = [];
    const invalidations: MarketplaceRegion[] = [];
    const responses = [
      jsonResponse(500, {}),
      jsonResponse(401, { errors: [{ message: "expired after retry" }] }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => responses.shift()!),
    );
    const adapter = createFbaSalesMetricsProductionAdapter({
      getAccessToken: async (_region, forceRefresh) => {
        forceRefreshes.push(forceRefresh);
        return "TOKEN";
      },
      invalidateAccessToken: (region) => invalidations.push(region),
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      random: () => 0,
      sleep: async () => undefined,
    });

    await expect(adapter.readDaily(dailyPlan())).rejects.toMatchObject({
      status: 401,
      code: "SALES_METRICS_UNAUTHORIZED",
    });
    expect(forceRefreshes).toEqual([false, false]);
    expect(invalidations).toEqual([]);
  });

  it("maps an aborted request to the existing timeout error without retrying", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw aborted;
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createFbaSalesMetricsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });

    await expect(adapter.readDaily(dailyPlan())).rejects.toEqual(
      expect.objectContaining({
        name: "FbaSalesMetricsError",
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
        message: "Amazon FBA 銷售趨勢查詢逾時，請稍後再試。",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
