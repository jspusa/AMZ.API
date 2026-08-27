import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingImageFieldCapability } from "./listing-image-types";
import type { ListingIssue } from "./sp-api-error";

export type ListingContentFieldCapability = {
  supported: boolean;
  editable: boolean;
  required: boolean;
  minItems: number | null;
  maxItems: number | null;
  minLength: number | null;
  maxLength: number | null;
  maxUtf8Bytes: number | null;
  languageTags: string[];
  reason: string | null;
};

export type ListingContentField =
  | "title"
  | "itemHighlight"
  | "bulletPoints"
  | "productDescription"
  | "ingredients";

export type ListingContentSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string;
  status: string[];
  title: string;
  itemHighlight: string;
  bulletPoints: string[];
  productDescription: string;
  ingredients: string;
  languageTag: string;
  attributePresence: {
    title: boolean;
    itemHighlight: boolean;
    bulletPoints: boolean;
    productDescription: boolean;
    ingredients: boolean;
  };
  capabilities: {
    title: ListingContentFieldCapability;
    itemHighlight: ListingContentFieldCapability;
    bulletPoints: ListingContentFieldCapability;
    productDescription: ListingContentFieldCapability;
    ingredients: ListingContentFieldCapability;
    images: ListingImageFieldCapability[];
    schemaChecksum: string | null;
  };
  createdAt: string | null;
  updatedAt: string | null;
  fetchedAt: string;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string | null;
};

export type ListingContentValues = {
  title: string;
  itemHighlight: string;
  bulletPoints: string[];
  productDescription: string;
  ingredients: string;
};

export type UpdateListingContentInput = ListingContentValues & {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedTitle: string;
  expectedItemHighlight: string;
  expectedBulletPoints: string[];
  expectedProductDescription: string;
  expectedIngredients: string;
};

export type ListingContentValidationResult = {
  mode: "live" | "demo";
  status: "VALID" | "INVALID" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: ListingContentField[];
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};

export type ListingContentUpdateResult = {
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: ListingContentField[];
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};
