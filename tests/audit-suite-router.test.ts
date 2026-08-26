import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { buildAplusAuditSuiteResult } from
  "../src/main/a-plus-audit-coordinator";
import { buildAdvertisingAuditSuiteResult } from
  "../src/main/advertising-read-coordinator";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { SpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER";
const CA = "A2EUQ1WTGCTBG2";
const previousMode = process.env.SP_API_MODE;
const previousClientId = process.env.SP_API_LWA_CLIENT_ID;
const previousClientSecret = process.env.SP_API_LWA_CLIENT_SECRET;
const previousRefreshToken = process.env.SP_API_REFRESH_TOKEN_NA;
type RouterInput = ConstructorParameters<typeof ApiRouter>[0];
type DemoListingStart = NonNullable<
  NonNullable<RouterInput["allListingsDemoReports"]>["start"]
>;
type AgedInventoryReadsInput = NonNullable<RouterInput["agedInventoryReads"]>;
type AgedInventoryBegin = AgedInventoryReadsInput["begin"];

function request(
  method: "GET" | "POST",
  path: string,
  input: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path,
    query: method === "GET" ? input as Record<string, string> : {},
    headers: {},
    ...(method === "POST" ? { body: { kind: "json" as const, value: input } } : {}),
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((child) => containsKey(child, key));
}

async function waitForTerminal(
  router: ApiRouter,
  identity: { marketplaceId: string; runId: string; contextId: string },
): Promise<ApiResponse> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await router.handle(request("GET", "/api/sp-api/audit-suite", identity));
    const status = jsonValue(response).status;
    if (status === "completed" || status === "partial" || status === "failed") {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Audit suite did not reach a terminal state.");
}

describe("main-owned audit suite routes", () => {
  let accountScope: string;
  let router: ApiRouter;
  let startListing: ReturnType<typeof vi.fn<DemoListingStart>>;
  let startAged: ReturnType<typeof vi.fn<AgedInventoryBegin>>;
  let agedInventoryReads: AgedInventoryReadsInput;

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    accountScope = "account-scope-one";
    startListing = vi.fn<DemoListingStart>(async ({ marketplaceId }) => ({
      mode: "demo" as const,
      ready: true,
      reportId: `demo-${marketplaceId}`,
      documentId: `demo-${marketplaceId}`,
      status: "DONE" as const,
      notice: "ready",
    }));
    startAged = vi.fn<AgedInventoryBegin>(async ({ marketplaceId }) => ({
      mode: "demo" as const,
      ready: true,
      reportId: `demo-aged-${marketplaceId}`,
      documentId: `demo-aged-${marketplaceId}`,
      status: "DONE" as const,
      notice: "ready",
    }));
    agedInventoryReads = {
      begin: startAged,
      status: vi.fn(async () => {
        throw new Error("aged inventory status must not run in audit suite");
      }),
      read: vi.fn(async () => {
        throw new Error("aged inventory read must not run in audit suite");
      }),
    };
    const directory = await mkdtemp(join(tmpdir(), "audit-suite-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => accountScope),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      allListingsDemoReports: { start: startListing },
      agedInventoryReads,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    router?.dispose();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
    if (previousClientId === undefined) delete process.env.SP_API_LWA_CLIENT_ID;
    else process.env.SP_API_LWA_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SP_API_LWA_CLIENT_SECRET;
    else process.env.SP_API_LWA_CLIENT_SECRET = previousClientSecret;
    if (previousRefreshToken === undefined) delete process.env.SP_API_REFRESH_TOKEN_NA;
    else process.env.SP_API_REFRESH_TOKEN_NA = previousRefreshToken;
  });

  it("returns 202, single-flights the active run and creates one shared all-listings report", async () => {
    const first = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    const second = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(jsonValue(second)).toMatchObject({
      runId: jsonValue(first).runId,
      contextId: jsonValue(first).contextId,
    });
    expect(containsKey(jsonValue(first), "accountScope")).toBe(false);

    const identity = {
      marketplaceId: US,
      runId: String(jsonValue(first).runId),
      contextId: String(jsonValue(first).contextId),
    };
    const completed = await waitForTerminal(router, identity);
    expect(completed.status).toBe(200);
    expect(jsonValue(completed)).toMatchObject({
      status: "partial",
      sections: {
        content: { status: "partial" },
        aplus: { status: "completed" },
        businessPricing: { status: "completed" },
        advertising: { status: "failed" },
      },
    });
    expect(Object.keys(jsonValue(completed).sections as Record<string, unknown>)).toEqual([
      "content",
      "image",
      "aplus",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
    ]);
    expect(containsKey(jsonValue(completed), "accountScope")).toBe(false);
    expect(startListing).toHaveBeenCalledTimes(1);

    const exported = await router.handle(request(
      "GET",
      "/api/sp-api/audit-suite/export",
      identity,
    ));
    expect(exported.status).toBe(200);
    expect(exported.body.kind).toBe("bytes");
    expect(exported.headers["content-type"]).toContain("spreadsheetml.sheet");
  });

  it("does not turn a suite start into an explicit retry of an ambiguous listings report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "audit-suite-ambiguous-report-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const now = Date.now();
    await store.createSharedReportIfAbsent({
      leaseId: crypto.randomUUID(),
      accountScope,
      marketplaceId: US,
      mode: "demo",
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      optionsKey: "preferredReportDocumentLocale=en_US",
      report: {
        reportId: "ambiguous-report-id",
        documentId: null,
        status: "CREATION_UNKNOWN",
        createdAt: now - 60 * 60 * 1_000,
        terminal: "CREATION_UNKNOWN",
        terminalAt: now - 60 * 60 * 1_000,
      },
      createdAt: now - 60 * 60 * 1_000,
      updatedAt: now - 60 * 60 * 1_000,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
    startListing = vi.fn();
    router.dispose();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => accountScope),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      allListingsDemoReports: {
        start: startListing,
      },
      agedInventoryReads,
    });

    const started = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    await waitForTerminal(router, {
      marketplaceId: US,
      runId: String(jsonValue(started).runId),
      contextId: String(jsonValue(started).contextId),
    });

    expect(startListing).not.toHaveBeenCalled();
  });

  it("does not start the low-frequency aged inventory report as part of run-all", async () => {
    const suite = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    await waitForTerminal(router, {
      marketplaceId: US,
      runId: String(jsonValue(suite).runId),
      contextId: String(jsonValue(suite).contextId),
    });
    expect(startAged).not.toHaveBeenCalled();
  });

  it("rejects renderer-supplied account context and raw snapshot fields", async () => {
    const response = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
      accountScope: "renderer-must-not-send-this",
      snapshots: {},
    }));
    expect(response.status).toBe(400);
    expect(jsonValue(response)).toMatchObject({ code: "INVALID_INPUT" });
    expect(startListing).not.toHaveBeenCalled();
  });

  it("fails closed before child work when the context adapter returns another marketplace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "audit-suite-market-fence-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const hostileContext = {
      capture: vi.fn(async () => ({
        marketplaceId: CA,
        region: "na",
        mode: "demo",
        accountScope: "opaque-wrong-market-account",
        generation: 0,
      })),
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn(),
    } as unknown as SpExecutionContextAdapter;
    router.dispose();
    router = new ApiRouter({
      store,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: hostileContext,
      allListingsDemoReports: { start: startListing },
      agedInventoryReads,
    });

    const response = await router.handle(request(
      "POST",
      "/api/sp-api/audit-suite",
      { marketplaceId: US },
    ));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(409);
    expect(jsonValue(response)).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    expect(startListing).not.toHaveBeenCalled();
  });

  it("revalidates account, mode, marketplace and contextId on every status/export read", async () => {
    const started = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    const identity = {
      marketplaceId: US,
      runId: String(jsonValue(started).runId),
      contextId: String(jsonValue(started).contextId),
    };
    await waitForTerminal(router, identity);

    const wrongMarket = await router.handle(request("GET", "/api/sp-api/audit-suite", {
      ...identity,
      marketplaceId: CA,
    }));
    expect(wrongMarket.status).toBe(410);

    const wrongContext = await router.handle(request("GET", "/api/sp-api/audit-suite", {
      ...identity,
      contextId: crypto.randomUUID(),
    }));
    expect(wrongContext.status).toBe(410);

    accountScope = "account-scope-two";
    const wrongAccount = await router.handle(request("GET", "/api/sp-api/audit-suite/export", identity));
    expect(wrongAccount.status).toBe(409);
    expect(jsonValue(wrongAccount)).toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
  });

  it("invalidates a queued run when the app mode changes", async () => {
    const started = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    const identity = {
      marketplaceId: US,
      runId: String(jsonValue(started).runId),
      contextId: String(jsonValue(started).contextId),
    };
    process.env.SP_API_LWA_CLIENT_ID = "test-client";
    process.env.SP_API_LWA_CLIENT_SECRET = "test-secret";
    process.env.SP_API_REFRESH_TOKEN_NA = "test-refresh";
    process.env.SP_API_MODE = "live";
    const status = await router.handle(request("GET", "/api/sp-api/audit-suite", identity));
    expect(status.status).toBe(409);
    expect(jsonValue(status)).toMatchObject({ code: "REPORT_MODE_CHANGED" });
  });

  it("clears background job state with preview/credential lifecycle cleanup", async () => {
    const started = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    const identity = {
      marketplaceId: US,
      runId: String(jsonValue(started).runId),
      contextId: String(jsonValue(started).contextId),
    };
    router.dispose();
    const status = await router.handle(request("GET", "/api/sp-api/audit-suite", identity));
    expect(status.status).toBe(410);
    expect(jsonValue(status)).toMatchObject({ code: "AUDIT_SUITE_EXPIRED" });
  });

  it("does not issue the next report-status request after lifecycle cleanup aborts a wait", async () => {
    const getListingStatus = vi.fn(async () => ({
      mode: "demo" as const,
      ready: false,
      reportId: `pending-${US}`,
      documentId: null,
      status: "IN_PROGRESS" as const,
      notice: "pending",
    }));
    startListing = vi.fn(async () => ({
      mode: "demo" as const,
      ready: false,
      reportId: `pending-${US}`,
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "pending",
    }));
    const directory = await mkdtemp(join(tmpdir(), "audit-suite-abort-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router.dispose();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => accountScope),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      allListingsDemoReports: {
        start: startListing,
        status: getListingStatus,
      },
    });
    await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    for (let attempt = 0; attempt < 100 && startListing.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(startListing).toHaveBeenCalledTimes(1);

    router.dispose();
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(getListingStatus).not.toHaveBeenCalled();
  });

  it("expires terminal jobs after the main-process TTL", async () => {
    const started = await router.handle(request("POST", "/api/sp-api/audit-suite", {
      marketplaceId: US,
    }));
    const identity = {
      marketplaceId: US,
      runId: String(jsonValue(started).runId),
      contextId: String(jsonValue(started).contextId),
    };
    await waitForTerminal(router, identity);
    const future = Date.now() + 31 * 60 * 1_000;
    vi.useFakeTimers();
    vi.setSystemTime(future);
    const status = await router.handle(request("GET", "/api/sp-api/audit-suite", identity));
    expect(status.status).toBe(410);
    expect(jsonValue(status)).toMatchObject({ code: "AUDIT_SUITE_EXPIRED" });
  });
});

