import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

function request(method: "GET" | "POST", path: string): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path,
    query: method === "GET" ? { deliberatelyInvalidLegacyQuery: "1" } : {},
    headers: {},
    ...(method === "POST"
      ? {
          body: {
            kind: "json" as const,
            value: { deliberatelyInvalidLegacyBody: true },
          },
        }
      : {}),
  };
}

function delegated(operation: string): ApiResponse {
  return {
    status: 207,
    headers: {
      "x-r12-owner": "legacy-audit-suite-compatibility",
      "x-r12-operation": operation,
    },
    body: {
      kind: "json",
      value: { owner: "legacy-audit-suite-compatibility", operation },
    },
  };
}

describe("R12 legacy Audit Suite compatibility public seam", () => {
  it("delegates start, status, export and clear to one injected owner", async () => {
    const startResponse = delegated("start");
    const observeResponse = delegated("observe");
    const downloadResponse = delegated("download");
    const legacyAuditSuiteCompatibility = {
      start: vi.fn(async () => startResponse),
      observe: vi.fn(async () => observeResponse),
      download: vi.fn(async () => downloadResponse),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      legacyAuditSuiteCompatibility,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);
    const startRequest = request("POST", "/api/sp-api/audit-suite");
    const observeRequest = request("GET", "/api/sp-api/audit-suite");
    const downloadRequest = request(
      "GET",
      "/api/sp-api/audit-suite/export",
    );

    const responses = await Promise.all([
      router.handle(startRequest),
      router.handle(observeRequest),
      router.handle(downloadRequest),
    ]);
    router.dispose();

    expect(legacyAuditSuiteCompatibility.start).toHaveBeenCalledWith(
      startRequest,
    );
    expect(legacyAuditSuiteCompatibility.observe).toHaveBeenCalledWith(
      observeRequest,
    );
    expect(legacyAuditSuiteCompatibility.download).toHaveBeenCalledWith(
      downloadRequest,
    );
    expect(responses).toEqual([
      startResponse,
      observeResponse,
      downloadResponse,
    ]);
    expect(legacyAuditSuiteCompatibility.clear).toHaveBeenCalledOnce();
  });
});
