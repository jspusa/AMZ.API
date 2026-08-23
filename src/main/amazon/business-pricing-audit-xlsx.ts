import { strToU8, zipSync } from "fflate";
import {
  businessPricingRecommendationFlags,
  recommendedBusinessPriceDetermination,
} from "../../shared/business-pricing-recommendations";
import type {
  BusinessPricingAuditRow,
  BusinessPricingAuditSnapshot,
} from "./sp-api";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAX_CELL_CHARACTERS = 32_767;

type Cell = Readonly<{
  value: string | number | null;
  style: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
}>;

type Sheet = Readonly<{
  name: string;
  headers: readonly string[];
  widths: readonly number[];
  rows: readonly (readonly Cell[])[];
}>;

const DETAIL_HEADERS = [
  "SKU",
  "ASIN",
  "商品名稱",
  "Product Type",
  "一般售價",
  "B2B 價格",
  "建議 B2B 價格",
  "幣別",
  "目前數量折扣",
  "價格建議判定",
  "階梯建議判定",
  "資料狀態",
  "說明",
] as const;

const DETAIL_WIDTHS = [
  24, 16, 48, 22, 15, 15, 17, 10, 48, 24, 26, 18, 72,
] as const;

function safeText(value: string, label: string, maximum = 20_000): string {
  if (typeof value !== "string" || value.length > maximum) {
    throw new TypeError(`${label}格式無效。`);
  }
  const sanitized = sanitizeXmlText(value);
  const truncated = Array.from(sanitized).slice(0, MAX_CELL_CHARACTERS).join("");
  return /^[=+\-@]/u.test(truncated) ? `'${truncated}` : truncated;
}

function exactSku(value: string): string {
  if (
    !value ||
    value !== value.trim() ||
    value.length > 40 ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  ) throw new TypeError("B2B Excel Seller SKU 無法原樣辨識。");
  return safeText(value, "Seller SKU", 40);
}

function validDate(value: string | Date): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError("B2B Excel 時間無效。");
  return parsed;
}

function moneyAmount(
  value: BusinessPricingAuditRow["standardPrice"],
  label: string,
): number | null {
  if (value === null) return null;
  if (
    !Number.isFinite(value.amount) ||
    value.amount <= 0 ||
    value.amount > 1_000_000_000 ||
    !/^[A-Z]{3}$/u.test(value.currencyCode)
  ) throw new TypeError(`${label}無效。`);
  return value.amount;
}

function recommendedPrice(row: BusinessPricingAuditRow): number | null {
  if (
    !row.standardPrice ||
    row.standardPrice.currencyCode !== "USD" ||
    row.standardPrice.amount <= 1
  ) return null;
  return Number((row.standardPrice.amount - 1).toFixed(2));
}

function quantityDiscountText(row: BusinessPricingAuditRow): string {
  if (row.quantityDiscountPlanPresence === "ambiguous") {
    return "Amazon 未能確認";
  }
  const plan = row.quantityDiscountPlan;
  if (row.quantityDiscountPlanPresence === "absent") {
    if (plan !== null) throw new TypeError("B2B Excel 數量折扣 absence 矛盾。");
    return "未設定";
  }
  if (!plan || !plan.levels.length || plan.levels.length > 5) {
    throw new TypeError("B2B Excel 數量折扣內容無效。");
  }
  const kind = plan.discountType === "percent" ? "百分比" : "固定單價";
  return `${kind}：${plan.levels.map((level) => {
    if (
      !Number.isSafeInteger(level.lowerBound) ||
      level.lowerBound <= 0 ||
      !Number.isFinite(level.value) ||
      level.value <= 0
    ) throw new TypeError("B2B Excel 數量折扣階梯無效。");
    return `${level.lowerBound}件=${level.value}${
      plan.discountType === "percent" ? "%" : ""
    }`;
  }).join("、")}`;
}

