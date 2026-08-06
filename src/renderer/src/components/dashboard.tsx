"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdsDrawer from "./ads-drawer";
import ImageWorkspaceDrawer from "./image-workspace-drawer";
import PriceDrawer from "./price-drawer";
import PromotionCenterDrawer from "./promotion-center-drawer";
import ReplenishmentDrawer from "./replenishment-drawer";
import SalesTrendChart, {
  previousYearDateKey,
  salesTrendFailureMessage,
  type SalesTrendSnapshot,
  type TrendRangeSelection,
} from "./sales-trend-chart";
import SkuCommandCenter from "./sku-command-center";
import SkuOperationsDrawer, {
  type ContentWorkspaceTab,
} from "./sku-operations-drawer";
import type { ContentAuditCache } from "./content-audit-panel";
import SystemHealthControl from "./system-health-control";
import VariationPlannerDrawer from "./variation-planner-drawer";

type Marketplace = {
  id: string;
  flag: string;
  label: string;
  shortLabel: string;
  name: string;
  currency: string;
  region: "na" | "eu" | "fe";
};

type DashboardProps = {
  initialSalesTrend: SalesTrendSnapshot | null;
  initialMarketplaceId: string;
  viewerName?: string | null;
  initialError?: string | null;
};

type Tool = "ads" | "restock" | "copy" | "images" | "variations" | "price" | "promotion";
type AutomationLevel = "automatic" | "one_click" | "manual";

export const DEFAULT_MARKETPLACE_ID = "ATVPDKIKX0DER";

const MARKETPLACE_OPTIONS: Marketplace[] = [
  { id: DEFAULT_MARKETPLACE_ID, label: "美國站", flag: "US", shortLabel: "US", name: "Amazon.com", currency: "USD", region: "na" },
  { id: "A1VC38T7YXB528", label: "日本站", flag: "JP", shortLabel: "JP", name: "Amazon.co.jp", currency: "JPY", region: "fe" },
  { id: "A2EUQ1WTGCTBG2", label: "加拿大站", flag: "CA", shortLabel: "CA", name: "Amazon.ca", currency: "CAD", region: "na" },
  { id: "A19VAU5U5O7RUS", label: "新加坡站", flag: "SG", shortLabel: "SG", name: "Amazon.sg", currency: "SGD", region: "fe" },
  { id: "A39IBJ37TRP1C6", label: "澳洲站", flag: "AU", shortLabel: "AU", name: "Amazon.com.au", currency: "AUD", region: "fe" },
  { id: "A1F83G8C2ARO7P", label: "英國站", flag: "UK", shortLabel: "UK", name: "Amazon.co.uk", currency: "GBP", region: "eu" },
  { id: "A1PA6795UKMFR9", label: "德國站", flag: "DE", shortLabel: "DE", name: "Amazon.de", currency: "EUR", region: "eu" },
];

const MARKETPLACES = new Map(
  MARKETPLACE_OPTIONS.map((marketplace) => [marketplace.id, marketplace]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function calendarDayCount(startDate: string, endDate: string): number {
  return (
    Math.round(
      (new Date(`${endDate}T00:00:00.000Z`).getTime() -
        new Date(`${startDate}T00:00:00.000Z`).getTime()) /
        86_400_000,
    ) + 1
  );
}

function isTrendRange(value: unknown): value is SalesTrendSnapshot["range"] {
  if (!isRecord(value)) return false;
  if (!isDateKey(value.startDate) || !isDateKey(value.endDate)) return false;
  const dayCount = calendarDayCount(value.startDate, value.endDate);
  const presetDays = value.presetDays;
  if (
    typeof value.dayCount !== "number" ||
    !Number.isInteger(value.dayCount) ||
    value.startDate > value.endDate
  ) {
    return false;
  }
  return (
    value.dayCount >= 1 &&
    value.dayCount <= 90 &&
    value.dayCount === dayCount &&
    (presetDays === null ||
      (typeof presetDays === "number" &&
        [7, 14, 30, 90].includes(presetDays) &&
        presetDays === value.dayCount))
  );
}

function isMoney(
  value: unknown,
): value is SalesTrendSnapshot["totals"]["totalSales"] {
  return (
    isRecord(value) &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    value.amount >= 0 &&
    typeof value.currencyCode === "string" &&
    /^[A-Z]{3}$/.test(value.currencyCode)
  );
}

function isTotals(value: unknown): value is SalesTrendSnapshot["totals"] {
  return (
    isRecord(value) &&
    isMoney(value.totalSales) &&
    [value.unitCount, value.orderItemCount, value.orderCount].every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    )
  );
}

function isPoint(
  value: unknown,
): value is SalesTrendSnapshot["points"][number] {
  return (
    isRecord(value) &&
    isDateKey(value.date) &&
    typeof value.interval === "string" &&
    isMoney(value.totalSales) &&
    [value.unitCount, value.orderItemCount, value.orderCount].every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) &&
    typeof value.partial === "boolean"
  );
}

