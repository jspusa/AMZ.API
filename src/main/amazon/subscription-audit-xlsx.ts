import { strToU8, zipSync } from "fflate";
import {
  SUBSCRIPTION_AUDIT_DISCOUNT_BUCKETS,
  subscriptionAuditDiscountBucket,
  type SubscriptionAuditDiscountBucket,
} from "./replenishment-audit";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAX_CELL_CHARACTERS = 32_767;
const DISCOUNT_SHEET_HEADERS = [
  "SKU",
  "ASIN",
  "目前價格",
  "幣別",
  "Seller 基礎折扣",
  "Seller 階梯折扣",
  "目前有效訂閱",
  "官方月度月份",
  "月度資料狀態",
  "官方月度 S&S 營收",
  "月度營收幣別",
  "該月配送件數",
  "該月底有效訂閱",
  "15 天預估配送",
  "30 天預估配送",
  "60 天預估配送",
  "90 天預估配送",
  "FBA 證據",
] as const;

const PROBLEM_SHEET_HEADERS = [
  "問題類型",
  "SKU",
  "ASIN",
  "Seller 基礎折扣",
  "目前價格",
  "幣別",
  "目前有效訂閱",
  "受影響月份",
  "說明",
  "FBA 證據",
] as const;

export type SubscriptionAuditRevenueCoverage = {
  status: "complete" | "partial" | "unavailable";
  expectedOfferMonths: number;
  reportedOfferMonths: number;
};

export type SubscriptionAuditWorkbookMonthlyPoint = {
  month: string;
  revenueCurrencyCode: string | null;
  subscriptionRevenue: number | null;
  shippedSubscriptionUnits: number | null;
  activeSubscriptionsAtPeriodEnd: number | null;
};

export type SubscriptionAuditProblemWorkbookRow = {
  /** Null means the discount is unknown or outside the five supported buckets. */
  bucket: SubscriptionAuditDiscountBucket | null;
  problem: string;
  sellerSku: string;
  asin: string;
  currentPrice: number;
  currencyCode: string;
  sellerFundedBaseDiscount: number | null;
  sellerFundedTieredDiscount: number | null;
  currentActiveSubscriptions: number;
  /** Only points actually returned by Amazon. Missing selected months stay omitted. */
  monthlySeries: readonly SubscriptionAuditWorkbookMonthlyPoint[];
  forecastDeliveries: {
    next15Days: number | null;
    next30Days: number | null;
    next60Days: number | null;
    next90Days: number | null;
  } | null;
  fbaEvidence: "CURRENT_FBA_SKU_SET";
};

export type CreateSubscriptionAuditWorkbookInput = {
  marketplaceLabel: string;
  generatedAt: string | Date;
  metricMonths: readonly string[];
  currentActiveSubscriptions: number;
  provenSubscriptionRevenue: number | null;
  revenueCurrencyCode: string | null;
  revenueCoverage: SubscriptionAuditRevenueCoverage;
  inventoryEvidence: {
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION";
    coverage: "complete" | "partial";
    returnedInventoryRows: number;
    provenSkuCount: number;
    unrecognizedSellerSkuRows: number;
    verifiableReplenishmentOfferCount: number;
    unverifiedFbaSkuCount: number;
  };
  upstreamCoverage?: {
    status: "complete" | "partial";
    returnedOfferRows: number;
    acceptedOfferRows: number;
    returnedMetricRows: number;
    acceptedMetricRows: number;
    invalidOfferRows: readonly { sellerSku: string; problem: string }[];
    problemSkuRows?: readonly {
      sellerSku: string;
      fbaEvidence: "CURRENT_FBA_SKU_SET";
      affectedOfferRows: number;
      affectedMetricRows: number;
      metricMonths: readonly string[];
      problem: string;
    }[];
    unprovenExactSkuProblems?: {
      exactSkuCount: number;
      affectedOfferRows: number;
      affectedMetricRows: number;
      minimumUnresolvedOfferMonths: number;
    };
    rejectedSellerSkuRows: number;
    minimumUnresolvedOfferMonths: number;
    notice: string;
  };
  excluded?: readonly {
    sellerSku: string;
    fbaEvidence: "CURRENT_FBA_SKU_SET";
    reason: "METRIC_WITHOUT_CURRENT_OFFER" | "ASIN_MISMATCH";
  }[];
  problems: readonly SubscriptionAuditProblemWorkbookRow[];
};

type Cell = { kind: "text" | "number"; value: string | number | null };
type SubscriptionAuditUpstreamCoverageInput = NonNullable<
  CreateSubscriptionAuditWorkbookInput["upstreamCoverage"]
>;
type ValidatedSubscriptionAuditUpstreamCoverage =
  SubscriptionAuditUpstreamCoverageInput & {
    problemSkuRows: NonNullable<
      SubscriptionAuditUpstreamCoverageInput["problemSkuRows"]
    >;
    unprovenExactSkuProblems: NonNullable<
      SubscriptionAuditUpstreamCoverageInput["unprovenExactSkuProblems"]
    >;
  };
type ValidatedSubscriptionAuditExcludedRow = NonNullable<
  CreateSubscriptionAuditWorkbookInput["excluded"]
>[number];
type SubscriptionAuditProblemSheetRow = {
  kinds: string[];
  sellerSku: string | null;
  asin: string | null;
  sellerFundedBaseDiscount: number | null;
  currentPrice: number | null;
  currencyCode: string | null;
  currentActiveSubscriptions: number | null;
  affectedMonths: string;
  problems: string[];
  fbaEvidence: string;
};

/**
 * Generates a local-only workbook. The first five sheets contain only normal
 * rows in the exact seller-funded discount bucket. Unknown/non-standard
 * discounts and CURRENT_FBA problem rows appear once in the dedicated problem
 * sheet. Summary values are computed before export and never use formulas.
 */
