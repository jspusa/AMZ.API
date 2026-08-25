import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
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

async function startReadyReport(router: ApiRouter): Promise<{
  reportId: string;
  documentId: string;
}> {
  const response = await router.handle({
    requestId: crypto.randomUUID(),
    method: "POST",
    path: "/api/sp-api/listing-content/export",
    query: {},
    headers: {},
    body: {
      kind: "json",
      value: { marketplaceId: "ATVPDKIKX0DER" },
    },
  });
  if (response.status !== 200 || response.body.kind !== "json") {
    throw new Error("Expected a ready demo report");
  }
  const value = response.body.value as Record<string, unknown>;
  if (typeof value.reportId !== "string" || typeof value.documentId !== "string") {
    throw new Error("Expected opaque report document handles");
  }
  return { reportId: value.reportId, documentId: value.documentId };
}

describe("listing content quality audit route", () => {
  let router: ApiRouter;

  beforeEach(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    const directory = await mkdtemp(join(tmpdir(), "amz-content-quality-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "a".repeat(64),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
  });

  afterEach(() => {
    router.dispose();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("returns JSON for a ready FBA report when audit=1", async () => {
    const report = await startReadyReport(router);
    const response = await router.handle(
      request({
        marketplaceId: "ATVPDKIKX0DER",
        reportId: report.reportId,
        documentId: report.documentId,
        audit: "1",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    const value = response.body.value as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(
      ["marketplaceId", "fetchedAt", "exportId", "rows", "readErrors", "summary"].sort(),
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
      itemHighlight: expect.any(String),
      bulletPoints: expect.any(Array),
      productDescription: expect.any(String),
      ingredients: expect.any(String),
      readStatus: "complete",
      readErrors: expect.any(Array),
      issues: expect.any(Array),
      variationRole: expect.stringMatching(/^(child|standalone|unknown)$/u),
      variationFamilyKey: expect.any(String),
      relationshipStatus: expect.stringMatching(/^(complete|incomplete)$/u),
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
      singleIngredientMismatch: expect.any(Number),
      titleBelowTarget: expect.any(Number),
      highlightBelowTarget: expect.any(Number),
      bulletBelowTarget: expect.any(Number),
      bulletAboveTarget: expect.any(Number),
      descriptionBelowTarget: expect.any(Number),
    });
  });

  it("requires the ready report document identifier before auditing", async () => {
    const report = await startReadyReport(router);
    const response = await router.handle(
      request({
        marketplaceId: "ATVPDKIKX0DER",
        reportId: report.reportId,
        audit: "1",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    expect(response.body.value).toMatchObject({ code: "INVALID_INPUT" });
  });
});
