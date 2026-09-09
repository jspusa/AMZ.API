import { describe, expect, it } from "vitest";
import {
  parseVariationPreviewDiagnostics,
  safeVariationDiagnosticText,
} from "../src/renderer/src/variation-preview-diagnostics";

const issue = {
  code: "4000002",
  severity: "ERROR",
  attributeNames: ["contains_liquid_contents"],
  categories: ["MISSING_ATTRIBUTE"],
  marketplaceIds: ["ATVPDKIKX0DER"],
};

describe("variation Preview public diagnostics", () => {
  it("projects only display metadata and leaves the source untouched", () => {
    const raw = {
      code: "INVALID_LISTING_REQUEST",
      upstreamCode: "4000002",
      operation: "patchListingsItemPreview",
      requestId: "synthetic-request-1",
      message: "Human message is handled separately.",
      sellerId: "PRIVATE_TOP_LEVEL",
      issues: [
        { ...issue, message: "PRIVATE_ISSUE_MESSAGE", value: "PRIVATE_VALUE" },
      ],
    };
    const before = JSON.stringify(raw);
    expect(parseVariationPreviewDiagnostics(raw, 422)).toEqual({
      localStatus: 422,
      code: raw.code,
      upstreamCode: raw.upstreamCode,
      operation: raw.operation,
      requestId: raw.requestId,
      issues: [issue],
      omittedIssues: 0,
      issuesUnavailable: false,
    });
    expect(JSON.stringify(raw)).toBe(before);
  });

  it.each([
    "request ?authorization=SYNTHETIC_ONLY",
    "request ?x-amz-security-token=SYNTHETIC_ONLY",
    "https://example.invalid/private",
    "Bearer SYNTHETIC_ONLY",
    "refresh_token=SYNTHETIC_ONLY",
    "A1234567890123",
    "reportId SYNTHETIC_ONLY",
    "a".repeat(64),
    "amzn1.spdoc.synthetic",
    "123456789012",
    "<script>unsafe</script>",
    "line\nnext",
    "hidden\u202etext",
  ])("rejects unsafe human message %s", (value) => {
    expect(safeVariationDiagnosticText(value)).toBeNull();
  });

  it("preserves ordinary human messages without coercing or truncating them", () => {
    const message = "'Contains Liquid Contents?' is required but missing.";
    expect(safeVariationDiagnosticText(message)).toBe(message);
    for (const invalid of [
      null,
      false,
      1,
      {},
      [],
      "",
      " padded ",
      "a".repeat(2_049),
    ]) {
      expect(safeVariationDiagnosticText(invalid)).toBeNull();
    }
  });

  it("rejects non-object errors and invalid local statuses", () => {
    for (const raw of [null, [], "error", 422, true]) {
      expect(parseVariationPreviewDiagnostics(raw, 422)).toBeNull();
    }
    for (const status of [399, 600, 422.1, NaN, Infinity, "422", null]) {
      expect(parseVariationPreviewDiagnostics({}, status as number)).toBeNull();
    }
  });

  it("hides malformed metadata and only accepts known marketplace IDs", () => {
    const parsed = parseVariationPreviewDiagnostics(
      {
        code: "a".repeat(129),
        upstreamCode: "A1234567890123",
        operation: "unrecognizedOperation",
        requestId: "https://example.invalid/private",
        issues: [
          {
            ...issue,
            code: "access_token=SYNTHETIC_ONLY",
            attributeNames: [
              "contains_liquid_contents",
              "contains_liquid_contents",
            ],
            categories: ["MISSING_ATTRIBUTE", false],
            marketplaceIds: ["ATVPDKIKX0DER", "A1234567890123"],
          },
        ],
      },
      422,
    );
    expect(parsed).toMatchObject({
      code: null,
      upstreamCode: null,
      operation: null,
      requestId: null,
    });
    expect(parsed?.issues).toEqual([
      {
        code: null,
        severity: "ERROR",
        attributeNames: null,
        categories: null,
        marketplaceIds: null,
      },
    ]);
  });

  it("reports omitted issues, including malformed rows within the display cap", () => {
    const issues = Array.from({ length: 25 }, () => ({ ...issue }));
    issues[1] = { ...issue, severity: "error" };
    const parsed = parseVariationPreviewDiagnostics({ issues }, 422);
    expect(parsed?.issues).toHaveLength(19);
    expect(parsed?.omittedIssues).toBe(6);
    expect(parsed?.issuesUnavailable).toBe(false);
    expect(
      parseVariationPreviewDiagnostics({ issues: {} }, 422)?.issuesUnavailable,
    ).toBe(true);
  });

  it("marks over-limit or malformed identifier lists as hidden instead of implying completeness", () => {
    const parsed = parseVariationPreviewDiagnostics(
      {
        issues: [
          {
            ...issue,
            attributeNames: Array.from(
              { length: 31 },
              (_, index) => `field_${index}`,
            ),
            categories: "MISSING_ATTRIBUTE",
            marketplaceIds: null,
          },
        ],
      },
      422,
    );
    expect(parsed?.issues[0]).toMatchObject({
      attributeNames: null,
      categories: null,
      marketplaceIds: null,
    });
  });
});
