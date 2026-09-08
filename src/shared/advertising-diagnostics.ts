import type { OperationsReadMetadata } from "./operations-intelligence";

export type AdvertisingDiagnosticRow = Readonly<{
  key: string;
  sellerSku: string;
  asin: string;
  status: "needs-review" | "insufficient-evidence" | "no-signal";
  spend: number | null;
  attributedSales14d: number | null;
  purchases14d: number | null;
  acos: number | null;
  acosStatus: "reported" | "no-sales" | "not-reported";
  roas: number | null;
  roasStatus: "reported" | "no-spend" | "not-reported";
  suggestedAcos: number | null;
  rationale: readonly string[];
}>;

export type AdvertisingDiagnosticsSnapshot = OperationsReadMetadata & Readonly<{
  kind: "advertising";
  dateRange: Readonly<{ startDate: string; endDate: string }>;
  currencyCode: string;
  attributionWindowDays: 14;
  sourceFetchedAt: Readonly<{ fba: string; sales: string; ads: string }>;
  rows: readonly AdvertisingDiagnosticRow[];
  notice: string;
}>;
