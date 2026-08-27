import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";
import type { ListingIssue } from "./sp-api-error";

declare const variationMoveSourceEvidenceBrand: unique symbol;
declare const variationMoveTargetEvidenceBrand: unique symbol;
declare const variationMovePtdEvidenceBrand: unique symbol;

/** Adapter-minted capability bound to one exact canonical source read. */
export type VariationMoveSourceEvidence = Readonly<{
  [variationMoveSourceEvidenceBrand]: "variation-move-source-evidence";
}>;

/** Adapter-minted capability bound to one exact target-family read. */
export type VariationMoveTargetEvidence = Readonly<{
  [variationMoveTargetEvidenceBrand]: "variation-move-target-evidence";
}>;

/** Adapter-minted capability bound to one exact CHILD PTD observation. */
export type VariationMovePtdEvidence = Readonly<{
  [variationMovePtdEvidenceBrand]: "variation-move-ptd-evidence";
}>;

export type VariationMoveIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

export type VariationMovePrepareRequest =
  | (VariationMoveIdentity & Readonly<{
      action: "detach";
      expectedSourceParentSku: string;
    }>)
  | (VariationMoveIdentity & Readonly<{
      action: "attach";
      targetParentSku: string;
      purpose: "preparation" | "mutation";
    }>);

export type VariationMoveSourceObservation = VariationMoveIdentity & Readonly<{
  asin: string | null;
  productType: string | null;
  fulfillment: "FBA" | "OTHER";
  role: "parent" | "child" | "standalone";
  parentSku: string | null;
  relationshipType: string | null;
  variationTheme: string | null;
  explicitStandalone: boolean;
  familyComplete: boolean;
  sourceEvidence: VariationMoveSourceEvidence;
}>;

export type VariationMoveTargetObservation = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string | null;
  role: "parent" | "child" | "standalone";
  variationTheme: string | null;
  dimensionNames: readonly string[];
  familyComplete: boolean;
  targetEvidence: VariationMoveTargetEvidence;
  childSchema: unknown;
  childSchemaChecksum: string | null;
  ptdEvidence: VariationMovePtdEvidence;
  /** Only the target family's allowlisted dimension attributes for the source. */
  sourceDimensionValues: Readonly<Record<string, unknown>>;
  children: readonly Readonly<{
    sellerSku: string;
    dimensionValues: Readonly<Record<string, unknown>>;
  }>[];
}>;

export type VariationMoveGatewayPreparation =
  | Readonly<{
      action: "detach";
      mode: "live" | "demo";
      source: VariationMoveSourceObservation;
      requestIds: readonly string[];
    }>
  | Readonly<{
      action: "attach";
      mode: "live" | "demo";
      source: VariationMoveSourceObservation;
      target: VariationMoveTargetObservation;
      requestIds: readonly string[];
    }>;

type VariationMoveDescriptorBase = VariationMoveIdentity & Readonly<{
  asin: string;
  productType: string;
  sourceEvidence: VariationMoveSourceEvidence;
}>;

export type VariationMoveDetachDescriptor = VariationMoveDescriptorBase &
  Readonly<{
    action: "detach";
    expectedSourceParentSku: string;
    targetParentSku: null;
    variationTheme: null;
    dimensionNames: readonly [];
    dimensionValues: Readonly<Record<string, never>>;
  }>;

export type VariationMoveAttachDescriptor = VariationMoveDescriptorBase &
  Readonly<{
    action: "attach";
    expectedSourceParentSku: null;
    targetParentSku: string;
    targetAsin: string | null;
    variationTheme: string;
    dimensionNames: readonly string[];
    dimensionValues: Readonly<Record<string, unknown>>;
    childSchemaChecksum: string;
    targetEvidence: VariationMoveTargetEvidence;
    ptdEvidence: VariationMovePtdEvidence;
  }>;

export type VariationMoveDescriptor =
  | VariationMoveDetachDescriptor
  | VariationMoveAttachDescriptor;

/** Canonical relationship projection used for bounded post-write readback. */
export type VariationMoveObservation = VariationMoveIdentity & Readonly<{
  asin: string | null;
  productType: string | null;
  fulfillment: "FBA" | "OTHER";
  role: "parent" | "child" | "standalone";
  /** Parent inferred from the canonical relationship family read. */
  parentSku: string | null;
  /** Exact current-market fields from Listings attributes. */
  parentageLevel: string | null;
  attributeParentSku: string | null;
  relationshipType: string | null;
  variationTheme: string | null;
  relationshipAttributesAbsent: boolean;
  dimensionSignature: string | null;
  explicitStandalone: boolean;
}>;

/** Main-only canonical source read used to reconcile durable unknown writes. */
export type VariationMoveCanonicalObservation = VariationMoveObservation &
  Readonly<{
    mode: "live" | "demo";
    familyComplete: boolean;
    dimensionNames: readonly string[];
    parentAsin: string | null;
    parentProductType: string | null;
  }>;

export type VariationMoveValidationReceipt = Readonly<{
  status: "VALID" | "INVALID" | "UNKNOWN";
  requestId: string | null;
  issues: readonly ListingIssue[];
}>;

export type VariationMoveCommitReceipt = Readonly<{
  status: "ACCEPTED" | "INVALID" | "UNKNOWN";
  submissionId: string | null;
  requestId: string | null;
  issues: readonly ListingIssue[];
}>;

/**
 * Fixed production boundary below the complete Variation Move domain.
 *
 * The domain owns all eligibility, drift, duplicate-dimension, two-stage,
 * preview, commit and readback decisions. The adapter owns only exact Amazon
 * reads, opaque raw evidence, CHILD PTD retrieval, one allowlisted PATCH
 * transport and the shared deterministic demo relationship.
 */
export interface VariationMoveGateway {
  mode(marketplaceId: MarketplaceId): "live" | "demo";
  readCanonical(
    identity: VariationMoveIdentity,
  ): Promise<VariationMoveCanonicalObservation>;
  prepare(
    input: VariationMovePrepareRequest,
  ): Promise<VariationMoveGatewayPreparation>;
  observe(descriptor: VariationMoveDescriptor): Promise<VariationMoveObservation>;
  validationPreview(
    descriptor: VariationMoveDescriptor,
  ): Promise<VariationMoveValidationReceipt>;
  commitOnce(
    descriptor: VariationMoveDescriptor,
    fence: ListingWriteExecutionFence,
    recordDispatch: () => Promise<void>,
  ): Promise<VariationMoveCommitReceipt>;
  replaceDemoRelationship(
    descriptor: VariationMoveDescriptor,
    fence: ListingWriteExecutionFence,
  ): Promise<void>;
}
