import type { OperationsFbaIdentity, OperationsReadMetadata } from "./operations-intelligence";

export type AmazonPromotionStatus = "PROCESSING" | "UPCOMING" | "RUNNING" | "EXPIRED" | "FAILED" | "CANCELLING" | "CANCELLED" | "UNKNOWN";
export type AmazonPromotionIssue = Readonly<{ code: string | null; severity: "ERROR" | "WARNING" | "UNKNOWN" }>;
export type AmazonPromotionRevision = Readonly<{
  status: AmazonPromotionStatus;
  startDate: string | null;
  endDate: string | null;
  selectionType: "ITEMS" | "CATALOG" | "UNKNOWN";
  items: readonly OperationsFbaIdentity[];
  issues: readonly AmazonPromotionIssue[] | null;
  coverage: "complete" | "partial";
}>;
export type AmazonPromotion = Readonly<{
  key: string;
  title: string;
  promotionType: "BASKET_BUILDING" | "DEAL" | "PRICE_DISCOUNT" | "COUPON" | "UNKNOWN";
  published: AmazonPromotionRevision;
  latestRevision: AmazonPromotionRevision | null;
}>;
export type AmazonPromotionsSnapshot = OperationsReadMetadata & Readonly<{
  promotions: readonly AmazonPromotion[];
  reportedTotal: number | null;
  excludedPromotionCount: number;
}>;
