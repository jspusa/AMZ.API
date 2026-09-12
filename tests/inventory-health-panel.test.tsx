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
async function mount(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const listeners = new Map<string, () => void>();
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), addEventListener: vi.fn((name: string, listener: () => void) => listeners.set(name, listener)), removeEventListener: vi.fn(), fbaOS: { app: { onContextInvalidated: (listener: () => void) => { listeners.set("context", listener); return () => listeners.delete("context"); } } } });
  vi.stubGlobal("fetch", vi.fn(handler));
  await act(async () => { renderer = create(<InventoryHealthPanel marketplaceId={marketplaceId} mode="live" />); });
  return listeners;
}
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = null; vi.unstubAllGlobals(); });

describe("inventory health local workflow", () => {
  it("shows only clearance risk first and keeps unknown quantities distinct in the review group", async () => {
    const calls: string[] = [];
    await mount(async url => { calls.push(url); return Response.json({ snapshot: snapshot() }); });
    expect(calls).toEqual([`/api/inventory-health?marketplaceId=${marketplaceId}`]);
    expect(output()).toContain("EXACT-SKU");
    expect(output()).not.toContain("SECOND-SKU");
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
  it("requires the health snapshot to match a newly completed aged report and the active mode", async () => {
    let active = snapshot();
    await mount(async () => Response.json({ snapshot: active }));
    await act(async () => { renderer!.update(<InventoryHealthPanel marketplaceId={marketplaceId} mode="live" sourceFetchedAt="2026-09-12T11:00:00Z" />); });
    expect(output()).not.toContain("EXACT-SKU");
    expect(output()).toContain("最新健檢時間不一致");
    active = snapshot({ fetchedAt: "2026-09-12T11:00:00Z" });
    await act(async () => { button("重新讀取本機資料").props.onClick(); });
    expect(output()).toContain("EXACT-SKU");
    await act(async () => { renderer!.update(<InventoryHealthPanel marketplaceId={marketplaceId} mode="demo" />); });
    expect(output()).not.toContain("EXACT-SKU");
    expect(output()).toContain("站點或模式不一致");
  });

});
