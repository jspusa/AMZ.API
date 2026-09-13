import { describe, expect, it } from "vitest";
import { assessInventoryHealth } from "../src/main/amazon/inventory-health";
import { inventoryHealthCalendarRows, isInventoryHealthSnapshot } from "../src/shared/inventory-health";

const now = new Date("2026-07-01T12:00:00Z");
const row = {
  sellerSku: "FBA-ONE", asin: "B000000001", title: "Test product", available: 1000,
  agedOver180: 500, estimatedExcessQuantity: 300, currencyCode: "USD",
  estimatedStorageCostNextMonth: 20, estimatedAgedSurcharge: 8,
  snapshotDate: "2026-07-01", unitsShipped: { t7: 70, t30: 300, t60: 600, t90: 900 },
};
const lot = { id: "lot-one", sellerSku: "FBA-ONE", asin: "B000000001",
  expiryDate: "2026-08-30", declaredQuantity: 1200, sourceRef: "inbound-one",
  sourceUpdatedAt: "2026-06-01T12:00:00Z", observedAt: now.toISOString(),
  stopSaleDate: null, confirmedRemaining: 1000, confirmedForSnapshot: "2026-07-01" };
const input = { marketplaceId: "ATVPDKIKX0DER" as const, mode: "live" as const,
  fetchedAt: now.toISOString(), rows: [row], lots: [lot], sourceComplete: true, now };

describe("inventory health evidence and calendar eligibility", () => {
  it("shows the independently worked 1000 units / 10 per day / 60 day shortfall", () => {
    const result = assessInventoryHealth(input);
    expect(result.rows[0]).toMatchObject({ status: "clearance-risk", dailyUnits: 10,
      daysRemaining: 60, projectedShortfall: 400, minimumDailyUnits: 1000 / 60,
      calendarEligible: true, confirmedRemaining: 1000 });
  });
  it("never treats a declared shipment or aged quantity as the remaining lot", () => {
    const result = assessInventoryHealth({ ...input, lots: [{ ...lot, confirmedRemaining: null, confirmedForSnapshot: null }] });
    expect(result.rows[0]).toMatchObject({ status: "needs-review", projectedShortfall: null, calendarEligible: false });
  });
  it("shows low-age full-stock clearance estimates and earliest declared date without inventing a lot shortfall", () => {
    const result = assessInventoryHealth({ ...input, sourceComplete: false,
      rows: [{ ...row, agedOver180: 0, unitsShipped: { t7: null, t30: 300, t60: null, t90: null } }],
      lots: [{ ...lot, confirmedRemaining: null, confirmedForSnapshot: null }] });
    expect(result.rows[0]).toMatchObject({ agedOver180: 0, wholeSkuClearanceDays: 100,
      estimatedDailyUnits: 10, earliestDeclaredExpiryDate: "2026-08-30", stockRisk: "may-outlast-expiry",
      status: "needs-review", projectedShortfall: null, calendarEligible: false });
  });
  it("keeps unknown age separate from usable stock estimates and incomplete expiry evidence", () => {
    const result = assessInventoryHealth({ ...input, sourceComplete: false,
      rows: [{ ...row, agedOver180: null }],
      lots: [{ ...lot, confirmedRemaining: null, confirmedForSnapshot: null }] });
    expect(isInventoryHealthSnapshot(result)).toBe(true);
    expect(result.rows[0]).toMatchObject({ agedOver180: null, wholeSkuClearanceDays: 100,
      estimatedDailyUnits: 10, stockRisk: "may-outlast-expiry", projectedShortfall: null,
      confirmedRemaining: null, calendarEligible: false });
    expect(inventoryHealthCalendarRows(result)).toEqual([]);
  });
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "0", undefined])(
    "rejects invalid supplementary age %s at the shared snapshot boundary", agedOver180 => {
      const result = assessInventoryHealth({ ...input, rows: [{ ...row, agedOver180: agedOver180 as number }] });
      expect(isInventoryHealthSnapshot(result)).toBe(false);
      expect(inventoryHealthCalendarRows(result)).toEqual([]);
    },
  );
  it("distinguishes reported zero sales, contradictory sales and stale estimates without infinity or invented zero", () => {
    const result = assessInventoryHealth({ ...input, rows: [{ ...row, agedOver180: 0, unitsShipped: { t7: 0, t30: 0, t60: 0, t90: 0 } }], lots: [] });
    expect(result.rows[0]).toMatchObject({ stockRisk: "no-sales", estimatedDailyUnits: 0, wholeSkuClearanceDays: null, earliestDeclaredExpiryDate: null, calendarEligible: false });
    const contradictory = assessInventoryHealth({ ...input, rows: [{ ...row, unitsShipped: { t7: 500, t30: 300, t60: null, t90: null } }] });
    expect(contradictory.rows[0]).toMatchObject({ stockRisk: "unknown", estimatedDailyUnits: null, wholeSkuClearanceDays: null, calendarEligible: false });
    const stale = assessInventoryHealth({ ...input, now: new Date("2026-07-06T12:00:00Z") });
    expect(stale.rows[0]).toMatchObject({ stockRisk: "unknown", estimatedDailyUnits: null, wholeSkuClearanceDays: null, calendarEligible: false });
  });
  it("retains multiple dates, but never allocates the entire SKU sales pace to each lot", () => {
    const result = assessInventoryHealth({ ...input, lots: [
      { ...lot, confirmedRemaining: 600 },
      { ...lot, id: "lot-two", expiryDate: "2026-09-29", confirmedRemaining: 400 },
    ] });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(r => r.id === "lot-one")?.calendarEligible).toBe(false);
    expect(result.rows.find(r => r.id === "lot-two")).toMatchObject({ calendarEligible: true, projectedShortfall: 100 });
  });
  it("uses the fastest complete reported pace before asserting a shortfall", () => {
    const result = assessInventoryHealth({ ...input, rows: [{ ...row, unitsShipped: { t7: 140, t30: 300, t60: 600, t90: 900 } }] });
    expect(result.rows[0]).toMatchObject({ dailyUnits: 20, status: "on-track", calendarEligible: false });
  });
  it("requires current, consistent inventory and complete velocity evidence", () => {
    for (const variant of [
      { ...input, sourceComplete: false },
      { ...input, rows: [{ ...row, unitsShipped: { ...row.unitsShipped, t7: null } }] },
      { ...input, rows: [{ ...row, available: 900 }] },
      { ...input, now: new Date("2026-07-06T12:00:00Z") },
      { ...input, lots: [{ ...lot, confirmedForSnapshot: "2026-06-30" }] },
    ]) expect(assessInventoryHealth(variant).rows[0].calendarEligible).toBe(false);
  });
});
