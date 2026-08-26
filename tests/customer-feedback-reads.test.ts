import { describe, expect, it, vi } from "vitest";
import {
  CustomerFeedbackReads,
  type CustomerFeedbackPageAdapter,
} from "../src/main/amazon/customer-feedback-reads";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type {
  DedupedFbaReviewCandidate,
} from "../src/main/amazon/review-audit";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const US = "ATVPDKIKX0DER" as const;
const JP = "A1VC38T7YXB528" as const;
const CA = "A2EUQ1WTGCTBG2" as const;

function context(mode: "live" | "demo" = "live") {
  return createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: US,
    mode,
    accountScope: "customer-feedback-test-account",
  }));
}

function candidate(
  overrides: Partial<DedupedFbaReviewCandidate> = {},
): DedupedFbaReviewCandidate {
  return {
    sellerSkus: ["SKU-ONE"],
    asin: "B000000001",
    title: "Review audit product",
    relationshipRole: "standalone",
    evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
    ...overrides,
  };
}

describe("CustomerFeedbackReads", () => {
  it("rejects an unsupported configured marketplace before context or I/O", async () => {
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>();
    const reads = new CustomerFeedbackReads({
      context: context(),
      live: { read },
    });

    await expect(reads.read({
      marketplaceId: CA,
      candidate: candidate(),
    })).rejects.toMatchObject({
      code: "MARKETPLACE_UNSUPPORTED",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects unproven or malformed non-parent identity before the adapter", async () => {
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>();
    const reads = new CustomerFeedbackReads({
      context: context(),
      live: { read },
    });

    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate({
        relationshipRole: "parent",
      } as unknown as Partial<DedupedFbaReviewCandidate>),
    })).rejects.toMatchObject({
      code: "LISTING_IDENTITY_MISMATCH",
    });
    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate({ sellerSkus: [""] }),
    })).rejects.toMatchObject({
      code: "LISTING_IDENTITY_MISMATCH",
    });
    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate({
        evidence: "UNPROVEN",
      } as unknown as Partial<DedupedFbaReviewCandidate>),
    })).rejects.toMatchObject({
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("returns only exact-ASIN evidence and preserves signed topic impact", async () => {
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>(async () => ({
      status: 200,
      requestId: "request-evidence",
      retryAfter: null,
      payload: {
        asin: "B000000001",
        marketplaceId: US,
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
              starRatingImpact: 4.2,
            },
            parentAsinMetrics: { starRatingImpact: 99 },
            reviewSnippets: ["Dogs love it"],
          }],
          negativeTopics: [{
            topic: "Smell",
            asinMetrics: {
              numberOfMentions: 3,
              occurrencePercentage: 5,
              starRatingImpact: -2.1,
            },
            parentAsinMetrics: { starRatingImpact: -99 },
            reviewSnippets: ["Strong smell"],
          }],
        },
      },
    }));
    const reads = new CustomerFeedbackReads({
      context: context(),
      live: { read },
    });

    const result = await reads.read({
      marketplaceId: US,
      candidate: candidate(),
    });

    expect(result).toMatchObject({
      requestId: "request-evidence",
      evidence: {
        positiveTopics: [{ starRatingImpact: 4.2 }],
        negativeTopics: [{ starRatingImpact: -2.1 }],
      },
    });
    expect(result).not.toHaveProperty("response");
    expect(JSON.stringify(result)).not.toContain("99");
  });

  it("isolates identity mismatch as sanitized incomplete evidence", async () => {
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>(async () => ({
      status: 200,
      requestId: "seller_id=A123456789012",
      retryAfter: "7",
      payload: {
        asin: "B000000099",
        marketplaceId: US,
        dateRange: {
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: "2026-07-01T00:00:00.000Z",
        },
        topics: { positiveTopics: [], negativeTopics: [] },
      },
    }));
    const reads = new CustomerFeedbackReads({
      context: context(),
      live: { read },
    });

    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate(),
    })).resolves.toEqual({
      candidate: candidate(),
      requestId: null,
      error: {
        code: "CUSTOMER_FEEDBACK_ASIN_MISMATCH",
        message: "Amazon Customer Feedback 回應的 ASIN 與要求不一致，已停止合併。",
        requestId: null,
      },
    });
  });

  it("isolates marketplace mismatch and malformed signed-impact evidence", async () => {
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>()
      .mockResolvedValueOnce({
        status: 200,
        requestId: "request-marketplace",
        retryAfter: null,
        payload: {
          asin: "B000000001",
          marketplaceId: JP,
          dateRange: {
            startDate: "2026-01-01T00:00:00.000Z",
            endDate: "2026-07-01T00:00:00.000Z",
          },
          topics: { positiveTopics: [], negativeTopics: [] },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        requestId: "request-impact",
        retryAfter: null,
        payload: {
          asin: "B000000001",
          marketplaceId: US,
          dateRange: {
            startDate: "2026-01-01T00:00:00.000Z",
            endDate: "2026-07-01T00:00:00.000Z",
          },
          topics: {
            positiveTopics: [{
              topic: "Taste",
              asinMetrics: {
                numberOfMentions: 2,
                occurrencePercentage: 5,
              },
            }],
            negativeTopics: [],
          },
        },
      });
    const reads = new CustomerFeedbackReads({
      context: context(),
      live: { read },
    });

    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate(),
    })).resolves.toMatchObject({
      error: { code: "CUSTOMER_FEEDBACK_MARKETPLACE_MISMATCH" },
    });
    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate(),
    })).resolves.toMatchObject({
      error: { code: "CUSTOMER_FEEDBACK_RESPONSE_INVALID" },
    });
  });

  it("maps 204 and 403 without inventing evidence or replaying", async () => {
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>()
      .mockResolvedValueOnce({
        status: 204,
        requestId: "request-204",
        retryAfter: null,
        payload: null,
      })
      .mockResolvedValueOnce({
        status: 403,
        requestId: "request-403",
        retryAfter: null,
        payload: null,
      });
    const reads = new CustomerFeedbackReads({
      context: context(),
      live: { read },
    });

    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate(),
    })).resolves.toEqual({
      candidate: candidate(),
      noContent: true,
      requestId: "request-204",
    });
    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate(),
    })).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED", requestId: "request-403" },
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rejects an expected-context mismatch and in-flight invalidation", async () => {
    const execution = context();
    const expectedContext = await execution.capture(US);
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>(async () => {
      execution.invalidate("account-changed");
      return {
        status: 204,
        requestId: null,
        retryAfter: null,
        payload: null,
      };
    });
    const reads = new CustomerFeedbackReads({
      context: execution,
      live: { read },
    });

    await expect(reads.read({
      marketplaceId: JP,
      candidate: candidate(),
      expectedContext,
    })).rejects.toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(read).not.toHaveBeenCalled();

    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate(),
      expectedContext,
    })).rejects.toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("preserves only sanitized Retry-After on a non-replayed rate limit", async () => {
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>(async () => ({
      status: 429,
      requestId: "request-rate-limit",
      retryAfter: "4",
      payload: null,
    }));
    const reads = new CustomerFeedbackReads({
      context: context(),
      live: { read },
    });

    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate(),
    })).resolves.toMatchObject({
      error: {
        code: "RATE_LIMITED",
        requestId: "request-rate-limit",
        retryAfter: "4",
      },
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("converts transport failures to a sanitized domain result", async () => {
    const read = vi.fn<CustomerFeedbackPageAdapter["read"]>(async () => {
      throw new SpApiError(
        "refresh_token=private-value https://private.example/path",
        {
          status: 502,
          code: "UPSTREAM_UNAVAILABLE",
          requestId: "seller_id=A123456789012",
          retryAfter: "5",
          operation: "getItemReviewTopics",
        },
      );
    });
    const reads = new CustomerFeedbackReads({
      context: context(),
      live: { read },
    });

    const result = await reads.read({
      marketplaceId: US,
      candidate: candidate(),
    });

    expect(result).toMatchObject({
      requestId: null,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Amazon Customer Feedback API 查詢失敗。",
        requestId: null,
        retryAfter: "5",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|refresh_token|A123/u);
  });

  it("uses deterministic demo evidence without touching the live adapter", async () => {
    const liveRead = vi.fn<CustomerFeedbackPageAdapter["read"]>();
    const reads = new CustomerFeedbackReads({
      context: context("demo"),
      live: { read: liveRead },
    });

    await expect(reads.read({
      marketplaceId: US,
      candidate: candidate(),
    })).resolves.toMatchObject({
      evidence: {
        positiveTopics: [{ starRatingImpact: 3.1 }],
        negativeTopics: [{ starRatingImpact: -0.6 }],
      },
    });
    expect(liveRead).not.toHaveBeenCalled();
  });
});
