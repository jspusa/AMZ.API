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
      (Array.isArray(skus) && skus.length > 0 && skus.every(isExactIdentifier)),
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
  if (input.role === "parent") return { kind: "parent-container" };
  if (input.role === "child") return { kind: "bound-child" };
  return { kind: "unbound" };
}
