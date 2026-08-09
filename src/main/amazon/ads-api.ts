import type {
  AdvertisingApiRegion,
  AdvertisingConnectionTestResult,
  AdvertisingCredentialSummary,
} from "../../shared/contracts";
import type { AdvertisingCredentialVault } from "../advertising-credential-vault";
import type { AdvertisingCoverageCampaign } from "./advertising-coverage";
import type { MarketplaceId } from "./sp-api";

type MarketplaceAdsConfig = {
  code: string;
  countryCode: string;
  region: AdvertisingApiRegion;
};

const MARKETPLACES: Record<MarketplaceId, MarketplaceAdsConfig> = {
  ATVPDKIKX0DER: { code: "US", countryCode: "US", region: "na" },
  A2EUQ1WTGCTBG2: { code: "CA", countryCode: "CA", region: "na" },
  A1VC38T7YXB528: { code: "JP", countryCode: "JP", region: "fe" },
  A19VAU5U5O7RUS: { code: "SG", countryCode: "SG", region: "fe" },
  A39IBJ37TRP1C6: { code: "AU", countryCode: "AU", region: "fe" },
  A1F83G8C2ARO7P: { code: "GB", countryCode: "GB", region: "eu" },
  A1PA6795UKMFR9: { code: "DE", countryCode: "DE", region: "eu" },
};

const TOKEN_ENDPOINTS: Record<AdvertisingApiRegion, string> = {
  na: "https://api.amazon.com/auth/o2/token",
  eu: "https://api.amazon.co.uk/auth/o2/token",
  fe: "https://api.amazon.co.jp/auth/o2/token",
};

const API_ENDPOINTS: Record<AdvertisingApiRegion, string> = {
  na: "https://advertising-api.amazon.com",
  eu: "https://advertising-api-eu.amazon.com",
  fe: "https://advertising-api-fe.amazon.com",
};

const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_EARLY_REFRESH_MS = 60_000;
const PROFILE_CACHE_MS = 5 * 60_000;
const VERIFIED_CACHE_MS = 2 * 60_000;
const MAX_CAMPAIGNS = 20_000;
const CAMPAIGN_PAGE_SIZE = 100;

type TokenState = { value: string; expiresAt: number; accountScope: string };
type ProfileState = { profileId: string; expiresAt: number; accountScope: string };
type VerificationState = {
  result: AdvertisingConnectionTestResult;
  expiresAt: number;
  accountScope: string;
};
type SpAccountContext = { accountScope: string; sellerId: string };
type MarketplaceAccountContext = { cacheScope: string; sellerId: string | null };

type AdsProfile = {
  profileId?: unknown;
  countryCode?: unknown;
  accountInfo?: {
    id?: unknown;
    type?: unknown;
    marketplaceStringId?: unknown;
  };
};

type CampaignResponse = {
  campaigns?: unknown;
  nextToken?: unknown;
};

export class AdvertisingApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, input: { status?: number; code: string; requestId?: string | null }) {
    super(message);
    this.name = "AdvertisingApiError";
    this.status = input.status ?? 502;
    this.code = input.code;
    this.requestId = input.requestId ?? null;
  }
}

