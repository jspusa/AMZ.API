export type AccountingCapabilityState =
  | "READY_PUBLIC_API"
  | "MAIN_FBA_FILTER_REQUIRED"
  | "READY_CREATE_REPORT"
  | "READY_LIST_GENERATED"
  | "FBA_FILTER_NOT_IMPLEMENTED"
  | "MANUAL_PREREQUISITE"
  | "UNAVAILABLE";

export type AccountingCapabilityView = {
  id: string;
  label: string;
  artifact: "JSON" | "TAB_DELIMITED_REPORT" | "INVOICE_DOCUMENT" | "NONE";
  access: "DIRECT_PUBLIC_API" | "CREATE_PUBLIC_REPORT" | "LIST_AMAZON_GENERATED_REPORT" | "SELLER_CENTRAL_PREREQUISITE" | "UNAVAILABLE_PUBLIC_API";
  roles: string[];
  availability: "CONFIGURED_FBA_MARKETPLACES" | "BRAZIL_ONLY" | "NONE";
  fbaSafety: "OFFICIAL_FBA_ONLY" | "REQUIRES_AFN_ITEM_FILTER" | "ACCOUNT_WIDE_NOT_FBA_SAFE" | "BRAZIL_FBA_ONLY" | "NO_PUBLIC_DATA";
  reportType: string | null;
  officialSource: string;
  notice: string;
  state: AccountingCapabilityState;
};

export type AccountingCapabilitySnapshot = {
  marketplaceId: string;
  fetchedAt: string;
  capabilities: AccountingCapabilityView[];
  notice: string;
};

export type AccountingAccessPlanReply = {
  capabilityId: string;
  marketplaceId: string;
  state: AccountingCapabilityState;
  notice: string;
  nextStep: string | null;
};

export type AccountingDateRequirement =
  | "NONE"
  | "START_ONLY_ENDS_NOW"
  | "START_AND_END";

export type AccountingRequestTicket = {
  generation: number;
  controller: AbortController;
};

export class LatestAccountingRequest {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): AccountingRequestTicket {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    return { generation: ++this.generation, controller };
  }

  invalidate(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }

  isCurrent(ticket: AccountingRequestTicket): boolean {
    return (
      ticket.generation === this.generation &&
      ticket.controller === this.controller &&
      !ticket.controller.signal.aborted
    );
  }

  complete(ticket: AccountingRequestTicket): void {
    if (this.isCurrent(ticket)) this.controller = null;
  }
}

export function accountingDateRequirement(capabilityId: string): AccountingDateRequirement {
  if (capabilityId === "FBA_FEE_PREVIEW") return "START_ONLY_ENDS_NOW";
  if (["FINANCES_TRANSACTIONS", "FBA_LONG_TERM_STORAGE_FEES"].includes(capabilityId)) {
    return "START_AND_END";
  }
  return "NONE";
}

function toIsoDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const iso = `${value}T00:00:00.000Z`;
  const parsed = new Date(iso);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === iso ? iso : null;
}

export function accountingDatesReady(input: {
  capabilityId: string;
  startDate: string;
  endDate: string;
}): boolean {
  const requirement = accountingDateRequirement(input.capabilityId);
  if (requirement === "NONE") return true;
  if (!toIsoDate(input.startDate)) return false;
  return requirement === "START_ONLY_ENDS_NOW" || Boolean(toIsoDate(input.endDate));
}

export function buildAccountingPlanRequest(input: {
  capabilityId: string;
  marketplaceId: string;
  startDate: string;
  endDate: string;
}): Record<string, string> {
  const body: Record<string, string> = {
    marketplaceId: input.marketplaceId,
    capabilityId: input.capabilityId,
  };
  const requirement = accountingDateRequirement(input.capabilityId);
  if (requirement === "NONE") return body;
  const dataStartTime = toIsoDate(input.startDate);
  if (!dataStartTime) throw new Error("請先選擇有效的開始日。");
  body.dataStartTime = dataStartTime;
  if (requirement === "START_ONLY_ENDS_NOW") return body;
  const dataEndTime = toIsoDate(input.endDate);
  if (!dataEndTime) throw new Error("請先選擇有效的結束日。");
  body.dataEndTime = dataEndTime;
  return body;
}

