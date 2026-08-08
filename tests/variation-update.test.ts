import { describe, expect, it } from "vitest";
import {
  assertVariationAttached,
  assertVariationDetached,
  buildVariationAttachBody,
  buildVariationDetachBody,
  VariationUpdateValidationError,
  variationDimensionSignature,
  variationFieldDescriptors,
  variationRelationshipSnapshot,
} from "../src/main/amazon/variation-update";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

const CHILD_SCHEMA = {
  type: "object",
  properties: {
    flavor_name: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "string" },
          language_tag: { type: "string" },
          marketplace_id: { type: "string" },
        },
      },
    },
    item_weight: {
      type: "array",
      minItems: 1,
      items: {
        allOf: [{ $ref: "#/$defs/dimension" }],
      },
    },
  },
  $defs: {
    dimension: {
      type: "object",
      required: ["value", "unit"],
      properties: {
        value: { type: "number" },
        unit: { type: "string", enum: ["ounces", "pounds"] },
        marketplace_id: { type: "string" },
      },
    },
  },
};

describe("variation update safety helpers", () => {
  it("derives editable CHILD fields from the live PTD without exposing context keys", () => {
    const fields = variationFieldDescriptors({
      productTypeDefinition: CHILD_SCHEMA,
      dimensionNames: ["flavor_name", "item_weight"],
      marketplaceId: MARKETPLACE_ID,
      attributes: {
        flavor_name: [
          {
            value: "Turkey",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        item_weight: [
          { value: 3.5, unit: "ounces", marketplace_id: MARKETPLACE_ID },
        ],
      },
    });

    expect(fields).toEqual([
      expect.objectContaining({
        name: "flavor_name",
        label: "Flavor Name",
        editable: true,
        jsonFallback: false,
        leaves: [
          expect.objectContaining({
            path: ["value"],
            type: "string",
            required: true,
            currentValue: "Turkey",
          }),
        ],
      }),
      expect.objectContaining({
        name: "item_weight",
        label: "Item Weight",
        leaves: [
          expect.objectContaining({
            path: ["value"],
            type: "number",
            required: true,
            currentValue: 3.5,
          }),
          expect.objectContaining({
            path: ["unit"],
            enumValues: ["ounces", "pounds"],
            required: true,
            currentValue: "ounces",
          }),
        ],
      }),
    ]);
    expect(fields.flatMap((field) => field.leaves.map((leaf) => leaf.path))).not.toContainEqual([
      "marketplace_id",
    ]);
  });

  it("uses the exact live relationship values when staging a detach", () => {
    const body = buildVariationDetachBody({
      productType: "PET_FOOD",
      marketplaceId: MARKETPLACE_ID,
      attributes: {
        parentage_level: [
          { value: "child", marketplace_id: MARKETPLACE_ID },
        ],
        child_parent_sku_relationship: [
          {
            parent_sku: "PARENT-OLD",
            child_relationship_type: "variation",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        variation_theme: [
          { name: "FLAVOR_NAME", marketplace_id: MARKETPLACE_ID },
        ],
      },
    });

    expect(body.productType).toBe("PET_FOOD");
    expect(body.patches).toEqual([
      {
        op: "delete",
        path: "/attributes/child_parent_sku_relationship",
        value: [
          {
            parent_sku: "PARENT-OLD",
            child_relationship_type: "variation",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
      },
      {
        op: "delete",
        path: "/attributes/parentage_level",
        value: [{ value: "child", marketplace_id: MARKETPLACE_ID }],
      },
      {
        op: "delete",
        path: "/attributes/variation_theme",
        value: [{ name: "FLAVOR_NAME", marketplace_id: MARKETPLACE_ID }],
      },
    ]);
  });

  it("refuses to detach when any relationship old value cannot be verified", () => {
    expect(() =>
      buildVariationDetachBody({
        productType: "PET_FOOD",
        marketplaceId: MARKETPLACE_ID,
        attributes: {
          parentage_level: [{ value: "child" }],
          child_parent_sku_relationship: [{ parent_sku: "PARENT-OLD" }],
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "VARIATION_RELATIONSHIP_CHANGED",
      }) as VariationUpdateValidationError,
    );
  });

  it("requires a completed detach and every target variation dimension before attach", () => {
    expect(() =>
      buildVariationAttachBody({
        productType: "PET_FOOD",
        marketplaceId: MARKETPLACE_ID,
        targetParentSku: "PARENT-NEW",
        variationTheme: "FLAVOR_NAME/ITEM_WEIGHT",
        dimensionNames: ["flavor_name", "item_weight"],
        dimensionValues: {},
        existingAttributes: {
          child_parent_sku_relationship: [{ parent_sku: "PARENT-OLD" }],
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "VARIATION_NOT_DETACHED" }) as VariationUpdateValidationError,
    );

    expect(() =>
      buildVariationAttachBody({
        productType: "PET_FOOD",
        marketplaceId: MARKETPLACE_ID,
        targetParentSku: "PARENT-NEW",
        variationTheme: "FLAVOR_NAME",
        dimensionNames: ["flavor_name"],
        dimensionValues: { flavor_name: [{ value: "Turkey" }] },
        existingAttributes: {
          parentage_level: [{ value: "child" }],
          variation_theme: [{ name: "FLAVOR_NAME" }],
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "VARIATION_NOT_DETACHED" }) as VariationUpdateValidationError,
    );

    expect(() =>
      buildVariationAttachBody({
        productType: "PET_FOOD",
        marketplaceId: MARKETPLACE_ID,
        targetParentSku: "PARENT-NEW",
        variationTheme: "FLAVOR_NAME/ITEM_WEIGHT",
        dimensionNames: ["flavor_name", "item_weight"],
        dimensionValues: {
          flavor_name: [{ value: "Turkey" }],
        },
        existingAttributes: {},
      }),
    ).toThrowError(
      expect.objectContaining({ code: "VARIATION_FIELD_REQUIRED" }) as VariationUpdateValidationError,
    );
  });

  it("builds an attach body with add or replace based on the latest detached listing", () => {
    const body = buildVariationAttachBody({
      productType: "PET_FOOD",
      marketplaceId: MARKETPLACE_ID,
      targetParentSku: "PARENT-NEW",
      variationTheme: "FLAVOR_NAME/ITEM_WEIGHT",
      dimensionNames: ["flavor_name", "item_weight"],
      dimensionValues: {
        flavor_name: [{ value: "Turkey", language_tag: "en_US" }],
        item_weight: [{ value: 3.5, unit: "ounces" }],
      },
      existingAttributes: {
        flavor_name: [
          {
            value: "Turkey",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
      },
    });

    expect(body.patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: "add",
          path: "/attributes/child_parent_sku_relationship",
          value: [
            expect.objectContaining({
              parent_sku: "PARENT-NEW",
              child_relationship_type: "variation",
              marketplace_id: MARKETPLACE_ID,
            }),
          ],
        }),
        expect.objectContaining({
          op: "replace",
          path: "/attributes/flavor_name",
          value: [
            expect.objectContaining({
              value: "Turkey",
              marketplace_id: MARKETPLACE_ID,
            }),
          ],
        }),
        expect.objectContaining({
          op: "add",
          path: "/attributes/item_weight",
          value: [
            { value: 3.5, unit: "ounces", marketplace_id: MARKETPLACE_ID },
          ],
        }),
      ]),
    );
  });

  it("rejects cross-marketplace dimension data and produces stable duplicate signatures", () => {
    expect(() =>
      buildVariationAttachBody({
        productType: "PET_FOOD",
        marketplaceId: MARKETPLACE_ID,
        targetParentSku: "PARENT-NEW",
        variationTheme: "FLAVOR_NAME",
        dimensionNames: ["flavor_name"],
        dimensionValues: {
          flavor_name: [{ value: "Turkey", marketplace_id: "A2EUQ1WTGCTBG2" }],
        },
        existingAttributes: {},
      }),
    ).toThrow(/marketplace_id/);

    const left = variationDimensionSignature({
      dimensionNames: ["item_weight", "flavor_name"],
      marketplaceId: MARKETPLACE_ID,
      dimensionValues: {
        flavor_name: [{ value: "Turkey", language_tag: "en_US" }],
        item_weight: [{ value: 3.5, unit: "ounces" }],
      },
    });
    const right = variationDimensionSignature({
      dimensionNames: ["flavor_name", "item_weight"],
      marketplaceId: MARKETPLACE_ID,
      dimensionValues: {
        item_weight: [
          { value: 3.5, unit: "ounces", marketplace_id: MARKETPLACE_ID },
        ],
        flavor_name: [
          {
            value: "Turkey",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
      },
    });

    expect(left).toBe(right);
  });

  it("recursively canonicalizes object keys and unordered attribute arrays", () => {
    const left = variationDimensionSignature({
      dimensionNames: ["size_map"],
      marketplaceId: MARKETPLACE_ID,
      dimensionValues: {
        size_map: [
          {
            value: {
              label: "Small",
              measurements: [
                { unit: "inches", value: 4 },
                { value: 2, unit: "inches" },
              ],
            },
            language_tag: "en_US",
          },
          { value: { label: "Large", measurements: [10, 8] } },
        ],
      },
    });
    const right = variationDimensionSignature({
      dimensionNames: ["size_map"],
      marketplaceId: MARKETPLACE_ID,
      dimensionValues: {
        size_map: [
          { value: { measurements: [8, 10], label: "Large" } },
          {
            marketplace_id: MARKETPLACE_ID,
            value: {
              measurements: [
                { value: 2, unit: "inches" },
                { value: 4, unit: "inches" },
              ],
              label: "Small",
            },
          },
        ],
      },
    });

    expect(left).toBe(right);
  });

  it("parses both direct and nested relationship attributes for readback", () => {
    expect(
      variationRelationshipSnapshot({
        marketplaceId: MARKETPLACE_ID,
        attributes: {
          parentage_level: [{ value: "child" }],
          child_parent_sku_relationship: [
            {
              value: {
                parent_sku: "PARENT-NEW",
                child_relationship_type: "variation",
              },
            },
          ],
          variation_theme: [{ value: { name: "FLAVOR_NAME" } }],
        },
      }),
    ).toEqual({
      parentageLevel: "child",
      parentSku: "PARENT-NEW",
      relationshipType: "variation",
      variationTheme: "FLAVOR_NAME",
    });
  });

  it("requires all relationship fields to disappear before detach is verified", () => {
    expect(
      assertVariationDetached({ marketplaceId: MARKETPLACE_ID, attributes: {} }),
    ).toEqual({
      parentageLevel: null,
      parentSku: null,
      relationshipType: null,
      variationTheme: null,
    });
    expect(() =>
      assertVariationDetached({
        marketplaceId: MARKETPLACE_ID,
        attributes: { parentage_level: [{ value: "child" }] },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "VARIATION_DETACH_NOT_VERIFIED",
      }) as VariationUpdateValidationError,
    );
  });

  it("fails closed when relationship attributes contain conflicting old values", () => {
    expect(() =>
      buildVariationDetachBody({
        productType: "PET_FOOD",
        marketplaceId: MARKETPLACE_ID,
        expectedParentSku: "PARENT-OLD",
        attributes: {
          parentage_level: [{ value: "child" }],
          child_parent_sku_relationship: [
            {
              parent_sku: "PARENT-OLD",
              child_relationship_type: "variation",
            },
            {
              parent_sku: "PARENT-OTHER",
              child_relationship_type: "variation",
            },
          ],
          variation_theme: [{ name: "FLAVOR_NAME" }],
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "VARIATION_RELATIONSHIP_CONFLICT",
      }) as VariationUpdateValidationError,
    );

    expect(() =>
      assertVariationAttached({
        marketplaceId: MARKETPLACE_ID,
        targetParentSku: "PARENT-NEW",
        variationTheme: "FLAVOR_NAME",
        dimensionNames: ["flavor_name"],
        dimensionValues: { flavor_name: [{ value: "Turkey" }] },
        attributes: {
          parentage_level: [{ value: "parent" }],
          child_parent_sku_relationship: [
            { parent_sku: "PARENT-NEW", child_relationship_type: "variation" },
          ],
          variation_theme: [{ name: "FLAVOR_NAME" }],
          flavor_name: [{ value: "Turkey" }],
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "VARIATION_RELATIONSHIP_CONFLICT",
      }) as VariationUpdateValidationError,
    );
  });

  it("verifies the exact target relationship and dimensions after attach", () => {
    const expectedDimensions = {
      flavor_name: [{ value: "Turkey", language_tag: "en_US" }],
      item_weight: [{ value: 3.5, unit: "ounces" }],
    };
    const snapshot = assertVariationAttached({
      marketplaceId: MARKETPLACE_ID,
      targetParentSku: "PARENT-NEW",
      variationTheme: "FLAVOR_NAME/ITEM_WEIGHT",
      dimensionNames: ["flavor_name", "item_weight"],
      dimensionValues: expectedDimensions,
      attributes: {
        parentage_level: [{ value: "child", marketplace_id: MARKETPLACE_ID }],
        child_parent_sku_relationship: [
          {
            parent_sku: "PARENT-NEW",
            child_relationship_type: "variation",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        variation_theme: [
          {
            name: "FLAVOR_NAME/ITEM_WEIGHT",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        flavor_name: [
          {
            value: "Turkey",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        item_weight: [
          { value: 3.5, unit: "ounces", marketplace_id: MARKETPLACE_ID },
        ],
      },
    });

    expect(snapshot.parentSku).toBe("PARENT-NEW");
    expect(() =>
      assertVariationAttached({
        marketplaceId: MARKETPLACE_ID,
        targetParentSku: "PARENT-OTHER",
        variationTheme: "FLAVOR_NAME/ITEM_WEIGHT",
        dimensionNames: ["flavor_name", "item_weight"],
        dimensionValues: expectedDimensions,
        attributes: {
          parentage_level: [{ value: "child" }],
          child_parent_sku_relationship: [
            { parent_sku: "PARENT-NEW", child_relationship_type: "variation" },
          ],
          variation_theme: [{ name: "FLAVOR_NAME/ITEM_WEIGHT" }],
          flavor_name: [{ value: "Turkey" }],
          item_weight: [{ value: 3.5, unit: "ounces" }],
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "VARIATION_ATTACH_NOT_VERIFIED",
      }) as VariationUpdateValidationError,
    );
  });
});
