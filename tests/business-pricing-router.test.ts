import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import {
  getBusinessPricing,
  invalidateSpApiCredentialCaches,
  type BusinessPricePrecommitEvidence,
  type UpdateBusinessPriceInput,
} from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const SELLER_SKU = "AFA-TRKY-4OZ";
const IDEMPOTENCY_KEY = "business-pricing-test-001";
const savedMode = process.env.SP_API_MODE;

function request(
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: `business-pricing-${method.toLowerCase()}-001`,
    method,
    path: "/api/sp-api/business-pricing",
    query: method === "GET"
      ? { marketplaceId: MARKETPLACE_ID, sku: SELLER_SKU }
      : {},
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? { kind: "json", value: body } : undefined,
  };
}

describe("Amazon Business pricing routes", () => {
  const approveWrite = vi.fn(async (_reason: string) => undefined);
  const runIdempotentOperation = vi.fn(async (input: { operationType: string }) => ({
    mode: "demo",
    status: "SIMULATED",
    operationType: input.operationType,
    sellerSku: SELLER_SKU,
  }));
  const router = new ApiRouter({
    store: {
      runIdempotentOperation,
      reconcileIdempotentOperations: async () => [],
    } as unknown as LocalStore,
    vault: {
      getAccountScope: async () => "business-pricing-test-scope",
    } as unknown as CredentialVault,
    approveWrite,
  });

  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
    approveWrite.mockReset();
    approveWrite.mockResolvedValue(undefined);
    runIdempotentOperation.mockClear();
    router.clearPreviews();
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = savedMode;
    invalidateSpApiCredentialCaches();
  });

  async function writeBody(): Promise<Record<string, unknown>> {
    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    return {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: snapshot.standardPrice!.amount,
      expectedBusinessPrice: snapshot.businessPrice?.amount ?? null,
      newBusinessPrice: Number(
        (snapshot.standardPrice!.amount * 0.85).toFixed(2),
      ),
      idempotencyKey: IDEMPOTENCY_KEY,
    };
  }

  it("returns the exact FBA SKU business-price snapshot", async () => {
    const response = await router.handle(request("GET"));

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    expect(response.body.value).toMatchObject({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      businessOfferPresence: expect.stringMatching(/^(absent|present)$/),
      businessPricingCapability: {
        supported: true,
        editable: true,
      },
    });
  });

  it("requires an exact preview, native approval and business-price ledger", async () => {
    const body = await writeBody();
    expect((await router.handle(request("POST", body))).status).toBe(200);

    const commit = await router.handle(request("PATCH", body));

    expect(commit.status).toBe(200);
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(approveWrite.mock.calls[0]?.[0]).toContain(SELLER_SKU);
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
    expect(runIdempotentOperation.mock.calls[0]?.[0]).toMatchObject({
      operationType: "business_price",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
  });

  it("accepts only an explicit complete tier plan and shows it in native approval", async () => {
    const body = {
      ...await writeBody(),
      expectedQuantityDiscountPlanHash: null,
      quantityDiscountTiers: [
        { lowerBound: 5, percent: 5 },
        { lowerBound: 10, percent: 10 },
        { lowerBound: 15, percent: 15 },
        { lowerBound: 20, percent: 20 },
      ],
    };
    expect((await router.handle(request("POST", body))).status).toBe(200);
    expect((await router.handle(request("PATCH", body))).status).toBe(200);
    expect(approveWrite.mock.calls[0]?.[0]).toContain("5件=5%");
    expect(approveWrite.mock.calls[0]?.[0]).toContain("20件=20%");
    expect(runIdempotentOperation.mock.calls[0]?.[0]).toMatchObject({
      operationType: "business_price",
    });

    const incomplete = await router.handle(request("POST", {
      ...await writeBody(),
      quantityDiscountTiers: [{ lowerBound: 5, percent: 5 }],
    }));
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.kind).toBe("json");
    if (incomplete.body.kind !== "json") throw new Error("Expected JSON response");
    expect(incomplete.body.value).toMatchObject({
      code: "INVALID_QUANTITY_DISCOUNT",
    });
  });

  it("rejects changed or undeclared fields before native approval", async () => {
    const body = await writeBody();
    expect((await router.handle(request("POST", body))).status).toBe(200);

    const changed = await router.handle(request("PATCH", {
      ...body,
      newBusinessPrice: Number(body.newBusinessPrice) - 0.5,
    }));
    expect(changed.status).toBe(409);
    expect(changed.body.kind).toBe("json");
    if (changed.body.kind !== "json") throw new Error("Expected JSON response");
    expect(changed.body.value).toMatchObject({ code: "PREVIEW_CHANGED" });

    const smuggled = await router.handle(request("POST", {
      ...body,
      audience: "ALL",
    }));
    expect(smuggled.status).toBe(400);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });

  it("binds the preview ticket to every precommit evidence hash", () => {
    const fingerprint = (
      router as unknown as {
        businessPricingFingerprint: (
          input: UpdateBusinessPriceInput,
          evidence: BusinessPricePrecommitEvidence,
        ) => string;
      }
    ).businessPricingFingerprint.bind(router);
    const input: UpdateBusinessPriceInput = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27,
    };
    const evidence: BusinessPricePrecommitEvidence = {
      asin: "B012345678",
      productType: "PET_FOOD",
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      previousQuantityDiscountPlanHash: null,
      schemaChecksum: "seller-schema-checksum",
      fbaEvidenceHash: "b".repeat(64),
      canonicalPatchHash: "c".repeat(64),
      validationIssuesHash: "d".repeat(64),
    };
    const baseline = fingerprint(input, evidence);
    for (const field of [
      "businessOfferProtectedHash",
      "fbaEvidenceHash",
      "canonicalPatchHash",
      "validationIssuesHash",
    ] as const) {
      expect(fingerprint(input, { ...evidence, [field]: "f".repeat(64) }))
        .not.toBe(baseline);
    }
    const combined: UpdateBusinessPriceInput = {
      ...input,
      expectedQuantityDiscountPlanHash: null,
      quantityDiscountTiers: [{ lowerBound: 5, percent: 5 }],
    };
    expect(fingerprint(combined, evidence)).not.toBe(baseline);
    expect(fingerprint({
      ...combined,
      quantityDiscountTiers: [{ lowerBound: 6, percent: 5 }],
    }, evidence)).not.toBe(fingerprint(combined, evidence));
  });
});

