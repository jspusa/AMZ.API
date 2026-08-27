import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { FixedReportBroker } from "../src/main/amazon/report-broker";
import {
  invalidateSpApiCredentialCaches,
  type BusinessPricePrecommitEvidence,
  type BusinessPriceValidationResult,
  type BusinessPricingListingSnapshot,
  type UpdateBusinessPriceInput,
} from "../src/main/amazon/sp-api";
import {
  BusinessPricingMutations,
} from "../src/main/business-pricing-mutations";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type {
  MainWriteGatePort,
  WriteBinding,
} from "../src/main/write-gate";
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
    router.dispose();
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = savedMode;
    invalidateSpApiCredentialCaches();
  });

  async function writeBody(): Promise<Record<string, unknown>> {
    const response = await router.handle(request("GET"));
    if (response.status !== 200 || response.body.kind !== "json") {
      throw new Error("Expected Business Pricing route snapshot");
    }
    const snapshot = response.body.value as BusinessPricingListingSnapshot;
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

  it("binds the preview ticket to every precommit evidence hash", async () => {
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
    const validation = (
      nextEvidence: BusinessPricePrecommitEvidence,
      proposal: UpdateBusinessPriceInput = input,
    ): BusinessPriceValidationResult => ({
      mode: "live",
      status: "VALID",
      marketplaceId: proposal.marketplaceId,
      sellerSku: proposal.sellerSku,
      ...nextEvidence,
      standardPrice: { amount: 30, currencyCode: "USD" },
      previousBusinessPrice: { amount: 28, currencyCode: "USD" },
      requestedBusinessPrice: {
        amount: proposal.newBusinessPrice,
        currencyCode: "USD",
      },
      previousQuantityDiscountPlan: null,
      requestedQuantityDiscountPlan: proposal.quantityDiscountTiers
        ? {
            discountType: "percent",
            levels: proposal.quantityDiscountTiers.map((tier) => ({
              lowerBound: tier.lowerBound,
              value: tier.percent,
            })),
          }
        : null,
      quantityDiscountPlanChange: proposal.quantityDiscountTiers
        ? "replace"
        : "preserve",
      validatedAt: "2026-08-27T00:00:00.000Z",
      issues: [],
      notice: "fixture",
    });
    let currentValidation = validation(evidence);
    const operations = {
      read: vi.fn(),
      preview: vi.fn(async () => currentValidation),
      commit: vi.fn(),
    };
    const stagePreview = vi.fn(async (_binding: WriteBinding) => undefined);
    const owner = new BusinessPricingMutations({
      context: {
        capture: async (marketplaceId) => ({
          marketplaceId,
          region: "na",
          mode: "live",
          accountScope: "business-pricing-fingerprint-scope" as never,
          generation: 0,
        }),
        assertCurrent: async () => undefined,
        invalidate: () => undefined,
      },
      writeGate: {
        stagePreview,
      } as unknown as MainWriteGatePort,
      operations,
      priceObserver: {
        observeCanonical: async () => undefined,
      },
    });
    const previewFingerprint = async (
      proposal: UpdateBusinessPriceInput,
    ): Promise<string> => {
      const response = await owner.handle({
        operation: "preview",
        request: request("POST", {
          ...proposal,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      });
      expect(response.status).toBe(200);
      const binding = stagePreview.mock.calls.at(-1)?.[0];
      const fingerprint = binding?.intents[0]?.proposalFingerprint;
      if (!fingerprint) throw new Error("Expected staged B2B fingerprint");
      return fingerprint;
    };
    const baseline = await previewFingerprint(input);
    for (const field of [
      "businessOfferProtectedHash",
      "fbaEvidenceHash",
      "canonicalPatchHash",
      "validationIssuesHash",
    ] as const) {
      currentValidation = validation({
        ...evidence,
        [field]: "f".repeat(64),
      });
      expect(await previewFingerprint(input)).not.toBe(baseline);
    }
    const combined: UpdateBusinessPriceInput = {
      ...input,
      expectedQuantityDiscountPlanHash: null,
      quantityDiscountTiers: [{ lowerBound: 5, percent: 5 }],
    };
    currentValidation = validation(evidence, combined);
    const combinedFingerprint = await previewFingerprint(combined);
    expect(combinedFingerprint).not.toBe(baseline);
    const changedCombined = {
      ...combined,
      quantityDiscountTiers: [{ lowerBound: 6, percent: 5 }],
    };
    currentValidation = validation(evidence, changedCombined);
    expect(await previewFingerprint(changedCombined))
      .not.toBe(combinedFingerprint);
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

  it("never creates an Active Listings report from a data GET with a missing or expired lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "business-pricing-get-only-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const now = Date.now();
    const allListingsLeaseId = "business-pricing-get-only-all-listings";
    await store.createSharedReportIfAbsent({
      leaseId: allListingsLeaseId,
      accountScope: "business-pricing-get-only-scope",
      marketplaceId: MARKETPLACE_ID,
      mode: "demo",
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      optionsKey: "preferredReportDocumentLocale=en_US",
      report: {
        reportId: `demo-${MARKETPLACE_ID}`,
        documentId: `demo-${MARKETPLACE_ID}`,
        status: "DONE",
        createdAt: now - 2_000,
        terminal: null,
        terminalAt: null,
      },
      createdAt: now - 2_000,
      updatedAt: now - 1_500,
      expiresAt: now + 60_000,
    }, now);
    const startActive = vi.fn(async () => ({
      mode: "demo" as const,
      ready: true,
      reportId: "must-not-start",
      documentId: "must-not-start",
      status: "DONE" as const,
      notice: "must not start",
    }));
    const statusActive = vi.fn(async () => ({
      mode: "demo" as const,
      ready: true,
      reportId: "must-not-poll",
      documentId: "must-not-poll",
      status: "DONE" as const,
      notice: "must not poll",
    }));
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "business-pricing-get-only-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      businessPricingActiveListingsReports: {
        start: startActive,
        status: statusActive,
      },
    });
    const reportBroker = (router as unknown as {
      reportBroker: FixedReportBroker;
    }).reportBroker;
    const allListings = await reportBroker.projectDurableLeg({
      intent: "all-listings",
      marketplaceId: MARKETPLACE_ID,
    });
    if (!allListings?.reportId || !allListings.documentId) {
      throw new Error("Expected broker-issued All Listings handles");
    }
    const reportId = allListings.reportId;
    const documentId = allListings.documentId;
    const dataRequest = (requestId: string): ApiRequest => ({
      requestId,
      method: "GET",
      path: "/api/sp-api/business-pricing-audit",
      query: {
        marketplaceId: MARKETPLACE_ID,
        reportId,
        documentId,
        data: "1",
      },
      headers: {},
    });

    const missingLease = await router.handle(dataRequest(
      "business-pricing-audit-data-no-active-lease",
    ));
    expect(missingLease.status).toBe(200);
    expect(startActive).not.toHaveBeenCalled();
    expect(statusActive).not.toHaveBeenCalled();

    await store.createSharedReportIfAbsent({
      leaseId: "expired-business-pricing-active-lease",
      accountScope: "business-pricing-get-only-scope",
      marketplaceId: MARKETPLACE_ID,
      mode: "demo",
      reportType: "GET_MERCHANT_LISTINGS_DATA",
      optionsKey: "preferredReportDocumentLocale=en_US",
      report: {
        reportId: "expired-active-report",
        documentId: "expired-active-document",
        status: "DONE",
        createdAt: now - 2_000,
        terminal: null,
        terminalAt: null,
      },
      createdAt: now - 2_000,
      updatedAt: now - 1_500,
      expiresAt: now - 1_000,
    }, now - 2_000);

    const expiredLease = await router.handle(dataRequest(
      "business-pricing-audit-data-expired-active-lease",
    ));
    expect(expiredLease.status).toBe(200);
    expect(startActive).not.toHaveBeenCalled();
    expect(statusActive).not.toHaveBeenCalled();
    expect(expiredLease.body.kind).toBe("json");
    if (expiredLease.body.kind !== "json") {
      throw new Error("Expected JSON response");
    }
    expect((expiredLease.body.value as { rows: Array<{ editable: boolean }> })
      .rows.every((row) => row.editable === false)).toBe(true);
  });

  it("persists an unknown Active Listings create and does not blind-retry it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "business-pricing-unknown-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const startActive = vi.fn(async () => {
      throw new Error("connection ended after Active Listings create");
    });
    const makeRouter = () => new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "business-pricing-unknown-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      businessPricingActiveListingsReports: { start: startActive },
    });
    const startRequest = (requestId: string): ApiRequest => ({
      requestId,
      method: "POST",
      path: "/api/sp-api/business-pricing-audit",
      query: {},
      headers: { "content-type": "application/json" },
      body: { kind: "json", value: { marketplaceId: MARKETPLACE_ID } },
    });

    const firstRouter = makeRouter();
    const concurrent = await Promise.all([
      firstRouter.handle(startRequest(
        "business-pricing-active-create-unknown-1",
      )),
      firstRouter.handle(startRequest(
        "business-pricing-active-create-unknown-concurrent",
      )),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
    expect(startActive).toHaveBeenCalledOnce();
    await expect(store.getSharedReport({
      accountScope: "business-pricing-unknown-scope",
      marketplaceId: MARKETPLACE_ID,
      reportType: "GET_MERCHANT_LISTINGS_DATA",
      optionsKey: "preferredReportDocumentLocale=en_US",
    })).resolves.toMatchObject({
      report: {
        reportId: null,
        documentId: null,
        status: "CREATION_UNKNOWN",
        terminal: "CREATION_UNKNOWN",
      },
    });

    expect((await makeRouter().handle(startRequest(
      "business-pricing-active-create-unknown-after-restart",
    ))).status).toBe(200);
    expect(startActive).toHaveBeenCalledOnce();
  });
});
