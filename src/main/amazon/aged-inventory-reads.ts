import { throwIfAborted as assertNotAborted } from "../abort-utils";
import {
  MARKETPLACES as MARKETPLACE_METADATA,
  marketplaceById,
  type MarketplaceCode,
  type MarketplaceId,
} from "../../shared/marketplaces";
import type {
  ReportsRuntime,
  ReportsRuntimeReceipt,
} from "./reports-runtime";
import { SpApiError } from "./sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";

export type AgedInventoryBucket = {
  key: string;
  label: string;
  units: number;
  over180: boolean;
};

export type AgedInventorySurchargeBucket = {
  key: string;
  label: string;
  quantity: number | null;
  estimatedCharge: number | null;
};

export type AgedInventoryFeeAvailability =
  | "complete"
  | "partial"
  | "unavailable";

export type AgedInventoryRow = {
  sellerSku: string;
  fnSku: string;
  asin: string;
  title: string;
  condition: string;
  available: number | null;
  totalAgedUnits: number;
  agedOver180: number;
  ageBuckets: AgedInventoryBucket[];
  estimatedExcessQuantity: number | null;
  recommendedRemovalQuantity: number | null;
  daysOfSupply: number | null;
  currencyCode: string | null;
  estimatedStorageCostNextMonth: number | null;
  estimatedAgedSurcharge: number | null;
  agedSurchargeBuckets: AgedInventorySurchargeBucket[];
  alert: string;
  recommendedAction: string;
  snapshotDate: string | null;
};

export type AgedInventorySnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  rows: AgedInventoryRow[];
  summary: {
    skuCount: number;
    agedOver180SkuCount: number;
    totalAgedUnits: number;
    agedOver180: number;
    excessAvailability: AgedInventoryFeeAvailability;
    estimatedExcessQuantity: number | null;
    excessReportedSkuCount: number;
    currencyCode: string | null;
    storageCostAvailability: AgedInventoryFeeAvailability;
    estimatedStorageCostNextMonth: number | null;
    storageCostReportedSkuCount: number;
    agedSurchargeAvailability: AgedInventoryFeeAvailability;
    estimatedAgedSurcharge: number | null;
    agedSurchargeReportedSkuCount: number;
  };
  expiration: {
    currentFbaExpirationDatesAvailable: false;
    nearExpiryUnits: null;
    expiredUnits: null;
    inboundPlanExpirationDatesAvailable: true;
    notice: string;
  };
  notice: string;
};

type ReportsPort = Pick<
  ReportsRuntime,
  "start" | "read" | "status" | "readDocument"
>;

