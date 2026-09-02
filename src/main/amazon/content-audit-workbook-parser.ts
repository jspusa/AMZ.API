import { DOMParser } from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import {
  CONTENT_AUDIT_V2_DATA_HEADERS,
  CONTENT_AUDIT_V2_INDEX_HEADER_ROW,
  CONTENT_AUDIT_V2_INDEX_HEADERS,
  CONTENT_AUDIT_V2_INDEX_SHEET_NAME,
  CONTENT_AUDIT_V2_SCHEMA_VERSION,
  CONTENT_AUDIT_PARTIAL_SHEET_MARKER,
} from "./xlsx";

const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1_024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const MAX_WORKSHEETS = 501;
const MAX_TOTAL_ROWS = 25_500;
const MAX_TOTAL_CELLS = 750_000;
const MAX_CELL_CHARACTERS = 32_767;
const MAX_DEFINED_NAME_DIAGNOSTICS = 8;
const MAX_DEFINED_NAME_FIELD_CHARACTERS = 160;

export type ContentAuditWorkbookErrorStatus = 400 | 413 | 415 | 422;

export type ContentAuditWorkbookErrorCode =
  | "CONTENT_AUDIT_WORKBOOK_MEDIA_TYPE_INVALID"
  | "CONTENT_AUDIT_WORKBOOK_TOO_LARGE"
  | "CONTENT_AUDIT_WORKBOOK_ARCHIVE_INVALID"
  | "CONTENT_AUDIT_WORKBOOK_UNSAFE"
  | "CONTENT_AUDIT_WORKBOOK_SCHEMA_INVALID";

export class ContentAuditWorkbookError extends Error {
  readonly code: ContentAuditWorkbookErrorCode;
  readonly status: ContentAuditWorkbookErrorStatus;

  constructor(
    code: ContentAuditWorkbookErrorCode,
    status: ContentAuditWorkbookErrorStatus,
    message: string,
  ) {
    super(message);
    this.name = "ContentAuditWorkbookError";
    this.code = code;
    this.status = status;
  }
}

export type ParsedContentAuditValues = {
  title: string;
  itemHighlight: string;
  bulletPoints: string[];
  productDescription: string;
  ingredients: string;
};

export type ParsedContentAuditWorkbookRow = {
  sellerSku: string;
  asin: string;
  productType: string;
  variationFamilyKey: string;
  sourceSheet: string;
  original: ParsedContentAuditValues;
  proposed: ParsedContentAuditValues;
  /** Proposed-value aliases retained for the listing-content batch seam. */
  title: string;
  itemHighlight: string;
  bulletPoints: string[];
  productDescription: string;
  ingredients: string;
  auditType: string;
  auditDescription: string;
};

export type ParsedContentAuditWorkbook = {
  metadata: {
    schemaVersion: 2;
    marketplaceId: string;
    exportId: string;
    fetchedAt: string;
  };
  rows: ParsedContentAuditWorkbookRow[];
};

type WorksheetCells = Map<number, Map<number, string>>;

type WorkbookSheet = {
  name: string;
  path: string;
};

type IndexEntry = {
  sheetName: string;
  variationFamilyKey: string;
  expectedRows: number;
};

type EmbeddedSheetMetadata = ParsedContentAuditWorkbook["metadata"] & IndexEntry;

type ParserBudget = {
  rows: number;
  cells: number;
};

