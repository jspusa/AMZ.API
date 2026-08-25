import { parseAdvertisingCoverageSnapshot } from "./advertising-coverage";
import { parseBusinessPricingAuditSnapshot } from "./business-pricing-audit";
import { parseImageAuditSnapshot } from "./image-audit";
import { parseSubscriptionAuditSnapshot } from "./subscription-audit";
import { parseUnboundVariationAuditSnapshot } from "./unbound-variation-audit";

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
export type StandaloneAuditMode = "live" | "demo";
export type StandaloneAuditOptions = Readonly<{ months?: 6 | 12 | 23 }>;
export type StandaloneAuditProgress = Readonly<{
  stage: string;
  message: string;
  completedUnits: number | null;
  totalUnits: number | null;
}>;

type JobBase = Readonly<{
  jobId: string;
  contextId: string;
  kind: StandaloneAuditKind;
  marketplaceId: string;
  mode: StandaloneAuditMode;
  options: StandaloneAuditOptions;
  progress: StandaloneAuditProgress;
}>;

export type StandaloneAuditPendingJob = JobBase & Readonly<{
  ready: false;
  status: "queued" | "running";
}>;

export type StandaloneAuditCompletedJob = JobBase & Readonly<{
  ready: true;
  status: "completed";
  snapshot: unknown;
}>;

export type StandaloneAuditFailedJob = JobBase & Readonly<{
  ready: true;
  status: "failed" | "aborted";
  error: Readonly<{ code: string; message: string }>;
}>;

export type StandaloneAuditJob =
  | StandaloneAuditPendingJob
  | StandaloneAuditCompletedJob
  | StandaloneAuditFailedJob;

export type StandaloneAuditExpectation = Readonly<{
  kind: StandaloneAuditKind;
  marketplaceId: string;
  mode: StandaloneAuditMode;
  jobId?: string;
  contextId?: string;
}>;

type StandaloneAuditRequest = (input: Readonly<{
  method: "GET";
  path: string;
  query: Record<string, string>;
  signal?: AbortSignal;
}>) => Promise<unknown>;

class StandaloneAuditRequestError extends Error {
  readonly transient: boolean;

  constructor(message: string, transient: boolean) {
    super(message);
    this.name = "StandaloneAuditRequestError";
    this.transient = transient;
  }
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isTransientObserverError(error: unknown): boolean {
  if (error instanceof StandaloneAuditRequestError) return error.transient;
  // Fetch transport failures are TypeError in browsers/Electron. Unknown
  // application errors are not retried forever by the home observer.
  return error instanceof TypeError;
}

async function requestJson(input: Readonly<{
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}>): Promise<unknown> {
  const query = input.query
    ? `?${new URLSearchParams(input.query).toString()}`
    : "";
  const response = await fetch(`${input.path}${query}`, {
    method: input.method,
    cache: "no-store",
    signal: input.signal,
    ...(input.body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        }
      : {}),
  });
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new StandaloneAuditRequestError(
      "單項健檢工作回應不是可驗證的 JSON。",
      false,
    );
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new StandaloneAuditRequestError(
        "Notebook Key 版本過舊，請先更新 AMZ.API App 後再開始背景健檢。",
        false,
      );
    }
    const message = payload && typeof payload === "object" && !Array.isArray(payload) &&
        typeof (payload as { message?: unknown }).message === "string"
      ? String((payload as { message: string }).message)
      : "目前無法讀取單項健檢工作。";
    throw new StandaloneAuditRequestError(
      message,
      isTransientStatus(response.status),
    );
  }
  return payload;
}

export async function startStandaloneAuditJob(input: Readonly<{
  kind: StandaloneAuditKind;
  marketplaceId: string;
  mode: StandaloneAuditMode;
  options?: StandaloneAuditOptions;
  signal?: AbortSignal;
  request?: (input: Readonly<{
    method: "POST";
    path: string;
    body: Record<string, unknown>;
    signal?: AbortSignal;
  }>) => Promise<unknown>;
}>): Promise<StandaloneAuditJob> {
  const request = input.request ?? requestJson;
  const payload = await request({
    method: "POST",
    path: "/api/sp-api/standalone-audit",
    body: {
      kind: input.kind,
      marketplaceId: input.marketplaceId,
      mode: input.mode,
      ...(input.options ? { options: input.options } : {}),
    },
    signal: input.signal,
  });
  return parseStandaloneAuditJob(payload, {
    kind: input.kind,
    marketplaceId: input.marketplaceId,
    mode: input.mode,
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}格式無效。`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  source: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(source).length !== keys.length ||
    Object.keys(source).some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label}欄位無效。`);
  }
}

function exactText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  ) {
    throw new Error(`單項健檢的${label}無法安全辨識。`);
  }
  return value;
}