function pointsMatchRange(
  points: unknown,
  range: SalesTrendSnapshot["range"],
): points is SalesTrendSnapshot["points"] {
  if (!Array.isArray(points)) return false;
  if (points.length !== range.dayCount) return false;
  const start = new Date(`${range.startDate}T00:00:00.000Z`);
  return points.every((point, index) => {
    const expected = new Date(start);
    expected.setUTCDate(expected.getUTCDate() + index);
    return isPoint(point) && point.date === expected.toISOString().slice(0, 10);
  });
}

function comparisonPointsMatchCurrent(
  comparisonPoints: unknown,
  currentPoints: SalesTrendSnapshot["points"],
): comparisonPoints is SalesTrendSnapshot["points"] {
  if (!Array.isArray(comparisonPoints)) return false;
  const expectedDates = currentPoints
    .map((point) => previousYearDateKey(point.date))
    .filter((date): date is string => date !== null);
  return (
    comparisonPoints.length === expectedDates.length &&
    comparisonPoints.every(
      (point, index) => isPoint(point) && point.date === expectedDates[index],
    )
  );
}

function comparisonRangeMatchesPoints(
  range: unknown,
  points: SalesTrendSnapshot["points"],
): range is SalesTrendSnapshot["range"] {
  if (
    !isRecord(range) ||
    !isDateKey(range.startDate) ||
    !isDateKey(range.endDate) ||
    range.startDate > range.endDate ||
    range.presetDays !== null ||
    typeof range.dayCount !== "number" ||
    !Number.isSafeInteger(range.dayCount) ||
    range.dayCount < 0 ||
    range.dayCount > 90 ||
    range.dayCount !== points.length
  ) {
    return false;
  }
  if (!points.length) return true;
  return (
    range.startDate === points[0].date &&
    range.endDate === points.at(-1)!.date
  );
}

