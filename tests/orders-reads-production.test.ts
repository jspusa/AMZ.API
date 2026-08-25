import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOrdersReadProductionAdapter,
} from "../src/main/amazon/orders-reads-production";
import type { OrdersPagePlan } from "../src/main/amazon/orders-reads";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const FIXED_NOW = new Date("2026-08-25T12:34:56.789Z");

function dashboardPlan(
  overrides: Partial<OrdersPagePlan> = {},
): OrdersPagePlan {
  return {
    intent: "dashboard-page",
    marketplaceId: MARKETPLACE_ID,
    lastUpdatedAfter: "2026-08-11T12:34:56.789Z",
    fulfillmentStatus: "SHIPPED",
    paginationToken: null,
    expectedMode: "live",
    signal: undefined,
    ...overrides,
  } as OrdersPagePlan;
}

function statusResponse(
  status: number,
  options: Readonly<{
    payload?: unknown;
    body?: string;
    headers?: HeadersInit;
  }> = {},
): Response {
  const body = options.body ?? (
    status >= 200 && status < 300
      ? JSON.stringify(options.payload ?? { orders: [] })
      : null
  );
  return new Response(body, { status, headers: options.headers });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Orders reads production adapter", () => {
  it("uses the fixed Orders 2026-01-01 FBA GET contract for a dashboard page", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ orders: [] }), {
        status: 200,
        headers: {
          "x-amzn-requestid": "orders-request",
          "x-amzn-ratelimit-limit": "0.0167",
        },
      })
    );
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      now: () => FIXED_NOW,
      userAgent: () => "AMZ.API/orders-test",
    });

    await expect(adapter.read(dashboardPlan())).resolves.toEqual({
      status: 200,
      payload: { orders: [] },
      requestId: "orders-request",
      rateLimit: "0.0167",
      retryAfter: null,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetch.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(url.pathname).toBe("/orders/2026-01-01/orders");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lastUpdatedAfter: "2026-08-11T12:34:56.789Z",
      marketplaceIds: MARKETPLACE_ID,
      maxResultsPerPage: "50",
      includedData: "PROCEEDS,FULFILLMENT,CANCELLATION,PROMOTION",
      fulfillmentStatuses: "SHIPPED",
      fulfilledBy: "AMAZON",
    });
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
    });
    expect(new Headers(init?.headers).get("x-amz-access-token"))
      .toBe("FAKE_ACCESS_TOKEN");
    expect(new Headers(init?.headers).get("x-amz-date"))
      .toBe("20260825T123456Z");
    expect(new Headers(init?.headers).get("user-agent"))
      .toBe("AMZ.API/orders-test");
  });

  it("keeps pagination tokens opaque and gives probes their fixed page shape", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      statusResponse(200)
    );
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });
    const opaqueToken = "next+/= token&marker=%2B?";

    await adapter.read(dashboardPlan({
      lastUpdatedAfter: "2026-08-01T00:00:00.000-07:00",
      fulfillmentStatus: null,
      paginationToken: opaqueToken,
    }));
    await adapter.read(dashboardPlan({
      intent: "connection-probe",
      fulfillmentStatus: null,
      paginationToken: null,
    }));

    const first = new URL(String(fetch.mock.calls[0]![0]));
    expect(first.searchParams.get("lastUpdatedAfter"))
      .toBe("2026-08-01T00:00:00.000-07:00");
    expect(first.searchParams.get("paginationToken")).toBe(opaqueToken);
    expect(first.searchParams.get("maxResultsPerPage")).toBe("50");
    expect(first.searchParams.has("fulfillmentStatuses")).toBe(false);

    const probe = new URL(String(fetch.mock.calls[1]![0]));
    expect(probe.searchParams.get("maxResultsPerPage")).toBe("1");
    expect(probe.searchParams.has("paginationToken")).toBe(false);
    expect(probe.searchParams.has("fulfillmentStatuses")).toBe(false);
  });

  it("invalidates and force-refreshes the access token only once after 401", async () => {
    const responses = [statusResponse(401), statusResponse(401)];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => responses.shift()!);
    const getAccessToken = vi.fn(async (
      _region: "na" | "eu" | "fe",
      forceRefresh: boolean,
    ) => forceRefresh ? "REFRESHED_ACCESS_TOKEN" : "INITIAL_ACCESS_TOKEN");
    const invalidateAccessToken = vi.fn();
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken,
      invalidateAccessToken,
      resolveMode: () => "live",
      fetch,
    });

    await expect(adapter.read(dashboardPlan())).resolves.toMatchObject({
      status: 401,
      payload: null,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getAccessToken.mock.calls).toEqual([
      ["na", false],
      ["na", true],
    ]);
    expect(invalidateAccessToken).toHaveBeenCalledOnce();
    expect(invalidateAccessToken).toHaveBeenCalledWith("na");
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get(
      "x-amz-access-token",
    )).toBe("REFRESHED_ACCESS_TOKEN");
  });

  it("returns to cached-token mode for retries after a forced 401 refresh", async () => {
    const responses = [
      statusResponse(401),
      statusResponse(503),
      statusResponse(200, { payload: { orders: [] } }),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => responses.shift()!);
    const getAccessToken = vi.fn(async (
      _region: "na" | "eu" | "fe",
      forceRefresh: boolean,
    ) => forceRefresh ? "REFRESHED_ACCESS_TOKEN" : "CACHED_ACCESS_TOKEN");
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken,
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      sleep: vi.fn(async () => undefined),
      random: () => 0,
    });

    await expect(adapter.read(dashboardPlan())).resolves.toMatchObject({
      status: 200,
    });
    expect(getAccessToken.mock.calls).toEqual([
      ["na", false],
      ["na", true],
      ["na", false],
    ]);
  });

  it("retries only 429, 500, and 503 responses at most twice", async () => {
    const responses = [
      statusResponse(503, { headers: { "retry-after": "99" } }),
      statusResponse(429),
      statusResponse(500, { headers: { "x-amzn-requestid": "final" } }),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => responses.shift()!);
    const sleep = vi.fn(async (
      _milliseconds: number,
      _signal?: AbortSignal,
    ) => undefined);
    const getAccessToken = vi.fn(async () => "FAKE_ACCESS_TOKEN");
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken,
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      sleep,
      random: () => 0,
    });

    await expect(adapter.read(dashboardPlan())).resolves.toMatchObject({
      status: 500,
      requestId: "final",
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(getAccessToken.mock.calls).toEqual([
      ["na", false],
      ["na", false],
      ["na", false],
    ]);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds))
      .toEqual([8_000, 1_000]);
  });

  it("does not blindly retry non-transient responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      statusResponse(502, {
        body: "not-json and must not be exposed",
        headers: { "retry-after": "7" },
      })
    );
    const sleep = vi.fn(async () => undefined);
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      sleep,
    });

    await expect(adapter.read(dashboardPlan())).resolves.toEqual({
      status: 502,
      payload: null,
      requestId: null,
      rateLimit: null,
      retryAfter: "7",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects redirect following and never replays a 3xx response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      statusResponse(302, {
        headers: { location: "https://redirect-target.invalid/private" },
      })
    );
    const sleep = vi.fn(async () => undefined);
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      sleep,
    });

    await expect(adapter.read(dashboardPlan())).resolves.toMatchObject({
      status: 302,
      payload: null,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops at the captured mode fence before credentials or network", async () => {
    const getAccessToken = vi.fn(async () => "FAKE_ACCESS_TOKEN");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken,
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "demo",
      fetch,
    });

    await expect(adapter.read(dashboardPlan())).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
    await expect(adapter.read(dashboardPlan({ expectedMode: "demo" })))
      .rejects.toMatchObject({
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechecks the mode fence before a transient retry", async () => {
    let mode: "live" | "demo" = "live";
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      statusResponse(503)
    );
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => mode,
      fetch,
      sleep: vi.fn(async () => {
        mode = "demo";
      }),
      random: () => 0,
    });

    await expect(adapter.read(dashboardPlan())).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("enforces a 12-second request deadline", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          const error = new Error("transport aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    );
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });

    const pending = adapter.read(dashboardPlan());
    const rejection = expect(pending).rejects.toMatchObject({
      status: 504,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Amazon SP-API 回應逾時，請稍後再試。",
    });
    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps the same 12-second deadline after response headers arrive", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(new ReadableStream<Uint8Array>({
        start() {
          // Headers resolve immediately while the JSON body never advances.
        },
      }), { status: 200 })
    );
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });

    const pending = adapter.read(dashboardPlan());
    const rejection = expect(pending).rejects.toMatchObject({
      status: 504,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Amazon SP-API 回應逾時，請稍後再試。",
    });
    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });

  it("keeps caller abort effective after response headers arrive", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(new ReadableStream<Uint8Array>({
        start() {
          // The caller abort must stop this otherwise-stalled body read.
        },
      }), { status: 200 })
    );
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });
    const controller = new AbortController();
    const reason = new Error("orders body stopped");
    const pending = adapter.read(dashboardPlan({ signal: controller.signal }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("bounds successful bodies and cancels bodies that will be discarded", async () => {
    const oversizedCancel = vi.fn();
    const nonSuccessCancel = vi.fn();
    const responses = [
      new Response(new ReadableStream<Uint8Array>({
        cancel: oversizedCancel,
      }), {
        status: 200,
        headers: {
          "content-length": String(16 * 1_024 * 1_024 + 1),
          "x-amzn-requestid": "oversized-request",
        },
      }),
      new Response(new ReadableStream<Uint8Array>({
        cancel: nonSuccessCancel,
      }), { status: 502 }),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => responses.shift()!);
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });

    await expect(adapter.read(dashboardPlan())).rejects.toMatchObject({
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: "oversized-request",
    });
    expect(oversizedCancel).toHaveBeenCalledOnce();
    await expect(adapter.read(dashboardPlan())).resolves.toMatchObject({
      status: 502,
      payload: null,
    });
    expect(nonSuccessCancel).toHaveBeenCalledOnce();
  });

  it("forwards the caller abort reason into an in-flight request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          const error = new Error("transport aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    );
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });
    const controller = new AbortController();
    const reason = new Error("orders task stopped");
    const pending = adapter.read(dashboardPlan({ signal: controller.signal }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("maps transport failures to a fixed secret-free error without retry", async () => {
    const privateMaterial = "DO_NOT_EXPOSE_PRIVATE_TRANSPORT_DETAIL";
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error(privateMaterial);
    });
    const sleep = vi.fn(async () => undefined);
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      sleep,
    });

    let thrown: unknown;
    try {
      await adapter.read(dashboardPlan());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SpApiError);
    expect(thrown).toMatchObject({
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      message: "目前無法連線至 Amazon SP-API。",
    });
    expect(String((thrown as Error).message)).not.toContain(privateMaterial);
    expect(JSON.stringify(thrown)).not.toContain(privateMaterial);
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps malformed successful JSON as a thrown parse failure", async () => {
    const adapter = createOrdersReadProductionAdapter({
      getAccessToken: vi.fn(async () => "FAKE_ACCESS_TOKEN"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch: vi.fn(async () => statusResponse(200, { body: "{" })),
    });

    await expect(adapter.read(dashboardPlan())).rejects
      .toBeInstanceOf(SyntaxError);
  });
});
