import type { UnboundFamilyRecommendation } from "../../shared/unbound-family-recommendations";
import type {
  AllVariationFamilyRow,
  UnboundVariationAuditRow,
} from "./unbound-variation-audit";

export function parseUnboundFamilyRecommendations(
  raw: unknown,
  sources: UnboundVariationAuditRow[],
  families: AllVariationFamilyRow[],
): UnboundFamilyRecommendation[] {
  if (raw === undefined) return [];
  const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const sourceBySku = new Map(sources.map((row) => [row.sellerSku, row]));
  const seen = new Set<string>();
  if (!Array.isArray(raw) || raw.length > sources.length)
    throw new Error("變體建議格式不完整，請重新掃描。");
  return raw.map((value) => {
    if (
      !record(value) ||
      typeof value.sellerSku !== "string" ||
      !sourceBySku.has(value.sellerSku) ||
      seen.has(value.sellerSku) ||
      !["ranked", "tied", "insufficient"].includes(String(value.status)) ||
      !Array.isArray(value.candidates) ||
      value.candidates.length > 5 ||
      typeof value.notice !== "string"
    )
      throw new Error("變體建議與確定未綁清單不符，已停止顯示。");
    seen.add(value.sellerSku);
    const source = sourceBySku.get(value.sellerSku)!;
    const parents = new Set<string>();
    for (const candidate of value.candidates) {
      if (
        !record(candidate) ||
        typeof candidate.parentSku !== "string" ||
        parents.has(candidate.parentSku) ||
        typeof candidate.parentTitle !== "string" ||
        candidate.productType !== source.productType ||
        typeof candidate.variationTheme !== "string" ||
        !candidate.variationTheme ||
        !Number.isSafeInteger(candidate.matchingChildCount) ||
        (candidate.matchingChildCount as number) < 2 ||
        !Number.isSafeInteger(candidate.familyChildCount) ||
        (candidate.familyChildCount as number) <
          (candidate.matchingChildCount as number) ||
        typeof candidate.stars !== "number" ||
        ![2, 3].includes(candidate.stars) ||
        typeof candidate.tied !== "boolean" ||
        !Array.isArray(candidate.matchingChildSkus) ||
        candidate.matchingChildSkus.length !==
          Math.min(candidate.matchingChildCount as number, 20) ||
        new Set(candidate.matchingChildSkus).size !==
          candidate.matchingChildSkus.length ||
        !Array.isArray(candidate.reasons) ||
        candidate.reasons.length > 6 ||
        !candidate.reasons.every((reason) => typeof reason === "string")
      )
        throw new Error("變體建議的 family 證據不完整，已停止顯示。");
      parents.add(candidate.parentSku);
      const children = families.filter(
        (row) =>
          row.familySku === candidate.parentSku &&
          row.role === "child" &&
          row.evidence === "verified-child",
      );
      if (
        !families.some(
          (row) =>
            row.familySku === candidate.parentSku && row.role === "parent",
        ) ||
        children.length !== candidate.familyChildCount ||
        !candidate.matchingChildSkus.every((sku) =>
          children.some(
            (row) =>
              row.sellerSku === sku &&
              row.productType === candidate.productType &&
              row.variationTheme === candidate.variationTheme,
          ),
        )
      )
        throw new Error("變體建議不屬於本次已驗證 family，已停止顯示。");
    }
    if ((value.status === "insufficient") !== (value.candidates.length === 0))
      throw new Error("變體建議狀態不一致，已停止顯示。");
    return value as UnboundFamilyRecommendation;
  });
}
