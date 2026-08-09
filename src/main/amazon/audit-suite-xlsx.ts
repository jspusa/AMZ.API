import { strToU8, zipSync } from "fflate";
import type { AuditSuiteContext } from "../../shared/audit-suite";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAX_CELL_CHARACTERS = 32_767;
const SNAPSHOT_STATUSES: readonly AuditSuiteSnapshotStatus[] = [
  "completed", "partial", "failed",
];

export type AuditSuiteSnapshotStatus = "completed" | "partial" | "failed";

export type ValidatedAuditSuiteSnapshot<TPayload> = AuditSuiteContext & Readonly<
  | {
      status: "completed" | "partial";
      fetchedAt: string;
      notice: string;
      payload: TPayload;
    }
  | {
      status: "failed";
      fetchedAt: null;
      notice: string;
      payload: null;
    }
>;

export type SubscriptionAuditAnomalyRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  anomaly: string;
  sellerFundedBaseDiscountPercent: number | null;
  currentActiveSubscriptions: number | null;
  currentPrice: number | null;
  notice: string;
}>;

export type AgedInventoryOver180Row = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  ageBucket: string;
  quantity: number | null;
  notice: string;
}>;

export type EstimatedExcessRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  estimatedExcessQuantity: number | null;
  daysOfSupply: number | null;
  recommendedAction: string;
  notice: string;
}>;

export type InventoryAuditSuitePayload = Readonly<{
  over180Rows: readonly AgedInventoryOver180Row[];
  estimatedExcessRows: readonly EstimatedExcessRow[];
}>;

export type ContentAuditProblemRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  problemType: string;
  field: string;
  originalText: string;
  description: string;
}>;

export type ImageAuditProblemRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  imageCount: number | null;
  finding: string;
  notice: string;
}>;

export type UnboundVariationAuditRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  productType: string;
  notice: string;
}>;

export type ReviewAuditResultRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  topic: string;
  sentiment: "正向" | "負向";
  starRatingImpact: number | null;
  mentions: number | null;
  occurrencePercent: number | null;
  notice: string;
}>;

export type ReviewAuditIncompleteRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  code: string;
  message: string;
}>;

export type ReviewAuditSuitePayload = Readonly<{
  resultRows: readonly ReviewAuditResultRow[];
  incompleteRows: readonly ReviewAuditIncompleteRow[];
}>;

export type AdvertisingCoverageAuditRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  finding: string;
  evidence: string;
  notice: string;
}>;

export type AuditSuiteWorkbookInput = Readonly<{
  context: AuditSuiteContext;
  marketplaceLabel: string;
  generatedAt: string | Date;
  sections: Readonly<{
    subscription: ValidatedAuditSuiteSnapshot<readonly SubscriptionAuditAnomalyRow[]> | null;
    inventory: ValidatedAuditSuiteSnapshot<InventoryAuditSuitePayload> | null;
    content: ValidatedAuditSuiteSnapshot<readonly ContentAuditProblemRow[]> | null;
    image: ValidatedAuditSuiteSnapshot<readonly ImageAuditProblemRow[]> | null;
    variation: ValidatedAuditSuiteSnapshot<readonly UnboundVariationAuditRow[]> | null;
    review: ValidatedAuditSuiteSnapshot<ReviewAuditSuitePayload> | null;
    advertising: ValidatedAuditSuiteSnapshot<readonly AdvertisingCoverageAuditRow[]> | null;
  }>;
}>;

type Cell = Readonly<{
  value: string | number | null;
  style: 2 | 3 | 4 | 5;
}>;

type SheetDefinition = Readonly<{
  name: string;
  headers: readonly string[];
  widths: readonly number[];
  rows: readonly (readonly Cell[])[];
}>;

function textCell(value: string, style: Cell["style"] = 3): Cell {
  return { value, style };
}

function numberCell(value: number | null): Cell {
  return { value, style: 3 };
}

function safeText(value: string, label: string, maximum = 20_000): string {
  if (typeof value !== "string" || value.length > maximum) {
    throw new TypeError(`${label}格式無效。`);
  }
  const sanitized = sanitizeXmlText(value);
  const characters = Array.from(sanitized);
  const truncated = characters.slice(0, MAX_CELL_CHARACTERS).join("");
  return /^[=+\-@]/u.test(truncated) ? `'${truncated}` : truncated;
}

function exactSku(value: string): string {
  if (!value || value !== value.trim() || value.length > 40) {
    throw new TypeError("綜合健檢 Seller SKU 無法原樣辨識。");
  }
  return safeText(value, "Seller SKU", 40);
}

