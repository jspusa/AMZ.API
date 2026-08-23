import { strToU8, zipSync } from "fflate";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAX_EXCEL_CELL_CHARACTERS = 32_767;

const MAIN_SHEET_NAME = "商品內容";
const ERROR_SHEET_NAME = "錯誤與缺值";

const MAIN_HEADERS = [
  "站點",
  "SKU",
  "ASIN",
  "Product Type",
  "商品標題",
  "賣點 1",
  "賣點 2",
  "賣點 3",
  "賣點 4",
  "賣點 5",
  "成分",
  "狀態",
  "最後更新",
] as const;

const ERROR_HEADERS = ["SKU", "類型", "說明"] as const;

const CONTENT_AUDIT_SHEET_NAME = "內容健檢";
const CONTENT_AUDIT_HEADERS = [
  "站點",
  "SKU",
  "ASIN",
  "Product Type",
  "商品標題",
  "賣點 1",
  "賣點 2",
  "賣點 3",
  "賣點 4",
  "賣點 5",
  "成分",
  "類型",
  "說明",
] as const;

export const CONTENT_AUDIT_V2_SCHEMA_VERSION = 2 as const;
export const CONTENT_AUDIT_V2_INDEX_SHEET_NAME = "說明與索引";
export const CONTENT_AUDIT_V2_INDEX_HEADER_ROW = 9;
export const CONTENT_AUDIT_V2_INDEX_HEADERS = [
  "工作表",
  "變體家庭 Key",
  "Parent SKU",
  "Variation Theme",
  "角色",
  "問題列數",
] as const;
export const CONTENT_AUDIT_V2_DATA_HEADERS = [
  "SKU",
  "ASIN",
  "Product Type",
  "原始產品名稱",
  "更新產品名稱",
  "原始產品亮點",
  "更新產品亮點",
  "原始要點 1",
  "更新要點 1",
  "原始要點 2",
  "更新要點 2",
  "原始要點 3",
  "更新要點 3",
  "原始要點 4",
  "更新要點 4",
  "原始要點 5",
  "更新要點 5",
  "原始產品敘述",
  "更新產品敘述",
  "原始成分",
  "更新成分",
  "類型",
  "說明",
] as const;

const CONTENT_AUDIT_V2_MAX_FAMILY_SHEETS = 500;
const CONTENT_AUDIT_V2_MAX_ROWS = 25_000;
const CONTENT_AUDIT_V2_STANDALONE_KEY = "STANDALONE";
const CONTENT_AUDIT_V2_INCOMPLETE_KEY = "DATA_INCOMPLETE";

const AGED_INVENTORY_SHEET_NAME = "FBA 庫齡";
const AGED_INVENTORY_NOTES_SHEET_NAME = "欄位與能力邊界";
const IMAGE_AUDIT_SHEET_NAME = "圖片健檢";
const IMAGE_AUDIT_NOTES_SHEET_NAME = "範圍與狀態說明";

const VARIATION_FAMILY_DARK_STYLE_BASE = 8;
const VARIATION_FAMILY_LIGHT_STYLE_BASE = 20;
const VARIATION_FAMILY_STYLE_VARIANTS = 12;

export interface ListingsWorkbookRow {
  sku: string;
  asin?: string | null;
  productType?: string | null;
  title?: string | null;
  bulletPoints?: readonly (string | null | undefined)[];
  ingredients?: string | null;
  status?: string | null;
  lastUpdated?: string | Date | null;
  marketplaceLabel?: string | null;
  auditType?: string | null;
  auditDescription?: string | null;
  auditTitleRuns?: readonly WorkbookRichTextRun[];
  auditBulletPointRuns?: readonly (readonly WorkbookRichTextRun[] | null | undefined)[];
  auditIngredientsRuns?: readonly WorkbookRichTextRun[];
}

export interface WorkbookRichTextRun {
  text: string;
  alert?: boolean;
}

export interface ListingsWorkbookError {
  sku?: string | null;
  type: string;
  description: string;
}

export interface CreateListingsWorkbookInput {
  marketplaceLabel: string;
  fetchedAt: string | Date;
  rows: readonly ListingsWorkbookRow[];
  errors?: readonly ListingsWorkbookError[];
  layout?: "listings" | "content-audit";
}

export interface AgedInventoryWorkbookRow {
  sellerSku: string;
  fnSku: string;
  asin: string;
  title: string;
  condition: string;
  available: number | null;
  totalAgedUnits: number;
  agedOver180: number;
  ageBuckets: readonly { key: string; label: string; units: number }[];
  estimatedExcessQuantity: number | null;
  recommendedRemovalQuantity: number | null;
  daysOfSupply: number | null;
  currencyCode: string | null;
  estimatedStorageCostNextMonth: number | null;
  estimatedAgedSurcharge: number | null;
  agedSurchargeBuckets: readonly {
    key: string;
    label: string;
    quantity: number | null;
    estimatedCharge: number | null;
  }[];
  alert: string;
  recommendedAction: string;
  snapshotDate: string | null;
}

export interface CreateAgedInventoryWorkbookInput {
  marketplaceLabel: string;
  fetchedAt: string | Date;
  rows: readonly AgedInventoryWorkbookRow[];
  excessAvailability: "complete" | "partial" | "unavailable";
  excessReportedSkuCount: number;
  storageCostAvailability: "complete" | "partial" | "unavailable";
  storageCostReportedSkuCount: number;
  agedSurchargeAvailability: "complete" | "partial" | "unavailable";
  agedSurchargeReportedSkuCount: number;
  expirationNotice: string;
}

export interface ImageAuditWorkbookRow {
  sellerSku: string;
  asin: string;
  productType: string;
  title: string;
  imageUrls: readonly string[];
  imageCount: number;
  readStatus: "complete" | "incomplete";
  readErrors: readonly { code: string; message: string }[];
}

export interface CreateImageAuditWorkbookInput {
  marketplaceId: string;
  marketplaceLabel: string;
  fetchedAt: string | Date;
  minimumImages: number;
  rows: readonly ImageAuditWorkbookRow[];
}

export interface UnboundVariationWorkbookRow {
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  notice: string;
}

export interface UnboundVariationWorkbookIncompleteRow {
  sellerSku: string;
  asin: string;
  title: string;
  code: string;
  message: string;
}

export interface AllVariationWorkbookRow {
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
}

export interface CreateUnboundVariationWorkbookInput {
  marketplaceLabel: string;
  fetchedAt: string | Date;
  rows: readonly UnboundVariationWorkbookRow[];
  incompleteRows: readonly UnboundVariationWorkbookIncompleteRow[];
  allVariationRows: readonly AllVariationWorkbookRow[];
}

export type ContentAuditWorkbookContentValues = {
  title: string;
  itemHighlight: string;
  bulletPoints: readonly string[];
  productDescription: string;
  ingredients: string;
};

export type ContentAuditWorkbookIssueFields = {
  title?: boolean;
  itemHighlight?: boolean;
  bulletPoints?: readonly boolean[];
  productDescription?: boolean;
  ingredients?: boolean;
};

