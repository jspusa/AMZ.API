import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  DEFAULT_MARKETPLACE_ID,
  type MarketplaceId,
} from "../shared/marketplaces";
import type { SpExecutionContextAdapter } from
  "./amazon/sp-execution-context";
import type {
  SalesTrendComparisonMode,
  SalesTrendPresetDays,
} from "./amazon/fba-sales-calendar";
import {
  integer,
  optionalDate,
  parseMarketplace,
  parseSellerSku,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";

export type FbaSalesTrendOperation = (input: {
  marketplaceId: MarketplaceId;
  days: SalesTrendPresetDays | null;
  startDate: string | null;
  endDate: string | null;
  comparison: SalesTrendComparisonMode;
}) => Promise<unknown>;

export type FbaReplenishmentOperation = (input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  targetDays: number;
  leadTimeDays: number;
  safetyDays: number;
  casePack: number;
}) => Promise<unknown>;

export interface FbaSalesMetricsRoutesPort {
  salesTrend(request: ApiRequest): Promise<ApiResponse>;
  replenishment(request: ApiRequest): Promise<ApiResponse>;
}

export type FbaSalesMetricsRoutesDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  salesTrend: FbaSalesTrendOperation;
  replenishment: FbaReplenishmentOperation;
}>;

/**
 * Renderer-facing owner for the two FBA Sales Metrics route operations.
 * Transport, AFN scope, daily granularity, buyer type, and velocity duration
 * remain closed behind the injected semantic facades.
 */
export class FbaSalesMetricsRoutes implements FbaSalesMetricsRoutesPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly readSalesTrend: FbaSalesTrendOperation;
  private readonly readReplenishment: FbaReplenishmentOperation;

  constructor(input: FbaSalesMetricsRoutesDependencies) {
    this.context = input.context;
    this.readSalesTrend = input.salesTrend;
    this.readReplenishment = input.replenishment;
  }

  async salesTrend(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(
      request.query.marketplaceId ?? DEFAULT_MARKETPLACE_ID,
    );
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");

    const supplied = (name: string) =>
      Object.prototype.hasOwnProperty.call(request.query, name);
    const hasDays = supplied("days");
    const hasStartDate = supplied("startDate");
    const hasEndDate = supplied("endDate");
    if (hasDays && (hasStartDate || hasEndDate)) {
      return invalid("預設天數與自訂日期不可同時使用。");
    }
    if (hasStartDate !== hasEndDate) {
      return invalid("自訂日期必須同時提供開始日與結束日。");
    }

    let days: SalesTrendPresetDays | null = null;
    let startDate: string | null = null;
    let endDate: string | null = null;
    if (hasDays) {
      if (!/^(?:7|14|30|90)$/u.test(request.query.days)) {
        return invalid("銷售趨勢只支援最近 7、14、30 或 90 天。");
      }
      days = Number(request.query.days) as SalesTrendPresetDays;
    } else if (hasStartDate && hasEndDate) {
      const parsedStart = optionalDate(request.query.startDate);
      const parsedEnd = optionalDate(request.query.endDate);
      if (typeof parsedStart !== "string" || typeof parsedEnd !== "string") {
        return invalid("自訂日期必須使用 YYYY-MM-DD 格式。");
      }
      startDate = parsedStart;
      endDate = parsedEnd;
    } else {
      days = 7;
    }

    const comparison = request.query.comparison ?? "none";
    if (comparison !== "none" && comparison !== "previous-year") {
      return invalid("不支援這個銷售趨勢比較方式。");
    }
    try {
      const context = await this.context.capture(marketplaceId);
      const value = await this.readSalesTrend({
        marketplaceId,
        days,
        startDate,
        endDate,
        comparison,
      });
      await this.context.assertCurrent(context);
      return json(value);
    } catch (error) {
      return routeError(error, "載入 FBA 銷售趨勢時發生未預期的錯誤。");
    }
  }

  async replenishment(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    const targetDays = integer(request.query.targetDays, 60, 14, 180);
    // AWD profiles may add up to 60 days to the 1–120 day supplier lead time.
    const leadTimeDays = integer(request.query.leadTimeDays, 35, 1, 180);
    const safetyDays = integer(request.query.safetyDays, 14, 0, 90);
    const casePack = integer(request.query.casePack, 1, 1, 10_000);
    if (
      !marketplaceId ||
      !sellerSku ||
      targetDays === null ||
      leadTimeDays === null ||
      safetyDays === null ||
      casePack === null
    ) {
      return invalid(
        "請提供有效的站點、SKU、目標天數、交期、安全天數與箱入數。",
      );
    }
    if (targetDays < leadTimeDays + safetyDays) {
      return invalid(
        "目標庫存天數不能小於補貨交期加安全庫存，否則補貨建議會互相矛盾。",
        400,
        "INVALID_RESTOCK_WINDOW",
      );
    }
    try {
      const context = await this.context.capture(marketplaceId);
      const value = await this.readReplenishment({
        marketplaceId,
        sellerSku,
        targetDays,
        leadTimeDays,
        safetyDays,
        casePack,
      });
      await this.context.assertCurrent(context);
      return json(value);
    } catch (error) {
      return routeError(error, "建立 FBA 補貨建議時發生未預期的錯誤。");
    }
  }
}
