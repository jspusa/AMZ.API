import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCustomerFeedbackReviewTopics,
  invalidateSpApiCredentialCaches,
} from "../src/main/amazon/sp-api";
import type { DedupedFbaReviewCandidate } from "../src/main/amazon/review-audit";

const US = "ATVPDKIKX0DER" as const;
const savedEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);
const candidate: DedupedFbaReviewCandidate = {
  sellerSkus: ["SKU-ONE"],
  asin: "B000000001",
  title: "Review audit product",
  relationshipRole: "standalone",
  evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
};

function configureLive(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SP_API_")) delete process.env[key];
  }
  process.env.SP_API_MODE = "live";
  process.env.SP_API_LWA_CLIENT_ID = "FAKE_REVIEW_CLIENT";
  process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_REVIEW_SECRET";
  process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REVIEW_REFRESH";
  invalidateSpApiCredentialCaches();
}

function tokenResponse(ordinal: number): Response {
  return new Response(JSON.stringify({
    access_token: `fake-token-${ordinal}`,
    expires_in: 3600,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Customer Feedback live response boundaries", () => {
  beforeEach(configureLive);

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

  it("keeps HTTP 204 as a successful no-topics result", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.includes("/auth/o2/token")
        ? tokenResponse(1)
        : new Response(null, {
          status: 204,
          headers: { "x-amzn-requestid": "request-204" },
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCustomerFeedbackReviewTopics({ marketplaceId: US, candidate, expectedMode: "live" }))
      .resolves.toMatchObject({
        candidate,
        response: null,
        noContent: true,
        requestId: "request-204",
      });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes once after 401 and spaces the retry by at least one second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
    let tokenCalls = 0;
    let feedbackCalls = 0;
    const feedbackTimes: number[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return tokenResponse(tokenCalls);
      }
      feedbackCalls += 1;
      feedbackTimes.push(Date.now());
      return new Response(null, {
        status: feedbackCalls === 1 ? 401 : 204,
        headers: { "x-amzn-requestid": `request-${feedbackCalls}` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = getCustomerFeedbackReviewTopics({ marketplaceId: US, candidate, expectedMode: "live" });
    await vi.advanceTimersByTimeAsync(0);
    expect(feedbackCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_049);
    expect(feedbackCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toMatchObject({
      noContent: true,
      requestId: "request-2",
    });
    expect(tokenCalls).toBe(2);
    expect(feedbackCalls).toBe(2);
    expect(feedbackTimes[1]! - feedbackTimes[0]!).toBeGreaterThanOrEqual(1_050);
  });

  it("does not dispatch the 401 retry after live mode changes to demo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
    let tokenCalls = 0;
    let feedbackCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return tokenResponse(tokenCalls);
      }
      feedbackCalls += 1;
      return new Response(null, { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = getCustomerFeedbackReviewTopics({
      marketplaceId: US,
      candidate,
      expectedMode: "live",
    });
    const rejection = expect(result).rejects.toMatchObject({
      code: "REPORT_MODE_CHANGED",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(feedbackCalls).toBe(1);
    process.env.SP_API_MODE = "demo";
    await vi.advanceTimersByTimeAsync(1_050);

    await rejection;
    expect(tokenCalls).toBe(1);
    expect(feedbackCalls).toBe(1);
  });

  it("does not dispatch the 401 retry after lifecycle cleanup aborts the run", async () => {
    const controller = new AbortController();
    let tokenCalls = 0;
    let feedbackCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return tokenResponse(tokenCalls);
      }
      feedbackCalls += 1;
      controller.abort(new Error("lifecycle cleanup"));
      return new Response(null, { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCustomerFeedbackReviewTopics({
      marketplaceId: US,
      candidate,
      expectedMode: "live",
      signal: controller.signal,
    })).rejects.toThrow(/lifecycle cleanup/u);
    expect(tokenCalls).toBe(1);
    expect(feedbackCalls).toBe(1);
  });

  it("maps 403 to unauthorized without retrying another ASIN request", async () => {
    let feedbackCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse(1);
      feedbackCalls += 1;
      return new Response(null, {
        status: 403,
        headers: { "x-amzn-requestid": "request-403" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCustomerFeedbackReviewTopics({ marketplaceId: US, candidate, expectedMode: "live" }))
      .resolves.toMatchObject({
        response: null,
        error: { code: "UNAUTHORIZED", requestId: "request-403" },
      });
    expect(feedbackCalls).toBe(1);
  });
});
