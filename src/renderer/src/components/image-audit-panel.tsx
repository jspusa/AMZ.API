"use client";

/* eslint-disable @next/next/no-img-element -- Amazon listing URLs are dynamic */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadImageAuditWorkbook,
  imageAuditAttentionRows,
  parseImageAuditSnapshot,
  summarizeImageAudit,
  type ImageAuditSnapshot,
} from "../image-audit";
import { auditExportFilename } from "../audit-export-filename";
import {
  pollStandaloneAuditJob,
  shouldResumeStandaloneAuditJob,
  startStandaloneAuditJob,
  standaloneAuditReconnectRevision,
  standaloneAuditSnapshotMatchesJob,
  type StandaloneAuditJob,
  type StandaloneAuditMode,
} from "../standalone-audit";

type ApiProblem = { message?: string; requestId?: string | null };
type AuditState = "idle" | "starting" | "polling" | "scanning" | "done";
type ReportReply = {
  ready: boolean;
  reportId: string | null;
  documentId: string | null;
  status: string | null;
  progress: number | null;
  message: string | null;
};

export type ImageAuditCache = {
  snapshot: ImageAuditSnapshot;
  query: string;
  reportId: string;
  documentId: string;
  exportId: string;
};

function reportReply(raw: Record<string, unknown>): ReportReply {
  const reportId = raw.reportId ?? raw.report_id;
  const documentId = raw.documentId ?? raw.reportDocumentId ?? raw.document_id;
  return {
    ready: raw.ready === true,
    reportId: typeof reportId === "string" ? reportId : null,
    documentId: typeof documentId === "string" ? documentId : null,
    status: typeof raw.status === "string" ? raw.status : null,
    progress: typeof raw.progress === "number" && Number.isFinite(raw.progress)
      ? raw.progress
      : null,
    message: typeof raw.message === "string" ? raw.message : null,
  };
}

function problemMessage(payload: ApiProblem, fallback: string): string {
  const requestId = payload.requestId ? `（Request ID: ${payload.requestId}）` : "";
  return `${payload.message || fallback}${requestId}`;
}

