"use client";

import { useId, useState } from "react";
import type { BrandSalesSegment, BrandSalesSnapshot } from "../brand-sales";
import type { BrandSalesFailure } from "./brand-sales-card";

function formatMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: currencyCode === "JPY" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
}

export default function BrandSalesChart({
  snapshot,
  loading,
  error,
  rangeLabel,
  onRetry,
}: {
  snapshot: BrandSalesSnapshot | null;
  loading: boolean;
  error: BrandSalesFailure | null;
  rangeLabel: string;
  onRetry: () => void;
}) {
  const titleId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const positive = snapshot?.segments.filter((segment) => segment.amount > 0) ?? [];
  const total = snapshot?.summary.amount ?? 0;
  const active = snapshot?.segments.find((segment) => segment.key === activeKey) ?? null;
  let offset = 0;

  return (
    <section className="brand-sales-card" aria-busy={loading} aria-labelledby={titleId}>
      <header className="brand-sales-heading">
        <div>
          <p className="eyebrow">FBA SHIPPED SALES</p>
          <h3 id={titleId}>品牌營收占比</h3>
          <p>{rangeLabel}</p>
        </div>
        <span className="brand-sales-auto-status" aria-live="polite">
          <i className={loading ? "spin" : ""} aria-hidden="true">↻</i>
          {loading ? "隨區間整理中" : snapshot ? "已隨區間自動更新" : "等待自動更新"}
        </span>
      </header>

      {error && (
        <div className="brand-sales-error" role="alert">
          <div>
            <strong>{error.code === "REPORT_CANCELLED"
              ? "Amazon 已取消這次報表"
              : error.code === "REPORT_FATAL"
                ? "Amazon 無法完成這次報表"
                : "品牌占比暫時未完成"}</strong>
            <p>{error.message}</p>
            {error.requestId && <small>Request ID: {error.requestId}</small>}
          </div>
          <button type="button" onClick={onRetry} disabled={loading}>再試一次</button>
        </div>
      )}
      {!snapshot && !error && (
        <div className="brand-sales-empty">
          <strong>{loading ? "Amazon 正在準備 FBA 出貨報表…" : "等待銷售區間"}</strong>
          <p>只計 FBA Customer Shipment Sales report；無法可靠歸類的 SKU 會保留為灰色「未分類」。</p>
        </div>
      )}

      {snapshot && (
        <>
          <div className="brand-sales-visual">
            <div className="brand-sales-donut-wrap">
              <svg className="brand-sales-donut" viewBox="0 0 120 120" role="img" aria-label={`FBA 已出貨商品銷售 ${formatMoney(total, snapshot.currencyCode)}`}>
                <circle className="brand-sales-track" cx="60" cy="60" r="43" pathLength="100" />
                {positive.map((segment) => {
                  const exactPercentage = total > 0 ? (segment.amount / total) * 100 : 0;
                  const currentOffset = offset;
                  offset += exactPercentage;
                  return (
                    <circle
                      key={segment.key}
                      className={`brand-sales-arc ${activeKey === segment.key ? "is-active" : ""}`}
                      cx="60"
                      cy="60"
                      r="43"
                      pathLength="100"
                      stroke={segment.color}
                      strokeDasharray={`${exactPercentage} ${100 - exactPercentage}`}
                      strokeDashoffset={-currentOffset}
                      tabIndex={0}
                      role="button"
                      aria-label={`${segment.label} ${formatMoney(segment.amount, snapshot.currencyCode)}，${segment.percentage}%`}
                      onPointerEnter={() => setActiveKey(segment.key)}
                      onPointerLeave={() => setActiveKey(null)}
                      onFocus={() => setActiveKey(segment.key)}
                      onBlur={() => setActiveKey(null)}
                    />
                  );
                })}
              </svg>
              <div className="brand-sales-center">
                <small>{active ? active.label : "FBA 已出貨"}</small>
                <strong>{formatMoney(active?.amount ?? total, snapshot.currencyCode)}</strong>
                <span>{active ? `${active.percentage}%` : `${snapshot.summary.unitCount.toLocaleString()} 件`}</span>
              </div>
            </div>
            <div className="brand-sales-legend" role="list" aria-label="品牌營收明細">
              {snapshot.segments.map((segment: BrandSalesSegment) => (
                <button
                  key={segment.key}
                  type="button"
                  role="listitem"
                  onPointerEnter={() => setActiveKey(segment.key)}
                  onPointerLeave={() => setActiveKey(null)}
                  onFocus={() => setActiveKey(segment.key)}
                  onBlur={() => setActiveKey(null)}
                >
                  <i style={{ backgroundColor: segment.color }} />
                  <span><strong>{segment.label}</strong><small>{segment.skuCount} SKU · {segment.unitCount.toLocaleString()} 件</small></span>
                  <b>{segment.percentage}%</b>
                </button>
              ))}
            </div>
          </div>
          <details className="brand-sales-notice">
            <summary>資料怎麼算</summary>
            <p>{snapshot.notice}</p>
          </details>
        </>
      )}
    </section>
  );
}
