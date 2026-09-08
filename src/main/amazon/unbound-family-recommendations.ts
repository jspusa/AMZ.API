import type {
  UnboundFamilyCandidate,
  UnboundFamilyRecommendation,
} from "../../shared/unbound-family-recommendations";
import type { AllVariationFamilyRow } from "./unbound-variation-audit";
import type { UnboundVariationAuditSnapshot } from "./variation-catalog-reads";

function exactSku(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 40 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
function series(sku: string): { key: string; label: string } | null {
  // A single numeric variant code, stable prefix and suffix. Broad title or
  // substring similarity cannot provide enough evidence for a recommendation.
  const match = /^([A-Z]{3,}[A-Z-]*)([0-9]{1,4})([A-Z-]*)$/u.exec(sku);
  return match
    ? {
        key: `${match[1]}#${match[2].length}#${match[3]}`,
        label: `${match[1]}${"○".repeat(match[2].length)}${match[3]}`,
      }
    : null;
}

/** Pure enrichment of the existing main-owned snapshot, with no I/O or state. */
export function buildUnboundFamilyRecommendations(
  snapshot: Pick<
    UnboundVariationAuditSnapshot,
    "rows" | "incompleteRows" | "allVariationRows"
  >,
): UnboundFamilyRecommendation[] {
  const blockedSkus = new Set(
    snapshot.incompleteRows.map((row) => row.sellerSku),
  );
  const sourceCounts = new Map<string, number>();
  for (const row of snapshot.rows)
    sourceCounts.set(row.sellerSku, (sourceCounts.get(row.sellerSku) ?? 0) + 1);
  const familyBySku = new Map<string, AllVariationFamilyRow[]>();
  const childFamilies = new Map<string, string[]>();
  for (const row of snapshot.allVariationRows) {
    const rows = familyBySku.get(row.familySku) ?? [];
    rows.push(row);
    familyBySku.set(row.familySku, rows);
    if (row.role === "child") {
      const families = childFamilies.get(row.sellerSku) ?? [];
      families.push(row.familySku);
      childFamilies.set(row.sellerSku, families);
    }
  }
  const candidatesBySeries = new Map<string, UnboundFamilyCandidate[]>();
  for (const [parentSku, rows] of familyBySku) {
    const parents = rows.filter((row) => row.role === "parent");
    const children = rows.filter((row) => row.role === "child");
    if (
      !exactSku(parentSku) ||
      parents.length !== 1 ||
      parents[0].sellerSku !== parentSku ||
      children.length < 2
    )
      continue;
    if (
      children.some(
        (row) =>
          row.evidence !== "verified-child" ||
          !exactSku(row.sellerSku) ||
          blockedSkus.has(row.sellerSku) ||
          sourceCounts.has(row.sellerSku) ||
          childFamilies.get(row.sellerSku)?.length !== 1,
      )
    )
      continue;
    const types = new Set(children.map((row) => row.productType));
    const themes = new Set(children.map((row) => row.variationTheme));
    const productType = children[0].productType;
    const variationTheme = children[0].variationTheme;
    if (
      types.size !== 1 ||
      themes.size !== 1 ||
      !/^[A-Z][A-Z0-9_]{0,127}$/u.test(productType) ||
      !variationTheme ||
      variationTheme.length > 128 ||
      variationTheme !== variationTheme.trim() ||
      /[\u0000-\u001f\u007f]/u.test(variationTheme)
    )
      continue;
    const parent = parents[0];
    if (
      parent.evidence === "verified-parent" &&
      ((parent.productType && parent.productType !== productType) ||
        (parent.variationTheme && parent.variationTheme !== variationTheme))
    )
      continue;
    if (
      parent.evidence !== "verified-parent" &&
      parent.evidence !== "parent-sku-from-verified-child"
    )
      continue;
    const matches = new Map<string, { label: string; skus: string[] }>();
    for (const child of children) {
      const stem = series(child.sellerSku);
      if (!stem) continue;
      const match = matches.get(stem.key) ?? { label: stem.label, skus: [] };
      match.skus.push(child.sellerSku);
      matches.set(stem.key, match);
    }
    for (const [key, match] of matches) {
      if (match.skus.length < 2) continue;
      const candidates = candidatesBySeries.get(`${productType}:${key}`) ?? [];
      candidates.push({
        parentSku,
        parentTitle: parent.title,
        productType,
        variationTheme,
        matchingChildCount: match.skus.length,
        familyChildCount: children.length,
        matchingChildSkus: match.skus
          .sort((a, b) => a.localeCompare(b, "en"))
          .slice(0, 20),
        stars: match.skus.length >= 3 ? 3 : 2,
        tied: false,
        reasons: [
          `SKU 系列 ${match.label}`,
          `同商品類型，${match.skus.length} 個相似 SKU 已綁此 family`,
          `已讀取的 children 主題一致：${variationTheme}`,
        ],
      });
      candidatesBySeries.set(`${productType}:${key}`, candidates);
    }
  }
  return snapshot.rows
    .filter(
      (row) =>
        row.relationshipEvidence === "relationships" &&
        exactSku(row.sellerSku) &&
        sourceCounts.get(row.sellerSku) === 1 &&
        !blockedSkus.has(row.sellerSku) &&
        !familyBySku.has(row.sellerSku) &&
        !childFamilies.has(row.sellerSku),
    )
    .map((row) => {
      const stem = series(row.sellerSku);
      const ranked = stem
        ? [
            ...(candidatesBySeries.get(`${row.productType}:${stem.key}`) ?? []),
          ].sort(
            (a, b) =>
              b.matchingChildCount - a.matchingChildCount ||
              a.parentSku.localeCompare(b.parentSku, "en"),
          )
        : [];
      const tied =
        ranked.length > 1 &&
        ranked[0].matchingChildCount === ranked[1].matchingChildCount;
      return {
        sellerSku: row.sellerSku,
        status: ranked.length ? (tied ? "tied" : "ranked") : "insufficient",
        candidates: ranked
          .slice(0, 5)
          .map((candidate) => ({
            ...candidate,
            tied:
              tied &&
              candidate.matchingChildCount === ranked[0].matchingChildCount,
          })),
        notice: ranked.length
          ? "星等只代表同系列 SKU 證據多寡。相似不保證適合合併；選擇後仍須重新核對商品、主題、維度與 Amazon 預檢。"
          : "沒有足夠且一致的同系列證據。可自行輸入目標 family；不猜測 parent。",
      };
    });
}
