import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/amazon/demo-fba-catalog", () => ({
  demoFbaCatalogRows: () => [
    {
      sellerSku: "DEMO-DUPLICATE-ONE",
      asin: "B000000001",
      title: "Duplicate one",
      unitAmount: 1,
    },
    {
      sellerSku: "DEMO-DUPLICATE-TWO",
      asin: "B000000001",
      title: "Duplicate two",
      unitAmount: 2,
    },
  ],
}));

import { createVariationDemoRuntime } from
  "../src/main/amazon/variation-demo-runtime";

const US = "ATVPDKIKX0DER" as const;

describe("variation demo ASIN ambiguity fence", () => {
  it("preserves the exact multiple-SKU error instead of choosing one", () => {
    const runtime = createVariationDemoRuntime({
      readDemoListingPrice: () => {
        throw new Error("ASIN resolution must not read ListingPrice.");
      },
    });

    expect(() => runtime.resolveSellerSkuByAsin(US, "B000000001"))
      .toThrowError(expect.objectContaining({
        status: 409,
        code: "ASIN_AMBIGUOUS",
        message: "展示 ASIN 對應多個 Seller SKU；請選擇確切 SKU。",
      }));
  });
});
