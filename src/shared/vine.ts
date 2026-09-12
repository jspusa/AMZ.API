export const VINE_CSV_HEADERS = ["enrollmentDate", "sellerSku", "asin", "enrolled", "claimed", "reviews"] as const;
export const VINE_CSV_TEMPLATE = `${VINE_CSV_HEADERS.join(",")}\r\n`;
export type VineEnrollment = {
  enrollmentDate: string;
  sellerSku: string;
  asin: string;
  enrolled: number;
  claimed: number | null;
  reviews: number | null;
};
export type VineRecord = VineEnrollment & { importedAt: string };
export type VineRejection = { line: number; message: string };
export type VineSnapshot = {
  schemaVersion: 1;
  marketplaceId: "ATVPDKIKX0DER";
  source: "seller-central-manual";
  storage: "encrypted-local" | "session-only";
  storageNotice: string;
  window: { startDate: string; endDate: string };
  rows: VineRecord[];
  updatedAt: string | null;
  importResult?: { accepted: number; rejected: VineRejection[] };
};
export class VineInputError extends Error {}
const keys = new Set<string>(VINE_CSV_HEADERS);
const aliases: Record<string, string> = { 註冊日期: "enrollmentDate", 登記日期: "enrollmentDate", "Seller SKU": "sellerSku", SKU: "sellerSku", ASIN: "asin", 登記名額: "enrolled", 已領取: "claimed", 已評論: "reviews" };
const forbidden = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u;
export function validVineDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validVineEnrollment(value: unknown, today: string): value is VineEnrollment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as VineEnrollment;
  return validVineDate(row.enrollmentDate) && row.enrollmentDate >= "2007-01-01" && row.enrollmentDate <= today &&
    typeof row.sellerSku === "string" && !!row.sellerSku && row.sellerSku === row.sellerSku.trim() && row.sellerSku.length <= 40 && !forbidden.test(row.sellerSku) &&
    typeof row.asin === "string" && /^[A-Z0-9]{10}$/u.test(row.asin) &&
    Number.isSafeInteger(row.enrolled) && row.enrolled >= 1 && row.enrolled <= 30 &&
    [row.claimed, row.reviews].every((count) => count === null || (Number.isSafeInteger(count) && count >= 0 && count <= row.enrolled));
}
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
/** Parses only the six explicitly documented manual Vine fields; unknown values never become zero. */
export function parseVineImport(text: string, today: string): { rows: { value: VineEnrollment; line: number }[]; rejected: VineRejection[] } {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 512 * 1024) throw new VineInputError("請選擇 512 KB 以下的 CSV／TSV，或貼上對應欄位。");
  const parsed = delimited(text.replace(/^\ufeff/u, ""));
  const headers = parsed.shift()?.cells.map((header) => aliases[header] ?? header) ?? [];
  if (headers.length !== keys.size || new Set(headers).size !== keys.size || headers.some((header) => !keys.has(header))) throw new VineInputError("欄位需為 enrollmentDate,sellerSku,asin,enrolled,claimed,reviews；可下載空白欄位範例。");
  const rows: { value: VineEnrollment; line: number }[] = [], rejected: VineRejection[] = [];
  const encountered = new Map<string, number[]>();
  for (const { cells, line } of parsed) {
    const raw = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    const count = (value: string | undefined): number | null => value === "" ? null : typeof value === "string" && /^\d{1,2}$/u.test(value) ? Number(value) : Number.NaN;
    const value = { enrollmentDate: raw.enrollmentDate, sellerSku: raw.sellerSku, asin: raw.asin, enrolled: count(raw.enrolled), claimed: count(raw.claimed), reviews: count(raw.reviews) };
    if (cells.length !== headers.length || !validVineEnrollment(value, today)) {
      rejected.push({ line, message: "請核對日期、exact Seller SKU／ASIN 及數量；名額限 1–30，領取／評論可空白，數量不可超過名額。" });
      continue;
    }
    const key = JSON.stringify([value.sellerSku, value.asin, value.enrollmentDate]);
    encountered.set(key, [...(encountered.get(key) ?? []), line]);
    rows.push({ value, line });
  }
  const duplicates = new Set([...encountered.values()].filter((lines) => lines.length > 1).flat());
  for (const line of duplicates) rejected.push({ line, message: "同一 Seller SKU／ASIN／登記日出現多列，請保留一份最新進度。" });
  return { rows: rows.filter((row) => !duplicates.has(row.line)), rejected: rejected.sort((a, b) => a.line - b.line) };
}

export function isVineSnapshot(value: unknown): value is VineSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as VineSnapshot;
  if (data.schemaVersion !== 1 || data.marketplaceId !== "ATVPDKIKX0DER" || data.source !== "seller-central-manual" || !["encrypted-local", "session-only"].includes(data.storage) || typeof data.storageNotice !== "string" || data.storageNotice.length > 500 || !data.window || !validVineDate(data.window.startDate) || !validVineDate(data.window.endDate) || Date.parse(data.window.endDate) - Date.parse(data.window.startDate) !== 59 * 86_400_000 || !Array.isArray(data.rows) || data.rows.length > 1_000) return false;
  if (data.updatedAt !== null && (typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt)))) return false;
  if (!data.rows.every((row) => validVineEnrollment(row, data.window.endDate) && row.enrollmentDate >= data.window.startDate && typeof row.importedAt === "string" && Number.isFinite(Date.parse(row.importedAt)))) return false;
  return data.importResult === undefined || (data.importResult !== null && Number.isSafeInteger(data.importResult.accepted) && data.importResult.accepted >= 0 && data.importResult.accepted <= 1_000 && Array.isArray(data.importResult.rejected) && data.importResult.rejected.length <= 1_000 && data.importResult.rejected.every((row) => Number.isSafeInteger(row.line) && row.line >= 2 && typeof row.message === "string" && row.message.length <= 500));
}
