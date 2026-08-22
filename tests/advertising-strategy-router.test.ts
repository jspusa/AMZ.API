import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdvertisingApiError,
  SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
  type AdvertisingGateway,
  type SponsoredProductsAdvertisedProductReportReference,
} from "../src/main/amazon/ads-api";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const START_DATE = "2026-08-01";
const END_DATE = "2026-08-20";
const previousEnvironment = {
  mode: process.env.SP_API_MODE,
  clientId: process.env.SP_API_LWA_CLIENT_ID,
  clientSecret: process.env.SP_API_LWA_CLIENT_SECRET,
  refreshToken: process.env.SP_API_REFRESH_TOKEN_NA,
};

function apiRequest(input: {
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: input.method,
    path: "/api/amazon-ads/strategy",
    query: input.query ?? {},
    headers: {},
    body: input.body ? { kind: "json", value: input.body } : undefined,
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json" || !response.body.value || typeof response.body.value !== "object") {
    throw new Error("Expected JSON object");
  }
  return response.body.value as Record<string, unknown>;
}

describe("FBA advertising strategy router job", () => {
  let spScope: string;
  let adsScope: string;
  let adsProfileFingerprint: string;
  let store: LocalStore;
  let routers: ApiRouter[];

  beforeEach(async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-21T12:00:00.000Z"));
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "test-client";
    process.env.SP_API_LWA_CLIENT_SECRET = "test-secret";
    process.env.SP_API_REFRESH_TOKEN_NA = "test-refresh";
    spScope = "sp-account-scope-a";
    adsScope = "ads-account-scope-a:sp-account-scope-a";
    adsProfileFingerprint = "a".repeat(64);
    routers = [];
    const directory = await mkdtemp(join(tmpdir(), "amz-ad-strategy-router-"));
    store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
  });

  afterEach(() => {
    routers.forEach((router) => router.clearPreviews());
    vi.restoreAllMocks();
    if (previousEnvironment.mode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousEnvironment.mode;
    if (previousEnvironment.clientId === undefined) delete process.env.SP_API_LWA_CLIENT_ID;
    else process.env.SP_API_LWA_CLIENT_ID = previousEnvironment.clientId;
    if (previousEnvironment.clientSecret === undefined) delete process.env.SP_API_LWA_CLIENT_SECRET;
    else process.env.SP_API_LWA_CLIENT_SECRET = previousEnvironment.clientSecret;
    if (previousEnvironment.refreshToken === undefined) delete process.env.SP_API_REFRESH_TOKEN_NA;
    else process.env.SP_API_REFRESH_TOKEN_NA = previousEnvironment.refreshToken;
  });

  function buildRouter(input: {
    createAdsReport?: () => Promise<SponsoredProductsAdvertisedProductReportReference>;
    getAdsStatus?: AdvertisingGateway["getSponsoredProductsAdvertisedProductReportStatus"];
    onStrategyWait?: (milliseconds: number) => void;
    onScope?: () => void;
    secondSalesChildAsin?: string;
  } = {}): {
    router: ApiRouter;
    createAdsReport: ReturnType<typeof vi.fn>;
    startListing: ReturnType<typeof vi.fn>;
  } {
    const adsReference = (): SponsoredProductsAdvertisedProductReportReference => ({
      reportId: "ads-report-main-only-1",
      marketplaceId: MARKETPLACE_ID,
      combinedAccountScope: adsScope,
      startDate: START_DATE,
      endDate: END_DATE,
      configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
    });
    const createAdsReport = vi.fn(input.createAdsReport ?? (async () => adsReference()));
    const startListing = vi.fn(async () => ({
      mode: "live" as const,
      ready: true,
      reportId: "fba-listings-report-main-only",
      documentId: "fba-listings-document-main-only",
      status: "DONE" as const,
      notice: "ready",
    }));
    const advertising: AdvertisingGateway = {
      getCredentialSummary: vi.fn(async () => ({
        encryptionAvailable: true,
        hasVault: true,
        configured: true,
        lwaConfigured: true,
        refreshTokenConfigured: true,
        oauthRegion: "na" as const,
        updatedAt: "2026-08-21T00:00:00.000Z",
      })),
      getCombinedAccountScope: vi.fn(async () => {
        input.onScope?.();
        return adsScope;
      }),
      getCombinedAccountIdentity: vi.fn(async () => {
        input.onScope?.();
        return { combinedAccountScope: adsScope, adsProfileFingerprint };
      }),
      probeMarketplace: vi.fn(async () => ({
        ok: true,
        testedAt: "2026-08-21T00:00:00.000Z",
        marketplaceId: MARKETPLACE_ID,
        marketplaceCode: "US",
        accountType: "seller" as const,
        message: "verified",
        requestId: null,
      })),
      listEnabledSponsoredProductCampaigns: vi.fn(async () => []),
      createSponsoredProductsAdvertisedProductReport: createAdsReport,
      getSponsoredProductsAdvertisedProductReportStatus: vi.fn(
        input.getAdsStatus ?? (async (reference) => ({
          reference,
          status: "COMPLETED" as const,
          ready: true,
          updatedAt: "2026-08-21T12:00:01.000Z",
        })),
      ),
      downloadSponsoredProductsAdvertisedProductReport: vi.fn(async (reference) => ({
        reference,
        rows: [{
          campaignId: "campaign-safe-1",
          campaignName: "Synthetic SP",
          adGroupId: "ad-group-safe-1",
          adGroupName: "Synthetic group",
          advertisedSku: "SAFE-SKU-1",
          advertisedAsin: "B000000001",
          impressions: 100,
          clicks: 5,
          cost: 12,
          sales14d: 60,
          purchases14d: 2,
        }, {
          campaignId: "campaign-safe-2",
          campaignName: "Synthetic SP unique ASIN",
          adGroupId: "ad-group-safe-2",
          adGroupName: "Synthetic group",
          advertisedSku: null,
          advertisedAsin: "B000000002",
          impressions: 50,
          clicks: 2,
          cost: 5,
          sales14d: 0,
          purchases14d: 0,
        }],
      })),
      invalidate: vi.fn(),
    };
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => {
          input.onScope?.();
          return spScope;
        },
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      advertising,
      brandSalesReports: {
        startListing,
      },
      advertisingStrategySources: {
        fbaListings: async () => ({
          mode: "live",
          marketplaceId: MARKETPLACE_ID,
          fetchedAt: "2026-08-21T12:00:02.000Z",
          rows: [
            { sellerSku: "SAFE-SKU-1", asin: "B000000001", title: "Synthetic Dog Treat One" },
            { sellerSku: "SAFE-SKU-2", asin: "B000000002", title: "Synthetic Dog Treat Two" },
          ],
          notice: "synthetic FBA",
        }),
      },
      advertisingStrategyWait: async (milliseconds, signal) => {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        input.onStrategyWait?.(milliseconds);
      },
      salesAndTrafficReports: {
        start: async () => ({
          mode: "live",
          ready: true,
          reportId: "sales-report-main-only",
          documentId: "sales-document-main-only",
          status: "DONE",
          notice: "ready",
        }),
        data: async () => ({
          mode: "live",
          marketplaceId: MARKETPLACE_ID,
          startDate: START_DATE,
          endDate: END_DATE,
          fetchedAt: "2026-08-21T12:00:03.000Z",
          rows: [
            {
              sellerSku: "SAFE-SKU-1",
              childAsin: "B000000001",
              unitsOrdered: 10,
              orderedProductSales: 100,
              currencyCode: "USD",
            },
            {
              sellerSku: "SAFE-SKU-2",
              childAsin: input.secondSalesChildAsin ?? "B000000002",
              unitsOrdered: 5,
              orderedProductSales: 25,
              currencyCode: "USD",
            },
          ],
          notice: "synthetic sales",
        }),
      },
    });
    routers.push(router);
    return { router, createAdsReport, startListing };
  }

  async function start(router: ApiRouter, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return jsonValue(await router.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: START_DATE,
        endDate: END_DATE,
        ...extra,
      },
    })));
  }

  async function getJob(router: ApiRouter, jobId: string): Promise<ApiResponse> {
    return router.handle(apiRequest({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId,
        startDate: START_DATE,
        endDate: END_DATE,
      },
    }));
  }

  async function terminal(router: ApiRouter, jobId: string): Promise<Record<string, unknown>> {
    let last: Record<string, unknown> | null = null;
    // A loaded CI runner can take longer than 200 ms to advance all four
    // background phases. Keep fast local polling, but allow a bounded two
    // seconds before declaring the job stuck.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const response = await getJob(router, jobId);
      const value = jsonValue(response);
      last = value;
      if (value.state !== "running") return value;
    }
    throw new Error(`Advertising strategy job did not finish: ${JSON.stringify(last)}`);
  }

  it("returns a complete synthetic strategy without exposing report or account identity", async () => {
    const { router, createAdsReport } = buildRouter();
    const started = await start(router);
    expect(started).toMatchObject({
      schemaVersion: 1,
      marketplaceId: MARKETPLACE_ID,
      marketplaceCode: "US",
      state: "running",
      progress: { total: 4 },
      snapshot: null,
    });
    const completed = await terminal(router, String(started.jobId));
    expect(completed).toMatchObject({
      state: "completed",
      progress: { phase: "building", completed: 4, total: 4 },
      snapshot: {
        schemaVersion: 1,
        marketplaceId: MARKETPLACE_ID,
        currencyCode: "USD",
        rows: [
          { sellerSku: "SAFE-SKU-1", salesTier: "T1", spSpend: 12 },
          { sellerSku: "SAFE-SKU-2", salesTier: "T3", spSpend: 5 },
        ],
      },
    });
    const serialized = JSON.stringify(completed);
    expect(serialized).not.toMatch(/report-main-only|document-main-only|account-scope|campaign-safe|ad-group-safe/i);
    expect(createAdsReport).toHaveBeenCalledTimes(1);
  });

  it("keeps the Sales & Traffic child ASIN through the router and rejects identity drift", async () => {
    const { router } = buildRouter({ secondSalesChildAsin: "B000000099" });
    const started = await start(router);
    const completed = await terminal(router, String(started.jobId));

    expect(completed).toMatchObject({
      state: "completed",
      snapshot: {
        rows: [
          { sellerSku: "SAFE-SKU-1", salesStatus: "reported" },
          {
            sellerSku: "SAFE-SKU-2",
            price: null,
            salesStatus: "not-reported",
            salesAmount: null,
          },
        ],
        unresolved: [
          {
            source: "sales",
            sellerSku: "SAFE-SKU-2",
            asin: "B000000099",
            code: "sales-sku-asin-mismatch",
            amount: 25,
          },
        ],
      },
    });
  });

  it("single-flights the same running selection", async () => {
    const { router, createAdsReport } = buildRouter();
    const first = await start(router);
    const second = await start(router);
    expect(second.jobId).toBe(first.jobId);
    await terminal(router, String(first.jobId));
    expect(createAdsReport).toHaveBeenCalledTimes(1);
  });

  it("keeps polling the same Ads report beyond thirty minutes", async () => {
    let waited = 0;
    const built = buildRouter({
      onStrategyWait: (milliseconds) => {
        waited += milliseconds;
      },
      getAdsStatus: async (reference) => ({
        reference,
        status: waited >= 31 * 60 * 1_000 ? "COMPLETED" : "PROCESSING",
        ready: waited >= 31 * 60 * 1_000,
        updatedAt: "2026-08-21T12:00:01.000Z",
      }),
    });

    const started = await start(built.router);
    const completed = await terminal(built.router, String(started.jobId));

    expect(completed).toMatchObject({ state: "completed" });
    expect(waited).toBeGreaterThanOrEqual(31 * 60 * 1_000);
    expect(built.createAdsReport).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh known-completed FBA listing report on explicit refresh", async () => {
    const built = buildRouter();
    const first = await start(built.router);
    await terminal(built.router, String(first.jobId));

    const refreshed = await start(built.router, { refresh: true });
    await terminal(built.router, String(refreshed.jobId));

    expect(built.startListing).toHaveBeenCalledTimes(2);
  });

  it("rejects future dates before reading account scope or creating reports", async () => {
    const onScope = vi.fn();
    const { router, createAdsReport } = buildRouter({ onScope });
    const response = await router.handle(apiRequest({
      method: "POST",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-21",
      },
    }));
    expect(response.status).toBe(400);
    expect(jsonValue(response)).toMatchObject({ code: "ADS_STRATEGY_DATE_INVALID" });
    expect(onScope).not.toHaveBeenCalled();
    expect(createAdsReport).not.toHaveBeenCalled();
  });

  it("invalidates an old job when either account scope changes", async () => {
    const { router } = buildRouter();
    const started = await start(router);
    await terminal(router, String(started.jobId));
    adsScope = "ads-account-scope-b:sp-account-scope-a";
    const response = await getJob(router, String(started.jobId));
    expect(response.status).toBe(409);
    expect(jsonValue(response)).toMatchObject({ code: "JOB_MISMATCH" });
  });

  it("invalidates an old job when the main-only Ads Profile fingerprint changes", async () => {
    const { router } = buildRouter();
    const started = await start(router);
    await terminal(router, String(started.jobId));
    adsProfileFingerprint = "b".repeat(64);

    const response = await getJob(router, String(started.jobId));

    expect(response.status).toBe(409);
    expect(jsonValue(response)).toMatchObject({ code: "JOB_MISMATCH" });
    expect(JSON.stringify(jsonValue(response))).not.toMatch(/[ab]{64}/u);
  });

  it("does not repeat an ambiguous Ads report POST on automatic rerun", async () => {
    const createAdsReport = vi.fn(async (): Promise<SponsoredProductsAdvertisedProductReportReference> => {
      throw new AdvertisingApiError("temporary upstream ambiguity", {
        status: 503,
        code: "ADS_UPSTREAM_FAILED",
      });
    });
    const built = buildRouter({ createAdsReport });
    const first = await start(built.router);
    const firstTerminal = await terminal(built.router, String(first.jobId));
    expect(firstTerminal).toMatchObject({
      state: "failed",
      errorCode: "REPORT_RETRY_REQUIRED",
    });

    const second = await start(built.router, { refresh: true });
    const secondTerminal = await terminal(built.router, String(second.jobId));
    expect(secondTerminal).toMatchObject({
      state: "failed",
      errorCode: "REPORT_RETRY_REQUIRED",
    });
    expect(createAdsReport).toHaveBeenCalledTimes(1);
  });

  it("allows one explicit retry only after the durable retry guard expires", async () => {
    const createAdsReport = vi.fn(async (): Promise<SponsoredProductsAdvertisedProductReportReference> => {
      throw new AdvertisingApiError("temporary upstream ambiguity", {
        status: 503,
        code: "ADS_UPSTREAM_FAILED",
      });
    });
    const built = buildRouter({ createAdsReport });
    const first = await start(built.router);
    await terminal(built.router, String(first.jobId));
    expect(createAdsReport).toHaveBeenCalledTimes(1);

    vi.mocked(Date.now).mockReturnValue(
      Date.parse("2026-08-21T12:31:00.000Z"),
    );
    const retried = await start(built.router, {
      refresh: true,
      explicitRetry: true,
    });
    const retryTerminal = await terminal(built.router, String(retried.jobId));

    expect(retryTerminal).toMatchObject({
      state: "failed",
      errorCode: "REPORT_RETRY_REQUIRED",
    });
    expect(createAdsReport).toHaveBeenCalledTimes(2);
  });
});