export function createSubscriptionAuditWorkbook(
  input: CreateSubscriptionAuditWorkbookInput,
): Uint8Array {
  const generatedAt = validDate(input.generatedAt);
  const marketplaceLabel = safeRequiredText(input.marketplaceLabel, "marketplaceLabel");
  const metricMonths = validateMetricMonths(input.metricMonths);
  const totalSubscriptions = safeInteger(
    input.currentActiveSubscriptions,
    "currentActiveSubscriptions",
  );
  const totalRevenue = optionalNumber(
    input.provenSubscriptionRevenue,
    "provenSubscriptionRevenue",
  );
  const revenueCurrency = input.revenueCurrencyCode === null
    ? null
    : validCurrency(input.revenueCurrencyCode, "revenueCurrencyCode");
  if ((totalRevenue === null) !== (revenueCurrency === null)) {
    throw new TypeError(
      "provenSubscriptionRevenue and revenueCurrencyCode must both be present or absent.",
    );
  }

  const seen = new Set<string>();
  const rows = input.problems.map((problem, index) => {
    validateProblem(problem, index);
    if (seen.has(problem.sellerSku)) {
      throw new TypeError(`Duplicate problem SKU: ${problem.sellerSku}`);
    }
    seen.add(problem.sellerSku);
    return problem;
  });
  const upstreamCoverage = validateUpstreamCoverage(
    input.upstreamCoverage,
    metricMonths,
  );
  const inventoryEvidence = validateInventoryEvidence(
    input.inventoryEvidence,
    rows.length,
  );
  const coverage = validateCoverage(
    input.revenueCoverage,
    rows,
    metricMonths,
    upstreamCoverage.status === "partial" ||
      inventoryEvidence.coverage === "partial" ||
      inventoryEvidence.unverifiedFbaSkuCount > 0,
  );
  if (coverage.status === "complete") {
    if (totalRevenue === null || revenueCurrency === null) {
      throw new TypeError(
        "Complete revenue coverage requires a numeric total and currency.",
      );
    }
    const computedRevenue = rows.reduce(
      (offerSum, row) =>
        offerSum + row.monthlySeries.reduce(
          (sum, point) => sum + (point.subscriptionRevenue ?? 0),
          0,
        ),
      0,
    );
    if (!numbersEqual(totalRevenue, computedRevenue)) {
      throw new TypeError("provenSubscriptionRevenue does not match the complete series.");
    }
  } else if (totalRevenue !== null || revenueCurrency !== null) {
    throw new TypeError(
      "Incomplete revenue coverage must not expose a numeric selected-period total.",
    );
  }

  const excluded = validateExcluded(input.excluded ?? []);
  const problemSheetRows = buildProblemSheetRows({
    rows,
    metricMonths,
    upstreamCoverage,
    inventoryEvidence,
    excluded,
  });
  const problemSkus = new Set(
    problemSheetRows.flatMap((row) => row.sellerSku ? [row.sellerSku] : []),
  );

  const sheets = SUBSCRIPTION_AUDIT_DISCOUNT_BUCKETS.map((bucket) => ({
    name: `${bucket}%`,
    xml: worksheetXml({
      marketplaceLabel,
      metricMonths,
      totalSubscriptions,
      totalRevenue,
      revenueCurrency,
      revenueCoverage: coverage,
      inventoryEvidence,
      upstreamCoverage,
      rows: rows.filter(
        (row) => row.bucket === bucket && !problemSkus.has(row.sellerSku),
      ),
    }),
  }));
  sheets.push({
    name: "問題 SKU",
    xml: problemWorksheetXml({
      marketplaceLabel,
      metricMonths,
      revenueCoverage: coverage,
      inventoryEvidence,
      upstreamCoverage,
      rows: problemSheetRows,
    }),
  });
  const archive: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(sheets.length)),
    "_rels/.rels": strToU8(packageRelationships()),
    "docProps/app.xml": strToU8(appProperties(sheets.map(({ name }) => name))),
    "docProps/core.xml": strToU8(coreProperties(marketplaceLabel, generatedAt)),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships(sheets.length)),
    "xl/styles.xml": strToU8(styles()),
    "xl/workbook.xml": strToU8(workbookXml(sheets.map(({ name }) => name))),
  };
  sheets.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml);
  });
  return zipSync(archive, { level: 6 });
}

function validateProblem(
  row: SubscriptionAuditProblemWorkbookRow,
  index: number,
): void {
  const expectedBucket = subscriptionAuditDiscountBucket(
    row.sellerFundedBaseDiscount,
  );
  if (row.bucket !== expectedBucket) {
    throw new TypeError(
      `problems[${index}].bucket must exactly match its Seller base discount; unknown and non-standard discounts must use null.`,
    );
  }
  safeRequiredText(row.problem, `problems[${index}].problem`);
  safeRequiredText(row.sellerSku, `problems[${index}].sellerSku`);
  if (!/^[A-Z0-9]{10}$/u.test(row.asin)) {
    throw new TypeError(`problems[${index}].asin is invalid.`);
  }
  nonNegativeNumber(row.currentPrice, `problems[${index}].currentPrice`);
  validCurrency(row.currencyCode, `problems[${index}].currencyCode`);
  optionalPercentage(
    row.sellerFundedBaseDiscount,
    `problems[${index}].sellerFundedBaseDiscount`,
  );
  optionalPercentage(
    row.sellerFundedTieredDiscount,
    `problems[${index}].sellerFundedTieredDiscount`,
  );
  safeInteger(
    row.currentActiveSubscriptions,
    `problems[${index}].currentActiveSubscriptions`,
  );
  const seenMonths = new Set<string>();
  row.monthlySeries.forEach((point, pointIndex) => {
    const prefix = `problems[${index}].monthlySeries[${pointIndex}]`;
    const month = validMonth(point.month, `${prefix}.month`);
    if (seenMonths.has(month)) {
      throw new TypeError(`problems[${index}] has a duplicate official month: ${month}`);
    }
    seenMonths.add(month);
    const revenue = optionalNumber(point.subscriptionRevenue, `${prefix}.subscriptionRevenue`);
    const currency = point.revenueCurrencyCode === null
      ? null
      : validCurrency(point.revenueCurrencyCode, `${prefix}.revenueCurrencyCode`);
    if (revenue !== null && currency === null) {
      throw new TypeError(`${prefix} has revenue without a currency.`);
    }
    optionalInteger(point.shippedSubscriptionUnits, `${prefix}.shippedSubscriptionUnits`);
    optionalInteger(
      point.activeSubscriptionsAtPeriodEnd,
      `${prefix}.activeSubscriptionsAtPeriodEnd`,
    );
  });
  for (const [key, value] of Object.entries(row.forecastDeliveries ?? {})) {
    optionalInteger(value, `problems[${index}].forecastDeliveries.${key}`);
  }
}

