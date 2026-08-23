import {
  APLUS_AUDIT_MAX_PUBLIC_COUNT,
  APLUS_AUDIT_MAX_PUBLIC_LOCALES_PER_ASIN,
  isAplusLanguageTag,
} from "../../shared/a-plus";

export type AplusAuditStatus =
  | "published"
  | "missing"
  | "incomplete"
  | "unavailable";

export type AplusAuditReasonCode =
  | "PUBLISHED_RECORD_FOUND"
  | "NO_PUBLISHED_RECORD"
  | "FBA_IDENTITY_INCOMPLETE"
  | "FBA_RELATIONSHIP_INCOMPLETE"
  | "A_PLUS_ACCESS_UNAVAILABLE"
  | "A_PLUS_READ_FAILED"
  | "A_PLUS_WARNING_PRESENT"
  | "A_PLUS_RESPONSE_INVALID"
  | "A_PLUS_PAGINATION_INCOMPLETE";

export type AplusAuditFilter = "all" | "problem" | AplusAuditStatus;

export type AplusAuditRow = Readonly<{
  sellerSku: string;
  asin: string | null;
  title: string;
  marketplaceId: string;
  status: AplusAuditStatus;
  sourceCompleteness: "complete" | "partial";
  publishedRecordCount: number | null;
  contentTypes: readonly ("EBC" | "EMC")[];
  locales: readonly string[];
  reasonCode: AplusAuditReasonCode;
  reason: string;
}>;

export type AplusAuditSummary = Readonly<{
  eligibleFbaSkus: number;
  uniqueAsins: number;
  published: number;
  missing: number;
  incomplete: number;
  unavailable: number;
}>;

export type AplusAuditSnapshot = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  rows: readonly AplusAuditRow[];
  totals: AplusAuditSummary;
  summary: AplusAuditSummary;
  notice: string;
}>;

export type AplusAuditJobProgress = Readonly<{
  completedAsins: number;
  totalAsins: number;
}>;

export type AplusAuditJobReceipt = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  jobId: string;
  contextId: string;
  ready: false;
  status: "queued" | "running";
  progress: AplusAuditJobProgress;
}>;

export type AplusAuditJobExpectation = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  jobId?: string;
  contextId?: string;
}>;

export type AplusAuditJobCompletion = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  jobId: string;
  contextId: string;
  ready: true;
  status: "completed";
  progress: AplusAuditJobProgress;
  snapshot: AplusAuditSnapshot;
}>;

export type AplusAuditJobFailure = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  jobId: string;
  contextId: string;
  ready: true;
  status: "failed" | "aborted";
  progress: AplusAuditJobProgress;
  error: Readonly<{
    code: string;
    message: string;
  }>;
}>;

export type AplusAuditJobTerminal =
  | AplusAuditJobCompletion
  | AplusAuditJobFailure;

function record(value: unknown, label = "A+ 健檢資料"): Record<string, unknown> {
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
    throw new Error(`A+ 健檢的${label}無法安全辨識。`);
  }
  return value;
}

function displayText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.includes("\u0000")
  ) {
    throw new Error(`A+ 健檢的${label}無法安全顯示。`);
  }
  return value;
}

function count(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > APLUS_AUDIT_MAX_PUBLIC_COUNT
  ) {
    throw new Error(`A+ 健檢的${label}摘要無效。`);
  }
  return Number(value);
}

function stringList(
  value: unknown,
  label: string,
  maximum: number,
  validate: (candidate: string) => boolean,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum
  ) {
    throw new Error(`A+ 健檢的${label}無效。`);
  }
  const result = value.map((candidate) => {
    const parsed = exactText(candidate, label, 64);
    if (!validate(parsed)) throw new Error(`A+ 健檢的${label}無效。`);
    return parsed;
  });
  if (new Set(result).size !== result.length) {
    throw new Error(`A+ 健檢的${label}含有重複值。`);
  }
  const sorted = [...result].sort((left, right) => left.localeCompare(right));
  if (result.some((value, index) => value !== sorted[index])) {
    throw new Error(`A+ 健檢的${label}順序無法安全核對。`);
  }
  return result;
}

