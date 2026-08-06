"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Tool = "restock" | "copy" | "images" | "price" | "promotion";
type SupplyRoute = "DIRECT_FBA" | "AWD_TO_FBA";

type Money = { amount: number; currencyCode: string };

type ProductProfile = {
  marketplaceId: string;
  sellerSku: string;
  displayName: string | null;
  asin: string | null;
  fnSku: string | null;
  casePack: number;
  cartonsPerPallet: number;
  leadTimeDays: number;
  safetyDays: number;
  targetDays: number;
  supplyRoute: SupplyRoute;
  awdBufferDays: number;
  shelfLifeDays: number | null;
  minimumRemainingDays: number | null;
  factory: string | null;
  notes: string | null;
  settingsConfigured: boolean;
  lastSyncedAt: string | null;
  updatedAt: string | null;
};

type ProductMasterState = {
  profile: ProductProfile;
  found: boolean;
  persistence: "durable" | "demo" | "unavailable";
};

type Source<T> = {
  data: T | null;
  error: { code: string; message: string; requestId: string | null } | null;
};

type CommandTask = {
  id: string;
  title: string;
  detail: string;
  automation: "automatic" | "one_click" | "manual";
  severity: "info" | "warning" | "critical";
  tool: Tool | null;
};

type CommandSnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  fetchedAt: string;
  profile: ProductMasterState;
  price: Source<{
    title: string;
    asin: string | null;
    status: string[];
    standardPrice: Money | null;
    effectivePrice: Money | null;
    discountedPrice: { price: Money; startAt: string | null; endAt: string | null } | null;
    hasAutomatedPricing: boolean;
  }>;
  content: Source<{
    title: string;
    bulletPoints: string[];
    ingredients: string;
    issues: Array<{ severity: string; message: string }>;
  }>;
  images: Source<{
    images: Array<{ label: string; url: string | null }>;
  }>;
  subscribeSave: Source<{
    found: boolean;
    sellerFundedBaseDiscount: number | null;
    sellerFundedTieredDiscount: number | null;
    subscriptions: number | null;
  }>;
  restock: Source<{
    action: "RESTOCK_NOW" | "WATCH" | "HEALTHY" | "NO_DEMAND";
    daysOfCover: number | null;
    recommendedUnits: number;
    casePack: number;
    forecastStockoutAt: string | null;
    inventory: {
      fulfillable: number;
      inventoryPosition: number;
      unfulfillable: number;
      researching: number;
    };
    demand: { averageDailyUnits: number; units: number; partial: boolean };
  }>;
  tasks: CommandTask[];
  summary: {
    score: number;
    sourceReady: number;
    sourceTotal: number;
    critical: number;
    warning: number;
    manual: number;
    overall: "ready" | "attention" | "critical";
  };
  notice: string;
};

type ProfileDraft = {
  casePack: string;
  cartonsPerPallet: string;
  leadTimeDays: string;
  safetyDays: string;
  targetDays: string;
  supplyRoute: SupplyRoute;
  awdBufferDays: string;
  shelfLifeDays: string;
  minimumRemainingDays: string;
  factory: string;
  notes: string;
};

const MARKETPLACES = [
  { id: "ATVPDKIKX0DER", label: "US · 美國站", sample: "AFA-TRKY-4OZ" },
  { id: "A1VC38T7YXB528", label: "JP · 日本站", sample: "AFA100-JP" },
  { id: "A2EUQ1WTGCTBG2", label: "CA · 加拿大站", sample: "AFA-TRKY-4OZ" },
  { id: "A19VAU5U5O7RUS", label: "SG · 新加坡站", sample: "AFA-TRKY-4OZ" },
  { id: "A39IBJ37TRP1C6", label: "AU · 澳洲站", sample: "AFA-TRKY-4OZ" },
  { id: "A1F83G8C2ARO7P", label: "UK · 英國站", sample: "AFA-TRKY-4OZ" },
  { id: "A1PA6795UKMFR9", label: "DE · 德國站", sample: "AFA-TRKY-4OZ" },
];

