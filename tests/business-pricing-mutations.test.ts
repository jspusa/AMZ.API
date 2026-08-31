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
import { canonicalSha256 } from
  "../src/main/amazon/listing-item-projection";
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

const unsupportedMinimumPriceGateway = {
  mintMinimumPricePatch: () => null,
  minimumPriceProtectedHash: () => null,
  finalStateValidationPreview: async () => {
    throw new Error("minimum-price final preview is not expected");
  },
  minimumPriceValidationPreview: async () => {
    throw new Error("minimum-price preview is not expected");
  },
  commitMinimumPriceOnce: async () => {
    throw new Error("minimum-price commit is not expected");
  },
  replaceDemoMinimumPrice: async () => undefined,
} satisfies Pick<
  BusinessPricingGateway,
  | "mintMinimumPricePatch"
  | "minimumPriceProtectedHash"
  | "finalStateValidationPreview"
  | "minimumPriceValidationPreview"
  | "commitMinimumPriceOnce"
  | "replaceDemoMinimumPrice"
>;

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
    minimumPricePresence: "absent",
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
  readCalls = 0;
  durableBeforeTransport = false;

  constructor(
    private readonly storePath: string,
    private readonly idempotencyKey: string,
    private readonly failAfterDispatch = true,
    private readonly delayCanonicalVisibility = false,
  ) {}

  mode(): "live" {
    return "live";
  }

  async read(): Promise<BusinessPricingListingSnapshot> {
    this.readCalls += 1;
    return businessPricingSnapshot(this.businessPriceAmount);
  }

  quantityDiscountPlanSupported(): boolean {
    return true;
  }

  mintMinimumPricePatch() {
    return null;
  }

  minimumPriceProtectedHash() {
    return null;
  }

  async finalStateValidationPreview(): Promise<never> {
    throw new Error("minimum-price final preview is not expected");
  }

  async minimumPriceValidationPreview(): Promise<never> {
    throw new Error("minimum-price preview is not expected");
  }

  async commitMinimumPriceOnce(): Promise<never> {
    throw new Error("minimum-price commit is not expected");
  }

  async replaceDemoMinimumPrice(): Promise<void> {}

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
    if (!this.delayCanonicalVisibility) this.businessPriceAmount = 27;
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

    expect(committed.status).toBe(202);
    expect(bodyValue(committed)).toMatchObject({
      status: "PROCESSING",
      stage: "business_price",
      requestId: "REQ-W05-COMMIT",
      verified: false,
      canResend: false,
    });
    expect(JSON.stringify(bodyValue(committed))).not.toContain("_writeEvidence");
    expect(gateway.durableBeforeTransport).toBe(true);
    expect(gateway.commitCalls).toBe(1);
    expect(gateway.readCalls).toBe(3);

    const stored = JSON.parse(await readFile(storePath, "utf8")) as {
      ledger: Record<string, {
        state: string;
        response: Record<string, unknown> | null;
      }>;
    };
    expect(stored.ledger[idempotencyKey]?.state).toBe("unknown");
    expect(stored.ledger[idempotencyKey]?.response).toHaveProperty(
      "_writeEvidence",
    );

    const verified = await owner.handle({
      operation: "read",
      request: readRequest(),
    });
    expect(verified.status).toBe(200);
    expect(bodyValue(verified)).toMatchObject({
      writeStatus: {
        status: "VERIFIED",
        stage: "business_price",
        requestId: "REQ-W05-COMMIT",
      },
    });
    expect(gateway.readCalls).toBe(4);

    const reconciled = JSON.parse(await readFile(storePath, "utf8")) as {
      ledger: Record<string, { state: string }>;
    };
    expect(reconciled.ledger[idempotencyKey]?.state).toBe("completed");
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
    const verified = await restarted.handle({
      operation: "read",
      request: readRequest(),
    });
    expect(verified.status).toBe(200);
    expect(bodyValue(verified)).toMatchObject({
      writeStatus: {
        status: "VERIFIED",
        stage: "business_price",
        requestId: null,
        submissionId: null,
      },
    });

    const reconciledStore = JSON.parse(await readFile(storePath, "utf8")) as {
      ledger: Record<string, { state: string }>;
    };
    expect(reconciledStore.ledger[idempotencyKey]?.state).toBe("completed");
    expect(gateway.commitCalls).toBe(1);
  });

  it("reconciles a dispatched minimum-price transport close without a second PATCH", async () => {
    const idempotencyKey = "w05-minimum-dispatched-reconcile";
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w05-minimum-price-")),
      "store.json",
    );
    const store = new LocalStore(storePath);
    await store.initialize();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w05-minimum-dispatched-account",
    }));
    let minimumAmount = 18;
    let minimumCommitCalls = 0;
    let businessCommitCalls = 0;
    const listing = (): BusinessPricingListingSnapshot => ({
      ...businessPricingSnapshot(),
      minimumPrice: { amount: minimumAmount, currencyCode: "USD" },
      minimumPricePresence: "canonical",
      minimumPriceProtectedHash: "7".repeat(64),
    });
    const minimumPatch = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      asin: "B012345678",
      productType: "PET_FOOD",
      currencyCode: "USD",
      previousAmount: 18,
      amount: 15,
      protectedHash: "7".repeat(64),
      canonicalPatchHash: "8".repeat(64),
    } as const;
    const validReply = (label: string): BusinessPricingGatewayReply => ({
      ok: true,
      status: 200,
      requestId: `REQ-${label}`,
      retryAfter: null,
      payload: {
        sku: SELLER_SKU,
        status: "VALID",
        submissionId: `SUB-${label}`,
        issues: [],
        identifiers: [{
          marketplaceId: MARKETPLACE_ID,
          asin: "B012345678",
        }],
      },
    });
    const gateway: BusinessPricingGateway = {
      mode: () => "live",
      read: async () => listing(),
      quantityDiscountPlanSupported: () => true,
      mintMinimumPricePatch: (_listing, amount) =>
        minimumAmount === 18 && amount === 15 ? minimumPatch : null,
      minimumPriceProtectedHash: () => "7".repeat(64),
      minimumPriceValidationPreview: async () =>
        validReply("MINIMUM-DISPATCHED-PREVIEW"),
      finalStateValidationPreview: async () =>
        validReply("MINIMUM-DISPATCHED-FINAL-STATE"),
      validationPreview: async () => validReply("UNEXPECTED-B2B-PREVIEW"),
      commitMinimumPriceOnce: async (_patch, fence, recordDispatch) => {
        minimumCommitCalls += 1;
        await fence.assertCurrent();
        await recordDispatch();
        minimumAmount = 15;
        throw new Error("simulated minimum-price transport close");
      },
      commitOnce: async () => {
        businessCommitCalls += 1;
        throw new Error("B2B PATCH must not run during minimum-price recovery");
      },
      replaceDemoContribution: async () => undefined,
      replaceDemoMinimumPrice: async () => undefined,
    };
    const owner = createBusinessPricingMutations({
      context,
      writeGate: new MainWriteGate({
        store,
        context,
        approveWrite: async () => undefined,
      }),
      gateway,
      priceObserver: { observeCanonical: async () => undefined },
    });
    const request = mutationRequest("POST", idempotencyKey);
    if (request.body?.kind !== "json") throw new Error("Expected JSON body");
    request.body.value = {
      ...request.body.value,
      newBusinessPrice: 20,
      expectedMinimumPrice: 18,
      expectedQuantityDiscountPlanHash: null,
      quantityDiscountTiers: [
        { lowerBound: 5, percent: 5 },
        { lowerBound: 20, percent: 20 },
      ],
    };

    expect((await owner.handle({ operation: "preview", request })).status)
      .toBe(200);
    const uncertain = await owner.handle({
      operation: "commit",
      request: { ...request, method: "PATCH" },
    });
    expect(uncertain.status).toBe(503);
    expect(bodyValue(uncertain)).toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(minimumCommitCalls).toBe(1);
    expect(businessCommitCalls).toBe(0);

    const restarted = createBusinessPricingMutations({
      context,
      writeGate: new MainWriteGate({
        store,
        context,
        approveWrite: async () => undefined,
      }),
      gateway,
      priceObserver: { observeCanonical: async () => undefined },
    });
    const verified = await restarted.handle({
      operation: "read",
      request: readRequest(),
    });
    expect(verified.status).toBe(200);
    expect(bodyValue(verified)).toMatchObject({
      writeStatus: {
        status: "VERIFIED",
        stage: "minimum_price",
        requestId: null,
        submissionId: null,
        businessPriceSubmitted: false,
      },
    });
    expect(minimumCommitCalls).toBe(1);
    expect(businessCommitCalls).toBe(0);
  });

  it("returns an accepted B2B write as processing until a later GET canonically verifies it", async () => {
    vi.useFakeTimers();
    try {
      const idempotencyKey = "w05-accepted-processing";
      const storePath = join(
        await mkdtemp(join(tmpdir(), "amz-api-w05-business-price-")),
        "store.json",
      );
      const gateway = new DurableDispatchGateway(
        storePath,
        idempotencyKey,
        false,
        true,
      );
      const owner = await durableHarness(gateway, storePath);

      expect((await owner.handle({
        operation: "preview",
        request: mutationRequest("POST", idempotencyKey),
      })).status).toBe(200);
      const commitPromise = owner.handle({
        operation: "commit",
        request: mutationRequest("PATCH", idempotencyKey),
      });
      await vi.runAllTimersAsync();
      const processing = await commitPromise;

      expect(processing.status).toBe(202);
      expect(bodyValue(processing)).toMatchObject({
        status: "PROCESSING",
        stage: "business_price",
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        requestedBusinessPrice: { amount: 27, currencyCode: "USD" },
        verified: false,
        canResend: false,
        requestId: "REQ-W05-COMMIT",
      });
      expect(JSON.stringify(bodyValue(processing))).not.toContain(
        "_writeEvidence",
      );
      expect(gateway.commitCalls).toBe(1);

      const stale = await owner.handle({
        operation: "read",
        request: readRequest(),
      });
      expect(stale.status).toBe(200);
      expect(bodyValue(stale)).toMatchObject({
        writeStatus: {
          status: "PROCESSING",
          stage: "business_price",
          verified: false,
          canResend: false,
        },
      });

      gateway.businessPriceAmount = 27;
      const verified = await owner.handle({
        operation: "read",
        request: readRequest(),
      });
      expect(verified.status).toBe(200);
      expect(bodyValue(verified)).toMatchObject({
        writeStatus: {
          status: "VERIFIED",
          stage: "business_price",
          verified: true,
          canResend: false,
          requestId: "REQ-W05-COMMIT",
        },
      });
      expect(gateway.commitCalls).toBe(1);

      gateway.businessPriceAmount = 26;
      const externallyChanged = await owner.handle({
        operation: "read",
        request: readRequest(),
      });
      expect(externallyChanged.status).toBe(200);
      expect(bodyValue(externallyChanged)).toMatchObject({
        businessPrice: { amount: 26, currencyCode: "USD" },
        writeStatus: null,
      });
      expect(gateway.commitCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips a newer completed duplicate-repair tombstone while preserving the repair status", async () => {
    const originalKey = "w05-duplicate-repair-original";
    const repairKey = "w05-duplicate-repair-status";
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w05-business-price-")),
      "store.json",
    );
    const store = new LocalStore(storePath);
    await store.initialize();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w05-durable-account",
    }));
    const gateway = new DurableDispatchGateway(
      storePath,
      originalKey,
      false,
      true,
    );
    const owner = createBusinessPricingMutations({
      context,
      writeGate: new MainWriteGate({
        store,
        context,
        approveWrite: async () => undefined,
      }),
      gateway,
      priceObserver: { observeCanonical: async () => undefined },
    });

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", originalKey),
    })).status).toBe(200);
    expect((await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", originalKey),
    })).status).toBe(202);

    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      ledger: Record<string, { response: Record<string, unknown> | null }>;
    };
    const originalResponse = persisted.ledger[originalKey]?.response;
    if (!originalResponse) throw new Error("Expected durable accepted response");
    const repairResponse = {
      ...structuredClone(originalResponse),
      requestId: "REQ-W05-DUPLICATE-REPAIR",
      submissionId: "SUB-W05-DUPLICATE-REPAIR",
    };

    await expect(store.runIdempotentOperation({
      idempotencyKey: repairKey,
      operationType: "business_price",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      accountScope: "w05-durable-account",
      fingerprint: "replace-identical-duplicate-tiers-once",
      businessPriceDuplicateRepair: true,
      execute: async ({ recordAccepted }) => {
        await recordAccepted(repairResponse);
        throw new Error("repair accepted and awaiting canonical GET");
      },
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    const processing = await owner.handle({
      operation: "read",
      request: readRequest(),
    });
    expect(bodyValue(processing)).toMatchObject({
      writeStatus: {
        status: "PROCESSING",
        requestId: "REQ-W05-DUPLICATE-REPAIR",
      },
    });

    gateway.businessPriceAmount = 27;
    const verified = await owner.handle({
      operation: "read",
      request: readRequest(),
    });
    expect(bodyValue(verified)).toMatchObject({
      writeStatus: {
        status: "VERIFIED",
        requestId: "REQ-W05-DUPLICATE-REPAIR",
      },
    });
    expect(gateway.commitCalls).toBe(1);

    const dispatchedResponse = {
      ...structuredClone(repairResponse),
      status: "DISPATCHED",
      requestId: null,
      submissionId: null,
      requestedBusinessPrice: { amount: 26, currencyCode: "USD" },
      _writeEvidence: {
        ...((repairResponse as Record<string, unknown>)._writeEvidence as
          Record<string, unknown>),
        requestedBusinessPrice: { amount: 26, currencyCode: "USD" },
      },
    };
    await expect(store.runIdempotentOperation({
      idempotencyKey: "w05-newer-dispatched-status",
      operationType: "business_price",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      accountScope: "w05-durable-account",
      fingerprint: "newer-dispatched-business-price",
      execute: async ({ recordAccepted }) => {
        await recordAccepted(dispatchedResponse);
        throw new Error("transport stopped after dispatch evidence");
      },
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    const newestUnknown = await owner.handle({
      operation: "read",
      request: readRequest(),
    });
    expect(bodyValue(newestUnknown)).toMatchObject({
      businessPrice: { amount: 27, currencyCode: "USD" },
      writeStatus: null,
    });
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
      ...unsupportedMinimumPriceGateway,
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

  it.each([
    ["omitted", undefined],
    ["empty", []],
  ] as const)(
    "accepts a request-bound VALID preview when optional identifiers are %s",
    async (_scenario, identifiers) => {
      const stagePreview = vi.fn(async (_binding: WriteBinding) => undefined);
      const snapshot = businessPricingSnapshot();
      const gateway: BusinessPricingGateway = {
        ...unsupportedMinimumPriceGateway,
        mode: () => "live",
        read: async () => snapshot,
        quantityDiscountPlanSupported: () => true,
        validationPreview: async () => ({
          ok: true,
          status: 200,
          requestId: "REQ-W05-PREVIEW-OPTIONAL-IDENTIFIERS",
          retryAfter: null,
          payload: {
            sku: SELLER_SKU,
            status: "VALID",
            submissionId: "W05-PREVIEW-OPTIONAL-IDENTIFIERS",
            issues: [],
            ...(identifiers === undefined ? {} : { identifiers }),
          },
        }),
        commitOnce: vi.fn(),
        replaceDemoContribution: async () => undefined,
      };
      const owner = createBusinessPricingMutations({
        context: {
          capture: async (marketplaceId) => ({
            marketplaceId,
            region: "na",
            mode: "live",
            accountScope: "opaque-w05-request-bound-preview" as never,
            generation: 0,
          }),
          assertCurrent: async () => undefined,
          invalidate: () => undefined,
        },
        writeGate: {
          stagePreview,
          execute: vi.fn(),
          reconcile: async () => undefined,
          clearEphemeral: () => undefined,
        } as unknown as MainWriteGatePort,
        gateway,
        priceObserver: { observeCanonical: vi.fn() },
      });

      const response = await owner.handle({
        operation: "preview",
        request: previewRequest(),
      });

      expect(response.status).toBe(200);
      expect(bodyValue(response)).toMatchObject({
        status: "VALID",
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        asin: snapshot.asin,
      });
      expect(stagePreview).toHaveBeenCalledOnce();
    },
  );

  it("rejects contradictory non-empty preview identifiers before staging", async () => {
    const stagePreview = vi.fn(async (_binding: WriteBinding) => undefined);
    const snapshot = businessPricingSnapshot();
    const gateway: BusinessPricingGateway = {
      ...unsupportedMinimumPriceGateway,
      mode: () => "live",
      read: async () => snapshot,
      quantityDiscountPlanSupported: () => true,
      validationPreview: async () => ({
        ok: true,
        status: 200,
        requestId: "REQ-W05-PREVIEW-CONTRADICTORY-IDENTIFIERS",
        retryAfter: null,
        payload: {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: "W05-PREVIEW-CONTRADICTORY-IDENTIFIERS",
          issues: [],
          identifiers: [{
            marketplaceId: MARKETPLACE_ID,
            asin: "B000WRONG01",
          }],
        },
      }),
      commitOnce: vi.fn(),
      replaceDemoContribution: async () => undefined,
    };
    const owner = createBusinessPricingMutations({
      context: {
        capture: async (marketplaceId) => ({
          marketplaceId,
          region: "na",
          mode: "live",
          accountScope: "opaque-w05-contradictory-preview" as never,
          generation: 0,
        }),
        assertCurrent: async () => undefined,
        invalidate: () => undefined,
      },
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: async () => undefined,
        clearEphemeral: () => undefined,
      } as unknown as MainWriteGatePort,
      gateway,
      priceObserver: { observeCanonical: vi.fn() },
    });

    const response = await owner.handle({
      operation: "preview",
      request: previewRequest(),
    });

    expect(response.status).toBe(502);
    expect(bodyValue(response)).toMatchObject({
      code: "VALIDATION_STATUS_UNKNOWN",
      requestId: "REQ-W05-PREVIEW-CONTRADICTORY-IDENTIFIERS",
    });
    expect(stagePreview).not.toHaveBeenCalled();
  });

  it("stops price-only preview when current quantity discounts are ambiguous", async () => {
    const stagePreview = vi.fn(async (_binding: WriteBinding) => undefined);
    const validationPreview = vi.fn();
    const snapshot: BusinessPricingListingSnapshot = {
      ...businessPricingSnapshot(),
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      quantityDiscountPlanHash: null,
    };
    const gateway: BusinessPricingGateway = {
      ...unsupportedMinimumPriceGateway,
      mode: () => "live",
      read: async () => snapshot,
      quantityDiscountPlanSupported: () => true,
      validationPreview,
      commitOnce: vi.fn(),
      replaceDemoContribution: async () => undefined,
    };
    const owner = createBusinessPricingMutations({
      context: {
        capture: async (marketplaceId) => ({
          marketplaceId,
          region: "na",
          mode: "live",
          accountScope: "opaque-w05-ambiguous-qdp" as never,
          generation: 0,
        }),
        assertCurrent: async () => undefined,
        invalidate: () => undefined,
      },
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: async () => undefined,
        clearEphemeral: () => undefined,
      } as unknown as MainWriteGatePort,
      gateway,
      priceObserver: { observeCanonical: vi.fn() },
    });

    const response = await owner.handle({
      operation: "preview",
      request: previewRequest(),
    });

    expect(response.status).toBe(409);
    expect(bodyValue(response)).toMatchObject({
      code: "QUANTITY_DISCOUNT_CHANGED",
    });
    expect(validationPreview).not.toHaveBeenCalled();
    expect(stagePreview).not.toHaveBeenCalled();
  });

  it("previews the USD minimum-price write and the exact final B2B state", async () => {
    const stagePreview = vi.fn(async (_binding: WriteBinding) => undefined);
    const snapshot: BusinessPricingListingSnapshot = {
      ...businessPricingSnapshot(),
      minimumPrice: { amount: 18, currencyCode: "USD" },
      minimumPricePresence: "canonical",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
      quantityDiscountPlanHash: null,
    };
    const minimumPatch = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      asin: snapshot.asin!,
      productType: snapshot.productType,
      currencyCode: "USD",
      previousAmount: 18,
      amount: 15,
      protectedHash: "7".repeat(64),
      canonicalPatchHash: "8".repeat(64),
    } as const;
    const mintMinimumPricePatch = vi.fn(() => minimumPatch);
    const minimumPriceValidationPreview = vi.fn(async () => ({
      ok: true,
      status: 200,
      requestId: "REQ-W05-MINIMUM-PREVIEW",
      retryAfter: null,
      payload: {
        sku: SELLER_SKU,
        status: "VALID",
        submissionId: "W05-MINIMUM-PREVIEW",
        issues: [],
        identifiers: [{
          marketplaceId: MARKETPLACE_ID,
          asin: snapshot.asin,
        }],
      },
    }));
    const validationPreview = vi.fn(async () => ({
      ok: true,
      status: 200,
      requestId: "REQ-W05-FINAL-STATE-PREVIEW",
      retryAfter: null,
      payload: {
        sku: SELLER_SKU,
        status: "VALID",
        submissionId: "W05-FINAL-STATE-PREVIEW",
        issues: [],
        identifiers: [{
          marketplaceId: MARKETPLACE_ID,
          asin: snapshot.asin,
        }],
      },
    }));
    const gateway: BusinessPricingGateway = {
      ...unsupportedMinimumPriceGateway,
      mode: () => "live",
      read: async () => snapshot,
      quantityDiscountPlanSupported: () => true,
      mintMinimumPricePatch,
      minimumPriceValidationPreview,
      finalStateValidationPreview: validationPreview,
      validationPreview,
      commitOnce: vi.fn(),
      commitMinimumPriceOnce: vi.fn(),
      replaceDemoContribution: async () => undefined,
      replaceDemoMinimumPrice: async () => undefined,
    };
    const owner = createBusinessPricingMutations({
      context: {
        capture: async (marketplaceId) => ({
          marketplaceId,
          region: "na",
          mode: "live",
          accountScope: "opaque-w05-minimum-preview" as never,
          generation: 0,
        }),
        assertCurrent: async () => undefined,
        invalidate: () => undefined,
      },
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: async () => undefined,
        clearEphemeral: () => undefined,
      } as unknown as MainWriteGatePort,
      gateway,
      priceObserver: { observeCanonical: vi.fn() },
    });
    const request = mutationRequest("POST", "w05-minimum-first-001");
    if (request.body?.kind !== "json") throw new Error("Expected JSON body");
    request.body.value = {
      ...request.body.value,
      newBusinessPrice: 20,
      expectedMinimumPrice: 18,
      expectedQuantityDiscountPlanHash: null,
      quantityDiscountTiers: [
        { lowerBound: 5, percent: 5 },
        { lowerBound: 20, percent: 20 },
      ],
    };

    const response = await owner.handle({ operation: "preview", request });

    expect(response.status).toBe(200);
    expect(bodyValue(response)).toMatchObject({
      previousMinimumPrice: { amount: 18, currencyCode: "USD" },
      requestedMinimumPrice: { amount: 15, currencyCode: "USD" },
      lowestTierUnitPrice: { amount: 16, currencyCode: "USD" },
      minimumPriceChange: "lower",
      minimumPriceProtectedHash: "7".repeat(64),
      minimumPriceCanonicalPatchHash: "8".repeat(64),
      businessPriceValidation: "final-state-validated",
    });
    expect(mintMinimumPricePatch).toHaveBeenCalledWith(snapshot, 15);
    expect(minimumPriceValidationPreview).toHaveBeenCalledWith(minimumPatch);
    expect(validationPreview).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "combined" }),
      minimumPatch,
    );
    expect(stagePreview).toHaveBeenCalledWith(expect.objectContaining({
      family: "business-price",
      intents: [
        expect.objectContaining({ intentId: "minimum-price", operation: "price" }),
      ],
    }));
    expect(stagePreview.mock.calls[0]?.[0].intents).toHaveLength(1);
  });

  it("stops after Amazon accepts the minimum price and waits for a later exact GET", async () => {
    const events: string[] = [];
    let minimumAmount = 18;
    let businessAmount = 28;
    let appliedPlan = false;
    const snapshot = (): BusinessPricingListingSnapshot => ({
      ...businessPricingSnapshot(businessAmount),
      minimumPrice: { amount: minimumAmount, currencyCode: "USD" },
      minimumPricePresence: "canonical",
      quantityDiscountPlan: appliedPlan
        ? {
            discountType: "percent",
            levels: [
              { lowerBound: 5, value: 5 },
              { lowerBound: 20, value: 20 },
            ],
          }
        : null,
      quantityDiscountPlanPresence: appliedPlan ? "canonical" : "absent",
      quantityDiscountPlanHash: appliedPlan
        ? canonicalSha256({
            discountType: "percent",
            levels: [
              { lowerBound: 5, value: 5 },
              { lowerBound: 20, value: 20 },
            ],
          })
        : null,
      businessOfferGuardHash: appliedPlan
        ? "c".repeat(64)
        : minimumAmount === 15
        ? "d".repeat(64)
        : "a".repeat(64),
      businessOfferProtectedHash: minimumAmount === 15
        ? "e".repeat(64)
        : "b".repeat(64),
    });
    const minimumPatch = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      asin: "B012345678",
      productType: "PET_FOOD",
      currencyCode: "USD",
      previousAmount: 18,
      amount: 15,
      protectedHash: "7".repeat(64),
      canonicalPatchHash: "8".repeat(64),
    } as const;
    const validReply = (label: string): BusinessPricingGatewayReply => ({
      ok: true,
      status: 200,
      requestId: `REQ-${label}`,
      retryAfter: null,
      payload: {
        sku: SELLER_SKU,
        status: "VALID",
        submissionId: `SUB-${label}`,
        issues: [],
        identifiers: [{
          marketplaceId: MARKETPLACE_ID,
          asin: "B012345678",
        }],
      },
    });
    const gateway: BusinessPricingGateway = {
      ...unsupportedMinimumPriceGateway,
      mode: () => "live",
      read: async () => snapshot(),
      quantityDiscountPlanSupported: () => true,
      mintMinimumPricePatch: (_listing, amount) =>
        minimumAmount === 18 && amount === 15 ? minimumPatch : null,
      minimumPriceProtectedHash: () => "7".repeat(64),
      minimumPriceValidationPreview: async () => {
        events.push("minimum-preview");
        return validReply("MINIMUM-PREVIEW");
      },
      finalStateValidationPreview: async () => {
        events.push("final-state-preview");
        return validReply("FINAL-STATE-PREVIEW");
      },
      validationPreview: async () => {
        events.push("b2b-preview");
        return validReply("B2B-PREVIEW");
      },
      commitMinimumPriceOnce: async (_patch, fence, recordDispatch) => {
        events.push("minimum-commit");
        await fence.assertCurrent();
        await recordDispatch();
        minimumAmount = 15;
        return {
          ok: true,
          status: 202,
          requestId: "REQ-MINIMUM-COMMIT",
          retryAfter: null,
          payload: {
            sku: SELLER_SKU,
            status: "ACCEPTED",
            submissionId: "SUB-MINIMUM-COMMIT",
            issues: [],
          },
        };
      },
      commitOnce: async (_patch, fence, recordDispatch) => {
        events.push("b2b-commit");
        await fence.assertCurrent();
        await recordDispatch();
        businessAmount = 20;
        appliedPlan = true;
        return {
          ok: true,
          status: 202,
          requestId: "REQ-B2B-COMMIT",
          retryAfter: null,
          payload: {
            sku: SELLER_SKU,
            status: "ACCEPTED",
            submissionId: "SUB-B2B-COMMIT",
            issues: [],
          },
        };
      },
      replaceDemoContribution: async () => undefined,
      replaceDemoMinimumPrice: async () => undefined,
    };
    let approvalReason = "";
    const writeGate: MainWriteGatePort = {
      stagePreview: async () => undefined,
      execute: async (input) => {
        approvalReason = typeof input.approvalReason === "function"
          ? input.approvalReason("VERIFY-CODE")
          : input.approvalReason;
        events.push("approval");
        return input.run({
          attempt: async ({ intentId, execute }) => {
            events.push(`attempt:${intentId}`);
            return execute({
              recordDurableEvidence: async () => undefined,
              recordAccepted: async () => undefined,
              assertCurrent: async () => undefined,
            });
          },
        });
      },
      reconcile: async () => undefined,
      clearEphemeral: () => undefined,
    };
    const owner = createBusinessPricingMutations({
      context: {
        capture: async (marketplaceId) => ({
          marketplaceId,
          region: "na",
          mode: "live",
          accountScope: "opaque-w05-minimum-commit" as never,
          generation: 0,
        }),
        assertCurrent: async () => undefined,
        invalidate: () => undefined,
      },
      writeGate,
      gateway,
      priceObserver: { observeCanonical: vi.fn() },
    });
    const request = mutationRequest("POST", "w05-minimum-commit-001");
    if (request.body?.kind !== "json") throw new Error("Expected JSON body");
    request.body.value = {
      ...request.body.value,
      newBusinessPrice: 20,
      expectedMinimumPrice: 18,
      expectedQuantityDiscountPlanHash: null,
      quantityDiscountTiers: [
        { lowerBound: 5, percent: 5 },
        { lowerBound: 20, percent: 20 },
      ],
    };

    expect((await owner.handle({ operation: "preview", request })).status)
      .toBe(200);
    const committed = await owner.handle({
      operation: "commit",
      request: { ...request, method: "PATCH" },
    });

    expect(committed.status).toBe(202);
    expect(events).toEqual([
      "minimum-preview",
      "final-state-preview",
      "minimum-preview",
      "final-state-preview",
      "approval",
      "attempt:minimum-price",
      "minimum-preview",
      "final-state-preview",
      "minimum-commit",
    ]);
    expect(approvalReason).toContain("最低價 18 → 15 USD");
    expect(approvalReason).toContain("最低階單價 16 USD");
    expect(approvalReason).toContain("一般售價／自動定價");
    expect(approvalReason.slice(0, 120)).toContain("最低價 18 → 15 USD");
    expect(approvalReason.slice(0, 120)).toContain("一般售價／自動定價");
    expect(approvalReason.slice(0, 120)).toContain(SELLER_SKU);
    expect(approvalReason).toContain("B2B 價格與數量折扣本次尚未送出");
    expect(approvalReason).not.toContain("B2B 28 → 20 USD");
    expect(bodyValue(committed)).toMatchObject({
      status: "PROCESSING",
      stage: "minimum_price",
      verified: false,
      canResend: false,
      businessPriceSubmitted: false,
      previousMinimumPrice: { amount: 18, currencyCode: "USD" },
      requestedMinimumPrice: { amount: 15, currencyCode: "USD" },
      lowestTierUnitPrice: { amount: 16, currencyCode: "USD" },
      requestedBusinessPrice: { amount: 20, currencyCode: "USD" },
      requestId: "REQ-MINIMUM-COMMIT",
    });
    expect(minimumAmount).toBe(15);
    expect(businessAmount).toBe(28);
    expect(events).not.toContain("attempt:business-price");
    expect(events).not.toContain("b2b-commit");
  });

  it("stages an exact same-price and same-tier duplicate cleanup as a repair write", async () => {
    const stagePreview = vi.fn(async (_binding: WriteBinding) => undefined);
    const plan = {
      discountType: "percent" as const,
      levels: [
        { lowerBound: 5, value: 5 },
        { lowerBound: 10, value: 10 },
      ],
    };
    const snapshot: BusinessPricingListingSnapshot = {
      ...businessPricingSnapshot(),
      quantityDiscountPlan: plan,
      quantityDiscountPlanPresence: "duplicate",
      quantityDiscountPlanHash: canonicalSha256(plan),
    };
    const validationPreview = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      requestId: "REQ-W05-DUPLICATE-REPAIR-PREVIEW",
      retryAfter: null,
      payload: {
        sku: SELLER_SKU,
        status: "VALID",
        submissionId: "W05-DUPLICATE-REPAIR-PREVIEW",
        issues: [],
        identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: snapshot.asin }],
      },
    }));
    const gateway: BusinessPricingGateway = {
      ...unsupportedMinimumPriceGateway,
      mode: () => "live",
      read: async () => snapshot,
      quantityDiscountPlanSupported: () => true,
      validationPreview,
      commitOnce: vi.fn(),
      replaceDemoContribution: async () => undefined,
    };
    const owner = createBusinessPricingMutations({
      context: {
        capture: async (marketplaceId) => ({
          marketplaceId,
          region: "na",
          mode: "live",
          accountScope: "opaque-w05-duplicate-repair" as never,
          generation: 0,
        }),
        assertCurrent: async () => undefined,
        invalidate: () => undefined,
      },
      writeGate: {
        stagePreview,
        execute: vi.fn(),
        reconcile: async () => undefined,
        clearEphemeral: () => undefined,
      } as unknown as MainWriteGatePort,
      gateway,
      priceObserver: { observeCanonical: vi.fn() },
    });
    const request = mutationRequest("POST", "w05-duplicate-repair-001");
    if (request.body?.kind !== "json") throw new Error("Expected JSON body");
    request.body.value = {
      ...request.body.value,
      newBusinessPrice: snapshot.businessPrice!.amount,
      expectedMinimumPrice: null,
      expectedQuantityDiscountPlanHash: snapshot.quantityDiscountPlanHash,
      quantityDiscountTiers: plan.levels.map((level) => ({
        lowerBound: level.lowerBound,
        percent: level.value,
      })),
    };

    const response = await owner.handle({ operation: "preview", request });

    expect(response.status).toBe(200);
    expect(validationPreview).toHaveBeenCalledOnce();
    expect(stagePreview).toHaveBeenCalledWith(expect.objectContaining({
      family: "business-price",
      intents: [expect.objectContaining({
        operation: "business_price_repair",
      })],
    }));

    const changedPriceRequest = mutationRequest(
      "POST",
      "w05-duplicate-repair-changed-price",
    );
    if (changedPriceRequest.body?.kind !== "json") {
      throw new Error("Expected JSON body");
    }
    changedPriceRequest.body.value = {
      ...changedPriceRequest.body.value,
      newBusinessPrice: snapshot.businessPrice!.amount - 1,
      expectedMinimumPrice: null,
      expectedQuantityDiscountPlanHash: snapshot.quantityDiscountPlanHash,
      quantityDiscountTiers: plan.levels.map((level) => ({
        lowerBound: level.lowerBound,
        percent: level.value,
      })),
    };
    const changedPrice = await owner.handle({
      operation: "preview",
      request: changedPriceRequest,
    });
    expect(changedPrice.status).toBe(409);
    expect(bodyValue(changedPrice)).toMatchObject({
      code: "DUPLICATE_REPAIR_CHANGED",
    });

    const changedTiersRequest = mutationRequest(
      "POST",
      "w05-duplicate-repair-changed-tiers",
    );
    if (changedTiersRequest.body?.kind !== "json") {
      throw new Error("Expected JSON body");
    }
    changedTiersRequest.body.value = {
      ...changedTiersRequest.body.value,
      newBusinessPrice: snapshot.businessPrice!.amount,
      expectedMinimumPrice: null,
      expectedQuantityDiscountPlanHash: snapshot.quantityDiscountPlanHash,
      quantityDiscountTiers: plan.levels.map((level, index) => ({
        lowerBound: level.lowerBound,
        percent: level.value + (index === 0 ? 1 : 0),
      })),
    };
    const changedTiers = await owner.handle({
      operation: "preview",
      request: changedTiersRequest,
    });
    expect(changedTiers.status).toBe(409);
    expect(bodyValue(changedTiers)).toMatchObject({
      code: "DUPLICATE_REPAIR_CHANGED",
    });
    expect(validationPreview).toHaveBeenCalledOnce();
    expect(stagePreview).toHaveBeenCalledOnce();
  });
});
