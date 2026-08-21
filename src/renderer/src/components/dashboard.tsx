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
import { AccountingCenterDrawer } from "./accounting-center-panel";
import AdsDrawer from "./ads-drawer";
import AgedInventoryPanel from "./aged-inventory-panel";
import AuditSuiteHomeCard from "./audit-suite-home-card";
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
import SystemHealthControl, {
  type AuditPreference,
} from "./system-health-control";
import SubscriptionAuditDrawer from "./subscription-audit-drawer";
import UnboundVariationAuditPanel, {
  type UnboundVariationAuditCache,
} from "./unbound-variation-audit-panel";
import VariationPlannerDrawer from "./variation-planner-drawer";
import { isSubscriptionAuditMarketplaceSupported } from "../subscription-audit";
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
  | "variations"
  | "price"
  | "promotion"
  | "subscriptions"
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

const TOOL_META: Record<Tool, { label: string; symbol: string; group: ToolGroup }> = {
  ads: { label: "廣告", symbol: "◎", group: "operations" },
  inbound: { label: "入庫貨件", symbol: "⇣", group: "operations" },
  restock: { label: "補貨", symbol: "↗", group: "operations" },
  copy: { label: "文案", symbol: "Aa", group: "product" },
  images: { label: "圖片", symbol: "▧", group: "product" },
  variations: { label: "變體", symbol: "◇", group: "product" },
  price: { label: "定價", symbol: "$", group: "pricing" },
  promotion: { label: "促銷", symbol: "%", group: "pricing" },
  subscriptions: { label: "訂閱價格健檢", symbol: "S", group: "pricing" },
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
    tools: ["copy", "images", "variations"],
  },
  {
    label: "價格區",
    symbol: "$",
    group: "pricing",
    tools: ["price", "promotion"],
  },
  {
    label: "營運區",
    symbol: "◎",
    group: "operations",
    tools: ["restock", "inbound", "ads", "accounting"],
  },
  {
    label: "報表區",
    symbol: "▤",
    group: "reports",
    tools: [],
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
  const currentReviewAudit = reviewAuditCache[marketplaceId] ?? null;
  const currentReviewAuditProgress = reviewAuditHomeProgress(currentReviewAudit);
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
                          onKeyDown={(event) => handleMenuItemKeyDown(event, section, index)}
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

          <section className="inbound-home-card" aria-label="FBA 入庫貨件追蹤捷徑">
            <span className="inbound-home-icon" aria-hidden="true">⇣</span>
            <div className="inbound-home-copy">
              <p className="eyebrow">FBA FULFILLMENT INBOUND · READ ONLY</p>
              <h2>FBA 入庫貨件追蹤</h2>
              <p>一次同步所選日期內全部貨件、SKU 預期／Amazon 已接收數量，以及每日貨件／包裝箱／產品問題列；不用逐票點進去。</p>
            </div>
            <span className="inbound-home-status" role="status">
              {currentInboundShipment?.job?.state === "running" ? (
                <>
                  <strong>{currentInboundShipment.job.progress.total === null
                    ? `已完成 ${currentInboundShipment.job.progress.completed.toLocaleString("zh-TW")} 筆`
                    : `${currentInboundShipment.job.progress.completed.toLocaleString("zh-TW")} / ${currentInboundShipment.job.progress.total.toLocaleString("zh-TW")}`}</strong>
                  <small>背景同步中 · 可開啟查看</small>
                  {currentInboundShipment.job.progress.total !== null && (
                    <progress
                      value={currentInboundShipment.job.progress.completed}
                      max={Math.max(1, currentInboundShipment.job.progress.total)}
                    />
                  )}
                </>
              ) : currentInboundShipment?.snapshot ? (
                <>
                  <strong>{currentInboundShipment.snapshot.summary.shipmentCount.toLocaleString("zh-TW")} 個貨件</strong>
                  <small>{currentInboundShipment.snapshot.coverage.state === "complete" && currentInboundShipment.snapshot.issueReport.state === "completed" ? "完整快照" : "部分完成"} · {formatDateTime(currentInboundShipment.snapshot.fetchedAt, true)}</small>
                </>
              ) : currentInboundShipment?.error ? (
                <><strong>同步未完成</strong><small>{currentInboundShipment.error}</small></>
              ) : (
                <><strong>尚未同步</strong><small>預設最近 90 天</small></>
              )}
            </span>
            <button type="button" onClick={() => launch("inbound")}>
              {currentInboundShipment?.job?.state === "running"
                ? "查看進行中的貨件同步"
                : currentInboundShipment?.snapshot
                  ? "查看上次貨件快照"
                  : "開啟 FBA 入庫貨件追蹤"}
              <i aria-hidden="true">›</i>
            </button>
          </section>

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
                <h2>全站文案健檢</h2>
                <p>一次找出全部 FBA SKU 的疑似錯字、賣點不足與缺成分；結果在這次 App 使用期間會保留。</p>
              </div>
              {currentContentAudit && (
                <span className="content-audit-home-status">
                  <strong>{currentAuditAttentionCount.toLocaleString()}</strong>
                  <small>個待確認項目</small>
                </span>
              )}
              <button type="button" onClick={launchContentAudit}>
                {currentContentAudit ? "繼續上次文案健檢" : "開始全站文案健檢"}
                <i aria-hidden="true">›</i>
              </button>
            </section>

            <section className="content-audit-home-card image-audit-home-card" aria-label="全站圖片健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">▧5</span>
              <div>
                <p className="eyebrow">FBA IMAGE HEALTH</p>
                <h2>全站圖片健檢</h2>
                <p>一次找出少於五張 Listing 圖片與讀取未完成的 FBA SKU；關閉後仍可繼續上次結果。</p>
              </div>
              {currentImageAudit && (
                <span className="content-audit-home-status">
                  <strong>{currentImageAuditAttentionCount.toLocaleString()}</strong>
                  <small>個需補圖／確認</small>
                </span>
              )}
              <button type="button" onClick={launchImageAudit}>
                {currentImageAudit ? "繼續上次圖片健檢" : "開始全站圖片健檢"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card" aria-label="未綁變體健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">◇?</span>
              <div>
                <p className="eyebrow">VARIATION RELATIONSHIPS</p>
                <h2>未綁變體健檢</h2>
                <p>一次核對全部 FBA SKU；只有 Amazon relationships 明確完整且沒有 parent，才列為未綁變體。</p>
              </div>
              {currentUnboundVariationAudit && (
                <span className="content-audit-home-status">
                  <strong>{currentUnboundVariationAudit.snapshot.summary.unbound.toLocaleString()}</strong>
                  <small>個確定未綁</small>
                </span>
              )}
              <button type="button" onClick={() => {
                setAuditPreference("variations");
                setUnboundVariationAuditOpen(true);
              }}>
                {currentUnboundVariationAudit ? "繼續上次未綁變體健檢" : "開始未綁變體健檢"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card" aria-label="FBA 180 天以上庫齡健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">FBA</span>
              <div>
                <p className="eyebrow">FBA AGED INVENTORY · 180+ DAYS</p>
                <h2>FBA 180 天以上庫齡健檢</h2>
                <p>主清單只列已經超過 180 天的 FBA 庫存；Amazon estimated excess 預估與費用放在獨立分頁。</p>
              </div>
              <button type="button" onClick={() => {
                setAuditPreference("inventory");
                setAgedInventoryOpen(true);
              }}>
                開始 FBA 180 天以上庫齡健檢
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card" aria-label="全站訂閱價格健檢捷徑">
              <span className="content-audit-home-icon" aria-hidden="true">S&amp;S</span>
              <div>
                <p className="eyebrow">FBA SUBSCRIBE &amp; SAVE</p>
                <h2>全站訂閱價格健檢</h2>
                <p>{subscriptionAuditSupported
                  ? "一次核對全部 FBA Subscribe & Save SKU 的目前訂閱折扣與價格趨勢；不會自動修改 Amazon。"
                  : `${marketplace.shortLabel} 目前先顯示能力邊界；不會用其他站點資料代替。`}</p>
              </div>
              <button type="button" onClick={() => launch("subscriptions")}>
                {subscriptionAuditSupported ? "開始全站訂閱價格健檢" : "查看 S&S 能力說明"}
                <i aria-hidden="true">›</i>
              </button>
            </section>
            <section className="content-audit-home-card audit-card-pending" aria-label="廣告覆蓋健檢與 Ads API 連線">
              <span className="content-audit-home-icon" aria-hidden="true">◎</span>
              <div>
                <p className="eyebrow">ADS COVERAGE</p>
                <h2>廣告覆蓋健檢</h2>
                <p>將依 SKU 優先、ASIN 補充比對 SP 活動；Amazon Ads API 尚未連線前不顯示推測結果。</p>
              </div>
              <button type="button" onClick={() => launch("ads")}>
                查看健檢能力與連線
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
            {additionalAuditCards}
          </div>

        </main>
        <footer className="os-footer"><span>AMZ.API · GitHub UI / Local Key</span><span>FBA only · No FBM · No buyer PII</span></footer>
      </div>

      {openTool === "ads" && <AdsDrawer initialMarketplaceId={marketplaceId} onClose={() => setOpenTool(null)} />}
      {openTool === "inbound" && <InboundShipmentsDrawer marketplaceId={marketplaceId} marketplaceShort={marketplace.shortLabel} marketplaceTimeZone={marketplace.timeZone} cachedResult={currentInboundShipment} onCachedResultChange={cacheInboundShipment} onClose={() => setOpenTool(null)} />}
      {openTool === "restock" && <ReplenishmentDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "copy" && <SkuOperationsDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} initialTab={contentWorkspaceTab} auditCacheByMarketplace={contentAuditCache} onAuditCacheChange={cacheContentAudit} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "images" && <ImageWorkspaceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} initialTab={imageWorkspaceTab} auditCacheByMarketplace={imageAuditCache} onAuditCacheChange={cacheImageAudit} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "variations" && <VariationPlannerDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => {
        setOpenTool(null);
        if (returnToUnboundVariationAudit) {
          setReturnToUnboundVariationAudit(false);
          setUnboundVariationAuditOpen(true);
        }
      }} />}
      {openTool === "price" && <PriceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "promotion" && <PromotionCenterDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "subscriptions" && <SubscriptionAuditDrawer marketplaceId={marketplaceId} marketplaceShort={marketplace.shortLabel} onClose={() => setOpenTool(null)} />}
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
              onOpenSku={openUnboundVariationSku}
              cachedResult={currentUnboundVariationAudit}
              onCachedResultChange={cacheUnboundVariationAudit}
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