describe("A+ run-all adapter", () => {
  it("treats an exact published record as clean presence after a later-page failure", () => {
    const result = buildAplusAuditSuiteResult({
      mode: "live",
      marketplaceId: US,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "main-owned-fba-snapshot",
      totals: {
        eligibleFbaSkus: 1,
        uniqueAsins: 1,
        published: 1,
        missing: 0,
        incomplete: 0,
        unavailable: 0,
      },
      summary: {
        eligibleFbaSkus: 1,
        uniqueAsins: 1,
        published: 1,
        missing: 0,
        incomplete: 0,
        unavailable: 0,
      },
      rows: [{
        sellerSku: "APLUS-PARTIAL",
        asin: "B000000001",
        title: "Published with partial coverage",
        marketplaceId: US,
        status: "published",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        contentTypes: ["EBC"],
        locales: ["en-US"],
        documents: [],
        documentEvidenceCompleteness: "unavailable",
        reasonCode: "PUBLISHED_RECORD_FOUND",
        reason: "已找到 exact A+ 發布紀錄，但後續來源未完整。",
      }],
      notice: "只讀取目前 FBA 商品的官方 A+ publish records。",
    });

    expect(result.status).toBe("completed");
    expect(result.payload).toEqual([]);
    expect(result.notice).toBe("只讀取目前 FBA 商品的官方 A+ publish records。");
  });

  it("keeps warning-only A+ evidence actionable in the combined audit", () => {
    const result = buildAplusAuditSuiteResult({
      mode: "live",
      marketplaceId: US,
      fetchedAt: "2026-08-23T08:00:00.000Z",
      fbaSnapshotId: "main-owned-fba-warning-snapshot",
      totals: {
        eligibleFbaSkus: 1,
        uniqueAsins: 1,
        published: 0,
        missing: 0,
        incomplete: 1,
        unavailable: 0,
      },
      summary: {
        eligibleFbaSkus: 1,
        uniqueAsins: 1,
        published: 0,
        missing: 0,
        incomplete: 1,
        unavailable: 0,
      },
      rows: [{
        sellerSku: "APLUS-WARNING",
        asin: "B000000002",
        title: "Warning-only evidence",
        marketplaceId: US,
        status: "incomplete",
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        contentTypes: [],
        locales: [],
        documents: [],
        documentEvidenceCompleteness: "unavailable",
        reasonCode: "A_PLUS_WARNING_PRESENT",
        reason: "Amazon A+ 回應含警告，無法確認目前是否已發布。",
      }],
      notice: "只讀取目前 FBA 商品的官方 A+ publish records。",
    });

    expect(result.status).toBe("partial");
    expect(result.payload[0]).toMatchObject({
      sellerSku: "APLUS-WARNING",
      finding: "Amazon 回應警告，請到 A+ 管理員確認",
    });
  });
});

