import { randomUUID } from "node:crypto";
import type { AdvertisingStrategySnapshot } from "../shared/advertising-strategy";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { OperationsData, OperationsFbaIdentity, OperationsSource } from "../shared/operations-intelligence";
import type { AdvertisingCoordinatorPort } from "./advertising-read-coordinator";
import { abortableDelay, forwardAbort, waitForPromiseWithSignal } from "./abort-utils";
import type { AwdInventoryReads } from "./amazon/awd-inventory-reads";
import { buildAdvertisingDiagnostics } from "./amazon/advertising-diagnostics";
import type { FbaCatalogReports } from "./amazon/fba-catalog-reports";
import { marketplaceCalendar } from "./amazon/marketplace-calendar";
import type { OperationsReadInput } from "./amazon/operations-read-context";
import type { PriceHealthReads } from "./amazon/price-health-reads";
import type { PromotionsReads } from "./amazon/promotions-reads";
import { strictReportInstant } from "./amazon/revenue-report-windows";
import { publicSpApiError, SpApiError } from "./amazon/sp-api-error";
import type { SpExecutionContext, SpExecutionContextAdapter } from "./amazon/sp-execution-context";

export interface OperationsSourceReaders {
  fba(context: SpExecutionContext, signal: AbortSignal): Promise<readonly OperationsFbaIdentity[]>;
  read(source: OperationsSource, input: OperationsReadInput): Promise<OperationsData>;
}

type Dependencies = Readonly<{
  context: SpExecutionContextAdapter;
  catalog: FbaCatalogReports;
  promotions: Pick<PromotionsReads, "read">;
  awd: Pick<AwdInventoryReads, "read">;
  priceHealth: Pick<PriceHealthReads, "read">;
  advertising: Pick<AdvertisingCoordinatorPort, "startStrategy" | "observeStrategy">;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}>;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cancelled(): Error {
  const error = new Error("營運來源讀取已停止。");
  error.name = "AbortError";
  return error;
}

function safeError(error: unknown): SpApiError {
  const safe = publicSpApiError(error instanceof SpApiError ? error : new SpApiError("營運來源目前無法讀取。", { status: 502, code: "OPERATIONS_SOURCE_UNAVAILABLE" }), "營運來源目前無法讀取。");
  return new SpApiError(safe.message, { status: safe.status, code: safe.code, requestId: safe.requestId, retryAfter: safe.retryAfter });
}

const ADS_OBSERVATION_LIMIT_MS = 195 * 60 * 1_000;
function adsTimeout(): SpApiError {
  return new SpApiError("廣告報表仍在準備中，已停止本次觀察；不會自動重新建立。", { status: 504, code: "OPERATIONS_ADS_TIMEOUT" });
}

function readJob(response: ApiResponse, marketplaceId: string, range: { startDate: string; endDate: string }, jobId?: string) {
  const body = record(response.body.kind === "json" ? response.body.value : null);
  if (response.status !== 200 && response.status !== 202) {
    const safe = publicSpApiError(new SpApiError("廣告策略讀取未完成，請到廣告區核對授權與報表狀態。", { status: response.status, code: typeof body.code === "string" ? body.code : "OPERATIONS_ADS_UNAVAILABLE" }), "廣告策略讀取未完成。");
    throw new SpApiError(safe.message, { status: safe.status, code: safe.code });
  }
  const returnedRange = record(body.dateRange);
  if (body.schemaVersion !== 1 || body.marketplaceId !== marketplaceId ||
      returnedRange.startDate !== range.startDate || returnedRange.endDate !== range.endDate ||
      typeof body.jobId !== "string" || !/^[A-Za-z0-9._-]{1,120}$/u.test(body.jobId) ||
      (jobId !== undefined && body.jobId !== jobId) ||
      !["running", "completed", "failed"].includes(String(body.state)) ||
      (body.state === "running" ? response.status !== 202 : response.status !== 200)) {
    throw new SpApiError("廣告策略工作與本次來源同步不一致。", { status: 409, code: "OPERATIONS_ADS_JOB_MISMATCH" });
  }
  if (body.state === "failed") {
    const safe = publicSpApiError(new SpApiError("廣告策略報表未完成；不會自動重新建立。", { status: 502, code: typeof body.errorCode === "string" ? body.errorCode : "OPERATIONS_ADS_UNAVAILABLE" }), "廣告策略報表未完成。");
    throw new SpApiError(safe.message, { status: safe.status, code: safe.code });
  }
  return { jobId: body.jobId, state: body.state as "running" | "completed", snapshot: body.snapshot };
}