function parseRow(value: unknown, marketplaceId: string): AplusAuditRow {
  const source = record(value, "A+ 健檢商品列");
  const rowKeys = [
    "sellerSku",
    "asin",
    "title",
    "marketplaceId",
    "status",
    "sourceCompleteness",
    "publishedRecordCount",
    "contentTypes",
    "locales",
    "reasonCode",
    "reason",
  ] as const;
  const keys = source.fromTheBrandStatus === "not_verifiable_by_public_api"
    ? [...rowKeys, "fromTheBrandStatus"]
    : rowKeys;
  exactKeys(source, keys, "A+ 健檢商品列");
  const status = source.status;
  if (
    status !== "published" &&
    status !== "missing" &&
    status !== "incomplete" &&
    status !== "unavailable"
  ) {
    throw new Error("A+ 健檢商品列狀態無效。");
  }
  if (source.marketplaceId !== marketplaceId) {
    throw new Error("A+ 健檢商品列與目前站點不一致。");
  }
  const asin = source.asin === null
    ? null
    : exactText(source.asin, "ASIN", 10);
  if (asin !== null && !/^[A-Z0-9]{10}$/u.test(asin)) {
    throw new Error("A+ 健檢的 ASIN 無法安全辨識。");
  }
  const sourceCompleteness = source.sourceCompleteness;
  if (sourceCompleteness !== "complete" && sourceCompleteness !== "partial") {
    throw new Error("A+ 健檢來源完整度無效。");
  }
  const publishedRecordCount = source.publishedRecordCount === null
    ? null
    : count(source.publishedRecordCount, "已發布 record");
  const contentTypes = stringList(
    source.contentTypes,
    "A+ 類型",
    2,
    (candidate) => candidate === "EBC" || candidate === "EMC",
  ) as Array<"EBC" | "EMC">;
  const locales = stringList(
    source.locales,
    "A+ 語系",
    APLUS_AUDIT_MAX_PUBLIC_LOCALES_PER_ASIN,
    isAplusLanguageTag,
  );
  const reasonCode = source.reasonCode;
  const reasonsByStatus: Record<AplusAuditStatus, readonly AplusAuditReasonCode[]> = {
    published: ["PUBLISHED_RECORD_FOUND"],
    missing: ["NO_PUBLISHED_RECORD"],
    incomplete: [
      "FBA_IDENTITY_INCOMPLETE",
      "FBA_RELATIONSHIP_INCOMPLETE",
      "A_PLUS_READ_FAILED",
      "A_PLUS_WARNING_PRESENT",
      "A_PLUS_RESPONSE_INVALID",
      "A_PLUS_PAGINATION_INCOMPLETE",
    ],
    unavailable: ["A_PLUS_ACCESS_UNAVAILABLE"],
  };
  if (!reasonsByStatus[status].includes(reasonCode as AplusAuditReasonCode)) {
    throw new Error("A+ 健檢狀態與原因碼不一致。");
  }
  if (
    (status === "published" && (
      !asin ||
      contentTypes.length === 0 ||
      locales.length === 0 ||
      (sourceCompleteness === "complete"
        ? publishedRecordCount === null || publishedRecordCount < 1
        : publishedRecordCount !== null)
    )) ||
    (status === "missing" && (
      !asin ||
      sourceCompleteness !== "complete" ||
      publishedRecordCount !== 0 ||
      contentTypes.length > 0 ||
      locales.length > 0
    )) ||
    ((status === "incomplete" || status === "unavailable") && (
      sourceCompleteness !== "partial" ||
      publishedRecordCount !== null ||
      contentTypes.length > 0 ||
      locales.length > 0
    ))
  ) {
    throw new Error("A+ 健檢狀態、完整度與 publish-record 證據不一致。");
  }
  if (
    ((reasonCode === "FBA_IDENTITY_INCOMPLETE" ||
      reasonCode === "FBA_RELATIONSHIP_INCOMPLETE") && asin !== null) ||
    (status === "incomplete" &&
      reasonCode !== "FBA_IDENTITY_INCOMPLETE" &&
      reasonCode !== "FBA_RELATIONSHIP_INCOMPLETE" &&
      asin === null) ||
    (status === "unavailable" && asin === null)
  ) {
    throw new Error("A+ 健檢 ASIN 與身分原因不一致。");
  }
  return {
    sellerSku: exactText(source.sellerSku, "Seller SKU", 40),
    asin,
    title: displayText(source.title, "商品名稱", 2_000),
    marketplaceId,
    status,
    sourceCompleteness,
    publishedRecordCount,
    contentTypes,
    locales,
    reasonCode: reasonCode as AplusAuditReasonCode,
    reason: exactText(source.reason, "原因", 2_000),
  };
}

function parseSummary(value: unknown): AplusAuditSummary {
  const source = record(value, "A+ 健檢摘要");
  exactKeys(source, [
    "eligibleFbaSkus",
    "uniqueAsins",
    "published",
    "missing",
    "incomplete",
    "unavailable",
  ], "A+ 健檢摘要");
  return {
    eligibleFbaSkus: count(source.eligibleFbaSkus, "FBA SKU"),
    uniqueAsins: count(source.uniqueAsins, "唯一 ASIN"),
    published: count(source.published, "已發布"),
    missing: count(source.missing, "未發布"),
    incomplete: count(source.incomplete, "資料未完成"),
    unavailable: count(source.unavailable, "API 不可用"),
  };
}

