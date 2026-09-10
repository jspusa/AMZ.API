"use client";

import { useId, useState } from "react";
import type {
  BrandSalesSnapshot,
  RevenueShareSegment,
} from "../brand-sales";
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

export function sortBrandSalesSegments<T extends RevenueShareSegment>(
  segments: readonly T[],
): T[] {
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

function currentDayCutoff(dataThrough: string): string {
  return `資料至 ${/T(\d{2}:\d{2})/u.exec(dataThrough)?.[1] ?? dataThrough}`;
}

export default function BrandSalesChart({
  snapshot,
  loading,
  error,
  onRetry,
  initialView = "brand",
}: {
  snapshot: BrandSalesSnapshot | null;
  loading: boolean;
  error: BrandSalesFailure | null;
  onRetry: () => void;
  initialView?: "brand" | "category";
}) {
  const titleId = useId();
  const [view, setView] = useState<"brand" | "category">(initialView);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const sortedSegments = snapshot
    ? sortBrandSalesSegments<RevenueShareSegment>(
        view === "brand" ? snapshot.segments : snapshot.categorySegments,
      )
    : [];
  const positive = sortedSegments.filter((segment) => segment.amount > 0);
  const total = snapshot?.summary.amount ?? 0;
  const active = sortedSegments.find((segment) => segment.key === activeKey) ?? null;
  let offset = 0;

  return (
    <section className="brand-sales-card" data-share-view={view} aria-busy={loading} aria-labelledby={titleId}>
      <header className="brand-sales-heading">
        <h3 id={titleId}>{view === "brand" ? "品牌營收占比" : "品類營收占比"}</h3>
        <div className="sales-trend-range" role="group" aria-label="營收占比分類方式">
          {(["brand", "category"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => {
                setView(option);
                setActiveKey(null);
              }}
            >
              {option === "brand" ? "品牌" : "品類"}
            </button>
          ))}
        </div>
      </header>
      {snapshot?.rangeFreshness === "includes-current-day" && (
        <time className="brand-sales-cutoff" dateTime={snapshot.dataThrough}>
          {currentDayCutoff(snapshot.dataThrough)}
        </time>
      )}

      {error && (
        <div className="brand-sales-error" role="alert">
          <div>
            <strong>{error.code === "REPORT_CANCELLED"
              ? "Amazon 已取消這次報表"
              : error.code === "REPORT_FATAL"
                ? "Amazon 無法完成這次報表"
                : "營收占比暫時未完成"}</strong>
            <p>{error.message}</p>
            {error.requestId && <small>Request ID: {error.requestId}</small>}
          </div>
          <button type="button" onClick={onRetry} disabled={loading}>再試一次</button>
        </div>
      )}
      {!snapshot && !error && (
        <div className="brand-sales-empty">
          {loading && <div className="brand-sales-pending" aria-hidden="true"><span /><span /><span /></div>}
          <strong>{loading ? "Amazon 正在準備 FBA 出貨報表…" : "等待銷售區間"}</strong>
        </div>
      )}

      {snapshot && (
        <>
          <div className="brand-sales-visual">
              <div className="brand-sales-selection" aria-live="polite">
                <small>{active ? active.label : "總計"}</small>
                <strong>{formatMoney(active?.amount ?? total, snapshot.currencyCode)}</strong>
                <span>{active
                  ? `${active.percentage}% · ${active.unitCount.toLocaleString()} 件`
                  : `${snapshot.summary.unitCount.toLocaleString()} 件`}</span>
              </div>
            <div className="brand-sales-pie-stage">
              <div className="brand-sales-pie-wrap">
                <svg className="brand-sales-pie" viewBox="0 0 120 120" role="img" aria-label={`${view === "brand" ? "品牌" : "品類"}營收占比 ${formatMoney(total, snapshot.currencyCode)}`}>
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

            </div>
            {total === 0 && (
              <p className="brand-sales-zero" role="status">這個區間尚無營收。</p>
            )}
            <div className="brand-sales-legend-heading" aria-hidden="true">
              <span>{view === "brand" ? "品牌" : "品類"}／營收</span>
              <span>占比</span>
            </div>
            <div className="brand-sales-legend" role="list" aria-label={`${view === "brand" ? "品牌" : "品類"}營收明細`}>
              {sortedSegments.map((segment) => (
                <div key={segment.key} role="listitem">
                  <button
                    type="button"
                    className={activeKey === segment.key ? "is-active" : undefined}
                    onPointerEnter={() => setActiveKey(segment.key)}
                    onPointerLeave={() => setActiveKey(null)}
                    onFocus={() => setActiveKey(segment.key)}
                    onBlur={() => setActiveKey(null)}
                  >
                    <i style={{ backgroundColor: segment.color }} aria-hidden="true" />
                    <span><strong>{segment.label}</strong><small><span className="brand-sales-row-amount">{formatMoney(segment.amount, snapshot.currencyCode)}</span><span className="brand-sales-row-volume">{segment.skuCount} SKU · {segment.unitCount.toLocaleString()} 件</span></small></span>
                    <b>{segment.percentage}%</b>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