/** Composition only: the existing catalog and Ads owners retain all report capabilities. */
export function createOperationsSourceReaders(dependencies: Dependencies): OperationsSourceReaders {
  const wait = dependencies.wait ?? abortableDelay;
  const now = dependencies.now ?? Date.now;
  const guarded = async <T>(context: SpExecutionContext, signal: AbortSignal, operation: () => Promise<T>): Promise<T> => {
    try {
      await dependencies.context.assertCurrent(context);
      if (signal.aborted) throw cancelled();
      const result = await waitForPromiseWithSignal(operation(), signal);
      await dependencies.context.assertCurrent(context);
      if (signal.aborted) throw cancelled();
      return result;
    } catch (error) {
      try { await dependencies.context.assertCurrent(context); } catch (fence) { throw safeError(fence); }
      if (error instanceof SpApiError && error.status === 409) throw safeError(error);
      if (signal.aborted) throw cancelled();
      throw safeError(error);
    }
  };
  const advertising = async (input: OperationsReadInput, deadline: number): Promise<OperationsData> => {
    await dependencies.context.assertCurrent(input.context);
    const calendar = marketplaceCalendar(input.context.marketplaceId);
    const endDate = calendar.shiftDate(calendar.dayAt(new Date(now())), -1);
    const range = { startDate: calendar.shiftDate(endDate, -29), endDate };
    const request: ApiRequest = { requestId: randomUUID(), method: "POST", path: "/api/amazon-ads/strategy", headers: {}, query: {}, body: { kind: "json", value: { marketplaceId: input.context.marketplaceId, ...range, refresh: false, explicitRetry: false } } };
    const active = (): void => {
      if (now() >= deadline) throw adsTimeout();
      if (input.signal.aborted) throw cancelled();
    };
    active();
    let job = readJob(await guarded(input.context, input.signal, () => dependencies.advertising.startStrategy(request)), input.context.marketplaceId, range);
    for (let attempt = 0; job.state === "running" && attempt < 780; attempt += 1) {
      await wait(Math.min(15_000, Math.max(0, deadline - now())), input.signal);
      await dependencies.context.assertCurrent(input.context);
      active();
      job = readJob(await guarded(input.context, input.signal, () => dependencies.advertising.observeStrategy({ requestId: randomUUID(), method: "GET", path: "/api/amazon-ads/strategy", headers: {}, query: { marketplaceId: input.context.marketplaceId, jobId: job.jobId, ...range } })), input.context.marketplaceId, range, job.jobId);
    }
    await dependencies.context.assertCurrent(input.context);
    active();
    if (job.state !== "completed") throw adsTimeout();
    const snapshot = record(job.snapshot);
    if (snapshot.marketplaceId !== input.context.marketplaceId || record(snapshot.dateRange).startDate !== range.startDate || record(snapshot.dateRange).endDate !== range.endDate || !Array.isArray(snapshot.rows) || snapshot.rows.length > 5_000) {
      throw new SpApiError("廣告策略快照與本次來源同步不一致。", { status: 409, code: "OPERATIONS_ADS_JOB_MISMATCH" });
    }
    return buildAdvertisingDiagnostics(job.snapshot as AdvertisingStrategySnapshot, input.context.mode);
  };
  const boundedAdvertising = async (input: OperationsReadInput): Promise<OperationsData> => {
    const controller = new AbortController();
    const detach = forwardAbort(controller, input.signal);
    const timer = setTimeout(() => controller.abort(adsTimeout()), ADS_OBSERVATION_LIMIT_MS);
    timer.unref?.();
    try {
      return await guarded(input.context, controller.signal, () => advertising({ ...input, signal: controller.signal }, now() + ADS_OBSERVATION_LIMIT_MS));
    } catch (error) {
      if (error instanceof SpApiError && error.status === 409) throw error;
      if (!input.signal.aborted && controller.signal.reason instanceof SpApiError && controller.signal.reason.code === "OPERATIONS_ADS_TIMEOUT") throw adsTimeout();
      throw error;
    } finally { clearTimeout(timer); detach(); }
  };
  return {
    fba(context, signal) {
      return guarded(context, signal, async () => {
        let receipt = await dependencies.catalog.begin({ purpose: "catalog", marketplaceId: context.marketplaceId, explicitRetry: false, signal, expectedContext: context });
        for (let attempt = 0; !receipt.ready && attempt < 180; attempt += 1) {
          await wait(1_000, signal);
          receipt = await dependencies.catalog.status({ marketplaceId: context.marketplaceId, reportId: receipt.reportId, signal, expectedContext: context });
        }
        if (!receipt.ready || !receipt.documentId) throw new SpApiError("FBA 商品身分報表仍在準備中。", { status: 504, code: "REPORT_PENDING" });
        const snapshot = await dependencies.catalog.read({ view: "identity", marketplaceId: context.marketplaceId, reportId: receipt.reportId, documentId: receipt.documentId, signal, expectedContext: context });
        if (receipt.mode !== context.mode || snapshot.mode !== context.mode || snapshot.marketplaceId !== context.marketplaceId) {
          throw new SpApiError("FBA 商品身分與本次來源同步不一致。", { status: 409, code: "SP_CONTEXT_INVALIDATED" });
        }
        // This is the catalog owner's document observation time, never a claim
        // about when Amazon generated its underlying report. The broker owns
        // bounded completed-report retention and no-blind-retry replacement.
        const observedAt = strictReportInstant(snapshot.fetchedAt);
        if (observedAt === null || observedAt > now() + 1_000 || now() - observedAt > 60 * 60 * 1_000) {
          throw new SpApiError("FBA 商品身分的資料觀察時間無法核對，請重新同步。", { status: 409, code: "OPERATIONS_FBA_EVIDENCE_STALE" });
        }
        const seen = new Set<string>();
        if (snapshot.rows.length > 5_000 || snapshot.rows.some(({ sellerSku, asin }) => {
          const invalid = typeof sellerSku !== "string" || !sellerSku || sellerSku.length > 40 || sellerSku !== sellerSku.trim() || /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u.test(sellerSku) || typeof asin !== "string" || !/^[A-Z0-9]{10}$/u.test(asin) || seen.has(sellerSku);
          seen.add(sellerSku);
          return invalid;
        })) throw new SpApiError("FBA 商品身分無法唯一核對，或超過營運同步的安全範圍。", { status: 422, code: "OPERATIONS_FBA_IDENTITY_INVALID" });
        return Object.freeze(snapshot.rows.map(({ sellerSku, asin }) => Object.freeze({ sellerSku, asin })));
      });
    },
    read(source, input) {
      return guarded(input.context, input.signal, async () => {
        if (source === "promotions") return dependencies.promotions.read(input);
        if (source === "awd") return dependencies.awd.read(input);
        if (source === "price-health") return dependencies.priceHealth.read(input);
        if (source === "advertising") return boundedAdvertising(input);
        throw new SpApiError("營運來源尚未就緒。", { status: 503, code: "OPERATIONS_SOURCE_UNAVAILABLE" });
      });
    },
  };
}