const TOOL_LABELS: Record<Tool, { label: string; symbol: string }> = {
  restock: { label: "補貨", symbol: "↗" },
  copy: { label: "文案", symbol: "Aa" },
  images: { label: "圖片", symbol: "▧" },
  price: { label: "定價與訂閱", symbol: "$" },
  promotion: { label: "促銷", symbol: "%" },
};

const AUTOMATION_LABELS = {
  automatic: "自動",
  one_click: "一鍵",
  manual: "需人工",
};

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

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return "—";
  }
  return new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function profileDraft(profile: ProductProfile): ProfileDraft {
  return {
    casePack: String(profile.casePack),
    cartonsPerPallet: String(profile.cartonsPerPallet),
    leadTimeDays: String(profile.leadTimeDays),
    safetyDays: String(profile.safetyDays),
    targetDays: String(profile.targetDays),
    supplyRoute: profile.supplyRoute,
    awdBufferDays: String(profile.awdBufferDays),
    shelfLifeDays: profile.shelfLifeDays ? String(profile.shelfLifeDays) : "",
    minimumRemainingDays: profile.minimumRemainingDays
      ? String(profile.minimumRemainingDays)
      : "",
    factory: profile.factory ?? "",
    notes: profile.notes ?? "",
  };
}

function parseInteger(value: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export default function SkuCommandCenter({
  initialMarketplaceId,
  initialSellerSku = "",
  onContextResolved,
  onLaunch,
  onClose,
}: {
  initialMarketplaceId: string;
  initialSellerSku?: string;
  onContextResolved?: (marketplaceId: string, sellerSku: string) => void;
  onLaunch: (tool: Tool) => void;
  onClose: () => void;
}) {
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId);
  const [skuInput, setSkuInput] = useState(initialSellerSku);
  const [snapshot, setSnapshot] = useState<CommandSnapshot | null>(null);
  const [recent, setRecent] = useState<ProductProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const autoLookupRef = useRef(false);
  const profileRef = useRef<HTMLDetailsElement | null>(null);
  const marketplace =
    MARKETPLACES.find((item) => item.id === marketplaceId) ?? MARKETPLACES[0];

  const loadRecent = useCallback(async (query = "", marketplaceOverride?: string) => {
    setRecentLoading(true);
    try {
      const params = new URLSearchParams({
        marketplaceId: marketplaceOverride ?? marketplaceId,
        limit: "8",
      });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/product-master?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        items?: ProductProfile[];
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message || "無法讀取商品主檔。");
      setRecent(payload.items ?? []);
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, [marketplaceId]);

  const lookup = useCallback(async (event?: FormEvent, explicitSku?: string) => {
    event?.preventDefault();
    const sellerSku = (explicitSku ?? skuInput).trim();
    if (!sellerSku) {
      setError("請輸入完整 Seller SKU。");
      return;
    }
    setSkuInput(sellerSku);
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    try {
      const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
      const response = await fetch(`/api/sp-api/sku-command?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as CommandSnapshot | { message?: string };
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message || "SKU 整合掃描未完成。");
      }
      const next = payload as CommandSnapshot;
      setSnapshot(next);
      setDraft(profileDraft(next.profile.profile));
      onContextResolved?.(marketplaceId, next.sellerSku);
      void loadRecent();
    } catch (requestError) {
      setSnapshot(null);
      setDraft(null);
      setError(requestError instanceof Error ? requestError.message : "SKU 整合掃描未完成。");
    } finally {
      setLoading(false);
    }
  }, [loadRecent, marketplaceId, onContextResolved, skuInput]);

  useEffect(() => {
    if (autoLookupRef.current) return;
    autoLookupRef.current = true;
    const initialLoad = window.setTimeout(() => {
      if (initialSellerSku.trim()) void lookup(undefined, initialSellerSku);
      else void loadRecent();
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [initialSellerSku, loadRecent, lookup]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading && !saving) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [loading, onClose, saving]);

  const profileError = useMemo(() => {
    if (!draft) return null;
    const casePack = parseInteger(draft.casePack, 1, 10_000);
    const cartons = parseInteger(draft.cartonsPerPallet, 1, 1_000);
    const lead = parseInteger(draft.leadTimeDays, 1, 120);
    const safety = parseInteger(draft.safetyDays, 0, 90);
    const target = parseInteger(draft.targetDays, 14, 180);
    const buffer = parseInteger(draft.awdBufferDays, 0, 60);
    if ([casePack, cartons, lead, safety, target, buffer].some((item) => item === null)) {
      return "箱入數、整板箱數與天數設定超出允許範圍。";
    }
    if (draft.supplyRoute === "AWD_TO_FBA" && marketplaceId !== "ATVPDKIKX0DER") {
      return "AWD→FBA 目前只支援美國站。";
    }
    const effectiveLead = lead! + (draft.supplyRoute === "AWD_TO_FBA" ? buffer! : 0);
    if (target! < effectiveLead + safety!) {
      return "目標庫存必須涵蓋補貨交期、AWD 緩衝與安全庫存。";
    }
    const shelf = draft.shelfLifeDays
      ? parseInteger(draft.shelfLifeDays, 1, 3_650)
      : null;
    const remaining = draft.minimumRemainingDays
      ? parseInteger(draft.minimumRemainingDays, 1, 3_650)
      : null;
    if ((draft.shelfLifeDays && shelf === null) || (draft.minimumRemainingDays && remaining === null)) {
      return "效期必須是 1–3,650 天的整數。";
    }
    if (shelf && remaining && remaining > shelf) {
      return "到倉最低剩餘效期不能大於總效期。";
    }
    if (draft.factory.length > 80 || draft.notes.length > 500) {
      return "工廠最多 80 字，備註最多 500 字。";
    }
    return null;
  }, [draft, marketplaceId]);

  const saveProfile = async () => {
    if (!snapshot || !draft || profileError) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const response = await fetch("/api/product-master", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplaceId,
          sellerSku: snapshot.sellerSku,
          displayName: snapshot.profile.profile.displayName,
          asin: snapshot.profile.profile.asin,
          fnSku: snapshot.profile.profile.fnSku,
          casePack: Number(draft.casePack),
          cartonsPerPallet: Number(draft.cartonsPerPallet),
          leadTimeDays: Number(draft.leadTimeDays),
          safetyDays: Number(draft.safetyDays),
          targetDays: Number(draft.targetDays),
          supplyRoute: draft.supplyRoute,
          awdBufferDays: Number(draft.awdBufferDays),
          shelfLifeDays: draft.shelfLifeDays ? Number(draft.shelfLifeDays) : null,
          minimumRemainingDays: draft.minimumRemainingDays
            ? Number(draft.minimumRemainingDays)
            : null,
          factory: draft.factory,
          notes: draft.notes,
        }),
      });
      const payload = (await response.json()) as ProductMasterState | { message?: string };
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message || "商品主檔尚未儲存。");
      }
      await lookup(undefined, snapshot.sellerSku);
      setSaveMessage("已儲存，補貨建議已用新設定重算。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "商品主檔尚未儲存。");
    } finally {
      setSaving(false);
    }
  };

  const openProfile = () => {
    if (!profileRef.current) return;
    profileRef.current.open = true;
    profileRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const launchTool = (tool: Tool) => {
    if (snapshot) onContextResolved?.(marketplaceId, snapshot.sellerSku);
    onLaunch(tool);
  };

  const productName =
    snapshot?.profile.profile.displayName ??
    snapshot?.price.data?.title ??
    snapshot?.content.data?.title ??
    "Amazon FBA 商品";
  const imageCount = snapshot?.images.data?.images.filter((item) => item.url).length ?? null;
  const bulletCount = snapshot?.content.data?.bulletPoints.filter(Boolean).length ?? null;
  const casePack = draft ? Number(draft.casePack) || 0 : 0;
  const cartonsPerPallet = draft ? Number(draft.cartonsPerPallet) || 0 : 0;
  const unitsPerPallet = casePack * cartonsPerPallet;

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading && !saving) onClose();
      }}
    >
      <aside
        className="order-drawer command-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-center-title"
      >
        <div className="drawer-header command-header">
          <div>
            <p className="eyebrow">ONE SKU · ONE SOURCE OF TRUTH</p>
            <h2 id="command-center-title">SKU 指揮中心</h2>
          </div>
          <button type="button" onClick={onClose} disabled={loading || saving} aria-label="關閉 SKU 指揮中心">×</button>
        </div>
        <p className="price-intro">一次整合商品主檔、FBA 庫存、補貨、文案、圖片、價格、促銷與訂閱；各區不必重複查詢。</p>

        <form className="command-search" onSubmit={lookup}>
          <select
            value={marketplaceId}
            onChange={(event) => {
              const nextMarketplaceId = event.target.value;
              setMarketplaceId(nextMarketplaceId);
              setSnapshot(null);
              setDraft(null);
              setError(null);
              setRecent([]);
              void loadRecent("", nextMarketplaceId);
            }}
            disabled={loading || saving}
            aria-label="Amazon 站點"
          >
            {MARKETPLACES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <label>
            <span>⌕</span>
            <input
              value={skuInput}
              onChange={(event) => {
                setSkuInput(event.target.value);
                setError(null);
              }}
              placeholder={`Seller SKU，例如 ${marketplace.sample}`}
              maxLength={40}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              disabled={loading || saving}
            />
          </label>
          <button type="submit" disabled={loading || saving || !skuInput.trim()}>{loading ? "整合掃描中…" : "一鍵掃描"}</button>
        </form>

        {!snapshot && !loading && recent.length > 0 && (
          <section className="command-recent">
            <div><strong>最近商品</strong><small>點一下直接掃描</small></div>
            <div>{recent.map((item) => (
              <button key={`${item.marketplaceId}-${item.sellerSku}`} type="button" onClick={() => void lookup(undefined, item.sellerSku)}>
                <span>{(item.displayName ?? item.sellerSku).slice(0, 1)}</span><div><strong>{item.displayName ?? item.sellerSku}</strong><small>{item.sellerSku}{item.asin ? ` · ${item.asin}` : ""}</small></div><i>›</i>
              </button>
            ))}</div>
          </section>
        )}
        {!snapshot && !loading && !recent.length && !error && (
          <section className="command-empty"><span>✦</span><strong>{recentLoading ? "正在讀取商品主檔…" : "輸入一個 SKU 開始"}</strong><p>首次掃描會自動建立中央商品身分；補貨規格由你儲存一次，之後全部共用。</p></section>
        )}
        {error && <div className="price-error" role="alert">{error}</div>}

        {snapshot && (
          <>
            <section className={`command-hero ${snapshot.summary.overall}`}>
              <div className="command-product-avatar" aria-hidden="true">{productName.slice(0, 1)}</div>
              <div className="command-product-copy"><span>{snapshot.mode === "live" ? "LIVE" : "DEMO"} · {marketplace.label}</span><h3>{productName}</h3><p>{snapshot.sellerSku} · {snapshot.profile.profile.asin ?? "無 ASIN"}{snapshot.profile.profile.fnSku ? ` · ${snapshot.profile.profile.fnSku}` : ""}</p></div>
              <div className="command-score"><strong>{snapshot.summary.score}</strong><span>%</span><small>{snapshot.summary.sourceReady}/{snapshot.summary.sourceTotal} 資料源</small></div>
            </section>

            <section className="command-kpis" aria-label="SKU 核心狀態">
              <article><span>標準售價</span><strong>{formatMoney(snapshot.price.data?.standardPrice ?? null)}</strong><small>{snapshot.price.data?.hasAutomatedPricing ? "已連結自動定價" : snapshot.price.data?.discountedPrice ? `促銷 ${formatMoney(snapshot.price.data.discountedPrice.price)}` : "無促銷覆蓋"}</small></article>
              <article><span>FBA 可售天數</span><strong>{snapshot.restock.data?.daysOfCover === null || snapshot.restock.data?.daysOfCover === undefined ? "—" : snapshot.restock.data.daysOfCover.toFixed(1)}</strong><small>可售 {snapshot.restock.data?.inventory.fulfillable ?? "—"} 件</small></article>
              <article className={snapshot.restock.data?.recommendedUnits ? "attention" : ""}><span>建議補貨</span><strong>{snapshot.restock.data?.recommendedUnits.toLocaleString() ?? "—"}</strong><small>{snapshot.restock.data?.forecastStockoutAt ? `預估缺貨 ${formatDate(snapshot.restock.data.forecastStockoutAt)}` : "尚無缺貨日"}</small></article>
              <article><span>內容完整度</span><strong>{bulletCount === null ? "—" : `${bulletCount}/5`}</strong><small>{snapshot.content.data?.ingredients ? "成分已填" : "成分待確認"} · 圖片 {imageCount ?? "—"} 張</small></article>
              <article title="「目前有效訂閱」是 Amazon listOffers 的查詢快照，不是期間新增、歷史累計、配送次數或唯一顧客數。"><span>Subscribe &amp; Save</span><strong>{snapshot.subscribeSave.data?.found ? `${snapshot.subscribeSave.data.sellerFundedBaseDiscount ?? 0}%` : "—"}</strong><small>{snapshot.subscribeSave.data?.found ? `Tiered ${snapshot.subscribeSave.data.sellerFundedTieredDiscount ?? 0}% · 目前有效訂閱 ${formatCount(snapshot.subscribeSave.data.subscriptions)}` : "Amazon 未回傳 offer"}</small></article>
            </section>

            <section className="command-actions">
              <div className="command-section-heading"><div><p className="eyebrow">PRIORITY QUEUE</p><h3>現在要處理的事</h3></div><span>{snapshot.summary.critical ? `${snapshot.summary.critical} 緊急` : snapshot.summary.warning ? `${snapshot.summary.warning} 注意` : "已掃描"}</span></div>
              <div className="command-task-list">{snapshot.tasks.map((task) => (
                <article key={task.id} className={`command-task severity-${task.severity} automation-${task.automation}`}>
                  <span className="command-task-icon">{task.severity === "critical" ? "!" : task.severity === "warning" ? "•" : "✓"}</span>
                  <div><div><strong>{task.title}</strong><span className={`automation-badge ${task.automation}`}>{AUTOMATION_LABELS[task.automation]}</span></div><p>{task.detail}</p></div>
                  {task.tool ? <button type="button" onClick={() => launchTool(task.tool!)}>處理 <i>›</i></button> : task.id === "profile-settings" ? <button type="button" onClick={openProfile}>設定 <i>›</i></button> : null}
                </article>
              ))}</div>
            </section>

            <section className="command-tool-grid" aria-label="快速開啟 SKU 工具">
              {(Object.keys(TOOL_LABELS) as Tool[]).map((tool) => (
                <button key={tool} type="button" onClick={() => launchTool(tool)}><span>{TOOL_LABELS[tool].symbol}</span><strong>{TOOL_LABELS[tool].label}</strong><i>›</i></button>
              ))}
            </section>

            {draft && (
              <details className="command-profile" ref={profileRef} open={!snapshot.profile.profile.settingsConfigured || Boolean(saveMessage)}>
                <summary><div><p className="eyebrow">PRODUCT MASTER</p><strong>商品主檔與補貨預設</strong><small>{snapshot.profile.profile.settingsConfigured ? "已保存 · 所有補貨工具共用" : "首次設定後自動套用"}</small></div><span>{snapshot.profile.persistence === "durable" ? "Mac 已保存" : snapshot.profile.persistence === "demo" ? "Demo" : "未連線"}</span><i>＋</i></summary>
                <div className="command-profile-body">
                  <div className="automation-summary compact"><span className="automation-badge automatic">自動</span><p>SKU、ASIN、FNSKU 與商品名稱由 Amazon 同步。</p><span className="automation-badge one_click">一鍵</span><p>箱規與交期只需儲存一次。</p><span className="automation-badge manual">需人工</span><p>效期、工廠與實體箱板仍由你確認。</p></div>
                  <div className="profile-route-selector">
                    <button type="button" className={draft.supplyRoute === "DIRECT_FBA" ? "active" : ""} onClick={() => setDraft({ ...draft, supplyRoute: "DIRECT_FBA" })}><span>Direct</span><strong>直接送 FBA</strong><small>不加 AWD 轉倉緩衝</small></button>
                    <button type="button" className={draft.supplyRoute === "AWD_TO_FBA" ? "active" : ""} onClick={() => setDraft({ ...draft, supplyRoute: "AWD_TO_FBA" })} disabled={marketplaceId !== "ATVPDKIKX0DER"}><span>AWD</span><strong>AWD → FBA</strong><small>自動把轉倉延遲納入交期</small></button>
                  </div>
                  <div className="profile-field-grid">
                    <label><span>每箱入數</span><div><input value={draft.casePack} onChange={(event) => setDraft({ ...draft, casePack: event.target.value })} inputMode="numeric" /><b>件</b></div></label>
                    <label><span>每板箱數</span><div><input value={draft.cartonsPerPallet} onChange={(event) => setDraft({ ...draft, cartonsPerPallet: event.target.value })} inputMode="numeric" /><b>箱</b></div></label>
                    <label><span>基本交期</span><div><input value={draft.leadTimeDays} onChange={(event) => setDraft({ ...draft, leadTimeDays: event.target.value })} inputMode="numeric" /><b>天</b></div></label>
                    <label><span>安全庫存</span><div><input value={draft.safetyDays} onChange={(event) => setDraft({ ...draft, safetyDays: event.target.value })} inputMode="numeric" /><b>天</b></div></label>
                    <label><span>目標庫存</span><div><input value={draft.targetDays} onChange={(event) => setDraft({ ...draft, targetDays: event.target.value })} inputMode="numeric" /><b>天</b></div></label>
                    <label className={draft.supplyRoute === "AWD_TO_FBA" ? "" : "muted-field"}><span>AWD 轉倉緩衝</span><div><input value={draft.awdBufferDays} onChange={(event) => setDraft({ ...draft, awdBufferDays: event.target.value })} inputMode="numeric" disabled={draft.supplyRoute !== "AWD_TO_FBA"} /><b>天</b></div></label>
                    <label><span>商品總效期</span><div><input value={draft.shelfLifeDays} onChange={(event) => setDraft({ ...draft, shelfLifeDays: event.target.value })} inputMode="numeric" placeholder="選填" /><b>天</b></div></label>
                    <label><span>到倉最低剩餘</span><div><input value={draft.minimumRemainingDays} onChange={(event) => setDraft({ ...draft, minimumRemainingDays: event.target.value })} inputMode="numeric" placeholder="選填" /><b>天</b></div></label>
                  </div>
                  <div className="profile-derived"><span>整板自動換算</span><strong>{unitsPerPallet > 0 ? `${unitsPerPallet.toLocaleString()} 件／板` : "—"}</strong><small>{casePack || "—"} 件 × {cartonsPerPallet || "—"} 箱</small></div>
                  <div className="profile-text-grid"><label><span>工廠／來源</span><input value={draft.factory} onChange={(event) => setDraft({ ...draft, factory: event.target.value })} placeholder="例如 Taiwan、Vietnam" maxLength={80} /></label><label><span>內部備註</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="只保存在公司商品主檔，不送 Amazon" maxLength={500} /></label></div>
                  {draft.supplyRoute === "AWD_TO_FBA" && Number(draft.awdBufferDays) < 13 && <div className="price-warning compact"><strong>AWD 緩衝可能偏短</strong><p>依你過去碰到的 13–20+ 天轉倉延遲，建議至少保留 20 天，再依實際資料調整。</p></div>}
                  {profileError && <small className="field-error command-profile-error">{profileError}</small>}
                  {saveMessage && <div className="command-save-success">✓ {saveMessage}</div>}
                  <button className="price-primary-button" type="button" onClick={saveProfile} disabled={saving || Boolean(profileError)}>{saving ? "儲存並重算中…" : "一鍵儲存並重算補貨"}</button>
                </div>
              </details>
            )}
            <p className="command-footnote">最後掃描 {formatDate(snapshot.fetchedAt)} · {snapshot.notice}</p>
          </>
        )}
      </aside>
    </div>
  );
}
