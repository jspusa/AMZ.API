import { createHash } from "node:crypto";
import { isInventoryExpirySourceFailure, type InventoryExpirySourceDiagnostics, type InventoryExpirySourceFailure } from "../../shared/inventory-expiry-source-diagnostics";
import { throwIfAborted } from "../abort-utils";
import { isPlainRecord } from "../route-input";
import type { InventoryExpiryRecord } from "./inventory-health";
import { fbaInboundExternalReadIdentity, type FbaInboundExternalReadAdapter } from "./fba-inbound-reads";
import type { ModernFbaInboundTransportRequest } from "./fba-inbound-modern";
import { FbaInboundRequestError } from "./fba-inbound-request-error";
import { isDateOnly } from "./marketplace-calendar";
import { SpApiError } from "./sp-api-error";
import type { SpExecutionContext, SpExecutionContextAdapter } from "./sp-execution-context";

type PlanSummary = { inboundPlanId: string; name?: string; lastUpdatedAt: string; status: "ACTIVE" | "SHIPPED" | "VOIDED" | "ERRORED" };
type LegacyCachedPlan = PlanSummary & { records: InventoryExpiryRecord[] };
type LegacyCurrentPlan = LegacyCachedPlan & { itemCursor: string | null; itemTokens: string[] };
type DeclaredItem = {
  sellerSku: string; asin: string; fnsku: string; expiryDate: string | null;
  manufacturingLotCode: string | null; quantity: number; observedAt: string;
};
type ItemSource = { shipmentId: string | null; shipmentStatus: string | null; items: DeclaredItem[] };
type CachedPlan = LegacyCachedPlan & { itemSources: ItemSource[]; planDetailUnavailable?: true };
type CurrentPlan = CachedPlan & {
  sourceIndex: number; itemCursor: string | null; itemTokens: string[];
};
type SourceRequest = Extract<ModernFbaInboundTransportRequest, { kind: "plan" | "shipment-items" | "plan-items" }>;
type SourceDiagnostic = Pick<InventoryExpirySourceFailure, "reason" | "code" | "responseState"> & { operation: SourceRequest["kind"]; page: "first" | "next" };
type LegacySourceDiagnostic = Omit<SourceDiagnostic, "code" | "responseState">;
type UnavailablePlan = PlanSummary & { reason: "upstream-unavailable"; upstreamStatus: 400 | 404 | 422; diagnostic?: SourceDiagnostic | LegacySourceDiagnostic };
// This observed metadata rejection does not establish that the independently
// addressed plan-items resource is unavailable. It never covers auth, malformed
// identifiers, response-shape conflicts, or unclassified transport failures.
function canReadDeclaredPlanItems(plan: UnavailablePlan): boolean {
  return plan.upstreamStatus === 400 && plan.diagnostic?.operation === "plan" && plan.diagnostic.page === "first" &&
    plan.diagnostic.reason === "other-input" && "code" in plan.diagnostic && plan.diagnostic.code === "BadRequest" &&
    "responseState" in plan.diagnostic && plan.diagnostic.responseState === "parsed";
}
const samePlanRevision = (a: PlanSummary, b: PlanSummary) => a.inboundPlanId === b.inboundPlanId && a.status === b.status &&
  revisionInstant(a.lastUpdatedAt) === revisionInstant(b.lastUpdatedAt);
