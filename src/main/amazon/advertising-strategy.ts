export type AdvertisingStrategyTier = "T1" | "T2" | "T3" | "T4";

export type AdvertisingStrategyFbaListing = {
  sellerSku: string;
  asin: string;
  title: string;
  price?: null;
};

export type AdvertisingStrategySalesRow = {
  sellerSku: string;
  childAsin: string;
  unitsSold: number;
  salesAmount: number;
  currencyCode: string;
};

export type AdvertisingStrategyAdsRow = {
  sellerSku: string | null;
  asin: string | null;
  spend: number;
  sales14d: number | null;
  purchases14d: number | null;
  currencyCode: string;
};

export type AdvertisingStrategyRow = {
  sellerSku: string;
  asin: string;
  title: string;
  price: null;
  salesStatus: "reported" | "not-reported";
  unitsSold: number | null;
  salesAmount: number | null;
  salesRank: number | null;
  salesTier: AdvertisingStrategyTier | null;
  suggestedSpDailyBudget: number | null;
  suggestedSpTargetAcos: number | null;
  suggestion: "overrideable-default" | null;
  spStatus: "reported" | "not-reported";
  spSpend: number | null;
  spSales14d: number | null;
  spActualAcos: number | null;
  spActualAcosStatus: "reported" | "no-sales" | "not-reported" | null;
  spPurchases14d: number | null;
  spSpendRank: number | null;
  spAttribution: "seller-sku" | "unique-asin" | "mixed" | null;
  specification: null;
  sbSales: null;
  sbSalesAcos: null;
  sbAttack: null;
  sbAttackAcos: null;
  sdAttack: null;
  sdAttackAcos: null;
  sdDefense: null;
  sdDefenseAcos: null;
  sdRemarketing: null;
  sdRemarketingAcos: null;
  otherAdvertising: null;
};

export type AdvertisingStrategyUnresolvedCode =
  | "sales-sku-asin-mismatch"
  | "sales-duplicate-sku"
  | "sp-invalid-asin"
  | "sp-sku-asin-mismatch";

type AdvertisingStrategySuppressedCode =
  | "sales-missing-sku"
  | "sales-unknown-sku"
  | "sp-invalid-seller-sku"
  | "sp-unknown-sku"
  | "sp-missing-attribution"
  | "sp-unknown-asin"
  | "sp-ambiguous-asin";

type AdvertisingStrategySourceIssueCode =
  | AdvertisingStrategyUnresolvedCode
  | AdvertisingStrategySuppressedCode;

export type AdvertisingStrategyUnresolvedRow = {
  source: "sales" | "sp-advertised-product";
  sourceRow: number;
  fbaEvidence: "exact-seller-sku";
  sellerSku: string;
  asin: string | null;
  code: AdvertisingStrategyUnresolvedCode;
  message: string;
  unitsSold: number | null;
  amount: number;
  spSales14d: number | null;
  spPurchases14d: number | null;
};

export const ADVERTISING_STRATEGY_PRESETS = {
  T1: { dailyBudget: 300, targetAcos: 0.35 },
  T2: { dailyBudget: 100, targetAcos: 0.30 },
  T3: { dailyBudget: 50, targetAcos: 0.30 },
  T4: { dailyBudget: 50, targetAcos: 0.50 },
} as const;

export const ADVERTISING_STRATEGY_RULE = {
  salesTierMethod: "reported-sales-desc-sku-asc-ceil-20-50-80",
  adsAttributionMethod: "exact-sku-or-unique-current-fba-asin",
  missingReportMethod: "null-not-reported-never-zero",
  unprovenSourceMethod: "anonymous-count-only-no-identifiers-or-metrics",
  suggestionIsOverrideable: true,
  presets: ADVERTISING_STRATEGY_PRESETS,
  manualFields: [
    "specification",
    "sbSales",
    "sbSalesAcos",
    "sbAttack",
    "sbAttackAcos",
    "sdAttack",
    "sdAttackAcos",
    "sdDefense",
    "sdDefenseAcos",
    "sdRemarketing",
    "sdRemarketingAcos",
    "otherAdvertising",
  ],
} as const;

