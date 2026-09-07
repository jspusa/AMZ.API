import type { MarketplaceId } from "./marketplaces";

export const B2B_RECENT_WORK_LIMIT = 30;

/** Public observation only. None of these fields authorize an Amazon write. */
export type B2bRecentWorkItem = Readonly<{
  sellerSku: string;
  stage: "business_price" | "minimum_price";
  status: "PROCESSING" | "UNKNOWN" | "MINIMUM_VERIFIED" | "VERIFIED";
  acceptedAt: string | null;
  verifiedAt: string | null;
  updatedAt: string;
  canResend: false;
  nextAction: "readback" | "fresh_preview";
  notice: string;
}>;

export type B2bRecentWorkSnapshot = Readonly<{
  schemaVersion: 1;
  marketplaceId: MarketplaceId;
  mode: "live" | "demo";
  checkedAt: string;
  limit: typeof B2B_RECENT_WORK_LIMIT;
  items: readonly B2bRecentWorkItem[];
}>;