/** Main-only continuation; the renderer gets only the separate human-readable source label. */
export type FbaExpiryCheckpoint = {
  schemaVersion: 2;
  scopeFingerprint: string;
  phase: "partial" | "complete";
  startedAt: string;
  cachedPlans: CachedPlan[];
  unavailablePlans: UnavailablePlan[];
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
  traversalComplete?: boolean;
  unavailablePlanCount?: number;
  checkpoint?: FbaExpiryCheckpoint;
}>;
const MAX_RECORDS = 10000;
const MAX_PLANS = 6000;
const MAX_SHIPMENTS = 10000;
const MAX_DECLARED_TOTAL = 100000000;
const MAX_REQUESTS_PER_SLICE = 100;
const MAX_CHECKPOINT_BYTES = 7 * 1024 * 1024;
const SHIPMENT_STATUSES = new Set(["ABANDONED", "CANCELLED", "CHECKED_IN", "CLOSED", "DELETED", "DELIVERED", "IN_TRANSIT", "MIXED", "READY_TO_SHIP", "RECEIVING", "SHIPPED", "UNCONFIRMED", "WORKING"]);
function sourceDiagnostic(value: unknown, status: 400 | 404 | 422): SourceDiagnostic {
  if (!isPlainRecord(value) || ![3, 5].includes(Object.keys(value).length) ||
    Object.keys(value).some(key => !["operation", "page", "reason", "code", "responseState"].includes(key))) invalid("checkpoint");
  const legacy = Object.keys(value).length === 3;
  if (legacy && (!Object.hasOwn(value, "operation") || !Object.hasOwn(value, "page") || !Object.hasOwn(value, "reason"))) invalid("checkpoint");
  const failure = { ...value, ...(legacy ? { code: "not-recorded", responseState: "not-recorded" } : {}), status, count: 1 };
  if (!isInventoryExpirySourceFailure(failure) || failure.operation === "unknown" || failure.page === "unknown") invalid("checkpoint");
  return { operation: failure.operation, page: failure.page, reason: failure.reason, code: failure.code, responseState: failure.responseState };
}
// Diagnostics identify the rejected field or invariant, never its upstream value.
const FAILURE_MESSAGES = {
  planShape: "Amazon 入庫計畫摘要格式無法辨識，已停止效期讀取。",
  planId: "Amazon 入庫計畫識別碼格式無法辨識，已停止效期讀取。",
  planUpdatedAt: "Amazon 入庫計畫更新時間格式無法辨識，已停止效期讀取。",
  planName: "Amazon 入庫計畫名稱格式無法辨識，已停止效期讀取。",
  planStatus: "Amazon 入庫計畫狀態無法辨識，已停止效期讀取。",
  planPage: "Amazon 入庫計畫清單格式無法辨識或超過單頁上限，已停止效期讀取。",
  planMarketplaces: "Amazon 入庫計畫站點資料無法核對，已停止效期讀取。",
  planDetail: "Amazon 入庫計畫內容與清單身分或版本不符，已停止效期讀取。",
  planShipments: "Amazon 入庫計畫的選定貨件無法核對，已停止效期讀取。",
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
function summary(raw: unknown, revisionFormat: "rfc3339" | "legacy" = "rfc3339"): PlanSummary {
  if (!isPlainRecord(raw)) invalid("planShape");
  const inboundPlanId = text(raw.inboundPlanId, 38, "planId");
  if (!/^[a-zA-Z0-9-]{38}$/.test(inboundPlanId)) invalid("planId", "identifierFormat");
  const lastUpdatedAt = date(raw.lastUpdatedAt, "planUpdatedAt");
  if (revisionFormat === "rfc3339") revisionInstant(lastUpdatedAt);
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
function savedRecords(raw: unknown, plan: PlanSummary, maximumQuantity = 500000): InventoryExpiryRecord[] {
  if (!Array.isArray(raw) || raw.length > MAX_RECORDS) invalid("checkpoint");
  return raw.map(record => {
    if (!isPlainRecord(record)) invalid("checkpoint");
    const id = text(record.id, 39, "checkpoint"), sellerSku = text(record.sellerSku, 40, "checkpoint"), asin = text(record.asin, 10, "checkpoint");
    const reference = text(record.sourceRef, 28, "checkpoint"), sourceUpdatedAt = date(record.sourceUpdatedAt, "checkpoint"), observedAt = date(record.observedAt, "checkpoint");
    const label = record.sourceLabel === undefined ? sourceLabel(plan) : text(record.sourceLabel, 512, "checkpoint");
    if (!/^expiry-[a-f0-9]{32}$/.test(id) || !/^[A-Z0-9]{10}$/.test(asin) || !/^inbound-[a-f0-9]{20}$/.test(reference) || sourceUpdatedAt !== plan.lastUpdatedAt ||
      !(record.expiryDate === null || (typeof record.expiryDate === "string" && isDateOnly(record.expiryDate))) ||
      typeof record.declaredQuantity !== "number" || !Number.isSafeInteger(record.declaredQuantity) || record.declaredQuantity < 1 || record.declaredQuantity > maximumQuantity ||
      record.stopSaleDate !== null || record.confirmedRemaining !== null || record.confirmedForSnapshot !== null || label !== sourceLabel(plan)) invalid("checkpointIntegrity");
    return { id, sellerSku, asin, expiryDate: record.expiryDate, declaredQuantity: record.declaredQuantity, sourceRef: reference, sourceLabel: label, sourceUpdatedAt, observedAt,
      stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null };
  });
}
type LegacyCheckpoint = Omit<FbaExpiryCheckpoint, "schemaVersion" | "cachedPlans" | "currentPlan" | "unavailablePlans"> & {
  schemaVersion: 1; cachedPlans: LegacyCachedPlan[]; currentPlan: LegacyCurrentPlan | null;
};
function parseLegacyCheckpoint(value: unknown, maximumQuantity = 500000, revisionFormat: "rfc3339" | "legacy" = "rfc3339"): LegacyCheckpoint | null {
  if (value === null || value === undefined) return null;
  if (!isPlainRecord(value) || value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(String(value.scopeFingerprint)) ||
    !["partial", "complete"].includes(String(value.phase)) || typeof value.planPagesComplete !== "boolean" ||
    !Array.isArray(value.cachedPlans) || value.cachedPlans.length > MAX_PLANS || !Array.isArray(value.pendingPlans) || value.pendingPlans.length > 30) invalid("checkpoint");
  const cachedPlans = value.cachedPlans.map(raw => {
    if (!isPlainRecord(raw)) invalid("checkpoint");
    const plan = summary(raw, revisionFormat);
    if (plan.status !== "ACTIVE" && plan.status !== "SHIPPED") invalid("checkpointIntegrity");
    return { ...plan, records: savedRecords(raw.records, plan, maximumQuantity) };
  });
  let currentPlan: LegacyCurrentPlan | null = null;
  if (value.currentPlan !== null) {
    if (!isPlainRecord(value.currentPlan)) invalid("checkpoint");
    const plan = summary(value.currentPlan, revisionFormat);
    if (plan.status !== "ACTIVE" && plan.status !== "SHIPPED") invalid("checkpointIntegrity");
    currentPlan = { ...plan, itemCursor: value.currentPlan.itemCursor === null ? null : text(value.currentPlan.itemCursor, 1024, "checkpoint"),
      itemTokens: strings(value.currentPlan.itemTokens, 200, 1024), records: savedRecords(value.currentPlan.records, plan, maximumQuantity) };
    if (currentPlan.itemCursor !== null && !currentPlan.itemTokens.includes(currentPlan.itemCursor)) invalid("checkpointIntegrity");
  }
  const pendingPlans = value.pendingPlans.map(raw => summary(raw, revisionFormat));
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
  const result: LegacyCheckpoint = { schemaVersion: 1, scopeFingerprint: String(value.scopeFingerprint), phase: value.phase as "partial" | "complete",
    startedAt: date(value.startedAt, "checkpoint"), cachedPlans, pendingPlans, currentPlan, planCursor, planPagesComplete: value.planPagesComplete, seenPlanIds, seenPlanTokens };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_CHECKPOINT_BYTES) invalid("limits");
  return result;
}

function item(raw: unknown, observedAt: string): DeclaredItem {
  if (!isPlainRecord(raw)) invalid("itemShape");
  const sellerSku = text(raw.msku, 40, "itemSku"), asin = text(raw.asin, 10, "itemAsin");
  const fnsku = text(raw.fnsku, 10, "itemFnsku");
  const manufacturingLotCode = raw.manufacturingLotCode === undefined ? null : text(raw.manufacturingLotCode, 256, "itemLot");
  if (!/^[A-Z0-9]{10}$/.test(asin)) invalid("itemAsin", "identifierFormat");
  const expiryDate = raw.expiration === undefined ? null : text(raw.expiration, 10, "itemExpiration");
  if (expiryDate !== null && !isDateOnly(expiryDate)) invalid("itemExpiration", "dateFormat");
  const quantity = raw.quantity;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 500000) invalid("itemQuantity");
  return { sellerSku, asin, fnsku, expiryDate, manufacturingLotCode, quantity, observedAt };
}
const batchKey = (row: DeclaredItem) => [row.sellerSku, row.asin, row.fnsku, row.expiryDate, row.manufacturingLotCode] as const;

