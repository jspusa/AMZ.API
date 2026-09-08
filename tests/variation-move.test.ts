import { describe, expect, it } from "vitest";
import {
  initialVariationDimensionValues,
  missingVariationFields,
  parseVariationJsonValues,
  parseVariationMovePreparation,
  parseVariationMoveResult,
  updateVariationLeaf,
} from "../src/renderer/src/variation-move";

const preparationPayload = {
  action: "attach",
  mode: "live" as const,
  marketplaceId: "ATVPDKIKX0DER",
  sellerSku: "CHILD-OLD",
  sourceParentSku: "PARENT-OLD",
  targetParentSku: "PARENT-NEW",
  productType: "PET_FOOD",
  variationTheme: "FLAVOR_NAME/ITEM_WEIGHT",
  dimensionNames: ["flavor_name", "item_weight"],
  fields: [
    {
      name: "flavor_name",
      label: "Flavor Name",
      editable: true,
      values: [],
      leaves: [
        {
          path: ["value"],
          label: "Value",
          type: "string" as const,
          required: true,
          enumValues: [],
          currentValue: null,
        },
      ],
      jsonFallback: false,
    },
    {
      name: "item_weight",
      label: "Item Weight",
      editable: true,
      values: [{ value: 3.5, unit: "ounces", marketplace_id: "ATVPDKIKX0DER" }],
      leaves: [
        {
          path: ["value"],
          label: "Value",
          type: "number" as const,
          required: true,
          enumValues: [],
          currentValue: 3.5,
        },
        {
          path: ["unit"],
          label: "Unit",
          type: "string" as const,
          required: true,
          enumValues: ["ounces", "pounds"],
          currentValue: "ounces",
        },
      ],
      jsonFallback: false,
    },
  ],
  requiredFields: [],
  preparedAt: "2026-08-08T08:00:00.000Z",
  requestIds: [],
  writable: true,
  blockers: [],
  warnings: ["非原子流程"],
  notice: "PTD CHILD",
};

describe("variation move renderer contract", () => {
  it("parses dynamic PTD fields and initializes marketplace-scoped values", () => {
    const preparation = parseVariationMovePreparation(preparationPayload, {
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "CHILD-OLD",
      targetParentSku: "PARENT-NEW",
    });
    const values = initialVariationDimensionValues(preparation);

    expect(values.flavor_name).toEqual([{ marketplace_id: "ATVPDKIKX0DER" }]);
    expect(values.item_weight[0]).toMatchObject({ value: 3.5, unit: "ounces" });
    expect(missingVariationFields(preparation, values)).toEqual([
      "Flavor Name",
    ]);
  });

  it("updates nested values without mutating the prior form state", () => {
    const preparation = parseVariationMovePreparation(preparationPayload, {
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "CHILD-OLD",
      targetParentSku: "PARENT-NEW",
    });
    const previous = initialVariationDimensionValues(preparation);
    const next = updateVariationLeaf({
      values: previous,
      fieldName: "flavor_name",
      path: ["value"],
      value: "Turkey",
    });

    expect(previous.flavor_name[0]).not.toHaveProperty("value");
    expect(next.flavor_name[0]).toMatchObject({
      value: "Turkey",
      marketplace_id: "ATVPDKIKX0DER",
    });
    expect(missingVariationFields(preparation, next)).toEqual([]);
  });

  it("requires the new Bridge capability and supports standalone detach preparation with explicit product facts", () => {
    const expected = {
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "CHILD-OLD",
      targetParentSku: null,
      action: "detach" as const,
    };
    const detached = {
      ...preparationPayload,
      action: "detach",
      targetParentSku: null,
      variationTheme: null,
      dimensionNames: [],
      fields: [],
      requiredFields: [
        {
          ...preparationPayload.fields[0],
          name: "contains_liquid_contents",
          label: "Liquid",
          leaves: [
            {
              path: ["value"],
              label: "Value",
              type: "boolean",
              required: true,
              enumValues: [],
              currentValue: null,
            },
          ],
        },
      ],
    };
    const preparation = parseVariationMovePreparation(detached, expected);
    const blank = initialVariationDimensionValues(preparation);
    expect(missingVariationFields(preparation, blank)).toEqual(["Liquid"]);
    const explicitNo = updateVariationLeaf({
      values: blank,
      fieldName: "contains_liquid_contents",
      path: ["value"],
      value: false,
    });
    expect(missingVariationFields(preparation, explicitNo)).toEqual([]);
    const cleared = updateVariationLeaf({
      values: explicitNo,
      fieldName: "contains_liquid_contents",
      path: ["value"],
      value: null,
    });
    expect(missingVariationFields(preparation, cleared)).toEqual(["Liquid"]);
    expect(() =>
      parseVariationMovePreparation(
        { ...detached, requiredFields: undefined },
        expected,
      ),
    ).toThrow(/更新 AMZ.API Notebook Key/);
  });

  it("fails closed when a result is accepted but not verified by readback", () => {
    expect(() =>
      parseVariationMoveResult(
        {
          mode: "live",
          action: "detach",
          status: "ACCEPTED",
          marketplaceId: "ATVPDKIKX0DER",
          sellerSku: "CHILD-OLD",
          sourceParentSku: "PARENT-OLD",
          targetParentSku: null,
          variationTheme: null,
          verified: false,
          completedAt: "2026-08-08T08:00:00.000Z",
          submissionId: "submission",
          requestId: "request",
          issues: [],
          notice: "accepted but pending",
        },
        {
          action: "detach",
          marketplaceId: "ATVPDKIKX0DER",
          sellerSku: "CHILD-OLD",
        },
      ),
    ).toThrow(/尚未證明完成/);
  });

  it("accepts JSON fallback only as a marketplace-scoped object array", () => {
    expect(
      parseVariationJsonValues({
        text: '[{"value":"Turkey"}]',
        marketplaceId: "ATVPDKIKX0DER",
      }),
    ).toEqual([{ value: "Turkey", marketplace_id: "ATVPDKIKX0DER" }]);
    expect(() =>
      parseVariationJsonValues({
        text: '[{"value":"Turkey","marketplace_id":"A2EUQ1WTGCTBG2"}]',
        marketplaceId: "ATVPDKIKX0DER",
      }),
    ).toThrow(/marketplace_id/);
  });
});
