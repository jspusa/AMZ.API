/**
 * Renderer-safe catalog of the public Selling Partner Reports API report types.
 *
 * The catalog is intentionally data-only. It never calls Amazon, never exposes
 * an upstream URL/body, and never contains Seller Central private endpoints.
 * A report being present here means that Amazon documents the reportType; it
 * does not mean that this FBA-only app is authorised or able to download it.
 */

export const REPORT_LIBRARY_MARKETPLACES = Object.freeze({
  ATVPDKIKX0DER: { code: "US", label: "美國" },
  A2EUQ1WTGCTBG2: { code: "CA", label: "加拿大" },
  A1VC38T7YXB528: { code: "JP", label: "日本" },
  A19VAU5U5O7RUS: { code: "SG", label: "新加坡" },
  A39IBJ37TRP1C6: { code: "AU", label: "澳洲" },
  A1F83G8C2ARO7P: { code: "UK", label: "英國" },
  A1PA6795UKMFR9: { code: "DE", label: "德國" },
} as const);

export type ReportLibraryMarketplaceId = keyof typeof REPORT_LIBRARY_MARKETPLACES;

export type ReportCategory =
  | "AMAZON_BUSINESS"
  | "ANALYTICS"
  | "B2B_OPPORTUNITIES"
  | "BROWSE_TREE"
  | "EASY_SHIP"
  | "FBA"
  | "INVENTORY"
  | "INVOICE_DATA"
  | "ORDER"
  | "PAYMENT"
  | "PERFORMANCE"
  | "REGULATORY"
  | "RETURNS"
  | "SETTLEMENT"
  | "TAX";

export type ReportCatalogEntry = {
  reportType: string;
  label: string;
  description: string;
  categories: readonly ReportCategory[];
  party: "SELLER" | "VENDOR" | "BOTH";
  fbaScope: "FBA_ONLY" | "MIXED_FILTER_REQUIRED" | "OUT_OF_FBA_SCOPE";
  lifecycle:
    | "REQUEST"
    | "REQUEST_OR_SCHEDULE"
    | "AUTOMATIC_ONLY"
    | "MANUAL_THEN_LIST";
  output: "TAB_DELIMITED" | "CSV" | "XML" | "JSON" | "PDF_OR_ZIP" | "MIXED";
  restrictedData: "NONE" | "RDT_REQUIRED";
  roles: readonly string[];
  marketplaceAvailability: string;
  supportedConfiguredMarketplaces: readonly ReportLibraryMarketplaceId[] | null;
  prerequisites: readonly string[];
  deprecated: boolean;
  officialSource: string;
};

export type ReportAccessState =
  | "READY_TO_PLAN"
  | "FBA_FILTER_REQUIRED"
  | "EXTRA_ROLE_REQUIRED"
  | "RDT_REQUIRED"
  | "MANUAL_PREREQUISITE"
  | "AMAZON_GENERATED_ONLY"
  | "MARKETPLACE_UNAVAILABLE"
  | "VENDOR_ONLY"
  | "OUT_OF_FBA_SCOPE"
  | "DEPRECATED";

export type ReportAccessPlan = {
  reportType: string;
  marketplaceId: ReportLibraryMarketplaceId;
  state: ReportAccessState;
  /** Amazon documents a retrievable artifact for this reportType. */
  amazonPublicArtifactAvailable: boolean;
  /** v0.1.11 catalog is read-only planning; no generic downloader is wired. */
  appDownloadImplemented: false;
  notice: string;
  nextStep: string | null;
};

type Seed = Omit<
  ReportCatalogEntry,
  "categories" | "roles" | "marketplaceAvailability" |
  "supportedConfiguredMarketplaces" | "prerequisites" | "deprecated" |
  "officialSource" | "party" | "fbaScope" | "lifecycle" | "output" |
  "restrictedData"
> & Partial<Omit<ReportCatalogEntry, "reportType" | "label" | "description">>;

const SOURCES: Record<ReportCategory, string> = {
  AMAZON_BUSINESS: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-amazon-business",
  ANALYTICS: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-analytics",
  B2B_OPPORTUNITIES: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-b2b-product-opportunities",
  BROWSE_TREE: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-browse-tree",
  EASY_SHIP: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-easy-ship",
  FBA: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba",
  INVENTORY: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-inventory",
  INVOICE_DATA: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-invoice-data",
  ORDER: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-order",
  PAYMENT: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-payment",
  PERFORMANCE: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-performance",
  REGULATORY: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-regulatory-compliance",
  RETURNS: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-returns",
  SETTLEMENT: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-settlement",
  TAX: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-tax",
};

const ALL = Object.keys(REPORT_LIBRARY_MARKETPLACES) as ReportLibraryMarketplaceId[];
const CUSTOMER_FEEDBACK_STORES: ReportLibraryMarketplaceId[] = [
  "ATVPDKIKX0DER",
  "A1VC38T7YXB528",
  "A1F83G8C2ARO7P",
  "A1PA6795UKMFR9",
];
const EU_REGULATORY: ReportLibraryMarketplaceId[] = ["A1F83G8C2ARO7P", "A1PA6795UKMFR9"];

function entry(seed: Seed): ReportCatalogEntry {
  const categories = seed.categories;
  const category = categories?.[0];
  if (!category) throw new TypeError(`Report ${seed.reportType} is missing a category.`);
  return Object.freeze({
    party: "SELLER",
    fbaScope: "OUT_OF_FBA_SCOPE",
    lifecycle: "REQUEST",
    output: "TAB_DELIMITED",
    restrictedData: "NONE",
    roles: [],
    marketplaceAvailability: "Amazon report-specific availability; account eligibility is checked by Amazon.",
    supportedConfiguredMarketplaces: ALL,
    prerequisites: [],
    deprecated: false,
    officialSource: SOURCES[category],
    ...seed,
    categories,
  } as ReportCatalogEntry);
}

