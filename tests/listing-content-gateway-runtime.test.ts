import { describe, expect, it, vi } from "vitest";
import type {
  ListingContentPatchDescriptor,
  ListingContentGatewayRead,
} from "../src/main/amazon/listing-content-gateway";
import { createListingContentGatewayProduction } from
  "../src/main/amazon/listing-content-gateway-production";
import type { ListingContentSnapshot } from
  "../src/main/amazon/listing-content-types";
import {
  canonicalSha256,
  type AmazonListingItem,
} from "../src/main/amazon/listing-item-projection";
import type { ListingPriceSnapshot } from
  "../src/main/amazon/listing-price-types";
import type {
  ListingsCommitOnceCommand,
  ListingsValidationPreviewCommand,
  ListingsWriteProduction,
} from "../src/main/amazon/listings-write-production";

const IDENTITY = {
  marketplaceId: "ATVPDKIKX0DER" as const,
  sellerSku: "CONTENT RUNTIME SKU/01",
};
const ASIN = "B000000001";
const PRODUCT_TYPE = "PET_FOOD";
const LANGUAGE_TAG = "en_US";
const SCHEMA_CHECKSUM = "CONTENT-RUNTIME-SCHEMA";

function fieldCapability() {
  return {
    supported: true,
    editable: true,
    required: false,
    minItems: null,
    maxItems: null,
    minLength: null,
    maxLength: 500,
    maxUtf8Bytes: null,
    languageTags: [LANGUAGE_TAG],
    reason: null,
  };
}

function liveSnapshot(): ListingContentSnapshot {
  return {
    mode: "live",
    marketplaceId: IDENTITY.marketplaceId,
    sellerSku: IDENTITY.sellerSku,
    asin: ASIN,
    productType: PRODUCT_TYPE,
    status: ["BUYABLE"],
    title: "Original title",
    itemHighlight: "Original highlight",
    bulletPoints: ["Original bullet"],
    productDescription: "Original description",
    ingredients: "Turkey",
    languageTag: LANGUAGE_TAG,
    attributePresence: {
      title: true,
      itemHighlight: true,
      bulletPoints: true,
      productDescription: true,
      ingredients: true,
    },
    capabilities: {
      title: fieldCapability(),
      itemHighlight: fieldCapability(),
      bulletPoints: fieldCapability(),
      productDescription: fieldCapability(),
      ingredients: fieldCapability(),
      images: [],
      schemaChecksum: SCHEMA_CHECKSUM,
    },
    createdAt: null,
    updatedAt: null,
    fetchedAt: "2026-08-27T00:00:00.000Z",
    requestId: "CONTENT-RUNTIME-READ",
    issues: [],
    notice: null,
  };
}

function livePayload(): AmazonListingItem {
  const value = (text: string, languageTag = LANGUAGE_TAG) => ({
    value: text,
    language_tag: languageTag,
    marketplace_id: IDENTITY.marketplaceId,
  });
  return {
    sku: IDENTITY.sellerSku,
    summaries: [{
      marketplaceId: IDENTITY.marketplaceId,
      asin: ASIN,
      productType: PRODUCT_TYPE,
      status: ["BUYABLE"],
      itemName: "Original title",
    }],
    productTypes: [{
      marketplaceId: IDENTITY.marketplaceId,
      productType: PRODUCT_TYPE,
    }],
    attributes: {
      item_name: [value("Original title"), value("既存の商品名", "ja_JP")],
      title_differentiation: [value("Original highlight")],
      bullet_point: [value("Original bullet")],
      product_description: [value("Original description")],
      ingredients: [value("Turkey")],
    },
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 4,
    }],
    issues: [],
  };
}

