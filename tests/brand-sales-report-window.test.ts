import { describe, expect, it } from "vitest";
import {
  assertFbaShipmentSalesWindow,
  planFbaShipmentSalesWindow,
  strictReportDateKey,
  strictReportInstant,
} from "../src/main/amazon/revenue-report-windows";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const WINDOW_CREATED_AT = Date.parse("2026-08-09T12:00:00.000Z");

describe("FBA shipment-sales immutable report window", () => {
  it("keeps an ending-today cutoff immutable and visibly partial", () => {
    const fixed = planFbaShipmentSalesWindow({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-02",
      endDate: "2026-08-09",
      now: new Date(WINDOW_CREATED_AT),
    });

    expect(fixed).toEqual({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-02",
      endDate: "2026-08-09",
      dataStartTime: "2026-08-02T00:00:00-07:00",
      dataEndTime: "2026-08-09T05:00:00-07:00",
      windowCreatedAt: WINDOW_CREATED_AT,
      rangeFreshness: "includes-current-day",
    });
    expect(assertFbaShipmentSalesWindow(
      fixed,
      WINDOW_CREATED_AT + 60_000,
    )).toEqual(fixed);
  });

  it("accepts a historical range whose start and end use different DST offsets", () => {
    const fixed = planFbaShipmentSalesWindow({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-03-07",
      endDate: "2026-03-09",
      now: new Date(WINDOW_CREATED_AT),
    });

    expect(fixed).toMatchObject({
      dataStartTime: "2026-03-07T00:00:00-08:00",
      dataEndTime: "2026-03-10T00:00:00-07:00",
      rangeFreshness: "complete-days",
    });
    expect(assertFbaShipmentSalesWindow(fixed, WINDOW_CREATED_AT)).toEqual(fixed);
  });

  it.each([
    {
      dataStartTime: "2026-08-02 00:00:00-07:00",
      dataEndTime: "2026-08-09T00:00:00-07:00",
    },
    {
      dataStartTime: "2026-08-01T00:00:00-07:00",
      dataEndTime: "2026-08-09T00:00:00-07:00",
    },
    {
      dataStartTime: "2026-08-02T00:00:00-07:00",
      dataEndTime: "2026-08-09T00:00:00+14:01",
    },
  ])("rejects malformed or selection-mismatched fixed timestamps", (times) => {
    expect(() => assertFbaShipmentSalesWindow({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-02",
      endDate: "2026-08-08",
      ...times,
      windowCreatedAt: WINDOW_CREATED_AT,
    }, WINDOW_CREATED_AT)).toThrow(/固定查詢時間/iu);
  });

  it("rejects a future-created persisted window", () => {
    const future = planFbaShipmentSalesWindow({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-02",
      endDate: "2026-08-08",
      now: new Date(WINDOW_CREATED_AT + 10_000),
    });
    expect(() => assertFbaShipmentSalesWindow(
      future,
      WINDOW_CREATED_AT,
    )).toThrow(/固定查詢時間/iu);
  });

  it.each([
    ["2026-02-30", null],
    ["2026-08-02Tnot-a-time", null],
    ["2026-08-02T23:59:59", null],
    ["2026-08-02T24:00:00Z", null],
    ["2026-08-02T00:00:00+14:01", null],
    ["2026-08-02", "2026-08-02"],
    ["2026-08-02T00:00:00Z", "2026-08-02"],
  ])("strictly parses Amazon report date value %s", (value, expected) => {
    expect(strictReportDateKey(value)).toBe(expected);
  });

  it("matches zoned fixed timestamps by instant without accepting date-only values", () => {
    expect(strictReportInstant("2026-08-02T00:00:00-07:00")).toBe(
      Date.parse("2026-08-02T07:00:00Z"),
    );
    expect(strictReportInstant("2026-08-02")).toBeNull();
  });
});
