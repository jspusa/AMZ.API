import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFbaShipmentSalesReportStatus,
  invalidateSpApiCredentialCaches,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const savedEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);

function jsonResponse(
  status: number,
  body: unknown,
  requestId?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(requestId ? { "x-amzn-requestid": requestId } : {}),
    },
  });
}

describe("FBA brand sales fixed report window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_LWA_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_LWA_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REFRESH_TOKEN_NA";
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("accepts the app-generated US zoned window and matches Amazon UTC metadata by instant", async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      urls.push(url);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      expect(url.pathname).toBe(
        "/reports/2021-06-30/reports/FAKE_BRAND_REPORT_ID",
      );
      return jsonResponse(200, {
        reportId: "FAKE_BRAND_REPORT_ID",
        reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
        marketplaceIds: [MARKETPLACE_ID],
        dataStartTime: "2026-08-02T07:00:00Z",
        dataEndTime: "2026-08-09T07:00:00Z",
        processingStatus: "DONE",
        reportDocumentId: "FAKE_BRAND_DOCUMENT_ID",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getFbaShipmentSalesReportStatus({
      marketplaceId: MARKETPLACE_ID,
      reportId: "FAKE_BRAND_REPORT_ID",
      startDate: "2026-08-02",
      endDate: "2026-08-08",
      dataStartTime: "2026-08-02T00:00:00-07:00",
      dataEndTime: "2026-08-09T00:00:00-07:00",
    });

    expect(result).toMatchObject({
      mode: "live",
      ready: true,
      status: "DONE",
      reportId: "FAKE_BRAND_REPORT_ID",
      documentId: "FAKE_BRAND_DOCUMENT_ID",
      dataStartTime: "2026-08-02T00:00:00-07:00",
      dataEndTime: "2026-08-09T00:00:00-07:00",
    });
    expect(urls).toHaveLength(2);
  });

  it("accepts a historical US window whose start and end use different DST offsets", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      return jsonResponse(200, {
        reportId: "FAKE_DST_REPORT_ID",
        reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
        marketplaceIds: [MARKETPLACE_ID],
        dataStartTime: "2026-03-07T08:00:00Z",
        dataEndTime: "2026-03-10T07:00:00Z",
        processingStatus: "DONE",
        reportDocumentId: "FAKE_DST_DOCUMENT_ID",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getFbaShipmentSalesReportStatus({
      marketplaceId: MARKETPLACE_ID,
      reportId: "FAKE_DST_REPORT_ID",
      startDate: "2026-03-07",
      endDate: "2026-03-09",
      dataStartTime: "2026-03-07T00:00:00-08:00",
      dataEndTime: "2026-03-10T00:00:00-07:00",
    });

    expect(result).toMatchObject({
      ready: true,
      reportId: "FAKE_DST_REPORT_ID",
      documentId: "FAKE_DST_DOCUMENT_ID",
    });
  });

  it("rejects malformed Amazon report metadata even when Date.parse sees the same instant", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      return jsonResponse(200, {
        reportId: "FAKE_BRAND_REPORT_ID",
        reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
        marketplaceIds: [MARKETPLACE_ID],
        dataStartTime: "2026-08-02 07:00:00Z",
        dataEndTime: "2026-08-09T07:00:00Z",
        processingStatus: "DONE",
        reportDocumentId: "FAKE_BRAND_DOCUMENT_ID",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getFbaShipmentSalesReportStatus({
        marketplaceId: MARKETPLACE_ID,
        reportId: "FAKE_BRAND_REPORT_ID",
        startDate: "2026-08-02",
        endDate: "2026-08-08",
        dataStartTime: "2026-08-02T00:00:00-07:00",
        dataEndTime: "2026-08-09T00:00:00-07:00",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MISMATCH",
    });
  });

  it("still rejects malformed fixed timestamps before any Amazon request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getFbaShipmentSalesReportStatus({
        marketplaceId: MARKETPLACE_ID,
        reportId: "FAKE_BRAND_REPORT_ID",
        startDate: "2026-08-02",
        endDate: "2026-08-08",
        dataStartTime: "2026-08-02 00:00:00-07:00",
        dataEndTime: "2026-08-09T00:00:00-07:00",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_DATE_RANGE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a valid-looking persisted window that does not match the exact selected dates", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getFbaShipmentSalesReportStatus({
        marketplaceId: MARKETPLACE_ID,
        reportId: "FAKE_BRAND_REPORT_ID",
        startDate: "2026-08-02",
        endDate: "2026-08-08",
        dataStartTime: "2026-08-01T00:00:00-07:00",
        dataEndTime: "2026-08-09T00:00:00-07:00",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_DATE_RANGE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes CANCELLED from FATAL, preserves request IDs, and never auto-reposts", async () => {
    for (const processingStatus of ["CANCELLED", "FATAL"] as const) {
      invalidateSpApiCredentialCaches();
      const methods: string[] = [];
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === "https://api.amazon.com") {
          return jsonResponse(200, {
            access_token: "FAKE_ACCESS_TOKEN",
            expires_in: 3_600,
          });
        }
        methods.push(init?.method ?? "GET");
        return jsonResponse(200, {
          reportId: "FAKE_BRAND_REPORT_ID",
          reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
          marketplaceIds: [MARKETPLACE_ID],
          dataStartTime: "2026-08-02T07:00:00Z",
          dataEndTime: "2026-08-09T07:00:00Z",
          processingStatus,
        }, `REQUEST-${processingStatus}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const error = await getFbaShipmentSalesReportStatus({
        marketplaceId: MARKETPLACE_ID,
        reportId: "FAKE_BRAND_REPORT_ID",
        startDate: "2026-08-02",
        endDate: "2026-08-08",
        dataStartTime: "2026-08-02T00:00:00-07:00",
        dataEndTime: "2026-08-09T00:00:00-07:00",
      }).then(
        () => null,
        (reason: unknown) => reason,
      );

      expect(error).toMatchObject({
        status: 422,
        code: processingStatus === "CANCELLED"
          ? "REPORT_CANCELLED"
          : "REPORT_FATAL",
        requestId: `REQUEST-${processingStatus}`,
      });
      expect((error as Error).message).toContain(
        processingStatus === "CANCELLED" ? "30 分鐘" : "處理",
      );
      expect(methods).toEqual(["GET"]);
    }
  });
});
