export type VariationRole = "parent" | "child" | "standalone";

export type VariationDimensionView = {
  name: string;
  label: string;
  values: string[];
};

export type VariationMemberView = {
  sellerSku: string;
  asin: string | null;
  title: string;
  productType: string;
  status: string[];
  role: VariationRole;
  parentSku: string | null;
  childSkus: string[];
  variationTheme: string | null;
  dimensions: VariationDimensionView[];
  fba: boolean;
  issues: Array<{
    code: string | null;
    severity: string;
    message: string;
    attributeNames: string[];
  }>;
  relationshipSources: Array<"relationships" | "attributes" | "variationParentSku">;
};

export type VariationFamilyView = {
  mode: "live" | "demo";
  marketplaceId: string;
  queriedSku: string;
  queriedRole: VariationRole;
  queried: VariationMemberView;
  parent: VariationMemberView | null;
  children: VariationMemberView[];
  excludedChildren: Array<{ sellerSku: string; reason: string }>;
  variationTheme: string | null;
  dimensionNames: string[];
  familyComplete: boolean;
  fetchedAt: string;
  requestIds: string[];
  writable: false;
  boundaries: string[];
  notice: string;
};

export type VariationMovePlan = {
  source: VariationMemberView;
  targetParent: VariationMemberView;
  status: "blocked" | "ready_to_prepare";
  blockers: string[];
  warnings: string[];
  proposedSteps: string[];
};

export type VariationLookupKeyAction = "ignore" | "suppress" | "lookup";

export function variationLookupKeyAction(
  key: string,
  isComposing: boolean,
): VariationLookupKeyAction {
  if (key !== "Enter") return "ignore";
  return isComposing ? "suppress" : "lookup";
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRole(value: unknown): value is VariationRole {
  return value === "parent" || value === "child" || value === "standalone";
}

function isDimension(value: unknown): value is VariationDimensionView {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Boolean(value.name.trim()) &&
    typeof value.label === "string" &&
    isStrings(value.values)
  );
}

function isIssue(value: unknown): value is VariationMemberView["issues"][number] {
  return (
    isRecord(value) &&
    (value.code === null || typeof value.code === "string") &&
    typeof value.severity === "string" &&
    typeof value.message === "string" &&
    isStrings(value.attributeNames)
  );
}

function isMember(value: unknown): value is VariationMemberView {
  if (!isRecord(value)) return false;
  const sources = value.relationshipSources;
  return (
    typeof value.sellerSku === "string" &&
    Boolean(value.sellerSku.trim()) &&
    (value.asin === null || typeof value.asin === "string") &&
    typeof value.title === "string" &&
    typeof value.productType === "string" &&
    isStrings(value.status) &&
    isRole(value.role) &&
    (value.parentSku === null || typeof value.parentSku === "string") &&
    isStrings(value.childSkus) &&
    (value.variationTheme === null || typeof value.variationTheme === "string") &&
    Array.isArray(value.dimensions) &&
    value.dimensions.every(isDimension) &&
    typeof value.fba === "boolean" &&
    Array.isArray(value.issues) &&
    value.issues.every(isIssue) &&
    Array.isArray(sources) &&
    sources.every(
      (source) =>
        source === "relationships" ||
        source === "attributes" ||
        source === "variationParentSku",
    )
  );
}

