import { OPERATIONS_SOURCES, type OperationsFinding, type OperationsIntelligenceSnapshot, type OperationsReadMetadata, type OperationsSource, type OperationsSourceState } from "../../shared/operations-intelligence";
import type { AmazonPromotionRevision, AmazonPromotionsSnapshot } from "../../shared/amazon-promotions";
import type { AwdInventorySnapshot, AwdInventoryQuantity } from "../../shared/awd-inventory";
import type { PriceHealthMoney, PriceHealthSnapshot } from "../../shared/price-health";
import type { AdvertisingDiagnosticsSnapshot } from "../../shared/advertising-diagnostics";

class OperationsIntelligenceError extends Error {}
export function operationsIntelligenceFailureMessage(reason: unknown): string {
  return reason instanceof OperationsIntelligenceError ? reason.message : "營運情報暫時無法讀取，已清除舊資料。請稍後重新讀取。";
}
function invalid(): never { throw new OperationsIntelligenceError("營運情報格式或安全脈絡不符，已清除舊資料。請更新 Notebook Key 後重新讀取。"); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(); return value as Record<string, unknown>; }
function string(value: unknown, max = 2000): string { if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) return invalid(); return value; }
function oneOf<T extends string>(value: unknown, choices: readonly T[]): T { if (typeof value !== "string" || !choices.includes(value as T)) return invalid(); return value as T; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") return invalid(); return value; }
function count(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid(); return value; }
function nonnegative(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return invalid(); return value; }
function currency(value: unknown): string { const result = string(value, 3); if (!/^[A-Z]{3}$/u.test(result)) return invalid(); return result; }
function money(value: unknown): PriceHealthMoney { const row = object(value); return { amount: nonnegative(row.amount), currencyCode: currency(row.currencyCode) }; }
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null { return value === null ? null : parse(value); }
function array<T>(value: unknown, parse: (value: unknown) => T, max = 10000): T[] { if (!Array.isArray(value) || value.length > max) return invalid(); return value.map(parse); }
function date(value: unknown): string { const result = string(value, 40); if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(result) || !Number.isFinite(Date.parse(result))) return invalid(); return result; }
function identity(value: unknown) { const row = object(value); const sellerSku = string(row.sellerSku, 200); const asin = string(row.asin, 10); if (!sellerSku || !/^[A-Z0-9]{10}$/u.test(asin)) return invalid(); return { sellerSku, asin }; }
function finding(value: unknown): OperationsFinding { const row = object(value); return { key: string(row.key, 500), source: oneOf(row.source, OPERATIONS_SOURCES), sellerSku: nullable(row.sellerSku, (v) => string(v, 200)), severity: oneOf(row.severity, ["info", "warning", "critical"]), title: string(row.title, 500), detail: string(row.detail) }; }
function metadata(row: Record<string, unknown>, marketplaceId: string, mode: "live" | "demo", source: OperationsSource): OperationsReadMetadata {
  if (row.marketplaceId !== marketplaceId || row.mode !== mode) return invalid();
  const findings = array(row.findings, finding);
  if (findings.some((item) => item.source !== source)) return invalid();
  return { marketplaceId, mode, fetchedAt: date(row.fetchedAt), coverage: oneOf(row.coverage, ["complete", "partial"]), warnings: array(row.warnings, (v) => string(v), 200), findings };
}
function revision(value: unknown): AmazonPromotionRevision {
  const row = object(value);
  return { status: oneOf(row.status, ["PROCESSING", "UPCOMING", "RUNNING", "EXPIRED", "FAILED", "CANCELLING", "CANCELLED", "UNKNOWN"]), startDate: nullable(row.startDate, date), endDate: nullable(row.endDate, date), selectionType: oneOf(row.selectionType, ["ITEMS", "CATALOG", "UNKNOWN"]), items: array(row.items, identity), issues: nullable(row.issues, (v) => array(v, (issue) => { const item = object(issue); return { code: nullable(item.code, (v) => string(v, 200)), severity: oneOf(item.severity, ["ERROR", "WARNING", "UNKNOWN"]) }; })), coverage: oneOf(row.coverage, ["complete", "partial"]) };
}
function promotions(value: unknown, marketplaceId: string, mode: "live" | "demo"): AmazonPromotionsSnapshot {
  const row = object(value);
  return { ...metadata(row, marketplaceId, mode, "promotions"), reportedTotal: nullable(row.reportedTotal, count), excludedPromotionCount: count(row.excludedPromotionCount), promotions: array(row.promotions, (v) => { const item = object(v); return { key: string(item.key, 500), title: string(item.title, 500), promotionType: oneOf(item.promotionType, ["BASKET_BUILDING", "DEAL", "PRICE_DISCOUNT", "COUPON", "UNKNOWN"]), published: revision(item.published), latestRevision: nullable(item.latestRevision, revision) }; }) };
}
function quantity(value: unknown): AwdInventoryQuantity { const row = object(value); return { quantity: nonnegative(row.quantity), unitOfMeasurement: oneOf(row.unitOfMeasurement, ["PRODUCT_UNITS", "CASES", "PALLETS"]) }; }
function awd(value: unknown, marketplaceId: string, mode: "live" | "demo"): AwdInventorySnapshot {
  const row = object(value);
  return { ...metadata(row, marketplaceId, mode, "awd"), stockScope: oneOf(row.stockScope, ["AWD_SHARED_DOWNSTREAM"]), inventoryCoverage: oneOf(row.inventoryCoverage, ["complete", "partial"]), shipmentCoverage: oneOf(row.shipmentCoverage, ["complete", "partial"]), excludedInventoryRows: count(row.excludedInventoryRows), rows: array(row.rows, (value) => { const item = object(value); return { ...identity(item), totalOnhandQuantity: nullable(item.totalOnhandQuantity, count), totalInboundQuantity: nullable(item.totalInboundQuantity, count), availableDistributableQuantity: nullable(item.availableDistributableQuantity, count), reservedDistributableQuantity: nullable(item.reservedDistributableQuantity, count), replenishmentQuantity: nullable(item.replenishmentQuantity, count), expirationDetails: nullable(item.expirationDetails, (v) => array(v, (value) => { const detail = object(value); return { expiration: nullable(detail.expiration, date), onhandQuantity: nullable(detail.onhandQuantity, count) }; })) }; }), shipments: array(row.shipments, (value) => { const item = object(value); return { id: string(item.id, 500), status: oneOf(item.status, ["CREATED", "SHIPPED", "IN_TRANSIT", "RECEIVING", "DELIVERED", "CLOSED", "CANCELLED", "UNKNOWN"]), updatedAt: nullable(item.updatedAt, date), coverage: oneOf(item.coverage, ["complete", "partial"]), rows: array(item.rows, (value) => { const product = object(value); return { ...identity(product), expectedQuantity: nullable(product.expectedQuantity, quantity), receivedQuantity: nullable(product.receivedQuantity, quantity), outstandingQuantity: nullable(product.outstandingQuantity, quantity) }; }) }; }) };
}
function priceHealth(value: unknown, marketplaceId: string, mode: "live" | "demo"): PriceHealthSnapshot {
  const row = object(value);
  return { ...metadata(row, marketplaceId, mode, "price-health"), rows: array(row.rows, (value) => { const item = object(value); return { ...identity(item), status: oneOf(item.status, ["observed", "needs-review", "insufficient-evidence"]), availability: oneOf(item.availability, ["complete", "partial", "unavailable"]), currentPrice: nullable(item.currentPrice, money), overallEligibility: oneOf(item.overallEligibility, ["unknown"]), featuredObservation: oneOf(item.featuredObservation, ["own-observed", "other-observed", "mixed-observed", "unknown"]), warnings: array(item.warnings, (v) => string(v), 200), segments: array(item.segments, (value) => { const segment = object(value); return { membership: oneOf(segment.membership, ["PRIME", "NON_PRIME", "DEFAULT", "unknown"]), isOwnSeller: nullable(segment.isOwnSeller, bool), fulfillment: oneOf(segment.fulfillment, ["AFN", "MFN", "unknown"]), listingPrice: nullable(segment.listingPrice, money), shippingPrice: nullable(segment.shippingPrice, money), glanceViewWeightPercentage: nullable(segment.glanceViewWeightPercentage, nonnegative) }; }), referencePrices: array(item.referencePrices, (value) => { const reference = object(value); return { name: oneOf(reference.name, ["CompetitivePriceThreshold", "CompetitivePrice", "WasPrice", "unknown"]), price: nullable(reference.price, money) }; }) }; }) };
}
function advertising(value: unknown, marketplaceId: string, mode: "live" | "demo"): AdvertisingDiagnosticsSnapshot {
  const row = object(value); const range = object(row.dateRange); const times = object(row.sourceFetchedAt);
  if (row.attributionWindowDays !== 14) return invalid();
  const startDate = date(range.startDate); const endDate = date(range.endDate); if (startDate > endDate) return invalid();
  return { ...metadata(row, marketplaceId, mode, "advertising"), kind: oneOf(row.kind, ["advertising"]), dateRange: { startDate, endDate }, currencyCode: currency(row.currencyCode), attributionWindowDays: 14, sourceFetchedAt: { fba: date(times.fba), sales: date(times.sales), ads: date(times.ads) }, notice: string(row.notice), rows: array(row.rows, (value) => { const item = object(value); return { ...identity(item), key: string(item.key, 500), status: oneOf(item.status, ["needs-review", "insufficient-evidence", "no-signal"]), spend: nullable(item.spend, nonnegative), attributedSales14d: nullable(item.attributedSales14d, nonnegative), purchases14d: nullable(item.purchases14d, count), acos: nullable(item.acos, nonnegative), acosStatus: oneOf(item.acosStatus, ["reported", "no-sales", "not-reported"]), roas: nullable(item.roas, nonnegative), roasStatus: oneOf(item.roasStatus, ["reported", "no-spend", "not-reported"]), suggestedAcos: nullable(item.suggestedAcos, nonnegative), rationale: array(item.rationale, (v) => string(v), 100) }; }) };
}

