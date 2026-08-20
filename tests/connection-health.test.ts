import { describe, expect, it, vi } from "vitest";
import { testRegionConnections } from "../src/main/amazon/connection-health";
import { SpApiError } from "../src/main/amazon/sp-api";

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
