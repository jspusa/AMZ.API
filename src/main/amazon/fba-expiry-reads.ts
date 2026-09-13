import { createHash } from "node:crypto";
import { throwIfAborted } from "../abort-utils";
import { isPlainRecord } from "../route-input";
import type { InventoryExpiryRecord } from "./inventory-health";
import { fbaInboundExternalReadIdentity, type FbaInboundExternalReadAdapter } from "./fba-inbound-reads";
import type { ModernFbaInboundTransportRequest } from "./fba-inbound-modern";
import { isDateOnly } from "./marketplace-calendar";
import { SpApiError } from "./sp-api-error";
import type { SpExecutionContext, SpExecutionContextAdapter } from "./sp-execution-context";

type PlanSummary = { inboundPlanId: string; name?: string; lastUpdatedAt: string; status: "ACTIVE" | "SHIPPED" | "VOIDED" | "ERRORED" };
type CachedPlan = PlanSummary & { records: InventoryExpiryRecord[] };
type CurrentPlan = PlanSummary & { itemCursor: string | null; itemTokens: string[]; records: InventoryExpiryRecord[] };
/** Main-only continuation; the renderer gets only the separate human-readable source label. */
export type FbaExpiryCheckpoint = {
  schemaVersion: 1;
  scopeFingerprint: string;
  phase: "partial" | "complete";
  startedAt: string;
  cachedPlans: CachedPlan[];
  pendingPlans: PlanSummary[];
  currentPlan: CurrentPlan | null;
  planCursor: string | null;
  planPagesComplete: boolean;
  seenPlanIds: string[];
  seenPlanTokens: string[];
};
export type FbaExpiryEvidence = Readonly<{
  records: readonly InventoryExpiryRecord[];
  complete: boolean;
  checkpoint?: FbaExpiryCheckpoint;
}>;
const MAX_RECORDS = 10000;
const MAX_PLANS = 6000;
const MAX_REQUESTS_PER_SLICE = 100;
const MAX_CHECKPOINT_BYTES = 7 * 1024 * 1024;
// Diagnostics identify the rejected field or invariant, never its upstream value.
const FAILURE_MESSAGES = {
  planShape: "Amazon 入庫計畫摘要格式無法辨識，已停止效期讀取。",
  planId: "Amazon 入庫計畫識別碼格式無法辨識，已停止效期讀取。",
  planUpdatedAt: "Amazon 入庫計畫更新時間格式無法辨識，已停止效期讀取。",
  planName: "Amazon 入庫計畫名稱格式無法辨識，已停止效期讀取。",
  planStatus: "Amazon 入庫計畫狀態無法辨識，已停止效期讀取。",
  planPage: "Amazon 入庫計畫清單格式無法辨識或超過單頁上限，已停止效期讀取。",
  planMarketplaces: "Amazon 入庫計畫站點資料無法核對，已停止效期讀取。",
  duplicatePlan: "Amazon 入庫計畫清單重複回傳相同計畫，已停止效期讀取。",
  itemPage: "Amazon 入庫商品清單格式無法辨識或超過單頁上限，已停止效期讀取。",
  itemShape: "Amazon 入庫商品資料格式無法辨識，已停止效期讀取。",
  itemSku: "Amazon 入庫商品的 Seller SKU 格式無法辨識，已停止效期讀取。",
  itemAsin: "Amazon 入庫商品的 ASIN 格式無法辨識，已停止效期讀取。",
  itemFnsku: "Amazon 入庫商品的 FNSKU 格式無法辨識，已停止效期讀取。",
  itemExpiration: "Amazon 入庫商品申報效期格式無法辨識，已停止效期讀取。",
  itemLot: "Amazon 入庫商品製造批號格式無法辨識，已停止效期讀取。",
  itemQuantity: "Amazon 入庫商品申報數量無法核對，已停止效期讀取。",
  duplicateItem: "Amazon 入庫商品重複回傳相同批次，已停止效期讀取。",
  pagination: "Amazon 入庫效期分頁資料無法核對或未向前推進，已停止讀取。",
  checkpoint: "本機入庫效期接續資料格式無法辨識，已停止讀取。",
  checkpointIntegrity: "本機入庫效期接續資料互相矛盾，已停止讀取。",
  limits: "Amazon 入庫效期資料超過安全讀取範圍，已停止讀取。",
  contextIdentity: "Amazon 入庫效期回應與本次讀取身分不符，已停止讀取。",
  envelope: "Amazon 入庫效期回應結構無法辨識，已停止讀取。",
} as const;
type FailureReason = keyof typeof FAILURE_MESSAGES;
const FAILURE_DETAILS = {
  notText: "缺值或非文字",
  empty: "空字串",
  tooLong: "超過長度上限",
  outerWhitespace: "首尾空白",
  unsafeControls: "不安全控制字元",
  dateFormat: "日期格式不符",
  identifierFormat: "識別碼格式不符",
} as const;
type FailureDetail = keyof typeof FAILURE_DETAILS;
function invalid(reason: FailureReason, detail?: FailureDetail): never {
  const message = FAILURE_MESSAGES[reason] + (detail === undefined ? "" : `（${FAILURE_DETAILS[detail]}）`);
  throw new SpApiError(message, { status: 502, code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
}
function text(value: unknown, max: number, reason: FailureReason): string {
  if (typeof value !== "string") invalid(reason, "notText");
  if (!value) invalid(reason, "empty");
  if (value.length > max) invalid(reason, "tooLong");
  if (value !== value.trim()) invalid(reason, "outerWhitespace");
  if (/[\p{Cc}\p{Cf}]/u.test(value)) invalid(reason, "unsafeControls");
  return value;
}
function date(value: unknown, reason: FailureReason): string {
  const result = text(value, 64, reason);
  if (!Number.isFinite(Date.parse(result))) invalid(reason, "dateFormat");
  return result;
}
function token(root: Record<string, unknown>): string | null {
  if (root.pagination === undefined) return null;
  if (!isPlainRecord(root.pagination)) invalid("pagination");
  if (root.pagination.nextToken === undefined) return null;
  return text(root.pagination.nextToken, 1024, "pagination");
}
const digest = (value: readonly unknown[]) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scopeFingerprint = (context: SpExecutionContext) => digest([context.accountScope, context.mode, context.marketplaceId]);
const sourceRef = (context: SpExecutionContext, planId: string) => `inbound-${digest([context.accountScope, context.marketplaceId, planId]).slice(0, 20)}`;
const sourceLabel = (plan: PlanSummary) => `${plan.name ?? "入庫計畫"} · ${plan.inboundPlanId}`;
function summary(raw: unknown): PlanSummary {
  if (!isPlainRecord(raw)) invalid("planShape");
  const inboundPlanId = text(raw.inboundPlanId, 38, "planId");
  if (!/^[a-zA-Z0-9-]{38}$/.test(inboundPlanId)) invalid("planId", "identifierFormat");
  const lastUpdatedAt = date(raw.lastUpdatedAt, "planUpdatedAt");
  // Amazon can return an empty display name; keep the existing unnamed-plan
  // representation and label without changing any plan or item identity.
  const name = raw.name === undefined || raw.name === "" ? undefined : text(raw.name, 400, "planName");
  if (!["ACTIVE", "VOIDED", "SHIPPED", "ERRORED"].includes(String(raw.status))) invalid("planStatus");
  return { inboundPlanId, ...(name === undefined ? {} : { name }), lastUpdatedAt, status: raw.status as PlanSummary["status"] };
}
function strings(raw: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(raw) || raw.length > limit) invalid("checkpoint");
  const parsed = raw.map(value => text(value, maxLength, "checkpoint"));
  if (new Set(parsed).size !== parsed.length) invalid("checkpointIntegrity");
  return parsed;
}
function savedRecords(raw: unknown, plan: PlanSummary): InventoryExpiryRecord[] {
  if (!Array.isArray(raw) || raw.length > MAX_RECORDS) invalid("checkpoint");
  return raw.map(record => {
    if (!isPlainRecord(record)) invalid("checkpoint");
    const id = text(record.id, 39, "checkpoint"), sellerSku = text(record.sellerSku, 40, "checkpoint"), asin = text(record.asin, 10, "checkpoint");
    const reference = text(record.sourceRef, 28, "checkpoint"), sourceUpdatedAt = date(record.sourceUpdatedAt, "checkpoint"), observedAt = date(record.observedAt, "checkpoint");
    const label = record.sourceLabel === undefined ? sourceLabel(plan) : text(record.sourceLabel, 512, "checkpoint");
    if (!/^expiry-[a-f0-9]{32}$/.test(id) || !/^[A-Z0-9]{10}$/.test(asin) || !/^inbound-[a-f0-9]{20}$/.test(reference) || sourceUpdatedAt !== plan.lastUpdatedAt ||
      !(record.expiryDate === null || (typeof record.expiryDate === "string" && isDateOnly(record.expiryDate))) ||
      typeof record.declaredQuantity !== "number" || !Number.isSafeInteger(record.declaredQuantity) || record.declaredQuantity < 1 || record.declaredQuantity > 500000 ||
      record.stopSaleDate !== null || record.confirmedRemaining !== null || record.confirmedForSnapshot !== null || label !== sourceLabel(plan)) invalid("checkpointIntegrity");
    return { id, sellerSku, asin, expiryDate: record.expiryDate, declaredQuantity: record.declaredQuantity, sourceRef: reference, sourceLabel: label, sourceUpdatedAt, observedAt,
      stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null };
  });
}
/** Validate and copy the bounded private checkpoint before using persisted continuation state. */
export function parseFbaExpiryCheckpoint(value: unknown): FbaExpiryCheckpoint | null {
  if (value === null || value === undefined) return null;
  if (!isPlainRecord(value) || value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(String(value.scopeFingerprint)) ||
    !["partial", "complete"].includes(String(value.phase)) || typeof value.planPagesComplete !== "boolean" ||
    !Array.isArray(value.cachedPlans) || value.cachedPlans.length > MAX_PLANS || !Array.isArray(value.pendingPlans) || value.pendingPlans.length > 30) invalid("checkpoint");
  const cachedPlans = value.cachedPlans.map(raw => {
    if (!isPlainRecord(raw)) invalid("checkpoint");
    const plan = summary(raw);
    if (plan.status !== "ACTIVE" && plan.status !== "SHIPPED") invalid("checkpointIntegrity");
    return { ...plan, records: savedRecords(raw.records, plan) };
  });
  let currentPlan: CurrentPlan | null = null;
  if (value.currentPlan !== null) {
    if (!isPlainRecord(value.currentPlan)) invalid("checkpoint");
    const plan = summary(value.currentPlan);
    if (plan.status !== "ACTIVE" && plan.status !== "SHIPPED") invalid("checkpointIntegrity");
    currentPlan = { ...plan, itemCursor: value.currentPlan.itemCursor === null ? null : text(value.currentPlan.itemCursor, 1024, "checkpoint"),
      itemTokens: strings(value.currentPlan.itemTokens, 200, 1024), records: savedRecords(value.currentPlan.records, plan) };
    if (currentPlan.itemCursor !== null && !currentPlan.itemTokens.includes(currentPlan.itemCursor)) invalid("checkpointIntegrity");
  }
  const pendingPlans = value.pendingPlans.map(summary);
  const seenPlanIds = strings(value.seenPlanIds, MAX_PLANS, 38);
  if (seenPlanIds.some(id => !/^[a-zA-Z0-9-]{38}$/.test(id))) invalid("checkpoint");
  const seenPlanTokens = strings(value.seenPlanTokens, 200, 1024);
  const planCursor = value.planCursor === null ? null : text(value.planCursor, 1024, "checkpoint");
  if (planCursor !== null && !seenPlanTokens.includes(planCursor)) invalid("checkpointIntegrity");
  const cacheIds = cachedPlans.map(plan => plan.inboundPlanId);
  const workIds = [...pendingPlans.map(plan => plan.inboundPlanId), ...(currentPlan ? [currentPlan.inboundPlanId] : [])];
  const recordIds = [...cachedPlans.flatMap(plan => plan.records), ...(currentPlan?.records ?? [])].map(record => record.id);
  if (new Set(cacheIds).size !== cacheIds.length || new Set(workIds).size !== workIds.length || workIds.some(id => !seenPlanIds.includes(id)) ||
    recordIds.length > MAX_RECORDS || new Set(recordIds).size !== recordIds.length ||
    (currentPlan !== null && cacheIds.includes(currentPlan.inboundPlanId)) ||
    (value.planPagesComplete && planCursor !== null) ||
    (value.phase === "complete" && (!value.planPagesComplete || workIds.length > 0 || cacheIds.some(id => !seenPlanIds.includes(id))))) invalid("checkpointIntegrity");
  const result: FbaExpiryCheckpoint = { schemaVersion: 1, scopeFingerprint: String(value.scopeFingerprint), phase: value.phase as "partial" | "complete",
    startedAt: date(value.startedAt, "checkpoint"), cachedPlans, pendingPlans, currentPlan, planCursor, planPagesComplete: value.planPagesComplete, seenPlanIds, seenPlanTokens };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_CHECKPOINT_BYTES) invalid("limits");
  return result;
}
function freshCheckpoint(context: SpExecutionContext, now: string, cachedPlans: CachedPlan[] = []): FbaExpiryCheckpoint {
  return { schemaVersion: 1, scopeFingerprint: scopeFingerprint(context), phase: "partial", startedAt: now, cachedPlans,
    pendingPlans: [], currentPlan: null, planCursor: null, planPagesComplete: false, seenPlanIds: [], seenPlanTokens: [] };
}

