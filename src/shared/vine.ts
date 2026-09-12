export const VINE_CSV_HEADERS = ["enrollmentDate", "sellerSku", "asin", "enrolled", "claimed", "reviews", "status"] as const;
export const VINE_CSV_TEMPLATE = `${VINE_CSV_HEADERS.join(",")}\r\n`;
export type VineEnrollment = {
  enrollmentDate: string;
  sellerSku: string | null;
  asin: string;
  title: string | null;
  status: "active" | "ended" | "unknown";
  statusText: string | null;
  enrolled: number;
  claimed: number | null;
  reviews: number | null;
};
export type VineRecord = VineEnrollment & { importedAt: string };
export type VineRejection = { line: number; message: string };
export type VineImportPreview = { rows: { value: VineEnrollment; line: number }[]; rejected: VineRejection[] };
export type VineSnapshot = {
  schemaVersion: 2;
  marketplaceId: "ATVPDKIKX0DER";
  source: "seller-central-manual";
  storage: "encrypted-local" | "session-only";
  storageNotice: string;
  asOfDate: string;
  unconfirmedCount: number;
  rows: VineRecord[];
  updatedAt: string | null;
  importResult?: { accepted: number; rejected: VineRejection[] };
};
export class VineInputError extends Error {}
const keys = new Set<string>(VINE_CSV_HEADERS);
const aliases: Record<string, string> = { 註冊日期: "enrollmentDate", 登記日期: "enrollmentDate", "Seller SKU": "sellerSku", SKU: "sellerSku", ASIN: "asin", 登記名額: "enrolled", 已註冊: "enrolled", 已領取: "claimed", 已申報: "claimed", 已評論: "reviews", "Amazon Vine 評論": "reviews", 狀態: "status" };
const forbidden = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u;
const shortText = (value: unknown, maximum: number): value is string => typeof value === "string" && !!value && value === value.trim() && value.length <= maximum && !forbidden.test(value);
export function validVineDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validVineEnrollment(value: unknown, today: string): value is VineEnrollment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as VineEnrollment;
  return validVineDate(row.enrollmentDate) && row.enrollmentDate >= "2007-01-01" && row.enrollmentDate <= today &&
    (row.sellerSku === null || shortText(row.sellerSku, 40)) &&
    typeof row.asin === "string" && /^[A-Z0-9]{10}$/u.test(row.asin) &&
    (row.title === null || shortText(row.title, 1_000)) &&
    (["active", "ended"].includes(row.status) ? shortText(row.statusText, 200) : row.status === "unknown" && row.statusText === null) &&
    Number.isSafeInteger(row.enrolled) && row.enrolled >= 1 && row.enrolled <= 30 &&
    [row.claimed, row.reviews].every((count) => count === null || (Number.isSafeInteger(count) && count >= 0 && count <= row.enrolled));
}
/** Identity is the enrollment, independent of a seller's optional SKU. */
export const vineEnrollmentKey = (row: Pick<VineEnrollment, "asin" | "enrollmentDate">): string => JSON.stringify([row.asin, row.enrollmentDate]);
function delimited(text: string): { cells: string[]; line: number }[] {
  const separator = text.slice(0, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n")).includes("\t") ? "\t" : ",";
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [], field = "", quoted = false, endedQuote = false, line = 1, rowLine = 1;
  for (let i = 0; i <= text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (character === '"') { quoted = false; endedQuote = true; }
      else if (character === undefined) throw new VineInputError("CSV 引號未結束，請重新匯出或貼上完整資料。");
      else { field += character; if (character === "\n") line++; }
      continue;
    }
    if (character === separator || character === "\n" || character === "\r" || character === undefined) {
      cells.push(field); field = ""; endedQuote = false;
      if (character === separator) continue;
      if (cells.some((value) => value !== "")) rows.push({ cells, line: rowLine });
      cells = [];
      if (character === "\r" && text[i + 1] === "\n") i++;
      line++; rowLine = line;
      if (rows.length > 1_001) throw new VineInputError("一次最多匯入 1,000 列 Vine 資料。");
    } else if (character === '"' && !field && !endedQuote) quoted = true;
    else {
      if (endedQuote || character === '"') throw new VineInputError("CSV 引號格式無效。");
      field += character;
    }
  }
  return rows;
}
function statusOf(parts: string[]): "active" | "ended" | null {
  if (parts.length === 1 && ["已結束", "已取消", "ended", "cancelled", "canceled"].includes(parts[0])) return "ended";
  const active = new Set(["正在等待評論", "等待處理", "active"]);
  const qualifier = (part: string) => part === "預發佈" || /^正在等待庫存 \(\d{1,2}\)$/u.test(part);
  return parts.some((part) => active.has(part)) && parts.every((part) => active.has(part) || qualifier(part)) ? "active" : null;
}
function uniqueRows(result: VineImportPreview): VineImportPreview {
  const seen = new Map<string, number[]>();
  for (const { value, line } of result.rows) {
    const key = vineEnrollmentKey(value);
    seen.set(key, [...(seen.get(key) ?? []), line]);
  }
  const duplicates = new Set([...seen.values()].filter((lines) => lines.length > 1).flat());
  for (const line of duplicates) result.rejected.push({ line, message: "同一 ASIN／報名日期出現多列，請保留一份最新進度。" });
  return { rows: result.rows.filter((row) => !duplicates.has(row.line)), rejected: result.rejected.sort((a, b) => a.line - b.line) };
}
function parseDelimited(text: string, today: string): VineImportPreview {
  const parsed = delimited(text);
  const headers = parsed.shift()?.cells.map((header) => aliases[header] ?? header) ?? [];
  const legacy = headers.length === keys.size - 1 && !headers.includes("status");
  if ((!legacy && headers.length !== keys.size) || new Set(headers).size !== headers.length || headers.some((header) => !keys.has(header))) throw new VineInputError("請直接貼上含欄位標題的 Seller Central Vine 整頁內容；CSV 需包含 status 狀態欄位。");
  const result: VineImportPreview = { rows: [], rejected: [] };
  for (const { cells, line } of parsed) {
    if (legacy) { result.rejected.push({ line, message: "缺少明確狀態，無法確認是否仍進行中；請重新貼上 Seller Central Vine 整頁內容。" }); continue; }
    const raw = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    const count = (value: string | undefined): number | null => value === "" ? null : typeof value === "string" && /^\d{1,2}$/u.test(value) ? Number(value) : Number.NaN;
    const status = statusOf([raw.status]);
    const value = { enrollmentDate: raw.enrollmentDate, sellerSku: raw.sellerSku || null, asin: raw.asin, title: null, status, statusText: raw.status, enrolled: count(raw.enrolled), claimed: count(raw.claimed), reviews: count(raw.reviews) };
    if (cells.length !== headers.length || !validVineEnrollment(value, today)) {
      result.rejected.push({ line, message: "請核對明確狀態、報名日期、ASIN 及數量；報名限 1–30，領取／評論可空白，數量不可超過報名數。" });
    } else result.rows.push({ value, line });
  }
  return uniqueRows(result);
}
const pageHeaders = ["產品名稱", "ASIN", "狀態", "註冊日期", "產品網站上線日期", "可用", "已註冊", "已申報", "Amazon Vine 評論"];
type PageCell = { text: string; line: number };
function calendarDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(value);
  const date = match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : value;
  return validVineDate(date) ? date : null;
}
function pageCount(value: string | undefined): number | null {
  if (value === "—" || value === "–" || value === "-") return null;
  if (typeof value !== "string" || !/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)$/u.test(value)) return Number.NaN;
  const count = Number(value.replaceAll(",", ""));
  return Number.isSafeInteger(count) && count >= 0 ? count : Number.NaN;
}
function parsePage(text: string, today: string): VineImportPreview {
  const cells: PageCell[] = text.split(/\r?\n/u).flatMap((line, index) => line.split("\t").map((cell) => ({ text: cell.trim(), line: index + 1 })))
    .filter((cell) => cell.text && !/^[\ue000-\uf8ff]+$/u.test(cell.text));
  const headerStart = cells.findIndex((cell, start) => cell.text === pageHeaders[0] && pageHeaders.every((header, index) => cells[start + index]?.text === header));
  if (headerStart < 0) throw new VineInputError("找不到完整的 Vine 欄位標題；請從 Seller Central Vine 頁面全選並複製，保留狀態、兩個日期與數量欄位。");
  const content = cells.slice(headerStart + pageHeaders.length);
  const starts = content.flatMap((cell, index) => cell.text === "產品圖片" ? [index] : []);
  if (!starts.length) throw new VineInputError("未辨識到 Vine 商品列；請複製包含商品資料的整頁內容。");
  if (starts.length > 1_000) throw new VineInputError("一次最多匯入 1,000 列 Vine 資料。");
  if (starts[0] !== 0) throw new VineInputError("第一列商品資料不完整，請重新複製整頁內容。");
  const result: VineImportPreview = { rows: [], rejected: [] };
  starts.forEach((start, index) => {
    const block = content.slice(start + 1, starts[index + 1] ?? content.length);
    const line = content[start].line;
    const reject = (message: string) => result.rejected.push({ line, message });
    const asinPositions = block.flatMap((cell, position) => /^[A-Z0-9]{10}$/u.test(cell.text) ? [position] : []);
    const asinIndex = asinPositions[0];
    if (asinPositions.length !== 1 || asinIndex < 1) { reject("商品名稱或 ASIN 無法唯一辨識；此列未保存，請重新複製完整商品列。"); return; }
    const afterAsin = block.slice(asinIndex + 1);
    const dateIndex = afterAsin.findIndex((cell) => calendarDate(cell.text) !== null);
    if (dateIndex < 1) { reject("缺少明確狀態或報名日期；此列未保存。"); return; }
    const statuses = afterAsin.slice(0, dateIndex).map((cell) => cell.text);
    const status = statusOf(statuses);
    if (!status) { reject("無法確認商品狀態是否進行中或已結束；請核對原頁面，此列未保存。"); return; }
    const values = afterAsin.slice(dateIndex);
    const available = pageCount(values[2]?.text);
    const value = {
      title: block.slice(0, asinIndex).map((cell) => cell.text).join(" "), sellerSku: null,
      asin: block[asinIndex].text, status, statusText: statuses.join(" · "),
      enrollmentDate: calendarDate(values[0]?.text ?? ""),
      enrolled: pageCount(values[3]?.text), claimed: pageCount(values[4]?.text), reviews: pageCount(values[5]?.text),
    };
    // The detail boundary rejects truncated or shifted numeric columns.
    // Available date/inventory are never used as enrollment progress.
    if (!calendarDate(values[1]?.text ?? "") || (available !== null && !Number.isFinite(available)) || values[6]?.text !== "詳情" || !validVineEnrollment(value, today)) {
      reject("商品列欄位不完整或數量無效；需保留兩個日期、可用／已註冊／已申報／Vine 評論四欄，此列未保存。"); return;
    }
    result.rows.push({ value, line });
  });
  return uniqueRows(result);
}
/** Only explicit source statuses classify enrollments. Missing/malformed rows never remove saved evidence. */
export function parseVineImport(text: string, today: string): VineImportPreview {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 512 * 1024) throw new VineInputError("請貼上 512 KB 以下的 Seller Central Vine 頁面內容。");
  const clean = text.replace(/^\ufeff/u, "");
  return /(?:^|[\n\t])\s*產品名稱\s*(?:[\n\t]|$)/u.test(clean) || clean.includes("產品圖片") ? parsePage(clean, today) : parseDelimited(clean, today);
}
export function isVineSnapshot(value: unknown): value is VineSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as VineSnapshot;
  if (data.schemaVersion !== 2 || data.marketplaceId !== "ATVPDKIKX0DER" || data.source !== "seller-central-manual" || !["encrypted-local", "session-only"].includes(data.storage) || typeof data.storageNotice !== "string" || data.storageNotice.length > 500 || !validVineDate(data.asOfDate) || !Number.isSafeInteger(data.unconfirmedCount) || data.unconfirmedCount < 0 || data.unconfirmedCount > 1_000 || !Array.isArray(data.rows) || data.rows.length > 1_000) return false;
  if (data.updatedAt !== null && (typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt)))) return false;
  if (!data.rows.every((row) => validVineEnrollment(row, data.asOfDate) && row.status === "active" && typeof row.importedAt === "string" && Number.isFinite(Date.parse(row.importedAt)))) return false;
  if (new Set(data.rows.map(vineEnrollmentKey)).size !== data.rows.length) return false;
  return data.importResult === undefined || (data.importResult !== null && Number.isSafeInteger(data.importResult.accepted) && data.importResult.accepted >= 0 && data.importResult.accepted <= 1_000 && Array.isArray(data.importResult.rejected) && data.importResult.rejected.length <= 1_000 && data.importResult.rejected.every((row) => Number.isSafeInteger(row.line) && row.line >= 1 && typeof row.message === "string" && row.message.length <= 500));
}
