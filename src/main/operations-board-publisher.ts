import { marketplaceById } from "../shared/marketplaces";
import type { OperationsBoardPublisherDraft } from "../shared/operations-board";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const FORBIDDEN_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

function boundedText(
  value: unknown,
  maximum: number,
  label: string,
  required = false,
): string {
  if (typeof value !== "string") throw new TypeError(`${label}格式無效。`);
  const clean = value.trim();
  if ((required && !clean) || clean.length > maximum || FORBIDDEN_TEXT.test(clean)) {
    throw new TypeError(`${label}格式無效或超過長度上限。`);
  }
  return clean;
}

function boundedNote(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label}格式無效。`);
  const clean = value.replace(/\r\n?/gu, "\n").trim();
  if (
    clean.length > 500 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u
      .test(clean)
  ) {
    throw new TypeError(`${label}格式無效或超過長度上限。`);
  }
  return clean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value);
  if (
    actual.some((key) => !expected.includes(key)) ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new TypeError("公布欄草稿格式無效。");
  }
}

function calendarDate(value: unknown, label: string): string {
  const clean = boundedText(value, 10, label, true);
  const match = DATE_PATTERN.exec(clean);
  if (!match) throw new TypeError(`${label}必須使用 YYYY-MM-DD。`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`${label}日期不存在。`);
  }
  return clean;
}

export function parseOperationsBoardPublisherDraft(
  input: unknown,
): OperationsBoardPublisherDraft {
  if (!isRecord(input)) throw new TypeError("公布欄草稿格式無效。");
  if (input.type === "promotion") {
    const legacy = Object.prototype.hasOwnProperty.call(input, "date");
    exactKeys(
      input,
      legacy
        ? ["type", "date", "title", "note", "countdown"]
        : ["type", "startDate", "endDate", "title", "note", "countdown"],
    );
    if (typeof input.countdown !== "boolean") {
      throw new TypeError("首頁倒數格式無效。");
    }
    const startDate = calendarDate(legacy ? input.date : input.startDate, "促銷開始日");
    const endDate = calendarDate(legacy ? input.date : input.endDate, "促銷結束日");
    if (endDate < startDate) throw new TypeError("促銷結束日不可早於開始日。");
    const draft: OperationsBoardPublisherDraft = {
      type: "promotion",
      startDate,
      endDate,
      title: boundedText(input.title, 120, "促銷名稱", true),
      note: boundedNote(input.note, "備註"),
      countdown: input.countdown,
    };
    return draft;
  }
  if (input.type !== "expiry") throw new TypeError("公布欄草稿類型無效。");
  const hasStopSaleDate = Object.prototype.hasOwnProperty.call(input, "stopSaleDate");
  exactKeys(
    input,
    hasStopSaleDate
      ? ["type", "marketplaceId", "sellerSku", "expiryDate", "stopSaleDate", "note"]
      : ["type", "marketplaceId", "sellerSku", "expiryDate", "note"],
  );
  const marketplaceId = boundedText(input.marketplaceId, 32, "Amazon 站點", true);
  if (!marketplaceById(marketplaceId)) throw new TypeError("Amazon 站點無效。");
  const expiryDate = calendarDate(input.expiryDate, "人工效期");
  const stopSaleDate = hasStopSaleDate && input.stopSaleDate !== null
    ? calendarDate(input.stopSaleDate, "停售日")
    : null;
  if (stopSaleDate && stopSaleDate > expiryDate) {
    throw new TypeError("停售日不可晚於效期。");
  }
  return {
    type: "expiry",
    marketplaceId,
    sellerSku: boundedText(input.sellerSku, 40, "Seller SKU", true),
    expiryDate,
    stopSaleDate,
    note: boundedNote(input.note, "備註"),
  };
}

export function operationsBoardManagementItemId(itemId: unknown): string {
  const clean = boundedText(itemId, 36, "公布欄項目 ID", true);
  if (!UUID_PATTERN.test(clean)) {
    throw new TypeError("公布欄項目 ID 格式無效。");
  }
  return clean;
}
