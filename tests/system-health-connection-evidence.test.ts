import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, CredentialSummary } from "../src/shared/contracts";

const savedEnvironment = new Map(
  Object.entries(process.env).filter(([key]) => key.startsWith("SP_API_")),
);

const summary: CredentialSummary = {
  encryptionAvailable: true,
  hasVault: true,
  lwaConfigured: true,
  regions: {
    na: { configured: true, refreshTokenHint: "set", sellerIdHint: "set" },
    eu: { configured: false, refreshTokenHint: null, sellerIdHint: null },
    fe: { configured: false, refreshTokenHint: null, sellerIdHint: null },
  },
  imageStorageConfigured: false,
  imagePublicBaseUrl: null,
  replenishmentSkillConfigured: false,
  updatedAt: "2026-08-09T00:00:00.000Z",
};

function request(): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path: "/api/system/health",
    query: { marketplaceId: "ATVPDKIKX0DER" },
    headers: {},
  };
}

describe("system health connection evidence", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "test-client";
    process.env.SP_API_LWA_CLIENT_SECRET = "test-secret";
    process.env.SP_API_REFRESH_TOKEN_NA = "test-refresh";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("reports configured credentials without claiming a live Amazon verification", async () => {
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {
        getSummary: async () => summary,
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });

    const response = await router.handle(request());
    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected health JSON");

    const payload = response.body.value as {
      mode: string;
      checks: Array<{ id: string; label: string; detail: string }>;
      notice: string;
    };
    const spApi = payload.checks.find((item) => item.id === "sp-api");

    expect(payload.mode).toBe("live");
    expect(spApi?.label).toBe("Amazon SP-API 憑證設定");
    expect(spApi?.detail).toContain("只核對本機設定");
    expect(spApi?.detail).toContain("未代表即時驗證 Amazon 連線");
    expect(payload.notice).toContain("未代表即時驗證 Amazon 連線");
  });
});
