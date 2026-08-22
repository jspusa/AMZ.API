"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  businessPricingRowMatchesFilter,
  createSubmittedBusinessPricePreview,
  parseBusinessPriceUpdate,
  parseBusinessPricingAuditSnapshot,
  parseBusinessPricingListingSnapshot,
  type BusinessPricingAuditFilter,
  type BusinessPricingAuditRow,
  type BusinessPricingAuditSnapshot,
  type BusinessPricingListingSnapshot,
  type BusinessPricingMoney,
  type BusinessPriceUpdate,
  type SubmittedBusinessPricePreview,
} from "../business-pricing-audit";

type ReportStatus = Readonly<{
  ready: boolean;
  reportId: string;
  documentId: string | null;
  status: string;
  notice?: string;
}>;

const FILTERS: readonly Readonly<{
  value: BusinessPricingAuditFilter;
  label: string;
}>[] = [
  { value: "all", label: "全部" },
  { value: "problem", label: "需處理" },
  { value: "missing", label: "未設定" },
  { value: "configured", label: "已設定" },
  { value: "unsupported", label: "不支援" },
  { value: "incomplete", label: "資料未完成" },
];

function problemMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
  const source = payload as Record<string, unknown>;
  const message = typeof source.message === "string" &&
      source.message.length <= 4_000 &&
      !source.message.includes("\u0000") &&
      source.message.trim()
    ? source.message
    : fallback;
  const requestId = typeof source.requestId === "string" &&
      source.requestId.length <= 256 &&
      source.requestId === source.requestId.trim() &&
      !/[\u0000-\u001f\u007f]/u.test(source.requestId) &&
      source.requestId
    ? source.requestId
    : null;
  return `${message}${requestId ? `（Request ID: ${requestId}）` : ""}`;
}

function reportStatus(value: unknown): ReportStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Amazon 全商品報表狀態無效。");
  }
  const source = value as Record<string, unknown>;
  const reportId = typeof source.reportId === "string" &&
      source.reportId.length <= 256 &&
      source.reportId === source.reportId.trim() &&
      !/[\u0000-\u001f\u007f]/u.test(source.reportId)
    ? source.reportId
    : null;
  const documentId = source.documentId === null
    ? null
    : typeof source.documentId === "string" &&
        source.documentId.length <= 256 &&
        source.documentId === source.documentId.trim() &&
        !/[\u0000-\u001f\u007f]/u.test(source.documentId)
      ? source.documentId
      : undefined;
  const status = typeof source.status === "string" &&
      source.status.length <= 64 &&
      source.status === source.status.trim() &&
      !/[\u0000-\u001f\u007f]/u.test(source.status)
    ? source.status
    : null;
  const notice = source.notice === undefined
    ? undefined
    : typeof source.notice === "string" &&
        source.notice.length <= 4_000 &&
        !source.notice.includes("\u0000")
      ? source.notice
      : null;
  if (
    typeof source.ready !== "boolean" ||
    !reportId ||
    documentId === undefined ||
    !status ||
    notice === null
  ) {
    throw new Error("Amazon 全商品報表狀態無效。");
  }
  return Object.freeze({
    ready: source.ready,
    reportId,
    documentId,
    status,
    ...(notice === undefined ? {} : { notice }),
  });
}

function auditPollDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 2_000);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createIdempotencyKey(): string {
  return `business-price-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 12)}`;
}

function formatMoney(value: BusinessPricingMoney | null): string {
  if (!value) return "—";
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: value.currencyCode,
      maximumFractionDigits: value.currencyCode === "JPY" ? 0 : 2,
    }).format(value.amount);
  } catch {
    return `${value.currencyCode} ${value.amount}`;
  }
}

function priceNumber(value: string, currencyCode: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000_000) {
    return null;
  }
  if (currencyCode === "JPY" && !Number.isInteger(parsed)) return null;
  return parsed;
}

function statusLabel(status: BusinessPricingAuditRow["status"]): string {
  if (status === "configured") return "已設定";
  if (status === "missing") return "未設定 B2B 價格";
  if (status === "unsupported") return "PTD 不支援";
  return "資料未完成";
}

function rowCount(
  snapshot: BusinessPricingAuditSnapshot,
  filter: BusinessPricingAuditFilter,
): number {
  return snapshot.rows.filter((row) =>
    businessPricingRowMatchesFilter(row, filter),
  ).length;
}

