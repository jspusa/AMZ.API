"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseReviewAuditJob,
  parseReviewAuditSnapshot,
  type ReviewAuditJobView,
  type ReviewAuditSnapshotView,
} from "../review-audit";
import { auditExportFilename } from "../audit-export-filename";

const SUPPORTED = new Set([
  "ATVPDKIKX0DER",
  "A1VC38T7YXB528",
  "A1F83G8C2ARO7P",
  "A1PA6795UKMFR9",
]);

function apiMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = value as { message?: unknown; requestId?: unknown };
    const request = typeof raw.requestId === "string" && raw.requestId
      ? `（Request ID: ${raw.requestId}）`
      : "";
    if (typeof raw.message === "string" && raw.message.trim()) return `${raw.message}${request}`;
  }
  return fallback;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function impactLabel(value: number, polarity: "positive" | "negative"): string {
  const formatted = value.toFixed(1).replace(/^-/, "−");
  return `${polarity === "positive" ? "正向" : "負向"}影響值 ${formatted}`;
}

export type ReviewAuditCache = {
  snapshot: ReviewAuditSnapshotView | null;
  job: ReviewAuditJobView | null;
};

export default function ReviewAuditPanel({
  marketplaceId,
  marketplaceShort,
  cachedResult = null,
  onCachedResultChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  cachedResult?: ReviewAuditCache | null;
  onCachedResultChange?: (cache: ReviewAuditCache) => void;
}) {
  const initial = cachedResult?.snapshot?.marketplaceId === marketplaceId
    ? cachedResult.snapshot
    : null;
  const initialJob = cachedResult?.job?.marketplaceId === marketplaceId
    ? cachedResult.job
    : null;
  const [snapshot, setSnapshot] = useState<ReviewAuditSnapshotView | null>(initial);
  const [job, setJob] = useState<ReviewAuditJobView | null>(initialJob);
  const [busy, setBusy] = useState<"scan" | "export" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoObservedJobRef = useRef<string | null>(null);
  const cachedResultRef = useRef(cachedResult);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    cachedResultRef.current = cachedResult;
  }, [cachedResult]);
  useEffect(() => {
    abortRef.current?.abort();
    const cached = cachedResultRef.current;
    setSnapshot(cached?.snapshot?.marketplaceId === marketplaceId ? cached.snapshot : null);
    setJob(cached?.job?.marketplaceId === marketplaceId ? cached.job : null);
    setBusy(null);
    setError(null);
  }, [marketplaceId]);

  const scan = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("scan");
    setSnapshot(null);
    setJob(null);
    setError(null);
    try {
      let current = job;
      if (!current) {
        const started = await fetch("/api/sp-api/review-audit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ marketplaceId }),
          signal: controller.signal,
        });
        const startRaw = await started.json() as unknown;
        if (!started.ok) throw new Error(apiMessage(startRaw, "無法開始評論主題健檢。"));
        current = parseReviewAuditJob(startRaw, marketplaceId);
      }
      setJob(current);
      onCachedResultChange?.({ snapshot: null, job: current });
      while (!controller.signal.aborted) {
        const params = new URLSearchParams({ marketplaceId, jobId: current.jobId });
        const response = await fetch(`/api/sp-api/review-audit?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const raw = await response.json() as unknown;
        if (!response.ok && response.status !== 202) {
          throw new Error(apiMessage(raw, "評論主題健檢失敗。"));
        }
        if (response.status === 200) {
          const completed = parseReviewAuditSnapshot(raw, marketplaceId);
          setSnapshot(completed);
          setJob(null);
          onCachedResultChange?.({ snapshot: completed, job: null });
          break;
        }
        current = parseReviewAuditJob(raw, marketplaceId);
        setJob(current);
        onCachedResultChange?.({ snapshot: null, job: current });
        await delay(1_150, controller.signal);
      }
    } catch (scanError) {
      if (scanError instanceof Error && scanError.name === "AbortError") return;
      setError(scanError instanceof Error ? scanError.message : "評論主題健檢失敗。");
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  };

  useEffect(() => {
    const activeJob = cachedResultRef.current?.job;
    if (
      !activeJob ||
      activeJob.marketplaceId !== marketplaceId ||
      autoObservedJobRef.current === activeJob.jobId
    ) {
      return;
    }
    autoObservedJobRef.current = activeJob.jobId;
    void scan();
    // Re-opening the modal creates a new panel instance. Its cached main-owned
    // job is observed automatically; renderer unmount only stops local polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplaceId]);

  const exportExcel = async () => {
    if (!snapshot || busy) return;
    setBusy("export");
    setError(null);
    try {
      const params = new URLSearchParams({ marketplaceId, exportId: snapshot.exportId });
      const response = await fetch(`/api/sp-api/review-audit/export?${params}`, { cache: "no-store" });
      if (!response.ok) {
        let detail: unknown = null;
        try { detail = await response.json(); } catch { /* binary errors need not be JSON */ }
        throw new Error(apiMessage(detail, "評論主題 Excel 下載失敗。"));
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = auditExportFilename({
        kind: "review",
        marketplaceShort,
        fetchedAt: snapshot.fetchedAt,
      });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "評論主題 Excel 下載失敗。");
    } finally {
      setBusy(null);
    }
  };

  const supported = SUPPORTED.has(marketplaceId);
  return (
    <section className="review-audit-panel" aria-label="FBA 評論主題健檢">
      <header className="review-audit-hero">
        <div><p className="eyebrow">CUSTOMER FEEDBACK · NON-PARENT FBA ASIN</p><h3>評論健檢</h3></div>
        <span>{marketplaceShort}</span>
      </header>
      <p className="review-audit-intro">
        先用 Amazon Listings relationships 證明 FBA SKU 為 child 或 standalone，排除 parent 容器後，再讀取正／負評論主題與前五、後五。
      </p>
      <div className="review-audit-boundary" role="note">
        <strong>影響值不是商品星等，也不是 1–5 星制</strong>
        <p>starRatingImpact 是 Amazon 回傳的評論主題影響指標；負數是此負向主題對星等下降方向的影響值，不是商品出現「負的星星」。畫面保留 Amazon 原始正負號與數值，不轉成 0、不裁切，也不改成絕對值。公開 API 資料每週更新且僅英文，不提供完整 review 全文、商品平均星等或總評論數。Parent 容器不查詢；relationships 缺少、歧義或衝突會單獨列為未完成。</p>
      </div>
      {!supported && <div className="review-audit-unavailable" role="status">Customer Feedback API 在本 App 僅支援 US、JP、UK 與 DE 站。</div>}
      {error && <div className="review-audit-error" role="alert">{error}</div>}
      {job && (
        <div className="review-audit-progress" role="status">
          <strong>{job.message}</strong>
          <progress value={job.progress.percent} max={100}>{job.progress.percent}%</progress>
          <small>{job.capabilityNotice}</small>
          <small>關閉這個健檢小視窗後，本機主程序仍會在背景繼續；不必回來按按鈕，重新開啟即可查看最新進度。</small>
        </div>
      )}
      <div className="review-audit-actions">
        <button type="button" onClick={() => void scan()} disabled={!supported || Boolean(busy)}>
          {busy === "scan"
            ? "正在更新進度…"
            : job
              ? "查看進行中的評論健檢"
              : snapshot
                ? "重新掃描全站評論主題"
                : "掃描全站 FBA 評論主題"}
        </button>
        {snapshot && <button type="button" className="review-audit-export" onClick={() => void exportExcel()} disabled={Boolean(busy)}>{busy === "export" ? "正在建立 Excel…" : "匯出全部主題 Excel"}</button>}
      </div>
      {snapshot && (
        <>
          <div className="review-audit-summary">
            <span><strong>{snapshot.summary.uniqueFbaNonParentAsins}</strong> 非 parent ASIN</span>
            <span><strong>{snapshot.summary.verifiedChildListings}</strong> child SKU</span>
            <span><strong>{snapshot.summary.verifiedStandaloneListings}</strong> standalone SKU</span>
            <span><strong>{snapshot.summary.excludedParentContainers}</strong> 已排除 parent</span>
            <span><strong>{snapshot.summary.completed}</strong> 有主題</span>
            <span><strong>{snapshot.summary.noTopics}</strong> Amazon 無主題</span>
            <span><strong>{snapshot.summary.totalIncomplete}</strong> 未完成</span>
          </div>
          {snapshot.relationshipIncompleteRows.length > 0 && (
            <div className="review-audit-progress" role="note">
              <strong>{snapshot.relationshipIncompleteRows.length} 個 SKU 關係證據未完成，未查詢評論主題</strong>
              {snapshot.relationshipIncompleteRows.slice(0, 5).map((row) => (
                <small key={row.sellerSku}>{row.sellerSku}{row.asin ? ` · ${row.asin}` : ""}：{row.message}</small>
              ))}
              {snapshot.relationshipIncompleteRows.length > 5 && (
                <small>其餘 {snapshot.relationshipIncompleteRows.length - 5} 列請匯出 Excel 查看。</small>
              )}
            </div>
          )}
          <div className="review-audit-rankings">
            <section aria-labelledby="review-positive-title"><h4 id="review-positive-title">前五：正向主題影響值</h4>{snapshot.topFivePositive.map((item, index) => <article key={item.asin}><span>{index + 1}</span><div><strong>{item.title}</strong><small>{item.sellerSkus.join(" · ")} · {item.asin}</small><p>{item.topic}</p></div><b>{impactLabel(item.starRatingImpact, "positive")}</b></article>)}</section>
            <section aria-labelledby="review-negative-title"><h4 id="review-negative-title">後五：負向主題影響值</h4>{snapshot.bottomFiveNegative.map((item, index) => <article key={item.asin}><span>{index + 1}</span><div><strong>{item.title}</strong><small>{item.sellerSkus.join(" · ")} · {item.asin}</small><p>{item.topic}</p></div><b>{impactLabel(item.starRatingImpact, "negative")}</b></article>)}</section>
          </div>
          <p className="review-audit-notice">{snapshot.notice}</p>
        </>
      )}
    </section>
  );
}