function summariesEqual(left: AplusAuditSummary, right: AplusAuditSummary): boolean {
  return (Object.keys(left) as Array<keyof AplusAuditSummary>).every(
    (key) => left[key] === right[key],
  );
}

function exactJobId(value: unknown, label: string): string {
  const parsed = exactText(value, label, 120);
  if (!/^[A-Za-z0-9_-]{8,120}$/u.test(parsed)) {
    throw new Error(`A+ 健檢的${label}無法安全辨識。`);
  }
  return parsed;
}

function parseJobIdentity(
  source: Record<string, unknown>,
  expected: AplusAuditJobExpectation,
): Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  jobId: string;
  contextId: string;
}> {
  if (source.mode !== "live" && source.mode !== "demo") {
    throw new Error("A+ 健檢工作模式無效。");
  }
  if (source.mode !== expected.mode) {
    throw new Error("A+ 健檢工作與目前模式不一致；已停止觀察。");
  }
  const marketplaceId = exactText(source.marketplaceId, "工作站點", 32);
  if (marketplaceId !== expected.marketplaceId) {
    throw new Error("A+ 健檢工作與目前站點不一致；已停止觀察。");
  }
  const jobId = exactJobId(source.jobId, "job ID");
  const contextId = exactJobId(source.contextId, "context ID");
  if (expected.jobId !== undefined && jobId !== expected.jobId) {
    throw new Error("A+ 健檢 job identity 已變動；已停止觀察。");
  }
  if (expected.contextId !== undefined && contextId !== expected.contextId) {
    throw new Error("A+ 健檢 context identity 已變動；已停止觀察。");
  }
  return { mode: source.mode, marketplaceId, jobId, contextId };
}

function parseJobProgress(value: unknown): AplusAuditJobProgress {
  const source = record(value, "A+ 健檢工作進度");
  exactKeys(
    source,
    ["completedAsins", "totalAsins"],
    "A+ 健檢工作進度",
  );
  const progress = {
    completedAsins: count(source.completedAsins, "已完成 ASIN"),
    totalAsins: count(source.totalAsins, "全部 ASIN"),
  };
  if (progress.completedAsins > progress.totalAsins) {
    throw new Error("A+ 健檢工作進度與總數不一致。");
  }
  return progress;
}

export function parseAplusAuditJobReceipt(
  value: unknown,
  expected: AplusAuditJobExpectation,
): AplusAuditJobReceipt {
  const source = record(value, "A+ 健檢工作回應");
  exactKeys(source, [
    "jobId",
    "contextId",
    "marketplaceId",
    "mode",
    "ready",
    "status",
    "progress",
  ], "A+ 健檢工作回應");
  const identity = parseJobIdentity(source, expected);
  if (
    source.ready !== false ||
    (source.status !== "queued" && source.status !== "running")
  ) {
    throw new Error("A+ 健檢工作狀態無效。");
  }
  return {
    ...identity,
    ready: false,
    status: source.status,
    progress: parseJobProgress(source.progress),
  };
}

export function parseAplusAuditJobTerminal(
  value: unknown,
  expected: AplusAuditJobExpectation,
): AplusAuditJobTerminal {
  const source = record(value, "A+ 健檢完成回應");
  const identity = parseJobIdentity(source, expected);
  if (source.ready !== true) {
    throw new Error("A+ 健檢完成回應狀態無效。");
  }
  const progress = parseJobProgress(source.progress);
  if (source.status === "completed") {
    exactKeys(source, [
      "jobId",
      "contextId",
      "marketplaceId",
      "mode",
      "ready",
      "status",
      "progress",
      "snapshot",
    ], "A+ 健檢完成回應");
    if (progress.completedAsins !== progress.totalAsins) {
      throw new Error("A+ 健檢完成工作仍含未收斂的 ASIN。");
    }
    const snapshot = parseAplusAuditSnapshot(
      source.snapshot,
      expected.marketplaceId,
      expected.mode,
    );
    if (snapshot.summary.uniqueAsins !== progress.totalAsins) {
      throw new Error("A+ 健檢完成快照與背景工作總數不一致；已停止顯示與快取。");
    }
    return {
      ...identity,
      ready: true,
      status: "completed",
      progress,
      snapshot,
    };
  }
  if (source.status === "failed" || source.status === "aborted") {
    exactKeys(source, [
      "jobId",
      "contextId",
      "marketplaceId",
      "mode",
      "ready",
      "status",
      "progress",
      "error",
    ], "A+ 健檢完成回應");
    const error = record(source.error, "A+ 健檢安全錯誤");
    exactKeys(error, ["code", "message"], "A+ 健檢安全錯誤");
    const code = exactText(error.code, "錯誤代碼", 120);
    if (!/^[A-Z0-9_]{3,120}$/u.test(code)) {
      throw new Error("A+ 健檢錯誤代碼無效。");
    }
    return {
      ...identity,
      ready: true,
      status: source.status,
      progress,
      error: {
        code,
        message: exactText(error.message, "安全錯誤說明", 2_000),
      },
    };
  }
  throw new Error("A+ 健檢完成回應狀態無效。");
}

