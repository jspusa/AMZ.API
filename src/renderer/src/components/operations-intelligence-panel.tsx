import { useCallback, useEffect, useRef, useState } from "react";
import type { OperationsIntelligenceSnapshot, OperationsSource, OperationsSourceState } from "../../../shared/operations-intelligence";
import type { AmazonPromotionsSnapshot, AmazonPromotionRevision } from "../../../shared/amazon-promotions";
import type { AwdInventorySnapshot, AwdInventoryQuantity } from "../../../shared/awd-inventory";
import type { PriceHealthMoney, PriceHealthSnapshot } from "../../../shared/price-health";
import type { AdvertisingDiagnosticsSnapshot } from "../../../shared/advertising-diagnostics";
import { configureOperationsAutoSync, operationsIntelligenceFailureMessage, readOperationsIntelligence, setOperationsEventStatus, syncOperationsIntelligence } from "../operations-intelligence";

export const OPERATIONS_INTELLIGENCE_SOURCE_LABELS: Record<OperationsSource, string> = {
  promotions: "Coupon／促銷", awd: "AWD 庫存",
  "price-health": "Buy Box／價格", advertising: "廣告成效",
};
export type OperationsIntelligenceView = OperationsSource | "events";
export const OPERATIONS_INTELLIGENCE_VIEWS: readonly OperationsIntelligenceView[] = ["promotions", "awd", "price-health", "advertising", "events"];
const STATUS_LABELS: Record<OperationsSourceState["status"], string> = { never: "尚未同步", running: "同步中", complete: "已核對本次範圍", partial: "部分完成", failed: "同步失敗" };

function viewLabel(view: OperationsIntelligenceView): string {
  return view === "events" ? "事件" : OPERATIONS_INTELLIGENCE_SOURCE_LABELS[view];
}

function useDisplayLimit(resetKey: string) {
  const [limit, setLimit] = useState(100);
  useEffect(() => setLimit(100), [resetKey]);
  return { limit, more: () => setLimit((value) => value + 100) };
}
function MoreRows({ limit, total, onMore, label }: { limit: number; total: number; onMore: () => void; label: string }) {
  return <div className="oi-controls"><small>本機顯示 {Math.min(limit, total)}／{total} 筆已取得資料</small>{limit < total && <button type="button" aria-label={`顯示更多${label}`} onClick={onMore}>顯示更多{label}</button>}</div>;
}

