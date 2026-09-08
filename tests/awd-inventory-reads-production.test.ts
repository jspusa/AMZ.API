import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createAwdInventoryReadProductionAdapter as createAdapter } from "../src/main/amazon/awd-inventory-reads-production";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";

let createAwdInventoryReadProductionAdapter: typeof createAdapter;
beforeEach(async () => {
  // Each test is a new App session; requests within a test retain one quota.
  vi.resetModules();
  ({ createAwdInventoryReadProductionAdapter } = await import("../src/main/amazon/awd-inventory-reads-production"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function requestInput() {
  const adapter = createScriptedSpExecutionContextAdapter((marketplaceId) => ({ marketplaceId, mode: "live", accountScope: "opaque-awd-transport-test" }));
  const context = await adapter.capture("ATVPDKIKX0DER");
  return { context, signal: new AbortController().signal, assertCurrent: () => adapter.assertCurrent(context) };
}

describe("AWD fixed production read transport", () => {
  it("does not begin credential retrieval when cancellation occurs inside the queued context fence", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const getAccessToken = vi.fn(async () => { throw new Error("unused credential failure"); });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    let fences = 0;
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken, invalidateAccessToken: () => undefined });
    const result = adapter.listInventory({
      ...await requestInput(), signal: controller.signal,
      assertCurrent: async () => { if (++fences === 2) controller.abort(new Error("cancelled inside context fence")); },
    }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(String(await result)).toContain("cancelled inside context fence");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves a 120-second HTTP-date cooldown for another adapter without replaying the failed read", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    let retryAt = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length === 1) {
        retryAt = Math.ceil((Date.now() + 120000) / 1000) * 1000;
        return new Response("not public", { status: 429, headers: { "retry-after": new Date(retryAt).toUTCString() } });
      }
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }));
    const dependencies = { getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined };
    const input = await requestInput();
    const first = createAwdInventoryReadProductionAdapter(dependencies).listInventory(input).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    const otherRead = createAwdInventoryReadProductionAdapter(dependencies).listInboundShipments(input);
    await vi.advanceTimersByTimeAsync(119000);
    expect(starts).toHaveLength(1);
    await vi.runAllTimersAsync();
    await otherRead;
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBeGreaterThanOrEqual(retryAt);
  });
  it.each(["text/plain", "application/xml"])("rejects a non-JSON content type: %s", async (contentType) => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response("{}", { headers: { "content-type": contentType } }));
    vi.stubGlobal("fetch", fetcher);
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const result = adapter.listInventory(await requestInput()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 502, code: "AWD_INVALID_RESPONSE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed advertised Content-Length without attempting to parse its body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "garbled" } })));
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const result = adapter.listInventory(await requestInput()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 502, code: "AWD_INVALID_RESPONSE" });
  });
  it.each(["120", "malformed-date", "Tue, 08 Sep 2026 12:00:00 BAD"])("does not automatically retry an out-of-bound or malformed advertised Retry-After: %s", async (retryAfter) => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response("not public", { status: 429, headers: { "retry-after": retryAfter } }));
    vi.stubGlobal("fetch", fetcher);
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const result = adapter.listInventory(await requestInput()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("honors a canonical HTTP-date Retry-After across the shared AWD request queue", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    let retryAt = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length === 1) {
        retryAt = Math.ceil((Date.now() + 30000) / 1000) * 1000;
        return new Response("not public", { status: 429, headers: { "retry-after": new Date(retryAt).toUTCString() } });
      }
      return new Response(JSON.stringify({ inventory: [] }), { headers: { "content-type": "application/json" } });
    }));
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const result = adapter.listInventory(await requestInput());
    await vi.runAllTimersAsync();
    await result;
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBeGreaterThanOrEqual(retryAt);
  });
  it.each(["declared", "streamed"])("rejects %s bodies larger than 16 MiB without replaying", async (kind) => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => kind === "declared"
      ? new Response("{}", { headers: { "content-length": "16777217", "content-type": "application/json" } })
      : new Response(new Uint8Array(16777217), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const result = adapter.listInventory(await requestInput()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 502, code: "AWD_RESPONSE_TOO_LARGE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch after account context changes while credentials are being obtained", async () => {
    vi.useFakeTimers();
    const input = await requestInput();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    let drifted = false;
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => { drifted = true; return "fixture-only"; }, invalidateAccessToken: () => undefined });
    const result = adapter.listInventory({ ...input, assertCurrent: async () => { if (drifted) throw Object.assign(new Error("context changed"), { status: 409, code: "ACCOUNT_SCOPE_CHANGED" }); } }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 409, code: "ACCOUNT_SCOPE_CHANGED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels stalled credentials and never dispatches their late completion", async () => {
    vi.useFakeTimers();
    let release!: (value: string) => void;
    const token = new Promise<string>((resolve) => { release = resolve; });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => token, invalidateAccessToken: () => undefined });
    const controller = new AbortController();
    const result = adapter.listInventory({ ...await requestInput(), signal: controller.signal }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000);
    controller.abort(new Error("caller-cancelled"));
    expect(String(await result)).toContain("caller-cancelled");
    release("fixture-only");
    await vi.runAllTimersAsync();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses a noncanonical successful HTTP status instead of accepting an incomplete response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ inventory: [] }), { status: 206 })));
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const result = adapter.listInventory(await requestInput()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 502, code: "AWD_INVALID_RESPONSE" });
  });
  it("rejects path traversal shipment identifiers before obtaining credentials", async () => {
    const getAccessToken = vi.fn(async () => "fixture-only");
    vi.stubGlobal("fetch", vi.fn());
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken, invalidateAccessToken: () => undefined });
    const result = adapter.getInboundShipment({ ...await requestInput(), shipmentId: ".." }).catch((error: unknown) => error);
    expect(await result).toMatchObject({ status: 400, code: "AWD_INVALID_INPUT" });
    expect(getAccessToken).not.toHaveBeenCalled();
  });
  it("paces bounded transient GET retries and stops after three failed attempts", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now());
      return new Response("not public", { status: 503 });
    }));
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const result = adapter.listInventory(await requestInput()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 503, code: "AWD_UPSTREAM_UNAVAILABLE" });
    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1050);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1050);
  });
  it("keeps the 12-second deadline active while the response body is stalled", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start() {}, cancel }), { headers: { "content-type": "application/json" } })));
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const result = adapter.listInventory(await requestInput()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await result).toMatchObject({ status: 504, code: "AWD_UPSTREAM_UNAVAILABLE" });
    expect(cancel).toHaveBeenCalled();
  });
  it("refreshes authentication once and returns fixed permission errors without upstream bodies", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("private-upstream-message", { status: 401 }))
      .mockResolvedValue(new Response("private-upstream-message", { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    const invalidate = vi.fn();
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: invalidate });
    const result = adapter.listInventory(await requestInput());
    const rejected = expect(result).rejects.toMatchObject({ status: 403, code: "AWD_UNAUTHORIZED" });
    await vi.runAllTimersAsync();
    await rejected;
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("only dispatches the three fixed GET operations and never invents a marketplace query", async () => {
    vi.useFakeTimers();
    const requests: { url: string; method: string | undefined; redirect: RequestRedirect | undefined }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      requests.push({ url: String(url), method: init.method, redirect: init.redirect });
      return new Response(JSON.stringify({ inventory: [], shipments: [] }), { headers: { "content-type": "application/json" } });
    }));
    const adapter = createAwdInventoryReadProductionAdapter({ getAccessToken: async () => "fixture-only", invalidateAccessToken: () => undefined });
    const input = await requestInput();
    const reads = Promise.all([
      adapter.listInventory({ ...input, nextToken: "opaque-page" }),
      adapter.listInboundShipments(input),
      adapter.getInboundShipment({ ...input, shipmentId: "fixture-shipment" }),
    ]);
    await vi.runAllTimersAsync();
    await reads;
    expect(requests).toEqual([
      { url: "https://sellingpartnerapi-na.amazon.com/awd/2024-05-09/inventory?details=SHOW&maxResults=200&nextToken=opaque-page", method: "GET", redirect: "error" },
      { url: "https://sellingpartnerapi-na.amazon.com/awd/2024-05-09/inboundShipments?sortBy=UPDATED_AT&sortOrder=DESCENDING&maxResults=100", method: "GET", redirect: "error" },
      { url: "https://sellingpartnerapi-na.amazon.com/awd/2024-05-09/inboundShipments/fixture-shipment?skuQuantities=SHOW", method: "GET", redirect: "error" },
    ]);
  });
});
