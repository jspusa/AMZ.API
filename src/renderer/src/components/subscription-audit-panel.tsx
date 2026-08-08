"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  isSubscriptionAuditMarketplaceSupported,
  parseSubscriptionAuditSnapshot,
  subscriptionAuditMonthLabel,
  type SubscriptionAuditMonthCount,
  type SubscriptionAuditOffer,
  type SubscriptionAuditSnapshot,
} from "../subscription-audit";

type ApiProblem = { message?: string; requestId?: string | null };

function apiMessage(value: unknown, fallback: string): string {
  const problem = value && typeof value === "object" && !Array.isArray(value)
    ? value as ApiProblem
    : {};
  return `${problem.message || fallback}${problem.requestId ? `（Request ID: ${problem.requestId}）` : ""}`;
}

function money(amount: number | null, currencyCode: string | null): string {
  if (amount === null || !currencyCode) return "Amazon 未回傳";
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: currencyCode === "JPY" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString("zh-TW")}`;
  }
}

function discount(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function revenueCoverageNote(snapshot: SubscriptionAuditSnapshot): string {
  const coverage = snapshot.summary.revenueCoverage;
  if (coverage.expectedOfferMonths === 0) {
    return "目前沒有可證明為 FBA 的 S&S SKU；完整總額為 0。";
  }
  if (coverage.status === "complete") {
    return `Amazon 已回傳全部 ${coverage.expectedOfferMonths.toLocaleString("zh-TW")} 個 SKU 月份。`;
  }
  return `Amazon 只回傳 ${coverage.reportedOfferMonths.toLocaleString("zh-TW")}／${coverage.expectedOfferMonths.toLocaleString("zh-TW")} 個 SKU 月份；不以部分資料冒充總額。`;
}

export function subscriptionRevenueSummary(snapshot: SubscriptionAuditSnapshot): {
  label: string;
  value: string;
  note: string;
} {
  const coverage = snapshot.summary.revenueCoverage;
  return {
    label: coverage.status === "complete"
      ? "所選期間完整 S&S 營收"
      : "所選期間 S&S 營收",
    value: coverage.status === "complete"
      ? money(
          snapshot.summary.provenSubscriptionRevenue,
          snapshot.summary.revenueCurrencyCode,
        )
      : coverage.status === "partial"
        ? "資料不完整"
        : "Amazon 未回傳",
    note: revenueCoverageNote(snapshot),
  };
}

function filenameFrom(response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/iu.exec(disposition);
  const candidate = match?.[1]?.trim() ?? "amazon-fba-subscription-audit.xlsx";
  return /^[A-Za-z0-9._-]{1,180}$/u.test(candidate)
    ? candidate
    : "amazon-fba-subscription-audit.xlsx";
}

export function SubscriberHistoryChart({
  offer,
  snapshot,
}: {
  offer: SubscriptionAuditOffer;
  snapshot: SubscriptionAuditSnapshot;
}) {
  const width = 720;
  const height = 230;
  const inset = { top: 20, right: 18, bottom: 38, left: 52 };
  const byMonth = new Map(offer.monthlySeries.map((point) => [point.month, point]));
  const plotted = snapshot.intervals.flatMap((interval, index) => {
    const point = byMonth.get(interval.month);
    return point?.activeSubscriptionsAtPeriodEnd === null || !point
      ? []
      : [{ index, month: interval.month, value: point.activeSubscriptionsAtPeriodEnd }];
  });
  const maximum = Math.max(1, ...plotted.map(({ value }) => value));
  const x = (index: number) => inset.left + index * ((width - inset.left - inset.right) / Math.max(1, snapshot.intervals.length - 1));
  const y = (value: number) => inset.top + (maximum - value) * ((height - inset.top - inset.bottom) / maximum);
  const segments: typeof plotted[] = [];
  for (const point of plotted) {
    const last = segments.at(-1);
    if (!last?.length || point.index !== last.at(-1)!.index + 1) segments.push([point]);
    else last.push(point);
  }
  return (
    <div className="subscription-history-chart" role="group" aria-label={`${offer.sellerSku} 月底有效訂閱折線圖`}>
      <div className="subscription-chart-heading">
        <div><strong>{offer.sellerSku}</strong><small>月底有效訂閱 · 缺月保持空白，不補 0</small></div>
        <span>目前快照 {offer.currentActiveSubscriptions.toLocaleString("zh-TW")}</span>
      </div>
      {plotted.length ? (
        <div className="subscription-chart-scroll">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${snapshot.requestedMonths} 個完整月的有效訂閱歷史`}>
            <line x1={inset.left} y1={height - inset.bottom} x2={width - inset.right} y2={height - inset.bottom} className="subscription-chart-axis" />
            <line x1={inset.left} y1={inset.top} x2={inset.left} y2={height - inset.bottom} className="subscription-chart-axis" />
            {segments.map((segment) => (
              <polyline
                key={`${segment[0].month}-${segment.at(-1)!.month}`}
                points={segment.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")}
                fill="none"
                className="subscription-chart-line"
              />
            ))}
            {plotted.map((point) => {
              const metric = byMonth.get(point.month)!;
              return (
                <g key={point.month} tabIndex={0} role="graphics-symbol" aria-label={`${subscriptionAuditMonthLabel(point.month)}月底有效訂閱 ${point.value}，S&S 營收 ${money(metric.subscriptionRevenue, metric.currencyCode)}`}>
                  <circle cx={x(point.index)} cy={y(point.value)} r="5" className="subscription-chart-point">
                    <title>{`${subscriptionAuditMonthLabel(point.month)}\n月底有效訂閱：${point.value.toLocaleString("zh-TW")}\nS&S 營收：${money(metric.subscriptionRevenue, metric.currencyCode)}`}</title>
                  </circle>
                </g>
              );
            })}
            {snapshot.intervals.map((interval, index) => (
              (index === 0 || index === snapshot.intervals.length - 1 || index % Math.ceil(snapshot.intervals.length / 6) === 0) && (
                <text key={interval.month} x={x(index)} y={height - 12} textAnchor="middle" className="subscription-chart-label">
                  {interval.month.slice(2)}
                </text>
              )
            ))}
            <text x={inset.left - 8} y={inset.top + 4} textAnchor="end" className="subscription-chart-label">{maximum.toLocaleString("zh-TW")}</text>
            <text x={inset.left - 8} y={height - inset.bottom + 4} textAnchor="end" className="subscription-chart-label">0</text>
          </svg>
        </div>
      ) : <p className="variation-empty">Amazon 在所選完整月份沒有回傳此 SKU 的月底有效訂閱指標。</p>}
    </div>
  );
}

