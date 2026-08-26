import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { throwIfAborted } from "../abort-utils";
import {
  strictReportDateKey,
  strictReportInstant,
} from "./revenue-report-windows";
import { SpApiError } from "./sp-api-error";

const SALES_AND_TRAFFIC_REPORT_TYPE = "GET_SALES_AND_TRAFFIC_REPORT";
const SALES_AND_TRAFFIC_REPORT_OPTIONS = Object.freeze({
  dateGranularity: "DAY",
  asinGranularity: "SKU",
});
const MAX_SALES_AND_TRAFFIC_ROWS = 100_000;

export type SalesAndTrafficRow = Readonly<{
  sellerSku: string;
  childAsin: string;
  unitsOrdered: number;
  orderedProductSales: number;
  currencyCode: string;
}>;

export type SalesAndTrafficSnapshot = Readonly<{
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  rows: SalesAndTrafficRow[];
  notice: string;
}>;

export function projectSalesAndTrafficSnapshot(
  value: unknown,
  expected: Readonly<{
    mode: "live" | "demo";
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
  }>,
): SalesAndTrafficSnapshot {
  const snapshot = record(value);
  if (
    !snapshot ||
    snapshot.mode !== expected.mode ||
    snapshot.marketplaceId !== expected.marketplaceId ||
    snapshot.startDate !== expected.startDate ||
    snapshot.endDate !== expected.endDate
  ) {
    throw new SpApiError("銷售與流量讀取結果與固定報表工作不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  const marketplace = marketplaceById(expected.marketplaceId);
  if (
    !marketplace ||
    strictReportInstant(snapshot.fetchedAt) === null ||
    typeof snapshot.notice !== "string" ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length > MAX_SALES_AND_TRAFFIC_ROWS
  ) {
    throw new SpApiError("銷售與流量讀取結果格式無法安全辨識。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  const seen = new Set<string>();
  const rows = snapshot.rows.map((value): SalesAndTrafficRow => {
    const row = record(value);
    const sellerSku = row?.sellerSku;
    const childAsin = row?.childAsin;
    const unitsOrdered = row?.unitsOrdered;
    const orderedProductSales = row?.orderedProductSales;
    if (
      !row ||
      typeof sellerSku !== "string" ||
      !sellerSku ||
      sellerSku.length > 40 ||
      sellerSku !== sellerSku.trim() ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(sellerSku) ||
      seen.has(sellerSku) ||
      typeof childAsin !== "string" ||
      !/^[A-Z0-9]{10}$/u.test(childAsin) ||
      !Number.isSafeInteger(unitsOrdered) ||
      (unitsOrdered as number) < 0 ||
      (unitsOrdered as number) > 1_000_000_000_000 ||
      typeof orderedProductSales !== "number" ||
      !Number.isFinite(orderedProductSales) ||
      orderedProductSales < 0 ||
      orderedProductSales > 1_000_000_000_000 ||
      row.currencyCode !== marketplace.currency
    ) {
      throw new SpApiError("銷售與流量讀取結果含有無效 SKU 資料。", {
        status: 502,
        code: "REPORT_FORMAT_UNSUPPORTED",
      });
    }
    seen.add(sellerSku);
    return Object.freeze({
      sellerSku,
      childAsin,
      unitsOrdered: unitsOrdered as number,
      orderedProductSales,
      currencyCode: marketplace.currency,
    });
  });
  return Object.freeze({
    mode: expected.mode,
    marketplaceId: expected.marketplaceId,
    startDate: expected.startDate,
    endDate: expected.endDate,
    fetchedAt: snapshot.fetchedAt as string,
    rows,
    notice: snapshot.notice,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredObject(value: unknown, message: string): Record<string, unknown> {
  const parsed = record(value);
  if (!parsed) {
    throw new SpApiError(message, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return parsed;
}

function exactOptions(value: unknown): boolean {
  const options = record(value);
  return Boolean(
    options &&
    Object.keys(options).length === 2 &&
    options.dateGranularity === SALES_AND_TRAFFIC_REPORT_OPTIONS.dateGranularity &&
    options.asinGranularity === SALES_AND_TRAFFIC_REPORT_OPTIONS.asinGranularity,
  );
}

function reportNumber(value: unknown, label: string, integer = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1_000_000_000_000 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new SpApiError(`Amazon 銷售與流量報表的${label}無法安全辨識。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

export function parseSalesAndTrafficReportDocument(input: Readonly<{
  text: string;
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
}>): SalesAndTrafficRow[] {
  let value: unknown;
  try {
    value = JSON.parse(input.text.replace(/^\ufeff/u, ""));
  } catch {
    throw new SpApiError("Amazon 銷售與流量報表不是有效的 JSON。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  const root = requiredObject(value, "Amazon 銷售與流量報表格式無效。");
  const specification = requiredObject(
    root.reportSpecification,
    "Amazon 銷售與流量報表缺少固定查詢規格。",
  );
  if (
    strictReportDateKey(input.startDate) !== input.startDate ||
    strictReportDateKey(input.endDate) !== input.endDate ||
    specification.reportType !== SALES_AND_TRAFFIC_REPORT_TYPE ||
    !exactOptions(specification.reportOptions) ||
    strictReportDateKey(specification.dataStartTime) !== input.startDate ||
    strictReportDateKey(specification.dataEndTime) !== input.endDate ||
    !Array.isArray(specification.marketplaceIds) ||
    specification.marketplaceIds.length !== 1 ||
    specification.marketplaceIds[0] !== input.marketplaceId ||
    !Array.isArray(root.salesAndTrafficByAsin) ||
    root.salesAndTrafficByAsin.length > MAX_SALES_AND_TRAFFIC_ROWS
  ) {
    throw new SpApiError("Amazon 銷售與流量報表與目前站點、日期或 SKU 粒度不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  const marketplace = marketplaceById(input.marketplaceId);
  if (!marketplace) {
    throw new SpApiError("Amazon 銷售與流量報表站點無法辨識。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  const seen = new Set<string>();
  const rows = root.salesAndTrafficByAsin.map((raw): SalesAndTrafficRow => {
    const row = requiredObject(raw, "Amazon 銷售與流量報表含有無效商品列。");
    const sellerSku = typeof row.sku === "string" ? row.sku.trim() : "";
    const childAsin = typeof row.childAsin === "string" ? row.childAsin.trim() : "";
    if (
      !sellerSku ||
      sellerSku.length > 40 ||
      sellerSku !== row.sku ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(sellerSku) ||
      childAsin !== row.childAsin ||
      !/^[A-Z0-9]{10}$/u.test(childAsin) ||
      seen.has(sellerSku)
    ) {
      throw new SpApiError("Amazon 銷售與流量報表的 SKU／ASIN 無法唯一辨識。", {
        status: 502,
        code: "REPORT_FORMAT_UNSUPPORTED",
      });
    }
    const sales = requiredObject(
      row.salesByAsin,
      "Amazon 銷售與流量報表缺少 SKU 銷售資料。",
    );
    const money = requiredObject(
      sales.orderedProductSales,
      "Amazon 銷售與流量報表缺少 SKU 銷售額。",
    );
    const currencyCode = typeof money.currencyCode === "string"
      ? money.currencyCode.trim()
      : "";
    if (currencyCode !== marketplace.currency) {
      throw new SpApiError("Amazon 銷售與流量報表幣別與目前站點不一致。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    seen.add(sellerSku);
    return Object.freeze({
      sellerSku,
      childAsin,
      unitsOrdered: reportNumber(sales.unitsOrdered, "已售出單位", true),
      orderedProductSales: reportNumber(money.amount, "銷售額"),
      currencyCode,
    });
  });
  return rows.sort((left, right) => left.sellerSku.localeCompare(right.sellerSku));
}

export function readSalesAndTrafficDocument(input: Readonly<{
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  document: string;
  signal?: AbortSignal;
  now?: Date;
}>): SalesAndTrafficSnapshot {
  throwIfAborted(input.signal);
  const rows = parseSalesAndTrafficReportDocument({
    text: input.document,
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  throwIfAborted(input.signal);
  return Object.freeze({
    mode: "live",
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
    fetchedAt: (input.now ?? new Date()).toISOString(),
    rows,
    notice: "銷售與單位來自 Amazon Sales and Traffic Business Report 的 SKU 粒度完整日期範圍。",
  });
}
