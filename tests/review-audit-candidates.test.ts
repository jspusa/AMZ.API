import { describe, expect, it, vi } from "vitest";
import {
  parseFbaListingReportSeeds,
  verifyFbaReviewAuditSeeds,
  type FbaReviewAuditSeed,
} from "../src/main/amazon/sp-api";

const US = "ATVPDKIKX0DER";

function seed(index: number, overrides: Partial<FbaReviewAuditSeed> = {}): FbaReviewAuditSeed {
  return {
    sellerSku: `SKU-${String(index).padStart(2, "0")}`,
    asin: `B${String(index).padStart(9, "0")}`,
    title: `Product ${index}`,
    ...overrides,
  };
}

function item(
  source: FbaReviewAuditSeed,
  role: "child" | "standalone" | "parent",
  overrides: Record<string, unknown> = {},
) {
  const relationships = role === "child"
    ? [{ marketplaceId: US, relationships: [{ parentSkus: ["PARENT-SKU"] }] }]
    : role === "parent"
      ? [{ marketplaceId: US, relationships: [{ childSkus: ["CHILD-SKU"] }] }]
      : [];
  return {
    sku: source.sellerSku,
    summaries: [{
      marketplaceId: US,
      asin: source.asin,
      itemName: source.title,
      productType: "PET_FOOD",
    }],
    productTypes: [{ marketplaceId: US, productType: "PET_FOOD" }],
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 1,
    }],
    relationships,
    ...overrides,
  };
}

