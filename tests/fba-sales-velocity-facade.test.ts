import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRestockPlan,
  invalidateSpApiCredentialCaches,
} from "../src/main/amazon/sp-api";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const US_MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const JP_MARKETPLACE_ID = "A1VC38T7YXB528" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");
const savedSpApiEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);
const savedSkillUrl = process.env.AMAZON_REPLENISHMENT_SKILL_URL;

const expectedNotice = [
  "展示建議只供操作測試，不會建立 FBA 入庫。",
  "工作區未找到既有補貨 Skill，目前直接使用 FBA Inventory 與 Sales API AFN/FBA 資料。",
].join(" ");

function replenishmentRequest(
  query: Record<string, string>,
): ApiRequest {
  return {
    requestId: "fba-sales-velocity-route",
    method: "GET",
    path: "/api/sp-api/replenishment-plan",
    query,
    headers: {},
  };
}

describe("FBA Sales Velocity replenishment facade", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "demo";
    delete process.env.AMAZON_REPLENISHMENT_SKILL_URL;
    invalidateSpApiCredentialCaches();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedSpApiEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
    if (savedSkillUrl === undefined) {
      delete process.env.AMAZON_REPLENISHMENT_SKILL_URL;
    } else {
      process.env.AMAZON_REPLENISHMENT_SKILL_URL = savedSkillUrl;
    }
  });

  it("preserves the US 30-completed-day demand and Restock DTO", async () => {
    const snapshot = await getRestockPlan({
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku: "AFA-TRKY-4OZ",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
    });

    expect(snapshot.demand).toEqual({
      lookbackDays: 30,
      units: 54,
      averageDailyUnits: 1.8,
      ordersScanned: 37,
      partial: false,
    });
    expect(snapshot).toMatchObject({
      mode: "demo",
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku: "AFA-TRKY-4OZ",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
      requestId: null,
      rateLimit: null,
      notice: expectedNotice,
      skillConnected: false,
    });
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "action",
        "asin",
        "casePack",
        "daysOfCover",
        "demand",
        "fetchedAt",
        "fnSku",
        "forecastStockoutAt",
        "inventory",
        "leadTimeDays",
        "marketplaceId",
        "mode",
        "notice",
        "rateLimit",
        "recommendedUnits",
        "reorderPoint",
        "requestId",
        "safetyDays",
        "sellerSku",
        "skillConnected",
        "targetDays",
        "title",
      ].sort(),
    );
    expect(Object.keys(snapshot.inventory).sort()).toEqual(
      [
        "fulfillable",
        "inboundReceiving",
        "inboundShipped",
        "inboundWorking",
        "inventoryPosition",
        "researching",
        "reserved",
        "unfulfillable",
      ].sort(),
    );
  });

  it("preserves the JP 30-completed-day demand", async () => {
    const snapshot = await getRestockPlan({
      marketplaceId: JP_MARKETPLACE_ID,
      sellerSku: "AFA100-JP",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
    });

    expect(snapshot.demand).toEqual({
      lookbackDays: 30,
      units: 39,
      averageDailyUnits: 1.3,
      ordersScanned: 37,
      partial: false,
    });
    expect(snapshot).toMatchObject({
      mode: "demo",
      marketplaceId: JP_MARKETPLACE_ID,
      sellerSku: "AFA100-JP",
      requestId: null,
      rateLimit: null,
      notice: expectedNotice,
      skillConnected: false,
    });
  });

  it("translates velocity planner failures through the existing SP-API facade", async () => {
    await expect(
      getRestockPlan({
        marketplaceId: US_MARKETPLACE_ID,
        sellerSku: " ",
        targetDays: 60,
        leadTimeDays: 35,
        safetyDays: 14,
        casePack: 6,
      }),
    ).rejects.toMatchObject({
      name: "SpApiError",
      status: 400,
      code: "INVALID_SALES_TREND_RANGE",
      message: "FBA Sales Velocity 必須使用完整且精確的 Seller SKU。",
    });
  });

  it("preserves the public replenishment route and query contract", async () => {
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
    });
    const response = await router.handle(
      replenishmentRequest({
        marketplaceId: US_MARKETPLACE_ID,
        sku: "AFA-TRKY-4OZ",
        targetDays: "60",
        leadTimeDays: "35",
        safetyDays: "14",
        casePack: "6",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON body.");
    expect(response.body.value).toMatchObject({
      mode: "demo",
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku: "AFA-TRKY-4OZ",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
      demand: {
        lookbackDays: 30,
        units: 54,
        averageDailyUnits: 1.8,
        ordersScanned: 37,
        partial: false,
      },
    });

    const invalidWindow = await router.handle(
      replenishmentRequest({
        marketplaceId: US_MARKETPLACE_ID,
        sku: "AFA-TRKY-4OZ",
        targetDays: "30",
        leadTimeDays: "20",
        safetyDays: "14",
        casePack: "6",
      }),
    );
    expect(invalidWindow.status).toBe(400);
    expect(invalidWindow.body.kind).toBe("json");
    if (invalidWindow.body.kind !== "json") {
      throw new Error("Expected JSON body.");
    }
    expect(invalidWindow.body.value).toMatchObject({
      code: "INVALID_RESTOCK_WINDOW",
      message:
        "目標庫存天數不能小於補貨交期加安全庫存，否則補貨建議會互相矛盾。",
    });
  });

  it("keeps top-level live metadata sourced from FBA Inventory", async () => {
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_LWA_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_LWA_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REFRESH_TOKEN";
    process.env.SP_API_SELLER_ID_NA = "FAKE_SELLER_ID";
    invalidateSpApiCredentialCaches();
    const sellerSku = "LIVE-SKU-01";
    const salesUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === "https://api.amazon.com") {
          return new Response(
            JSON.stringify({
              access_token: "FAKE_ACCESS_TOKEN",
              expires_in: 3_600,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url.pathname.startsWith("/listings/2021-08-01/items/")) {
          return new Response(
            JSON.stringify({
              sku: sellerSku,
              summaries: [
                {
                  marketplaceId: US_MARKETPLACE_ID,
                  asin: "B000000001",
                  productType: "PET_SUPPLIES",
                  status: ["BUYABLE", "DISCOVERABLE"],
                  itemName: "Live FBA item",
                },
              ],
              attributes: {
                purchasable_offer: [
                  {
                    marketplace_id: US_MARKETPLACE_ID,
                    currency: "USD",
                    our_price: [{ schedule: [{ value_with_tax: 19.99 }] }],
                  },
                ],
              },
              offers: [],
              issues: [],
              fulfillmentAvailability: [
                { fulfillmentChannelCode: "AMAZON_NA", quantity: 7 },
              ],
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "x-amzn-requestid": "listing-request",
              },
            },
          );
        }
        if (url.pathname === "/fba/inventory/v1/summaries") {
          return new Response(
            JSON.stringify({
              payload: {
                inventorySummaries: [
                  {
                    asin: "B000000001",
                    fnSku: "X000000001",
                    sellerSku,
                    inventoryDetails: {
                      fulfillableQuantity: 7,
                      inboundWorkingQuantity: 2,
                      inboundShippedQuantity: 3,
                      inboundReceivingQuantity: 4,
                      reservedQuantity: { totalReservedQuantity: 1 },
                      unfulfillableQuantity: { totalUnfulfillableQuantity: 0 },
                      researchingQuantity: { totalResearchingQuantity: 0 },
                    },
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "x-amzn-requestid": "inventory-request",
                "x-amzn-ratelimit-limit": "inventory-rate",
              },
            },
          );
        }
        if (url.pathname === "/sales/v1/orderMetrics") {
          salesUrls.push(url);
          return new Response(JSON.stringify({ payload: [] }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-amzn-requestid": "sales-request",
              "x-amzn-ratelimit-limit": "sales-rate",
            },
          });
        }
        throw new Error(`Unexpected URL: ${url.href}`);
      }),
    );

    const snapshot = await getRestockPlan({
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku,
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
    });

    expect(snapshot).toMatchObject({
      mode: "live",
      marketplaceId: US_MARKETPLACE_ID,
      sellerSku,
      requestId: "inventory-request",
      rateLimit: "inventory-rate",
      demand: {
        lookbackDays: 30,
        units: 0,
        averageDailyUnits: 0,
        ordersScanned: 0,
        partial: false,
      },
    });
    expect(salesUrls).toHaveLength(1);
    expect(salesUrls[0].searchParams.get("sku")).toBe(sellerSku);
    expect(salesUrls[0].searchParams.get("granularity")).toBe("Day");
    expect(salesUrls[0].searchParams.get("fulfillmentNetwork")).toBe("AFN");
    expect(snapshot.notice).toContain(
      "近 30 個完整站點日的銷速取自 Sales API 精確 SKU 查詢",
    );
  });
});
