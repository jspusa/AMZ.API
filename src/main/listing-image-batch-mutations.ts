import { createHash, randomUUID } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  LISTING_IMAGE_BATCH_MAX_IMAGES_PER_SKU, LISTING_IMAGE_BATCH_MAX_SKUS,
  type ListingImageBatchCapabilities, type ListingImageBatchRow, type ListingImageBatchRowInput,
  type ListingImageBatchSnapshot,
} from "../shared/listing-image-batch";
import { marketplaceById } from "../shared/marketplaces";
import { SpExecutionContextError, type SpExecutionContext, type SpExecutionContextAdapter } from "./amazon/sp-execution-context";
import type { ListingImageUpdateResult } from "./amazon/listing-image-types";
import { analyzeImageReadback, reconcileImageWrite, recoverableImageWrite, isSimulatedImageWrite, type ListingImageMutationOperations } from "./listing-image-mutations";
import { MainWriteGateError, type MainWriteGatePort, type WriteBinding } from "./write-gate";
import { publicSpApiError, publicSpApiRequestId, SpApiError, SpApiPreCommitError } from "./amazon/sp-api-error";
import { abortableDelay } from "./abort-utils";
import { ListingWriteAcceptedButPendingError } from "./amazon/listing-write-readback";
import { bodyRecord, isPlainRecord, parseMarketplace, parseSellerSku } from "./route-input";
import { invalid, json, routeError } from "./route-response";
import { LISTING_IMAGE_MIN_VALIDITY_MS } from "../shared/listing-image-retention";

export type ListingImageBatchCommand = Readonly<{
  operation: "capabilities" | "preview" | "commit" | "observe" | "recover";
  request: ApiRequest;
}>;

export interface ListingImageBatchMutationsPort {
  handle(command: ListingImageBatchCommand): Promise<ApiResponse>;
  clear(): void;
}

export type ListingImageBatchDependencies = Readonly<{
  context: Pick<SpExecutionContextAdapter, "capture" | "assertCurrent">;
  writeGate: MainWriteGatePort;
  operations: ListingImageMutationOperations;
  assertPreparedImageUrls(input: Readonly<{ urls: readonly (string | null)[]; context: SpExecutionContext; sellerSku: string }>): Promise<number>;
  now?: () => number;
  uuid?: () => string;
  readbackDelaysMs?: readonly number[];
}>;

type BoundInput = Parameters<ListingImageMutationOperations["preview"]>[0];
type PlanRow = { public: ListingImageBatchRow; input: BoundInput; preview: ListingImageUpdateResult | null; accepted?: ListingImageUpdateResult };
type BatchPlan = {
  batchId: string; reviewToken: string; context: SpExecutionContext; expiresAt: number;
  phase: ListingImageBatchSnapshot["phase"]; rows: PlanRow[]; message: string | null;
  lastReadbackAt: string | null;
};
const PREVIEW_TTL_MS = 15 * 60_000;
const TERMINAL_TTL_MS = 24 * 60 * 60_000;
const ISOLATED_PREVIEW_CODES = new Set([
  "FBA_ONLY", "LISTING_NOT_FOUND", "SKU_NOT_FOUND", "LISTING_IDENTITY_MISMATCH", "LISTING_ATTRIBUTES_UNAVAILABLE",
  "LISTING_IMAGE_EVIDENCE_AMBIGUOUS", "STALE_LISTING", "INVALID_IMAGE_URL", "MAIN_IMAGE_REQUIRED", "DUPLICATE_IMAGE_URL",
  "NO_CHANGES", "IMAGE_FIELD_READ_ONLY", "VALIDATION_FAILED", "IMAGE_PREPARATION_EXPIRED", "IMAGE_PREPARATION_REQUIRED",
]);
function isolatedPreviewFailure(error: unknown): error is SpApiError {
  return error instanceof SpApiError && !(error instanceof SpExecutionContextError) && error.status < 500
    && ![401, 403, 429].includes(error.status) && ISOLATED_PREVIEW_CODES.has(error.code);
}
const capabilities: ListingImageBatchCapabilities = Object.freeze({
  capability: "listing-image-batch-v1", maxSkus: 30, maxImagesPerSku: 10, replacementMode: "complete", confirmationMode: "native", readbackRecovery: "exact-sku-v1",
});

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function parseRows(value: unknown): ListingImageBatchRowInput[] | null {
  if (!Array.isArray(value) || !value.length || value.length > LISTING_IMAGE_BATCH_MAX_SKUS) return null;
  const seen = new Set<string>();
  const rows: ListingImageBatchRowInput[] = [];
  for (const row of value) {
    if (!isPlainRecord(row) || !exactKeys(row, ["sellerSku", "urls"])) return null;
    const sellerSku = parseSellerSku(row.sellerSku);
    if (!sellerSku || sellerSku !== row.sellerSku || seen.has(sellerSku) || !Array.isArray(row.urls)
      || row.urls.length !== LISTING_IMAGE_BATCH_MAX_IMAGES_PER_SKU) return null;
    const urls: Array<string | null> = [];
    for (const url of row.urls) {
      if (url === null) { urls.push(null); continue; }
      if (typeof url !== "string" || url !== url.trim() || !url || url.length > 2_000 || /[\u0000-\u001f\u007f]/u.test(url)) return null;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return null;
      } catch { return null; }
      urls.push(url);
    }
    if (!urls[0] || new Set(urls.filter(Boolean)).size !== urls.filter(Boolean).length) return null;
    const firstEmpty = urls.indexOf(null);
    if (firstEmpty >= 0 && urls.slice(firstEmpty).some(url => url !== null)) return null;
    seen.add(sellerSku);
    rows.push({ sellerSku, urls });
  }
  return rows;
}

