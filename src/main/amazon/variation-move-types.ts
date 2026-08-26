import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";
import type { ListingIssue } from "./sp-api-error";
import type { VariationFieldDescriptor } from "./variation-update";

export type VariationMoveAction = "detach" | "attach";

export type VariationDetachInput = {
  action: "detach";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedSourceParentSku: string;
  targetParentSku: null;
  variationTheme: null;
  dimensionNames: [];
  dimensionValues: Record<string, never>;
};

export type VariationAttachInput = {
  action: "attach";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedSourceParentSku: null;
  targetParentSku: string;
  variationTheme: string;
  dimensionNames: string[];
  dimensionValues: Record<string, unknown>;
};

export type VariationMoveInput = VariationDetachInput | VariationAttachInput;

export type VariationMovePreparation = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string;
  productType: string;
  variationTheme: string;
  dimensionNames: string[];
  fields: VariationFieldDescriptor[];
  preparedAt: string;
  requestIds: string[];
  writable: boolean;
  blockers: string[];
  warnings: string[];
  notice: string;
};

export type VariationMovePreview = {
  mode: "live" | "demo";
  action: VariationMoveAction;
  status: "VALID" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};

export type VariationMoveResult = {
  mode: "live" | "demo";
  action: VariationMoveAction;
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
  verified: true;
  completedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

export type VariationMoveExecutionFence = ListingWriteExecutionFence;
