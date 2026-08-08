import {
  CUSTOMER_FEEDBACK_SUPPORTED_CONFIGURED_MARKETPLACES,
  type ReportLibraryMarketplaceId,
} from "./report-library";

const MAX_TEXT = 5_000;
const MAX_SKU = 40;
const MAX_TOPICS = 10;
const CUSTOMER_FEEDBACK_SOURCE =
  "https://developer-docs.amazon.com/sp-api/docs/get-feedback-insights-asin";

export type FbaReviewCandidate = {
  sellerSku: string;
  asin: string;
  title: string;
  relationshipRole: "child" | "standalone";
};

export type DedupedFbaReviewCandidate = {
  sellerSkus: string[];
  asin: string;
  title: string;
  relationshipRole: "child" | "standalone";
  evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN";
};

export type ReviewAuditRelationshipIncompleteRow = {
  sellerSku: string;
  asin: string;
  title: string;
  code:
    | "REPORT_ASIN_INVALID"
    | "SELLER_SKU_UNQUERYABLE"
    | "RELATIONSHIPS_NOT_RETURNED"
    | "RELATIONSHIPS_COMPATIBILITY_FALLBACK"
    | "RELATIONSHIP_QUERY_FAILED"
    | "RELATIONSHIP_RESPONSE_INVALID"
    | "RELATIONSHIP_ROLE_CONFLICT"
    | "FULFILLMENT_EVIDENCE_CONFLICT";
  message: string;
  requestId: string | null;
};

export type ReviewAuditCandidateCoverage = {
  sourceFbaListings: number;
  verifiedNonParentListings: number;
  verifiedChildListings: number;
  verifiedStandaloneListings: number;
  excludedParentContainers: number;
  relationshipIncomplete: number;
};

export type ReviewTopicEvidence = {
  topic: string;
  numberOfMentions: number;
  occurrencePercentage: number;
  starRatingImpact: number;
  reviewSnippets: string[];
};

export type ReviewAuditIncompleteReason = {
  code:
    | "CUSTOMER_FEEDBACK_NOT_RETURNED"
    | "CUSTOMER_FEEDBACK_RESPONSE_INVALID"
    | "CUSTOMER_FEEDBACK_ASIN_MISMATCH"
    | "CUSTOMER_FEEDBACK_MARKETPLACE_MISMATCH"
    | "CUSTOMER_FEEDBACK_QUERY_FAILED";
  message: string;
  requestId: string | null;
};

export type ReviewAuditRow = {
  sellerSkus: string[];
  asin: string;
  title: string;
  relationshipRole: "child" | "standalone";
  status: "COMPLETE" | "NO_TOPICS" | "INCOMPLETE";
  nonParentAsinEvidence:
    | "LISTINGS_RELATIONSHIPS_NON_PARENT_PLUS_CUSTOMER_FEEDBACK_ASIN"
    | null;
  dateRange: { startDate: string; endDate: string } | null;
  positiveTopics: ReviewTopicEvidence[];
  negativeTopics: ReviewTopicEvidence[];
  incompleteReason: ReviewAuditIncompleteReason | null;
  /** Not published by Customer Feedback getItemReviewTopics. */
  averageProductRating: null;
  /** Not published by Customer Feedback getItemReviewTopics. */
  totalReviewCount: null;
  /** The public API exposes only short evidence snippets, not a review corpus. */
  fullReviewTextAvailable: false;
};

export type ReviewAuditRankedItem = {
  sellerSkus: string[];
  asin: string;
  title: string;
  topic: string;
  numberOfMentions: number;
  occurrencePercentage: number;
  starRatingImpact: number;
  metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT";
};

