export type BrandSalesKey =
  | "afreschi"
  | "gootoe"
  | "herz"
  | "vitaday"
  | "healthy-moment"
  | "unclassified";

export type BrandSalesDefinition = {
  key: BrandSalesKey;
  label: string;
  color: string;
};

export type CategorySalesKey =
  | "turkey-tendon"
  | "turkey"
  | "chicken"
  | "salmon"
  | "buffalo"
  | "fish"
  | "air-dried"
  | "other";

export type CategorySalesDefinition = {
  key: CategorySalesKey;
  label: string;
  color: string;
};

export const BRAND_SALES_DEFINITIONS: readonly BrandSalesDefinition[] = [
  { key: "afreschi", label: "Afreschi", color: "#2F855A" },
  { key: "gootoe", label: "GooToE", color: "#ED8936" },
  { key: "herz", label: "Herz", color: "#3182CE" },
  { key: "vitaday", label: "Vitaday", color: "#ECC94B" },
  { key: "healthy-moment", label: "Healthy Moment", color: "#E53E3E" },
  { key: "unclassified", label: "未分類", color: "#A0A7B1" },
] as const;

// Source: https://github.com/jspusa/Supply/blob/main/index.html
// Keep this order and wording aligned with its public BUSINESS REPORT
// classifier. The first keyword by character position wins; this definition
// order is used only when two patterns start at the same position.
export const CATEGORY_SALES_DEFINITIONS: readonly CategorySalesDefinition[] = [
  { key: "turkey-tendon", label: "Turkey Tendons/Tendon", color: "#b45309" },
  { key: "turkey", label: "Turkey", color: "#f59e0b" },
  { key: "chicken", label: "Chicken", color: "#ef4444" },
  { key: "salmon", label: "Salmon", color: "#f97316" },
  { key: "buffalo", label: "Buffalo", color: "#7c3aed" },
  { key: "fish", label: "Fish", color: "#0284c7" },
  { key: "air-dried", label: "Air Dried", color: "#10b981" },
  { key: "other", label: "其他", color: "#94a3b8" },
] as const;

export type BrandSalesListing = {
  sellerSku: string;
  title: string;
};

export type BrandShipmentSale = {
  shipmentDate: string;
  sellerSku: string;
  quantity: number;
  unitPrice: number;
  currencyCode: string;
};

export type BrandSalesSnapshot = {
  schemaVersion: 2;
  mode: "live" | "demo";
  marketplaceId: string;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  dataThrough: string;
  rangeFreshness: "complete-days" | "includes-current-day";
  currencyCode: string;
  segments: Array<BrandSalesDefinition & {
    amount: number;
    percentage: number;
    skuCount: number;
    unitCount: number;
  }>;
  categorySegments: Array<CategorySalesDefinition & {
    amount: number;
    percentage: number;
    skuCount: number;
    unitCount: number;
  }>;
  summary: {
    amount: number;
    unitCount: number;
    classifiedAmount: number;
    unclassifiedAmount: number;
    currentFbaSkuCount: number;
    soldFbaSkuCount: number;
    soldCurrentFbaSkuCount: number;
    unmatchedCurrentFbaRowCount: number;
  };
  source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT";
  notice: string;
};

function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/u, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "\t" && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  if (quoted) throw new Error("Amazon 報表含有未結束的引號。");
  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
}

function column(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  return candidates
    .map((candidate) => normalized.indexOf(candidate))
    .find((index) => index >= 0) ?? -1;
}

function requiredColumn(headers: string[], candidates: string[], label: string): number {
  const index = column(headers, candidates);
  if (index < 0) throw new Error(`Amazon 報表找不到「${label}」欄位。`);
  return index;
}