function entries(
  defaults: Partial<ReportCatalogEntry>,
  rows: ReadonlyArray<readonly [string, string, string, Partial<ReportCatalogEntry>?]>,
): ReportCatalogEntry[] {
  return rows.map(([reportType, label, description, overrides]) => entry({
    reportType,
    label,
    description,
    ...defaults,
    ...overrides,
  }));
}

const AMAZON_BUSINESS = entries(
  {
    categories: ["AMAZON_BUSINESS"],
    party: "SELLER",
    fbaScope: "MIXED_FILTER_REQUIRED",
    lifecycle: "REQUEST",
    output: "TAB_DELIMITED",
    roles: ["Amazon Business"],
  },
  [["FEE_DISCOUNTS_REPORT", "Amazon Business 費用折扣", "Amazon Business 費用折扣資料；可能包含非 FBA 資料，需逐列證明。"]],
);

const ANALYTICS = entries(
  {
    categories: ["ANALYTICS"],
    lifecycle: "REQUEST_OR_SCHEDULE",
    output: "JSON",
    roles: ["Brand Analytics"],
    prerequisites: ["Amazon Brand Registry 與 Brand Analytics 權限"],
    fbaScope: "MIXED_FILTER_REQUIRED",
  },
  [
    ["GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT", "搜尋目錄績效", "品牌搜尋目錄曝光、點擊、加購與購買漏斗。"],
    ["GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT", "搜尋查詢績效", "品牌查詢層級的搜尋漏斗。"],
    ["GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT", "購物籃分析", "顧客與品牌商品一同購買的商品。", { party: "BOTH" }],
    ["GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT", "搜尋詞報表", "高熱度搜尋詞與品牌商品點擊／轉換。", { party: "BOTH" }],
    ["GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT", "重複購買", "品牌商品的重複購買顧客與銷售。", { party: "BOTH" }],
    ["GET_SALES_AND_TRAFFIC_REPORT", "業務報表：銷售與流量", "以日期與 ASIN 彙總銷售、訂單、流量與購買盒指標；Amazon 官方 reportOptions 是 DATE 與 ASIN 聚合，不宣稱有 SKU 粒度，也不能直接證明 FBA-only。"],
    ["GET_VENDOR_REAL_TIME_INVENTORY_REPORT", "Vendor 即時庫存", "Vendor Central 即時庫存分析。", { party: "VENDOR", fbaScope: "OUT_OF_FBA_SCOPE", roles: ["Vendor Analytics"] }],
    ["GET_VENDOR_REAL_TIME_TRAFFIC_REPORT", "Vendor 即時流量", "Vendor Central 即時流量分析。", { party: "VENDOR", fbaScope: "OUT_OF_FBA_SCOPE", roles: ["Vendor Analytics"] }],
    ["GET_VENDOR_REAL_TIME_SALES_REPORT", "Vendor 即時銷售", "Vendor Central 即時銷售分析。", { party: "VENDOR", fbaScope: "OUT_OF_FBA_SCOPE", roles: ["Vendor Analytics"] }],
    ["GET_VENDOR_SALES_REPORT", "Vendor 銷售", "Vendor Central 銷售分析。", { party: "VENDOR", fbaScope: "OUT_OF_FBA_SCOPE", roles: ["Vendor Analytics"] }],
    ["GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT", "Vendor 淨產品利潤", "Vendor Central 淨 PPM 分析。", { party: "VENDOR", fbaScope: "OUT_OF_FBA_SCOPE", roles: ["Vendor Analytics"] }],
    ["GET_VENDOR_TRAFFIC_REPORT", "Vendor 流量", "Vendor Central 流量分析。", { party: "VENDOR", fbaScope: "OUT_OF_FBA_SCOPE", roles: ["Vendor Analytics"] }],
    ["GET_VENDOR_FORECASTING_REPORT", "Vendor 需求預測", "Vendor Central 需求預測。", { party: "VENDOR", fbaScope: "OUT_OF_FBA_SCOPE", roles: ["Vendor Analytics"] }],
    ["GET_VENDOR_INVENTORY_REPORT", "Vendor 庫存", "Vendor Central 庫存分析。", { party: "VENDOR", fbaScope: "OUT_OF_FBA_SCOPE", roles: ["Vendor Analytics"] }],
  ],
);

const B2B = entries(
  {
    categories: ["B2B_OPPORTUNITIES"],
    party: "SELLER",
    fbaScope: "MIXED_FILTER_REQUIRED",
    lifecycle: "REQUEST",
    output: "JSON",
    roles: ["Product Listing"],
    marketplaceAvailability: "US, ES, UK, FR, DE, IT, IN and JP.",
    supportedConfiguredMarketplaces: ["ATVPDKIKX0DER", "A1VC38T7YXB528", "A1F83G8C2ARO7P", "A1PA6795UKMFR9"],
  },
  [
    ["GET_B2B_PRODUCT_OPPORTUNITIES_RECOMMENDED_FOR_YOU", "B2B 推薦機會", "Amazon Business 依目錄與需求提供的商品機會。"],
    ["GET_B2B_PRODUCT_OPPORTUNITIES_NOT_YET_ON_AMAZON", "B2B 未上架機會", "Amazon Business 上尚未供應的商品機會。"],
  ],
);

const BROWSE_TREE = entries(
  {
    categories: ["BROWSE_TREE"],
    party: "SELLER",
    fbaScope: "OUT_OF_FBA_SCOPE",
    lifecycle: "REQUEST",
    output: "XML",
    roles: ["Product Listing"],
  },
  [["GET_XML_BROWSE_TREE_DATA", "分類瀏覽樹", "Amazon 分類瀏覽樹 XML；是目錄參考資料，不是 FBA SKU 資料。"]],
);

