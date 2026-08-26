import { describe, expect, it } from "vitest";
import {
  SpApiError as FacadeSpApiError,
  SpApiPreCommitError as FacadeSpApiPreCommitError,
} from "../src/main/amazon/sp-api";
import {
  publicSpApiError,
  SpApiError,
  SpApiPreCommitError,
  type ListingIssue,
  type SpApiOperation,
} from "../src/main/amazon/sp-api-error";

describe("SP-API error leaf seam", () => {
  it("keeps the legacy facade on the one canonical constructor", () => {
    expect(FacadeSpApiError).toBe(SpApiError);
    expect(FacadeSpApiPreCommitError).toBe(SpApiPreCommitError);

    const error = new SpApiError("Amazon 暫時無法使用。");
    expect(error).toBeInstanceOf(FacadeSpApiError);
    expect(error).toBeInstanceOf(Error);
  });

  it("preserves the established defaults and structured upstream metadata", () => {
    expect(new SpApiError("Amazon 暫時無法使用。")).toMatchObject({
      name: "SpApiError",
      message: "Amazon 暫時無法使用。",
      status: 500,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: null,
      retryAfter: null,
      issues: [],
      operation: null,
      upstreamCode: null,
    });

    const issues: ListingIssue[] = [{
      code: "INVALID_ATTRIBUTE",
      severity: "ERROR",
      message: "Attribute is invalid.",
      attributeNames: ["item_name"],
      categories: ["INVALID"],
      marketplaceIds: ["ATVPDKIKX0DER"],
    }];
    const operation: SpApiOperation = "patchListingsItemPreview";
    const error = new FacadeSpApiError("Amazon Validation Preview 失敗。", {
      status: 429,
      code: "RATE_LIMITED",
      requestId: "request-id-safe-for-test",
      retryAfter: "7",
      issues,
      operation,
      upstreamCode: "QuotaExceeded",
    });

    expect(error).toMatchObject({
      name: "SpApiError",
      status: 429,
      code: "RATE_LIMITED",
      requestId: "request-id-safe-for-test",
      retryAfter: "7",
      operation: "patchListingsItemPreview",
      upstreamCode: "QuotaExceeded",
    });
    expect(error.issues).toBe(issues);
  });

  it("preserves the classified pre-commit contract without implying a PATCH", () => {
    const issues: ListingIssue[] = [{
      code: "INVALID_ATTRIBUTE",
      severity: "ERROR",
      message: "Attribute is invalid.",
      attributeNames: ["item_name"],
    }];
    const cause = new SpApiError("Amazon Validation Preview 暫時無法使用。", {
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: "request-id-safe-for-test",
      retryAfter: "4",
      issues,
      operation: "patchListingsItemPreview",
      upstreamCode: "ServiceUnavailable",
    });
    const error = new SpApiPreCommitError(cause);

    expect(error).toBeInstanceOf(SpApiError);
    expect(error).toBeInstanceOf(FacadeSpApiPreCommitError);
    expect(error).toMatchObject({
      name: "SpApiPreCommitError",
      message:
        "Amazon Validation Preview 暫時無法使用。 正式 commit PATCH 尚未送出；可重新預檢後再試。",
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: "request-id-safe-for-test",
      retryAfter: "4",
      operation: "patchListingsItemPreview",
      upstreamCode: "ServiceUnavailable",
      commitPatchSent: false,
    });
    expect(error.issues).toBe(issues);
  });

  it("serializes normal public status, body and header metadata byte-compatibly", () => {
    const issues: ListingIssue[] = [{
      code: "INVALID_ATTRIBUTE",
      severity: "ERROR",
      message: "Attribute is invalid.",
      attributeNames: ["item_name"],
      categories: ["INVALID"],
      marketplaceIds: ["ATVPDKIKX0DER"],
    }];
    const error = new SpApiError("Amazon Validation Preview 失敗。", {
      status: 429,
      code: "RATE_LIMITED",
      requestId: "request-id.safe:for_test",
      retryAfter: "Wed, 21 Oct 2015 07:28:00 GMT",
      issues,
      operation: "patchListingsItemPreview",
      upstreamCode: "QuotaExceeded",
    });
    const serialized = publicSpApiError(error, "無法完成 Amazon 操作。");

    expect(serialized).toEqual({
      status: 429,
      code: "RATE_LIMITED",
      message: "Amazon Validation Preview 失敗。",
      requestId: "request-id.safe:for_test",
      retryAfter: "Wed, 21 Oct 2015 07:28:00 GMT",
      issues,
      operation: "patchListingsItemPreview",
      upstreamCode: "QuotaExceeded",
    });
    expect(JSON.stringify({
      code: serialized.code,
      message: serialized.message,
      requestId: serialized.requestId,
      issues: serialized.issues,
      operation: serialized.operation,
      upstreamCode: serialized.upstreamCode,
    })).toBe(JSON.stringify({
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      issues: error.issues,
      operation: error.operation,
      upstreamCode: error.upstreamCode,
    }));
    expect(serialized.retryAfter).toBe(error.retryAfter);
    expect(Object.isFrozen(serialized)).toBe(true);
    expect(Object.isFrozen(serialized.issues)).toBe(true);
    expect(Object.isFrozen(serialized.issues[0])).toBe(true);
    expect(Object.isFrozen(serialized.issues[0]?.attributeNames)).toBe(true);
    expect("commitPatchSent" in serialized).toBe(false);
  });

  it("fails hostile public fields closed without leaking secrets, controls or URLs", () => {
    const cause = new SpApiError(
      `Bearer access-token-value\u0000\u202e https://bridge.invalid/callback?client_secret=secret-value accountScope=${"a".repeat(64)} reportId=hostile-report documentId=hostile-document`,
      {
        status: 302,
        code: "BAD\nCODE",
        requestId: "Atza|hostile-access-token",
        retryAfter: "-1\r\nx-leaked-header: yes",
        issues: [{
          code: "SECRET\u0000CODE",
          severity: "ERROR",
          message: "Atzr|hostile-refresh-token https://example.invalid/secret",
          attributeNames: ["refresh_token=hostile"],
          categories: ["accountScope=hostile"],
          marketplaceIds: ["ATVPDKIKX0DER\u202e"],
        }],
        operation: "patchListingsItemPreview",
        upstreamCode: "client_secret=hostile",
      },
    );
    const error = new SpApiPreCommitError(cause);
    (error as unknown as { operation: string }).operation = "https://evil.invalid/operation";
    const serialized = publicSpApiError(error, "無法完成 Amazon 操作。");
    const publicJson = JSON.stringify(serialized);

    expect(serialized).toEqual({
      status: 500,
      code: "UPSTREAM_UNAVAILABLE",
      message: "無法完成 Amazon 操作。",
      requestId: null,
      retryAfter: null,
      issues: [],
      operation: null,
      upstreamCode: null,
    });
    expect(publicJson).not.toMatch(
      /Bearer|Atza|Atzr|access.?token|refresh.?token|client.?secret|accountScope|reportId|documentId|https?:|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/iu,
    );
    expect("commitPatchSent" in serialized).toBe(false);
  });

  it("strips invisible controls, bounds text and validates retry-after metadata", () => {
    const longText = "安".repeat(3_000);
    const serialized = publicSpApiError(
      new SpApiError(`Amazon\u0000 回應\u200b 無效\u202e${longText}`, {
        retryAfter: "7",
        issues: [{
          code: null,
          severity: "WARNING",
          message: `欄位\u0085 無效\u2066${longText}`,
          attributeNames: ["item_name"],
        }],
      }),
      "無法完成 Amazon 操作。",
    );

    expect(serialized.message).toMatch(/^Amazon 回應 無效/u);
    expect([...serialized.message]).toHaveLength(2_048);
    expect(serialized.issues).toHaveLength(1);
    expect([...(serialized.issues[0]?.message ?? "")]).toHaveLength(1_024);
    expect(serialized.retryAfter).toBe("7");
    expect(JSON.stringify(serialized)).not.toMatch(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u,
    );

    const invalidRetry = publicSpApiError(
      new SpApiError("Amazon 暫時無法使用。", { retryAfter: "Infinity" }),
      "無法完成 Amazon 操作。",
    );
    expect(invalidRetry.retryAfter).toBeNull();
  });

  it("does not mistake a marketplace ID for a Seller ID but rejects raw account identifiers", () => {
    expect(publicSpApiError(
      new SpApiError("Amazon marketplace ATVPDKIKX0DER 暫時無法使用。"),
      "無法完成 Amazon 操作。",
    ).message).toBe("Amazon marketplace ATVPDKIKX0DER 暫時無法使用。");

    const hostile = new SpApiError(
      "Seller ID A1SELLERID1234 與 reportId hostile-report 不一致。",
      {
        requestId: "a".repeat(64),
        issues: [{
          code: null,
          severity: "ERROR",
          message: "documentId hostile-document 無法使用。",
          attributeNames: [],
        }],
        upstreamCode: "A1SELLERID1234",
      },
    );
    const serialized = publicSpApiError(hostile, "無法完成 Amazon 操作。");

    expect(serialized.message).toBe("無法完成 Amazon 操作。");
    expect(serialized.requestId).toBeNull();
    expect(serialized.issues).toEqual([]);
    expect(serialized.upstreamCode).toBeNull();
    expect(JSON.stringify(serialized)).not.toMatch(
      /A1SELLERID1234|a{64}|reportId|documentId/u,
    );
  });

  it("rejects unlabeled Amazon report and document identifiers", () => {
    const documentId = "amzn1.spdoc.1.4.private-document-value";
    const reportId = "1234567890123";
    const serialized = publicSpApiError(
      new SpApiError(
        `Amazon document ${documentId} and report ${reportId} are unavailable.`,
        {
          requestId: "safe-request-id",
          upstreamCode: documentId,
          issues: [{
            code: null,
            severity: "ERROR",
            message: `Unable to read ${reportId}.`,
            attributeNames: [],
          }],
        },
      ),
      "無法完成 Amazon 操作。",
    );

    expect(serialized).toMatchObject({
      message: "無法完成 Amazon 操作。",
      requestId: "safe-request-id",
      upstreamCode: null,
      issues: [],
    });
    expect(JSON.stringify(serialized)).not.toContain(documentId);
    expect(JSON.stringify(serialized)).not.toContain(reportId);
  });
});
