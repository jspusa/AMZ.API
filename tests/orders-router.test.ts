import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;

describe("Orders public read route", () => {
  it("delegates one 30-day FBA page through the Orders domain interface", async () => {
    const snapshot = {
      mode: "live" as const,
      orders: [],
      marketplaceId: US,
      fetchedAt: "2026-08-25T08:00:00.000Z",
      nextToken: "next-page-token",
      lastUpdatedBefore: "2026-08-25T07:59:59.000Z",
      requestId: "orders-request-001",
      rateLimit: "0.0167",
      notice: null,
    };
    const read = vi.fn(async () => snapshot);
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      ordersReads: { read },
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);
    const request: ApiRequest = {
      requestId: "orders-route-001",
      method: "GET",
      path: "/api/sp-api/orders",
      query: {
        marketplaceId: US,
        days: "30",
        status: "SHIPPED",
        paginationToken: "opaque-page-token",
      },
      headers: {},
    };

    const response = await router.handle(request);

    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith({
      intent: "dashboard-page",
      marketplaceId: US,
      days: 30,
      fulfillmentStatus: "SHIPPED",
      paginationToken: "opaque-page-token",
    });
    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    expect(response.body.value).toMatchObject({
      ...snapshot,
      marketplace: {
        label: "美國",
        shortLabel: "US",
        name: "Amazon.com",
        currency: "USD",
        region: "na",
        issueLocale: "en_US",
        timeZone: "America/Los_Angeles",
      },
    });
  });

  it.each([
    ["days below the public bound", { days: "0" }, "日期範圍必須介於 1 到 90 天。"],
    ["unsupported fulfillment status", { status: "RETURNED" }, "不支援這個訂單狀態。"],
    [
      "oversized opaque pagination token",
      { paginationToken: "x".repeat(4_097) },
      "分頁資訊無效，請重新查詢。",
    ],
  ])("rejects %s before the domain port", async (_label, query, message) => {
    const read = vi.fn();
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      ordersReads: { read },
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle({
      requestId: "orders-invalid-001",
      method: "GET",
      path: "/api/sp-api/orders",
      query,
      headers: {},
    });

    expect(read).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(response.body.kind === "json" ? response.body.value : null).toEqual({
      code: "INVALID_INPUT",
      message,
    });
  });

  it("keeps the established 14-day default at the public route", async () => {
    const read = vi.fn(async () => ({
      mode: "demo" as const,
      orders: [],
      marketplaceId: US,
      fetchedAt: "2026-08-25T08:00:00.000Z",
      nextToken: null,
      lastUpdatedBefore: "2026-08-25T08:00:00.000Z",
      requestId: null,
      rateLimit: null,
      notice: "demo",
    }));
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      ordersReads: { read },
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle({
      requestId: "orders-default-001",
      method: "GET",
      path: "/api/sp-api/orders",
      query: { marketplaceId: US },
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith({
      intent: "dashboard-page",
      marketplaceId: US,
      days: 14,
      fulfillmentStatus: null,
      paginationToken: null,
    });
  });

  it("uses the same Orders owner for the Orders-first connection probe", async () => {
    const read = vi.fn(async () => {
      throw new SpApiError("Amazon 拒絕了這次請求。", {
        status: 403,
        code: "UNAUTHORIZED",
        requestId: "orders-probe-request",
      });
    });
    const vault = {
      getSummary: vi.fn(async () => ({
        encryptionAvailable: true,
        hasVault: true,
        lwaConfigured: true,
        regions: {
          na: {
            configured: true,
            refreshTokenHint: "configured",
            sellerIdHint: "configured",
          },
          fe: { configured: false, refreshTokenHint: null, sellerIdHint: null },
          eu: { configured: false, refreshTokenHint: null, sellerIdHint: null },
        },
        imageStorageConfigured: false,
        imagePublicBaseUrl: null,
        replenishmentSkillConfigured: false,
        updatedAt: null,
      })),
    } as unknown as CredentialVault;
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault,
      approveWrite: async () => undefined,
      ordersReads: { read },
    });

    const result = await router.testConnections();

    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith({
      intent: "connection-probe",
      marketplaceId: US,
    });
    expect(result).toMatchObject({
      ok: false,
      regions: {
        na: {
          ok: false,
          requestId: "orders-probe-request",
        },
      },
    });
    expect(result.regions.na?.message).toContain("Orders 驗證失敗");
  });

  it("keeps malformed upstream success handling at the established public seam", async () => {
    const read = vi.fn(async () => {
      throw new SyntaxError("hostile raw payload must not cross the boundary");
    });
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      ordersReads: { read },
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle({
      requestId: "orders-malformed-001",
      method: "GET",
      path: "/api/sp-api/orders",
      query: { marketplaceId: US },
      headers: {},
    });

    expect(response.status).toBe(500);
    expect(response.body.kind === "json" ? response.body.value : null).toEqual({
      code: "INTERNAL_ERROR",
      message: "載入訂單時發生未預期的錯誤。",
    });
  });

  it("keeps an unsupported Orders method on the canonical unknown-route contract", async () => {
    const read = vi.fn();
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      ordersReads: { read },
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle({
      requestId: "orders-unknown-001",
      method: "POST",
      path: "/api/sp-api/orders",
      query: {},
      headers: {},
    });

    expect(read).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    expect(response.body.kind === "json" ? response.body.value : null).toEqual({
      code: "NOT_FOUND",
      message: "此 App 版本不支援這個操作。",
    });
  });
});
