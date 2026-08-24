import {
  forwardAbort,
  throwIfAborted as assertNotAborted,
} from "../abort-utils";
import {
  marketplaceById,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  fbaInventoryReadIdentity,
  replenishmentReadIdentity,
  type FbaInventoryReadPlan,
  type FbaInventoryReadResult,
  type FbaInventoryReplenishmentAdapter,
  type ReplenishmentReadPlan,
  type ReplenishmentReadResult,
} from "./fba-inventory-replenishment";
import {
  assertReplenishmentRequestBody,
  buildReplenishmentOfferMetricsPageRequest,
  buildReplenishmentOffersPageRequest,
  type ReplenishmentPageRequest,
} from "./replenishment-audit";
import { SpApiError } from "./sp-api-error";
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

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function retryDelayMs(
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

function singleOfferRequest(plan: Extract<ReplenishmentReadPlan, {
  intent: "single-offer";
}>): ReplenishmentPageRequest {
  return {
    operation: "listOffers",
    path: "/replenishment/2022-11-07/offers/search",
    offset: 0,
    limit: 20,
    body: {
      pagination: { limit: 20, offset: 0 },
      filters: {
        marketplaceId: plan.marketplaceId,
        programTypes: ["SUBSCRIBE_AND_SAVE"],
        skus: [plan.sellerSku],
      },
      sort: { order: "ASC", key: "ASIN" },
    },
  };
}

function auditRequest(
  plan: Exclude<ReplenishmentReadPlan, { intent: "single-offer" }>,
): ReplenishmentPageRequest {
  const request = plan.intent === "offers-page"
    ? buildReplenishmentOffersPageRequest(plan.marketplaceId, plan.offset)
    : buildReplenishmentOfferMetricsPageRequest(
        plan.marketplaceId,
        plan.interval,
        plan.offset,
      );
  assertReplenishmentRequestBody(request);
  return request;
}

export function createFbaInventoryReplenishmentProductionAdapter(
  dependencies: ProductionAdapterDependencies,
): FbaInventoryReplenishmentAdapter {
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = dependencies.random ?? Math.random;

  async function callInventory(
    plan: FbaInventoryReadPlan,
    forceTokenRefresh: boolean,
  ): Promise<Response> {
    fbaInventoryReadIdentity(plan);
    assertNotAborted(plan.signal);
    const marketplace = marketplaceById(plan.marketplaceId)!;
    const token = await dependencies.getAccessToken(
      marketplace.region,
      forceTokenRefresh,
    );
    assertNotAborted(plan.signal);
    const query = new URLSearchParams({
      granularityType: "Marketplace",
      granularityId: plan.marketplaceId,
      marketplaceIds: plan.marketplaceId,
      details: "true",
    });
    if (plan.intent === "item") query.set("sellerSkus", plan.sellerSku);
    if (plan.intent === "catalog-page" && plan.nextToken) {
      query.set("nextToken", plan.nextToken);
    }
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, plan.signal);
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      return await fetch(
        `${REGION_ENDPOINTS[marketplace.region]}/fba/inventory/v1/summaries?${query}`,
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
      assertNotAborted(plan.signal);
      if (error instanceof Error && error.name === "AbortError") {
        throw new SpApiError(
          plan.intent === "item"
            ? "Amazon FBA 庫存查詢逾時，請稍後再試。"
            : "Amazon FBA 全站庫存證據查詢逾時，已停止健檢。",
          { status: 504, code: "UPSTREAM_UNAVAILABLE" },
        );
      }
      throw new SpApiError("目前無法連線至 Amazon FBA Inventory API。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
  }

  async function throwInventoryError(
    plan: FbaInventoryReadPlan,
    response: Response,
    envelope: unknown,
  ): Promise<never> {
    const requestId = response.headers.get("x-amzn-requestid");
    const message = upstreamMessage(envelope);
    if (plan.intent === "catalog-page") {
      throw new SpApiError(
        response.status === 401 || response.status === 403
          ? "Amazon 拒絕 FBA 全站庫存證據查詢。請確認 Amazon Fulfillment 角色並重新授權。"
          : response.status === 429
            ? "Amazon FBA Inventory API 正在限流；本次健檢已停止，沒有自動重送。"
            : message || "Amazon 暫時無法完成 FBA 全站庫存證據查詢。",
        {
          status: response.status,
          code:
            response.status === 401 || response.status === 403
              ? "FBA_INVENTORY_UNAUTHORIZED"
              : response.status === 429
                ? "RATE_LIMITED"
                : "UPSTREAM_UNAVAILABLE",
          requestId,
          retryAfter: response.headers.get("retry-after"),
        },
      );
    }
    throw new SpApiError(
      response.status === 401 || response.status === 403
        ? "Amazon 拒絕 FBA 庫存查詢。請確認 app 具有 Amazon Fulfillment 角色並重新授權。"
        : response.status === 429
          ? "Amazon FBA Inventory API 正在限流，請稍後再試。"
          : message || "Amazon 暫時無法完成 FBA 庫存查詢。",
      {
        status: response.status,
        code:
          response.status === 401 || response.status === 403
            ? "FBA_INVENTORY_UNAUTHORIZED"
            : response.status === 429
              ? "RATE_LIMITED"
              : "UPSTREAM_UNAVAILABLE",
        requestId,
        retryAfter: response.headers.get("retry-after"),
      },
    );
  }

  async function callReplenishment(
    plan: ReplenishmentReadPlan,
    forceTokenRefresh: boolean,
  ): Promise<Response> {
    replenishmentReadIdentity(plan);
    assertNotAborted(plan.signal);
    const marketplace = marketplaceById(plan.marketplaceId)!;
    const token = await dependencies.getAccessToken(
      marketplace.region,
      forceTokenRefresh,
    );
    assertNotAborted(plan.signal);
    const request = plan.intent === "single-offer"
      ? singleOfferRequest(plan)
      : auditRequest(plan);
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, plan.signal);
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      return await fetch(`${REGION_ENDPOINTS[marketplace.region]}${request.path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(now()),
          "user-agent": (dependencies.userAgent ?? spApiUserAgent)(),
        },
        body: JSON.stringify(request.body),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      assertNotAborted(plan.signal);
      if (error instanceof Error && error.name === "AbortError") {
        throw new SpApiError(
          plan.intent === "single-offer"
            ? "Amazon Subscribe & Save 查詢逾時，請稍後再試。"
            : "Amazon Subscribe & Save 全站健檢逾時，已停止讀取。",
          { status: 504, code: "UPSTREAM_UNAVAILABLE" },
        );
      }
      throw new SpApiError("目前無法連線至 Amazon Replenishment API。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
  }

  async function throwReplenishmentError(
    response: Response,
    envelope: unknown,
  ): Promise<never> {
    const requestId = response.headers.get("x-amzn-requestid");
    if (response.status === 401 || response.status === 403) {
      throw new SpApiError(
        "Amazon 拒絕 Subscribe & Save 查詢。請確認 app 具備 Inventory and Order Tracking 或 Brand Analytics 角色，並重新授權 refresh token。",
        {
          status: response.status,
          code: "REPLENISHMENT_UNAUTHORIZED",
          requestId,
        },
      );
    }
    if (response.status === 429) {
      throw new SpApiError("Amazon Replenishment API 正在限流，請稍後再試。", {
        status: 429,
        code: "RATE_LIMITED",
        requestId,
        retryAfter: response.headers.get("retry-after"),
      });
    }
    const message = upstreamMessage(envelope);
    throw new SpApiError(
      message
        ? `Amazon 無法完成 Subscribe & Save 查詢。（${message}）`
        : "Amazon 無法完成 Subscribe & Save 查詢。",
      {
        status: response.status,
        code: "UPSTREAM_UNAVAILABLE",
        requestId,
      },
    );
  }

  return {
    async readInventory(plan): Promise<FbaInventoryReadResult> {
      const identity = fbaInventoryReadIdentity(plan);
      const marketplace = marketplaceById(plan.marketplaceId)!;
      let response = await callInventory(plan, false);
      if (response.status === 401) {
        dependencies.invalidateAccessToken(marketplace.region);
        response = await callInventory(plan, true);
      }
      if (plan.intent === "item") {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (![429, 500, 503].includes(response.status)) break;
          await sleep(retryDelayMs(response, attempt, random));
          response = await callInventory(plan, false);
        }
      }
      const envelope = await parseJson(response);
      if (!response.ok) return throwInventoryError(plan, response, envelope);
      return {
        identity,
        envelope,
        requestId: response.headers.get("x-amzn-requestid"),
        rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
      };
    },

    async readReplenishment(plan): Promise<ReplenishmentReadResult> {
      const identity = replenishmentReadIdentity(plan);
      const marketplace = marketplaceById(plan.marketplaceId)!;
      let response = await callReplenishment(plan, false);
      if (response.status === 401) {
        dependencies.invalidateAccessToken(marketplace.region);
        response = await callReplenishment(plan, true);
      }
      if (plan.intent === "single-offer") {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (![429, 500, 503].includes(response.status)) break;
          await sleep(retryDelayMs(response, attempt, random));
          response = await callReplenishment(plan, false);
        }
      }
      const envelope = await parseJson(response);
      if (!response.ok) {
        return throwReplenishmentError(response, envelope);
      }
      if (envelope === null && plan.intent !== "single-offer") {
        throw new SpApiError(
          "Amazon 回傳了無法辨識的 Subscribe & Save 健檢資料。",
          {
            status: 502,
            code: "UPSTREAM_UNAVAILABLE",
            requestId: response.headers.get("x-amzn-requestid"),
          },
        );
      }
      return {
        identity,
        envelope,
        requestId: response.headers.get("x-amzn-requestid"),
        rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
      };
    },
  };
}