function totalsMatchPoints(
  totals: unknown,
  points: SalesTrendSnapshot["points"],
  currencyCode: string,
): boolean {
  if (!isTotals(totals) || totals.totalSales.currencyCode !== currencyCode) {
    return false;
  }
  if (points.some((point) => point.totalSales.currencyCode !== currencyCode)) {
    return false;
  }
  const expected = points.reduce(
    (result, point) => ({
      amount: result.amount + point.totalSales.amount,
      unitCount: result.unitCount + point.unitCount,
      orderItemCount: result.orderItemCount + point.orderItemCount,
      orderCount: result.orderCount + point.orderCount,
    }),
    { amount: 0, unitCount: 0, orderItemCount: 0, orderCount: 0 },
  );
  const precision = currencyCode === "JPY" ? 0 : 2;
  return (
    totals.totalSales.amount === Number(expected.amount.toFixed(precision)) &&
    totals.unitCount === expected.unitCount &&
    totals.orderItemCount === expected.orderItemCount &&
    totals.orderCount === expected.orderCount
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function rangeMatchesSelection(
  range: SalesTrendSnapshot["range"],
  selection: TrendRangeSelection,
): boolean {
  return selection.kind === "preset"
    ? range.presetDays === selection.days && range.dayCount === selection.days
    : range.presetDays === null &&
        range.startDate === selection.startDate &&
        range.endDate === selection.endDate;
}

export function isSalesTrendSnapshotForSelection(
  value: unknown,
  marketplaceId: string,
  selection: TrendRangeSelection,
): value is SalesTrendSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 2) return false;
  const marketplace = MARKETPLACES.get(marketplaceId);
  if (!marketplace) return false;
  if (
    value.marketplaceId !== marketplaceId ||
    (value.mode !== "live" && value.mode !== "demo") ||
    typeof value.timeZone !== "string" ||
    !value.timeZone ||
    typeof value.days !== "number" ||
    !Number.isSafeInteger(value.days) ||
    !isTrendRange(value.range) ||
    value.days !== value.range.dayCount ||
    !rangeMatchesSelection(value.range, selection) ||
    !pointsMatchRange(value.points, value.range) ||
    !totalsMatchPoints(value.totals, value.points, marketplace.currency) ||
    !isRecord(value.comparison) ||
    value.comparison.kind !== "previous-year" ||
    !comparisonPointsMatchCurrent(value.comparison.points, value.points) ||
    !comparisonRangeMatchesPoints(
      value.comparison.range,
      value.comparison.points,
    ) ||
    !totalsMatchPoints(
      value.comparison.totals,
      value.comparison.points,
      marketplace.currency,
    ) ||
    typeof value.fetchedAt !== "string" ||
    Number.isNaN(Date.parse(value.fetchedAt)) ||
    !isNullableString(value.requestId) ||
    !isNullableString(value.rateLimit) ||
    !isNullableString(value.comparison.requestId) ||
    !isNullableString(value.comparison.rateLimit) ||
    typeof value.notice !== "string"
  ) {
    return false;
  }
  return true;
}

export function salesTrendQuery(
  marketplaceId: string,
  selection: TrendRangeSelection,
): URLSearchParams {
  const params = new URLSearchParams({ marketplaceId });
  if (selection.kind === "preset") {
    params.set("days", String(selection.days));
  } else {
    params.set("startDate", selection.startDate);
    params.set("endDate", selection.endDate);
  }
  params.set("comparison", "previous-year");
  return params;
}

function salesTrendRequestKey(
  marketplaceId: string,
  selection: TrendRangeSelection,
): string {
  return selection.kind === "preset"
    ? `${marketplaceId}:preset:${selection.days}`
    : `${marketplaceId}:custom:${selection.startDate}:${selection.endDate}`;
}

const TOOL_META: Record<Tool, { label: string; symbol: string; group: string }> = {
  ads: { label: "廣告", symbol: "◎", group: "planning" },
  restock: { label: "補貨", symbol: "↗", group: "planning" },
  copy: { label: "文案", symbol: "Aa", group: "product" },
  images: { label: "圖片", symbol: "▧", group: "product" },
  variations: { label: "變體規劃", symbol: "◇", group: "product" },
  price: { label: "定價", symbol: "$", group: "pricing" },
  promotion: { label: "促銷", symbol: "%", group: "pricing" },
};

const TOOL_SECTIONS: ReadonlyArray<{
  label: string;
  group: "planning" | "product" | "pricing";
  tools: readonly Tool[];
}> = [
  { label: "策劃", group: "planning", tools: ["ads", "restock"] },
  { label: "產品", group: "product", tools: ["copy", "images", "variations"] },
  { label: "價格", group: "pricing", tools: ["price", "promotion"] },
];

const TOOL_CAPABILITIES: Record<
  Tool,
  Array<{ level: AutomationLevel; label: string }>
