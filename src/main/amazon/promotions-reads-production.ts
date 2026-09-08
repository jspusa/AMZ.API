import { marketplaceById, type MarketplaceRegion } from "../../shared/marketplaces";
import { abortableDelay, forwardAbort, throwIfAborted, waitForPromiseWithSignal } from "../abort-utils";
import type { PromotionDetailPlan, PromotionSelectionPlan, PromotionsReadAdapter, PromotionsReadPlan, PromotionsSearchPlan } from "./promotions-reads";
import { publicSpApiRequestId, SpApiError } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

// Fixed semantics from Amazon Models 3659f968; see pinned research notes.
const ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com", eu: "https://sellingpartnerapi-eu.amazon.com", fe: "https://sellingpartnerapi-fe.amazon.com",
};
const BASE_PATH = "/promotions/2025-12-01/promotions";
const BODY_LIMIT = 16 * 1024 * 1024;
export type PromotionsReadProductionDependencies = Readonly<{
  getAccessToken(region: MarketplaceRegion, forceRefresh: boolean): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}>;

function marketplace(plan: PromotionsReadPlan) {
  const found = marketplaceById(plan.context.marketplaceId);
  if (!found || found.region !== plan.context.region || plan.context.mode !== "live") throw new SpApiError("促銷同步的站點或模式不一致。", { status: 409, code: "SP_CONTEXT_INVALIDATED" });
  return found;
}
function id(value: string): string {
  if (!value || value.length > 256 || value !== value.trim() || /[\u0000-\u0020\u007f]/u.test(value) || value === "." || value === "..") throw new SpApiError("促銷識別資料不完整。", { status: 400, code: "INVALID_REQUEST" });
  return encodeURIComponent(value);
}
function searchUrl(input: PromotionsSearchPlan): URL {
  const found = marketplace(input);
  const url = new URL(BASE_PATH, ENDPOINTS[found.region]);
  url.search = new URLSearchParams({ marketplaceIds: found.id, locale: found.locale.replace("-", "_"), revision: "ANY", limit: "100", includedData: "ISSUES", ...(input.paginationToken ? { paginationToken: input.paginationToken } : {}) }).toString();
  return url;
}
function detailUrl(input: PromotionDetailPlan): URL {
  const found = marketplace(input);
  const url = new URL(`${BASE_PATH}/${id(input.promotionId)}`, ENDPOINTS[found.region]);
  url.search = new URLSearchParams({ locale: found.locale.replace("-", "_"), includedData: "ISSUES,SELECTION" }).toString();
  return url;
}
function selectionUrl(input: PromotionSelectionPlan): URL {
  const found = marketplace(input);
  if (!Number.isSafeInteger(input.revisionId) || input.revisionId < 1) throw new SpApiError("促銷修訂資料不完整。", { status: 400, code: "INVALID_REQUEST" });
  const url = new URL(`${BASE_PATH}/${id(input.promotionId)}/selections/${id(input.selectionId)}`, ENDPOINTS[found.region]);
  url.search = new URLSearchParams({ locale: found.locale.replace("-", "_"), revisionId: String(input.revisionId), includedData: "ISSUES", limit: "100", ...(input.paginationToken ? { paginationToken: input.paginationToken } : {}) }).toString();
  return url;
}
function unavailable(message = "Amazon 促銷目前無法讀取。", status = 502): SpApiError {
  return new SpApiError(message, { status, code: "UPSTREAM_UNAVAILABLE" });
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if ((declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > BODY_LIMIT)) || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    void response.body?.cancel().catch(() => undefined);
    throw unavailable("Amazon 促銷回應格式或大小超出安全限制。");
  }
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await waitForPromiseWithSignal(reader.read(), signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > BODY_LIMIT) throw unavailable("Amazon 促銷回應超出安全大小上限。");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw unavailable("Amazon 促銷回應不是有效 JSON。"); }
  } finally { void reader.cancel().catch(() => undefined); }
}

