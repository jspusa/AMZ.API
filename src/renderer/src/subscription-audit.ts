export type SubscriptionAuditMonthCount = 6 | 12 | 23;

const SELLER_REPLENISHMENT_MARKETPLACE_IDS = new Set([
  "ATVPDKIKX0DER",
  "A1VC38T7YXB528",
  "A2EUQ1WTGCTBG2",
  "A1F83G8C2ARO7P",
  "A1PA6795UKMFR9",
]);

export function isSubscriptionAuditMarketplaceSupported(
  marketplaceId: string,
): boolean {
  return SELLER_REPLENISHMENT_MARKETPLACE_IDS.has(marketplaceId);
}

export type SubscriptionAuditInterval = {
  month: string;
  startDate: string;
  endDate: string;
};

export type SubscriptionAuditMonthlyPoint = {
  month: string;
  subscriptionRevenue: number | null;
  shippedSubscriptionUnits: number | null;
  activeSubscriptionsAtPeriodEnd: number | null;
  currencyCode: string | null;
};

export type SubscriptionRevenueCoverage = {
  status: "complete" | "partial" | "unavailable";
  expectedOfferMonths: number;
  reportedOfferMonths: number;
};

export type SubscriptionUpstreamCoverage = {
  status: "complete" | "partial";
  returnedOfferRows: number;
  acceptedOfferRows: number;
  returnedMetricRows: number;
  acceptedMetricRows: number;
  invalidOfferRows: Array<{ sellerSku: string; problem: string }>;
  problemSkuRows: Array<{
    sellerSku: string;
    fbaEvidence: "CURRENT_FBA_SKU_SET";
    affectedOfferRows: number;
    affectedMetricRows: number;
    metricMonths: string[];
    problem: string;
  }>;
  unprovenExactSkuProblems: {
    exactSkuCount: number;
    affectedOfferRows: number;
    affectedMetricRows: number;
    minimumUnresolvedOfferMonths: number;
  };
  rejectedSellerSkuRows: number;
  minimumUnresolvedOfferMonths: number;
  notice: string;
};

export type SubscriptionInventoryEvidence = {
  source: "FBA_INVENTORY_API_COMPLETE_PAGINATION";
  coverage: "complete" | "partial";
  returnedInventoryRows: number;
  provenSkuCount: number;
  unrecognizedSellerSkuRows: number;
  verifiableReplenishmentOfferCount: number;
  unverifiedFbaSkuCount: number;
};

export type SubscriptionAuditOffer = {
  sellerSku: string;
  asin: string;
  eligibility: string;
  price: { amount: number; currencyCode: string };
  sellerFundedBaseDiscount: number | null;
  sellerFundedTieredDiscount: number | null;
  currentActiveSubscriptions: number;
  fbaEvidence: "CURRENT_FBA_SKU_SET";
  monthlySeries: SubscriptionAuditMonthlyPoint[];
};

export type SubscriptionAuditSnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  requestedMonths: SubscriptionAuditMonthCount;
  exportId: string | null;
  intervals: SubscriptionAuditInterval[];
  offers: SubscriptionAuditOffer[];
  inventoryEvidence: SubscriptionInventoryEvidence;
  upstreamCoverage: SubscriptionUpstreamCoverage;
  summary: {
    currentActiveSubscriptions: number;
    provenSubscriptionRevenue: number | null;
    revenueCurrencyCode: string | null;
    revenueCoverage: SubscriptionRevenueCoverage;
  };
  historyCapability: {
    supportsSinceEnrollmentMonthlySeries: false;
    maximumOfficialLookbackMonths: 23;
    notice: string;
  };
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}格式無效。`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  ) {
    throw new Error(`${label}缺少或含有無效字元。`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maximum = 512): string | null {
  if (value === undefined || value === null || value === "") return null;
  return text(value, label, maximum);
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}不是有效的非負數。`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  return nonNegativeNumber(value, label);
}

