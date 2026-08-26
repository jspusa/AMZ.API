import type { MarketplaceId } from "../../shared/marketplaces";
import { marketplaceCalendar } from "./marketplace-calendar";

export const MAX_ADVERTISED_PRODUCT_REPORT_RANGE_DAYS = 31;
export const MAX_ADVERTISED_PRODUCT_REPORT_HISTORY_DAYS = 95;

export type AdvertisedProductReportDateViolation = Readonly<{
  status: 400 | 500;
  code: "ADS_REPORT_DATE_INVALID";
  message: string;
}>;

/**
 * Shared pure date policy for the broker seam and the production Ads adapter.
 * Existing report references skip only the moving history window so a durable
 * lease cannot become unreadable while it is being polled.
 */
export function advertisedProductReportDateViolation(input: Readonly<{
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  now: Date;
  enforceCurrentWindow: boolean;
}>): AdvertisedProductReportDateViolation | null {
  const calendar = marketplaceCalendar(input.marketplaceId);
  if (
    !calendar.isDateKey(input.startDate) ||
    !calendar.isDateKey(input.endDate) ||
    input.startDate > input.endDate
  ) {
    return {
      status: 400,
      code: "ADS_REPORT_DATE_INVALID",
      message: "Amazon Ads 報表日期範圍無效。",
    };
  }
  const inclusiveDays = calendar.inclusiveDayCount(
    input.startDate,
    input.endDate,
  );
  if (inclusiveDays > MAX_ADVERTISED_PRODUCT_REPORT_RANGE_DAYS) {
    return {
      status: 400,
      code: "ADS_REPORT_DATE_INVALID",
      message: "Amazon Ads 報表一次最多讀取 31 個完整日。",
    };
  }
  if (!input.enforceCurrentWindow) return null;
  if (Number.isNaN(input.now.getTime())) {
    return {
      status: 500,
      code: "ADS_REPORT_DATE_INVALID",
      message: "Amazon Ads 站點日期無法核對。",
    };
  }
  const latest = calendar.shiftDate(calendar.dayAt(input.now), -1);
  const earliest = calendar.shiftDate(
    latest,
    -(MAX_ADVERTISED_PRODUCT_REPORT_HISTORY_DAYS - 1),
  );
  if (input.endDate > latest || input.startDate < earliest) {
    return {
      status: 400,
      code: "ADS_REPORT_DATE_INVALID",
      message: "Amazon Ads 報表只能讀取最近 95 天內的完整日。",
    };
  }
  return null;
}
