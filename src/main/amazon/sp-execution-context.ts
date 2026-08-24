import {
  marketplaceById,
  type MarketplaceId,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import { SpApiError } from "./sp-api-error";

declare const opaqueAccountScopeBrand: unique symbol;

export type OpaqueAccountScope = string & {
  readonly [opaqueAccountScopeBrand]: true;
};

export type SpExecutionMode = "live" | "demo";

export type SpExecutionContext = Readonly<{
  marketplaceId: MarketplaceId;
  region: MarketplaceRegion;
  mode: SpExecutionMode;
  accountScope: OpaqueAccountScope;
  generation: number;
}>;

export type SpExecutionContextInvalidationReason =
  | "credentials-saved"
  | "credentials-cleared"
  | "account-changed"
  | "mode-changed"
  | "lock-screen"
  | "suspend";

export type SpExecutionContextErrorCode =
  | "ACCOUNT_SCOPE_CHANGED"
  | "REPORT_MODE_CHANGED"
  | "SP_CONTEXT_INVALIDATED";

export class SpExecutionContextError extends SpApiError {
  constructor(
    code: SpExecutionContextErrorCode,
    message: string,
  ) {
    super(message, { status: 409, code });
    this.name = "SpExecutionContextError";
  }
}

export interface SpExecutionContextAdapter {
  capture(marketplaceId: MarketplaceId): Promise<SpExecutionContext>;
  assertCurrent(context: SpExecutionContext): Promise<void>;
  invalidate(reason: SpExecutionContextInvalidationReason): void;
}

export type ScriptedSpExecutionContextState = Readonly<{
  marketplaceId: MarketplaceId;
  mode: SpExecutionMode;
  accountScope: string;
}>;

export type ProductionSpExecutionContextDependencies = Readonly<{
  getOpaqueAccountScope(region: MarketplaceRegion): Promise<string>;
  resolveMode(marketplaceId: MarketplaceId): SpExecutionMode;
  onContextChanged?(
    reason: Extract<
      SpExecutionContextInvalidationReason,
      "account-changed" | "mode-changed"
    >,
  ): void;
}>;

function opaqueAccountScope(value: string): OpaqueAccountScope {
  if (
    value !== value.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value) ||
    /^A[A-Z0-9]{12,15}$/u.test(value)
  ) {
    throw new Error("Amazon account scope is unavailable.");
  }
  return value as OpaqueAccountScope;
}

function createSpExecutionContextAdapter(
  readState: (
    marketplaceId: MarketplaceId,
  ) => ScriptedSpExecutionContextState | Promise<ScriptedSpExecutionContextState>,
): SpExecutionContextAdapter {
  let generation = 0;

  const capture = async (marketplaceId: MarketplaceId): Promise<SpExecutionContext> => {
    const capturedGeneration = generation;
    const marketplace = marketplaceById(marketplaceId);
    if (!marketplace) throw new Error("Amazon marketplace is unsupported.");
    const state = await readState(marketplaceId);
    if (capturedGeneration !== generation) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    if (state.marketplaceId !== marketplaceId) {
      throw new Error("Scripted Amazon context changed marketplace.");
    }
    return Object.freeze({
      marketplaceId,
      region: marketplace.region,
      mode: state.mode,
      accountScope: opaqueAccountScope(state.accountScope),
      generation: capturedGeneration,
    });
  };

  return {
    capture,
    async assertCurrent(context) {
      if (context.generation !== generation) {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "Amazon 執行環境已更新；請重新開始這次操作。",
        );
      }
      const current = await capture(context.marketplaceId);
      if (current.accountScope !== context.accountScope) {
        throw new SpExecutionContextError(
          "ACCOUNT_SCOPE_CHANGED",
          "Amazon 帳號範圍已改變；本次操作已停止。",
        );
      }
      if (current.mode !== context.mode) {
        throw new SpExecutionContextError(
          "REPORT_MODE_CHANGED",
          "App 展示／真實模式已改變；本次操作已停止。",
        );
      }
      if (current.region !== context.region) {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "Amazon 執行環境已更新；請重新開始這次操作。",
        );
      }
    },
    invalidate() {
      generation += 1;
    },
  };
}

