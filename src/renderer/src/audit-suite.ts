import {
  AUDIT_SUITE_SCHEMA_VERSION,
  AUDIT_SUITE_SECTION_IDS,
  type AuditSuiteExpectedContext,
  type AuditSuiteRun,
  type AuditSuiteRunDto,
  type AuditSuiteRunStatus,
  type AuditSuiteSectionProgress,
  type AuditSuiteState,
} from "../../shared/audit-suite";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,200}$/u;
const MARKETPLACE_PATTERN = /^[A-Z0-9]{8,32}$/u;
const CONTEXT_ID_PATTERN = /^[A-Za-z0-9-]{16,100}$/u;
const RUN_STATUSES: readonly AuditSuiteRunStatus[] = [
  "queued", "running", "completed", "partial", "failed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validDate(value: string, label: string): number {
  const time = new Date(value).getTime();
  if (!value || !Number.isFinite(time)) throw new Error(`${label}無效。`);
  return time;
}

function assertContext(
  run: AuditSuiteRunDto,
  expected: AuditSuiteExpectedContext,
): void {
  if (!IDENTIFIER_PATTERN.test(run.runId)) throw new Error("綜合健檢 runId 無效。");
  if (!MARKETPLACE_PATTERN.test(run.marketplaceId)) {
    throw new Error("綜合健檢 marketplaceId 無效。");
  }
  if (!CONTEXT_ID_PATTERN.test(run.contextId)) {
    throw new Error("綜合健檢 contextId 無效。");
  }
  if (run.runId !== expected.runId) throw new Error("綜合健檢 runId 不一致，已停止顯示。");
  if (run.marketplaceId !== expected.marketplaceId) {
    throw new Error("綜合健檢站點不一致，已停止顯示。");
  }
  if (run.contextId !== expected.contextId) {
    throw new Error("綜合健檢 contextId 不一致，已停止顯示。");
  }
  if (run.mode !== expected.mode) {
    throw new Error("App 展示／真實模式已改變，舊綜合健檢不可顯示。");
  }
}

function derivedRunStatus(
  sections: readonly AuditSuiteSectionProgress[],
): AuditSuiteRunStatus {
  const statuses = sections.map((section) => section.status);
  if (statuses.every((status) => status === "queued")) return "queued";
  if (statuses.some((status) => status === "queued" || status === "running")) {
    return "running";
  }
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.every((status) => status === "failed")) return "failed";
  return "partial";
}

function validateSection(
  section: AuditSuiteSectionProgress,
  startedAt: number,
  updatedAt: number,
): AuditSuiteSectionProgress {
  if (!RUN_STATUSES.includes(section.status)) {
    throw new Error(`${section.id} 健檢狀態無效。`);
  }
  if (!AUDIT_SUITE_SECTION_IDS.includes(section.id)) {
    throw new Error("綜合健檢含有未知項目。");
  }
  if (!section.message.trim() || section.message.length > 2_000) {
    throw new Error(`${section.id} 健檢狀態說明無效。`);
  }
  const sectionUpdatedAt = validDate(section.updatedAt, `${section.id} 更新時間`);
  if (sectionUpdatedAt < startedAt || sectionUpdatedAt > updatedAt) {
    throw new Error(`${section.id} 健檢時間不在本次執行範圍內。`);
  }
  const counts = [section.completedUnits, section.totalUnits];
  if (counts.some((count) => count !== null && (!Number.isInteger(count) || count < 0))) {
    throw new Error(`${section.id} 健檢進度必須是非負整數或未知。`);
  }
  if ((section.completedUnits === null) !== (section.totalUnits === null)) {
    throw new Error(`${section.id} 健檢進度不可只提供分子或分母。`);
  }
  if (
    section.completedUnits !== null &&
    section.totalUnits !== null &&
    section.completedUnits > section.totalUnits
  ) {
    throw new Error(`${section.id} 健檢進度超過總數。`);
  }
  return Object.freeze({ ...section });
}

function parseSection(
  input: unknown,
  id: (typeof AUDIT_SUITE_SECTION_IDS)[number],
  startedAt: number,
  updatedAt: number,
): AuditSuiteSectionProgress {
  if (!isRecord(input) || input.id !== id || typeof input.status !== "string" ||
    typeof input.message !== "string" || typeof input.updatedAt !== "string") {
    throw new Error(`${id} 健檢項目格式無效。`);
  }
  const completedUnits = input.completedUnits;
  const totalUnits = input.totalUnits;
  if (
    (completedUnits !== null && typeof completedUnits !== "number") ||
    (totalUnits !== null && typeof totalUnits !== "number")
  ) {
    throw new Error(`${id} 健檢進度格式無效。`);
  }
  return validateSection({
    id,
    status: input.status as AuditSuiteSectionProgress["status"],
    message: input.message,
    completedUnits,
    totalUnits,
    updatedAt: input.updatedAt,
  }, startedAt, updatedAt);
}

