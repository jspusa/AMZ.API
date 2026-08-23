import { randomUUID } from "node:crypto";

const DEFAULT_TTL_MS = 30 * 60 * 1_000;

export const STANDALONE_AUDIT_KINDS = [
  "content",
  "image",
  "variation",
  "subscription",
  "businessPricing",
  "advertising",
  "agedInventory",
] as const;

export type StandaloneAuditKind = typeof STANDALONE_AUDIT_KINDS[number];
export type StandaloneAuditJobMode = "live" | "demo";
export type StandaloneAuditJobOptions = Readonly<{ months?: 6 | 12 | 23 }>;

export type StandaloneAuditJobBoundContext = Readonly<{
  accountScope: string;
  marketplaceId: string;
  mode: StandaloneAuditJobMode;
}>;

export type StandaloneAuditJobProgress = Readonly<{
  stage: string;
  message: string;
  completedUnits: number | null;
  totalUnits: number | null;
}>;

export type StandaloneAuditJobGateway = Readonly<{
  bindContext(input: Readonly<{
    marketplaceId: string;
    mode: StandaloneAuditJobMode;
  }>): Promise<StandaloneAuditJobBoundContext>;
  run(input: Readonly<{
    kind: StandaloneAuditKind;
    options: StandaloneAuditJobOptions;
    context: StandaloneAuditJobBoundContext;
    signal: AbortSignal;
    heartbeat(): void;
    updateProgress(progress: StandaloneAuditJobProgress): void;
  }>): Promise<unknown>;
}>;

type ReceiptBase = Readonly<{
  jobId: string;
  contextId: string;
  kind: StandaloneAuditKind;
  marketplaceId: string;
  mode: StandaloneAuditJobMode;
  options: StandaloneAuditJobOptions;
  progress: StandaloneAuditJobProgress;
}>;

export type StandaloneAuditJobPendingReceipt = ReceiptBase & Readonly<{
  ready: false;
  status: "queued" | "running";
}>;

export type StandaloneAuditJobCompletedReceipt = ReceiptBase & Readonly<{
  ready: true;
  status: "completed";
  snapshot: unknown;
}>;

export type StandaloneAuditJobFailedReceipt = ReceiptBase & Readonly<{
  ready: true;
  status: "failed" | "aborted";
  error: Readonly<{ code: string; message: string }>;
}>;

export type StandaloneAuditJobReceipt =
  | StandaloneAuditJobPendingReceipt
  | StandaloneAuditJobCompletedReceipt
  | StandaloneAuditJobFailedReceipt;

type RuntimeJob = {
  jobId: string;
  contextId: string;
  kind: StandaloneAuditKind;
  options: StandaloneAuditJobOptions;
  context: StandaloneAuditJobBoundContext;
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  progress: StandaloneAuditJobProgress;
  controller: AbortController;
  expiresAt: number;
  snapshot?: unknown;
  error?: Readonly<{ code: string; message: string }>;
};

function isAuditKind(value: string): value is StandaloneAuditKind {
  return (STANDALONE_AUDIT_KINDS as readonly string[]).includes(value);
}

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

function canonicalOptions(
  kind: StandaloneAuditKind,
  value: StandaloneAuditJobOptions | undefined,
): StandaloneAuditJobOptions {
  const source = value ?? {};
  const keys = Object.keys(source);
  if (kind === "subscription") {
    if (
      keys.some((key) => key !== "months") ||
      (source.months !== undefined &&
        source.months !== 6 &&
        source.months !== 12 &&
        source.months !== 23)
    ) {
      throw new Error("單項健檢的 S&S 月數無效。");
    }
    return source.months === undefined ? {} : { months: source.months };
  }
  if (keys.length > 0) throw new Error("單項健檢選項無效。");
  return {};
}

function selectionKey(input: Readonly<{
  context: StandaloneAuditJobBoundContext;
  kind: StandaloneAuditKind;
  options: StandaloneAuditJobOptions;
}>): string {
  return JSON.stringify([
    input.context.accountScope,
    input.context.marketplaceId,
    input.context.mode,
    input.kind,
    input.options.months ?? null,
  ]);
}

