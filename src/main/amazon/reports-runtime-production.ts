import {
  abortableDelay,
  forwardAbort,
  throwIfAborted as assertNotAborted,
} from "../abort-utils";
import {
  marketplaceById,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  reportsAdapterIdentity,
  type ReportsAdapter,
  type ReportsAdapterIdentity,
  type ReportsAdapterStatus,
  type ReportsCreateRequest,
  type ReportsDocumentRequest,
  type ReportsIntentPlan,
  type ReportsStatusRequest,
} from "./reports-runtime";
import {
  assertFbaShipmentSalesWindow,
  strictReportDateKey,
} from "./revenue-report-windows";
import { SpApiError } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

const REGION_ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const REPORTS_API_PREFIX = "/reports/2021-06-30";
const REPORTS_REQUEST_TIMEOUT_MS = 15_000;
const REPORT_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_GET_TRANSIENT_RETRIES = 2;
const MAX_GET_RETRY_DELAY_MS = 8_000;
const MAX_REPORTS_JSON_BYTES = 1024 * 1024;
const MAX_REPORT_COMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_REPORT_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
const REPORT_IDENTIFIER = /^[A-Za-z0-9._-]{1,200}$/u;

type ProductionReportsAdapterDependencies = Readonly<{
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

type ReportDefinition = Readonly<{
  reportType: string;
  reportOptions: Readonly<Record<string, string>> | null;
  dataStartTime: string | null;
  dataEndTime: string | null;
  pendingNotice: string;
  doneNotice: string;
}>;

type JsonRecord = Record<string, unknown>;

type ReportsApiResponse = Readonly<{
  ok: boolean;
  status: number;
  headers: Headers;
  payload: unknown;
}>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function exactRecord(
  value: unknown,
  expected: Readonly<Record<string, string>> | null,
): boolean {
  if (expected === null) {
    return value === undefined || value === null ||
      (record(value) !== null && Object.keys(record(value)!).length === 0);
  }
  const source = record(value);
  if (!source) return false;
  const keys = Object.keys(expected);
  return Object.keys(source).length === keys.length &&
    keys.every((key) => source[key] === expected[key]);
}

function sameInstant(value: unknown, expected: string): boolean {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) === Date.parse(expected);
}

function definition(plan: ReportsIntentPlan): ReportDefinition {
  switch (plan.intent) {
    case "all-listings":
      return {
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
        reportOptions: { preferredReportDocumentLocale: "en_US" },
        dataStartTime: null,
        dataEndTime: null,
        pendingNotice: "Amazon 正在準備全商品清單。",
        doneNotice: "Amazon 全商品清單已就緒。",
      };
    case "active-business-listings":
      return {
        reportType: "GET_MERCHANT_LISTINGS_DATA",
        reportOptions: { preferredReportDocumentLocale: "en_US" },
        dataStartTime: null,
        dataEndTime: null,
        pendingNotice: "Amazon 正在準備 Active Listings Business Price 報表。",
        doneNotice: "Amazon Active Listings Business Price 報表已就緒。",
      };
    case "aged-inventory":
      return {
        reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
        reportOptions: null,
        dataStartTime: null,
        dataEndTime: null,
        pendingNotice: "Amazon 正在準備 FBA 庫齡資料；完成後會自動顯示。",
        doneNotice: "Amazon FBA 庫齡資料已就緒，正在整理 180 天以上庫存。",
      };
    case "inbound-noncompliance":
      return {
        reportType: "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA",
        reportOptions: null,
        dataStartTime: null,
        dataEndTime: null,
        pendingNotice: "Amazon 正在準備每日 FBA 入庫瑕疵報表。",
        doneNotice: "Amazon 每日 FBA 入庫瑕疵報表已就緒。",
      };
    case "sales-and-traffic-daily-sku":
      return {
        reportType: "GET_SALES_AND_TRAFFIC_REPORT",
        reportOptions: { dateGranularity: "DAY", asinGranularity: "SKU" },
        dataStartTime: plan.startDate,
        dataEndTime: plan.endDate,
        pendingNotice: "Amazon 正在準備 SKU 銷售與流量報表。",
        doneNotice: "Amazon SKU 銷售與流量報表已就緒。",
      };
    case "fba-shipment-sales":
      return {
        reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
        reportOptions: null,
        dataStartTime: plan.dataStartTime,
        dataEndTime: plan.dataEndTime,
        pendingNotice: "Amazon 正在準備 FBA 已出貨商品資料。",
        doneNotice: "Amazon FBA 已出貨商品資料已就緒。",
      };
  }
}