function statusLabel(status: BusinessPricingAuditRow["status"]): string {
  if (status === "configured") return "已設定";
  if (status === "above_standard") return "B2B 高於一般售價";
  if (status === "missing") return "未設定 B2B 價格";
  if (status === "unsupported") return "請至 Amazon 後台確認";
  if (status === "incomplete") return "資料未完成";
  throw new TypeError("B2B Excel 列狀態無效。");
}

function validatedRows(snapshot: BusinessPricingAuditSnapshot): BusinessPricingAuditRow[] {
  if (
    snapshot.mode !== "live" && snapshot.mode !== "demo" ||
    !/^[A-Z0-9]{10,24}$/u.test(snapshot.marketplaceId) ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length > 25_000
  ) throw new TypeError("B2B Excel 快照 context 無效。");
  const seen = new Set<string>();
  const rows = snapshot.rows.map((row) => {
    exactSku(row.sellerSku);
    if (seen.has(row.sellerSku)) throw new TypeError("B2B Excel 含有重複 SKU。");
    seen.add(row.sellerSku);
    if (row.asin && !/^[A-Z0-9]{10}$/u.test(row.asin)) {
      throw new TypeError("B2B Excel ASIN 無法原樣辨識。");
    }
    safeText(row.title, "B2B 商品名稱", 2_000);
    safeText(row.productType, "B2B Product Type", 120);
    safeText(row.reason, "B2B 判定說明", 2_000);
    const standard = moneyAmount(row.standardPrice, "B2B 一般售價");
    const business = moneyAmount(row.businessPrice, "B2B 價格");
    if (
      standard !== null &&
      business !== null &&
      row.standardPrice!.currencyCode !== row.businessPrice!.currencyCode
    ) throw new TypeError("B2B Excel 價格幣別不一致。");
    quantityDiscountText(row);
    statusLabel(row.status);
    const flags = businessPricingRecommendationFlags({
      standardPrice: row.standardPrice,
      businessPrice: row.businessPrice,
      quantityDiscountPlan: row.quantityDiscountPlan,
      quantityDiscountPlanPresence: row.quantityDiscountPlanPresence,
    });
    if (
      row.recommendedPriceMismatch !== flags.recommendedPriceMismatch ||
      row.recommendedQuantityDiscountMismatch !==
        flags.recommendedQuantityDiscountMismatch
    ) throw new TypeError("B2B Excel 建議分類與來源列不一致。");
    return row;
  });
  const expectedSummary = {
    totalFbaSkuCount: rows.length,
    configured: rows.filter((row) => row.status === "configured").length,
    aboveStandard: rows.filter((row) => row.status === "above_standard").length,
    missing: rows.filter((row) => row.status === "missing").length,
    unsupported: rows.filter((row) => row.status === "unsupported").length,
    incomplete: rows.filter((row) => row.status === "incomplete").length,
    recommendedPriceMismatch: rows.filter((row) =>
      row.recommendedPriceMismatch
    ).length,
    recommendedQuantityDiscountMismatch: rows.filter((row) =>
      row.recommendedQuantityDiscountMismatch
    ).length,
  };
  if (Object.entries(expectedSummary).some(([key, value]) =>
    snapshot.summary[key as keyof typeof expectedSummary] !== value
  )) throw new TypeError("B2B Excel 摘要與來源列不一致。");
  return rows;
}

function text(value: string, style: Cell["style"] = 3): Cell {
  return { value, style };
}

function amount(value: number | null, style: Cell["style"]): Cell {
  return { value, style };
}

function rowStyle(row: BusinessPricingAuditRow): 3 | 4 | 5 {
  if (row.status === "incomplete" || row.status === "unsupported") return 5;
  if (
    row.status !== "configured" ||
    row.recommendedPriceMismatch ||
    row.recommendedQuantityDiscountMismatch
  ) return 4;
  return 3;
}

