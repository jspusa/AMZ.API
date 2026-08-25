import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  PUBLIC_ACCOUNTING_CAPABILITIES,
  buildAccountingAccessPlan,
  type AccountingAccessPlan,
  type AccountingCapability,
  type AccountingCapabilityId,
} from "./amazon/accounting-capabilities";
import {
  CURRENT_APP_EXPORTS,
  PUBLIC_REPORT_CATALOG,
  REPORT_LIBRARY_NOTICE,
  REPORT_LIBRARY_UNAVAILABLE_DOCUMENTS,
  buildReportAccessPlan,
} from "./amazon/report-library";
import {
  REVIEW_AUDIT_CAPABILITY,
  customerFeedbackMarketplaceSupported,
} from "./amazon/review-audit";
import { bodyRecord, parseMarketplace } from "./route-input";
import { invalid, json, routeError } from "./route-response";

export interface PlanningCapabilityRoutesPort {
  accountingCapabilities(request: ApiRequest): ApiResponse;
  accountingAccessPlan(request: ApiRequest): ApiResponse;
  reportLibrary(request: ApiRequest): ApiResponse;
  reportLibraryAccessPlan(request: ApiRequest): ApiResponse;
}

function parseAccountingCapabilityId(
  value: unknown,
): AccountingCapabilityId | null {
  if (typeof value !== "string") return null;
  return PUBLIC_ACCOUNTING_CAPABILITIES.some(
    (capability) => capability.id === value,
  )
    ? value as AccountingCapabilityId
    : null;
}

function canonicalIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value || value !== value.trim()) return null;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

function accountingCatalogState(
  capability: AccountingCapability,
): AccountingAccessPlan["state"] {
  if (capability.availability !== "CONFIGURED_FBA_MARKETPLACES") {
    return "UNAVAILABLE";
  }
  if (capability.id === "FINANCES_TRANSACTIONS") {
    return "MAIN_FBA_FILTER_REQUIRED";
  }
  if (capability.access === "SELLER_CENTRAL_PREREQUISITE") {
    return "MANUAL_PREREQUISITE";
  }
  if (
    capability.access === "LIST_AMAZON_GENERATED_REPORT" &&
    capability.fbaSafety === "ACCOUNT_WIDE_NOT_FBA_SAFE"
  ) {
    return "FBA_FILTER_NOT_IMPLEMENTED";
  }
  if (capability.access === "LIST_AMAZON_GENERATED_REPORT") {
    return "READY_LIST_GENERATED";
  }
  if (capability.access === "CREATE_PUBLIC_REPORT") {
    return "READY_CREATE_REPORT";
  }
  return capability.access === "DIRECT_PUBLIC_API"
    ? "READY_PUBLIC_API"
    : "UNAVAILABLE";
}

function accountingPlanNextStep(
  state: AccountingAccessPlan["state"],
): string | null {
  switch (state) {
    case "READY_PUBLIC_API":
      return "這裡只完成公開 API 與日期規則的安全規劃；尚未讀取交易，也不會輸出未證明為 FBA 的金額。";
    case "READY_CREATE_REPORT":
      return "這裡只完成公開 Reports API、日期與 FBA allowlist 驗證；尚未建立、輪詢或下載 Amazon 報表。";
    case "READY_LIST_GENERATED":
      return "這裡只完成列出 Amazon 已產生報表的安全規劃；尚未查詢或下載文件。";
    case "MAIN_FBA_FILTER_REQUIRED":
      return "必須先在 main process 完成逐項 AFN 證據過濾；目前不讀取，也不會把帳戶總額送到畫面。";
    case "FBA_FILTER_NOT_IMPLEMENTED":
      return "文件可能混有非 FBA 資料；在逐列 FBA 過濾完成前維持禁止下載。";
    case "MANUAL_PREREQUISITE":
      return "必須先由你在 Amazon 官方介面產生文件；AMZ.API 不會使用 Seller Central 私有接口。";
    case "UNAVAILABLE":
      return "目前沒有符合此站點與 FBA-only 邊界的 Amazon 公開下載 API。";
  }
}

/** Stateless capability projections. These methods never call an upstream API. */
export class PlanningCapabilityRoutes implements PlanningCapabilityRoutesPort {
  accountingCapabilities(request: ApiRequest): ApiResponse {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("不支援這個 Amazon 站點。");
    return json({
      marketplaceId,
      fetchedAt: new Date().toISOString(),
      capabilities: PUBLIC_ACCOUNTING_CAPABILITIES.map((capability) => ({
        ...capability,
        roles: [...capability.roles],
        state: accountingCatalogState(capability),
      })),
      notice:
        "這裡只列出 Amazon 公開 SP-API 的 FBA 帳務能力與安全規劃狀態；尚未建立、輪詢或下載報表，也不使用 Seller Central 私有接口。",
    });
  }