export function parseContentAuditWorkbook(input: {
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
}): ParsedContentAuditWorkbook {
  try {
    validateUploadEnvelope(input);
    const archive = extractArchive(input.bytes);
    validatePackageSafety(archive);
    const sharedStrings = parseSharedStrings(archive);
    const workbookSheets = parseWorkbookSheets(archive);
    const indexSheet = workbookSheets.find(
      (sheet) => sheet.name === CONTENT_AUDIT_V2_INDEX_SHEET_NAME,
    );
    const budget: ParserBudget = { rows: 0, cells: 0 };
    if (!indexSheet) {
      return parsePartialWorkbook(
        archive,
        workbookSheets,
        sharedStrings,
        budget,
      );
    }
    const indexCells = parseWorksheet(
      requirePart(archive, indexSheet.path),
      indexSheet.path,
      sharedStrings,
      budget,
    );
    const { metadata, entries } = parseIndexSheet(indexCells);
    const dataSheets = workbookSheets.filter(
      (sheet) => sheet.name !== CONTENT_AUDIT_V2_INDEX_SHEET_NAME,
    );
    if (!dataSheets.length) schemaError("工作簿沒有可處理的文案資料工作表。");
    const sheetByName = new Map(dataSheets.map((sheet) => [sheet.name, sheet]));
    if (sheetByName.size !== dataSheets.length) {
      schemaError("工作簿含有重複的工作表名稱。");
    }
    const entryByName = new Map(entries.map((entry) => [entry.sheetName, entry]));
    if (dataSheets.some((sheet) => !entryByName.has(sheet.name))) {
      schemaError("工作簿含有未登錄於索引的資料工作表。");
    }
    const selectedEntries = entries.filter((entry) =>
      sheetByName.has(entry.sheetName)
    );
    if (selectedEntries.length !== dataSheets.length) {
      schemaError("索引與實際資料工作表無法精確對應。");
    }
    const indexedSubset = selectedEntries.length !== entries.length;

    const seenSkus = new Set<string>();
    const parsedRows: ParsedContentAuditWorkbookRow[] = [];
    for (const entry of selectedEntries) {
      const sheet = sheetByName.get(entry.sheetName);
      if (!sheet) {
        schemaError(`索引指向不存在的工作表「${entry.sheetName}」。`);
      }
      const cells = parseWorksheet(
        requirePart(archive, sheet.path),
        sheet.path,
        sharedStrings,
        budget,
      );
      const embedded = indexedSubset
        ? parseEmbeddedSheetMetadata(cells, entry.sheetName, true)
        : parseEmbeddedSheetMetadata(cells, entry.sheetName, false);
      if (embedded) {
        assertEmbeddedSheetMetadataMatches(embedded, metadata, entry);
      }
      const rows = parseDataSheet(cells, entry, seenSkus);
      if (rows.length !== entry.expectedRows) {
        schemaError(`工作表「${entry.sheetName}」的問題列數與索引不一致。`);
      }
      parsedRows.push(...rows);
      sheetByName.delete(entry.sheetName);
    }
    if (sheetByName.size) {
      schemaError("工作簿含有未登錄於索引的資料工作表。");
    }
    return { metadata, rows: parsedRows };
  } catch (error) {
    if (error instanceof ContentAuditWorkbookError) throw error;
    throw new ContentAuditWorkbookError(
      "CONTENT_AUDIT_WORKBOOK_ARCHIVE_INVALID",
      400,
      error instanceof Error
        ? `Excel 檔案無法安全解析：${error.message}`
        : "Excel 檔案無法安全解析。",
    );
  }
}

function validateUploadEnvelope(input: {
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
}): void {
  const mediaType = input.mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    typeof input.fileName !== "string" ||
    input.fileName.length < 6 ||
    input.fileName.length > 255 ||
    !/\.xlsx$/iu.test(input.fileName) ||
    !["", "application/octet-stream", XLSX_MEDIA_TYPE].includes(mediaType)
  ) {
    throw new ContentAuditWorkbookError(
      "CONTENT_AUDIT_WORKBOOK_MEDIA_TYPE_INVALID",
      415,
      "只接受 AMZ.API 匯出的 .xlsx 檔案。",
    );
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 4) {
    throw new ContentAuditWorkbookError(
      "CONTENT_AUDIT_WORKBOOK_ARCHIVE_INVALID",
      400,
      "Excel 檔案內容無效。",
    );
  }
  if (input.bytes.byteLength > MAX_ARCHIVE_BYTES) {
    tooLarge("Excel 壓縮檔不可超過 10 MB。");
  }
  if (
    input.bytes[0] !== 0x50 ||
    input.bytes[1] !== 0x4b ||
    input.bytes[2] !== 0x03 ||
    input.bytes[3] !== 0x04
  ) {
    throw new ContentAuditWorkbookError(
      "CONTENT_AUDIT_WORKBOOK_ARCHIVE_INVALID",
      400,
      "檔案不是有效的 XLSX ZIP 封裝。",
    );
  }
}

function extractArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  let entries = 0;
  let declaredBytes = 0;
  const seen = new Set<string>();
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes, {
      filter(file) {
        entries += 1;
        if (entries > MAX_ARCHIVE_ENTRIES) {
          tooLarge("Excel ZIP 項目數超過安全上限。");
        }
        validateArchivePath(file.name);
        if (seen.has(file.name)) {
          unsafeError("Excel ZIP 含有重複項目。");
        }
        seen.add(file.name);
        declaredBytes += file.originalSize;
        if (
          file.originalSize > MAX_XML_BYTES ||
          declaredBytes > MAX_UNCOMPRESSED_BYTES
        ) {
          tooLarge("Excel 解壓縮內容超過安全上限。");
        }
        if (file.name.endsWith("/")) return false;
        if (!isXmlPart(file.name)) {
          unsafeError(`Excel 含有不允許的二進位項目：${file.name}`);
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ContentAuditWorkbookError) throw error;
    throw new ContentAuditWorkbookError(
      "CONTENT_AUDIT_WORKBOOK_ARCHIVE_INVALID",
      400,
      "XLSX ZIP 結構損毀或不受支援。",
    );
  }
  let actualBytes = 0;
  for (const value of Object.values(archive)) {
    actualBytes += value.byteLength;
    if (value.byteLength > MAX_XML_BYTES || actualBytes > MAX_UNCOMPRESSED_BYTES) {
      tooLarge("Excel 實際解壓縮內容超過安全上限。");
    }
  }
  return archive;
}

