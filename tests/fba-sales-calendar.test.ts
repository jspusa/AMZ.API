import { describe, expect, it } from "vitest";
import {
  FbaSalesPlanningError,
  planCompletedFbaSalesVelocity,
  planFbaSalesTrend,
} from "../src/main/amazon/fba-sales-calendar";
import { marketplaceCalendar } from "../src/main/amazon/marketplace-calendar";

const US_MARKETPLACE_ID = "ATVPDKIKX0DER" as const;

describe("FBA Sales Metrics calendar planning", () => {
  it("owns strict Marketplace Day and leap-year calendar operations", () => {
    const calendar = marketplaceCalendar(US_MARKETPLACE_ID);

    expect(calendar.isDateKey("2024-02-29")).toBe(true);
    expect(calendar.isDateKey("2026-02-29")).toBe(false);
    expect(calendar.isDateKey("2026-2-09")).toBe(false);
    expect(calendar.inclusiveDayCount("2024-02-28", "2024-03-01")).toBe(3);
    expect(calendar.exactYearShift("2024-02-29", -1)).toBeNull();
    expect(calendar.clampedYearShift("2024-02-29", -1)).toBe("2023-02-28");
    expect(calendar.formatInstant(calendar.midnight("2026-03-08"))).toBe(
      "2026-03-08T00:00:00-08:00",
    );
    expect(calendar.formatInstant(calendar.midnight("2026-03-09"))).toBe(
      "2026-03-09T00:00:00-07:00",
    );
  });

  it("rejects invalid Marketplace Days and non-integer calendar shifts", () => {
    const calendar = marketplaceCalendar(US_MARKETPLACE_ID);

    expect(() => calendar.shiftDate("2026-02-30", 0)).toThrow(RangeError);
    expect(() =>
      calendar.inclusiveDayCount("2026-02-28", "2026-02-30"),
    ).toThrow(RangeError);
    expect(() => calendar.midnight("2026-02-30")).toThrow(RangeError);
    expect(() => calendar.exactYearShift("2026-02-30", -1)).toThrow(
      RangeError,
    );
    expect(() => calendar.clampedYearShift("2026-02-30", -1)).toThrow(
      RangeError,
    );
    expect(() => calendar.shiftDate("2026-02-28", 0.5)).toThrow(RangeError);
    expect(() => calendar.exactYearShift("2026-02-28", -0.5)).toThrow(
      RangeError,
    );
  });

  it("maps an invalid marketplace to the planner's neutral error", () => {
    expect(() =>
      planFbaSalesTrend(
        {
          marketplaceId: "INVALID" as typeof US_MARKETPLACE_ID,
          days: 7,
        },
        new Date("2026-03-10T12:00:00.000Z"),
      ),
    ).toThrow(FbaSalesPlanningError);
  });

  it("plans an exact SKU over the fixed 30 completed Marketplace Days across US DST", () => {
    const plan = planCompletedFbaSalesVelocity(
      {
        marketplaceId: US_MARKETPLACE_ID,
        sellerSku: "EXACT-SKU",
      },
      new Date("2026-03-10T12:00:00.000Z"),
    );

    expect(plan).toMatchObject({
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku: "EXACT-SKU",
      completedDayCount: 30,
      window: {
        timeZone: "America/Los_Angeles",
        range: {
          startDate: "2026-02-08",
          endDate: "2026-03-09",
          dayCount: 30,
          presetDays: null,
        },
        startAt: "2026-02-08T00:00:00-08:00",
        endAt: "2026-03-10T00:00:00-07:00",
        partialDateKey: null,
      },
    });
    expect(plan.window.dateKeys).toHaveLength(30);
    expect(plan.window.intervals[28]).toBe(
      "2026-03-08T00:00:00-08:00--2026-03-09T00:00:00-07:00",
    );
  });

  it("plans a current partial FBA Sales Trend in Marketplace Days", () => {
    const plan = planFbaSalesTrend(
      {
        marketplaceId: US_MARKETPLACE_ID,
        days: 7,
      },
      new Date("2026-03-10T12:00:00.000Z"),
    );

    expect(plan).toMatchObject({
      range: {
        startDate: "2026-03-04",
        endDate: "2026-03-10",
        dayCount: 7,
        presetDays: 7,
      },
      window: {
        timeZone: "America/Los_Angeles",
        startAt: "2026-03-04T00:00:00-08:00",
        endAt: "2026-03-10T05:00:00-07:00",
        partialDateKey: "2026-03-10",
      },
      comparisonWindow: null,
      comparablePreviousYearDateKeys: null,
      comparisonNotice: null,
    });
    expect(plan.window.intervals[4]).toBe(
      "2026-03-08T00:00:00-08:00--2026-03-09T00:00:00-07:00",
    );
  });
});
