import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SpApiError,
  getSalesTrend,
  invalidateSpApiCredentialCaches,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");
const savedEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);

function jsonResponse(
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("FBA Sales Trend facade", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_LWA_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_LWA_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REFRESH_TOKEN";
    invalidateSpApiCredentialCaches();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

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

  it("routes live reads through the fixed production adapter", async () => {
    const salesRequests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === "https://api.amazon.com") {
          return jsonResponse(200, {
            access_token: "FAKE_ACCESS_TOKEN",
            expires_in: 3_600,
          });
        }
        salesRequests.push({ url, init });
        return jsonResponse(
          200,
          { payload: [] },
          {
            "x-amzn-requestid": "request-live",
            "x-amzn-ratelimit-limit": "0.5",
          },
        );
      }),
    );

    const snapshot = await getSalesTrend({
      marketplaceId: MARKETPLACE_ID,
      days: 7,
      host: "https://example.invalid",
      path: "/unsafe",
      method: "POST",
      granularity: "Hour",
      buyerType: "Business",
      fulfillmentNetwork: "MFN",
    } as Parameters<typeof getSalesTrend>[0]);

    expect(salesRequests).toHaveLength(1);
    const [{ url, init }] = salesRequests;
    expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(url.pathname).toBe("/sales/v1/orderMetrics");
    expect(init?.method).toBe("GET");
    expect(url.searchParams.get("granularity")).toBe("Day");
    expect(url.searchParams.get("buyerType")).toBe("All");
    expect(url.searchParams.get("fulfillmentNetwork")).toBe("AFN");
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      days: 7,
      requestId: "request-live",
      rateLimit: "0.5",
      comparison: null,
    });
    expect(snapshot.points).toHaveLength(7);
    expect(snapshot.points[6].partial).toBe(true);
  });

  it("maps malformed live envelopes back to the existing public error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === "https://api.amazon.com") {
          return jsonResponse(200, {
            access_token: "FAKE_ACCESS_TOKEN",
            expires_in: 3_600,
          });
        }
        return jsonResponse(200, {
          payload: [
            {
              interval:
                "2026-03-04T00:00:00-08:00--2026-03-05T00:00:00-08:00",
              unitCount: 1,
              orderItemCount: 1,
              orderCount: 1,
              totalSales: { amount: "10", currencyCode: "CAD" },
            },
          ],
        });
      }),
    );

    const failure = getSalesTrend({
      marketplaceId: MARKETPLACE_ID,
      days: 7,
    });
    await expect(failure).rejects.toBeInstanceOf(SpApiError);
    await expect(failure).rejects.toMatchObject({
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Amazon 回傳了無法辨識的 FBA 銷售趨勢。",
    });
  });
});