export function parseAplusAuditJobCompletion(
  value: unknown,
  expected: AplusAuditJobExpectation,
): AplusAuditJobCompletion {
  const terminal = parseAplusAuditJobTerminal(value, expected);
  if (terminal.status !== "completed") {
    throw new Error("A+ 健檢完成回應狀態無效。");
  }
  return terminal;
}

export function parseAplusAuditSnapshot(
  value: unknown,
  expectedMarketplaceId?: string,
  expectedMode?: "live" | "demo",
): AplusAuditSnapshot {
  const source = record(value);
  exactKeys(source, [
    "mode",
    "marketplaceId",
    "fetchedAt",
    "rows",
    "totals",
    "summary",
    "notice",
  ], "A+ 健檢資料");
  if (source.mode !== "live" && source.mode !== "demo") {
    throw new Error("A+ 健檢模式無效。");
  }
  if (expectedMode !== undefined && source.mode !== expectedMode) {
    throw new Error("A+ 健檢回應與目前模式不一致；已停止顯示與快取。");
  }
  const marketplaceId = exactText(source.marketplaceId, "站點", 32);
  if (!/^[A-Z0-9]{10,24}$/u.test(marketplaceId)) {
    throw new Error("A+ 健檢站點身分無效。");
  }
  if (expectedMarketplaceId !== undefined && marketplaceId !== expectedMarketplaceId) {
    throw new Error("A+ 健檢回應與目前選擇的站點不一致；已停止顯示與快取。");
  }
  const fetchedAt = exactText(source.fetchedAt, "快照時間", 40);
  if (!Number.isFinite(Date.parse(fetchedAt))) {
    throw new Error("A+ 健檢快照時間無效。");
  }
  if (
    !Array.isArray(source.rows) ||
    source.rows.length > APLUS_AUDIT_MAX_PUBLIC_COUNT
  ) {
    throw new Error("A+ 健檢商品列無效。");
  }
  const rows = source.rows.map((row) => parseRow(row, marketplaceId));
  const seenSellerSkus = new Set<string>();
  const evidenceByAsin = new Map<string, string>();
  for (const row of rows) {
    if (seenSellerSkus.has(row.sellerSku)) {
      throw new Error("A+ 健檢含有重複 Seller SKU；已停止顯示與快取。");
    }
    seenSellerSkus.add(row.sellerSku);
    if (row.asin !== null) {
      const evidence = JSON.stringify([
        row.status,
        row.sourceCompleteness,
        row.publishedRecordCount,
        row.contentTypes,
        row.locales,
        row.reasonCode,
        row.reason,
      ]);
      const priorEvidence = evidenceByAsin.get(row.asin);
      if (priorEvidence !== undefined && priorEvidence !== evidence) {
        throw new Error("A+ 健檢同一 ASIN 的 publish-record 證據不一致；已停止顯示與快取。");
      }
      evidenceByAsin.set(row.asin, evidence);
    }
  }
  const summary = parseSummary(source.summary);
  const totals = parseSummary(source.totals);
  const actual: AplusAuditSummary = {
    eligibleFbaSkus: rows.length,
    uniqueAsins: new Set(rows.flatMap((row) => row.asin ? [row.asin] : [])).size,
    published: rows.filter((row) => row.status === "published").length,
    missing: rows.filter((row) => row.status === "missing").length,
    incomplete: rows.filter((row) => row.status === "incomplete").length,
    unavailable: rows.filter((row) => row.status === "unavailable").length,
  };
  if (!summariesEqual(summary, totals) || !summariesEqual(summary, actual)) {
    throw new Error("A+ 健檢摘要與商品列不一致；已停止顯示與快取。");
  }
  return {
    mode: source.mode,
    marketplaceId,
    fetchedAt,
    rows,
    totals,
    summary,
    notice: exactText(source.notice, "說明", 4_000),
  };
}

export function aplusAuditRowMatchesFilter(
  row: AplusAuditRow,
  filter: AplusAuditFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "problem") return row.status !== "published";
  return row.status === filter;
}
