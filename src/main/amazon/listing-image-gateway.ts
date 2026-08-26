import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";
import type {
  ListingImageIdentity,
  ListingImageSnapshot,
} from "./listing-image-types";

declare const listingImageSourceEvidenceBrand: unique symbol;

/** Adapter-minted capability. Raw Listing payloads never cross this seam. */
export type ListingImageSourceEvidence = Readonly<{
  [listingImageSourceEvidenceBrand]: "listing-image-source-evidence";
}>;

export type ListingImageSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ListingImageUrlVector = readonly [
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
];

export type ListingImageSlotChange = Readonly<{
  slot: ListingImageSlot;
  previousUrl: string | null;
  requestedUrl: string | null;
}>;

export type ListingImagePatchDescriptor = ListingImageIdentity & Readonly<{
  asin: string;
  productType: string;
  expectedOldHash: string;
  previousUrls: ListingImageUrlVector;
  requestedUrls: ListingImageUrlVector;
  changes: readonly ListingImageSlotChange[];
  sourceEvidence: ListingImageSourceEvidence;
}>;

export type ListingImageGatewayRead = Readonly<{
  snapshot: ListingImageSnapshot;
  sourceEvidence: ListingImageSourceEvidence;
  fulfillment: "FBA";
}>;

export type ListingImageGatewayReply = Readonly<{
  ok: boolean;
  status: number;
  requestId: string | null;
  retryAfter: string | null;
  payload: unknown;
}>;

/** Fixed production boundary below the Listing Images mutation domain. */
export interface ListingImageGateway {
  mode(marketplaceId: MarketplaceId): "live" | "demo";
  read(
    identity: ListingImageIdentity,
    purpose: "read-only" | "mutation",
  ): Promise<ListingImageGatewayRead>;
  validationPreview(
    patch: ListingImagePatchDescriptor,
  ): Promise<ListingImageGatewayReply>;
  commitOnce(
    patch: ListingImagePatchDescriptor,
    fence: ListingWriteExecutionFence,
  ): Promise<ListingImageGatewayReply>;
  replaceDemoImages(
    patch: ListingImagePatchDescriptor,
    fence: ListingWriteExecutionFence,
  ): Promise<void>;
}
