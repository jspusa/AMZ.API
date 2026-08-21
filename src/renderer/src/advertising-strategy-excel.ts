import { strToU8, zipSync } from "fflate";
import type {
  AdvertisingStrategySnapshot,
  AdvertisingStrategyTier,
} from "./advertising-strategy";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_CELL_CHARACTERS = 32_767;
const MAX_WORKBOOK_CELLS = 500_000;
const MAX_ROWS_PER_SHEET = 100_000;
const MAX_WORKBOOK_XML_BYTES = 32 * 1024 * 1024;
const ESTIMATED_CELL_XML_OVERHEAD_BYTES = 96;

type CellValue = string | number | null;
type StyledCell = { value: CellValue; style: number };
type SheetDefinition = {
  name: string;
  headers: readonly string[];
  widths: readonly number[];
  rows: readonly (readonly StyledCell[])[];
};

const STYLE = {
  header: 1,
  text: 2,
  integer: 3,
  money: 4,
  percent: 5,
  T1: 6,
  T2: 7,
  T3: 8,
  T4: 9,
  warning: 10,
  muted: 11,
  unresolved: 12,
} as const;

function styled(value: CellValue, style: number = STYLE.text): StyledCell {
  return { value, style };
}

function tierCell(tier: AdvertisingStrategyTier | null): StyledCell {
  return tier === null
    ? styled(null, STYLE.muted)
    : styled(tier, STYLE[tier]);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeCellText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "�")
    .slice(0, MAX_CELL_CHARACTERS);
}

