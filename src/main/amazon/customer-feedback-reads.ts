import { throwIfAborted } from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  DedupedFbaReviewCandidate,
  ReviewAuditFeedbackEvidence,
  ReviewAuditFetchResult,
  ReviewTopicEvidence,
} from "./review-audit";
import {
  CUSTOMER_FEEDBACK_SUPPORTED_CONFIGURED_MARKETPLACES as REPORT_LIBRARY_CUSTOMER_FEEDBACK_MARKETPLACES,
  type ReportLibraryMarketplaceId,
} from "./report-library";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
  type SpExecutionMode,
} from "./sp-execution-context";
import {
  publicSpApiError,
  SpApiError,
} from "./sp-api-error";

export type CustomerFeedbackPagePlan = Readonly<{
  marketplaceId: MarketplaceId;
  asin: string;
  expectedMode: SpExecutionMode;
  signal?: AbortSignal;
}>;

export type CustomerFeedbackPageResult = Readonly<{
  status: number;
  payload: unknown | null;
  requestId: string | null;
  retryAfter: string | null;
}>;

/** Fixed getItemReviewTopics boundary; callers cannot supply transport data. */
export interface CustomerFeedbackPageAdapter {
  read(plan: CustomerFeedbackPagePlan): Promise<CustomerFeedbackPageResult>;
}

export type CustomerFeedbackReadInput = Readonly<{
  marketplaceId: MarketplaceId;
  candidate: DedupedFbaReviewCandidate;
  expectedContext?: SpExecutionContext;
  signal?: AbortSignal;
}>;

export interface CustomerFeedbackReadsPort {
  read(input: CustomerFeedbackReadInput): Promise<ReviewAuditFetchResult>;
}

export const CUSTOMER_FEEDBACK_SUPPORTED_CONFIGURED_MARKETPLACES =
  REPORT_LIBRARY_CUSTOMER_FEEDBACK_MARKETPLACES;

export function customerFeedbackMarketplaceSupported(
  marketplaceId: string,
): marketplaceId is ReportLibraryMarketplaceId {
  return (CUSTOMER_FEEDBACK_SUPPORTED_CONFIGURED_MARKETPLACES as readonly string[])
    .includes(marketplaceId);
}

export function createDeterministicCustomerFeedbackDemoAdapter():
  CustomerFeedbackPageAdapter {
  return {
    async read(plan) {
      throwIfAborted(plan.signal);
      if (plan.expectedMode !== "demo") {
        throw new Error(
          "Customer Feedback demo adapter 不接受真實 Amazon request。",
        );
      }
      const parsedOrdinal = Number(plan.asin.at(-1));
      const ordinal = Number.isFinite(parsedOrdinal) ? parsedOrdinal : 1;
      if (ordinal === 6) {
        return {
          status: 204,
          payload: null,
          requestId: null,
          retryAfter: null,
        };
      }
      return {
        status: 200,
        requestId: null,
        retryAfter: null,
        payload: {
          asin: plan.asin,
          marketplaceId: plan.marketplaceId,
          dateRange: {
            startDate: "2026-02-01T00:00:00.000Z",
            endDate: "2026-08-01T00:00:00.000Z",
          },
          topics: {
            positiveTopics: [{
              topic: ordinal % 2 === 0 ? "Taste" : "Quality",
              asinMetrics: {
                numberOfMentions: 8 + ordinal,
                occurrencePercentage: 12 + ordinal,
                starRatingImpact: 3 + ordinal / 10,
              },
              reviewSnippets: ["Demo positive topic evidence"],
            }],
            negativeTopics: [{
              topic: ordinal % 2 === 0 ? "Smell" : "Size",
              asinMetrics: {
                numberOfMentions: 2 + ordinal,
                occurrencePercentage: 3 + ordinal,
                starRatingImpact: -(0.5 + ordinal / 10),
              },
              reviewSnippets: ["Demo negative topic evidence"],
            }],
          },
        },
      };
    },
  };
}

