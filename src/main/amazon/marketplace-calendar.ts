import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";

export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function assertDateKey(value: string): void {
  if (!isDateOnly(value)) {
    throw new RangeError("Marketplace Day 必須使用有效的 YYYY-MM-DD 格式。");
  }
}

function assertIntegerShift(value: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError("Marketplace Calendar 位移必須是整數。");
  }
}

function zonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  let formatter = zonedFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA-u-hc-h23", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatterCache.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const instant = new Date(Math.floor(date.getTime() / 1_000) * 1_000);
  const parts = zonedDateParts(instant, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((representedAsUtc - instant.getTime()) / 60_000);
}

function offsetText(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(
    absolute % 60,
  ).padStart(2, "0")}`;
}

function zonedIso(date: Date, timeZone: string): string {
  const parts = zonedDateParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(
    parts.minute,
  )}:${pad(parts.second)}${offsetText(timeZoneOffsetMinutes(date, timeZone))}`;
}

function dateKey(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftDateKey(value: string, days: number): string {
  assertDateKey(value);
  assertIntegerShift(days);
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return dateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

function zonedLocalInstant(
  value: string,
  timeZone: string,
  time: Pick<ZonedDateParts, "hour" | "minute" | "second"> = {
    hour: 0,
    minute: 0,
    second: 0,
  },
): Date {
  assertDateKey(value);
  const [year, month, day] = value.split("-").map(Number);
  const localAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    time.hour,
    time.minute,
    time.second,
  );
  let instant = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next =
      localAsUtc -
      timeZoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

function zonedMidnight(value: string, timeZone: string): Date {
  return zonedLocalInstant(value, timeZone);
}

function calendarDayCount(startDate: string, endDate: string): number {
  assertDateKey(startDate);
  assertDateKey(endDate);
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  return (
    Math.round(
      (Date.UTC(endYear, endMonth - 1, endDay) -
        Date.UTC(startYear, startMonth - 1, startDay)) /
        86_400_000,
    ) + 1
  );
}

function exactYearShift(value: string, years: number): string | null {
  assertDateKey(value);
  assertIntegerShift(years);
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year + years, month - 1, day));
  return shifted.getUTCMonth() === month - 1 && shifted.getUTCDate() === day
    ? dateKey(shifted.getUTCFullYear(), month, day)
    : null;
}

function clampedYearShift(value: string, years: number): string {
  const exact = exactYearShift(value, years);
  if (exact) return exact;
  const [year, month] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return dateKey(year + years, month, lastDay);
}

export type MarketplaceCalendar = {
  readonly marketplaceId: MarketplaceId;
  readonly timeZone: string;
  isDateKey(value: unknown): value is string;
  partsAt(instant: Date): ZonedDateParts;
  dayAt(instant: Date): string;
  shiftDate(value: string, days: number): string;
  inclusiveDayCount(startDate: string, endDate: string): number;
  formatInstant(instant: Date): string;
  localInstant(
    value: string,
    time?: Pick<ZonedDateParts, "hour" | "minute" | "second">,
  ): Date;
  midnight(value: string): Date;
  exactYearShift(value: string, years: number): string | null;
  clampedYearShift(value: string, years: number): string;
};

const marketplaceCalendarCache = new Map<MarketplaceId, MarketplaceCalendar>();

export function marketplaceCalendar(
  marketplaceId: MarketplaceId,
): MarketplaceCalendar {
  const cached = marketplaceCalendarCache.get(marketplaceId);
  if (cached) return cached;
  const marketplace = marketplaceById(marketplaceId);
  if (!marketplace) {
    throw new Error("Amazon 站點不存在，無法建立 Marketplace Calendar。");
  }
  const { timeZone } = marketplace;
  const calendar: MarketplaceCalendar = Object.freeze({
    marketplaceId,
    timeZone,
    isDateKey: isDateOnly,
    partsAt: (instant) => zonedDateParts(instant, timeZone),
    dayAt: (instant) => {
      const parts = zonedDateParts(instant, timeZone);
      return dateKey(parts.year, parts.month, parts.day);
    },
    shiftDate: shiftDateKey,
    inclusiveDayCount: calendarDayCount,
    formatInstant: (instant) => zonedIso(instant, timeZone),
    localInstant: (value, time) => zonedLocalInstant(value, timeZone, time),
    midnight: (value) => zonedMidnight(value, timeZone),
    exactYearShift,
    clampedYearShift,
  });
  marketplaceCalendarCache.set(marketplaceId, calendar);
  return calendar;
}
