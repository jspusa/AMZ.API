import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  ListingContentField,
  ListingContentSnapshot,
  ListingContentValues,
} from "./listing-content-types";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";
import type { ListingIssue } from "./sp-api-error";

declare const listingContentSourceEvidenceBrand: unique symbol;
declare const listingContentPtdEvidenceBrand: unique symbol;

export const LISTING_CONTENT_BATCH_EXACT_BULLET_REPLACEMENT_AUTHORITY = Symbol(
  "listing-content-batch-exact-bullet-replacement",
);

/** Adapter-minted capability bound to one exact raw Listing content read. */
export type ListingContentSourceEvidence = Readonly<{
  [listingContentSourceEvidenceBrand]: "listing-content-source-evidence";
}>;

/** Adapter-minted capability bound to one seller-specific PTD observation. */
export type ListingContentPtdEvidence = Readonly<{
  [listingContentPtdEvidenceBrand]: "listing-content-ptd-evidence";
}>;

export type ListingContentIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

export type ListingContentGatewayReadOptions = Readonly<{
  /** Main-owned phase token; never serialized or exposed to the renderer. */
  capabilityRefreshScope?: object;
}>;

export type ListingContentGatewayRead = Readonly<{
  snapshot: ListingContentSnapshot;
  fulfillment: "FBA";
  rawContentGuardHash: string;
  capabilityGuardHash: string;
  fbaEvidenceHash: string;
  sourceEvidence: ListingContentSourceEvidence;
  ptdEvidence: ListingContentPtdEvidence;
}>;

/**
 * Canonical mutation descriptor. The adapter resolves the two opaque evidence
 * capabilities to build the fixed Listings PATCH while preserving raw
 * current-market and other-language attributes inside the adapter.
 */
export type ListingContentPatchDescriptor = ListingContentIdentity & Readonly<{
  asin: string;
  productType: string;
  languageTag: string;
  schemaChecksum: string;
  expectedOldHash: string;
  /** Null for preview; commit must echo the adapter-built preview hash. */
  expectedCanonicalPatchHash: string | null;
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: readonly ListingContentField[];
  /** Main-only authority: replace the exact locale bullet set after disclosure. */
  exactLanguageBulletReplacementAuthority?:
    typeof LISTING_CONTENT_BATCH_EXACT_BULLET_REPLACEMENT_AUTHORITY;
  sourceEvidence: ListingContentSourceEvidence;
  ptdEvidence: ListingContentPtdEvidence;
}>;

export type ListingContentValidationReceipt = Readonly<{
  status: "VALID" | "INVALID" | "UNKNOWN";
  /** Hash of the exact fixed Listings body built inside the adapter. */
  canonicalPatchHash: string;
  /**
   * Main-safe disclosure for an exact-locale bullet replacement. When legacy
   * same-locale bullets 6+ would be removed, the adapter returns every current,
   * requested, and removed value so the UI can obtain an explicit acknowledgement
   * before native approval.
   */
  exactBulletReplacement: ListingContentExactBulletReplacement | null;
  requestId: string | null;
  issues: readonly ListingIssue[];
}>;

export type ListingContentExactBulletReplacement = Readonly<{
  languageTag: string;
  currentExactLanguageBulletPoints: readonly string[];
  requestedExactLanguageBulletPoints: readonly string[];
  removedOverflowBulletPoints: readonly string[];
}>;

export type ListingContentCommitReceipt = Readonly<{
  status: "ACCEPTED" | "INVALID" | "UNKNOWN";
  submissionId: string | null;
  requestId: string | null;
  issues: readonly ListingIssue[];
}>;

/**
 * Fixed production seam below the complete single-SKU Listing Content module.
 * Callers cannot choose an endpoint, method, credential, retry policy or raw
 * Listings request body.
 */
export interface ListingContentGateway {
  mode(marketplaceId: MarketplaceId): "live" | "demo";
  read(
    identity: ListingContentIdentity,
    purpose: "read-only" | "mutation",
    options?: ListingContentGatewayReadOptions,
  ): Promise<ListingContentGatewayRead>;
  validationPreview(
    patch: ListingContentPatchDescriptor,
  ): Promise<ListingContentValidationReceipt>;
  commitOnce(
    patch: ListingContentPatchDescriptor,
    fence: ListingWriteExecutionFence,
    recordDispatch: () => Promise<void>,
  ): Promise<ListingContentCommitReceipt>;
  replaceDemoContent(
    patch: ListingContentPatchDescriptor,
    fence: ListingWriteExecutionFence,
  ): Promise<void>;
}
