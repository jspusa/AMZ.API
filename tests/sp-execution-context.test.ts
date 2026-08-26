import { describe, expect, it, vi } from "vitest";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import {
  createProductionSpExecutionContextAdapter,
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionMode,
} from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;
const CA = "A2EUQ1WTGCTBG2" as const;

describe("SP execution context", () => {
  it("uses the canonical SP error vocabulary for context failures", () => {
    const error = new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );

    expect(error).toBeInstanceOf(SpApiError);
    expect(error).toMatchObject({
      name: "SpExecutionContextError",
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
      requestId: null,
      retryAfter: null,
      issues: [],
    });
  });

  it("captures one immutable, secret-free marketplace context from a scripted adapter", async () => {
    let state: { mode: SpExecutionMode; accountScope: string } = {
      mode: "live",
      accountScope: "opaque-account-a",
    };
    const adapter = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({ ...state, marketplaceId }),
    );

    const context = await adapter.capture(US);
    state = { mode: "demo", accountScope: "opaque-account-b" };

    expect(context).toEqual({
      marketplaceId: US,
      region: "na",
      mode: "live",
      accountScope: "opaque-account-a",
      generation: 0,
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.keys(context).sort()).toEqual([
      "accountScope",
      "generation",
      "marketplaceId",
      "mode",
      "region",
    ]);
    expect(JSON.stringify(context)).not.toMatch(
      /sellerId|refreshToken|lwaClientSecret|clientSecret|accessToken/u,
    );
  });

  it("rejects a raw Seller ID instead of branding it as an opaque account scope", async () => {
    const adapter = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "A1SELLERID1234",
      }),
    );

    await expect(adapter.capture(US)).rejects.toThrow(
      "Amazon account scope is unavailable.",
    );
  });

  it("fails closed with compatible codes when account or mode changes", async () => {
    let state: { mode: SpExecutionMode; accountScope: string } = {
      mode: "live",
      accountScope: "opaque-account-a",
    };
    const adapter = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({ ...state, marketplaceId }),
    );
    const original = await adapter.capture(US);

    state = { mode: "live", accountScope: "opaque-account-b" };
    await expect(adapter.assertCurrent(original)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    });

    state = { mode: "demo", accountScope: "opaque-account-a" };
    await expect(adapter.assertCurrent(original)).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
  });

  it("invalidates an old snapshot even when the account and mode stay the same", async () => {
    const adapter = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "opaque-account-a",
      }),
    );
    const original = await adapter.capture(US);

    adapter.invalidate("credentials-saved");
    const replacement = await adapter.capture(US);

    expect(replacement.generation).toBe(original.generation + 1);
    await expect(adapter.assertCurrent(original)).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("builds production context from only opaque main-owned dependencies", async () => {
    const regions: string[] = [];
    const marketplaces: string[] = [];
    const adapter = createProductionSpExecutionContextAdapter({
      getOpaqueAccountScope: async (region) => {
        regions.push(region);
        return "opaque-production-account";
      },
      resolveMode: (marketplaceId) => {
        marketplaces.push(marketplaceId);
        return "live";
      },
    });

    await expect(adapter.capture(US)).resolves.toEqual({
      marketplaceId: US,
      region: "na",
      mode: "live",
      accountScope: "opaque-production-account",
      generation: 0,
    });
    expect(regions).toEqual(["na"]);
    expect(marketplaces).toEqual([US, US]);
  });

  it("rejects an in-flight production capture after lifecycle invalidation", async () => {
    let release!: (scope: string) => void;
    const scope = new Promise<string>((resolve) => {
      release = resolve;
    });
    const adapter = createProductionSpExecutionContextAdapter({
      getOpaqueAccountScope: async () => scope,
      resolveMode: () => "live",
    });

    const capture = adapter.capture(US);
    adapter.invalidate("lock-screen");
    release("opaque-production-account");

    await expect(capture).rejects.toMatchObject({
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
  });

  it("invalidates cached context when mode changes during an account-scope read", async () => {
    let mode: SpExecutionMode = "live";
    let changeModeDuringRead = true;
    const onContextChanged = vi.fn();
    const adapter = createProductionSpExecutionContextAdapter({
      getOpaqueAccountScope: async () => {
        if (changeModeDuringRead) {
          changeModeDuringRead = false;
          mode = "demo";
        }
        return "opaque-production-account";
      },
      resolveMode: () => mode,
      onContextChanged,
    });

    await expect(adapter.capture(US)).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
    expect(onContextChanged).toHaveBeenCalledOnce();
    expect(onContextChanged).toHaveBeenCalledWith("mode-changed");
    await expect(adapter.capture(US)).resolves.toMatchObject({
      mode: "demo",
      generation: 1,
    });
  });

  it("detects out-of-band mode and account transitions and invalidates once", async () => {
    let mode: SpExecutionMode = "live";
    let accountScope = "opaque-production-account-a";
    const onContextChanged = vi.fn();
    const adapter = createProductionSpExecutionContextAdapter({
      getOpaqueAccountScope: async () => accountScope,
      resolveMode: () => mode,
      onContextChanged,
    });
    const original = await adapter.capture(US);

    mode = "demo";
    await expect(adapter.capture(US)).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
    expect(onContextChanged).toHaveBeenLastCalledWith("mode-changed");
    const demo = await adapter.capture(US);
    expect(demo.generation).toBe(original.generation + 1);

    accountScope = "opaque-production-account-b";
    await expect(adapter.capture(US)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    });
    expect(onContextChanged).toHaveBeenLastCalledWith("account-changed");
    expect(onContextChanged).toHaveBeenCalledTimes(2);
  });

  it("invalidates through assertCurrent when the production account changes", async () => {
    let accountScope = "opaque-production-account-a";
    const onContextChanged = vi.fn();
    const adapter = createProductionSpExecutionContextAdapter({
      getOpaqueAccountScope: async () => accountScope,
      resolveMode: () => "live",
      onContextChanged,
    });
    const original = await adapter.capture(US);

    accountScope = "opaque-production-account-b";
    await expect(adapter.assertCurrent(original)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    });
    expect(onContextChanged).toHaveBeenCalledOnce();
    expect(onContextChanged).toHaveBeenCalledWith("account-changed");
    await expect(adapter.capture(US)).resolves.toMatchObject({
      accountScope: "opaque-production-account-b",
      generation: original.generation + 1,
    });
  });

  it("treats account scope as a region baseline across marketplaces", async () => {
    let accountScope = "opaque-production-account-a";
    const onContextChanged = vi.fn();
    const adapter = createProductionSpExecutionContextAdapter({
      getOpaqueAccountScope: async () => accountScope,
      resolveMode: () => "live",
      onContextChanged,
    });
    await adapter.capture(US);

    accountScope = "opaque-production-account-b";
    await expect(adapter.capture(CA)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    });
    expect(onContextChanged).toHaveBeenCalledOnce();
    expect(onContextChanged).toHaveBeenCalledWith("account-changed");
  });

  it("never returns a stale generation from concurrent production captures", async () => {
    let accountScope = "opaque-production-account-a";
    const onContextChanged = vi.fn();
    const adapter = createProductionSpExecutionContextAdapter({
      getOpaqueAccountScope: async () => accountScope,
      resolveMode: () => "live",
      onContextChanged,
    });
    const original = await adapter.capture(US);

    accountScope = "opaque-production-account-b";
    const outcomes = await Promise.allSettled([
      adapter.capture(US),
      adapter.capture(US),
    ]);
    const rejectedCodes = outcomes.map((outcome) =>
      outcome.status === "rejected"
        ? (outcome.reason as { code?: string }).code
        : null
    );

    expect(onContextChanged).toHaveBeenCalledOnce();
    expect(rejectedCodes).toEqual([
      "ACCOUNT_SCOPE_CHANGED",
      "SP_CONTEXT_INVALIDATED",
    ]);
    await expect(adapter.capture(US)).resolves.toMatchObject({
      accountScope: "opaque-production-account-b",
      generation: original.generation + 1,
    });
  });
});
