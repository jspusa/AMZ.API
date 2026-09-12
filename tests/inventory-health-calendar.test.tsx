import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessInventoryHealth } from "../src/main/amazon/inventory-health";
import { inventoryHealthCalendarRows, isInventoryHealthSnapshot } from "../src/shared/inventory-health";
import OperationsBulletinCard from "../src/renderer/src/components/operations-bulletin-card";
const US = "ATVPDKIKX0DER";
const now = new Date("2026-07-01T12:00:00Z");
const stock = { sellerSku: "RISK-SKU", asin: "B000000001", title: "Test", available: 1000, agedOver180: 500, estimatedExcessQuantity: null, currencyCode: "USD", estimatedStorageCostNextMonth: 20, estimatedAgedSurcharge: 8, snapshotDate: "2026-07-01", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 } };
const lot = { id: "risk-one", sellerSku: stock.sellerSku, asin: stock.asin, expiryDate: "2026-07-30", declaredQuantity: 1200, sourceRef: "inbound-test", sourceUpdatedAt: now.toISOString(), observedAt: now.toISOString(), stopSaleDate: null, confirmedRemaining: 600, confirmedForSnapshot: stock.snapshotDate };
const snapshot = assessInventoryHealth({ marketplaceId: US, mode: "live", fetchedAt: now.toISOString(), sourceComplete: true, now, rows: [stock, { ...stock, sellerSku: "UNKNOWN-SKU" }], lots: [lot, { ...lot, id: "risk-two", confirmedRemaining: 400, expiryDate: "2026-08-30" }] });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("sparse automatic clearance calendar", () => {
  it("takes only the earliest proven shortfall per SKU and rejects inconsistent DTOs", () => {
    expect(inventoryHealthCalendarRows(snapshot).map(row => row.id)).toEqual(["risk-one"]);
    expect(isInventoryHealthSnapshot({ ...snapshot, sourceComplete: false })).toBe(false);
    expect(isInventoryHealthSnapshot({ ...snapshot, rows: snapshot.rows.map(row => ({ ...row, confirmedRemaining: null })) })).toBe(false);
  });
  it("combines manual announcements with automatic risk and clears private events on context invalidation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    let invalidate!: () => void;
    const events = new EventTarget();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { fbaOS: { app: { onContextInvalidated: (fn: () => void) => { invalidate = fn; return () => undefined; } } }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), setInterval, clearInterval });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ snapshot }), { status: 200 })));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<OperationsBulletinCard marketplaceId={US} mode="live" todayDateKey="2026-07-01" initialResponse={{ snapshot: { schemaVersion: 2, revision: 1, updatedAt: now.toISOString(), items: [{ id: "promo", type: "promotion", startDate: "2026-07-10", endDate: "2026-07-10", title: "MANUAL PROMOTION", note: "", countdown: false }] }, source: "shared", status: "ready", stale: false }} />); });
    expect(tree.root.findAll(node => node.props["data-entry-kind"] === "clearance")).toHaveLength(1);
    expect(tree.root.findAll(node => node.props["data-entry-kind"] === "promotion")).toHaveLength(1);
    expect(tree.root.findAll(node => node.props["data-entry-kind"] === "clearance")[0].findAllByType("button")).toHaveLength(0);
    await act(async () => invalidate());
    expect(tree.root.findAll(node => node.props["data-entry-kind"] === "clearance")).toHaveLength(0);
    expect(tree.root.findAll(node => node.props["data-entry-kind"] === "promotion")).toHaveLength(1);
    await act(async () => tree.unmount());
  });
});
