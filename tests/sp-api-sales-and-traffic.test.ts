import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSalesAndTrafficReportStatus,
  invalidateSpApiCredentialCaches,
  parseSalesAndTrafficReportDocument,
  startSalesAndTrafficReport,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const START_DATE = "2026-07-20";
const END_DATE = "2026-08-18";
const savedEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "x-amzn-requestid": "FAKE-REQUEST" },
  });
}

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

describe("Sales and Traffic report contract", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_LWA_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_LWA_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REFRESH_TOKEN";
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("creates one exact SKU-granularity report and never retries its POST", async () => {
    const reportBodies: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "FAKE_TOKEN", expires_in: 3_600 });
      }
      if (url.pathname === "/reports/2021-06-30/reports") {
        reportBodies.push(JSON.parse(String(init?.body)) as unknown);
        return jsonResponse(503, { errors: [{ message: "hostile internal detail" }] });
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startSalesAndTrafficReport({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
    })).rejects.toMatchObject({ code: "REPORT_FAILED", status: 503 });

    expect(reportBodies).toEqual([{
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      marketplaceIds: [MARKETPLACE_ID],
      dataStartTime: START_DATE,
      dataEndTime: END_DATE,
      reportOptions: { dateGranularity: "DAY", asinGranularity: "SKU" },
    }]);
  });

  it("does not retry report creation after an unauthorized POST", async () => {
    let tokenRequests = 0;
    let reportRequests = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        tokenRequests += 1;
        return jsonResponse(200, {
          access_token: `FAKE_TOKEN_${tokenRequests}`,
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/reports/2021-06-30/reports") {
        reportRequests += 1;
        return jsonResponse(401, { errors: [{ message: "expired token" }] });
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startSalesAndTrafficReport({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
    })).rejects.toMatchObject({ code: "REPORT_FAILED", status: 401 });

    expect(tokenRequests).toBe(1);
    expect(reportRequests).toBe(1);
  });

  it("accepts the official status shape while matching type, marketplace and dates", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "FAKE_TOKEN", expires_in: 3_600 });
      }
      return jsonResponse(200, {
        reportId: "FAKE-REPORT-ID",
        reportType: "GET_SALES_AND_TRAFFIC_REPORT",
        marketplaceIds: [MARKETPLACE_ID],
        dataStartTime: `${START_DATE}T00:00:00Z`,
        dataEndTime: `${END_DATE}T23:59:59Z`,
        processingStatus: "DONE",
        reportDocumentId: "FAKE-DOCUMENT-ID",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSalesAndTrafficReportStatus({
      marketplaceId: MARKETPLACE_ID,
      reportId: "FAKE-REPORT-ID",
      startDate: START_DATE,
      endDate: END_DATE,
    })).resolves.toMatchObject({
      ready: true,
      reportId: "FAKE-REPORT-ID",
      documentId: "FAKE-DOCUMENT-ID",
    });
  });

  it("parses exact SKU sales without converting absent rows to zero", () => {
    expect(parseSalesAndTrafficReportDocument({
      text: reportDocument(),
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
    })).toEqual([{
      sellerSku: "FAKE-FBA-SKU-1",
      childAsin: "B0FAKE0001",
      unitsOrdered: 12,
      orderedProductSales: 299.88,
      currencyCode: "USD",
    }]);
  });

  it("fails closed on duplicate SKU or a mismatched report window", () => {
    const duplicated = JSON.parse(reportDocument()) as {
      salesAndTrafficByAsin: unknown[];
    };
    duplicated.salesAndTrafficByAsin.push(duplicated.salesAndTrafficByAsin[0]);
    expect(() => parseSalesAndTrafficReportDocument({
      text: JSON.stringify(duplicated),
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
    })).toThrow(/SKU/iu);

    expect(() => parseSalesAndTrafficReportDocument({
      text: reportDocument(),
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-07-21",
      endDate: END_DATE,
    })).toThrow(/日期|站點|粒度/iu);
  });

  it("rejects Sales and Traffic ASIN identity with surrounding whitespace", () => {
    for (const childAsin of [" B0FAKE0001", "B0FAKE0001 "]) {
      const document = JSON.parse(reportDocument()) as {
        salesAndTrafficByAsin: Array<Record<string, unknown>>;
      };
      document.salesAndTrafficByAsin[0]!.childAsin = childAsin;
      expect(() => parseSalesAndTrafficReportDocument({
        text: JSON.stringify(document),
        marketplaceId: MARKETPLACE_ID,
        startDate: START_DATE,
        endDate: END_DATE,
      })).toThrow(/SKU／ASIN/iu);
    }
  });
});
