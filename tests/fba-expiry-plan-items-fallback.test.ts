import { describe, expect, it } from "vitest";
import { FbaExpiryReads, projectFbaExpirySourceDiagnostics, type FbaExpiryCheckpoint } from "../src/main/amazon/fba-expiry-reads";
import { fbaInboundExternalReadIdentity, type FbaInboundExternalReadAdapter } from "../src/main/amazon/fba-inbound-reads";
import type { ModernFbaInboundTransportRequest } from "../src/main/amazon/fba-inbound-modern";
import { FbaInboundRequestError, type FbaInboundRequestDiagnostic } from "../src/main/amazon/fba-inbound-request-error";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-09-14T04:22:31Z");
const syntheticId = (index: number, prefix = "wf") => `${prefix}${String(index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678`;
const syntheticPlan = (index: number) => ({
  inboundPlanId: syntheticId(index), marketplaceIds: [US], lastUpdatedAt: "2026-09-01T00:00:00Z",
  status: "SHIPPED" as "ACTIVE" | "SHIPPED",
});
const syntheticItem = (index: number) => ({
  msku: `SYNTHETIC-FBA-${index}`, asin: "B000000001", fnsku: "X000000001",
  quantity: 100, expiration: "2027-01-01",
});
const observedDiagnostic: FbaInboundRequestDiagnostic = { state: "parsed", code: "BadRequest", reason: "other-input" };
const unavailable = (status = 400) => new SpApiError("Synthetic source rejection.", { status, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE" });
const metadataRejection = (status = 400, diagnostic = observedDiagnostic) => new FbaInboundRequestError(unavailable(status), diagnostic);
const reopened = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function fallbackHarness(plans = [syntheticPlan(0)], handler?: (request: ModernFbaInboundTransportRequest) => unknown, accountScope = "synthetic-plan-items-fallback") {
  const calls: ModernFbaInboundTransportRequest[] = [];
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope }));
  const abort = new AbortController();
  const adapter: FbaInboundExternalReadAdapter = {
    async read(plan) {
      if (plan.source !== "modern") throw new Error("Only synthetic modern reads are available");
      const request = plan.request;
      calls.push(structuredClone(request));
      let envelope = handler?.(request);
      if (envelope === undefined) {
        if (request.kind === "plans") {
          const offset = Number(request.paginationToken ?? "0");
          envelope = { inboundPlans: plans.slice(offset, offset + 30),
            ...(offset + 30 < plans.length ? { pagination: { nextToken: String(offset + 30) } } : {}) };
        } else if (request.kind === "plan") throw metadataRejection();
        else if (request.kind === "plan-items") {
          const index = plans.findIndex(value => value.inboundPlanId === request.inboundPlanId);
          if (index < 0 || request.paginationToken !== null) throw new Error("Unexpected synthetic item request");
          envelope = { items: [syntheticItem(index)] };
        } else throw new Error("No synthetic shipment source is provided");
      }
      return { identity: fbaInboundExternalReadIdentity(plan), envelope, requestId: null };
    },
  };
  return { calls, context, abort, async run(checkpoint?: unknown) {
    return new FbaExpiryReads({ adapter, context, now: () => NOW }).read({
      context: await context.capture(US), signal: abort.signal, checkpoint,
    });
  }, async diagnostic(checkpoint: unknown) {
    return projectFbaExpirySourceDiagnostics(checkpoint, await context.capture(US), NOW);
  } };
}

async function saved75Rejections(plans = [syntheticPlan(0)]): Promise<FbaExpiryCheckpoint> {
  // Use the public reader to create a valid persisted shape, then supply the
  // documented .75 fixed fields. These are synthetic historical records only.
  const h = fallbackHarness(plans, request => { if (request.kind === "plan") throw unavailable(); });
  const checkpoint = reopened((await h.run()).checkpoint!);
  checkpoint.startedAt = "2026-09-13T04:22:31Z";
  for (const plan of checkpoint.unavailablePlans) plan.diagnostic = {
    operation: "plan", page: "first", reason: "other-input", code: "BadRequest", responseState: "parsed",
  };
  return checkpoint;
}

