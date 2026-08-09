export type BrandSalesKey =
  | "afreschi"
  | "gootoe"
  | "herz"
  | "vitaday"
  | "healthy-moment"
  | "unclassified";

export type BrandSalesSegment = {
  key: BrandSalesKey;
  label: string;
  color: string;
  amount: number;
  percentage: number;
  skuCount: number;
  unitCount: number;
};

export type CategorySalesKey =
  | "turkey-tendon"
  | "turkey"
  | "chicken"
  | "salmon"
  | "buffalo"
  | "fish"
  | "air-dried"
  | "other";

export type CategorySalesSegment = Omit<BrandSalesSegment, "key"> & {
  key: CategorySalesKey;
};

export type RevenueShareSegment = BrandSalesSegment | CategorySalesSegment;

export type BrandSalesSnapshot = {
  schemaVersion: 2;
  mode: "live" | "demo";
  marketplaceId: string;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  dataThrough: string;
  rangeFreshness: "complete-days" | "includes-current-day";
  currencyCode: string;
  segments: BrandSalesSegment[];
  categorySegments: CategorySalesSegment[];
  summary: {
    amount: number;
    unitCount: number;
    classifiedAmount: number;
    unclassifiedAmount: number;
    currentFbaSkuCount: number;
    soldFbaSkuCount: number;
    soldCurrentFbaSkuCount: number;
    unmatchedCurrentFbaRowCount: number;
  };
  source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT";
  notice: string;
};

const DEFINITIONS: ReadonlyArray<Pick<BrandSalesSegment, "key" | "label" | "color">> = [
  { key: "afreschi", label: "Afreschi", color: "#2F855A" },
  { key: "gootoe", label: "GooToE", color: "#ED8936" },
  { key: "herz", label: "Herz", color: "#3182CE" },
  { key: "vitaday", label: "Vitaday", color: "#ECC94B" },
  { key: "healthy-moment", label: "Healthy Moment", color: "#E53E3E" },
  { key: "unclassified", label: "未分類", color: "#A0A7B1" },
];

