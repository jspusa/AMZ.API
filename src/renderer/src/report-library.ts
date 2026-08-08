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

export type CurrentAppExportView = {
  id: string;
  label: string;
  source: string;
  scope: string;
  availability: "AVAILABLE_AFTER_AUDIT" | "AVAILABLE_AFTER_SUCCESSFUL_AUDIT";
};

export type ReportCatalogView = {
  reportType: string;
  label: string;
  description: string;
  categories: string[];
  party: "SELLER" | "VENDOR" | "BOTH";
  fbaScope: "FBA_ONLY" | "MIXED_FILTER_REQUIRED" | "OUT_OF_FBA_SCOPE";
  lifecycle: "REQUEST" | "REQUEST_OR_SCHEDULE" | "AUTOMATIC_ONLY" | "MANUAL_THEN_LIST";
  output: "TAB_DELIMITED" | "CSV" | "XML" | "JSON" | "PDF_OR_ZIP" | "MIXED";
  restrictedData: "NONE" | "RDT_REQUIRED";
  roles: string[];
  marketplaceAvailability: string;
  prerequisites: string[];
  deprecated: boolean;
  officialSource: string;
  state: ReportAccessState;
  amazonPublicArtifactAvailable: true;
  appDownloadImplemented: false;
  stateNotice: string;
};

export type ReportLibrarySnapshot = {
  schemaVersion: 1;
  marketplaceId: string;
  fetchedAt: string;
  officialCatalog: {
    uniqueReportTypeCount: number;
    verifiedAt: string;
    officialPageUpdatedLabel: string;
    source: string;
    changeNotice: string;
  };
  currentAppExports: CurrentAppExportView[];
  reports: ReportCatalogView[];
  unavailableDocuments: Array<{
    id: string;
    label: string;
    reason: string;
    officialSource: string;
  }>;
  reviewAuditCapability: {
    supportedForMarketplace: boolean;
    roles: string[];
    updateCadence: "WEEKLY";
    topicLanguage: "ENGLISH_ONLY";
    nonParentFbaAsinsOnly: true;
    relationshipsEvidenceRequired: true;
    parentContainersExcluded: true;
    fullReviewTextAvailable: false;
    averageProductRatingAvailable: false;
    totalReviewCountAvailable: false;
  };
  notice: string;
};

export type ReportAccessPlanView = {
  reportType: string;
  marketplaceId: string;
  state: ReportAccessState;
  amazonPublicArtifactAvailable: true;
  appDownloadImplemented: false;
  notice: string;
  nextStep: string | null;
};

const STATES = new Set<ReportAccessState>([
  "READY_TO_PLAN", "FBA_FILTER_REQUIRED", "EXTRA_ROLE_REQUIRED", "RDT_REQUIRED",
  "MANUAL_PREREQUISITE", "AMAZON_GENERATED_ONLY", "MARKETPLACE_UNAVAILABLE",
  "VENDOR_ONLY", "OUT_OF_FBA_SCOPE", "DEPRECATED",
]);
const PARTIES = new Set(["SELLER", "VENDOR", "BOTH"]);
const FBA_SCOPES = new Set(["FBA_ONLY", "MIXED_FILTER_REQUIRED", "OUT_OF_FBA_SCOPE"]);
const LIFECYCLES = new Set(["REQUEST", "REQUEST_OR_SCHEDULE", "AUTOMATIC_ONLY", "MANUAL_THEN_LIST"]);
const OUTPUTS = new Set(["TAB_DELIMITED", "CSV", "XML", "JSON", "PDF_OR_ZIP", "MIXED"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}格式無效。`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 5_000): string {
  if (
    typeof value !== "string" || !value.trim() || value !== value.trim() ||
    value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new Error(`${label}缺少或無效。`);
  return value;
}

function strings(value: unknown, label: string, maximum = 40): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label}格式無效。`);
  return value.map((item, index) => text(item, `${label}[${index}]`, 500));
}

