import { describe, expect, it } from "vitest";
import { classifyUnboundVariationEvidence } from "../src/main/amazon/unbound-variation-audit";
import { parseFbaListingReportSeeds } from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

describe("unbound variation relationship evidence", () => {
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