function validateExcluded(
  input: readonly ValidatedSubscriptionAuditExcludedRow[],
): ValidatedSubscriptionAuditExcludedRow[] {
  if (!Array.isArray(input)) throw new TypeError("excluded is invalid.");
  return input.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new TypeError(`excluded[${index}] is invalid.`);
    }
    const sellerSku = safeRequiredText(
      row.sellerSku,
      `excluded[${index}].sellerSku`,
    );
    if (row.fbaEvidence !== "CURRENT_FBA_SKU_SET") {
      throw new TypeError(`excluded[${index}] lacks current FBA evidence.`);
    }
    if (
      row.reason !== "METRIC_WITHOUT_CURRENT_OFFER" &&
      row.reason !== "ASIN_MISMATCH"
    ) {
      throw new TypeError(`excluded[${index}].reason is invalid.`);
    }
    return {
      sellerSku,
      fbaEvidence: "CURRENT_FBA_SKU_SET",
      reason: row.reason,
    };
  });
}

function buildProblemSheetRows(input: {
  rows: readonly SubscriptionAuditProblemWorkbookRow[];
  metricMonths: readonly string[];
  upstreamCoverage: ValidatedSubscriptionAuditUpstreamCoverage;
  inventoryEvidence: CreateSubscriptionAuditWorkbookInput["inventoryEvidence"];
  excluded: readonly ValidatedSubscriptionAuditExcludedRow[];
}): SubscriptionAuditProblemSheetRow[] {
  const rowsBySku = new Map(input.rows.map((row) => [row.sellerSku, row]));
  const bySku = new Map<string, SubscriptionAuditProblemSheetRow>();
  const entirePeriod = `${input.metricMonths[0]} ～ ${input.metricMonths.at(-1)}（${input.metricMonths.length} 個完整月）`;
  const addExact = (
    sellerSku: string,
    kind: string,
    problem: string,
    affectedMonths: string,
  ) => {
    const offer = rowsBySku.get(sellerSku);
    const existing = bySku.get(sellerSku) ?? {
      kinds: [],
      sellerSku,
      asin: offer?.asin ?? null,
      sellerFundedBaseDiscount: offer?.sellerFundedBaseDiscount ?? null,
      currentPrice: offer?.currentPrice ?? null,
      currencyCode: offer?.currencyCode ?? null,
      currentActiveSubscriptions: offer?.currentActiveSubscriptions ?? null,
      affectedMonths,
      problems: [],
      fbaEvidence: "CURRENT_FBA_SKU_SET",
    };
    if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
    if (!existing.problems.includes(problem)) existing.problems.push(problem);
    if (
      existing.affectedMonths !== affectedMonths &&
      !existing.affectedMonths.includes(affectedMonths)
    ) {
      existing.affectedMonths = `${existing.affectedMonths}；${affectedMonths}`;
    }
    bySku.set(sellerSku, existing);
  };

  for (const row of input.rows) {
    if (row.bucket !== null) continue;
    addExact(
      row.sellerSku,
      row.sellerFundedBaseDiscount === null ? "折扣未回傳" : "非標準折扣",
      row.sellerFundedBaseDiscount === null
        ? "Amazon 未回傳 Seller 基礎折扣；不歸入 0% 工作表，也不代表 0%。"
        : `Amazon 回傳 ${row.sellerFundedBaseDiscount}% Seller 基礎折扣；不屬於 0／5／10／15／20% 任一標準組。`,
      entirePeriod,
    );
  }

  for (const row of input.upstreamCoverage.problemSkuRows) {
    addExact(
      row.sellerSku,
      row.affectedOfferRows > 0 ? "offer 資料問題" : "月度指標問題",
      row.problem,
      row.affectedOfferRows > 0
        ? entirePeriod
        : row.metricMonths.length > 0
          ? row.metricMonths.join("、")
          : "Amazon 未指定月份",
    );
  }

  for (const row of input.excluded) {
    addExact(
      row.sellerSku,
      "offer／metric 無法合併",
      row.reason === "ASIN_MISMATCH"
        ? "Amazon 回傳的 offer 與月度指標 ASIN 不一致；未強行合併。"
        : "Amazon 回傳月度指標，但沒有同次可核對的目前 offer；未推定折扣或訂閱數。",
      entirePeriod,
    );
  }

  const exactMissingOfferSkus = new Set([
    ...input.upstreamCoverage.problemSkuRows
      .filter((row) => row.affectedOfferRows > 0 && !rowsBySku.has(row.sellerSku))
      .map((row) => row.sellerSku),
    ...input.excluded
      .filter((row) => !rowsBySku.has(row.sellerSku))
      .map((row) => row.sellerSku),
  ]);
  const unidentifiedOfferCount =
    input.inventoryEvidence.unverifiedFbaSkuCount - exactMissingOfferSkus.size;
  if (unidentifiedOfferCount < 0) {
    throw new TypeError(
      "Problem SKU identifiers exceed the aggregate unverified FBA offer count.",
    );
  }

  const aggregateRows: SubscriptionAuditProblemSheetRow[] = [];
  const addAggregate = (kind: string, problem: string, evidence: string) => {
    aggregateRows.push({
      kinds: [kind],
      sellerSku: null,
      asin: null,
      sellerFundedBaseDiscount: null,
      currentPrice: null,
      currencyCode: null,
      currentActiveSubscriptions: null,
      affectedMonths: entirePeriod,
      problems: [problem],
      fbaEvidence: evidence,
    });
  };
  if (unidentifiedOfferCount > 0) {
    addAggregate(
      "未取得可核對 offer",
      `${unidentifiedOfferCount} 個同次已證明為 FBA 的 SKU 未取得可安全核對的 Replenishment offer；快照只保留聚合計數，不輸出未來自可核對 offer 的 identifier。這不代表 0% 折扣或 0 訂閱。`,
      "CURRENT_FBA_SKU_SET（聚合計數）",
    );
  }
  if (input.inventoryEvidence.unrecognizedSellerSkuRows > 0) {
    addAggregate(
      "FBA Inventory identifier 未完成",
      `${input.inventoryEvidence.unrecognizedSellerSkuRows} 列 FBA Inventory Seller SKU 無法原樣辨識；未 trim、改名、推定折扣或訂閱數。`,
      "未輸出 identifier",
    );
  }
  if (input.upstreamCoverage.rejectedSellerSkuRows > 0) {
    addAggregate(
      "Replenishment identifier 未完成",
      `${input.upstreamCoverage.rejectedSellerSkuRows} 列 Amazon Replenishment 資料缺少可原樣核對的 Seller SKU；只保留計數。`,
      "未輸出 identifier",
    );
  }
  const unproven = input.upstreamCoverage.unprovenExactSkuProblems;
  if (unproven.exactSkuCount > 0) {
    addAggregate(
      "缺少同次 CURRENT_FBA 證據",
      `${unproven.exactSkuCount} 個精確上游問題 SKU 缺少同次 CURRENT_FBA 證據；只輸出聚合計數，不顯示 identifier，也不推論為 FBM。`,
      "缺少同次 CURRENT_FBA；未輸出 identifier",
    );
  }

  return [
    ...[...bySku.values()].sort((left, right) =>
      left.sellerSku!.localeCompare(right.sellerSku!)),
    ...aggregateRows,
  ];
}

