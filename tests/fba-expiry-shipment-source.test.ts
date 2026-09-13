import { describe, expect, it } from "vitest";
import { FbaExpiryReads, parseFbaExpiryCheckpoint, type FbaExpiryEvidence } from "../src/main/amazon/fba-expiry-reads";
import { fbaInboundExternalReadIdentity, type FbaInboundExternalReadPlan } from "../src/main/amazon/fba-inbound-reads";
import type { ModernFbaInboundTransportRequest } from "../src/main/amazon/fba-inbound-modern";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-09-13T12:00:00Z");
const id = (index: number, prefix = "wf") => `${prefix}${String(index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678`;
const shipment = (index: number) => id(index, "sh");
const plan = (index: number) => ({ inboundPlanId: id(index), name: `Restock ${index}`, marketplaceIds: [US], lastUpdatedAt: "2026-09-01T00:00:00Z", status: "SHIPPED" });
const ITEM = { msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", manufacturingLotCode: "LOT-ONE", quantity: 100, expiration: "2027-01-01" };
const unavailable = (status: number) => new SpApiError("Synthetic upstream text must not enter saved evidence", { status, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE", requestId: "synthetic-private-request" });
type Plan = ReturnType<typeof plan>;
function harness(plans: Plan[], handler?: (request: ModernFbaInboundTransportRequest) => unknown) {
  const calls: ModernFbaInboundTransportRequest[] = [];
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "shipment-expiry-synthetic" }));
  const abort = new AbortController();
  let now = NOW;
  const adapter = { async read(request: FbaInboundExternalReadPlan) {
    if (request.source !== "modern") throw new Error("Only modern requests are allowed");
    calls.push(structuredClone(request.request));
    let envelope = handler?.(request.request);
    if (envelope === undefined) {
      if (request.request.kind === "plans") {
        const offset = Number(request.request.paginationToken ?? "0");
        envelope = { inboundPlans: plans.slice(offset, offset + 30), ...(offset + 30 < plans.length ? { pagination: { nextToken: String(offset + 30) } } : {}) };
      } else if (request.request.kind === "plan") {
        const selected = plans.find(value => value.inboundPlanId === ("inboundPlanId" in request.request ? request.request.inboundPlanId : null))!;
        envelope = { ...selected, shipments: [{ shipmentId: shipment(plans.indexOf(selected)), status: "SHIPPED" }] };
      } else envelope = { items: [ITEM] };
    }
    return { identity: fbaInboundExternalReadIdentity(request), envelope, requestId: null };
  } };
  return { calls, context, abort, setNow(value: Date) { now = value; }, async run(checkpoint?: unknown) {
    return new FbaExpiryReads({ adapter, context, now: () => now }).read({ context: await context.capture(US), signal: abort.signal, checkpoint });
  } };
}
async function finish(h: ReturnType<typeof harness>, checkpoint?: unknown): Promise<FbaExpiryEvidence> {
  for (let slice = 0; slice < 20; slice += 1) {
    const before = h.calls.length;
    const result = await h.run(checkpoint);
    expect(h.calls.length - before).toBeLessThanOrEqual(100);
    if (result.traversalComplete) return result;
    checkpoint = JSON.parse(JSON.stringify(result.checkpoint));
  }
  throw new Error("Synthetic traversal exceeded its expected bounded slices");
}

