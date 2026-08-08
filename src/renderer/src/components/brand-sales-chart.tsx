"use client";

import { useId, useState } from "react";
import type { BrandSalesSegment, BrandSalesSnapshot } from "../brand-sales";

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
  onSync,
}: {
  snapshot: BrandSalesSnapshot | null;
  loading: boolean;
  error: string | null;
  rangeLabel: string;
  onSync: () => void;
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
        <button type="button" onClick={onSync} disabled={loading}>
          <span className={loading ? "spin" : ""}>↻</span>
          {loading ? "整理中" : snapshot ? "重新同步" : "同步品牌"}
        </button>
      </header>

      {error && <div className="brand-sales-error" role="alert">{error}</div>}
      {!snapshot && !error && (
        <div className="brand-sales-empty">
          <strong>{loading ? "Amazon 正在準備 FBA 出貨報表…" : "尚未整理品牌占比"}</strong>
          <p>同步後只計 Amazon FBA Customer Shipment Sales report 的出貨列；目前找不到商品名稱或品牌不明的 SKU 會保留為灰色「未分類」。</p>
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
          <p className="brand-sales-notice">{snapshot.notice}</p>
        </>
      )}
    </section>
  );
}
