import {
  ADVERTISING_STRATEGY_PRESETS,
  ADVERTISING_STRATEGY_RULE,
  ADVERTISING_STRATEGY_UNRESOLVED_MESSAGES,
  type AdvertisingStrategyRow,
  type AdvertisingStrategySnapshot,
  type AdvertisingStrategyTier,
  type AdvertisingStrategyUnresolvedCode,
  type AdvertisingStrategyUnresolvedRow,
} from "../../shared/advertising-strategy";

export type {
  AdvertisingStrategyRow,
  AdvertisingStrategySnapshot,
  AdvertisingStrategyTier,
  AdvertisingStrategyUnresolvedRow,
} from "../../shared/advertising-strategy";

export type AdvertisingStrategySnapshotExpectation = {
  marketplaceId: string;
  startDate: string;
  endDate: string;
  currencyCode?: string;
};

const PRESETS = ADVERTISING_STRATEGY_PRESETS;
const MANUAL_FIELDS = ADVERTISING_STRATEGY_RULE.manualFields;

const COVERAGE_KEYS = [
  "currentFbaSkuCount",
  "salesSourceRowCount",
  "salesResolvedSourceRowCount",
  "salesUnresolvedSourceRowCount",
  "salesAnonymousUnprovenSourceRowCount",
  "salesReportedSkuCount",
  "salesNotReportedSkuCount",
  "spSourceRowCount",
  "spResolvedSourceRowCount",
  "spUnresolvedSourceRowCount",
  "spAnonymousUnprovenSourceRowCount",
  "spReportedSkuCount",
  "spNotReportedSkuCount",
  "spDirectSourceRowCount",
  "spUniqueAsinSourceRowCount",
] as const;

const UNRESOLVED_CODES = new Set<AdvertisingStrategyUnresolvedCode>([
  "sales-sku-asin-mismatch",
  "sales-duplicate-sku",
  "sp-invalid-asin",
  "sp-sku-asin-mismatch",
]);

const MAX_METRIC = 1_000_000_000_000;
const MAX_CURRENT_FBA_ROWS = 100_000;
const MAX_UNRESOLVED_ROWS = 150_000;
const ZERO_WIDTH_OR_BIDI = /[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validSellerSku(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 40 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !ZERO_WIDTH_OR_BIDI.test(value)
  );
}

function validAsin(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{10}$/u.test(value);
}