/** Shipments may split one declared batch; retain the original stable plan-level identity. */
function aggregate(plan: PlanSummary, sources: ItemSource[], reference: string): InventoryExpiryRecord[] {
  const records = new Map<string, InventoryExpiryRecord>();
  for (const source of sources) {
    const seen = new Set<string>();
    for (const row of source.items) {
      const id = `expiry-${digest([reference, ...batchKey(row)]).slice(0, 32)}`;
      if (seen.has(id)) invalid("duplicateItem");
      seen.add(id);
      const previous = records.get(id);
      const quantity = (previous?.declaredQuantity ?? 0) + row.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > MAX_DECLARED_TOTAL) invalid("itemQuantity");
      records.set(id, { id, sellerSku: row.sellerSku, asin: row.asin, expiryDate: row.expiryDate,
        declaredQuantity: quantity, sourceRef: reference, sourceLabel: sourceLabel(plan), sourceUpdatedAt: plan.lastUpdatedAt,
        observedAt: previous && Date.parse(previous.observedAt) > Date.parse(row.observedAt) ? previous.observedAt : row.observedAt,
        stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null });
    }
  }
  return [...records.values()];
}

function shipmentId(value: unknown): string {
  const id = text(value, 38, "planShipments");
  if (!/^[A-Za-z0-9-]{38}$/.test(id)) invalid("planShipments", "identifierFormat");
  return id;
}
function shipmentStatus(value: unknown): string {
  const status = text(value, 1024, "planShipments");
  if (!SHIPMENT_STATUSES.has(status)) invalid("planShipments");
  return status;
}
function marketplaces(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20 || value.some(m => typeof m !== "string" || !m || m.length > 20 || m !== m.trim() || !/^[A-Z0-9]+$/.test(m)) || new Set(value).size !== value.length) invalid("planMarketplaces");
  return value as string[];
}
function revisionInstant(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isDateOnly(value.slice(0, 10)) || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value.slice(11, 19))) invalid("planUpdatedAt", "dateFormat");
  const seconds = Date.parse(match[1]! + match[3]!);
  if (!Number.isFinite(seconds)) invalid("planUpdatedAt", "dateFormat");
  return BigInt(seconds) * 1000000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}
