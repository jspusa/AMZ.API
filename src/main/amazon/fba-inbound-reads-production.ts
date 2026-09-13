import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
  waitForPromiseWithSignal,
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
    } else if (request.kind === "plan-items") {
      path += "/items";
      query.set("pageSize", "1000");
      if (request.paginationToken) query.set("paginationToken", request.paginationToken);
    }
  }
  const url = new URL(path, endpoint);
  url.search = query.toString();
  return url;
}

async function parseJson(response: Response, signal?: AbortSignal): Promise<unknown | null> {
  const limit = 16 * 1024 * 1024;
  if (!response.body) return null;
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    void response.body.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body.getReader();
  const control = new AbortController();
  const unlink = forwardAbort(control, signal);
  const timer = setTimeout(() => control.abort(new SpApiError("Amazon FBA 入庫回應內容讀取逾時。", { status: 504, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE" })), FBA_INBOUND_READ_TIMEOUT_MS);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await waitForPromiseWithSignal(reader.read(), control.signal);
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > limit) return null;
      chunks.push(chunk.value);
    }
    throwIfAborted(control.signal);
    const merged = Buffer.concat(chunks);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged));
  } catch (error) {
    throwIfAborted(control.signal);
    if (error instanceof SpApiError) throw error;
    return null;
  } finally {
    clearTimeout(timer); unlink();
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
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

const REQUEST_ERROR_BODY_LIMIT = 128 * 1024;
const REQUEST_ERROR_BODY_TIMEOUT_MS = 2_000;
type ErrorBodyState = "parsed" | "empty" | "malformed" | "oversize" | "timed-out" | "unavailable";
type RequestErrorCode = "BadRequest" | "InvalidInput" | "unknown";
type RequestErrorReason = "legacy-v0-plan-unsupported" | "inbound-plan-unavailable" | "invalid-status" | "other-input" | "unknown";
type RequestErrorDetails = { state: ErrorBodyState; code: RequestErrorCode; reason: RequestErrorReason };
type DiagnosticOperation = "plans" | "plan-items";
const LEGACY_ITEMS_UNSUPPORTED = "Operation ListInboundPlanItems is not supported for Fulfillment Inbound API V0 shipments that have been converted to Send-to-Amazon inbound plans.";
const REQUEST_ERROR_REASONS: Record<RequestErrorReason, string> = {
  "legacy-v0-plan-unsupported": "舊版入庫計畫不支援商品讀取",
  "inbound-plan-unavailable": "指定入庫計畫不存在",
  "invalid-status": "計畫狀態條件遭拒",
  "other-input": "其他請求條件遭拒",
  unknown: "尚無可辨識原因",
};
const REQUEST_ERROR_BODY_STATES: Record<ErrorBodyState, string> = {
  parsed: "已讀取", empty: "空白", malformed: "格式無法辨識",
  oversize: "超過讀取上限", "timed-out": "讀取逾時", unavailable: "無法讀取",
};
const unknownRequestError = (state: ErrorBodyState): RequestErrorDetails => ({ state, code: "unknown", reason: "unknown" });

function requestErrorDetails(value: unknown, operation: DiagnosticOperation, status: number): RequestErrorDetails {
  const record = (input: unknown): input is Record<string, unknown> => Boolean(input && typeof input === "object" && !Array.isArray(input));
  const boundedText = (input: unknown, minimum: number, maximum: number): input is string => typeof input === "string" && input.length >= minimum && input.length <= maximum;
  if (!record(value) || Object.keys(value).some(key => key !== "errors") || !Array.isArray(value.errors) || value.errors.length < 1 || value.errors.length > 8) return unknownRequestError("malformed");
  const details: RequestErrorDetails[] = [];
  for (const error of value.errors) {
    if (!record(error) || Object.keys(error).some(key => !["code", "message", "details"].includes(key)) ||
      !boundedText(error.code, 1, 256) || !boundedText(error.message, 1, 2048) ||
      (error.details !== undefined && !boundedText(error.details, 0, 8192))) return unknownRequestError("malformed");
    const code: RequestErrorCode = error.code === "BadRequest" || error.code === "InvalidInput" ? error.code : "unknown";
    let reason: RequestErrorReason = code === "unknown" ? "unknown" : "other-input";
    // Only whole, documented messages identify a cause. Never project a value,
    // partial keyword match, or an arbitrary upstream code/message/details.
    if (status === 400 && code === "BadRequest") {
      if (operation === "plan-items" && (error.message === LEGACY_ITEMS_UNSUPPORTED || error.message === `ERROR: ${LEGACY_ITEMS_UNSUPPORTED}`)) reason = "legacy-v0-plan-unsupported";
      else if (operation === "plan-items" && error.message === "The requested inbound plan does not exist.") reason = "inbound-plan-unavailable";
      else if (operation === "plans" && error.message === "The status is invalid.") reason = "invalid-status";
    }
    details.push({ state: "parsed", code, reason });
  }
  const first = details[0]!;
  return details.every(detail => detail.code === first.code && detail.reason === first.reason) ? first : unknownRequestError("parsed");
}

async function readRequestError(response: Response, operation: DiagnosticOperation, signal?: AbortSignal): Promise<RequestErrorDetails> {
  throwIfAborted(signal);
  if (!response.body) return unknownRequestError("empty");
  if (response.bodyUsed || response.body.locked) return unknownRequestError("unavailable");
  const reader = response.body.getReader();
  const control = new AbortController();
  const unlink = forwardAbort(control, signal);
  const timer = setTimeout(() => control.abort(), REQUEST_ERROR_BODY_TIMEOUT_MS);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    const declared = response.headers.get("content-length");
    if (declared !== null && !/^\d+$/.test(declared)) return unknownRequestError("malformed");
    if (declared !== null && Number(declared) > REQUEST_ERROR_BODY_LIMIT) return unknownRequestError("oversize");
    while (true) {
      const chunk = await waitForPromiseWithSignal(reader.read(), control.signal);
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > REQUEST_ERROR_BODY_LIMIT) return unknownRequestError("oversize");
      chunks.push(chunk.value);
    }
    throwIfAborted(control.signal);
    if (bytes === 0) return unknownRequestError("empty");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { return unknownRequestError("malformed"); }
    return requestErrorDetails(value, operation, response.status);
  } catch {
    throwIfAborted(signal);
    return unknownRequestError(control.signal.aborted ? "timed-out" : "unavailable");
  } finally {
    clearTimeout(timer); unlink();
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function requestErrorDiagnostic(plan: FbaInboundExternalReadPlan, response: Response): Promise<string> {
  if (plan.source !== "modern" || ![400, 422].includes(response.status) || (plan.request.kind !== "plans" && plan.request.kind !== "plan-items")) return "";
  const operation = plan.request.kind;
  const details = await readRequestError(response, operation, plan.signal);
  throwIfAborted(plan.signal);
  const label = operation === "plans" ? "入庫計畫清單" : "入庫商品清單";
  const page = plan.request.paginationToken ? "接續頁" : "首頁";
  const code = details.code === "unknown" ? "未辨識" : details.code;
  return `（${label}／${page}；HTTP ${response.status}；Amazon：${code}；原因：${REQUEST_ERROR_REASONS[details.reason]}；回應：${REQUEST_ERROR_BODY_STATES[details.state]}）`;
}

function throwReadError(response: Response, diagnostic = ""): never {
  const message = response.status === 401 || response.status === 403
    ? "Amazon 拒絕 FBA 入庫貨件查詢。請確認 Private SP-API App 已具備 Amazon Fulfillment 角色並重新授權。"
    : response.status === 429
      ? "Amazon Fulfillment Inbound API 持續限流；已在有限次唯讀重試後停止。"
      : response.status === 400 || response.status === 422
        ? "Amazon 無法驗證這次 FBA 入庫貨件唯讀請求。"
        : "Amazon 暫時無法完成 FBA 入庫貨件查詢。";
  throw new SpApiError(message + diagnostic, {
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
        void response.body?.cancel().catch(() => undefined);
        dependencies.invalidateAccessToken(marketplace.region);
        response = await call(plan, true);
        continue;
      }
      if (
        [429, 500, 502, 503, 504].includes(response.status) &&
        transientRetries < 2
      ) {
        void response.body?.cancel().catch(() => undefined);
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
      if (!response.ok) throwReadError(response, await requestErrorDiagnostic(fixedPlan, response));
      const envelope = await parseJson(response, fixedPlan.signal);
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
