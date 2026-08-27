import type {
  MarketplaceId,
  MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  FbaSalesPlanningError,
} from "./fba-sales-calendar";
import {
  FbaSalesMetricsError,
  readFbaSalesVelocity,
} from "./fba-sales-metrics";
import { createDeterministicFbaSalesMetricsDemoAdapter } from
  "./fba-sales-metrics-demo";
import { createFbaSalesMetricsProductionAdapter } from
  "./fba-sales-metrics-production";
import {
  readReplenishmentInventoryInputs,
  type FbaInventoryReplenishmentAdapter,
  type RestockPlanSnapshot,
} from "./fba-inventory-replenishment";
import type { ListingPriceSnapshot } from "./listing-price-types";
import { SpApiError } from "./sp-api-error";

export type RestockPlanInput = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
  targetDays: number;
  leadTimeDays: number;
  safetyDays: number;
  casePack: number;
}>;

export type RestockPlanPort = Readonly<{
  get(input: RestockPlanInput): Promise<RestockPlanSnapshot>;
}>;

export type RestockPlanDependencies = Readonly<{
  resolveMode(marketplaceId: MarketplaceId): "live" | "demo";
  readDemoListingPrice(
    marketplaceId: MarketplaceId,
    sellerSku: string,
  ): ListingPriceSnapshot;
  readLiveListingPrice(
    marketplaceId: MarketplaceId,
    sellerSku: string,
  ): Promise<ListingPriceSnapshot>;
  inventoryAdapter: FbaInventoryReplenishmentAdapter;
  getAccessToken(
    region: MarketplaceRegion,
    forceRefresh: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  isSkillConnected(): boolean;
  clock?: () => Date;
}>;

function inventoryQuantity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function createRestockPlan(
  input: RestockPlanInput,
  context: Readonly<{
    mode: "live" | "demo";
    listing: ListingPriceSnapshot;
    fnSku: string | null;
    inventory: Omit<RestockPlanSnapshot["inventory"], "inventoryPosition">;
    demand: RestockPlanSnapshot["demand"];
    requestId: string | null;
    rateLimit: string | null;
    skillConnected: boolean;
    clock: () => Date;
  }>,
): RestockPlanSnapshot {
  const inventoryPosition =
    context.inventory.fulfillable +
    context.inventory.inboundWorking +
    context.inventory.inboundShipped +
    context.inventory.inboundReceiving;
  const daily = context.demand.averageDailyUnits;
  const daysOfCover = daily > 0 ? context.inventory.fulfillable / daily : null;
  const reorderPoint = Math.ceil(daily * (input.leadTimeDays + input.safetyDays));
  const rawRecommended = Math.max(
    0,
    Math.ceil(daily * input.targetDays - inventoryPosition),
  );
  const recommendedUnits =
    rawRecommended > 0
      ? Math.ceil(rawRecommended / input.casePack) * input.casePack
      : 0;
  const action: RestockPlanSnapshot["action"] =
    daily <= 0
      ? "NO_DEMAND"
      : (daysOfCover ?? 0) <= input.leadTimeDays + input.safetyDays
        ? "RESTOCK_NOW"
        : (daysOfCover ?? 0) <= input.targetDays
          ? "WATCH"
          : "HEALTHY";
  return {
    mode: context.mode,
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    asin: context.listing.asin,
    fnSku: context.fnSku,
    title: context.listing.title,
    targetDays: input.targetDays,
    leadTimeDays: input.leadTimeDays,
    safetyDays: input.safetyDays,
    casePack: input.casePack,
    inventory: { ...context.inventory, inventoryPosition },
    demand: context.demand,
    daysOfCover,
    reorderPoint,
    recommendedUnits,
    forecastStockoutAt:
      daysOfCover !== null
        ? new Date(
            context.clock().getTime() + daysOfCover * 86_400_000,
          ).toISOString()
        : null,
    action,
    fetchedAt: context.clock().toISOString(),
    requestId: context.requestId,
    rateLimit: context.rateLimit,
    notice: [
      context.mode === "demo"
        ? "展示建議只供操作測試，不會建立 FBA 入庫。"
        : context.demand.partial
          ? "Sales API 沒有提供完整的近 30 個站點日，銷速可能被低估，請人工複核。"
          : "近 30 個完整站點日的銷速取自 Sales API 精確 SKU 查詢；建議量已扣除 FBA 可售與 working／shipped／receiving 在途庫存。",
      context.skillConnected
        ? "已偵測到補貨 Skill 接點；正式送出仍應先人工審核。"
        : "工作區未找到既有補貨 Skill，目前直接使用 FBA Inventory 與 Sales API AFN/FBA 資料。",
    ].join(" "),
    skillConnected: context.skillConnected,
  };
}

function throwRestockPlanError(error: unknown): never {
  if (error instanceof FbaSalesPlanningError) {
    throw new SpApiError(error.message, {
      status: 400,
      code: "INVALID_SALES_TREND_RANGE",
    });
  }
  if (error instanceof FbaSalesMetricsError) {
    throw new SpApiError(error.message, {
      status: error.status,
      code: error.code,
      requestId: error.requestId,
      retryAfter: error.retryAfter,
    });
  }
  throw error;
}

export function createRestockPlanPort(
  dependencies: RestockPlanDependencies,
): RestockPlanPort {
  const clock = dependencies.clock ?? (() => new Date());

  async function readRestockSalesVelocity(
    marketplaceId: MarketplaceId,
    sellerSku: string,
    mode: "live" | "demo",
  ): Promise<RestockPlanSnapshot["demand"]> {
    const adapter = mode === "demo"
      ? createDeterministicFbaSalesMetricsDemoAdapter()
      : createFbaSalesMetricsProductionAdapter({
          getAccessToken: dependencies.getAccessToken,
          invalidateAccessToken: dependencies.invalidateAccessToken,
          now: clock,
        });
    const velocity = await readFbaSalesVelocity(
      { marketplaceId, sellerSku },
      { adapter, clock },
    );
    return {
      lookbackDays: velocity.completedDayCount,
      units: velocity.units,
      averageDailyUnits: velocity.averageDailyUnits,
      ordersScanned: velocity.orderCount,
      partial: false,
    };
  }

  return {
    async get(input): Promise<RestockPlanSnapshot> {
      const mode = dependencies.resolveMode(input.marketplaceId);
      try {
        if (mode === "demo") {
          const demand = await readRestockSalesVelocity(
            input.marketplaceId,
            input.sellerSku,
            mode,
          );
          const listing = dependencies.readDemoListingPrice(
            input.marketplaceId,
            input.sellerSku,
          );
          const fba = listing.fulfillmentAvailability.find(
            (item) => item.fulfillment === "FBA",
          );
          const fulfillable = inventoryQuantity(fba?.quantity);
          return createRestockPlan(input, {
            mode,
            listing,
            fnSku: listing.asin ? `X00${listing.asin.slice(-7)}` : null,
            inventory: {
              fulfillable,
              reserved: 4,
              inboundWorking: fulfillable > 0 ? 12 : 0,
              inboundShipped: fulfillable > 0 ? 18 : 0,
              inboundReceiving: 6,
              unfulfillable: 1,
              researching: 0,
            },
            demand,
            requestId: null,
            rateLimit: null,
            skillConnected: dependencies.isSkillConnected(),
            clock,
          });
        }

        const [demand, listing, inventoryResult] = await Promise.all([
          readRestockSalesVelocity(
            input.marketplaceId,
            input.sellerSku,
            mode,
          ),
          dependencies.readLiveListingPrice(
            input.marketplaceId,
            input.sellerSku,
          ),
          readReplenishmentInventoryInputs(
            {
              marketplaceId: input.marketplaceId,
              sellerSku: input.sellerSku,
            },
            { adapter: dependencies.inventoryAdapter },
          ),
        ]);
        return createRestockPlan(input, {
          mode,
          listing,
          fnSku: inventoryResult.fnSku,
          inventory: inventoryResult.inventory,
          demand,
          requestId: inventoryResult.requestId,
          rateLimit: inventoryResult.rateLimit,
          skillConnected: dependencies.isSkillConnected(),
          clock,
        });
      } catch (error) {
        throwRestockPlanError(error);
      }
    },
  };
}
