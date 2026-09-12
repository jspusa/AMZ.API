import { useEffect, useRef, useState } from "react";
import { isVineSnapshot, VINE_CSV_TEMPLATE, type VineSnapshot } from "../../../shared/vine";

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
function Progress({ label, value, maximum }: { label: string; value: number | null; maximum: number | null }) {
  return <div className="vine-progress-item">
    <div><span>{label}</span><strong>{value === null ? "未回報" : maximum === null ? `${value} / 未回報` : `${value} / ${maximum}`}</strong></div>
    {value !== null && maximum !== null && maximum > 0 && value <= maximum
      ? <progress aria-label={`${label} ${value} / ${maximum}`} value={value} max={maximum} />
      : <span className="vine-progress-unknown">{value === null || maximum === null ? "資料未回報" : value > maximum ? "來源更新時間可能不同，請核對" : "尚無領取數量"}</span>}
  </div>;
}
function downloadTemplate() {
  const url = URL.createObjectURL(new Blob(["\ufeff", VINE_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "AMZ_Vine_Columns.csv";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
  const fileInput = useRef<HTMLInputElement>(null);
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
      setSnapshot(null); setText(""); setBusy(false);
      setError("帳號或安全連線已變更；請在連線完成後按「重新讀取」。");
    });
  }, []);
  async function readFile(file: File | undefined) {
    if (!file || busy) return;
    const current = revision.current;
    if (!/\.(?:csv|tsv)$/iu.test(file.name) || file.size > 512 * 1024) { setError("請選擇 512 KB 以下的 CSV／TSV。"); return; }
    try {
      const contents = await file.text();
      if (mounted.current && revision.current === current) { setText(contents); setError(""); }
    } catch { if (mounted.current && revision.current === current) setError("檔案無法讀取，請重新選擇。"); }
  }
  const query = search.toLocaleLowerCase();
  const rows = snapshot?.rows.filter((row) => `${row.sellerSku} ${row.asin}`.toLocaleLowerCase().includes(query)) ?? [];
  return <section className="vine-workspace" aria-labelledby="vine-title">
    <header className="vine-heading"><div><p className="eyebrow">VINE · US FBA</p><h2 id="vine-title" ref={heading} tabIndex={-1}>Vine 近 60 天進度</h2><p>Seller Central Vine 手動匯入 · 不會自動同步 Amazon 進度</p></div><button type="button" onClick={onClose}>← 返回首頁</button></header>
    <div className="vine-actions"><button type="button" disabled={busy} onClick={() => void load()}>重新讀取</button><button type="button" onClick={() => void window.fbaOS?.app.openExternal("amazon-vine")}>開啟 Seller Central Vine</button></div>
    {error && <p role="alert" className="vine-error">{error}</p>}
    {snapshot && <div className="vine-summary" role="status"><strong>{snapshot.rows.length} 筆登記</strong><span>{snapshot.window.startDate} — {snapshot.window.endDate}（US 日期）</span><span>最近匯入：{snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString("zh-TW") : "尚未匯入"}</span><span className={snapshot.storage === "session-only" ? "vine-storage-warning" : ""}>{snapshot.storageNotice}</span></div>}
    <details className="vine-import" open={!snapshot?.rows.length}>
      <summary>匯入／更新 Vine 進度</summary>
      <p>依下列欄位貼上 Seller Central Vine 的實際數字，或選取 CSV／TSV。相同 SKU、ASIN 與登記日會更新；空白領取／評論代表未回報。</p>
      <div className="vine-field-guide"><code>enrollmentDate</code> 登記日期 · <code>sellerSku</code> Seller SKU · <code>asin</code> ASIN · <code>enrolled</code> 名額 · <code>claimed</code> 領取 · <code>reviews</code> Vine 評論</div>
      <div className="vine-actions"><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>選取 CSV／TSV</button><button type="button" onClick={downloadTemplate}>下載空白欄位範例</button></div>
      <input ref={fileInput} type="file" accept=".csv,.tsv" className="vine-file-input" aria-label="選取 Vine CSV 或 TSV" onChange={(event) => { void readFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      <textarea aria-label="Vine 進度資料" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} placeholder={VINE_CSV_TEMPLATE.trim()} rows={5} />
      <div className="vine-actions"><button type="button" className="vine-primary" disabled={busy || !text} onClick={() => void load(text)}>{busy ? "核對 US FBA 身分並處理中…" : "核對並匯入"}</button><small>只更新這台 Notebook Key；不會在 Amazon 登記、取消或修改 Vine。</small></div>
    </details>
    {snapshot?.importResult && <div role="status" className="vine-import-result"><strong>已匯入／更新 {snapshot.importResult.accepted} 列</strong>{snapshot.importResult.rejected.length > 0 && <ul>{snapshot.importResult.rejected.map((row) => <li key={row.line}>第 {row.line} 列：{row.message}</li>)}</ul>}</div>}
    {snapshot && snapshot.rows.length > 0 && <>
      <input type="search" className="vine-search" aria-label="搜尋 Vine 商品" placeholder="搜尋 Seller SKU 或 ASIN" value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="vine-grid">{rows.map((row) => <article className="vine-card" key={`${row.sellerSku}-${row.asin}-${row.enrollmentDate}`}>
        <header><h3>{row.sellerSku}</h3><span>{row.asin}</span></header><p>登記 {row.enrollmentDate} · 名額 {row.enrolled}</p>
        <Progress label="已領取 / 登記名額" value={row.claimed} maximum={row.enrolled} />
        <Progress label="Vine 評論 / 登記名額" value={row.reviews} maximum={row.enrolled} />
        <Progress label="Vine 評論 / 已領取" value={row.reviews} maximum={row.claimed} />
        <small>手動匯入：{new Date(row.importedAt).toLocaleString("zh-TW")}</small>
      </article>)}</div>
      {!rows.length && <p>沒有符合搜尋的 Vine 登記。</p>}
    </>}
    {!busy && snapshot && !snapshot.rows.length && <p className="vine-empty">近 60 天尚無已匯入的 Vine 登記；這不代表 Amazon 沒有進行中的 Vine。</p>}
  </section>;
}
