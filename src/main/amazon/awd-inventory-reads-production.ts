// First-party implementation from the pinned Amazon AWD 2024-05-09 contract.
// Specification provenance: docs/research/2026-09-08-amazon-operations-sources.md.
import type { MarketplaceRegion } from "../../shared/marketplaces";
import { abortableDelay, forwardAbort, throwIfAborted, waitForPromiseWithSignal } from "../abort-utils";
import type { AwdInventoryReadAdapter, AwdReadPageInput } from "./awd-inventory-reads";
import { publicSpApiRequestId, SpApiError } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

// One application-session quota for all AWD reads, including retries. Context
// invalidation deliberately cannot clear it. 1.05 s also covers shipment lists.
let quotaTail: Promise<void> = Promise.resolve();
let nextStartAt = 0;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_AUTOMATIC_RETRY_MS = 60_000;
const MAX_QUOTA_COOLDOWN_MS = 25 * 60_000;

function retryAfterDelay(value: string | null, now: number): number | null {
  if (value === null) return 0;
  if (!value || value.length > 64) return null;
  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null;
  }
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?:0[1-9]|[12]\d|3[01]) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d GMT$/u.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== value) return null;
  return Math.max(0, timestamp - now);
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredHeader = response.headers.get("content-length");
  const declared = declaredHeader === null ? null : Number(declaredHeader);
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" ||
      (declaredHeader !== null && (!/^\d+$/u.test(declaredHeader) || declaredHeader.length > 20 || !Number.isSafeInteger(declared)))) {
    void response.body?.cancel().catch(() => undefined);
    throw new SpApiError("AWD 回應標頭格式無法驗證。", { status: 502, code: "AWD_INVALID_RESPONSE" });
  }
  if (declared !== null && declared > MAX_BODY_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new SpApiError("AWD 回應超過安全大小上限。", { status: 502, code: "AWD_RESPONSE_TOO_LARGE" });
  }
  if (!response.body) throw new SpApiError("AWD 回應缺少資料。", { status: 502, code: "AWD_INVALID_RESPONSE" });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const part = await waitForPromiseWithSignal(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) throw new SpApiError("AWD 回應超過安全大小上限。", { status: 502, code: "AWD_RESPONSE_TOO_LARGE" });
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export function createAwdInventoryReadProductionAdapter(dependencies: Readonly<{
  getAccessToken(region: MarketplaceRegion): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
}>): AwdInventoryReadAdapter {
  const fetcher = globalThis.fetch;
  // Raw headers and retry authority remain main-private, including the
  // distinction between an absent header and an advertised invalid value.
  const retryDelays = new WeakMap<SpApiError, number | null>();
  async function attempt(input: AwdReadPageInput, path: string, query: URLSearchParams): Promise<unknown> {
    await input.assertCurrent();
    throwIfAborted(input.signal);
    if (input.context.mode !== "live" || input.context.marketplaceId !== "ATVPDKIKX0DER" || input.context.region !== "na") {
      throw new SpApiError("此 AWD 唯讀請求不在已支援的美國真實模式範圍。", { status: 400, code: "AWD_MARKETPLACE_UNSUPPORTED" });
    }
    if (input.nextToken !== undefined && (typeof input.nextToken !== "string" || !input.nextToken || input.nextToken.length > 4096 || /[\u0000-\u001f\u007f]/u.test(input.nextToken))) {
      throw new SpApiError("AWD 分頁識別值無法驗證。", { status: 400, code: "AWD_INVALID_INPUT" });
    }
    const turn = quotaTail.catch(() => undefined).then(async () => {
      await abortableDelay(Math.max(0, nextStartAt - Date.now()), input.signal);
      await input.assertCurrent();
      throwIfAborted(input.signal);
      const token = await waitForPromiseWithSignal(dependencies.getAccessToken("na"), input.signal);
      await input.assertCurrent();
      throwIfAborted(input.signal);
      nextStartAt = Date.now() + 1050;
      const controller = new AbortController();
      const stopForwardingAbort = forwardAbort(controller, input.signal);
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await waitForPromiseWithSignal(fetcher(new URL(`${path}?${query}`, "https://sellingpartnerapi-na.amazon.com"), {
          method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { accept: "application/json", "x-amz-access-token": token, "user-agent": spApiUserAgent() },
        }), controller.signal);
        await input.assertCurrent();
        throwIfAborted(input.signal);
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          const retryAfter = response.headers.get("retry-after");
          const delay = retryAfterDelay(retryAfter, Date.now());
          if ([429, 500, 503].includes(response.status) && delay !== null) {
            // A cooldown beyond the automatic retry budget still fences later
            // queued reads, without allowing unbounded server-controlled waits.
            nextStartAt = Math.max(nextStartAt, Date.now() + Math.min(delay, MAX_QUOTA_COOLDOWN_MS));
          }
          const error = new SpApiError(response.status === 401 || response.status === 403
            ? "Amazon 拒絕 AWD 讀取；請核對 Amazon Warehousing and Distribution 角色與帳號授權。"
            : "Amazon AWD 目前無法完成唯讀查詢。", {
            status: response.status,
            code: response.status === 401 || response.status === 403 ? "AWD_UNAUTHORIZED" : response.status === 429 ? "RATE_LIMITED" : "AWD_UPSTREAM_UNAVAILABLE",
            requestId: publicSpApiRequestId(response.headers.get("x-amzn-requestid")),
            retryAfter: delay !== null ? retryAfter : null,
          });
          retryDelays.set(error, delay !== null && delay <= MAX_AUTOMATIC_RETRY_MS ? delay : null);
          throw error;
        }
        if (response.status !== 200 || response.redirected) {
          void response.body?.cancel().catch(() => undefined);
          throw new SpApiError("AWD 回應不是完整的預期讀取結果。", { status: 502, code: "AWD_INVALID_RESPONSE" });
        }
        const payload = await boundedJson(response, controller.signal);
        await input.assertCurrent();
        throwIfAborted(input.signal);
        return payload;
      } catch (error) {
        await input.assertCurrent();
        throwIfAborted(input.signal);
        if (controller.signal.aborted) throw new SpApiError("AWD 回應逾時，已停止這次讀取。", { status: 504, code: "AWD_UPSTREAM_UNAVAILABLE" });
        if (error instanceof SpApiError) throw error;
        throw new SpApiError("AWD 回應無法安全讀取或驗證。", { status: 502, code: "AWD_INVALID_RESPONSE" });
      } finally {
        clearTimeout(timeout);
        stopForwardingAbort();
      }
    });
    quotaTail = turn.then(() => undefined, () => undefined);
    return waitForPromiseWithSignal(turn, input.signal);
  }
  async function call(input: AwdReadPageInput, path: string, query: URLSearchParams): Promise<unknown> {
    let refreshed = false;
    let transientRetries = 0;
    for (;;) {
      try { return await attempt(input, path, query); }
      catch (error) {
        await input.assertCurrent();
        throwIfAborted(input.signal);
        if (error instanceof SpApiError && error.status === 401 && !refreshed) {
          refreshed = true;
          dependencies.invalidateAccessToken("na");
          continue;
        }
        const retryDelay = error instanceof SpApiError ? retryDelays.get(error) : null;
        if (error instanceof SpApiError && [429, 500, 503].includes(error.status) && transientRetries < 2 && retryDelay !== undefined && retryDelay !== null) {
          transientRetries++;
          await abortableDelay(Math.max(1050 * transientRetries, retryDelay), input.signal);
          continue;
        }
        throw error;
      }
    }
  }
  return {
    listInventory(input) {
      const query = new URLSearchParams({ details: "SHOW", maxResults: "200" });
      if (input.nextToken) query.set("nextToken", input.nextToken);
      return call(input, "/awd/2024-05-09/inventory", query);
    },
    listInboundShipments(input) {
      const query = new URLSearchParams({ sortBy: "UPDATED_AT", sortOrder: "DESCENDING", maxResults: "100" });
      if (input.nextToken) query.set("nextToken", input.nextToken);
      return call(input, "/awd/2024-05-09/inboundShipments", query);
    },
    async getInboundShipment(input) {
      if (typeof input.shipmentId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.shipmentId)) throw new SpApiError("AWD 貨件識別值無法驗證。", { status: 400, code: "AWD_INVALID_INPUT" });
      return call(input, `/awd/2024-05-09/inboundShipments/${encodeURIComponent(input.shipmentId)}`, new URLSearchParams({ skuQuantities: "SHOW" }));
    },
  };
}