function invalidCandidate(): never {
  throw new SpApiError(
    "評論健檢缺少可驗證的非 parent FBA ASIN 身分。",
    {
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
      operation: "getItemReviewTopics",
    },
  );
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
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

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function topics(value: unknown, label: string): ReviewTopicEvidence[] {
  if (!Array.isArray(value) || value.length > 10) {
    throw new TypeError(`${label} is invalid.`);
  }
  const parsed = value.map((item, index) => {
    const raw = record(item, `${label}[${index}]`);
    const metrics = record(raw.asinMetrics, `${label}[${index}].asinMetrics`);
    const occurrencePercentage = finiteNumber(
      metrics.occurrencePercentage,
      `${label}[${index}].occurrencePercentage`,
    );
    if (occurrencePercentage < 0 || occurrencePercentage > 100) {
      throw new TypeError(`${label}[${index}].occurrencePercentage is invalid.`);
    }
    const snippets = raw.reviewSnippets ?? [];
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
        requiredText(
          snippet,
          `${label}[${index}].reviewSnippets[${snippetIndex}]`,
          1_000,
        )
      ),
    };
  });
  if (new Set(parsed.map(({ topic }) => topic)).size !== parsed.length) {
    throw new TypeError(`${label} contains duplicate topics.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  if (Number.isNaN(new Date(text).getTime())) {
    throw new TypeError(`${label} is invalid.`);
  }
  return text;
}

function evidence(
  payload: unknown,
  marketplaceId: MarketplaceId,
  asin: string,
): ReviewAuditFeedbackEvidence {
  const raw = record(payload, "Customer Feedback response");
  if (requiredText(raw.asin, "response.asin", 10) !== asin) {
    throw new SpApiError(
      "Amazon Customer Feedback 回應的 ASIN 與要求不一致，已停止合併。",
      {
        status: 502,
        code: "CUSTOMER_FEEDBACK_ASIN_MISMATCH",
        operation: "getItemReviewTopics",
      },
    );
  }
  if (
    requiredText(raw.marketplaceId, "response.marketplaceId", 32) !==
      marketplaceId
  ) {
    throw new SpApiError(
      "Amazon Customer Feedback 回應的站點與要求不一致，已停止合併。",
      {
        status: 502,
        code: "CUSTOMER_FEEDBACK_MARKETPLACE_MISMATCH",
        operation: "getItemReviewTopics",
      },
    );
  }
  const range = record(raw.dateRange, "response.dateRange");
  const dateRange = {
    startDate: timestamp(range.startDate, "response.dateRange.startDate"),
    endDate: timestamp(range.endDate, "response.dateRange.endDate"),
  };
  if (new Date(dateRange.startDate).getTime() > new Date(dateRange.endDate).getTime()) {
    throw new TypeError("response.dateRange is reversed.");
  }
  const rawTopics = record(raw.topics, "response.topics");
  return {
    dateRange,
    positiveTopics: topics(rawTopics.positiveTopics ?? [], "positiveTopics")
      .sort((left, right) =>
        right.starRatingImpact - left.starRatingImpact ||
        right.numberOfMentions - left.numberOfMentions ||
        left.topic.localeCompare(right.topic, "en")
      ),
    negativeTopics: topics(rawTopics.negativeTopics ?? [], "negativeTopics")
      .sort((left, right) =>
        left.starRatingImpact - right.starRatingImpact ||
        right.numberOfMentions - left.numberOfMentions ||
        left.topic.localeCompare(right.topic, "en")
      ),
  };
}

function publicPageMetadata(result: CustomerFeedbackPageResult): Readonly<{
  requestId: string | null;
  retryAfter: string | null;
}> {
  const descriptor = publicSpApiError(
    new SpApiError("Amazon Customer Feedback API 回應 metadata。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      operation: "getItemReviewTopics",
      requestId: result.requestId,
      retryAfter: result.retryAfter,
    }),
    "Amazon Customer Feedback API 回應 metadata。",
  );
  return {
    requestId: descriptor.requestId,
    retryAfter: descriptor.retryAfter,
  };
}

function assertCandidate(
  marketplaceId: MarketplaceId,
  candidate: DedupedFbaReviewCandidate,
): void {
  if (!customerFeedbackMarketplaceSupported(marketplaceId)) {
    throw new SpApiError(
      "Amazon Customer Feedback API 尚不支援此站點。",
      {
        status: 422,
        code: "MARKETPLACE_UNSUPPORTED",
        operation: "getItemReviewTopics",
      },
    );
  }
  const sellerSkus = candidate.sellerSkus as unknown;
  if (
    typeof candidate.asin !== "string" ||
    !/^[A-Z0-9]{10}$/u.test(candidate.asin) ||
    typeof candidate.title !== "string" ||
    !candidate.title ||
    candidate.title !== candidate.title.trim() ||
    candidate.title.length > 5_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate.title) ||
    (candidate.relationshipRole !== "child" &&
      candidate.relationshipRole !== "standalone") ||
    candidate.evidence !==
      "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN" ||
    !Array.isArray(sellerSkus) ||
    sellerSkus.length === 0 ||
    sellerSkus.some((sellerSku) =>
      typeof sellerSku !== "string" ||
      !sellerSku ||
      sellerSku !== sellerSku.trim() ||
      sellerSku.length > 40 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(sellerSku)
    ) ||
    new Set(sellerSkus).size !== sellerSkus.length
  ) {
    invalidCandidate();
  }
}

/** Semantic owner for one relationships-proven Customer Feedback read. */
export class CustomerFeedbackReads implements CustomerFeedbackReadsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly live: CustomerFeedbackPageAdapter;
  private readonly demo: CustomerFeedbackPageAdapter;

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    live: CustomerFeedbackPageAdapter;
    demo?: CustomerFeedbackPageAdapter;
  }>) {
    this.context = input.context;
    this.live = input.live;
    this.demo = input.demo ??
      createDeterministicCustomerFeedbackDemoAdapter();
  }

  private async executionContext(
    marketplaceId: MarketplaceId,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    if (!expected) return this.context.capture(marketplaceId);
    if (expected.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境與評論健檢站點不一致；請重新開始。",
      );
    }
    await this.context.assertCurrent(expected);
    return expected;
  }

  async read(input: CustomerFeedbackReadInput): Promise<ReviewAuditFetchResult> {
    throwIfAborted(input.signal);
    assertCandidate(input.marketplaceId, input.candidate);
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    await this.context.assertCurrent(context);
    const adapter = context.mode === "demo" ? this.demo : this.live;
    let result: CustomerFeedbackPageResult;
    try {
      result = await adapter.read({
        marketplaceId: input.marketplaceId,
        asin: input.candidate.asin,
        expectedMode: context.mode,
        signal: input.signal,
      });
      await this.context.assertCurrent(context);
      throwIfAborted(input.signal);
    } catch (error) {
      await this.context.assertCurrent(context);
      throwIfAborted(input.signal);
      if (
        error instanceof SpApiError &&
        [
          "ACCOUNT_SCOPE_CHANGED",
          "REPORT_MODE_CHANGED",
          "SP_CONTEXT_INVALIDATED",
        ].includes(error.code)
      ) {
        throw error;
      }
      const descriptor = error instanceof SpApiError
        ? publicSpApiError(
            error,
            "Amazon Customer Feedback API 查詢失敗。",
          )
        : null;
      return {
        candidate: input.candidate,
        requestId: descriptor?.requestId ?? null,
        error: {
          code: descriptor?.code ?? "UPSTREAM_UNAVAILABLE",
          message: descriptor?.message ??
            "Amazon Customer Feedback API 查詢失敗。",
          requestId: descriptor?.requestId ?? null,
          retryAfter: descriptor?.retryAfter ?? null,
        },
      };
    }
    const metadata = publicPageMetadata(result);
    if (result.status === 204) {
      return {
        candidate: input.candidate,
        noContent: true,
        requestId: metadata.requestId,
      };
    }
    if (result.status === 200) {
      try {
        return {
          candidate: input.candidate,
          evidence: evidence(
            result.payload,
            input.marketplaceId,
            input.candidate.asin,
          ),
          requestId: metadata.requestId,
        };
      } catch (error) {
        const code = error instanceof SpApiError
          ? error.code
          : "CUSTOMER_FEEDBACK_RESPONSE_INVALID";
        const message = code === "CUSTOMER_FEEDBACK_ASIN_MISMATCH"
          ? "Amazon Customer Feedback 回應的 ASIN 與要求不一致，已停止合併。"
          : code === "CUSTOMER_FEEDBACK_MARKETPLACE_MISMATCH"
            ? "Amazon Customer Feedback 回應的站點與要求不一致，已停止合併。"
            : "Amazon Customer Feedback API 回應不是可驗證的 JSON。";
        return {
          candidate: input.candidate,
          requestId: metadata.requestId,
          error: {
            code,
            message,
            requestId: metadata.requestId,
          },
        };
      }
    }
    return {
      candidate: input.candidate,
      requestId: metadata.requestId,
      error: {
        code: result.status === 401 || result.status === 403
          ? "UNAUTHORIZED"
          : result.status === 429
            ? "RATE_LIMITED"
            : "QUERY_FAILED",
        message: result.status === 401 || result.status === 403
          ? "Amazon 拒絕評論主題查詢；請確認 App 至少已取得 Selling Partner Insights 或 Brand Analytics 其一角色並重新授權。"
          : result.status === 404
            ? "Amazon 沒有找到此非 parent ASIN 的 Customer Feedback 資源；未改用父變體資料。"
            : result.status === 429
              ? "Amazon Customer Feedback API 正在限流；請稍後繼續這個快照。"
              : "Amazon Customer Feedback API 未完成此非 parent ASIN 查詢。",
        requestId: metadata.requestId,
        retryAfter: metadata.retryAfter,
      },
    };
  }
}