describe("review-audit non-parent relationship proof", () => {
  it("includes verified child and standalone, excludes parent, and keeps missing/conflicting evidence incomplete", async () => {
    const seeds = [
      seed(1, { sellerSku: "CHILD" }),
      seed(2, { sellerSku: "STANDALONE" }),
      seed(3, { sellerSku: "PARENT" }),
      seed(4, { sellerSku: "MISSING-REL" }),
      seed(5, { sellerSku: "ASIN-CONFLICT" }),
      seed(6, { sellerSku: "OTHER-MARKETPLACE" }),
      seed(7, { sellerSku: "MISSING-MARKETPLACE-ID" }),
      seed(8, { sellerSku: "DUPLICATE-CURRENT-MARKETPLACE" }),
    ];
    const searchBatch = vi.fn(async () => ({
      status: 200,
      requestId: "request-proof",
      payload: {
        numberOfResults: 8,
        pagination: {},
        items: [
          item(seeds[0]!, "child"),
          item(seeds[1]!, "standalone"),
          item(seeds[2]!, "parent"),
          (() => {
            const value = item(seeds[3]!, "standalone");
            delete (value as { relationships?: unknown }).relationships;
            return value;
          })(),
          item(seeds[4]!, "standalone", {
            summaries: [{
              marketplaceId: US,
              asin: "B999999999",
              itemName: "Conflicting ASIN",
            }],
          }),
          item(seeds[5]!, "standalone", {
            summaries: [{
              marketplaceId: "A2EUQ1WTGCTBG2",
              asin: seeds[5]!.asin,
              itemName: "Canada-only summary",
            }],
          }),
          item(seeds[6]!, "standalone", {
            relationships: [{ relationships: [] }],
          }),
          item(seeds[7]!, "standalone", {
            relationships: [
              { marketplaceId: US, relationships: [] },
              { marketplaceId: US, relationships: [] },
            ],
          }),
        ],
      },
    }));

    const result = await verifyFbaReviewAuditSeeds({
      marketplaceId: US,
      seeds,
      searchBatch,
      pace: async () => undefined,
    });

    expect(result.candidates).toMatchObject([
      { sellerSkus: ["CHILD"], relationshipRole: "child" },
      { sellerSkus: ["STANDALONE"], relationshipRole: "standalone" },
    ]);
    expect(result.candidates.flatMap(({ sellerSkus }) => sellerSkus)).not.toContain("PARENT");
    expect(result.relationshipIncompleteRows).toMatchObject([
      { sellerSku: "ASIN-CONFLICT", code: "RELATIONSHIP_RESPONSE_INVALID" },
      { sellerSku: "DUPLICATE-CURRENT-MARKETPLACE", code: "RELATIONSHIP_RESPONSE_INVALID" },
      { sellerSku: "MISSING-MARKETPLACE-ID", code: "RELATIONSHIP_RESPONSE_INVALID" },
      { sellerSku: "MISSING-REL", code: "RELATIONSHIPS_NOT_RETURNED" },
      { sellerSku: "OTHER-MARKETPLACE", code: "RELATIONSHIP_RESPONSE_INVALID" },
    ]);
    expect(result.coverage).toEqual({
      sourceFbaListings: 8,
      verifiedNonParentListings: 2,
      verifiedChildListings: 1,
      verifiedStandaloneListings: 1,
      excludedParentContainers: 1,
      relationshipIncomplete: 5,
    });
    expect(searchBatch).toHaveBeenCalledTimes(1);
  });

  it("does not merge the same ASIN when Listings returns conflicting non-parent roles", async () => {
    const seeds = [
      seed(1, { sellerSku: "SHARED-CHILD", asin: "B000000001" }),
      seed(2, { sellerSku: "SHARED-STANDALONE", asin: "B000000001" }),
    ];
    const result = await verifyFbaReviewAuditSeeds({
      marketplaceId: US,
      seeds,
      searchBatch: async () => ({
        status: 200,
        requestId: "request-role-conflict",
        payload: {
          numberOfResults: 2,
          pagination: {},
          items: [item(seeds[0]!, "child"), item(seeds[1]!, "standalone")],
        },
      }),
      pace: async () => undefined,
    });

    expect(result.candidates).toEqual([]);
    expect(result.relationshipIncompleteRows).toHaveLength(2);
    expect(result.relationshipIncompleteRows.every(
      ({ code }) => code === "RELATIONSHIP_ROLE_CONFLICT",
    )).toBe(true);
    expect(result.coverage).toMatchObject({
      verifiedNonParentListings: 0,
      excludedParentContainers: 0,
      relationshipIncomplete: 2,
    });
  });

  it("uses the unique current-market relationship group without importing another market's parent", async () => {
    const source = seed(1, { sellerSku: "MIXED-MARKET-STANDALONE" });
    const result = await verifyFbaReviewAuditSeeds({
      marketplaceId: US,
      seeds: [source],
      searchBatch: async () => ({
        status: 200,
        requestId: "request-mixed-market",
        payload: {
          numberOfResults: 1,
          pagination: {},
          items: [item(source, "standalone", {
            relationships: [
              { marketplaceId: US, relationships: [] },
              {
                marketplaceId: "A2EUQ1WTGCTBG2",
                relationships: [{ parentSkus: ["CANADA-PARENT"] }],
              },
            ],
          })],
        },
      }),
      pace: async () => undefined,
    });

    expect(result.candidates).toMatchObject([{
      sellerSkus: ["MIXED-MARKET-STANDALONE"],
      relationshipRole: "standalone",
    }]);
    expect(result.relationshipIncompleteRows).toEqual([]);
  });

  it("uses 20-SKU batches, continues after one failed batch, and never falls back per SKU", async () => {
    const seeds = Array.from({ length: 45 }, (_, index) => seed(index + 1));
    const calls: string[][] = [];
    const pauses: number[] = [];
    const result = await verifyFbaReviewAuditSeeds({
      marketplaceId: US,
      seeds,
      searchBatch: async (sellerSkus) => {
        calls.push(sellerSkus);
        if (calls.length === 2) {
          return { status: 400, payload: null, requestId: "request-400" };
        }
        const selected = sellerSkus.map((sellerSku) =>
          seeds.find((candidate) => candidate.sellerSku === sellerSku)!);
        return {
          status: 200,
          requestId: `request-${calls.length}`,
          payload: {
            numberOfResults: selected.length,
            pagination: {},
            items: selected.map((candidate) => item(candidate, "standalone")),
          },
        };
      },
      pace: async (milliseconds) => { pauses.push(milliseconds); },
    });

    expect(calls.map(({ length }) => length)).toEqual([20, 20, 5]);
    expect(pauses).toEqual([220, 220]);
    expect(result.candidates).toHaveLength(25);
    expect(result.relationshipIncompleteRows).toHaveLength(20);
    expect(result.relationshipIncompleteRows.every(
      ({ code }) => code === "RELATIONSHIPS_COMPATIBILITY_FALLBACK",
    )).toBe(true);
  });

  it("does not start another relationship batch after lifecycle cleanup aborts the run", async () => {
    const seeds = Array.from({ length: 45 }, (_, index) => seed(index + 1));
    const controller = new AbortController();
    const searchBatch = vi.fn(async (sellerSkus: string[]) => {
      const selected = sellerSkus.map((sellerSku) =>
        seeds.find((candidate) => candidate.sellerSku === sellerSku)!);
      controller.abort(new Error("lifecycle cleanup"));
      return {
        status: 200,
        requestId: "request-before-abort",
        payload: {
          numberOfResults: selected.length,
          pagination: {},
          items: selected.map((candidate) => item(candidate, "standalone")),
        },
      };
    });

    await expect(verifyFbaReviewAuditSeeds({
      marketplaceId: US,
      seeds,
      searchBatch,
      pace: async () => undefined,
      signal: controller.signal,
    })).rejects.toThrow(/lifecycle cleanup/u);
    expect(searchBatch).toHaveBeenCalledTimes(1);
  });

  it("marks invalid ASIN and unqueryable SKU incomplete without any Listings request", async () => {
    const searchBatch = vi.fn();
    const [rawPaddedAsin] = parseFbaListingReportSeeds([
      "item-name\tseller-sku\tasin1\tfulfillment-channel",
      "Padded ASIN\tPADDED-ASIN\t B000000003\tAMAZON",
    ].join("\n"));
    expect(rawPaddedAsin?.asin).toBe(" B000000003");
    const result = await verifyFbaReviewAuditSeeds({
      marketplaceId: US,
      seeds: [
        seed(1, { sellerSku: "BAD-ASIN", asin: "" }),
        seed(2, { sellerSku: "SKU,COMMA" }),
        rawPaddedAsin!,
      ],
      searchBatch,
      pace: async () => undefined,
    });

    expect(searchBatch).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
    expect(result.relationshipIncompleteRows).toMatchObject([
      { sellerSku: "BAD-ASIN", code: "REPORT_ASIN_INVALID" },
      { sellerSku: "PADDED-ASIN", code: "REPORT_ASIN_INVALID" },
      { sellerSku: "SKU,COMMA", code: "SELLER_SKU_UNQUERYABLE" },
    ]);
  });
});
