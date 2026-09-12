import type { InventoryHealthRow, InventoryHealthSnapshot } from "../../shared/inventory-health";
import type { MarketplaceId } from "../../shared/marketplaces";
import { isDateOnly, marketplaceCalendar } from "./marketplace-calendar";

export type InventoryHealthStock = Readonly<{
  sellerSku: string; asin: string; title: string; available: number | null;
  agedOver180: number; estimatedExcessQuantity: number | null; currencyCode: string | null;
  estimatedStorageCostNextMonth: number | null; estimatedAgedSurcharge: number | null;
  snapshotDate: string | null;
  unitsShipped?: Readonly<{ t7: number | null; t30: number | null; t60: number | null; t90: number | null }>;
}>;
export type InventoryExpiryRecord = Readonly<{
  id: string; sellerSku: string; asin: string; expiryDate: string | null;
  declaredQuantity: number | null; sourceRef: string; sourceLabel?: string; sourceUpdatedAt: string;
  observedAt: string; stopSaleDate: string | null;
  confirmedRemaining: number | null; confirmedForSnapshot: string | null;
  manualExpiryDate?: string | null;
}>;
export type InventoryHealthEvidence = Readonly<{
  marketplaceId: MarketplaceId; mode: "live" | "demo"; fetchedAt: string;
  rows: readonly InventoryHealthStock[]; lots: readonly InventoryExpiryRecord[];
  sourceComplete: boolean;
}>;

