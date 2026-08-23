"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  aplusAuditRowMatchesFilter,
  parseAplusAuditJobReceipt,
  parseAplusAuditJobTerminal,
  parseAplusAuditSnapshot,
  type AplusAuditFilter,
  type AplusAuditJobReceipt,
  type AplusAuditJobTerminal,
  type AplusAuditRow,
  type AplusAuditSnapshot,
} from "../a-plus-audit";
import {
  openAplusManagerHandoff,
  supportsFixedSellerCentralHandoffs,
} from "../seller-central-handoff";

export type AplusAuditObservableJob = AplusAuditJobReceipt | AplusAuditJobTerminal;

const FILTERS: readonly Readonly<{
  value: AplusAuditFilter;
  label: string;
}>[] = [
  { value: "all", label: "全部" },
  { value: "problem", label: "需處理" },
  { value: "missing", label: "未發布" },
  { value: "published", label: "已發布" },
  { value: "incomplete", label: "資料未完成" },
  { value: "unavailable", label: "API 不可用" },
];

export type AplusAuditRequester = (
  input: Readonly<{
    marketplaceId: string;
    mode: "live" | "demo";
    isObserverActive?: () => boolean;
    onJobChange?: (job: AplusAuditObservableJob) => void;
  }>,
) => Promise<unknown>;

type AplusAuditJobFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function defaultJobWait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 1_000));
}

async function responseJson(response: Response, fallback: string): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(fallback);
  }
}

function observerStopped(): DOMException {
  return new DOMException("A+ 健檢觀察已停止。", "AbortError");
}

function retryableObserverStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 ||
    status === 503 || status === 504;
}

export async function requestAplusAuditJob({
  marketplaceId,
  mode,
  fetcher = fetch,
  wait = defaultJobWait,
  maxPolls = Number.POSITIVE_INFINITY,
  isObserverActive = () => true,
  onJobChange,
}: Readonly<{
  marketplaceId: string;
  mode: "live" | "demo";
  fetcher?: AplusAuditJobFetcher;
  wait?: () => Promise<void>;
  maxPolls?: number;
  isObserverActive?: () => boolean;
  onJobChange?: (job: AplusAuditObservableJob) => void;
}>): Promise<AplusAuditSnapshot> {
  if (
    maxPolls !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(maxPolls) || maxPolls < 1)
  ) {
    throw new Error("A+ 健檢輪詢上限無效。");
  }
  if (!isObserverActive()) throw observerStopped();
  const receipt = await startAplusAuditJob({ marketplaceId, mode, fetcher });
  onJobChange?.(receipt);
  return observeAplusAuditJob({
    initialJob: receipt,
    fetcher,
    wait,
    maxPolls,
    isObserverActive,
    onJobChange,
  });
}

export async function startAplusAuditJob({
  marketplaceId,
  mode,
  fetcher = fetch,
}: Readonly<{
  marketplaceId: string;
  mode: "live" | "demo";
  fetcher?: AplusAuditJobFetcher;
}>): Promise<AplusAuditJobReceipt> {
  const response = await fetcher("/api/sp-api/a-plus-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ marketplaceId, mode }),
  });
  const payload = await responseJson(response, "A+ 健檢啟動回應格式無效。");
  if (response.status !== 202) {
    if (response.status === 404) {
      throw new Error("這台 Notebook 鑰匙尚未支援全站 A+ 健檢；請先更新 Notebook 鑰匙後再執行。");
    }
    const message = payload && typeof payload === "object" && !Array.isArray(payload) &&
        typeof (payload as { message?: unknown }).message === "string"
      ? (payload as { message: string }).message
      : "無法啟動全站 A+ 健檢。";
    throw new Error(message);
  }
  return parseAplusAuditJobReceipt(payload, { marketplaceId, mode });
}

