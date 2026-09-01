import { describe, expect, it, vi } from "vitest";
import { OperationsBoardFacts } from "../src/main/operations-board-facts";
import type { SpExecutionContext } from "../src/main/amazon/sp-execution-context";
import { createScriptedSpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import type { ApiRequest } from "../src/shared/contracts";
import type { MarketplaceId } from "../src/shared/marketplaces";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const US = "ATVPDKIKX0DER" as const;

function request(items: unknown, requestId = "board-facts-test"): ApiRequest {
  return {
    requestId,
    method: "POST",
    path: "/api/sp-api/operations-board-facts",
    query: {},
    headers: {},
    body: { kind: "json", value: { items } },
  };
}

function identity(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    marketplaceId: US,
    sellerSku: `SKU-${index}`,
  };
}

function priceSnapshot(
  item: Readonly<{ marketplaceId: MarketplaceId; sellerSku: string }>,
  context: SpExecutionContext,
) {
  return {
    mode: context.mode,
    marketplaceId: item.marketplaceId,
    sellerSku: item.sellerSku,
    effectivePrice: { amount: 12.5, currencyCode: "USD" },
    standardPrice: { amount: 15, currencyCode: "USD" },
    fulfillmentAvailability: [{ fulfillment: "FBA", quantity: 27 }],
    fetchedAt: "2026-09-01T10:00:00.000Z",
  } as never;
}

describe("operations board bounded SKU facts owner", () => {
  it("uses at most three concurrent narrow reads, deduplicates identity, and returns partial facts", async () => {
    let active = 0;
    let maximumActive = 0;
    const readPrice = vi.fn(async (item, context) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      if (item.sellerSku === "SKU-4") {
        throw new SpApiError("price unavailable", { status: 404, code: "SKU_NOT_FOUND" });
      }
      return priceSnapshot(item, context);
    });
    const readLiveInventory = vi.fn(async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      if (item.sellerSku === "SKU-3") {
        throw new SpApiError("inventory unavailable", {
          status: 404,
          code: "FBA_SKU_NOT_FOUND",
        });
      }
      return 9;
    });
    const owner = new OperationsBoardFacts({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "test-account",
      })),
      readPrice,
      readLiveInventory,
      now: () => new Date("2026-09-01T11:00:00.000Z"),
    });
    const items = [
      ...Array.from({ length: 8 }, (_, index) => identity(index)),
      { ...identity(0), id: "00000000-0000-4000-8000-000000000999" },
    ];

    const response = await owner.handle(request(items));

    expect(response.status).toBe(200);
    expect(maximumActive).toBeLessThanOrEqual(3);
    expect(readPrice).toHaveBeenCalledTimes(8);
    expect(readLiveInventory).toHaveBeenCalledTimes(8);
    const facts = (response.body as { kind: "json"; value: { facts: Array<Record<string, unknown>> } }).value.facts;
    expect(facts).toHaveLength(9);
    expect(facts[0]).toMatchObject({
      id: identity(0).id,
      mode: "live",
      inventory: { state: "ready", value: 9 },
      price: { state: "ready", value: { amount: 12.5, currencyCode: "USD" } },
      fetchedAt: "2026-09-01T11:00:00.000Z",
    });
    expect(facts[3]).toMatchObject({ inventory: { state: "unavailable", value: null } });
    expect(facts[4]).toMatchObject({ price: { state: "unavailable", value: null } });
  });

  it("does not call live inventory in demo mode and marks every returned fact as demo", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "demo-account",
    }));
    const readLiveInventory = vi.fn();
    const owner = new OperationsBoardFacts({
      context,
      readPrice: async (item, captured) => priceSnapshot(item, captured),
      readLiveInventory,
    });

    const response = await owner.handle(request([identity(1)]));

    expect(response.status).toBe(200);
    expect(readLiveInventory).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      kind: "json",
      value: {
        facts: [{
          mode: "demo",
          inventory: { state: "ready", value: 27 },
          price: { state: "ready", value: { amount: 12.5, currencyCode: "USD" } },
        }],
      },
    });
  });

  it("cancels queued reads by request ID so an obsolete 100-SKU batch cannot keep fanning out", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const readPrice = vi.fn(async (item, context) => {
      await gate;
      return priceSnapshot(item, context);
    });
    const readLiveInventory = vi.fn(async () => {
      await gate;
      return 4;
    });
    const owner = new OperationsBoardFacts({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "test-account",
      })),
      readPrice,
      readLiveInventory,
    });
    const pending = owner.handle(request(
      Array.from({ length: 100 }, (_, index) => identity(index)),
      "board-facts-cancel",
    ));
    await vi.waitFor(() => {
      expect(readPrice.mock.calls.length + readLiveInventory.mock.calls.length).toBe(2);
    });

    owner.cancel("board-facts-cancel");
    release();

    await expect(pending).resolves.toMatchObject({
      status: 409,
      body: { kind: "json", value: { code: "REQUEST_CANCELLED" } },
    });
    expect(readPrice.mock.calls.length + readLiveInventory.mock.calls.length).toBe(2);
  });

  it("fails the shared batch early on auth, throttle, network, or server-class errors", async () => {
    const throttle = new SpApiError("rate limited", {
      status: 429,
      code: "RATE_LIMITED",
    });
    const readPrice = vi.fn(async () => { throw throttle; });
    const readLiveInventory = vi.fn(async () => 4);
    const owner = new OperationsBoardFacts({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "test-account",
      })),
      readPrice,
      readLiveInventory,
    });

    await expect(owner.handle(request(
      Array.from({ length: 100 }, (_, index) => identity(index)),
      "board-facts-throttle",
    ))).rejects.toBe(throttle);
    expect(readPrice.mock.calls.length + readLiveInventory.mock.calls.length)
      .toBeLessThan(20);
  });

  it("aborts and drains the batch when a context fence fails before queued SKU reads dispatch", async () => {
    const contextFailure = new Error("context changed");
    let assertCalls = 0;
    let dispatches = 0;
    const owner = new OperationsBoardFacts({
      context: {
        async capture() {
          return {
            marketplaceId: US,
            region: "na",
            mode: "live",
            accountScope: "test-account",
            generation: 0,
          } as SpExecutionContext;
        },
        async assertCurrent() {
          assertCalls += 1;
          throw contextFailure;
        },
        invalidate() {},
      },
      readPrice: async (item, context) => {
        dispatches += 1;
        return priceSnapshot(item, context);
      },
      readLiveInventory: async () => {
        dispatches += 1;
        return 4;
      },
    });

    await expect(owner.handle(request(
      Array.from({ length: 100 }, (_, index) => identity(index)),
      "board-facts-context-failure",
    ))).rejects.toBe(contextFailure);
    expect(assertCalls).toBe(1);
    expect(dispatches).toBeLessThanOrEqual(3);
    await Promise.resolve();
    expect(dispatches).toBeLessThanOrEqual(3);
  });

  it("rejects malformed, oversized, and visually unsafe request identities", async () => {
    const owner = new OperationsBoardFacts({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "demo",
        accountScope: "demo-account",
      })),
      readPrice: vi.fn(),
      readLiveInventory: vi.fn(),
    });

    for (const items of [
      [],
      Array.from({ length: 101 }, (_, index) => identity(index)),
      [{ ...identity(1), sellerSku: `SKU\u2066-1` }],
      [{ ...identity(1), extra: "not allowed" }],
    ]) {
      await expect(owner.handle(request(items))).resolves.toMatchObject({ status: 400 });
    }
  });
});