const EASY_SHIP = entries(
  {
    categories: ["EASY_SHIP"],
    party: "SELLER",
    fbaScope: "OUT_OF_FBA_SCOPE",
    lifecycle: "REQUEST_OR_SCHEDULE",
    output: "TAB_DELIMITED",
    restrictedData: "RDT_REQUIRED",
    roles: ["Direct to Consumer Shipping (Restricted)"],
    marketplaceAvailability: "Easy Ship stores only; not a universal marketplace report.",
    supportedConfiguredMarketplaces: [],
  },
  [
    ["GET_EASYSHIP_DOCUMENTS", "Easy Ship 文件", "Easy Ship 自配送文件；非 FBA。"],
    ["GET_EASYSHIP_PICKEDUP", "Easy Ship 已取件", "Easy Ship 已取件訂單；非 FBA。"],
    ["GET_EASYSHIP_WAITING_FOR_PICKUP", "Easy Ship 待取件", "Easy Ship 待取件訂單；非 FBA。"],
  ],
);

const FBA = entries(
  {
    categories: ["FBA"],
    party: "SELLER",
    fbaScope: "FBA_ONLY",
    lifecycle: "REQUEST",
    output: "TAB_DELIMITED",
    roles: ["Amazon Fulfillment", "Inventory and Order Tracking"],
    marketplaceAvailability: "FBA sellers; individual reports can have regional limits documented by Amazon.",
  },
  [
    ["GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL", "FBA Amazon 配送出貨", "FBA 出貨、商品、價格與追蹤明細；單次最多一個月。"],
    ["GET_AMAZON_FULFILLED_SHIPMENTS_DATA_INVOICING", "FBA 出貨（發票）", "用於發票的 FBA 出貨明細，含受限客戶資料。", { restrictedData: "RDT_REQUIRED", roles: ["Tax Invoicing (Restricted)"] }],
    ["GET_AMAZON_FULFILLED_SHIPMENTS_DATA_TAX", "FBA 出貨（稅務）", "用於稅務申報的 FBA 出貨明細，含受限資料。", { restrictedData: "RDT_REQUIRED", roles: ["Tax Remittance (Restricted)"] }],
    ["GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA", "FBA 客戶出貨銷售", "FBA 客戶出貨銷售明細。"],
    ["GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_PROMOTION_DATA", "FBA 客戶出貨促銷", "FBA 出貨所套用的促銷明細。"],
    ["GET_FBA_FULFILLMENT_CUSTOMER_TAXES_DATA", "FBA 客戶稅務", "FBA 客戶訂單稅額明細。", { restrictedData: "RDT_REQUIRED", roles: ["Tax Remittance (Restricted)"] }],
    ["GET_REMOTE_FULFILLMENT_ELIGIBILITY", "遠端配送資格", "遠端配送計畫的 ASIN 資格。", { marketplaceAvailability: "Remote Fulfillment participating NA stores.", supportedConfiguredMarketplaces: ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"] }],
    ["GET_AFN_INVENTORY_DATA", "AFN 庫存", "Amazon 配送網路的即時庫存摘要。"],
    ["GET_AFN_INVENTORY_DATA_BY_COUNTRY", "AFN 各國庫存", "依國家分解的 Amazon 配送庫存。", { marketplaceAvailability: "Pan-European FBA participating stores.", supportedConfiguredMarketplaces: ["A1F83G8C2ARO7P", "A1PA6795UKMFR9"] }],
    ["GET_LEDGER_SUMMARY_VIEW_DATA", "FBA 庫存帳簿摘要", "FBA 庫存帳簿期初、變動與期末摘要。"],
    ["GET_LEDGER_DETAIL_VIEW_DATA", "FBA 庫存帳簿明細", "FBA 庫存所有變動事件。"],
    ["GET_RESERVED_INVENTORY_DATA", "FBA 預留庫存", "已預留但尚未可售的 FBA 庫存原因與數量。"],
    ["GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA", "FBA 可售庫存", "未被抑制的 FBA 庫存狀態。"],
    ["GET_FBA_MYI_ALL_INVENTORY_DATA", "FBA 全部庫存", "包含被抑制商品在內的 FBA 庫存。"],
    ["GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT", "FBA 補貨建議", "Amazon 的 FBA 補貨與供應天數建議。"],
    ["GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA", "FBA 入庫不合規", "FBA 入庫安全與準備不合規事件。"],
    ["GET_STRANDED_INVENTORY_UI_DATA", "FBA 無在售資訊庫存", "無有效在售資訊的 FBA 庫存與原因。"],
    ["GET_STRANDED_INVENTORY_LOADER_DATA", "FBA 無在售資訊修復檔", "可用於修復 stranded inventory 的檔案。"],
    ["GET_FBA_STORAGE_FEE_CHARGES_DATA", "FBA 每月倉儲費", "預估每月 FBA 庫存倉儲費。", { lifecycle: "REQUEST_OR_SCHEDULE" }],
    ["GET_FBA_INVENTORY_PLANNING_DATA", "FBA 庫存規劃", "庫齡、補貨、超額與行動建議的 FBA 規劃報表。"],
    ["GET_FBA_OVERAGE_FEE_CHARGES_DATA", "FBA 庫容超額費", "超過庫容限制的預估費用。"],
    ["GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA", "FBA 費用預估", "依 SKU 預估 FBA 配送與銷售費用；每日請求次數有限。"],
    ["GET_FBA_REIMBURSEMENTS_DATA", "FBA 賠償", "FBA 庫存賠償原因、數量與金額。"],
    ["GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA", "FBA 庫齡附加費", "指定月份的 FBA 庫齡附加費明細。"],
    ["GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA", "FBA 客戶退貨", "FBA 客戶退貨原因、狀態與處理結果。"],
    ["GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_REPLACEMENT_DATA", "FBA 替換件", "FBA 客戶替換出貨明細。"],
    ["GET_FBA_RECOMMENDED_REMOVAL_DATA", "FBA 建議移除", "Amazon 建議移除的 FBA 庫存。"],
    ["GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA", "FBA 移除訂單", "FBA 移除訂單與單位處理明細。"],
    ["GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA", "FBA 移除出貨", "FBA 移除訂單的出貨與追蹤明細。"],
  ],
);

const ALL_ORDERS = entries(
  {
    categories: ["FBA", "ORDER"],
    party: "SELLER",
    fbaScope: "MIXED_FILTER_REQUIRED",
    lifecycle: "REQUEST",
    roles: ["Inventory and Order Tracking", "Direct to Consumer Shipping (Restricted)"],
    restrictedData: "RDT_REQUIRED",
  },
  [
    ["GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL", "全訂單（依更新）", "所有履約通道的訂單明細；必須逐列過濾 AFN，且受 RDT 管制。"],
    ["GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL", "全訂單（依訂單日）", "所有履約通道的訂單明細；必須逐列過濾 AFN，且受 RDT 管制。"],
    ["GET_XML_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL", "全訂單 XML（依更新）", "全履約通道 XML 訂單；需 FBA 過濾與 RDT。", { output: "XML" }],
    ["GET_XML_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL", "全訂單 XML（依訂單日）", "全履約通道 XML 訂單；需 FBA 過濾與 RDT。", { output: "XML" }],
  ],
);

const INVENTORY = entries(
  {
    categories: ["INVENTORY"],
    party: "SELLER",
    fbaScope: "MIXED_FILTER_REQUIRED",
    lifecycle: "REQUEST",
    output: "TAB_DELIMITED",
    roles: ["Inventory and Order Tracking", "Pricing", "Product Listing"],
  },
  [
    ["GET_FLAT_FILE_OPEN_LISTINGS_DATA", "開啟中的在售資訊", "開啟中在售資訊的 SKU、價格與數量；需依 fulfillment-channel 過濾 FBA。"],
    ["GET_MERCHANT_LISTINGS_ALL_DATA", "全部在售資訊", "詳細商品在售資訊；單次僅可一個站點，需依 fulfillment-channel 過濾 FBA。"],
    ["GET_MERCHANT_LISTINGS_DATA", "作用中在售資訊", "作用中在售資訊；需依 fulfillment-channel 過濾 FBA。"],
    ["GET_MERCHANT_LISTINGS_INACTIVE_DATA", "非作用中在售資訊", "非作用中在售資訊；包含多種履約通道。"],
    ["GET_MERCHANT_LISTINGS_DATA_BACK_COMPAT", "在售資訊（舊相容）", "舊格式在售資訊；需 FBA 過濾。", { deprecated: true }],
    ["GET_MERCHANT_LISTINGS_DATA_LITE", "在售資訊 Lite", "簡化的商品在售資訊；需 FBA 過濾。"],
    ["GET_MERCHANT_LISTINGS_DATA_LITER", "在售資訊 Liter", "更簡化的商品在售資訊；需 FBA 過濾。"],
    ["GET_MERCHANT_CANCELLED_LISTINGS_DATA", "已取消在售資訊", "已取消的商品在售資訊；不是目前 FBA 庫存。"],
    ["GET_MERCHANTS_LISTINGS_FYP_REPORT", "在售資訊改善建議", "Fix Your Products 在售資訊問題與改善建議。"],
    ["GET_PAN_EU_OFFER_STATUS", "Pan-EU FBA Offer 狀態", "Pan-European FBA offer 狀態。", { fbaScope: "FBA_ONLY", marketplaceAvailability: "Pan-European FBA stores.", supportedConfiguredMarketplaces: ["A1F83G8C2ARO7P", "A1PA6795UKMFR9"] }],
    ["GET_MFN_PANEU_OFFER_STATUS", "MFN Pan-EU Offer 狀態", "賣家自配送的 Pan-EU offer；非 FBA。", { fbaScope: "OUT_OF_FBA_SCOPE", marketplaceAvailability: "Pan-European stores.", supportedConfiguredMarketplaces: ["A1F83G8C2ARO7P", "A1PA6795UKMFR9"] }],
    ["GET_REFERRAL_FEE_PREVIEW_REPORT", "銷售佣金預覽", "依商品預估銷售佣金；不是 FBA 專屬費用。", { roles: ["Pricing"] }],
  ],
);

const INVOICE_DATA = entries(
  {
    categories: ["INVOICE_DATA"],
    party: "SELLER",
    fbaScope: "MIXED_FILTER_REQUIRED",
    lifecycle: "REQUEST",
    restrictedData: "RDT_REQUIRED",
    roles: ["Tax Invoicing (Restricted)"],
    prerequisites: ["VAT Calculation Service 或 Amazon 指定的稅務發票資格"],
    marketplaceAvailability: "VAT invoice participating stores, primarily Europe.",
    supportedConfiguredMarketplaces: ["A1F83G8C2ARO7P", "A1PA6795UKMFR9"],
  },
  [
    ["GET_FLAT_FILE_VAT_INVOICE_DATA_REPORT", "VAT 發票資料", "VAT 發票明細，可同時包含 FBA 與非 FBA 訂單。"],
    ["GET_XML_VAT_INVOICE_DATA_REPORT", "VAT 發票資料 XML", "VAT 發票 XML，可同時包含 FBA 與非 FBA 訂單。", { output: "XML" }],
  ],
);

const ORDER = entries(
  {
    categories: ["ORDER"],
    party: "SELLER",
    fbaScope: "OUT_OF_FBA_SCOPE",
    lifecycle: "REQUEST_OR_SCHEDULE",
    output: "TAB_DELIMITED",
    restrictedData: "RDT_REQUIRED",
    roles: ["Direct to Consumer Shipping (Restricted)", "Inventory and Order Tracking"],
  },
  [
    ["GET_FLAT_FILE_ACTIONABLE_ORDER_DATA_SHIPPING", "可操作配送訂單", "需由賣家出貨的可操作訂單；屬 MFN，非 FBA。"],
    ["GET_ORDER_REPORT_DATA_INVOICING", "訂單發票 XML", "發票用訂單資料；非 FBA-only，含受限資料。", { output: "XML" }],
    ["GET_ORDER_REPORT_DATA_TAX", "訂單稅務 XML", "稅務用訂單資料；非 FBA-only，含受限資料。", { output: "XML" }],
    ["GET_ORDER_REPORT_DATA_SHIPPING", "訂單配送 XML", "配送用訂單資料；主要用於賣家履約。", { output: "XML" }],
    ["GET_FLAT_FILE_ORDER_REPORT_DATA_INVOICING", "訂單發票", "發票用訂單明細；非 FBA-only，含受限資料。"],
    ["GET_FLAT_FILE_ORDER_REPORT_DATA_SHIPPING", "訂單配送", "配送用訂單明細；主要用於賣家履約。"],
    ["GET_FLAT_FILE_ORDER_REPORT_DATA_TAX", "訂單稅務", "稅務用訂單明細；非 FBA-only，含受限資料。"],
    ["GET_FLAT_FILE_ARCHIVED_ORDERS_DATA_BY_ORDER_DATE", "封存訂單", "封存的訂單資料；非 FBA-only，需 RDT。"],
    ["GET_FLAT_FILE_PENDING_ORDERS_DATA", "待處理訂單", "尚未完成的訂單；沒有可靠 FBA 履約證明時不得匯出。"],
    ["GET_PENDING_ORDERS_DATA", "待處理訂單 XML", "尚未完成的 XML 訂單；無 FBA 證明時不得匯出。", { output: "XML" }],
    ["GET_CONVERGED_FLAT_FILE_PENDING_ORDERS_DATA", "整合待處理訂單", "整合的待處理訂單；無 FBA 證明時不得匯出。"],
  ],
);

const PAYMENT = entries(
  {
    categories: ["PAYMENT"],
    party: "SELLER",
    fbaScope: "MIXED_FILTER_REQUIRED",
    lifecycle: "MANUAL_THEN_LIST",
    output: "TAB_DELIMITED",
    roles: ["Finance and Accounting"],
    prerequisites: ["先在 Amazon 官方 Payments Reports Repository 產生文件"],
  },
  [["GET_DATE_RANGE_FINANCIAL_HOLDS_DATA", "日期區間財務保留款", "必須先由使用者在 Amazon 官方介面請求，Reports API 僅能列出與下載已產生文件。"]],
);

const PERFORMANCE = entries(
  {
    categories: ["PERFORMANCE"],
    party: "SELLER",
    fbaScope: "OUT_OF_FBA_SCOPE",
    lifecycle: "REQUEST_OR_SCHEDULE",
    output: "TAB_DELIMITED",
    roles: ["Selling Partner Insights"],
  },
  [
    ["GET_SELLER_FEEDBACK_DATA", "賣家回饋", "1–3 星賣家服務回饋；不是商品 review，不可用來做商品評論健檢。"],
    ["GET_V1_SELLER_PERFORMANCE_REPORT", "賣家績效 v1", "舊版賣家帳戶績效報表。", { deprecated: true }],
    ["GET_V2_SELLER_PERFORMANCE_REPORT", "賣家績效 v2", "賣家帳戶健康與績效指標。"],
    ["GET_PROMOTION_PERFORMANCE_REPORT", "促銷績效", "Amazon 公開報表中的促銷績效；不是 Seller Central 私有促銷介面。", { party: "BOTH", fbaScope: "MIXED_FILTER_REQUIRED" }],
    ["GET_COUPON_PERFORMANCE_REPORT", "Coupon 績效", "Amazon 公開報表中的 Coupon 績效；不代表公開 API 可建立 Coupon。", { party: "BOTH", fbaScope: "MIXED_FILTER_REQUIRED" }],
  ],
);

const REGULATORY = entries(
  {
    categories: ["REGULATORY"],
    party: "SELLER",
    fbaScope: "OUT_OF_FBA_SCOPE",
    lifecycle: "REQUEST",
    output: "MIXED",
  },
  [
    ["END_USER_DATA_REPORT", "終端使用者資料", "包含顧客聯絡、頁面流量與訂單個資；本 FBA-only 工具不讀取。", { lifecycle: "REQUEST_OR_SCHEDULE", restrictedData: "RDT_REQUIRED", roles: ["Buyer Communication"], marketplaceAvailability: "IE, ES, FR, BE, NL, DE, IT, SE and PL.", supportedConfiguredMarketplaces: ["A1PA6795UKMFR9"] }],
    ["FBA_BULK_INVOICE", "FBA 批次發票", "以日期、訂單或出貨篩選的 FBA 發票檔；需稅務限制角色與 RDT。", { fbaScope: "FBA_ONLY", output: "PDF_OR_ZIP", restrictedData: "RDT_REQUIRED", roles: ["Tax Invoicing (Restricted)"] }],
    ["MARKETPLACE_ASIN_PAGE_VIEW_METRICS", "ASIN 頁面瀏覽指標", "特定歐洲站點的 ASIN 頁面流量；無 FBA 履約區分。", { lifecycle: "REQUEST_OR_SCHEDULE", output: "JSON", roles: ["Selling Partner Insights"], marketplaceAvailability: "DE, FR, IT, ES, NL, PL, SE, BE, UK and IE.", supportedConfiguredMarketplaces: EU_REGULATORY }],
    ["GET_EPR_MONTHLY_REPORTS", "EPR 月報", "生產者延伸責任月報；取決於國家與法規資格。", { roles: ["Tax Remittance"] }],
    ["GET_EPR_QUARTERLY_REPORTS", "EPR 季報", "生產者延伸責任季報；取決於國家與法規資格。", { roles: ["Tax Remittance"] }],
    ["GET_EPR_ANNUAL_REPORTS", "EPR 年報", "生產者延伸責任年報；取決於國家與法規資格。", { roles: ["Tax Remittance"] }],
  ],
);

const RETURNS = entries(
  {
    categories: ["RETURNS"],
    party: "SELLER",
    fbaScope: "OUT_OF_FBA_SCOPE",
    lifecycle: "REQUEST_OR_SCHEDULE",
    output: "MIXED",
    restrictedData: "RDT_REQUIRED",
    roles: ["Direct to Consumer Shipping (Restricted)"],
  },
  [
    ["GET_XML_RETURNS_DATA_BY_RETURN_DATE", "賣家退貨 XML", "賣家自配送退貨；FBA 退貨請用專用 FBA report type。", { output: "XML" }],
    ["GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE", "賣家退貨", "賣家自配送退貨；FBA 退貨請用專用 FBA report type。", { output: "TAB_DELIMITED" }],
    ["GET_XML_MFN_PRIME_RETURNS_REPORT", "Seller Fulfilled Prime 退貨 XML", "MFN Prime 退貨；非 FBA。", { output: "XML" }],
    ["GET_CSV_MFN_PRIME_RETURNS_REPORT", "Seller Fulfilled Prime 退貨 CSV", "MFN Prime 退貨；非 FBA。", { output: "CSV" }],
    ["GET_XML_MFN_SKU_RETURN_ATTRIBUTES_REPORT", "MFN SKU 退貨屬性 XML", "MFN 退貨屬性；非 FBA。", { output: "XML" }],
    ["GET_FLAT_FILE_MFN_SKU_RETURN_ATTRIBUTES_REPORT", "MFN SKU 退貨屬性", "MFN 退貨屬性；非 FBA。", { output: "TAB_DELIMITED" }],
  ],
);

const SETTLEMENT = entries(
  {
    categories: ["SETTLEMENT"],
    party: "SELLER",
    fbaScope: "MIXED_FILTER_REQUIRED",
    lifecycle: "AUTOMATIC_ONLY",
    roles: ["Finance and Accounting"],
    marketplaceAvailability: "Seller accounts where Amazon generates settlement reports.",
  },
  [
    ["GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE", "結算報表（舊平面檔）", "Amazon 自動產生的舊平面檔結算；無法透過 createReport 強制建立。", { output: "TAB_DELIMITED", deprecated: true }],
    ["GET_V2_SETTLEMENT_REPORT_DATA_XML", "結算報表 XML（舊）", "Amazon 自動產生的舊 XML 結算；無法透過 createReport 強制建立。", { output: "XML", deprecated: true }],
    ["GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", "結算報表 v2", "Amazon 自動產生的現行結算明細；可含 FBA 與非 FBA 資料。", { output: "TAB_DELIMITED" }],
  ],
);

const TAX = entries(
  {
    categories: ["TAX"],
    party: "SELLER",
    fbaScope: "MIXED_FILTER_REQUIRED",
    lifecycle: "REQUEST",
    output: "TAB_DELIMITED",
    restrictedData: "RDT_REQUIRED",
    roles: ["Tax Remittance (Restricted)"],
    marketplaceAvailability: "Report-specific country and tax-program availability.",
    supportedConfiguredMarketplaces: null,
  },
  [
    ["GST_MTR_STOCK_TRANSFER_REPORT", "印度 GST 庫存調撥", "印度 GST 庫存調撥稅務報表。", { supportedConfiguredMarketplaces: [] }],
    ["GST_MTR_B2B", "印度 GST B2B", "印度 GST B2B 交易稅務報表。", { supportedConfiguredMarketplaces: [] }],
    ["GST_MTR_B2C", "印度 GST B2C", "印度 GST B2C 交易稅務報表。", { supportedConfiguredMarketplaces: [] }],
    ["GET_FLAT_FILE_SALES_TAX_DATA", "美國銷售稅", "美國銷售稅報表；Amazon 官方文件要求先在 Seller Central 產生，之後才能以 Reports API 列出。", { lifecycle: "MANUAL_THEN_LIST", supportedConfiguredMarketplaces: ["ATVPDKIKX0DER"], prerequisites: ["先在 Amazon 官方稅務報表介面產生文件"] }],
    ["SC_VAT_TAX_REPORT", "Seller Central VAT 交易", "歐洲 VAT 交易稅務報表。", { supportedConfiguredMarketplaces: ["A1F83G8C2ARO7P", "A1PA6795UKMFR9"] }],
    ["GET_VAT_TRANSACTION_DATA", "VAT 交易明細", "VAT 交易明細；可包含多種履約通道。", { supportedConfiguredMarketplaces: ["A1F83G8C2ARO7P", "A1PA6795UKMFR9"] }],
    ["GET_GST_MTR_B2B_CUSTOM", "自訂 GST B2B", "印度自訂 GST B2B 稅務報表。", { supportedConfiguredMarketplaces: [] }],
    ["GET_GST_MTR_B2C_CUSTOM", "自訂 GST B2C", "印度自訂 GST B2C 稅務報表。", { supportedConfiguredMarketplaces: [] }],
    ["GET_GST_STR_ADHOC", "GST 臨時報表", "印度 GST 臨時稅務報表。", { supportedConfiguredMarketplaces: [] }],
  ],
);

export const PUBLIC_REPORT_CATALOG: readonly ReportCatalogEntry[] = Object.freeze([
  ...AMAZON_BUSINESS,
  ...ANALYTICS,
  ...B2B,
  ...BROWSE_TREE,
  ...EASY_SHIP,
  ...FBA,
  ...ALL_ORDERS,
  ...INVENTORY,
  ...INVOICE_DATA,
  ...ORDER,
  ...PAYMENT,
  ...PERFORMANCE,
  ...REGULATORY,
  ...RETURNS,
  ...SETTLEMENT,
  ...TAX,
]);

const REPORTS_BY_TYPE = new Map(
  PUBLIC_REPORT_CATALOG.map((report) => [report.reportType, report]),
);
if (REPORTS_BY_TYPE.size !== PUBLIC_REPORT_CATALOG.length) {
  throw new TypeError("Public report catalog contains a duplicate reportType.");
}

export const REPORT_LIBRARY_UNAVAILABLE_DOCUMENTS = Object.freeze([
  {
    id: "PRODUCT_REVIEW_TEXT",
    label: "全部商品評論全文",
    reason: "Customer Feedback API 僅提供指定 ASIN 的評論主題與趨勢，不提供完整 review 清單或全文。",
    officialSource: "https://developer-docs.amazon.com/sp-api/docs/get-feedback-insights-asin",
  },
  {
    id: "GENERIC_MARKETPLACE_INVOICES",
    label: "一般站點 Amazon 發票檔",
    reason: "公開 Invoices API 不提供本 App 所有站點的通用帳戶發票下載。",
    officialSource: "https://developer-docs.amazon.com/sp-api/docs/invoices-api",
  },
  {
    id: "SELLER_CENTRAL_BILLS",
    label: "Seller Central 帳單檔",
    reason: "Amazon 沒有發佈通用帳單檔的 SP-API operation；本 App 不使用私有 Seller Central 接口。",
    officialSource: "https://developer-docs.amazon.com/sp-api/docs/sp-api-models",
  },
  {
    id: "ADS_REPORTS",
    label: "Amazon Ads 廣告報表",
    reason: "廣告報表屬另一套 Amazon Ads API，不是 Selling Partner Reports API；未完成獨立授權前不可假裝可下載。",
    officialSource: "https://advertising.amazon.com/API/docs/en-us/guides/reporting/overview",
  },
  {
    id: "COUPON_CREATE_DOCUMENT",
    label: "Coupon 建立文件",
    reason: "Reports API 可能提供 Coupon 績效報表，但不等於有公開 SP-API 可建立 Coupon。",
    officialSource: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-performance",
  },
]);

export const CURRENT_APP_EXPORTS = Object.freeze([
  {
    id: "CONTENT_AUDIT_XLSX",
    label: "FBA 全站文案健檢 Excel",
    source: "GET_MERCHANT_LISTINGS_ALL_DATA + Listings Items API + 作業系統本機拼字檢查",
    scope: "只匯出報表可證明的 FBA SKU；疑似錯字、賣點與成分問題。",
    availability: "AVAILABLE_AFTER_AUDIT",
  },
  {
    id: "IMAGE_AUDIT_XLSX",
    label: "FBA 圖片健檢 Excel",
    source: "GET_MERCHANT_LISTINGS_ALL_DATA + Listings Items API images",
    scope: "只匯出已證明 FBA SKU 的圖片數與缺圖狀態。",
    availability: "AVAILABLE_AFTER_AUDIT",
  },
  {
    id: "AGED_INVENTORY_XLSX",
    label: "FBA 庫齡／超額庫存（含 AIS 可用性）Excel",
    source: "GET_FBA_INVENTORY_PLANNING_DATA / regional FBA inventory report",
    scope: "庫齡、建議移除、倉儲與附加費可用性；缺列不補零。",
    availability: "AVAILABLE_AFTER_AUDIT",
  },
  {
    id: "SUBSCRIPTION_AUDIT_XLSX",
    label: "FBA Subscribe & Save 健檢 Excel",
    source: "FBA Inventory API + Replenishment API",
    scope: "已證明 FBA SKU 的折扣、有效訂閱與可證明月度指標。",
    availability: "AVAILABLE_AFTER_AUDIT",
  },
  {
    id: "UNBOUND_VARIATION_AUDIT_XLSX",
    label: "FBA 未綁變體健檢 Excel",
    source: "GET_MERCHANT_LISTINGS_ALL_DATA + Listings Items relationships",
    scope: "relationships 完整且可證明為 FBA 才判定；缺證據另列未完成。",
    availability: "AVAILABLE_AFTER_AUDIT",
  },
  {
    id: "REVIEW_TOPIC_AUDIT_XLSX",
    label: "FBA 非 parent ASIN 評論主題健檢 Excel",
    source: "GET_MERCHANT_LISTINGS_ALL_DATA + Listings Items relationships + Customer Feedback API getItemReviewTopics",
    scope: "只查詢 relationships 已證明為 child 或 standalone 的 FBA ASIN；parent 與關係未完成列不查詢。僅英文主題、評論短句與評論主題影響值；負數是負向主題對星等下降方向的影響值，不是商品負星等，也不會轉成 0 或絕對值。不含完整 review 全文、商品總星等或總評論數。",
    availability: "AVAILABLE_AFTER_SUCCESSFUL_AUDIT",
  },
] as const);

export function reportCatalogEntry(reportType: string): ReportCatalogEntry {
  const found = REPORTS_BY_TYPE.get(reportType);
  if (!found) throw new TypeError("Report type is not in the public allowlist.");
  return found;
}

export function isReportLibraryMarketplaceId(
  value: string,
): value is ReportLibraryMarketplaceId {
  return Object.prototype.hasOwnProperty.call(REPORT_LIBRARY_MARKETPLACES, value);
}

function stateFor(report: ReportCatalogEntry, marketplaceId: ReportLibraryMarketplaceId): ReportAccessState {
  if (report.deprecated) return "DEPRECATED";
  if (report.party === "VENDOR") return "VENDOR_ONLY";
  if (
    report.supportedConfiguredMarketplaces !== null &&
    !report.supportedConfiguredMarketplaces.includes(marketplaceId)
  ) return "MARKETPLACE_UNAVAILABLE";
  if (report.fbaScope === "OUT_OF_FBA_SCOPE") return "OUT_OF_FBA_SCOPE";
  if (report.restrictedData === "RDT_REQUIRED") return "RDT_REQUIRED";
  if (report.lifecycle === "MANUAL_THEN_LIST") return "MANUAL_PREREQUISITE";
  if (report.lifecycle === "AUTOMATIC_ONLY") return "AMAZON_GENERATED_ONLY";
  if (report.prerequisites.length > 0) return "EXTRA_ROLE_REQUIRED";
  if (report.fbaScope === "MIXED_FILTER_REQUIRED") return "FBA_FILTER_REQUIRED";
  return "READY_TO_PLAN";
}

export function buildReportAccessPlan(input: {
  reportType: string;
  marketplaceId: string;
}): ReportAccessPlan {
  if (!isReportLibraryMarketplaceId(input.marketplaceId)) {
    throw new TypeError("Unsupported marketplace for the report library.");
  }
  const report = reportCatalogEntry(input.reportType);
  const state = stateFor(report, input.marketplaceId);
  const base = {
    reportType: report.reportType,
    marketplaceId: input.marketplaceId,
    state,
  };
  switch (state) {
    case "READY_TO_PLAN":
      return {
        ...base,
        amazonPublicArtifactAvailable: true,
        appDownloadImplemented: false,
        notice: "Amazon 公開 Reports API 有此 FBA-only reportType；本 App 目前只完成安全規劃，尚未接線建立、輪詢或下載。",
        nextStep: "待後續版本為這個 allowlisted reportType 實作專用 parser、FBA 驗證與匯出測試後，才能開啟下載。",
      };
    case "FBA_FILTER_REQUIRED":
      return {
        ...base,
        amazonPublicArtifactAvailable: true,
        appDownloadImplemented: false,
        notice: "報表可能包含非 FBA 資料，未建立逐列 AFN 證明過濾前不得下載給 renderer。",
        nextStep: "先在 main process 實作 fail-closed FBA 過濾與完整度統計。",
      };
    case "EXTRA_ROLE_REQUIRED":
      return { ...base, amazonPublicArtifactAvailable: true, appDownloadImplemented: false, notice: `還需額外資格：${report.prerequisites.join("、")}。即使帳戶已有資格，本 App 仍尚未接線這個下載。`, nextStep: "完成官方角色／計畫授權，並實作專用 parser 與 FBA 驗證後再評估。" };
    case "RDT_REQUIRED":
      return { ...base, amazonPublicArtifactAvailable: true, appDownloadImplemented: false, notice: `此報表含受限資料，需額外安全審查與 Restricted Data Token${report.lifecycle === "MANUAL_THEN_LIST" ? "，而且 Amazon 要求先在官方介面產生文件" : ""}。`, nextStep: "本版本不請求、不儲存、不匯出 RDT 資料。" };
    case "MANUAL_PREREQUISITE":
      return { ...base, amazonPublicArtifactAvailable: true, appDownloadImplemented: false, notice: "Amazon 要求先由使用者在官方介面產生文件。", nextStep: "公開 Reports API 之後只能找回已產生文件；本 App 尚未接線，也不使用 Seller Central 私有接口。" };
    case "AMAZON_GENERATED_ONLY":
      return { ...base, amazonPublicArtifactAvailable: true, appDownloadImplemented: false, notice: "此文件由 Amazon 自動產生，不能假裝可以 createReport 即時建立。", nextStep: "本 App 尚未接線；須先完成逐列 FBA 過濾，才能考慮列出可用文件。" };
    case "MARKETPLACE_UNAVAILABLE":
      return { ...base, amazonPublicArtifactAvailable: true, appDownloadImplemented: false, notice: `官方站點限制：${report.marketplaceAvailability}`, nextStep: null };
    case "VENDOR_ONLY":
      return { ...base, amazonPublicArtifactAvailable: true, appDownloadImplemented: false, notice: "此報表屬 Vendor Central，不是 Seller Central FBA 能力。", nextStep: null };
    case "OUT_OF_FBA_SCOPE":
      return { ...base, amazonPublicArtifactAvailable: true, appDownloadImplemented: false, notice: "此 reportType 是公開 API 能力，但無法產生可證明的 FBA-only 文件。", nextStep: null };
    case "DEPRECATED":
      return { ...base, amazonPublicArtifactAvailable: true, appDownloadImplemented: false, notice: "Amazon 已將此格式列為舊版；不新增整合。", nextStep: "請使用現行替代 report type。" };
  }
}

export const CUSTOMER_FEEDBACK_SUPPORTED_CONFIGURED_MARKETPLACES = Object.freeze(
  CUSTOMER_FEEDBACK_STORES,
);

export const REPORT_LIBRARY_NOTICE =
  "清單來自 Amazon 公開 Reports API report-type 文件；顯示可下載不代表已呼叫 Amazon。本 App 維持 FBA-only，不使用 Seller Central 私有接口，不讀取 RDT/PII 報表。";