describe("Amazon Business pricing audit routes", () => {
  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = savedMode;
    invalidateSpApiCredentialCaches();
  });

  it("starts the shared report then returns one FBA-only audit snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "business-pricing-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "business-pricing-audit-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const start = await router.handle({
      requestId: "business-pricing-audit-start-001",
      method: "POST",
      path: "/api/sp-api/business-pricing-audit",
      query: {},
      headers: { "content-type": "application/json" },
      body: { kind: "json", value: { marketplaceId: MARKETPLACE_ID } },
    });
    expect(start.status).toBe(200);
    expect(start.body.kind).toBe("json");
    if (start.body.kind !== "json") throw new Error("Expected JSON response");
    const report = start.body.value as { reportId: string; documentId: string };

    const data = await router.handle({
      requestId: "business-pricing-audit-data-001",
      method: "GET",
      path: "/api/sp-api/business-pricing-audit",
      query: {
        marketplaceId: MARKETPLACE_ID,
        reportId: report.reportId,
        documentId: report.documentId,
        data: "1",
      },
      headers: {},
    });

    expect(data.status).toBe(200);
    expect(data.body.kind).toBe("json");
    if (data.body.kind !== "json") throw new Error("Expected JSON response");
    expect(data.body.value).toMatchObject({
      mode: "demo",
      marketplaceId: MARKETPLACE_ID,
      summary: {
        totalFbaSkuCount: expect.any(Number),
        configured: expect.any(Number),
        missing: expect.any(Number),
        unsupported: 0,
        incomplete: 0,
      },
    });
    expect((data.body.value as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
  });
});
