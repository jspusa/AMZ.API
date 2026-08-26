import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogListingsReadAdapterProduction,
  invalidateSpApiCredentialCaches,
} from "../src/main/amazon/sp-api";
import {
  readFbaCatalogExport,
  type CatalogExportProgress,
} from "../src/main/amazon/catalog-report-reads";
import { downloadMockReportDocument } from "./catalog-report-test-support";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const REPORT_ID = "FAKE_REPORT_ID";
const DOCUMENT_ID = "FAKE_DOCUMENT_ID";
const REPORT_URL = "https://reports.example.cloudfront.net/listings.tsv";
const SP_ENV_KEYS = Object.keys(process.env).filter((key) =>
  key.startsWith("SP_API_"),
);
const savedEnvironment = new Map(
  SP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

async function getAllListingsExportData(input: Readonly<{
  marketplaceId: typeof MARKETPLACE_ID;
  reportId: string;
  documentId: string;
  signal?: AbortSignal;
  onProgress?: (
    progress: CatalogExportProgress,
  ) => void | Promise<void>;
}>) {
  const document = await downloadMockReportDocument(input);
  return readFbaCatalogExport(catalogListingsReadAdapterProduction, {
    marketplaceId: input.marketplaceId,
    mode: "live",
    document,
    signal: input.signal,
    onProgress: input.onProgress,
    pace: async () => undefined,
  });
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

describe("FBA listing content export completeness", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_LWA_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_LWA_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REFRESH_TOKEN_NA";
    process.env.SP_API_SELLER_ID_NA = "FAKE_SELLER_ID_NA";
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

  it("keeps report-proven FBA rows incomplete when Listings omits fulfillment evidence", async () => {
    const report = [
      "seller-sku\tasin\titem-name\tfulfillment-channel",
      "NO-AVAIL\tB0AVAIL001\tReport availability title\tAMAZON_NA",
    ].join("\n");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === `/reports/2021-06-30/reports/${REPORT_ID}`) {
        return jsonResponse(200, {
          reportId: REPORT_ID,
          reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
          marketplaceIds: [MARKETPLACE_ID],
          processingStatus: "DONE",
          reportDocumentId: DOCUMENT_ID,
        });
      }
      if (url.pathname === `/reports/2021-06-30/documents/${DOCUMENT_ID}`) {
        return jsonResponse(200, { url: REPORT_URL });
      }
      if (url.href === REPORT_URL) return new Response(report);
      if (url.pathname === "/listings/2021-08-01/items/FAKE_SELLER_ID_NA") {
        return jsonResponse(200, {
          items: [
            {
              sku: "NO-AVAIL",
              summaries: [
                {
                  marketplaceId: MARKETPLACE_ID,
                  asin: "B0AVAIL001",
                  productType: "PET_FOOD",
                  itemName: "Listings availability title",
                },
              ],
              attributes: {
                item_name: [
                  {
                    marketplace_id: MARKETPLACE_ID,
                    language_tag: "en_US",
                    value: "Listings availability title",
                  },
                ],
                title_differentiation: [
                  {
                    marketplace_id: MARKETPLACE_ID,
                    language_tag: "en_US",
                    value: "Listings item highlight",
                  },
                ],
                bullet_point: [
                  {
                    marketplace_id: MARKETPLACE_ID,
                    language_tag: "en_US",
                    value: "Listings bullet point",
                  },
                ],
                product_description: [
                  {
                    marketplace_id: MARKETPLACE_ID,
                    language_tag: "en_US",
                    value: "Listings product description",
                  },
                ],
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const progress: unknown[] = [];

    const result = await getAllListingsExportData({
      marketplaceId: MARKETPLACE_ID,
      reportId: REPORT_ID,
      documentId: DOCUMENT_ID,
      onProgress: (value) => {
        progress.push(value);
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      sellerSku: "NO-AVAIL",
      title: "Listings availability title",
      itemHighlight: "Listings item highlight",
      bulletPoints: ["Listings bullet point"],
      productDescription: "Listings product description",
      readStatus: "incomplete",
      readErrors: [
        expect.objectContaining({
          code: "LISTING_CONTENT_NOT_RETURNED",
          message: expect.stringContaining("fulfillmentAvailability"),
        }),
      ],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sellerSku: "NO-AVAIL",
          kind: "履約資料未回傳",
        }),
      ]),
    );
    expect(result.errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sellerSku: "NO-AVAIL", kind: "非 FBA，已略過" }),
      ]),
    );
    expect(progress).toEqual([
      { phase: "report-downloaded", completedUnits: 1, totalUnits: 1 },
      { phase: "listings", completedUnits: 1, totalUnits: 1 },
    ]);
  });

  it("marks a successful Listings response without attributes incomplete", async () => {
    const report = [
      "seller-sku\tasin\titem-name\tfulfillment-channel",
      "NO-ATTR\tB0ATTR0002\tReport attributes title\tAFN",
    ].join("\n");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === `/reports/2021-06-30/reports/${REPORT_ID}`) {
        return jsonResponse(200, {
          reportId: REPORT_ID,
          reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
          marketplaceIds: [MARKETPLACE_ID],
          processingStatus: "DONE",
          reportDocumentId: DOCUMENT_ID,
        });
      }
      if (url.pathname === `/reports/2021-06-30/documents/${DOCUMENT_ID}`) {
        return jsonResponse(200, { url: REPORT_URL });
      }
      if (url.href === REPORT_URL) return new Response(report);
      if (url.pathname === "/listings/2021-08-01/items/FAKE_SELLER_ID_NA") {
        return jsonResponse(200, {
          items: [
            {
              sku: "NO-ATTR",
              summaries: [
                {
                  marketplaceId: MARKETPLACE_ID,
                  asin: "B0ATTR0002",
                  productType: "PET_FOOD",
                  itemName: "Listings attributes title",
                },
              ],
              fulfillmentAvailability: [
                { fulfillmentChannelCode: "AMAZON_NA", quantity: 3 },
              ],
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAllListingsExportData({
      marketplaceId: MARKETPLACE_ID,
      reportId: REPORT_ID,
      documentId: DOCUMENT_ID,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      sellerSku: "NO-ATTR",
      title: "Listings attributes title",
      readStatus: "incomplete",
      readErrors: [
        expect.objectContaining({
          code: "LISTING_CONTENT_NOT_RETURNED",
          message: expect.stringContaining("attributes"),
        }),
      ],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sellerSku: "NO-ATTR",
          kind: "內容未回傳",
        }),
      ]),
    );
    expect(result.errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sellerSku: "NO-ATTR", kind: "缺少成分" }),
      ]),
    );
  });
});