export interface ContentAuditWorkbookV2Row
  extends ContentAuditWorkbookContentValues {
  sellerSku: string;
  asin: string;
  productType: string;
  variationRole: string;
  variationParentSku: string;
  variationFamilyKey: string;
  variationTheme: string;
  auditType: string;
  auditDescription: string;
  issueFields?: ContentAuditWorkbookIssueFields;
  auditTitleRuns?: readonly WorkbookRichTextRun[];
  auditItemHighlightRuns?: readonly WorkbookRichTextRun[];
  auditBulletPointRuns?: readonly (
    | readonly WorkbookRichTextRun[]
    | null
    | undefined
  )[];
  auditProductDescriptionRuns?: readonly WorkbookRichTextRun[];
  auditIngredientsRuns?: readonly WorkbookRichTextRun[];
}

export interface CreateContentAuditWorkbookV2Input {
  marketplaceId: string;
  marketplaceLabel: string;
  exportId: string;
  fetchedAt: string | Date;
  rows: readonly ContentAuditWorkbookV2Row[];
}

type Cell =
  | { kind: "text"; value: unknown; style: number; preserveFormulaLikeText?: boolean }
  | {
      kind: "rich-text";
      runs: readonly WorkbookRichTextRun[];
      style: number;
      preserveFormulaLikeText?: boolean;
    }
  | { kind: "date"; value: string | Date | null | undefined; style: number }
  | { kind: "number"; value: number | null; style: number };

interface WorksheetOptions {
  headers: readonly string[];
  rows: readonly (readonly Cell[])[];
  widths: readonly number[];
  dataRowHeight: number;
  freezeRows?: number;
  autoFilter?: string | false;
}

/**
 * Creates a small, standards-compliant OOXML workbook without relying on a
 * Node-only spreadsheet library. The returned bytes can be sent directly in
 * an HTTP response with the XLSX content type.
 */
export function createListingsWorkbook({
  marketplaceLabel,
  fetchedAt,
  rows,
  errors = [],
  layout = "listings",
}: CreateListingsWorkbookInput): Uint8Array {
  const generatedAt = requireValidDate(fetchedAt, "fetchedAt");
  const includeErrorSheet = layout === "listings" && errors.length > 0;

  const mainRows = rows.map((row): readonly Cell[] => {
    const bulletPoints = row.bulletPoints ?? [];
    const auditBulletPointRuns = row.auditBulletPointRuns ?? [];

    const baseCells: readonly Cell[] = [
      textCell(row.marketplaceLabel ?? marketplaceLabel),
      textCell(row.sku, 2),
      textCell(row.asin ?? "", 2),
      textCell(row.productType ?? ""),
      layout === "content-audit" && row.auditTitleRuns?.length
        ? auditRichTextCell(row.auditTitleRuns)
        : textCell(row.title ?? ""),
      ...Array.from({ length: 5 }, (_, index) =>
        layout === "content-audit" && auditBulletPointRuns[index]?.length
          ? auditRichTextCell(auditBulletPointRuns[index]!)
          : textCell(bulletPoints[index] ?? ""),
      ),
      layout === "content-audit" && row.auditIngredientsRuns?.length
        ? auditRichTextCell(row.auditIngredientsRuns)
        : textCell(row.ingredients ?? ""),
    ];
    return layout === "content-audit"
      ? [
          ...baseCells,
          textCell(row.auditType ?? ""),
          textCell(row.auditDescription ?? ""),
        ]
      : [
          ...baseCells,
          textCell(row.status ?? ""),
          dateCell(row.lastUpdated),
        ];
  });

  const errorRows = errors.map(
    (error): readonly Cell[] => [
      textCell(error.sku ?? "", 2),
      textCell(error.type),
      textCell(error.description),
    ],
  );

  const sheetDefinitions = [
    {
      name: layout === "content-audit" ? CONTENT_AUDIT_SHEET_NAME : MAIN_SHEET_NAME,
      xml: buildWorksheet({
        headers: layout === "content-audit" ? CONTENT_AUDIT_HEADERS : MAIN_HEADERS,
        rows: mainRows,
        widths: layout === "content-audit"
          ? [16, 24, 16, 24, 52, 44, 44, 44, 44, 44, 42, 26, 72]
          : [16, 24, 16, 24, 52, 44, 44, 44, 44, 44, 42, 16, 21],
        dataRowHeight: 54,
      }),
    },
    ...(includeErrorSheet
      ? [
          {
            name: ERROR_SHEET_NAME,
            xml: buildWorksheet({
              headers: ERROR_HEADERS,
              rows: errorRows,
              widths: [24, 20, 72],
              dataRowHeight: 36,
            }),
          },
        ]
      : []),
  ];

  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(buildContentTypes(sheetDefinitions.length)),
    "_rels/.rels": strToU8(buildPackageRelationships()),
    "docProps/app.xml": strToU8(
      buildAppProperties(sheetDefinitions.map((sheet) => sheet.name)),
    ),
    "docProps/core.xml": strToU8(
      buildCoreProperties(marketplaceLabel, generatedAt),
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      buildWorkbookRelationships(sheetDefinitions.length),
    ),
    "xl/styles.xml": strToU8(buildStyles()),
    "xl/workbook.xml": strToU8(
      buildWorkbook(sheetDefinitions.map((sheet) => sheet.name)),
    ),
  };

  sheetDefinitions.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml);
  });

  return zipSync(archive, { level: 6 });
}

/**
 * Creates the editable, round-trip-safe content-audit workbook. Every listing
 * value is written twice: an immutable-looking grey source cell and a blue
 * proposed cell that the user may edit. The importer never trusts the styles;
 * the duplicated source values are the evidence used for a fresh Amazon
 * compare-before-write check.
 */