function detailRow(row: BusinessPricingAuditRow): readonly Cell[] {
  const style = rowStyle(row);
  const numberStyle = style === 3 ? 6 : style === 4 ? 7 : 8;
  const currency = row.businessPrice?.currencyCode ??
    row.standardPrice?.currencyCode ?? "";
  const priceDetermination = recommendedBusinessPriceDetermination({
    standardPrice: row.standardPrice,
    businessPrice: row.businessPrice,
  });
  return [
    text(exactSku(row.sellerSku), 2),
    text(safeText(row.asin, "ASIN", 10), 2),
    text(safeText(row.title, "商品名稱", 2_000), style),
    text(safeText(row.productType, "Product Type", 120), style),
    amount(moneyAmount(row.standardPrice, "一般售價"), numberStyle),
    amount(moneyAmount(row.businessPrice, "B2B 價格"), numberStyle),
    amount(recommendedPrice(row), numberStyle),
    text(currency, style),
    text(quantityDiscountText(row), style),
    text(
      priceDetermination === "mismatch"
        ? "不符建議"
        : priceDetermination === "matches"
          ? "符合建議"
          : "無法判定",
      style,
    ),
    text(
      row.recommendedQuantityDiscountMismatch
        ? "未正確設定"
        : row.quantityDiscountPlanPresence === "ambiguous"
          ? "Amazon 未能確認"
          : "符合建議",
      style,
    ),
    text(statusLabel(row.status), style),
    text(safeText(row.reason, "說明", 2_000), style),
  ];
}

function detailSheet(
  name: string,
  rows: readonly BusinessPricingAuditRow[],
): Sheet {
  return {
    name,
    headers: DETAIL_HEADERS,
    widths: DETAIL_WIDTHS,
    rows: rows.map(detailRow),
  };
}

export function createBusinessPricingAuditWorkbook(input: Readonly<{
  marketplaceLabel: string;
  snapshot: BusinessPricingAuditSnapshot;
}>): Uint8Array {
  const marketplaceLabel = safeText(input.marketplaceLabel, "B2B Excel 站點", 120);
  if (!marketplaceLabel.trim()) throw new TypeError("B2B Excel 站點不可空白。");
  const generatedAt = validDate(input.snapshot.fetchedAt);
  const rows = validatedRows(input.snapshot);
  const sheets: readonly Sheet[] = [
    {
      name: "總覽",
      headers: ["項目", "數量／規則", "說明"],
      widths: [34, 24, 84],
      rows: [
        [text("站點"), text(marketplaceLabel), text("FBA ONLY；本檔由 Notebook Key 主程序快照建立。")],
        [text("全部 FBA SKU"), amount(rows.length, 9), text("同一 SKU 可同時出現在兩張建議異常工作表。")],
        [text("不符建議 B2B 價格"), amount(input.snapshot.summary.recommendedPriceMismatch, 10), text("已找到 Business Price，且不等於 US 一般售價減 USD 1.00。")],
        [text("未正確設定階梯折扣"), amount(input.snapshot.summary.recommendedQuantityDiscountMismatch, 10), text("明確未設定，或不是 exact 5件5%、10件10%、15件15%、20件20%。")],
        [text("資料未完成"), amount(input.snapshot.summary.incomplete + input.snapshot.summary.unsupported, 11), text("未知不會補成 0，也不會猜成未設定。")],
        [text("價格建議規則"), text("一般售價 - USD 1.00", 4), text("只對 USD 且可計算的已知價格分類。")],
        [text("階梯建議規則"), text("5/5%、10/10%、15/15%、20/20%", 4), text("Amazon 未能確認的 QDP 不冒充為明確不符。")],
      ],
    },
    detailSheet("全部 B2B", rows),
    detailSheet(
      "不符建議 B2B 價格",
      rows.filter((row) => row.recommendedPriceMismatch),
    ),
    detailSheet(
      "未正確設定階梯折扣",
      rows.filter((row) => row.recommendedQuantityDiscountMismatch),
    ),
    detailSheet(
      "資料未完成",
      rows.filter((row) =>
        row.status === "incomplete" || row.status === "unsupported"
      ),
    ),
  ];
  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(sheets.length)),
    "_rels/.rels": strToU8(packageRelationships()),
    "docProps/app.xml": strToU8(appProperties(sheets.map((sheet) => sheet.name))),
    "docProps/core.xml": strToU8(coreProperties(marketplaceLabel, generatedAt)),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships(sheets.length)),
    "xl/styles.xml": strToU8(styles()),
    "xl/workbook.xml": strToU8(workbook(sheets.map((sheet) => sheet.name))),
  };
  sheets.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheet(sheet));
  });
  return zipSync(archive, { level: 6 });
}

