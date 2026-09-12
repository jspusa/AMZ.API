import { createHash } from "node:crypto";
import { posix } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type {
  PriceListAmazonRow,
  PriceListCell,
  PriceListProductRow,
  PriceListSheet,
  PriceListStyle,
  PriceListWorkbook,
} from "../shared/price-list";
import { priceListPriceValue } from "../shared/price-list-price";

export const PRICE_LIST_MAX_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_CELLS = 100_000;
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export class PriceListError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ParsedPriceListWorkbook = {
  view: PriceListWorkbook;
  archive: Record<string, Uint8Array>;
  originalBytes: Uint8Array;
  sheetPaths: Map<string, string>;
  images: Map<string, { path: string; mediaType: string }>;
};

export type PriceListCellChange = {
  sheetName: string;
  reference: string;
  value: number | string | null;
};

function fail(message: string, status = 422): never {
  throw new PriceListError(status, "PRICE_LIST_INVALID", message);
}
function elements(node: Document | Element, localName: string): Element[] {
  return Array.from(node.getElementsByTagName("*")).filter(
    (el) => el.localName === localName,
  );
}
function children(node: Element, localName: string): Element[] {
  return Array.from(node.childNodes).filter(
    (el): el is Element =>
      el.nodeType === 1 && (el as Element).localName === localName,
  );
}
function xml(bytes: Uint8Array | undefined): Document {
  if (!bytes || bytes.byteLength > 16 * 1024 * 1024)
    fail("Excel XML 缺少或超過大小限制。");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/iu.test(source))
    fail("Excel 含有不允許的 XML 宣告。");
  let invalid = false;
  const result = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: () => {
        invalid = true;
      },
      fatalError: () => {
        invalid = true;
      },
    },
  }).parseFromString(source, "application/xml");
  if (invalid || !result.documentElement) fail("Excel XML 結構無法辨識。");
  return result;
}
function safePath(name: string): boolean {
  return (
    !!name &&
    name.length < 256 &&
    !name.startsWith("/") &&
    !/[\\\u0000]/u.test(name) &&
    !name.split("/").some((part) => part === ".." || part === ".")
  );
}
function targetPath(owner: string, target: string): string {
  if (
    !target ||
    /[\\?#\u0000]/u.test(target) ||
    /^[a-z][a-z\d+.-]*:/iu.test(target)
  )
    fail("Excel 內部關係路徑無法辨識。");
  const resolved = posix.normalize(
    target.startsWith("/")
      ? target.slice(1)
      : posix.join(posix.dirname(owner), target),
  );
  if (!safePath(resolved)) fail("Excel 內部關係超出檔案範圍。");
  return resolved;
}
function relations(
  archive: Record<string, Uint8Array>,
  owner: string,
): Map<string, string> {
  const path = posix.join(
    posix.dirname(owner),
    "_rels",
    `${posix.basename(owner)}.rels`,
  );
  const result = new Map<string, string>();
  if (!archive[path]) return result;
  for (const el of elements(xml(archive[path]), "Relationship")) {
    if (el.getAttribute("TargetMode") === "External") continue;
    const id = el.getAttribute("Id") ?? "";
    if (!id || result.has(id)) fail("Excel 內部關係有重複識別碼。");
    result.set(id, targetPath(owner, el.getAttribute("Target") ?? ""));
  }
  return result;
}
export function priceListColumnName(column: number): string {
  let result = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
function coordinate(reference: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/u.exec(reference);
  if (!match) fail("Excel 儲存格座標無法辨識。");
  const column = [...match[1]!].reduce(
    (acc, char) => acc * 26 + char.charCodeAt(0) - 64,
    0,
  );
  const row = Number(match[2]);
  if (column > 128 || row > 5_000)
    fail("價目表預覽最多支援 128 欄、每頁 5,000 列。", 413);
  return { row, column };
}
function textValue(el: Element): string {
  return elements(el, "t")
    .map((t) => t.textContent ?? "")
    .join("");
}
function color(
  el: Element | undefined,
  fallback: string,
  theme: string[],
): string {
  if (!el) return fallback;
  const rgb = el.getAttribute("rgb");
  if (rgb && /^[\da-f]{6,8}$/iu.test(rgb)) return `#${rgb.slice(-6)}`;
  const themeIndex = el.getAttribute("theme");
  const base = themeIndex ? theme[Number(themeIndex)] : undefined;
  if (!base) return fallback;
  const tint = Number(el.getAttribute("tint") || 0);
  return `#${[0, 2, 4]
    .map((offset) => {
      const value = parseInt(base.slice(offset, offset + 2), 16);
      return Math.round(
        tint < 0
          ? value * (1 + tint)
          : value + (255 - value) * Math.min(1, tint),
      )
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}
function parseStyles(archive: Record<string, Uint8Array>): PriceListStyle[] {
  const defaultStyle: PriceListStyle = {
    fontName: "Arial",
    fontSize: 11,
    bold: false,
    italic: false,
    color: "#172337",
    background: "#ffffff",
    horizontal: "left",
    vertical: "middle",
    wrap: false,
    numberFormat: "General",
    border: false,
  };
  if (!archive["xl/styles.xml"]) return [defaultStyle];
  const theme: string[] = [];
  if (archive["xl/theme/theme1.xml"]) {
    const scheme = elements(
      xml(archive["xl/theme/theme1.xml"]),
      "clrScheme",
    )[0];
    if (scheme)
      for (const item of Array.from(scheme.childNodes).filter(
        (node): node is Element => node.nodeType === 1,
      )) {
        const c = elements(item, "srgbClr")[0] ?? elements(item, "sysClr")[0];
        theme.push(
          c?.getAttribute("lastClr") || c?.getAttribute("val") || "000000",
        );
      }
    // OOXML theme indices put light before dark, unlike clrScheme child order.
    [theme[0], theme[1]] = [theme[1]!, theme[0]!];
    [theme[2], theme[3]] = [theme[3]!, theme[2]!];
  }
  const doc = xml(archive["xl/styles.xml"]);
  const fonts = elements(doc, "fonts")[0];
  const fills = elements(doc, "fills")[0];
  const fontItems = fonts ? children(fonts, "font") : [];
  const fillItems = fills ? children(fills, "fill") : [];
  const formats = new Map<number, string>([
    [0, "General"],
    [1, "0"],
    [2, "0.00"],
    [3, "#,##0"],
    [4, "#,##0.00"],
    [9, "0%"],
    [10, "0.00%"],
    [14, "mm/dd/yy"],
  ]);
  for (const f of elements(doc, "numFmt"))
    formats.set(
      Number(f.getAttribute("numFmtId")),
      f.getAttribute("formatCode") ?? "General",
    );
  const xfs = elements(doc, "cellXfs")[0];
  if (!xfs) return [defaultStyle];
  return children(xfs, "xf").map((xf) => {
    const font = fontItems[Number(xf.getAttribute("fontId"))];
    const fill = fillItems[Number(xf.getAttribute("fillId"))];
    const align = children(xf, "alignment")[0];
    const horizontal = align?.getAttribute("horizontal");
    const vertical = align?.getAttribute("vertical");
    return {
      ...defaultStyle,
      fontName: font
        ? elements(font, "name")[0]?.getAttribute("val") || "Arial"
        : "Arial",
      fontSize: Math.min(
        40,
        Math.max(
          6,
          Number(
            font ? elements(font, "sz")[0]?.getAttribute("val") || 11 : 11,
          ),
        ),
      ),
      bold:
        !!font &&
        elements(font, "b").some((el) => el.getAttribute("val") !== "0"),
      italic:
        !!font &&
        elements(font, "i").some((el) => el.getAttribute("val") !== "0"),
      color: color(
        font ? elements(font, "color")[0] : undefined,
        defaultStyle.color,
        theme,
      ),
      background: color(
        fill ? elements(fill, "fgColor")[0] : undefined,
        "#ffffff",
        theme,
      ),
      horizontal:
        horizontal === "center" || horizontal === "right" ? horizontal : "left",
      vertical:
        vertical === "top" || vertical === "bottom" ? vertical : "middle",
      wrap: align?.getAttribute("wrapText") === "1",
      numberFormat:
        formats.get(Number(xf.getAttribute("numFmtId"))) || "General",
      border: Number(xf.getAttribute("borderId")) > 0,
    };
  });
}
function display(value: PriceListCell["value"], format: string): string {
  if (value === null) return "";
  if (typeof value !== "number") return String(value);
  const clean = format.replace(/"[^"]*"/gu, "").replace(/\[[^\]]*\]/gu, "");
  if (
    /[yd]/iu.test(clean) &&
    /[m]/iu.test(clean) &&
    value > 0 &&
    value < 3_000_000
  ) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  const percent = clean.includes("%");
  const decimals = Math.min(
    8,
    /\.([0#]+)/u.exec(clean)?.[1]?.length ?? (format === "General" ? 8 : 0),
  );
  const number = percent ? value * 100 : value;
  const rendered = number.toLocaleString("en-US", {
    useGrouping: clean.includes(","),
    minimumFractionDigits: format === "General" ? 0 : decimals,
    maximumFractionDigits: decimals,
  });
  return `${format.includes("$") ? "$" : ""}${rendered}${percent ? "%" : ""}`;
}

function richImages(
  archive: Record<string, Uint8Array>,
  images: ParsedPriceListWorkbook["images"],
): Map<number, string> {
  const result = new Map<number, string>();
  if (
    !archive["xl/metadata.xml"] ||
    !archive["xl/richData/rdrichvalue.xml"] ||
    !archive["xl/richData/richValueRel.xml"]
  )
    return result;
  const rels = relations(archive, "xl/richData/richValueRel.xml");
  const localRels = elements(
    xml(archive["xl/richData/richValueRel.xml"]),
    "rel",
  );
  const values = elements(xml(archive["xl/richData/rdrichvalue.xml"]), "rv");
  const metadata = xml(archive["xl/metadata.xml"]);
  const futures = elements(metadata, "futureMetadata").find(
    (el) => el.getAttribute("name") === "XLRICHVALUE",
  );
  const futureValues = futures
    ? children(futures, "bk").map((bk) =>
        Number(elements(bk, "rvb")[0]?.getAttribute("i")),
      )
    : [];
  const types = elements(metadata, "metadataType");
  const valueMetadata = elements(metadata, "valueMetadata")[0];
  if (!valueMetadata) return result;
  children(valueMetadata, "bk").forEach((bk, index) => {
    const rc = children(bk, "rc")[0];
    if (
      !rc ||
      types[Number(rc.getAttribute("t")) - 1]?.getAttribute("name") !==
        "XLRICHVALUE"
    )
      return;
    const rv = values[futureValues[Number(rc.getAttribute("v"))] ?? -1];
    const relationIndex = rv ? Number(children(rv, "v")[0]?.textContent) : -1;
    const rel = localRels[relationIndex];
    const path = rel ? rels.get(rel.getAttribute("r:id") ?? "") : undefined;
    if (
      !path ||
      !/^xl\/media\/[^/]+\.(?:png|jpe?g)$/iu.test(path) ||
      !archive[path]
    )
      return;
    validateImportedImage(archive[path]!);
    const imageId = `image-${createHash("sha256").update(path).digest("hex").slice(0, 20)}`;
    images.set(imageId, {
      path,
      mediaType: /\.png$/iu.test(path) ? "image/png" : "image/jpeg",
    });
    result.set(index + 1, imageId);
  });
  return result;
}

function sheetDrawingImages(
  archive: Record<string, Uint8Array>,
  sheetPath: string,
  sheetDoc: Document,
  sheet: PriceListSheet,
  images: ParsedPriceListWorkbook["images"],
): void {
  const drawingRefs = relations(archive, sheetPath);
  for (const drawing of elements(sheetDoc, "drawing")) {
    const path = drawingRefs.get(drawing.getAttribute("r:id") ?? "");
    if (!path || !/^xl\/drawings\/[^/]+\.xml$/u.test(path) || !archive[path])
      continue;
    const drawingDoc = xml(archive[path]);
    const imageRefs = relations(archive, path);
    for (const anchor of [
      ...elements(drawingDoc, "oneCellAnchor"),
      ...elements(drawingDoc, "twoCellAnchor"),
    ]) {
      const origin = children(anchor, "from")[0];
      const row =
        Number(origin ? children(origin, "row")[0]?.textContent : -1) + 1;
      const column =
        Number(origin ? children(origin, "col")[0]?.textContent : -1) + 1;
      const path = imageRefs.get(
        elements(anchor, "blip")[0]?.getAttribute("r:embed") ?? "",
      );
      if (
        !Number.isInteger(row) ||
        !Number.isInteger(column) ||
        row < 1 ||
        row > 5_000 ||
        column < 1 ||
        column > 128 ||
        !path ||
        !/^xl\/media\/[^/]+\.(?:png|jpe?g)$/iu.test(path) ||
        !archive[path]
      )
        continue;
      validateImportedImage(archive[path]!);
      const imageId = `image-${createHash("sha256").update(path).digest("hex").slice(0, 20)}`;
      images.set(imageId, {
        path,
        mediaType: /\.png$/iu.test(path) ? "image/png" : "image/jpeg",
      });
      const cell = sheet.cells.find(
        (cell) => cell.row === row && cell.column === column,
      );
      if (cell) {
        cell.imageId = imageId;
        cell.display = "";
      } else
        sheet.cells.push({
          reference: `${priceListColumnName(column)}${row}`,
          row,
          column,
          value: null,
          display: "",
          formula: null,
          styleId: 0,
          imageId,
        });
      sheet.rowCount = Math.max(sheet.rowCount, row);
      sheet.columnCount = Math.max(sheet.columnCount, column);
    }
  }
  sheet.cells.sort((a, b) => a.row - b.row || a.column - b.column);
}

const HEADER_KEYS: Record<string, string> = {
  sku: "code",
  sellersku: "code",
  貨號: "code",
  品號: "code",
  商品編號: "code",
  asin: "asin",
  圖片: "image",
  產品名稱: "title",
  商品名稱: "title",
  jam89名稱: "title",
  最低活動價: "minimumPrice",
  最低價格: "minimumPrice",
  標準定價: "standardPrice",
  價格: "standardPrice",
  售價: "standardPrice",
  建議售價: "standardPrice",
};
function headerKey(value: string): string {
  return HEADER_KEYS[value.toLowerCase().replace(/\s/gu, "")] ?? value;
}
function headerMap(row: PriceListCell[]): Map<number, string> | null {
  if (
    !row.some((c) => headerKey(c.display) === "code") ||
    !row.some((c) => headerKey(c.display) === "title")
  )
    return null;
  return new Map(
    row.filter((c) => c.display).map((c) => [c.column, headerKey(c.display)]),
  );
}
function products(sheets: PriceListSheet[]): PriceListProductRow[] {
  const allHeaders = sheets.flatMap((sheet) => {
    const rows = new Map<number, PriceListCell[]>();
    for (const cell of sheet.cells)
      rows.set(cell.row, [...(rows.get(cell.row) ?? []), cell]);
    return [...rows.values()]
      .map(headerMap)
      .filter((map): map is Map<number, string> => map !== null);
  });
  const common = allHeaders.find(
    (map) =>
      [...map.values()].includes("asin") &&
      [...map.values()].includes("minimumPrice"),
  );
  return sheets.flatMap((sheet) => {
    const rows = new Map<number, PriceListCell[]>();
    for (const cell of sheet.cells)
      rows.set(cell.row, [...(rows.get(cell.row) ?? []), cell]);
    let headers: Map<number, string> | undefined;
    let keyKind: PriceListProductRow["keyKind"] = "product-code";
    const result: PriceListProductRow[] = [];
    for (const [rowNumber, cells] of rows) {
      const detected = headerMap(cells);
      if (detected) {
        headers = detected;
        keyKind = cells.some((c) => /^(?:seller\s*)?sku$/iu.test(c.display))
          ? "seller-sku"
          : "product-code";
        continue;
      }
      // Some original brand sheets omit repeated headers. Adopt only the proven
      // shared layout when its ASIN and product-code columns both match.
      const inferred =
        !headers &&
        common &&
        cells.some(
          (c) =>
            common.get(c.column) === "asin" &&
            /^[A-Z0-9]{10}$/u.test(c.display),
        )
          ? common
          : undefined;
      const mapping = headers ?? inferred;
      if (!mapping) continue;
      const code = cells.find((c) => mapping.get(c.column) === "code");
      const title = cells.find((c) => mapping.get(c.column) === "title");
      if (
        !code ||
        !title?.display ||
        !code.display ||
        code.display.length > 80 ||
        /\s/u.test(code.display) ||
        !/[A-Za-z0-9]/u.test(code.display)
      )
        continue;
      const rowCells: Record<string, PriceListCell> = {};
      for (const cell of cells) {
        const field = mapping.get(cell.column);
        if (field) rowCells[field] = cell;
      }
      // Keep blank typed cells addressable so Amazon comparison can pair them.
      for (const [column, field] of mapping)
        if (!rowCells[field])
          rowCells[field] = {
            reference: `${priceListColumnName(column)}${rowNumber}`,
            row: rowNumber,
            column,
            value: null,
            display: "",
            formula: null,
            styleId: 0,
          };
      result.push({
        key: code.display,
        keyKind,
        sheetName: sheet.name,
        rowNumber,
        asin: /^[A-Z0-9]{10}$/u.test(rowCells.asin?.display ?? "")
          ? rowCells.asin!.display
          : null,
        cells: rowCells,
      });
    }
    return result;
  });
}

export function parsePriceListWorkbook(input: {
  bytes: Uint8Array;
  fileName: string;
}): ParsedPriceListWorkbook {
  try {
    if (!/^[^\\/\u0000-\u001f]{1,250}\.xlsx$/iu.test(input.fileName))
      fail("請選擇 .xlsx 價目表。", 415);
    if (
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength < 4 ||
      input.bytes.byteLength > PRICE_LIST_MAX_BYTES
    )
      fail("價目表不可超過 25 MB。", 413);
    let size = 0;
    let count = 0;
    const seen = new Set<string>();
    const archive = unzipSync(input.bytes, {
      filter(file) {
        if (++count > 2_048 || !safePath(file.name) || seen.has(file.name))
          fail("Excel ZIP 結構不安全。");
        seen.add(file.name);
        size += file.originalSize;
        if (size > MAX_EXPANDED_BYTES || file.originalSize > 16 * 1024 * 1024)
          fail("價目表解壓縮內容超過限制。", 413);
        if (/vbaProject|macro|activeX|embeddings|customUI/iu.test(file.name))
          fail("價目表不能包含巨集或可執行物件。");
        return !file.name.endsWith("/");
      },
    });
    if (
      Object.values(archive).reduce((sum, value) => sum + value.byteLength, 0) >
      MAX_EXPANDED_BYTES
    )
      fail("價目表解壓縮內容超過限制。", 413);
    for (const [name, bytes] of Object.entries(archive))
      if (/\.(?:xml|rels)$/iu.test(name)) xml(bytes);
    const workbook = xml(archive["xl/workbook.xml"]);
    const contentTypes = strFromU8(
      archive["[Content_Types].xml"] ?? new Uint8Array(),
    );
    if (/macroEnabled|vbaProject|macrosheet/iu.test(contentTypes))
      fail("價目表不能包含巨集。");
    const relationships = relations(archive, "xl/workbook.xml");
    const strings = archive["xl/sharedStrings.xml"]
      ? elements(xml(archive["xl/sharedStrings.xml"]), "si").map(textValue)
      : [];
    const styles = parseStyles(archive);
    const images: ParsedPriceListWorkbook["images"] = new Map();
    const imageByMetadata = richImages(archive, images);
    const sheets: PriceListSheet[] = [];
    const sheetPaths = new Map<string, string>();
    let cellsCount = 0;
    let previewCells = 0;
    const sheetEls = elements(workbook, "sheet");
    if (!sheetEls.length || sheetEls.length > 40)
      fail("價目表須有 1–40 個工作表。", 413);
    for (const sheetEl of sheetEls) {
      const name = sheetEl.getAttribute("name") ?? "";
      const path = relationships.get(sheetEl.getAttribute("r:id") ?? "");
      if (
        !name ||
        sheetPaths.has(name) ||
        !path ||
        !/^xl\/worksheets\/[^/]+\.xml$/u.test(path) ||
        [...sheetPaths.values()].includes(path)
      )
        fail("Excel 工作表識別無法辨識。");
      sheetPaths.set(name, path);
      const doc = xml(archive[path]);
      const sheet: PriceListSheet = {
        name,
        hidden: ["hidden", "veryHidden"].includes(
          sheetEl.getAttribute("state") ?? "",
        ),
        rowCount: 0,
        columnCount: 0,
        cells: [],
        rowHeights: {},
        columnWidths: {},
        hiddenRows: [],
        hiddenColumns: [],
        merges: [],
      };
      const seenCells = new Set<string>();
      for (const rowEl of elements(doc, "row")) {
        const row = Number(rowEl.getAttribute("r"));
        if (!Number.isInteger(row) || row < 1 || row > 5_000)
          fail("價目表列號超出支援範圍。", 413);
        if (rowEl.getAttribute("hidden") === "1") sheet.hiddenRows.push(row);
        if (rowEl.hasAttribute("ht"))
          sheet.rowHeights[row] = Math.min(
            600,
            Math.max(12, (Number(rowEl.getAttribute("ht")) * 4) / 3),
          );
        for (const cellEl of children(rowEl, "c")) {
          if (++cellsCount > MAX_CELLS)
            fail("價目表儲存格超過 100,000 格。", 413);
          const reference = cellEl.getAttribute("r") ?? "";
          const coord = coordinate(reference);
          if (coord.row !== row || seenCells.has(reference))
            fail("Excel 儲存格座標重複或與列號不符。");
          seenCells.add(reference);
          const type = cellEl.getAttribute("t");
          const raw = children(cellEl, "v")[0]?.textContent ?? "";
          const formula = children(cellEl, "f")[0]?.textContent ?? null;
          const styleId = Number(cellEl.getAttribute("s") || 0);
          let value: PriceListCell["value"] =
            type === "s"
              ? (strings[Number(raw)] ?? null)
              : type === "inlineStr"
                ? textValue(cellEl)
                : type === "b"
                  ? raw === "1"
                  : raw;
          if (!type || type === "n") value = raw === "" ? null : Number(raw);
          if (typeof value === "number" && !Number.isFinite(value))
            fail("Excel 含有無法辨識的數字。");
          if (
            String(value ?? "").length > 32_767 ||
            (formula?.length ?? 0) > 32_767 ||
            !styles[styleId]
          )
            fail("Excel 儲存格文字或樣式不受支援。");
          const imageId = imageByMetadata.get(
            Number(cellEl.getAttribute("vm")),
          );
          sheet.cells.push({
            reference,
            ...coord,
            value,
            formula,
            styleId,
            display: imageId
              ? ""
              : display(value, styles[styleId]!.numberFormat),
            ...(imageId ? { imageId } : {}),
          });
          sheet.rowCount = Math.max(sheet.rowCount, row);
          sheet.columnCount = Math.max(sheet.columnCount, coord.column);
        }
      }
      for (const col of elements(doc, "col")) {
        const min = Number(col.getAttribute("min"));
        const max = Number(col.getAttribute("max"));
        for (let c = Math.max(1, min); c <= Math.min(128, max); c++) {
          sheet.columnWidths[c] = Math.min(
            800,
            Math.max(24, Number(col.getAttribute("width") || 12) * 7 + 5),
          );
          if (col.getAttribute("hidden") === "1") sheet.hiddenColumns.push(c);
        }
      }
      for (const merge of elements(doc, "mergeCell")) {
        if (sheet.merges.length >= 2_000)
          fail("價目表合併儲存格超過預覽上限。", 413);
        const [start, end] = (merge.getAttribute("ref") ?? "").split(":");
        const a = coordinate(start ?? "");
        const b = coordinate(end ?? start ?? "");
        if (a.row > b.row || a.column > b.column)
          fail("Excel 合併儲存格範圍無效。");
        sheet.merges.push({
          startRow: a.row,
          endRow: b.row,
          startColumn: a.column,
          endColumn: b.column,
        });
        sheet.rowCount = Math.max(sheet.rowCount, b.row);
        sheet.columnCount = Math.max(sheet.columnCount, b.column);
      }
      sheetDrawingImages(archive, path, doc, sheet, images);
      previewCells += sheet.rowCount * sheet.columnCount;
      if (previewCells > MAX_CELLS)
        fail("價目表包含過大的空白範圍；請刪除多餘空白列欄後再選取。", 413);
      sheets.push(sheet);
    }
    const formulaCount = sheets.reduce(
      (sum, sheet) =>
        sum + sheet.cells.filter((c) => c.formula !== null).length,
      0,
    );
    const warnings = ["檔案只在本機記憶體處理；關閉 App 或鎖定後需重新選檔。"];
    if (formulaCount)
      warnings.push(
        "公式顯示 Excel 上次儲存的結果；App 不執行公式。公式缺少儲存結果時保持空白。",
      );
    if (
      Object.keys(archive).some((name) =>
        /externalLinks|connections|queryTables/iu.test(name),
      )
    )
      warnings.push("檔案含外部資料參照；此頁不連線、不執行、不更新參照。");
    if (
      Object.keys(archive).some((name) =>
        /^xl\/drawings\/[^/]+\.xml$/u.test(name),
      )
    )
      warnings.push(
        "浮動圖片在此頁對齊起始儲存格顯示；原檔保留精確位置、裁切與完整繪圖。",
      );
    const view: PriceListWorkbook = {
      id: "",
      fileName: input.fileName,
      importedAt: new Date().toISOString(),
      byteLength: input.bytes.byteLength,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      sheets,
      styles,
      products: products(sheets),
      imageCount: images.size,
      formulaCount,
      warnings,
    };
    return {
      view,
      archive,
      originalBytes: input.bytes.slice(),
      sheetPaths,
      images,
    };
  } catch (error) {
    if (error instanceof PriceListError) throw error;
    throw new PriceListError(
      422,
      "PRICE_LIST_INVALID",
      "這份 Excel 無法安全讀取，請以 Excel 另存為 .xlsx 後再選取。",
    );
  }
}

/** No edits means exact original bytes, including features this viewer does not interpret. */
export function exportPriceListWorkbook(
  workbook: ParsedPriceListWorkbook,
  changes: readonly PriceListCellChange[] = [],
): Uint8Array {
  if (!changes.length) return workbook.originalBytes.slice();
  const archive = { ...workbook.archive };
  const docs = new Map<string, Document>();
  const seen = new Set<string>();
  for (const change of changes) {
    const path = workbook.sheetPaths.get(change.sheetName);
    const key = `${change.sheetName}\0${change.reference}`;
    if (!path || seen.has(key)) fail("輸出儲存格不存在或重複。");
    seen.add(key);
    const coord = coordinate(change.reference);
    if (typeof change.value === "number" && !Number.isFinite(change.value))
      fail("輸出價格不是有效數值。");
    const doc = docs.get(path) ?? xml(archive[path]);
    docs.set(path, doc);
    const cell = elements(doc, "c").find(
      (c) => c.getAttribute("r") === change.reference,
    );
    if (
      !cell ||
      Number(
        cell.parentNode && (cell.parentNode as Element).getAttribute("r"),
      ) !== coord.row
    )
      fail("輸出只允許已存在的儲存格。");
    for (const child of [
      ...children(cell, "f"),
      ...children(cell, "v"),
      ...children(cell, "is"),
    ])
      cell.removeChild(child);
    if (typeof change.value === "string") {
      cell.setAttribute("t", "inlineStr");
      const is = doc.createElementNS(NS, "is");
      const t = doc.createElementNS(NS, "t");
      t.appendChild(doc.createTextNode(change.value));
      is.appendChild(t);
      cell.appendChild(is);
    } else {
      cell.removeAttribute("t");
      if (change.value !== null) {
        const v = doc.createElementNS(NS, "v");
        v.appendChild(doc.createTextNode(String(change.value)));
        cell.appendChild(v);
      }
    }
  }
  for (const [path, doc] of docs)
    archive[path] = strToU8(new XMLSerializer().serializeToString(doc));
  return zipSync(archive);
}

export type PriceListImageReplacement = {
  sheetName: string;
  rowNumber: number;
  bytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg";
};

/** Original columns stay at their exact addresses. Comparison columns are appended,
 * so existing formulas, merges and reference prices never shift or get replaced. */
export function overlayPriceListWorkbook(
  workbook: ParsedPriceListWorkbook,
  rows: readonly PriceListAmazonRow[],
  options: { imageReplacements?: readonly PriceListImageReplacement[]; appendComparisonColumns?: boolean } = {},
): Uint8Array {
  const archive = { ...workbook.archive };
  const serializer = new XMLSerializer();
  const contentTypes = xml(archive["[Content_Types].xml"]);
  const addOverride = (path: string, type: string) => {
    if (
      elements(contentTypes, "Override").some(
        (el) => el.getAttribute("PartName") === `/${path}`,
      )
    )
      return;
    const el = contentTypes.createElementNS(
      contentTypes.documentElement.namespaceURI,
      "Override",
    );
    el.setAttribute("PartName", `/${path}`);
    el.setAttribute("ContentType", type);
    contentTypes.documentElement.appendChild(el);
  };
  const matched = new Map(
    rows.map((row) => [`${row.sheetName}\0${row.rowNumber}`, row]),
  );
  if (matched.size !== rows.length) fail("Amazon 比對資料含重複來源列。");
  const images = new Map(
    (options.imageReplacements ?? []).map((item) => [
      `${item.sheetName}\0${item.rowNumber}`,
      item,
    ]),
  );
  const mediaByDigest = new Map<string, string>();
  for (const sheet of workbook.view.sheets) {
    const products = workbook.view.products.filter(
      (row) => row.sheetName === sheet.name,
    );
    if (!products.length) continue;
    const path = workbook.sheetPaths.get(sheet.name)!;
    const doc = xml(archive[path]);
    const root = doc.documentElement;
    const data = elements(doc, "sheetData")[0];
    if (!data || sheet.columnCount > 122)
      fail("此工作表沒有足夠欄位放入 Amazon 比對。");
    const firstColumn = sheet.columnCount + 1;
    const writeCell = (
      rowNumber: number,
      column: number,
      value: string | number | null,
      styleId: number,
    ) => {
      let rowEl = children(data, "row").find(
        (el) => Number(el.getAttribute("r")) === rowNumber,
      );
      if (!rowEl) {
        rowEl = doc.createElementNS(NS, "row");
        rowEl.setAttribute("r", String(rowNumber));
        data.appendChild(rowEl);
      }
      const cell = doc.createElementNS(NS, "c");
      cell.setAttribute("r", `${priceListColumnName(column)}${rowNumber}`);
      cell.setAttribute("s", String(styleId));
      if (typeof value === "number") {
        const v = doc.createElementNS(NS, "v");
        v.appendChild(doc.createTextNode(String(value)));
        cell.appendChild(v);
      } else if (value !== null) {
        cell.setAttribute("t", "inlineStr");
        const is = doc.createElementNS(NS, "is");
        const t = doc.createElementNS(NS, "t");
        t.setAttribute("xml:space", "preserve");
        t.appendChild(doc.createTextNode(value));
        is.appendChild(t);
        cell.appendChild(is);
      }
      rowEl.appendChild(cell);
    };
    const headers = options.appendComparisonColumns === false ? [] : [
      "Amazon 設定售價 (USD)",
      "Amazon 最低價格設定 (USD)",
      "售價差額 (Amazon − 表上)",
      "最低價格差額 (Amazon − 表上)",
      "核對結果",
      "Amazon 讀取時間",
    ];
    const headerRows = new Set(
      sheet.cells
        .filter((c) => headerKey(c.display) === "code")
        .map((c) => c.row),
    );
    if (!headerRows.size)
      headerRows.add(
        Math.max(1, Math.min(...products.map((p) => p.rowNumber)) - 1),
      );
    for (const headerRow of headerRows)
      headers.forEach((label, i) =>
        writeCell(
          headerRow,
          firstColumn + i,
          label,
          sheet.cells.find((c) => c.row === headerRow)?.styleId ?? 0,
        ),
      );
    for (const product of options.appendComparisonColumns === false ? [] : products) {
      const amazon = matched.get(`${sheet.name}\0${product.rowNumber}`);
      const basePrice = product.cells.standardPrice;
      const baseMinimum = product.cells.minimumPrice;
      const delta = (
        a: number | null | undefined,
        b: PriceListCell | undefined,
      ) => {
        const source = priceListPriceValue(b?.value);
        return a !== null && a !== undefined && source !== null
          ? Number((a - source).toFixed(8))
          : null;
      };
      const min: string | number =
        amazon?.minimumPriceStatus === "set" && amazon.minimumPrice !== null
          ? amazon.minimumPrice
          : amazon?.minimumPriceStatus === "not-set"
            ? "未設定"
            : "未取得";
      const values: (string | number | null)[] = [
        amazon?.standardPrice ?? null,
        min,
        delta(amazon?.standardPrice, basePrice),
        delta(amazon?.minimumPrice, baseMinimum),
        amazon?.message ?? "未讀取 Amazon",
        amazon?.fetchedAt ?? "",
      ];
      values.forEach((value, i) =>
        writeCell(
          product.rowNumber,
          firstColumn + i,
          value,
          basePrice?.styleId ?? 0,
        ),
      );
    }
    let cols = elements(doc, "cols")[0];
    if (!cols) {
      cols = doc.createElementNS(NS, "cols");
      root.insertBefore(cols, data);
    }
    headers.forEach((_, i) => {
      const col = doc.createElementNS(NS, "col");
      col.setAttribute("min", String(firstColumn + i));
      col.setAttribute("max", String(firstColumn + i));
      col.setAttribute("width", i === 4 ? "48" : i === 5 ? "28" : "24");
      col.setAttribute("customWidth", "1");
      cols!.appendChild(col);
    });
    const dimension = elements(doc, "dimension")[0];
    if (headers.length) dimension?.setAttribute(
      "ref",
      `A1:${priceListColumnName(firstColumn + 5)}${sheet.rowCount}`,
    );
    // A drawing anchor also supports ordinary workbooks without Microsoft rich data.
    const replacements = products.flatMap((product) => {
      const item = images.get(`${sheet.name}\0${product.rowNumber}`);
      return item && product.cells.image ? [{ product, item }] : [];
    });
    if (replacements.length) {
      const relNS =
        "http://schemas.openxmlformats.org/package/2006/relationships";
      const officeRel =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
      const relPath = posix.join(
        posix.dirname(path),
        "_rels",
        `${posix.basename(path)}.rels`,
      );
      const relDoc = archive[relPath]
        ? xml(archive[relPath])
        : xml(strToU8(`<Relationships xmlns="${relNS}"/>`));
      const oldDrawing = elements(doc, "drawing")[0];
      let drawingPath = oldDrawing
        ? relations(archive, path).get(oldDrawing.getAttribute("r:id") ?? "")
        : undefined;
      if (!drawingPath) {
        drawingPath = `xl/drawings/price-list-${workbook.view.sheets.indexOf(sheet)}.xml`;
        const rid = `rIdPriceList${workbook.view.sheets.indexOf(sheet)}`;
        if (
          elements(relDoc, "Relationship").some(
            (el) => el.getAttribute("Id") === rid,
          ) ||
          archive[drawingPath]
        )
          fail("價目表已有同名的比對圖片資料，請使用原始範本。");
        const rel = relDoc.createElementNS(relNS, "Relationship");
        rel.setAttribute("Id", rid);
        rel.setAttribute("Type", `${officeRel}/drawing`);
        rel.setAttribute(
          "Target",
          posix.relative(posix.dirname(path), drawingPath),
        );
        relDoc.documentElement.appendChild(rel);
        const drawing = doc.createElementNS(NS, "drawing");
        drawing.setAttributeNS(officeRel, "r:id", rid);
        const before = Array.from(root.childNodes).find(
          (n) =>
            n.nodeType === 1 &&
            [
              "legacyDrawing",
              "legacyDrawingHF",
              "picture",
              "oleObjects",
              "controls",
              "webPublishItems",
              "tableParts",
              "extLst",
            ].includes((n as Element).localName ?? ""),
        );
        root.insertBefore(drawing, before ?? null);
      }
      const xdr =
        "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
      const aNS = "http://schemas.openxmlformats.org/drawingml/2006/main";
      const drawingDoc = archive[drawingPath]
        ? xml(archive[drawingPath])
        : xml(
            strToU8(
              `<xdr:wsDr xmlns:xdr="${xdr}" xmlns:a="${aNS}" xmlns:r="${officeRel}"/>`,
            ),
          );
      const drawingRelPath = posix.join(
        posix.dirname(drawingPath),
        "_rels",
        `${posix.basename(drawingPath)}.rels`,
      );
      const drawingRels = archive[drawingRelPath]
        ? xml(archive[drawingRelPath])
        : xml(strToU8(`<Relationships xmlns="${relNS}"/>`));
      replacements.forEach(({ product, item }, index) => {
        const cell = product.cells.image!;
        const original = elements(doc, "c").find(
          (el) => el.getAttribute("r") === cell.reference,
        );
        if (original) {
          original.removeAttribute("vm");
          original.removeAttribute("t");
          for (const child of [
            ...children(original, "v"),
            ...children(original, "f"),
            ...children(original, "is"),
          ])
            original.removeChild(child);
        }
        if (item.bytes.byteLength > 2 * 1024 * 1024)
          fail("Amazon 首圖資料超過大小限制。");
        const digest = createHash("sha256")
          .update(item.mediaType)
          .update(item.bytes)
          .digest("hex");
        let imagePath = mediaByDigest.get(digest);
        if (!imagePath) {
          imagePath = `xl/media/price-list-amazon-${digest.slice(0, 24)}.${item.mediaType === "image/png" ? "png" : "jpeg"}`;
          if (archive[imagePath])
            fail("價目表已有同名的比對圖片資料，請使用原始範本。");
          mediaByDigest.set(digest, imagePath);
          archive[imagePath] = item.bytes;
          addOverride(imagePath, item.mediaType);
        }
        const imageRel = `rIdPriceListImage${index}`;
        if (
          elements(drawingRels, "Relationship").some(
            (el) => el.getAttribute("Id") === imageRel,
          )
        )
          fail("Amazon 首圖關係重複。");
        const rel = drawingRels.createElementNS(relNS, "Relationship");
        rel.setAttribute("Id", imageRel);
        rel.setAttribute("Type", `${officeRel}/image`);
        rel.setAttribute(
          "Target",
          posix.relative(posix.dirname(drawingPath!), imagePath),
        );
        drawingRels.documentElement.appendChild(rel);
        for (const anchor of [
          ...elements(drawingDoc, "oneCellAnchor"),
          ...elements(drawingDoc, "twoCellAnchor"),
        ]) {
          const from = children(anchor, "from")[0];
          if (
            from &&
            elements(anchor, "pic").length &&
            Number(children(from, "row")[0]?.textContent) ===
              product.rowNumber - 1 &&
            Number(children(from, "col")[0]?.textContent) === cell.column - 1
          )
            anchor.parentNode?.removeChild(anchor);
        }
        const bounds = {
          width: Math.max(20, (sheet.columnWidths[cell.column] ?? 90) - 8),
          height: Math.max(20, (sheet.rowHeights[product.rowNumber] ?? 60) - 8),
        };
        const dimensions = imageDimensions(item.bytes);
        const scale = Math.min(
          bounds.width / dimensions.width,
          bounds.height / dimensions.height,
        );
        const width = Math.round(dimensions.width * scale * 9_525);
        const height = Math.round(dimensions.height * scale * 9_525);
        const maxId = Math.max(
          0,
          ...elements(drawingDoc, "cNvPr").map(
            (el) => Number(el.getAttribute("id")) || 0,
          ),
        );
        const anchor = xml(
          strToU8(
            `<xdr:oneCellAnchor xmlns:xdr="${xdr}" xmlns:a="${aNS}" xmlns:r="${officeRel}"><xdr:from><xdr:col>${cell.column - 1}</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>${product.rowNumber - 1}</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from><xdr:ext cx="${width}" cy="${height}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${maxId + 1}" name="Amazon main image ${index + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${imageRel}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`,
          ),
        );
        drawingDoc.documentElement.appendChild(
          drawingDoc.importNode(anchor.documentElement, true),
        );
      });
      archive[relPath] = strToU8(serializer.serializeToString(relDoc));
      archive[drawingPath] = strToU8(serializer.serializeToString(drawingDoc));
      archive[drawingRelPath] = strToU8(
        serializer.serializeToString(drawingRels),
      );
      addOverride(
        drawingPath,
        "application/vnd.openxmlformats-officedocument.drawing+xml",
      );
    }
    archive[path] = strToU8(serializer.serializeToString(doc));
  }
  // Rich image metadata and its binaries remain intact: preserving dormant native
  // workbook data is safer than deleting shared image parts used on another sheet.
  archive["[Content_Types].xml"] = strToU8(
    serializer.serializeToString(contentTypes),
  );
  return zipSync(archive);
}

