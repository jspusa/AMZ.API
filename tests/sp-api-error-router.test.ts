import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { ReplenishmentAuditError } from
  "../src/main/amazon/replenishment-audit";
import {
  SpApiError,
  SpApiPreCommitError,
} from "../src/main/amazon/sp-api-error";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const previousMode = process.env.SP_API_MODE;
const JSON_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
type RouterInput = ConstructorParameters<typeof ApiRouter>[0];
type DemoReportsAdapter = NonNullable<RouterInput["demoReportsAdapter"]>;

function startRequest(): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "POST",
    path: "/api/sp-api/aged-inventory",
    query: {},
    headers: {},
    body: { kind: "json", value: { marketplaceId: US } },
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

async function routerThatThrows(error: SpApiError): Promise<ApiRouter> {
  const directory = await mkdtemp(join(tmpdir(), "sp-error-router-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  const demoReportsAdapter: DemoReportsAdapter = {
    async create() {
      throw error;
    },
    async status() {
      throw new Error("status must not run while aged inventory create fails");
    },
    async readDocument() {
      throw new Error("document read must not run while aged inventory create fails");
    },
  };
  return new ApiRouter({
    store,
    vault: {
      getAccountScope: async () => "opaque-error-test-account",
    } as unknown as CredentialVault,
    approveWrite: async () => undefined,
    demoReportsAdapter,
  });
}

async function publicHandleError(error: unknown): Promise<ApiResponse> {
  const router = new ApiRouter({
    store: {} as LocalStore,
    vault: {
      getAccountScope: async () => {
        throw error;
      },
    } as unknown as CredentialVault,
    approveWrite: async () => undefined,
  } as ConstructorParameters<typeof ApiRouter>[0]);
  return router.handle({
    requestId: "router-error-contract-001",
    method: "GET",
    path: "/api/product-master",
    query: { marketplaceId: US },
    headers: {},
  });
}

describe("public SP-API error mapping", () => {
  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("keeps established safe status, body and retry-after metadata", async () => {
    const error = new SpApiError("Amazon Validation Preview 失敗。", {
      status: 429,
      code: "RATE_LIMITED",
      requestId: "request-id.safe:for_test",
      retryAfter: "7",
      issues: [{
        code: "INVALID_ATTRIBUTE",
        severity: "ERROR",
        message: "Attribute is invalid.",
        attributeNames: ["item_name"],
      }],
      operation: "patchListingsItemPreview",
      upstreamCode: "QuotaExceeded",
    });
    const router = await routerThatThrows(error);

    const response = await router.handle(startRequest());
    router.dispose();

    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("7");
    expect(jsonValue(response)).toEqual({
      code: "RATE_LIMITED",
      message: "Amazon Validation Preview 失敗。",
      requestId: "request-id.safe:for_test",
      issues: error.issues,
      operation: "patchListingsItemPreview",
      upstreamCode: "QuotaExceeded",
    });
  });

  it("fails hostile upstream metadata closed at the main-to-renderer boundary", async () => {
    const hostile = [
      "Bearer access-token-value",
      "accountScope=private-account",
      "reportId=private-report",
      "documentId=private-document",
      "https://example.invalid/private?client_secret=private-secret",
      "hostile-text\u202e\u0000",
    ].join(" ");
    const error = new SpApiError(hostile, {
      status: 302,
      code: "BAD\nCODE",
      requestId: "Atza|private-access-token",
      retryAfter: "-1\r\nx-private: secret",
      issues: [{
        code: "SECRET\u0000CODE",
        severity: "ERROR",
        message: "Atzr|private-refresh-token",
        attributeNames: ["refresh_token=private"],
      }],
      operation: "patchListingsItemPreview",
      upstreamCode: "client_secret=private",
    });
    (error as unknown as { operation: string }).operation =
      "https://example.invalid/private-operation";
    const router = await routerThatThrows(error);

    const response = await router.handle(startRequest());
    router.dispose();
    const serialized = JSON.stringify({
      headers: response.headers,
      body: jsonValue(response),
    });

    expect(response.status).toBe(500);
    expect(response.headers).not.toHaveProperty("retry-after");
    expect(jsonValue(response)).toEqual({
      code: "UPSTREAM_UNAVAILABLE",
      message: "開始建立 FBA 庫齡報表時發生未預期的錯誤。",
      requestId: null,
      issues: [],
      operation: null,
      upstreamCode: null,
    });
    expect(serialized).not.toMatch(
      /Bearer|Atza|Atzr|access.?token|refresh.?token|client.?secret|accountScope|reportId|documentId|https?:|hostile-text|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/iu,
    );
  });

  it("preserves the safe pre-commit status while keeping commit state private", async () => {
    const error = new SpApiPreCommitError(new SpApiError(
      "Amazon Validation Preview 暫時無法使用。",
      {
        status: 503,
        code: "UPSTREAM_UNAVAILABLE",
        requestId: "precommit-request.safe:001",
        retryAfter: "4",
        operation: "patchListingsItemPreview",
        upstreamCode: "ServiceUnavailable",
      },
    ));

    const response = await publicHandleError(error);

    expect(response).toEqual({
      status: 503,
      headers: { ...JSON_HEADERS, "retry-after": "4" },
      body: {
        kind: "json",
        value: {
          code: "UPSTREAM_UNAVAILABLE",
          message:
            "Amazon Validation Preview 暫時無法使用。 正式 commit PATCH 尚未送出；可重新預檢後再試。",
          requestId: "precommit-request.safe:001",
          issues: [],
          operation: "patchListingsItemPreview",
          upstreamCode: "ServiceUnavailable",
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("commitPatchSent");
  });

  it("preserves safe replenishment and unknown error envelopes", async () => {
    const cases = [
      {
        error: new ReplenishmentAuditError(
          "REQUEST_INVALID",
          "補貨請求無效。",
        ),
        expected: {
          status: 422,
          headers: JSON_HEADERS,
          body: {
            kind: "json" as const,
            value: {
              code: "REPLENISHMENT_REQUEST_INVALID",
              message: "補貨請求無效。",
            },
          },
        },
      },
      {
        error: new Error("private implementation detail"),
        expected: {
          status: 500,
          headers: JSON_HEADERS,
          body: {
            kind: "json" as const,
            value: {
              code: "INTERNAL_ERROR",
              message: "執行本機 Amazon 操作時發生未預期的錯誤。",
            },
          },
        },
      },
    ];

    for (const testCase of cases) {
      expect(await publicHandleError(testCase.error)).toEqual(testCase.expected);
    }
  });

  it("fails hostile non-SP error metadata closed at the public handle seam", async () => {
    const hostile = [
      "Bearer example-access-value",
      "accountScope=example-private-scope",
      "reportId=example-private-report",
      "https://example.invalid/private?client_secret=example-secret",
      "hostile-text\u202e\u0000",
    ].join(" ");
    const cases = [
      {
        error: new ReplenishmentAuditError("REQUEST_INVALID", hostile),
        expectedStatus: 422,
        expectedValue: {
          code: "REPLENISHMENT_REQUEST_INVALID",
          message: "執行本機 Amazon 操作時發生未預期的錯誤。",
        },
      },
    ];

    for (const testCase of cases) {
      const response = await publicHandleError(testCase.error);
      const serialized = JSON.stringify(response);
      expect(response).toEqual({
        status: testCase.expectedStatus ?? 500,
        headers: JSON_HEADERS,
        body: { kind: "json", value: testCase.expectedValue },
      });
      expect(serialized).not.toMatch(
        /Bearer|Atza|access.?value|client.?secret|accountScope|reportId|https?:|hostile-text|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/iu,
      );
    }
  });
});
