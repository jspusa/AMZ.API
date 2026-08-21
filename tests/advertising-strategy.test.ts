import { describe, expect, it } from "vitest";
import {
  buildAdvertisingStrategySnapshot,
  type AdvertisingStrategyAdsRow,
  type AdvertisingStrategyFbaListing,
  type AdvertisingStrategySalesRow,
} from "../src/main/amazon/advertising-strategy";

const BASE = {
  marketplaceId: "ATVPDKIKX0DER",
  marketplaceCode: "US",
  dateRange: { startDate: "2026-08-01", endDate: "2026-08-07" },
  currencyCode: "USD",
  fetchedAt: "2026-08-08T03:00:00.000Z",
  sourceFetchedAt: {
    fba: "2026-08-08T02:00:00.000Z",
    sales: "2026-08-08T02:15:00.000Z",
    ads: "2026-08-08T02:30:00.000Z",
  },
} as const;

function listing(sellerSku: string, asin: string): AdvertisingStrategyFbaListing {
  return { sellerSku, asin, title: `Synthetic ${sellerSku}` };
}

describe("FBA advertising strategy snapshot", () => {
  it("uses exact SKU first and only falls back to a unique current-FBA ASIN", () => {
    const snapshot = buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [
        listing("SKU-A", "B000000001"),
        listing("SKU-B", "B000000002"),
        listing("SKU-C", "B000000002"),
        listing("SKU-D", "B000000003"),
      ],
      salesRows: [],
      spAdvertisedProductRows: [
        { sellerSku: "SKU-A", asin: "B000000001", spend: 10, sales14d: 20, purchases14d: 1, currencyCode: "USD" },
        { sellerSku: null, asin: "B000000003", spend: 7, sales14d: 14, purchases14d: 2, currencyCode: "USD" },
        { sellerSku: null, asin: "B000000002", spend: 9, sales14d: 18, purchases14d: 1, currencyCode: "USD" },
        { sellerSku: "NOT-FBA", asin: "B000000003", spend: 5, sales14d: 10, purchases14d: 1, currencyCode: "USD" },
      ],
    });

    expect(snapshot.rows.find((row) => row.sellerSku === "SKU-A")).toMatchObject({
      spSpend: 10,
      spSales14d: 20,
      spActualAcos: 0.5,
      spActualAcosStatus: "reported",
      spAttribution: "seller-sku",
    });
    expect(snapshot.rows.find((row) => row.sellerSku === "SKU-D")).toMatchObject({
      spSpend: 7,
      spAttribution: "unique-asin",
    });
    expect(snapshot.rows.find((row) => row.sellerSku === "SKU-B")?.spSpend).toBeNull();
    expect(snapshot.rows.find((row) => row.sellerSku === "SKU-C")?.spSpend).toBeNull();
    expect(snapshot.unresolved).toEqual([]);
    expect(snapshot.summary).toMatchObject({
      reportedSpSpend: 17,
      unresolvedSpSpend: 0,
      sourceSpSpend: 17,
    });
    expect(snapshot.coverage).toMatchObject({
      spSourceRowCount: 4,
      spResolvedSourceRowCount: 2,
      spUnresolvedSourceRowCount: 2,
      spAnonymousUnprovenSourceRowCount: 2,
      spDirectSourceRowCount: 1,
      spUniqueAsinSourceRowCount: 1,
    });
  });

  it("keeps unproven Sales and Ads rows anonymous and excludes their business metrics", () => {
    const snapshot = buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [listing("SKU-A", "B000000001")],
      salesRows: [
        { sellerSku: "OUTSIDE-SALES", childAsin: "B999999999", unitsSold: 777, salesAmount: 8_123, currencyCode: "USD" },
        { sellerSku: "", childAsin: "B555555555", unitsSold: 333, salesAmount: 4_321, currencyCode: "USD" },
        { sellerSku: "SKU-A", childAsin: "B888888888", unitsSold: 4, salesAmount: 44, currencyCode: "USD" },
      ],
      spAdvertisedProductRows: [
        { sellerSku: "OUTSIDE-ADS", asin: "B777777777", spend: 999, sales14d: 1_999, purchases14d: 55, currencyCode: "USD" },
        { sellerSku: null, asin: null, spend: 555, sales14d: 1_111, purchases14d: 33, currencyCode: "USD" },
        { sellerSku: "SKU-A", asin: "B666666666", spend: 6, sales14d: 12, purchases14d: 1, currencyCode: "USD" },
      ],
    });

    expect(snapshot.unresolved).toEqual([
      expect.objectContaining({
        source: "sales",
        fbaEvidence: "exact-seller-sku",
        sellerSku: "SKU-A",
        asin: "B888888888",
        code: "sales-sku-asin-mismatch",
        unitsSold: 4,
        amount: 44,
      }),
      expect.objectContaining({
        source: "sp-advertised-product",
        fbaEvidence: "exact-seller-sku",
        sellerSku: "SKU-A",
        asin: "B666666666",
        code: "sp-sku-asin-mismatch",
        amount: 6,
      }),
    ]);
    expect(snapshot.coverage).toMatchObject({
      salesSourceRowCount: 3,
      salesResolvedSourceRowCount: 0,
      salesUnresolvedSourceRowCount: 3,
      salesAnonymousUnprovenSourceRowCount: 2,
      spSourceRowCount: 3,
      spResolvedSourceRowCount: 0,
      spUnresolvedSourceRowCount: 3,
      spAnonymousUnprovenSourceRowCount: 2,
    });
    expect(snapshot.summary).toMatchObject({
      reportedUnitsSold: 0,
      unresolvedUnitsSold: 4,
      sourceUnitsSold: 4,
      reportedSalesAmount: 0,
      unresolvedSalesAmount: 44,
      sourceSalesAmount: 44,
      reportedSpSpend: 0,
      unresolvedSpSpend: 6,
      sourceSpSpend: 6,
    });
    const rendererPayload = JSON.stringify(snapshot);
    expect(rendererPayload).not.toContain("OUTSIDE-SALES");
    expect(rendererPayload).not.toContain("OUTSIDE-ADS");
    expect(rendererPayload).not.toContain("B999999999");
    expect(rendererPayload).not.toContain("B555555555");
    expect(rendererPayload).not.toContain("B777777777");
    expect(rendererPayload).not.toContain("8123");
    expect(rendererPayload).not.toContain("4321");
    expect(rendererPayload).not.toContain("1999");
    expect(rendererPayload).not.toContain("1111");
  });

  it("keeps explicit zero separate from a missing report value and never divides by zero", () => {
    const snapshot = buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [
        listing("SKU-A", "B000000001"),
        listing("SKU-B", "B000000002"),
        listing("SKU-C", "B000000003"),
      ],
      salesRows: [
        { sellerSku: "SKU-A", childAsin: "B000000001", unitsSold: 0, salesAmount: 0, currencyCode: "USD" },
      ],
      spAdvertisedProductRows: [
        { sellerSku: "SKU-A", asin: null, spend: 3, sales14d: 0, purchases14d: 0, currencyCode: "USD" },
        { sellerSku: "SKU-C", asin: null, spend: 2, sales14d: null, purchases14d: null, currencyCode: "USD" },
      ],
    });
    const explicitZero = snapshot.rows.find((row) => row.sellerSku === "SKU-A")!;
    const missing = snapshot.rows.find((row) => row.sellerSku === "SKU-B")!;
    const adsMetricMissing = snapshot.rows.find((row) => row.sellerSku === "SKU-C")!;

    expect(explicitZero).toMatchObject({
      unitsSold: 0,
      salesAmount: 0,
      spSpend: 3,
      spSales14d: 0,
      spActualAcos: null,
      spActualAcosStatus: "no-sales",
      spPurchases14d: 0,
    });
    expect(missing).toMatchObject({
      salesStatus: "not-reported",
      unitsSold: null,
      salesAmount: null,
      salesTier: null,
      suggestedSpDailyBudget: null,
      spStatus: "not-reported",
      spSpend: null,
    });
    expect(adsMetricMissing).toMatchObject({
      spStatus: "reported",
      spSpend: 2,
      spSales14d: null,
      spActualAcos: null,
      spActualAcosStatus: "not-reported",
      spPurchases14d: null,
    });
  });

  it("ranks reported sales deterministically and applies ceil 20/50/80 cutoffs", () => {
    const listings = Array.from({ length: 10 }, (_, index) =>
      listing(`SKU-${String(index).padStart(2, "0")}`, `B${String(index + 1).padStart(9, "0")}`),
    );
    const salesRows: AdvertisingStrategySalesRow[] = listings.map((row, index) => ({
      sellerSku: row.sellerSku,
      childAsin: row.asin,
      unitsSold: 10 - index,
      salesAmount: index < 2 ? 100 : 100 - index,
      currencyCode: "USD",
    }));
    const snapshot = buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [...listings].reverse(),
      salesRows: [...salesRows].reverse(),
      spAdvertisedProductRows: [],
    });

    expect(snapshot.rows.map((row) => row.sellerSku).slice(0, 2)).toEqual([
      "SKU-00",
      "SKU-01",
    ]);
    expect(snapshot.summary.tierCounts).toEqual({ T1: 2, T2: 3, T3: 3, T4: 2 });
    expect(snapshot.summary.suggestedSpDailyBudget).toBe(1_150);
    expect(snapshot.rows.map((row) => row.salesTier)).toEqual([
      "T1", "T1", "T2", "T2", "T2", "T3", "T3", "T3", "T4", "T4",
    ]);
  });

  it("does not double count duplicate SKU-granularity sales rows", () => {
    const snapshot = buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [listing("SKU-A", "B000000001")],
      salesRows: [
        { sellerSku: "SKU-A", childAsin: "B000000001", unitsSold: 2, salesAmount: 20, currencyCode: "USD" },
        { sellerSku: "SKU-A", childAsin: "B000000001", unitsSold: 3, salesAmount: 30, currencyCode: "USD" },
      ],
      spAdvertisedProductRows: [],
    });
    expect(snapshot.rows[0]).toMatchObject({
      salesStatus: "not-reported",
      salesAmount: null,
      salesTier: null,
    });
    expect(snapshot.unresolved.map((row) => row.code)).toEqual([
      "sales-duplicate-sku",
      "sales-duplicate-sku",
    ]);
    expect(snapshot.summary).toMatchObject({
      reportedSalesAmount: 0,
      unresolvedSalesAmount: 50,
      sourceSalesAmount: 50,
      reportedUnitsSold: 0,
      unresolvedUnitsSold: 5,
      sourceUnitsSold: 5,
    });
  });

  it("requires the Sales & Traffic child ASIN to match the exact current-FBA SKU", () => {
    const snapshot = buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [listing("SKU-A", "B000000001")],
      salesRows: [{
        sellerSku: "SKU-A",
        childAsin: "B000000099",
        unitsSold: 4,
        salesAmount: 44,
        currencyCode: "USD",
      }],
      spAdvertisedProductRows: [],
    });

    expect(snapshot.rows[0]).toMatchObject({
      sellerSku: "SKU-A",
      price: null,
      salesStatus: "not-reported",
      unitsSold: null,
      salesAmount: null,
    });
    expect(snapshot.unresolved[0]).toMatchObject({
      source: "sales",
      fbaEvidence: "exact-seller-sku",
      sellerSku: "SKU-A",
      asin: "B000000099",
      code: "sales-sku-asin-mismatch",
      unitsSold: 4,
      amount: 44,
    });
    expect(snapshot.summary).toMatchObject({
      reportedSalesAmount: 0,
      unresolvedSalesAmount: 44,
      sourceSalesAmount: 44,
    });
  });

  it("keeps partially missing Ads metrics null when multiple rows aggregate", () => {
    const snapshot = buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [listing("SKU-A", "B000000001")],
      salesRows: [],
      spAdvertisedProductRows: [
        { sellerSku: "SKU-A", asin: null, spend: 2, sales14d: 10, purchases14d: 1, currencyCode: "USD" },
        { sellerSku: "SKU-A", asin: null, spend: 3, sales14d: null, purchases14d: null, currencyCode: "USD" },
      ],
    });
    expect(snapshot.rows[0]).toMatchObject({
      spSpend: 5,
      spSales14d: null,
      spActualAcos: null,
      spActualAcosStatus: "not-reported",
      spPurchases14d: null,
    });
  });

  it("fails closed for mismatched currency and invalid source timestamps", () => {
    expect(() => buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [listing("SKU-A", "B000000001")],
      salesRows: [
        { sellerSku: "SKU-A", childAsin: "B000000001", unitsSold: 1, salesAmount: 10, currencyCode: "CAD" },
      ],
      spAdvertisedProductRows: [],
    })).toThrow(/不同幣別/u);
    expect(() => buildAdvertisingStrategySnapshot({
      ...BASE,
      sourceFetchedAt: { ...BASE.sourceFetchedAt, ads: "not-a-date" },
      listings: [],
      salesRows: [],
      spAdvertisedProductRows: [],
    })).toThrow(/來源快照時間/u);
    expect(() => buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [listing("SKU\u200b-A", "B000000001")],
      salesRows: [],
      spAdvertisedProductRows: [],
    })).toThrow(/FBA 商品清單/u);
    expect(() => buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [{
        sellerSku: "SKU-A",
        asin: "B000000001",
        title: "Synthetic\u202e title",
      }],
      salesRows: [],
      spAdvertisedProductRows: [],
    })).toThrow(/FBA 商品清單/u);
    expect(() => buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [{
        ...listing("SKU-A", "B000000001"),
        price: 10,
      } as unknown as AdvertisingStrategyFbaListing],
      salesRows: [],
      spAdvertisedProductRows: [],
    })).toThrow(/FBA 商品清單/u);
  });

  it("fails closed before iterating source arrays above their documented limits", () => {
    expect(() => buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: new Array<AdvertisingStrategyFbaListing>(100_001),
      salesRows: [],
      spAdvertisedProductRows: [],
    })).toThrow(/安全筆數限制/u);
    expect(() => buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [],
      salesRows: new Array<AdvertisingStrategySalesRow>(100_001),
      spAdvertisedProductRows: [],
    })).toThrow(/安全筆數限制/u);
    expect(() => buildAdvertisingStrategySnapshot({
      ...BASE,
      listings: [],
      salesRows: [],
      spAdvertisedProductRows: new Array<AdvertisingStrategyAdsRow>(50_001),
    })).toThrow(/安全筆數限制/u);
  });
});
