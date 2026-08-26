import { randomUUID } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../shared/marketplaces";
import { throwIfAborted } from "./abort-utils";
import {
  buildReviewAuditSnapshot,
  type DedupedFbaReviewCandidate,
  type ReviewAuditCandidateCoverage,
  type ReviewAuditFetchResult,
  type ReviewAuditRelationshipIncompleteRow,
  type ReviewAuditSnapshot,
} from "./amazon/review-audit";
import {
  customerFeedbackMarketplaceSupported,
  type CustomerFeedbackReadsPort,
} from "./amazon/customer-feedback-reads";
import type { ListingsExportPort } from "./amazon/listings-export";
import { createReviewAuditWorkbook } from "./amazon/review-audit-xlsx";
import { SpApiError } from "./amazon/sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
  type SpExecutionMode,
} from "./amazon/sp-execution-context";
import type {
  FbaReviewAuditSeed,
  ReviewAuditCandidateSnapshot,
} from "./amazon/variation-catalog-reads";
import {
  bodyRecord,
  parseMarketplace,
  reportIdentifier,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";

const REVIEW_AUDIT_TERMINAL_TTL_MS = 30 * 60 * 1_000;
const REVIEW_AUDIT_RATE_LIMIT_RETRY_LIMIT = 1;
const REVIEW_AUDIT_DEFAULT_RATE_LIMIT_DELAY_MS = 2_000;
const REVIEW_AUDIT_MAX_RATE_LIMIT_DELAY_MS = 25 * 60 * 1_000;
const REVIEW_AUDIT_BACKGROUND_STEP_MS = 25;
const REVIEW_AUDIT_REPORT_POLL_MS = 1_150;
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OPAQUE_JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ReviewAuditListingsPort = Pick<
  ListingsExportPort,
  "start" | "status"
>;

export type ReviewAuditCatalogSeedReader = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
  expectedContext: SpExecutionContext;
  signal: AbortSignal;
}>) => Promise<FbaReviewAuditSeed[]>;

export type ReviewAuditCandidateSource = (input: Readonly<{
  marketplaceId: MarketplaceId;
  mode: SpExecutionMode;
  seeds: readonly FbaReviewAuditSeed[];
  signal: AbortSignal;
}>) => Promise<ReviewAuditCandidateSnapshot>;

export type ReviewAuditCoordinatorDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  resolveMode(marketplaceId: MarketplaceId): SpExecutionMode;
  listings: ReviewAuditListingsPort;
  readCatalogSeeds: ReviewAuditCatalogSeedReader;
  readCandidates: ReviewAuditCandidateSource;
  customerFeedback: CustomerFeedbackReadsPort;
  now?: () => number;
  createId?: () => string;
}>;

export interface ReviewAuditCoordinatorPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  observe(request: ApiRequest): Promise<ApiResponse>;
  download(request: ApiRequest): Promise<ApiResponse>;
  clear(): void;
}

type ReviewAuditJob = {
  readonly jobId: string;
  readonly revision: number;
  readonly marketplaceId: MarketplaceId;
  readonly context: SpExecutionContext;
  readonly mode: SpExecutionMode;
  listingReportId: string;
  listingDocumentId: string | null;
  listingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE";
  candidates: DedupedFbaReviewCandidate[] | null;
  sourceCandidateCount: number;
  candidateCoverage: ReviewAuditCandidateCoverage | null;
  relationshipIncompleteRows: ReviewAuditRelationshipIncompleteRow[];
  results: ReviewAuditFetchResult[];
  nextCandidateIndex: number;
  retryNotBefore: number;
  rateLimitRetryCount: number;
  snapshot: ReviewAuditSnapshot | null;
  terminalExpiresAt: number | null;
  readonly controller: AbortController;
};

type ReviewAuditFlight = Readonly<{
  job: ReviewAuditJob;
  revision: number;
  promise: Promise<ApiResponse>;
}>;

type ReviewAuditRunnerTimer = Readonly<{
  job: ReviewAuditJob;
  revision: number;
  timer: ReturnType<typeof setTimeout>;
}>;

