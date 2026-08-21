"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseAdvertisingStrategySnapshot,
  type AdvertisingStrategySnapshot,
} from "../advertising-strategy";
import { downloadAdvertisingStrategyWorkbook } from "../advertising-strategy-excel";

export type AdvertisingStrategyDateRange = Readonly<{
  startDate: string;
  endDate: string;
}>;

export type AdvertisingStrategyJob = Readonly<{
  schemaVersion: 1;
  jobId: string;
  marketplaceId: string;
  marketplaceCode: string;
  dateRange: AdvertisingStrategyDateRange;
  state: "running" | "completed" | "failed";
  progress: Readonly<{
    phase: "fba" | "sales" | "ads" | "building";
    completed: number;
    total: 4;
  }>;
  notice: string;
  snapshot: AdvertisingStrategySnapshot | null;
  errorCode: string | null;
}>;

export type AdvertisingStrategyJobPointer = Readonly<{
  marketplaceId: string;
  marketplaceCode: string;
  jobId: string;
  dateRange: AdvertisingStrategyDateRange;
}>;

type RequestFunction = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const latestAdvertisingStrategyJob = new Map<
  string,
  AdvertisingStrategyJobPointer
>();

type PendingAdvertisingStrategyKickoff = Readonly<{
  dateRange: AdvertisingStrategyDateRange;
  promise: Promise<AdvertisingStrategyJob>;
}>;

const pendingAdvertisingStrategyKickoffs = new Map<
  string,
  PendingAdvertisingStrategyKickoff
>();

const RETRY_ERROR_CODES = new Set([
  "REPORT_RETRY_REQUIRED",
  "REPORT_RETRY_WAIT",
]);

const PHASE_LABELS: Record<AdvertisingStrategyJob["progress"]["phase"], string> = {
  fba: "正在核對全站 FBA 商品",
  sales: "正在整理品項銷售",
  ads: "正在讀取 Sponsored Products",
  building: "正在建立策略建議",
};

class AdvertisingStrategyRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, input: { status: number; code?: string | null }) {
    super(message);
    this.name = "AdvertisingStrategyRequestError";
    this.status = input.status;
    this.code = input.code ?? null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function safeText(value: unknown, maximum: number): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function dateKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function shiftDateKey(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function marketplaceDateKey(timeZone: string, now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new Error("目前時間無法辨識，已停止建立廣告策略日期。");
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    throw new Error("Amazon 站點時區無效，已停止建立廣告策略日期。");
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const value = `${part("year")}-${part("month")}-${part("day")}`;
  if (!dateKey(value)) {
    throw new Error("Amazon 站點日期無法辨識，已停止建立廣告策略日期。");
  }
  return value;
}

function inclusiveDayCount(range: AdvertisingStrategyDateRange): number {
  return Math.round(
    (Date.parse(`${range.endDate}T00:00:00.000Z`) -
      Date.parse(`${range.startDate}T00:00:00.000Z`)) /
      86_400_000,
  ) + 1;
}

export function defaultAdvertisingStrategyDateRange(input: {
  timeZone: string;
  now?: Date;
}): AdvertisingStrategyDateRange {
  const today = marketplaceDateKey(input.timeZone, input.now ?? new Date());
  const endDate = shiftDateKey(today, -1);
  return {
    startDate: shiftDateKey(endDate, -29),
    endDate,
  };
}

export function validateAdvertisingStrategyDateRange(
  range: AdvertisingStrategyDateRange,
  input: { timeZone: string; now?: Date },
): AdvertisingStrategyDateRange {
  const startDate = dateKey(range.startDate);
  const endDate = dateKey(range.endDate);
  if (!startDate || !endDate) {
    throw new Error("請提供有效的廣告策略開始日與結束日。");
  }
  const days = inclusiveDayCount({ startDate, endDate });
  if (days < 1 || days > 31) {
    throw new Error("廣告策略單次日期範圍必須介於 1 到 31 個完整日。");
  }
  const yesterday = shiftDateKey(
    marketplaceDateKey(input.timeZone, input.now ?? new Date()),
    -1,
  );
  if (endDate > yesterday) {
    throw new Error("廣告策略結束日最多只能選到 Amazon 站點的昨天。");
  }
  return { startDate, endDate };
}

export function rememberAdvertisingStrategyJob(job: AdvertisingStrategyJob): void {
  latestAdvertisingStrategyJob.set(job.marketplaceId, {
    marketplaceId: job.marketplaceId,
    marketplaceCode: job.marketplaceCode,
    jobId: job.jobId,
    dateRange: { ...job.dateRange },
  });
}

export function readRememberedAdvertisingStrategyJob(
  marketplaceId: string,
): AdvertisingStrategyJobPointer | null {
  const pointer = latestAdvertisingStrategyJob.get(marketplaceId);
  return pointer
    ? { ...pointer, dateRange: { ...pointer.dateRange } }
    : null;
}

export function clearRememberedAdvertisingStrategyJob(
  marketplaceId?: string,
): void {
  if (marketplaceId) latestAdvertisingStrategyJob.delete(marketplaceId);
  else latestAdvertisingStrategyJob.clear();
}

function parseDateRange(value: unknown): AdvertisingStrategyDateRange | null {
  const range = record(value);
  const startDate = dateKey(range?.startDate);
  const endDate = dateKey(range?.endDate);
  return startDate && endDate ? { startDate, endDate } : null;
}

export function parseAdvertisingStrategyJob(
  value: unknown,
  expected: {
    marketplaceId: string;
    marketplaceCode: string;
    dateRange: AdvertisingStrategyDateRange;
    currencyCode: string;
  },
): AdvertisingStrategyJob {
  const root = record(value);
  const rawRange = record(root?.dateRange);
  const progress = record(root?.progress);
  const parsedRange = parseDateRange(root?.dateRange);
  const allowedKeys = new Set([
    "schemaVersion",
    "jobId",
    "marketplaceId",
    "marketplaceCode",
    "dateRange",
    "state",
    "progress",
    "notice",
    "snapshot",
    "errorCode",
  ]);
  if (
    !root ||
    !hasOnlyKeys(root, allowedKeys) ||
    root.schemaVersion !== 1 ||
    root.marketplaceId !== expected.marketplaceId ||
    root.marketplaceCode !== expected.marketplaceCode ||
    !parsedRange ||
    !rawRange ||
    !hasOnlyKeys(rawRange, new Set(["startDate", "endDate"])) ||
    parsedRange.startDate !== expected.dateRange.startDate ||
    parsedRange.endDate !== expected.dateRange.endDate ||
    (root.state !== "running" && root.state !== "completed" && root.state !== "failed") ||
    !progress ||
    !hasOnlyKeys(progress, new Set(["phase", "completed", "total"])) ||
    (progress.phase !== "fba" &&
      progress.phase !== "sales" &&
      progress.phase !== "ads" &&
      progress.phase !== "building") ||
    !Number.isSafeInteger(progress.completed) ||
    (progress.completed as number) < 0 ||
    (progress.completed as number) > 4 ||
    progress.total !== 4
  ) {
    throw new Error("廣告策略背景工作回應無法安全辨識。");
  }
  const jobId = safeText(root.jobId, 200);
  const notice = safeText(root.notice, 2_000);
  const errorCode = root.errorCode === undefined || root.errorCode === null
    ? null
    : safeText(root.errorCode, 128);
  if (
    !jobId ||
    !/^[A-Za-z0-9._:-]+$/u.test(jobId) ||
    !notice ||
    (errorCode !== null && !/^[A-Z][A-Z0-9_]*$/u.test(errorCode)) ||
    (root.state === "running" && (root.snapshot !== null || errorCode !== null)) ||
    (root.state === "completed" &&
      (root.snapshot === null || errorCode !== null || progress.completed !== 4)) ||
    (root.state === "failed" && root.snapshot !== null)
  ) {
    throw new Error("廣告策略背景工作狀態與資料不一致。");
  }
  const snapshot = root.state === "completed"
    ? parseAdvertisingStrategySnapshot(root.snapshot, {
        marketplaceId: expected.marketplaceId,
        startDate: expected.dateRange.startDate,
        endDate: expected.dateRange.endDate,
        currencyCode: expected.currencyCode,
      })
    : null;
  if (snapshot && snapshot.marketplaceCode !== expected.marketplaceCode) {
    throw new Error("廣告策略快照的 Amazon 站點代碼不一致。");
  }
  return {
    schemaVersion: 1,
    jobId,
    marketplaceId: expected.marketplaceId,
    marketplaceCode: expected.marketplaceCode,
    dateRange: parsedRange,
    state: root.state,
    progress: {
      phase: progress.phase,
      completed: progress.completed as number,
      total: 4,
    },
    notice,
    snapshot,
    errorCode,
  };
}

export async function startAdvertisingStrategyJob(input: {
  marketplaceId: string;
  marketplaceCode: string;
  dateRange: AdvertisingStrategyDateRange;
  currencyCode: string;
  refresh?: boolean;
  explicitRetry?: boolean;
  signal?: AbortSignal;
  request: RequestFunction;
}): Promise<AdvertisingStrategyJob> {
  const response = await input.request("/api/amazon-ads/strategy", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marketplaceId: input.marketplaceId,
      startDate: input.dateRange.startDate,
      endDate: input.dateRange.endDate,
      ...(input.refresh ? { refresh: true } : {}),
      ...(input.explicitRetry ? { explicitRetry: true } : {}),
    }),
    signal: input.signal,
  });
  const payload = await responseJson(response);
  if (!response.ok) problemFromResponse(response, payload);
  return parseAdvertisingStrategyJob(payload, {
    marketplaceId: input.marketplaceId,
    marketplaceCode: input.marketplaceCode,
    dateRange: input.dateRange,
    currencyCode: input.currencyCode,
  });
}

