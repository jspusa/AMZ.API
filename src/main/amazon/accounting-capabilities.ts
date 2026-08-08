/**
 * Public SP-API accounting capability catalog and request-plan allowlist.
 *
 * This module performs no I/O and deliberately contains no Seller Central
 * private endpoints. It distinguishes downloadable public reports from JSON
 * financial transactions, Amazon-generated reports, manual prerequisites, and
 * invoice/bill artifacts that the public API does not provide for this app's
 * configured marketplaces.
 */

export const ACCOUNTING_MARKETPLACES = Object.freeze({
  ATVPDKIKX0DER: { code: "US", region: "NA" },
  A2EUQ1WTGCTBG2: { code: "CA", region: "NA" },
  A1VC38T7YXB528: { code: "JP", region: "FE" },
  A19VAU5U5O7RUS: { code: "SG", region: "FE" },
  A39IBJ37TRP1C6: { code: "AU", region: "FE" },
  A1F83G8C2ARO7P: { code: "UK", region: "EU" },
  A1PA6795UKMFR9: { code: "DE", region: "EU" },
} as const);

export type AccountingMarketplaceId = keyof typeof ACCOUNTING_MARKETPLACES;

export type AccountingCapabilityId =
  | "FINANCES_TRANSACTIONS"
  | "FBA_STORAGE_FEES"
  | "FBA_OVERAGE_FEES"
  | "FBA_FEE_PREVIEW"
  | "FBA_REIMBURSEMENTS"
  | "FBA_LONG_TERM_STORAGE_FEES"
  | "SETTLEMENT_V2"
  | "FINANCIAL_HOLDS"
  | "BRAZIL_FBA_INVOICES"
  | "GENERIC_MARKETPLACE_INVOICES"
  | "SELLER_ACCOUNT_BILLS";

export type AccountingCapability = {
  id: AccountingCapabilityId;
  label: string;
  artifact: "JSON" | "TAB_DELIMITED_REPORT" | "INVOICE_DOCUMENT" | "NONE";
  access:
    | "DIRECT_PUBLIC_API"
    | "CREATE_PUBLIC_REPORT"
    | "LIST_AMAZON_GENERATED_REPORT"
    | "SELLER_CENTRAL_PREREQUISITE"
    | "UNAVAILABLE_PUBLIC_API";
  roles: readonly string[];
  availability: "CONFIGURED_FBA_MARKETPLACES" | "BRAZIL_ONLY" | "NONE";
  officialAvailability: string;
  fbaSafety:
    | "OFFICIAL_FBA_ONLY"
    | "REQUIRES_AFN_ITEM_FILTER"
    | "ACCOUNT_WIDE_NOT_FBA_SAFE"
    | "BRAZIL_FBA_ONLY"
    | "NO_PUBLIC_DATA";
  reportType: string | null;
  officialSource: string;
  notice: string;
};

const FBA_REPORT_SOURCE =
  "https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba";
const PAYMENT_REPORT_SOURCE =
  "https://developer-docs.amazon.com/sp-api/docs/report-type-values-payment";