function validateArchivePath(name: string): void {
  if (
    !name ||
    name.length > 255 ||
    name.includes("\\") ||
    name.startsWith("/") ||
    name.includes("\0") ||
    name.split("/").some((part) => part === "..")
  ) {
    unsafeError("Excel ZIP 含有不安全的檔案路徑。");
  }
}

function isXmlPart(name: string): boolean {
  return name === "[Content_Types].xml" || /\.(?:xml|rels)$/iu.test(name);
}

function validatePackageSafety(archive: Record<string, Uint8Array>): void {
  for (const required of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
  ]) {
    requirePart(archive, required);
  }
  const forbiddenPart = Object.keys(archive).find((name) =>
    /(?:vbaProject|macrosheet|externalLinks|activeX|embeddings|customUI|connections\.xml|queryTables|pivot|calcChain\.xml)/iu.test(
      name,
    ));
  if (forbiddenPart) {
    unsafeError(`Excel 含有不允許的功能項目：${forbiddenPart}`);
  }
  const contentTypes = xmlText(
    requirePart(archive, "[Content_Types].xml"),
    "[Content_Types].xml",
  );
  if (/macroEnabled|vbaProject|macrosheet/iu.test(contentTypes)) {
    unsafeError("Excel Content Types 宣告了巨集內容。");
  }
  for (const [name, bytes] of Object.entries(archive)) {
    if (!name.endsWith(".rels")) continue;
    const document = parseXml(bytes, name);
    for (const relationship of descendants(document, "Relationship")) {
      const targetMode = relationship.getAttribute("TargetMode");
      const target = relationship.getAttribute("Target") ?? "";
      const type = relationship.getAttribute("Type") ?? "";
      if (
        targetMode?.toLowerCase() === "external" ||
        /(?:externalLink|hyperlink)/iu.test(type) ||
        /^[a-z][a-z0-9+.-]*:/iu.test(target)
      ) {
        unsafeError("Excel 含有外部連結或外部關係。");
      }
    }
  }
}

function parseWorkbookSheets(
  archive: Record<string, Uint8Array>,
): WorkbookSheet[] {
  const workbook = parseXml(
    requirePart(archive, "xl/workbook.xml"),
    "xl/workbook.xml",
  );
  rejectDefinedNames(workbook);
  if (descendants(workbook, "externalReferences").length) {
    unsafeError("Excel 含有 External References。");
  }
  assertNoFormulaElements(workbook, "xl/workbook.xml");

  const relationships = parseXml(
    requirePart(archive, "xl/_rels/workbook.xml.rels"),
    "xl/_rels/workbook.xml.rels",
  );
  const targets = new Map<string, { target: string; type: string }>();
  for (const relationship of descendants(relationships, "Relationship")) {
    const id = relationship.getAttribute("Id") ?? "";
    const target = relationship.getAttribute("Target") ?? "";
    const type = relationship.getAttribute("Type") ?? "";
    if (!id || !target || targets.has(id)) {
      schemaError("Workbook relationships 缺少或重複識別碼。");
    }
    targets.set(id, { target, type });
  }

  const sheets: WorkbookSheet[] = [];
  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();
  for (const sheet of descendants(workbook, "sheet")) {
    const name = sheet.getAttribute("name") ?? "";
    const relationId =
      sheet.getAttribute("r:id") ??
      sheet.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      ) ??
      "";
    const relationship = targets.get(relationId);
    if (
      !name ||
      name.length > 31 ||
      seenNames.has(name) ||
      !relationship ||
      !/\/worksheet$/iu.test(relationship.type)
    ) {
      schemaError("Workbook 的工作表識別或關係無法安全辨識。");
    }
    const path = resolveWorkbookTarget(relationship.target);
    if (seenPaths.has(path)) {
      schemaError("多個工作表指向同一個 OOXML part。");
    }
    requirePart(archive, path);
    seenNames.add(name);
    seenPaths.add(path);
    sheets.push({ name, path });
  }
  if (!sheets.length || sheets.length > MAX_WORKSHEETS) {
    tooLarge("Excel 工作表數量超過安全上限，或工作簿沒有工作表。");
  }
  const unknownSheet = sheets.find(
    (sheet) =>
      sheet.name !== CONTENT_AUDIT_V2_INDEX_SHEET_NAME &&
      sheet.name !== "未綁變體" &&
      sheet.name !== "資料未完成" &&
      !/^F\d{3,6}$/u.test(sheet.name),
  );
  if (unknownSheet) {
    schemaError(`含有未知工作表「${unknownSheet.name}」。`);
  }
  return sheets;
}