/** Clearance by deadline, using the fastest observed pace and cumulative confirmed lots. */
export function assessInventoryHealth(input: InventoryHealthEvidence & { now: Date }): InventoryHealthSnapshot {
  const calendar = marketplaceCalendar(input.marketplaceId);
  const today = calendar.dayAt(input.now);
  const elapsed = input.now.getTime() - Date.parse(input.fetchedAt);
  const stale = !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 48 * 3600000;
  const rows: InventoryHealthRow[] = [];
  const bySku = new Map<string, InventoryExpiryRecord[]>();
  for (const lot of input.lots) { const key = JSON.stringify([lot.sellerSku, lot.asin]); const group = bySku.get(key) ?? []; group.push(lot); bySku.set(key, group); }
  for (const stock of input.rows) {
    const records = bySku.get(JSON.stringify([stock.sellerSku, stock.asin])) ?? [];
    const lots: readonly InventoryExpiryRecord[] = records.length ? records : [{
      id: `missing:${stock.sellerSku}`, sellerSku: stock.sellerSku, asin: stock.asin,
      expiryDate: null, declaredQuantity: null, sourceRef: "尚無入庫效期",
      sourceUpdatedAt: input.fetchedAt, observedAt: input.fetchedAt,
      stopSaleDate: null, confirmedRemaining: null, confirmedForSnapshot: null,
    }];
    const validCount = (n: number | null | undefined): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
    const shipped = stock.unitsShipped;
    const allPaces = shipped && [shipped.t7, shipped.t30, shipped.t60, shipped.t90].every(validCount);
    const dailyUnits = allPaces ? Math.max(shipped!.t7! / 7, shipped!.t30! / 30, shipped!.t60! / 60, shipped!.t90! / 90) : null;
    const paceConsistent = allPaces && shipped!.t7! <= shipped!.t30! && shipped!.t30! <= shipped!.t60! && shipped!.t60! <= shipped!.t90!;
    const confirmedTotal = lots.reduce((sum, lot) => sum + (lot.confirmedRemaining ?? 0), 0);
    const stockCurrent = stock.snapshotDate !== null && isDateOnly(stock.snapshotDate) &&
      calendar.inclusiveDayCount(stock.snapshotDate, today) >= 1 && calendar.inclusiveDayCount(stock.snapshotDate, today) <= 3;
    const lotTarget = (l: InventoryExpiryRecord) => l.stopSaleDate ?? l.manualExpiryDate ?? l.expiryDate;
    for (const lot of lots) {
      const expiryDate = lot.manualExpiryDate ?? lot.expiryDate;
      const target = lotTarget(lot);
      const days = target && isDateOnly(target) ? calendar.inclusiveDayCount(today, target) - 1 : null;
      const dueLots = lots.filter(l => lotTarget(l) !== null && lotTarget(l)! <= (target ?? ""));
      const confirmed = dueLots.length > 0 && dueLots.every(l => validCount(l.confirmedRemaining) && l.confirmedForSnapshot === stock.snapshotDate);
      const quantityDueByDate = confirmed ? dueLots.reduce((sum, l) => sum + l.confirmedRemaining!, 0) : null;
      let reason = !input.sourceComplete ? "入庫效期來源未完整，請重新同步。"
        : stale || !stockCurrent ? "庫存快照已過期，請重新執行健檢。"
        : !expiryDate || !isDateOnly(expiryDate) || days === null || (lot.stopSaleDate !== null && lot.stopSaleDate > expiryDate) ? "效期或停售日待確認。"
        : !validCount(stock.available) || confirmedTotal > stock.available ? "批次餘量與目前可售庫存不一致。"
        : !confirmed || !validCount(lot.confirmedRemaining) ? "入庫申報數量不是批次餘量；請確認目前剩餘數量。"
        : !allPaces || !paceConsistent ? "7／30／60／90 天銷量缺漏或互相矛盾。"
        : "";
      const shortfall = !reason && quantityDueByDate !== null && dailyUnits !== null && days !== null
        ? Math.max(0, Math.ceil(quantityDueByDate - dailyUnits * Math.max(0, days) - 1e-9)) : null;
      const status = reason ? "needs-review" : shortfall! > 0 ? "clearance-risk" : "on-track";
      reason ||= status === "clearance-risk" ? "以最快已回報銷速推估，仍有到此日前的累計清售缺口。" : "依已確認批次與目前銷速，預估可在期限前清完。";
      rows.push({
        id: lot.id, sellerSku: stock.sellerSku, asin: stock.asin, title: stock.title,
        expiryDate, stopSaleDate: lot.stopSaleDate, sourceRef: lot.sourceRef, ...(lot.sourceLabel ? { sourceLabel: lot.sourceLabel } : {}), sourceUpdatedAt: lot.sourceUpdatedAt,
        declaredQuantity: lot.declaredQuantity, confirmedRemaining: lot.confirmedRemaining,
        available: stock.available, agedOver180: stock.agedOver180,
        estimatedExcessQuantity: stock.estimatedExcessQuantity, currencyCode: stock.currencyCode,
        estimatedStorageCostNextMonth: stock.estimatedStorageCostNextMonth, estimatedAgedSurcharge: stock.estimatedAgedSurcharge,
        dailyUnits, daysRemaining: days, quantityDueByDate, projectedShortfall: shortfall,
        minimumDailyUnits: shortfall !== null && days !== null && days > 0 ? quantityDueByDate! / days : null,
        wholeSkuClearanceDays: stock.available !== null && dailyUnits !== null && dailyUnits > 0 ? stock.available / dailyUnits : null,
        status, reason, calendarEligible: status === "clearance-risk", snapshotDate: stock.snapshotDate,
      });
    }
  }
  rows.sort((a, b) => Number(b.calendarEligible) - Number(a.calendarEligible) || (b.projectedShortfall ?? 0) - (a.projectedShortfall ?? 0) || a.sellerSku.localeCompare(b.sellerSku));
  return { schemaVersion: 1, marketplaceId: input.marketplaceId, mode: input.mode, fetchedAt: input.fetchedAt,
    sourceComplete: input.sourceComplete, stale, rows,
    notice: "入庫效期自動保存；只有已確認餘量且預估清不完的品項進入月曆。採7／30／60／90天最快平均銷速，預測不保證未來銷量。庫齡與入庫申報數量不代表現存效期批次餘量。" };
}
