import { describe, expect, it } from "vitest";
import { buildUnboundFamilyRecommendations } from "../src/main/amazon/unbound-family-recommendations";
import type { UnboundVariationAuditSnapshot } from "../src/main/amazon/variation-catalog-reads";

function snapshot(sellerSku = "GCBL06"): UnboundVariationAuditSnapshot {
  return {
    mode: "demo",
    marketplaceId: "ATVPDKIKX0DER",
    fetchedAt: "2026-09-08T00:00:00Z",
    rows: [
      {
        sellerSku,
        asin: "B000000001",
        title: "Synthetic standalone",
        productType: "PET_FOOD",
        relationshipEvidence: "relationships",
        notice: "Verified standalone",
      },
    ],
    incompleteRows: [],
    allVariationRows: [],
    summary: {
      totalFbaListings: 1,
      completed: 1,
      unbound: 1,
      boundChildren: 0,
      parentContainers: 0,
      incomplete: 0,
    },
    notice: "FBA only",
  };
}
function addFamily(
  data: UnboundVariationAuditSnapshot,
  sku: string,
  children: string[],
  productType = "PET_FOOD",
  theme = "SIZE_NAME",
) {
  data.allVariationRows.push({
    familySku: sku,
    sellerSku: sku,
    title: "",
    productType: "",
    variationTheme: null,
    role: "parent",
    evidence: "parent-sku-from-verified-child",
  });
  for (const child of children)
    data.allVariationRows.push({
      familySku: sku,
      sellerSku: child,
      title: "Synthetic sibling",
      productType,
      variationTheme: theme,
      role: "child",
      evidence: "verified-child",
    });
}

describe("unbound family recommendations from verified audit evidence", () => {
  it("ranks the family containing the most exact-series siblings and discloses the actual evidence", () => {
    const data = snapshot();
    addFamily(data, "PARENT-SMALL", ["GCBL04", "GCBL05"]);
    addFamily(data, "PARENT-LARGE", ["GCBL01", "GCBL02", "GCBL03"]);
    const result = buildUnboundFamilyRecommendations(data)[0];
    expect(result).toMatchObject({
      sellerSku: "GCBL06",
      status: "ranked",
      candidates: [
        {
          parentSku: "PARENT-LARGE",
          matchingChildCount: 3,
          matchingChildSkus: ["GCBL01", "GCBL02", "GCBL03"],
          stars: 3,
          tied: false,
          productType: "PET_FOOD",
          variationTheme: "SIZE_NAME",
        },
        {
          parentSku: "PARENT-SMALL",
          matchingChildCount: 2,
          stars: 2,
          tied: false,
        },
      ],
    });
    expect(result.candidates[0].reasons.join(" ")).toContain("GCBL");
    expect(data.allVariationRows[0].title).toBe("");
  });
  it("requires both the stable prefix and suffix for AFA69AM-like series", () => {
    const data = snapshot("AFA69AM");
    addFamily(data, "PARENT-MATCH", ["AFA61AM", "AFA62AM"]);
    addFamily(data, "PARENT-OTHER", ["AFA61XX", "AFA62XX", "AFA63XX"]);
    expect(
      buildUnboundFamilyRecommendations(data)[0].candidates.map(
        (row) => row.parentSku,
      ),
    ).toEqual(["PARENT-MATCH"]);
  });
  it("accepts the Amazon ITEM_SHAPE/SIZE theme without rewriting its identity", () => {
    const data = snapshot();
    addFamily(
      data,
      "PARENT-SHAPE",
      ["GCBL01", "GCBL02"],
      "PET_FOOD",
      "ITEM_SHAPE/SIZE",
    );
    expect(
      buildUnboundFamilyRecommendations(data)[0].candidates[0]?.variationTheme,
    ).toBe("ITEM_SHAPE/SIZE");
  });
  it("keeps equal leaders visible as tied, without a uniquely recommended winner", () => {
    const data = snapshot();
    addFamily(data, "PARENT-A", ["GCBL01", "GCBL02"]);
    addFamily(data, "PARENT-B", ["GCBL03", "GCBL04"]);
    expect(buildUnboundFamilyRecommendations(data)[0]).toMatchObject({
      status: "tied",
      candidates: [{ tied: true }, { tied: true }],
    });
  });
  it("suppresses weak, incompatible, and conflicting family evidence", () => {
    const data = snapshot();
    addFamily(data, "WEAK", ["GCBL01"]);
    addFamily(data, "WRONG-TYPE", ["GCBL02", "GCBL03"], "PET_TOY");
    addFamily(data, "MISSING-THEME", ["GCBL04", "GCBL05"], "PET_FOOD", "");
    addFamily(data, "CONFLICT", ["GCBL07", "GCBL08"]);
    data.allVariationRows[data.allVariationRows.length - 1] = {
      ...data.allVariationRows.at(-1)!,
      variationTheme: "COLOR_NAME",
    };
    expect(buildUnboundFamilyRecommendations(data)[0]).toMatchObject({
      status: "insufficient",
      candidates: [],
    });
  });
  it("never promotes incomplete, duplicated, or already-bound source identities", () => {
    const data = snapshot();
    addFamily(data, "PARENT", ["GCBL01", "GCBL02"]);
    data.incompleteRows.push({
      sellerSku: "GCBL06",
      asin: "B000000001",
      title: "",
      code: "RELATIONSHIPS_NOT_RETURNED",
      message: "Incomplete",
      requestId: null,
    });
    expect(buildUnboundFamilyRecommendations(data)).toEqual([]);
    data.incompleteRows = [];
    data.rows.push({ ...data.rows[0] });
    expect(buildUnboundFamilyRecommendations(data)).toEqual([]);
  });
  it("suppresses all families claiming the same child and does not match broad or unstructured SKU names", () => {
    const data = snapshot();
    addFamily(data, "PARENT-A", ["GCBL01", "GCBL02"]);
    addFamily(data, "PARENT-B", ["GCBL01", "GCBL03"]);
    expect(buildUnboundFamilyRecommendations(data)[0].candidates).toEqual([]);
    expect(
      buildUnboundFamilyRecommendations(snapshot("AB06"))[0].candidates,
    ).toEqual([]);
  });
});
