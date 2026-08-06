import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import VariationPlannerDrawer from "../src/renderer/src/components/variation-planner-drawer";
import {
  buildVariationMovePlan,
  parseVariationFamilyResponse,
  variationLookupKeyAction,
  type VariationFamilyView,
  type VariationMemberView,
} from "../src/renderer/src/variation-planner";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

function member(
  sellerSku: string,
  input: Partial<VariationMemberView> = {},
): VariationMemberView {
  return {
    sellerSku,
    asin: `ASIN-${sellerSku}`,
    title: `Listing ${sellerSku}`,
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    role: "child",
    parentSku: "SOURCE-PARENT",
    childSkus: [],
    variationTheme: "SIZE_NAME",
    dimensions: [{ name: "size_name", label: "Size Name", values: ["4 oz"] }],
    fba: true,
    issues: [],
    relationshipSources: ["relationships", "attributes"],
    ...input,
  };
}

function family(
  queried: VariationMemberView,
  input: Partial<VariationFamilyView> = {},
): VariationFamilyView {
  const parent = queried.role === "parent"
    ? queried
    : member(queried.parentSku ?? "SOURCE-PARENT", {
        role: "parent",
        parentSku: null,
        asin: null,
        fba: false,
        childSkus: [queried.sellerSku],
        dimensions: [{ name: "size_name", label: "Size Name", values: [] }],
      });
  return {
    mode: "live",
    marketplaceId: MARKETPLACE_ID,
    queriedSku: queried.sellerSku,
    queriedRole: queried.role,
    queried,
    parent,
    children: queried.role === "parent" ? [] : [queried],
    excludedChildren: [],
    variationTheme: "SIZE_NAME",
    dimensionNames: ["size_name"],
    familyComplete: true,
    fetchedAt: "2026-08-06T08:00:00.000Z",
    requestIds: ["REQUEST-01"],
    writable: false,
    boundaries: ["唯讀"],
    notice: "Listings Items 唯讀結果。",
    ...input,
  };
}

