import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const SP_ENV_KEYS = Object.keys(process.env).filter((key) =>
  key.startsWith("SP_API_"),
);
const savedEnvironment = new Map(
  SP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function request(query: Record<string, string>): ApiRequest {
  return {
    requestId: "audit-test-001",
    method: "GET",
    path: "/api/sp-api/listing-content/export",
    query,
    headers: {},
  };
}

describe("listing content quality audit route", () => {
  const router = new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite: async () => undefined,
  });

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("returns JSON for a ready FBA report when audit=1", async () => {
    const response = await router.handle(
      request({
        marketplaceId: "ATVPDKIKX0DER",
        reportId: "demo-ATVPDKIKX0DER",
        documentId: "demo-ATVPDKIKX0DER",
        audit: "1",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    const value = response.body.value as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(
      ["marketplaceId", "fetchedAt", "rows", "readErrors", "summary"].sort(),
    );
    expect(value.marketplaceId).toBe("ATVPDKIKX0DER");
    expect(Array.isArray(value.rows)).toBe(true);
    const rows = value.rows as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      sellerSku: expect.any(String),
      asin: expect.any(String),
      productType: expect.any(String),
      title: expect.any(String),
      bulletPoints: expect.any(Array),
      ingredients: expect.any(String),
      readStatus: "complete",
      readErrors: expect.any(Array),
      issues: expect.any(Array),
    });
    expect(value.summary).toMatchObject({
      total: rows.length,
      completed: rows.length,
      incomplete: 0,
      withIssues: expect.any(Number),
      suspectedTypos: expect.any(Number),
      missingBullets: expect.any(Number),
      missingIngredients: expect.any(Number),
      ingredientsUnverified: expect.any(Number),
    });
  });

  it("requires the ready report document identifier before auditing", async () => {
    const response = await router.handle(
      request({
        marketplaceId: "ATVPDKIKX0DER",
        reportId: "demo-ATVPDKIKX0DER",
        audit: "1",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    expect(response.body.value).toMatchObject({ code: "INVALID_INPUT" });
  });
});
