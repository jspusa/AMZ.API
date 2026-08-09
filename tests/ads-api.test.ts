import { describe, expect, it, vi } from "vitest";
import { AdvertisingApiClient } from "../src/main/amazon/ads-api";
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
});
