import { describe, expect, it, vi } from "vitest";
import {
  createListingContentCapabilities,
} from "../src/main/amazon/listing-content-capabilities";
import type {
  ListingsReadAdapter,
  ProductTypeDefinitionReadResult,
} from "../src/main/amazon/listings-reads";
import type { MarketplaceId } from "../src/shared/marketplaces";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as MarketplaceId;

function definition(
  plan: Parameters<ListingsReadAdapter["readDefinition"]>[0],
): ProductTypeDefinitionReadResult {
  return {
    identity: {
      operation: "definition",
      intent: "content-write",
      marketplaceId: plan.marketplaceId,
      productType: plan.productType,
    },
    status: 200,
    envelope: {
      productType: plan.productType,
      marketplaceIds: [plan.marketplaceId],
      schema: {
        link: { resource: "https://example.invalid/content-schema.json" },
        checksum: `checksum-${plan.productType}`,
      },
    },
    requestId: `request-${plan.productType}`,
    rateLimit: null,
    retryAfter: null,
    schemaEnvelope: { type: "object", properties: {} },
    schemaBytes: new Uint8Array([1]),
    sellerSpecific: true,
  };
}

describe("Listing Content capability refresh scope", () => {
  it.each(["editable", "readonly", "absent"] as const)("uses the exact tenth-image PTD capability: %s", async availability => {
    const owner = createListingContentCapabilities({
      listingsReadAdapter: { readDefinition: async plan => ({
        ...definition(plan),
        schemaEnvelope: { type: "object", properties: availability === "absent" ? {} : {
          other_product_image_locator_9: { type: "array", items: { type: "object", properties: { media_location: { type: "string", editable: availability === "editable" } } } },
        } },
      }) },
      getCredentialGeneration: () => 7,
      getSellerId: () => "SELLER-ONE",
    });
    const result = await owner.read({ marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD", forceRefresh: true });
    expect(result.capabilities.images).toHaveLength(10);
    expect(result.capabilities.images[9]).toMatchObject({ attributeName: "other_product_image_locator_9", supported: availability !== "absent", editable: availability === "editable" });
  });

  it("single-flights one product type inside a phase and refreshes again for the next phase", async () => {
    const readDefinition = vi.fn<ListingsReadAdapter["readDefinition"]>(
      async (plan) => {
        await Promise.resolve();
        return definition(plan);
      },
    );
    const owner = createListingContentCapabilities({
      listingsReadAdapter: { readDefinition },
      getCredentialGeneration: () => 7,
      getSellerId: () => "SELLER-ONE",
    });
    const initialPhase = {};

    const [first, second] = await Promise.all([
      owner.read({
        marketplaceId: MARKETPLACE_ID,
        productType: "PET_FOOD",
        forceRefresh: true,
        refreshScope: initialPhase,
      }),
      owner.read({
        marketplaceId: MARKETPLACE_ID,
        productType: "PET_FOOD",
        forceRefresh: true,
        refreshScope: initialPhase,
      }),
    ]);

    expect(first).toEqual(second);
    expect(readDefinition).toHaveBeenCalledTimes(1);

    await owner.read({
      marketplaceId: MARKETPLACE_ID,
      productType: "PET_FOOD",
      forceRefresh: true,
      refreshScope: {},
    });
    expect(readDefinition).toHaveBeenCalledTimes(2);
  });
});
