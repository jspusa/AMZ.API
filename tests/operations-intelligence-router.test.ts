import { describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

describe("operations intelligence exact public routes", () => {
  it("exposes an unsynchronized local center, rejects arbitrary transport and enables no Amazon writes", async () => {
    const router = new ApiRouter({ store: {} as LocalStore, vault: {} as CredentialVault, approveWrite: async () => { throw new Error("No write approval expected"); },
      spExecutionContext: createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: "ATVPDKIKX0DER", mode: "live", accountScope: "test-account" })),
    });
    const request: ApiRequest = { requestId: crypto.randomUUID(), method: "GET", path: "/api/operations-intelligence", query: { marketplaceId: "ATVPDKIKX0DER" }, headers: {} };
    try {
      const response = await router.handle(request);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ kind: "json", value: { schemaVersion: 1, autoSync: false, sources: { promotions: { status: "never" }, awd: { status: "never" }, "price-health": { status: "never" }, advertising: { status: "never" } }, events: [] } });
      expect((await router.handle({ ...request, method: "POST", path: "/api/operations-intelligence/sync", query: {}, body: { kind: "json", value: { marketplaceId: "ATVPDKIKX0DER", source: "all", url: "https://example.com" } } })).status).toBe(400);
      expect((await router.handle({ ...request, method: "PATCH" })).status).toBe(404);
    } finally { router.dispose(); }
  });
});
