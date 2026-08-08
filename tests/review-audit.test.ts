import { describe, expect, it } from "vitest";
import {
  REVIEW_AUDIT_CAPABILITY,
  buildReviewAuditSnapshot,
  customerFeedbackMarketplaceSupported,
  dedupeFbaReviewCandidates,
  normalizeReviewAuditResult,
} from "../src/main/amazon/review-audit";

const US = "ATVPDKIKX0DER";

function response(input: {
  asin: string;
  positiveImpact: number;
  negativeImpact: number;
  marketplaceId?: string;
}) {
  return {
    asin: input.asin,
    itemName: "Amazon response title",
    marketplaceId: input.marketplaceId ?? US,
    countryCode: "US",
    dateRange: {
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    },
    topics: {
      positiveTopics: [{
        topic: "Taste",
        asinMetrics: {
          numberOfMentions: 12,
          occurrencePercentage: 20,
          starRatingImpact: input.positiveImpact,
        },
        parentAsinMetrics: {
          numberOfMentions: 99_999,
          occurrencePercentage: 100,
          starRatingImpact: 99,
        },
        reviewSnippets: ["Dogs love it"],
      }],
      negativeTopics: [{
        topic: "Smell",
        asinMetrics: {
          numberOfMentions: 3,
          occurrencePercentage: 5,
          starRatingImpact: input.negativeImpact,
        },
        parentAsinMetrics: {
          numberOfMentions: 88_888,
          occurrencePercentage: 100,
          starRatingImpact: -99,
        },
        reviewSnippets: ["Strong smell"],
      }],
    },
  };
}

function candidate(
  asin: string,
  sellerSkus = [`SKU-${asin.slice(-2)}`],
  relationshipRole: "child" | "standalone" = "child",
) {
  return {
    sellerSkus,
    asin,
    title: `FBA non-parent ${asin}`,
    relationshipRole,
    evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN" as const,
  };
}