export const PUBLIC_ACCOUNTING_CAPABILITIES: readonly AccountingCapability[] =
  Object.freeze([
    {
      id: "FINANCES_TRANSACTIONS",
      label: "財務交易明細",
      artifact: "JSON",
      access: "DIRECT_PUBLIC_API",
      roles: ["Finance and Accounting"],
      availability: "CONFIGURED_FBA_MARKETPLACES",
      officialAvailability: "Sellers; NA, EU and FE regions",
      fbaSafety: "REQUIRES_AFN_ITEM_FILTER",
      reportType: null,
      officialSource:
        "https://developer-docs.amazon.com/sp-api/reference/listtransactions",
      notice:
        "Finances v2024-06-19 回傳可分頁交易 JSON，不是 Amazon 發票或帳單檔案；最近約 48 小時的財務事件可能尚未出現。Main process 必須只保留 ProductContext 可明確證明為 AFN 的 item，無證據的 transaction total 不可送給 renderer。",
    },
    {
      id: "FBA_STORAGE_FEES",
      label: "FBA 每月倉儲費估算",
      artifact: "TAB_DELIMITED_REPORT",
      access: "CREATE_PUBLIC_REPORT",
      roles: ["Pricing", "Amazon Fulfillment"],
      availability: "CONFIGURED_FBA_MARKETPLACES",
      officialAvailability: "FBA sellers",
      fbaSafety: "OFFICIAL_FBA_ONLY",
      reportType: "GET_FBA_STORAGE_FEE_CHARGES_DATA",
      officialSource: FBA_REPORT_SOURCE,
      notice: "可請求或排程；內容是估算的每月庫存倉儲費。",
    },
    {
      id: "FBA_OVERAGE_FEES",
      label: "FBA 庫容超額費估算",
      artifact: "TAB_DELIMITED_REPORT",
      access: "CREATE_PUBLIC_REPORT",
      roles: ["Amazon Fulfillment"],
      availability: "CONFIGURED_FBA_MARKETPLACES",
      officialAvailability: "FBA sellers",
      fbaSafety: "OFFICIAL_FBA_ONLY",
      reportType: "GET_FBA_OVERAGE_FEE_CHARGES_DATA",
      officialSource: FBA_REPORT_SOURCE,
      notice: "可請求；內容是超過庫容限制的估算費用。",
    },
    {
      id: "FBA_FEE_PREVIEW",
      label: "FBA 費用預估",
      artifact: "TAB_DELIMITED_REPORT",
      access: "CREATE_PUBLIC_REPORT",
      roles: ["Pricing", "Amazon Fulfillment"],
      availability: "CONFIGURED_FBA_MARKETPLACES",
      officialAvailability: "FBA sellers",
      fbaSafety: "OFFICIAL_FBA_ONLY",
      reportType: "GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA",
      officialSource: FBA_REPORT_SOURCE,
      notice:
        "每天每賣家最多請求一次；dataStartTime 必須至少早於送出當下 NOW 72 小時，dataEndTime 必須是 NOW，且此為估算而非帳單。AMZ.API 由 main process 在建立規劃時產生 NOW，不接受 renderer 傳入舊的結束日午夜。",
    },
    {
      id: "FBA_REIMBURSEMENTS",
      label: "FBA 賠償明細",
      artifact: "TAB_DELIMITED_REPORT",
      access: "CREATE_PUBLIC_REPORT",
      roles: ["Pricing", "Amazon Fulfillment"],
      availability: "CONFIGURED_FBA_MARKETPLACES",
      officialAvailability: "FBA sellers",
      fbaSafety: "OFFICIAL_FBA_ONLY",
      reportType: "GET_FBA_REIMBURSEMENTS_DATA",
      officialSource: FBA_REPORT_SOURCE,
      notice: "可請求；包含逐筆庫存賠償金額與原因，內容每日更新。",
    },
    {
      id: "FBA_LONG_TERM_STORAGE_FEES",
      label: "FBA 庫齡附加費明細",
      artifact: "TAB_DELIMITED_REPORT",
      access: "CREATE_PUBLIC_REPORT",
      roles: ["Pricing", "Amazon Fulfillment"],
      availability: "CONFIGURED_FBA_MARKETPLACES",
      officialAvailability: "FBA sellers",
      fbaSafety: "OFFICIAL_FBA_ONLY",
      reportType: "GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA",
      officialSource: FBA_REPORT_SOURCE,
      notice: "可請求；Amazon 要求 dataStartTime 到 dataEndTime 恰為一個月。",
    },
    {
      id: "SETTLEMENT_V2",
      label: "V2 結算報表",
      artifact: "TAB_DELIMITED_REPORT",
      access: "LIST_AMAZON_GENERATED_REPORT",
      roles: ["Finance and Accounting"],
      availability: "CONFIGURED_FBA_MARKETPLACES",
      officialAvailability: "Seller Central sellers; Amazon-generated settlement",
      fbaSafety: "ACCOUNT_WIDE_NOT_FBA_SAFE",
      reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
      officialSource: PAYMENT_REPORT_SOURCE,
      notice:
        "結算報表由 Amazon 產生，不能假裝可隨時建立新結算。文件可包含非 FBA 資料；在有逐列 FBA 過濾器前，AMZ.API 只可顯示能力說明，不可下載原始文件。",
    },
    {
      id: "FINANCIAL_HOLDS",
      label: "日期區間財務保留款",
      artifact: "TAB_DELIMITED_REPORT",
      access: "SELLER_CENTRAL_PREREQUISITE",
      roles: ["Finance and Accounting"],
      availability: "CONFIGURED_FBA_MARKETPLACES",
      officialAvailability: "Seller Central sellers; prior manual request required",
      fbaSafety: "ACCOUNT_WIDE_NOT_FBA_SAFE",
      reportType: "GET_DATE_RANGE_FINANCIAL_HOLDS_DATA",
      officialSource: PAYMENT_REPORT_SOURCE,
      notice:
        "Amazon 官方要求先在 Payments Reports Repository 手動請求；公開 Reports API 之後只能找回並下載已產生文件。",
    },
    {
      id: "BRAZIL_FBA_INVOICES",
      label: "巴西 FBA 發票",
      artifact: "INVOICE_DOCUMENT",
      access: "UNAVAILABLE_PUBLIC_API",
      roles: ["Tax Invoicing (Restricted)"],
      availability: "BRAZIL_ONLY",
      officialAvailability: "Sellers; Brazilian FBA invoices only; NA endpoint region",
      fbaSafety: "BRAZIL_FBA_ONLY",
      reportType: null,
      officialSource:
        "https://developer-docs.amazon.com/sp-api/docs/invoices-api",
      notice:
        "Invoices v2024-06-19 僅能下載巴西 FBA 發票；AMZ.API 目前站點不含巴西，必須維持停用。",
    },
    {
      id: "GENERIC_MARKETPLACE_INVOICES",
      label: "一般站點 Amazon 發票",
      artifact: "NONE",
      access: "UNAVAILABLE_PUBLIC_API",
      roles: [],
      availability: "NONE",
      officialAvailability: "No published generic invoice operation",
      fbaSafety: "NO_PUBLIC_DATA",
      reportType: null,
      officialSource:
        "https://developer-docs.amazon.com/sp-api/docs/invoices-api",
      notice: "Amazon 公開 SP-API 沒有提供 US／CA／JP／SG／AU／UK／DE 的通用發票下載。",
    },
    {
      id: "SELLER_ACCOUNT_BILLS",
      label: "賣家帳戶帳單",
      artifact: "NONE",
      access: "UNAVAILABLE_PUBLIC_API",
      roles: [],
      availability: "NONE",
      officialAvailability: "No published Seller Central bill-file operation",
      fbaSafety: "NO_PUBLIC_DATA",
      reportType: null,
      officialSource:
        "https://developer-docs.amazon.com/sp-api/docs/sp-api-models",
      notice:
        "公開 SP-API 沒有 Seller Central 帳單檔案接口；不得使用或模擬 Seller Central 私有接口。",
    },
  ] satisfies AccountingCapability[]);

