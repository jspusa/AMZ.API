import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER";

function request(input: Readonly<{
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}>): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: input.method,
    path: "/api/sp-api/standalone-audit",
    query: input.query ?? {},
    headers: {},
    ...(input.body
      ? { body: { kind: "json" as const, value: input.body } }
      : {}),
  };
}

function response(value: string, status: number): ApiResponse {
  return {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
    body: { kind: "json", value: { owner: value } },
  };
}

describe("R11 standalone audit coordinator seam", () => {
  it("delegates both public routes and context cleanup to one injected owner", async () => {
    const startResponse = response("standalone-start", 202);
    const observeResponse = response("standalone-observe", 200);
    const standaloneAuditCoordinator = {
      start: vi.fn(async () => startResponse),
      observe: vi.fn(async () => observeResponse),
      getJob: vi.fn(),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {
        getAccountScope: async () => "opaque-r11-account",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      standaloneAuditCoordinator,
      standaloneAudit: { run: async () => ({}) },
    } as ConstructorParameters<typeof ApiRouter>[0]);

    const startRequest = request({
      method: "POST",
      body: {
        kind: "content",
        marketplaceId: US,
        mode: "demo",
      },
    });
    const observeRequest = request({
      method: "GET",
      query: {
        kind: "content",
        marketplaceId: US,
        mode: "demo",
        jobId: "standalone-job-r11",
        contextId: "standalone-context-r11",
      },
    });

    await expect(router.handle(startRequest)).resolves.toEqual(startResponse);
    await expect(router.handle(observeRequest)).resolves.toEqual(observeResponse);
    expect(standaloneAuditCoordinator.start).toHaveBeenCalledOnce();
    expect(standaloneAuditCoordinator.observe).toHaveBeenCalledOnce();

    router.dispose();
    expect(standaloneAuditCoordinator.clear).toHaveBeenCalledOnce();
  });
});