describe("advertising suite fail-closed mapper", () => {
  it("does not send an incomplete valid-ASIN row into coverage and emits it once", () => {
    const result = buildAdvertisingAuditSuiteResult({
      marketplaceId: US,
      marketplaceCode: "US",
      source: {
        fetchedAt: "2026-08-09T00:00:00.000Z",
        rows: [{
          sellerSku: "SKU-INCOMPLETE",
          asin: "B000000001",
          title: "Incomplete listing",
          readStatus: "incomplete",
          readErrors: [{ message: "Listings content was not returned." }],
        }],
        errors: [],
      },
      campaigns: [{
        campaignId: "campaign-1",
        name: "[ProductAI] US-B000000001-SKU-INCOMPLETE-SP-PAT-Aug92026",
        state: "ENABLED",
        adProduct: "SPONSORED_PRODUCTS",
      }],
    });
    expect(result.status).toBe("partial");
    expect(result.payload).toHaveLength(1);
    expect(result.payload[0]).toMatchObject({
      sellerSku: "SKU-INCOMPLETE",
      finding: "未完成",
    });
  });

  it("turns source data.errors into partial problem rows and rejects unscoped errors", () => {
    const source = {
      fetchedAt: "2026-08-09T00:00:00.000Z",
      rows: [{
        sellerSku: "SKU-ERROR",
        asin: "B000000002",
        title: "Errored listing",
        readStatus: "complete" as const,
        readErrors: [],
      }],
      errors: [{ sellerSku: "SKU-ERROR", kind: "讀取失敗", message: "Upstream error." }],
    };
    const result = buildAdvertisingAuditSuiteResult({
      marketplaceId: US,
      marketplaceCode: "US",
      source,
      campaigns: [],
    });
    expect(result.status).toBe("partial");
    expect(result.payload).toEqual([expect.objectContaining({
      sellerSku: "SKU-ERROR",
      finding: "未完成",
      evidence: expect.stringContaining("Upstream error"),
    })]);
    expect(() => buildAdvertisingAuditSuiteResult({
      marketplaceId: US,
      marketplaceCode: "US",
      source: { ...source, rows: [], errors: [{ sellerSku: "", kind: "錯誤", message: "Unknown scope" }] },
      campaigns: [],
    })).toThrow(/缺少可核對 Seller SKU/u);
  });
});
