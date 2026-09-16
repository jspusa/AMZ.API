import { describe, expect, it } from "vitest";
import { parseListingImageReadbackDiagnostics } from "../src/shared/listing-image-readback";

function diagnostic() {
  return {
    version: 1, decision: "pending", blockers: ["url-mismatch"],
    issues: { errorCount: 0, imageErrorCount: 0, nonImageErrorCount: 0, unscopedErrorCount: 0 },
    slots: { compared: true, targetCount: 10, matchedCount: 9, missingCount: 0, deletionPendingCount: 0,
      differentUrlCount: 1, invalidUrlCount: 0, unchangedPreviousCount: 0, amazonHostedDifferentCount: 1, crossHostAmazonDifferentCount: 1 },
  };
}

describe("closed image readback diagnostics wire schema", () => {
  it("accepts a current sanitized diagnostic and detaches it from its source", () => {
    const original = diagnostic();
    const parsed = parseListingImageReadbackDiagnostics(original);
    expect(parsed).toEqual(original);
    original.blockers.push("private-upstream-value");
    original.slots.differentUrlCount = 99;
    expect(parsed?.blockers).toEqual(["url-mismatch"]);
    expect(parsed?.slots.differentUrlCount).toBe(1);
  });

  it.each([
    ["legacy omission", () => undefined],
    ["unknown version", () => ({ ...diagnostic(), version: 2 })],
    ["unknown state", () => ({ ...diagnostic(), decision: "success" })],
    ["unknown blocker", () => ({ ...diagnostic(), blockers: ["private-upstream-value"] })],
    ["duplicate blocker", () => ({ ...diagnostic(), blockers: ["url-mismatch", "url-mismatch"] })],
    ["new root key", () => ({ ...diagnostic(), sellerId: "private-id" })],
    ["new nested key", () => ({ ...diagnostic(), slots: { ...diagnostic().slots, actualUrl: "https://private.invalid" } })],
    ["negative count", () => ({ ...diagnostic(), slots: { ...diagnostic().slots, matchedCount: -1 } })],
    ["oversized slot count", () => ({ ...diagnostic(), slots: { ...diagnostic().slots, differentUrlCount: 11 } })],
    ["fractional count", () => ({ ...diagnostic(), issues: { ...diagnostic().issues, errorCount: 0.5 } })],
    ["infinite count", () => ({ ...diagnostic(), issues: { ...diagnostic().issues, errorCount: Infinity } })],
    ["missing field", () => ({ ...diagnostic(), slots: {} })],
    ["issue sum mismatch", () => ({ ...diagnostic(), issues: { ...diagnostic().issues, imageErrorCount: 1 } })],
    ["host count mismatch", () => ({ ...diagnostic(), slots: { ...diagnostic().slots, amazonHostedDifferentCount: 2 } })],
    ["cross-host count mismatch", () => ({ ...diagnostic(), slots: { ...diagnostic().slots, crossHostAmazonDifferentCount: 2 } })],
    ["false comparison with counts", () => ({ ...diagnostic(), slots: { ...diagnostic().slots, compared: false } })],
    ["verified while blocked", () => ({ ...diagnostic(), decision: "verified" })],
    ["unblocked URL mismatch", () => ({ ...diagnostic(), decision: "verified", blockers: [] })],
  ])("rejects %s without returning any unvalidated payload", (_label, value) => {
    expect(parseListingImageReadbackDiagnostics(value())).toBeNull();
  });
});
