import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { AdvertisingGateway } from "../src/main/amazon/ads-api";
import type { ImageAuditOwnerPort } from
  "../src/main/amazon/image-audit-owner";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type { SubscriptionAuditOwnerPort } from
  "../src/main/amazon/subscription-audit-owner";
import type { UnboundVariationAuditOwnerPort } from
  "../src/main/amazon/unbound-variation-audit-owner";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { StandaloneAuditCoordinatorPort } from
  "../src/main/standalone-audit-coordinator";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import type { MarketplaceId } from "../src/shared/marketplaces";

const US = "ATVPDKIKX0DER" as const;

describe("ApiRouter SP execution context", () => {
  it("binds a public route through the injected main-owned context adapter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sp-context-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const readContext = vi.fn((marketplaceId: MarketplaceId) => ({
      marketplaceId,
      mode: "demo" as const,
      accountScope: "opaque-scripted-account",
    }));
    const getAccountScope = vi.fn(async () => {
      throw new Error("legacy vault context path must not run");
    });
    const input = {
      store,
      vault: { getAccountScope } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(readContext),
    };
    const router = new ApiRouter(input);
    const request: ApiRequest = {
      requestId: crypto.randomUUID(),
      method: "POST",
      path: "/api/sp-api/audit-suite",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: US } },
    };

    const response = await router.handle(request);
    router.dispose();

    expect(response.status).toBe(202);
    expect(readContext).toHaveBeenCalledTimes(3);
    expect(readContext).toHaveBeenNthCalledWith(1, US);
    expect(readContext).toHaveBeenNthCalledWith(2, US);
    expect(readContext).toHaveBeenNthCalledWith(3, US);
    expect(getAccountScope).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).not.toContain("opaque-scripted-account");
    expect(JSON.stringify(response)).not.toMatch(
      /"(?:accountScope|generation|region)"/u,
    );
  });

  it("fails a Product Master terminal response closed when its account context drifts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "router-context-terminal-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const sellerSku = "CONTEXT-DRIFT-SKU";
    const initialState = await store.getProductMaster(
      "opaque-account-a",
      US,
      sellerSku,
    );
    let enterStore!: () => void;
    const storeEntered = new Promise<void>((resolve) => {
      enterStore = resolve;
    });
    let releaseStore!: () => void;
    const storeReleased = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    const getProductMaster = vi.spyOn(store, "getProductMaster")
      .mockImplementation(async () => {
        enterStore();
        await storeReleased;
        return initialState;
      });
    let accountScope = "opaque-account-a";
    const readContext = vi.fn((marketplaceId: MarketplaceId) => ({
      marketplaceId,
      mode: "demo" as const,
      accountScope,
    }));
    const getAccountScope = vi.fn(async () => "opaque-account-a");
    const router = new ApiRouter({
      store,
      vault: { getAccountScope } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(readContext),
    });

    const pending = router.handle({
      requestId: "router-context-terminal-001",
      method: "GET",
      path: "/api/product-master",
      query: { marketplaceId: US, sku: sellerSku },
      headers: {},
    });
    await storeEntered;
    accountScope = "opaque-account-b";
    releaseStore();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.body).toEqual({
      kind: "json",
      value: {
        code: "ACCOUNT_SCOPE_CHANGED",
        message: "Amazon 帳號範圍已改變；本次操作已停止。",
        requestId: null,
        issues: [],
        operation: null,
        upstreamCode: null,
      },
    });
    expect(getProductMaster).toHaveBeenCalledWith(
      "opaque-account-a",
      US,
      sellerSku,
    );
    expect(readContext).toHaveBeenCalledTimes(2);
    expect(getAccountScope).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "single Subscribe & Save read",
      method: "GET",
      path: "/api/sp-api/subscribe-save",
      query: { marketplaceId: US, sku: "AFA-TRKY-4OZ" },
      body: undefined,
    },
    {
      label: "subscription audit snapshot",
      method: "GET",
      path: "/api/sp-api/subscription-audit",
      query: { marketplaceId: US, months: "6" },
      body: undefined,
    },
    {
      label: "legacy listing-price read",
      method: "GET",
      path: "/api/sp-api/listings",
      query: { marketplaceId: US, sku: "AFA-TRKY-4OZ" },
      body: undefined,
    },
    {
      label: "legacy listing-price preview",
      method: "POST",
      path: "/api/sp-api/listings",
      query: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "AFA-TRKY-4OZ",
          expectedPrice: 13.99,
          newPrice: 14.99,
          idempotencyKey: "router-context-price-preview-001",
        },
      } as const,
    },
  ] as const)("fails $label closed when lock invalidates its operation", async ({
    method,
    path,
    query,
    body,
  }) => {
    const previousMode = process.env.SP_API_MODE;
    process.env.SP_API_MODE = "demo";
    try {
      const spExecutionContext = createScriptedSpExecutionContextAdapter(
        (marketplaceId) => ({
          marketplaceId,
          mode: "demo",
          accountScope: "opaque-subscription-account",
        }),
      );
      const router = new ApiRouter({
        store: {} as LocalStore,
        vault: {} as CredentialVault,
        approveWrite: async () => undefined,
        spExecutionContext,
      });

      const pending = router.handle({
        requestId: crypto.randomUUID(),
        method,
        path,
        query: { ...query } as Record<string, string>,
        headers: {},
        ...(body === undefined ? {} : { body }),
      });
      router.invalidateContext("lock-screen");
      const response = await pending;

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        kind: "json",
        value: {
          code: "SP_CONTEXT_INVALIDATED",
          message: "Amazon 執行環境已更新；請重新開始這次操作。",
          requestId: null,
          issues: [],
          operation: null,
          upstreamCode: null,
        },
      });
      router.dispose();
    } finally {
      if (previousMode === undefined) delete process.env.SP_API_MODE;
      else process.env.SP_API_MODE = previousMode;
    }
  });

  it("does not publish a preview ticket when context invalidates after its final fence", async () => {
    const previousMode = process.env.SP_API_MODE;
    process.env.SP_API_MODE = "demo";
    try {
      const base = createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: "opaque-preview-race-account",
      }));
      let assertCount = 0;
      let router!: ApiRouter;
      const spExecutionContext: SpExecutionContextAdapter = {
        capture: base.capture,
        invalidate: base.invalidate,
        async assertCurrent(context) {
          await base.assertCurrent(context);
          assertCount += 1;
          if (assertCount === 2) {
            queueMicrotask(() => router.invalidateContext("lock-screen"));
          }
        },
      };
      const approveWrite = vi.fn(async () => undefined);
      router = new ApiRouter({
        store: {} as LocalStore,
        vault: {} as CredentialVault,
        approveWrite,
        spExecutionContext,
      });
      const body = {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "AFA-TRKY-4OZ",
          expectedPrice: 13.99,
          newPrice: 14.99,
          idempotencyKey: "router-context-preview-publication-race-001",
        },
      } as const;

      const preview = await router.handle({
        requestId: "router-context-preview-race-preview",
        method: "POST",
        path: "/api/sp-api/listings",
        query: {},
        headers: {},
        body,
      });
      expect(preview.status).toBe(409);
      expect(preview.body.kind === "json" ? preview.body.value : null).toMatchObject({
        code: "SP_CONTEXT_INVALIDATED",
      });

      const commit = await router.handle({
        requestId: "router-context-preview-race-commit",
        method: "PATCH",
        path: "/api/sp-api/listings",
        query: {},
        headers: {},
        body,
      });
      expect(commit.status).toBe(409);
      expect(commit.body.kind === "json" ? commit.body.value : null).toMatchObject({
        code: "PREVIEW_EXPIRED",
      });
      expect(approveWrite).not.toHaveBeenCalled();
      router.dispose();
    } finally {
      if (previousMode === undefined) delete process.env.SP_API_MODE;
      else process.env.SP_API_MODE = previousMode;
    }
  });

  it("releases a preview claim when the post-approval fence fails before the ledger claim", async () => {
    const previousMode = process.env.SP_API_MODE;
    process.env.SP_API_MODE = "demo";
    try {
      const base = createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: "opaque-write-gate-release-account",
      }));
      let failNextFence = false;
      const spExecutionContext: SpExecutionContextAdapter = {
        capture: base.capture,
        invalidate: base.invalidate,
        async assertCurrent(context) {
          if (failNextFence) {
            failNextFence = false;
            throw new SpExecutionContextError(
              "SP_CONTEXT_INVALIDATED",
              "Amazon 執行環境已更新；請重新開始這次操作。",
            );
          }
          await base.assertCurrent(context);
        },
      };
      let approvalCount = 0;
      const approveWrite = vi.fn(async () => {
        approvalCount += 1;
        if (approvalCount === 1) failNextFence = true;
      });
      const runIdempotentOperation = vi.fn(async () => ({
        mode: "demo",
        status: "SIMULATED",
        sellerSku: "AFA-TRKY-4OZ",
      }));
      const router = new ApiRouter({
        store: { runIdempotentOperation } as unknown as LocalStore,
        vault: {} as CredentialVault,
        approveWrite,
        spExecutionContext,
      });
      const body = {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "AFA-TRKY-4OZ",
          expectedPrice: 13.99,
          newPrice: 14.99,
          confirmationSku: "AFA-TRKY-4OZ",
          idempotencyKey: "write-gate-release-preview-001",
        },
      } as const;
      const request = (requestId: string, method: "POST" | "PATCH"): ApiRequest => ({
        requestId,
        method,
        path: "/api/sp-api/listings",
        query: {},
        headers: {},
        body,
      });

      expect((await router.handle(request("write-gate-release-preview", "POST"))).status)
        .toBe(200);
      const fenced = await router.handle(request("write-gate-release-fenced", "PATCH"));
      expect(fenced.status).toBe(409);
      expect(fenced.body.kind === "json" ? fenced.body.value : null).toMatchObject({
        code: "SP_CONTEXT_INVALIDATED",
      });
      expect(runIdempotentOperation).not.toHaveBeenCalled();

      const retried = await router.handle(request("write-gate-release-retry", "PATCH"));
      expect(retried.status).toBe(200);
      expect(approveWrite).toHaveBeenCalledTimes(2);
      expect(runIdempotentOperation).toHaveBeenCalledOnce();
      router.dispose();
    } finally {
      if (previousMode === undefined) delete process.env.SP_API_MODE;
      else process.env.SP_API_MODE = previousMode;
    }
  });

  it("does not resurrect audit jobs whose initial context was invalidated before publication", async () => {
    const cases = [
      {
        label: "standalone",
        path: "/api/sp-api/standalone-audit",
        body: { kind: "content", marketplaceId: US, mode: "demo" },
      },
      {
        label: "a-plus",
        path: "/api/sp-api/a-plus-audit",
        body: { marketplaceId: US, mode: "demo" },
      },
      {
        label: "audit-suite",
        path: "/api/sp-api/audit-suite",
        body: { marketplaceId: US },
      },
    ] as const;

    for (const candidate of cases) {
      const base = createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: `opaque-${candidate.label}-generation-account`,
      }));
      let router!: ApiRouter;
      let armInvalidation = true;
      const spExecutionContext: SpExecutionContextAdapter = {
        invalidate: base.invalidate,
        assertCurrent: base.assertCurrent,
        async capture(marketplaceId) {
          const context = await base.capture(marketplaceId);
          if (armInvalidation) {
            armInvalidation = false;
            queueMicrotask(() => router.invalidateContext("lock-screen"));
          }
          return context;
        },
      };
      const standaloneAuditClear = vi.fn();
      const standaloneAuditCoordinator: StandaloneAuditCoordinatorPort = {
        start: vi.fn(async () => {
          await (router as unknown as {
            spExecutionContext: SpExecutionContextAdapter;
          }).spExecutionContext.capture(US);
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          return {
            status: 202,
            headers: { "retry-after": "1" },
            body: {
              kind: "json" as const,
              value: { ready: false, status: "queued" },
            },
          };
        }),
        observe: vi.fn(async () => ({
          status: 410,
          headers: {},
          body: {
            kind: "json" as const,
            value: { code: "STANDALONE_AUDIT_JOB_EXPIRED" },
          },
        })),
        getJob: vi.fn(async () => {
          throw new Error("Unexpected Standalone Audit receipt read.");
        }),
        clear: standaloneAuditClear,
      };
      const aPlusAuditClear = vi.fn();
      const aPlusAuditCoordinator = {
        start: vi.fn(async () => {
          await (router as unknown as {
            spExecutionContext: SpExecutionContextAdapter;
          }).spExecutionContext.capture(US);
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          return {
            status: 202,
            headers: { "retry-after": "1" },
            body: {
              kind: "json" as const,
              value: { ready: false, status: "queued" },
            },
          };
        }),
        observe: vi.fn(async () => ({
          status: 410,
          headers: {},
          body: {
            kind: "json" as const,
            value: { code: "A_PLUS_AUDIT_JOB_EXPIRED" },
          },
        })),
        runAuditSuite: vi.fn(async () => {
          throw new Error("Unexpected A+ Audit Suite run.");
        }),
        clear: aPlusAuditClear,
      };
      const legacyAuditSuiteClear = vi.fn();
      const legacyAuditSuiteCompatibility = {
        start: vi.fn(async () => {
          await (router as unknown as {
            spExecutionContext: SpExecutionContextAdapter;
          }).spExecutionContext.capture(US);
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          return {
            status: 202,
            headers: { "retry-after": "1" },
            body: {
              kind: "json" as const,
              value: { ready: false, status: "queued" },
            },
          };
        }),
        observe: vi.fn(async () => {
          throw new Error("Unexpected legacy Audit Suite receipt read.");
        }),
        download: vi.fn(async () => {
          throw new Error("Unexpected legacy Audit Suite workbook read.");
        }),
        clear: legacyAuditSuiteClear,
      };
      router = new ApiRouter({
        store: {} as LocalStore,
        vault: {} as CredentialVault,
        approveWrite: async () => undefined,
        spExecutionContext,
        standaloneAuditCoordinator,
        aPlusAuditCoordinator,
        legacyAuditSuiteCompatibility,
      });

      const response = await router.handle({
        requestId: `audit-generation-race-${candidate.label}`,
        method: "POST",
        path: candidate.path,
        query: {},
        headers: {},
        body: { kind: "json", value: candidate.body },
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(response.status, candidate.label).toBe(409);
      expect(response.body.kind === "json" ? response.body.value : null).toMatchObject({
        code: "SP_CONTEXT_INVALIDATED",
      });
      expect(standaloneAuditClear, candidate.label).toHaveBeenCalled();
      expect(aPlusAuditClear, candidate.label).toHaveBeenCalled();
      expect(legacyAuditSuiteClear, candidate.label).toHaveBeenCalled();
      router.dispose();
    }
  });

  it("preserves the legacy two-field account-drift DTO from snapshot owners", async () => {
    const accountDrift = (message: string): ApiResponse => ({
      status: 409,
      headers: {},
      body: {
        kind: "json",
        value: { code: "ACCOUNT_SCOPE_CHANGED", message },
      },
    });
    const subscriptionMessage =
      "Amazon 帳號範圍已改變，舊健檢快照不可匯出。";
    const variationMessage =
      "Amazon 帳號範圍已改變，舊未綁變體快照不可匯出。";
    const imageMessage =
      "Amazon 帳號範圍已改變，舊圖片健檢快照不可匯出。";
    const subscriptionDownload = vi.fn(async () =>
      accountDrift(subscriptionMessage));
    const variationDownload = vi.fn(async () =>
      accountDrift(variationMessage));
    const imageDownload = vi.fn(async () => accountDrift(imageMessage));
    const notCalled = async (): Promise<never> => {
      throw new Error("Unrelated snapshot owner method must not run.");
    };
    const subscriptionAudit: SubscriptionAuditOwnerPort = {
      read: vi.fn(notCalled),
      download: subscriptionDownload,
      runStandalone: vi.fn(notCalled),
      runAuditSuite: vi.fn(notCalled),
      clear: vi.fn(),
    };
    const unboundVariationAudit: UnboundVariationAuditOwnerPort = {
      start: vi.fn(notCalled),
      statusDataOrDownload: variationDownload,
      runStandalone: vi.fn(notCalled),
      runAuditSuite: vi.fn(notCalled),
      clear: vi.fn(),
    };
    const imageAudit: ImageAuditOwnerPort = {
      captureFromListings: vi.fn(notCalled),
      captureStandaloneFromListings: vi.fn(notCalled),
      read: vi.fn(notCalled),
      download: imageDownload,
      runAuditSuite: vi.fn(notCalled),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      subscriptionAudit,
      unboundVariationAudit,
      imageAudit,
    });

    const requests = [
      {
        path: "/api/sp-api/subscription-audit/export",
        query: { marketplaceId: US, exportId: "subscription-export" },
        message: subscriptionMessage,
      },
      {
        path: "/api/sp-api/variation-audit",
        query: { marketplaceId: US, download: "1", exportId: "variation-export" },
        message: variationMessage,
      },
      {
        path: "/api/sp-api/listing-content/export",
        query: {
          marketplaceId: US,
          imageAudit: "1",
          download: "1",
          exportId: "image-export",
        },
        message: imageMessage,
      },
    ] as const;
    for (const [index, request] of requests.entries()) {
      const response = await router.handle({
        requestId: `snapshot-context-dto-${index + 1}`,
        method: "GET",
        path: request.path,
        query: request.query,
        headers: {},
      });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        kind: "json",
        value: {
          code: "ACCOUNT_SCOPE_CHANGED",
          message: request.message,
        },
      });
    }
    expect(subscriptionDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/sp-api/subscription-audit/export",
        query: { marketplaceId: US, exportId: "subscription-export" },
      }),
    );
    expect(variationDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/sp-api/variation-audit",
        query: {
          marketplaceId: US,
          download: "1",
          exportId: "variation-export",
        },
      }),
    );
    expect(imageDownload).toHaveBeenCalledWith({
      marketplaceId: US,
      exportId: "image-export",
    });
    router.dispose();
  });

  it("invalidates the injected context and all router-bound runtime state together", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sp-context-invalidate-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const spExecutionContext = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: "opaque-scripted-account",
      }),
    );
    const invalidate = vi.spyOn(spExecutionContext, "invalidate");
    const advertisingInvalidate = vi.fn();
    const router = new ApiRouter({
      store,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext,
      advertising: {
        invalidate: advertisingInvalidate,
      } as unknown as AdvertisingGateway,
    });
    const start: ApiRequest = {
      requestId: crypto.randomUUID(),
      method: "POST",
      path: "/api/sp-api/audit-suite",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: US } },
    };
    const started = await router.handle(start);
    if (started.body.kind !== "json") throw new Error("Expected JSON response");
    const identity = started.body.value as { runId: string; contextId: string };

    router.invalidateContext("lock-screen");
    const expired = await router.handle({
      requestId: crypto.randomUUID(),
      method: "GET",
      path: "/api/sp-api/audit-suite",
      query: {
        marketplaceId: US,
        runId: identity.runId,
        contextId: identity.contextId,
      },
      headers: {},
    });

    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith("lock-screen");
    expect(advertisingInvalidate).toHaveBeenCalledOnce();
    expect(expired.status).toBe(410);
  });

  it("clears router state after reporting an out-of-band account transition once", async () => {
    const previousMode = process.env.SP_API_MODE;
    process.env.SP_API_MODE = "demo";
    try {
      const directory = await mkdtemp(join(tmpdir(), "sp-context-transition-"));
      const store = new LocalStore(join(directory, "data.json"));
      await store.initialize();
      let accountScope = "opaque-account-a";
      const advertisingInvalidate = vi.fn();
      const router = new ApiRouter({
        store,
        vault: {
          getAccountScope: async () => accountScope,
        } as unknown as CredentialVault,
        approveWrite: async () => undefined,
        advertising: {
          invalidate: advertisingInvalidate,
        } as unknown as AdvertisingGateway,
      });
      const started = await router.handle({
        requestId: crypto.randomUUID(),
        method: "POST",
        path: "/api/sp-api/audit-suite",
        query: {},
        headers: {},
        body: { kind: "json", value: { marketplaceId: US } },
      });
      if (started.body.kind !== "json") throw new Error("Expected JSON response");
      const identity = started.body.value as { runId: string; contextId: string };
      const statusRequest = (): ApiRequest => ({
        requestId: crypto.randomUUID(),
        method: "GET",
        path: "/api/sp-api/audit-suite",
        query: {
          marketplaceId: US,
          runId: identity.runId,
          contextId: identity.contextId,
        },
        headers: {},
      });

      accountScope = "opaque-account-b";
      const changed = await router.handle(statusRequest());
      const expired = await router.handle(statusRequest());

      expect(changed.status).toBe(409);
      expect(changed.body.kind === "json" ? changed.body.value : null).toMatchObject({
        code: "ACCOUNT_SCOPE_CHANGED",
      });
      expect(expired.status).toBe(410);
      expect(advertisingInvalidate).toHaveBeenCalledOnce();
    } finally {
      if (previousMode === undefined) delete process.env.SP_API_MODE;
      else process.env.SP_API_MODE = previousMode;
    }
  });
});
