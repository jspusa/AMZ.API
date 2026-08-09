import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter, buildAdvertisingAuditSuiteResult } from "../src/main/api-router";
import { startAllListingsReport } from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER";
const CA = "A2EUQ1WTGCTBG2";
const previousMode = process.env.SP_API_MODE;
const previousClientId = process.env.SP_API_LWA_CLIENT_ID;
const previousClientSecret = process.env.SP_API_LWA_CLIENT_SECRET;
const previousRefreshToken = process.env.SP_API_REFRESH_TOKEN_NA;

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
  let startListing: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    accountScope = "account-scope-one";
    startListing = vi.fn(async ({ marketplaceId }: { marketplaceId: string }) => ({
      mode: "demo" as const,
      ready: true,
      reportId: `demo-${marketplaceId}`,
      documentId: `demo-${marketplaceId}`,
      status: "DONE" as const,
      notice: "ready",
    }));
    const directory = await mkdtemp(join(tmpdir(), "audit-suite-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => accountScope),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      brandSalesReports: { startListing: startListing as typeof startAllListingsReport },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    router?.clearPreviews();
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
        advertising: { status: "failed" },
      },
    });
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
    router.clearPreviews();
    const status = await router.handle(request("GET", "/api/sp-api/audit-suite", identity));
    expect(status.status).toBe(410);
    expect(jsonValue(status)).toMatchObject({ code: "AUDIT_SUITE_EXPIRED" });
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