const IDS = new Set([
  "FINANCES_TRANSACTIONS",
  "FBA_STORAGE_FEES",
  "FBA_OVERAGE_FEES",
  "FBA_FEE_PREVIEW",
  "FBA_REIMBURSEMENTS",
  "FBA_LONG_TERM_STORAGE_FEES",
  "SETTLEMENT_V2",
  "FINANCIAL_HOLDS",
  "BRAZIL_FBA_INVOICES",
  "GENERIC_MARKETPLACE_INVOICES",
  "SELLER_ACCOUNT_BILLS",
]);
const ARTIFACTS = new Set(["JSON", "TAB_DELIMITED_REPORT", "INVOICE_DOCUMENT", "NONE"]);
const ACCESS = new Set(["DIRECT_PUBLIC_API", "CREATE_PUBLIC_REPORT", "LIST_AMAZON_GENERATED_REPORT", "SELLER_CENTRAL_PREREQUISITE", "UNAVAILABLE_PUBLIC_API"]);
const AVAILABILITY = new Set(["CONFIGURED_FBA_MARKETPLACES", "BRAZIL_ONLY", "NONE"]);
const FBA_SAFETY = new Set(["OFFICIAL_FBA_ONLY", "REQUIRES_AFN_ITEM_FILTER", "ACCOUNT_WIDE_NOT_FBA_SAFE", "BRAZIL_FBA_ONLY", "NO_PUBLIC_DATA"]);
const STATES = new Set<AccountingCapabilityState>([
  "READY_PUBLIC_API",
  "MAIN_FBA_FILTER_REQUIRED",
  "READY_CREATE_REPORT",
  "READY_LIST_GENERATED",
  "FBA_FILTER_NOT_IMPLEMENTED",
  "MANUAL_PREREQUISITE",
  "UNAVAILABLE",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式無效。`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label}缺少或含有無效字元。`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, label: string): T {
  if (typeof value !== "string" || !values.has(value as T)) throw new Error(`${label}不在允許清單。`);
  return value as T;
}

function parseCapability(value: unknown, index: number): AccountingCapabilityView {
  const raw = record(value, `第 ${index + 1} 個帳務能力`);
  const id = enumValue(raw.id, IDS, `第 ${index + 1} 個帳務能力 ID`);
  const officialSource = text(raw.officialSource, `${id} 官方來源`);
  let source: URL;
  try { source = new URL(officialSource); } catch { throw new Error(`${id} 官方來源網址無效。`); }
  if (source.protocol !== "https:" || source.hostname !== "developer-docs.amazon.com") {
    throw new Error(`${id} 官方來源不是允許的 Amazon 開發者文件。`);
  }
  if (!Array.isArray(raw.roles) || raw.roles.some((role) => typeof role !== "string" || role.length > 120)) {
    throw new Error(`${id} 角色清單無效。`);
  }
  const reportType = raw.reportType === null ? null : text(raw.reportType, `${id} report type`, 120);
  const state = enumValue(raw.state, STATES, `${id} 狀態`);
  const access = enumValue(raw.access, ACCESS, `${id} access`) as AccountingCapabilityView["access"];
  const availability = enumValue(raw.availability, AVAILABILITY, `${id} availability`) as AccountingCapabilityView["availability"];
  const fbaSafety = enumValue(raw.fbaSafety, FBA_SAFETY, `${id} FBA safety`) as AccountingCapabilityView["fbaSafety"];
  if (
    (availability !== "CONFIGURED_FBA_MARKETPLACES" && state !== "UNAVAILABLE") ||
    (access === "UNAVAILABLE_PUBLIC_API" && state !== "UNAVAILABLE") ||
    (fbaSafety === "ACCOUNT_WIDE_NOT_FBA_SAFE" && ["READY_PUBLIC_API", "READY_CREATE_REPORT", "READY_LIST_GENERATED"].includes(state))
  ) {
    throw new Error(`${id} 的公開 API 狀態與 FBA 安全邊界互相矛盾。`);
  }
  return {
    id,
    label: text(raw.label, `${id} 名稱`, 120),
    artifact: enumValue(raw.artifact, ARTIFACTS, `${id} artifact`) as AccountingCapabilityView["artifact"],
    access,
    roles: [...raw.roles] as string[],
    availability,
    fbaSafety,
    reportType,
    officialSource,
    notice: text(raw.notice, `${id} 說明`),
    state,
  };
}

export function parseAccountingCapabilitySnapshot(value: unknown): AccountingCapabilitySnapshot {
  const raw = record(value, "帳務中心能力回應");
  if (!Array.isArray(raw.capabilities)) throw new Error("帳務中心缺少公開 API 能力清單。");
  const capabilities = raw.capabilities.map(parseCapability);
  const ids = capabilities.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("帳務中心含有重複能力。");
  return {
    marketplaceId: text(raw.marketplaceId, "帳務中心站點", 32),
    fetchedAt: (() => {
      const fetchedAt = text(raw.fetchedAt, "帳務中心更新時間", 64);
      if (Number.isNaN(new Date(fetchedAt).getTime())) throw new Error("帳務中心更新時間無效。");
      return fetchedAt;
    })(),
    capabilities,
    notice: text(raw.notice, "帳務中心能力邊界"),
  };
}

export function parseAccountingAccessPlanReply(value: unknown): AccountingAccessPlanReply {
  const raw = record(value, "帳務下載規劃回應");
  return {
    capabilityId: enumValue(raw.capabilityId, IDS, "帳務能力 ID"),
    marketplaceId: text(raw.marketplaceId, "帳務規劃站點", 32),
    state: enumValue(raw.state, STATES, "帳務規劃狀態"),
    notice: text(raw.notice, "帳務規劃說明"),
    nextStep: raw.nextStep === null || raw.nextStep === undefined ? null : text(raw.nextStep, "帳務規劃下一步"),
  };
}

export function accountingStateLabel(state: AccountingCapabilityState): string {
  switch (state) {
    case "READY_PUBLIC_API": return "公開 API 可讀取";
    case "READY_CREATE_REPORT": return "公開 API 可建立 FBA 報表";
    case "READY_LIST_GENERATED": return "可列出 Amazon 已產生報表";
    case "MAIN_FBA_FILTER_REQUIRED": return "需先完成 AFN 明細過濾";
    case "FBA_FILTER_NOT_IMPLEMENTED": return "FBA 過濾未完成，禁止下載";
    case "MANUAL_PREREQUISITE": return "需先在 Amazon 人工產生";
    case "UNAVAILABLE": return "公開 API 不可用";
  }
}

export function accountingStateKind(state: AccountingCapabilityState): "ready" | "manual" | "blocked" {
  if (["READY_PUBLIC_API", "READY_CREATE_REPORT", "READY_LIST_GENERATED"].includes(state)) return "ready";
  return state === "MANUAL_PREREQUISITE" ? "manual" : "blocked";
}
