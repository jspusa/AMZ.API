import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  BusinessPricingListingSnapshot,
} from "../src/main/amazon/business-pricing-types";
import type {
  BusinessPricePatch,
  BusinessPricingGateway,
  BusinessPricingGatewayReply,
} from "../src/main/amazon/business-pricing-gateway";
import type { ListingWriteExecutionFence } from
  "../src/main/amazon/listing-write-execution-fence";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import {
  createBusinessPricingMutations,
  type BusinessPricingMutationsPort,
} from "../src/main/business-pricing-mutations";
import { LocalStore } from "../src/main/local-store";
import type {
  MainWriteGatePort,
  WriteBinding,
} from "../src/main/write-gate";
import { MainWriteGate } from "../src/main/write-gate";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

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

function mutationRequest(
  method: "POST" | "PATCH",
  idempotencyKey: string,
): ApiRequest {
  return {
    ...previewRequest(),
    requestId: `w05-business-pricing-${method}-${idempotencyKey}`,
    method,
    body: {
      kind: "json",
      value: {
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        expectedStandardPrice: 30,
        expectedBusinessPrice: 28,
        newBusinessPrice: 27,
        idempotencyKey,
      },
    },
  };
}

function readRequest(): ApiRequest {
  return {
    requestId: "w05-business-pricing-read-after-restart",
    method: "GET",
    path: "/api/sp-api/business-pricing",
    query: { marketplaceId: MARKETPLACE_ID, sku: SELLER_SKU },
    headers: {},
  };
}

function bodyValue(response: ApiResponse): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (
    response.body.kind !== "json" ||
    typeof response.body.value !== "object" ||
    response.body.value === null ||
    Array.isArray(response.body.value)
  ) {
    throw new Error("Expected JSON object response.");
  }
  return response.body.value as Record<string, unknown>;
}

function businessPricingSnapshot(
  businessPriceAmount = 28,
): BusinessPricingListingSnapshot {
  return {
    mode: "live",
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SELLER_SKU,
    asin: "B012345678",
    title: "W05 durable dispatch fixture",
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    standardPrice: { amount: 30, currencyCode: "USD" },
    effectivePrice: { amount: 30, currencyCode: "USD" },
    minimumPrice: null,
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice: null,
    discountedPricePresence: "absent",
    hasDiscountedPrice: false,
    hasAutomatedPricing: false,
    fetchedAt: "2026-08-27T00:00:00.000Z",
    requestId: "REQ-W05-READ",
    issues: [],
    fulfillmentAvailability: [{
      channelCode: "AMAZON_NA",
      quantity: 10,
      fulfillment: "FBA",
      editable: false,
    }],
    notice: null,
    businessPrice: { amount: businessPriceAmount, currencyCode: "USD" },
    businessOfferPresence: "present",
    businessPricingManagedByAutomation: false,
    quantityDiscountPlan: null,
    quantityDiscountPlanPresence: "absent",
    quantityDiscountPlanHash: null,
    businessOfferGuardHash: "a".repeat(64),
    businessOfferProtectedHash: "b".repeat(64),
    businessPricingCapability: {
      supported: true,
      editable: true,
      reason: null,
      quantityDiscountsSupported: true,
      quantityDiscountsEditable: true,
      quantityDiscountsReason: null,
      schemaChecksum: "seller-specific-checksum",
    },
  };
}

class DurableDispatchGateway implements BusinessPricingGateway {
  businessPriceAmount = 28;
  commitCalls = 0;
  durableBeforeTransport = false;

  constructor(
    private readonly storePath: string,
    private readonly idempotencyKey: string,
    private readonly failAfterDispatch = true,
  ) {}

  mode(): "live" {
    return "live";
  }

  async read(): Promise<BusinessPricingListingSnapshot> {
    return businessPricingSnapshot(this.businessPriceAmount);
  }

  quantityDiscountPlanSupported(): boolean {
    return true;
  }

  async validationPreview(): Promise<BusinessPricingGatewayReply> {
    return {
      ok: true,
      status: 200,
      requestId: "REQ-W05-PREVIEW",
      retryAfter: null,
      payload: {
        sku: SELLER_SKU,
        status: "VALID",
        submissionId: "W05-PREVIEW-SUBMISSION",
        issues: [],
        identifiers: [{
          marketplaceId: MARKETPLACE_ID,
          asin: "B012345678",
        }],
      },
    };
  }

  async commitOnce(
    _patch: BusinessPricePatch,
    fence: ListingWriteExecutionFence,
    recordDispatch: () => Promise<void>,
  ): Promise<BusinessPricingGatewayReply> {
    await fence.assertCurrent();
    await recordDispatch();
    const stored = JSON.parse(await readFile(this.storePath, "utf8")) as {
      ledger: Record<string, {
        state: string;
        response: Record<string, unknown> | null;
      }>;
    };
    const durable = stored.ledger[this.idempotencyKey];
    this.durableBeforeTransport = durable?.state === "pending" &&
      durable.response?.status === "DISPATCHED" &&
      typeof durable.response?._writeEvidence === "object";
    this.commitCalls += 1;
    if (this.failAfterDispatch) {
      throw new Error("simulated transport close after dispatch");
    }
    this.businessPriceAmount = 27;
    return {
      ok: true,
      status: 202,
      requestId: "REQ-W05-COMMIT",
      retryAfter: null,
      payload: {
        sku: SELLER_SKU,
        status: "ACCEPTED",
        submissionId: "W05-COMMIT-SUBMISSION",
        issues: [],
      },
    };
  }

