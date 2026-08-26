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
import {
  customerFeedbackMarketplaceSupported,
  type CustomerFeedbackPageAdapter,
  type CustomerFeedbackPagePlan,
  type CustomerFeedbackPageResult,
} from "./customer-feedback-reads";
import { SpApiError } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

const REGION_ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_INTERVAL_MS = 1_050;
const MAX_CONTROLLED_DELAY_MS = 25 * 60 * 1_000;
const MAX_RESPONSE_BODY_BYTES = 16 * 1_024 * 1_024;

export type CustomerFeedbackReadProductionDependencies = Readonly<{
  getAccessToken(
    region: MarketplaceRegion,
    forceRefresh: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  resolveMode(marketplaceId: MarketplaceId): "live" | "demo";
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  userAgent?: () => string;
}>;

function marketplaceFor(plan: CustomerFeedbackPagePlan) {
  const marketplace = marketplaceById(plan.marketplaceId);
  if (!marketplace || !/^[A-Z0-9]{10}$/u.test(plan.asin)) {
    throw new SpApiError(
      "評論健檢缺少可安全核對的站點或 ASIN。",
      {
        status: 409,
        code: "LISTING_IDENTITY_MISMATCH",
        operation: "getItemReviewTopics",
      },
    );
  }
  if (!customerFeedbackMarketplaceSupported(plan.marketplaceId)) {
    throw new SpApiError(
      "Amazon Customer Feedback API 尚不支援此站點。",
      {
        status: 422,
        code: "MARKETPLACE_UNSUPPORTED",
        operation: "getItemReviewTopics",
      },
    );
  }
  return marketplace;
}

function requestUrl(plan: CustomerFeedbackPagePlan): string {
  const marketplace = marketplaceFor(plan);
  const query = new URLSearchParams({
    marketplaceId: plan.marketplaceId,
    sortBy: "STAR_RATING_IMPACT",
  });
  return `${REGION_ENDPOINTS[marketplace.region]}/customerFeedback/2024-06-01/items/${encodeURIComponent(plan.asin)}/reviews/topics?${query}`;
}

async function discardResponseBody(response: Response): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  await response.body.cancel().catch(() => undefined);
}

function boundedResponseError(
  response: Response,
  message: string,
  status = 502,
): SpApiError {
  return new SpApiError(message, {
    status,
    code: "UPSTREAM_UNAVAILABLE",
    operation: "getItemReviewTopics",
    requestId: response.headers.get("x-amzn-requestid"),
  });
}

async function readBoundedResponseBytes(
  response: Response,
  plan: CustomerFeedbackPagePlan,
): Promise<Uint8Array> {
  throwIfAborted(plan.signal);
  const declared = response.headers.get("content-length")?.trim();
  if (declared) {
    const declaredLength = Number(declared);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BODY_BYTES
    ) {
      await discardResponseBody(response);
      throw boundedResponseError(
        response,
        "Amazon Customer Feedback API 回應超過安全大小上限。",
      );
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
  let rejectDeadline: (reason: unknown) => void = () => undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const onAbort = () => {
    const reason = plan.signal?.reason instanceof Error
      ? plan.signal.reason
      : new Error("評論健檢背景工作已停止。");
    rejectAborted(reason);
    void reader.cancel(reason).catch(() => undefined);
  };
  const timeout = setTimeout(() => {
    const error = boundedResponseError(
      response,
      "Amazon Customer Feedback API 回應逾時。",
      504,
    );
    rejectDeadline(error);
    void reader.cancel(error).catch(() => undefined);
  }, REQUEST_TIMEOUT_MS);
  plan.signal?.addEventListener("abort", onAbort, { once: true });
  if (plan.signal?.aborted) onAbort();
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted, deadline]);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw boundedResponseError(
          response,
          "Amazon Customer Feedback API 回應超過安全大小上限。",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    clearTimeout(timeout);
    plan.signal?.removeEventListener("abort", onAbort);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function parseJson(
  response: Response,
  plan: CustomerFeedbackPagePlan,
): Promise<unknown | null> {
  const bytes = await readBoundedResponseBytes(response, plan);
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throwIfAborted(plan.signal);
    return null;
  }
}

