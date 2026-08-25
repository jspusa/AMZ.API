import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  AdvertisingApiClient,
  SP_ADVERTISED_PRODUCT_REPORT_COLUMNS,
  SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
  parseSponsoredProductsAdvertisedProductRows,
  type SponsoredProductsAdvertisedProductReportReference,
} from "../src/main/amazon/ads-api";
import type {
  AdvertisingCredentialVault,
  StoredAdvertisingCredentials,
} from "../src/main/advertising-credential-vault";

const credentials: StoredAdvertisingCredentials = {
  version: 1,
  lwaClientId: "ads-client-id-test",
  lwaClientSecret: "ads-client-secret-test",
  refreshToken: "ads-refresh-token-test",
  oauthRegion: "na",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

function vault(
  value: StoredAdvertisingCredentials = credentials,
): AdvertisingCredentialVault {
  return {
    load: vi.fn(async () => structuredClone(value)),
    getAccountScope: vi.fn(async () => "ads-account-scope"),
    getSummary: vi.fn(async () => ({
      encryptionAvailable: true,
      hasVault: true,
      configured: true,
      lwaConfigured: true,
      refreshTokenConfigured: true,
      oauthRegion: value.oauthRegion,
      updatedAt: value.updatedAt,
    })),
  } as unknown as AdvertisingCredentialVault;
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fingerprint(namespace: string, values: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(namespace);
  values.forEach((value) => {
    hash.update("\0");
    hash.update(value);
  });
  return hash.digest("hex");
}

function combinedAccountScope(
  profileId = "123456789",
  spAccountScope = "sp-scope-test",
): string {
  const profileFingerprint = fingerprint("amz-api:amazon-ads-profile:v1", [
    "ATVPDKIKX0DER",
    profileId,
  ]);
  return fingerprint("amz-api:amazon-ads-combined-account:v1", [
    `ads-account-scope:${spAccountScope}`,
    profileFingerprint,
  ]);
}

function reportReference(
  overrides: Partial<SponsoredProductsAdvertisedProductReportReference> = {},
): SponsoredProductsAdvertisedProductReportReference {
  return {
    reportId: "report-test-1",
    marketplaceId: "ATVPDKIKX0DER",
    combinedAccountScope: combinedAccountScope(),
    startDate: "2026-07-01",
    endDate: "2026-07-30",
    configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
    ...overrides,
  };
}

function reportStatusPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    reportId: "report-test-1",
    startDate: "2026-07-01",
    endDate: "2026-07-30",
    status: "PENDING",
    updatedAt: "2026-08-01T00:00:00.000Z",
    url: null,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["advertiser"],
      columns: [...SP_ADVERTISED_PRODUCT_REPORT_COLUMNS],
      reportTypeId: "spAdvertisedProduct",
      timeUnit: "SUMMARY",
      format: "GZIP_JSON",
    },
    ...overrides,
  };
}

const spContext = async () => ({ accountScope: "sp-scope-test", sellerId: "seller-test" });

