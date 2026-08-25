import { randomUUID } from "node:crypto";
import {
  type AplusAuditSnapshot,
  type AplusAuditProgress,
  type AplusAuditSeed,
} from "./a-plus-content-reads";
import { SpExecutionContextError } from "./sp-execution-context";

const DEFAULT_TTL_MS = 30 * 60 * 1_000;

export type AplusAuditJobMode = "live" | "demo";

export type AplusAuditJobBoundContext = Readonly<{
  accountScope: string;
  marketplaceId: string;
  mode: AplusAuditJobMode;
}>;

export type AplusAuditFbaSeedSnapshot = Readonly<{
  fetchedAt: string;
  fbaSnapshotId: string;
  rows: readonly AplusAuditSeed[];
}>;

export type AplusAuditJobGateway = Readonly<{
  bindContext(input: Readonly<{
    marketplaceId: string;
    mode: AplusAuditJobMode;
  }>): Promise<AplusAuditJobBoundContext>;
  loadFbaSeeds(input: Readonly<{
    context: AplusAuditJobBoundContext;
    signal: AbortSignal;
    heartbeat(): void;
  }>): Promise<AplusAuditFbaSeedSnapshot>;
  read(input: Readonly<{
    context: AplusAuditJobBoundContext;
    seed: AplusAuditFbaSeedSnapshot;
    signal: AbortSignal;
    heartbeat(): void;
    onProgress(progress: AplusAuditProgress): void;
  }>): Promise<AplusAuditSnapshot>;
}>;

export type AplusAuditJobPendingReceipt = Readonly<{
  jobId: string;
  contextId: string;
  marketplaceId: string;
  mode: AplusAuditJobMode;
  ready: false;
  status: "queued" | "running";
  progress: AplusAuditProgress;
}>;

export type AplusAuditJobPublicSnapshot = Omit<
  AplusAuditSnapshot,
  "fbaSnapshotId"
>;

export type AplusAuditJobCompletedReceipt = Readonly<{
  jobId: string;
  contextId: string;
  marketplaceId: string;
  mode: AplusAuditJobMode;
  ready: true;
  status: "completed";
  progress: AplusAuditProgress;
  snapshot: AplusAuditJobPublicSnapshot;
}>;

export type AplusAuditJobFailedReceipt = Readonly<{
  jobId: string;
  contextId: string;
  marketplaceId: string;
  mode: AplusAuditJobMode;
  ready: true;
  status: "failed" | "aborted";
  progress: AplusAuditProgress;
  error: Readonly<{ code: string; message: string }>;
}>;

export type AplusAuditJobReceipt =
  | AplusAuditJobPendingReceipt
  | AplusAuditJobCompletedReceipt
  | AplusAuditJobFailedReceipt;

type RuntimeJob = {
  jobId: string;
  contextId: string;
  context: AplusAuditJobBoundContext;
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  progress: AplusAuditProgress;
  controller: AbortController;
  expiresAt: number;
  snapshot?: AplusAuditJobPublicSnapshot;
  error?: Readonly<{ code: string; message: string }>;
};

function validMarketplaceId(value: string): boolean {
  return /^[A-Z0-9]{10,24}$/u.test(value);
}

function validAccountScope(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function scopeKey(context: AplusAuditJobBoundContext): string {
  return JSON.stringify([
    context.accountScope,
    context.marketplaceId,
    context.mode,
  ]);
}

export class AplusAuditJobCoordinatorError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, input: Readonly<{ status: number; code: string }>) {
    super(message);
    this.name = "AplusAuditJobCoordinatorError";
    this.status = input.status;
    this.code = input.code;
  }
}

export class AplusAuditJobCoordinator {
  private readonly gateway: AplusAuditJobGateway;
  private readonly jobs = new Map<string, RuntimeJob>();
  private readonly selections = new Map<string, string>();
  private readonly runnerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ttlMs: number;