function integer(value: unknown, label: string): number {
  const result = nonNegativeNumber(value, label);
  if (!Number.isSafeInteger(result)) throw new Error(`${label}不是安全整數。`);
  return result;
}

function optionalInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  return integer(value, label);
}

function currency(value: unknown, label: string): string {
  const result = text(value, label, 3);
  if (!/^[A-Z]{3}$/u.test(result)) throw new Error(`${label}格式無效。`);
  return result;
}

function optionalPercentage(value: unknown, label: string): number | null {
  const result = optionalNonNegativeNumber(value, label);
  if (result !== null && (result > 100 || !Number.isSafeInteger(result))) {
    throw new Error(`${label}必須是 0 到 100 的整數百分比。`);
  }
  return result;
}

function expectedCoverageStatus(
  expectedOfferMonths: number,
  reportedOfferMonths: number,
  sourceIncomplete = false,
): SubscriptionRevenueCoverage["status"] {
  if (!sourceIncomplete && reportedOfferMonths === expectedOfferMonths) {
    return "complete";
  }
  return reportedOfferMonths === 0 ? "unavailable" : "partial";
}

function parseRevenueCoverage(
  value: unknown,
  expectedOfferMonths: number,
  reportedOfferMonths: number,
  sourceIncomplete = false,
): SubscriptionRevenueCoverage {
  const raw = record(value, "S&S 營收完整度");
  const parsedExpected = integer(raw.expectedOfferMonths, "S&S 預期 SKU 月份數");
  const parsedReported = integer(raw.reportedOfferMonths, "S&S 已回傳 SKU 月份數");
  const status = raw.status;
  if (
    (status !== "complete" && status !== "partial" && status !== "unavailable") ||
    parsedExpected !== expectedOfferMonths ||
    parsedReported !== reportedOfferMonths ||
    parsedReported > parsedExpected ||
    status !== expectedCoverageStatus(
      parsedExpected,
      parsedReported,
      sourceIncomplete,
    )
  ) {
    throw new Error("S&S 營收完整度與 SKU 月度明細不一致。");
  }
  return {
    status,
    expectedOfferMonths: parsedExpected,
    reportedOfferMonths: parsedReported,
  };
}

