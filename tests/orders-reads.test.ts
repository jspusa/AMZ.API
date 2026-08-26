import { describe, expect, it, vi } from "vitest";
import {
  isOrderFulfillmentStatus,
  OrdersReads,
  type OrdersPageAdapter,
} from "../src/main/amazon/orders-reads";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;
const JP = "A1VC38T7YXB528" as const;
const NOW = new Date("2026-08-25T12:34:56.789Z");

function context(mode: "live" | "demo") {
  return createScriptedSpExecutionContextAdapter((marketplaceId) => ({
    marketplaceId,
    mode,
    accountScope: "orders-reads-test-account",
  }));
}

function liveResult(payload: unknown) {
  return {
    status: 200,
    payload,
    requestId: "orders-request-001",
    rateLimit: "0.0167",
    retryAfter: null,
  } as const;
}

describe("OrdersReads", () => {
  it("reads one rolling dashboard page and projects only normalized FBA orders", async () => {
    const read = vi.fn<OrdersPageAdapter["read"]>(async () => liveResult({
      orders: [{
        orderId: "ORDER-FBA-1",
        createdTime: "2026-08-24T01:00:00Z",
        lastUpdatedTime: "2026-08-24T02:00:00Z",
        programs: ["PRIME"],
        salesChannel: { marketplaceId: US, marketplaceName: "Amazon.com" },
        fulfillment: {
          fulfillmentStatus: "SHIPPED",
          fulfilledBy: "AMAZON",
          fulfillmentServiceLevel: "EXPEDITED",
          shipByWindow: { latestDateTime: "2026-08-24T03:00:00Z" },
          deliverByWindow: { latestDateTime: "2026-08-25T03:00:00Z" },
        },
        orderItems: [{
          orderItemId: "ITEM-1",
          quantityOrdered: 2,
          product: {
            asin: "B000000001",
            sellerSku: "SKU-ONE",
            title: "Turkey tendon",
            price: { unitPrice: { amount: "13.5", currencyCode: "USD" } },
          },
        }, {
          orderItemId: "ITEM-2",
          quantityOrdered: 1,
          product: { asin: "B000000002", sellerSku: "SKU-TWO", title: "Treats" },
          proceeds: { proceedsTotal: { amount: "4", currencyCode: "USD" } },
        }],
      }, {
        orderId: "ORDER-MFN-1",
        fulfillment: { fulfillmentStatus: "SHIPPED", fulfilledBy: "MERCHANT" },
        orderItems: [],
      }],
      pagination: { nextToken: " next/+== " },
      lastUpdatedBefore: "2026-08-25T12:30:00.000Z",
    }));
    const reads = new OrdersReads({
      context: context("live"),
      live: { read },
      isConfiguredForMarketplace: () => true,
      now: () => NOW,
    });

    const snapshot = await reads.read({
      intent: "dashboard-page",
      marketplaceId: US,
      days: 30,
      fulfillmentStatus: "SHIPPED",
      paginationToken: "opaque/+==",
    });

    expect(read).toHaveBeenCalledWith({
      intent: "dashboard-page",
      marketplaceId: US,
      lastUpdatedAfter: "2026-07-26T12:34:56.789Z",
      fulfillmentStatus: "SHIPPED",
      paginationToken: "opaque/+==",
      expectedMode: "live",
      signal: undefined,
    });
    expect(snapshot).toEqual({
      mode: "live",
      orders: [{
        orderId: "ORDER-FBA-1",
        createdTime: "2026-08-24T01:00:00Z",
        lastUpdatedTime: "2026-08-24T02:00:00Z",
        marketplaceId: US,
        marketplaceName: "Amazon.com",
        programs: ["PRIME"],
        fulfillmentStatus: "SHIPPED",
        fulfilledBy: "AMAZON",
        fulfillmentServiceLevel: "EXPEDITED",
        shipBy: "2026-08-24T03:00:00Z",
        deliverBy: "2026-08-25T03:00:00Z",
        total: { amount: 31, currencyCode: "USD" },
        items: [{
          orderItemId: "ITEM-1",
          asin: "B000000001",
          sellerSku: "SKU-ONE",
          title: "Turkey tendon",
          quantity: 2,
          unitPrice: { amount: 13.5, currencyCode: "USD" },
          lineTotal: { amount: 27, currencyCode: "USD" },
        }, {
          orderItemId: "ITEM-2",
          asin: "B000000002",
          sellerSku: "SKU-TWO",
          title: "Treats",
          quantity: 1,
          unitPrice: null,
          lineTotal: { amount: 4, currencyCode: "USD" },
        }],
      }],
      marketplaceId: US,
      fetchedAt: NOW.toISOString(),
      nextToken: " next/+== ",
      lastUpdatedBefore: "2026-08-25T12:30:00.000Z",
      requestId: "orders-request-001",
      rateLimit: "0.0167",
      notice: null,
    });
  });

  it("hides the one-day and one-result connection probe intent from callers", async () => {
    const read = vi.fn<OrdersPageAdapter["read"]>(async () =>
      liveResult({ orders: [] })
    );
    const reads = new OrdersReads({
      context: context("live"),
      live: { read },
      isConfiguredForMarketplace: () => true,
      now: () => NOW,
    });

    await reads.read({ intent: "connection-probe", marketplaceId: JP });

    expect(read).toHaveBeenCalledWith({
      intent: "connection-probe",
      marketplaceId: JP,
      lastUpdatedAfter: "2026-08-24T12:34:56.789Z",
      fulfillmentStatus: null,
      paginationToken: null,
      expectedMode: "live",
      signal: undefined,
    });
  });

  it("timestamps a live snapshot after the external page has returned", async () => {
    const rangeNow = new Date("2026-08-25T12:00:00.000Z");
    const returnedAt = new Date("2026-08-25T12:00:03.000Z");
    const now = vi.fn()
      .mockReturnValueOnce(rangeNow)
      .mockReturnValueOnce(returnedAt);
    const read = vi.fn<OrdersPageAdapter["read"]>(async () =>
      liveResult({ orders: [] })
    );
    const reads = new OrdersReads({
      context: context("live"),
      live: { read },
      isConfiguredForMarketplace: () => true,
      now,
    });

    const snapshot = await reads.read({
      intent: "connection-probe",
      marketplaceId: US,
    });

    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      lastUpdatedAfter: "2026-08-24T12:00:00.000Z",
    }));
    expect(snapshot.fetchedAt).toBe("2026-08-25T12:00:03.000Z");
  });

  it("keeps demo data deterministic, FBA-only, status-filtered, and never falls back to live", async () => {
    const live = vi.fn<OrdersPageAdapter["read"]>();
    const reads = new OrdersReads({
      context: context("demo"),
      live: { read: live },
      isConfiguredForMarketplace: () => true,
      now: () => NOW,
    });

    const snapshot = await reads.read({
      intent: "dashboard-page",
      marketplaceId: US,
      days: 30,
      fulfillmentStatus: "SHIPPED",
      paginationToken: "ignored-in-demo",
    });

    expect(live).not.toHaveBeenCalled();
    expect(snapshot.mode).toBe("demo");
    expect(snapshot.orders).toHaveLength(3);
    expect(snapshot.orders.every((order) =>
      order.fulfilledBy === "AMAZON" && order.fulfillmentStatus === "SHIPPED"
    )).toBe(true);
    expect(snapshot.orders[0]).toMatchObject({
      orderId: "DEMO-US-0840216",
      createdTime: "2026-08-24T22:34:56.789Z",
      items: [{ sellerSku: "GTC-CHKN-1LB", asin: "B0USGTC001" }],
    });
    expect(snapshot).toMatchObject({
      fetchedAt: NOW.toISOString(),
      nextToken: null,
      lastUpdatedBefore: NOW.toISOString(),
      requestId: null,
      rateLimit: null,
      notice: "目前由 SP_API_MODE 強制使用展示資料。",
    });
  });

  it("preserves the unconfigured-marketplace demo notice", async () => {
    const reads = new OrdersReads({
      context: context("demo"),
      live: { read: vi.fn() },
      isConfiguredForMarketplace: () => false,
      now: () => NOW,
    });

    const snapshot = await reads.read({
      intent: "connection-probe",
      marketplaceId: JP,
    });

    expect(snapshot.orders).toHaveLength(8);
    expect(snapshot.notice).toBe(
      "日本站尚未在本機系統安全儲存區加入 refresh token，因此顯示展示資料。",
    );
  });

  it("uses one captured context and rejects a mode change after the external read", async () => {
    let mode: "live" | "demo" = "live";
    const execution = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode,
        accountScope: "orders-context-account",
      }),
    );
    const read = vi.fn<OrdersPageAdapter["read"]>(async () => {
      mode = "demo";
      return liveResult({ orders: [] });
    });
    const reads = new OrdersReads({
      context: execution,
      live: { read },
      isConfiguredForMarketplace: () => true,
      now: () => NOW,
    });

    await expect(reads.read({
      intent: "connection-probe",
      marketplaceId: US,
    })).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
    expect(read).toHaveBeenCalledOnce();
  });

  it("preserves upstream status errors and malformed-success throws", async () => {
    const read = vi.fn<OrdersPageAdapter["read"]>()
      .mockResolvedValueOnce({
        status: 429,
        payload: null,
        requestId: "rate-request",
        rateLimit: null,
        retryAfter: "7",
      })
      .mockResolvedValueOnce(liveResult(null));
    const reads = new OrdersReads({
      context: context("live"),
      live: { read },
      isConfiguredForMarketplace: () => true,
      now: () => NOW,
    });

    await expect(reads.read({
      intent: "connection-probe",
      marketplaceId: US,
    })).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      requestId: "rate-request",
      retryAfter: "7",
    });
    await expect(reads.read({
      intent: "connection-probe",
      marketplaceId: US,
    })).rejects.toBeInstanceOf(TypeError);
  });

  it("owns the exact status whitelist and rejects invalid dashboard ranges", async () => {
    expect(isOrderFulfillmentStatus("PENDING_AVAILABILITY")).toBe(true);
    expect(isOrderFulfillmentStatus("UNFULFILLABLE")).toBe(true);
    expect(isOrderFulfillmentStatus("DELIVERED")).toBe(false);
    const read = vi.fn<OrdersPageAdapter["read"]>();
    const reads = new OrdersReads({
      context: context("live"),
      live: { read },
      isConfiguredForMarketplace: () => true,
      now: () => NOW,
    });

    await expect(reads.read({
      intent: "dashboard-page",
      marketplaceId: US,
      days: 0,
      fulfillmentStatus: null,
      paginationToken: null,
    })).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(read).not.toHaveBeenCalled();
  });
});