function metric(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_METRIC
  );
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveCount(value: unknown): value is number {
  return count(value) && value >= 1;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tierForRank(rank: number, countValue: number): AdvertisingStrategyTier {
  if (rank <= Math.ceil(countValue * 0.2)) return "T1";
  if (rank <= Math.ceil(countValue * 0.5)) return "T2";
  if (rank <= Math.ceil(countValue * 0.8)) return "T3";
  return "T4";
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sameMetric(actual: unknown, expected: number): actual is number {
  if (!metric(actual)) return false;
  const tolerance = Math.max(1, Math.abs(expected)) * Number.EPSILON * 32;
  return Math.abs(actual - expected) <= tolerance;
}

function fail(message = "廣告策略回應無法安全辨識。"): never {
  throw new Error(message);
}

function parseRule(value: unknown): AdvertisingStrategySnapshot["rule"] {
  const rule = record(value);
  const presets = record(rule?.presets);
  if (
    !rule ||
    rule.salesTierMethod !== "reported-sales-desc-sku-asc-ceil-20-50-80" ||
    rule.adsAttributionMethod !== "exact-sku-or-unique-current-fba-asin" ||
    rule.missingReportMethod !== "null-not-reported-never-zero" ||
    rule.unprovenSourceMethod !== "anonymous-count-only-no-identifiers-or-metrics" ||
    rule.suggestionIsOverrideable !== true ||
    !presets ||
    !Array.isArray(rule.manualFields) ||
    rule.manualFields.length !== MANUAL_FIELDS.length ||
    rule.manualFields.some((field, index) => field !== MANUAL_FIELDS[index])
  ) {
    fail("廣告策略規則版本無法安全辨識。");
  }
  for (const tier of ["T1", "T2", "T3", "T4"] as const) {
    const preset = record(presets[tier]);
    if (
      !preset ||
      preset.dailyBudget !== PRESETS[tier].dailyBudget ||
      preset.targetAcos !== PRESETS[tier].targetAcos
    ) {
      fail("廣告策略建議預設值無法安全辨識。");
    }
  }
  return {
    salesTierMethod: ADVERTISING_STRATEGY_RULE.salesTierMethod,
    adsAttributionMethod: ADVERTISING_STRATEGY_RULE.adsAttributionMethod,
    missingReportMethod: ADVERTISING_STRATEGY_RULE.missingReportMethod,
    unprovenSourceMethod: ADVERTISING_STRATEGY_RULE.unprovenSourceMethod,
    suggestionIsOverrideable:
      ADVERTISING_STRATEGY_RULE.suggestionIsOverrideable,
    presets: PRESETS,
    manualFields: MANUAL_FIELDS,
  };
}

function parseRow(value: unknown): AdvertisingStrategyRow {
  const row = record(value);
  if (
    !row ||
    !validSellerSku(row.sellerSku) ||
    !validAsin(row.asin) ||
    typeof row.title !== "string" ||
    row.title.length > 32_767 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(row.title) ||
    ZERO_WIDTH_OR_BIDI.test(row.title) ||
    row.price !== null ||
    (row.salesStatus !== "reported" && row.salesStatus !== "not-reported") ||
    (row.spStatus !== "reported" && row.spStatus !== "not-reported") ||
    MANUAL_FIELDS.some((field) => row[field] !== null)
  ) {
    fail();
  }

  const salesReported = row.salesStatus === "reported";
  if (
    salesReported
      ? !(
          count(row.unitsSold) &&
          metric(row.salesAmount) &&
          positiveCount(row.salesRank) &&
          (row.salesTier === "T1" || row.salesTier === "T2" || row.salesTier === "T3" || row.salesTier === "T4") &&
          row.suggestedSpDailyBudget === PRESETS[row.salesTier].dailyBudget &&
          row.suggestedSpTargetAcos === PRESETS[row.salesTier].targetAcos &&
          row.suggestion === "overrideable-default"
        )
      : !(
          row.unitsSold === null &&
          row.salesAmount === null &&
          row.salesRank === null &&
          row.salesTier === null &&
          row.suggestedSpDailyBudget === null &&
          row.suggestedSpTargetAcos === null &&
          row.suggestion === null
        )
  ) {
    fail("廣告策略銷售報表狀態與明細不一致。");
  }

  const spReported = row.spStatus === "reported";
  const spSalesReported = row.spSales14d === null || metric(row.spSales14d);
  const spPurchasesReported =
    row.spPurchases14d === null || count(row.spPurchases14d);
  let actualAcosIsConsistent = false;
  if (row.spSales14d === null) {
    actualAcosIsConsistent =
      row.spActualAcos === null && row.spActualAcosStatus === "not-reported";
  } else if (metric(row.spSales14d)) {
    actualAcosIsConsistent = row.spSales14d === 0
      ? row.spActualAcos === null && row.spActualAcosStatus === "no-sales"
      : metric(row.spSpend) &&
        metric(row.spActualAcos) &&
        row.spActualAcosStatus === "reported" &&
        sameMetric(row.spActualAcos, row.spSpend / row.spSales14d);
  }
  if (
    spReported
      ? !(
          metric(row.spSpend) &&
          spSalesReported &&
          spPurchasesReported &&
          actualAcosIsConsistent &&
          positiveCount(row.spSpendRank) &&
          (row.spAttribution === "seller-sku" ||
            row.spAttribution === "unique-asin" ||
            row.spAttribution === "mixed")
        )
      : !(
          row.spSpend === null &&
          row.spSales14d === null &&
          row.spActualAcos === null &&
          row.spActualAcosStatus === null &&
          row.spPurchases14d === null &&
          row.spSpendRank === null &&
          row.spAttribution === null
        )
  ) {
    fail("廣告策略 SP 報表狀態與明細不一致。");
  }

  return {
    sellerSku: row.sellerSku,
    asin: row.asin,
    title: row.title,
    price: row.price,
    salesStatus: row.salesStatus,
    unitsSold: row.unitsSold,
    salesAmount: row.salesAmount,
    salesRank: row.salesRank,
    salesTier: row.salesTier,
    suggestedSpDailyBudget: row.suggestedSpDailyBudget,
    suggestedSpTargetAcos: row.suggestedSpTargetAcos,
    suggestion: row.suggestion,
    spStatus: row.spStatus,
    spSpend: row.spSpend,
    spSales14d: row.spSales14d,
    spActualAcos: row.spActualAcos,
    spActualAcosStatus: row.spActualAcosStatus,
    spPurchases14d: row.spPurchases14d,
    spSpendRank: row.spSpendRank,
    spAttribution: row.spAttribution,
    specification: null,
    sbSales: null,
    sbSalesAcos: null,
    sbAttack: null,
    sbAttackAcos: null,
    sdAttack: null,
    sdAttackAcos: null,
    sdDefense: null,
    sdDefenseAcos: null,
    sdRemarketing: null,
    sdRemarketingAcos: null,
    otherAdvertising: null,
  } as AdvertisingStrategyRow;
}

function parseUnresolved(value: unknown): AdvertisingStrategyUnresolvedRow {
  const row = record(value);
  if (
    !row ||
    (row.source !== "sales" && row.source !== "sp-advertised-product") ||
    !positiveCount(row.sourceRow) ||
    row.fbaEvidence !== "exact-seller-sku" ||
    !validSellerSku(row.sellerSku) ||
    !(row.asin === null || validAsin(row.asin)) ||
    typeof row.code !== "string" ||
    !UNRESOLVED_CODES.has(row.code as AdvertisingStrategyUnresolvedCode) ||
    row.message !== ADVERTISING_STRATEGY_UNRESOLVED_MESSAGES[
      row.code as AdvertisingStrategyUnresolvedCode
    ] ||
    !metric(row.amount)
  ) {
    fail("廣告策略未完成明細無法安全辨識。");
  }
  const isSalesCode = row.code.startsWith("sales-");
  const validSpMetrics =
    (row.spSales14d === null || metric(row.spSales14d)) &&
    (row.spPurchases14d === null || count(row.spPurchases14d));
  if (
    row.source === "sales"
      ? !isSalesCode ||
        !count(row.unitsSold) ||
        row.spSales14d !== null ||
        row.spPurchases14d !== null
      : isSalesCode || row.unitsSold !== null || !validSpMetrics
  ) {
    fail("廣告策略未完成明細的來源與數值不一致。");
  }
  return {
    source: row.source,
    sourceRow: row.sourceRow,
    fbaEvidence: "exact-seller-sku",
    sellerSku: row.sellerSku,
    asin: row.asin,
    code: row.code as AdvertisingStrategyUnresolvedCode,
    message: row.message,
    unitsSold: row.unitsSold,
    amount: row.amount,
    spSales14d: row.spSales14d,
    spPurchases14d: row.spPurchases14d,
  } as AdvertisingStrategyUnresolvedRow;
}

export function parseAdvertisingStrategySnapshot(
  value: unknown,
  expected: AdvertisingStrategySnapshotExpectation,
): AdvertisingStrategySnapshot {
  const root = record(value);
  const dateRange = record(root?.dateRange);
  const sourceFetchedAt = record(root?.sourceFetchedAt);
  const coverage = record(root?.coverage);
  const summary = record(root?.summary);
  const tierCounts = record(summary?.tierCounts);
  if (
    !root ||
    root.schemaVersion !== 1 ||
    root.marketplaceId !== expected.marketplaceId ||
    typeof root.marketplaceId !== "string" ||
    !/^[A-Z0-9]{10,20}$/u.test(root.marketplaceId) ||
    typeof root.marketplaceCode !== "string" ||
    !/^[A-Z]{2,3}$/u.test(root.marketplaceCode) ||
    !dateRange ||
    !validDate(dateRange.startDate) ||
    !validDate(dateRange.endDate) ||
    dateRange.startDate !== expected.startDate ||
    dateRange.endDate !== expected.endDate ||
    dateRange.startDate > dateRange.endDate ||
    typeof root.currencyCode !== "string" ||
    !/^[A-Z]{3}$/u.test(root.currencyCode) ||
    (expected.currencyCode !== undefined && root.currencyCode !== expected.currencyCode) ||
    !validIsoInstant(root.fetchedAt) ||
    !sourceFetchedAt ||
    !validIsoInstant(sourceFetchedAt.fba) ||
    !validIsoInstant(sourceFetchedAt.sales) ||
    !validIsoInstant(sourceFetchedAt.ads) ||
    !Array.isArray(root.rows) ||
    !Array.isArray(root.unresolved) ||
    root.rows.length > MAX_CURRENT_FBA_ROWS ||
    root.unresolved.length > MAX_UNRESOLVED_ROWS ||
    !coverage ||
    !summary ||
    !tierCounts ||
    typeof root.notice !== "string" ||
    root.notice.length < 1 ||
    root.notice.length > 32_767
  ) {
    fail();
  }
  const rows = root.rows.map(parseRow);
  if (new Set(rows.map((row) => row.sellerSku)).size !== rows.length) {
    fail("廣告策略含重複的目前 FBA SKU。");
  }
  const unresolved = root.unresolved.map(parseUnresolved);
  if (
    new Set(unresolved.map((row) => `${row.source}:${row.sourceRow}`)).size !==
    unresolved.length
  ) {
    fail("廣告策略未完成明細含重複來源列。");
  }
  const rowsBySku = new Map(rows.map((row) => [row.sellerSku, row] as const));
  if (unresolved.some((row) => {
    const currentFba = rowsBySku.get(row.sellerSku);
    if (!currentFba) return true;
    switch (row.code) {
      case "sales-sku-asin-mismatch":
        return row.source !== "sales" || row.asin === currentFba.asin;
      case "sales-duplicate-sku":
        return row.source !== "sales" || row.asin !== currentFba.asin;
      case "sp-invalid-asin":
        return row.source !== "sp-advertised-product" || row.asin !== null;
      case "sp-sku-asin-mismatch":
        return row.source !== "sp-advertised-product" ||
          row.asin === null ||
          row.asin === currentFba.asin;
    }
  })) {
    fail("廣告策略未完成明細缺少 exact current-FBA SKU 證據。");
  }

  const reportedSalesRows = rows.filter((row) => row.salesStatus === "reported");
  const expectedSalesOrder = [...reportedSalesRows].sort((left, right) =>
    (right.salesAmount ?? 0) - (left.salesAmount ?? 0) ||
    compareText(left.sellerSku, right.sellerSku),
  );
  const expectedRowOrder = [
    ...expectedSalesOrder,
    ...rows
      .filter((row) => row.salesStatus === "not-reported")
      .sort((left, right) => compareText(left.sellerSku, right.sellerSku)),
  ];
  if (
    expectedRowOrder.some((row, index) => row.sellerSku !== rows[index]?.sellerSku) ||
    expectedSalesOrder.some((row, index) =>
      row.salesRank !== index + 1 ||
      row.salesTier !== tierForRank(index + 1, expectedSalesOrder.length),
    )
  ) {
    fail("廣告策略銷售排名、分級或排序不一致。");
  }

  const reportedSpRows = rows.filter((row) => row.spStatus === "reported");
  const expectedSpOrder = [...reportedSpRows].sort((left, right) =>
    (right.spSpend ?? 0) - (left.spSpend ?? 0) ||
    compareText(left.sellerSku, right.sellerSku),
  );
  if (expectedSpOrder.some((row, index) => row.spSpendRank !== index + 1)) {
    fail("廣告策略 SP 花費排名不一致。");
  }

  if (COVERAGE_KEYS.some((key) => !count(coverage[key]))) {
    fail("廣告策略資料覆蓋加總無法安全辨識。");
  }
  const parsedCoverage = Object.fromEntries(
    COVERAGE_KEYS.map((key) => [key, coverage[key]]),
  ) as AdvertisingStrategySnapshot["coverage"];
  const salesUnresolved = unresolved.filter((row) => row.source === "sales");
  const spUnresolved = unresolved.filter(
    (row) => row.source === "sp-advertised-product",
  );
  if (
    parsedCoverage.currentFbaSkuCount !== rows.length ||
    parsedCoverage.salesResolvedSourceRowCount + parsedCoverage.salesUnresolvedSourceRowCount !== parsedCoverage.salesSourceRowCount ||
    parsedCoverage.salesUnresolvedSourceRowCount !==
      salesUnresolved.length + parsedCoverage.salesAnonymousUnprovenSourceRowCount ||
    parsedCoverage.salesReportedSkuCount !== reportedSalesRows.length ||
    parsedCoverage.salesResolvedSourceRowCount !== reportedSalesRows.length ||
    parsedCoverage.salesNotReportedSkuCount !== rows.length - reportedSalesRows.length ||
    parsedCoverage.spResolvedSourceRowCount + parsedCoverage.spUnresolvedSourceRowCount !== parsedCoverage.spSourceRowCount ||
    parsedCoverage.spUnresolvedSourceRowCount !==
      spUnresolved.length + parsedCoverage.spAnonymousUnprovenSourceRowCount ||
    parsedCoverage.spReportedSkuCount !== reportedSpRows.length ||
    parsedCoverage.spNotReportedSkuCount !== rows.length - reportedSpRows.length ||
    parsedCoverage.spDirectSourceRowCount + parsedCoverage.spUniqueAsinSourceRowCount !== parsedCoverage.spResolvedSourceRowCount ||
    unresolved.some((row) => row.sourceRow > (
      row.source === "sales"
        ? parsedCoverage.salesSourceRowCount
        : parsedCoverage.spSourceRowCount
    ))
  ) {
    fail("廣告策略資料覆蓋加總與明細不一致。");
  }

  const derivedTierCounts = reportedSalesRows.reduce(
    (counts, row) => {
      counts[row.salesTier!] += 1;
      return counts;
    },
    { T1: 0, T2: 0, T3: 0, T4: 0 },
  );
  const tierKeys = ["T1", "T2", "T3", "T4"] as const;
  if (
    tierKeys.some((tier) =>
      !count(tierCounts[tier]) || tierCounts[tier] !== derivedTierCounts[tier],
    )
  ) {
    fail("廣告策略分級加總與明細不一致。");
  }
  const reportedUnitsSold = sum(reportedSalesRows.map((row) => row.unitsSold!));
  const unresolvedUnitsSold = sum(salesUnresolved.map((row) => row.unitsSold!));
  const reportedSalesAmount = sum(reportedSalesRows.map((row) => row.salesAmount!));
  const unresolvedSalesAmount = sum(salesUnresolved.map((row) => row.amount));
  const reportedSpSpend = sum(reportedSpRows.map((row) => row.spSpend!));
  const unresolvedSpSpend = sum(spUnresolved.map((row) => row.amount));
  const suggestedSpDailyBudget = sum(
    reportedSalesRows.map((row) => row.suggestedSpDailyBudget!),
  );
  if (
    !sameMetric(summary.reportedUnitsSold, reportedUnitsSold) ||
    !sameMetric(summary.unresolvedUnitsSold, unresolvedUnitsSold) ||
    !sameMetric(summary.sourceUnitsSold, reportedUnitsSold + unresolvedUnitsSold) ||
    !sameMetric(summary.reportedSalesAmount, reportedSalesAmount) ||
    !sameMetric(summary.unresolvedSalesAmount, unresolvedSalesAmount) ||
    !sameMetric(summary.sourceSalesAmount, reportedSalesAmount + unresolvedSalesAmount) ||
    !sameMetric(summary.reportedSpSpend, reportedSpSpend) ||
    !sameMetric(summary.unresolvedSpSpend, unresolvedSpSpend) ||
    !sameMetric(summary.sourceSpSpend, reportedSpSpend + unresolvedSpSpend) ||
    !sameMetric(summary.suggestedSpDailyBudget, suggestedSpDailyBudget)
  ) {
    fail("廣告策略金額或數量加總與明細不一致。");
  }

  return {
    schemaVersion: 1,
    marketplaceId: root.marketplaceId,
    marketplaceCode: root.marketplaceCode,
    dateRange: {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    },
    currencyCode: root.currencyCode,
    fetchedAt: root.fetchedAt,
    sourceFetchedAt: {
      fba: sourceFetchedAt.fba,
      sales: sourceFetchedAt.sales,
      ads: sourceFetchedAt.ads,
    },
    rows,
    unresolved,
    coverage: parsedCoverage,
    summary: {
      tierCounts: {
        T1: tierCounts.T1 as number,
        T2: tierCounts.T2 as number,
        T3: tierCounts.T3 as number,
        T4: tierCounts.T4 as number,
      },
      reportedUnitsSold: summary.reportedUnitsSold as number,
      unresolvedUnitsSold: summary.unresolvedUnitsSold as number,
      sourceUnitsSold: summary.sourceUnitsSold as number,
      reportedSalesAmount: summary.reportedSalesAmount as number,
      unresolvedSalesAmount: summary.unresolvedSalesAmount as number,
      sourceSalesAmount: summary.sourceSalesAmount as number,
      reportedSpSpend: summary.reportedSpSpend as number,
      unresolvedSpSpend: summary.unresolvedSpSpend as number,
      sourceSpSpend: summary.sourceSpSpend as number,
      suggestedSpDailyBudget: summary.suggestedSpDailyBudget as number,
    },
    rule: parseRule(root.rule),
    notice: root.notice,
  };
}
