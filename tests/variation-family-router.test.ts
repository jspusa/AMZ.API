import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { invalidateSpApiCredentialCaches } from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const previousMode = process.env.SP_API_MODE;

function request(
  method: ApiRequest["method"] = "GET",
  query: Record<string, string> = {
    marketplaceId: "ATVPDKIKX0DER",
    sku: "AFA-TRKY-4OZ",
  },
): ApiRequest {
  return {
    requestId: `variation-${method.toLowerCase()}-001`,
    method,
    path: "/api/sp-api/variation-family",
    query,
    headers: {},
  };
}

describe("variation family read-only route", () => {
  const router = new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite: async () => undefined,
  });

  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
    invalidateSpApiCredentialCaches();
  });

  it("returns a non-writable FBA family snapshot", async () => {
    const response = await router.handle(request());

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    const value = response.body.value as Record<string, unknown>;
    expect(value).toMatchObject({
      mode: "demo",
      marketplaceId: "ATVPDKIKX0DER",
      queriedSku: "AFA-TRKY-4OZ",
      queriedRole: "child",
      writable: false,
      familyComplete: true,
    });
    expect(value.parent).toMatchObject({
      role: "parent",
      fba: false,
    });
    expect(value.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "child", fba: true }),
      ]),
    );
    expect((value.boundaries as string[]).join(" ")).toContain("非原子");
    expect((value.boundaries as string[]).join(" ")).toContain("不執行");
  });

  it("fails closed when marketplace or Seller SKU is missing", async () => {
    const response = await router.handle(
      request("GET", { marketplaceId: "ATVPDKIKX0DER" }),
    );

    expect(response.status).toBe(400);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    expect(response.body.value).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not expose a mutation route for the planner", async () => {
    const response = await router.handle(request("PATCH"));

    expect(response.status).toBe(404);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    expect(response.body.value).toMatchObject({ code: "NOT_FOUND" });
  });
});
