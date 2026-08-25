import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReviewAuditCoordinator,
  type ReviewAuditCatalogSeedReader,
  type ReviewAuditListingsPort,
} from "../src/main/review-audit-coordinator";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextAfterAdapterError,
  SpExecutionContextError,
} from "../src/main/amazon/sp-execution-context";
import type {
  CustomerFeedbackReadInput,
} from "../src/main/amazon/customer-feedback-reads";
import type {
  DedupedFbaReviewCandidate,
  ReviewAuditFetchResult,
} from "../src/main/amazon/review-audit";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { ReviewAuditCandidateSnapshot } from
  "../src/main/amazon/variation-catalog-reads";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const TERMINAL_TTL_MS = 30 * 60 * 1_000;

afterEach(() => {
  vi.useRealTimers();
});

function request(
  method: "GET" | "POST",
  path: string,
  input: Record<string, string>,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path,
    query: method === "GET" ? input : {},
    headers: {},
    ...(method === "POST"
      ? { body: { kind: "json" as const, value: input } }
      : {}),
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON response.");
  return response.body.value as Record<string, unknown>;
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function reviewCandidate(
  ordinal = 1,
  relationshipRole: "child" | "standalone" = "child",
): DedupedFbaReviewCandidate {
  return {
    sellerSkus: [`SKU-${ordinal}`],
    asin: `B${String(ordinal).padStart(9, "0")}`,
    title: `Verified ${relationshipRole} ${ordinal}`,
    relationshipRole,
    evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
  };
}

function completeCandidateSnapshot(
  candidates: readonly DedupedFbaReviewCandidate[],
  mode: "live" | "demo" = "live",
): ReviewAuditCandidateSnapshot {
  const childCount = candidates.filter(
    ({ relationshipRole }) => relationshipRole === "child",
  ).length;
  return {
    mode,
    marketplaceId: US,
    sourceCandidateCount: candidates.length,
    candidates: structuredClone([...candidates]),
    relationshipIncompleteRows: [],
    coverage: {
      sourceFbaListings: candidates.length,
      verifiedNonParentListings: candidates.length,
      verifiedChildListings: childCount,
      verifiedStandaloneListings: candidates.length - childCount,
      excludedParentContainers: 0,
      relationshipIncomplete: 0,
    },
    notice: "Verified non-parent coverage.",
  };
}

function readyListings() {
  return {
    start: vi.fn(async (
      _input: Parameters<ReviewAuditListingsPort["start"]>[0],
    ) => ({
      mode: "live" as const,
      ready: true,
      reportId: "report-handle",
      documentId: "document-handle",
      status: "DONE" as const,
      notice: "ready",
    })),
    status: vi.fn(async (
      _input: Parameters<ReviewAuditListingsPort["status"]>[0],
    ) => {
      throw new Error("Ready report must not be polled.");
    }),
  };
}

function liveContext() {
  return createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: US,
    mode: "live",
    accountScope: "opaque-review-account",
  }));
}

function candidateSnapshot(): ReviewAuditCandidateSnapshot {
  return {
    mode: "live",
    marketplaceId: US,
    sourceCandidateCount: 3,
    candidates: [{
      sellerSkus: ["CHILD-SKU"],
      asin: "B000000001",
      title: "Verified child",
      relationshipRole: "child",
      evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN",
    }],
    relationshipIncompleteRows: [{
      sellerSku: "UNKNOWN-SKU",
      asin: "B000000003",
      title: "Unknown relationship",
      code: "RELATIONSHIPS_NOT_RETURNED",
      message: "Amazon did not return relationships.",
      requestId: null,
    }],
    coverage: {
      sourceFbaListings: 3,
      verifiedNonParentListings: 1,
      verifiedChildListings: 1,
      verifiedStandaloneListings: 0,
      excludedParentContainers: 1,
      relationshipIncomplete: 1,
    },
    notice: "Verified non-parent coverage.",
  };
}

