import { describe, expect, it, vi } from "vitest";
import { testRegionConnections } from "../src/main/amazon/connection-health";
import { SpApiError } from "../src/main/amazon/sp-api-error";

describe("SP-API connection health", () => {
  it("attributes an Orders authorization failure to Orders and skips Listings", async () => {
    const listings = vi.fn();
    const result = await testRegionConnections({
      orders: async () => {
        throw new SpApiError("Access denied", {
          status: 403,
          code: "ACCESS_DENIED",
          requestId: "orders-request",
        });
      },
      listings,
    });
    expect(result).toEqual({
      ok: false,
      message: "Orders 驗證失敗：Access denied 請確認 Orders 角色後重新授權 App。",
      requestId: "orders-request",
    });
    expect(listings).not.toHaveBeenCalled();
  });

  it("attributes a Listings seller mismatch to Listings", async () => {
    const result = await testRegionConnections({
      orders: async () => ({ mode: "live", requestId: "orders-request" }),
      listings: async () => {
        throw new SpApiError("Merchant mismatch", {
          status: 400,
          code: "INVALID_INPUT",
          requestId: "listings-request",
        });
      },
    });
    expect(result.message).toContain("Listings 驗證失敗");
    expect(result.message).toContain("Merchant Token");
    expect(result.requestId).toBe("listings-request");
  });

  it("sanitizes hostile upstream details before returning connection health", async () => {
    const result = await testRegionConnections({
      orders: async () => {
        throw new SpApiError(
          "Bearer hostile-token sellerId=A1SELLERID1234 https://example.invalid/private",
          {
            status: 403,
            code: "ACCESS_DENIED",
            requestId: "Atza|hostile-access-token",
          },
        );
      },
      listings: vi.fn(),
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Orders 驗證失敗：Amazon 回應無法安全顯示。 請確認 Orders 角色後重新授權 App。",
      requestId: null,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Bearer|hostile-token|sellerId|A1SELLERID1234|https?:|Atza/iu,
    );
  });

  it("allowlists request IDs from successful and demo connection probes", async () => {
    await expect(testRegionConnections({
      orders: async () => ({ mode: "live", requestId: "orders-request-safe" }),
      listings: async () => ({
        requestId: "Atza|hostile-listings-token",
        compatibilityFallback: false,
      }),
    })).resolves.toMatchObject({
      ok: true,
      requestId: "orders-request-safe",
    });

    await expect(testRegionConnections({
      orders: async () => ({
        mode: "demo",
        requestId: "amzn1.spdoc.1.4.private-document-value",
      }),
      listings: vi.fn(),
    })).resolves.toMatchObject({
      ok: false,
      requestId: null,
    });
  });

  it("reports live success only after both probes pass", async () => {
    await expect(testRegionConnections({
      orders: async () => ({ mode: "live", requestId: "orders-request" }),
      listings: async () => ({ requestId: null, compatibilityFallback: true }),
    })).resolves.toEqual({
      ok: true,
      message: "Orders 與 Listings 連線成功；Listings 使用唯讀相容參數。",
      requestId: "orders-request",
    });
  });
});
