import { buildAdvertisingStrategySnapshot } from "../src/main/amazon/advertising-strategy";

export const ADVERTISING_STRATEGY_MARKETPLACE_ID = "ATVPDKIKX0DER";
export const ADVERTISING_STRATEGY_EXPECTED = {
  marketplaceId: ADVERTISING_STRATEGY_MARKETPLACE_ID,
  startDate: "2026-08-01",
  endDate: "2026-08-07",
  currencyCode: "USD",
} as const;

export function advertisingStrategySnapshotFixture() {
  return buildAdvertisingStrategySnapshot({
    marketplaceId: ADVERTISING_STRATEGY_MARKETPLACE_ID,
    marketplaceCode: "US",
    dateRange: {
      startDate: ADVERTISING_STRATEGY_EXPECTED.startDate,
      endDate: ADVERTISING_STRATEGY_EXPECTED.endDate,
    },
    currencyCode: "USD",
    fetchedAt: "2026-08-08T03:00:00.000Z",
    sourceFetchedAt: {
      fba: "2026-08-08T02:00:00.000Z",
      sales: "2026-08-08T02:15:00.000Z",
      ads: "2026-08-08T02:30:00.000Z",
    },
    listings: [
      { sellerSku: "SKU-A", asin: "B000000001", title: "Synthetic A" },
      { sellerSku: "SKU-B", asin: "B000000002", title: "Synthetic B" },
      { sellerSku: "SKU-C", asin: "B000000003", title: "Synthetic C" },
      { sellerSku: "SKU-D", asin: "B000000003", title: "Synthetic D" },
    ],
    salesRows: [
      { sellerSku: "SKU-A", childAsin: "B000000001", unitsSold: 10, salesAmount: 200, currencyCode: "USD" },
      { sellerSku: "SKU-B", childAsin: "B000000002", unitsSold: 0, salesAmount: 0, currencyCode: "USD" },
      { sellerSku: "SKU-X", childAsin: "B000000009", unitsSold: 2, salesAmount: 30, currencyCode: "USD" },
      { sellerSku: "SKU-C", childAsin: "B000000004", unitsSold: 3, salesAmount: 45, currencyCode: "USD" },
    ],
    spAdvertisedProductRows: [
      {
        sellerSku: "SKU-A",
        asin: "B000000001",
        spend: 35,
        sales14d: 100,
        purchases14d: 2,
        currencyCode: "USD",
      },
      {
        sellerSku: "SKU-B",
        asin: "B000000002",
        spend: 5,
        sales14d: 0,
        purchases14d: 0,
        currencyCode: "USD",
      },
      {
        sellerSku: null,
        asin: "B000000003",
        spend: 9,
        sales14d: null,
        purchases14d: null,
        currencyCode: "USD",
      },
    ],
  });
}
