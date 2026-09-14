export type InventoryExpirySourceFailure = Readonly<{
  operation: "plan" | "shipment-items" | "plan-items" | "unknown";
  page: "first" | "next" | "unknown";
  status: 400 | 404 | 422;
  reason: "legacy-v0-plan-unsupported" | "inbound-plan-unavailable" | "inbound-plan-id-malformed" | "invalid-status" | "other-input" | "unknown";
  code: "BadRequest" | "InvalidInput" | "unknown" | "not-recorded";
  responseState: "parsed" | "empty" | "malformed" | "oversize" | "timed-out" | "unavailable" | "not-read" | "not-recorded";
  count: number;
}>;

/** Counts describe saved source coverage, never current stock or batch confirmation. */
export type InventoryExpirySourceDiagnostics = Readonly<{
  status: "unknown";
  reason: "not-recorded" | "legacy-checkpoint" | "stale-checkpoint" | "context-mismatch" | "invalid-checkpoint";
}> | Readonly<{
  status: "available";
  recordedAt: string;
  stale: boolean;
  traversal: "partial" | "complete";
  listedPlanCount: number;
  pendingPlanCount: number;
  cachedPlanCount: number;
  planItemFallbackCount?: number;
  unavailablePlanCount: number;
  statusCounts: Readonly<{ "400": number; "404": number; "422": number }>;
  failures: readonly InventoryExpirySourceFailure[];
}>;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const keys = (value: Record<string, unknown>, expected: readonly string[], optional: readonly string[] = []) =>
  expected.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => expected.includes(key) || optional.includes(key));
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 6000;
// Five known operation/page pairs: 3 statuses × (6 historical reasons + 1
// untyped fallback), plus 2 body-reading statuses × (3 generic parsed pairs +
// 5 body failures). Add 7 exact causes, 5 explicit 404s and 3 legacy unknowns.
const MAX_FAILURE_GROUPS = 5 * (3 * 7 + 2 * 8) + 7 + 5 + 3;
export function isInventoryExpirySourceFailure(value: unknown): value is InventoryExpirySourceFailure {
  if (!record(value) || !keys(value, ["operation", "page", "status", "reason", "code", "responseState", "count"]) ||
    typeof value.operation !== "string" || !["plan", "shipment-items", "plan-items", "unknown"].includes(value.operation) ||
    typeof value.page !== "string" || !["first", "next", "unknown"].includes(value.page) || typeof value.status !== "number" || ![400, 404, 422].includes(value.status) ||
    typeof value.reason !== "string" || !["legacy-v0-plan-unsupported", "inbound-plan-unavailable", "inbound-plan-id-malformed", "invalid-status", "other-input", "unknown"].includes(value.reason) ||
    typeof value.code !== "string" || !["BadRequest", "InvalidInput", "unknown", "not-recorded"].includes(value.code) ||
    typeof value.responseState !== "string" || !["parsed", "empty", "malformed", "oversize", "timed-out", "unavailable", "not-read", "not-recorded"].includes(value.responseState) ||
    !count(value.count) || value.count === 0) return false;
  if (value.operation === "unknown") return value.page === "unknown" && value.reason === "unknown" && value.code === "not-recorded" && value.responseState === "not-recorded";
  if (value.page === "unknown" || (value.operation === "plan" && value.page !== "first")) return false;
  if (value.responseState === "not-recorded") return value.code === "not-recorded" || (value.code === "unknown" && value.reason === "unknown");
  if (value.code === "not-recorded") return false;
  if (value.status === 404) return value.responseState === "not-read" && value.code === "unknown" && value.reason === "unknown";
  if (value.responseState === "not-read") return false;
  if (value.responseState !== "parsed" || value.code === "unknown") return value.code === "unknown" && value.reason === "unknown";
  if (value.reason === "other-input") return true;
  if (value.status !== 400 || value.code !== "BadRequest") return false;
  return (value.reason === "inbound-plan-id-malformed" && value.operation === "plan") ||
    (value.reason === "legacy-v0-plan-unsupported" && value.operation === "plan-items") ||
    (value.reason === "inbound-plan-unavailable" && (value.operation === "plan-items" || value.operation === "shipment-items"));
}
export function isInventoryExpirySourceDiagnostics(value: unknown): value is InventoryExpirySourceDiagnostics {
  if (!record(value)) return false;
  if (value.status === "unknown") return keys(value, ["status", "reason"]) && typeof value.reason === "string" &&
    ["not-recorded", "legacy-checkpoint", "stale-checkpoint", "context-mismatch", "invalid-checkpoint"].includes(value.reason);
  if (value.status !== "available" || !keys(value, ["status", "recordedAt", "stale", "traversal", "listedPlanCount", "pendingPlanCount", "cachedPlanCount", "unavailablePlanCount", "statusCounts", "failures"], ["planItemFallbackCount"]) ||
    typeof value.recordedAt !== "string" || value.recordedAt.length > 40 || !Number.isFinite(Date.parse(value.recordedAt)) || new Date(value.recordedAt).toISOString() !== value.recordedAt ||
    typeof value.stale !== "boolean" || typeof value.traversal !== "string" || !["partial", "complete"].includes(value.traversal) ||
    ![value.listedPlanCount, value.pendingPlanCount, value.cachedPlanCount, value.unavailablePlanCount].every(count) ||
    (Object.hasOwn(value, "planItemFallbackCount") && (!count(value.planItemFallbackCount) || value.planItemFallbackCount > Number(value.cachedPlanCount))) ||
    !record(value.statusCounts) || !keys(value.statusCounts, ["400", "404", "422"]) || !Object.values(value.statusCounts).every(count) ||
    !Array.isArray(value.failures) || value.failures.length > MAX_FAILURE_GROUPS) return false;
  const seen = new Set<string>();
  const totals = { "400": 0, "404": 0, "422": 0 };
  for (const failure of value.failures) {
    if (!isInventoryExpirySourceFailure(failure)) return false;
    const key = JSON.stringify([failure.operation, failure.page, failure.status, failure.reason, failure.code, failure.responseState]);
    if (seen.has(key)) return false;
    seen.add(key);
    totals[failure.status as 400 | 404 | 422] += failure.count;
  }
  return totals[400] === value.statusCounts[400] && totals[404] === value.statusCounts[404] && totals[422] === value.statusCounts[422] &&
    totals[400] + totals[404] + totals[422] === value.unavailablePlanCount &&
    Number(value.cachedPlanCount) + Number(value.unavailablePlanCount) + Number(value.pendingPlanCount) <= Number(value.listedPlanCount) &&
    (value.traversal !== "complete" || value.pendingPlanCount === 0);
}
