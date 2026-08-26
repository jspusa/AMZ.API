import { describe, expect, it, vi } from "vitest";
import { ContextBoundAuditSnapshotStore } from
  "../src/main/amazon/context-bound-audit-snapshot";
import {
  SpExecutionContextError,
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;

describe("context-bound audit snapshot store", () => {
  it("clones values and expires only the owning module instance", async () => {
    let now = 1_000;
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "snapshot-account-one",
    }));
    const store = new ContextBoundAuditSnapshotStore<{ rows: string[] }>({
      context,
      ttlMs: 10,
      now: () => now,
      createId: () => "10000000-0000-4000-8000-000000000001",
      expiredMessage: "快照已過期。",
    });
    const source = { rows: ["A"] };
    const snapshotId = store.publish({
      context: await context.capture(US),
      marketplaceId: US,
      snapshot: source,
    });
    source.rows.push("caller-mutation");

    const first = await store.read({ snapshotId, marketplaceId: US });
    first.rows.push("reader-mutation");
    await expect(store.read({ snapshotId, marketplaceId: US })).resolves.toEqual({
      rows: ["A"],
    });

    now = 1_010;
    await expect(store.read({ snapshotId, marketplaceId: US })).rejects.toMatchObject({
      status: 410,
      code: "SNAPSHOT_EXPIRED",
    });
  });

  it("cannot return a captured entry after clear wins an in-flight context check", async () => {
    let releaseAssertion: (() => void) | undefined;
    const assertionGate = new Promise<void>((resolve) => {
      releaseAssertion = resolve;
    });
    const base = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "snapshot-account-one",
    }));
    const context = {
      ...base,
      assertCurrent: vi.fn(async () => assertionGate),
    };
    const store = new ContextBoundAuditSnapshotStore<{ marker: string }>({
      context,
      ttlMs: 60_000,
      createId: () => "10000000-0000-4000-8000-000000000002",
      expiredMessage: "快照已過期。",
    });
    const snapshotId = store.publish({
      context: await context.capture(US),
      marketplaceId: US,
      snapshot: { marker: "stale" },
    });

    const reading = store.read({ snapshotId, marketplaceId: US });
    await vi.waitFor(() => expect(context.assertCurrent).toHaveBeenCalledOnce());
    store.clear();
    releaseAssertion?.();

    await expect(reading).rejects.toBeInstanceOf(SpExecutionContextError);
    await expect(reading).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });
});