export function parseVariationFamilyResponse(
  value: unknown,
  expected:
    | { marketplaceId: string; sellerSku: string; asin?: never }
    | { marketplaceId: string; asin: string; sellerSku?: never },
): VariationFamilyView {
  if (!isRecord(value)) {
    throw new Error("Mac App Bridge 回傳的變體資料格式不正確。");
  }
  const parent = value.parent;
  const children = value.children;
  const excluded = value.excludedChildren;
  const expectedSellerSku = "sellerSku" in expected
    ? expected.sellerSku
    : null;
  const expectedAsin = "asin" in expected ? expected.asin : null;
  if (
    (value.mode !== "live" && value.mode !== "demo") ||
    value.marketplaceId !== expected.marketplaceId ||
    (expectedSellerSku !== null && value.queriedSku !== expectedSellerSku) ||
    !isRole(value.queriedRole) ||
    !isMember(value.queried) ||
    value.queried.sellerSku !== value.queriedSku ||
    (expectedAsin !== null && value.queried.asin !== expectedAsin) ||
    value.queried.role !== value.queriedRole ||
    (parent !== null && (!isMember(parent) || parent.role !== "parent")) ||
    !Array.isArray(children) ||
    !children.every((child) => isMember(child) && child.role === "child" && child.fba) ||
    !Array.isArray(excluded) ||
    !excluded.every(
      (item) =>
        isRecord(item) &&
        typeof item.sellerSku === "string" &&
        typeof item.reason === "string",
    ) ||
    (value.variationTheme !== null && typeof value.variationTheme !== "string") ||
    !isStrings(value.dimensionNames) ||
    value.dimensionNames.some((name) => !name.trim()) ||
    typeof value.familyComplete !== "boolean" ||
    typeof value.fetchedAt !== "string" ||
    !isStrings(value.requestIds) ||
    value.writable !== false ||
    !isStrings(value.boundaries) ||
    typeof value.notice !== "string"
  ) {
    throw new Error("Mac App Bridge 回傳的變體資料不完整，已停止規劃。");
  }
  if (value.queried.role !== "parent" && !value.queried.fba) {
    throw new Error("查詢結果無法確認為 FBA 子商品，已停止規劃。");
  }
  const childSkus = children.map((child) => child.sellerSku);
  if (new Set(childSkus).size !== childSkus.length) {
    throw new Error("Amazon 回傳重複的 child SKU，已停止規劃。");
  }
  return value as VariationFamilyView;
}

function dimensionSignature(
  member: VariationMemberView,
  requiredNames: string[],
): string | null {
  const names = [...new Set(requiredNames.map((name) => name.trim()))]
    .filter(Boolean)
    .sort();
  if (!names.length) return null;
  const entries = names.map((name) => {
    const values = member.dimensions
      .find((dimension) => dimension.name === name)
      ?.values.map((value) => value.trim())
      .filter(Boolean)
      .sort() ?? [];
    return [name, values] as const;
  });
  return entries.every(([, values]) => values.length)
    ? JSON.stringify(entries)
    : null;
}

function missingRequiredDimensions(
  source: VariationMemberView,
  requiredNames: string[],
): string[] {
  const required = [...new Set(requiredNames.map((name) => name.trim()))];
  return required.filter(
    (name) =>
      !source.dimensions.some(
        (dimension) =>
          dimension.name === name &&
          dimension.values.some((value) => Boolean(value.trim())),
      ),
  );
}

