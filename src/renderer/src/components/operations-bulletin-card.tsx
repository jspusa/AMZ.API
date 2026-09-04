"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  OperationsBoardExpiryItem,
  OperationsBoardItem,
  OperationsBoardPromotionItem,
  OperationsBoardPublisherDraft,
  OperationsBoardReadResult,
} from "../../../shared/operations-board";
import { MARKETPLACES, marketplaceById } from "../../../shared/marketplaces";

type Money = Readonly<{
  amount: number;
  currencyCode: string;
}>;

export type OperationsBoardResponse = OperationsBoardReadResult;

type CountdownPresentation = Readonly<{
  days: number;
  label: string;
  state: "upcoming" | "today" | "past";
}>;

type SkuFact =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "error" }>
  | Readonly<{
      state: "ready";
      inventory: number | null;
      price: Money | null;
      fetchedAt: string;
      mode: "live" | "demo";
    }>;

type CalendarEntry =
  | Readonly<{
      id: string;
      kind: "expiry" | "stop-sale";
      date: string;
      label: string;
      item: OperationsBoardExpiryItem;
    }>
  | Readonly<{
      id: string;
      kind: "promotion";
      date: string;
      label: string;
      item: OperationsBoardPromotionItem;
    }>;

type OperationsBoardDesktopBridge = Readonly<{
  operationsBoard?: Readonly<{
    schemaVersion?: number;
    publish(draft: OperationsBoardPublisherDraft): Promise<void>;
    manage(itemId: string): Promise<void>;
    onUpdated?(listener: () => void): () => void;
  }>;
}>;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/u;
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;
const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

