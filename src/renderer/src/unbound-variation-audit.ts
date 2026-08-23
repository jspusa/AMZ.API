export type UnboundVariationAuditRow = {
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  relationshipEvidence: "relationships";
  notice: string;
};

export type UnboundVariationAuditIncompleteRow = {
  sellerSku: string;
  asin: string;
  title: string;
  code: string;
  message: string;
  requestId: string | null;
};

export type AllVariationFamilyRow = {
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
};

export type UnboundVariationAuditSnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  exportId: string;
  rows: UnboundVariationAuditRow[];
  incompleteRows: UnboundVariationAuditIncompleteRow[];
  allVariationRows: AllVariationFamilyRow[];
  summary: {
    totalFbaListings: number;
    completed: number;
    unbound: number;
    boundChildren: number;
    parentContainers: number;
    incomplete: number;
  };
  notice: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}格式無法辨識。`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 5_000): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label}格式無法辨識。`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maximum = 5_000): string {
  return value === "" || value === null || value === undefined
    ? ""
    : text(value, label, maximum);
}

function exactSellerSku(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 40 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label}格式無法精確辨識。`);
  }
  return value;
}

function exactExportId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._-]{1,200}$/u.test(value)
  ) {
    throw new Error("Excel 匯出 ID 格式無法精確辨識。");
  }
  return value;
}

function count(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label}格式無法辨識。`);
  }
  return value as number;
}

function parseDate(value: unknown): string {
  const parsed = text(value, "健檢時間", 64);
  if (!Number.isFinite(new Date(parsed).getTime())) {
    throw new Error("健檢時間格式無法辨識。");
  }
  return parsed;
}

export function parseUnboundVariationAuditSnapshot(
  rawValue: unknown,
  expectedMarketplaceId: string,
): UnboundVariationAuditSnapshot {
  const raw = record(rawValue, "未綁變體健檢回應");
  const marketplaceId = text(raw.marketplaceId, "健檢站點", 32);
  if (marketplaceId !== expectedMarketplaceId) {
    throw new Error("未綁變體健檢回應站點不符，已停止顯示與快取。");
  }
  const mode = raw.mode === "live" || raw.mode === "demo" ? raw.mode : null;
  if (!mode) throw new Error("未綁變體健檢模式無法辨識。");
  const rawAllVariationRows = raw.allVariationRows === undefined
    ? []
    : raw.allVariationRows;
  if (
    !Array.isArray(raw.rows) ||
    !Array.isArray(raw.incompleteRows) ||
    !Array.isArray(rawAllVariationRows)
  ) {
    throw new Error("未綁變體健檢明細格式無法辨識。");
  }
  const rows = raw.rows.map((value, index): UnboundVariationAuditRow => {
    const row = record(value, `未綁變體第 ${index + 1} 筆`);
    if (row.relationshipEvidence !== "relationships") {
      throw new Error("未綁變體缺少 relationships 判定證據。");
    }
    return {
      sellerSku: exactSellerSku(row.sellerSku, "Seller SKU"),
      asin: optionalText(row.asin, "ASIN", 32),
      title: text(row.title, "商品標題"),
      productType: text(row.productType, "Product Type", 128),
      relationshipEvidence: "relationships",
      notice: text(row.notice, "判定依據"),
    };
  });
  const incompleteRows = raw.incompleteRows.map(
    (value, index): UnboundVariationAuditIncompleteRow => {
      const row = record(value, `未完成第 ${index + 1} 筆`);
      return {
        sellerSku: exactSellerSku(row.sellerSku, "未完成 Seller SKU"),
        asin: optionalText(row.asin, "未完成 ASIN", 32),
        title: optionalText(row.title, "未完成商品標題"),
        code: text(row.code, "未完成狀態碼", 80),
        message: text(row.message, "未完成原因"),
        requestId: row.requestId === null || row.requestId === undefined
          ? null
          : text(row.requestId, "Amazon Request ID", 200),
      };
    },
  );
  const seenFamilies = new Set<string>();
  let currentFamilySku: string | null = null;
  const allVariationRows = rawAllVariationRows.map(
    (value, index): AllVariationFamilyRow => {
      const row = record(value, `所有變體第 ${index + 1} 筆`);
      const familySku = exactSellerSku(row.familySku, "變體家庭 Parent SKU");
      const sellerSku = exactSellerSku(row.sellerSku, "所有變體 Seller SKU");
      const role = row.role === "parent" || row.role === "child"
        ? row.role
        : null;
      if (!role) throw new Error("所有變體角色格式無法辨識。");
      const evidence = row.evidence === "verified-parent" ||
          row.evidence === "verified-child" ||
          row.evidence === "parent-sku-from-verified-child"
        ? row.evidence
        : null;
      if (!evidence) throw new Error("所有變體 relationships 證據格式無法辨識。");
      if (role === "parent") {
        if (
          sellerSku !== familySku ||
          seenFamilies.has(familySku) ||
          evidence === "verified-child"
        ) {
          throw new Error("每個父變體必須以唯一 Parent SKU 開始，才能接續子變體。");
        }
        seenFamilies.add(familySku);
        currentFamilySku = familySku;
      } else if (
        currentFamilySku !== familySku ||
        evidence !== "verified-child"
      ) {
        throw new Error("所有變體中每個父變體必須先出現，下面才能接續其子變體。");
      }
      return {
        familySku,
        role,
        sellerSku,
        title: optionalText(row.title, "所有變體商品標題"),
        productType: optionalText(row.productType, "所有變體 Product Type", 128),
        variationTheme: row.variationTheme === null || row.variationTheme === ""
          ? null
          : text(row.variationTheme, "所有變體 Variation Theme", 128),
        evidence,
      };
    },
  );
  const allSkus = [...rows, ...incompleteRows].map((row) => row.sellerSku);
  if (new Set(allSkus).size !== allSkus.length) {
    throw new Error("未綁變體與讀取未完成清單含有重複 SKU，已停止顯示。");
  }
  const rawSummary = record(raw.summary, "未綁變體健檢摘要");
  const summary = {
    totalFbaListings: count(rawSummary.totalFbaListings, "全部 FBA SKU 數"),
    completed: count(rawSummary.completed, "已完成數"),
    unbound: count(rawSummary.unbound, "未綁變體數"),
    boundChildren: count(rawSummary.boundChildren, "已綁 child 數"),
    parentContainers: count(rawSummary.parentContainers, "parent 容器數"),
    incomplete: count(rawSummary.incomplete, "讀取未完成數"),
  };
  if (
    summary.unbound !== rows.length ||
    summary.incomplete !== incompleteRows.length ||
    summary.completed + summary.incomplete !== summary.totalFbaListings ||
    summary.unbound + summary.boundChildren + summary.parentContainers !==
      summary.completed
  ) {
    throw new Error("未綁變體健檢摘要與明細數量不一致，已停止顯示。");
  }
  return {
    mode,
    marketplaceId,
    fetchedAt: parseDate(raw.fetchedAt),
    exportId: exactExportId(raw.exportId),
    rows,
    incompleteRows,
    allVariationRows,
    summary,
    notice: text(raw.notice, "健檢說明"),
  };
}