function demoListing(): ListingPriceSnapshot {
  return {
    mode: "demo",
    marketplaceId: IDENTITY.marketplaceId,
    sellerSku: IDENTITY.sellerSku,
    asin: ASIN,
    title: "Demo title",
    productType: PRODUCT_TYPE,
    status: ["BUYABLE"],
    createdAt: null,
    updatedAt: null,
    standardPrice: { amount: 12, currencyCode: "USD" },
    effectivePrice: { amount: 12, currencyCode: "USD" },
    minimumPrice: null,
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice: null,
    discountedPricePresence: "absent",
    hasDiscountedPrice: false,
    hasAutomatedPricing: false,
    fetchedAt: "2026-08-27T00:00:00.000Z",
    requestId: null,
    issues: [],
    fulfillmentAvailability: [{
      channelCode: "AMAZON_DEMO",
      quantity: 1,
      fulfillment: "FBA",
      editable: false,
    }],
    notice: null,
  };
}

function previousValues(observation: ListingContentGatewayRead) {
  return {
    title: observation.snapshot.title,
    itemHighlight: observation.snapshot.itemHighlight,
    bulletPoints: [...observation.snapshot.bulletPoints],
    productDescription: observation.snapshot.productDescription,
    ingredients: observation.snapshot.ingredients,
  };
}

function patchFor(
  observation: ListingContentGatewayRead,
): ListingContentPatchDescriptor {
  const previous = previousValues(observation);
  return {
    ...IDENTITY,
    asin: observation.snapshot.asin!,
    productType: observation.snapshot.productType,
    languageTag: observation.snapshot.languageTag,
    schemaChecksum: observation.snapshot.capabilities.schemaChecksum!,
    expectedOldHash: canonicalSha256(previous),
    expectedCanonicalPatchHash: null,
    previous,
    requested: { ...previous, title: "Updated title" },
    changedFields: ["title"],
    sourceEvidence: observation.sourceEvidence,
    ptdEvidence: observation.ptdEvidence,
  };
}

function writePort(overrides: Partial<ListingsWriteProduction> = {}) {
  return {
    validationPreview: vi.fn(async () => ({
      ok: true,
      status: 200,
      requestId: "CONTENT-PREVIEW",
      retryAfter: null,
      payload: {
        sku: IDENTITY.sellerSku,
        status: "VALID",
        submissionId: "CONTENT-PREVIEW-SUBMISSION",
        identifiers: [{
          marketplaceId: IDENTITY.marketplaceId,
          asin: ASIN,
        }],
        issues: [],
      },
    })),
    commitOnce: vi.fn(async () => ({
      ok: true,
      status: 202,
      requestId: "CONTENT-COMMIT",
      retryAfter: null,
      payload: {
        sku: IDENTITY.sellerSku,
        status: "ACCEPTED",
        submissionId: "CONTENT-COMMIT-SUBMISSION",
        issues: [],
      },
    })),
    ...overrides,
  } satisfies ListingsWriteProduction;
}

