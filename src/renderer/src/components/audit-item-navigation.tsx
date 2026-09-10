import { adjacentAuditSku } from "../audit-sku-filter";
export default function AuditItemNavigation({ skus, currentSku, disabled = false, onSelect }: {
  skus: readonly string[]; currentSku: string; disabled?: boolean; onSelect: (sku: string) => void;
}) {
  const index = skus.indexOf(currentSku);
  if (index < 0 || skus.length < 2) return null;
  const previous = adjacentAuditSku(skus, currentSku, -1), next = adjacentAuditSku(skus, currentSku, 1);
  return <nav className="audit-item-navigation" aria-label="依目前篩選連續查看商品">
    <button type="button" disabled={disabled || previous === null} onClick={() => { if (!disabled && previous !== null) onSelect(previous); }}>← 上一筆</button>
    <span aria-live="polite">第 {index + 1}／{skus.length} 筆</span>
    <button type="button" disabled={disabled || next === null} onClick={() => { if (!disabled && next !== null) onSelect(next); }}>下一筆 →</button>
  </nav>;
}
