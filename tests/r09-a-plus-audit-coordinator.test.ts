import { describe, expect, it, vi } from "vitest";
import {
  AplusAuditCoordinator,
  type AplusAuditCoordinatorDependencies,
  type AplusAuditGroupingReader,
} from
  "../src/main/a-plus-audit-coordinator";
import type {
  AplusContentReadsPort,
} from "../src/main/amazon/a-plus-content-reads";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from
  "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw lastError;
}

function executionContext(
  mode: "live" | "demo" = "live",
): SpExecutionContext {
  return Object.freeze({
    marketplaceId: US,
    region: "na",
    mode,
    accountScope: "opaque-a-plus-scope",
    generation: 7,
  }) as SpExecutionContext;
}

function unreachableDependencies(
  context: SpExecutionContextAdapter,
): AplusAuditCoordinatorDependencies {
  return {
    context,
    listingsExport: {
      startReusable: vi.fn(async () => {
        throw new Error("Unexpected reusable Listings start.");
      }),
      status: vi.fn(async () => {
        throw new Error("Unexpected Listings status.");
      }),
      data: vi.fn(async () => {
        throw new Error("Unexpected Listings data.");
      }),
    },
    readGrouping: vi.fn(async () => {
      throw new Error("Unexpected grouping read.");
    }),
    contentReads: {
      read: vi.fn(async () => {
        throw new Error("Unexpected A+ read.");
      }),
    },
    wait: async () => undefined,
  };
}

function request(
  method: "GET" | "POST",
  input: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path: "/api/sp-api/a-plus-audit",
    query: method === "GET" ? input as Record<string, string> : {},
    headers: {},
    ...(method === "POST"
      ? { body: { kind: "json" as const, value: input } }
      : {}),
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON response.");
  return response.body.value as Record<string, unknown>;
}

async function terminal(
  coordinator: AplusAuditCoordinator,
  started: ApiResponse,
): Promise<ApiResponse> {
  const receipt = jsonValue(started);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await coordinator.observe(request("GET", {
      marketplaceId: US,
      mode: "live",
      jobId: String(receipt.jobId),
      contextId: String(receipt.contextId),
    }));
    if (response.status !== 202) return response;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("A+ coordinator did not settle.");
}

