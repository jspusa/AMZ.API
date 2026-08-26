import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdvertisingGateway } from "../src/main/amazon/ads-api";
import type { ReportsAdapter } from "../src/main/amazon/reports-runtime";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const previousMode = process.env.SP_API_MODE;
const previousClientId = process.env.SP_API_LWA_CLIENT_ID;
const previousClientSecret = process.env.SP_API_LWA_CLIENT_SECRET;
const previousRefreshToken = process.env.SP_API_REFRESH_TOKEN_NA;
const MARKETPLACE_ID = "ATVPDKIKX0DER";

function request(path: string): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path,
    query: { marketplaceId: MARKETPLACE_ID },
    headers: {},
  };
}

function useLiveSpMode(): void {
  process.env.SP_API_MODE = "live";
  process.env.SP_API_LWA_CLIENT_ID = "test-client";
  process.env.SP_API_LWA_CLIENT_SECRET = "test-secret";
  process.env.SP_API_REFRESH_TOKEN_NA = "test-refresh";
}

describe("advertising coverage route boundary", () => {
  let store: LocalStore;
  let router: ApiRouter;

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    const directory = await mkdtemp(join(tmpdir(), "amz-ad-coverage-router-"));
    store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "demo-account-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
  });

  afterEach(() => {
    router.dispose();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
    if (previousClientId === undefined) delete process.env.SP_API_LWA_CLIENT_ID;
    else process.env.SP_API_LWA_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SP_API_LWA_CLIENT_SECRET;
    else process.env.SP_API_LWA_CLIENT_SECRET = previousClientSecret;
    if (previousRefreshToken === undefined) delete process.env.SP_API_REFRESH_TOKEN_NA;
    else process.env.SP_API_REFRESH_TOKEN_NA = previousRefreshToken;
  });

  it("runs the naming and same-ASIN engine only in explicit demo mode", async () => {
    const status = await router.handle(request("/api/amazon-ads/status"));
    expect(status.body.kind).toBe("json");
    if (status.body.kind !== "json") throw new Error("Expected status JSON");
    expect(status.body.value).toMatchObject({
      configured: false,
      coverageAuditAvailable: true,
    });

    const coverage = await router.handle(request("/api/amazon-ads/coverage"));
    expect(coverage.status).toBe(200);
    expect(coverage.body.kind).toBe("json");
    if (coverage.body.kind !== "json") throw new Error("Expected coverage JSON");
    expect(coverage.body.value).toMatchObject({
      schemaVersion: 1,
      mode: "demo",
      marketplaceId: MARKETPLACE_ID,
      marketplaceCode: "US",
    });
  });

  it("never substitutes demo campaigns when Ads API is not connected", async () => {
    useLiveSpMode();
    const status = await router.handle(request("/api/amazon-ads/status"));
    if (status.body.kind !== "json") throw new Error("Expected status JSON");
    expect(status.body.value).toMatchObject({ coverageAuditAvailable: false });

    const coverage = await router.handle(request("/api/amazon-ads/coverage"));
    expect(coverage.status).toBe(422);
    expect(coverage.body.kind).toBe("json");
    if (coverage.body.kind !== "json") throw new Error("Expected problem JSON");
    expect(coverage.body.value).toMatchObject({ code: "ADS_API_NOT_CONNECTED" });
  });

  it("never calls a live Ads gateway while the marketplace is in demo mode", async () => {
    process.env.SP_API_MODE = "demo";
    const advertising: AdvertisingGateway = {
      getCredentialSummary: vi.fn(),
      probeMarketplace: vi.fn(),
      listEnabledSponsoredProductCampaigns: vi.fn(),
      invalidate: vi.fn(),
    };
    const demoRouter = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "demo-account-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      advertising,
    });

    const status = await demoRouter.handle(request("/api/amazon-ads/status"));
    expect(status.status).toBe(200);
    expect(advertising.getCredentialSummary).not.toHaveBeenCalled();
    expect(advertising.probeMarketplace).not.toHaveBeenCalled();
    expect(advertising.listEnabledSponsoredProductCampaigns).not.toHaveBeenCalled();
  });

  it("reports a verified live Viewer connection without enabling campaign writes", async () => {
    useLiveSpMode();
    const advertising: AdvertisingGateway = {
      getCredentialSummary: vi.fn(async () => ({
        encryptionAvailable: true,
        hasVault: true,
        configured: true,
        lwaConfigured: true,
        refreshTokenConfigured: true,
        oauthRegion: "na" as const,
        updatedAt: "2026-08-09T00:00:00.000Z",
      })),
      probeMarketplace: vi.fn(async () => ({
        ok: true,
        testedAt: "2026-08-09T00:00:01.000Z",
        marketplaceId: MARKETPLACE_ID,
        marketplaceCode: "US",
        accountType: "seller" as const,
        message: "Amazon Ads US 唯讀連線成功。",
        requestId: null,
      })),
      listEnabledSponsoredProductCampaigns: vi.fn(async () => []),
      invalidate: vi.fn(),
    };
    const liveRouter = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "live-account-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      advertising,
    });

    const status = await liveRouter.handle(request("/api/amazon-ads/status"));
    expect(status.body.kind).toBe("json");
    if (status.body.kind !== "json") throw new Error("Expected status JSON");
    expect(status.body.value).toMatchObject({
      configured: true,
      verified: true,
      profileConfigured: true,
      requiredPermission: "Campaign manager Viewer",
      permissionVerified: false,
      writeEnabled: false,
      coverageAuditAvailable: true,
    });
  });

  it("does not turn the legacy coverage data GET into a report create or retry", async () => {
    useLiveSpMode();
    const advertising: AdvertisingGateway = {
      getCredentialSummary: vi.fn(async () => ({
        encryptionAvailable: true,
        hasVault: true,
        configured: true,
        lwaConfigured: true,
        refreshTokenConfigured: true,
        oauthRegion: "na" as const,
        updatedAt: "2026-08-25T00:00:00.000Z",
      })),
      probeMarketplace: vi.fn(),
      listEnabledSponsoredProductCampaigns: vi.fn(async () => []),
      invalidate: vi.fn(),
    };
    const create = vi.fn<ReportsAdapter["create"]>(async (request) => {
      const { operation: _operation, signal: _signal, ...identity } = request;
      return {
        identity,
        mode: "live",
        ready: false,
        reportId: "must-not-be-created",
        documentId: null,
        status: "IN_QUEUE",
        notice: "pending",
      };
    });
    const reportsAdapter: ReportsAdapter = {
      create,
      status: vi.fn<ReportsAdapter["status"]>(async (request) => {
        const {
          operation: _operation,
          reportId,
          signal: _signal,
          ...identity
        } = request;
        return {
          identity,
          mode: "live",
          ready: false,
          reportId,
          documentId: null,
          status: "IN_QUEUE",
          notice: "pending",
        };
      }),
      readDocument: vi.fn(async () => {
        throw new Error("A missing lease must not be downloaded.");
      }),
    };
    const liveRouter = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "live-account-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      advertising,
      reportsAdapter,
    });

    const coverage = await liveRouter.handle(request("/api/amazon-ads/coverage"));

    expect(coverage.status).toBe(409);
    expect(coverage.body.kind).toBe("json");
    if (coverage.body.kind !== "json") throw new Error("Expected problem JSON");
    expect(coverage.body.value).toMatchObject({ code: "REPORT_NOT_READY" });
    expect(create).not.toHaveBeenCalled();
    expect(reportsAdapter.status).not.toHaveBeenCalled();
    expect(reportsAdapter.readDocument).not.toHaveBeenCalled();
    expect(advertising.listEnabledSponsoredProductCampaigns).not.toHaveBeenCalled();
    liveRouter.dispose();
  });

  it("fails closed when the account context changes during an Ads status read", async () => {
    useLiveSpMode();
    let accountScope = "ads-status-account-a";
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseSummary!: () => void;
    const summaryReleased = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    const advertising: AdvertisingGateway = {
      getCredentialSummary: vi.fn(async () => {
        signalStarted();
        await summaryReleased;
        return {
          encryptionAvailable: true,
          hasVault: true,
          configured: true,
          lwaConfigured: true,
          refreshTokenConfigured: true,
          oauthRegion: "na" as const,
          updatedAt: "2026-08-25T00:00:00.000Z",
        };
      }),
      probeMarketplace: vi.fn(),
      listEnabledSponsoredProductCampaigns: vi.fn(),
      invalidate: vi.fn(),
    };
    const liveRouter = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => accountScope,
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      advertising,
      spExecutionContext: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: MARKETPLACE_ID,
        mode: "live",
        accountScope,
      })),
    });

    const responsePromise = liveRouter.handle(request("/api/amazon-ads/status"));
    await started;
    accountScope = "ads-status-account-b";
    releaseSummary();

    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected problem JSON");
    expect(response.body.value).toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
    expect(advertising.probeMarketplace).not.toHaveBeenCalled();
    expect(advertising.invalidate).toHaveBeenCalledOnce();
    liveRouter.dispose();
  });
});
