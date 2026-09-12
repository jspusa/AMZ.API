import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryHealthPanel from "../src/renderer/src/components/inventory-health-panel";
import type { InventoryHealthRow, InventoryHealthSnapshot } from "../src/shared/inventory-health";
const marketplaceId = "ATVPDKIKX0DER";
const row = (overrides: Partial<InventoryHealthRow> = {}): InventoryHealthRow => ({
  id: "lot-one", sellerSku: "EXACT-SKU", asin: "B000000001", title: "Fixture product",
  expiryDate: "2026-11-01", stopSaleDate: "2026-10-01", sourceRef: "入庫申報 fixture", sourceUpdatedAt: "2026-09-11T10:00:00Z",
  declaredQuantity: 900, confirmedRemaining: 400, available: 700, agedOver180: 200,
  estimatedExcessQuantity: 100, currencyCode: "USD", estimatedStorageCostNextMonth: 12.5, estimatedAgedSurcharge: 8,
  dailyUnits: 5, daysRemaining: 19, quantityDueByDate: 400, projectedShortfall: 305,
  minimumDailyUnits: 21.06, wholeSkuClearanceDays: 140, status: "clearance-risk", reason: "以最快已回報銷速推估，仍有清售缺口。",
  calendarEligible: true, snapshotDate: "2026-09-12", ...overrides,

});
const snapshot = (overrides: Partial<InventoryHealthSnapshot> = {}): InventoryHealthSnapshot => ({
  schemaVersion: 1, marketplaceId, mode: "live", fetchedAt: "2026-09-12T10:00:00Z", sourceComplete: true, stale: false,
  rows: [row(), row({ id: "missing:SECOND-SKU", sellerSku: "SECOND-SKU", title: "Needs evidence", expiryDate: null, stopSaleDate: null, confirmedRemaining: null, dailyUnits: null, daysRemaining: null, quantityDueByDate: null, projectedShortfall: null, minimumDailyUnits: null, wholeSkuClearanceDays: null, status: "needs-review", reason: "入庫申報數量不是批次餘量；請確認目前剩餘數量。", calendarEligible: false })], notice: "預測不保證未來銷量。", ...overrides,

});
let renderer: ReactTestRenderer | null = null;
const output = () => JSON.stringify(renderer?.toJSON());
function button(label: string) { return renderer!.root.findAllByType("button").find(node => node.props["aria-label"] === label || node.children.join("") === label)!; }
async function mount(handler: (url: string, init?: RequestInit) => Promise<Response>, includeSyncObservation = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const listeners = new Map<string, () => void>();
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), addEventListener: vi.fn((name: string, listener: () => void) => listeners.set(name, listener)), removeEventListener: vi.fn(), fbaOS: { app: { onContextInvalidated: (listener: () => void) => { listeners.set("context", listener); return () => listeners.delete("context"); } } } });
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => !includeSyncObservation && url.startsWith("/api/inventory-health/sync?") ? Promise.resolve(Response.json({ job: null })) : handler(url, init)));
  await act(async () => { renderer = create(<InventoryHealthPanel marketplaceId={marketplaceId} mode="live" />); });
  return listeners;
}
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("inventory health local workflow", () => {
  it("shows all FBA stock first and keeps unknown quantities distinct in the review group", async () => {
    const calls: string[] = [];
    await mount(async url => { calls.push(url); return Response.json({ snapshot: snapshot() }); });
    expect(calls).toEqual([`/api/inventory-health?marketplaceId=${marketplaceId}`]);
    expect(output()).toContain("EXACT-SKU");
    expect(output()).toContain("SECOND-SKU");
    expect(output()).toContain("全品號可售庫存／預估清完");
    expect(output()).toContain("最早申報效期");
    expect(output()).toContain("305");
    await act(async () => { button("待確認").props.onClick(); });
    expect(output()).toContain("SECOND-SKU");
    expect(output()).toContain("待確認餘量");
    expect(output()).not.toContain("列入行事曆");
  });

  it("saves only the three local confirmations for the exact snapshot and displays the returned result", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    await mount(async (url, init) => {
      requests.push({ url, init });
      return Response.json({ snapshot: init?.method === "POST" ? snapshot({ rows: [row({ confirmedRemaining: 200, quantityDueByDate: 200, projectedShortfall: 105 })] }) : snapshot() });
    });
    await act(async () => { button("核對批次：lot-one").props.onClick(); });
    const field = (label: string) => renderer!.root.findByProps({ "aria-label": label });
    expect(field("已確認批次餘量").props.value).toBe("400");
    expect(output()).toContain("USD 12.50");
    await act(async () => { field("已確認批次餘量").props.onChange({ target: { value: "200" } }); });
    await act(async () => { await renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe("/api/inventory-health/confirmation");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ marketplaceId, id: "lot-one", snapshotFetchedAt: snapshot().fetchedAt, confirmedRemaining: 200, expiryDate: "2026-11-01", stopSaleDate: "2026-10-01" });
    expect(output()).toContain("105");
    expect(output()).toContain("已儲存本機批次確認");
    expect(window.dispatchEvent).toHaveBeenCalledOnce();
  });
  it("sends an empty remaining quantity as unknown and keeps validation errors editable", async () => {
    let body: unknown;
    await mount(async (_url, init) => {
      if (init?.method === "POST") { body = JSON.parse(String(init.body)); return Response.json({ message: "請核對確認餘量。" }, { status: 400 }); }
      return Response.json({ snapshot: snapshot() });
    });
    await act(async () => { button("核對批次：lot-one").props.onClick(); });
    await act(async () => { renderer!.root.findByProps({ "aria-label": "已確認批次餘量" }).props.onChange({ target: { value: "" } }); });
    await act(async () => { await renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(body).toMatchObject({ confirmedRemaining: null });
    expect(output()).toContain("請核對確認餘量。");
    expect(renderer!.root.findByProps({ "aria-label": "已確認批次餘量" }).props.value).toBe("");
  });
  it("clears account data immediately on invalidation without fetching until focus, and ignores a late read", async () => {
    let resolveRead: ((response: Response) => void) | undefined;
    let calls = 0;
    const listeners = await mount(async () => {
      calls += 1;
      if (calls === 2) return new Promise<Response>(resolve => { resolveRead = resolve; });
      return Response.json({ snapshot: snapshot() });
    });
    await act(async () => { button("重新讀取本機資料").props.onClick(); });
    await act(async () => { listeners.get("context")!(); });
    expect(output()).not.toContain("EXACT-SKU");
    expect(calls).toBe(2);
    await act(async () => { resolveRead!(Response.json({ snapshot: snapshot() })); });
    expect(output()).not.toContain("EXACT-SKU");
    expect(calls).toBe(2);
    await act(async () => { listeners.get("focus")!(); });
    expect(calls).toBe(3);
    expect(output()).toContain("EXACT-SKU");
  });
  it("does not retry an uncertain save and requires a fresh local read", async () => {
    let posts = 0;
    await mount(async (_url, init) => {
      if (init?.method === "POST") { posts += 1; throw new TypeError("network interrupted"); }
      return Response.json({ snapshot: snapshot() });
    });
    await act(async () => { button("核對批次：lot-one").props.onClick(); });
    await act(async () => { await renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(posts).toBe(1);
    expect(output()).toContain("請重新讀取本機資料");
    expect(output()).not.toContain("EXACT-SKU");
    expect(renderer!.root.findAllByType("form")).toHaveLength(0);
    await act(async () => { button("重新讀取本機資料").props.onClick(); });
    expect(posts).toBe(1);
    expect(output()).toContain("EXACT-SKU");
  });
  it("ignores a late confirmation after an account change and restores only a fresh local result", async () => {
    let finishSave: ((response: Response) => void) | undefined;
    let posts = 0;
    const listeners = await mount(async (_url, init) => {
      if (init?.method === "POST") { posts += 1; return new Promise<Response>(resolve => { finishSave = resolve; }); }
      return Response.json({ snapshot: snapshot() });
    });
    await act(async () => { button("核對批次：lot-one").props.onClick(); });
    await act(async () => { void renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(button("重新讀取本機資料").props.disabled).toBe(true);
    await act(async () => { listeners.get("context")!(); });
    await act(async () => { finishSave!(Response.json({ snapshot: snapshot() })); });
    expect(output()).not.toContain("EXACT-SKU");
    expect(output()).not.toContain("已儲存本機批次確認");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
    await act(async () => { button("重新讀取本機資料").props.onClick(); });
    expect(posts).toBe(1);
    expect(output()).toContain("EXACT-SKU");
  });
  it("is independent of aged report completion but still binds the active mode", async () => {
    let active = snapshot();
    await mount(async () => Response.json({ snapshot: active }));
    await act(async () => { renderer!.update(<InventoryHealthPanel marketplaceId={marketplaceId} mode="live" sourceFetchedAt="2026-09-12T11:00:00Z" />); });
    expect(output()).toContain("EXACT-SKU");
    active = snapshot({ fetchedAt: "2026-09-12T11:00:00Z" });
    await act(async () => { button("重新讀取本機資料").props.onClick(); });
    expect(output()).toContain("EXACT-SKU");
    await act(async () => { renderer!.update(<InventoryHealthPanel marketplaceId={marketplaceId} mode="demo" />); });
    expect(output()).not.toContain("EXACT-SKU");
    expect(output()).toContain("站點或模式不一致");
  });

  it("starts full FBA synchronization directly and shows low-age estimates without an aged-audit request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let synced = false;
    await mount(async (url, init) => {
      calls.push({ url, init });
      if (url === "/api/inventory-health/sync") { synced = true; return Response.json({ job: { id: "sync-one", marketplaceId, mode: "live", status: "completed", stage: "complete", message: "已完成獨立同步", error: null } }); }
      return Response.json({ snapshot: synced ? snapshot({ sourceComplete: false, rows: [row({ agedOver180: 0, confirmedRemaining: null, quantityDueByDate: null, projectedShortfall: null, minimumDailyUnits: null, status: "needs-review", calendarEligible: false, wholeSkuClearanceDays: 140, estimatedDailyUnits: 5, earliestDeclaredExpiryDate: "2026-11-01", stockRisk: "may-outlast-expiry" })] }) : null });
    });
    await act(async () => { await button("同步全部 FBA 效期與銷速").props.onClick(); });
    expect(calls.some(call => call.url.includes("aged") || call.url.includes("standalone"))).toBe(false);
    expect(JSON.parse(String(calls.find(call => call.init?.method === "POST")?.init?.body))).toEqual({ marketplaceId });
    expect(output()).toContain("140"); expect(output()).toContain("2026-11-01");
    expect(output()).toContain("批次待核對"); expect(output()).not.toContain("★ 列入行事曆");
  });

  it("displays the safe source failure instead of a generic completed or empty result", async () => {
    await mount(async (url) => url === "/api/inventory-health/sync" ? Response.json({ job: { id: "sync-failed", marketplaceId, mode: "live", status: "failed", stage: "report", message: "報表缺少 SKU 欄位。", error: { code: "REPORT_FORMAT_UNSUPPORTED", message: "報表缺少 SKU 欄位。" } } }) : Response.json({ snapshot: snapshot() }));
    await act(async () => { await button("同步全部 FBA 效期與銷速").props.onClick(); });
    expect(output()).toContain("REPORT_FORMAT_UNSUPPORTED"); expect(output()).toContain("報表缺少 SKU 欄位");
    expect(output()).not.toContain("EXACT-SKU");
  });
  it("reconnects an existing main job with GET only before reading the resulting inventory", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let observations = 0;
    await mount(async (url, init) => {
      calls.push(url); expect(init?.method).not.toBe("POST");
      if (url.startsWith("/api/inventory-health/sync?")) {
        observations += 1;
        return Response.json({ job: { id: "reconnect-job", marketplaceId, mode: "live", status: observations === 1 ? "running" : "completed", stage: observations === 1 ? "report" : "complete", message: "主程序工作仍在進行", error: null } });
      }
      return Response.json({ snapshot: snapshot() });
    }, true);
    expect(output()).not.toContain("EXACT-SKU");
    expect(calls).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(calls[1]).toContain("jobId=reconnect-job");
    expect(calls[2]).toBe(`/api/inventory-health?marketplaceId=${marketplaceId}`);
    expect(output()).toContain("EXACT-SKU");
  });
  it("rejects a late sync-observer receipt after context invalidation without starting another request", async () => {
    let finish!: (response: Response) => void;
    let calls = 0;
    const listeners = await mount(async () => { calls += 1; return new Promise<Response>(resolve => { finish = resolve; }); }, true);
    await act(async () => { listeners.get("context")!(); });
    await act(async () => { finish(Response.json({ job: { id: "old-job", marketplaceId, mode: "live", status: "completed", stage: "complete", message: "old-account-job", error: null } })); });
    expect(calls).toBe(1); expect(output()).not.toContain("old-account-job");
    expect(output()).not.toContain("EXACT-SKU");
  });

  it("allows a GET reconnect after observer failure without starting a second main job", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; method?: string }> = [];
    let observations = 0;
    await mount(async (url, init) => {
      calls.push({ url, method: init?.method });
      if (url.startsWith("/api/inventory-health/sync?")) {
        observations += 1;
        if (observations === 2) throw new TypeError("connection interrupted");
        return Response.json({ job: { id: "recover-job", marketplaceId, mode: "live", status: observations < 4 ? "running" : "completed", stage: observations < 4 ? "report" : "complete", message: "主程序正在整理庫存", error: null } });
      }
      return Response.json({ snapshot: snapshot() });
    }, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(output()).toContain("connection interrupted");
    expect(button("同步中…").props.disabled).toBe(true);
    expect(button("重新讀取本機資料").props.disabled).toBe(false);
    await act(async () => { button("重新讀取本機資料").props.onClick(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(calls.every(call => call.method !== "POST")).toBe(true);
    expect(calls.filter(call => call.url.includes("jobId=recover-job"))).toHaveLength(2);
    expect(output()).toContain("EXACT-SKU");
    expect(button("同步全部 FBA 效期與銷速").props.disabled).toBe(false);
  });

});
