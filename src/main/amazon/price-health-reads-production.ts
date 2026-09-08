import { marketplaceById, type MarketplaceRegion } from "../../shared/marketplaces";
import { abortableDelay, forwardAbort, throwIfAborted, waitForPromiseWithSignal } from "../abort-utils";
import type { PriceHealthReadAdapter } from "./price-health-reads";
import { SpApiError } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

const ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const URI = "/products/pricing/2022-05-01/items/competitiveSummary";
const MAX_BYTES = 16 * 1024 * 1024;

function unavailable(message: string, status = 502): SpApiError {
  return new SpApiError(message, { status, code: "PRICE_HEALTH_UNAVAILABLE" });
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw unavailable("Amazon 價格回應超過安全大小上限。");
  }
  if (!response.body) throw unavailable("Amazon 價格回應缺少資料。");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const chunk = await waitForPromiseWithSignal(reader.read(), signal);
      throwIfAborted(signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BYTES) { cancel(); throw unavailable("Amazon 價格回應超過安全大小上限。"); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw unavailable("Amazon 價格回應不是有效 JSON。"); }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export type PriceHealthReadProductionDependencies = Readonly<{
  getAccessToken(region: MarketplaceRegion, forceRefresh: boolean): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  getSellerId(region: MarketplaceRegion): string | null;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  userAgent?: () => string;
}>;

/** Specification reference: Amazon Models
 * 3659f96867bfc669aca7a524c2f95744ff0e4478, Product Pricing 2022-05-01.
 * Original implementation against the pinned schema, not copied SDK code.
 * Only a semantic read POST, never a configurable batch transport or price write.
 */
export function createPriceHealthReadProductionAdapter(
  dependencies: PriceHealthReadProductionDependencies,
): PriceHealthReadAdapter {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? abortableDelay;
  let tail = Promise.resolve();
  let nextStartAt = 0;
  return {
    async readCompetitiveSummary(plan) {
      throwIfAborted(plan.signal);
      const marketplace = marketplaceById(plan.context.marketplaceId);
      if (!marketplace || marketplace.region !== plan.context.region || plan.context.mode !== "live" ||
        !Array.isArray(plan.asins) || plan.asins.length < 1 || plan.asins.length > 20 ||
        plan.asins.some(asin => typeof asin !== "string" || !/^[A-Z0-9]{10}$/u.test(asin)) || new Set(plan.asins).size !== plan.asins.length) {
        throw new SpApiError("價格讀取缺少有效商品或站點。", { status: 400, code: "INVALID_INPUT" });
      }
      plan = { context: plan.context, asins: [...plan.asins], signal: plan.signal, beforeDispatch: plan.beforeDispatch };
      const turn = tail.then(async () => {
        throwIfAborted(plan.signal);
        const remaining = nextStartAt - now().getTime();
        if (remaining > 0) await sleep(remaining, plan.signal);
        throwIfAborted(plan.signal);
        await plan.beforeDispatch();
        throwIfAborted(plan.signal);
        const token = await waitForPromiseWithSignal(dependencies.getAccessToken(marketplace.region, false), plan.signal);
        throwIfAborted(plan.signal);
        await plan.beforeDispatch();
        throwIfAborted(plan.signal);
        const ownSellerId = dependencies.getSellerId(marketplace.region);
        const controller = new AbortController();
        const stopForward = forwardAbort(controller, plan.signal);
        const deadline = setTimeout(() => controller.abort(unavailable("Amazon 價格資料讀取逾時。", 504)), 12_000);
        try {
          const pendingResponse = fetcher(`${ENDPOINTS[marketplace.region]}/batches${URI}`, {
            method: "POST", cache: "no-store", redirect: "error", signal: controller.signal,
            headers: {
              accept: "application/json", "content-type": "application/json",
              "x-amz-access-token": token, "user-agent": (dependencies.userAgent ?? spApiUserAgent)(),
              "x-amz-date": now().toISOString().replace(/[:-]|\.\d{3}/g, ""),
            },
            body: JSON.stringify({
              requests: plan.asins.map(asin => ({
                asin,
                marketplaceId: marketplace.id, method: "GET", uri: URI,
                includedData: ["featuredBuyingOptions", "referencePrices"],
              }))
            }),
          });
          void pendingResponse.then(response => {
            if (controller.signal.aborted && response.body && !response.bodyUsed) void response.body.cancel().catch(() => undefined);
          }, () => undefined);
          const response = await waitForPromiseWithSignal(pendingResponse, controller.signal);
          throwIfAborted(controller.signal);
          if (response.status !== 200) {
            const retry = response.headers.get("retry-after");
            const seconds = retry && /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) : NaN;
            const at = retry && new Date(Date.parse(retry)).toString() !== "Invalid Date" && new Date(Date.parse(retry)).toUTCString() === retry ? Date.parse(retry) : NaN;
            const delay = Number.isFinite(seconds) ? seconds * 1_000 : at - now().getTime();
            if (Number.isFinite(delay) && delay >= 0 && delay <= 25 * 60_000) nextStartAt = Math.max(nextStartAt, now().getTime() + delay);
            // Invalidate for a later explicit sync; this POST is never replayed,
            // including an authentication failure or an unknown network result.
            if (response.status === 401) dependencies.invalidateAccessToken(marketplace.region);
            if (response.body && !response.bodyUsed) void response.body.cancel().catch(() => undefined);
            throw new SpApiError(response.status === 401 || response.status === 403 ? "Amazon 價格讀取授權不足；請核對 Product Pricing 權限。" : "Amazon 價格資料暫時無法使用。", { status: response.status, code: "PRICE_HEALTH_UNAVAILABLE" });
          }
          return { payload: await boundedJson(response, controller.signal), ownSellerId };
        } catch (error) {
          throwIfAborted(plan.signal);
          if (error instanceof SpApiError) throw error;
          throwIfAborted(controller.signal);
          throw unavailable("目前無法連線至 Amazon 價格 API。");
        } finally {
          clearTimeout(deadline);
          stopForward();
          nextStartAt = Math.max(nextStartAt, now().getTime() + 31_000);
        }
      });
      tail = turn.then(() => undefined, () => undefined);
      return waitForPromiseWithSignal(turn, plan.signal);
    },
  };
}
