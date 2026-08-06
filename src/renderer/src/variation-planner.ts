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
  status: "blocked" | "read_only_review";
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
  expected: { marketplaceId: string; sellerSku: string },
): VariationFamilyView {
  if (!isRecord(value)) {
    throw new Error("Mac App Bridge 回傳的變體資料格式不正確。");
  }
  const parent = value.parent;
  const children = value.children;
  const excluded = value.excludedChildren;
  if (
    (value.mode !== "live" && value.mode !== "demo") ||
    value.marketplaceId !== expected.marketplaceId ||
    value.queriedSku !== expected.sellerSku ||
    !isRole(value.queriedRole) ||
    !isMember(value.queried) ||
    value.queried.sellerSku !== expected.sellerSku ||
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

function dimensionSignature(member: VariationMemberView): string | null {
  if (!member.dimensions.length) return null;
  const entries = member.dimensions
    .map(
      (dimension) =>
        [
          dimension.name,
          dimension.values
            .map((value) => value.trim())
            .filter(Boolean)
            .sort(),
        ] as const,
    )
    .filter(([, values]) => values.length)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? JSON.stringify(entries) : null;
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
    const sourceTheme = source.variationTheme ?? sourceFamily.variationTheme;
    const targetTheme =
      targetParent.variationTheme ?? targetFamily.variationTheme;
    if (!targetTheme) {
      blockers.push("目標 parent 缺少可確認的 variation theme。");
    } else if (sourceTheme && sourceTheme !== targetTheme) {
      blockers.push("來源與目標的 variation theme 不一致。");
    }
    const missingDimensions = missingRequiredDimensions(
      source,
      targetFamily.dimensionNames,
    );
    if (missingDimensions.length) {
      blockers.push(
        `來源 child 缺少目標 parent 必要變體維度值：${missingDimensions.join("、")}。`,
      );
    }
    const sourceSignature = dimensionSignature(source);
    if (!sourceSignature) {
      blockers.push("來源 child 缺少可確認的變體維度值。");
    } else if (
      targetFamily.children.some(
        (child) =>
          child.sellerSku !== source.sellerSku &&
          dimensionSignature(child) === sourceSignature,
      )
    ) {
      blockers.push("目標 family 已有相同變體維度值，可能形成重複 child。");
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
  warnings.push("v0.1.7 第一版只產生規劃，不會寫入或宣稱 Amazon 已變更。");

  return {
    source,
    targetParent: safeTarget,
    status: blockers.length ? "blocked" : "read_only_review",
    blockers,
    warnings,
    proposedSteps: source.parentSku
      ? [
          `另行移除 ${source.sellerSku} 與 ${source.parentSku} 的舊關係`,
          `另行以 ${safeTarget.sellerSku} 重建 child 關係`,
          "完成後重新唯讀查詢整個 family，逐一確認 child 與維度",
        ]
      : [
          `另行以 ${safeTarget.sellerSku} 建立 child 關係`,
          "完成後重新唯讀查詢整個 family，逐一確認 child 與維度",
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
