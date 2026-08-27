import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusinessPricingListingSnapshot } from
  "../src/main/amazon/business-pricing-types";
import { demoFbaCatalogRows } from
  "../src/main/amazon/demo-fba-catalog";
import type { ListingContentSnapshot } from
  "../src/main/amazon/listing-content-types";
import {
  createCatalogReportsDemoSource,
  type CatalogReportsDemoIdentity,
} from "../src/main/amazon/catalog-reports-demo-source";
import type { VariationDemoRuntime } from
  "../src/main/amazon/variation-demo-runtime";
import type {
  VariationFamilyMember,
  VariationFamilySnapshot,
} from "../src/main/amazon/variation-family";

const US = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-08-27T08:09:10.000Z");

const RECOMMENDED_QUANTITY_PLAN = {
  discountType: "percent" as const,
  levels: [
    { lowerBound: 5, value: 5 },
    { lowerBound: 10, value: 10 },
    { lowerBound: 15, value: 15 },
    { lowerBound: 20, value: 20 },
  ],
};

function catalogItem(identity: CatalogReportsDemoIdentity) {
  const item = demoFbaCatalogRows(identity.marketplaceId).find(
    (candidate) => candidate.sellerSku === identity.sellerSku,
  );
  if (!item) throw new Error(`Unexpected demo SKU ${identity.sellerSku}`);
  return item;
}

function demoContent(
  identity: CatalogReportsDemoIdentity,
): Pick<
  ListingContentSnapshot,
  | "asin"
  | "productType"
  | "title"
  | "itemHighlight"
  | "bulletPoints"
  | "productDescription"
  | "ingredients"
  | "status"
  | "updatedAt"