function selectedSources(raw: Record<string, unknown>, expected: PlanSummary, marketplaceId: string): ItemSource[] {
  const detail = summary(raw);
  if (detail.inboundPlanId !== expected.inboundPlanId || revisionInstant(detail.lastUpdatedAt) !== revisionInstant(expected.lastUpdatedAt) || detail.status !== expected.status || !marketplaces(raw.marketplaceIds).includes(marketplaceId)) invalid("planDetail");
  // An absent optional shipment list is not proof of an empty plan. Its declared
  // unshipped items still require the complete plan-items traversal.
  if (raw.shipments === undefined) return [{ shipmentId: null, shipmentStatus: null, items: [] }];
  if (!Array.isArray(raw.shipments) || raw.shipments.length > MAX_SHIPMENTS) invalid("planShipments");
  const sources = raw.shipments.map(rawShipment => {
    if (!isPlainRecord(rawShipment)) invalid("planShipments");
    return { shipmentId: shipmentId(rawShipment.shipmentId), shipmentStatus: shipmentStatus(rawShipment.status), items: [] };
  });
  const ids = sources.map(source => source.shipmentId);
  if (new Set(ids).size !== ids.length) invalid("planShipments");
  return sources.length ? sources : [{ shipmentId: null, shipmentStatus: null, items: [] }];
}
function savedSources(raw: unknown): ItemSource[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SHIPMENTS) invalid("checkpoint");
  const sources = raw.map(source => {
    if (!isPlainRecord(source) || !Array.isArray(source.items) || source.items.length > MAX_RECORDS) invalid("checkpoint");
    const id = source.shipmentId === null ? null : shipmentId(source.shipmentId);
    if (id === null && source.shipmentStatus !== null) invalid("checkpointIntegrity");
    const status = id === null ? null : shipmentStatus(source.shipmentStatus);
    const items = source.items.map(row => {
      if (!isPlainRecord(row) || !(row.expiryDate === null || typeof row.expiryDate === "string") || !(row.manufacturingLotCode === null || typeof row.manufacturingLotCode === "string")) invalid("checkpoint");
      return item({ msku: row.sellerSku, asin: row.asin, fnsku: row.fnsku, quantity: row.quantity,
        ...(row.expiryDate === null ? {} : { expiration: row.expiryDate }),
        ...(row.manufacturingLotCode === null ? {} : { manufacturingLotCode: row.manufacturingLotCode }) }, date(row.observedAt, "checkpoint"));
    });
    return { shipmentId: id, shipmentStatus: status, items };
  });
  const ids = sources.map(source => source.shipmentId);
  if (new Set(ids).size !== ids.length || (ids.includes(null) && ids.length !== 1)) invalid("checkpointIntegrity");
  return sources;
}
function savedPlanDetailAvailability(raw: Record<string, unknown>, sources: ItemSource[]): { planDetailUnavailable?: true } {
  if (raw.planDetailUnavailable === undefined) return {};
  if (raw.planDetailUnavailable !== true || sources.length !== 1 || sources[0]!.shipmentId !== null) invalid("checkpointIntegrity");
  return { planDetailUnavailable: true };
}
function validateProvenance(plan: CachedPlan): void {
  const expected = aggregate(plan, plan.itemSources, plan.records[0]?.sourceRef ?? "");
  if (JSON.stringify(expected) !== JSON.stringify(plan.records)) invalid("checkpointIntegrity");
}

