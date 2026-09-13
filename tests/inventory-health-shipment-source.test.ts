import { describe, expect, it, vi } from "vitest";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import { FbaExpiryReads } from "../src/main/amazon/fba-expiry-reads";
import { fbaInboundExternalReadIdentity, type FbaInboundExternalReadAdapter } from "../src/main/amazon/fba-inbound-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { InventoryHealthReportSnapshot } from "../src/main/amazon/aged-inventory-reads";
import type { InventoryExpiryRecord } from "../src/main/amazon/inventory-health";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import { inventoryHealthCalendarRows, isInventoryHealthSnapshot, type InventoryHealthSnapshot } from "../src/shared/inventory-health";

const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-07-01T12:00:00Z");
const ACCOUNT = "shipment-expiry-integration";
const PLAN_ID = "wf1234abcd-1234-abcd-5678-1234abcd5678";
const SHIPMENT_ONE = "sh1234abcd-1234-abcd-5678-1234abcd5678";
const SHIPMENT_TWO = "sh2234abcd-1234-abcd-5678-1234abcd5678";
// Frozen schema-1 identities from the predecessor plan-items source.
const SCOPE = "0dd6742943af8e828d4dfa5936d329dcf4bd640cd2a8414e62a7fd1d27e2cdb0";
const SOURCE = "inbound-f5ec35eb222c084b9686";
const LOT_ID = "expiry-3455c99830612a38918d3fd66865ebfd";
const PLAN = { inboundPlanId: PLAN_ID, name: "Split shipment batch", marketplaceIds: [US],
  createdAt: "2026-01-01T00:00:00Z", lastUpdatedAt: "2026-06-01T00:00:00Z", status: "SHIPPED" };
const STOCK: InventoryHealthReportSnapshot = { mode: "live", marketplaceId: US, fetchedAt: NOW.toISOString(), rows: [{
  sellerSku: "FBA-ONE", asin: "B000000001", title: "Synthetic FBA product", available: 1000, agedOver180: 0,
  estimatedExcessQuantity: 0, currencyCode: "USD", estimatedStorageCostNextMonth: 20,
  estimatedAgedSurcharge: 0, snapshotDate: "2026-07-01", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 },
}] };
const ORIGINAL_LOT: InventoryExpiryRecord = { id: LOT_ID, sellerSku: "FBA-ONE", asin: "B000000001", expiryDate: "2026-08-30",
  declaredQuantity: 1200, sourceRef: SOURCE, sourceLabel: `${PLAN.name} · ${PLAN_ID}`, sourceUpdatedAt: PLAN.lastUpdatedAt,
  observedAt: NOW.toISOString(), stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null };
const MANUAL_LOT: InventoryExpiryRecord = { id: "manual-later-batch", sellerSku: "FBA-ONE", asin: "B000000001", expiryDate: null,
  manualExpiryDate: "2026-12-15", declaredQuantity: null, sourceRef: "人工補登", sourceUpdatedAt: PLAN.lastUpdatedAt,
  observedAt: NOW.toISOString(), stopSaleDate: null, confirmedRemaining: 200, confirmedForSnapshot: "2026-07-01" };

function predecessorProfile() {
  const summary = { inboundPlanId: PLAN_ID, name: PLAN.name, lastUpdatedAt: PLAN.lastUpdatedAt, status: PLAN.status };
  return { schemaVersion: 1, profiles: { [SCOPE]: { marketplaceId: US, mode: "live", fetchedAt: STOCK.fetchedAt,
    sourceComplete: true, rows: STOCK.rows, lots: [{ ...ORIGINAL_LOT, manualExpiryDate: "2026-08-25", stopSaleDate: "2026-08-20",
      confirmedRemaining: 800, confirmedForSnapshot: "2026-07-01" }, MANUAL_LOT],
    expiryCheckpoint: { schemaVersion: 1, scopeFingerprint: SCOPE, phase: "complete", startedAt: NOW.toISOString(),
      cachedPlans: [{ ...summary, records: [ORIGINAL_LOT] }], pendingPlans: [], currentPlan: null, planCursor: null,
      planPagesComplete: true, seenPlanIds: [PLAN_ID], seenPlanTokens: [] },
  } } };
}

