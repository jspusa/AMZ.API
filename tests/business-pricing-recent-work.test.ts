import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/main/local-store";
import { BusinessPricingRecentWork } from "../src/main/business-pricing-recent-work";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import { reconcileMinimumPriceWrite } from "../src/main/business-pricing-mutations";
import type { B2bRecentWorkSnapshot } from "../src/shared/b2b-recent-work";

const US = "ATVPDKIKX0DER" as const;
const CA = "A2EUQ1WTGCTBG2" as const;
const ACCOUNT = "recent-work-fixture-account";
const request = (query: Record<string, string> = { marketplaceId: US }): ApiRequest => ({
  requestId: "recent-work-request", method: "GET", path: "/api/sp-api/business-pricing/recent-work", query, headers: {},
});
function payload(response: ApiResponse): B2bRecentWorkSnapshot {
  expect(response.status).toBe(200);
  expect(response.body.kind).toBe("json");
  return (response.body as { value: B2bRecentWorkSnapshot }).value;
}
async function fixture() {
  const path = join(await mkdtemp(join(tmpdir(), "amz-recent-")), "store.json");
  const store = new LocalStore(path);
  await store.initialize();
  const context = createScriptedSpExecutionContextAdapter((marketplaceId) => ({ marketplaceId, accountScope: ACCOUNT, mode: "live" }));
  return { store, path, context, owner: new BusinessPricingRecentWork({ store, context }) };
}
async function unknown(store: LocalStore, sku: string, overrides: Record<string, unknown> = {}) {
  await expect(store.runIdempotentOperation({
    idempotencyKey: `key-${sku}`, operationType: "business_price", marketplaceId: US,
    sellerSku: sku, accountScope: ACCOUNT, fingerprint: `private-fingerprint-${sku}`,
    executionMode: "live",
    execute: async () => { throw new SpApiError("fixture timeout", { status: 503, code: "UPDATE_STATUS_UNKNOWN" }); },
    ...overrides,
  })).rejects.toThrow();
}
function minimumResult(sellerSku = "MINIMUM-SKU") {
  const evidence = {
    version: 1, marketplaceId: US, sellerSku, asin: "B012345678", productType: "PET_FOOD", fulfillment: "FBA",
    standardPrice: { amount: 19.99, currencyCode: "USD" },
    previousMinimumPrice: { amount: 18, currencyCode: "USD" },
    requestedMinimumPrice: { amount: 14.19, currencyCode: "USD" },
    lowestTierUnitPrice: { amount: 15.19, currencyCode: "USD" },
    previousBusinessPrice: { amount: 17.99, currencyCode: "USD" },
    previousQuantityDiscountPlan: null, previousQuantityDiscountPlanHash: null,
    minimumPriceProtectedHash: "7".repeat(64), minimumPriceCanonicalPatchHash: "8".repeat(64),
  };
  const { version: _version, fulfillment: _fulfillment, ...visible } = evidence;
  return { ...visible, mode: "live", status: "ACCEPTED", acceptedAt: new Date().toISOString(),
    submissionId: "fixture-minimum-submission", requestId: "fixture-minimum-request", issues: [],
    notice: "fixture minimum accepted", _minimumWriteEvidence: evidence };
}
async function saveMinimum(store: LocalStore, sellerSku: string, verified: boolean) {
  const result = minimumResult(sellerSku);
  const canonical = { mode: "live", marketplaceId: US, sellerSku, asin: result.asin, productType: result.productType,
    minimumPricePresence: "canonical", minimumPrice: result.requestedMinimumPrice,
    fulfillmentAvailability: [{ fulfillment: "FBA" }], issues: [] };
  const operation = store.runIdempotentOperation({
    idempotencyKey: `minimum-${sellerSku}`, operationType: "price", marketplaceId: US, sellerSku, accountScope: ACCOUNT, fingerprint: "private-minimum-fingerprint",
    execute: async ({ recordAccepted }) => {
      await recordAccepted(result);
      if (verified) return reconcileMinimumPriceWrite(result, canonical as never);
      throw new SpApiError("accepted pending", { status: 503, code: "UPDATE_STATUS_UNKNOWN" });
    },
  });
  if (verified) await operation;
  else await expect(operation).rejects.toThrow();
}