/** Validate, copy and migrate private continuation state before any external read. */
export function parseFbaExpiryCheckpoint(value: unknown): FbaExpiryCheckpoint | null {
  if (value === null || value === undefined) return null;
  if (!isPlainRecord(value) || ![1, 2].includes(Number(value.schemaVersion))) invalid("checkpoint");
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(value)); } catch { invalid("checkpoint"); }
  if (bytes > MAX_CHECKPOINT_BYTES) invalid("limits");
  if (value.schemaVersion === 1) {
    const previous = parseLegacyCheckpoint(value, 500000, "legacy")!;
    // Schema 1 did not prove selected shipment coverage. Keep the coordinator's
    // independent manual lots, but require a new source traversal and cache.
    return { schemaVersion: 2, scopeFingerprint: previous.scopeFingerprint, startedAt: previous.startedAt,
      phase: "partial", cachedPlans: [], unavailablePlans: [], pendingPlans: [], currentPlan: null,
      planCursor: null, planPagesComplete: false, seenPlanIds: [], seenPlanTokens: [] };
  }
  if (value.schemaVersion !== 2 || !Array.isArray(value.unavailablePlans) || value.unavailablePlans.length > MAX_PLANS) invalid("checkpoint");
  const legacy = parseLegacyCheckpoint({ ...value, schemaVersion: 1 }, MAX_DECLARED_TOTAL)!;
  const cachedPlans = legacy.cachedPlans.map((plan, index) => {
    const raw = (value.cachedPlans as Record<string, unknown>[])[index]!;
    const itemSources = savedSources(raw.itemSources);
    const parsed = { ...plan, itemSources, ...savedPlanDetailAvailability(raw, itemSources) };
    validateProvenance(parsed);
    return parsed;
  });
  let currentPlan: CurrentPlan | null = null;
  if (legacy.currentPlan) {
    const raw = value.currentPlan as Record<string, unknown>;
    const itemSources = savedSources(raw.itemSources);
    if (typeof raw.sourceIndex !== "number" || !Number.isInteger(raw.sourceIndex) || raw.sourceIndex < 0 || raw.sourceIndex >= itemSources.length ||
      itemSources.slice(raw.sourceIndex + 1).some(source => source.items.length > 0) ||
      (legacy.currentPlan.itemCursor === null && legacy.currentPlan.itemTokens.length > 0) ||
      (legacy.currentPlan.itemCursor === null && itemSources[raw.sourceIndex]!.items.length > 0) ||
      (legacy.currentPlan.itemCursor !== null && legacy.currentPlan.itemTokens.at(-1) !== legacy.currentPlan.itemCursor)) invalid("checkpointIntegrity");
    currentPlan = { ...legacy.currentPlan, itemSources, sourceIndex: raw.sourceIndex, ...savedPlanDetailAvailability(raw, itemSources) };
    validateProvenance(currentPlan);
  }
  const unavailablePlans = value.unavailablePlans.map(raw => {
    if (!isPlainRecord(raw) || raw.reason !== "upstream-unavailable" || ![400, 404, 422].includes(Number(raw.upstreamStatus))) invalid("checkpoint");
    const plan = summary(raw);
    if ((plan.status !== "ACTIVE" && plan.status !== "SHIPPED") || typeof raw.upstreamStatus !== "number") invalid("checkpointIntegrity");
    return { ...plan, reason: "upstream-unavailable" as const, upstreamStatus: raw.upstreamStatus as 400 | 404 | 422,
      ...(raw.diagnostic === undefined ? {} : { diagnostic: sourceDiagnostic(raw.diagnostic, raw.upstreamStatus as 400 | 404 | 422) }) };
  });
  const unavailableIds = unavailablePlans.map(plan => plan.inboundPlanId);
  const activePlans = [...cachedPlans, ...(currentPlan ? [currentPlan] : [])];
  const shipmentIds = activePlans.flatMap(plan => plan.itemSources.flatMap(source => source.shipmentId === null ? [] : [source.shipmentId]));
  const itemCount = activePlans.reduce((sum, plan) => sum + plan.itemSources.reduce((count, source) => count + source.items.length, 0), 0);
  if (new Set(unavailableIds).size !== unavailableIds.length || unavailableIds.some(id => activePlans.some(plan => plan.inboundPlanId === id)) ||
    (legacy.phase === "complete" && unavailableIds.some(id => !legacy.seenPlanIds.includes(id))) ||
    new Set(shipmentIds).size !== shipmentIds.length) invalid("checkpointIntegrity");
  if (shipmentIds.length > MAX_SHIPMENTS || itemCount > MAX_RECORDS) invalid("limits");
  return { ...legacy, schemaVersion: 2, cachedPlans, currentPlan, unavailablePlans };
}
function freshCheckpoint(context: SpExecutionContext, now: string, cachedPlans: CachedPlan[] = [], unavailablePlans: UnavailablePlan[] = []): FbaExpiryCheckpoint {
  return { schemaVersion: 2, scopeFingerprint: scopeFingerprint(context), phase: "partial", startedAt: now, cachedPlans, unavailablePlans,
    pendingPlans: [], currentPlan: null, planCursor: null, planPagesComplete: false, seenPlanIds: [], seenPlanTokens: [] };
}

