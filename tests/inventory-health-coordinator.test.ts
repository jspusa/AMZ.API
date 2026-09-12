import { describe, expect, it, vi } from "vitest";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { AgedInventoryReads, type AgedInventorySnapshot } from "../src/main/amazon/aged-inventory-reads";
import type { ApiRequest } from "../src/shared/contracts";
import { isInventoryHealthSnapshot, type InventoryHealthSnapshot } from "../src/shared/inventory-health";

const US = "ATVPDKIKX0DER";
const now = new Date("2026-07-01T12:00:00Z");
const snapshot = { mode: "live", marketplaceId: US, fetchedAt: now.toISOString(), rows: [{
  sellerSku: "FBA-ONE", asin: "B000000001", title: "Test", available: 1000, agedOver180: 500,
  estimatedExcessQuantity: 300, currencyCode: "USD", estimatedStorageCostNextMonth: 20,
  estimatedAgedSurcharge: 8, snapshotDate: "2026-07-01", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 },
}] } as AgedInventorySnapshot;
const lot = { id: "lot-one", sellerSku: "FBA-ONE", asin: "B000000001", expiryDate: "2026-08-30", declaredQuantity: 1200,
  sourceRef: "inbound-one", sourceUpdatedAt: "2026-06-01T00:00:00Z", observedAt: now.toISOString(), stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null };
function harness() {
  let account = "first", mode: "live" | "demo" = "live", disk: unknown = null;
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode, accountScope: account }));
  const expiry = { read: vi.fn(async () => ({ records: [lot], complete: true })) };
  const store = { read: vi.fn(async () => structuredClone(disk)), write: vi.fn(async (value: unknown, fence: () => Promise<void>) => { await fence(); disk = structuredClone(value); }) };
  const create = () => new InventoryHealthCoordinator({ context, expiry, store, now: () => now });
  const owner = create();
  const refresh = (ownerToUse = owner, value = snapshot) => context.capture(US).then(captured => ownerToUse.refresh({ context: captured, snapshot: value, signal: new AbortController().signal }));
  const get: ApiRequest = { requestId: "read", method: "GET", path: "/api/inventory-health", query: { marketplaceId: US }, headers: {} };
  const confirm = (changes = {}): ApiRequest => ({ ...get, method: "POST", path: "/api/inventory-health/confirmation", body: { kind: "json", value: { marketplaceId: US, id: lot.id, snapshotFetchedAt: snapshot.fetchedAt, confirmedRemaining: 1000, expiryDate: lot.expiryDate, stopSaleDate: null, ...changes } } });
  return { owner, create, context, expiry, store, refresh, get, confirm, switchAccount: (next = "second") => { account = next; context.invalidate("account-changed"); owner.clear(); }, switchMode: () => { mode = "demo"; context.invalidate("mode-changed"); owner.clear(); } };
}
function payload(response: { body: { value: unknown } }) { return response.body.value as { snapshot: InventoryHealthSnapshot | null }; }

