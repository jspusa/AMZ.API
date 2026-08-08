import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const previousMode = process.env.SP_API_MODE;
const MARKETPLACE_ID = "ATVPDKIKX0DER";

function request(path: string): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path,
    query: { marketplaceId: MARKETPLACE_ID },
    headers: {},
  };
}

describe("advertising coverage route boundary", () => {
  const router = new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite: async () => undefined,
  });

  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("runs the naming and same-ASIN engine only in explicit demo mode", async () => {
    const status = await router.handle(request("/api/amazon-ads/status"));
    expect(status.body.kind).toBe("json");
    if (status.body.kind !== "json") throw new Error("Expected status JSON");
    expect(status.body.value).toMatchObject({
      configured: false,
      coverageAuditAvailable: true,
    });

    const coverage = await router.handle(request("/api/amazon-ads/coverage"));
    expect(coverage.status).toBe(200);
    expect(coverage.body.kind).toBe("json");
    if (coverage.body.kind !== "json") throw new Error("Expected coverage JSON");
    expect(coverage.body.value).toMatchObject({
      schemaVersion: 1,
      mode: "demo",
      marketplaceId: MARKETPLACE_ID,
      marketplaceCode: "US",
    });
  });

  it("never substitutes demo campaigns when Ads API is not connected", async () => {
    delete process.env.SP_API_MODE;
    const status = await router.handle(request("/api/amazon-ads/status"));
    if (status.body.kind !== "json") throw new Error("Expected status JSON");
    expect(status.body.value).toMatchObject({ coverageAuditAvailable: false });

    const coverage = await router.handle(request("/api/amazon-ads/coverage"));
    expect(coverage.status).toBe(422);
    expect(coverage.body.kind).toBe("json");
    if (coverage.body.kind !== "json") throw new Error("Expected problem JSON");
    expect(coverage.body.value).toMatchObject({ code: "ADS_API_NOT_CONNECTED" });
  });
});
