import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import {
  getAgedInventoryReportStatus,
  invalidateSpApiCredentialCaches,
  parseAgedInventoryReportDocument,
  startAgedInventoryReport,
} from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import AgedInventoryPanel, {
  parseAgedInventorySnapshot,
} from "../src/renderer/src/components/aged-inventory-panel";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const REPORT_ID = "TEST_AGED_REPORT_ID";
const savedSpEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);

function clearSpEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SP_API_")) delete process.env[key];
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function request(input: {
  method: ApiRequest["method"];
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): ApiRequest {
  return {
    requestId: `aged-${input.method.toLowerCase()}-001`,
    method: input.method,
    path: "/api/sp-api/aged-inventory",
    query: input.query ?? {},
    headers: {},
    body: input.body ? { kind: "json", value: input.body } : undefined,
  };
}

describe("official FBA 180+ day inventory report", () => {
  beforeEach(() => {
    clearSpEnvironment();
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSpEnvironment();
    for (const [key, value] of savedSpEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
    invalidateSpApiCredentialCaches();
  });

  it("parses the official non-overlapping 180+ buckets and excludes fresh FBA rows", () => {
    const report = [
      [
        "seller-sku",
        "fnsku",
        "asin",
        "product-name",
        "condition",
        "available",
        "inv-age-181-to-270-days",
        "inv-age-271-to-365-days",
        "inv-age-366-to-455-days",
        "inv-age-456-plus-days",
        "estimated-excess-quantity",
        "recommended-removal-quantity",
        "days-of-supply",
        "recommended-action",
        "snapshot-date",
      ].join("\t"),
      [
        "AGED-FBA-01",
        "X001AGED01",
        "B0AGED0001",
        "Aged FBA product",
        "New",
        "240",
        "12",
        "10",
        "7",
        "2",
        "25",
        "5",
        "220.5",
        "Create sale",
        "2026-08-07",
      ].join("\t"),
      [
        "FRESH-FBA-01",
        "X001FRESH1",
        "B0FRESH001",
        "Fresh FBA product",
        "New",
        "80",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "35",
        "",
        "2026-08-07",
      ].join("\t"),
    ].join("\n");

    expect(parseAgedInventoryReportDocument(report)).toEqual([
      expect.objectContaining({
        sellerSku: "AGED-FBA-01",
        available: 240,
        agedOver180: 31,
        estimatedExcessQuantity: 25,
        recommendedRemovalQuantity: 5,
        daysOfSupply: 220.5,
        ageBuckets: [
          { label: "181–270 天", units: 12 },
          { label: "271–365 天", units: 10 },
          { label: "366–455 天", units: 7 },
          { label: "456 天以上", units: 2 },
        ],
      }),
    ]);
  });

  it("selects one complete Amazon column generation instead of double-counting overlaps", () => {
    const report = [
      [
        "sku",
        "inv-age-181-to-270-days",
        "inv-age-271-to-365-days",
        "inv-age-366-to-455-days",
        "inv-age-456-plus-days",
        "inv-age-181-to-330-days",
        "inv-age-331-to-365-days",
        "inv-age-365-plus-days",
      ].join("\t"),
      ["AGED-FBA-02", "4", "3", "2", "1", "999", "999", "999"].join("\t"),
    ].join("\n");

    expect(parseAgedInventoryReportDocument(report)[0]).toMatchObject({
      agedOver180: 10,
      ageBuckets: [
        { label: "181–270 天", units: 4 },
        { label: "271–365 天", units: 3 },
        { label: "366–455 天", units: 2 },
        { label: "456 天以上", units: 1 },
      ],
    });
    expect(() =>
      parseAgedInventoryReportDocument(
        "sku\tinv-age-181-to-270-days\tinv-age-271-to-365-days\tinv-age-365-plus-days\nBAD\t-1\t0\t0",
      ),
    ).toThrow("不是有效數量");
  });

  it("keeps non-US 365-plus units when the regional tail columns are unavailable", () => {
    const report = [
      [
        "sku",
        "inv-age-181-to-270-days",
        "inv-age-271-to-365-days",
        "inv-age-365-plus-days",
        "estimated-excess-quantity",
      ].join("\t"),
      ["NON-US-AGED-01", "0", "0", "11", "7"].join("\t"),
    ].join("\n");

    expect(parseAgedInventoryReportDocument(report)).toEqual([
      expect.objectContaining({
        sellerSku: "NON-US-AGED-01",
        agedOver180: 11,
        estimatedExcessQuantity: 7,
        ageBuckets: [
          { label: "181–270 天", units: 0 },
          { label: "271–365 天", units: 0 },
          { label: "365 天以上", units: 11 },
        ],
      }),
    ]);
  });

  it("fails closed when an Amazon report omits every complete long-age tail", () => {
    expect(() =>
      parseAgedInventoryReportDocument(
        [
          "sku\tinv-age-181-to-270-days\tinv-age-271-to-365-days",
          "INCOMPLETE-AGED-01\t2\t3",
        ].join("\n"),
      ),
    ).toThrow("缺少完整的 181 天以上庫齡區間");
  });

  it("requests GET_FBA_INVENTORY_PLANNING_DATA for exactly one marketplace", async () => {
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "TEST_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "TEST_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "TEST_REFRESH_TOKEN";
    process.env.SP_API_SELLER_ID_NA = "TEST_SELLER_ID";
    invalidateSpApiCredentialCaches();
    let reportRequest: Record<string, unknown> | null = null;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "TEST_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/reports/2021-06-30/reports") {
        reportRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse(202, { reportId: REPORT_ID });
      }
      throw new Error(`Unexpected request: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await startAgedInventoryReport({ marketplaceId: MARKETPLACE_ID });

    expect(result).toMatchObject({
      mode: "live",
      ready: false,
      reportId: REPORT_ID,
      status: "IN_QUEUE",
    });
    expect(reportRequest).toEqual({
      reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
      marketplaceIds: [MARKETPLACE_ID],
    });
  });

  it("fails closed when Amazon returns a different report type or marketplace", async () => {
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "TEST_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "TEST_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "TEST_REFRESH_TOKEN";
    process.env.SP_API_SELLER_ID_NA = "TEST_SELLER_ID";
    invalidateSpApiCredentialCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = requestUrl(input);
        if (url.origin === "https://api.amazon.com") {
          return jsonResponse(200, {
            access_token: "TEST_ACCESS_TOKEN",
            expires_in: 3_600,
          });
        }
        if (url.pathname === `/reports/2021-06-30/reports/${REPORT_ID}`) {
          return jsonResponse(200, {
            reportId: REPORT_ID,
            reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
            marketplaceIds: [MARKETPLACE_ID],
            processingStatus: "DONE",
            reportDocumentId: "WRONG_DOCUMENT",
          });
        }
        throw new Error(`Unexpected request: ${url.href}`);
      }),
    );

    await expect(
      getAgedInventoryReportStatus({
        marketplaceId: MARKETPLACE_ID,
        reportId: REPORT_ID,
      }),
    ).rejects.toMatchObject({ code: "REPORT_MISMATCH", status: 409 });
  });
});

describe("FBA aged inventory renderer and read-only route", () => {
  const router = new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite: async () => undefined,
  });

  beforeEach(() => {
    clearSpEnvironment();
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    clearSpEnvironment();
    for (const [key, value] of savedSpEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
    invalidateSpApiCredentialCaches();
  });

  it("shows a visible compact main-page entry and explains the independent excess metric", () => {
    const markup = renderToStaticMarkup(
      <AgedInventoryPanel marketplaceId={MARKETPLACE_ID} />,
    );

    expect(markup).toContain("180 天以上庫存");
    expect(markup).toContain("查看全部");
    expect(markup).toContain("Amazon 預估冗餘");
    expect(markup).toContain("不會自動促銷或移除");
  });

  it("validates every row and the server summary before displaying it", () => {
    const raw = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-08T00:00:00.000Z",
      rows: [
        {
          sellerSku: "AGED-FBA-01",
          fnSku: "X001AGED01",
          asin: "B0AGED0001",
          title: "Aged FBA product",
          condition: "New",
          available: 240,
          agedOver180: 31,
          ageBuckets: [
            { label: "181–270 天", units: 12 },
            { label: "271–365 天", units: 10 },
            { label: "366–455 天", units: 7 },
            { label: "456 天以上", units: 2 },
          ],
          estimatedExcessQuantity: 25,
          recommendedRemovalQuantity: 5,
          daysOfSupply: 220.5,
          recommendedAction: "Create sale",
          snapshotDate: "2026-08-07",
        },
      ],
      summary: {
        skuCount: 1,
        agedOver180: 31,
        estimatedExcessQuantity: 25,
      },
      notice: "FBA only",
    };

    expect(parseAgedInventorySnapshot(raw, MARKETPLACE_ID)).toMatchObject({
      summary: { skuCount: 1, agedOver180: 31, estimatedExcessQuantity: 25 },
    });
    expect(() =>
      parseAgedInventorySnapshot(
        { ...raw, summary: { ...raw.summary, agedOver180: 30 } },
        MARKETPLACE_ID,
      ),
    ).toThrow("摘要與商品列不一致");
  });

  it("starts, reads, and rejects mutations through the local FBA-only API", async () => {
    const started = await router.handle(
      request({ method: "POST", body: { marketplaceId: MARKETPLACE_ID } }),
    );
    expect(started.status).toBe(200);
    expect(started.body.kind).toBe("json");
    if (started.body.kind !== "json") throw new Error("Expected JSON response");
    const report = started.body.value as { reportId: string; documentId: string };

    const loaded = await router.handle(
      request({
        method: "GET",
        query: {
          marketplaceId: MARKETPLACE_ID,
          reportId: report.reportId,
          documentId: report.documentId,
          data: "1",
        },
      }),
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body.kind).toBe("json");
    if (loaded.body.kind !== "json") throw new Error("Expected JSON response");
    expect(loaded.body.value).toMatchObject({
      mode: "demo",
      marketplaceId: MARKETPLACE_ID,
      summary: { skuCount: 1, agedOver180: 108 },
      notice: expect.stringContaining("不會自動建立促銷或移除訂單"),
    });

    const mutation = await router.handle(request({ method: "PATCH" }));
    expect(mutation.status).toBe(404);
  });
});