> {
  const item = catalogItem(identity);
  return {
    asin: item.asin,
    productType: "PET_SUPPLIES",
    title: item.title,
    itemHighlight: `Highlight ${identity.sellerSku}`,
    bulletPoints: [`Bullet ${identity.sellerSku}`],
    productDescription: `Description ${identity.sellerSku}`,
    ingredients: "Turkey.",
    status: ["BUYABLE", "DISCOVERABLE"],
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
}

function demoBusinessPricing(
  identity: CatalogReportsDemoIdentity,
): Pick<
  BusinessPricingListingSnapshot,
  | "sellerSku"
  | "asin"
  | "title"
  | "productType"
  | "standardPrice"
  | "businessPrice"
  | "businessOfferPresence"
  | "quantityDiscountPlan"
  | "quantityDiscountPlanPresence"
> {
  const item = catalogItem(identity);
  const base = {
    sellerSku: identity.sellerSku,
    asin: item.asin,
    title: item.title,
    productType: "PET_SUPPLIES",
    standardPrice: { amount: item.unitAmount, currencyCode: "USD" },
  };
  switch (identity.sellerSku) {
    case "AFA-TRKY-4OZ":
      return {
        ...base,
        businessPrice: { amount: 12.99, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlan: RECOMMENDED_QUANTITY_PLAN,
        quantityDiscountPlanPresence: "canonical",
      };
    case "GTC-CHKN-1LB":
      return {
        ...base,
        businessPrice: { amount: 15.99, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "absent",
      };
    case "AFA-TRKY-285G":
      return {
        ...base,
        businessPrice: null,
        businessOfferPresence: "absent",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "absent",
      };
    default:
      return {
        ...base,
        businessPrice: null,
        businessOfferPresence: "ambiguous",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "ambiguous",
      };
  }
}

function variationMember(
  identity: CatalogReportsDemoIdentity,
): VariationFamilyMember {
  const item = catalogItem(identity);
  if (identity.sellerSku === "ACTL-TRAIN-8OZ") {
    return {
      sellerSku: identity.sellerSku,
      asin: item.asin,
      title: item.title,
      productType: "PET_SUPPLIES",
      status: ["DISCOVERABLE"],
      role: "standalone",
      parentSku: null,
      childSkus: [],
      variationTheme: null,
      dimensions: [],
      fba: true,
      issues: [],
      relationshipSources: [],
    };
  }
  const parentSku = identity.sellerSku === "GTC-CHKN-1LB"
    ? "DEMO-US-CHICKEN-PARENT"
    : "DEMO-US-TURKEY-PARENT";
  return {
    sellerSku: identity.sellerSku,
    asin: item.asin,
    title: item.title,
    productType: "PET_SUPPLIES",
    status: ["BUYABLE", "DISCOVERABLE"],
    role: "child",
    parentSku,
    childSkus: [],
    variationTheme: "SIZE_NAME",
    dimensions: [],
    fba: true,
    issues: [],
    relationshipSources: [
      "relationships",
      "attributes",
      "variationParentSku",
    ],
  };
}

function demoFamily(
  marketplaceId: typeof US,
  sellerSku: string,
): VariationFamilySnapshot {
  const queried = variationMember({ marketplaceId, sellerSku });
  return {
    mode: "demo",
    marketplaceId,
    queriedSku: sellerSku,
    queriedRole: queried.role,
    queried,
    parent: null,
    children: [],
    excludedChildren: [],
    variationTheme: queried.variationTheme,
    dimensionNames: queried.variationTheme ? ["size_name"] : [],
    familyComplete: true,
    fetchedAt: NOW.toISOString(),
    requestIds: [],
    writable: false,
    boundaries: [],
    notice: "demo family",
  };
}

function testSource() {
  const readDemoContent = vi.fn(demoContent);
  const readDemoBusinessPricing = vi.fn(demoBusinessPricing);
  const variationDemo: VariationDemoRuntime = {
    readFamily: vi.fn((marketplaceId, sellerSku) =>
      demoFamily(marketplaceId as typeof US, sellerSku)),
    resolveSellerSkuByAsin: vi.fn(() => "UNUSED"),
  };
  const marketplaceDisplayName = vi.fn(() => "Amazon.com");
  return {
    readDemoContent,
    readDemoBusinessPricing,
    variationDemo,
    marketplaceDisplayName,
    source: createCatalogReportsDemoSource({
      marketplaceDisplayName,
      readDemoContent,
      readDemoBusinessPricing,
      variationDemo,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("catalog reports demo source", () => {
  it("builds the exact FBA-only All Listings rows in catalog order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { source, readDemoContent, marketplaceDisplayName } = testSource();

    const exported = await source.export({ marketplaceId: US });

    expect(exported.fetchedAt).toBe(NOW.toISOString());
    expect(exported.errors).toEqual([]);
    expect(exported.rows.map((row) => row.sellerSku)).toEqual([
      "AFA-TRKY-4OZ",
      "GTC-CHKN-1LB",
      "AFA-TRKY-285G",
      "ACTL-TRAIN-8OZ",
    ]);
    expect(readDemoContent.mock.calls.map(([identity]) => identity)).toEqual(
      exported.rows.map(({ sellerSku }) => ({ marketplaceId: US, sellerSku })),
    );
    expect(marketplaceDisplayName).toHaveBeenCalledTimes(4);
    expect(exported.rows[0]).toEqual({
      marketplace: "Amazon.com",
      sellerSku: "AFA-TRKY-4OZ",
      asin: "B0USAFA004",
      productType: "PET_SUPPLIES",
      title: "Afreschi Turkey Tendon Jerky, 4 oz",
      itemHighlight: "Highlight AFA-TRKY-4OZ",
      bulletPoints: ["Bullet AFA-TRKY-4OZ"],
      productDescription: "Description AFA-TRKY-4OZ",
      ingredients: "Turkey.",
      imageUrls: [1, 2, 3, 4].map((index) =>
        `https://images.example.invalid/AFA-TRKY-4OZ/${index}.jpg`),
      status: "BUYABLE, DISCOVERABLE",
      updatedAt: "2026-08-20T00:00:00.000Z",
      readStatus: "complete",
      readErrors: [],
    });
    expect(exported.rows.slice(1).map((row) => row.imageUrls.length))
      .toEqual([7, 7, 7]);
  });

  it("projects identity and seed DTOs from the same exact export rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { source } = testSource();

    const identity = await source.identity({ marketplaceId: US });
    const seeds = await source.seeds({ marketplaceId: US });

    const expectedRows = demoFbaCatalogRows(US).map(
      ({ sellerSku, asin, title }) => ({ sellerSku, asin, title }),
    );
    expect(identity).toEqual({
      mode: "demo",
      marketplaceId: US,
      fetchedAt: NOW.toISOString(),
      rows: expectedRows,
      notice: "展示資料只供廣告策略表版面測試，不是你的真實 FBA 商品。",
    });
    expect(seeds).toEqual(expectedRows);
  });

  it("keeps B2B status reasons, recommendation flags and summary exact", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { source, readDemoBusinessPricing } = testSource();

    const audit = await source.businessPricingAudit({ marketplaceId: US });

    expect(readDemoBusinessPricing.mock.calls.map(([identity]) => identity))
      .toEqual(demoFbaCatalogRows(US).map(({ sellerSku }) => ({
        marketplaceId: US,
        sellerSku,
      })));
    expect(audit).toMatchObject({
      mode: "demo",
      marketplaceId: US,
      fetchedAt: NOW.toISOString(),
      summary: {
        totalFbaSkuCount: 4,
        configured: 1,
        aboveStandard: 1,
        missing: 1,
        unsupported: 0,
        incomplete: 1,
        recommendedPriceMismatch: 1,
        recommendedQuantityDiscountMismatch: 2,
      },
      notice: "展示快照只供 B2B 價格健檢版面與安全流程測試，不是 Amazon 真實 Business Price。",
    });
    expect(audit.rows.map((row) => ({
      sellerSku: row.sellerSku,
      status: row.status,
      editable: row.editable,
      recommendedPriceMismatch: row.recommendedPriceMismatch,
      recommendedQuantityDiscountMismatch:
        row.recommendedQuantityDiscountMismatch,
      reason: row.reason,
    }))).toEqual([
      {
        sellerSku: "AFA-TRKY-4OZ",
        status: "configured",
        editable: false,
        recommendedPriceMismatch: false,
        recommendedQuantityDiscountMismatch: false,
        reason: "已設定 Amazon Business 價格；展示資料僅供檢視，不會寫入 Amazon。",
      },
      {
        sellerSku: "GTC-CHKN-1LB",
        status: "above_standard",
        editable: false,
        recommendedPriceMismatch: true,
        recommendedQuantityDiscountMismatch: true,
        reason: "Amazon Business 價格高於一般售價；展示資料僅供檢視，不會寫入 Amazon。",
      },
      {
        sellerSku: "AFA-TRKY-285G",
        status: "missing",
        editable: false,
        recommendedPriceMismatch: false,
        recommendedQuantityDiscountMismatch: true,
        reason: "尚未設定 Amazon Business 價格；展示資料僅供檢視，不會寫入 Amazon。",
      },
      {
        sellerSku: "ACTL-TRAIN-8OZ",
        status: "incomplete",
        editable: false,
        recommendedPriceMismatch: false,
        recommendedQuantityDiscountMismatch: false,
        reason: "B2B offer 證據不完整，展示模式已停止編輯。",
      },
    ]);
  });

  it("builds the exact unbound and all-variation audit from family evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { source, variationDemo } = testSource();

    const audit = await source.unboundVariationAudit!({ marketplaceId: US });

    expect(variationDemo.readFamily).toHaveBeenCalledTimes(4);
    expect(audit).toMatchObject({
      mode: "demo",
      marketplaceId: US,
      fetchedAt: NOW.toISOString(),
      rows: [{
        sellerSku: "ACTL-TRAIN-8OZ",
        asin: "B0USACTL08",
        title: "Afreschi Training-Friendly Chicken Treats",
        productType: "PET_SUPPLIES",
        relationshipEvidence: "relationships",
        notice: "展示 relationships 明確沒有 parent；不會寫入 Amazon。",
      }],
      incompleteRows: [],
      summary: {
        totalFbaListings: 4,
        completed: 4,
        unbound: 1,
        boundChildren: 3,
        parentContainers: 0,
        incomplete: 0,
      },
      notice: "展示結果只驗證流程；正式模式會以官方 searchListingsItems 每批最多 20 個 SKU 要求 Amazon relationships 證據。",
    });
    expect(audit.allVariationRows.map((row) => ({
      familySku: row.familySku,
      role: row.role,
      sellerSku: row.sellerSku,
      evidence: row.evidence,
    }))).toEqual([
      {
        familySku: "DEMO-US-CHICKEN-PARENT",
        role: "parent",
        sellerSku: "DEMO-US-CHICKEN-PARENT",
        evidence: "parent-sku-from-verified-child",
      },
      {
        familySku: "DEMO-US-CHICKEN-PARENT",
        role: "child",
        sellerSku: "GTC-CHKN-1LB",
        evidence: "verified-child",
      },
      {
        familySku: "DEMO-US-TURKEY-PARENT",
        role: "parent",
        sellerSku: "DEMO-US-TURKEY-PARENT",
        evidence: "parent-sku-from-verified-child",
      },
      {
        familySku: "DEMO-US-TURKEY-PARENT",
        role: "child",
        sellerSku: "AFA-TRKY-285G",
        evidence: "verified-child",
      },
      {
        familySku: "DEMO-US-TURKEY-PARENT",
        role: "child",
        sellerSku: "AFA-TRKY-4OZ",
        evidence: "verified-child",
      },
    ]);
  });

  it("checks caller cancellation before reads and again after B2B projection", () => {
    const preAborted = new AbortController();
    const preAbortReason = new Error("PRE-ABORTED");
    preAborted.abort(preAbortReason);
    const ports = testSource();

    for (const read of [
      () => ports.source.export({ marketplaceId: US, signal: preAborted.signal }),
      () => ports.source.identity({ marketplaceId: US, signal: preAborted.signal }),
      () => ports.source.seeds({ marketplaceId: US, signal: preAborted.signal }),
      () => ports.source.businessPricingAudit({
        marketplaceId: US,
        signal: preAborted.signal,
      }),
      () => ports.source.unboundVariationAudit!({
        marketplaceId: US,
        signal: preAborted.signal,
      }),
    ]) {
      expect(read).toThrow(preAbortReason);
    }
    expect(ports.readDemoContent).not.toHaveBeenCalled();
    expect(ports.readDemoBusinessPricing).not.toHaveBeenCalled();
    expect(ports.variationDemo.readFamily).not.toHaveBeenCalled();

    const postAborted = new AbortController();
    const postAbortReason = new Error("POST-ABORTED");
    const readDemoBusinessPricing = vi.fn((identity: CatalogReportsDemoIdentity) => {
      const result = demoBusinessPricing(identity);
      if (identity.sellerSku === "ACTL-TRAIN-8OZ") {
        postAborted.abort(postAbortReason);
      }
      return result;
    });
    const postSource = createCatalogReportsDemoSource({
      marketplaceDisplayName: () => "Amazon.com",
      readDemoContent: demoContent,
      readDemoBusinessPricing,
      variationDemo: ports.variationDemo,
    });

    expect(() => postSource.businessPricingAudit({
      marketplaceId: US,
      signal: postAborted.signal,
    })).toThrow(postAbortReason);
    expect(readDemoBusinessPricing).toHaveBeenCalledTimes(4);
  });
});
