import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ListingContentReadProduction } from
  "../src/main/amazon/listing-content-read-production";
import type { ListingContentSnapshot } from
  "../src/main/amazon/listing-content-types";
import type {
  ListingImageGatewayRead,
  ListingImagePatchDescriptor,
  ListingImageUrlVector,
} from "../src/main/amazon/listing-image-gateway";
import { createListingImageGatewayProduction } from
  "../src/main/amazon/listing-image-gateway-production";
import type { AmazonListingItem } from
  "../src/main/amazon/listing-item-projection";
import type {
  ListingsCommitOnceCommand,
  ListingsValidationPreviewCommand,
  ListingsWriteProduction,
  ListingsWriteReceipt,
} from "../src/main/amazon/listings-write-production";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const SELLER_SKU = "IMAGE-FBA-SKU-01";
const IDENTITY = { marketplaceId: MARKETPLACE_ID, sellerSku: SELLER_SKU };

const RECEIPT: ListingsWriteReceipt = {
  ok: true,
  status: 202,
  requestId: "image-request-1",
  retryAfter: null,
  payload: { submissionId: "image-submission-1" },
};

function imageCapability(attributeName: string, index: number) {
  return {
    attributeName,
    label: index === 0 ? "主圖" : `副圖 ${index}`,
    supported: true,
    editable: true,
    required: index === 0,
    reason: null,
  };
}

function contentSnapshot(
  mode: "live" | "demo",
): ListingContentSnapshot {
  const imageNames = [
    "main_product_image_locator",
    "other_product_image_locator_1",
    "other_product_image_locator_2",
    "other_product_image_locator_3",
    "other_product_image_locator_4",
    "other_product_image_locator_5",
    "other_product_image_locator_6",
    "other_product_image_locator_7",
    "other_product_image_locator_8",
  ];
  const field = {
    supported: true,
    editable: true,
    required: false,
    minItems: null,
    maxItems: null,
    minLength: null,
    maxLength: null,
    maxUtf8Bytes: null,
    languageTags: ["en_US"],
    reason: null,
  };
  return {
    mode,
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SELLER_SKU,
    asin: "B012345678",
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    title: "Image listing",
    itemHighlight: "",
    bulletPoints: [],
    productDescription: "",
    ingredients: "",
    languageTag: "en_US",
    attributePresence: {
      title: true,
      itemHighlight: false,
      bulletPoints: false,
      productDescription: false,
      ingredients: false,
    },
    capabilities: {
      title: field,
      itemHighlight: field,
      bulletPoints: field,
      productDescription: field,
      ingredients: field,
      images: imageNames.map(imageCapability),
      schemaChecksum: "image-schema",
    },
    createdAt: null,
    updatedAt: null,
    fetchedAt: "2026-08-27T00:00:00.000Z",
    requestId: mode === "live" ? "listing-request-1" : null,
    issues: [],
    notice: mode === "live" ? null : "Demo content",
  };
}

function livePayload(
  attributes: AmazonListingItem["attributes"] = {
    main_product_image_locator: [{
      marketplace_id: MARKETPLACE_ID,
      media_location: "https://images.example.test/main.jpg",
    }],
    other_product_image_locator_1: [{
      marketplace_id: MARKETPLACE_ID,
      media_location: "https://images.example.test/alternate.jpg",
      media_content_type: "image/jpeg",
      private_locator_metadata: "preserve-me",
    }],
  },
): AmazonListingItem {
  return {
    sku: SELLER_SKU,
    attributes,
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 8,
    }],
  };
}

function harness() {
  let mode: "live" | "demo" = "demo";
  let generation = 0;
  let payload = livePayload();
  const contentRead = vi.fn(async () => ({
    listing: contentSnapshot("live"),
    payload,
  }));
  const previewCommands: ListingsValidationPreviewCommand[] = [];
  const commitCommands: ListingsCommitOnceCommand[] = [];
  const write: ListingsWriteProduction = {
    validationPreview: async (command) => {
      previewCommands.push(command);
      return RECEIPT;
    },
    commitOnce: async (command) => {
      commitCommands.push(command);
      return RECEIPT;
    },
  };
  const runtime = createListingImageGatewayProduction({
    contentReads: { read: contentRead } satisfies ListingContentReadProduction,
    readDemoContent: () => contentSnapshot("demo"),
    resolveMode: () => mode,
    credentialGeneration: () => generation,
    write,
  });
  return {
    runtime,
    contentRead,
    previewCommands,
    commitCommands,
    setMode(nextMode: "live" | "demo") {
      mode = nextMode;
    },
    setGeneration(nextGeneration: number) {
      generation = nextGeneration;
    },
    setPayload(nextPayload: AmazonListingItem) {
      payload = nextPayload;
    },
  };
}

