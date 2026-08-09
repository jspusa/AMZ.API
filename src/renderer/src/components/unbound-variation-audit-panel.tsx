"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseUnboundVariationAuditSnapshot,
  type UnboundVariationAuditSnapshot,
} from "../unbound-variation-audit";

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

export function downloadName(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  let candidate = fallback;
  try {
    candidate = utf8Match?.[1]
      ? decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""))
      : plainMatch?.[1]?.trim() ?? fallback;
  } catch {
    candidate = fallback;
  }
  return candidate.replace(/[\\/:*?"<>|]/g, "-");
}

export default function UnboundVariationAuditPanel({
  marketplaceId,
  marketplaceShort,
  onOpenSku,
  cachedResult = null,
  onCachedResultChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  onOpenSku: (sellerSku: string) => void;
  cachedResult?: UnboundVariationAuditCache | null;
  onCachedResultChange?: (cache: UnboundVariationAuditCache) => void;
}) {
  const initialCache = cachedResult?.snapshot.marketplaceId === marketplaceId
    ? cachedResult
    : null;
  const [state, setState] = useState<AuditState>(initialCache ? "done" : "idle");
  const [reply, setReply] = useState<ReportReply | null>(null);
  const [snapshot, setSnapshot] = useState<UnboundVariationAuditSnapshot | null>(
    initialCache?.snapshot ?? null,
  );
  const [query, setQuery] = useState(initialCache?.query ?? "");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const marketplaceIdRef = useRef(marketplaceId);
  marketplaceIdRef.current = marketplaceId;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    abortRef.current?.abort();
    setReply(null);
    setError(null);
    setExporting(false);
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

  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  const visibleRows = useMemo(
    () => snapshot?.rows.filter((row) =>
      !normalizedQuery || [row.sellerSku, row.asin, row.title, row.productType]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery),
    ) ?? [],
    [normalizedQuery, snapshot],
  );
  const visibleIncompleteRows = useMemo(
    () => snapshot?.incompleteRows.filter((row) =>
      !normalizedQuery || [row.sellerSku, row.asin, row.title, row.code, row.message]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery),
    ) ?? [],
    [normalizedQuery, snapshot],
  );

  const loadAudit = async (ready: ReportReply, signal: AbortSignal) => {
    if (!ready.reportId || !ready.documentId) {
      throw new Error("Amazon 沒有回傳完整的未綁變體報表資訊。");
    }
    setState("scanning");
    const params = new URLSearchParams({
      marketplaceId,
      reportId: ready.reportId,
      documentId: ready.documentId,
      data: "1",
    });
    const response = await fetch(`/api/sp-api/variation-audit?${params}`, {
      cache: "no-store",
      signal,
    });
    const raw = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(problemMessage(raw as ApiProblem, "未綁變體健檢失敗。"));
    }
    const completed = parseUnboundVariationAuditSnapshot(
      raw,
      marketplaceIdRef.current,
    );
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
      const startResponse = await fetch("/api/sp-api/variation-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceId }),
        signal: controller.signal,
      });
      const startRaw = (await startResponse.json()) as Record<string, unknown>;
      if (!startResponse.ok) {
        throw new Error(problemMessage(startRaw, "無法開始未綁變體健檢。"));
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
        const pollResponse = await fetch(`/api/sp-api/variation-audit?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const pollRaw = (await pollResponse.json()) as Record<string, unknown>;
        if (!pollResponse.ok) {
          throw new Error(problemMessage(pollRaw, "未綁變體報表狀態查詢失敗。"));
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
      throw new Error("未綁變體健檢超過三分鐘，請稍後再試。");
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setState(snapshot ? "done" : "idle");
      setError(requestError instanceof Error ? requestError.message : "目前無法完成未綁變體健檢。");
    }
  };

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
      anchor.download = downloadName(
        response,
        `FBA-未綁變體健檢-${marketplaceShort}.xlsx`,
      );
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

  const statusText = state === "starting"
    ? "正在請 Amazon 建立全站 FBA 商品報表…"
    : state === "polling"
      ? reply?.message || "Amazon 正在整理 FBA 商品清單…"
      : state === "scanning"
        ? "正在逐一核對 Listings relationships；缺資料會另列未完成…"
        : "";

  return (
    <section className="image-audit-panel" aria-label="全站 FBA 未綁變體健檢">
      <p className="price-intro">
        一次掃描所選站點全部可由報表證明為 FBA 的 SKU；只有 Amazon relationships 明確完整且沒有 parent，才列為未綁變體。
      </p>
      <div className="content-export-note">
        <strong>Amazon 唯讀＋Fail closed</strong>
        <p>relationships 缺少、相容降級、履約衝突或查詢失敗都獨立列為未完成，不會誤判為未綁；健檢不會修改 Amazon。</p>
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
          {state === "idle" ? `掃描 ${marketplaceShort} 全部 FBA 變體關係` : "未綁變體健檢進行中…"}
        </button>
      )}
      {state === "done" && snapshot && (
        <>
          <div className="image-audit-summary" aria-label="未綁變體健檢摘要">
            <article><span>全部 FBA SKU</span><strong>{snapshot.summary.totalFbaListings.toLocaleString()}</strong></article>
            <article><span>確定未綁</span><strong>{snapshot.summary.unbound.toLocaleString()}</strong></article>
            <article><span>讀取未完成</span><strong>{snapshot.summary.incomplete.toLocaleString()}</strong></article>
          </div>
          <button
            type="button"
            className="content-audit-export-primary"
            onClick={() => void exportExcel()}
            disabled={exporting}
          >
            <span aria-hidden="true">↧</span>
            <strong>{exporting ? "正在建立 Excel…" : "匯出未綁變體＋讀取未完成 Excel"}</strong>
            <small>兩張工作表；只含本次 Amazon FBA 唯讀快照</small>
          </button>
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
            <button type="button" onClick={() => void startAudit()}>重新掃描</button>
          </div>
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
          </div>
          <p className="variation-warning">{snapshot.notice}</p>
        </>
      )}
    </section>
  );
}