export type ReviewAuditSnapshot = {
  schemaVersion: 2;
  mode: "live" | "demo";
  marketplaceId: ReportLibraryMarketplaceId;
  fetchedAt: string;
  rows: ReviewAuditRow[];
  relationshipIncompleteRows: ReviewAuditRelationshipIncompleteRow[];
  topFivePositive: ReviewAuditRankedItem[];
  bottomFiveNegative: ReviewAuditRankedItem[];
  summary: {
    sourceFbaListings: number;
    verifiedNonParentListings: number;
    uniqueFbaNonParentAsins: number;
    verifiedChildListings: number;
    verifiedStandaloneListings: number;
    excludedParentContainers: number;
    relationshipIncomplete: number;
    completed: number;
    noTopics: number;
    feedbackIncomplete: number;
    totalIncomplete: number;
    /** @deprecated Transitional alias for totalIncomplete. */
    incomplete: number;
    duplicateSkuAsinsCollapsed: number;
  };
  availability: {
    source: "CUSTOMER_FEEDBACK_API_2024_06_01";
    supported: true;
    nonParentFbaAsinsOnly: true;
    relationshipsEvidenceRequired: true;
    parentContainersExcluded: true;
    fullReviewTextAvailable: false;
    averageProductRatingAvailable: false;
    totalReviewCountAvailable: false;
    officialSource: string;
  };
  notice: string;
};

export type ReviewAuditFetchResult = {
  candidate: DedupedFbaReviewCandidate;
  response: unknown | null;
  /** HTTP 204 is a successful requested-ASIN query with no topic payload. */
  noContent?: boolean;
  requestId?: string | null;
  error?: {
    code?: string | null;
    message?: string | null;
    requestId?: string | null;
  } | null;
};

export function customerFeedbackMarketplaceSupported(
  marketplaceId: string,
): marketplaceId is ReportLibraryMarketplaceId {
  return (CUSTOMER_FEEDBACK_SUPPORTED_CONFIGURED_MARKETPLACES as readonly string[])
    .includes(marketplaceId);
}

