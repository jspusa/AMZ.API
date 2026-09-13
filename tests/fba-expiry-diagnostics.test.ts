import { describe, expect, it, vi } from "vitest";
import { FbaExpiryReads, parseFbaExpiryCheckpoint } from "../src/main/amazon/fba-expiry-reads";
import { fbaInboundExternalReadIdentity, type FbaInboundExternalReadAdapter } from "../src/main/amazon/fba-inbound-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { publicSpApiError, SpApiError } from "../src/main/amazon/sp-api-error";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import { InventoryHealthSync } from "../src/main/inventory-health-sync";
import type { InventoryHealthReportSnapshot } from "../src/main/amazon/aged-inventory-reads";
import type { ReportsRuntimeReceipt } from "../src/main/amazon/reports-runtime";
import type { ApiRequest } from "../src/shared/contracts";
import type { InventoryHealthSyncJob } from "../src/shared/inventory-health-sync";
import type { InventoryHealthSnapshot } from "../src/shared/inventory-health";

const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-07-01T12:00:00Z");
const PLAN = { inboundPlanId: "wf1234abcd-1234-abcd-5678-1234abcd5678", marketplaceIds: [US], name: "Synthetic inbound", lastUpdatedAt: "2026-06-01T00:00:00Z", status: "SHIPPED" };
const ITEM = { msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 100, expiration: "2026-12-01" };
const NAME_MESSAGE = "Amazon 入庫計畫名稱格式無法辨識，已停止效期讀取。";
const RAW = " refresh_token=DIAGNOSTIC_CANARY https://private.invalid/secret ";

function harness(envelope: (kind: "plans" | "plan-items") => unknown, mismatch = false) {
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "synthetic-expiry-diagnostics" }));
  const read = vi.fn<FbaInboundExternalReadAdapter["read"]>(async request => {
    if (request.source !== "modern" || (request.request.kind !== "plans" && request.request.kind !== "plan-items")) throw new Error("Unexpected read kind");
    const identity = fbaInboundExternalReadIdentity(request);
    return { identity: mismatch ? { ...identity, source: "v0" } as typeof identity : identity, envelope: envelope(request.request.kind), requestId: null };
  });
  const expiry = new FbaExpiryReads({ context, adapter: { read }, now: () => NOW });
  return { context, expiry, read, run: async (checkpoint?: unknown) => expiry.read({ context: await context.capture(US), signal: new AbortController().signal, checkpoint }) };
}
async function failure(work: Promise<unknown>) {
  try { await work; } catch (error) {
    expect(error).toBeInstanceOf(SpApiError);
    return publicSpApiError(error as SpApiError, "公開備用訊息。");
  }
  throw new Error("Expected expiry validation failure");
}