export function createContentAuditWorkbookV2({
  marketplaceId,
  marketplaceLabel,
  exportId,
  fetchedAt,
  rows,
}: CreateContentAuditWorkbookV2Input): Uint8Array {
  const generatedAt = requireValidDate(fetchedAt, "fetchedAt");
  if (!/^[A-Z0-9]{1,32}$/u.test(marketplaceId)) {
    throw new Error("Content audit workbook marketplace metadata is invalid.");
  }
  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(exportId)) {
    throw new Error("Content audit workbook export metadata is invalid.");
  }
  if (rows.length > CONTENT_AUDIT_V2_MAX_ROWS) {
    throw new Error("Content audit workbook contains too many rows.");
  }

  const seenSkus = new Set<string>();
  const groups = new Map<string, ContentAuditWorkbookV2Row[]>();
  for (const row of rows) {
    if (
      !row.sellerSku ||
      row.sellerSku.length > 40 ||
      row.sellerSku !== row.sellerSku.trim() ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
        row.sellerSku,
      ) ||
      seenSkus.has(row.sellerSku)
    ) {
      throw new Error(
        "Content audit workbook rows must use unique, exact Seller SKUs.",
      );
    }
    seenSkus.add(row.sellerSku);
    for (const [label, value] of [
      ["Seller SKU", row.sellerSku],
      ["ASIN", row.asin],
      ["Product Type", row.productType],
      ["產品名稱", row.title],
      ["產品亮點", row.itemHighlight],
      ...Array.from({ length: 5 }, (_, index) => [
        `產品要點 ${index + 1}`,
        row.bulletPoints[index] ?? "",
      ]),
      ["產品敘述", row.productDescription],
      ["成分", row.ingredients],
      ["Variation Role", row.variationRole],
      ["Variation Parent SKU", row.variationParentSku],
      ["Variation Family Key", row.variationFamilyKey],
      ["Variation Theme", row.variationTheme],
      ["類型", row.auditType],
      ["說明", row.auditDescription],
    ] as const) {
      assertContentAuditRoundTripText(value, label);
    }
    const familyKey = contentAuditFamilyKey(row);
    const group = groups.get(familyKey) ?? [];
    group.push(row);
    groups.set(familyKey, group);
  }

  const familyKeys = [...groups.keys()].sort(compareContentAuditFamilyKey);
  if (familyKeys.length > CONTENT_AUDIT_V2_MAX_FAMILY_SHEETS) {
    throw new Error("Content audit workbook contains too many variation families.");
  }
  let numberedFamilyIndex = 0;
  const familySheets = familyKeys.map((familyKey) => {
    const sheetName = familyKey === CONTENT_AUDIT_V2_STANDALONE_KEY
      ? "未綁變體"
      : familyKey === CONTENT_AUDIT_V2_INCOMPLETE_KEY
        ? "資料未完成"
        : `F${String(++numberedFamilyIndex).padStart(3, "0")}`;
    const familyRows = [...(groups.get(familyKey) ?? [])].sort((left, right) =>
      compareExactText(left.sellerSku, right.sellerSku));
    return {
      sheetName,
      familyKey,
      rows: familyRows,
      parentSkus: uniqueSortedText(
        familyRows.map((row) => row.variationParentSku),
      ),
      variationThemes: uniqueSortedText(
        familyRows.map((row) => row.variationTheme),
      ),
      roles: uniqueSortedText(familyRows.map((row) => row.variationRole)),
    };
  });

  const indexRows: readonly (readonly Cell[])[] = [
    [textCell("Schema Version"), textCell(CONTENT_AUDIT_V2_SCHEMA_VERSION), ...emptyCells(4)],
    [textCell("Marketplace ID"), textCell(marketplaceId, 2), ...emptyCells(4)],
    [textCell("Export ID"), textCell(exportId, 2), ...emptyCells(4)],
    [textCell("Fetched At"), textCell(generatedAt.toISOString()), ...emptyCells(4)],
    [
      textCell("使用說明"),
      textCell(
        "只能編輯淺藍色「更新...」欄位。灰色「原始...」欄位是匯出快照，回傳時會重新向 Amazon 核對；請勿修改 SKU、ASIN、Product Type 或工作表結構。",
      ),
      ...emptyCells(4),
    ],
    [
      textCell("顏色說明"),
      textCell(
        "淺藍色＝可編輯更新值；灰色＝原始值；黃色＝此欄位被健檢抓到；紅字＝疑似錯字或不可見字元。",
      ),
      ...emptyCells(4),
    ],
    emptyCells(6),
    CONTENT_AUDIT_V2_INDEX_HEADERS.map((header) => textCell(header, 1)),
    ...familySheets.map((family): readonly Cell[] => [
      textCell(family.sheetName, 2),
      roundTripTextCell(family.familyKey, 2),
      roundTripTextCell(family.parentSkus.join("、"), 2),
      roundTripTextCell(family.variationThemes.join("、")),
      textCell(family.roles.join("、")),
      numberCell(family.rows.length),
    ]),
  ];

  const sheetDefinitions = [
    {
      name: CONTENT_AUDIT_V2_INDEX_SHEET_NAME,
      xml: buildWorksheet({
        headers: ["AMZ.API 全站文案健檢 Excel", "", "", "", "", ""],
        rows: indexRows,
        widths: [22, 72, 34, 34, 24, 14],
        dataRowHeight: 36,
        freezeRows: CONTENT_AUDIT_V2_INDEX_HEADER_ROW,
        // Excel and LibreOffice persist AutoFilter ranges as hidden
        // _xlnm._FilterDatabase Defined Names. The importer deliberately
        // rejects every Defined Name, so v2 omits filters rather than widening
        // that security interface for a presentation-only feature.
        autoFilter: false,
      }),
    },
    ...familySheets.map((family) => ({
      name: family.sheetName,
      xml: buildWorksheet({
        headers: CONTENT_AUDIT_V2_DATA_HEADERS,
        rows: family.rows.map(contentAuditWorkbookCells),
        widths: [
          24, 16, 24,
          48, 48,
          42, 42,
          40, 40, 40, 40, 40, 40, 40, 40, 40, 40,
          72, 72,
          42, 42,
          28, 78,
        ],
        dataRowHeight: 72,
        autoFilter: false,
      }),
    })),
  ];

  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(buildContentTypes(sheetDefinitions.length)),
    "_rels/.rels": strToU8(buildPackageRelationships()),
    "docProps/app.xml": strToU8(
      buildAppProperties(sheetDefinitions.map((sheet) => sheet.name)),
    ),
    "docProps/core.xml": strToU8(
      buildCoreProperties(
        marketplaceLabel,
        generatedAt,
        "AMZ.API 全站文案健檢 Excel v2",
      ),
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      buildWorkbookRelationships(sheetDefinitions.length),
    ),
    "xl/styles.xml": strToU8(buildStyles()),
    "xl/workbook.xml": strToU8(
      buildWorkbook(sheetDefinitions.map((sheet) => sheet.name)),
    ),
  };
  sheetDefinitions.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml);
  });
  return zipSync(archive, { level: 6 });
}

function assertContentAuditRoundTripText(value: string, label: string): void {
  if (Array.from(value).length > MAX_EXCEL_CELL_CHARACTERS) {
    throw new Error(
      `Content audit workbook ${label} exceeds Excel's lossless cell limit.`,
    );
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const xmlSafe =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!xmlSafe) {
      throw new Error(
        `Content audit workbook ${label} contains text that OOXML cannot preserve losslessly.`,
      );
    }
  }
}

function contentAuditFamilyKey(row: ContentAuditWorkbookV2Row): string {
  const familyKey = row.variationRole === "standalone"
    ? CONTENT_AUDIT_V2_STANDALONE_KEY
    : row.variationRole === "child" && row.variationFamilyKey
      ? row.variationFamilyKey
      : CONTENT_AUDIT_V2_INCOMPLETE_KEY;
  if (
    familyKey.length > 2_000 ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
      familyKey,
    )
  ) {
    throw new Error("Content audit workbook variation family key is invalid.");
  }
  return familyKey;
}