export function kickoffAdvertisingStrategyJob(input: {
  marketplaceId: string;
  marketplaceCode: string;
  dateRange: AdvertisingStrategyDateRange;
  currencyCode: string;
  refresh?: boolean;
  explicitRetry?: boolean;
  request: RequestFunction;
}): Promise<AdvertisingStrategyJob> {
  const existing = pendingAdvertisingStrategyKickoffs.get(input.marketplaceId);
  if (existing) return existing.promise;
  const promise = startAdvertisingStrategyJob(input).then((job) => {
    rememberAdvertisingStrategyJob(job);
    return job;
  });
  pendingAdvertisingStrategyKickoffs.set(input.marketplaceId, {
    dateRange: { ...input.dateRange },
    promise,
  });
  const removePending = () => {
    if (pendingAdvertisingStrategyKickoffs.get(input.marketplaceId)?.promise === promise) {
      pendingAdvertisingStrategyKickoffs.delete(input.marketplaceId);
    }
  };
  void promise.then(removePending, removePending);
  return promise;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new AdvertisingStrategyRequestError(
      "Notebook 鑰匙回傳了無法辨識的廣告策略資料。",
      { status: response.status },
    );
  }
}

function problemFromResponse(response: Response, value: unknown): never {
  const problem = record(value);
  const code = safeText(problem?.code, 128);
  const message = safeText(problem?.message, 2_000);
  throw new AdvertisingStrategyRequestError(
    message ?? "目前無法建立 FBA 廣告策略建議。",
    {
      status: response.status,
      code: code && /^[A-Z][A-Z0-9_]*$/u.test(code) ? code : null,
    },
  );
}

function abortError(): DOMException {
  return new DOMException("Advertising strategy observer stopped", "AbortError");
}