function validSku(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 40 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function nonNegativeNumber(value: string, label: string): number {
  const normalized = value.trim().replace(/,/gu, "");
  if (!/^(?:\d+|\d+\.\d+)$/u.test(normalized)) {
    throw new Error(`Amazon FBA 出貨報表的「${label}」不是有效數字。`);
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Amazon FBA 出貨報表的「${label}」超出安全範圍。`);
  }
  return number;
}

export function parseFbaShipmentSalesReport(text: string): BrandShipmentSale[] {
  const rows = parseDelimited(text);
  const headers = rows[0] ?? [];
  const dateIndex = requiredColumn(headers, ["shipment-date"], "出貨日期");
  const skuIndex = requiredColumn(headers, ["sku", "seller-sku"], "Seller SKU");
  const quantityIndex = requiredColumn(headers, ["quantity"], "數量");
  const unitPriceIndex = requiredColumn(
    headers,
    ["item-price-per-unit"],
    "單件商品售價",
  );
  const currencyIndex = requiredColumn(headers, ["currency"], "幣別");

  return rows.slice(1).map((row): BrandShipmentSale => {
    const shipmentDate = row[dateIndex]?.trim() ?? "";
    const sellerSku = row[skuIndex] ?? "";
    const quantity = nonNegativeNumber(row[quantityIndex] ?? "", "數量");
    const unitPrice = nonNegativeNumber(row[unitPriceIndex] ?? "", "單件商品售價");
    const currencyCode = row[currencyIndex]?.trim() ?? "";
    const parsedDate = Date.parse(shipmentDate);
    if (
      !shipmentDate ||
      Number.isNaN(parsedDate) ||
      !validSku(sellerSku) ||
      !Number.isSafeInteger(quantity) ||
      !/^[A-Z]{3}$/u.test(currencyCode)
    ) {
      throw new Error("Amazon FBA 出貨報表含有無法安全辨識的資料列。");
    }
    return { shipmentDate, sellerSku, quantity, unitPrice, currencyCode };
  });
}

function normalizedBrandText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

const BRAND_ALIASES: Readonly<Record<Exclude<BrandSalesKey, "unclassified">, string[]>> = {
  afreschi: ["afreschi", "a freschi", "a freschi srl"],
  gootoe: ["gootoe"],
  herz: ["herz"],
  vitaday: ["vitaday"],
  "healthy-moment": ["healthy moment"],
};

function containsPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

export function classifyListingBrand(title: string): BrandSalesKey {
  const normalized = normalizedBrandText(title);
  const matches = (Object.entries(BRAND_ALIASES) as Array<
    [Exclude<BrandSalesKey, "unclassified">, string[]]
  >).filter(([, aliases]) => aliases.some((alias) => containsPhrase(normalized, alias)));
  return matches.length === 1 ? matches[0][0] : "unclassified";
}

const CATEGORY_PATTERNS: Readonly<Record<Exclude<CategorySalesKey, "other">, readonly RegExp[]>> = {
  "turkey-tendon": [/\bturkey[\s-]+tendons?\b/iu, /\btendons?\b/iu],
  turkey: [/\bturkey\b/iu],
  chicken: [/\bchicken\b/iu],
  salmon: [/\bsalmon\b/iu],
  buffalo: [/\bbuffalo\b/iu],
  fish: [/\bfish\b/iu],
  "air-dried": [/\bair[\s-]*dried\b/iu],
};

export function classifyListingCategory(title: string): CategorySalesKey {
  const text = String(title ?? "");
  let winner: { key: Exclude<CategorySalesKey, "other">; index: number; priority: number } | null = null;
  for (let priority = 0; priority < CATEGORY_SALES_DEFINITIONS.length - 1; priority += 1) {
    const definition = CATEGORY_SALES_DEFINITIONS[priority];
    const key = definition.key as Exclude<CategorySalesKey, "other">;
    for (const pattern of CATEGORY_PATTERNS[key]) {
      const index = text.search(pattern);
      if (
        index >= 0 &&
        (!winner || index < winner.index || (index === winner.index && priority < winner.priority))
      ) {
        winner = { key, index, priority };
      }
    }
  }
  return winner?.key ?? "other";
}

function currencyScale(currencyCode: string): number {
  return currencyCode === "JPY" ? 1 : 100;
}

export function buildBrandSalesSnapshot(input: {
  mode: "live" | "demo";
  marketplaceId: string;
  startDate: string;
  endDate: string;
  currencyCode: string;
  listings: BrandSalesListing[];
  sales: BrandShipmentSale[];
  dataThrough: string;
  rangeFreshness: "complete-days" | "includes-current-day";
  fetchedAt?: string;
}): BrandSalesSnapshot {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(input.endDate)) {
    throw new Error("品牌營收日期範圍無效。");
  }
  if (!/^[A-Z]{3}$/u.test(input.currencyCode)) throw new Error("品牌營收幣別無效。");
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  if (
    !Number.isFinite(Date.parse(input.dataThrough)) ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    Date.parse(input.dataThrough) > Date.parse(fetchedAt) ||
    (input.rangeFreshness !== "complete-days" &&
      input.rangeFreshness !== "includes-current-day")
  ) {
    throw new Error("品牌營收資料截止時間無效。");
  }
  const listingBySku = new Map<string, BrandSalesListing>();
  for (const listing of input.listings) {
    if (
      !validSku(listing.sellerSku) ||
      typeof listing.title !== "string" ||
      listingBySku.has(listing.sellerSku)
    ) {
      throw new Error("目前 FBA 商品清單無法安全用於品牌營收。");
    }
    listingBySku.set(listing.sellerSku, listing);
  }

  const scale = currencyScale(input.currencyCode);
  const centsByBrand = new Map<BrandSalesKey, number>();
  const unitsByBrand = new Map<BrandSalesKey, number>();
  const skusByBrand = new Map<BrandSalesKey, Set<string>>();
  const centsByCategory = new Map<CategorySalesKey, number>();
  const unitsByCategory = new Map<CategorySalesKey, number>();
  const skusByCategory = new Map<CategorySalesKey, Set<string>>();
  let unmatchedCurrentFbaRowCount = 0;
  const soldFbaSkus = new Set<string>();
  const soldCurrentFbaSkus = new Set<string>();
  for (const sale of input.sales) {
    if (sale.currencyCode !== input.currencyCode) {
      throw new Error("Amazon FBA 出貨報表幣別與目前站點不一致。");
    }
    const listing = listingBySku.get(sale.sellerSku);
    if (!listing) unmatchedCurrentFbaRowCount += 1;
    else soldCurrentFbaSkus.add(sale.sellerSku);
    const brand = listing ? classifyListingBrand(listing.title) : "unclassified";
    const category = listing ? classifyListingCategory(listing.title) : "other";
    const minorUnits = Math.round(sale.unitPrice * sale.quantity * scale);
    if (!Number.isSafeInteger(minorUnits)) throw new Error("品牌營收金額超出安全範圍。");
    centsByBrand.set(brand, (centsByBrand.get(brand) ?? 0) + minorUnits);
    unitsByBrand.set(brand, (unitsByBrand.get(brand) ?? 0) + sale.quantity);
    const skus = skusByBrand.get(brand) ?? new Set<string>();
    skus.add(sale.sellerSku);
    skusByBrand.set(brand, skus);
    centsByCategory.set(category, (centsByCategory.get(category) ?? 0) + minorUnits);
    unitsByCategory.set(category, (unitsByCategory.get(category) ?? 0) + sale.quantity);
    const categorySkus = skusByCategory.get(category) ?? new Set<string>();
    categorySkus.add(sale.sellerSku);
    skusByCategory.set(category, categorySkus);
    soldFbaSkus.add(sale.sellerSku);
  }

  const totalMinorUnits = [...centsByBrand.values()].reduce((sum, value) => sum + value, 0);
  const segments = BRAND_SALES_DEFINITIONS.map((definition) => {
    const amountMinorUnits = centsByBrand.get(definition.key) ?? 0;
    return {
      ...definition,
      amount: amountMinorUnits / scale,
      percentage:
        totalMinorUnits > 0
          ? Number(((amountMinorUnits / totalMinorUnits) * 100).toFixed(1))
          : 0,
      skuCount: skusByBrand.get(definition.key)?.size ?? 0,
      unitCount: unitsByBrand.get(definition.key) ?? 0,
    };
  });
  const categorySegments = CATEGORY_SALES_DEFINITIONS.map((definition) => {
    const amountMinorUnits = centsByCategory.get(definition.key) ?? 0;
    return {
      ...definition,
      amount: amountMinorUnits / scale,
      percentage:
        totalMinorUnits > 0
          ? Number(((amountMinorUnits / totalMinorUnits) * 100).toFixed(1))
          : 0,
      skuCount: skusByCategory.get(definition.key)?.size ?? 0,
      unitCount: unitsByCategory.get(definition.key) ?? 0,
    };
  });
  const unclassifiedMinorUnits = centsByBrand.get("unclassified") ?? 0;
  return {
    schemaVersion: 2,
    mode: input.mode,
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
    fetchedAt,
    dataThrough: input.dataThrough,
    rangeFreshness: input.rangeFreshness,
    currencyCode: input.currencyCode,
    segments,
    categorySegments,
    summary: {
      amount: totalMinorUnits / scale,
      unitCount: [...unitsByBrand.values()].reduce((sum, value) => sum + value, 0),
      classifiedAmount: (totalMinorUnits - unclassifiedMinorUnits) / scale,
      unclassifiedAmount: unclassifiedMinorUnits / scale,
      currentFbaSkuCount: input.listings.length,
      soldFbaSkuCount: soldFbaSkus.size,
      soldCurrentFbaSkuCount: soldCurrentFbaSkus.size,
      unmatchedCurrentFbaRowCount,
    },
    source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT",
    notice:
      `品牌與品類共用同一份 Amazon FBA Customer Shipment Sales report 快照，以已出貨商品單價 × 數量計算，因此不含 FBM，也不會為品類另外建立報表。品牌以同次目前 FBA 商品名稱辨識；品類依 Supply BUSINESS REPORT 規則，採商品名中最早出現的 Turkey Tendons/Tendon、Turkey、Chicken、Salmon、Buffalo、Fish、Air Dried 關鍵字，未命中歸入「其他」。找不到目前商品名稱或品牌不明的已出貨 FBA SKU 仍分別計入「未分類」與「其他」。${input.rangeFreshness === "includes-current-day" ? `範圍含站點今天，這次報表只涵蓋至 ${input.dataThrough}，不是完整日。` : "這次範圍只含已完成的站點日期。"} 報表通常延遲 1–3 小時，且不是上方 Sales API 的下單即時總額。`,
  };
}
