import type { AmazonPromotionsSnapshot } from "./amazon-promotions";
import type { AwdInventorySnapshot } from "./awd-inventory";
import type { PriceHealthSnapshot } from "./price-health";
import type { AdvertisingDiagnosticsSnapshot } from "./advertising-diagnostics";

/** Public, credential-free contracts for locally observed operating signals. */
export type OperationsSource = "promotions" | "awd" | "price-health" | "advertising";
export const OPERATIONS_SOURCES: readonly OperationsSource[] = ["promotions", "awd", "price-health", "advertising"];
export type OperationsFbaIdentity = Readonly<{ sellerSku: string; asin: string }>;
export type OperationsFinding = Readonly<{
  key: string;
  source: OperationsSource;
  sellerSku: string | null;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}>;
export type OperationsReadMetadata = Readonly<{
  marketplaceId: string;
  mode: "live" | "demo";
  fetchedAt: string;
  coverage: "complete" | "partial";
  warnings: readonly string[];
  findings: readonly OperationsFinding[];
}>;
export type OperationsEvent = OperationsFinding & Readonly<{
  id: string;
  firstObservedAt: string;
  lastObservedAt: string;
  status: "open" | "acknowledged" | "resolved";
  observation: "local-sync";
}>;
export type OperationsData = AmazonPromotionsSnapshot | AwdInventorySnapshot | PriceHealthSnapshot | AdvertisingDiagnosticsSnapshot;
export type OperationsSourceState = Readonly<{
  source: OperationsSource;
  status: "never" | "running" | "complete" | "partial" | "failed";
  startedAt: string | null;
  fetchedAt: string | null;
  nextSyncAt: string | null;
  message: string;
  snapshot: OperationsData | null;
}>;
export type OperationsIntelligenceSnapshot = Readonly<{
  schemaVersion: 1;
  marketplaceId: string;
  mode: "live" | "demo";
  contextId: string;
  observedAt: string;
  autoSync: boolean;
  sources: Readonly<Record<OperationsSource, OperationsSourceState>>;
  events: readonly OperationsEvent[];
  omittedEventCount: number;
  notice: string;
}>;