export async function pollAdvertisingStrategyJob(input: {
  pointer: AdvertisingStrategyJobPointer;
  currencyCode: string;
  signal?: AbortSignal;
  request: RequestFunction;
  wait?: (milliseconds: number) => Promise<void>;
  onJob?: (job: AdvertisingStrategyJob) => void;
}): Promise<AdvertisingStrategyJob> {
  const wait = input.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (input.signal?.aborted) throw abortError();
    const query = new URLSearchParams({
      marketplaceId: input.pointer.marketplaceId,
      jobId: input.pointer.jobId,
      startDate: input.pointer.dateRange.startDate,
      endDate: input.pointer.dateRange.endDate,
    });
    const response = await input.request(`/api/amazon-ads/strategy?${query}`, {
      method: "GET",
      cache: "no-store",
      signal: input.signal,
    });
    const payload = await responseJson(response);
    if (!response.ok) problemFromResponse(response, payload);
    const job = parseAdvertisingStrategyJob(payload, {
      marketplaceId: input.pointer.marketplaceId,
      marketplaceCode: input.pointer.marketplaceCode,
      dateRange: input.pointer.dateRange,
      currencyCode: input.currencyCode,
    });
    if (job.jobId !== input.pointer.jobId) {
      throw new Error("廣告策略背景工作識別已改變，已停止接回。");
    }
    input.onJob?.(job);
    if (job.state !== "running") return job;
    await wait(2_000);
  }
  throw new Error("Amazon 仍在整理廣告策略資料；Notebook 鑰匙會繼續背景執行，稍後重開即可接回。");
}

export async function resumeAdvertisingStrategyJob(input: {
  marketplaceId: string;
  currencyCode: string;
  signal?: AbortSignal;
  request: RequestFunction;
  wait?: (milliseconds: number) => Promise<void>;
  onJob?: (job: AdvertisingStrategyJob) => void;
}): Promise<AdvertisingStrategyJob | null> {
  if (input.signal?.aborted) throw abortError();
  const pending = pendingAdvertisingStrategyKickoffs.get(input.marketplaceId);
  if (pending) {
    await pending.promise;
    if (input.signal?.aborted) throw abortError();
  }
  const pointer = readRememberedAdvertisingStrategyJob(input.marketplaceId);
  if (!pointer) {
    if (!pending) return null;
    throw new Error("廣告策略工作已完成啟動，但無法安全接回工作識別。");
  }
  return pollAdvertisingStrategyJob({
    pointer,
    currencyCode: input.currencyCode,
    signal: input.signal,
    request: input.request,
    wait: input.wait,
    onJob: (job) => {
      rememberAdvertisingStrategyJob(job);
      input.onJob?.(job);
    },
  });
}

function retryCode(value: string | null): string | null {
  return value && RETRY_ERROR_CODES.has(value) ? value : null;
}

export function shouldClearAdvertisingStrategyJobPointer(input: {
  status: number;
  code: string | null;
}): boolean {
  return input.status === 404 ||
    (input.status === 409 && retryCode(input.code) === null);
}

function currency(value: number | null, currencyCode: string): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: currencyCode === "JPY" ? 0 : 2,
  }).format(value);
}

