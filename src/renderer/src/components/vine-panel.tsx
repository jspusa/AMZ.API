import { useEffect, useMemo, useRef, useState } from "react";
import { isVineSnapshot, parseVineImport, vineEnrollmentKey, type VineSnapshot } from "../../../shared/vine";

async function request(path: string, signal: AbortSignal, text?: string): Promise<VineSnapshot> {
  const response = await fetch(path, text === undefined ? { signal } : {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }), signal,
  });
  const data = await response.json() as { message?: string };
  if (!response.ok) throw new Error(response.status === 404 ? "請更新 AMZ.API Notebook Key，才能使用 Vine 儀表板。" : data.message ?? "Vine 資料處理未完成。");
  if (!isVineSnapshot(data)) throw new Error("Vine 資料格式無法確認，請更新 Notebook Key 後重新讀取。");
  return data;
}
function Progress({ reviews, enrolled }: { reviews: number | null; enrolled: number }) {
  const label = "Amazon Vine 評論 / 已註冊";
  return <div className="vine-progress-item">
    <div><span>{label}</span><strong>{reviews === null ? `未回報 / ${enrolled}` : `${reviews} / ${enrolled}`}</strong></div>
    {reviews === null
      ? <span className="vine-progress-unknown">評論數尚未回報</span>
      : <progress aria-label={`${label} ${reviews} / ${enrolled}`} value={reviews} max={enrolled} />}
  </div>;
}
export default function VinePanel({ onClose, active = true }: { onClose(): void; active?: boolean }) {
  const [snapshot, setSnapshot] = useState<VineSnapshot | null>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  async function load(importText?: string) {
    if (pending.current) return;
    pending.current = true;
    const current = revision.current;
    const control = new AbortController();
    controller.current = control;
    setBusy(true); setError("");
    try {
      const next = await request(importText === undefined ? "/api/vine" : "/api/vine/import", control.signal, importText);
      if (!mounted.current || current !== revision.current || control.signal.aborted) return;
      setSnapshot(next);
      if (importText !== undefined && !next.importResult?.rejected.length) setText("");
    } catch (reason) {
      if (mounted.current && current === revision.current && !control.signal.aborted) setError(reason instanceof Error ? reason.message : "Vine 資料未完成。");
    } finally {
      if (controller.current === control) {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!active) return;
    heading.current?.focus();
    void load();
  }, [active]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    return window.fbaOS?.app.onContextInvalidated?.(() => {
      revision.current++; controller.current?.abort(); controller.current = null; pending.current = false;
      setSnapshot(null); setText(""); setSearch(""); setBusy(false);
      setError("帳號或安全連線已變更；請在連線完成後按「重新讀取」。");
    });
  }, []);
  const preview = useMemo(() => {
    if (!text.trim()) return null;
    const today = snapshot?.asOfDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    try { return { parsed: parseVineImport(text, today), error: "" }; }
    catch (reason) { return { parsed: null, error: reason instanceof Error ? reason.message : "無法辨識貼上的 Vine 頁面。" }; }
  }, [text, snapshot?.asOfDate]);
  const previewActive = preview?.parsed?.rows.filter(({ value }) => value.status === "active") ?? [];
  const previewEnded = preview?.parsed?.rows.filter(({ value }) => value.status === "ended").length ?? 0;
  const query = search.toLocaleLowerCase();
  const rows = snapshot?.rows.filter((row) => `${row.title ?? ""} ${row.sellerSku ?? ""} ${row.asin}`.toLocaleLowerCase().includes(query)) ?? [];
  return <section className="vine-workspace" aria-labelledby="vine-title">
    <header className="vine-heading"><div><p className="eyebrow">VINE · US FBA</p><h2 id="vine-title" ref={heading} tabIndex={-1}>Vine 進行中</h2><p>Seller Central Vine 手動匯入 · 貼上整頁即可更新</p></div><button type="button" disabled={busy} onClick={onClose}>← 返回首頁</button></header>
    <div className="vine-actions"><button type="button" disabled={busy} onClick={() => void load()}>重新讀取</button><button type="button" onClick={() => void window.fbaOS?.app.openExternal("amazon-vine")}>開啟 Seller Central Vine</button></div>
    {error && <p role="alert" className="vine-error">{error}</p>}
    {snapshot && <div className="vine-summary" role="status"><strong>{snapshot.rows.length} 筆進行中</strong><span>最近匯入：{snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString("zh-TW") : "尚未匯入"}</span><span className={snapshot.storage === "session-only" ? "vine-storage-warning" : ""}>{snapshot.storageNotice}</span></div>}
    {!!snapshot?.unconfirmedCount && <p className="vine-storage-warning">舊資料有 {snapshot.unconfirmedCount} 筆尚未確認狀態。請貼上 Vine 頁面後更新；確認前不列入進行中。</p>}
    <details className="vine-import" open={!snapshot?.rows.length || !!text}>
      <summary>貼上 Seller Central Vine 頁面</summary>
      <p>在 Vine 商品清單全選、複製，再貼到這裡。保留欄位標題與完整商品列即可，不需整理欄位或補 SKU。</p>
      <textarea aria-label="Vine 進度資料" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} placeholder="直接貼上 Seller Central Vine 整頁文字…" rows={6} />
      {preview && <section className="vine-preview" aria-label="Vine 貼上預覽">
        {preview.error && <p role="alert" className="vine-error">{preview.error}</p>}
        {preview.parsed && <>
          <p role="status">{`辨識 ${preview.parsed.rows.length + preview.parsed.rejected.length} 筆：進行中 ${previewActive.length} 筆、已結束 ${previewEnded} 筆、需核對 ${preview.parsed.rejected.length} 筆`}</p>
          <p>保存後只顯示進行中的報名；已結束會撤下相同 ASIN／報名日期的卡片。本次沒有貼到的其他報名會保留。</p>
          {previewActive.length > 0 && <details><summary>查看進行中項目</summary><ul className="vine-preview-rows">{previewActive.map(({ value }) => <li key={vineEnrollmentKey(value)}><strong>{value.title ?? value.asin}</strong><span>{value.asin} · 報名 {value.enrollmentDate} · {value.statusText}</span><span>Amazon Vine 評論 {value.reviews ?? "未回報"}／已註冊 {value.enrolled}</span></li>)}</ul></details>}
          {preview.parsed.rejected.length > 0 && <ul className="vine-error">{preview.parsed.rejected.map((row) => <li key={row.line}>第 {row.line} 行：{row.message}</li>)}</ul>}
        </>}
      </section>}
      <div className="vine-actions"><button type="button" className="vine-primary" disabled={busy || !preview?.parsed?.rows.length} onClick={() => void load(text)}>{busy ? "核對 US FBA 身分並處理中…" : "核對並保存"}</button><small>只更新這台 Notebook Key；不會在 Amazon 登記、取消或修改 Vine。</small></div>
    </details>
    {snapshot?.importResult && <div role="status" className="vine-import-result"><strong>已保存／更新 {snapshot.importResult.accepted} 筆來源資料，目前 {snapshot.rows.length} 筆進行中</strong>{snapshot.importResult.rejected.length > 0 && <ul>{snapshot.importResult.rejected.map((row) => <li key={row.line}>第 {row.line} 行：{row.message}</li>)}</ul>}</div>}
    {snapshot && snapshot.rows.length > 0 && <>
      <input type="search" className="vine-search" aria-label="搜尋 Vine 商品" placeholder="搜尋商品名稱或 ASIN" value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="vine-grid">{rows.map((row) => <article className="vine-card" key={vineEnrollmentKey(row)}>
        <header><h3>{row.title ?? row.sellerSku ?? row.asin}</h3><span>{row.asin}</span></header><p>報名 {row.enrollmentDate} · {row.statusText}</p>
        <Progress reviews={row.reviews} enrolled={row.enrolled} />
        <small>手動匯入：{new Date(row.importedAt).toLocaleString("zh-TW")}</small>
      </article>)}</div>
      {!rows.length && <p>沒有符合搜尋的 Vine 報名。</p>}
    </>}
    {!busy && snapshot && !snapshot.rows.length && <p className="vine-empty">尚無已確認進行中的 Vine 報名。貼上最新頁面後會顯示尚未結束的項目。</p>}
  </section>;
}