function rejectDefinedNames(workbook: Document): void {
  const containers = descendants(workbook, "definedNames");
  const names = descendants(workbook, "definedName");
  if (!containers.length && !names.length) return;

  const sheetNames = descendants(workbook, "sheet").map((sheet) =>
    safeDefinedNameField(sheet.getAttribute("name") ?? ""));
  const diagnostics = names
    .slice(0, MAX_DEFINED_NAME_DIAGNOSTICS)
    .map((definedName, index) => {
      const localSheetId = definedName.hasAttribute("localSheetId")
        ? definedName.getAttribute("localSheetId")
        : null;
      let location = "整份活頁簿";
      if (localSheetId !== null) {
        const sheetIndex = /^\d+$/u.test(localSheetId)
          ? Number(localSheetId)
          : Number.NaN;
        const sheetName = Number.isSafeInteger(sheetIndex)
          ? sheetNames[sheetIndex]
          : undefined;
        location = sheetName
          ? `工作表「${sheetName}」`
          : `工作表索引「${safeDefinedNameField(localSheetId) || "空白"}」（無法對應）`;
      }
      const name =
        safeDefinedNameField(definedName.getAttribute("name") ?? "") ||
        "未命名";
      const reference =
        safeDefinedNameField(definedName.textContent ?? "") || "空白";
      return `${index + 1}. ${location}｜名稱「${name}」｜指向「${reference}」`;
    });
  const omitted = names.length - diagnostics.length;
  const detail = diagnostics.length
    ? `\n${diagnostics.join("\n")}${
        omitted > 0 ? `\n另有 ${omitted.toLocaleString()} 個未列出。` : ""
      }`
    : "\nDefined Names 區塊存在，但其中沒有可安全辨識的名稱項目。";
  unsafeError(
    `Excel 含有 ${names.length.toLocaleString()} 個 Defined Name；此匯入格式不允許名稱或公式。${detail}\n請在 Excel 的「公式 > 名稱管理員」刪除上述項目後另存新檔。`,
  );
}

function safeDefinedNameField(value: string): string {
  const normalized = value
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/gu,
      " ",
    )
    .replace(/[「」]/gu, (character) => (character === "「" ? "‹" : "›"))
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(normalized);
  return characters.length <= MAX_DEFINED_NAME_FIELD_CHARACTERS
    ? normalized
    : `${characters.slice(0, MAX_DEFINED_NAME_FIELD_CHARACTERS - 1).join("")}…`;
}

function resolveWorkbookTarget(target: string): string {
  if (!target || target.includes("\\") || target.includes("?") || target.includes("#")) {
    unsafeError("Workbook relationship target 不安全。");
  }
  const raw = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) unsafeError("Workbook relationship 逃出 XLSX 根目錄。");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const resolved = parts.join("/");
  if (!/^xl\/worksheets\/[^/]+\.xml$/iu.test(resolved)) {
    schemaError("Workbook sheet relationship 不是 worksheet XML。");
  }
  return resolved;
}

function parseSharedStrings(archive: Record<string, Uint8Array>): string[] {
  const bytes = archive["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const document = parseXml(bytes, "xl/sharedStrings.xml");
  assertNoFormulaElements(document, "xl/sharedStrings.xml");
  const values = descendants(document, "si").map(stringContainerText);
  if (values.length > MAX_TOTAL_CELLS) {
    tooLarge("Shared Strings 數量超過安全上限。");
  }
  values.forEach(assertCellLength);
  return values;
}

function parseWorksheet(
  bytes: Uint8Array,
  partName: string,
  sharedStrings: readonly string[],
  budget: ParserBudget,
): WorksheetCells {
  const document = parseXml(bytes, partName);
  assertNoFormulaElements(document, partName);
  if (
    descendants(document, "hyperlink").length ||
    descendants(document, "mergeCells").length
  ) {
    unsafeError(`${partName} 含有超連結或合併儲存格。`);
  }
  const sheetData = descendants(document, "sheetData");
  if (sheetData.length !== 1) {
    schemaError(`${partName} 缺少唯一的 sheetData。`);
  }
  const result: WorksheetCells = new Map();
  for (const rowElement of directChildren(sheetData[0]!, "row")) {
    const rawRow = rowElement.getAttribute("r") ?? "";
    const rowNumber = Number(rawRow);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || result.has(rowNumber)) {
      schemaError(`${partName} 含有無效或重複的列號。`);
    }
    budget.rows += 1;
    if (budget.rows > MAX_TOTAL_ROWS) tooLarge("Excel 總列數超過安全上限。");
    const row = new Map<number, string>();
    for (const cellElement of directChildren(rowElement, "c")) {
      budget.cells += 1;
      if (budget.cells > MAX_TOTAL_CELLS) tooLarge("Excel 儲存格數超過安全上限。");
      const reference = cellElement.getAttribute("r") ?? "";
      const match = /^([A-Z]{1,3})([1-9]\d*)$/u.exec(reference);
      if (!match || Number(match[2]) !== rowNumber) {
        schemaError(`${partName} 含有無效的儲存格座標。`);
      }
      const column = columnIndex(match[1]!);
      if (row.has(column)) schemaError(`${partName} 含有重複儲存格。`);
      const value = parseCellValue(cellElement, sharedStrings, partName);
      assertCellLength(value);
      row.set(column, value);
    }
    result.set(rowNumber, row);
  }
  return result;
}

