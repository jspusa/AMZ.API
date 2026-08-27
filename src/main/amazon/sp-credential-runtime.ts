import {
  MARKETPLACES,
  marketplaceById,
  type MarketplaceId,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import { SpApiError } from "./sp-api-error";

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
};

type RuntimeTimeout = ReturnType<typeof globalThis.setTimeout>;

type SpCredentialRuntimeDependencies = Readonly<{
  readEnvironment?: (key: string) => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  setTimeout?: (handler: () => void, timeoutMs: number) => RuntimeTimeout;
  clearTimeout?: (timeout: RuntimeTimeout) => void;
}>;

export type SpCredentialRuntimePort = Readonly<{
  getSellerId(region: MarketplaceRegion): string | undefined;
  isConfiguredForMarketplace(marketplaceId: MarketplaceId): boolean;
  usesDemoMode(marketplaceId: MarketplaceId): boolean;
  replenishmentSkillConnected(): boolean;
  requestAccessToken(
    region: MarketplaceRegion,
    forceRefresh?: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  credentialGeneration(): number;
  clearCredentialCaches(): void;
}>;

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const LWA_TIMEOUT_MS = 10_000;
const TOKEN_REUSE_FENCE_MS = 120_000;

const marketplaceIdLookup = Object.fromEntries(
  MARKETPLACES.map((marketplace) => [marketplace.id, true]),
);

/**
 * Owns the complete in-memory SP-API credential lifecycle. The runtime reads
 * environment values at call time so a Notebook Key refresh takes effect as
 * soon as the composition root clears this runtime's caches.
 */
export function createSpCredentialRuntime(
  dependencies: SpCredentialRuntimeDependencies = {},
): SpCredentialRuntimePort {
  const readEnvironment = dependencies.readEnvironment ??
    ((key: string) => process.env[key]);
  const fetchRequest = dependencies.fetch ??
    ((input: string | URL | Request, init?: RequestInit) =>
      globalThis.fetch(input, init));
  const now = dependencies.now ?? (() => Date.now());
  const setRuntimeTimeout = dependencies.setTimeout ??
    ((handler: () => void, timeout: number) =>
      globalThis.setTimeout(handler, timeout));
  const clearRuntimeTimeout = dependencies.clearTimeout ??
    ((timeout: RuntimeTimeout) => globalThis.clearTimeout(timeout));

  const tokenCache = new Map<MarketplaceRegion, TokenCacheEntry>();
  const tokenRequests = new Map<
    MarketplaceRegion,
    Promise<TokenCacheEntry>
  >();
  let generation = 0;

  function getRefreshToken(region: MarketplaceRegion): string | undefined {
    const regionalKey = `SP_API_REFRESH_TOKEN_${region.toUpperCase()}`;
    return readEnvironment(regionalKey) ||
      readEnvironment("SP_API_REFRESH_TOKEN");
  }

  function getSellerId(region: MarketplaceRegion): string | undefined {
    const regionalKey = `SP_API_SELLER_ID_${region.toUpperCase()}`;
    const sellerId = readEnvironment(regionalKey) ||
      readEnvironment("SP_API_SELLER_ID");
    if (!sellerId) return undefined;
    if (Object.hasOwn(marketplaceIdLookup, sellerId)) {
      throw new SpApiError(
        "目前保存的 Seller ID 是 Marketplace ID；請在 Seller Central 重新貼入 Merchant Token。",
        { status: 422, code: "INVALID_SELLER_ID" },
      );
    }
    if (/\s|[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(sellerId)) {
      throw new SpApiError(
        "目前保存的 Seller ID 含有空白或不可見字元；請重新複製 Merchant Token。",
        { status: 422, code: "INVALID_SELLER_ID" },
      );
    }
    return sellerId;
  }

  function isConfiguredForMarketplace(marketplaceId: MarketplaceId): boolean {
    const marketplace = marketplaceById(marketplaceId);
    if (!marketplace) return false;
    return Boolean(
      readEnvironment("SP_API_LWA_CLIENT_ID") &&
        readEnvironment("SP_API_LWA_CLIENT_SECRET") &&
        getRefreshToken(marketplace.region),
    );
  }

  function usesDemoMode(marketplaceId: MarketplaceId): boolean {
    if (readEnvironment("SP_API_MODE")?.toLowerCase() === "demo") return true;
    return !isConfiguredForMarketplace(marketplaceId);
  }

  function replenishmentSkillConnected(): boolean {
    return Boolean(
      readEnvironment("AMAZON_REPLENISHMENT_SKILL_URL")?.trim(),
    );
  }

  async function requestAccessToken(
    region: MarketplaceRegion,
    forceRefresh = false,
  ): Promise<string> {
    const requestGeneration = generation;
    const cached = tokenCache.get(region);
    if (
      !forceRefresh && cached &&
      cached.expiresAt > now() + TOKEN_REUSE_FENCE_MS
    ) {
      return cached.accessToken;
    }

    if (!forceRefresh) {
      const inFlight = tokenRequests.get(region);
      if (inFlight) return (await inFlight).accessToken;
    }

    const clientId = readEnvironment("SP_API_LWA_CLIENT_ID");
    const clientSecret = readEnvironment("SP_API_LWA_CLIENT_SECRET");
    const refreshToken = getRefreshToken(region);

    if (!clientId || !clientSecret || !refreshToken) {
      throw new SpApiError("此站點尚未設定 Amazon SP-API 憑證。", {
        status: 503,
        code: "NOT_CONFIGURED",
      });
    }

    const tokenPromise = (async (): Promise<TokenCacheEntry> => {
      const controller = new AbortController();
      const timeout = setRuntimeTimeout(
        () => controller.abort(),
        LWA_TIMEOUT_MS,
      );

      try {
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        });

        const response = await fetchRequest(LWA_TOKEN_URL, {
          method: "POST",
          headers: {
            "content-type":
              "application/x-www-form-urlencoded;charset=UTF-8",
            accept: "application/json",
          },
          body,
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new SpApiError(
            response.status === 400 || response.status === 401
              ? "LWA 憑證或 refresh token 無效，請重新檢查授權。"
              : "Amazon LWA 暫時無法完成驗證。",
            {
              status: response.status === 400 ? 401 : response.status,
              code:
                response.status === 400 || response.status === 401
                  ? "UNAUTHORIZED"
                  : "UPSTREAM_UNAVAILABLE",
            },
          );
        }

        const payload = (await response.json()) as {
          access_token?: string;
          expires_in?: number;
        };

        if (!payload.access_token) {
          throw new SpApiError("Amazon LWA 回傳了無效的驗證結果。", {
            status: 502,
            code: "UPSTREAM_UNAVAILABLE",
          });
        }

        const entry = {
          accessToken: payload.access_token,
          expiresAt: now() +
            Math.max(60, payload.expires_in ?? 3600) * 1000,
        };
        if (requestGeneration !== generation) {
          throw new SpApiError(
            "Amazon 憑證已在連線期間更新，請重新執行這次查詢。",
            { status: 409, code: "CREDENTIALS_CHANGED" },
          );
        }
        tokenCache.set(region, entry);
        return entry;
      } catch (error) {
        if (error instanceof SpApiError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new SpApiError("Amazon LWA 驗證逾時，請稍後再試。", {
            status: 504,
            code: "UPSTREAM_UNAVAILABLE",
          });
        }
        throw new SpApiError("無法連線至 Amazon LWA。", {
          status: 502,
          code: "UPSTREAM_UNAVAILABLE",
        });
      } finally {
        clearRuntimeTimeout(timeout);
      }
    })();

    tokenRequests.set(region, tokenPromise);
    try {
      return (await tokenPromise).accessToken;
    } finally {
      if (tokenRequests.get(region) === tokenPromise) {
        tokenRequests.delete(region);
      }
    }
  }

  function invalidateAccessToken(region: MarketplaceRegion): void {
    tokenCache.delete(region);
  }

  function clearCredentialCaches(): void {
    generation += 1;
    tokenCache.clear();
    tokenRequests.clear();
  }

  return Object.freeze({
    getSellerId,
    isConfiguredForMarketplace,
    usesDemoMode,
    replenishmentSkillConnected,
    requestAccessToken,
    invalidateAccessToken,
    credentialGeneration: () => generation,
    clearCredentialCaches,
  });
}