export type AccountingAccessPlan = {
  capability: AccountingCapability;
  marketplaceId: AccountingMarketplaceId;
  state:
    | "READY_PUBLIC_API"
    | "MAIN_FBA_FILTER_REQUIRED"
    | "READY_CREATE_REPORT"
    | "READY_LIST_GENERATED"
    | "FBA_FILTER_NOT_IMPLEMENTED"
    | "MANUAL_PREREQUISITE"
    | "UNAVAILABLE";
  request: {
    method: "GET" | "POST";
    path: string;
    query?: Readonly<Record<string, string | readonly string[]>>;
    body?: Readonly<Record<string, unknown>>;
  } | null;
};

export function accountingCapability(
  id: AccountingCapabilityId,
): AccountingCapability {
  const found = PUBLIC_ACCOUNTING_CAPABILITIES.find((item) => item.id === id);
  if (!found) throw new TypeError("Accounting capability is not allowlisted.");
  return found;
}

export function buildAccountingAccessPlan(input: {
  capabilityId: AccountingCapabilityId;
  marketplaceId: string;
  dataStartTime?: string;
  dataEndTime?: string;
  now?: Date;
}): AccountingAccessPlan {
  const marketplaceId = configuredMarketplace(input.marketplaceId);
  const capability = accountingCapability(input.capabilityId);
  if (capability.availability !== "CONFIGURED_FBA_MARKETPLACES") {
    return { capability, marketplaceId, state: "UNAVAILABLE", request: null };
  }
  if (capability.id === "FINANCES_TRANSACTIONS") {
    const range = validateTransactionRange(input, input.now);
    return {
      capability,
      marketplaceId,
      state: "MAIN_FBA_FILTER_REQUIRED",
      request: {
        method: "GET",
        path: "/finances/2024-06-19/transactions",
        query: {
          marketplaceId,
          postedAfter: range.start,
          postedBefore: range.end,
        },
      },
    };
  }
  if (capability.access === "SELLER_CENTRAL_PREREQUISITE") {
    return {
      capability,
      marketplaceId,
      state: "MANUAL_PREREQUISITE",
      request: null,
    };
  }
  if (capability.access === "LIST_AMAZON_GENERATED_REPORT") {
    if (capability.fbaSafety === "ACCOUNT_WIDE_NOT_FBA_SAFE") {
      return {
        capability,
        marketplaceId,
        state: "FBA_FILTER_NOT_IMPLEMENTED",
        request: null,
      };
    }
    return {
      capability,
      marketplaceId,
      state: "READY_LIST_GENERATED",
      request: {
        method: "GET",
        path: "/reports/2021-06-30/reports",
        query: {
          reportTypes: [requiredReportType(capability)],
          marketplaceIds: [marketplaceId],
        },
      },
    };
  }
  if (capability.access === "CREATE_PUBLIC_REPORT") {
    const range = validateReportRange(capability.id, input, input.now);
    return {
      capability,
      marketplaceId,
      state: "READY_CREATE_REPORT",
      request: {
        method: "POST",
        path: "/reports/2021-06-30/reports",
        body: {
          reportType: requiredReportType(capability),
          marketplaceIds: [marketplaceId],
          ...(range?.start ? { dataStartTime: range.start } : {}),
          ...(range?.end ? { dataEndTime: range.end } : {}),
        },
      },
    };
  }
  return { capability, marketplaceId, state: "UNAVAILABLE", request: null };
}

