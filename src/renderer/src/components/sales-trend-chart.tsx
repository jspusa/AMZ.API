"use client";

import { useId } from "react";

type Money = { amount: number; currencyCode: string };

export type SalesTrendPoint = {
  date: string;
  interval: string;
  totalSales: Money;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
  partial: boolean;
};

export type SalesTrendSnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  days: 7 | 14 | 30;
  timeZone: string;
  points: SalesTrendPoint[];
  totals: {
    totalSales: Money;
    unitCount: number;
    orderItemCount: number;
    orderCount: number;
  };
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string;
};

const WIDTH = 760;
const HEIGHT = 250;
const PLOT = { left: 66, right: 18, top: 20, bottom: 42 };
const RANGE_OPTIONS = [7, 14, 30] as const;

export function salesTrendFailureMessage(
  status: number,
  problem: { code?: string; message?: string },
): string {
  if (status === 404 && problem.code === "NOT_FOUND") {
    return "這台 Mac App 尚未支援完整 FBA 銷售折線圖，請安裝新版後再同步。";
  }
  return problem.message || "目前無法載入 FBA 銷售趨勢。";
}

function formatMoney(money: Money): string {
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: money.currencyCode,
      maximumFractionDigits: money.currencyCode === "JPY" ? 0 : 2,
    }).format(money.amount);
  } catch {
    return `${money.currencyCode} ${money.amount.toLocaleString()}`;
  }
}

function formatAxisAmount(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: currencyCode,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return amount.toLocaleString();
  }
}

function shortDate(value: string): string {
  const [, month = "", day = ""] = value.split("-");
  return `${month}/${day}`;
}

export default function SalesTrendChart({
  snapshot,
  days,
  loading,
  error,
  onDaysChange,
  onRetry,
}: {
  snapshot: SalesTrendSnapshot | null;
  days: 7 | 14 | 30;
  loading: boolean;
  error: string | null;
  onDaysChange: (days: 7 | 14 | 30) => void;
  onRetry: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const gradientId = `${titleId.replace(/:/g, "")}-area`;
  const points = snapshot?.points ?? [];
  const currencyCode =
    snapshot?.totals.totalSales.currencyCode ??
    points[0]?.totalSales.currencyCode ??
    "USD";
  const maxAmount = points.reduce(
    (maximum, point) => Math.max(maximum, point.totalSales.amount),
    0,
  );
  const scaleMax = maxAmount > 0 ? maxAmount : 1;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const baseline = PLOT.top + plotHeight;
  const coordinates = points.map((point, index) => ({
    point,
    x:
      PLOT.left +
      (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth),
    y: PLOT.top + plotHeight - (point.totalSales.amount / scaleMax) * plotHeight,
  }));
  const linePath = coordinates
    .map(({ x, y }, index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const areaPath = coordinates.length
    ? `${linePath} L${coordinates.at(-1)!.x.toFixed(2)},${baseline.toFixed(
        2,
      )} L${coordinates[0].x.toFixed(2)},${baseline.toFixed(2)} Z`
    : "";
  const labelEvery = days === 30 ? 5 : days === 14 ? 2 : 1;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const allZero = Boolean(points.length) && maxAmount === 0;

  return (
    <section className="sales-trend" aria-busy={loading}>
      <header className="sales-trend-summary">
        <div>
          <span>最近 {days} 天 FBA 銷售</span>
          <strong>
            {snapshot ? formatMoney(snapshot.totals.totalSales) : "—"}
          </strong>
          <small>
            {snapshot
              ? `${snapshot.totals.orderCount.toLocaleString()} 筆訂單 · ${snapshot.totals.unitCount.toLocaleString()} 件 · 含今日即時資料`
              : "Amazon Sales API · 站點當地日界"}
          </small>
        </div>
        <div className="sales-trend-range" role="group" aria-label="銷售趨勢日期範圍">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={days === option}
              onClick={() => onDaysChange(option)}
              disabled={loading && days === option}
            >
              {option} 天
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="sales-trend-error" role="alert">
          <div>
            <strong>銷售折線圖尚未同步</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={onRetry} disabled={loading}>
            再試一次
          </button>
        </div>
      ) : !snapshot ? (
        <div className="sales-trend-loading" aria-live="polite">
          <span />
          <strong>{loading ? "正在彙整每日 FBA 銷售…" : "等待銷售趨勢資料"}</strong>
        </div>
      ) : (
        <figure className={allZero ? "is-zero" : ""}>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-labelledby={`${titleId} ${descriptionId}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <title id={titleId}>{`最近 ${days} 天每日 FBA 銷售折線圖`}</title>
            <desc id={descriptionId}>
              總銷售 {formatMoney(snapshot.totals.totalSales)}，共 {snapshot.totals.orderCount} 筆訂單與 {snapshot.totals.unitCount} 件商品；最後一日為今日即時資料。
            </desc>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff9900" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#ff9900" stopOpacity="0.015" />
              </linearGradient>
            </defs>
            {yTicks.map((tick) => {
              const y = PLOT.top + plotHeight - tick * plotHeight;
              return (
                <g key={tick} className="sales-trend-gridline">
                  <line x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y} y2={y} />
                  <text x={PLOT.left - 10} y={y + 3} textAnchor="end">
                    {formatAxisAmount(scaleMax * tick, currencyCode)}
                  </text>
                </g>
              );
            })}
            {areaPath && <path className="sales-trend-area" d={areaPath} fill={`url(#${gradientId})`} />}
            {linePath && <path className="sales-trend-line" d={linePath} />}
            {coordinates.map(({ point, x, y }, index) => (
              <g key={point.date} className={`sales-trend-point ${point.partial ? "partial" : ""}`}>
                <circle cx={x} cy={y} r={point.partial ? 4.5 : 3.5}>
                  <title>{`${point.date}${point.partial ? "（今日即時）" : ""}：${formatMoney(point.totalSales)}；${point.orderCount} 筆訂單；${point.unitCount} 件`}</title>
                </circle>
                {(index % labelEvery === 0 || index === coordinates.length - 1) && (
                  <text className="sales-trend-x-label" x={x} y={HEIGHT - 15} textAnchor="middle">
                    {shortDate(point.date)}
                  </text>
                )}
              </g>
            ))}
          </svg>
          {allZero && (
            <div className="sales-trend-zero">
              <strong>這段期間尚無 FBA 銷售</strong>
              <small>圖表已成功同步，並非資料載入失敗。</small>
            </div>
          )}
          <figcaption>
            {snapshot.notice}
          </figcaption>
          <table className="sales-trend-a11y-table">
            <caption>最近 {days} 天每日 FBA 銷售資料</caption>
            <thead>
              <tr><th>日期</th><th>銷售額</th><th>訂單</th><th>件數</th></tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <td>{point.date}{point.partial ? "（今日即時）" : ""}</td>
                  <td>{formatMoney(point.totalSales)}</td>
                  <td>{point.orderCount}</td>
                  <td>{point.unitCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}
    </section>
  );
}