function problemWorksheetXml(input: {
  marketplaceLabel: string;
  metricMonths: readonly string[];
  revenueCoverage: SubscriptionAuditRevenueCoverage;
  inventoryEvidence: CreateSubscriptionAuditWorkbookInput["inventoryEvidence"];
  upstreamCoverage: ValidatedSubscriptionAuditUpstreamCoverage;
  rows: readonly SubscriptionAuditProblemSheetRow[];
}): string {
  const firstMonth = input.metricMonths[0]!;
  const lastMonth = input.metricMonths.at(-1)!;
  const exactProblemCount = input.rows.filter((row) => row.sellerSku !== null).length;
  const aggregateProblemCount = input.rows.length - exactProblemCount;
  const metaRows: Cell[][] = [
    [textCell("站點"), textCell(input.marketplaceLabel)],
    [textCell("所選完整月份"), textCell(`${firstMonth} ～ ${lastMonth}（${input.metricMonths.length} 個完整月）`)],
    [
      textCell("本表用途"),
      textCell("未知／非標準折扣、CURRENT_FBA 上游問題與無法安全輸出 identifier 的聚合問題只在這裡出現一次；不會被塞進 0% 或重複到五張折扣表。"),
    ],
    [
      textCell("問題範圍"),
      textCell(`${exactProblemCount} 個可原樣核對的 CURRENT_FBA 問題 SKU；${aggregateProblemCount} 個只能安全輸出計數的問題摘要。五張折扣表只保留標準折扣且沒有問題的逐月資料。`),
    ],
    [
      textCell("整體 coverage"),
      textCell(coverageLabel(
        input.revenueCoverage,
        input.upstreamCoverage,
        input.inventoryEvidence,
      )),
    ],
  ];
  const dataRows = input.rows.map((row): Cell[] => [
    textCell(row.kinds.join("；")),
    textCell(row.sellerSku ?? ""),
    textCell(row.asin ?? ""),
    numberCell(row.sellerFundedBaseDiscount),
    numberCell(row.currentPrice),
    textCell(row.currencyCode ?? ""),
    numberCell(row.currentActiveSubscriptions),
    textCell(row.affectedMonths),
    textCell(row.problems.join("；")),
    textCell(row.fbaEvidence),
  ]);
  const headerRow = metaRows.length + 1;
  const dataStartRow = headerRow + 1;
  const finalRow = Math.max(headerRow, headerRow + dataRows.length);
  const summary = metaRows
    .map((row, index) => xmlRow(index + 1, row, index === 0 ? 2 : 0))
    .join("");
  const headers = xmlRow(headerRow, PROBLEM_SHEET_HEADERS.map(textCell), 1);
  const data = dataRows
    .map((row, index) => xmlRow(index + dataStartRow, row, 0))
    .join("");
  const lastColumn = column(PROBLEM_SHEET_HEADERS.length);
  return `${XML}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${finalRow}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A${dataStartRow}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${[24, 24, 16, 18, 15, 12, 18, 28, 70, 34].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
  <sheetData>${summary}${headers}${data}</sheetData>
  <autoFilter ref="A${headerRow}:${lastColumn}${finalRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}

function worksheetXml(input: {
  marketplaceLabel: string;
  metricMonths: readonly string[];
  totalSubscriptions: number;
  totalRevenue: number | null;
  revenueCurrency: string | null;
  revenueCoverage: SubscriptionAuditRevenueCoverage;
  inventoryEvidence: CreateSubscriptionAuditWorkbookInput["inventoryEvidence"];
  upstreamCoverage: ValidatedSubscriptionAuditUpstreamCoverage;
  rows: readonly SubscriptionAuditProblemWorkbookRow[];
}): string {
  const firstMonth = input.metricMonths[0]!;
  const lastMonth = input.metricMonths.at(-1)!;
  const metaRows: Cell[][] = [
    [textCell("站點"), textCell(input.marketplaceLabel)],
    [
      textCell(
        input.upstreamCoverage.status === "complete" &&
          input.inventoryEvidence.coverage === "complete" &&
          input.inventoryEvidence.unverifiedFbaSkuCount === 0
          ? "全站目前有效訂閱"
          : "已核對目前有效訂閱（範圍不完整）",
      ),
      numberCell(input.totalSubscriptions),
    ],
    [
      textCell("同次 FBA／Replenishment offer 核對範圍"),
      textCell(
        `已證明 FBA ${input.inventoryEvidence.provenSkuCount} 個；可核對 offer ${input.inventoryEvidence.verifiableReplenishmentOfferCount} 個；未取得可核對 offer ${input.inventoryEvidence.unverifiedFbaSkuCount} 個（未回傳或資料值無法安全解析）。Inventory 共回傳 ${input.inventoryEvidence.returnedInventoryRows} 列；Seller SKU 無法原樣辨識 ${input.inventoryEvidence.unrecognizedSellerSkuRows} 列。未取得可核對 offer 不代表不符合資格，也不代表 0 訂閱；無法原樣辨識的列也沒有被 trim、改名、判定資格或計為 0。`,
      ),
    ],
    [
      textCell("所選完整月份"),
      textCell(
        `${firstMonth} ～ ${lastMonth}（${input.metricMonths.length} 個完整月）`,
      ),
    ],
    [
      textCell("所選期間 S&S 營收"),
      input.revenueCoverage.status === "complete"
        ? numberCell(input.totalRevenue)
        : textCell(
            input.revenueCoverage.status === "partial"
              ? "資料涵蓋不完整；未將部分加總冒充完整總額"
              : "Amazon 未回傳可證明的所選期間營收",
          ),
      textCell(input.revenueCurrency ?? ""),
    ],
    [
      textCell("營收資料涵蓋"),
      textCell(coverageLabel(
        input.revenueCoverage,
        input.upstreamCoverage,
        input.inventoryEvidence,
      )),
    ],
    [
      textCell("Amazon 回應完整度"),
      textCell(
        input.upstreamCoverage.status === "complete"
          ? "完整；所有 Replenishment Seller SKU 均可原樣核對。"
          : `不完整；排除 ${input.upstreamCoverage.returnedOfferRows - input.upstreamCoverage.acceptedOfferRows + input.upstreamCoverage.returnedMetricRows - input.upstreamCoverage.acceptedMetricRows} 列，其中 ${input.upstreamCoverage.rejectedSellerSkuRows} 列缺少可原樣核對的 Seller SKU、${input.upstreamCoverage.problemSkuRows.length} 個具同次 CURRENT_FBA 證據的精確問題 SKU 已單獨隔離${input.upstreamCoverage.invalidOfferRows.length > 0 ? `（${input.upstreamCoverage.invalidOfferRows.length} 列有精確 SKU 但 offer 資料值無法安全解析）` : ""}；另有 ${input.upstreamCoverage.unprovenExactSkuProblems.exactSkuCount} 個精確上游問題 SKU 缺少同次 CURRENT_FBA 證據，只計數、不輸出 identifier。至少 ${input.upstreamCoverage.minimumUnresolvedOfferMonths} 個 SKU 月份無法核對。offer 與月度缺列可能不重疊，實際缺口無法精確計算。其他商品仍已完成，未補 0 或重複加總。${input.upstreamCoverage.notice}`,
      ),
    ],
  ];
  const dataRows = input.rows.flatMap((row): Cell[][] => {
    const metricByMonth = new Map(row.monthlySeries.map((point) => [point.month, point]));
    return input.metricMonths.map((month): Cell[] => {
      const point = metricByMonth.get(month) ?? null;
      return [
        textCell(row.sellerSku),
        textCell(row.asin),
        numberCell(row.currentPrice),
        textCell(row.currencyCode),
        numberCell(row.sellerFundedBaseDiscount),
        numberCell(row.sellerFundedTieredDiscount),
        numberCell(row.currentActiveSubscriptions),
        textCell(month),
        textCell(monthlyPointStatus(point)),
        numberCell(point?.subscriptionRevenue ?? null),
        textCell(point?.revenueCurrencyCode ?? ""),
        numberCell(point?.shippedSubscriptionUnits ?? null),
        numberCell(point?.activeSubscriptionsAtPeriodEnd ?? null),
        numberCell(row.forecastDeliveries?.next15Days ?? null),
        numberCell(row.forecastDeliveries?.next30Days ?? null),
        numberCell(row.forecastDeliveries?.next60Days ?? null),
        numberCell(row.forecastDeliveries?.next90Days ?? null),
        textCell(row.fbaEvidence),
      ];
    });
  });
  const headerRow = metaRows.length + 1;
  const dataStartRow = headerRow + 1;
  const finalRow = Math.max(headerRow, headerRow + dataRows.length);
  const summary = metaRows
    .map((row, index) => xmlRow(index + 1, row, index === 0 ? 2 : 0))
    .join("");
  const headers = xmlRow(headerRow, DISCOUNT_SHEET_HEADERS.map(textCell), 1);
  const data = dataRows.map((row, index) => xmlRow(index + dataStartRow, row, 0)).join("");
  const lastColumn = column(DISCOUNT_SHEET_HEADERS.length);
  return `${XML}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${finalRow}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A${dataStartRow}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${[24, 16, 15, 12, 17, 17, 17, 18, 30, 22, 16, 17, 20, 17, 17, 17, 17, 26].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
  <sheetData>${summary}${headers}${data}</sheetData>
  <autoFilter ref="A${headerRow}:${lastColumn}${finalRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}

function validateMetricMonths(input: readonly string[]): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 23) {
    throw new TypeError("metricMonths must contain 1 to 23 complete months.");
  }
  const months = input.map((month, index) => validMonth(month, `metricMonths[${index}]`));
  if (
    new Set(months).size !== months.length ||
    months.some((month, index) => index > 0 && month <= months[index - 1]!)
  ) {
    throw new TypeError("metricMonths must be unique and ordered oldest to newest.");
  }
  return months;
}