export function parseImageAuditExportId(raw: unknown): string {
  const exportId = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { exportId?: unknown }).exportId
    : null;
  if (typeof exportId !== "string" || !/^[A-Za-z0-9-]{8,120}$/u.test(exportId)) {
    throw new Error("圖片健檢缺少可安全匯出的同次快照，請重新掃描。");
  }
  return exportId;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default function ImageAuditPanel({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  onOpenSku,
  cachedResult = null,
  onCachedResultChange,
  initialJob = null,
  onJobChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  onOpenSku: (sellerSku: string) => void;
  cachedResult?: ImageAuditCache | null;
  onCachedResultChange?: (cache: ImageAuditCache) => void;
  initialJob?: StandaloneAuditJob | null;
  onJobChange?: (job: StandaloneAuditJob) => void;
}) {
  const matchingInitialJob = initialJob?.kind === "image" &&
      initialJob.marketplaceId === marketplaceId &&
      initialJob.mode === mode
    ? initialJob
    : null;
  const candidateInitialCache = cachedResult?.snapshot.marketplaceId === marketplaceId
    ? cachedResult
    : null;
  const initialCache = candidateInitialCache && standaloneAuditSnapshotMatchesJob(
    candidateInitialCache.snapshot,
    matchingInitialJob,
  ) ? candidateInitialCache : null;
  const initialJobError = matchingInitialJob?.ready &&
      matchingInitialJob.status !== "completed"
    ? matchingInitialJob.error.message
    : null;
  const [state, setState] = useState<AuditState>(initialCache ? "done" : "idle");
  const [reply, setReply] = useState<ReportReply | null>(null);
  const [job, setJob] = useState<StandaloneAuditJob | null>(
    matchingInitialJob,
  );
  const [snapshot, setSnapshot] = useState<ImageAuditSnapshot | null>(
    initialCache?.snapshot ?? null,
  );
  const [reportReference, setReportReference] = useState<{
    reportId: string;
    documentId: string;
    exportId: string;
  } | null>(
    initialCache
      ? {
          reportId: initialCache.reportId,
          documentId: initialCache.documentId,
          exportId: initialCache.exportId,
        }
      : null,
  );
  const [query, setQuery] = useState(initialCache?.query ?? "");
  const [error, setError] = useState<string | null>(initialJobError);
  const [exporting, setExporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const observerJobIdRef = useRef<string | null>(null);
  const marketplaceIdRef = useRef(marketplaceId);
  marketplaceIdRef.current = marketplaceId;
  const initialJobReconnectRevision = standaloneAuditReconnectRevision(initialJob);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    abortRef.current?.abort();
    setReply(null);
    setExporting(false);
    const matchingJob = initialJob?.kind === "image" &&
        initialJob.marketplaceId === marketplaceId &&
        initialJob.mode === mode
      ? initialJob
      : null;
    setError(matchingJob?.ready && matchingJob.status !== "completed"
      ? matchingJob.error.message
      : null);
    if (
      cachedResult?.snapshot.marketplaceId === marketplaceId &&
      standaloneAuditSnapshotMatchesJob(cachedResult.snapshot, matchingJob)
    ) {
      setState("done");
      setSnapshot(cachedResult.snapshot);
      setQuery(cachedResult.query);
      setReportReference({
        reportId: cachedResult.reportId,
        documentId: cachedResult.documentId,
        exportId: cachedResult.exportId,
      });
    } else {
      setState("idle");
      setSnapshot(null);
      setQuery("");
      setReportReference(null);
    }
  }, [cachedResult, initialJobReconnectRevision, marketplaceId, mode]);

  const attentionRows = useMemo(
    () => snapshot ? imageAuditAttentionRows(snapshot) : [],
    [snapshot],
  );
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-US");
    if (!normalized) return attentionRows;
    return attentionRows.filter((row) =>
      [row.sellerSku, row.asin, row.title]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalized),
    );
  }, [attentionRows, query]);

  const loadAudit = async (
    completedJob: StandaloneAuditJob,
    signal: AbortSignal,
  ) => {
    if (!completedJob.ready || completedJob.status !== "completed") {
      throw new Error(
        completedJob.ready
          ? completedJob.error.message
          : "圖片健檢背景工作尚未完成。",
      );
    }
    setState("scanning");
    const exportId = parseImageAuditExportId(completedJob.snapshot);
    const completed = parseImageAuditSnapshot(
      completedJob.snapshot,
      marketplaceIdRef.current,
    );
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const reference = {
      reportId: completedJob.jobId,
      documentId: completedJob.contextId,
      exportId,
    };
    setSnapshot(completed);
    setReportReference(reference);
    setQuery("");
    setState("done");
    onCachedResultChange?.({ snapshot: completed, query: "", ...reference });
  };

  const downloadExcel = async () => {
    if (!reportReference || !snapshot || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        exportId: reportReference.exportId,
        imageAudit: "1",
        download: "1",
      });
      const response = await fetch(
        `/api/sp-api/listing-content/export?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        let message = "圖片健檢 Excel 下載失敗，請重新掃描。";
        try {
          message = problemMessage(
            (await response.json()) as ApiProblem,
            message,
          );
        } catch {
          // A failed binary response is not guaranteed to contain JSON.
        }
        throw new Error(message);
      }
      // Main revalidates the short-lived, account-scoped audit snapshot first.
      // The renderer then generates the workbook from the same filtered rows
      // shown on screen, so relationships-proven parent containers stay out.
      downloadImageAuditWorkbook(
        snapshot,
        marketplaceShort,
        auditExportFilename({
          kind: "image",
          marketplaceShort,
          fetchedAt: snapshot.fetchedAt,
        }),
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "圖片健檢 Excel 下載失敗，請重新掃描。",
      );
    } finally {
      setExporting(false);
    }
  };

  const startAudit = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("starting");
    setReply(null);
    setError(null);
    setSnapshot(null);
    setReportReference(null);
    setQuery("");
    try {
      let current = await startStandaloneAuditJob({
        kind: "image",
        marketplaceId,
        mode,
        signal: controller.signal,
      });
      observerJobIdRef.current = current.jobId;
      setJob(current);
      onJobChange?.(current);
      setState("polling");
      current = await pollStandaloneAuditJob({
        expected: current,
        signal: controller.signal,
        onProgress: (next) => {
          setJob(next);
          onJobChange?.(next);
        },
      });
      setJob(current);
      onJobChange?.(current);
      await loadAudit(current, controller.signal);
      observerJobIdRef.current = null;
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setState("idle");
      setError(requestError instanceof Error ? requestError.message : "目前無法完成圖片健檢。");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (!shouldResumeStandaloneAuditJob({
      initialJob,
      expectedKind: "image",
      marketplaceId,
      mode,
      observerJobId: observerJobIdRef.current,
    })) return;
    const observedJob = initialJob!;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    observerJobIdRef.current = observedJob.jobId;
    setJob(observedJob);
    setState(observedJob.ready ? "scanning" : "polling");
    void (async () => {
      try {
        const terminal = observedJob.ready
          ? observedJob
          : await pollStandaloneAuditJob({
              expected: observedJob,
              signal: controller.signal,
              onProgress: (next) => {
                setJob(next);
                onJobChange?.(next);
              },
            });
        setJob(terminal);
        onJobChange?.(terminal);
        await loadAudit(terminal, controller.signal);
      } catch (resumeError) {
        if (resumeError instanceof Error && resumeError.name === "AbortError") return;
        setState("idle");
        setError(resumeError instanceof Error
          ? resumeError.message
          : "目前無法接續圖片健檢。");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          observerJobIdRef.current = null;
        }
      }
    })();
    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobReconnectRevision, marketplaceId, mode]);

  const statusText = job && !job.ready
    ? job.progress.message
    : state === "starting"
    ? "正在請 Amazon 建立全站 FBA 商品報表…"
    : state === "polling"
      ? reply?.message || "Amazon 正在整理商品清單…"
      : state === "scanning"
        ? "正在逐一核對 FBA Listing 圖片…"
        : "";

  return (
    <section className="image-audit-panel" aria-label="全站 FBA 圖片健檢">
      <p className="price-intro">
        一次掃描所選站點全部 FBA SKU，先以 Amazon relationships 排除沒有圖片工作台的 parent 容器，再列出少於六張 Listing 圖片的商品；讀取未完成會獨立標示，不會誤判成零張。
      </p>
      <div className="content-export-note">
        <strong>Amazon 唯讀圖片健檢</strong>
        <p>只讀取 Listings attributes；不會下載原圖、不會修改 Amazon，也不會納入 FBM。</p>
      </div>
      {error && <div className="price-error" role="alert">{error}</div>}
      {statusText && (
        <div className="validation-status demo" role="status" aria-live="polite">
          <strong>{statusText}</strong>
          {reply?.progress !== null && reply?.progress !== undefined && (
            <p>Amazon 報表進度 {Math.max(0, Math.min(100, Math.round(reply.progress)))}%</p>
          )}
        </div>
      )}
      {state !== "done" && (
        <button
          className="price-primary-button"
          type="button"
          onClick={() => void startAudit()}
          disabled={state !== "idle"}
        >
          {state === "idle" ? `掃描 ${marketplaceShort} 全部 FBA 圖片` : "圖片健檢進行中…"}
        </button>
      )}
      {state === "done" && snapshot && (
        <>
          <div className="image-audit-summary" aria-label="圖片健檢摘要">
            <article><span>可健檢 FBA SKU</span><strong>{snapshot.summary.total.toLocaleString()}</strong></article>
            <article><span>少於 {snapshot.minimumImages} 張</span><strong>{snapshot.summary.underMinimum.toLocaleString()}</strong></article>
            <article><span>讀取未完成</span><strong>{snapshot.summary.incomplete.toLocaleString()}</strong></article>
          </div>
          <div className="audit-toolbar">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                if (reportReference) {
                  onCachedResultChange?.({
                    snapshot,
                    query: next,
                    ...reportReference,
                  });
                }
              }}
              placeholder="搜尋 SKU、ASIN 或商品名稱"
              aria-label="搜尋圖片健檢結果"
            />
            <button
              type="button"
              onClick={() => void downloadExcel()}
              disabled={!reportReference || exporting}
            >
              {exporting ? "匯出中…" : "匯出 Excel"}
            </button>
            <button type="button" onClick={() => void startAudit()}>重新掃描</button>
          </div>
          <div className="image-audit-results">
            {visibleRows.map((row) => (
              <article className="image-audit-row" key={row.sellerSku}>
                <div className="image-audit-thumbnail">
                  {row.imageUrls[0]
                    ? <img src={row.imageUrls[0]} alt="" loading="lazy" />
                    : <span aria-hidden="true">□</span>}
                </div>
                <div>
                  <strong>{row.title || row.sellerSku}</strong>
                  <p>{row.sellerSku}{row.asin ? ` · ${row.asin}` : ""}</p>
                  {row.readStatus === "complete"
                    ? <small className="image-audit-count">目前 {row.imageCount} 張 · 還差 {Math.max(0, snapshot.minimumImages - row.imageCount)} 張達到 {snapshot.minimumImages} 張</small>
                    : <small className="variation-warning">讀取未完成：{row.readErrors.map((item) => item.message).join("；")}</small>}
                </div>
                <button type="button" onClick={() => onOpenSku(row.sellerSku)}>開啟圖片工作台</button>
              </article>
            ))}
            {!visibleRows.length && (
              <p className="variation-empty">
                {attentionRows.length ? "沒有符合搜尋條件的商品。" : "目前沒有少於六張圖片或讀取未完成的 FBA SKU。"}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
