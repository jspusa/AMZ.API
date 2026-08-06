"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

type Money = { amount: number; currencyCode: string };

export type TrendPresetDays = 7 | 14 | 30 | 90;

export type TrendRangeSelection =
  | { kind: "preset"; days: TrendPresetDays }
  | { kind: "custom"; startDate: string; endDate: string };

export type SalesTrendPoint = {
  date: string;
  interval: string;
  totalSales: Money;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
  partial: boolean;
};

export type SalesTrendRange = {
  startDate: string;
  endDate: string;
  dayCount: number;
  presetDays: TrendPresetDays | null;
};

export type SalesTrendTotals = {
  totalSales: Money;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
};

export type SalesTrendComparison = {
  kind: "previous-year";
  range: SalesTrendRange;
  points: SalesTrendPoint[];
  totals: SalesTrendTotals;
  requestId: string | null;
  rateLimit: string | null;
};

export type SalesTrendSnapshot = {
  schemaVersion: 2;
  mode: "live" | "demo";
  marketplaceId: string;
  days: number;
  range: SalesTrendRange;
  timeZone: string;
  points: SalesTrendPoint[];
  totals: SalesTrendTotals;
  comparison: SalesTrendComparison | null;
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string;
};

type Coordinate = {
  point: SalesTrendPoint;
  comparisonPoint: SalesTrendPoint | null;
  x: number;
  y: number;
  comparisonY: number | null;
};

const WIDTH = 760;
const HEIGHT = 250;
const PLOT = { left: 66, right: 18, top: 20, bottom: 42 };
const RANGE_OPTIONS = [7, 14, 30, 90] as const;
const DAY_MILLISECONDS = 86_400_000;

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

function dateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function previousYearDateKey(value: string): string | null {
  const parts = dateParts(value);
  if (!parts) return null;
  const previousYear = parts.year - 1;
  const candidate = new Date(Date.UTC(previousYear, parts.month - 1, parts.day));
  if (
    candidate.getUTCFullYear() !== previousYear ||
    candidate.getUTCMonth() !== parts.month - 1 ||
    candidate.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return dateKey(previousYear, parts.month, parts.day);
}

export function earliestComparableStartDate(latestAvailableDate: string): string | null {
  const parts = dateParts(latestAvailableDate);
  if (!parts) return null;
  const previousYear = parts.year - 1;
  const lastDayOfMonth = new Date(
    Date.UTC(previousYear, parts.month, 0),
  ).getUTCDate();
  const shifted = new Date(
    Date.UTC(previousYear, parts.month - 1, Math.min(parts.day, lastDayOfMonth) + 1),
  );
  return dateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

function inclusiveDayCount(startDate: string, endDate: string): number | null {
  const start = dateParts(startDate);
  const end = dateParts(endDate);
  if (!start || !end) return null;
  const startTime = Date.UTC(start.year, start.month - 1, start.day);
  const endTime = Date.UTC(end.year, end.month - 1, end.day);
  return Math.floor((endTime - startTime) / DAY_MILLISECONDS) + 1;
}

export function trendCustomRangeError(
  startDate: string,
  endDate: string,
  earliestStartDate: string | null = null,
  latestAvailableDate: string | null = null,
): string | null {
  if (!startDate || !endDate) return "請選擇開始日與結束日。";
  const dayCount = inclusiveDayCount(startDate, endDate);
  if (dayCount === null) return "日期格式無效，請重新選擇。";
  if (dayCount < 1) return "結束日不可早於開始日。";
  if (latestAvailableDate && endDate > latestAvailableDate) {
    return `目前僅有截至 ${latestAvailableDate} 的資料；之後日期尚未有資料，請調整結束日。`;
  }
  if (dayCount > 90) return "自訂範圍最多 90 天（包含開始日與結束日）。";
  if (earliestStartDate && startDate < earliestStartDate) {
    return `為了同時查詢去年同期，開始日最早可選 ${earliestStartDate}。`;
  }
  return null;
}

export function submitTrendCustomRange({
  startDate,
  endDate,
  earliestStartDate,
  latestAvailableDate,
  currentSelection,
  onSelectionChange,
}: {
  startDate: string;
  endDate: string;
  earliestStartDate: string | null;
  latestAvailableDate: string | null;
  currentSelection: TrendRangeSelection;
  onSelectionChange: (selection: TrendRangeSelection) => void;
}): boolean {
  if (
    trendCustomRangeError(
      startDate,
      endDate,
      earliestStartDate,
      latestAvailableDate,
    )
  ) {
    return false;
  }
  if (
    currentSelection.kind === "custom" &&
    currentSelection.startDate === startDate &&
    currentSelection.endDate === endDate
  ) {
    return false;
  }
  onSelectionChange({ kind: "custom", startDate, endDate });
  return true;
}

export function nearestTrendPointIndex(
  clientX: number,
  boundsLeft: number,
  boundsWidth: number,
  pointCount: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(boundsLeft) || boundsWidth <= 0 || pointCount <= 0) {
    return null;
  }
  if (pointCount === 1) return 0;
  const viewX = ((clientX - boundsLeft) / boundsWidth) * WIDTH;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const ratio = Math.min(1, Math.max(0, (viewX - PLOT.left) / plotWidth));
  return Math.round(ratio * (pointCount - 1));
}

function linePath(coordinates: Array<{ x: number; y: number | null }>): string {
  let drawing = false;
  return coordinates
    .map(({ x, y }) => {
      if (y === null) {
        drawing = false;
        return "";
      }
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function rangeYears(range: SalesTrendRange): string {
  const startYear = range.startDate.slice(0, 4);
  const endYear = range.endDate.slice(0, 4);
  return startYear === endYear ? startYear : `${startYear}–${endYear}`;
}

function rangeLabel(range: SalesTrendRange): string {
  return range.presetDays
    ? `最近 ${range.presetDays} 天 FBA 銷售`
    : `${range.startDate} 至 ${range.endDate} FBA 銷售`;
}

export default function SalesTrendChart({
  snapshot,
  selection,
  loading,
  error,
  onSelectionChange,
  onRetry,
}: {
  snapshot: SalesTrendSnapshot | null;
  selection: TrendRangeSelection;
  loading: boolean;
  error: string | null;
  onSelectionChange: (selection: TrendRangeSelection) => void;
  onRetry: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const tooltipId = useId();
  const customErrorId = useId();
  const customPanelId = useId();
  const gradientId = `${titleId.replace(/:/g, "")}-area`;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const plotScrollRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const keyboardNavigationRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(selection.kind === "custom");
  const [customStartDate, setCustomStartDate] = useState(
    selection.kind === "custom" ? selection.startDate : snapshot?.range.startDate ?? "",
  );
  const [customEndDate, setCustomEndDate] = useState(
    selection.kind === "custom" ? selection.endDate : snapshot?.range.endDate ?? "",
  );
  const [customTouched, setCustomTouched] = useState(false);
  const [latestAvailableDate, setLatestAvailableDate] = useState<string | null>(
    snapshot?.range.presetDays ? snapshot.range.endDate : null,
  );

  useEffect(() => {
    if (selection.kind !== "custom") {
      setCustomOpen(false);
      return;
    }
    setCustomOpen(true);
    setCustomStartDate(selection.startDate);
    setCustomEndDate(selection.endDate);
    setCustomTouched(false);
  }, [selection]);

  useEffect(() => {
    if (selection.kind !== "preset" || customOpen || !snapshot) return;
    setCustomStartDate(snapshot.range.startDate);
    setCustomEndDate(snapshot.range.endDate);
    setCustomTouched(false);
  }, [customOpen, selection, snapshot]);

  useEffect(() => {
    setActiveIndex(null);
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot?.range.presetDays) return;
    setLatestAvailableDate((current) =>
      current && current >= snapshot.range.endDate
        ? current
        : snapshot.range.endDate,
    );
  }, [snapshot]);

  const points = snapshot?.points ?? [];
  const comparisonByDate = useMemo(
    () => new Map(snapshot?.comparison?.points.map((point) => [point.date, point]) ?? []),
    [snapshot],
  );
  const alignedComparison = useMemo(
    () =>
      points.map((point) => {
        const comparisonDate = previousYearDateKey(point.date);
        return comparisonDate ? comparisonByDate.get(comparisonDate) ?? null : null;
      }),
    [comparisonByDate, points],
  );
  const currencyCode =
    snapshot?.totals.totalSales.currencyCode ??
    points[0]?.totalSales.currencyCode ??
    "USD";
  const maxAmount = Math.max(
    0,
    ...points.map((point) => point.totalSales.amount),
    ...alignedComparison.map((point) => point?.totalSales.amount ?? 0),
  );
  const scaleMax = maxAmount > 0 ? maxAmount : 1;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const baseline = PLOT.top + plotHeight;
  const coordinates: Coordinate[] = points.map((point, index) => {
    const comparisonPoint = alignedComparison[index];
    return {
      point,
      comparisonPoint,
      x:
        PLOT.left +
        (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth),
      y: PLOT.top + plotHeight - (point.totalSales.amount / scaleMax) * plotHeight,
      comparisonY: comparisonPoint
        ? PLOT.top + plotHeight - (comparisonPoint.totalSales.amount / scaleMax) * plotHeight
        : null,
    };
  });
  const currentLinePath = linePath(coordinates.map(({ x, y }) => ({ x, y })));
  const comparisonLinePath = linePath(
    coordinates.map(({ x, comparisonY }) => ({ x, y: comparisonY })),
  );
  const areaPath = coordinates.length
    ? `${currentLinePath} L${coordinates.at(-1)!.x.toFixed(2)},${baseline.toFixed(
        2,
      )} L${coordinates[0].x.toFixed(2)},${baseline.toFixed(2)} Z`
    : "";
  const labelEvery = Math.max(1, Math.ceil(Math.max(1, points.length - 1) / 7));
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const allZero = Boolean(points.length) && maxAmount === 0;
  const active = activeIndex === null ? null : coordinates[activeIndex] ?? null;
  const earliestStartDate = useMemo(
    () =>
      latestAvailableDate
        ? earliestComparableStartDate(latestAvailableDate)
        : null,
    [latestAvailableDate],
  );
  const customError = trendCustomRangeError(
    customStartDate,
    customEndDate,
    earliestStartDate,
    latestAvailableDate,
  );
  const currentYears = snapshot ? rangeYears(snapshot.range) : "本期";
  const comparisonYears = snapshot?.comparison
    ? rangeYears(snapshot.comparison.range)
    : "去年同期";

  const setNearestPoint = (event: PointerEvent<SVGSVGElement>) => {
    keyboardNavigationRef.current = false;
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setActiveIndex(nearestTrendPointIndex(event.clientX, bounds.left, bounds.width, points.length));
  };

  const handleChartKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const currentIndex = activeIndex ?? points.length - 1;
    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === "ArrowRight") nextIndex = Math.min(points.length - 1, currentIndex + 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = points.length - 1;
    else if (event.key === "Escape") {
      setActiveIndex(null);
      return;
    } else {
      return;
    }
    event.preventDefault();
    keyboardNavigationRef.current = true;
    setActiveIndex(nextIndex);
  };

  useEffect(() => {
    if (
      activeIndex === null ||
      activeIndex >= points.length ||
      !keyboardNavigationRef.current
    ) return;
    const scrollContainer = plotScrollRef.current;
    const plot = plotRef.current;
    if (!scrollContainer || !plot || points.length === 0) return;
    const plotWidth = plot.clientWidth;
    if (plotWidth <= 0 || scrollContainer.clientWidth <= 0) return;
    const pointViewX =
      PLOT.left +
      (points.length <= 1
        ? (WIDTH - PLOT.left - PLOT.right) / 2
        : (activeIndex / (points.length - 1)) *
          (WIDTH - PLOT.left - PLOT.right));
    const pointLeft = (pointViewX / WIDTH) * plotWidth;
    const inset = Math.min(48, scrollContainer.clientWidth / 4);
    const visibleLeft = scrollContainer.scrollLeft;
    const visibleRight = visibleLeft + scrollContainer.clientWidth;
    let nextLeft = visibleLeft;
    if (pointLeft < visibleLeft + inset) {
      nextLeft = Math.max(0, pointLeft - inset);
    } else if (pointLeft > visibleRight - inset) {
      nextLeft = Math.min(
        plotWidth - scrollContainer.clientWidth,
        pointLeft - scrollContainer.clientWidth + inset,
      );
    }
    if (Math.abs(nextLeft - visibleLeft) > 1) {
      scrollContainer.scrollTo({ left: nextLeft, behavior: "auto" });
    }
  }, [activeIndex, points.length]);

  const applyCustomRange = () => {
    setCustomTouched(true);
    if (loading || customError) return;
    submitTrendCustomRange({
      startDate: customStartDate,
      endDate: customEndDate,
      earliestStartDate,
      latestAvailableDate,
      currentSelection: selection,
      onSelectionChange,
    });
  };

  const tooltipPlacement = active
    ? {
        left: `${(active.x / WIDTH) * 100}%`,
        top: `${((Math.min(active.y, active.comparisonY ?? active.y) < 88
          ? Math.max(active.y, active.comparisonY ?? active.y) + 12
          : Math.min(active.y, active.comparisonY ?? active.y) - 10) /
          HEIGHT) *
          100}%`,
      }
    : undefined;
  const tooltipClasses = active
    ? [
        "sales-trend-tooltip",
        active.x < WIDTH * 0.22 ? "is-left" : active.x > WIDTH * 0.78 ? "is-right" : "",
        Math.min(active.y, active.comparisonY ?? active.y) < 88 ? "is-below" : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "sales-trend-tooltip";

  return (
    <section className="sales-trend" aria-busy={loading}>
      <header className="sales-trend-summary">
        <div>
          <span>{snapshot ? rangeLabel(snapshot.range) : "FBA 銷售趨勢"}</span>
          <strong>
            {snapshot ? formatMoney(snapshot.totals.totalSales) : "—"}
          </strong>
          <small>
            {snapshot
              ? `${snapshot.totals.orderCount.toLocaleString()} 筆訂單 · ${snapshot.totals.unitCount.toLocaleString()} 件${snapshot.points.some((point) => point.partial) ? " · 含今日即時資料" : ""}`
              : "Amazon Sales API · 站點當地日界"}
          </small>
        </div>
        <div className="sales-trend-range" role="group" aria-label="銷售趨勢日期範圍">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={selection.kind === "preset" && selection.days === option}
              onClick={() => {
                if (loading) return;
                setCustomOpen(false);
                if (selection.kind !== "preset" || selection.days !== option) {
                  onSelectionChange({ kind: "preset", days: option });
                }
              }}
              disabled={loading}
            >
              {option} 天
            </button>
          ))}
          <button
            type="button"
            aria-pressed={selection.kind === "custom"}
            aria-expanded={customOpen}
            aria-controls={customPanelId}
            onClick={() => {
              if (loading) return;
              setCustomOpen(true);
              if (!customStartDate && snapshot) setCustomStartDate(snapshot.range.startDate);
              if (!customEndDate && snapshot) setCustomEndDate(snapshot.range.endDate);
            }}
            disabled={loading}
          >
            自訂
          </button>
        </div>
      </header>

      {customOpen && (
        <div id={customPanelId} className="sales-trend-custom-range">
          <label>
            <span>開始日</span>
            <input
              type="date"
              value={customStartDate}
              min={earliestStartDate ?? undefined}
              max={latestAvailableDate ?? undefined}
              onChange={(event) => {
                setCustomStartDate(event.target.value);
                setCustomTouched(true);
              }}
              aria-invalid={customTouched && Boolean(customError)}
              aria-describedby={customTouched && customError ? customErrorId : undefined}
              disabled={loading}
            />
          </label>
          <span aria-hidden="true">至</span>
          <label>
            <span>結束日</span>
            <input
              type="date"
              value={customEndDate}
              min={earliestStartDate ?? undefined}
              max={latestAvailableDate ?? undefined}
              onChange={(event) => {
                setCustomEndDate(event.target.value);
                setCustomTouched(true);
              }}
              aria-invalid={customTouched && Boolean(customError)}
              aria-describedby={customTouched && customError ? customErrorId : undefined}
              disabled={loading}
            />
          </label>
          <button
            type="button"
            onClick={applyCustomRange}
            disabled={loading}
          >
            {loading ? "載入中…" : "套用"}
          </button>
          <small>
            包含開始日與結束日，最多 90 天；
            {latestAvailableDate
              ? `目前資料截至 ${latestAvailableDate}。`
              : "Amazon 仍會在 Mac 端再次驗證可查日期。"}
            {earliestStartDate
              ? ` 為了同時查詢去年同期，開始日最早為 ${earliestStartDate}。`
              : ""}
          </small>
          {customTouched && customError && (
            <p id={customErrorId} role="alert">{customError}</p>
          )}
        </div>
      )}

      {snapshot && (
        <div className="sales-trend-legend" aria-label="折線圖圖例">
          <span><i className="is-current" aria-hidden="true" />本期 {currentYears}</span>
          {snapshot.comparison && (
            <span><i className="is-comparison" aria-hidden="true" />去年同期 {comparisonYears}</span>
          )}
        </div>
      )}

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
        <figure className={[allZero ? "is-zero" : "", points.length > 30 ? "is-dense" : ""].filter(Boolean).join(" ")}>
          <div ref={plotScrollRef} className="sales-trend-plot-scroll">
            <div ref={plotRef} className="sales-trend-plot">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                role="img"
                tabIndex={0}
                aria-labelledby={titleId}
                aria-describedby={`${descriptionId}${active ? ` ${tooltipId}` : ""}`}
                onFocus={() => {
                  keyboardNavigationRef.current = true;
                  if (points.length && activeIndex === null) setActiveIndex(points.length - 1);
                }}
                onBlur={() => {
                  keyboardNavigationRef.current = false;
                  setActiveIndex(null);
                }}
                onKeyDown={handleChartKeyDown}
                onPointerMove={setNearestPoint}
                onPointerDown={setNearestPoint}
                onPointerLeave={(event) => {
                  if (event.pointerType === "mouse") setActiveIndex(null);
                }}
                preserveAspectRatio="xMidYMid meet"
              >
            <title id={titleId}>{`${snapshot.range.startDate} 至 ${snapshot.range.endDate} 每日 FBA 銷售與去年同期比較折線圖`}</title>
            <desc id={descriptionId}>
              本期總銷售 {formatMoney(snapshot.totals.totalSales)}，共 {snapshot.totals.orderCount} 筆訂單與 {snapshot.totals.unitCount} 件商品。
              {snapshot.comparison
                ? `去年同期總銷售 ${formatMoney(snapshot.comparison.totals.totalSales)}。橘色實線為本期，灰色虛線為去年同期。`
                : "目前沒有去年同期比較資料。"}
              可用左右方向鍵逐日查看。
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
            {comparisonLinePath && (
              <path className="sales-trend-line is-comparison" d={comparisonLinePath} />
            )}
            {currentLinePath && <path className="sales-trend-line is-current" d={currentLinePath} />}
            {active && (
              <line
                className="sales-trend-crosshair"
                x1={active.x}
                x2={active.x}
                y1={PLOT.top}
                y2={baseline}
              />
            )}
            {coordinates.map(({ point, comparisonPoint, x, y, comparisonY }, index) => (
              <g key={point.date}>
                <circle
                  className={`sales-trend-point is-current ${point.partial ? "partial" : ""} ${activeIndex === index ? "is-active" : ""}`}
                  cx={x}
                  cy={y}
                  r={point.partial || activeIndex === index ? 4.5 : 3.25}
                />
                {comparisonPoint && comparisonY !== null && (
                  <circle
                    className={`sales-trend-point is-comparison ${activeIndex === index ? "is-active" : ""}`}
                    cx={x}
                    cy={comparisonY}
                    r={activeIndex === index ? 4.5 : 3.25}
                  />
                )}
                {(index % labelEvery === 0 || index === coordinates.length - 1) && (
                  <text className="sales-trend-x-label" x={x} y={HEIGHT - 15} textAnchor="middle">
                    {shortDate(point.date)}
                  </text>
                )}
              </g>
            ))}
                <rect
                  className="sales-trend-hit-overlay"
                  x={PLOT.left}
                  y={PLOT.top}
                  width={plotWidth}
                  height={plotHeight}
                />
              </svg>
              {active && tooltipPlacement && (
                <div
                  id={tooltipId}
                  className={tooltipClasses}
                  style={tooltipPlacement}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <strong>{active.point.date}{active.point.partial ? "（即時）" : ""}</strong>
                  <span><i className="is-current" aria-hidden="true" />本期 {formatMoney(active.point.totalSales)}</span>
                  <span><i className="is-comparison" aria-hidden="true" />{active.comparisonPoint ? `${active.comparisonPoint.date} ${formatMoney(active.comparisonPoint.totalSales)}` : "去年同期無對應日期"}</span>
                </div>
              )}
              {allZero && (
                <div className="sales-trend-zero">
                  <strong>{snapshot.comparison ? "這兩段期間尚無 FBA 銷售" : "這段期間尚無 FBA 銷售"}</strong>
                  <small>圖表已成功同步，並非資料載入失敗。</small>
                </div>
              )}
            </div>
          </div>
          <figcaption>
            {snapshot.notice}
          </figcaption>
          <table className="sales-trend-a11y-table">
            <caption>{snapshot.range.startDate} 至 {snapshot.range.endDate} 每日 FBA 銷售與去年同期資料</caption>
            <thead>
              <tr>
                <th>本期日期</th><th>本期銷售額</th><th>本期訂單</th><th>本期件數</th>
                <th>去年同期日期</th><th>去年同期銷售額</th><th>去年同期訂單</th><th>去年同期件數</th>
              </tr>
            </thead>
            <tbody>
              {coordinates.map(({ point, comparisonPoint }) => (
                <tr key={point.date}>
                  <td>{point.date}{point.partial ? "（即時）" : ""}</td>
                  <td>{formatMoney(point.totalSales)}</td>
                  <td>{point.orderCount}</td>
                  <td>{point.unitCount}</td>
                  <td>{comparisonPoint?.date ?? "無對應日期"}</td>
                  <td>{comparisonPoint ? formatMoney(comparisonPoint.totalSales) : "—"}</td>
                  <td>{comparisonPoint?.orderCount ?? "—"}</td>
                  <td>{comparisonPoint?.unitCount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}
    </section>
  );
}