function finiteNumber(
  value: number | null,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label}必須是可核對的有限數值或未知。`);
  }
  return value;
}

function validDate(value: string | Date, label: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${label}無效。`);
  return parsed;
}

function snapshotStatusLabel(status: AuditSuiteSnapshotStatus): string {
  if (status === "completed") return "已完成";
  if (status === "partial") return "範圍未完整";
  return "失敗";
}

type AuditSuiteSnapshotMetadata = AuditSuiteContext & Readonly<{
  status: AuditSuiteSnapshotStatus;
  fetchedAt: string | null;
  notice: string;
}>;

function validateSnapshotMetadata<TSnapshot extends AuditSuiteSnapshotMetadata>(
  snapshot: TSnapshot,
  expected: AuditSuiteContext,
  label: string,
): TSnapshot {
  if (!SNAPSHOT_STATUSES.includes(snapshot.status)) {
    throw new TypeError(`${label}快照狀態無效。`);
  }
  if (
    snapshot.runId !== expected.runId ||
    snapshot.marketplaceId !== expected.marketplaceId ||
    snapshot.accountScope !== expected.accountScope ||
    snapshot.mode !== expected.mode
  ) {
    throw new TypeError(`${label}快照與綜合健檢 context 不一致。`);
  }
  if (!snapshot.notice.trim() || snapshot.notice.length > 2_000) {
    throw new TypeError(`${label}快照缺少範圍說明。`);
  }
  return snapshot;
}

function validateSnapshot<TPayload>(
  snapshot: ValidatedAuditSuiteSnapshot<TPayload>,
  expected: AuditSuiteContext,
  label: string,
): ValidatedAuditSuiteSnapshot<TPayload> {
  validateSnapshotMetadata(snapshot, expected, label);
  if (snapshot.status === "failed") {
    if (snapshot.payload !== null || snapshot.fetchedAt !== null) {
      throw new TypeError(`${label}失敗快照不可攜帶資料或假時間。`);
    }
  } else {
    if (snapshot.payload === null || snapshot.fetchedAt === null) {
      throw new TypeError(`${label}快照缺少已驗證資料或時間。`);
    }
    validDate(snapshot.fetchedAt, `${label}資料時間`);
  }
  return snapshot;
}

function statusRow(columnCount: number, status: string, notice: string): readonly Cell[] {
  return Array.from({ length: columnCount }, (_value, index) =>
    index === 0
      ? textCell(status, status === "失敗" ? 5 : 4)
      : index === columnCount - 1
        ? textCell(notice, status === "失敗" ? 5 : 4)
        : textCell("", status === "失敗" ? 5 : 4),
  );
}

function rowsForSnapshot<TPayload>(input: {
  snapshot: ValidatedAuditSuiteSnapshot<TPayload> | null;
  context: AuditSuiteContext;
  label: string;
  columnCount: number;
  emptyNotice: string;
  map: (payload: TPayload) => readonly (readonly Cell[])[];
}): readonly (readonly Cell[])[] {
  if (!input.snapshot) {
    return [statusRow(
      input.columnCount,
      "未完成",
      `本次合併匯出沒有可核對的${input.label}快照；未填入 0，也不視為完整。`,
    )];
  }
  const snapshot = validateSnapshot(input.snapshot, input.context, input.label);
  if (snapshot.status === "failed") {
    return [statusRow(input.columnCount, "失敗", snapshot.notice)];
  }
  const mapped = input.map(snapshot.payload);
  const rows = mapped.length
    ? [...mapped]
    : [statusRow(input.columnCount, "已完成", input.emptyNotice)];
  if (snapshot.status === "partial") {
    rows.push(statusRow(input.columnCount, "範圍未完整", snapshot.notice));
  }
  return rows;
}

function checkedRow(values: readonly Cell[]): readonly Cell[] {
  return [textCell("已核對"), ...values];
}

