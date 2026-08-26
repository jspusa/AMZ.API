import type { MarketplaceId } from "../../shared/marketplaces";
import {
  marketplaceCalendar,
  type MarketplaceCalendar,
} from "./marketplace-calendar";

export type SalesTrendPresetDays = 7 | 14 | 30 | 90;
export type SalesTrendComparisonMode = "none" | "previous-year";

export const MAX_SALES_TREND_DAY_COUNT = 365;
export const FBA_SALES_VELOCITY_COMPLETED_DAY_COUNT = 30 as const;

export type SalesTrendRange = {
  startDate: string;
  endDate: string;
  dayCount: number;
  presetDays: SalesTrendPresetDays | null;
};

export type SalesTrendWindow = {
  timeZone: string;
  range: SalesTrendRange;
  startAt: string;
  endAt: string;
  dateKeys: string[];
  intervals: string[];
  partialDateKey: string | null;
};

export type FbaSalesTrendPlan = {
  range: SalesTrendRange;
  window: SalesTrendWindow;
  comparisonWindow: SalesTrendWindow | null;
  comparablePreviousYearDateKeys: string[] | null;
  comparisonNotice: string | null;
};

export type CompletedFbaSalesVelocityPlan = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  completedDayCount: typeof FBA_SALES_VELOCITY_COMPLETED_DAY_COUNT;
  window: SalesTrendWindow;
};

export class FbaSalesPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FbaSalesPlanningError";
  }
}

function invalidSalesTrendRange(message: string): never {
  throw new FbaSalesPlanningError(message);
}

function calendarFor(marketplaceId: MarketplaceId): MarketplaceCalendar {
  try {
    return marketplaceCalendar(marketplaceId);
  } catch {
    throw new FbaSalesPlanningError(
      "Amazon 站點不存在，無法建立 FBA 銷售日期範圍。",
    );
  }
}

function todayKeyAt(now: Date, calendar: MarketplaceCalendar): string {
  return calendar.dayAt(now);
}

function assertSalesTrendApiHorizon(
  range: SalesTrendRange,
  todayKey: string,
  calendar: MarketplaceCalendar,
): void {
  const firstConservativeDate = calendar.shiftDate(
    calendar.clampedYearShift(todayKey, -2),
    1,
  );
  if (range.startDate < firstConservativeDate) {
    invalidSalesTrendRange(
      "Sales API 每日資料的開始日必須晚於距今兩年的同一站點日期；請將開始日往後調整至少一天。",
    );
  }
}

function resolveSalesTrendRange(
  input: {
    marketplaceId: MarketplaceId;
    days?: number | null;
    startDate?: string | null;
    endDate?: string | null;
  },
  now: Date,
): SalesTrendRange {
  if (Number.isNaN(now.getTime())) {
    invalidSalesTrendRange("銷售趨勢日期範圍無效。");
  }
  const hasDays = input.days !== null && input.days !== undefined;
  const hasStart = input.startDate !== null && input.startDate !== undefined;
  const hasEnd = input.endDate !== null && input.endDate !== undefined;
  if (hasDays && (hasStart || hasEnd)) {
    invalidSalesTrendRange("預設天數與自訂日期不可同時使用。");
  }
  if (hasStart !== hasEnd) {
    invalidSalesTrendRange("自訂日期必須同時提供開始日與結束日。");
  }

  const calendar = calendarFor(input.marketplaceId);
  const todayKey = todayKeyAt(now, calendar);
  if (!hasStart) {
    const days = hasDays ? input.days! : 7;
    if (![7, 14, 30, 90].includes(days)) {
      invalidSalesTrendRange("銷售趨勢只支援最近 7、14、30 或 90 天。");
    }
    const presetDays = days as SalesTrendPresetDays;
    const range = {
      startDate: calendar.shiftDate(todayKey, -(presetDays - 1)),
      endDate: todayKey,
      dayCount: presetDays,
      presetDays,
    } satisfies SalesTrendRange;
    assertSalesTrendApiHorizon(range, todayKey, calendar);
    return range;
  }

  const startDate = input.startDate!;
  const endDate = input.endDate!;
  if (!calendar.isDateKey(startDate) || !calendar.isDateKey(endDate)) {
    invalidSalesTrendRange("自訂日期必須使用 YYYY-MM-DD 格式。");
  }
  const dayCount = calendar.inclusiveDayCount(startDate, endDate);
  if (dayCount < 1 || dayCount > MAX_SALES_TREND_DAY_COUNT) {
    invalidSalesTrendRange(
      `自訂日期範圍必須介於 1 到 ${MAX_SALES_TREND_DAY_COUNT} 天。`,
    );
  }
  if (endDate > todayKey) {
    invalidSalesTrendRange("自訂日期不可包含未來日期。");
  }
  const range = {
    startDate,
    endDate,
    dayCount,
    presetDays: null,
  } satisfies SalesTrendRange;
  assertSalesTrendApiHorizon(range, todayKey, calendar);
  return range;
}