/** Pure historical projection. It cannot resume a cursor, revalidate stock or read Amazon. */
export function projectFbaExpirySourceDiagnostics(value: unknown, context: SpExecutionContext, now: Date): InventoryExpirySourceDiagnostics {
  if (value === null || value === undefined) return { status: "unknown", reason: "not-recorded" };
  let checkpoint: FbaExpiryCheckpoint | null;
  try { checkpoint = parseFbaExpiryCheckpoint(value); }
  catch { return { status: "unknown", reason: "invalid-checkpoint" }; }
  if (!checkpoint || checkpoint.scopeFingerprint !== scopeFingerprint(context)) return { status: "unknown", reason: "context-mismatch" };
  if (isPlainRecord(value) && value.schemaVersion === 1) return { status: "unknown", reason: "legacy-checkpoint" };
  let startedAt: bigint;
  try { startedAt = revisionInstant(checkpoint.startedAt); }
  catch { return { status: "unknown", reason: "invalid-checkpoint" }; }
  const age = now.getTime() - Date.parse(checkpoint.startedAt);
  if (!Number.isFinite(age) || age < 0 || startedAt > BigInt(now.getTime()) * 1000000n) return { status: "unknown", reason: "stale-checkpoint" };
  for (const plan of [...checkpoint.cachedPlans, ...(checkpoint.currentPlan ? [checkpoint.currentPlan] : [])]) {
    if (plan.records.some(record => record.sourceRef !== sourceRef(context, plan.inboundPlanId))) return { status: "unknown", reason: "context-mismatch" };
  }
  // Continuations retain prior caches and rejection tombstones. Only sources
  // already processed in this listing pass belong in its completed counts.
  const listed = new Set(checkpoint.seenPlanIds);
  const pending = new Set([...checkpoint.pendingPlans.map(plan => plan.inboundPlanId), ...(checkpoint.currentPlan ? [checkpoint.currentPlan.inboundPlanId] : [])]);
  const processed = (id: string) => listed.has(id) && !pending.has(id);
  const unavailable = checkpoint.unavailablePlans.filter(plan => processed(plan.inboundPlanId));
  const unavailableIds = new Set(unavailable.map(plan => plan.inboundPlanId));
  const cachedPlanCount = checkpoint.cachedPlans.filter(plan => processed(plan.inboundPlanId) && !unavailableIds.has(plan.inboundPlanId)).length;
  const planItemFallbackCount = checkpoint.cachedPlans.filter(plan => processed(plan.inboundPlanId) && !unavailableIds.has(plan.inboundPlanId) && plan.planDetailUnavailable).length;
  const statusCounts = { "400": 0, "404": 0, "422": 0 };
  const failures = new Map<string, InventoryExpirySourceFailure>();
  for (const plan of unavailable) {
    statusCounts[plan.upstreamStatus] += 1;
    const failure: InventoryExpirySourceFailure = { ...(plan.diagnostic ? sourceDiagnostic(plan.diagnostic, plan.upstreamStatus)
      : { operation: "unknown", page: "unknown", reason: "unknown", code: "not-recorded", responseState: "not-recorded" }), status: plan.upstreamStatus, count: 1 };
    const key = JSON.stringify([failure.operation, failure.page, failure.status, failure.reason, failure.code, failure.responseState]);
    failures.set(key, { ...failure, count: (failures.get(key)?.count ?? 0) + 1 });
  }
  return { status: "available", recordedAt: new Date(checkpoint.startedAt).toISOString(), stale: age > 30 * 60 * 1000,
    traversal: checkpoint.phase, listedPlanCount: checkpoint.seenPlanIds.length,
    pendingPlanCount: pending.size, cachedPlanCount, unavailablePlanCount: unavailable.length,
    statusCounts, failures: [...failures.values()], ...(planItemFallbackCount ? { planItemFallbackCount } : {}) };
}

/** Reads declared dates only. Each slice can be persisted before its successor starts. */
export class FbaExpiryReads {
  constructor(private readonly input: Readonly<{ adapter: FbaInboundExternalReadAdapter; context: SpExecutionContextAdapter; now?: () => Date }>) {}

