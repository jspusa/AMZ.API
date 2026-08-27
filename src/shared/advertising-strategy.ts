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

export const ADVERTISING_STRATEGY_UNRESOLVED_MESSAGES: Record<
  AdvertisingStrategyUnresolvedCode,
  string
> = {
  "sales-sku-asin-mismatch": "銷售報表的 Seller SKU 與 child ASIN 不屬於同一目前 FBA 商品，未分攤也未歸屬。",
  "sales-duplicate-sku": "SKU 粒度銷售報表重複回傳同一 Seller SKU，全部重複列均未歸屬。",
  "sp-invalid-asin": "SP advertised-product 列含無效 ASIN，未歸屬。",
  "sp-sku-asin-mismatch": "SP advertised-product 的 Seller SKU 與 ASIN 不屬於同一目前 FBA 商品，未歸屬。",
};

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