describe("FBA non-parent ASIN review topic audit", () => {
  it("deduplicates shared ASINs only when relationships prove the same non-parent role", () => {
    expect(dedupeFbaReviewCandidates([
      { sellerSku: "SKU-B", asin: "B000000001", title: "Short", relationshipRole: "child" },
      { sellerSku: "SKU-A", asin: "B000000001", title: "Longer title", relationshipRole: "child" },
      { sellerSku: "SKU-C", asin: "B000000002", title: "Second", relationshipRole: "standalone" },
    ])).toEqual([
      {
        sellerSkus: ["SKU-A", "SKU-B"],
        asin: "B000000001",
        title: "Longer title",
        relationshipRole: "child",
        evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
      },
      {
        sellerSkus: ["SKU-C"],
        asin: "B000000002",
        title: "Second",
        relationshipRole: "standalone",
        evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
      },
    ]);
    expect(() => dedupeFbaReviewCandidates([
      { sellerSku: "SKU-A", asin: "B000000001", title: "Child", relationshipRole: "child" },
      { sellerSku: "SKU-B", asin: "B000000001", title: "Standalone", relationshipRole: "standalone" },
    ])).toThrow(/cannot merge child and standalone/u);
  });

  it("uses only asinMetrics and ignores parent variation metrics", () => {
    const row = normalizeReviewAuditResult({
      candidate: candidate("B000000001"),
      response: response({
        asin: "B000000001",
        positiveImpact: 4.2,
        negativeImpact: -2.1,
      }),
    }, US);
    expect(row).toMatchObject({
      status: "COMPLETE",
      nonParentAsinEvidence: "LISTINGS_RELATIONSHIPS_NON_PARENT_PLUS_CUSTOMER_FEEDBACK_ASIN",
      positiveTopics: [{ starRatingImpact: 4.2, numberOfMentions: 12 }],
      negativeTopics: [{ starRatingImpact: -2.1, numberOfMentions: 3 }],
      averageProductRating: null,
      totalReviewCount: null,
      fullReviewTextAvailable: false,
    });
    expect(JSON.stringify(row)).not.toContain("99999");
    expect(JSON.stringify(row)).not.toContain("88888");
  });

  it("treats HTTP 204 as successful no-topic data, not a query failure", () => {
    const row = normalizeReviewAuditResult({
      candidate: candidate("B000000001"),
      response: null,
      noContent: true,
      requestId: "request-204",
    }, US);
    expect(row).toMatchObject({
      status: "NO_TOPICS",
      nonParentAsinEvidence: "LISTINGS_RELATIONSHIPS_NON_PARENT_PLUS_CUSTOMER_FEEDBACK_ASIN",
      incompleteReason: null,
      positiveTopics: [],
      negativeTopics: [],
    });
  });

  it("fails closed on ASIN, marketplace, malformed, and query failures", () => {
    const cases = [
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
        response: response({ asin: "B000000002", positiveImpact: 4, negativeImpact: -1 }),
      }, US),
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
        response: response({ asin: "B000000001", positiveImpact: 4, negativeImpact: -1, marketplaceId: "A1VC38T7YXB528" }),
      }, US),
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
        response: { asin: "B000000001", marketplaceId: US, topics: {} },
      }, US),
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
        response: null,
        error: { message: "Access denied", requestId: "request-403" },
      }, US),
    ];
    expect(cases.map((row) => row.status)).toEqual([
      "INCOMPLETE",
      "INCOMPLETE",
      "INCOMPLETE",
      "INCOMPLETE",
    ]);
    expect(cases.map((row) => row.incompleteReason?.code)).toEqual([
      "CUSTOMER_FEEDBACK_ASIN_MISMATCH",
      "CUSTOMER_FEEDBACK_MARKETPLACE_MISMATCH",
      "CUSTOMER_FEEDBACK_RESPONSE_INVALID",
      "CUSTOMER_FEEDBACK_QUERY_FAILED",
    ]);
  });

  it("ranks top and bottom five by verified non-parent ASIN topic star-rating impact", () => {
    const impacts = [
      ["B000000001", 3.1, -0.4],
      ["B000000002", 4.9, -1.2],
      ["B000000003", 2.8, -4.1],
      ["B000000004", 4.2, -2.2],
      ["B000000005", 1.1, -0.1],
      ["B000000006", 3.9, -3.3],
    ] as const;
    const snapshot = buildReviewAuditSnapshot({
      mode: "live",
      marketplaceId: US,
      fetchedAt: "2026-08-09T00:00:00.000Z",
      sourceCandidateCount: 7,
      results: impacts.map(([asin, positiveImpact, negativeImpact], index) => ({
        candidate: candidate(
          asin,
          index === 0 ? [`SKU-${asin.slice(-2)}`, "SKU-DUPLICATE"] : undefined,
          index % 2 === 0 ? "child" : "standalone",
        ),
        response: response({ asin, positiveImpact, negativeImpact }),
      })),
    });
    expect(snapshot.topFivePositive.map(({ asin }) => asin)).toEqual([
      "B000000002",
      "B000000004",
      "B000000006",
      "B000000001",
      "B000000003",
    ]);
    expect(snapshot.bottomFiveNegative.map(({ asin }) => asin)).toEqual([
      "B000000003",
      "B000000006",
      "B000000004",
      "B000000002",
      "B000000001",
    ]);
    expect(snapshot.summary).toMatchObject({
      uniqueFbaNonParentAsins: 6,
      verifiedNonParentListings: 7,
      verifiedChildListings: 4,
      verifiedStandaloneListings: 3,
      completed: 6,
      duplicateSkuAsinsCollapsed: 1,
    });
    expect(snapshot.notice).toMatch(/不是商品總星等/u);
  });

  it("documents role alternatives, supported stores, weekly English-only data and no review corpus", () => {
    expect(REVIEW_AUDIT_CAPABILITY).toMatchObject({
      roles: ["Selling Partner Insights", "Brand Analytics"],
      updateCadence: "WEEKLY",
      topicLanguage: "ENGLISH_ONLY",
      http204Meaning: "SUCCESS_NO_TOPIC_DATA",
      fullReviewTextAvailable: false,
      averageProductRatingAvailable: false,
      totalReviewCountAvailable: false,
      parentMetricsUsed: false,
      nonParentFbaAsinsOnly: true,
      relationshipsEvidenceRequired: true,
      parentContainersExcluded: true,
    });
    expect(customerFeedbackMarketplaceSupported(US)).toBe(true);
    expect(customerFeedbackMarketplaceSupported("A1VC38T7YXB528")).toBe(true);
    expect(customerFeedbackMarketplaceSupported("A2EUQ1WTGCTBG2")).toBe(false);
  });
});