function parseUpstreamCoverage(
  value: unknown,
  requestedMonthValues: readonly string[],
): SubscriptionUpstreamCoverage {
  const requestedMonths = requestedMonthValues.length;
  const requestedMonthSet = new Set(requestedMonthValues);
  const raw = record(value, "Amazon Replenishment 回應完整度");
  const returnedOfferRows = integer(raw.returnedOfferRows, "Replenishment offer 回傳列數");
  const acceptedOfferRows = integer(raw.acceptedOfferRows, "Replenishment offer 可核對列數");
  const returnedMetricRows = integer(raw.returnedMetricRows, "Replenishment metric 回傳列數");
  const acceptedMetricRows = integer(raw.acceptedMetricRows, "Replenishment metric 可核對列數");
  if (!Array.isArray(raw.invalidOfferRows)) {
    throw new Error("Replenishment offer 資料值問題清單格式無效。");
  }
  const invalidOfferRows = raw.invalidOfferRows.map((value, index) => {
    const row = record(value, `第 ${index + 1} 個 Replenishment offer 資料值問題`);
    return {
      sellerSku: text(row.sellerSku, `第 ${index + 1} 個問題 SKU`, 256),
      problem: text(row.problem, `第 ${index + 1} 個 offer 問題`, 1_000),
    };
  });
  const invalidOfferSkus = invalidOfferRows.map(({ sellerSku }) => sellerSku);
  if (new Set(invalidOfferSkus).size !== invalidOfferSkus.length) {
    throw new Error("Replenishment offer 資料值問題清單含有重複 SKU。");
  }
  const legacyCoverage = raw.problemSkuRows === undefined;
  const rawProblemSkuRows = legacyCoverage ? [] : raw.problemSkuRows;
  if (!Array.isArray(rawProblemSkuRows)) {
    throw new Error("Replenishment 問題 SKU 清單格式無效。");
  }
  const problemSkuRows = rawProblemSkuRows.map((value, index) => {
    const row = record(value, `第 ${index + 1} 個 Replenishment 問題 SKU`);
    if (!Array.isArray(row.metricMonths)) {
      throw new Error(`第 ${index + 1} 個問題 SKU 月份格式無效。`);
    }
    const metricMonths = row.metricMonths.map((month, monthIndex) => {
      const parsed = validMonth(
        month,
        `第 ${index + 1} 個問題 SKU 的第 ${monthIndex + 1} 個月份`,
      );
      if (!requestedMonthSet.has(parsed)) {
        throw new Error(`問題 SKU 月份 ${parsed} 不在本次所選範圍。`);
      }
      return parsed;
    });
    const affectedOfferRows = integer(
      row.affectedOfferRows,
      `第 ${index + 1} 個問題 SKU 的 offer 列數`,
    );
    const affectedMetricRows = integer(
      row.affectedMetricRows,
      `第 ${index + 1} 個問題 SKU 的 metric 列數`,
    );
    if (
      affectedOfferRows + affectedMetricRows < 1 ||
      new Set(metricMonths).size !== metricMonths.length ||
      !metricMonths.every((month, monthIndex) =>
        month === [...metricMonths].sort()[monthIndex]) ||
      (affectedMetricRows === 0) !== (metricMonths.length === 0) ||
      affectedMetricRows < metricMonths.length
    ) {
      throw new Error(`第 ${index + 1} 個問題 SKU 的影響範圍無法核對。`);
    }
    return {
      sellerSku: text(row.sellerSku, `第 ${index + 1} 個問題 SKU`, 256),
      fbaEvidence: row.fbaEvidence === "CURRENT_FBA_SKU_SET"
        ? "CURRENT_FBA_SKU_SET" as const
        : (() => { throw new Error(`第 ${index + 1} 個問題 SKU 缺少同次 FBA 證據。`); })(),
      affectedOfferRows,
      affectedMetricRows,
      metricMonths,
      problem: text(row.problem, `第 ${index + 1} 個問題 SKU 說明`, 2_000),
    };
  });
  if (
    new Set(problemSkuRows.map(({ sellerSku }) => sellerSku)).size !==
      problemSkuRows.length ||
    (!legacyCoverage && invalidOfferRows.some((invalid) => {
      const problem = problemSkuRows.find(
        ({ sellerSku }) => sellerSku === invalid.sellerSku,
      );
      return !problem || problem.affectedOfferRows < 1;
    }))
  ) {
    throw new Error("Replenishment 問題 SKU 清單與 offer 問題不一致。");
  }
  const rawUnproven = legacyCoverage
    ? {
        exactSkuCount: invalidOfferRows.length,
        affectedOfferRows: invalidOfferRows.length,
        affectedMetricRows: 0,
        minimumUnresolvedOfferMonths: invalidOfferRows.length * requestedMonths,
      }
    : record(
        raw.unprovenExactSkuProblems,
        "缺少同次 FBA 證據的 Replenishment 問題摘要",
      );
  const unprovenExactSkuProblems = {
    exactSkuCount: integer(
      rawUnproven.exactSkuCount,
      "缺少同次 FBA 證據的精確問題 SKU 數",
    ),
    affectedOfferRows: integer(
      rawUnproven.affectedOfferRows,
      "缺少同次 FBA 證據的問題 offer 列數",
    ),
    affectedMetricRows: integer(
      rawUnproven.affectedMetricRows,
      "缺少同次 FBA 證據的問題 metric 列數",
    ),
    minimumUnresolvedOfferMonths: integer(
      rawUnproven.minimumUnresolvedOfferMonths,
      "缺少同次 FBA 證據的問題 SKU 月份數",
    ),
  };
  if (
    (unprovenExactSkuProblems.exactSkuCount === 0) !==
      (unprovenExactSkuProblems.affectedOfferRows === 0 &&
        unprovenExactSkuProblems.affectedMetricRows === 0 &&
        unprovenExactSkuProblems.minimumUnresolvedOfferMonths === 0) ||
    unprovenExactSkuProblems.affectedOfferRows +
      unprovenExactSkuProblems.affectedMetricRows <
      unprovenExactSkuProblems.exactSkuCount ||
    unprovenExactSkuProblems.minimumUnresolvedOfferMonths <
      unprovenExactSkuProblems.exactSkuCount
  ) {
    throw new Error("缺少同次 FBA 證據的 Replenishment 問題摘要互相矛盾。");
  }
  const rejectedSellerSkuRows = integer(
    raw.rejectedSellerSkuRows,
    "Replenishment 缺少可核對 SKU 列數",
  );
  const minimumUnresolvedOfferMonths = integer(
    raw.minimumUnresolvedOfferMonths,
    "Replenishment 至少無法核對的 SKU 月份數",
  );
  const rejectedOfferRows = returnedOfferRows - acceptedOfferRows;
  const rejectedMetricRows = returnedMetricRows - acceptedMetricRows;
  const problemOfferRows = problemSkuRows.reduce(
    (sum, row) => sum + row.affectedOfferRows,
    0,
  );
  const problemMetricRows = problemSkuRows.reduce(
    (sum, row) => sum + row.affectedMetricRows,
    0,
  );
  const missingSellerSkuOfferRows = rejectedOfferRows - problemOfferRows -
    unprovenExactSkuProblems.affectedOfferRows;
  const missingSellerSkuMetricRows = rejectedMetricRows - problemMetricRows -
    unprovenExactSkuProblems.affectedMetricRows;
  const expectedRejectedSellerSkuRows =
    missingSellerSkuOfferRows + missingSellerSkuMetricRows;
  const knownProblemOfferMonths = problemSkuRows.reduce(
    (sum, row) => sum + (row.affectedOfferRows > 0
      ? requestedMonths
      : row.metricMonths.length),
    0,
  ) + unprovenExactSkuProblems.minimumUnresolvedOfferMonths;
  const expectedMinimumUnresolved = Math.max(
    knownProblemOfferMonths,
    missingSellerSkuOfferRows * requestedMonths,
    missingSellerSkuMetricRows,
  );
  const status = raw.status;
  if (
    acceptedOfferRows > returnedOfferRows ||
    acceptedMetricRows > returnedMetricRows ||
    missingSellerSkuOfferRows < 0 ||
    missingSellerSkuMetricRows < 0 ||
    expectedRejectedSellerSkuRows !== rejectedSellerSkuRows ||
    expectedMinimumUnresolved !== minimumUnresolvedOfferMonths ||
    (status !== "complete" && status !== "partial") ||
    status !==
      (rejectedOfferRows === 0 && rejectedMetricRows === 0 ? "complete" : "partial")
  ) {
    throw new Error("Amazon Replenishment 回應完整度與原始列數不一致。");
  }
  return {
    status,
    returnedOfferRows,
    acceptedOfferRows,
    returnedMetricRows,
    acceptedMetricRows,
    invalidOfferRows: legacyCoverage ? [] : invalidOfferRows,
    problemSkuRows,
    unprovenExactSkuProblems,
    rejectedSellerSkuRows,
    minimumUnresolvedOfferMonths,
    notice: text(raw.notice, "Replenishment 回應完整度說明", 2_000),
  };
}