describe("Listing Content production gateway runtime", () => {
  it("owns exact live evidence, patch construction and fixed write delegation", async () => {
    let previewCommand: ListingsValidationPreviewCommand | null = null;
    let commitCommand: ListingsCommitOnceCommand | null = null;
    const order: string[] = [];
    const write = writePort({
      validationPreview: vi.fn(async (command) => {
        previewCommand = command;
        return {
          ok: true,
          status: 200,
          requestId: "CONTENT-PREVIEW",
          retryAfter: null,
          payload: {
            sku: IDENTITY.sellerSku,
            status: "VALID",
            submissionId: "CONTENT-PREVIEW-SUBMISSION",
            identifiers: [{
              marketplaceId: IDENTITY.marketplaceId,
              asin: ASIN,
            }],
            issues: [],
          },
        };
      }),
      commitOnce: vi.fn(async (command) => {
        commitCommand = command;
        await command.assertBeforeSend();
        await command.recordBeforeSend?.();
        await command.assertBeforeSend();
        return {
          ok: true,
          status: 202,
          requestId: "CONTENT-COMMIT",
          retryAfter: null,
          payload: {
            sku: IDENTITY.sellerSku,
            status: "ACCEPTED",
            submissionId: "CONTENT-COMMIT-SUBMISSION",
            issues: [],
          },
        };
      }),
    });
    const contentReads = {
      read: vi.fn(async () => ({
        listing: liveSnapshot(),
        payload: livePayload(),
      })),
    };
    const runtime = createListingContentGatewayProduction({
      contentReads,
      readDemoListing: () => demoListing(),
      resolveMode: () => "live",
      credentialGeneration: () => 1,
      write,
    });

    const observation = await runtime.gateway.read(IDENTITY, "mutation");
    const previewPatch = patchFor(observation);
    const preview = await runtime.gateway.validationPreview(previewPatch);
    const commitPatch = {
      ...previewPatch,
      expectedCanonicalPatchHash: preview.canonicalPatchHash,
    };
    const receipt = await runtime.gateway.commitOnce(
      commitPatch,
      { assertCurrent: async () => { order.push("fence"); } },
      async () => { order.push("record"); },
    );

    expect(contentReads.read).toHaveBeenCalledWith({
      ...IDENTITY,
      allowReadOnlySchema: false,
      forceCapabilityRefresh: true,
    });
    const exactBody = {
      productType: PRODUCT_TYPE,
      patches: [{
        op: "replace",
        path: "/attributes/item_name",
        value: [{
          value: "既存の商品名",
          language_tag: "ja_JP",
          marketplace_id: IDENTITY.marketplaceId,
        }, {
          value: "Updated title",
          language_tag: LANGUAGE_TAG,
          marketplace_id: IDENTITY.marketplaceId,
        }],
      }],
    };
    expect(previewCommand).toMatchObject({
      ...IDENTITY,
      patchBody: exactBody,
      includeIdentifiers: true,
    });
    expect(commitCommand).toMatchObject({
      ...IDENTITY,
      patchBody: exactBody,
    });
    expect(order).toEqual(["fence", "record", "fence"]);
    expect(receipt).toMatchObject({
      status: "ACCEPTED",
      submissionId: "CONTENT-COMMIT-SUBMISSION",
      requestId: "CONTENT-COMMIT",
    });
  });

  it("owns demo contribution state and clears it without live reads", async () => {
    const contentReads = { read: vi.fn() };
    const write = writePort();
    const runtime = createListingContentGatewayProduction({
      contentReads,
      readDemoListing: () => demoListing(),
      resolveMode: () => "demo",
      credentialGeneration: () => 4,
      write,
    });
    const observation = await runtime.gateway.read(IDENTITY, "mutation");
    const previewPatch = patchFor(observation);
    const preview = await runtime.gateway.validationPreview(previewPatch);

    await runtime.gateway.replaceDemoContent({
      ...previewPatch,
      expectedCanonicalPatchHash: preview.canonicalPatchHash,
    }, { assertCurrent: vi.fn(async () => undefined) });

    expect(runtime.readDemo(IDENTITY).title).toBe("Updated title");
    expect(contentReads.read).not.toHaveBeenCalled();
    expect(write.validationPreview).not.toHaveBeenCalled();
    runtime.clear();
    expect(runtime.readDemo(IDENTITY).title).toBe("Demo title");
  });

  it("invalidates opaque mutation evidence on credential generation drift", async () => {
    let generation = 7;
    const runtime = createListingContentGatewayProduction({
      contentReads: { read: vi.fn() },
      readDemoListing: () => demoListing(),
      resolveMode: () => "demo",
      credentialGeneration: () => generation,
      write: writePort(),
    });
    const observation = await runtime.gateway.read(IDENTITY, "mutation");
    const patch = patchFor(observation);
    generation += 1;

    await expect(runtime.gateway.validationPreview(patch)).rejects
      .toMatchObject({
        status: 409,
        code: "CREDENTIALS_CHANGED",
      });
  });
});
