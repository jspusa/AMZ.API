import { describe, expect, it } from "vitest";
import {
  parseSalesAndTrafficReportDocument,
  readSalesAndTrafficDocument,
} from "../src/main/amazon/sales-and-traffic-reads";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const START_DATE = "2026-07-20";
const END_DATE = "2026-08-18";

function reportDocument(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    reportSpecification: {
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      reportOptions: { dateGranularity: "DAY", asinGranularity: "SKU" },
      dataStartTime: START_DATE,
      dataEndTime: END_DATE,
      marketplaceIds: [MARKETPLACE_ID],
    },
    salesAndTrafficByAsin: [
      {
        parentAsin: "B0FAKE0001",
        childAsin: "B0FAKE0001",
        sku: "FAKE-FBA-SKU-1",
        salesByAsin: {
          unitsOrdered: 12,
          orderedProductSales: { amount: 299.88, currencyCode: "USD" },
          totalOrderItems: 10,
        },
        trafficByAsin: { sessions: 100 },
      },
    ],
    ...overrides,
  });
}

function parsedDocument(): {
  reportSpecification: Record<string, unknown>;
  salesAndTrafficByAsin: Array<Record<string, unknown>>;
} {
  return JSON.parse(reportDocument()) as {
    reportSpecification: Record<string, unknown>;
    salesAndTrafficByAsin: Array<Record<string, unknown>>;
  };
}

function parse(document = reportDocument()) {
  return parseSalesAndTrafficReportDocument({
    text: document,
    marketplaceId: MARKETPLACE_ID,
    startDate: START_DATE,
    endDate: END_DATE,
  });
}

describe("Sales and Traffic document reads", () => {
  it("parses exact DAY + SKU sales without inventing absent rows", () => {
    expect(parse()).toEqual([{
      sellerSku: "FAKE-FBA-SKU-1",
      childAsin: "B0FAKE0001",
      unitsOrdered: 12,
      orderedProductSales: 299.88,
      currencyCode: "USD",
    }]);
    expect(readSalesAndTrafficDocument({
      document: reportDocument(),
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      now: new Date("2026-08-19T00:00:00.000Z"),
    })).toMatchObject({
      mode: "live",
      startDate: START_DATE,
      endDate: END_DATE,
      fetchedAt: "2026-08-19T00:00:00.000Z",
      rows: [{ sellerSku: "FAKE-FBA-SKU-1", unitsOrdered: 12 }],
    });
  });

  it.each([
    ["dataStartTime", `${START_DATE}Tnot-a-time`, START_DATE, END_DATE],
    ["dataEndTime", `${END_DATE}T23:59:59`, START_DATE, END_DATE],
    ["dataStartTime", "2026-02-30", "2026-02-30", END_DATE],
  ] as const)(
    "rejects malformed or impossible %s even when its prefix matches",
    (field, value, startDate, endDate) => {
      const document = parsedDocument();
      document.reportSpecification[field] = value;
      expect(() => parseSalesAndTrafficReportDocument({
        text: JSON.stringify(document),
        marketplaceId: MARKETPLACE_ID,
        startDate,
        endDate,
      })).toThrow(/日期|站點|粒度/iu);
    },
  );

  it.each([
    { dateGranularity: "WEEK", asinGranularity: "SKU" },
    { dateGranularity: "DAY", asinGranularity: "PARENT" },
    { dateGranularity: "DAY", asinGranularity: "SKU", extra: "unsafe" },
  ])("rejects non-exact report options", (reportOptions) => {
    const document = parsedDocument();
    document.reportSpecification.reportOptions = reportOptions;
    expect(() => parse(JSON.stringify(document))).toThrow(/粒度|日期|站點/iu);
  });

  it.each([
    [[]],
    [[MARKETPLACE_ID, "A2EUQ1WTGCTBG2"]],
    [["A2EUQ1WTGCTBG2"]],
  ])("rejects marketplace cardinality or identity drift", (marketplaceIds) => {
    const document = parsedDocument();
    document.reportSpecification.marketplaceIds = marketplaceIds;
    expect(() => parse(JSON.stringify(document))).toThrow(/粒度|日期|站點/iu);
  });

  it("rejects duplicate Seller SKU rows", () => {
    const document = parsedDocument();
    document.salesAndTrafficByAsin.push(document.salesAndTrafficByAsin[0]!);
    expect(() => parse(JSON.stringify(document))).toThrow(/SKU/iu);
  });

  it.each([
    ["sku", " FAKE-FBA-SKU-1"],
    ["sku", "FAKE-FBA-SKU-1 "],
    ["childAsin", " B0FAKE0001"],
    ["childAsin", "B0FAKE0001 "],
    ["childAsin", "not-an-asin"],
  ] as const)("rejects non-exact %s identity", (field, value) => {
    const document = parsedDocument();
    document.salesAndTrafficByAsin[0]![field] = value;
    expect(() => parse(JSON.stringify(document))).toThrow(/SKU／ASIN/iu);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe unitsOrdered %s",
    (unitsOrdered) => {
      const document = parsedDocument();
      const sales = document.salesAndTrafficByAsin[0]!.salesByAsin as Record<string, unknown>;
      sales.unitsOrdered = unitsOrdered;
      expect(() => parse(JSON.stringify(document))).toThrow(/已售出單位/iu);
    },
  );

  it.each([-1, 1_000_000_000_001])(
    "rejects unsafe ordered sales amount %s",
    (amount) => {
      const document = parsedDocument();
      const sales = document.salesAndTrafficByAsin[0]!.salesByAsin as Record<string, unknown>;
      const money = sales.orderedProductSales as Record<string, unknown>;
      money.amount = amount;
      expect(() => parse(JSON.stringify(document))).toThrow(/銷售額/iu);
    },
  );

  it("rejects currency drift", () => {
    const document = parsedDocument();
    const sales = document.salesAndTrafficByAsin[0]!.salesByAsin as Record<string, unknown>;
    const money = sales.orderedProductSales as Record<string, unknown>;
    money.currencyCode = "CAD";
    expect(() => parse(JSON.stringify(document))).toThrow(/幣別/iu);
  });

  it("fails closed on malformed JSON and oversized row arrays", () => {
    expect(() => parse("{")).toThrow(/JSON/iu);
    expect(() => parse(reportDocument({
      salesAndTrafficByAsin: Array.from({ length: 100_001 }, () => null),
    }))).toThrow(/粒度|日期|站點/iu);
  });
});
