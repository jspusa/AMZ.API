import type { MarketplaceId } from "../../shared/marketplaces";
import type { ListingIssue } from "./sp-api-error";

export type ListingImageIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

export type ListingImageFieldCapability = {
  attributeName: string;
  label: string;
  supported: boolean;
  editable: boolean;
  required: boolean;
  reason: string | null;
};

export type ListingImageSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string;
  title: string;
  attributesPresent: boolean;
  images: Array<{
    attributeName: string;
    label: string;
    url: string | null;
    capability: ListingImageFieldCapability;
  }>;
  fetchedAt: string;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

export type UpdateListingImagesInput = {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedUrls: Array<string | null>;
  urls: Array<string | null>;
};

export type ListingImageUpdateResult = {
  mode: "live" | "demo";
  status: "VALID" | "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  previousUrls: Array<string | null>;
  requestedUrls: Array<string | null>;
  changedSlots: number[];
  completedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};
