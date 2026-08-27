import {
  marketplaceByCode,
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { demoFbaCatalogRows } from "./demo-fba-catalog";
import type { ListingPriceIdentity } from "./listing-price-gateway";
import type { ListingPriceSnapshot } from "./listing-price-types";
import { SpApiError } from "./sp-api-error";
import type {
  VariationFamilyMember,
  VariationFamilySnapshot,
} from "./variation-family";

const JP_MARKETPLACE_ID = marketplaceByCode("JP").id;

type VariationDemoListing = Pick<
  ListingPriceSnapshot,
  | "asin"
  | "title"
  | "productType"
  | "status"
  | "issues"
>;

export type VariationDemoRuntimeDependencies = Readonly<{
  readDemoListingPrice(identity: ListingPriceIdentity): VariationDemoListing;
}>;

export type VariationDemoRuntime = Readonly<{
  readFamily(
    marketplaceId: MarketplaceId,
    sellerSku: string,
  ): VariationFamilySnapshot;
  resolveSellerSkuByAsin(
    marketplaceId: MarketplaceId,
    asin: string,
  ): string;
}>;

type DemoVariationChild = Readonly<{
  sellerSku: string;
  value: string;
}>;

type DemoVariationFamily = Readonly<{
  parentSku: string;
  theme: string;
  dimensionName: string;
  children: readonly DemoVariationChild[];
}>;

function demoVariationFamilies(
  marketplaceId: MarketplaceId,
): readonly DemoVariationFamily[] {
  return marketplaceId === JP_MARKETPLACE_ID
    ? [
        {
          parentSku: "DEMO-JP-TURKEY-PARENT",
          theme: "SIZE_NAME",
          dimensionName: "size_name",
          children: [
            { sellerSku: "AFA100-JP", value: "100 g" },
            { sellerSku: "AFA285-JP", value: "285 g" },
          ],
        },
        {
          parentSku: "DEMO-JP-CHICKEN-PARENT",
          theme: "SIZE_NAME",
          dimensionName: "size_name",
          children: [{ sellerSku: "GTC454-JP", value: "454 g" }],
        },
      ]
    : [
        {
          parentSku: "DEMO-US-TURKEY-PARENT",
          theme: "SIZE_NAME",
          dimensionName: "size_name",
          children: [
            { sellerSku: "AFA-TRKY-4OZ", value: "4 oz" },
            { sellerSku: "AFA-TRKY-285G", value: "10 oz" },
          ],
        },
        {
          parentSku: "DEMO-US-CHICKEN-PARENT",
          theme: "SIZE_NAME",
          dimensionName: "size_name",
          children: [{ sellerSku: "GTC-CHKN-1LB", value: "1 lb" }],
        },
      ];
}

function demoVariationChild(
  dependencies: VariationDemoRuntimeDependencies,
  marketplaceId: MarketplaceId,
  family: DemoVariationFamily,
  child: DemoVariationChild,
): VariationFamilyMember {
  const listing = dependencies.readDemoListingPrice({
    marketplaceId,
    sellerSku: child.sellerSku,
  });
  return {
    sellerSku: child.sellerSku,
    asin: listing.asin,
    title: listing.title,
    productType: listing.productType,
    status: listing.status,
    role: "child",
    parentSku: family.parentSku,
    childSkus: [],
    variationTheme: family.theme,
    dimensions: [
      {
        name: family.dimensionName,
        label: "Size Name",
        values: [child.value],
      },
    ],
    fba: true,
    issues: listing.issues,
    relationshipSources: [
      "relationships",
      "attributes",
      "variationParentSku",
    ],
  };
}

function demoVariationParent(
  marketplaceId: MarketplaceId,
  family: DemoVariationFamily,
): VariationFamilyMember {
  const marketplace = marketplaceById(marketplaceId)!;
  return {
    sellerSku: family.parentSku,
    asin: null,
    title: `${marketplace.shortLabel} 展示 Parent 容器`,
    productType: "PET_SUPPLIES",
    status: [],
    role: "parent",
    parentSku: null,
    childSkus: family.children.map((child) => child.sellerSku),
    variationTheme: family.theme,
    dimensions: [
      { name: family.dimensionName, label: "Size Name", values: [] },
    ],
    fba: false,
    issues: [],
    relationshipSources: ["relationships", "attributes"],
  };
}

function readDemoVariationFamily(
  dependencies: VariationDemoRuntimeDependencies,
  marketplaceId: MarketplaceId,
  sellerSku: string,
): VariationFamilySnapshot {
  const families = demoVariationFamilies(marketplaceId);
  const family = families.find(
    (candidate) =>
      candidate.parentSku === sellerSku ||
      candidate.children.some((child) => child.sellerSku === sellerSku),
  );
  let queried: VariationFamilyMember;
  let parent: VariationFamilyMember | null = null;
  let children: VariationFamilyMember[] = [];
  if (family) {
    parent = demoVariationParent(marketplaceId, family);
    children = family.children.map((child) =>
      demoVariationChild(dependencies, marketplaceId, family, child)
    );
    queried = sellerSku === family.parentSku
      ? parent
      : children.find((child) => child.sellerSku === sellerSku) ?? children[0]!;
  } else {
    const listing = dependencies.readDemoListingPrice({
      marketplaceId,
      sellerSku,
    });
    queried = {
      sellerSku,
      asin: listing.asin,
      title: listing.title,
      productType: listing.productType,
      status: listing.status,
      role: "standalone",
      parentSku: null,
      childSkus: [],
      variationTheme: null,
      dimensions: [],
      fba: true,
      issues: listing.issues,
      relationshipSources: [],
    };
  }
  return {
    mode: "demo",
    marketplaceId,
    queriedSku: sellerSku,
    queriedRole: queried.role,
    queried,
    parent,
    children,
    excludedChildren: [],
    variationTheme: family?.theme ?? null,
    dimensionNames: family ? [family.dimensionName] : [],
    familyComplete: true,
    fetchedAt: new Date().toISOString(),
    requestIds: [],
    writable: false,
    boundaries: [
      "展示 family 快照與預檢不會送出 PUT、PATCH 或 DELETE。",
      "既有子商品改掛另一個 parent 需要先移除舊關係再重建，屬於非原子流程。",
      "正式模式只允許固定的兩階段 Validation Preview、Notebook 鑰匙（Touch ID／Windows Hello）確認、持久防重送、單次 PATCH 與唯讀回查。",
      "Parent 僅作為不可售的唯讀容器例外；所有可拖移 child 都必須可確認為 FBA。",
    ],
    notice: "展示 family 只供拖拉規劃測試；Amazon 不會收到任何變更。",
  };
}

function resolveDemoSellerSkuByAsin(
  marketplaceId: MarketplaceId,
  asin: string,
): string {
  if (!/^[A-Z0-9]{10}$/u.test(asin)) {
    throw new SpApiError("ASIN 必須是原樣 10 碼大寫英數字。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  const sellerSkus = [
    ...new Set(
      demoFbaCatalogRows(marketplaceId)
        .filter((item) => item.asin === asin)
        .map((item) => item.sellerSku),
    ),
  ];
  if (sellerSkus.length === 0) {
    throw new SpApiError("展示資料找不到這個 ASIN。", {
      status: 404,
      code: "ASIN_NOT_FOUND",
    });
  }
  if (sellerSkus.length > 1) {
    throw new SpApiError(
      "展示 ASIN 對應多個 Seller SKU；請選擇確切 SKU。",
      { status: 409, code: "ASIN_AMBIGUOUS" },
    );
  }
  return sellerSkus[0]!;
}

/** Deterministic read-only variation family behavior for demo composition. */
export function createVariationDemoRuntime(
  dependencies: VariationDemoRuntimeDependencies,
): VariationDemoRuntime {
  return Object.freeze({
    readFamily: (marketplaceId, sellerSku) =>
      readDemoVariationFamily(dependencies, marketplaceId, sellerSku),
    resolveSellerSkuByAsin: (marketplaceId, asin) =>
      resolveDemoSellerSkuByAsin(marketplaceId, asin),
  });
}
