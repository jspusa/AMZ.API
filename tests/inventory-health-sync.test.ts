import { describe, expect, it, vi } from "vitest";
import { InventoryHealthSync } from "../src/main/inventory-health-sync";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { InventoryHealthReportSnapshot } from "../src/main/amazon/aged-inventory-reads";
import type { ApiRequest } from "../src/shared/contracts";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { ReportsRuntimeReceipt } from "../src/main/amazon/reports-runtime";
import type { InventoryHealthSyncJob } from "../src/shared/inventory-health-sync";
import type { InventoryHealthSnapshot } from "../src/shared/inventory-health";

const marketplaceId = "ATVPDKIKX0DER";
const now = new Date("2026-07-01T12:00:00Z");
const stock = { marketplaceId, mode: "live", fetchedAt: now.toISOString(), rows: [{ sellerSku: "FBA-YOUNG", asin: "B000000001", title: "Test", available: 1000, agedOver180: 0, estimatedExcessQuantity: null, currencyCode: null, estimatedStorageCostNextMonth: null, estimatedAgedSurcharge: null, snapshotDate: "2026-07-01", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 } }] } as InventoryHealthReportSnapshot;
const receipt = { reportId: "report-lease.test", documentId: "report-document.test", status: "DONE", ready: true, mode: "live", notice: "ready" } as ReportsRuntimeReceipt;
const get: ApiRequest = { requestId: "health", method: "GET", path: "/api/inventory-health/sync", query: { marketplaceId }, headers: {} };
const start: ApiRequest = { ...get, method: "POST", query: {}, body: { kind: "json", value: { marketplaceId } } };
function harness() {
  let account = "fixture-account";
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId, mode: "live", accountScope: account }));
  const expiry = { read: vi.fn(async () => ({ records: [], complete: true })) };
  const health = new InventoryHealthCoordinator({ context, expiry, now: () => now });
  const reads = { begin: vi.fn(async () => receipt), status: vi.fn(async () => receipt), readInventoryHealth: vi.fn(async () => stock) };
  const owner = new InventoryHealthSync({ context, reads, health, now: () => now.getTime(), wait: async () => undefined });
  return { owner, health, reads, expiry, context, changeAccount: () => { account = "other"; context.invalidate("account-changed"); owner.clear(); health.clear(); } };
}
const payload = (r: { body: { value: unknown } }) => r.body.value as { job: InventoryHealthSyncJob | null; snapshot: InventoryHealthSnapshot };
async function terminal(h: ReturnType<typeof harness>): Promise<InventoryHealthSyncJob> {
  let job: InventoryHealthSyncJob | null = null;
  await vi.waitFor(async () => { job = payload(await h.owner.observe(get)).job; expect(job?.status).not.toBe("running"); expect(job).not.toBeNull(); });
  return job!;
}
describe("independent full FBA health synchronization", () => {
  it("starts from its own action and retains low-age stock without starting an aged audit", async () => {
    const h = harness();
    expect(payload(await h.owner.observe(get))).toEqual({ job: null }); expect(h.reads.begin).not.toHaveBeenCalled();
    expect((await h.owner.start(start)).status).toBe(202);
    expect(await terminal(h)).toMatchObject({ status: "completed", stage: "complete" });
    expect(h.reads.begin).toHaveBeenCalledOnce(); expect(h.expiry.read).toHaveBeenCalledOnce();
    expect(payload(await h.health.read({ ...get, path: "/api/inventory-health" })).snapshot.rows[0]).toMatchObject({ sellerSku: "FBA-YOUNG", agedOver180: 0, wholeSkuClearanceDays: 100, calendarEligible: false });
  });
  it("exposes a safe report failure and only starts again through another explicit action", async () => {
    const h = harness(); h.reads.begin.mockRejectedValueOnce(new SpApiError("報表格式暫不支援。", { code: "REPORT_FORMAT_UNSUPPORTED", status: 502 }));
    await h.owner.start(start);
    expect(await terminal(h)).toMatchObject({ status: "failed", stage: "report", error: { code: "REPORT_FORMAT_UNSUPPORTED", message: "報表格式暫不支援。" } });
    await h.owner.observe(get); expect(h.reads.begin).toHaveBeenCalledOnce();
    await h.owner.start(start); expect((await terminal(h))!.status).toBe("completed");
  });
  it("single-flights a report still preparing and observes without another create", async () => {
    const h = harness();
    let release!: (value: ReportsRuntimeReceipt) => void;
    h.reads.begin.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = payload(await h.owner.start(start)).job!;
    const second = payload(await h.owner.start(start)).job!;
    expect(first.id).toBe(second.id); expect(h.reads.begin).toHaveBeenCalledOnce();
    expect(payload(await h.owner.observe(get)).job!.status).toBe("running");
    release({ ...receipt, ready: false, status: "IN_PROGRESS", documentId: null });
    expect((await terminal(h))!.status).toBe("completed");
    expect(h.reads.begin).toHaveBeenCalledOnce(); expect(h.reads.status).toHaveBeenCalledOnce();
  });
  it("keeps incomplete expiry data useful and presents its sanitized failure separately", async () => {
    const h = harness();
    h.expiry.read.mockRejectedValueOnce(new SpApiError("入庫計畫權限不足。", { status: 403, code: "FORBIDDEN" }));
    await h.owner.start(start);
    expect(await terminal(h)).toMatchObject({ status: "partial", error: { code: "FORBIDDEN", message: "入庫計畫權限不足。" } });
    expect(payload(await h.health.read({ ...get, path: "/api/inventory-health" })).snapshot.rows[0]).toMatchObject({ wholeSkuClearanceDays: 100, calendarEligible: false });
  });
  it("does not reveal private material from typed upstream failures", async () => {
    const h = harness();
    h.reads.begin.mockRejectedValueOnce(new SpApiError("reportId=123456789012 https://signed.example.test/private", { code: "REPORT_FORMAT_UNSUPPORTED" }));
    await h.owner.start(start);
    const result = JSON.stringify(await terminal(h));
    expect(result).not.toContain("123456789012"); expect(result).not.toContain("signed.example.test");
    expect(result).toContain("REPORT_FORMAT_UNSUPPORTED");
  });
  it("cancels publication after account change without leaking the former job or starting work on GET", async () => {
    const h = harness();
    let release!: (value: ReportsRuntimeReceipt) => void;
    h.reads.begin.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await h.owner.start(start); await vi.waitFor(() => expect(h.reads.begin).toHaveBeenCalledOnce());
    h.changeAccount(); release(receipt);
    await Promise.resolve(); await Promise.resolve();
    expect(payload(await h.owner.observe(get)).job).toBeNull();
    expect(h.reads.readInventoryHealth).not.toHaveBeenCalled(); expect(h.expiry.read).not.toHaveBeenCalled();
  });
});
