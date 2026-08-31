import { describe, expect, it, vi } from "vitest";
import {
  readFbaCatalogExport,
  readFbaCatalogIdentity,
  readFbaBusinessPricingAudit,
} from "../src/main/amazon/catalog-report-reads";
import { createScriptedListingsReadAdapter } from "../src/main/amazon/listings-reads";

const US = "ATVPDKIKX0DER" as const;

function completeCatalogListing(sellerSku: string, index: number) {
  const asin = `B${String(index + 1).padStart(9, "0")}`;
  return {
    sku: sellerSku,
    summaries: [{
      marketplaceId: US,
      asin,
      productType: "PET_SUPPLIES",
      itemName: `${sellerSku} title`,
    }],
    attributes: {
      item_name: [{ value: `${sellerSku} title`, language_tag: "en_US" }],
    },
    fulfillmentAvailability: [
      { fulfillmentChannelCode: "AMAZON_NA", quantity: 0 },
    ],
  };
}

function twentySkuCatalogDocument(sellerSkus: readonly string[]): string {
  return [
    "seller-sku\tasin\titem-name\tfulfillment-channel",
    ...sellerSkus.map((sellerSku, index) =>
      `${sellerSku}\tB${String(index + 1).padStart(9, "0")}\t${sellerSku} report title\tAFN`
    ),
  ].join("\n");
}

