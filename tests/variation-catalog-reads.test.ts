import { describe, expect, it } from "vitest";
import {
  createScriptedListingsReadAdapter,
} from "../src/main/amazon/listings-reads";
import {
  readFbaVariationGroupingData,
  readVariationFamily,
  readVariationItem,
} from "../src/main/amazon/variation-catalog-reads";

const US = "ATVPDKIKX0DER" as const;
const CHILD_SKU = "EXACT-CHILD-ONE";
const OMITTED_CHILD_SKU = "EXACT-CHILD-TWO";
const PARENT_SKU = "EXACT-PARENT";

function childEnvelope(sellerSku: string, asin: string) {
  return {
    sku: sellerSku,
    summaries: [{
      marketplaceId: US,
      asin,
      productType: "PET_FOOD",
      itemName: sellerSku,
    }],
    productTypes: [{ marketplaceId: US, productType: "PET_FOOD" }],
    relationships: [{
      marketplaceId: US,
      relationships: [{
        parentSkus: [PARENT_SKU],
        variationTheme: {
          theme: "SIZE_NAME",
          attributes: ["size_name"],
        },
      }],
    }],
    attributes: {
      parentage_level: [{ value: "child" }],
      child_parent_sku_relationship: [{ parent_sku: PARENT_SKU }],
      variation_theme: [{ name: "SIZE_NAME" }],
      size_name: [{ value: sellerSku === CHILD_SKU ? "4 oz" : "8 oz" }],
    },
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 1,
    }],
    issues: [],
  };
}

function parentEnvelope() {
  return {
    sku: PARENT_SKU,
    summaries: [{
      marketplaceId: US,
      asin: "B000000003",
      productType: "PET_FOOD",
      itemName: PARENT_SKU,
    }],
    productTypes: [{ marketplaceId: US, productType: "PET_FOOD" }],
    relationships: [{
      marketplaceId: US,
      relationships: [{
        childSkus: [CHILD_SKU, OMITTED_CHILD_SKU],
        variationTheme: {
          theme: "SIZE_NAME",
          attributes: ["size_name"],
        },
      }],
    }],
    attributes: {
      parentage_level: [{ value: "parent" }],
      variation_theme: [{ name: "SIZE_NAME" }],
    },
    fulfillmentAvailability: [],
    issues: [],
  };
}

function standaloneEnvelope(
  sellerSku: string,
  asin: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    sku: sellerSku,
    summaries: [{
      marketplaceId: US,
      asin,
      productType: "PET_FOOD",
      itemName: sellerSku,
    }],
    productTypes: [{ marketplaceId: US, productType: "PET_FOOD" }],
    relationships: [],
    attributes: {},
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 1,
    }],
    issues: [],
    ...overrides,
  };
}