function parseCellValue(
  cell: Element,
  sharedStrings: readonly string[],
  partName: string,
): string {
  const type = cell.getAttribute("t") ?? "";
  if (type === "inlineStr") {
    const containers = directChildren(cell, "is");
    if (containers.length > 1) schemaError(`${partName} 的 inline string 格式無效。`);
    return containers[0] ? stringContainerText(containers[0]) : "";
  }
  const values = directChildren(cell, "v");
  const value = values[0]?.textContent ?? "";
  if (values.length > 1) schemaError(`${partName} 的儲存格含有多個 value。`);
  if (type === "s") {
    if (!/^\d+$/u.test(value)) schemaError(`${partName} 的 shared string index 無效。`);
    const shared = sharedStrings[Number(value)];
    if (shared === undefined) schemaError(`${partName} 引用了不存在的 shared string。`);
    return shared;
  }
  if (type === "" || type === "n") return value;
  if (type === "str") {
    unsafeError(`${partName} 含有公式結果字串。`);
  }
  schemaError(`${partName} 含有不支援的儲存格型別「${type}」。`);
}

function stringContainerText(container: Element): string {
  let output = "";
  for (const child of directChildren(container)) {
    const name = localName(child);
    if (name === "t") {
      output += child.textContent ?? "";
    } else if (name === "r") {
      for (const text of directChildren(child, "t")) {
        output += text.textContent ?? "";
      }
    }
  }
  return output;
}

function parsePartialWorkbook(
  archive: Record<string, Uint8Array>,
  sheets: readonly WorkbookSheet[],
  sharedStrings: readonly string[],
  budget: ParserBudget,
): ParsedContentAuditWorkbook {
  const seenSkus = new Set<string>();
  const seenFamilies = new Set<string>();
  const rows: ParsedContentAuditWorkbookRow[] = [];
  let metadata: ParsedContentAuditWorkbook["metadata"] | null = null;
  for (const sheet of sheets) {
    const cells = parseWorksheet(
      requirePart(archive, sheet.path),
      sheet.path,
      sharedStrings,
      budget,
    );
    const embedded = parseEmbeddedSheetMetadata(cells, sheet.name, true);
    const currentMetadata = workbookMetadata(embedded);
    if (metadata && !sameWorkbookMetadata(metadata, currentMetadata)) {
      schemaError("部分工作簿的工作表不是來自同一次文案健檢匯出。");
    }
    metadata ??= currentMetadata;
    const entry: IndexEntry = {
      sheetName: embedded.sheetName,
      variationFamilyKey: embedded.variationFamilyKey,
      expectedRows: embedded.expectedRows,
    };
    if (seenFamilies.has(entry.variationFamilyKey)) {
      schemaError("部分工作簿含有重複的變體家庭工作表。");
    }
    seenFamilies.add(entry.variationFamilyKey);
    const parsed = parseDataSheet(cells, entry, seenSkus);
    if (parsed.length !== entry.expectedRows) {
      schemaError(`工作表「${entry.sheetName}」的問題列數與來源識別不一致。`);
    }
    rows.push(...parsed);
  }
  if (!metadata) schemaError("部分工作簿沒有可處理的文案工作表。");
  return { metadata, rows };
}

