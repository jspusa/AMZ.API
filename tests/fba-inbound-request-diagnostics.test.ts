import { describe, expect, it, vi } from "vitest";
import { createFbaInboundReadsProductionAdapter } from "../src/main/amazon/fba-inbound-reads-production";
import { FbaExpiryReads } from "../src/main/amazon/fba-expiry-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { publicSpApiError, SpApiError } from "../src/main/amazon/sp-api-error";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import { InventoryHealthSync } from "../src/main/inventory-health-sync";
import type { FbaInboundExternalReadPlan } from "../src/main/amazon/fba-inbound-reads";
import type { ApiRequest } from "../src/shared/contracts";
import type { InventoryHealthReportSnapshot } from "../src/main/amazon/aged-inventory-reads";
import type { InventoryHealthSyncJob } from "../src/shared/inventory-health-sync";
import type { InventoryHealthSnapshot } from "../src/shared/inventory-health";
import type { ReportsRuntimeReceipt } from "../src/main/amazon/reports-runtime";

const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-09-13T12:00:00Z");
const PLAN_ID = "wf1234abcd-1234-abcd-5678-1234abcd5678";
const PLAN = { inboundPlanId: PLAN_ID, marketplaceIds: [US], name: "", lastUpdatedAt: "2026-09-12T12:00:00Z", status: "SHIPPED" };
const ITEM = { msku: "SYNTHETIC-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 100, expiration: "2027-12-01" };
const BASE = "Amazon 無法驗證這次 FBA 入庫貨件唯讀請求。";
const LEGACY = "Operation ListInboundPlanItems is not supported for Fulfillment Inbound API V0 shipments that have been converted to Send-to-Amazon inbound plans.";
const CANARY = "access_token=PRIVATE_CANARY https://private.invalid/secret";
const itemsPlan: FbaInboundExternalReadPlan = { source: "modern", marketplaceId: US, request: { kind: "plan-items", inboundPlanId: PLAN_ID, paginationToken: null } };
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "x-amzn-requestid": "synthetic-request" } });
const errorBody = (message: string, code = "BadRequest", details?: string) => ({ errors: [{ code, message, ...(details === undefined ? {} : { details }) }] });
function adapterHarness(response: Response | (() => Response), plan = itemsPlan) {
  const fetchImpl = vi.fn<typeof fetch>(async () => typeof response === "function" ? response() : response);
  const token = vi.fn(async () => "SYNTHETIC-TOKEN");
  const invalidate = vi.fn();
  const adapter = createFbaInboundReadsProductionAdapter({ getAccessToken: token, invalidateAccessToken: invalidate, fetchImpl, now: () => NOW, sleep: async () => undefined, userAgent: () => "AMZ.API/synthetic" });
  const run = async (signal?: AbortSignal) => {
    try { await adapter.read({ ...plan, signal }); } catch (error) {
      expect(error).toBeInstanceOf(SpApiError);
      return publicSpApiError(error as SpApiError, "公開備用訊息。");
    }
    throw new Error("Expected a rejected synthetic request");
  };
  return { adapter, run, fetchImpl, token, invalidate };
}

