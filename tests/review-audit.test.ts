import { describe, expect, it } from "vitest";
import {
  REVIEW_AUDIT_CAPABILITY,
  buildReviewAuditSnapshot,
  customerFeedbackMarketplaceSupported,
  dedupeFbaReviewCandidates,
  normalizeReviewAuditResult,
} from "../src/main/amazon/review-audit";

const US = "ATVPDKIKX0DER";

function evidence(input: {
  positiveImpact: number;
  negativeImpact: number;
}) {
  return {
    dateRange: {
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    },
    positiveTopics: [{
      topic: "Taste",
      numberOfMentions: 12,
      occurrencePercentage: 20,
      starRatingImpact: input.positiveImpact,
      reviewSnippets: ["Dogs love it"],
    }],
    negativeTopics: [{
      topic: "Smell",
      numberOfMentions: 3,
      occurrencePercentage: 5,
      starRatingImpact: input.negativeImpact,
      reviewSnippets: ["Strong smell"],
    }],
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

  it("aggregates only validated exact-ASIN evidence with signed impacts", () => {
    const row = normalizeReviewAuditResult({
      candidate: candidate("B000000001"),
      evidence: evidence({
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
  });

  it("treats HTTP 204 as successful no-topic data, not a query failure", () => {
    const row = normalizeReviewAuditResult({
      candidate: candidate("B000000001"),
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

  it("preserves semantic validation failures and fails closed on missing evidence", () => {
    const cases = [
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
        error: {
          code: "CUSTOMER_FEEDBACK_ASIN_MISMATCH",
          message: "ASIN mismatch",
        },
      }, US),
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
        error: {
          code: "CUSTOMER_FEEDBACK_MARKETPLACE_MISMATCH",
          message: "Marketplace mismatch",
        },
      }, US),
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
        error: {
          code: "CUSTOMER_FEEDBACK_RESPONSE_INVALID",
          message: "Malformed response",
        },
      }, US),
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
        error: { message: "Access denied", requestId: "request-403" },
      }, US),
      normalizeReviewAuditResult({
        candidate: candidate("B000000001"),
      }, US),
    ];
    expect(cases.map((row) => row.status)).toEqual([
      "INCOMPLETE",
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
      "CUSTOMER_FEEDBACK_NOT_RETURNED",
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
        evidence: evidence({ positiveImpact, negativeImpact }),
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
    expect(snapshot.notice).toMatch(/不是商品總星等、1–5 星制/u);
    expect(snapshot.notice).toMatch(/負數保留 Amazon 原始值.*星等下降方向的影響值.*不是商品負星等.*不會轉成 0 或絕對值/u);
    expect(snapshot.bottomFiveNegative[0]?.starRatingImpact).toBe(-4.1);
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
