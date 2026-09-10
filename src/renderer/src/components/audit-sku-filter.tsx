import { useId } from "react";
import { useAuditMemoryState } from "../audit-view-session";
import { MAX_BATCH_SKUS, MAX_BATCH_SKU_TEXT, matchesSkuBatch, missingBatchSkus, parseSkuBatch } from "../audit-sku-filter";

export function useAuditSkuBatch(scope: string) {
  const [skus, setSkus] = useAuditMemoryState<string[]>(scope, "sku-batch", []);
  return { skus, setSkus, matches: (value: string | readonly string[]) => matchesSkuBatch(skus, value) };
}
export default function AuditSkuFilter({ scope, skus, availableSkus, onChange, disabled = false }: {
  scope: string; skus: string[]; availableSkus: readonly string[]; onChange: (skus: string[]) => void; disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useAuditMemoryState(scope, "sku-batch-draft", skus.join("\n"));
  const [open, setOpen] = useAuditMemoryState(scope, "sku-batch-open", false);
  const parsed = parseSkuBatch(draft);
  const missing = missingBatchSkus(skus, availableSkus);
  return <section className="audit-sku-filter" aria-label="多 SKU 篩選">
    <div className="audit-sku-filter-heading">
      <button type="button" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">▤</span> 批次 SKU{skus.length ? ` · ${skus.length}` : "篩選"}
      </button>
      {skus.length > 0 && <><small role="status">本次資料找到 {skus.length - missing.length}／{skus.length} 個</small><button type="button" className="audit-sku-clear" disabled={disabled} onClick={() => { onChange([]); setDraft(""); }}>清除批次篩選</button></>}
    </div>
    {open && <div id={id} className="audit-sku-filter-body">
      <label htmlFor={`${id}-input`}>貼上 Excel 的 SKU 欄，一行一個</label>
      <textarea id={`${id}-input`} value={draft} rows={4} disabled={disabled} autoComplete="off" spellCheck={false}
        placeholder="SKU-001&#10;SKU-002" onChange={event => setDraft(event.target.value.slice(0, MAX_BATCH_SKU_TEXT + 1))} />
      <div className="audit-sku-filter-actions"><small>最多 {MAX_BATCH_SKUS} 個；逐字比對，只篩選本次結果。</small><button type="button" disabled={disabled || !!parsed.error} onClick={() => { onChange(parsed.skus); setOpen(false); }}>套用篩選</button></div>
      {parsed.error && <p className="audit-sku-error" role="alert">{parsed.error}</p>}
    </div>}
    {missing.length > 0 && <details className="audit-sku-missing"><summary>{missing.length} 個 SKU 不在本次結果中</summary><p>不代表正常或不存在；可先核對 SKU 與目前站點。</p><div>{missing.map(sku => <code key={sku}>{sku}</code>)}</div></details>}
  </section>;
}
