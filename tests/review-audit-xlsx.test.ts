import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildReviewAuditSnapshot } from "../src/main/amazon/review-audit";
import { createReviewAuditWorkbook } from "../src/main/amazon/review-audit-xlsx";

const US = "ATVPDKIKX0DER";

function topicEvidence() {
  return {
    dateRange: {
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    },
    positiveTopics: [
      {
        topic: "Taste",
        numberOfMentions: 12,
        occurrencePercentage: 20,
        starRatingImpact: 4.6,
        reviewSnippets: ["Dogs love it"],
      },
      {
        topic: "Texture",
        numberOfMentions: 6,
        occurrencePercentage: 10,
        starRatingImpact: 3.2,
        reviewSnippets: ["Good chew"],
      },
    ],
    negativeTopics: [{
      topic: "Smell",
      numberOfMentions: 3,
      occurrencePercentage: 5,
      starRatingImpact: -2.4,
      reviewSnippets: ["Strong smell"],
    }],
  };
}

describe("review topic audit Excel", () => {
  it("exports every proven non-parent-ASIN topic and explicit capability boundaries", () => {
    const snapshot = buildReviewAuditSnapshot({
      mode: "live",
      marketplaceId: US,
      fetchedAt: "2026-08-09T00:00:00.000Z",
      relationshipIncompleteRows: [{
        sellerSku: "REL-MISSING",
        asin: "B000000003",
        title: "Relationship incomplete",
        code: "RELATIONSHIPS_NOT_RETURNED",
        message: "Amazon did not return relationships; Customer Feedback was not called.",
        requestId: "req-rel",
      }],
      candidateCoverage: {
        sourceFbaListings: 4,
        verifiedNonParentListings: 2,
        verifiedChildListings: 1,
        verifiedStandaloneListings: 1,
        excludedParentContainers: 1,
        relationshipIncomplete: 1,
      },
      results: [
        {
          candidate: {
            sellerSkus: ["AFA12AM"],
            asin: "B000000001",
            title: "Turkey tendon",
            relationshipRole: "child",
            evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
          },
          evidence: topicEvidence(),
        },
        {
          candidate: {
            sellerSkus: ["AFA13AM"],
            asin: "B000000002",
            title: "Second product",
            relationshipRole: "standalone",
            evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
          },
          error: { message: "Role unavailable", requestId: "req-403" },
        },
      ],
    });
    const bytes = createReviewAuditWorkbook({
      marketplaceLabel: "US · Amazon.com",
      snapshot,
    });
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const archive = unzipSync(bytes);
    const workbook = strFromU8(archive["xl/workbook.xml"]);
    for (const name of ["說明", "全部非ParentASIN", "前後五名", "正向主題", "負向主題", "未完成"]) {
      expect(workbook).toContain(`name="${name}"`);
    }
    const summary = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const all = strFromU8(archive["xl/worksheets/sheet2.xml"]);
    const positive = strFromU8(archive["xl/worksheets/sheet4.xml"]);
    const negative = strFromU8(archive["xl/worksheets/sheet5.xml"]);
    const incomplete = strFromU8(archive["xl/worksheets/sheet6.xml"]);
    for (const sheetNumber of [1, 2, 3, 4, 5, 6]) {
      const sheet = strFromU8(archive[`xl/worksheets/sheet${sheetNumber}.xml`]);
      expect(sheet).toContain('<pageSetUpPr fitToPage="1"/>');
      expect(sheet).toContain('<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>');
      expect(sheet).toContain('<pageSetup paperSize="9" orientation="landscape" pageOrder="downThenOver" fitToWidth="1" fitToHeight="0"/>');
    }
    expect(workbook.match(/name="_xlnm\.Print_Titles"/gu)).toHaveLength(4);
    expect(workbook).toContain("localSheetId=\"1\">'全部非ParentASIN'!$1:$1");
    expect(workbook).toContain("localSheetId=\"3\">'正向主題'!$1:$1");
    expect(workbook).toContain("localSheetId=\"4\">'負向主題'!$1:$1");
    expect(workbook).toContain("localSheetId=\"5\">'未完成'!$1:$1");
    expect(summary).toContain("完整 review 全文、商品平均星等、總評論數");
    expect(summary).toContain("非 parent ASIN 評論主題影響值");
    expect(summary).toContain("不是商品總星等或 1–5 星制");
    expect(summary).toContain("負數是此負向主題對星等下降方向的影響值，不是商品負星等");
    expect(summary).toContain("不轉成 0 或絕對值");
    expect(summary).toContain("已排除 parent");
    expect(all).toContain("AFA12AM");
    expect(all).toContain("B000000002");
    expect(all.match(/公開 API 不提供/gu)).toHaveLength(6);
    expect(positive).toContain("Taste");
    expect(positive).toContain("Texture");
    expect(positive).toContain("Dogs love it");
    expect(negative).toContain("Smell");
    expect(negative).toContain("主題影響值");
    expect(negative).toContain("<v>-2.4</v>");
    expect(incomplete).toContain("Role unavailable");
    expect(incomplete).toContain("req-403");
    expect(incomplete).toContain("REL-MISSING");
    expect(incomplete).toContain("req-rel");
    expect(incomplete).toContain("Listings relationships");
    expect(JSON.stringify(Object.keys(archive))).not.toContain("sellercentral.amazon");
  });

  it("neutralizes spreadsheet formulas and does not output formulas", () => {
    const snapshot = buildReviewAuditSnapshot({
      mode: "demo",
      marketplaceId: US,
      fetchedAt: "2026-08-09T00:00:00.000Z",
      results: [{
        candidate: {
          sellerSkus: ["=DANGEROUS"],
          asin: "B000000001",
          title: "+Formula title",
          relationshipRole: "child",
          evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
        },
        evidence: topicEvidence(),
      }],
    });
    const archive = unzipSync(createReviewAuditWorkbook({
      marketplaceLabel: "US",
      snapshot,
    }));
    const all = strFromU8(archive["xl/worksheets/sheet2.xml"]);
    expect(all).toContain("&apos;=DANGEROUS");
    expect(all).toContain("&apos;+Formula title");
    expect(all).not.toContain("<f>");
  });

  it("rejects a snapshot that claims unavailable full review metrics", () => {
    const snapshot = buildReviewAuditSnapshot({
      mode: "demo",
      marketplaceId: US,
      fetchedAt: "2026-08-09T00:00:00.000Z",
      results: [],
    });
    const unsafe = structuredClone(snapshot) as unknown as {
      availability: { fullReviewTextAvailable: boolean };
    };
    unsafe.availability.fullReviewTextAvailable = true;
    expect(() => createReviewAuditWorkbook({
      marketplaceLabel: "US",
      snapshot: unsafe as never,
    })).toThrow(/capability boundary/u);
  });
});