export type AdvertisingGateway = {
  getCredentialSummary(): Promise<AdvertisingCredentialSummary>;
  probeMarketplace(marketplaceId: MarketplaceId): Promise<AdvertisingConnectionTestResult>;
  listEnabledSponsoredProductCampaigns(
    marketplaceId: MarketplaceId,
  ): Promise<AdvertisingCoverageCampaign[]>;
  invalidate(): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeRequestId(response: Response, payload: unknown): string | null {
  const header = response.headers.get("x-amzn-requestid")?.trim() ?? "";
  if (header && header.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(header)) return header;
  if (!isRecord(payload)) return null;
  const candidate = payload.requestId;
  return typeof candidate === "string" && candidate.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(candidate)
    ? candidate
    : null;
}

async function responsePayload(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function upstreamError(operation: string, response: Response, payload: unknown): AdvertisingApiError {
  const requestId = safeRequestId(response, payload);
  const code = response.status === 401 || response.status === 403
    ? "ADS_AUTHORIZATION_FAILED"
    : response.status === 429
      ? "ADS_RATE_LIMITED"
      : "ADS_UPSTREAM_FAILED";
  return new AdvertisingApiError(
    response.status === 429
      ? "Amazon Ads 暫時限制查詢頻率，請稍後再試。"
      : `${operation}未通過 Amazon Ads 驗證。`,
    { status: response.status, code, requestId },
  );
}

function stringField(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(result)
    ? result
    : null;
}

function profileIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  const result = stringField(value, 128);
  return result && /^\d+$/u.test(result) ? result : null;
}

export class AdvertisingApiClient implements AdvertisingGateway {
  private token: TokenState | null = null;
  private tokenFlight: Promise<string> | null = null;
  private readonly profiles = new Map<MarketplaceId, ProfileState>();
  private readonly profileFlights = new Map<MarketplaceId, Promise<string>>();
  private readonly verifications = new Map<MarketplaceId, VerificationState>();
  private readonly verificationFlights = new Map<
    MarketplaceId,
    Promise<AdvertisingConnectionTestResult>
  >();

  constructor(
    private readonly vault: AdvertisingCredentialVault,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly spAccountForRegion?: (
      region: AdvertisingApiRegion,
    ) => Promise<SpAccountContext>,
  ) {}

  getCredentialSummary(): Promise<AdvertisingCredentialSummary> {
    return this.vault.getSummary();
  }

  invalidate(): void {
    this.token = null;
    this.tokenFlight = null;
    this.profiles.clear();
    this.profileFlights.clear();
    this.verifications.clear();
    this.verificationFlights.clear();
  }

  async probeMarketplace(marketplaceId: MarketplaceId): Promise<AdvertisingConnectionTestResult> {
    const accountScope = (await this.marketplaceAccountContext(marketplaceId)).cacheScope;
    const cached = this.verifications.get(marketplaceId);
    if (cached && cached.accountScope === accountScope && cached.expiresAt > Date.now()) {
      return structuredClone(cached.result);
    }
    const existing = this.verificationFlights.get(marketplaceId);
    if (existing) return structuredClone(await existing);
    const flight = this.runProbeMarketplace(marketplaceId, accountScope).finally(() => {
      if (this.verificationFlights.get(marketplaceId) === flight) {
        this.verificationFlights.delete(marketplaceId);
      }
    });
    this.verificationFlights.set(marketplaceId, flight);
    return structuredClone(await flight);
  }

  private async runProbeMarketplace(
    marketplaceId: MarketplaceId,
    accountScope: string,
  ): Promise<AdvertisingConnectionTestResult> {
    const config = MARKETPLACES[marketplaceId];
    const testedAt = new Date().toISOString();
    try {
      const profileId = await this.getProfileId(marketplaceId);
      await this.queryCampaignPage(marketplaceId, profileId, 1);
      if ((await this.marketplaceAccountContext(marketplaceId)).cacheScope !== accountScope) {
        throw new AdvertisingApiError("SP-API 帳號在 Ads 驗證期間已改變。", {
          status: 409,
          code: "ADS_SP_ACCOUNT_CHANGED",
        });
      }
      const result: AdvertisingConnectionTestResult = {
        ok: true,
        testedAt,
        marketplaceId,
        marketplaceCode: config.code,
        accountType: "seller",
        message: `Amazon Ads ${config.code} 唯讀連線成功。`,
        requestId: null,
      };
      this.verifications.set(marketplaceId, {
        result,
        accountScope,
        expiresAt: Date.now() + VERIFIED_CACHE_MS,
      });
      return result;
    } catch (error) {
      if (error instanceof AdvertisingApiError) {
        return {
          ok: false,
          testedAt,
          marketplaceId,
          marketplaceCode: config.code,
          accountType: null,
          message: error.message,
          requestId: error.requestId,
        };
      }
      throw error;
    }
  }

  async listEnabledSponsoredProductCampaigns(
    marketplaceId: MarketplaceId,
  ): Promise<AdvertisingCoverageCampaign[]> {
    const startingScope = (await this.marketplaceAccountContext(marketplaceId)).cacheScope;
    const profileId = await this.getProfileId(marketplaceId);
    const campaigns: AdvertisingCoverageCampaign[] = [];
    const seenIds = new Set<string>();
    const seenPageTokens = new Set<string>();
    let pageCount = 0;
    let nextToken: string | undefined;
    do {
      if ((await this.marketplaceAccountContext(marketplaceId)).cacheScope !== startingScope) {
        throw new AdvertisingApiError("SP-API 帳號在 Ads 健檢期間已改變。", {
          status: 409,
          code: "ADS_SP_ACCOUNT_CHANGED",
        });
      }
      if (nextToken && seenPageTokens.has(nextToken)) {
        throw new AdvertisingApiError("Amazon Ads 活動分頁記號重複，已停止健檢。", {
          status: 409,
          code: "ADS_PAGINATION_CONFLICT",
        });
      }
      if (nextToken) seenPageTokens.add(nextToken);
      pageCount += 1;
      if (pageCount > Math.ceil(MAX_CAMPAIGNS / CAMPAIGN_PAGE_SIZE)) {
        throw new AdvertisingApiError("Amazon Ads 活動分頁超過本機安全上限。", {
          status: 422,
          code: "ADS_CAMPAIGN_LIMIT",
        });
      }
      const page = await this.queryCampaignPage(
        marketplaceId,
        profileId,
        CAMPAIGN_PAGE_SIZE,
        nextToken,
      );
      for (const campaign of page.campaigns) {
        if (seenIds.has(campaign.campaignId)) {
          throw new AdvertisingApiError("Amazon Ads 活動分頁回應重複，已停止健檢。", {
            status: 409,
            code: "ADS_PAGINATION_CONFLICT",
          });
        }
        seenIds.add(campaign.campaignId);
        campaigns.push(campaign);
        if (campaigns.length > MAX_CAMPAIGNS) {
          throw new AdvertisingApiError("Amazon Ads 活動超過本機安全上限。", {
            status: 422,
            code: "ADS_CAMPAIGN_LIMIT",
          });
        }
      }
      nextToken = page.nextToken;
    } while (nextToken);
    if ((await this.marketplaceAccountContext(marketplaceId)).cacheScope !== startingScope) {
      throw new AdvertisingApiError("SP-API 帳號在 Ads 健檢期間已改變。", {
        status: 409,
        code: "ADS_SP_ACCOUNT_CHANGED",
      });
    }
    return campaigns;
  }

  private async marketplaceAccountContext(
    marketplaceId: MarketplaceId,
  ): Promise<MarketplaceAccountContext> {
    const adsScope = await this.vault.getAccountScope();
    if (!this.spAccountForRegion) {
      throw new AdvertisingApiError("SP-API Seller 帳號尚未完整設定，無法安全核對 Ads Profile。", {
        status: 422,
        code: "ADS_SELLER_CONTEXT_MISSING",
      });
    }
    const sp = await this.spAccountForRegion(MARKETPLACES[marketplaceId].region);
    const sellerId = sp.sellerId.trim();
    if (!sp.accountScope || !sellerId) {
      throw new AdvertisingApiError("SP-API Seller 帳號尚未完整設定，無法安全核對 Ads Profile。", {
        status: 422,
        code: "ADS_SELLER_CONTEXT_MISSING",
      });
    }
    return { cacheScope: `${adsScope}:${sp.accountScope}`, sellerId };
  }

  private async getAccessToken(force = false): Promise<string> {
    const accountScope = await this.vault.getAccountScope();
    const now = Date.now();
    if (!force && this.token && this.token.accountScope === accountScope && this.token.expiresAt > now) {
      return this.token.value;
    }
    if (this.tokenFlight) return this.tokenFlight;
    const flight = this.refreshAccessToken(accountScope).finally(() => {
      if (this.tokenFlight === flight) this.tokenFlight = null;
    });
    this.tokenFlight = flight;
    return flight;
  }

  private async refreshAccessToken(accountScope: string): Promise<string> {
    const credentials = await this.vault.load();
    if (!credentials.lwaClientId || !credentials.lwaClientSecret || !credentials.refreshToken) {
      throw new AdvertisingApiError("Amazon Ads 憑證尚未完整設定。", {
        status: 422,
        code: "ADS_NOT_CONFIGURED",
      });
    }
    const endpoint = TOKEN_ENDPOINTS[credentials.oauthRegion];
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: credentials.lwaClientId,
      client_secret: credentials.lwaClientSecret,
      refresh_token: credentials.refreshToken,
    });
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw upstreamError("LWA token", response, payload);
    if (!isRecord(payload)) {
      throw new AdvertisingApiError("Amazon Ads LWA token 回應格式無效。", {
        code: "ADS_TOKEN_INVALID",
      });
    }
    const token = stringField(payload.access_token, 8_192);
    const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? Math.floor(payload.expires_in)
      : 3_600;
    if (!token || expiresIn <= 0) {
      throw new AdvertisingApiError("Amazon Ads LWA token 回應不完整。", {
        code: "ADS_TOKEN_INVALID",
      });
    }
    this.token = {
      value: token,
      accountScope,
      expiresAt: Date.now() + Math.min(expiresIn, 3_600) * 1_000 - TOKEN_EARLY_REFRESH_MS,
    };
    return token;
  }

  private async getProfileId(marketplaceId: MarketplaceId): Promise<string> {
    const context = await this.marketplaceAccountContext(marketplaceId);
    const accountScope = context.cacheScope;
    const cached = this.profiles.get(marketplaceId);
    if (cached && cached.accountScope === accountScope && cached.expiresAt > Date.now()) {
      return cached.profileId;
    }
    const existing = this.profileFlights.get(marketplaceId);
    if (existing) return existing;
    const flight = this.discoverProfile(
      marketplaceId,
      accountScope,
      context.sellerId,
    ).finally(() => {
      if (this.profileFlights.get(marketplaceId) === flight) this.profileFlights.delete(marketplaceId);
    });
    this.profileFlights.set(marketplaceId, flight);
    return flight;
  }

  private async discoverProfile(
    marketplaceId: MarketplaceId,
    accountScope: string,
    expectedSellerId: string | null,
  ): Promise<string> {
    const config = MARKETPLACES[marketplaceId];
    const credentials = await this.vault.load();
    if (credentials.oauthRegion !== config.region) {
      throw new AdvertisingApiError(
        `Ads LWA 區域是 ${credentials.oauthRegion.toUpperCase()}，無法用於 ${config.code}。`,
        { status: 422, code: "ADS_REGION_MISMATCH" },
      );
    }
    const endpoint = new URL("/v2/profiles", API_ENDPOINTS[config.region]);
    endpoint.searchParams.set("apiProgram", "campaign");
    endpoint.searchParams.set("accessLevel", "view");
    endpoint.searchParams.set("profileTypeFilter", "seller");
    const { response, payload } = await this.authorizedRequest(endpoint.toString(), {
      method: "GET",
      headers: { "Amazon-Advertising-API-ClientId": credentials.lwaClientId },
    });
    if (!response.ok) throw upstreamError("Profiles", response, payload);
    if (!Array.isArray(payload)) {
      throw new AdvertisingApiError("Amazon Ads Profiles 回應格式無效。", {
        code: "ADS_PROFILES_INVALID",
      });
    }
    const matches = (payload as AdsProfile[]).filter((profile) =>
      profile.accountInfo?.type === "seller" &&
      profile.accountInfo.marketplaceStringId === marketplaceId &&
      (!expectedSellerId || profile.accountInfo.id === expectedSellerId) &&
      (profile.countryCode === undefined || profile.countryCode === config.countryCode),
    );
    if (matches.length !== 1) {
      throw new AdvertisingApiError(
        matches.length ? "Amazon Ads 回傳多個同站點 Seller Profile，已停止以避免混用。" : "Amazon Ads 找不到這個站點的 Seller Profile。",
        { status: 422, code: matches.length ? "ADS_PROFILE_AMBIGUOUS" : "ADS_PROFILE_NOT_FOUND" },
      );
    }
    const profileId = profileIdentifier(matches[0]?.profileId);
    if (!profileId) {
      throw new AdvertisingApiError("Amazon Ads Seller Profile 資料不完整。", {
        code: "ADS_PROFILE_INVALID",
      });
    }
    if ((await this.marketplaceAccountContext(marketplaceId)).cacheScope !== accountScope) {
      throw new AdvertisingApiError("SP-API 帳號在 Ads Profile 發現期間已改變。", {
        status: 409,
        code: "ADS_SP_ACCOUNT_CHANGED",
      });
    }
    this.profiles.set(marketplaceId, {
      profileId,
      accountScope,
      expiresAt: Date.now() + PROFILE_CACHE_MS,
    });
    return profileId;
  }

  private async authorizedRequest(
    url: string,
    init: RequestInit,
  ): Promise<{ response: Response; payload: unknown }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getAccessToken(attempt === 1);
      const response = await this.fetchImpl(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await responsePayload(response);
      if (response.status !== 401 || attempt === 1) return { response, payload };
      this.token = null;
    }
    throw new AdvertisingApiError("Amazon Ads 授權失敗。", {
      status: 401,
      code: "ADS_AUTHORIZATION_FAILED",
    });
  }

  private async queryCampaignPage(
    marketplaceId: MarketplaceId,
    profileId: string,
    maxResults: number,
    nextToken?: string,
  ): Promise<{ campaigns: AdvertisingCoverageCampaign[]; nextToken?: string }> {
    const config = MARKETPLACES[marketplaceId];
    const credentials = await this.vault.load();
    const body: Record<string, unknown> = {
      adProductFilter: { include: ["SPONSORED_PRODUCTS"] },
      stateFilter: { include: ["ENABLED"] },
      maxResults,
    };
    if (nextToken) body.nextToken = nextToken;
    const { response, payload } = await this.authorizedRequest(
      `${API_ENDPOINTS[config.region]}/adsApi/v1/query/campaigns`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Amazon-Ads-ClientId": credentials.lwaClientId,
          "Amazon-Advertising-API-Scope": profileId,
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw upstreamError("Campaign query", response, payload);
    if (!isRecord(payload) || !Array.isArray((payload as CampaignResponse).campaigns)) {
      throw new AdvertisingApiError("Amazon Ads Campaign 回應格式無效。", {
        code: "ADS_CAMPAIGNS_INVALID",
      });
    }
    const campaigns = (payload as CampaignResponse).campaigns as unknown[];
    const result: AdvertisingCoverageCampaign[] = campaigns.map((item) => {
      if (!isRecord(item)) {
        throw new AdvertisingApiError("Amazon Ads Campaign 資料不完整。", {
          code: "ADS_CAMPAIGNS_INVALID",
        });
      }
      const campaignId = stringField(item.campaignId, 128);
      const name = stringField(item.name, 512);
      if (!campaignId || !name || item.state !== "ENABLED") {
        throw new AdvertisingApiError("Amazon Ads Campaign 資料不完整。", {
          code: "ADS_CAMPAIGNS_INVALID",
        });
      }
      return { campaignId, name, state: "ENABLED", adProduct: "SPONSORED_PRODUCTS" };
    });
    const parsedNext = (payload as CampaignResponse).nextToken;
    const safeNext = parsedNext === undefined || parsedNext === null
      ? undefined
      : stringField(parsedNext, 4_096);
    if (parsedNext !== undefined && parsedNext !== null && !safeNext) {
      throw new AdvertisingApiError("Amazon Ads Campaign 分頁記號無效。", {
        code: "ADS_CAMPAIGNS_INVALID",
      });
    }
    return { campaigns: result, nextToken: safeNext ?? undefined };
  }
}