/** Validates and projects the Bridge response; unknown fields never enter view state. */
export function parseOperationsIntelligence(value: unknown, marketplaceId: string): OperationsIntelligenceSnapshot {
  const row = object(value);
  if (row.schemaVersion !== 1 || row.marketplaceId !== marketplaceId) return invalid();
  const mode = oneOf(row.mode, ["live", "demo"]);
  const rawSources = object(row.sources);
  function source(source: OperationsSource): OperationsSourceState {
    const item = object(rawSources[source]); if (item.source !== source) return invalid();
    const state: OperationsSourceState = { source, status: oneOf(item.status, ["never", "running", "complete", "partial", "failed"]), startedAt: nullable(item.startedAt, date), fetchedAt: nullable(item.fetchedAt, date), nextSyncAt: nullable(item.nextSyncAt, date), message: string(item.message), snapshot: nullable(item.snapshot, (value) => source === "promotions" ? promotions(value, marketplaceId, mode) : source === "awd" ? awd(value, marketplaceId, mode) : source === "price-health" ? priceHealth(value, marketplaceId, mode) : advertising(value, marketplaceId, mode)) };
    if ((state.status === "complete" || state.status === "partial") && (!state.snapshot || state.snapshot.coverage !== state.status)) return invalid();
    if (state.snapshot && state.fetchedAt !== state.snapshot.fetchedAt) return invalid();
    if (state.status === "never" && state.snapshot !== null) return invalid();
    return state;
  }
  return { schemaVersion: 1, marketplaceId, mode, contextId: string(row.contextId, 200), observedAt: date(row.observedAt), autoSync: bool(row.autoSync), sources: { promotions: source("promotions"), awd: source("awd"), "price-health": source("price-health"), advertising: source("advertising") }, omittedEventCount: count(row.omittedEventCount), notice: string(row.notice), events: array(row.events, (value) => { const item = object(value); return { ...finding(item), id: string(item.id, 500), firstObservedAt: date(item.firstObservedAt), lastObservedAt: date(item.lastObservedAt), status: oneOf(item.status, ["open", "acknowledged", "resolved"]), observation: oneOf(item.observation, ["local-sync"]) }; }) };
}