function parseEmbeddedSheetMetadata(
  cells: WorksheetCells,
  sheetName: string,
  required: true,
): EmbeddedSheetMetadata;
function parseEmbeddedSheetMetadata(
  cells: WorksheetCells,
  sheetName: string,
  required: false,
): EmbeddedSheetMetadata | null;
function parseEmbeddedSheetMetadata(
  cells: WorksheetCells,
  sheetName: string,
  required: boolean,
): EmbeddedSheetMetadata | null {
  rejectUnknownDataSheetCells(cells, sheetName);
  const marker = cell(cells, 1, CONTENT_AUDIT_V2_DATA_HEADERS.length + 1);
  const payload = cell(cells, 1, CONTENT_AUDIT_V2_DATA_HEADERS.length + 2);
  if (!marker && !payload) {
    if (required) {
      schemaError(
        `工作表「${sheetName}」缺少來源識別；請使用新版 AMZ.API 匯出的工作表。`,
      );
    }
    return null;
  }
  if (marker !== CONTENT_AUDIT_PARTIAL_SHEET_MARKER || !payload) {
    schemaError(`工作表「${sheetName}」的來源識別已被修改。`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    schemaError(`工作表「${sheetName}」的來源識別格式無效。`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    schemaError(`工作表「${sheetName}」的來源識別格式無效。`);
  }
  const value = raw as Record<string, unknown>;
  const expectedKeys = [
    "schemaVersion",
    "marketplaceId",
    "exportId",
    "fetchedAt",
    "sheetName",
    "variationFamilyKey",
    "expectedRows",
  ];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    value.schemaVersion !== 1 ||
    typeof value.marketplaceId !== "string" ||
    !/^[A-Z0-9]{1,32}$/u.test(value.marketplaceId) ||
    typeof value.exportId !== "string" ||
    !/^[A-Za-z0-9._-]{1,200}$/u.test(value.exportId) ||
    typeof value.fetchedAt !== "string" ||
    !validIsoDate(value.fetchedAt) ||
    value.sheetName !== sheetName ||
    typeof value.variationFamilyKey !== "string" ||
    !value.variationFamilyKey ||
    value.variationFamilyKey.length > 200 ||
    typeof value.expectedRows !== "number" ||
    !Number.isSafeInteger(value.expectedRows) ||
    value.expectedRows < 0 ||
    value.expectedRows > MAX_TOTAL_ROWS
  ) {
    schemaError(`工作表「${sheetName}」的來源識別格式無效。`);
  }
  return {
    schemaVersion: CONTENT_AUDIT_V2_SCHEMA_VERSION,
    marketplaceId: value.marketplaceId,
    exportId: value.exportId,
    fetchedAt: value.fetchedAt,
    sheetName,
    variationFamilyKey: value.variationFamilyKey,
    expectedRows: value.expectedRows,
  };
}

function workbookMetadata(
  value: EmbeddedSheetMetadata,
): ParsedContentAuditWorkbook["metadata"] {
  return {
    schemaVersion: CONTENT_AUDIT_V2_SCHEMA_VERSION,
    marketplaceId: value.marketplaceId,
    exportId: value.exportId,
    fetchedAt: value.fetchedAt,
  };
}

function sameWorkbookMetadata(
  left: ParsedContentAuditWorkbook["metadata"],
  right: ParsedContentAuditWorkbook["metadata"],
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.marketplaceId === right.marketplaceId &&
    left.exportId === right.exportId &&
    left.fetchedAt === right.fetchedAt;
}

function assertEmbeddedSheetMetadataMatches(
  embedded: EmbeddedSheetMetadata,
  metadata: ParsedContentAuditWorkbook["metadata"],
  entry: IndexEntry,
): void {
  if (
    !sameWorkbookMetadata(workbookMetadata(embedded), metadata) ||
    embedded.sheetName !== entry.sheetName ||
    embedded.variationFamilyKey !== entry.variationFamilyKey ||
    embedded.expectedRows !== entry.expectedRows
  ) {
    schemaError(`工作表「${entry.sheetName}」的來源識別與索引不一致。`);
  }
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function rejectUnknownDataSheetCells(
  cells: WorksheetCells,
  sheetName: string,
): void {
  const markerColumn = CONTENT_AUDIT_V2_DATA_HEADERS.length + 1;
  const payloadColumn = markerColumn + 1;
  for (const [rowNumber, row] of cells) {
    for (const [column, value] of row) {
      if (
        column > CONTENT_AUDIT_V2_DATA_HEADERS.length &&
        value &&
        !(rowNumber === 1 && (column === markerColumn || column === payloadColumn))
      ) {
        schemaError(`工作表「${sheetName}」含有未知欄位。`);
      }
    }
  }
}

function parseIndexSheet(cells: WorksheetCells): {
  metadata: ParsedContentAuditWorkbook["metadata"];
  entries: IndexEntry[];
} {
  rejectNonEmptyColumns(cells, CONTENT_AUDIT_V2_INDEX_HEADERS.length, "說明與索引");
  if (cell(cells, 1, 1) !== "AMZ.API 全站文案健檢 Excel") {
    schemaError("索引工作表不是 AMZ.API 全站文案健檢格式。");
  }
  const schemaVersion = metadataValue(cells, 2, "Schema Version");
  const marketplaceId = metadataValue(cells, 3, "Marketplace ID");
  const exportId = metadataValue(cells, 4, "Export ID");
  const fetchedAt = metadataValue(cells, 5, "Fetched At");
  if (schemaVersion !== String(CONTENT_AUDIT_V2_SCHEMA_VERSION)) {
    schemaError("Excel schemaVersion 不是 2，請重新匯出。");
  }
  if (!/^[A-Z0-9]{1,32}$/u.test(marketplaceId)) {
    schemaError("Marketplace ID 格式無效。");
  }
  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(exportId)) {
    schemaError("Export ID 格式無效。");
  }
  const parsedDate = new Date(fetchedAt);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString() !== fetchedAt) {
    schemaError("Fetched At 必須是完整 ISO 時間。");
  }
  expectHeaderRow(
    cells,
    CONTENT_AUDIT_V2_INDEX_HEADER_ROW,
    CONTENT_AUDIT_V2_INDEX_HEADERS,
    "說明與索引",
  );
  const entries: IndexEntry[] = [];
  const seenSheets = new Set<string>();
  const seenFamilies = new Set<string>();
  for (const rowNumber of [...cells.keys()].sort((a, b) => a - b)) {
    if (rowNumber <= CONTENT_AUDIT_V2_INDEX_HEADER_ROW) continue;
    const row = cells.get(rowNumber)!;
    if (![...row.values()].some(Boolean)) continue;
    const sheetName = row.get(1) ?? "";
    const variationFamilyKey = row.get(2) ?? "";
    const countText = row.get(6) ?? "";
    if (
      !sheetName ||
      !variationFamilyKey ||
      seenSheets.has(sheetName) ||
      seenFamilies.has(variationFamilyKey) ||
      !/^\d+$/u.test(countText)
    ) {
      schemaError("索引含有缺值、重複 family 或無效問題列數。");
    }
    if (
      (sheetName === "未綁變體" && variationFamilyKey !== "STANDALONE") ||
      (sheetName === "資料未完成" && variationFamilyKey !== "DATA_INCOMPLETE") ||
      (/^F\d{3,6}$/u.test(sheetName) &&
        ["STANDALONE", "DATA_INCOMPLETE"].includes(variationFamilyKey)) ||
      (sheetName !== "未綁變體" &&
        sheetName !== "資料未完成" &&
        !/^F\d{3,6}$/u.test(sheetName))
    ) {
      schemaError("索引的工作表名稱與變體分類不一致。");
    }
    const expectedRows = Number(countText);
    if (!Number.isSafeInteger(expectedRows) || expectedRows < 0) {
      schemaError("索引問題列數無效。");
    }
    seenSheets.add(sheetName);
    seenFamilies.add(variationFamilyKey);
    entries.push({ sheetName, variationFamilyKey, expectedRows });
  }
  return {
    metadata: {
      schemaVersion: CONTENT_AUDIT_V2_SCHEMA_VERSION,
      marketplaceId,
      exportId,
      fetchedAt,
    },
    entries,
  };
}

