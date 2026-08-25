import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AplusAuditJobCoordinator,
  AplusAuditJobCoordinatorError,
  type AplusAuditJobGateway,
  type AplusAuditFbaSeedSnapshot,
  type AplusAuditJobBoundContext,
} from "../src/main/amazon/a-plus-audit-job";
import type { AplusAuditSnapshot } from
  "../src/main/amazon/a-plus-content-reads";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

async function flushBackgroundJob(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function completedSnapshot(input: Readonly<{
  context: AplusAuditJobBoundContext;
  seed: AplusAuditFbaSeedSnapshot;
  publishedAsins?: ReadonlySet<string>;
}>): AplusAuditSnapshot {
  const rows = input.seed.rows.map((row) => {
    const published = Boolean(row.asin && input.publishedAsins?.has(row.asin));
    return {
      sellerSku: row.sellerSku,
      asin: row.asin,
      title: row.title,
      marketplaceId: input.context.marketplaceId,
      status: published ? "published" as const : "missing" as const,
      sourceCompleteness: "complete" as const,
      publishedRecordCount: published ? 1 : 0,
      contentTypes: published ? ["EBC" as const] : [],
      locales: published ? ["en-US"] : [],
      documents: [],
      documentEvidenceCompleteness: "complete" as const,
      reasonCode: published
        ? "PUBLISHED_RECORD_FOUND" as const
        : "NO_PUBLISHED_RECORD" as const,
      reason: published ? "Published." : "Missing.",
    };
  });
  const uniqueAsins = new Set(rows.flatMap((row) => row.asin ? [row.asin] : []))
    .size;
  const summary = {
    eligibleFbaSkus: rows.length,
    uniqueAsins,
    published: rows.filter((row) => row.status === "published").length,
    missing: rows.filter((row) => row.status === "missing").length,
    incomplete: 0,
    unavailable: 0,
  };
  return {
    mode: input.context.mode,
    marketplaceId: input.context.marketplaceId,
    fetchedAt: input.seed.fetchedAt,
    fbaSnapshotId: input.seed.fbaSnapshotId,
    totals: summary,
    summary,
    rows,
    notice: "Read-only A+ test snapshot.",
  };
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
    read: async ({ context, seed, onProgress }) => {
      const totalAsins = new Set(seed.rows.flatMap((row) => row.asin ? [row.asin] : []))
        .size;
      onProgress({ completedAsins: totalAsins, totalAsins });
      return completedSnapshot({ context, seed });
    },
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
    const readAsins: string[][] = [];
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
        read: async ({ context, seed, onProgress }) => {
          readAsins.push(seed.rows.flatMap((row) => row.asin ? [row.asin] : []));
          onProgress({ completedAsins: 2, totalAsins: 2 });
          return completedSnapshot({
            context,
            seed,
            publishedAsins: new Set(["B000000001"]),
          });
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

    expect(readAsins).toEqual([["B000000001", "B000000002"]]);
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
        read: async ({ context, seed, onProgress }) => {
          onProgress({ completedAsins: 1, totalAsins: 2 });
          await secondGate;
          onProgress({ completedAsins: 2, totalAsins: 2 });
          return completedSnapshot({ context, seed });
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
        read: async ({ context, seed, heartbeat, onProgress }) => {
          await new Promise((resolve) => setTimeout(resolve, 750));
          heartbeat();
          await new Promise((resolve) => setTimeout(resolve, 750));
          onProgress({ completedAsins: 1, totalAsins: 1 });
          return completedSnapshot({ context, seed });
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