export type AdvertisingStrategySnapshot = {
  schemaVersion: 1;
  marketplaceId: string;
  marketplaceCode: string;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  currencyCode: string;
  fetchedAt: string;
  sourceFetchedAt: {
    fba: string;
    sales: string;
    ads: string;
  };
  rows: AdvertisingStrategyRow[];
  unresolved: AdvertisingStrategyUnresolvedRow[];
  coverage: {
    currentFbaSkuCount: number;
    salesSourceRowCount: number;
    salesResolvedSourceRowCount: number;
    salesUnresolvedSourceRowCount: number;
    salesAnonymousUnprovenSourceRowCount: number;
    salesReportedSkuCount: number;
    salesNotReportedSkuCount: number;
    spSourceRowCount: number;
    spResolvedSourceRowCount: number;
    spUnresolvedSourceRowCount: number;
    spAnonymousUnprovenSourceRowCount: number;
    spReportedSkuCount: number;
    spNotReportedSkuCount: number;
    spDirectSourceRowCount: number;
    spUniqueAsinSourceRowCount: number;
  };
  summary: {
    tierCounts: Record<AdvertisingStrategyTier, number>;
    reportedUnitsSold: number;
    unresolvedUnitsSold: number;
    sourceUnitsSold: number;
    reportedSalesAmount: number;
    unresolvedSalesAmount: number;
    sourceSalesAmount: number;
    reportedSpSpend: number;
    unresolvedSpSpend: number;
    sourceSpSpend: number;
    suggestedSpDailyBudget: number;
  };
  rule: typeof ADVERTISING_STRATEGY_RULE;
  notice: string;
};

const MAX_METRIC = 1_000_000_000_000;
const MAX_CURRENT_FBA_ROWS = 100_000;
const MAX_SALES_SOURCE_ROWS = 100_000;
const MAX_SP_SOURCE_ROWS = 50_000;
const ZERO_WIDTH_OR_BIDI = /[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

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

function validMetric(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_METRIC
  );
}

