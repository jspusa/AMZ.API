import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StandaloneAuditJobCoordinator,
  StandaloneAuditJobCoordinatorError,
  type StandaloneAuditJobGateway,
} from "../src/main/amazon/standalone-audit-job";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

async function flushBackgroundJob(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function gateway(
  overrides: Partial<StandaloneAuditJobGateway> = {},
): StandaloneAuditJobGateway {
  return {
    bindContext: async ({ marketplaceId, mode }) => ({
      accountScope: "internal-account-scope-one",
      generation: 0,
      marketplaceId,
      mode,
    }),
    run: async ({ kind, context, updateProgress }) => {
      updateProgress({
        stage: "complete",
        message: "完成",
        completedUnits: 1,
        totalUnits: 1,
      });
      return { kind, marketplaceId: context.marketplaceId, rows: [] };
    },
    ...overrides,
  };
}

describe("standalone audit background job coordinator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the main-owned audit running after its drawer observer disappears", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const coordinator = new StandaloneAuditJobCoordinator({
      gateway: gateway({
        run: async ({ context, updateProgress }) => {
          updateProgress({
            stage: "amazon_report",
            message: "正在取得 Amazon 資料",
            completedUnits: 1,
            totalUnits: 2,
          });
          await gate;
          return { marketplaceId: context.marketplaceId, rows: ["done"] };
        },
      }),
    });

    const started = await coordinator.start({
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    expect(started).toMatchObject({
      kind: "content",
      status: "queued",
      ready: false,
      progress: {
        stage: "queued",
        completedUnits: 0,
        totalUnits: null,
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await flushBackgroundJob();
    // Simulate closing the drawer: no renderer request remains attached.
    finish();
    await flushBackgroundJob();

    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).resolves.toMatchObject({
      jobId: started.jobId,
      contextId: started.contextId,
      ready: true,
      status: "completed",
      snapshot: { marketplaceId: MARKETPLACE_ID, rows: ["done"] },
    });
  });

  it("single-flights only an exact audit selection including S&S months", async () => {
    const coordinator = new StandaloneAuditJobCoordinator({
      gateway: gateway({
        run: async () => await new Promise<never>(() => undefined),
      }),
    });
    const first = await coordinator.start({
      kind: "subscription",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      options: { months: 6 },
    });
    const same = await coordinator.start({
      kind: "subscription",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      options: { months: 6 },
    });
    const different = await coordinator.start({
      kind: "subscription",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      options: { months: 12 },
    });

    expect(same.jobId).toBe(first.jobId);
    expect(different.jobId).not.toBe(first.jobId);
  });

  it("invalidates and aborts an active audit when the bound account changes", async () => {
    let accountScope = "internal-account-scope-one";
    let jobSignal: AbortSignal | null = null;
    const coordinator = new StandaloneAuditJobCoordinator({
      gateway: gateway({
        bindContext: async ({ marketplaceId, mode }) => ({
          accountScope,
          generation: 0,
          marketplaceId,
          mode,
        }),
        run: async ({ signal }) => {
          jobSignal = signal;
          return await new Promise<never>(() => undefined);
        },
      }),
    });
    const started = await coordinator.start({
      kind: "businessPricing",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect((jobSignal as AbortSignal | null)?.aborted).toBe(false);

    accountScope = "internal-account-scope-two";
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      kind: "businessPricing",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).rejects.toEqual(expect.objectContaining<Partial<StandaloneAuditJobCoordinatorError>>({
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    }));
    expect((jobSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("extends an active TTL on progress, retains a terminal result, then expires it", async () => {
    let updateProgress!: StandaloneAuditJobGateway["run"] extends
      (input: infer Input) => unknown
      ? Input extends { updateProgress: infer Update }
        ? Update
        : never
      : never;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const coordinator = new StandaloneAuditJobCoordinator({
      ttlMs: 1_000,
      gateway: gateway({
        run: async (input) => {
          updateProgress = input.updateProgress;
          await gate;
          return { rows: [] };
        },
      }),
    });
    const started = await coordinator.start({
      kind: "image",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(750);
    updateProgress({
      stage: "listing_rows",
      message: "正在核對圖片",
      completedUnits: 1,
      totalUnits: 2,
    });
    await vi.advanceTimersByTimeAsync(750);
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      kind: "image",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).resolves.toMatchObject({
      ready: false,
      status: "running",
      progress: { completedUnits: 1, totalUnits: 2 },
    });
    finish();
    await flushBackgroundJob();

    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      kind: "image",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).resolves.toMatchObject({ status: "completed" });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(coordinator.get({
      jobId: started.jobId,
      contextId: started.contextId,
      kind: "image",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).rejects.toEqual(expect.objectContaining({
      status: 410,
      code: "STANDALONE_AUDIT_JOB_EXPIRED",
    }));
  });
});