  constructor(input: Readonly<{
    gateway: AplusAuditJobGateway;
    ttlMs?: number;
  }>) {
    this.gateway = input.gateway;
    this.ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1) {
      throw new Error("A+ 健檢工作保存期限無效。");
    }
  }

  clear(): void {
    for (const jobId of [...this.jobs.keys()]) this.deleteJob(jobId);
    this.selections.clear();
  }

  async start(input: Readonly<{
    marketplaceId: string;
    mode: AplusAuditJobMode;
  }>): Promise<AplusAuditJobPendingReceipt> {
    this.prune();
    if (
      !validMarketplaceId(input.marketplaceId) ||
      (input.mode !== "live" && input.mode !== "demo")
    ) {
      throw new Error("A+ 健檢工作站點或模式無效。");
    }
    const context = await this.bindContext(input);
    this.prune();
    const selection = scopeKey(context);
    const existingJobId = this.selections.get(selection);
    const existing = existingJobId ? this.jobs.get(existingJobId) : undefined;
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return this.pendingReceipt(existing);
    }
    if (existing) this.deleteJob(existing.jobId);
    else if (existingJobId) this.selections.delete(selection);
    const job: RuntimeJob = {
      jobId: randomUUID(),
      contextId: randomUUID(),
      context,
      status: "queued",
      progress: { completedAsins: 0, totalAsins: 0 },
      controller: new AbortController(),
      expiresAt: Date.now() + this.ttlMs,
    };
    this.jobs.set(job.jobId, job);
    this.selections.set(selection, job.jobId);
    const timer = setTimeout(() => {
      this.runnerTimers.delete(job.jobId);
      void this.run(job);
    }, 0);
    timer.unref?.();
    this.runnerTimers.set(job.jobId, timer);
    this.scheduleExpiry(job);
    return this.pendingReceipt(job);
  }

  async get(input: Readonly<{
    jobId: string;
    contextId: string;
    marketplaceId: string;
    mode: AplusAuditJobMode;
  }>): Promise<AplusAuditJobReceipt> {
    this.prune();
    const job = this.jobs.get(input.jobId);
    if (
      !job ||
      job.contextId !== input.contextId ||
      job.context.marketplaceId !== input.marketplaceId ||
      job.context.mode !== input.mode
    ) {
      throw new AplusAuditJobCoordinatorError(
        "A+ 健檢工作已過期或 context 不符。",
        { status: 410, code: "A_PLUS_AUDIT_JOB_EXPIRED" },
      );
    }
    const context = await this.bindContext({
      marketplaceId: input.marketplaceId,
      mode: input.mode,
    });
    this.prune();
    if (this.jobs.get(job.jobId) !== job) {
      throw new AplusAuditJobCoordinatorError(
        "A+ 健檢工作已過期或 context 不符。",
        { status: 410, code: "A_PLUS_AUDIT_JOB_EXPIRED" },
      );
    }
    if (
      context.accountScope !== job.context.accountScope ||
      context.marketplaceId !== job.context.marketplaceId ||
      context.mode !== job.context.mode
    ) {
      this.deleteJob(job.jobId);
      throw new AplusAuditJobCoordinatorError(
        "A+ 健檢工作與目前帳號、站點或模式不一致。",
        { status: 409, code: "ACCOUNT_SCOPE_CHANGED" },
      );
    }
    return this.receipt(job);
  }

  private async run(job: RuntimeJob): Promise<void> {
    if (this.jobs.get(job.jobId) !== job || job.status !== "queued") return;
    job.status = "running";
    this.touchActive(job);
    try {
      await this.assertJobContext(job);
      const seed = await this.gateway.loadFbaSeeds({
        context: job.context,
        signal: job.controller.signal,
        heartbeat: () => this.touchActive(job),
      });
      if (this.jobs.get(job.jobId) !== job || job.controller.signal.aborted) return;
      await this.assertJobContext(job);
      if (!Array.isArray(seed.rows) || seed.rows.length > 25_000) {
        throw new Error("A+ 健檢 FBA seed 範圍無效。");
      }
      const totalAsins = new Set(seed.rows.flatMap((row) =>
        typeof row.asin === "string" && /^[A-Z0-9]{10}$/u.test(row.asin)
          ? [row.asin]
          : [],
      )).size;
      job.progress = { completedAsins: 0, totalAsins };
      this.touchActive(job);
      const snapshot = await this.gateway.read({
        context: job.context,
        seed,
        signal: job.controller.signal,
        heartbeat: () => this.touchActive(job),
        onProgress: (progress) => {
          if (
            this.jobs.get(job.jobId) === job &&
            !job.controller.signal.aborted &&
            progress.totalAsins === totalAsins &&
            progress.completedAsins >= job.progress.completedAsins &&
            progress.completedAsins <= totalAsins
          ) {
            job.progress = { ...progress };
            this.touchActive(job);
          }
        },
      });
      if (this.jobs.get(job.jobId) !== job || job.controller.signal.aborted) return;
      await this.assertJobContext(job);
      if (
        snapshot.marketplaceId !== job.context.marketplaceId ||
        snapshot.mode !== job.context.mode ||
        snapshot.summary.uniqueAsins !== totalAsins
      ) {
        throw new Error("A+ 健檢完成快照 context 不一致。");
      }
      const publicSnapshot: AplusAuditJobPublicSnapshot = {
        mode: snapshot.mode,
        marketplaceId: snapshot.marketplaceId,
        fetchedAt: snapshot.fetchedAt,
        totals: structuredClone(snapshot.totals),
        summary: structuredClone(snapshot.summary),
        rows: structuredClone(snapshot.rows),
        notice: snapshot.notice,
      };
      job.progress = { completedAsins: totalAsins, totalAsins };
      job.snapshot = structuredClone(publicSnapshot);
      job.status = "completed";
      this.retainTerminal(job);
    } catch {
      if (this.jobs.get(job.jobId) !== job || job.controller.signal.aborted) return;
      job.status = "failed";
      job.error = {
        code: "A_PLUS_AUDIT_FAILED",
        message: "A+ 健檢未完成，未產生可核對的結果。",
      };
      this.retainTerminal(job);
    }
  }

  private pendingReceipt(job: RuntimeJob): AplusAuditJobPendingReceipt {
    return {
      jobId: job.jobId,
      contextId: job.contextId,
      marketplaceId: job.context.marketplaceId,
      mode: job.context.mode,
      ready: false,
      status: job.status as "queued" | "running",
      progress: { ...job.progress },
    };
  }

  private receipt(job: RuntimeJob): AplusAuditJobReceipt {
    if (job.status === "queued" || job.status === "running") {
      return this.pendingReceipt(job);
    }
    const base = {
      jobId: job.jobId,
      contextId: job.contextId,
      marketplaceId: job.context.marketplaceId,
      mode: job.context.mode,
      ready: true as const,
      progress: { ...job.progress },
    };
    if (job.status === "completed" && job.snapshot) {
      return {
        ...base,
        status: "completed",
        snapshot: structuredClone(job.snapshot),
      };
    }
    return {
      ...base,
      status: job.status === "aborted" ? "aborted" : "failed",
      error: { ...(job.error ?? {
        code: "A_PLUS_AUDIT_FAILED",
        message: "A+ 健檢未完成，未產生可核對的結果。",
      }) },
    };
  }

  private async bindContext(input: Readonly<{
    marketplaceId: string;
    mode: AplusAuditJobMode;
  }>): Promise<AplusAuditJobBoundContext> {
    let context: AplusAuditJobBoundContext;
    try {
      context = await this.gateway.bindContext(input);
    } catch (error) {
      if (error instanceof SpExecutionContextError) {
        throw new AplusAuditJobCoordinatorError(error.message, {
          status: error.status,
          code: error.code,
        });
      }
      throw new AplusAuditJobCoordinatorError(
        "A+ 健檢無法安全綁定目前 Notebook 鑰匙 context。",
        { status: 503, code: "A_PLUS_AUDIT_CONTEXT_UNAVAILABLE" },
      );
    }
    if (
      context.marketplaceId !== input.marketplaceId ||
      context.mode !== input.mode ||
      !validAccountScope(context.accountScope)
    ) {
      throw new AplusAuditJobCoordinatorError(
        "A+ 健檢的帳號、站點或模式 context 已改變。",
        { status: 409, code: "A_PLUS_AUDIT_CONTEXT_CHANGED" },
      );
    }
    return {
      accountScope: context.accountScope,
      marketplaceId: context.marketplaceId,
      mode: context.mode,
    };
  }

  private async assertJobContext(job: RuntimeJob): Promise<void> {
    if (this.jobs.get(job.jobId) !== job || job.controller.signal.aborted) {
      throw new AplusAuditJobCoordinatorError(
        "A+ 健檢工作已停止。",
        { status: 410, code: "A_PLUS_AUDIT_JOB_EXPIRED" },
      );
    }
    const current = await this.bindContext({
      marketplaceId: job.context.marketplaceId,
      mode: job.context.mode,
    });
    if (current.accountScope !== job.context.accountScope) {
      throw new AplusAuditJobCoordinatorError(
        "A+ 健檢的帳號 context 已改變。",
        { status: 409, code: "ACCOUNT_SCOPE_CHANGED" },
      );
    }
  }

  private deleteJob(jobId: string): void {
    const runnerTimer = this.runnerTimers.get(jobId);
    if (runnerTimer) clearTimeout(runnerTimer);
    this.runnerTimers.delete(jobId);
    const expiryTimer = this.expiryTimers.get(jobId);
    if (expiryTimer) clearTimeout(expiryTimer);
    this.expiryTimers.delete(jobId);
    const job = this.jobs.get(jobId);
    this.jobs.delete(jobId);
    if (!job) return;
    job.controller.abort();
    const selection = scopeKey(job.context);
    if (this.selections.get(selection) === jobId) {
      this.selections.delete(selection);
    }
  }

  private touchActive(job: RuntimeJob): void {
    if (
      this.jobs.get(job.jobId) !== job ||
      (job.status !== "queued" && job.status !== "running")
    ) return;
    job.expiresAt = Date.now() + this.ttlMs;
    this.scheduleExpiry(job);
  }

  private retainTerminal(job: RuntimeJob): void {
    if (this.jobs.get(job.jobId) !== job) return;
    job.expiresAt = Date.now() + this.ttlMs;
    this.scheduleExpiry(job);
  }

  private scheduleExpiry(job: RuntimeJob): void {
    if (this.jobs.get(job.jobId) !== job) return;
    const existing = this.expiryTimers.get(job.jobId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.expiryTimers.delete(job.jobId);
      this.expire(job, Date.now());
    }, Math.max(0, job.expiresAt - Date.now()));
    timer.unref?.();
    this.expiryTimers.set(job.jobId, timer);
  }

  private expire(job: RuntimeJob, now: number): void {
    if (this.jobs.get(job.jobId) !== job) return;
    if (job.expiresAt > now) {
      this.scheduleExpiry(job);
      return;
    }
    if (job.status === "queued" || job.status === "running") {
      job.controller.abort();
      const runnerTimer = this.runnerTimers.get(job.jobId);
      if (runnerTimer) clearTimeout(runnerTimer);
      this.runnerTimers.delete(job.jobId);
      job.status = "aborted";
      job.error = {
        code: "A_PLUS_AUDIT_ABORTED",
        message: "A+ 健檢超過安全執行期限，已由 Notebook 鑰匙停止。",
      };
      this.retainTerminal(job);
      return;
    }
    this.deleteJob(job.jobId);
  }

  private prune(now = Date.now()): void {
    for (const job of [...this.jobs.values()]) {
      if (job.expiresAt <= now) this.expire(job, now);
    }
  }
}
