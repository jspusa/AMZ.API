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

export const BRAND_SALES_DEFINITIONS: readonly BrandSalesDefinition[] = [
  { key: "afreschi", label: "Afreschi", color: "#2F855A" },
  { key: "gootoe", label: "GooToE", color: "#ED8936" },
  { key: "herz", label: "Herz", color: "#3182CE" },
  { key: "vitaday", label: "Vitaday", color: "#ECC94B" },
  { key: "healthy-moment", label: "Healthy Moment", color: "#E53E3E" },
  { key: "unclassified", label: "未分類", color: "#A0A7B1" },
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
  schemaVersion: 1;
  mode: "live" | "demo";
  marketplaceId: string;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  currencyCode: string;
  segments: Array<BrandSalesDefinition & {
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

export function parseCurrentFbaListingTitles(text: string): BrandSalesListing[] {
  const rows = parseDelimited(text);
  const headers = rows[0] ?? [];
  const skuIndex = requiredColumn(headers, ["seller-sku", "sku"], "Seller SKU");
  const titleIndex = requiredColumn(headers, ["item-name", "title"], "商品名稱");
  const fulfillmentIndex = requiredColumn(
    headers,
    ["fulfillment-channel", "fulfillment-channel-code"],
    "履約管道",
  );
  const seen = new Set<string>();
  const listings: BrandSalesListing[] = [];
  for (const row of rows.slice(1)) {
    const fulfillment = row[fulfillmentIndex]?.trim() ?? "";
    if (!/^(?:AMAZON|AFN)(?:[_-].*)?$/iu.test(fulfillment)) continue;
    const sellerSku = row[skuIndex] ?? "";
    const title = row[titleIndex]?.trim() ?? "";
    if (!validSku(sellerSku) || seen.has(sellerSku)) {
      throw new Error("Amazon 全商品報表含有無法安全辨識或重複的 FBA SKU。");
    }
    seen.add(sellerSku);
    listings.push({ sellerSku, title });
  }
  return listings;
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
  fetchedAt?: string;
}): BrandSalesSnapshot {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(input.endDate)) {
    throw new Error("品牌營收日期範圍無效。");
  }
  if (!/^[A-Z]{3}$/u.test(input.currencyCode)) throw new Error("品牌營收幣別無效。");
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
    const minorUnits = Math.round(sale.unitPrice * sale.quantity * scale);
    if (!Number.isSafeInteger(minorUnits)) throw new Error("品牌營收金額超出安全範圍。");
    centsByBrand.set(brand, (centsByBrand.get(brand) ?? 0) + minorUnits);
    unitsByBrand.set(brand, (unitsByBrand.get(brand) ?? 0) + sale.quantity);
    const skus = skusByBrand.get(brand) ?? new Set<string>();
    skus.add(sale.sellerSku);
    skusByBrand.set(brand, skus);
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
  const unclassifiedMinorUnits = centsByBrand.get("unclassified") ?? 0;
  return {
    schemaVersion: 1,
    mode: input.mode,
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    currencyCode: input.currencyCode,
    segments,
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
      "品牌金額取自 Amazon FBA Customer Shipment Sales report 的已出貨商品單價 × 數量，因此不含 FBM。以同次目前 FBA 商品名稱辨識品牌；找不到目前商品名稱或品牌不明的已出貨 FBA SKU 仍計入灰色「未分類」。報表通常延遲 1–3 小時，且不是上方 Sales API 的下單即時總額。",
  };
}
