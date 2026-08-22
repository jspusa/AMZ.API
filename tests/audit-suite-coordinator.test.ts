import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuditSuiteCoordinator,
  AuditSuiteCoordinatorError,
  createAuditSuiteResourceKey,
  type AuditSuiteHeartbeat,
  type AuditSuiteResourceKey,
  type AuditSuiteRunControl,
  type AuditSuiteSectionRunners,
} from "../src/main/amazon/audit-suite-coordinator";
import {
  createAuditSuiteState,
  parseAuditSuiteRun,
  storeAuditSuiteRun,
} from "../src/renderer/src/audit-suite";
import type { AuditSuiteContext } from "../src/shared/audit-suite";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const FETCHED_AT = "2026-08-17T00:00:00.000Z";

if (false) {
  const textKey = createAuditSuiteResourceKey<string>("text");
  // @ts-expect-error A resource token cannot be re-wrapped with another value type.
  const forged: AuditSuiteResourceKey<number> = { token: textKey.token };
  void forged;
}

function completed<T>(context: AuditSuiteContext, payload: T) {
  return {
    ...context,
    status: "completed" as const,
    fetchedAt: FETCHED_AT,
    notice: "完成。",
    payload,
  };
}

function advertisingRow(marker: number) {
  return {
    sellerSku: `SKU-${marker}`,
    title: `marker-${marker}`,
    asin: `B00000000${marker}`,
    finding: "已核對",
    evidence: "ENABLED SP",
    notice: "test",
  };
}

function sectionRunners(
  overrides: Partial<AuditSuiteSectionRunners> = {},
): AuditSuiteSectionRunners {
  return {
    content: async (context) => completed(context, []),
    image: async (context) => completed(context, []),
    variation: async (context) => completed(context, []),
    subscription: async (context) => completed(context, []),
    advertising: async (context) => completed(context, []),
    ...overrides,
  } as AuditSuiteSectionRunners;
}

function identity(run: ReturnType<AuditSuiteCoordinator["start"]>["run"]) {
  return {
    runId: run.runId,
    contextId: run.contextId,
    marketplaceId: run.marketplaceId,
    accountScope: "account-one",
    mode: run.mode,
  } as const;
}

async function flushCoordinator(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) await Promise.resolve();
}