function parseInventoryEvidence(
  value: unknown,
  verifiableOfferCount: number,
): SubscriptionInventoryEvidence {
  const raw = record(value, "同次 FBA Inventory 證據");
  const provenSkuCount = integer(
    raw.provenSkuCount,
    "同次已證明 FBA SKU 數",
  );
  const returnedInventoryRows = integer(
    raw.returnedInventoryRows,
    "同次 FBA Inventory 回傳列數",
  );
  const unrecognizedSellerSkuRows = integer(
    raw.unrecognizedSellerSkuRows,
    "無法原樣辨識 Seller SKU 的 FBA Inventory 列數",
  );
  const verifiableReplenishmentOfferCount = integer(
    raw.verifiableReplenishmentOfferCount,
    "可核對 Replenishment offer 數",
  );
  const unverifiedFbaSkuCount = integer(
    raw.unverifiedFbaSkuCount,
    "未回傳可核對 offer 的 FBA SKU 數",
  );
  if (
    raw.source !== "FBA_INVENTORY_API_COMPLETE_PAGINATION" ||
    (raw.coverage !== "complete" && raw.coverage !== "partial") ||
    returnedInventoryRows !== provenSkuCount + unrecognizedSellerSkuRows ||
    raw.coverage !==
      (unrecognizedSellerSkuRows === 0 ? "complete" : "partial") ||
    verifiableReplenishmentOfferCount !== verifiableOfferCount ||
    provenSkuCount !==
      verifiableReplenishmentOfferCount + unverifiedFbaSkuCount
  ) {
    throw new Error("同次 FBA Inventory 證據與 S&S offer 範圍不一致。");
  }
  return {
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION",
    coverage: raw.coverage,
    returnedInventoryRows,
    provenSkuCount,
    unrecognizedSellerSkuRows,
    verifiableReplenishmentOfferCount,
    unverifiedFbaSkuCount,
  };
}

