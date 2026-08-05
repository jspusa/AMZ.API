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
}

type Cell =
  | { kind: "text"; value: unknown; style: number }
  | { kind: "date"; value: string | Date | null | undefined; style: number };

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
}: CreateListingsWorkbookInput): Uint8Array {
  const generatedAt = requireValidDate(fetchedAt, "fetchedAt");
  const includeErrorSheet = errors.length > 0;

  const mainRows = rows.map((row): readonly Cell[] => {
    const bulletPoints = row.bulletPoints ?? [];

    return [
      textCell(row.marketplaceLabel ?? marketplaceLabel),
      textCell(row.sku, 2),
      textCell(row.asin ?? "", 2),
      textCell(row.productType ?? ""),
      textCell(row.title ?? ""),
      textCell(bulletPoints[0] ?? ""),
      textCell(bulletPoints[1] ?? ""),
      textCell(bulletPoints[2] ?? ""),
      textCell(bulletPoints[3] ?? ""),
      textCell(bulletPoints[4] ?? ""),
      textCell(row.ingredients ?? ""),
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
      name: MAIN_SHEET_NAME,
      xml: buildWorksheet({
        headers: MAIN_HEADERS,
        rows: mainRows,
        widths: [16, 24, 16, 24, 52, 44, 44, 44, 44, 44, 42, 16, 21],
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

function textCell(value: unknown, style = 3): Cell {
  return { kind: "text", value, style };
}

function dateCell(value: string | Date | null | undefined): Cell {
  return { kind: "date", value, style: 4 };
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
  if (cell.kind === "date" && cell.value !== null && cell.value !== undefined) {
    const parsed = parseDate(cell.value);
    if (parsed) {
      return `<c r="${reference}" s="${cell.style}"><v>${excelSerial(parsed)}</v></c>`;
    }
  }

  const value = cell.kind === "text" ? cell.value : cell.value ?? "";
  const style = cell.kind === "date" ? 3 : cell.style;
  return inlineStringCell(reference, value, style);
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

function buildCoreProperties(marketplaceLabel: string, generatedAt: Date): string {
  const timestamp = generatedAt.toISOString();
  const title = escapeXml(
    sanitizeXmlText(`Amazon 商品內容匯出 - ${marketplaceLabel}`),
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