describe("bounded recent B2B observation", () => {
  it("restores current-account work after reopening without network, mutation, or ledger writes", async () => {
    const { store, path, context } = await fixture();
    await unknown(store, "UNKNOWN-SKU");
    await unknown(store, "OTHER-ACCOUNT", { accountScope: "different-account" });
    await unknown(store, "OTHER-MARKET", { marketplaceId: CA });
    await unknown(store, "ORDINARY-PRICE", { operationType: "price" });
    await saveMinimum(store, "ACCEPTED-MINIMUM", false);
    await saveMinimum(store, "VERIFIED-MINIMUM", true);
    const before = await readFile(path, "utf8");
    const reopened = new LocalStore(path);
    await reopened.initialize();
    const result = payload(await new BusinessPricingRecentWork({ store: reopened, context }).read(request()));
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sellerSku: "UNKNOWN-SKU", status: "UNKNOWN", acceptedAt: null, canResend: false, nextAction: "readback" }),
      expect.objectContaining({ sellerSku: "ACCEPTED-MINIMUM", status: "PROCESSING", canResend: false }),
      expect.objectContaining({ sellerSku: "VERIFIED-MINIMUM", status: "MINIMUM_VERIFIED", nextAction: "fresh_preview", canResend: false }),
    ]));
    expect(result.items).toHaveLength(3);
    expect(result.items.find((item) => item.status === "MINIMUM_VERIFIED")?.verifiedAt).toBeTruthy();
    expect(JSON.stringify(result)).not.toMatch(/account|fingerprint|ownerToken|_minimumWriteEvidence|submission|B012345678/);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("does not advertise a stale minimum-price next step once a newer B2B attempt exists", async () => {
    const { store, owner } = await fixture();
    await saveMinimum(store, "NEXT-STAGE", true);
    await unknown(store, "NEXT-STAGE");
    const result = payload(await owner.read(request()));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ sellerSku: "NEXT-STAGE", stage: "business_price", status: "UNKNOWN" });
  });

  it("never relabels a mismatched durable receipt as acceptance for the ledger SKU", async () => {
    const { store, owner } = await fixture();
    const response = minimumResult("RECEIPT-OTHER-SKU");
    await expect(store.runIdempotentOperation({
      idempotencyKey: "mismatched-receipt-key", operationType: "price", marketplaceId: US,
      sellerSku: "LEDGER-SKU", accountScope: ACCOUNT, executionMode: "live", fingerprint: "mismatch-fixture",
      execute: async ({ recordAccepted }) => {
        await recordAccepted(response);
        throw new SpApiError("fixture pending", { status: 503, code: "UPDATE_STATUS_UNKNOWN" });
      },
    })).rejects.toThrow();
    expect(payload(await owner.read(request())).items).toEqual([]);
    await unknown(store, "MALFORMED-B2B", {
      execute: async ({ recordAccepted }: { recordAccepted(value: unknown): Promise<void> }) => {
        await recordAccepted({ mode: "live", status: "ACCEPTED", sellerSku: "UNPROVEN-OTHER-SKU", private: "must-not-expose" });
        throw new SpApiError("fixture malformed", { status: 503, code: "UPDATE_STATUS_UNKNOWN" });
      },
    });
    const result = payload(await owner.read(request()));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ sellerSku: "MALFORMED-B2B", status: "UNKNOWN", acceptedAt: null });
    expect(JSON.stringify(result)).not.toContain("UNPROVEN-OTHER-SKU");
    expect(JSON.stringify(result)).not.toContain("must-not-expose");
  });

  it("caps output at thirty and does not turn missing receipts into acceptance", async () => {
    const { store, owner } = await fixture();
    for (let index = 0; index < 35; index += 1) await unknown(store, `UNKNOWN-${index}`);
    const result = payload(await owner.read(request()));
    expect(result.limit).toBe(30);
    expect(result.items).toHaveLength(30);
    expect(result.items.every((item) => item.status === "UNKNOWN" && item.acceptedAt === null && !item.canResend)).toBe(true);
  });

  it("rejects caller-selected scopes, limits, bodies and non-GET access before reading storage", async () => {
    const { store, owner } = await fixture();
    const read = vi.spyOn(store, "inspectRecentBusinessPricingOperations");
    for (const invalidRequest of [request({ marketplaceId: US, limit: "100" }), request({ marketplaceId: US, accountScope: ACCOUNT }),
      { ...request(), method: "POST" as const }, { ...request(), body: { kind: "json" as const, value: {} } }]) {
      expect((await owner.read(invalidRequest)).status).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("rechecks context after storage and exposes no live history in demo mode", async () => {
    const { store, context, owner } = await fixture();
    await unknown(store, "CONTEXT-SKU");
    const original = store.inspectRecentBusinessPricingOperations.bind(store);
    vi.spyOn(store, "inspectRecentBusinessPricingOperations").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      context.invalidate("lock-screen");
      return result;
    });
    expect((await owner.read(request())).status).toBe(409);
    const demo = createScriptedSpExecutionContextAdapter((marketplaceId) => ({ marketplaceId, accountScope: ACCOUNT, mode: "demo" }));
    expect(payload(await new BusinessPricingRecentWork({ store, context: demo }).read(request())).items).toEqual([]);
  });

  it("does not project demo or historical unknown-mode null receipts as live work", async () => {
    const { store, owner } = await fixture();
    await unknown(store, "LIVE-UNKNOWN");
    await unknown(store, "DEMO-UNKNOWN", { executionMode: "demo" });
    await unknown(store, "LEGACY-UNKNOWN", { executionMode: undefined });
    await saveMinimum(store, "LEGACY-PROVEN-LIVE", false);
    const result = payload(await owner.read(request()));
    expect(result.items.map((item) => item.sellerSku).sort()).toEqual(["LEGACY-PROVEN-LIVE", "LIVE-UNKNOWN"]);
  });

  it("applies live mode before the candidate bound so newer demo work cannot hide an outstanding live write", async () => {
    const { store, owner } = await fixture();
    await unknown(store, "LIVE-STILL-PENDING");
    for (let index = 0; index < 65; index += 1) {
      await unknown(store, `DEMO-${index}`, { executionMode: "demo" });
    }
    expect(payload(await owner.read(request())).items.map((item) => item.sellerSku)).toEqual(["LIVE-STILL-PENDING"]);
  });

  it("exposes exactly one GET route, with no native approval or mutation delegation", async () => {
    const { store, context } = await fixture();
    await unknown(store, "ROUTER-SKU");
    const approveWrite = vi.fn();
    const handle = vi.fn();
    const router = new ApiRouter({ store, vault: {} as CredentialVault, spExecutionContext: context, approveWrite, businessPricingMutations: { handle } });
    expect(payload(await router.handle(request())).items[0]?.sellerSku).toBe("ROUTER-SKU");
    expect((await router.handle({ ...request(), method: "PATCH" })).status).toBe(404);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });
});
