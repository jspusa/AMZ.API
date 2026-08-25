import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER";
const previousMode = process.env.SP_API_MODE;

function request(
  method: "GET" | "POST",
  input: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path: "/api/sp-api/standalone-audit",
    query: method === "GET" ? input as Record<string, string> : {},
    headers: {},
    ...(method === "POST"
      ? { body: { kind: "json" as const, value: input } }
      : {}),
  };
}

function payload(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON");
  return response.body.value as Record<string, unknown>;
}

async function terminal(
  router: ApiRouter,
  receipt: Record<string, unknown>,
): Promise<ApiResponse> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await router.handle(request("GET", {
      marketplaceId: String(receipt.marketplaceId),
      mode: String(receipt.mode),
      kind: String(receipt.kind),
      jobId: String(receipt.jobId),
      contextId: String(receipt.contextId),
    }));
    if (response.status !== 202) return response;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Standalone audit did not finish");
}

describe("main-owned standalone audit route", () => {
  let router: ApiRouter;
  let accountScope: string;

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    accountScope = "standalone-account-one";
    const directory = await mkdtemp(join(tmpdir(), "standalone-audit-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => accountScope,
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      standaloneAudit: {
        run: async ({ kind, options, context, updateProgress }) => {
          updateProgress({
            stage: "complete",
            message: `${kind} 完成`,
            completedUnits: 1,
            totalUnits: 1,
          });
          if (kind === "businessPricing") {
            return {
              kind,
              mode: context.mode,
              marketplaceId: context.marketplaceId,
              fetchedAt: "2026-08-23T10:00:00.000Z",
              rows: [{
                sellerSku: "MAIN-SNAPSHOT-SKU",
                asin: "B000000001",
                title: "Main-owned B2B snapshot",
                productType: "PET_FOOD",
                standardPrice: { amount: 20, currencyCode: "USD" },
                businessPrice: { amount: 17.5, currencyCode: "USD" },
                businessOfferPresence: "present",
                quantityDiscountPlan: null,
                quantityDiscountPlanPresence: "absent",
                recommendedPriceMismatch: true,
                recommendedQuantityDiscountMismatch: true,
                status: "configured",
                editable: false,
                reason: "Main process evidence.",
              }],
              summary: {
                totalFbaSkuCount: 1,
                configured: 1,
                aboveStandard: 0,
                missing: 0,
                unsupported: 0,
                incomplete: 0,
                recommendedPriceMismatch: 1,
                recommendedQuantityDiscountMismatch: 1,
              },
              notice: "Main-owned fixture.",
            };
          }
          return {
            kind,
            marketplaceId: context.marketplaceId,
            months: options.months ?? null,
            rows: [],
          };
        },
      },
    });
  });

  afterEach(() => {
    router?.dispose();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("owns every non-review and non-A+ individual audit including final B2B enrichment", async () => {
    const selections = [
      { kind: "content" },
      { kind: "image" },
      { kind: "variation" },
      { kind: "subscription", options: { months: 23 } },
      { kind: "businessPricing" },
      { kind: "advertising" },
      { kind: "agedInventory" },
    ];
    for (const selection of selections) {
      const started = await router.handle(request("POST", {
        ...selection,
        marketplaceId: US,
        mode: "demo",
      }));
      expect(started.status).toBe(202);
      const completed = await terminal(router, payload(started));
      expect(completed.status).toBe(200);
      expect(payload(completed)).toMatchObject({
        kind: selection.kind,
        marketplaceId: US,
        mode: "demo",
        ready: true,
        status: "completed",
        snapshot: {
          kind: selection.kind,
          marketplaceId: US,
          rows: selection.kind === "businessPricing"
            ? [expect.objectContaining({ sellerSku: "MAIN-SNAPSHOT-SKU" })]
            : [],
        },
      });
      expect(JSON.stringify(payload(completed))).not.toContain(accountScope);
    }
  });

  it("keeps Amazon report and document identifiers out of the completed aged-inventory snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "standalone-aged-runtime-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const runtimeRouter = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "standalone-aged-account",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });

    try {
      const started = await runtimeRouter.handle(request("POST", {
        kind: "agedInventory",
        marketplaceId: US,
        mode: "demo",
      }));
      expect(started.status).toBe(202);

      const completed = await terminal(runtimeRouter, payload(started));
      expect(completed.status).toBe(200);
      const receipt = payload(completed);
      expect(receipt).toMatchObject({
        kind: "agedInventory",
        marketplaceId: US,
        mode: "demo",
        ready: true,
        status: "completed",
        snapshot: {
          marketplaceId: US,
          rows: expect.any(Array),
        },
      });
      expect(JSON.stringify(receipt.snapshot)).not.toMatch(
        /reportId|documentId|signedUrl|amazonaws\.com|cloudfront\.net/u,
      );
    } finally {
      runtimeRouter.dispose();
    }
  });

  it("rejects renderer account injection and invalidates a job after account drift", async () => {
    const injected = await router.handle(request("POST", {
      kind: "content",
      marketplaceId: US,
      mode: "demo",
      accountScope: "renderer-supplied",
    }));
    expect(injected.status).toBe(400);

    const started = await router.handle(request("POST", {
      kind: "content",
      marketplaceId: US,
      mode: "demo",
    }));
    accountScope = "standalone-account-two";
    const changed = await router.handle(request("GET", {
      marketplaceId: US,
      mode: "demo",
      kind: "content",
      jobId: String(payload(started).jobId),
      contextId: String(payload(started).contextId),
    }));
    expect(changed.status).toBe(409);
    expect(payload(changed)).toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
  });

  it("exports B2B Excel only from the main-owned completed job snapshot", async () => {
    const started = await router.handle(request("POST", {
      kind: "businessPricing",
      marketplaceId: US,
      mode: "demo",
    }));
    const pendingReceipt = payload(started);
    const pendingExport = await router.handle({
      requestId: crypto.randomUUID(),
      method: "GET",
      path: "/api/sp-api/business-pricing-audit/export",
      query: {
        marketplaceId: US,
        mode: "demo",
        jobId: String(pendingReceipt.jobId),
        contextId: String(pendingReceipt.contextId),
      },
      headers: {},
    });
    expect(pendingExport.status).toBe(409);
    expect(payload(pendingExport)).toMatchObject({ code: "SNAPSHOT_NOT_READY" });

    const completed = await terminal(router, payload(started));
    const receipt = payload(completed);
    const staleContextExport = await router.handle({
      requestId: crypto.randomUUID(),
      method: "GET",
      path: "/api/sp-api/business-pricing-audit/export",
      query: {
        marketplaceId: US,
        mode: "demo",
        jobId: String(receipt.jobId),
        contextId: crypto.randomUUID(),
      },
      headers: {},
    });
    expect(staleContextExport.status).toBe(410);
    expect(payload(staleContextExport)).toMatchObject({
      code: "STANDALONE_AUDIT_JOB_EXPIRED",
    });

    const exported = await router.handle({
      requestId: crypto.randomUUID(),
      method: "GET",
      path: "/api/sp-api/business-pricing-audit/export",
      query: {
        marketplaceId: US,
        mode: "demo",
        jobId: String(receipt.jobId),
        contextId: String(receipt.contextId),
        rows: "INJECTED-RENDERER-ROW",
      },
      headers: {},
    });

    expect(exported.status).toBe(200);
    expect(exported.body.kind).toBe("bytes");
    if (exported.body.kind !== "bytes") throw new Error("Expected XLSX bytes");
    const archive = unzipSync(exported.body.value);
    const content = Object.values(archive)
      .map((value) => strFromU8(value))
      .join("\n");
    expect(content).toContain("MAIN-SNAPSHOT-SKU");
    expect(content).not.toContain("INJECTED-RENDERER-ROW");
    expect(exported.headers["x-b2b-price-mismatch-count"]).toBe("1");
    expect(exported.headers["x-b2b-tier-mismatch-count"]).toBe("1");

    accountScope = "standalone-account-two";
    const changedAccountExport = await router.handle({
      requestId: crypto.randomUUID(),
      method: "GET",
      path: "/api/sp-api/business-pricing-audit/export",
      query: {
        marketplaceId: US,
        mode: "demo",
        jobId: String(receipt.jobId),
        contextId: String(receipt.contextId),
      },
      headers: {},
    });
    expect(changedAccountExport.status).toBe(409);
    expect(payload(changedAccountExport)).toMatchObject({
      code: "ACCOUNT_SCOPE_CHANGED",
    });
  });

  it("delegates variation and B2B standalone assembly to their extracted owners", () => {
    const source = readFileSync(
      new URL("../src/main/api-router.ts", import.meta.url),
      "utf8",
    );
    const variationStart = source.indexOf('if (input.kind === "variation")');
    const businessPricingStart = source.indexOf(
      'if (input.kind === "businessPricing")',
      variationStart,
    );
    const advertisingStart = source.indexOf(
      'if (input.kind === "advertising")',
      businessPricingStart,
    );
    const variationBranch = source.slice(variationStart, businessPricingStart);
    const businessPricingBranch = source.slice(
      businessPricingStart,
      advertisingStart,
    );

    expect(variationStart).toBeGreaterThan(-1);
    expect(businessPricingStart).toBeGreaterThan(variationStart);
    expect(advertisingStart).toBeGreaterThan(businessPricingStart);
    expect(variationBranch).toContain(
      "this.unboundVariationAuditOwner.runStandalone({",
    );
    expect(variationBranch).not.toContain("standaloneListingReport(");
    expect(variationBranch).not.toContain("getSharedUnboundVariationAuditData(");
    expect(businessPricingBranch).toContain(
      "this.businessPricingAuditOwner.runStandalone(input)",
    );
    expect(businessPricingBranch).not.toContain("standaloneListingReport(");
    expect(businessPricingBranch).not.toContain("getSharedBusinessPricingAuditData(");
  });
});