function createSheetDefinitions(input: AuditSuiteWorkbookInput): readonly SheetDefinition[] {
  const context = input.context;
  const sectionSummary = [
    ["訂閱異常", input.sections.subscription],
    ["庫齡與預估冗餘", input.sections.inventory],
    ["文案問題", input.sections.content],
    ["圖片問題", input.sections.image],
    ["未綁變體", input.sections.variation],
    ["評論主題", input.sections.review],
    ["廣告覆蓋", input.sections.advertising],
  ] as const;
  const overviewRows = sectionSummary.map(([label, snapshot]) => {
    if (!snapshot) {
      return [
        textCell(label),
        textCell("未完成", 4),
        textCell(""),
        textCell("本次執行沒有可核對快照；未知不補 0，也不視為完整。", 4),
      ];
    }
    const validated = validateSnapshotMetadata(snapshot, context, label);
    return [
      textCell(label),
      textCell(snapshotStatusLabel(validated.status), validated.status === "failed" ? 5 : validated.status === "partial" ? 4 : 3),
      textCell(validated.fetchedAt ?? ""),
      textCell(validated.notice, validated.status === "failed" ? 5 : validated.status === "partial" ? 4 : 3),
    ];
  });

  const subscriptionHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "異常類型", "賣家基礎折扣（%）",
    "目前有效訂閱", "目前售價", "說明",
  ];
  const inventoryAgeHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "Amazon 庫齡區間", "數量", "說明",
  ];
  const excessHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "Amazon 預估冗餘數量",
    "供應天數", "建議動作", "說明",
  ];
  const contentHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "問題類型", "欄位", "原文", "說明",
  ];
  const imageHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "圖片數", "判定", "說明",
  ];
  const variationHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "商品類型", "判定依據",
  ];
  const reviewResultHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "主題", "正負向", "主題星等影響",
    "提及數", "出現比例（%）", "說明",
  ];
  const reviewIncompleteHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "狀態碼", "未完成原因",
  ];
  const advertisingHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "判定", "證據", "說明",
  ];

  return [
    {
      name: "總覽",
      headers: ["健檢項目", "執行狀態", "資料時間", "範圍說明"],
      widths: [24, 16, 24, 92],
      rows: overviewRows,
    },
    {
      name: "訂閱異常",
      headers: subscriptionHeaders,
      widths: [16, 26, 48, 18, 36, 20, 18, 16, 64],
      rows: rowsForSnapshot({
        snapshot: input.sections.subscription,
        context,
        label: "訂閱異常",
        columnCount: subscriptionHeaders.length,
        emptyNotice: "此快照已完整核對；沒有符合訂閱異常條件的項目。",
        map: (payload) => payload.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "訂閱商品標題")),
          textCell(safeText(row.asin, "訂閱 ASIN", 20), 2),
          textCell(safeText(row.anomaly, "訂閱異常")),
          numberCell(finiteNumber(row.sellerFundedBaseDiscountPercent, "賣家基礎折扣", 0, 100)),
          numberCell(finiteNumber(row.currentActiveSubscriptions, "目前有效訂閱")),
          numberCell(finiteNumber(row.currentPrice, "目前售價")),
          textCell(safeText(row.notice, "訂閱說明")),
        ])),
      }),
    },
    {
      name: "180天以上庫齡",
      headers: inventoryAgeHeaders,
      widths: [16, 26, 48, 18, 28, 14, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.inventory,
        context,
        label: "庫齡",
        columnCount: inventoryAgeHeaders.length,
        emptyNotice: "此快照已完整核對；沒有已驗證為 180 天以上庫齡的項目。",
        map: (payload) => payload.over180Rows.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "庫齡商品標題")),
          textCell(safeText(row.asin, "庫齡 ASIN", 20), 2),
          textCell(safeText(row.ageBucket, "Amazon 庫齡區間")),
          numberCell(finiteNumber(row.quantity, "庫齡數量")),
          textCell(safeText(row.notice, "庫齡說明")),
        ])),
      }),
    },
    {
      name: "預估冗餘",
      headers: excessHeaders,
      widths: [16, 26, 48, 18, 24, 16, 32, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.inventory,
        context,
        label: "預估冗餘",
        columnCount: excessHeaders.length,
        emptyNotice: "此快照已完整核對；沒有 Amazon 已回傳的預估冗餘項目。",
        map: (payload) => payload.estimatedExcessRows.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "冗餘商品標題")),
          textCell(safeText(row.asin, "冗餘 ASIN", 20), 2),
          numberCell(finiteNumber(row.estimatedExcessQuantity, "預估冗餘數量")),
          numberCell(finiteNumber(row.daysOfSupply, "供應天數")),
          textCell(safeText(row.recommendedAction, "建議動作")),
          textCell(safeText(row.notice, "冗餘說明")),
        ])),
      }),
    },
    {
      name: "文案問題",
      headers: contentHeaders,
      widths: [16, 26, 48, 18, 24, 18, 72, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.content,
        context,
        label: "文案問題",
        columnCount: contentHeaders.length,
        emptyNotice: "此快照已完整核對；沒有符合文案問題條件的項目。",
        map: (payload) => payload.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "文案商品標題")),
          textCell(safeText(row.asin, "文案 ASIN", 20), 2),
          textCell(safeText(row.problemType, "文案問題類型")),
          textCell(safeText(row.field, "文案欄位")),
          textCell(safeText(row.originalText, "文案原文")),
          textCell(safeText(row.description, "文案問題說明")),
        ])),
      }),
    },
    {
      name: "圖片問題",
      headers: imageHeaders,
      widths: [16, 26, 48, 18, 14, 24, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.image,
        context,
        label: "圖片問題",
        columnCount: imageHeaders.length,
        emptyNotice: "此快照已完整核對；沒有符合圖片問題條件的項目。",
        map: (payload) => payload.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "圖片商品標題")),
          textCell(safeText(row.asin, "圖片 ASIN", 20), 2),
          numberCell(finiteNumber(row.imageCount, "圖片數", 0, 9)),
          textCell(safeText(row.finding, "圖片判定")),
          textCell(safeText(row.notice, "圖片說明")),
        ])),
      }),
    },
    {
      name: "未綁變體",
      headers: variationHeaders,
      widths: [16, 26, 48, 18, 24, 82],
      rows: rowsForSnapshot({
        snapshot: input.sections.variation,
        context,
        label: "未綁變體",
        columnCount: variationHeaders.length,
        emptyNotice: "此快照已完整核對；沒有 relationships 已證明為未綁變體的項目。",
        map: (payload) => payload.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "變體商品標題")),
          textCell(safeText(row.asin, "變體 ASIN", 20), 2),
          textCell(safeText(row.productType, "商品類型")),
          textCell(safeText(row.notice, "變體判定依據")),
        ])),
      }),
    },
    {
      name: "評論結果",
      headers: reviewResultHeaders,
      widths: [16, 26, 48, 18, 46, 14, 18, 14, 18, 64],
      rows: rowsForSnapshot({
        snapshot: input.sections.review,
        context,
        label: "評論結果",
        columnCount: reviewResultHeaders.length,
        emptyNotice: "此快照已完整核對；沒有可列出的非 parent ASIN 評論主題結果。",
        map: (payload) => payload.resultRows.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "評論商品標題")),
          textCell(safeText(row.asin, "評論 ASIN", 20), 2),
          textCell(safeText(row.topic, "評論主題")),
          textCell(row.sentiment),
          numberCell(finiteNumber(row.starRatingImpact, "主題星等影響", -5, 5)),
          numberCell(finiteNumber(row.mentions, "評論提及數")),
          numberCell(finiteNumber(row.occurrencePercent, "評論出現比例", 0, 100)),
          textCell(safeText(row.notice, "評論結果說明")),
        ])),
      }),
    },
    {
      name: "評論未完成",
      headers: reviewIncompleteHeaders,
      widths: [16, 26, 48, 18, 34, 84],
      rows: rowsForSnapshot({
        snapshot: input.sections.review,
        context,
        label: "評論未完成",
        columnCount: reviewIncompleteHeaders.length,
        emptyNotice: "此快照已完整核對；沒有評論讀取未完成項目。",
        map: (payload) => payload.incompleteRows.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "評論未完成商品標題")),
          textCell(safeText(row.asin, "評論未完成 ASIN", 20), 2),
          textCell(safeText(row.code, "評論未完成狀態碼")),
          textCell(safeText(row.message, "評論未完成原因")),
        ])),
      }),
    },
    {
      name: "廣告覆蓋",
      headers: advertisingHeaders,
      widths: [16, 26, 48, 18, 22, 72, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.advertising,
        context,
        label: "廣告覆蓋",
        columnCount: advertisingHeaders.length,
        emptyNotice: "此快照已完整核對；沒有可列出的 FBA 廣告覆蓋項目。",
        map: (payload) => payload.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "廣告商品標題")),
          textCell(safeText(row.asin, "廣告 ASIN", 20), 2),
          textCell(safeText(row.finding, "廣告覆蓋判定")),
          textCell(safeText(row.evidence, "廣告覆蓋證據")),
          textCell(safeText(row.notice, "廣告覆蓋說明")),
        ])),
      }),
    },
  ];
}

