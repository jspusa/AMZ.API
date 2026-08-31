import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  SpApiError,
  SpApiPreCommitError,
} from "../src/main/amazon/sp-api-error";
import {
  CONTENT_AUDIT_SNAPSHOT_TTL_MS,
  LocalStore,
  sharedFbaShipmentSalesOptionsKey,
} from "../src/main/local-store";

async function testStore(): Promise<LocalStore> {
  const directory = await mkdtemp(join(tmpdir(), "fba-os-store-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  return store;
}

describe("local durable safety store", () => {
  it("persists FBA replenishment settings", async () => {
    const store = await testStore();
    const saved = await store.saveProductMaster({
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "SAFE-SKU-1",
      settings: {
        casePack: 24,
        cartonsPerPallet: 40,
        leadTimeDays: 30,
        safetyDays: 14,
        targetDays: 60,
        supplyRoute: "DIRECT_FBA",
        awdBufferDays: 20,
        shelfLifeDays: 730,
        minimumRemainingDays: 365,
        factory: "Factory A",
        notes: "FBA only",
      },
    });
    expect(saved.persistence).toBe("durable");
    expect(saved.profile.settingsConfigured).toBe(true);

    const loaded = await store.getProductMaster(
      "account-a",
      "ATVPDKIKX0DER",
      "SAFE-SKU-1",
    );
    expect(loaded.profile.casePack).toBe(24);
    expect(loaded.profile.supplyRoute).toBe("DIRECT_FBA");
  });

  it("returns a completed idempotent write without executing twice", async () => {
    const store = await testStore();
    let executions = 0;
    const operation = () =>
      store.runIdempotentOperation({
        idempotencyKey: "price-test-12345",
        operationType: "price",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "SAFE-SKU-1",
        accountScope: "account-a",
        fingerprint: "same-operation",
        execute: async () => ({ execution: ++executions }),
      });

    await expect(operation()).resolves.toEqual({ execution: 1 });
    await expect(operation()).resolves.toEqual({ execution: 1 });
    expect(executions).toBe(1);
  });

  it("never replays a completed write under a new key because Amazon may have changed externally", async () => {
    const store = await testStore();
    let executions = 0;
    const base = {
      operationType: "price" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "SAFE-SKU-1",
      accountScope: "account-a",
      fingerprint: "same-account-sku-before-after",
    };
    await expect(
      store.runIdempotentOperation({
        ...base,
        idempotencyKey: "price-first-12345",
        execute: async () => ({ execution: ++executions }),
      }),
    ).resolves.toEqual({ execution: 1 });
    await expect(
      store.runIdempotentOperation({
        ...base,
        idempotencyKey: "price-second-12345",
        execute: async () => ({ execution: ++executions }),
      }),
    ).resolves.toEqual({ execution: 2 });
    expect(executions).toBe(2);
  });

  it("does not replay an old completed result after a newer resource generation", async () => {
    const store = await testStore();
    let executions = 0;
    const run = (key: string, fingerprint: string) =>
      store.runIdempotentOperation({
        idempotencyKey: key,
        operationType: "price",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "PRICE-CYCLE",
        accountScope: "account-a",
        fingerprint,
        execute: async () => ({ execution: ++executions }),
      });

    await expect(run("price-a-to-b-first", "A-to-B")).resolves.toEqual({ execution: 1 });
    await expect(run("price-b-to-a", "B-to-A")).resolves.toEqual({ execution: 2 });
    await expect(run("price-a-to-b-second", "A-to-B")).resolves.toEqual({ execution: 3 });
  });

  it("never reuses a cached result across seller account scopes", async () => {
    const store = await testStore();
    let executions = 0;
    const base = {
      operationType: "price" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "SAME-SKU",
      fingerprint: "same-price-change",
    };
    await store.runIdempotentOperation({
      ...base,
      accountScope: "account-a",
      idempotencyKey: "account-a-key-123",
      execute: async () => ({ execution: ++executions }),
    });
    await expect(
      store.runIdempotentOperation({
        ...base,
        accountScope: "account-b",
        idempotencyKey: "account-b-key-123",
        execute: async () => ({ execution: ++executions }),
      }),
    ).resolves.toEqual({ execution: 2 });
  });

  it("blocks an idempotency key reused for different content", async () => {
    const store = await testStore();
    const shared = {
      idempotencyKey: "content-test-12345",
      operationType: "content" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "SAFE-SKU-1",
      accountScope: "account-a",
    };
    await store.runIdempotentOperation({
      ...shared,
      fingerprint: "first",
      execute: async () => ({ ok: true }),
    });
    await expect(
      store.runIdempotentOperation({
        ...shared,
        fingerprint: "tampered",
        execute: async () => ({ ok: false }),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });

  it.each([
    ["operation", { operationType: "sale_price" as const }],
    ["marketplace", { marketplaceId: "A1F83G8C2ARO7P" }],
    ["seller SKU", { sellerSku: "OTHER-SKU" }],
    ["account scope", { accountScope: "account-b" }],
  ])("binds a completed idempotency key to the original %s", async (
    _label,
    changed,
  ) => {
    const store = await testStore();
    const original = {
      idempotencyKey: "exact-ledger-binding-123",
      operationType: "price" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "SAFE-SKU-1",
      accountScope: "account-a",
      fingerprint: "same-proposal-fingerprint",
    };
    await store.runIdempotentOperation({
      ...original,
      execute: async () => ({ source: "original" }),
    });

    await expect(store.runIdempotentOperation({
      ...original,
      ...changed,
      execute: async () => ({ source: "changed" }),
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });

  it("locks a pending variation SKU across different fingerprints and targets", async () => {
    const store = await testStore();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const first = store.runIdempotentOperation({
      idempotencyKey: "variation-pending-first",
      operationType: "variation_detach",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "CHILD-LOCKED",
      accountScope: "account-a",
      fingerprint: "detach-from-parent-a",
      execute: async () => {
        started();
        await gate;
        return { ok: true };
      },
    });
    await didStart;

    await expect(
      store.runIdempotentOperation({
        idempotencyKey: "variation-pending-second",
        operationType: "variation_attach",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "CHILD-LOCKED",
        accountScope: "account-a",
        fingerprint: "attach-to-parent-b",
        execute: async () => ({ shouldNotRun: true }),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });

    release();
    await expect(first).resolves.toEqual({ ok: true });
  });

  it("keeps a variation SKU locked after an unknown 429 commit result", async () => {
    const store = await testStore();
    await expect(
      store.runIdempotentOperation({
        idempotencyKey: "variation-unknown-first",
        operationType: "variation_detach",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "CHILD-UNKNOWN",
        accountScope: "account-a",
        fingerprint: "detach-parent-a",
        execute: async () => {
          throw new SpApiError("Amazon commit returned 429", {
            status: 429,
            code: "UPDATE_STATUS_UNKNOWN",
          });
        },
      }),
    ).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN", status: 429 });

    await expect(
      store.runIdempotentOperation({
        idempotencyKey: "variation-unknown-second",
        operationType: "variation_attach",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "CHILD-UNKNOWN",
        accountScope: "account-a",
        fingerprint: "attach-parent-b",
        execute: async () => ({ shouldNotRun: true }),
      }),
    ).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN", status: 409 });
  });

  it("never expires unknown write evidence or permits an overlapping offer write", async () => {
    const originalNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(originalNow));
    const store = await testStore();
    try {
      await expect(store.runIdempotentOperation({
        idempotencyKey: "price-unknown-persistent",
        operationType: "price",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "OFFER-UNKNOWN",
        accountScope: "account-a",
        fingerprint: "price-change",
        execute: async () => {
          throw new SpApiError("accepted but readback timed out", {
            status: 503,
            code: "UPDATE_STATUS_UNKNOWN",
          });
        },
      })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

      vi.setSystemTime(new Date(originalNow + 48 * 60 * 60 * 1_000));
      const restarted = new LocalStore(store.filePath);
      await restarted.initialize();
      await expect(restarted.runIdempotentOperation({
        idempotencyKey: "sale-after-unknown-price",
        operationType: "sale_price",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "OFFER-UNKNOWN",
        accountScope: "account-a",
        fingerprint: "sale-change",
        execute: async () => ({ shouldNotRun: true }),
      })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN", status: 409 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows one explicit duplicate-tier repair over an unknown Business Price write", async () => {
    const store = await testStore();
    await expect(store.runIdempotentOperation({
      idempotencyKey: "business-price-unknown-before-duplicate-repair",
      operationType: "business_price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-DUPLICATE-REPAIR",
      accountScope: "account-a",
      fingerprint: "accepted-merge-with-duplicate-tiers",
      execute: async () => {
        throw new SpApiError("accepted but duplicate readback", {
          status: 503,
          code: "UPDATE_STATUS_UNKNOWN",
        });
      },
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    await expect(store.runIdempotentOperation({
      idempotencyKey: "business-price-duplicate-repair",
      operationType: "business_price",
      businessPriceDuplicateRepair: true,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-DUPLICATE-REPAIR",
      accountScope: "account-a",
      fingerprint: "replace-identical-duplicate-tiers-once",
      execute: async () => ({ repaired: true }),
    })).resolves.toEqual({ repaired: true });

    const persisted = JSON.parse(await readFile(store.filePath, "utf8")) as {
      ledger: Record<string, {
        operationType: string;
        businessPriceDuplicateRepair?: boolean;
      }>;
    };
    expect(persisted.ledger["business-price-duplicate-repair"]).toMatchObject({
      operationType: "business_price",
      businessPriceDuplicateRepair: true,
    });

    await expect(store.runIdempotentOperation({
      idempotencyKey: "business-price-duplicate-repair",
      operationType: "business_price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-DUPLICATE-REPAIR",
      accountScope: "account-a",
      fingerprint: "replace-identical-duplicate-tiers-once",
      execute: async () => ({ shouldNotReplayAsNormalWrite: true }),
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });

    await expect(store.runIdempotentOperation({
      idempotencyKey: "price-after-unreconciled-business-repair",
      operationType: "price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-DUPLICATE-REPAIR",
      accountScope: "account-a",
      fingerprint: "must-remain-blocked-until-canonical-reconcile",
      execute: async () => ({ shouldNotRun: true }),
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN", status: 409 });
  });

  it("does not allow a duplicate-tier repair over a pending or prior repair write", async () => {
    const store = await testStore();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const pending = store.runIdempotentOperation({
      idempotencyKey: "business-price-pending-before-repair",
      operationType: "business_price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-PENDING-REPAIR",
      accountScope: "account-a",
      fingerprint: "pending-business-price",
      execute: async () => {
        started();
        await gate;
        return { ok: true };
      },
    });
    await didStart;

    await expect(store.runIdempotentOperation({
      idempotencyKey: "repair-while-business-price-pending",
      operationType: "business_price",
      businessPriceDuplicateRepair: true,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-PENDING-REPAIR",
      accountScope: "account-a",
      fingerprint: "must-not-overlap-pending",
      execute: async () => ({ shouldNotRun: true }),
    })).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });

    release();
    await expect(pending).resolves.toEqual({ ok: true });

    await expect(store.runIdempotentOperation({
      idempotencyKey: "first-unknown-repair",
      operationType: "business_price",
      businessPriceDuplicateRepair: true,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-REPAIR-UNKNOWN",
      accountScope: "account-a",
      fingerprint: "first-repair",
      execute: async () => {
        throw new SpApiError("repair result unknown", {
          status: 503,
          code: "UPDATE_STATUS_UNKNOWN",
        });
      },
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    await expect(store.runIdempotentOperation({
      idempotencyKey: "second-repair-after-unknown-repair",
      operationType: "business_price",
      businessPriceDuplicateRepair: true,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-REPAIR-UNKNOWN",
      accountScope: "account-a",
      fingerprint: "must-not-blindly-repair-again",
      execute: async () => ({ shouldNotRun: true }),
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN", status: 409 });
  });

  it("never bypasses a legacy unknown-account offer write for duplicate repair", async () => {
    const store = await testStore();
    await expect(store.runIdempotentOperation({
      idempotencyKey: "legacy-account-business-price-unknown",
      operationType: "business_price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-LEGACY-ACCOUNT-UNKNOWN",
      accountScope: "legacy-unknown",
      fingerprint: "legacy-account-unknown-write",
      execute: async () => {
        throw new SpApiError("legacy write result unknown", {
          status: 503,
          code: "UPDATE_STATUS_UNKNOWN",
        });
      },
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    await expect(store.runIdempotentOperation({
      idempotencyKey: "repair-over-legacy-account-unknown",
      operationType: "business_price",
      businessPriceDuplicateRepair: true,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-LEGACY-ACCOUNT-UNKNOWN",
      accountScope: "current-account",
      fingerprint: "must-not-cross-account-boundary",
      execute: async () => ({ shouldNotRun: true }),
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN", status: 409 });
  });

  it("keeps a repair tombstone through old reconciliation and pruning", async () => {
    const originalNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(originalNow));
    const store = await testStore();
    try {
      await expect(store.runIdempotentOperation({
        idempotencyKey: "unknown-before-permanent-repair-marker",
        operationType: "business_price",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "B2B-PERMANENT-REPAIR-MARKER",
        accountScope: "account-a",
        fingerprint: "unknown-before-repair",
        execute: async () => {
          throw new SpApiError("accepted but duplicate readback", {
            status: 503,
            code: "UPDATE_STATUS_UNKNOWN",
          });
        },
      })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

      await expect(store.runIdempotentOperation({
        idempotencyKey: "permanent-completed-repair-marker",
        operationType: "business_price",
        businessPriceDuplicateRepair: true,
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "B2B-PERMANENT-REPAIR-MARKER",
        accountScope: "account-a",
        fingerprint: "repair-once-only",
        execute: async ({ recordAccepted }) => {
          await recordAccepted({ status: "DISPATCHED" });
          throw new SpApiError("repair accepted but readback unknown", {
            status: 503,
            code: "UPDATE_STATUS_UNKNOWN",
          });
        },
      })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

      vi.setSystemTime(new Date(originalNow + 60 * 60 * 1_000));
      const rollbackData = JSON.parse(
        await readFile(store.filePath, "utf8"),
      ) as {
        ledger: Record<string, {
          state: string;
          expiresAt: number;
          businessPriceDuplicateRepair?: boolean;
        }>;
      };
      const shadowTombstone = Object.entries(rollbackData.ledger).find(
        ([key, entry]) =>
          key.startsWith("business-price-repair-tombstone:") &&
          entry.businessPriceDuplicateRepair === true,
      );
      expect(shadowTombstone?.[1]).toMatchObject({
        state: "completed",
        expiresAt: Number.MAX_SAFE_INTEGER,
      });
      // Simulate v0.1.41 reconciling the unknown repair as an ordinary
      // business_price write. The old code overwrites that receipt's expiry,
      // but cannot touch the already-completed permanent shadow tombstone.
      const oldRepairReceipt =
        rollbackData.ledger["permanent-completed-repair-marker"]!;
      expect(oldRepairReceipt).toMatchObject({
        state: "unknown",
        businessPriceDuplicateRepair: true,
      });
      oldRepairReceipt.state = "completed";
      oldRepairReceipt.expiresAt = Date.now() + 24 * 60 * 60 * 1_000;
      vi.setSystemTime(new Date(originalNow + 72 * 60 * 60 * 1_000));
      // Simulate v0.1.41's old completed-entry prune after that reconciliation.
      for (const [key, entry] of Object.entries(rollbackData.ledger)) {
        if (entry.state === "completed" && entry.expiresAt < Date.now()) {
          delete rollbackData.ledger[key];
        }
      }
      await writeFile(store.filePath, `${JSON.stringify(rollbackData, null, 2)}\n`);
      expect(rollbackData.ledger["permanent-completed-repair-marker"])
        .toBeUndefined();
      expect(rollbackData.ledger[shadowTombstone![0]]).toBeDefined();
      const restarted = new LocalStore(store.filePath);
      await restarted.initialize();
      await expect(restarted.runIdempotentOperation({
        idempotencyKey: "second-repair-after-marker-ttl",
        operationType: "business_price",
        businessPriceDuplicateRepair: true,
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "B2B-PERMANENT-REPAIR-MARKER",
        accountScope: "account-a",
        fingerprint: "must-never-repair-twice",
        execute: async () => ({ shouldNotRun: true }),
      })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN", status: 409 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the repair tombstone when commit transport definitely did not start", async () => {
    const store = await testStore();
    await expect(store.runIdempotentOperation({
      idempotencyKey: "unknown-before-precommit-repair",
      operationType: "business_price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-PRECOMMIT-REPAIR",
      accountScope: "account-a",
      fingerprint: "unknown-before-precommit-repair",
      execute: async () => {
        throw new SpApiError("accepted but duplicate readback", {
          status: 503,
          code: "UPDATE_STATUS_UNKNOWN",
        });
      },
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    await expect(store.runIdempotentOperation({
      idempotencyKey: "repair-that-stops-before-transport",
      operationType: "business_price",
      businessPriceDuplicateRepair: true,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-PRECOMMIT-REPAIR",
      accountScope: "account-a",
      fingerprint: "precommit-repair",
      execute: async () => {
        throw new SpApiPreCommitError(new SpApiError(
          "Final fence stopped the commit before transport.",
          { status: 409, code: "PREVIEW_CHANGED" },
        ));
      },
    })).rejects.toMatchObject({
      code: "PREVIEW_CHANGED",
      commitPatchSent: false,
    });

    const persisted = JSON.parse(await readFile(store.filePath, "utf8")) as {
      ledger: Record<string, { businessPriceDuplicateRepair?: boolean }>;
    };
    expect(Object.values(persisted.ledger).filter(
      (entry) => entry.businessPriceDuplicateRepair === true,
    )).toHaveLength(0);

    await expect(store.runIdempotentOperation({
      idempotencyKey: "repair-after-known-precommit-stop",
      operationType: "business_price",
      businessPriceDuplicateRepair: true,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "B2B-PRECOMMIT-REPAIR",
      accountScope: "account-a",
      fingerprint: "safe-repair-after-precommit-stop",
      execute: async () => ({ repaired: true }),
    })).resolves.toEqual({ repaired: true });
  });

  it("locks standard and sale price writes while a Business Price write is pending", async () => {
    const store = await testStore();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const businessPrice = store.runIdempotentOperation({
      idempotencyKey: "business-price-pending",
      operationType: "business_price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "OFFER-B2B-LOCK",
      accountScope: "account-a",
      fingerprint: "business-price-change",
      execute: async () => {
        started();
        await gate;
        return { ok: true };
      },
    });
    await didStart;

    for (const operationType of ["price", "sale_price"] as const) {
      await expect(store.runIdempotentOperation({
        idempotencyKey: `${operationType}-while-business-price-pending`,
        operationType,
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "OFFER-B2B-LOCK",
        accountScope: "account-a",
        fingerprint: `${operationType}-change`,
        execute: async () => ({ shouldNotRun: true }),
      })).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });
    }

    release();
    await expect(businessPrice).resolves.toEqual({ ok: true });
  });

  it("locks a Business Price write while a standard or sale price write is pending", async () => {
    const store = await testStore();

    for (const operationType of ["price", "sale_price"] as const) {
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const didStart = new Promise<void>((resolve) => { started = resolve; });
      const existingOfferWrite = store.runIdempotentOperation({
        idempotencyKey: `${operationType}-pending-before-business`,
        operationType,
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: `OFFER-${operationType}-LOCK`,
        accountScope: "account-a",
        fingerprint: `${operationType}-change`,
        execute: async () => {
          started();
          await gate;
          return { ok: true };
        },
      });
      await didStart;

      await expect(store.runIdempotentOperation({
        idempotencyKey: `business-price-while-${operationType}-pending`,
        operationType: "business_price",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: `OFFER-${operationType}-LOCK`,
        accountScope: "account-a",
        fingerprint: "business-price-change",
        execute: async () => ({ shouldNotRun: true }),
      })).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });

      release();
      await expect(existingOfferWrite).resolves.toEqual({ ok: true });
    }
  });

  it("reconciles a persisted accepted receipt through a later canonical GET", async () => {
    const store = await testStore();
    const accepted = { requested: 12.34, status: "ACCEPTED" };
    await expect(store.runIdempotentOperation({
      idempotencyKey: "price-accepted-awaiting-readback",
      operationType: "price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "PRICE-RECONCILE",
      accountScope: "account-a",
      fingerprint: "price-target",
      execute: async ({ recordAccepted }) => {
        await recordAccepted(accepted);
        throw new SpApiError("readback timed out", {
          status: 503,
          code: "UPDATE_STATUS_UNKNOWN",
        });
      },
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    await expect(store.reconcileIdempotentOperations({
      operationTypes: ["price"],
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "PRICE-RECONCILE",
      accountScope: "account-b",
      reconcile: () => ({ shouldNotCrossAccount: true }),
    })).resolves.toBe(0);
    await expect(store.reconcileIdempotentOperations({
      operationTypes: ["price"],
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "PRICE-RECONCILE",
      accountScope: "account-a",
      reconcile: (response) => ({ ...response as object, verified: true }),
    })).resolves.toBe(1);

    const execute = vi.fn(async () => ({ shouldNotRun: true }));
    await expect(store.runIdempotentOperation({
      idempotencyKey: "price-accepted-awaiting-readback",
      operationType: "price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "PRICE-RECONCILE",
      accountScope: "account-a",
      fingerprint: "price-target",
      execute,
    })).resolves.toMatchObject({ status: "ACCEPTED", verified: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it("locks content and image PATCHes as one listing-attribute resource", async () => {
    const store = await testStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const content = store.runIdempotentOperation({
      idempotencyKey: "content-pending-resource",
      operationType: "content",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ATTRIBUTE-LOCK",
      accountScope: "account-a",
      fingerprint: "content-change",
      execute: async () => {
        await gate;
        return { ok: true };
      },
    });
    await vi.waitFor(async () => {
      const raw = await readFile(store.filePath, "utf8");
      expect(raw).toContain("content-pending-resource");
    });
    await expect(store.runIdempotentOperation({
      idempotencyKey: "images-during-content",
      operationType: "images",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ATTRIBUTE-LOCK",
      accountScope: "account-a",
      fingerprint: "image-change",
      execute: async () => ({ shouldNotRun: true }),
    })).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });
    release();
    await expect(content).resolves.toEqual({ ok: true });
  });

  it("preflights every batch content ledger target before the first write", async () => {
    const store = await testStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = store.runIdempotentOperation({
      idempotencyKey: "existing-image-pending",
      operationType: "images",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "BATCH-LOCKED",
      accountScope: "account-a",
      fingerprint: "existing-image-change",
      execute: async () => {
        await gate;
        return { ok: true };
      },
    });
    await vi.waitFor(async () => {
      const raw = await readFile(store.filePath, "utf8");
      expect(raw).toContain("existing-image-pending");
    });

    await expect(store.assertIdempotentOperationsAvailable([
      {
        idempotencyKey: "batch-content-safe",
        operationType: "content",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "BATCH-SAFE",
        accountScope: "account-a",
        fingerprint: "safe-change",
      },
      {
        idempotencyKey: "batch-content-locked",
        operationType: "content",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "BATCH-LOCKED",
        accountScope: "account-a",
        fingerprint: "locked-change",
      },
    ])).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS", status: 409 });

    const raw = await readFile(store.filePath, "utf8");
    expect(raw).not.toContain("batch-content-safe");
    expect(raw).not.toContain("batch-content-locked");
    release();
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("accepts an exact completed row during batch ledger preflight", async () => {
    const store = await testStore();
    const operation = {
      idempotencyKey: "batch-content-completed",
      operationType: "content" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "BATCH-COMPLETED",
      accountScope: "account-a",
      fingerprint: "completed-change",
    };
    await store.runIdempotentOperation({
      ...operation,
      execute: async () => ({ ok: true }),
    });
    await expect(
      store.assertIdempotentOperationsAvailable([operation]),
    ).resolves.toBeUndefined();
  });

  it("allows the attach stage after the detach stage is durably completed", async () => {
    const store = await testStore();
    const base = {
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "CHILD-TWO-STAGE",
      accountScope: "account-a",
    };
    await expect(
      store.runIdempotentOperation({
        ...base,
        idempotencyKey: "variation-detach-completed",
        operationType: "variation_detach",
        fingerprint: "detach-parent-a",
        execute: async () => ({ stage: "detached" }),
      }),
    ).resolves.toEqual({ stage: "detached" });

    await expect(
      store.runIdempotentOperation({
        ...base,
        idempotencyKey: "variation-attach-after-completed",
        operationType: "variation_attach",
        fingerprint: "attach-parent-b",
        execute: async () => ({ stage: "attached" }),
      }),
    ).resolves.toEqual({ stage: "attached" });
  });

  it("re-executes a newly previewed variation cycle instead of replaying a different key", async () => {
    const store = await testStore();
    let detachExecutions = 0;
    const base = {
      operationType: "variation_detach" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "CHILD-REPEATED-CYCLE",
      accountScope: "account-a",
      fingerprint: "detach-parent-a",
    };
    await expect(
      store.runIdempotentOperation({
        ...base,
        idempotencyKey: "variation-cycle-one-detach",
        execute: async () => ({ execution: ++detachExecutions }),
      }),
    ).resolves.toEqual({ execution: 1 });
    await store.runIdempotentOperation({
      operationType: "variation_attach",
      marketplaceId: base.marketplaceId,
      sellerSku: base.sellerSku,
      accountScope: base.accountScope,
      fingerprint: "attach-parent-b",
      idempotencyKey: "variation-cycle-one-attach",
      execute: async () => ({ attached: true }),
    });
    await expect(
      store.runIdempotentOperation({
        ...base,
        idempotencyKey: "variation-cycle-two-detach",
        execute: async () => ({ execution: ++detachExecutions }),
      }),
    ).resolves.toEqual({ execution: 2 });
    expect(detachExecutions).toBe(2);

    await expect(
      store.runIdempotentOperation({
        ...base,
        idempotencyKey: "variation-cycle-two-detach",
        execute: async () => ({ execution: ++detachExecutions }),
      }),
    ).resolves.toEqual({ execution: 2 });
    expect(detachExecutions).toBe(2);
  });

  it("releases a variation claim when a classified pre-commit check fails", async () => {
    const store = await testStore();
    const operation = {
      idempotencyKey: "variation-precommit-reusable",
      operationType: "variation_detach" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "CHILD-PRECOMMIT",
      accountScope: "account-a",
      fingerprint: "detach-parent-a",
    };
    await expect(
      store.runIdempotentOperation({
        ...operation,
        execute: async () => {
          throw new SpApiPreCommitError(
            new SpApiError("Amazon Validation Preview 暫時無法使用。", {
              status: 503,
              code: "UPSTREAM_UNAVAILABLE",
              operation: "patchListingsItemPreview",
            }),
          );
        },
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
      commitPatchSent: false,
    });

    await expect(
      store.runIdempotentOperation({
        ...operation,
        execute: async () => ({ safeRetry: true }),
      }),
    ).resolves.toEqual({ safeRetry: true });
  });

  it("writes no Amazon credential fields into the operational data file", async () => {
    const store = await testStore();
    await store.syncProductIdentity({
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "SAFE-SKU-1",
      asin: "B000000001",
      displayName: "Sample",
    });
    const raw = await readFile(store.filePath, "utf8");
    expect(raw).not.toMatch(/refresh.?token|client.?secret|lwaClientSecret/i);
  });

  it("persists only bounded content-audit hash evidence across a new LocalStore", async () => {
    const store = await testStore();
    const now = Date.now();
    const exportId = "content-audit-restart-1";
    const accountScope = "a".repeat(64);
    const rowDigests = ["1".repeat(64), "2".repeat(64)];
    await store.saveContentAuditSnapshotEvidence({
      exportId,
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      fetchedAt: new Date(now).toISOString(),
      rowDigests,
    }, now);

    const rawText = await readFile(store.filePath, "utf8");
    const raw = JSON.parse(rawText) as {
      version: number;
      contentAuditSnapshots: Record<string, { rowDigests: string[] }>;
    };
    expect(raw.version).toBe(2);
    expect(raw.contentAuditSnapshots[exportId]?.rowDigests).toEqual(rowDigests);
    expect(rawText).not.toContain("PRIVATE-SELLER-SKU");
    expect(rawText).not.toContain("PRIVATE-LISTING-DESCRIPTION");
    expect(rawText).not.toContain("A1FULLSELLERIDEXAMPLE");

    const restarted = new LocalStore(store.filePath);
    await restarted.initialize();
    await expect(restarted.getContentAuditSnapshotEvidence({
      exportId,
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      now: now + 1,
    })).resolves.toMatchObject({
      status: "available",
      evidence: { exportId, accountScope, rowDigests },
    });
    await expect(restarted.getContentAuditSnapshotEvidence({
      exportId,
      accountScope: "b".repeat(64),
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      now: now + 1,
    })).resolves.toEqual({ status: "account-scope-changed", evidence: null });
    await expect(restarted.getContentAuditSnapshotEvidence({
      exportId,
      accountScope,
      marketplaceId: "A1F83G8C2ARO7P",
      mode: "live",
      now: now + 1,
    })).resolves.toEqual({ status: "marketplace-changed", evidence: null });
    await expect(restarted.getContentAuditSnapshotEvidence({
      exportId,
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo",
      now: now + 1,
    })).resolves.toEqual({ status: "mode-changed", evidence: null });
  });

  it("expires content-audit evidence at 24 hours without extending it on restart", async () => {
    const store = await testStore();
    const now = Date.now();
    const exportId = "content-audit-expiry-1";
    const accountScope = "c".repeat(64);
    await store.saveContentAuditSnapshotEvidence({
      exportId,
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo",
      fetchedAt: new Date(now).toISOString(),
      rowDigests: ["3".repeat(64)],
    }, now);

    const restarted = new LocalStore(store.filePath);
    await restarted.initialize();
    await expect(restarted.getContentAuditSnapshotEvidence({
      exportId,
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo",
      now: now + CONTENT_AUDIT_SNAPSHOT_TTL_MS - 1,
    })).resolves.toMatchObject({ status: "available" });
    await expect(restarted.getContentAuditSnapshotEvidence({
      exportId,
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo",
      now: now + CONTENT_AUDIT_SNAPSHOT_TTL_MS,
    })).resolves.toEqual({ status: "expired", evidence: null });

    const restartedAgain = new LocalStore(store.filePath);
    await restartedAgain.initialize();
    await expect(restartedAgain.getContentAuditSnapshotEvidence({
      exportId,
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo",
      now: now + CONTENT_AUDIT_SNAPSHOT_TTL_MS,
    })).resolves.toEqual({ status: "not-found", evidence: null });
  });

  it("fails closed when a persisted content-audit collection exceeds its bounds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fba-os-store-audit-cap-"));
    const filePath = join(directory, "data.json");
    const now = Date.now();
    const contentAuditSnapshots = Object.fromEntries(
      Array.from({ length: 9 }, (_value, index) => {
        const exportId = `content-audit-over-cap-${index}`;
        return [exportId, {
          schemaVersion: 1,
          exportId,
          accountScope: "d".repeat(64),
          marketplaceId: "ATVPDKIKX0DER",
          mode: "demo",
          fetchedAt: new Date(now).toISOString(),
          rowDigests: [index.toString(16).padStart(64, "0")],
          createdAt: now,
          expiresAt: now + CONTENT_AUDIT_SNAPSHOT_TTL_MS,
        }];
      }),
    );
    await writeFile(filePath, JSON.stringify({
      version: 2,
      profiles: {},
      ledger: {},
      brandSalesJobs: {},
      sharedAllListingsReports: {},
      contentAuditSnapshots,
    }));

    const store = new LocalStore(filePath);
    await expect(store.initialize()).resolves.toBeUndefined();
    await expect(store.getContentAuditSnapshotEvidence({
      exportId: "content-audit-over-cap-0",
      accountScope: "d".repeat(64),
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo",
      now,
    })).resolves.toEqual({ status: "not-found", evidence: null });
    await store.syncProductIdentity({
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "SAFE-SKU-AUDIT-CAP",
    });
    const rewritten = JSON.parse(await readFile(filePath, "utf8")) as {
      contentAuditSnapshots: Record<string, unknown>;
    };
    expect(rewritten.contentAuditSnapshots).toEqual({});
  });

  it("evicts the oldest content-audit evidence deterministically at capacity", async () => {
    const store = await testStore();
    const now = Date.now();
    const accountScope = "e".repeat(64);
    for (let index = 0; index < 9; index += 1) {
      await store.saveContentAuditSnapshotEvidence({
        exportId: `content-audit-capacity-${index}`,
        accountScope,
        marketplaceId: "ATVPDKIKX0DER",
        mode: "demo",
        fetchedAt: new Date(now + index).toISOString(),
        rowDigests: [(index + 10).toString(16).padStart(64, "0")],
      }, now + index);
    }

    await expect(store.getContentAuditSnapshotEvidence({
      exportId: "content-audit-capacity-0",
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo",
      now: now + 9,
    })).resolves.toEqual({ status: "not-found", evidence: null });
    await expect(store.getContentAuditSnapshotEvidence({
      exportId: "content-audit-capacity-8",
      accountScope,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "demo",
      now: now + 9,
    })).resolves.toMatchObject({ status: "available" });
    const raw = JSON.parse(await readFile(store.filePath, "utf8")) as {
      contentAuditSnapshots: Record<string, unknown>;
    };
    expect(Object.keys(raw.contentAuditSnapshots)).toHaveLength(8);
  });

  it("drops malformed optional report-cache entries without blocking profiles or ledger", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fba-os-store-cache-"));
    const filePath = join(directory, "data.json");
    await writeFile(filePath, JSON.stringify({
      version: 2,
      profiles: {},
      ledger: {},
      brandSalesJobs: {
        malformed: {
          jobId: "malformed-job",
          listing: {
            status: "DONE",
            reportId: null,
            documentId: null,
          },
        },
      },
      sharedAllListingsReports: {
        malformed: {
          leaseId: "malformed-lease",
          report: {
            status: "DONE",
            reportId: null,
            documentId: null,
          },
        },
      },
      contentAuditSnapshots: {
        malformed: { schemaVersion: 1, rowDigests: ["not-a-digest"] },
      },
    }));
    const store = new LocalStore(filePath);
    await expect(store.initialize()).resolves.toBeUndefined();
    await expect(
      store.getBrandSalesJob({
        accountScope: "account-a",
        marketplaceId: "ATVPDKIKX0DER",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
      }),
    ).resolves.toBeNull();
    await expect(
      store.syncProductIdentity({
        accountScope: "account-a",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "SAFE-SKU-CACHE",
      }),
    ).resolves.toMatchObject({ found: true });
    const rewritten = JSON.parse(await readFile(filePath, "utf8")) as {
      version: number;
      brandSalesJobs: Record<string, unknown>;
      sharedAllListingsReports: Record<string, unknown>;
      contentAuditSnapshots: Record<string, unknown>;
    };
    expect(rewritten.version).toBe(2);
    expect(rewritten.brandSalesJobs).toEqual({});
    expect(rewritten.sharedAllListingsReports).toEqual({});
    expect(rewritten.contentAuditSnapshots).toEqual({});
  });

  it("keeps the optional durable report ledger rollback-compatible at store version 2", async () => {
    const store = await testStore();
    const now = Date.now();
    await store.createSharedAllListingsReportIfAbsent({
      leaseId: "shared-listings-lease-1",
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      optionsKey: "preferredReportDocumentLocale=en_US",
      mode: "live",
      report: {
        reportId: "all-listings-report-1",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: now,
        terminal: null,
        terminalAt: null,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60 * 60 * 1_000,
    }, now);
    await store.createSharedReportIfAbsent({
      leaseId: "shared-aged-lease-1",
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
      optionsKey: "marketplaceIds=selected",
      mode: "live",
      report: {
        reportId: "aged-report-1",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: now,
        terminal: null,
        terminalAt: null,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60 * 60 * 1_000,
    }, now);
    await store.createSharedReportIfAbsent({
      leaseId: "shared-inbound-noncompliance-lease-1",
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA",
      optionsKey: "marketplaceIds=selected;daily-inbound-noncompliance",
      mode: "live",
      report: {
        reportId: "inbound-noncompliance-report-1",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: now,
        terminal: null,
        terminalAt: null,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60 * 60 * 1_000,
    }, now);
    await store.createSharedReportIfAbsent({
      leaseId: "shared-sales-traffic-lease-1",
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      optionsKey: "dateGranularity=DAY;asinGranularity=SKU;start=2026-08-01;end=2026-08-20",
      mode: "live",
      report: {
        reportId: "sales-traffic-report-1",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: now,
        terminal: null,
        terminalAt: null,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60 * 60 * 1_000,
    }, now);
    const shipmentOptionsKey = sharedFbaShipmentSalesOptionsKey({
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      dataStartTime: "2026-08-01T00:00:00-07:00",
      dataEndTime: "2026-08-08T00:00:00-07:00",
      windowCreatedAt: now,
    });
    await store.createSharedReportIfAbsent({
      leaseId: "shared-fba-shipment-sales-lease-1",
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
      optionsKey: shipmentOptionsKey,
      mode: "live",
      report: {
        reportId: "fba-shipment-sales-report-1",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: now,
        terminal: null,
        terminalAt: null,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60 * 60 * 1_000,
    }, now);
    await store.createSharedReportIfAbsent({
      leaseId: "shared-ads-strategy-lease-1",
      accountScope: "account-ads-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "ADS_SP_ADVERTISED_PRODUCT",
      optionsKey: "reportTypeId=spAdvertisedProduct;timeUnit=SUMMARY;version=1;start=2026-08-01;end=2026-08-20",
      mode: "live",
      report: {
        reportId: "ads-strategy-report-1",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: now,
        terminal: null,
        terminalAt: null,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60 * 60 * 1_000,
    }, now);
    const raw = JSON.parse(await readFile(store.filePath, "utf8")) as {
      version: number;
      sharedAllListingsReports: Record<string, unknown>;
    };
    expect(raw.version).toBe(2);
    const persistedReportKeys = Object.keys(raw.sharedAllListingsReports);
    expect(persistedReportKeys).toHaveLength(12);
    expect(persistedReportKeys.filter((key) => key.startsWith("["))).toHaveLength(6);
    expect(persistedReportKeys.filter((key) => !key.startsWith("["))).toHaveLength(6);
    expect(JSON.stringify(raw)).not.toMatch(/refresh.?token|client.?secret|lwaClientSecret/i);
    const restarted = new LocalStore(store.filePath);
    await restarted.initialize();
    await expect(restarted.getSharedReport({
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      optionsKey: "dateGranularity=DAY;asinGranularity=SKU;start=2026-08-01;end=2026-08-20",
    })).resolves.toMatchObject({ leaseId: "shared-sales-traffic-lease-1" });
    await expect(restarted.getSharedReport({
      accountScope: "account-ads-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "ADS_SP_ADVERTISED_PRODUCT",
      optionsKey: "reportTypeId=spAdvertisedProduct;timeUnit=SUMMARY;version=1;start=2026-08-01;end=2026-08-20",
    })).resolves.toMatchObject({ leaseId: "shared-ads-strategy-lease-1" });
    await expect(restarted.getSharedReport({
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
      optionsKey: shipmentOptionsKey,
    })).resolves.toMatchObject({
      leaseId: "shared-fba-shipment-sales-lease-1",
    });
  });

  it("loads legacy colon report keys and preserves a rollback alias beside the canonical tuple", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fba-os-legacy-report-key-"));
    const filePath = join(directory, "data.json");
    const now = Date.now();
    const accountScope = "opaque:account-scope";
    const marketplaceId = "ATVPDKIKX0DER";
    const reportType = "GET_MERCHANT_LISTINGS_ALL_DATA";
    const optionsKey = "preferredReportDocumentLocale=en_US";
    const legacyKey = [accountScope, marketplaceId, reportType, optionsKey].join(":");
    await writeFile(filePath, JSON.stringify({
      version: 2,
      profiles: {},
      ledger: {},
      brandSalesJobs: {},
      sharedAllListingsReports: {
        [legacyKey]: {
          leaseId: "legacy-colon-report-lease",
          accountScope,
          marketplaceId,
          reportType,
          optionsKey,
          mode: "live",
          report: {
            reportId: "legacy-amazon-report",
            documentId: null,
            status: "IN_QUEUE",
            createdAt: now,
            terminal: null,
            terminalAt: null,
          },
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 60 * 60 * 1_000,
        },
      },
      contentAuditSnapshots: {},
    }));

    const store = new LocalStore(filePath);
    await store.initialize();
    await expect(store.getSharedReport({
      accountScope,
      marketplaceId,
      reportType,
      optionsKey,
    })).resolves.toMatchObject({ leaseId: "legacy-colon-report-lease" });

    await store.syncProductIdentity({
      accountScope,
      marketplaceId,
      sellerSku: "SAFE-CANONICAL-KEY",
    });
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      sharedAllListingsReports: Record<string, unknown>;
    };
    expect(Object.keys(persisted.sharedAllListingsReports)).toEqual([
      JSON.stringify([accountScope, marketplaceId, reportType, optionsKey]),
      legacyKey,
    ]);
  });

  it("survives a previous-v2 reader mutation without losing an ambiguous tombstone", async () => {
    const store = await testStore();
    const now = Date.now();
    const identity = {
      accountScope: "rollback-account",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA" as const,
      optionsKey: "preferredReportDocumentLocale=en_US" as const,
    };
    await store.createSharedReportIfAbsent({
      leaseId: "rollback-unknown-lease",
      ...identity,
      mode: "live",
      report: {
        reportId: "amazon-report-result-ambiguous",
        documentId: null,
        status: "CREATION_UNKNOWN",
        createdAt: now,
        terminal: "CREATION_UNKNOWN",
        terminalAt: now,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60 * 60 * 1_000,
    }, now);

    const canonicalKey = JSON.stringify([
      identity.accountScope,
      identity.marketplaceId,
      identity.reportType,
      identity.optionsKey,
    ]);
    const legacyKey = [
      identity.accountScope,
      identity.marketplaceId,
      identity.reportType,
      identity.optionsKey,
    ].join(":");
    const currentRaw = JSON.parse(await readFile(store.filePath, "utf8")) as {
      version: number;
      profiles: Record<string, unknown>;
      ledger: Record<string, unknown>;
      brandSalesJobs: Record<string, unknown>;
      sharedAllListingsReports: Record<string, Record<string, unknown>>;
      contentAuditSnapshots: Record<string, unknown>;
    };
    expect(Object.keys(currentRaw.sharedAllListingsReports)).toEqual([
      canonicalKey,
      legacyKey,
    ]);

    // Emulate the immediately previous v2 reader: it recognizes only the
    // colon-delimited key, reconstructs its in-memory store, then performs an
    // unrelated mutation and rewrites the whole JSON file.
    const baseVisibleReports = Object.fromEntries(
      Object.entries(currentRaw.sharedAllListingsReports).filter(
        ([key, report]) =>
          key === [
            report.accountScope,
            report.marketplaceId,
            report.reportType,
            report.optionsKey,
          ].join(":"),
      ),
    );
    expect(Object.keys(baseVisibleReports)).toEqual([legacyKey]);
    await writeFile(store.filePath, `${JSON.stringify({
      ...currentRaw,
      sharedAllListingsReports: baseVisibleReports,
    }, null, 2)}\n`);

    const restarted = new LocalStore(store.filePath);
    await restarted.initialize();
    await expect(restarted.getSharedReport(identity)).resolves.toMatchObject({
      leaseId: "rollback-unknown-lease",
      report: {
        reportId: "amazon-report-result-ambiguous",
        status: "CREATION_UNKNOWN",
        terminal: "CREATION_UNKNOWN",
      },
    });

    await restarted.syncProductIdentity({
      accountScope: identity.accountScope,
      marketplaceId: identity.marketplaceId,
      sellerSku: "ROLLBACK-ROUND-TRIP",
    });
    const rewritten = JSON.parse(await readFile(store.filePath, "utf8")) as {
      sharedAllListingsReports: Record<string, unknown>;
    };
    expect(Object.keys(rewritten.sharedAllListingsReports)).toEqual([
      canonicalKey,
      legacyKey,
    ]);
  });

  it("fails closed when two canonical identities collapse to one v2 alias", async () => {
    const store = await testStore();
    const now = Date.now();
    const report = {
      reportId: "ambiguous-create-evidence",
      documentId: null,
      status: "CREATION_UNKNOWN" as const,
      createdAt: now,
      terminal: "CREATION_UNKNOWN" as const,
      terminalAt: now,
    };
    const common = {
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA" as const,
      optionsKey: "preferredReportDocumentLocale=en_US" as const,
      mode: "live" as const,
      report,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60 * 60 * 1_000,
    };
    await store.createSharedReportIfAbsent({
      ...common,
      leaseId: "collision-lease-a",
      accountScope: "opaque",
      marketplaceId: "segment:market",
    }, now);

    await expect(store.createSharedReportIfAbsent({
      ...common,
      leaseId: "collision-lease-b",
      accountScope: "opaque:segment",
      marketplaceId: "market",
    }, now)).rejects.toThrow("Ambiguous legacy shared report identity");
    await expect(store.getSharedReport({
      accountScope: "opaque",
      marketplaceId: "segment:market",
      reportType: common.reportType,
      optionsKey: common.optionsKey,
    })).resolves.toMatchObject({ leaseId: "collision-lease-a" });
    await expect(store.getSharedReport({
      accountScope: "opaque:segment",
      marketplaceId: "market",
      reportType: common.reportType,
      optionsKey: common.optionsKey,
    })).resolves.toBeNull();
  });

  it("prunes expired completed report identities without deleting ambiguous evidence", async () => {
    const store = await testStore();
    const now = 2_000_000_000_000;
    const lease = (
      leaseId: string,
      optionsKey: `dateGranularity=DAY;asinGranularity=SKU;start=${string};end=${string}`,
      report: {
        reportId: string | null;
        documentId: string | null;
        status: "DONE" | "CREATION_UNKNOWN" | "IN_QUEUE";
        createdAt: number;
        terminal: "CREATION_UNKNOWN" | null;
        terminalAt: number | null;
      },
      expiresAt: number,
    ) => ({
      leaseId,
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_SALES_AND_TRAFFIC_REPORT" as const,
      optionsKey,
      mode: "live" as const,
      report,
      createdAt: now - 10_000,
      updatedAt: now - 5_000,
      expiresAt,
    });

    await store.createSharedReportIfAbsent(lease(
      "expired-done",
      "dateGranularity=DAY;asinGranularity=SKU;start=2026-07-01;end=2026-07-30",
      {
        reportId: "done-report",
        documentId: "done-document",
        status: "DONE",
        createdAt: now - 9_000,
        terminal: null,
        terminalAt: null,
      },
      now - 1,
    ), now - 2_000);
    await store.createSharedReportIfAbsent(lease(
      "expired-ambiguous",
      "dateGranularity=DAY;asinGranularity=SKU;start=2026-07-02;end=2026-07-31",
      {
        reportId: null,
        documentId: null,
        status: "CREATION_UNKNOWN",
        createdAt: now - 9_000,
        terminal: "CREATION_UNKNOWN",
        terminalAt: now - 8_000,
      },
      now - 1,
    ), now - 2_000);
    await store.createSharedReportIfAbsent(lease(
      "current-range",
      "dateGranularity=DAY;asinGranularity=SKU;start=2026-08-01;end=2026-08-20",
      {
        reportId: "current-report",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: now,
        terminal: null,
        terminalAt: null,
      },
      now + 60_000,
    ), now);

    await expect(store.getSharedReport({
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      optionsKey: "dateGranularity=DAY;asinGranularity=SKU;start=2026-07-01;end=2026-07-30",
    })).resolves.toBeNull();
    await expect(store.getSharedReport({
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      optionsKey: "dateGranularity=DAY;asinGranularity=SKU;start=2026-07-02;end=2026-07-31",
    })).resolves.toMatchObject({ leaseId: "expired-ambiguous" });
    await expect(store.getSharedReport({
      accountScope: "account-a",
      marketplaceId: "ATVPDKIKX0DER",
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      optionsKey: "dateGranularity=DAY;asinGranularity=SKU;start=2026-08-01;end=2026-08-20",
    })).resolves.toMatchObject({ leaseId: "current-range" });
  });
});