function PromotionRevision({ revision, label }: { revision: AmazonPromotionRevision; label: string }) {
  return <div className="oi-revision"><strong>{label}</strong><span>{revision.status} · {revision.coverage === "partial" ? "部分資料" : "已核對範圍"}</span><p>{revision.startDate ?? "未回報"} → {revision.endDate ?? "未回報"}</p><p>參與 FBA SKU：{revision.items.length ? revision.items.map((item) => item.sellerSku).join("、") : "此版本未取得可顯示 SKU；不代表全站未參與"}</p><p>驗證問題：{revision.issues === null ? "未回報" : revision.issues.length ? revision.issues.map((issue) => `${issue.severity} ${issue.code ?? "未回報代碼"}`).join("、") : "本次未回報問題"}</p></div>;
}
function Promotions({ data }: { data: AmazonPromotionsSnapshot }) {
  const page = useDisplayLimit(data.fetchedAt);
  return <>
    <details className="oi-details"><summary>口徑</summary><p>Amazon 實際讀回的促銷；人工計畫仍保留在公告日曆，兩者不互相覆蓋。最新修訂不等於已生效。</p></details>
    <p>Amazon 回報活動數：{data.reportedTotal ?? "未回報"} · 未納入目前 FBA 範圍：{data.excludedPromotionCount}</p>
    {data.promotions.slice(0, page.limit).map((item) => <article className="oi-promotion" key={item.key}>
      <h4>{item.title} <small>{item.promotionType}</small></h4>
      <div className="oi-revisions"><PromotionRevision label="已發布版本" revision={item.published} />{item.latestRevision && <PromotionRevision label="最新修訂" revision={item.latestRevision} />}</div>
    </article>)}
    <MoreRows limit={page.limit} total={data.promotions.length} onMore={page.more} label="促銷" />
  </>;
}
function numeric(value: number | null): string { return value === null ? "未回報" : value.toLocaleString("zh-TW", { maximumFractionDigits: 2 }); }
function awdQuantity(value: AwdInventoryQuantity | null): string { return value === null ? "未回報" : `${String(value.quantity)} ${{ PRODUCT_UNITS: "件", CASES: "箱", PALLETS: "板" }[value.unitOfMeasurement]}`; }
function Awd({ data }: { data: AwdInventorySnapshot }) {
  const page = useDisplayLimit(data.fetchedAt);
  const shipmentPage = useDisplayLimit(data.fetchedAt);
  const shipmentRows = data.shipments.flatMap((shipment) => shipment.rows.map((row) => ({ shipment, row })));
  return <><details className="oi-details"><summary>口徑</summary><p>AWD 供多個下游通路使用，不能將共享庫存全部視為 FBA。各階段可能重疊，不加總為補貨供給；貨件箱／板不換算為件。</p></details><div className="oi-table-scroll"><table><caption>AWD 商品庫存 · 數量單位：件 · {data.inventoryCoverage === "partial" ? "部分範圍" : "本次範圍完整"}</caption><thead><tr>{["Seller SKU", "AWD 在庫", "進 AWD 在途", "共享可分配", "共享保留", "AWD→FBA 在途", "AWD 效期／數量"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.rows.slice(0, page.limit).map((row) => <tr key={row.sellerSku}><th scope="row">{row.sellerSku}<small>{row.asin}</small></th><td>{numeric(row.totalOnhandQuantity)}</td><td>{numeric(row.totalInboundQuantity)}</td><td>{numeric(row.availableDistributableQuantity)}</td><td>{numeric(row.reservedDistributableQuantity)}</td><td>{numeric(row.replenishmentQuantity)}</td><td>{row.expirationDetails === null ? "未回報" : row.expirationDetails.length === 0 ? "本次未回報批次" : row.expirationDetails.map((item, index) => <span className="oi-detail-line" key={index}>{item.expiration ?? "效期未回報"} · {numeric(item.onhandQuantity)} 件</span>)}</td></tr>)}</tbody></table></div><MoreRows limit={page.limit} total={data.rows.length} onMore={page.more} label="AWD 庫存" /><div className="oi-table-scroll"><table><caption>進 AWD 貨件明細 · {data.shipmentCoverage === "partial" ? "部分範圍" : "本次範圍完整"}</caption><thead><tr>{["貨件狀態／來源時間", "Seller SKU", "預期", "已接收", "尚未接收"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{shipmentRows.slice(0, shipmentPage.limit).map(({ shipment, row }) => <tr key={`${shipment.id}-${row.sellerSku}`}><td>{shipment.status}<small>{shipment.updatedAt ?? "未回報"} · {shipment.coverage === "partial" ? "部分資料" : "已核對"}</small></td><th scope="row">{row.sellerSku}</th><td>{awdQuantity(row.expectedQuantity)}</td><td>{awdQuantity(row.receivedQuantity)}</td><td>{awdQuantity(row.outstandingQuantity)}</td></tr>)}</tbody></table></div><MoreRows limit={shipmentPage.limit} total={shipmentRows.length} onMore={shipmentPage.more} label="AWD 貨件" /></>;
}
function money(value: PriceHealthMoney | null): string { return value === null ? "未回報" : `${value.currencyCode} ${value.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function PriceHealth({ data }: { data: PriceHealthSnapshot }) {
  const page = useDisplayLimit(data.fetchedAt);
  return <><details className="oi-details"><summary>口徑</summary><p>Featured Offer 是各顧客分段的觀察，整體資格未知。無法由此判定站外競爭者或失去 Buy Box 的原因；以下只提供診斷，不修改價格。</p></details><div className="oi-table-scroll"><table><caption>Amazon 價格健康證據</caption><thead><tr>{["Seller SKU", "診斷／自售價格", "競爭參考價", "Featured Offer 分段"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.rows.slice(0, page.limit).map((row) => <tr key={row.sellerSku}><th scope="row">{row.sellerSku}<small>{row.asin}</small></th><td>{{ observed: "有觀察資料", "needs-review": "待人工核對", "insufficient-evidence": "證據不足" }[row.status]}<small>自售價格：{money(row.currentPrice)}</small><small>{row.availability === "complete" ? "本次資料完整" : row.availability === "partial" ? "部分資料" : "資料不可用"}</small>{row.warnings.map((warning, index) => <small key={index}>{warning}</small>)}</td><td>{row.referencePrices.length ? row.referencePrices.map((reference, index) => <span className="oi-detail-line" key={index}>{reference.name}：{money(reference.price)}</span>) : "未回報"}</td><td>{row.segments.length ? row.segments.map((segment, index) => <span className="oi-detail-line" key={index}>{segment.membership} · {segment.fulfillment} · {segment.isOwnSeller === null ? "賣家歸屬未知" : segment.isOwnSeller ? "觀察到自身賣家" : "觀察到其他賣家"}<small>商品 {money(segment.listingPrice)} + 運費 {money(segment.shippingPrice)} · 流量權重 {numeric(segment.glanceViewWeightPercentage)}{segment.glanceViewWeightPercentage === null ? "" : "%"}</small></span>) : "未回報分段"}</td></tr>)}</tbody></table></div><MoreRows limit={page.limit} total={data.rows.length} onMore={page.more} label="價格資料" /></>;
}
function percentage(value: number | null): string { return value === null ? "未回報" : `${numeric(value * 100)}%`; }
function Advertising({ data }: { data: AdvertisingDiagnosticsSnapshot }) {
  const page = useDisplayLimit(data.fetchedAt);
  const amount = (value: number | null) => money(value === null ? null : { amount: value, currencyCode: data.currencyCode });
  return <><details className="oi-details"><summary>口徑</summary><p>Sponsored Products · {data.dateRange.startDate} → {data.dateRange.endDate} · 14 天歸因。建議 ACoS 不代表商品利潤或損益兩平；不修改預算或投放。</p><p>{data.notice}</p></details><div className="oi-table-scroll"><table><caption>已核對目前 FBA 身分的 SP 商品成效</caption><thead><tr>{["Seller SKU", "SP 花費", "14 天歸因銷售", "14 天購買次數", "ACoS", "ROAS", "建議 ACoS", "診斷依據"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.rows.slice(0, page.limit).map((row) => <tr key={row.key}><th scope="row">{row.sellerSku}<small>{row.asin}</small></th><td>{amount(row.spend)}</td><td>{amount(row.attributedSales14d)}</td><td>{numeric(row.purchases14d)}</td><td>{row.acosStatus === "no-sales" ? "已回報零銷售／不可計算" : row.acosStatus === "not-reported" ? "未回報" : percentage(row.acos)}</td><td>{row.roasStatus === "no-spend" ? "已回報零花費／不可計算" : row.roasStatus === "not-reported" ? "未回報" : `${numeric(row.roas)}×`}</td><td>{percentage(row.suggestedAcos)}</td><td>{{ "needs-review": "待人工核對", "insufficient-evidence": "證據不足", "no-signal": "目前無規則命中" }[row.status]}{row.rationale.map((reason, index) => <small key={index}>{reason}</small>)}</td></tr>)}</tbody></table></div><MoreRows limit={page.limit} total={data.rows.length} onMore={page.more} label="廣告資料" /><details className="oi-details"><summary>來源時間</summary><p>FBA 身分 {data.sourceFetchedAt.fba} · 商品銷售 {data.sourceFetchedAt.sales} · SP 廣告 {data.sourceFetchedAt.ads}</p></details></>;
}

export default function OperationsIntelligencePanel({
  marketplaceId,
  selectedView,
  onViewChange,
}: {
  marketplaceId: string;
  selectedView?: OperationsIntelligenceView;
  onViewChange?: (view: OperationsIntelligenceView) => void;
}) {
  const [localView, setLocalView] = useState<OperationsIntelligenceView>("promotions");
  const view = selectedView ?? localView;
  function selectView(next: OperationsIntelligenceView) {
    setLocalView(next);
    onViewChange?.(next);
  }
  const [snapshot, setSnapshot] = useState<OperationsIntelligenceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const observer = useRef<AbortController | null>(null);
  const blocked = useRef(false);
  const context = useRef<string | null>(null);
  const run = useCallback(async (action?: () => Promise<OperationsIntelligenceSnapshot>) => {
    if (inFlight.current) {
      if (!action || !observer.current) return;
      generation.current++;
      observer.current.abort();
      observer.current = null;
    }
    inFlight.current = true;
    const revision = generation.current;
    const controller = action ? null : new AbortController();
    observer.current = controller;
    if (action) setBusy(true);
    try {
      const next = action ? await action() : await readOperationsIntelligence(marketplaceId, controller!.signal);
      if (generation.current !== revision) return;
      if (context.current !== null && context.current !== next.contextId) {
        context.current = null;
        setSnapshot(null);
        setError("帳號或站點安全脈絡已變更，已清除舊資料。請重新讀取。");
        blocked.current = true;
        return;
      }
      context.current = next.contextId;
      blocked.current = false;
      setSnapshot(next);
      setError(null);
    } catch (reason: unknown) {
      if (generation.current !== revision) return;
      setSnapshot(null);
      setError(operationsIntelligenceFailureMessage(reason));
      context.current = null;
      blocked.current = true;
    } finally {
      if (generation.current === revision) { observer.current = null; inFlight.current = false; setBusy(false); }
    }
  }, [marketplaceId]);
  useEffect(() => {
    generation.current++;
    context.current = null; blocked.current = false; inFlight.current = false;
    setSnapshot(null); setError(null); setBusy(false);
    void run();
    const observe = () => { if (!blocked.current && (typeof document === "undefined" || document.visibilityState !== "hidden")) void run(); };
    const timer = setInterval(observe, 3000);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", observe);
    return () => {
      generation.current++;
      observer.current?.abort();
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", observe);
    };
  }, [run]);
  async function acknowledge(eventId: string, status: "open" | "acknowledged") {
    await run(() => setOperationsEventStatus(marketplaceId, eventId, status));
  }
  const visible = snapshot?.marketplaceId === marketplaceId ? snapshot : null;
  const eventPage = useDisplayLimit(visible?.contextId ?? "empty");
  const state = view === "events" ? null : visible?.sources[view];
  const data = state?.snapshot;
  const hasRunningSources = visible && Object.values(visible.sources).some((source) => source.status === "running");
  const ageMinutes = state?.fetchedAt && visible ? Math.max(0, Math.floor((Date.parse(visible.observedAt) - Date.parse(state.fetchedAt)) / 60000)) : null;
  const stale = state?.snapshot && (state.status === "running" || state.status === "failed" || (ageMinutes !== null && ageMinutes >= (view === "advertising" ? 60 : 15)));
  return <section id="home-intelligence" className="operations-intelligence" aria-labelledby="operations-intelligence-title" tabIndex={-1}>
    <h2 id="operations-intelligence-title" className="visually-hidden">營運情報</h2>
    <header className="oi-header">
      <label className="oi-view-picker">
        <span className="visually-hidden">營運情報</span>
        <select value={view} onChange={(event) => selectView(event.target.value as OperationsIntelligenceView)}>
          {OPERATIONS_INTELLIGENCE_VIEWS.map((key) => <option key={key} value={key}>{viewLabel(key)}</option>)}
        </select>
      </label>
      <div className="oi-header-actions">
        {state && <button type="button" className="oi-primary" aria-label="同步此來源" disabled={busy || state.status === "running"} onClick={() => void run(() => syncOperationsIntelligence(marketplaceId, view as OperationsSource))}>{state.status === "failed" ? "重試" : "同步"}</button>}
        <button type="button" disabled={busy || !visible || Boolean(hasRunningSources)} onClick={() => void run(() => syncOperationsIntelligence(marketplaceId, "all"))}>同步全部</button>
        <details className="oi-settings">
          <summary>設定</summary>
          <div>
            <button type="button" disabled={busy} onClick={() => void run()}>重新整理</button>
            <label className="oi-auto"><input type="checkbox" checked={visible?.autoSync ?? false} disabled={busy || !visible} onChange={(event) => void run(() => configureOperationsAutoSync(marketplaceId, event.target.checked))} />自動同步</label>
          </div>
        </details>
      </div>
    </header>
    {error && <p role="alert">{error}</p>}
    {state && state.status !== "never" && <div className="oi-source-status" aria-live="polite"><div><strong>{STATUS_LABELS[state.status]}</strong>{stale && <b className="oi-stale">可能過期</b>}{state.status === "failed" && <p>{state.message}</p>}<details className="oi-details"><summary>時間</summary><small>{state.fetchedAt ?? "尚未取得"}{ageMinutes !== null && ` · ${ageMinutes} 分鐘前`}{state.nextSyncAt && ` · 下次 ${state.nextSyncAt}`}</small></details></div></div>}
    <div id={`oi-view-${view}`} className="oi-view" tabIndex={0}>{view === "events" && visible ? <><details className="oi-details"><summary>說明</summary><p>{visible.notice}</p><p>已知悉不等於問題已解決；只有來源完整重新核對後，才可解除事件。</p></details>{visible.events.length === 0 && <p className="oi-empty">尚無事件</p>}<div className="oi-events">{visible.events.slice(0, eventPage.limit).map((event) => <article className={`oi-event severity-${event.severity}`} key={event.id}><div><span className="oi-event-status">{{ open: "待處理", acknowledged: "已知悉", resolved: "已解除" }[event.status]}</span><h4>{event.title}</h4><p>{event.detail}</p><small>{event.sellerSku ?? "來源範圍"} · {event.lastObservedAt}</small></div><div className="oi-event-actions"><button type="button" aria-label={`查看來源：${OPERATIONS_INTELLIGENCE_SOURCE_LABELS[event.source]}`} onClick={() => selectView(event.source)}>查看來源</button>{event.status !== "resolved" && <button type="button" disabled={busy} onClick={() => void acknowledge(event.id, event.status === "open" ? "acknowledged" : "open")}>{event.status === "open" ? "已知悉" : "恢復"}</button>}</div></article>)}</div><MoreRows limit={eventPage.limit} total={visible.events.length} onMore={eventPage.more} label="事件" />{visible.omittedEventCount > 0 && <p>另有 {visible.omittedEventCount} 筆</p>}</> : data ? <>{data.warnings.length > 0 && <ul className="oi-warnings">{data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}{view === "promotions" && "promotions" in data && <Promotions data={data} />}{view === "awd" && "stockScope" in data && <Awd data={data} />}{view === "price-health" && !("promotions" in data) && !("stockScope" in data) && !("kind" in data) && <PriceHealth data={data} />}{view === "advertising" && "kind" in data && <Advertising data={data} />}</> : <p className="oi-empty">尚無資料</p>}</div>
  </section>;
}
