import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";
import type { ListingIssue } from "./sp-api-error";
import type { VariationFieldDescriptor } from "./variation-update";

export type VariationMoveAction = "detach" | "attach";

export type VariationDetachInput = {
  preserveRequiredFields?: string[];
  requiredValues?: Record<string, unknown>;
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
  preserveRequiredFields?: string[];
  requiredValues?: Record<string, unknown>;
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
  action: VariationMoveAction;
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  productType: string;
  variationTheme: string | null;
  dimensionNames: string[];
  fields: VariationFieldDescriptor[];
  requiredFields: VariationFieldDescriptor[];
  requiredFieldChoices?: VariationFieldDescriptor[];
  preservedRequiredFields?: VariationFieldDescriptor[];
  preparedAt: string;
  requestIds: string[];
  writable: boolean;
  blockers: string[];
  warnings: string[];
  notice: string;
};

export type VariationMovePreview = {
  changes: Array<{ name: string; label: string; before: unknown; after: unknown }>;
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
