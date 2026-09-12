import { strToU8, zipSync } from "fflate";
import type { PriceListAmazonRow } from "../shared/price-list";
import {
  overlayPriceListWorkbook,
  parsePriceListWorkbook,
  priceListColumnName,
  type PriceListImageReplacement,
} from "./price-list-workbook";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const SHEET = "US 價目表";
const HEADERS = ["Seller SKU", "圖片", "產品名稱", "ASIN", "Amazon 設定售價 (USD)", "Amazon 最低價格設定 (USD)", "幣別", "讀取結果", "Amazon 讀取時間"];
const WIDTHS = [25, 17, 54, 17, 23, 26, 10, 48, 28];

function escape(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "�")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("\r", "&#xD;");
}
function cell(reference: string, value: string | number, style = 2): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new Error("價目表價格格式無效。");
    return `<c r="${reference}" s="3"><v>${value}</v></c>`;
  }
  // Inline strings preserve exact Seller SKUs (including =,+,-,@ and spaces)
  // while never creating formula cells or external relationships.
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
}

/** Only the completed main-owned FBA read supplies these rows. No transport here. */
export function createGeneratedPriceListWorkbook(
  rows: readonly PriceListAmazonRow[],
  images: readonly PriceListImageReplacement[] = [],
): Uint8Array {
  const seen = new Set<string>();
  if (!rows.length || rows.length > 2_000 || rows.some((row, index) => {
    const bad = !row.sellerSku || row.sellerSku !== row.sellerSku.trim() ||
      row.sellerSku.length > 40 || seen.has(row.sellerSku) ||
      !/^[A-Z0-9]{10}$/u.test(row.asin ?? "") || row.currency !== "USD" ||
      row.sheetName !== SHEET || row.rowNumber !== index + 2;
    if (row.sellerSku) seen.add(row.sellerSku);
    return bad;
  })) throw new Error("產生價目表的 FBA 商品身分不完整。");
  const embedded = new Set(images.map((image) => `${image.sheetName}\0${image.rowNumber}`));
  const data = rows.map((row, index) => {
    const number = index + 2;
    const values: (string | number)[] = [
      row.sellerSku!, embedded.has(`${SHEET}\0${number}`) ? "" : row.imageUrl ? "首圖未下載" : "未回報",
      row.title || "品名未回報", row.asin!, row.standardPrice ?? "未回報",
      row.minimumPriceStatus === "not-set" ? "未設定" : row.minimumPrice ?? "未回報",
      "USD", row.message, row.fetchedAt,
    ];
    return `<row r="${number}" ht="80" customHeight="1">${values.map((value, column) => cell(`${priceListColumnName(column + 1)}${number}`, value)).join("")}</row>`;
  }).join("");
  const worksheet = `<worksheet xmlns="${NS}" xmlns:r="${REL}"><dimension ref="A1:I${rows.length + 1}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${WIDTHS.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData><row r="1" ht="32" customHeight="1">${HEADERS.map((header, index) => cell(`${priceListColumnName(index + 1)}1`, header, 1)).join("")}</row>${data}</sheetData><autoFilter ref="A1:I${rows.length + 1}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const notes = [
    "AMZ.API · US FBA 價目表",
    `資料時間：${rows[0]!.fetchedAt}；每列保留各自的 Amazon 讀取時間。`,
    "Amazon 設定售價為 Listings 一般售價設定；不代表促銷價、Buy Box 成交價或 B2B 價格。",
    "Amazon 最低價格設定為平台價格下限，不是公司最低活動價。",
    "未設定代表 Amazon 明確未設價格下限；未回報代表缺值，不是 0。",
    "只含本次已確認的 US FBA Seller SKU／ASIN；沒有匯入原表，也不包含帳號憑證。",
    "首圖只嵌入成功取得的 Amazon 商品圖片；未回報或未下載的圖片保留文字提示。",
  ];
  const parts: Record<string, string> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="${SHEET}" sheetId="1" r:id="rId1"/><sheet name="欄位說明" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": worksheet,
    "xl/worksheets/sheet2.xml": `<worksheet xmlns="${NS}"><dimension ref="A1:A${notes.length}"/><cols><col min="1" max="1" width="110" customWidth="1"/></cols><sheetData>${notes.map((note, index) => `<row r="${index + 1}" ht="35" customHeight="1">${cell(`A${index + 1}`, note, index === 0 ? 1 : 2)}</row>`).join("")}</sheetData></worksheet>`,
    "xl/styles.xml": `<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><color rgb="FF172337"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF203C62"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD8E0E8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  const bytes = zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, strToU8(value)])));
  if (!images.length) return bytes;
  const workbook = parsePriceListWorkbook({ bytes, fileName: "AMZ_US_Price_List.xlsx" });
  const sheet = workbook.view.sheets[0]!;
  // Generated rows already have exact main-owned identity; do not infer them
  // through the permissive imported-workbook header/code classifier.
  workbook.view.products = rows.map((row) => ({
    key: row.sellerSku!, keyKind: "seller-sku", asin: row.asin,
    sheetName: SHEET, rowNumber: row.rowNumber,
    cells: { image: sheet.cells.find((entry) => entry.reference === `B${row.rowNumber}`)! },
  }));
  return overlayPriceListWorkbook(workbook, [], { imageReplacements: images, appendComparisonColumns: false });
}