function columnName(index: number): string {
  let remaining = index + 1;
  let result = "";
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(65 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function inlineStringCell(reference: string, value: string, style: number): string {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(safeCellText(value))}</t></is></c>`;
}

function cell(reference: string, value: CellValue, style: number): string {
  if (typeof value === "number") {
    return `<c r="${reference}" s="${style}" t="n"><v>${value}</v></c>`;
  }
  return inlineStringCell(reference, value ?? "", style);
}

function worksheetXml(sheet: SheetDefinition): string {
  if (sheet.headers.length !== sheet.widths.length) {
    throw new Error(`工作表 ${sheet.name} 的欄位寬度設定不一致。`);
  }
  if (sheet.rows.some((row) => row.length !== sheet.headers.length)) {
    throw new Error(`工作表 ${sheet.name} 的資料欄數不一致。`);
  }
  const lastColumn = columnName(sheet.headers.length - 1);
  const lastRow = sheet.rows.length + 1;
  const columns = sheet.widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  ).join("");
  const header = sheet.headers.map((value, index) =>
    inlineStringCell(`${columnName(index)}1`, value, STYLE.header),
  ).join("");
  const rows = sheet.rows.map((values, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const cells = values.map((entry, columnIndex) =>
      cell(`${columnName(columnIndex)}${rowNumber}`, entry.value, entry.style),
    ).join("");
    return `<row r="${rowNumber}" ht="26" customHeight="1">${cells}</row>`;
  }).join("");
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData><row r="1" ht="30" customHeight="1">${header}</row>${rows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function workbookXml(names: readonly string[]): string {
  const sheets = names.map((name, index) =>
    `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join("");
  return `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets}</sheets><calcPr calcId="0" calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"/></workbook>`;
}

function workbookRelationships(count: number): string {
  const worksheets = Array.from({ length: count }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheets}<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function contentTypes(count: number): string {
  const worksheets = Array.from({ length: count }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${worksheets}</Types>`;
}

function rootRelationships(): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function stylesXml(): string {
  return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos Display"/><family val="2"/></font><font><b/><color rgb="FF1F2937"/><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/><family val="2"/></font></fonts><fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2E5F8A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4EA72E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE97132"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDECEC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD7DDE3"/></left><right style="thin"><color rgb="FFD7DDE3"/></right><top style="thin"><color rgb="FFD7DDE3"/></top><bottom style="thin"><color rgb="FFD7DDE3"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function actualAcosCell(
  row: AdvertisingStrategySnapshot["rows"][number],
): StyledCell {
  if (row.spActualAcosStatus === "reported") {
    return styled(row.spActualAcos, STYLE.percent);
  }
  if (row.spActualAcosStatus === "no-sales") {
    return styled("無歸因銷售", STYLE.warning);
  }
  if (row.spActualAcosStatus === "not-reported") {
    return styled("未回傳", STYLE.muted);
  }
  return styled(null, STYLE.muted);
}

function mainSheet(snapshot: AdvertisingStrategySnapshot): SheetDefinition {
  const moneyHeader = (label: string) => `${label} (${snapshot.currencyCode})`;
  return {
    name: "廣告策略",
    headers: [
      "SKU",
      "ASIN",
      moneyHeader("SP預算"),
      "ACoS",
      "已售出單位數量",
      moneyHeader("價格"),
      "分級",
      "SP花費排名",
      moneyHeader("SP實際花費"),
      moneyHeader("SP實際14日歸因銷售"),
      "SP實際14日購買次數",
      "SP實際ACoS",
      moneyHeader("銷售額"),
      "規格",
      "SB銷售",
      "ACoS",
      "分級",
      "SB進攻",
      "ACoS",
      "分級",
      "SD進攻",
      "ACoS",
      "分級",
      "SD防守",
      "ACoS",
      "分級",
      "SD再行銷",
      "ACoS",
      "其他廣告",
    ],
    widths: [24, 16, 16, 12, 17, 14, 10, 14, 18, 24, 22, 18, 18, 18, 18, 12, 10, 18, 12, 10, 18, 12, 10, 18, 12, 10, 18, 12, 20],
    rows: snapshot.rows.map((row) => [
      styled(row.sellerSku),
      styled(row.asin),
      styled(row.suggestedSpDailyBudget, STYLE.money),
      styled(row.suggestedSpTargetAcos, STYLE.percent),
      styled(row.unitsSold, STYLE.integer),
      styled(row.price, STYLE.money),
      tierCell(row.salesTier),
      styled(row.spSpendRank, STYLE.integer),
      styled(row.spSpend, STYLE.money),
      styled(row.spSales14d, STYLE.money),
      styled(row.spPurchases14d, STYLE.integer),
      actualAcosCell(row),
      styled(row.salesAmount, STYLE.money),
      styled(row.specification),
      styled(row.sbSales, STYLE.money),
      styled(row.sbSalesAcos, STYLE.percent),
      styled(null, STYLE.muted),
      styled(row.sbAttack, STYLE.money),
      styled(row.sbAttackAcos, STYLE.percent),
      styled(null, STYLE.muted),
      styled(row.sdAttack, STYLE.money),
      styled(row.sdAttackAcos, STYLE.percent),
      styled(null, STYLE.muted),
      styled(row.sdDefense, STYLE.money),
      styled(row.sdDefenseAcos, STYLE.percent),
      styled(null, STYLE.muted),
      styled(row.sdRemarketing, STYLE.money),
      styled(row.sdRemarketingAcos, STYLE.percent),
      styled(row.otherAdvertising),
    ]),
  };
}

function sourceSheet(snapshot: AdvertisingStrategySnapshot): SheetDefinition {
  const coverage = snapshot.coverage;
  const summary = snapshot.summary;
  const salesVisibleIssueCount =
    coverage.salesUnresolvedSourceRowCount -
    coverage.salesAnonymousUnprovenSourceRowCount;
  const spVisibleIssueCount =
    coverage.spUnresolvedSourceRowCount -
    coverage.spAnonymousUnprovenSourceRowCount;
  return {
    name: "資料來源與規則",
    headers: ["項目", "內容"],
    widths: [34, 110],
    rows: [
      [styled("站點", STYLE.muted), styled(`${snapshot.marketplaceCode} · ${snapshot.marketplaceId}`)],
      [styled("日期範圍", STYLE.muted), styled(`${snapshot.dateRange.startDate} – ${snapshot.dateRange.endDate}`)],
      [styled("幣別", STYLE.muted), styled(snapshot.currencyCode)],
      [styled("策略快照產生時間", STYLE.muted), styled(snapshot.fetchedAt)],
      [styled("目前 FBA 清單讀取時間", STYLE.muted), styled(snapshot.sourceFetchedAt.fba)],
      [styled("SKU 銷售報表讀取時間", STYLE.muted), styled(snapshot.sourceFetchedAt.sales)],
      [styled("SP advertised-product 下載完成時間", STYLE.muted), styled(snapshot.sourceFetchedAt.ads)],
      [styled("目前 FBA SKU", STYLE.muted), styled(coverage.currentFbaSkuCount, STYLE.integer)],
      [styled("銷售來源覆蓋", STYLE.muted), styled(`${coverage.salesResolvedSourceRowCount} 已歸屬／${salesVisibleIssueCount} 筆 exact FBA 問題／${coverage.salesAnonymousUnprovenSourceRowCount} 筆未證明 FBA（僅匿名計數）／${coverage.salesSourceRowCount} 來源列`)],
      [styled("銷售 SKU 覆蓋", STYLE.muted), styled(`${coverage.salesReportedSkuCount} 已回傳／${coverage.salesNotReportedSkuCount} 未回傳`)],
      [styled("SP 來源覆蓋", STYLE.muted), styled(`${coverage.spResolvedSourceRowCount} 已歸屬／${spVisibleIssueCount} 筆 exact FBA 問題／${coverage.spAnonymousUnprovenSourceRowCount} 筆未證明 FBA（僅匿名計數）／${coverage.spSourceRowCount} 來源列`)],
      [styled("SP 歸屬方式", STYLE.muted), styled(`${coverage.spDirectSourceRowCount} Seller SKU／${coverage.spUniqueAsinSourceRowCount} 唯一 ASIN`)],
      [styled("SP SKU 覆蓋", STYLE.muted), styled(`${coverage.spReportedSkuCount} 已回傳／${coverage.spNotReportedSkuCount} 未回傳`)],
      [styled("已證明 FBA 銷售額核對", STYLE.muted), styled(`${summary.reportedSalesAmount} 已歸屬 + ${summary.unresolvedSalesAmount} 可核對問題 = ${summary.sourceSalesAmount} ${snapshot.currencyCode}；未證明 FBA 列的數值不納入`)],
      [styled("已證明 FBA SP 花費核對", STYLE.muted), styled(`${summary.reportedSpSpend} 已歸屬 + ${summary.unresolvedSpSpend} 可核對問題 = ${summary.sourceSpSpend} ${snapshot.currencyCode}；未證明 FBA 列的數值不納入`)],
      [styled("銷售分級規則", STYLE.muted), styled("只對已回傳 SKU 銷售列，依銷售額降冪、Seller SKU 升冪；ceil(n×20%／50%／80%) 分為 T1／T2／T3，其餘 T4。")],
      [styled("SP 歸屬規則", STYLE.muted), styled("先用 exact Seller SKU；Ads SKU 空缺時，只有 ASIN 在目前 FBA 清單唯一對應一個 SKU 才歸屬。歧義列不分攤。")],
      [styled("FBA-only 隔離規則", STYLE.muted), styled("未知、缺少或未證明為目前 FBA 的 Sales／Ads 來源列只保留匿名筆數；Seller SKU、ASIN、單位數、銷售額、花費與歸因數值不進畫面或 Excel。只有 exact current-FBA SKU 已證明的 ASIN 衝突或重複列保留逐列診斷。")],
      [styled("缺報表列", STYLE.muted), styled("維持空白／未回傳，不補 0。報表明確回傳 0 才顯示 0。")],
      [styled("SP 實際 ACoS", STYLE.muted), styled("SP 實際花費 ÷ SP 14 日歸因銷售；歸因銷售為 0 時顯示『無歸因銷售』，不除以 0；欄位未回傳時顯示『未回傳』。")],
      [styled("價格欄", STYLE.muted), styled("目前來源沒有可逐 SKU 安全核對的即時售價，因此保持空白；不以銷售額 ÷ 單位數推算價格。")],
      [styled("T1 建議", STYLE.T1), styled("每日 SP 預算 300；目標 ACoS 35%；可人工覆寫。")],
      [styled("T2 建議", STYLE.T2), styled("每日 SP 預算 100；目標 ACoS 30%；可人工覆寫。")],
      [styled("T3 建議", STYLE.T3), styled("每日 SP 預算 50；目標 ACoS 30%；可人工覆寫。")],
      [styled("T4 建議", STYLE.T4), styled("每日 SP 預算 50；目標 ACoS 50%；可人工覆寫。")],
      [styled("人工欄位", STYLE.muted), styled("規格、SB 銷售／進攻、SD 進攻／防守／再行銷與其他廣告均保持空白，不從缺少的來源推測。")],
      [styled("快照說明", STYLE.muted), styled(snapshot.notice)],
    ],
  };
}

function unresolvedSheet(snapshot: AdvertisingStrategySnapshot): SheetDefinition {
  const anonymousSales = snapshot.coverage.salesAnonymousUnprovenSourceRowCount;
  const anonymousSp = snapshot.coverage.spAnonymousUnprovenSourceRowCount;
  const rows = snapshot.unresolved.length
    ? snapshot.unresolved.map((row) => [
        styled(row.source === "sales" ? "SKU 銷售報表" : "SP advertised-product", STYLE.unresolved),
        styled(row.sourceRow, STYLE.integer),
        styled(row.sellerSku),
        styled(row.asin),
        styled(row.code),
        styled(row.message, STYLE.unresolved),
        styled(row.unitsSold, STYLE.integer),
        styled(row.amount, STYLE.money),
        styled(row.spSales14d, STYLE.money),
        styled(row.spPurchases14d, STYLE.integer),
      ])
    : [[
        styled("沒有可逐列顯示的 exact FBA 問題", STYLE.muted),
        styled(null), styled(null), styled(null), styled(null),
        styled(
          anonymousSales + anonymousSp > 0
            ? `另有 Sales ${anonymousSales} 筆／Ads ${anonymousSp} 筆未證明 FBA 來源列，只在資料來源頁保留匿名計數。`
            : "所有來源列均已依規則歸屬。",
          STYLE.muted,
        ),
        styled(null), styled(null), styled(null), styled(null),
      ]];
  return {
    name: "未完成明細",
    headers: [
      "來源",
      "來源列",
      "Seller SKU",
      "ASIN",
      "原因代碼",
      "說明",
      "銷售單位",
      "銷售額／SP花費",
      "SP 14日歸因銷售",
      "SP 14日購買次數",
    ],
    widths: [24, 12, 24, 16, 28, 66, 14, 20, 22, 20],
    rows,
  };
}

function assertWorkbookBudget(sheets: readonly SheetDefinition[]): void {
  const totalCells = sheets.reduce(
    (total, sheet) => total + ((sheet.rows.length + 1) * sheet.headers.length),
    0,
  );
  const estimatedXmlBytes = sheets.reduce((workbookTotal, sheet) => {
    const headerBytes = sheet.headers.reduce(
      (total, value) => total + strToU8(escapeXml(safeCellText(value))).byteLength + ESTIMATED_CELL_XML_OVERHEAD_BYTES,
      0,
    );
    const rowBytes = sheet.rows.reduce(
      (sheetTotal, row) => sheetTotal + row.reduce((rowTotal, entry) => {
        const valueBytes = typeof entry.value === "string"
          ? strToU8(escapeXml(safeCellText(entry.value))).byteLength
          : 32;
        return rowTotal + valueBytes + ESTIMATED_CELL_XML_OVERHEAD_BYTES;
      }, 0),
      0,
    );
    return workbookTotal + headerBytes + rowBytes;
  }, 0);
  if (
    totalCells > MAX_WORKBOOK_CELLS ||
    estimatedXmlBytes > MAX_WORKBOOK_XML_BYTES ||
    sheets.some((sheet) => sheet.rows.length > MAX_ROWS_PER_SHEET)
  ) {
    throw new Error("廣告策略 Excel 資料量超過安全產生範圍；請縮小日期或商品範圍後重試，未產生截斷檔案。");
  }
}

export function advertisingStrategyWorkbookFilename(
  snapshot: Pick<AdvertisingStrategySnapshot, "marketplaceCode" | "dateRange">,
): string {
  return `FBA-廣告策略-${snapshot.marketplaceCode}-${snapshot.dateRange.endDate}.xlsx`;
}

export function createAdvertisingStrategyWorkbook(
  snapshot: AdvertisingStrategySnapshot,
): Uint8Array {
  const sheets = [mainSheet(snapshot), sourceSheet(snapshot), unresolvedSheet(snapshot)];
  assertWorkbookBudget(sheets);
  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(sheets.length)),
    "_rels/.rels": strToU8(rootRelationships()),
    "docProps/app.xml": strToU8(
      `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AMZ.API</Application><Company>JSPUSA</Company><AppVersion>1.0</AppVersion></Properties>`,
    ),
    "docProps/core.xml": strToU8(
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>AMZ.API FBA 廣告策略</dc:title><dc:creator>AMZ.API</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(snapshot.fetchedAt)}</dcterms:created></cp:coreProperties>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships(sheets.length)),
    "xl/styles.xml": strToU8(stylesXml()),
    "xl/workbook.xml": strToU8(workbookXml(sheets.map((sheet) => sheet.name))),
  };
  sheets.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  });
  return zipSync(archive, { level: 6 });
}

export function downloadAdvertisingStrategyWorkbook(
  snapshot: AdvertisingStrategySnapshot,
): void {
  const bytes = createAdvertisingStrategyWorkbook(snapshot);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: XLSX_CONTENT_TYPE }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = advertisingStrategyWorkbookFilename(snapshot);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
