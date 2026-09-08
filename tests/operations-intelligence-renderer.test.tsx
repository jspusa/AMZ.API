import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import OperationsIntelligencePanel from "../src/renderer/src/components/operations-intelligence-panel";
import Dashboard, {
  WORKSPACE_SHORTCUTS,
} from "../src/renderer/src/components/dashboard";
import type { OperationsIntelligenceSnapshot, OperationsSourceState } from "../src/shared/operations-intelligence";

const MARKETPLACE = "ATVPDKIKX0DER";
const NOW = "2026-09-08T10:00:00.000Z";
function fixture(): OperationsIntelligenceSnapshot {
  const source = (source: OperationsSourceState["source"]): OperationsSourceState => ({ source, status: "never", startedAt: null, fetchedAt: null, nextSyncAt: null, message: "尚未同步", snapshot: null });
  return { schemaVersion: 1, marketplaceId: MARKETPLACE, mode: "live", contextId: "operations.fixture-context", observedAt: NOW, autoSync: false, sources: { promotions: source("promotions"), awd: source("awd"), "price-health": source("price-health"), advertising: source("advertising") }, events: [], omittedEventCount: 0, notice: "本機同步" };
}
function withPromotion(): OperationsIntelligenceSnapshot {
  const snapshot = fixture();
  return { ...snapshot, sources: { ...snapshot.sources, promotions: { ...snapshot.sources.promotions, status: "partial", fetchedAt: NOW, snapshot: { marketplaceId: MARKETPLACE, mode: "live", fetchedAt: NOW, coverage: "partial", warnings: ["有分頁尚未完成"], findings: [], reportedTotal: null, excludedPromotionCount: 0, promotions: [{ key: "promotion.test", title: "September Coupon", promotionType: "COUPON", published: { status: "RUNNING", startDate: NOW, endDate: null, selectionType: "ITEMS", coverage: "partial", items: [{ sellerSku: "SKU-FBA-1", asin: "B000000001" }], issues: null }, latestRevision: { status: "PROCESSING", startDate: NOW, endDate: null, selectionType: "ITEMS", coverage: "complete", items: [], issues: [] } }] } } } };
}
let renderer: ReactTestRenderer | null = null;
async function mount(snapshot: OperationsIntelligenceSnapshot) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })));
  await act(async () => { renderer = create(createElement(OperationsIntelligencePanel, { marketplaceId: MARKETPLACE })); });
  return renderer!;
}
function output() { return JSON.stringify(renderer?.toJSON()); }
async function tab(label: string) {
  const values: Record<string, string> = {
    "Coupon／促銷同步": "promotions",
    "AWD 庫存與在途": "awd",
    "Buy Box／價格健康": "price-health",
    "廣告成效診斷": "advertising",
    "事件通知中心": "events",
  };
  await act(async () => {
    renderer!.root.findByType("select").props.onChange({
      target: { value: values[label] ?? label },
    });
  });
}
async function button(label: string) { await act(async () => { renderer!.root.findAllByType("button").find((node) => node.props["aria-label"] === label || node.children.includes(label))!.props.onClick(); }); }

