import type {
  PriceListCell,
  PriceListComparison,
  PriceListDifference,
  PriceListProductRow,
  PriceListWorkbook,
} from "../shared/price-list";
import { PRICE_LIST_FIELD_LABELS } from "../shared/price-list";

function index(
  rows: readonly PriceListProductRow[],
): Map<string, PriceListProductRow[]> {
  const result = new Map<string, PriceListProductRow[]>();
  for (const row of rows)
    result.set(row.key, [...(result.get(row.key) ?? []), row]);
  return result;
}
function sameCell(
  before: PriceListCell | undefined,
  after: PriceListCell | undefined,
): boolean {
  if ((before?.formula ?? null) !== (after?.formula ?? null)) return false;
  if (typeof before?.value === "number" && typeof after?.value === "number")
    return Math.abs(before.value - after.value) < 1e-9;
  return (before?.value ?? null) === (after?.value ?? null);
}
function location(rows: PriceListProductRow[]): string | null {
  return rows.length
    ? rows.map((row) => `${row.sheetName}!${row.rowNumber}`).join("、")
    : null;
}

/** Exact keys only; duplicate rows are never silently paired, dropped or summed. */
export function comparePriceListWorkbooks(
  base: PriceListWorkbook,
  candidate: PriceListWorkbook,
): PriceListComparison {
  const before = index(base.products);
  const after = index(candidate.products);
  const rows: PriceListDifference[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key) ?? [];
    const b = after.get(key) ?? [];
    const row: PriceListDifference = {
      key,
      beforeLocation: location(a),
      afterLocation: location(b),
      fields: [],
      status:
        a.length > 1 || b.length > 1
          ? "duplicate"
          : a.length === 0
            ? "added"
            : b.length === 0
              ? "removed"
              : "unchanged",
    };
    if (row.status === "unchanged") {
      const first = a[0]!;
      const second = b[0]!;
      for (const field of new Set([
        ...Object.keys(first.cells),
        ...Object.keys(second.cells),
      ])) {
        if (field === "image" || field === "code") continue;
        const original = first.cells[field];
        const next = second.cells[field];
        if (sameCell(original, next)) continue;
        const originalFormula = original?.formula;
        const nextFormula = next?.formula;
        row.fields.push({
          field: PRICE_LIST_FIELD_LABELS[field] ?? field,
          before: `${original?.display || "空白"}${originalFormula !== nextFormula && originalFormula ? ` [=${originalFormula}]` : ""}`,
          after: `${next?.display || "空白"}${originalFormula !== nextFormula && nextFormula ? ` [=${nextFormula}]` : ""}`,
          beforeCell: original
            ? `${first.sheetName}!${original.reference}`
            : null,
          afterCell: next ? `${second.sheetName}!${next.reference}` : null,
          delta:
            typeof original?.value === "number" &&
            typeof next?.value === "number"
              ? Number((next.value - original.value).toFixed(8))
              : null,
        });
      }
      if (row.fields.length) row.status = "changed";
    }
    rows.push(row);
  }
  const counts = {
    changed: 0,
    added: 0,
    removed: 0,
    duplicate: 0,
    unchanged: 0,
  };
  for (const row of rows) counts[row.status]++;
  return {
    baseId: base.id,
    candidateId: candidate.id,
    rows,
    counts,
    warnings: [
      "以原樣貨號 / Seller SKU 精確配對；不忽略大小寫、不猜測不同貨號。重複貨號須人工確認。",
      "數值與文字、公式分開核對；圖片與純版面變動不列為價格差異。",
      ...(!base.products.length || !candidate.products.length
        ? ["至少一份檔案未辨識出商品列；不可將空結果視為完整比對。"]
        : []),
    ],
  };
}
