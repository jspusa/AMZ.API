import { describe, expect, it } from "vitest";
import { FbaExpiryReads, parseFbaExpiryCheckpoint } from "../src/main/amazon/fba-expiry-reads";
import { fbaInboundExternalReadIdentity } from "../src/main/amazon/fba-inbound-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER";
const planId = "wf1234abcd-1234-abcd-5678-1234abcd5678";
const plan = { inboundPlanId: planId, marketplaceIds: [US], createdAt: "2026-01-01T00:00:00Z", lastUpdatedAt: "2026-06-01T00:00:00Z", status: "SHIPPED" };
const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "test" }));
describe("FBA declared-expiry public read owner", () => {
  it("keeps a recognizable plan name and ID through checkpoint storage and an owner reopen", async () => {
    let name: string | undefined = "FBA September restock";
    let itemCalls = 0;
    const adapter = { async read(request: Parameters<typeof fbaInboundExternalReadIdentity>[0]) {
      const list = request.source === "modern" && request.request.kind === "plans";
      if (!list) itemCalls += 1;
      return { identity: fbaInboundExternalReadIdentity(request), requestId: null, envelope: list ? { inboundPlans: [{ ...plan, ...(name ? { name } : {}) }] }
        : { items: [{ msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 100, expiration: "2026-12-01" }] } };
    } };
    const captured = await context.capture(US);
    const first = await new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal });
    expect(first.records[0]).toMatchObject({ sourceLabel: `${name} · ${planId}` });
    const checkpoint = parseFbaExpiryCheckpoint(JSON.parse(JSON.stringify(first.checkpoint)))!;
    expect(checkpoint.cachedPlans[0]).toMatchObject({ name, records: [{ sourceLabel: `${name} · ${planId}` }] });
    const reopened = await new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal, checkpoint });
    expect(reopened.records).toEqual(first.records); expect(itemCalls).toBe(1);
    name = undefined;
    const unnamed = await new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal });
    expect(unnamed.records[0]).toMatchObject({ sourceLabel: `入庫計畫 · ${planId}` });
    const invalidLabel = structuredClone(checkpoint);
    Object.assign(invalidLabel.cachedPlans[0]!.records[0]!, { sourceLabel: "Unsafe\nlabel" });
    expect(() => parseFbaExpiryCheckpoint(invalidLabel)).toThrow();
    name = "x".repeat(401);
    await expect(new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal })).rejects.toThrow();
  });
  it.each([undefined, ""])("resumes bounded slices with name %j across owner reopen and reuses unchanged completed plans", async name => {
    const plans = Array.from({ length: 110 }, (_, index) => ({ ...plan, ...(name === undefined ? {} : { name }), inboundPlanId: `wf${String(index).padStart(8, "0")}-1234-abcd-5678-1234abcd5678` }));
    const seen: string[] = [];
    const adapter = { async read(request: Parameters<typeof fbaInboundExternalReadIdentity>[0]) {
      if (request.source !== "modern") throw new Error("Only modern reads");
      seen.push(request.request.kind);
      const offset = request.request.kind === "plans" ? Number(request.request.paginationToken ?? "0") : 0;
      return { identity: fbaInboundExternalReadIdentity(request), requestId: null, envelope: request.request.kind === "plans"
        ? { inboundPlans: plans.slice(offset, offset + 30), ...(offset + 30 < plans.length ? { pagination: { nextToken: String(offset + 30) } } : {}) }
        : { items: [{ msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 100, expiration: "2026-12-01" }] } };
    } };
    const captured = await context.capture(US);
    const first = await new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal });
    expect(first.complete).toBe(false); expect(seen).toHaveLength(100);
    expect(first.records.length).toBeGreaterThan(0);
    const checkpoint = parseFbaExpiryCheckpoint(JSON.parse(JSON.stringify(first.checkpoint)));
    const second = await new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal, checkpoint });
    expect(second.complete).toBe(true); expect(second.records).toHaveLength(110);
    expect(seen.filter(kind => kind === "plan-items")).toHaveLength(110);
    const before = seen.length;
    const fresh = await new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal, checkpoint: second.checkpoint });
    expect(fresh.complete).toBe(true); expect(fresh.records).toEqual(second.records);
    expect(seen.slice(before)).toEqual(["plans", "plans", "plans", "plans"]);
  });
  it("removes voided cached plans without inventing remaining inventory or re-reading their items", async () => {
    let status = "SHIPPED", itemCalls = 0;
    const reads = new FbaExpiryReads({ context, adapter: { async read(request) {
      const list = request.source === "modern" && request.request.kind === "plans";
      if (!list) itemCalls += 1;
      return { identity: fbaInboundExternalReadIdentity(request), requestId: null, envelope: list ? { inboundPlans: [{ ...plan, status }] }
        : { items: [{ msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 100, expiration: "2026-12-01" }] } };
    } } });
    const captured = await context.capture(US);
    const first = await reads.read({ context: captured, signal: new AbortController().signal });
    status = "VOIDED";
    const next = await reads.read({ context: captured, signal: new AbortController().signal, checkpoint: first.checkpoint });
    expect(next.complete).toBe(true); expect(next.records).toEqual([]); expect(itemCalls).toBe(1);
  });
  it.each([undefined, ""])("resumes item pages with plan name %j and publishes only after all pages complete", async name => {
    let itemCalls = 0;
    const adapter = { async read(request: Parameters<typeof fbaInboundExternalReadIdentity>[0]) {
      if (request.source !== "modern") throw new Error("Only modern reads");
      const index = request.request.kind === "plan-items" ? Number(request.request.paginationToken ?? "0") : 0;
      if (request.request.kind === "plan-items") itemCalls += 1;
      return { identity: fbaInboundExternalReadIdentity(request), requestId: null, envelope: request.request.kind === "plans" ? { inboundPlans: [{ ...plan, ...(name === undefined ? {} : { name }) }] }
        : { items: [{ msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 1, expiration: new Date(Date.UTC(2027, 0, index + 1)).toISOString().slice(0, 10) }], ...(index < 100 ? { pagination: { nextToken: String(index + 1) } } : {}) } };
    } };
    const captured = await context.capture(US);
    const first = await new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal });
    expect(first.complete).toBe(false); expect(first.records).toEqual([]);
    expect(first.checkpoint?.currentPlan?.records).toHaveLength(99);
    const next = await new FbaExpiryReads({ context, adapter }).read({ context: captured, signal: new AbortController().signal, checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) });
    expect(next.complete).toBe(true); expect(next.records).toHaveLength(101); expect(itemCalls).toBe(101);
  });
  it("reloads a changed plan revision and rejects checkpoints from another account or with manual quantities", async () => {
    let updated = plan.lastUpdatedAt, quantity = 100, itemCalls = 0;
    const adapter = { async read(request: Parameters<typeof fbaInboundExternalReadIdentity>[0]) {
      const list = request.source === "modern" && request.request.kind === "plans";
      if (!list) itemCalls += 1;
      return { identity: fbaInboundExternalReadIdentity(request), requestId: null, envelope: list ? { inboundPlans: [{ ...plan, lastUpdatedAt: updated }] }
        : { items: [{ msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity, expiration: "2026-12-01" }] } };
    } };
    const reads = new FbaExpiryReads({ context, adapter });
    const captured = await context.capture(US);
    const first = await reads.read({ context: captured, signal: new AbortController().signal });
    updated = "2026-06-02T00:00:00Z"; quantity = 200;
    const next = await reads.read({ context: captured, signal: new AbortController().signal, checkpoint: first.checkpoint });
    expect(next.records[0]).toMatchObject({ declaredQuantity: 200, sourceUpdatedAt: updated, confirmedRemaining: null }); expect(itemCalls).toBe(2);
    const tampered = structuredClone(next.checkpoint!); tampered.cachedPlans[0]!.records[0] = { ...tampered.cachedPlans[0]!.records[0]!, confirmedRemaining: 200 };
    expect(() => parseFbaExpiryCheckpoint(tampered)).toThrow();
    const otherContext = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "different" }));
    await expect(new FbaExpiryReads({ context: otherContext, adapter }).read({ context: await otherContext.capture(US), signal: new AbortController().signal, checkpoint: next.checkpoint })).rejects.toThrow();
    expect(itemCalls).toBe(2);
  });
  it("rejects a repeated nonempty pagination token with otherwise valid distinct items", async () => {
    let page = 0;
    const reads = new FbaExpiryReads({ context, adapter: { async read(request) {
      const list = request.source === "modern" && request.request.kind === "plans";
      if (!list) page += 1;
      return { identity: fbaInboundExternalReadIdentity(request), requestId: null, envelope: list ? { inboundPlans: [plan] }
        : { items: [{ msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 100, expiration: `2026-12-0${page}` }], pagination: { nextToken: "same" } } };
    } } });
    await expect(reads.read({ context: await context.capture(US), signal: new AbortController().signal })).rejects.toThrow();
    expect(page).toBe(2);
  });
  it("reads all item pages, keeps separate dates, and never invents remaining quantities", async () => {
    const seen: string[] = [];
    const reads = new FbaExpiryReads({ context, adapter: { async read(request) {
      if (request.source !== "modern") throw new Error("Only modern reads");
      seen.push(request.request.kind);
      const token = "paginationToken" in request.request && request.request.paginationToken;
      return { identity: fbaInboundExternalReadIdentity(request), requestId: null,
        envelope: request.request.kind === "plans" ? { inboundPlans: [plan] }
          : { items: [{ msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 100, expiration: token ? "2027-02-01" : "2026-12-01" }], ...(token ? {} : { pagination: { nextToken: "page-two" } }) } };
    } } });
    const result = await reads.read({ context: await context.capture(US), signal: new AbortController().signal });
    expect(seen).toEqual(["plans", "plan-items", "plan-items"]);
    expect(result.complete).toBe(true);
    expect(result.records.map(r => r.expiryDate)).toEqual(["2026-12-01", "2027-02-01"]);
    expect(result.records.every(r => r.confirmedRemaining === null)).toBe(true);
    expect(result.records.every(r => !r.sourceRef.includes(planId))).toBe(true);
  });
  it("never converts malformed expiry to no risk", async () => {
    const reads = new FbaExpiryReads({ context, adapter: { async read(request) {
      return { identity: fbaInboundExternalReadIdentity(request), requestId: null,
        envelope: request.source === "modern" && request.request.kind === "plans" ? { inboundPlans: [plan] }
          : { items: [{ msku: "FBA-ONE", asin: "B000000001", fnsku: "X000000001", quantity: 100, expiration: "2026-02-31" }], pagination: { nextToken: "same" } } };
    } } });
    await expect(reads.read({ context: await context.capture(US), signal: new AbortController().signal })).rejects.toThrow();
  });
});