/** Reads declared dates only. Each slice can be persisted before its successor starts. */
export class FbaExpiryReads {
  constructor(private readonly input: Readonly<{ adapter: FbaInboundExternalReadAdapter; context: SpExecutionContextAdapter; now?: () => Date }>) {}

  async read(input: Readonly<{ context: SpExecutionContext; signal: AbortSignal; checkpoint?: unknown }>): Promise<FbaExpiryEvidence> {
    const observedAt = (this.input.now?.() ?? new Date()).toISOString();
    const parsed = parseFbaExpiryCheckpoint(input.checkpoint);
    if (parsed && parsed.scopeFingerprint !== scopeFingerprint(input.context)) invalid("contextIdentity");
    let state = parsed ?? freshCheckpoint(input.context, observedAt);
    // Old continuation tokens need not remain usable indefinitely. Completed plan
    // revisions survive a fresh listing pass, so restarting never repeats all items.
    const age = Date.parse(observedAt) - Date.parse(state.startedAt);
    if (state.phase === "complete" || age < 0 || age > 30 * 60 * 1000) state = freshCheckpoint(input.context, observedAt, state.cachedPlans);
    await this.input.context.assertCurrent(input.context); throwIfAborted(input.signal);
    if (input.context.mode === "demo") {
      const checkpoint = { ...freshCheckpoint(input.context, observedAt), phase: "complete" as const, planPagesComplete: true };
      return { records: [], complete: true, checkpoint };
    }
    for (const plan of [...state.cachedPlans, ...(state.currentPlan ? [state.currentPlan] : [])]) {
      if (plan.records.some(record => record.sourceRef !== sourceRef(input.context, plan.inboundPlanId))) invalid("checkpointIntegrity");
    }
    const cached = new Map(state.cachedPlans.map(plan => [plan.inboundPlanId, plan]));
    let requests = 0;
    const read = async (request: ModernFbaInboundTransportRequest) => {
      requests += 1;
      throwIfAborted(input.signal);
      await this.input.context.assertCurrent(input.context);
      const plan = { source: "modern" as const, marketplaceId: input.context.marketplaceId, request, signal: input.signal };
      const result = await this.input.adapter.read(plan);
      await this.input.context.assertCurrent(input.context);
      throwIfAborted(input.signal);
      if (JSON.stringify(result.identity) !== JSON.stringify(fbaInboundExternalReadIdentity(plan))) invalid("contextIdentity");
      if (!isPlainRecord(result.envelope)) invalid("envelope");
      return result.envelope;
    };
    while (requests < MAX_REQUESTS_PER_SLICE) {
      if (state.currentPlan) {
        const current = state.currentPlan;
        const page = await read({ kind: "plan-items", inboundPlanId: current.inboundPlanId, paginationToken: current.itemCursor });
        if (!Array.isArray(page.items) || page.items.length > 1000) invalid("itemPage");
        for (const rawItem of page.items) {
          if (!isPlainRecord(rawItem)) invalid("itemShape");
          const sellerSku = text(rawItem.msku, 40, "itemSku"), asin = text(rawItem.asin, 10, "itemAsin");
          const fnsku = text(rawItem.fnsku, 10, "itemFnsku");
          const manufacturingLotCode = rawItem.manufacturingLotCode === undefined ? null : text(rawItem.manufacturingLotCode, 256, "itemLot");
          if (!/^[A-Z0-9]{10}$/.test(asin)) invalid("itemAsin", "identifierFormat");
          const expiryDate = rawItem.expiration === undefined ? null : text(rawItem.expiration, 10, "itemExpiration");
          if (expiryDate !== null && !isDateOnly(expiryDate)) invalid("itemExpiration", "dateFormat");
          const quantity = rawItem.quantity;
          if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 500000) invalid("itemQuantity");
          const reference = sourceRef(input.context, current.inboundPlanId);
          const id = `expiry-${digest([reference, sellerSku, asin, fnsku, expiryDate, manufacturingLotCode]).slice(0, 32)}`;
          if (current.records.some(record => record.id === id)) invalid("duplicateItem");
          current.records.push({ id, sellerSku, asin, expiryDate, declaredQuantity: quantity, sourceRef: reference, sourceLabel: sourceLabel(current),
            sourceUpdatedAt: current.lastUpdatedAt, observedAt, stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null });
          if (current.records.length + [...cached.values()].reduce((sum, plan) => sum + plan.records.length, 0) > MAX_RECORDS) invalid("limits");
        }
        current.itemCursor = token(page);
        if (current.itemCursor) {
          if (!page.items.length || current.itemTokens.includes(current.itemCursor) || current.itemTokens.length >= 200) invalid("pagination");
          current.itemTokens.push(current.itemCursor);
        } else {
          const { itemCursor: _cursor, itemTokens: _tokens, ...completed } = current;
          cached.set(current.inboundPlanId, completed);
          state.currentPlan = null;
        }
        continue;
      }
      if (state.pendingPlans.length) {
        const plan = state.pendingPlans.shift()!;
        if (plan.status === "VOIDED" || plan.status === "ERRORED") { cached.delete(plan.inboundPlanId); continue; }
        const previous = cached.get(plan.inboundPlanId);
        if (previous?.lastUpdatedAt === plan.lastUpdatedAt && previous.status === plan.status) {
          cached.set(plan.inboundPlanId, { ...plan, records: previous.records.map(record => ({ ...record, sourceLabel: sourceLabel(plan) })) });
          continue;
        }
        cached.delete(plan.inboundPlanId);
        state.currentPlan = { ...plan, itemCursor: null, itemTokens: [], records: [] };
        continue;
      }
      if (state.planPagesComplete) { state.phase = "complete"; break; }
      if (state.seenPlanTokens.length >= 200) invalid("limits");
      const page = await read({ kind: "plans", paginationToken: state.planCursor });
      if (!Array.isArray(page.inboundPlans) || page.inboundPlans.length > 30) invalid("planPage");
      for (const raw of page.inboundPlans) {
        const plan = summary(raw);
        if (!isPlainRecord(raw)) invalid("planShape");
        if (state.seenPlanIds.includes(plan.inboundPlanId)) invalid("duplicatePlan");
        if (state.seenPlanIds.length >= MAX_PLANS) invalid("limits");
        state.seenPlanIds.push(plan.inboundPlanId);
        if (!Array.isArray(raw.marketplaceIds) || !raw.marketplaceIds.length || raw.marketplaceIds.length > 20 || raw.marketplaceIds.some(m => typeof m !== "string" || !m || m.length > 20)) invalid("planMarketplaces");
        if (raw.marketplaceIds.includes(input.context.marketplaceId)) state.pendingPlans.push(plan);
        else cached.delete(plan.inboundPlanId);
      }
      state.planCursor = token(page);
      if (state.planCursor) {
        if (!page.inboundPlans.length || state.seenPlanTokens.includes(state.planCursor)) invalid("pagination");
        state.seenPlanTokens.push(state.planCursor);
      } else state.planPagesComplete = true;
    }
    if (state.planPagesComplete && state.pendingPlans.length === 0 && state.currentPlan === null) state.phase = "complete";
    if (state.phase === "complete") for (const id of cached.keys()) if (!state.seenPlanIds.includes(id)) cached.delete(id);
    state.cachedPlans = [...cached.values()];
    const checkpoint = parseFbaExpiryCheckpoint(state)!;
    await this.input.context.assertCurrent(input.context); throwIfAborted(input.signal);
    return { records: checkpoint.cachedPlans.flatMap(plan => plan.records), complete: checkpoint.phase === "complete", checkpoint };
  }
}