function urlVector(values: readonly (string | null)[]): ListingImageUrlVector {
  return Array.from({ length: 9 }, (_, index) => values[index] ?? null) as
    unknown as ListingImageUrlVector;
}

function descriptor(
  observation: ListingImageGatewayRead,
  requestedUrls: ListingImageUrlVector,
): ListingImagePatchDescriptor {
  const previousUrls = urlVector(
    observation.snapshot.images.map((image) => image.url),
  );
  const changes = requestedUrls.flatMap((requestedUrl, index) =>
    requestedUrl === previousUrls[index]
      ? []
      : [{
          slot: index as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
          previousUrl: previousUrls[index] ?? null,
          requestedUrl,
        }]
  );
  return {
    ...IDENTITY,
    asin: observation.snapshot.asin!,
    productType: observation.snapshot.productType,
    expectedOldHash: createHash("sha256")
      .update(JSON.stringify(previousUrls))
      .digest("hex"),
    previousUrls,
    requestedUrls,
    changes,
    sourceEvidence: observation.sourceEvidence,
  };
}

describe("Listing Image production gateway", () => {
  it("reads canonical current-market image locators through the content port", async () => {
    const state = harness();
    state.setMode("live");

    const observation = await state.runtime.gateway.read(
      IDENTITY,
      "read-only",
    );

    expect(state.contentRead).toHaveBeenCalledWith({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      allowReadOnlySchema: true,
    });
    expect(observation).toMatchObject({
      fulfillment: "FBA",
      snapshot: {
        mode: "live",
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        attributesPresent: true,
        notice:
          "圖片 URL 取自 Listing attributes；Amazon 接受後仍會非同步下載與審核。",
      },
    });
    expect(observation.snapshot.images.map((image) => image.url)).toEqual([
      "https://images.example.test/main.jpg",
      "https://images.example.test/alternate.jpg",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("fails closed on ambiguous or non-canonical locator evidence", async () => {
    const state = harness();
    state.setMode("live");

    state.setPayload(livePayload({
      main_product_image_locator: "not-an-array" as unknown as never[],
    }));
    await expect(state.runtime.gateway.read(IDENTITY, "mutation"))
      .rejects.toMatchObject({ code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" });

    state.setPayload(livePayload({
      main_product_image_locator: [{
        marketplace_id: ` ${MARKETPLACE_ID} `,
        media_location: "https://images.example.test/main.jpg",
      }],
    }));
    await expect(state.runtime.gateway.read(IDENTITY, "mutation"))
      .rejects.toMatchObject({ code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" });

    state.setPayload(livePayload({
      main_product_image_locator: [
        {
          marketplace_id: MARKETPLACE_ID,
          media_location: "https://images.example.test/main-1.jpg",
        },
        {
          marketplace_id: MARKETPLACE_ID,
          media_location: "https://images.example.test/main-2.jpg",
        },
      ],
    }));
    await expect(state.runtime.gateway.read(IDENTITY, "mutation"))
      .rejects.toMatchObject({ code: "LISTING_IMAGE_EVIDENCE_AMBIGUOUS" });
  });

  it("keeps raw delete evidence private while mapping fixed preview and commit commands", async () => {
    const state = harness();
    state.setMode("live");
    const observation = await state.runtime.gateway.read(IDENTITY, "mutation");
    const requested = urlVector([
      "https://images.example.test/replacement-main.jpg",
      null,
      "https://images.example.test/new-third.jpg",
    ]);
    const patch = descriptor(observation, requested);
    const fence = vi.fn(async () => undefined);

    await expect(state.runtime.gateway.validationPreview(patch))
      .resolves.toEqual(RECEIPT);
    await expect(state.runtime.gateway.commitOnce(patch, {
      assertCurrent: fence,
    })).resolves.toEqual(RECEIPT);

    const expectedBody = {
      productType: "PET_FOOD",
      patches: [
        {
          op: "replace",
          path: "/attributes/main_product_image_locator",
          value: [{
            media_location:
              "https://images.example.test/replacement-main.jpg",
            marketplace_id: MARKETPLACE_ID,
          }],
        },
        {
          op: "delete",
          path: "/attributes/other_product_image_locator_1",
          value: [{
            marketplace_id: MARKETPLACE_ID,
            media_location: "https://images.example.test/alternate.jpg",
            media_content_type: "image/jpeg",
            private_locator_metadata: "preserve-me",
          }],
        },
        {
          op: "add",
          path: "/attributes/other_product_image_locator_2",
          value: [{
            media_location: "https://images.example.test/new-third.jpg",
            marketplace_id: MARKETPLACE_ID,
          }],
        },
      ],
    };
    expect(state.previewCommands).toEqual([{
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      patchBody: expectedBody,
    }]);
    expect(state.commitCommands[0]).toMatchObject({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      patchBody: expectedBody,
    });
    expect(JSON.stringify(patch)).not.toContain("preserve-me");
    await state.commitCommands[0].assertBeforeSend();
    expect(fence).toHaveBeenCalledOnce();
  });

  it("rejects read-only, forged and structurally changed evidence", async () => {
    const state = harness();
    state.setMode("live");
    const readOnly = await state.runtime.gateway.read(IDENTITY, "read-only");
    const requested = urlVector([
      "https://images.example.test/replacement-main.jpg",
      "https://images.example.test/alternate.jpg",
    ]);
    await expect(state.runtime.gateway.validationPreview(
      descriptor(readOnly, requested),
    )).rejects.toMatchObject({ code: "LISTING_IMAGE_EVIDENCE_INVALID" });

    const mutation = await state.runtime.gateway.read(IDENTITY, "mutation");
    const valid = descriptor(mutation, requested);
    await expect(state.runtime.gateway.validationPreview({
      ...valid,
      expectedOldHash: "forged-hash",
    })).rejects.toMatchObject({ code: "LISTING_IMAGE_EVIDENCE_INVALID" });
    expect(state.previewCommands).toEqual([]);
  });

  it("round-trips demo images and clear removes only demo contributions", async () => {
    const state = harness();
    const observation = await state.runtime.gateway.read(IDENTITY, "mutation");
    const requested = urlVector([
      " https://images.example.test/demo-main.jpg ",
      "https://images.example.test/demo-alt.jpg",
    ]);

    await state.runtime.gateway.replaceDemoImages(
      descriptor(observation, requested),
      { assertCurrent: async () => undefined },
    );
    expect((await state.runtime.gateway.read(
      IDENTITY,
      "read-only",
    )).snapshot.images.map((image) => image.url)).toEqual([
      "https://images.example.test/demo-main.jpg",
      "https://images.example.test/demo-alt.jpg",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);

    state.runtime.clear();
    expect((await state.runtime.gateway.read(
      IDENTITY,
      "read-only",
    )).snapshot.images.every((image) => image.url === null)).toBe(true);
  });

  it("rejects stale evidence before a live write", async () => {
    const state = harness();
    state.setMode("live");
    const observation = await state.runtime.gateway.read(IDENTITY, "mutation");
    const requested = urlVector([
      "https://images.example.test/replacement-main.jpg",
      "https://images.example.test/alternate.jpg",
    ]);
    state.setGeneration(1);

    await expect(state.runtime.gateway.validationPreview(
      descriptor(observation, requested),
    )).rejects.toMatchObject({ code: "CREDENTIALS_CHANGED" });
    expect(state.previewCommands).toEqual([]);
  });

  it("does not publish demo images when generation changes across the final fence", async () => {
    const state = harness();
    const observation = await state.runtime.gateway.read(IDENTITY, "mutation");
    const requested = urlVector([
      "https://images.example.test/demo-main.jpg",
    ]);

    await expect(state.runtime.gateway.replaceDemoImages(
      descriptor(observation, requested),
      {
        assertCurrent: async () => {
          state.setGeneration(1);
        },
      },
    )).rejects.toMatchObject({ code: "CREDENTIALS_CHANGED" });
    expect((await state.runtime.gateway.read(
      IDENTITY,
      "read-only",
    )).snapshot.images.every((image) => image.url === null)).toBe(true);
  });
});