  async replaceDemoContribution(): Promise<void> {
    throw new Error("Demo mutation must not run in this live test.");
  }
}

async function durableHarness(
  gateway: DurableDispatchGateway,
  storePath: string,
): Promise<BusinessPricingMutationsPort> {
  const store = new LocalStore(storePath);
  await store.initialize();
  const context = createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: MARKETPLACE_ID,
    mode: "live",
    accountScope: "w05-durable-account",
  }));
  return createBusinessPricingMutations({
    context,
    writeGate: new MainWriteGate({
      store,
      context,
      approveWrite: async () => undefined,
    }),
    gateway,
    priceObserver: { observeCanonical: async () => undefined },
  });
}

describe("W05 Business Pricing mutation owner", () => {
  it("keeps durable write evidence in the ledger but out of the public response", async () => {
    const idempotencyKey = "w05-private-durable-evidence";
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w05-business-price-")),
      "store.json",
    );
    const gateway = new DurableDispatchGateway(
      storePath,
      idempotencyKey,
      false,
    );
    const owner = await durableHarness(gateway, storePath);

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", idempotencyKey),
    })).status).toBe(200);
    const committed = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });

    expect(committed.status).toBe(200);
    expect(JSON.stringify(bodyValue(committed))).not.toContain("_writeEvidence");
    expect(gateway.durableBeforeTransport).toBe(true);
    expect(gateway.commitCalls).toBe(1);

    const stored = JSON.parse(await readFile(storePath, "utf8")) as {
      ledger: Record<string, {
        state: string;
        response: Record<string, unknown> | null;
      }>;
    };
    expect(stored.ledger[idempotencyKey]?.state).toBe("completed");
    expect(stored.ledger[idempotencyKey]?.response).toHaveProperty(
      "_writeEvidence",
    );
  });

  it("persists dispatch evidence before transport and reconciles it after restart without a second PATCH", async () => {
    const idempotencyKey = "w05-durable-before-transport";
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w05-business-price-")),
      "store.json",
    );
    const gateway = new DurableDispatchGateway(storePath, idempotencyKey);
    const owner = await durableHarness(gateway, storePath);

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", idempotencyKey),
    })).status).toBe(200);
    const uncertain = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });

    expect(uncertain.status).toBe(503);
    expect(bodyValue(uncertain)).toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(gateway.durableBeforeTransport).toBe(true);
    expect(gateway.commitCalls).toBe(1);

    const unknownStore = JSON.parse(await readFile(storePath, "utf8")) as {
      ledger: Record<string, {
        state: string;
        response: Record<string, unknown> | null;
      }>;
    };
    expect(unknownStore.ledger[idempotencyKey]).toMatchObject({
      state: "unknown",
      response: {
        status: "DISPATCHED",
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
      },
    });

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", idempotencyKey),
    })).status).toBe(200);
    const blockedReplay = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });
    expect(blockedReplay.status).toBe(409);
    expect(bodyValue(blockedReplay)).toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(gateway.commitCalls).toBe(1);

    gateway.businessPriceAmount = 27;
    const restarted = await durableHarness(gateway, storePath);
    expect((await restarted.handle({
      operation: "read",
      request: readRequest(),
    })).status).toBe(200);

    const reconciledStore = JSON.parse(await readFile(storePath, "utf8")) as {
      ledger: Record<string, { state: string }>;
    };
    expect(reconciledStore.ledger[idempotencyKey]?.state).toBe("completed");
    expect(gateway.commitCalls).toBe(1);
  });

  it.each([
    ["another SKU", { sellerSku: "A-DIFFERENT-SKU" }],
    [
      "another marketplace",
      { marketplaceId: "A1F83G8C2ARO7P" as const },
    ],
    [
      "another execution mode",
      { mode: "demo" as const },
    ],
  ])("rejects a preview result for %s before staging a Business Price ticket", async (_scenario, snapshotPatch) => {
    const stagePreview = vi.fn(async (_binding: WriteBinding) => undefined);
    const execute = vi.fn(async () => {
      throw new Error("Write Gate execute must not run during preview");
    });
    const commitOnce = vi.fn();
    const observeCanonical = vi.fn(async () => undefined);
    const snapshot = {
      ...businessPricingSnapshot(),
      ...snapshotPatch,
    };
    const gateway: BusinessPricingGateway = {
      mode: () => snapshot.mode,
      read: async () => snapshot,
      quantityDiscountPlanSupported: () => true,
      validationPreview: async () => {
        throw new Error("Validation Preview must not run for this fixture");
      },
      commitOnce,
      replaceDemoContribution: async () => undefined,
    };
    const owner = createBusinessPricingMutations({
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
      gateway,
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
    expect(commitOnce).not.toHaveBeenCalled();
    expect(observeCanonical).not.toHaveBeenCalled();
  });
});
