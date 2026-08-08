"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addLocalSpellcheckIssues,
  contentHighlightSegments,
  isInvisibleCharacterIssue,
  LOCAL_SPELLCHECK_WORD_LIMIT,
  locateInvisibleCharacters,
  summarizeContentAudit,
  wordsForLocalSpellcheck,
  type ContentAuditIssue,
  type ContentAuditIssueKind,
  type ContentAuditReadError,
  type ContentAuditRow,
  type ContentAuditSnapshot,
} from "../content-quality";
import {
  contentAuditAttentionRows,
  downloadContentAuditWorkbook,
} from "../content-audit-excel";

type ApiProblem = { message?: string; requestId?: string | null };

type ReportReply = {
  ready: boolean;
  reportId: string | null;
  documentId: string | null;
  status: string | null;
  progress: number | null;
  message: string | null;
};

type AuditState = "idle" | "starting" | "polling" | "scanning" | "done";
export type AuditFilter = "all" | "READ_INCOMPLETE" | ContentAuditIssueKind;

export type ContentAuditCache = {
  snapshot: ContentAuditSnapshot;
  filter: AuditFilter;
  query: string;
  spellcheckNote: string | null;
};

const FILTERS: Array<{ value: AuditFilter; label: string }> = [
  { value: "all", label: "全部問題" },
  { value: "SUSPECTED_TYPO", label: "疑似錯字" },
  { value: "MISSING_BULLETS", label: "賣點不足" },
  { value: "MISSING_INGREDIENTS", label: "缺成分" },
  { value: "INGREDIENTS_UNVERIFIED", label: "成分未驗證" },
  { value: "READ_INCOMPLETE", label: "讀取未完成" },
];

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

function reportReply(raw: Record<string, unknown>): ReportReply {
  const reportId = raw.reportId ?? raw.report_id;
  const documentId = raw.documentId ?? raw.reportDocumentId ?? raw.document_id;
  return {
    ready: raw.ready === true,
    reportId: typeof reportId === "string" ? reportId : null,
    documentId: typeof documentId === "string" ? documentId : null,
    status: typeof raw.status === "string" ? raw.status : null,
    progress:
      typeof raw.progress === "number" && Number.isFinite(raw.progress)
        ? raw.progress
        : null,
    message: typeof raw.message === "string" ? raw.message : null,
  };
}

export function parseContentAuditSnapshot(raw: unknown): ContentAuditSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("內容健檢回應格式無效。");
  const value = raw as Partial<ContentAuditSnapshot>;
  if (
    typeof value.marketplaceId !== "string" ||
    typeof value.fetchedAt !== "string" ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("內容健檢缺少可核對的站點或商品資料。");
  }
  const rows = value.rows.map((candidate, index): ContentAuditRow => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`內容健檢第 ${index + 1} 筆商品資料格式無效；已停止顯示不完整結果。`);
    }
    const row = candidate as Partial<ContentAuditRow>;
    if (typeof row.sellerSku !== "string" || !row.sellerSku.trim()) {
      throw new Error(`內容健檢第 ${index + 1} 筆商品缺少 SKU；已停止顯示不完整結果。`);
    }
    const parsedReadErrors = Array.isArray(row.readErrors)
      ? row.readErrors.filter((error): error is ContentAuditReadError =>
          Boolean(
            error &&
            typeof error === "object" &&
            ["LISTING_QUERY_FAILED", "LISTING_CONTENT_NOT_RETURNED"].includes(
              (error as ContentAuditReadError).code,
            ) &&
            typeof (error as ContentAuditReadError).message === "string",
          ),
        )
      : [];
    const readStatus =
      row.readStatus === "complete" && parsedReadErrors.length === 0
        ? "complete"
        : "incomplete";
    const readErrors =
      readStatus === "incomplete" && parsedReadErrors.length === 0
        ? [{
            code: "LISTING_CONTENT_NOT_RETURNED" as const,
            message: "回應缺少可驗證的完整讀取狀態；本列已排除缺值與拼字統計。",
          }]
        : parsedReadErrors;
    return {
      sellerSku: row.sellerSku,
      asin: typeof row.asin === "string" ? row.asin : "",
      productType: typeof row.productType === "string" ? row.productType : "",
      title: typeof row.title === "string" ? row.title : "",
      bulletPoints: Array.isArray(row.bulletPoints)
        ? row.bulletPoints.filter((item): item is string => typeof item === "string")
        : [],
      ingredients: typeof row.ingredients === "string" ? row.ingredients : "",
      readStatus,
      readErrors,
      issues: readStatus === "complete" && Array.isArray(row.issues)
        ? row.issues.filter((issue): issue is ContentAuditIssue =>
            Boolean(
              issue &&
              typeof issue === "object" &&
              [
                "MISSING_BULLETS",
                "MISSING_INGREDIENTS",
                "INGREDIENTS_UNVERIFIED",
                "SUSPECTED_TYPO",
              ].includes(
                (issue as ContentAuditIssue).kind,
              ) &&
              typeof (issue as ContentAuditIssue).message === "string",
            ),
          )
        : [],
    };
  });
  if (
    value.summary?.total !== undefined &&
    (
      typeof value.summary.total !== "number" ||
      !Number.isInteger(value.summary.total) ||
      value.summary.total !== rows.length
    )
  ) {
    throw new Error("內容健檢商品總數與回傳列數不一致；已停止顯示不完整結果。");
  }
  const declaredTotal = rows.length;
  return {
    marketplaceId: value.marketplaceId,
    fetchedAt: value.fetchedAt,
    rows,
    readErrors: rows.flatMap((row) =>
      row.readErrors.map((readError) => ({
        sellerSku: row.sellerSku,
        ...readError,
      })),
    ),
    summary: summarizeContentAudit(rows, declaredTotal),
  };
}

