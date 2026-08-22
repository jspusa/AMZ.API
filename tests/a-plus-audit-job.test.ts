import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AplusAuditJobCoordinator,
  AplusAuditJobCoordinatorError,
  type AplusAuditJobGateway,
} from "../src/main/amazon/a-plus-audit-job";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

async function flushBackgroundJob(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function gateway(
  overrides: Partial<AplusAuditJobGateway> = {},
): AplusAuditJobGateway {
  return {
    bindContext: async ({ marketplaceId, mode }) => ({
      accountScope: "internal-account-scope-one",
      marketplaceId,
      mode,
    }),
    loadFbaSeeds: async () => ({
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "internal-fba-report-snapshot-001",
      rows: [],
    }),
    fetchPublishRecords: async () => ({
      status: 200,
      payload: { publishRecordList: [] },
    }),
    ...overrides,
  };
}

describe("A+ audit background job coordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with an exact count-only public receipt", async () => {
    const coordinator = new AplusAuditJobCoordinator({ gateway: gateway() });

    const receipt = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    expect(receipt).toEqual({
      jobId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      contextId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      ready: false,
      status: "queued",
      progress: { completedAsins: 0, totalAsins: 0 },
    });
    expect(Object.keys(receipt).sort()).toEqual([
      "jobId",
      "contextId",
      "marketplaceId",
      "mode",
      "ready",
      "status",
      "progress",
    ].sort());
    expect(JSON.stringify(receipt)).not.toMatch(
      /account|seller|token|report|snapshot/iu,
    );
  });

  it("single-flights the same account, marketplace, and mode scope", async () => {
    const coordinator = new AplusAuditJobCoordinator({ gateway: gateway() });

    const first = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    const second = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    expect(second).toEqual(first);
  });

  it("loads FBA seeds in the background and returns a fenced terminal snapshot", async () => {
    const publishCalls: string[] = [];
    const coordinator = new AplusAuditJobCoordinator({
      gateway: gateway({
        loadFbaSeeds: async () => ({
          fetchedAt: "2026-08-23T08:00:00.000Z",
          fbaSnapshotId: "internal-fba-report-snapshot-002",
          rows: [
            { sellerSku: "SKU-ONE", asin: "B000000001", title: "One" },
            { sellerSku: "SKU-TWO", asin: "B000000002", title: "Two" },
          ],
        }),
        fetchPublishRecords: async ({ request }) => {
          publishCalls.push(request.asin);
          return {
            status: 200,
            payload: {
              publishRecordList: request.asin === "B000000001"
                ? [{
                    marketplaceId: MARKETPLACE_ID,
                    asin: request.asin,
                    contentReferenceKey: "published-content-one",
                    contentType: "EBC",
                    locale: "en-US",
                  }]
                : [],
            },
          };
        },
      }),
    });
    const started = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    await vi.advanceTimersByTimeAsync(0);
    await flushBackgroundJob();
    const terminal = await coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    expect(publishCalls).toEqual(["B000000001", "B000000002"]);
    expect(terminal).toMatchObject({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      ready: true,
      status: "completed",
      progress: { completedAsins: 2, totalAsins: 2 },
      snapshot: {
        summary: {
          eligibleFbaSkus: 2,
          uniqueAsins: 2,
          published: 1,
          missing: 1,
        },
      },
    });
    expect(Object.keys(terminal).sort()).toEqual([
      "jobId",
      "contextId",
      "marketplaceId",
      "mode",
      "ready",
      "status",
      "progress",
      "snapshot",
    ].sort());
    expect(JSON.stringify(terminal)).not.toContain(
      "internal-fba-report-snapshot-002",
    );
  });

  it("aborts and invalidates an active job when the bound account scope changes", async () => {
    let accountScope = "internal-account-scope-one";
    let jobSignal: AbortSignal | null = null;
    const coordinator = new AplusAuditJobCoordinator({
      gateway: gateway({
        bindContext: async ({ marketplaceId, mode }) => ({
          accountScope,
          marketplaceId,
          mode,
        }),
        loadFbaSeeds: async ({ signal }) => {
          jobSignal = signal;
          return await new Promise<never>(() => undefined);
        },
      }),
    });
    const started = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect((jobSignal as AbortSignal | null)?.aborted).toBe(false);

    accountScope = "internal-account-scope-two";
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).rejects.toEqual(expect.objectContaining<Partial<AplusAuditJobCoordinatorError>>({
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    }));
    expect((jobSignal as AbortSignal | null)?.aborted).toBe(true);

    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).rejects.toEqual(expect.objectContaining<Partial<AplusAuditJobCoordinatorError>>({
      status: 410,
      code: "A_PLUS_AUDIT_JOB_EXPIRED",
    }));
  });

  it("reports monotonic ASIN counts while the main-owned job keeps running", async () => {
    let finishSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const coordinator = new AplusAuditJobCoordinator({
      gateway: gateway({
        loadFbaSeeds: async () => ({
          fetchedAt: "2026-08-23T08:00:00.000Z",
          fbaSnapshotId: "internal-fba-report-snapshot-003",
          rows: [
            { sellerSku: "SKU-ONE", asin: "B000000001", title: "One" },
            { sellerSku: "SKU-TWO", asin: "B000000002", title: "Two" },
          ],
        }),
        fetchPublishRecords: async ({ request }) => {
          if (request.asin === "B000000002") await secondGate;
          return { status: 200, payload: { publishRecordList: [] } };
        },
      }),
    });
    const started = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushBackgroundJob();

    const running = await coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    expect(running).toEqual({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      ready: false,
      status: "running",
      progress: { completedAsins: 1, totalAsins: 2 },
    });

    finishSecond();
    await flushBackgroundJob();
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).resolves.toMatchObject({
      ready: true,
      status: "completed",
      progress: { completedAsins: 2, totalAsins: 2 },
    });
  });

  it("fails honestly without exposing or retrying an unknown upstream error", async () => {
    let loadCalls = 0;
    const coordinator = new AplusAuditJobCoordinator({
      gateway: gateway({
        loadFbaSeeds: async () => {
          loadCalls += 1;
          throw new Error(
            "refresh_token=secret-value reportId=internal-report-004 seller=private",
          );
        },
      }),
    });
    const started = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushBackgroundJob();

    const terminal = await coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    expect(terminal).toEqual({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      ready: true,
      status: "failed",
      progress: { completedAsins: 0, totalAsins: 0 },
      error: {
        code: "A_PLUS_AUDIT_FAILED",
        message: "A+ 健檢未完成，未產生可核對的結果。",
      },
    });
    await coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    expect(loadCalls).toBe(1);
    expect(JSON.stringify(terminal)).not.toMatch(
      /refresh|secret|reportId|seller=private/iu,
    );
  });

  it("renews the active lease only when the gateway reports proven progress", async () => {
    const coordinator = new AplusAuditJobCoordinator({
      ttlMs: 1_000,
      gateway: gateway({
        loadFbaSeeds: async ({ heartbeat }) => {
          await new Promise((resolve) => setTimeout(resolve, 750));
          heartbeat();
          await new Promise((resolve) => setTimeout(resolve, 750));
          return {
            fetchedAt: "2026-08-23T08:00:00.000Z",
            fbaSnapshotId: "internal-fba-report-snapshot-heartbeat",
            rows: [],
          };
        },
      }),
    });
    const started = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).resolves.toMatchObject({
      ready: false,
      status: "running",
    });

    await vi.advanceTimersByTimeAsync(499);
    await flushBackgroundJob();
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).resolves.toMatchObject({
      ready: true,
      status: "completed",
    });
  });

  it("renews the active lease around a gateway-controlled A+ request wait", async () => {
    const coordinator = new AplusAuditJobCoordinator({
      ttlMs: 1_000,
      gateway: gateway({
        loadFbaSeeds: async () => ({
          fetchedAt: "2026-08-23T08:00:00.000Z",
          fbaSnapshotId: "internal-fba-report-snapshot-request-wait",
          rows: [
            { sellerSku: "SKU-ONE", asin: "B000000001", title: "One" },
          ],
        }),
        fetchPublishRecords: async ({ heartbeat }) => {
          await new Promise((resolve) => setTimeout(resolve, 750));
          heartbeat();
          await new Promise((resolve) => setTimeout(resolve, 750));
          return { status: 200, payload: { publishRecordList: [] } };
        },
      }),
    });
    const started = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushBackgroundJob();

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).resolves.toMatchObject({
      ready: false,
      status: "running",
    });

    await vi.advanceTimersByTimeAsync(499);
    await flushBackgroundJob();
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).resolves.toMatchObject({
      ready: true,
      status: "completed",
    });
  });

  it("aborts an expired active job, retains its safe terminal state, then prunes it", async () => {
    let jobSignal: AbortSignal | null = null;
    const coordinator = new AplusAuditJobCoordinator({
      ttlMs: 1_000,
      gateway: gateway({
        loadFbaSeeds: async ({ signal }) => {
          jobSignal = signal;
          return await new Promise<never>(() => undefined);
        },
      }),
    });
    const started = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect((jobSignal as AbortSignal | null)?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1_001);
    const aborted = await coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    expect((jobSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(aborted).toMatchObject({
      ready: true,
      status: "aborted",
      error: {
        code: "A_PLUS_AUDIT_ABORTED",
        message: "A+ 健檢超過安全執行期限，已由 Notebook 鑰匙停止。",
      },
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).rejects.toEqual(expect.objectContaining<Partial<AplusAuditJobCoordinatorError>>({
      status: 410,
      code: "A_PLUS_AUDIT_JOB_EXPIRED",
    }));
  });

  it("aborts active work only when the main coordinator lifecycle is cleared", async () => {
    let jobSignal: AbortSignal | null = null;
    const coordinator = new AplusAuditJobCoordinator({
      gateway: gateway({
        loadFbaSeeds: async ({ signal }) => {
          jobSignal = signal;
          return await new Promise<never>(() => undefined);
        },
      }),
    });
    const started = await coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect((jobSignal as AbortSignal | null)?.aborted).toBe(false);

    coordinator.clear();

    expect((jobSignal as AbortSignal | null)?.aborted).toBe(true);
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).rejects.toEqual(expect.objectContaining<Partial<AplusAuditJobCoordinatorError>>({
      status: 410,
      code: "A_PLUS_AUDIT_JOB_EXPIRED",
    }));
  });

  it("sanitizes a gateway failure before a job context can be bound", async () => {
    const coordinator = new AplusAuditJobCoordinator({
      gateway: gateway({
        bindContext: async () => {
          throw new Error("seller=private refresh_token=secret-context-value");
        },
      }),
    });

    let caught: unknown;
    try {
      await coordinator.start({ marketplaceId: MARKETPLACE_ID, mode: "live" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toEqual(
      expect.objectContaining<Partial<AplusAuditJobCoordinatorError>>({
        status: 503,
        code: "A_PLUS_AUDIT_CONTEXT_UNAVAILABLE",
        message: "A+ 健檢無法安全綁定目前 Notebook 鑰匙 context。",
      }),
    );
    expect(String(caught)).not.toMatch(/seller|refresh|secret-context/iu);
  });
});
