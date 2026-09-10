export const MAX_BATCH_SKUS = 500;
export const MAX_BATCH_SKU_TEXT = 32_000;
export type SkuBatchParse = { skus: string[]; error: string | null };
/** Excel cells/newlines are separators. Spaces, commas and case are SKU data. */
export function parseSkuBatch(text: string): SkuBatchParse {
  if (text.length > MAX_BATCH_SKU_TEXT) return { skus: [], error: "清單過長，請分成較小批次。" };
  const skus = [...new Set(text.split(/\r\n|[\r\n\t]/u).filter(value => value.length > 0))];
  if (skus.length > MAX_BATCH_SKUS) return { skus: [], error: `一次最多 ${MAX_BATCH_SKUS} 個 SKU，請分批貼入。` };
  if (skus.some(value => value.length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(value))) {
    return { skus: [], error: "清單含無法辨識的儲存格，請只複製 SKU 欄。" };
  }
  return { skus, error: null };
}
export function matchesSkuBatch(requested: readonly string[], row: string | readonly string[]): boolean {
  if (!requested.length) return true;
  return typeof row === "string" ? requested.includes(row) : row.some(sku => requested.includes(sku));
}
export function missingBatchSkus(requested: readonly string[], available: readonly string[]): string[] {
  const known = new Set(available);
  return requested.filter(sku => !known.has(sku));
}
export function adjacentAuditSku(skus: readonly string[], current: string, direction: -1 | 1): string | null {
  const index = skus.indexOf(current);
  return index < 0 ? null : skus[index + direction] ?? null;
}
