import { describe, expect, it, vi } from "vitest";
import {
  type SpExecutionContext,
  type SpExecutionContextAdapter,
  type SpExecutionContextInvalidationReason,
} from "../src/main/amazon/sp-execution-context";
import { createRouterRequestContextAdapter } from "../src/main/router-request-context";
import type { MarketplaceId } from "../src/shared/marketplaces";

const US = "ATVPDKIKX0DER" as const;
const CA = "A2EUQ1WTGCTBG2" as const;

function context(
  marketplaceId: MarketplaceId,
  generation: number,
): SpExecutionContext {
  return Object.freeze({
    marketplaceId,
    region: "na",
    mode: "demo",
    accountScope: "opaque-router-request-account" as SpExecutionContext["accountScope"],
    generation,
  });
}

function baseAdapter(): SpExecutionContextAdapter {
  let generation = 0;
  return {
    capture: vi.fn(async (marketplaceId: MarketplaceId) =>
      context(marketplaceId, generation++)
    ),
    assertCurrent: vi.fn(async () => undefined),
    invalidate: vi.fn((_reason: SpExecutionContextInvalidationReason) => undefined),
  };
}

describe("router request execution context", () => {
  it("reuses one frozen context for the same marketplace within an operation", async () => {
    const base = baseAdapter();
    const adapter = createRouterRequestContextAdapter(base);
    const baseCompatible: SpExecutionContextAdapter = adapter;

    const [first, second] = await adapter.runOperation(async () => [
      await baseCompatible.capture(US),
      await baseCompatible.capture(US),
    ]);

    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(base.capture).toHaveBeenCalledOnce();
    expect(base.capture).toHaveBeenCalledWith(US);
  });

  it("isolates concurrent operations even when they capture the same marketplace", async () => {
    let started = 0;
    let releaseCaptures!: () => void;
    const capturesReleased = new Promise<void>((resolve) => {
      releaseCaptures = resolve;
    });
    let announceBothStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      announceBothStarted = resolve;
    });
    const capture = vi.fn(async (marketplaceId: MarketplaceId) => {
      const generation = started++;
      if (started === 2) announceBothStarted();
      await capturesReleased;
      return context(marketplaceId, generation);
    });
    const base = {
      capture,
      assertCurrent: vi.fn(async () => undefined),
      invalidate: vi.fn((_reason: SpExecutionContextInvalidationReason) => undefined),
    } satisfies SpExecutionContextAdapter;
    const adapter = createRouterRequestContextAdapter(base);

    const firstOperation = adapter.runOperation(async () => {
      const first = await adapter.capture(US);
      return [first, await adapter.capture(US)] as const;
    });
    const secondOperation = adapter.runOperation(async () => {
      const first = await adapter.capture(US);
      return [first, await adapter.capture(US)] as const;
    });

    await bothStarted;
    releaseCaptures();
    const [first, second] = await Promise.all([firstOperation, secondOperation]);

    expect(first[0]).toBe(first[1]);
    expect(second[0]).toBe(second[1]);
    expect(first[0]).not.toBe(second[0]);
    expect(base.capture).toHaveBeenCalledTimes(2);
  });

  it("rejects a second marketplace within the same operation", async () => {
    const base = baseAdapter();
    const adapter = createRouterRequestContextAdapter(base);

    await adapter.runOperation(async () => {
      await adapter.capture(US);
      await expect(adapter.capture(CA)).rejects.toMatchObject({
        status: 409,
        code: "SP_CONTEXT_INVALIDATED",
      });
    });

    expect(base.capture).toHaveBeenCalledOnce();
  });

  it("delegates the terminal assertion with the operation's captured context", async () => {
    const base = baseAdapter();
    const adapter = createRouterRequestContextAdapter(base);
    let captured!: SpExecutionContext;

    await adapter.runOperation(async () => {
      captured = await adapter.capture(US);
      await adapter.assertOperationCurrent();
    });

    expect(base.assertCurrent).toHaveBeenCalledOnce();
    expect(base.assertCurrent).toHaveBeenCalledWith(captured);
  });

  it("does not reuse a closed operation scope from an inherited async callback", async () => {
    const base = baseAdapter();
    const adapter = createRouterRequestContextAdapter(base);
    let releaseInheritedCallback!: () => void;
    const inheritedCallbackReleased = new Promise<void>((resolve) => {
      releaseInheritedCallback = resolve;
    });
    let scoped!: SpExecutionContext;
    let inheritedCapture!: Promise<SpExecutionContext>;

    await adapter.runOperation(async () => {
      scoped = await adapter.capture(US);
      inheritedCapture = (async () => {
        await inheritedCallbackReleased;
        return adapter.capture(US);
      })();
    });

    releaseInheritedCallback();
    const fresh = await inheritedCapture;

    expect(fresh).not.toBe(scoped);
    expect(fresh.generation).not.toBe(scoped.generation);
    expect(base.capture).toHaveBeenCalledTimes(2);
  });

  it("delegates invalidation exactly once", () => {
    const base = baseAdapter();
    const adapter = createRouterRequestContextAdapter(base);

    adapter.invalidate("lock-screen");

    expect(base.invalidate).toHaveBeenCalledOnce();
    expect(base.invalidate).toHaveBeenCalledWith("lock-screen");
  });
});
