import { describe, expect, it } from "vitest";
import {
  readFbaCatalogSeeds as parseFbaListingReportSeeds,
} from "../src/main/amazon/catalog-report-reads";
import {
  createScriptedListingsReadAdapter,
} from "../src/main/amazon/listings-reads";
import {
  getDemoFbaReviewAuditCandidates,
  verifyFbaReviewAuditSeeds,
  type FbaReviewAuditSeed,
} from "../src/main/amazon/variation-catalog-reads";

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

function searchStep(
  status: number,
  payload: unknown,
  requestId: string | null,
) {
  return {
    operation: "search" as const,
    result: {
      status,
      envelope: payload,
      requestId,
      rateLimit: null,
      retryAfter: null,
      profile: "variation" as const,
    },
  };
}

describe("review-audit non-parent relationship proof", () => {
  it("keeps deterministic demo candidates inside the relationship owner", () => {
    const snapshot = getDemoFbaReviewAuditCandidates({ marketplaceId: US });

    expect(snapshot).toMatchObject({
      mode: "demo",
      marketplaceId: US,
      sourceCandidateCount: 6,
      coverage: {
        sourceFbaListings: 6,
        verifiedNonParentListings: 6,
        verifiedChildListings: 3,
        verifiedStandaloneListings: 3,
        excludedParentContainers: 0,
        relationshipIncomplete: 0,
      },
    });
    expect(snapshot.candidates).toHaveLength(6);
    expect(snapshot.candidates.every(({ relationshipRole }) =>
      relationshipRole === "child" || relationshipRole === "standalone"
    )).toBe(true);
    expect(() => getDemoFbaReviewAuditCandidates({
      marketplaceId: "A2EUQ1WTGCTBG2",
    })).toThrow(/尚不支援此站點/u);
  });

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
    const adapter = createScriptedListingsReadAdapter([
      searchStep(200, {
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
      }, "request-proof"),
    ]);

    const result = await verifyFbaReviewAuditSeeds(adapter, {
      marketplaceId: US,
      seeds,
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
    expect(adapter.requests).toHaveLength(1);
  });

  it("does not merge the same ASIN when Listings returns conflicting non-parent roles", async () => {
    const seeds = [
      seed(1, { sellerSku: "SHARED-CHILD", asin: "B000000001" }),
      seed(2, { sellerSku: "SHARED-STANDALONE", asin: "B000000001" }),
    ];
    const adapter = createScriptedListingsReadAdapter([
      searchStep(200, {
        numberOfResults: 2,
        pagination: {},
        items: [item(seeds[0]!, "child"), item(seeds[1]!, "standalone")],
      }, "request-role-conflict"),
    ]);
    const result = await verifyFbaReviewAuditSeeds(adapter, {
      marketplaceId: US,
      seeds,
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
    const adapter = createScriptedListingsReadAdapter([
      searchStep(200, {
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
      }, "request-mixed-market"),
    ]);
    const result = await verifyFbaReviewAuditSeeds(adapter, {
      marketplaceId: US,
      seeds: [source],
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
    const pauses: number[] = [];
    const firstBatch = seeds.slice(0, 20);
    const finalBatch = seeds.slice(40);
    const adapter = createScriptedListingsReadAdapter([
      searchStep(200, {
        numberOfResults: firstBatch.length,
        pagination: {},
        items: firstBatch.map((candidate) => item(candidate, "standalone")),
      }, "request-1"),
      searchStep(400, null, "request-400"),
      searchStep(200, {
        numberOfResults: finalBatch.length,
        pagination: {},
        items: finalBatch.map((candidate) => item(candidate, "standalone")),
      }, "request-3"),
    ]);
    const result = await verifyFbaReviewAuditSeeds(adapter, {
      marketplaceId: US,
      seeds,
      pace: async (milliseconds) => { pauses.push(milliseconds); },
    });

    expect(adapter.requests.map((request) =>
      request.operation === "search" && request.intent === "variation-sku-batch"
        ? request.sellerSkus.length
        : 0
    )).toEqual([20, 20, 5]);
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
    const firstBatch = seeds.slice(0, 20);
    const scripted = createScriptedListingsReadAdapter([
      searchStep(200, {
        numberOfResults: firstBatch.length,
        pagination: {},
        items: firstBatch.map((candidate) => item(candidate, "standalone")),
      }, "request-before-abort"),
    ]);
    const adapter = {
      ...scripted,
      async searchItems(
        plan: Parameters<typeof scripted.searchItems>[0],
      ) {
        const result = await scripted.searchItems(plan);
        controller.abort(new Error("lifecycle cleanup"));
        return result;
      },
    };

    await expect(verifyFbaReviewAuditSeeds(adapter, {
      marketplaceId: US,
      seeds,
      pace: async () => undefined,
      signal: controller.signal,
    })).rejects.toThrow(/lifecycle cleanup/u);
    expect(scripted.requests).toHaveLength(1);
  });

  it("marks invalid ASIN and unqueryable SKU incomplete without any Listings request", async () => {
    const adapter = createScriptedListingsReadAdapter([]);
    const [rawPaddedAsin] = parseFbaListingReportSeeds([
      "item-name\tseller-sku\tasin1\tfulfillment-channel",
      "Padded ASIN\tPADDED-ASIN\t B000000003\tAMAZON",
    ].join("\n"));
    expect(rawPaddedAsin?.asin).toBe(" B000000003");
    const result = await verifyFbaReviewAuditSeeds(adapter, {
      marketplaceId: US,
      seeds: [
        seed(1, { sellerSku: "BAD-ASIN", asin: "" }),
        seed(2, { sellerSku: "SKU,COMMA" }),
        rawPaddedAsin!,
      ],
      pace: async () => undefined,
    });

    expect(adapter.requests).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.relationshipIncompleteRows).toMatchObject([
      { sellerSku: "BAD-ASIN", code: "REPORT_ASIN_INVALID" },
      { sellerSku: "PADDED-ASIN", code: "REPORT_ASIN_INVALID" },
      { sellerSku: "SKU,COMMA", code: "SELLER_SKU_UNQUERYABLE" },
    ]);
  });
});
