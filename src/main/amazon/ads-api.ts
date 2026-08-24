import { createHash } from "node:crypto";
import type {
  AdvertisingApiRegion,
  AdvertisingConnectionTestResult,
  AdvertisingCredentialSummary,
} from "../../shared/contracts";
import {
  MARKETPLACES as MARKETPLACE_METADATA,
  type MarketplaceCode,
  type MarketplaceId,
} from "../../shared/marketplaces";
import type { AdvertisingCredentialVault } from "../advertising-credential-vault";
import { abortableDelay, forwardAbort, throwIfAborted } from "../abort-utils";
import type { AdvertisingCoverageCampaign } from "./advertising-coverage";
import { marketplaceCalendar } from "./marketplace-calendar";

type MarketplaceAdsConfig = {
  code: string;
  countryCode: string;
  region: AdvertisingApiRegion;
};

const ADS_COUNTRY_CODE_OVERRIDES: Partial<Record<MarketplaceCode, string>> = {
  UK: "GB",
};

const MARKETPLACES = Object.fromEntries(
  MARKETPLACE_METADATA.map((marketplace) => {
    const countryCode =
      ADS_COUNTRY_CODE_OVERRIDES[marketplace.code] ?? marketplace.code;
    return [
      marketplace.id,
      {
        code: countryCode,
        countryCode,
        region: marketplace.region,
      },
    ];
  }),
) as Record<MarketplaceId, MarketplaceAdsConfig>;

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
const REPORT_STATUS_TRANSIENT_RETRIES = 2;
const MAX_REPORT_STATUS_RETRY_DELAY_MS = 5_000;
const MAX_REPORT_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_REPORT_DECOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_ADVERTISED_PRODUCT_ROWS = 50_000;
const MAX_ADS_REPORT_RANGE_DAYS = 31;
const MAX_ADS_REPORT_HISTORY_DAYS = 95;

export const SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID =
  "spAdvertisedProduct-summary-v1";

export const SP_ADVERTISED_PRODUCT_REPORT_COLUMNS = [
  "campaignId",
  "campaignName",
  "adGroupId",
  "adGroupName",
  "advertisedSku",
  "advertisedAsin",
  "impressions",
  "clicks",
  "cost",
  "sales14d",
  "purchases14d",
] as const;

type TokenState = { value: string; expiresAt: number; accountScope: string };
type ProfileState = { profileId: string; expiresAt: number; accountScope: string };
type VerificationState = {
  result: AdvertisingConnectionTestResult;
  expiresAt: number;
  accountScope: string;
};
type SpAccountContext = { accountScope: string; sellerId: string };
type MarketplaceAccountContext = { cacheScope: string; sellerId: string | null };
type InternalCombinedAccountIdentity = AdvertisingCombinedAccountIdentity & {
  profileId: string;
};

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

type ReportingRequestPolicy = {
  retryUnauthorized?: boolean;
  transientRetries?: number;
};

type InternalSponsoredProductsReportStatus = {
  status: SponsoredProductsAdvertisedProductReportStatus["status"];
  updatedAt: string | null;
  reportUrl: URL | null;
};

export type SponsoredProductsAdvertisedProductReportReference = Readonly<{
  reportId: string;
  marketplaceId: MarketplaceId;
  combinedAccountScope: string;
  startDate: string;
  endDate: string;
  configurationId: typeof SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID;
}>;

export type AdvertisingCombinedAccountIdentity = Readonly<{
  combinedAccountScope: string;
  adsProfileFingerprint: string;
}>;

export type AdvertisingCombinedAccountIdentityOptions = Readonly<{
  refreshProfile?: boolean;
}>;

export type SponsoredProductsAdvertisedProductReportStatus = Readonly<{
  reference: SponsoredProductsAdvertisedProductReportReference;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILURE";
  ready: boolean;
  updatedAt: string | null;
}>;

export type SponsoredProductsAdvertisedProductRow = Readonly<{
  campaignId: string;
  campaignName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  advertisedSku: string | null;
  advertisedAsin: string;
  impressions: number;
  clicks: number;
  cost: number;
  sales14d: number | null;
  purchases14d: number | null;
}>;