function officialUrl(value: unknown, label: string): string {
  const source = text(value, label, 2_000);
  let url: URL;
  try { url = new URL(source); } catch { throw new Error(`${label}網址無效。`); }
  if (url.protocol !== "https:" || ![
    "developer-docs.amazon.com",
    "advertising.amazon.com",
  ].includes(url.hostname)) throw new Error(`${label}不是 Amazon 官方文件。`);
  return source;
}

function enumText<T extends string>(value: unknown, values: ReadonlySet<string>, label: string): T {
  if (typeof value !== "string" || !values.has(value)) throw new Error(`${label}不在允許清單。`);
  return value as T;
}

function parseReport(value: unknown, index: number): ReportCatalogView {
  const raw = record(value, `第 ${index + 1} 個 report type`);
  if (raw.appDownloadImplemented !== false || raw.amazonPublicArtifactAvailable !== true) {
    throw new Error("文件庫把 Amazon 公開能力與 App 已接線下載混在一起。");
  }
  return {
    reportType: text(raw.reportType, "reportType", 120),
    label: text(raw.label, "report label", 200),
    description: text(raw.description, "report description"),
    categories: strings(raw.categories, "report categories", 4),
    party: enumText(raw.party, PARTIES, "report party"),
    fbaScope: enumText(raw.fbaScope, FBA_SCOPES, "report FBA scope"),
    lifecycle: enumText(raw.lifecycle, LIFECYCLES, "report lifecycle"),
    output: enumText(raw.output, OUTPUTS, "report output"),
    restrictedData: enumText(raw.restrictedData, new Set(["NONE", "RDT_REQUIRED"]), "report restricted data"),
    roles: strings(raw.roles, "report roles"),
    marketplaceAvailability: text(raw.marketplaceAvailability, "marketplace availability"),
    prerequisites: strings(raw.prerequisites, "report prerequisites"),
    deprecated: raw.deprecated === true,
    officialSource: officialUrl(raw.officialSource, "report official source"),
    state: enumText(raw.state, STATES, "report state"),
    amazonPublicArtifactAvailable: true,
    appDownloadImplemented: false,
    stateNotice: text(raw.stateNotice, "report state notice"),
  };
}