export function createCustomerFeedbackReadProductionAdapter(
  dependencies: CustomerFeedbackReadProductionDependencies,
): CustomerFeedbackPageAdapter {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? abortableDelay;
  const userAgent = dependencies.userAgent ?? spApiUserAgent;
  let readTail: Promise<void> = Promise.resolve();
  let nextStartAt = 0;

  function assertMode(plan: CustomerFeedbackPagePlan): void {
    if (dependencies.resolveMode(plan.marketplaceId) !== plan.expectedMode) {
      throw new SpApiError(
        "App 展示／真實模式已改變，已停止舊評論健檢。",
        { status: 409, code: "REPORT_MODE_CHANGED" },
      );
    }
  }

  function retryDelayMs(result: CustomerFeedbackPageResult): number | null {
    const retryAfter = result.retryAfter?.trim();
    if (!retryAfter) return REQUEST_INTERVAL_MS;
    if (/^\d+(?:\.\d+)?$/u.test(retryAfter)) {
      const milliseconds = Math.ceil(Number(retryAfter) * 1_000);
      return Number.isSafeInteger(milliseconds) &&
          milliseconds >= 0 &&
          milliseconds <= MAX_CONTROLLED_DELAY_MS
        ? Math.max(REQUEST_INTERVAL_MS, milliseconds)
        : null;
    }
    const retryAt = Date.parse(retryAfter);
    if (
      !Number.isFinite(retryAt) ||
      new Date(retryAt).toUTCString() !== retryAfter
    ) return null;
    const milliseconds = Math.max(0, retryAt - now().getTime());
    return Number.isSafeInteger(milliseconds) &&
        milliseconds <= MAX_CONTROLLED_DELAY_MS
      ? Math.max(REQUEST_INTERVAL_MS, milliseconds)
      : null;
  }

  async function call(
    plan: CustomerFeedbackPagePlan,
    forceTokenRefresh = false,
  ): Promise<CustomerFeedbackPageResult> {
    throwIfAborted(plan.signal);
    const marketplace = marketplaceFor(plan);
    assertMode(plan);
    const previous = readTail;
    const turn = previous.catch(() => undefined).then(async () => {
      throwIfAborted(plan.signal);
      const remaining = nextStartAt - now().getTime();
      if (remaining > 0) await sleep(remaining, plan.signal);
      throwIfAborted(plan.signal);
      assertMode(plan);
      const token = await waitForPromiseWithSignal(
        dependencies.getAccessToken(
          marketplace.region,
          forceTokenRefresh,
        ),
        plan.signal,
      );
      throwIfAborted(plan.signal);
      assertMode(plan);
      const controller = new AbortController();
      const stopForwardingAbort = forwardAbort(controller, plan.signal);
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let dispatched = false;
      try {
        dispatched = true;
        const response = await fetcher(requestUrl(plan), {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-amz-access-token": token,
            "x-amz-date": now().toISOString().replace(/[:-]|\.\d{3}/g, ""),
            "user-agent": userAgent(),
          },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        throwIfAborted(plan.signal);
        const payload = response.status === 200
          ? await parseJson(response, plan)
          : null;
        if (response.status !== 200) await discardResponseBody(response);
        const result: CustomerFeedbackPageResult = {
          status: response.status,
          payload,
          requestId: response.headers.get("x-amzn-requestid"),
          retryAfter: response.headers.get("retry-after"),
        };
        if (
          result.status === 429 ||
          result.status === 500 ||
          result.status === 503
        ) {
          const delay = retryDelayMs(result);
          if (delay !== null) {
            nextStartAt = Math.max(nextStartAt, now().getTime() + delay);
          }
        }
        return result;
      } catch (error) {
        if (error instanceof SpApiError) throw error;
        throwIfAborted(plan.signal);
        if (error instanceof Error && error.name === "AbortError") {
          throw new SpApiError("Amazon Customer Feedback API 回應逾時。", {
            status: 504,
            code: "UPSTREAM_UNAVAILABLE",
            operation: "getItemReviewTopics",
          });
        }
        throw new SpApiError("目前無法連線至 Amazon Customer Feedback API。", {
          status: 502,
          code: "UPSTREAM_UNAVAILABLE",
          operation: "getItemReviewTopics",
        });
      } finally {
        if (dispatched) {
          nextStartAt = Math.max(
            nextStartAt,
            now().getTime() + REQUEST_INTERVAL_MS,
          );
        }
        clearTimeout(timeout);
        stopForwardingAbort();
      }
    });
    const settled = turn.then(
      () => undefined,
      () => undefined,
    );
    readTail = settled;
    return waitForPromiseWithSignal(turn, plan.signal);
  }

  return {
    async read(plan): Promise<CustomerFeedbackPageResult> {
      throwIfAborted(plan.signal);
      marketplaceFor(plan);
      assertMode(plan);
      const region = marketplaceFor(plan).region;
      let result = await call(plan);
      throwIfAborted(plan.signal);
      if (result.status === 401) {
        dependencies.invalidateAccessToken(region);
        throwIfAborted(plan.signal);
        assertMode(plan);
        result = await call(plan, true);
        throwIfAborted(plan.signal);
      }
      if (result.status === 500 || result.status === 503) {
        const delay = retryDelayMs(result);
        if (delay !== null) {
          throwIfAborted(plan.signal);
          assertMode(plan);
          result = await call(plan);
          throwIfAborted(plan.signal);
        }
      }
      return result;
    },
  };
}
