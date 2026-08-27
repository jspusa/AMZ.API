import { createHash } from "node:crypto";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import type { ListingContentReadProduction } from
  "./listing-content-read-production";
import type { ListingContentSnapshot } from "./listing-content-types";
import {
  type ListingImageGateway,
  type ListingImageGatewayRead,
  type ListingImagePatchDescriptor,
  type ListingImageSourceEvidence,
  type ListingImageUrlVector,
} from "./listing-image-gateway";
import type {
  ListingImageIdentity,
  ListingImageSnapshot,
} from "./listing-image-types";
import {
  IMAGE_ATTRIBUTE_NAMES,
  attributeObjects,
  isRecord,
  type AmazonListingItem,
} from "./listing-item-projection";
import type { ListingsWriteProduction } from
  "./listings-write-production";
import { SpApiError } from "./sp-api-error";

type ListingImageMode = "live" | "demo";

export type ListingImageGatewayProductionDependencies = Readonly<{
  contentReads: ListingContentReadProduction;
  readDemoContent(identity: ListingImageIdentity): ListingContentSnapshot;
  resolveMode(marketplaceId: MarketplaceId): ListingImageMode;
  credentialGeneration(): number;
  write: ListingsWriteProduction;
}>;

export type ListingImageGatewayProductionRuntime = Readonly<{
  gateway: ListingImageGateway;
  clear(): void;
}>;

type ProductionListingImageEvidence = Readonly<{
  mode: ListingImageMode;
  purpose: "read-only" | "mutation";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string;
  previousUrls: ListingImageUrlVector;
  generation: number;
  payload: AmazonListingItem | null;
}>;

function demoKey(identity: ListingImageIdentity): string {
  return `${identity.marketplaceId}:${identity.sellerSku}`;
}