function worksheet(sheet: Sheet): string {
  if (!sheet.headers.length || sheet.headers.length !== sheet.widths.length) {
    throw new Error(`${sheet.name}工作表欄位與欄寬不一致。`);
  }
  const lastColumn = columnName(sheet.headers.length);
  const lastRow = Math.max(1, sheet.rows.length + 1);
  const columns = sheet.widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  ).join("");
  const headerCells = sheet.headers.map((header, index) =>
    inlineCell(`${columnName(index + 1)}1`, header, 1)
  ).join("");
  const dataRows = sheet.rows.map((row, rowIndex) => {
    if (row.length !== sheet.headers.length) {
      throw new Error(`${sheet.name}第 ${rowIndex + 1} 列欄位數不一致。`);
    }
    const excelRow = rowIndex + 2;
    const cells = row.map((cell, columnIndex) =>
      renderCell(`${columnName(columnIndex + 1)}${excelRow}`, cell)
    ).join("");
    return `<row r="${excelRow}" ht="34" customHeight="1">${cells}</row>`;
  }).join("");
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData><row r="1" ht="30" customHeight="1">${headerCells}</row>${dataRows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function renderCell(reference: string, cell: Cell): string {
  if (typeof cell.value === "number") {
    if (!Number.isFinite(cell.value)) throw new TypeError(`${reference}不是有限數值。`);
    return `<c r="${reference}" s="${cell.style}"><v>${cell.value}</v></c>`;
  }
  return inlineCell(reference, cell.value ?? "", cell.style);
}

function inlineCell(reference: string, value: string, style: number): string {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(safeText(value, reference))}</t></is></c>`;
}

function styles(): string {
  return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF17202A"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F3F5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8E0E8"/></left><right style="thin"><color rgb="FFD8E0E8"/></right><top style="thin"><color rgb="FFD8E0E8"/></top><bottom style="thin"><color rgb="FFD8E0E8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="3" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
}

function workbook(sheetNames: readonly string[]): string {
  const sheetXml = sheetNames.map((name, index) =>
    `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  const definedNames = sheetNames.map((name, index) =>
    `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${escapeXml(`'${name.replaceAll("'", "''")}'!$1:$1`)}</definedName>`
  ).join("");
  return `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheetXml}</sheets><definedNames>${definedNames}</definedNames><calcPr calcId="0" calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"/></workbook>`;
}

function contentTypes(sheetCount: number): string {
  const sheetTypes = Array.from({ length: sheetCount }, (_value, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${sheetTypes}</Types>`;
}

function packageRelationships(): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function workbookRelationships(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_value, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function appProperties(sheetNames: readonly string[]): string {
  const titles = sheetNames.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join("");
  return `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AMZ.API</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts></Properties>`;
}

function coreProperties(marketplaceLabel: string, generatedAt: Date): string {
  const timestamp = generatedAt.toISOString();
  return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Amazon FBA B2B 價格健檢</dc:title><dc:subject>${escapeXml(marketplaceLabel)}</dc:subject><dc:creator>AMZ.API</dc:creator><cp:lastModifiedBy>AMZ.API</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`;
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
      codePoint >= 0x20 && codePoint <= 0xd7ff ||
      codePoint >= 0xe000 && codePoint <= 0xfffd ||
      codePoint >= 0x10000 && codePoint <= 0x10ffff;
    output += valid ? character : "\uFFFD";
  }
  return output;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