  accountingAccessPlan(request: ApiRequest): ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid("帳務規劃必須使用 JSON。", 400, "INVALID_ACCOUNTING_PLAN");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const capabilityId = parseAccountingCapabilityId(body.capabilityId);
    if (!marketplaceId || !capabilityId) {
      return invalid(
        "請提供有效的站點與公開 API 帳務能力。",
        400,
        "INVALID_ACCOUNTING_PLAN",
      );
    }
    const startPresent = body.dataStartTime !== undefined;
    const endPresent = body.dataEndTime !== undefined;
    const dataStartTime = startPresent
      ? canonicalIsoTimestamp(body.dataStartTime)
      : undefined;
    const dataEndTime = endPresent
      ? canonicalIsoTimestamp(body.dataEndTime)
      : undefined;
    if ((startPresent && !dataStartTime) || (endPresent && !dataEndTime)) {
      return invalid(
        "帳務日期必須是完整、標準的 ISO 時間。",
        400,
        "INVALID_ACCOUNTING_DATE",
      );
    }
    try {
      const plan = buildAccountingAccessPlan({
        capabilityId,
        marketplaceId,
        ...(dataStartTime ? { dataStartTime } : {}),
        ...(dataEndTime ? { dataEndTime } : {}),
      });
      return json({
        capabilityId,
        marketplaceId,
        state: plan.state,
        notice: plan.capability.notice,
        nextStep: accountingPlanNextStep(plan.state),
      });
    } catch (error) {
      if (error instanceof TypeError) {
        return invalid(error.message, 400, "INVALID_ACCOUNTING_PLAN");
      }
      return routeError(
        error,
        "建立公開 API 帳務規劃時發生未預期的錯誤。",
      );
    }
  }

  reportLibrary(request: ApiRequest): ApiResponse {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId) return invalid("文件庫站點無效。");
    return json({
      schemaVersion: 1,
      marketplaceId,
      fetchedAt: new Date().toISOString(),
      officialCatalog: {
        uniqueReportTypeCount: PUBLIC_REPORT_CATALOG.length,
        verifiedAt: "2026-08-09",
        officialPageUpdatedLabel:
          "Amazon 官方頁面於驗證時標示 Updated 5 days ago",
        source:
          "https://developer-docs.amazon.com/sp-api/docs/report-type-values",
        changeNotice:
          "Amazon 官方 report type 清單可能隨時更新；此版本依 2026-08-09 驗證的 109 個唯一類型。",
      },
      currentAppExports: CURRENT_APP_EXPORTS.map((item) => ({ ...item })),
      reports: PUBLIC_REPORT_CATALOG.map((report) => {
        const plan = buildReportAccessPlan({
          marketplaceId,
          reportType: report.reportType,
        });
        return {
          ...report,
          categories: [...report.categories],
          roles: [...report.roles],
          supportedConfiguredMarketplaces:
            report.supportedConfiguredMarketplaces === null
              ? null
              : [...report.supportedConfiguredMarketplaces],
          prerequisites: [...report.prerequisites],
          state: plan.state,
          amazonPublicArtifactAvailable: plan.amazonPublicArtifactAvailable,
          appDownloadImplemented: plan.appDownloadImplemented,
          stateNotice: plan.notice,
        };
      }),
      unavailableDocuments: REPORT_LIBRARY_UNAVAILABLE_DOCUMENTS.map(
        (item) => ({ ...item }),
      ),
      reviewAuditCapability: {
        ...REVIEW_AUDIT_CAPABILITY,
        roles: [...REVIEW_AUDIT_CAPABILITY.roles],
        supportedConfiguredMarketplaces: [
          ...REVIEW_AUDIT_CAPABILITY.supportedConfiguredMarketplaces,
        ],
        supportedForMarketplace:
          customerFeedbackMarketplaceSupported(marketplaceId),
      },
      notice: REPORT_LIBRARY_NOTICE,
    });
  }

  reportLibraryAccessPlan(request: ApiRequest): ApiResponse {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    const reportType = typeof body?.reportType === "string" &&
      /^[A-Z0-9_]{3,120}$/u.test(body.reportType)
      ? body.reportType
      : null;
    if (!body || !marketplaceId || !reportType) {
      return invalid(
        "請提供有效站點與 Amazon 公開 reportType。",
        400,
        "INVALID_REPORT_PLAN",
      );
    }
    try {
      return json(buildReportAccessPlan({ marketplaceId, reportType }));
    } catch (error) {
      return error instanceof TypeError
        ? invalid(error.message, 400, "INVALID_REPORT_PLAN")
        : routeError(error, "建立文件庫能力規劃時發生未預期的錯誤。");
    }
  }
}
