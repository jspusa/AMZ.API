import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrandSalesDemoSource } from
  "../src/main/amazon/brand-sales-demo";
import { createSalesAndTrafficDemoSource } from
  "../src/main/amazon/sales-and-traffic-demo";
import { planFbaShipmentSalesWindow } from
  "../src/main/amazon/revenue-report-windows";
import type { FbaCatalogSeed } from
  "../src/main/amazon/catalog-report-reads";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const LISTINGS: readonly FbaCatalogSeed[] = [
  {
    sellerSku: "AFA-TRKY-4OZ",
    asin: "B0USAFA004",
    title: "Afreschi Turkey Tendon Jerky, 4 oz",
  },
  {
    sellerSku: "GTC-CHKN-1LB",
    asin: "B0USGTC001",
    title: "GooToE Chicken Jerky Treats, 1 lb",
  },
  {
    sellerSku: "AFA-TRKY-285G",
    asin: "B0USAFA285",
    title: "Afreschi Turkey Tendon, 10 oz",
  },
  {
    sellerSku: "ACTL-TRAIN-8OZ",
    asin: "B0USACTL08",
    title: "Afreschi Training-Friendly Chicken Treats",
  },
];

describe("revenue report demo sources", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("keeps the Brand and Category demo on the injected FBA catalog fixture", async () => {
    const listings = vi.fn(async () => LISTINGS);
    const source = createBrandSalesDemoSource({ listings });
    const snapshot = await source.read(planFbaShipmentSalesWindow({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      now: new Date(),
    }));

    expect(listings).toHaveBeenCalledOnce();
    expect(snapshot.summary).toMatchObject({
      amount: 179.9,
      currentFbaSkuCount: 4,
      soldCurrentFbaSkuCount: 4,
    });
    expect(snapshot.segments.find(({ key }) => key === "afreschi"))
      .toMatchObject({ amount: 148.92, skuCount: 3 });
    expect(snapshot.segments.find(({ key }) => key === "gootoe"))
      .toMatchObject({ amount: 30.98, skuCount: 1 });
    expect(snapshot.categorySegments.find(({ key }) => key === "turkey-tendon"))
      .toMatchObject({ amount: 66.96, skuCount: 2 });
    expect(snapshot.categorySegments.find(({ key }) => key === "chicken"))
      .toMatchObject({ amount: 112.94, skuCount: 2 });
  });

  it("keeps Sales & Traffic identities and deterministic values aligned to the same fixture", async () => {
    const listings = vi.fn(async () => LISTINGS);
    const source = createSalesAndTrafficDemoSource({ listings });
    const snapshot = await source.read({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });

    expect(listings).toHaveBeenCalledOnce();
    expect(snapshot.rows).toEqual([
      {
        sellerSku: "AFA-TRKY-4OZ",
        childAsin: "B0USAFA004",
        unitsOrdered: 12,
        orderedProductSales: 299.88,
        currencyCode: "USD",
      },
      {
        sellerSku: "GTC-CHKN-1LB",
        childAsin: "B0USGTC001",
        unitsOrdered: 10,
        orderedProductSales: 299.9,
        currencyCode: "USD",
      },
      {
        sellerSku: "AFA-TRKY-285G",
        childAsin: "B0USAFA285",
        unitsOrdered: 8,
        orderedProductSales: 279.92,
        currencyCode: "USD",
      },
      {
        sellerSku: "ACTL-TRAIN-8OZ",
        childAsin: "B0USACTL08",
        unitsOrdered: 6,
        orderedProductSales: 239.94,
        currencyCode: "USD",
      },
    ]);
  });
});
