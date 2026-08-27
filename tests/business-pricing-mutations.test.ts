import { describe, expect, it, vi } from "vitest";
import type {
  BusinessPriceValidationResult,
} from "../src/main/amazon/sp-api";
import {
  BusinessPricingMutations,
  type BusinessPricingMutationOperations,
} from "../src/main/business-pricing-mutations";
import type {
  MainWriteGatePort,
  WriteBinding,
} from "../src/main/write-gate";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const SELLER_SKU = "AFA-TRKY-4OZ";

function previewRequest(): ApiRequest {
  return {
    requestId: "w05-business-pricing-owner-preview-001",
    method: "POST",
    path: "/api/sp-api/business-pricing",
    query: {},
    headers: { "content-type": "application/json" },
    body: {
      kind: "json",
      value: {
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        expectedStandardPrice: 30,
        expectedBusinessPrice: 28,
        newBusinessPrice: 27,
        idempotencyKey: "w05-preview-identity-001",
      },
    },
  };
}

function validationResult(
  sellerSku: string,
  marketplaceId = MARKETPLACE_ID,
): BusinessPriceValidationResult {
  return {
    mode: "live",
    status: "VALID",
    marketplaceId,
    sellerSku,
    asin: "B012345678",
    productType: "PET_FOOD",
    standardPrice: { amount: 30, currencyCode: "USD" },
    previousBusinessPrice: { amount: 28, currencyCode: "USD" },
    requestedBusinessPrice: { amount: 27, currencyCode: "USD" },
    previousQuantityDiscountPlan: null,
    previousQuantityDiscountPlanHash: null,
    requestedQuantityDiscountPlan: null,
    quantityDiscountPlanChange: "preserve",
    businessOfferGuardHash: "a".repeat(64),
    businessOfferProtectedHash: "b".repeat(64),
    schemaChecksum: "seller-specific-checksum",
    fbaEvidenceHash: "c".repeat(64),
    canonicalPatchHash: "d".repeat(64),
    validationIssuesHash: "e".repeat(64),
    validatedAt: "2026-08-27T00:00:00.000Z",
    issues: [],
    notice: "fixture",
  };
}

describe("W05 Business Pricing mutation owner", () => {
  it.each([
    ["another SKU", validationResult("A-DIFFERENT-SKU")],
    [
      "another marketplace",
      validationResult(SELLER_SKU, "A1F83G8C2ARO7P"),
    ],
  ])("rejects a preview result for %s before staging a Business Price ticket", async (_scenario, mismatchedResult) => {
    const stagePreview = vi.fn(async (_binding: WriteBinding) => undefined);
    const execute = vi.fn(async () => {
      throw new Error("Write Gate execute must not run during preview");
    });
    const commit = vi.fn();
    const observeCanonical = vi.fn(async () => undefined);
    const operations = {
      read: vi.fn(),
      preview: vi.fn(async () => mismatchedResult),
      commit,
    } as unknown as BusinessPricingMutationOperations;
    const owner = new BusinessPricingMutations({
      context: {
        capture: async (marketplaceId) => ({
          marketplaceId,
          region: "na",
          mode: "live",
          accountScope: "opaque-w05-preview-identity" as never,
          generation: 0,
        }),
        assertCurrent: async () => undefined,
        invalidate: () => undefined,
      },
      writeGate: {
        stagePreview,
        execute,
        reconcile: async () => undefined,
        clearEphemeral: () => undefined,
      } as unknown as MainWriteGatePort,
      operations,
      priceObserver: { observeCanonical },
    });

    const response = await owner.handle({
      operation: "preview",
      request: previewRequest(),
    });

    expect(response.status).toBe(409);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    expect(response.body.value).toMatchObject({
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(stagePreview).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(observeCanonical).not.toHaveBeenCalled();
  });
});
