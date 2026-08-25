import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCustomerFeedbackReadProductionAdapter,
} from "../src/main/amazon/customer-feedback-reads-production";

const US = "ATVPDKIKX0DER" as const;
const JP = "A1VC38T7YXB528" as const;

afterEach(() => vi.useRealTimers());

describe("Customer Feedback production adapter", () => {
  it("dispatches only the fixed getItemReviewTopics request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(null, {
        status: 204,
        headers: {
          "x-amzn-requestid": "request-fixed",
          "retry-after": "7",
        },
      })
    );
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      userAgent: () => "AMZ.API/test",
    });

    await expect(adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).resolves.toEqual({
      status: 204,
      payload: null,
      requestId: "request-fixed",
      retryAfter: "7",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://sellingpartnerapi-na.amazon.com/customerFeedback/2024-06-01/items/B000000001/reviews/topics?marketplaceId=ATVPDKIKX0DER&sortBy=STAR_RATING_IMPACT",
    );
    expect(options).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        accept: "application/json",
        "x-amz-access-token": "test-access-token",
        "x-amz-date": "20260825T000000Z",
        "user-agent": "AMZ.API/test",
      },
    });
  });

  it("paces physical requests globally across jobs and regions", async () => {
    let clock = 0;
    const starts: number[] = [];
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      now: () => new Date(clock),
      sleep: vi.fn(async (milliseconds) => {
        clock += milliseconds;
      }),
      fetch: vi.fn(async () => {
        starts.push(clock);
        return new Response(null, { status: 204 });
      }),
    });

    await Promise.all([
      adapter.read({
        marketplaceId: US,
        asin: "B000000001",
        expectedMode: "live",
      }),
      adapter.read({
        marketplaceId: JP,
        asin: "B000000002",
        expectedMode: "live",
      }),
    ]);

    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1_050);
  });

  it("refreshes once after 401 and routes the retry through the same pace gate", async () => {
    let clock = 0;
    const starts: number[] = [];
    let calls = 0;
    const getAccessToken = vi.fn(async (_region, forceRefresh: boolean) =>
      forceRefresh ? "refreshed-token" : "initial-token"
    );
    const invalidateAccessToken = vi.fn();
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken,
      invalidateAccessToken,
      resolveMode: () => "live",
      now: () => new Date(clock),
      sleep: vi.fn(async (milliseconds) => {
        clock += milliseconds;
      }),
      fetch: vi.fn(async () => {
        starts.push(clock);
        calls += 1;
        return new Response(null, { status: calls === 1 ? 401 : 204 });
      }),
    });

    await expect(adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).resolves.toMatchObject({ status: 204 });

    expect(invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(getAccessToken.mock.calls.map(([, force]) => force)).toEqual([
      false,
      true,
    ]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1_050);
  });

  it("does not dispatch a queued read after its lifecycle signal aborts", async () => {
    let releaseFirst: () => void = () => {
      throw new Error("First Customer Feedback request was not dispatched.");
    };
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      await firstGate;
      return new Response(null, { status: 204 });
    });
    const getAccessToken = vi.fn(async () => "test-access-token");
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken,
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      sleep: vi.fn(async () => undefined),
    });
    const controller = new AbortController();
    const first = adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const queued = adapter.read({
      marketplaceId: JP,
      asin: "B000000002",
      expectedMode: "live",
      signal: controller.signal,
    });
    controller.abort(new Error("review job stopped"));
    releaseFirst();

    await expect(first).resolves.toMatchObject({ status: 204 });
    await expect(queued).rejects.toThrow(/review job stopped/u);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("releases an aborted queue waiter before the predecessor settles", async () => {
    let releaseFirst: () => void = () => {
      throw new Error("First Customer Feedback request was not dispatched.");
    };
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      await firstGate;
      return new Response(null, { status: 204 });
    });
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
      sleep: vi.fn(async () => undefined),
    });
    const first = adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const queued = adapter.read({
      marketplaceId: JP,
      asin: "B000000002",
      expectedMode: "live",
      signal: controller.signal,
    });
    controller.abort(new Error("queue waiter stopped"));

    const outcome = await Promise.race([
      queued.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("still-pending"), 25);
      }),
    ]);
    expect(outcome).toBe("rejected");

    releaseFirst();
    await expect(first).resolves.toMatchObject({ status: 204 });
    await expect(queued).rejects.toThrow(/queue waiter stopped/u);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("releases an aborted token waiter before token acquisition settles", async () => {
    let releaseToken: (token: string) => void = () => {
      throw new Error("Token acquisition did not start.");
    };
    const tokenGate = new Promise<string>((resolve) => {
      releaseToken = resolve;
    });
    let tokenCalls = 0;
    const getAccessToken = vi.fn(async () =>
      tokenCalls++ === 0 ? tokenGate : "survivor-token"
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(null, { status: 204 })
    );
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken,
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });
    const controller = new AbortController();
    const waiting = adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalledTimes(1));
    controller.abort(new Error("token waiter stopped"));

    const outcome = await Promise.race([
      waiting.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("still-pending"), 25);
      }),
    ]);
    expect(outcome).toBe("rejected");

    const survivor = adapter.read({
      marketplaceId: JP,
      asin: "B000000002",
      expectedMode: "live",
    });
    const survivorOutcome = await Promise.race([
      survivor.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("still-pending"), 25);
      }),
    ]);
    expect(survivorOutcome).toBe("resolved");
    await expect(survivor).resolves.toMatchObject({ status: 204 });

    releaseToken("unused-token");
    await expect(waiting).rejects.toThrow(/token waiter stopped/u);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops a 401 retry when the expected live mode changes", async () => {
    let mode: "live" | "demo" = "live";
    let clock = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(null, { status: 401 })
    );
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => mode,
      now: () => new Date(clock),
      sleep: vi.fn(async (milliseconds) => {
        clock += milliseconds;
        mode = "demo";
      }),
      fetch,
    });

    await expect(adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "REPORT_MODE_CHANGED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not replay 429 and bounds a persistent 503 to one retry", async () => {
    let clock = 0;
    const rateLimitedFetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(null, {
        status: 429,
        headers: { "retry-after": "4" },
      })
    );
    const rateLimited = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch: rateLimitedFetch,
    });
    await expect(rateLimited.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).resolves.toMatchObject({ status: 429, retryAfter: "4" });
    expect(rateLimitedFetch).toHaveBeenCalledTimes(1);

    const unavailableFetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(null, { status: 503 })
    );
    const unavailable = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch: unavailableFetch,
      now: () => new Date(clock),
      sleep: vi.fn(async (milliseconds) => {
        clock += milliseconds;
      }),
    });
    await expect(unavailable.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).resolves.toMatchObject({ status: 503 });
    expect(unavailableFetch).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a server retry beyond the controlled delay bound", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(null, {
        status: 503,
        headers: { "retry-after": "1501" },
      })
    );
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });

    await expect(adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).resolves.toMatchObject({ status: 503, retryAfter: "1501" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a streamed body that crosses the fixed safety bound", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1_024 * 1_024 + 1));
        controller.close();
      },
    });
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch: vi.fn(async () => new Response(body, { status: 200 })),
    });

    await expect(adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      operation: "getItemReviewTopics",
    });
  });

  it("bounds a stalled response body and forwards an active caller abort", async () => {
    vi.useFakeTimers();
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });
    const stalledAdapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch: vi.fn(async () => new Response(stalled, { status: 200 })),
    });
    const timedOut = stalledAdapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    });
    const timeoutRejection = expect(timedOut).rejects.toMatchObject({
      status: 504,
      code: "UPSTREAM_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(12_000);
    await timeoutRejection;

    vi.useRealTimers();
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = options?.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      })
    );
    const abortingAdapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch,
    });
    const aborted = abortingAdapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
      signal: controller.signal,
    });
    const abortRejection = expect(aborted).rejects.toThrow(/lifecycle cleanup/u);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(new Error("lifecycle cleanup"));
    await abortRejection;
  });

  it("retries one transient server response and honors bounded Retry-After", async () => {
    let clock = 0;
    const starts: number[] = [];
    let calls = 0;
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      now: () => new Date(clock),
      sleep: vi.fn(async (milliseconds) => {
        clock += milliseconds;
      }),
      fetch: vi.fn(async () => {
        starts.push(clock);
        calls += 1;
        return calls === 1
          ? new Response(null, {
              status: 503,
              headers: { "retry-after": "3" },
            })
          : new Response(null, { status: 204 });
      }),
    });

    await expect(adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).resolves.toMatchObject({ status: 204 });

    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(3_000);
  });

  it("publishes server Retry-After to the global queue before another region dispatches", async () => {
    let clock = 0;
    const starts: Array<{ at: number; asin: string }> = [];
    let firstAsinCalls = 0;
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      now: () => new Date(clock),
      sleep: vi.fn(async (milliseconds) => {
        clock += milliseconds;
      }),
      fetch: vi.fn(async (url) => {
        const asin = String(url).includes("B000000001")
          ? "B000000001"
          : "B000000002";
        starts.push({ at: clock, asin });
        if (asin === "B000000001" && firstAsinCalls++ === 0) {
          return new Response(null, {
            status: 503,
            headers: { "retry-after": "3" },
          });
        }
        return new Response(null, { status: 204 });
      }),
    });

    await Promise.all([
      adapter.read({
        marketplaceId: US,
        asin: "B000000001",
        expectedMode: "live",
      }),
      adapter.read({
        marketplaceId: JP,
        asin: "B000000002",
        expectedMode: "live",
      }),
    ]);

    expect(starts).toHaveLength(3);
    expect(starts[0]).toEqual({ at: 0, asin: "B000000001" });
    expect(starts[1]!.at - starts[0]!.at).toBeGreaterThanOrEqual(3_000);
  });

  it("honors 429 Retry-After globally without replaying the limited request", async () => {
    let clock = 0;
    const starts: Array<{ at: number; asin: string }> = [];
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      now: () => new Date(clock),
      sleep: vi.fn(async (milliseconds) => {
        clock += milliseconds;
      }),
      fetch: vi.fn(async (url) => {
        const asin = String(url).includes("B000000001")
          ? "B000000001"
          : "B000000002";
        starts.push({ at: clock, asin });
        return asin === "B000000001"
          ? new Response(null, {
              status: 429,
              headers: { "retry-after": "3" },
            })
          : new Response(null, { status: 204 });
      }),
    });

    const [limited, otherRegion] = await Promise.all([
      adapter.read({
        marketplaceId: US,
        asin: "B000000001",
        expectedMode: "live",
      }),
      adapter.read({
        marketplaceId: JP,
        asin: "B000000002",
        expectedMode: "live",
      }),
    ]);

    expect(limited.status).toBe(429);
    expect(otherRegion.status).toBe(204);
    expect(starts).toHaveLength(2);
    expect(starts[1]!.at - starts[0]!.at).toBeGreaterThanOrEqual(3_000);
  });

  it("does not turn a parseable noncanonical Retry-After into a global delay", async () => {
    let clock = Date.parse("2026-08-25T00:00:00.000Z");
    const starts: number[] = [];
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      now: () => new Date(clock),
      sleep: vi.fn(async (milliseconds) => {
        clock += milliseconds;
      }),
      fetch: vi.fn(async (url) => {
        starts.push(clock);
        return String(url).includes("B000000001")
          ? new Response(null, {
              status: 429,
              headers: { "retry-after": "2026-08-25T00:20:00Z" },
            })
          : new Response(null, { status: 204 });
      }),
    });

    await Promise.all([
      adapter.read({
        marketplaceId: US,
        asin: "B000000001",
        expectedMode: "live",
      }),
      adapter.read({
        marketplaceId: JP,
        asin: "B000000002",
        expectedMode: "live",
      }),
    ]);

    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBe(1_050);
  });

  it("rejects a declared response body above the fixed safety bound", async () => {
    const adapter = createCustomerFeedbackReadProductionAdapter({
      getAccessToken: vi.fn(async () => "test-access-token"),
      invalidateAccessToken: vi.fn(),
      resolveMode: () => "live",
      fetch: vi.fn(async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(16 * 1_024 * 1_024 + 1) },
        })
      ),
    });

    await expect(adapter.read({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      operation: "getItemReviewTopics",
    });
  });
});
