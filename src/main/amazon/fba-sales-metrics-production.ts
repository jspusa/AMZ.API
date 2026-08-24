import {
  marketplaceById,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  FbaSalesMetricsError,
  fbaSalesDailyReadIdentity,
  type FbaSalesDailyReadPlan,
  type FbaSalesDailyReadResult,
  type FbaSalesMetricsAdapter,
} from "./fba-sales-metrics";
import { spApiUserAgent } from "./sp-api-runtime";

const REGION_ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

type ProductionAdapterDependencies = {
  getAccessToken(
    region: MarketplaceRegion,
    forceRefresh: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  userAgent?: () => string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function buildFbaSalesMetricsQuery(
  plan: FbaSalesDailyReadPlan,
): URLSearchParams {
  const query = new URLSearchParams({
    marketplaceIds: plan.marketplaceId,
    interval: `${plan.window.startAt}--${plan.window.endAt}`,
    granularityTimeZone: plan.window.timeZone,
    granularity: "Day",
    buyerType: "All",
    fulfillmentNetwork: "AFN",
  });
  if (plan.sellerSku) query.set("sku", plan.sellerSku);
  return query;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function fbaSalesMetricsRetryDelayMs(
  response: Pick<Response, "headers">,
  attempt: number,
  now = Date.now(),
  random: () => number = Math.random,
): number {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.max(Math.ceil(seconds * 1_000), 2_000), 60_000);
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt) && retryAt > now) {
      return Math.min(Math.max(Math.ceil(retryAt - now), 2_000), 60_000);
    }
  }
  return Math.min(
    2_000 * 2 ** Math.max(0, attempt) + random() * 250,
    10_000,
  );
}

function generalReadRetryDelayMs(
  response: Response,
  attempt: number,
  random: () => number,
): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 8_000);
  }
  return Math.min(500 * 2 ** attempt + random() * 250, 5_000);
}

function upstreamMessage(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }
  const errors = (envelope as Record<string, unknown>).errors;
  if (!Array.isArray(errors)) return null;
  for (const error of errors) {
    if (!error || typeof error !== "object" || Array.isArray(error)) continue;
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return null;
}

export function createFbaSalesMetricsProductionAdapter(
  dependencies: ProductionAdapterDependencies,
): FbaSalesMetricsAdapter {
  const now = dependencies.now ?? (() => new Date());
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = dependencies.random ?? Math.random;

  async function call(
    plan: FbaSalesDailyReadPlan,
    forceTokenRefresh: boolean,
  ): Promise<Response> {
    const marketplace = marketplaceById(plan.marketplaceId);
    if (!marketplace) {
      throw new FbaSalesMetricsError(
        "Amazon 回傳了無法辨識的 FBA 銷售趨勢。",
      );
    }
    const token = await dependencies.getAccessToken(
      marketplace.region,
      forceTokenRefresh,
    );
    const controller = new AbortController();
    const timeoutMilliseconds = Math.min(
      30_000,
      12_000 + plan.window.range.dayCount * 40,
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
    try {
      return await fetch(
        `${REGION_ENDPOINTS[marketplace.region]}/sales/v1/orderMetrics?${buildFbaSalesMetricsQuery(plan)}`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-amz-access-token": token,
            "x-amz-date": toAmzDate(now()),
            "user-agent": (dependencies.userAgent ?? spApiUserAgent)(),
          },
          cache: "no-store",
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new FbaSalesMetricsError(
          "Amazon FBA 銷售趨勢查詢逾時，請稍後再試。",
          { status: 504 },
        );
      }
      throw new FbaSalesMetricsError("目前無法連線至 Amazon Sales API。");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async readDaily(plan): Promise<FbaSalesDailyReadResult> {
      const marketplace = marketplaceById(plan.marketplaceId);
      if (!marketplace) {
        throw new FbaSalesMetricsError(
          "Amazon 回傳了無法辨識的 FBA 銷售趨勢。",
        );
      }
      let response = await call(plan, false);
      if (response.status === 401) {
        dependencies.invalidateAccessToken(marketplace.region);
        response = await call(plan, true);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (![429, 500, 503].includes(response.status)) break;
        await sleep(
          response.status === 429
            ? fbaSalesMetricsRetryDelayMs(
                response,
                attempt,
                now().getTime(),
                random,
              )
            : generalReadRetryDelayMs(response, attempt, random),
        );
        response = await call(plan, false);
      }

      const requestId = response.headers.get("x-amzn-requestid");
      const envelope = await parseJson(response);
      if (!response.ok) {
        const message =
          response.status === 401 || response.status === 403
            ? "Amazon 拒絕 FBA 銷售趨勢查詢。請確認 Private SP-API App 已具備 Pricing、Inventory and Order Tracking 或 Product Listing 角色，並重新授權。"
            : response.status === 429
              ? "Amazon Sales API 正在限流，請稍後再試。"
              : upstreamMessage(envelope) ||
                "Amazon 暫時無法完成 FBA 銷售趨勢查詢。";
        throw new FbaSalesMetricsError(message, {
          status: response.status,
          code:
            response.status === 401 || response.status === 403
              ? "SALES_METRICS_UNAUTHORIZED"
              : response.status === 429
                ? "RATE_LIMITED"
                : "UPSTREAM_UNAVAILABLE",
          requestId,
          retryAfter: response.headers.get("retry-after"),
        });
      }
      return {
        identity: fbaSalesDailyReadIdentity(plan),
        envelope,
        requestId,
        rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
      };
    },
  };
}
