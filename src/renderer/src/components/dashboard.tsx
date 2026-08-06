"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdsDrawer from "./ads-drawer";
import ImageWorkspaceDrawer from "./image-workspace-drawer";
import PriceDrawer from "./price-drawer";
import PromotionCenterDrawer from "./promotion-center-drawer";
import ReplenishmentDrawer from "./replenishment-drawer";
import SalesTrendChart, {
  salesTrendFailureMessage,
  type SalesTrendSnapshot,
} from "./sales-trend-chart";
import SkuCommandCenter from "./sku-command-center";
import SkuOperationsDrawer from "./sku-operations-drawer";
import SystemHealthControl from "./system-health-control";

type Money = { amount: number; currencyCode: string };
type OrderItem = {
  orderItemId: string;
  asin: string;
  sellerSku: string;
  title: string;
  quantity: number;
  unitPrice: Money | null;
  lineTotal: Money | null;
};
type Order = {
  orderId: string;
  createdTime: string;
  lastUpdatedTime: string;
  marketplaceId: string;
  marketplaceName: string;
  programs: string[];
  fulfillmentStatus: string;
  shipBy: string | null;
  deliverBy: string | null;
  total: Money | null;
  items: OrderItem[];
};
type Marketplace = {
  label: string;
  shortLabel: string;
  name: string;
  currency: string;
  region: "na" | "eu" | "fe";
};

export type DashboardSnapshot = {
  mode: "live" | "demo";
  orders: Order[];
  marketplaceId: string;
  marketplace: Marketplace;
  fetchedAt: string;
  nextToken: string | null;
  lastUpdatedBefore: string | null;
  requestId: string | null;
  rateLimit: string | null;
  notice: string | null;
};

type DashboardProps = {
  initialSnapshot: DashboardSnapshot;
  viewerName?: string | null;
  initialError?: string | null;
};

type Tool = "ads" | "restock" | "copy" | "images" | "price" | "promotion";
type AutomationLevel = "automatic" | "one_click" | "manual";

const MARKETPLACE_OPTIONS = [
  { id: "ATVPDKIKX0DER", label: "美國站", flag: "US" },
  { id: "A1VC38T7YXB528", label: "日本站", flag: "JP" },
  { id: "A2EUQ1WTGCTBG2", label: "加拿大站", flag: "CA" },
  { id: "A19VAU5U5O7RUS", label: "新加坡站", flag: "SG" },
  { id: "A39IBJ37TRP1C6", label: "澳洲站", flag: "AU" },
  { id: "A1F83G8C2ARO7P", label: "英國站", flag: "UK" },
  { id: "A1PA6795UKMFR9", label: "德國站", flag: "DE" },
];

const STATUS_LABELS: Record<string, string> = {
  PENDING_AVAILABILITY: "預購待確認",
  PENDING: "處理中",
  UNSHIPPED: "待出貨",
  PARTIALLY_SHIPPED: "部分出貨",
  SHIPPED: "已出貨",
  CANCELLED: "已取消",
  UNFULFILLABLE: "無法履約",
  UNKNOWN: "未知",
};

const TOOL_META: Record<Tool, { label: string; symbol: string; group: string }> = {
  ads: { label: "廣告", symbol: "◎", group: "planning" },
  restock: { label: "補貨", symbol: "↗", group: "planning" },
  copy: { label: "文案", symbol: "Aa", group: "product" },
  images: { label: "圖片", symbol: "▧", group: "product" },
  price: { label: "定價", symbol: "$", group: "pricing" },
  promotion: { label: "促銷", symbol: "%", group: "pricing" },
};

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

function retryableRead(status: number): boolean {
  return status === 429 || status >= 500;
}

