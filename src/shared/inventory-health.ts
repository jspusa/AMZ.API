import { marketplaceById, type MarketplaceId } from "./marketplaces";

export type InventoryHealthStatus = "clearance-risk" | "on-track" | "needs-review";
export type InventoryHealthRow = Readonly<{
  id: string;
  sellerSku: string;
  asin: string;
  title: string;
  expiryDate: string | null;
  stopSaleDate: string | null;
  sourceRef: string;
  sourceLabel?: string;
  sourceUpdatedAt: string;
  declaredQuantity: number | null;
  confirmedRemaining: number | null;
  available: number | null;
  agedOver180: number;
  estimatedExcessQuantity: number | null;
  currencyCode: string | null;
  estimatedStorageCostNextMonth: number | null;
  estimatedAgedSurcharge: number | null;
  dailyUnits: number | null;
  daysRemaining: number | null;
  quantityDueByDate: number | null;
  projectedShortfall: number | null;
  minimumDailyUnits: number | null;
  wholeSkuClearanceDays: number | null;
  estimatedDailyUnits?: number | null;
  earliestDeclaredExpiryDate?: string | null;
  stockRisk?: "may-outlast-expiry" | "slow-selling" | "no-sales" | "none" | "unknown";
  status: InventoryHealthStatus;
  reason: string;
  calendarEligible: boolean;
  snapshotDate: string | null;
}>;
export type InventoryHealthSnapshot = Readonly<{
  schemaVersion: 1;
  marketplaceId: MarketplaceId;
  mode: "live" | "demo";
  fetchedAt: string;
  sourceComplete: boolean;
  stale: boolean;
  rows: readonly InventoryHealthRow[];
  notice: string;
}>;

function dateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
export function isInventoryHealthSnapshot(value: unknown): value is InventoryHealthSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 || typeof v.marketplaceId !== "string" || !marketplaceById(v.marketplaceId) ||
    (v.mode !== "live" && v.mode !== "demo") || typeof v.fetchedAt !== "string" || !Number.isFinite(Date.parse(v.fetchedAt)) ||
    typeof v.sourceComplete !== "boolean" || typeof v.stale !== "boolean" || typeof v.notice !== "string" ||
    !Array.isArray(v.rows) || v.rows.length > 10000) return false;
  const ids = new Set<string>();
  return v.rows.every((row: unknown) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    if (!["id", "sellerSku", "asin", "title", "sourceRef", "sourceUpdatedAt", "reason"].every(k => typeof r[k] === "string" && r[k].length <= 4000) || ids.has(String(r.id)) ||
      !Number.isFinite(Date.parse(String(r.sourceUpdatedAt))) ||
      !["expiryDate", "stopSaleDate", "snapshotDate"].every(k => r[k] === null || dateOnly(r[k])) ||
      !(r.currencyCode === null || (typeof r.currencyCode === "string" && /^[A-Z]{3}$/.test(r.currencyCode))) ||
      !["declaredQuantity", "confirmedRemaining", "available", "estimatedExcessQuantity", "quantityDueByDate", "projectedShortfall"].every(k => r[k] === null || count(r[k])) ||
      !["estimatedStorageCostNextMonth", "estimatedAgedSurcharge", "dailyUnits", "minimumDailyUnits", "wholeSkuClearanceDays"].every(k => r[k] === null || nonnegative(r[k])) ||
      !(r.daysRemaining === null || (typeof r.daysRemaining === "number" && Number.isSafeInteger(r.daysRemaining))) ||
      !count(r.agedOver180) || !["clearance-risk", "on-track", "needs-review"].includes(String(r.status)) || typeof r.calendarEligible !== "boolean") return false;
    if (r.sourceLabel !== undefined && (typeof r.sourceLabel !== "string" || r.sourceLabel.length > 512 || /[\p{Cc}\p{Cf}]/u.test(r.sourceLabel))) return false;
    if (r.estimatedDailyUnits !== undefined && r.estimatedDailyUnits !== null && !nonnegative(r.estimatedDailyUnits)) return false;
    if (r.earliestDeclaredExpiryDate !== undefined && r.earliestDeclaredExpiryDate !== null && !dateOnly(r.earliestDeclaredExpiryDate)) return false;
    if (r.stockRisk !== undefined && !["may-outlast-expiry", "slow-selling", "no-sales", "none", "unknown"].includes(String(r.stockRisk))) return false;
    ids.add(String(r.id));
    if (r.status === "needs-review") return !r.calendarEligible && r.projectedShortfall === null;
    const evidence = v.sourceComplete && !v.stale && dateOnly(r.expiryDate) && dateOnly(r.snapshotDate) &&
      count(r.confirmedRemaining) && count(r.available) && Number(r.confirmedRemaining) <= Number(r.available) &&
      count(r.quantityDueByDate) && Number(r.quantityDueByDate) <= Number(r.available) && nonnegative(r.dailyUnits) &&
      r.daysRemaining !== null && count(r.projectedShortfall) && (r.stopSaleDate === null || String(r.stopSaleDate) <= String(r.expiryDate));
    return Boolean(evidence) && (r.status === "clearance-risk"
      ? r.calendarEligible && Number(r.projectedShortfall) > 0
      : !r.calendarEligible && r.projectedShortfall === 0);
  });
}

/** One earliest actionable deadline per SKU keeps automatic calendar reminders sparse. */
export function inventoryHealthCalendarRows(snapshot: InventoryHealthSnapshot): readonly InventoryHealthRow[] {
  if (!isInventoryHealthSnapshot(snapshot) || snapshot.stale || !snapshot.sourceComplete) return [];
  const first = new Map<string, InventoryHealthRow>();
  const rows = snapshot.rows.filter(row => row.calendarEligible).slice().sort((a, b) =>
    (a.stopSaleDate ?? a.expiryDate!).localeCompare(b.stopSaleDate ?? b.expiryDate!) || (b.projectedShortfall ?? 0) - (a.projectedShortfall ?? 0));
  for (const row of rows) if (!first.has(row.sellerSku)) first.set(row.sellerSku, row);
  return [...first.values()];
}
