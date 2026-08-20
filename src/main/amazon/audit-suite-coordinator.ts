import { randomUUID } from "node:crypto";
import {
  AUDIT_SUITE_SCHEMA_VERSION,
  AUDIT_SUITE_SECTION_IDS,
  type AuditSuiteContext,
  type AuditSuiteMode,
  type AuditSuiteRunDto,
  type AuditSuiteRunStatus,
  type AuditSuiteSectionId,
  type AuditSuiteSectionProgress,
} from "../../shared/audit-suite";
import type {
  AuditSuiteWorkbookInput,
  ValidatedAuditSuiteSnapshot,
} from "./audit-suite-xlsx";

const DEFAULT_TTL_MS = 30 * 60 * 1_000;

type SectionSnapshots = AuditSuiteWorkbookInput["sections"];
type MutableSectionSnapshots = {
  -readonly [K in keyof SectionSnapshots]: SectionSnapshots[K];
};
type SnapshotFor<K extends AuditSuiteSectionId> = NonNullable<SectionSnapshots[K]>;

type AuditSuiteHeartbeatProgress =
  | Readonly<{ completedUnits?: undefined; totalUnits?: undefined }>
  | Readonly<{ completedUnits: number; totalUnits: number }>
  | Readonly<{ completedUnits: null; totalUnits: null }>;

export type AuditSuiteHeartbeat = Readonly<{ message?: string }> &
  AuditSuiteHeartbeatProgress;

declare const AUDIT_SUITE_RESOURCE_VALUE: unique symbol;

export type AuditSuiteResourceKey<T> = Readonly<{
  token: symbol;
  [AUDIT_SUITE_RESOURCE_VALUE]: (value: T) => T;
}>;

export function createAuditSuiteResourceKey<T>(
  description: string,
): AuditSuiteResourceKey<T> {
  return Object.freeze({ token: Symbol(description) }) as AuditSuiteResourceKey<T>;
}

export type AuditSuiteRunControl = Readonly<{
  signal: AbortSignal;
  heartbeat(update?: AuditSuiteHeartbeat): void;
  resource<T>(key: AuditSuiteResourceKey<T>, load: () => Promise<T>): Promise<T>;
}>;

export type AuditSuiteSectionRunners = Readonly<{
  [K in AuditSuiteSectionId]: (
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ) => Promise<SnapshotFor<K>>;
}>;

type AuditSuiteRuntimeJob = {
  context: AuditSuiteContext;
  contextId: string;
  startedAt: string;
  updatedAt: string;
  expiresAt: number;
  progress: Record<AuditSuiteSectionId, AuditSuiteSectionProgress>;
  snapshots: MutableSectionSnapshots;
  controller: AbortController;
  resources: Map<symbol, Promise<unknown>>;
};

export class AuditSuiteCoordinatorError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, input: { status: number; code: string }) {
    super(message);
    this.name = "AuditSuiteCoordinatorError";
    this.status = input.status;
    this.code = input.code;
  }
}

function terminal(status: AuditSuiteRunStatus): boolean {
  return status === "completed" || status === "partial" || status === "failed";
}

function aggregateStatus(
  progress: Record<AuditSuiteSectionId, AuditSuiteSectionProgress>,
): AuditSuiteRunStatus {
  const statuses = AUDIT_SUITE_SECTION_IDS.map((id) => progress[id].status);
  if (statuses.every((status) => status === "queued")) return "queued";
  if (statuses.some((status) => status === "queued" || status === "running")) {
    return "running";
  }
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.every((status) => status === "failed")) return "failed";
  return "partial";
}

function safeFailureNotice(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "此項健檢未能建立可核對快照。";
  const normalized = message.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 1_500);
  return normalized || "此項健檢未能建立可核對快照。";
}

export class AuditSuiteCoordinator {
  private readonly jobs = new Map<string, AuditSuiteRuntimeJob>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly flights = new Map<string, Promise<void>>();
  private readonly runners: AuditSuiteSectionRunners;
  private readonly ttlMs: number;

  constructor(input: { runners: AuditSuiteSectionRunners; ttlMs?: number }) {
    this.runners = input.runners;
    this.ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  }

  clear(): void {
    for (const runId of [...this.jobs.keys()]) this.deleteJob(runId);
  }

