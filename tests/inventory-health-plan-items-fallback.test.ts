import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { InventoryHealthReportSnapshot } from "../src/main/amazon/aged-inventory-reads";
import { FbaExpiryReads, type FbaExpiryCheckpoint } from "../src/main/amazon/fba-expiry-reads";
import { createFbaInboundReadsProductionAdapter } from "../src/main/amazon/fba-inbound-reads-production";
import { FbaInboundRequestError } from "../src/main/amazon/fba-inbound-request-error";
import type { InventoryHealthEvidence } from "../src/main/amazon/inventory-health";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import type { PrivateLocalJsonPort } from "../src/main/private-local-json";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import { inventoryHealthCalendarRows, isInventoryHealthSnapshot, type InventoryHealthSnapshot } from "../src/shared/inventory-health";

// All plans, products, dates, quantities and responses below are synthetic.
// The cloned in-memory port exercises the encrypted-store interface, not encryption.
const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-09-14T12:00:00Z");
const ACCOUNT = "synthetic-plan-fallback-integration";
const SCOPE = createHash("sha256").update(JSON.stringify([ACCOUNT, "live", US])).digest("hex");
const BASE_PATH = "/inbound/fba/2024-03-20/inboundPlans";
const SKU = "SYNTHETIC-FBA-ONE";
const STOCK: InventoryHealthReportSnapshot = { marketplaceId: US, mode: "live", fetchedAt: NOW.toISOString(), rows: [{
  sellerSku: SKU, asin: "B000000001", title: "Synthetic low-age FBA product", available: 1000, agedOver180: 0,
  estimatedExcessQuantity: null, currencyCode: null, estimatedStorageCostNextMonth: null, estimatedAgedSurcharge: null,
  snapshotDate: "2026-09-14", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 },
}] };
const GET: ApiRequest = { requestId: "synthetic-health-get", method: "GET", path: "/api/inventory-health", query: { marketplaceId: US }, headers: {} };
type SavedFixture = { schemaVersion: 1; profiles: Record<string, InventoryHealthEvidence & { expiryCheckpoint: FbaExpiryCheckpoint }> };
const plan = (index: number) => ({ inboundPlanId: `wf${String(index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678`,
  name: `Synthetic expiry batch ${index}`, marketplaceIds: [US], status: "SHIPPED" as const, lastUpdatedAt: "2026-09-12T00:00:00Z" });