describe("FBA inbound request diagnostics at the real health sync seam", () => {
  it.each([
    ...["plans-first", "items-first", "items-next", "plans-next"].flatMap(target => [400, 422].map(status => ({ target, status, code: "InvalidInput", message: CANARY, reason: "其他請求條件遭拒" }))),
    { target: "items-first", status: 400, code: "BadRequest", message: LEGACY, reason: "舊版入庫計畫不支援商品讀取" },
    { target: "items-first", status: 400, code: "BadRequest", message: "The requested inbound plan does not exist.", reason: "指定入庫計畫不存在" },
    { target: "plans-first", status: 400, code: "BadRequest", message: "The status is invalid.", reason: "計畫狀態條件遭拒" },
  ])("identifies $target HTTP $status ($reason) without exposing private values", async ({ target, status, code, message, reason }) => {
    const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "synthetic-diagnostics" }));
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input)), items = url.pathname.endsWith("/items"), next = url.searchParams.has("paginationToken");
      expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined();
      const stage = `${items ? "items" : "plans"}-${next ? "next" : "first"}`;
      calls.push(stage);
      if (stage === target) return json(status, errorBody(message, code, CANARY));
      return json(200, items
        ? { items: [ITEM], ...(target === "items-next" ? { pagination: { nextToken: "PRIVATE-CURSOR" } } : {}) }
        : { inboundPlans: [PLAN], ...(target === "plans-next" ? { pagination: { nextToken: "PRIVATE-CURSOR" } } : {}) });
    });
    const invalidate = vi.fn();
    const adapter = createFbaInboundReadsProductionAdapter({ getAccessToken: async () => "SYNTHETIC-TOKEN", invalidateAccessToken: invalidate, fetchImpl, now: () => NOW, sleep: async () => undefined });
    const health = new InventoryHealthCoordinator({ context, expiry: new FbaExpiryReads({ context, adapter, now: () => NOW }), now: () => NOW });
    const stock: InventoryHealthReportSnapshot = { marketplaceId: US, mode: "live", fetchedAt: NOW.toISOString(), rows: [{ sellerSku: ITEM.msku, asin: ITEM.asin, title: "Synthetic", available: 1000, agedOver180: null, estimatedExcessQuantity: null, currencyCode: null, estimatedStorageCostNextMonth: null, estimatedAgedSurcharge: null, snapshotDate: "2026-09-13", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 } }] };
    const receipt: ReportsRuntimeReceipt = { reportId: "report-lease.synthetic", documentId: "report-document.synthetic", status: "DONE", ready: true, mode: "live", notice: "ready" };
    const begin = vi.fn(async () => receipt);
    const sync = new InventoryHealthSync({ context, health, reads: { begin, status: async () => receipt, readInventoryHealth: async () => stock }, now: () => NOW.getTime() });
    const get: ApiRequest = { requestId: "synthetic", method: "GET", path: "/api/inventory-health/sync", query: { marketplaceId: US }, headers: {} };
    await sync.start({ ...get, method: "POST", query: {}, body: { kind: "json", value: { marketplaceId: US } } });
    let job: InventoryHealthSyncJob | null = null;
    await vi.waitFor(async () => {
      job = ((await sync.observe(get)).body.value as { job: InventoryHealthSyncJob }).job;
      expect(job?.status).toBe("partial");
    }, { timeout: 1000, interval: 5 });
    expect(job).toMatchObject({ error: { code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE", message: `${BASE}（${target.startsWith("items") ? "入庫商品清單" : "入庫計畫清單"}／${target.endsWith("next") ? "接續頁" : "首頁"}；HTTP ${status}；Amazon：${code}；原因：${reason}；回應：已讀取）` } });
    const snapshot = ((await health.read({ ...get, path: "/api/inventory-health" })).body.value as { snapshot: InventoryHealthSnapshot }).snapshot;
    expect(snapshot).toMatchObject({ sourceComplete: false });
    expect(snapshot.rows[0]).toMatchObject({ available: 1000, wholeSkuClearanceDays: 100, calendarEligible: false, confirmedRemaining: null });
    expect(JSON.stringify(job)).not.toMatch(/PRIVATE|SYNTHETIC|wf1234|private\.invalid|access_token/);
    expect(calls.filter(stage => stage === target)).toHaveLength(1);
    const completedCalls = calls.length; await sync.observe(get); expect(calls).toHaveLength(completedCalls);
    expect(invalidate).not.toHaveBeenCalled(); expect(begin).toHaveBeenCalledTimes(1); sync.clear();
  });
});

