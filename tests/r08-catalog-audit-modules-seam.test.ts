import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

function get(path: string, query: Record<string, string> = {}): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path,
    query,
    headers: {},
  };
}

describe("R08 catalog audit module public seam", () => {
  it("delegates the direct subscription route and lifecycle clear to one owner", async () => {
    const delegated: ApiResponse = {
      status: 207,
      headers: { "x-r08-owner": "subscription" },
      body: {
        kind: "json",
        value: { exportId: "subscription-owner-snapshot" },
      },
    };
    const subscriptionAudit = {
      read: vi.fn(async () => delegated),
      download: vi.fn(),
      runStandalone: vi.fn(),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      subscriptionAudit,
    } as ConstructorParameters<typeof ApiRouter>[0] & {
      subscriptionAudit: typeof subscriptionAudit;
    });
    const request = get("/api/sp-api/subscription-audit", {
      deliberatelyInvalidLegacyQuery: "1",
    });

    const response = await router.handle(request);
    router.dispose();

    expect(subscriptionAudit.read).toHaveBeenCalledOnce();
    expect(subscriptionAudit.read).toHaveBeenCalledWith(request);
    expect(response).toEqual(delegated);
    expect(subscriptionAudit.clear).toHaveBeenCalledOnce();
  });
});
