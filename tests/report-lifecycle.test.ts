import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DurableReportLifecycle,
  type DurableReportIdentity,
  type DurableReportStatus,
} from "../src/main/amazon/report-lifecycle";
import { SpApiError } from "../src/main/amazon/sp-api";
import { LocalStore } from "../src/main/local-store";

const identity: DurableReportIdentity = {
  accountScope: "account-a",
  marketplaceId: "ATVPDKIKX0DER",
  mode: "live",
  reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
  optionsKey: "marketplaceIds=selected",
};

function queued(reportId = "aged-report-1"): DurableReportStatus {
  return {
    mode: "live",
    ready: false,
    reportId,
    documentId: null,
    status: "IN_QUEUE",
    notice: "queued",
  };
}

async function createStore(): Promise<LocalStore> {
  const directory = await mkdtemp(join(tmpdir(), "amz-report-lifecycle-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  return store;
}

describe("durable report lifecycle", () => {
  it("single-flights an exact report identity and reuses it after a process restart", async () => {
    const store = await createStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const create = vi.fn(async () => {
      await gate;
      return queued();
    });
    const firstBroker = new DurableReportLifecycle(store);

    const first = firstBroker.start({ identity, explicitRetry: false, create });
    const second = firstBroker.start({ identity, explicitRetry: true, create });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ reportId: "aged-report-1", status: "IN_QUEUE" }),
      expect.objectContaining({ reportId: "aged-report-1", status: "IN_QUEUE" }),
    ]);

    const restarted = new DurableReportLifecycle(store);
    await expect(restarted.start({ identity, explicitRetry: false, create }))
      .resolves.toMatchObject({ reportId: "aged-report-1", status: "IN_QUEUE" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps creation-unknown durable and requires an explicit guarded retry", async () => {
    let now = Date.parse("2026-08-17T00:00:00.000Z");
    const store = await createStore();
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("connection closed after POST"))
      .mockResolvedValueOnce(queued("aged-report-2"));
    const broker = new DurableReportLifecycle(store, { now: () => now });

    await expect(broker.start({ identity, explicitRetry: false, create }))
      .rejects.toThrow("connection closed after POST");
    await expect(new DurableReportLifecycle(store, { now: () => now }).start({
      identity,
      explicitRetry: false,
      create,
    })).rejects.toMatchObject({ code: "SHARED_REPORT_RETRY_REQUIRED" });
    await expect(broker.start({ identity, explicitRetry: true, create }))
      .rejects.toMatchObject({ code: "REPORT_RETRY_WAIT" });
    expect(create).toHaveBeenCalledTimes(1);

    now += 30 * 60 * 1_000 + 1;
    await expect(new DurableReportLifecycle(store, { now: () => now }).start({
      identity,
      explicitRetry: true,
      create,
    })).resolves.toMatchObject({ reportId: "aged-report-2" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not let an aborted waiter cancel the valid shared create flight", async () => {
    const store = await createStore();
    const broker = new DurableReportLifecycle(store);
    const waiter = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const create = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      expect(signal.aborted).toBe(false);
      await gate;
      return queued();
    });

    const cancelled = broker.start({
      identity,
      explicitRetry: false,
      signal: waiter.signal,
      create,
    });
    const survivor = broker.start({ identity, explicitRetry: false, create });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    waiter.abort(new Error("drawer closed"));
    await expect(cancelled).rejects.toThrow("drawer closed");
    release();
    await expect(survivor).resolves.toMatchObject({
      reportId: "aged-report-1",
      status: "IN_QUEUE",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("persists terminal status and prevents automatic recreation", async () => {
    const store = await createStore();
    const create = vi.fn(async () => queued());
    const broker = new DurableReportLifecycle(store);
    await broker.start({ identity, explicitRetry: false, create });
    const poll = vi.fn(async () => {
      throw new SpApiError("Amazon cancelled", {
        status: 422,
        code: "REPORT_CANCELLED",
      });
    });

    await expect(broker.status({ identity, reportId: "aged-report-1", poll }))
      .rejects.toMatchObject({ code: "REPORT_CANCELLED" });
    await expect(new DurableReportLifecycle(store).start({
      identity,
      explicitRetry: false,
      create,
    })).rejects.toMatchObject({ code: "REPORT_CANCELLED" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("persists a terminal create response with its report ID", async () => {
    const store = await createStore();
    const broker = new DurableReportLifecycle(store);
    const create = vi.fn(async () => ({
      mode: "live" as const,
      ready: false,
      reportId: "aged-cancelled-1",
      documentId: null,
      status: "CANCELLED" as const,
      notice: "cancelled",
    }));

    await expect(broker.start({ identity, explicitRetry: false, create }))
      .rejects.toMatchObject({ code: "REPORT_CANCELLED" });
    await expect(new DurableReportLifecycle(store).start({
      identity,
      explicitRetry: false,
      create,
    })).rejects.toMatchObject({ code: "REPORT_CANCELLED" });
    await expect(store.getSharedReport(identity)).resolves.toMatchObject({
      report: {
        reportId: "aged-cancelled-1",
        status: "CANCELLED",
        terminal: "CANCELLED",
      },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps DONE monotonic when a slower poll returns IN_PROGRESS", async () => {
    const store = await createStore();
    const broker = new DurableReportLifecycle(store);
    await broker.start({
      identity,
      explicitRetry: false,
      create: async () => queued(),
    });
    let resolveFirst!: (value: DurableReportStatus) => void;
    const firstPoll = new Promise<DurableReportStatus>((resolve) => {
      resolveFirst = resolve;
    });
    const poll = vi.fn()
      .mockImplementationOnce(async () => firstPoll)
      .mockResolvedValueOnce({
        ...queued(),
        ready: true,
        status: "DONE",
        documentId: "aged-document-1",
      });

    const stale = new DurableReportLifecycle(store).status({
      identity,
      reportId: "aged-report-1",
      poll,
    });
    const done = await new DurableReportLifecycle(store).status({
      identity,
      reportId: "aged-report-1",
      poll,
    });
    resolveFirst({ ...queued(), status: "IN_PROGRESS" });

    await expect(stale).resolves.toEqual(done);
    expect(done).toMatchObject({ status: "DONE", documentId: "aged-document-1" });
  });

  it("reuses DONE by default but safely creates a fresh report when explicitly requested", async () => {
    const store = await createStore();
    const broker = new DurableReportLifecycle(store);
    let sequence = 0;
    const create = vi.fn(async () => {
      sequence += 1;
      return {
        ...queued(`aged-report-${sequence}`),
        ready: true,
        status: "DONE" as const,
        documentId: `aged-document-${sequence}`,
      };
    });

    await expect(broker.start({ identity, explicitRetry: false, create }))
      .resolves.toMatchObject({ reportId: "aged-report-1" });
    await expect(broker.start({ identity, explicitRetry: false, create }))
      .resolves.toMatchObject({ reportId: "aged-report-1" });
    await expect(broker.start({
      identity,
      explicitRetry: true,
      freshCompleted: true,
      create,
    })).resolves.toMatchObject({
      reportId: "aged-report-2",
      documentId: "aged-document-2",
    });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