describe("bounded terminal request error evidence", () => {
  it("labels the physical first page when the optional token is empty", async () => {
    const plan: FbaInboundExternalReadPlan = { source: "modern", marketplaceId: US, request: { kind: "plans", paginationToken: "" } };
    const h = adapterHarness(json(400, errorBody("The status is invalid.")), plan);
    expect((await h.run()).message).toContain("入庫計畫清單／首頁");
    expect(new URL(String(h.fetchImpl.mock.calls[0]![0])).searchParams.has("paginationToken")).toBe(false);
  });

  it.each([
    [LEGACY, "舊版入庫計畫不支援商品讀取"],
    [`ERROR: ${LEGACY}`, "舊版入庫計畫不支援商品讀取"],
    ["The requested inbound plan does not exist.", "指定入庫計畫不存在"],
  ])("recognizes the documented exact message %s", async (message, reason) => {
    const response = json(400, errorBody(message, "BadRequest", CANARY));
    const h = adapterHarness(response);
    expect(await h.run()).toMatchObject({ status: 400, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE", message: `${BASE}（入庫商品清單／首頁；HTTP 400；Amazon：BadRequest；原因：${reason}；回應：已讀取）` });
    expect(response.bodyUsed).toBe(true); expect(response.body!.locked).toBe(false);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1); expect(h.invalidate).not.toHaveBeenCalled();
  });

  it("keeps the known status rejection scoped to the plans operation", async () => {
    const plans: FbaInboundExternalReadPlan = { source: "modern", marketplaceId: US, request: { kind: "plans", paginationToken: null } };
    expect((await adapterHarness(json(400, errorBody("The status is invalid.")), plans).run()).message).toContain("原因：計畫狀態條件遭拒");
    expect((await adapterHarness(json(400, errorBody("The status is invalid."))).run()).message).toContain("原因：其他請求條件遭拒");
    expect((await adapterHarness(json(400, errorBody(LEGACY)), plans).run()).message).toContain("原因：其他請求條件遭拒");
  });

  it.each([
    [400, "InvalidInput", "Invalid paginationToken PRIVATE-CURSOR"],
    [422, "BadRequest", LEGACY],
    [400, "BadRequest", `untrusted prefix ${LEGACY}`],
    [400, "BadRequest", `${LEGACY} untrusted suffix`],
    [400, "BadRequest", ` ${LEGACY}`],
    [400, "BadRequest", LEGACY.toLowerCase()],
  ])("keeps unsupported cause inferences generic for %s / %s / %s", async (status, code, message) => {
    const h = adapterHarness(json(status, errorBody(message, code)));
    expect(await h.run()).toMatchObject({ status, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE", message: `${BASE}（入庫商品清單／首頁；HTTP ${status}；Amazon：${code}；原因：其他請求條件遭拒；回應：已讀取）` });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1); expect(h.token).toHaveBeenCalledTimes(1); expect(h.invalidate).not.toHaveBeenCalled();
  });

  it.each([
    [{ errors: [{ code: "SafeButUnreviewed", message: LEGACY }] }, "已讀取"],
    [{ errors: [{ code: CANARY, message: LEGACY, details: CANARY }] }, "已讀取"],
    [{ errors: [{ code: "BadRequest", message: LEGACY }, { code: "BadRequest", message: "The requested inbound plan does not exist." }] }, "已讀取"],
    [{ errors: [{ code: "BadRequest", message: LEGACY }, { code: "InvalidInput", message: LEGACY }] }, "已讀取"],
    [{ errors: [{ code: "BadRequest", message: LEGACY }, { code: "BadRequest", message: CANARY }] }, "已讀取"],
    [{ errors: [] }, "格式無法辨識"],
    [{ errors: Array.from({ length: 9 }, () => ({ code: "BadRequest", message: LEGACY })) }, "格式無法辨識"],
    [{ errors: [{ code: "BadRequest", message: LEGACY, details: 1 }] }, "格式無法辨識"],
    [{ errors: [{ code: "BadRequest", message: LEGACY, details: "X".repeat(8193) }] }, "格式無法辨識"],
    [{ errors: [{ code: "BadRequest", message: "X".repeat(2049) }] }, "格式無法辨識"],
    [{ errors: [{ code: "X".repeat(257), message: LEGACY }] }, "格式無法辨識"],
    [{ errors: [{ code: "BadRequest", message: LEGACY, extra: CANARY }] }, "格式無法辨識"],
    [{ errors: [{ code: "BadRequest", message: LEGACY }], extra: CANARY }, "格式無法辨識"],
    [[{ code: "BadRequest", message: LEGACY }], "格式無法辨識"],
    [null, "格式無法辨識"],
  ])("withholds cause and arbitrary values for conflicting or unsupported body %#", async (body, state) => {
    const value = await adapterHarness(json(400, body)).run();
    expect(value.message).toBe(`${BASE}（入庫商品清單／首頁；HTTP 400；Amazon：未辨識；原因：尚無可辨識原因；回應：${state}）`);
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE|SafeButUnreviewed|private\.invalid|access_token/);
  });

  it("accepts agreeing bounded errors without exposing their optional details", async () => {
    const value = await adapterHarness(json(400, { errors: Array.from({ length: 8 }, () => ({ code: "BadRequest", message: LEGACY, details: CANARY })) })).run();
    expect(value.message).toContain("原因：舊版入庫計畫不支援商品讀取");
    expect(JSON.stringify(value)).not.toContain(CANARY);
  });

  it.each([
    [new Uint8Array([0xc3, 0x28]), "格式無法辨識"],
    ["{ invalid JSON", "格式無法辨識"],
    ["", "空白"],
    [null, "空白"],
  ])("retains HTTP status on an unreadable body %#", async (body, state) => {
    const h = adapterHarness(new Response(body, { status: 422 }));
    expect(await h.run()).toMatchObject({ status: 422, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE", message: `${BASE}（入庫商品清單／首頁；HTTP 422；Amazon：未辨識；原因：尚無可辨識原因；回應：${state}）` });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts exactly 128 KiB and rejects one extra byte even with a smaller declared size", async () => {
    const text = JSON.stringify(errorBody(LEGACY));
    const bytes = new TextEncoder().encode(text.padEnd(128 * 1024));
    expect((await adapterHarness(new Response(bytes, { status: 400 })).run()).message).toContain("原因：舊版入庫計畫不支援商品讀取");
    for (const declared of [undefined, "2"]) {
      const cancel = vi.fn(); let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; controller.enqueue(pulls === 1 ? bytes : new Uint8Array([32])); }, cancel }, { highWaterMark: 0 });
      const response = new Response(stream, { status: 400, headers: declared === undefined ? {} : { "content-length": declared } });
      const h = adapterHarness(response);
      expect((await h.run()).message).toContain("回應：超過讀取上限");
      expect(pulls).toBe(2); expect(cancel).toHaveBeenCalledTimes(1); expect(response.body!.locked).toBe(false); expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it.each([["131073", "超過讀取上限"], ["bad", "格式無法辨識"]])("cancels a declared invalid error body %s without reading it", async (length, state) => {
    const pull = vi.fn(), cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status: 400, headers: { "content-length": length } });
    expect((await adapterHarness(response).run()).message).toContain(`回應：${state}`);
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1); expect(response.body!.locked).toBe(false);
  });

  it("retains the original 400 and cancels a stalled body at the short deadline", async () => {
    vi.useFakeTimers();
    try {
      let started!: () => void;
      const reading = new Promise<void>(resolve => { started = resolve; });
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ pull() { started(); return new Promise<void>(() => undefined); }, cancel }, { highWaterMark: 0 }), { status: 400 });
      const h = adapterHarness(response);
      const pending = h.run(); await reading;
      await vi.advanceTimersByTimeAsync(1999); expect(cancel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ status: 400, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE", message: `${BASE}（入庫商品清單／首頁；HTTP 400；Amazon：未辨識；原因：尚無可辨識原因；回應：讀取逾時）` });
      expect(cancel).toHaveBeenCalledTimes(1); expect(h.fetchImpl).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("propagates caller abort during error-body reading and releases the stream", async () => {
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull() { started(); return new Promise<void>(() => undefined); }, cancel }, { highWaterMark: 0 }), { status: 400 });
    const h = adapterHarness(response), controller = new AbortController(), reason = new Error("synthetic context stop");
    const pending = expect(h.adapter.read({ ...itemsPlan, signal: controller.signal })).rejects.toBe(reason);
    await reading; controller.abort(reason); await pending;
    expect(cancel).toHaveBeenCalledTimes(1); expect(response.body!.locked).toBe(false); expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not expose a stream failure or replace its HTTP status", async () => {
    const response = new Response(new ReadableStream({ pull(controller) { controller.error(new Error(CANARY)); } }), { status: 400 });
    const value = await adapterHarness(response).run();
    expect(value).toMatchObject({ status: 400, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE" });
    expect(value.message).toContain("回應：無法讀取"); expect(JSON.stringify(value)).not.toContain(CANARY);
  });

  it.each([401, 403, 404, 429, 500])("does not parse the diagnostic body or change auth/retry behavior for HTTP %s", async status => {
    const bodies: Array<ReturnType<typeof vi.fn>> = [];
    const h = adapterHarness(() => {
      const pull = vi.fn(); bodies.push(pull);
      return new Response(new ReadableStream({ pull }, { highWaterMark: 0 }), { status });
    });
    const value = await h.run();
    expect(value.message).not.toContain("HTTP");
    expect(value.code).toBe(status === 401 || status === 403 ? "FBA_INBOUND_UNAUTHORIZED" : status === 429 ? "RATE_LIMITED" : "FBA_INBOUND_UPSTREAM_UNAVAILABLE");
    expect(h.fetchImpl).toHaveBeenCalledTimes(status === 401 ? 2 : status === 429 || status === 500 ? 3 : 1);
    expect(h.invalidate).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(bodies.every(pull => pull.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    { source: "modern", marketplaceId: US, request: { kind: "plan", inboundPlanId: PLAN_ID } },
    { source: "modern", marketplaceId: US, request: { kind: "shipment", inboundPlanId: PLAN_ID, shipmentId: "shipment-synthetic" } },
    { source: "v0", request: { kind: "items", marketplaceId: US, shipmentId: "FBA19SYNTHETIC", queryType: "SHIPMENT", nextToken: null } },
  ] as FbaInboundExternalReadPlan[])("leaves other fixed read operations unchanged %#", async plan => {
    const pull = vi.fn();
    const h = adapterHarness(new Response(new ReadableStream({ pull }, { highWaterMark: 0 }), { status: 400 }), plan);
    expect(await h.run()).toMatchObject({ status: 400, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE", message: BASE });
    expect(pull).not.toHaveBeenCalled(); expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });
});