function requiredText(value: unknown, label: string, maximum = MAX_TEXT): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${label} is invalid.`);
  return text;
}

function validateCandidate(candidate: FbaReviewCandidate): FbaReviewCandidate {
  const sellerSku = requiredText(candidate.sellerSku, "sellerSku", MAX_SKU);
  if (!/^[A-Z0-9]{10}$/u.test(candidate.asin)) {
    throw new TypeError("asin must be a canonical ten-character ASIN.");
  }
  return {
    sellerSku,
    asin: candidate.asin,
    title: requiredText(candidate.title, "title"),
    relationshipRole: candidate.relationshipRole === "child"
      ? "child"
      : candidate.relationshipRole === "standalone"
        ? "standalone"
        : (() => { throw new TypeError("relationshipRole is invalid."); })(),
  };
}

/**
 * Collapses duplicate Seller SKUs only after Listings relationships proved the
 * same non-parent role and ASIN. A mixed child/standalone ASIN is rejected so
 * callers cannot hide conflicting relationship evidence by deduplicating it.
 */
export function dedupeFbaReviewCandidates(
  candidates: readonly FbaReviewCandidate[],
): DedupedFbaReviewCandidate[] {
  const byAsin = new Map<string, DedupedFbaReviewCandidate>();
  for (const raw of candidates) {
    const candidate = validateCandidate(raw);
    const existing = byAsin.get(candidate.asin);
    if (existing) {
      if (existing.relationshipRole !== candidate.relationshipRole) {
        throw new TypeError(
          "Review audit cannot merge child and standalone relationship evidence.",
        );
      }
      if (!existing.sellerSkus.includes(candidate.sellerSku)) {
        existing.sellerSkus.push(candidate.sellerSku);
        existing.sellerSkus.sort((left, right) => left.localeCompare(right, "en"));
      }
      if (candidate.title.length > existing.title.length) existing.title = candidate.title;
      continue;
    }
    byAsin.set(candidate.asin, {
      sellerSkus: [candidate.sellerSku],
      asin: candidate.asin,
      title: candidate.title,
      relationshipRole: candidate.relationshipRole,
      evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
    });
  }
  return [...byAsin.values()].sort((left, right) =>
    left.asin.localeCompare(right.asin, "en"),
  );
}

function parseTopics(value: unknown, label: string): ReviewTopicEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_TOPICS) {
    throw new TypeError(`${label} is invalid.`);
  }
  const topics = value.map((item, index) => {
    const raw = record(item, `${label}[${index}]`);
    const metrics = record(raw.asinMetrics, `${label}[${index}].asinMetrics`);
    const occurrencePercentage = finiteNumber(
      metrics.occurrencePercentage,
      `${label}[${index}].occurrencePercentage`,
    );
    if (occurrencePercentage < 0 || occurrencePercentage > 100) {
      throw new TypeError(`${label}[${index}].occurrencePercentage is invalid.`);
    }
    const snippets = raw.reviewSnippets === undefined ? [] : raw.reviewSnippets;
    if (!Array.isArray(snippets) || snippets.length > 20) {
      throw new TypeError(`${label}[${index}].reviewSnippets is invalid.`);
    }
    return {
      topic: requiredText(raw.topic, `${label}[${index}].topic`, 300),
      numberOfMentions: nonNegativeInteger(
        metrics.numberOfMentions,
        `${label}[${index}].numberOfMentions`,
      ),
      occurrencePercentage,
      starRatingImpact: finiteNumber(
        metrics.starRatingImpact,
        `${label}[${index}].starRatingImpact`,
      ),
      reviewSnippets: snippets.map((snippet, snippetIndex) =>
        requiredText(snippet, `${label}[${index}].reviewSnippets[${snippetIndex}]`, 1_000),
      ),
    };
  });
  const names = topics.map(({ topic }) => topic);
  if (new Set(names).size !== names.length) {
    throw new TypeError(`${label} contains duplicate topics.`);
  }
  return topics;
}

function incompleteRow(
  candidate: DedupedFbaReviewCandidate,
  reason: ReviewAuditIncompleteReason,
): ReviewAuditRow {
  return {
    sellerSkus: [...candidate.sellerSkus],
    asin: candidate.asin,
    title: candidate.title,
    relationshipRole: candidate.relationshipRole,
    status: "INCOMPLETE",
    nonParentAsinEvidence: null,
    dateRange: null,
    positiveTopics: [],
    negativeTopics: [],
    incompleteReason: reason,
    averageProductRating: null,
    totalReviewCount: null,
    fullReviewTextAvailable: false,
  };
}

/**
 * Parses only the requested ASIN's asinMetrics. parentAsinMetrics,
 * browseNodeMetrics and childAsinMetrics are deliberately ignored so the audit
 * cannot duplicate a variation-family aggregate or infer unavailable data.
 */
export function normalizeReviewAuditResult(
  result: ReviewAuditFetchResult,
  marketplaceId: ReportLibraryMarketplaceId,
): ReviewAuditRow {
  const candidate = dedupeFbaReviewCandidates(
    result.candidate.sellerSkus.map((sellerSku) => ({
      sellerSku,
      asin: result.candidate.asin,
      title: result.candidate.title,
      relationshipRole: result.candidate.relationshipRole,
    })),
  )[0];
  if (!candidate) throw new TypeError("Review audit candidate is empty.");
  if (result.error) {
    return incompleteRow(candidate, {
      code: "CUSTOMER_FEEDBACK_QUERY_FAILED",
      message: result.error.message?.trim() ||
        "Amazon Customer Feedback 主題查詢失敗，未將缺列當成零評論。",
      requestId: result.error.requestId?.trim() || result.requestId?.trim() || null,
    });
  }
  if (result.noContent === true) {
    return {
      sellerSkus: [...candidate.sellerSkus],
      asin: candidate.asin,
      title: candidate.title,
      relationshipRole: candidate.relationshipRole,
      status: "NO_TOPICS",
      nonParentAsinEvidence:
        "LISTINGS_RELATIONSHIPS_NON_PARENT_PLUS_CUSTOMER_FEEDBACK_ASIN",
      dateRange: null,
      positiveTopics: [],
      negativeTopics: [],
      incompleteReason: null,
      averageProductRating: null,
      totalReviewCount: null,
      fullReviewTextAvailable: false,
    };
  }
  if (result.response === null) {
    return incompleteRow(candidate, {
      code: "CUSTOMER_FEEDBACK_NOT_RETURNED",
      message: "Amazon 未回傳可驗證的評論主題回應，不推定為零評論。",
      requestId: result.requestId?.trim() || null,
    });
  }
  try {
    const raw = record(result.response, "Customer Feedback response");
    const asin = requiredText(raw.asin, "response.asin", 10);
    if (asin !== candidate.asin) {
      return incompleteRow(candidate, {
        code: "CUSTOMER_FEEDBACK_ASIN_MISMATCH",
        message: "Amazon Customer Feedback 回應的 ASIN 與要求不一致，已停止合併。",
        requestId: result.requestId?.trim() || null,
      });
    }
    const responseMarketplaceId = requiredText(raw.marketplaceId, "response.marketplaceId", 32);
    if (responseMarketplaceId !== marketplaceId) {
      return incompleteRow(candidate, {
        code: "CUSTOMER_FEEDBACK_MARKETPLACE_MISMATCH",
        message: "Amazon Customer Feedback 回應的站點與要求不一致，已停止合併。",
        requestId: result.requestId?.trim() || null,
      });
    }
    const rawRange = record(raw.dateRange, "response.dateRange");
    const dateRange = {
      startDate: canonicalTimestamp(rawRange.startDate, "response.dateRange.startDate"),
      endDate: canonicalTimestamp(rawRange.endDate, "response.dateRange.endDate"),
    };
    if (new Date(dateRange.startDate).getTime() > new Date(dateRange.endDate).getTime()) {
      throw new TypeError("response.dateRange is reversed.");
    }
    const rawTopics = record(raw.topics, "response.topics");
    const positiveTopics = parseTopics(rawTopics.positiveTopics ?? [], "positiveTopics")
      .sort((left, right) =>
        right.starRatingImpact - left.starRatingImpact ||
        right.numberOfMentions - left.numberOfMentions ||
        left.topic.localeCompare(right.topic, "en"),
      );
    const negativeTopics = parseTopics(rawTopics.negativeTopics ?? [], "negativeTopics")
      .sort((left, right) =>
        left.starRatingImpact - right.starRatingImpact ||
        right.numberOfMentions - left.numberOfMentions ||
        left.topic.localeCompare(right.topic, "en"),
      );
    return {
      sellerSkus: [...candidate.sellerSkus],
      asin: candidate.asin,
      title: candidate.title,
      relationshipRole: candidate.relationshipRole,
      status: positiveTopics.length || negativeTopics.length ? "COMPLETE" : "NO_TOPICS",
      nonParentAsinEvidence:
        "LISTINGS_RELATIONSHIPS_NON_PARENT_PLUS_CUSTOMER_FEEDBACK_ASIN",
      dateRange,
      positiveTopics,
      negativeTopics,
      incompleteReason: null,
      averageProductRating: null,
      totalReviewCount: null,
      fullReviewTextAvailable: false,
    };
  } catch (error) {
    return incompleteRow(candidate, {
      code: "CUSTOMER_FEEDBACK_RESPONSE_INVALID",
      message: error instanceof Error
        ? `Amazon Customer Feedback 回應無法驗證：${error.message}`
        : "Amazon Customer Feedback 回應無法驗證。",
      requestId: result.requestId?.trim() || null,
    });
  }
}

function ranked(
  row: ReviewAuditRow,
  topic: ReviewTopicEvidence,
): ReviewAuditRankedItem {
  return {
    sellerSkus: [...row.sellerSkus],
    asin: row.asin,
    title: row.title,
    topic: topic.topic,
    numberOfMentions: topic.numberOfMentions,
    occurrencePercentage: topic.occurrencePercentage,
    starRatingImpact: topic.starRatingImpact,
    metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT",
  };
}

export function buildReviewAuditSnapshot(input: {
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt?: string | Date;
  results: readonly ReviewAuditFetchResult[];
  relationshipIncompleteRows?: readonly ReviewAuditRelationshipIncompleteRow[];
  candidateCoverage?: ReviewAuditCandidateCoverage;
  /** @deprecated Pass candidateCoverage instead. */
  sourceCandidateCount?: number;
}): ReviewAuditSnapshot {
  if (!customerFeedbackMarketplaceSupported(input.marketplaceId)) {
    throw new TypeError("Customer Feedback API is unavailable for this configured marketplace.");
  }
  const marketplaceId = input.marketplaceId;
  const fetchedAt = input.fetchedAt instanceof Date
    ? input.fetchedAt.toISOString()
    : input.fetchedAt ?? new Date().toISOString();
  if (Number.isNaN(new Date(fetchedAt).getTime())) {
    throw new TypeError("fetchedAt is invalid.");
  }
  const seen = new Set<string>();
  const rows = input.results.map((result) => {
    if (seen.has(result.candidate.asin)) {
      throw new TypeError("Review audit contains a duplicate ASIN fetch result.");
    }
    seen.add(result.candidate.asin);
    return normalizeReviewAuditResult(result, marketplaceId);
  }).sort((left, right) => left.asin.localeCompare(right.asin, "en"));
  const topFivePositive = rows
    .flatMap((row) => row.positiveTopics[0] ? [ranked(row, row.positiveTopics[0])] : [])
    .sort((left, right) =>
      right.starRatingImpact - left.starRatingImpact ||
      right.numberOfMentions - left.numberOfMentions ||
      left.asin.localeCompare(right.asin, "en"),
    )
    .slice(0, 5);
  const bottomFiveNegative = rows
    .flatMap((row) => row.negativeTopics[0] ? [ranked(row, row.negativeTopics[0])] : [])
    .sort((left, right) =>
      left.starRatingImpact - right.starRatingImpact ||
      right.numberOfMentions - left.numberOfMentions ||
      left.asin.localeCompare(right.asin, "en"),
    )
    .slice(0, 5);
  const verifiedListings = rows.reduce(
    (count, row) => count + row.sellerSkus.length,
    0,
  );
  const verifiedChildListings = rows
    .filter(({ relationshipRole }) => relationshipRole === "child")
    .reduce((count, row) => count + row.sellerSkus.length, 0);
  const verifiedStandaloneListings = verifiedListings - verifiedChildListings;
  const relationshipIncompleteRows = (input.relationshipIncompleteRows ?? [])
    .map((row, index) => {
      const sellerSku = requiredText(
        row.sellerSku,
        `relationshipIncompleteRows[${index}].sellerSku`,
        MAX_SKU,
      );
      const asin = typeof row.asin === "string" &&
          row.asin === row.asin.trim() && row.asin.length <= 40 &&
          !/[\u0000-\u001f\u007f]/u.test(row.asin)
        ? row.asin
        : (() => {
            throw new TypeError(
              `relationshipIncompleteRows[${index}].asin is invalid.`,
            );
          })();
      return {
        sellerSku,
        asin,
        title: requiredText(
          row.title,
          `relationshipIncompleteRows[${index}].title`,
        ),
        code: row.code,
        message: requiredText(
          row.message,
          `relationshipIncompleteRows[${index}].message`,
        ),
        requestId: row.requestId === null
          ? null
          : requiredText(
              row.requestId,
              `relationshipIncompleteRows[${index}].requestId`,
              200,
            ),
      };
    })
    .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku, "en"));
  const incompleteSkus = new Set(
    relationshipIncompleteRows.map(({ sellerSku }) => sellerSku),
  );
  if (
    incompleteSkus.size !== relationshipIncompleteRows.length ||
    rows.some((row) =>
      row.sellerSkus.some((sellerSku) => incompleteSkus.has(sellerSku)))
  ) {
    throw new TypeError(
      "Review audit relationship coverage overlaps or duplicates Seller SKUs.",
    );
  }
  const defaultCoverage: ReviewAuditCandidateCoverage = {
    sourceFbaListings: verifiedListings + relationshipIncompleteRows.length,
    verifiedNonParentListings: verifiedListings,
    verifiedChildListings,
    verifiedStandaloneListings,
    excludedParentContainers: 0,
    relationshipIncomplete: relationshipIncompleteRows.length,
  };
  const coverage = input.candidateCoverage ?? defaultCoverage;
  if (
    Object.values(coverage).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    coverage.verifiedNonParentListings !==
      coverage.verifiedChildListings + coverage.verifiedStandaloneListings ||
    coverage.sourceFbaListings !==
      coverage.verifiedNonParentListings +
        coverage.excludedParentContainers +
        coverage.relationshipIncomplete ||
    coverage.verifiedNonParentListings !== verifiedListings ||
    coverage.verifiedChildListings !== verifiedChildListings ||
    coverage.verifiedStandaloneListings !== verifiedStandaloneListings ||
    coverage.relationshipIncomplete !== relationshipIncompleteRows.length ||
    (input.sourceCandidateCount !== undefined &&
      input.sourceCandidateCount !== coverage.sourceFbaListings)
  ) {
    throw new TypeError("Review audit candidate coverage is inconsistent.");
  }
  const feedbackIncomplete = rows.filter(
    ({ status }) => status === "INCOMPLETE",
  ).length;
  const totalIncomplete = feedbackIncomplete + coverage.relationshipIncomplete;
  return {
    schemaVersion: 2,
    mode: input.mode,
    marketplaceId,
    fetchedAt: new Date(fetchedAt).toISOString(),
    rows,
    relationshipIncompleteRows,
    topFivePositive,
    bottomFiveNegative,
    summary: {
      sourceFbaListings: coverage.sourceFbaListings,
      verifiedNonParentListings: coverage.verifiedNonParentListings,
      uniqueFbaNonParentAsins: rows.length,
      verifiedChildListings: coverage.verifiedChildListings,
      verifiedStandaloneListings: coverage.verifiedStandaloneListings,
      excludedParentContainers: coverage.excludedParentContainers,
      relationshipIncomplete: coverage.relationshipIncomplete,
      completed: rows.filter(({ status }) => status === "COMPLETE").length,
      noTopics: rows.filter(({ status }) => status === "NO_TOPICS").length,
      feedbackIncomplete,
      totalIncomplete,
      incomplete: totalIncomplete,
      duplicateSkuAsinsCollapsed: coverage.verifiedNonParentListings - rows.length,
    },
    availability: {
      source: "CUSTOMER_FEEDBACK_API_2024_06_01",
      supported: true,
      nonParentFbaAsinsOnly: true,
      relationshipsEvidenceRequired: true,
      parentContainersExcluded: true,
      fullReviewTextAvailable: false,
      averageProductRatingAvailable: false,
      totalReviewCountAvailable: false,
      officialSource: CUSTOMER_FEEDBACK_SOURCE,
    },
    notice: "排序只使用經 Listings relationships 證明為 child 或 standalone 的非 parent FBA ASIN 主題星等影響，不是商品總星等或評論數排名。Amazon 公開 Customer Feedback API 資料每週更新且主題僅提供英文；不提供完整 review 全文、商品平均星等或總評論數。Parent 容器會明確排除，關係證據不完整的 SKU 會單獨列為未完成，不會查詢評論主題。",
  };
}

export const REVIEW_AUDIT_CAPABILITY = Object.freeze({
  api: "Customer Feedback API v2024-06-01",
  operation: "getItemReviewTopics",
  endpointKind: "PUBLIC_SP_API",
  roles: ["Selling Partner Insights", "Brand Analytics"],
  roleRequirement: "Seller app requires at least one of the documented roles.",
  sortBy: "STAR_RATING_IMPACT",
  rateLimit: { requestsPerSecond: 1, burst: 10 },
  supportedConfiguredMarketplaces: CUSTOMER_FEEDBACK_SUPPORTED_CONFIGURED_MARKETPLACES,
  nonParentFbaAsinsOnly: true,
  relationshipsEvidenceRequired: true,
  parentContainersExcluded: true,
  fullReviewTextAvailable: false,
  averageProductRatingAvailable: false,
  totalReviewCountAvailable: false,
  parentMetricsUsed: false,
  updateCadence: "WEEKLY",
  topicLanguage: "ENGLISH_ONLY",
  http204Meaning: "SUCCESS_NO_TOPIC_DATA",
  officialSource: CUSTOMER_FEEDBACK_SOURCE,
});
