"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MARKETPLACES as MARKETPLACE_METADATA,
  marketplaceByCode,
  marketplaceById,
  marketplaceSelectLabel,
  type MarketplaceCode,
} from "../../../shared/marketplaces";

type RestockPlan = {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  fnSku: string | null;
  title: string;
  targetDays: number;
  leadTimeDays: number;
  safetyDays: number;
  casePack: number;
  inventory: {
    fulfillable: number;
    reserved: number;
    inboundWorking: number;
    inboundShipped: number;
    inboundReceiving: number;
    unfulfillable: number;
    researching: number;
    inventoryPosition: number;
  };
  demand: {
    lookbackDays: number;
    units: number;
    averageDailyUnits: number;
    ordersScanned: number;
    partial: boolean;
  };
  daysOfCover: number | null;
  reorderPoint: number;
  recommendedUnits: number;
  forecastStockoutAt: string | null;
  action: "RESTOCK_NOW" | "WATCH" | "HEALTHY" | "NO_DEMAND";
  fetchedAt: string;
  notice: string;
  skillConnected: boolean;
};

type SupplyRoute = "DIRECT_FBA" | "AWD_TO_FBA";

type ProductMasterState = {
  profile: {
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
  };
  found: boolean;
  persistence: "durable" | "demo" | "unavailable";
};

type RestockAssumptions = {
  targetDays: number;
  leadTimeDays: number;
  safetyDays: number;
  casePack: number;
  cartonsPerPallet: number;
  supplyRoute: SupplyRoute;
  awdBufferDays: number;
};

const INBOUND_URLS: Record<MarketplaceCode, string> = {
  US: "https://sellercentral.amazon.com/fba/sendtoamazon",
  JP: "https://sellercentral.amazon.co.jp/fba/sendtoamazon",
  CA: "https://sellercentral.amazon.ca/fba/sendtoamazon",
  SG: "https://sellercentral.amazon.sg/fba/sendtoamazon",
  AU: "https://sellercentral.amazon.com.au/fba/sendtoamazon",
  UK: "https://sellercentral.amazon.co.uk/fba/sendtoamazon",
  DE: "https://sellercentral.amazon.de/fba/sendtoamazon",
};

const MARKETPLACES = MARKETPLACE_METADATA.map((marketplace) => ({
  ...marketplace,
  inbound: INBOUND_URLS[marketplace.code],
}));
const US_MARKETPLACE_ID = marketplaceByCode("US").id;

const ACTION_COPY: Record<RestockPlan["action"], { label: string; tone: string; detail: string }> = {
  RESTOCK_NOW: { label: "建議現在補貨", tone: "danger", detail: "現有可售天數已進入交期＋安全庫存範圍。" },
  WATCH: { label: "準備補貨", tone: "warning", detail: "尚未立即缺貨，但已低於目標庫存天數。" },
  HEALTHY: { label: "庫存健康", tone: "success", detail: "目前庫存覆蓋高於設定目標。" },
  NO_DEMAND: { label: "資料不足", tone: "neutral", detail: "近 30 天沒有抓到有效銷量，暫不自動建議數量。" },
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function assumptionProblem(input: RestockAssumptions): string | null {
  if (!Number.isInteger(input.targetDays) || input.targetDays < 14 || input.targetDays > 180) return "目標庫存必須是 14–180 天。";
  if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 1 || input.leadTimeDays > 120) return "基本交期必須是 1–120 天。";
  if (!Number.isInteger(input.safetyDays) || input.safetyDays < 0 || input.safetyDays > 90) return "安全庫存必須是 0–90 天。";
  if (!Number.isInteger(input.casePack) || input.casePack < 1 || input.casePack > 10_000) return "每箱入數必須是 1–10,000 件。";
  if (!Number.isInteger(input.cartonsPerPallet) || input.cartonsPerPallet < 1 || input.cartonsPerPallet > 1_000) return "每板箱數必須是 1–1,000 箱。";
  if (!Number.isInteger(input.awdBufferDays) || input.awdBufferDays < 0 || input.awdBufferDays > 60) return "AWD 轉倉緩衝必須是 0–60 天。";
  const effectiveLead = input.leadTimeDays + (input.supplyRoute === "AWD_TO_FBA" ? input.awdBufferDays : 0);
  if (input.targetDays < effectiveLead + input.safetyDays) return "目標庫存不能小於基本交期＋AWD 緩衝＋安全庫存。";
  return null;
}

