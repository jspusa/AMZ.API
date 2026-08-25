import { strToU8, zipSync } from "fflate";
import {
  AUDIT_SUITE_SECTIONS,
  AUDIT_SUITE_SECTION_LABELS,
} from "../../shared/audit-suite";
import type { AuditSuiteContext } from "./audit-suite-context";

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

export type APlusAuditProblemRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
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

export type AdvertisingCoverageAuditRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  finding: string;
  evidence: string;
  notice: string;
}>;

export type BusinessPricingAuditProblemRow = Readonly<{
  sellerSku: string;
  title: string;
  asin: string;
  standardPrice: number | null;
  businessPrice: number | null;
  currencyCode: string | null;
  finding: string;
  editable: boolean;
  notice: string;
}>;

export type AuditSuiteWorkbookInput = Readonly<{
  context: AuditSuiteContext;
  marketplaceLabel: string;
  generatedAt: string | Date;
  sections: Readonly<{
    content: ValidatedAuditSuiteSnapshot<readonly ContentAuditProblemRow[]> | null;
    image: ValidatedAuditSuiteSnapshot<readonly ImageAuditProblemRow[]> | null;
    aplus: ValidatedAuditSuiteSnapshot<readonly APlusAuditProblemRow[]> | null;
    variation: ValidatedAuditSuiteSnapshot<readonly UnboundVariationAuditRow[]> | null;
    subscription: ValidatedAuditSuiteSnapshot<readonly SubscriptionAuditAnomalyRow[]> | null;
    businessPricing: ValidatedAuditSuiteSnapshot<readonly BusinessPricingAuditProblemRow[]> | null;
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

function currencyCode(value: string | null, hasPrice: boolean): string {
  if (value === null) {
    if (hasPrice) throw new TypeError("B2B 價格有數值時必須提供幣別。");
    return "";
  }
  if (!/^[A-Z]{3}$/u.test(value)) throw new TypeError("B2B 價格幣別無效。");
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
    snapshot.generation !== expected.generation ||
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
  const sectionSummary = AUDIT_SUITE_SECTIONS.map(({ id, label }) =>
    [label, input.sections[id]] as const
  );
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
  const contentHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "問題類型", "欄位", "原文", "說明",
  ];
  const imageHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "圖片數", "判定", "說明",
  ];
  const aplusHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "A+ 判定", "說明",
  ];
  const variationHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "商品類型", "判定依據",
  ];
  const advertisingHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "判定", "證據", "說明",
  ];
  const businessPricingHeaders = [
    "資料狀態", "SKU", "商品標題", "ASIN", "一般售價", "B2B 價格", "幣別",
    "判定", "可直接修改", "說明",
  ];

  return [
    {
      name: "總覽",
      headers: ["健檢項目", "執行狀態", "資料時間", "範圍說明"],
      widths: [24, 16, 24, 92],
      rows: overviewRows,
    },
    {
      name: AUDIT_SUITE_SECTION_LABELS.content,
      headers: contentHeaders,
      widths: [16, 26, 48, 18, 24, 18, 72, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.content,
        context,
        label: AUDIT_SUITE_SECTION_LABELS.content,
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
      name: AUDIT_SUITE_SECTION_LABELS.image,
      headers: imageHeaders,
      widths: [16, 26, 48, 18, 14, 24, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.image,
        context,
        label: AUDIT_SUITE_SECTION_LABELS.image,
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
      name: AUDIT_SUITE_SECTION_LABELS.aplus,
      headers: aplusHeaders,
      widths: [16, 26, 48, 18, 28, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.aplus,
        context,
        label: AUDIT_SUITE_SECTION_LABELS.aplus,
        columnCount: aplusHeaders.length,
        emptyNotice: "此快照已完整核對；沒有符合 A+ 健檢條件的項目。",
        map: (payload) => payload.map((row) => checkedRow([
          textCell(exactSku(row.sellerSku), 2),
          textCell(safeText(row.title, "A+ 商品標題")),
          textCell(safeText(row.asin, "A+ ASIN", 20), 2),
          textCell(safeText(row.finding, "A+ 判定")),
          textCell(safeText(row.notice, "A+ 說明")),
        ])),
      }),
    },
    {
      name: AUDIT_SUITE_SECTION_LABELS.variation,
      headers: variationHeaders,
      widths: [16, 26, 48, 18, 24, 82],
      rows: rowsForSnapshot({
        snapshot: input.sections.variation,
        context,
        label: AUDIT_SUITE_SECTION_LABELS.variation,
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
      name: AUDIT_SUITE_SECTION_LABELS.subscription,
      headers: subscriptionHeaders,
      widths: [16, 26, 48, 18, 36, 20, 18, 16, 64],
      rows: rowsForSnapshot({
        snapshot: input.sections.subscription,
        context,
        label: AUDIT_SUITE_SECTION_LABELS.subscription,
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
      name: AUDIT_SUITE_SECTION_LABELS.businessPricing,
      headers: businessPricingHeaders,
      widths: [16, 26, 48, 18, 16, 16, 12, 32, 16, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.businessPricing,
        context,
        label: AUDIT_SUITE_SECTION_LABELS.businessPricing,
        columnCount: businessPricingHeaders.length,
        emptyNotice: "此快照已完整核對；沒有符合 B2B 價格健檢條件的項目。",
        map: (payload) => payload.map((row) => {
          const standardPrice = finiteNumber(row.standardPrice, "一般售價", 0, 1_000_000_000);
          const businessPrice = finiteNumber(row.businessPrice, "B2B 價格", 0, 1_000_000_000);
          const code = currencyCode(
            row.currencyCode,
            standardPrice !== null || businessPrice !== null,
          );
          return checkedRow([
            textCell(exactSku(row.sellerSku), 2),
            textCell(safeText(row.title, "B2B 商品標題")),
            textCell(safeText(row.asin, "B2B ASIN", 20), 2),
            numberCell(standardPrice),
            numberCell(businessPrice),
            textCell(code),
            textCell(safeText(row.finding, "B2B 價格判定")),
            textCell(row.editable ? "是" : "否"),
            textCell(safeText(row.notice, "B2B 價格說明")),
          ]);
        }),
      }),
    },
    {
      name: AUDIT_SUITE_SECTION_LABELS.advertising,
      headers: advertisingHeaders,
      widths: [16, 26, 48, 18, 22, 72, 72],
      rows: rowsForSnapshot({
        snapshot: input.sections.advertising,
        context,
        label: AUDIT_SUITE_SECTION_LABELS.advertising,
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
    `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${escapeXml(`'${name.replaceAll("'", "''")}'!$1:$1`)}</definedName>`,
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