/** Reused by generated workbooks to isolate unavailable image bytes per row. */
export function validatePriceListImageReplacement(
  image: Pick<PriceListImageReplacement, "bytes" | "mediaType">,
): void {
  const png = image.bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => image.bytes[index] === byte);
  const jpeg = image.bytes[0] === 255 && image.bytes[1] === 216;
  if (image.bytes.byteLength > 2 * 1024 * 1024 ||
      (image.mediaType === "image/png" ? !png : !jpeg))
    fail("Amazon 首圖資料無法安全辨識。");
  imageDimensions(image.bytes);
}

function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    )
  ) {
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0 && width * height <= 40_000_000)
      return { width, height };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 8 < bytes.byteLength; ) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.byteLength) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        const height = view.getUint16(offset + 5);
        const width = view.getUint16(offset + 7);
        if (width > 0 && height > 0 && width * height <= 40_000_000)
          return { width, height };
      }
      offset += length + 2;
    }
  }
  fail("Amazon 首圖尺寸無法安全辨識。");
}

function validateImportedImage(bytes: Uint8Array): void {
  if (bytes.byteLength > 5 * 1024 * 1024)
    fail("價目表的單張圖片超過 5 MB。", 413);
  try {
    imageDimensions(bytes);
  } catch {
    fail("價目表含有無效圖片或圖片像素超過 4,000 萬。", 413);
  }
}
