import { describe, expect, it, vi } from "vitest";
import {
  readFbaCatalogExport,
  readFbaCatalogIdentity,
  readFbaBusinessPricingAudit,
} from "../src/main/amazon/catalog-report-reads";
import { createScriptedListingsReadAdapter } from "../src/main/amazon/listings-reads";

const US = "ATVPDKIKX0DER" as const;

describe("FBA catalog report reads", () => {
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
