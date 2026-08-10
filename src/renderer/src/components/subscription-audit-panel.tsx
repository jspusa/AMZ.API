"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  isSubscriptionAuditMarketplaceSupported,
  parseSubscriptionAuditSnapshot,
  subscriptionAuditMonthLabel,
  type SubscriptionAuditMonthCount,
  type SubscriptionAuditOffer,
  type SubscriptionAuditSnapshot,
  type SubscriptionInventoryEvidence,
  type SubscriptionUpstreamCoverage,
} from "../subscription-audit";
import { auditExportFilename } from "../audit-export-filename";

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

const SUBSCRIPTION_FILTERS = ["all", 0, 5, 10, 15, 20, "problem"] as const;
const STANDARD_DISCOUNTS = new Set<number>([0, 5, 10, 15, 20]);

export type SubscriptionAuditFilter = (typeof SUBSCRIPTION_FILTERS)[number];
export type SubscriptionAuditDisplayRow = {
  sellerSku: string;
  offer: SubscriptionAuditOffer | null;
  problem: string | null;
};
export type SubscriptionAuditAggregatePoint = {
  month: string;
  value: number | null;
  reportedOfferCount: number;
  expectedOfferCount: number;
  complete: boolean;
};

export function subscriptionAuditDisplayRows(
  snapshot: SubscriptionAuditSnapshot,
): SubscriptionAuditDisplayRow[] {
  const problemsBySku = new Map<string, string[]>();
  const addProblem = (sellerSku: string, problem: string) => {
    const problems = problemsBySku.get(sellerSku) ?? [];
    if (!problems.includes(problem)) problems.push(problem);
    problemsBySku.set(sellerSku, problems);
  };
  for (const row of snapshot.upstreamCoverage.problemSkuRows) {
    addProblem(row.sellerSku, row.problem);
  }
  for (const row of snapshot.excluded) {
    addProblem(
      row.sellerSku,
      row.reason === "ASIN_MISMATCH"
        ? "Amazon offer 與月度指標 ASIN 不一致；未強行合併。"
        : "Amazon 回傳月度指標，但沒有同次可核對的目前 offer。",
    );
  }
  const emitted = new Set<string>();
  const rows = snapshot.offers.map((offer): SubscriptionAuditDisplayRow => {
    emitted.add(offer.sellerSku);
    const problems = [...(problemsBySku.get(offer.sellerSku) ?? [])];
    if (offer.sellerFundedBaseDiscount === null) {
      problems.push("Amazon 未回傳 Seller 基礎折扣；不會當成 0%。");
    } else if (!STANDARD_DISCOUNTS.has(offer.sellerFundedBaseDiscount)) {
      problems.push(
        `Amazon 回傳非標準 Seller 基礎折扣 ${offer.sellerFundedBaseDiscount}%。`,
      );
    }
    return {
      sellerSku: offer.sellerSku,
      offer,
      problem: problems.length > 0 ? problems.join("；") : null,
    };
  });
  for (const problem of snapshot.upstreamCoverage.problemSkuRows) {
    if (emitted.has(problem.sellerSku)) continue;
    emitted.add(problem.sellerSku);
    rows.push({
      sellerSku: problem.sellerSku,
      offer: null,
      problem: problem.problem,
    });
  }
  for (const excluded of snapshot.excluded) {
    if (emitted.has(excluded.sellerSku)) continue;
    emitted.add(excluded.sellerSku);
    rows.push({
      sellerSku: excluded.sellerSku,
      offer: null,
      problem: problemsBySku.get(excluded.sellerSku)?.join("；") ?? null,
    });
  }
  return rows.sort((left, right) => left.sellerSku.localeCompare(right.sellerSku));
}

export function subscriptionAuditRowMatchesFilter(
  row: SubscriptionAuditDisplayRow,
  filter: SubscriptionAuditFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "problem") return row.problem !== null;
  return row.problem === null && row.offer?.sellerFundedBaseDiscount === filter;
}

function subscriptionAuditFilterLabel(filter: SubscriptionAuditFilter): string {
  if (filter === "all") return "全部";
  if (filter === "problem") return "有問題";
  return `${filter}%`;
}