async function snapshotResponse(response: Response, marketplaceId: string): Promise<OperationsIntelligenceSnapshot> {
  if (!response.ok) throw new OperationsIntelligenceError(response.status === 404 ? "目前 Notebook Key 尚未支援營運情報，請更新桌面程式。" : response.status === 409 ? "帳號或站點安全脈絡已變更，已清除舊資料。請重新讀取。" : response.status === 401 || response.status === 403 ? "無法讀取營運情報：請確認本機連線與 API 角色授權。" : "營運情報暫時無法讀取，已清除舊資料。請稍後重新讀取。");
  return parseOperationsIntelligence(await response.json(), marketplaceId);
}
export async function readOperationsIntelligence(marketplaceId: string, signal: AbortSignal): Promise<OperationsIntelligenceSnapshot> {
  return snapshotResponse(await fetch(`/api/operations-intelligence?${new URLSearchParams({ marketplaceId })}`, { method: "GET", signal, cache: "no-store" }), marketplaceId);
}
export async function setOperationsEventStatus(marketplaceId: string, eventId: string, status: "open" | "acknowledged"): Promise<OperationsIntelligenceSnapshot> {
  return snapshotResponse(await fetch("/api/operations-intelligence/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketplaceId, eventId, status }) }), marketplaceId);
}
export async function syncOperationsIntelligence(marketplaceId: string, source: OperationsSource | "all"): Promise<OperationsIntelligenceSnapshot> {
  return snapshotResponse(await fetch("/api/operations-intelligence/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketplaceId, source }) }), marketplaceId);
}
export async function configureOperationsAutoSync(marketplaceId: string, autoSync: boolean): Promise<OperationsIntelligenceSnapshot> {
  return snapshotResponse(await fetch("/api/operations-intelligence/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketplaceId, autoSync }) }), marketplaceId);
}
