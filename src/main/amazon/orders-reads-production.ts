import {
  marketplaceById,
  type MarketplaceId,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
  waitForPromiseWithSignal,
} from "../abort-utils";
import type {
  OrdersPageAdapter,
  OrdersPagePlan,
  OrdersPageResult,
} from "./orders-reads";
import { SpApiError } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

const REGION_ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BODY_BYTES = 16 * 1_024 * 1_024;

export type OrdersReadProductionDependencies = Readonly<{
  getAccessToken(
    region: MarketplaceRegion,
    forceRefresh: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  resolveMode(marketplaceId: MarketplaceId): "live" | "demo";
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  userAgent?: () => string;
}>;

function marketplaceFor(plan: OrdersPagePlan) {
  const marketplace = marketplaceById(plan.marketplaceId);
  if (!marketplace) {
    throw new SpApiError("不支援這個 Amazon 站點。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  return marketplace;
}

function requestUrl(plan: OrdersPagePlan): string {
  const marketplace = marketplaceFor(plan);
  const query = new URLSearchParams({
    lastUpdatedAfter: plan.lastUpdatedAfter,
    marketplaceIds: plan.marketplaceId,
    maxResultsPerPage: plan.intent === "connection-probe" ? "1" : "50",
    includedData: "PROCEEDS,FULFILLMENT,CANCELLATION,PROMOTION",
  });
  if (plan.fulfillmentStatus) {
    query.set("fulfillmentStatuses", plan.fulfillmentStatus);
  }
  query.set("fulfilledBy", "AMAZON");
  if (plan.paginationToken) {
    query.set("paginationToken", plan.paginationToken);
  }
  return `${REGION_ENDPOINTS[marketplace.region]}/orders/2026-01-01/orders?${query}`;
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

async function discardResponseBody(response: Response): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  await response.body.cancel().catch(() => undefined);
}

function responseTooLargeError(response: Response): SpApiError {
  return new SpApiError("Amazon Orders API 回應超過安全大小上限。", {
    status: 502,
    code: "UPSTREAM_UNAVAILABLE",
    requestId: response.headers.get("x-amzn-requestid"),
  });
}

async function readBoundedResponseBytes(
  response: Response,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(callerSignal);
  const declared = response.headers.get("content-length")?.trim();
  if (declared) {
    const declaredLength = Number(declared);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BODY_BYTES
    ) {
      await discardResponseBody(response);
      throw responseTooLargeError(response);
    }
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectAborted: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => {
    const reason = callerSignal?.aborted
      ? callerSignal.reason
      : Object.assign(new Error("Orders response deadline exceeded."), {
          name: "AbortError",
        });
    rejectAborted(reason);
    void reader.cancel(reason).catch(() => undefined);
  };
  requestSignal.addEventListener("abort", onAbort, { once: true });
  if (requestSignal.aborted) onAbort();
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw responseTooLargeError(response);
      }
      chunks.push(chunk.value);
    }
  } finally {
    requestSignal.removeEventListener("abort", onAbort);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function parseJsonResponse(
  response: Response,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  const bytes = await readBoundedResponseBytes(
    response,
    requestSignal,
    callerSignal,
  );
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}

function retryDelayMs(
  result: OrdersPageResult,
  attempt: number,
  random: () => number,
): number {
  if (result.retryAfter) {
    const seconds = Number(result.retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 8_000);
  }
  return Math.min(500 * 2 ** attempt + random() * 250, 5_000);
}

export function createOrdersReadProductionAdapter(
  dependencies: OrdersReadProductionDependencies,
): OrdersPageAdapter {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? abortableDelay;
  const random = dependencies.random ?? Math.random;
  const userAgent = dependencies.userAgent ?? spApiUserAgent;

  function assertMode(plan: OrdersPagePlan): void {
    if (
      plan.expectedMode !== "live" ||
      dependencies.resolveMode(plan.marketplaceId) !== plan.expectedMode
    ) {
      throw new SpApiError(
        "App 展示／真實模式已改變，已停止舊訂單查詢。",
        { status: 409, code: "REPORT_MODE_CHANGED" },
      );
    }
  }

  async function call(
    plan: OrdersPagePlan,
    forceTokenRefresh = false,
  ): Promise<OrdersPageResult> {
    throwIfAborted(plan.signal);
    const marketplace = marketplaceFor(plan);
    assertMode(plan);
    const token = await waitForPromiseWithSignal(
      dependencies.getAccessToken(marketplace.region, forceTokenRefresh),
      plan.signal,
    );
    throwIfAborted(plan.signal);
    assertMode(plan);
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, plan.signal);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let responseReceived = false;
    try {
      const response = await fetcher(requestUrl(plan), {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(now()),
          "user-agent": userAgent(),
        },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      responseReceived = true;
      throwIfAborted(plan.signal);
      assertMode(plan);
      const payload = response.ok
        ? await parseJsonResponse(response, controller.signal, plan.signal)
        : null;
      if (!response.ok) await discardResponseBody(response);
      throwIfAborted(plan.signal);
      assertMode(plan);
      return {
        status: response.status,
        payload,
        requestId: response.headers.get("x-amzn-requestid"),
        rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
        retryAfter: response.headers.get("retry-after"),
      };
    } catch (error) {
      throwIfAborted(plan.signal);
      if (error instanceof Error && error.name === "AbortError") {
        throw new SpApiError("Amazon SP-API 回應逾時，請稍後再試。", {
          status: 504,
          code: "UPSTREAM_UNAVAILABLE",
        });
      }
      if (error instanceof SpApiError) throw error;
      if (responseReceived) throw error;
      throw new SpApiError("目前無法連線至 Amazon SP-API。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
  }

  return {
    async read(plan): Promise<OrdersPageResult> {
      throwIfAborted(plan.signal);
      const marketplace = marketplaceFor(plan);
      assertMode(plan);
      let result = await call(plan);
      throwIfAborted(plan.signal);
      assertMode(plan);

      if (result.status === 401) {
        dependencies.invalidateAccessToken(marketplace.region);
        throwIfAborted(plan.signal);
        assertMode(plan);
        result = await call(plan, true);
        throwIfAborted(plan.signal);
        assertMode(plan);
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (![429, 500, 503].includes(result.status)) break;
        throwIfAborted(plan.signal);
        assertMode(plan);
        await sleep(retryDelayMs(result, attempt, random), plan.signal);
        throwIfAborted(plan.signal);
        assertMode(plan);
        result = await call(plan);
        throwIfAborted(plan.signal);
        assertMode(plan);
      }
      return result;
    },
  };
}
