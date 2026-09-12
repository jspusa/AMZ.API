import { useEffect, useRef, useState } from "react";
import type { PriceListAmazonSnapshot } from "../../../shared/price-list";

type Props = {
  disabled: boolean;
  primary: boolean;
  onBusyChange(busy: boolean): void;
  request(path: string, body?: Record<string, unknown>): Promise<PriceListAmazonSnapshot>;
  download(id: string, includeImages: boolean): Promise<void>;
};
const money = (value: number | null) => value === null ? "未回報" : `US$ ${value.toFixed(2)}`;
const contextErrors = new Set(["PRICE_LIST_EXPIRED", "ACCOUNT_SCOPE_CHANGED", "REPORT_MODE_CHANGED", "SP_CONTEXT_INVALIDATED"]);
function codeOf(reason: unknown): string | null {
  return reason && typeof reason === "object" && "code" in reason && typeof reason.code === "string" ? reason.code : null;
}

/** A separate view of the same main-owned price-list read; renderer sends no rows. */
export default function GeneratedPriceListPanel({ disabled, primary, onBusyChange, request, download }: Props) {
  const [snapshot, setSnapshot] = useState<PriceListAmazonSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [includeImages, setIncludeImages] = useState(true);
  const [search, setSearch] = useState("");
  const mounted = useRef(true);
  const actionPending = useRef(false);
  const revision = useRef(0);
  const running = snapshot?.state === "running";
  const locked = disabled || busy || running;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; };
  }, []);
  useEffect(() => {
    onBusyChange(busy || running);
    return () => onBusyChange(false);
  }, [busy, running, onBusyChange]);
  function failure(reason: unknown, observing = false) {
    const code = codeOf(reason);
    const message = reason instanceof Error ? reason.message : "Amazon 價目表讀取未完成。";
    setError(message);
    if (code && contextErrors.has(code)) {
      revision.current++;
      setSnapshot(null);
    } else if (observing || code === "PRICE_LIST_AMAZON_EXPIRED") {
      setSnapshot((old) => old ? {
        ...old, state: "failed", message,
        errorCode: code ?? "PRICE_LIST_OBSERVATION_INTERRUPTED",
      } : null);
    }
  }
  useEffect(() => {
    if (!snapshot || snapshot.state !== "running") return;
    let active = true;
    const current = revision.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request(`/api/price-list/amazon-refresh?id=${encodeURIComponent(snapshot.workbookId)}`);
        if (!active || !mounted.current || current !== revision.current) return;
        setSnapshot(next);
        if (next.state === "running") timer = setTimeout(() => void poll(), 2_500);
      } catch (reason) {
        if (active && mounted.current && current === revision.current) failure(reason, true);
      }
    };
    timer = setTimeout(() => void poll(), 1_500);
    return () => { active = false; clearTimeout(timer); };
  }, [snapshot?.workbookId, snapshot?.state, request]);
  async function action(run: () => Promise<void>) {
    if (actionPending.current || locked) return;
    actionPending.current = true;
    setBusy(true);
    setError("");
    try { await run(); }
    catch (reason) { if (mounted.current) failure(reason); }
    finally { actionPending.current = false; if (mounted.current) setBusy(false); }
  }
  const resume = snapshot?.errorCode === "PRICE_LIST_OBSERVATION_INTERRUPTED";
  const prices = snapshot?.rows.filter((row) => row.standardPrice !== null).length ?? 0;
  const downloadable = snapshot?.state === "complete" && prices > 0;
  const query = search.toLocaleLowerCase();
  const rows = snapshot?.rows.filter((row) => `${row.sellerSku} ${row.asin} ${row.title ?? ""}`.toLocaleLowerCase().includes(query)) ?? [];
  return <section className="price-list-generated" aria-label="免原表產生價目表">
    <div className="price-list-import has-file">
      <div><strong>直接產生 Amazon 價目表</strong><p>免上傳 Excel，整理 US FBA 商品、品名、售價與可取得的主圖。</p></div>
      <button type="button" className={primary ? "price-list-primary" : undefined} disabled={locked} onClick={() => void action(async () => {
        revision.current++;
        const next = await request(resume && snapshot
          ? `/api/price-list/amazon-refresh?id=${encodeURIComponent(snapshot.workbookId)}`
          : "/api/price-list/amazon-generate", resume ? undefined : {});
        if (mounted.current) setSnapshot(next);
      })}>{running ? `整理中 ${snapshot.completed} / ${snapshot.total}` : resume ? "接回價目表進度" : snapshot ? "重新產生 Amazon 價目表" : "產生 Amazon 價目表"}</button>
    </div>
    {error && <p role="alert" className="price-list-error">{error}</p>}
    {snapshot && <>
      <div role="status" className={`price-list-progress ${snapshot.state}`}>
        <strong>{running ? "正在整理" : snapshot.state === "complete" ? `已整理 ${snapshot.total} 個 FBA 商品` : "整理未完成"}</strong>
        <span>{snapshot.message}</span>
        {resume && <p>按「接回價目表進度」只查詢目前結果。</p>}
        {snapshot.state === "complete" && <span>{prices} 列有一般售價 · {snapshot.total - prices} 列未回報一般售價</span>}
      </div>
      {snapshot.rows.length > 0 && <>
        <div className="price-list-filters"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="搜尋產生的價目表" placeholder="搜尋 Seller SKU、ASIN 或品名" /></div>
        <div className="price-list-table-scroll"><table className="price-list-comparison">
          <caption className="sr-only">Amazon US FBA 價目表</caption>
          <thead><tr>{["商品", "Amazon 主圖", "Amazon 設定售價", "Amazon 最低價格設定", "讀取結果"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={`${row.sheetName}-${row.rowNumber}`}>
            <th scope="row"><strong>{row.sellerSku}</strong><span>{row.title || "品名未回報"}</span><small>{row.asin}</small></th>
            <td>{row.imageUrl ? <span className="price-list-image"><img src={row.imageUrl} alt={`${row.sellerSku} Amazon 主圖`} loading="lazy" referrerPolicy="no-referrer" /></span> : "主圖未回報"}</td>
            <td className="price-list-amazon-value">{money(row.standardPrice)}</td>
            <td>{row.minimumPriceStatus === "not-set" ? "未設定" : money(row.minimumPrice)}</td>
            <td><strong>{row.status === "matched" ? "☆ 已取得" : "★ 有缺值"}</strong><small>{row.message}</small></td>
          </tr>)}</tbody>
        </table></div>
      </>}
      {snapshot.state === "complete" && <section className="price-list-download" aria-label="下載產生的價目表">
        <div><h3>下載 Amazon 價目表</h3><label className="price-list-image-choice"><input type="checkbox" checked={includeImages} disabled={busy} onChange={(event) => setIncludeImages(event.target.checked)} />嵌入可取得的主圖</label><p>缺值標示未回報；最低價格設定不是公司最低活動價。</p></div>
        <button type="button" className="price-list-primary" disabled={locked || !downloadable} onClick={() => void action(() => download(snapshot.workbookId, includeImages))}>下載 Amazon 價目表</button>
      </section>}
    </>}
  </section>;
}
