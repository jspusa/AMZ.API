import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFbaInboundShipmentSnapshot,
  getInboundNoncomplianceReportDocument,
  getInboundNoncomplianceReportStatus,
  invalidateSpApiCredentialCaches,
  startInboundNoncomplianceReport,
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

describe("SP-API FBA inbound live read contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
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

  it("uses fixed v0 GET paths, refreshes one 401 once, and omits deprecated item marketplace query", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    let tokenCount = 0;
    let shipmentListCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push({ url, init });
      if (url.origin === "https://api.amazon.com") {
        tokenCount += 1;
        return jsonResponse(200, {
          access_token: `FAKE_ACCESS_TOKEN_${tokenCount}`,
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/fba/inbound/v0/shipments") {
        shipmentListCount += 1;
        if (shipmentListCount === 1) {
          return jsonResponse(401, { errors: [{ message: "expired" }] }, "LIST-401");
        }
        return jsonResponse(
          200,
          {
            payload: {
              ShipmentData: [
                {
                  ShipmentId: "FBA19FAKE001",
                  ShipmentName: "Fake inbound shipment",
                  ShipmentStatus: "RECEIVING",
                  DestinationFulfillmentCenterId: "ONT8",
                },
              ],
            },
          },
          "LIST-OK",
        );
      }
      if (url.pathname === "/fba/inbound/v0/shipments/FBA19FAKE001/items") {
        return jsonResponse(
          200,
          {
            payload: {
              ItemData: [
                {
                  ShipmentId: "FBA19FAKE001",
                  SellerSKU: "FAKE-SKU",
                  FulfillmentNetworkSKU: "X00FAKESKU",
                  QuantityShipped: 24,
                  QuantityReceived: 25,
                  QuantityInCase: 12,
                },
              ],
            },
          },
          "ITEM-OK",
        );
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshotPromise = getFbaInboundShipmentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await vi.runAllTimersAsync();
    const snapshot = await snapshotPromise;

    expect(tokenCount).toBe(2);
    expect(shipmentListCount).toBe(2);
    expect(snapshot.summary.totals).toMatchObject({
      expectedUnits: 24,
      receivedUnits: 25,
      pendingUnits: 0,
      overReceivedUnits: 1,
    });
    const shipmentCalls = calls.filter(
      ({ url }) => url.pathname === "/fba/inbound/v0/shipments",
    );
    expect(shipmentCalls).toHaveLength(2);
    for (const { url, init } of shipmentCalls) {
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(url.searchParams.get("QueryType")).toBe("DATE_RANGE");
      expect(url.searchParams.get("MarketplaceId")).toBe(MARKETPLACE_ID);
      expect(url.searchParams.get("LastUpdatedAfter")).toBe(
        "2026-08-01T00:00:00-07:00",
      );
      expect(url.searchParams.get("LastUpdatedBefore")).toBe(
        "2026-08-03T00:00:00-07:00",
      );
    }
    const itemCall = calls.find(
      ({ url }) =>
        url.pathname === "/fba/inbound/v0/shipments/FBA19FAKE001/items",
    );
    expect(itemCall?.init?.method).toBe("GET");
    expect([...itemCall!.url.searchParams.entries()]).toEqual([]);
  });

  it("accepts a valid 180-day inbound range older than the Sales API horizon", async () => {
    const shipmentRequests: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/fba/inbound/v0/shipments") {
        shipmentRequests.push(url);
        return jsonResponse(200, { payload: { ShipmentData: [] } });
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshotPromise = getFbaInboundShipmentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2023-01-01",
      endDate: "2023-06-29",
    });
    await vi.runAllTimersAsync();
    const snapshot = await snapshotPromise;

    expect(snapshot.dateRange).toMatchObject({
      startDate: "2023-01-01",
      endDate: "2023-06-29",
      lastUpdatedAfter: "2023-01-01T00:00:00-08:00",
      lastUpdatedBefore: "2023-06-30T00:00:00-07:00",
    });
    expect(shipmentRequests).toHaveLength(1);
    expect(shipmentRequests[0]?.searchParams.get("LastUpdatedAfter")).toBe(
      "2023-01-01T00:00:00-08:00",
    );
    expect(shipmentRequests[0]?.searchParams.get("LastUpdatedBefore")).toBe(
      "2023-06-30T00:00:00-07:00",
    );
  });

  it.each([
    {
      label: "a future marketplace-local end date",
      startDate: "2026-08-01",
      endDate: "2026-08-22",
    },
    {
      label: "an inclusive 181-day range",
      startDate: "2026-02-22",
      endDate: "2026-08-21",
    },
  ])("rejects $label before any SP-API transport", async ({ startDate, endDate }) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getFbaInboundShipmentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      startDate,
      endDate,
    })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_FBA_INBOUND_RANGE",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds repeated 429 reads and never starts an item request", async () => {
    let shipmentListCount = 0;
    let itemCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/fba/inbound/v0/shipments") {
        shipmentListCount += 1;
        return jsonResponse(
          429,
          { errors: [{ message: "slow down" }] },
          `RATE-${shipmentListCount}`,
        );
      }
      itemCount += 1;
      return jsonResponse(500, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshotPromise = getFbaInboundShipmentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-03",
      endDate: "2026-08-04",
    });
    const rejection = expect(snapshotPromise).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      requestId: "RATE-3",
    });
    await vi.runAllTimersAsync();
    await rejection;

    expect(shipmentListCount).toBe(3);
    expect(itemCount).toBe(0);
  });

  it("does not echo a hostile global 503 response into the public error", async () => {
    const hostileMessage = [
      "accountScope=private-account",
      "reportId=private-report",
      "documentId=private-document",
      "https://example.invalid/private-report",
      "GLOBAL-503-CANARY",
    ].join(" ");
    let shipmentListCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/fba/inbound/v0/shipments") {
        shipmentListCount += 1;
        return jsonResponse(
          503,
          { errors: [{ message: hostileMessage }] },
          `SAFE-REQUEST-${shipmentListCount}`,
        );
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshotPromise = getFbaInboundShipmentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-03",
      endDate: "2026-08-04",
    });
    const rejection = expect(snapshotPromise).rejects.toMatchObject({
      status: 503,
      code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
      requestId: "SAFE-REQUEST-3",
      message: "Amazon 暫時無法完成 FBA 入庫貨件查詢。",
    });
    await vi.runAllTimersAsync();
    await rejection;

    expect(shipmentListCount).toBe(3);
    for (const forbidden of [
      "accountScope",
      "private-account",
      "reportId",
      "private-report",
      "documentId",
      "private-document",
      "https://",
      "GLOBAL-503-CANARY",
    ]) {
      await expect(snapshotPromise).rejects.not.toMatchObject({
        message: expect.stringContaining(forbidden),
      });
    }
  });

  it("stops after a globally throttled item request instead of scanning later shipments", async () => {
    let firstShipmentItemCount = 0;
    let secondShipmentItemCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/fba/inbound/v0/shipments") {
        return jsonResponse(200, {
          payload: {
            ShipmentData: [
              { ShipmentId: "FBA19RATE001" },
              { ShipmentId: "FBA19RATE002" },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/FBA19RATE001/items")) {
        firstShipmentItemCount += 1;
        return jsonResponse(
          429,
          { errors: [{ message: "slow down" }] },
          `ITEM-RATE-${firstShipmentItemCount}`,
        );
      }
      if (url.pathname.endsWith("/FBA19RATE002/items")) {
        secondShipmentItemCount += 1;
        return jsonResponse(200, { payload: { ItemData: [] } });
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshotPromise = getFbaInboundShipmentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-05",
      endDate: "2026-08-06",
    });
    const rejection = expect(snapshotPromise).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      requestId: "ITEM-RATE-3",
    });
    await vi.runAllTimersAsync();
    await rejection;

    expect(firstShipmentItemCount).toBe(3);
    expect(secondShipmentItemCount).toBe(0);
  });

  it("does not echo a hostile shipment-local 400 response into coverage", async () => {
    const hostileMessage = [
      "accountScope=private-account",
      "reportId=private-report",
      "documentId=private-document",
      "https://example.invalid/private-report",
      "LOCAL-400-CANARY\u202e\u0000",
    ].join(" ");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/fba/inbound/v0/shipments") {
        return jsonResponse(200, {
          payload: {
            ShipmentData: [{ ShipmentId: "FBA19HOSTILE001" }],
          },
        });
      }
      return jsonResponse(400, {
        errors: [{ message: hostileMessage }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshotPromise = getFbaInboundShipmentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-03",
      endDate: "2026-08-04",
    });
    await vi.runAllTimersAsync();
    const snapshot = await snapshotPromise;
    const issueMessage = snapshot.coverage.issues[0]?.message ?? "";
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.coverage.state).toBe("partial");
    expect(issueMessage).toBe(
      "Amazon FBA 入庫商品明細暫時無法完成；此貨件未計入完整總量。",
    );
    for (const forbidden of [
      "accountScope",
      "private-account",
      "reportId",
      "private-report",
      "documentId",
      "private-document",
      "https://",
      "LOCAL-400-CANARY",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("creates only the fixed inbound noncompliance report for the exact marketplace", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ url, init });
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      return jsonResponse(202, { reportId: "FAKE-INBOUND-REPORT" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startInboundNoncomplianceReport({ marketplaceId: MARKETPLACE_ID }),
    ).resolves.toMatchObject({
      mode: "live",
      ready: false,
      reportId: "FAKE-INBOUND-REPORT",
      status: "IN_QUEUE",
    });

    const reportRequest = requests.find(
      ({ url }) => url.pathname === "/reports/2021-06-30/reports",
    );
    expect(reportRequest?.init?.method).toBe("POST");
    expect(JSON.parse(String(reportRequest?.init?.body))).toEqual({
      reportType: "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA",
      marketplaceIds: [MARKETPLACE_ID],
    });
  });

  it.each([
    {
      label: "429",
      responseStatus: 429,
      expectedCode: "RATE_LIMITED",
      expectedMessage: "Amazon 正在限制FBA 入庫瑕疵報表請求頻率，請稍後再試。",
    },
    {
      label: "503",
      responseStatus: 503,
      expectedCode: "REPORT_FAILED",
      expectedMessage: "Amazon 無法完成FBA 入庫瑕疵報表。",
    },
    {
      label: "transport ambiguity",
      responseStatus: null,
      expectedCode: "UPSTREAM_UNAVAILABLE",
      expectedMessage: "目前無法連線至 Amazon Reports API，FBA 入庫瑕疵報表建立或查詢結果未知。",
    },
  ])("does not blindly repost report creation after $label", async ({
    responseStatus,
    expectedCode,
    expectedMessage,
  }) => {
    let reportPostCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (
        url.pathname === "/reports/2021-06-30/reports" &&
        init?.method === "POST"
      ) {
        reportPostCount += 1;
        if (responseStatus === null) {
          throw new TypeError("connection closed after request dispatch");
        }
        return jsonResponse(
          responseStatus,
          { errors: [{ message: "create report unavailable" }] },
          `REPORT-CREATE-${responseStatus}`,
        );
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startInboundNoncomplianceReport({ marketplaceId: MARKETPLACE_ID }),
    ).rejects.toMatchObject({ code: expectedCode, message: expectedMessage });

    expect(reportPostCount).toBe(1);
    const reportPosts = fetchMock.mock.calls.filter(([input, init]) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.pathname === "/reports/2021-06-30/reports" && init?.method === "POST";
    });
    expect(reportPosts).toHaveLength(1);
  });

  it("uses the inbound timeout message and never reposts an ambiguous create", async () => {
    let reportPostCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/reports/2021-06-30/reports" && init?.method === "POST") {
        reportPostCount += 1;
        const error = new Error("request timed out after dispatch");
        error.name = "AbortError";
        throw error;
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startInboundNoncomplianceReport({ marketplaceId: MARKETPLACE_ID }),
    ).rejects.toMatchObject({
      status: 504,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Amazon FBA 入庫瑕疵報表查詢逾時，請稍後再試。",
    });
    expect(reportPostCount).toBe(1);
  });

  it("uses the inbound role message for report status authorization errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/reports/2021-06-30/reports/FAKE-INBOUND-REPORT") {
        return jsonResponse(403, { errors: [{ message: "forbidden" }] });
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getInboundNoncomplianceReportStatus({
      marketplaceId: MARKETPLACE_ID,
      reportId: "FAKE-INBOUND-REPORT",
    })).rejects.toMatchObject({
      status: 403,
      code: "REPORT_FAILED",
      message: "Amazon 拒絕FBA 入庫瑕疵報表查詢，請確認 app 已有 Amazon Fulfillment 角色並重新授權。",
    });
  });

  it("uses the inbound role message for report document authorization errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/reports/2021-06-30/reports/FAKE-INBOUND-REPORT") {
        return jsonResponse(200, {
          reportId: "FAKE-INBOUND-REPORT",
          reportType: "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA",
          marketplaceIds: [MARKETPLACE_ID],
          processingStatus: "DONE",
          reportDocumentId: "FAKE-INBOUND-DOCUMENT",
        });
      }
      if (url.pathname === "/reports/2021-06-30/documents/FAKE-INBOUND-DOCUMENT") {
        return jsonResponse(403, { errors: [{ message: "forbidden" }] });
      }
      throw new Error(`Unexpected URL: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getInboundNoncomplianceReportDocument({
      marketplaceId: MARKETPLACE_ID,
      reportId: "FAKE-INBOUND-REPORT",
      documentId: "FAKE-INBOUND-DOCUMENT",
    })).rejects.toMatchObject({
      status: 403,
      code: "REPORT_FAILED",
      message: "Amazon 拒絕FBA 入庫瑕疵報表查詢，請確認 app 已有 Amazon Fulfillment 角色並重新授權。",
    });
  });

  it("provides a same-gateway demo report with the complete official header", async () => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
    const started = await startInboundNoncomplianceReport({
      marketplaceId: MARKETPLACE_ID,
    });
    const status = await getInboundNoncomplianceReportStatus({
      marketplaceId: MARKETPLACE_ID,
      reportId: started.reportId,
    });
    const document = await getInboundNoncomplianceReportDocument({
      marketplaceId: MARKETPLACE_ID,
      reportId: started.reportId,
      documentId: status.documentId!,
    });

    expect(status).toMatchObject({ mode: "demo", ready: true, status: "DONE" });
    expect(document.split("\t")).toEqual(
      expect.arrayContaining([
        "fba-shipment-id",
        "problem-type",
        "problem-level",
        "alert-status",
      ]),
    );
  });
});
