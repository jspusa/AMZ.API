import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
} from "../abort-utils";
import {
  marketplaceById,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  fbaInboundExternalReadIdentity,
  type FbaInboundExternalReadAdapter,
  type FbaInboundExternalReadPlan,
} from "./fba-inbound-reads";
import type { FbaInboundTransportRequest } from "./fba-inbound-shipments";
import type { ModernFbaInboundTransportRequest } from "./fba-inbound-modern";
import { SpApiError } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

const REGION_ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const FBA_INBOUND_READ_INTERVAL_MS = 500;
const FBA_INBOUND_READ_TIMEOUT_MS = 15_000;

const readTails = new Map<MarketplaceRegion, Promise<void>>();
const lastStartedAt = new Map<MarketplaceRegion, number>();

export type FbaInboundReadsProductionDependencies = Readonly<{
  getAccessToken(
    region: MarketplaceRegion,
    forceRefresh: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  fetchImpl?: typeof fetch;
  userAgent?: () => string;
  now?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}>;

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function marketplaceFor(plan: FbaInboundExternalReadPlan) {
  const marketplaceId = plan.source === "v0"
    ? plan.request.marketplaceId
    : plan.marketplaceId;
  const marketplace = marketplaceById(marketplaceId);
  if (!marketplace) {
    throw new SpApiError("Amazon 站點無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  return marketplace;
}

function fixedV0Url(
  request: FbaInboundTransportRequest,
  endpoint: string,
): URL {
  let path: string;
  const query = new URLSearchParams();
  if (request.kind === "shipments") {
    path = "/fba/inbound/v0/shipments";
    query.set("QueryType", request.queryType);
    query.set("MarketplaceId", request.marketplaceId);
    if (request.queryType === "DATE_RANGE") {
      query.set("LastUpdatedAfter", request.lastUpdatedAfter);
      query.set("LastUpdatedBefore", request.lastUpdatedBefore);
    } else if (request.queryType === "SHIPMENT") {
      query.set("ShipmentStatusList", request.shipmentStatuses.join(","));
    } else {
      query.set("NextToken", request.nextToken);
    }
  } else if (request.queryType === "SHIPMENT") {
    path = `/fba/inbound/v0/shipments/${encodeURIComponent(
      request.shipmentId,
    )}/items`;
  } else {
    path = "/fba/inbound/v0/shipmentItems";
    query.set("QueryType", "NEXT_TOKEN");
    query.set("NextToken", request.nextToken);
    query.set("MarketplaceId", request.marketplaceId);
  }
  const url = new URL(path, endpoint);
  url.search = query.toString();
  return url;
}

function fixedModernUrl(
  request: ModernFbaInboundTransportRequest,
  endpoint: string,
): URL {
  let path = "/inbound/fba/2024-03-20/inboundPlans";
  const query = new URLSearchParams();
  if (request.kind === "plans") {
    query.set("sortBy", "LAST_UPDATED_TIME");
    query.set("sortOrder", "DESC");
    query.set("pageSize", "30");
    if (request.paginationToken) {
      query.set("paginationToken", request.paginationToken);
    }
  } else {
    path += `/${encodeURIComponent(request.inboundPlanId)}`;
    if (request.kind === "shipment") {
      path += `/shipments/${encodeURIComponent(request.shipmentId)}`;
    }
  }
  const url = new URL(path, endpoint);
  url.search = query.toString();
  return url;
}

async function parseJson(response: Response): Promise<unknown | null> {
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

function throwReadError(response: Response): never {
  const message = response.status === 401 || response.status === 403
    ? "Amazon 拒絕 FBA 入庫貨件查詢。請確認 Private SP-API App 已具備 Amazon Fulfillment 角色並重新授權。"
    : response.status === 429
      ? "Amazon Fulfillment Inbound API 持續限流；已在有限次唯讀重試後停止。"
      : response.status === 400 || response.status === 422
        ? "Amazon 無法驗證這次 FBA 入庫貨件唯讀請求。"
        : "Amazon 暫時無法完成 FBA 入庫貨件查詢。";
  throw new SpApiError(message, {
    status: response.status,
    code: response.status === 401 || response.status === 403
      ? "FBA_INBOUND_UNAUTHORIZED"
      : response.status === 429
        ? "RATE_LIMITED"
        : "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
    requestId: response.headers.get("x-amzn-requestid"),
    retryAfter: response.headers.get("retry-after"),
  });
}

export function createFbaInboundReadsProductionAdapter(
  dependencies: FbaInboundReadsProductionDependencies,
): FbaInboundExternalReadAdapter {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const userAgent = dependencies.userAgent ?? spApiUserAgent;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? abortableDelay;
  const random = dependencies.random ?? Math.random;

  async function pace(
    region: MarketplaceRegion,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const previous = readTails.get(region) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      throwIfAborted(signal);
      const delay = Math.max(
        0,
        (lastStartedAt.get(region) ?? 0) + FBA_INBOUND_READ_INTERVAL_MS -
          now().getTime(),
      );
      await sleep(delay, signal);
      throwIfAborted(signal);
      lastStartedAt.set(region, now().getTime());
    });
    readTails.set(region, current.then(() => undefined, () => undefined));
    await current;
  }

  async function call(
    plan: FbaInboundExternalReadPlan,
    forceTokenRefresh: boolean,
  ): Promise<Response> {
    throwIfAborted(plan.signal);
    const marketplace = marketplaceFor(plan);
    const token = await dependencies.getAccessToken(
      marketplace.region,
      forceTokenRefresh,
    );
    throwIfAborted(plan.signal);
    await pace(marketplace.region, plan.signal);
    throwIfAborted(plan.signal);
    const endpoint = REGION_ENDPOINTS[marketplace.region];
    const url = plan.source === "v0"
      ? fixedV0Url(plan.request, endpoint)
      : fixedModernUrl(plan.request, endpoint);
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, plan.signal);
    const timeout = setTimeout(
      () => controller.abort(),
      FBA_INBOUND_READ_TIMEOUT_MS,
    );
    try {
      return await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(now()),
          "user-agent": userAgent(),
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      throwIfAborted(plan.signal);
      if (error instanceof Error && error.name === "AbortError") {
        throw new SpApiError(
          plan.source === "v0"
            ? "Amazon FBA 入庫貨件唯讀查詢逾時，已停止這次讀取。"
            : "Amazon 新版 FBA 入庫唯讀查詢逾時，已停止這次讀取。",
          { status: 504, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE" },
        );
      }
      throw new SpApiError(
        plan.source === "v0"
          ? "目前無法連線至 Amazon Fulfillment Inbound API。"
          : "目前無法連線至 Amazon 新版 FBA 入庫 API。",
        {
          status: 502,
          code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
        },
      );
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
  }

  async function execute(
    plan: FbaInboundExternalReadPlan,
  ): Promise<Response> {
    const marketplace = marketplaceFor(plan);
    let response = await call(plan, false);
    let refreshedUnauthorized = false;
    let transientRetries = 0;
    while (true) {
      throwIfAborted(plan.signal);
      if (response.status === 401 && !refreshedUnauthorized) {
        refreshedUnauthorized = true;
        dependencies.invalidateAccessToken(marketplace.region);
        response = await call(plan, true);
        continue;
      }
      if (
        [429, 500, 502, 503, 504].includes(response.status) &&
        transientRetries < 2
      ) {
        await sleep(
          retryDelayMs(response, transientRetries, random),
          plan.signal,
        );
        transientRetries += 1;
        throwIfAborted(plan.signal);
        response = await call(plan, false);
        continue;
      }
      return response;
    }
  }

  return {
    async read(plan) {
      const identity = fbaInboundExternalReadIdentity(plan);
      const fixedPlan: FbaInboundExternalReadPlan = identity.source === "v0"
        ? { source: "v0", request: identity.request, signal: plan.signal }
        : {
            source: "modern",
            marketplaceId: identity.marketplaceId,
            request: identity.request,
            signal: plan.signal,
          };
      const response = await execute(fixedPlan);
      throwIfAborted(fixedPlan.signal);
      if (!response.ok) throwReadError(response);
      const envelope = await parseJson(response);
      throwIfAborted(fixedPlan.signal);
      if (envelope === null) {
        throw new SpApiError(
          identity.source === "v0"
            ? "Amazon 回傳了無法辨識的 FBA 入庫貨件 JSON。"
            : "Amazon 回傳了無法辨識的新版 FBA 入庫 JSON。",
          {
            status: 502,
            code: "FBA_INBOUND_FORMAT_UNSUPPORTED",
            requestId: response.headers.get("x-amzn-requestid"),
          },
        );
      }
      return {
        identity,
        envelope,
        requestId: response.headers.get("x-amzn-requestid"),
      };
    },
  };
}