describe("variation planner", () => {
  it("renders a read-only FBA-only boundary before any lookup", () => {
    const markup = renderToStaticMarkup(
      <VariationPlannerDrawer
        initialMarketplaceId={MARKETPLACE_ID}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("變體規劃");
    expect(markup).toContain("唯讀規劃 · Amazon 不會收到變更");
    expect(markup).toContain("先移除舊關係再重建");
    expect(markup).toContain("非原子流程");
    expect(markup).toContain("FBA child only");
    expect(markup).not.toContain("確認更新");
  });

  it("accepts only an exact, explicitly non-writable family response", () => {
    const source = member("CHILD-4OZ");
    const snapshot = family(source);

    expect(
      parseVariationFamilyResponse(snapshot, {
        marketplaceId: MARKETPLACE_ID,
        sellerSku: "CHILD-4OZ",
      }),
    ).toEqual(snapshot);
    expect(() =>
      parseVariationFamilyResponse(
        { ...snapshot, writable: true },
        { marketplaceId: MARKETPLACE_ID, sellerSku: "CHILD-4OZ" },
      ),
    ).toThrow(/停止規劃/);
    expect(() =>
      parseVariationFamilyResponse(
        { ...snapshot, children: [{ ...source, fba: false }] },
        { marketplaceId: MARKETPLACE_ID, sellerSku: "CHILD-4OZ" },
      ),
    ).toThrow(/停止規劃/);
    expect(() =>
      parseVariationFamilyResponse(
        { ...snapshot, dimensionNames: [""] },
        { marketplaceId: MARKETPLACE_ID, sellerSku: "CHILD-4OZ" },
      ),
    ).toThrow(/停止規劃/);
  });

  it("builds a non-atomic delete-and-recreate review without claiming a write", () => {
    const source = member("CHILD-4OZ");
    const sourceFamily = family(source);
    const targetParent = member("TARGET-PARENT", {
      role: "parent",
      parentSku: null,
      asin: null,
      fba: false,
      childSkus: [],
      dimensions: [{ name: "size_name", label: "Size Name", values: [] }],
    });
    const targetFamily = family(targetParent, {
      parent: targetParent,
      children: [],
    });

    const plan = buildVariationMovePlan(sourceFamily, source, targetFamily);

    expect(plan.status).toBe("read_only_review");
    expect(plan.blockers).toEqual([]);
    expect(plan.warnings.join(" ")).toContain("先移除舊關係再重建");
    expect(plan.warnings.join(" ")).toContain("非原子");
    expect(plan.warnings.join(" ")).toContain("不會寫入");
    expect(plan.proposedSteps).toHaveLength(3);
  });

  it("blocks planning whenever the source or target family is incomplete", () => {
    const source = member("CHILD-4OZ");
    const sourceFamily = family(source, { familyComplete: false });
    const targetParent = member("TARGET-PARENT", {
      role: "parent",
      parentSku: null,
      asin: null,
      fba: false,
      childSkus: [],
      dimensions: [{ name: "size_name", label: "Size Name", values: [] }],
    });
    const targetFamily = family(targetParent, {
      parent: targetParent,
      children: [],
      familyComplete: false,
    });

    const plan = buildVariationMovePlan(sourceFamily, source, targetFamily);

    expect(plan.status).toBe("blocked");
    expect(plan.blockers.join(" ")).toContain("來源 family 清單不完整");
    expect(plan.blockers.join(" ")).toContain("目標 family 清單不完整");
  });

  it("requires a non-empty source value for every target dimension", () => {
    const source = member("CHILD-4OZ", {
      variationTheme: "SIZE_COLOR",
      dimensions: [
        { name: "size_name", label: "Size Name", values: ["4 oz"] },
        { name: "color_name", label: "Color Name", values: ["  "] },
      ],
    });
    const sourceFamily = family(source, {
      variationTheme: "SIZE_COLOR",
      dimensionNames: ["size_name", "color_name"],
    });
    const targetParent = member("TARGET-PARENT", {
      role: "parent",
      parentSku: null,
      asin: null,
      fba: false,
      childSkus: [],
      variationTheme: "SIZE_COLOR",
      dimensions: [
        { name: "size_name", label: "Size Name", values: [] },
        { name: "color_name", label: "Color Name", values: [] },
      ],
    });
    const targetFamily = family(targetParent, {
      parent: targetParent,
      children: [],
      variationTheme: "SIZE_COLOR",
      dimensionNames: ["size_name", "color_name"],
    });

    const plan = buildVariationMovePlan(sourceFamily, source, targetFamily);

    expect(plan.status).toBe("blocked");
    expect(plan.blockers.join(" ")).toContain("必要變體維度值：color_name");
    expect(plan.blockers.join(" ")).not.toContain("必要變體維度值：size_name");
  });

  it("blocks cross-marketplace, theme mismatch and duplicate dimensions", () => {
    const source = member("CHILD-4OZ");
    const sourceFamily = family(source);
    const targetParent = member("TARGET-PARENT", {
      role: "parent",
      parentSku: null,
      asin: null,
      fba: false,
      variationTheme: "COLOR_NAME",
      dimensions: [{ name: "color_name", label: "Color Name", values: [] }],
    });
    const duplicate = member("TARGET-CHILD", {
      parentSku: "TARGET-PARENT",
    });
    const targetFamily = family(targetParent, {
      marketplaceId: "A2EUQ1WTGCTBG2",
      parent: targetParent,
      children: [duplicate],
      variationTheme: "COLOR_NAME",
      dimensionNames: ["color_name"],
    });

    const plan = buildVariationMovePlan(sourceFamily, source, targetFamily);

    expect(plan.status).toBe("blocked");
    expect(plan.blockers.join(" ")).toContain("跨站");
    expect(plan.blockers.join(" ")).toContain("theme 不一致");
    expect(plan.blockers.join(" ")).toContain("相同變體維度值");
  });

  it("uses only the allowlisted GET-style family fetch in the drawer", () => {
    const source = readFileSync(
      new URL(
        "../src/renderer/src/components/variation-planner-drawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("/api/sp-api/variation-family?");
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(source).not.toContain("localStorage");
  });

  it("binds lookup to explicit button clicks and Enter without relying on form submit", () => {
    expect(variationLookupKeyAction("Enter", false)).toBe("lookup");
    expect(variationLookupKeyAction("Enter", true)).toBe("suppress");
    expect(variationLookupKeyAction("Tab", false)).toBe("ignore");

    const source = readFileSync(
      new URL(
        "../src/renderer/src/components/variation-planner-drawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toMatch(
      /type="button"\s+data-variation-lookup="source"\s+onClick=\{runSourceLookup\}/,
    );
    expect(source).toMatch(
      /type="button"\s+data-variation-lookup="target"\s+onClick=\{runTargetLookup\}/,
    );
    expect(source).toContain("onKeyDown={handleSourceKeyDown}");
    expect(source).toContain("onKeyDown={handleTargetKeyDown}");
    expect(source).not.toContain("<form");
    expect(source).not.toContain("onSubmit=");
    expect(source).toMatch(
      /window\.removeEventListener\("keydown", onKeyDown\);\s*}\;\s*}, \[busy, closeDrawer\]\);/,
    );
    expect(source).toMatch(
      /useEffect\(\(\) => \(\) => \{\s*sourceAbortRef\.current\?\.abort\(\);\s*targetAbortRef\.current\?\.abort\(\);\s*}, \[\]\);/,
    );
  });
});
