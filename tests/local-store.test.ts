import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
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
    };
    expect(rewritten.version).toBe(2);
    expect(rewritten.brandSalesJobs).toEqual({});
    expect(rewritten.sharedAllListingsReports).toEqual({});
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
    expect(Object.keys(raw.sharedAllListingsReports)).toHaveLength(5);
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