function bytes(
  value: Uint8Array,
  headers: Record<string, string>,
): ApiResponse {
  return {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": XLSX_CONTENT_TYPE,
      "x-content-type-options": "nosniff",
      ...headers,
    },
    body: { kind: "bytes", value },
  };
}

function contextInvalidated(): SpExecutionContextError {
  return new SpExecutionContextError(
    "SP_CONTEXT_INVALIDATED",
    "Amazon 執行環境已更新；請重新開始這次操作。",
  );
}

class ReviewAuditDirectModeError extends SpExecutionContextError {
  constructor() {
    super(
      "REPORT_MODE_CHANGED",
      "App 展示／真實模式已改變，舊評論健檢不可繼續或匯出。",
    );
    this.name = "ReviewAuditDirectModeError";
  }
}

function reportModeChanged(): ReviewAuditDirectModeError {
  return new ReviewAuditDirectModeError();
}

function reportModeChangedReply(): ApiResponse {
  return invalid(
    "App 展示／真實模式已改變，舊評論健檢不可繼續或匯出。",
    409,
    "REPORT_MODE_CHANGED",
  );
}

function isContextFence(error: unknown): error is SpApiError {
  return error instanceof SpApiError && [
    "ACCOUNT_SCOPE_CHANGED",
    "REPORT_MODE_CHANGED",
    "SP_CONTEXT_INVALIDATED",
  ].includes(error.code);
}

function reviewAuditRateLimitDelay(
  retryAfter: string | null | undefined,
  now: number,
): number | null {
  if (!retryAfter) return REVIEW_AUDIT_DEFAULT_RATE_LIMIT_DELAY_MS;
  const trimmed = retryAfter.trim();
  let milliseconds: number;
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    milliseconds = Math.ceil(Number(trimmed) * 1_000);
  } else {
    const retryAt = Date.parse(trimmed);
    if (
      !Number.isFinite(retryAt) ||
      new Date(retryAt).toUTCString() !== trimmed
    ) {
      return null;
    }
    milliseconds = Math.max(0, retryAt - now);
  }
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > REVIEW_AUDIT_MAX_RATE_LIMIT_DELAY_MS
  ) {
    return null;
  }
  return Math.max(REVIEW_AUDIT_DEFAULT_RATE_LIMIT_DELAY_MS, milliseconds);
}

function sameCandidate(
  left: DedupedFbaReviewCandidate,
  right: DedupedFbaReviewCandidate,
): boolean {
  return left.asin === right.asin &&
    left.title === right.title &&
    left.relationshipRole === right.relationshipRole &&
    left.evidence === right.evidence &&
    left.sellerSkus.length === right.sellerSkus.length &&
    left.sellerSkus.every((sellerSku, index) =>
      sellerSku === right.sellerSkus[index]);
}

function frozenCandidate(
  candidate: DedupedFbaReviewCandidate,
): DedupedFbaReviewCandidate {
  const copy = structuredClone(candidate);
  Object.freeze(copy.sellerSkus);
  Object.freeze(copy);
  return copy;
}

function coherentReportReceipt(
  receipt: Awaited<ReturnType<ReviewAuditListingsPort["start"]>>,
): boolean {
  if (receipt.status === "DONE") {
    return receipt.ready === true &&
      typeof receipt.documentId === "string" &&
      receipt.documentId.length > 0;
  }
  return receipt.ready === false && receipt.documentId === null;
}

/**
 * Main-only owner of the complete Review background workflow. The four-method
 * interface hides report polling, relationship coverage, Customer Feedback
 * progression, bounded rescheduling, context fences, retention, and export.
 */