function compareContentAuditFamilyKey(left: string, right: string): number {
  const rank = (value: string) =>
    value === CONTENT_AUDIT_V2_STANDALONE_KEY
      ? 1
      : value === CONTENT_AUDIT_V2_INCOMPLETE_KEY
        ? 2
        : 0;
  const difference = rank(left) - rank(right);
  return difference || compareExactText(left, right);
}

function compareExactText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function uniqueSortedText(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort(compareExactText);
}

function emptyCells(length: number): Cell[] {
  return Array.from({ length }, () => textCell(""));
}

function contentAuditWorkbookCells(
  row: ContentAuditWorkbookV2Row,
): readonly Cell[] {
  const bullets = Array.from({ length: 5 }, (_, index) =>
    row.bulletPoints[index] ?? "");
  const bulletRuns = row.auditBulletPointRuns ?? [];
  const bulletIssues = row.issueFields?.bulletPoints ?? [];
  const pairedContentCells = (
    value: string,
    runs: readonly WorkbookRichTextRun[] | null | undefined,
    issue: boolean,
  ): Cell[] => [
    contentAuditRoundTripCell(value, runs, 6),
    contentAuditRoundTripCell(value, runs, issue ? 5 : 7),
  ];

  return [
    roundTripTextCell(row.sellerSku, 2),
    roundTripTextCell(row.asin, 2),
    roundTripTextCell(row.productType),
    ...pairedContentCells(
      row.title,
      row.auditTitleRuns,
      Boolean(row.issueFields?.title),
    ),
    ...pairedContentCells(
      row.itemHighlight,
      row.auditItemHighlightRuns,
      Boolean(row.issueFields?.itemHighlight),
    ),
    ...bullets.flatMap((bullet, index) =>
      pairedContentCells(
        bullet,
        bulletRuns[index],
        Boolean(bulletIssues[index]),
      )),
    ...pairedContentCells(
      row.productDescription,
      row.auditProductDescriptionRuns,
      Boolean(row.issueFields?.productDescription),
    ),
    ...pairedContentCells(
      row.ingredients,
      row.auditIngredientsRuns,
      Boolean(row.issueFields?.ingredients),
    ),
    roundTripTextCell(row.auditType),
    roundTripTextCell(row.auditDescription),
  ];
}

function contentAuditRoundTripCell(
  value: string,
  runs: readonly WorkbookRichTextRun[] | null | undefined,
  style: number,
): Cell {
  // Rich-text highlighting is presentation-only. Never let a replacement
  // segment (for example the visible marker used for a zero-width character)
  // rewrite the immutable source value that the importer binds to its digest.
  return runs?.length && runs.map((run) => run.text).join("") === value
    ? roundTripRichTextCell(runs, style)
    : roundTripTextCell(value, style);
}

export function createImageAuditWorkbook({
  marketplaceId,
  marketplaceLabel,
  fetchedAt,
  minimumImages,
  rows,
}: CreateImageAuditWorkbookInput): Uint8Array {
  const generatedAt = requireValidDate(fetchedAt, "fetchedAt");
  if (
    !marketplaceId ||
    !Number.isInteger(minimumImages) ||
    minimumImages < 1 ||
    minimumImages > 9
  ) {
    throw new Error("Image audit workbook snapshot metadata is invalid.");
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.sellerSku || seen.has(row.sellerSku)) {
      throw new Error("Image audit workbook rows must use unique Seller SKUs.");
    }
    seen.add(row.sellerSku);
    if (
      row.imageUrls.length > 9 ||
      (row.readStatus === "complete" && row.imageCount !== row.imageUrls.length) ||
      (row.readStatus === "incomplete" && row.imageCount !== 0)
    ) {
      throw new Error("Image audit workbook row status is contradictory.");
    }
  }

  const headers = [
    "站點",
    "站點 ID",
    "報表快照時間",
    "SKU",
    "ASIN",
    "Product Type",
    "商品標題",
    "讀取狀態",
    "健檢結果",
    "圖片張數",
    `距離 ${minimumImages} 張門檻`,
    "讀取錯誤",
    ...Array.from({ length: 9 }, (_, index) => `圖片 URL ${index + 1}`),
  ];
  const workbookRows = rows.map((row): readonly Cell[] => {
    const completed = row.readStatus === "complete";
    const underMinimum = completed && row.imageCount < minimumImages;
    return [
      textCell(marketplaceLabel),
      textCell(marketplaceId, 2),
      dateCell(generatedAt),
      textCell(row.sellerSku, 2),
      textCell(row.asin, 2),
      textCell(row.productType),
      textCell(row.title),
      textCell(completed ? "完整" : "讀取未完成"),
      textCell(
        completed ? (underMinimum ? "圖片不足" : "通過") : "讀取未完成",
      ),
      numberCell(completed ? row.imageCount : null),
      numberCell(completed ? Math.max(0, minimumImages - row.imageCount) : null),
      textCell(
        completed
          ? ""
          : row.readErrors
              .map((error) => `${error.code}: ${error.message}`)
              .join("；"),
      ),
      ...Array.from({ length: 9 }, (_, index) =>
        textCell(row.imageUrls[index] ?? ""),
      ),
    ];
  });
  const notesRows: readonly (readonly Cell[])[] = [
    [textCell("資料範圍"), textCell("同一份 Amazon 全商品報表快照中可證明為 FBA 的 SKU；不含 FBM。")],
    [textCell("站點快照"), textCell(`${marketplaceLabel} (${marketplaceId}) · ${generatedAt.toISOString()}`)],
    [textCell("圖片門檻"), textCell(`每個完整讀取的 Listing 至少 ${minimumImages} 張圖片。`)],
    [
      textCell("讀取未完成"),
      textCell("圖片張數與距離門檻保持空白；不把無法完整讀取的 Listing 冒充為零張圖片。"),
    ],
    [
      textCell("匯出內容"),
      textCell("保留全部 FBA 列，並明確區分通過、圖片不足與讀取未完成，方便 Excel 篩選。"),
    ],
    [textCell("安全邊界"), textCell("唯讀健檢；不下載原圖、不修改 Amazon。")],
  ];
  const sheetDefinitions = [
    {
      name: IMAGE_AUDIT_SHEET_NAME,
      xml: buildWorksheet({
        headers,
        rows: workbookRows,
        widths: headers.map((header, index) =>
          index === 6 ? 48 : index === 11 ? 64 : header.startsWith("圖片 URL") ? 44 : 18,
        ),
        dataRowHeight: 42,
      }),
    },
    {
      name: IMAGE_AUDIT_NOTES_SHEET_NAME,
      xml: buildWorksheet({
        headers: ["欄位", "說明"],
        rows: notesRows,
        widths: [24, 100],
        dataRowHeight: 42,
      }),
    },
  ];
  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(buildContentTypes(sheetDefinitions.length)),
    "_rels/.rels": strToU8(buildPackageRelationships()),
    "docProps/app.xml": strToU8(
      buildAppProperties(sheetDefinitions.map((sheet) => sheet.name)),
    ),
    "docProps/core.xml": strToU8(
      buildCoreProperties(marketplaceLabel, generatedAt, "Amazon FBA 圖片健檢"),
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      buildWorkbookRelationships(sheetDefinitions.length),
    ),
    "xl/styles.xml": strToU8(buildStyles()),
    "xl/workbook.xml": strToU8(
      buildWorkbook(sheetDefinitions.map((sheet) => sheet.name)),
    ),
  };
  sheetDefinitions.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml);
  });
  return zipSync(archive, { level: 6 });
}

