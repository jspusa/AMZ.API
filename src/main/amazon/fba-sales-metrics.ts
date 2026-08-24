import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  FBA_SALES_VELOCITY_COMPLETED_DAY_COUNT,
  planCompletedFbaSalesVelocity,
  planFbaSalesTrend,
  type SalesTrendComparisonMode,
  type SalesTrendPresetDays,
  type SalesTrendRange,
  type SalesTrendWindow,
} from "./fba-sales-calendar";
import { marketplaceCalendar } from "./marketplace-calendar";

export type SalesTrendMoney = {
  amount: number;
  currencyCode: string;
};

export type SalesTrendPoint = {
  date: string;
  interval: string;
  totalSales: SalesTrendMoney;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
  partial: boolean;
};

export type SalesTrendTotals = {
  totalSales: SalesTrendMoney;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
};

export type SalesTrendSnapshot = {
  schemaVersion: 2;
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  days: number;
  range: SalesTrendRange;
  timeZone: string;
  points: SalesTrendPoint[];
  totals: SalesTrendTotals;
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  comparison: null | {
    kind: "previous-year";
    range: SalesTrendRange;
    points: SalesTrendPoint[];
    totals: SalesTrendTotals;
    requestId: string | null;
    rateLimit: string | null;
  };
  notice: string;
};

export type FbaSalesDailyReadPlan = {
  marketplaceId: MarketplaceId;
  window: SalesTrendWindow;
  sellerSku: string | null;
  series: "current" | "previous-year" | "velocity";
  trendDayCount: number;
};

export type FbaSalesDailyReadIdentity = {
  marketplaceId: MarketplaceId;
  sellerSku: string | null;
  series: FbaSalesDailyReadPlan["series"];
  startAt: string;
  endAt: string;
  timeZone: string;
};

export type FbaSalesDailyReadResult = {
  identity: FbaSalesDailyReadIdentity;
  envelope: unknown;
  requestId: string | null;
  rateLimit: string | null;
};

export type FbaSalesMetricsAdapter = {
  readDaily(plan: FbaSalesDailyReadPlan): Promise<FbaSalesDailyReadResult>;
};

export type ReadFbaSalesTrendInput = {
  marketplaceId: MarketplaceId;
  days?: SalesTrendPresetDays | null;
  startDate?: string | null;
  endDate?: string | null;
  comparison?: SalesTrendComparisonMode;
};

export type FbaSalesVelocityResult = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  completedDayCount: typeof FBA_SALES_VELOCITY_COMPLETED_DAY_COUNT;
  units: number;
  averageDailyUnits: number;
  orderCount: number;
  requestId: string | null;
  rateLimit: string | null;
};

export class FbaSalesMetricsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfter: string | null;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      requestId?: string | null;
      retryAfter?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "FbaSalesMetricsError";
    this.status = options.status ?? 502;
    this.code = options.code ?? "UPSTREAM_UNAVAILABLE";
    this.requestId = options.requestId ?? null;
    this.retryAfter = options.retryAfter ?? null;
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumericValue(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  const number = finiteNumericValue(value);
  return number !== null && Number.isInteger(number) && number >= 0
    ? number
    : null;
}

function invalidEnvelope(): never {
  throw new FbaSalesMetricsError(
    "Amazon 回傳了無法辨識的 FBA 銷售趨勢。",
  );
}

export function fbaSalesDailyReadIdentity(
  plan: FbaSalesDailyReadPlan,
): FbaSalesDailyReadIdentity {
  return {
    marketplaceId: plan.marketplaceId,
    sellerSku: plan.sellerSku,
    series: plan.series,
    startAt: plan.window.startAt,
    endAt: plan.window.endAt,
    timeZone: plan.window.timeZone,
  };
}

function assertDailyReadIdentity(
  plan: FbaSalesDailyReadPlan,
  result: FbaSalesDailyReadResult,
): void {
  const expected = fbaSalesDailyReadIdentity(plan);
  if (
    !result.identity ||
    result.identity.marketplaceId !== expected.marketplaceId ||
    result.identity.sellerSku !== expected.sellerSku ||
    result.identity.series !== expected.series ||
    result.identity.startAt !== expected.startAt ||
    result.identity.endAt !== expected.endAt ||
    result.identity.timeZone !== expected.timeZone
  ) {
    invalidEnvelope();
  }
}

function metricInterval(
  value: unknown,
  marketplaceId: MarketplaceId,
): { date: string; startTime: number; endTime: number } | null {
  if (typeof value !== "string") return null;
  const delimiter = value.indexOf("--", 10);
  if (delimiter < 0) return null;
  const startInstant = new Date(value.slice(0, delimiter));
  const endInstant = new Date(value.slice(delimiter + 2));
  if (
    Number.isNaN(startInstant.getTime()) ||
    Number.isNaN(endInstant.getTime()) ||
    startInstant.getTime() >= endInstant.getTime()
  ) {
    return null;
  }
  const calendar = marketplaceCalendar(marketplaceId);
  const localStart = calendar.partsAt(startInstant);
  if (
    localStart.hour !== 0 ||
    localStart.minute !== 0 ||
    localStart.second !== 0
  ) {
    return null;
  }
  return {
    date: calendar.dayAt(startInstant),
    startTime: startInstant.getTime(),
    endTime: endInstant.getTime(),
  };
}

