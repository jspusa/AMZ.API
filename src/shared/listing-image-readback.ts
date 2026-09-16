/** Closed, value-free explanation of one canonical read; never carries upstream text or identifiers. */
export const LISTING_IMAGE_READBACK_BLOCKERS = [
  "invalid-evidence", "receipt-not-live-accepted", "readback-not-live", "not-fba",
  "marketplace-mismatch", "sku-mismatch", "asin-mismatch", "product-type-mismatch",
  "attributes-missing", "slot-shape-mismatch", "issues-unavailable", "error-issues", "url-mismatch",
] as const;
export type ListingImageReadbackBlocker = typeof LISTING_IMAGE_READBACK_BLOCKERS[number];
export type ListingImageReadbackDiagnostics = Readonly<{
  version: 1;
  decision: "verified" | "pending";
  blockers: readonly ListingImageReadbackBlocker[];
  issues: Readonly<{ errorCount: number; imageErrorCount: number; nonImageErrorCount: number; unscopedErrorCount: number }>;
  slots: Readonly<{
    compared: boolean;
    targetCount: number;
    matchedCount: number;
    missingCount: number;
    deletionPendingCount: number;
    differentUrlCount: number;
    invalidUrlCount: number;
    /** Mismatched slots whose observed value still equals this operation's previous value. */
    unchangedPreviousCount: number;
    /** Diagnostic candidates only; these counts never establish image equivalence. */
    amazonHostedDifferentCount: number;
    crossHostAmazonDifferentCount: number;
  }>;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function count(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
const issueKeys = ["errorCount", "imageErrorCount", "nonImageErrorCount", "unscopedErrorCount"] as const;
const slotCountKeys = ["targetCount", "matchedCount", "missingCount", "deletionPendingCount", "differentUrlCount", "invalidUrlCount", "unchangedPreviousCount", "amazonHostedDifferentCount", "crossHostAmazonDifferentCount"] as const;

/** Unknown versions, additional fields, contradictory decisions and malformed counts fail closed. */
export function parseListingImageReadbackDiagnostics(value: unknown): ListingImageReadbackDiagnostics | null {
  if (!record(value) || !exactKeys(value, ["version", "decision", "blockers", "issues", "slots"])
    || value.version !== 1 || !["verified", "pending"].includes(value.decision as string)
    || !Array.isArray(value.blockers) || value.blockers.length > LISTING_IMAGE_READBACK_BLOCKERS.length
    || !value.blockers.every(blocker => LISTING_IMAGE_READBACK_BLOCKERS.includes(blocker))
    || new Set(value.blockers).size !== value.blockers.length
    || (value.decision === "verified") !== (value.blockers.length === 0)
    || !record(value.issues) || !record(value.slots)) return null;
  const rawIssues = value.issues;
  const rawSlots = value.slots;
  if (!exactKeys(rawIssues, issueKeys) || !issueKeys.every(key => count(rawIssues[key]))
    || !exactKeys(rawSlots, ["compared", ...slotCountKeys]) || typeof rawSlots.compared !== "boolean"
    || !slotCountKeys.every(key => count(rawSlots[key], 10))) return null;
  const issues = value.issues as ListingImageReadbackDiagnostics["issues"];
  const slots = value.slots as ListingImageReadbackDiagnostics["slots"];
  if (issues.errorCount !== issues.imageErrorCount + issues.nonImageErrorCount + issues.unscopedErrorCount
    || value.blockers.includes("error-issues") !== (issues.errorCount > 0)
    || (slots.compared && value.blockers.some(blocker => !["issues-unavailable", "error-issues", "url-mismatch"].includes(blocker)))
    || (slots.compared ? ![9, 10].includes(slots.targetCount) : slotCountKeys.some(key => slots[key] !== 0))
    || slots.targetCount !== slots.matchedCount + slots.missingCount + slots.deletionPendingCount + slots.differentUrlCount + slots.invalidUrlCount
    || slots.unchangedPreviousCount > slots.targetCount - slots.matchedCount
    || slots.amazonHostedDifferentCount > slots.differentUrlCount
    || slots.crossHostAmazonDifferentCount > slots.amazonHostedDifferentCount
    || value.blockers.includes("url-mismatch") !== (slots.compared && slots.matchedCount < slots.targetCount)
    || (value.decision === "verified" && !slots.compared)) return null;
  return {
    version: 1, decision: value.decision as "verified" | "pending",
    blockers: [...value.blockers], issues: { ...issues }, slots: { ...slots },
  };
}
