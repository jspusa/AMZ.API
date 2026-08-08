import { describe, expect, it } from "vitest";
import { classifyUnboundVariationEvidence } from "../src/main/amazon/unbound-variation-audit";
import {
  buildUnboundVariationSearchBatches,
  classifyUnboundVariationSearchBatch,
  parseFbaListingReportSeeds,
  unboundVariationSearchIncludedData,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

describe("unbound variation relationship evidence", () => {
  it("builds exact official search batches of at most 20 without trimming or aliasing", () => {
    const sellerSkus = Array.from({ length: 45 }, (_, index) =>
      `SKU-${String(index + 1).padStart(2, "0")}`);
    const result = buildUnboundVariationSearchBatches([
      ...sellerSkus,
      "SKU,AMBIGUOUS",
    ]);

    expect(result.batches.map((batch) => batch.length)).toEqual([20, 20, 5]);
    expect(result.batches.flat()).toEqual(sellerSkus);
    expect(result.unqueryableSellerSkus).toEqual(["SKU,AMBIGUOUS"]);
    expect(unboundVariationSearchIncludedData()).toBe(
      "relationships,summaries,fulfillmentAvailability,productTypes",
    );
  });

  it("classifies exact returned rows and keeps missing batch rows incomplete", () => {
    const seeds = [
      { sellerSku: "STANDALONE", asin: "B000000001", title: "Standalone" },
      { sellerSku: "CHILD", asin: "B000000002", title: "Child" },
      { sellerSku: "MISSING", asin: "B000000003", title: "Missing" },
    ];
    const result = classifyUnboundVariationSearchBatch({
      marketplaceId: MARKETPLACE_ID,
      seeds,
      status: 200,
      requestId: "request-1",
      payload: {
        numberOfResults: 2,
        items: [
          {
            sku: "STANDALONE",
            summaries: [{
              marketplaceId: MARKETPLACE_ID,
              asin: "B000000001",
              itemName: "Standalone",
            }],
            productTypes: [{
              marketplaceId: MARKETPLACE_ID,
              productType: "PET_FOOD",
            }],
            fulfillmentAvailability: [{
              fulfillmentChannelCode: "AMAZON_NA",
              quantity: 1,
            }],
            relationships: [],
          },
          {
            sku: "CHILD",
            summaries: [{
              marketplaceId: MARKETPLACE_ID,
              asin: "B000000002",
              itemName: "Child",
            }],
            productTypes: [{
              marketplaceId: MARKETPLACE_ID,
              productType: "PET_FOOD",
            }],
            fulfillmentAvailability: [{
              fulfillmentChannelCode: "AMAZON_NA",
              quantity: 1,
            }],
            relationships: [{
              marketplaceId: MARKETPLACE_ID,
              relationships: [{ parentSkus: ["PARENT"] }],
            }],
          },
        ],
        pagination: {},
      },
    });

    expect(result.rows.map((row) => row.sellerSku)).toEqual(["STANDALONE"]);
    expect(result.boundChildren).toBe(1);
    expect(result.incompleteRows).toMatchObject([{
      sellerSku: "MISSING",
      code: "RELATIONSHIPS_NOT_RETURNED",
      requestId: "request-1",
    }]);
  });

  it("marks a 400 compatibility response or an ambiguous response as an incomplete batch", () => {
    const seeds = [
      { sellerSku: "SKU-ONE", asin: "B000000001", title: "One" },
      { sellerSku: "SKU-TWO", asin: "B000000002", title: "Two" },
    ];
    expect(classifyUnboundVariationSearchBatch({
      marketplaceId: MARKETPLACE_ID,
      seeds,
      status: 400,
      payload: null,
      requestId: "request-400",
    }).incompleteRows).toMatchObject([
      { sellerSku: "SKU-ONE", code: "RELATIONSHIPS_COMPATIBILITY_FALLBACK" },
      { sellerSku: "SKU-TWO", code: "RELATIONSHIPS_COMPATIBILITY_FALLBACK" },
    ]);

    const ambiguous = classifyUnboundVariationSearchBatch({
      marketplaceId: MARKETPLACE_ID,
      seeds,
      status: 200,
      requestId: "request-invalid",
      payload: {
        numberOfResults: 2,
        items: [{ sku: "SKU-ONE" }, { sku: "SKU-ONE" }],
        pagination: {},
      },
    });
    expect(ambiguous.rows).toEqual([]);
    expect(ambiguous.incompleteRows).toHaveLength(2);
    expect(ambiguous.incompleteRows.every(
      (row) => row.code === "RELATIONSHIP_RESPONSE_INVALID",
    )).toBe(true);
  });

  it("does not use another marketplace summary as the current marketplace", () => {
    const result = classifyUnboundVariationSearchBatch({
      marketplaceId: MARKETPLACE_ID,
      seeds: [{ sellerSku: "SKU-US", asin: "B000000001", title: "US seed" }],
      status: 200,
      requestId: "request-other-marketplace",
      payload: {
        numberOfResults: 1,
        items: [{
          sku: "SKU-US",
          summaries: [{
            marketplaceId: "A2EUQ1WTGCTBG2",
            asin: "B000000001",
            itemName: "Canada listing",
          }],
          fulfillmentAvailability: [{
            fulfillmentChannelCode: "AMAZON_NA",
            quantity: 1,
          }],
          relationships: [],
        }],
        pagination: {},
      },
    });

    expect(result.rows).toEqual([]);
    expect(result.incompleteRows).toMatchObject([{
      sellerSku: "SKU-US",
      asin: "B000000001",
      code: "RELATIONSHIP_RESPONSE_INVALID",
      requestId: "request-other-marketplace",
    }]);
    expect(result.incompleteRows[0]?.message).toMatch(/其他站點/u);
  });

  it("keeps conflicting report and live ASIN evidence incomplete", () => {
    const result = classifyUnboundVariationSearchBatch({
      marketplaceId: MARKETPLACE_ID,
      seeds: [{ sellerSku: "SKU-ASIN", asin: "B000000001", title: "Seed" }],
      status: 200,
      requestId: "request-conflicting-asin",
      payload: {
        numberOfResults: 1,
        items: [{
          sku: "SKU-ASIN",
          summaries: [{
            marketplaceId: MARKETPLACE_ID,
            asin: "B000000099",
            itemName: "Different ASIN",
          }],
          fulfillmentAvailability: [{
            fulfillmentChannelCode: "AMAZON_NA",
            quantity: 1,
          }],
          relationships: [],
        }],
        pagination: {},
      },
    });

    expect(result.rows).toEqual([]);
    expect(result.incompleteRows).toMatchObject([{
      sellerSku: "SKU-ASIN",
      asin: "B000000001",
      code: "RELATIONSHIP_RESPONSE_INVALID",
    }]);
    expect(result.incompleteRows[0]?.message).toMatch(/ASIN.*不一致/u);
  });

  it("uses the one exact current-marketplace summary and rejects ambiguous summaries", () => {
    const seed = { sellerSku: "SKU-CURRENT", asin: "B000000001", title: "Seed" };
    const current = classifyUnboundVariationSearchBatch({
      marketplaceId: MARKETPLACE_ID,
      seeds: [seed],
      status: 200,
      requestId: "request-current-summary",
      payload: {
        numberOfResults: 1,
        items: [{
          sku: seed.sellerSku,
          summaries: [
            {
              marketplaceId: "A2EUQ1WTGCTBG2",
              asin: "B000000099",
              itemName: "Canada listing",
            },
            {
              marketplaceId: MARKETPLACE_ID,
              asin: seed.asin,
              itemName: "Exact US listing",
              productType: "PET_FOOD",
            },
          ],
          fulfillmentAvailability: [{
            fulfillmentChannelCode: "AMAZON_NA",
            quantity: 1,
          }],
          relationships: [],
        }],
        pagination: {},
      },
    });
    expect(current.incompleteRows).toEqual([]);
    expect(current.rows).toMatchObject([{
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: "Exact US listing",
      productType: "PET_FOOD",
    }]);

    for (const summaries of [
      [
        { marketplaceId: MARKETPLACE_ID, asin: seed.asin },
        { marketplaceId: MARKETPLACE_ID, asin: seed.asin },
      ],
      [
        { marketplaceId: MARKETPLACE_ID, asin: seed.asin },
        { asin: seed.asin },
      ],
    ]) {
      const ambiguous = classifyUnboundVariationSearchBatch({
        marketplaceId: MARKETPLACE_ID,
        seeds: [seed],
        status: 200,
        requestId: "request-ambiguous-summary",
        payload: {
          numberOfResults: 1,
          items: [{
            sku: seed.sellerSku,
            summaries,
            fulfillmentAvailability: [{
              fulfillmentChannelCode: "AMAZON_NA",
              quantity: 1,
            }],
            relationships: [],
          }],
          pagination: {},
        },
      });
      expect(ambiguous.rows).toEqual([]);
      expect(ambiguous.incompleteRows).toMatchObject([{
        sellerSku: seed.sellerSku,
        code: "RELATIONSHIP_RESPONSE_INVALID",
      }]);
    }
  });

  it("fails closed instead of trimming, dropping or merging FBA Seller SKUs", () => {
    const report = (sellerSkus: string[]) => [
      "item-name\tseller-sku\tasin1\tfulfillment-channel",
      ...sellerSkus.map((sellerSku, index) =>
        `Product ${index + 1}\t${sellerSku}\tB00000000${index + 1}\tAMAZON`,
      ),
    ].join("\n");

    expect(parseFbaListingReportSeeds(report(["SKU-ONE"]))).toMatchObject([
      { sellerSku: "SKU-ONE" },
    ]);
    expect(() => parseFbaListingReportSeeds(report([" SKU-ONE"]))).toThrow(
      /無法精確辨識/u,
    );
    expect(() => parseFbaListingReportSeeds(report(["SKU-ONE", "SKU-ONE"]))).toThrow(
      /重複/u,
    );
    expect(() => parseFbaListingReportSeeds(report([""]))).toThrow(/缺少/u);
  });

  it("only marks standalone FBA report rows unbound after an explicit relationships dataset", () => {
    expect(classifyUnboundVariationEvidence({
      marketplaceId: MARKETPLACE_ID,
      profile: "relationships",
      relationships: [],
      role: "standalone",
      listingFulfillmentEvidence: "MISSING",
    })).toEqual({ kind: "unbound" });
  });

  it("keeps a missing relationships dataset incomplete instead of treating it as empty", () => {
    expect(classifyUnboundVariationEvidence({
      marketplaceId: MARKETPLACE_ID,
      profile: "relationships",
      relationships: undefined,
      role: "standalone",
      listingFulfillmentEvidence: "FBA",
    })).toMatchObject({
      kind: "incomplete",
      code: "RELATIONSHIPS_NOT_RETURNED",
    });
  });

  it("keeps the attributes-only compatibility fallback incomplete", () => {
    expect(classifyUnboundVariationEvidence({
      marketplaceId: MARKETPLACE_ID,
      profile: "attributes",
      relationships: [],
      role: "standalone",
      listingFulfillmentEvidence: "FBA",
    })).toMatchObject({
      kind: "incomplete",
      code: "RELATIONSHIPS_COMPATIBILITY_FALLBACK",
    });
  });

  it("separates bound child and parent container results", () => {
    const relationships = [{ marketplaceId: MARKETPLACE_ID, relationships: [] }];
    expect(classifyUnboundVariationEvidence({
      marketplaceId: MARKETPLACE_ID,
      profile: "relationships",
      relationships,
      role: "child",
      listingFulfillmentEvidence: "FBA",
    })).toEqual({ kind: "bound-child" });
    expect(classifyUnboundVariationEvidence({
      marketplaceId: MARKETPLACE_ID,
      profile: "relationships",
      relationships,
      role: "parent",
      listingFulfillmentEvidence: "FBA",
    })).toEqual({ kind: "parent-container" });
  });

  it("fails closed on another marketplace or conflicting fulfillment evidence", () => {
    expect(classifyUnboundVariationEvidence({
      marketplaceId: MARKETPLACE_ID,
      profile: "relationships",
      relationships: [{ marketplaceId: "A2EUQ1WTGCTBG2", relationships: [] }],
      role: "standalone",
      listingFulfillmentEvidence: "FBA",
    })).toMatchObject({
      kind: "incomplete",
      code: "RELATIONSHIP_RESPONSE_INVALID",
    });
    expect(classifyUnboundVariationEvidence({
      marketplaceId: MARKETPLACE_ID,
      profile: "relationships",
      relationships: [],
      role: "standalone",
      listingFulfillmentEvidence: "OTHER",
    })).toMatchObject({
      kind: "incomplete",
      code: "FULFILLMENT_EVIDENCE_CONFLICT",
    });
  });

  it("fails closed when any relationship group is malformed instead of filtering it away", () => {
    const validGroup = {
      marketplaceId: MARKETPLACE_ID,
      relationships: [],
    };
    for (const relationships of [
      [null, validGroup],
      [validGroup, { marketplaceId: "A2EUQ1WTGCTBG2" }],
      [{ relationships: [] }],
      [validGroup, { ...validGroup }],
      [{ ...validGroup, relationships: [null] }],
      [{
        ...validGroup,
        relationships: [{ parentSkus: [" PARENT-OLD"] }],
      }],
    ]) {
      expect(classifyUnboundVariationEvidence({
        marketplaceId: MARKETPLACE_ID,
        profile: "relationships",
        relationships,
        role: "standalone",
        listingFulfillmentEvidence: "FBA",
      })).toMatchObject({
        kind: "incomplete",
        code: "RELATIONSHIP_RESPONSE_INVALID",
      });
    }
  });
});
