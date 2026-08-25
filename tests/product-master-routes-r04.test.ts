import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createScriptedSpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import { LocalStore } from "../src/main/local-store";
import { ProductMasterRoutes } from "../src/main/product-master-routes";
import { createRouterRequestContextAdapter } from
  "../src/main/router-request-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const CA = "A2EUQ1WTGCTBG2" as const;

function jsonValue(response: ApiResponse): unknown {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON response.");
  return response.body.value;
}

function context(accountScope: string) {
  return createRouterRequestContextAdapter(
    createScriptedSpExecutionContextAdapter((marketplaceId) => ({
      marketplaceId,
      mode: "demo",
      accountScope,
    })),
  );
}

async function fixture(accountScope = "opaque-product-master-a") {
  const directory = await mkdtemp(join(tmpdir(), "product-master-r04-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  return {
    store,
    routes: new ProductMasterRoutes({ context: context(accountScope), store }),
  };
}

function getRequest(query: Record<string, string>): ApiRequest {
  return {
    requestId: "product-master-get-001",
    method: "GET",
    path: "/api/product-master",
    query,
    headers: {},
  };
}

function putRequest(
  overrides: Record<string, unknown> = {},
  includeBody = true,
): ApiRequest {
  const request: ApiRequest = {
    requestId: "product-master-put-001",
    method: "PUT",
    path: "/api/product-master",
    query: {},
    headers: {},
  };
  if (!includeBody) return request;
  request.body = {
    kind: "json",
    value: {
      marketplaceId: US,
      sellerSku: "MASTER-SKU-1",
      casePack: 24,
      cartonsPerPallet: 40,
      leadTimeDays: 30,
      safetyDays: 14,
      targetDays: 60,
      supplyRoute: "DIRECT_FBA",
      awdBufferDays: 20,
      shelfLifeDays: 730,
      minimumRemainingDays: 365,
      factory: "Factory A",
      notes: "FBA only\r\nReviewed",
      displayName: "Turkey Treats",
      asin: "B012345678",
      fnSku: "X001234567",
      ...overrides,
    },
  };
  return request;
}

describe("R04 Product Master route owner", () => {
  it("writes the unchanged public profile schema and durable timestamps", async () => {
    const { routes } = await fixture();

    const response = await routes.putProductMaster(putRequest());

    expect(response.status).toBe(200);
    const value = jsonValue(response) as Record<string, unknown>;
    expect(value).toMatchObject({
      found: true,
      persistence: "durable",
      profile: {
        marketplaceId: US,
        sellerSku: "MASTER-SKU-1",
        displayName: "Turkey Treats",
        asin: "B012345678",
        fnSku: "X001234567",
        casePack: 24,
        cartonsPerPallet: 40,
        leadTimeDays: 30,
        safetyDays: 14,
        targetDays: 60,
        supplyRoute: "DIRECT_FBA",
        awdBufferDays: 20,
        shelfLifeDays: 730,
        minimumRemainingDays: 365,
        factory: "Factory A",
        notes: "FBA only\nReviewed",
        settingsConfigured: true,
        lastSyncedAt: null,
      },
    });
    const profile = value.profile as Record<string, unknown>;
    expect(profile.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(profile.updatedAt).toBe(profile.createdAt);
    expect(profile).not.toHaveProperty("revision");
  });

  it("reads one trimmed Seller SKU from the captured opaque account scope", async () => {
    const { routes } = await fixture();
    await routes.putProductMaster(putRequest());

    const response = await routes.getProductMaster(getRequest({
      marketplaceId: US,
      sku: "  MASTER-SKU-1  ",
    }));

    expect(response.status).toBe(200);
    expect(jsonValue(response)).toMatchObject({
      found: true,
      persistence: "durable",
      profile: {
        marketplaceId: US,
        sellerSku: "MASTER-SKU-1",
        displayName: "Turkey Treats",
      },
    });
  });

  it("searches only the selected account and marketplace with the exact limit", async () => {
    const { routes } = await fixture();
    await routes.putProductMaster(putRequest());
    await routes.putProductMaster(putRequest({
      sellerSku: "MASTER-SKU-2",
      displayName: "Chicken Treats",
    }));

    const response = await routes.getProductMaster(getRequest({
      marketplaceId: US,
      q: "  turkey  ",
      limit: "1",
    }));

    expect(response.status).toBe(200);
    expect(jsonValue(response)).toEqual({
      items: [expect.objectContaining({
        marketplaceId: US,
        sellerSku: "MASTER-SKU-1",
        displayName: "Turkey Treats",
      })],
      persistence: "durable",
    });
  });

  it("keeps same-SKU records isolated by opaque account scope", async () => {
    const { store, routes: accountA } = await fixture("opaque-product-master-a");
    const accountB = new ProductMasterRoutes({
      context: context("opaque-product-master-b"),
      store,
    });
    await accountA.putProductMaster(putRequest({ displayName: "Account A" }));

    const response = await accountB.getProductMaster(getRequest({
      marketplaceId: US,
      sku: "MASTER-SKU-1",
    }));

    expect(response.status).toBe(200);
    expect(jsonValue(response)).toMatchObject({
      found: false,
      persistence: "durable",
      profile: {
        marketplaceId: US,
        sellerSku: "MASTER-SKU-1",
        displayName: null,
        createdAt: null,
        updatedAt: null,
      },
    });
  });

  it("retains last-write-wins timestamps without adding a revision contract", async () => {
    vi.useFakeTimers();
    try {
      const { routes } = await fixture();
      vi.setSystemTime(new Date("2026-08-25T01:00:00.000Z"));
      await routes.putProductMaster(putRequest({ displayName: "First" }));
      vi.setSystemTime(new Date("2026-08-25T02:00:00.000Z"));

      const response = await routes.putProductMaster(putRequest({
        displayName: "Second",
        revision: "ignored-stale-value",
      }));

      expect(response.status).toBe(200);
      const value = jsonValue(response) as {
        profile: Record<string, unknown>;
      };
      expect(value.profile).toMatchObject({
        displayName: "Second",
        createdAt: "2026-08-25T01:00:00.000Z",
        updatedAt: "2026-08-25T02:00:00.000Z",
      });
      expect(value.profile).not.toHaveProperty("revision");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      label: "AWD on a non-US marketplace",
      overrides: {
        marketplaceId: CA,
        supplyRoute: "AWD_TO_FBA",
      },
      status: 422,
      code: "AWD_US_ONLY",
      message: "AWD→FBA 目前只開放美國站。",
    },
    {
      label: "target below lead plus safety and AWD buffer",
      overrides: {
        supplyRoute: "AWD_TO_FBA",
        leadTimeDays: 30,
        awdBufferDays: 20,
        safetyDays: 14,
        targetDays: 60,
      },
      status: 422,
      code: "INVALID_RESTOCK_WINDOW",
      message: "目標庫存不能小於補貨交期、AWD 緩衝與安全庫存的合計。",
    },
    {
      label: "minimum remaining life above total shelf life",
      overrides: {
        shelfLifeDays: 365,
        minimumRemainingDays: 366,
      },
      status: 422,
      code: "INVALID_SHELF_LIFE",
      message: "到倉最低剩餘效期不能大於商品總效期。",
    },
  ])("rejects $label without persisting", async ({
    overrides,
    status,
    code,
    message,
  }) => {
    const { routes } = await fixture();

    const response = await routes.putProductMaster(putRequest(overrides));

    expect(response.status).toBe(status);
    expect(jsonValue(response)).toEqual({ code, message });
    const read = await routes.getProductMaster(getRequest({
      marketplaceId: String(overrides.marketplaceId ?? US),
      sku: "MASTER-SKU-1",
    }));
    expect(jsonValue(read)).toMatchObject({ found: false });
  });

  it("preserves media-type and field-bound failures", async () => {
    const { routes } = await fixture();

    const unsupported = await routes.putProductMaster(putRequest({}, false));
    expect(unsupported.status).toBe(415);
    expect(jsonValue(unsupported)).toEqual({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "商品主檔請求必須使用 JSON。",
    });

    const invalidField = await routes.putProductMaster(putRequest({ casePack: 10_001 }));
    expect(invalidField.status).toBe(400);
    expect(jsonValue(invalidField)).toEqual({
      code: "INVALID_INPUT",
      message: "商品主檔內有格式或範圍不正確的欄位。",
    });
  });

  it("preserves GET search and explicit-SKU input conflicts", async () => {
    const { routes } = await fixture();

    const invalidSearch = await routes.getProductMaster(getRequest({
      marketplaceId: US,
      q: "q".repeat(81),
      limit: "21",
    }));
    expect(invalidSearch.status).toBe(400);
    expect(jsonValue(invalidSearch)).toEqual({
      code: "INVALID_INPUT",
      message: "商品主檔搜尋條件無效。",
    });

    const explicitEmptySku = await routes.getProductMaster(getRequest({
      marketplaceId: US,
      sku: "",
      q: "ignored",
    }));
    expect(explicitEmptySku.status).toBe(400);
    expect(jsonValue(explicitEmptySku)).toEqual({
      code: "INVALID_INPUT",
      message: "請輸入有效的 Seller SKU。",
    });
  });
});