export type SponsoredProductsAdvertisedProductReport = Readonly<{
  reference: SponsoredProductsAdvertisedProductReportReference;
  rows: readonly SponsoredProductsAdvertisedProductRow[];
}>;

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
  getCombinedAccountScope?(marketplaceId: MarketplaceId): Promise<string>;
  getCombinedAccountIdentity?(
    marketplaceId: MarketplaceId,
    signal?: AbortSignal,
    options?: AdvertisingCombinedAccountIdentityOptions,
  ): Promise<AdvertisingCombinedAccountIdentity>;
  probeMarketplace(marketplaceId: MarketplaceId): Promise<AdvertisingConnectionTestResult>;
  listEnabledSponsoredProductCampaigns(
    marketplaceId: MarketplaceId,
    signal?: AbortSignal,
  ): Promise<AdvertisingCoverageCampaign[]>;
  createSponsoredProductsAdvertisedProductReport?(input: {
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    signal?: AbortSignal;
  }): Promise<SponsoredProductsAdvertisedProductReportReference>;
  getSponsoredProductsAdvertisedProductReportStatus?(
    reference: SponsoredProductsAdvertisedProductReportReference,
    signal?: AbortSignal,
  ): Promise<SponsoredProductsAdvertisedProductReportStatus>;
  downloadSponsoredProductsAdvertisedProductReport?(
    reference: SponsoredProductsAdvertisedProductReportReference,
    signal?: AbortSignal,
  ): Promise<SponsoredProductsAdvertisedProductReport>;
  invalidate(): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const assertNotAborted = throwIfAborted;

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
  const type = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? "";
  if (type !== "application/json" && !type.endsWith("+json")) return null;
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
  return result && result.length <= maximum &&
    !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(result)
    ? result
    : null;
}

function fixedIdentityFingerprint(namespace: string, values: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(namespace);
  for (const value of values) {
    hash.update("\0");
    hash.update(value);
  }
  return hash.digest("hex");
}

function adsProfileFingerprint(marketplaceId: MarketplaceId, profileId: string): string {
  return fixedIdentityFingerprint("amz-api:amazon-ads-profile:v1", [
    marketplaceId,
    profileId,
  ]);
}

function combinedAccountScopeFingerprint(
  accountScope: string,
  profileFingerprint: string,
): string {
  return fixedIdentityFingerprint("amz-api:amazon-ads-combined-account:v1", [
    accountScope,
    profileFingerprint,
  ]);
}

function exactOptionalIdentityText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\p{Cc}\p{Cf}\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(value)
  ) {
    throw new AdvertisingApiError("Amazon Ads 報表列資料無效。", {
      code: "ADS_REPORT_ROW_INVALID",
    });
  }
  return value;
}

function exactRequiredIdentityText(value: unknown, maximum: number): string | null {
  return exactOptionalIdentityText(value, maximum);
}

function profileIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > 128 ||
    !/^\d+$/u.test(value)
  ) {
    return null;
  }
  return value;
}

function reportIdentifier(value: unknown): string | null {
  const result = stringField(value, 128);
  return result && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result) ? result : null;
}

function assertReportDateRange(input: {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  now?: Date;
  enforceCurrentWindow: boolean;
}): void {
  const calendar = marketplaceCalendar(input.marketplaceId);
  if (
    !calendar.isDateKey(input.startDate) ||
    !calendar.isDateKey(input.endDate) ||
    input.startDate > input.endDate
  ) {
    throw new AdvertisingApiError("Amazon Ads 報表日期範圍無效。", {
      status: 400,
      code: "ADS_REPORT_DATE_INVALID",
    });
  }
  const inclusiveDays = calendar.inclusiveDayCount(
    input.startDate,
    input.endDate,
  );
  if (inclusiveDays > MAX_ADS_REPORT_RANGE_DAYS) {
    throw new AdvertisingApiError("Amazon Ads 報表一次最多讀取 31 個完整日。", {
      status: 400,
      code: "ADS_REPORT_DATE_INVALID",
    });
  }
  if (!input.enforceCurrentWindow) return;
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new AdvertisingApiError("Amazon Ads 站點日期無法核對。", {
      status: 500,
      code: "ADS_REPORT_DATE_INVALID",
    });
  }
  const latest = calendar.shiftDate(calendar.dayAt(now), -1);
  const earliest = calendar.shiftDate(
    latest,
    -(MAX_ADS_REPORT_HISTORY_DAYS - 1),
  );
  if (input.endDate > latest || input.startDate < earliest) {
    throw new AdvertisingApiError("Amazon Ads 報表只能讀取最近 95 天內的完整日。", {
      status: 400,
      code: "ADS_REPORT_DATE_INVALID",
    });
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after")?.trim() ?? "";
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.round(seconds * 1_000), MAX_REPORT_STATUS_RETRY_DELAY_MS);
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(0, Math.min(retryAt - Date.now(), MAX_REPORT_STATUS_RETRY_DELAY_MS));
    }
  }
  return Math.min(250 * (2 ** attempt), MAX_REPORT_STATUS_RETRY_DELAY_MS);
}

