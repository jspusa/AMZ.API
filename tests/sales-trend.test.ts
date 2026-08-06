import { describe, expect, it } from "vitest";
import {
  SpApiError,
  buildSalesTrendQuery,
  buildSalesTrendWindow,
  normalizeSalesTrendResponse,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");

describe("FBA sales trend contract", () => {
  it("builds one AFN-only daily Sales API request", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    const query = buildSalesTrendQuery(MARKETPLACE_ID, window);

    expect(query.getAll("marketplaceIds")).toEqual([MARKETPLACE_ID]);
    expect(query.get("granularity")).toBe("Day");
    expect(query.get("buyerType")).toBe("All");
    expect(query.get("fulfillmentNetwork")).toBe("AFN");
    expect(query.get("granularityTimeZone")).toBe("America/Los_Angeles");
  });

  it("uses marketplace calendar days and preserves DST offsets", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);

    expect(window.dateKeys).toEqual([
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(window.startAt).toBe("2026-03-04T00:00:00-08:00");
    expect(window.endAt).toBe("2026-03-10T05:00:00-07:00");
    expect(window.intervals[3]).toContain(
      "2026-03-07T00:00:00-08:00--2026-03-08T00:00:00-08:00",
    );
    expect(window.intervals[4]).toContain(
      "2026-03-08T00:00:00-08:00--2026-03-09T00:00:00-07:00",
    );
  });

  it("maps equivalent UTC intervals back to the marketplace calendar date", () => {
    const marketplaceId = "A1VC38T7YXB528" as const;
    const window = buildSalesTrendWindow(
      marketplaceId,
      7,
      new Date("2026-08-06T03:00:00.000Z"),
    );
    const [start, end] = window.intervals[0].split("--");
    const interval = `${new Date(start).toISOString()}--${new Date(end).toISOString()}`;
    const normalized = normalizeSalesTrendResponse({
      marketplaceId,
      days: 7,
      window,
      response: {
        payload: [
          {
            interval,
            unitCount: 1,
            orderItemCount: 1,
            orderCount: 1,
            totalSales: { amount: "1200", currencyCode: "JPY" },
          },
        ],
      },
    });

    expect(normalized.points[0]).toMatchObject({
      date: window.dateKeys[0],
      totalSales: { amount: 1200, currencyCode: "JPY" },
    });
  });

  it("zero-fills missing dates and totals all daily buckets", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    const normalized = normalizeSalesTrendResponse({
      marketplaceId: MARKETPLACE_ID,
      days: 7,
      window,
      response: {
        payload: [
          {
            interval: window.intervals[0],
            unitCount: 2,
            orderItemCount: 2,
            orderCount: 2,
            totalSales: { amount: "35.98", currencyCode: "USD" },
          },
          {
            interval: window.intervals[6],
            unitCount: 3,
            orderItemCount: 3,
            orderCount: 2,
            totalSales: { amount: "53.97", currencyCode: "USD" },
          },
        ],
      },
    });

    expect(normalized.points).toHaveLength(7);
    expect(normalized.points[1].totalSales.amount).toBe(0);
    expect(normalized.points[6].partial).toBe(true);
    expect(normalized.totals).toEqual({
      totalSales: { amount: 89.95, currencyCode: "USD" },
      unitCount: 5,
      orderItemCount: 5,
      orderCount: 4,
    });
  });

  it("rejects payload errors and cross-currency buckets", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    expect(() =>
      normalizeSalesTrendResponse({
        marketplaceId: MARKETPLACE_ID,
        days: 7,
        window,
        response: { errors: [{ code: "InvalidInput", message: "Invalid metrics" }], payload: [] },
      }),
    ).toThrow(SpApiError);

    expect(() =>
      normalizeSalesTrendResponse({
        marketplaceId: MARKETPLACE_ID,
        days: 7,
        window,
        response: {
          payload: [
            {
              interval: window.intervals[0],
              unitCount: 1,
              orderItemCount: 1,
              orderCount: 1,
              totalSales: { amount: "10", currencyCode: "CAD" },
            },
          ],
        },
      }),
    ).toThrow(SpApiError);
  });

  it("rejects malformed array entries as upstream data errors", () => {
    const window = buildSalesTrendWindow(MARKETPLACE_ID, 7, NOW);
    expect(() =>
      normalizeSalesTrendResponse({
        marketplaceId: MARKETPLACE_ID,
        days: 7,
        window,
        response: { payload: [null] },
      }),
    ).toThrow(SpApiError);
    expect(() =>
      normalizeSalesTrendResponse({
        marketplaceId: MARKETPLACE_ID,
        days: 7,
        window,
        response: { errors: [null], payload: [] },
      }),
    ).toThrow("Amazon 無法完成 FBA 銷售趨勢查詢");
  });

  it("only accepts the supported 7, 14, and 30 day ranges", () => {
    expect(buildSalesTrendWindow(MARKETPLACE_ID, 14, NOW).dateKeys).toHaveLength(14);
    expect(buildSalesTrendWindow(MARKETPLACE_ID, 30, NOW).dateKeys).toHaveLength(30);
    expect(() => buildSalesTrendWindow(MARKETPLACE_ID, 10 as 7, NOW)).toThrow(
      "銷售趨勢日期範圍無效",
    );
  });
});