describe("Variation catalog reads", () => {
  it("keeps an exact family incomplete when a parent-declared child is absent from fixed Listings reads", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: childEnvelope(CHILD_SKU, "B000000001"),
          requestId: "queried-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "item",
        result: {
          status: 200,
          envelope: parentEnvelope(),
          requestId: "parent-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            items: [childEnvelope(CHILD_SKU, "B000000001")],
            pagination: {},
          },
          requestId: "children-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    const snapshot = await readVariationFamily(adapter, {
      marketplaceId: US,
      sellerSku: CHILD_SKU,
    });

    expect(adapter.requests).toEqual([
      {
        operation: "item",
        intent: "variation-evidence",
        marketplaceId: US,
        sellerSku: CHILD_SKU,
      },
      {
        operation: "item",
        intent: "variation-evidence",
        marketplaceId: US,
        sellerSku: PARENT_SKU,
      },
      {
        operation: "search",
        intent: "variation-children",
        marketplaceId: US,
        parentSku: PARENT_SKU,
        pageToken: null,
      },
    ]);
    expect(snapshot).toMatchObject({
      mode: "live",
      marketplaceId: US,
      queriedSku: CHILD_SKU,
      queriedRole: "child",
      writable: false,
      familyComplete: false,
      parent: { sellerSku: PARENT_SKU, role: "parent" },
    });
    expect(snapshot.children.map(({ sellerSku }) => sellerSku)).toEqual([
      CHILD_SKU,
    ]);
    expect(snapshot.children).not.toContainEqual(
      expect.objectContaining({ sellerSku: OMITTED_CHILD_SKU }),
    );
  });

  it("rejects a referenced parent whose own exact evidence is not parent", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: childEnvelope(CHILD_SKU, "B000000001"),
          requestId: "queried-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "item",
        result: {
          status: 200,
          envelope: {
            ...parentEnvelope(),
            relationships: [],
            attributes: { variation_theme: [{ name: "SIZE_NAME" }] },
          },
          requestId: "not-parent-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    await expect(readVariationFamily(adapter, {
      marketplaceId: US,
      sellerSku: CHILD_SKU,
    })).rejects.toMatchObject({
      name: "SpApiError",
      status: 409,
      code: "VARIATION_RELATIONSHIP_CONFLICT",
      requestId: "not-parent-request",
    });
    expect(adapter.requests).toHaveLength(2);
  });

  it("fails closed when child pagination repeats a Seller SKU across pages", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: childEnvelope(CHILD_SKU, "B000000001"),
          requestId: "queried-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "item",
        result: {
          status: 200,
          envelope: parentEnvelope(),
          requestId: "parent-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            items: [childEnvelope(CHILD_SKU, "B000000001")],
            pagination: { nextToken: "PAGE-TWO" },
          },
          requestId: "children-page-one",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            items: [childEnvelope(CHILD_SKU, "B000000001")],
            pagination: {},
          },
          requestId: "children-page-two",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    await expect(readVariationFamily(adapter, {
      marketplaceId: US,
      sellerSku: CHILD_SKU,
    })).rejects.toMatchObject({
      name: "SpApiError",
      status: 409,
      code: "PAGINATION_CHANGED",
      requestId: "children-page-two",
    });
  });

  it("fails closed when Amazon repeats an opaque child page token", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: childEnvelope(CHILD_SKU, "B000000001"),
          requestId: "queried-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "item",
        result: {
          status: 200,
          envelope: parentEnvelope(),
          requestId: "parent-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            items: [childEnvelope(CHILD_SKU, "B000000001")],
            pagination: { nextToken: "REPEATED-PAGE" },
          },
          requestId: "children-page-one",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            items: [childEnvelope(OMITTED_CHILD_SKU, "B000000002")],
            pagination: { nextToken: "REPEATED-PAGE" },
          },
          requestId: "children-page-two",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    await expect(readVariationFamily(adapter, {
      marketplaceId: US,
      sellerSku: CHILD_SKU,
    })).rejects.toMatchObject({
      name: "SpApiError",
      status: 409,
      code: "PAGINATION_CHANGED",
      requestId: "children-page-two",
    });
  });

  it("does not trim or reinterpret an opaque child page token", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: childEnvelope(CHILD_SKU, "B000000001"),
          requestId: "queried-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "item",
        result: {
          status: 200,
          envelope: parentEnvelope(),
          requestId: "parent-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            items: [childEnvelope(CHILD_SKU, "B000000001")],
            pagination: { nextToken: " PAGE-TWO" },
          },
          requestId: "children-page-one",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    await expect(readVariationFamily(adapter, {
      marketplaceId: US,
      sellerSku: CHILD_SKU,
    })).rejects.toMatchObject({
      name: "SpApiError",
      status: 409,
      code: "PAGINATION_CHANGED",
      requestId: "children-page-one",
    });
    expect(adapter.requests).toHaveLength(3);
  });

  it("never copies an upstream credential-like message into grouping rows", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 503,
          envelope: {
            errors: [{
              code: "INTERNAL",
              message: "refresh_token=DO_NOT_EXPOSE",
            }],
          },
          requestId: "safe-request-id",
          rateLimit: null,
          retryAfter: null,
          profile: "variation",
        },
      },
    ]);

    const grouped = await readFbaVariationGroupingData(adapter, {
      marketplaceId: US,
      rows: [{
        sellerSku: CHILD_SKU,
        asin: "B000000001",
        title: "Exact title is not relationship evidence",
      }],
    });

    expect(grouped.rows[0]).toMatchObject({
      sellerSku: CHILD_SKU,
      role: "unknown",
      status: "incomplete",
    });
    expect(grouped.rows[0]?.message).not.toContain("DO_NOT_EXPOSE");
    expect(JSON.stringify(grouped)).not.toContain("refresh_token");
  });

  it("does not certify a family when the terminal child count exceeds the canonical rows", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: childEnvelope(CHILD_SKU, "B000000001"),
          requestId: "queried-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "item",
        result: {
          status: 200,
          envelope: {
            ...parentEnvelope(),
            relationships: [{ marketplaceId: US, relationships: [] }],
          },
          requestId: "parent-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            items: [],
            pagination: {},
          },
          requestId: "children-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    const snapshot = await readVariationFamily(adapter, {
      marketplaceId: US,
      sellerSku: CHILD_SKU,
    });

    expect(snapshot.familyComplete).toBe(false);
  });

  it("does not copy a credential-like Listings issue into a successful family DTO", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: {
            ...childEnvelope(CHILD_SKU, "B000000001"),
            issues: [{
              code: "seller_id:A1234567890123",
              severity: "refresh_token:SECRET_VALUE",
              message: "refresh_token=DO_NOT_EXPOSE",
              attributeNames: [
                "variation_theme",
                "document_id:amzn1.spdoc.SECRET_VALUE",
              ],
            }],
          },
          requestId: "queried-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "item",
        result: {
          status: 200,
          envelope: parentEnvelope(),
          requestId: "parent-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            items: [childEnvelope(CHILD_SKU, "B000000001")],
            pagination: {},
          },
          requestId: "children-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    const snapshot = await readVariationFamily(adapter, {
      marketplaceId: US,
      sellerSku: CHILD_SKU,
    });

    expect(JSON.stringify(snapshot)).not.toContain("DO_NOT_EXPOSE");
    expect(JSON.stringify(snapshot)).not.toContain("refresh_token");
    expect(JSON.stringify(snapshot)).not.toContain("seller_id");
    expect(JSON.stringify(snapshot)).not.toContain("A1234567890123");
    expect(JSON.stringify(snapshot)).not.toContain("amzn1.spdoc");
    expect(snapshot.queried.issues).toMatchObject([{
      code: null,
      severity: "INFO",
      attributeNames: ["variation_theme"],
    }]);
  });

  it.each([
    ["relationships", { relationships: [null] }],
    ["fulfillment availability", { fulfillmentAvailability: [null] }],
    ["issues", { issues: [null] }],
  ])("maps malformed %s rows to a canonical SP-API error", async (_label, malformed) => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "item",
        result: {
          status: 200,
          envelope: {
            ...childEnvelope(CHILD_SKU, "B000000001"),
            ...malformed,
          },
          requestId: "malformed-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    await expect(readVariationItem(adapter, {
      marketplaceId: US,
      sellerSku: CHILD_SKU,
    })).rejects.toMatchObject({
      name: "SpApiError",
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: "malformed-request",
    });
  });

  it("keeps product-type and attributes-only relationship conflicts local to their exact batch rows", async () => {
    const rows = [
      { sellerSku: "VALID", asin: "B000000011", title: "Valid" },
      { sellerSku: "MISSING-PT", asin: "B000000012", title: "Missing PT" },
      { sellerSku: "CONFLICT-PT", asin: "B000000013", title: "Conflict PT" },
      { sellerSku: "ATTR-CHILD", asin: "B000000014", title: "Attribute Child" },
    ];
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 4,
            pagination: {},
            items: [
              standaloneEnvelope("VALID", "B000000011"),
              standaloneEnvelope("MISSING-PT", "B000000012", {
                summaries: [{ marketplaceId: US, asin: "B000000012" }],
                productTypes: undefined,
              }),
              standaloneEnvelope("CONFLICT-PT", "B000000013", {
                productTypes: [{
                  marketplaceId: US,
                  productType: "DOG_COLLAR",
                }],
              }),
              standaloneEnvelope("ATTR-CHILD", "B000000014", {
                attributes: {
                  parentage_level: [{ value: "child" }],
                  child_parent_sku_relationship: [{
                    parent_sku: "ATTR-PARENT",
                  }],
                },
              }),
            ],
          },
          requestId: "batch-request",
          rateLimit: null,
          retryAfter: null,
          profile: "variation",
        },
      },
    ]);

    const grouped = await readFbaVariationGroupingData(adapter, {
      marketplaceId: US,
      rows,
    });

    expect(grouped.rows).toMatchObject([
      { sellerSku: "VALID", role: "standalone", status: "complete" },
      { sellerSku: "MISSING-PT", role: "unknown", status: "incomplete" },
      { sellerSku: "CONFLICT-PT", role: "unknown", status: "incomplete" },
      { sellerSku: "ATTR-CHILD", role: "unknown", status: "incomplete" },
    ]);
  });

  it("rejects a variation batch result that is not bound to the production variation profile", async () => {
    const adapter = createScriptedListingsReadAdapter([
      {
        operation: "search",
        result: {
          status: 200,
          envelope: {
            numberOfResults: 1,
            pagination: {},
            items: [standaloneEnvelope("VALID", "B000000011")],
          },
          requestId: "wrong-profile-request",
          rateLimit: null,
          retryAfter: null,
          profile: "relationships",
        },
      },
    ]);

    const grouped = await readFbaVariationGroupingData(adapter, {
      marketplaceId: US,
      rows: [{ sellerSku: "VALID", asin: "B000000011", title: "Valid" }],
    });

    expect(grouped.rows).toMatchObject([
      { sellerSku: "VALID", role: "unknown", status: "incomplete" },
    ]);
  });
});
