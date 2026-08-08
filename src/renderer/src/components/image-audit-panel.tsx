"use client";

/* eslint-disable @next/next/no-img-element -- Amazon listing URLs are dynamic */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  imageAuditAttentionRows,
  parseImageAuditSnapshot,
  type ImageAuditSnapshot,
} from "../image-audit";

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

export default function ImageAuditPanel({
  marketplaceId,
  marketplaceShort,
  onOpenSku,
  cachedResult = null,
  onCachedResultChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  onOpenSku: (sellerSku: string) => void;
  cachedResult?: ImageAuditCache | null;
  onCachedResultChange?: (cache: ImageAuditCache) => void;
}) {
  const initialCache = cachedResult?.snapshot.marketplaceId === marketplaceId
    ? cachedResult
    : null;
  const [state, setState] = useState<AuditState>(initialCache ? "done" : "idle");
  const [reply, setReply] = useState<ReportReply | null>(null);
  const [snapshot, setSnapshot] = useState<ImageAuditSnapshot | null>(
    initialCache?.snapshot ?? null,
  );
  const [query, setQuery] = useState(initialCache?.query ?? "");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const marketplaceIdRef = useRef(marketplaceId);
  marketplaceIdRef.current = marketplaceId;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    abortRef.current?.abort();
    setReply(null);
    setError(null);
    if (cachedResult?.snapshot.marketplaceId === marketplaceId) {
      setState("done");
      setSnapshot(cachedResult.snapshot);
      setQuery(cachedResult.query);
    } else {
      setState("idle");
      setSnapshot(null);
      setQuery("");
    }
  }, [cachedResult, marketplaceId]);

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

  const loadAudit = async (ready: ReportReply, signal: AbortSignal) => {
    if (!ready.reportId || !ready.documentId) {
      throw new Error("Amazon 沒有回傳完整的報表文件資訊。");
    }
    setState("scanning");
    const params = new URLSearchParams({
      marketplaceId,
      reportId: ready.reportId,
      documentId: ready.documentId,
      imageAudit: "1",
    });
    const response = await fetch(`/api/sp-api/listing-content/export?${params}`, {
      cache: "no-store",
      signal,
    });
    const raw = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(problemMessage(raw as ApiProblem, "全站圖片健檢失敗。"));
    }
    const completed = parseImageAuditSnapshot(raw, marketplaceIdRef.current);
    setSnapshot(completed);
    setQuery("");
    setState("done");
    onCachedResultChange?.({ snapshot: completed, query: "" });
  };

  const startAudit = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("starting");
    setReply(null);
    setError(null);
    try {
      const startResponse = await fetch("/api/sp-api/listing-content/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceId }),
        signal: controller.signal,
      });
      const startRaw = (await startResponse.json()) as Record<string, unknown>;
      if (!startResponse.ok) {
        throw new Error(problemMessage(startRaw as ApiProblem, "無法開始圖片健檢。"));
      }
      let current = reportReply(startRaw);
      setReply(current);
      if (current.ready) {
        await loadAudit(current, controller.signal);
        return;
      }
      if (!current.reportId) throw new Error("Amazon 沒有回傳可追蹤的報表 ID。");
      const reportId = current.reportId;
      setState("polling");
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await delay(2_000, controller.signal);
        const params = new URLSearchParams({ marketplaceId, reportId });
        const pollResponse = await fetch(
          `/api/sp-api/listing-content/export?${params}`,
          { cache: "no-store", signal: controller.signal },
        );
        const pollRaw = (await pollResponse.json()) as Record<string, unknown>;
        if (!pollResponse.ok) {
          throw new Error(problemMessage(pollRaw as ApiProblem, "報表狀態查詢失敗。"));
        }
        current = reportReply({ ...pollRaw, reportId });
        setReply(current);
        if (["CANCELLED", "CANCELED", "FATAL", "FAILED"].includes(
          current.status?.toUpperCase() ?? "",
        )) {
          throw new Error(current.message || `Amazon 報表狀態為 ${current.status}。`);
        }
        if (current.ready) {
          await loadAudit(current, controller.signal);
          return;
        }
      }
      throw new Error("圖片健檢超過三分鐘，請稍後再試。");
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setState(snapshot ? "done" : "idle");
      setError(requestError instanceof Error ? requestError.message : "目前無法完成圖片健檢。");
    }
  };

  const statusText = state === "starting"
    ? "正在請 Amazon 建立全站 FBA 商品報表…"
    : state === "polling"
      ? reply?.message || "Amazon 正在整理商品清單…"
      : state === "scanning"
        ? "正在逐一核對 FBA Listing 圖片…"
        : "";

  return (
    <section className="image-audit-panel" aria-label="全站 FBA 圖片健檢">
      <p className="price-intro">
        一次掃描所選站點全部 FBA SKU，列出少於五張 Listing 圖片的商品；讀取未完成會獨立標示，不會誤判成零張。
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
            <article><span>全部 FBA SKU</span><strong>{snapshot.summary.total.toLocaleString()}</strong></article>
            <article><span>少於 5 張</span><strong>{snapshot.summary.underMinimum.toLocaleString()}</strong></article>
            <article><span>讀取未完成</span><strong>{snapshot.summary.incomplete.toLocaleString()}</strong></article>
          </div>
          <div className="audit-toolbar">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                onCachedResultChange?.({ snapshot, query: next });
              }}
              placeholder="搜尋 SKU、ASIN 或商品名稱"
              aria-label="搜尋圖片健檢結果"
            />
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
                    ? <small className="image-audit-count">目前 {row.imageCount} 張 · 還差 {Math.max(0, snapshot.minimumImages - row.imageCount)} 張達到 5 張</small>
                    : <small className="variation-warning">讀取未完成：{row.readErrors.map((item) => item.message).join("；")}</small>}
                </div>
                <button type="button" onClick={() => onOpenSku(row.sellerSku)}>開啟圖片工作台</button>
              </article>
            ))}
            {!visibleRows.length && (
              <p className="variation-empty">
                {attentionRows.length ? "沒有符合搜尋條件的商品。" : "目前沒有少於五張圖片或讀取未完成的 FBA SKU。"}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