function totalSalesTrendPoints(
  points: SalesTrendPoint[],
  currencyCode: string,
): SalesTrendTotals {
  const aggregate = points.reduce(
    (result, point) => ({
      amount: result.amount + point.totalSales.amount,
      unitCount: result.unitCount + point.unitCount,
      orderItemCount: result.orderItemCount + point.orderItemCount,
      orderCount: result.orderCount + point.orderCount,
    }),
    { amount: 0, unitCount: 0, orderItemCount: 0, orderCount: 0 },
  );
  return {
    totalSales: {
      amount: Number(aggregate.amount.toFixed(currencyCode === "JPY" ? 0 : 2)),
      currencyCode,
    },
    unitCount: aggregate.unitCount,
    orderItemCount: aggregate.orderItemCount,
    orderCount: aggregate.orderCount,
  };
}

function normalizeFbaSalesDailyEnvelope(input: {
  envelope: unknown;
  marketplaceId: MarketplaceId;
  window: SalesTrendWindow;
}): { points: SalesTrendPoint[]; totals: SalesTrendTotals } {
  if (!isRecord(input.envelope)) invalidEnvelope();
  const errors = input.envelope.errors;
  if (errors !== undefined && !Array.isArray(errors)) invalidEnvelope();
  if (Array.isArray(errors) && errors.length) {
    const upstreamMessage = errors.find(
      (error) =>
        isRecord(error) &&
        typeof error.message === "string" &&
        error.message.trim(),
    );
    throw new FbaSalesMetricsError(
      (isRecord(upstreamMessage) && typeof upstreamMessage.message === "string"
        ? upstreamMessage.message.trim()
        : "") || "Amazon 無法完成 FBA 銷售趨勢查詢。",
    );
  }
  if (!Array.isArray(input.envelope.payload)) invalidEnvelope();

  const currencyCode = marketplaceById(input.marketplaceId)?.currency;
  if (!currencyCode) invalidEnvelope();
  const expectedDates = new Set(input.window.dateKeys);
  const expectedIntervals = new Map(
    input.window.dateKeys.map((date, index) => {
      const interval = input.window.intervals[index];
      const delimiter = interval?.indexOf("--", 10) ?? -1;
      return [
        date,
        delimiter < 0
          ? null
          : {
              startTime: Date.parse(interval.slice(0, delimiter)),
              endTime: Date.parse(interval.slice(delimiter + 2)),
            },
      ] as const;
    }),
  );
  const byDate = new Map<string, SalesTrendPoint>();
  for (const rawMetric of input.envelope.payload) {
    if (!isRecord(rawMetric)) invalidEnvelope();
    const totalSales = rawMetric.totalSales;
    const parsedInterval = metricInterval(
      rawMetric.interval,
      input.marketplaceId,
    );
    const date = parsedInterval?.date ?? null;
    const expectedInterval = date ? expectedIntervals.get(date) : null;
    const amount = isRecord(totalSales)
      ? finiteNumericValue(totalSales.amount)
      : null;
    const unitCount = finiteNonNegativeInteger(rawMetric.unitCount);
    const orderItemCount = finiteNonNegativeInteger(rawMetric.orderItemCount);
    const orderCount = finiteNonNegativeInteger(rawMetric.orderCount);
    if (
      !date ||
      !expectedDates.has(date) ||
      !parsedInterval ||
      !expectedInterval ||
      parsedInterval.startTime !== expectedInterval.startTime ||
      parsedInterval.endTime !== expectedInterval.endTime ||
      byDate.has(date) ||
      amount === null ||
      amount < 0 ||
      !isRecord(totalSales) ||
      totalSales.currencyCode !== currencyCode ||
      unitCount === null ||
      orderItemCount === null ||
      orderCount === null ||
      typeof rawMetric.interval !== "string"
    ) {
      invalidEnvelope();
    }
    byDate.set(date, {
      date,
      interval: rawMetric.interval,
      totalSales: { amount, currencyCode },
      unitCount,
      orderItemCount,
      orderCount,
      partial: date === input.window.partialDateKey,
    });
  }

  const points = input.window.dateKeys.map((date, index) =>
    byDate.get(date) ?? {
      date,
      interval: input.window.intervals[index],
      totalSales: { amount: 0, currencyCode },
      unitCount: 0,
      orderItemCount: 0,
      orderCount: 0,
      partial: date === input.window.partialDateKey,
    },
  );
  return {
    points,
    totals: totalSalesTrendPoints(points, currencyCode),
  };
}