function assertFixedShipmentWindow(
  request: ReportsCreateRequest | ReportsStatusRequest | ReportsDocumentRequest,
  now: () => Date,
): void {
  if (request.intent !== "fba-shipment-sales") return;
  assertFbaShipmentSalesWindow(request, now().getTime());
}

function assertLiveRequest(
  request: ReportsCreateRequest | ReportsStatusRequest | ReportsDocumentRequest,
  now: () => Date,
): void {
  if (request.mode !== "live") {
    throw new SpApiError("Production Reports adapter 不接受展示模式。", {
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
  }
  if (!marketplaceById(request.marketplaceId)) {
    throw new SpApiError("Amazon 站點無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  reportsAdapterIdentity(request, request.mode);
  assertFixedShipmentWindow(request, now);
  if (
    (request.operation === "status" || request.operation === "document") &&
    !REPORT_IDENTIFIER.test(request.reportId)
  ) {
    throw new SpApiError("Amazon 報表識別無效。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  if (
    request.operation === "document" &&
    !REPORT_IDENTIFIER.test(request.documentId)
  ) {
    throw new SpApiError("Amazon 報表文件識別無效。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
}

function identity(
  request: ReportsCreateRequest | ReportsStatusRequest | ReportsDocumentRequest,
): ReportsAdapterIdentity {
  return reportsAdapterIdentity(request, "live");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

async function parseJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const encoded = await readBoundedResponseBody(
    response,
    MAX_REPORTS_JSON_BYTES,
    signal,
    {
      empty: null,
      tooLarge: () => new SpApiError("Amazon Reports API 回應超過安全大小上限。", {
        status: 502,
        code: "REPORT_FAILED",
      }),
    },
  );
  assertNotAborted(signal);
  if (encoded.byteLength === 0) return null;
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(encoded),
    );
    assertNotAborted(signal);
    return parsed;
  } catch {
    assertNotAborted(signal);
    return null;
  }
}

function retryDelayMs(
  response: Pick<ReportsApiResponse, "headers">,
  attempt: number,
  now: () => Date,
  random: () => number,
): number {
  const retryAfter = response.headers.get("retry-after")?.trim() ?? "";
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.round(seconds * 1_000), MAX_GET_RETRY_DELAY_MS);
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(
        0,
        Math.min(retryAt - now().getTime(), MAX_GET_RETRY_DELAY_MS),
      );
    }
  }
  return Math.min(250 * 2 ** attempt + random() * 100, MAX_GET_RETRY_DELAY_MS);
}

function safeReportUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 8_192) {
    return null;
  }
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/iu.exec(value)?.[1];
  if (!authority || authority.includes("@") || authority.includes(":")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
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

type BoundedBodyFailures = Readonly<{
  empty: (() => SpApiError) | null;
  tooLarge: () => SpApiError;
}>;

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
  failures: BoundedBodyFailures,
): Promise<Uint8Array> {
  assertNotAborted(signal);
  const declared = response.headers.get("content-length")?.trim();
  if (declared) {
    const declaredLength = Number(declared);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw failures.tooLarge();
    }
  }
  if (!response.body) {
    if (failures.empty) throw failures.empty();
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectAborted: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => {
    const reason = signal.reason instanceof Error
      ? signal.reason
      : new Error("背景讀取已停止。");
    void reader.cancel(reason).catch(() => undefined);
    rejectAborted(reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw failures.tooLarge();
      }
      chunks.push(value);
    }
    assertNotAborted(signal);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function readResponseWithLimit(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return readBoundedResponseBody(response, maximumBytes, signal, {
    empty: () => new SpApiError("Amazon 報表文件內容為空。", {
      status: 502,
      code: "REPORT_DOWNLOAD_FAILED",
    }),
    tooLarge: () => new SpApiError("Amazon 報表超過本機安全大小上限。", {
      status: 413,
      code: "REPORT_TOO_LARGE",
    }),
  });
}

function statusValue(value: unknown): ReportsAdapterStatus["status"] | null {
  return value === "IN_QUEUE" ||
      value === "IN_PROGRESS" ||
      value === "DONE" ||
      value === "CANCELLED" ||
      value === "FATAL"
    ? value
    : null;
}

function assertStatusIdentity(
  request: ReportsStatusRequest,
  payload: JsonRecord,
  expected: ReportDefinition,
  requestId: string | null,
): void {
  const marketplaces = payload.marketplaceIds;
  // The official GetReport `Report` model does not echo the create request's
  // reportOptions. If Amazon supplies this forward-compatible field, bind it
  // exactly; otherwise the durable runtime identity remains authoritative.
  const fixedOptions = payload.reportOptions === undefined ||
    exactRecord(payload.reportOptions, expected.reportOptions);
  const fixedIdentity = payload.reportId === request.reportId &&
    payload.reportType === expected.reportType &&
    Array.isArray(marketplaces) &&
    marketplaces.length === 1 &&
    marketplaces[0] === request.marketplaceId &&
    fixedOptions;
  const exactDates = request.intent === "sales-and-traffic-daily-sku"
    ? strictReportDateKey(payload.dataStartTime) === request.startDate &&
      strictReportDateKey(payload.dataEndTime) === request.endDate
    : request.intent === "fba-shipment-sales"
      ? sameInstant(payload.dataStartTime, request.dataStartTime) &&
        sameInstant(payload.dataEndTime, request.dataEndTime)
      : true;
  if (!fixedIdentity || !exactDates) {
    throw new SpApiError("Amazon 報表與固定意圖、站點、選項或日期不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
      requestId,
    });
  }
}

function createBody(request: ReportsCreateRequest): JsonRecord {
  const fixed = definition(request);
  return {
    reportType: fixed.reportType,
    marketplaceIds: [request.marketplaceId],
    ...(fixed.dataStartTime ? { dataStartTime: fixed.dataStartTime } : {}),
    ...(fixed.dataEndTime ? { dataEndTime: fixed.dataEndTime } : {}),
    ...(fixed.reportOptions ? { reportOptions: { ...fixed.reportOptions } } : {}),
  };
}

export function createReportsRuntimeProductionAdapter(
  dependencies: ProductionReportsAdapterDependencies,
): ReportsAdapter {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? abortableDelay;
  const random = dependencies.random ?? Math.random;

  async function callReportsApi(input: Readonly<{
    request: ReportsCreateRequest | ReportsStatusRequest | ReportsDocumentRequest;
    path: string;
    method: "GET" | "POST";
    body?: unknown;
    forceTokenRefresh: boolean;
  }>): Promise<ReportsApiResponse> {
    assertNotAborted(input.request.signal);
    const marketplace = marketplaceById(input.request.marketplaceId)!;
    const token = await dependencies.getAccessToken(
      marketplace.region,
      input.forceTokenRefresh,
    );
    assertNotAborted(input.request.signal);
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, input.request.signal);
    const timeout = setTimeout(() => controller.abort(), REPORTS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(
        `${REGION_ENDPOINTS[marketplace.region]}${REPORTS_API_PREFIX}${input.path}`,
        {
          method: input.method,
          headers: {
            accept: "application/json",
            ...(input.method === "POST" ? { "content-type": "application/json" } : {}),
            "x-amz-access-token": token,
            "x-amz-date": toAmzDate(now()),
            "user-agent": (dependencies.userAgent ?? spApiUserAgent)(),
          },
          body: input.method === "POST" ? JSON.stringify(input.body) : undefined,
          cache: "no-store",
          signal: controller.signal,
        },
      );
      assertNotAborted(input.request.signal);
      const payload = await parseJson(response, controller.signal);
      assertNotAborted(input.request.signal);
      assertNotAborted(controller.signal);
      return {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        payload,
      };
    } catch (error) {
      assertNotAborted(input.request.signal);
      if (error instanceof SpApiError) throw error;
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new SpApiError("Amazon Reports API 查詢逾時。", {
          status: 504,
          code: "UPSTREAM_UNAVAILABLE",
        });
      }
      throw new SpApiError("目前無法連線至 Amazon Reports API。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
  }

  async function getWithBoundedRetry(
    request: ReportsStatusRequest | ReportsDocumentRequest,
    path: string,
  ): Promise<ReportsApiResponse> {
    const marketplace = marketplaceById(request.marketplaceId)!;
    let forceTokenRefresh = false;
    let refreshed = false;
    let transientRetries = 0;
    for (;;) {
      const response = await callReportsApi({
        request,
        path,
        method: "GET",
        forceTokenRefresh,
      });
      forceTokenRefresh = false;
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        dependencies.invalidateAccessToken(marketplace.region);
        forceTokenRefresh = true;
        continue;
      }
      if (
        (response.status === 429 || response.status === 500 || response.status === 503) &&
        transientRetries < MAX_GET_TRANSIENT_RETRIES
      ) {
        const delay = retryDelayMs(response, transientRetries, now, random);
        transientRetries += 1;
        await sleep(delay, request.signal);
        assertNotAborted(request.signal);
        continue;
      }
      return response;
    }
  }

  function throwReportsError(response: ReportsApiResponse): never {
    throw new SpApiError(
      response.status === 401 || response.status === 403
        ? "Amazon 拒絕 Reports API 查詢，請確認角色並重新授權。"
        : response.status === 429
          ? "Amazon Reports API 正在限流，請稍後再試。"
          : "Amazon 無法完成固定報表操作。",
      {
        status: response.status || 502,
        code: response.status === 429 ? "RATE_LIMITED" : "REPORT_FAILED",
        requestId: response.headers.get("x-amzn-requestid"),
        retryAfter: response.headers.get("retry-after"),
      },
    );
  }

  async function downloadSignedDocument(
    request: ReportsDocumentRequest,
    url: URL,
  ): Promise<Uint8Array> {
    assertNotAborted(request.signal);
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, request.signal);
    const timeout = setTimeout(() => controller.abort(), REPORT_DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      assertNotAborted(request.signal);
      if (!response.ok) {
        throw new SpApiError("Amazon 報表文件暫時無法下載。", {
          status: response.status || 502,
          code: "REPORT_DOWNLOAD_FAILED",
        });
      }
      return await readResponseWithLimit(
        response,
        MAX_REPORT_COMPRESSED_BYTES,
        controller.signal,
      );
    } catch (error) {
      assertNotAborted(request.signal);
      if (error instanceof SpApiError) throw error;
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new SpApiError("Amazon 報表文件下載逾時。", {
          status: 504,
          code: "REPORT_DOWNLOAD_FAILED",
        });
      }
      throw new SpApiError("Amazon 報表文件下載失敗。", {
        status: 502,
        code: "REPORT_DOWNLOAD_FAILED",
      });
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
  }

  const adapter: ReportsAdapter = {
    async create(request) {
      assertLiveRequest(request, now);
      const response = await callReportsApi({
        request,
        path: "/reports",
        method: "POST",
        body: createBody(request),
        forceTokenRefresh: false,
      });
      if (!response.ok) {
        // A create POST is never replayed because Amazon may have accepted it
        // before returning or losing the response. A 401 still proves the
        // cached access token is unusable, so clear only that cache entry and
        // let a later explicit user retry obtain a fresh token.
        if (response.status === 401) {
          const marketplace = marketplaceById(request.marketplaceId)!;
          dependencies.invalidateAccessToken(marketplace.region);
        }
        return throwReportsError(response);
      }
      const payload = record(response.payload);
      const reportId = payload?.reportId;
      if (typeof reportId !== "string" || !REPORT_IDENTIFIER.test(reportId)) {
        throw new SpApiError("Amazon 沒有回傳有效的報表識別。", {
          status: 502,
          code: "REPORT_FAILED",
          requestId: response.headers.get("x-amzn-requestid"),
        });
      }
      const fixed = definition(request);
      return {
        identity: identity(request),
        mode: "live",
        ready: false,
        reportId,
        documentId: null,
        status: "IN_QUEUE",
        notice: fixed.pendingNotice,
      };
    },

    async status(request) {
      assertLiveRequest(request, now);
      const response = await getWithBoundedRetry(
        request,
        `/reports/${encodeURIComponent(request.reportId)}`,
      );
      if (!response.ok) return throwReportsError(response);
      const payload = record(response.payload);
      if (!payload) {
        throw new SpApiError("Amazon 回傳了無法辨識的報表狀態。", {
          status: 502,
          code: "REPORT_FAILED",
          requestId: response.headers.get("x-amzn-requestid"),
        });
      }
      const fixed = definition(request);
      const requestId = response.headers.get("x-amzn-requestid");
      assertStatusIdentity(request, payload, fixed, requestId);
      const status = statusValue(payload.processingStatus);
      if (!status) {
        throw new SpApiError("Amazon 回傳了無法辨識的報表狀態。", {
          status: 502,
          code: "REPORT_FAILED",
          requestId,
        });
      }
      const documentId = payload.reportDocumentId === undefined ||
          payload.reportDocumentId === null
        ? null
        : typeof payload.reportDocumentId === "string" &&
            REPORT_IDENTIFIER.test(payload.reportDocumentId)
          ? payload.reportDocumentId
          : undefined;
      if (
        documentId === undefined ||
        (status === "DONE" && documentId === null) ||
        (status !== "DONE" && documentId !== null)
      ) {
        throw new SpApiError("Amazon 報表狀態與文件識別不一致。", {
          status: 409,
          code: "REPORT_MISMATCH",
          requestId,
        });
      }
      return {
        identity: identity(request),
        mode: "live",
        ready: status === "DONE",
        reportId: request.reportId,
        documentId,
        status,
        notice: status === "DONE" ? fixed.doneNotice : fixed.pendingNotice,
        ...(status === "CANCELLED" || status === "FATAL"
          ? { requestId }
          : {}),
      };
    },

    async readDocument(request) {
      assertLiveRequest(request, now);
      const response = await getWithBoundedRetry(
        request,
        `/documents/${encodeURIComponent(request.documentId)}`,
      );
      if (!response.ok) return throwReportsError(response);
      const payload = record(response.payload);
      const url = safeReportUrl(payload?.url);
      if (!payload || !url) {
        throw new SpApiError("Amazon 報表下載網址未通過安全檢查。", {
          status: 502,
          code: "REPORT_DOWNLOAD_FAILED",
          requestId: response.headers.get("x-amzn-requestid"),
        });
      }
      const compression = payload.compressionAlgorithm;
      if (
        compression !== undefined &&
        compression !== null &&
        compression !== "GZIP"
      ) {
        throw new SpApiError("Amazon 報表壓縮格式無法安全辨識。", {
          status: 502,
          code: "REPORT_DOWNLOAD_FAILED",
          requestId: response.headers.get("x-amzn-requestid"),
        });
      }
      const compressed = await downloadSignedDocument(request, url);
      assertNotAborted(request.signal);
      let decoded = compressed;
      if (compression === "GZIP") {
        if (typeof DecompressionStream === "undefined") {
          throw new SpApiError("目前執行環境無法解壓 Amazon 報表。", {
            status: 500,
            code: "REPORT_DOWNLOAD_FAILED",
          });
        }
        const stream = new Response(Uint8Array.from(compressed).buffer).body?.pipeThrough(
          new DecompressionStream("gzip"),
        );
        if (!stream) {
          throw new SpApiError("Amazon 報表文件內容為空。", {
            status: 502,
            code: "REPORT_DOWNLOAD_FAILED",
          });
        }
        try {
          decoded = await readResponseWithLimit(
            new Response(stream),
            MAX_REPORT_DECOMPRESSED_BYTES,
            request.signal,
          );
        } catch (error) {
          assertNotAborted(request.signal);
          if (error instanceof SpApiError) throw error;
          throw new SpApiError("Amazon 報表解壓失敗。", {
            status: 502,
            code: "REPORT_DOWNLOAD_FAILED",
          });
        }
      }
      assertNotAborted(request.signal);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
      } catch {
        throw new SpApiError("Amazon 報表文字編碼無法安全辨識。", {
          status: 502,
          code: "REPORT_DOWNLOAD_FAILED",
        });
      }
      return {
        identity: identity(request),
        reportId: request.reportId,
        documentId: request.documentId,
        text,
      };
    },
  };

  return adapter;
}