const expiryDate = (index: number, page: number) => new Date(Date.UTC(2026, 8, 24 + index * 2 + page)).toISOString().slice(0, 10);
const profile = (value: SavedFixture) => value.profiles[SCOPE]!;
function snapshot(response: ApiResponse): InventoryHealthSnapshot {
  expect(response.status).toBe(200);
  const value = (response.body.value as { snapshot: InventoryHealthSnapshot }).snapshot;
  expect(isInventoryHealthSnapshot(value)).toBe(true);
  return value;
}
function confirmRequest(id: string): ApiRequest {
  return { ...GET, method: "POST", path: "/api/inventory-health/confirmation", body: { kind: "json", value: {
    marketplaceId: US, id, snapshotFetchedAt: STOCK.fetchedAt, confirmedRemaining: 200, expiryDate: null, stopSaleDate: null,
  } } };
}
function historical75(planCount: number): SavedFixture {
  const unavailablePlans = Array.from({ length: planCount }, (_, index) => ({ ...plan(index), reason: "upstream-unavailable" as const,
    upstreamStatus: 400 as const, diagnostic: { operation: "plan" as const, page: "first" as const,
      reason: "other-input" as const, code: "BadRequest" as const, responseState: "parsed" as const } }));
  return { schemaVersion: 1, profiles: { [SCOPE]: { ...STOCK, sourceComplete: false, lots: [], expiryCheckpoint: {
    schemaVersion: 2, scopeFingerprint: SCOPE, phase: "complete", startedAt: "2026-09-14T11:00:00Z",
    cachedPlans: [], unavailablePlans, pendingPlans: [], currentPlan: null, planCursor: null, planPagesComplete: true,
    seenPlanIds: unavailablePlans.map(value => value.inboundPlanId), seenPlanTokens: [],
  } } } };
}
function harness(options: { saved?: SavedFixture; planCount?: number; lateFailureIndex?: number } = {}) {
  const plans = Array.from({ length: options.planCount ?? 2 }, (_, index) => plan(index));
  let disk: unknown = structuredClone(options.saved ?? null);
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: ACCOUNT }));
  const calls: { kind: "plans" | "plan" | "plan-items"; index: number | null; token: string | null }[] = [];
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init?.body).toBeUndefined();
    const token = url.searchParams.get("paginationToken");
    if (url.pathname === BASE_PATH) {
      expect(Object.fromEntries(url.searchParams)).toEqual({ sortBy: "LAST_UPDATED_TIME", sortOrder: "DESC", pageSize: "30",
        ...(token ? { paginationToken: token } : {}) });
      calls.push({ kind: "plans", index: null, token });
      expect(token === null || token === "synthetic-plans-next").toBe(true);
      const offset = token ? 30 : 0;
      return response({ inboundPlans: plans.slice(offset, offset + 30),
        ...(offset + 30 < plans.length ? { pagination: { nextToken: "synthetic-plans-next" } } : {}) });
    }
    const index = plans.findIndex(value => url.pathname === `${BASE_PATH}/${value.inboundPlanId}` || url.pathname === `${BASE_PATH}/${value.inboundPlanId}/items`);
    expect(index).toBeGreaterThanOrEqual(0);
    if (url.pathname === `${BASE_PATH}/${plans[index]!.inboundPlanId}`) {
      expect(url.search).toBe("");
      calls.push({ kind: "plan", index, token });
      return response({ errors: [{ code: "BadRequest", message: "Synthetic metadata validation rejection." }] }, 400);
    }
    expect(Object.fromEntries(url.searchParams)).toEqual({ pageSize: "1000", ...(token ? { paginationToken: token } : {}) });
    expect(token === null || token === "synthetic-items-next").toBe(true);
    calls.push({ kind: "plan-items", index, token });
    if (index === options.lateFailureIndex && token !== null) return response({ errors: [{ code: "BadRequest", message: "Synthetic item page validation rejection." }] }, 400);
    return response({ items: [{ msku: SKU, asin: "B000000001", fnsku: "X000000001", quantity: 1200,
      expiration: expiryDate(index, token ? 1 : 0) }], ...(token ? {} : { pagination: { nextToken: "synthetic-items-next" } }) });
  });
  const adapter = createFbaInboundReadsProductionAdapter({ fetchImpl, getAccessToken: async () => "synthetic-token",
    invalidateAccessToken: vi.fn(), now: () => NOW, sleep: async () => undefined, userAgent: () => "Synthetic AMZ.API integration" });
  const readAdapter = vi.spyOn(adapter, "read");
  const expiry = new FbaExpiryReads({ context, adapter, now: () => NOW });
  const readExpiry = vi.spyOn(expiry, "read");
  const store = { read: vi.fn<PrivateLocalJsonPort["read"]>(async () => structuredClone(disk)),
    write: vi.fn<PrivateLocalJsonPort["write"]>(async (value, fence) => { await fence(); disk = structuredClone(value); }) };
  const create = () => new InventoryHealthCoordinator({ context, expiry, store, now: () => NOW });
  const owner = create(), onSourceError = vi.fn();
  const refresh = async (selected = owner) => selected.refresh({ context: await context.capture(US), snapshot: STOCK,
    signal: new AbortController().signal, onSourceError });
  return { owner, create, refresh, onSourceError, fetchImpl, readAdapter, readExpiry, calls, store,
    persisted: () => structuredClone(disk) as SavedFixture };
}