type FixturePlan = typeof PLAN;
type Options = { saved?: unknown; plans?: FixturePlan[]; stock?: InventoryHealthReportSnapshot; quantity?: number; lastUpdatedAt?: string; inaccessible?: Record<string, number> };
function harness(options: Options = {}) {
  let disk: unknown = options.saved ?? null;
  const calls: string[] = [];
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: ACCOUNT }));
  const plans = options.plans ?? [{ ...PLAN, lastUpdatedAt: options.lastUpdatedAt ?? PLAN.lastUpdatedAt }];
  const selectedShipments = (planIndex: number) => planIndex === 0 ? [SHIPMENT_ONE, SHIPMENT_TWO]
    : [0, 1].map(index => `sh${String(planIndex * 2 + index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678`);
  const adapter: FbaInboundExternalReadAdapter = { async read(request) {
    if (request.source !== "modern") throw new Error("Only modern declared-expiry reads are allowed");
    const operation = request.request;
    calls.push(operation.kind);
    let envelope: unknown;
    if (operation.kind === "plans") {
      const offset = Number(operation.paginationToken ?? "0");
      envelope = { inboundPlans: plans.slice(offset, offset + 30),
        ...(offset + 30 < plans.length ? { pagination: { nextToken: String(offset + 30) } } : {}) };
    }
    else if (operation.kind === "plan") {
      const failed = options.inaccessible?.[operation.inboundPlanId];
      if (failed !== undefined) throw new SpApiError("Synthetic unavailable source", { status: failed, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE" });
      const plan = plans.find(candidate => candidate.inboundPlanId === operation.inboundPlanId);
      if (!plan) throw new Error("Unexpected plan read");
      envelope = { ...plan, sourceAddress: { name: "Synthetic warehouse", addressLine1: "1 Test Road", city: "Seattle",
        countryCode: "US", stateOrProvinceCode: "WA", postalCode: "98101", phoneNumber: "+12065550100" },
        shipments: selectedShipments(plans.indexOf(plan)).map(shipmentId => ({ shipmentId, status: "SHIPPED" })) };
    } else if (operation.kind === "shipment-items") {
      if (operation.paginationToken !== null) throw new Error("Unexpected continuation");
      const planIndex = plans.findIndex(plan => plan.inboundPlanId === operation.inboundPlanId);
      const shipments = selectedShipments(planIndex);
      if (planIndex < 0 || !shipments.includes(operation.shipmentId)) throw new Error("Unexpected shipment read");
      envelope = { items: [{ msku: planIndex === 0 || operation.inboundPlanId === PLAN_ID ? "FBA-ONE" : `FBA-${planIndex}`, asin: "B000000001", fnsku: "X000000001", expiration: "2026-08-30",
        quantity: operation.shipmentId === shipments[0] ? 400 : (options.quantity ?? 1200) - 400 }] };
    } else throw new Error("Selected shipments must not also read plan items");
    return { identity: fbaInboundExternalReadIdentity(request), requestId: null, envelope };
  } };
  const expiry = new FbaExpiryReads({ context, adapter, now: () => NOW });
  const readExpiry = vi.spyOn(expiry, "read");
  const store = { read: vi.fn(async () => structuredClone(disk)), write: vi.fn(async (value: unknown, fence: () => Promise<void>) => {
    await fence(); disk = structuredClone(value);
  }) };
  const create = () => new InventoryHealthCoordinator({ context, expiry, store, now: () => NOW });
  const owner = create();
  const onSourceError = vi.fn();
  const refresh = async (selectedOwner = owner) => selectedOwner.refresh({ context: await context.capture(US), snapshot: options.stock ?? STOCK,
    signal: new AbortController().signal, onSourceError });
  const get: ApiRequest = { requestId: "read", method: "GET", path: "/api/inventory-health", query: { marketplaceId: US }, headers: {} };
  const confirm: ApiRequest = { ...get, method: "POST", path: "/api/inventory-health/confirmation", body: { kind: "json", value: {
    marketplaceId: US, id: LOT_ID, snapshotFetchedAt: STOCK.fetchedAt, confirmedRemaining: 800, expiryDate: "2026-08-25", stopSaleDate: "2026-08-20",
  } } };
  return { owner, create, calls, readExpiry, store, refresh, get, confirm, onSourceError,
    persisted: () => structuredClone(disk) as ReturnType<typeof predecessorProfile> };
}
function snapshot(response: ApiResponse): InventoryHealthSnapshot {
  expect(response.status).toBe(200);
  const value = (response.body.value as { snapshot: InventoryHealthSnapshot }).snapshot;
  expect(isInventoryHealthSnapshot(value)).toBe(true);
  return value;
}

describe("shipment expiry source and saved inventory health integration", () => {
  it("upgrades a schema-1 plan batch into one aggregate while retaining manual dates and one confirmed balance", async () => {
    const h = harness({ saved: predecessorProfile() });
    await h.refresh();
    expect(h.calls).toEqual(["plans", "plan", "shipment-items", "shipment-items"]);
    expect(h.readExpiry).toHaveBeenCalledOnce();
    expect(h.onSourceError).not.toHaveBeenCalled();
    const current = snapshot(await h.owner.read(h.get));
    expect(current.sourceComplete).toBe(true);
    expect(current.rows).toHaveLength(2);
    expect(current.rows.find(row => row.id === LOT_ID)).toMatchObject({ sourceRef: SOURCE, declaredQuantity: 1200,
      expiryDate: "2026-08-25", stopSaleDate: "2026-08-20", confirmedRemaining: 800, available: 1000,
      wholeSkuClearanceDays: 100, projectedShortfall: 300, calendarEligible: true });
    expect(current.rows.find(row => row.id === MANUAL_LOT.id)).toMatchObject({ sourceRef: "人工補登", expiryDate: "2026-12-15", confirmedRemaining: 200 });
    expect(current.rows.reduce((sum, row) => sum + (row.confirmedRemaining ?? 0), 0)).toBe(1000);
    expect(inventoryHealthCalendarRows(current).map(row => row.id)).toEqual([LOT_ID]);
    const saved = h.persisted().profiles[SCOPE]!;
    expect(saved.lots).toHaveLength(2);
    expect(saved.lots.find(row => row.id === LOT_ID)).toMatchObject({ manualExpiryDate: "2026-08-25", stopSaleDate: "2026-08-20" });
    expect(saved.expiryCheckpoint.schemaVersion).toBe(2);
    const calls = h.calls.length;
    expect(snapshot(await h.create().read(h.get))).toMatchObject({ stale: true, rows: expect.arrayContaining([
      expect.objectContaining({ id: LOT_ID, confirmedRemaining: 800, expiryDate: "2026-08-25", calendarEligible: false }),
    ]) });
    expect(h.calls).toHaveLength(calls);
  });

  it.each([
    { change: "declared total", quantity: 1100, lastUpdatedAt: PLAN.lastUpdatedAt },
    { change: "plan revision", quantity: 1200, lastUpdatedAt: "2026-06-02T00:00:00Z" },
  ])("clears the prior automatic batch confirmation after changed $change without dropping manual dates", async options => {
    const h = harness({ saved: predecessorProfile(), ...options });
    await h.refresh();
    const current = snapshot(await h.owner.read(h.get));
    expect(current.sourceComplete).toBe(true);
    expect(current.rows).toHaveLength(2);
    expect(current.rows.find(row => row.id === LOT_ID)).toMatchObject({ declaredQuantity: options.quantity,
      sourceUpdatedAt: options.lastUpdatedAt, expiryDate: "2026-08-25", stopSaleDate: "2026-08-20",
      confirmedRemaining: null, projectedShortfall: null, calendarEligible: false });
    expect(current.rows.find(row => row.id === MANUAL_LOT.id)).toMatchObject({ confirmedRemaining: 200, expiryDate: "2026-12-15" });
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
  });

  it("retains readable batches after one unavailable plan but terminates partial and blocks new confirmations", async () => {
    const unavailable = { ...PLAN, inboundPlanId: "wf2234abcd-1234-abcd-5678-1234abcd5678" };
    const h = harness({ saved: predecessorProfile(), plans: [unavailable, PLAN], inaccessible: { [unavailable.inboundPlanId]: 400 } });
    await h.refresh();
    expect(h.calls).toEqual(["plans", "plan", "plan", "shipment-items", "shipment-items"]);
    expect(h.readExpiry).toHaveBeenCalledOnce();
    expect(h.onSourceError).toHaveBeenCalledOnce();
    expect(h.onSourceError.mock.calls[0]![0]).toMatchObject({ code: "FBA_EXPIRY_SOURCES_UNAVAILABLE", message: expect.stringContaining("1 個入庫計畫") });
    await expect(h.readExpiry.mock.results[0]!.value).resolves.toMatchObject({ complete: false, traversalComplete: true, unavailablePlanCount: 1 });
    const current = snapshot(await h.owner.read(h.get));
    expect(current).toMatchObject({ sourceComplete: false, stale: false });
    expect(current.rows).toHaveLength(2);
    expect(current.rows.find(row => row.id === LOT_ID)).toMatchObject({ declaredQuantity: 1200, expiryDate: "2026-08-25",
      wholeSkuClearanceDays: 100, projectedShortfall: null, calendarEligible: false });
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
    const calls = h.calls.length;
    const rejected = await h.owner.confirm(h.confirm);
    expect(rejected.status).toBe(409);
    expect(rejected.body.value).toMatchObject({ code: "INVENTORY_HEALTH_REVALIDATION_REQUIRED" });
    expect(snapshot(await h.create().read(h.get)).sourceComplete).toBe(false);
    await h.owner.read(h.get);
    expect(h.calls).toHaveLength(calls);
    expect(h.readExpiry).toHaveBeenCalledOnce();
  });

  it("keeps an all-inaccessible traversal explicitly incomplete and never restarts it through local reads", async () => {
    const statuses = [400, 404, 422];
    const plans = statuses.map((_, index) => ({ ...PLAN, inboundPlanId: `wf${String(index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678` }));
    const h = harness({ plans, inaccessible: Object.fromEntries(plans.map((plan, index) => [plan.inboundPlanId, statuses[index]!])) });
    await h.refresh();
    expect(h.calls).toEqual(["plans", "plan", "plan", "plan"]);
    expect(h.readExpiry).toHaveBeenCalledOnce();
    expect(h.onSourceError).toHaveBeenCalledOnce();
    expect(h.onSourceError.mock.calls[0]![0]).toMatchObject({ code: "FBA_EXPIRY_SOURCES_UNAVAILABLE", message: expect.stringContaining("3 個入庫計畫") });
    await expect(h.readExpiry.mock.results[0]!.value).resolves.toMatchObject({ complete: false, traversalComplete: true, unavailablePlanCount: 3 });
    const current = snapshot(await h.owner.read(h.get));
    expect(current).toMatchObject({ sourceComplete: false, stale: false, rows: [{ expiryDate: null, confirmedRemaining: null,
      wholeSkuClearanceDays: 100, projectedShortfall: null, calendarEligible: false }] });
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
    expect(h.persisted().profiles[SCOPE]!.sourceComplete).toBe(false);
    const calls = h.calls.length;
    await h.owner.read(h.get);
    expect(snapshot(await h.create().read(h.get))).toMatchObject({ sourceComplete: false, stale: true });
    expect(h.calls).toHaveLength(calls);
  });

  it("preserves all schema-1 confirmed balances when migration needs more than 100 requests", async () => {
    const plans = Array.from({ length: 60 }, (_, index) => ({ ...PLAN,
      inboundPlanId: `wf${String(index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678` }));
    const stock = { ...STOCK, rows: plans.map((_, index) => ({ ...STOCK.rows[0]!, sellerSku: index === 0 ? "FBA-ONE" : `FBA-${index}` })) };
    // Obtain complete synthetic source identities, then recreate the predecessor's
    // plan-only checkpoint with independently saved operator confirmations.
    const seed = harness({ plans, stock });
    await seed.refresh();
    const saved = seed.persisted();
    const profile = saved.profiles[SCOPE]!;
    profile.expiryCheckpoint = { ...profile.expiryCheckpoint, schemaVersion: 1,
      cachedPlans: profile.expiryCheckpoint.cachedPlans.map(plan => ({ inboundPlanId: plan.inboundPlanId,
        name: plan.name, lastUpdatedAt: plan.lastUpdatedAt, status: plan.status, records: plan.records })) };
    profile.lots = profile.lots.map(lot => ({ ...lot, manualExpiryDate: "2026-08-25", stopSaleDate: "2026-08-20",
      confirmedRemaining: 800, confirmedForSnapshot: "2026-07-01" }));
    const h = harness({ plans, stock, saved });
    await h.refresh();
    expect(h.calls).toHaveLength(182);
    expect(h.readExpiry).toHaveBeenCalledTimes(2);
    expect(h.store.write).toHaveBeenCalledTimes(2);
    expect(h.onSourceError).not.toHaveBeenCalled();
    for (const [index, call] of h.store.write.mock.calls.entries()) {
      const written = (call[0] as ReturnType<typeof predecessorProfile>).profiles[SCOPE]!;
      expect(written.sourceComplete).toBe(index === 1);
      expect(written.lots).toHaveLength(60);
      expect(written.lots.every(lot => lot.confirmedRemaining === 800 && lot.confirmedForSnapshot === "2026-07-01")).toBe(true);
    }
    const current = snapshot(await h.owner.read(h.get));
    expect(current).toMatchObject({ sourceComplete: true, stale: false });
    expect(current.rows).toHaveLength(60);
    expect(current.rows.every(row => row.confirmedRemaining === 800 && row.expiryDate === "2026-08-25" && row.stopSaleDate === "2026-08-20")).toBe(true);
    expect(inventoryHealthCalendarRows(current)).toHaveLength(60);
  });

  it("keeps unavailable-source confirmations inactive through local reopen, then restores exact fresh proof", async () => {
    const inaccessible: Record<string, number> = { [PLAN_ID]: 400 };
    const h = harness({ saved: predecessorProfile(), inaccessible });
    await h.refresh();
    const partial = snapshot(await h.owner.read(h.get));
    expect(partial).toMatchObject({ sourceComplete: false, stale: false });
    expect(partial.rows.find(row => row.id === LOT_ID)).toMatchObject({ confirmedRemaining: 800, projectedShortfall: null, calendarEligible: false });
    expect(inventoryHealthCalendarRows(partial)).toEqual([]);
    const reopened = h.create(), before = h.calls.length;
    const local = snapshot(await reopened.read(h.get));
    expect(local).toMatchObject({ sourceComplete: false, stale: true });
    expect(local.rows.find(row => row.id === LOT_ID)).toMatchObject({ confirmedRemaining: 800, calendarEligible: false });
    expect((await reopened.confirm(h.confirm)).status).toBe(409);
    expect(h.calls).toHaveLength(before);
    expect(h.readExpiry).toHaveBeenCalledOnce();
    delete inaccessible[PLAN_ID];
    await h.refresh(reopened);
    const complete = snapshot(await reopened.read(h.get));
    expect(complete).toMatchObject({ sourceComplete: true, stale: false });
    expect(complete.rows.find(row => row.id === LOT_ID)).toMatchObject({ confirmedRemaining: 800, projectedShortfall: 300, calendarEligible: true });
    expect(inventoryHealthCalendarRows(complete).map(row => row.id)).toEqual([LOT_ID]);
  });

  it("clears an unreproved retired source only after complete traversal while keeping manual data", async () => {
    const h = harness({ saved: predecessorProfile(), plans: [] });
    await h.refresh();
    const current = snapshot(await h.owner.read(h.get));
    expect(current.sourceComplete).toBe(true);
    expect(h.calls).toEqual(["plans"]);
    expect(current.rows.find(row => row.id === LOT_ID)).toMatchObject({ expiryDate: "2026-08-25", stopSaleDate: "2026-08-20",
      confirmedRemaining: null, projectedShortfall: null, calendarEligible: false });
    const lots = h.persisted().profiles[SCOPE]!.lots;
    expect(lots.find(lot => lot.id === LOT_ID)).toMatchObject({ confirmedRemaining: null, confirmedForSnapshot: null });
    expect(lots.find(lot => lot.id === MANUAL_LOT.id)).toMatchObject({ manualExpiryDate: "2026-12-15", confirmedRemaining: 200 });
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
  });

  it.each([
    { change: "available stock", row: { available: 900 } },
    { change: "stock date", row: { snapshotDate: "2026-06-30" } },
    { change: "sales velocity", row: { unitsShipped: { ...STOCK.rows[0]!.unitsShipped!, t7: 71 } } },
  ])("invalidates retained confirmations on changed $change even while the source is unavailable", async ({ row }) => {
    const h = harness({ saved: predecessorProfile(), inaccessible: { [PLAN_ID]: 404 },
      stock: { ...STOCK, rows: [{ ...STOCK.rows[0]!, ...row }] } });
    await h.refresh();
    expect(h.persisted().profiles[SCOPE]!.lots.every(lot => lot.confirmedRemaining === null && lot.confirmedForSnapshot === null)).toBe(true);
    const current = snapshot(await h.owner.read(h.get));
    expect(current.sourceComplete).toBe(false);
    expect(current.rows.find(lot => lot.id === LOT_ID)).toMatchObject({ expiryDate: "2026-08-25", stopSaleDate: "2026-08-20", calendarEligible: false });
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
  });

  it.each([
    { change: "declared total", quantity: 1100, lastUpdatedAt: PLAN.lastUpdatedAt },
    { change: "plan revision", quantity: 1200, lastUpdatedAt: "2026-06-02T00:00:00Z" },
  ])("invalidates a historical confirmation when fresh proof after partial changes $change", async changed => {
    const inaccessible: Record<string, number> = { [PLAN_ID]: 422 };
    const h = harness({ saved: predecessorProfile(), inaccessible, ...changed });
    await h.refresh();
    expect(h.persisted().profiles[SCOPE]!.lots.find(lot => lot.id === LOT_ID)?.confirmedRemaining).toBe(800);
    expect(inventoryHealthCalendarRows(snapshot(await h.owner.read(h.get)))).toEqual([]);
    delete inaccessible[PLAN_ID];
    await h.refresh();
    const current = snapshot(await h.owner.read(h.get));
    expect(current.sourceComplete).toBe(true);
    expect(current.rows.find(lot => lot.id === LOT_ID)).toMatchObject({ declaredQuantity: changed.quantity,
      sourceUpdatedAt: changed.lastUpdatedAt, confirmedRemaining: null, expiryDate: "2026-08-25", stopSaleDate: "2026-08-20", calendarEligible: false });
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
  });
});