describe("FBA expiry fixed public diagnostics", () => {
  it("identifies the rejected plan name through the real expiry and health sync owners", async () => {
    const h = harness(kind => kind === "plans" ? { inboundPlans: [{ ...PLAN, name: "" }] } : { items: [ITEM] });
    const health = new InventoryHealthCoordinator({ context: h.context, expiry: h.expiry, now: () => NOW });
    const stock: InventoryHealthReportSnapshot = { marketplaceId: US, mode: "live", fetchedAt: NOW.toISOString(), rows: [{ sellerSku: ITEM.msku, asin: ITEM.asin, title: "Synthetic", available: 1000, agedOver180: null, estimatedExcessQuantity: null, currencyCode: null, estimatedStorageCostNextMonth: null, estimatedAgedSurcharge: null, snapshotDate: "2026-07-01", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 } }] };
    const receipt: ReportsRuntimeReceipt = { reportId: "report-lease.synthetic", documentId: "report-document.synthetic", status: "DONE", ready: true, mode: "live", notice: "ready" };
    const begin = vi.fn(async () => receipt);
    const sync = new InventoryHealthSync({ context: h.context, reads: { begin, status: async () => receipt, readInventoryHealth: async () => stock }, health, now: () => NOW.getTime() });
    const get: ApiRequest = { requestId: "synthetic-health", method: "GET", path: "/api/inventory-health/sync", query: { marketplaceId: US }, headers: {} };
    expect((await sync.start({ ...get, method: "POST", query: {}, body: { kind: "json", value: { marketplaceId: US } } })).status).toBe(202);
    let job: InventoryHealthSyncJob | null = null;
    await vi.waitFor(async () => {
      const response = await sync.observe(get);
      job = (response.body.value as { job: InventoryHealthSyncJob | null }).job;
      expect(job?.status).toBe("partial");
    }, { timeout: 1000, interval: 5 });
    expect(job).toMatchObject({ error: { code: "FBA_EXPIRY_FORMAT_UNSUPPORTED", message: `${NAME_MESSAGE}（空字串）` } });
    const snapshot = (await health.read({ ...get, path: "/api/inventory-health" })).body.value as { snapshot: InventoryHealthSnapshot };
    expect(snapshot.snapshot.rows[0]).toMatchObject({ available: 1000, wholeSkuClearanceDays: 100, calendarEligible: false });
    expect(snapshot.snapshot.sourceComplete).toBe(false);
    await sync.observe(get);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["inboundPlanId", "Amazon 入庫計畫識別碼格式無法辨識，已停止效期讀取。（超過長度上限）"],
    ["lastUpdatedAt", "Amazon 入庫計畫更新時間格式無法辨識，已停止效期讀取。（首尾空白）"],
    ["name", `${NAME_MESSAGE}（首尾空白）`],
    ["status", "Amazon 入庫計畫狀態無法辨識，已停止效期讀取。"],
  ])("identifies plan %s without including its adversarial value", async (field, message) => {
    const h = harness(kind => kind === "plans" ? { inboundPlans: [{ ...PLAN, [field]: RAW }] } : { items: [ITEM] });
    const error = await failure(h.run());
    expect(error).toMatchObject({ status: 502, code: "FBA_EXPIRY_FORMAT_UNSUPPORTED", message, requestId: null });
    expect(JSON.stringify(error)).not.toMatch(/DIAGNOSTIC_CANARY|private\.invalid|refresh_token/);
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["msku", "Amazon 入庫商品的 Seller SKU 格式無法辨識，已停止效期讀取。（超過長度上限）"],
    ["asin", "Amazon 入庫商品的 ASIN 格式無法辨識，已停止效期讀取。（超過長度上限）"],
    ["fnsku", "Amazon 入庫商品的 FNSKU 格式無法辨識，已停止效期讀取。（超過長度上限）"],
    ["expiration", "Amazon 入庫商品申報效期格式無法辨識，已停止效期讀取。（超過長度上限）"],
    ["manufacturingLotCode", "Amazon 入庫商品製造批號格式無法辨識，已停止效期讀取。（首尾空白）"],
    ["quantity", "Amazon 入庫商品申報數量無法核對，已停止效期讀取。"],
  ])("identifies item %s without including its adversarial value", async (field, message) => {
    const h = harness(kind => kind === "plans" ? { inboundPlans: [PLAN] } : { items: [{ ...ITEM, [field]: RAW }] });
    const error = await failure(h.run());
    expect(error).toMatchObject({ status: 502, code: "FBA_EXPIRY_FORMAT_UNSUPPORTED", message });
    expect(JSON.stringify(error)).not.toMatch(/DIAGNOSTIC_CANARY|private\.invalid|refresh_token/);
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["response", [RAW], { items: [ITEM] }, "Amazon 入庫效期回應結構無法辨識，已停止讀取。"],
    ["plans page", { inboundPlans: RAW }, { items: [ITEM] }, "Amazon 入庫計畫清單格式無法辨識或超過單頁上限，已停止效期讀取。"],
    ["plan summary", { inboundPlans: [RAW] }, { items: [ITEM] }, "Amazon 入庫計畫摘要格式無法辨識，已停止效期讀取。"],
    ["marketplaces", { inboundPlans: [{ ...PLAN, marketplaceIds: [RAW] }] }, { items: [ITEM] }, "Amazon 入庫計畫站點資料無法核對，已停止效期讀取。"],
    ["items page", { inboundPlans: [PLAN] }, { items: RAW }, "Amazon 入庫商品清單格式無法辨識或超過單頁上限，已停止效期讀取。"],
    ["item record", { inboundPlans: [PLAN] }, { items: [RAW] }, "Amazon 入庫商品資料格式無法辨識，已停止效期讀取。"],
    ["pagination", { inboundPlans: [PLAN], pagination: { nextToken: RAW } }, { items: [ITEM] }, "Amazon 入庫效期分頁資料無法核對或未向前推進，已停止讀取。（首尾空白）"],
    ["duplicate plan", { inboundPlans: [PLAN, PLAN] }, { items: [ITEM] }, "Amazon 入庫計畫清單重複回傳相同計畫，已停止效期讀取。"],
    ["duplicate item", { inboundPlans: [PLAN] }, { items: [ITEM, ITEM] }, "Amazon 入庫商品重複回傳相同批次，已停止效期讀取。"],
  ])("distinguishes %s failures without exposing response fields", async (_label, plans, items, message) => {
    const error = await failure(harness(kind => kind === "plans" ? plans : items).run());
    expect(error).toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED", message });
    expect(JSON.stringify(error)).not.toMatch(/DIAGNOSTIC_CANARY|private\.invalid|refresh_token/);
  });

  it("keeps valid evidence and the checkpoint format unchanged", async () => {
    const h = harness(kind => kind === "plans" ? { inboundPlans: [PLAN] } : { items: [ITEM] });
    const result = await h.run();
    expect(result).toMatchObject({ complete: true, records: [{ sellerSku: ITEM.msku, expiryDate: ITEM.expiration, declaredQuantity: ITEM.quantity, confirmedRemaining: null }], checkpoint: { schemaVersion: 1, phase: "complete" } });
    expect(parseFbaExpiryCheckpoint(JSON.parse(JSON.stringify(result.checkpoint)))).toEqual(result.checkpoint);
    expect(await h.run(result.checkpoint)).toEqual(result);
    expect(h.read).toHaveBeenCalledTimes(3);
  });

  it("distinguishes malformed checkpoints, contradictory records, context and read limits", async () => {
    const h = harness(kind => kind === "plans" ? { inboundPlans: [PLAN] } : { items: [ITEM] });
    const valid = (await h.run()).checkpoint!;
    h.read.mockClear();
    expect(await failure(h.run({ schemaVersion: RAW }))).toMatchObject({ message: "本機入庫效期接續資料格式無法辨識，已停止讀取。" });
    const duplicate = structuredClone(valid);
    duplicate.cachedPlans[0]!.records.push({ ...duplicate.cachedPlans[0]!.records[0]! });
    expect(await failure(h.run(duplicate))).toMatchObject({ message: "本機入庫效期接續資料互相矛盾，已停止讀取。" });
    expect(await failure(h.run({ ...valid, scopeFingerprint: "a".repeat(64) }))).toMatchObject({ message: "Amazon 入庫效期回應與本次讀取身分不符，已停止讀取。" });
    const limit = { ...valid, phase: "partial", planPagesComplete: false, seenPlanTokens: Array.from({ length: 200 }, (_, index) => `token-${index}`) };
    expect(await failure(h.run(limit))).toMatchObject({ message: "Amazon 入庫效期資料超過安全讀取範圍，已停止讀取。" });
    expect(h.read).not.toHaveBeenCalled();
    expect(await failure(harness(() => ({ inboundPlans: [PLAN] }), true).run())).toMatchObject({ message: "Amazon 入庫效期回應與本次讀取身分不符，已停止讀取。" });
  });

  it.each([
    [null, "缺值或非文字"], ["", "空字串"], ["2026-02-31", "日期格式不符"],
  ])("still rejects unsupported expiration %s instead of normalizing it", async (expiration, detail) => {
    const h = harness(kind => kind === "plans" ? { inboundPlans: [PLAN] } : { items: [{ ...ITEM, expiration }] });
    expect(await failure(h.run())).toMatchObject({ message: `Amazon 入庫商品申報效期格式無法辨識，已停止效期讀取。（${detail}）` });
  });

  it.each([
    [undefined, "缺值或非文字"], [null, "缺值或非文字"], [12, "缺值或非文字"],
    ["", "空字串"], ["X".repeat(41), "超過長度上限"],
    [" X", "首尾空白"], ["X\u0000", "不安全控制字元"],
    [" X\u0000", "首尾空白"], [" \u0000" + "X".repeat(41), "超過長度上限"],
  ])("reports the first existing text rejection for synthetic SKU %j", async (msku, detail) => {
    const h = harness(kind => kind === "plans" ? { inboundPlans: [PLAN] } : { items: [{ ...ITEM, msku }] });
    const error = await failure(h.run());
    expect(error).toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED", message: `Amazon 入庫商品的 Seller SKU 格式無法辨識，已停止效期讀取。（${detail}）` });
    expect(error.message).not.toMatch(/X|12|41|\\u0000/);
  });

  it.each([
    ["plan date", { ...PLAN, lastUpdatedAt: "not-a-date" }, ITEM, "Amazon 入庫計畫更新時間格式無法辨識，已停止效期讀取。（日期格式不符）"],
    ["plan ID", { ...PLAN, inboundPlanId: "!".repeat(38) }, ITEM, "Amazon 入庫計畫識別碼格式無法辨識，已停止效期讀取。（識別碼格式不符）"],
    ["ASIN", PLAN, { ...ITEM, asin: "b000000001" }, "Amazon 入庫商品的 ASIN 格式無法辨識，已停止效期讀取。（識別碼格式不符）"],
  ])("identifies %s format rejection after text validation", async (_label, plan, item, message) => {
    const error = await failure(harness(kind => kind === "plans" ? { inboundPlans: [plan] } : { items: [item] }).run());
    expect(error).toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED", message });
  });
});
