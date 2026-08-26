import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fbaInventoryReadIdentity,
  replenishmentReadIdentity,
  type FbaInventoryReadPlan,
} from "../src/main/amazon/fba-inventory-replenishment";
import { createFbaInventoryReplenishmentProductionAdapter } from "../src/main/amazon/fba-inventory-replenishment-production";

const US = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-08-24T00:00:00.000Z");

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

describe("FBA Inventory/Replenishment production adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an item read fixed to the official FBA Inventory GET contract", async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push({
          url: new URL(input instanceof Request ? input.url : String(input)),
          init,
        });
        return jsonResponse(
          200,
          { payload: { inventorySummaries: [] }, pagination: {} },
          {
            "x-amzn-requestid": "inventory-request",
            "x-amzn-ratelimit-limit": "2",
          },
        );
      }),
    );
    const adapter = createFbaInventoryReplenishmentProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
    });
    const plan = {
      intent: "item",
      marketplaceId: US,
      sellerSku: "EXACT-SKU",
      url: "https://attacker.invalid/write",
      method: "PATCH",
      query: { details: "false" },
      body: { dangerous: true },
    } as unknown as FbaInventoryReadPlan;

    await expect(adapter.readInventory(plan)).resolves.toEqual({
      identity: fbaInventoryReadIdentity(plan),
      envelope: { payload: { inventorySummaries: [] }, pagination: {} },
      requestId: "inventory-request",
      rateLimit: "2",
    });

    expect(requests).toHaveLength(1);
    const [{ url, init }] = requests;
    expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(url.pathname).toBe("/fba/inventory/v1/summaries");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(url.searchParams.get("granularityType")).toBe("Marketplace");
    expect(url.searchParams.get("granularityId")).toBe(US);
    expect(url.searchParams.getAll("marketplaceIds")).toEqual([US]);
    expect(url.searchParams.getAll("sellerSkus")).toEqual(["EXACT-SKU"]);
    expect(url.searchParams.get("details")).toBe("true");
    expect(url.hostname).not.toContain("attacker");
  });

  it("keeps a single offer fixed to the exact-SKU Subscribe & Save POST", async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push({
          url: new URL(input instanceof Request ? input.url : String(input)),
          init,
        });
        return jsonResponse(200, { offers: [], pagination: { totalResults: 0 } });
      }),
    );
    const adapter = createFbaInventoryReplenishmentProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
    });
    const plan = {
      intent: "single-offer",
      marketplaceId: US,
      sellerSku: "EXACT-SKU",
      url: "https://attacker.invalid/write",
      method: "DELETE",
      body: { programTypes: ["OTHER"] },
    } as const;

    await expect(adapter.readReplenishment(plan)).resolves.toMatchObject({
      identity: replenishmentReadIdentity(plan),
      envelope: { offers: [], pagination: { totalResults: 0 } },
    });
    expect(requests).toHaveLength(1);
    const [{ url, init }] = requests;
    expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(url.pathname).toBe("/replenishment/2022-11-07/offers/search");
    expect(url.search).toBe("");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      pagination: { limit: 20, offset: 0 },
      filters: {
        marketplaceId: US,
        programTypes: ["SUBSCRIBE_AND_SAVE"],
        skus: ["EXACT-SKU"],
      },
      sort: { order: "ASC", key: "ASIN" },
    });
  });

  it("fixes monthly audit reads to AMAZON fulfillment and never retries a transient failure", async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const sleeps: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push({
          url: new URL(input instanceof Request ? input.url : String(input)),
          init,
        });
        return jsonResponse(
          503,
          { errors: [{ message: "temporary" }] },
          { "x-amzn-requestid": "metric-failure" },
        );
      }),
    );
    const adapter = createFbaInventoryReplenishmentProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });
    const interval = {
      month: "2026-07",
      startDate: "2026-07-01T00:00:00Z",
      endDate: "2026-07-31T00:00:00Z",
    };

    await expect(
      adapter.readReplenishment({
        intent: "metrics-page",
        marketplaceId: US,
        interval,
        offset: 0,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: "metric-failure",
    });

    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
    const [{ url, init }] = requests;
    expect(url.pathname).toBe(
      "/replenishment/2022-11-07/offers/metrics/search",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      pagination: { limit: 500, offset: 0 },
      filters: {
        marketplaceId: US,
        programTypes: ["SUBSCRIBE_AND_SAVE"],
        fulfillmentChannelTypes: ["AMAZON"],
        aggregationFrequency: "MONTH",
        timePeriodType: "PERFORMANCE",
        timeInterval: {
          startDate: interval.startDate,
          endDate: interval.endDate,
        },
      },
    });
  });

  it("allows one item token refresh and shares a two-transient-retry budget", async () => {
    const forceRefreshes: boolean[] = [];
    const invalidations: string[] = [];
    const delays: number[] = [];
    const responses = [
      jsonResponse(401, { errors: [{ message: "expired" }] }),
      jsonResponse(429, {}, { "retry-after": "0" }),
      jsonResponse(500, {}),
      jsonResponse(
        200,
        { payload: { inventorySummaries: [] }, pagination: {} },
        { "x-amzn-requestid": "final" },
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => responses.shift()!),
    );
    const adapter = createFbaInventoryReplenishmentProductionAdapter({
      getAccessToken: async (region, forceRefresh) => {
        forceRefreshes.push(forceRefresh);
        return `${region}-${forceRefresh}`;
      },
      invalidateAccessToken: (region) => invalidations.push(region),
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    await expect(
      adapter.readInventory({
        intent: "item",
        marketplaceId: US,
        sellerSku: "EXACT-SKU",
      }),
    ).resolves.toMatchObject({ requestId: "final" });
    expect(forceRefreshes).toEqual([false, true, false, false]);
    expect(invalidations).toEqual(["na"]);
    expect(delays).toEqual([0, 1_000]);
  });

  it("allows one catalog-page 401 refresh but no transient replay", async () => {
    const forceRefreshes: boolean[] = [];
    const invalidations: string[] = [];
    const delays: number[] = [];
    let calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(401, { errors: [{ message: "expired" }] })
        : jsonResponse(
            503,
            { errors: [{ message: "still unavailable" }] },
            { "x-amzn-requestid": "catalog-final" },
          );
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createFbaInventoryReplenishmentProductionAdapter({
      getAccessToken: async (_region, forceRefresh) => {
        forceRefreshes.push(forceRefresh);
        return "TOKEN";
      },
      invalidateAccessToken: (region) => invalidations.push(region),
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    await expect(
      adapter.readInventory({
        intent: "catalog-page",
        marketplaceId: US,
        nextToken: null,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: "catalog-final",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(forceRefreshes).toEqual([false, true]);
    expect(invalidations).toEqual(["na"]);
    expect(delays).toEqual([]);
  });
});
