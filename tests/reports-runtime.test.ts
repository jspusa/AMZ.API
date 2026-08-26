import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/main/local-store";
import { DurableReportLifecycle } from "../src/main/amazon/report-lifecycle";
import {
  createScriptedReportsAdapter,
  ReportsRuntime,
  reportsAdapterIdentity,
  reportsDurableIdentity,
  type ReportsAdapter,
  type ReportsIntentPlan,
} from "../src/main/amazon/reports-runtime";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;
const FIXED_PLANS = [
  { intent: "all-listings", marketplaceId: US },
  { intent: "active-business-listings", marketplaceId: US },
  { intent: "aged-inventory", marketplaceId: US },
  { intent: "inbound-noncompliance", marketplaceId: US },
  {
    intent: "sales-and-traffic-daily-sku",
    marketplaceId: US,
    startDate: "2026-08-01",
    endDate: "2026-08-20",
  },
  {
    intent: "fba-shipment-sales",
    marketplaceId: US,
    startDate: "2026-08-01",
    endDate: "2026-08-20",
    dataStartTime: "2026-08-01T00:00:00-07:00",
    dataEndTime: "2026-08-21T00:00:00-07:00",
    windowCreatedAt: Date.parse("2026-08-20T12:00:00.000Z"),
  },
] as const satisfies readonly ReportsIntentPlan[];

