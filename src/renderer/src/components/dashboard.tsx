"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_MARKETPLACE_ID,
  MARKETPLACES as MARKETPLACE_OPTIONS,
  marketplaceById,
} from "../../../shared/marketplaces";
import {
  AUDIT_SUITE_SECTION_COUNT,
  AUDIT_SUITE_SECTION_LABELS,
} from "../../../shared/audit-suite";
import { AccountingCenterDrawer } from "./accounting-center-panel";
import AdsDrawer from "./ads-drawer";
import AgedInventoryPanel from "./aged-inventory-panel";
import AuditSuiteHomeCard from "./audit-suite-home-card";
import AplusAuditDrawer from "./a-plus-audit-drawer";
import {
  observeAplusAuditJob,
  type AplusAuditObservableJob,
} from "./a-plus-audit-panel";
import BrandSalesCard from "./brand-sales-card";
import BrandGlyph from "./brand-glyph";
import ImageWorkspaceDrawer, {
  type ImageWorkspaceTab,
} from "./image-workspace-drawer";
import type { ImageAuditCache } from "./image-audit-panel";
import InboundShipmentsDrawer from "./inbound-shipments-drawer";
import PriceDrawer from "./price-drawer";
import PromotionCenterDrawer from "./promotion-center-drawer";
import ReplenishmentDrawer from "./replenishment-drawer";
import ReportLibraryPanel from "./report-library-panel";
import ReviewAuditPanel, {
  type ReviewAuditCache,
} from "./review-audit-panel";
import SalesTrendChart, {
  MAX_CUSTOM_SALES_TREND_DAYS,
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
import BusinessPricingAuditDrawer from "./business-pricing-audit-drawer";
import SystemHealthControl, {
  type AuditPreference,
} from "./system-health-control";
import SubscriptionAuditDrawer from "./subscription-audit-drawer";
import UnboundVariationAuditPanel, {
  type UnboundVariationAuditCache,
} from "./unbound-variation-audit-panel";
import VariationPlannerDrawer from "./variation-planner-drawer";
import { isSubscriptionAuditMarketplaceSupported } from "../subscription-audit";
import type { BusinessPricingAuditSnapshot } from "../business-pricing-audit";
import type { AplusAuditSnapshot } from "../a-plus-audit";
import {
  pollExistingReviewAuditJob,
  reviewAuditHomeProgress,
} from "../review-audit";
import {
  inboundShipmentCacheKey,
  inboundShipmentFailureMessage,
  pollInboundShipmentJob,
  replaceInboundShipmentCacheForMarketplace,
  type InboundShipmentCache,
} from "../inbound-shipments";
import {
  mergeAuditJobObservation,
  observeStandaloneAuditJob,
  standaloneAuditHomeProgress,
  standaloneAuditSnapshotMatchesJob,
  type StandaloneAuditJob,
  type StandaloneAuditKind,
} from "../standalone-audit";

export { standaloneAuditSnapshotMatchesJob };

export type DashboardReportMenuEntry = {
  id: string;
  label: string;
  detail: string;
  symbol?: string;
  disabled?: boolean;
  onSelect?: () => void;
};

type DashboardProps = {
  initialSalesTrend: SalesTrendSnapshot | null;
  initialMarketplaceId: string;
  viewerName?: string | null;
  initialError?: string | null;
  onOpenConnection?: () => void;
  additionalAuditCards?: ReactNode;
  performanceCompanion?: ReactNode;
  reportMenuEntries?: readonly DashboardReportMenuEntry[];
};

type Tool =
  | "ads"
  | "inbound"
  | "restock"
  | "copy"
  | "images"
  | "a-plus"
  | "variations"
  | "price"
  | "promotion"
  | "subscriptions"
  | "business-pricing"
  | "accounting";
type ToolGroup = "product" | "pricing" | "operations";
type NavigationGroup = ToolGroup | "reports";

export { DEFAULT_MARKETPLACE_ID };

export type DashboardConnectionEvidence =
  | "verified-live"
  | "configured-live"
  | "demo";

export function connectionEvidenceFromHealth(
  current: DashboardConnectionEvidence | null,
  mode: "live" | "demo",
): DashboardConnectionEvidence {
  if (mode === "demo") return "demo";
  return current === "verified-live" ? current : "configured-live";
}

export function connectionEvidenceFromSales(
  mode: "live" | "demo",
): DashboardConnectionEvidence {
  return mode === "live" ? "verified-live" : "demo";
}

export function businessPricingAttentionCount(
  summary: BusinessPricingAuditSnapshot["summary"] | null,
): number {
  return summary
    ? summary.aboveStandard + summary.missing + summary.unsupported + summary.incomplete
    : 0;
}

export function standaloneAuditDashboardKey(
  marketplaceId: string,
  kind: StandaloneAuditKind,
): string {
  return `${marketplaceId}\u0000${kind}`;
}

export function dashboardConnectionBadgeCopy(
  evidence: DashboardConnectionEvidence | null,
  checking: boolean,
): {
  title: string;
  detail: string;
  ariaLabel: string;
  className: "live" | "configured" | "demo" | "unavailable";
} {
  if (evidence === "verified-live") {
    return {
      title: "Amazon 已連線",
      detail: "Live · 本機安全連線",
      ariaLabel: "Amazon 已連線",
      className: "live",
    };
  }
  if (evidence === "configured-live") {
    return {
      title: "Live 憑證已設定",
      detail: "尚未驗證 · 本機安全連線",
      ariaLabel: "Live 憑證已設定，Amazon 尚未驗證",
      className: "configured",
    };
  }
  if (evidence === "demo") {
    return {
      title: "展示資料",
      detail: "Demo · 本機安全連線",
      ariaLabel: "展示資料",
      className: "demo",
    };
  }
  return {
    title: checking ? "檢查連線中" : "連線狀態待確認",
    detail: "狀態未知 · 本機安全連線",
    ariaLabel: checking ? "正在檢查 Amazon 連線" : "Amazon 連線狀態尚未確認",
    className: "unavailable",
  };
}

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
    value.dayCount <= MAX_CUSTOM_SALES_TREND_DAYS &&
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
    range.dayCount > MAX_CUSTOM_SALES_TREND_DAYS ||
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
  const marketplace = marketplaceById(marketplaceId);
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

const TOOL_META: Record<Tool, { label: string; symbol: string; group: NavigationGroup }> = {
  ads: { label: "廣告", symbol: "◎", group: "operations" },
  inbound: { label: "入庫貨件", symbol: "⇣", group: "reports" },
  restock: { label: "補貨", symbol: "↗", group: "operations" },
  copy: { label: "文案", symbol: "Aa", group: "product" },
  images: { label: "圖片", symbol: "▧", group: "product" },
  "a-plus": { label: "A+ 健檢", symbol: "A+", group: "product" },
  variations: { label: "變體", symbol: "◇", group: "product" },
  price: { label: "定價", symbol: "$", group: "pricing" },
  promotion: { label: "促銷", symbol: "%", group: "pricing" },
  subscriptions: { label: "訂閱價格健檢", symbol: "S", group: "pricing" },
  "business-pricing": { label: "B2B 價格健檢", symbol: "B2B", group: "pricing" },
  accounting: { label: "帳務", symbol: "▤", group: "operations" },
};

const TOOL_SECTIONS: ReadonlyArray<{
  label: string;
  symbol: string;
  group: NavigationGroup;
  tools: readonly Tool[];
}> = [
  {
    label: "產品區",
    symbol: "◇",
    group: "product",
    tools: ["copy", "images", "a-plus", "variations"],
  },
  {
    label: "價格區",
    symbol: "$",
    group: "pricing",
    tools: ["price", "promotion", "subscriptions", "business-pricing"],
  },
  {
    label: "營運區",
    symbol: "◎",
    group: "operations",
    tools: ["restock", "ads", "accounting"],
  },
  {
    label: "報表區",
    symbol: "▤",
    group: "reports",
    tools: ["inbound"],
  },
];

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
  onOpenConnection,
  additionalAuditCards = null,
  performanceCompanion = null,
  reportMenuEntries,
}: DashboardProps) {
  const startingMarketplaceId = marketplaceById(initialMarketplaceId)
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
  const [openToolMenu, setOpenToolMenu] = useState<NavigationGroup | null>(null);
  const [contentWorkspaceTab, setContentWorkspaceTab] =
    useState<ContentWorkspaceTab>("single");
  const [contentAuditCache, setContentAuditCache] = useState<
    Record<string, ContentAuditCache>
  >({});
  const [imageWorkspaceTab, setImageWorkspaceTab] =
    useState<ImageWorkspaceTab>("single");
  const [imageAuditCache, setImageAuditCache] = useState<
    Record<string, ImageAuditCache>
  >({});
  const [aplusAuditCache, setAplusAuditCache] = useState<
    Record<string, AplusAuditSnapshot>
  >({});
  const [aplusAuditJobs, setAplusAuditJobs] = useState<
    Record<string, AplusAuditObservableJob>
  >({});
  const [unboundVariationAuditCache, setUnboundVariationAuditCache] = useState<
    Record<string, UnboundVariationAuditCache>
  >({});
  const [unboundVariationAuditOpen, setUnboundVariationAuditOpen] = useState(false);
  const [agedInventoryOpen, setAgedInventoryOpen] = useState(false);
  const [reportLibraryOpen, setReportLibraryOpen] = useState(false);
  const [reviewAuditOpen, setReviewAuditOpen] = useState(false);
  const [reviewAuditCache, setReviewAuditCache] = useState<
    Record<string, ReviewAuditCache>
  >({});
  const [businessPricingAuditCache, setBusinessPricingAuditCache] = useState<
    Record<string, BusinessPricingAuditSnapshot>
  >({});
  const [standaloneAuditJobs, setStandaloneAuditJobs] = useState<
    Record<string, StandaloneAuditJob>
  >({});
  const [inboundShipmentCache, setInboundShipmentCache] = useState<
    Record<string, InboundShipmentCache>
  >({});
  const [latestInboundShipmentKey, setLatestInboundShipmentKey] = useState<
    Record<string, string>
  >({});
  const [auditPreference, setAuditPreference] = useState<AuditPreference>(null);
  const [returnToUnboundVariationAudit, setReturnToUnboundVariationAudit] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [salesTrend, setSalesTrend] =
    useState<SalesTrendSnapshot | null>(initialSalesTrend);
  const [salesTrendLoading, setSalesTrendLoading] = useState(false);
  const [salesTrendError, setSalesTrendError] = useState<string | null>(initialError);
  const [connectionEvidence, setConnectionEvidence] = useState<
    Record<string, DashboardConnectionEvidence>
  >(
    initialSalesTrend
      ? {
          [initialSalesTrend.marketplaceId]: connectionEvidenceFromSales(
            initialSalesTrend.mode,
          ),
        }
      : {},
  );
  const [connectionChecking, setConnectionChecking] = useState(false);
  const salesTrendAbortRef = useRef<AbortController | null>(null);
  const connectionAbortRef = useRef<AbortController | null>(null);
  const primaryNavRef = useRef<HTMLElement | null>(null);
  const menuTriggerRefs = useRef<Partial<Record<NavigationGroup, HTMLButtonElement>>>({});
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
          "這台電腦上的 AMZ.API Bridge 尚未支援新版銷售趨勢，請安裝新版後再同步。",
        );
      }
      if (salesTrendAbortRef.current === controller) {
        setSalesTrend(payload);
        setConnectionEvidence((current) => ({
          ...current,
          [marketplaceId]: connectionEvidenceFromSales(payload.mode),
        }));
      }
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
      connectionAbortRef.current?.abort();
      connectionAbortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    connectionAbortRef.current?.abort();
    const controller = new AbortController();
    connectionAbortRef.current = controller;
    setConnectionChecking(true);
    const params = new URLSearchParams({ marketplaceId });
    void fetch(`/api/system/health?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (
          !response.ok ||
          !isRecord(payload) ||
          payload.marketplaceId !== marketplaceId ||
          (payload.mode !== "live" && payload.mode !== "demo")
        ) {
          throw new Error("Amazon 連線狀態回應無法辨識。");
        }
        if (connectionAbortRef.current === controller) {
          setConnectionEvidence((current) => ({
            ...current,
            [marketplaceId]: connectionEvidenceFromHealth(
              current[marketplaceId] ?? null,
              payload.mode as "live" | "demo",
            ),
          }));
        }
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        // A failed status check is unknown, not proof that credentials are absent.
      })
      .finally(() => {
        if (connectionAbortRef.current === controller) setConnectionChecking(false);
      });
    return () => controller.abort();
  }, [marketplaceId]);

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

  useEffect(() => {
    if (!openToolMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!primaryNavRef.current?.contains(event.target as Node)) {
        setOpenToolMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const group = openToolMenu;
      setOpenToolMenu(null);
      window.setTimeout(() => menuTriggerRefs.current[group]?.focus(), 0);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openToolMenu]);

  useEffect(() => {
    if (!unboundVariationAuditOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUnboundVariationAuditOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [unboundVariationAuditOpen]);

  useEffect(() => {
    if (!agedInventoryOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAgedInventoryOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [agedInventoryOpen]);

  useEffect(() => {
    if (!reportLibraryOpen && !reviewAuditOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setReportLibraryOpen(false);
      setReviewAuditOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [reportLibraryOpen, reviewAuditOpen]);

  const launch = (tool: Tool) => {
    setOpenToolMenu(null);
    setCommandOpen(false);
    if (tool === "a-plus" && !connectionEvidence[marketplaceId]) {
      onOpenConnection?.();
      return;
    }
    if (tool === "copy") setContentWorkspaceTab("single");
    if (tool === "images") setImageWorkspaceTab("single");
    if (tool === "variations") setReturnToUnboundVariationAudit(false);
    if (tool === "subscriptions") setAuditPreference("subscriptions");
    setOpenTool(tool);
  };

  const openMenu = (group: NavigationGroup, focus: "first" | "last" = "first") => {
    setOpenToolMenu(group);
    window.setTimeout(() => {
      const items = primaryNavRef.current?.querySelectorAll<HTMLButtonElement>(
        `[data-tool-menu="${group}"] [role="menuitem"]`,
      );
      if (!items?.length) return;
      items[focus === "first" ? 0 : items.length - 1]?.focus();
    }, 0);
  };

  const handleMenuItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    section: (typeof TOOL_SECTIONS)[number],
    index: number,
  ) => {
    const menu = event.currentTarget.parentElement;
    const items = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(index + direction + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (event.key === "Tab") {
      setOpenToolMenu(null);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const sectionIndex = TOOL_SECTIONS.findIndex(
        ({ group }) => group === section.group,
      );
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = TOOL_SECTIONS[
        (sectionIndex + direction + TOOL_SECTIONS.length) % TOOL_SECTIONS.length
      ];
      setOpenToolMenu(null);
      menuTriggerRefs.current[next.group]?.focus();
    }
  };

  const launchContentAudit = () => {
    setCommandOpen(false);
    setAuditPreference("content");
    setContentWorkspaceTab("audit");
    setOpenTool("copy");
  };

  const cacheContentAudit = useCallback((cache: ContentAuditCache) => {
    setContentAuditCache((current) => ({
      ...current,
      [cache.snapshot.marketplaceId]: cache,
    }));
  }, []);

  const launchImageAudit = () => {
    setCommandOpen(false);
    setAuditPreference("images");
    setImageWorkspaceTab("audit");
    setOpenTool("images");
  };

  const cacheImageAudit = useCallback((cache: ImageAuditCache) => {
    setImageAuditCache((current) => ({
      ...current,
      [cache.snapshot.marketplaceId]: cache,
    }));
  }, []);

  const cacheUnboundVariationAudit = useCallback(
    (cache: UnboundVariationAuditCache) => {
      setUnboundVariationAuditCache((current) => ({
        ...current,
        [cache.snapshot.marketplaceId]: cache,
      }));
    },
    [],
  );

  const cacheStandaloneAuditJob = useCallback((job: StandaloneAuditJob) => {
    setStandaloneAuditJobs((current) => {
      const key = standaloneAuditDashboardKey(job.marketplaceId, job.kind);
      const merged = mergeAuditJobObservation(current[key], job);
      if (merged === current[key]) return current;
      return { ...current, [key]: merged };
    });
  }, []);

  const cacheAplusAuditJob = useCallback((job: AplusAuditObservableJob) => {
    setAplusAuditJobs((current) => {
      const merged = mergeAuditJobObservation(current[job.marketplaceId], job);
      if (merged === current[job.marketplaceId]) return current;
      return { ...current, [job.marketplaceId]: merged };
    });
    if (job.ready && job.status === "completed") {
      setAplusAuditCache((current) => ({
        ...current,
        [job.marketplaceId]: job.snapshot,
      }));
    }
  }, []);

  const activeAplusAuditIdentity = Object.values(aplusAuditJobs)
    .filter((job) => !job.ready)
    .map((job) => `${job.jobId}:${job.contextId}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!activeAplusAuditIdentity) return;
    let active = true;
    for (const job of Object.values(aplusAuditJobs)) {
      if (job.ready) continue;
      void observeAplusAuditJob({
        initialJob: job,
        isObserverActive: () => active,
        onJobChange: cacheAplusAuditJob,
      }).catch((observerError: unknown) => {
        if (observerError instanceof Error && observerError.name === "AbortError") return;
      });
    }
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAplusAuditIdentity, cacheAplusAuditJob]);

  const activeStandaloneAuditIdentity = Object.values(standaloneAuditJobs)
    .filter((job) => !job.ready)
    .map((job) => `${job.jobId}:${job.contextId}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!activeStandaloneAuditIdentity) return;
    const controllers: AbortController[] = [];
    for (const job of Object.values(standaloneAuditJobs)) {
      if (job.ready) continue;
      const controller = new AbortController();
      controllers.push(controller);
      void observeStandaloneAuditJob({
        expected: job,
        signal: controller.signal,
        onProgress: cacheStandaloneAuditJob,
      }).then(cacheStandaloneAuditJob).catch((observerError: unknown) => {
        if (observerError instanceof Error && observerError.name === "AbortError") return;
        // A drawer may still own a healthy observer. The home observer never
        // starts a new Amazon job and leaves the last verified progress visible.
      });
    }
    return () => controllers.forEach((controller) => controller.abort());
  // Job identity, rather than each progress tick, owns the home observer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStandaloneAuditIdentity, cacheStandaloneAuditJob]);

  const cacheReviewAudit = useCallback((cache: ReviewAuditCache) => {
    const cacheMarketplaceId = cache.snapshot?.marketplaceId ?? cache.job?.marketplaceId;
    if (!cacheMarketplaceId) return;
    setReviewAuditCache((current) => ({
      ...current,
      [cacheMarketplaceId]: cache,
    }));
  }, []);

  const clearReviewAudit = useCallback((targetMarketplaceId: string) => {
    setReviewAuditCache((current) => {
      const next = { ...current };
      delete next[targetMarketplaceId];
      return next;
    });
  }, []);

  const cacheInboundShipment = useCallback((cache: InboundShipmentCache) => {
    const key = inboundShipmentCacheKey(cache.marketplaceId, cache.dateRange);
    setInboundShipmentCache((current) =>
      replaceInboundShipmentCacheForMarketplace(current, cache));
    setLatestInboundShipmentKey((current) => ({
      ...current,
      [cache.marketplaceId]: key,
    }));
  }, []);

  const currentInboundShipmentKey = latestInboundShipmentKey[marketplaceId] ?? null;
  const currentInboundShipment = currentInboundShipmentKey
    ? inboundShipmentCache[currentInboundShipmentKey] ?? null
    : null;
  const backgroundInboundShipmentJob =
    currentInboundShipment?.job?.state === "running"
      ? currentInboundShipment.job
      : null;
  const backgroundInboundShipmentJobId = backgroundInboundShipmentJob?.jobId ?? null;

  useEffect(() => {
    if (openTool === "inbound" || !backgroundInboundShipmentJob || !currentInboundShipment) {
      return;
    }
    const controller = new AbortController();
    const observedRange = currentInboundShipment.dateRange;
    const preservedSnapshot = currentInboundShipment.snapshot;
    void pollInboundShipmentJob({
      marketplaceId,
      dateRange: observedRange,
      initialJob: backgroundInboundShipmentJob,
      signal: controller.signal,
      request: (url, signal) => fetch(url, { cache: "no-store", signal }),
      onJob: (job) => {
        if (!controller.signal.aborted) {
          cacheInboundShipment({
            marketplaceId,
            dateRange: observedRange,
            job,
            snapshot: job.snapshot ?? preservedSnapshot,
            error: null,
          });
        }
      },
    }).then((terminal) => {
      if (controller.signal.aborted) return;
      if (terminal.state === "failed" || !terminal.snapshot) {
        throw new Error(inboundShipmentFailureMessage(terminal));
      }
      cacheInboundShipment({
        marketplaceId,
        dateRange: observedRange,
        job: terminal,
        snapshot: terminal.snapshot,
        error: null,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        return;
      }
      cacheInboundShipment({
        marketplaceId,
        dateRange: observedRange,
        job: null,
        snapshot: preservedSnapshot,
        error: error instanceof Error
          ? error.message
          : "FBA 入庫貨件背景進度暫時無法接回。",
      });
    });
    // Closing the drawer transfers observation here. Cleanup aborts only this
    // renderer GET loop; the main-process job continues independently.
    return () => controller.abort();
    // Progress updates keep the same job identity and must not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundInboundShipmentJobId, cacheInboundShipment, marketplaceId, openTool]);

  const backgroundReviewAuditJob =
    reviewAuditCache[marketplaceId]?.snapshot
      ? null
      : reviewAuditCache[marketplaceId]?.job ?? null;
  const backgroundReviewAuditJobId = backgroundReviewAuditJob?.jobId ?? null;

  useEffect(() => {
    if (reviewAuditOpen || !backgroundReviewAuditJob) return;
    const controller = new AbortController();
    void pollExistingReviewAuditJob({
      marketplaceId,
      initialJob: backgroundReviewAuditJob,
      signal: controller.signal,
      request: ({ method, url, signal }) => fetch(url, {
        method,
        cache: "no-store",
        signal,
      }),
      onJob: (job) => {
        if (!controller.signal.aborted) {
          cacheReviewAudit({ snapshot: null, job });
        }
      },
      onSnapshot: (snapshot) => {
        if (!controller.signal.aborted) {
          cacheReviewAudit({ snapshot, job: null });
        }
      },
      onStopped: () => {
        if (!controller.signal.aborted) clearReviewAudit(marketplaceId);
      },
    });
    // Opening the drawer hands observation back to ReviewAuditPanel. Changing
    // marketplace or unmounting Dashboard aborts only this renderer GET loop;
    // the main-process review runner remains independent.
    return () => controller.abort();
    // Progress updates retain the same job ID and must not restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundReviewAuditJobId, cacheReviewAudit, clearReviewAudit, marketplaceId, reviewAuditOpen]);

  const openUnboundVariationSku = (sellerSku: string) => {
    setGlobalSku(sellerSku);
    setUnboundVariationAuditOpen(false);
    setReturnToUnboundVariationAudit(true);
    setOpenTool("variations");
  };

  const setAutoSyncPreference = (enabled: boolean) => {
    setAutoSync(enabled);
    try {
      window.localStorage.setItem("fba-os-auto-sync", enabled ? "on" : "off");
    } catch {
      // Device-local preference is optional.
    }
  };

  const resolveGlobalContext = (nextMarketplaceId: string, sellerSku: string) => {
    if (marketplaceById(nextMarketplaceId)) {
      setMarketplaceId(nextMarketplaceId);
    }
    setGlobalSku(sellerSku);
  };

  const marketplace = marketplaceById(marketplaceId) ?? MARKETPLACE_OPTIONS[0];
  const subscriptionAuditSupported = isSubscriptionAuditMarketplaceSupported(marketplaceId);
  const matchingSalesTrend =
    salesTrend?.marketplaceId === marketplaceId &&
    rangeMatchesSelection(salesTrend.range, trendSelection)
      ? salesTrend
      : null;
  const visibleSalesTrend = salesTrendError ? null : matchingSalesTrend;
  const resolvedPerformanceCompanion = performanceCompanion ?? (
    visibleSalesTrend ? (
      <BrandSalesCard
        marketplaceId={marketplaceId}
        startDate={visibleSalesTrend.range.startDate}
        endDate={visibleSalesTrend.range.endDate}
      />
    ) : null
  );
  const currentConnectionEvidence = connectionEvidence[marketplaceId] ?? null;
  const connectionBadge = dashboardConnectionBadgeCopy(
    currentConnectionEvidence,
    connectionChecking,
  );
  const currentContentAudit = contentAuditCache[marketplaceId] ?? null;
  const currentAuditAttentionCount = currentContentAudit
    ? currentContentAudit.snapshot.rows.filter(
        (row) => row.readStatus === "incomplete" || row.issues.length > 0,
      ).length
    : 0;
  const currentImageAudit = imageAuditCache[marketplaceId] ?? null;
  const currentImageAuditAttentionCount = currentImageAudit
    ? currentImageAudit.snapshot.summary.underMinimum +
      currentImageAudit.snapshot.summary.incomplete
    : 0;
  const currentAplusMode = currentConnectionEvidence === "demo"
    ? "demo"
    : currentConnectionEvidence ? "live" : null;
  const currentStandaloneMode = currentAplusMode ?? "live";
  const cachedAplusJob = aplusAuditJobs[marketplaceId] ?? null;
  const currentAplusJob = cachedAplusJob?.mode === currentStandaloneMode
    ? cachedAplusJob
    : null;
  const currentStandaloneJob = (kind: StandaloneAuditKind) => {
    const job = standaloneAuditJobs[
      standaloneAuditDashboardKey(marketplaceId, kind)
    ] ?? null;
    return job?.mode === currentStandaloneMode ? job : null;
  };
  const currentContentAuditJob = currentStandaloneJob("content");
  const currentImageAuditJob = currentStandaloneJob("image");
  const currentVariationAuditJob = currentStandaloneJob("variation");
  const currentSubscriptionAuditJob = currentStandaloneJob("subscription");
  const currentBusinessPricingAuditJob = currentStandaloneJob("businessPricing");
  const currentAdvertisingAuditJob = currentStandaloneJob("advertising");
  const currentAgedInventoryJob = currentStandaloneJob("agedInventory");
  const cachedAplusAudit = aplusAuditCache[marketplaceId] ?? null;
  const currentAplusAudit = cachedAplusAudit?.mode === currentAplusMode
    ? cachedAplusAudit
    : null;
  const currentAplusAuditAttentionCount = currentAplusAudit
    ? currentAplusAudit.summary.missing +
      currentAplusAudit.summary.incomplete +
      currentAplusAudit.summary.unavailable
    : 0;
  const currentReviewAudit = reviewAuditCache[marketplaceId] ?? null;
  const currentReviewAuditProgress = reviewAuditHomeProgress(currentReviewAudit);
  const currentBusinessPricingAudit = businessPricingAuditCache[marketplaceId] ?? null;
  const currentBusinessPricingAttentionCount = businessPricingAttentionCount(
    currentBusinessPricingAudit?.summary ?? null,
  );
  const effectiveReportMenuEntries: readonly DashboardReportMenuEntry[] =
    reportMenuEntries ?? [
      {
        id: "report-library",
        label: "Amazon API 文件庫",
        detail: "Seller 公開 report types、篩選與接線條件",
        symbol: "▤",
        onSelect: () => setReportLibraryOpen(true),
      },
      {
        id: "review-audit",
        label: "FBA 評論健檢",
        detail: "非父變體 ASIN 主題前五／後五與 Excel",
        symbol: "☆",
        onSelect: () => setReviewAuditOpen(true),
      },
    ];

  const openReportExport = (exportId: string) => {
    setReportLibraryOpen(false);
    switch (exportId) {
      case "CONTENT_AUDIT_XLSX":
        launchContentAudit();
        break;
      case "IMAGE_AUDIT_XLSX":
        launchImageAudit();
        break;
      case "AGED_INVENTORY_XLSX":
        setAuditPreference("inventory");
        setAgedInventoryOpen(true);
        break;
      case "SUBSCRIPTION_AUDIT_XLSX":
        launch("subscriptions");
        break;
      case "UNBOUND_VARIATION_AUDIT_XLSX":
        setAuditPreference("variations");
        setUnboundVariationAuditOpen(true);
        break;
      case "REVIEW_TOPIC_AUDIT_XLSX":
        setReviewAuditOpen(true);
        break;
    }
  };
  const currentUnboundVariationAudit = unboundVariationAuditCache[marketplaceId] ?? null;
  const contentAuditCacheMatchesJob = standaloneAuditSnapshotMatchesJob(
    currentContentAudit?.snapshot ?? null,
    currentContentAuditJob,
  );
  const imageAuditCacheMatchesJob = standaloneAuditSnapshotMatchesJob(
    currentImageAudit?.snapshot ?? null,
    currentImageAuditJob,
  );
  const variationAuditCacheMatchesJob = standaloneAuditSnapshotMatchesJob(
    currentUnboundVariationAudit?.snapshot ?? null,
    currentVariationAuditJob,
  );
  const businessPricingCacheMatchesJob = standaloneAuditSnapshotMatchesJob(
    currentBusinessPricingAudit,
    currentBusinessPricingAuditJob,
  );
  const standaloneProgressStatus = (job: StandaloneAuditJob | null) => {
    if (!job) return null;
    if (job.ready) {
      return (
        <span className="content-audit-home-status" aria-live="polite">
          <strong>{job.status === "completed" ? "已完成" : "未完成"}</strong>
          <small>{job.status === "completed"
            ? "點開查看並載入本次結果"
            : job.error.message}</small>
        </span>
      );
    }
    const progress = standaloneAuditHomeProgress(job);
    const hasCount = progress.completedUnits !== null && progress.totalUnits !== null;
    return (
      <span className="content-audit-home-status" aria-live="polite">
        <strong>{hasCount
          ? `${progress.completedUnits!.toLocaleString()}／${progress.totalUnits!.toLocaleString()}`
          : "進行中"}</strong>
        <small>{progress.label}</small>
        {hasCount && progress.totalUnits! > 0 && (
          <progress
            className="review-audit-home-progress"
            value={progress.completedUnits!}
            max={progress.totalUnits!}
            aria-label={`${progress.label} ${progress.completedUnits}／${progress.totalUnits}`}
          />
        )}
      </span>
    );
  };

  const changeMarketplace = (nextMarketplaceId: string) => {
    if (!marketplaceById(nextMarketplaceId) || salesTrendLoading) return;
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
              <BrandGlyph className="os-brand-mark" />
              <span className="os-brand-copy"><strong>AMZ.API</strong><small>FBA only</small></span>
            </a>

            <nav ref={primaryNavRef} className="workspace-primary-nav" aria-label="主要功能">
              {TOOL_SECTIONS.map((section) => (
                <div
                  className="workspace-primary-group"
                  data-tool-menu={section.group}
                  key={section.group}
                >
                  <button
                    ref={(element) => {
                      if (element) menuTriggerRefs.current[section.group] = element;
                    }}
                    type="button"
                    className={
                      openToolMenu === section.group ||
                      (openTool && TOOL_META[openTool].group === section.group)
                        ? "workspace-primary-menu-trigger active"
                        : "workspace-primary-menu-trigger"
                    }
                    aria-haspopup="menu"
                    aria-expanded={openToolMenu === section.group}
                    aria-label={section.label}
                    onClick={() => setOpenToolMenu((current) =>
                      current === section.group ? null : section.group,
                    )}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        openMenu(
                          section.group,
                          event.key === "ArrowDown" ? "first" : "last",
                        );
                      }
                    }}
                  >
                    <span aria-hidden="true">{section.symbol}</span>
                    <strong>{section.label}</strong>
                    <i className="workspace-primary-menu-chevron" aria-hidden="true" />
                  </button>
                  {openToolMenu === section.group && (
                    <div className="workspace-primary-menu" role="menu" aria-label={section.label}>
                      {section.tools.map((tool, index) => (
                        <button
                          key={tool}
                          type="button"
                          role="menuitem"
                          className={openTool === tool ? "active" : ""}
                          onClick={() => launch(tool)}
                          onKeyDown={(event) => handleMenuItemKeyDown(event, section, index)}
                        >
                          <span aria-hidden="true">{TOOL_META[tool].symbol}</span>
                          <span className="workspace-primary-menu-copy">
                            <strong>{tool === "subscriptions" && !subscriptionAuditSupported
                              ? "S&S 能力說明"
                              : TOOL_META[tool].label}</strong>
                            <small>{tool === "copy"
                              ? "文案編輯與全站健檢"
                              : tool === "images"
                                ? "圖片工作台與全站健檢"
                                : tool === "variations"
                                  ? "Family 查詢與安全改掛"
                                  : tool === "price"
                                    ? "標準價與訂閱資訊"
                                    : tool === "promotion"
                                      ? "Sale Price 限時售價"
                                      : tool === "subscriptions"
                                        ? "FBA S&S 價格與趨勢"
                                        : tool === "business-pricing"
                                          ? "FBA B2B offer 健檢與安全調整"
                                        : tool === "restock"
                                          ? "FBA 庫存與補貨規劃"
                                          : tool === "inbound"
                                            ? "貨件、SKU 接收數量與三層瑕疵"
                                          : tool === "ads"
                                            ? "廣告授權與官方入口"
                                            : "公開 FBA 報表規劃"}</small>
                          </span>
                          <i aria-hidden="true">›</i>
                        </button>
                      ))}
                      {section.group === "reports" && effectiveReportMenuEntries
                        .filter((entry) => entry.id !== "review-audit")
                        .map((entry, index) => (
                        <button
                          key={entry.id}
                          type="button"
                          role="menuitem"
                          aria-disabled={entry.disabled || undefined}
                          onClick={() => {
                            if (entry.disabled) return;
                            setOpenToolMenu(null);
                            entry.onSelect?.();
                          }}
                          onKeyDown={(event) => handleMenuItemKeyDown(
                            event,
                            section,
                            section.tools.length + index,
                          )}
                        >
                          <span aria-hidden="true">{entry.symbol ?? "▤"}</span>
                          <span className="workspace-primary-menu-copy">
                            <strong>{entry.label}</strong>
                            <small>{entry.detail}</small>
                          </span>
                          <i aria-hidden="true">{entry.disabled ? "…" : "›"}</i>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>

            <div className="workspace-header-status">
              <button
                type="button"
                className={`mode-badge workspace-connection-status ${connectionBadge.className}`}
                onClick={onOpenConnection}
                aria-label={`${connectionBadge.ariaLabel}；開啟本機安全連線設定`}
                aria-haspopup="dialog"
              >
                <i />
                <span><strong>{connectionBadge.title}</strong><small>{connectionBadge.detail}</small></span>
                <b aria-hidden="true" />
              </button>
              <span className="workspace-avatar" role="img" aria-label={`${viewerName ?? "Jasper"} 的私人工作區`}>{(viewerName?.trim()?.[0] ?? "J").toUpperCase()}</span>
            </div>
          </div>

          <div className="workspace-context-shell">
            <div className="workspace-contextbar">
              <label className="global-sku"><span aria-hidden="true">⌕</span><input value={globalSku} onChange={(event) => setGlobalSku(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setCommandOpen(true); } }} placeholder="輸入 SKU，所有工具共用" aria-label="全域 Seller SKU" /></label>
              <button className="command-topbar-button" type="button" onClick={() => setCommandOpen(true)}><span aria-hidden="true">✦</span>SKU 總覽</button>
              <label className="global-marketplace"><select value={marketplaceId} onChange={(event) => changeMarketplace(event.target.value)} disabled={salesTrendLoading} aria-label="Amazon 站點">{MARKETPLACE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></label>
              <SystemHealthControl
                marketplaceId={marketplaceId}
                autoSync={autoSync}
                auditPreference={auditPreference}
                onAutoSyncChange={setAutoSyncPreference}
              />
            </div>
          </div>
        </header>

        <main id="workspace-top" className="workspace-content" tabIndex={-1}>
          <h1 className="visually-hidden">AMZ.API FBA 營運首頁</h1>

          {currentConnectionEvidence === "demo" && <section className="os-notice"><span>D</span><div><strong>目前使用展示資料</strong><p>{visibleSalesTrend?.notice || "在右上角本機安全連線加入憑證後，即可切換真實 Amazon 資料。"}</p></div><button type="button" onClick={onOpenConnection}>開啟本機安全連線</button></section>}

          <div className={`operations-overview-grid ${resolvedPerformanceCompanion ? "has-companion" : ""}`}>
            <section className="operations-pulse">
              <div className="pulse-heading">
                <div className="pulse-title-compact">
                  <div><p className="eyebrow">OPERATIONS PULSE</p><h2>近期營運</h2></div>
                  <small className="operations-last-sync">銷售趨勢最後同步 {formatDateTime(visibleSalesTrend?.fetchedAt ?? null, true)} · {marketplace.name}</small>
                </div>
                <button type="button" className="pulse-refresh" onClick={() => void loadSalesTrend()} disabled={salesTrendLoading}><span className={salesTrendLoading ? "spin" : ""}>↻</span>{salesTrendLoading ? "同步中" : "同步"}</button>
              </div>
              <SalesTrendChart snapshot={visibleSalesTrend} selection={trendSelection} loading={salesTrendLoading} error={salesTrendError} onSelectionChange={changeTrendSelection} onRetry={() => void loadSalesTrend()} />
            </section>
            {resolvedPerformanceCompanion && (
              <aside className="operations-companion" aria-label="近期營運延伸資訊">
                {resolvedPerformanceCompanion}
              </aside>
            )}
          </div>

          <AuditSuiteHomeCard
            marketplaceId={marketplaceId}
            marketplaceShort={marketplace.shortLabel}
          />

          <div className="home-section-heading">
            <div><p className="eyebrow">ONE-CLICK CHECKS</p><h2>一鍵健檢</h2></div>
            <p>只在需要時掃描；同次 App 使用期間會保留結果。</p>
          </div>

          <div className="health-audit-home-grid">
            <section className="content-audit-home-card" aria-label="全站文案健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">Aa✓</span>
              <div>
                <p className="eyebrow">FBA CONTENT HEALTH</p>
                <h2>{AUDIT_SUITE_SECTION_LABELS.content}</h2>
                <p>一次找出全部 FBA SKU 的疑似錯字、賣點不足與缺成分；結果在這次 App 使用期間會保留。</p>
              </div>
              {standaloneProgressStatus(
                currentContentAuditJob && !contentAuditCacheMatchesJob
                  ? currentContentAuditJob
                  : null,
              )}
              {contentAuditCacheMatchesJob && currentContentAudit && (
                <span className="content-audit-home-status">
                  <strong>{currentAuditAttentionCount.toLocaleString()}</strong>
                  <small>個待確認項目</small>
                </span>
              )}
              <button type="button" onClick={launchContentAudit}>
                {currentContentAuditJob
                  ? currentContentAuditJob.ready
                    ? currentContentAuditJob.status === "completed"
                      ? "查看已完成的文案健檢"
                      : "查看未完成的文案健檢"
                    : "查看進行中的文案健檢"
                  : currentContentAudit ? "繼續上次文案健檢" : "開始全站文案健檢"}
                <i aria-hidden="true">›</i>
              </button>
            </section>

            <section className="content-audit-home-card image-audit-home-card" aria-label="全站圖片健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">▧6</span>
              <div>
                <p className="eyebrow">FBA IMAGE HEALTH</p>
                <h2>{AUDIT_SUITE_SECTION_LABELS.image}</h2>
                <p>一次找出少於六張 Listing 圖片與讀取未完成的 FBA SKU；關閉後仍可繼續上次結果。</p>
              </div>
              {standaloneProgressStatus(
                currentImageAuditJob && !imageAuditCacheMatchesJob
                  ? currentImageAuditJob
                  : null,
              )}
              {imageAuditCacheMatchesJob && currentImageAudit && (
                <span className="content-audit-home-status">
                  <strong>{currentImageAuditAttentionCount.toLocaleString()}</strong>
                  <small>個需補圖／確認</small>
                </span>
              )}
              <button type="button" onClick={launchImageAudit}>
                {currentImageAuditJob
                  ? currentImageAuditJob.ready
                    ? currentImageAuditJob.status === "completed"
                      ? "查看已完成的圖片健檢"
                      : "查看未完成的圖片健檢"
                    : "查看進行中的圖片健檢"
                  : currentImageAudit ? "繼續上次圖片健檢" : "開始全站圖片健檢"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card" aria-label="全站 A+ 健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">A+</span>
              <div>
                <p className="eyebrow">FBA A+ CONTENT</p>
                <h2>{AUDIT_SUITE_SECTION_LABELS.aplus}</h2>
                <p>逐一核對全部 FBA ASIN 是否有官方 A+ 發布紀錄。</p>
              </div>
              {currentAplusJob && !currentAplusJob.ready && (
                <span className="content-audit-home-status" aria-live="polite">
                  <strong>{currentAplusJob.progress.totalAsins > 0
                    ? `${currentAplusJob.progress.completedAsins}／${currentAplusJob.progress.totalAsins}`
                    : "進行中"}</strong>
                  <small>正在核對官方 A+ 發布紀錄</small>
                  {currentAplusJob.progress.totalAsins > 0 && (
                    <progress
                      className="review-audit-home-progress"
                      value={currentAplusJob.progress.completedAsins}
                      max={currentAplusJob.progress.totalAsins}
                      aria-label={`A+ 健檢 ${currentAplusJob.progress.completedAsins}／${currentAplusJob.progress.totalAsins}`}
                    />
                  )}
                </span>
              )}
              {(!currentAplusJob || currentAplusJob.ready) && currentAplusAudit && (
                <span className="content-audit-home-status">
                  <strong>{currentAplusAuditAttentionCount.toLocaleString()}</strong>
                  <small>個缺 A+／待確認</small>
                </span>
              )}
              <button type="button" onClick={() => launch("a-plus")}>
                {currentAplusJob && !currentAplusJob.ready
                  ? "查看進行中的 A+ 健檢"
                  : currentAplusAudit ? "繼續上次 A+ 健檢" : "開始全站 A+ 健檢"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card" aria-label="未綁變體健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">◇?</span>
              <div>
                <p className="eyebrow">VARIATION RELATIONSHIPS</p>
                <h2>{AUDIT_SUITE_SECTION_LABELS.variation}</h2>
                <p>一次核對全部 FBA SKU；只有 Amazon relationships 明確完整且沒有 parent，才列為未綁變體。</p>
              </div>
              {standaloneProgressStatus(
                currentVariationAuditJob && !variationAuditCacheMatchesJob
                  ? currentVariationAuditJob
                  : null,
              )}
              {variationAuditCacheMatchesJob && currentUnboundVariationAudit && (
                <span className="content-audit-home-status">
                  <strong>{currentUnboundVariationAudit.snapshot.summary.unbound.toLocaleString()}</strong>
                  <small>個確定未綁</small>
                </span>
              )}
              <button type="button" onClick={() => {
                setAuditPreference("variations");
                setUnboundVariationAuditOpen(true);
              }}>
                {currentVariationAuditJob
                  ? currentVariationAuditJob.ready
                    ? currentVariationAuditJob.status === "completed"
                      ? "查看已完成的未綁變體健檢"
                      : "查看未完成的未綁變體健檢"
                    : "查看進行中的未綁變體健檢"
                  : currentUnboundVariationAudit ? "繼續上次未綁變體健檢" : "開始未綁變體健檢"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card" aria-label="全站訂閱價格健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">S&amp;S</span>
              <div>
                <p className="eyebrow">FBA SUBSCRIBE &amp; SAVE</p>
                <h2>{AUDIT_SUITE_SECTION_LABELS.subscription}</h2>
                <p>{subscriptionAuditSupported
                  ? "一次核對全部 FBA Subscribe & Save SKU 的目前訂閱折扣與價格趨勢；不會自動修改 Amazon。"
                  : `${marketplace.shortLabel} 目前先顯示能力邊界；不會用其他站點資料代替。`}</p>
              </div>
              {standaloneProgressStatus(currentSubscriptionAuditJob)}
              <button type="button" onClick={() => launch("subscriptions")}>
                {currentSubscriptionAuditJob
                  ? currentSubscriptionAuditJob.ready
                    ? currentSubscriptionAuditJob.status === "completed"
                      ? "查看已完成的訂閱價格健檢"
                      : "查看未完成的訂閱價格健檢"
                    : "查看進行中的訂閱價格健檢"
                  : subscriptionAuditSupported ? "開始全站訂閱價格健檢" : "查看 S&S 能力說明"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card business-pricing-audit-home-card" aria-label="全站 B2B 價格健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">B2B</span>
              <div>
                <p className="eyebrow">FBA AMAZON BUSINESS</p>
                <h2>{AUDIT_SUITE_SECTION_LABELS.businessPricing}</h2>
                <p>找出未設定或高於一般售價的 Amazon Business 價格；可安全編輯時提供一般售價減 1 美元與四階數量折扣預設。</p>
              </div>
              {standaloneProgressStatus(
                currentBusinessPricingAuditJob && !businessPricingCacheMatchesJob
                  ? currentBusinessPricingAuditJob
                  : null,
              )}
              {businessPricingCacheMatchesJob && currentBusinessPricingAudit && (
                <span className="content-audit-home-status">
                  <strong>{currentBusinessPricingAttentionCount.toLocaleString()}</strong>
                  <small>個需調整／確認</small>
                </span>
              )}
              <button type="button" onClick={() => launch("business-pricing")}>
                {currentBusinessPricingAuditJob
                  ? currentBusinessPricingAuditJob.ready
                    ? currentBusinessPricingAuditJob.status === "completed"
                      ? "查看已完成的 B2B 價格健檢"
                      : "查看未完成的 B2B 價格健檢"
                    : "查看進行中的 B2B 價格健檢"
                  : currentBusinessPricingAudit ? "繼續上次 B2B 價格健檢" : "開始全站 B2B 價格健檢"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card audit-card-pending" aria-label="廣告覆蓋健檢與 Ads API 連線">
              <span className="content-audit-home-icon" aria-hidden="true">◎</span>
              <div>
                <p className="eyebrow">ADS COVERAGE</p>
                <h2>{AUDIT_SUITE_SECTION_LABELS.advertising}</h2>
                <p>將依 SKU 優先、ASIN 補充比對 SP 活動；Amazon Ads API 尚未連線前不顯示推測結果。</p>
              </div>
              {standaloneProgressStatus(currentAdvertisingAuditJob)}
              <button type="button" onClick={() => launch("ads")}>
                {currentAdvertisingAuditJob
                  ? currentAdvertisingAuditJob.ready
                    ? currentAdvertisingAuditJob.status === "completed"
                      ? "查看已完成的廣告覆蓋健檢"
                      : "查看未完成的廣告覆蓋健檢"
                    : "查看進行中的廣告覆蓋健檢"
                  : "查看健檢能力與連線"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            {additionalAuditCards}
          </div>

          <details className="low-frequency-audits">
            <summary>
              <span>
                <strong>低頻健檢</strong>
                <small>庫齡與評論不會跟著 {AUDIT_SUITE_SECTION_COUNT} 項一鍵健檢自動執行，需要時再展開。</small>
              </span>
              <i aria-hidden="true">＋</i>
            </summary>
            <div className="health-audit-home-grid">
              <section className="content-audit-home-card" aria-label="FBA 180 天以上庫齡健檢捷徑">
                <span className="content-audit-home-icon" aria-hidden="true">FBA</span>
                <div>
                  <p className="eyebrow">FBA AGED INVENTORY · 180+ DAYS</p>
                  <h2>FBA 180 天以上庫齡健檢</h2>
                  <p>主清單只列已經超過 180 天的 FBA 庫存；Amazon estimated excess 預估與費用放在獨立分頁。</p>
                </div>
                {standaloneProgressStatus(currentAgedInventoryJob)}
                <button type="button" onClick={() => {
                  setAuditPreference("inventory");
                  setAgedInventoryOpen(true);
                }}>
                  {currentAgedInventoryJob
                    ? currentAgedInventoryJob.ready
                      ? currentAgedInventoryJob.status === "completed"
                        ? "查看已完成的 FBA 庫齡健檢"
                        : "查看未完成的 FBA 庫齡健檢"
                      : "查看進行中的 FBA 庫齡健檢"
                    : "開始 FBA 180 天以上庫齡健檢"}
                  <i aria-hidden="true">›</i>
                </button>
              </section>
              <section className="content-audit-home-card review-audit-home-card" aria-label="FBA 評論主題健檢捷徑">
                <span className="content-audit-home-icon" aria-hidden="true">☆5</span>
                <div>
                  <p className="eyebrow">CUSTOMER FEEDBACK · NON-PARENT ASIN</p>
                  <h2>評論健檢</h2>
                  <p>依 Listings relationships 已證明的 child 與 standalone ASIN 列出評論主題前五與後五；排除 parent，也不冒充商品總星等。</p>
                </div>
                {currentReviewAuditProgress && (
                  <span
                    className="content-audit-home-status"
                    aria-label={currentReviewAuditProgress.ariaLabel}
                  >
                    <strong>{currentReviewAuditProgress.primary}</strong>
                    <small>{currentReviewAuditProgress.detail}</small>
                    {currentReviewAudit?.job && (
                      <progress
                        className="review-audit-home-progress"
                        value={currentReviewAudit.job.progress.percent}
                        max={100}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                )}
                <button type="button" onClick={() => setReviewAuditOpen(true)}>
                  {currentReviewAudit?.snapshot
                    ? "查看上次評論健檢"
                    : currentReviewAudit?.job
                      ? "查看進行中的評論健檢"
                      : "開始全站評論健檢"}
                  <i aria-hidden="true">›</i>
                </button>
              </section>
            </div>
          </details>

        </main>
        <footer className="os-footer"><span>AMZ.API · GitHub UI / Local Key</span><span>FBA only · No FBM · No buyer PII</span></footer>
      </div>

      {openTool === "ads" && <AdsDrawer
        initialMarketplaceId={marketplaceId}
        auditMode={currentStandaloneMode}
        coverageAuditJob={currentAdvertisingAuditJob}
        onCoverageAuditJobChange={cacheStandaloneAuditJob}
        onClose={() => setOpenTool(null)}
      />}
      {openTool === "inbound" && <InboundShipmentsDrawer marketplaceId={marketplaceId} marketplaceShort={marketplace.shortLabel} marketplaceTimeZone={marketplace.timeZone} cachedResult={currentInboundShipment} onCachedResultChange={cacheInboundShipment} onClose={() => setOpenTool(null)} />}
      {openTool === "restock" && <ReplenishmentDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "copy" && <SkuOperationsDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} initialTab={contentWorkspaceTab} auditCacheByMarketplace={contentAuditCache} onAuditCacheChange={cacheContentAudit} auditMode={currentStandaloneMode} auditJob={currentContentAuditJob} onAuditJobChange={cacheStandaloneAuditJob} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "images" && <ImageWorkspaceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} initialTab={imageWorkspaceTab} auditCacheByMarketplace={imageAuditCache} onAuditCacheChange={cacheImageAudit} auditMode={currentStandaloneMode} auditJob={currentImageAuditJob} onAuditJobChange={cacheStandaloneAuditJob} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "a-plus" && (
        <AplusAuditDrawer
          marketplaceId={marketplaceId}
          marketplaceShort={marketplace.shortLabel}
          mode={currentAplusMode ?? "live"}
          cachedSnapshot={currentAplusAudit}
          job={currentAplusJob}
          onJobChange={cacheAplusAuditJob}
          onSnapshotChange={(snapshot) => setAplusAuditCache((current) => ({
            ...current,
            [snapshot.marketplaceId]: snapshot,
          }))}
          onClose={() => setOpenTool(null)}
        />
      )}
      {openTool === "variations" && <VariationPlannerDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => {
        setOpenTool(null);
        if (returnToUnboundVariationAudit) {
          setReturnToUnboundVariationAudit(false);
          setUnboundVariationAuditOpen(true);
        }
      }} />}
      {openTool === "price" && <PriceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "promotion" && <PromotionCenterDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "subscriptions" && <SubscriptionAuditDrawer marketplaceId={marketplaceId} marketplaceShort={marketplace.shortLabel} mode={currentStandaloneMode} initialJob={currentSubscriptionAuditJob} onJobChange={cacheStandaloneAuditJob} onClose={() => setOpenTool(null)} />}
      {openTool === "business-pricing" && (
        <BusinessPricingAuditDrawer
          marketplaceId={marketplaceId}
          marketplaceShort={marketplace.shortLabel}
          mode={currentStandaloneMode}
          initialJob={currentBusinessPricingAuditJob}
          onJobChange={cacheStandaloneAuditJob}
          cachedSnapshot={currentBusinessPricingAudit}
          onSnapshotChange={(snapshot) => setBusinessPricingAuditCache((current) => ({
            ...current,
            [snapshot.marketplaceId]: snapshot,
          }))}
          onClose={() => setOpenTool(null)}
        />
      )}
      {openTool === "accounting" && <AccountingCenterDrawer marketplaceId={marketplaceId} onClose={() => setOpenTool(null)} />}
      {commandOpen && <SkuCommandCenter initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onLaunch={(tool) => launch(tool)} onClose={() => setCommandOpen(false)} />}
      {unboundVariationAuditOpen && createPortal(
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setUnboundVariationAuditOpen(false);
          }}
        >
          <aside
            className="order-drawer unbound-variation-audit-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unbound-variation-audit-title"
          >
            <div className="drawer-header">
              <div><p className="eyebrow">FBA · READ ONLY</p><h2 id="unbound-variation-audit-title">未綁變體健檢</h2></div>
              <button type="button" onClick={() => setUnboundVariationAuditOpen(false)} autoFocus aria-label="關閉未綁變體健檢">×</button>
            </div>
            <UnboundVariationAuditPanel
              marketplaceId={marketplaceId}
              marketplaceShort={marketplace.shortLabel}
              mode={currentStandaloneMode}
              onOpenSku={openUnboundVariationSku}
              cachedResult={currentUnboundVariationAudit}
              onCachedResultChange={cacheUnboundVariationAudit}
              initialJob={currentVariationAuditJob}
              onJobChange={cacheStandaloneAuditJob}
            />
          </aside>
        </div>,
        document.body,
      )}
      {agedInventoryOpen && createPortal(
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAgedInventoryOpen(false);
          }}
        >
          <aside
            className="order-drawer aged-inventory-audit-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aged-inventory-audit-title"
          >
            <div className="drawer-header">
              <div><p className="eyebrow">FBA · 180+ DAYS · ESTIMATED EXCESS</p><h2 id="aged-inventory-audit-title">FBA 庫齡與預估冗餘健檢</h2></div>
              <button type="button" onClick={() => setAgedInventoryOpen(false)} autoFocus aria-label="關閉 FBA 庫齡與預估冗餘健檢">×</button>
            </div>
            <AgedInventoryPanel
              marketplaceId={marketplaceId}
              marketplaceShort={marketplace.shortLabel}
              mode={currentStandaloneMode}
              initialJob={currentAgedInventoryJob}
              onJobChange={cacheStandaloneAuditJob}
            />
          </aside>
        </div>,
        document.body,
      )}
      {reportLibraryOpen && createPortal(
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReportLibraryOpen(false);
          }}
        >
          <aside
            className="order-drawer report-library-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-library-drawer-title"
          >
            <div className="drawer-header">
              <div><p className="eyebrow">AMAZON PUBLIC API · FBA BOUNDARY</p><h2 id="report-library-drawer-title">報表區</h2></div>
              <button type="button" onClick={() => setReportLibraryOpen(false)} autoFocus aria-label="關閉 Amazon API 文件庫">×</button>
            </div>
            <ReportLibraryPanel
              marketplaceId={marketplaceId}
              onOpenExport={openReportExport}
            />
          </aside>
        </div>,
        document.body,
      )}
      {reviewAuditOpen && createPortal(
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReviewAuditOpen(false);
          }}
        >
          <aside
            className="order-drawer review-audit-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-audit-drawer-title"
          >
            <div className="drawer-header">
              <div><p className="eyebrow">FBA · NON-PARENT ASIN · READ ONLY</p><h2 id="review-audit-drawer-title">評論健檢</h2></div>
              <button type="button" onClick={() => setReviewAuditOpen(false)} autoFocus aria-label="關閉 FBA 評論健檢">×</button>
            </div>
            <ReviewAuditPanel
              marketplaceId={marketplaceId}
              marketplaceShort={marketplace.shortLabel}
              cachedResult={currentReviewAudit}
              onCachedResultChange={cacheReviewAudit}
            />
          </aside>
        </div>,
        document.body,
      )}
    </div>
  );
}