function exactStringArray(value: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const actual = value.map((item) => typeof item === "string" ? item : "");
  return actual.every(Boolean) && [...actual].sort().join("\0") === [...expected].sort().join("\0");
}

function safeReportUrl(value: unknown): URL | null {
  const raw = stringField(value, 8_192);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const allowedAwsHost =
    url.hostname === "amazonaws.com" ||
    url.hostname.endsWith(".amazonaws.com") ||
    url.hostname.endsWith(".amazonaws.com.cn") ||
    url.hostname.endsWith(".cloudfront.net");
  return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      allowedAwsHost
    ? url
    : null;
}

async function readResponseWithLimit(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new AdvertisingApiError("Amazon Ads 報表超過本機安全大小上限。", {
      status: 413,
      code: "ADS_REPORT_TOO_LARGE",
    });
  }
  if (!response.body) {
    throw new AdvertisingApiError("Amazon Ads 報表文件內容為空。", {
      code: "ADS_REPORT_DOWNLOAD_FAILED",
    });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new AdvertisingApiError("Amazon Ads 報表超過本機安全大小上限。", {
        status: 413,
        code: "ADS_REPORT_TOO_LARGE",
      });
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new AdvertisingApiError("Amazon Ads 報表列資料無效。", {
      code: "ADS_REPORT_ROW_INVALID",
    });
  }
  const result = value.trim();
  if (!result) return null;
  if (
    result.length > maximum ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(result)
  ) {
    throw new AdvertisingApiError("Amazon Ads 報表列資料無效。", {
      code: "ADS_REPORT_ROW_INVALID",
    });
  }
  return result;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AdvertisingApiError(`Amazon Ads 報表的 ${label} 無效。`, {
      code: "ADS_REPORT_ROW_INVALID",
    });
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, label: string): number | null {
  return value === undefined || value === null ? null : nonNegativeNumber(value, label);
}

function optionalNonNegativeInteger(value: unknown, label: string): number | null {
  const result = optionalNonNegativeNumber(value, label);
  if (result !== null && !Number.isSafeInteger(result)) {
    throw new AdvertisingApiError(`Amazon Ads 報表的 ${label} 無效。`, {
      code: "ADS_REPORT_ROW_INVALID",
    });
  }
  return result;
}

