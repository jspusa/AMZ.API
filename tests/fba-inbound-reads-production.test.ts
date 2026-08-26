import { describe, expect, it, vi } from "vitest";
import {
  fbaInboundExternalReadIdentity,
  type FbaInboundExternalReadPlan,
} from "../src/main/amazon/fba-inbound-reads";
import { createFbaInboundReadsProductionAdapter } from "../src/main/amazon/fba-inbound-reads-production";

const US = "ATVPDKIKX0DER" as const;
const UK = "A1F83G8C2ARO7P" as const;
const NOW = new Date("2026-08-25T00:00:00.000Z");

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

describe("FBA Inbound production adapter", () => {
  it("fixes v0 shipment and item first/continuation reads to their official GET paths", async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: new URL(input instanceof Request ? input.url : String(input)),
        init,
      });
      return jsonResponse(
        200,
        { payload: { ShipmentData: [], ItemData: [] } },
        { "x-amzn-requestid": `request-${requests.length}` },
      );
    }) as typeof fetch;
    const adapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });
    const plans: FbaInboundExternalReadPlan[] = [
      {
        source: "v0",
        path: "/listings/2021-08-01/items/private",
        method: "PATCH",
        request: {
          kind: "shipments",
          marketplaceId: US,
          queryType: "DATE_RANGE",
          lastUpdatedAfter: "2026-08-01T07:00:00Z",
          lastUpdatedBefore: "2026-08-03T07:00:00Z",
          nextToken: null,
          url: "https://attacker.invalid/private",
          method: "DELETE",
          body: { dangerous: true },
        },
      } as unknown as FbaInboundExternalReadPlan,
      {
        source: "v0",
        request: {
          kind: "shipments",
          marketplaceId: US,
          queryType: "SHIPMENT",
          shipmentStatuses: ["WORKING", "RECEIVING"],
          lastUpdatedAfter: null,
          lastUpdatedBefore: null,
          nextToken: null,
        },
      },
      {
        source: "v0",
        request: {
          kind: "shipments",
          marketplaceId: US,
          queryType: "NEXT_TOKEN",
          lastUpdatedAfter: null,
          lastUpdatedBefore: null,
          nextToken: "OPAQUE-SHIPMENT-CONTINUATION",
        },
      },
      {
        source: "v0",
        request: {
          kind: "items",
          marketplaceId: US,
          shipmentId: "FBA19FIXED001",
          queryType: "SHIPMENT",
          nextToken: null,
        },
      },
      {
        source: "v0",
        request: {
          kind: "items",
          marketplaceId: US,
          shipmentId: "FBA19FIXED001",
          queryType: "NEXT_TOKEN",
          nextToken: "OPAQUE-CONTINUATION",
        },
      },
    ];

    for (const plan of plans) {
      await expect(adapter.read(plan)).resolves.toMatchObject({
        identity: fbaInboundExternalReadIdentity(plan),
        requestId: expect.any(String),
      });
    }

    expect(requests).toHaveLength(5);
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/fba/inbound/v0/shipments",
      "/fba/inbound/v0/shipments",
      "/fba/inbound/v0/shipments",
      "/fba/inbound/v0/shipments/FBA19FIXED001/items",
      "/fba/inbound/v0/shipmentItems",
    ]);
    expect(requests[0].url.searchParams.get("QueryType")).toBe("DATE_RANGE");
    expect(requests[0].url.searchParams.get("MarketplaceId")).toBe(US);
    expect(requests[0].url.searchParams.get("LastUpdatedAfter")).toBe(
      "2026-08-01T07:00:00Z",
    );
    expect(requests[0].url.searchParams.get("LastUpdatedBefore")).toBe(
      "2026-08-03T07:00:00Z",
    );
    expect(requests[0].url.hostname).not.toContain("attacker");
    expect(requests[1].url.searchParams.get("QueryType")).toBe("SHIPMENT");
    expect(requests[1].url.searchParams.get("ShipmentStatusList")).toBe(
      "WORKING,RECEIVING",
    );
    expect(requests[2].url.searchParams.get("QueryType")).toBe("NEXT_TOKEN");
    expect(requests[2].url.searchParams.get("NextToken")).toBe(
      "OPAQUE-SHIPMENT-CONTINUATION",
    );
    expect(requests[3].url.search).toBe("");
    expect(requests[4].url.searchParams.get("QueryType")).toBe("NEXT_TOKEN");
    expect(requests[4].url.searchParams.get("NextToken")).toBe(
      "OPAQUE-CONTINUATION",
    );
    expect(requests[4].url.searchParams.get("MarketplaceId")).toBe(US);
    for (const { url, init } of requests) {
      expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
    }
  });

  it("rejects redirects at the fixed Amazon origin without another request", async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const adapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: new URL(input instanceof Request ? input.url : String(input)),
          init,
        });
        return jsonResponse(302, { redirect: "https://attacker.invalid" });
      }) as typeof fetch,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });

    await expect(adapter.read({
      source: "v0",
      request: {
        kind: "shipments",
        marketplaceId: US,
        queryType: "DATE_RANGE",
        lastUpdatedAfter: "2026-08-01T07:00:00Z",
        lastUpdatedBefore: "2026-08-03T07:00:00Z",
        nextToken: null,
      },
    })).rejects.toMatchObject({
      status: 302,
      code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url.origin).toBe(
      "https://sellingpartnerapi-na.amazon.com",
    );
    expect(requests[0].init?.redirect).toBe("error");
  });

  it("preserves an explicit 400 for the semantic fallback without exposing hostile upstream text", async () => {
    const hostile =
      "access_token=SECRET https://attacker.invalid/private seller_id=PRIVATE";
    const adapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () =>
        jsonResponse(
          400,
          { errors: [{ message: hostile }] },
          { "x-amzn-requestid": "safe-request-400" },
        ),
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });

    await expect(adapter.read({
      source: "v0",
      request: {
        kind: "shipments",
        marketplaceId: US,
        queryType: "DATE_RANGE",
        lastUpdatedAfter: "2026-08-01T07:00:00Z",
        lastUpdatedBefore: "2026-08-03T07:00:00Z",
        nextToken: null,
      },
    })).rejects.toMatchObject({
      status: 400,
      code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
      requestId: "safe-request-400",
      message: "Amazon 無法驗證這次 FBA 入庫貨件唯讀請求。",
    });
    try {
      await adapter.read({
        source: "v0",
        request: {
          kind: "shipments",
          marketplaceId: US,
          queryType: "DATE_RANGE",
          lastUpdatedAfter: "2026-08-01T07:00:00Z",
          lastUpdatedBefore: "2026-08-03T07:00:00Z",
          nextToken: null,
        },
      });
    } catch (error) {
      expect(String(error)).not.toContain(hostile);
      expect(String(error)).not.toContain("attacker.invalid");
      expect(String(error)).not.toContain("SECRET");
    }
  });

  it("refreshes an unauthorized v0 read exactly once", async () => {
    const forceRefreshes: boolean[] = [];
    const invalidations: string[] = [];
    const responses = [
      jsonResponse(401, { errors: [{ message: "expired" }] }),
      jsonResponse(
        200,
        { payload: { ShipmentData: [] } },
        { "x-amzn-requestid": "refreshed-request" },
      ),
    ];
    const adapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async (region, forceRefresh) => {
        forceRefreshes.push(forceRefresh);
        return `${region}-${forceRefresh}`;
      },
      invalidateAccessToken: (region) => invalidations.push(region),
      fetchImpl: async () => responses.shift()!,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });

    await expect(adapter.read({
      source: "v0",
      request: {
        kind: "shipments",
        marketplaceId: US,
        queryType: "DATE_RANGE",
        lastUpdatedAfter: "2026-08-01T07:00:00Z",
        lastUpdatedBefore: "2026-08-03T07:00:00Z",
        nextToken: null,
      },
    })).resolves.toMatchObject({ requestId: "refreshed-request" });
    expect(forceRefreshes).toEqual([false, true]);
    expect(invalidations).toEqual(["na"]);
  });

  it("stops a persistently rate-limited GET after two bounded retries", async () => {
    let calls = 0;
    const adapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () => {
        calls += 1;
        return calls <= 3
          ? jsonResponse(
              429,
              { errors: [{ message: "hostile retry text" }] },
              {
                "retry-after": "0",
                "x-amzn-requestid": `rate-${calls}`,
              },
            )
          : jsonResponse(200, { payload: { ShipmentData: [] } });
      },
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      random: () => 0,
      sleep: async () => undefined,
    });

    await expect(adapter.read({
      source: "v0",
      request: {
        kind: "shipments",
        marketplaceId: US,
        queryType: "DATE_RANGE",
        lastUpdatedAfter: "2026-08-01T07:00:00Z",
        lastUpdatedBefore: "2026-08-03T07:00:00Z",
        nextToken: null,
      },
    })).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      requestId: "rate-3",
      retryAfter: "0",
    });
    expect(calls).toBe(3);
  });

  it("fixes modern plan pagination, plan detail, and shipment detail to official GET paths", async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const adapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: new URL(input instanceof Request ? input.url : String(input)),
          init,
        });
        return jsonResponse(
          200,
          { inboundPlans: [], pagination: {} },
          { "x-amzn-requestid": `modern-${requests.length}` },
        );
      }) as typeof fetch,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });
    const plans: FbaInboundExternalReadPlan[] = [
      {
        source: "modern",
        marketplaceId: US,
        request: { kind: "plans", paginationToken: null },
      },
      {
        source: "modern",
        marketplaceId: US,
        request: { kind: "plans", paginationToken: "MODERN-OPAQUE-NEXT" },
      },
      {
        source: "modern",
        marketplaceId: US,
        request: { kind: "plan", inboundPlanId: "plan-safe-001" },
      },
      {
        source: "modern",
        marketplaceId: US,
        request: {
          kind: "shipment",
          inboundPlanId: "plan-safe-001",
          shipmentId: "shipment-safe-001",
        },
      },
    ];

    for (const plan of plans) {
      await expect(adapter.read(plan)).resolves.toMatchObject({
        identity: fbaInboundExternalReadIdentity(plan),
        requestId: expect.any(String),
      });
    }

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/inbound/fba/2024-03-20/inboundPlans",
      "/inbound/fba/2024-03-20/inboundPlans",
      "/inbound/fba/2024-03-20/inboundPlans/plan-safe-001",
      "/inbound/fba/2024-03-20/inboundPlans/plan-safe-001/shipments/shipment-safe-001",
    ]);
    expect(requests[0].url.searchParams.get("sortBy")).toBe(
      "LAST_UPDATED_TIME",
    );
    expect(requests[0].url.searchParams.get("sortOrder")).toBe("DESC");
    expect(requests[0].url.searchParams.get("pageSize")).toBe("30");
    expect(requests[0].url.searchParams.has("paginationToken")).toBe(false);
    expect(requests[1].url.searchParams.get("paginationToken")).toBe(
      "MODERN-OPAQUE-NEXT",
    );
    expect(requests[2].url.search).toBe("");
    expect(requests[3].url.search).toBe("");
    for (const { url, init } of requests) {
      expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
    }
  });

  it("shares the 500ms read boundary across production adapters in the same region", async () => {
    let clock = NOW.getTime();
    const delays: number[] = [];
    const dependencies = {
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () =>
        jsonResponse(200, { payload: { ShipmentData: [] } }),
      userAgent: () => "AMZ.API/test",
      now: () => new Date(clock),
      sleep: async (milliseconds: number) => {
        delays.push(milliseconds);
        clock += milliseconds;
      },
    } as const;
    const firstAdapter = createFbaInboundReadsProductionAdapter(dependencies);
    const secondAdapter = createFbaInboundReadsProductionAdapter(dependencies);
    const plan: FbaInboundExternalReadPlan = {
      source: "v0",
      request: {
        kind: "shipments",
        marketplaceId: UK,
        queryType: "DATE_RANGE",
        lastUpdatedAfter: "2026-08-01T23:00:00Z",
        lastUpdatedBefore: "2026-08-03T23:00:00Z",
        nextToken: null,
      },
    };

    await firstAdapter.read(plan);
    await secondAdapter.read(plan);

    expect(delays).toEqual([0, 500]);
  });

  it.each([
    [
      "v0",
      {
        source: "v0",
        request: {
          kind: "shipments",
          marketplaceId: US,
          queryType: "DATE_RANGE",
          lastUpdatedAfter: "2026-08-01T07:00:00Z",
          lastUpdatedBefore: "2026-08-03T07:00:00Z",
          nextToken: null,
        },
      } as FbaInboundExternalReadPlan,
      "目前無法連線至 Amazon Fulfillment Inbound API。",
    ],
    [
      "modern",
      {
        source: "modern",
        marketplaceId: US,
        request: { kind: "plans", paginationToken: null },
      } as FbaInboundExternalReadPlan,
      "目前無法連線至 Amazon 新版 FBA 入庫 API。",
    ],
  ])("maps a %s network failure to a fixed safe error", async (
    _label,
    plan,
    message,
  ) => {
    const adapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () => {
        throw new TypeError("refresh_token=SECRET https://attacker.invalid");
      },
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });

    await expect(adapter.read(plan)).rejects.toMatchObject({
      status: 502,
      code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
      message,
    });
  });

  it("distinguishes a transport timeout and honors caller abort before fetch", async () => {
    const timeoutAdapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () => {
        const error = new Error("timed out after dispatch");
        error.name = "AbortError";
        throw error;
      },
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });
    const request: FbaInboundExternalReadPlan = {
      source: "v0",
      request: {
        kind: "shipments",
        marketplaceId: US,
        queryType: "DATE_RANGE",
        lastUpdatedAfter: "2026-08-01T07:00:00Z",
        lastUpdatedBefore: "2026-08-03T07:00:00Z",
        nextToken: null,
      },
    };
    await expect(timeoutAdapter.read(request)).rejects.toMatchObject({
      status: 504,
      code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
      message: "Amazon FBA 入庫貨件唯讀查詢逾時，已停止這次讀取。",
    });

    const fetchImpl = vi.fn<typeof fetch>();
    const abortedAdapter = createFbaInboundReadsProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl,
      now: () => new Date(NOW),
      sleep: async () => undefined,
    });
    const controller = new AbortController();
    const reason = new Error("caller stopped inbound read");
    controller.abort(reason);
    await expect(abortedAdapter.read({
      ...request,
      signal: controller.signal,
    })).rejects.toBe(reason);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