describe("inventory health local evidence lifecycle", () => {
  it.each([undefined, "", "2026-06-01"])("cannot borrow a current inventory-age date for stock freshness when snapshot-date is %s", async (stockDate) => {
    const h = harness();
    const fields: Array<[string, string | number]> = [
      ["sku", "FBA-ONE"], ["asin", "B000000001"], ["product-name", "Test"],
      ["available", 1000], ["inv-age-0-to-90-days", 1000],
      ["inv-age-91-to-180-days", 0], ["inv-age-181-to-270-days", 0],
      ["inv-age-271-to-365-days", 0], ["inv-age-366-to-455-days", 0],
      ["inv-age-456-plus-days", 0], ["units-shipped-t7", 70],
      ["units-shipped-t30", 300], ["units-shipped-t60", 600],
      ["units-shipped-t90", 900], ["Inventory age snapshot date", "2026-07-01"],
      ...(stockDate === undefined ? [] : [["snapshot-date", stockDate] as [string, string]]),
    ];
    const document = [fields.map(([key]) => key).join("\t"), fields.map(([, value]) => value).join("\t")].join("\n");
    const receipt = { mode: "live" as const, ready: true, reportId: "report-lease.freshness", documentId: "report-document.freshness", status: "DONE" as const, notice: "ready" };
    const reads = new AgedInventoryReads({
      context: h.context, now: () => now,
      reports: {
        start: async () => receipt, status: async () => receipt, read: async () => receipt,
        readDocument: async () => ({ mode: "live", text: document }),
      },
    });
    const parsed = await reads.read({ marketplaceId: US, reportId: receipt.reportId, documentId: receipt.documentId });

    await h.refresh(h.owner, parsed);
    expect(payload(await h.owner.read(h.get)).snapshot!.rows[0]).toMatchObject({
      snapshotDate: stockDate || null, calendarEligible: false, projectedShortfall: null,
    });
    const response = await h.owner.confirm(h.confirm());
    expect(response.status).toBe(409);
    expect(response.body.value).toMatchObject({ code: "INVENTORY_HEALTH_STALE" });
  });

  it("keeps saved evidence review-only after reopen and restores unchanged confirmations after a fresh capture", async () => {
    const h = harness();
    expect(payload(await h.owner.read(h.get)).snapshot).toBeNull(); expect(h.expiry.read).not.toHaveBeenCalled();
    await h.refresh();
    expect(payload(await h.owner.read(h.get)).snapshot!.rows[0].calendarEligible).toBe(false);
    expect((await h.owner.confirm(h.confirm())).status).toBe(200);
    const reopened = h.create();
    const stored = payload(await reopened.read(h.get)).snapshot!;
    expect(stored.stale).toBe(true);
    expect(isInventoryHealthSnapshot(stored)).toBe(true);
    expect(stored.notice).toContain("同步全部 FBA 效期與銷速");
    expect(stored.rows[0]).toMatchObject({ expiryDate: lot.expiryDate, confirmedRemaining: 1000, status: "needs-review", calendarEligible: false, projectedShortfall: null });
    expect((await reopened.confirm(h.confirm())).status).toBe(409);
    expect(h.expiry.read).toHaveBeenCalledOnce();
    await h.refresh(reopened);
    expect(payload(await reopened.read(h.get)).snapshot!.rows[0]).toMatchObject({ confirmedRemaining: 1000, calendarEligible: true, projectedShortfall: 400 });
    h.switchAccount(); expect(payload(await h.owner.read(h.get)).snapshot).toBeNull();
  });
  it("rejects excess and stale confirmations and invalidates changed inventory without inventing remaining", async () => {
    const h = harness(); await h.refresh();
    expect((await h.owner.confirm(h.confirm({ confirmedRemaining: 1001 }))).status).toBe(400);
    expect((await h.owner.confirm(h.confirm({ snapshotFetchedAt: "2026-06-30T00:00:00Z" }))).status).toBe(409);
    await h.owner.confirm(h.confirm());
    await h.refresh(h.owner, { ...snapshot, rows: [{ ...snapshot.rows[0]!, available: 900 }] });
    expect(payload(await h.owner.read(h.get)).snapshot!.rows[0]).toMatchObject({ calendarEligible: false, confirmedRemaining: null });
  });
  it("retains prior source dates after a failed read but suppresses all calendar claims", async () => {
    const h = harness(); await h.refresh(); await h.owner.confirm(h.confirm());
    h.expiry.read.mockRejectedValueOnce(new Error("read failed")); await h.refresh();
    const result = payload(await h.owner.read(h.get)).snapshot!;
    expect(result.sourceComplete).toBe(false); expect(result.rows).toHaveLength(1); expect(result.rows[0].calendarEligible).toBe(false);
  });
  it("keeps current full-stock estimates useful when expiry is incomplete, but never revives them from disk alone", async () => {
    const h = harness(); await h.refresh();
    h.expiry.read.mockRejectedValueOnce(new Error("read failed"));
    await h.refresh(h.owner, { ...snapshot, rows: [{ ...snapshot.rows[0]!, agedOver180: 0 }] });
    expect(payload(await h.owner.read(h.get)).snapshot).toMatchObject({ sourceComplete: false, stale: false,
      rows: [{ agedOver180: 0, wholeSkuClearanceDays: 100, estimatedDailyUnits: 10, expiryDate: lot.expiryDate, calendarEligible: false }] });
    expect(payload(await h.create().read(h.get)).snapshot).toMatchObject({ stale: true, rows: [{ wholeSkuClearanceDays: null, estimatedDailyUnits: null, stockRisk: "unknown" }] });
  });
  it("keeps the age audit usable after persistence failure while health GET fails closed", async () => {
    const h = harness(); await h.refresh(); await h.owner.confirm(h.confirm());
    h.store.write.mockRejectedValueOnce(new Error("PRIVATE_LOCAL_UNAVAILABLE"));
    await expect(h.refresh()).resolves.toBeUndefined();
    expect((await h.owner.read(h.get)).status).toBe(503);
    expect((await h.owner.confirm(h.confirm())).status).toBe(503);
    await h.refresh();
    expect((await h.owner.read(h.get)).status).toBe(200);
  });
  it("invalidates cached forecasts after a confirmation commits but persistence acknowledgement fails", async () => {
    const h = harness(); await h.refresh(); await h.owner.confirm(h.confirm({ confirmedRemaining: 0 }));
    const originalWrite = h.store.write.getMockImplementation()!;
    h.store.write.mockImplementationOnce(async (value, fence) => {
      await originalWrite(value, fence);
      throw new Error("PRIVATE_LOCAL_WRITE_FAILED");
    });
    expect((await h.owner.confirm(h.confirm())).status).toBe(500);
    expect((await h.owner.read(h.get)).status).toBe(503);
    expect((await h.owner.confirm(h.confirm({ confirmedRemaining: 0 }))).status).toBe(503);
    expect(h.store.write).toHaveBeenCalledTimes(3);
    const reopened = h.create();
    expect(payload(await reopened.read(h.get)).snapshot).toMatchObject({ stale: true, rows: [{ confirmedRemaining: 1000, calendarEligible: false }] });
    await h.refresh();
    expect(payload(await h.owner.read(h.get)).snapshot).toMatchObject({ stale: false, rows: [{ confirmedRemaining: 1000, calendarEligible: true, projectedShortfall: 400 }] });
  });
  it("does not mark a context-cancelled confirmation as a persistence failure", async () => {
    const h = harness(); await h.refresh(); await h.owner.confirm(h.confirm({ confirmedRemaining: 0 }));
    let release!: () => void, started!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const writing = new Promise<void>(resolve => { started = resolve; });
    const originalWrite = h.store.write.getMockImplementation()!;
    h.store.write.mockImplementationOnce(async (value, fence) => {
      started(); await pending; await originalWrite(value, fence);
    });
    const confirming = h.owner.confirm(h.confirm());
    await writing;
    h.switchAccount(); release();
    expect((await confirming).status).toBeGreaterThanOrEqual(400);
    expect(payload(await h.owner.read(h.get)).snapshot).toBeNull();
    h.switchAccount("first");
    expect(payload(await h.owner.read(h.get)).snapshot).toMatchObject({ stale: true, rows: [{ confirmedRemaining: 0, calendarEligible: false }] });
  });
  it("cannot revive failed-refresh calendar claims through clear or a new owner", async () => {
    const h = harness(); await h.refresh(); await h.owner.confirm(h.confirm());
    const emptyStock = { ...snapshot, rows: [{ ...snapshot.rows[0]!, available: 0 }] };
    h.store.write.mockRejectedValueOnce(new Error("PRIVATE_LOCAL_UNAVAILABLE"));
    await h.refresh(h.owner, emptyStock);
    h.owner.clear();
    expect((await h.owner.read(h.get)).status).toBe(503);
    expect((await h.owner.confirm(h.confirm())).status).toBe(503);
    const reopened = h.create();
    const stored = payload(await reopened.read(h.get)).snapshot!;
    expect(stored).toMatchObject({ stale: true, rows: [{ confirmedRemaining: 1000, status: "needs-review", calendarEligible: false, projectedShortfall: null }] });
    expect((await reopened.confirm(h.confirm())).status).toBe(409);
    await h.refresh(reopened, emptyStock);
    expect(payload(await reopened.read(h.get)).snapshot!.rows[0]).toMatchObject({ available: 0, confirmedRemaining: null, calendarEligible: false });
    await h.refresh(h.owner, emptyStock);
    expect((await h.owner.read(h.get)).status).toBe(200);
  });
  it("requires source revalidation after a normal security-context clear", async () => {
    const h = harness(); await h.refresh(); await h.owner.confirm(h.confirm());
    h.owner.clear();
    expect(payload(await h.owner.read(h.get)).snapshot).toMatchObject({ stale: true, rows: [{ confirmedRemaining: 1000, calendarEligible: false }] });
    expect((await h.owner.confirm(h.confirm())).status).toBe(409);
    await h.refresh();
    expect(payload(await h.owner.read(h.get)).snapshot).toMatchObject({ stale: false, rows: [{ confirmedRemaining: 1000, calendarEligible: true }] });
  });
  it.each(["refresh", "confirmation", "failed-refresh-recovery"] as const)(
    "keeps revalidation pending when a newer refresh starts during %s persistence",
    async operation => {
      const h = harness(); await h.refresh(); await h.owner.confirm(h.confirm());
      if (operation === "failed-refresh-recovery") {
        h.store.write.mockRejectedValueOnce(new Error("PRIVATE_LOCAL_UNAVAILABLE"));
        await h.refresh();
      }
      let releaseWrite!: () => void, writeStarted!: () => void;
      const writePending = new Promise<void>(resolve => { releaseWrite = resolve; });
      const writing = new Promise<void>(resolve => { writeStarted = resolve; });
      const originalWrite = h.store.write.getMockImplementation()!;
      h.store.write.mockImplementationOnce(async (value, fence) => {
        writeStarted(); await writePending; await originalWrite(value, fence);
      });
      const older = operation === "confirmation" ? h.owner.confirm(h.confirm()) : h.refresh();
      await writing;
      let releaseSource!: () => void, sourceStarted!: () => void;
      const sourcePending = new Promise<void>(resolve => { releaseSource = resolve; });
      const reading = new Promise<void>(resolve => { sourceStarted = resolve; });
      h.expiry.read.mockImplementationOnce(async () => {
        sourceStarted(); await sourcePending; return { records: [lot], complete: true };
      });
      const current = await h.context.capture(US);
      const newer = h.owner.refresh({ context: current, snapshot, signal: new AbortController().signal });
      releaseWrite();
      const completed = await older;
      await reading;
      try {
        if (operation === "confirmation") expect(payload(completed!).snapshot).toMatchObject({ stale: true, rows: [{ calendarEligible: false }] });
        const observed = await h.owner.read(h.get);
        if (operation === "failed-refresh-recovery") expect(observed.status).toBe(503);
        else expect(payload(observed).snapshot).toMatchObject({ stale: true, rows: [{ calendarEligible: false, projectedShortfall: null }] });
      } finally { releaseSource(); await newer; }
      expect(payload(await h.owner.read(h.get)).snapshot).toMatchObject({ stale: false, rows: [{ calendarEligible: true }] });
    },
  );
  it("late source results after account change cannot persist or resurrect data", async () => {
    const h = harness();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    h.expiry.read.mockImplementationOnce(async () => { await pending; return { records: [lot], complete: true }; });
    const work = h.refresh();
    await vi.waitFor(() => expect(h.expiry.read).toHaveBeenCalled());
    h.switchAccount(); release();
    await expect(work).rejects.toThrow(); expect(h.store.write).not.toHaveBeenCalled();
    expect(payload(await h.owner.read(h.get)).snapshot).toBeNull();
  });
});
