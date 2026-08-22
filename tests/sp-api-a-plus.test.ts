import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAplusContentPublishRecordsPage,
  invalidateSpApiCredentialCaches,
} from "../src/main/amazon/sp-api";

const US = "ATVPDKIKX0DER" as const;
const savedEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);

function configure(mode: "live" | "demo"): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SP_API_")) delete process.env[key];
  }
  process.env.SP_API_MODE = mode;
  if (mode === "live") {
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_APLUS_CLIENT";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_APLUS_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_APLUS_REFRESH";
  }
  invalidateSpApiCredentialCaches();
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({
    access_token: "fake-a-plus-token",
    expires_in: 3_600,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("A+ Content publish-record SP-API gateway", () => {
  beforeEach(() => configure("live"));

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("requests the official exact marketplace, ASIN and opaque page token", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/auth/o2/token")) return tokenResponse();
      return new Response(JSON.stringify({
        publishRecordList: [{
          marketplaceId: US,
          asin: "B000000001",
          contentReferenceKey: "opaque-record-key",
          contentType: "EBC",
          locale: "en-US",
        }],
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-amzn-requestid": "request-a-plus-1",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000001",
      pageToken: "opaque-next-page",
      expectedMode: "live",
    })).resolves.toMatchObject({
      status: 200,
      payload: {
        publishRecordList: [expect.objectContaining({ asin: "B000000001" })],
      },
      requestId: "request-a-plus-1",
    });

    const apiRequest = requests.find(({ url }) => url.includes("/aplus/2020-11-01/"));
    expect(apiRequest).toBeDefined();
    const url = new URL(apiRequest!.url);
    expect(url.pathname).toBe("/aplus/2020-11-01/contentPublishRecords");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      marketplaceId: US,
      asin: "B000000001",
      pageToken: "opaque-next-page",
    });
    expect(apiRequest!.init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(new Headers(apiRequest!.init?.headers).get("x-amz-access-token"))
      .toBe("fake-a-plus-token");
  });

  it("returns deterministic demo records without any network request", async () => {
    configure("demo");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000002",
      expectedMode: "demo",
    });

    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({ publishRecordList: expect.any(Array) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("paces concurrent live A+ request starts across callers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1_000);
    const apiStarts: number[] = [];
    const controlledWaitHeartbeats: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const first = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    });
    const second = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000002",
      expectedMode: "live",
      onControlledWait: () => controlledWaitHeartbeats.push(Date.now()),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(109);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(apiStarts).toHaveLength(2);
    expect(apiStarts[1] - apiStarts[0]).toBeGreaterThanOrEqual(100);
    expect(controlledWaitHeartbeats).toEqual([
      apiStarts[0],
      apiStarts[1],
    ]);
  });

  it("honors the complete Retry-After delay instead of capping Amazon's instruction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const apiStarts: number[] = [];
    const controlledWaitHeartbeats: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      if (apiStarts.length === 1) {
        return new Response(JSON.stringify({ errors: [] }), {
          status: 429,
          headers: { "retry-after": "12" },
        });
      }
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const request = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000003",
      expectedMode: "live",
      onControlledWait: () => controlledWaitHeartbeats.push(Date.now()),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(apiStarts).toHaveLength(2);
    expect(apiStarts[1] - apiStarts[0]).toBeGreaterThanOrEqual(12_000);
    expect(controlledWaitHeartbeats).toEqual([
      new Date("2026-08-23T08:00:00.000Z").getTime(),
      new Date("2026-08-23T08:00:12.000Z").getTime(),
    ]);
  });

  it("honors an HTTP-date Retry-After value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const apiStarts: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      if (apiStarts.length === 1) {
        return new Response(JSON.stringify({ errors: [] }), {
          status: 503,
          headers: {
            "retry-after": new Date(Date.now() + 9_000).toUTCString(),
          },
        });
      }
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const request = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000006",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8_999);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(apiStarts).toHaveLength(2);
    expect(apiStarts[1] - apiStarts[0]).toBeGreaterThanOrEqual(9_000);
  });

  it("fails closed instead of scheduling a Retry-After beyond the active job lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    let apiCalls = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiCalls += 1;
      if (apiCalls === 1) {
        return new Response(JSON.stringify({ errors: [] }), {
          status: 429,
          headers: { "retry-after": "1801" },
        });
      }
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const request = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000007",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(1_801_000);
    const result = await request;

    expect(result.status).toBe(429);
    expect(apiCalls).toBe(1);
  });

  it("updates future per-region pacing from Amazon's rate-limit header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const apiStarts: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-amzn-RateLimit-Limit": "2",
        },
      });
    }));

    const first = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000004",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(apiStarts).toHaveLength(1);

    const second = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000005",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(11);
    await second;
    expect(apiStarts).toHaveLength(2);
    expect(apiStarts[1] - apiStarts[0]).toBeGreaterThanOrEqual(500);
  });

  it("rejects an extreme rate-limit header instead of creating an infinite timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const apiStarts: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-amzn-RateLimit-Limit": "1e-320",
        },
      });
    }));

    const first = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000008",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await first;

    const controller = new AbortController();
    const second = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000009",
      expectedMode: "live",
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(110);
    const starts = [...apiStarts];
    controller.abort();
    await second.catch(() => null);

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(100);
  });

  it("rejects unsafe identity, token and live-demo drift before dispatch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "bad-asin",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "LISTING_IDENTITY_MISMATCH" });
    await expect(getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000001",
      pageToken: " unsafe ",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "A_PLUS_PAGINATION_INVALID" });
    process.env.SP_API_MODE = "demo";
    await expect(getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "REPORT_MODE_CHANGED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
