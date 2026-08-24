import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";
import type { MarketplaceId } from "../src/shared/marketplaces";

const US = "ATVPDKIKX0DER" as const;

describe("ApiRouter SP execution context", () => {
  it("binds a public route through the injected main-owned context adapter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sp-context-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const readContext = vi.fn((marketplaceId: MarketplaceId) => ({
      marketplaceId,
      mode: "demo" as const,
      accountScope: "opaque-scripted-account",
    }));
    const getAccountScope = vi.fn(async () => {
      throw new Error("legacy vault context path must not run");
    });
    const input = {
      store,
      vault: { getAccountScope } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(readContext),
    };
    const router = new ApiRouter(input);
    const request: ApiRequest = {
      requestId: crypto.randomUUID(),
      method: "POST",
      path: "/api/sp-api/audit-suite",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: US } },
    };

    const response = await router.handle(request);
    router.clearPreviews();

    expect(response.status).toBe(202);
    expect(readContext).toHaveBeenCalledOnce();
    expect(readContext).toHaveBeenCalledWith(US);
    expect(getAccountScope).not.toHaveBeenCalled();
  });

  it("invalidates the injected context and all router-bound runtime state together", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sp-context-invalidate-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const spExecutionContext = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: "opaque-scripted-account",
      }),
    );
    const invalidate = vi.spyOn(spExecutionContext, "invalidate");
    const router = new ApiRouter({
      store,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext,
    });
    const start: ApiRequest = {
      requestId: crypto.randomUUID(),
      method: "POST",
      path: "/api/sp-api/audit-suite",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: US } },
    };
    const started = await router.handle(start);
    if (started.body.kind !== "json") throw new Error("Expected JSON response");
    const identity = started.body.value as { runId: string; contextId: string };

    router.invalidateSpExecutionContext("lock-screen");
    const expired = await router.handle({
      requestId: crypto.randomUUID(),
      method: "GET",
      path: "/api/sp-api/audit-suite",
      query: {
        marketplaceId: US,
        runId: identity.runId,
        contextId: identity.contextId,
      },
      headers: {},
    });

    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith("lock-screen");
    expect(expired.status).toBe(410);
  });

  it("clears router state after reporting an out-of-band account transition once", async () => {
    const previousMode = process.env.SP_API_MODE;
    process.env.SP_API_MODE = "demo";
    try {
      const directory = await mkdtemp(join(tmpdir(), "sp-context-transition-"));
      const store = new LocalStore(join(directory, "data.json"));
      await store.initialize();
      let accountScope = "opaque-account-a";
      const router = new ApiRouter({
        store,
        vault: {
          getAccountScope: async () => accountScope,
        } as unknown as CredentialVault,
        approveWrite: async () => undefined,
      });
      const started = await router.handle({
        requestId: crypto.randomUUID(),
        method: "POST",
        path: "/api/sp-api/audit-suite",
        query: {},
        headers: {},
        body: { kind: "json", value: { marketplaceId: US } },
      });
      if (started.body.kind !== "json") throw new Error("Expected JSON response");
      const identity = started.body.value as { runId: string; contextId: string };
      const statusRequest = (): ApiRequest => ({
        requestId: crypto.randomUUID(),
        method: "GET",
        path: "/api/sp-api/audit-suite",
        query: { marketplaceId: US, ...identity },
        headers: {},
      });

      accountScope = "opaque-account-b";
      const changed = await router.handle(statusRequest());
      const expired = await router.handle(statusRequest());

      expect(changed.status).toBe(409);
      expect(changed.body.kind === "json" ? changed.body.value : null).toMatchObject({
        code: "ACCOUNT_SCOPE_CHANGED",
      });
      expect(expired.status).toBe(410);
    } finally {
      if (previousMode === undefined) delete process.env.SP_API_MODE;
      else process.env.SP_API_MODE = previousMode;
    }
  });
});
