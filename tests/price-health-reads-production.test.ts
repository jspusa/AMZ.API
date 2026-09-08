import { afterEach, describe, expect, it, vi } from "vitest";
import { createPriceHealthReadProductionAdapter } from "../src/main/amazon/price-health-reads-production";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;
async function plan(signal = new AbortController().signal) {
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "fixture-account" }));
  return { context: await context.capture(US), asins: ["B000000001"], signal, beforeDispatch: async () => undefined };
}
afterEach(() => vi.useRealTimers());

describe("price health fixed production read", () => {
  it("sends only the official read-only competitive-summary batch vocabulary", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ responses: [] }));
    const adapter = createPriceHealthReadProductionAdapter({
      getAccessToken: async () => "fixture-access", invalidateAccessToken: () => undefined,
      getSellerId: () => "fixture-own", fetch,
    });
    await expect(adapter.readCompetitiveSummary(await plan())).resolves.toMatchObject({ payload: { responses: [] }, ownSellerId: "fixture-own" });
    const [url, request] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://sellingpartnerapi-na.amazon.com/batches/products/pricing/2022-05-01/items/competitiveSummary");
    expect(request).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(JSON.parse(request!.body as string)).toEqual({
      requests: [{
        asin: "B000000001", marketplaceId: US,
        method: "GET", uri: "/products/pricing/2022-05-01/items/competitiveSummary",
        includedData: ["featuredBuyingOptions", "referencePrices"],
      }]
    });
  });

  it("paces independent jobs through the same 31-second quota and does not replay throttled POST reads", async () => {
    let clock = 0;
    const starts: number[] = [];
    const adapter = createPriceHealthReadProductionAdapter({
      getAccessToken: async () => "fixture-access", invalidateAccessToken: () => undefined,
      getSellerId: () => "fixture-own", now: () => new Date(clock),
      sleep: async milliseconds => { clock += milliseconds; },
      fetch: async () => { starts.push(clock); return new Response(null, { status: 429, headers: { "retry-after": "50" } }); },
    });
    await expect(adapter.readCompetitiveSummary(await plan())).rejects.toMatchObject({ status: 429 });
    await expect(adapter.readCompetitiveSummary(await plan())).rejects.toMatchObject({ status: 429 });
    expect(starts).toEqual([0, 50_000]);
  });

  it("uses one 12-second deadline for headers and body, even when a body stalls after headers", async () => {
    vi.useFakeTimers();
    const adapter = createPriceHealthReadProductionAdapter({
      getAccessToken: async () => "fixture-access", invalidateAccessToken: () => undefined, getSellerId: () => "fixture-own",
      fetch: async () => {
        await new Promise(resolve => setTimeout(resolve, 8_000));
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"responses":')); } }));
      },
    });
    const read = adapter.readCompetitiveSummary(await plan());
    const assertion = expect(read).rejects.toMatchObject({ status: 504, code: "PRICE_HEALTH_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(12_001);
    await assertion;
  });

  it("binds validated ASINs before async token work so a later caller change cannot expand the batch", async () => {
    const input = await plan();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ responses: [] }));
    const adapter = createPriceHealthReadProductionAdapter({
      getAccessToken: async () => { input.asins.push("B000000002"); return "fixture-access"; },
      invalidateAccessToken: () => undefined, getSellerId: () => "fixture-own", fetch,
    });
    await adapter.readCompetitiveSummary(input);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).requests.map((row: { asin: string }) => row.asin)).toEqual(["B000000001"]);
  });

  it.each([401, 403, 500, 503])("does not automatically replay a failed semantic POST (%i)", async status => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("unsafe upstream message", { status }));
    const invalidateAccessToken = vi.fn();
    const adapter = createPriceHealthReadProductionAdapter({ getAccessToken: async () => "fixture-access", invalidateAccessToken, getSellerId: () => "fixture-own", fetch });
    await expect(adapter.readCompetitiveSummary(await plan())).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(invalidateAccessToken).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });

  it.each(["declared", "streamed", "malformed"])("bounds and validates %s successful response bodies", async kind => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => kind === "declared"
      ? new Response("{}", { headers: { "content-length": String(16 * 1024 * 1024 + 1) } })
      : kind === "streamed" ? new Response(new Uint8Array(16 * 1024 * 1024 + 1)) : new Response("not JSON"));
    const adapter = createPriceHealthReadProductionAdapter({ getAccessToken: async () => "fixture-access", invalidateAccessToken: () => undefined, getSellerId: () => "fixture-own", fetch });
    await expect(adapter.readCompetitiveSummary(await plan())).rejects.toMatchObject({ status: 502, code: "PRICE_HEALTH_UNAVAILABLE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued read without sending it or resetting the quota fence", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ responses: [] }));
    const adapter = createPriceHealthReadProductionAdapter({ getAccessToken: async () => "fixture-access", invalidateAccessToken: () => undefined, getSellerId: () => "fixture-own", fetch });
    await adapter.readCompetitiveSummary(await plan());
    const controller = new AbortController();
    const cancelled = adapter.readCompetitiveSummary(await plan(controller.signal));
    const rejection = expect(cancelled).rejects.toThrow("Stopped");
    controller.abort(new Error("Stopped"));
    await rejection;
    const later = adapter.readCompetitiveSummary(await plan());
    await vi.advanceTimersByTimeAsync(30_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await later;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels unresolved token work without blocking a later job or dispatching with stale credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ responses: [] }));
    let tokenCalls = 0;
    let began: () => void = () => undefined;
    const started = new Promise<void>(resolve => { began = resolve; });
    const adapter = createPriceHealthReadProductionAdapter({
      getAccessToken: async () => { if (++tokenCalls === 1) { began(); return new Promise<string>(() => undefined); } return "fixture-access"; },
      invalidateAccessToken: () => undefined, getSellerId: () => "fixture-own", fetch,
    });
    const controller = new AbortController();
    const cancelled = adapter.readCompetitiveSummary(await plan(controller.signal));
    const rejection = expect(cancelled).rejects.toThrow("Stopped");
    await started;
    controller.abort(new Error("Stopped"));
    await rejection;
    await adapter.readCompetitiveSummary(await plan());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("checks exact context again after token work before dispatch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    let stale = false;
    const adapter = createPriceHealthReadProductionAdapter({ getAccessToken: async () => { stale = true; return "fixture-access"; }, invalidateAccessToken: () => undefined, getSellerId: () => "fixture-own", fetch });
    const input = await plan();
    input.beforeDispatch = async () => { if (stale) throw new Error("Context changed"); };
    await expect(adapter.readCompetitiveSummary(input)).rejects.toThrow("Context changed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not begin token work if cancellation occurs while awaiting the dispatch fence", async () => {
    const controller = new AbortController();
    const getAccessToken = vi.fn(async () => "fixture-access");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createPriceHealthReadProductionAdapter({ getAccessToken, invalidateAccessToken: () => undefined, getSellerId: () => "fixture-own", fetch });
    const input = await plan(controller.signal);
    input.beforeDispatch = async () => { controller.abort(new Error("Stopped at dispatch fence")); };
    await expect(adapter.readCompetitiveSummary(input)).rejects.toThrow("Stopped at dispatch fence");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not dispatch if cancellation occurs during the final fence after token acquisition", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ responses: [] }));
    const adapter = createPriceHealthReadProductionAdapter({ getAccessToken: async () => "fixture-access", invalidateAccessToken: () => undefined, getSellerId: () => "fixture-own", fetch });
    const input = await plan(controller.signal);
    let fences = 0;
    input.beforeDispatch = async () => { if (++fences === 2) controller.abort(new Error("Stopped at final fence")); };
    await expect(adapter.readCompetitiveSummary(input)).rejects.toThrow("Stopped at final fence");
    expect(fetch).not.toHaveBeenCalled();
  });
});