function parseDataSheet(
  cells: WorksheetCells,
  index: IndexEntry,
  seenSkus: Set<string>,
): ParsedContentAuditWorkbookRow[] {
  rejectUnknownDataSheetCells(cells, index.sheetName);
  expectHeaderRow(cells, 1, CONTENT_AUDIT_V2_DATA_HEADERS, index.sheetName);
  const rows: ParsedContentAuditWorkbookRow[] = [];
  for (const rowNumber of [...cells.keys()].sort((a, b) => a - b)) {
    if (rowNumber === 1) continue;
    const row = cells.get(rowNumber)!;
    if (![...row.values()].some(Boolean)) continue;
    const sellerSku = row.get(1) ?? "";
    const asin = row.get(2) ?? "";
    const productType = row.get(3) ?? "";
    if (
      !sellerSku ||
      sellerSku.length > 40 ||
      sellerSku !== sellerSku.trim() ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
        sellerSku,
      ) ||
      seenSkus.has(sellerSku)
    ) {
      schemaError("Excel 含有缺少、重複或無法精確辨識的 Seller SKU。");
    }
    if (asin && !/^[A-Z0-9]{10}$/u.test(asin)) {
      schemaError(`SKU ${sellerSku} 的 ASIN 格式無效。`);
    }
    if (productType.length > 200) {
      schemaError(`SKU ${sellerSku} 的 Product Type 過長。`);
    }
    seenSkus.add(sellerSku);
    const original = contentValues(row, "original");
    const proposed = contentValues(row, "proposed");
    rows.push({
      sellerSku,
      asin,
      productType,
      variationFamilyKey: index.variationFamilyKey,
      sourceSheet: index.sheetName,
      original,
      proposed,
      title: proposed.title,
      itemHighlight: proposed.itemHighlight,
      bulletPoints: [...proposed.bulletPoints],
      productDescription: proposed.productDescription,
      ingredients: proposed.ingredients,
      auditType: row.get(22) ?? "",
      auditDescription: row.get(23) ?? "",
    });
  }
  return rows;
}