export function createScriptedSpExecutionContextAdapter(
  readState: (marketplaceId: MarketplaceId) => ScriptedSpExecutionContextState,
): SpExecutionContextAdapter {
  return createSpExecutionContextAdapter(readState);
}

export function createProductionSpExecutionContextAdapter(
  dependencies: ProductionSpExecutionContextDependencies,
): SpExecutionContextAdapter {
  const observed = new Map<MarketplaceId, SpExecutionContext>();
  let adapter: SpExecutionContextAdapter;
  let invocationGeneration = 0;
  const invalidateDetectedTransition = (
    reason: "account-changed" | "mode-changed",
  ): void => {
    invocationGeneration += 1;
    adapter.invalidate(reason);
    observed.clear();
    dependencies.onContextChanged?.(reason);
  };
  const transitionError = (
    reason: "account-changed" | "mode-changed",
  ): SpExecutionContextError => new SpExecutionContextError(
    reason === "account-changed"
      ? "ACCOUNT_SCOPE_CHANGED"
      : "REPORT_MODE_CHANGED",
    reason === "account-changed"
      ? "Amazon 帳號範圍已改變；本次操作已停止。"
      : "App 展示／真實模式已改變；本次操作已停止。",
  );

  adapter = createSpExecutionContextAdapter(async (marketplaceId) => {
    const marketplace = marketplaceById(marketplaceId);
    if (!marketplace) throw new Error("Amazon marketplace is unsupported.");
    const modeBeforeAccountRead = dependencies.resolveMode(marketplaceId);
    const accountScope = await dependencies.getOpaqueAccountScope(marketplace.region);
    const modeAfterAccountRead = dependencies.resolveMode(marketplaceId);
    if (modeBeforeAccountRead !== modeAfterAccountRead) {
      invalidateDetectedTransition("mode-changed");
      throw transitionError("mode-changed");
    }
    return {
      marketplaceId,
      mode: modeAfterAccountRead,
      accountScope,
    };
  });

  const captureOnce = async (
    marketplaceId: MarketplaceId,
  ): Promise<SpExecutionContext> => {
    const context = await adapter.capture(marketplaceId);
    const previousMarketplace = observed.get(marketplaceId);
    const previousRegion = [...observed.values()].find(
      (candidate) => candidate.region === context.region,
    );
    const reason = previousRegion &&
        previousRegion.accountScope !== context.accountScope
      ? "account-changed"
      : previousMarketplace && previousMarketplace.mode !== context.mode
        ? "mode-changed"
        : null;
    if (reason) {
      invalidateDetectedTransition(reason);
      throw transitionError(reason);
    }
    observed.set(marketplaceId, context);
    return context;
  };
  let captureTail: Promise<void> | null = null;
  const capture = (marketplaceId: MarketplaceId): Promise<SpExecutionContext> => {
    const capturedInvocationGeneration = invocationGeneration;
    const start = async (): Promise<SpExecutionContext> => {
      if (capturedInvocationGeneration !== invocationGeneration) {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "Amazon 執行環境已更新；請重新開始這次操作。",
        );
      }
      return captureOnce(marketplaceId);
    };
    const predecessor = captureTail;
    const turn = predecessor
      ? predecessor.then(start)
      : start();
    const settled = turn.then(
      () => undefined,
      () => undefined,
    );
    captureTail = settled;
    void settled.then(() => {
      if (captureTail === settled) captureTail = null;
    });
    return turn;
  };

  return {
    capture,
    async assertCurrent(context) {
      const current = await capture(context.marketplaceId);
      if (current.generation !== context.generation) {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "Amazon 執行環境已更新；請重新開始這次操作。",
        );
      }
      if (current.accountScope !== context.accountScope) {
        invalidateDetectedTransition("account-changed");
        throw transitionError("account-changed");
      }
      if (current.mode !== context.mode) {
        invalidateDetectedTransition("mode-changed");
        throw transitionError("mode-changed");
      }
      if (current.region !== context.region) {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "Amazon 執行環境已更新；請重新開始這次操作。",
        );
      }
    },
    invalidate(reason) {
      invocationGeneration += 1;
      observed.clear();
      adapter.invalidate(reason);
    },
  };
}
