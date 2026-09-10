"use client";

import { auditViewScope, useAuditPosition } from "../audit-view-session";
import AuditSkuFilter, { useAuditSkuBatch } from "./audit-sku-filter";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseUnboundVariationAuditSnapshot,
  type UnboundVariationAuditSnapshot,
  type UnboundVariationAuditRow,
} from "../unbound-variation-audit";
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
import AuditDetailsDisclosure from "./audit-details-disclosure";
import type { UnboundFamilyRecommendation } from "../../../shared/unbound-family-recommendations";

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

export type UnboundVariationAuditCache = {
  snapshot: UnboundVariationAuditSnapshot;
  query: string;
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

export default function UnboundVariationAuditPanel({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  onOpenSku,
  cachedResult = null,
  onCachedResultChange,
  initialJob = null,
  onJobChange,
  presentation = "audit",
  disabled = false,
  onSelectUnbound,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  onOpenSku: (sellerSku: string) => void;
  cachedResult?: UnboundVariationAuditCache | null;
  onCachedResultChange?: (cache: UnboundVariationAuditCache) => void;
  initialJob?: StandaloneAuditJob | null;
  onJobChange?: (job: StandaloneAuditJob) => void;
  presentation?: "audit" | "picker";
  disabled?: boolean;
  onSelectUnbound?: (
    row: UnboundVariationAuditRow,
    recommendation: UnboundFamilyRecommendation | null,
  ) => void;
}) {
  const matchingInitialJob = initialJob?.kind === "variation" &&
      initialJob.marketplaceId === marketplaceId &&
      initialJob.mode === mode
    ? initialJob
    : null;
  const candidateInitialCache = cachedResult?.snapshot.marketplaceId === marketplaceId &&
      cachedResult.snapshot.mode === mode
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
  const [snapshot, setSnapshot] = useState<UnboundVariationAuditSnapshot | null>(
    initialCache?.snapshot ?? null,
  );
  const viewScope = auditViewScope("variation", marketplaceId, mode, snapshot?.fetchedAt);
  const skuBatch = useAuditSkuBatch(viewScope);
  const positionRef = useAuditPosition(viewScope, Boolean(snapshot) && state === "done");
  const [query, setQuery] = useState(initialCache?.query ?? "");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(initialJobError);
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
    const matchingJob = initialJob?.kind === "variation" &&
        initialJob.marketplaceId === marketplaceId &&
        initialJob.mode === mode
      ? initialJob
      : null;
    setError(matchingJob?.ready && matchingJob.status !== "completed"
      ? matchingJob.error.message
      : null);
    if (
      cachedResult?.snapshot.marketplaceId === marketplaceId &&
      cachedResult.snapshot.mode === mode &&
      standaloneAuditSnapshotMatchesJob(cachedResult.snapshot, matchingJob)
    ) {
      setState("done");
      setSnapshot(cachedResult.snapshot);
      setQuery(cachedResult.query);
    } else {
      setState("idle");
      setSnapshot(null);
      setQuery("");
    }
  }, [cachedResult, initialJobReconnectRevision, marketplaceId, mode]);

  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  const visibleRows = useMemo(
    () => snapshot?.rows.filter((row) =>
      skuBatch.matches(row.sellerSku) && (!normalizedQuery || [row.sellerSku, row.asin, row.title, row.productType]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery)),
    ) ?? [],
    [normalizedQuery, snapshot, skuBatch.skus],
  );
  const visibleIncompleteRows = useMemo(
    () => snapshot?.incompleteRows.filter((row) =>
      skuBatch.matches(row.sellerSku) && (!normalizedQuery || [row.sellerSku, row.asin, row.title, row.code, row.message]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery)),
    ) ?? [],
    [normalizedQuery, snapshot, skuBatch.skus],
  );

  const loadAudit = async (
    completedJob: StandaloneAuditJob,
    signal: AbortSignal,
  ) => {
    if (!completedJob.ready || completedJob.status !== "completed") {
      throw new Error(
        completedJob.ready
          ? completedJob.error.message
          : "未綁變體背景工作尚未完成。",
      );
    }
    setState("scanning");
    const completed = parseUnboundVariationAuditSnapshot(
      completedJob.snapshot,
      marketplaceIdRef.current,
    );
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    setSnapshot(completed);
    setQuery("");
    setState("done");
    onCachedResultChange?.({ snapshot: completed, query: "" });
  };

  const startAudit = async () => {
    if (disabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("starting");
    setReply(null);
    setError(null);
    setSnapshot(null);
    setQuery("");
    try {
      let current = await startStandaloneAuditJob({
        kind: "variation",
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
      setError(requestError instanceof Error ? requestError.message : "目前無法完成未綁變體健檢。");
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
      expectedKind: "variation",
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
          : "目前無法接續未綁變體健檢。");
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

  const exportExcel = async () => {
    if (!snapshot || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        exportId: snapshot.exportId,
        download: "1",
      });
      const response = await fetch(`/api/sp-api/variation-audit?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        let payload: ApiProblem = {};
        try {
          payload = (await response.json()) as ApiProblem;
        } catch {
          // Use local fallback; response bodies never contain credentials.
        }
        throw new Error(problemMessage(payload, "目前無法匯出未綁變體 Excel。"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = auditExportFilename({
        kind: "variation",
        marketplaceShort,
        fetchedAt: snapshot.fetchedAt,
      });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "目前無法匯出 Excel。");
    } finally {
      setExporting(false);
    }
  };

  const statusText = job && !job.ready
    ? job.progress.message
    : state === "starting"
    ? "正在請 Amazon 建立全站 FBA 商品報表…"
    : state === "polling"
      ? reply?.message || "Amazon 正在整理 FBA 商品清單…"
      : state === "scanning"
        ? "正在逐一核對 Listings relationships；缺資料會另列未完成…"
        : "";

  return (
    <section ref={positionRef} className="image-audit-panel" aria-label="全站 FBA 未綁變體健檢">
      <AuditDetailsDisclosure summary="relationship 判定、未完成隔離與唯讀範圍">
        <p className="price-intro">
          一次掃描所選站點全部可由報表證明為 FBA 的 SKU；只有 Amazon relationships 明確完整且沒有 parent，才列為未綁變體。
        </p>
        <div className="content-export-note">
          <strong>Amazon 唯讀＋Fail closed</strong>
          <p>relationships 缺少、相容降級、履約衝突或查詢失敗都獨立列為未完成，不會誤判為未綁；健檢不會修改 Amazon。</p>
        </div>
      </AuditDetailsDisclosure>
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
          disabled={disabled || state !== "idle"}
        >
          {state === "idle" ? `掃描 ${marketplaceShort} 全部 FBA 變體關係` : "未綁變體健檢進行中…"}
        </button>
      )}
      {state === "done" && snapshot && (
        <>
          <AuditSkuFilter scope={viewScope} skus={skuBatch.skus}
            availableSkus={[...snapshot.rows, ...snapshot.incompleteRows].map(row => row.sellerSku)}
            disabled={exporting} onChange={skuBatch.setSkus} />
          <div className="image-audit-summary" aria-label="未綁變體健檢摘要">
            <article><span>全部 FBA SKU</span><strong>{snapshot.summary.totalFbaListings.toLocaleString()}</strong></article>
            <article><span>確定未綁</span><strong>{snapshot.summary.unbound.toLocaleString()}</strong></article>
            <article><span>讀取未完成</span><strong>{snapshot.summary.incomplete.toLocaleString()}</strong></article>
          </div>
          {presentation === "audit" && <button
            type="button"
            className="content-audit-export-primary"
            onClick={() => void exportExcel()}
            disabled={exporting}
          >
            <span aria-hidden="true">↧</span>
            <strong>{exporting ? "正在建立 Excel…" : "匯出未綁變體＋讀取未完成＋所有變體 Excel"}</strong>
            <small>4 張工作表（含「所有變體」與「父變體橫排」）；只含本次 Amazon FBA 唯讀快照</small>
          </button>}
          <div className="audit-toolbar">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                onCachedResultChange?.({ snapshot, query: next });
              }}
              placeholder="搜尋 SKU、ASIN、商品名稱或狀態"
              aria-label="搜尋未綁變體健檢結果"
            />
            <button type="button" disabled={disabled} onClick={() => void startAudit()}>重新掃描</button>
          </div>
          {presentation === "picker" ? (
            <>
              <p className="variation-form-note">
                已確認未綁的 FBA 商品可直接準備綁定。資料時間：
                {new Date(snapshot.fetchedAt).toLocaleString("zh-TW")}
              </p>
              <div
                className="variation-table-scroll variation-source-table"
                tabIndex={0}
              >
                <table
                  className="variation-unbound-table"
                  aria-label="可直接綁定的未綁 FBA 商品"
                >
                  <colgroup>
                    <col style={{ width: 120 }} />
                    <col style={{ width: 180 }} />
                    <col />
                    <col style={{ width: 260 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>操作</th>
                      <th>Seller SKU／ASIN</th>
                      <th>商品名稱</th>
                      <th>Family 建議</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const recommendation =
                        snapshot.recommendations?.find(
                          (item) => item.sellerSku === row.sellerSku,
                        ) ?? null;
                      const first = recommendation?.candidates[0];
                      return (
                        <tr key={row.sellerSku}>
                          <td>
                            <button
                              type="button"
                              disabled={disabled}
                              aria-label={`準備綁定 ${row.sellerSku}`}
                              onClick={() =>
                                onSelectUnbound?.(row, recommendation)
                              }
                            >
                              準備綁定
                            </button>
                          </td>
                          <td>
                            <strong>{row.sellerSku}</strong>
                            <small>{row.asin}</small>
                          </td>
                          <td>
                            <span
                              className="variation-cell-clamp"
                              title={row.title}
                            >
                              {row.title}
                            </span>
                            <small>{row.productType}</small>
                          </td>
                          <td>
                            {first ? (
                              <>
                                <strong>
                                  {"★".repeat(first.stars)}
                                  {"☆".repeat(3 - first.stars)}{" "}
                                  {recommendation?.status === "tied"
                                    ? "同分候選"
                                    : "參考建議"}
                                </strong>
                                <span>{first.parentSku}</span>
                                <small>
                                  {first.matchingChildCount} 個同系列 SKU
                                  {recommendation?.status === "tied"
                                    ? " · 請比較候選"
                                    : ""}
                                </small>
                              </>
                            ) : (
                              <span>☆ 無足夠建議 · 可手動選目標</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!visibleRows.length && (
                      <tr>
                        <td colSpan={4}>沒有符合搜尋條件的確定未綁 SKU。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {snapshot.summary.incomplete > 0 && (
                <p className="variation-warning">
                  {snapshot.summary.incomplete} 個 SKU
                  讀取未完成，不列入可綁清單；可回「未綁變體健檢」查看原因。
                </p>
              )}
            </>
          ) : (
          <div className="image-audit-results">
            <h3>確定沒有 parent relationship</h3>
            {visibleRows.map((row) => (
              <article className="image-audit-row" key={row.sellerSku}>
                <div><strong>◇</strong></div>
                <div>
                  <strong>{row.title || row.sellerSku}</strong>
                  <p>{row.sellerSku}{row.asin ? ` · ${row.asin}` : ""}</p>
                  <small>{row.productType} · {row.notice}</small>
                </div>
                <button type="button" onClick={() => onOpenSku(row.sellerSku)}>開啟變體</button>
              </article>
            ))}
            {!visibleRows.length && <p className="variation-empty">沒有符合搜尋條件的確定未綁 SKU。</p>}
            <h3>讀取未完成（不列為未綁）</h3>
            {visibleIncompleteRows.map((row) => (
              <article className="image-audit-row" key={row.sellerSku}>
                <div><strong>!</strong></div>
                <div>
                  <strong>{row.title || row.sellerSku}</strong>
                  <p>{row.sellerSku}{row.asin ? ` · ${row.asin}` : ""}</p>
                  <small className="variation-warning">{row.code} · {row.message}</small>
                </div>
                <button type="button" onClick={() => onOpenSku(row.sellerSku)}>唯讀查看</button>
              </article>
            ))}
            {!visibleIncompleteRows.length && <p className="variation-empty">沒有符合搜尋條件的未完成項目。</p>}
          </div>)}
          {presentation === "audit" && <p className="variation-warning">{snapshot.notice}</p>}
        </>
      )}
    </section>
  );
}