export function createAuditSuiteWorkbook(input: AuditSuiteWorkbookInput): Uint8Array {
  if (!input.marketplaceLabel.trim()) throw new TypeError("綜合健檢站點標籤不可空白。");
  const generatedAt = validDate(input.generatedAt, "綜合健檢 Excel 產生時間");
  const sheets = createSheetDefinitions(input);
  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(buildContentTypes(sheets.length)),
    "_rels/.rels": strToU8(buildPackageRelationships()),
    "docProps/app.xml": strToU8(buildAppProperties(sheets.map((sheet) => sheet.name))),
    "docProps/core.xml": strToU8(buildCoreProperties(input.marketplaceLabel, generatedAt)),
    "xl/_rels/workbook.xml.rels": strToU8(buildWorkbookRelationships(sheets.length)),
    "xl/styles.xml": strToU8(buildStyles()),
    "xl/workbook.xml": strToU8(buildWorkbook(sheets.map((sheet) => sheet.name))),
  };
  sheets.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(buildWorksheet(sheet));
  });
  return zipSync(archive, { level: 6 });
}

function buildWorksheet(sheet: SheetDefinition): string {
  if (!sheet.headers.length || sheet.headers.length !== sheet.widths.length) {
    throw new Error(`${sheet.name}工作表欄位與欄寬不一致。`);
  }
  const finalColumn = columnName(sheet.headers.length);
  const finalRow = Math.max(1, sheet.rows.length + 1);
  const columns = sheet.widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  ).join("");
  const headerCells = sheet.headers.map((header, index) =>
    inlineStringCell(`${columnName(index + 1)}1`, header, 1),
  ).join("");
  const dataRows = sheet.rows.map((row, rowIndex) => {
    if (row.length !== sheet.headers.length) {
      throw new Error(`${sheet.name}第 ${rowIndex + 1} 列欄位數不一致。`);
    }
    const excelRow = rowIndex + 2;
    const cells = row.map((cell, columnIndex) =>
      renderCell(`${columnName(columnIndex + 1)}${excelRow}`, cell),
    ).join("");
    return `<row r="${excelRow}" ht="36" customHeight="1">${cells}</row>`;
  }).join("");
  return `${XML_DECLARATION}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${finalColumn}${finalRow}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData><row r="1" ht="28" customHeight="1">${headerCells}</row>${dataRows}</sheetData>
  <autoFilter ref="A1:${finalColumn}${finalRow}"/>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup paperSize="9" orientation="landscape" pageOrder="downThenOver" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function renderCell(reference: string, cell: Cell): string {
  if (typeof cell.value === "number") {
    if (!Number.isFinite(cell.value)) throw new TypeError(`${reference}不是有限數值。`);
    return `<c r="${reference}" s="${cell.style}"><v>${cell.value}</v></c>`;
  }
  return inlineStringCell(reference, cell.value ?? "", cell.style);
}

function inlineStringCell(reference: string, value: string, style: number): string {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(safeText(value, reference))}</t></is></c>`;
}

