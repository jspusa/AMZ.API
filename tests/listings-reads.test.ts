import { describe, expect, it } from "vitest";
import {
  createScriptedListingsReadAdapter,
  readListingsItem,
  readProductTypeDefinition,
  searchListingsItems,
} from "../src/main/amazon/listings-reads";

const US = "ATVPDKIKX0DER" as const;

const TRANSPORT_KEYS = [
  "url",
  "host",
  "path",
  "method",
  "query",
  "headers",
  "body",
  "includedData",
  "region",
  "sellerId",
  "schemaUrl",
  "forceTokenRefresh",
] as const;

describe("fixed Listings reads", () => {
  it("records a semantic item plan and preserves the raw fixture envelope", async () => {
    const envelope = {
      sku: "EXACT-SKU",
      summaries: [
        {
          marketplaceId: US,
          asin: "B000000001",
          productType: "PET_FOOD",
        },
      ],
      fulfillmentAvailability: [
        { fulfillmentChannelCode: "AMAZON_NA", quantity: 7 },
      ],
      attributes: {
        bullet_point: [null, { value: "kept raw" }, { value: "kept raw" }],
        unknown_future_field: { nested: true },
      },
      unknownTopLevel: null,
    };
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope,
          requestId: "request-item",
          rateLimit: "5",
          retryAfter: null,
          profile: "full",
        },
      },
    ]);

    const result = await readListingsItem(adapter, {
      intent: "listing",
      marketplaceId: US,
      sellerSku: "EXACT-SKU",
    });

    expect(adapter.requests).toEqual([
      {
        operation: "item",
        intent: "listing",
        marketplaceId: US,
        sellerSku: "EXACT-SKU",
      },
    ]);
    for (const key of TRANSPORT_KEYS) {
      expect(adapter.requests[0]).not.toHaveProperty(key);
    }
    expect(result.envelope).toEqual(envelope);
    expect(result.envelope).not.toBe(envelope);
  });

  it("keeps search and definition plans closed to their known semantic inputs", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: { items: [], numberOfResults: 0 },
          requestId: "request-search",
          rateLimit: null,
          retryAfter: null,
          profile: "listing",
        },
      },
      {
        operation: "definition",
        result: {
          status: 200,
          envelope: {
            productType: "PET_FOOD",
            marketplaceIds: [US],
            schema: {
              link: { resource: "https://example.invalid/schema.json" },
            },
          },
          schemaEnvelope: {
            type: "object",
            properties: { item_name: { type: "array" } },
          },
          schemaBytes: null,
          requestId: "request-definition",
          rateLimit: null,
          retryAfter: null,
          sellerSpecific: true,
        },
      },
    ]);

    await searchListingsItems(adapter, {
      intent: "sku-batch",
      marketplaceId: US,
      sellerSkus: ["SKU-A", "SKU-B"],
    });
    const definition = await readProductTypeDefinition(adapter, {
      intent: "content-read",
      marketplaceId: US,
      productType: "PET_FOOD",
    });

    expect(adapter.requests).toEqual([
      {
        operation: "search",
        intent: "sku-batch",
        marketplaceId: US,
        sellerSkus: ["SKU-A", "SKU-B"],
      },
      {
        operation: "definition",
        intent: "content-read",
        marketplaceId: US,
        productType: "PET_FOOD",
      },
    ]);
    for (const request of adapter.requests) {
      for (const key of TRANSPORT_KEYS) expect(request).not.toHaveProperty(key);
    }
    expect(definition.schemaEnvelope).toEqual({
      type: "object",
      properties: { item_name: { type: "array" } },
    });
  });

  it("fails closed when a scripted result is bound to a different semantic identity", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          identity: {
            operation: "item",
            intent: "listing",
            marketplaceId: US,
            sellerSku: "OTHER-SKU",
          },
          status: 200,
          envelope: { sku: "EXACT-SKU" },
          requestId: null,
          rateLimit: null,
          retryAfter: null,
          profile: "full",
        },
      },
    ]);

    await expect(
      readListingsItem(adapter, {
        intent: "listing",
        marketplaceId: US,
        sellerSku: "EXACT-SKU",
      }),
    ).rejects.toMatchObject({
      name: "SpApiError",
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("rejects unknown runtime intents before an adapter can interpret them", async () => {
    const adapter = createScriptedListingsReadAdapter([]);
    const invalidInput = {
      marketplaceId: US,
      intent: "arbitrary-amazon-request",
    };

    await expect(
      readListingsItem(adapter, {
        ...invalidInput,
        sellerSku: "EXACT-SKU",
      } as unknown as Parameters<typeof readListingsItem>[1]),
    ).rejects.toMatchObject({
      name: "SpApiError",
      status: 400,
      code: "INVALID_INPUT",
    });
    await expect(
      searchListingsItems(
        adapter,
        invalidInput as unknown as Parameters<typeof searchListingsItems>[1],
      ),
    ).rejects.toMatchObject({
      name: "SpApiError",
      status: 400,
      code: "INVALID_INPUT",
    });
    await expect(
      readProductTypeDefinition(adapter, {
        ...invalidInput,
        productType: "PET_FOOD",
      } as unknown as Parameters<typeof readProductTypeDefinition>[1]),
    ).rejects.toMatchObject({
      name: "SpApiError",
      status: 400,
      code: "INVALID_INPUT",
    });
    expect(adapter.requests).toEqual([]);
  });

  it("runs scripted raw item envelopes through exact identity normalization", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: {
            sku: "OTHER-SKU",
            summaries: [{
              marketplaceId: US,
              asin: "B000000001",
              productType: "PET_FOOD",
            }],
          },
          requestId: "wrong-item",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    await expect(readListingsItem(adapter, {
      intent: "variation-evidence",
      marketplaceId: US,
      sellerSku: "EXACT-SKU",
    })).rejects.toMatchObject({
      name: "SpApiError",
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(adapter.requests).toEqual([{
      operation: "item",
      intent: "variation-evidence",
      marketplaceId: US,
      sellerSku: "EXACT-SKU",
    }]);
  });

  it("rejects a scripted variation child that is not bound to the requested parent", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            items: [{
              sku: "CHILD-SKU",
              summaries: [{
                marketplaceId: US,
                asin: "B000000002",
                productType: "PET_FOOD",
              }],
              relationships: [{
                marketplaceId: US,
                relationships: [{ parentSkus: ["OTHER-PARENT"] }],
              }],
            }],
          },
          requestId: "wrong-parent",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    await expect(searchListingsItems(adapter, {
      intent: "variation-children",
      marketplaceId: US,
      parentSku: "EXACT-PARENT",
    })).rejects.toMatchObject({
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
  });

  it("rejects a scripted PTD for another Product Type or a generic write result", async () => {
    const wrongProductType = createScriptedListingsReadAdapter([
      {
        operation: "definition",
        result: {
          status: 200,
          envelope: {
            productType: "OTHER",
            marketplaceIds: [US],
            schema: { link: { resource: "https://example.invalid/other.json" } },
          },
          schemaEnvelope: { type: "object", properties: {} },
          schemaBytes: null,
          requestId: "wrong-ptd",
          rateLimit: null,
          retryAfter: null,
          sellerSpecific: true,
        },
      },
    ]);
    await expect(readProductTypeDefinition(wrongProductType, {
      intent: "content-read",
      marketplaceId: US,
      productType: "PET_FOOD",
    })).rejects.toMatchObject({
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });

    const genericWrite = createScriptedListingsReadAdapter([
      {
        operation: "definition",
        result: {
          status: 200,
          envelope: {
            productType: "PET_FOOD",
            marketplaceIds: [US],
            schema: { link: { resource: "https://example.invalid/write.json" } },
          },
          schemaEnvelope: { type: "object", properties: {} },
          schemaBytes: null,
          requestId: "generic-write",
          rateLimit: null,
          retryAfter: null,
          sellerSpecific: false,
        },
      },
    ]);
    await expect(readProductTypeDefinition(genericWrite, {
      intent: "content-write",
      marketplaceId: US,
      productType: "PET_FOOD",
    })).rejects.toMatchObject({
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});