function dateKeyEpoch(value: string): number | null {
  if (!isDateKey(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function currentTaipeiDateKey(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function millisecondsUntilNextTaipeiDay(now = new Date()): number {
  const shifted = new Date(now.getTime() + TAIPEI_UTC_OFFSET_MS);
  const nextMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  ) - TAIPEI_UTC_OFFSET_MS;
  return Math.max(1, nextMidnight - now.getTime());
}

function useTaipeiDateKey(injectedDateKey: string | undefined): string {
  const [liveDateKey, setLiveDateKey] = useState(
    () => injectedDateKey ?? currentTaipeiDateKey(),
  );

  useEffect(() => {
    if (injectedDateKey !== undefined) {
      setLiveDateKey(injectedDateKey);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updateAndSchedule = () => {
      setLiveDateKey(currentTaipeiDateKey());
      timer = setTimeout(
        updateAndSchedule,
        millisecondsUntilNextTaipeiDay(),
      );
    };
    updateAndSchedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [injectedDateKey]);

  return injectedDateKey ?? liveDateKey;
}

export function countdownPresentation(
  targetDateKey: string,
  todayDateKey: string,
): CountdownPresentation | null {
  const target = dateKeyEpoch(targetDateKey);
  const today = dateKeyEpoch(todayDateKey);
  if (target === null || today === null) return null;
  const days = Math.round((target - today) / 86_400_000);
  if (days > 0) return { days, label: `倒數 ${days} 天`, state: "upcoming" };
  if (days === 0) return { days, label: "就是今天", state: "today" };
  return { days, label: `已過期 ${Math.abs(days)} 天`, state: "past" };
}

function monthParts(monthKey: string): { year: number; month: number } | null {
  if (!MONTH_KEY_PATTERN.test(monthKey)) return null;
  const [year, month] = monthKey.split("-").map(Number);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return null;
  return { year, month };
}

function calendarPickerBounds(todayDateKey: string): { min: string; max: string } {
  const currentMonth = todayDateKey.slice(0, 7);
  const parsed = monthParts(currentMonth);
  if (!parsed) return { min: todayDateKey, max: todayDateKey };
  return {
    min: `${parsed.year - 1}-01-01`,
    max: `${parsed.year + 1}-12-31`,
  };
}

function dateKeyFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calendarMonthCells(monthKey: string): readonly string[] {
  const parsed = monthParts(monthKey);
  if (!parsed) return [];
  const first = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  const firstCell = new Date(first);
  firstCell.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const daysInMonth = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  const weekCount = Math.max(5, Math.ceil((first.getUTCDay() + daysInMonth) / 7));
  return Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = new Date(firstCell);
    date.setUTCDate(firstCell.getUTCDate() + index);
    return dateKeyFromUtc(date);
  });
}

function monthLabel(monthKey: string): string {
  const parsed = monthParts(monthKey);
  return parsed ? `${parsed.year} 年 ${parsed.month} 月` : monthKey;
}

function absoluteDateLabel(dateKey: string): string {
  const epoch = dateKeyEpoch(dateKey);
  if (epoch === null) return dateKey;
  const date = new Date(epoch);
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日（週${WEEKDAY_LABELS[date.getUTCDay()]}）`;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M8 3.5v4M16 3.5v4M3.5 10h17" />
      <path d="M8 14h2M14 14h2M8 17h2M14 17h2" />
    </svg>
  );
}

function BulletinDatePicker({
  ariaLabel,
  name,
  value,
  min,
  max,
  todayDateKey,
  displayValue,
  onSelect,
  onClear,
}: Readonly<{
  ariaLabel: string;
  name?: string;
  value: string;
  min: string;
  max: string;
  todayDateKey: string;
  displayValue?: (dateKey: string) => string;
  onSelect: (dateKey: string) => void;
  onClear?: () => void;
}>) {
  const currentYear = Number(todayDateKey.slice(0, 4));
  const years = [currentYear - 1, currentYear, currentYear + 1];
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"month" | "day">("month");
  const [year, setYear] = useState(currentYear);
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const closePicker = () => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const openPicker = () => {
    const minimumYear = isDateKey(min) ? Number(min.slice(0, 4)) : currentYear;
    const valueYear = isDateKey(value)
      ? Number(value.slice(0, 4))
      : Math.max(currentYear, minimumYear);
    setYear(years.includes(valueYear) ? valueYear : currentYear);
    setMonthKey(null);
    setStep("month");
    setOpen(true);
  };

  const chooseMonth = (month: number) => {
    setMonthKey(`${year}-${String(month).padStart(2, "0")}`);
    setStep("day");
  };

  const monthIsAvailable = (candidate: string) => {
    const first = `${candidate}-01`;
    const parsed = monthParts(candidate);
    if (!parsed) return false;
    const last = dateKeyFromUtc(new Date(Date.UTC(parsed.year, parsed.month, 0)));
    return last >= min && first <= max;
  };

  const selectedMonth = monthKey ? monthParts(monthKey) : null;
  const daysInMonth = selectedMonth
    ? new Date(Date.UTC(selectedMonth.year, selectedMonth.month, 0)).getUTCDate()
    : 0;
  const firstWeekday = selectedMonth
    ? new Date(Date.UTC(selectedMonth.year, selectedMonth.month - 1, 1)).getUTCDay()
    : 0;

  return (
    <span className="bulletin-date-picker-shell">
      <button
        ref={triggerRef}
        type="button"
        name={name}
        className="bulletin-date-trigger"
        aria-label={ariaLabel}
        onClick={openPicker}
      >
        <CalendarIcon />
        <strong aria-live="polite">
          {value ? (displayValue?.(value) ?? absoluteDateLabel(value)) : "選擇日期"}
        </strong>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <span
          className="bulletin-date-picker-backdrop"
          onKeyDown={(event) => {
            if (event.key === "Escape") closePicker();
          }}
        >
          <span
            className="bulletin-date-picker"
            role="dialog"
            aria-modal="true"
            aria-label={`${ariaLabel}：${step === "month" ? "先選月份" : "再選日期"}`}
          >
            <span className="bulletin-date-picker-heading">
              <span>
                <small>{step === "month" ? "STEP 1 / 2" : "STEP 2 / 2"}</small>
                <strong>{step === "month" ? "先選月份" : `${monthLabel(monthKey ?? "")}`}</strong>
              </span>
              <button ref={closeRef} type="button" onClick={closePicker} aria-label="關閉日期選擇器">×</button>
            </span>
            {step === "month" ? (
              <>
                <span className="bulletin-date-picker-years" aria-label="可選年份">
                  {years.map((candidateYear) => (
                    <button
                      type="button"
                      key={candidateYear}
                      aria-label={`選擇 ${candidateYear} 年`}
                      aria-pressed={year === candidateYear}
                      onClick={() => setYear(candidateYear)}
                    >
                      {candidateYear} 年
                    </button>
                  ))}
                </span>
                <span className="bulletin-date-picker-months">
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                    const candidate = `${year}-${String(month).padStart(2, "0")}`;
                    return (
                      <button
                        type="button"
                        key={candidate}
                        aria-label={`選擇 ${year} 年 ${month} 月`}
                        disabled={!monthIsAvailable(candidate)}
                        onClick={() => chooseMonth(month)}
                      >
                        {month} 月
                      </button>
                    );
                  })}
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="bulletin-date-picker-back"
                  onClick={() => setStep("month")}
                >
                  ‹ 重新選月份
                </button>
                <span className="bulletin-date-picker-weekdays" aria-hidden="true">
                  {WEEKDAY_LABELS.map((weekday) => <span key={weekday}>{weekday}</span>)}
                </span>
                <span className="bulletin-date-picker-days">
                  {Array.from({ length: firstWeekday }, (_, index) => (
                    <span key={`blank-${index}`} aria-hidden="true" />
                  ))}
                  {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
                    const candidate = `${monthKey}-${String(day).padStart(2, "0")}`;
                    return (
                      <button
                        type="button"
                        key={candidate}
                        aria-label={`選擇 ${selectedMonth?.year} 年 ${selectedMonth?.month} 月 ${day} 日`}
                        aria-pressed={value === candidate}
                        disabled={candidate < min || candidate > max}
                        onClick={() => {
                          onSelect(candidate);
                          closePicker();
                        }}
                      >
                        {day}
                      </button>
                    );
                  })}
                </span>
              </>
            )}
            {value && onClear && (
              <button
                type="button"
                className="bulletin-date-picker-clear"
                aria-label={`清除${ariaLabel.replace(/^選擇/u, "")}`}
                onClick={() => {
                  onClear();
                  closePicker();
                }}
              >
                清除這個日期
              </button>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

function promotionDateLabel(item: OperationsBoardPromotionItem): string {
  return item.startDate === item.endDate
    ? absoluteDateLabel(item.startDate)
    : `${absoluteDateLabel(item.startDate)}－${absoluteDateLabel(item.endDate)}`;
}

function promotionDatesInMonth(
  item: OperationsBoardPromotionItem,
  monthKey: string,
): readonly string[] {
  const parsed = monthParts(monthKey);
  if (!parsed) return [];
  const monthStart = `${monthKey}-01`;
  const monthEnd = dateKeyFromUtc(new Date(Date.UTC(parsed.year, parsed.month, 0)));
  const start = item.startDate > monthStart ? item.startDate : monthStart;
  const end = item.endDate < monthEnd ? item.endDate : monthEnd;
  const startEpoch = dateKeyEpoch(start);
  const endEpoch = dateKeyEpoch(end);
  if (startEpoch === null || endEpoch === null || startEpoch > endEpoch) return [];
  return Array.from(
    { length: Math.floor((endEpoch - startEpoch) / 86_400_000) + 1 },
    (_, index) => dateKeyFromUtc(new Date(startEpoch + index * 86_400_000)),
  );
}

function promotionCountdownPresentation(
  item: OperationsBoardPromotionItem,
  todayDateKey: string,
): CountdownPresentation | null {
  if (todayDateKey < item.startDate) {
    return countdownPresentation(item.startDate, todayDateKey);
  }
  if (todayDateKey <= item.endDate) {
    if (item.startDate === item.endDate) {
      return countdownPresentation(item.startDate, todayDateKey);
    }
    return { days: 0, label: "進行中", state: "today" };
  }
  const ended = countdownPresentation(item.endDate, todayDateKey);
  return ended
    ? { ...ended, label: `已結束 ${Math.abs(ended.days)} 天`, state: "past" }
    : null;
}

function updatedAtLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "同步時間無法辨識";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function marketplaceShortLabel(marketplaceId: string): string {
  return marketplaceById(marketplaceId)?.shortLabel ?? marketplaceId;
}

function formatMoney(value: Money | null): string {
  if (!value) return "價格無資料";
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: value.currencyCode,
      maximumFractionDigits: value.currencyCode === "JPY" ? 0 : 2,
    }).format(value.amount);
  } catch {
    return `${value.currencyCode} ${value.amount.toLocaleString("zh-TW")}`;
  }
}

function parseMoney(value: unknown): Money | null {
  if (
    !isRecord(value) ||
    typeof value.amount !== "number" ||
    !Number.isFinite(value.amount) ||
    value.amount < 0 ||
    typeof value.currencyCode !== "string" ||
    !/^[A-Z]{3}$/u.test(value.currencyCode)
  ) {
    return null;
  }
  return { amount: value.amount, currencyCode: value.currencyCode };
}

function parseBoardItem(value: unknown, schemaVersion: 1 | 2): OperationsBoardItem | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }
  if (value.type === "expiry") {
    if (
      typeof value.marketplaceId !== "string" ||
      !value.marketplaceId ||
      typeof value.sellerSku !== "string" ||
      !value.sellerSku.trim() ||
      !isDateKey(value.expiryDate) ||
      typeof value.note !== "string"
    ) {
      return null;
    }
    const stopSaleDate = schemaVersion === 2
      ? value.stopSaleDate === null
        ? null
        : isDateKey(value.stopSaleDate)
          ? value.stopSaleDate
          : undefined
      : null;
    if (stopSaleDate === undefined || (stopSaleDate && stopSaleDate > value.expiryDate)) {
      return null;
    }
    return {
      id: value.id,
      type: "expiry",
      marketplaceId: value.marketplaceId,
      sellerSku: value.sellerSku,
      expiryDate: value.expiryDate,
      stopSaleDate,
      note: value.note,
    };
  }
  const startDate = schemaVersion === 1 ? value.date : value.startDate;
  const endDate = schemaVersion === 1 ? value.date : value.endDate;
  if (
    value.type === "promotion" &&
    isDateKey(startDate) &&
    isDateKey(endDate) &&
    endDate >= startDate &&
    typeof value.title === "string" &&
    value.title.trim() &&
    typeof value.note === "string" &&
    typeof value.countdown === "boolean"
  ) {
    return {
      id: value.id,
      type: "promotion",
      startDate,
      endDate,
      title: value.title,
      note: value.note,
      countdown: value.countdown,
    };
  }
  return null;
}

function parseBoardResponse(value: unknown): OperationsBoardResponse | null {
  if (
    !isRecord(value) ||
    !isRecord(value.snapshot) ||
    (value.snapshot.schemaVersion !== 1 && value.snapshot.schemaVersion !== 2) ||
    typeof value.snapshot.revision !== "number" ||
    !Number.isSafeInteger(value.snapshot.revision) ||
    value.snapshot.revision < 0 ||
    typeof value.snapshot.updatedAt !== "string" ||
    Number.isNaN(new Date(value.snapshot.updatedAt).getTime()) ||
    !Array.isArray(value.snapshot.items) ||
    !["shared", "last-known-good", "empty"].includes(String(value.source)) ||
    typeof value.stale !== "boolean" ||
    !["ready", "not-configured", "unavailable"].includes(String(value.status)) ||
    (value.message !== undefined && typeof value.message !== "string")
  ) {
    return null;
  }
  const schemaVersion = value.snapshot.schemaVersion as 1 | 2;
  const items = value.snapshot.items.map((item) => parseBoardItem(item, schemaVersion));
  if (items.some((item) => item === null)) return null;
  return {
    snapshot: {
      schemaVersion: 2,
      revision: value.snapshot.revision,
      updatedAt: value.snapshot.updatedAt,
      items: items as OperationsBoardItem[],
    },
    source: value.source as OperationsBoardResponse["source"],
    stale: value.stale,
    status: value.status as OperationsBoardResponse["status"],
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

function parseFactField(value: unknown): number | null {
  return isRecord(value) &&
      value.state === "ready" &&
      typeof value.value === "number" &&
      Number.isSafeInteger(value.value) &&
      value.value >= 0
    ? value.value
    : null;
}

function parseSkuFacts(
  value: unknown,
  items: readonly OperationsBoardExpiryItem[],
): Record<string, SkuFact> | null {
  if (!isRecord(value) || !Array.isArray(value.facts)) return null;
  const requested = new Map(items.map((item) => [item.id, item]));
  const result: Record<string, SkuFact> = {};
  for (const fact of value.facts) {
    if (
      !isRecord(fact) ||
      typeof fact.id !== "string" ||
      !requested.has(fact.id) ||
      typeof fact.marketplaceId !== "string" ||
      typeof fact.sellerSku !== "string" ||
      (fact.mode !== "live" && fact.mode !== "demo") ||
      typeof fact.fetchedAt !== "string" ||
      Number.isNaN(Date.parse(fact.fetchedAt))
    ) {
      return null;
    }
    const item = requested.get(fact.id)!;
    if (fact.marketplaceId !== item.marketplaceId || fact.sellerSku !== item.sellerSku) {
      return null;
    }
    const price = isRecord(fact.price) && fact.price.state === "ready"
      ? parseMoney(fact.price.value)
      : null;
    result[item.id] = {
      state: "ready",
      inventory: parseFactField(fact.inventory),
      price,
      fetchedAt: fact.fetchedAt,
      mode: fact.mode,
    };
  }
  if (Object.keys(result).length !== items.length) return null;
  return result;
}

async function loadSkuFacts(
  items: readonly OperationsBoardExpiryItem[],
  signal: AbortSignal,
): Promise<Record<string, SkuFact>> {
  try {
    const response = await fetch("/api/sp-api/operations-board-facts", {
      method: "POST",
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: items.map(({ id, marketplaceId, sellerSku }) => ({
          id,
          marketplaceId,
          sellerSku,
        })),
      }),
    });
    const payload = (await response.json()) as unknown;
    const parsed = response.ok ? parseSkuFacts(payload, items) : null;
    return parsed ?? Object.fromEntries(items.map((item) => [item.id, { state: "error" }]));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return Object.fromEntries(items.map((item) => [item.id, { state: "error" }]));
  }
}

function SkuFactFields({ fact }: { fact: SkuFact | undefined }) {
  if (!fact || fact.state === "loading") {
    return (
      <dl className="bulletin-expiry-facts" aria-label="Amazon 即時資料同步中">
        <div><dt>FBA 可售庫存</dt><dd>目前庫存同步中</dd></div>
        <div><dt>目前價格</dt><dd>目前價格同步中</dd></div>
      </dl>
    );
  }
  if (fact.state === "error") {
    return (
      <dl className="bulletin-expiry-facts" aria-label="Amazon 即時資料無法取得">
        <div><dt>FBA 可售庫存</dt><dd>無法取得</dd></div>
        <div><dt>目前價格</dt><dd>無法取得</dd></div>
      </dl>
    );
  }
  const isDemo = fact.mode === "demo";
  const updated = updatedAtLabel(fact.fetchedAt);
  const syncLabel = isDemo
    ? `展示資料產生於 ${updated}；不是 Amazon 即時值`
    : `Amazon 即時資料同步於 ${updated}`;
  return (
    <div className="bulletin-fact-wrap">
      <dl className="bulletin-expiry-facts" aria-label={syncLabel} title={syncLabel}>
        <div>
          <dt>{isDemo ? "展示庫存" : "FBA 可售庫存"}</dt>
          <dd>{fact.inventory === null ? "庫存無資料" : `${fact.inventory.toLocaleString("zh-TW")} 件`}</dd>
        </div>
        <div><dt>{isDemo ? "展示價格" : "目前價格"}</dt><dd>{formatMoney(fact.price)}</dd></div>
      </dl>
      <small className="bulletin-fact-sync">{isDemo ? "展示資料" : "同步"} {updated}</small>
    </div>
  );
}

function ExpiryCountdown({
  item,
  todayDateKey,
}: {
  item: OperationsBoardExpiryItem;
  todayDateKey: string;
}) {
  const isStopSale = Boolean(item.stopSaleDate);
  const countdown = countdownPresentation(item.stopSaleDate ?? item.expiryDate, todayDateKey);
  const magnitude = Math.abs(countdown?.days ?? 0);
  return (
    <div
      className="bulletin-countdown"
      data-countdown-state={countdown?.state ?? "unknown"}
      aria-label={countdown?.label ?? `${isStopSale ? "停售" : "效期"}倒數無法計算`}
    >
      <small>
        {countdown?.state === "past"
          ? `已過${isStopSale ? "停售" : "效期"}`
          : `距離${isStopSale ? "停售" : "效期"}`}
      </small>
      {countdown?.state === "today" ? (
        <strong>今天</strong>
      ) : (
        <>
          <strong>{magnitude.toLocaleString("zh-TW")}</strong>
          <span>天</span>
        </>
      )}
    </div>
  );
}

export default function OperationsBulletinCard({
  initialResponse,
  todayDateKey: injectedTodayDateKey,
}: Readonly<{
  initialResponse?: OperationsBoardResponse;
  todayDateKey?: string;
}>) {
  const todayDateKey = useTaipeiDateKey(injectedTodayDateKey);
  const [expanded, setExpanded] = useState(true);
  const [response, setResponse] = useState<OperationsBoardResponse | null>(
    initialResponse ?? null,
  );
  const [loading, setLoading] = useState(!initialResponse);
  const [error, setError] = useState<string | null>(null);
  const [publisherBusy, setPublisherBusy] = useState(false);
  const [composer, setComposer] = useState<"expiry" | "promotion" | null>(null);
  const [expiryDraft, setExpiryDraft] = useState({
    marketplaceId: "ATVPDKIKX0DER",
    sellerSku: "",
    expiryDate: "",
    stopSaleDate: "",
    note: "",
  });
  const [promotionDraft, setPromotionDraft] = useState({
    startDate: "",
    endDate: "",
    title: "",
    note: "",
    countdown: false,
  });
  const [skuFacts, setSkuFacts] = useState<Record<string, SkuFact>>({});
  const skuFactCache = useRef(new Map<string, SkuFact>());
  const [factRefresh, setFactRefresh] = useState(0);
  const boardLoadGeneration = useRef(0);
  const [calendarMonth, setCalendarMonth] = useState(todayDateKey.slice(0, 7));
  const [calendarDate, setCalendarDate] = useState(todayDateKey);
  const calendarBounds = calendarPickerBounds(todayDateKey);

  useEffect(() => {
    setCalendarMonth(todayDateKey.slice(0, 7));
    setCalendarDate(todayDateKey);
  }, [todayDateKey]);

  const loadBoard = useCallback(async (signal?: AbortSignal) => {
    const generation = boardLoadGeneration.current + 1;
    boardLoadGeneration.current = generation;
    setLoading(true);
    setError(null);
    try {
      const request = await fetch("/api/operations-board", {
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
      const payload = (await request.json()) as unknown;
      if (!request.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.message === "string"
            ? payload.message
            : "目前無法同步營運公布欄。",
        );
      }
      const parsed = parseBoardResponse(payload);
      if (!parsed) throw new Error("營運公布欄回應格式無法辨識。");
      if (generation !== boardLoadGeneration.current) return;
      setResponse(parsed);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      if (generation !== boardLoadGeneration.current) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "目前無法同步營運公布欄。",
      );
    } finally {
      if (generation === boardLoadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialResponse) return;
    const controller = new AbortController();
    void loadBoard(controller.signal);
    return () => controller.abort();
  }, [initialResponse, loadBoard]);

  useEffect(() => {
    const bridge = window.fbaOS as typeof window.fbaOS &
      OperationsBoardDesktopBridge;
    if (!bridge.operationsBoard?.onUpdated) return;
    return bridge.operationsBoard.onUpdated(() => {
      skuFactCache.current.clear();
      setFactRefresh((current) => current + 1);
      void loadBoard();
    });
  }, [loadBoard]);

  const expiryItems = useMemo(
    () => response?.snapshot.items
      .filter((item): item is OperationsBoardExpiryItem => item.type === "expiry")
      .sort((left, right) =>
        (left.stopSaleDate ?? left.expiryDate).localeCompare(
          right.stopSaleDate ?? right.expiryDate,
        ) ||
        left.sellerSku.localeCompare(right.sellerSku)
      ) ?? [],
    [response],
  );
  const promotionItems = useMemo(
    () => response?.snapshot.items
      .filter((item): item is OperationsBoardPromotionItem => item.type === "promotion")
      .sort((left, right) =>
        left.startDate.localeCompare(right.startDate) || left.title.localeCompare(right.title)
      ) ?? [],
    [response],
  );
  const expiryIdentitySignature = expiryItems
    .map((item) => `${item.id}\u0000${item.marketplaceId}\u0000${item.sellerSku}`)
    .join("\u0001");

  useEffect(() => {
    const controller = new AbortController();
    const identityKey = (item: OperationsBoardExpiryItem) =>
      `${item.marketplaceId}\u0000${item.sellerSku}`;
    const missing = expiryItems.filter((item) => !skuFactCache.current.has(identityKey(item)));
    setSkuFacts(Object.fromEntries(expiryItems.map((item) => [
      item.id,
      skuFactCache.current.get(identityKey(item)) ?? { state: "loading" },
    ])));
    if (missing.length > 0) {
      void loadSkuFacts(missing, controller.signal).then((facts) => {
        if (controller.signal.aborted) return;
        for (const item of missing) {
          const fact = facts[item.id];
          if (fact?.state === "ready") skuFactCache.current.set(identityKey(item), fact);
        }
        setSkuFacts(Object.fromEntries(expiryItems.map((item) => [
          item.id,
          facts[item.id] ?? skuFactCache.current.get(identityKey(item)) ?? { state: "error" },
        ])));
      }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [expiryIdentitySignature, factRefresh]);

  const refreshBoardAndFacts = () => {
    skuFactCache.current.clear();
    setFactRefresh((current) => current + 1);
    void loadBoard();
  };

  const openComposer = (nextComposer: "expiry" | "promotion") => {
    const bridge = window.fbaOS as typeof window.fbaOS &
      OperationsBoardDesktopBridge;
    if (bridge.operationsBoard?.schemaVersion !== 2) {
      setComposer(null);
      setError(
        "新增停售日與多日促銷需要 AMZ.API App 0.1.53；請更新一次後再發布。",
      );
      return;
    }
    setError(null);
    if (nextComposer === "promotion") {
      setPromotionDraft({
        startDate: "",
        endDate: "",
        title: "",
        note: "",
        countdown: false,
      });
    }
    setComposer(nextComposer);
  };

  const publishDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!composer || publisherBusy) return;
    if (composer === "promotion" && !promotionDraft.startDate) {
      setError("請先選擇促銷開始日。");
      return;
    }
    setPublisherBusy(true);
    setError(null);
    try {
      const bridge = window.fbaOS as typeof window.fbaOS &
        OperationsBoardDesktopBridge;
      if (
        bridge.operationsBoard?.schemaVersion !== 2 ||
        !bridge.operationsBoard.publish
      ) {
        throw new Error(
          "新增停售日與多日促銷需要 AMZ.API App 0.1.53；請更新一次後再發布。",
        );
      }
      await bridge.operationsBoard.publish(
        composer === "expiry"
          ? {
              type: "expiry",
              ...expiryDraft,
              stopSaleDate: expiryDraft.stopSaleDate || null,
            }
          : {
              type: "promotion",
              ...promotionDraft,
              endDate: promotionDraft.endDate || promotionDraft.startDate,
            },
      );
      setComposer(null);
    } catch (publisherError) {
      setError(
        publisherError instanceof Error
          ? publisherError.message
          : "目前無法登入或開啟發布確認。",
      );
    } finally {
      setPublisherBusy(false);
    }
  };

  const manageAnnouncement = async (itemId: string) => {
    if (publisherBusy) return;
    setPublisherBusy(true);
    setError(null);
    try {
      const bridge = window.fbaOS as typeof window.fbaOS &
        OperationsBoardDesktopBridge;
      if (
        bridge.operationsBoard?.schemaVersion !== 2 ||
        !bridge.operationsBoard.manage
      ) {
        throw new Error(
          "編輯或刪除新版公布欄需要 AMZ.API App 0.1.53；請更新一次後再操作。",
        );
      }
      await bridge.operationsBoard.manage(itemId);
    } catch (manageError) {
      setError(
        manageError instanceof Error
          ? manageError.message
          : "目前無法開啟編輯／刪除。",
      );
    } finally {
      setPublisherBusy(false);
    }
  };

  const expiryCalendarEntries: CalendarEntry[] = expiryItems.flatMap((item) => [
    {
      id: `${item.id}:expiry`,
      kind: "expiry" as const,
      date: item.expiryDate,
      label: `${marketplaceShortLabel(item.marketplaceId)} · ${item.sellerSku} 到期`,
      item,
    },
    ...(item.stopSaleDate
      ? [{
          id: `${item.id}:stop-sale`,
          kind: "stop-sale" as const,
          date: item.stopSaleDate,
          label: `${marketplaceShortLabel(item.marketplaceId)} · ${item.sellerSku} 停售`,
          item,
        }]
      : []),
  ]);
  const currentMonthEntries: CalendarEntry[] = [
    ...expiryCalendarEntries,
    ...promotionItems
      .filter((item) => promotionDatesInMonth(item, calendarMonth).length > 0)
      .map((item): CalendarEntry => ({
        id: item.id,
        kind: "promotion",
        date: item.startDate,
        label: item.title,
        item,
      })),
  ]
    .filter((entry) =>
      entry.kind === "promotion" || entry.date.startsWith(`${calendarMonth}-`)
    )
    .sort((left, right) =>
      left.date.localeCompare(right.date) ||
      left.kind.localeCompare(right.kind) ||
      left.label.localeCompare(right.label)
    );
  const calendarCellEntries: CalendarEntry[] = [
    ...expiryCalendarEntries,
    ...promotionItems.flatMap((item) =>
      promotionDatesInMonth(item, calendarMonth).map((date) => ({
        id: `${item.id}:${date}`,
        kind: "promotion" as const,
        date,
        label: item.title,
        item,
      }))
    ),
  ]
    .filter((entry) => entry.date.startsWith(`${calendarMonth}-`))
    .sort((left, right) =>
      left.date.localeCompare(right.date) ||
      left.kind.localeCompare(right.kind) ||
      left.label.localeCompare(right.label)
    );
  const entriesByDate = new Map<string, CalendarEntry[]>();
  for (const entry of calendarCellEntries) {
    entriesByDate.set(entry.date, [...(entriesByDate.get(entry.date) ?? []), entry]);
  }
  const calendarCells = calendarMonthCells(calendarMonth);
  const itemCount = response?.snapshot.items.length ?? 0;

  return (
    <details
      className="operations-bulletin"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span className="operations-bulletin-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M8 3v4M16 3v4M3 10h18M7.5 14h3M13.5 14h3M7.5 17.5h3" />
          </svg>
        </span>
        <span className="operations-bulletin-summary-copy">
          <small>EXPIRY COUNTDOWN · PROMOTION CALENDAR</small>
          <strong>營運公布欄</strong>
          <span>即期品倒數與 Amazon 促銷檔期，重要日期集中查看。</span>
        </span>
        <span className="operations-bulletin-summary-count">
          <strong>{loading && !response ? "…" : itemCount.toLocaleString("zh-TW")}</strong>
          <small>項公告</small>
        </span>
        <i aria-hidden="true">＋</i>
      </summary>

      <div className="operations-bulletin-body">
        <div className="operations-bulletin-toolbar">
          <div>
            <strong>共用營運日程</strong>
            <small>
              {response
                ? response.snapshot.revision === 0
                  ? "尚未發布"
                  : `最後更新 ${updatedAtLabel(response.snapshot.updatedAt)}`
                : "正在連接共用公布欄…"}
            </small>
          </div>
          <div className="operations-bulletin-actions">
            <button
              type="button"
              className="bulletin-refresh"
              onClick={refreshBoardAndFacts}
              disabled={loading || publisherBusy}
            >
              {loading ? "同步中…" : "重新同步"}
            </button>
            <button
              type="button"
              className="bulletin-edit"
              onClick={() => openComposer("expiry")}
              disabled={publisherBusy}
            >
              新增即期品
            </button>
            <button
              type="button"
              className="bulletin-add-promotion"
              onClick={() => openComposer("promotion")}
              disabled={publisherBusy}
            >
              新增促銷
            </button>
          </div>
        </div>

        {response?.stale && (
          <p className="bulletin-source-notice" role="status">
            目前顯示上次同步資料；重新連線後會自動以共用公布欄為準。
          </p>
        )}
        {response?.message && (
          <p className="bulletin-source-notice" role="status">{response.message}</p>
        )}
        {error && <p className="bulletin-error" role="alert">{error}</p>}

        {composer === "expiry" && (
          <form
            className="bulletin-composer"
            aria-label="新增即期品公告"
            onSubmit={(event) => void publishDraft(event)}
          >
            <header>
              <div><small>NEW EXPIRY NOTICE</small><strong>新增即期品</strong></div>
              <button type="button" onClick={() => setComposer(null)} aria-label="關閉新增即期品表單">×</button>
            </header>
            <div className="bulletin-composer-grid">
              <label>Amazon 站點
                <select
                  name="marketplaceId"
                  value={expiryDraft.marketplaceId}
                  onChange={(event) => {
                    const marketplaceId = event.currentTarget.value;
                    setExpiryDraft((current) => ({
                      ...current,
                      marketplaceId,
                    }));
                  }}
                >
                  {MARKETPLACES.map((marketplace) => (
                    <option key={marketplace.id} value={marketplace.id}>
                      {marketplace.shortLabel} · {marketplace.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>Seller SKU
                <input
                  name="sellerSku"
                  value={expiryDraft.sellerSku}
                  maxLength={40}
                  required
                  placeholder="例如 ASCL01"
                  onChange={(event) => {
                    const sellerSku = event.currentTarget.value;
                    setExpiryDraft((current) => ({
                      ...current,
                      sellerSku,
                    }));
                  }}
                />
              </label>
              <label>效期
                <input
                  name="expiryDate"
                  type="date"
                  min={calendarBounds.min}
                  max={calendarBounds.max}
                  value={expiryDraft.expiryDate}
                  required
                  onChange={(event) => {
                    const expiryDate = event.currentTarget.value;
                    setExpiryDraft((current) => ({
                      ...current,
                      expiryDate,
                    }));
                  }}
                />
              </label>
              <label>停售日（選填）
                <input
                  name="stopSaleDate"
                  type="date"
                  min={calendarBounds.min}
                  max={expiryDraft.expiryDate || calendarBounds.max}
                  value={expiryDraft.stopSaleDate}
                  onChange={(event) => {
                    const stopSaleDate = event.currentTarget.value;
                    setExpiryDraft((current) => ({
                      ...current,
                      stopSaleDate,
                    }));
                  }}
                />
              </label>
              <label className="bulletin-composer-note">備註（選填）
                <textarea
                  name="note"
                  value={expiryDraft.note}
                  maxLength={500}
                  placeholder="例如：先出舊批次"
                  onChange={(event) => {
                    const note = event.currentTarget.value;
                    setExpiryDraft((current) => ({
                      ...current,
                      note,
                    }));
                  }}
                />
              </label>
            </div>
            <footer>
              <small>公告只會公開 SKU、日期與備註；Amazon 庫存、價格與憑證不會上傳。</small>
              <button type="submit" disabled={publisherBusy}>
                {publisherBusy ? "正在開啟…" : "登入並確認發布"}
              </button>
            </footer>
          </form>
        )}

        {composer === "promotion" && (
          <form
            className="bulletin-composer"
            aria-label="新增促銷公告"
            onSubmit={(event) => void publishDraft(event)}
          >
            <header>
              <div><small>NEW PROMOTION DATE</small><strong>新增促銷</strong></div>
              <button type="button" onClick={() => setComposer(null)} aria-label="關閉新增促銷表單">×</button>
            </header>
            <div className="bulletin-composer-grid">
              <label>促銷開始日
                <BulletinDatePicker
                  name="promotionStartDate"
                  ariaLabel="選擇促銷開始日"
                  value={promotionDraft.startDate}
                  min={calendarBounds.min}
                  max={calendarBounds.max}
                  todayDateKey={todayDateKey}
                  onSelect={(startDate) => {
                    setPromotionDraft((current) => ({
                      ...current,
                      startDate,
                      endDate: current.endDate && current.endDate < startDate
                        ? ""
                        : current.endDate,
                    }));
                  }}
                />
              </label>
              <label>促銷結束日（選填）
                <BulletinDatePicker
                  name="promotionEndDate"
                  ariaLabel="選擇促銷結束日"
                  value={promotionDraft.endDate}
                  min={promotionDraft.startDate || calendarBounds.min}
                  max={calendarBounds.max}
                  todayDateKey={todayDateKey}
                  onSelect={(endDate) => {
                    setPromotionDraft((current) => ({
                      ...current,
                      endDate,
                    }));
                  }}
                  onClear={() => {
                    setPromotionDraft((current) => ({
                      ...current,
                      endDate: "",
                    }));
                  }}
                />
              </label>
              <label>促銷名稱
                <input
                  name="promotionTitle"
                  value={promotionDraft.title}
                  maxLength={120}
                  required
                  placeholder="例如 Prime Big Deal Days"
                  onChange={(event) => {
                    const title = event.currentTarget.value;
                    setPromotionDraft((current) => ({
                      ...current,
                      title,
                    }));
                  }}
                />
              </label>
              <label className="bulletin-composer-note">備註（選填）
                <textarea
                  name="promotionNote"
                  value={promotionDraft.note}
                  maxLength={500}
                  placeholder="例如：提前確認折扣與備貨"
                  onChange={(event) => {
                    const note = event.currentTarget.value;
                    setPromotionDraft((current) => ({
                      ...current,
                      note,
                    }));
                  }}
                />
              </label>
              <label className="bulletin-composer-check">
                <input
                  name="countdown"
                  type="checkbox"
                  checked={promotionDraft.countdown}
                  onChange={(event) => {
                    const countdown = event.currentTarget.checked;
                    setPromotionDraft((current) => ({
                      ...current,
                      countdown,
                    }));
                  }}
                />
                另外顯示促銷倒數
              </label>
            </div>
            <footer>
              <small>
                公告只會公開促銷名稱、日期與備註；Amazon 庫存、價格與憑證不會上傳。月曆一定會顯示，勾選後才另外顯示倒數。
              </small>
              <button type="submit" disabled={publisherBusy}>
                {publisherBusy ? "正在開啟…" : "登入並確認發布"}
              </button>
            </footer>
          </form>
        )}

        <div className="operations-bulletin-layout">
          <section className="bulletin-expiry-section" aria-labelledby="bulletin-expiry-title">
            <header>
              <div>
                <small>MANUAL EXPIRY WATCH</small>
                <h3 id="bulletin-expiry-title">即期品倒數</h3>
              </div>
              <span>{expiryItems.length.toLocaleString("zh-TW")} 個 SKU</span>
            </header>
            {expiryItems.length === 0 ? (
              <div className="bulletin-empty">
                <strong>目前沒有即期品公告</strong>
                <p>按「新增即期品」填入 SKU、效期與備註即可。</p>
              </div>
            ) : (
              <div className="bulletin-expiry-list">
                {expiryItems.map((item) => (
                  <article className="bulletin-expiry-item" key={item.id}>
                    <ExpiryCountdown item={item} todayDateKey={todayDateKey} />
                    <div className="bulletin-expiry-copy">
                      <div className="bulletin-expiry-title-row">
                        <div>
                          <small>
                            <span className="bulletin-marketplace-code">
                              {marketplaceShortLabel(item.marketplaceId)}
                            </span>
                            SELLER SKU
                          </small>
                          <h4 title={item.sellerSku}>{item.sellerSku}</h4>
                        </div>
                        <button
                          type="button"
                          className="bulletin-manage"
                          onClick={() => void manageAnnouncement(item.id)}
                          disabled={publisherBusy}
                        >編輯／刪除</button>
                      </div>
                      <div className="bulletin-expiry-meta">
                        {item.stopSaleDate && (
                          <span className="bulletin-expiry-date">
                            <small>停售日</small>
                            <time dateTime={item.stopSaleDate}>
                              {absoluteDateLabel(item.stopSaleDate)}
                            </time>
                          </span>
                        )}
                        <span className="bulletin-expiry-date">
                          <small>產品效期</small>
                          <time dateTime={item.expiryDate}>
                            {absoluteDateLabel(item.expiryDate)}
                          </time>
                        </span>
                        {item.note && (
                          <span className="bulletin-expiry-note" title={item.note}>
                            {item.note}
                          </span>
                        )}
                      </div>
                      <SkuFactFields fact={skuFacts[item.id]} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="bulletin-calendar-section" aria-labelledby="bulletin-calendar-title">
            <header>
              <div>
                <small>AMAZON EVENT CALENDAR</small>
                <h3 id="bulletin-calendar-title">促銷月曆</h3>
              </div>
              <div className="bulletin-calendar-navigation">
                <BulletinDatePicker
                  ariaLabel="選擇月曆日期"
                  value={calendarDate}
                  min={calendarBounds.min}
                  max={calendarBounds.max}
                  todayDateKey={todayDateKey}
                  displayValue={(dateKey) => monthLabel(dateKey.slice(0, 7))}
                  onSelect={(dateKey) => {
                    setCalendarDate(dateKey);
                    setCalendarMonth(dateKey.slice(0, 7));
                  }}
                />
              </div>
            </header>

            <div className="bulletin-calendar-scroll">
              <table className="bulletin-calendar">
                <caption className="visually-hidden">
                  {monthLabel(calendarMonth)} Amazon 促銷檔期與 SKU 停售、到期日
                </caption>
                <colgroup>{WEEKDAY_LABELS.map((day) => <col key={day} />)}</colgroup>
                <thead><tr>{WEEKDAY_LABELS.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
                <tbody>
                  {Array.from({ length: calendarCells.length / 7 }, (_, week) => (
                    <tr key={week}>
                      {calendarCells.slice(week * 7, week * 7 + 7).map((dateKey) => {
                        const entries = entriesByDate.get(dateKey) ?? [];
                        const kinds = new Set(entries.map((entry) => entry.kind));
                        return (
                          <td
                            key={dateKey}
                            className={`${dateKey.startsWith(`${calendarMonth}-`) ? "" : "is-other-month"}${dateKey === todayDateKey ? " is-today" : ""}${dateKey === calendarDate ? " is-selected" : ""}${kinds.has("promotion") ? " has-promotion" : ""}${kinds.has("expiry") ? " has-expiry" : ""}${kinds.has("stop-sale") ? " has-stop-sale" : ""}`.trim()}
                          >
                            <time dateTime={dateKey}>{Number(dateKey.slice(-2))}</time>
                            {entries.length > 0 && (
                              <ul aria-label={`${absoluteDateLabel(dateKey)}的營運公告：${entries.map((entry) => entry.label).join("、")}`}>
                                {entries.slice(0, 2).map((entry) => (
                                  <li className={`is-${entry.kind}`} key={entry.id}>
                                    {entry.label}
                                  </li>
                                ))}
                                {entries.length > 2 && (
                                  <li className="is-more">+{entries.length - 2} 項</li>
                                )}
                              </ul>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bulletin-calendar-legend" aria-label="月曆標記圖例">
              <span><i className="is-promotion" aria-hidden="true" />促銷檔期</span>
              <span><i className="is-stop-sale" aria-hidden="true" />SKU 停售</span>
              <span><i className="is-expiry" aria-hidden="true" />SKU 到期</span>
            </div>

            {currentMonthEntries.length === 0 ? (
              <div className="bulletin-empty compact">
                <strong>{monthLabel(calendarMonth)}尚未安排促銷或 SKU 重要日期</strong>
                <p>按上方日期按鈕即可選擇其他月份。</p>
              </div>
            ) : (
              <div
                className="bulletin-calendar-agenda"
                role="region"
                aria-label={`${monthLabel(calendarMonth)}完整營運日程`}
                tabIndex={0}
              >
                {currentMonthEntries.map((entry) => {
                  const countdown = entry.kind === "promotion" && entry.item.countdown
                    ? promotionCountdownPresentation(entry.item, todayDateKey)
                    : null;
                  return (
                    <article data-entry-kind={entry.kind} key={entry.id}>
                      <time dateTime={entry.date}>
                        {entry.kind === "promotion"
                          ? promotionDateLabel(entry.item)
                          : absoluteDateLabel(entry.date)}
                      </time>
                      <div>
                        <strong>{entry.label}</strong>
                        {entry.item.note && <p>{entry.item.note}</p>}
                      </div>
                      {entry.kind === "expiry" ? (
                        <span className="is-expiry">效期</span>
                      ) : entry.kind === "stop-sale" ? (
                        <span className="is-stop-sale">停售</span>
                      ) : countdown ? (
                        <span data-countdown-state={countdown.state}>{countdown.label}</span>
                      ) : null}
                      <button
                        type="button"
                        className="bulletin-manage"
                        onClick={() => void manageAnnouncement(entry.item.id)}
                        disabled={publisherBusy}
                      >編輯／刪除</button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {response && itemCount === 0 && (
          <p className="operations-bulletin-empty-summary">
            尚未公布即期品或促銷檔期。
          </p>
        )}
      </div>
    </details>
  );
}