function buildStyles(): string {
  return `${XML_DECLARATION}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><color rgb="FF17202A"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font></fonts>
  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE9E7"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8E0E8"/></left><right style="thin"><color rgb="FFD8E0E8"/></right><top style="thin"><color rgb="FFD8E0E8"/></top><bottom style="thin"><color rgb="FFD8E0E8"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function buildWorkbook(sheetNames: readonly string[]): string {
  const sheets = sheetNames.map((name, index) =>
    `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join("");
  const definedNames = sheetNames.map((name, index) =>
    `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${name.replaceAll("'", "''")}'!$1:$1</definedName>`,
  ).join("");
  return `${XML_DECLARATION}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets}</sheets><definedNames>${definedNames}</definedNames><calcPr calcId="0" calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"/></workbook>`;
}

function buildContentTypes(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_value, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${sheets}</Types>`;
}

function buildPackageRelationships(): string {
  return `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function buildWorkbookRelationships(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_value, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function buildAppProperties(sheetNames: readonly string[]): string {
  const titles = sheetNames.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join("");
  return `${XML_DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AMZ.API</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts></Properties>`;
}

function buildCoreProperties(marketplaceLabel: string, generatedAt: Date): string {
  const timestamp = generatedAt.toISOString();
  return `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Amazon FBA 綜合健檢</dc:title><dc:subject>${escapeXml(safeText(marketplaceLabel, "站點標籤"))}</dc:subject><dc:creator>AMZ.API</dc:creator><cp:lastModifiedBy>AMZ.API</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`;
}

function columnName(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function sanitizeXmlText(value: string): string {
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const valid = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    output += valid ? character : "\uFFFD";
  }
  return output;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