export function parseReportLibrarySnapshot(value: unknown): ReportLibrarySnapshot {
  const raw = record(value, "文件庫回應");
  const official = record(raw.officialCatalog, "官方目錄說明");
  if (!Array.isArray(raw.reports) || !Array.isArray(raw.currentAppExports) || !Array.isArray(raw.unavailableDocuments)) {
    throw new Error("文件庫回應缺少清單。");
  }
  const reports = raw.reports.map(parseReport);
  const uniqueCount = official.uniqueReportTypeCount;
  if (!Number.isSafeInteger(uniqueCount) || uniqueCount !== reports.length) {
    throw new Error("文件庫 report type 總數與清單不一致。");
  }
  if (new Set(reports.map(({ reportType }) => reportType)).size !== reports.length) {
    throw new Error("文件庫有重複 report type。");
  }
  const currentAppExports = raw.currentAppExports.map((value, index) => {
    const item = record(value, `第 ${index + 1} 個 App 匯出`);
    const availability = enumText<CurrentAppExportView["availability"]>(
      item.availability,
      new Set(["AVAILABLE_AFTER_AUDIT", "AVAILABLE_AFTER_SUCCESSFUL_AUDIT"]),
      "App export availability",
    );
    return {
      id: text(item.id, "App export id", 120),
      label: text(item.label, "App export label", 200),
      source: text(item.source, "App export source"),
      scope: text(item.scope, "App export scope"),
      availability,
    };
  });
  const unavailableDocuments = raw.unavailableDocuments.map((value, index) => {
    const item = record(value, `第 ${index + 1} 個不可下載文件`);
    return {
      id: text(item.id, "unavailable id", 120),
      label: text(item.label, "unavailable label", 200),
      reason: text(item.reason, "unavailable reason"),
      officialSource: officialUrl(item.officialSource, "unavailable official source"),
    };
  });
  const review = record(raw.reviewAuditCapability, "評論健檢能力");
  if (
    review.updateCadence !== "WEEKLY" || review.topicLanguage !== "ENGLISH_ONLY" ||
    review.nonParentFbaAsinsOnly !== true ||
    review.relationshipsEvidenceRequired !== true ||
    review.parentContainersExcluded !== true ||
    review.fullReviewTextAvailable !== false || review.averageProductRatingAvailable !== false ||
    review.totalReviewCountAvailable !== false
  ) throw new Error("評論健檢能力邊界無效。");
  const fetchedAt = text(raw.fetchedAt, "文件庫更新時間", 64);
  if (Number.isNaN(new Date(fetchedAt).getTime())) throw new Error("文件庫更新時間無效。");
  return {
    schemaVersion: raw.schemaVersion === 1 ? 1 : (() => { throw new Error("文件庫版本無效。"); })(),
    marketplaceId: text(raw.marketplaceId, "文件庫站點", 32),
    fetchedAt,
    officialCatalog: {
      uniqueReportTypeCount: reports.length,
      verifiedAt: text(official.verifiedAt, "官方目錄驗證日", 32),
      officialPageUpdatedLabel: text(official.officialPageUpdatedLabel, "官方頁面更新說明"),
      source: officialUrl(official.source, "官方 report type 清單"),
      changeNotice: text(official.changeNotice, "官方清單變動說明"),
    },
    currentAppExports,
    reports,
    unavailableDocuments,
    reviewAuditCapability: {
      supportedForMarketplace: review.supportedForMarketplace === true,
      roles: strings(review.roles, "review roles"),
      updateCadence: "WEEKLY",
      topicLanguage: "ENGLISH_ONLY",
      nonParentFbaAsinsOnly: true,
      relationshipsEvidenceRequired: true,
      parentContainersExcluded: true,
      fullReviewTextAvailable: false,
      averageProductRatingAvailable: false,
      totalReviewCountAvailable: false,
    },
    notice: text(raw.notice, "文件庫說明"),
  };
}

export function parseReportAccessPlan(
  value: unknown,
  expectedMarketplaceId: string,
  expectedReportType: string,
): ReportAccessPlanView {
  const raw = record(value, "文件庫能力規劃");
  const marketplaceId = text(raw.marketplaceId, "plan marketplaceId", 32);
  const reportType = text(raw.reportType, "plan reportType", 120);
  if (
    marketplaceId !== expectedMarketplaceId ||
    reportType !== expectedReportType
  ) {
    throw new Error("報表規劃回應與目前站點或選擇不一致。");
  }
  if (
    raw.amazonPublicArtifactAvailable !== true ||
    raw.appDownloadImplemented !== false
  ) {
    throw new Error("報表規劃混淆了 Amazon 公開能力與 App 已接線狀態。");
  }
  const nextStep = raw.nextStep === null
    ? null
    : text(raw.nextStep, "plan nextStep");
  return {
    reportType,
    marketplaceId,
    state: enumText(raw.state, STATES, "plan state"),
    amazonPublicArtifactAvailable: true,
    appDownloadImplemented: false,
    notice: text(raw.notice, "plan notice"),
    nextStep,
  };
}

export function reportStateLabel(state: ReportAccessState): string {
  const labels: Record<ReportAccessState, string> = {
    READY_TO_PLAN: "Amazon 有此文件 · App 尚未接線",
    FBA_FILTER_REQUIRED: "需先完成 FBA 過濾",
    EXTRA_ROLE_REQUIRED: "需額外角色／資格",
    RDT_REQUIRED: "含受限資料 · 本 App 停用",
    MANUAL_PREREQUISITE: "需 Amazon 官方介面先產生",
    AMAZON_GENERATED_ONLY: "僅 Amazon 自動產生",
    MARKETPLACE_UNAVAILABLE: "目前站點不支援",
    VENDOR_ONLY: "Vendor only",
    OUT_OF_FBA_SCOPE: "非 FBA-only 能力",
    DEPRECATED: "舊版／不新增整合",
  };
  return labels[state];
}