function waitForRetry(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function formatMoney(money: Money | null): string {
  if (!money) return "—";
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

function statusTone(status: string) {
  if (status === "SHIPPED") return "success";
  if (status === "UNSHIPPED" || status === "PARTIALLY_SHIPPED") return "warning";
  if (status === "CANCELLED" || status === "UNFULFILLABLE") return "danger";
  return "neutral";
}

function productSummary(order: Order) {
  const first = order.items[0];
  if (!first) return { title: "未提供商品", subtitle: "—" };
  return {
    title: first.title,
    subtitle: order.items.length > 1 ? `${first.sellerSku} · 另有 ${order.items.length - 1} 項` : first.sellerSku,
  };
}

export default function Dashboard({
  initialSnapshot,
  viewerName,
  initialError = null,
}: DashboardProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [marketplaceId, setMarketplaceId] = useState(initialSnapshot.marketplaceId);
  const [globalSku, setGlobalSku] = useState("");
  const [orderDays, setOrderDays] = useState("14");
  const [trendDays, setTrendDays] = useState<7 | 14 | 30>(7);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [openTool, setOpenTool] = useState<Tool | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [currentPageToken, setCurrentPageToken] = useState<string | null>(null);
  const [pageHistory, setPageHistory] = useState<Array<string | null>>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [autoSync, setAutoSync] = useState(true);
  const [salesTrend, setSalesTrend] = useState<SalesTrendSnapshot | null>(null);
  const [salesTrendLoading, setSalesTrendLoading] = useState(false);
  const [salesTrendError, setSalesTrendError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const salesTrendAbortRef = useRef<AbortController | null>(null);
  const didMount = useRef(false);

  const loadSnapshot = useCallback(async (paginationToken: string | null = null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ marketplaceId, days: orderDays });
    if (status) params.set("status", status);
    if (paginationToken) params.set("paginationToken", paginationToken);
    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch(`/api/sp-api/orders?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!retryableRead(response.status) || attempt === 1) break;
        await waitForRetry(controller.signal, 650);
      }
      if (!response) throw new Error("目前無法載入訂單。");
      const payload = (await response.json()) as DashboardSnapshot | { message?: string; requestId?: string | null };
      if (!response.ok) {
        const problem = payload as { message?: string; requestId?: string | null };
        throw new Error(`${problem.message || "目前無法載入訂單。"}${problem.requestId ? `（Request ID: ${problem.requestId}）` : ""}`);
      }
      setSnapshot(payload as DashboardSnapshot);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "目前無法載入訂單。");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [marketplaceId, orderDays, status]);

  const loadSalesTrend = useCallback(async () => {
    salesTrendAbortRef.current?.abort();
    const controller = new AbortController();
    salesTrendAbortRef.current = controller;
    setSalesTrendLoading(true);
    setSalesTrendError(null);
    setSalesTrend((current) =>
      current?.marketplaceId === marketplaceId && current.days === trendDays
        ? current
        : null,
    );
    const params = new URLSearchParams({ marketplaceId, days: String(trendDays) });
    try {
      const response = await fetch(`/api/sp-api/sales-trend?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as
        | SalesTrendSnapshot
        | { code?: string; message?: string; requestId?: string | null };
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
      const next = payload as SalesTrendSnapshot;
      if (next.marketplaceId !== marketplaceId || next.days !== trendDays) {
        throw new Error("銷售趨勢回應與目前站點或日期範圍不一致，已停止顯示。");
      }
      if (salesTrendAbortRef.current === controller) setSalesTrend(next);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      if (salesTrendAbortRef.current === controller) {
        setSalesTrendError(
          requestError instanceof Error
            ? requestError.message
            : "目前無法載入 FBA 銷售趨勢。",
        );
      }
    } finally {
      if (salesTrendAbortRef.current === controller) setSalesTrendLoading(false);
    }
  }, [marketplaceId, trendDays]);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setCurrentPageToken(null);
    setPageHistory([]);
    setPageNumber(1);
    void loadSnapshot(null);
    return () => abortRef.current?.abort();
  }, [marketplaceId, orderDays, status, loadSnapshot]);

  useEffect(() => {
    void loadSalesTrend();
    return () => salesTrendAbortRef.current?.abort();
  }, [loadSalesTrend]);

  useEffect(() => {
    if (!selectedOrder) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedOrder(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedOrder]);

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
        !selectedOrder &&
        !loading &&
        !salesTrendLoading
      ) {
        void loadSnapshot(currentPageToken);
        void loadSalesTrend();
      }
    }, 5 * 60 * 1_000);
    return () => window.clearInterval(interval);
  }, [autoSync, commandOpen, currentPageToken, loadSalesTrend, loadSnapshot, loading, openTool, salesTrendLoading, selectedOrder]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return snapshot.orders;
    return snapshot.orders.filter((order) =>
      [order.orderId, order.marketplaceName, ...order.items.flatMap((item) => [item.title, item.sellerSku, item.asin])]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [search, snapshot.orders]);

  const launch = (tool: Tool) => {
    setSelectedOrder(null);
    setCommandOpen(false);
    setOpenTool(tool);
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
    if (MARKETPLACE_OPTIONS.some((item) => item.id === nextMarketplaceId)) {
      setMarketplaceId(nextMarketplaceId);
    }
    setGlobalSku(sellerSku);
  };

  const goNext = () => {
    if (!snapshot.nextToken || loading) return;
    setPageHistory((history) => [...history, currentPageToken]);
    setCurrentPageToken(snapshot.nextToken);
    setPageNumber((page) => page + 1);
    void loadSnapshot(snapshot.nextToken);
  };
  const goPrevious = () => {
    if (!pageHistory.length || loading) return;
    const previousToken = pageHistory.at(-1) ?? null;
    setPageHistory((history) => history.slice(0, -1));
    setCurrentPageToken(previousToken);
    setPageNumber((page) => Math.max(1, page - 1));
    void loadSnapshot(previousToken);
  };

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="commerce-os">
      <aside className="workspace-sidebar">
        <a className="os-brand" href="#workspace-top" onClick={(event) => { event.preventDefault(); scrollTo("workspace-top"); }} aria-label="AMZ.API 首頁"><span className="os-brand-mark">A</span><span><strong>AMZ.API</strong><small>Amazon operations</small></span></a>
        <nav className="workspace-nav" aria-label="三大營運核心">
          {[
            { label: "策劃區", group: "planning", tools: ["ads", "restock"] as Tool[] },
            { label: "產品區", group: "product", tools: ["copy", "images"] as Tool[] },
            { label: "價格區", group: "pricing", tools: ["price", "promotion"] as Tool[] },
          ].map((section) => (
            <div key={section.group}><span>{section.label}</span>{section.tools.map((tool) => <button key={tool} type="button" className={openTool === tool ? "active" : ""} onClick={() => launch(tool)}><i>{TOOL_META[tool].symbol}</i>{TOOL_META[tool].label}<b>›</b></button>)}</div>
          ))}
        </nav>
        <div className="sidebar-status"><div><span className={`connection-light ${snapshot.mode === "live" ? "connected" : ""}`} /><strong>{snapshot.mode === "live" ? "Amazon 已連線" : "展示模式"}</strong></div><p>FBA only · 不含 FBM</p></div>
        <div className="sidebar-profile"><span>{(viewerName?.trim()?.[0] ?? "J").toUpperCase()}</span><div><strong>{viewerName ?? "Jayden"}</strong><small>Private workspace</small></div></div>
      </aside>

      <div className="workspace-surface">
        <header className="workspace-topbar">
          <a className="mobile-brand" href="#workspace-top" onClick={(event) => { event.preventDefault(); scrollTo("workspace-top"); }}><span>A</span><strong>AMZ.API</strong></a>
          <label className="global-sku"><span>⌕</span><input value={globalSku} onChange={(event) => setGlobalSku(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setCommandOpen(true); } }} placeholder="輸入 SKU，所有工具共用" aria-label="全域 Seller SKU" /></label>
          <button className="command-topbar-button" type="button" onClick={() => setCommandOpen(true)}><span>✦</span>總覽</button>
          <label className="global-marketplace"><select value={marketplaceId} onChange={(event) => setMarketplaceId(event.target.value)} aria-label="Amazon 站點">{MARKETPLACE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.flag} · {item.label}</option>)}</select></label>
          <span className={`mode-badge ${snapshot.mode}`}><i />{snapshot.mode === "live" ? "Live" : "Demo"}</span>
          <SystemHealthControl marketplaceId={marketplaceId} />
          <div className="avatar">{(viewerName?.trim()?.[0] ?? "J").toUpperCase()}</div>
        </header>

        <main id="workspace-top" className="workspace-content">
          <section className="os-hero">
            <div><p className="eyebrow">FBA OPERATING SYSTEM</p><h1>{viewerName ? `${viewerName.split(" ")[0]}，` : ""}今天要處理什麼？</h1><p>策劃、產品、價格各自一區。選好站點與 SKU，剩下只保留必要步驟。</p></div>
            <div className="hero-sync"><span>訂單最後同步</span><strong>{formatDateTime(snapshot.fetchedAt)}</strong><small>{snapshot.marketplace.name}</small></div>
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
              <div><strong>訂單自動同步</strong><small>{autoSync ? "每 5 分鐘 · 已開啟" : "已暫停"}</small></div>
            </label>
          </section>

          <section className="command-strip" aria-label="SKU 指揮中心">
            <span className="command-strip-orb">✦</span>
            <div><p className="eyebrow">SKU COMMAND CENTER</p><strong>不用再到每一區重複查 SKU</strong><small>一次整合商品主檔、FBA 庫存、補貨、文案、圖片、價格、促銷與訂閱。</small></div>
            <div className="command-strip-levels"><span className="automation-badge automatic">自動掃描</span><span className="automation-badge one_click">一鍵處理</span><span className="automation-badge manual">只留下人工判斷</span></div>
            <button type="button" onClick={() => setCommandOpen(true)}>{globalSku.trim() ? `掃描 ${globalSku.trim()}` : "開啟 SKU 總覽"}<i>›</i></button>
          </section>

          {snapshot.mode === "demo" && <section className="os-notice"><span>D</span><div><strong>目前使用展示資料</strong><p>{snapshot.notice || "在 Mac 安全連線加入 LWA 憑證後即可切換真實 Amazon 資料。"}</p></div><a href="#connection" onClick={(event) => { event.preventDefault(); scrollTo("connection"); }}>串接說明</a></section>}
          {error && <section className="error-card" role="alert"><div><strong>同步未完成</strong><p>{error}</p></div><button type="button" onClick={() => void loadSnapshot(currentPageToken)}>再試一次</button></section>}

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
              </div>
            </section>

            <section id="pricing-zone" className="core-zone pricing-zone">
              <div className="zone-heading"><div><span>03</span><p className="eyebrow">PRICING</p><h2>價格區</h2></div><p>價格、訂閱與促銷放在一起。</p></div>
              <div className="zone-tools">
                <button className="tool-tile" type="button" onClick={() => launch("price")}><span className="tool-symbol price">$</span><div><h3>定價與訂閱</h3><p>自動查現價、S&amp;S、上下限與價差；一般調價一鍵處理，大幅變動才要求再確認。</p><ToolCapabilities tool="price" /></div><i>›</i></button>
                <button className="tool-tile" type="button" onClick={() => launch("promotion")}><span className="tool-symbol promotion">%</span><div><h3>促銷</h3><p>限時售價可安全一鍵建立；Coupon 會整理設定並開啟 Amazon 官方頁完成。</p><ToolCapabilities tool="promotion" /></div><i>›</i></button>
              </div>
            </section>
          </div>

          <section className="operations-pulse">
            <div className="pulse-heading"><div><p className="eyebrow">OPERATIONS PULSE</p><h2>近期營運</h2><p>先看完整 FBA 銷售趨勢；需要時再往下查看訂單。</p></div><button type="button" className="pulse-refresh" onClick={() => { void loadSnapshot(currentPageToken); void loadSalesTrend(); }} disabled={loading || salesTrendLoading}><span className={loading || salesTrendLoading ? "spin" : ""}>↻</span>{loading || salesTrendLoading ? "同步中" : "同步"}</button></div>
            <SalesTrendChart snapshot={salesTrend} days={trendDays} loading={salesTrendLoading} error={salesTrendError} onDaysChange={setTrendDays} onRetry={() => void loadSalesTrend()} />
            <div className="pulse-toolbar">
              <select value={orderDays} onChange={(event) => setOrderDays(event.target.value)} aria-label="訂單日期範圍"><option value="7">最近 7 天訂單</option><option value="14">最近 14 天訂單</option><option value="30">最近 30 天訂單</option><option value="60">最近 60 天訂單</option><option value="90">最近 90 天訂單</option></select>
              <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="訂單狀態"><option value="">所有狀態</option><option value="UNSHIPPED">待出貨</option><option value="PARTIALLY_SHIPPED">部分出貨</option><option value="SHIPPED">已出貨</option><option value="PENDING">處理中</option><option value="CANCELLED">已取消</option></select>
              <label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋訂單、SKU 或 ASIN" /></label>
            </div>
            <div className={`table-wrap pulse-table ${loading ? "is-loading" : ""}`}>
              <table><thead><tr><th>訂單</th><th>商品</th><th>狀態</th><th className="align-right">金額</th></tr></thead><tbody>{filteredOrders.map((order) => { const product = productSummary(order); return <tr key={order.orderId}><td><button className="order-link" type="button" onClick={() => setSelectedOrder(order)}>{order.orderId}</button><small>{formatDateTime(order.createdTime, true)}</small></td><td className="product-cell"><strong>{product.title}</strong><small>{product.subtitle}</small></td><td><span className={`status-pill ${statusTone(order.fulfillmentStatus)}`}>{STATUS_LABELS[order.fulfillmentStatus] || order.fulfillmentStatus}</span></td><td className="align-right amount-cell"><strong>{formatMoney(order.total)}</strong><small>{order.items.reduce((sum, item) => sum + item.quantity, 0)} 件</small></td></tr>; })}</tbody></table>
              {!filteredOrders.length && <div className="empty-state"><span>⌕</span><strong>找不到符合條件的訂單</strong><p>請調整日期、狀態或搜尋關鍵字。</p></div>}
            </div>
            <div className="pagination-row"><span>第 {pageNumber} 頁 · 本頁 {filteredOrders.length} 筆</span><div><button type="button" onClick={goPrevious} disabled={!pageHistory.length || loading}>上一頁</button><button type="button" onClick={goNext} disabled={!snapshot.nextToken || loading}>下一頁</button></div></div>
          </section>

          <details id="connection" className="connection-details">
            <summary><span><strong>Amazon API 串接與能力邊界</strong><small>SP-API、Ads API、圖片公開來源與安全設定</small></span><i>＋</i></summary>
            <div className="connection-grid"><article><span>1</span><div><strong>SP-API Private Seller App</strong><p>加入 Orders、Product Listing、Amazon Fulfillment 角色，並為各區域 self-authorize。</p></div></article><article><span>2</span><div><strong>Mac Keychain Secrets</strong><p>LWA client、refresh token 與 Seller ID 只以加密密文保存在這台 Mac。</p></div></article><article><span>3</span><div><strong>圖片公開來源</strong><p>拖拉檔案先在 Mac 驗證；要一鍵送圖可連自己的 R2 公開 HTTPS 網域。</p></div></article><article><span>4</span><div><strong>Amazon Ads 獨立授權</strong><p>Ads 必須另外申請 Direct Advertiser、建立 LWA client 與每站 Profile ID，不能沿用 SP-API。</p></div></article></div>
          </details>
        </main>
        <footer className="os-footer"><span>AMZ.API · GitHub UI / Local Key</span><span>FBA only · No FBM · No buyer PII</span></footer>
      </div>

      <nav className="mobile-core-nav" aria-label="核心區域"><button type="button" onClick={() => scrollTo("planning-zone")}><span>◎</span>策劃</button><button type="button" onClick={() => scrollTo("product-zone")}><span>Aa</span>產品</button><button type="button" onClick={() => scrollTo("pricing-zone")}><span>$</span>價格</button></nav>

      {selectedOrder && <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrder(null); }}><aside className="order-drawer" role="dialog" aria-modal="true" aria-labelledby="order-drawer-title"><div className="drawer-header"><div><p className="eyebrow">ORDER DETAIL</p><h2 id="order-drawer-title">{selectedOrder.orderId}</h2></div><button type="button" onClick={() => setSelectedOrder(null)} autoFocus aria-label="關閉訂單明細">×</button></div><div className="drawer-summary"><div><span>總金額</span><strong>{formatMoney(selectedOrder.total)}</strong></div><span className={`status-pill ${statusTone(selectedOrder.fulfillmentStatus)}`}>{STATUS_LABELS[selectedOrder.fulfillmentStatus] || selectedOrder.fulfillmentStatus}</span></div><dl className="order-facts"><div><dt>建立時間</dt><dd>{formatDateTime(selectedOrder.createdTime)}</dd></div><div><dt>最後更新</dt><dd>{formatDateTime(selectedOrder.lastUpdatedTime)}</dd></div><div><dt>最晚出貨</dt><dd>{formatDateTime(selectedOrder.shipBy)}</dd></div></dl><div className="drawer-items"><h3>商品明細</h3>{selectedOrder.items.map((item) => <article key={item.orderItemId}><div className="item-image" aria-hidden="true">{item.title.slice(0, 1)}</div><div><strong>{item.title}</strong><p>{item.sellerSku} · {item.asin}</p><small>{formatMoney(item.unitPrice)} × {item.quantity}</small></div><strong>{formatMoney(item.lineTotal)}</strong></article>)}</div><div className="privacy-footnote">只顯示營運欄位，不顯示姓名、Email、電話或地址。</div></aside></div>}

      {openTool === "ads" && <AdsDrawer initialMarketplaceId={marketplaceId} onClose={() => setOpenTool(null)} />}
      {openTool === "restock" && <ReplenishmentDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "copy" && <SkuOperationsDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "images" && <ImageWorkspaceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "price" && <PriceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {openTool === "promotion" && <PromotionCenterDrawer initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onClose={() => setOpenTool(null)} />}
      {commandOpen && <SkuCommandCenter initialMarketplaceId={marketplaceId} initialSellerSku={globalSku} onContextResolved={resolveGlobalContext} onLaunch={(tool) => launch(tool)} onClose={() => setCommandOpen(false)} />}
    </div>
  );
}
