import { describe, expect, it } from "vitest";
import {
  auditListingContentRows,
  type ContentQualitySourceRow,
} from "../src/main/amazon/content-quality";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const FETCHED_AT = "2026-08-06T08:00:00.000Z";

function row(
  input: Partial<ContentQualitySourceRow> = {},
): ContentQualitySourceRow {
  return {
    sellerSku: "AFA12AM",
    asin: "B09S5VY2JS",
    productType: "PET_FOOD",
    title: "Turkey Tendons Dog Treats",
    bulletPoints: [
      "USA-sourced turkey tendons",
      "High-protein reward",
      "Lean and clean recipe",
      "Gentle on sensitive stomachs",
      "Slowly cooked for flavor",
    ],
    ingredients: "Turkey Tendon, Chicken, Coconut Glycerin, Soy Protein",
    readStatus: "complete",
    readErrors: [],
    ...input,
  };
}

describe("FBA listing content quality audit", () => {
  it("returns every scanned FBA row and an empty issue list for clean content", () => {
    const source = row();

    const result = auditListingContentRows({
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: FETCHED_AT,
      rows: [source],
    });

    expect(result).toEqual({
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: FETCHED_AT,
      rows: [{ ...source, issues: [] }],
      readErrors: [],
      summary: {
        total: 1,
        completed: 1,
        incomplete: 0,
        withIssues: 0,
        suspectedTypos: 0,
        missingBullets: 0,
        missingIngredients: 0,
        ingredientsUnverified: 0,
      },
    });
  });

  it("counts non-empty bullet points and reports missing ingredients", () => {
    const result = auditListingContentRows({
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: FETCHED_AT,
      rows: [
        row({
          bulletPoints: ["One", "Two", " ", "Three"],
          ingredients: "  ",
        }),
      ],
    });

    expect(result.rows[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "MISSING_BULLETS",
          field: "bulletPoints",
        }),
        expect.objectContaining({
          kind: "MISSING_INGREDIENTS",
          field: "ingredients",
        }),
      ]),
    );
    expect(result.summary).toMatchObject({
      total: 1,
      withIssues: 1,
      missingBullets: 1,
      missingIngredients: 1,
    });
  });

  it("flags only deterministic suspected typos without modifying content", () => {
    const source = row({
      title: "Cocount Dog Treats",
      bulletPoints: [
        "A safe safe reward",
        "High-protein reward",
        "Lean and clean recipe",
        "Gentle on sensitive stomachs",
        "Slowly cooked for flavor",
      ],
      ingredients: "Turkey Tendon, Coconut\u200b Glycerin",
    });
    const original = structuredClone(source);

    const result = auditListingContentRows({
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: FETCHED_AT,
      rows: [source],
    });

    expect(source).toEqual(original);
    expect(result.rows[0]).toMatchObject(original);
    expect(result.rows[0].issues).toEqual(
      expect.arrayContaining([
        {
          kind: "SUSPECTED_TYPO",
          field: "title",
          message: expect.any(String),
          token: "Cocount",
          suggestion: "Coconut",
        },
        {
          kind: "SUSPECTED_TYPO",
          field: "bulletPoints",
          message: expect.any(String),
          token: "safe safe",
          suggestion: "safe",
        },
        {
          kind: "SUSPECTED_TYPO",
          field: "ingredients",
          message: expect.any(String),
          token: "U+200B",
          suggestion: "移除不可見字元",
        },
      ]),
    );
    expect(result.summary).toMatchObject({
      total: 1,
      withIssues: 1,
      suspectedTypos: 1,
      missingBullets: 0,
      missingIngredients: 0,
    });
  });

  it("counts affected SKUs once per category even when a row has several findings", () => {
    const result = auditListingContentRows({
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: FETCHED_AT,
      rows: [
        row({ title: "Protien Cocount treats" }),
        row({ sellerSku: "AFA32AM", asin: "B09S5X5NWH" }),
      ],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].issues.filter((issue) => issue.kind === "SUSPECTED_TYPO"))
      .toHaveLength(2);
    expect(result.summary).toEqual({
      total: 2,
      completed: 2,
      incomplete: 0,
      withIssues: 1,
      suspectedTypos: 1,
      missingBullets: 0,
      missingIngredients: 0,
      ingredientsUnverified: 0,
    });
  });

  it("keeps Listings read failures explicit and excludes synthetic empty rows from findings", () => {
    const result = auditListingContentRows({
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: FETCHED_AT,
      rows: [
        row({
          title: "Report-only title",
          bulletPoints: [],
          ingredients: "",
          readStatus: "incomplete",
          readErrors: [
            {
              code: "LISTING_QUERY_FAILED",
              message: "Listings Items API timeout",
            },
          ],
        }),
      ],
    });

    expect(result.rows[0].issues).toEqual([]);
    expect(result.rows[0].readStatus).toBe("incomplete");
    expect(result.readErrors).toEqual([
      {
        sellerSku: "AFA12AM",
        code: "LISTING_QUERY_FAILED",
        message: "Listings Items API timeout",
      },
    ]);
    expect(result.summary).toEqual({
      total: 1,
      completed: 0,
      incomplete: 1,
      withIssues: 0,
      suspectedTypos: 0,
      missingBullets: 0,
      missingIngredients: 0,
      ingredientsUnverified: 0,
    });
  });

  it("marks blank ingredients as unverified unless the product type is proven applicable", () => {
    const result = auditListingContentRows({
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: FETCHED_AT,
      rows: [row({ productType: "PET_SUPPLIES", ingredients: "" })],
    });

    expect(result.rows[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "INGREDIENTS_UNVERIFIED" }),
      ]),
    );
    expect(result.summary).toMatchObject({
      missingIngredients: 0,
      ingredientsUnverified: 1,
    });
  });
});