function percentage(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(0)}%`;
}

function actualAcosLabel(
  row: AdvertisingStrategySnapshot["rows"][number],
): string {
  if (row.spActualAcosStatus === "reported") return percentage(row.spActualAcos);
  if (row.spActualAcosStatus === "no-sales") return "無歸因銷售";
  if (row.spActualAcosStatus === "not-reported") return "未回傳";
  return "—";
}

function attributionLabel(
  value: AdvertisingStrategySnapshot["rows"][number]["spAttribution"],
): string {
  if (value === "seller-sku") return "SKU 直接";
  if (value === "unique-asin") return "唯一 ASIN";
  if (value === "mixed") return "混合";
  return "—";
}

function sourceInstant(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
}

function tierLabel(value: AdvertisingStrategySnapshot["rows"][number]["salesTier"]): string {
  return value ?? "未分級";
}

export function AdvertisingStrategySnapshotView({
  snapshot,
  visibleCount,
  onShowMore,
  onDownload,
}: {
  snapshot: AdvertisingStrategySnapshot;
  visibleCount: number;
  onShowMore?: () => void;
  onDownload?: () => void;
}) {
  const reportedSales = snapshot.coverage.salesReportedSkuCount;
  const reportedSp = snapshot.coverage.spReportedSkuCount;
  const visibleRows = snapshot.rows.slice(0, visibleCount);
  const unresolvedSales = snapshot.unresolved.filter((row) => row.source === "sales").length;
  const unresolvedSp = snapshot.unresolved.length - unresolvedSales;
  const anonymousSales = snapshot.coverage.salesAnonymousUnprovenSourceRowCount;
  const anonymousSp = snapshot.coverage.spAnonymousUnprovenSourceRowCount;
  const anonymousUnproven = anonymousSales + anonymousSp;
  const incompleteSourceRows = snapshot.unresolved.length + anonymousUnproven;
  return (
    <div className="advertising-strategy-result">
      <div className="advertising-strategy-result-heading">
        <div>
          <p className="eyebrow">{snapshot.marketplaceCode} · {snapshot.dateRange.startDate} – {snapshot.dateRange.endDate}</p>
          <h4>可覆寫的 SP 建議與人工策略欄位</h4>
        </div>
        <button type="button" className="advertising-strategy-download" onClick={onDownload}>下載策略 Excel</button>
      </div>
      <div className="advertising-strategy-summary">
        <div><strong>{snapshot.rows.length.toLocaleString("zh-TW")}</strong><span>目前 FBA SKU</span></div>
        <div><strong>{reportedSales.toLocaleString("zh-TW")}</strong><span>有品項銷售資料</span></div>
        <div><strong>{reportedSp.toLocaleString("zh-TW")}</strong><span>SP 資料已回傳</span></div>
        <div><strong>{incompleteSourceRows.toLocaleString("zh-TW")}</strong><span>來源隔離／未完成</span></div>
      </div>
      <div className="advertising-strategy-tiers" aria-label="銷售分級">
        {(["T1", "T2", "T3", "T4"] as const).map((tier) => (
          <span key={tier}><b>{tier}</b>{snapshot.summary.tierCounts[tier].toLocaleString("zh-TW")}</span>
        ))}
      </div>
      <div className="advertising-strategy-source-times" aria-label="資料來源實際讀取時間">
        <strong>來源讀取時間</strong>
        <span>FBA 文件 {sourceInstant(snapshot.sourceFetchedAt.fba)}</span>
        <span>Sales &amp; Traffic 文件 {sourceInstant(snapshot.sourceFetchedAt.sales)}</span>
        <span>Ads 文件 {sourceInstant(snapshot.sourceFetchedAt.ads)}</span>
      </div>
      {incompleteSourceRows > 0 && (
        <div className="advertising-strategy-unresolved">
          <strong>有 {incompleteSourceRows.toLocaleString("zh-TW")} 筆來源列未歸屬</strong>
          <span>可核對的 FBA 問題：品項銷售 {unresolvedSales.toLocaleString("zh-TW")} 筆、Ads {unresolvedSp.toLocaleString("zh-TW")} 筆；未證明 FBA 的匿名隔離：品項銷售 {anonymousSales.toLocaleString("zh-TW")} 筆、Ads {anonymousSp.toLocaleString("zh-TW")} 筆。匿名列不顯示 SKU／ASIN 或營業數據，也不補成 0。</span>
        </div>
      )}
      <div className="advertising-strategy-rows">
        {visibleRows.map((row) => (
          <article key={row.sellerSku} className="advertising-strategy-row">
            <header>
              <div><strong>{row.sellerSku}</strong><span>{row.asin}</span></div>
              <span className={`advertising-tier ${row.salesTier ? row.salesTier.toLowerCase() : "none"}`}>{tierLabel(row.salesTier)}</span>
            </header>
            <h5>{row.title || "Amazon 未回傳商品名稱"}</h5>
            <dl>
              <div><dt>價格（不推算）</dt><dd>{currency(row.price, snapshot.currencyCode)}</dd></div>
              <div><dt>品項營業額</dt><dd>{currency(row.salesAmount, snapshot.currencyCode)}</dd></div>
              <div><dt>銷售件數</dt><dd>{row.unitsSold?.toLocaleString("zh-TW") ?? "—"}</dd></div>
              <div><dt>目前 SP spend</dt><dd>{currency(row.spSpend, snapshot.currencyCode)}{row.spSpendRank !== null ? ` · #${row.spSpendRank}` : ""}</dd></div>
              <div><dt>SP 14d 歸因銷售</dt><dd>{currency(row.spSales14d, snapshot.currencyCode)}</dd></div>
              <div><dt>SP 14d 訂單</dt><dd>{row.spPurchases14d?.toLocaleString("zh-TW") ?? "—"}</dd></div>
              <div><dt>SP 實際 ACoS</dt><dd>{actualAcosLabel(row)}</dd></div>
              <div><dt>SP 歸因方式</dt><dd>{attributionLabel(row.spAttribution)}</dd></div>
            </dl>
            <div className="advertising-strategy-sp">
              <div><span>建議 SP 每日預算</span><strong>{currency(row.suggestedSpDailyBudget, snapshot.currencyCode)}</strong></div>
              <div><span>建議 SP 目標 ACoS</span><strong>{percentage(row.suggestedSpTargetAcos)}</strong></div>
              <em>{row.suggestion === "overrideable-default" ? "可覆寫建議" : "資料不足，保持留白"}</em>
            </div>
            <div className="advertising-strategy-manual">
              <strong>價格／SB／SD／規格</strong>
              <span>留白 · 價格不以營業額除以件數推算；策略由你依素材、受眾、競品與商品規格人工規劃</span>
            </div>
          </article>
        ))}
      </div>
      {visibleRows.length < snapshot.rows.length && (
        <button type="button" className="advertising-strategy-more" onClick={onShowMore}>
          顯示更多（尚有 {(snapshot.rows.length - visibleRows.length).toLocaleString("zh-TW")} 筆）
        </button>
      )}
      <p className="advertising-strategy-footnote">{snapshot.notice}</p>
    </div>
  );
}