describe("R09 A+ audit coordinator", () => {
  it("owns one exact-context FBA report-to-A+ workflow behind start and observe", async () => {
    const context = executionContext();
    const contextPort = {
      capture: vi.fn(async () => context),
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    };
    const listingsExport = {
      startReusable: vi.fn(async () => ({
        mode: "live" as const,
        ready: false,
        reportId: "report-lease.a-plus-001",
        documentId: null,
        status: "IN_QUEUE" as const,
        notice: "Amazon 正在準備報表。",
      })),
      status: vi.fn(async () => ({
        mode: "live" as const,
        ready: true,
        reportId: "report-lease.a-plus-001",
        documentId: "report-document.a-plus-001",
        status: "DONE" as const,
        notice: "Amazon 報表已就緒。",
      })),
      data: vi.fn(async () => ({
        fetchedAt: "2026-08-26T01:00:00.000Z",
        rows: [{
          marketplace: "US",
          sellerSku: "A-PLUS-SKU-1",
          asin: "B000000001",
          productType: "PET_FOOD",
          title: "Published child",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
          imageUrls: [],
          status: "Active",
          updatedAt: "",
          readStatus: "complete" as const,
          readErrors: [],
        }],
        errors: [],
      })),
    };
    const readGrouping = vi.fn<AplusAuditGroupingReader>(async (input) => {
      await input.onProgress?.({ completedBatches: 1, totalBatches: 1 });
      return {
        marketplaceId: input.marketplaceId,
        fetchedAt: "2026-08-26T01:00:00.000Z",
        rows: input.rows.map((row) => ({
          ...row,
          role: "child" as const,
          parentSku: "A-PLUS-PARENT-1",
          familyKey: "A-PLUS-PARENT-1",
          theme: "SIZE_NAME",
          status: "complete" as const,
          message: "Amazon relationships 已完成核對。",
        })),
        notice: "Only exact relationships evidence is used.",
      };
    });
    const readContent = vi.fn<AplusContentReadsPort["read"]>(async (input) => {
        await input.onProgress?.({ completedAsins: 1, totalAsins: 1 });
        const summary = {
          eligibleFbaSkus: 1,
          uniqueAsins: 1,
          published: 1,
          missing: 0,
          incomplete: 0,
          unavailable: 0,
        };
        return {
          mode: "live" as const,
          marketplaceId: input.marketplaceId,
          fetchedAt: input.fetchedAt,
          fbaSnapshotId: input.fbaSnapshotId,
          totals: summary,
          summary,
          rows: [{
            sellerSku: input.rows[0].sellerSku,
            asin: input.rows[0].asin,
            title: input.rows[0].title,
            marketplaceId: input.marketplaceId,
            status: "published" as const,
            sourceCompleteness: "complete" as const,
            publishedRecordCount: 1,
            contentTypes: ["EBC" as const],
            locales: ["en-US"],
            documents: [],
            documentEvidenceCompleteness: "complete" as const,
            reasonCode: "PUBLISHED_RECORD_FOUND" as const,
            reason: "Amazon returned an exact published record.",
          }],
          notice: "Read-only A+ snapshot.",
        };
      });
    const contentReads: AplusContentReadsPort = {
      read: readContent,
    };
    const coordinator = new AplusAuditCoordinator({
      context: contextPort,
      listingsExport,
      readGrouping,
      contentReads,
      wait: async () => undefined,
    });

    const started = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));
    const completed = await terminal(coordinator, started);

    expect(started.status).toBe(202);
    expect(completed).toMatchObject({
      status: 200,
      body: {
        kind: "json",
        value: {
          ready: true,
          status: "completed",
          snapshot: {
            marketplaceId: US,
            mode: "live",
            summary: { published: 1, uniqueAsins: 1 },
          },
        },
      },
    });
    expect(listingsExport.startReusable).toHaveBeenCalledTimes(1);
    expect(listingsExport.startReusable).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: context,
    }));
    expect(listingsExport.status).toHaveBeenCalledTimes(1);
    expect(listingsExport.status).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      reportId: "report-lease.a-plus-001",
      expectedContext: context,
    }));
    expect(listingsExport.data).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      reportId: "report-lease.a-plus-001",
      documentId: "report-document.a-plus-001",
      expectedContext: context,
    }));
    expect(readContent).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: context,
      rows: [{
        sellerSku: "A-PLUS-SKU-1",
        asin: "B000000001",
        title: "Published child",
      }],
    }));
    const serialized = JSON.stringify(jsonValue(completed));
    expect(serialized).not.toMatch(/opaque-a-plus-scope|fbaSnapshotId|report-lease|report-document/u);
    coordinator.clear();
  });

  it("preserves the route DTO and classified context-error contract", async () => {
    const context = executionContext();
    const capture = vi.fn(async () => context);
    const contextPort = {
      capture,
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    } satisfies SpExecutionContextAdapter;
    const coordinator = new AplusAuditCoordinator(
      unreachableDependencies(contextPort),
    );

    const injected = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
      accountScope: "renderer-selected-scope",
    }));
    expect(injected).toMatchObject({
      status: 400,
      body: { kind: "json", value: { code: "INVALID_INPUT" } },
    });
    expect(capture).not.toHaveBeenCalled();

    const wrongMode = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "demo",
    }));
    expect(wrongMode).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: { code: "A_PLUS_AUDIT_CONTEXT_CHANGED" },
      },
    });

    const started = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));
    const receipt = jsonValue(started);
    const observedWithLegacyExtra = await coordinator.observe(request("GET", {
      marketplaceId: US,
      mode: "live",
      jobId: String(receipt.jobId),
      contextId: String(receipt.contextId),
      cacheBust: "legacy-query-is-ignored",
    }));
    expect(observedWithLegacyExtra.status).toBe(202);
    coordinator.clear();

    capture.mockRejectedValueOnce(new SpExecutionContextError(
      "ACCOUNT_SCOPE_CHANGED",
      "Amazon 帳號範圍已改變；本次操作已停止。",
    ));
    const classified = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));
    expect(classified).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: {
          code: "ACCOUNT_SCOPE_CHANGED",
          message: "Amazon 帳號範圍已改變；本次操作已停止。",
        },
      },
    });
    expect(JSON.stringify(jsonValue(classified))).not.toContain(
      "renderer-selected-scope",
    );
    coordinator.clear();
  });

  it("fails hostile coordinator metadata closed at the A+ public seam", async () => {
    const hostile = [
      "Bearer example-access-value",
      "accountScope=example-private-scope",
      "reportId=example-private-report",
      "https://example.invalid/private?client_secret=example-secret",
      "hostile-text\u202e\u0000",
    ].join(" ");
    const hostileContextError = new SpExecutionContextError(
      "ACCOUNT_SCOPE_CHANGED",
      hostile,
    );
    Object.assign(
      hostileContextError as unknown as { code: string; status: number },
      { code: "BAD\nCODE", status: 302 },
    );
    const contextPort = {
      capture: vi.fn(async () => {
        throw hostileContextError;
      }),
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    } satisfies SpExecutionContextAdapter;
    const coordinator = new AplusAuditCoordinator(
      unreachableDependencies(contextPort),
    );

    const response = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));

    expect(response).toMatchObject({
      status: 500,
      body: {
        kind: "json",
        value: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "開始全站 A+ 健檢時發生未預期的錯誤。",
        },
      },
    });
    expect(JSON.stringify(response)).not.toMatch(
      /Bearer|access.?value|client.?secret|accountScope|reportId|https?:|hostile-text|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/iu,
    );
    coordinator.clear();
  });

  it("fences a start whose context capture resolves after clear", async () => {
    const context = executionContext();
    const contextGate = deferred<SpExecutionContext>();
    const capture = vi.fn(() => contextGate.promise);
    const contextPort = {
      capture,
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    } satisfies SpExecutionContextAdapter;
    const dependencies = unreachableDependencies(contextPort);
    const coordinator = new AplusAuditCoordinator(dependencies);

    const pending = coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));
    expect(capture).toHaveBeenCalledTimes(1);
    coordinator.clear();
    contextGate.resolve(context);

    const invalidated = await pending;
    expect(invalidated).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: { code: "SP_CONTEXT_INVALIDATED" },
      },
    });
    expect(dependencies.listingsExport.startReusable).not.toHaveBeenCalled();

    capture.mockResolvedValue(context);
    const fresh = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));
    expect(fresh.status).toBe(202);
    coordinator.clear();
  });

  it("prevents a cleared report continuation from publishing into a fresh lifecycle", async () => {
    type StatusReceipt = Awaited<ReturnType<
      AplusAuditCoordinatorDependencies["listingsExport"]["status"]
    >>;
    const context = executionContext();
    const contextPort = {
      capture: vi.fn(async () => context),
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    } satisfies SpExecutionContextAdapter;
    const statusGate = deferred<StatusReceipt>();
    const startReport = vi.fn<
      AplusAuditCoordinatorDependencies["listingsExport"]["startReusable"]
    >(async () => ({
      mode: "live",
      ready: false,
      reportId: "report-lease.a-plus-late",
      documentId: null,
      status: "IN_QUEUE",
      notice: "Amazon 正在準備報表。",
    }));
    const statusReport = vi.fn<
      AplusAuditCoordinatorDependencies["listingsExport"]["status"]
    >(() => statusGate.promise);
    const readData = vi.fn<
      AplusAuditCoordinatorDependencies["listingsExport"]["data"]
    >(async () => {
      throw new Error("Cleared report data must not be read.");
    });
    const readGrouping = vi.fn<AplusAuditGroupingReader>(async () => {
      throw new Error("Cleared report rows must not be grouped.");
    });
    const readContent = vi.fn<AplusContentReadsPort["read"]>(async () => {
      throw new Error("Cleared A+ work must not run.");
    });
    const coordinator = new AplusAuditCoordinator({
      context: contextPort,
      listingsExport: {
        startReusable: startReport,
        status: statusReport,
        data: readData,
      },
      readGrouping,
      contentReads: { read: readContent },
      wait: async () => undefined,
    });

    const started = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));
    await eventually(() => expect(statusReport).toHaveBeenCalledTimes(1));
    const oldReceipt = jsonValue(started);
    coordinator.clear();
    expect(statusReport.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    statusGate.resolve({
      mode: "live",
      ready: true,
      reportId: "report-lease.a-plus-late",
      documentId: "report-document.a-plus-late",
      status: "DONE",
      notice: "Amazon 報表已就緒。",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expired = await coordinator.observe(request("GET", {
      marketplaceId: US,
      mode: "live",
      jobId: String(oldReceipt.jobId),
      contextId: String(oldReceipt.contextId),
    }));
    expect(expired).toMatchObject({
      status: 410,
      body: {
        kind: "json",
        value: { code: "A_PLUS_AUDIT_JOB_EXPIRED" },
      },
    });
    expect(readData).not.toHaveBeenCalled();
    expect(readGrouping).not.toHaveBeenCalled();
    expect(readContent).not.toHaveBeenCalled();

    const fresh = await coordinator.start(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));
    expect(jsonValue(fresh)).not.toMatchObject({
      jobId: oldReceipt.jobId,
      contextId: oldReceipt.contextId,
    });
    coordinator.clear();
  });
});