export function createAgedInventoryWorkbook({
  marketplaceLabel,
  fetchedAt,
  rows,
  excessAvailability,
  excessReportedSkuCount,
  storageCostAvailability,
  storageCostReportedSkuCount,
  agedSurchargeAvailability,
  agedSurchargeReportedSkuCount,
  expirationNotice,
}: CreateAgedInventoryWorkbookInput): Uint8Array {
  const generatedAt = requireValidDate(fetchedAt, "fetchedAt");
  const ageBuckets = rows[0]?.ageBuckets ?? [];
  const surchargeBuckets = rows[0]?.agedSurchargeBuckets ?? [];
  const ageKeys = ageBuckets.map((bucket) => bucket.key).join("|");
  const surchargeKeys = surchargeBuckets.map((bucket) => bucket.key).join("|");
  for (const row of rows) {
    if (
      row.ageBuckets.map((bucket) => bucket.key).join("|") !== ageKeys ||
      row.agedSurchargeBuckets.map((bucket) => bucket.key).join("|") !==
        surchargeKeys
    ) {
      throw new Error("Aged inventory workbook rows must use one bucket schema.");
    }
  }

  const headers = [
    "站點",
    "庫存快照日",
    "SKU",
    "FNSKU",
    "ASIN",
    "商品",
    "狀態",
    "目前可售",
    ...ageBuckets.map((bucket) => bucket.label),
    "庫齡桶總數",
    "180 天以上",
    "Amazon 預估冗餘",
    "可售天數",
    "下月預估倉儲成本",
    "幣別",
    "AIS 預估附加費合計",
    ...surchargeBuckets.flatMap((bucket) => [
      `${bucket.label}計費數量`,
      `${bucket.label}預估附加費`,
    ]),
    "Amazon 建議移除數量",
    "Amazon alert 原文",
    "Amazon 建議原文",
  ];
  const workbookRows = rows.map((row): readonly Cell[] => [
    textCell(marketplaceLabel),
    textCell(row.snapshotDate ?? ""),
    textCell(row.sellerSku, 2),
    textCell(row.fnSku, 2),
    textCell(row.asin, 2),
    textCell(row.title),
    textCell(row.condition),
    numberCell(row.available),
    ...row.ageBuckets.map((bucket) => numberCell(bucket.units)),
    numberCell(row.totalAgedUnits),
    numberCell(row.agedOver180),
    numberCell(row.estimatedExcessQuantity),
    numberCell(row.daysOfSupply),
    numberCell(row.estimatedStorageCostNextMonth),
    textCell(row.currencyCode ?? ""),
    numberCell(row.estimatedAgedSurcharge),
    ...row.agedSurchargeBuckets.flatMap((bucket) => [
      numberCell(bucket.quantity),
      numberCell(bucket.estimatedCharge),
    ]),
    numberCell(row.recommendedRemovalQuantity),
    textCell(row.alert),
    textCell(row.recommendedAction),
  ]);
  const notesRows: readonly (readonly Cell[])[] = [
    [textCell("資料來源"), textCell("GET_FBA_INVENTORY_PLANNING_DATA；FBA only；唯讀。")],
    [
      textCell("官方欄位文件"),
      textCell(
        "https://developer-docs.amazon.com/sp-api/lang-en_EN/docs/report-type-values-fba",
      ),
    ],
    [
      textCell("Amazon 預估冗餘"),
      textCell(
        excessAvailability === "complete"
          ? "Amazon 報表欄位對全部商品都有值；全站合計才可成立。"
          : excessAvailability === "partial"
            ? `Amazon 有回傳欄位，但部分商品缺值；已回傳 ${excessReportedSkuCount}/${rows.length} SKU。可加總已回傳值，但不得冒充全站合計；逐列空白仍保留。`
            : "Amazon 本次報表未提供欄位；不推算全站合計。",
      ),
    ],
    [
      textCell("下月預估倉儲成本"),
      textCell(
        storageCostAvailability === "complete"
          ? "Amazon 報表欄位完整；顯示原值。若同列官方 storage-volume 明確為 0 而費用留白，僅將該列安全呈現為 0；不猜費率。"
          : storageCostAvailability === "partial"
            ? `Amazon 有回傳欄位，但部分商品缺值；已回傳 ${storageCostReportedSkuCount}/${rows.length} SKU。可加總已回傳原值，不得冒充全站費用，也不猜費率。`
            : "Amazon 本次報表未提供欄位；不猜費率。",
      ),
    ],
    [
      textCell("AIS 預估附加費"),
      textCell(
        agedSurchargeAvailability === "complete"
          ? "Amazon 報表區間完整；顯示原值。若同列官方計費數量明確為 0 而費用留白，僅將該區間安全呈現為 0；不猜費率。"
          : agedSurchargeAvailability === "partial"
            ? `Amazon 有回傳區間欄位，但部分商品缺值；已回傳 ${agedSurchargeReportedSkuCount}/${rows.length} SKU。可加總已回傳原值，不得冒充全站費用，也不猜費率。`
            : "Amazon 本次報表未提供完整 AIS 區間；不猜費率。",
      ),
    ],
    [textCell("到期日／近效期"), textCell(expirationNotice)],
    [
      textCell("安全邊界"),
      textCell("庫齡、estimated excess 與 Amazon alert 都不等於商品到期日；不會建立促銷或移除訂單。"),
    ],
  ];
  const sheetDefinitions = [
    {
      name: AGED_INVENTORY_SHEET_NAME,
      xml: buildWorksheet({
        headers,
        rows: workbookRows,
        widths: headers.map((header, index) =>
          index === 5 ? 48 : header.includes("原文") ? 34 : Math.max(12, Math.min(25, header.length * 2)),
        ),
        dataRowHeight: 36,
      }),
    },
    {
      name: AGED_INVENTORY_NOTES_SHEET_NAME,
      xml: buildWorksheet({
        headers: ["欄位", "說明"],
        rows: notesRows,
        widths: [26, 100],
        dataRowHeight: 48,
      }),
    },
  ];
  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(buildContentTypes(sheetDefinitions.length)),
    "_rels/.rels": strToU8(buildPackageRelationships()),
    "docProps/app.xml": strToU8(
      buildAppProperties(sheetDefinitions.map((sheet) => sheet.name)),
    ),
    "docProps/core.xml": strToU8(
      buildCoreProperties(
        marketplaceLabel,
        generatedAt,
        "Amazon FBA 庫齡與冗餘匯出",
      ),
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      buildWorkbookRelationships(sheetDefinitions.length),
    ),
    "xl/styles.xml": strToU8(buildStyles()),
    "xl/workbook.xml": strToU8(
      buildWorkbook(sheetDefinitions.map((sheet) => sheet.name)),
    ),
  };
  sheetDefinitions.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml);
  });
  return zipSync(archive, { level: 6 });
}