function buildRangeWindow(
  marketplaceId: MarketplaceId,
  range: SalesTrendRange,
  partialEnd: Date | null,
): SalesTrendWindow {
  const calendar = calendarFor(marketplaceId);
  const dateKeys = Array.from({ length: range.dayCount }, (_, index) =>
    calendar.shiftDate(range.startDate, index),
  );
  const endAt = partialEnd
    ? calendar.formatInstant(partialEnd)
    : calendar.formatInstant(
        calendar.midnight(calendar.shiftDate(range.endDate, 1)),
      );
  const intervals = dateKeys.map((key, index) => {
    const start = calendar.formatInstant(calendar.midnight(key));
    const end =
      index === dateKeys.length - 1
        ? endAt
        : calendar.formatInstant(calendar.midnight(dateKeys[index + 1]));
    return `${start}--${end}`;
  });
  return {
    timeZone: calendar.timeZone,
    range,
    startAt: calendar.formatInstant(calendar.midnight(range.startDate)),
    endAt,
    dateKeys,
    intervals,
    partialDateKey: partialEnd ? range.endDate : null,
  };
}

function buildPreviousYearWindow(
  marketplaceId: MarketplaceId,
  current: SalesTrendWindow,
): SalesTrendWindow {
  const calendar = calendarFor(marketplaceId);
  const range = {
    startDate: calendar.clampedYearShift(current.range.startDate, -1),
    endDate: calendar.clampedYearShift(current.range.endDate, -1),
    dayCount: 0,
    presetDays: null,
  } satisfies SalesTrendRange;
  range.dayCount = calendar.inclusiveDayCount(range.startDate, range.endDate);

  let partialEnd: Date | null = null;
  const exactEndDate = calendar.exactYearShift(current.range.endDate, -1);
  if (current.partialDateKey && exactEndDate) {
    const currentEnd = new Date(current.endAt);
    const time = calendar.partsAt(currentEnd);
    partialEnd = calendar.localInstant(exactEndDate, time);
  }
  return buildRangeWindow(marketplaceId, range, partialEnd);
}

function salesTrendComparisonNotice(
  calendar: MarketplaceCalendar,
  currentWindow: SalesTrendWindow,
  hasComparison: boolean,
): string | null {
  if (!hasComparison) return null;
  if (
    currentWindow.partialDateKey &&
    !calendar.exactYearShift(currentWindow.partialDateKey, -1)
  ) {
    return "今天是 2 月 29 日，去年沒有相同月日；該日的去年同期會留空，不套用相同時分的 cutoff。";
  }
  if (currentWindow.partialDateKey) {
    return "本期包含今天時，去年同期也只計到相同站點當地時間；無法按相同月日對應的閏日會留空。";
  }
  return "去年同期只保留可按相同月日精確對應的日期；無法對應的閏日會留空。";
}

export function planFbaSalesTrend(
  input: {
    marketplaceId: MarketplaceId;
    days?: SalesTrendPresetDays | null;
    startDate?: string | null;
    endDate?: string | null;
    comparison?: SalesTrendComparisonMode;
  },
  now = new Date(),
): FbaSalesTrendPlan {
  const comparison = input.comparison ?? "none";
  if (!(["none", "previous-year"] as string[]).includes(comparison)) {
    invalidSalesTrendRange("不支援這個銷售趨勢比較方式。");
  }
  const range = resolveSalesTrendRange(input, now);
  const calendar = calendarFor(input.marketplaceId);
  const todayKey = todayKeyAt(now, calendar);
  const window = buildRangeWindow(
    input.marketplaceId,
    range,
    range.endDate === todayKey ? now : null,
  );
  const comparisonWindow =
    comparison === "previous-year"
      ? buildPreviousYearWindow(input.marketplaceId, window)
      : null;
  if (comparisonWindow) {
    assertSalesTrendApiHorizon(comparisonWindow.range, todayKey, calendar);
  }
  return {
    range,
    window,
    comparisonWindow,
    comparablePreviousYearDateKeys: comparisonWindow
      ? window.dateKeys
          .map((value) => calendar.exactYearShift(value, -1))
          .filter((value): value is string => value !== null)
      : null,
    comparisonNotice: salesTrendComparisonNotice(
      calendar,
      window,
      Boolean(comparisonWindow),
    ),
  };
}

export function planCompletedFbaSalesVelocity(
  input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
  },
  now = new Date(),
): CompletedFbaSalesVelocityPlan {
  if (Number.isNaN(now.getTime())) {
    throw new FbaSalesPlanningError("FBA Sales Velocity 日期範圍無效。");
  }
  if (
    !input.sellerSku ||
    input.sellerSku.trim() !== input.sellerSku ||
    input.sellerSku.length > 40 ||
    /[\u0000-\u001f\u007f]/u.test(input.sellerSku)
  ) {
    throw new FbaSalesPlanningError(
      "FBA Sales Velocity 必須使用完整且精確的 Seller SKU。",
    );
  }
  const calendar = calendarFor(input.marketplaceId);
  const todayKey = todayKeyAt(now, calendar);
  const endDate = calendar.shiftDate(todayKey, -1);
  const startDate = calendar.shiftDate(
    endDate,
    -(FBA_SALES_VELOCITY_COMPLETED_DAY_COUNT - 1),
  );
  const range = {
    startDate,
    endDate,
    dayCount: FBA_SALES_VELOCITY_COMPLETED_DAY_COUNT,
    presetDays: null,
  } satisfies SalesTrendRange;

  return {
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    completedDayCount: FBA_SALES_VELOCITY_COMPLETED_DAY_COUNT,
    window: buildRangeWindow(input.marketplaceId, range, null),
  };
}
