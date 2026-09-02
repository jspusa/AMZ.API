import { marketplaceById } from "../shared/marketplaces";
import type { OperationsBoardPublisherDraft } from "../shared/operations-board";

const OPERATIONS_BOARD_ISSUE_URL =
  "https://github.com/jspusa/AMZ.API/issues/new";
const SOURCE_ITEM_ID_PATTERN =
  /^00000000-0000-4000-8000-(\d{12})$/u;
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

function issueFormMarketplaceLabel(marketplaceId: string): string {
  const marketplace = marketplaceById(marketplaceId);
  if (!marketplace) throw new TypeError("Amazon 站點無效。");
  return `Amazon ${marketplace.label.replace(/站$/u, "")} — ${marketplace.id}`;
}

export function operationsBoardPublisherUrl(
  input: unknown,
): string {
  if (!isRecord(input)) throw new TypeError("公布欄草稿格式無效。");
  const url = new URL(OPERATIONS_BOARD_ISSUE_URL);
  if (input.type === "promotion") {
    exactKeys(input, ["type", "date", "title", "note", "countdown"]);
    if (typeof input.countdown !== "boolean") {
      throw new TypeError("首頁倒數格式無效。");
    }
    const draft: OperationsBoardPublisherDraft = {
      type: "promotion",
      date: calendarDate(input.date, "檔期日期"),
      title: boundedText(input.title, 120, "促銷名稱", true),
      note: boundedText(input.note, 500, "備註"),
      countdown: input.countdown,
    };
    url.searchParams.set("template", "operations-board-promotion.yml");
    url.searchParams.set("title", `[公布欄｜促銷] ${draft.title}`);
    url.searchParams.set("promotion-date", draft.date);
    url.searchParams.set("promotion-title", draft.title);
    url.searchParams.set("note", draft.note);
    url.searchParams.set(
      "countdown",
      draft.countdown ? "需要顯示倒數" : "只顯示在月曆",
    );
    return url.toString();
  }
  if (input.type !== "expiry") throw new TypeError("公布欄草稿類型無效。");
  exactKeys(input, ["type", "marketplaceId", "sellerSku", "expiryDate", "note"]);
  const draft: OperationsBoardPublisherDraft = {
    type: "expiry",
    marketplaceId: boundedText(input.marketplaceId, 32, "Amazon 站點", true),
    sellerSku: boundedText(input.sellerSku, 40, "Seller SKU", true),
    expiryDate: calendarDate(input.expiryDate, "人工效期"),
    note: boundedText(input.note, 500, "備註"),
  };
  url.searchParams.set("template", "operations-board-expiry.yml");
  url.searchParams.set("title", `[公布欄｜即期] ${draft.sellerSku}`);
  url.searchParams.set(
    "marketplace",
    issueFormMarketplaceLabel(draft.marketplaceId),
  );
  url.searchParams.set("seller-sku", draft.sellerSku);
  url.searchParams.set("expiry-date", draft.expiryDate);
  url.searchParams.set("note", draft.note);
  return url.toString();
}

export function operationsBoardAnnouncementUrl(itemId: unknown): string {
  const clean = boundedText(itemId, 36, "公告來源", true);
  const match = SOURCE_ITEM_ID_PATTERN.exec(clean);
  const number = Number(match?.[1] ?? 0);
  if (!match || !Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError("這筆舊公告沒有 GitHub 來源；請重新建立後再管理。");
  }
  return `https://github.com/jspusa/AMZ.API/issues/${number}`;
}
