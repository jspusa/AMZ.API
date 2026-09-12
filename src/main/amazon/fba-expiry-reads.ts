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
function invalid(): never {
  throw new SpApiError("Amazon 入庫效期資料缺漏、矛盾或超過安全讀取範圍，請重新核對。", { status: 502, code: "FBA_EXPIRY_FORMAT_UNSUPPORTED" });
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.length > max || value !== value.trim() || /[\p{Cc}\p{Cf}]/u.test(value)) invalid();
  return value;
}
function date(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) invalid();
  return result;
}
function token(root: Record<string, unknown>): string | null {
  if (root.pagination === undefined) return null;
  if (!isPlainRecord(root.pagination)) invalid();
  if (root.pagination.nextToken === undefined) return null;
  return text(root.pagination.nextToken, 1024);
}
const digest = (value: readonly unknown[]) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scopeFingerprint = (context: SpExecutionContext) => digest([context.accountScope, context.mode, context.marketplaceId]);
const sourceRef = (context: SpExecutionContext, planId: string) => `inbound-${digest([context.accountScope, context.marketplaceId, planId]).slice(0, 20)}`;
const sourceLabel = (plan: PlanSummary) => `${plan.name ?? "入庫計畫"} · ${plan.inboundPlanId}`;
function summary(raw: unknown): PlanSummary {
  if (!isPlainRecord(raw)) invalid();
  const inboundPlanId = text(raw.inboundPlanId, 38);
  if (!/^[a-zA-Z0-9-]{38}$/.test(inboundPlanId)) invalid();
  const lastUpdatedAt = date(raw.lastUpdatedAt);
  const name = raw.name === undefined ? undefined : text(raw.name, 400);
  if (!["ACTIVE", "VOIDED", "SHIPPED", "ERRORED"].includes(String(raw.status))) invalid();
  return { inboundPlanId, ...(name === undefined ? {} : { name }), lastUpdatedAt, status: raw.status as PlanSummary["status"] };
}
function strings(raw: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(raw) || raw.length > limit) invalid();
  const parsed = raw.map(value => text(value, maxLength));
  if (new Set(parsed).size !== parsed.length) invalid();
  return parsed;
}
function savedRecords(raw: unknown, plan: PlanSummary): InventoryExpiryRecord[] {
  if (!Array.isArray(raw) || raw.length > MAX_RECORDS) invalid();
  return raw.map(record => {
    if (!isPlainRecord(record)) invalid();
    const id = text(record.id, 39), sellerSku = text(record.sellerSku, 40), asin = text(record.asin, 10);
    const reference = text(record.sourceRef, 28), sourceUpdatedAt = date(record.sourceUpdatedAt), observedAt = date(record.observedAt);
    const label = record.sourceLabel === undefined ? sourceLabel(plan) : text(record.sourceLabel, 512);
    if (!/^expiry-[a-f0-9]{32}$/.test(id) || !/^[A-Z0-9]{10}$/.test(asin) || !/^inbound-[a-f0-9]{20}$/.test(reference) || sourceUpdatedAt !== plan.lastUpdatedAt ||
      !(record.expiryDate === null || (typeof record.expiryDate === "string" && isDateOnly(record.expiryDate))) ||
      typeof record.declaredQuantity !== "number" || !Number.isSafeInteger(record.declaredQuantity) || record.declaredQuantity < 1 || record.declaredQuantity > 500000 ||
      record.stopSaleDate !== null || record.confirmedRemaining !== null || record.confirmedForSnapshot !== null || label !== sourceLabel(plan)) invalid();
    return { id, sellerSku, asin, expiryDate: record.expiryDate, declaredQuantity: record.declaredQuantity, sourceRef: reference, sourceLabel: label, sourceUpdatedAt, observedAt,
      stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null };
  });
}
/** Validate and copy the bounded private checkpoint before using persisted continuation state. */
export function parseFbaExpiryCheckpoint(value: unknown): FbaExpiryCheckpoint | null {
  if (value === null || value === undefined) return null;
  if (!isPlainRecord(value) || value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(String(value.scopeFingerprint)) ||
    !["partial", "complete"].includes(String(value.phase)) || typeof value.planPagesComplete !== "boolean" ||
    !Array.isArray(value.cachedPlans) || value.cachedPlans.length > MAX_PLANS || !Array.isArray(value.pendingPlans) || value.pendingPlans.length > 30) invalid();
  const cachedPlans = value.cachedPlans.map(raw => {
    if (!isPlainRecord(raw)) invalid();
    const plan = summary(raw);
    if (plan.status !== "ACTIVE" && plan.status !== "SHIPPED") invalid();
    return { ...plan, records: savedRecords(raw.records, plan) };
  });
  let currentPlan: CurrentPlan | null = null;
  if (value.currentPlan !== null) {
    if (!isPlainRecord(value.currentPlan)) invalid();
    const plan = summary(value.currentPlan);
    if (plan.status !== "ACTIVE" && plan.status !== "SHIPPED") invalid();
    currentPlan = { ...plan, itemCursor: value.currentPlan.itemCursor === null ? null : text(value.currentPlan.itemCursor, 1024),
      itemTokens: strings(value.currentPlan.itemTokens, 200, 1024), records: savedRecords(value.currentPlan.records, plan) };
    if (currentPlan.itemCursor !== null && !currentPlan.itemTokens.includes(currentPlan.itemCursor)) invalid();
  }
  const pendingPlans = value.pendingPlans.map(summary);
  const seenPlanIds = strings(value.seenPlanIds, MAX_PLANS, 38);
  if (seenPlanIds.some(id => !/^[a-zA-Z0-9-]{38}$/.test(id))) invalid();
  const seenPlanTokens = strings(value.seenPlanTokens, 200, 1024);
  const planCursor = value.planCursor === null ? null : text(value.planCursor, 1024);
  if (planCursor !== null && !seenPlanTokens.includes(planCursor)) invalid();
  const cacheIds = cachedPlans.map(plan => plan.inboundPlanId);
  const workIds = [...pendingPlans.map(plan => plan.inboundPlanId), ...(currentPlan ? [currentPlan.inboundPlanId] : [])];
  const recordIds = [...cachedPlans.flatMap(plan => plan.records), ...(currentPlan?.records ?? [])].map(record => record.id);
  if (new Set(cacheIds).size !== cacheIds.length || new Set(workIds).size !== workIds.length || workIds.some(id => !seenPlanIds.includes(id)) ||
    recordIds.length > MAX_RECORDS || new Set(recordIds).size !== recordIds.length ||
    (currentPlan !== null && cacheIds.includes(currentPlan.inboundPlanId)) ||
    (value.planPagesComplete && planCursor !== null) ||
    (value.phase === "complete" && (!value.planPagesComplete || workIds.length > 0 || cacheIds.some(id => !seenPlanIds.includes(id))))) invalid();
  const result: FbaExpiryCheckpoint = { schemaVersion: 1, scopeFingerprint: String(value.scopeFingerprint), phase: value.phase as "partial" | "complete",
    startedAt: date(value.startedAt), cachedPlans, pendingPlans, currentPlan, planCursor, planPagesComplete: value.planPagesComplete, seenPlanIds, seenPlanTokens };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_CHECKPOINT_BYTES) invalid();
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
    if (parsed && parsed.scopeFingerprint !== scopeFingerprint(input.context)) invalid();
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
      if (plan.records.some(record => record.sourceRef !== sourceRef(input.context, plan.inboundPlanId))) invalid();
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
      if (JSON.stringify(result.identity) !== JSON.stringify(fbaInboundExternalReadIdentity(plan)) || !isPlainRecord(result.envelope)) invalid();
      return result.envelope;
    };
    while (requests < MAX_REQUESTS_PER_SLICE) {
      if (state.currentPlan) {
        const current = state.currentPlan;
        const page = await read({ kind: "plan-items", inboundPlanId: current.inboundPlanId, paginationToken: current.itemCursor });
        if (!Array.isArray(page.items) || page.items.length > 1000) invalid();
        for (const rawItem of page.items) {
          if (!isPlainRecord(rawItem)) invalid();
          const sellerSku = text(rawItem.msku, 40), asin = text(rawItem.asin, 10);
          const fnsku = text(rawItem.fnsku, 10);
          const manufacturingLotCode = rawItem.manufacturingLotCode === undefined ? null : text(rawItem.manufacturingLotCode, 256);
          if (!/^[A-Z0-9]{10}$/.test(asin)) invalid();
          const expiryDate = rawItem.expiration === undefined ? null : text(rawItem.expiration, 10);
          if (expiryDate !== null && !isDateOnly(expiryDate)) invalid();
          const quantity = rawItem.quantity;
          if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 500000) invalid();
          const reference = sourceRef(input.context, current.inboundPlanId);
          const id = `expiry-${digest([reference, sellerSku, asin, fnsku, expiryDate, manufacturingLotCode]).slice(0, 32)}`;
          if (current.records.some(record => record.id === id)) invalid();
          current.records.push({ id, sellerSku, asin, expiryDate, declaredQuantity: quantity, sourceRef: reference, sourceLabel: sourceLabel(current),
            sourceUpdatedAt: current.lastUpdatedAt, observedAt, stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null });
          if (current.records.length + [...cached.values()].reduce((sum, plan) => sum + plan.records.length, 0) > MAX_RECORDS) invalid();
        }
        current.itemCursor = token(page);
        if (current.itemCursor) {
          if (!page.items.length || current.itemTokens.includes(current.itemCursor) || current.itemTokens.length >= 200) invalid();
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
      if (state.seenPlanTokens.length >= 200) invalid();
      const page = await read({ kind: "plans", paginationToken: state.planCursor });
      if (!Array.isArray(page.inboundPlans) || page.inboundPlans.length > 30) invalid();
      for (const raw of page.inboundPlans) {
        const plan = summary(raw);
        if (!isPlainRecord(raw) || state.seenPlanIds.includes(plan.inboundPlanId) || state.seenPlanIds.length >= MAX_PLANS) invalid();
        state.seenPlanIds.push(plan.inboundPlanId);
        if (!Array.isArray(raw.marketplaceIds) || !raw.marketplaceIds.length || raw.marketplaceIds.length > 20 || raw.marketplaceIds.some(m => typeof m !== "string" || !m || m.length > 20)) invalid();
        if (raw.marketplaceIds.includes(input.context.marketplaceId)) state.pendingPlans.push(plan);
        else cached.delete(plan.inboundPlanId);
      }
      state.planCursor = token(page);
      if (state.planCursor) {
        if (!page.inboundPlans.length || state.seenPlanTokens.includes(state.planCursor)) invalid();
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