function issueLabel(kind: ContentAuditIssueKind): string {
  if (kind === "MISSING_BULLETS") return "賣點不足";
  if (kind === "MISSING_INGREDIENTS") return "缺成分";
  if (kind === "INGREDIENTS_UNVERIFIED") return "成分未驗證";
  return "疑似錯字";
}

function typoIssuesForField(
  row: ContentAuditRow,
  field: ContentAuditIssue["field"],
): ContentAuditIssue[] {
  return row.issues.filter(
    (issue) => issue.kind === "SUSPECTED_TYPO" && issue.field === field,
  );
}

function highlightedContent(
  value: string,
  issues: readonly ContentAuditIssue[],
) {
  return contentHighlightSegments(value, issues).map((segment, index) =>
    segment.highlighted ? (
      <mark
        key={`${segment.token ?? "typo"}-${index}`}
        className="content-audit-typo-highlight"
        title={`疑似錯字：${segment.token ?? segment.text}`}
        style={{
          color: "#b42318",
          backgroundColor: "#fee4e2",
          borderRadius: "0.22em",
          fontWeight: 700,
          padding: "0 0.08em",
        }}
      >
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  );
}

function hasHighlightedContent(
  value: string,
  issues: readonly ContentAuditIssue[],
): boolean {
  return contentHighlightSegments(value, issues).some(
    (segment) => segment.highlighted,
  );
}

function invisibleIssueIsExplained(
  row: ContentAuditRow,
  issue: ContentAuditIssue,
  locations: ReturnType<typeof locateInvisibleCharacters>,
): boolean {
  return isInvisibleCharacterIssue(issue) && locations.some(
    (location) =>
      location.sellerSku === row.sellerSku &&
      location.field === issue.field &&
      location.codePoint === issue.token?.toUpperCase(),
  );
}

function scanStatusText(state: AuditState, reply: ReportReply | null): string {
  if (state === "starting") return "正在請 Amazon 建立全站 FBA 商品報表…";
  if (state === "polling") return reply?.message || "Amazon 正在整理商品清單…";
  if (state === "scanning") return "正在逐一讀取 FBA 文案並執行 Mac 本機拼字檢查…";
  return "";
}

export default function ContentAuditPanel({
  marketplaceId,
  marketplaceShort,
  onOpenSku,
  cachedResult = null,
  onCachedResultChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  onOpenSku: (sellerSku: string) => void;
  cachedResult?: ContentAuditCache | null;
  onCachedResultChange?: (cache: ContentAuditCache) => void;
}) {
  const initialCache = cachedResult?.snapshot.marketplaceId === marketplaceId
    ? cachedResult
    : null;
  const [state, setState] = useState<AuditState>(initialCache ? "done" : "idle");
  const [reply, setReply] = useState<ReportReply | null>(null);
  const [snapshot, setSnapshot] = useState<ContentAuditSnapshot | null>(
    initialCache?.snapshot ?? null,
  );
  const [filter, setFilter] = useState<AuditFilter>(initialCache?.filter ?? "all");
  const [query, setQuery] = useState(initialCache?.query ?? "");
  const [error, setError] = useState<string | null>(null);
  const [spellcheckNote, setSpellcheckNote] = useState<string | null>(
    initialCache?.spellcheckNote ?? null,
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    abortRef.current?.abort();
    setReply(null);
    setError(null);
    if (cachedResult?.snapshot.marketplaceId === marketplaceId) {
      setState("done");
      setSnapshot(cachedResult.snapshot);
      setFilter(cachedResult.filter);
      setQuery(cachedResult.query);
      setSpellcheckNote(cachedResult.spellcheckNote);
      return;
    }
    setState("idle");
    setSnapshot(null);
    setFilter("all");
    setQuery("");
    setSpellcheckNote(null);
  }, [cachedResult, marketplaceId]);

  const attentionRows = useMemo(
    () =>
      snapshot ? contentAuditAttentionRows(snapshot) : [],
    [snapshot],
  );
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    return attentionRows.filter((row) => {
      if (filter === "READ_INCOMPLETE") {
        if (row.readStatus !== "incomplete") return false;
      } else if (
        filter !== "all" &&
        !row.issues.some((issue) => issue.kind === filter)
      ) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [row.sellerSku, row.asin, row.title]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery);
    });
  }, [attentionRows, filter, query]);
  const invisibleLocations = useMemo(
    () =>
      filter === "all" || filter === "SUSPECTED_TYPO"
        ? locateInvisibleCharacters(visibleRows)
        : [],
    [filter, visibleRows],
  );

  const loadAudit = async (ready: ReportReply, signal: AbortSignal) => {
    if (!ready.reportId || !ready.documentId) {
      throw new Error("Amazon 沒有回傳完整的報表文件資訊。");
    }
    setState("scanning");
    const params = new URLSearchParams({
      marketplaceId,
      reportId: ready.reportId,
      documentId: ready.documentId,
      audit: "1",
    });
    const response = await fetch(`/api/sp-api/listing-content/export?${params}`, {
      cache: "no-store",
      signal,
    });
    const raw = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(problemMessage(raw as ApiProblem, "全站內容健檢失敗。"));
    }
    const base = parseContentAuditSnapshot(raw);
    let rows = base.rows;
    let nextSpellcheckNote: string;
    try {
      const words = wordsForLocalSpellcheck(rows);
      const misspellings = window.fbaOS.spellcheck.check(words);
      rows = addLocalSpellcheckIssues(rows, misspellings);
      nextSpellcheckNote = `Mac 本機字典已檢查 ${words.length.toLocaleString()} 個不重複英文單字（每次最多 ${LOCAL_SPELLCHECK_WORD_LIMIT.toLocaleString()} 個）；只提示，不會自動改字。大型 catalog 超過上限後的後續單字未做 Mac 字典檢查。`;
    } catch {
      nextSpellcheckNote =
        "Mac 本機字典目前不可用；已完成缺值、明確常見錯字、重複詞與不可見字元檢查。";
    }
    const completed = {
      ...base,
      rows,
      summary: summarizeContentAudit(rows, base.summary.total),
    };
    setSnapshot(completed);
    setFilter("all");
    setQuery("");
    setSpellcheckNote(nextSpellcheckNote);
    setState("done");
    onCachedResultChange?.({
      snapshot: completed,
      filter: "all",
      query: "",
      spellcheckNote: nextSpellcheckNote,
    });
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
        throw new Error(problemMessage(startRaw as ApiProblem, "無法開始內容健檢。"));
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
      throw new Error("內容健檢超過三分鐘，請稍後再試。");
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setState(snapshot ? "done" : "idle");
      setError(
        requestError instanceof Error ? requestError.message : "目前無法完成內容健檢。",
      );
    }
  };

  const statusText = scanStatusText(state, reply);
  const summary = snapshot?.summary;

  const changeFilter = (nextFilter: AuditFilter) => {
    setFilter(nextFilter);
    if (snapshot) {
      onCachedResultChange?.({
        snapshot,
        filter: nextFilter,
        query,
        spellcheckNote,
      });
    }
  };

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    if (snapshot) {
      onCachedResultChange?.({
        snapshot,
        filter,
        query: nextQuery,
        spellcheckNote,
      });
    }
  };

  const exportAttentionRows = () => {
    if (!snapshot || attentionRows.length === 0) return;
    try {
      downloadContentAuditWorkbook(snapshot, marketplaceShort);
      setError(null);
    } catch {
      setError("目前無法建立健檢 Excel，請重新掃描後再試。");
    }
  };

  return (
    <section className="content-audit-panel" aria-label="全站 FBA 內容健檢">
      <p className="price-intro">
        一次掃描所選站點全部 FBA SKU，直接列出疑似錯字、少於五個賣點，以及有可靠商品類型證據但缺成分的商品；不用逐一輸入 SKU。
      </p>
      <div className="content-export-note content-audit-privacy">
        <strong>Amazon 唯讀＋Mac 本機拼字檢查</strong>
        <p>文案不會送到第三方，也不會自動修改 Amazon；疑似錯字仍由你判斷。</p>
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
          {state === "idle" ? `掃描 ${marketplaceShort} 全部 FBA 文案` : "內容健檢進行中…"}
        </button>
      )}

      {state === "done" && snapshot && summary && (
        <>
          <div className="content-audit-summary" aria-label="內容健檢摘要">
            <article><span>完成讀取</span><strong>{summary.completed.toLocaleString()}</strong><small>共 {summary.total.toLocaleString()} 個 FBA SKU</small></article>
            <article><span>讀取未完成</span><strong>{summary.incomplete.toLocaleString()}</strong><small>不列入缺值統計</small></article>
            <article><span>有待確認</span><strong>{summary.withIssues.toLocaleString()}</strong><small>SKU</small></article>
            <article><span>疑似錯字</span><strong>{summary.suspectedTypos.toLocaleString()}</strong><small>SKU</small></article>
            <article><span>賣點不足</span><strong>{summary.missingBullets.toLocaleString()}</strong><small>SKU</small></article>
            <article><span>缺成分</span><strong>{summary.missingIngredients.toLocaleString()}</strong><small>已證明適用的 SKU</small></article>
            <article><span>成分未驗證</span><strong>{summary.ingredientsUnverified.toLocaleString()}</strong><small>需人工確認 PTD</small></article>
          </div>
          {spellcheckNote && <p className="content-audit-note">{spellcheckNote}</p>}
          {invisibleLocations.length > 0 && (
            <aside
              className="content-export-note content-audit-invisible-guide"
              aria-label="不可見字元統一說明與位置"
            >
              <strong>不可見字元統一說明</strong>
              <p>
                代碼會完整寫成 U+200B；U+200B 是「零寬空格」，不是 U+200。
                下方紅色括號只是定位標記，不會修改原文；請手動修改標示段落。
              </p>
              <ul>
                {invisibleLocations.map((location, index) => (
                  <li
                    key={`${location.sellerSku}-${location.fieldLabel}-${location.codePoint}-${index}`}
                  >
                    <strong>
                      {location.sellerSku} · {location.fieldLabel} · {location.codePoint}（{location.name}）
                    </strong>
                    <code style={{ color: "#b42318", fontWeight: 700 }}>
                      {location.context}
                    </code>
                    <small>
                      位於「{location.before}」與「{location.after}」之間；應手動修改此段。
                    </small>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <div className="content-audit-controls">
            <div role="tablist" aria-label="健檢問題篩選">
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={filter === item.value ? "active" : ""}
                  onClick={() => changeFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label>
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                placeholder="搜尋 SKU、ASIN 或商品名稱"
                aria-label="搜尋內容健檢結果"
              />
            </label>
          </div>
          <div className="content-audit-result-heading">
            <strong>{visibleRows.length.toLocaleString()} 個符合條件的 SKU</strong>
            <div>
              <button
                className="content-audit-excel-button"
                type="button"
                onClick={exportAttentionRows}
                disabled={attentionRows.length === 0}
              >
                匯出全部 {attentionRows.length.toLocaleString()} 個待確認項目 Excel
              </button>
              <button type="button" onClick={() => void startAudit()}>重新掃描</button>
            </div>
          </div>
          {visibleRows.length ? (
            <div className="content-audit-list">
              {visibleRows.map((row) => {
                const titleIssues = typoIssuesForField(row, "title");
                const bulletIssues = typoIssuesForField(row, "bulletPoints");
                const ingredientsIssues = typoIssuesForField(row, "ingredients");
                const affectedBullets = row.bulletPoints
                  .map((value, index) => ({ value, index }))
                  .filter(({ value }) => hasHighlightedContent(value, bulletIssues));
                return (
                  <article key={row.sellerSku}>
                    <div className="content-audit-product">
                      <span>{(row.title || row.sellerSku).slice(0, 1)}</span>
                      <div>
                        <strong>
                          {row.title
                            ? highlightedContent(row.title, titleIssues)
                            : "尚無商品標題"}
                        </strong>
                        <small>{row.sellerSku}{row.asin ? ` · ${row.asin}` : ""}</small>
                      </div>
                      <button type="button" onClick={() => onOpenSku(row.sellerSku)}>開啟編輯</button>
                    </div>
                    {(affectedBullets.length > 0 ||
                      hasHighlightedContent(row.ingredients, ingredientsIssues)) && (
                      <div
                        className="content-audit-original-copy"
                        aria-label={`${row.sellerSku} 疑似錯字原文`}
                      >
                        {affectedBullets.map(({ value, index }) => (
                          <p key={`bullet-${index}`}>
                            <strong>賣點 {index + 1}</strong>
                            <span>{highlightedContent(value, bulletIssues)}</span>
                          </p>
                        ))}
                        {hasHighlightedContent(row.ingredients, ingredientsIssues) && (
                          <p>
                            <strong>成分</strong>
                            <span>{highlightedContent(row.ingredients, ingredientsIssues)}</span>
                          </p>
                        )}
                      </div>
                    )}
                    <div className="content-audit-issues">
                      {row.readStatus === "incomplete" &&
                        (filter === "all" || filter === "READ_INCOMPLETE") &&
                        row.readErrors.map((readError, index) => (
                          <div key={`${readError.code}-${index}`}>
                            <span className="kind-read_incomplete">讀取失敗／未完成</span>
                            <p>{readError.message}</p>
                            <small>本列未計入缺賣點、缺成分或 Mac 拼字統計</small>
                          </div>
                        ))}
                      {row.issues
                        .filter(
                          (issue) =>
                            !invisibleIssueIsExplained(
                              row,
                              issue,
                              invisibleLocations,
                            ) &&
                            (filter === "all" ||
                              (filter !== "READ_INCOMPLETE" && issue.kind === filter)),
                        )
                        .map((issue, index) => (
                          <div key={`${issue.kind}-${issue.field}-${issue.token ?? index}`}>
                            <span className={`kind-${issue.kind.toLocaleLowerCase()}`}>{issueLabel(issue.kind)}</span>
                            <p>{issue.message}</p>
                            {issue.suggestion && <small>建議檢查：{issue.suggestion}</small>}
                          </div>
                        ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="content-audit-empty">
              <span>✓</span><strong>這個條件下沒有待確認項目</strong><p>可切換篩選或清除搜尋文字。</p>
            </div>
          )}
        </>
      )}
      <p className="batch-footnote">每次健檢只處理所選站點可證明為 Amazon 配送的 FBA SKU；FBM 不會加入。</p>
    </section>
  );
}