describe("main-only Amazon Ads client", () => {
  it("uses allowlisted NA endpoints, auto-discovers one seller profile, and single-flights access tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "https://api.amazon.com/auth/o2/token") {
        return json({ access_token: "memory-only-access-token", expires_in: 3600 });
      }
      if (url.startsWith("https://advertising-api.amazon.com/v2/profiles?")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: {
            id: "seller-test",
            type: "seller",
            marketplaceStringId: "ATVPDKIKX0DER",
          },
        }]);
      }
      if (url === "https://advertising-api.amazon.com/adsApi/v1/query/campaigns") {
        return json({ campaigns: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    const [left, right] = await Promise.all([
      client.probeMarketplace("ATVPDKIKX0DER"),
      client.probeMarketplace("ATVPDKIKX0DER"),
    ]);
    const cached = await client.probeMarketplace("ATVPDKIKX0DER");

    expect(left).toMatchObject({ ok: true, marketplaceCode: "US", accountType: "seller" });
    expect(right.ok).toBe(true);
    expect(cached.ok).toBe(true);
    expect(JSON.stringify(left)).not.toContain("123456789");
    expect(JSON.stringify(left)).not.toContain("seller-test");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/o2/token"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v2/profiles"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/query/campaigns"))).toHaveLength(1);

    const profileCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/v2/profiles"));
    const profileHeaders = profileCall?.[1]?.headers as Record<string, string>;
    expect(profileHeaders["Amazon-Advertising-API-ClientId"]).toBe(credentials.lwaClientId);
    expect(profileHeaders).not.toHaveProperty("Amazon-Advertising-API-Scope");

    const queryCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/query/campaigns"));
    const queryHeaders = queryCall?.[1]?.headers as Record<string, string>;
    expect(queryHeaders["Amazon-Ads-ClientId"]).toBe(credentials.lwaClientId);
    expect(queryHeaders["Amazon-Advertising-API-Scope"]).toBe("123456789");
    expect(queryHeaders).not.toHaveProperty("Amazon-Ads-AccountId");
    expect(queryCall?.[1]?.method).toBe("POST");
  });

  it("queries only enabled Sponsored Products and follows bounded pagination", async () => {
    let queryCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      queryCount += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        adProductFilter: { include: ["SPONSORED_PRODUCTS"] },
        stateFilter: { include: ["ENABLED"] },
        maxResults: 100,
      });
      return queryCount === 1
        ? json({ campaigns: [{ campaignId: "c-1", name: "[ProductAI] US-B092384873-AFA33AM-SP-PAT-Aug92026", state: "ENABLED" }], nextToken: "page-2" })
        : json({ campaigns: [{ campaignId: "c-2", name: "[ProductAI] US-B092384873-AFA34AM-SP-PAT-Aug92026", state: "ENABLED" }] });
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    await expect(client.listEnabledSponsoredProductCampaigns("ATVPDKIKX0DER")).resolves.toHaveLength(2);
    expect(queryCount).toBe(2);
  });

  it("fails closed for region mismatch and ambiguous seller profiles", async () => {
    const euClient = new AdvertisingApiClient(vault({ ...credentials, oauthRegion: "eu" }), vi.fn(), spContext);
    await expect(euClient.probeMarketplace("ATVPDKIKX0DER")).resolves.toMatchObject({
      ok: false,
      marketplaceCode: "US",
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      return json([
        { profileId: 111, countryCode: "US", accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" } },
        { profileId: 222, countryCode: "US", accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" } },
      ]);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);
    await expect(client.probeMarketplace("ATVPDKIKX0DER")).resolves.toMatchObject({ ok: false });
  });

  it("stops a repeated campaign nextToken instead of looping", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (String(input).includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      return json({ campaigns: [], nextToken: "same-page" });
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    await expect(
      client.listEnabledSponsoredProductCampaigns("ATVPDKIKX0DER"),
    ).rejects.toMatchObject({ code: "ADS_PAGINATION_CONFLICT" });
  });

  it("refreshes exactly once after a 401 and succeeds with the replacement token", async () => {
    let tokenCount = 0;
    let profileCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCount += 1;
        return json({ access_token: `memory-token-${tokenCount}`, expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        profileCount += 1;
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe(`Bearer memory-token-${profileCount}`);
        if (profileCount === 1) return json({ message: "expired" }, 401);
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: {
            id: "seller-test",
            type: "seller",
            marketplaceStringId: "ATVPDKIKX0DER",
          },
        }]);
      }
      if (url.includes("/query/campaigns")) return json({ campaigns: [] });
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    await expect(client.probeMarketplace("ATVPDKIKX0DER")).resolves.toMatchObject({ ok: true });
    expect(tokenCount).toBe(2);
    expect(profileCount).toBe(2);
  });

  it("does not dispatch an Ads 401 retry after lifecycle invalidation", async () => {
    let tokenCount = 0;
    let profileCount = 0;
    let client: AdvertisingApiClient;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCount += 1;
        return json({ access_token: `memory-token-${tokenCount}`, expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        profileCount += 1;
        client.invalidate();
        return json({ message: "expired" }, 401);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    await expect(client.probeMarketplace("ATVPDKIKX0DER")).rejects.toThrow();
    expect(tokenCount).toBe(1);
    expect(profileCount).toBe(1);
  });

  it("does not rebind a probe to a new lifecycle after invalidation during account lookup", async () => {
    let accountLookupEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      accountLookupEntered = resolve;
    });
    let releaseAccountLookup!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseAccountLookup = resolve;
    });
    const credentialVault = vault() as unknown as {
      getAccountScope: ReturnType<typeof vi.fn>;
    };
    credentialVault.getAccountScope = vi.fn(async () => {
      accountLookupEntered();
      await released;
      return "ads-account-scope";
    });
    const fetchMock = vi.fn<typeof fetch>();
    const client = new AdvertisingApiClient(
      credentialVault as unknown as AdvertisingCredentialVault,
      fetchMock,
      spContext,
    );

    const pending = client.probeMarketplace("ATVPDKIKX0DER");
    await entered;
    client.invalidate();
    releaseAccountLookup();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
    const state = client as unknown as {
      token: unknown;
      profiles: Map<unknown, unknown>;
      verifications: Map<unknown, unknown>;
      tokenFlight: unknown;
      profileFlights: Map<unknown, unknown>;
      verificationFlights: Map<unknown, unknown>;
    };
    expect(state.token).toBeNull();
    expect(state.tokenFlight).toBeNull();
    expect(state.profiles.size).toBe(0);
    expect(state.verifications.size).toBe(0);
    expect(state.profileFlights.size).toBe(0);
    expect(state.verificationFlights.size).toBe(0);
  });

  it("stops after the second 401 and does not expose either response body or token", async () => {
    let tokenCount = 0;
    let profileCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCount += 1;
        return json({ access_token: `memory-token-${tokenCount}`, expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        profileCount += 1;
        return json({
          error_description: "upstream-private-authorization-detail",
          access_token: "upstream-private-token-value",
        }, 401);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    const result = await client.probeMarketplace("ATVPDKIKX0DER");
    expect(result).toMatchObject({ ok: false, requestId: null });
    expect(tokenCount).toBe(2);
    expect(profileCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("upstream-private");
    expect(JSON.stringify(result)).not.toContain("memory-token");
  });

  it("does not retry a 429 or expose its upstream body or access token", async () => {
    let tokenCount = 0;
    let profileCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCount += 1;
        return json({ access_token: "memory-token-rate-limit", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        profileCount += 1;
        return json({
          requestId: "safe-request-id",
          detail: "upstream-private-rate-limit-detail",
          access_token: "upstream-private-token-value",
        }, 429);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    const result = await client.probeMarketplace("ATVPDKIKX0DER");
    expect(result).toMatchObject({
      ok: false,
      requestId: "safe-request-id",
      message: "Amazon Ads 暫時限制查詢頻率，請稍後再試。",
    });
    expect(tokenCount).toBe(1);
    expect(profileCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("upstream-private");
    expect(JSON.stringify(result)).not.toContain("memory-token-rate-limit");
  });

  it("fails closed for a wrong Seller profile or missing SP Seller context", async () => {
    const wrongSellerFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: {
            id: "different-seller",
            type: "seller",
            marketplaceStringId: "ATVPDKIKX0DER",
          },
        }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const wrongSellerClient = new AdvertisingApiClient(vault(), wrongSellerFetch, spContext);
    await expect(wrongSellerClient.probeMarketplace("ATVPDKIKX0DER")).resolves.toMatchObject({
      ok: false,
      accountType: null,
    });
    expect(wrongSellerFetch.mock.calls.some(([url]) => String(url).includes("/query/campaigns")))
      .toBe(false);

    const missingCallbackFetch = vi.fn<typeof fetch>();
    const missingCallbackClient = new AdvertisingApiClient(vault(), missingCallbackFetch);
    await expect(missingCallbackClient.probeMarketplace("ATVPDKIKX0DER")).rejects.toMatchObject({
      code: "ADS_SELLER_CONTEXT_MISSING",
    });
    expect(missingCallbackFetch).not.toHaveBeenCalled();

    const incompleteContextFetch = vi.fn<typeof fetch>();
    const incompleteContextClient = new AdvertisingApiClient(
      vault(),
      incompleteContextFetch,
      async () => ({ accountScope: "", sellerId: "" }),
    );
    await expect(incompleteContextClient.probeMarketplace("ATVPDKIKX0DER")).rejects.toMatchObject({
      code: "ADS_SELLER_CONTEXT_MISSING",
    });
    expect(incompleteContextFetch).not.toHaveBeenCalled();
  });

  it("does not reuse a profile or verified result after the SP account changes", async () => {
    let current = { accountScope: "sp-scope-a", sellerId: "seller-a" };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: current.sellerId === "seller-a" ? 111 : 222,
          countryCode: "US",
          accountInfo: { id: current.sellerId, type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      return json({ campaigns: [] });
    });
    const client = new AdvertisingApiClient(
      vault(),
      fetchMock,
      async () => ({ ...current }),
    );

    await expect(client.probeMarketplace("ATVPDKIKX0DER")).resolves.toMatchObject({ ok: true });
    current = { accountScope: "sp-scope-b", sellerId: "seller-b" };
    await expect(client.probeMarketplace("ATVPDKIKX0DER")).resolves.toMatchObject({ ok: true });

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v2/profiles"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/query/campaigns"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/o2/token"))).toHaveLength(1);
  });

  it("creates one exact classic v3 SP advertised-product SUMMARY report without retrying the POST", async () => {
    let createCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-report-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      if (url === "https://advertising-api.amazon.com/reporting/reports") {
        createCount += 1;
        expect(init?.method).toBe("POST");
        const headers = init?.headers as Record<string, string>;
        expect(headers).toMatchObject({
          "content-type": "application/vnd.createasyncreportrequest.v3+json",
          accept: "application/vnd.createasyncreportresponse.v3+json",
          "Amazon-Advertising-API-ClientId": credentials.lwaClientId,
          "Amazon-Advertising-API-Scope": "123456789",
          Authorization: "Bearer memory-report-token",
        });
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          startDate: "2026-07-01",
          endDate: "2026-07-30",
          configuration: {
            adProduct: "SPONSORED_PRODUCTS",
            groupBy: ["advertiser"],
            columns: [...SP_ADVERTISED_PRODUCT_REPORT_COLUMNS],
            reportTypeId: "spAdvertisedProduct",
            timeUnit: "SUMMARY",
            format: "GZIP_JSON",
          },
        });
        return json(
          { reportId: "report-test-1" },
          202,
          { "content-type": "application/vnd.createasyncreportresponse.v3+json" },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(
      vault(),
      fetchMock,
      spContext,
      () => new Date("2026-08-21T00:00:00.000Z"),
    );

    await expect(client.createSponsoredProductsAdvertisedProductReport({
      marketplaceId: "ATVPDKIKX0DER",
      startDate: "2026-07-01",
      endDate: "2026-07-30",
    })).resolves.toEqual(reportReference());
    expect(await client.getCombinedAccountScope("ATVPDKIKX0DER"))
      .toBe(combinedAccountScope());
    expect(createCount).toBe(1);
  });

  it("fingerprints Seller Profile identity and detects a profile change on report status", async () => {
    let profileId = "111";
    let statusRequests = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId,
          countryCode: "US",
          accountInfo: {
            id: "seller-test",
            type: "seller",
            marketplaceStringId: "ATVPDKIKX0DER",
          },
        }]);
      }
      if (url.endsWith("/reporting/reports/report-test-1")) {
        statusRequests += 1;
        return json(reportStatusPayload());
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    const initial = await client.getCombinedAccountIdentity(
      "ATVPDKIKX0DER",
      undefined,
      { refreshProfile: true },
    );
    expect(initial.combinedAccountScope).toHaveLength(64);
    expect(initial.adsProfileFingerprint).toHaveLength(64);
    expect(JSON.stringify(initial)).not.toContain(profileId);

    profileId = "222";
    const changed = await client.getCombinedAccountIdentity(
      "ATVPDKIKX0DER",
      undefined,
      { refreshProfile: true },
    );
    expect(changed.adsProfileFingerprint).not.toBe(initial.adsProfileFingerprint);
    expect(changed.combinedAccountScope).not.toBe(initial.combinedAccountScope);
    expect(JSON.stringify(changed)).not.toContain(profileId);

    await expect(client.getSponsoredProductsAdvertisedProductReportStatus(reportReference({
      combinedAccountScope: initial.combinedAccountScope,
    }))).rejects.toMatchObject({ code: "ADS_REPORT_ACCOUNT_CHANGED", status: 409 });
    expect(statusRequests).toBe(0);
  });

  it("never retries a report create POST, including after a 401", async () => {
    let tokenCount = 0;
    let createCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCount += 1;
        return json({ access_token: `memory-token-${tokenCount}`, expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      if (url.endsWith("/reporting/reports")) {
        createCount += 1;
        return json({ private: "must-not-leak" }, 401);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(
      vault(),
      fetchMock,
      spContext,
      () => new Date("2026-08-21T00:00:00.000Z"),
    );

    await expect(client.createSponsoredProductsAdvertisedProductReport({
      marketplaceId: "ATVPDKIKX0DER",
      startDate: "2026-07-01",
      endDate: "2026-07-30",
    })).rejects.toMatchObject({ code: "ADS_AUTHORIZATION_FAILED", status: 401 });
    expect(createCount).toBe(1);
    expect(tokenCount).toBe(1);
  });

  it("rejects future, stale, malformed, and over-31-day report windows before network use", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new AdvertisingApiClient(
      vault(),
      fetchMock,
      spContext,
      () => new Date("2026-08-21T00:00:00.000Z"),
    );
    for (const [startDate, endDate] of [
      ["2026-07-01", "2026-08-01"],
      ["2026-08-20", "2026-08-21"],
      ["2026-05-16", "2026-05-17"],
      ["2026-02-30", "2026-03-01"],
    ]) {
      await expect(client.createSponsoredProductsAdvertisedProductReport({
        marketplaceId: "ATVPDKIKX0DER",
        startDate,
        endDate,
      })).rejects.toMatchObject({ code: "ADS_REPORT_DATE_INVALID" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls an exact report with only one 401 refresh and bounded 429/5xx retries", async () => {
    let tokenCount = 0;
    let statusCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCount += 1;
        return json({ access_token: `memory-status-token-${tokenCount}`, expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      if (url.endsWith("/reporting/reports/report-test-1")) {
        statusCount += 1;
        const headers = init?.headers as Record<string, string>;
        expect(headers["Amazon-Advertising-API-ClientId"]).toBe(credentials.lwaClientId);
        expect(headers["Amazon-Advertising-API-Scope"]).toBe("123456789");
        expect(headers.Authorization).toBe(
          `Bearer memory-status-token-${statusCount === 1 ? 1 : 2}`,
        );
        if (statusCount === 1) return json({ message: "expired" }, 401);
        if (statusCount === 2) return json({ message: "rate" }, 429, { "retry-after": "0" });
        if (statusCount === 3) return json({ message: "temporary" }, 503, { "retry-after": "0" });
        return json(reportStatusPayload(), 200, {
          "content-type": "application/vnd.getasyncreportresponse.v3+json",
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    await expect(client.getSponsoredProductsAdvertisedProductReportStatus(reportReference()))
      .resolves.toMatchObject({ status: "PENDING", ready: false });
    expect(tokenCount).toBe(2);
    expect(statusCount).toBe(4);
  });

  it("stops after the bounded status retry budget", async () => {
    let statusCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      statusCount += 1;
      return json({ message: "temporary" }, 503, { "retry-after": "0" });
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    await expect(client.getSponsoredProductsAdvertisedProductReportStatus(reportReference()))
      .rejects.toMatchObject({ code: "ADS_UPSTREAM_FAILED", status: 503 });
    expect(statusCount).toBe(3);
  });

  it("rejects an account or exact report configuration mismatch", async () => {
    let scope = "sp-scope-test";
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      return json(reportStatusPayload({ endDate: "2026-07-29" }));
    });
    const client = new AdvertisingApiClient(
      vault(),
      fetchMock,
      async () => ({ accountScope: scope, sellerId: "seller-test" }),
    );

    await expect(client.getSponsoredProductsAdvertisedProductReportStatus(reportReference()))
      .rejects.toMatchObject({ code: "ADS_REPORT_MISMATCH" });
    scope = "sp-scope-changed";
    await expect(client.getSponsoredProductsAdvertisedProductReportStatus(reportReference()))
      .rejects.toMatchObject({ code: "ADS_REPORT_ACCOUNT_CHANGED" });
  });

  it("downloads only an exact completed HTTPS AWS GZIP_JSON report and keeps optional metrics honest", async () => {
    const rawRows = [{
      campaignId: "campaign-1",
      campaignName: "SP exact",
      adGroupId: "ad-group-1",
      adGroupName: "Main",
      advertisedAsin: "B012345678",
      impressions: 120,
      clicks: 12,
      cost: 9.5,
    }, {
      campaignId: "campaign-2",
      advertisedSku: "SKU-2",
      advertisedAsin: "B087654321",
      impressions: 40,
      clicks: 5,
      cost: 3,
      sales14d: 18,
      purchases14d: 2,
    }];
    const compressed = gzipSync(Buffer.from(JSON.stringify(rawRows), "utf8"));
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      if (url.endsWith("/reporting/reports/report-test-1")) {
        return json(reportStatusPayload({
          status: "COMPLETED",
          url: "https://amz-report-test.s3.amazonaws.com/report.gz?signature=private",
        }));
      }
      if (url.startsWith("https://amz-report-test.s3.amazonaws.com/report.gz")) {
        expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
        expect(init?.headers).toBeUndefined();
        return new Response(compressed, {
          status: 200,
          headers: { "content-length": String(compressed.byteLength) },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    const report = await client.downloadSponsoredProductsAdvertisedProductReport(
      reportReference(),
    );
    expect(report.rows).toEqual([{
      campaignId: "campaign-1",
      campaignName: "SP exact",
      adGroupId: "ad-group-1",
      adGroupName: "Main",
      advertisedSku: null,
      advertisedAsin: "B012345678",
      impressions: 120,
      clicks: 12,
      cost: 9.5,
      sales14d: null,
      purchases14d: null,
    }, {
      campaignId: "campaign-2",
      campaignName: null,
      adGroupId: null,
      adGroupName: null,
      advertisedSku: "SKU-2",
      advertisedAsin: "B087654321",
      impressions: 40,
      clicks: 5,
      cost: 3,
      sales14d: 18,
      purchases14d: 2,
    }]);
    expect(JSON.stringify(report)).not.toContain("signature=private");
    expect(JSON.stringify(report)).not.toContain("123456789");
  });

  it("rejects non-AWS signed URLs and oversized compressed downloads", async () => {
    let oversized = false;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return json({ access_token: "memory-token", expires_in: 3600 });
      }
      if (url.includes("/v2/profiles")) {
        return json([{
          profileId: 123456789,
          countryCode: "US",
          accountInfo: { id: "seller-test", type: "seller", marketplaceStringId: "ATVPDKIKX0DER" },
        }]);
      }
      if (url.endsWith("/reporting/reports/report-test-1")) {
        return json(reportStatusPayload({
          status: "COMPLETED",
          url: oversized
            ? "https://amz-report-test.s3.amazonaws.com/report.gz"
            : "https://example.com/private-report.gz",
        }));
      }
      if (url.includes("s3.amazonaws.com")) {
        return new Response(new Uint8Array([1]), {
          headers: { "content-length": String(32 * 1024 * 1024 + 1) },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new AdvertisingApiClient(vault(), fetchMock, spContext);

    await expect(client.downloadSponsoredProductsAdvertisedProductReport(reportReference()))
      .rejects.toMatchObject({ code: "ADS_REPORT_URL_INVALID" });
    oversized = true;
    await expect(client.downloadSponsoredProductsAdvertisedProductReport(reportReference()))
      .rejects.toMatchObject({ code: "ADS_REPORT_TOO_LARGE", status: 413 });
  });

  it("fails closed for duplicate rows and malformed optional metrics", () => {
    const base = {
      campaignId: "campaign-1",
      advertisedAsin: "B012345678",
      impressions: 1,
      clicks: 1,
      cost: 1,
    };
    expect(() => parseSponsoredProductsAdvertisedProductRows([base, { ...base }]))
      .toThrow(expect.objectContaining({ code: "ADS_REPORT_DUPLICATE_ROW" }));
    expect(() => parseSponsoredProductsAdvertisedProductRows([{ ...base, sales14d: "12" }]))
      .toThrow(expect.objectContaining({ code: "ADS_REPORT_ROW_INVALID" }));
    expect(() => parseSponsoredProductsAdvertisedProductRows([{
      ...base,
      advertisedSku: "SKU\u200b-A",
    }])).toThrow(expect.objectContaining({ code: "ADS_REPORT_ROW_INVALID" }));
    expect(() => parseSponsoredProductsAdvertisedProductRows([{
      ...base,
      advertisedSku: " SKU-A",
    }])).toThrow(expect.objectContaining({ code: "ADS_REPORT_ROW_INVALID" }));
    expect(() => parseSponsoredProductsAdvertisedProductRows([{
      ...base,
      advertisedSku: "SKU\u00a0A",
    }])).toThrow(expect.objectContaining({ code: "ADS_REPORT_ROW_INVALID" }));
    expect(() => parseSponsoredProductsAdvertisedProductRows([{
      ...base,
      advertisedAsin: "B012345678 ",
    }])).toThrow(expect.objectContaining({ code: "ADS_REPORT_ROW_INVALID" }));
    expect(() => parseSponsoredProductsAdvertisedProductRows([{
      ...base,
      advertisedAsin: "B01234\u200b5678",
    }])).toThrow(expect.objectContaining({ code: "ADS_REPORT_ROW_INVALID" }));
    expect(parseSponsoredProductsAdvertisedProductRows([{
      ...base,
      campaignName: "  display campaign  ",
      adGroupName: "  display group  ",
    }])[0]).toMatchObject({
      campaignName: "display campaign",
      adGroupName: "display group",
    });
  });
});
