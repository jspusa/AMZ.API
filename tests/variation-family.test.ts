import { describe, expect, it } from "vitest";
import {
  normalizeVariationMember,
  variationSearchIncludesDeclaredChildren,
  variationPayloadHasFba,
  type VariationListingPayload,
} from "../src/main/amazon/variation-family";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

describe("variation family normalization", () => {
  it("reads parent children, theme and dimensions from Listings relationships", () => {
    const payload: VariationListingPayload = {
      sku: "PARENT-01",
      summaries: [
        {
          marketplaceId: MARKETPLACE_ID,
          productType: "PET_FOOD",
          itemName: "Turkey Treat Parent",
        },
      ],
      attributes: {
        parentage_level: [
          { marketplace_id: MARKETPLACE_ID, value: "parent" },
        ],
        variation_theme: [
          { marketplace_id: MARKETPLACE_ID, name: "SIZE_NAME" },
        ],
      },
      relationships: [
        {
          marketplaceId: MARKETPLACE_ID,
          relationships: [
            {
              type: "VARIATION",
              childSkus: ["CHILD-4OZ", "CHILD-10OZ"],
              variationTheme: {
                theme: "SIZE_NAME",
                attributes: ["size_name"],
              },
            },
          ],
        },
      ],
    };

    const member = normalizeVariationMember(payload, MARKETPLACE_ID);

    expect(member).toMatchObject({
      sellerSku: "PARENT-01",
      role: "parent",
      parentSku: null,
      childSkus: ["CHILD-4OZ", "CHILD-10OZ"],
      variationTheme: "SIZE_NAME",
      fba: false,
      relationshipSources: ["relationships", "attributes"],
    });
    expect(member.dimensions).toEqual([
      { name: "size_name", label: "Size Name", values: [] },
    ]);
  });

  it("uses Listing attributes as a child relationship fallback and proves FBA", () => {
    const payload: VariationListingPayload = {
      sku: "CHILD-4OZ",
      summaries: [
        {
          marketplaceId: MARKETPLACE_ID,
          asin: "B0TESTCHILD",
          productType: "PET_FOOD",
          status: ["BUYABLE"],
          itemName: "Turkey Treat 4 oz",
        },
      ],
      attributes: {
        parentage_level: [{ value: "child" }],
        child_parent_sku_relationship: [
          { marketplace_id: MARKETPLACE_ID, parent_sku: "PARENT-01" },
        ],
        variation_theme: [{ name: "SIZE_NAME" }],
        size_name: [{ value: "4 oz", language_tag: "en_US" }],
      },
      fulfillmentAvailability: [
        { fulfillmentChannelCode: "AMAZON_NA", quantity: 12 },
      ],
      issues: [
        {
          code: "TEST_WARNING",
          severity: "WARNING",
          message: "Review dimensions",
          attributeName: "size_name",
        },
      ],
    };

    const member = normalizeVariationMember(payload, MARKETPLACE_ID, "attributes");

    expect(member).toMatchObject({
      role: "child",
      parentSku: "PARENT-01",
      variationTheme: "SIZE_NAME",
      fba: true,
      dimensions: [
        { name: "size_name", label: "Size Name", values: ["4 oz"] },
      ],
      issues: [
        {
          code: "TEST_WARNING",
          severity: "WARNING",
          attributeNames: ["size_name"],
        },
      ],
    });
  });

  it("does not treat a merchant fulfillment channel as FBA", () => {
    expect(
      variationPayloadHasFba({
        fulfillmentAvailability: [
          { fulfillmentChannelCode: "DEFAULT", quantity: 99 },
        ],
      }),
    ).toBe(false);
  });

  it("fails completeness when a parent-declared child is absent from search results", () => {
    const parent = normalizeVariationMember(
      {
        sku: "PARENT-01",
        relationships: [
          {
            marketplaceId: MARKETPLACE_ID,
            relationships: [
              { childSkus: ["CHILD-4OZ", "CHILD-10OZ"] },
            ],
          },
        ],
      },
      MARKETPLACE_ID,
    );
    const searchedChild = normalizeVariationMember(
      { sku: "CHILD-4OZ" },
      MARKETPLACE_ID,
      "variationParentSku",
    );

    expect(
      variationSearchIncludesDeclaredChildren(parent, [searchedChild]),
    ).toBe(false);
    expect(
      variationSearchIncludesDeclaredChildren(parent, [
        searchedChild,
        { ...searchedChild, sellerSku: "CHILD-10OZ" },
      ]),
    ).toBe(true);
  });

  it("does not invent incompleteness when the parent exposes no child declaration", () => {
    const parent = normalizeVariationMember(
      {
        sku: "PARENT-ATTRIBUTES-ONLY",
        attributes: {
          parentage_level: [{ value: "parent" }],
        },
      },
      MARKETPLACE_ID,
      "attributes",
    );

    expect(variationSearchIncludesDeclaredChildren(parent, [])).toBe(true);
  });
});