function contentValues(
  row: Map<number, string>,
  kind: "original" | "proposed",
): ParsedContentAuditValues {
  const offset = kind === "original" ? 0 : 1;
  return {
    title: row.get(4 + offset) ?? "",
    itemHighlight: row.get(6 + offset) ?? "",
    bulletPoints: [8, 10, 12, 14, 16].map(
      (column) => row.get(column + offset) ?? "",
    ),
    productDescription: row.get(18 + offset) ?? "",
    ingredients: row.get(20 + offset) ?? "",
  };
}

function metadataValue(
  cells: WorksheetCells,
  rowNumber: number,
  label: string,
): string {
  if (cell(cells, rowNumber, 1) !== label) {
    schemaError(`索引 metadata 缺少「${label}」。`);
  }
  return cell(cells, rowNumber, 2);
}

function expectHeaderRow(
  cells: WorksheetCells,
  rowNumber: number,
  expected: readonly string[],
  sheetName: string,
): void {
  for (let index = 0; index < expected.length; index += 1) {
    if (cell(cells, rowNumber, index + 1) !== expected[index]) {
      schemaError(`工作表「${sheetName}」的欄位順序或名稱已被修改。`);
    }
  }
}

function rejectNonEmptyColumns(
  cells: WorksheetCells,
  maximumColumn: number,
  sheetName: string,
): void {
  for (const row of cells.values()) {
    for (const [column, value] of row) {
      if (column > maximumColumn && value) {
        schemaError(`工作表「${sheetName}」含有未知欄位。`);
      }
    }
  }
}

function cell(cells: WorksheetCells, row: number, column: number): string {
  return cells.get(row)?.get(column) ?? "";
}

function columnIndex(name: string): number {
  let value = 0;
  for (const character of name) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > 16_384) {
    schemaError("Excel 欄位座標超出範圍。");
  }
  return value;
}

function assertCellLength(value: string): void {
  if (Array.from(value).length > MAX_CELL_CHARACTERS) {
    tooLarge("Excel 儲存格文字超過安全上限。");
  }
}

function assertNoFormulaElements(document: Document, partName: string): void {
  for (const name of ["f", "formula", "formula1", "formula2"]) {
    if (descendants(document, name).length) {
      unsafeError(`${partName} 含有公式。`);
    }
  }
}

function parseXml(bytes: Uint8Array, partName: string): Document {
  const source = xmlText(bytes, partName);
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) {
    unsafeError(`${partName} 含有 DTD 或 Entity 宣告。`);
  }
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => errors.push(String(message)),
      fatalError: (message) => errors.push(String(message)),
    },
  }).parseFromString(source, "application/xml");
  if (errors.length || !document.documentElement) {
    throw new ContentAuditWorkbookError(
      "CONTENT_AUDIT_WORKBOOK_ARCHIVE_INVALID",
      400,
      `${partName} 不是有效 XML。`,
    );
  }
  return document;
}

function xmlText(bytes: Uint8Array, partName: string): string {
  if (bytes.byteLength > MAX_XML_BYTES) tooLarge(`${partName} 超過 XML 安全上限。`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ContentAuditWorkbookError(
      "CONTENT_AUDIT_WORKBOOK_ARCHIVE_INVALID",
      400,
      `${partName} 不是有效 UTF-8 XML。`,
    );
  }
}

function descendants(node: Node, expectedLocalName: string): Element[] {
  const output: Element[] = [];
  const elements = (node as Document | Element).getElementsByTagName("*");
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements.item(index);
    if (element && localName(element) === expectedLocalName) output.push(element);
  }
  return output;
}

function directChildren(node: Node, expectedLocalName?: string): Element[] {
  const output: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (
      child?.nodeType === 1 &&
      (!expectedLocalName || localName(child) === expectedLocalName)
    ) {
      output.push(child as Element);
    }
  }
  return output;
}

function localName(node: Node): string {
  return (
    (node as Node & { localName?: string | null }).localName ||
    node.nodeName.split(":").at(-1) ||
    node.nodeName
  );
}

function requirePart(
  archive: Record<string, Uint8Array>,
  name: string,
): Uint8Array {
  const value = archive[name];
  if (!value) schemaError(`Excel 缺少必要 OOXML part：${name}`);
  return value;
}

function schemaError(message: string): never {
  throw new ContentAuditWorkbookError(
    "CONTENT_AUDIT_WORKBOOK_SCHEMA_INVALID",
    422,
    message,
  );
}

function unsafeError(message: string): never {
  throw new ContentAuditWorkbookError(
    "CONTENT_AUDIT_WORKBOOK_UNSAFE",
    422,
    message,
  );
}

function tooLarge(message: string): never {
  throw new ContentAuditWorkbookError(
    "CONTENT_AUDIT_WORKBOOK_TOO_LARGE",
    413,
    message,
  );
}