export function parseSponsoredProductsAdvertisedProductRows(
  value: unknown,
): SponsoredProductsAdvertisedProductRow[] {
  if (!Array.isArray(value) || value.length > MAX_ADVERTISED_PRODUCT_ROWS) {
    throw new AdvertisingApiError("Amazon Ads 報表列數或格式無效。", {
      status: Array.isArray(value) ? 413 : 502,
      code: Array.isArray(value) ? "ADS_REPORT_TOO_LARGE" : "ADS_REPORT_INVALID",
    });
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new AdvertisingApiError("Amazon Ads 報表列資料無效。", {
        code: "ADS_REPORT_ROW_INVALID",
      });
    }
    const campaignId = reportIdentifier(item.campaignId);
    const advertisedSku = exactOptionalIdentityText(item.advertisedSku, 256);
    const advertisedAsin = exactRequiredIdentityText(item.advertisedAsin, 32);
    if (!campaignId || !advertisedAsin || !/^[A-Z0-9]{10}$/u.test(advertisedAsin)) {
      throw new AdvertisingApiError("Amazon Ads 報表列缺少可核對的 Campaign 或 ASIN。", {
        code: "ADS_REPORT_ROW_INVALID",
      });
    }
    const adGroupId = optionalText(item.adGroupId, 128);
    const key = [campaignId, adGroupId ?? "", advertisedSku, advertisedAsin].join("\0");
    if (seen.has(key)) {
      throw new AdvertisingApiError("Amazon Ads 報表出現重複的商品列。", {
        status: 409,
        code: "ADS_REPORT_DUPLICATE_ROW",
      });
    }
    seen.add(key);
    return {
      campaignId,
      campaignName: optionalText(item.campaignName, 512),
      adGroupId,
      adGroupName: optionalText(item.adGroupName, 512),
      advertisedSku,
      advertisedAsin,
      impressions: nonNegativeNumber(item.impressions, "impressions"),
      clicks: nonNegativeNumber(item.clicks, "clicks"),
      cost: nonNegativeNumber(item.cost, "cost"),
      sales14d: optionalNonNegativeNumber(item.sales14d, "sales14d"),
      purchases14d: optionalNonNegativeInteger(item.purchases14d, "purchases14d"),
    };
  });
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
  private lifecycleController = new AbortController();

  constructor(
    private readonly vault: AdvertisingCredentialVault,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly spAccountForRegion?: (
      region: AdvertisingApiRegion,
    ) => Promise<SpAccountContext>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getCredentialSummary(): Promise<AdvertisingCredentialSummary> {
    return this.vault.getSummary();
  }

  async getCombinedAccountScope(marketplaceId: MarketplaceId): Promise<string> {
    return (await this.getCombinedAccountIdentity(marketplaceId)).combinedAccountScope;
  }

  async getCombinedAccountIdentity(
    marketplaceId: MarketplaceId,
    signal?: AbortSignal,
    options: AdvertisingCombinedAccountIdentityOptions = {},
  ): Promise<AdvertisingCombinedAccountIdentity> {
    const identity = await this.resolveCombinedAccountIdentity(
      marketplaceId,
      signal,
      options.refreshProfile === true,
    );
    return {
      combinedAccountScope: identity.combinedAccountScope,
      adsProfileFingerprint: identity.adsProfileFingerprint,
    };
  }

  invalidate(): void {
    this.lifecycleController.abort();
    this.lifecycleController = new AbortController();
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
    const lifecycleSignal = this.lifecycleController.signal;
    const flight = this.runProbeMarketplace(
      marketplaceId,
      accountScope,
      lifecycleSignal,
    ).finally(() => {
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
    signal?: AbortSignal,
  ): Promise<AdvertisingConnectionTestResult> {
    assertNotAborted(signal);
    const config = MARKETPLACES[marketplaceId];
    const testedAt = new Date().toISOString();
    try {
      const profileId = await this.getProfileId(marketplaceId, signal);
      await this.queryCampaignPage(marketplaceId, profileId, 1, undefined, signal);
      assertNotAborted(signal);
      if ((await this.marketplaceAccountContext(marketplaceId)).cacheScope !== accountScope) {
        throw new AdvertisingApiError("SP-API 帳號在 Ads 驗證期間已改變。", {
          status: 409,
          code: "ADS_SP_ACCOUNT_CHANGED",
        });
      }
      assertNotAborted(signal);
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
    signal?: AbortSignal,
  ): Promise<AdvertisingCoverageCampaign[]> {
    assertNotAborted(signal);
    const startingScope = (await this.marketplaceAccountContext(marketplaceId)).cacheScope;
    assertNotAborted(signal);
    const profileId = await this.getProfileId(marketplaceId, signal);
    assertNotAborted(signal);
    const campaigns: AdvertisingCoverageCampaign[] = [];
    const seenIds = new Set<string>();
    const seenPageTokens = new Set<string>();
    let pageCount = 0;
    let nextToken: string | undefined;
    do {
      assertNotAborted(signal);
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
        signal,
      );
      assertNotAborted(signal);
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
    assertNotAborted(signal);
    if ((await this.marketplaceAccountContext(marketplaceId)).cacheScope !== startingScope) {
      throw new AdvertisingApiError("SP-API 帳號在 Ads 健檢期間已改變。", {
        status: 409,
        code: "ADS_SP_ACCOUNT_CHANGED",
      });
    }
    return campaigns;
  }

  async createSponsoredProductsAdvertisedProductReport(input: {
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    signal?: AbortSignal;
  }): Promise<SponsoredProductsAdvertisedProductReportReference> {
    assertReportDateRange({
      marketplaceId: input.marketplaceId,
      startDate: input.startDate,
      endDate: input.endDate,
      now: this.now(),
      enforceCurrentWindow: true,
    });
    assertNotAborted(input.signal);
    const identity = await this.resolveCombinedAccountIdentity(
      input.marketplaceId,
      input.signal,
      false,
    );
    const accountScope = identity.combinedAccountScope;
    const profileId = identity.profileId;
    const config = MARKETPLACES[input.marketplaceId];
    const credentials = await this.vault.load();
    assertNotAborted(input.signal);
    const { response, payload } = await this.authorizedRequest(
      `${API_ENDPOINTS[config.region]}/reporting/reports`,
      {
        method: "POST",
        headers: {
          "content-type": "application/vnd.createasyncreportrequest.v3+json",
          accept: "application/vnd.createasyncreportresponse.v3+json",
          "Amazon-Advertising-API-ClientId": credentials.lwaClientId,
          "Amazon-Advertising-API-Scope": profileId,
        },
        body: JSON.stringify({
          name: `AMZ.API SP advertised product ${input.startDate} ${input.endDate} v1`,
          startDate: input.startDate,
          endDate: input.endDate,
          configuration: {
            adProduct: "SPONSORED_PRODUCTS",
            groupBy: ["advertiser"],
            columns: [...SP_ADVERTISED_PRODUCT_REPORT_COLUMNS],
            reportTypeId: "spAdvertisedProduct",
            timeUnit: "SUMMARY",
            format: "GZIP_JSON",
          },
        }),
      },
      input.signal,
      { retryUnauthorized: false },
    );
    if (!response.ok) throw upstreamError("Advertised product report create", response, payload);
    if (!isRecord(payload)) {
      throw new AdvertisingApiError("Amazon Ads 沒有回傳可核對的報表編號。", {
        code: "ADS_REPORT_CREATE_INVALID",
      });
    }
    const reportId = reportIdentifier(payload.reportId);
    if (!reportId) {
      throw new AdvertisingApiError("Amazon Ads 沒有回傳可核對的報表編號。", {
        code: "ADS_REPORT_CREATE_INVALID",
      });
    }
    await this.assertCombinedAccountScope(input.marketplaceId, accountScope, input.signal);
    return {
      reportId,
      marketplaceId: input.marketplaceId,
      combinedAccountScope: accountScope,
      startDate: input.startDate,
      endDate: input.endDate,
      configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
    };
  }

  async getSponsoredProductsAdvertisedProductReportStatus(
    reference: SponsoredProductsAdvertisedProductReportReference,
    signal?: AbortSignal,
  ): Promise<SponsoredProductsAdvertisedProductReportStatus> {
    const status = await this.loadSponsoredProductsAdvertisedProductReportStatus(
      reference,
      signal,
    );
    return {
      reference: structuredClone(reference),
      status: status.status,
      ready: status.status === "COMPLETED",
      updatedAt: status.updatedAt,
    };
  }

  async downloadSponsoredProductsAdvertisedProductReport(
    reference: SponsoredProductsAdvertisedProductReportReference,
    signal?: AbortSignal,
  ): Promise<SponsoredProductsAdvertisedProductReport> {
    const status = await this.loadSponsoredProductsAdvertisedProductReportStatus(
      reference,
      signal,
    );
    if (status.status !== "COMPLETED" || !status.reportUrl) {
      throw new AdvertisingApiError("Amazon Ads 報表尚未完成。", {
        status: 409,
        code: "ADS_REPORT_NOT_READY",
      });
    }
    assertNotAborted(signal);
    const lifecycleSignal = this.lifecycleController.signal;
    const controller = new AbortController();
    const stopLifecycleAbort = forwardAbort(controller, lifecycleSignal);
    const stopCallerAbort = forwardAbort(controller, signal);
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await this.fetchImpl(status.reportUrl, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      assertNotAborted(lifecycleSignal);
      assertNotAborted(signal);
      if (!response.ok) {
        throw new AdvertisingApiError("Amazon Ads 報表文件暫時無法下載。", {
          status: response.status || 502,
          code: "ADS_REPORT_DOWNLOAD_FAILED",
        });
      }
      const compressed = await readResponseWithLimit(response, MAX_REPORT_COMPRESSED_BYTES);
      assertNotAborted(lifecycleSignal);
      assertNotAborted(signal);
      if (typeof DecompressionStream === "undefined") {
        throw new AdvertisingApiError("目前執行環境無法解壓 Amazon Ads 報表。", {
          status: 500,
          code: "ADS_REPORT_DOWNLOAD_FAILED",
        });
      }
      const stream = new Response(Uint8Array.from(compressed).buffer).body?.pipeThrough(
        new DecompressionStream("gzip"),
      );
      if (!stream) {
        throw new AdvertisingApiError("Amazon Ads 報表文件內容為空。", {
          code: "ADS_REPORT_DOWNLOAD_FAILED",
        });
      }
      const decoded = await readResponseWithLimit(
        new Response(stream),
        MAX_REPORT_DECOMPRESSED_BYTES,
      );
      assertNotAborted(lifecycleSignal);
      assertNotAborted(signal);
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
      } catch {
        throw new AdvertisingApiError("Amazon Ads 報表 JSON 格式無效。", {
          code: "ADS_REPORT_INVALID",
        });
      }
      const rows = parseSponsoredProductsAdvertisedProductRows(raw);
      await this.assertCombinedAccountScope(
        reference.marketplaceId,
        reference.combinedAccountScope,
      );
      return { reference: structuredClone(reference), rows };
    } finally {
      clearTimeout(timeout);
      stopCallerAbort();
      stopLifecycleAbort();
    }
  }

  private assertSponsoredProductsReportReference(
    reference: SponsoredProductsAdvertisedProductReportReference,
  ): void {
    if (
      !MARKETPLACES[reference.marketplaceId] ||
      !reportIdentifier(reference.reportId) ||
      !/^[a-f0-9]{64}$/u.test(reference.combinedAccountScope) ||
      reference.configurationId !== SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID
    ) {
      throw new AdvertisingApiError("Amazon Ads 報表識別資料不一致。", {
        status: 409,
        code: "ADS_REPORT_MISMATCH",
      });
    }
    try {
      assertReportDateRange({
        marketplaceId: reference.marketplaceId,
        startDate: reference.startDate,
        endDate: reference.endDate,
        enforceCurrentWindow: false,
      });
    } catch {
      throw new AdvertisingApiError("Amazon Ads 報表日期識別資料不一致。", {
        status: 409,
        code: "ADS_REPORT_MISMATCH",
      });
    }
  }

  private async assertCombinedAccountScope(
    marketplaceId: MarketplaceId,
    expected: string,
    signal?: AbortSignal,
    refreshProfile = false,
  ): Promise<void> {
    const current = await this.resolveCombinedAccountIdentity(
      marketplaceId,
      signal,
      refreshProfile,
    );
    if (current.combinedAccountScope !== expected) {
      throw new AdvertisingApiError("Amazon Ads 或 SP-API 帳號在報表讀取期間已改變。", {
        status: 409,
        code: "ADS_REPORT_ACCOUNT_CHANGED",
      });
    }
  }

  private async loadSponsoredProductsAdvertisedProductReportStatus(
    reference: SponsoredProductsAdvertisedProductReportReference,
    signal?: AbortSignal,
  ): Promise<InternalSponsoredProductsReportStatus> {
    this.assertSponsoredProductsReportReference(reference);
    assertNotAborted(signal);
    const identity = await this.resolveCombinedAccountIdentity(
      reference.marketplaceId,
      signal,
      true,
    );
    if (identity.combinedAccountScope !== reference.combinedAccountScope) {
      throw new AdvertisingApiError("Amazon Ads 或 SP-API 帳號在報表讀取期間已改變。", {
        status: 409,
        code: "ADS_REPORT_ACCOUNT_CHANGED",
      });
    }
    const profileId = identity.profileId;
    const config = MARKETPLACES[reference.marketplaceId];
    const credentials = await this.vault.load();
    assertNotAborted(signal);
    const { response, payload } = await this.authorizedRequest(
      `${API_ENDPOINTS[config.region]}/reporting/reports/${encodeURIComponent(reference.reportId)}`,
      {
        method: "GET",
        headers: {
          accept: "application/vnd.getasyncreportresponse.v3+json",
          "Amazon-Advertising-API-ClientId": credentials.lwaClientId,
          "Amazon-Advertising-API-Scope": profileId,
        },
      },
      signal,
      {
        retryUnauthorized: true,
        transientRetries: REPORT_STATUS_TRANSIENT_RETRIES,
      },
    );
    if (!response.ok) throw upstreamError("Advertised product report status", response, payload);
    const parsed = this.parseSponsoredProductsReportStatus(reference, payload);
    await this.assertCombinedAccountScope(
      reference.marketplaceId,
      reference.combinedAccountScope,
      signal,
    );
    return parsed;
  }

  private parseSponsoredProductsReportStatus(
    reference: SponsoredProductsAdvertisedProductReportReference,
    payload: unknown,
  ): InternalSponsoredProductsReportStatus {
    if (!isRecord(payload)) {
      throw new AdvertisingApiError("Amazon Ads 報表狀態格式無效。", {
        code: "ADS_REPORT_STATUS_INVALID",
      });
    }
    const reportId = reportIdentifier(payload.reportId);
    const configuration = isRecord(payload.configuration) ? payload.configuration : null;
    const configurationMatches = configuration &&
      configuration.adProduct === "SPONSORED_PRODUCTS" &&
      exactStringArray(configuration.groupBy, ["advertiser"]) &&
      exactStringArray(configuration.columns, SP_ADVERTISED_PRODUCT_REPORT_COLUMNS) &&
      configuration.reportTypeId === "spAdvertisedProduct" &&
      configuration.timeUnit === "SUMMARY" &&
      configuration.format === "GZIP_JSON" &&
      (configuration.filters === undefined || configuration.filters === null);
    if (
      reportId !== reference.reportId ||
      payload.startDate !== reference.startDate ||
      payload.endDate !== reference.endDate ||
      !configurationMatches
    ) {
      throw new AdvertisingApiError("Amazon Ads 報表的帳號、日期或設定不一致。", {
        status: 409,
        code: "ADS_REPORT_MISMATCH",
      });
    }
    const status = payload.status;
    if (
      status !== "PENDING" &&
      status !== "PROCESSING" &&
      status !== "COMPLETED" &&
      status !== "FAILURE"
    ) {
      throw new AdvertisingApiError("Amazon Ads 報表狀態格式無效。", {
        code: "ADS_REPORT_STATUS_INVALID",
      });
    }
    const updatedAtRaw = payload.updatedAt;
    const updatedAt = updatedAtRaw === undefined || updatedAtRaw === null
      ? null
      : stringField(updatedAtRaw, 64);
    if (updatedAtRaw !== undefined && updatedAtRaw !== null && (!updatedAt || !Number.isFinite(Date.parse(updatedAt)))) {
      throw new AdvertisingApiError("Amazon Ads 報表更新時間無效。", {
        code: "ADS_REPORT_STATUS_INVALID",
      });
    }
    let reportUrl: URL | null = null;
    if (status === "COMPLETED") {
      reportUrl = safeReportUrl(payload.url);
      if (!reportUrl) {
        throw new AdvertisingApiError("Amazon Ads 報表下載網址未通過安全檢查。", {
          code: "ADS_REPORT_URL_INVALID",
        });
      }
    } else if (payload.url !== undefined && payload.url !== null) {
      throw new AdvertisingApiError("Amazon Ads 未完成報表卻回傳下載網址，已停止。", {
        status: 409,
        code: "ADS_REPORT_STATUS_INVALID",
      });
    }
    return { status, updatedAt: updatedAt ?? null, reportUrl };
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

  private async getAccessToken(
    force = false,
    signal?: AbortSignal,
  ): Promise<string> {
    assertNotAborted(signal);
    const accountScope = await this.vault.getAccountScope();
    assertNotAborted(signal);
    const now = Date.now();
    if (!force && this.token && this.token.accountScope === accountScope && this.token.expiresAt > now) {
      return this.token.value;
    }
    if (this.tokenFlight) {
      const token = await this.tokenFlight;
      assertNotAborted(signal);
      return token;
    }
    const lifecycleSignal = this.lifecycleController.signal;
    const flight = this.refreshAccessToken(accountScope, lifecycleSignal).finally(() => {
      if (this.tokenFlight === flight) this.tokenFlight = null;
    });
    this.tokenFlight = flight;
    const token = await flight;
    assertNotAborted(signal);
    return token;
  }

  private async refreshAccessToken(
    accountScope: string,
    signal?: AbortSignal,
  ): Promise<string> {
    assertNotAborted(signal);
    const credentials = await this.vault.load();
    assertNotAborted(signal);
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
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, signal);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    let payload: unknown;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        signal: controller.signal,
      });
      assertNotAborted(signal);
      payload = await responsePayload(response);
      assertNotAborted(signal);
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
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

  private async resolveCombinedAccountIdentity(
    marketplaceId: MarketplaceId,
    signal?: AbortSignal,
    refreshProfile = false,
  ): Promise<InternalCombinedAccountIdentity> {
    assertNotAborted(signal);
    const startingContext = await this.marketplaceAccountContext(marketplaceId);
    const profileId = await this.getProfileId(marketplaceId, signal, refreshProfile);
    const currentContext = await this.marketplaceAccountContext(marketplaceId);
    assertNotAborted(signal);
    if (currentContext.cacheScope !== startingContext.cacheScope) {
      throw new AdvertisingApiError("SP-API 或 Ads 帳號在身分核對期間已改變。", {
        status: 409,
        code: "ADS_REPORT_ACCOUNT_CHANGED",
      });
    }
    const profileFingerprint = adsProfileFingerprint(marketplaceId, profileId);
    return {
      combinedAccountScope: combinedAccountScopeFingerprint(
        currentContext.cacheScope,
        profileFingerprint,
      ),
      adsProfileFingerprint: profileFingerprint,
      profileId,
    };
  }

  private async getProfileId(
    marketplaceId: MarketplaceId,
    signal?: AbortSignal,
    refresh = false,
  ): Promise<string> {
    assertNotAborted(signal);
    const context = await this.marketplaceAccountContext(marketplaceId);
    assertNotAborted(signal);
    const accountScope = context.cacheScope;
    const cached = this.profiles.get(marketplaceId);
    if (
      !refresh &&
      cached &&
      cached.accountScope === accountScope &&
      cached.expiresAt > Date.now()
    ) {
      return cached.profileId;
    }
    const existing = this.profileFlights.get(marketplaceId);
    if (existing) {
      const profileId = await existing;
      assertNotAborted(signal);
      return profileId;
    }
    const lifecycleSignal = this.lifecycleController.signal;
    const flight = this.discoverProfile(
      marketplaceId,
      accountScope,
      context.sellerId,
      lifecycleSignal,
    ).finally(() => {
      if (this.profileFlights.get(marketplaceId) === flight) this.profileFlights.delete(marketplaceId);
    });
    this.profileFlights.set(marketplaceId, flight);
    const profileId = await flight;
    assertNotAborted(signal);
    return profileId;
  }

  private async discoverProfile(
    marketplaceId: MarketplaceId,
    accountScope: string,
    expectedSellerId: string | null,
    signal?: AbortSignal,
  ): Promise<string> {
    assertNotAborted(signal);
    const config = MARKETPLACES[marketplaceId];
    const credentials = await this.vault.load();
    assertNotAborted(signal);
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
    }, signal);
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
    assertNotAborted(signal);
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
    signal?: AbortSignal,
    policy: ReportingRequestPolicy = {},
  ): Promise<{ response: Response; payload: unknown }> {
    const lifecycleSignal = this.lifecycleController.signal;
    const retryUnauthorized = policy.retryUnauthorized ?? true;
    const maximumTransientRetries = policy.transientRetries ?? 0;
    let unauthorizedRetries = 0;
    let transientRetries = 0;
    let forceTokenRefresh = false;
    for (;;) {
      assertNotAborted(lifecycleSignal);
      assertNotAborted(signal);
      const token = await this.getAccessToken(forceTokenRefresh, signal);
      forceTokenRefresh = false;
      assertNotAborted(lifecycleSignal);
      assertNotAborted(signal);
      const controller = new AbortController();
      const stopLifecycleAbort = forwardAbort(controller, lifecycleSignal);
      const stopCallerAbort = forwardAbort(controller, signal);
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      let payload: unknown;
      try {
        response = await this.fetchImpl(url, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        assertNotAborted(lifecycleSignal);
        assertNotAborted(signal);
        payload = await responsePayload(response);
        assertNotAborted(lifecycleSignal);
        assertNotAborted(signal);
      } finally {
        clearTimeout(timeout);
        stopCallerAbort();
        stopLifecycleAbort();
      }
      if (response.status === 401 && retryUnauthorized && unauthorizedRetries === 0) {
        unauthorizedRetries += 1;
        this.token = null;
        forceTokenRefresh = true;
        continue;
      }
      if (
        (response.status === 429 || (response.status >= 500 && response.status <= 599)) &&
        transientRetries < maximumTransientRetries
      ) {
        const delay = retryDelayMs(response, transientRetries);
        transientRetries += 1;
        const delayController = new AbortController();
        const stopLifecycleDelayAbort = forwardAbort(delayController, lifecycleSignal);
        const stopCallerDelayAbort = forwardAbort(delayController, signal);
        try {
          await abortableDelay(delay, delayController.signal);
        } finally {
          stopCallerDelayAbort();
          stopLifecycleDelayAbort();
        }
        continue;
      }
      return { response, payload };
    }
  }

  private async queryCampaignPage(
    marketplaceId: MarketplaceId,
    profileId: string,
    maxResults: number,
    nextToken?: string,
    signal?: AbortSignal,
  ): Promise<{ campaigns: AdvertisingCoverageCampaign[]; nextToken?: string }> {
    assertNotAborted(signal);
    const config = MARKETPLACES[marketplaceId];
    const credentials = await this.vault.load();
    assertNotAborted(signal);
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
      signal,
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