> = {
  ads: [
    { level: "automatic", label: "授權自動檢查" },
    { level: "manual", label: "廣告啟用人工" },
  ],
  restock: [
    { level: "automatic", label: "自動算補貨" },
    { level: "manual", label: "實體入庫人工" },
  ],
  copy: [
    { level: "automatic", label: "欄位自動防呆" },
    { level: "one_click", label: "安全一鍵更新" },
    { level: "manual", label: "內容人工決定" },
  ],
  images: [
    { level: "automatic", label: "檔案自動檢查" },
    { level: "one_click", label: "安全一鍵送出" },
    { level: "manual", label: "選圖排序人工" },
  ],
  variations: [
    { level: "automatic", label: "Family 自動讀取" },
    { level: "manual", label: "唯讀人工規劃" },
  ],
  price: [
    { level: "automatic", label: "價差自動驗證" },
    { level: "one_click", label: "安全一鍵調價" },
    { level: "manual", label: "訂閱設定人工" },
  ],
  promotion: [
    { level: "one_click", label: "限時售價一鍵" },
    { level: "manual", label: "Coupon 人工" },
  ],
};

function ToolCapabilities({ tool }: { tool: Tool }) {
  return (
    <small className="tool-capabilities">
      {TOOL_CAPABILITIES[tool].map((item) => (
        <b key={`${item.level}-${item.label}`} className={`automation-badge ${item.level}`}>
          {item.label}
        </b>
      ))}
    </small>
  );
}

function formatDateTime(value: string | null, compact = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  // Taiwan has no daylight-saving time. Formatting from UTC parts keeps the
  // server-rendered text byte-for-byte identical during browser hydration.
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1_000);
  const pad = (part: number) => String(part).padStart(2, "0");
  const monthDay = `${pad(taipei.getUTCMonth() + 1)}/${pad(taipei.getUTCDate())}`;
  const time = `${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}`;
  return compact
    ? `${monthDay} ${time}`
    : `${taipei.getUTCFullYear()}/${monthDay} ${time}`;
}