function validateInventoryEvidence(
  input: CreateSubscriptionAuditWorkbookInput["inventoryEvidence"],
  verifiableOfferCount: number,
): CreateSubscriptionAuditWorkbookInput["inventoryEvidence"] {
  if (!input || typeof input !== "object") {
    throw new TypeError("inventoryEvidence is invalid.");
  }
  const provenSkuCount = safeInteger(
    input.provenSkuCount,
    "inventoryEvidence.provenSkuCount",
  );
  const returnedInventoryRows = safeInteger(
    input.returnedInventoryRows,
    "inventoryEvidence.returnedInventoryRows",
  );
  const unrecognizedSellerSkuRows = safeInteger(
    input.unrecognizedSellerSkuRows,
    "inventoryEvidence.unrecognizedSellerSkuRows",
  );
  const verifiableReplenishmentOfferCount = safeInteger(
    input.verifiableReplenishmentOfferCount,
    "inventoryEvidence.verifiableReplenishmentOfferCount",
  );
  const unverifiedFbaSkuCount = safeInteger(
    input.unverifiedFbaSkuCount,
    "inventoryEvidence.unverifiedFbaSkuCount",
  );
  if (
    input.source !== "FBA_INVENTORY_API_COMPLETE_PAGINATION" ||
    (input.coverage !== "complete" && input.coverage !== "partial") ||
    returnedInventoryRows !== provenSkuCount + unrecognizedSellerSkuRows ||
    input.coverage !==
      (unrecognizedSellerSkuRows === 0 ? "complete" : "partial") ||
    verifiableReplenishmentOfferCount !== verifiableOfferCount ||
    provenSkuCount !==
      verifiableReplenishmentOfferCount + unverifiedFbaSkuCount
  ) {
    throw new TypeError(
      "inventoryEvidence does not match the exported FBA offer scope.",
    );
  }
  return {
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION",
    coverage: input.coverage,
    returnedInventoryRows,
    provenSkuCount,
    unrecognizedSellerSkuRows,
    verifiableReplenishmentOfferCount,
    unverifiedFbaSkuCount,
  };
}

