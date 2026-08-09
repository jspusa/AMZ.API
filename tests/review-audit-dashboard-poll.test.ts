import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVIEW_AUDIT_DASHBOARD_NETWORK_RETRY_MS,
  REVIEW_AUDIT_DASHBOARD_POLL_INTERVAL_MS,
  pollExistingReviewAuditJob,
  reviewAuditHomeProgress,
  type ReviewAuditJobView,
  type ReviewAuditStatusRequest,
} from "../src/renderer/src/review-audit";

const US = "ATVPDKIKX0DER";

function job(
  completed: number,
  total = 257,
  mode: "live" | "demo" = "live",
): ReviewAuditJobView {
  return {
    jobId: "job-dashboard-1234",
    marketplaceId: US,
    mode,
    ready: false,
    status: "READING_NON_PARENT_TOPICS",
    progress: {
      completed,
      total,
      percent: Math.round((completed / total) * 100),
    },
    message: `正在讀取（${completed} / ${total}）。`,
    capabilityNotice: "這是評論主題影響值，不是商品星等。",
  };
}

function completedSnapshot(mode: "live" | "demo" = "live") {
  return {
    schemaVersion: 2,
    mode,
    marketplaceId: US,
    fetchedAt: "2026-08-09T08:00:00.000Z",
    exportId: "job-dashboard-1234",
    rows: [{
      sellerSkus: ["AFA12AM"],
      asin: "B000000001",
      title: "Turkey tendon",
      relationshipRole: "child",
      status: "NO_TOPICS",
      positiveTopics: [],
      negativeTopics: [],
      incompleteReason: null,
      averageProductRating: null,
      totalReviewCount: null,
      fullReviewTextAvailable: false,
    }],
    relationshipIncompleteRows: [],
    topFivePositive: [],
    bottomFiveNegative: [],
    summary: {
      sourceFbaListings: 1,
      verifiedNonParentListings: 1,
      uniqueFbaNonParentAsins: 1,
      verifiedChildListings: 1,
      verifiedStandaloneListings: 0,
      excludedParentContainers: 0,
      relationshipIncomplete: 0,
      completed: 0,
      noTopics: 1,
      feedbackIncomplete: 0,
      totalIncomplete: 0,
      incomplete: 0,
      duplicateSkuAsinsCollapsed: 0,
    },
    notice: "評論主題健檢完成。",
  };
}

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("closed Dashboard review-audit observer", () => {
  it("keeps GET-polling the same running job and replaces it with the terminal snapshot", async () => {
    vi.useFakeTimers();
    const payloads = [job(142), job(143), completedSnapshot()];
    const requests: ReviewAuditStatusRequest[] = [];
    const progress: number[] = [];
    const snapshots: unknown[] = [];
    const request = vi.fn(async (input: ReviewAuditStatusRequest) => {
      requests.push(input);
      return response(requests.length < 3 ? 202 : 200, payloads[requests.length - 1]);
    });
    const controller = new AbortController();

    const polling = pollExistingReviewAuditJob({
      marketplaceId: US,
      initialJob: job(141),
      signal: controller.signal,
      request,
      onJob: (next) => progress.push(next.progress.completed),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });

    await flushMicrotasks();
    expect(progress).toEqual([142]);
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_POLL_INTERVAL_MS);
    expect(progress).toEqual([142, 143]);
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_POLL_INTERVAL_MS);
    await polling;

    expect(request).toHaveBeenCalledTimes(3);
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
    expect(requests.every(({ url }) =>
      url === "/api/sp-api/review-audit?marketplaceId=ATVPDKIKX0DER&jobId=job-dashboard-1234"
    )).toBe(true);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      exportId: "job-dashboard-1234",
      summary: { uniqueFbaNonParentAsins: 1 },
    });
  });

  it("retries one rejected network request, then resumes the same GET loop", async () => {
    vi.useFakeTimers();
    let call = 0;
    const request = vi.fn(async (input: ReviewAuditStatusRequest) => {
      expect(input.method).toBe("GET");
      call += 1;
      if (call === 1) throw new TypeError("temporary network failure");
      return call === 2
        ? response(202, job(200))
        : response(200, completedSnapshot());
    });
    const snapshots: unknown[] = [];
    const errors: Error[] = [];
    const controller = new AbortController();
    const polling = pollExistingReviewAuditJob({
      marketplaceId: US,
      initialJob: job(199),
      signal: controller.signal,
      request,
      onJob: () => undefined,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: (error) => errors.push(error),
    });

    await flushMicrotasks();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_NETWORK_RETRY_MS);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_POLL_INTERVAL_MS);
    await polling;

    expect(request).toHaveBeenCalledTimes(3);
    expect(snapshots).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("keeps retrying consecutive transient failures with bounded backoff and aborts cleanly", async () => {
    vi.useFakeTimers();
    let call = 0;
    const snapshots: unknown[] = [];
    const request = vi.fn(async () => {
      call += 1;
      if (call <= 2) throw new TypeError("offline");
      return call === 3
        ? response(202, job(2))
        : response(200, completedSnapshot());
    });
    const controller = new AbortController();
    const polling = pollExistingReviewAuditJob({
      marketplaceId: US,
      initialJob: job(1),
      signal: controller.signal,
      request,
      onJob: () => undefined,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_NETWORK_RETRY_MS);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_NETWORK_RETRY_MS * 2);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_POLL_INTERVAL_MS);
    await polling;
    expect(request).toHaveBeenCalledTimes(4);
    expect(snapshots).toHaveLength(1);

    const runningRequest = vi.fn(async () => {
      throw new TypeError("still offline");
    });
    const aborted = new AbortController();
    const running = pollExistingReviewAuditJob({
      marketplaceId: US,
      initialJob: job(1),
      signal: aborted.signal,
      request: runningRequest,
      onJob: () => undefined,
      onSnapshot: () => undefined,
    });
    await flushMicrotasks();
    aborted.abort();
    await running;
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_POLL_INTERVAL_MS * 2);
    expect(runningRequest).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an existing job changes identity or mode", async () => {
    const errors: Error[] = [];
    const request = vi.fn(async () => response(202, job(10, 257, "demo")));
    await pollExistingReviewAuditJob({
      marketplaceId: US,
      initialJob: job(9),
      signal: new AbortController().signal,
      request,
      onJob: () => {
        throw new Error("mismatched job must not update cache");
      },
      onSnapshot: () => undefined,
      onError: (error) => errors.push(error),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/模式已改變/u);

    const wrongSnapshot = completedSnapshot() as ReturnType<typeof completedSnapshot> & {
      exportId: string;
    };
    wrongSnapshot.exportId = "job-dashboard-other";
    const snapshotErrors: Error[] = [];
    await pollExistingReviewAuditJob({
      marketplaceId: US,
      initialJob: job(9),
      signal: new AbortController().signal,
      request: async () => response(200, wrongSnapshot),
      onJob: () => undefined,
      onSnapshot: () => {
        throw new Error("mismatched terminal snapshot must not update cache");
      },
      onError: (error) => snapshotErrors.push(error),
    });
    expect(snapshotErrors).toHaveLength(1);
    expect(snapshotErrors[0]?.message).toMatch(/識別或模式已改變/u);
  });

  it("retries transient HTTP status but clears an expired existing job", async () => {
    vi.useFakeTimers();
    let call = 0;
    const stopped: number[] = [];
    const controller = new AbortController();
    const polling = pollExistingReviewAuditJob({
      marketplaceId: US,
      initialJob: job(9),
      signal: controller.signal,
      request: async () => {
        call += 1;
        return call === 1
          ? response(503, { code: "UPSTREAM_UNAVAILABLE" })
          : response(410, { code: "REVIEW_AUDIT_EXPIRED" });
      },
      onJob: () => undefined,
      onSnapshot: () => undefined,
      onStopped: (status) => stopped.push(status),
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(REVIEW_AUDIT_DASHBOARD_NETWORK_RETRY_MS);
    await polling;
    expect(call).toBe(2);
    expect(stopped).toEqual([410]);
  });

  it("formats the home card with both percent and completed/total progress", () => {
    expect(reviewAuditHomeProgress({ snapshot: null, job: job(142) })).toEqual({
      primary: "55%",
      detail: "142 / 257 個 ASIN",
      ariaLabel: "評論健檢 55% 已完成，142 / 257 個 ASIN",
    });
    expect(reviewAuditHomeProgress({
      snapshot: null,
      job: { ...job(0), progress: { completed: 0, total: null, percent: 0 } },
    })).toMatchObject({ primary: "0%", detail: "0 / — 個 ASIN" });
  });

  it("wires the Dashboard observer only while the drawer is closed", async () => {
    const dashboard = await readFile(
      new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
      "utf8",
    );
    const helper = await readFile(
      new URL("../src/renderer/src/review-audit.ts", import.meta.url),
      "utf8",
    );
    expect(dashboard).toContain("if (reviewAuditOpen || !backgroundReviewAuditJob) return");
    expect(dashboard).toContain("return () => controller.abort()");
    expect(dashboard).toContain("marketplaceId, reviewAuditOpen");
    expect(dashboard).toContain("clearReviewAudit(marketplaceId)");
    expect(dashboard).toContain("currentReviewAuditProgress.primary");
    expect(dashboard).toContain("currentReviewAuditProgress.detail");
    expect(dashboard).toContain('className="review-audit-home-progress"');
    expect(dashboard).toContain("currentReviewAudit.job.progress.percent");
    expect(helper).toContain('method: "GET"');
    expect(helper).not.toContain('method: "POST"');
  });
});
