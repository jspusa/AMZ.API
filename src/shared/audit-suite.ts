export const AUDIT_SUITE_SCHEMA_VERSION = 2 as const;

export const AUDIT_SUITE_SECTION_IDS = [
  "content",
  "image",
  "variation",
  "subscription",
  "advertising",
] as const;

export type AuditSuiteSectionId = typeof AUDIT_SUITE_SECTION_IDS[number];
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
