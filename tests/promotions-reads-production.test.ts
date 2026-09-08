import { afterEach, describe, expect, it, vi } from "vitest";
import { createPromotionsReadProductionAdapter } from "../src/main/amazon/promotions-reads-production";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;
afterEach(() => vi.useRealTimers());
async function plan() {
  const contexts = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "promotions-transport-fixture" }));
  const context = await contexts.capture(US);
  return { context, signal: new AbortController().signal, assertCurrent: () => contexts.assertCurrent(context) };
}

describe("Promotions production reads", () => {
  it("uses only the fixed three GET operations with revision and issue evidence", async () => {
    const requests: Array<{ url: string; options: RequestInit | undefined }> = [];
    const adapter = createPromotionsReadProductionAdapter({ getAccessToken: async () => "fixture-access-token", invalidateAccessToken: () => undefined,
      sleep: async () => undefined,
      fetch: async (url, options) => { requests.push({ url: String(url), options }); return Response.json({ ok: true }); },
    });
    const input = await plan();
    await adapter.searchPromotions({ ...input, paginationToken: "fixture-search-cursor" });
    await adapter.getPromotion({ ...input, promotionId: "fixture-promotion" });
    await adapter.getSelection({ ...input, promotionId: "fixture-promotion", selectionId: "fixture-selection", revisionId: 2, paginationToken: "fixture-item-cursor" });
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual(["/promotions/2025-12-01/promotions", "/promotions/2025-12-01/promotions/fixture-promotion", "/promotions/2025-12-01/promotions/fixture-promotion/selections/fixture-selection"]);
    expect(new URL(requests[0]!.url).searchParams.get("revision")).toBe("ANY");
    expect(new URL(requests[1]!.url).searchParams.get("includedData")).toBe("ISSUES,SELECTION");
    expect(new URL(requests[2]!.url).searchParams.get("revisionId")).toBe("2");
    expect(requests.every(({ url, options }) => new URL(url).origin === "https://sellingpartnerapi-na.amazon.com" && options?.method === "GET" && options?.redirect === "error" && options?.cache === "no-store" && options?.body === undefined)).toBe(true);
  });
  it("rejects a successful response whose declared body exceeds 16 MiB", async () => {
    const adapter = createPromotionsReadProductionAdapter({ getAccessToken: async () => "fixture-access-token", invalidateAccessToken: () => undefined, fetch: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(16 * 1024 * 1024 + 1) } }) });
    await expect(adapter.searchPromotions(await plan())).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
  it("keeps the 12 second deadline active while a response body stalls", async () => {
    vi.useFakeTimers();
    const adapter = createPromotionsReadProductionAdapter({ getAccessToken: async () => "fixture-access-token", invalidateAccessToken: () => undefined, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }), { headers: { "content-type": "application/json" } }) });
    let failed: unknown;
    const pending = adapter.searchPromotions(await plan()).catch((error: unknown) => { failed = error; });
    await vi.advanceTimersByTimeAsync(12_001);
    expect(failed).toMatchObject({ status: 504, code: "UPSTREAM_UNAVAILABLE" });
    await pending;
  });
  it("paces every physical request across operations and refreshes a 401 only once", async () => {
    let clock = 0;
    const starts: number[] = [];
    const force: boolean[] = [];
    const adapter = createPromotionsReadProductionAdapter({ getAccessToken: async (_region, refresh) => { force.push(refresh); return "fixture-access-token"; }, invalidateAccessToken: () => undefined,
      now: () => new Date(clock), sleep: async (milliseconds) => { clock += milliseconds; },
      fetch: async () => { starts.push(clock); return starts.length === 1 ? new Response(null, { status: 401 }) : Response.json({ ok: true }); },
    });
    const input = await plan();
    await adapter.searchPromotions(input);
    await adapter.getPromotion({ ...input, promotionId: "fixture-promotion" });
    expect(force).toEqual([false, true, false]);
    expect(starts).toEqual([0, 1050, 2100]);
  });
  it("honors bounded Retry-After for a later operation without replaying a throttled request", async () => {
    let clock = 0; const starts: number[] = [];
    const adapter = createPromotionsReadProductionAdapter({ getAccessToken: async () => "fixture-access-token", invalidateAccessToken: () => undefined, now: () => new Date(clock), sleep: async (milliseconds) => { clock += milliseconds; }, fetch: async () => { starts.push(clock); return starts.length === 1 ? new Response(null, { status: 429, headers: { "retry-after": "10" } }) : Response.json({ ok: true }); } });
    const input = await plan();
    await expect(adapter.searchPromotions(input)).rejects.toMatchObject({ status: 429 });
    expect(starts).toEqual([0]);
    await adapter.getPromotion({ ...input, promotionId: "fixture-promotion" });
    expect(starts).toEqual([0, 10_000]);
  });
  it("a cancelled token wait cannot dispatch late or block a new operation", async () => {
    let tokenRequested!: () => void;
    const started = new Promise<void>((resolve) => { tokenRequested = resolve; });
    let requests = 0; let tokenCalls = 0;
    const adapter = createPromotionsReadProductionAdapter({ getAccessToken: async () => { tokenCalls += 1; if (tokenCalls === 1) { tokenRequested(); return new Promise<string>(() => undefined); } return "fixture-access-token"; }, invalidateAccessToken: () => undefined, fetch: async () => { requests += 1; return Response.json({ ok: true }); } });
    const input = await plan(); const controller = new AbortController();
    const stopped = adapter.searchPromotions({ ...input, signal: controller.signal });
    const rejected = expect(stopped).rejects.toThrow("fixture stop");
    await started; controller.abort(new Error("fixture stop")); await rejected;
    await expect(adapter.searchPromotions(input)).resolves.toEqual({ ok: true });
    expect(requests).toBe(1);
  });
  it.each([403, 429, 500, 503])("does not replay upstream status %s or expose its error body", async (status) => {
    let requests = 0;
    const adapter = createPromotionsReadProductionAdapter({ getAccessToken: async () => "fixture-access-token", invalidateAccessToken: () => undefined, fetch: async () => { requests += 1; return new Response("access_token=fixture-private-material", { status }); } });
    const pending = adapter.searchPromotions(await plan());
    await expect(pending).rejects.toMatchObject({ status });
    await expect(pending).rejects.not.toThrow("fixture-private-material");
    expect(requests).toBe(1);
  });
  it("stops after one unsuccessful token refresh", async () => {
    let requests = 0;
    const adapter = createPromotionsReadProductionAdapter({ getAccessToken: async () => "fixture-access-token", invalidateAccessToken: () => undefined, sleep: async () => undefined, fetch: async () => { requests += 1; return new Response(null, { status: 401 }); } });
    await expect(adapter.searchPromotions(await plan())).rejects.toMatchObject({ status: 401 });
    expect(requests).toBe(2);
  });
});