describe("ReviewAuditCoordinator", () => {
  it("owns the context-bound Review workflow and terminal workbook", async () => {
    const context = liveContext();
    const { start, status } = readyListings();
    const readCatalogSeeds = vi.fn(async (
      _input: Parameters<ReviewAuditCatalogSeedReader>[0],
    ) => [
      { sellerSku: "CHILD-SKU", asin: "B000000001", title: "Verified child" },
      { sellerSku: "PARENT-SKU", asin: "B000000002", title: "Parent" },
      { sellerSku: "UNKNOWN-SKU", asin: "B000000003", title: "Unknown" },
    ]);
    const readCandidates = vi.fn(async () => candidateSnapshot());
    const readFeedback = vi.fn(async (
      { candidate }: CustomerFeedbackReadInput,
    ): Promise<ReviewAuditFetchResult> => ({ candidate, noContent: true }));
    const coordinator = new ReviewAuditCoordinator({
      context,
      resolveMode: () => "live",
      listings: { start, status },
      readCatalogSeeds,
      readCandidates,
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
      now: () => Date.parse("2030-01-02T03:04:05.000Z"),
    });

    const started = await coordinator.start(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    expect(started.status).toBe(202);
    expect(jsonValue(started)).toMatchObject({
      jobId: JOB_ID,
      marketplaceId: US,
      mode: "live",
      ready: false,
    });

    const completed = await coordinator.observe(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId: JOB_ID },
    ));
    expect(completed.status).toBe(200);
    expect(jsonValue(completed)).toMatchObject({
      exportId: JOB_ID,
      summary: {
        sourceFbaListings: 3,
        uniqueFbaNonParentAsins: 1,
        excludedParentContainers: 1,
        relationshipIncomplete: 1,
        noTopics: 1,
        totalIncomplete: 1,
      },
    });

    const capturedContext = start.mock.calls[0]![0].expectedContext;
    expect(capturedContext).toBeDefined();
    expect(readCatalogSeeds).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      reportId: "report-handle",
      documentId: "document-handle",
      expectedContext: capturedContext,
      signal: expect.any(AbortSignal),
    }));
    expect(readFeedback).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      expectedContext: capturedContext,
      signal: expect.any(AbortSignal),
    }));
    expect(status).not.toHaveBeenCalled();

    const workbook = await coordinator.download(request(
      "GET",
      "/api/sp-api/review-audit/export",
      { marketplaceId: US, exportId: JOB_ID },
    ));
    expect(workbook.status).toBe(200);
    expect(workbook.headers).toMatchObject({
      "cache-control": "private, no-store, max-age=0",
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":
        'attachment; filename="amazon-fba-review-topic-audit-us-2030-01-02.xlsx"',
      "x-exported-fba-non-parent-asin-count": "1",
      "x-review-topic-incomplete-count": "1",
    });
    expect(workbook.body.kind).toBe("bytes");
    coordinator.clear();
  });

  it("uses one exact context across a pending Listings report and all semantic reads", async () => {
    vi.useFakeTimers();
    const context = liveContext();
    const start = vi.fn(async (
      _input: Parameters<ReviewAuditListingsPort["start"]>[0],
    ) => ({
      mode: "live" as const,
      ready: false,
      reportId: "pending-report",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "pending",
    }));
    const status = vi
      .fn<ReviewAuditListingsPort["status"]>()
      .mockResolvedValueOnce({
        mode: "live" as const,
        ready: false,
        reportId: "pending-report",
        documentId: null,
        status: "IN_PROGRESS" as const,
        notice: "pending",
      })
      .mockResolvedValueOnce({
        mode: "live" as const,
        ready: true,
        reportId: "pending-report",
        documentId: "pending-document",
        status: "DONE" as const,
        notice: "ready",
      });
    const candidate = reviewCandidate();
    const readCatalogSeeds = vi.fn(async (
      _input: Parameters<ReviewAuditCatalogSeedReader>[0],
    ) => [{
      sellerSku: candidate.sellerSkus[0]!,
      asin: candidate.asin,
      title: candidate.title,
    }]);
    const readCandidates = vi.fn(async () =>
      completeCandidateSnapshot([candidate]));
    const readFeedback = vi.fn(async (
      input: CustomerFeedbackReadInput,
    ): Promise<ReviewAuditFetchResult> => ({
      candidate: input.candidate,
      noContent: true,
    }));
    const coordinator = new ReviewAuditCoordinator({
      context,
      resolveMode: () => "live",
      listings: { start, status },
      readCatalogSeeds,
      readCandidates,
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const pending = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(pending.status).toBe(202);
    const completed = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(completed.status).toBe(200);

    const expectedContext = start.mock.calls[0]![0].expectedContext;
    expect(status).toHaveBeenCalledTimes(2);
    expect(status.mock.calls[0]![0]).toMatchObject({
      reportId: "pending-report",
      expectedContext,
    });
    expect(status.mock.calls[1]![0].expectedContext).toBe(expectedContext);
    expect(readCatalogSeeds.mock.calls[0]![0].expectedContext)
      .toBe(expectedContext);
    expect(readFeedback.mock.calls[0]![0].expectedContext)
      .toBe(expectedContext);
    expect(start).toHaveBeenCalledTimes(1);
    coordinator.clear();
  });

  it("rejects incoherent Listings readiness tuples before reading a document", async () => {
    vi.useFakeTimers();
    const start = vi
      .fn<ReviewAuditListingsPort["start"]>()
      .mockResolvedValueOnce({
        mode: "live",
        ready: false,
        reportId: "incoherent-start",
        documentId: "must-not-be-read",
        status: "DONE",
        notice: "incoherent",
      })
      .mockResolvedValueOnce({
        mode: "live",
        ready: false,
        reportId: "pending-report",
        documentId: null,
        status: "IN_QUEUE",
        notice: "pending",
      });
    const status = vi.fn<ReviewAuditListingsPort["status"]>()
      .mockResolvedValue({
        mode: "live",
        ready: true,
        reportId: "pending-report",
        documentId: "premature-document",
        status: "IN_PROGRESS",
        notice: "incoherent",
      });
    const readCatalogSeeds = vi.fn<ReviewAuditCatalogSeedReader>();
    const readCandidates = vi.fn(async () =>
      completeCandidateSnapshot([reviewCandidate()]));
    const readFeedback = vi.fn(async (
      input: CustomerFeedbackReadInput,
    ): Promise<ReviewAuditFetchResult> => ({
      candidate: input.candidate,
      noContent: true,
    }));
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings: { start, status },
      readCatalogSeeds,
      readCandidates,
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    const incoherentStart = await coordinator.start(request(
      "POST",
      "/review",
      { marketplaceId: US },
    ));
    expect(incoherentStart.status).toBe(409);
    expect(jsonValue(incoherentStart).code).toBe("REPORT_MISMATCH");

    expect((await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }))).status).toBe(202);
    const incoherentStatus = await coordinator.observe(request(
      "GET",
      "/review",
      { marketplaceId: US, jobId: JOB_ID },
    ));
    expect(incoherentStatus.status).toBe(409);
    expect(jsonValue(incoherentStatus).code).toBe("REPORT_MISMATCH");
    expect(readCatalogSeeds).not.toHaveBeenCalled();
    expect(readCandidates).not.toHaveBeenCalled();
    expect(readFeedback).not.toHaveBeenCalled();
    coordinator.clear();
  });

  it("keeps active jobs indefinitely and retains terminal snapshots for only 30 minutes", async () => {
    vi.useFakeTimers();
    let now = Date.parse("2031-01-01T00:00:00.000Z");
    const candidate = reviewCandidate();
    let feedbackSignal: AbortSignal | undefined;
    const listings = readyListings();
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings,
      readCatalogSeeds: async () => [{
        sellerSku: candidate.sellerSkus[0]!,
        asin: candidate.asin,
        title: candidate.title,
      }],
      readCandidates: async () => completeCandidateSnapshot([candidate]),
      customerFeedback: {
        async read(input) {
          feedbackSignal = input.signal;
          return { candidate: input.candidate, noContent: true };
        },
      },
      now: () => now,
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    now += TERMINAL_TTL_MS + 1;
    const completedAfterInitialWindow = await coordinator.observe(request(
      "GET",
      "/review",
      { marketplaceId: US, jobId: JOB_ID },
    ));
    expect(completedAfterInitialWindow.status).toBe(200);
    expect(feedbackSignal?.aborted).toBe(false);

    now += TERMINAL_TTL_MS - 1;
    expect((await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }))).status).toBe(200);
    now += 1;
    const expired = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(expired.status).toBe(410);
    expect(jsonValue(expired).code).toBe("SNAPSHOT_EXPIRED");
    expect(feedbackSignal?.aborted).toBe(true);
    coordinator.clear();
  });

  it("aborts a pending start and prevents its late receipt from publishing a job", async () => {
    const lateReceipt = deferred<Awaited<
      ReturnType<ReviewAuditListingsPort["start"]>
    >>();
    const start = vi
      .fn<ReviewAuditListingsPort["start"]>()
      .mockImplementationOnce(() => lateReceipt.promise)
      .mockResolvedValueOnce({
        mode: "live",
        ready: true,
        reportId: "fresh-report",
        documentId: "fresh-document",
        status: "DONE",
        notice: "ready",
      });
    const status = readyListings().status;
    const candidate = reviewCandidate();
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings: { start, status },
      readCatalogSeeds: async () => [],
      readCandidates: async () => completeCandidateSnapshot([candidate]),
      customerFeedback: {
        async read(input) {
          return { candidate: input.candidate, noContent: true };
        },
      },
      createId: () => JOB_ID,
    });

    const staleStart = coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const staleSignal = start.mock.calls[0]![0].signal;
    coordinator.clear();
    expect(staleSignal?.aborted).toBe(true);
    lateReceipt.resolve({
      mode: "live",
      ready: true,
      reportId: "stale-report",
      documentId: "stale-document",
      status: "DONE",
      notice: "ready",
    });
    const stale = await staleStart;
    expect(stale.status).toBe(409);
    expect(jsonValue(stale).code).toBe("SP_CONTEXT_INVALIDATED");

    const freshStart = await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    expect(freshStart.status).toBe(202);
    expect(jsonValue(freshStart).jobId).toBe(JOB_ID);
    expect((await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }))).status).toBe(200);
    expect(start).toHaveBeenCalledTimes(2);
    coordinator.clear();
  });

  it("fences a cleared late flight without deleting a fresh reused job identity", async () => {
    const candidate = reviewCandidate();
    const oldCandidates = deferred<ReviewAuditCandidateSnapshot>();
    const freshCandidates = deferred<ReviewAuditCandidateSnapshot>();
    const readCandidates = vi
      .fn()
      .mockImplementationOnce(() => oldCandidates.promise)
      .mockImplementationOnce(() => freshCandidates.promise);
    const readFeedback = vi.fn(async (
      input: CustomerFeedbackReadInput,
    ): Promise<ReviewAuditFetchResult> => ({
      candidate: input.candidate,
      noContent: true,
    }));
    const listings = readyListings();
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings,
      readCatalogSeeds: async () => [{
        sellerSku: candidate.sellerSkus[0]!,
        asin: candidate.asin,
        title: candidate.title,
      }],
      readCandidates,
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const staleFlight = coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    await vi.waitFor(() => expect(readCandidates).toHaveBeenCalledTimes(1));

    coordinator.clear();
    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const freshFlight = coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    await vi.waitFor(() => expect(readCandidates).toHaveBeenCalledTimes(2));

    oldCandidates.resolve(completeCandidateSnapshot([candidate]));
    const stale = await staleFlight;
    expect(stale.status).toBe(409);
    expect(jsonValue(stale).code).toBe("SP_CONTEXT_INVALIDATED");

    const joinedFreshFlight = coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    freshCandidates.resolve(completeCandidateSnapshot([candidate]));
    const [fresh, joinedFresh] = await Promise.all([
      freshFlight,
      joinedFreshFlight,
    ]);
    expect(fresh.status).toBe(200);
    expect(joinedFresh.status).toBe(200);
    expect(readCandidates).toHaveBeenCalledTimes(2);
    expect(readFeedback).toHaveBeenCalledTimes(1);
    coordinator.clear();
  });

  it("preserves the classified context error when clear also aborts the flight", async () => {
    vi.useFakeTimers();
    const candidate = reviewCandidate();
    const listings = readyListings();
    let coordinator!: ReviewAuditCoordinator;
    const readFeedback = vi.fn(async (): Promise<ReviewAuditFetchResult> => {
      coordinator.clear();
      throw new SpExecutionContextAfterAdapterError(
        new SpExecutionContextError(
          "ACCOUNT_SCOPE_CHANGED",
          "Amazon 帳號範圍已改變；本次操作已停止。",
        ),
      );
    });
    coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings,
      readCatalogSeeds: async () => [{
        sellerSku: candidate.sellerSkus[0]!,
        asin: candidate.asin,
        title: candidate.title,
      }],
      readCandidates: async () => completeCandidateSnapshot([candidate]),
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const response = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(response.status).toBe(409);
    expect(jsonValue(response).code).toBe("ACCOUNT_SCOPE_CHANGED");
    expect((await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }))).status).toBe(410);
  });

  it("lets lifecycle invalidation supersede a late non-context SpApiError", async () => {
    vi.useFakeTimers();
    const candidate = reviewCandidate();
    const listings = readyListings();
    let coordinator!: ReviewAuditCoordinator;
    const readFeedback = vi.fn(async (): Promise<ReviewAuditFetchResult> => {
      coordinator.clear();
      throw new SpApiError("Late upstream failure.", {
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      });
    });
    coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings,
      readCatalogSeeds: async () => [],
      readCandidates: async () => completeCandidateSnapshot([candidate]),
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const response = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(response.status).toBe(409);
    expect(jsonValue(response).code).toBe("SP_CONTEXT_INVALIDATED");
  });

  it("performs only one bounded semantic retry after a safe 429", async () => {
    vi.useFakeTimers();
    let now = Date.parse("2032-01-01T00:00:00.000Z");
    const candidate = reviewCandidate();
    const listings = readyListings();
    const readFeedback = vi.fn(async (
      input: CustomerFeedbackReadInput,
    ): Promise<ReviewAuditFetchResult> => ({
      candidate: input.candidate,
      error: {
        code: "RATE_LIMITED",
        message: "Rate limited.",
        requestId: "request-429",
        retryAfter: "2",
      },
    }));
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings,
      readCatalogSeeds: async () => [],
      readCandidates: async () => completeCandidateSnapshot([candidate]),
      customerFeedback: { read: readFeedback },
      now: () => now,
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const first429 = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(first429.status).toBe(202);
    expect(readFeedback).toHaveBeenCalledTimes(1);
    const beforeDeadline = await coordinator.observe(request(
      "GET",
      "/review",
      { marketplaceId: US, jobId: JOB_ID },
    ));
    expect(beforeDeadline.status).toBe(202);
    expect(readFeedback).toHaveBeenCalledTimes(1);

    now += 2_000;
    const terminal = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(terminal.status).toBe(200);
    expect(jsonValue(terminal)).toMatchObject({
      summary: { feedbackIncomplete: 1, totalIncomplete: 1 },
    });
    expect(readFeedback).toHaveBeenCalledTimes(2);
    await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(readFeedback).toHaveBeenCalledTimes(2);
    coordinator.clear();
  });

  it("cancels the pending runner after an explicit classified failure", async () => {
    vi.useFakeTimers();
    const candidate = reviewCandidate();
    const listings = readyListings();
    const readFeedback = vi.fn(async (): Promise<ReviewAuditFetchResult> => {
      throw new SpApiError("Customer Feedback is unavailable.", {
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      });
    });
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings,
      readCatalogSeeds: async () => [],
      readCandidates: async () => completeCandidateSnapshot([candidate]),
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const failed = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(failed.status).toBe(503);
    expect(jsonValue(failed).code).toBe("SERVICE_UNAVAILABLE");
    expect(readFeedback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(readFeedback).toHaveBeenCalledTimes(1);
    expect((await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }))).status).toBe(503);
    expect(readFeedback).toHaveBeenCalledTimes(2);
    coordinator.clear();
  });

  it("fans one 403-equivalent result out to all remaining candidates", async () => {
    vi.useFakeTimers();
    const candidates = [
      reviewCandidate(1),
      reviewCandidate(2),
      reviewCandidate(3, "standalone"),
    ];
    const listings = readyListings();
    const readFeedback = vi.fn(async (
      input: CustomerFeedbackReadInput,
    ): Promise<ReviewAuditFetchResult> => ({
      candidate: input.candidate,
      error: {
        code: "UNAUTHORIZED",
        message: "Customer Feedback role is unavailable.",
        requestId: "request-403",
      },
    }));
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings,
      readCatalogSeeds: async () => [],
      readCandidates: async () => completeCandidateSnapshot(candidates),
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const terminal = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(terminal.status).toBe(200);
    expect(jsonValue(terminal)).toMatchObject({
      summary: {
        uniqueFbaNonParentAsins: 3,
        feedbackIncomplete: 3,
        totalIncomplete: 3,
      },
    });
    expect(readFeedback).toHaveBeenCalledTimes(1);
    coordinator.clear();
  });

  it("compares Customer Feedback identity against a stable pre-call candidate", async () => {
    vi.useFakeTimers();
    const candidate = reviewCandidate();
    const listings = readyListings();
    const readFeedback = vi.fn(async (
      input: CustomerFeedbackReadInput,
    ): Promise<ReviewAuditFetchResult> => {
      input.candidate.asin = "B999999999";
      input.candidate.sellerSkus[0] = "MUTATED-SKU";
      return { candidate: input.candidate, noContent: true };
    });
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => "live",
      listings,
      readCatalogSeeds: async () => [],
      readCandidates: async () => completeCandidateSnapshot([candidate]),
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    const response = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(response.status).toBe(409);
    expect(jsonValue(response).code).toBe("LISTING_IDENTITY_MISMATCH");
    expect(readFeedback).toHaveBeenCalledTimes(1);
    coordinator.clear();
  });

  it("deletes a partially-read job when its current mode changes", async () => {
    vi.useFakeTimers();
    let mode: "live" | "demo" = "live";
    const candidates = [reviewCandidate(1), reviewCandidate(2)];
    const listings = readyListings();
    const readFeedback = vi.fn(async (
      input: CustomerFeedbackReadInput,
    ): Promise<ReviewAuditFetchResult> => ({
      candidate: input.candidate,
      noContent: true,
    }));
    const coordinator = new ReviewAuditCoordinator({
      context: liveContext(),
      resolveMode: () => mode,
      listings,
      readCatalogSeeds: async () => [],
      readCandidates: async () => completeCandidateSnapshot(candidates),
      customerFeedback: { read: readFeedback },
      createId: () => JOB_ID,
    });

    await coordinator.start(request("POST", "/review", {
      marketplaceId: US,
    }));
    expect((await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }))).status).toBe(202);
    expect(readFeedback).toHaveBeenCalledTimes(1);

    mode = "demo";
    const changed = await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }));
    expect(changed.status).toBe(409);
    expect(jsonValue(changed).code).toBe("REPORT_MODE_CHANGED");
    expect(readFeedback).toHaveBeenCalledTimes(1);
    expect((await coordinator.observe(request("GET", "/review", {
      marketplaceId: US,
      jobId: JOB_ID,
    }))).status).toBe(410);
    coordinator.clear();
  });
});