function validDate(value: string): boolean {
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

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function tierForRank(rank: number, count: number): AdvertisingStrategyTier {
  if (rank <= Math.ceil(count * 0.2)) return "T1";
  if (rank <= Math.ceil(count * 0.5)) return "T2";
  if (rank <= Math.ceil(count * 0.8)) return "T3";
  return "T4";
}

function assertInputMetadata(input: {
  marketplaceId: string;
  marketplaceCode: string;
  dateRange: { startDate: string; endDate: string };
  currencyCode: string;
  fetchedAt?: string;
  sourceFetchedAt: { fba: string; sales: string; ads: string };
}): string {
  if (!/^[A-Z0-9]{10,20}$/u.test(input.marketplaceId)) {
    throw new Error("廣告策略站點 ID 無效。");
  }
  if (!/^[A-Z]{2,3}$/u.test(input.marketplaceCode)) {
    throw new Error("廣告策略站點代碼無效。");
  }
  if (
    !validDate(input.dateRange.startDate) ||
    !validDate(input.dateRange.endDate) ||
    input.dateRange.startDate > input.dateRange.endDate
  ) {
    throw new Error("廣告策略日期範圍無效。");
  }
  if (!/^[A-Z]{3}$/u.test(input.currencyCode)) {
    throw new Error("廣告策略幣別無效。");
  }
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  if (!validIsoInstant(fetchedAt)) {
    throw new Error("廣告策略快照時間無效。");
  }
  return fetchedAt;
}

function assertListings(
  listings: readonly AdvertisingStrategyFbaListing[],
): void {
  const seen = new Set<string>();
  for (const listing of listings) {
    if (
      !validSellerSku(listing.sellerSku) ||
      !validAsin(listing.asin) ||
      typeof listing.title !== "string" ||
      listing.title.length > 32_767 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(listing.title) ||
      ZERO_WIDTH_OR_BIDI.test(listing.title) ||
      seen.has(listing.sellerSku) ||
      !(listing.price === undefined || listing.price === null)
    ) {
      throw new Error("目前 FBA 商品清單無法安全用於廣告策略。");
    }
    seen.add(listing.sellerSku);
  }
}

function unresolvedMessage(code: AdvertisingStrategySourceIssueCode): string {
  switch (code) {
    case "sales-missing-sku":
      return "銷售報表列缺少有效 Seller SKU，未歸屬。";
    case "sales-unknown-sku":
      return "銷售報表 Seller SKU 不在目前 FBA 清單，未歸屬。";
    case "sales-sku-asin-mismatch":
      return "銷售報表的 Seller SKU 與 child ASIN 不屬於同一目前 FBA 商品，未分攤也未歸屬。";
    case "sales-duplicate-sku":
      return "SKU 粒度銷售報表重複回傳同一 Seller SKU，全部重複列均未歸屬。";
    case "sp-invalid-seller-sku":
      return "SP advertised-product 列含無效 Seller SKU，未使用 ASIN 取代。";
    case "sp-invalid-asin":
      return "SP advertised-product 列含無效 ASIN，未歸屬。";
    case "sp-unknown-sku":
      return "SP advertised-product Seller SKU 不在目前 FBA 清單，未使用 ASIN 取代。";
    case "sp-sku-asin-mismatch":
      return "SP advertised-product 的 Seller SKU 與 ASIN 不屬於同一目前 FBA 商品，未歸屬。";
    case "sp-missing-attribution":
      return "SP advertised-product 列沒有 Seller SKU 或 ASIN，未歸屬。";
    case "sp-unknown-asin":
      return "SP advertised-product ASIN 在目前 FBA 清單找不到對應 SKU，未歸屬。";
    case "sp-ambiguous-asin":
      return "SP advertised-product ASIN 對應多個目前 FBA SKU，未分攤也未歸屬。";
  }
}

export function buildAdvertisingStrategySnapshot(input: {
  marketplaceId: string;
  marketplaceCode: string;
  dateRange: { startDate: string; endDate: string };
  currencyCode: string;
  fetchedAt?: string;
  sourceFetchedAt: { fba: string; sales: string; ads: string };
  listings: readonly AdvertisingStrategyFbaListing[];
  salesRows: readonly AdvertisingStrategySalesRow[];
  spAdvertisedProductRows: readonly AdvertisingStrategyAdsRow[];
}): AdvertisingStrategySnapshot {
  const fetchedAt = assertInputMetadata(input);
  if (
    !validIsoInstant(input.sourceFetchedAt.fba) ||
    !validIsoInstant(input.sourceFetchedAt.sales) ||
    !validIsoInstant(input.sourceFetchedAt.ads)
  ) {
    throw new Error("廣告策略來源快照時間無效。");
  }
  if (
    input.listings.length > MAX_CURRENT_FBA_ROWS ||
    input.salesRows.length > MAX_SALES_SOURCE_ROWS ||
    input.spAdvertisedProductRows.length > MAX_SP_SOURCE_ROWS
  ) {
    throw new Error("廣告策略來源資料超過安全筆數限制。");
  }
  assertListings(input.listings);
  const listingBySku = new Map(
    input.listings.map((listing) => [listing.sellerSku, listing] as const),
  );
  const listingsByAsin = new Map<string, AdvertisingStrategyFbaListing[]>();
  for (const listing of input.listings) {
    const matches = listingsByAsin.get(listing.asin) ?? [];
    matches.push(listing);
    listingsByAsin.set(listing.asin, matches);
  }

  for (const row of input.salesRows) {
    if (
      !Number.isSafeInteger(row.unitsSold) ||
      !validMetric(row.unitsSold) ||
      !validMetric(row.salesAmount) ||
      row.currencyCode !== input.currencyCode
    ) {
      throw new Error("銷售報表含無效數值或不同幣別，已停止產生廣告策略。");
    }
  }
  for (const row of input.spAdvertisedProductRows) {
    if (
      !validMetric(row.spend) ||
      !(row.sales14d === null || validMetric(row.sales14d)) ||
      !(
        row.purchases14d === null ||
        (Number.isSafeInteger(row.purchases14d) && validMetric(row.purchases14d))
      ) ||
      row.currencyCode !== input.currencyCode
    ) {
      throw new Error("SP advertised-product 報表含無效花費或不同幣別，已停止產生廣告策略。");
    }
  }

  const unresolved: AdvertisingStrategyUnresolvedRow[] = [];
  const salesBySku = new Map<
    string,
    { unitsSold: number; salesAmount: number }
  >();
  const validSalesSkuCounts = new Map<string, number>();
  for (const row of input.salesRows) {
    const listing = validSellerSku(row.sellerSku)
      ? listingBySku.get(row.sellerSku)
      : undefined;
    if (listing && validAsin(row.childAsin) && listing.asin === row.childAsin) {
      validSalesSkuCounts.set(
        row.sellerSku,
        (validSalesSkuCounts.get(row.sellerSku) ?? 0) + 1,
      );
    }
  }
  let salesResolvedSourceRowCount = 0;
  let salesAnonymousUnprovenSourceRowCount = 0;
  input.salesRows.forEach((row, index) => {
    let code: AdvertisingStrategyUnresolvedCode | null = null;
    if (!validSellerSku(row.sellerSku)) {
      salesAnonymousUnprovenSourceRowCount += 1;
      return;
    } else if (!listingBySku.has(row.sellerSku)) {
      salesAnonymousUnprovenSourceRowCount += 1;
      return;
    } else if (
      !validAsin(row.childAsin) ||
      listingBySku.get(row.sellerSku)?.asin !== row.childAsin
    ) {
      code = "sales-sku-asin-mismatch";
    } else if ((validSalesSkuCounts.get(row.sellerSku) ?? 0) > 1) {
      code = "sales-duplicate-sku";
    }
    if (code) {
      unresolved.push({
        source: "sales",
        sourceRow: index + 1,
        fbaEvidence: "exact-seller-sku",
        sellerSku: row.sellerSku,
        asin: validAsin(row.childAsin) ? row.childAsin : null,
        code,
        message: unresolvedMessage(code),
        unitsSold: row.unitsSold,
        amount: row.salesAmount,
        spSales14d: null,
        spPurchases14d: null,
      });
      return;
    }
    salesBySku.set(row.sellerSku, {
      unitsSold: row.unitsSold,
      salesAmount: row.salesAmount,
    });
    salesResolvedSourceRowCount += 1;
  });

  const spBySku = new Map<
    string,
    {
      spend: number;
      sourceRows: number;
      directRows: number;
      uniqueAsinRows: number;
      sales14d: number;
      sales14dRows: number;
      purchases14d: number;
      purchases14dRows: number;
    }
  >();
  let spResolvedSourceRowCount = 0;
  let spDirectSourceRowCount = 0;
  let spUniqueAsinSourceRowCount = 0;
  let spAnonymousUnprovenSourceRowCount = 0;
  input.spAdvertisedProductRows.forEach((row, index) => {
    const hasSku = row.sellerSku !== null && row.sellerSku !== "";
    const hasAsin = row.asin !== null && row.asin !== "";
    let resolvedSku: string | null = null;
    let attribution: "seller-sku" | "unique-asin" | null = null;
    let code: AdvertisingStrategySourceIssueCode | null = null;

    if (hasSku) {
      if (!validSellerSku(row.sellerSku)) {
        code = "sp-invalid-seller-sku";
      } else {
        const listing = listingBySku.get(row.sellerSku);
        if (!listing) {
          code = "sp-unknown-sku";
        } else if (hasAsin && !validAsin(row.asin)) {
          code = "sp-invalid-asin";
        } else if (hasAsin && listing.asin !== row.asin) {
          code = "sp-sku-asin-mismatch";
        } else {
          resolvedSku = listing.sellerSku;
          attribution = "seller-sku";
        }
      }
    } else if (!hasAsin) {
      code = "sp-missing-attribution";
    } else if (!validAsin(row.asin)) {
      code = "sp-invalid-asin";
    } else {
      const matches = listingsByAsin.get(row.asin) ?? [];
      if (matches.length === 0) {
        code = "sp-unknown-asin";
      } else if (matches.length > 1) {
        code = "sp-ambiguous-asin";
      } else {
        resolvedSku = matches[0].sellerSku;
        attribution = "unique-asin";
      }
    }

    if (!resolvedSku || !attribution || code) {
      const unresolvedCode = code ?? "sp-missing-attribution";
      const exactCurrentFbaSellerSku =
        validSellerSku(row.sellerSku) && listingBySku.has(row.sellerSku)
          ? row.sellerSku
          : null;
      const visibleCode =
        unresolvedCode === "sp-invalid-asin" ||
        unresolvedCode === "sp-sku-asin-mismatch"
          ? unresolvedCode
          : null;
      if (exactCurrentFbaSellerSku && visibleCode) {
        unresolved.push({
          source: "sp-advertised-product",
          sourceRow: index + 1,
          fbaEvidence: "exact-seller-sku",
          sellerSku: exactCurrentFbaSellerSku,
          asin: validAsin(row.asin) ? row.asin : null,
          code: visibleCode,
          message: unresolvedMessage(visibleCode),
          unitsSold: null,
          amount: row.spend,
          spSales14d: row.sales14d,
          spPurchases14d: row.purchases14d,
        });
      } else {
        spAnonymousUnprovenSourceRowCount += 1;
      }
      return;
    }

    const aggregate = spBySku.get(resolvedSku) ?? {
      spend: 0,
      sourceRows: 0,
      directRows: 0,
      uniqueAsinRows: 0,
      sales14d: 0,
      sales14dRows: 0,
      purchases14d: 0,
      purchases14dRows: 0,
    };
    aggregate.spend += row.spend;
    aggregate.sourceRows += 1;
    if (row.sales14d !== null) {
      aggregate.sales14d += row.sales14d;
      aggregate.sales14dRows += 1;
    }
    if (row.purchases14d !== null) {
      aggregate.purchases14d += row.purchases14d;
      aggregate.purchases14dRows += 1;
    }
    if (attribution === "seller-sku") {
      aggregate.directRows += 1;
      spDirectSourceRowCount += 1;
    } else {
      aggregate.uniqueAsinRows += 1;
      spUniqueAsinSourceRowCount += 1;
    }
    spBySku.set(resolvedSku, aggregate);
    spResolvedSourceRowCount += 1;
  });

  const reportedSales = [...salesBySku.entries()]
    .sort((left, right) =>
      right[1].salesAmount - left[1].salesAmount || compareText(left[0], right[0]),
    );
  const salesRankBySku = new Map(
    reportedSales.map(([sellerSku], index) => [sellerSku, index + 1] as const),
  );
  const spRankBySku = new Map(
    [...spBySku.entries()]
      .sort((left, right) =>
        right[1].spend - left[1].spend || compareText(left[0], right[0]),
      )
      .map(([sellerSku], index) => [sellerSku, index + 1] as const),
  );

  const rows: AdvertisingStrategyRow[] = [...input.listings]
    .sort((left, right) => {
      const leftRank = salesRankBySku.get(left.sellerSku);
      const rightRank = salesRankBySku.get(right.sellerSku);
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return compareText(left.sellerSku, right.sellerSku);
    })
    .map((listing) => {
      const sales = salesBySku.get(listing.sellerSku) ?? null;
      const salesRank = salesRankBySku.get(listing.sellerSku) ?? null;
      const salesTier = salesRank === null
        ? null
        : tierForRank(salesRank, reportedSales.length);
      const preset = salesTier === null ? null : ADVERTISING_STRATEGY_PRESETS[salesTier];
      const sp = spBySku.get(listing.sellerSku) ?? null;
      const spAttribution = !sp
        ? null
        : sp.directRows > 0 && sp.uniqueAsinRows > 0
          ? "mixed" as const
          : sp.directRows > 0
            ? "seller-sku" as const
            : "unique-asin" as const;
      const spSales14d = sp && sp.sales14dRows === sp.sourceRows
        ? sp.sales14d
        : null;
      const spPurchases14d = sp && sp.purchases14dRows === sp.sourceRows
        ? sp.purchases14d
        : null;
      const spActualAcosStatus = !sp
        ? null
        : spSales14d === null
          ? "not-reported" as const
          : spSales14d === 0
            ? "no-sales" as const
            : "reported" as const;
      const spActualAcos = spActualAcosStatus === "reported"
        ? sp!.spend / spSales14d!
        : null;
      if (spActualAcos !== null && !validMetric(spActualAcos)) {
        throw new Error("SP 實際 ACoS 超出可安全表示範圍，已停止產生廣告策略。");
      }
      return {
        sellerSku: listing.sellerSku,
        asin: listing.asin,
        title: listing.title,
        price: null,
        salesStatus: sales ? "reported" : "not-reported",
        unitsSold: sales?.unitsSold ?? null,
        salesAmount: sales?.salesAmount ?? null,
        salesRank,
        salesTier,
        suggestedSpDailyBudget: preset?.dailyBudget ?? null,
        suggestedSpTargetAcos: preset?.targetAcos ?? null,
        suggestion: preset ? "overrideable-default" : null,
        spStatus: sp ? "reported" : "not-reported",
        spSpend: sp?.spend ?? null,
        spSales14d,
        spActualAcos,
        spActualAcosStatus,
        spPurchases14d,
        spSpendRank: spRankBySku.get(listing.sellerSku) ?? null,
        spAttribution,
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
      };
    });

  const salesUnresolved = unresolved.filter((row) => row.source === "sales");
  const spUnresolved = unresolved.filter(
    (row) => row.source === "sp-advertised-product",
  );
  const tierCounts = rows.reduce(
    (counts, row) => {
      if (row.salesTier) counts[row.salesTier] += 1;
      return counts;
    },
    { T1: 0, T2: 0, T3: 0, T4: 0 },
  );
  const reportedUnitsSold = sum(rows.flatMap((row) => row.unitsSold === null ? [] : [row.unitsSold]));
  const unresolvedUnitsSold = sum(salesUnresolved.map((row) => row.unitsSold ?? 0));
  const reportedSalesAmount = sum(rows.flatMap((row) => row.salesAmount === null ? [] : [row.salesAmount]));
  const unresolvedSalesAmount = sum(salesUnresolved.map((row) => row.amount));
  const reportedSpSpend = sum(rows.flatMap((row) => row.spSpend === null ? [] : [row.spSpend]));
  const unresolvedSpSpend = sum(spUnresolved.map((row) => row.amount));

  return {
    schemaVersion: 1,
    marketplaceId: input.marketplaceId,
    marketplaceCode: input.marketplaceCode,
    dateRange: { ...input.dateRange },
    currencyCode: input.currencyCode,
    fetchedAt,
    sourceFetchedAt: { ...input.sourceFetchedAt },
    rows,
    unresolved,
    coverage: {
      currentFbaSkuCount: rows.length,
      salesSourceRowCount: input.salesRows.length,
      salesResolvedSourceRowCount,
      salesUnresolvedSourceRowCount:
        salesUnresolved.length + salesAnonymousUnprovenSourceRowCount,
      salesAnonymousUnprovenSourceRowCount,
      salesReportedSkuCount: salesBySku.size,
      salesNotReportedSkuCount: rows.length - salesBySku.size,
      spSourceRowCount: input.spAdvertisedProductRows.length,
      spResolvedSourceRowCount,
      spUnresolvedSourceRowCount:
        spUnresolved.length + spAnonymousUnprovenSourceRowCount,
      spAnonymousUnprovenSourceRowCount,
      spReportedSkuCount: spBySku.size,
      spNotReportedSkuCount: rows.length - spBySku.size,
      spDirectSourceRowCount,
      spUniqueAsinSourceRowCount,
    },
    summary: {
      tierCounts,
      reportedUnitsSold,
      unresolvedUnitsSold,
      sourceUnitsSold: reportedUnitsSold + unresolvedUnitsSold,
      reportedSalesAmount,
      unresolvedSalesAmount,
      sourceSalesAmount: reportedSalesAmount + unresolvedSalesAmount,
      reportedSpSpend,
      unresolvedSpSpend,
      sourceSpSpend: reportedSpSpend + unresolvedSpSpend,
      suggestedSpDailyBudget: sum(rows.flatMap((row) =>
        row.suggestedSpDailyBudget === null ? [] : [row.suggestedSpDailyBudget],
      )),
    },
    rule: ADVERTISING_STRATEGY_RULE,
    notice: "只使用目前 FBA 清單與指定日期範圍的 SKU 粒度報表；未證明為目前 FBA 的來源列只保留匿名筆數，不輸出識別碼或營業數據。建議 SP 預算與 ACoS 可人工覆寫，SB／SD／規格維持人工欄位。",
  };
}