export async function readFbaSalesTrend(
  input: ReadFbaSalesTrendInput,
  context: {
    adapter: FbaSalesMetricsAdapter;
    mode: "live" | "demo";
    clock?: () => Date;
    demoNotice?: string;
  },
): Promise<SalesTrendSnapshot> {
  const clock = context.clock ?? (() => new Date());
  const plan = planFbaSalesTrend(input, clock());
  const currentReadPlan = {
    marketplaceId: input.marketplaceId,
    window: plan.window,
    sellerSku: null,
    series: "current",
    trendDayCount: plan.range.dayCount,
  } satisfies FbaSalesDailyReadPlan;
  const currentResult = await context.adapter.readDaily(currentReadPlan);
  assertDailyReadIdentity(currentReadPlan, currentResult);
  const current = normalizeFbaSalesDailyEnvelope({
    envelope: currentResult.envelope,
    marketplaceId: input.marketplaceId,
    window: plan.window,
  });
  const previousReadPlan = plan.comparisonWindow
    ? ({
        marketplaceId: input.marketplaceId,
        window: plan.comparisonWindow,
        sellerSku: null,
        series: "previous-year",
        trendDayCount: plan.range.dayCount,
      } satisfies FbaSalesDailyReadPlan)
    : null;
  const previousResult = previousReadPlan
    ? await context.adapter.readDaily(previousReadPlan)
    : null;
  if (previousReadPlan && previousResult) {
    assertDailyReadIdentity(previousReadPlan, previousResult);
  }
  const rawPrevious =
    previousResult && plan.comparisonWindow
      ? normalizeFbaSalesDailyEnvelope({
          envelope: previousResult.envelope,
          marketplaceId: input.marketplaceId,
          window: plan.comparisonWindow,
        })
      : null;
  const comparableDates = new Set(
    plan.comparablePreviousYearDateKeys ?? [],
  );
  const previousPoints = rawPrevious
    ? rawPrevious.points.filter((point) => comparableDates.has(point.date))
    : null;
  const previousRange =
    previousPoints && plan.comparisonWindow
      ? {
          startDate:
            previousPoints[0]?.date ??
            plan.comparisonWindow.range.startDate,
          endDate:
            previousPoints.at(-1)?.date ??
            plan.comparisonWindow.range.endDate,
          dayCount: previousPoints.length,
          presetDays: null,
        }
      : null;
  const previousTotals =
    previousPoints && rawPrevious
      ? totalSalesTrendPoints(
          previousPoints,
          rawPrevious.totals.totalSales.currencyCode,
        )
      : null;
  const notice =
    context.mode === "live"
      ? plan.comparisonNotice
        ? `Sales API 以站點當地日界彙總；僅包含 Amazon 配送（AFN/FBA）。${plan.comparisonNotice}`
        : "Sales API 以站點當地日界彙總；僅包含 Amazon 配送（AFN/FBA），今日數字仍會變動。"
      : `${context.demoNotice ?? "顯示展示趨勢。"}${
          plan.comparisonNotice ? ` ${plan.comparisonNotice}` : ""
        }`;
  return {
    schemaVersion: 2,
    mode: context.mode,
    marketplaceId: input.marketplaceId,
    days: plan.range.dayCount,
    range: plan.range,
    timeZone: plan.window.timeZone,
    points: current.points,
    totals: current.totals,
    fetchedAt: clock().toISOString(),
    requestId: currentResult.requestId,
    rateLimit: currentResult.rateLimit,
    comparison:
      previousResult && previousPoints && previousRange && previousTotals
        ? {
            kind: "previous-year",
            range: previousRange,
            points: previousPoints,
            totals: previousTotals,
            requestId: previousResult.requestId,
            rateLimit: previousResult.rateLimit,
          }
        : null,
    notice,
  };
}

export async function readFbaSalesVelocity(
  input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
  },
  context: {
    adapter: FbaSalesMetricsAdapter;
    clock?: () => Date;
  },
): Promise<FbaSalesVelocityResult> {
  const clock = context.clock ?? (() => new Date());
  const plan = planCompletedFbaSalesVelocity(input, clock());
  const readPlan = {
    marketplaceId: plan.marketplaceId,
    window: plan.window,
    sellerSku: plan.sellerSku,
    series: "velocity",
    trendDayCount: plan.completedDayCount,
  } satisfies FbaSalesDailyReadPlan;
  const result = await context.adapter.readDaily(readPlan);
  assertDailyReadIdentity(readPlan, result);
  const normalized = normalizeFbaSalesDailyEnvelope({
    envelope: result.envelope,
    marketplaceId: plan.marketplaceId,
    window: plan.window,
  });
  const units = normalized.totals.unitCount;
  return {
    marketplaceId: plan.marketplaceId,
    sellerSku: plan.sellerSku,
    completedDayCount: plan.completedDayCount,
    units,
    averageDailyUnits: units / plan.completedDayCount,
    orderCount: normalized.totals.orderCount,
    requestId: result.requestId,
    rateLimit: result.rateLimit,
  };
}
