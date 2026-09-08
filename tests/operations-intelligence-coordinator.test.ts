import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationsIntelligenceCoordinator } from "../src/main/operations-intelligence-coordinator";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import type { OperationsData, OperationsIntelligenceSnapshot } from "../src/shared/operations-intelligence";

const US = "ATVPDKIKX0DER";
const owners: OperationsIntelligenceCoordinator[] = [];
afterEach(() => { owners.forEach((owner) => owner.clear()); owners.length = 0; vi.useRealTimers(); });
function request(method: "GET" | "POST", body: Record<string, unknown> = {}): ApiRequest {
  return { requestId: crypto.randomUUID(), method, path: "/api/operations-intelligence", headers: {},
    query: method === "GET" ? { marketplaceId: US } : {},
    ...(method === "POST" ? { body: { kind: "json" as const, value: { marketplaceId: US, source: "awd", ...body } } } : {}) };
}
function data(response: ApiResponse): OperationsIntelligenceSnapshot {
  if (response.body.kind !== "json") throw new Error("Expected JSON");
  return response.body.value as OperationsIntelligenceSnapshot;
}
function fixture(): OperationsData {
  return { marketplaceId: US, mode: "live", fetchedAt: "2026-09-08T01:00:00.000Z", coverage: "complete", warnings: [], findings: [],
    rows: [], shipments: [], excludedInventoryRows: 0, inventoryCoverage: "complete", shipmentCoverage: "complete", stockScope: "AWD_SHARED_DOWNSTREAM" } as OperationsData;
}
function setup(read: () => Promise<OperationsData> = async () => fixture()) {
  let scope = "test-account-a";
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: scope }));
  const owner = new OperationsIntelligenceCoordinator({ context, readers: {
    fba: async () => [{ sellerSku: "TEST-FBA", asin: "B000000001" }], read,
  } });
  owners.push(owner);
  return { owner, context, switchAccount: () => { scope = "test-account-b"; } };
}
describe("operations intelligence public coordinator", () => {
  it("observes an unsynchronized state without requesting upstream data", async () => {
    const { owner } = setup(async () => { throw new Error("observe must not sync"); });
    const snapshot = data(await owner.observe(request("GET")));
    expect(snapshot.sources.awd.status).toBe("never");
    expect(snapshot.events).toEqual([]);
    expect(snapshot.autoSync).toBe(false);
    expect(snapshot.notice).toContain("非 Amazon 推播");
  });
  it("starts one flight, reconnects duplicate starts and publishes actual source evidence", async () => {
    let finish!: (value: OperationsData) => void;
    const pending = new Promise<OperationsData>((resolve) => { finish = resolve; });
    const { owner } = setup(() => pending);
    const initial = data(await owner.start(request("POST")));
    const duplicate = data(await owner.start(request("POST")));
    expect(initial.sources.awd.status).toBe("running");
    expect(duplicate.sources.awd.startedAt).toBe(initial.sources.awd.startedAt);
    finish(fixture());
    await vi.waitFor(async () => {
      const snapshot = data(await owner.observe(request("GET")));
      expect(snapshot.sources.awd.status).toBe("complete");
      expect(snapshot.sources.awd.fetchedAt).toBe("2026-09-08T01:00:00.000Z");
    });
  });
  it("configures automatic sync without implicitly starting unrequested sources", async () => {
    const { owner } = setup();
    const configured = data(await owner.start(request("POST", { source: undefined, autoSync: true })));
    expect(configured.autoSync).toBe(true);
    expect(configured.sources.awd.status).toBe("never");
    await owner.start(request("POST"));
    await vi.waitFor(async () => expect(data(await owner.observe(request("GET"))).sources.awd.nextSyncAt).not.toBeNull());
    const disabled = data(await owner.start(request("POST", { source: undefined, autoSync: false })));
    expect(disabled.autoSync).toBe(false);
    expect(disabled.sources.awd.nextSyncAt).toBeNull();
  });
  it("acknowledges only current-session events without changing upstream state", async () => {
    const { owner } = setup(async () => ({ ...fixture(), findings: [{ source: "awd", key: "awd-gap", sellerSku: "TEST-FBA", severity: "warning", title: "需核對庫存", detail: "來源尚未完成。" }] }));
    await owner.start(request("POST"));
    let eventId = "";
    await vi.waitFor(async () => { eventId = data(await owner.observe(request("GET"))).events[0]?.id; expect(eventId).toBeTruthy(); });
    const ack = request("POST");
    ack.body = { kind: "json", value: { marketplaceId: US, eventId, status: "acknowledged" } };
    expect(data(await owner.acknowledge(ack)).events[0].status).toBe("acknowledged");
    owner.clear();
    expect((await owner.acknowledge(ack)).status).toBe(404);
  });
  it("discards a late previous-account completion and resets local scheduling", async () => {
    let finish!: (value: OperationsData) => void;
    const { owner, switchAccount } = setup(() => new Promise((resolve) => { finish = resolve; }));
    const previous = data(await owner.start(request("POST", { autoSync: true })));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    switchAccount();
    const current = data(await owner.observe(request("GET")));
    expect(current.contextId).not.toBe(previous.contextId);
    expect(current.autoSync).toBe(false);
    finish(fixture());
    await Promise.resolve();
    expect(data(await owner.observe(request("GET"))).sources.awd).toMatchObject({ status: "never", snapshot: null });
  });
  it("retains last known evidence on failure and stops scheduled retries", async () => {
    let failure = false;
    const { owner } = setup(async () => { if (failure) throw new Error("secret external failure"); return fixture(); });
    await owner.start(request("POST", { autoSync: true }));
    await vi.waitFor(async () => expect(data(await owner.observe(request("GET"))).sources.awd.status).toBe("complete"));
    failure = true;
    await owner.start(request("POST"));
    await vi.waitFor(async () => {
      const snapshot = data(await owner.observe(request("GET")));
      expect(snapshot.sources.awd).toMatchObject({ status: "failed", fetchedAt: fixture().fetchedAt, snapshot: fixture(), nextSyncAt: null });
      expect(snapshot.events[0].title).toBe("同步未完成");
      expect(JSON.stringify(snapshot)).not.toContain("secret external failure");
    });
  });
  it("isolates all-source failures while sharing the FBA identity read", async () => {
    let identities = 0;
    const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "test-account" }));
    const owner = new OperationsIntelligenceCoordinator({ context, readers: {
      fba: async () => { identities += 1; return []; },
      read: async (source) => { if (source === "promotions") throw new Error("permission denied"); return fixture(); },
    } });
    owners.push(owner);
    await owner.start(request("POST", { source: "all" }));
    await vi.waitFor(async () => {
      const snapshot = data(await owner.observe(request("GET")));
      expect(snapshot.sources.promotions.status).toBe("failed");
      expect(snapshot.sources.awd.status).toBe("complete");
      expect(snapshot.sources["price-health"].status).toBe("complete");
      expect(snapshot.sources.advertising.status).toBe("complete");
    });
    expect(identities).toBe(1);
  });
  it("publishes immutable evidence even if the source later mutates its object", async () => {
    const upstream = fixture();
    const { owner } = setup(async () => upstream);
    await owner.start(request("POST"));
    await vi.waitFor(async () => expect(data(await owner.observe(request("GET"))).sources.awd.status).toBe("complete"));
    (upstream as { fetchedAt: string }).fetchedAt = "invalid late mutation";
    expect(data(await owner.observe(request("GET"))).sources.awd.snapshot?.fetchedAt).toBe("2026-09-08T01:00:00.000Z");
  });
  it("runs only opted-in started sources on schedule and cancels on clear", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-08T12:00:00.000Z");
    let reads = 0;
    const { owner } = setup(async () => { reads += 1; return { ...fixture(), fetchedAt: new Date().toISOString() }; });
    await owner.start(request("POST", { autoSync: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toBe(1);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(reads).toBe(2);
    expect(data(await owner.observe(request("GET"))).sources.promotions.status).toBe("never");
    owner.clear();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(reads).toBe(2);
    expect(data(await owner.observe(request("GET"))).autoSync).toBe(false);
  });
});