function validateUpstreamCoverage(
  input: CreateSubscriptionAuditWorkbookInput["upstreamCoverage"],
  metricMonths: readonly string[],
): ValidatedSubscriptionAuditUpstreamCoverage {
  const metricMonthCount = metricMonths.length;
  const allowedMetricMonths = new Set(metricMonths);
  if (input === undefined) {
    return {
      status: "complete",
      returnedOfferRows: 0,
      acceptedOfferRows: 0,
      returnedMetricRows: 0,
      acceptedMetricRows: 0,
      invalidOfferRows: [],
      problemSkuRows: [],
      unprovenExactSkuProblems: {
        exactSkuCount: 0,
        affectedOfferRows: 0,
        affectedMetricRows: 0,
        minimumUnresolvedOfferMonths: 0,
      },
      rejectedSellerSkuRows: 0,
      minimumUnresolvedOfferMonths: 0,
      notice: "所有 Replenishment Seller SKU 均可原樣核對。",
    };
  }
  const returnedOfferRows = safeInteger(
    input.returnedOfferRows,
    "upstreamCoverage.returnedOfferRows",
  );
  const acceptedOfferRows = safeInteger(
    input.acceptedOfferRows,
    "upstreamCoverage.acceptedOfferRows",
  );
  const returnedMetricRows = safeInteger(
    input.returnedMetricRows,
    "upstreamCoverage.returnedMetricRows",
  );
  const acceptedMetricRows = safeInteger(
    input.acceptedMetricRows,
    "upstreamCoverage.acceptedMetricRows",
  );
  if (!Array.isArray(input.invalidOfferRows)) {
    throw new TypeError("upstreamCoverage.invalidOfferRows is invalid.");
  }
  const invalidOfferRows = input.invalidOfferRows.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new TypeError(`upstreamCoverage.invalidOfferRows[${index}] is invalid.`);
    }
    return {
      sellerSku: safeRequiredText(
        row.sellerSku,
        `upstreamCoverage.invalidOfferRows[${index}].sellerSku`,
      ),
      problem: safeRequiredText(
        row.problem,
        `upstreamCoverage.invalidOfferRows[${index}].problem`,
      ),
    };
  });
  if (new Set(invalidOfferRows.map(({ sellerSku }) => sellerSku)).size !== invalidOfferRows.length) {
    throw new TypeError("upstreamCoverage.invalidOfferRows contains duplicate SKUs.");
  }
  const legacyCoverage = input.problemSkuRows === undefined;
  const sourceProblemSkuRows = input.problemSkuRows ?? [];
  if (!Array.isArray(sourceProblemSkuRows)) {
    throw new TypeError("upstreamCoverage.problemSkuRows is invalid.");
  }
  const problemSkuRows = sourceProblemSkuRows.map((row, index) => {
    if (!row || typeof row !== "object" || !Array.isArray(row.metricMonths)) {
      throw new TypeError(`upstreamCoverage.problemSkuRows[${index}] is invalid.`);
    }
    const parsedMetricMonths = row.metricMonths.map(
      (month: unknown, monthIndex: number) => {
        const parsed = validMonth(
          month,
          `upstreamCoverage.problemSkuRows[${index}].metricMonths[${monthIndex}]`,
        );
        if (!allowedMetricMonths.has(parsed)) {
          throw new TypeError("upstreamCoverage.problemSkuRows contains a month outside the export.");
        }
        return parsed;
      },
    );
    const affectedOfferRows = safeInteger(
      row.affectedOfferRows,
      `upstreamCoverage.problemSkuRows[${index}].affectedOfferRows`,
    );
    const affectedMetricRows = safeInteger(
      row.affectedMetricRows,
      `upstreamCoverage.problemSkuRows[${index}].affectedMetricRows`,
    );
    if (
      affectedOfferRows + affectedMetricRows < 1 ||
      new Set(parsedMetricMonths).size !== parsedMetricMonths.length ||
      !parsedMetricMonths.every((month: string, monthIndex: number) =>
        month === [...parsedMetricMonths].sort()[monthIndex]) ||
      (affectedMetricRows === 0) !== (parsedMetricMonths.length === 0) ||
      affectedMetricRows < parsedMetricMonths.length
    ) {
      throw new TypeError("upstreamCoverage.problemSkuRows has contradictory scope.");
    }
    return {
      sellerSku: safeRequiredText(
        row.sellerSku,
        `upstreamCoverage.problemSkuRows[${index}].sellerSku`,
      ),
      fbaEvidence: row.fbaEvidence === "CURRENT_FBA_SKU_SET"
        ? "CURRENT_FBA_SKU_SET" as const
        : (() => { throw new TypeError("upstreamCoverage.problemSkuRows lacks current FBA evidence."); })(),
      affectedOfferRows,
      affectedMetricRows,
      metricMonths: parsedMetricMonths,
      problem: safeRequiredText(
        row.problem,
        `upstreamCoverage.problemSkuRows[${index}].problem`,
        2_000,
      ),
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
    throw new TypeError("upstreamCoverage.problemSkuRows is inconsistent.");
  }
  const sourceUnproven = legacyCoverage
    ? {
        exactSkuCount: invalidOfferRows.length,
        affectedOfferRows: invalidOfferRows.length,
        affectedMetricRows: 0,
        minimumUnresolvedOfferMonths: invalidOfferRows.length * metricMonthCount,
      }
    : input.unprovenExactSkuProblems;
  if (!sourceUnproven || typeof sourceUnproven !== "object") {
    throw new TypeError("upstreamCoverage.unprovenExactSkuProblems is invalid.");
  }
  const unprovenExactSkuProblems = {
    exactSkuCount: safeInteger(
      sourceUnproven.exactSkuCount,
      "upstreamCoverage.unprovenExactSkuProblems.exactSkuCount",
    ),
    affectedOfferRows: safeInteger(
      sourceUnproven.affectedOfferRows,
      "upstreamCoverage.unprovenExactSkuProblems.affectedOfferRows",
    ),
    affectedMetricRows: safeInteger(
      sourceUnproven.affectedMetricRows,
      "upstreamCoverage.unprovenExactSkuProblems.affectedMetricRows",
    ),
    minimumUnresolvedOfferMonths: safeInteger(
      sourceUnproven.minimumUnresolvedOfferMonths,
      "upstreamCoverage.unprovenExactSkuProblems.minimumUnresolvedOfferMonths",
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
    throw new TypeError("upstreamCoverage.unprovenExactSkuProblems is contradictory.");
  }
  const rejectedSellerSkuRows = safeInteger(
    input.rejectedSellerSkuRows,
    "upstreamCoverage.rejectedSellerSkuRows",
  );
  const minimumUnresolvedOfferMonths = safeInteger(
    input.minimumUnresolvedOfferMonths,
    "upstreamCoverage.minimumUnresolvedOfferMonths",
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
  const knownProblemOfferMonths = problemSkuRows.reduce(
    (sum, row) => sum + (row.affectedOfferRows > 0
      ? metricMonthCount
      : row.metricMonths.length),
    0,
  ) + unprovenExactSkuProblems.minimumUnresolvedOfferMonths;
  if (
    rejectedOfferRows < 0 ||
    rejectedMetricRows < 0 ||
    missingSellerSkuOfferRows < 0 ||
    missingSellerSkuMetricRows < 0 ||
    rejectedSellerSkuRows !==
      missingSellerSkuOfferRows + missingSellerSkuMetricRows ||
    minimumUnresolvedOfferMonths !==
      Math.max(
        knownProblemOfferMonths,
        missingSellerSkuOfferRows * metricMonthCount,
        missingSellerSkuMetricRows,
      ) ||
    input.status !==
      (rejectedOfferRows === 0 && rejectedMetricRows === 0 ? "complete" : "partial")
  ) {
    throw new TypeError("upstreamCoverage does not match the source row counts.");
  }
  return {
    status: input.status,
    returnedOfferRows,
    acceptedOfferRows,
    returnedMetricRows,
    acceptedMetricRows,
    invalidOfferRows: legacyCoverage ? [] : invalidOfferRows,
    problemSkuRows,
    unprovenExactSkuProblems,
    rejectedSellerSkuRows,
    minimumUnresolvedOfferMonths,
    notice: safeRequiredText(input.notice, "upstreamCoverage.notice"),
  };
}

function validateCoverage(
  input: SubscriptionAuditRevenueCoverage,
  rows: readonly SubscriptionAuditProblemWorkbookRow[],
  metricMonths: readonly string[],
  sourceIncomplete = false,
): SubscriptionAuditRevenueCoverage {
  if (!input || typeof input !== "object") {
    throw new TypeError("revenueCoverage is invalid.");
  }
  const expected = safeInteger(input.expectedOfferMonths, "revenueCoverage.expectedOfferMonths");
  const reported = safeInteger(input.reportedOfferMonths, "revenueCoverage.reportedOfferMonths");
  const expectedFromRows = rows.length * metricMonths.length;
  const allowedMonths = new Set(metricMonths);
  let reportedFromRows = 0;
  for (const [index, row] of rows.entries()) {
    for (const point of row.monthlySeries) {
      if (!allowedMonths.has(point.month)) {
        throw new TypeError(
          `problems[${index}] contains a month outside the selected period: ${point.month}`,
        );
      }
      if (point.subscriptionRevenue !== null) reportedFromRows += 1;
    }
  }
  if (expected !== expectedFromRows || reported !== reportedFromRows) {
    throw new TypeError("revenueCoverage does not match the exported offer-month series.");
  }
  const expectedStatus = !sourceIncomplete && expected === reported
    ? "complete"
    : reported === 0
      ? "unavailable"
      : "partial";
  if (input.status !== expectedStatus) {
    throw new TypeError("revenueCoverage status does not match its counts.");
  }
  return { status: input.status, expectedOfferMonths: expected, reportedOfferMonths: reported };
}

function coverageLabel(
  coverage: SubscriptionAuditRevenueCoverage,
  upstreamCoverage: ValidatedSubscriptionAuditUpstreamCoverage,
  inventoryEvidence: CreateSubscriptionAuditWorkbookInput["inventoryEvidence"],
): string {
  const count = `${coverage.reportedOfferMonths} / ${coverage.expectedOfferMonths} 個 SKU 月份`;
  const gaps: string[] = [];
  if (inventoryEvidence.unrecognizedSellerSkuRows > 0) {
    gaps.push(`另有 ${inventoryEvidence.unrecognizedSellerSkuRows} 列 FBA Inventory Seller SKU 無法原樣辨識，不能 trim、改名、判定資格或計為 0`);
  }
  if (inventoryEvidence.unverifiedFbaSkuCount > 0) {
    gaps.push(`另有 ${inventoryEvidence.unverifiedFbaSkuCount} 個已證明 FBA SKU 未取得可核對 offer（未回傳或資料值無法安全解析），不能據此判定資格或 0 訂閱`);
  }
  if (upstreamCoverage.status === "partial") {
    gaps.push(`另至少 ${upstreamCoverage.minimumUnresolvedOfferMonths} 個 SKU 月份無法核對，實際缺口未知`);
    if (upstreamCoverage.problemSkuRows.length > 0) {
      gaps.push(`其中 ${upstreamCoverage.problemSkuRows.length} 個具同次 CURRENT_FBA 證據的精確問題 SKU 已單獨隔離，其他商品仍已完成，未補 0 或重複加總`);
    }
    if (upstreamCoverage.unprovenExactSkuProblems.exactSkuCount > 0) {
      gaps.push(`另有 ${upstreamCoverage.unprovenExactSkuProblems.exactSkuCount} 個精確上游問題 SKU 缺少同次 CURRENT_FBA 證據，只計數、不輸出 identifier`);
    }
  }
  if (gaps.length > 0) {
    return `已核對資料（${count}）；${gaps.join("；")}；未輸出全站總額`;
  }
  if (coverage.status === "complete") return `完整（${count}）`;
  if (coverage.status === "partial") {
    return `不完整（${count}）；空白維持缺值，未補 0`;
  }
  return `無可證明營收（${count}）；空白維持缺值，未補 0`;
}

function monthlyPointStatus(
  point: SubscriptionAuditWorkbookMonthlyPoint | null,
): string {
  if (!point) return "Amazon 未回傳此 SKU 月度列";
  if (point.subscriptionRevenue === null) return "該月已回傳，營收未回傳";
  return "該月營收已回傳";
}

function numbersEqual(left: number, right: number): boolean {
  const leftCents = Math.round(left * 100);
  const rightCents = Math.round(right * 100);
  return (
    Number.isSafeInteger(leftCents) &&
    Number.isSafeInteger(rightCents) &&
    leftCents === rightCents
  );
}

function xmlRow(rowNumber: number, cells: readonly Cell[], style: number): string {
  return `<row r="${rowNumber}">${cells.map((cell, index) => cellXml(`${column(index + 1)}${rowNumber}`, cell, style)).join("")}</row>`;
}

function cellXml(reference: string, cell: Cell, style: number): string {
  if (cell.kind === "number" && cell.value !== null) {
    return `<c r="${reference}" s="${style}"><v>${cell.value}</v></c>`;
  }
  const value = cell.value === null ? "" : String(cell.value);
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(spreadsheetText(value))}</t></is></c>`;
}

function textCell(value: string): Cell {
  return { kind: "text", value };
}

function numberCell(value: number | null): Cell {
  return { kind: "number", value };
}

function spreadsheetText(value: string): string {
  let safe = Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0;
      return (
        point === 9 ||
        point === 10 ||
        point === 13 ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)
      );
    })
    .slice(0, MAX_CELL_CHARACTERS)
    .join("");
  if (/^[=+\-@]/u.test(safe)) safe = `'${safe}`;
  return safe;
}

function safeRequiredText(value: unknown, field: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum
  ) {
    throw new TypeError(`${field} is invalid.`);
  }
  spreadsheetText(value);
  return value;
}

function validCurrency(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/u.test(value)) {
    throw new TypeError(`${field} must be an ISO currency code.`);
  }
  return value;
}

