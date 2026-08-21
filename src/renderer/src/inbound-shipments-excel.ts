import { strToU8, zipSync } from "fflate";
import { auditExportFilename } from "./audit-export-filename";
import {
  inboundShipmentDifferenceCopy,
  inboundShipmentStatusLabel,
  type InboundShipmentIssueLevel,
  type InboundShipmentReportIssue,
  type InboundShipmentSnapshot,
} from "./inbound-shipments";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_CELL_CHARACTERS = 32_767;

type CellValue = string | number | null;

type SheetDefinition = {
  name: string;
  headers: readonly string[];
  widths: readonly number[];
  rows: readonly (readonly CellValue[])[];
};

export const INBOUND_WORKBOOK_MAX_CELLS = 500_000;
export const INBOUND_WORKBOOK_MAX_ROWS_PER_SHEET = 100_000;
export const INBOUND_WORKBOOK_MAX_ESTIMATED_XML_BYTES = 32 * 1_024 * 1_024;
const ESTIMATED_XML_FIXED_BYTES = 64 * 1_024;
const ESTIMATED_XML_BYTES_PER_CELL = 96;
const ESTIMATED_XML_BYTES_PER_ROW = 64;

function escapedCellPayloadBytes(
  value: CellValue,
  cache: Map<string, number>,
): number {
  if (value === null) return 0;
  if (typeof value === "number") return String(value).length;
  const cacheable = value.length >= 256;
  const cached = cacheable ? cache.get(value) : undefined;
  if (cached !== undefined) return cached;
  const normalized = value.slice(0, MAX_CELL_CHARACTERS);
  let bytes = 0;
  for (let index = 0; index < normalized.length;) {
    const codePoint = normalized.codePointAt(index)!;
    index += codePoint > 0xffff ? 2 : 1;
    if (
      (codePoint >= 0 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      codePoint === 0x7f
    ) {
      bytes += 3;
    } else if (codePoint === 0x26) {
      bytes += 5;
    } else if (codePoint === 0x3c || codePoint === 0x3e) {
      bytes += 4;
    } else if (codePoint === 0x22 || codePoint === 0x27) {
      bytes += 6;
    } else if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  if (cacheable) cache.set(value, bytes);
  return bytes;
}

export function inboundShipmentWorkbookBudget(
  snapshot: InboundShipmentSnapshot,
): {
  totalCells: number;
  estimatedXmlBytes: number;
  sheets: readonly { name: string; dataRows: number; columns: number }[];
} {
  const shipmentById = new Map(
    snapshot.shipments.map((shipment) => [shipment.shipmentId, shipment]),
  );
  const itemShipmentIds = new Set(snapshot.items.map((item) => item.shipmentId));
  const textByteCache = new Map<string, number>();
  let payloadBytes = 0;
  let payloadLimitReached = false;
  const valueBytes = (value: CellValue) => payloadLimitReached
    ? 0
    : escapedCellPayloadBytes(value, textByteCache);
  const stopPayloadScanWhenOverBudget = () => {
    if (payloadBytes > INBOUND_WORKBOOK_MAX_ESTIMATED_XML_BYTES) {
      payloadLimitReached = true;
      textByteCache.clear();
    }
  };
  let differenceRows = 0;
  for (const shipment of snapshot.shipments) {
    const totals = shipment.totals ?? shipment.verifiedTotals;
    const difference = inboundShipmentDifferenceCopy({
      totals,
      status: shipment.status,
      complete: shipment.itemCoverage === "complete",
    });
    payloadBytes +=
      valueBytes(shipment.shipmentId) +
      valueBytes(shipment.shipmentName) +
      valueBytes(inboundShipmentStatusLabel(shipment.status)) +
      valueBytes(shipment.destinationFulfillmentCenterId) +
      valueBytes(shipment.itemCount) +
      valueBytes(totals.expectedUnits) +
      valueBytes(totals.receivedUnits) +
      valueBytes(totals.pendingUnits) +
      valueBytes(totals.overReceivedUnits) +
      valueBytes(shipment.itemCoverage === "complete" ? "完整" : "部分；數量只含已核對列") +
      valueBytes(difference.label);
    stopPayloadScanWhenOverBudget();
  }
  for (const item of snapshot.items) {
    const shipment = shipmentById.get(item.shipmentId);
    if (!shipment) throw new Error("商品列找不到所屬 FBA 貨件。" );
    const difference = inboundShipmentDifferenceCopy({
      totals: item,
      status: shipment.status,
      complete: shipment.itemCoverage === "complete",
    });
    const itemPayloadBytes =
      valueBytes(item.shipmentId) +
      valueBytes(shipment.shipmentName) +
      valueBytes(inboundShipmentStatusLabel(shipment.status)) +
      valueBytes(item.sellerSku) +
      valueBytes(item.fulfillmentNetworkSku) +
      valueBytes(item.asin) +
      valueBytes(item.title) +
      valueBytes(item.expectedUnits) +
      valueBytes(item.receivedUnits) +
      valueBytes(item.pendingUnits) +
      valueBytes(item.overReceivedUnits) +
      valueBytes(item.quantityInCase) +
      valueBytes(difference.label);
    payloadBytes += itemPayloadBytes;
    if (
      item.pendingUnits > 0 ||
      item.overReceivedUnits > 0 ||
      shipment.itemCoverage === "partial"
    ) {
      differenceRows += 1;
      payloadBytes += itemPayloadBytes;
    }
    stopPayloadScanWhenOverBudget();
  }
  const partialWithoutItems = snapshot.shipments.filter(
    (shipment) => shipment.itemCoverage === "partial" && !itemShipmentIds.has(shipment.shipmentId),
  );
  differenceRows += partialWithoutItems.length;
  for (const shipment of partialWithoutItems) {
    payloadBytes +=
      valueBytes(shipment.shipmentId) +
      valueBytes(shipment.shipmentName) +
      valueBytes(inboundShipmentStatusLabel(shipment.status)) +
      valueBytes("明細未完整；沒有可安全顯示的 SKU 列，差異未知。");
    stopPayloadScanWhenOverBudget();
  }
  for (const level of ["shipment", "carton", "product"] as const) {
    const issues = snapshot.issueReport[level];
    if (!issues.length) {
      payloadBytes +=
        valueBytes(snapshot.issueReport.state === "unavailable"
          ? "每日問題報表目前不可用"
          : "Amazon 每日問題報表未回傳此層級瑕疵") +
        valueBytes(snapshot.issueReport.state) +
        valueBytes(snapshot.issueReport.notice);
    }
    for (const issue of issues) {
      payloadBytes +=
        valueBytes(issue.shipmentId) +
        valueBytes(issue.cartonId) +
        valueBytes(issue.sellerSku) +
        valueBytes(issue.fnsku) +
        valueBytes(issue.asin) +
        valueBytes(issue.productName) +
        valueBytes(issue.problemType) +
        valueBytes(issue.problemQuantity) +
        valueBytes(issue.expectedUnits) +
        valueBytes(issue.receivedUnits) +
        valueBytes(issue.reportedAt) +
        valueBytes(issue.alertStatus) +
        valueBytes(issue.notice);
      stopPayloadScanWhenOverBudget();
    }
  }
  payloadBytes +=
    valueBytes(snapshot.dateRange.startDate) +
    valueBytes(snapshot.dateRange.endDate) +
    valueBytes(snapshot.fetchedAt) +
    valueBytes(snapshot.issueReport.fetchedAt) +
    valueBytes(snapshot.notice) +
    (2 * valueBytes(snapshot.issueReport.notice));
  const sheets = [
    { name: "貨件摘要", dataRows: snapshot.shipments.length, columns: 11 },
    { name: "商品接收明細", dataRows: snapshot.items.length, columns: 13 },
    { name: "僅顯示差異", dataRows: differenceRows, columns: 13 },
    { name: "貨件層級瑕疵", dataRows: Math.max(1, snapshot.issueReport.shipment.length), columns: 13 },
    { name: "包裝箱層級瑕疵", dataRows: Math.max(1, snapshot.issueReport.carton.length), columns: 13 },
    { name: "產品層級瑕疵", dataRows: Math.max(1, snapshot.issueReport.product.length), columns: 13 },
    { name: "資料來源與限制", dataRows: 13, columns: 2 },
  ] as const;
  const totalCells = sheets.reduce(
    (sum, sheet) => sum + ((sheet.dataRows + 1) * sheet.columns),
    0,
  );
  const totalRows = sheets.reduce(
    (sum, sheet) => sum + sheet.dataRows + 1,
    0,
  );
  const estimatedXmlBytes =
    ESTIMATED_XML_FIXED_BYTES +
    (totalCells * ESTIMATED_XML_BYTES_PER_CELL) +
    (totalRows * ESTIMATED_XML_BYTES_PER_ROW) +
    payloadBytes;
  return { totalCells, estimatedXmlBytes, sheets };
}

export function assertInboundShipmentWorkbookBudget(
  snapshot: InboundShipmentSnapshot,
): ReturnType<typeof inboundShipmentWorkbookBudget> {
  const budget = inboundShipmentWorkbookBudget(snapshot);
  const oversizedSheet = budget.sheets.find(
    (sheet) => sheet.dataRows > INBOUND_WORKBOOK_MAX_ROWS_PER_SHEET,
  );
  if (
    oversizedSheet ||
    budget.totalCells > INBOUND_WORKBOOK_MAX_CELLS ||
    budget.estimatedXmlBytes > INBOUND_WORKBOOK_MAX_ESTIMATED_XML_BYTES
  ) {
    throw new Error(
      `Excel 資料量超過安全產生範圍（最多 ${INBOUND_WORKBOOK_MAX_CELLS.toLocaleString("en-US")} 格、每張表 ${INBOUND_WORKBOOK_MAX_ROWS_PER_SHEET.toLocaleString("en-US")} 列、預估未壓縮 XML ${Math.round(INBOUND_WORKBOOK_MAX_ESTIMATED_XML_BYTES / 1_024 / 1_024)} MiB）；請縮小日期範圍後再下載。未產生截斷檔案。`,
    );
  }
  return budget;
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
  const normalized = safeCellText(value);
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(normalized)}</t></is></c>`;
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
  const columns = sheet.widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  const header = sheet.headers
    .map((value, index) => inlineStringCell(`${columnName(index)}1`, value, 1))
    .join("");
  const rows = sheet.rows
    .map((values, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const cells = values
        .map((value, columnIndex) =>
          cell(`${columnName(columnIndex)}${rowNumber}`, value, 2),
        )
        .join("");
      return `<row r="${rowNumber}" ht="30" customHeight="1">${cells}</row>`;
    })
    .join("");
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData><row r="1" ht="28" customHeight="1">${header}</row>${rows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function workbookXml(names: readonly string[]): string {
  const sheets = names
    .map(
      (name, index) =>
        `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  return `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets}</sheets><calcPr calcId="0" calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"/></workbook>`;
}

function workbookRelationships(count: number): string {
  const worksheets = Array.from(
    { length: count },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheets}<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function contentTypes(count: number): string {
  const worksheets = Array.from(
    { length: count },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${worksheets}</Types>`;
}

function rootRelationships(): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function stylesXml(): string {
  return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos Display"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2E5F8A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE2E7EC"/></left><right style="thin"><color rgb="FFE2E7EC"/></right><top style="thin"><color rgb="FFE2E7EC"/></top><bottom style="thin"><color rgb="FFE2E7EC"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function issueRows(
  issues: readonly InboundShipmentReportIssue[],
): readonly (readonly CellValue[])[] {
  return issues.map((issue) => [
    issue.shipmentId,
    issue.cartonId,
    issue.sellerSku,
    issue.fnsku,
    issue.asin,
    issue.productName,
    issue.problemType,
    issue.problemQuantity,
    issue.expectedUnits,
    issue.receivedUnits,
    issue.reportedAt,
    issue.alertStatus,
    issue.notice,
  ]);
}

function issueSheet(
  name: string,
  level: InboundShipmentIssueLevel,
  snapshot: InboundShipmentSnapshot,
): SheetDefinition {
  const issues = snapshot.issueReport[level];
  const rows = issueRows(issues);
  return {
    name,
    headers: [
      "貨件 ID",
      "包裝箱 ID",
      "Seller SKU",
      "FNSKU",
      "ASIN",
      "商品名稱",
      "Amazon 問題類型",
      "問題數量",
      "預期數量",
      "Amazon 已接收",
      "回報日期",
      "警示狀態",
      "說明",
    ],
    widths: [20, 22, 24, 18, 16, 48, 30, 13, 13, 16, 18, 18, 56],
    rows: rows.length
      ? rows
      : [[
          "",
          "",
          "",
          "",
          "",
          "",
          snapshot.issueReport.state === "unavailable"
            ? "每日問題報表目前不可用"
            : "Amazon 每日問題報表未回傳此層級瑕疵",
          null,
          null,
          null,
          "",
          snapshot.issueReport.state,
          snapshot.issueReport.notice,
        ]],
  };
}

export function createInboundShipmentWorkbook(
  snapshot: InboundShipmentSnapshot,
  marketplaceShort: string,
): Uint8Array {
  assertInboundShipmentWorkbookBudget(snapshot);
  const shipmentById = new Map(
    snapshot.shipments.map((shipment) => [shipment.shipmentId, shipment]),
  );
  const shipmentRows = snapshot.shipments.map((shipment) => {
    const values = shipment.totals ?? shipment.verifiedTotals;
    const difference = inboundShipmentDifferenceCopy({
      totals: values,
      status: shipment.status,
      complete: shipment.itemCoverage === "complete",
    });
    return [
      shipment.shipmentId,
      shipment.shipmentName,
      inboundShipmentStatusLabel(shipment.status),
      shipment.destinationFulfillmentCenterId,
      shipment.itemCount,
      values.expectedUnits,
      values.receivedUnits,
      values.pendingUnits,
      values.overReceivedUnits,
      shipment.itemCoverage === "complete" ? "完整" : "部分；數量只含已核對列",
      difference.label,
    ] satisfies readonly CellValue[];
  });
  const itemRows = snapshot.items.map((item) => {
    const shipment = shipmentById.get(item.shipmentId);
    if (!shipment) throw new Error("商品列找不到所屬 FBA 貨件。" );
    const difference = inboundShipmentDifferenceCopy({
      totals: item,
      status: shipment.status,
      complete: shipment.itemCoverage === "complete",
    });
    return [
      item.shipmentId,
      shipment.shipmentName,
      inboundShipmentStatusLabel(shipment.status),
      item.sellerSku,
      item.fulfillmentNetworkSku,
      item.asin,
      item.title,
      item.expectedUnits,
      item.receivedUnits,
      item.pendingUnits,
      item.overReceivedUnits,
      item.quantityInCase,
      difference.label,
    ] satisfies readonly CellValue[];
  });
  const itemShipmentIds = new Set(snapshot.items.map((item) => item.shipmentId));
  const differenceRows: readonly (readonly CellValue[])[] = [
    ...itemRows.filter((row) => {
      const shipment = shipmentById.get(String(row[0]));
      return Number(row[9]) > 0 || Number(row[10]) > 0 || shipment?.itemCoverage === "partial";
    }),
    ...snapshot.shipments
      .filter((shipment) => shipment.itemCoverage === "partial" && !itemShipmentIds.has(shipment.shipmentId))
      .map((shipment) => [
        shipment.shipmentId,
        shipment.shipmentName,
        inboundShipmentStatusLabel(shipment.status),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "明細未完整；沒有可安全顯示的 SKU 列，差異未知。",
      ] satisfies readonly CellValue[]),
  ];
  const itemHeaders = [
    "貨件 ID",
    "貨件名稱",
    "貨件狀態",
    "Seller SKU",
    "FNSKU",
    "ASIN",
    "商品名稱",
    "預期／送出單位",
    "Amazon 已接收（SP-API QuantityReceived）",
    "尚未接收（接收中為暫時差異）",
    "多接收",
    "每箱數量",
    "判讀",
  ] as const;
  const itemWidths = [20, 34, 18, 24, 18, 16, 50, 17, 26, 26, 14, 14, 58] as const;

  const sheets: SheetDefinition[] = [
    {
      name: "貨件摘要",
      headers: [
        "貨件 ID",
        "貨件名稱",
        "狀態",
        "目的地 FC",
        "已讀取 SKU 列數",
        "預期／送出單位",
        "Amazon 已接收（SP-API QuantityReceived）",
        "尚未接收（接收中為暫時差異）",
        "多接收",
        "資料覆蓋",
        "判讀",
      ],
      widths: [20, 38, 18, 16, 13, 17, 26, 26, 14, 28, 62],
      rows: shipmentRows,
    },
    {
      name: "商品接收明細",
      headers: itemHeaders,
      widths: itemWidths,
      rows: itemRows,
    },
    {
      name: "僅顯示差異",
      headers: itemHeaders,
      widths: itemWidths,
      rows: differenceRows,
    },
    issueSheet("貨件層級瑕疵", "shipment", snapshot),
    issueSheet("包裝箱層級瑕疵", "carton", snapshot),
    issueSheet("產品層級瑕疵", "product", snapshot),
    {
      name: "資料來源與限制",
      headers: ["項目", "說明"],
      widths: [28, 110],
      rows: [
        ["站點", marketplaceShort],
        ["查詢日期範圍", `${snapshot.dateRange.startDate} – ${snapshot.dateRange.endDate}`],
        ["貨件數量快照時間", snapshot.fetchedAt],
        ["每日瑕疵報表讀取時間", snapshot.issueReport.fetchedAt ?? "未取得"],
        ["每日瑕疵資料截止日", "Amazon 未提供可證明的 dataThrough；不可由讀取時間推定。"],
        ["貨件明細覆蓋", snapshot.coverage.state === "complete" ? "完整" : `部分；${snapshot.coverage.incompleteShipmentCount} 個貨件未完整讀取`],
        ["預期／送出單位", "Amazon Fulfillment Inbound v0 QuantityShipped。"],
        ["Amazon 已接收", "Amazon Fulfillment Inbound v0 QuantityReceived；不冒充 Seller Central 即時『已找到商品』或內部調查結論。"],
        ["接收差異", "CHECKED_IN／RECEIVING 等尚未關閉狀態只稱暫時差異，不稱短少或遺失；CLOSED 後仍有差異才建議到 Seller Central 核對。"],
        ["三層瑕疵", "來自 Amazon 每日 FBA Inbound Performance Report；只有有問題的列，且不是 Seller Central 秒級即時狀態。"],
        ["瑕疵報表狀態", `${snapshot.issueReport.state} · ${snapshot.issueReport.notice}`],
        ["範圍外問題貨件", snapshot.issueReport.excludedShipmentCount === null
          ? "每日問題報表目前不可用，沒有可證明的排除數。"
          : `已排除 ${snapshot.issueReport.excludedShipmentCount} 個不在本次貨件快照內的問題貨件；未輸出其識別碼。`],
        ["快照說明", snapshot.notice],
      ],
    },
  ];

  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(sheets.length)),
    "_rels/.rels": strToU8(rootRelationships()),
    "docProps/app.xml": strToU8(
      `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AMZ.API</Application><Company>JSPUSA</Company><AppVersion>1.0</AppVersion></Properties>`,
    ),
    "docProps/core.xml": strToU8(
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>AMZ.API FBA 入庫貨件</dc:title><dc:creator>AMZ.API</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(snapshot.fetchedAt)}</dcterms:created></cp:coreProperties>`,
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

export function downloadInboundShipmentWorkbook(
  snapshot: InboundShipmentSnapshot,
  marketplaceShort: string,
): void {
  const bytes = createInboundShipmentWorkbook(snapshot, marketplaceShort);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(
    new Blob([copy.buffer], { type: XLSX_CONTENT_TYPE }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = auditExportFilename({
    kind: "inbound",
    marketplaceShort,
    fetchedAt: snapshot.fetchedAt,
  });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