export class ReviewAuditCoordinator implements ReviewAuditCoordinatorPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly resolveMode: ReviewAuditCoordinatorDependencies["resolveMode"];
  private readonly listings: ReviewAuditListingsPort;
  private readonly readCatalogSeeds: ReviewAuditCatalogSeedReader;
  private readonly readCandidates: ReviewAuditCandidateSource;
  private readonly customerFeedback: CustomerFeedbackReadsPort;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly jobs = new Map<string, ReviewAuditJob>();
  private readonly flights = new Map<string, ReviewAuditFlight>();
  private readonly runnerTimers = new Map<string, ReviewAuditRunnerTimer>();
  private readonly startControls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: ReviewAuditCoordinatorDependencies) {
    this.context = input.context;
    this.resolveMode = input.resolveMode;
    this.listings = input.listings;
    this.readCatalogSeeds = input.readCatalogSeeds;
    this.readCandidates = input.readCandidates;
    this.customerFeedback = input.customerFeedback;
    this.now = input.now ?? Date.now;
    this.createId = input.createId ?? randomUUID;
  }

  clear(): void {
    this.lifecycleRevision += 1;
    const reason = contextInvalidated();
    for (const control of this.startControls) control.abort(reason);
    this.startControls.clear();
    for (const [jobId, job] of [...this.jobs]) {
      this.deleteJob(jobId, job, reason);
    }
    for (const entry of this.runnerTimers.values()) clearTimeout(entry.timer);
    this.runnerTimers.clear();
    this.flights.clear();
  }

  private assertLifecycleCurrent(revision: number): void {
    if (this.lifecycleRevision !== revision) throw contextInvalidated();
  }

  private assertJobCurrent(job: ReviewAuditJob): void {
    throwIfAborted(job.controller.signal);
    this.assertLifecycleCurrent(job.revision);
    if (this.jobs.get(job.jobId) !== job) throw contextInvalidated();
  }

  private assertModeCurrent(job: ReviewAuditJob): void {
    if (this.resolveMode(job.marketplaceId) === job.mode) return;
    const error = reportModeChanged();
    this.deleteJob(job.jobId, job, error);
    throw error;
  }

  private async assertJobContext(job: ReviewAuditJob): Promise<void> {
    this.assertJobCurrent(job);
    this.assertModeCurrent(job);
    await this.context.assertCurrent(job.context);
    this.assertJobCurrent(job);
    this.assertModeCurrent(job);
    if (
      job.context.marketplaceId !== job.marketplaceId ||
      job.context.mode !== job.mode
    ) {
      throw contextInvalidated();
    }
  }

  private deleteJob(
    jobId: string,
    expected?: ReviewAuditJob,
    reason: unknown = contextInvalidated(),
  ): void {
    const job = this.jobs.get(jobId);
    if (!job || (expected && job !== expected)) return;
    const runner = this.runnerTimers.get(jobId);
    if (runner?.job === job) {
      clearTimeout(runner.timer);
      this.runnerTimers.delete(jobId);
    }
    const flight = this.flights.get(jobId);
    if (flight?.job === job) this.flights.delete(jobId);
    this.jobs.delete(jobId);
    if (!job.controller.signal.aborted) job.controller.abort(reason);
  }

  private pruneJobs(now = this.now()): void {
    for (const [jobId, job] of this.jobs) {
      if (job.controller.signal.aborted) {
        this.deleteJob(jobId, job, job.controller.signal.reason);
        continue;
      }
      if (!job.snapshot || job.terminalExpiresAt === null) continue;
      if (job.terminalExpiresAt <= now) this.deleteJob(jobId, job);
    }
  }

  private jobReply(job: ReviewAuditJob): ApiResponse {
    const total = job.candidates?.length ?? null;
    const completed = job.nextCandidateIndex;
    const ready = Boolean(job.snapshot);
    return json({
      jobId: job.jobId,
      exportId: ready ? job.jobId : null,
      mode: job.mode,
      marketplaceId: job.marketplaceId,
      ready,
      status: ready
        ? "DONE"
        : job.candidates
          ? "READING_NON_PARENT_TOPICS"
          : job.listingStatus,
      progress: {
        completed,
        total,
        percent: total === null || total === 0
          ? ready ? 100 : 0
          : Math.round((completed / total) * 100),
      },
      message: ready
        ? "FBA 非 parent ASIN 評論主題健檢已完成。"
        : job.candidates
          ? `正在依 Amazon 官方 1 request/second 限制讀取已驗證的非 parent ASIN 主題（${completed} / ${total}）。`
          : "Amazon 正在準備目前 FBA 商品清單。",
      capabilityNotice:
        "資料每週更新且僅英文；前／後五名使用 Amazon 主題影響值。它不是商品總星等或 1–5 星制；負數是此負向主題對星等下降方向的影響值，不是商品負星等，也不會轉成 0 或絕對值。關閉健檢小視窗後，本機主程序仍會在背景繼續。",
    }, ready ? 200 : 202);
  }

  private snapshotReply(job: ReviewAuditJob): ApiResponse {
    return json({
      ...structuredClone(job.snapshot),
      exportId: job.jobId,
    });
  }

  private stopRunner(job: ReviewAuditJob): void {
    const entry = this.runnerTimers.get(job.jobId);
    if (entry?.job !== job || entry.revision !== job.revision) return;
    clearTimeout(entry.timer);
    this.runnerTimers.delete(job.jobId);
  }

  private flight(job: ReviewAuditJob): Promise<ApiResponse> {
    const current = this.flights.get(job.jobId);
    if (current?.job === job && current.revision === job.revision) {
      return current.promise;
    }
    let entry: ReviewAuditFlight;
    const promise = this.advance(job)
      .then(
        (response) => {
          if (response.status >= 400 || job.snapshot) this.stopRunner(job);
          return response;
        },
        (error: unknown) => {
          this.stopRunner(job);
          throw error;
        },
      )
      .finally(() => {
        if (this.flights.get(job.jobId) === entry) {
          this.flights.delete(job.jobId);
        }
      });
    entry = { job, revision: job.revision, promise };
    this.flights.set(job.jobId, entry);
    return promise;
  }

  private scheduleRunner(
    job: ReviewAuditJob,
    delay = REVIEW_AUDIT_BACKGROUND_STEP_MS,
  ): void {
    if (
      this.runnerTimers.has(job.jobId) ||
      this.jobs.get(job.jobId) !== job ||
      job.snapshot ||
      job.controller.signal.aborted
    ) {
      return;
    }
    let entry: ReviewAuditRunnerTimer;
    const timer = setTimeout(() => {
      if (this.runnerTimers.get(job.jobId) !== entry) return;
      this.runnerTimers.delete(job.jobId);
      if (
        this.jobs.get(job.jobId) !== job ||
        job.revision !== this.lifecycleRevision ||
        job.controller.signal.aborted
      ) {
        return;
      }
      void this.runBackground(job);
    }, Math.max(0, delay));
    timer.unref?.();
    entry = { job, revision: job.revision, timer };
    this.runnerTimers.set(job.jobId, entry);
  }

  private async runBackground(job: ReviewAuditJob): Promise<void> {
    this.pruneJobs();
    if (this.jobs.get(job.jobId) !== job || job.snapshot) return;
    let response: ApiResponse;
    try {
      response = await this.flight(job);
    } catch {
      // Stop this background continuation. A later explicit observation can
      // surface the same failure, but must not cause a blind auto-retry.
      return;
    }
    if (
      response.status >= 400 ||
      job.snapshot ||
      this.jobs.get(job.jobId) !== job
    ) {
      return;
    }
    const delay = job.candidates
      ? Math.max(REVIEW_AUDIT_BACKGROUND_STEP_MS, job.retryNotBefore - this.now())
      : REVIEW_AUDIT_REPORT_POLL_MS;
    this.scheduleRunner(job, delay);
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId) {
      return invalid("請選擇要健檢評論主題的 Amazon 站點。");
    }
    if (!customerFeedbackMarketplaceSupported(marketplaceId)) {
      return invalid(
        "Amazon Customer Feedback API 僅支援本 App 的 US、JP、UK 與 DE 站；未改用父變體或私有 Seller Central 資料。",
        422,
        "MARKETPLACE_UNSUPPORTED",
      );
    }

    const revision = this.lifecycleRevision;
    const startControl = new AbortController();
    this.startControls.add(startControl);
    try {
      throwIfAborted(startControl.signal);
      const context = await this.context.capture(marketplaceId);
      throwIfAborted(startControl.signal);
      this.assertLifecycleCurrent(revision);
      if (
        context.marketplaceId !== marketplaceId ||
        this.resolveMode(marketplaceId) !== context.mode
      ) {
        throw reportModeChanged();
      }
      const status = await this.listings.start({
        marketplaceId,
        signal: startControl.signal,
        expectedContext: context,
      });
      throwIfAborted(startControl.signal);
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(revision);
      if (this.resolveMode(marketplaceId) !== context.mode) {
        throw reportModeChanged();
      }
      if (status.mode !== context.mode) {
        return invalid(
          "FBA 商品清單與評論健檢執行環境不一致，已停止。",
          409,
          "REPORT_MODE_CHANGED",
        );
      }
      if (
        status.status !== "IN_QUEUE" &&
        status.status !== "IN_PROGRESS" &&
        status.status !== "DONE"
      ) {
        return invalid(
          "Amazon 未能開始建立 FBA 商品清單。",
          422,
          "REPORT_FAILED",
        );
      }
      if (!coherentReportReceipt(status)) {
        return invalid(
          "Amazon FBA 商品清單狀態不一致，已停止。",
          409,
          "REPORT_MISMATCH",
        );
      }
      this.pruneJobs();
      const jobId = this.createId();
      if (!OPAQUE_JOB_ID.test(jobId)) {
        throw new SpApiError("評論健檢工作識別無效。", {
          status: 500,
          code: "JOB_ID_INVALID",
        });
      }
      if (this.jobs.has(jobId)) {
        throw new SpApiError("評論健檢工作識別重複。", {
          status: 409,
          code: "JOB_ID_COLLISION",
        });
      }
      const job: ReviewAuditJob = {
        jobId,
        revision,
        marketplaceId,
        context,
        mode: context.mode,
        listingReportId: status.reportId,
        listingDocumentId: status.documentId,
        listingStatus: status.status,
        candidates: null,
        sourceCandidateCount: 0,
        candidateCoverage: null,
        relationshipIncompleteRows: [],
        results: [],
        nextCandidateIndex: 0,
        retryNotBefore: 0,
        rateLimitRetryCount: 0,
        snapshot: null,
        terminalExpiresAt: null,
        controller: new AbortController(),
      };
      this.jobs.set(jobId, job);
      this.scheduleRunner(job);
      return this.jobReply(job);
    } catch (error) {
      if (error instanceof ReviewAuditDirectModeError) {
        return reportModeChangedReply();
      }
      if (!isContextFence(error)) {
        try {
          throwIfAborted(startControl.signal);
          this.assertLifecycleCurrent(revision);
        } catch (fence) {
          return routeError(
            fence,
            "開始 FBA 評論主題健檢時發生未預期的錯誤。",
          );
        }
      }
      return routeError(
        error,
        "開始 FBA 評論主題健檢時發生未預期的錯誤。",
      );
    } finally {
      this.startControls.delete(startControl);
    }
  }

  async observe(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = reportIdentifier(request.query.jobId);
    if (!marketplaceId || !jobId) {
      return invalid("評論主題健檢工作資訊無效。");
    }
    this.pruneJobs();
    const job = this.jobs.get(jobId);
    if (!job || job.marketplaceId !== marketplaceId) {
      return invalid(
        "評論主題健檢已過期或站點不符，請重新掃描。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    try {
      this.assertModeCurrent(job);
    } catch (error) {
      if (error instanceof ReviewAuditDirectModeError) {
        return reportModeChangedReply();
      }
      return routeError(error, "評論健檢執行環境已改變，請重新開始。");
    }
    return this.flight(job);
  }

  private async advance(job: ReviewAuditJob): Promise<ApiResponse> {
    try {
      await this.assertJobContext(job);
      if (job.snapshot) return this.snapshotReply(job);

      if (job.listingStatus !== "DONE" || !job.listingDocumentId) {
        const status = await this.listings.status({
          marketplaceId: job.marketplaceId,
          reportId: job.listingReportId,
          signal: job.controller.signal,
          expectedContext: job.context,
        });
        await this.assertJobContext(job);
        if (status.reportId !== job.listingReportId) {
          throw new SpApiError("Amazon FBA 商品清單工作識別不一致。", {
            status: 409,
            code: "REPORT_MISMATCH",
          });
        }
        if (status.mode !== job.mode) throw reportModeChanged();
        if (
          status.status !== "IN_QUEUE" &&
          status.status !== "IN_PROGRESS" &&
          status.status !== "DONE"
        ) {
          return invalid(
            "Amazon 未能產生 FBA 商品清單。",
            422,
            "REPORT_FAILED",
          );
        }
        if (!coherentReportReceipt(status)) {
          return invalid(
            "Amazon FBA 商品清單狀態不一致，已停止。",
            409,
            "REPORT_MISMATCH",
          );
        }
        job.listingStatus = status.status;
        job.listingDocumentId = status.documentId;
        if (!status.ready || !status.documentId) return this.jobReply(job);
      }

      if (!job.candidates) {
        const seeds = await this.readCatalogSeeds({
          marketplaceId: job.marketplaceId,
          reportId: job.listingReportId,
          documentId: job.listingDocumentId!,
          expectedContext: job.context,
          signal: job.controller.signal,
        });
        await this.assertJobContext(job);
        const candidateSnapshot = await this.readCandidates({
          marketplaceId: job.marketplaceId,
          mode: job.mode,
          seeds,
          signal: job.controller.signal,
        });
        await this.assertJobContext(job);
        if (candidateSnapshot.mode !== job.mode) {
          return invalid(
            "FBA 商品清單與評論健檢模式不一致，已停止。",
            409,
            "REPORT_MISMATCH",
          );
        }
        if (candidateSnapshot.marketplaceId !== job.marketplaceId) {
          return invalid(
            "FBA 商品清單與評論健檢站點不一致，已停止。",
            409,
            "REPORT_MISMATCH",
          );
        }
        job.candidates = structuredClone(candidateSnapshot.candidates);
        job.sourceCandidateCount = candidateSnapshot.sourceCandidateCount;
        job.candidateCoverage = structuredClone(candidateSnapshot.coverage);
        job.relationshipIncompleteRows = structuredClone(
          candidateSnapshot.relationshipIncompleteRows,
        );
      }

      const candidates = job.candidates;
      if (
        job.mode === "live" &&
        job.nextCandidateIndex < candidates.length &&
        this.now() < job.retryNotBefore
      ) {
        return this.jobReply(job);
      }
      const quota = job.mode === "demo"
        ? candidates.length - job.nextCandidateIndex
        : Math.min(1, candidates.length - job.nextCandidateIndex);
      for (let count = 0; count < quota; count += 1) {
        const candidate = candidates[job.nextCandidateIndex];
        if (!candidate) break;
        await this.assertJobContext(job);
        const expectedCandidate = frozenCandidate(candidate);
        const requestCandidate = structuredClone(expectedCandidate);
        const result = await this.customerFeedback.read({
          marketplaceId: job.marketplaceId,
          candidate: requestCandidate,
          expectedContext: job.context,
          signal: job.controller.signal,
        });
        await this.assertJobContext(job);
        if (!sameCandidate(result.candidate, expectedCandidate)) {
          throw new SpApiError(
            "Amazon Customer Feedback 回應與目前候選商品不一致。",
            { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
          );
        }
        if (result.error?.code === "RATE_LIMITED") {
          const delay = reviewAuditRateLimitDelay(
            result.error.retryAfter,
            this.now(),
          );
          if (
            delay !== null &&
            job.rateLimitRetryCount < REVIEW_AUDIT_RATE_LIMIT_RETRY_LIMIT
          ) {
            job.rateLimitRetryCount += 1;
            job.retryNotBefore = this.now() + delay;
            return this.jobReply(job);
          }
        }
        job.results.push(structuredClone(result));
        job.nextCandidateIndex += 1;
        job.rateLimitRetryCount = 0;
        if (result.error?.code === "UNAUTHORIZED") {
          while (job.nextCandidateIndex < candidates.length) {
            const remaining = candidates[job.nextCandidateIndex]!;
            job.results.push({
              candidate: structuredClone(remaining),
              error: {
                code: "UNAUTHORIZED",
                message: result.error.message,
                requestId: result.error.requestId ?? null,
              },
            });
            job.nextCandidateIndex += 1;
          }
          break;
        }
      }
      job.retryNotBefore = 0;
      if (job.nextCandidateIndex >= candidates.length) {
        await this.assertJobContext(job);
        const snapshot = buildReviewAuditSnapshot({
          mode: job.mode,
          marketplaceId: job.marketplaceId,
          fetchedAt: new Date(this.now()),
          results: job.results,
          relationshipIncompleteRows: job.relationshipIncompleteRows,
          candidateCoverage: job.candidateCoverage ?? undefined,
          sourceCandidateCount: job.sourceCandidateCount,
        });
        this.assertJobCurrent(job);
        this.assertModeCurrent(job);
        job.snapshot = snapshot;
        job.terminalExpiresAt = this.now() + REVIEW_AUDIT_TERMINAL_TTL_MS;
        return this.snapshotReply(job);
      }
      return this.jobReply(job);
    } catch (error) {
      if (error instanceof ReviewAuditDirectModeError) {
        this.deleteJob(job.jobId, job, error);
        return reportModeChangedReply();
      }
      if (isContextFence(error)) {
        this.deleteJob(job.jobId, job, error);
        return routeError(
          error,
          "評論健檢執行環境已改變，請重新開始。",
        );
      }
      try {
        // Match the original precedence: a classified SpApiError above wins
        // over cleanup aborts, while an unclassified failure is replaced only
        // when this exact job/lifecycle was actually invalidated.
        this.assertJobCurrent(job);
      } catch (fence) {
        if (isContextFence(fence)) {
          this.deleteJob(job.jobId, job, fence);
          return routeError(
            fence,
            "評論健檢執行環境已改變，請重新開始。",
          );
        }
        return routeError(
          fence,
          "整理 FBA 評論主題時發生未預期的錯誤。",
        );
      }
      return routeError(
        error,
        "整理 FBA 評論主題時發生未預期的錯誤。",
      );
    }
  }

  async download(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const exportId = reportIdentifier(request.query.exportId);
    if (!marketplaceId || !exportId) {
      return invalid("評論主題 Excel 快照資訊無效。");
    }
    this.pruneJobs();
    const job = this.jobs.get(exportId);
    if (!job || job.marketplaceId !== marketplaceId || !job.snapshot) {
      return invalid(
        "評論主題健檢尚未完成、已過期或站點不符。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    try {
      await this.assertJobContext(job);
      const marketplace = marketplaceById(marketplaceId);
      if (!marketplace) throw contextInvalidated();
      const workbook = createReviewAuditWorkbook({
        marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
        snapshot: job.snapshot,
      });
      const filename =
        `amazon-fba-review-topic-audit-${marketplace.shortLabel.toLowerCase()}-${job.snapshot.fetchedAt.slice(0, 10)}.xlsx`;
      return bytes(workbook, {
        "content-disposition": `attachment; filename="${filename}"`,
        "x-exported-fba-non-parent-asin-count": String(job.snapshot.rows.length),
        "x-review-topic-incomplete-count": String(job.snapshot.summary.incomplete),
      });
    } catch (error) {
      if (error instanceof ReviewAuditDirectModeError) {
        this.deleteJob(exportId, job, error);
        return reportModeChangedReply();
      }
      if (isContextFence(error)) this.deleteJob(exportId, job, error);
      return routeError(
        error,
        "建立 FBA 評論主題 Excel 時發生未預期的錯誤。",
      );
    }
  }
}