afterEach(async () => { if (renderer) await act(async () => renderer?.unmount()); renderer = null; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("operating intelligence rendered interactions", () => {
  it("uses one compact picker and routes each source through the primary navigation", () => {
    const markup = renderToStaticMarkup(createElement(OperationsIntelligencePanel, { marketplaceId: MARKETPLACE }));

    expect(markup).toContain('class="oi-view-picker"');
    expect(markup.match(/<option/g)).toHaveLength(5);
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("OPERATING SIGNALS");
    expect(markup).not.toContain("僅在 Notebook Key 開啟時同步");
    expect(markup).not.toContain("尚未同步；不代表沒有活動、庫存或問題。");
    expect(markup).toContain(">同步全部<");
    expect(markup).toContain(">設定<");

    expect(WORKSPACE_SHORTCUTS.map(({ label }) => label)).toEqual([
      "商品健檢",
      "Coupon／促銷",
      "Buy Box／價格",
      "公告日曆",
      "AWD 庫存",
      "廣告成效",
      "事件",
      "銷售表現",
    ]);
  });

  it("offers five reachable views without repeating local connection guidance", () => {
    const markup = renderToStaticMarkup(createElement(OperationsIntelligencePanel, { marketplaceId: "ATVPDKIKX0DER" }));
    for (const label of ["Coupon／促銷", "AWD 庫存", "Buy Box／價格", "廣告成效", "事件"]) {
      expect(markup).toContain(label);
    }
    expect(markup).not.toContain("Notebook Key 開啟");
    expect(markup).not.toContain("不是 Amazon 即時推播");
    expect(markup).not.toContain('role="dialog"');
  });
  it("distinguishes an unsynced source without claiming that it has no data", async () => {
    await mount(fixture());
    expect(output()).toContain("未同步");
    expect(output()).not.toContain("尚無資料");
    expect(output()).not.toContain("尚無事件");
  });
  it("reads Amazon published and latest revisions separately without changing manual plans or inventing totals", async () => {
    await mount(withPromotion());
    expect(output()).toContain("September Coupon");
    expect(output()).toContain("SKU-FBA-1");
    expect(output()).toContain("已發布版本");
    expect(output()).toContain("最新修訂");
    expect(output()).toContain("人工計畫仍保留在公告日曆");
    expect(output()).toContain("有分頁尚未完成");
    expect(output()).toContain("未回報");
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("shows AWD quantities with exact units and separates shared stock from FBA replenishment", async () => {
    const snapshot = fixture();
    await mount({ ...snapshot, sources: { ...snapshot.sources, awd: { ...snapshot.sources.awd, status: "partial", fetchedAt: NOW, snapshot: { marketplaceId: MARKETPLACE, mode: "live", fetchedAt: NOW, coverage: "partial", warnings: [], findings: [], stockScope: "AWD_SHARED_DOWNSTREAM", inventoryCoverage: "partial", shipmentCoverage: "complete", excludedInventoryRows: 0, rows: [{ sellerSku: "SKU-FBA-2", asin: "B000000002", totalOnhandQuantity: 480, totalInboundQuantity: null, availableDistributableQuantity: 460, reservedDistributableQuantity: 20, replenishmentQuantity: 0, expirationDetails: [{ expiration: "2026-12-31", onhandQuantity: 480 }] }], shipments: [{ id: "shipment.test", status: "IN_TRANSIT", updatedAt: NOW, coverage: "complete", rows: [{ sellerSku: "SKU-FBA-2", asin: "B000000002", expectedQuantity: { quantity: 2, unitOfMeasurement: "PALLETS" }, receivedQuantity: null, outstandingQuantity: null }] }] } } } });
    await tab("AWD 庫存與在途");
    expect(output()).toContain("SKU-FBA-2");
    expect(output()).toContain("480");
    expect(output()).toContain("2 板");
    expect(output()).toContain("未回報");
    expect(output()).toContain("2026-12-31");
    expect(output()).toContain("AWD→FBA 在途");
    expect(output()).toContain("不能將共享庫存全部視為 FBA");
    expect(output()).not.toContain("可補貨總供給");
  });
  it("shows segmented price evidence without inventing universal eligibility or an external competitor cause", async () => {
    const snapshot = fixture();
    await mount({ ...snapshot, sources: { ...snapshot.sources, "price-health": { ...snapshot.sources["price-health"], status: "complete", fetchedAt: NOW, snapshot: { marketplaceId: MARKETPLACE, mode: "live", fetchedAt: NOW, coverage: "complete", warnings: [], findings: [], rows: [{ sellerSku: "SKU-FBA-3", asin: "B000000003", status: "needs-review", availability: "complete", currentPrice: null, overallEligibility: "unknown", featuredObservation: "other-observed", referencePrices: [{ name: "CompetitivePriceThreshold", price: { amount: 24, currencyCode: "USD" } }], segments: [{ membership: "PRIME", isOwnSeller: false, fulfillment: "MFN", listingPrice: { amount: 20, currencyCode: "USD" }, shippingPrice: { amount: 0, currencyCode: "USD" }, glanceViewWeightPercentage: 50 }], warnings: [] }] } } } });
    await tab("Buy Box／價格健康");
    expect(output()).toContain("SKU-FBA-3");
    expect(output()).toContain("CompetitivePriceThreshold");
    expect(output()).toContain("USD 24.00");
    expect(output()).toContain("PRIME");
    expect(output()).toContain("整體資格未知");
    expect(output()).toContain("無法由此判定站外競爭者或失去 Buy Box 的原因");
    expect(output()).not.toContain("自動降價");
  });
  it("shows reported ad spend, unknown sales, ratio availability and the exact attribution window", async () => {
    const snapshot = fixture();
    await mount({ ...snapshot, sources: { ...snapshot.sources, advertising: { ...snapshot.sources.advertising, status: "partial", fetchedAt: NOW, snapshot: { marketplaceId: MARKETPLACE, mode: "live", fetchedAt: NOW, coverage: "partial", warnings: [], findings: [], kind: "advertising", dateRange: { startDate: "2026-08-01", endDate: "2026-08-30" }, currencyCode: "USD", attributionWindowDays: 14, sourceFetchedAt: { fba: NOW, sales: NOW, ads: NOW }, notice: "SP advertised-product 報表", rows: [{ key: "ads.test", sellerSku: "SKU-FBA-4", asin: "B000000004", status: "insufficient-evidence", spend: 17.5, attributedSales14d: null, purchases14d: null, acos: null, acosStatus: "not-reported", roas: null, roasStatus: "not-reported", suggestedAcos: null, rationale: ["銷售尚未回報，不能當成零銷售"] }] } } } });
    await tab("廣告成效診斷");
    expect(output()).toContain("SKU-FBA-4");
    expect(output()).toContain("USD 17.50");
    expect(output()).toContain("2026-08-01");
    expect(output()).toContain("14 天歸因");
    expect(output()).toContain("銷售尚未回報，不能當成零銷售");
    expect(output()).toContain("不代表商品利潤或損益兩平");
  });
  it("acknowledges local events and navigates back to their source without triggering Amazon updates", async () => {
    const initial = withPromotion();
    const snapshot = { ...initial, events: [{ id: "event.test", key: "finding.test", source: "promotions" as const, sellerSku: "SKU-FBA-1", severity: "warning" as const, title: "促銷資料需核對", detail: "Published selection 未讀完", firstObservedAt: NOW, lastObservedAt: NOW, status: "open" as const, observation: "local-sync" as const }] };
    await mount(snapshot);
    await tab("事件通知中心");
    expect(output()).toContain("促銷資料需核對");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot, events: snapshot.events.map((event) => ({ ...event, status: "acknowledged" })) }), { status: 200 }));
    await button("已知悉");
    expect(output()).toContain("已知悉");
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe("/api/operations-intelligence/events");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual({ marketplaceId: MARKETPLACE, eventId: "event.test", status: "acknowledged" });
    await button("查看來源：Coupon／促銷");
    expect(output()).toContain("September Coupon");
  });
  it("starts only an explicitly chosen sync and observes running work without reposting", async () => {
    vi.useFakeTimers();
    const snapshot = withPromotion();
    await mount(snapshot);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot, autoSync: true }), { status: 200 }));
    await act(async () => { renderer!.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }); });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual({ marketplaceId: MARKETPLACE, autoSync: true });
    const running = { ...snapshot, autoSync: true, sources: { ...snapshot.sources, promotions: { ...snapshot.sources.promotions, status: "running" } } };
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(running), { status: 202 }));
    await button("同步此來源");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toEqual({ marketplaceId: MARKETPLACE, source: "promotions" });
    expect(output()).toContain("可能過期");
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "GET").length).toBeGreaterThan(1);
    expect(output()).toContain("September Coupon");
  });
  it("clears event rows immediately when changing marketplace and rejects a late old response", async () => {
    const initial = withPromotion();
    const snapshot = { ...initial, events: [{ id: "event.test", key: "finding.test", source: "promotions" as const, sellerSku: "SKU-OLD-ACCOUNT", severity: "warning" as const, title: "Old event", detail: "Old source", firstObservedAt: NOW, lastObservedAt: NOW, status: "open" as const, observation: "local-sync" as const }] };
    await mount(snapshot);
    await tab("事件通知中心");
    let settle: (response: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { settle = resolve; }));
    await act(async () => { renderer!.root.findAllByType("button").find((node) => node.children.includes("已知悉"))!.props.onClick(); });
    const next = { ...fixture(), marketplaceId: "A1VC38T7YXB528", contextId: "new-marketplace" };
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify(next), { status: 200 }));
    await act(async () => renderer!.update(createElement(OperationsIntelligencePanel, { marketplaceId: next.marketplaceId })));
    expect(output()).not.toContain("SKU-OLD-ACCOUNT");
    await act(async () => settle(new Response(JSON.stringify(snapshot), { status: 200 })));
    expect(output()).not.toContain("SKU-OLD-ACCOUNT");
  });
  it("allows explicit sync during an observer read and fences the late observer result", async () => {
    vi.useFakeTimers();
    const snapshot = withPromotion();
    await mount(snapshot);
    let settle: (response: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { settle = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot, sources: { ...snapshot.sources, promotions: { ...snapshot.sources.promotions, status: "running" } } }), { status: 202 }));
    await button("同步此來源");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => settle(new Response(JSON.stringify(snapshot), { status: 200 })));
    expect(output()).toContain("同步中");
  });
  it("does not display a completed source when the Bridge omitted its snapshot", async () => {
    const snapshot = fixture();
    await mount({ ...snapshot, sources: { ...snapshot.sources, promotions: { ...snapshot.sources.promotions, status: "complete" } } });
    expect(output()).toContain("格式或安全脈絡不符");
    expect(output()).not.toContain("已核對本次範圍");
  });
  it("keeps the intelligence section and seven-item launcher reachable without a second page nav", () => {
    const markup = renderToStaticMarkup(createElement(Dashboard, { initialSalesTrend: null, initialMarketplaceId: MARKETPLACE }));
    expect(markup).toContain('id="home-intelligence"');
    expect(markup).not.toContain('class="workspace-section-nav"');
    expect(markup).toContain(">全部執行<");
    expect(markup.match(/data-audit-workspace-launch=/g)).toHaveLength(7);
  });
  it("marks a formerly completed source stale when its source timestamp ages beyond the refresh interval", async () => {
    const snapshot = withPromotion();
    await mount({ ...snapshot, observedAt: "2026-09-08T10:31:00.000Z" });
    expect(output()).toContain("可能過期");
    expect(output()).toContain("31 分鐘前");
    expect(output()).toContain(NOW);
  });
  it("never renders private transport error material and clears prior source rows after read failure", async () => {
    await mount(withPromotion());
    vi.mocked(fetch).mockRejectedValueOnce(new Error("private transport context canary-value"));
    await button("重新整理");
    expect(output()).not.toContain("canary-value");
    expect(output()).not.toContain("September Coupon");
    expect(output()).toContain("暫時無法讀取");
  });
  it.each([0.5, 0.0005])("preserves fractional shipment units (%s) without rounding them to zero", async (quantity) => {
    const snapshot = fixture();
    await mount({ ...snapshot, sources: { ...snapshot.sources, awd: { ...snapshot.sources.awd, status: "complete", fetchedAt: NOW, snapshot: { marketplaceId: MARKETPLACE, mode: "live", fetchedAt: NOW, coverage: "complete", warnings: [], findings: [], stockScope: "AWD_SHARED_DOWNSTREAM", inventoryCoverage: "complete", shipmentCoverage: "complete", excludedInventoryRows: 0, rows: [], shipments: [{ id: "shipment.fraction", status: "IN_TRANSIT", updatedAt: NOW, coverage: "complete", rows: [{ sellerSku: "SKU-HALF-PALLET", asin: "B000000002", expectedQuantity: { quantity, unitOfMeasurement: "PALLETS" }, receivedQuantity: null, outstandingQuantity: null }] }] } } } });
    await tab("AWD 庫存與在途");
    expect(output()).toContain(`${quantity} 板`);
  });
  it("pages already retrieved promotions locally without another Amazon sync", async () => {
    const snapshot = withPromotion();
    const data = snapshot.sources.promotions.snapshot!;
    if (!("promotions" in data)) throw new Error("fixture mismatch");
    await mount({ ...snapshot, sources: { ...snapshot.sources, promotions: { ...snapshot.sources.promotions, snapshot: { ...data, promotions: Array.from({ length: 101 }, (_, index) => ({ ...data.promotions[0]!, key: `promotion.${index}`, title: `Coupon-${index + 1}` })) } } } });
    expect(output()).toContain("Coupon-100");
    expect(output()).not.toContain("Coupon-101");
    const requests = vi.mocked(fetch).mock.calls.length;
    await button("顯示更多促銷");
    expect(output()).toContain("Coupon-101");
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
  });
  it("keeps large price result pages bounded until explicitly expanded", async () => {
    const snapshot = fixture();
    await mount({ ...snapshot, sources: { ...snapshot.sources, "price-health": { ...snapshot.sources["price-health"], status: "complete", fetchedAt: NOW, snapshot: { marketplaceId: MARKETPLACE, mode: "live", fetchedAt: NOW, coverage: "complete", warnings: [], findings: [], rows: Array.from({ length: 101 }, (_, index) => ({ sellerSku: `SKU-PAGE-${index + 1}`, asin: "B000000003", status: "observed", availability: "complete", currentPrice: null, overallEligibility: "unknown", featuredObservation: "unknown", referencePrices: [], segments: [], warnings: [] })) } } } });
    await tab("Buy Box／價格健康");
    expect(output()).not.toContain("SKU-PAGE-101");
    await button("顯示更多價格資料");
    expect(output()).toContain("SKU-PAGE-101");
  });
  it.each(["awd", "advertising", "events"] as const)("pages the %s view from already retrieved data", async (source) => {
    const snapshot = fixture();
    const meta = { marketplaceId: MARKETPLACE, mode: "live" as const, fetchedAt: NOW, coverage: "complete" as const, warnings: [], findings: [] };
    const rows = Array.from({ length: 101 }, (_, index) => ({ sellerSku: `SKU-MANY-${index + 1}`, asin: "B000000001" }));
    const next: OperationsIntelligenceSnapshot = source === "events" ? { ...snapshot, events: rows.map((row, index) => ({ id: `event.${index}`, key: `event-key.${index}`, source: "promotions", sellerSku: row.sellerSku, severity: "warning", title: "需核對", detail: "Evidence", firstObservedAt: NOW, lastObservedAt: NOW, status: "open", observation: "local-sync" })) } : source === "awd" ? { ...snapshot, sources: { ...snapshot.sources, awd: { ...snapshot.sources.awd, status: "complete", fetchedAt: NOW, snapshot: { ...meta, stockScope: "AWD_SHARED_DOWNSTREAM", inventoryCoverage: "complete", shipmentCoverage: "complete", excludedInventoryRows: 0, shipments: [], rows: rows.map((row) => ({ ...row, totalOnhandQuantity: null, totalInboundQuantity: null, availableDistributableQuantity: null, reservedDistributableQuantity: null, replenishmentQuantity: null, expirationDetails: null })) } } } } : { ...snapshot, sources: { ...snapshot.sources, advertising: { ...snapshot.sources.advertising, status: "complete", fetchedAt: NOW, snapshot: { ...meta, kind: "advertising", dateRange: { startDate: "2026-08-01", endDate: "2026-08-30" }, currencyCode: "USD", attributionWindowDays: 14, sourceFetchedAt: { fba: NOW, sales: NOW, ads: NOW }, notice: "SP report", rows: rows.map((row, index) => ({ ...row, key: `row.${index}`, status: "insufficient-evidence", spend: null, attributedSales14d: null, purchases14d: null, acos: null, acosStatus: "not-reported", roas: null, roasStatus: "not-reported", suggestedAcos: null, rationale: [] })) } } } };
    await mount(next);
    await tab({ awd: "AWD 庫存與在途", advertising: "廣告成效診斷", events: "事件通知中心" }[source]);
    expect(output().includes("SKU-MANY-101")).toBe(false);
    await button({ awd: "顯示更多AWD 庫存", advertising: "顯示更多廣告資料", events: "顯示更多事件" }[source]);
    expect(output()).toContain("SKU-MANY-101");
  });
  it("uses the native picker to change among all five views", async () => {
    await mount(fixture());
    expect(renderer!.root.findByType("select").props.value).toBe("promotions");
    await tab("事件通知中心");
    expect(renderer!.root.findByType("select").props.value).toBe("events");
    expect(renderer!.root.findAllByProps({ role: "tab" })).toHaveLength(0);
  });
  it("discloses local event retention and clearing boundaries even before any event is recorded", async () => {
    await mount({ ...fixture(), notice: "事件只保存在本機記憶體，最多保留 5,000 筆，每次投影最多 500 筆。App 關閉、鎖定、睡眠或安全脈絡變更時清除，不是永久事件歷史。" });
    await tab("事件通知中心");
    expect(output()).not.toContain("尚無事件");
    expect(output()).toContain("本機記憶體");
    expect(output()).toContain("5,000 筆");
    expect(output()).toContain("500 筆");
    expect(output()).toContain("App 關閉、鎖定、睡眠");
    expect(output()).toContain("不是永久事件歷史");
  });
});
