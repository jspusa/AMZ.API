export type UnboundVariationEvidenceInput = {
  marketplaceId: string;
  profile: "relationships" | "attributes";
  relationships: unknown;
  role: "parent" | "child" | "standalone";
  listingFulfillmentEvidence: "FBA" | "OTHER" | "MISSING";
};

export type UnboundVariationEvidenceResult =
  | { kind: "unbound" }
  | { kind: "bound-child" }
  | { kind: "parent-container" }
  | {
      kind: "incomplete";
      code:
        | "RELATIONSHIPS_NOT_RETURNED"
        | "RELATIONSHIPS_COMPATIBILITY_FALLBACK"
        | "RELATIONSHIP_RESPONSE_INVALID"
        | "FULFILLMENT_EVIDENCE_CONFLICT";
      message: string;
    };

export type VerifiedVariationFamilyMember = Readonly<{
  sellerSku: string;
  title: string;
  productType: string;
  role: "parent" | "child" | "standalone";
  parentSku: string | null;
  variationTheme: string | null;
}>;

export type AllVariationFamilyRow = Readonly<{
  familySku: string;
  role: "parent" | "child";
  sellerSku: string;
  title: string;
  productType: string;
  variationTheme: string | null;
  evidence:
    | "verified-parent"
    | "verified-child"
    | "parent-sku-from-verified-child";
}>;

/**
 * Produces a deterministic SKU-only family view from already verified Amazon
 * relationship rows. Standalone listings are intentionally excluded. When an
 * FBA child points to a parent container that is not itself present in the FBA
 * report, the exact parent SKU returned by Amazon becomes a synthetic heading
 * row; no title, ASIN, product type, or variation theme is guessed for that
 * parent.
 */
export function buildAllVariationFamilyRows(
  members: readonly VerifiedVariationFamilyMember[],
): AllVariationFamilyRow[] {
  const families = new Map<string, {
    parent: VerifiedVariationFamilyMember | null;
    children: VerifiedVariationFamilyMember[];
  }>();
  for (const member of members) {
    if (member.role === "standalone") continue;
    const familySku = member.role === "parent"
      ? member.sellerSku
      : member.parentSku;
    if (!familySku) continue;
    const family = families.get(familySku) ?? { parent: null, children: [] };
    if (member.role === "parent") {
      family.parent = member;
    } else {
      family.children.push(member);
    }
    families.set(familySku, family);
  }

  const rows: AllVariationFamilyRow[] = [];
  for (const familySku of [...families.keys()].sort((left, right) =>
    left.localeCompare(right, "en"))) {
    const family = families.get(familySku)!;
    // Only a relationship row for the parent itself can prove the parent's
    // variation theme. Child themes may conflict, and copying even a single
    // child's value onto a synthetic parent would turn child evidence into a
    // guessed parent attribute.
    const parentTheme = family.parent?.variationTheme ?? null;
    rows.push(family.parent
      ? {
          familySku,
          role: "parent",
          sellerSku: family.parent.sellerSku,
          title: family.parent.title,
          productType: family.parent.productType,
          variationTheme: parentTheme,
          evidence: "verified-parent",
        }
      : {
          familySku,
          role: "parent",
          sellerSku: familySku,
          title: "",
          productType: "",
          variationTheme: parentTheme,
          evidence: "parent-sku-from-verified-child",
        });
    for (const child of [...family.children].sort((left, right) =>
      left.sellerSku.localeCompare(right.sellerSku, "en"))) {
      rows.push({
        familySku,
        role: "child",
        sellerSku: child.sellerSku,
        title: child.title,
        productType: child.productType,
        variationTheme: child.variationTheme,
        evidence: "verified-child",
      });
    }
  }
  return rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExactIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value) &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isRelationshipEntry(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const parentSkus = value.parentSkus;
  const childSkus = value.childSkus;
  if (parentSkus === undefined && childSkus === undefined) return false;
  return [parentSkus, childSkus].every(
    (skus) =>
      skus === undefined ||
      (Array.isArray(skus) &&
        skus.length > 0 &&
        skus.every(isExactIdentifier) &&
        new Set(skus).size === skus.length),
  );
}

function isRelationshipGroup(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (!isExactIdentifier(value.marketplaceId)) return false;
  return (
    Array.isArray(value.relationships) &&
    value.relationships.every(isRelationshipEntry)
  );
}

function invalidRelationshipResponse(): UnboundVariationEvidenceResult {
  return {
    kind: "incomplete",
    code: "RELATIONSHIP_RESPONSE_INVALID",
    message: "Amazon relationships 群組格式不完整，無法安全判定 parent 關係。",
  };
}

/**
 * Classifies one SKU only when Amazon returned an explicit relationships
 * dataset for the selected marketplace. A missing dataset is never treated as
 * proof that a child has no parent.
 */
export function classifyUnboundVariationEvidence(
  input: UnboundVariationEvidenceInput,
): UnboundVariationEvidenceResult {
  if (input.listingFulfillmentEvidence === "OTHER") {
    return {
      kind: "incomplete",
      code: "FULFILLMENT_EVIDENCE_CONFLICT",
      message:
        "FBA 報表與 Listings fulfillmentAvailability 的履約證據不一致，未列為未綁變體。",
    };
  }
  if (input.profile !== "relationships") {
    return {
      kind: "incomplete",
      code: "RELATIONSHIPS_COMPATIBILITY_FALLBACK",
      message:
        "Amazon 拒絕 relationships 資料集；僅有 attributes 相容資料，不足以證明沒有 parent。",
    };
  }
  if (!Array.isArray(input.relationships)) {
    return {
      kind: "incomplete",
      code: "RELATIONSHIPS_NOT_RETURNED",
      message:
        "Amazon 沒有回傳 relationships 資料集；缺資料不會被誤列為未綁變體。",
    };
  }
  if (!input.relationships.every(isRelationshipGroup)) {
    return invalidRelationshipResponse();
  }
  const relevantGroups = input.relationships.filter(
    (group) => group.marketplaceId === input.marketplaceId,
  );
  if (input.relationships.length > 0 && relevantGroups.length !== 1) {
    return {
      kind: "incomplete",
      code: "RELATIONSHIP_RESPONSE_INVALID",
      message: relevantGroups.length === 0
        ? "Amazon 只回傳其他站點的 relationships，無法判定目前站點。"
        : "Amazon 同時回傳多個目前站點的 relationships 群組，無法唯一判定。",
    };
  }
  const relationshipEntries = relevantGroups.flatMap((group) =>
    group.relationships as Record<string, unknown>[]
  );
  const parentSkus = new Set(
    relationshipEntries.flatMap((relationship) =>
      Array.isArray(relationship.parentSkus)
        ? relationship.parentSkus as string[]
        : []
    ),
  );
  const childSkus = new Set(
    relationshipEntries.flatMap((relationship) =>
      Array.isArray(relationship.childSkus)
        ? relationship.childSkus as string[]
        : []
    ),
  );
  if (parentSkus.size > 1 || (parentSkus.size > 0 && childSkus.size > 0)) {
    return invalidRelationshipResponse();
  }
  const relationshipRole = parentSkus.size > 0
    ? "child"
    : childSkus.size > 0
      ? "parent"
      : "standalone";
  if (input.role !== relationshipRole) return invalidRelationshipResponse();
  if (relationshipRole === "parent") return { kind: "parent-container" };
  if (relationshipRole === "child") return { kind: "bound-child" };
  return { kind: "unbound" };
}