export function createUnboundVariationWorkbook({
  marketplaceLabel,
  fetchedAt,
  rows,
  incompleteRows,
  allVariationRows,
}: CreateUnboundVariationWorkbookInput): Uint8Array {
  const generatedAt = requireValidDate(fetchedAt, "fetchedAt");
  const allVariationWorkbookRows = variationFamilyWorkbookRows(allVariationRows);
  const parentColumnWorkbook = variationFamilyParentColumnWorkbook(
    allVariationRows,
  );
  const sheets = [
    {
      name: "未綁變體",
      xml: buildWorksheet({
        headers: ["SKU", "商品標題", "ASIN", "站點", "商品類型", "判定依據"],
        rows: rows.map((row): readonly Cell[] => [
          textCell(row.sellerSku, 2),
          textCell(row.title),
          textCell(row.asin, 2),
          textCell(marketplaceLabel),
          textCell(row.productType),
          textCell(row.notice),
        ]),
        widths: [26, 58, 18, 16, 24, 72],
        dataRowHeight: 42,
      }),
    },
    {
      name: "讀取未完成",
      xml: buildWorksheet({
        headers: ["SKU", "商品標題", "ASIN", "站點", "狀態碼", "未完成原因"],
        rows: incompleteRows.map((row): readonly Cell[] => [
          textCell(row.sellerSku, 2),
          textCell(row.title),
          textCell(row.asin, 2),
          textCell(marketplaceLabel),
          textCell(row.code),
          textCell(row.message),
        ]),
        widths: [26, 58, 18, 16, 34, 78],
        dataRowHeight: 42,
      }),
    },
    {
      name: "所有變體",
      xml: buildWorksheet({
        headers: [
          "變體家庭 Parent SKU",
          "角色",
          "SKU",
          "商品標題",
          "商品類型",
          "Variation Theme",
          "判定依據",
        ],
        rows: allVariationWorkbookRows,
        widths: [28, 14, 28, 58, 24, 24, 58],
        dataRowHeight: 38,
      }),
    },
    {
      name: "父變體橫排",
      xml: buildWorksheet({
        headers: parentColumnWorkbook.parentSkus,
        rows: parentColumnWorkbook.childRows,
        widths: parentColumnWorkbook.parentSkus.map(() => 28),
        dataRowHeight: 30,
        autoFilter: false,
      }),
    },
  ];
  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(buildContentTypes(sheets.length)),
    "_rels/.rels": strToU8(buildPackageRelationships()),
    "docProps/app.xml": strToU8(
      buildAppProperties(sheets.map((sheet) => sheet.name)),
    ),
    "docProps/core.xml": strToU8(
      buildCoreProperties(
        marketplaceLabel,
        generatedAt,
        "Amazon FBA 未綁變體健檢",
      ),
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      buildWorkbookRelationships(sheets.length),
    ),
    "xl/styles.xml": strToU8(buildStyles()),
    "xl/workbook.xml": strToU8(
      buildWorkbook(sheets.map((sheet) => sheet.name)),
    ),
  };
  sheets.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml);
  });
  return zipSync(archive, { level: 6 });
}

function variationFamilyWorkbookRows(
  rows: readonly AllVariationWorkbookRow[],
): readonly (readonly Cell[])[] {
  return styledVariationFamilyRows(rows, (row) => [
    row.familySku,
    row.role === "parent" ? "父變體" : "子變體",
    row.sellerSku,
    row.title,
    row.productType,
    row.variationTheme ?? "",
    variationFamilyEvidenceLabel(row.evidence),
  ]);
}

function variationFamilyParentColumnWorkbook(
  rows: readonly AllVariationWorkbookRow[],
): {
  parentSkus: readonly string[];
  childRows: readonly (readonly Cell[])[];
} {
  assertVariationFamiliesBeginWithParent(rows);
  const families: Array<{
    familySku: string;
    parentSku: string;
    childSkus: string[];
  }> = [];
  for (const row of rows) {
    if (row.role === "parent") {
      families.push({
        familySku: row.familySku,
        parentSku: row.sellerSku,
        childSkus: [],
      });
      continue;
    }
    const family = families.at(-1);
    if (!family || family.familySku !== row.familySku) {
      throw new Error(
        "All-variation workbook child rows must follow their exact parent row.",
      );
    }
    family.childSkus.push(row.sellerSku);
  }

  if (!families.length) {
    return {
      parentSkus: ["尚無已驗證 Parent SKU"],
      childRows: [],
    };
  }
  const childRowCount = Math.max(
    0,
    ...families.map((family) => family.childSkus.length),
  );
  return {
    parentSkus: families.map((family) => family.parentSku),
    childRows: Array.from(
      { length: childRowCount },
      (_, childIndex): readonly Cell[] => families.map((family) =>
        textCell(family.childSkus[childIndex] ?? "", 2)
      ),
    ),
  };
}

function assertVariationFamiliesBeginWithParent(
  rows: readonly AllVariationWorkbookRow[],
): void {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const firstInFamily = index === 0 ||
      rows[index - 1]?.familySku !== row.familySku;
    if (firstInFamily && row.role !== "parent") {
      throw new Error(
        "All-variation workbook families must begin with their exact parent row.",
      );
    }
    if (!firstInFamily && row.role === "parent") {
      throw new Error(
        "All-variation workbook families must contain one leading parent row.",
      );
    }
  }
}

function styledVariationFamilyRows(
  rows: readonly AllVariationWorkbookRow[],
  valuesForRow: (row: AllVariationWorkbookRow) => readonly string[],
): readonly (readonly Cell[])[] {
  const familyOrdinals = new Map<string, number>();
  let currentFamily = "";
  let currentOrdinal = -1;
  for (const row of rows) {
    if (row.familySku === currentFamily) continue;
    if (familyOrdinals.has(row.familySku)) {
      throw new Error("All-variation workbook families must be contiguous.");
    }
    currentFamily = row.familySku;
    currentOrdinal += 1;
    familyOrdinals.set(row.familySku, currentOrdinal);
  }

  return rows.map((row, rowIndex): readonly Cell[] => {
    const firstInFamily = rowIndex === 0 ||
      rows[rowIndex - 1]?.familySku !== row.familySku;
    const lastInFamily = rowIndex === rows.length - 1 ||
      rows[rowIndex + 1]?.familySku !== row.familySku;
    const familyOrdinal = familyOrdinals.get(row.familySku);
    if (familyOrdinal === undefined) {
      throw new Error("All-variation workbook family is missing its ordinal.");
    }
    const values = valuesForRow(row);
    return values.map((value, columnIndex) => textCell(
      value,
      variationFamilyCellStyle({
        familyOrdinal,
        firstInFamily,
        lastInFamily,
        firstColumn: columnIndex === 0,
        lastColumn: columnIndex === values.length - 1,
      }),
    ));
  });
}