export interface AgedInventoryReadsPort {
  begin(input: Readonly<{
    marketplaceId: MarketplaceId;
    explicitRetry: boolean;
    freshCompleted?: boolean;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt>;

  status(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt>;

  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<AgedInventorySnapshot>;
}

type ParsedAgedInventoryReport = {
  rows: AgedInventoryRow[];
  storageCostCents: Array<number | null>;
  agedSurchargeCents: Array<number | null>;
  ageBucketKeys: string[];
  agedSurchargeBucketKeys: string[];
  excessAvailability: AgedInventoryFeeAvailability;
  storageCostAvailability: AgedInventoryFeeAvailability;
  agedSurchargeAvailability: AgedInventoryFeeAvailability;
  currencyCode: string | null;
};

type ReportAgeColumn = {
  key: string;
  header: string;
  label: string;
  over180: boolean;
  index: number;
};

type ReportSurchargeColumn = {
  key: string;
  label: string;
  quantityIndex: number;
  estimatedIndex: number;
};

const REGIONAL_AGED_INVENTORY_CODES = new Set<MarketplaceCode>([
  "US",
  "UK",
  "DE",
]);

const REGIONAL_AGED_INVENTORY_MARKETPLACES = new Set<MarketplaceId>(
  MARKETPLACE_METADATA.filter((marketplace) =>
    REGIONAL_AGED_INVENTORY_CODES.has(marketplace.code),
  ).map((marketplace) => marketplace.id),
);

const MAX_REPORT_CHARACTERS = 64 * 1024 * 1024;
const MAX_REPORT_ROWS = 20_001;
const MAX_REPORT_COLUMNS = 256;
const MAX_REPORT_FIELD_CHARACTERS = 64 * 1024;

function reportFormatUnsupported(message: string): never {
  throw new SpApiError(message, {
    status: 502,
    code: "REPORT_FORMAT_UNSUPPORTED",
  });
}

function fixedPlan(input: Readonly<{
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>) {
  return {
    intent: "aged-inventory" as const,
    marketplaceId: input.marketplaceId,
    signal: input.signal,
  };
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let closedQuotedField = false;
  const source = text.replace(/^\uFEFF/, "");
  const append = (character: string): void => {
    if (value.length >= MAX_REPORT_FIELD_CHARACTERS) {
      reportFormatUnsupported(
        "Amazon FBA 庫齡報表的單一欄位超過安全上限。",
      );
    }
    value += character;
  };
  const finishCell = (): void => {
    if (row.length >= MAX_REPORT_COLUMNS) {
      reportFormatUnsupported(
        "Amazon FBA 庫齡報表欄位數超過安全上限。",
      );
    }
    row.push(value);
    value = "";
    closedQuotedField = false;
  };
  const finishRow = (): void => {
    finishCell();
    if (row.some((cell) => cell.length > 0)) {
      if (rows.length >= MAX_REPORT_ROWS) {
        reportFormatUnsupported(
          "Amazon FBA 庫齡報表資料列數超過安全上限。",
        );
      }
      rows.push(row);
    }
    row = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        append('"');
        index += 1;
      } else if (quoted) {
        quoted = false;
        closedQuotedField = true;
      } else if (value.length === 0 && !closedQuotedField) {
        quoted = true;
      } else if (closedQuotedField) {
        reportFormatUnsupported(
          "Amazon FBA 庫齡報表引用欄位結尾後仍有無法辨識的文字。",
        );
      } else {
        append('"');
      }
    } else if (character === "\t" && !quoted) {
      finishCell();
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      if (closedQuotedField) {
        reportFormatUnsupported(
          "Amazon FBA 庫齡報表引用欄位結尾後仍有無法辨識的文字。",
        );
      }
      append(character);
    }
  }
  if (quoted) {
    reportFormatUnsupported(
      "Amazon FBA 庫齡報表含有未結束的引用欄位。",
    );
  }
  if (value.length || row.length) {
    finishRow();
  }
  return rows;
}

function normalizedReportHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function reportColumn(
  headerIndexes: ReadonlyMap<string, number>,
  candidates: string[],
): number {
  const matches = candidates
    .map((candidate) => headerIndexes.get(normalizedReportHeader(candidate)))
    .filter((index): index is number => index !== undefined);
  if (matches.length > 1) {
    reportFormatUnsupported(
      "Amazon FBA 庫齡報表包含重複或衝突欄位，已停止讀取。",
    );
  }
  return matches[0] ?? -1;
}

function reportIntegerCell(
  row: string[],
  index: number,
  label: string,
): number | null {
  if (index < 0) return null;
  const raw = row[index]?.trim() ?? "";
  if (!raw) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」不是有效數量。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  const normalized = raw.replace(/,/g, "");
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」超出安全範圍。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

function requiredReportIntegerCell(
  row: string[],
  index: number,
  label: string,
): number {
  const value = reportIntegerCell(row, index, label);
  if (value === null) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」缺值。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

function reportDecimalCell(
  row: string[],
  index: number,
  label: string,
): number | null {
  if (index < 0) return null;
  const raw = row[index]?.trim() ?? "";
  if (!raw) return null;
  if (
    !/^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(raw)
  ) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」不是有效數字。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  const normalized = raw.replace(/,/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」不是有效數字。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  if (value === 0 && /[1-9]/.test(normalized)) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」超出安全範圍。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

function reportMoneyCents(
  row: string[],
  index: number,
  label: string,
): number | null {
  if (index < 0) return null;
  const raw = row[index]?.trim() ?? "";
  if (!raw) return null;
  if (
    !/^(?:\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)$/.test(
      raw,
    )
  ) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」不是有效數字。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  const normalized = raw.replace(/,/g, "");
  const cents = exactCentsFromNormalizedMoney(normalized);
  if (cents === null || exactCentsFromNormalizedMoney(String(cents / 100)) !== cents) {
    throw new SpApiError(`Amazon FBA 庫齡報表的「${label}」超出安全範圍。`, {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return cents;
}

function exactCentsFromNormalizedMoney(normalized: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const significantWhole = whole.replace(/^0+/u, "") || "0";
  if (significantWhole.length > 14) return null;
  const exactCents =
    BigInt(significantWhole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return exactCents > BigInt(Number.MAX_SAFE_INTEGER)
    ? null
    : Number(exactCents);
}

function safeIntegerTotal(values: number[], label: string): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      reportFormatUnsupported(
        `Amazon FBA 庫齡報表的${label}加總超出安全範圍。`,
      );
    }
    const next = total + value;
    if (!Number.isSafeInteger(next)) {
      reportFormatUnsupported(
        `Amazon FBA 庫齡報表的${label}加總超出安全範圍。`,
      );
    }
    total = next;
  }
  return total;
}

function safeMoneyTotal(centsValues: number[], label: string): number {
  const cents = safeIntegerTotal(centsValues, label);
  const value = cents / 100;
  if (exactCentsFromNormalizedMoney(String(value)) !== cents) {
    reportFormatUnsupported(
      `Amazon FBA 庫齡報表的${label}加總超出安全範圍。`,
    );
  }
  return value;
}

function reportCurrencyCell(row: string[], index: number): string | null {
  if (index < 0) return null;
  const value = row[index]?.trim().toUpperCase() ?? "";
  if (!value) return null;
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new SpApiError("Amazon FBA 庫齡報表的幣別格式無效。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return value;
}

function feeAvailability(
  columnSetPresent: boolean,
  values: Array<number | null>,
): AgedInventoryFeeAvailability {
  if (!columnSetPresent) return "unavailable";
  return values.every((value) => value !== null) ? "complete" : "partial";
}

function validateAgedInventoryRegionSchema(
  parsed: ParsedAgedInventoryReport,
  marketplaceId: MarketplaceId,
): void {
  const expectsRegionalTail =
    REGIONAL_AGED_INVENTORY_MARKETPLACES.has(marketplaceId);
  const ageKeys = new Set(parsed.ageBucketKeys);
  const ageHasRegionalTail =
    ageKeys.has("366-455") && ageKeys.has("456-plus");
  const ageHasGlobalTail = ageKeys.has("365-plus");
  const surchargeKeys = new Set(parsed.agedSurchargeBucketKeys);
  const surchargeHasRegionalTail =
    surchargeKeys.has("366-455") && surchargeKeys.has("456-plus");
  const surchargeHasGlobalTail = surchargeKeys.has("365-plus");
  if (
    (expectsRegionalTail && (!ageHasRegionalTail || ageHasGlobalTail)) ||
    (!expectsRegionalTail && (!ageHasGlobalTail || ageHasRegionalTail)) ||
    (surchargeKeys.size > 0 &&
      ((expectsRegionalTail &&
        (!surchargeHasRegionalTail || surchargeHasGlobalTail)) ||
        (!expectsRegionalTail &&
          (!surchargeHasGlobalTail || surchargeHasRegionalTail))))
  ) {
    throw new SpApiError(
      "Amazon FBA 庫齡報表的區域庫齡欄位與目前站點不一致，已停止顯示。",
      { status: 409, code: "REPORT_MISMATCH" },
    );
  }
}

function parseAgedInventoryReportData(
  text: string,
  marketplaceId: MarketplaceId,
): ParsedAgedInventoryReport {
  if (text.length > MAX_REPORT_CHARACTERS) {
    reportFormatUnsupported(
      "Amazon FBA 庫齡報表內容超過安全大小上限。",
    );
  }
  const rows = parseTsv(text);
  const headers = rows[0] ?? [];
  const normalizedHeaders = headers.map(normalizedReportHeader);
  const headerIndexes = new Map<string, number>();
  for (const [index, header] of normalizedHeaders.entries()) {
    if (!header) continue;
    if (headerIndexes.has(header)) {
      reportFormatUnsupported(
        "Amazon FBA 庫齡報表包含重複或衝突欄位，已停止讀取。",
      );
    }
    headerIndexes.set(header, index);
  }
  if (rows.slice(1).some((row) => row.length !== headers.length)) {
    reportFormatUnsupported(
      "Amazon FBA 庫齡報表資料列的欄位數與標題列不一致。",
    );
  }
  const skuIndex = reportColumn(headerIndexes, [
    "sku",
    "seller-sku",
    "merchant-sku",
  ]);
  if (skuIndex < 0) {
    throw new SpApiError("Amazon FBA 庫齡報表找不到 Seller SKU 欄位。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }

  const ageColumns = (
    definitions: Array<Omit<ReportAgeColumn, "index">>,
  ): ReportAgeColumn[] =>
    definitions.map((item) => ({
      ...item,
      index: reportColumn(headerIndexes, [item.header]),
    }));
  const recentDetailedAgeColumns = ageColumns([
    {
      key: "0-30",
      header: "inv-age-0-to-30-days",
      label: "0–30 天",
      over180: false,
    },
    {
      key: "31-60",
      header: "inv-age-31-to-60-days",
      label: "31–60 天",
      over180: false,
    },
    {
      key: "61-90",
      header: "inv-age-61-to-90-days",
      label: "61–90 天",
      over180: false,
    },
  ]);
  const recentAggregateAgeColumn = ageColumns([
    {
      key: "0-90",
      header: "inv-age-0-to-90-days",
      label: "0–90 天",
      over180: false,
    },
  ])[0];
  const midAgeColumn = ageColumns([
    {
      key: "91-180",
      header: "inv-age-91-to-180-days",
      label: "91–180 天",
      over180: false,
    },
  ])[0];
  const standardBaseAgeColumns = ageColumns([
    {
      key: "181-270",
      header: "inv-age-181-to-270-days",
      label: "181–270 天",
      over180: true,
    },
    {
      key: "271-365",
      header: "inv-age-271-to-365-days",
      label: "271–365 天",
      over180: true,
    },
  ]);
  const alternateBaseAgeColumns = ageColumns([
    {
      key: "181-330",
      header: "inv-age-181-to-330-days",
      label: "181–330 天",
      over180: true,
    },
    {
      key: "331-365",
      header: "inv-age-331-to-365-days",
      label: "331–365 天",
      over180: true,
    },
  ]);
  const regionalTailAgeColumns = ageColumns([
    {
      key: "366-455",
      header: "inv-age-366-to-455-days",
      label: "366–455 天",
      over180: true,
    },
    {
      key: "456-plus",
      header: "inv-age-456-plus-days",
      label: "456 天以上",
      over180: true,
    },
  ]);
  const globalTailAgeColumn = ageColumns([
    {
      key: "365-plus",
      header: "inv-age-365-plus-days",
      label: "365 天以上（Amazon 欄位）",
      over180: true,
    },
  ])[0];

  const hasRecentDetailed = recentDetailedAgeColumns.every(
    (item) => item.index >= 0,
  );
  const selectedRecentAgeColumns = hasRecentDetailed
    ? recentDetailedAgeColumns
    : recentAggregateAgeColumn.index >= 0
      ? [recentAggregateAgeColumn]
      : [];
  const hasStandardBase = standardBaseAgeColumns.every(
    (item) => item.index >= 0,
  );
  const hasAlternateBase = alternateBaseAgeColumns.every(
    (item) => item.index >= 0,
  );
  const hasRegionalTail = regionalTailAgeColumns.every(
    (item) => item.index >= 0,
  );
  const hasGlobalTail = globalTailAgeColumn.index >= 0;

  // Amazon publishes overlapping aggregate and detailed bucket generations.
  // Select exactly one complete route so the same units cannot be counted twice.
  const selectedBaseAgeColumns = hasStandardBase
    ? standardBaseAgeColumns
    : hasAlternateBase
      ? alternateBaseAgeColumns
      : [];
  const selectedTailAgeColumns = hasRegionalTail
    ? regionalTailAgeColumns
    : hasGlobalTail
      ? [globalTailAgeColumn]
      : [];
  if (
    !selectedRecentAgeColumns.length ||
    midAgeColumn.index < 0 ||
    !selectedBaseAgeColumns.length ||
    !selectedTailAgeColumns.length
  ) {
    throw new SpApiError(
      "Amazon FBA 庫齡報表缺少完整且不重疊的庫齡區間，已停止顯示。",
      { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
    );
  }
  const selectedAgeColumns = [
    ...selectedRecentAgeColumns,
    midAgeColumn,
    ...selectedBaseAgeColumns,
    ...selectedTailAgeColumns,
  ];

  const surchargeColumns = (
    definitions: Array<{ key: string; label: string }>,
  ): ReportSurchargeColumn[] =>
    definitions.map((item) => ({
      ...item,
      quantityIndex: reportColumn(headerIndexes, [
        `quantity-to-be-charged-ais-${item.key}-days`,
      ]),
      estimatedIndex: reportColumn(headerIndexes, [
        `estimated-ais-${item.key}-days`,
      ]),
    }));
  const commonSurchargeColumns = surchargeColumns([
    { key: "181-210", label: "AIS 181–210 天" },
    { key: "211-240", label: "AIS 211–240 天" },
    { key: "241-270", label: "AIS 241–270 天" },
    { key: "271-300", label: "AIS 271–300 天" },
    { key: "301-330", label: "AIS 301–330 天" },
    { key: "331-365", label: "AIS 331–365 天" },
  ]);
  const regionalSurchargeTail = surchargeColumns([
    { key: "366-455", label: "AIS 366–455 天" },
    { key: "456-plus", label: "AIS 456 天以上" },
  ]);
  const globalSurchargeTail = surchargeColumns([
    { key: "365-plus", label: "AIS 365 天以上（Amazon 欄位）" },
  ]);
  const everySurchargeColumnPresent = (items: ReportSurchargeColumn[]) =>
    items.every((item) => item.quantityIndex >= 0 && item.estimatedIndex >= 0);
  const allSurchargeCandidates = [
    ...commonSurchargeColumns,
    ...regionalSurchargeTail,
    ...globalSurchargeTail,
  ];
  const anySurchargeColumnPresent = allSurchargeCandidates.some(
    (item) => item.quantityIndex >= 0 || item.estimatedIndex >= 0,
  );
  const selectedSurchargeTail = everySurchargeColumnPresent(
    regionalSurchargeTail,
  )
    ? regionalSurchargeTail
    : everySurchargeColumnPresent(globalSurchargeTail)
      ? globalSurchargeTail
      : [];
  const selectedSurchargeColumns = anySurchargeColumnPresent &&
      everySurchargeColumnPresent(commonSurchargeColumns) &&
      selectedSurchargeTail.length
    ? [...commonSurchargeColumns, ...selectedSurchargeTail]
    : [];
  if (anySurchargeColumnPresent && !selectedSurchargeColumns.length) {
    throw new SpApiError(
      "Amazon FBA 庫齡報表的 AIS 預估附加費欄位不完整，已停止加總。",
      { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
    );
  }

  const fnSkuIndex = reportColumn(headerIndexes, [
    "fnsku",
    "fulfillment-channel-sku",
  ]);
  const asinIndex = reportColumn(headerIndexes, ["asin"]);
  const titleIndex = reportColumn(headerIndexes, [
    "product-name",
    "item-name",
    "title",
  ]);
  const conditionIndex = reportColumn(headerIndexes, ["condition"]);
  const availableIndex = reportColumn(headerIndexes, ["available"]);
  const excessIndex = reportColumn(headerIndexes, [
    "estimated-excess-quantity",
  ]);
  const removalIndex = reportColumn(headerIndexes, [
    "recommended-removal-quantity",
  ]);
  const daysOfSupplyIndex = reportColumn(headerIndexes, [
    "days-of-supply",
    "total-days-of-supply-(including-units-from-open-shipments)",
  ]);
  const currencyIndex = reportColumn(headerIndexes, [
    "currency",
    "currency-code",
  ]);
  const storageCostIndex = reportColumn(headerIndexes, [
    "estimated-storage-cost-next-month",
  ]);
  const storageVolumeIndex = reportColumn(headerIndexes, ["storage-volume"]);
  const alertIndex = reportColumn(headerIndexes, ["alert"]);
  const recommendedActionIndex = reportColumn(headerIndexes, [
    "recommended-action",
  ]);
  const snapshotDateIndex = reportColumn(headerIndexes, [
    "inventory-age-snapshot-date",
    "snapshot-date",
  ]);

  const result: AgedInventoryRow[] = [];
  const storageCostCents: Array<number | null> = [];
  const agedSurchargeCents: Array<number | null> = [];
  const surchargeTierQuantities = selectedSurchargeColumns.map(
    () => [] as Array<number | null>,
  );
  const surchargeTierChargeCents = selectedSurchargeColumns.map(
    () => [] as Array<number | null>,
  );
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const sellerSku = row[skuIndex] ?? "";
    if (
      !sellerSku ||
      sellerSku.length > 40 ||
      sellerSku !== sellerSku.trim() ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
        sellerSku,
      )
    ) {
      throw new SpApiError(
        "Amazon FBA 庫齡報表有商品列缺少或無法原樣辨識 Seller SKU。",
        { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
      );
    }
    if (seen.has(sellerSku)) {
      throw new SpApiError(
        "Amazon FBA 庫齡報表含有重複 Seller SKU，已停止顯示。",
        { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
      );
    }

    const ageBuckets = selectedAgeColumns.map((item) => ({
      key: item.key,
      label: item.label,
      units: requiredReportIntegerCell(row, item.index, item.label),
      over180: item.over180,
    }));
    const totalAgedUnits = safeIntegerTotal(
      ageBuckets.map((item) => item.units),
      "庫齡數量",
    );
    const agedOver180 = safeIntegerTotal(
      ageBuckets.filter((item) => item.over180).map((item) => item.units),
      "超過 180 天庫齡數量",
    );
    const currencyCode = reportCurrencyCell(row, currencyIndex);
    const storageVolume = reportDecimalCell(
      row,
      storageVolumeIndex,
      "Amazon storage volume",
    );
    const reportedStorageCostCents = reportMoneyCents(
      row,
      storageCostIndex,
      "下月預估倉儲成本",
    );

    // A blank estimate is safely zero only when Amazon reports a zero basis.
    // A positive or missing basis remains unknown and therefore partial.
    const estimatedStorageCostCents = storageCostIndex < 0
      ? null
      : reportedStorageCostCents ?? (storageVolume === 0 ? 0 : null);
    const estimatedStorageCostNextMonth = estimatedStorageCostCents === null
      ? null
      : estimatedStorageCostCents / 100;
    const agedSurchargeEvidence = selectedSurchargeColumns.map((item, index) => {
      const quantity = reportIntegerCell(
        row,
        item.quantityIndex,
        `${item.label}計費數量`,
      );
      const reportedChargeCents = reportMoneyCents(
        row,
        item.estimatedIndex,
        `${item.label}預估附加費`,
      );
      const estimatedChargeCents =
        reportedChargeCents ?? (quantity === 0 ? 0 : null);
      surchargeTierQuantities[index]!.push(quantity);
      surchargeTierChargeCents[index]!.push(estimatedChargeCents);
      return {
        key: item.key,
        label: item.label,
        quantity,
        estimatedChargeCents,
      };
    });
    const estimatedAgedSurchargeCents = agedSurchargeEvidence.length > 0 &&
        agedSurchargeEvidence.every(
          (item) =>
            item.quantity !== null && item.estimatedChargeCents !== null,
        )
      ? safeIntegerTotal(
          agedSurchargeEvidence.map((item) => item.estimatedChargeCents!),
          "單一 SKU AIS 預估附加費",
        )
      : null;
    const estimatedAgedSurcharge = estimatedAgedSurchargeCents === null
      ? null
      : safeMoneyTotal(
          [estimatedAgedSurchargeCents],
          "單一 SKU AIS 預估附加費",
        );
    const agedSurchargeBuckets = agedSurchargeEvidence.map((item) => ({
      key: item.key,
      label: item.label,
      quantity: item.quantity,
      estimatedCharge: item.estimatedChargeCents === null
        ? null
        : item.estimatedChargeCents / 100,
    }));
    if (
      ((estimatedStorageCostNextMonth ?? 0) > 0 ||
        agedSurchargeBuckets.some(
          (item) => (item.estimatedCharge ?? 0) > 0,
        )) &&
      !currencyCode
    ) {
      throw new SpApiError(
        "Amazon FBA 庫齡報表有費用但缺少幣別，已停止加總。",
        { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
      );
    }

    seen.add(sellerSku);
    storageCostCents.push(estimatedStorageCostCents);
    agedSurchargeCents.push(estimatedAgedSurchargeCents);
    result.push({
      sellerSku,
      fnSku: fnSkuIndex >= 0 ? row[fnSkuIndex]?.trim() ?? "" : "",
      asin: asinIndex >= 0 ? row[asinIndex]?.trim() ?? "" : "",
      title: titleIndex >= 0 ? row[titleIndex]?.trim() ?? "" : "",
      condition: conditionIndex >= 0 ? row[conditionIndex]?.trim() ?? "" : "",
      available: reportIntegerCell(row, availableIndex, "可售庫存"),
      totalAgedUnits,
      agedOver180,
      ageBuckets,
      estimatedExcessQuantity: reportIntegerCell(
        row,
        excessIndex,
        "Amazon 預估冗餘",
      ),
      recommendedRemovalQuantity: reportIntegerCell(
        row,
        removalIndex,
        "建議移除數量",
      ),
      daysOfSupply: reportDecimalCell(row, daysOfSupplyIndex, "可售天數"),
      currencyCode,
      estimatedStorageCostNextMonth,
      estimatedAgedSurcharge,
      agedSurchargeBuckets,
      alert: alertIndex >= 0 ? row[alertIndex]?.trim() ?? "" : "",
      recommendedAction: recommendedActionIndex >= 0
        ? row[recommendedActionIndex]?.trim() ?? ""
        : "",
      snapshotDate: snapshotDateIndex >= 0
        ? row[snapshotDateIndex]?.trim() || null
        : null,
    });
  }

  if (result.length > 0) {
    for (const [index, item] of selectedSurchargeColumns.entries()) {
      const quantities = surchargeTierQuantities[index]!;
      const completeQuantities = quantities.filter(
        (value): value is number => value !== null,
      );
      if (completeQuantities.length === result.length) {
        safeIntegerTotal(
          completeQuantities,
          `${item.label}計費數量`,
        );
      }
      const chargeCents = surchargeTierChargeCents[index]!;
      const completeChargeCents = chargeCents.filter(
        (value): value is number => value !== null,
      );
      if (completeChargeCents.length === result.length) {
        safeMoneyTotal(
          completeChargeCents,
          `${item.label}預估附加費`,
        );
      }
    }
  }

  result.sort((left, right) => {
    const leftExcess = left.estimatedExcessQuantity ?? -1;
    const rightExcess = right.estimatedExcessQuantity ?? -1;
    if (leftExcess !== rightExcess) return leftExcess < rightExcess ? 1 : -1;
    if (left.agedOver180 !== right.agedOver180) {
      return left.agedOver180 < right.agedOver180 ? 1 : -1;
    }
    return left.sellerSku.localeCompare(right.sellerSku);
  });

  const currencyCodes = new Set(
    result
      .map((row) => row.currencyCode)
      .filter((value): value is string => value !== null),
  );
  if (currencyCodes.size > 1) {
    throw new SpApiError(
      "同一站點的 FBA 庫齡報表包含多種幣別，已停止加總。",
      { status: 502, code: "REPORT_FORMAT_UNSUPPORTED" },
    );
  }

  const parsed: ParsedAgedInventoryReport = {
    rows: result,
    storageCostCents,
    agedSurchargeCents,
    ageBucketKeys: selectedAgeColumns.map((item) => item.key),
    agedSurchargeBucketKeys: selectedSurchargeColumns.map((item) => item.key),
    excessAvailability: feeAvailability(
      excessIndex >= 0,
      result.map((row) => row.estimatedExcessQuantity),
    ),
    storageCostAvailability: feeAvailability(
      storageCostIndex >= 0,
      result.map((row) => row.estimatedStorageCostNextMonth),
    ),
    agedSurchargeAvailability: feeAvailability(
      selectedSurchargeColumns.length > 0,
      result.map((row) => row.estimatedAgedSurcharge),
    ),
    currencyCode: [...currencyCodes][0] ?? null,
  };
  validateAgedInventoryRegionSchema(parsed, marketplaceId);
  return parsed;
}

function completeIntegerTotal(
  availability: AgedInventoryFeeAvailability,
  values: Array<number | null>,
  label: string,
): number | null {
  const completeValues = values.filter(
    (value): value is number => value !== null,
  );
  if (availability !== "complete" || completeValues.length !== values.length) {
    return null;
  }
  return safeIntegerTotal(completeValues, label);
}

function completeMoneyTotal(
  availability: AgedInventoryFeeAvailability,
  centsValues: Array<number | null>,
  label: string,
): number | null {
  const completeValues = centsValues.filter(
    (value): value is number => value !== null,
  );
  if (
    availability !== "complete" ||
    completeValues.length !== centsValues.length
  ) {
    return null;
  }
  return safeMoneyTotal(completeValues, label);
}

function agedInventoryExpirationBoundary(): AgedInventorySnapshot["expiration"] {
  return {
    currentFbaExpirationDatesAvailable: false,
    nearExpiryUnits: null,
    expiredUnits: null,
    inboundPlanExpirationDatesAvailable: true,
    notice:
      "Amazon 公開的 FBA Inventory 與 Manage Inventory Health report 不提供目前 FC 庫存的逐 SKU／批次到期日、近效期或已過期數量。Fulfillment Inbound API 只會回傳入庫計畫中填寫的日期，收貨後無法證明目前剩餘批次，因此本頁不把庫齡或 Amazon alert 當成到期資料。",
  };
}

function liveAgedInventorySnapshot(input: Readonly<{
  marketplaceId: MarketplaceId;
  document: string;
  fetchedAt: string;
}>): AgedInventorySnapshot {
  const parsed = parseAgedInventoryReportData(
    input.document,
    input.marketplaceId,
  );
  const marketplace = marketplaceById(input.marketplaceId);
  if (!marketplace) {
    throw new SpApiError("FBA 庫齡報表站點無法辨識。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  if (
    parsed.currencyCode &&
    parsed.currencyCode !== marketplace.currency
  ) {
    throw new SpApiError("FBA 庫齡報表幣別與目前站點不一致，已停止加總。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }

  const rows = parsed.rows;
  const excessValues = rows.map((row) => row.estimatedExcessQuantity);
  const storageCostValues = rows.map(
    (row) => row.estimatedStorageCostNextMonth,
  );
  const agedSurchargeValues = rows.map(
    (row) => row.estimatedAgedSurcharge,
  );
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    fetchedAt: input.fetchedAt,
    rows,
    summary: {
      skuCount: rows.length,
      agedOver180SkuCount: rows.filter((row) => row.agedOver180 > 0).length,
      totalAgedUnits: safeIntegerTotal(
        rows.map((row) => row.totalAgedUnits),
        "全站庫齡數量",
      ),
      agedOver180: safeIntegerTotal(
        rows.map((row) => row.agedOver180),
        "全站超過 180 天庫齡數量",
      ),
      excessAvailability: parsed.excessAvailability,
      estimatedExcessQuantity: completeIntegerTotal(
        parsed.excessAvailability,
        excessValues,
        "全站預估冗餘數量",
      ),
      excessReportedSkuCount: excessValues.filter((value) => value !== null)
        .length,
      currencyCode: parsed.currencyCode,
      storageCostAvailability: parsed.storageCostAvailability,
      estimatedStorageCostNextMonth: completeMoneyTotal(
        parsed.storageCostAvailability,
        parsed.storageCostCents,
        "全站下月預估倉儲成本",
      ),
      storageCostReportedSkuCount: storageCostValues.filter(
        (value) => value !== null,
      ).length,
      agedSurchargeAvailability: parsed.agedSurchargeAvailability,
      estimatedAgedSurcharge: completeMoneyTotal(
        parsed.agedSurchargeAvailability,
        parsed.agedSurchargeCents,
        "全站 AIS 預估附加費",
      ),
      agedSurchargeReportedSkuCount: agedSurchargeValues.filter(
        (value) => value !== null,
      ).length,
    },
    expiration: agedInventoryExpirationBoundary(),
    notice:
      "資料取自 Amazon FBA Manage Inventory Health report。庫齡桶與 estimated excess 顯示報表原值；費用空白只有在同列官方 storage volume／AIS 計費數量明確為 0 時才安全呈現 0，其餘缺欄或缺值不推算。本頁唯讀，不會建立促銷或移除訂單。",
  };
}

function demoAgedInventorySnapshot(
  marketplaceId: MarketplaceId,
  currentTime: Date,
): AgedInventorySnapshot {
  const ageBuckets: AgedInventoryBucket[] =
    REGIONAL_AGED_INVENTORY_MARKETPLACES.has(marketplaceId)
      ? [
          { key: "0-30", label: "0–30 天", units: 80, over180: false },
          { key: "31-60", label: "31–60 天", units: 30, over180: false },
          { key: "61-90", label: "61–90 天", units: 22, over180: false },
          { key: "91-180", label: "91–180 天", units: 0, over180: false },
          { key: "181-270", label: "181–270 天", units: 60, over180: true },
          { key: "271-365", label: "271–365 天", units: 36, over180: true },
          { key: "366-455", label: "366–455 天", units: 12, over180: true },
          { key: "456-plus", label: "456 天以上", units: 0, over180: true },
        ]
      : [
          { key: "0-90", label: "0–90 天", units: 132, over180: false },
          { key: "91-180", label: "91–180 天", units: 0, over180: false },
          { key: "181-270", label: "181–270 天", units: 60, over180: true },
          { key: "271-365", label: "271–365 天", units: 36, over180: true },
          {
            key: "365-plus",
            label: "365 天以上（Amazon 欄位）",
            units: 12,
            over180: true,
          },
        ];
  const fetchedAt = currentTime.toISOString();
  const rows: AgedInventoryRow[] = [
    {
      sellerSku: "DEMO-FBA-AGED-01",
      fnSku: "DEMO-FNSKU-AGED-01",
      asin: "B0DEMOAGED1",
      title: "展示用 FBA 庫齡商品",
      condition: "New",
      available: 240,
      totalAgedUnits: 240,
      agedOver180: 108,
      ageBuckets,
      estimatedExcessQuantity: 82,
      recommendedRemovalQuantity: 18,
      daysOfSupply: 216,
      currencyCode: null,
      estimatedStorageCostNextMonth: null,
      estimatedAgedSurcharge: null,
      agedSurchargeBuckets: [],
      alert: "",
      recommendedAction: "Create sale",
      snapshotDate: fetchedAt.slice(0, 10),
    },
  ];
  return {
    mode: "demo",
    marketplaceId,
    fetchedAt,
    rows,
    summary: {
      skuCount: rows.length,
      agedOver180SkuCount: rows.filter((row) => row.agedOver180 > 0).length,
      totalAgedUnits: rows.reduce((sum, row) => sum + row.totalAgedUnits, 0),
      agedOver180: rows.reduce((sum, row) => sum + row.agedOver180, 0),
      excessAvailability: "complete",
      estimatedExcessQuantity: rows.reduce(
        (sum, row) => sum + (row.estimatedExcessQuantity ?? 0),
        0,
      ),
      excessReportedSkuCount: rows.length,
      currencyCode: null,
      storageCostAvailability: "unavailable",
      estimatedStorageCostNextMonth: null,
      storageCostReportedSkuCount: 0,
      agedSurchargeAvailability: "unavailable",
      estimatedAgedSurcharge: null,
      agedSurchargeReportedSkuCount: 0,
    },
    expiration: agedInventoryExpirationBoundary(),
    notice:
      "展示資料只供版面測試。費用欄位刻意留空；庫齡與 Amazon 預估冗餘是不同指標，不會自動建立促銷或移除訂單。",
  };
}

/**
 * Semantic owner of the complete FBA Aged Inventory read family. The fixed
 * report lifecycle and document download remain owned by ReportsRuntime;
 * schema selection, parsing, evidence projection and demo/live behavior stay
 * behind this boundary.
 */
export class AgedInventoryReads implements AgedInventoryReadsPort {
  private readonly reports: ReportsPort;
  private readonly context: SpExecutionContextAdapter;
  private readonly now: () => Date;

  constructor(input: Readonly<{
    reports: ReportsPort;
    context: SpExecutionContextAdapter;
    now?: () => Date;
  }>) {
    this.reports = input.reports;
    this.context = input.context;
    this.now = input.now ?? (() => new Date());
  }

  private async executionContext(
    marketplaceId: MarketplaceId,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    if (!expected) return this.context.capture(marketplaceId);
    if (expected.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境與 FBA 庫齡站點不一致；請重新開始。",
      );
    }
    await this.context.assertCurrent(expected);
    return expected;
  }

  private async settleInContext<T>(
    context: SpExecutionContext,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation();
      await this.context.assertCurrent(context);
      return result;
    } catch (error) {
      await this.context.assertCurrent(context);
      throw error;
    }
  }

  async begin(
    input: Parameters<AgedInventoryReadsPort["begin"]>[0],
  ): Promise<ReportsRuntimeReceipt> {
    assertNotAborted(input.signal);
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const receipt = await this.reports.start(fixedPlan(input), {
      explicitRetry: input.explicitRetry,
      freshCompleted: input.freshCompleted,
      expectedContext: context,
    });
    await this.context.assertCurrent(context);
    assertNotAborted(input.signal);
    return receipt;
  }

  async status(
    input: Parameters<AgedInventoryReadsPort["status"]>[0],
  ): Promise<ReportsRuntimeReceipt> {
    assertNotAborted(input.signal);
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const receipt = await this.reports.status(
      fixedPlan(input),
      input.reportId,
      context,
    );
    await this.context.assertCurrent(context);
    assertNotAborted(input.signal);
    return receipt;
  }

  async read(
    input: Parameters<AgedInventoryReadsPort["read"]>[0],
  ): Promise<AgedInventorySnapshot> {
    assertNotAborted(input.signal);
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const plan = fixedPlan(input);

    if (context.mode === "demo") {
      const receipt = await this.reports.read(plan, context);
      await this.context.assertCurrent(context);
      if (
        !receipt ||
        !receipt.ready ||
        receipt.mode !== "demo" ||
        receipt.reportId !== input.reportId ||
        receipt.documentId !== input.documentId
      ) {
        throw new SpApiError("展示 FBA 庫齡報表資訊不相符。", {
          status: 409,
          code: "REPORT_MISMATCH",
        });
      }
      return this.settleInContext(context, () => {
        assertNotAborted(input.signal);
        return demoAgedInventorySnapshot(input.marketplaceId, this.now());
      });
    }

    const document = await this.reports.readDocument(
      plan,
      { reportId: input.reportId, documentId: input.documentId },
      context,
    );
    await this.context.assertCurrent(context);
    if (document.mode !== context.mode) {
      throw new SpApiError(
        "FBA 庫齡報表模式與目前 App 設定不一致。",
        { status: 409, code: "REPORT_MODE_CHANGED" },
      );
    }
    return this.settleInContext(context, () => {
      assertNotAborted(input.signal);
      return liveAgedInventorySnapshot({
        marketplaceId: input.marketplaceId,
        document: document.text,
        fetchedAt: this.now().toISOString(),
      });
    });
  }
}