function countOrNull(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 1_000_000
  ) {
    throw new Error(`單項健檢的${label}進度無效。`);
  }
  return Number(value);
}

function parseOptions(
  value: unknown,
  kind: StandaloneAuditKind,
): StandaloneAuditOptions {
  const source = record(value, "單項健檢選項");
  if (kind !== "subscription") {
    exactKeys(source, [], "單項健檢選項");
    return {};
  }
  if (Object.keys(source).some((key) => key !== "months")) {
    throw new Error("單項健檢選項欄位無效。");
  }
  if (source.months === undefined) return {};
  if (source.months !== 6 && source.months !== 12 && source.months !== 23) {
    throw new Error("單項健檢 S&S 月數無效。");
  }
  return { months: source.months };
}

function parseProgress(value: unknown): StandaloneAuditProgress {
  const source = record(value, "單項健檢進度");
  exactKeys(source, [
    "stage",
    "message",
    "completedUnits",
    "totalUnits",
  ], "單項健檢進度");
  const stage = exactText(source.stage, "進度階段", 64);
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(stage)) {
    throw new Error("單項健檢進度階段無效。");
  }
  const completedUnits = countOrNull(source.completedUnits, "已完成");
  const totalUnits = countOrNull(source.totalUnits, "總數");
  if (
    completedUnits !== null &&
    totalUnits !== null &&
    completedUnits > totalUnits
  ) {
    throw new Error("單項健檢進度計數矛盾。");
  }
  return {
    stage,
    message: exactText(source.message, "進度訊息", 160),
    completedUnits,
    totalUnits,
  };
}

function isAuditKind(value: unknown): value is StandaloneAuditKind {
  return typeof value === "string" &&
    (STANDALONE_AUDIT_KINDS as readonly string[]).includes(value);
}

export function parseStandaloneAuditJob(
  value: unknown,
  expected: StandaloneAuditExpectation,
): StandaloneAuditJob {
  const source = record(value, "單項健檢工作");
  if (!isAuditKind(source.kind) || source.kind !== expected.kind) {
    throw new Error("單項健檢工作種類不一致。");
  }
  if (source.marketplaceId !== expected.marketplaceId) {
    throw new Error("單項健檢工作與目前站點不一致。");
  }
  if (source.mode !== expected.mode) {
    throw new Error("單項健檢工作與目前模式不一致。");
  }
  const jobId = exactText(source.jobId, "job ID", 64);
  const contextId = exactText(source.contextId, "context ID", 64);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(jobId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(contextId)
  ) {
    throw new Error("單項健檢工作識別碼無效。");
  }
  if (
    (expected.jobId !== undefined && jobId !== expected.jobId) ||
    (expected.contextId !== undefined && contextId !== expected.contextId)
  ) {
    throw new Error("單項健檢工作 context 不一致。");
  }
  const base = {
    jobId,
    contextId,
    kind: source.kind,
    marketplaceId: expected.marketplaceId,
    mode: expected.mode,
    options: parseOptions(source.options, source.kind),
    progress: parseProgress(source.progress),
  } as const;

  if (
    source.ready === false &&
    (source.status === "queued" || source.status === "running")
  ) {
    exactKeys(source, [
      "jobId",
      "contextId",
      "kind",
      "marketplaceId",
      "mode",
      "options",
      "ready",
      "status",
      "progress",
    ], "單項健檢工作");
    return { ...base, ready: false, status: source.status };
  }
  if (source.ready === true && source.status === "completed") {
    exactKeys(source, [
      "jobId",
      "contextId",
      "kind",
      "marketplaceId",
      "mode",
      "options",
      "ready",
      "status",
      "progress",
      "snapshot",
    ], "單項健檢工作");
    return {
      ...base,
      ready: true,
      status: "completed",
      snapshot: structuredClone(source.snapshot),
    };
  }
  if (
    source.ready === true &&
    (source.status === "failed" || source.status === "aborted")
  ) {
    exactKeys(source, [
      "jobId",
      "contextId",
      "kind",
      "marketplaceId",
      "mode",
      "options",
      "ready",
      "status",
      "progress",
      "error",
    ], "單項健檢工作");
    const error = record(source.error, "單項健檢錯誤");
    exactKeys(error, ["code", "message"], "單項健檢錯誤");
    return {
      ...base,
      ready: true,
      status: source.status,
      error: {
        code: exactText(error.code, "錯誤碼", 80),
        message: exactText(error.message, "錯誤訊息", 200),
      },
    };
  }
  throw new Error("單項健檢工作狀態無效。");
}