describe("AuditSuiteCoordinator run ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not apply terminal retention to an active section and preserves measured progress", async () => {
    let control: AuditSuiteRunControl | null = null;
    let finishAdvertising: (() => void) | null = null;
    const advertisingGate = new Promise<void>((resolve) => {
      finishAdvertising = resolve;
    });
    const coordinator = new AuditSuiteCoordinator({
      ttlMs: 1_000,
      runners: sectionRunners({
        advertising: async (context, runControl) => {
          control = runControl;
          await advertisingGate;
          return completed(context, []);
        },
      }),
    });

    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(control).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_600);
    expect(coordinator.get(identity(started.run)).status).toBe("running");

    control!.heartbeat({
      message: "正在核對廣告覆蓋（1 / 2）。",
      completedUnits: 1,
      totalUnits: 2,
    });

    const running = coordinator.get(identity(started.run));
    expect(running.status).toBe("running");
    expect(running.sections.advertising).toMatchObject({
      status: "running",
      message: "正在核對廣告覆蓋（1 / 2）。",
      completedUnits: 1,
      totalUnits: 2,
    });
    const expected = {
      runId: running.runId,
      contextId: running.contextId,
      marketplaceId: running.marketplaceId,
      mode: running.mode,
    };
    let rendererState = createAuditSuiteState(parseAuditSuiteRun(running, expected));

    finishAdvertising!();
    await flushCoordinator();
    const finished = coordinator.get(identity(started.run));
    expect(finished.status).toBe("completed");
    expect(finished.sections.advertising).toMatchObject({
      status: "completed",
      completedUnits: 2,
      totalUnits: 2,
    });
    rendererState = storeAuditSuiteRun(
      rendererState,
      parseAuditSuiteRun(finished, expected),
    );
    expect(rendererState.runsByMarketplace[MARKETPLACE_ID]?.status).toBe("completed");

    await vi.advanceTimersByTimeAsync(999);
    expect(coordinator.get(identity(started.run)).status).toBe("completed");
    await vi.advanceTimersByTimeAsync(2);
    expect(() => coordinator.get(identity(started.run))).toThrowError(
      expect.objectContaining<Partial<AuditSuiteCoordinatorError>>({
        code: "AUDIT_SUITE_EXPIRED",
      }),
    );
  });

  it("single-flights typed resources within a run and isolates the next run", async () => {
    const resourceKey = createAuditSuiteResourceKey<{ marker: number }>(
      "verified-listings",
    );
    let loads = 0;
    const consume = async (control: AuditSuiteRunControl) => control.resource(
      resourceKey,
      async () => {
        loads += 1;
        return { marker: loads };
      },
    );
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        content: async (context, control) => {
          await consume(control);
          return completed(context, []);
        },
        image: async (context, control) => {
          await consume(control);
          return completed(context, []);
        },
      }),
    });

    const first = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect(coordinator.get(identity(first.run)).status).toBe("completed");
    expect(loads).toBe(1);

    const second = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect(coordinator.get(identity(second.run)).status).toBe("completed");
    expect(loads).toBe(2);
  });

  it("retains a shared resource rejection for dependent sections without failing independent sections", async () => {
    const resourceKey = createAuditSuiteResourceKey<{ marker: number }>(
      "rejected-listings",
    );
    let loads = 0;
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        content: async (context, control) => {
          await control.resource(resourceKey, async () => {
            loads += 1;
            throw new Error("shared listing evidence unavailable");
          });
          return completed(context, []);
        },
        image: async (context, control) => {
          await control.resource(resourceKey, async () => {
            loads += 1;
            return { marker: loads };
          });
          return completed(context, []);
        },
      }),
    });

    const first = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    const firstRun = coordinator.get(identity(first.run));
    expect(firstRun).toMatchObject({
      status: "partial",
      sections: {
        subscription: { status: "completed" },
        content: { status: "failed" },
        image: { status: "failed" },
      },
    });
    expect(loads).toBe(1);

    coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect(loads).toBe(2);
  });

  it("aborts active run controls when lifecycle cleanup clears the coordinator", async () => {
    let signal: AbortSignal | null = null;
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        advertising: async (_context, control) => {
          signal = control.signal;
          return await new Promise<never>(() => undefined);
        },
      }),
    });
    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect((signal as AbortSignal | null)?.aborted).toBe(false);

    coordinator.clear();

    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(() => coordinator.get(identity(started.run))).toThrowError(
      expect.objectContaining<Partial<AuditSuiteCoordinatorError>>({
        code: "AUDIT_SUITE_EXPIRED",
      }),
    );
  });

  it("ignores a cleared run's late resource and snapshot completion", async () => {
    const resourceKey = createAuditSuiteResourceKey<{ marker: number }>(
      "late-listings",
    );
    let loadCount = 0;
    let resolveOld!: (value: { marker: number }) => void;
    let resolveCurrent!: (value: { marker: number }) => void;
    const oldResource = new Promise<{ marker: number }>((resolve) => {
      resolveOld = resolve;
    });
    const currentResource = new Promise<{ marker: number }>((resolve) => {
      resolveCurrent = resolve;
    });
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        advertising: async (context, control) => {
          const resource = await control.resource(resourceKey, async () => {
            loadCount += 1;
            return loadCount === 1 ? oldResource : currentResource;
          });
          return completed(context, [advertisingRow(resource.marker)]);
        },
      }),
    });

    const oldRun = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect(loadCount).toBe(1);

    coordinator.clear();
    const currentRun = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect(loadCount).toBe(2);

    resolveOld({ marker: 1 });
    await flushCoordinator();
    expect(() => coordinator.get(identity(oldRun.run))).toThrowError(
      expect.objectContaining<Partial<AuditSuiteCoordinatorError>>({
        code: "AUDIT_SUITE_EXPIRED",
      }),
    );
    expect(coordinator.get(identity(currentRun.run))).toMatchObject({
      status: "running",
      sections: { advertising: { status: "running" } },
    });

    resolveCurrent({ marker: 2 });
    await flushCoordinator();
    expect(coordinator.get(identity(currentRun.run)).status).toBe("completed");
    expect(coordinator.workbookInput({
      ...identity(currentRun.run),
      marketplaceLabel: "US · United States",
    }).sections.advertising).toMatchObject({
      payload: [{ title: "marker-2" }],
    });
  });

  it("rejects a heartbeat that provides only one side of the progress fraction", async () => {
    let control: AuditSuiteRunControl | null = null;
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        advertising: async (_context, runControl) => {
          control = runControl;
          return await new Promise<never>(() => undefined);
        },
      }),
    });
    coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(() => control!.heartbeat({
      completedUnits: null,
      totalUnits: 1,
    } as unknown as AuditSuiteHeartbeat)).toThrow(/無效或倒退/u);
  });
});