describe("FBA catalog report reads", () => {
  it("recovers a poisoned 20-SKU search batch through bounded exact item reads", async () => {
    const sellerSkus = Array.from(
      { length: 20 },
      (_, index) => `BATCH-SKU-${String(index + 1).padStart(2, "0")}`,
    );
    const listings = sellerSkus.map(completeCatalogListing);
    const poisonedItems = listings.map((listing, index) =>
      index === 0 ? { sku: listing.sku } : listing
    );
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: { numberOfResults: 20, items: poisonedItems },
          requestId: "shared-poisoned-batch-request",
          rateLimit: null,
          retryAfter: null,
          profile: "listing",
        },
      },
      ...listings.map((listing, index) => ({
        operation: "item" as const,
        result: {
          status: 200,
          envelope: listing,
          requestId: `exact-item-${index + 1}`,
          rateLimit: null,
          retryAfter: null,
          profile: "full" as const,
        },
      })),
    ]);

    const result = await readFbaCatalogExport(adapter, {
      marketplaceId: US,
      mode: "live",
      document: twentySkuCatalogDocument(sellerSkus),
      pace: async () => undefined,
    });

    expect(result.rows).toHaveLength(20);
    expect(result.rows.every((row) => row.readStatus === "complete")).toBe(true);
    expect(adapter.requests).toEqual([
      {
        operation: "search",
        intent: "sku-batch",
        marketplaceId: US,
        sellerSkus,
      },
      ...sellerSkus.map((sellerSku) => ({
        operation: "item" as const,
        intent: "listing" as const,
        marketplaceId: US,
        sellerSku,
      })),
    ]);
  });

  it("isolates an exact item failure after a poisoned batch without contaminating the other 19 SKUs", async () => {
    const sellerSkus = Array.from(
      { length: 20 },
      (_, index) => `ISOLATED-SKU-${String(index + 1).padStart(2, "0")}`,
    );
    const listings = sellerSkus.map(completeCatalogListing);
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 20,
            items: listings.map((listing, index) =>
              index === 0 ? { sku: listing.sku } : listing
            ),
          },
          requestId: "shared-batch-must-not-contaminate",
          rateLimit: null,
          retryAfter: null,
          profile: "listing",
        },
      },
      {
        operation: "item",
        result: {
          status: 404,
          envelope: { errors: [{ code: "NOT_FOUND", message: "Not found" }] },
          requestId: "exact-failed-item",
          rateLimit: null,
          retryAfter: null,
          profile: "full",
        },
      },
      ...listings.slice(1).map((listing, index) => ({
        operation: "item" as const,
        result: {
          status: 200,
          envelope: listing,
          requestId: `exact-recovered-item-${index + 2}`,
          rateLimit: null,
          retryAfter: null,
          profile: "full" as const,
        },
      })),
    ]);

    const result = await readFbaCatalogExport(adapter, {
      marketplaceId: US,
      mode: "live",
      document: twentySkuCatalogDocument(sellerSkus),
      pace: async () => undefined,
    });

    expect(result.rows.filter((row) => row.readStatus === "complete"))
      .toHaveLength(19);
    expect(result.rows.find((row) => row.sellerSku === sellerSkus[0]))
      .toMatchObject({ readStatus: "incomplete" });
    expect(JSON.stringify(result)).not.toContain(
      "shared-batch-must-not-contaminate",
    );
    expect(JSON.stringify(result)).toContain("exact-failed-item");
  });

  it("stops exact recovery after the first systemic failure", async () => {
    const sellerSkus = Array.from(
      { length: 20 },
      (_, index) => `STOP-SKU-${String(index + 1).padStart(2, "0")}`,
    );
    const listings = sellerSkus.map(completeCatalogListing);
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 20,
            items: listings.map((listing, index) =>
              index === 0 ? { sku: listing.sku } : listing
            ),
          },
          requestId: "shared-systemic-batch-request",
          rateLimit: null,
          retryAfter: null,
          profile: "listing",
        },
      },
      {
        operation: "item",
        result: {
          status: 429,
          envelope: { errors: [{ code: "QuotaExceeded", message: "Slow down" }] },
          requestId: "exact-rate-limited-item",
          rateLimit: null,
          retryAfter: "1",
          profile: "full",
        },
      },
    ]);

    const result = await readFbaCatalogExport(adapter, {
      marketplaceId: US,
      mode: "live",
      document: twentySkuCatalogDocument(sellerSkus),
      pace: async () => undefined,
    });

    expect(adapter.requests).toEqual([
      {
        operation: "search",
        intent: "sku-batch",
        marketplaceId: US,
        sellerSkus,
      },
      {
        operation: "item",
        intent: "listing",
        marketplaceId: US,
        sellerSku: sellerSkus[0],
      },
    ]);
    expect(result.rows.every((row) => row.readStatus === "incomplete")).toBe(true);
    const attemptedRow = result.rows.find((row) =>
      row.sellerSku === sellerSkus[0]
    )!;
    expect(JSON.stringify(attemptedRow)).toContain("exact-rate-limited-item");
    for (const sellerSku of sellerSkus.slice(1)) {
      const unattemptedRow = result.rows.find((row) =>
        row.sellerSku === sellerSku
      )!;
      expect(JSON.stringify(unattemptedRow)).toContain("停止其餘補讀");
      expect(JSON.stringify(unattemptedRow)).toContain("未送出 Listings Items request");
      expect(JSON.stringify(unattemptedRow)).not.toContain(
        "exact-rate-limited-item",
      );
    }
    expect(result.errors.filter((error) => error.kind === "補讀已停止"))
      .toHaveLength(19);
    expect(JSON.stringify(result)).not.toContain("shared-systemic-batch-request");
  });

  it("does not repeat an exact request-shape failure for the rest of a rescued batch", async () => {
    const sellerSkus = Array.from(
      { length: 20 },
      (_, index) => `SHAPE-SKU-${String(index + 1).padStart(2, "0")}`,
    );
    const listings = sellerSkus.map(completeCatalogListing);
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 20,
            items: listings.map((listing, index) =>
              index === 0 ? { sku: listing.sku } : listing
            ),
          },
          requestId: "shared-shape-batch-request",
          rateLimit: null,
          retryAfter: null,
          profile: "listing",
        },
      },
      {
        operation: "item",
        result: {
          status: 413,
          envelope: { errors: [{ code: "InvalidInput", message: "Too large" }] },
          requestId: "exact-shape-failed-item",
          rateLimit: null,
          retryAfter: null,
          profile: "full",
        },
      },
    ]);

    await readFbaCatalogExport(adapter, {
      marketplaceId: US,
      mode: "live",
      document: twentySkuCatalogDocument(sellerSkus),
      pace: async () => undefined,
    });

    expect(adapter.requests).toHaveLength(2);
    expect(adapter.requests.at(-1)).toMatchObject({
      operation: "item",
      sellerSku: sellerSkus[0],
    });
  });

  it("merges an exact rescue failure into an existing incomplete batch row", async () => {
    const sellerSkus = ["MISSING-ATTRIBUTES-01", "MISSING-ATTRIBUTES-02"];
    const listings = sellerSkus.map(completeCatalogListing);
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 2,
            items: [
              { ...listings[0], attributes: undefined },
              listings[1],
            ],
          },
          requestId: "successful-incomplete-batch",
          rateLimit: null,
          retryAfter: null,
          profile: "listing",
        },
      },
      {
        operation: "item",
        result: {
          status: 429,
          envelope: { errors: [{ code: "QuotaExceeded", message: "Slow down" }] },
          requestId: "exact-incomplete-rate-limited",
          rateLimit: null,
          retryAfter: "1",
          profile: "full",
        },
      },
    ]);

    const result = await readFbaCatalogExport(adapter, {
      marketplaceId: US,
      mode: "live",
      document: twentySkuCatalogDocument(sellerSkus),
      pace: async () => undefined,
    });

    const incomplete = result.rows.find((row) => row.sellerSku === sellerSkus[0]);
    expect(incomplete).toMatchObject({ readStatus: "incomplete" });
    expect(incomplete?.readErrors.map((error) => error.code)).toEqual([
      "LISTING_CONTENT_NOT_RETURNED",
      "LISTING_QUERY_FAILED",
    ]);
    expect(JSON.stringify(incomplete)).toContain("exact-incomplete-rate-limited");
  });

  it("exact-reads only a SKU omitted by an otherwise valid search batch", async () => {
    const sellerSkus = Array.from(
      { length: 20 },
      (_, index) => `MISSING-SKU-${String(index + 1).padStart(2, "0")}`,
    );
    const listings = sellerSkus.map(completeCatalogListing);
    const omitted = listings.at(-1)!;
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: { numberOfResults: 19, items: listings.slice(0, -1) },
          requestId: "partial-successful-batch-request",
          rateLimit: null,
          retryAfter: null,
          profile: "listing",
        },
      },
      {
        operation: "item",
        result: {
          status: 200,
          envelope: omitted,
          requestId: "exact-omitted-item",
          rateLimit: null,
          retryAfter: null,
          profile: "full",
        },
      },
    ]);

    const result = await readFbaCatalogExport(adapter, {
      marketplaceId: US,
      mode: "live",
      document: twentySkuCatalogDocument(sellerSkus),
      pace: async () => undefined,
    });

    expect(result.rows).toHaveLength(20);
    expect(result.rows.every((row) => row.readStatus === "complete")).toBe(true);
    expect(adapter.requests.at(-1)).toEqual({
      operation: "item",
      intent: "listing",
      marketplaceId: US,
      sellerSku: omitted.sku,
    });
  });

  it("keeps an exact comma SKU incomplete when Listings omits content", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: {
            sku: "EXACT,SKU",
            summaries: [
              {
                marketplaceId: US,
                asin: "B0EXACT001",
                productType: "PET_SUPPLIES",
                itemName: "Exact Listings title",
              },
            ],
            fulfillmentAvailability: [
              { fulfillmentChannelCode: "AMAZON_NA", quantity: 3 },
            ],
          },
          requestId: "request-exact-comma-sku",
          rateLimit: null,
          retryAfter: null,
          profile: "full",
        },
      },
    ]);
    const progress: unknown[] = [];
    const pace = vi.fn(async () => undefined);

    const result = await readFbaCatalogExport(adapter, {
      marketplaceId: US,
      mode: "live",
      document: [
        "seller-sku\tasin\titem-name\tfulfillment-channel",
        "EXACT,SKU\tB0EXACT001\tExact report title\tAFN",
      ].join("\n"),
      onProgress: (value) => {
        progress.push(value);
      },
      pace,
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });

    expect(adapter.requests).toEqual([
      {
        operation: "item",
        intent: "listing",
        marketplaceId: US,
        sellerSku: "EXACT,SKU",
      },
    ]);
    expect(result).toMatchObject({
      fetchedAt: "2026-08-24T00:00:00.000Z",
      rows: [
        {
          sellerSku: "EXACT,SKU",
          asin: "B0EXACT001",
          title: "Exact Listings title",
          readStatus: "incomplete",
          readErrors: [
            {
              code: "LISTING_CONTENT_NOT_RETURNED",
              message: expect.stringContaining("attributes"),
            },
          ],
        },
      ],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sellerSku: "EXACT,SKU",
          kind: "內容未回傳",
        }),
      ]),
    );
    expect(result.errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sellerSku: "EXACT,SKU",
          kind: "非 FBA，已略過",
        }),
      ]),
    );
    expect(progress).toEqual([
      { phase: "report-downloaded", completedUnits: 1, totalUnits: 1 },
      { phase: "listings", completedUnits: 1, totalUnits: 1 },
    ]);
    expect(pace).not.toHaveBeenCalled();
  });

  it("does not repeat a recoverable exact 404 for a comma SKU", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 404,
          envelope: {
            errors: [{ code: "NOT_FOUND", message: "Not found" }],
          },
          requestId: "exact-comma-sku-not-found",
          rateLimit: null,
          retryAfter: null,
          profile: "full",
        },
      },
    ]);

    const result = await readFbaCatalogExport(adapter, {
      marketplaceId: US,
      mode: "live",
      document: [
        "seller-sku\tasin\titem-name\tfulfillment-channel",
        "EXACT,404\tB0EXACT404\tExact report title\tAFN",
      ].join("\n"),
      pace: async () => undefined,
    });

    expect(adapter.requests).toEqual([
      {
        operation: "item",
        intent: "listing",
        marketplaceId: US,
        sellerSku: "EXACT,404",
      },
    ]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        sellerSku: "EXACT,404",
        readStatus: "incomplete",
        readErrors: [
          expect.objectContaining({
            code: "LISTING_QUERY_FAILED",
            message: expect.stringContaining("exact-comma-sku-not-found"),
          }),
          expect.objectContaining({
            code: "LISTING_CONTENT_NOT_RETURNED",
          }),
        ],
      }),
    ]);
  });

  it("projects only exact FBA identities without Listings fan-out", () => {
    const snapshot = readFbaCatalogIdentity({
      marketplaceId: US,
      mode: "live",
      document: [
        "seller-sku\tasin\titem-name\tfulfillment-channel",
        "FBA-ONE\tB0EXACT001\tFirst exact FBA title\tAMAZON_NA",
        "FBM-ONE\tB0IGNORE01\tMerchant fulfilled title\tDEFAULT",
        "FBA-TWO\tB0EXACT002\tSecond exact FBA title\tAFN",
      ].join("\n"),
      now: () => new Date("2026-08-24T01:00:00.000Z"),
    });

    expect(snapshot).toEqual({
      mode: "live",
      marketplaceId: US,
      fetchedAt: "2026-08-24T01:00:00.000Z",
      rows: [
        {
          sellerSku: "FBA-ONE",
          asin: "B0EXACT001",
          title: "First exact FBA title",
        },
        {
          sellerSku: "FBA-TWO",
          asin: "B0EXACT002",
          title: "Second exact FBA title",
        },
      ],
      notice: expect.stringMatching(/同次 Amazon FBA 全商品報表/u),
    });
  });

  it("keeps overlapping B2B mismatches separate while unknown evidence is never a mismatch", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 2,
            items: [
              {
                sku: "KNOWN-B2B",
                summaries: [{
                  marketplaceId: US,
                  asin: "B0KNOWN001",
                  productType: "PET_SUPPLIES",
                  itemName: "Known B2B listing",
                }],
                attributes: {
                  purchasable_offer: [
                    {
                      audience: "ALL",
                      marketplace_id: US,
                      currency: "USD",
                      our_price: [{ schedule: [{ value_with_tax: 20 }] }],
                    },
                    {
                      audience: "B2B",
                      marketplace_id: US,
                      currency: "USD",
                      our_price: [{ schedule: [{ value_with_tax: 17 }] }],
                    },
                  ],
                },
                offers: [],
                issues: [],
                fulfillmentAvailability: [
                  { fulfillmentChannelCode: "AMAZON_NA", quantity: 3 },
                ],
              },
              {
                sku: "UNKNOWN-B2B",
                summaries: [{
                  marketplaceId: US,
                  asin: "B0UNKNWN01",
                  productType: "PET_SUPPLIES",
                  itemName: "Unknown B2B listing",
                }],
                fulfillmentAvailability: [
                  { fulfillmentChannelCode: "AFN", quantity: 1 },
                ],
              },
            ],
          },
          requestId: "request-b2b-audit",
          rateLimit: null,
          retryAfter: null,
          profile: "listing",
        },
      },
    ]);

    const snapshot = await readFbaBusinessPricingAudit(adapter, {
      marketplaceId: US,
      mode: "live",
      allListingsDocument: [
        "seller-sku\tasin\titem-name\tfulfillment-channel\tbusiness-price",
        "KNOWN-B2B\tB0KNOWN001\tKnown report title\tAFN\t17",
        "UNKNOWN-B2B\tB0UNKNWN01\tUnknown report title\tAMAZON_NA\t",
      ].join("\n"),
      activeListingsDocument: [
        "seller-sku\tasin\tfulfillment-channel\tbusiness-price",
        "KNOWN-B2B\tB0KNOWN001\tAFN\t17",
      ].join("\n"),
      pace: async () => undefined,
      now: () => new Date("2026-08-24T02:00:00.000Z"),
    });

    expect(adapter.requests).toEqual([
      {
        operation: "search",
        intent: "sku-batch",
        marketplaceId: US,
        sellerSkus: ["KNOWN-B2B", "UNKNOWN-B2B"],
      },
    ]);
    expect(snapshot.rows.find((row) => row.sellerSku === "KNOWN-B2B"))
      .toMatchObject({
        status: "configured",
        editable: false,
        recommendedPriceMismatch: true,
        recommendedQuantityDiscountMismatch: true,
      });
    expect(snapshot.rows.find((row) => row.sellerSku === "UNKNOWN-B2B"))
      .toMatchObject({
        status: "incomplete",
        editable: false,
        recommendedPriceMismatch: false,
        recommendedQuantityDiscountMismatch: false,
      });
    expect(snapshot.summary).toMatchObject({
      totalFbaSkuCount: 2,
      configured: 1,
      incomplete: 1,
      recommendedPriceMismatch: 1,
      recommendedQuantityDiscountMismatch: 1,
    });
  });

  it("never copies hostile Amazon error text into successful catalog or B2B DTOs", async () => {
    const hostileEnvelope = {
      errors: [{
        code: "INTERNAL",
        message:
          "https://attacker.invalid/?seller_id=A1234567890123\u0000refresh_token=DO_NOT_EXPOSE",
      }],
    };
    const failedResult = {
      status: 503,
      envelope: hostileEnvelope,
      requestId: "safe-catalog-request-id",
      rateLimit: null,
      retryAfter: null,
      profile: "listing" as const,
    };
    const document = [
      "seller-sku\tasin\titem-name\tfulfillment-channel",
      "SAFE-ERROR-SKU\tB0SAFE0001\tSafe report title\tAFN",
    ].join("\n");

    const exported = await readFbaCatalogExport(
      createScriptedListingsReadAdapter([{
        operation: "search",
        result: failedResult,
      }]),
      {
        marketplaceId: US,
        mode: "live",
        document,
        pace: async () => undefined,
      },
    );
    const audited = await readFbaBusinessPricingAudit(
      createScriptedListingsReadAdapter([
        {
          operation: "search",
          result: { ...failedResult, status: 400 },
        },
        {
          operation: "item",
          result: { ...failedResult, profile: "full" as const },
        },
      ]),
      {
        marketplaceId: US,
        mode: "live",
        allListingsDocument: document,
        pace: async () => undefined,
      },
    );

    const serialized = JSON.stringify({ exported, audited });
    expect(serialized).toContain("safe-catalog-request-id");
    expect(serialized).not.toContain("attacker.invalid");
    expect(serialized).not.toContain("A1234567890123");
    expect(serialized).not.toContain("DO_NOT_EXPOSE");
    expect(serialized).not.toContain("refresh_token");
    expect(serialized).not.toContain("\\u0000");
  });
});