export async function observeAplusAuditJob({
  initialJob,
  fetcher = fetch,
  wait = defaultJobWait,
  maxPolls = Number.POSITIVE_INFINITY,
  isObserverActive = () => true,
  onJobChange,
}: Readonly<{
  initialJob: AplusAuditJobReceipt;
  fetcher?: AplusAuditJobFetcher;
  wait?: () => Promise<void>;
  maxPolls?: number;
  isObserverActive?: () => boolean;
  onJobChange?: (job: AplusAuditObservableJob) => void;
}>): Promise<AplusAuditSnapshot> {
  if (
    maxPolls !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(maxPolls) || maxPolls < 1)
  ) {
    throw new Error("A+ 健檢輪詢上限無效。");
  }
  if (!isObserverActive()) throw observerStopped();
  let receipt = initialJob;
  const { marketplaceId, mode } = initialJob;
  let completedAsins = receipt.progress.completedAsins;
  let totalAsins = receipt.progress.totalAsins > 0
    ? receipt.progress.totalAsins
    : null;
  let hasRun = receipt.status === "running";
  const params = new URLSearchParams({
    marketplaceId,
    mode,
    jobId: receipt.jobId,
    contextId: receipt.contextId,
  });
  const pollUrl = `/api/sp-api/a-plus-audit?${params.toString()}`;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await wait();
    if (!isObserverActive()) throw observerStopped();
    let pollResponse: Response;
    try {
      pollResponse = await fetcher(pollUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch (error) {
      if (!isObserverActive()) throw observerStopped();
      if (error instanceof Error && error.name === "AbortError") throw error;
      continue;
    }
    if (retryableObserverStatus(pollResponse.status)) continue;
    const pollPayload = await responseJson(
      pollResponse,
      "A+ 健檢進度回應格式無效。",
    );
    if (pollResponse.status === 200) {
      const terminal = parseAplusAuditJobTerminal(pollPayload, {
        marketplaceId,
        mode,
        jobId: receipt.jobId,
        contextId: receipt.contextId,
      });
      onJobChange?.(terminal);
      if (
        terminal.progress.completedAsins < completedAsins ||
        (totalAsins !== null && terminal.progress.totalAsins !== totalAsins)
      ) {
        throw new Error("A+ 健檢完成工作與先前進度不一致；已停止顯示與快取。");
      }
      if (terminal.status !== "completed") {
        throw new Error(terminal.error.message);
      }
      return terminal.snapshot;
    }
    if (pollResponse.status !== 202) {
      const message = pollPayload && typeof pollPayload === "object" &&
          !Array.isArray(pollPayload) &&
          typeof (pollPayload as { message?: unknown }).message === "string"
        ? (pollPayload as { message: string }).message
        : "A+ 健檢背景工作未完成。";
      throw new Error(message);
    }
    const next = parseAplusAuditJobReceipt(pollPayload, {
      marketplaceId,
      mode,
      jobId: receipt.jobId,
      contextId: receipt.contextId,
    });
    if (
      next.progress.completedAsins < completedAsins ||
      (totalAsins !== null && next.progress.totalAsins !== totalAsins) ||
      (hasRun && next.status === "queued")
    ) {
      throw new Error("A+ 健檢背景工作進度已回退或改變範圍；已停止觀察。");
    }
    completedAsins = next.progress.completedAsins;
    if (next.progress.totalAsins > 0) totalAsins = next.progress.totalAsins;
    if (next.status === "running") hasRun = true;
    receipt = next;
    onJobChange?.(receipt);
  }
  throw new Error("A+ 健檢測試輪詢上限已到；本機工作不會被盲目重建。");
}

const defaultAuditRequester: AplusAuditRequester = (input) =>
  requestAplusAuditJob(input);

function statusLabel(status: AplusAuditRow["status"]): string {
  if (status === "published") return "已發布 A+";
  if (status === "missing") return "未找到已發布 A+";
  if (status === "unavailable") return "A+ API 尚未取得讀取權限";
  return "資料未完成，不能判定";
}