export const ACCOUNTING_RENDERER_INTEGRATION_PLAN = Object.freeze({
  routes: {
    catalog: "GET /api/sp-api/accounting/capabilities",
    startOrList: "POST /api/sp-api/accounting/access-plan",
    status: "GET /api/sp-api/accounting/reports/status",
    download: "GET /api/sp-api/accounting/reports/download",
  },
  boundaries: [
    "Renderer 只接收 capability、工作狀態與文件；不接觸 LWA/AWS 憑證。",
    "Report ID 和 document ID 由 main process 與 marketplace/capability 連結後回查。",
    "BRAZIL_ONLY、NONE 與 MANUAL_PREREQUISITE 不顯示自動下載按鈕。",
    "Finances transaction 只可由 main process 輸出明確 AFN item；原始 transaction total 與尚未過濾的結算文件不可進 renderer。",
    "不建構任何 Seller Central 私有 URL 或封包。",
  ],
});

function configuredMarketplace(value: string): AccountingMarketplaceId {
  if (!(value in ACCOUNTING_MARKETPLACES)) {
    throw new TypeError("Marketplace is not configured in AMZ.API.");
  }
  return value as AccountingMarketplaceId;
}

function requiredReportType(capability: AccountingCapability): string {
  if (!capability.reportType) throw new TypeError("Capability has no report type.");
  return capability.reportType;
}

function parseDate(value: string | undefined, field: string): Date {
  if (!value) throw new TypeError(`${field} is required.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError(`${field} must be a canonical ISO timestamp.`);
  }
  return date;
}

function validateTransactionRange(
  input: { dataStartTime?: string; dataEndTime?: string },
  now = new Date(),
): { start: string; end: string } {
  if (Number.isNaN(now.getTime())) throw new TypeError("now is invalid.");
  const start = parseDate(input.dataStartTime, "dataStartTime");
  const end = parseDate(input.dataEndTime, "dataEndTime");
  if (end <= start || end.getTime() - start.getTime() > 180 * 86_400_000) {
    throw new TypeError("Finances transaction range must be positive and at most 180 days.");
  }
  if (end.getTime() > now.getTime() - 120_000) {
    throw new TypeError("postedBefore must be at least two minutes before the request.");
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

function validateReportRange(
  capabilityId: AccountingCapabilityId,
  input: { dataStartTime?: string; dataEndTime?: string },
  now = new Date(),
): { start?: string; end?: string } | null {
  const hasStart = input.dataStartTime !== undefined;
  const hasEnd = input.dataEndTime !== undefined;
  if (capabilityId === "FBA_FEE_PREVIEW") {
    if (Number.isNaN(now.getTime())) throw new TypeError("now is invalid.");
    if (hasEnd) {
      throw new TypeError(
        "FBA fee preview dataEndTime must be omitted; main process assigns the request NOW.",
      );
    }
    const start = parseDate(input.dataStartTime, "dataStartTime");
    const end = now;
    if (start.getTime() > end.getTime() - 72 * 3_600_000) {
      throw new TypeError(
        "FBA fee preview dataStartTime must be at least 72 hours before the request NOW.",
      );
    }
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (hasStart !== hasEnd) throw new TypeError("Report range requires both timestamps.");
  if (!hasStart || !hasEnd) {
    if (capabilityId === "FBA_LONG_TERM_STORAGE_FEES") {
      throw new TypeError("This report requires an explicit official time range.");
    }
    return null;
  }
  const start = parseDate(input.dataStartTime, "dataStartTime");
  const end = parseDate(input.dataEndTime, "dataEndTime");
  if (end <= start) throw new TypeError("Report range must be positive.");
  if (capabilityId === "FBA_LONG_TERM_STORAGE_FEES") {
    const oneMonthLater = new Date(start.getTime());
    oneMonthLater.setUTCMonth(oneMonthLater.getUTCMonth() + 1);
    if (oneMonthLater.getTime() !== end.getTime()) {
      throw new TypeError("Long-term storage fee range must be exactly one calendar month.");
    }
  }
  return { start: start.toISOString(), end: end.toISOString() };
}