function variationFamilyEvidenceLabel(
  evidence: AllVariationWorkbookRow["evidence"],
): string {
  return evidence === "verified-parent"
    ? "Amazon relationships 已驗證父變體"
    : evidence === "verified-child"
      ? "Amazon relationships 已驗證子變體"
      : "父 SKU 取自已驗證子變體關係；未猜測父商品名稱";
}

function variationFamilyCellStyle(input: {
  familyOrdinal: number;
  firstInFamily: boolean;
  lastInFamily: boolean;
  firstColumn: boolean;
  lastColumn: boolean;
}): number {
  const horizontalOffset = input.firstColumn ? 0 : input.lastColumn ? 2 : 1;
  const verticalOffset = input.firstInFamily && input.lastInFamily
    ? 9
    : input.firstInFamily
      ? 0
      : input.lastInFamily
        ? 6
        : 3;
  const base = input.familyOrdinal % 2 === 0
    ? VARIATION_FAMILY_DARK_STYLE_BASE
    : VARIATION_FAMILY_LIGHT_STYLE_BASE;
  const style = base + verticalOffset + horizontalOffset;
  if (style >= base + VARIATION_FAMILY_STYLE_VARIANTS) {
    throw new Error("All-variation workbook family style is invalid.");
  }
  return style;
}

function textCell(value: unknown, style = 3): Cell {
  return { kind: "text", value, style };
}

function roundTripTextCell(value: unknown, style = 3): Cell {
  return { kind: "text", value, style, preserveFormulaLikeText: true };
}

function richTextCell(runs: readonly WorkbookRichTextRun[], style = 3): Cell {
  return { kind: "rich-text", runs, style };
}

function roundTripRichTextCell(
  runs: readonly WorkbookRichTextRun[],
  style = 3,
): Cell {
  return { kind: "rich-text", runs, style, preserveFormulaLikeText: true };
}

function auditRichTextCell(runs: readonly WorkbookRichTextRun[]): Cell {
  return richTextCell(runs, runs.some((run) => run.alert) ? 5 : 3);
}

function dateCell(value: string | Date | null | undefined): Cell {
  return { kind: "date", value, style: 4 };
}

function numberCell(value: number | null): Cell {
  return { kind: "number", value, style: 3 };
}

function buildWorksheet({
  headers,
  rows,
  widths,
  dataRowHeight,
  freezeRows = 1,
  autoFilter,
}: WorksheetOptions): string {
  if (headers.length === 0 || headers.length !== widths.length) {
    throw new Error("Worksheet headers and widths must be non-empty and aligned.");
  }

  const finalColumn = columnName(headers.length);
  const finalRow = Math.max(1, rows.length + 1);
  const dimension = `A1:${finalColumn}${finalRow}`;

  const columns = widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");

  const headerCells = headers
    .map((header, index) => inlineStringCell(`${columnName(index + 1)}1`, header, 1))
    .join("");

  const dataRows = rows
    .map((row, rowIndex) => {
      if (row.length !== headers.length) {
        throw new Error(`Worksheet row ${rowIndex + 1} has an unexpected column count.`);
      }

      const excelRow = rowIndex + 2;
      const cells = row
        .map((cell, columnIndex) =>
          renderCell(`${columnName(columnIndex + 1)}${excelRow}`, cell),
        )
        .join("");

      return `<row r="${excelRow}" ht="${dataRowHeight}" customHeight="1">${cells}</row>`;
    })
    .join("");

  const pane = freezeRows > 0
    ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A${freezeRows + 1}" sqref="A${freezeRows + 1}"/>`
    : '<selection activeCell="A1" sqref="A1"/>';
  const filterReference = autoFilter === false
    ? null
    : autoFilter ?? dimension;

  return `${XML_DECLARATION}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews>
    <sheetView workbookViewId="0" showGridLines="0">
      ${pane}
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>
    <row r="1" ht="26" customHeight="1">${headerCells}</row>
    ${dataRows}
  </sheetData>
  ${filterReference ? `<autoFilter ref="${filterReference}"/>` : ""}
  <pageMargins left="0.35" right="0.35" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function renderCell(reference: string, cell: Cell): string {
  if (cell.kind === "number" && cell.value !== null) {
    if (!Number.isFinite(cell.value)) {
      throw new TypeError(`Worksheet cell ${reference} must be a finite number.`);
    }
    return `<c r="${reference}" s="${cell.style}"><v>${cell.value}</v></c>`;
  }
  if (cell.kind === "date" && cell.value !== null && cell.value !== undefined) {
    const parsed = parseDate(cell.value);
    if (parsed) {
      return `<c r="${reference}" s="${cell.style}"><v>${excelSerial(parsed)}</v></c>`;
    }
  }

  if (cell.kind === "rich-text") {
    return inlineRichTextCell(
      reference,
      cell.runs,
      cell.style,
      Boolean(cell.preserveFormulaLikeText),
    );
  }
  const value = cell.kind === "text" ? cell.value : cell.value ?? "";
  const style = cell.kind === "date" ? 3 : cell.style;
  return inlineStringCell(
    reference,
    value,
    style,
    cell.kind === "text" && Boolean(cell.preserveFormulaLikeText),
  );
}

function inlineRichTextCell(
  reference: string,
  rawRuns: readonly WorkbookRichTextRun[],
  style: number,
  preserveFormulaLikeText = false,
): string {
  const normalizedRuns = safeRichTextRuns(rawRuns, preserveFormulaLikeText);
  const runs = normalizedRuns
    .map((run) => {
      const properties = run.alert
        ? '<rPr><b/><color rgb="FFC62828"/><sz val="11"/><rFont val="Aptos"/><family val="2"/></rPr>'
        : '<rPr><color rgb="FF17202A"/><sz val="11"/><rFont val="Aptos"/><family val="2"/></rPr>';
      return `<r>${properties}<t xml:space="preserve">${escapeXml(run.text)}</t></r>`;
    })
    .join("");
  return `<c r="${reference}" s="${style}" t="inlineStr"><is>${runs}</is></c>`;
}

function safeRichTextRuns(
  rawRuns: readonly WorkbookRichTextRun[],
  preserveFormulaLikeText = false,
): WorkbookRichTextRun[] {
  const sanitized = rawRuns
    .map((run) => ({
      text: sanitizeXmlText(String(run.text ?? "")),
      alert: Boolean(run.alert),
    }))
    .filter((run) => run.text.length > 0);
  if (!sanitized.length) return [{ text: "", alert: false }];
  if (!preserveFormulaLikeText && /^[=+\-@]/u.test(sanitized[0].text)) {
    sanitized[0] = { ...sanitized[0], text: `'${sanitized[0].text}` };
  }
  let remaining = MAX_EXCEL_CELL_CHARACTERS;
  const truncated: WorkbookRichTextRun[] = [];
  for (const run of sanitized) {
    if (remaining <= 0) break;
    const characters = Array.from(run.text);
    const text = characters.slice(0, remaining).join("");
    if (text) truncated.push({ text, alert: run.alert });
    remaining -= Array.from(text).length;
  }
  return truncated.length ? truncated : [{ text: "", alert: false }];
}