describe("shipment-based declared expiry source", () => {
  it("reads selected shipments fully, aggregates split batches under stable plan IDs and retains distinct dates", async () => {
    const selected = plan(0);
    const h = harness([selected], request => {
      if (request.kind === "plan") return { ...selected, shipments: [{ shipmentId: shipment(0), status: "SHIPPED" }, { shipmentId: shipment(1), status: "SHIPPED" }] };
      if (request.kind === "shipment-items") {
        if (request.shipmentId === shipment(0)) return request.paginationToken
          ? { items: [{ ...ITEM, expiration: "2027-02-01", quantity: 20 }] }
          : { items: [{ ...ITEM, quantity: 40 }], pagination: { nextToken: "second-date" } };
        return { items: [{ ...ITEM, quantity: 60 }] };
      }
    });
    const result = await h.run();
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "shipment-items", "shipment-items", "shipment-items"]);
    expect(result).toMatchObject({ complete: true, traversalComplete: true, unavailablePlanCount: 0 });
    expect(result.records.map(row => [row.expiryDate, row.declaredQuantity])).toEqual([["2027-01-01", 100], ["2027-02-01", 20]]);
    expect(result.records.every(row => row.confirmedRemaining === null && row.confirmedForSnapshot === null)).toBe(true);
    expect(result.checkpoint?.cachedPlans[0]?.itemSources.map(source => [source.shipmentId, source.items.length])).toEqual([[shipment(0), 2], [shipment(1), 1]]);
    const original = await harness([selected], request => request.kind === "plan" ? { ...selected, shipments: [] } : undefined).run();
    expect(result.records[0]).toEqual(original.records[0]);
    expect(JSON.stringify(result.records)).not.toContain(shipment(0));
  });

  it.each([{ shipments: undefined }, { shipments: [] }])("does not treat shipment list $shipments as empty complete, but reads declared plan items", async ({ shipments }) => {
    const selected = plan(0);
    const h = harness([selected], request => request.kind === "plan" ? { ...selected, ...(shipments === undefined ? {} : { shipments }) } : undefined);
    const result = await h.run();
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "plan-items"]);
    expect(result.records).toHaveLength(1);
    expect(result.complete).toBe(true);
  });

  it("allows a bounded split-batch sum above the per-item limit", async () => {
    const selected = plan(0);
    const result = await harness([selected], request => request.kind === "plan"
      ? { ...selected, shipments: [{ shipmentId: shipment(0), status: "SHIPPED" }, { shipmentId: shipment(1), status: "SHIPPED" }] }
      : request.kind === "shipment-items" ? { items: [{ ...ITEM, quantity: 500000 }] } : undefined).run();
    expect(result.records[0]?.declaredQuantity).toBe(1000000);
    expect(parseFbaExpiryCheckpoint(JSON.parse(JSON.stringify(result.checkpoint)))?.cachedPlans[0]?.records[0]?.declaredQuantity).toBe(1000000);
  });

  it.each([400, 404, 422].flatMap(status => [0, 1, 2].map(position => ({ status, position }))))("isolates status $status at plan $position and reads every later plan", async ({ status, position }) => {
    const plans = [plan(0), plan(1), plan(2)];
    const h = harness(plans, request => { if (request.kind === "plan" && request.inboundPlanId === id(position)) throw unavailable(status); });
    const result = await h.run();
    expect(result).toMatchObject({ complete: false, traversalComplete: true, unavailablePlanCount: 1 });
    expect(result.records).toHaveLength(2);
    expect(h.calls.filter(request => request.kind === "plan")).toHaveLength(3);
    expect(result.checkpoint?.unavailablePlans).toEqual([{ inboundPlanId: id(position), name: `Restock ${position}`, lastUpdatedAt: plans[position]!.lastUpdatedAt, status: "SHIPPED", reason: "upstream-unavailable", upstreamStatus: status,
      diagnostic: { operation: "plan", page: "first", reason: "unknown" } }]);
    expect(JSON.stringify(result.checkpoint)).not.toMatch(/Synthetic upstream|synthetic-private-request|requestId/);
  });

  it("finishes all-unavailable traversal as terminal partial and retries only a subsequent explicit scan", async () => {
    let rejected = true;
    const h = harness([plan(0), plan(1)], request => { if (rejected && request.kind === "plan") throw unavailable(404); });
    const first = await h.run();
    expect(first).toMatchObject({ complete: false, traversalComplete: true, unavailablePlanCount: 2, records: [] });
    rejected = false;
    const fresh = await h.run(JSON.parse(JSON.stringify(first.checkpoint)));
    expect(fresh).toMatchObject({ complete: true, traversalComplete: true, unavailablePlanCount: 0 });
    expect(fresh.records).toHaveLength(2);
    expect(h.calls.filter(request => request.kind === "plan")).toHaveLength(4);
  });

  it("reopens more than 100 requests without retrying a rejected plan or caching any partial plan", async () => {
    const h = harness(Array.from({ length: 110 }, (_, index) => plan(index)), request => { if (request.kind === "plan" && request.inboundPlanId === id(0)) throw unavailable(422); });
    const first = await h.run();
    expect(first).toMatchObject({ complete: false, traversalComplete: false, unavailablePlanCount: 1 });
    expect(h.calls).toHaveLength(100);
    const original = JSON.stringify(first.checkpoint);
    const result = await finish(h, JSON.parse(original));
    expect(result).toMatchObject({ complete: false, traversalComplete: true, unavailablePlanCount: 1 });
    expect(result.records).toHaveLength(109);
    expect(h.calls.filter(request => request.kind === "plan" && request.inboundPlanId === id(0))).toHaveLength(1);
    expect(JSON.stringify(first.checkpoint)).toBe(original);
    expect(result.checkpoint?.cachedPlans.every(value => value.itemSources.every(source => source.items.length === 1))).toBe(true);
  });

  it("retains rejection tombstones when old continuation tokens require a fresh listing pass", async () => {
    const h = harness(Array.from({ length: 60 }, (_, index) => plan(index)), request => { if (request.kind === "plan" && request.inboundPlanId === id(0)) throw unavailable(400); });
    const first = await h.run();
    expect(first.traversalComplete).toBe(false);
    h.setNow(new Date(NOW.getTime() + 31 * 60000));
    const result = await finish(h, first.checkpoint);
    expect(result).toMatchObject({ complete: false, traversalComplete: true, unavailablePlanCount: 1 });
    expect(h.calls.filter(request => request.kind === "plan" && request.inboundPlanId === id(0))).toHaveLength(1);
  });

  it("discards every item from a plan if a late shipment page is unavailable, then continues the next plan", async () => {
    const h = harness([plan(0), plan(1)], request => {
      if (request.kind === "shipment-items" && request.inboundPlanId === id(0)) {
        if (request.paginationToken) throw unavailable(404);
        return { items: [ITEM], pagination: { nextToken: "late" } };
      }
    });
    const result = await h.run();
    expect(result).toMatchObject({ complete: false, traversalComplete: true, unavailablePlanCount: 1 });
    expect(result.records).toHaveLength(1);
    expect(result.checkpoint?.cachedPlans.map(value => value.inboundPlanId)).toEqual([id(1)]);
    expect(result.checkpoint?.currentPlan).toBeNull();
    expect(JSON.stringify(result.checkpoint?.unavailablePlans)).not.toContain("FBA-ONE");
  });

  it("migrates a validated schema 1 cache by re-proving shipment coverage and preserving original IDs", async () => {
    const original = await harness([plan(0)], request => request.kind === "plan" ? { ...plan(0), shipments: [] } : undefined).run();
    const legacy = { ...original.checkpoint!, schemaVersion: 1, cachedPlans: original.checkpoint!.cachedPlans.map(({ itemSources: _sources, ...value }) => value) };
    const migrated = parseFbaExpiryCheckpoint(legacy)!;
    expect(migrated).toMatchObject({ schemaVersion: 2, phase: "partial", cachedPlans: [], seenPlanIds: [], planPagesComplete: false });
    const h = harness([plan(0)]);
    const result = await h.run(legacy);
    expect(result.records[0]?.id).toBe(original.records[0]?.id);
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "shipment-items"]);
    const invalid = structuredClone(legacy);
    invalid.cachedPlans[0]!.records[0] = { ...invalid.cachedPlans[0]!.records[0]!, confirmedRemaining: 100 };
    await expect(h.run(invalid)).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(3);
  });

  it.each([
    { inboundPlanId: id(99) }, { lastUpdatedAt: "2026-09-02T00:00:00Z" }, { status: "ACTIVE" },
    { marketplaceIds: ["A1F83G8C2ARO7P"] }, { shipments: null }, { shipments: {} },
    { shipments: [{ shipmentId: "FBA123456789", status: "SHIPPED" }] }, { shipments: [{ shipmentId: shipment(0), status: "SHIPPED" }, { shipmentId: shipment(0), status: "SHIPPED" }] },
  ])("rejects inconsistent successful plan detail %j before reading its items", async changed => {
    const h = harness([plan(0), plan(1)], request => request.kind === "plan" ? { ...plan(0), shipments: [{ shipmentId: shipment(0), status: "SHIPPED" }], ...changed } : undefined);
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan"]);
  });

  it.each([401, 403, 409, 429, 500, 503])("does not isolate HTTP %s", async status => {
    const h = harness([plan(0), plan(1)], request => { if (request.kind === "plan") throw unavailable(status); });
    await expect(h.run()).rejects.toMatchObject({ status });
    expect(h.calls).toHaveLength(2);
  });

  it.each([new Error("Synthetic network failure"), new SpApiError("Synthetic parser failure", { status: 400, code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" })])("does not isolate an unclassified failure", async failure => {
    const h = harness([plan(0), plan(1)], request => { if (request.kind === "plan") throw failure; });
    await expect(h.run()).rejects.toBe(failure);
    expect(h.calls).toHaveLength(2);
  });

  it.each(["abort", "context"])("checks %s again after a rejected adapter call before isolation", async kind => {
    const h = harness([plan(0), plan(1)], request => {
      if (request.kind === "plan") { if (kind === "abort") h.abort.abort(); else h.context.invalidate("lock-screen"); throw unavailable(400); }
    });
    await expect(h.run()).rejects.toMatchObject(kind === "context" ? { code: "SP_CONTEXT_INVALIDATED" } : { name: "AbortError" });
    expect(h.calls).toHaveLength(2);
  });

  it("rejects repeated same-batch items across pages of the same shipment", async () => {
    const h = harness([plan(0)], request => request.kind === "shipment-items" ? { items: [ITEM], ...(request.paginationToken ? {} : { pagination: { nextToken: "two" } }) } : undefined);
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(4);
  });

  it("rejects malformed late successful items without publishing a partial plan or advancing to later plans", async () => {
    const h = harness([plan(0), plan(1)], request => request.kind === "shipment-items" ? { items: [{ ...ITEM, expiration: request.paginationToken ? "2026-02-31" : ITEM.expiration }], pagination: { nextToken: "two" } } : undefined);
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(4);
  });

  it("revalidates plan detail while reusing an unchanged immutable complete item cache", async () => {
    const h = harness([plan(0)]);
    const first = await h.run();
    const before = JSON.stringify(first.checkpoint);
    await h.run(first.checkpoint);
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "shipment-items", "plans", "plan"]);
    expect(JSON.stringify(first.checkpoint)).toBe(before);
  });

  it("rejects tampered checkpoint shipment provenance before any external read", async () => {
    const first = await harness([plan(0)]).run();
    for (const mutate of [
      (value: NonNullable<typeof first.checkpoint>) => { value.cachedPlans[0]!.itemSources[0]!.items[0]!.quantity += 1; },
      (value: NonNullable<typeof first.checkpoint>) => { value.cachedPlans[0]!.itemSources[0]!.shipmentId = "FBA123456789"; },
      (value: NonNullable<typeof first.checkpoint>) => { value.unavailablePlans.push({ ...plan(0), status: "SHIPPED", reason: "upstream-unavailable", upstreamStatus: 400 }); },
    ]) {
      const checkpoint = structuredClone(first.checkpoint!); mutate(checkpoint);
      const h = harness([plan(0)]);
      await expect(h.run(checkpoint)).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
      expect(h.calls).toEqual([]);
    }
  });

  it.each([1000, 1001])("enforces the official item page limit at %s items", async count => {
    const h = harness([plan(0)], request => request.kind === "shipment-items" ? { items: Array.from({ length: count }, (_, index) => ({ ...ITEM, msku: `SKU-${index}` })) } : undefined);
    if (count === 1000) expect((await h.run()).records).toHaveLength(1000);
    else await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(3);
  });

  it("rejects an excessive selected shipment count before any item request", async () => {
    const h = harness([plan(0)], request => request.kind === "plan" ? { ...plan(0), shipments: Array.from({ length: 10001 }, (_, index) => ({ shipmentId: shipment(index), status: "SHIPPED" })) } : undefined);
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(2);
  });

  it.each(["2026-09-01T00:00:00.000Z", "2026-09-01T08:00:00+08:00"])("accepts equivalent RFC3339 revision %s without changing the saved list revision", async lastUpdatedAt => {
    const h = harness([plan(0)], request => request.kind === "plan" ? { ...plan(0), lastUpdatedAt, shipments: [] } : undefined);
    expect((await h.run()).records[0]?.sourceUpdatedAt).toBe(plan(0).lastUpdatedAt);
  });

  it.each(["2026-09-01T00:00:00.000000001Z", "September 1, 2026 00:00:00 GMT", "2026-09-01", "2026-02-31T00:00:00Z"])("rejects changed or unsupported revision %s", async lastUpdatedAt => {
    const h = harness([plan(0)], request => request.kind === "plan" ? { ...plan(0), lastUpdatedAt, shipments: [] } : undefined);
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(2);
  });

  it("discards a rejected plan even when its earlier item pages came from a persisted slice", async () => {
    const h = harness([plan(0)], request => {
      if (request.kind === "shipment-items") {
        const offset = Number(request.paginationToken ?? "0");
        if (offset === 98) throw unavailable(422);
        return { items: [{ ...ITEM, msku: `SKU-${offset}` }], pagination: { nextToken: String(offset + 1) } };
      }
    });
    const first = await h.run();
    expect(first.records).toEqual([]);
    expect(first.checkpoint?.currentPlan?.records).toHaveLength(98);
    const next = await h.run(JSON.parse(JSON.stringify(first.checkpoint)));
    expect(next).toMatchObject({ records: [], complete: false, traversalComplete: true, unavailablePlanCount: 1 });
    expect(next.checkpoint?.cachedPlans).toEqual([]);
    expect(next.checkpoint?.currentPlan).toBeNull();
    expect(h.calls).toHaveLength(101);
  });

  it("does not isolate a list-level rejection", async () => {
    const h = harness([plan(0)], request => { if (request.kind === "plans") throw unavailable(400); });
    await expect(h.run()).rejects.toMatchObject({ status: 400 });
    expect(h.calls).toHaveLength(1);
  });

  it("isolates an unreadable unshipped plan-items source without claiming it is empty", async () => {
    const h = harness([plan(0)], request => {
      if (request.kind === "plan") return { ...plan(0), shipments: [] };
      if (request.kind === "plan-items") throw unavailable(404);
    });
    expect(await h.run()).toMatchObject({ records: [], complete: false, traversalComplete: true, unavailablePlanCount: 1 });
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "plan-items"]);
  });

  it("rejects unchanged revision with an invalid detail identity before using a complete cache", async () => {
    let drift = false;
    const h = harness([plan(0)], request => drift && request.kind === "plan" ? { ...plan(1), shipments: [] } : undefined);
    const first = await h.run(); drift = true;
    await expect(h.run(first.checkpoint)).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(5);
  });

  it("rejects an oversized checkpoint before reading any external source", async () => {
    const first = await harness([plan(0)]).run();
    const h = harness([plan(0)]);
    await expect(h.run({ ...first.checkpoint, extra: "x".repeat(7 * 1024 * 1024) })).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(0);
  });

  it.each([undefined, "", "ERROR", "FUTURE_STATUS"])("rejects missing or unsupported selected shipment status %j", async status => {
    const h = harness([plan(0)], request => request.kind === "plan" ? { ...plan(0), shipments: [{ shipmentId: shipment(0), status }] } : undefined);
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(2);
  });

  it.each([200, 201])("enforces the aggregate declared-quantity limit across %s maximum-size shipment items", async count => {
    const h = harness([plan(0)], request => request.kind === "plan"
      ? { ...plan(0), shipments: Array.from({ length: count }, (_, index) => ({ shipmentId: shipment(index), status: "SHIPPED" })) }
      : request.kind === "shipment-items" ? { items: [{ ...ITEM, quantity: 500000 }] } : undefined);
    if (count === 200) expect((await finish(h)).records[0]?.declaredQuantity).toBe(100000000);
    else await expect(finish(h)).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
  });

  it.each([10, 11])("enforces the total source-item limit across %s full pages", async pages => {
    const h = harness([plan(0)], request => {
      if (request.kind === "shipment-items") {
        const offset = Number(request.paginationToken ?? "0");
        return { items: Array.from({ length: 1000 }, (_, index) => ({ ...ITEM, msku: `SKU-${offset * 1000 + index}` })), ...(offset + 1 < pages ? { pagination: { nextToken: String(offset + 1) } } : {}) };
      }
    });
    if (pages === 10) expect((await h.run()).records).toHaveLength(10000);
    else await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toHaveLength(pages + 2);
  });

  it.each(["September 1, 2026 00:00:00 GMT", "2026-09-01", "2026-02-31T00:00:00Z"])("rejects malformed list revision %s before a future plan rejection can be isolated", async lastUpdatedAt => {
    const h = harness([{ ...plan(0), lastUpdatedAt }], request => { if (request.kind === "plan") throw unavailable(400); });
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED", status: 502 });
    expect(h.calls.map(request => request.kind)).toEqual(["plans"]);
  });

  it.each(["cached", "current", "pending", "unavailable"] as const)("rejects malformed schema 2 %s plan revisions before external reads", async state => {
    const first = await harness([plan(0)]).run();
    const checkpoint = structuredClone(first.checkpoint!);
    const cached = checkpoint.cachedPlans[0]!;
    const lastUpdatedAt = "September 1, 2026 00:00:00 GMT";
    const malformed = { ...cached, lastUpdatedAt, records: cached.records.map(record => ({ ...record, sourceUpdatedAt: lastUpdatedAt })) };
    checkpoint.cachedPlans = [];
    if (state === "cached") checkpoint.cachedPlans = [malformed];
    if (state === "current") {
      checkpoint.phase = "partial";
      checkpoint.currentPlan = { ...malformed, sourceIndex: 0, itemCursor: "next-page", itemTokens: ["next-page"] };
    }
    if (state === "pending") {
      checkpoint.phase = "partial";
      checkpoint.pendingPlans = [{ ...plan(0), lastUpdatedAt, status: "SHIPPED" }];
    }
    if (state === "unavailable") checkpoint.unavailablePlans = [{ ...plan(0), lastUpdatedAt, status: "SHIPPED", reason: "upstream-unavailable", upstreamStatus: 400 }];
    expect(() => parseFbaExpiryCheckpoint(checkpoint)).toThrowError(expect.objectContaining({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" }));
    const h = harness([plan(0)], request => { if (request.kind === "plan") throw unavailable(400); });
    await expect(h.run(checkpoint)).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toEqual([]);
  });

  it("retains schema 1 timestamp validation only for bounded migration into a new traversal", async () => {
    const first = await harness([plan(0)]).run();
    const lastUpdatedAt = "September 1, 2026 00:00:00 GMT";
    const legacy = { ...first.checkpoint!, schemaVersion: 1, cachedPlans: first.checkpoint!.cachedPlans.map(({ itemSources: _sources, ...value }) => ({
      ...value, lastUpdatedAt, records: value.records.map(record => ({ ...record, sourceUpdatedAt: lastUpdatedAt })),
    })) };
    const migrated = parseFbaExpiryCheckpoint(legacy)!;
    expect(migrated).toMatchObject({ schemaVersion: 2, phase: "partial", cachedPlans: [], pendingPlans: [], currentPlan: null, unavailablePlans: [] });
    const h = harness([plan(0)]);
    expect((await h.run(legacy)).complete).toBe(true);
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "shipment-items"]);
  });
});