  start(input: {
    marketplaceId: string;
    accountScope: string;
    mode: AuditSuiteMode;
  }): { run: AuditSuiteRunDto; reused: boolean } {
    this.prune();
    const existing = [...this.jobs.values()].find((job) =>
      job.context.marketplaceId === input.marketplaceId &&
      job.context.accountScope === input.accountScope &&
      job.context.mode === input.mode &&
      !terminal(aggregateStatus(job.progress)),
    );
    if (existing) return { run: this.dto(existing), reused: true };

    const runId = randomUUID();
    const contextId = randomUUID();
    const now = new Date().toISOString();
    const progress = Object.fromEntries(AUDIT_SUITE_SECTION_IDS.map((id) => [id, {
      id,
      status: "queued" as const,
      message: "等待 main process 背景健檢。",
      completedUnits: 0,
      totalUnits: 1,
      updatedAt: now,
    }])) as Record<AuditSuiteSectionId, AuditSuiteSectionProgress>;
    const snapshots = Object.fromEntries(
      AUDIT_SUITE_SECTION_IDS.map((id) => [id, null]),
    ) as MutableSectionSnapshots;
    const job: AuditSuiteRuntimeJob = {
      context: {
        runId,
        marketplaceId: input.marketplaceId,
        accountScope: input.accountScope,
        mode: input.mode,
      },
      contextId,
      startedAt: now,
      updatedAt: now,
      expiresAt: Date.now() + this.ttlMs,
      progress,
      snapshots,
      controller: new AbortController(),
      resources: new Map(),
    };
    this.jobs.set(runId, job);
    const timer = setTimeout(() => {
      this.timers.delete(runId);
      void this.run(job);
    }, 0);
    timer.unref?.();
    this.timers.set(runId, timer);
    return { run: this.dto(job), reused: false };
  }

  get(input: {
    runId: string;
    contextId: string;
    marketplaceId: string;
    accountScope: string;
    mode: AuditSuiteMode;
  }): AuditSuiteRunDto {
    return this.dto(this.authorize(input));
  }

  workbookInput(input: {
    runId: string;
    contextId: string;
    marketplaceId: string;
    accountScope: string;
    mode: AuditSuiteMode;
    marketplaceLabel: string;
    generatedAt?: string | Date;
  }): AuditSuiteWorkbookInput {
    const job = this.authorize(input);
    const status = aggregateStatus(job.progress);
    if (status !== "completed" && status !== "partial") {
      throw new AuditSuiteCoordinatorError(
        "綜合健檢尚未有可下載的 completed／partial 快照。",
        { status: 409, code: "AUDIT_SUITE_NOT_EXPORTABLE" },
      );
    }
    return {
      context: { ...job.context },
      marketplaceLabel: input.marketplaceLabel,
      generatedAt: input.generatedAt ?? new Date(),
      sections: { ...job.snapshots },
    };
  }

  private authorize(input: {
    runId: string;
    contextId: string;
    marketplaceId: string;
    accountScope: string;
    mode: AuditSuiteMode;
  }): AuditSuiteRuntimeJob {
    this.prune();
    const job = this.jobs.get(input.runId);
    if (!job || job.contextId !== input.contextId || job.context.marketplaceId !== input.marketplaceId) {
      throw new AuditSuiteCoordinatorError(
        "綜合健檢工作已過期或執行 context 不符。",
        { status: 410, code: "AUDIT_SUITE_EXPIRED" },
      );
    }
    if (job.context.accountScope !== input.accountScope) {
      this.deleteJob(input.runId);
      throw new AuditSuiteCoordinatorError(
        "Amazon 帳號範圍已改變，舊綜合健檢不可讀取或匯出。",
        { status: 409, code: "ACCOUNT_SCOPE_CHANGED" },
      );
    }
    if (job.context.mode !== input.mode) {
      this.deleteJob(input.runId);
      throw new AuditSuiteCoordinatorError(
        "App 展示／真實模式已改變，舊綜合健檢不可讀取或匯出。",
        { status: 409, code: "REPORT_MODE_CHANGED" },
      );
    }
    return job;
  }

  private async run(job: AuditSuiteRuntimeJob): Promise<void> {
    const runId = job.context.runId;
    if (this.flights.has(runId) || this.jobs.get(runId) !== job) return;
    const flight = Promise.all([
      this.runSection(job, "subscription", this.runners.subscription),
      this.runSection(job, "inventory", this.runners.inventory),
      this.runSection(job, "content", this.runners.content),
      this.runSection(job, "image", this.runners.image),
      this.runSection(job, "variation", this.runners.variation),
      this.runSection(job, "review", this.runners.review),
      this.runSection(job, "advertising", this.runners.advertising),
    ]).then(() => undefined).finally(() => {
      job.resources.clear();
      if (this.flights.get(runId) === flight) this.flights.delete(runId);
      this.scheduleTerminalExpiry(job);
    });
    this.flights.set(runId, flight);
    await flight;
  }

  private async runSection<K extends AuditSuiteSectionId>(
    job: AuditSuiteRuntimeJob,
    id: K,
    runner: (
      context: AuditSuiteContext,
      control: AuditSuiteRunControl,
    ) => Promise<SnapshotFor<K>>,
  ): Promise<void> {
    if (this.jobs.get(job.context.runId) !== job) return;
    this.updateProgress(job, id, "running", "main process 正在執行唯讀健檢。", 0, 1);
    const control = this.control(job, id);
    let snapshot: SnapshotFor<K>;
    try {
      snapshot = await runner({ ...job.context }, control);
      if (
        snapshot.runId !== job.context.runId ||
        snapshot.marketplaceId !== job.context.marketplaceId ||
        snapshot.accountScope !== job.context.accountScope ||
        snapshot.mode !== job.context.mode
      ) {
        throw new Error(`${id} 健檢回傳 context 不一致。`);
      }
    } catch (error) {
      snapshot = {
        ...job.context,
        status: "failed",
        fetchedAt: null,
        notice: safeFailureNotice(error),
        payload: null,
      } as SnapshotFor<K>;
    }
    if (this.jobs.get(job.context.runId) !== job) return;
    job.snapshots[id] = snapshot;
    const current = job.progress[id];
    const completedUnits = snapshot.status === "failed"
      ? current.completedUnits
      : current.totalUnits ?? 1;
    const totalUnits = snapshot.status === "failed"
      ? current.totalUnits
      : current.totalUnits ?? 1;
    this.updateProgress(
      job,
      id,
      snapshot.status,
      snapshot.notice,
      completedUnits,
      totalUnits,
    );
  }