export function standaloneAuditSnapshotMatchesJob(
  snapshot: Readonly<{
    fetchedAt: string;
    marketplaceId: string;
    exportId?: string;
    mode?: StandaloneAuditMode;
  }> | null,
  job: StandaloneAuditJob | null,
): boolean {
  if (!job) return false;
  if (!job.ready || job.status !== "completed") return false;
  const value = job.snapshot;
  const owned = value && typeof value === "object" && !Array.isArray(value)
    ? value as {
        fetchedAt?: unknown;
        marketplaceId?: unknown;
        exportId?: unknown;
        mode?: unknown;
      }
    : null;
  const cachedExportId = snapshot?.exportId;
  const ownedExportId = owned?.exportId;
  const exportIdRequired = job.kind === "content" ||
    job.kind === "image" ||
    job.kind === "variation";
  const exportIdMatches = exportIdRequired
    ? typeof cachedExportId === "string" &&
      typeof ownedExportId === "string" &&
      cachedExportId === ownedExportId
    : cachedExportId === undefined ||
      ownedExportId === undefined ||
      typeof cachedExportId === "string" &&
        typeof ownedExportId === "string" &&
        cachedExportId === ownedExportId;
  return Boolean(
    snapshot &&
    owned &&
    typeof owned.fetchedAt === "string" &&
    typeof owned.marketplaceId === "string" &&
    snapshot.marketplaceId === job.marketplaceId &&
    owned.marketplaceId === job.marketplaceId &&
    snapshot.fetchedAt === owned.fetchedAt &&
    (snapshot.mode === undefined || snapshot.mode === job.mode) &&
    (owned.mode === undefined || owned.mode === job.mode) &&
    exportIdMatches
  );
}

export function mergeAuditJobObservation<
  TCurrent extends Readonly<{
    jobId: string;
    contextId: string;
    ready: boolean;
  }>,
  TIncoming extends Readonly<{
    jobId: string;
    contextId: string;
    ready: boolean;
  }>,
>(
  current: TCurrent | undefined,
  incoming: TIncoming,
): TCurrent | TIncoming {
  return current?.ready &&
      current.jobId === incoming.jobId &&
      current.contextId === incoming.contextId
    ? current
    : incoming;
}

export function standaloneAuditReconnectRevision(
  job: StandaloneAuditJob | null,
): string {
  return job
    ? `${job.jobId}\u0000${job.contextId}\u0000${job.ready ? "terminal" : "pending"}`
    : "";
}

export function shouldResumeStandaloneAuditJob(input: Readonly<{
  initialJob: StandaloneAuditJob | null;
  expectedKind: StandaloneAuditKind;
  marketplaceId: string;
  mode: StandaloneAuditMode;
  observerJobId: string | null;
}>): boolean {
  const { initialJob } = input;
  return Boolean(
    initialJob &&
    initialJob.kind === input.expectedKind &&
    initialJob.marketplaceId === input.marketplaceId &&
    initialJob.mode === input.mode &&
    (initialJob.ready || input.observerJobId !== initialJob.jobId),
  );
}

function abortError(): Error {
  const error = new Error("單項健檢畫面觀察已停止；Notebook 鑰匙背景工作仍會繼續。");
  error.name = "AbortError";
  return error;
}

export async function pollStandaloneAuditJob(input: Readonly<{
  request?: StandaloneAuditRequest;
  expected: StandaloneAuditJob;
  signal?: AbortSignal;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onProgress?: (job: StandaloneAuditJob) => void;
  maxConsecutiveTransientFailures?: number | null;
}>): Promise<StandaloneAuditJob> {
  const wait = input.wait ?? (async (delayMs, signal) => {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const onTimeout = () => {
        timer = null;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        cleanup();
        reject(abortError());
      };
      timer = setTimeout(onTimeout, delayMs);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  });
  const maxConsecutiveTransientFailures =
    input.maxConsecutiveTransientFailures === undefined
      ? 2
      : input.maxConsecutiveTransientFailures;
  let current = input.expected;
  let observerFailures = 0;
  while (!current.ready) {
    if (input.signal?.aborted) throw abortError();
    let value: unknown;
    try {
      value = await (input.request ?? requestJson)({
        method: "GET",
        path: "/api/sp-api/standalone-audit",
        query: {
          jobId: current.jobId,
          contextId: current.contextId,
          kind: current.kind,
          marketplaceId: current.marketplaceId,
          mode: current.mode,
        },
        signal: input.signal,
      });
    } catch (error) {
      if (
        input.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) throw abortError();
      if (!isTransientObserverError(error)) throw error;
      observerFailures += 1;
      if (
        maxConsecutiveTransientFailures !== null &&
        observerFailures > maxConsecutiveTransientFailures
      ) throw error;
      const delay = Math.min(
        30_000,
        1_500 * (2 ** Math.min(5, observerFailures - 1)),
      );
      await wait(delay, input.signal);
      continue;
    }
    current = parseStandaloneAuditJob(value, {
      kind: current.kind,
      marketplaceId: current.marketplaceId,
      mode: current.mode,
      jobId: current.jobId,
      contextId: current.contextId,
    });
    observerFailures = 0;
    input.onProgress?.(current);
    if (!current.ready) await wait(750, input.signal);
  }
  return current;
}

