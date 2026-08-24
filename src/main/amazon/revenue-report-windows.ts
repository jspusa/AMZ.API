import type { MarketplaceId } from "../../shared/marketplaces";
import {
  FbaSalesPlanningError,
  planFbaSalesTrend,
} from "./fba-sales-calendar";
import { marketplaceCalendar } from "./marketplace-calendar";
import { SpApiError } from "./sp-api-error";

const STRICT_REPORT_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u;

export type FbaShipmentSalesWindow = Readonly<{
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  dataStartTime: string;
  dataEndTime: string;
  windowCreatedAt: number;
  rangeFreshness: "complete-days" | "includes-current-day";
}>;

function invalidSalesTrendRange(message: string): never {
  throw new SpApiError(message, {
    status: 400,
    code: "INVALID_SALES_TREND_RANGE",
  });
}

function planWindowOrThrow(
  input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
  }>,
  now: Date,
) {
  try {
    return planFbaSalesTrend(input, now).window;
  } catch (error) {
    if (error instanceof FbaSalesPlanningError) {
      invalidSalesTrendRange(error.message);
    }
    throw error;
  }
}

function validCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

/**
 * Accepts Amazon's date-only or fully-zoned report timestamps and returns the
 * exact calendar-date prefix. Partial timestamps and impossible dates fail
 * closed instead of being compared by prefix.
 */
export function strictReportDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return validCalendarDate(value) ? value : null;
  }
  const match = STRICT_REPORT_DATE_TIME.exec(value);
  if (!match || !validCalendarDate(match[1])) return null;
  const offset = match[2];
  if (
    offset !== "Z" &&
    offset.slice(1, 3) === "14" &&
    offset.slice(4) !== "00"
  ) {
    return null;
  }
  return Number.isFinite(Date.parse(value)) ? match[1] : null;
}

export function strictReportInstant(value: unknown): number | null {
  if (typeof value !== "string" || !STRICT_REPORT_DATE_TIME.test(value)) {
    return null;
  }
  if (!strictReportDateKey(value)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

export function planFbaShipmentSalesWindow(input: Readonly<{
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  now?: Date;
}>): FbaShipmentSalesWindow {
  const created = input.now ?? new Date();
  const windowCreatedAt = created.getTime();
  if (!Number.isSafeInteger(windowCreatedAt) || windowCreatedAt < 0) {
    invalidSalesTrendRange("銷售趨勢日期範圍無效。");
  }
  const planned = planWindowOrThrow(input, created);
  const currentDay = marketplaceCalendar(input.marketplaceId).dayAt(created);
  return Object.freeze({
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
    dataStartTime: planned.startAt,
    dataEndTime: planned.endAt,
    windowCreatedAt,
    rangeFreshness: input.endDate === currentDay
      ? "includes-current-day"
      : "complete-days",
  });
}

export function assertFbaShipmentSalesWindow(
  input: Readonly<
    Omit<FbaShipmentSalesWindow, "rangeFreshness"> &
    Partial<Pick<FbaShipmentSalesWindow, "rangeFreshness">>
  >,
  currentTime = Date.now(),
): FbaShipmentSalesWindow {
  const invalid = (): never => {
    throw new SpApiError("FBA 品牌出貨報表的固定查詢時間無效。", {
      status: 400,
      code: "INVALID_DATE_RANGE",
    });
  };
  const startTime = strictReportInstant(input.dataStartTime);
  const endTime = strictReportInstant(input.dataEndTime);
  if (
    startTime === null ||
    endTime === null ||
    !Number.isSafeInteger(input.windowCreatedAt) ||
    input.windowCreatedAt < 0 ||
    input.windowCreatedAt > currentTime + 1_000
  ) {
    return invalid();
  }
  let expected: FbaShipmentSalesWindow;
  try {
    expected = planFbaShipmentSalesWindow({
      marketplaceId: input.marketplaceId,
      startDate: input.startDate,
      endDate: input.endDate,
      now: new Date(input.windowCreatedAt),
    });
  } catch {
    return invalid();
  }
  if (
    startTime !== Date.parse(expected.dataStartTime) ||
    endTime !== Date.parse(expected.dataEndTime) ||
    endTime <= startTime ||
    (input.rangeFreshness !== undefined &&
      input.rangeFreshness !== expected.rangeFreshness)
  ) {
    return invalid();
  }
  return Object.freeze({ ...input, rangeFreshness: expected.rangeFreshness });
}

export function fbaShipmentSalesDateKey(
  value: string,
  marketplaceId: MarketplaceId,
): string {
  const dateKey = strictReportDateKey(value);
  if (!dateKey) {
    throw new SpApiError("Amazon FBA 出貨報表含有無法安全辨識的出貨日期。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return dateKey;
  return marketplaceCalendar(marketplaceId).dayAt(new Date(value));
}

export function assertSalesAndTrafficDateSelection(input: Readonly<{
  marketplaceId: MarketplaceId;
  startDate: unknown;
  endDate: unknown;
}>): Readonly<{ startDate: string; endDate: string }> {
  const startDate = strictReportDateKey(input.startDate);
  const endDate = strictReportDateKey(input.endDate);
  if (
    typeof input.startDate !== "string" ||
    typeof input.endDate !== "string" ||
    startDate !== input.startDate ||
    endDate !== input.endDate
  ) {
    throw new SpApiError("請提供有效的廣告策略開始日與結束日。", {
      status: 400,
      code: "ADS_STRATEGY_DATE_INVALID",
    });
  }
  const calendar = marketplaceCalendar(input.marketplaceId);
  const inclusiveDays = calendar.inclusiveDayCount(startDate, endDate);
  if (
    startDate > endDate ||
    inclusiveDays < 1 ||
    inclusiveDays > 31
  ) {
    throw new SpApiError(
      "廣告策略一次只能讀取最近 95 天內的 1 到 31 個完整日，結束日最多到站點昨天。",
      { status: 400, code: "ADS_STRATEGY_DATE_INVALID" },
    );
  }
  return Object.freeze({ startDate, endDate });
}

export function planCompletedSalesAndTrafficWindow(input: Readonly<{
  marketplaceId: MarketplaceId;
  startDate: unknown;
  endDate: unknown;
  now?: Date;
}>): Readonly<{ startDate: string; endDate: string }> {
  const { startDate, endDate } = assertSalesAndTrafficDateSelection(input);
  const calendar = marketplaceCalendar(input.marketplaceId);
  const today = calendar.dayAt(input.now ?? new Date());
  const latest = calendar.shiftDate(today, -1);
  const earliest = calendar.shiftDate(latest, -94);
  if (
    endDate > latest ||
    startDate < earliest
  ) {
    throw new SpApiError(
      "廣告策略一次只能讀取最近 95 天內的 1 到 31 個完整日，結束日最多到站點昨天。",
      { status: 400, code: "ADS_STRATEGY_DATE_INVALID" },
    );
  }
  return Object.freeze({ startDate, endDate });
}
