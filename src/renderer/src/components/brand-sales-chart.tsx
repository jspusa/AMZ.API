"use client";

import { useId, useState } from "react";
import type { BrandSalesSegment, BrandSalesSnapshot } from "../brand-sales";
import type { BrandSalesFailure } from "./brand-sales-card";

const PIE_CENTER = 60;
const PIE_RADIUS = 52;

function coordinate(value: number): string {
  const rounded = Math.abs(value) < 0.00005 ? 0 : Number(value.toFixed(4));
  return String(rounded);
}

function pointAt(fraction: number): { x: number; y: number } {
  const radians = (-90 + fraction * 360) * (Math.PI / 180);
  return {
    x: PIE_CENTER + PIE_RADIUS * Math.cos(radians),
    y: PIE_CENTER + PIE_RADIUS * Math.sin(radians),
  };
}

export function brandSalesPiePath(start: number, share: number): string {
  if (!Number.isFinite(start) || !Number.isFinite(share) || share <= 0) return "";
  if (share >= 1 - Number.EPSILON) {
    return [
      `M ${PIE_CENTER} ${PIE_CENTER}`,
      `L ${PIE_CENTER} ${PIE_CENTER - PIE_RADIUS}`,
      `A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${PIE_CENTER} ${PIE_CENTER + PIE_RADIUS}`,
      `A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${PIE_CENTER} ${PIE_CENTER - PIE_RADIUS}`,
      "Z",
    ].join(" ");
  }
  const startPoint = pointAt(start);
  const endPoint = pointAt(start + share);
  return [
    `M ${PIE_CENTER} ${PIE_CENTER}`,
    `L ${coordinate(startPoint.x)} ${coordinate(startPoint.y)}`,
    `A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${share > 0.5 ? 1 : 0} 1 ${coordinate(endPoint.x)} ${coordinate(endPoint.y)}`,
    "Z",
  ].join(" ");
}

export function sortBrandSalesSegments(
  segments: readonly BrandSalesSegment[],
): BrandSalesSegment[] {
  return segments
    .map((segment, index) => ({ segment, index }))
    .sort((left, right) =>
      right.segment.amount - left.segment.amount || left.index - right.index,
    )
    .map(({ segment }) => segment);
}

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
  const sortedSegments = snapshot ? sortBrandSalesSegments(snapshot.segments) : [];
  const positive = sortedSegments.filter((segment) => segment.amount > 0);
  const total = snapshot?.summary.amount ?? 0;
  const active = sortedSegments.find((segment) => segment.key === activeKey) ?? null;
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
            <div className="brand-sales-pie-stage">
              <div className="brand-sales-pie-wrap">
                <svg className="brand-sales-pie" viewBox="0 0 120 120" role="img" aria-label={`FBA 已出貨商品銷售 ${formatMoney(total, snapshot.currencyCode)}`}>
                  <circle className="brand-sales-pie-track" cx="60" cy="60" r="52" />
                {positive.map((segment) => {
                  const share = total > 0 ? segment.amount / total : 0;
                  const currentOffset = offset;
                  offset += share;
                  const label = `${segment.label} ${formatMoney(segment.amount, snapshot.currencyCode)}，${segment.percentage}%`;
                  return (
                    <path
                      key={segment.key}
                      className={`brand-sales-pie-slice ${activeKey === segment.key ? "is-active" : ""}`}
                      d={brandSalesPiePath(currentOffset, share)}
                      fill={segment.color}
                      tabIndex={0}
                      role="button"
                      aria-label={label}
                      onPointerEnter={() => setActiveKey(segment.key)}
                      onPointerLeave={() => setActiveKey(null)}
                      onFocus={() => setActiveKey(segment.key)}
                      onBlur={() => setActiveKey(null)}
                    >
                      <title>{label}</title>
                    </path>
                  );
                })}
                </svg>
              </div>
              <div className="brand-sales-selection" aria-live="polite">
                <small>{active ? active.label : "FBA 已出貨"}</small>
                <strong>{formatMoney(active?.amount ?? total, snapshot.currencyCode)}</strong>
                <span>{active
                  ? `${active.percentage}% · ${active.unitCount.toLocaleString()} 件`
                  : `${snapshot.summary.unitCount.toLocaleString()} 件`}</span>
              </div>
            </div>
            <div className="brand-sales-legend" role="list" aria-label="品牌營收明細">
              {sortedSegments.map((segment: BrandSalesSegment) => (
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