function validProgress(progress: StandaloneAuditJobProgress): boolean {
  const validCount = (value: number | null) =>
    value === null ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000);
  return (
    /^[a-z][a-z0-9_]{0,63}$/u.test(progress.stage) &&
    progress.message.length > 0 &&
    progress.message.length <= 160 &&
    progress.message === progress.message.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(progress.message) &&
    validCount(progress.completedUnits) &&
    validCount(progress.totalUnits) &&
    (progress.completedUnits === null ||
      progress.totalUnits === null ||
      progress.completedUnits <= progress.totalUnits)
  );
}

export class StandaloneAuditJobCoordinatorError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, input: Readonly<{ status: number; code: string }>) {
    super(message);
    this.name = "StandaloneAuditJobCoordinatorError";
    this.status = input.status;
    this.code = input.code;
  }
}

export class StandaloneAuditJobCoordinator {
  private readonly gateway: StandaloneAuditJobGateway;
  private readonly jobs = new Map<string, RuntimeJob>();
  private readonly selections = new Map<string, string>();
  private readonly runnerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ttlMs: number;

  constructor(input: Readonly<{
    gateway: StandaloneAuditJobGateway;
    ttlMs?: number;
  }>) {
    this.gateway = input.gateway;
    this.ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1) {
      throw new Error("單項健檢工作保存期限無效。");
    }
  }

  clear(): void {
    for (const jobId of [...this.jobs.keys()]) this.deleteJob(jobId);
    this.selections.clear();
  }

  async start(input: Readonly<{
    kind: StandaloneAuditKind;
    marketplaceId: string;
    mode: StandaloneAuditJobMode;
    options?: StandaloneAuditJobOptions;
  }>): Promise<StandaloneAuditJobPendingReceipt> {
    this.prune();
    if (
      !isAuditKind(input.kind) ||
      !validMarketplaceId(input.marketplaceId) ||
      (input.mode !== "live" && input.mode !== "demo")
    ) {
      throw new Error("單項健檢工作種類、站點或模式無效。");
    }
    const options = canonicalOptions(input.kind, input.options);
    const context = await this.bindContext(input);
    this.prune();
    const selection = selectionKey({ context, kind: input.kind, options });
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
      kind: input.kind,
      options,
      context,
      status: "queued",
      progress: {
        stage: "queued",
        message: "已排入 Notebook 鑰匙背景健檢。",
        completedUnits: 0,
        totalUnits: null,
      },
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
    kind: StandaloneAuditKind;
    marketplaceId: string;
    mode: StandaloneAuditJobMode;
  }>): Promise<StandaloneAuditJobReceipt> {
    this.prune();
    const job = this.jobs.get(input.jobId);
    if (
      !job ||
      job.contextId !== input.contextId ||
      job.kind !== input.kind ||
      job.context.marketplaceId !== input.marketplaceId ||
      job.context.mode !== input.mode
    ) {
      throw new StandaloneAuditJobCoordinatorError(
        "單項健檢工作已過期或 context 不符。",
        { status: 410, code: "STANDALONE_AUDIT_JOB_EXPIRED" },
      );
    }
    const context = await this.bindContext({
      marketplaceId: input.marketplaceId,
      mode: input.mode,
    });
    this.prune();
    if (this.jobs.get(job.jobId) !== job) {
      throw new StandaloneAuditJobCoordinatorError(
        "單項健檢工作已過期或 context 不符。",
        { status: 410, code: "STANDALONE_AUDIT_JOB_EXPIRED" },
      );
    }
    if (
      context.accountScope !== job.context.accountScope ||
      context.marketplaceId !== job.context.marketplaceId ||
      context.mode !== job.context.mode
    ) {
      this.deleteJob(job.jobId);
      throw new StandaloneAuditJobCoordinatorError(
        "單項健檢工作與目前帳號、站點或模式不一致。",
        { status: 409, code: "ACCOUNT_SCOPE_CHANGED" },
      );
    }
    return this.receipt(job);
  }

  private async run(job: RuntimeJob): Promise<void> {
    if (this.jobs.get(job.jobId) !== job || job.status !== "queued") return;
    job.status = "running";
    job.progress = {
      stage: "starting",
      message: "Notebook 鑰匙正在啟動背景健檢。",
      completedUnits: 0,
      totalUnits: null,
    };
    this.touchActive(job);
    try {
      await this.assertJobContext(job);
      const snapshot = await this.gateway.run({
        kind: job.kind,
        options: job.options,
        context: job.context,
        signal: job.controller.signal,
        heartbeat: () => this.touchActive(job),
        updateProgress: (progress) => {
          if (
            this.jobs.get(job.jobId) !== job ||
            job.controller.signal.aborted ||
            !validProgress(progress)
          ) return;
          job.progress = { ...progress };
          this.touchActive(job);
        },
      });
      if (this.jobs.get(job.jobId) !== job || job.controller.signal.aborted) return;
      await this.assertJobContext(job);
      job.snapshot = structuredClone(snapshot);
      job.status = "completed";
      if (job.progress.stage !== "complete") {
        job.progress = {
          ...job.progress,
          stage: "complete",
          message: "單項健檢完成。",
          completedUnits: job.progress.totalUnits ?? job.progress.completedUnits,
        };
      }
      this.retainTerminal(job);
    } catch {
      if (this.jobs.get(job.jobId) !== job || job.controller.signal.aborted) return;
      job.status = "failed";
      job.error = {
        code: "STANDALONE_AUDIT_FAILED",
        message: "單項健檢未完成，未產生可核對的結果。",
      };
      this.retainTerminal(job);
    }
  }

  private pendingReceipt(job: RuntimeJob): StandaloneAuditJobPendingReceipt {
    return {
      ...this.baseReceipt(job),
      ready: false,
      status: job.status as "queued" | "running",
    };
  }

  private receipt(job: RuntimeJob): StandaloneAuditJobReceipt {
    if (job.status === "queued" || job.status === "running") {
      return this.pendingReceipt(job);
    }
    const base = { ...this.baseReceipt(job), ready: true as const };
    if (job.status === "completed" && "snapshot" in job) {
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
        code: "STANDALONE_AUDIT_FAILED",
        message: "單項健檢未完成，未產生可核對的結果。",
      }) },
    };
  }

  private baseReceipt(job: RuntimeJob): ReceiptBase {
    return {
      jobId: job.jobId,
      contextId: job.contextId,
      kind: job.kind,
      marketplaceId: job.context.marketplaceId,
      mode: job.context.mode,
      options: { ...job.options },
      progress: { ...job.progress },
    };
  }

  private async bindContext(input: Readonly<{
    marketplaceId: string;
    mode: StandaloneAuditJobMode;
  }>): Promise<StandaloneAuditJobBoundContext> {
    let context: StandaloneAuditJobBoundContext;
    try {
      context = await this.gateway.bindContext(input);
    } catch {
      throw new StandaloneAuditJobCoordinatorError(
        "單項健檢無法安全綁定目前 Notebook 鑰匙 context。",
        { status: 503, code: "STANDALONE_AUDIT_CONTEXT_UNAVAILABLE" },
      );
    }
    if (
      context.marketplaceId !== input.marketplaceId ||
      context.mode !== input.mode ||
      !validAccountScope(context.accountScope)
    ) {
      throw new StandaloneAuditJobCoordinatorError(
        "單項健檢的帳號、站點或模式 context 已改變。",
        { status: 409, code: "STANDALONE_AUDIT_CONTEXT_CHANGED" },
      );
    }
    return { ...context };
  }

  private async assertJobContext(job: RuntimeJob): Promise<void> {
    if (this.jobs.get(job.jobId) !== job || job.controller.signal.aborted) {
      throw new StandaloneAuditJobCoordinatorError(
        "單項健檢工作已停止。",
        { status: 410, code: "STANDALONE_AUDIT_JOB_EXPIRED" },
      );
    }
    const current = await this.bindContext({
      marketplaceId: job.context.marketplaceId,
      mode: job.context.mode,
    });
    if (current.accountScope !== job.context.accountScope) {
      throw new StandaloneAuditJobCoordinatorError(
        "單項健檢的帳號 context 已改變。",
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
    const selection = selectionKey({
      context: job.context,
      kind: job.kind,
      options: job.options,
    });
    if (this.selections.get(selection) === jobId) this.selections.delete(selection);
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
        code: "STANDALONE_AUDIT_ABORTED",
        message: "單項健檢超過安全執行期限，已由 Notebook 鑰匙停止。",
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