function inlineStringCell(
  reference: string,
  value: unknown,
  style: number,
  preserveFormulaLikeText = false,
): string {
  const safeValue = escapeXml(
    safeSpreadsheetText(value, preserveFormulaLikeText),
  );
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${safeValue}</t></is></c>`;
}

function safeSpreadsheetText(
  value: unknown,
  preserveFormulaLikeText = false,
): string {
  let text = sanitizeXmlText(value === null || value === undefined ? "" : String(value));

  if (!preserveFormulaLikeText && /^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  const characters = Array.from(text);
  if (characters.length > MAX_EXCEL_CELL_CHARACTERS) {
    text = characters.slice(0, MAX_EXCEL_CELL_CHARACTERS).join("");
  }

  return text;
}

function sanitizeXmlText(value: string): string {
  let output = "";

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const valid =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);

    output += valid ? character : "\uFFFD";
  }

  return output;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    // Some OOXML consumers normalize XML line-break code points when they
    // appear literally in text nodes. Character references preserve the exact
    // Amazon source value across download/open/save/import round trips.
    .replaceAll("\r", "&#xD;")
    .replaceAll("\u0085", "&#x85;")
    .replaceAll("\u2028", "&#x2028;")
    .replaceAll("\u2029", "&#x2029;");
}

function columnName(oneBasedIndex: number): string {
  if (!Number.isInteger(oneBasedIndex) || oneBasedIndex < 1) {
    throw new RangeError("Excel column indexes must be positive integers.");
  }

  let index = oneBasedIndex;
  let result = "";

  while (index > 0) {
    const remainder = (index - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    index = Math.floor((index - 1) / 26);
  }

  return result;
}

function parseDate(value: string | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function requireValidDate(value: string | Date, field: string): Date {
  const parsed = parseDate(value);
  if (!parsed) {
    throw new TypeError(`${field} must be a valid date.`);
  }
  return parsed;
}

function excelSerial(date: Date): string {
  const millisecondsPerDay = 86_400_000;
  const serial = date.getTime() / millisecondsPerDay + 25_569;
  return Number(serial.toFixed(10)).toString();
}

function buildContentTypes(sheetCount: number): string {
  const worksheetOverrides = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");

  return `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${worksheetOverrides}
</Types>`;
}

function buildPackageRelationships(): string {
  return `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildWorkbook(sheetNames: readonly string[]): string {
  const sheets = sheetNames
    .map(
      (name, index) =>
        `<sheet name="${escapeXml(sanitizeXmlText(name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");

  return `${XML_DECLARATION}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="0"/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets>${sheets}</sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;
}

function buildWorkbookRelationships(sheetCount: number): string {
  const sheetRelationships = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");

  return `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRelationships}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildStyles(): string {
  const familyBorderColor = "FF6F8EAC";
  const familyBorders = [
    `<border><left style="medium"><color rgb="${familyBorderColor}"/></left><right/><top style="medium"><color rgb="${familyBorderColor}"/></top><bottom/><diagonal/></border>`,
    `<border><left/><right/><top style="medium"><color rgb="${familyBorderColor}"/></top><bottom/><diagonal/></border>`,
    `<border><left/><right style="medium"><color rgb="${familyBorderColor}"/></right><top style="medium"><color rgb="${familyBorderColor}"/></top><bottom/><diagonal/></border>`,
    `<border><left style="medium"><color rgb="${familyBorderColor}"/></left><right/><top/><bottom/><diagonal/></border>`,
    `<border><left/><right style="medium"><color rgb="${familyBorderColor}"/></right><top/><bottom/><diagonal/></border>`,
    `<border><left style="medium"><color rgb="${familyBorderColor}"/></left><right/><top/><bottom style="medium"><color rgb="${familyBorderColor}"/></bottom><diagonal/></border>`,
    `<border><left/><right/><top/><bottom style="medium"><color rgb="${familyBorderColor}"/></bottom><diagonal/></border>`,
    `<border><left/><right style="medium"><color rgb="${familyBorderColor}"/></right><top/><bottom style="medium"><color rgb="${familyBorderColor}"/></bottom><diagonal/></border>`,
    `<border><left style="medium"><color rgb="${familyBorderColor}"/></left><right/><top style="medium"><color rgb="${familyBorderColor}"/></top><bottom style="medium"><color rgb="${familyBorderColor}"/></bottom><diagonal/></border>`,
    `<border><left/><right/><top style="medium"><color rgb="${familyBorderColor}"/></top><bottom style="medium"><color rgb="${familyBorderColor}"/></bottom><diagonal/></border>`,
    `<border><left/><right style="medium"><color rgb="${familyBorderColor}"/></right><top style="medium"><color rgb="${familyBorderColor}"/></top><bottom style="medium"><color rgb="${familyBorderColor}"/></bottom><diagonal/></border>`,
  ];
  const familyBorderIds = [2, 3, 4, 5, 0, 6, 7, 8, 9, 10, 11, 12];
  const familyCellStyles = [
    { fontId: 0, fillId: 6 },
    { fontId: 0, fillId: 7 },
  ].flatMap(({ fontId, fillId }) => familyBorderIds.map((borderId) =>
    `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`,
  )).join("");
  return `${XML_DECLARATION}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="11"/><color rgb="FF17202A"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
    <font><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF4FB"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FBFE"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="13">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD8E0E8"/></left>
      <right style="thin"><color rgb="FFD8E0E8"/></right>
      <top style="thin"><color rgb="FFD8E0E8"/></top>
      <bottom style="thin"><color rgb="FFD8E0E8"/></bottom>
      <diagonal/>
    </border>
    ${familyBorders.join("")}
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="32">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    ${familyCellStyles}
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function buildCoreProperties(
  marketplaceLabel: string,
  generatedAt: Date,
  exportTitle = "Amazon 商品內容匯出",
): string {
  const timestamp = generatedAt.toISOString();
  const title = escapeXml(
    sanitizeXmlText(`${exportTitle} - ${marketplaceLabel}`),
  );

  return `${XML_DECLARATION}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${title}</dc:title>
  <dc:creator>Amazon SP-API Console</dc:creator>
  <cp:lastModifiedBy>Amazon SP-API Console</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppProperties(sheetNames: readonly string[]): string {
  const titles = sheetNames
    .map((name) => `<vt:lpstr>${escapeXml(sanitizeXmlText(name))}</vt:lpstr>`)
    .join("");

  return `${XML_DECLARATION}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Amazon SP-API Console</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>1.0</AppVersion>
</Properties>`;
}
