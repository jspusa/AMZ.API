import { describe, expect, it, vi } from "vitest";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import { FbaExpiryReads, type FbaExpiryCheckpoint } from "../src/main/amazon/fba-expiry-reads";
import { fbaInboundExternalReadIdentity, type FbaInboundExternalReadAdapter } from "../src/main/amazon/fba-inbound-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import { createFbaInboundReadsProductionAdapter } from "../src/main/amazon/fba-inbound-reads-production";
import type { InventoryHealthReportSnapshot } from "../src/main/amazon/aged-inventory-reads";
import type { ApiRequest } from "../src/shared/contracts";
import { inventoryHealthCalendarRows, isInventoryHealthSnapshot, type InventoryHealthSnapshot } from "../src/shared/inventory-health";

const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-09-13T15:12:14Z");
const PLAN = { inboundPlanId: "wf1234abcd-1234-abcd-5678-1234abcd5678", name: "SYNTHETIC-PRIVATE-PLAN", marketplaceIds: [US],
  lastUpdatedAt: "2026-09-12T00:00:00Z", status: "SHIPPED" };
const plans = [400, 404, 422].map((status, index) => ({ ...PLAN,
  inboundPlanId: `wf${index + 1}234abcd-1234-abcd-5678-1234abcd5678`, failure: status }));
