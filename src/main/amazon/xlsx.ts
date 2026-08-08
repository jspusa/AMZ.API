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

const AGED_INVENTORY_SHEET_NAME = "FBA 庫齡";
const AGED_INVENTORY_NOTES_SHEET_NAME = "欄位與能力邊界";
const IMAGE_AUDIT_SHEET_NAME = "圖片健檢";
const IMAGE_AUDIT_NOTES_SHEET_NAME = "範圍與狀態說明";

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
  available: number;
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
  storageCostAvailability: "complete" | "partial" | "unavailable";
  agedSurchargeAvailability: "complete" | "partial" | "unavailable";
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

export interface CreateUnboundVariationWorkbookInput {
  marketplaceLabel: string;
  fetchedAt: string | Date;
  rows: readonly UnboundVariationWorkbookRow[];
  incompleteRows: readonly UnboundVariationWorkbookIncompleteRow[];
}

type Cell =
  | { kind: "text"; value: unknown; style: number }
  | { kind: "rich-text"; runs: readonly WorkbookRichTextRun[]; style: number }
  | { kind: "date"; value: string | Date | null | undefined; style: number }
  | { kind: "number"; value: number | null; style: number };

interface WorksheetOptions {
  headers: readonly string[];
  rows: readonly (readonly Cell[])[];
  widths: readonly number[];
  dataRowHeight: number;
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
        ? richTextCell(row.auditTitleRuns)
        : textCell(row.title ?? ""),
      ...Array.from({ length: 5 }, (_, index) =>
        layout === "content-audit" && auditBulletPointRuns[index]?.length
          ? richTextCell(auditBulletPointRuns[index]!)
          : textCell(bulletPoints[index] ?? ""),
      ),
      layout === "content-audit" && row.auditIngredientsRuns?.length
        ? richTextCell(row.auditIngredientsRuns)
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
  storageCostAvailability,
  agedSurchargeAvailability,
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
            ? "Amazon 有回傳欄位，但部分商品缺值；不顯示全站合計，逐列空白仍保留。"
            : "Amazon 本次報表未提供欄位；不推算全站合計。",
      ),
    ],
    [
      textCell("下月預估倉儲成本"),
      textCell(
        storageCostAvailability === "complete"
          ? "Amazon 報表欄位完整；顯示原值。若同列官方 storage-volume 明確為 0 而費用留白，僅將該列安全呈現為 0；不猜費率。"
          : storageCostAvailability === "partial"
            ? "Amazon 有回傳欄位，但部分商品缺值；不加總、不猜費率。"
            : "Amazon 本次報表未提供欄位；不猜費率。",
      ),
    ],
    [
      textCell("AIS 預估附加費"),
      textCell(
        agedSurchargeAvailability === "complete"
          ? "Amazon 報表區間完整；顯示原值。若同列官方計費數量明確為 0 而費用留白，僅將該區間安全呈現為 0；不猜費率。"
          : agedSurchargeAvailability === "partial"
            ? "Amazon 有回傳區間欄位，但部分商品缺值；不加總、不猜費率。"
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
}: CreateUnboundVariationWorkbookInput): Uint8Array {
  const generatedAt = requireValidDate(fetchedAt, "fetchedAt");
  const sheets = [
    {
      name: "未綁變體",
      xml: buildWorksheet({
        headers: ["站點", "SKU", "ASIN", "Product Type", "商品標題", "判定依據"],
        rows: rows.map((row): readonly Cell[] => [
          textCell(marketplaceLabel),
          textCell(row.sellerSku, 2),
          textCell(row.asin, 2),
          textCell(row.productType),
          textCell(row.title),
          textCell(row.notice),
        ]),
        widths: [16, 26, 18, 24, 58, 72],
        dataRowHeight: 42,
      }),
    },
    {
      name: "讀取未完成",
      xml: buildWorksheet({
        headers: ["站點", "SKU", "ASIN", "商品標題", "狀態碼", "未完成原因"],
        rows: incompleteRows.map((row): readonly Cell[] => [
          textCell(marketplaceLabel),
          textCell(row.sellerSku, 2),
          textCell(row.asin, 2),
          textCell(row.title),
          textCell(row.code),
          textCell(row.message),
        ]),
        widths: [16, 26, 18, 58, 34, 78],
        dataRowHeight: 42,
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

function textCell(value: unknown, style = 3): Cell {
  return { kind: "text", value, style };
}

function richTextCell(runs: readonly WorkbookRichTextRun[], style = 3): Cell {
  return { kind: "rich-text", runs, style };
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

  return `${XML_DECLARATION}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews>
    <sheetView workbookViewId="0" showGridLines="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>
    <row r="1" ht="26" customHeight="1">${headerCells}</row>
    ${dataRows}
  </sheetData>
  <autoFilter ref="${dimension}"/>
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
    return inlineRichTextCell(reference, cell.runs, cell.style);
  }
  const value = cell.kind === "text" ? cell.value : cell.value ?? "";
  const style = cell.kind === "date" ? 3 : cell.style;
  return inlineStringCell(reference, value, style);
}

function inlineRichTextCell(
  reference: string,
  rawRuns: readonly WorkbookRichTextRun[],
  style: number,
): string {
  const normalizedRuns = safeRichTextRuns(rawRuns);
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
): WorkbookRichTextRun[] {
  const sanitized = rawRuns
    .map((run) => ({
      text: sanitizeXmlText(String(run.text ?? "")),
      alert: Boolean(run.alert),
    }))
    .filter((run) => run.text.length > 0);
  if (!sanitized.length) return [{ text: "", alert: false }];
  if (/^[=+\-@]/u.test(sanitized[0].text)) {
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

function inlineStringCell(reference: string, value: unknown, style: number): string {
  const safeValue = escapeXml(safeSpreadsheetText(value));
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${safeValue}</t></is></c>`;
}

function safeSpreadsheetText(value: unknown): string {
  let text = sanitizeXmlText(value === null || value === undefined ? "" : String(value));

  if (/^[=+\-@]/.test(text)) {
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
    .replaceAll("'", "&apos;");
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
  return `${XML_DECLARATION}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF17202A"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD8E0E8"/></left>
      <right style="thin"><color rgb="FFD8E0E8"/></right>
      <top style="thin"><color rgb="FFD8E0E8"/></top>
      <bottom style="thin"><color rgb="FFD8E0E8"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
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
