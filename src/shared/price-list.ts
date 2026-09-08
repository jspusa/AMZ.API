/** Local workbook data only. No filename here grants filesystem or Amazon authority. */
export type PriceListCell = {
  reference: string;
  row: number;
  column: number;
  value: string | number | boolean | null;
  display: string;
  formula: string | null;
  styleId: number;
  imageId?: string;
};

export type PriceListStyle = {
  fontName: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  background: string;
  horizontal: "left" | "center" | "right";
  vertical: "top" | "middle" | "bottom";
  wrap: boolean;
  numberFormat: string;
  border: boolean;
};

export type PriceListSheet = {
  name: string;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
  cells: PriceListCell[];
  rowHeights: Record<number, number>;
  columnWidths: Record<number, number>;
  hiddenRows: number[];
  hiddenColumns: number[];
  merges: {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
  }[];
};

export type PriceListProductRow = {
  key: string;
  keyKind: "seller-sku" | "product-code";
  sheetName: string;
  rowNumber: number;
  asin: string | null;
  cells: Record<string, PriceListCell>;
};

export type PriceListWorkbook = {
  id: string;
  fileName: string;
  importedAt: string;
  byteLength: number;
  sha256: string;
  sheets: PriceListSheet[];
  styles: PriceListStyle[];
  products: PriceListProductRow[];
  imageCount: number;
  formulaCount: number;
  warnings: string[];
};

export type PriceListDifference = {
  key: string;
  status: "changed" | "added" | "removed" | "duplicate" | "unchanged";
  beforeLocation: string | null;
  afterLocation: string | null;
  fields: {
    field: string;
    before: string;
    after: string;
    beforeCell: string | null;
    afterCell: string | null;
    delta: number | null;
  }[];
};

export type PriceListComparison = {
  baseId: string;
  candidateId: string;
  rows: PriceListDifference[];
  counts: Record<PriceListDifference["status"], number>;
  warnings: string[];
};

export type PriceListAmazonRow = {
  sheetName: string;
  rowNumber: number;
  sellerSku: string | null;
  asin: string | null;
  status: "matched" | "unmatched" | "ambiguous" | "incomplete";
  message: string;
  standardPrice: number | null;
  minimumPrice: number | null;
  minimumPriceStatus: "set" | "not-set" | "unavailable";
  imageUrl: string | null;
  currency: "USD";
  fetchedAt: string;
  issueCode?: string | null;
};

export type PriceListAmazonSnapshot = {
  workbookId: string;
  state: "running" | "complete" | "failed";
  rows: PriceListAmazonRow[];
  fetchedAt: string | null;
  completed: number;
  total: number;
  message: string;
  stage?: "identifying" | "reading" | "finished";
  errorCode?: string | null;
};

export const PRICE_LIST_FIELD_LABELS: Record<string, string> = {
  code: "貨號 / Seller SKU",
  title: "產品名稱",
  asin: "ASIN",
  minimumPrice: "最低活動價",
  standardPrice: "標準定價",
  image: "圖片",
};
