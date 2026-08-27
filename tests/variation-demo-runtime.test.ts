import { afterEach, describe, expect, it, vi } from "vitest";
import { demoFbaCatalogRows } from
  "../src/main/amazon/demo-fba-catalog";
import type { ListingPriceIdentity } from
  "../src/main/amazon/listing-price-gateway";
import type { ListingPriceSnapshot } from
  "../src/main/amazon/listing-price-types";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import { createVariationDemoRuntime } from
  "../src/main/amazon/variation-demo-runtime";

const US = "ATVPDKIKX0DER" as const;
const JP = "A1VC38T7YXB528" as const;
const CA = "A2EUQ1WTGCTBG2" as const;
const NOW = new Date("2026-08-27T06:07:08.000Z");

function demoListingPrice(
  identity: ListingPriceIdentity,
): Pick<
  ListingPriceSnapshot,
  | "asin"
  | "title"
  | "productType"
  | "status"
  | "issues"
> {
  const item = demoFbaCatalogRows(identity.marketplaceId).find(
    (candidate) => candidate.sellerSku === identity.sellerSku,
  );
  if (!item) {
    throw new SpApiError("展示資料找不到這個 SKU。", {
      status: 404,
      code: "SKU_NOT_FOUND",
    });
  }
  return {
    asin: item.asin,
    title: item.title,
    productType: "PET_SUPPLIES",
    status: identity.sellerSku.startsWith("ACTL") ||
        identity.sellerSku.startsWith("HERZ")
      ? ["DISCOVERABLE"]
      : ["BUYABLE", "DISCOVERABLE"],
    issues: identity.sellerSku.includes("285")
      ? [{
          code: "DEMO_ATTRIBUTE_WARNING",
          severity: "WARNING",
          message: "建議補充包裝尺寸，避免商品資訊不完整。",
          attributeNames: ["item_package_dimensions"],
        }]
      : [],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("variation demo runtime", () => {
  it("reads the exact US child family through fixed ListingPrice identities", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const readDemoListingPrice = vi.fn(demoListingPrice);
    const runtime = createVariationDemoRuntime({ readDemoListingPrice });

    const snapshot = runtime.readFamily(US, "AFA-TRKY-285G");

    expect(readDemoListingPrice.mock.calls.map(([identity]) => identity))
      .toEqual([
        { marketplaceId: US, sellerSku: "AFA-TRKY-4OZ" },
        { marketplaceId: US, sellerSku: "AFA-TRKY-285G" },
      ]);
    expect(snapshot).toEqual({
      mode: "demo",
      marketplaceId: US,
      queriedSku: "AFA-TRKY-285G",
      queriedRole: "child",
      queried: {
        sellerSku: "AFA-TRKY-285G",
        asin: "B0USAFA285",
        title: "Afreschi Turkey Tendon, 10 oz",
        productType: "PET_SUPPLIES",
        status: ["BUYABLE", "DISCOVERABLE"],
        role: "child",
        parentSku: "DEMO-US-TURKEY-PARENT",
        childSkus: [],
        variationTheme: "SIZE_NAME",
        dimensions: [{
          name: "size_name",
          label: "Size Name",
          values: ["10 oz"],
        }],
        fba: true,
        issues: [{
          code: "DEMO_ATTRIBUTE_WARNING",
          severity: "WARNING",
          message: "建議補充包裝尺寸，避免商品資訊不完整。",
          attributeNames: ["item_package_dimensions"],
        }],
        relationshipSources: [
          "relationships",
          "attributes",
          "variationParentSku",
        ],
      },
      parent: {
        sellerSku: "DEMO-US-TURKEY-PARENT",
        asin: null,
        title: "US 展示 Parent 容器",
        productType: "PET_SUPPLIES",
        status: [],
        role: "parent",
        parentSku: null,
        childSkus: ["AFA-TRKY-4OZ", "AFA-TRKY-285G"],
        variationTheme: "SIZE_NAME",
        dimensions: [{
          name: "size_name",
          label: "Size Name",
          values: [],
        }],
        fba: false,
        issues: [],
        relationshipSources: ["relationships", "attributes"],
      },
      children: [
        expect.objectContaining({
          sellerSku: "AFA-TRKY-4OZ",
          asin: "B0USAFA004",
          role: "child",
          parentSku: "DEMO-US-TURKEY-PARENT",
          dimensions: [{
            name: "size_name",
            label: "Size Name",
            values: ["4 oz"],
          }],
          fba: true,
        }),
        expect.objectContaining({
          sellerSku: "AFA-TRKY-285G",
          asin: "B0USAFA285",
          role: "child",
          parentSku: "DEMO-US-TURKEY-PARENT",
          dimensions: [{
            name: "size_name",
            label: "Size Name",
            values: ["10 oz"],
          }],
          fba: true,
        }),
      ],
      excludedChildren: [],
      variationTheme: "SIZE_NAME",
      dimensionNames: ["size_name"],
      familyComplete: true,
      fetchedAt: NOW.toISOString(),
      requestIds: [],
      writable: false,
      boundaries: [
        "展示 family 快照與預檢不會送出 PUT、PATCH 或 DELETE。",
        "既有子商品改掛另一個 parent 需要先移除舊關係再重建，屬於非原子流程。",
        "正式模式只允許固定的兩階段 Validation Preview、Notebook 鑰匙（Touch ID／Windows Hello）確認、持久防重送、單次 PATCH 與唯讀回查。",
        "Parent 僅作為不可售的唯讀容器例外；所有可拖移 child 都必須可確認為 FBA。",
      ],
      notice: "展示 family 只供拖拉規劃測試；Amazon 不會收到任何變更。",
    });
  });

  it.each([
    {
      marketplaceId: JP,
      parentSku: "DEMO-JP-TURKEY-PARENT",
      title: "JP 展示 Parent 容器",
      childSkus: ["AFA100-JP", "AFA285-JP"],
    },
    {
      marketplaceId: CA,
      parentSku: "DEMO-US-CHICKEN-PARENT",
      title: "CA 展示 Parent 容器",
      childSkus: ["GTC-CHKN-1LB"],
    },
  ] as const)(
    "uses $marketplaceId metadata for the fixed demo parent container",
    ({ marketplaceId, parentSku, title, childSkus }) => {
      const runtime = createVariationDemoRuntime({
        readDemoListingPrice: demoListingPrice,
      });

      expect(runtime.readFamily(marketplaceId, parentSku)).toMatchObject({
        queriedSku: parentSku,
        queriedRole: "parent",
        queried: {
          sellerSku: parentSku,
          title,
          role: "parent",
          childSkus,
          fba: false,
        },
        parent: {
          sellerSku: parentSku,
          title,
        },
      });
    },
  );

  it("keeps a catalog listing outside fixed families as an FBA standalone", () => {
    const runtime = createVariationDemoRuntime({
      readDemoListingPrice: demoListingPrice,
    });

    expect(runtime.readFamily(US, "ACTL-TRAIN-8OZ")).toMatchObject({
      queriedSku: "ACTL-TRAIN-8OZ",
      queriedRole: "standalone",
      queried: {
        sellerSku: "ACTL-TRAIN-8OZ",
        asin: "B0USACTL08",
        title: "Afreschi Training-Friendly Chicken Treats",
        productType: "PET_SUPPLIES",
        status: ["DISCOVERABLE"],
        role: "standalone",
        parentSku: null,
        childSkus: [],
        variationTheme: null,
        dimensions: [],
        fba: true,
        relationshipSources: [],
      },
      parent: null,
      children: [],
      variationTheme: null,
      dimensionNames: [],
    });
  });

  it("resolves exact built-in ASINs and preserves invalid/not-found errors", () => {
    const runtime = createVariationDemoRuntime({
      readDemoListingPrice: demoListingPrice,
    });

    expect(runtime.resolveSellerSkuByAsin(US, "B0USAFA004"))
      .toBe("AFA-TRKY-4OZ");
    expect(runtime.resolveSellerSkuByAsin(JP, "B0JPFA2851"))
      .toBe("AFA285-JP");

    expect(() => runtime.resolveSellerSkuByAsin(US, " B0USAFA004"))
      .toThrowError(expect.objectContaining({
        status: 400,
        code: "INVALID_INPUT",
        message: "ASIN 必須是原樣 10 碼大寫英數字。",
      }));
    expect(() => runtime.resolveSellerSkuByAsin(US, "B000000000"))
      .toThrowError(expect.objectContaining({
        status: 404,
        code: "ASIN_NOT_FOUND",
        message: "展示資料找不到這個 ASIN。",
      }));
  });
});
