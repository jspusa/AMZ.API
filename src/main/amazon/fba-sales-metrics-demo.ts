import { marketplaceById } from "../../shared/marketplaces";
import {
  FbaSalesMetricsError,
  type FbaSalesMetricsAdapter,
} from "./fba-sales-metrics";

export function createDeterministicFbaSalesMetricsDemoAdapter(): FbaSalesMetricsAdapter {
  return {
    async readDaily(plan) {
      const currencyCode = marketplaceById(plan.marketplaceId)?.currency;
      if (!currencyCode) {
        throw new FbaSalesMetricsError(
          "Amazon 回傳了無法辨識的 FBA 銷售趨勢。",
        );
      }
      const seed =
        plan.trendDayCount + (plan.series === "previous-year" ? 5 : 0);
      const base = currencyCode === "JPY" ? 18_000 : 180;
      return {
        envelope: {
          payload: plan.window.dateKeys.map((_, index) => {
            const unitCount = 8 + ((index * 7 + seed) % 13);
            const amount = Number(
              (base * (0.72 + ((index * 11 + seed) % 9) / 10)).toFixed(
                currencyCode === "JPY" ? 0 : 2,
              ),
            );
            return {
              interval: plan.window.intervals[index],
              totalSales: { amount, currencyCode },
              unitCount,
              orderItemCount: Math.max(1, unitCount - (index % 3)),
              orderCount: Math.max(1, unitCount - 2 - (index % 4)),
            };
          }),
        },
        requestId: null,
        rateLimit: null,
      };
    },
  };
}