export default function AdvertisingStrategyPanel({
  marketplaceId,
  marketplaceCode,
  marketplaceTimeZone,
  currencyCode,
  available,
  unavailableNotice,
}: {
  marketplaceId: string;
  marketplaceCode: string;
  marketplaceTimeZone: string;
  currencyCode: string;
  available: boolean;
  unavailableNotice: string;
}) {
  const defaultRange = useMemo(
    () => defaultAdvertisingStrategyDateRange({ timeZone: marketplaceTimeZone }),
    [marketplaceTimeZone],
  );
  const [range, setRange] = useState<AdvertisingStrategyDateRange>(defaultRange);
  const [job, setJob] = useState<AdvertisingStrategyJob | null>(null);
  const [snapshot, setSnapshot] = useState<AdvertisingStrategySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(60);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const rangeError = useMemo(() => {
    try {
      validateAdvertisingStrategyDateRange(range, { timeZone: marketplaceTimeZone });
      return null;
    } catch (rangeProblem) {
      return rangeProblem instanceof Error ? rangeProblem.message : "廣告策略日期無效。";
    }
  }, [marketplaceTimeZone, range]);
  const maximumEndDate = useMemo(
    () => defaultAdvertisingStrategyDateRange({ timeZone: marketplaceTimeZone }).endDate,
    [marketplaceTimeZone],
  );

  useEffect(() => {
    abortRef.current?.abort();
    const pointer = readRememberedAdvertisingStrategyJob(marketplaceId);
    const pending = pendingAdvertisingStrategyKickoffs.get(marketplaceId);
    const nextRange = pending?.dateRange ?? pointer?.dateRange ?? defaultRange;
    setRange(nextRange);
    setJob(null);
    setSnapshot(null);
    setError(null);
    setErrorCode(null);
    setExportError(null);
    setVisibleCount(60);
    if (!pointer && !pending) return undefined;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    void resumeAdvertisingStrategyJob({
      marketplaceId,
      currencyCode,
      signal: controller.signal,
      request: (url, init) => fetch(url, init),
      onJob: (next) => {
        if (controller.signal.aborted) return;
        rememberAdvertisingStrategyJob(next);
        setJob(next);
        if (next.snapshot) setSnapshot(next.snapshot);
      },
    }).then((terminal) => {
      if (controller.signal.aborted || !terminal) return;
      setJob(terminal);
      if (terminal.snapshot) setSnapshot(terminal.snapshot);
      if (terminal.state === "failed") {
        setError(terminal.notice);
        setErrorCode(retryCode(terminal.errorCode));
      }
    }).catch((resumeError) => {
      if (resumeError instanceof Error && resumeError.name === "AbortError") return;
      if (resumeError instanceof AdvertisingStrategyRequestError) {
        setError(resumeError.message);
        setErrorCode(retryCode(resumeError.code));
        if (shouldClearAdvertisingStrategyJobPointer(resumeError)) {
          clearRememberedAdvertisingStrategyJob(marketplaceId);
        }
      } else {
        setError(resumeError instanceof Error ? resumeError.message : "無法接回廣告策略背景工作。");
      }
    }).finally(() => {
      if (abortRef.current === controller) setBusy(false);
    });
    return () => controller.abort();
  }, [currencyCode, defaultRange, marketplaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  function applyJob(next: AdvertisingStrategyJob): void {
    rememberAdvertisingStrategyJob(next);
    setJob(next);
    if (next.snapshot) setSnapshot(next.snapshot);
    if (next.state === "failed") {
      setError(next.notice);
      setErrorCode(retryCode(next.errorCode));
    }
  }

  async function runStrategy(input: {
    refresh: boolean;
    explicitRetry: boolean;
  }): Promise<void> {
    if (!available || busy) return;
    let dateRange: AdvertisingStrategyDateRange;
    try {
      dateRange = validateAdvertisingStrategyDateRange(range, {
        timeZone: marketplaceTimeZone,
      });
    } catch (rangeProblem) {
      setError(rangeProblem instanceof Error ? rangeProblem.message : "廣告策略日期無效。");
      return;
    }
    abortRef.current?.abort();
    setBusy(true);
    setJob(null);
    setSnapshot(null);
    setError(null);
    setErrorCode(null);
    setExportError(null);
    setVisibleCount(60);
    try {
      let current = await kickoffAdvertisingStrategyJob({
        marketplaceId,
        marketplaceCode,
        dateRange,
        currencyCode,
        refresh: input.refresh,
        explicitRetry: input.explicitRetry,
        request: (url, init) => fetch(url, init),
      });
      if (!mountedRef.current) return;
      applyJob(current);
      if (current.state === "running") {
        const controller = new AbortController();
        abortRef.current = controller;
        current = await pollAdvertisingStrategyJob({
          pointer: {
            marketplaceId,
            marketplaceCode,
            jobId: current.jobId,
            dateRange,
          },
          currencyCode,
          signal: controller.signal,
          request: (url, init) => fetch(url, init),
          onJob: applyJob,
        });
        applyJob(current);
      }
    } catch (strategyError) {
      if (!mountedRef.current) return;
      if (strategyError instanceof Error && strategyError.name === "AbortError") return;
      if (strategyError instanceof AdvertisingStrategyRequestError) {
        setError(strategyError.message);
        setErrorCode(retryCode(strategyError.code));
      } else {
        setError(strategyError instanceof Error ? strategyError.message : "目前無法建立 FBA 廣告策略建議。");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  const explicitRetry = errorCode !== null;
  const refresh = Boolean(snapshot || job || error);
  const buttonLabel = busy
    ? "策略整理中…"
    : explicitRetry
      ? "明確重試報表"
      : refresh
        ? "重新產生策略"
        : "產生 FBA 廣告策略";

  return (
    <section className="advertising-strategy-panel">
      <header className="advertising-strategy-heading">
        <div>
          <p className="eyebrow">FBA AD STRATEGY · READ ONLY</p>
          <h3>FBA 廣告策略建議</h3>
          <p>把目前 FBA 商品、品項銷售與 Sponsored Products 整理成一張可覆寫的策略表。</p>
        </div>
        <span className="capability-pill readonly">唯讀建議</span>
      </header>

      <div className="advertising-strategy-guidance">
        <div><strong>SP 建議可以覆寫</strong><p>每日預算與目標 ACoS 是起始建議，不會寫回 Amazon，也不會取代你的判斷。</p></div>
        <div><strong>價格、SB／SD／規格刻意留白</strong><p>本版沒有可信的價格來源，不用銷售額 ÷ 件數推算；其他策略欄位也由你人工補充。</p></div>
      </div>

      <div className="advertising-strategy-reporting-proof">
        <strong>Ads Reporting v3 要等首次成功才算驗證</strong>
        <p>目前的綠色連線只證明 Profiles／Campaign query；按鈕可用不代表報表權限已通過，首次執行會由 Notebook 鑰匙實際核對。</p>
      </div>

      <div className="advertising-strategy-controls">
        <label><span>開始日</span><input type="date" value={range.startDate} max={maximumEndDate} onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label><span>結束日</span><input type="date" value={range.endDate} max={maximumEndDate} onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <button type="button" onClick={() => void runStrategy({ refresh: refresh || explicitRetry, explicitRetry })} disabled={!available || busy || Boolean(rangeError)}>{buttonLabel}</button>
      </div>

      {rangeError && <p className="advertising-strategy-range-error" role="alert">{rangeError}</p>}
      {!available && <div className="advertising-strategy-unavailable"><strong>等待 Amazon Ads 驗證</strong><p>{unavailableNotice}</p></div>}
      {job?.state === "running" && (
        <div className="advertising-strategy-progress" role="status">
          <div><strong>{PHASE_LABELS[job.progress.phase]}</strong><span>{job.progress.completed} / 4</span></div>
          <i><span style={{ width: `${Math.max(4, job.progress.completed * 25)}%` }} /></i>
          <p>{job.notice}</p>
        </div>
      )}
      {error && (
        <div className={`advertising-strategy-error ${explicitRetry ? "retry-required" : ""}`} role="alert">
          <strong>{explicitRetry ? "需要你明確重試" : "策略尚未完成"}</strong>
          <p>{error}</p>
          {explicitRetry && <small>系統不會自動重送 Amazon 報表建立請求；上方按鈕只在你按下後才會重試。</small>}
        </div>
      )}
      {exportError && <div className="price-error" role="alert">{exportError}</div>}

      {snapshot && (
        <AdvertisingStrategySnapshotView
          snapshot={snapshot}
          visibleCount={visibleCount}
          onShowMore={() => setVisibleCount((current) => current + 60)}
          onDownload={() => {
            try {
              setExportError(null);
              downloadAdvertisingStrategyWorkbook(snapshot);
            } catch (downloadError) {
              setExportError(downloadError instanceof Error ? downloadError.message : "廣告策略 Excel 無法下載。");
            }
          }}
        />
      )}

      <p className="advertising-strategy-source">只讀來源：目前 FBA 商品、Business Reports 品項銷售與 Amazon Ads SP；本版沒有可信價格來源，保持空白且不推算；不建立、不修改、不啟用 campaign。</p>
    </section>
  );
}
