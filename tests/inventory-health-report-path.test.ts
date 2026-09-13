import { afterEach, describe, expect, it, vi } from "vitest";
import { AgedInventoryReads } from "../src/main/amazon/aged-inventory-reads";
import type { ReportsRuntime, ReportsRuntimeReceipt } from "../src/main/amazon/reports-runtime";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import { InventoryHealthSync } from "../src/main/inventory-health-sync";
import type { ApiRequest } from "../src/shared/contracts";
import { isInventoryHealthSnapshot, type InventoryHealthSnapshot } from "../src/shared/inventory-health";
import type { InventoryHealthSyncJob } from "../src/shared/inventory-health-sync";

const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-07-01T12:00:00Z");
const RECEIPT: ReportsRuntimeReceipt = {
  mode: "live", ready: true, status: "DONE", notice: "ready",
  reportId: "report-lease.health-core", documentId: "report-document.health-core",
};

// Synthetic report: all regional age headers are present, but neither recent
// age representation is reported. These are not captured Amazon account rows.
const FIELDS: ReadonlyArray<readonly [string, string | number]> = [
  ["sku", "FBA-ONE"], ["asin", "B000000001"], ["available", 1000],
  ["snapshot-date", "2026-07-01"],
  ["units-shipped-t7", 70], ["units-shipped-t30", 300],
  ["units-shipped-t60", 600], ["units-shipped-t90", 900],
  ["inv-age-0-to-30-days", ""], ["inv-age-31-to-60-days", ""],
  ["inv-age-61-to-90-days", ""], ["inv-age-0-to-90-days", ""],
  ["inv-age-91-to-180-days", ""], ["inv-age-181-to-270-days", ""],
  ["inv-age-271-to-365-days", ""], ["inv-age-366-to-455-days", ""],
  ["inv-age-456-plus-days", ""],
];
const DOCUMENT = [
  FIELDS.map(([header]) => header).join("\t"),
  FIELDS.map(([, value]) => value).join("\t"),
].join("\n");

afterEach(() => vi.unstubAllGlobals());

describe("full FBA health through the report read path", () => {
  it("keeps reported stock, sales and inbound expiry when age values are unavailable", async () => {
    const network = vi.fn(async () => { throw new Error("Unexpected network request"); });
    vi.stubGlobal("fetch", network);
    const context = createScriptedSpExecutionContextAdapter(marketplaceId => ({
      marketplaceId, mode: "live", accountScope: "health-core-report-test",
    }));
    const reports = {
      start: vi.fn<ReportsRuntime["start"]>(async () => RECEIPT),
      status: vi.fn<ReportsRuntime["status"]>(async () => RECEIPT),
      read: vi.fn<ReportsRuntime["read"]>(async () => RECEIPT),
      readDocument: vi.fn<ReportsRuntime["readDocument"]>(async () => ({ mode: "live", text: DOCUMENT })),
    };
    const reads = new AgedInventoryReads({ context, reports, now: () => NOW });
    const expiry = { read: vi.fn(async () => ({
      complete: true,
      records: [{
        id: "lot-one", sellerSku: "FBA-ONE", asin: "B000000001",
        expiryDate: "2026-08-30", declaredQuantity: 1200,
        sourceRef: "inbound-one", sourceUpdatedAt: "2026-06-01T00:00:00Z",
        observedAt: NOW.toISOString(), stopSaleDate: null,
        confirmedRemaining: null, confirmedForSnapshot: null,
      }],
    })) };
    const health = new InventoryHealthCoordinator({ context, expiry, now: () => NOW });
    const sync = new InventoryHealthSync({
      context, reads, health, now: () => NOW.getTime(), wait: async () => undefined,
    });
    const get: ApiRequest = {
      requestId: "health-core", method: "GET", path: "/api/inventory-health/sync",
      query: { marketplaceId: US }, headers: {},
    };
    const started = await sync.start({
      ...get, method: "POST", query: {}, body: { kind: "json", value: { marketplaceId: US } },
    });
    expect(started.status).toBe(202);
    let job: InventoryHealthSyncJob | null = null;
    await vi.waitFor(async () => {
      const response = await sync.observe(get);
      job = (response.body.value as { job: InventoryHealthSyncJob | null }).job;
      expect(job).not.toBeNull();
      expect(job?.status).not.toBe("running");
    }, { timeout: 3000, interval: 10 });
    expect(job).toMatchObject({ status: "completed", stage: "complete", error: null });

    const response = await health.read({ ...get, path: "/api/inventory-health" });
    expect(response.status).toBe(200);
    const snapshot = (response.body.value as { snapshot: InventoryHealthSnapshot }).snapshot;
    expect(isInventoryHealthSnapshot(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({ sourceComplete: true, stale: false });
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({
      sellerSku: "FBA-ONE", asin: "B000000001", available: 1000,
      snapshotDate: "2026-07-01", wholeSkuClearanceDays: 100, estimatedDailyUnits: 10,
      expiryDate: "2026-08-30", declaredQuantity: 1200,
      agedOver180: null, estimatedAgedSurcharge: null,
      confirmedRemaining: null, projectedShortfall: null, calendarEligible: false,
    });
    await expect(reads.read({
      marketplaceId: US, reportId: RECEIPT.reportId, documentId: RECEIPT.documentId!,
    })).rejects.toMatchObject({
      code: "REPORT_FORMAT_UNSUPPORTED", message: "Amazon FBA 庫齡報表的「0–30 天」缺值。",
    });
    await sync.observe(get);
    expect(reports.start).toHaveBeenCalledOnce();
    expect(expiry.read).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
  });
});
