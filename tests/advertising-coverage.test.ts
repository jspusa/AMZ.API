import { describe, expect, it } from "vitest";
import {
  auditAdvertisingCoverage,
  parseProductAiCampaignName,
  prepareAdvertisingCoverageListings,
} from "../src/main/amazon/advertising-coverage";

describe("FBA advertising coverage audit", () => {
  it("fails closed for listing errors, invalid ASIN, and missing SKU", () => {
    expect(() => prepareAdvertisingCoverageListings({
      rows: [{ sellerSku: "SKU-1", asin: "B092384873", title: "Safe" }],
      errors: [{ sellerSku: "SKU-2", message: "Listings read failed" }],
    })).toThrow("不會把部分資料稱為全站");
    expect(() => prepareAdvertisingCoverageListings({
      rows: [{ sellerSku: "SKU-1", asin: "", title: "Missing ASIN" }],
      errors: [],
    })).toThrow("Seller SKU／ASIN");
    expect(() => prepareAdvertisingCoverageListings({
      rows: [{ sellerSku: "", asin: "B092384873", title: "Missing SKU" }],
      errors: [],
    })).toThrow("Seller SKU／ASIN");
  });
  it("parses only the documented ProductAI SP-PAT campaign name", () => {
    expect(
      parseProductAiCampaignName(
        "[ProductAI] US-B092384873-AFA33AM-SP-PAT-Jul242026",
      ),
    ).toEqual({
      marketplaceCode: "US",
      asin: "B092384873",
      sellerSku: "AFA33AM",
    });
    expect(
      parseProductAiCampaignName(
        "[ProductAI] US-B092384873-AFA-33-AM-SP-PAT-Feb292026",
      ),
    ).toBeNull();
    expect(
      parseProductAiCampaignName(
        "[ProductAI] US-B092384873-AFA-33-AM-SP-PAT-Feb292024",
      ),
    ).toMatchObject({ sellerSku: "AFA-33-AM" });
    expect(parseProductAiCampaignName("ordinary campaign")).toBeNull();
  });

  it("counts exact SKU and same-ASIN coverage while listing uncovered FBA SKUs", () => {
    const result = auditAdvertisingCoverage({
      mode: "demo",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceCode: "US",
      fetchedAt: "2026-08-09T00:00:00.000Z",
      listings: [
        { sellerSku: "AFA33AM", asin: "B092384873", title: "Afreschi 3 oz" },
        { sellerSku: "AFA33AM-2", asin: "B092384873", title: "Afreschi twin" },
        { sellerSku: "GTC01AM", asin: "B012345678", title: "GooToE" },
      ],
      campaigns: [
        {
          campaignId: "c1",
          name: "[ProductAI] US-B092384873-AFA33AM-SP-PAT-Jul242026",
          state: "ENABLED",
          adProduct: "SPONSORED_PRODUCTS",
        },
      ],
    });

    expect(result.summary).toMatchObject({
      currentFbaSkuCount: 3,
      coveredSkuCount: 2,
      directSkuCount: 1,
      sameAsinCount: 1,
      uncoveredSkuCount: 1,
      eligibleCampaignCount: 1,
    });
    expect(result.rows.find((row) => row.sellerSku === "AFA33AM")?.evidence?.kind)
      .toBe("seller-sku");
    expect(result.rows.find((row) => row.sellerSku === "AFA33AM")?.evidence)
      .toMatchObject({ campaignId: "coverage-evidence.1" });
    expect(JSON.stringify(result)).not.toContain('"campaignId":"c1"');
    expect(result.rows.find((row) => row.sellerSku === "AFA33AM-2")?.evidence)
      .toMatchObject({ kind: "same-asin", campaignSellerSku: "AFA33AM" });
    expect(result.uncovered.map((row) => row.sellerSku)).toEqual(["GTC01AM"]);
  });

  it("fails closed for inactive, wrong-market, wrong-product and unknown-SKU campaigns", () => {
    const listing = {
      sellerSku: "AFA33AM",
      asin: "B092384873",
      title: "Afreschi",
    };
    const result = auditAdvertisingCoverage({
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceCode: "US",
      listings: [listing],
      campaigns: [
        {
          campaignId: "paused",
          name: "[ProductAI] US-B092384873-AFA33AM-SP-PAT-Jul242026",
          state: "PAUSED",
        },
        {
          campaignId: "wrong-market",
          name: "[ProductAI] CA-B092384873-AFA33AM-SP-PAT-Jul242026",
          state: "ENABLED",
        },
        {
          campaignId: "wrong-product",
          name: "[ProductAI] US-B092384873-AFA33AM-SP-PAT-Jul242026",
          state: "ENABLED",
          adProduct: "SPONSORED_BRANDS",
        },
        {
          campaignId: "unknown-sku",
          name: "[ProductAI] US-B092384873-NOT-CURRENT-FBA-SP-PAT-Jul242026",
          state: "ENABLED",
        },
      ],
    });
    expect(result.summary).toMatchObject({
      coveredSkuCount: 0,
      uncoveredSkuCount: 1,
      ignoredInactiveCampaignCount: 1,
      ignoredMalformedCampaignCount: 3,
    });
  });

  it("rejects duplicate or malformed current FBA evidence", () => {
    expect(() =>
      auditAdvertisingCoverage({
        mode: "live",
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceCode: "US",
        listings: [
          { sellerSku: "AFA33AM", asin: "B092384873", title: "one" },
          { sellerSku: "AFA33AM", asin: "B092384873", title: "two" },
        ],
        campaigns: [],
      }),
    ).toThrow(/FBA 商品清單/u);
  });
});
