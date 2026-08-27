import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { FbaInboundReads } from
  "../src/main/amazon/fba-inbound-reads";
import type { FbaInboundShipmentSnapshot } from
  "../src/main/amazon/fba-inbound-shipments";
import type { DurableReportGatewayStatus } from
  "../src/main/amazon/report-lifecycle";
import { createDemoReportsAdapter } from
  "../src/main/amazon/reports-runtime-demo";
import {
  SpExecutionContextAfterAdapterError,
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const INBOUND_ACTIVE_STALE_MS = 60 * 60 * 1_000 + 1;
const previousMode = process.env.SP_API_MODE;

function apiRequest(input: {
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: input.method,
    path: "/api/sp-api/inbound-shipments",
    query: input.query ?? {},
    headers: {},
    body: input.body ? { kind: "json", value: input.body } : undefined,
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json" || !response.body.value || typeof response.body.value !== "object") {
    throw new Error("Expected JSON object");
  }
  return response.body.value as Record<string, unknown>;
}

function inboundSnapshot(startDate: string, endDate: string): FbaInboundShipmentSnapshot {
  const fetchedAt = "2026-08-21T01:00:00.000Z";
  const totals = {
    expectedUnits: 2400,
    receivedUnits: 2401,
    pendingUnits: 0,
    overReceivedUnits: 1,
  };
  return {
    schemaVersion: 1,
    mode: "demo",
    marketplaceId: MARKETPLACE_ID,
    dateRange: {
      startDate,
      endDate,
      lastUpdatedAfter: `${startDate}T00:00:00.000Z`,
      lastUpdatedBefore: `${endDate}T23:59:59.999Z`,
    },
    fetchedAt,
    shipmentListScope: "selected-date-range",
    dataSource: {
      shipmentList: "GET /fba/inbound/v0/shipments",
      shipmentItems:
        "GET /fba/inbound/v0/shipments/{shipmentId}/items + GET /fba/inbound/v0/shipmentItems?QueryType=NEXT_TOKEN",
      startedAt: fetchedAt,
      completedAt: fetchedAt,
    },
    coverage: {
      state: "complete",
      shipmentPages: 1,
      itemPages: 1,
      shipmentCount: 1,
      shipmentsWithCompleteItems: 1,
      shipmentsWithPartialItems: 0,
      incompleteShipmentCount: 0,
      itemCount: 1,
      issues: [],
    },
    summary: {
      shipmentCount: 1,
      itemCount: 1,
      incompleteShipmentCount: 0,
      totals,
      verifiedTotals: { ...totals },
    },
    shipments: [{
      shipmentId: "FBA15TEST0001",
      shipmentName: "August inbound",
      status: "RECEIVING",
      destinationFulfillmentCenterId: "ONT8",
      labelPrepType: "SELLER_LABEL",
      boxContentsSource: "FEED",
      itemCoverage: "complete",
      itemCount: 1,
      totals: { ...totals },
      verifiedTotals: { ...totals },
    }],
    items: [{
      shipmentId: "FBA15TEST0001",
      sellerSku: "TEST-SKU-003",
      fulfillmentNetworkSku: "B000TEST03",
      asin: null,
      title: null,
      expectedUnits: 2400,
      receivedUnits: 2401,
      pendingUnits: 0,
      overReceivedUnits: 1,
      quantityInCase: 12,
    }],
    notice: "FBA 入庫數量已完成。",
  };
}

const ISSUE_HEADERS = [
  "issue-reported-date",
  "shipment-creation-date",
  "fba-shipment-id",
  "fba-carton-id",
  "fulfillment-center-id",
  "sku",
  "fnsku",
  "asin",
  "product-name",
  "problem-type",
  "problem-quantity",
  "expected-quantity",
  "received-quantity",
  "performance-measurement-unit",
  "coaching-level",
  "fee-type",
  "currency",
  "fee-total",
  "problem-level",
  "alert-status",
];

function issueDocument(level = "Product"): string {
  return [
    ISSUE_HEADERS,
    [
      "2026-08-20",
      "2026-08-10",
      "FBA15TEST0001",
      "BOX-1",
      "ONT8",
      "TEST-SKU-003",
      "B000TEST03",
      "B000TEST03",
      "Example Dog Treats",
      "Unexpected item found",
      "1",
      "2400",
      "2401",
      "Units",
      "Product",
      "",
      "",
      "",
      level,
      "Resolved",
    ],
  ].map((row) => row.join("\t")).join("\n");
}

async function terminalJob(
  router: ApiRouter,
  jobId: string,
  startDate = "2026-08-01",
  endDate = "2026-08-20",
  marketplaceId = MARKETPLACE_ID,
): Promise<Record<string, unknown>> {
  let value: Record<string, unknown> = {};
  await vi.waitFor(async () => {
    const response = await router.handle(apiRequest({
      method: "GET",
      query: { marketplaceId, jobId, startDate, endDate },
    }));
    value = jsonValue(response);
    expect(value.state).not.toBe("running");
  }, { timeout: 2_000, interval: 5 });
  return value;
}

describe("FBA inbound shipment router job", () => {
  let accountScope: string;
  let store: LocalStore;

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    accountScope = "inbound-account-a";
    const directory = await mkdtemp(join(tmpdir(), "amz-inbound-router-"));
    store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  function router(input: {
    snapshot?: (
      input: Parameters<FbaInboundReads["readShipments"]>[0],
    ) => Promise<FbaInboundShipmentSnapshot>;
    document?: string;
    reportDocument?: () => Promise<string>;
    reportStartError?: Error;
    reportStart?: () => Promise<DurableReportGatewayStatus>;
    readNoncompliance?: FbaInboundReads["readNoncompliance"];
    spExecutionContext?: SpExecutionContextAdapter;
    onAccountScope?: () => void;
    onReportStart?: () => void;
  } = {}): ApiRouter {
    return new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => {
          input.onAccountScope?.();
          return accountScope;
        },
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      fbaInboundReads: {
        readShipments: async (request) => {
          const snapshot = await (input.snapshot ?? (async ({
            startDate,
            endDate,
            onProgress,
          }) => {
          onProgress?.({ phase: "shipments", completed: 1, total: 1 });
          onProgress?.({ phase: "items", completed: 1, total: 1 });
          return inboundSnapshot(startDate, endDate);
          }))(request);
          return {
            state:
              snapshot.shipmentListScope === "selected-date-range" &&
                snapshot.coverage.state === "complete"
                ? "complete"
                : "partial",
            snapshot,
          };
        },
        ...(input.readNoncompliance
          ? { readNoncompliance: input.readNoncompliance }
          : {}),
      },
      demoReportsAdapter: createDemoReportsAdapter({
        inboundNoncomplianceDemoReports: {
          start: async () => {
            input.onReportStart?.();
            if (input.reportStart) return input.reportStart();
            if (input.reportStartError) throw input.reportStartError;
            return {
              mode: "demo",
              ready: true,
              reportId: "demo-inbound-report",
              documentId: "demo-inbound-document",
              status: "DONE",
              notice: "ready",
            };
          },
          status: async () => ({
            mode: "demo",
            ready: true,
            reportId: "demo-inbound-report",
            documentId: "demo-inbound-document",
            status: "DONE",
            notice: "ready",
          }),
          document: async () => input.reportDocument
            ? input.reportDocument()
            : input.document ?? issueDocument(),
        },
      }),
      spExecutionContext: input.spExecutionContext,
    });
  }

  it("returns quantities and three-level daily issue evidence without internal identity", async () => {
    const app = router();
    const started = await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));
    const starting = jsonValue(started);
    expect(starting).toMatchObject({
      marketplaceId: MARKETPLACE_ID,
      dateRange: { startDate: "2026-08-01", endDate: "2026-08-20" },
      state: "running",
      snapshot: null,
      notice: "正在讀取 FBA 入庫貨件與商品接收數量；你可以關閉這個面板或先使用其他功能，Notebook 鑰匙仍會在背景繼續。",
    });
    const completed = await terminalJob(app, String(starting.jobId));
    expect(completed.state).toBe("completed");
    expect(completed.snapshot).toMatchObject({
      schemaVersion: 1,
      summary: {
        totals: { expectedUnits: 2400, receivedUnits: 2401, overReceivedUnits: 1 },
      },
      items: [{ sellerSku: "TEST-SKU-003", title: null, asin: null }],
      issueReport: {
        state: "completed",
        dataThrough: null,
        excludedShipmentCount: 0,
        shipment: [],
        carton: [],
        product: [{
          shipmentId: "FBA15TEST0001",
          sellerSku: "TEST-SKU-003",
          productName: "Example Dog Treats",
          problemType: "Unexpected item found",
          problemQuantity: 1,
          expectedUnits: 2400,
          receivedUnits: 2401,
        }],
      },
    });
    const serialized = JSON.stringify(completed);
    expect(serialized).not.toContain(accountScope);
    expect(serialized).not.toContain("demo-inbound-report");
    expect(serialized).not.toContain("demo-inbound-document");
  });

  it("captures one execution context and shares it across both inbound read legs", async () => {
    const fixedContext = Object.freeze({
      marketplaceId: MARKETPLACE_ID,
      region: "na",
      mode: "demo",
      accountScope: "shared-inbound-context",
      generation: 0,
    }) as unknown as SpExecutionContext;
    const contextAdapter: SpExecutionContextAdapter = {
      capture: vi.fn(async () => fixedContext),
      assertCurrent: vi.fn(async (context) => {
        expect(context).toBe(fixedContext);
      }),
      invalidate: vi.fn(),
    };
    const observedContexts: SpExecutionContext[] = [];
    const app = router({
      spExecutionContext: contextAdapter,
      snapshot: async (input) => {
        observedContexts.push(input.expectedContext);
        return inboundSnapshot(input.startDate, input.endDate);
      },
      readNoncompliance: async (input) => {
        observedContexts.push(input.expectedContext);
        return {
          parsed: {
            issues: [],
            incompleteRowCount: 0,
            incompleteRows: [],
            latestIssueReportedDate: null,
          },
          fetchedAt: "2026-08-21T12:00:00.000Z",
        };
      },
    });

    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    expect((await terminalJob(app, String(started.jobId))).state).toBe(
      "completed",
    );

    expect(contextAdapter.capture).toHaveBeenCalledTimes(1);
    expect(observedContexts).toEqual([fixedContext, fixedContext]);
  });

  it("does not let a context capture that settles after dispose resurrect a job", async () => {
    const fixedContext = Object.freeze({
      marketplaceId: MARKETPLACE_ID,
      region: "na",
      mode: "demo",
      accountScope: "capture-after-dispose",
      generation: 0,
    }) as unknown as SpExecutionContext;
    let resolveCapture!: (context: SpExecutionContext) => void;
    const captureGate = new Promise<SpExecutionContext>((resolve) => {
      resolveCapture = resolve;
    });
    const snapshot = vi.fn(async ({ startDate, endDate }) =>
      inboundSnapshot(startDate, endDate));
    const readNoncompliance = vi.fn(async () => ({
      parsed: {
        issues: [],
        incompleteRowCount: 0,
        incompleteRows: [],
        latestIssueReportedDate: null,
      },
      fetchedAt: "2026-08-21T12:00:00.000Z",
    }));
    const contextAdapter: SpExecutionContextAdapter = {
      capture: vi.fn(() => captureGate),
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    };
    const app = router({
      snapshot,
      readNoncompliance,
      spExecutionContext: contextAdapter,
    });

    const startFlight = app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));
    await vi.waitFor(() => expect(contextAdapter.capture).toHaveBeenCalledOnce());

    app.dispose();
    resolveCapture(fixedContext);
    const response = await startFlight;

    expect(response.status).toBe(409);
    expect(jsonValue(response)).toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(snapshot).not.toHaveBeenCalled();
    expect(readNoncompliance).not.toHaveBeenCalled();
  });

  it("does not return a stale job after dispose wins a pending status fence", async () => {
    const fixedContext = Object.freeze({
      marketplaceId: MARKETPLACE_ID,
      region: "na",
      mode: "demo",
      accountScope: "status-after-dispose",
      generation: 0,
    }) as unknown as SpExecutionContext;
    let deferAssertions = false;
    const pendingAssertions: Array<() => void> = [];
    const contextAdapter: SpExecutionContextAdapter = {
      capture: vi.fn(async () => fixedContext),
      assertCurrent: vi.fn(() => {
        if (!deferAssertions) return Promise.resolve();
        return new Promise<void>((resolve) => pendingAssertions.push(resolve));
      }),
      invalidate: vi.fn(),
    };
    const snapshot = vi.fn(() => new Promise<FbaInboundShipmentSnapshot>(() => undefined));
    const readNoncompliance = vi.fn(
      () => new Promise<Awaited<ReturnType<FbaInboundReads["readNoncompliance"]>>>(
        () => undefined,
      ),
    );
    const app = router({
      snapshot,
      readNoncompliance,
      spExecutionContext: contextAdapter,
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    await vi.waitFor(() => {
      expect(snapshot).toHaveBeenCalledOnce();
      expect(readNoncompliance).toHaveBeenCalledOnce();
    });
    deferAssertions = true;

    const statusFlight = app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));
    await vi.waitFor(() => expect(pendingAssertions).toHaveLength(1));

    app.dispose();
    pendingAssertions[0]?.();
    const response = await statusFlight;

    expect(response.status).toBe(409);
    expect(jsonValue(response)).toMatchObject({ code: "JOB_MISMATCH" });
  });

  it("marks an active-status fallback partial even when returned quantities and issues are complete", async () => {
    const app = router({
      snapshot: async ({ startDate, endDate }) => ({
        ...inboundSnapshot(startDate, endDate),
        shipmentListScope: "active-status-fallback",
        notice:
          "Amazon 拒絕舊版日期清單；已改讀活動中貨件，所選日期內已關閉貨件可能未列入。",
      }),
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    const terminal = await terminalJob(app, String(started.jobId));
    expect(terminal).toMatchObject({
      state: "partial",
      snapshot: {
        shipmentListScope: "active-status-fallback",
        coverage: { state: "complete" },
        issueReport: { state: "completed" },
      },
    });
  });

  it("single-flights only an active exact range and refreshes quantities after terminal", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const snapshot = vi.fn(async ({ startDate, endDate }) => {
      await gate;
      return inboundSnapshot(startDate, endDate);
    });
    const app = router({ snapshot });
    const body = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const first = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    const joined = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    expect(joined.jobId).toBe(first.jobId);
    expect(snapshot).toHaveBeenCalledTimes(1);

    release();
    await terminalJob(app, String(first.jobId));
    const refreshed = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    expect(refreshed.jobId).not.toBe(first.jobId);
    await terminalJob(app, String(refreshed.jobId));
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("cancels an older active range for the same account, mode and marketplace", async () => {
    type PendingSnapshot = {
      signal: AbortSignal;
      startDate: string;
      endDate: string;
      resolve: (value: FbaInboundShipmentSnapshot) => void;
    };
    const pending: PendingSnapshot[] = [];
    const snapshot = vi.fn(
      (input: Parameters<FbaInboundReads["readShipments"]>[0]) =>
        new Promise<FbaInboundShipmentSnapshot>((resolve, reject) => {
          if (!input.signal) throw new Error("router must bind an AbortSignal");
          const signal = input.signal;
          pending.push({
            signal,
            startDate: input.startDate,
            endDate: input.endDate,
            resolve,
          });
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const app = router({ snapshot });
    const firstBody = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const secondBody = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    };
    const first = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: firstBody,
    })));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const joined = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: firstBody,
    })));
    expect(joined.jobId).toBe(first.jobId);
    expect(snapshot).toHaveBeenCalledTimes(1);

    const second = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: secondBody,
    })));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(second.jobId).not.toBe(first.jobId);
    expect(pending[0]?.signal.aborted).toBe(true);
    const oldStatus = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(first.jobId),
        startDate: firstBody.startDate,
        endDate: firstBody.endDate,
      },
    }));
    expect(oldStatus.status).toBe(404);

    pending[1]?.resolve(inboundSnapshot(secondBody.startDate, secondBody.endDate));
    const completed = await terminalJob(
      app,
      String(second.jobId),
      secondBody.startDate,
      secondBody.endDate,
    );
    expect(completed.state).toBe("completed");
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("does not let abort-ignoring A to B to A flights replace the fresh selection", async () => {
    type PendingSnapshot = {
      signal: AbortSignal;
      startDate: string;
      endDate: string;
      progress: NonNullable<
        Parameters<FbaInboundReads["readShipments"]>[0]["onProgress"]
      >;
      resolve: (value: FbaInboundShipmentSnapshot) => void;
    };
    const pending: PendingSnapshot[] = [];
    const snapshot = vi.fn(
      (input: Parameters<FbaInboundReads["readShipments"]>[0]) =>
        new Promise<FbaInboundShipmentSnapshot>((resolve) => {
          if (!input.signal || !input.onProgress) {
            throw new Error("coordinator must bind progress and AbortSignal");
          }
          pending.push({
            signal: input.signal,
            startDate: input.startDate,
            endDate: input.endDate,
            progress: input.onProgress,
            resolve,
          });
          // Deliberately ignore abort to emulate an adapter that settles late.
        }),
    );
    const app = router({ snapshot });
    const rangeA = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const rangeB = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    };

    const staleA = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: rangeA,
    })));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const staleB = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: rangeB,
    })));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]?.signal.aborted).toBe(true);

    const freshA = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: rangeA,
    })));
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[1]?.signal.aborted).toBe(true);
    expect(freshA.jobId).not.toBe(staleA.jobId);

    pending[0]?.progress({ phase: "items", completed: 999, total: 999 });
    pending[0]?.resolve({
      ...inboundSnapshot(rangeA.startDate, rangeA.endDate),
      notice: "stale A1 must not publish",
    });
    pending[1]?.progress({ phase: "items", completed: 888, total: 888 });
    pending[1]?.resolve({
      ...inboundSnapshot(rangeB.startDate, rangeB.endDate),
      notice: "stale B must not publish",
    });
    await Promise.resolve();
    await Promise.resolve();

    const joinedA = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: rangeA,
    })));
    expect(joinedA.jobId).toBe(freshA.jobId);
    expect(snapshot).toHaveBeenCalledTimes(3);
    for (const [stale, range] of [
      [staleA, rangeA],
      [staleB, rangeB],
    ] as const) {
      const gone = await app.handle(apiRequest({
        method: "GET",
        query: {
          marketplaceId: MARKETPLACE_ID,
          jobId: String(stale.jobId),
          startDate: range.startDate,
          endDate: range.endDate,
        },
      }));
      expect(gone.status).toBe(404);
    }

    pending[2]?.resolve({
      ...inboundSnapshot(rangeA.startDate, rangeA.endDate),
      notice: "fresh A2 publishes",
    });
    const completed = await terminalJob(app, String(freshA.jobId));
    expect(completed).toMatchObject({
      state: "completed",
      dateRange: {
        startDate: rangeA.startDate,
        endDate: rangeA.endDate,
      },
      snapshot: {
        notice: "fresh A2 publishes",
      },
    });
    expect(JSON.stringify(completed)).not.toContain("stale A1");
    expect(JSON.stringify(completed)).not.toContain("stale B");
    expect(snapshot).toHaveBeenCalledTimes(3);
  });

  it("evicts older terminal ranges only within the same account, mode and marketplace", async () => {
    const jpMarketplaceId = "A1VC38T7YXB528";
    const snapshot = vi.fn(async ({ marketplaceId, startDate, endDate }) => ({
      ...inboundSnapshot(startDate, endDate),
      marketplaceId,
    }));
    const app = router({ snapshot });
    const firstUsRange = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const jpRange = {
      marketplaceId: jpMarketplaceId,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const latestUsRange = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-02",
      endDate: "2026-08-20",
    };

    const firstUs = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: firstUsRange,
    })));
    await terminalJob(app, String(firstUs.jobId));
    const jp = jsonValue(await app.handle(apiRequest({ method: "POST", body: jpRange })));
    await terminalJob(
      app,
      String(jp.jobId),
      jpRange.startDate,
      jpRange.endDate,
      jpMarketplaceId,
    );

    const latestUs = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: latestUsRange,
    })));
    const oldUs = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(firstUs.jobId),
        startDate: firstUsRange.startDate,
        endDate: firstUsRange.endDate,
      },
    }));
    const retainedJp = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: jpMarketplaceId,
        jobId: String(jp.jobId),
        startDate: jpRange.startDate,
        endDate: jpRange.endDate,
      },
    }));

    expect(oldUs.status).toBe(404);
    expect(retainedJp.status).toBe(200);
    expect(jsonValue(retainedJp).state).toBe("completed");
    await terminalJob(
      app,
      String(latestUs.jobId),
      latestUsRange.startDate,
      latestUsRange.endDate,
    );
  });

  it("expires a terminal snapshot without requiring another API request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    const app = router();
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    await terminalJob(app, String(started.jobId));
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000 + 1);

    expect(vi.getTimerCount()).toBe(0);
    const expired = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));
    expect(expired.status).toBe(404);
  });

  it("keeps shipment quantities as a partial snapshot when the daily issue report is unavailable", async () => {
    const app = router({
      reportStartError: new SpApiError("Amazon 每日瑕疵報表尚未提供。", {
        status: 503,
        code: "REPORT_FAILED",
      }),
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    const completed = await terminalJob(app, String(started.jobId));
    expect(completed.state).toBe("partial");
    expect(completed.snapshot).toMatchObject({
      summary: { totals: { expectedUnits: 2400, receivedUnits: 2401 } },
      issueReport: {
        state: "unavailable",
        fetchedAt: null,
        excludedShipmentCount: null,
        shipment: [],
        carton: [],
        product: [],
      },
    });
    expect(completed.notice).toContain("不能拿缺值冒充");
  });

  it.each([
    [
      "direct context fence",
      () => new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "hostile private account detail",
      ),
    ],
    [
      "post-adapter context fence",
      () => new SpExecutionContextAfterAdapterError(
        new SpExecutionContextError(
          "ACCOUNT_SCOPE_CHANGED",
          "hostile private account detail",
        ),
      ),
    ],
  ])("does not downgrade a noncompliance %s to an unavailable partial", async (
    _case,
    contextError,
  ) => {
    const app = router({
      readNoncompliance: async () => {
        throw contextError();
      },
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));

    const terminal = await terminalJob(app, String(started.jobId));

    expect(terminal).toMatchObject({
      state: "failed",
      snapshot: null,
      notice: "FBA 入庫貨件同步未完成，Notebook Key 無法安全判定原因；請不要連續重試。Amazon 沒有收到任何寫入。",
      failure: {
        code: "ACCOUNT_SCOPE_CHANGED",
        requestId: null,
      },
    });
    expect(JSON.stringify(terminal)).not.toContain("hostile private account");
    expect(JSON.stringify(terminal)).not.toContain("issueReport");
  });

  it("keeps a known noncompliance context failure ahead of a sibling abort", async () => {
    let markIssueAttempted!: () => void;
    const issueAttempted = new Promise<void>((resolve) => {
      markIssueAttempted = resolve;
    });
    const app = router({
      readNoncompliance: async () => {
        markIssueAttempted();
        throw new SpExecutionContextError(
          "ACCOUNT_SCOPE_CHANGED",
          "hostile private account detail",
        );
      },
      snapshot: async () => {
        await issueAttempted;
        await Promise.resolve();
        const error = new Error("sibling shipment aborted");
        error.name = "AbortError";
        throw error;
      },
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));

    const terminal = await terminalJob(app, String(started.jobId));

    expect(terminal).toMatchObject({
      state: "failed",
      snapshot: null,
      failure: {
        code: "ACCOUNT_SCOPE_CHANGED",
        requestId: null,
      },
    });
    expect(JSON.stringify(terminal)).not.toContain("hostile private account");
    expect(JSON.stringify(terminal)).not.toContain("sibling shipment aborted");
  });

  it("maps hostile issue gateway errors to a fixed public notice", async () => {
    const hostile = [
      "accountScope=private-account",
      "reportId=private-report",
      "documentId=private-document",
      "https://example.invalid/private-report",
      "hostile-text\u202e\u0000",
    ].join(" ");
    const app = router({
      reportStartError: new SpApiError(hostile, {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      }),
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    const terminal = await terminalJob(app, String(started.jobId));
    const serialized = JSON.stringify(terminal);

    expect(terminal).toMatchObject({
      state: "partial",
      snapshot: {
        issueReport: {
          state: "unavailable",
          notice: expect.stringContaining("Amazon 每日 FBA 入庫瑕疵報表目前無法讀取"),
        },
      },
    });
    for (const forbidden of [
      "accountScope",
      "private-account",
      "reportId",
      "private-report",
      "documentId",
      "private-document",
      "https://",
      "hostile-text",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u,
    );
  });

  it("maps a hostile upstream outage to a safe actionable failed-job notice", async () => {
    const hostile = [
      "accountScope=private-account",
      "reportId=private-report",
      "documentId=private-document",
      "https://example.invalid/private-report",
      "GLOBAL-JOB-CANARY\u202e\u0000",
    ].join(" ");
    const snapshot = vi.fn(async () => {
      throw new SpApiError(hostile, {
        status: 503,
        code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
        requestId: "unsafe/request?id=private",
      });
    });
    const app = router({ snapshot });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    const terminal = await terminalJob(app, String(started.jobId));
    const serialized = JSON.stringify(terminal);

    expect(terminal).toMatchObject({
      state: "failed",
      snapshot: null,
      notice:
        "Amazon FBA 入庫服務暫時無法回應；已在有限次唯讀重試後停止。請稍後只按一次重新同步；Amazon 沒有收到任何寫入。",
    });
    for (const forbidden of [
      "accountScope",
      "private-account",
      "reportId",
      "private-report",
      "documentId",
      "private-document",
      "https://",
      "GLOBAL-JOB-CANARY",
      "unsafe/request",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(terminal).toMatchObject({
      failure: {
        code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
        requestId: null,
      },
    });
  });

  it.each([
    [
      400,
      "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
      "Amazon 無法驗證這次 FBA 入庫貨件唯讀請求；請確認日期範圍後再按一次重新同步。Amazon 沒有收到任何寫入。",
    ],
    [
      502,
      "FBA_INBOUND_FORMAT_UNSUPPORTED",
      "Amazon 回傳的 FBA 入庫資料格式目前無法安全辨識；已停止並保留未知值，不會補 0。Amazon 沒有收到任何寫入。",
    ],
    [
      409,
      "PAGINATION_CHANGED",
      "Amazon FBA 入庫分頁資料前後不一致；已停止，避免重複或漏算貨件。Amazon 沒有收到任何寫入。",
    ],
  ])("maps %s/%s to a specific safe notice", async (status, code, notice) => {
    const snapshot = vi.fn(async () => {
      throw new SpApiError("hostile upstream detail https://example.invalid/private", {
        status,
        code,
        requestId: "SAFE-REQUEST-ID",
      });
    });
    const app = router({ snapshot });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    const terminal = await terminalJob(app, String(started.jobId));

    expect(terminal).toMatchObject({
      state: "failed",
      snapshot: null,
      notice,
      failure: { code, requestId: "SAFE-REQUEST-ID" },
    });
    expect(JSON.stringify(terminal)).not.toContain("example.invalid");
  });

  it("requires a private explicit intent and the retry guard before recreating an ambiguous issue report", async () => {
    let now = Date.parse("2026-08-20T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const reportStart = vi.fn<() => Promise<DurableReportGatewayStatus>>()
      .mockRejectedValueOnce(new Error("connection closed after report POST"))
      .mockResolvedValueOnce({
        mode: "demo",
        ready: true,
        reportId: "retried-inbound-report",
        documentId: "retried-inbound-document",
        status: "DONE",
        notice: "ready after explicit retry",
      });
    const snapshot = vi.fn(async ({ startDate, endDate }) =>
      inboundSnapshot(startDate, endDate));
    const app = router({ reportStart, snapshot });
    const firstRange = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const secondRange = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-19",
    };

    const ambiguous = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: firstRange,
    })));
    const ambiguousTerminal = await terminalJob(app, String(ambiguous.jobId));
    expect(ambiguousTerminal.state).toBe("partial");
    expect(reportStart).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(1);

    const normalResync = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: { ...secondRange, retryIssueReport: false },
    })));
    const normalTerminal = await terminalJob(
      app,
      String(normalResync.jobId),
      secondRange.startDate,
      secondRange.endDate,
    );
    expect(normalTerminal.state).toBe("partial");
    expect(reportStart).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(2);

    const guardedRetry = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: { ...secondRange, retryIssueReport: true },
    })));
    expect(guardedRetry).toMatchObject({
      progress: { phase: "issues", completed: 0, total: 1 },
      notice: "只重新讀取每日 FBA 入庫瑕疵報表；既有貨件與商品接收數量快照不會重抓。",
    });
    const guardedTerminal = await terminalJob(
      app,
      String(guardedRetry.jobId),
      secondRange.startDate,
      secondRange.endDate,
    );
    expect(guardedTerminal.state).toBe("partial");
    expect(guardedTerminal.notice).toContain("安全間隔");
    expect(reportStart).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(2);

    now += 30 * 60 * 1_000 + 1;
    const allowedRetry = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: { ...secondRange, retryIssueReport: true },
    })));
    const completed = await terminalJob(
      app,
      String(allowedRetry.jobId),
      secondRange.startDate,
      secondRange.endDate,
    );
    expect(completed.state).toBe("completed");
    expect(reportStart).toHaveBeenCalledTimes(2);
    expect(snapshot).toHaveBeenCalledTimes(2);
    const serialized = JSON.stringify([
      ambiguousTerminal,
      normalTerminal,
      guardedTerminal,
      completed,
    ]);
    expect(serialized).not.toContain("retryIssueReport");
    expect(serialized).not.toContain("shipmentSeed");
    expect(serialized).not.toContain(accountScope);
    expect(serialized).not.toContain("retried-inbound-report");
    expect(serialized).not.toContain("retried-inbound-document");
    nowSpy.mockRestore();
  });

  it("rejects a forged explicit issue retry when no prior job exists", async () => {
    const snapshot = vi.fn(async ({ startDate, endDate }) =>
      inboundSnapshot(startDate, endDate));
    const reportStarts = vi.fn();
    const app = router({ snapshot, onReportStart: reportStarts });

    const response = await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
        retryIssueReport: true,
      },
    }));

    expect(response.status).toBe(409);
    expect(jsonValue(response)).toMatchObject({
      code: "ISSUE_REPORT_RETRY_NOT_ALLOWED",
    });
    expect(snapshot).not.toHaveBeenCalled();
    expect(reportStarts).not.toHaveBeenCalled();
  });

  it("rejects explicit issue retry after a completed issue report without starting upstream work", async () => {
    const snapshot = vi.fn(async ({ startDate, endDate }) =>
      inboundSnapshot(startDate, endDate));
    const reportStarts = vi.fn();
    const app = router({ snapshot, onReportStart: reportStarts });
    const body = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const started = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    const completed = await terminalJob(app, String(started.jobId));
    expect(completed.state).toBe("completed");
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(reportStarts).toHaveBeenCalledTimes(1);

    const retry = await app.handle(apiRequest({
      method: "POST",
      body: { ...body, retryIssueReport: true },
    }));
    expect(retry.status).toBe(409);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(reportStarts).toHaveBeenCalledTimes(1);
  });

  it("rejects explicit issue retry after a partial-but-available issue report", async () => {
    const snapshot = vi.fn(async ({ startDate, endDate }) =>
      inboundSnapshot(startDate, endDate));
    const reportStarts = vi.fn();
    const app = router({
      snapshot,
      onReportStart: reportStarts,
      document: issueDocument("NewAmazonLevel"),
    });
    const body = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const started = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    const partial = await terminalJob(app, String(started.jobId));
    expect(partial).toMatchObject({
      state: "partial",
      snapshot: { issueReport: { state: "partial" } },
    });

    const retry = await app.handle(apiRequest({
      method: "POST",
      body: { ...body, retryIssueReport: true },
    }));
    expect(retry.status).toBe(409);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(reportStarts).toHaveBeenCalledTimes(1);
  });

  it("recovers after the private unavailable retry snapshot expires by reproducing it normally", async () => {
    let now = Date.parse("2026-08-20T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const snapshot = vi.fn(async ({ startDate, endDate }) =>
      inboundSnapshot(startDate, endDate));
    const reportStart = vi.fn<() => Promise<DurableReportGatewayStatus>>()
      .mockRejectedValueOnce(new Error("connection closed after report POST"))
      .mockResolvedValueOnce({
        mode: "demo",
        ready: true,
        reportId: "recovered-inbound-report",
        documentId: "recovered-inbound-document",
        status: "DONE",
        notice: "recovered",
      });
    const app = router({ snapshot, reportStart });
    const body = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };
    const first = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    expect((await terminalJob(app, String(first.jobId))).state).toBe("partial");
    expect(reportStart).toHaveBeenCalledTimes(1);

    now += 35 * 60 * 1_000 + 1;
    const expiredRetry = await app.handle(apiRequest({
      method: "POST",
      body: { ...body, retryIssueReport: true },
    }));
    expect(expiredRetry.status).toBe(409);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(reportStart).toHaveBeenCalledTimes(1);

    const reproduced = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    expect((await terminalJob(app, String(reproduced.jobId))).state).toBe("partial");
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(reportStart).toHaveBeenCalledTimes(1);

    const retry = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: { ...body, retryIssueReport: true },
    })));
    expect((await terminalJob(app, String(retry.jobId))).state).toBe("completed");
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(reportStart).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("creates one fresh report after a DONE document failure only on explicit retry", async () => {
    const snapshot = vi.fn(async ({ startDate, endDate }) =>
      inboundSnapshot(startDate, endDate));
    const reportStart = vi.fn<() => Promise<DurableReportGatewayStatus>>()
      .mockResolvedValueOnce({
        mode: "demo",
        ready: true,
        reportId: "done-inbound-report-1",
        documentId: "done-inbound-document-1",
        status: "DONE",
        notice: "done",
      })
      .mockResolvedValueOnce({
        mode: "demo",
        ready: true,
        reportId: "done-inbound-report-2",
        documentId: "done-inbound-document-2",
        status: "DONE",
        notice: "fresh done",
      });
    const reportDocument = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("document download failed"))
      .mockRejectedValueOnce(new Error("document download still failed"))
      .mockResolvedValueOnce(issueDocument());
    const app = router({ reportStart, reportDocument, snapshot });
    const body = {
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    };

    const failedDocument = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    const failedTerminal = await terminalJob(app, String(failedDocument.jobId));
    expect(failedTerminal.state).toBe("partial");
    expect(reportStart).toHaveBeenCalledTimes(1);
    expect(reportDocument).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(1);

    const normal = jsonValue(await app.handle(apiRequest({ method: "POST", body })));
    expect((await terminalJob(app, String(normal.jobId))).state).toBe("partial");
    expect(reportStart).toHaveBeenCalledTimes(1);
    expect(reportDocument).toHaveBeenCalledTimes(2);
    expect(snapshot).toHaveBeenCalledTimes(2);

    const explicit = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: { ...body, retryIssueReport: true },
    })));
    expect(explicit).toMatchObject({ progress: { phase: "issues" } });
    const completed = await terminalJob(app, String(explicit.jobId));
    expect(completed.state).toBe("completed");
    expect(reportStart).toHaveBeenCalledTimes(2);
    expect(reportDocument).toHaveBeenCalledTimes(3);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect((completed.snapshot as Record<string, unknown>).fetchedAt).toBe(
      (failedTerminal.snapshot as Record<string, unknown>).fetchedAt,
    );
    expect(JSON.stringify(completed)).not.toContain("done-inbound-report-2");
    expect(JSON.stringify(completed)).not.toContain("done-inbound-document-2");
    expect(JSON.stringify(completed)).not.toContain("shipmentSeed");
  });

  it("marks row-level issue schema drift partial instead of hiding valid shipment data", async () => {
    const app = router({ document: issueDocument("NewAmazonLevel") });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    const completed = await terminalJob(app, String(started.jobId));
    expect(completed.state).toBe("partial");
    expect(completed.snapshot).toMatchObject({
      issueReport: {
        state: "partial",
        product: [],
      },
    });
    expect(completed.notice).toContain("未分類也未補值");
  });

  it("revalidates account scope on GET and invalidates the old background job", async () => {
    const observed: { signal: AbortSignal | null } = { signal: null };
    const snapshot = vi.fn(async (
      input: Parameters<FbaInboundReads["readShipments"]>[0],
    ) => {
      observed.signal = input.signal ?? null;
      await new Promise<void>((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(input.signal?.reason), { once: true });
      });
      return inboundSnapshot(input.startDate, input.endDate);
    });
    const app = router({ snapshot });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    await vi.waitFor(() => expect(observed.signal).not.toBeNull());
    accountScope = "inbound-account-b";
    const response = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));
    expect(response.status).toBe(409);
    expect(observed.signal?.aborted).toBe(true);
    const gone = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));
    expect(gone.status).toBe(404);
  });

  it("rejects unbounded dates and renderer-supplied account identity", async () => {
    const app = router();
    const tooLong = await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-01-01",
        endDate: "2026-08-20",
      },
    }));
    expect(tooLong.status).toBe(400);
    const forgedScope = await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
        accountScope: "renderer-must-not-send-this",
      },
    }));
    expect(forgedScope.status).toBe(400);
    const invalidRetryIntent = await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
        retryIssueReport: "yes",
      },
    }));
    expect(invalidRetryIntent.status).toBe(400);
  });

  it("rejects a future marketplace-local end date before account or upstream work starts", async () => {
    vi.useFakeTimers();
    // It is already 2026-08-21 in Taiwan, but still 2026-08-20 for US.
    vi.setSystemTime(new Date("2026-08-21T06:30:00.000Z"));
    const snapshot = vi.fn(async ({ startDate, endDate }) =>
      inboundSnapshot(startDate, endDate));
    const accountReads = vi.fn();
    const reportStarts = vi.fn();
    const app = router({
      snapshot,
      onAccountScope: accountReads,
      onReportStart: reportStarts,
    });

    const response = await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-21",
      },
    }));

    expect(response.status).toBe(400);
    expect(jsonValue(response)).toMatchObject({ code: "INVALID_INPUT" });
    expect(accountReads).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(reportStarts).not.toHaveBeenCalled();
  });

  it("renews a progressing active job beyond one hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    type ProgressCallback = NonNullable<
      Parameters<FbaInboundReads["readShipments"]>[0]["onProgress"]
    >;
    const observed: {
      progress: ProgressCallback | null;
      signal: AbortSignal | null;
    } = { progress: null, signal: null };
    let markStarted!: () => void;
    const snapshotStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const app = router({
      reportStartError: new Error("daily report unavailable for TTL test"),
      snapshot: (input) => new Promise<FbaInboundShipmentSnapshot>((_resolve, reject) => {
        if (!input.signal || !input.onProgress) {
          reject(new Error("router must bind progress and AbortSignal"));
          return;
        }
        observed.signal = input.signal;
        observed.progress = input.onProgress;
        input.signal.addEventListener(
          "abort",
          () => reject(input.signal?.reason),
          { once: true },
        );
        markStarted();
      }),
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    await snapshotStarted;

    await vi.advanceTimersByTimeAsync(59 * 60 * 1_000);
    expect(observed.progress).not.toBeNull();
    observed.progress?.({ phase: "items", completed: 1, total: 10_000 });
    await vi.advanceTimersByTimeAsync(59 * 60 * 1_000);
    const response = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));

    expect(response.status).toBe(202);
    expect(jsonValue(response).state).toBe("running");
    expect(observed.signal?.aborted).toBe(false);
    app.dispose();
  });

  it("stops an active job that has made no verified progress for one hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    const observed: { signal: AbortSignal | null } = { signal: null };
    let markStarted!: () => void;
    const snapshotStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const app = router({
      reportStartError: new Error("daily report unavailable for TTL test"),
      snapshot: (input) => new Promise<FbaInboundShipmentSnapshot>((_resolve, reject) => {
        if (!input.signal) {
          reject(new Error("router must bind an AbortSignal"));
          return;
        }
        observed.signal = input.signal;
        input.signal.addEventListener(
          "abort",
          () => reject(input.signal?.reason),
          { once: true },
        );
        markStarted();
      }),
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    await snapshotStarted;

    await vi.advanceTimersByTimeAsync(INBOUND_ACTIVE_STALE_MS);
    const response = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));

    expect(response.status).toBe(200);
    expect(jsonValue(response)).toMatchObject({
      state: "failed",
      snapshot: null,
      notice: "FBA 入庫貨件背景工作等待逾時；Amazon 沒有收到任何寫入。",
      failure: {
        code: "INBOUND_SHIPMENT_JOB_TIMEOUT",
        requestId: null,
      },
    });
    expect(observed.signal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000 + 1);
    const expired = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));
    expect(expired.status).toBe(404);
  });

  it("requires status polls to match the exact job range without cancelling the valid job", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const app = router({
      snapshot: async ({ startDate, endDate }) => {
        await gate;
        return inboundSnapshot(startDate, endDate);
      },
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));

    const mismatch = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-02",
        endDate: "2026-08-20",
      },
    }));
    expect(mismatch.status).toBe(409);

    const missingRange = await app.handle(apiRequest({
      method: "GET",
      query: { marketplaceId: MARKETPLACE_ID, jobId: String(started.jobId) },
    }));
    expect(missingRange.status).toBe(400);

    const forgedScope = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
        accountScope: "renderer-must-not-send-this",
      },
    }));
    expect(forgedScope.status).toBe(400);

    release();
    const completed = await terminalJob(app, String(started.jobId));
    expect(completed.state).toBe("completed");
  });

  it("aborts and forgets background jobs when the security context is cleared", async () => {
    const observed: { signal: AbortSignal | null } = { signal: null };
    const app = router({
      snapshot: async (input) => {
        observed.signal = input.signal ?? null;
        await new Promise<void>((_resolve, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(input.signal?.reason),
            { once: true },
          );
        });
        return inboundSnapshot(input.startDate, input.endDate);
      },
    });
    const started = jsonValue(await app.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    })));
    await vi.waitFor(() => expect(observed.signal).not.toBeNull());

    app.dispose();
    expect(observed.signal?.aborted).toBe(true);
    const gone = await app.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(started.jobId),
        startDate: "2026-08-01",
        endDate: "2026-08-20",
      },
    }));
    expect(gone.status).toBe(404);
  });
});
