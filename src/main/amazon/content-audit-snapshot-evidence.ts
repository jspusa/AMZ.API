import { createHash } from "node:crypto";
import type { MarketplaceId } from "../../shared/marketplaces";

/**
 * Durable evidence for one exported content-audit workbook. Row digests bind
 * exact source identity/content without persisting Seller SKUs or listing copy.
 * accountScope is already a one-way SHA-256 value, never a Seller ID.
 */
export type ContentAuditSnapshotEvidence = {
  schemaVersion: 1;
  exportId: string;
  accountScope: string;
  marketplaceId: string;
  mode: "live" | "demo";
  fetchedAt: string;
  rowDigests: string[];
  createdAt: number;
  expiresAt: number;
};

export type ContentAuditSnapshotLookup =
  | { status: "available"; evidence: ContentAuditSnapshotEvidence }
  | {
      status:
        | "not-found"
        | "expired"
        | "marketplace-changed"
        | "mode-changed"
        | "account-scope-changed";
      evidence: null;
    };

export type ContentAuditSnapshotEvidenceInput = Pick<
  ContentAuditSnapshotEvidence,
  | "exportId"
  | "accountScope"
  | "marketplaceId"
  | "mode"
  | "fetchedAt"
  | "rowDigests"
>;

export interface ContentAuditSnapshotEvidenceReader {
  getContentAuditSnapshotEvidence(input: Readonly<{
    exportId: string;
    accountScope: string;
    marketplaceId: MarketplaceId;
    mode: "live" | "demo";
    now?: number;
  }>): Promise<ContentAuditSnapshotLookup>;
}

export interface ContentAuditSnapshotEvidenceWriter {
  saveContentAuditSnapshotEvidence(
    input: ContentAuditSnapshotEvidenceInput,
  ): Promise<unknown>;
}

/**
 * Binds one exported workbook row to its main-owned audit snapshot without
 * persisting Seller SKU or listing copy in the snapshot index.
 */
export function contentAuditEvidenceRowDigest(input: Readonly<{
  accountScope: string;
  marketplaceId: MarketplaceId;
  mode: "live" | "demo";
  exportId: string;
  fetchedAt: string;
  sellerSku: string;
  asin: string;
  productType: string;
  variationFamilyKey: string;
  values: Readonly<{
    title: string;
    itemHighlight: string;
    bulletPoints: readonly string[];
    productDescription: string;
    ingredients: string;
  }>;
  readStatus: "complete" | "incomplete";
}>): string {
  return createHash("sha256").update(JSON.stringify([
    "content-audit-snapshot-row-v1",
    input.accountScope,
    input.marketplaceId,
    input.mode,
    input.exportId,
    input.fetchedAt,
    input.sellerSku,
    input.asin,
    input.productType,
    input.variationFamilyKey,
    input.values.title,
    input.values.itemHighlight,
    input.values.bulletPoints,
    input.values.productDescription,
    input.values.ingredients,
    input.readStatus,
  ])).digest("hex");
}