describe("synthetic plan-items fallback through production transport and saved health", () => {
  it("saves all independently read dates and sources without treating declared stock as confirmed remaining", async () => {
    const h = harness();
    await h.refresh();
    expect(h.calls).toEqual([{ kind: "plans", index: null, token: null }, ...[0, 1].flatMap(index => [
      { kind: "plan", index, token: null }, { kind: "plan-items", index, token: null },
      { kind: "plan-items", index, token: "synthetic-items-next" },
    ])]);
    for (const [index, call] of h.readAdapter.mock.calls.entries()) {
      if (call[0].source === "modern" && call[0].request.kind === "plan") {
        const failure = await h.readAdapter.mock.results[index]!.value.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(FbaInboundRequestError);
        expect(failure).toMatchObject({ status: 400, requestDiagnostic: { code: "BadRequest", state: "parsed", reason: "other-input" } });
      }
    }
    expect(h.onSourceError).not.toHaveBeenCalled();
    const current = snapshot(await h.owner.read(GET));
    expect(current).toMatchObject({ sourceComplete: true, stale: false, expirySourceDiagnostics: {
      status: "available", traversal: "complete", listedPlanCount: 2, cachedPlanCount: 2,
      unavailablePlanCount: 0, pendingPlanCount: 0, planItemFallbackCount: 2, failures: [],
    } });
    expect(current.rows.map(row => row.expiryDate).sort()).toEqual([0, 1].flatMap(index => [expiryDate(index, 0), expiryDate(index, 1)]));
    expect(new Set(current.rows.map(row => row.id)).size).toBe(4);
    expect(new Set(current.rows.map(row => row.sourceRef)).size).toBe(2);
    expect(current.rows.map(row => row.sourceLabel)).toEqual([0, 0, 1, 1].map(index => `${plan(index).name} · ${plan(index).inboundPlanId}`));
    expect(current.rows.every(row => row.declaredQuantity === 1200 && row.confirmedRemaining === null && row.projectedShortfall === null && !row.calendarEligible)).toBe(true);
    expect(current.rows.every(row => row.agedOver180 === 0 && row.wholeSkuClearanceDays === 100 && row.earliestDeclaredExpiryDate === "2026-09-24" && row.stockRisk === "may-outlast-expiry")).toBe(true);
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
    expect(profile(h.persisted()).expiryCheckpoint.cachedPlans.every(value => value.planDetailUnavailable === true && value.itemSources.length === 1 && value.itemSources[0]!.shipmentId === null)).toBe(true);

    // Local observation neither reopens Amazon reads nor writes the saved profile.
    const beforeCalls = h.fetchImpl.mock.calls.length, beforeWrites = h.store.write.mock.calls.length;
    expect(snapshot(await h.owner.read(GET))).toEqual(current);
    const reopened = snapshot(await h.create().read(GET));
    expect(reopened).toMatchObject({ sourceComplete: true, stale: true, expirySourceDiagnostics: current.expirySourceDiagnostics });
    expect(reopened.rows.map(row => [row.id, row.expiryDate, row.sourceRef, row.sourceLabel])).toEqual(current.rows.map(row => [row.id, row.expiryDate, row.sourceRef, row.sourceLabel]));
    expect(inventoryHealthCalendarRows(reopened)).toEqual([]);
    expect(h.fetchImpl).toHaveBeenCalledTimes(beforeCalls);
    expect(h.readExpiry).toHaveBeenCalledOnce();
    expect(h.store.write).toHaveBeenCalledTimes(beforeWrites);

    const earliest = current.rows.find(row => row.expiryDate === "2026-09-24")!;
    const confirmed = snapshot(await h.owner.confirm(confirmRequest(earliest.id)));
    expect(confirmed.rows.find(row => row.id === earliest.id)).toMatchObject({ declaredQuantity: 1200, confirmedRemaining: 200,
      daysRemaining: 10, projectedShortfall: 100, calendarEligible: true });
    expect(inventoryHealthCalendarRows(confirmed).map(row => row.id)).toEqual([earliest.id]);
    expect(h.fetchImpl).toHaveBeenCalledTimes(beforeCalls);
    expect(h.store.write).toHaveBeenCalledTimes(beforeWrites + 1);
  });

  it("keeps source coverage partial until the last page and resumes a saved slice after owner recreation", async () => {
    const h = harness({ planCount: 36 });
    await h.refresh();
    expect(h.fetchImpl).toHaveBeenCalledTimes(110);
    expect(h.readExpiry).toHaveBeenCalledTimes(2);
    expect(h.store.write).toHaveBeenCalledTimes(2);
    const first = h.store.write.mock.calls[0]![0] as SavedFixture;
    expect(profile(first)).toMatchObject({ sourceComplete: false, expiryCheckpoint: { phase: "partial",
      currentPlan: { inboundPlanId: plan(32).inboundPlanId, planDetailUnavailable: true, itemCursor: "synthetic-items-next" } } });
    expect(profile(first).lots).toHaveLength(64);
    expect(profile(first).lots.some(lot => lot.expiryDate === expiryDate(32, 0))).toBe(false);
    const final = snapshot(await h.owner.read(GET));
    expect(final).toMatchObject({ sourceComplete: true, expirySourceDiagnostics: { cachedPlanCount: 36, planItemFallbackCount: 36 } });
    expect(final.rows).toHaveLength(72);

    const resumed = harness({ planCount: 36, saved: structuredClone(first) });
    const local = snapshot(await resumed.owner.read(GET));
    expect(local).toMatchObject({ sourceComplete: false, stale: true, expirySourceDiagnostics: {
      traversal: "partial", listedPlanCount: 36, cachedPlanCount: 32, pendingPlanCount: 4, planItemFallbackCount: 32,
    } });
    expect(inventoryHealthCalendarRows(local)).toEqual([]);
    expect(resumed.fetchImpl).not.toHaveBeenCalled();
    expect(resumed.readExpiry).not.toHaveBeenCalled();
    expect(resumed.store.write).not.toHaveBeenCalled();
    await resumed.refresh();
    expect(resumed.calls[0]).toEqual({ kind: "plan-items", index: 32, token: "synthetic-items-next" });
    expect(resumed.calls.some(call => call.kind === "plans" || (call.kind === "plan" && call.index === 32))).toBe(false);
    expect(resumed.fetchImpl).toHaveBeenCalledTimes(10);
    expect(snapshot(await resumed.owner.read(GET))).toEqual(final);
    expect(inventoryHealthCalendarRows(final)).toEqual([]);
  });

  it("drops a failed plan's earlier page while preserving independent plans and blocking calendar confirmation", async () => {
    const h = harness({ planCount: 3, lateFailureIndex: 1 });
    await h.refresh();
    expect(h.fetchImpl).toHaveBeenCalledTimes(10);
    expect(h.onSourceError).toHaveBeenCalledOnce();
    expect(h.onSourceError.mock.calls[0]![0]).toMatchObject({ code: "FBA_EXPIRY_SOURCES_UNAVAILABLE" });
    const current = snapshot(await h.owner.read(GET));
    expect(current).toMatchObject({ sourceComplete: false, stale: false, expirySourceDiagnostics: {
      traversal: "complete", listedPlanCount: 3, cachedPlanCount: 2, planItemFallbackCount: 2, unavailablePlanCount: 1,
      failures: [{ operation: "plan-items", page: "next", status: 400, code: "BadRequest", responseState: "parsed", reason: "other-input", count: 1 }],
    } });
    expect(current.rows.map(row => row.expiryDate).sort()).toEqual([0, 2].flatMap(index => [expiryDate(index, 0), expiryDate(index, 1)]));
    expect(profile(h.persisted()).lots.some(lot => lot.sourceLabel?.includes(plan(1).inboundPlanId))).toBe(false);
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
    const before = h.store.write.mock.calls.length;
    const rejected = await h.owner.confirm(confirmRequest(current.rows[0]!.id));
    expect(rejected.status).toBe(409);
    expect(rejected.body.value).toMatchObject({ code: "INVENTORY_HEALTH_REVALIDATION_REQUIRED" });
    expect(snapshot(await h.create().read(GET))).toMatchObject({ sourceComplete: false, stale: true, expirySourceDiagnostics: current.expirySourceDiagnostics });
    await h.owner.read(GET);
    expect(h.fetchImpl).toHaveBeenCalledTimes(10);
    expect(h.store.write).toHaveBeenCalledTimes(before);
  });

  it("rechecks the list for saved .75 failures, then reads only the unattempted item resources", async () => {
    const h = harness({ saved: historical75(36), planCount: 36 });
    const prior = snapshot(await h.owner.read(GET));
    expect(prior).toMatchObject({ sourceComplete: false, expirySourceDiagnostics: { cachedPlanCount: 0, unavailablePlanCount: 36,
      failures: [{ operation: "plan", page: "first", status: 400, code: "BadRequest", responseState: "parsed", reason: "other-input", count: 36 }],
    } });
    expect(h.fetchImpl).not.toHaveBeenCalled();
    expect(h.readExpiry).not.toHaveBeenCalled();
    expect(h.store.write).not.toHaveBeenCalled();
    await h.refresh();
    expect(h.fetchImpl).toHaveBeenCalledTimes(74);
    expect(h.calls.filter(call => call.kind === "plan")).toEqual([]);
    expect(h.calls.filter(call => call.kind === "plans")).toEqual([
      { kind: "plans", index: null, token: null }, { kind: "plans", index: null, token: "synthetic-plans-next" },
    ]);
    for (const index of [0, 30]) expect(h.calls.findIndex(call => call.kind === "plans" && call.token === (index === 0 ? null : "synthetic-plans-next")))
      .toBeLessThan(h.calls.findIndex(call => call.kind === "plan-items" && call.index === index));
    const current = snapshot(await h.owner.read(GET));
    expect(current).toMatchObject({ sourceComplete: true, expirySourceDiagnostics: { traversal: "complete", listedPlanCount: 36,
      cachedPlanCount: 36, planItemFallbackCount: 36, unavailablePlanCount: 0, failures: [] } });
    expect(current.rows).toHaveLength(72);
    expect(current.rows.every(row => row.confirmedRemaining === null && !row.calendarEligible)).toBe(true);
    expect(inventoryHealthCalendarRows(current)).toEqual([]);
    const writes = h.store.write.mock.calls.length;
    const reopened = snapshot(await h.create().read(GET));
    expect(reopened.rows.map(row => [row.id, row.expiryDate, row.sourceRef])).toEqual(current.rows.map(row => [row.id, row.expiryDate, row.sourceRef]));
    expect(h.fetchImpl).toHaveBeenCalledTimes(74);
    expect(h.readExpiry).toHaveBeenCalledOnce();
    expect(h.store.write).toHaveBeenCalledTimes(writes);
  });
});