export function parseAuditSuiteRun(
  input: unknown,
  expected: AuditSuiteExpectedContext,
): AuditSuiteRun {
  if (!isRecord(input)) throw new Error("綜合健檢回應格式無效。");
  const allowedRootKeys = [
    "schemaVersion", "runId", "contextId", "marketplaceId", "mode", "status",
    "startedAt", "updatedAt", "sections",
  ];
  if (Object.keys(input).some((key) => !allowedRootKeys.includes(key))) {
    throw new Error("綜合健檢回應含有未允許欄位，已停止顯示。");
  }
  if (input.schemaVersion !== AUDIT_SUITE_SCHEMA_VERSION) {
    if (input.schemaVersion === 2) {
      throw new Error(
        "目前 Notebook Key 仍是舊版五項健檢合約；請更新 AMZ.API Notebook Key 後再執行七項健檢。",
      );
    }
    throw new Error("綜合健檢版本不相容，請更新 AMZ.API Notebook Key 後再試。");
  }
  if (
    typeof input.runId !== "string" ||
    typeof input.contextId !== "string" ||
    typeof input.marketplaceId !== "string" ||
    (input.mode !== "live" && input.mode !== "demo") ||
    typeof input.status !== "string" ||
    typeof input.startedAt !== "string" ||
    typeof input.updatedAt !== "string" ||
    !isRecord(input.sections)
  ) {
    throw new Error("綜合健檢根層欄位格式無效。");
  }
  const rawSections = input.sections as Record<string, unknown>;
  if (!RUN_STATUSES.includes(input.status as AuditSuiteRunStatus)) {
    throw new Error("綜合健檢總狀態無效。");
  }
  const candidate = input as unknown as AuditSuiteRunDto;
  assertContext(candidate, expected);
  const startedAt = validDate(input.startedAt, "綜合健檢開始時間");
  const updatedAt = validDate(input.updatedAt, "綜合健檢更新時間");
  if (updatedAt < startedAt) throw new Error("綜合健檢更新時間早於開始時間。");

  const sectionKeys = Object.keys(rawSections).sort();
  const expectedKeys = [...AUDIT_SUITE_SECTION_IDS].sort();
  if (JSON.stringify(sectionKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error("綜合健檢項目不完整，已停止顯示。");
  }
  const sections = Object.fromEntries(
    AUDIT_SUITE_SECTION_IDS.map((id) => {
      const section = rawSections[id];
      return [id, parseSection(section, id, startedAt, updatedAt)];
    }),
  ) as Record<(typeof AUDIT_SUITE_SECTION_IDS)[number], AuditSuiteSectionProgress>;

  const derived = derivedRunStatus(Object.values(sections));
  if (candidate.status !== derived) {
    throw new Error(`綜合健檢總狀態與各項狀態不一致；應為 ${derived}。`);
  }
  return Object.freeze({
    schemaVersion: AUDIT_SUITE_SCHEMA_VERSION,
    runId: candidate.runId,
    contextId: candidate.contextId,
    marketplaceId: candidate.marketplaceId,
    mode: candidate.mode,
    status: candidate.status,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    sections: Object.freeze(sections),
  });
}

const ALLOWED_TRANSITIONS: Readonly<Record<AuditSuiteRunStatus, readonly AuditSuiteRunStatus[]>> = {
  queued: ["queued", "running", "completed", "partial", "failed"],
  running: ["running", "completed", "partial", "failed"],
  completed: ["completed"],
  partial: ["partial"],
  failed: ["failed"],
};

function assertProgressDoesNotRegress(
  previous: AuditSuiteSectionProgress,
  next: AuditSuiteSectionProgress,
): void {
  if (!ALLOWED_TRANSITIONS[previous.status].includes(next.status)) {
    throw new Error(`${previous.id} 健檢狀態不可由 ${previous.status} 回退為 ${next.status}。`);
  }
  if (
    previous.completedUnits !== null &&
    next.completedUnits !== null &&
    next.completedUnits < previous.completedUnits
  ) {
    throw new Error(`${previous.id} 健檢完成進度不可倒退。`);
  }
}

export function createAuditSuiteState(initialRun?: AuditSuiteRun): AuditSuiteState {
  return Object.freeze({
    runsByMarketplace: Object.freeze(
      initialRun ? { [initialRun.marketplaceId]: initialRun } : {},
    ),
  });
}

export function storeAuditSuiteRun(
  state: AuditSuiteState,
  next: AuditSuiteRun,
): AuditSuiteState {
  const previous = state.runsByMarketplace[next.marketplaceId];
  if (previous) {
    if (
      previous.runId !== next.runId ||
      previous.contextId !== next.contextId ||
      previous.mode !== next.mode
    ) {
      throw new Error("綜合健檢 context 已改變；須明確開始新執行，不可覆蓋背景狀態。");
    }
    if (new Date(next.updatedAt).getTime() < new Date(previous.updatedAt).getTime()) {
      throw new Error("綜合健檢更新時間不可倒退。");
    }
    if (!ALLOWED_TRANSITIONS[previous.status].includes(next.status)) {
      throw new Error(`綜合健檢狀態不可由 ${previous.status} 回退為 ${next.status}。`);
    }
    for (const id of AUDIT_SUITE_SECTION_IDS) {
      assertProgressDoesNotRegress(previous.sections[id], next.sections[id]);
    }
  }
  return Object.freeze({
    runsByMarketplace: Object.freeze({
      ...state.runsByMarketplace,
      [next.marketplaceId]: next,
    }),
  });
}

export function replaceAuditSuiteRun(
  state: AuditSuiteState,
  next: AuditSuiteRun,
): AuditSuiteState {
  // This is the explicit-new-run path. The caller must pass a freshly parsed
  // POST response; unlike storeAuditSuiteRun, a new run/context/mode is
  // intentionally allowed to replace the prior run for this marketplace.
  return Object.freeze({
    runsByMarketplace: Object.freeze({
      ...state.runsByMarketplace,
      [next.marketplaceId]: next,
    }),
  });
}

export function auditSuiteRunForMarketplace(
  state: AuditSuiteState,
  marketplaceId: string,
): AuditSuiteRun | null {
  return state.runsByMarketplace[marketplaceId] ?? null;
}