export default function SubscriptionAuditPanel({
  marketplaceId,
  marketplaceShort,
}: {
  marketplaceId: string;
  marketplaceShort: string;
}) {
  const [months, setMonths] = useState<SubscriptionAuditMonthCount>(6);
  const [snapshot, setSnapshot] = useState<SubscriptionAuditSnapshot | null>(null);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "export" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const marketplaceSupported = isSubscriptionAuditMarketplaceSupported(marketplaceId);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSnapshot(null);
    setSelectedSku(null);
    setError(null);
    setBusy(null);
  }, [marketplaceId]);

  const selectedOffer = useMemo(
    () => snapshot?.offers.find(({ sellerSku }) => sellerSku === selectedSku) ?? snapshot?.offers[0] ?? null,
    [selectedSku, snapshot],
  );
  const revenueSummary = snapshot ? subscriptionRevenueSummary(snapshot) : null;

  const load = async (requestedMonths: SubscriptionAuditMonthCount) => {
    if (!marketplaceSupported) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setMonths(requestedMonths);
    setBusy("load");
    setError(null);
    try {
      const params = new URLSearchParams({ marketplaceId, months: String(requestedMonths) });
      const response = await fetch(`/api/sp-api/subscription-audit?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const raw = await response.json() as unknown;
      if (!response.ok) throw new Error(apiMessage(raw, "全站 Subscribe & Save 健檢失敗。"));
      const parsed = parseSubscriptionAuditSnapshot(raw);
      if (parsed.marketplaceId !== marketplaceId || parsed.requestedMonths !== requestedMonths) {
        throw new Error("訂閱健檢回應與目前選擇的站點或月份不一致。");
      }
      setSnapshot(parsed);
      setSelectedSku(parsed.offers[0]?.sellerSku ?? null);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setSnapshot(null);
      setSelectedSku(null);
      setError(requestError instanceof Error ? requestError.message : "目前無法完成訂閱健檢。");
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  };

  const exportExcel = async () => {
    if (!snapshot?.exportId) return;
    setBusy("export");
    setError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        exportId: snapshot.exportId,
      });
      const response = await fetch(`/api/sp-api/subscription-audit/export?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        let problem: unknown = null;
        try { problem = await response.json(); } catch { /* bytes endpoint may not return JSON */ }
        throw new Error(apiMessage(problem, "訂閱健檢 Excel 匯出失敗。"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFrom(response);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "目前無法匯出 Excel。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="subscription-audit-panel" aria-label="全站 FBA Subscribe & Save 健檢">
      <p className="eyebrow">FBA SUBSCRIPTION AUDIT</p>
      <h3>{marketplaceSupported ? "全站訂閱價格健檢" : "Subscribe & Save 能力說明"}</h3>
      <p className="price-intro">{marketplaceSupported
        ? "一次讀取所選站點全部可證明為目前 FBA 的 Subscribe & Save offer，核對 Amazon offer 目前價格、Seller 折扣與目前有效訂閱；折扣分開顯示，不推算個別顧客的最終結帳價。"
        : `${marketplaceShort} 站不在 Amazon 官方 Seller Replenishment API 支援清單；本頁不會送出全站 Subscribe & Save 掃描。`}</p>
      {!marketplaceSupported && (
        <div className="content-export-note" role="status">
          <strong>Amazon 官方 API 目前不支援 {marketplaceShort}</strong>
          <p>可切換 US、JP、CA、UK 或 DE 使用全站健檢；這不是憑證錯誤，也不會改用 Seller Central 私有接口。</p>
        </div>
      )}
      <div className="content-export-note">
        <strong>「目前有效訂閱」是查詢當下快照</strong>
        <p>不是過去一個月新增、歷史最高、配送次數或唯一顧客數；月度折線使用每個完整月底的 active subscriptions。</p>
      </div>
      <div className="subscription-history-boundary">
        <strong>Amazon 公開 API 最多提供 23 個完整月</strong>
        <p>沒有「從加入日起」的無限歷史。當月尚未完成所以不納入；Amazon 未回傳的月份保持缺值，不補 0。</p>
      </div>
      <div className="subscription-audit-controls" aria-label="訂閱歷史月份">
        {([6, 12, 23] as const).map((value) => (
          <button key={value} type="button" className={months === value ? "active" : ""} onClick={() => void load(value)} disabled={Boolean(busy) || !marketplaceSupported}>
            {value} 個完整月
          </button>
        ))}
        <button type="button" className="price-primary-button" onClick={() => void load(months)} disabled={Boolean(busy) || !marketplaceSupported}>
          {busy === "load"
            ? "正在讀取 Amazon…"
            : marketplaceSupported
              ? `同步 ${marketplaceShort} 全部 FBA S&S`
              : `Amazon 官方 API 不支援 ${marketplaceShort}`}
        </button>
      </div>
      {error && <div className="price-error" role="alert">{error}</div>}
      {snapshot && (
        <>
          <div className="subscription-audit-summary">
            <article><span>FBA S&S SKU</span><strong>{snapshot.offers.length.toLocaleString("zh-TW")}</strong></article>
            <article><span>目前有效訂閱</span><strong>{snapshot.summary.currentActiveSubscriptions.toLocaleString("zh-TW")}</strong></article>
            {revenueSummary && (
              <article>
                <span>{revenueSummary.label}</span>
                <strong>{revenueSummary.value}</strong>
                <small>{revenueSummary.note}</small>
              </article>
            )}
          </div>
          <button type="button" className="content-audit-export-primary" onClick={() => void exportExcel()} disabled={!snapshot.exportId || Boolean(busy)}>
            <span aria-hidden="true">↓</span>
            <strong>{busy === "export" ? "正在建立 Excel…" : `匯出 ${snapshot.requestedMonths} 個完整月／五張折扣工作表`}</strong>
            <small>每個 SKU 都保留所選期間逐月資料與缺值；coverage 不完整時不輸出假的期間總營收。未知折扣會明示暫列 0%，不冒充真正 0%。</small>
          </button>
          {!snapshot.exportId && <p className="variation-warning">本次快照尚未取得主程序匯出 ID；為避免用 renderer 畫面資料冒充 Amazon 原始結果，Excel 按鈕保持停用。</p>}
          <div className="subscription-offer-list" role="list" aria-label="FBA Subscribe & Save SKU">
            {snapshot.offers.map((offer) => (
              <button key={offer.sellerSku} type="button" role="listitem" className={selectedOffer?.sellerSku === offer.sellerSku ? "active" : ""} onClick={() => setSelectedSku(offer.sellerSku)}>
                <span><strong>{offer.sellerSku}</strong><small>{offer.asin} · {offer.eligibility}</small></span>
                <span><strong>{money(offer.price.amount, offer.price.currencyCode)}</strong><small>Seller {discount(offer.sellerFundedBaseDiscount)} · Tiered {discount(offer.sellerFundedTieredDiscount)}</small></span>
                <span><strong>{offer.currentActiveSubscriptions.toLocaleString("zh-TW")}</strong><small>目前有效訂閱</small></span>
              </button>
            ))}
            {!snapshot.offers.length && <p className="variation-empty">Amazon 沒有回傳可由目前 FBA 證據確認的 Subscribe & Save offer。</p>}
          </div>
          {selectedOffer && <SubscriberHistoryChart offer={selectedOffer} snapshot={snapshot} />}
          <p className="subscription-capability-notice">{snapshot.historyCapability.notice}</p>
        </>
      )}
    </section>
  );
}