function manyItemPages(request: ModernFbaInboundTransportRequest) {
  if (request.kind !== "plan-items") return undefined;
  const page = Number(request.paginationToken ?? "0");
  return { items: [syntheticItem(page)], ...(page < 100 ? { pagination: { nextToken: String(page + 1) } } : {}) };
}

describe("independent declared plan-items source", () => {
  it("reads all 36 synthetic plan-item sources after the observed fixed metadata rejection without inventing remaining quantities", async () => {
    const plans = Array.from({ length: 36 }, (_, index) => ({
      inboundPlanId: `wf${String(index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678`,
      marketplaceIds: [US],
      lastUpdatedAt: "2026-09-01T00:00:00Z",
      status: "SHIPPED" as const,
    }));
    // Metadata uses the fixed .75 observation; item availability and dates are
    // entirely synthetic. This fixture does not prove the live endpoint works.
    const items = plans.map((_, index) => ({
      msku: `SYNTHETIC-FBA-${index}`,
      asin: "B000000001",
      fnsku: "X000000001",
      quantity: 100,
      expiration: index < 18 ? "2027-01-01" : "2027-02-01",
    }));
    const calls: ModernFbaInboundTransportRequest[] = [];
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US, mode: "live", accountScope: "synthetic-plan-items-fallback",
    }));
    const adapter: FbaInboundExternalReadAdapter = {
      async read(plan) {
        if (plan.source !== "modern") throw new Error("Only synthetic modern reads are available");
        const request = plan.request;
        calls.push(structuredClone(request));
        let envelope: unknown;
        if (request.kind === "plans") {
          const offset = Number(request.paginationToken ?? "0");
          envelope = {
            inboundPlans: plans.slice(offset, offset + 30),
            ...(offset === 0 ? { pagination: { nextToken: "30" } } : {}),
          };
        } else if (request.kind === "plan") {
          throw new FbaInboundRequestError(new SpApiError("Synthetic plan metadata rejection.", {
            status: 400, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
          }), { state: "parsed", code: "BadRequest", reason: "other-input" });
        } else if (request.kind === "plan-items") {
          const index = plans.findIndex(value => value.inboundPlanId === request.inboundPlanId);
          if (index < 0 || request.paginationToken !== null) throw new Error("Unexpected synthetic item request");
          envelope = { items: [items[index]!] };
        } else {
          throw new Error("The fixture provides no shipment manifest or shipment-item source");
        }
        return { identity: fbaInboundExternalReadIdentity(plan), envelope, requestId: null };
      },
    };

    const result = await new FbaExpiryReads({ adapter, context, now: () => NOW }).read({
      context: await context.capture(US), signal: new AbortController().signal,
    });

    expect(calls.filter(request => request.kind === "plans")).toHaveLength(2);
    expect(calls.filter(request => request.kind === "plan")).toHaveLength(36);
    const alternativeCalls = calls.filter(request => request.kind === "plan-items");
    expect(alternativeCalls).toHaveLength(36);
    expect(alternativeCalls.map(request => request.inboundPlanId)).toEqual(plans.map(plan => plan.inboundPlanId));
    expect(result.records.map(record => ({
      sellerSku: record.sellerSku,
      expiryDate: record.expiryDate,
      declaredQuantity: record.declaredQuantity,
      confirmedRemaining: record.confirmedRemaining,
      confirmedForSnapshot: record.confirmedForSnapshot,
    }))).toEqual(items.map(item => ({
      sellerSku: item.msku, expiryDate: item.expiration, declaredQuantity: item.quantity,
      confirmedRemaining: null, confirmedForSnapshot: null,
    })));
  });

  it("recovers all matching saved .75 metadata rejections without retrying getInboundPlan", async () => {
    const plans = Array.from({ length: 36 }, (_, index) => syntheticPlan(index));
    const saved = await saved75Rejections(plans);
    const h = fallbackHarness(plans);
    const result = await h.run(reopened(saved));
    expect(h.calls.filter(request => request.kind === "plan")).toHaveLength(0);
    expect(h.calls.filter(request => request.kind === "plan-items")).toHaveLength(36);
    expect(result).toMatchObject({ complete: true, traversalComplete: true, unavailablePlanCount: 0 });
    expect(result.records).toHaveLength(36);
    expect(result.records.every(record => record.confirmedRemaining === null && record.confirmedForSnapshot === null)).toBe(true);
    expect(result.checkpoint?.cachedPlans.every(plan => plan.planDetailUnavailable === true &&
      plan.itemSources.length === 1 && plan.itemSources[0]?.shipmentId === null)).toBe(true);
    expect(await h.diagnostic(reopened(result.checkpoint))).toMatchObject({
      status: "available", cachedPlanCount: 36, planItemFallbackCount: 36, unavailablePlanCount: 0,
    });
  });

  it.each([
    { name: "plan ID", changed: { inboundPlanId: syntheticId(1) } },
    { name: "revision", changed: { lastUpdatedAt: "2026-09-02T00:00:00Z" } },
    { name: "status", changed: { status: "ACTIVE" as const } },
  ])("requires fresh metadata validation when the listed $name differs from a saved rejection", async ({ changed }) => {
    const saved = await saved75Rejections();
    const h = fallbackHarness([{ ...syntheticPlan(0), ...changed }], request => {
      if (request.kind === "plan") throw metadataRejection(400, { ...observedDiagnostic, reason: "inbound-plan-id-malformed" });
    });
    const result = await h.run(saved);
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan"]);
    expect(result.records).toEqual([]);
    expect(result).toMatchObject({ complete: false, unavailablePlanCount: 1 });
  });

  it("accepts an equivalent revision instant without retrying saved rejected metadata", async () => {
    const saved = await saved75Rejections();
    const h = fallbackHarness([{ ...syntheticPlan(0), lastUpdatedAt: "2026-09-01T08:00:00.000+08:00" }]);
    const result = await h.run(saved);
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan-items"]);
    expect(result.records).toHaveLength(1);
  });

  it("does not use saved rejection evidence for a plan now listed only in another marketplace", async () => {
    const saved = await saved75Rejections();
    const h = fallbackHarness([{ ...syntheticPlan(0), marketplaceIds: ["A1F83G8C2ARO7P"] }]);
    const result = await h.run(saved);
    expect(h.calls.map(request => request.kind)).toEqual(["plans"]);
    expect(result.records).toEqual([]);
    expect(await h.diagnostic(result.checkpoint)).not.toHaveProperty("planItemFallbackCount");
  });

  it("rejects saved recovery evidence from another account before any external read", async () => {
    const saved = await saved75Rejections();
    const h = fallbackHarness(undefined, undefined, "another-synthetic-account");
    await expect(h.run(saved)).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls).toEqual([]);
  });

  it("rereads completed fallback items on a new scan while skipping unchanged rejected metadata", async () => {
    let quantity = 100;
    const h = fallbackHarness(undefined, request => request.kind === "plan-items"
      ? { items: [{ ...syntheticItem(0), quantity }] } : undefined);
    const first = await h.run();
    const before = h.calls.length;
    quantity = 125;
    const second = await h.run(reopened(first.checkpoint));
    expect(h.calls.slice(before).map(request => request.kind)).toEqual(["plans", "plan-items"]);
    expect(second.records).toHaveLength(1);
    expect(second.records[0]).toMatchObject({ declaredQuantity: 125, confirmedRemaining: null, confirmedForSnapshot: null });
    expect(await h.diagnostic(second.checkpoint)).toMatchObject({ planItemFallbackCount: 1 });
  });

  it("revalidates metadata when a previously completed fallback source has a new revision", async () => {
    const first = await fallbackHarness().run();
    const changed = { ...syntheticPlan(0), lastUpdatedAt: "2026-09-02T00:00:00Z" };
    const h = fallbackHarness([changed], request => request.kind === "plan" ? { ...changed, shipments: [] } : undefined);
    const next = await h.run(reopened(first.checkpoint));
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "plan-items"]);
    expect(next.checkpoint?.cachedPlans[0]).not.toHaveProperty("planDetailUnavailable");
    expect(await h.diagnostic(next.checkpoint)).not.toHaveProperty("planItemFallbackCount");
  });

  it("does not count retained fallback caches that are still pending in the new traversal", async () => {
    const plans = [syntheticPlan(0), syntheticPlan(1)];
    const completed = await fallbackHarness(plans).run();
    const h = fallbackHarness(plans, request => request.kind === "plan-items" && request.inboundPlanId === syntheticId(0)
      ? manyItemPages(request) : undefined);
    const partial = await h.run(reopened(completed.checkpoint));
    expect(partial).toMatchObject({ complete: false, traversalComplete: false });
    expect(partial.checkpoint?.currentPlan?.planDetailUnavailable).toBe(true);
    expect(partial.checkpoint?.cachedPlans).toHaveLength(1);
    expect(partial.checkpoint?.pendingPlans).toHaveLength(1);
    const diagnostic = await h.diagnostic(partial.checkpoint);
    expect(diagnostic).toMatchObject({ status: "available", cachedPlanCount: 0, pendingPlanCount: 2 });
    expect(diagnostic).not.toHaveProperty("planItemFallbackCount");
  });

  it("resumes a fallback across the request slice without repeating metadata or item pages", async () => {
    const h = fallbackHarness(undefined, manyItemPages);
    const first = await h.run();
    expect(first).toMatchObject({ complete: false, traversalComplete: false, records: [] });
    expect(h.calls).toHaveLength(100);
    expect(first.checkpoint?.currentPlan).toMatchObject({ planDetailUnavailable: true, itemCursor: "98" });
    expect(await h.diagnostic(first.checkpoint)).not.toHaveProperty("planItemFallbackCount");
    const second = await h.run(reopened(first.checkpoint));
    expect(second).toMatchObject({ complete: true, traversalComplete: true });
    expect(second.records).toHaveLength(101);
    expect(new Set(second.records.map(record => record.id)).size).toBe(101);
    expect(h.calls.filter(request => request.kind === "plan")).toHaveLength(1);
    expect(h.calls.filter(request => request.kind === "plan-items").map(request => request.paginationToken))
      .toEqual([null, ...Array.from({ length: 100 }, (_, index) => String(index + 1))]);
    expect(reopened(second.checkpoint)?.cachedPlans[0]?.planDetailUnavailable).toBe(true);
    expect(await h.diagnostic(second.checkpoint)).toMatchObject({ cachedPlanCount: 1, planItemFallbackCount: 1 });
  });

  it("discards a late failed fallback plan and continues another independently readable plan", async () => {
    const h = fallbackHarness([syntheticPlan(0), syntheticPlan(1)], request => {
      if (request.kind === "plan-items" && request.inboundPlanId === syntheticId(0)) {
        if (request.paginationToken) throw metadataRejection();
        return { items: [syntheticItem(0)], pagination: { nextToken: "late" } };
      }
    });
    const result = await h.run();
    expect(result).toMatchObject({ complete: false, traversalComplete: true, unavailablePlanCount: 1 });
    expect(result.records.map(record => record.sellerSku)).toEqual(["SYNTHETIC-FBA-1"]);
    expect(result.checkpoint?.currentPlan).toBeNull();
    expect(result.checkpoint?.unavailablePlans[0]?.diagnostic).toMatchObject({ operation: "plan-items", page: "next" });
    expect(await h.diagnostic(result.checkpoint)).toMatchObject({ planItemFallbackCount: 1, unavailablePlanCount: 1 });
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "plan-items", "plan-items", "plan", "plan-items"]);
  });

  it("counts only completed fallback sources, excluding a verified empty shipment manifest", async () => {
    const h = fallbackHarness([syntheticPlan(0), syntheticPlan(1)], request =>
      request.kind === "plan" && request.inboundPlanId === syntheticId(0) ? { ...syntheticPlan(0), shipments: [] } : undefined);
    const result = await h.run();
    expect(result).toMatchObject({ complete: true });
    const diagnostic = await h.diagnostic(result.checkpoint);
    expect(diagnostic).toMatchObject({ cachedPlanCount: 2, planItemFallbackCount: 1 });
    expect(JSON.stringify(diagnostic)).not.toContain("planDetailUnavailable");
  });

  it.each([401, 403, 429, 500, 503])("does not recover a metadata HTTP %s outside the allowed guard", async status => {
    const error = metadataRejection(status);
    const h = fallbackHarness(undefined, request => { if (request.kind === "plan") throw error; });
    await expect(h.run()).rejects.toBe(error);
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan"]);
  });

  it.each([
    { name: "404", error: unavailable(404) },
    { name: "422", error: metadataRejection(422) },
    { name: "generic error without parsed fields", error: unavailable() },
    { name: "InvalidInput", error: metadataRejection(400, { ...observedDiagnostic, code: "InvalidInput" }) },
    { name: "explicit malformed ID", error: metadataRejection(400, { ...observedDiagnostic, reason: "inbound-plan-id-malformed" }) },
    { name: "unclassified parsed error", error: metadataRejection(400, { state: "parsed", code: "unknown", reason: "unknown" }) },
    ...(["empty", "malformed", "oversize", "timed-out", "unavailable"] as const).map(state => ({
      name: `${state} body`, error: metadataRejection(400, { state, code: "unknown", reason: "unknown" }),
    })),
  ])("does not recover $name metadata evidence", async ({ error }) => {
    const h = fallbackHarness(undefined, request => { if (request.kind === "plan") throw error; });
    const result = await h.run();
    expect(result).toMatchObject({ complete: false, unavailablePlanCount: 1, records: [] });
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan"]);
    expect(await h.diagnostic(result.checkpoint)).not.toHaveProperty("planItemFallbackCount");
  });

  it.each([
    { name: "identity", detail: { ...syntheticPlan(0), inboundPlanId: syntheticId(99), shipments: [] } },
    { name: "revision", detail: { ...syntheticPlan(0), lastUpdatedAt: "2026-09-02T00:00:00Z", shipments: [] } },
    { name: "marketplace", detail: { ...syntheticPlan(0), marketplaceIds: ["A1F83G8C2ARO7P"], shipments: [] } },
    { name: "shipment shape", detail: { ...syntheticPlan(0), shipments: null } },
  ])("does not mask an inconsistent successful metadata $name with fallback", async ({ detail }) => {
    const h = fallbackHarness(undefined, request => request.kind === "plan" ? detail : undefined);
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan"]);
  });

  it.each(["context", "abort"] as const)("honors %s invalidation before considering metadata fallback", async kind => {
    const h = fallbackHarness(undefined, request => {
      if (request.kind === "plan") {
        if (kind === "context") h.context.invalidate("lock-screen");
        else h.abort.abort();
        throw metadataRejection();
      }
    });
    await expect(h.run()).rejects.toMatchObject(kind === "context" ? { code: "SP_CONTEXT_INVALIDATED" } : { name: "AbortError" });
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan"]);
  });

  it("does not turn a plan-list failure into an item-source attempt", async () => {
    const error = metadataRejection();
    const h = fallbackHarness(undefined, request => { if (request.kind === "plans") throw error; });
    await expect(h.run()).rejects.toBe(error);
    expect(h.calls.map(request => request.kind)).toEqual(["plans"]);
  });

  it("stops on malformed successful fallback items without continuing later plans", async () => {
    const h = fallbackHarness([syntheticPlan(0), syntheticPlan(1)], request => request.kind === "plan-items"
      ? { items: [{ ...syntheticItem(0), expiration: "2027-02-30" }] } : undefined);
    await expect(h.run()).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
    expect(h.calls.map(request => request.kind)).toEqual(["plans", "plan", "plan-items"]);
  });

  it.each((["cached", "current"] as const).flatMap(slot => (["non-true marker", "shipment source"] as const).map(change => ({ slot, change }))))
    ("rejects tampered $slot fallback provenance: $change", async ({ slot, change }) => {
      const producer = fallbackHarness(undefined, slot === "current" ? manyItemPages : undefined);
      const checkpoint = reopened((await producer.run()).checkpoint!);
      const target = slot === "cached" ? checkpoint.cachedPlans[0]! : checkpoint.currentPlan!;
      if (change === "non-true marker") Object.assign(target, { planDetailUnavailable: false });
      else Object.assign(target.itemSources[0]!, { shipmentId: syntheticId(0, "sh"), shipmentStatus: "SHIPPED" });
      const reader = fallbackHarness();
      await expect(reader.run(checkpoint)).rejects.toMatchObject({ code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
      expect(reader.calls).toEqual([]);
    });
});