export function createPromotionsReadProductionAdapter(dependencies: PromotionsReadProductionDependencies): PromotionsReadAdapter {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? abortableDelay;
  // This queue is adapter-lifetime state, never cleared on credential/context changes.
  let tail: Promise<void> = Promise.resolve();
  let nextAt = 0;
  async function physicalRead(input: PromotionsReadPlan, url: URL, refresh: boolean): Promise<unknown> {
    throwIfAborted(input.signal);
    await input.assertCurrent();
    if (nextAt > now().getTime()) await sleep(nextAt - now().getTime(), input.signal);
    await input.assertCurrent();
    throwIfAborted(input.signal);
    const token = await waitForPromiseWithSignal(dependencies.getAccessToken(marketplace(input).region, refresh), input.signal);
    await input.assertCurrent();
    throwIfAborted(input.signal);
    const controller = new AbortController();
    const stopForwarding = forwardAbort(controller, input.signal);
    const timer = setTimeout(() => controller.abort(unavailable("Amazon 促銷回應逾時。", 504)), 12_000);
    try {
      const response = await waitForPromiseWithSignal(fetcher(url, { method: "GET", headers: { accept: "application/json", "x-amz-access-token": token, "user-agent": spApiUserAgent() }, cache: "no-store", redirect: "error", signal: controller.signal }), controller.signal);
      await input.assertCurrent();
      throwIfAborted(controller.signal);
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        const rawDelay = response.headers.get("retry-after");
        const parsedDate = rawDelay ? Date.parse(rawDelay) : NaN;
        const delay = rawDelay && /^\d+(?:\.\d+)?$/u.test(rawDelay) ? Number(rawDelay) * 1000
          : rawDelay && Number.isFinite(parsedDate) && new Date(parsedDate).toUTCString() === rawDelay ? Math.max(0, parsedDate - now().getTime()) : NaN;
        const safeDelay = Number.isFinite(delay) && delay >= 0 && delay <= 25 * 60 * 1000;
        if (response.status === 429 && safeDelay) nextAt = Math.max(nextAt, now().getTime() + delay);
        throw new SpApiError(response.status === 403 ? "Amazon 促銷讀取權限不足；請核對 App 角色與授權。" : "Amazon 促銷目前無法讀取。", { status: response.status >= 400 ? response.status : 502, code: response.status === 403 ? "ACCESS_DENIED" : "UPSTREAM_UNAVAILABLE", requestId: publicSpApiRequestId(response.headers.get("x-amzn-requestid")), retryAfter: safeDelay ? rawDelay : null });
      }
      const result = await json(response, controller.signal);
      await input.assertCurrent();
      throwIfAborted(controller.signal);
      return result;
    } catch (error) {
      await input.assertCurrent();
      throwIfAborted(input.signal);
      if (error instanceof SpApiError) throw error;
      throw unavailable();
    } finally {
      nextAt = Math.max(nextAt, now().getTime() + 1050);
      clearTimeout(timer);
      stopForwarding();
    }
  }
  function queuedRead(input: PromotionsReadPlan, url: URL, refresh: boolean): Promise<unknown> {
    const turn = tail.then(() => physicalRead(input, url, refresh));
    tail = turn.then(() => undefined, () => undefined);
    return waitForPromiseWithSignal(turn, input.signal);
  }
  async function read(input: PromotionsReadPlan, url: URL): Promise<unknown> {
    try { return await queuedRead(input, url, false); }
    catch (error) {
      await input.assertCurrent();
      throwIfAborted(input.signal);
      if (!(error instanceof SpApiError) || error.status !== 401) throw error;
      dependencies.invalidateAccessToken(marketplace(input).region);
      return queuedRead(input, url, true);
    }
  }
  return { searchPromotions: (input) => read(input, searchUrl(input)), getPromotion: (input) => read(input, detailUrl(input)), getSelection: (input) => read(input, selectionUrl(input)) };
}