export function aggregateSubscriptionAuditHistory(
  snapshot: SubscriptionAuditSnapshot,
): SubscriptionAuditAggregatePoint[] {
  const expectedOfferCount = snapshot.offers.length;
  const sourceScopeComplete =
    snapshot.inventoryEvidence.coverage === "complete" &&
    snapshot.inventoryEvidence.unverifiedFbaSkuCount === 0 &&
    snapshot.upstreamCoverage.status === "complete";
  const seriesByOffer = snapshot.offers.map(
    (offer) => new Map(offer.monthlySeries.map((point) => [point.month, point])),
  );
  return snapshot.intervals.map(({ month }) => {
    const values = seriesByOffer.flatMap((series) => {
      const value = series.get(month)?.activeSubscriptionsAtPeriodEnd;
      return value === null || value === undefined ? [] : [value];
    });
    const reportedOfferCount = values.length;
    const complete =
      sourceScopeComplete && reportedOfferCount === expectedOfferCount;
    return {
      month,
      value: reportedOfferCount > 0
        ? values.reduce((sum, value) => sum + value, 0)
        : complete && expectedOfferCount === 0
          ? 0
          : null,
      reportedOfferCount,
      expectedOfferCount,
      complete,
    };
  });
}

function revenueCoverageNote(snapshot: SubscriptionAuditSnapshot): string {
  const coverage = snapshot.summary.revenueCoverage;
  const inventoryGap = snapshot.inventoryEvidence.unverifiedFbaSkuCount;
  const inventoryRowsUnrecognized =
    snapshot.inventoryEvidence.unrecognizedSellerSkuRows;
  if (
    snapshot.upstreamCoverage.status === "partial" ||
    snapshot.inventoryEvidence.coverage === "partial" ||
    inventoryGap > 0
  ) {
    const verifiedScope = coverage.expectedOfferMonths === 0
      ? "目前沒有可核對 S&S offer 的 SKU 月份"
      : coverage.reportedOfferMonths === coverage.expectedOfferMonths
      ? `可核對的 ${coverage.expectedOfferMonths.toLocaleString("zh-TW")} 個 SKU 月份均有營收資料`
      : `已核對資料為 ${coverage.reportedOfferMonths.toLocaleString("zh-TW")}／${coverage.expectedOfferMonths.toLocaleString("zh-TW")} 個 SKU 月份`;
    const gaps: string[] = [];
    if (inventoryRowsUnrecognized > 0) {
      gaps.push(`有 ${inventoryRowsUnrecognized.toLocaleString("zh-TW")} 列 Seller SKU 無法原樣辨識，其他有效 SKU 已繼續核對`);
    }
    if (inventoryGap > 0) {
      gaps.push(`同次已證明 FBA 的 SKU 中，另有 ${inventoryGap.toLocaleString("zh-TW")} 個未取得可核對的 Replenishment offer（未回傳或資料值無法安全解析）；不能據此判定不符合資格或 0 訂閱`);
    }
    if (snapshot.upstreamCoverage.status === "partial") {
      gaps.push(`另至少 ${snapshot.upstreamCoverage.minimumUnresolvedOfferMonths.toLocaleString("zh-TW")} 個 SKU 月份無法核對，offer 與月度缺列可能不重疊，實際缺口無法精確計算`);
      if (snapshot.upstreamCoverage.problemSkuRows.length > 0) {
        gaps.push(`其中 ${snapshot.upstreamCoverage.problemSkuRows.length.toLocaleString("zh-TW")} 個具同次 CURRENT_FBA 證據的精確問題 SKU 已單獨隔離；其他商品仍已完成，未改寫、補 0 或重複加總`);
      }
      if (snapshot.upstreamCoverage.unprovenExactSkuProblems.exactSkuCount > 0) {
        gaps.push(`另有 ${snapshot.upstreamCoverage.unprovenExactSkuProblems.exactSkuCount.toLocaleString("zh-TW")} 個精確上游問題 SKU 缺少同次 CURRENT_FBA 證據，因此只計數、不顯示 identifier`);
      }
    }
    return `${verifiedScope}；${gaps.join("；")}；不以部分資料冒充全站總額。`;
  }
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

export function SubscriptionUpstreamCoverageWarning({
  coverage,
}: {
  coverage: SubscriptionUpstreamCoverage;
}) {
  if (coverage.status === "complete") return null;
  const rejectedRows =
    coverage.returnedOfferRows - coverage.acceptedOfferRows +
    coverage.returnedMetricRows - coverage.acceptedMetricRows;
  return (
    <div className="variation-warning" role="status">
      <strong>{coverage.problemSkuRows.length > 0
        ? "問題 SKU（其他商品仍已完成）"
        : "Amazon 回應資料不完整"}</strong>
      <p>{coverage.notice}</p>
      <small>
        至少 {coverage.minimumUnresolvedOfferMonths.toLocaleString("zh-TW")} 個 SKU 月份無法核對，且實際缺口無法精確計算。已排除 {rejectedRows.toLocaleString("zh-TW")} 列；其中 {coverage.rejectedSellerSkuRows.toLocaleString("zh-TW")} 列缺少可原樣核對的 Seller SKU，{coverage.problemSkuRows.length.toLocaleString("zh-TW")} 個具同次 CURRENT_FBA 證據的精確問題 SKU 已逐項隔離。
        另有 {coverage.unprovenExactSkuProblems.exactSkuCount.toLocaleString("zh-TW")} 個精確上游問題 SKU 缺少同次 CURRENT_FBA 證據，只保留計數、不顯示 identifier。
        offer 可核對 {coverage.acceptedOfferRows.toLocaleString("zh-TW")}／{coverage.returnedOfferRows.toLocaleString("zh-TW")}，
        月度列可核對 {coverage.acceptedMetricRows.toLocaleString("zh-TW")}／{coverage.returnedMetricRows.toLocaleString("zh-TW")}。
        {coverage.problemSkuRows.length > 0 ? " 請用結果上方的「有問題」篩選查看可原樣核對的 SKU。" : ""}
      </small>
    </div>
  );
}

export function SubscriptionInventoryCoverageNotice({
  evidence,
}: {
  evidence: SubscriptionInventoryEvidence;
}) {
  const gap = evidence.unverifiedFbaSkuCount;
  const inventoryPartial = evidence.coverage === "partial";
  return (
    <div className="content-export-note" role={gap > 0 || inventoryPartial ? "status" : undefined}>
      <strong>{inventoryPartial
        ? "FBA Inventory 範圍不完整"
        : `同次 FBA Inventory 已證明 ${evidence.provenSkuCount.toLocaleString("zh-TW")} 個 SKU`}</strong>
      <p>
        {inventoryPartial
          ? `有 ${evidence.unrecognizedSellerSkuRows.toLocaleString("zh-TW")} 列 Seller SKU 無法原樣辨識，其他有效 SKU 已繼續核對。Amazon 共回傳 ${evidence.returnedInventoryRows.toLocaleString("zh-TW")} 列；以下只顯示可原樣辨識的範圍，不會顯示全站完整總額。 `
          : ""}
        Replenishment API 回傳可核對 offer {evidence.verifiableReplenishmentOfferCount.toLocaleString("zh-TW")} 個；
        {gap > 0
          ? `另有 ${gap.toLocaleString("zh-TW")} 個 FBA SKU 未取得可核對 offer（未回傳或資料值無法安全解析）。這不代表不符合資格，也不代表 0 訂閱。`
          : "所有已證明 FBA SKU 都有可核對的 offer。"}
      </p>
    </div>
  );
}

type SubscriptionChartPoint = {
  index: number;
  month: string;
  value: number;
  accessibleLabel: string;
  tooltip: string;
  partial?: boolean;
};

function SubscriptionHistoryPlot({
  intervals,
  points,
  accessibleLabel,
  emptyMessage,
}: {
  intervals: SubscriptionAuditSnapshot["intervals"];
  points: SubscriptionChartPoint[];
  accessibleLabel: string;
  emptyMessage: string;
}) {
  const width = 720;
  const height = 230;
  const inset = { top: 20, right: 18, bottom: 38, left: 52 };
  const maximum = Math.max(1, ...points.map(({ value }) => value));
  const x = (index: number) => inset.left + index * ((width - inset.left - inset.right) / Math.max(1, intervals.length - 1));
  const y = (value: number) => inset.top + (maximum - value) * ((height - inset.top - inset.bottom) / maximum);
  const segments: SubscriptionChartPoint[][] = [];
  for (const point of points) {
    const last = segments.at(-1);
    if (!last?.length || point.index !== last.at(-1)!.index + 1) segments.push([point]);
    else last.push(point);
  }
  return (
    <>
      {points.length ? (
        <div className="subscription-chart-scroll">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={accessibleLabel}>
            <line x1={inset.left} y1={height - inset.bottom} x2={width - inset.right} y2={height - inset.bottom} className="subscription-chart-axis" />
            <line x1={inset.left} y1={inset.top} x2={inset.left} y2={height - inset.bottom} className="subscription-chart-axis" />
            {segments.map((segment) => (
              <polyline
                key={`${segment[0].month}-${segment.at(-1)!.month}`}
                points={segment.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")}
                fill="none"
                className={`subscription-chart-line${segment.some((point) => point.partial) ? " partial" : ""}`}
              />
            ))}
            {points.map((point) => {
              const pointX = x(point.index);
              const pointY = y(point.value);
              const tooltipX = Math.min(width - 84, Math.max(84, pointX));
              const tooltipY = pointY < 48 ? pointY + 14 : pointY - 34;
              return (
                <g key={point.month} className="subscription-chart-hit" tabIndex={0} role="graphics-symbol" aria-label={point.accessibleLabel}>
                  <title>{point.tooltip}</title>
                  <circle cx={pointX} cy={pointY} r="5" className={`subscription-chart-point${point.partial ? " partial" : ""}`} />
                  <g className="subscription-chart-tooltip" aria-hidden="true">
                    <rect x={tooltipX - 78} y={tooltipY} width="156" height="25" rx="8" />
                    <text x={tooltipX} y={tooltipY + 16} textAnchor="middle">
                      {subscriptionAuditMonthLabel(point.month)} · {point.value.toLocaleString("zh-TW")}
                    </text>
                  </g>
                </g>
              );
            })}
            {intervals.map((interval, index) => (
              (index === 0 || index === intervals.length - 1 || index % Math.ceil(intervals.length / 6) === 0) && (
                <text key={interval.month} x={x(index)} y={height - 12} textAnchor="middle" className="subscription-chart-label">
                  {interval.month.slice(2)}
                </text>
              )
            ))}
            <text x={inset.left - 8} y={inset.top + 4} textAnchor="end" className="subscription-chart-label">{maximum.toLocaleString("zh-TW")}</text>
            <text x={inset.left - 8} y={height - inset.bottom + 4} textAnchor="end" className="subscription-chart-label">0</text>
          </svg>
        </div>
      ) : <p className="variation-empty">{emptyMessage}</p>}
    </>
  );
}

export function SubscriberHistoryChart({
  offer,
  snapshot,
  onClear,
}: {
  offer: SubscriptionAuditOffer;
  snapshot: SubscriptionAuditSnapshot;
  onClear?: () => void;
}) {
  const byMonth = new Map(offer.monthlySeries.map((point) => [point.month, point]));
  const points = snapshot.intervals.flatMap((interval, index): SubscriptionChartPoint[] => {
    const metric = byMonth.get(interval.month);
    const value = metric?.activeSubscriptionsAtPeriodEnd;
    if (!metric || value === null || value === undefined) return [];
    return [{
      index,
      month: interval.month,
      value,
      accessibleLabel: `${subscriptionAuditMonthLabel(interval.month)}月底有效訂閱 ${value}，S&S 營收 ${money(metric.subscriptionRevenue, metric.currencyCode)}`,
      tooltip: `${subscriptionAuditMonthLabel(interval.month)}\n月底有效訂閱：${value.toLocaleString("zh-TW")}\nS&S 營收：${money(metric.subscriptionRevenue, metric.currencyCode)}`,
    }];
  });
  return (
    <div className="subscription-history-chart" role="group" aria-label={`${offer.sellerSku} 月底有效訂閱折線圖`}>
      <div className="subscription-chart-heading">
        <div><strong>{offer.sellerSku}</strong><small>單品月底有效訂閱 · 缺月保持空白，不補 0</small></div>
        <div className="subscription-chart-actions">
          <span>目前快照 {offer.currentActiveSubscriptions.toLocaleString("zh-TW")}</span>
          {onClear && <button type="button" onClick={onClear}>取消單品，回全站</button>}
        </div>
      </div>
      <SubscriptionHistoryPlot
        intervals={snapshot.intervals}
        points={points}
        accessibleLabel={`${snapshot.requestedMonths} 個完整月的 ${offer.sellerSku} 有效訂閱歷史`}
        emptyMessage="Amazon 在所選完整月份沒有回傳此 SKU 的月底有效訂閱指標。"
      />
    </div>
  );
}

export function SubscriptionAggregateHistoryChart({
  snapshot,
}: {
  snapshot: SubscriptionAuditSnapshot;
}) {
  const history = aggregateSubscriptionAuditHistory(snapshot);
  const scopeComplete = history.every((point) => point.complete);
  const points = history.flatMap((point, index): SubscriptionChartPoint[] => {
    if (point.value === null) return [];
    const coverage = `${point.reportedOfferCount}／${point.expectedOfferCount} 個可核對 offer`;
    return [{
      index,
      month: point.month,
      value: point.value,
      accessibleLabel: point.complete
        ? `${subscriptionAuditMonthLabel(point.month)}全站月底有效訂閱 ${point.value}`
        : `${subscriptionAuditMonthLabel(point.month)}已核對月底有效訂閱 ${point.value}，涵蓋 ${coverage}，全站範圍不完整`,
      tooltip: `${subscriptionAuditMonthLabel(point.month)}\n${point.complete ? "全站" : "已核對"}月底有效訂閱：${point.value.toLocaleString("zh-TW")}\n涵蓋：${coverage}${point.complete ? "" : "\n全站範圍不完整"}`,
      partial: !point.complete,
    }];
  });
  return (
    <div className="subscription-history-chart subscription-global-history" role="group" aria-label="全站月底有效訂閱折線圖">
      <div className="subscription-chart-heading">
        <div>
          <strong>{scopeComplete ? "全站總月底有效訂閱" : "全站總月底有效訂閱（已核對部分）"}</strong>
          <small>開啟即顯示全站；滑鼠指向或鍵盤對焦可看當月數量。缺值保持空白，不補 0。</small>
        </div>
        <span>{scopeComplete ? "coverage 完整" : "虛線／空白代表 coverage 不完整"}</span>
      </div>
      <SubscriptionHistoryPlot
        intervals={snapshot.intervals}
        points={points}
        accessibleLabel={`${snapshot.requestedMonths} 個完整月的全站月底有效訂閱歷史`}
        emptyMessage="Amazon 在所選完整月份沒有回傳可核對的月底有效訂閱指標；空白不代表 0。"
      />
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
  const [filter, setFilter] = useState<SubscriptionAuditFilter>("all");
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
    setFilter("all");
    setError(null);
    setBusy(null);
  }, [marketplaceId]);

  const selectedOffer = useMemo(
    () => snapshot?.offers.find(({ sellerSku }) => sellerSku === selectedSku) ?? null,
    [selectedSku, snapshot],
  );
  const displayRows = useMemo(
    () => snapshot ? subscriptionAuditDisplayRows(snapshot) : [],
    [snapshot],
  );
  const filteredRows = useMemo(
    () => displayRows.filter((row) => subscriptionAuditRowMatchesFilter(row, filter)),
    [displayRows, filter],
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
      setSelectedSku(null);
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
      anchor.download = auditExportFilename({
        kind: "subscription",
        marketplaceShort,
        fetchedAt: snapshot.fetchedAt,
      });
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
          <SubscriptionInventoryCoverageNotice
            evidence={snapshot.inventoryEvidence}
          />
          <SubscriptionUpstreamCoverageWarning
            coverage={snapshot.upstreamCoverage}
          />
          <div className="subscription-audit-summary">
            <article><span>{snapshot.inventoryEvidence.coverage === "partial" ? "可原樣辨識 FBA SKU" : "同次已證明 FBA SKU"}</span><strong>{snapshot.inventoryEvidence.provenSkuCount.toLocaleString("zh-TW")}</strong></article>
            <article><span>可核對 S&S offer</span><strong>{snapshot.inventoryEvidence.verifiableReplenishmentOfferCount.toLocaleString("zh-TW")}</strong></article>
            <article><span>未取得可核對 offer</span><strong>{snapshot.inventoryEvidence.unverifiedFbaSkuCount.toLocaleString("zh-TW")}</strong></article>
            <article><span>可核對 offer 有效訂閱</span><strong>{snapshot.summary.currentActiveSubscriptions.toLocaleString("zh-TW")}</strong></article>
            {revenueSummary && (
              <article>
                <span>{revenueSummary.label}</span>
                <strong>{revenueSummary.value}</strong>
                <small>{revenueSummary.note}</small>
              </article>
            )}
          </div>
          <div className="subscription-audit-filters" role="group" aria-label="Seller 基礎折扣篩選">
            {SUBSCRIPTION_FILTERS.map((value) => {
              const count = displayRows.filter((row) =>
                subscriptionAuditRowMatchesFilter(row, value)).length;
              return (
                <button
                  key={String(value)}
                  type="button"
                  className={filter === value ? "active" : ""}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  <span>{subscriptionAuditFilterLabel(value)}</span>
                  <strong>{count.toLocaleString("zh-TW")}</strong>
                </button>
              );
            })}
          </div>
          {selectedOffer
            ? <SubscriberHistoryChart offer={selectedOffer} snapshot={snapshot} onClear={() => setSelectedSku(null)} />
            : <SubscriptionAggregateHistoryChart snapshot={snapshot} />}
          <button type="button" className="content-audit-export-primary" onClick={() => void exportExcel()} disabled={!snapshot.exportId || Boolean(busy)}>
            <span aria-hidden="true">↓</span>
            <strong>{busy === "export" ? "正在建立 Excel…" : `匯出 ${snapshot.requestedMonths} 個完整月／五張折扣表＋問題 SKU`}</strong>
            <small>五張折扣表只放標準折扣且沒有問題的逐月資料；問題 SKU 只在獨立工作表出現一次。缺值與 coverage 保持原樣，未知折扣不會冒充 0%。</small>
          </button>
          {!snapshot.exportId && <p className="variation-warning">本次快照尚未取得主程序匯出 ID；為避免用 renderer 畫面資料冒充 Amazon 原始結果，Excel 按鈕保持停用。</p>}
          <div className="subscription-offer-list" role="list" aria-label="FBA Subscribe & Save SKU">
            {filteredRows.map((row) => {
              const offer = row.offer;
              return (
                <button
                  key={row.sellerSku}
                  type="button"
                  role="listitem"
                  className={`subscription-offer-card${selectedOffer?.sellerSku === row.sellerSku ? " active" : ""}${row.problem ? " problem" : ""}`}
                  onClick={() => offer && setSelectedSku((current) =>
                    current === offer.sellerSku ? null : offer.sellerSku)}
                  disabled={!offer}
                  aria-label={offer ? `查看 ${row.sellerSku} 單品訂閱歷史` : `${row.sellerSku} offer 未完成`}
                >
                  <span><small>品號</small><strong>{row.sellerSku}</strong><small>{offer ? `${offer.asin} · ${offer.eligibility}` : "offer 已隔離，無法安全顯示 ASIN"}</small></span>
                  <span><small>折扣%</small><strong>{offer ? discount(offer.sellerFundedBaseDiscount) : "—"}</strong><small>{offer ? `Tiered ${discount(offer.sellerFundedTieredDiscount)}` : "未回傳可核對折扣"}</small></span>
                  <span><small>金額</small><strong>{offer ? money(offer.price.amount, offer.price.currencyCode) : "—"}</strong><small>Amazon offer 目前價格</small></span>
                  <span><small>目前有效訂閱數</small><strong>{offer ? offer.currentActiveSubscriptions.toLocaleString("zh-TW") : "—"}</strong><small>查詢當下快照</small></span>
                  {row.problem && <span className="subscription-offer-problem"><strong>有問題</strong><small>{row.problem}</small></span>}
                </button>
              );
            })}
            {!filteredRows.length && <p className="variation-empty">{displayRows.length ? "這個篩選目前沒有 SKU。" : "Amazon 沒有回傳可由目前 FBA 證據確認的 Subscribe & Save offer；無法據此判定不符合資格或 0 訂閱。"}</p>}
          </div>
          <p className="subscription-capability-notice">{snapshot.historyCapability.notice}</p>
        </>
      )}
    </section>
  );
}