export default function BusinessPricingAuditPanel({
  marketplaceId,
  marketplaceShort,
  initialSnapshot = null,
  cachedSnapshot = null,
  onSnapshotChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  initialSnapshot?: BusinessPricingAuditSnapshot | null;
  cachedSnapshot?: BusinessPricingAuditSnapshot | null;
  onSnapshotChange?: (snapshot: BusinessPricingAuditSnapshot) => void;
}) {
  const [snapshot, setSnapshot] = useState<BusinessPricingAuditSnapshot | null>(
    initialSnapshot ?? cachedSnapshot,
  );
  const [filter, setFilter] = useState<BusinessPricingAuditFilter>("problem");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<BusinessPricingListingSnapshot | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [submittedPreview, setSubmittedPreview] =
    useState<SubmittedBusinessPricePreview | null>(null);
  const [result, setResult] = useState<BusinessPriceUpdate | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const editorRevisionRef = useRef(0);

  const validation = submittedPreview?.validation ?? null;

  useEffect(() => () => abortRef.current?.abort(), []);

  const visibleRows = useMemo(
    () => snapshot?.rows.filter((row) =>
      businessPricingRowMatchesFilter(row, filter),
    ) ?? [],
    [filter, snapshot],
  );

  const runAudit = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setProgress("正在建立 Amazon FBA 全商品清單…");
    setSelected(null);
    setResult(null);
    try {
      const startResponse = await fetch("/api/sp-api/business-pricing-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceId }),
        signal: controller.signal,
      });
      const startPayload = await startResponse.json();
      if (!startResponse.ok) {
        throw new Error(problemMessage(startPayload, "無法開始 B2B 價格健檢。"));
      }
      let status = reportStatus(startPayload);
      for (let attempt = 0; !status.ready && attempt < 90; attempt += 1) {
        await auditPollDelay(controller.signal);
        const params = new URLSearchParams({
          marketplaceId,
          reportId: status.reportId,
        });
        const response = await fetch(`/api/sp-api/business-pricing-audit?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(problemMessage(payload, "查詢 B2B 價格健檢進度失敗。"));
        }
        status = reportStatus(payload);
        setProgress(status.notice ?? "Amazon 正在準備全商品清單…");
      }
      if (!status.ready || !status.documentId) {
        throw new Error("Amazon 全商品清單仍未完成；系統沒有盲目重建，請稍後明確重試。");
      }
      setProgress("正在逐項核對 B2B offer 與 seller-specific PTD…");
      const params = new URLSearchParams({
        marketplaceId,
        reportId: status.reportId,
        documentId: status.documentId,
        data: "1",
      });
      const response = await fetch(`/api/sp-api/business-pricing-audit?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(problemMessage(payload, "整理 B2B 價格健檢失敗。"));
      }
      const next = parseBusinessPricingAuditSnapshot(payload);
      if (next.marketplaceId !== marketplaceId) {
        throw new Error("B2B 價格健檢站點與目前選擇不一致。");
      }
      setSnapshot(next);
      onSnapshotChange?.(next);
      setFilter("problem");
      setProgress(null);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "B2B 價格健檢失敗。");
      setProgress(null);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  const openEditor = async (row: BusinessPricingAuditRow) => {
    const revision = ++editorRevisionRef.current;
    setEditLoading(true);
    setError(null);
    setSelected(null);
    setSubmittedPreview(null);
    setResult(null);
    setNewPrice("");
    try {
      const params = new URLSearchParams({ marketplaceId, sku: row.sellerSku });
      const response = await fetch(`/api/sp-api/business-pricing?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(problemMessage(payload, "無法重新讀取此 SKU 的 B2B 價格。"));
      }
      const fresh = parseBusinessPricingListingSnapshot(payload);
      if (fresh.marketplaceId !== marketplaceId || fresh.sellerSku !== row.sellerSku) {
        throw new Error("Amazon 回傳的 B2B 價格識別與所選 SKU 不一致。");
      }
      if (editorRevisionRef.current !== revision) return;
      setSelected(fresh);
      setNewPrice(fresh.businessPrice?.amount.toString() ?? "");
    } catch (requestError) {
      if (editorRevisionRef.current === revision) {
        setError(requestError instanceof Error ? requestError.message : "無法開啟 B2B 價格編輯。" );
      }
    } finally {
      if (editorRevisionRef.current === revision) setEditLoading(false);
    }
  };

  const parsedNewPrice = selected?.standardPrice
    ? priceNumber(newPrice, selected.standardPrice.currencyCode)
    : null;
  const unchanged = Boolean(
    selected?.businessPrice &&
    parsedNewPrice !== null &&
    selected.businessPrice.amount === parsedNewPrice,
  );

  const previewPrice = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || parsedNewPrice === null || unchanged) return;
    const listing = selected;
    const submittedPrice = parsedNewPrice;
    const key = createIdempotencyKey();
    const body = Object.freeze({
      marketplaceId: listing.marketplaceId,
      sellerSku: listing.sellerSku,
      expectedStandardPrice: listing.standardPrice!.amount,
      expectedBusinessPrice: listing.businessPrice?.amount ?? null,
      newBusinessPrice: submittedPrice,
      idempotencyKey: key,
    });
    const revision = ++editorRevisionRef.current;
    setEditLoading(true);
    setError(null);
    setResult(null);
    setSubmittedPreview(null);
    try {
      const response = await fetch("/api/sp-api/business-pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(problemMessage(payload, "Amazon B2B 價格預檢未通過。"));
      }
      const submitted = createSubmittedBusinessPricePreview({
        listing,
        newBusinessPrice: submittedPrice,
        idempotencyKey: key,
        response: payload,
      });
      if (editorRevisionRef.current !== revision) return;
      setSubmittedPreview(submitted);
    } catch (requestError) {
      if (editorRevisionRef.current === revision) {
        setError(requestError instanceof Error ? requestError.message : "Amazon B2B 價格預檢未通過。" );
      }
    } finally {
      if (editorRevisionRef.current === revision) setEditLoading(false);
    }
  };

  const commitPrice = async () => {
    const submitted = submittedPreview;
    if (!selected || !submitted) return;
    setEditLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sp-api/business-pricing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitted.body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(problemMessage(payload, "Amazon 未能確認 B2B 價格更新。"));
      }
      const nextResult = parseBusinessPriceUpdate(payload, submitted);
      setResult(nextResult);
      setSubmittedPreview(null);
      if (snapshot) {
        const prior = snapshot.rows.find((row) =>
          row.sellerSku === submitted.body.sellerSku);
        if (prior) {
          const nextSnapshot: BusinessPricingAuditSnapshot = {
            ...snapshot,
            rows: snapshot.rows.map((row) =>
              row.sellerSku === submitted.body.sellerSku
              ? {
                  ...row,
                  businessPrice: nextResult.requestedBusinessPrice,
                  businessOfferPresence: "present" as const,
                  status: "configured" as const,
                  reason: "已設定 Amazon Business 價格，且主程序唯讀回查確認。",
                }
              : row),
            summary: prior.status === "missing"
              ? {
                  ...snapshot.summary,
                  missing: snapshot.summary.missing - 1,
                  configured: snapshot.summary.configured + 1,
                }
              : snapshot.summary,
          };
          setSnapshot(nextSnapshot);
          onSnapshotChange?.(nextSnapshot);
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Amazon 未能確認 B2B 價格更新。" );
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <section className="business-pricing-audit-panel" aria-label="全站 FBA Amazon Business 價格健檢">
      <div className="business-pricing-audit-intro">
        <div>
          <span>{marketplaceShort} · FBA ONLY</span>
          <h3>找出尚未設定 B2B 價格的商品</h3>
          <p>只把 seller-specific PTD 明確提供 B2B audience、且 Listings Items API 完整回傳的 FBA SKU 判為可設定。</p>
        </div>
        <button type="button" className="price-primary-button" onClick={() => void runAudit()} disabled={loading || editLoading}>
          {loading ? "健檢中…" : snapshot ? "重新健檢" : "開始全站 B2B 價格健檢"}
        </button>
      </div>
      <p className="business-pricing-safety-note">先由 Amazon Validation Preview 核對，零寫入；正式送出前仍需 Touch ID／Windows Hello，且只 PATCH B2B audience 的 our_price，絕不改一般售價或盲目重送。</p>
      {progress && <div className="business-pricing-progress" role="status">{progress}</div>}
      {error && <div className="price-error" role="alert">{error}</div>}

      {snapshot && (
        <>
          <div className="business-pricing-summary" aria-label="B2B 價格健檢摘要">
            <article><span>FBA SKU</span><strong>{snapshot.summary.totalFbaSkuCount}</strong></article>
            <article className="problem"><span>未設定</span><strong>{snapshot.summary.missing}</strong></article>
            <article><span>已設定</span><strong>{snapshot.summary.configured}</strong></article>
            <article><span>不支援／未完成</span><strong>{snapshot.summary.unsupported + snapshot.summary.incomplete}</strong></article>
          </div>
          <div className="business-pricing-filters" role="group" aria-label="B2B 價格篩選">
            {FILTERS.map((option) => (
              <button key={option.value} type="button" className={filter === option.value ? "active" : ""} onClick={() => setFilter(option.value)}>
                <span>{option.label}</span><strong>{rowCount(snapshot, option.value)}</strong>
              </button>
            ))}
          </div>
          <p className="business-pricing-notice">{snapshot.notice}</p>
          <div className="business-pricing-list" role="list" aria-label="FBA B2B 價格商品">
            {visibleRows.map((row) => (
              <article key={row.sellerSku} className={`business-pricing-row ${row.status}`} role="listitem">
                <div>
                  <strong>{row.title || row.sellerSku}</strong>
                  <small>{row.sellerSku} · {row.asin || "無 ASIN"}</small>
                </div>
                <dl>
                  <div><dt>一般售價</dt><dd>{formatMoney(row.standardPrice)}</dd></div>
                  <div><dt>B2B 價格</dt><dd>{formatMoney(row.businessPrice)}</dd></div>
                </dl>
                <div className="business-pricing-row-status">
                  <span>{statusLabel(row.status)}</span>
                  <small>{row.reason}</small>
                </div>
                {row.editable && row.standardPrice ? (
                  <button type="button" onClick={() => void openEditor(row)} disabled={editLoading}>
                    {row.status === "missing" ? "設定 B2B 價格" : "調整 B2B 價格"}
                  </button>
                ) : <span className="business-pricing-readonly">唯讀</span>}
              </article>
            ))}
            {visibleRows.length === 0 && <p className="business-pricing-empty">這個篩選沒有商品。</p>}
          </div>
        </>
      )}

      {selected && (
        <form className="business-pricing-editor" onSubmit={(event) => void previewPrice(event)}>
          <div className="business-pricing-editor-heading">
            <div><span>安全調整 B2B PRICE</span><strong>{selected.sellerSku}</strong></div>
            <button type="button" onClick={() => {
              editorRevisionRef.current += 1;
              setSelected(null);
              setSubmittedPreview(null);
              setResult(null);
            }} disabled={editLoading} aria-label="關閉 B2B 價格編輯">×</button>
          </div>
          <dl>
            <div><dt>目前一般售價</dt><dd>{formatMoney(selected.standardPrice)}</dd></div>
            <div><dt>目前 B2B 價格</dt><dd>{formatMoney(selected.businessPrice)}</dd></div>
          </dl>
          {!selected.businessPricingCapability.editable ? (
            <div className="price-error">{selected.businessPricingCapability.reason ?? "Amazon PTD 未允許編輯 B2B 價格。"}</div>
          ) : (
            <label htmlFor="business-price-input">
              <span>新 B2B 價格 · {selected.standardPrice?.currencyCode}</span>
              <input id="business-price-input" value={newPrice} onChange={(event) => {
                editorRevisionRef.current += 1;
                setNewPrice(event.target.value);
                setSubmittedPreview(null);
                setResult(null);
              }} disabled={editLoading} inputMode={selected.standardPrice?.currencyCode === "JPY" ? "numeric" : "decimal"} autoComplete="off" />
            </label>
          )}
          {parsedNewPrice !== null && selected.standardPrice && parsedNewPrice > selected.standardPrice.amount && (
            <div className="price-warning compact"><strong>B2B 價格高於一般售價</strong><p>Amazon 可能拒絕；預檢會以 seller-specific PTD 為準。</p></div>
          )}
          {validation && (
            <div className="business-pricing-validation">
              <strong>{validation.notice}</strong>
              {validation.issues.map((issue, index) => <p key={`${issue.severity}-${index}`}>{issue.severity} · {issue.message}</p>)}
              <button type="button" className="price-primary-button" onClick={() => void commitPrice()} disabled={editLoading}>
                {editLoading ? "送出並回查中…" : "Touch ID／Windows Hello 確認並送出"}
              </button>
            </div>
          )}
          {result && <div className="business-pricing-result" role="status"><strong>已完成並回查</strong><p>{result.notice}</p></div>}
          {!validation && !result && selected.businessPricingCapability.editable && (
            <button type="submit" className="price-primary-button" disabled={editLoading || parsedNewPrice === null || unchanged}>
              {editLoading ? "Amazon 預檢中…" : "先預檢 B2B 價格（不寫入）"}
            </button>
          )}
        </form>
      )}
    </section>
  );
}
