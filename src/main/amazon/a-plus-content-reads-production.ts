import {
  marketplaceById,
  type MarketplaceId,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
} from "../abort-utils";
import {
  type AplusContentPageAdapter,
  type AplusContentPageOperation,
  type AplusContentPagePlan,
  type AplusContentPageResult,
} from "./a-plus-content-reads";
import { SpApiError, type SpApiOperation } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

const REGION_ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const REQUEST_INTERVAL_MS = 1_050;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_CONTROLLED_DELAY_MS = 25 * 60 * 1_000;
const MAX_RESPONSE_BODY_BYTES = 16 * 1_024 * 1_024;
const MIN_RATE_LIMIT = 1_000 / MAX_CONTROLLED_DELAY_MS;
const MAX_RATE_LIMIT = 1_000;

export type AplusContentReadProductionDependencies = Readonly<{
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

export interface AplusContentReadProductionAdapter
  extends AplusContentPageAdapter {
  clearPacing(): void;
}

function operationName(
  operation: AplusContentPageOperation,
): SpApiOperation {
  if (operation === "publish-records") {
    return "getAplusContentPublishRecords";
  }
  if (operation === "content-documents") {
    return "getAplusContentDocuments";
  }
  return "getAplusContentDocumentAsinRelations";
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function exactBoundedText(
  value: unknown,
  options: Readonly<{ rejectDotSegments?: boolean }> = {},
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2_048 &&
    value === value.trim() &&
    (!options.rejectDotSegments || (value !== "." && value !== "..")) &&
    !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  );
}

function marketplaceFor(plan: AplusContentPagePlan) {
  const marketplace = marketplaceById(plan.marketplaceId);
  if (!marketplace) {
    throw new SpApiError("A+ 健檢缺少可安全核對的站點或 ASIN。", {
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
      operation: operationName(plan.operation),
    });
  }
  return marketplace;
}

function assertPlan(plan: AplusContentPagePlan): void {
  marketplaceFor(plan);
  const operation = operationName(plan.operation);
  if (
    plan.operation === "publish-records" &&
    !/^[A-Z0-9]{10}$/u.test(plan.asin)
  ) {
    throw new SpApiError("A+ 健檢缺少可安全核對的站點或 ASIN。", {
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
      operation,
    });
  }
  if (
    plan.operation === "document-relations" &&
    !exactBoundedText(plan.contentReferenceKey, { rejectDotSegments: true })
  ) {
    throw new SpApiError("A+ 內容文件識別資訊無法安全辨識。", {
      status: 409,
      code: "A_PLUS_CONTENT_REFERENCE_INVALID",
      operation,
    });
  }
  if (plan.pageToken !== undefined && !exactBoundedText(plan.pageToken)) {
    throw new SpApiError("A+ 健檢分頁資訊無法安全辨識。", {
      status: 409,
      code: "A_PLUS_PAGINATION_INVALID",
      operation,
    });
  }
}

function requestUrl(plan: AplusContentPagePlan): string {
  const marketplace = marketplaceFor(plan);
  const baseUrl = `${REGION_ENDPOINTS[marketplace.region]}/aplus/2020-11-01`;
  const query = new URLSearchParams({ marketplaceId: plan.marketplaceId });
  let path: string;
  if (plan.operation === "publish-records") {
    path = "/contentPublishRecords";
    query.set("asin", plan.asin);
  } else if (plan.operation === "content-documents") {
    path = "/contentDocuments";
  } else {
    path = `/contentDocuments/${encodeURIComponent(
      plan.contentReferenceKey,
    )}/asins`;
    query.set("includedDataSet", "METADATA");
  }
  if (plan.pageToken !== undefined) query.set("pageToken", plan.pageToken);
  return `${baseUrl}${path}?${query}`;
}

function responseTooLargeError(
  response: Response,
  plan: AplusContentPagePlan,
): SpApiError {
  return new SpApiError("Amazon A+ Content API 回應超過安全大小上限。", {
    status: 502,
    code: "UPSTREAM_UNAVAILABLE",
    operation: operationName(plan.operation),
    requestId: response.headers.get("x-amzn-requestid"),
  });
}

function responseTimeoutError(
  response: Response,
  plan: AplusContentPagePlan,
): SpApiError {
  return new SpApiError("Amazon A+ Content API 回應逾時。", {
    status: 504,
    code: "UPSTREAM_UNAVAILABLE",
    operation: operationName(plan.operation),
    requestId: response.headers.get("x-amzn-requestid"),
  });
}

async function readBoundedResponseBytes(
  response: Response,
  plan: AplusContentPagePlan,
): Promise<Uint8Array> {
  throwIfAborted(plan.signal);
  const declared = response.headers.get("content-length")?.trim();
  if (declared) {
    const declaredLength = Number(declared);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BODY_BYTES
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw responseTooLargeError(response, plan);
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
      : new Error("A+ 健檢背景工作已停止。");
    void reader.cancel(reason).catch(() => undefined);
    rejectAborted(reason);
  };
  const timeout = setTimeout(() => {
    const error = responseTimeoutError(response, plan);
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
        throw responseTooLargeError(response, plan);
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
  plan: AplusContentPagePlan,
): Promise<Readonly<{ payload: unknown; responseBytes: number }>> {
  const bytes = await readBoundedResponseBytes(response, plan);
  try {
    return {
      payload: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ),
      responseBytes: bytes.byteLength,
    };
  } catch {
    throwIfAborted(plan.signal);
    return { payload: null, responseBytes: bytes.byteLength };
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  await response.body.cancel().catch(() => undefined);
}

export function createAplusContentReadProductionAdapter(
  dependencies: AplusContentReadProductionDependencies,
): AplusContentReadProductionAdapter {
  const fetcher = dependencies.fetch;
  const now = dependencies.now ?? (() => new Date());
  const random = dependencies.random ?? Math.random;
  const sleep = dependencies.sleep ?? abortableDelay;
  const userAgent = dependencies.userAgent ?? spApiUserAgent;
  const readTails = new Map<MarketplaceRegion, Promise<void>>();
  const lastStartedAt = new Map<MarketplaceRegion, number>();
  const requestIntervals = new Map<MarketplaceRegion, number>();

  function assertMode(plan: AplusContentPagePlan): void {
    if (dependencies.resolveMode(plan.marketplaceId) !== plan.expectedMode) {
      throw new SpApiError(
        "App 展示／真實模式已改變，已停止舊 A+ 健檢。",
        { status: 409, code: "REPORT_MODE_CHANGED" },
      );
    }
  }

  function observeRateLimit(
    region: MarketplaceRegion,
    response: Response,
  ): void {
    const rawLimit = response.headers.get("x-amzn-ratelimit-limit")?.trim();
    if (!rawLimit) return;
    const requestsPerSecond = Number(rawLimit);
    if (
      !Number.isFinite(requestsPerSecond) ||
      requestsPerSecond < MIN_RATE_LIMIT ||
      requestsPerSecond > MAX_RATE_LIMIT
    ) return;
    const learnedInterval = Math.ceil(1_000 / requestsPerSecond);
    if (
      !Number.isSafeInteger(learnedInterval) ||
      learnedInterval < 1 ||
      learnedInterval > MAX_CONTROLLED_DELAY_MS
    ) return;
    requestIntervals.set(
      region,
      Math.max(REQUEST_INTERVAL_MS, learnedInterval),
    );
  }

  function retryDelayMs(
    response: Response,
    attempt: number,
  ): number | null {
    const retryAfter = response.headers.get("retry-after")?.trim();
    if (retryAfter) {
      if (/^\d+(?:\.\d+)?$/u.test(retryAfter)) {
        const seconds = Number(retryAfter);
        if (
          !Number.isFinite(seconds) ||
          seconds > MAX_CONTROLLED_DELAY_MS / 1_000
        ) return null;
        const delay = Math.ceil(seconds * 1_000);
        return Number.isSafeInteger(delay) ? delay : null;
      }
      const retryAt = Date.parse(retryAfter);
      if (!Number.isFinite(retryAt)) return null;
      const delay = Math.max(0, retryAt - now().getTime());
      if (
        !Number.isSafeInteger(delay) ||
        delay > MAX_CONTROLLED_DELAY_MS
      ) return null;
      return delay;
    }
    return Math.min(500 * 2 ** attempt + random() * 250, 5_000);
  }

  async function reserveStart(
    region: MarketplaceRegion,
    plan: AplusContentPagePlan,
  ): Promise<void> {
    const previous = readTails.get(region) ?? Promise.resolve();
    const turn = previous.catch(() => undefined).then(async () => {
      throwIfAborted(plan.signal);
      const previousStartedAt = lastStartedAt.get(region) ?? 0;
      const interval = requestIntervals.get(region) ?? REQUEST_INTERVAL_MS;
      const remaining = previousStartedAt + interval - now().getTime();
      if (remaining > 0) {
        plan.onControlledWait?.();
        await sleep(remaining, plan.signal);
        throwIfAborted(plan.signal);
        plan.onControlledWait?.();
      }
      throwIfAborted(plan.signal);
      lastStartedAt.set(region, now().getTime());
    });
    readTails.set(region, turn);
    try {
      await turn;
    } finally {
      if (readTails.get(region) === turn) readTails.delete(region);
    }
  }

  async function call(
    plan: AplusContentPagePlan,
    forceTokenRefresh = false,
  ): Promise<Response> {
    throwIfAborted(plan.signal);
    assertPlan(plan);
    assertMode(plan);
    const marketplace = marketplaceFor(plan);
    const token = await dependencies.getAccessToken(
      marketplace.region,
      forceTokenRefresh,
    );
    throwIfAborted(plan.signal);
    assertMode(plan);
    await reserveStart(marketplace.region, plan);
    throwIfAborted(plan.signal);
    assertMode(plan);
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, plan.signal);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await (fetcher ?? globalThis.fetch)(requestUrl(plan), {
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
    } catch (error) {
      throwIfAborted(plan.signal);
      if (error instanceof Error && error.name === "AbortError") {
        throw new SpApiError("Amazon A+ Content API 回應逾時。", {
          status: 504,
          code: "UPSTREAM_UNAVAILABLE",
          operation: operationName(plan.operation),
        });
      }
      throw new SpApiError("目前無法連線至 Amazon A+ Content API。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        operation: operationName(plan.operation),
      });
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
  }

  async function execute(plan: AplusContentPagePlan): Promise<Response> {
    throwIfAborted(plan.signal);
    assertMode(plan);
    const region = marketplaceFor(plan).region;
    let response = await call(plan);
    observeRateLimit(region, response);
    throwIfAborted(plan.signal);
    if (response.status === 401) {
      await discardResponseBody(response);
      dependencies.invalidateAccessToken(region);
      assertMode(plan);
      response = await call(plan, true);
      observeRateLimit(region, response);
      throwIfAborted(plan.signal);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (![429, 500, 503].includes(response.status)) break;
      const delay = retryDelayMs(response, attempt);
      if (delay === null) break;
      await discardResponseBody(response);
      if (delay > 0) plan.onControlledWait?.();
      await sleep(delay, plan.signal);
      throwIfAborted(plan.signal);
      if (delay > 0) plan.onControlledWait?.();
      assertMode(plan);
      response = await call(plan);
      observeRateLimit(region, response);
      throwIfAborted(plan.signal);
    }
    return response;
  }

  return {
    clearPacing() {
      readTails.clear();
      lastStartedAt.clear();
      requestIntervals.clear();
    },

    async read(plan): Promise<AplusContentPageResult> {
      throwIfAborted(plan.signal);
      assertPlan(plan);
      assertMode(plan);
      const response = await execute(plan);
      const decoded = response.status === 200
        ? await parseJson(response, plan)
        : null;
      if (response.status !== 200) await discardResponseBody(response);
      return {
        status: response.status,
        payload: decoded?.payload ?? null,
        requestId: response.headers.get("x-amzn-requestid"),
        responseBytes: decoded?.responseBytes ?? 0,
      };
    },
  };
}
