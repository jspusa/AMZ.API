import { throwIfAborted as assertNotAborted } from "../abort-utils";
import {
  marketplaceByCode,
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  assertReplenishmentRequestBody,
  fetchFbaSubscriptionAuditHistory,
  officialCompleteMonthlyIntervals,
} from "./replenishment-audit";
import {
  assertSellerReplenishmentMarketplace,
  readFbaSubscriptionAuditInputs,
  readSubscribeAndSaveOffer as readLiveSubscribeAndSaveOffer,
  subscriptionInventoryEvidence,
  type CurrentFbaSkuEvidence,
  type FbaInventoryReplenishmentAdapter,
  type SubscriptionAuditSnapshot,
  type SubscribeAndSaveOfferSnapshot,
} from "./fba-inventory-replenishment";
import type { ListingPriceSnapshot } from "./listing-price-types";

export type SubscriptionReadsMode = "live" | "demo";

export type SubscriptionReadsPort = Readonly<{
  getSubscribeAndSaveOffer(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): Promise<SubscribeAndSaveOfferSnapshot>;
  getFbaSubscriptionAudit(input: Readonly<{
    marketplaceId: MarketplaceId;
    months: number;
    now?: Date;
    signal?: AbortSignal;
  }>): Promise<SubscriptionAuditSnapshot>;
}>;

export type SubscriptionReadsDependencies = Readonly<{
  resolveMode(marketplaceId: MarketplaceId): SubscriptionReadsMode;
  inventoryAdapter: FbaInventoryReplenishmentAdapter;
  readDemoListingPrice(
    marketplaceId: MarketplaceId,
    sellerSku: string,
  ): Pick<
    ListingPriceSnapshot,
    "asin" | "standardPrice" | "fulfillmentAvailability"
  >;
  clock?: () => Date;
}>;

const JP_MARKETPLACE_ID = marketplaceByCode("JP").id;

function demoSubscribeAndSaveOffer(
  input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>,
  dependencies: SubscriptionReadsDependencies,
  now: Date,
): SubscribeAndSaveOfferSnapshot {
  const listing = dependencies.readDemoListingPrice(
    input.marketplaceId,
    input.sellerSku,
  );
  const fba = listing.fulfillmentAvailability.find(
    (availability) => availability.fulfillment === "FBA",
  );
  const found = Boolean(fba);
  const isJapan = input.marketplaceId === JP_MARKETPLACE_ID;
  const hasInventory = (fba?.quantity ?? 0) > 0;
  return {
    mode: "demo",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    found,
    asin: found ? listing.asin : null,
    eligibility: found ? (hasInventory ? "ELIGIBLE" : "SUSPENDED") : null,
    enrollmentMethod: found ? "AUTOMATIC" : null,
    autoEnrollment: found ? "OPTED_IN" : null,
    sellerFundedBaseDiscount: found ? 5 : null,
    sellerFundedTieredDiscount: found ? 5 : null,
    amazonFundedBaseDiscount: found ? 0 : null,
    amazonFundedTieredDiscount: found ? 5 : null,
    price: found ? listing.standardPrice : null,
    inventory: found ? (fba?.quantity ?? null) : null,
    subscriptions: found ? (isJapan ? 19 : 42) : null,
    stockRisk: found ? (hasInventory ? "LOW" : "HIGH") : null,
    forecastDeliveries: found
      ? {
          next15Days: isJapan ? 7 : 14,
          next30Days: isJapan ? 13 : 27,
          next60Days: isJapan ? 26 : 53,
          next90Days: isJapan ? 38 : 78,
        }
      : null,
    deliveryConditions: found
      ? [
          {
            condition: hasInventory
              ? "NO_ISSUES_FOR_NEXT_30_DAYS_DELIVERIES"
              : "NEXT_30_DAYS_DELIVERIES_AT_LOW_INVENTORY_RISK",
            next30DaysDeliveries: isJapan ? 13 : 27,
          },
        ]
      : [],
    fetchedAt: now.toISOString(),
    requestId: null,
    rateLimit: "1 request/second",
    notice: found
      ? "展示資料模擬 Replenishment API；此頁不會變更 Amazon Subscribe & Save。"
      : "展示資料中，此 SKU 沒有 Subscribe & Save offer；真實模式會向 Amazon 查詢。",
    writable: false,
  };
}

function demoSubscriptionAuditOffer(
  marketplaceId: MarketplaceId,
  index: number,
): Record<string, unknown> {
  const marketplace = marketplaceById(marketplaceId)!;
  const discount = [0, 5, 10, 15, 20][index] ?? 0;
  return {
    marketplaceId,
    programType: "SUBSCRIBE_AND_SAVE",
    sku: `DEMO-SNS-${index + 1}`,
    asin: `B${String(index + 1).padStart(9, "0")}`,
    eligibility: "ELIGIBLE",
    price: marketplace.currency === "JPY"
      ? 1_980 + index * 100
      : 17.99 + index,
    priceCurrencyCode: marketplace.currency,
    subscriptions: 12 + index * 7,
    inventory: 100 + index * 10,
    stockRisk: "LOW",
    offerProgramConfiguration: {
      enrollmentMethod: "MANUAL",
      preferences: { autoEnrollment: "OPTED_IN" },
      promotions: {
        sellingPartnerFundedBaseDiscount: { percentage: discount },
        sellingPartnerFundedTieredDiscount: { percentage: discount },
      },
    },
    forecastDeliveries: {
      next15DaysDeliveries: 3 + index,
      next30DaysDeliveries: 6 + index,
      next60DaysDeliveries: 12 + index,
      next90DaysDeliveries: 18 + index,
    },
    deliveriesConditions: [],
  };
}

