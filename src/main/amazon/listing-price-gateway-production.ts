import {
  MARKETPLACES,
  marketplaceByCode,
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { demoFbaCatalogRows } from "./demo-fba-catalog";
import {
  listingPricePatchBody,
  type ListingPriceGateway,
  type ListingPriceIdentity,
} from "./listing-price-gateway";
import type {
  ListingPriceSnapshot,
  SalePriceSchedule,
} from "./listing-price-types";
import type { ListingsWriteProduction } from "./listings-write-production";
import { SpApiError, type ListingIssue } from "./sp-api-error";

const JP_MARKETPLACE_ID = marketplaceByCode("JP").id;

type ListingPriceMode = "live" | "demo";

export type ListingPriceGatewayProductionDependencies = Readonly<{
  resolveMode(marketplaceId: MarketplaceId): ListingPriceMode;
  readLive(input: ListingPriceIdentity): Promise<ListingPriceSnapshot>;
  write: ListingsWriteProduction;
}>;

export type ListingPriceGatewayProductionRuntime = Readonly<{
  gateway: ListingPriceGateway;
  readDemo(input: ListingPriceIdentity): ListingPriceSnapshot;
  clear(): void;
}>;

type DemoSalePriceOverride = Readonly<{
  amount: number;
  startAt: string;
  endAt: string;
}> | null;

function demoPriceKey(input: ListingPriceIdentity): string {
  return `${input.marketplaceId}:${input.sellerSku}`;
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/**
 * Fixed Standard/Sale Price production boundary.
 *
 * Demo mutations share one private state with every demo reader. Live reads
 * and Listings writes remain injected fixed ports; callers cannot supply raw
 * transport controls or an arbitrary Listings body.
 */
export function createListingPriceGatewayProduction(
  dependencies: ListingPriceGatewayProductionDependencies,
): ListingPriceGatewayProductionRuntime {
  const standardPriceOverrides = new Map<string, number>();
  const salePriceOverrides = new Map<string, DemoSalePriceOverride>();

  const readDemo = (
    input: ListingPriceIdentity,
  ): ListingPriceSnapshot => {
    const marketplace = marketplaceById(input.marketplaceId);
    if (!marketplace) {
      throw new SpApiError("不支援的 Amazon 站點。", {
        status: 400,
        code: "UNSUPPORTED_MARKETPLACE",
      });
    }
    const item = demoFbaCatalogRows(input.marketplaceId)
      .find((candidate) => candidate.sellerSku === input.sellerSku);

    if (!item) {
      throw new SpApiError(
        `展示資料找不到這個 SKU。可先試用 ${marketplace.sampleSku ?? MARKETPLACES[0].sampleSku}。`,
        { status: 404, code: "SKU_NOT_FOUND" },
      );
    }

    const key = demoPriceKey(input);
    const amount = standardPriceOverrides.get(key) ?? item.unitAmount;
    const price = { amount, currencyCode: marketplace.currency };
    const demoSale = salePriceOverrides.has(key)
      ? (salePriceOverrides.get(key) ?? null)
      : null;
    const discountedPrice: SalePriceSchedule | null = demoSale
      ? {
          price: {
            amount: demoSale.amount,
            currencyCode: marketplace.currency,
          },
          startAt: demoSale.startAt,
          endAt: demoSale.endAt,
        }
      : null;
    const isUnavailable = input.sellerSku.startsWith("ACTL") ||
      input.sellerSku.startsWith("HERZ");
    const hasWarning = input.sellerSku.includes("285");
    const quantity = isUnavailable
      ? 0
      : input.sellerSku.includes("285")
        ? 7
        : input.marketplaceId === JP_MARKETPLACE_ID
          ? 24
          : 38;
    const issues: ListingIssue[] = isUnavailable
      ? [
          {
            code: "DEMO_NO_INVENTORY",
            severity: "ERROR",
            message: "目前沒有可售庫存，商品暫時無法購買。",
            attributeNames: ["fulfillment_availability"],
          },
        ]
      : hasWarning
        ? [
            {
              code: "DEMO_ATTRIBUTE_WARNING",
              severity: "WARNING",
              message: "建議補充包裝尺寸，避免商品資訊不完整。",
              attributeNames: ["item_package_dimensions"],
            },
          ]
        : [];

    return {
      mode: "demo",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      asin: item.asin,
      title: item.title,
      productType: "PET_SUPPLIES",
      status: isUnavailable ? ["DISCOVERABLE"] : ["BUYABLE", "DISCOVERABLE"],
      createdAt: isoHoursAgo(24 * 180),
      updatedAt: isoHoursAgo(hasWarning ? 72 : 12),
      standardPrice: price,
      effectivePrice: discountedPrice?.price ?? price,
      minimumPrice: null,
      maximumPrice: null,
      purchasableOfferPresence: "present",
      discountedPrice,
      discountedPricePresence: discountedPrice ? "valid" : "absent",
      hasDiscountedPrice: Boolean(discountedPrice),
      hasAutomatedPricing: false,
      fetchedAt: new Date().toISOString(),
      requestId: null,
      issues,
      fulfillmentAvailability: [
        {
          channelCode: input.marketplaceId === JP_MARKETPLACE_ID
            ? "AMAZON_JP"
            : "AMAZON_NA",
          quantity,
          fulfillment: "FBA",
          editable: false,
        },
      ],
      notice: "展示模式只會模擬價格與商品內容變更，不會更動 Amazon。",
    };
  };

  const gateway: ListingPriceGateway = {
    mode: dependencies.resolveMode,
    read: async (input) =>
      dependencies.resolveMode(input.marketplaceId) === "demo"
        ? readDemo(input)
        : dependencies.readLive(input),
    setDemoStandardPrice: (input) => {
      standardPriceOverrides.set(demoPriceKey(input), input.amount);
    },
    setDemoSalePrice: (input) => {
      salePriceOverrides.set(
        demoPriceKey(input),
        input.schedule
          ? {
              amount: input.schedule.price.amount,
              startAt: input.schedule.startAt ?? "",
              endAt: input.schedule.endAt ?? "",
            }
          : null,
      );
    },
    validationPreview: async (input) =>
      dependencies.write.validationPreview({
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        patchBody: listingPricePatchBody(input),
      }),
    commitOnce: async (input, fence) =>
      dependencies.write.commitOnce({
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        patchBody: listingPricePatchBody(input),
        assertBeforeSend: () => fence.assertCurrent(),
      }),
  };

  return Object.freeze({
    gateway,
    readDemo,
    clear: () => {
      standardPriceOverrides.clear();
      salePriceOverrides.clear();
    },
  });
}
