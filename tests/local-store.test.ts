import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  SpApiError,
  SpApiPreCommitError,
} from "../src/main/amazon/sp-api";
import { LocalStore } from "../src/main/local-store";

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

  it("deduplicates the same write even when the UI generates a new key", async () => {
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
    ).resolves.toEqual({ execution: 1 });
    expect(executions).toBe(1);
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
});
