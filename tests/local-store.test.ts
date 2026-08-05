import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
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