export default function ReplenishmentDrawer({
  initialMarketplaceId,
  initialSellerSku = "",
  onContextResolved,
  onClose,
}: {
  initialMarketplaceId: string;
  initialSellerSku?: string;
  onContextResolved?: (marketplaceId: string, sellerSku: string) => void;
  onClose: () => void;
}) {
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId);
  const [sku, setSku] = useState(initialSellerSku);
  const [targetDays, setTargetDays] = useState("60");
  const [leadTimeDays, setLeadTimeDays] = useState("35");
  const [safetyDays, setSafetyDays] = useState("14");
  const [casePack, setCasePack] = useState("1");
  const [cartonsPerPallet, setCartonsPerPallet] = useState("1");
  const [supplyRoute, setSupplyRoute] = useState<SupplyRoute>("DIRECT_FBA");
  const [awdBufferDays, setAwdBufferDays] = useState("20");
  const [plan, setPlan] = useState<RestockPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileState, setProfileState] = useState<ProductMasterState | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoLookupRef = useRef(false);
  const loadedProfileKeyRef = useRef("");
  const baseMarketplace = marketplaceById(marketplaceId) ?? MARKETPLACE_METADATA[0];
  const marketplace = {
    ...baseMarketplace,
    inbound: INBOUND_URLS[baseMarketplace.code],
  };
  const action = useMemo(() => (plan ? ACTION_COPY[plan.action] : null), [plan]);
  const recommendedCartons = plan
    ? Math.ceil(plan.recommendedUnits / Math.max(1, plan.casePack))
    : 0;
  const recommendedPallets = Math.ceil(
    recommendedCartons / Math.max(1, Number(cartonsPerPallet) || 1),
  );
  const assumptionsError = useMemo(() => {
    return assumptionProblem({
      targetDays: Number(targetDays),
      leadTimeDays: Number(leadTimeDays),
      safetyDays: Number(safetyDays),
      casePack: Number(casePack),
      cartonsPerPallet: Number(cartonsPerPallet),
      supplyRoute,
      awdBufferDays: Number(awdBufferDays),
    });
  }, [awdBufferDays, casePack, cartonsPerPallet, leadTimeDays, safetyDays, supplyRoute, targetDays]);

  const invalidatePlan = () => {
    setPlan(null);
    setCopied(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose]);

  const lookup = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const sellerSku = sku.trim();
    if (!sellerSku) return setError("請輸入完整 Seller SKU。");
    setLoading(true);
    setError(null);
    setCopied(false);
    setProfileMessage(null);
    try {
      let assumptions: RestockAssumptions = {
        targetDays: Number(targetDays),
        leadTimeDays: Number(leadTimeDays),
        safetyDays: Number(safetyDays),
        casePack: Number(casePack),
        cartonsPerPallet: Number(cartonsPerPallet),
        supplyRoute,
        awdBufferDays: Number(awdBufferDays),
      };
      const profileKey = `${marketplaceId}:${sellerSku}`;
      if (loadedProfileKeyRef.current !== profileKey) {
        setProfileLoading(true);
        try {
          const profileParams = new URLSearchParams({ marketplaceId, sku: sellerSku });
          const profileResponse = await fetch(`/api/product-master?${profileParams}`, { cache: "no-store" });
          const profilePayload = (await profileResponse.json()) as ProductMasterState | { message?: string };
          if (!profileResponse.ok) {
            throw new Error(
              (profilePayload as { message?: string }).message ||
                "目前無法讀取此 SKU 的商品主檔。",
            );
          }
          const nextProfile = profilePayload as ProductMasterState;
          setProfileState(nextProfile);
          loadedProfileKeyRef.current = profileKey;
          if (nextProfile.profile.settingsConfigured) {
            assumptions = {
              targetDays: nextProfile.profile.targetDays,
              leadTimeDays: nextProfile.profile.leadTimeDays,
              safetyDays: nextProfile.profile.safetyDays,
              casePack: nextProfile.profile.casePack,
              cartonsPerPallet: nextProfile.profile.cartonsPerPallet,
              supplyRoute: nextProfile.profile.supplyRoute,
              awdBufferDays: nextProfile.profile.awdBufferDays,
            };
            setTargetDays(String(assumptions.targetDays));
            setLeadTimeDays(String(assumptions.leadTimeDays));
            setSafetyDays(String(assumptions.safetyDays));
            setCasePack(String(assumptions.casePack));
            setCartonsPerPallet(String(assumptions.cartonsPerPallet));
            setSupplyRoute(assumptions.supplyRoute);
            setAwdBufferDays(String(assumptions.awdBufferDays));
            setProfileMessage("已自動套用商品主檔補貨預設。");
          }
        } catch (profileError) {
          setProfileState(null);
          throw profileError;
        } finally {
          setProfileLoading(false);
        }
      }
      const problem = assumptionProblem(assumptions);
      if (problem) throw new Error(problem);
      if (assumptions.supplyRoute === "AWD_TO_FBA" && marketplaceId !== US_MARKETPLACE_ID) {
        throw new Error("AWD→FBA 目前只支援美國站。");
      }
      const effectiveLeadTime =
        assumptions.leadTimeDays +
        (assumptions.supplyRoute === "AWD_TO_FBA"
          ? assumptions.awdBufferDays
          : 0);
      const params = new URLSearchParams({
        marketplaceId,
        sku: sellerSku,
        targetDays: String(assumptions.targetDays),
        leadTimeDays: String(effectiveLeadTime),
        safetyDays: String(assumptions.safetyDays),
        casePack: String(assumptions.casePack),
      });
      const response = await fetch(`/api/sp-api/replenishment-plan?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as RestockPlan | { message?: string; requestId?: string | null };
      if (!response.ok) {
        const problem = payload as { message?: string; requestId?: string | null };
        throw new Error(`${problem.message || "目前無法建立補貨建議。"}${problem.requestId ? `（Request ID: ${problem.requestId}）` : ""}`);
      }
      const nextPlan = payload as RestockPlan;
      setPlan(nextPlan);
      onContextResolved?.(marketplaceId, nextPlan.sellerSku);
    } catch (requestError) {
      setPlan(null);
      setError(requestError instanceof Error ? requestError.message : "目前無法建立補貨建議。");
    } finally {
      setLoading(false);
    }
  }, [awdBufferDays, casePack, cartonsPerPallet, leadTimeDays, marketplaceId, onContextResolved, safetyDays, sku, supplyRoute, targetDays]);

  useEffect(() => {
    if (autoLookupRef.current || !initialSellerSku.trim()) return;
    autoLookupRef.current = true;
    void lookup();
  }, [initialSellerSku, lookup]);

  const copyPlan = async () => {
    if (!plan) return;
    const text = [
      `${marketplaceSelectLabel(marketplace)} FBA 補貨建議`,
      `SKU: ${plan.sellerSku}`,
      `建議數量: ${plan.recommendedUnits}`,
      `整箱／整板: ${recommendedCartons} 箱／約 ${recommendedPallets} 板`,
      `可售庫存: ${plan.inventory.fulfillable}`,
      `在途庫存: ${plan.inventory.inboundWorking + plan.inventory.inboundShipped + plan.inventory.inboundReceiving}`,
      `近 ${plan.demand.lookbackDays} 天銷量: ${plan.demand.units}`,
      `平均日銷: ${plan.demand.averageDailyUnits.toFixed(2)}`,
      `預估缺貨日: ${formatDate(plan.forecastStockoutAt)}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  const saveProfile = async () => {
    const sellerSku = plan?.sellerSku ?? sku.trim();
    if (!sellerSku || assumptionsError) return;
    setProfileSaving(true);
    setError(null);
    setProfileMessage(null);
    try {
      const response = await fetch("/api/product-master", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplaceId,
          sellerSku,
          displayName: plan?.title ?? profileState?.profile.displayName ?? null,
          asin: plan?.asin ?? profileState?.profile.asin ?? null,
          fnSku: plan?.fnSku ?? profileState?.profile.fnSku ?? null,
          casePack: Number(casePack),
          cartonsPerPallet: Number(cartonsPerPallet),
          leadTimeDays: Number(leadTimeDays),
          safetyDays: Number(safetyDays),
          targetDays: Number(targetDays),
          supplyRoute,
          awdBufferDays: Number(awdBufferDays),
          shelfLifeDays: profileState?.profile.shelfLifeDays ?? null,
          minimumRemainingDays: profileState?.profile.minimumRemainingDays ?? null,
          factory: profileState?.profile.factory ?? null,
          notes: profileState?.profile.notes ?? null,
        }),
      });
      const payload = (await response.json()) as ProductMasterState | { message?: string };
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message || "補貨預設尚未儲存。");
      }
      setProfileState(payload as ProductMasterState);
      loadedProfileKeyRef.current = `${marketplaceId}:${sellerSku}`;
      setProfileMessage("已儲存；下次開啟這個 SKU 會自動套用。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "補貨預設尚未儲存。");
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onClose();
    }}>
      <aside className="order-drawer restock-drawer" role="dialog" aria-modal="true" aria-labelledby="restock-title">
        <div className="drawer-header">
          <div><p className="eyebrow">FBA INVENTORY · ORDERS</p><h2 id="restock-title">補貨建議</h2></div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="關閉補貨建議">×</button>
        </div>
        <p className="price-intro">用 FBA 可售、reserved、三種在途庫存與近 30 天銷速，算出可審核的補貨量。</p>
        <div className="automation-summary"><span className="automation-badge automatic">自動</span><p>從全域 SKU 開啟即計算；交期、庫存與箱入數不合理時會先阻擋。</p><span className="automation-badge manual">需人工</span><p>最終箱規、placement、運輸與實體入庫仍由你確認。</p></div>

        <form className="restock-form" onSubmit={lookup}>
          <label><span>Amazon 站點</span><select value={marketplaceId} onChange={(event) => { setMarketplaceId(event.target.value); invalidatePlan(); setProfileState(null); setProfileMessage(null); loadedProfileKeyRef.current = ""; if (event.target.value !== US_MARKETPLACE_ID) setSupplyRoute("DIRECT_FBA"); }} disabled={loading}>{MARKETPLACES.map((item) => <option key={item.id} value={item.id}>{marketplaceSelectLabel(item)}</option>)}</select></label>
          <label className="restock-sku"><span>Seller SKU</span><div className="sku-search-row"><input value={sku} onChange={(event) => { setSku(event.target.value); invalidatePlan(); setProfileState(null); setProfileMessage(null); loadedProfileKeyRef.current = ""; }} placeholder={`例如 ${marketplace.sampleSku}`} autoFocus autoComplete="off" spellCheck={false} disabled={loading || profileLoading} /><button type="submit" disabled={loading || profileLoading || !sku.trim()}>{loading || profileLoading ? "自動載入與計算中…" : "一鍵計算"}</button></div></label>
          <div className="restock-route-row">
            <label><span>補貨路徑</span><select value={supplyRoute} onChange={(event) => { setSupplyRoute(event.target.value as SupplyRoute); invalidatePlan(); }} disabled={loading}><option value="DIRECT_FBA">直接送 FBA</option><option value="AWD_TO_FBA" disabled={marketplaceId !== US_MARKETPLACE_ID}>AWD → FBA（US）</option></select></label>
          </div>
          <div className="restock-assumptions">
            <label><span>目標庫存</span><div><input value={targetDays} onChange={(event) => { setTargetDays(event.target.value); invalidatePlan(); }} inputMode="numeric" /><b>天</b></div></label>
            <label><span>基本交期</span><div><input value={leadTimeDays} onChange={(event) => { setLeadTimeDays(event.target.value); invalidatePlan(); }} inputMode="numeric" /><b>天</b></div></label>
            <label><span>安全庫存</span><div><input value={safetyDays} onChange={(event) => { setSafetyDays(event.target.value); invalidatePlan(); }} inputMode="numeric" /><b>天</b></div></label>
            <label><span>每箱入數</span><div><input value={casePack} onChange={(event) => { setCasePack(event.target.value); invalidatePlan(); }} inputMode="numeric" /><b>件</b></div></label>
            <label><span>每板箱數</span><div><input value={cartonsPerPallet} onChange={(event) => { setCartonsPerPallet(event.target.value); invalidatePlan(); }} inputMode="numeric" /><b>箱</b></div></label>
            <label className={supplyRoute === "AWD_TO_FBA" ? "" : "muted-field"}><span>AWD 緩衝</span><div><input value={awdBufferDays} onChange={(event) => { setAwdBufferDays(event.target.value); invalidatePlan(); }} inputMode="numeric" disabled={supplyRoute !== "AWD_TO_FBA"} /><b>天</b></div></label>
          </div>
          {assumptionsError && <small className="field-error restock-field-error">{assumptionsError}</small>}
        </form>

        {error && <div className="price-error" role="alert">{error}</div>}

        {plan && action && (
          <>
            <section className="restock-hero">
              <div><p>{plan.title}</p><small>{plan.sellerSku} · {plan.asin ?? "無 ASIN"}</small></div>
              <span className={`listing-mode ${plan.mode}`}>{plan.mode === "live" ? "Live" : "Demo"}</span>
              <div className="restock-answer"><span>建議補貨</span><strong>{plan.recommendedUnits.toLocaleString()}</strong><b>件 · {recommendedCartons.toLocaleString()} 箱 · 約 {recommendedPallets.toLocaleString()} 板</b></div>
              <div className={`restock-status ${action.tone}`}><strong>{action.label}</strong><p>{action.detail}</p></div>
            </section>

            <section className="restock-kpis">
              <article><span>庫存天數</span><strong>{plan.daysOfCover === null ? "—" : plan.daysOfCover.toFixed(1)}</strong><small>只以目前可售估算</small></article>
              <article><span>預估缺貨</span><strong>{formatDate(plan.forecastStockoutAt)}</strong><small>依目前平均日銷</small></article>
              <article><span>平均日銷</span><strong>{plan.demand.averageDailyUnits.toFixed(2)}</strong><small>近 {plan.demand.lookbackDays} 天 · {plan.demand.units} 件</small></article>
              <article><span>再訂購點</span><strong>{plan.reorderPoint.toLocaleString()}</strong><small>交期＋安全庫存</small></article>
            </section>

            <section className="restock-inventory-card">
              <div className="restock-section-title"><div><p className="eyebrow">INVENTORY POSITION</p><h3>庫存位置</h3></div><strong>{plan.inventory.inventoryPosition.toLocaleString()} 件</strong></div>
              <div className="inventory-breakdown">
                <span><i className="available" style={{ width: `${Math.max(5, (plan.inventory.fulfillable / Math.max(1, plan.inventory.inventoryPosition)) * 100)}%` }} /></span>
                <dl>
                  <div><dt>FBA 可售</dt><dd>{plan.inventory.fulfillable}</dd></div>
                  <div><dt>Working</dt><dd>{plan.inventory.inboundWorking}</dd></div>
                  <div><dt>Shipped</dt><dd>{plan.inventory.inboundShipped}</dd></div>
                  <div><dt>Receiving</dt><dd>{plan.inventory.inboundReceiving}</dd></div>
                  <div><dt>Reserved</dt><dd>{plan.inventory.reserved}</dd></div>
                  <div><dt>Unfulfillable</dt><dd>{plan.inventory.unfulfillable}</dd></div>
                </dl>
              </div>
            </section>

            <section className="restock-formula"><strong>計算方式</strong><p>目標 {plan.targetDays} 天 × 日銷 {plan.demand.averageDailyUnits.toFixed(2)} − 庫存位置 {plan.inventory.inventoryPosition}，再依每箱 {plan.casePack} 件、每板 {cartonsPerPallet || "—"} 箱向上換算。{supplyRoute === "AWD_TO_FBA" ? `交期已加上 AWD ${awdBufferDays} 天緩衝。` : ""}</p></section>

            {plan.demand.partial && <div className="price-warning compact"><strong>銷速資料不完整，必須人工複核</strong><p>Amazon Sales API 沒有提供完整的近 30 個站點日；系統會保留建議，但不會把它當成可直接建立入庫的完整資料。</p></div>}

            <div className={`skill-connection ${plan.skillConnected ? "connected" : ""}`}><span>{plan.skillConnected ? "✓" : "↗"}</span><div><strong>{plan.skillConnected ? "補貨 Skill 接點已設定，尚未驗證" : "使用內建 FBA 補貨引擎"}</strong><p>{plan.notice}</p></div></div>

            <div className="restock-actions"><button type="button" onClick={copyPlan}>{copied ? "已複製" : "複製建議"}</button><a href={marketplace.inbound} target="_blank" rel="noreferrer">前往 Send to Amazon 建立入庫 ↗</a></div>
            {supplyRoute === "AWD_TO_FBA" && <div className="price-warning compact"><strong>AWD 可自動建立草稿，但最終確認仍保留給你</strong><p>Amazon AWD API 已能建立並輪詢 replenishment order；真正 confirm 會啟動實體庫存移動，因此本版不會無人值守確認。</p></div>}
            <div className="price-warning compact"><strong>不會自動送出實體入庫</strong><p>目前先停在「建議 → 人工審核」。Fulfillment Inbound API 可再接成入庫草稿，但確認 placement、箱規與運輸前不應自動執行。</p></div>
          </>
        )}

        <div className="drawer-api-footnote">FBA Inventory v1 · Sales v1 · Reports v2021-06-30 · FBA only · 建議不等於入庫確認</div>
      </aside>
    </div>
  );
}