  private control(
    job: AuditSuiteRuntimeJob,
    id: AuditSuiteSectionId,
  ): AuditSuiteRunControl {
    return Object.freeze({
      signal: job.controller.signal,
      heartbeat: (update?: AuditSuiteHeartbeat) => {
        this.assertActive(job);
        const current = job.progress[id];
        if (current.status !== "running") {
          throw new Error(`${id} 健檢已結束，不能再回報進度。`);
        }
        const completedUnits = update?.completedUnits === undefined
          ? current.completedUnits
          : update.completedUnits;
        const totalUnits = update?.totalUnits === undefined
          ? current.totalUnits
          : update.totalUnits;
        if (
          (completedUnits !== null && (!Number.isSafeInteger(completedUnits) || completedUnits < 0)) ||
          (totalUnits !== null && (!Number.isSafeInteger(totalUnits) || totalUnits < 0)) ||
          ((completedUnits === null) !== (totalUnits === null)) ||
          (completedUnits !== null && totalUnits !== null && completedUnits > totalUnits) ||
          (current.completedUnits !== null && completedUnits !== null &&
            completedUnits < current.completedUnits)
        ) {
          throw new Error(`${id} 健檢回報了無效或倒退的進度。`);
        }
        this.updateProgress(
          job,
          id,
          "running",
          update?.message === undefined ? current.message : safeFailureNotice(update.message),
          completedUnits,
          totalUnits,
        );
      },
      resource: <T>(key: AuditSuiteResourceKey<T>, load: () => Promise<T>) =>
        this.resource(job, key, load),
    });
  }

  private resource<T>(
    job: AuditSuiteRuntimeJob,
    key: AuditSuiteResourceKey<T>,
    load: () => Promise<T>,
  ): Promise<T> {
    this.assertActive(job);
    const existing = job.resources.get(key.token);
    if (existing) return existing as Promise<T>;
    const resource = Promise.resolve().then(async () => {
      this.assertActive(job);
      const value = await load();
      this.assertActive(job);
      return value;
    });
    job.resources.set(key.token, resource);
    return resource;
  }

  private assertActive(job: AuditSuiteRuntimeJob): void {
    if (this.jobs.get(job.context.runId) !== job || job.controller.signal.aborted) {
      throw new Error("綜合健檢工作已停止，晚到結果不會寫回。");
    }
  }

  private updateProgress(
    job: AuditSuiteRuntimeJob,
    id: AuditSuiteSectionId,
    status: AuditSuiteSectionProgress["status"],
    message: string,
    completedUnits: number | null,
    totalUnits: number | null,
  ): void {
    const updatedAt = new Date().toISOString();
    job.progress[id] = {
      id,
      status,
      message,
      completedUnits,
      totalUnits,
      updatedAt,
    };
    job.updatedAt = updatedAt;
    job.expiresAt = Date.now() + this.ttlMs;
  }

  private dto(job: AuditSuiteRuntimeJob): AuditSuiteRunDto {
    return {
      schemaVersion: AUDIT_SUITE_SCHEMA_VERSION,
      runId: job.context.runId,
      contextId: job.contextId,
      marketplaceId: job.context.marketplaceId,
      mode: job.context.mode,
      status: aggregateStatus(job.progress),
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      sections: structuredClone(job.progress),
    };
  }

  private prune(now = Date.now()): void {
    for (const [runId, job] of this.jobs) {
      if (terminal(aggregateStatus(job.progress)) && job.expiresAt <= now) {
        this.deleteJob(runId);
      }
    }
  }

  private scheduleTerminalExpiry(job: AuditSuiteRuntimeJob): void {
    const runId = job.context.runId;
    if (
      this.jobs.get(runId) !== job ||
      !terminal(aggregateStatus(job.progress))
    ) {
      return;
    }
    const existing = this.timers.get(runId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(runId);
      if (
        this.jobs.get(runId) === job &&
        terminal(aggregateStatus(job.progress)) &&
        job.expiresAt <= Date.now()
      ) {
        this.deleteJob(runId);
      } else {
        this.scheduleTerminalExpiry(job);
      }
    }, Math.max(0, job.expiresAt - Date.now()));
    timer.unref?.();
    this.timers.set(runId, timer);
  }

  private deleteJob(runId: string): void {
    const timer = this.timers.get(runId);
    if (timer) clearTimeout(timer);
    this.timers.delete(runId);
    const job = this.jobs.get(runId);
    this.jobs.delete(runId);
    if (job) {
      job.controller.abort();
      job.resources.clear();
    }
    this.flights.delete(runId);
  }
}
