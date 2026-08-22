export const AUDIT_SUITE_SCHEMA_VERSION = 3 as const;

export const AUDIT_SUITE_SECTIONS = Object.freeze([
  { id: "content", label: "全站文案健檢" },
  { id: "image", label: "全站圖片健檢" },
  { id: "aplus", label: "全站 A+ 健檢" },
  { id: "variation", label: "未綁變體健檢" },
  { id: "subscription", label: "全站訂閱價格健檢" },
  { id: "businessPricing", label: "全站 B2B 價格健檢" },
  { id: "advertising", label: "廣告覆蓋健檢" },
] as const);

export type AuditSuiteSectionId = typeof AUDIT_SUITE_SECTIONS[number]["id"];

export const AUDIT_SUITE_SECTION_IDS: readonly AuditSuiteSectionId[] =
  Object.freeze(AUDIT_SUITE_SECTIONS.map(({ id }) => id));

export const AUDIT_SUITE_SECTION_COUNT = AUDIT_SUITE_SECTION_IDS.length;

export const AUDIT_SUITE_SECTION_LABELS: Readonly<Record<AuditSuiteSectionId, string>> =
  Object.freeze(Object.fromEntries(
    AUDIT_SUITE_SECTIONS.map(({ id, label }) => [id, label]),
  ) as Record<AuditSuiteSectionId, string>);
export type AuditSuiteMode = "live" | "demo";
export type AuditSuiteRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed";
export type AuditSuiteSectionStatus = AuditSuiteRunStatus;

export type AuditSuiteContext = Readonly<{
  runId: string;
  marketplaceId: string;
  accountScope: string;
  mode: AuditSuiteMode;
}>;

/** Public, run-bound context. Never expose the stable account-scope hash. */
export type AuditSuitePublicContext = Readonly<{
  runId: string;
  contextId: string;
  marketplaceId: string;
  mode: AuditSuiteMode;
}>;

export type AuditSuiteExpectedContext = AuditSuitePublicContext;

export type AuditSuiteSectionProgress = Readonly<{
  id: AuditSuiteSectionId;
  status: AuditSuiteSectionStatus;
  message: string;
  completedUnits: number | null;
  totalUnits: number | null;
  updatedAt: string;
}>;

export type AuditSuiteRunDto = AuditSuitePublicContext & Readonly<{
  schemaVersion: typeof AUDIT_SUITE_SCHEMA_VERSION;
  status: AuditSuiteRunStatus;
  startedAt: string;
  updatedAt: string;
  sections: Readonly<Record<AuditSuiteSectionId, AuditSuiteSectionProgress>>;
}>;

export type AuditSuiteRun = AuditSuiteRunDto;

export type AuditSuiteState = Readonly<{
  runsByMarketplace: Readonly<Record<string, AuditSuiteRun>>;
}>;
