import type {
  MarketplaceId,
  MarketplaceRegion,
} from "../../shared/marketplaces";
import { FbaSalesPlanningError } from "./fba-sales-calendar";
import {
  FbaSalesMetricsError,
  readFbaSalesTrend,
  type ReadFbaSalesTrendInput,
  type SalesTrendSnapshot,
} from "./fba-sales-metrics";
import { createDeterministicFbaSalesMetricsDemoAdapter } from
  "./fba-sales-metrics-demo";
import { createFbaSalesMetricsProductionAdapter } from
  "./fba-sales-metrics-production";
import { SpApiError } from "./sp-api-error";

export type FbaSalesTrendPort = (
  input: ReadFbaSalesTrendInput,
) => Promise<SalesTrendSnapshot>;

export type FbaSalesTrendDependencies = Readonly<{
  usesDemoMode(marketplaceId: MarketplaceId): boolean;
  isConfiguredForMarketplace(marketplaceId: MarketplaceId): boolean;
  marketplaceLabel(marketplaceId: MarketplaceId): string;
  getAccessToken(
    region: MarketplaceRegion,
    forceRefresh: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
}>;

function invalidSalesTrendRange(message: string): never {
  throw new SpApiError(message, {
    status: 400,
    code: "INVALID_SALES_TREND_RANGE",
  });
}

export function throwFbaSalesFacadeError(error: unknown): never {
  if (error instanceof FbaSalesPlanningError) {
    invalidSalesTrendRange(error.message);
  }
  if (error instanceof FbaSalesMetricsError) {
    throw new SpApiError(error.message, {
      status: error.status,
      code: error.code,
      requestId: error.requestId,
      retryAfter: error.retryAfter,
    });
  }
  throw error;
}

export function createFbaSalesTrend(
  dependencies: FbaSalesTrendDependencies,
): FbaSalesTrendPort {
  return async function getSalesTrend(input): Promise<SalesTrendSnapshot> {
    const demoMode = dependencies.usesDemoMode(input.marketplaceId);
    const adapter = demoMode
      ? createDeterministicFbaSalesMetricsDemoAdapter()
      : createFbaSalesMetricsProductionAdapter({
          getAccessToken: dependencies.getAccessToken,
          invalidateAccessToken: dependencies.invalidateAccessToken,
        });
    try {
      return await readFbaSalesTrend(input, {
        adapter,
        mode: demoMode ? "demo" : "live",
        demoNotice: demoMode
          ? dependencies.isConfiguredForMarketplace(input.marketplaceId)
            ? "目前由 SP_API_MODE 強制使用展示資料；趨勢只供版面測試。"
            : `${dependencies.marketplaceLabel(input.marketplaceId)}站尚未在本機系統安全儲存區加入 refresh token，因此顯示展示趨勢。`
          : undefined,
      });
    } catch (error) {
      throwFbaSalesFacadeError(error);
    }
  };
}