function listingImageUrl(
  payload: AmazonListingItem,
  attributeName: string,
  marketplaceId: MarketplaceId,
): string | null {
  const raw = payload.attributes?.[attributeName];
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) {
    throw new SpApiError(
      "Amazon 圖片欄位不是可精確核對的 current-market locator 陣列，已停止使用。",
      { status: 409, code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" },
    );
  }
  const currentMarket: string[] = [];
  for (const item of raw) {
    if (
      !isRecord(item) ||
      typeof item.marketplace_id !== "string" ||
      !item.marketplace_id.trim() ||
      item.marketplace_id !== item.marketplace_id.trim() ||
      !marketplaceById(item.marketplace_id)
    ) {
      throw new SpApiError(
        "Amazon 圖片欄位含有無法確認站點的 locator，已停止使用。",
        { status: 409, code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" },
      );
    }
    if (item.marketplace_id !== marketplaceId) continue;
    if (
      typeof item.media_location !== "string" ||
      !item.media_location.trim() ||
      item.media_location !== item.media_location.trim()
    ) {
      throw new SpApiError(
        "Amazon 圖片欄位含有無法精確核對的 locator，已停止使用。",
        { status: 409, code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" },
      );
    }
    currentMarket.push(item.media_location);
  }
  if (currentMarket.length > 1) {
    throw new SpApiError(
      "Amazon 同一圖片位置回傳多個 current-market locator，已停止預檢與回查。",
      { status: 409, code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" },
    );
  }
  return currentMarket[0] ?? null;
}

function normalizeImageUrls(
  values: readonly (string | null)[],
): Array<string | null> {
  return IMAGE_ATTRIBUTE_NAMES.map((_, index) => {
    const value = values[index];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  });
}

function imageUrlVector(
  values: readonly (string | null)[],
): ListingImageUrlVector {
  const normalized = normalizeImageUrls(values);
  return [
    normalized[0] ?? null,
    normalized[1] ?? null,
    normalized[2] ?? null,
    normalized[3] ?? null,
    normalized[4] ?? null,
    normalized[5] ?? null,
    normalized[6] ?? null,
    normalized[7] ?? null,
    normalized[8] ?? null,
  ];
}

function imageExpectedOldHash(values: ListingImageUrlVector): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function exactImagePatchChanges(
  patch: ListingImagePatchDescriptor,
): boolean {
  if (
    patch.previousUrls.length !== IMAGE_ATTRIBUTE_NAMES.length ||
    patch.requestedUrls.length !== IMAGE_ATTRIBUTE_NAMES.length ||
    !patch.previousUrls.every((value) =>
      value === null || typeof value === "string") ||
    !patch.requestedUrls.every((value) =>
      value === null || typeof value === "string") ||
    patch.changes.length === 0
  ) return false;
  const expectedSlots = patch.requestedUrls.flatMap((url, index) =>
    url === patch.previousUrls[index] ? [] : [index]
  );
  return patch.changes.length === expectedSlots.length &&
    patch.changes.every((change, index) =>
      change.slot === expectedSlots[index] &&
      change.previousUrl === patch.previousUrls[change.slot] &&
      change.requestedUrl === patch.requestedUrls[change.slot]
    );
}

/**
 * Fixed Listing Images production boundary.
 *
 * Raw Listing attributes are retained only behind an unforgeable evidence
 * token so exact delete values can be reconstructed without crossing the
 * domain seam. The caller cannot select an endpoint, method, token, retry
 * policy or arbitrary Listings body.
 */
export function createListingImageGatewayProduction(
  dependencies: ListingImageGatewayProductionDependencies,
): ListingImageGatewayProductionRuntime {
  const demoImageOverrides = new Map<string, Array<string | null>>();
  const listingImageEvidence = new WeakMap<
    object,
    ProductionListingImageEvidence
  >();

  function imageSnapshotFromContext(
    listing: ListingContentSnapshot,
    payload?: AmazonListingItem,
  ): ListingImageSnapshot {
    const override = demoImageOverrides.get(demoKey(listing));
    const urls = payload
      ? IMAGE_ATTRIBUTE_NAMES.map((name) =>
          listingImageUrl(payload, name, listing.marketplaceId),
        )
      : normalizeImageUrls(override ?? []);
    return {
      mode: listing.mode,
      marketplaceId: listing.marketplaceId,
      sellerSku: listing.sellerSku,
      asin: listing.asin,
      productType: listing.productType,
      title: listing.title,
      attributesPresent: listing.mode === "demo" ||
        isRecord(payload?.attributes),
      images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) => ({
        attributeName,
        label: index === 0 ? "主圖" : `副圖 ${index}`,
        url: urls[index] ?? null,
        capability: listing.capabilities.images[index] ?? {
          attributeName,
          label: index === 0 ? "主圖" : `副圖 ${index}`,
          supported: false,
          editable: false,
          required: false,
          reason: "Amazon 商品類型規格未提供此圖片欄位。",
        },
      })),
      fetchedAt: listing.fetchedAt,
      requestId: listing.requestId,
      issues: listing.issues,
      notice: listing.notice?.includes("寫入已停用")
        ? listing.notice
        : listing.mode === "live"
          ? "圖片 URL 取自 Listing attributes；Amazon 接受後仍會非同步下載與審核。"
          : "展示模式可測試排序與預檢，不會更動 Amazon。",
    };
  }

  function mintListingImageEvidence(
    evidence: ProductionListingImageEvidence,
  ): ListingImageSourceEvidence {
    const token = Object.freeze(Object.create(null)) as object;
    listingImageEvidence.set(token, evidence);
    return token as ListingImageSourceEvidence;
  }

  function observation(
    snapshot: ListingImageSnapshot,
    input: Readonly<{
      purpose: "read-only" | "mutation";
      payload: AmazonListingItem | null;
    }>,
  ): ListingImageGatewayRead {
    const previousUrls = imageUrlVector(
      snapshot.images.map((image) => image.url),
    );
    return {
      snapshot,
      fulfillment: "FBA",
      sourceEvidence: mintListingImageEvidence({
        mode: snapshot.mode,
        purpose: input.purpose,
        marketplaceId: snapshot.marketplaceId,
        sellerSku: snapshot.sellerSku,
        asin: snapshot.asin,
        productType: snapshot.productType,
        previousUrls,
        generation: dependencies.credentialGeneration(),
        payload: input.payload,
      }),
    };
  }

  function resolveEvidence(
    patch: ListingImagePatchDescriptor,
    expectedMode: ListingImageMode,
  ): ProductionListingImageEvidence {
    const evidence = listingImageEvidence.get(
      patch.sourceEvidence as object,
    );
    if (
      evidence &&
      evidence.generation !== dependencies.credentialGeneration()
    ) {
      throw new SpApiError(
        "Amazon 執行環境已在商品圖片操作期間改變；舊證據已丟棄。",
        { status: 409, code: "CREDENTIALS_CHANGED" },
      );
    }
    if (
      !evidence ||
      evidence.purpose !== "mutation" ||
      evidence.mode !== expectedMode ||
      evidence.marketplaceId !== patch.marketplaceId ||
      evidence.sellerSku !== patch.sellerSku ||
      evidence.asin !== patch.asin ||
      evidence.productType !== patch.productType ||
      patch.expectedOldHash !== imageExpectedOldHash(evidence.previousUrls) ||
      JSON.stringify(patch.previousUrls) !==
        JSON.stringify(evidence.previousUrls) ||
      !exactImagePatchChanges(patch)
    ) {
      throw new SpApiError(
        "商品圖片來源證據已失效或與這次 SKU／圖片位置不一致，請重新預檢。",
        { status: 409, code: "LISTING_IMAGE_EVIDENCE_INVALID" },
      );
    }
    return evidence;
  }

  function patchBody(
    patch: ListingImagePatchDescriptor,
    evidence: ProductionListingImageEvidence,
  ): Readonly<{ productType: string; patches: unknown[] }> {
    return {
      productType: patch.productType,
      patches: patch.changes.map((change) => {
        const attributeName = IMAGE_ATTRIBUTE_NAMES[change.slot];
        if (change.requestedUrl === null) {
          const existing = evidence.payload
            ? attributeObjects(
                evidence.payload,
                attributeName,
                patch.marketplaceId,
              )
            : [];
          return {
            op: "delete",
            path: `/attributes/${attributeName}`,
            value: existing.length
              ? existing
              : [{
                  media_location: change.previousUrl,
                  marketplace_id: patch.marketplaceId,
                }],
          };
        }
        return {
          op: change.previousUrl ? "replace" : "add",
          path: `/attributes/${attributeName}`,
          value: [{
            media_location: change.requestedUrl,
            marketplace_id: patch.marketplaceId,
          }],
        };
      }),
    };
  }

  const gateway: ListingImageGateway = {
    mode: dependencies.resolveMode,
    read: async (identity, purpose) => {
      if (dependencies.resolveMode(identity.marketplaceId) === "demo") {
        return observation(
          imageSnapshotFromContext(dependencies.readDemoContent(identity)),
          { purpose, payload: null },
        );
      }
      const context = await dependencies.contentReads.read({
        marketplaceId: identity.marketplaceId,
        sellerSku: identity.sellerSku,
        allowReadOnlySchema: purpose === "read-only",
      });
      return observation(
        imageSnapshotFromContext(context.listing, context.payload),
        { purpose, payload: context.payload },
      );
    },
    validationPreview: async (patch) => {
      const evidence = resolveEvidence(patch, "live");
      return dependencies.write.validationPreview({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: patchBody(patch, evidence),
      });
    },
    commitOnce: async (patch, fence) => {
      const evidence = resolveEvidence(patch, "live");
      return dependencies.write.commitOnce({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: patchBody(patch, evidence),
        assertBeforeSend: () => fence.assertCurrent(),
      });
    },
    replaceDemoImages: async (patch, fence) => {
      const evidence = resolveEvidence(patch, "demo");
      await fence.assertCurrent();
      if (evidence.generation !== dependencies.credentialGeneration()) {
        throw new SpApiError(
          "Amazon 執行環境已在展示圖片更新期間改變；舊結果已丟棄。",
          { status: 409, code: "CREDENTIALS_CHANGED" },
        );
      }
      demoImageOverrides.set(demoKey(patch), [...patch.requestedUrls]);
    },
  };

  return Object.freeze({
    gateway,
    clear: () => demoImageOverrides.clear(),
  });
}
