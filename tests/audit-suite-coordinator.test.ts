import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  AuditSuiteCoordinator,
  AuditSuiteCoordinatorError,
  createAuditSuiteResourceKey,
  type AuditSuiteHeartbeat,
  type AuditSuiteResourceKey,
  type AuditSuiteRunControl,
  type AuditSuiteSectionRunners,
} from "../src/main/amazon/audit-suite-coordinator";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import {
  createAuditSuiteState,
  parseAuditSuiteRun,
  storeAuditSuiteRun,
} from "../src/renderer/src/audit-suite";
import {
  AUDIT_SUITE_SECTION_IDS,
} from "../src/shared/audit-suite";
import type { AuditSuiteContext } from
  "../src/main/amazon/audit-suite-context";
import { createAuditSuiteWorkbook } from
  "../src/main/amazon/audit-suite-xlsx";

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
    aplus: async (context) => completed(context, []),
    variation: async (context) => completed(context, []),
    subscription: async (context) => completed(context, []),
    businessPricing: async (context) => completed(context, []),
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
    generation: 0,
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

  it("starts every canonical audit section in the same background run", async () => {
    const startedSections: string[] = [];
    const runners = Object.fromEntries(AUDIT_SUITE_SECTION_IDS.map((id) => [
      id,
      async (context: AuditSuiteContext) => {
        startedSections.push(id);
        return completed(context, []);
      },
    ])) as unknown as AuditSuiteSectionRunners;
    const coordinator = new AuditSuiteCoordinator({ runners });

    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();

    expect(startedSections).toEqual([...AUDIT_SUITE_SECTION_IDS]);
    expect(coordinator.get(identity(started.run))).toMatchObject({
      schemaVersion: 3,
      status: "completed",
    });
  });

  it("does not reuse or authorize a run from an older execution generation", () => {
    const coordinator = new AuditSuiteCoordinator({ runners: sectionRunners() });
    const first = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
      mode: "demo",
    });
    const second = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 1,
      mode: "demo",
    });

    expect(second.reused).toBe(false);
    expect(second.run.runId).not.toBe(first.run.runId);
    expect(() => coordinator.get({
      ...identity(first.run),
      generation: 1,
    })).toThrowError(expect.objectContaining({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    }));
    expect(coordinator.get({
      ...identity(second.run),
      generation: 1,
    })).toMatchObject({ runId: second.run.runId, status: "queued" });
  });

  it("rejects a section snapshot returned from an older execution generation", async () => {
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        advertising: async (context) => completed({
          ...context,
          generation: context.generation - 1,
        }, []),
      }),
    });
    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 1,
      mode: "demo",
    });

    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();

    expect(coordinator.get({
      ...identity(started.run),
      generation: 1,
    })).toMatchObject({
      status: "partial",
      sections: {
        advertising: {
          status: "failed",
          message: "advertising 健檢回傳 context 不一致。",
        },
      },
    });
  });

  it("renews an active run lease from heartbeat without expiring a legal long scan", async () => {
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
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(control).not.toBeNull();

    await vi.advanceTimersByTimeAsync(600);
    control!.heartbeat({
      message: "正在核對廣告覆蓋（1 / 2）。",
      completedUnits: 1,
      totalUnits: 2,
    });
    await vi.advanceTimersByTimeAsync(600);

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

  it("watchdogs a stale active run, aborts its control and retains a safe terminal result", async () => {
    let signal: AbortSignal | null = null;
    const coordinator = new AuditSuiteCoordinator({
      ttlMs: 1_000,
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
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect((signal as AbortSignal | null)?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1_001);
    const expired = coordinator.get(identity(started.run));
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(expired).toMatchObject({
      status: "partial",
      sections: {
        advertising: {
          status: "failed",
          message: "綜合健檢超過安全執行期限，已由 Notebook 鑰匙停止。",
        },
      },
    });

    await vi.advanceTimersByTimeAsync(1_001);
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
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect(coordinator.get(identity(first.run)).status).toBe("completed");
    expect(loads).toBe(1);

    const second = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
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
      generation: 0,
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
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect(loads).toBe(2);
  });

  it("sanitizes a failed section before its notice crosses to the renderer", async () => {
    const hostile = [
      "Bearer private-access-token",
      "accountScope=private-account",
      "reportId=private-report",
      "https://example.invalid/private?client_secret=private-secret",
      "HOSTILE-CANARY\u202e\u0000",
    ].join(" ");
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        content: async () => {
          throw new SpApiError(hostile, {
            requestId: "Atza|private-token",
          });
        },
      }),
    });
    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();

    const run = coordinator.get(identity(started.run));
    const serialized = JSON.stringify(run.sections.content);
    expect(run.sections.content).toMatchObject({
      status: "failed",
      message: "此項健檢未能建立可核對快照。",
    });
    expect(serialized).not.toMatch(
      /Bearer|access.?token|accountScope|reportId|client.?secret|https?:|HOSTILE-CANARY|Atza|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/iu,
    );
  });

  it("keeps an empty runner failure exportable with the fixed public fallback", async () => {
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        content: async () => {
          throw new Error("");
        },
      }),
    });
    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();

    const run = coordinator.get(identity(started.run));
    expect(run.sections.content).toMatchObject({
      status: "failed",
      message: "此項健檢未能建立可核對快照。",
    });
    const input = coordinator.workbookInput({
      ...identity(started.run),
      marketplaceLabel: "US · United States",
    });
    expect(() => createAuditSuiteWorkbook(input)).not.toThrow();
  });

  it("fails a non-array section payload closed before public publication", async () => {
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        advertising: (async (context: AuditSuiteContext) => ({
          ...context,
          status: "partial",
          fetchedAt: FETCHED_AT,
          notice: "partial",
          payload: {
            rows: [],
            reportId: "private-report.NON_ARRAY_PAYLOAD_CANARY",
          },
        })) as unknown as AuditSuiteSectionRunners["advertising"],
      }),
    });
    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();

    const run = coordinator.get(identity(started.run));
    const serialized = JSON.stringify(run.sections.advertising);
    expect(run.sections.advertising).toMatchObject({
      status: "failed",
      message: "此項健檢未能建立可核對快照。",
    });
    expect(serialized).not.toContain("NON_ARRAY_PAYLOAD_CANARY");
  });

  it("fails an unknown runtime section status closed before GET publication", async () => {
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        advertising: (async (context: AuditSuiteContext) => ({
          ...context,
          status: "Bearer STATUS_CANARY",
          fetchedAt: FETCHED_AT,
          notice: "unexpected runtime status",
          payload: [],
        })) as unknown as AuditSuiteSectionRunners["advertising"],
      }),
    });
    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();

    const run = coordinator.get(identity(started.run));
    const serialized = JSON.stringify(run.sections.advertising);
    expect(run.sections.advertising).toMatchObject({
      status: "failed",
      message: "此項健檢未能建立可核對快照。",
    });
    expect(serialized).not.toContain("STATUS_CANARY");
  });

  it("sanitizes a partial section notice and message fields before GET or XLSX publication", async () => {
    const hostile = [
      "Bearer private-access-token",
      "accountScope=private-account",
      "reportId=private-report",
      "documentId=private-document",
      "https://example.invalid/private?client_secret=private-secret",
      "PARTIAL-HOSTILE-CANARY\u202e\u0000",
    ].join(" ");
    const coordinator = new AuditSuiteCoordinator({
      runners: sectionRunners({
        advertising: async (context) => ({
          ...context,
          status: "partial",
          fetchedAt: FETCHED_AT,
          notice: hostile,
          payload: [{
            sellerSku: "SAFE-SKU",
            title: "Safe title",
            asin: "B000000001",
            finding: "資料未完成",
            evidence: hostile,
            notice: hostile,
          }],
        }),
      }),
    });
    const started = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();

    const run = coordinator.get(identity(started.run));
    const workbookInput = coordinator.workbookInput({
      ...identity(started.run),
      marketplaceLabel: "US · United States",
    });
    const workbook = createAuditSuiteWorkbook(workbookInput);
    const xlsxText = Object.values(unzipSync(workbook))
      .map((file) => strFromU8(file))
      .join("\n");
    const publicStatus = JSON.stringify(run.sections.advertising);

    expect(run).toMatchObject({
      status: "partial",
      sections: { advertising: { status: "partial" } },
    });
    expect(publicStatus).not.toMatch(
      /Bearer|access.?token|accountScope|reportId|documentId|client.?secret|https?:|PARTIAL-HOSTILE-CANARY|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/iu,
    );
    for (const canary of [
      "private-access-token",
      "private-account",
      "private-report",
      "private-document",
      "private-secret",
      "PARTIAL-HOSTILE-CANARY",
    ]) {
      expect(xlsxText).not.toContain(canary);
    }
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
      generation: 0,
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
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushCoordinator();
    expect(loadCount).toBe(1);

    coordinator.clear();
    const currentRun = coordinator.start({
      marketplaceId: MARKETPLACE_ID,
      accountScope: "account-one",
      generation: 0,
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
      generation: 0,
      mode: "demo",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(() => control!.heartbeat({
      completedUnits: null,
      totalUnits: 1,
    } as unknown as AuditSuiteHeartbeat)).toThrow(/無效或倒退/u);
  });
});