function validIso(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (Number.isNaN(new Date(result).getTime())) throw new Error(`${label}不是有效日期。`);
  return result;
}

function validMonth(value: unknown, label: string): string {
  const result = text(value, label, 7);
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(result)) {
    throw new Error(`${label}必須使用 YYYY-MM。`);
  }
  return result;
}

function monthCount(value: unknown): SubscriptionAuditMonthCount {
  if (value !== 6 && value !== 12 && value !== 23) {
    throw new Error("訂閱歷史只能選擇最近 6、12 或 23 個完整月。");
  }
  return value;
}

function parseInterval(value: unknown, index: number): SubscriptionAuditInterval {
  const raw = record(value, `第 ${index + 1} 個月份`);
  const month = validMonth(raw.month, `第 ${index + 1} 個月份`);
  const startDate = validIso(raw.startDate, `${month} 開始日`);
  const endDate = validIso(raw.endDate, `${month} 結束日`);
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  if (
    startDate !== `${month}-01T00:00:00Z` ||
    endDate !== `${month}-${String(lastDay).padStart(2, "0")}T00:00:00Z`
  ) {
    throw new Error(`${month} 不是可核對的完整月區間。`);
  }
  return { month, startDate, endDate };
}

function parsePoint(
  value: unknown,
  index: number,
  knownMonths: ReadonlySet<string>,
  expectedCurrency: string,
): SubscriptionAuditMonthlyPoint {
  const raw = record(value, `第 ${index + 1} 個月度指標`);
  const month = validMonth(raw.month, `第 ${index + 1} 個月度指標`);
  if (!knownMonths.has(month)) throw new Error(`${month} 不在這次請求的完整月份內。`);
  const subscriptionRevenue = optionalNonNegativeNumber(
    raw.subscriptionRevenue,
    `${month} 訂閱營收`,
  );
  const currencyCode = optionalText(raw.currencyCode, `${month} 幣別`, 3);
  if (subscriptionRevenue !== null && currencyCode === null) {
    throw new Error(`${month} 的訂閱營收有值時必須包含幣別。`);
  }
  if (currencyCode !== null && currency(currencyCode, `${month} 幣別`) !== expectedCurrency) {
    throw new Error(`${month} 的訂閱營收幣別與商品價格不一致。`);
  }
  return {
    month,
    subscriptionRevenue,
    shippedSubscriptionUnits: optionalInteger(
      raw.shippedSubscriptionUnits,
      `${month} 訂閱配送件數`,
    ),
    activeSubscriptionsAtPeriodEnd: optionalInteger(
      raw.activeSubscriptionsAtPeriodEnd,
      `${month} 月底有效訂閱`,
    ),
    currencyCode,
  };
}

