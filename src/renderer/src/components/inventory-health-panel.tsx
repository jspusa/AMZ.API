import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  isInventoryHealthSnapshot,
  inventoryHealthCalendarRows,
  type InventoryHealthSnapshot,
  type InventoryHealthRow,
  type InventoryHealthStatus,
} from "../../../shared/inventory-health";

const count = (value: number | null, missing = "未提供", digits = 1) => value === null
  ? missing : value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
const money = (value: number | null, currency: string | null) => value === null || currency === null
  ? "未提供" : `${currency} ${value.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function parseReply(raw: unknown, marketplaceId: string, mode: "live" | "demo"): InventoryHealthSnapshot | null {
  if (!raw || typeof raw !== "object" || !("snapshot" in raw)) throw new Error("庫存健康回應不完整，請重新讀取。");
  const snapshot = raw.snapshot;
  if (snapshot === null) return null;
  if (!isInventoryHealthSnapshot(snapshot) || snapshot.marketplaceId !== marketplaceId || snapshot.mode !== mode) {
    throw new Error("庫存健康資料與目前站點或模式不一致，已停止顯示。");
  }
  return snapshot;
}

class LocalHealthRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (response.status === 404) throw new Error("請更新 AMZ.API Notebook Key，才能讀取庫存健康資料。");
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message : "目前無法完成庫存健康操作。";
    throw new LocalHealthRequestError(message, response.status);
  }
  return payload;
}

type Confirmation = Pick<InventoryHealthRow, "expiryDate" | "stopSaleDate" | "confirmedRemaining">;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function BatchConfirmation({ row, disabled, saving, onSave, onClose }: {
  row: InventoryHealthRow; disabled: boolean; saving: boolean;
  onSave: (value: Confirmation) => Promise<void>; onClose: () => void;
}) {
  const [expiry, setExpiry] = useState(row.expiryDate ?? "");
  const [stopSale, setStopSale] = useState(row.stopSaleDate ?? "");
  const [remaining, setRemaining] = useState(row.confirmedRemaining?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  return <form className="inventory-health-confirmation" onSubmit={async event => {
    event.preventDefault();
    if (disabled || saving) return;
    const quantity = remaining.trim();
    if ((expiry && !validDate(expiry)) || (stopSale && (!validDate(stopSale) || !expiry || stopSale > expiry))) {
      setError("請填入有效日期；停售日不能晚於效期。"); return;
    }
    if (quantity && (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) > 100000000)) {
      setError("批次餘量請填入非負整數；未知請留空。"); return;
    }
    setError(null);
    await onSave({ expiryDate: expiry || null, stopSaleDate: stopSale || null, confirmedRemaining: quantity === "" ? null : Number(quantity) });
  }}>
    <fieldset disabled={disabled || saving}><legend>本機批次確認</legend>
      <div className="inventory-health-confirmation-fields">
        <label>效期<input type="date" aria-label="批次效期" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>
        <label>停售日（選填）<input type="date" aria-label="批次停售日" value={stopSale} max={expiry || undefined} onChange={event => setStopSale(event.target.value)} /></label>
        <label>已確認批次餘量<input type="text" inputMode="numeric" aria-label="已確認批次餘量" placeholder="未知請留空" value={remaining} onChange={event => setRemaining(event.target.value)} /></label>
      </div>
      <p>只填這個效期批次目前確認的剩餘件數；留空代表未知，填 0 才代表已售完。效期留空會取消人工修正並沿用入庫申報效期（若有）。</p>
      {error && <p role="alert" className="price-error">{error}</p>}
      <button type="submit">{saving ? "儲存中…" : "儲存本機確認"}</button>
    </fieldset>
    {disabled && <p>庫存資料不完整或已過期，請先重新執行下方庫齡健檢。</p>}
    <button type="button" onClick={onClose} disabled={saving}>收起</button>
  </form>;
}

export default function InventoryHealthPanel({ marketplaceId, mode, sourceFetchedAt = null, syncing = false }: {
  marketplaceId: string;
  mode: "live" | "demo";
  sourceFetchedAt?: string | null;
  syncing?: boolean;
}) {
  const [storedSnapshot, setSnapshot] = useState<InventoryHealthSnapshot | null>(null);
  const snapshot = storedSnapshot?.marketplaceId === marketplaceId && storedSnapshot.mode === mode &&
    (!sourceFetchedAt || storedSnapshot.fetchedAt === sourceFetchedAt) ? storedSnapshot : null;
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InventoryHealthStatus>("clearance-risk");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const generation = useRef(0);
  const saveBusy = useRef(false);
  const invalidated = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (saveBusy.current) return;
    invalidated.current = false;
    const current = ++generation.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true); setSaving(false); setError(null); setNotice(null); setSnapshot(null); setExpandedId(null); setLimit(100);
    try {
      const response = await fetch(`/api/inventory-health?${new URLSearchParams({ marketplaceId })}`, { cache: "no-store", signal: controller.signal });
      const next = parseReply(await responsePayload(response), marketplaceId, mode);
      if (current !== generation.current || controller.signal.aborted) return;
      if (next && sourceFetchedAt && next.fetchedAt !== sourceFetchedAt) throw new Error("庫存健康與最新健檢時間不一致，請重新讀取本機資料。");
      setSnapshot(next);
    } catch (error) {
      if (current !== generation.current || controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : "無法讀取本機庫存健康資料。");
    } finally { if (current === generation.current) setLoading(false); }
  }, [marketplaceId, mode, sourceFetchedAt]);
  useEffect(() => {
    setFilter("clearance-risk"); setQuery("");
    void refresh();
    return () => { generation.current += 1; controllerRef.current?.abort(); saveBusy.current = false; };
  }, [refresh]);
  useEffect(() => {
    const unsubscribe = window.fbaOS?.app.onContextInvalidated?.(() => {
      generation.current += 1; controllerRef.current?.abort(); saveBusy.current = false; invalidated.current = true;
      setSnapshot(null); setExpandedId(null); setLoading(false); setSaving(false); setNotice(null);
      setError("帳號環境已更新，請重新讀取本機資料。");
    });
    const onFocus = () => { if (invalidated.current) void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { unsubscribe?.(); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  const saveConfirmation = async (row: InventoryHealthRow, value: Confirmation) => {
    if (!snapshot || saveBusy.current || invalidated.current) return;
    saveBusy.current = true; setSaving(true); setError(null); setNotice(null);
    const current = generation.current;
    const controller = new AbortController(); controllerRef.current = controller;
    try {
      const response = await fetch("/api/inventory-health/confirmation", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ marketplaceId, id: row.id, snapshotFetchedAt: snapshot.fetchedAt, ...value }),
      });
      const next = parseReply(await responsePayload(response), marketplaceId, mode);
      if (current !== generation.current || controller.signal.aborted) return;
      if (!next || next.fetchedAt !== snapshot.fetchedAt) throw new Error("儲存回應的資料時間不一致。");
      setSnapshot(next); setExpandedId(null); setNotice("已儲存本機批次確認，清售預估已更新。");
      window.dispatchEvent(new CustomEvent("amz-api-inventory-health-changed", { detail: { marketplaceId } }));
    } catch (error) {
      if (current !== generation.current || controller.signal.aborted) return;
      if (error instanceof LocalHealthRequestError && error.status === 400) setError(error.message);
      else {
        setSnapshot(null); setExpandedId(null);
        setError(`${error instanceof LocalHealthRequestError ? error.message : "儲存結果尚未確認。"} 請重新讀取本機資料後再核對。`);
      }
    } finally {
      if (current === generation.current) { saveBusy.current = false; setSaving(false); }
    }
  };
  const calendarIds = new Set(snapshot ? inventoryHealthCalendarRows(snapshot).map(row => row.id) : []);
  const filtered = snapshot?.rows.filter(row => row.status === filter &&
    (!query || `${row.sellerSku} ${row.asin} ${row.title}`.toLocaleLowerCase("en-US").includes(query.toLocaleLowerCase("en-US")))) ?? [];
  const groups: Array<{ status: InventoryHealthStatus; label: string; star: string }> = [
    { status: "clearance-risk", label: "清售風險", star: "★" },
    { status: "needs-review", label: "待確認", star: "☆" },
    { status: "on-track", label: "預估可清完", star: "★" },
  ];
  return <section className="inventory-health-panel" aria-label="庫存健康與清售風險" aria-busy={loading || saving}>
    <header><div><h3>庫存健康 · 清售風險</h3><p>效期、庫齡與銷速一起核對；只有已確認餘量且預估清不完的品項進入行事曆。</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading || syncing || saving}>{loading ? "讀取中…" : "重新讀取本機資料"}</button></header>
    {notice && <p role="status">{notice}</p>}
    {error && <p className="price-error" role="alert">{error}</p>}
    {!loading && !error && !snapshot && <p className="inventory-health-empty">尚無庫存健康資料。完成下方庫齡健檢後，Notebook Key 會自動讀取可存取的入庫申報效期。</p>}
    {snapshot && <>
      <div className="inventory-health-source-status"><span>{snapshot.mode === "demo" ? "展示資料" : "Amazon 來源＋本機批次確認"}</span>
        <time dateTime={snapshot.fetchedAt}>資料讀取：{new Date(snapshot.fetchedAt).toLocaleString("zh-TW")}</time>
        {snapshot.stale && <strong>資料需重新核對，請重新執行下方庫齡健檢。</strong>}
        {!snapshot.sourceComplete && <strong>效期來源尚未完整；待確認品項不加入行事曆。</strong>}
      </div>
      <div className="inventory-health-summary" role="group" aria-label="庫存健康顯示範圍">
        {groups.map(group => <button key={group.status} type="button" disabled={saving} aria-label={group.label} aria-pressed={filter === group.status}
          onClick={() => { setFilter(group.status); setLimit(100); setExpandedId(null); }}>
          <span>{group.star} {group.label}</span><strong>{snapshot.rows.filter(row => row.status === group.status).length.toLocaleString("zh-TW")}</strong><small>批次</small>
        </button>)}
      </div>
      <input type="search" disabled={saving} aria-label="搜尋庫存健康品項" placeholder="搜尋品號、ASIN 或品名" value={query}
        onChange={event => { setQuery(event.target.value); setLimit(100); }} />
      <div className="inventory-health-table"><table>
        <thead><tr><th scope="col">品項／批次</th><th scope="col">目標清完日</th><th scope="col">本批確認餘量</th><th scope="col">最快平均銷速</th><th scope="col">累計清售缺口</th><th scope="col">核對</th></tr></thead>
        <tbody>{filtered.slice(0, limit).map(row => <Fragment key={row.id}>
          <tr><td><strong>{row.title || row.sellerSku}</strong><small>{row.sellerSku}</small><small>{row.expiryDate ? `效期 ${row.expiryDate}` : "效期待確認"}</small></td>
            <td>{row.stopSaleDate ?? row.expiryDate ?? "待確認"}<small>{row.daysRemaining === null ? "期限未知" : row.daysRemaining <= 0 ? "已到處理期限" : `剩 ${row.daysRemaining} 天`}</small></td>
            <td>{count(row.confirmedRemaining, "待確認餘量", 0)}</td><td>{row.dailyUnits === null ? "銷速未知" : `${count(row.dailyUnits)} 件／日`}</td>
            <td>{row.projectedShortfall === null ? "待確認" : `${count(row.projectedShortfall, "待確認", 0)} 件`}
              {calendarIds.has(row.id) && <small>★ 列入行事曆</small>}</td>
            <td><button type="button" disabled={saving} aria-label={`核對批次：${row.id}`} aria-expanded={expandedId === row.id}
              onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>核對批次</button></td></tr>
          {expandedId === row.id && <tr><td colSpan={6} className="inventory-health-details">
            <p>{row.reason}</p><dl>
              <div><dt>來源</dt><dd>{row.sourceLabel ?? row.sourceRef}</dd></div><div><dt>來源更新</dt><dd>{row.sourceUpdatedAt}</dd></div>
              <div><dt>庫存報表日期</dt><dd>{row.snapshotDate ?? "未提供"}</dd></div><div><dt>入庫申報數量</dt><dd>{count(row.declaredQuantity, "未提供", 0)}（不是批次餘量）</dd></div>
              <div><dt>全 SKU 可售庫存</dt><dd>{count(row.available, "未提供", 0)}</dd></div><div><dt>180 天以上庫齡</dt><dd>{count(row.agedOver180, "未提供", 0)}</dd></div>
              <div><dt>至此日前累計確認餘量</dt><dd>{count(row.quantityDueByDate, "待確認", 0)}</dd></div><div><dt>如期清完每日所需</dt><dd>{count(row.minimumDailyUnits, "無法估算")} 件／日</dd></div>
              <div><dt>全 SKU 預估清完天數</dt><dd>{count(row.wholeSkuClearanceDays, "無法估算")}</dd></div><div><dt>Amazon 預估冗餘</dt><dd>{count(row.estimatedExcessQuantity, "未提供", 0)}</dd></div>
              <div><dt>下月預估倉儲費</dt><dd>{money(row.estimatedStorageCostNextMonth, row.currencyCode)}</dd></div><div><dt>預估庫齡附加費</dt><dd>{money(row.estimatedAgedSurcharge, row.currencyCode)}</dd></div>
            </dl>
            <BatchConfirmation key={`${row.id}:${snapshot.fetchedAt}`} row={row} saving={saving}
              disabled={snapshot.stale || row.available === null || row.snapshotDate === null || syncing}
              onSave={value => saveConfirmation(row, value)} onClose={() => setExpandedId(null)} />
          </td></tr>}
        </Fragment>)}</tbody>
      </table></div>
      {!filtered.length && <p className="inventory-health-empty">{query ? "沒有符合搜尋的品項。" : filter === "clearance-risk" ? "目前沒有已確認的清售風險；資料缺漏請查看「待確認」。" : "目前沒有此狀態的批次。"}</p>}
      {filtered.length > limit && <button type="button" onClick={() => setLimit(value => value + 100)}>再顯示 100 批次（已顯示 {limit}／{filtered.length}）</button>}
      <details className="inventory-health-method"><summary>計算方式與資料有效期限</summary>
        <p>{snapshot.notice}</p><p>清售缺口累計同一 SKU 到此日以前的已確認批次；銷速採 7／30／60／90 天中最快平均值，預測不保證未來銷量。全 SKU 庫存、庫齡與歷史入庫量都不是效期批次餘量。</p>
        <p>庫存報表日期超過 2 天，或資料讀取超過 48 小時，需重新健檢。庫存、報表日期、銷量或來源資料改變時，舊餘量確認會清除；需要重新核對。人工確認只儲存在這台 Notebook Key，不修改 Amazon。</p>
      </details>
    </>}
  </section>;
}