/** Owns a bounded exact image-replacement plan; no raw transport or renderer identity evidence. */
export class ListingImageBatchMutations implements ListingImageBatchMutationsPort {
  private readonly plans = new Map<string, BatchPlan>();
  private revision = 0;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly controllers = new Set<AbortController>();
  private building = false;

  constructor(private readonly deps: ListingImageBatchDependencies) {
    this.now = deps.now ?? Date.now;
    this.uuid = deps.uuid ?? randomUUID;
  }

  clear(): void {
    this.revision += 1;
    this.plans.clear();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  async handle(command: ListingImageBatchCommand): Promise<ApiResponse> {
    if (command.operation === "capabilities") return json(capabilities);
    try {
      if (command.operation === "preview") return await this.preview(command.request);
      if (command.operation === "commit") return await this.commit(command.request);
      if (command.operation === "recover") return await this.recover(command.request);
      return await this.observe(command.request);
    } catch (error) {
      return error instanceof MainWriteGateError ? invalid(error.message, error.status, error.code)
        : routeError(error, "圖片批次處理已停止；尚未確認的操作不可重新送出。");
    }
  }

  private async fence(context: SpExecutionContext, revision: number): Promise<void> {
    await this.deps.context.assertCurrent(context);
    if (revision !== this.revision) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "Amazon 執行環境已更新；請重新開始圖片批次。");
  }

  private async preparedExpiry(row: BoundInput, context: SpExecutionContext, revision: number): Promise<number> {
    const expiry = await this.deps.assertPreparedImageUrls({urls:row.urls, sellerSku:row.sellerSku, context});
    await this.fence(context, revision);
    if (!Number.isSafeInteger(expiry) || expiry <= this.now() + LISTING_IMAGE_MIN_VALIDITY_MS) {
      throw new SpApiError("圖片暫存期限不足十分鐘；請重新準備原始圖片。", {status:409,code:"IMAGE_PREPARATION_EXPIRED"});
    }
    return expiry;
  }

  private snapshot(plan: BatchPlan): ListingImageBatchSnapshot {
    const rows = plan.rows.map(row => structuredClone(row.public));
    return {
      ...capabilities, batchId: plan.batchId, reviewToken: plan.reviewToken, marketplaceId: plan.context.marketplaceId,
      mode: plan.context.mode, phase: plan.phase, lastReadbackAt: plan.lastReadbackAt, expiresAt: new Date(plan.expiresAt).toISOString(), rows, message: plan.message,
      totals: { skus: rows.length, ready: rows.filter(row => row.state === "ready").length,
        blocked: rows.filter(row => row.state === "blocked").length, unchanged: rows.filter(row => row.state === "unchanged").length,
        submitted: rows.filter(row => ["accepted", "verified", "unknown", "rejected", "simulated"].includes(row.state)).length,
        accepted: rows.filter(row => row.acceptedAt !== null).length, verified: rows.filter(row => row.state === "verified").length,
        deletedSlots: rows.filter(row => !["blocked", "unchanged"].includes(row.state)).reduce((total, row) => total + row.deletedSlots.length, 0) },
    };
  }