function parseOffer(
  value: unknown,
  index: number,
  intervals: readonly SubscriptionAuditInterval[],
): SubscriptionAuditOffer {
  const raw = record(value, `第 ${index + 1} 個 Subscribe & Save offer`);
  const sellerSku = text(raw.sellerSku, `第 ${index + 1} 個 SKU`, 256);
  const asin = text(raw.asin, `${sellerSku} ASIN`, 10);
  if (!/^[A-Z0-9]{10}$/u.test(asin)) throw new Error(`${sellerSku} 的 ASIN 格式無效。`);
  const price = record(raw.price, `${sellerSku} 目前價格`);
  const priceCurrency = currency(price.currencyCode, `${sellerSku} 價格幣別`);
  if (!Array.isArray(raw.monthlySeries)) {
    throw new Error(`${sellerSku} 缺少可核對的月度序列。`);
  }
  const knownMonths = new Set(intervals.map(({ month }) => month));
  const monthlySeries = raw.monthlySeries.map((point, pointIndex) =>
    parsePoint(point, pointIndex, knownMonths, priceCurrency));
  const pointMonths = monthlySeries.map(({ month }) => month);
  if (new Set(pointMonths).size !== pointMonths.length) {
    throw new Error(`${sellerSku} 含有重複月份。`);
  }
  const ordered = [...pointMonths].sort();
  if (!pointMonths.every((month, monthIndex) => month === ordered[monthIndex])) {
    throw new Error(`${sellerSku} 的月度序列沒有依月份排序。`);
  }
  if (raw.fbaEvidence !== "CURRENT_FBA_SKU_SET") {
    throw new Error(`${sellerSku} 沒有目前 FBA 證據，已停止顯示。`);
  }
  return {
    sellerSku,
    asin,
    eligibility: text(raw.eligibility, `${sellerSku} S&S 資格`, 80),
    price: {
      amount: nonNegativeNumber(price.amount, `${sellerSku} 目前價格`),
      currencyCode: priceCurrency,
    },
    sellerFundedBaseDiscount: optionalPercentage(
      raw.sellerFundedBaseDiscount,
      `${sellerSku} Seller 基礎折扣`,
    ),
    sellerFundedTieredDiscount: optionalPercentage(
      raw.sellerFundedTieredDiscount,
      `${sellerSku} Seller 階梯折扣`,
    ),
    currentActiveSubscriptions: integer(
      raw.currentActiveSubscriptions,
      `${sellerSku} 目前有效訂閱`,
    ),
    fbaEvidence: "CURRENT_FBA_SKU_SET",
    monthlySeries,
  };
}