function validMonth(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(value)) {
    throw new TypeError(`${field} must be YYYY-MM.`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) {
    throw new TypeError(`${field} must be a safe non-negative number.`);
  }
  return value;
}

function optionalNumber(value: number | null, field: string): number | null {
  return value === null ? null : nonNegativeNumber(value, field);
}

function safeInteger(value: unknown, field: string): number {
  const parsed = nonNegativeNumber(value, field);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${field} must be an integer.`);
  return parsed;
}

function optionalInteger(value: number | null, field: string): number | null {
  return value === null ? null : safeInteger(value, field);
}

function optionalPercentage(value: number | null, field: string): number | null {
  if (value === null) return null;
  const parsed = safeInteger(value, field);
  if (parsed > 100) throw new TypeError(`${field} must not exceed 100.`);
  return parsed;
}

function validDate(value: string | Date): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("generatedAt is invalid.");
  return parsed;
}

function column(index: number): string {
  let result = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function workbookXml(names: readonly string[]): string {
  return `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`;
}

function workbookRelationships(count: number): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function packageRelationships(): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function contentTypes(count: number): string {
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${Array.from({ length: count }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
}

function coreProperties(label: string, generatedAt: Date): string {
  const timestamp = generatedAt.toISOString();
  return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(`Amazon FBA Subscribe & Save 問題健檢 - ${label}`)}</dc:title><dc:creator>AMZ.API</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`;
}

function appProperties(names: readonly string[]): string {
  return `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AMZ.API</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${names.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map((name) => `<vt:lpstr>${name}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts></Properties>`;
}

function styles(): string {
  return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