  private async preview(request: ApiRequest): Promise<ApiResponse> {
    if (this.building || [...this.plans.values()].some(plan => !["ready", "completed", "stopped"].includes(plan.phase))) {
      return invalid("圖片批次正在處理，請等待目前工作完成。", 409, "OPERATION_IN_PROGRESS");
    }
    this.building = true;
    try { return await this.buildPreview(request); }
    finally { this.building = false; }
  }

  private async buildPreview(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    const rows = parseRows(body?.rows);
    if (!body || !exactKeys(body, ["marketplaceId", "replacementMode", "rows"]) || !marketplaceId || !rows || body.replacementMode !== "complete") {
      return invalid("請提供 1–30 個不同的完整 SKU，每個 SKU 需有主圖與十個明確圖片位置。", 400, "INVALID_IMAGE_BATCH");
    }
    const revision = this.revision;
    const context = await this.deps.context.capture(marketplaceId);
    await this.fence(context, revision);
    // An explicit new preview supersedes the previous uncommitted review.
    for (const [id, plan] of this.plans) {
      if (plan.expiresAt <= this.now() || (plan.phase === "ready" && plan.context.accountScope === context.accountScope
        && plan.context.marketplaceId === marketplaceId && plan.context.mode === context.mode)) this.plans.delete(id);
    }
    while (this.plans.size >= 4) this.plans.delete(this.plans.keys().next().value!);
    const plan: BatchPlan = { batchId: `image-batch.${this.uuid()}`, reviewToken: `image-review.${this.uuid()}`, context,
      expiresAt: this.now() + PREVIEW_TTL_MS, phase: "ready", rows: [], message: null, lastReadbackAt: null };
    for (const row of rows) {
      const pending: PlanRow = { input: { marketplaceId, sellerSku: row.sellerSku, expectedUrls: Array<null>(10).fill(null), urls: [...row.urls] }, preview: null,
        public: { sellerSku: row.sellerSku, asin: null, title: "", previousUrls: Array<null>(10).fill(null), requestedUrls: [...row.urls], changedSlots: [], deletedSlots: [],
          state: "blocked", code: null, message: null, requestId: null, acceptedAt: null } };
      try {
        await this.preparedExpiry(pending.input, context, revision);
        await this.fence(context, revision);
        const observation = await this.deps.operations.read({ marketplaceId, sellerSku: row.sellerSku });
        await this.fence(context, revision);
        await this.deps.writeGate.reconcile({ context, marketplaceId, sellerSku: row.sellerSku, operations: ["images"], requireCurrent: true,
          snapshot: observation, project: (result, _operation, canonical) => reconcileImageWrite(result, canonical) });
        await this.fence(context, revision);
        const snapshot = observation.snapshot;
        if (snapshot.mode !== context.mode || snapshot.marketplaceId !== context.marketplaceId) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "圖片讀取結果不屬於目前帳號或站點。");
        const input: BoundInput = { marketplaceId, sellerSku: row.sellerSku, expectedUrls: snapshot.images.map(image => image.url), urls: [...row.urls],
          expectedImageIdentity: { asin: snapshot.asin!, productType: snapshot.productType } };
        const changedSlots = row.urls.flatMap((url, index) => url === input.expectedUrls[index] ? [] : [index + 1]);
        const deletedSlots = changedSlots.filter(slot => input.expectedUrls[slot - 1] && row.urls[slot - 1] === null);
        pending.input = input;
        pending.public = { ...pending.public, asin: snapshot.asin, title: snapshot.title,
          previousUrls: input.expectedUrls, requestedUrls: input.urls, changedSlots, deletedSlots, state: changedSlots.length ? "ready" : "unchanged" };
        if (changedSlots.length) {
          pending.preview = await this.deps.operations.preview(input);
          await this.fence(context, revision);
          this.assertResult(pending.preview, pending, context.mode, true);
        }
      } catch (error) {
        await this.fence(context, revision);
        if (!isolatedPreviewFailure(error)) throw error;
        const publicError = publicSpApiError(error, "此 SKU 未通過圖片預檢，沒有寫入 Amazon。");
        pending.public = { ...pending.public, state: error.code === "NO_CHANGES" ? "unchanged" : "blocked",
          code: publicError.code, message: publicError.message, requestId: publicError.requestId };
      }
      plan.rows.push(pending);
    }
    await this.fence(context, revision);
    const sourceExpiry = await this.recheckReadySources(plan, revision);
    plan.expiresAt = Math.min(this.now() + PREVIEW_TTL_MS, sourceExpiry - LISTING_IMAGE_MIN_VALIDITY_MS);
    if (plan.rows.some(row => row.public.state === "ready")) await this.deps.writeGate.stagePreview(this.binding(plan));
    await this.fence(context, revision);
    this.plans.set(plan.batchId, plan);
    return json(this.snapshot(plan));
  }

  private async recheckReadySources(plan: BatchPlan, revision: number): Promise<number> {
    let earliest = Infinity;
    for (const row of plan.rows.filter(row => row.public.state === "ready")) {
      try { earliest = Math.min(earliest, await this.preparedExpiry(row.input, plan.context, revision)); }
      catch (error) {
        await this.fence(plan.context, revision);
        if (!isolatedPreviewFailure(error)) throw error;
        const failure = publicSpApiError(error, "圖片準備已失效，尚未送出 Amazon。");
        row.public = {...row.public, state:"blocked", code:failure.code, message:failure.message, requestId:failure.requestId};
      }
    }
    return earliest;
  }

  private binding(plan: BatchPlan): WriteBinding {
    const intents = plan.rows.filter(row => row.public.state === "ready").map((row, index) => ({
      intentId: row.input.sellerSku, operation: "images" as const, marketplaceId: plan.context.marketplaceId,
      sellerSku: row.input.sellerSku, idempotencyKey: `${plan.batchId}-${index}`,
      proposalFingerprint: createHash("sha256").update(JSON.stringify(row.input)).digest("hex"),
    }));
    if (!intents.length) throw new SpApiError("沒有可送出的圖片變更。", { status: 422, code: "NO_CHANGES" });
    return { family: "images-batch", previewKey: plan.batchId, context: plan.context, previewExpiresAt:plan.expiresAt, intents: [intents[0], ...intents.slice(1)] };
  }

  private async findPlan(request: ApiRequest, commit: boolean): Promise<BatchPlan | ApiResponse> {
    const body = commit ? bodyRecord(request) : request.query;
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId || typeof body.batchId !== "string") return invalid("圖片批次編號或站點無效。", 400, "INVALID_IMAGE_BATCH");
    const plan = this.plans.get(body.batchId);
    if (!plan) return invalid("圖片批次已過期或工作環境已切換，請重新核對。", 410, "IMAGE_BATCH_EXPIRED");
    const revision = this.revision;
    const current = await this.deps.context.capture(marketplaceId);
    await this.fence(plan.context, revision);
    if (this.plans.get(plan.batchId) !== plan) return invalid("圖片批次已被新的預檢取代，請核對最新清單。", 410, "IMAGE_BATCH_EXPIRED");
    if (current.accountScope !== plan.context.accountScope || current.mode !== plan.context.mode || current.generation !== plan.context.generation
      || current.marketplaceId !== plan.context.marketplaceId) return invalid("圖片批次不屬於目前的帳號或站點。", 409, "IMAGE_BATCH_CONTEXT_CHANGED");
    if (["ready", "completed", "stopped"].includes(plan.phase) && plan.expiresAt <= this.now()) {
      this.plans.delete(plan.batchId);
      return invalid("圖片批次已過期，請重新核對。", 410, "IMAGE_BATCH_EXPIRED");
    }
    return plan;
  }

  private async observe(request: ApiRequest): Promise<ApiResponse> {
    const plan = await this.findPlan(request, false);
    if ("status" in plan) return plan;
    if (!exactKeys(request.query, ["marketplaceId", "batchId", "refresh"]) ||
      (request.query.refresh !== undefined && request.query.refresh !== "true")) return invalid("圖片回查選項無效。", 400, "INVALID_IMAGE_BATCH");
    if (request.query.refresh === "true" && ["completed", "stopped"].includes(plan.phase)) {
      if (this.building) return invalid("圖片批次正在核對，請等待目前工作完成。", 409, "OPERATION_IN_PROGRESS");
      return this.startReadback(plan);
    }
    return json(this.snapshot(plan));
  }

  private async recover(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    let skus: unknown;
    try { skus = (request.query.recoverSkus?.length ?? 0) <= 8_000 ? JSON.parse(request.query.recoverSkus ?? "null") : null; } catch { skus = null; }
    if (!marketplaceId || !exactKeys(request.query, ["marketplaceId", "recoverSkus"]) ||
      !Array.isArray(skus) || !skus.length || skus.length > LISTING_IMAGE_BATCH_MAX_SKUS ||
      skus.some(sku => typeof sku !== "string" || parseSellerSku(sku) !== sku) || new Set(skus).size !== skus.length) {
      return invalid("請提供 1–30 個不同的完整 SKU，以讀取先前圖片更新。", 400, "INVALID_IMAGE_BATCH");
    }
    if (this.building || [...this.plans.values()].some(plan => !["ready", "completed", "stopped"].includes(plan.phase))) {
      return invalid("圖片批次正在處理，請等待目前工作完成。", 409, "OPERATION_IN_PROGRESS");
    }
    this.building = true;
    try {
      const revision = this.revision;
      const context = await this.deps.context.capture(marketplaceId);
      await this.fence(context, revision);
      if (context.mode !== "live") return invalid("先前 Amazon 圖片更新只能在正式連線模式回查。", 409, "IMAGE_RECOVERY_LIVE_REQUIRED");
      if (!this.deps.writeGate.inspect) throw new MainWriteGateError("WRITE_INSPECTION_UNAVAILABLE");
      const plan: BatchPlan = { batchId: `image-batch.${this.uuid()}`, reviewToken: `image-recovery.${this.uuid()}`, context,
        expiresAt: this.now() + TERMINAL_TTL_MS, phase: "completed", rows: [], message: null, lastReadbackAt: null };
      for (const sellerSku of skus as string[]) {
        const inspections = await this.deps.writeGate.inspect({ context, marketplaceId, sellerSku, operations: ["images"], requireComplete: true,
          // Keep null/malformed newer attempts so an older accepted receipt cannot replace them.
          project: inspection => inspection });
        await this.fence(context, revision);
        const ordered = inspections
          // A completed demo simulation is not an Amazon attempt. Every unresolved
          // or malformed newer entry still blocks fallback to older live evidence.
          .filter(entry => !(entry.state === "completed" && isSimulatedImageWrite(entry.response, { marketplaceId, sellerSku })))
          .sort((left, right) => right.createdAt - left.createdAt);
        const latest = ordered[0];
        const ambiguous = latest && ordered[1]?.createdAt === latest.createdAt;
        const recovered = latest && !ambiguous && (latest.state !== "completed" || latest.expiresAt > this.now())
          ? recoverableImageWrite(latest.response, { marketplaceId, sellerSku }) : null;
        const urls = (values: readonly (string | null)[] = []) => Array.from({ length: 10 }, (_, index) => values[index] ?? null);
        const previousUrls = urls(recovered?.result.previousUrls);
        const requestedUrls = urls(recovered?.result.requestedUrls);
        const changedSlots = recovered?.result.changedSlots.map(slot => slot + 1) ?? [];
        const code = recovered ? null : !latest ? "IMAGE_WRITE_NOT_FOUND" : "IMAGE_WRITE_EVIDENCE_UNAVAILABLE";
        plan.rows.push({ input: { marketplaceId, sellerSku, expectedUrls: previousUrls, urls: requestedUrls,
          ...(recovered ? { expectedImageIdentity: { asin: recovered.asin, productType: recovered.productType } } : {}) }, preview: null,
          ...(recovered ? { accepted: recovered.result } : {}), public: {
            sellerSku, asin: recovered?.asin ?? null, title: "", previousUrls, requestedUrls, changedSlots,
            deletedSlots: changedSlots.filter(slot => previousUrls[slot - 1] && requestedUrls[slot - 1] === null),
            state: recovered ? "accepted" : !latest ? "blocked" : "unknown", code,
            message: recovered ? "已找回先前接受紀錄，正在核對 Amazon 圖片欄位。" : !latest
              ? "本機沒有這個 SKU 的圖片更新紀錄；沒有送出任何更新。"
              : "最新操作缺少可精確回查的接受證據，保留結果待確認，請勿重送。",
            requestId: recovered ? publicSpApiRequestId(recovered.result.requestId) : null,
            acceptedAt: recovered?.result.completedAt ?? null,
          } });
      }
      await this.fence(context, revision);
      while (this.plans.size >= 4) this.plans.delete(this.plans.keys().next().value!);
      this.plans.set(plan.batchId, plan);
      // A reconstructed plan has no preview ticket and is terminal: it can only read.
      return this.startReadback(plan);
    } finally { this.building = false; }
  }

  private startReadback(plan: BatchPlan): ApiResponse {
    if ([...this.plans.values()].some(other => other !== plan && !["ready", "completed", "stopped"].includes(other.phase))) {
      return invalid("其他圖片批次正在處理，請等待目前工作完成後再回查。", 409, "OPERATION_IN_PROGRESS");
    }
    if (!plan.rows.some(row => row.public.state === "accepted")) return json(this.snapshot(plan));
    const terminalPhase = plan.phase === "stopped" ? "stopped" : "completed";
    const revision = this.revision;
    const controller = new AbortController();
    this.controllers.add(controller);
    plan.phase = "readback";
    void (async () => {
      try {
        await this.readbackPass(plan, revision, controller.signal);
        await this.fence(plan.context, revision);
        plan.phase = terminalPhase;
      } catch {
        if (revision === this.revision && this.plans.get(plan.batchId) === plan) {
          plan.phase = "stopped";
          plan.message = "此次回查未完成；已接受或結果未明的更新不會重送。";
        }
      } finally { this.controllers.delete(controller); }
    })();
    return json(this.snapshot(plan), 202);
  }

  private async readbackPass(plan: BatchPlan, revision: number, signal: AbortSignal): Promise<void> {
    const pending = plan.rows.filter(row => row.public.state === "accepted");
    // A previous pass must not appear to describe a new request that is in flight or fails.
    for (const row of pending) row.public = { ...row.public, readbackDiagnostics: undefined };
    // One pass, bounded pairs. Neither automatic nor explicit recovery receives write authority.
    for (let index = 0; index < pending.length; index += 2) {
      if (signal.aborted) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "圖片回查已停止。");
      await this.fence(plan.context, revision);
      await Promise.all(pending.slice(index, index + 2).map(async row => {
        try {
          const observation = await this.deps.operations.read({ marketplaceId: plan.context.marketplaceId, sellerSku: row.input.sellerSku });
          await this.fence(plan.context, revision);
          const readbackDiagnostics = analyzeImageReadback(row.accepted, observation);
          row.public = { ...row.public, readbackDiagnostics };
          if (readbackDiagnostics.decision !== "verified") {
            row.public = { ...row.public, code: "IMAGE_READBACK_PENDING", message: "已讀取 Amazon，尚未符合回查確認條件；請查看本次回查原因，勿重送。" };
            return;
          }
          await this.deps.writeGate.reconcile({ context: plan.context, marketplaceId: plan.context.marketplaceId, sellerSku: row.input.sellerSku,
            operations: ["images"], requireCurrent: true, snapshot: observation, project: (result, _operation, snapshot) => reconcileImageWrite(result, snapshot) });
          await this.fence(plan.context, revision);
          const inspected = await this.deps.writeGate.inspect?.({ context: plan.context, marketplaceId: plan.context.marketplaceId,
            sellerSku: row.input.sellerSku, operations: ["images"], requireComplete: true, project: inspection => {
              const response = inspection.response;
              return inspection.state === "completed" && isPlainRecord(response) && response.completedAt === row.accepted!.completedAt
                && JSON.stringify(response.previousUrls) === JSON.stringify(row.accepted!.previousUrls)
                && JSON.stringify(response.requestedUrls) === JSON.stringify(row.accepted!.requestedUrls)
                && reconcileImageWrite(response, observation) !== null ? true : null;
            } });
          await this.fence(plan.context, revision);
          if (!inspected?.includes(true)) throw new MainWriteGateError("WRITE_INSPECTION_UNAVAILABLE");
          row.public = { ...row.public, state: "verified", code: null, message: "Amazon 圖片欄位已相符；商品圖片下載與審核仍由 Amazon 處理。" };
        } catch (error) {
          await this.fence(plan.context, revision);
          const failure = error instanceof SpApiError ? publicSpApiError(error, "此次唯讀回查未完成。") : null;
          row.public = { ...row.public, code: failure?.code ?? "IMAGE_READBACK_UNAVAILABLE",
            message: "Amazon 已接受；此次唯讀回查尚未完成，請勿重送。" };
        }
      }));
    }
    await this.fence(plan.context, revision);
    plan.lastReadbackAt = new Date(this.now()).toISOString();
  }

  private async commit(request: ApiRequest): Promise<ApiResponse> {
    if (this.building) return invalid("圖片批次正在重新預檢，請等待最新清單。", 409, "OPERATION_IN_PROGRESS");
    const body = bodyRecord(request);
    if (!body || !exactKeys(body, ["marketplaceId", "batchId", "reviewToken", "completeReplacementAcknowledged"]) || body.completeReplacementAcknowledged !== true) {
      return invalid("請先核對整批圖片及所有將清除的位置，再確認完整替換。", 422, "IMAGE_BATCH_REPLACEMENT_ACKNOWLEDGEMENT_REQUIRED");
    }
    const plan = await this.findPlan(request, true);
    if ("status" in plan) return plan;
    if (this.building) return invalid("圖片批次正在重新預檢，請等待最新清單。", 409, "OPERATION_IN_PROGRESS");
    if (body.reviewToken !== plan.reviewToken) return invalid("這份確認與預檢內容不一致，請重新核對。", 409, "IMAGE_BATCH_REVIEW_CHANGED");
    if (["completed", "stopped"].includes(plan.phase)) return json(this.snapshot(plan));
    if (plan.phase !== "ready") return invalid("圖片批次正在處理，已阻止重複送出。", 409, "OPERATION_IN_PROGRESS");
    const binding = this.binding(plan);
    const revision = this.revision;
    plan.phase = "revalidating";
    // This background task owns every write; ordinary progress GET only observes it.
    void this.execute(plan, binding, revision);
    return json(this.snapshot(plan), 202);
  }

  private assertResult(result: ListingImageUpdateResult, row: PlanRow, mode: "live" | "demo", preview: boolean): void {
    if (result.mode !== mode || result.marketplaceId !== row.input.marketplaceId || result.sellerSku !== row.input.sellerSku
      || result.status !== (mode === "demo" ? "SIMULATED" : preview ? "VALID" : "ACCEPTED")
      || JSON.stringify(result.previousUrls) !== JSON.stringify(row.input.expectedUrls)
      || JSON.stringify(result.requestedUrls) !== JSON.stringify(row.input.urls)
      || JSON.stringify(result.changedSlots.map(slot => slot + 1)) !== JSON.stringify(row.public.changedSlots)
      || (!preview && !Number.isFinite(Date.parse(result.completedAt)))) {
      throw new SpApiError("圖片批次回應與已核對的商品或位置不一致，已停止整批。", { status: 502, code: "IMAGE_BATCH_BINDING_CHANGED" });
    }
  }

  private async execute(plan: BatchPlan, binding: WriteBinding, revision: number): Promise<void> {
    const controller = new AbortController();
    this.controllers.add(controller);
    let dispatchStopped = false;
    try {
      await this.deps.writeGate.execute({
        binding,
        approvalReason: verificationCode => {
          const rows = plan.rows.filter(row => row.public.state === "ready");
          const positions = rows.reduce((sum, row) => sum + row.public.changedSlots.length, 0);
          const deleted = rows.reduce((sum, row) => sum + row.public.deletedSlots.length, 0);
          return `確認整批圖片｜${marketplaceById(plan.context.marketplaceId)?.code}｜${rows.length} SKU／${positions} 位置／清除 ${deleted}｜已逐項核對完整替換｜驗證碼 ${verificationCode}`;
        },
        beforeApproval: async () => {
          for (const row of plan.rows.filter(item => item.public.state === "ready")) {
            try {
              await this.fence(plan.context, revision);
              await this.preparedExpiry(row.input, plan.context, revision);
              const fresh = await this.deps.operations.preview(row.input);
              await this.fence(plan.context, revision);
              this.assertResult(fresh, row, plan.context.mode, true);
              if (JSON.stringify(fresh.issues) !== JSON.stringify(row.preview?.issues)) throw new MainWriteGateError("PREVIEW_CHANGED");
            } catch (error) {
              await this.fence(plan.context, revision);
              if (!isolatedPreviewFailure(error)) throw error;
              const publicError = publicSpApiError(error, "此 SKU 未通過重新預檢，沒有寫入 Amazon。");
              row.public = { ...row.public, state: "blocked", code: publicError.code, message: publicError.message, requestId: publicError.requestId };
            }
          }
          await this.recheckReadySources(plan, revision);
          if (!plan.rows.some(row => row.public.state === "ready")) throw new SpApiError("全部 SKU 已隔離，Amazon 寫入數為 0。", { status: 422, code: "IMAGE_BATCH_NO_ELIGIBLE_ROWS" });
          plan.phase = "awaiting-approval";
        },
        run: async session => {
          await this.fence(plan.context, revision);
          plan.phase = "submitting";
          for (const row of plan.rows.filter(item => item.public.state === "ready")) row.public = { ...row.public, state: "not-started" };
          for (const row of plan.rows.filter(item => item.public.state === "not-started")) {
            await this.fence(plan.context, revision);
            row.public = { ...row.public, state: "submitting" };
            try {
              let accepted: ListingImageUpdateResult | null = null;
              let result: ListingImageUpdateResult;
              try {
                result = await session.attempt<ListingImageUpdateResult>({ intentId: row.input.sellerSku, execute: async ({ recordAccepted, assertCurrent }) => {
                  try {
                    await this.preparedExpiry(row.input, plan.context, revision);
                    await this.fence(plan.context, revision);
                  } catch (error) {
                    throw new SpApiPreCommitError(error instanceof SpApiError ? error : new SpApiError("圖片準備已失效。", { status: 409, code: "IMAGE_PREPARATION_EXPIRED" }));
                  }
                  const result = await this.deps.operations.commit(row.input, { assertCurrent: async () => {
                    await assertCurrent();
                    await this.fence(plan.context, revision);
                    try {
                      await this.preparedExpiry(row.input, plan.context, revision);
                      await this.fence(plan.context, revision);
                    } catch (error) {
                      throw new SpApiPreCommitError(error instanceof SpApiError ? error : new SpApiError("圖片準備已失效。", { status: 409, code: "IMAGE_PREPARATION_EXPIRED" }));
                    }
                  } });
                  this.assertResult(result, row, plan.context.mode, false);
                  await recordAccepted(result);
                  if (result.mode === "live") {
                    accepted = result;
                    // Keep durable uncertainty until canonical GET reconciles it.
                    throw new ListingWriteAcceptedButPendingError();
                  }
                  return result;
                } });
              } catch (error) {
                if (!(error instanceof ListingWriteAcceptedButPendingError) || !accepted) throw error;
                result = accepted;
              }
              await this.fence(plan.context, revision);
              row.accepted = result;
              row.public = { ...row.public, state: result.mode === "demo" ? "simulated" : "accepted", requestId: publicSpApiRequestId(result.requestId),
                acceptedAt: result.mode === "live" ? result.completedAt : null };
            } catch (error) {
              await this.fence(plan.context, revision);
              const publicError = error instanceof SpApiError ? publicSpApiError(error, "圖片更新尚未確認。") : null;
              row.public = { ...row.public, state: error instanceof SpApiPreCommitError ? "not-started" : "unknown",
                code: publicError?.code ?? "UPDATE_STATUS_UNKNOWN", message: publicError?.message ?? "圖片更新結果尚未確認，請勿重送。" };
              if ((error instanceof SpApiPreCommitError && isolatedPreviewFailure(error))
                || (error instanceof SpApiError && error.code === "UPDATE_REJECTED" && error.status === 422)) {
                row.public = { ...row.public, state: error instanceof SpApiPreCommitError ? "not-started" : "rejected" };
                continue;
              }
              dispatchStopped = true;
              plan.message = "圖片批次已停止，尚未開始的商品沒有送出；已接受或結果未明的商品只可回查。";
              break;
            }
          }
        },
      });
      await this.fence(plan.context, revision);
      if (plan.rows.some(row => row.public.state === "accepted")) {
        plan.phase = "readback";
        for (const milliseconds of this.deps.readbackDelaysMs ?? [0, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000]) {
          await this.fence(plan.context, revision);
          if (milliseconds > 0) await abortableDelay(milliseconds, controller.signal);
          const pending = plan.rows.filter(row => row.public.state === "accepted");
          if (!pending.length) break;
          await this.readbackPass(plan, revision, controller.signal);
        }
      }
      await this.fence(plan.context, revision);
      plan.phase = dispatchStopped ? "stopped" : "completed";
    } catch (error) {
      // A cleared plan must never be reinserted or publish a late result.
      if (revision === this.revision && this.plans.get(plan.batchId) === plan) {
        plan.phase = "stopped";
        plan.message = error instanceof MainWriteGateError ? error.message : error instanceof SpApiError
          ? publicSpApiError(error, "圖片批次已停止，請重新核對未送出的商品。").message : "圖片批次已停止；請重新核對未送出的商品。";
      }
    } finally {
      this.controllers.delete(controller);
      if (revision === this.revision && this.plans.get(plan.batchId) === plan) plan.expiresAt = this.now() + TERMINAL_TTL_MS;
    }
  }
}
