import { AsyncLocalStorage } from "node:async_hooks";
import type { MarketplaceId } from "../shared/marketplaces";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
  type SpExecutionContextInvalidationReason,
} from "./amazon/sp-execution-context";

type RouterOperationState = {
  marketplaceId: MarketplaceId | null;
  context: Promise<SpExecutionContext> | null;
  closed: boolean;
};

export interface RouterRequestContextAdapter extends SpExecutionContextAdapter {
  runOperation<T>(operation: () => Promise<T>): Promise<T>;
  assertOperationCurrent(): Promise<void>;
}

/**
 * Owns one lazy SP execution context per public router operation. Deep modules
 * can keep using the narrow SpExecutionContextAdapter interface: repeated
 * captures inside the same operation resolve to the exact same frozen value.
 *
 * Async callbacks may inherit an AsyncLocalStorage store after the public
 * operation returns, so closed stores deliberately fall back to the base
 * adapter instead of leaking a stale request context into background jobs.
 */
export function createRouterRequestContextAdapter(
  base: SpExecutionContextAdapter,
): RouterRequestContextAdapter {
  const operations = new AsyncLocalStorage<RouterOperationState>();

  const capture = (marketplaceId: MarketplaceId): Promise<SpExecutionContext> => {
    const operation = operations.getStore();
    if (!operation || operation.closed) return base.capture(marketplaceId);
    if (
      operation.marketplaceId !== null &&
      operation.marketplaceId !== marketplaceId
    ) {
      return Promise.reject(new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      ));
    }
    operation.marketplaceId = marketplaceId;
    operation.context ??= base.capture(marketplaceId);
    return operation.context;
  };

  return {
    capture,
    assertCurrent: (context) => base.assertCurrent(context),
    invalidate: (reason: SpExecutionContextInvalidationReason) =>
      base.invalidate(reason),
    async runOperation<T>(operation: () => Promise<T>): Promise<T> {
      const state: RouterOperationState = {
        marketplaceId: null,
        context: null,
        closed: false,
      };
      try {
        return await operations.run(state, operation);
      } finally {
        state.closed = true;
      }
    },
    async assertOperationCurrent(): Promise<void> {
      const operation = operations.getStore();
      if (!operation || operation.closed || !operation.context) return;
      await base.assertCurrent(await operation.context);
    },
  };
}