export function parseSubscriptionAuditSnapshot(rawValue: unknown): SubscriptionAuditSnapshot {
  const raw = record(rawValue, "全站訂閱健檢回應");
  const requestedMonths = monthCount(raw.requestedMonths);
  if (!Array.isArray(raw.intervals) || raw.intervals.length !== requestedMonths) {
    throw new Error("Amazon 完整月份數量與選擇範圍不一致。");
  }
  const intervals = raw.intervals.map(parseInterval);
  const months = intervals.map(({ month }) => month);
  if (new Set(months).size !== months.length || !months.every((month, index) => month === [...months].sort()[index])) {
    throw new Error("Amazon 完整月份有重複或排序錯誤。");
  }
  if (!Array.isArray(raw.offers)) throw new Error("全站訂閱健檢缺少 offer 清單。");
  const offers = raw.offers.map((offer, index) => parseOffer(offer, index, intervals));
  const inventoryEvidence = parseInventoryEvidence(
    raw.inventoryEvidence,
    offers.length,
  );
  const upstreamCoverage = parseUpstreamCoverage(
    raw.upstreamCoverage,
    months,
  );
  const skus = offers.map(({ sellerSku }) => sellerSku);
  if (new Set(skus).size !== skus.length) throw new Error("全站訂閱健檢含有重複 SKU。");
  if (upstreamCoverage.problemSkuRows.some(
    ({ sellerSku, affectedOfferRows }) =>
      affectedOfferRows > 0 && skus.includes(sellerSku),
  )) {
    throw new Error("offer 問題 SKU 不可同時出現在可核對 offer 清單。");
  }
  const summary = record(raw.summary, "訂閱健檢摘要");
  const currentActiveSubscriptions = integer(
    summary.currentActiveSubscriptions,
    "全站目前有效訂閱",
  );
  if (currentActiveSubscriptions !== offers.reduce((sum, offer) => sum + offer.currentActiveSubscriptions, 0)) {
    throw new Error("全站目前有效訂閱摘要與 SKU 明細不一致。");
  }
  const provenSubscriptionRevenue = optionalNonNegativeNumber(
    summary.provenSubscriptionRevenue,
    "所選完整月份可證明的 S&S 營收",
  );
  const revenueCurrencyCode = optionalText(summary.revenueCurrencyCode, "S&S 營收幣別", 3);
  const reportedOfferMonths = offers.reduce(
    (sum, offer) =>
      sum + offer.monthlySeries.filter((point) => point.subscriptionRevenue !== null).length,
    0,
  );
  const revenueCoverage = parseRevenueCoverage(
    summary.revenueCoverage,
    offers.length * intervals.length,
    reportedOfferMonths,
    upstreamCoverage.status === "partial" ||
      inventoryEvidence.coverage === "partial" ||
      inventoryEvidence.unverifiedFbaSkuCount > 0,
  );
  if (revenueCoverage.status === "complete") {
    if (provenSubscriptionRevenue === null || revenueCurrencyCode === null) {
      throw new Error("完整 S&S 營收必須同時包含總額與幣別。");
    }
    currency(revenueCurrencyCode, "S&S 營收幣別");
    const revenuePoints = offers.flatMap(({ monthlySeries }) => monthlySeries)
      .filter((point) => point.subscriptionRevenue !== null);
    if (revenuePoints.some((point) => point.currencyCode !== revenueCurrencyCode)) {
      throw new Error("SKU 月度 S&S 營收幣別與摘要不一致。");
    }
    const detailRevenue = revenuePoints.reduce(
      (sum, point) => sum + (point.subscriptionRevenue ?? 0),
      0,
    );
    if (Math.abs(detailRevenue - provenSubscriptionRevenue!) > 0.005) {
      throw new Error("所選完整月份 S&S 營收摘要與 SKU 月度明細不一致。");
    }
  } else if (provenSubscriptionRevenue !== null || revenueCurrencyCode !== null) {
    throw new Error("S&S 營收資料不完整時不可顯示部分總額或幣別。");
  }
  const capability = record(raw.historyCapability, "訂閱歷史能力");
  if (
    capability.supportsSinceEnrollmentMonthlySeries !== false ||
    capability.maximumOfficialLookbackMonths !== 23
  ) {
    throw new Error("訂閱歷史能力邊界與 Amazon 公開 API 不一致。");
  }
  return {
    mode: raw.mode === "live" ? "live" : raw.mode === "demo" ? "demo" : (() => { throw new Error("訂閱健檢模式無效。"); })(),
    marketplaceId: text(raw.marketplaceId, "訂閱健檢站點", 32),
    fetchedAt: validIso(raw.fetchedAt, "訂閱健檢時間"),
    requestedMonths,
    exportId: optionalText(raw.exportId ?? raw.snapshotId, "訂閱健檢匯出 ID", 200),
    intervals,
    offers,
    inventoryEvidence,
    upstreamCoverage,
    summary: {
      currentActiveSubscriptions,
      provenSubscriptionRevenue,
      revenueCurrencyCode,
      revenueCoverage,
    },
    historyCapability: {
      supportsSinceEnrollmentMonthlySeries: false,
      maximumOfficialLookbackMonths: 23,
      notice: text(capability.notice, "訂閱歷史能力說明", 2_000),
    },
  };
}

export function subscriptionAuditMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year}年${monthNumber}月`;
}