/**
 * Observes an already-created main-process job from Dashboard. This path only
 * issues fenced status GETs. Transient transport/429/5xx failures keep the
 * observer alive with bounded backoff; permanent expiry/context responses and
 * invalid contracts still stop immediately.
 */
export async function observeStandaloneAuditJob(input: Readonly<{
  request?: StandaloneAuditRequest;
  expected: StandaloneAuditJob;
  signal?: AbortSignal;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onProgress?: (job: StandaloneAuditJob) => void;
}>): Promise<StandaloneAuditJob> {
  return pollStandaloneAuditJob({
    ...input,
    maxConsecutiveTransientFailures: null,
  });
}

export function standaloneAuditHomeProgress(job: StandaloneAuditJob): Readonly<{
  active: boolean;
  label: string;
  completedUnits: number | null;
  totalUnits: number | null;
}> {
  return {
    active: !job.ready,
    label: job.progress.message,
    completedUnits: job.progress.completedUnits,
    totalUnits: job.progress.totalUnits,
  };
}

export type StandaloneAuditTerminalOutcome =
  | "success"
  | "partial"
  | "failed";

function contentTerminalOutcome(
  value: unknown,
  marketplaceId: string,
): StandaloneAuditTerminalOutcome {
  const snapshot = record(value, "文案健檢快照");
  const summary = record(snapshot.summary, "文案健檢摘要");
  if (
    snapshot.marketplaceId !== marketplaceId ||
    typeof snapshot.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.fetchedAt)) ||
    typeof snapshot.exportId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      snapshot.exportId,
    ) ||
    !Array.isArray(snapshot.rows)
  ) {
    return "partial";
  }
  const total = countOrNull(summary.total, "文案商品總數");
  const completed = countOrNull(summary.completed, "文案完成數");
  const incomplete = countOrNull(summary.incomplete, "文案未完成數");
  if (
    total === null ||
    completed === null ||
    incomplete === null ||
    total !== snapshot.rows.length ||
    completed + incomplete !== total
  ) {
    return "partial";
  }
  return incomplete > 0 ? "partial" : "success";
}

/**
 * Keeps the home card honest before its drawer caches the terminal snapshot.
 * A completed transport job is only "success" after the audit-specific parser
 * accepts the complete payload; unknown or malformed shapes remain partial.
 */
export function standaloneAuditTerminalOutcome(
  job: StandaloneAuditJob,
): StandaloneAuditTerminalOutcome | null {
  if (!job.ready) return null;
  if (job.status !== "completed") return "failed";
  try {
    if (job.kind === "content") {
      return contentTerminalOutcome(job.snapshot, job.marketplaceId);
    }
    if (job.kind === "agedInventory") {
      // Aged inventory is outside the seven-card run-all flow and parses in drawer.
      return "partial";
    }
    if (job.kind === "image") {
      const snapshot = parseImageAuditSnapshot(job.snapshot, job.marketplaceId);
      return snapshot.summary.incomplete > 0 ? "partial" : "success";
    }
    if (job.kind === "variation") {
      const snapshot = parseUnboundVariationAuditSnapshot(
        job.snapshot,
        job.marketplaceId,
      );
      if (snapshot.mode !== job.mode) return "partial";
      return snapshot.summary.incomplete > 0 ? "partial" : "success";
    }
    if (job.kind === "subscription") {
      const snapshot = parseSubscriptionAuditSnapshot(job.snapshot);
      if (
        snapshot.marketplaceId !== job.marketplaceId ||
        snapshot.mode !== job.mode ||
        snapshot.requestedMonths !== job.options.months
      ) {
        return "partial";
      }
      return snapshot.inventoryEvidence.coverage === "complete" &&
          snapshot.upstreamCoverage.status === "complete" &&
          snapshot.summary.revenueCoverage.status === "complete"
        ? "success"
        : "partial";
    }
    if (job.kind === "businessPricing") {
      const snapshot = parseBusinessPricingAuditSnapshot(job.snapshot);
      if (
        snapshot.marketplaceId !== job.marketplaceId ||
        snapshot.mode !== job.mode
      ) {
        return "partial";
      }
      return snapshot.summary.incomplete > 0 ? "partial" : "success";
    }
    if (job.kind === "advertising") {
      const snapshot = parseAdvertisingCoverageSnapshot(
        job.snapshot,
        job.marketplaceId,
      );
      return snapshot.mode === job.mode ? "success" : "partial";
    }
  } catch {
    return "partial";
  }
  return "partial";
}
