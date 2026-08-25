import type { AuditSuiteMode } from "../../shared/audit-suite";

/** Main-only identity. The stable opaque account scope must never cross IPC. */
export type AuditSuiteContext = Readonly<{
  runId: string;
  marketplaceId: string;
  accountScope: string;
  generation: number;
  mode: AuditSuiteMode;
}>;