  async read(input: Readonly<{ context: SpExecutionContext; signal: AbortSignal; checkpoint?: unknown }>): Promise<FbaExpiryEvidence> {
    const observedAt = (this.input.now?.() ?? new Date()).toISOString();
    const parsed = parseFbaExpiryCheckpoint(input.checkpoint);
    if (parsed && parsed.scopeFingerprint !== scopeFingerprint(input.context)) invalid("contextIdentity");
    let state = parsed ?? freshCheckpoint(input.context, observedAt);
    // A completed traversal is a new explicit scan. Expired pagination restarts
    // listing, retaining rejected plan IDs so the same traversal never retries them.
    const age = Date.parse(observedAt) - Date.parse(state.startedAt);
    if (state.phase === "complete") state = freshCheckpoint(input.context, observedAt, state.cachedPlans, state.unavailablePlans.filter(canReadDeclaredPlanItems));
    else if (age < 0 || age > 30 * 60 * 1000) state = freshCheckpoint(input.context, observedAt, state.cachedPlans, state.unavailablePlans);
    await this.input.context.assertCurrent(input.context); throwIfAborted(input.signal);
    if (input.context.mode === "demo") {
      const checkpoint = { ...freshCheckpoint(input.context, observedAt), phase: "complete" as const, planPagesComplete: true };
      return { records: [], complete: true, traversalComplete: true, unavailablePlanCount: 0, checkpoint };
    }
    for (const plan of [...state.cachedPlans, ...(state.currentPlan ? [state.currentPlan] : [])]) {
      if (plan.records.some(record => record.sourceRef !== sourceRef(input.context, plan.inboundPlanId))) invalid("checkpointIntegrity");
    }
    const cached = new Map(state.cachedPlans.map(plan => [plan.inboundPlanId, plan]));
    const unavailable = new Map(state.unavailablePlans.map(plan => [plan.inboundPlanId, plan]));
    let requests = 0;
    const read = async (request: ModernFbaInboundTransportRequest) => {
      requests += 1;
      throwIfAborted(input.signal);
      await this.input.context.assertCurrent(input.context);
      const plan = { source: "modern" as const, marketplaceId: input.context.marketplaceId, request, signal: input.signal };
      let result;
      try { result = await this.input.adapter.read(plan); }
      catch (error) {
        await this.input.context.assertCurrent(input.context);
        throwIfAborted(input.signal);
        throw error;
      }
      await this.input.context.assertCurrent(input.context);
      throwIfAborted(input.signal);
      if (JSON.stringify(result.identity) !== JSON.stringify(fbaInboundExternalReadIdentity(plan))) invalid("contextIdentity");
      if (!isPlainRecord(result.envelope)) invalid("envelope");
      return result.envelope;
    };
    const readSelectedPlan = async (plan: PlanSummary, request: SourceRequest) => {
      try { return await read(request); }
      catch (error) {
        if (!(error instanceof SpApiError) || error.code !== "FBA_INBOUND_UPSTREAM_UNAVAILABLE" || ![400, 404, 422].includes(error.status)) throw error;
        // These HTTP statuses prove only that this source was unreadable. Retain
        // no upstream text and no partial items; other independently selected plans can continue.
        unavailable.set(plan.inboundPlanId, { inboundPlanId: plan.inboundPlanId, ...(plan.name === undefined ? {} : { name: plan.name }),
          lastUpdatedAt: plan.lastUpdatedAt, status: plan.status, reason: "upstream-unavailable", upstreamStatus: error.status as 400 | 404 | 422,
          diagnostic: sourceDiagnostic({ operation: request.kind, page: request.kind !== "plan" && request.paginationToken ? "next" : "first",
            reason: error instanceof FbaInboundRequestError ? error.requestDiagnostic.reason : "unknown",
            code: error instanceof FbaInboundRequestError ? error.requestDiagnostic.code : "unknown",
            responseState: error instanceof FbaInboundRequestError ? error.requestDiagnostic.state : "not-recorded" }, error.status as 400 | 404 | 422) });
        cached.delete(plan.inboundPlanId);
        state.currentPlan = null;
        return null;
      }
    };
    const assertLimits = () => {
      const plans = [...cached.values(), ...(state.currentPlan ? [state.currentPlan] : [])];
      const shipmentIds = plans.flatMap(plan => plan.itemSources.flatMap(source => source.shipmentId === null ? [] : [source.shipmentId]));
      if (new Set(shipmentIds).size !== shipmentIds.length) invalid("planShipments");
      if (shipmentIds.length > MAX_SHIPMENTS || plans.reduce((sum, plan) => sum + plan.itemSources.reduce((count, source) => count + source.items.length, 0), 0) > MAX_RECORDS) invalid("limits");
    };
    while (requests < MAX_REQUESTS_PER_SLICE) {
      if (state.currentPlan) {
        const current = state.currentPlan;
        const source = current.itemSources[current.sourceIndex]!;
        const page = await readSelectedPlan(current, source.shipmentId === null
          ? { kind: "plan-items", inboundPlanId: current.inboundPlanId, paginationToken: current.itemCursor }
          : { kind: "shipment-items", inboundPlanId: current.inboundPlanId, shipmentId: source.shipmentId, paginationToken: current.itemCursor });
        if (page === null) continue;
        if (!Array.isArray(page.items) || page.items.length > 1000) invalid("itemPage");
        source.items.push(...page.items.map(raw => item(raw, observedAt)));
        assertLimits();
        current.records = aggregate(current, current.itemSources, sourceRef(input.context, current.inboundPlanId));
        current.itemCursor = token(page);
        if (current.itemCursor) {
          if (!page.items.length || current.itemTokens.includes(current.itemCursor) || current.itemTokens.length >= 200) invalid("pagination");
          current.itemTokens.push(current.itemCursor);
        } else if (current.sourceIndex + 1 < current.itemSources.length) {
          current.sourceIndex += 1;
          current.itemTokens = [];
        } else {
          const { sourceIndex: _index, itemCursor: _cursor, itemTokens: _tokens, ...completed } = current;
          cached.set(current.inboundPlanId, completed);
          state.currentPlan = null;
        }
        continue;
      }
      if (state.pendingPlans.length) {
        const plan = state.pendingPlans.shift()!;
        if (plan.status === "VOIDED" || plan.status === "ERRORED") { cached.delete(plan.inboundPlanId); unavailable.delete(plan.inboundPlanId); continue; }
        const rejected = unavailable.get(plan.inboundPlanId);
        const previous = cached.get(plan.inboundPlanId);
        const useDeclaredItems = () => {
          // A plan-items resource is not an empty or unshipped manifest. Preserve
          // that distinction in the checkpoint and completed-source projection.
          unavailable.delete(plan.inboundPlanId);
          cached.delete(plan.inboundPlanId);
          state.currentPlan = { ...plan, planDetailUnavailable: true,
            itemSources: [{ shipmentId: null, shipmentStatus: null, items: [] }],
            sourceIndex: 0, itemCursor: null, itemTokens: [], records: [] };
          assertLimits();
        };
        if (rejected) {
          if (!canReadDeclaredPlanItems(rejected)) continue;
          if (samePlanRevision(rejected, plan)) { useDeclaredItems(); continue; }
          // A different freshly listed revision is a different source, so the
          // old metadata rejection cannot authorize its item-source selection.
          unavailable.delete(plan.inboundPlanId);
        }
        if (previous?.planDetailUnavailable && samePlanRevision(previous, plan)) { useDeclaredItems(); continue; }
        const page = await readSelectedPlan(plan, { kind: "plan", inboundPlanId: plan.inboundPlanId });
        if (page === null) {
          const failure = unavailable.get(plan.inboundPlanId);
          if (failure && canReadDeclaredPlanItems(failure)) useDeclaredItems();
          continue;
        }
        const itemSources = selectedSources(page, plan, input.context.marketplaceId);
        if (!previous?.planDetailUnavailable && previous?.lastUpdatedAt === plan.lastUpdatedAt && previous.status === plan.status &&
          JSON.stringify(previous.itemSources.map(source => [source.shipmentId, source.shipmentStatus]).sort()) === JSON.stringify(itemSources.map(source => [source.shipmentId, source.shipmentStatus]).sort())) {
          cached.set(plan.inboundPlanId, { ...plan, itemSources: previous.itemSources, records: previous.records.map(record => ({ ...record, sourceLabel: sourceLabel(plan) })) });
          continue;
        }
        cached.delete(plan.inboundPlanId);
        state.currentPlan = { ...plan, itemSources, sourceIndex: 0, itemCursor: null, itemTokens: [], records: [] };
        assertLimits();
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
        if (marketplaces(raw.marketplaceIds).includes(input.context.marketplaceId)) state.pendingPlans.push(plan);
        else { cached.delete(plan.inboundPlanId); unavailable.delete(plan.inboundPlanId); }
      }
      state.planCursor = token(page);
      if (state.planCursor) {
        if (!page.inboundPlans.length || state.seenPlanTokens.includes(state.planCursor)) invalid("pagination");
        state.seenPlanTokens.push(state.planCursor);
      } else state.planPagesComplete = true;
    }
    if (state.planPagesComplete && state.pendingPlans.length === 0 && state.currentPlan === null) state.phase = "complete";
    if (state.phase === "complete") {
      for (const id of cached.keys()) if (!state.seenPlanIds.includes(id)) cached.delete(id);
      for (const id of unavailable.keys()) if (!state.seenPlanIds.includes(id)) unavailable.delete(id);
    }
    state.cachedPlans = [...cached.values()];
    state.unavailablePlans = [...unavailable.values()];
    const checkpoint = parseFbaExpiryCheckpoint(state)!;
    await this.input.context.assertCurrent(input.context); throwIfAborted(input.signal);
    const traversalComplete = checkpoint.phase === "complete";
    return { records: checkpoint.cachedPlans.flatMap(plan => plan.records.map(record => ({ ...record }))),
      complete: traversalComplete && checkpoint.unavailablePlans.length === 0, traversalComplete,
      unavailablePlanCount: checkpoint.unavailablePlans.length, checkpoint };
  }
}