const CATEGORY_DEFINITIONS: ReadonlyArray<Pick<CategorySalesSegment, "key" | "label" | "color">> = [
  { key: "turkey-tendon", label: "Turkey Tendons/Tendon", color: "#b45309" },
  { key: "turkey", label: "Turkey", color: "#f59e0b" },
  { key: "chicken", label: "Chicken", color: "#ef4444" },
  { key: "salmon", label: "Salmon", color: "#f97316" },
  { key: "buffalo", label: "Buffalo", color: "#7c3aed" },
  { key: "fish", label: "Fish", color: "#0284c7" },
  { key: "air-dried", label: "Air Dried", color: "#10b981" },
  { key: "other", label: "其他", color: "#94a3b8" },
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeInteger(value: unknown): value is number {
  return nonNegative(value) && Number.isSafeInteger(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function centsEqual(left: number, right: number, currencyCode: string): boolean {
  const scale = currencyCode === "JPY" ? 1 : 100;
  return Math.round(left * scale) === Math.round(right * scale);
}

function parseSegments<T extends RevenueShareSegment>(
  value: unknown,
  definitions: ReadonlyArray<Pick<T, "key" | "label" | "color">>,
): T[] {
  if (!Array.isArray(value) || value.length !== definitions.length) {
    throw new Error("品牌與品類營收回應無法安全辨識。");
  }
  return value.map((raw, index) => {
    const segment = record(raw);
    const definition = definitions[index];
    if (
      !segment ||
      segment.key !== definition.key ||
      segment.label !== definition.label ||
      segment.color !== definition.color ||
      !nonNegative(segment.amount) ||
      !nonNegative(segment.percentage) ||
      segment.percentage > 100 ||
      !safeInteger(segment.skuCount) ||
      !safeInteger(segment.unitCount)
    ) {
      throw new Error("品牌與品類營收回應無法安全辨識。");
    }
    return segment as unknown as T;
  });
}

function segmentsMatchSummary(
  segments: readonly RevenueShareSegment[],
  amount: number,
  unitCount: number,
  soldFbaSkuCount: number,
  currencyCode: string,
): boolean {
  return (
    centsEqual(segments.reduce((sum, segment) => sum + segment.amount, 0), amount, currencyCode) &&
    segments.reduce((sum, segment) => sum + segment.unitCount, 0) === unitCount &&
    segments.reduce((sum, segment) => sum + segment.skuCount, 0) === soldFbaSkuCount &&
    segments.every((segment) => {
      const expectedPercentage = amount > 0
        ? Number(((segment.amount / amount) * 100).toFixed(1))
        : 0;
      return segment.percentage === expectedPercentage;
    })
  );
}

export function parseBrandSalesSnapshot(
  value: unknown,
  expected: { marketplaceId: string; startDate: string; endDate: string },
): BrandSalesSnapshot {
  const root = record(value);
  const summary = record(root?.summary);
  if (
    !root ||
    root.schemaVersion !== 2 ||
    (root.mode !== "live" && root.mode !== "demo") ||
    root.marketplaceId !== expected.marketplaceId ||
    root.startDate !== expected.startDate ||
    root.endDate !== expected.endDate ||
    !validDate(root.startDate) ||
    !validDate(root.endDate) ||
    typeof root.fetchedAt !== "string" ||
    Number.isNaN(Date.parse(root.fetchedAt)) ||
    typeof root.dataThrough !== "string" ||
    Number.isNaN(Date.parse(root.dataThrough)) ||
    Date.parse(root.dataThrough) > Date.parse(root.fetchedAt) ||
    (root.rangeFreshness !== "complete-days" && root.rangeFreshness !== "includes-current-day") ||
    typeof root.currencyCode !== "string" ||
    !/^[A-Z]{3}$/u.test(root.currencyCode) ||
    root.source !== "FBA_CUSTOMER_SHIPMENT_SALES_REPORT" ||
    typeof root.notice !== "string" ||
    !summary ||
    !nonNegative(summary.amount) ||
    !safeInteger(summary.unitCount) ||
    !nonNegative(summary.classifiedAmount) ||
    !nonNegative(summary.unclassifiedAmount) ||
    !safeInteger(summary.currentFbaSkuCount) ||
    !safeInteger(summary.soldFbaSkuCount) ||
    !safeInteger(summary.soldCurrentFbaSkuCount) ||
    !safeInteger(summary.unmatchedCurrentFbaRowCount)
  ) {
    throw new Error("品牌營收回應無法安全辨識。");
  }
  const segments = parseSegments<BrandSalesSegment>(root.segments, DEFINITIONS);
  const categorySegments = parseSegments<CategorySalesSegment>(
    root.categorySegments,
    CATEGORY_DEFINITIONS,
  );
  const amount = segments.reduce((sum, segment) => sum + segment.amount, 0);
  const unclassified = segments.find((segment) => segment.key === "unclassified")!;
  if (
    !segmentsMatchSummary(
      segments,
      summary.amount as number,
      summary.unitCount as number,
      summary.soldFbaSkuCount as number,
      root.currencyCode,
    ) ||
    !segmentsMatchSummary(
      categorySegments,
      summary.amount as number,
      summary.unitCount as number,
      summary.soldFbaSkuCount as number,
      root.currencyCode,
    ) ||
    !centsEqual(unclassified.amount, summary.unclassifiedAmount as number, root.currencyCode) ||
    !centsEqual(
      amount - unclassified.amount,
      summary.classifiedAmount as number,
      root.currencyCode,
    ) ||
    (summary.soldCurrentFbaSkuCount as number) > (summary.currentFbaSkuCount as number) ||
    (summary.soldCurrentFbaSkuCount as number) > (summary.soldFbaSkuCount as number)
  ) {
    throw new Error("品牌營收加總與明細不一致。");
  }
  return {
    schemaVersion: 2,
    mode: root.mode,
    marketplaceId: root.marketplaceId,
    startDate: root.startDate,
    endDate: root.endDate,
    fetchedAt: root.fetchedAt,
    dataThrough: root.dataThrough,
    rangeFreshness: root.rangeFreshness,
    currencyCode: root.currencyCode,
    segments,
    categorySegments,
    summary: {
      amount: summary.amount,
      unitCount: summary.unitCount,
      classifiedAmount: summary.classifiedAmount,
      unclassifiedAmount: summary.unclassifiedAmount,
      currentFbaSkuCount: summary.currentFbaSkuCount,
      soldFbaSkuCount: summary.soldFbaSkuCount,
      soldCurrentFbaSkuCount: summary.soldCurrentFbaSkuCount,
      unmatchedCurrentFbaRowCount: summary.unmatchedCurrentFbaRowCount,
    },
    source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT",
    notice: root.notice,
  };
}