async function createStore(): Promise<LocalStore> {
  const directory = await mkdtemp(join(tmpdir(), "amz-reports-runtime-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  return store;
}

function context() {
  return createScriptedSpExecutionContextAdapter((marketplaceId) => ({
    marketplaceId,
    mode: "live",
    accountScope: "opaque-reports-account",
  }));
}

function runtime(store: LocalStore, adapter: ReportsAdapter) {
  return new ReportsRuntime({
    store,
    adapter,
    context: context(),
    lifecycle: new DurableReportLifecycle(store),
  });
}

function delaySharedReportRead(store: LocalStore, readNumber: number): Readonly<{
  started: Promise<void>;
  release(): void;
}> {
  const original = store.getSharedReport.bind(store);
  let readCount = 0;
  let markStarted!: () => void;
  let releaseRead!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  vi.spyOn(store, "getSharedReport").mockImplementation(async (input) => {
    readCount += 1;
    if (readCount === readNumber) {
      markStarted();
      await blocked;
    }
    return original(input);
  });
  return { started, release: releaseRead };
}

function abortGate(): Readonly<{
  started: Promise<void>;
  wait(signal: AbortSignal): Promise<never>;
}> {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return {
    started,
    wait(signal) {
      markStarted();
      return new Promise<never>((_resolve, reject) => {
        const rejectFromAbort = () => reject(
          signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
        if (signal.aborted) {
          rejectFromAbort();
          return;
        }
        signal.addEventListener("abort", rejectFromAbort, { once: true });
      });
    },
  };
}

function releaseGate(): Readonly<{
  started: Promise<void>;
  release(): void;
  wait(): Promise<void>;
}> {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    started,
    release,
    wait() {
      markStarted();
      return blocked;
    },
  };
}

describe("fixed Reports runtime", () => {
  it("maps a semantic intent to one durable lease and never exposes Amazon identifiers", async () => {
    const store = await createStore();
    const adapter = createScriptedReportsAdapter([{
      operation: "create",
      result: {
        mode: "live",
        ready: false,
        reportId: "AMAZON-RAW-REPORT-1",
        documentId: null,
        status: "IN_QUEUE",
        notice: "queued",
      },
    }]);
    const plan = {
      intent: "all-listings" as const,
      marketplaceId: US,
      path: "/arbitrary",
      method: "DELETE",
      reportType: "ARBITRARY_REPORT",
      signedUrl: "https://evil.example/document",
    };

    const receipt = await runtime(store, adapter).start(plan, {
      explicitRetry: false,
    });

    expect(receipt).toMatchObject({
      mode: "live",
      ready: false,
      status: "IN_QUEUE",
      documentId: null,
    });
    expect(receipt.reportId).toMatch(/^report-lease\.[A-Za-z0-9._-]+$/u);
    expect(JSON.stringify(receipt)).not.toContain("AMAZON-RAW-REPORT-1");
    expect(adapter.requests).toEqual([{
      operation: "create",
      intent: "all-listings",
      marketplaceId: US,
      mode: "live",
    }]);
    expect(JSON.stringify(adapter.requests)).not.toMatch(
      /arbitrary|DELETE|evil\.example/u,
    );

    const identity = reportsDurableIdentity({
      accountScope: "opaque-reports-account" as never,
      marketplaceId: US,
      mode: "live",
    }, plan);
    await expect(store.getSharedReport(identity)).resolves.toMatchObject({
      report: { reportId: "AMAZON-RAW-REPORT-1" },
    });
  });

  it("polls and downloads by opaque handles while the adapter alone receives raw IDs", async () => {
    const store = await createStore();
    const adapter = createScriptedReportsAdapter([
      {
        operation: "create",
        result: {
          mode: "live",
          ready: false,
          reportId: "AMAZON-RAW-REPORT-2",
          documentId: null,
          status: "IN_QUEUE",
          notice: "queued",
        },
      },
      {
        operation: "status",
        result: {
          mode: "live",
          ready: true,
          reportId: "AMAZON-RAW-REPORT-2",
          documentId: "AMAZON-RAW-DOCUMENT-2",
          status: "DONE",
          notice: "done",
        },
      },
      {
        operation: "document",
        result: { text: "seller-sku\tasin\nSKU-1\tB000000001" },
      },
    ]);
    const reports = runtime(store, adapter);
    const plan = { intent: "aged-inventory" as const, marketplaceId: US };
    const started = await reports.start(plan, { explicitRetry: false });
    const done = await reports.status(plan, started.reportId);

    expect(done.reportId).toBe(started.reportId);
    expect(done.documentId).toMatch(/^report-document\.[A-Za-z0-9._-]+$/u);
    expect(JSON.stringify(done)).not.toMatch(/AMAZON-RAW/u);
    await expect(reports.readDocument(plan, {
      reportId: done.reportId,
      documentId: done.documentId!,
    })).resolves.toEqual({
      mode: "live",
      text: "seller-sku\tasin\nSKU-1\tB000000001",
    });
    expect(adapter.requests.slice(1)).toMatchObject([
      { operation: "status", reportId: "AMAZON-RAW-REPORT-2" },
      {
        operation: "document",
        reportId: "AMAZON-RAW-REPORT-2",
        documentId: "AMAZON-RAW-DOCUMENT-2",
      },
    ]);
  });

  it("rejects a stale start receipt when context invalidates during its final durable read", async () => {
    const store = await createStore();
    const adapter = createScriptedReportsAdapter([{
      operation: "create",
      result: {
        mode: "live",
        ready: false,
        reportId: "AMAZON-RAW-START-RACE",
        documentId: null,
        status: "IN_QUEUE",
        notice: "queued",
      },
    }]);
    const executionContext = context();
    const reports = new ReportsRuntime({
      store,
      adapter,
      context: executionContext,
      lifecycle: new DurableReportLifecycle(store),
    });
    const finalRead = delaySharedReportRead(store, 2);

    const pending = reports.start(
      { intent: "all-listings", marketplaceId: US },
      { explicitRetry: false },
    );
    await finalRead.started;
    executionContext.invalidate("account-changed");
    finalRead.release();

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("rejects a stale status receipt when context invalidates during its final durable read", async () => {
    const store = await createStore();
    const adapter = createScriptedReportsAdapter([
      {
        operation: "create",
        result: {
          mode: "live",
          ready: false,
          reportId: "AMAZON-RAW-STATUS-RACE",
          documentId: null,
          status: "IN_QUEUE",
          notice: "queued",
        },
      },
      {
        operation: "status",
        result: {
          mode: "live",
          ready: true,
          reportId: "AMAZON-RAW-STATUS-RACE",
          documentId: "AMAZON-RAW-STATUS-RACE-DOCUMENT",
          status: "DONE",
          notice: "done",
        },
      },
    ]);
    const executionContext = context();
    const reports = new ReportsRuntime({
      store,
      adapter,
      context: executionContext,
      lifecycle: new DurableReportLifecycle(store),
    });
    const started = await reports.start(
      { intent: "all-listings", marketplaceId: US },
      { explicitRetry: false },
    );
    const finalRead = delaySharedReportRead(store, 2);

    const pending = reports.status(
      { intent: "all-listings", marketplaceId: US },
      started.reportId,
    );
    await finalRead.started;
    executionContext.invalidate("account-changed");
    finalRead.release();

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("keeps create outcome unknown while returning the context fence when invalidation aborts the adapter", async () => {
    const store = await createStore();
    const gate = abortGate();
    const adapter: ReportsAdapter = {
      create: ({ signal }) => gate.wait(signal),
      async status() {
        throw new Error("status must not run");
      },
      async readDocument() {
        throw new Error("document must not run");
      },
    };
    const executionContext = context();
    const lifecycle = new DurableReportLifecycle(store);
    const reports = new ReportsRuntime({
      store,
      adapter,
      context: executionContext,
      lifecycle,
    });
    const plan = { intent: "all-listings" as const, marketplaceId: US };

    const pending = reports.start(plan, { explicitRetry: false });
    await gate.started;
    executionContext.invalidate("account-changed");
    reports.clear();

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
    const identity = reportsDurableIdentity({
      accountScope: "opaque-reports-account" as never,
      marketplaceId: US,
      mode: "live",
    }, plan);
    await expect(store.getSharedReport(identity)).resolves.toMatchObject({
      report: {
        status: "CREATION_UNKNOWN",
        terminal: "CREATION_UNKNOWN",
      },
    });
  });

  it("keeps the context fence when create resolves successfully after ignoring invalidation abort", async () => {
    const store = await createStore();
    let markCreateStarted!: () => void;
    let releaseCreate!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    const blockedCreate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const adapter: ReportsAdapter = {
      async create(request) {
        markCreateStarted();
        await blockedCreate;
        return {
          identity: reportsAdapterIdentity(request, request.mode),
          mode: "live",
          ready: false,
          reportId: "AMAZON-RAW-CREATE-IGNORED-ABORT",
          documentId: null,
          status: "IN_QUEUE",
          notice: "queued",
        };
      },
      async status() {
        throw new Error("status must not run");
      },
      async readDocument() {
        throw new Error("document must not run");
      },
    };
    const executionContext = context();
    const reports = new ReportsRuntime({
      store,
      adapter,
      context: executionContext,
      lifecycle: new DurableReportLifecycle(store),
    });
    const plan = { intent: "all-listings" as const, marketplaceId: US };

    const pending = reports.start(plan, { explicitRetry: false });
    await createStarted;
    executionContext.invalidate("account-changed");
    reports.clear();
    releaseCreate();

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
    const identity = reportsDurableIdentity({
      accountScope: "opaque-reports-account" as never,
      marketplaceId: US,
      mode: "live",
    }, plan);
    await expect(store.getSharedReport(identity)).resolves.toMatchObject({
      report: {
        status: "CREATION_UNKNOWN",
        terminal: "CREATION_UNKNOWN",
      },
    });
  });

  it("reasserts context when a create caller signal rejects before the shared flight", async () => {
    const store = await createStore();
    const gate = releaseGate();
    const adapter: ReportsAdapter = {
      async create(request) {
        await gate.wait();
        return {
          identity: reportsAdapterIdentity(request, request.mode),
          mode: "live",
          ready: false,
          reportId: "AMAZON-RAW-CREATE-CALLER-ABORT",
          documentId: null,
          status: "IN_QUEUE",
          notice: "queued",
        };
      },
      async status() {
        throw new Error("status must not run");
      },
      async readDocument() {
        throw new Error("document must not run");
      },
    };
    const executionContext = context();
    const reports = new ReportsRuntime({
      store,
      adapter,
      context: executionContext,
      lifecycle: new DurableReportLifecycle(store),
    });
    const controller = new AbortController();
    const plan = {
      intent: "all-listings" as const,
      marketplaceId: US,
      signal: controller.signal,
    };

    const pending = reports.start(plan, { explicitRetry: false });
    await gate.started;
    executionContext.invalidate("account-changed");
    reports.clear();
    controller.abort(new Error("caller cleanup won the create race"));
    gate.release();

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("returns the context fence when invalidation aborts a status adapter call", async () => {
    const store = await createStore();
    const gate = abortGate();
    const adapter: ReportsAdapter = {
      async create(request) {
        return {
          identity: reportsAdapterIdentity(request, request.mode),
          mode: "live",
          ready: false,
          reportId: "AMAZON-RAW-STATUS-ABORT-RACE",
          documentId: null,
          status: "IN_QUEUE",
          notice: "queued",
        };
      },
      status: ({ signal }) => gate.wait(signal),
      async readDocument() {
        throw new Error("document must not run");
      },
    };
    const executionContext = context();
    const reports = new ReportsRuntime({
      store,
      adapter,
      context: executionContext,
      lifecycle: new DurableReportLifecycle(store),
    });
    const plan = { intent: "all-listings" as const, marketplaceId: US };
    const started = await reports.start(plan, { explicitRetry: false });

    const pending = reports.status(plan, started.reportId);
    await gate.started;
    executionContext.invalidate("account-changed");
    reports.clear();

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("reasserts context when a status caller signal rejects before the shared flight", async () => {
    const store = await createStore();
    const gate = releaseGate();
    const adapter: ReportsAdapter = {
      async create(request) {
        return {
          identity: reportsAdapterIdentity(request, request.mode),
          mode: "live",
          ready: false,
          reportId: "AMAZON-RAW-STATUS-CALLER-ABORT",
          documentId: null,
          status: "IN_QUEUE",
          notice: "queued",
        };
      },
      async status(request) {
        await gate.wait();
        return {
          identity: reportsAdapterIdentity(request, request.mode),
          mode: "live",
          ready: true,
          reportId: request.reportId,
          documentId: "AMAZON-RAW-STATUS-CALLER-ABORT-DOCUMENT",
          status: "DONE",
          notice: "done",
        };
      },
      async readDocument() {
        throw new Error("document must not run");
      },
    };
    const executionContext = context();
    const reports = new ReportsRuntime({
      store,
      adapter,
      context: executionContext,
      lifecycle: new DurableReportLifecycle(store),
    });
    const plan = { intent: "all-listings" as const, marketplaceId: US };
    const started = await reports.start(plan, { explicitRetry: false });
    const controller = new AbortController();

    const pending = reports.status(
      { ...plan, signal: controller.signal },
      started.reportId,
    );
    await gate.started;
    executionContext.invalidate("account-changed");
    reports.clear();
    controller.abort(new Error("caller cleanup won the status race"));
    gate.release();

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("returns the context fence when invalidation aborts a document adapter call", async () => {
    const store = await createStore();
    const gate = abortGate();
    const adapter: ReportsAdapter = {
      async create(request) {
        return {
          identity: reportsAdapterIdentity(request, request.mode),
          mode: "live",
          ready: true,
          reportId: "AMAZON-RAW-DOCUMENT-ABORT-RACE",
          documentId: "AMAZON-RAW-DOCUMENT-ABORT-RACE-DOCUMENT",
          status: "DONE",
          notice: "done",
        };
      },
      async status() {
        throw new Error("status must not run");
      },
      readDocument: ({ signal }) => gate.wait(signal),
    };
    const executionContext = context();
    const reports = new ReportsRuntime({
      store,
      adapter,
      context: executionContext,
      lifecycle: new DurableReportLifecycle(store),
    });
    const controller = new AbortController();
    const plan = { intent: "all-listings" as const, marketplaceId: US };
    const completed = await reports.start(plan, { explicitRetry: false });

    const pending = reports.readDocument(
      { ...plan, signal: controller.signal },
      {
        reportId: completed.reportId,
        documentId: completed.documentId!,
      },
    );
    await gate.started;
    executionContext.invalidate("account-changed");
    controller.abort(new Error("context cleanup aborted the document read"));

    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it.each(FIXED_PLANS)(
    "$intent reads a completed document without another create or status request",
    async (plan) => {
      const store = await createStore();
      const adapter = createScriptedReportsAdapter([
        {
          operation: "create",
          result: {
            mode: "live",
            ready: true,
            reportId: `AMAZON-RAW-${plan.intent}-REPORT`,
            documentId: `AMAZON-RAW-${plan.intent}-DOCUMENT`,
            status: "DONE",
            notice: "done",
          },
        },
        {
          operation: "document",
          result: { text: `${plan.intent}-document` },
        },
      ]);
      const reports = runtime(store, adapter);
      const completed = await reports.start(plan, { explicitRetry: false });

      expect(completed.ready).toBe(true);
      expect(completed.documentId).toMatch(/^report-document\./u);
      const requestCountBeforeRead = adapter.requests.length;
      await expect(reports.readDocument(plan, {
        reportId: completed.reportId,
        documentId: completed.documentId!,
      })).resolves.toEqual({
        mode: "live",
        text: `${plan.intent}-document`,
      });
      expect(adapter.requests.slice(requestCountBeforeRead)).toMatchObject([
        { operation: "document", intent: plan.intent },
      ]);
    },
  );

  it("reads a compatible durable lease without turning the read into a create", async () => {
    const store = await createStore();
    const firstAdapter = createScriptedReportsAdapter([{
      operation: "create",
      result: {
        mode: "live",
        ready: false,
        reportId: "AMAZON-RAW-REPORT-3",
        documentId: null,
        status: "IN_PROGRESS",
        notice: "working",
      },
    }]);
    const plan = { intent: "inbound-noncompliance" as const, marketplaceId: US };
    const first = await runtime(store, firstAdapter).start(plan, {
      explicitRetry: false,
    });
    const readOnlyAdapter = createScriptedReportsAdapter([]);

    const reused = await runtime(store, readOnlyAdapter).read(plan);

    expect(reused).toMatchObject({
      reportId: first.reportId,
      status: "IN_PROGRESS",
    });
    expect(readOnlyAdapter.requests).toEqual([]);
  });

  it("keeps create-unknown durable and never recreates it through read", async () => {
    const store = await createStore();
    const create = vi.fn(async () => {
      throw new Error("connection closed after POST");
    });
    const adapter: ReportsAdapter = {
      create,
      status: vi.fn(),
      readDocument: vi.fn(),
    };
    const plan = { intent: "aged-inventory" as const, marketplaceId: US };

    await expect(runtime(store, adapter).start(plan, { explicitRetry: false }))
      .rejects.toThrow("connection closed after POST");
    const restartedAdapter = createScriptedReportsAdapter([]);
    await expect(runtime(store, restartedAdapter).read(plan)).rejects.toMatchObject({
      code: "SHARED_REPORT_RETRY_REQUIRED",
    });
    expect(create).toHaveBeenCalledOnce();
    expect(restartedAdapter.requests).toEqual([]);
  });

  it("binds required selection dates and immutable shipment timestamps into identity", () => {
    const contextIdentity = {
      accountScope: "opaque-reports-account" as never,
      marketplaceId: US,
      mode: "live" as const,
    };
    const first = reportsDurableIdentity(contextIdentity, {
      intent: "fba-shipment-sales",
      marketplaceId: US,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
      dataStartTime: "2026-08-01T00:00:00-07:00",
      dataEndTime: "2026-08-21T00:00:00-07:00",
      windowCreatedAt: Date.parse("2026-08-20T12:00:00.000Z"),
    });
    const second = reportsDurableIdentity(contextIdentity, {
      intent: "fba-shipment-sales",
      marketplaceId: US,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
      dataStartTime: "2026-08-01T00:00:00-07:00",
      dataEndTime: "2026-08-21T00:00:01-07:00",
      windowCreatedAt: Date.parse("2026-08-20T12:00:00.000Z"),
    });
    const third = reportsDurableIdentity(contextIdentity, {
      intent: "fba-shipment-sales",
      marketplaceId: US,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
      dataStartTime: "2026-08-01T00:00:00-07:00",
      dataEndTime: "2026-08-21T00:00:00-07:00",
      windowCreatedAt: Date.parse("2026-08-20T12:00:01.000Z"),
    });

    expect(first.reportType).toBe(
      "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
    );
    expect(first.optionsKey).toContain("start=2026-08-01;end=2026-08-20");
    expect(first.optionsKey).not.toBe(second.optionsKey);
    expect(first.optionsKey).not.toBe(third.optionsKey);
  });

  it("rejects an unknown runtime intent before an adapter can interpret it", async () => {
    const store = await createStore();
    const adapter = createScriptedReportsAdapter([]);

    await expect(runtime(store, adapter).start({
      intent: "arbitrary-report",
      marketplaceId: US,
      reportType: "GET_ANYTHING",
      path: "/reports",
    } as never, { explicitRetry: false })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_INPUT",
    });
    expect(adapter.requests).toEqual([]);
  });
});