function rowStatusLabel(row: AplusAuditRow): string {
  if (row.reasonCode === "A_PLUS_WARNING_PRESENT") {
    return "Amazon 回應警告，請到 A+ 管理員確認";
  }
  if (row.reasonCode === "FBA_IDENTITY_INCOMPLETE") {
    return "缺少可核對的 ASIN";
  }
  if (row.reasonCode === "FBA_RELATIONSHIP_INCOMPLETE") {
    return "商品關係資料未完成";
  }
  if (row.reasonCode === "A_PLUS_RESPONSE_INVALID") {
    return "Amazon 回應格式未完成";
  }
  if (row.reasonCode === "A_PLUS_READ_FAILED") {
    return "Amazon A+ 查詢未完成";
  }
  return statusLabel(row.status);
}

function rowCount(
  snapshot: AplusAuditSnapshot,
  filter: AplusAuditFilter,
): number {
  return snapshot.rows.filter((row) => aplusAuditRowMatchesFilter(row, filter)).length;
}

export default function AplusAuditPanel({
  marketplaceId,
  marketplaceShort,
  mode,
  initialSnapshot = null,
  cachedSnapshot = null,
  onSnapshotChange,
  job = null,
  onJobChange,
  requestAudit = defaultAuditRequester,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode: "live" | "demo";
  initialSnapshot?: AplusAuditSnapshot | null;
  cachedSnapshot?: AplusAuditSnapshot | null;
  onSnapshotChange?: (snapshot: AplusAuditSnapshot) => void;
  job?: AplusAuditObservableJob | null;
  onJobChange?: (job: AplusAuditObservableJob) => void;
  requestAudit?: AplusAuditRequester;
}) {
  const matchingInitial = [initialSnapshot, cachedSnapshot].find(
    (candidate) =>
      candidate?.marketplaceId === marketplaceId && candidate.mode === mode,
  ) ?? null;
  const [snapshot, setSnapshot] = useState<AplusAuditSnapshot | null>(matchingInitial);
  const [filter, setFilter] = useState<AplusAuditFilter>("problem");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestRevisionRef = useRef(0);

  const visibleSnapshot = useMemo(() => {
    if (!snapshot) return null;
    if (!job) return snapshot;
    if (!job.ready || job.status !== "completed") return null;
    return job.snapshot.fetchedAt === snapshot.fetchedAt ? snapshot : null;
  }, [job, snapshot]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    requestRevisionRef.current += 1;
    const matching = [initialSnapshot, cachedSnapshot].find(
      (candidate) =>
        candidate?.marketplaceId === marketplaceId && candidate.mode === mode,
    ) ?? null;
    setSnapshot(matching);
    setFilter("problem");
    setError(null);
    setHandoffError(null);
  }, [cachedSnapshot, initialSnapshot, marketplaceId, mode]);

  const visibleRows = useMemo(
    () => visibleSnapshot?.rows.filter((row) =>
      aplusAuditRowMatchesFilter(row, filter)
    ) ?? [],
    [filter, visibleSnapshot],
  );

  const runAudit = async () => {
    if (loading) return;
    const revision = ++requestRevisionRef.current;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    try {
      const raw = await requestAudit({
        marketplaceId,
        mode,
        onJobChange,
        isObserverActive: () =>
          mountedRef.current && requestRevisionRef.current === revision,
      });
      const next = parseAplusAuditSnapshot(raw, marketplaceId, mode);
      if (!mountedRef.current || requestRevisionRef.current !== revision) return;
      setSnapshot(next);
      setFilter("problem");
      onSnapshotChange?.(next);
    } catch (requestError) {
      if (
        !mountedRef.current ||
        requestRevisionRef.current !== revision ||
        (requestError instanceof Error && requestError.name === "AbortError")
      ) return;
      setError(requestError instanceof Error
        ? requestError.message
        : "無法完成全站 A+ 健檢。");
    } finally {
      if (mountedRef.current && requestRevisionRef.current === revision) {
        setLoading(false);
      }
    }
  };

  const observingBackgroundJob = Boolean(job && !job.ready);
  const terminalJobError = job?.ready && job.status !== "completed"
    ? job.error.message
    : null;
  const fixedSellerCentralHandoffs = supportsFixedSellerCentralHandoffs(
    typeof window === "undefined" ? null : window.fbaOS?.app,
  );

  const openAplusManager = async () => {
    setHandoffError(null);
    try {
      const outcome = await openAplusManagerHandoff(window.fbaOS.app);
      if (outcome === "upgrade-required") {
        setHandoffError(
          "目前 Notebook Key 版本無法安全直達 A+ 管理員；請先更新 Notebook Key。為避免開錯頁，不會改開 Seller Central 首頁。",
        );
      }
    } catch {
      setHandoffError("無法開啟 Amazon A+ 管理員；請更新 Notebook Key 後再試一次。");
    }
  };

  return (
    <section className="business-pricing-audit-panel" aria-label="全站 FBA A+ 健檢">
      <div className="business-pricing-audit-intro">
        <div>
          <span>{marketplaceShort} · A+ CONTENT · FBA ONLY</span>
          <h3>全站 FBA A+ 健檢</h3>
          <p>逐一核對目前 FBA ASIN 是否有官方 A+ 發布紀錄；同 ASIN 多個 Seller SKU 只查一次。</p>
        </div>
        <button
          type="button"
          className="price-primary-button"
          onClick={() => void runAudit()}
          disabled={loading || observingBackgroundJob}
        >
          {loading || observingBackgroundJob ? "A+ 健檢中…" : snapshot ? "重新健檢" : "開始全站 A+ 健檢"}
        </button>
      </div>
      {(loading || observingBackgroundJob) && (
        <div className="business-pricing-progress" role="status">
          {job && !job.ready && job.progress.totalAsins > 0
            ? `正在讀取 A+ publish records（${job.progress.completedAsins}／${job.progress.totalAsins} ASIN）；這是唯讀健檢，不會修改 Amazon 商品頁。`
            : "正在讀取 A+ publish records；這是唯讀健檢，不會修改 Amazon 商品頁。"}
        </div>
      )}
      {(error || terminalJobError) && (
        <div className="price-error" role="alert">{error ?? terminalJobError}</div>
      )}
      {handoffError && <div className="price-error" role="alert">{handoffError}</div>}
      {!fixedSellerCentralHandoffs && (
        <p className="business-pricing-notice" role="status">
          目前 Notebook Key 需更新後才能安全直達 A+ 管理員；為避免開錯頁，舊版不會改開 Seller Central 首頁。
        </p>
      )}

      {visibleSnapshot && (
        <>
          <div className="business-pricing-summary is-interactive" role="group" aria-label="A+ 健檢摘要與篩選">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${filter === option.value ? "active" : ""}${
                  option.value === "problem" || option.value === "missing"
                    ? " problem"
                    : ""
                }`}
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
              >
                <span>{option.label}</span>
                <strong>{rowCount(visibleSnapshot, option.value)}</strong>
              </button>
            ))}
          </div>
          <p className="business-pricing-notice">
            {visibleSnapshot.summary.eligibleFbaSkus} 個 FBA SKU · {visibleSnapshot.summary.uniqueAsins} 個唯一 ASIN。{visibleSnapshot.notice}
          </p>
          <div className="business-pricing-list" role="list" aria-label="FBA A+ 健檢商品">
            {visibleRows.map((row) => (
              <article
                key={row.sellerSku}
                className={`business-pricing-row aplus-presence-row ${row.status === "unavailable" ? "incomplete" : row.status}`}
                role="listitem"
              >
                <div>
                  <strong>{row.title || row.sellerSku}</strong>
                  <small>{row.sellerSku} · {row.asin ?? "無可驗證 ASIN"}</small>
                </div>
                <div className="business-pricing-row-status">
                  <span>{rowStatusLabel(row)}</span>
                  <small>{row.reason}</small>
                </div>
                {row.status === "published" ? (
                  <span className="business-pricing-readonly">已確認有 A+</span>
                ) : (
                  <div className="business-pricing-row-actions">
                    <button
                      type="button"
                      onClick={() => void openAplusManager()}
                      disabled={!fixedSellerCentralHandoffs}
                    >
                      前往 Amazon A+ 管理員 ↗
                    </button>
                  </div>
                )}
              </article>
            ))}
            {visibleRows.length === 0 && (
              <p className="business-pricing-empty">這個篩選沒有商品。</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
