export type InventoryExpirySourceFailure = Readonly<{
  operation: "plan" | "shipment-items" | "plan-items" | "unknown";
  page: "first" | "next" | "unknown";
  status: 400 | 404 | 422;
  reason: "legacy-v0-plan-unsupported" | "inbound-plan-unavailable" | "invalid-status" | "other-input" | "unknown";
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
  unavailablePlanCount: number;
  statusCounts: Readonly<{ "400": number; "404": number; "422": number }>;
  failures: readonly InventoryExpirySourceFailure[];
}>;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 6000;
export function isInventoryExpirySourceDiagnostics(value: unknown): value is InventoryExpirySourceDiagnostics {
  if (!record(value)) return false;
  if (value.status === "unknown") return keys(value, ["status", "reason"]) && typeof value.reason === "string" &&
    ["not-recorded", "legacy-checkpoint", "stale-checkpoint", "context-mismatch", "invalid-checkpoint"].includes(value.reason);
  if (value.status !== "available" || !keys(value, ["status", "recordedAt", "stale", "traversal", "listedPlanCount", "pendingPlanCount", "cachedPlanCount", "unavailablePlanCount", "statusCounts", "failures"]) ||
    typeof value.recordedAt !== "string" || value.recordedAt.length > 40 || !Number.isFinite(Date.parse(value.recordedAt)) || new Date(value.recordedAt).toISOString() !== value.recordedAt ||
    typeof value.stale !== "boolean" || typeof value.traversal !== "string" || !["partial", "complete"].includes(value.traversal) ||
    ![value.listedPlanCount, value.pendingPlanCount, value.cachedPlanCount, value.unavailablePlanCount].every(count) ||
    !record(value.statusCounts) || !keys(value.statusCounts, ["400", "404", "422"]) || !Object.values(value.statusCounts).every(count) ||
    !Array.isArray(value.failures) || value.failures.length > 93) return false;
  const seen = new Set<string>();
  const totals = { "400": 0, "404": 0, "422": 0 };
  for (const failure of value.failures) {
    if (!record(failure) || !keys(failure, ["operation", "page", "status", "reason", "count"]) ||
      typeof failure.operation !== "string" || !["plan", "shipment-items", "plan-items", "unknown"].includes(failure.operation) ||
      typeof failure.page !== "string" || !["first", "next", "unknown"].includes(failure.page) || typeof failure.status !== "number" || ![400, 404, 422].includes(failure.status) ||
      typeof failure.reason !== "string" || !["legacy-v0-plan-unsupported", "inbound-plan-unavailable", "invalid-status", "other-input", "unknown"].includes(failure.reason) || !count(failure.count) || failure.count === 0 ||
      (failure.operation === "unknown" ? failure.page !== "unknown" || failure.reason !== "unknown" : failure.page === "unknown") ||
      (failure.operation === "plan" && failure.page !== "first")) return false;
    const key = JSON.stringify([failure.operation, failure.page, failure.status, failure.reason]);
    if (seen.has(key)) return false;
    seen.add(key);
    totals[failure.status as 400 | 404 | 422] += failure.count;
  }
  return totals[400] === value.statusCounts[400] && totals[404] === value.statusCounts[404] && totals[422] === value.statusCounts[422] &&
    totals[400] + totals[404] + totals[422] === value.unavailablePlanCount &&
    Number(value.cachedPlanCount) + Number(value.unavailablePlanCount) + Number(value.pendingPlanCount) <= Number(value.listedPlanCount) &&
    (value.traversal !== "complete" || value.pendingPlanCount === 0);
}