export function buildVariationMovePlan(
  sourceFamily: VariationFamilyView,
  source: VariationMemberView,
  targetFamily: VariationFamilyView,
): VariationMovePlan {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const targetParent =
    targetFamily.queried.role === "parent"
      ? targetFamily.queried
      : targetFamily.parent;

  if (sourceFamily.marketplaceId !== targetFamily.marketplaceId) {
    blockers.push("來源與目標不在同一個 Amazon 站點，不能規劃跨站變體。");
  }
  if (!sourceFamily.familyComplete) {
    blockers.push("來源 family 清單不完整，無法安全判斷目前關係。");
  }
  if (!targetFamily.familyComplete) {
    blockers.push("目標 family 清單不完整，無法安全檢查重複 child。");
  }
  if (source.role === "parent") {
    blockers.push("Parent 是唯讀容器，只有 FBA child 或獨立 FBA SKU 可加入規劃。");
  }
  if (!source.fba) {
    blockers.push("來源 SKU 無法確認為 FBA；純 FBA 規劃不會納入 FBM。");
  }
  if (!targetParent) {
    blockers.push("目標 SKU 不是可確認的 parent 容器。");
  }

  const safeTarget: VariationMemberView = targetParent ?? targetFamily.queried;
  if (targetParent) {
    if (source.parentSku === targetParent.sellerSku) {
      blockers.push("這個 child 已經屬於目標 parent，沒有可規劃的變更。");
    }
    if (
      source.productType &&
      targetParent.productType &&
      source.productType !== targetParent.productType
    ) {
      blockers.push("來源與目標的 Amazon product type 不一致。");
    }
    const targetTheme =
      targetParent.variationTheme ?? targetFamily.variationTheme;
    if (!targetTheme) {
      blockers.push("目標 parent 缺少可確認的 variation theme。");
    }
    const missingDimensions = missingRequiredDimensions(
      source,
      targetFamily.dimensionNames,
    );
    if (missingDimensions.length) {
      warnings.push(
        `來源 child 目前缺少目標 parent 維度：${missingDimensions.join("、")}；下一步會開啟 Amazon CHILD PTD 欄位，補齊前不能預檢或寫入。`,
      );
    }
    const sourceSignature = dimensionSignature(
      source,
      targetFamily.dimensionNames,
    );
    if (!sourceSignature) {
      if (!missingDimensions.length) {
        warnings.push("來源 child 的目標維度值要在 Amazon CHILD PTD 編輯器重新確認。");
      }
    } else if (
      targetFamily.children.some(
        (child) =>
          child.sellerSku !== source.sellerSku &&
          dimensionSignature(child, targetFamily.dimensionNames) === sourceSignature,
      )
    ) {
      warnings.push(
        "來源目前的目標維度與既有 child 重複；請先在 CHILD PTD 編輯器改成唯一值，正式預檢仍會重新檢查並阻擋重複。",
      );
    }
  }

  if (source.parentSku) {
    warnings.push(
      `目前 child 屬於 ${source.parentSku}；改掛 ${safeTarget.sellerSku} 必須先移除舊關係再重建。`,
    );
    warnings.push("移除與重建至少是兩個非原子步驟，中途可能暫時沒有 family 關係。");
  } else {
    warnings.push("此 SKU 目前沒有 parent；正式建立關係仍需另外設計安全寫入流程。");
  }
  warnings.push(
    "只有 Amazon Validation Preview、Touch ID 與送出後唯讀回查全部完成，介面才會標示該階段成功。",
  );

  return {
    source,
    targetParent: safeTarget,
    status: blockers.length ? "blocked" : "ready_to_prepare",
    blockers,
    warnings,
    proposedSteps: source.parentSku
      ? [
          `預檢並解除 ${source.sellerSku} 與 ${source.parentSku} 的舊關係`,
          "Touch ID 後送出解除，並唯讀回查為獨立 SKU",
          `補齊 CHILD PTD 欄位後，預檢並加入 ${safeTarget.sellerSku}`,
          "Touch ID 後送出加入，並唯讀回查 parent、theme 與維度",
        ]
      : [
          `補齊 CHILD PTD 欄位後，預檢並加入 ${safeTarget.sellerSku}`,
          "Touch ID 後送出加入，並唯讀回查 parent、theme 與維度",
        ],
  };
}

export function variationFamilyErrorMessage(
  status: number,
  problem: { code?: string; message?: string },
): string {
  if (problem.message?.trim()) return problem.message.trim();
  if (status === 404) return "Amazon 找不到這個 Seller SKU。";
  if (status === 422 || problem.code === "FBA_ONLY") {
    return "這個 SKU 無法確認為 FBA child 或 parent 容器。";
  }
  if (status === 401 || status === 403) {
    return "Amazon 拒絕 Listings 變體查詢，請重新檢查 Product Listing 授權。";
  }
  return "目前無法載入 Amazon 變體 family。";
}