const STOCK: InventoryHealthReportSnapshot = { marketplaceId: US, mode: "live", fetchedAt: NOW.toISOString(), rows: [{
  sellerSku: "SYNTHETIC-PRIVATE-SKU", asin: "B000000001", title: "Synthetic product", available: 1000, agedOver180: null,
  estimatedExcessQuantity: null, currencyCode: null, estimatedStorageCostNextMonth: null, estimatedAgedSurcharge: null,
  snapshotDate: "2026-09-13", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 },
}] };
const GET: ApiRequest = { requestId: "synthetic", method: "GET", path: "/api/inventory-health", query: { marketplaceId: US }, headers: {} };
type SavedFixture = { profiles: Record<string, { expiryCheckpoint?: FbaExpiryCheckpoint; marketplaceId: string; mode: string }> };
const profile = (saved: unknown) => Object.values((saved as SavedFixture).profiles)[0]!;
function harness(saved: unknown = null, adapter?: FbaInboundExternalReadAdapter) {
  let disk = saved;
  let now = NOW, accountScope = "synthetic-source-diagnostics", mode: "live" | "demo" = "live";
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode, accountScope }));
  const upstream = vi.fn<FbaInboundExternalReadAdapter["read"]>(async request => {
    if (request.source !== "modern") throw new Error("Unexpected source");
    if (request.request.kind === "plans") return { identity: fbaInboundExternalReadIdentity(request), requestId: null, envelope: { inboundPlans: plans } };
    const operation = request.request;
    const plan = plans.find(candidate => candidate.inboundPlanId === operation.inboundPlanId)!;
    throw new SpApiError("SYNTHETIC-PRIVATE-ERROR", { code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE", status: plan.failure, requestId: "SYNTHETIC-PRIVATE-REQUEST" });
  });
  const expiry = new FbaExpiryReads({ context, adapter: adapter ?? { read: upstream }, now: () => now });
  const store = { read: vi.fn(async () => structuredClone(disk)), write: vi.fn(async (value: unknown, fence: () => Promise<void>) => { await fence(); disk = structuredClone(value); }) };
  const create = () => new InventoryHealthCoordinator({ context, expiry, store, now: () => now });
  const owner = create();
  return { owner, create, context, upstream, store, disk: () => structuredClone(disk),
    setNow: (value: Date) => { now = value; },
    switchAccount: () => { accountScope = "another-synthetic-account"; context.invalidate("account-changed"); owner.clear(); },
    switchMode: () => { mode = "demo"; context.invalidate("mode-changed"); owner.clear(); },
    refresh: () => context.capture(US).then(captured => owner.refresh({ context: captured, snapshot: STOCK, signal: new AbortController().signal })) };
}
async function snapshot(owner: InventoryHealthCoordinator) {
  const response = await owner.read(GET);
  expect(response.status).toBe(200);
  const value = (response.body.value as { snapshot: InventoryHealthSnapshot }).snapshot;
  expect(isInventoryHealthSnapshot(value)).toBe(true);
  return value;
}

describe("saved expiry source diagnostics through the health GET", () => {
  it("preserves fixed operation, physical page and allowlisted cause from production adapter through saved GET", async () => {
    const selected = Array.from({ length: 4 }, (_, index) => ({ ...PLAN, inboundPlanId: `wf${index + 1}234abcd-1234-abcd-5678-1234abcd5678` }));
    const shipment = "sh1234abcd-1234-abcd-5678-1234abcd5678";
    const legacy = "Operation ListInboundPlanItems is not supported for Fulfillment Inbound API V0 shipments that have been converted to Send-to-Amazon inbound plans.";
    const canary = "SYNTHETIC-PRIVATE https://private.invalid/?access_token=PRIVATE";
    const response = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/inboundPlans")) return response(200, { inboundPlans: selected });
      const plan = selected.find(candidate => url.pathname.includes(candidate.inboundPlanId))!;
      const index = selected.indexOf(plan);
      if (index === 0) return response(400, { errors: [{ code: "BadRequest", message: canary, details: canary }] });
      if (!url.pathname.endsWith("/items")) return response(200, { ...plan,
        ...(index === 2 ? { shipments: [{ shipmentId: shipment, status: "SHIPPED" }] } : {}) });
      if (index === 3) return response(200, { items: [] });
      if (!url.searchParams.has("paginationToken")) return response(200, { items: [{ msku: "SYNTHETIC-PRIVATE-SKU", asin: "B000000001", fnsku: "X000000001", quantity: 20, expiration: "2026-12-31" }], pagination: { nextToken: "SYNTHETIC-PRIVATE-CURSOR" } });
      return response(index === 1 ? 400 : 422, { errors: [{ code: index === 1 ? "BadRequest" : "InvalidInput", message: index === 1 ? legacy : canary, details: canary }] });
    });
    const adapter = createFbaInboundReadsProductionAdapter({ getAccessToken: async () => "SYNTHETIC-PRIVATE-TOKEN", invalidateAccessToken: vi.fn(),
      fetchImpl, sleep: async () => undefined, now: () => NOW });
    const h = harness(null, adapter); await h.refresh();
    const current = await snapshot(h.owner);
    expect(current.expirySourceDiagnostics).toEqual({ status: "available", recordedAt: NOW.toISOString(), stale: false,
      traversal: "complete", listedPlanCount: 4, pendingPlanCount: 0, cachedPlanCount: 1, unavailablePlanCount: 3,
      statusCounts: { "400": 2, "404": 0, "422": 1 }, failures: [
        { operation: "plan", page: "first", status: 400, reason: "other-input", count: 1 },
        { operation: "plan-items", page: "next", status: 400, reason: "legacy-v0-plan-unsupported", count: 1 },
        { operation: "shipment-items", page: "next", status: 422, reason: "other-input", count: 1 },
      ] });
    expect(current.sourceComplete).toBe(false); expect(inventoryHealthCalendarRows(current)).toEqual([]);
    expect(current.rows[0]).toMatchObject({ expiryDate: null, confirmedRemaining: null, calendarEligible: false });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect((await snapshot(h.create())).expirySourceDiagnostics).toEqual(current.expirySourceDiagnostics);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(JSON.stringify(current.expirySourceDiagnostics)).not.toMatch(/SYNTHETIC|private|https?:|wf1234|shipmentId|requestId|token/i);
    for (const call of fetchImpl.mock.calls) expect(call[1]).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  });

  it("retains actual terminal statuses across reader, coordinator and reopened GET without upstream reads", async () => {
    const h = harness();
    await h.refresh();
    const current = await snapshot(h.owner);
    expect(current).toMatchObject({ sourceComplete: false, expirySourceDiagnostics: {
      status: "available", recordedAt: NOW.toISOString(), stale: false, traversal: "complete", listedPlanCount: 3, pendingPlanCount: 0,
      cachedPlanCount: 0, unavailablePlanCount: 3, statusCounts: { "400": 1, "404": 1, "422": 1 },
      failures: [400, 404, 422].map(status => ({ operation: "plan", page: "first", status, reason: "unknown", count: 1 })),
    } });
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
    const calls = h.upstream.mock.calls.length;
    const local = await snapshot(h.create());
    expect(local).toMatchObject({ stale: true, sourceComplete: false,
      expirySourceDiagnostics: current.expirySourceDiagnostics });
    expect(h.upstream).toHaveBeenCalledTimes(calls);
    expect(h.store.write).toHaveBeenCalledOnce();
    expect(JSON.stringify(local.expirySourceDiagnostics)).not.toMatch(/SYNTHETIC|wf1234|requestId|account|https?:|token/i);
  });

  it("reads 36 historical schema-2 unavailable plans locally without inventing the unrecorded operation", async () => {
    const seed = harness(); await seed.refresh();
    const saved = seed.disk(), checkpoint = profile(saved).expiryCheckpoint!;
    const unavailable = Array.from({ length: 36 }, (_, index) => ({ ...checkpoint.unavailablePlans[index % 3]!,
      inboundPlanId: `wf${String(index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678` }));
    for (const plan of unavailable) delete plan.diagnostic;
    checkpoint.unavailablePlans = unavailable;
    checkpoint.seenPlanIds = unavailable.map(plan => plan.inboundPlanId);
    checkpoint.startedAt = "2026-09-13T13:00:00Z";
    const h = harness(saved);
    const current = await snapshot(h.owner);
    expect(current.expirySourceDiagnostics).toEqual({ status: "available", recordedAt: "2026-09-13T13:00:00.000Z", stale: true,
      traversal: "complete", listedPlanCount: 36, pendingPlanCount: 0, cachedPlanCount: 0, unavailablePlanCount: 36,
      statusCounts: { "400": 12, "404": 12, "422": 12 },
      failures: [400, 404, 422].map(status => ({ operation: "unknown", page: "unknown", status, reason: "unknown", count: 12 })),
    });
    expect(current).toMatchObject({ stale: true, sourceComplete: false });
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
    await snapshot(h.create());
    expect(h.upstream).not.toHaveBeenCalled(); expect(h.store.write).not.toHaveBeenCalled();
  });

  it("labels diagnostic age without changing the existing stock freshness policy", async () => {
    const h = harness(); await h.refresh();
    h.setNow(new Date(NOW.getTime() + 30 * 60000));
    expect((await snapshot(h.owner)).expirySourceDiagnostics).toMatchObject({ status: "available", stale: false });
    h.setNow(new Date(NOW.getTime() + 30 * 60000 + 1));
    expect(await snapshot(h.owner)).toMatchObject({ stale: false, sourceComplete: false, expirySourceDiagnostics: { status: "available", stale: true } });
    expect(h.upstream).toHaveBeenCalledTimes(4);
  });

  it("distinguishes partial listed coverage from cached, unavailable and unfinished plans", async () => {
    const seed = harness(); await seed.refresh(); const saved = seed.disk(), checkpoint = profile(saved).expiryCheckpoint!;
    const plan = (index: number) => ({ ...PLAN, status: "SHIPPED" as const, inboundPlanId: `wf${index}234abcd-1234-abcd-5678-1234abcd5678` });
    checkpoint.phase = "partial";
    checkpoint.planPagesComplete = false; checkpoint.planCursor = "SYNTHETIC-PRIVATE-NEXT";
    checkpoint.seenPlanTokens = ["SYNTHETIC-PRIVATE-NEXT"];
    checkpoint.cachedPlans = [{ ...plan(4), records: [], itemSources: [{ shipmentId: null, shipmentStatus: null, items: [] }] }];
    checkpoint.currentPlan = { ...plan(5), records: [], itemSources: [{ shipmentId: null, shipmentStatus: null, items: [] }], sourceIndex: 0, itemCursor: null, itemTokens: [] };
    checkpoint.pendingPlans = [plan(6)];
    checkpoint.seenPlanIds.push(plan(4).inboundPlanId, plan(5).inboundPlanId, plan(6).inboundPlanId);
    const h = harness(saved), current = await snapshot(h.owner);
    expect(current.expirySourceDiagnostics).toMatchObject({ status: "available", traversal: "partial", listedPlanCount: 6,
      cachedPlanCount: 1, unavailablePlanCount: 3, pendingPlanCount: 2 });
    expect(current.sourceComplete).toBe(false); expect(inventoryHealthCalendarRows(current)).toEqual([]);
    expect(h.upstream).not.toHaveBeenCalled(); expect(h.store.write).not.toHaveBeenCalled();
  });

  it.each(["not-recorded", "legacy-checkpoint", "stale-checkpoint"])("keeps %s coverage explicitly unknown without reading upstream", async reason => {
    const seed = harness(); await seed.refresh(); const saved = seed.disk();
    if (reason === "not-recorded") delete profile(saved).expiryCheckpoint;
    else if (reason === "legacy-checkpoint") Object.assign(profile(saved).expiryCheckpoint!, { schemaVersion: 1 });
    else profile(saved).expiryCheckpoint!.startedAt = "2026-09-14T00:00:00Z";
    const h = harness(saved);
    expect((await snapshot(h.owner)).expirySourceDiagnostics).toEqual({ status: "unknown", reason });
    expect(h.upstream).not.toHaveBeenCalled(); expect(h.store.write).not.toHaveBeenCalled();
  });

  it.each(["account", "mode"])("does not expose another %s's saved coverage", async change => {
    const h = harness(); await h.refresh();
    if (change === "account") h.switchAccount(); else h.switchMode();
    const response = await h.owner.read(GET);
    expect(response.status).toBe(200); expect(response.body.value).toEqual({ snapshot: null });
    expect(h.upstream).toHaveBeenCalledTimes(4);
  });

  it("fences a security context change while the local checkpoint is being read", async () => {
    const seed = harness(); await seed.refresh();
    const h = harness(seed.disk());
    const read = h.store.read.getMockImplementation()!;
    h.store.read.mockImplementationOnce(async () => { const saved = await read(); h.context.invalidate("lock-screen"); return saved; });
    const response = await h.owner.read(GET);
    expect(response.status).toBe(409); expect(response.body.value).toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(h.upstream).not.toHaveBeenCalled(); expect(h.store.write).not.toHaveBeenCalled();
  });

  it("keeps a structurally valid profile with mismatched mode diagnostically unknown", async () => {
    const seed = harness(); await seed.refresh(); const saved = seed.disk(); profile(saved).mode = "demo";
    const h = harness(saved);
    expect((await snapshot(h.owner)).expirySourceDiagnostics).toEqual({ status: "unknown", reason: "context-mismatch" });
    expect(h.upstream).not.toHaveBeenCalled(); expect(h.store.write).not.toHaveBeenCalled();
  });

  it.each([
    (checkpoint: FbaExpiryCheckpoint) => { checkpoint.unavailablePlans.push(checkpoint.unavailablePlans[0]!); },
    (checkpoint: FbaExpiryCheckpoint) => { checkpoint.scopeFingerprint = "f".repeat(64); },
    (checkpoint: FbaExpiryCheckpoint) => { checkpoint.startedAt = "SYNTHETIC-PRIVATE-BAD-DATE"; },
    (checkpoint: FbaExpiryCheckpoint) => { Object.assign(checkpoint.unavailablePlans[0]!.diagnostic!, { operation: "SYNTHETIC-PRIVATE-OP" }); },
    (checkpoint: FbaExpiryCheckpoint) => { Object.assign(checkpoint.unavailablePlans[0]!.diagnostic!, { reason: "SYNTHETIC-PRIVATE-ERROR" }); },
    (checkpoint: FbaExpiryCheckpoint) => { Object.assign(checkpoint.unavailablePlans[0]!.diagnostic!, { requestId: "SYNTHETIC-PRIVATE-REQUEST" }); },
    (checkpoint: FbaExpiryCheckpoint) => { Object.assign(checkpoint.unavailablePlans[0]!.diagnostic!, { page: "next" }); },
    (checkpoint: FbaExpiryCheckpoint) => { Object.assign(checkpoint.unavailablePlans[0]!.diagnostic!, { operation: ["plan"] }); },
  ])("rejects invalid saved coverage without exposing raw checkpoint or errors %#", async corrupt => {
    const seed = harness(); await seed.refresh(); const saved = seed.disk();
    corrupt(profile(saved).expiryCheckpoint!);
    const h = harness(saved), response = await h.owner.read(GET);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.value).not.toHaveProperty("snapshot");
    expect(JSON.stringify(response.body.value)).not.toMatch(/SYNTHETIC|wf1234|account|https?:|token/i);
    expect(h.upstream).not.toHaveBeenCalled(); expect(h.store.write).not.toHaveBeenCalled();
  });

  it("accepts the prior Bridge shape but rejects inconsistent or unbounded diagnostic DTOs", async () => {
    const h = harness(); await h.refresh(); const current = await snapshot(h.owner);
    const { expirySourceDiagnostics: _diagnostic, ...prior } = current;
    expect(isInventoryHealthSnapshot(prior)).toBe(true);
    const diagnostic = current.expirySourceDiagnostics!;
    expect(diagnostic.status).toBe("available");
    if (diagnostic.status !== "available") throw new Error("Expected diagnostic fixture");
    const invalid = [
      { ...diagnostic, requestId: "SYNTHETIC-PRIVATE" },
      { ...diagnostic, recordedAt: "SYNTHETIC-PRIVATE" },
      { ...diagnostic, listedPlanCount: 6001 },
      { ...diagnostic, unavailablePlanCount: 2 },
      { ...diagnostic, statusCounts: { "400": 1, "404": 1, "422": 2 } },
      { ...diagnostic, statusCounts: { "400": 1, "404": 1, "422": 1, other: 0 } },
      { ...diagnostic, failures: [diagnostic.failures[0], diagnostic.failures[0], diagnostic.failures[2]] },
      { ...diagnostic, failures: Array.from({ length: 6000 }, () => diagnostic.failures[0]) },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], operation: "SYNTHETIC-PRIVATE" }, ...diagnostic.failures.slice(1)] },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], reason: "SYNTHETIC-PRIVATE" }, ...diagnostic.failures.slice(1)] },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], page: "next" }, ...diagnostic.failures.slice(1)] },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], status: "400" }, ...diagnostic.failures.slice(1)] },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], count: -1 }, ...diagnostic.failures.slice(1)] },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], count: 1.5 }, ...diagnostic.failures.slice(1)] },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], message: "SYNTHETIC-PRIVATE" }, ...diagnostic.failures.slice(1)] },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], operation: ["plan"] }, ...diagnostic.failures.slice(1)] },
      { ...diagnostic, failures: [{ ...diagnostic.failures[0], reason: ["unknown"] }, ...diagnostic.failures.slice(1)] },
      { status: "unknown", reason: ["not-recorded"] },
      { status: "unknown", reason: "not-recorded", statusCounts: { "400": 0, "404": 0, "422": 0 } },
    ];
    for (const expirySourceDiagnostics of invalid) expect(isInventoryHealthSnapshot({ ...current, expirySourceDiagnostics })).toBe(false);
  });
});