async function demoSubscriptionAudit(
  marketplaceId: MarketplaceId,
  months: number,
  now: Date,
): Promise<SubscriptionAuditSnapshot> {
  const marketplace = marketplaceById(marketplaceId)!;
  const intervals = officialCompleteMonthlyIntervals(months, now);
  const offers = Array.from({ length: 5 }, (_, index) =>
    demoSubscriptionAuditOffer(marketplaceId, index),
  );
  const knownFbaSkus = new Set(offers.map((offer) => String(offer.sku)));
  const currentFba: CurrentFbaSkuEvidence = {
    knownFbaSkus,
    returnedInventoryRows: knownFbaSkus.size,
    unrecognizedSellerSkuRows: 0,
  };
  const audit = await fetchFbaSubscriptionAuditHistory({
    marketplaceId,
    metricIntervals: intervals,
    knownFbaSkus,
    now,
    transport: async (request) => {
      assertReplenishmentRequestBody(request);
      if (request.operation === "listOffers") {
        return { offers, pagination: { totalResults: offers.length } };
      }
      const filters = request.body.filters as Record<string, unknown>;
      const interval = filters.timeInterval as Record<string, unknown>;
      const month = String(interval.startDate).slice(0, 7);
      const monthIndex = intervals.findIndex((item) => item.month === month);
      const metricRows = offers
        // Missing Amazon data remains missing; the UI must never invent zero.
        .filter((_offer, index) => !(index === 4 && monthIndex === 0))
        .map((offer, index) => ({
          marketplaceId,
          programType: "SUBSCRIBE_AND_SAVE",
          sku: offer.sku,
          asin: offer.asin,
          fulfillmentChannelType: "AMAZON",
          timeInterval: {
            startDate: interval.startDate,
            endDate: interval.endDate,
          },
          currencyCode: marketplace.currency,
          totalSubscriptionsRevenue: 500 + monthIndex * 35 + index * 15,
          shippedSubscriptionUnits: 20 + monthIndex + index,
          activeSubscriptions: 12 + monthIndex + index * 7,
          notDeliveredDueToOOS: 0,
          lostRevenueDueToOOS: 0,
        }));
      return {
        offers: metricRows,
        pagination: { totalResults: metricRows.length },
      };
    },
  });
  return {
    ...audit,
    mode: "demo",
    marketplaceId,
    requestedMonths: months,
    fetchedAt: now.toISOString(),
    inventoryEvidence: subscriptionInventoryEvidence(
      currentFba,
      audit.offers.length,
    ),
    notice:
      "展示資料只用來驗證全站 FBA Subscribe & Save 健檢、FBA／offer 覆蓋、缺月與 Excel 流程；未取得可核對 offer（未回傳或資料值無法安全解析）不代表不符合資格或 0 訂閱，也不會連線或寫入 Amazon。",
  };
}

export function createSubscriptionReads(
  dependencies: SubscriptionReadsDependencies,
): SubscriptionReadsPort {
  const clock = dependencies.clock ?? (() => new Date());

  return {
    async getSubscribeAndSaveOffer(input) {
      assertSellerReplenishmentMarketplace(input.marketplaceId);
      if (dependencies.resolveMode(input.marketplaceId) === "demo") {
        return demoSubscribeAndSaveOffer(input, dependencies, clock());
      }
      return readLiveSubscribeAndSaveOffer(input, {
        adapter: dependencies.inventoryAdapter,
        clock,
      });
    },

    async getFbaSubscriptionAudit(input) {
      assertNotAborted(input.signal);
      const now = input.now
        ? new Date(input.now.getTime())
        : new Date(clock().getTime());
      officialCompleteMonthlyIntervals(input.months, now);
      assertSellerReplenishmentMarketplace(input.marketplaceId);
      if (dependencies.resolveMode(input.marketplaceId) === "demo") {
        assertNotAborted(input.signal);
        return demoSubscriptionAudit(
          input.marketplaceId,
          input.months,
          now,
        );
      }
      const { audit, currentFba, inventoryEvidence } =
        await readFbaSubscriptionAuditInputs(
          {
            marketplaceId: input.marketplaceId,
            months: input.months,
            now,
            signal: input.signal,
          },
          { adapter: dependencies.inventoryAdapter },
        );
      assertNotAborted(input.signal);
      return {
        ...audit,
        mode: "live",
        marketplaceId: input.marketplaceId,
        requestedMonths: input.months,
        fetchedAt: now.toISOString(),
        inventoryEvidence,
        notice: currentFba.unrecognizedSellerSkuRows > 0
          ? `本頁已完整讀取同次 FBA Inventory 分頁；其中 ${currentFba.unrecognizedSellerSkuRows} 列 Seller SKU 無法原樣辨識，已保留為覆蓋不完整，未 trim、改名、推定不符合資格或計為 0。其餘可原樣核對的 FBA SKU 照常比對；月度 PERFORMANCE 缺值維持缺值。`
          : "本頁以同次完整分頁 FBA Inventory API 作為總範圍，分開顯示可核對 Replenishment offer 與未取得可核對 offer（未回傳或資料值無法安全解析）的 FBA SKU；後者不代表不符合資格或 0 訂閱。Replenishment offers 全站只抓一次；月度 PERFORMANCE 缺值維持缺值，不補 0。",
      };
    },
  };
}
