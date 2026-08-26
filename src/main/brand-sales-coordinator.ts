import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { MarketplaceId } from "../shared/marketplaces";
import {
  FbaRevenueReports,
  FbaRevenueReportsError,
  type FbaRevenueJobResult,
  type FbaRevenueJobView,
  type FbaRevenueReportsDependencies,
} from "./amazon/fba-revenue-reports";
import { publicSpApiError, SpApiError } from "./amazon/sp-api-error";
import {
  bodyRecord,
  optionalDate,
  parseMarketplace,
  reportIdentifier,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";

export type { BrandSalesDemoSource } from "./amazon/fba-revenue-reports";

type BrandSalesReportsPort = Readonly<{
  begin(input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    explicitRetry: boolean;
  }>): Promise<FbaRevenueJobView>;
  get(input: Readonly<{
    marketplaceId: MarketplaceId;
    jobId: string;
    includeData: boolean;
  }>): Promise<FbaRevenueJobResult>;
  clear(): void;
}>;

export interface BrandSalesCoordinatorPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  observe(request: ApiRequest): Promise<ApiResponse>;
  clear(): void;
}

function coordinatorError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof FbaRevenueReportsError) {
    const publicError = publicSpApiError(new SpApiError(error.message, {
      status: error.status,
      code: error.code,
      retryAfter: error.retryAfter,
    }), fallback);
    return json(
      { code: publicError.code, message: publicError.message },
      publicError.status,
      publicError.retryAfter ? { "retry-after": publicError.retryAfter } : {},
    );
  }
  return routeError(error, fallback);
}

/**
 * Renderer-facing owner of the complete Brand/Category revenue workflow.
 * Its private reports engine keeps both durable report legs, selection,
 * polling, reuse, immutable windows, snapshots, and context fences together.
 */
export class BrandSalesCoordinator implements BrandSalesCoordinatorPort {
  private readonly reports: BrandSalesReportsPort;

  constructor(reports: BrandSalesReportsPort) {
    this.reports = reports;
  }

  clear(): void {
    this.reports.clear();
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    const startDate = optionalDate(body?.startDate);
    const endDate = optionalDate(body?.endDate);
    if (
      !body ||
      !marketplaceId ||
      typeof startDate !== "string" ||
      typeof endDate !== "string" ||
      (body.retry !== undefined && body.retry !== true)
    ) {
      return invalid("品牌營收需要有效站點與完整 YYYY-MM-DD 日期範圍。");
    }
    try {
      const view = await this.reports.begin({
        marketplaceId,
        startDate,
        endDate,
        explicitRetry: body.retry === true,
      });
      return json(view, view.ready ? 200 : 202);
    } catch (error) {
      return coordinatorError(
        error,
        "開始整理 FBA 品牌營收時發生未預期的錯誤。",
      );
    }
  }

  async observe(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = reportIdentifier(request.query.jobId);
    if (!marketplaceId || !jobId) {
      return invalid("品牌營收工作資訊無效，請重新同步。");
    }
    try {
      const result = await this.reports.get({
        marketplaceId,
        jobId,
        includeData: request.query.data === "1",
      });
      return json(
        result.snapshot ?? result.view,
        result.snapshot || result.view.ready ? 200 : 202,
      );
    } catch (error) {
      return coordinatorError(
        error,
        "整理 FBA 品牌營收時發生未預期的錯誤。",
      );
    }
  }
}

export function createBrandSalesCoordinator(
  input: FbaRevenueReportsDependencies,
): BrandSalesCoordinator {
  return new BrandSalesCoordinator(new FbaRevenueReports(input));
}