export default function Dashboard({
  initialSalesTrend,
  initialMarketplaceId,
  viewerName,
  initialError = null,
}: DashboardProps) {
  const startingMarketplaceId = MARKETPLACES.has(initialMarketplaceId)
    ? initialMarketplaceId
    : DEFAULT_MARKETPLACE_ID;
  const startingSelection: TrendRangeSelection = initialSalesTrend?.range.presetDays
    ? { kind: "preset", days: initialSalesTrend.range.presetDays }
    : initialSalesTrend
      ? {
          kind: "custom",
          startDate: initialSalesTrend.range.startDate,
          endDate: initialSalesTrend.range.endDate,
        }
      : { kind: "preset", days: 7 };
  const [marketplaceId, setMarketplaceId] = useState(startingMarketplaceId);
  const [globalSku, setGlobalSku] = useState("");
  const [trendSelection, setTrendSelection] =
    useState<TrendRangeSelection>(startingSelection);
  const [openTool, setOpenTool] = useState<Tool | null>(null);
  const [contentWorkspaceTab, setContentWorkspaceTab] =
    useState<ContentWorkspaceTab>("single");
  const [contentAuditCache, setContentAuditCache] = useState<
    Record<string, ContentAuditCache>
  >({});
  const [commandOpen, setCommandOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [salesTrend, setSalesTrend] =
    useState<SalesTrendSnapshot | null>(initialSalesTrend);
  const [salesTrendLoading, setSalesTrendLoading] = useState(false);
  const [salesTrendError, setSalesTrendError] = useState<string | null>(initialError);
  const salesTrendAbortRef = useRef<AbortController | null>(null);
  const lastAutomaticRequestKey = useRef(
    salesTrendRequestKey(startingMarketplaceId, startingSelection),
  );

  const loadSalesTrend = useCallback(async () => {
    salesTrendAbortRef.current?.abort();
    const controller = new AbortController();
    salesTrendAbortRef.current = controller;
    setSalesTrendLoading(true);
    setSalesTrendError(null);
    setSalesTrend((current) =>
      current?.marketplaceId === marketplaceId &&
      rangeMatchesSelection(current.range, trendSelection)
        ? current
        : null,
    );
    const params = salesTrendQuery(marketplaceId, trendSelection);
    try {
      const response = await fetch(`/api/sp-api/sales-trend?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const problem = payload as {
          code?: string;
          message?: string;
          requestId?: string | null;
        };
        const message = salesTrendFailureMessage(response.status, problem);
        throw new Error(
          `${message}${problem.requestId ? `（Request ID: ${problem.requestId}）` : ""}`,
        );
      }
      if (
        !isSalesTrendSnapshotForSelection(
          payload,
          marketplaceId,
          trendSelection,
        )
      ) {
        throw new Error(
          "這台 Mac App Bridge 尚未支援新版銷售趨勢，請安裝新版後再同步。",
        );
      }
      if (salesTrendAbortRef.current === controller) setSalesTrend(payload);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      if (salesTrendAbortRef.current === controller) {
        setSalesTrend(null);
        setSalesTrendError(
          requestError instanceof Error
            ? requestError.message
            : "目前無法載入 FBA 銷售趨勢。",
        );
      }
    } finally {
      if (salesTrendAbortRef.current === controller) setSalesTrendLoading(false);
    }
  }, [marketplaceId, trendSelection]);

  useEffect(
    () => () => {
      salesTrendAbortRef.current?.abort();
      salesTrendAbortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const requestKey = salesTrendRequestKey(marketplaceId, trendSelection);
    if (lastAutomaticRequestKey.current === requestKey) return;
    lastAutomaticRequestKey.current = requestKey;
    void loadSalesTrend();
    return () => salesTrendAbortRef.current?.abort();
  }, [loadSalesTrend, marketplaceId, trendSelection]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem("fba-os-auto-sync");
        if (stored === "off") setAutoSync(false);
      } catch {
        // Device-local preference is optional.
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!autoSync) return;
    const interval = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !openTool &&
        !commandOpen &&
        !salesTrendLoading
      ) {
        void loadSalesTrend();
      }
    }, 5 * 60 * 1_000);
    return () => window.clearInterval(interval);
  }, [autoSync, commandOpen, loadSalesTrend, openTool, salesTrendLoading]);

  const launch = (tool: Tool) => {
    setCommandOpen(false);
    if (tool === "copy") setContentWorkspaceTab("single");
    setOpenTool(tool);
  };

  const launchContentAudit = () => {
    setCommandOpen(false);
    setContentWorkspaceTab("audit");
    setOpenTool("copy");
  };

  const cacheContentAudit = useCallback((cache: ContentAuditCache) => {
    setContentAuditCache((current) => ({
      ...current,
      [cache.snapshot.marketplaceId]: cache,
    }));
  }, []);

  const setAutoSyncPreference = (enabled: boolean) => {
    setAutoSync(enabled);
    try {
      window.localStorage.setItem("fba-os-auto-sync", enabled ? "on" : "off");
    } catch {
      // Device-local preference is optional.
    }
  };

  const resolveGlobalContext = (nextMarketplaceId: string, sellerSku: string) => {
    if (MARKETPLACE_OPTIONS.some((item) => item.id === nextMarketplaceId)) {
      setMarketplaceId(nextMarketplaceId);
    }
    setGlobalSku(sellerSku);
  };

  const marketplace = MARKETPLACES.get(marketplaceId) ?? MARKETPLACE_OPTIONS[0];
  const matchingSalesTrend =
    salesTrend?.marketplaceId === marketplaceId &&
    rangeMatchesSelection(salesTrend.range, trendSelection)
      ? salesTrend
      : null;
  const visibleSalesTrend = salesTrendError ? null : matchingSalesTrend;
  const mode = visibleSalesTrend?.mode ?? null;
  const currentContentAudit = contentAuditCache[marketplaceId] ?? null;
  const currentAuditAttentionCount = currentContentAudit
    ? currentContentAudit.snapshot.rows.filter(
        (row) => row.readStatus === "incomplete" || row.issues.length > 0,
      ).length
    : 0;

  const changeMarketplace = (nextMarketplaceId: string) => {
    if (!MARKETPLACES.has(nextMarketplaceId) || salesTrendLoading) return;
    setSalesTrend(null);
    setSalesTrendError(null);
    setMarketplaceId(nextMarketplaceId);
  };

  const changeTrendSelection = (selection: TrendRangeSelection) => {
    if (salesTrendLoading) return;
    setSalesTrend(null);
    setSalesTrendError(null);
    setTrendSelection(selection);
  };

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="commerce-os">
      <a className="workspace-skip-link" href="#workspace-top">跳到主要內容</a>

      <div className="workspace-surface">
        <header className="workspace-header">
          <div className="workspace-header-main">
            <a className="os-brand" href="#workspace-top" onClick={(event) => { event.preventDefault(); scrollTo("workspace-top"); }} aria-label="AMZ.API 首頁">
              <span className="os-brand-mark">A</span>
              <span className="os-brand-copy"><strong>AMZ.API</strong><small>FBA workspace</small></span>
            </a>

            <nav className="workspace-primary-nav" aria-label="主要功能">
              {TOOL_SECTIONS.map((section) => (
                <div className="workspace-primary-group" role="group" aria-label={section.label} key={section.group}>
                  {section.tools.map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      className={openTool === tool ? "active" : ""}
                      aria-haspopup="dialog"
                      aria-pressed={openTool === tool}
                      onClick={() => launch(tool)}
                    >
                      <span aria-hidden="true">{TOOL_META[tool].symbol}</span>
                      {TOOL_META[tool].label}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <div className="workspace-header-status">
              <span className={`mode-badge workspace-connection-status ${mode ?? "unavailable"}`} aria-live="polite">
                <i />
                <span><strong>{mode === "live" ? "Amazon 已連線" : mode === "demo" ? "展示資料" : "尚未同步"}</strong><small>{mode === "live" ? "Live" : mode === "demo" ? "Demo" : "未連線"}</small></span>
              </span>
              <span className="workspace-avatar" role="img" aria-label={`${viewerName ?? "Jasper"} 的私人工作區`}>{(viewerName?.trim()?.[0] ?? "J").toUpperCase()}</span>
            </div>
          </div>

          <div className="workspace-context-shell">
            <div className="workspace-contextbar">
              <label className="global-sku"><span aria-hidden="true">⌕</span><input value={globalSku} onChange={(event) => setGlobalSku(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setCommandOpen(true); } }} placeholder="輸入 SKU，所有工具共用" aria-label="全域 Seller SKU" /></label>
              <button className="command-topbar-button" type="button" onClick={() => setCommandOpen(true)}><span aria-hidden="true">✦</span>SKU 總覽</button>
              <label className="global-marketplace"><select value={marketplaceId} onChange={(event) => changeMarketplace(event.target.value)} disabled={salesTrendLoading} aria-label="Amazon 站點">{MARKETPLACE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.flag} · {item.label}</option>)}</select></label>
              <SystemHealthControl marketplaceId={marketplaceId} />
            </div>
          </div>
        </header>

        <main id="workspace-top" className="workspace-content" tabIndex={-1}>
          <section className="os-hero">
            <div><p className="eyebrow">FBA OPERATING SYSTEM</p><h1>{viewerName ? `${viewerName.split(" ")[0]}，` : ""}今天想從哪裡開始？</h1><p>從上方選一個功能；站點與 SKU 會一路跟著你，畫面只留下當下真正需要的資訊。</p></div>
            <div className="hero-sync"><span>銷售趨勢最後同步</span><strong>{formatDateTime(visibleSalesTrend?.fetchedAt ?? null)}</strong><small>{marketplace.name}</small></div>
          </section>

          <section className="automation-overview" aria-label="自動化分級">
            <div className="automation-overview-copy"><span className="automation-spark">✦</span><div><strong>能自動的，系統自己完成</strong><p>只有需要你做決策、外部授權或實體確認時才會停下來。</p></div></div>
            <div className="automation-legend" aria-label="顏色說明">
              <span className="automation-badge automatic"><i />自動</span>
              <span className="automation-badge one_click"><i />一鍵</span>
              <span className="automation-badge manual"><i />需人工</span>
            </div>
            <label className="auto-sync-switch">
              <input type="checkbox" checked={autoSync} onChange={(event) => setAutoSyncPreference(event.target.checked)} />
              <span aria-hidden="true" />
              <div><strong>銷售趨勢自動同步</strong><small>{autoSync ? "每 5 分鐘 · 已開啟" : "已暫停"}</small></div>
            </label>
          </section>

          <section className="command-strip" aria-label="SKU 指揮中心">
            <span className="command-strip-orb">✦</span>
            <div><p className="eyebrow">SKU COMMAND CENTER</p><strong>不用再到每一區重複查 SKU</strong><small>一次整合商品主檔、FBA 庫存、補貨、文案、圖片、價格、促銷與訂閱。</small></div>
            <div className="command-strip-levels"><span className="automation-badge automatic">自動掃描</span><span className="automation-badge one_click">一鍵處理</span><span className="automation-badge manual">只留下人工判斷</span></div>
            <button type="button" onClick={() => setCommandOpen(true)}>{globalSku.trim() ? `掃描 ${globalSku.trim()}` : "開啟 SKU 總覽"}<i>›</i></button>
          </section>

          <section className="content-audit-home-card" aria-label="全站內容健檢捷徑">
            <span className="content-audit-home-icon" aria-hidden="true">Aa✓</span>
            <div>
              <p className="eyebrow">FBA CONTENT HEALTH</p>
              <h2>全站內容健檢</h2>
              <p>一次找出全部 FBA SKU 的疑似錯字、賣點不足與缺成分；結果在這次 App 使用期間會保留。</p>
            </div>
            {currentContentAudit && (
              <span className="content-audit-home-status">
                <strong>{currentAuditAttentionCount.toLocaleString()}</strong>
                <small>個待確認項目</small>
              </span>
            )}
            <button type="button" onClick={launchContentAudit}>
              {currentContentAudit ? "繼續上次健檢" : "開始全站健檢"}
              <i aria-hidden="true">›</i>
            </button>
          </section>

          {mode === "demo" && <section className="os-notice"><span>D</span><div><strong>目前使用展示資料</strong><p>{visibleSalesTrend?.notice || "在 Mac 安全連線加入 LWA 憑證後即可切換真實 Amazon 資料。"}</p></div><a href="#connection" onClick={(event) => { event.preventDefault(); scrollTo("connection"); }}>串接說明</a></section>}

          <div className="core-zones">
            <section id="planning-zone" className="core-zone planning-zone">
              <div className="zone-heading"><div><span>01</span><p className="eyebrow">PLANNING</p><h2>策劃區</h2></div><p>先決定資源往哪裡走。</p></div>
              <div className="zone-tools">
                <button className="tool-tile" type="button" onClick={() => launch("ads")}><span className="tool-symbol ads">◎</span><div><h3>廣告</h3><p>SP 留在 Helium 10；SB、SD 自動檢查設定，素材、預算與正式啟用由你確認。</p><ToolCapabilities tool="ads" /></div><i>›</i></button>
                <button className="tool-tile" type="button" onClick={() => launch("restock")}><span className="tool-symbol restock">↗</span><div><h3>補貨</h3><p>有全域 SKU 時開啟即算 FBA 可售、在途、銷速、補貨量與缺貨日。</p><ToolCapabilities tool="restock" /></div><i>›</i></button>
              </div>
            </section>

            <section id="product-zone" className="core-zone product-zone">
              <div className="zone-heading"><div><span>02</span><p className="eyebrow">PRODUCT</p><h2>產品區</h2></div><p>讓商品內容簡單而可控。</p></div>
              <div className="zone-tools">
                <button className="tool-tile" type="button" onClick={() => launch("copy")}><span className="tool-symbol copy">Aa</span><div><h3>文案</h3><p>自動載入 SKU、檢查 PTD 與字數；你只決定內容，再安全更新或一鍵匯出 Excel。</p><ToolCapabilities tool="copy" /></div><i>›</i></button>
                <button className="tool-tile" type="button" onClick={() => launch("images")}><span className="tool-symbol images">▧</span><div><h3>圖片</h3><p>拖拉、排序與選主圖由你決定；格式、像素、公開來源與 Amazon 預檢自動完成。</p><ToolCapabilities tool="images" /></div><i>›</i></button>
                <button className="tool-tile" type="button" onClick={() => launch("variations")}><span className="tool-symbol variations">◇</span><div><h3>變體規劃</h3><p>唯讀整理 parent、FBA children、theme 與維度；拖拉只產生改掛規劃，不會寫入 Amazon。</p><ToolCapabilities tool="variations" /></div><i>›</i></button>
              </div>
            </section>

            <section id="pricing-zone" className="core-zone pricing-zone">
              <div className="zone-heading"><div><span>03</span><p className="eyebrow">PRICING</p><h2>價格區</h2></div><p>價格、訂閱與促銷放在一起。</p></div>
              <div className="zone-tools">
                <button className="tool-tile" type="button" onClick={() => launch("price")}><span className="tool-symbol price">$</span><div><h3>定價與訂閱</h3><p>自動查現價、S&amp;S、上下限與價差；一般調價一鍵處理，大幅變動才要求再確認。</p><ToolCapabilities tool="price" /></div><i>›</i></button>
                <button className="tool-tile" type="button" onClick={() => launch("promotion")}><span className="tool-symbol promotion">%</span><div><h3>Sale Price 與 Coupon</h3><p>Sale Price 對應單一 SKU 的限時售價，不是廣告選單的價格折扣或管理促銷；Coupon 仍在 Amazon 官方頁完成。</p><ToolCapabilities tool="promotion" /></div><i>›</i></button>
              </div>
            </section>
          </div>

          <section className="operations-pulse">
            <div className="pulse-heading"><div><p className="eyebrow">OPERATIONS PULSE</p><h2>近期營運</h2><p>用完整 FBA 銷售趨勢掌握近期變化，並與去年同期直接比較。</p></div><button type="button" className="pulse-refresh" onClick={() => void loadSalesTrend()} disabled={salesTrendLoading}><span className={salesTrendLoading ? "spin" : ""}>↻</span>{salesTrendLoading ? "同步中" : "同步"}</button></div>
            <SalesTrendChart snapshot={visibleSalesTrend} selection={trendSelection} loading={salesTrendLoading} error={salesTrendError} onSelectionChange={changeTrendSelection} onRetry={() => void loadSalesTrend()} />
          </section>

          <details id="connection" className="connection-details">
            <summary><span><strong>Amazon API 串接與能力邊界</strong><small>SP-API、Ads API、圖片公開來源與安全設定</small></span><i>＋</i></summary>
            <div className="connection-grid"><article><span>1</span><div><strong>SP-API Private Seller App</strong><p>加入 Orders、Product Listing、Amazon Fulfillment 角色，並為各區域 self-authorize。</p></div></article><article><span>2</span><div><strong>Mac Keychain Secrets</strong><p>LWA client、refresh token 與 Seller ID 只以加密密文保存在這台 Mac。</p></div></article><article><span>3</span><div><strong>圖片公開來源</strong><p>拖拉檔案先在 Mac 驗證；要一鍵送圖可連自己的 R2 公開 HTTPS 網域。</p></div></article><article><span>4</span><div><strong>Amazon Ads 獨立授權</strong><p>Ads 必須另外申請 Direct Advertiser、建立 LWA client 與每站 Profile ID，不能沿用 SP-API。</p></div></article></div>
          </details>
        </main>
        <footer className="os-footer"><span>AMZ.API · GitHub UI / Local Key</span><span>FBA only · No FBM · No buyer PII</span></footer>
      </div>

      {openTool === "ads" && <AdsDrawer initialMarketplaceId={marketplaceId} onClose={() => setOpenTool(null)} />}
      {openTool === "restock" && <ReplenishmentDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "copy" && <SkuOperationsDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} initialTab={contentWorkspaceTab} auditCacheByMarketplace={contentAuditCache} onAuditCacheChange={cacheContentAudit} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "images" && <ImageWorkspaceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "variations" && <VariationPlannerDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "price" && <PriceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "promotion" && <PromotionCenterDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {commandOpen && <SkuCommandCenter initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onLaunch={(tool) => launch(tool)} onClose={() => setCommandOpen(false)} />}
    </div>
  );
}
