import type { MarketplaceId } from "./marketplaces";

export const LISTING_IMAGE_BATCH_MAX_SKUS = 30;
export const LISTING_IMAGE_BATCH_MAX_IMAGES_PER_SKU = 10;

export type ListingImageBatchRowInput = Readonly<{
  sellerSku: string;
  /** Complete replacement: omitted positions must be represented by null. */
  urls: readonly (string | null)[];
}>;

export type ListingImageBatchRowState =
  | "ready" | "unchanged" | "blocked" | "not-started" | "submitting"
  | "accepted" | "verified" | "unknown" | "rejected" | "simulated";

export type ListingImageBatchRow = Readonly<{
  sellerSku: string;
  asin: string | null;
  title: string;
  previousUrls: readonly (string | null)[];
  requestedUrls: readonly (string | null)[];
  /** Human-facing, one-based positions. */
  changedSlots: readonly number[];
  deletedSlots: readonly number[];
  state: ListingImageBatchRowState;
  code: string | null;
  message: string | null;
  requestId: string | null;
  acceptedAt: string | null;
}>;

export type ListingImageBatchCapabilities = Readonly<{
  capability: "listing-image-batch-v1";
  maxSkus: 30;
  maxImagesPerSku: 10;
  replacementMode: "complete";
  confirmationMode: "native";
  readbackRecovery?: "exact-sku-v1";
}>;

export type ListingImageBatchSnapshot = Readonly<{
  capability: "listing-image-batch-v1";
  batchId: string;
  reviewToken: string;
  marketplaceId: MarketplaceId;
  mode: "live" | "demo";
  replacementMode: "complete";
  phase: "ready" | "revalidating" | "awaiting-approval" | "submitting" | "readback" | "completed" | "stopped";
  expiresAt: string;
  rows: readonly ListingImageBatchRow[];
  totals: Readonly<{ skus: number; ready: number; blocked: number; unchanged: number; submitted: number; accepted: number; verified: number; deletedSlots: number }>;
  message: string | null;
  /** Main-owned completion time of the latest bounded readback pass. */
  lastReadbackAt?: string | null;
}>;

export type ListingImageBatchPreviewInput = Readonly<{
  marketplaceId: MarketplaceId;
  replacementMode: "complete";
  rows: readonly ListingImageBatchRowInput[];
}>;

export type ListingImageBatchCommitInput = Readonly<{
  marketplaceId: MarketplaceId;
  batchId: string;
  reviewToken: string;
  completeReplacementAcknowledged: true;
}>;
