import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createListingPriceMutations,
  ListingPriceMutations,
  type ListingPriceMutationOperations,
} from "../src/main/listing-price-mutations";
import type { ListingPriceGateway } from
  "../src/main/amazon/listing-price-gateway";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type {
  MainWriteAttemptInput,
  MainWriteGatePort,
  MainWriteGateReconcileInput,
  WriteBinding,
} from "../src/main/write-gate";
import { MainWriteGate } from "../src/main/write-gate";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";
import type {
  ListingPriceSnapshot,
  PriceUpdateResult,
} from "../src/main/amazon/sp-api";

const US = "ATVPDKIKX0DER" as const;

async function testStore(): Promise<LocalStore> {
  const directory = await mkdtemp(join(tmpdir(), "amz-w02-price-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  return store;
}

function priceSnapshot(amount: number): ListingPriceSnapshot {
  return {
    mode: "live",
    marketplaceId: US,
    sellerSku: "AFA-TRKY-4OZ",
    asin: "B09S5VY2JS",
    title: "Turkey Tendon",
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    createdAt: null,
    updatedAt: null,
    standardPrice: { amount, currencyCode: "USD" },
    effectivePrice: { amount, currencyCode: "USD" },
    minimumPrice: null,
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice: null,
    discountedPricePresence: "absent",
    hasDiscountedPrice: false,
    hasAutomatedPricing: false,
    fetchedAt: "2026-08-26T06:05:00.000Z",
    requestId: "safe-readback-request",
    issues: [],
    fulfillmentAvailability: [{
      channelCode: "AMAZON_NA",
      quantity: 12,
      fulfillment: "FBA",
      editable: false,
    }],
    notice: null,
  };
}

function saleSnapshot(
  standardPrice: number,
  salePrice: number,
): ListingPriceSnapshot {
  return {
    ...priceSnapshot(standardPrice),
    effectivePrice: { amount: salePrice, currencyCode: "USD" },
    discountedPrice: {
      price: { amount: salePrice, currencyCode: "USD" },
      startAt: "2026-09-01",
      endAt: "2026-09-30",
    },
    discountedPricePresence: "valid",
    hasDiscountedPrice: true,
  };
}

describe("Listing Price mutations", () => {
  it("reads a canonical price and reconciles both price operations in one context", async () => {
    const snapshot = priceSnapshot(13.99);
    let reconciled: MainWriteGateReconcileInput<ListingPriceSnapshot> | null =
      null;
    let reconcileCalls = 0;
    const writeGate: MainWriteGatePort = {
      stagePreview: vi.fn(async () => undefined),
      execute: vi.fn(async () => {
        throw new Error("read must never enter the Write Gate execute path");
      }),
      reconcile: async <TSnapshot>(input: MainWriteGateReconcileInput<TSnapshot>) => {
        reconcileCalls += 1;
        reconciled = input as unknown as
          MainWriteGateReconcileInput<ListingPriceSnapshot>;
      },
      clearEphemeral: vi.fn(),
    };
    const read = vi.fn(async () => snapshot);
    const owner = new ListingPriceMutations({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-w02-price-read",
      })),
      writeGate,
      operations: {
        read,
        previewStandard: vi.fn(async () => {
          throw new Error("standard preview must not run");
        }),
        commitStandard: vi.fn(async () => {
          throw new Error("standard commit must not run");
        }),
        previewSale: vi.fn(async () => {
          throw new Error("sale preview must not run");
        }),
        commitSale: vi.fn(async () => {
          throw new Error("sale commit must not run");
        }),
      },
    });

    const response = await owner.handle({
      family: "standard-price",
      operation: "read",
      request: {
        requestId: "w02-price-read-reconcile-001",
        method: "GET",
        path: "/api/sp-api/listings",
        query: { marketplaceId: US, sku: "AFA-TRKY-4OZ" },
        headers: {},
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ kind: "json", value: snapshot });
    expect(read).toHaveBeenCalledWith({
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
    });
    expect(reconcileCalls).toBe(1);
    expect(reconciled).toMatchObject({
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      operations: ["price", "sale_price"],
      snapshot,
      context: {
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-w02-price-read",
      },
    });
  });

  it("rejects canonical observation when the returned SKU differs from the requested identity", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "live",
      accountScope: "opaque-w02-price-observation",
    }));
    const reconcile = vi.fn(async () => undefined);
    const owner = new ListingPriceMutations({
      context,
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute: vi.fn(async () => {
          throw new Error("identity mismatch must not execute a write");
        }),
        reconcile,
        clearEphemeral: vi.fn(),
      },
      operations: {
        read: vi.fn(async () => {
          throw new Error("direct observation must not start another read");
        }),
        previewStandard: vi.fn(async () => {
          throw new Error("direct observation must not preview Standard Price");
        }),
        commitStandard: vi.fn(async () => {
          throw new Error("direct observation must not commit Standard Price");
        }),
        previewSale: vi.fn(async () => {
          throw new Error("direct observation must not preview Sale Price");
        }),
        commitSale: vi.fn(async () => {
          throw new Error("direct observation must not commit Sale Price");
        }),
      },
    });
    const captured = await context.capture(US);

    await expect(owner.observeCanonical(
      { marketplaceId: US, sellerSku: "AFA-TRKY-4OZ" },
      { ...priceSnapshot(13.99), sellerSku: "AFA-TRKY-8OZ" },
      captured,
    )).rejects.toMatchObject({
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("stages the exact Standard Price binding after a successful public preview", async () => {
    let staged: WriteBinding | null = null;
    const writeGate: MainWriteGatePort = {
      stagePreview: vi.fn(async (binding) => {
        staged = binding;
      }),
      execute: vi.fn(async () => {
        throw new Error("commit must not run during preview");
      }),
      reconcile: vi.fn(async () => undefined),
      clearEphemeral: vi.fn(),
    };
    const validation = {
      mode: "demo" as const,
      status: "SIMULATED" as const,
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      previousPrice: { amount: 13.99, currencyCode: "USD" },
      requestedPrice: { amount: 14.99, currencyCode: "USD" },
      validatedAt: "2026-08-26T06:00:00.000Z",
      issues: [],
      notice: "preview sentinel",
    };
    const operations = {
      read: vi.fn(async () => {
        throw new Error("read must not run outside the preview operation");
      }),
      previewStandard: vi.fn(async () => validation),
      commitStandard: vi.fn(async () => {
        throw new Error("commit must not run during preview");
      }),
      previewSale: vi.fn(async () => {
        throw new Error("sale preview must not run");
      }),
      commitSale: vi.fn(async () => {
        throw new Error("sale commit must not run");
      }),
    } satisfies ListingPriceMutationOperations;
    const owner = new ListingPriceMutations({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "demo",
        accountScope: "opaque-w02-standard-preview",
      })),
      writeGate,
      operations,
    });
    const request = {
      requestId: "w02-standard-preview-binding-001",
      method: "POST",
      path: "/api/sp-api/listings",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "AFA-TRKY-4OZ",
          expectedPrice: 13.99,
          newPrice: 14.99,
          idempotencyKey: "w02-standard-preview-001",
        },
      },
    } satisfies ApiRequest;

    const response = await owner.handle({
      family: "standard-price",
      operation: "preview",
      request,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ kind: "json", value: validation });
    expect(operations.previewStandard).toHaveBeenCalledOnce();
    expect(operations.previewStandard).toHaveBeenCalledWith({
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      expectedPrice: 13.99,
      newPrice: 14.99,
    });
    expect(staged).toMatchObject({
      family: "standard-price",
      previewKey: "w02-standard-preview-001",
      intents: [{
        intentId: "primary",
        operation: "price",
        marketplaceId: US,
        sellerSku: "AFA-TRKY-4OZ",
        idempotencyKey: "w02-standard-preview-001",
        proposalFingerprint:
          "41c0fdfc3d3cab99f9cb751b1da1cc234b7c5ad6b572545d2a0b6652f21823d6",
      }],
    });
  });

  it("commits Standard Price once after native approval and verifies canonical readback", async () => {
    const events: string[] = [];
    let executedBinding: WriteBinding | null = null;
    let approvalReason = "";
    const accepted: PriceUpdateResult = {
      mode: "live",
      status: "ACCEPTED",
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      previousPrice: { amount: 13.99, currencyCode: "USD" },
      requestedPrice: { amount: 14.99, currencyCode: "USD" },
      acceptedAt: "2026-08-26T06:04:00.000Z",
      submissionId: "submission-safe-001",
      requestId: "safe-commit-request",
      issues: [],
      notice: "Amazon accepted",
    };
    const writeGate: MainWriteGatePort = {
      stagePreview: vi.fn(async () => undefined),
      execute: vi.fn(async (input) => {
        executedBinding = input.binding;
        approvalReason = typeof input.approvalReason === "string"
          ? input.approvalReason
          : input.approvalReason("unused");
        events.push("native-approved");
        return input.run({
          attempt: async (attempt: MainWriteAttemptInput<unknown>) => {
            events.push("durable-attempt");
            return attempt.execute({
              recordAccepted: async () => {
                events.push("accepted-recorded");
              },
              assertCurrent: async () => undefined,
            });
          },
        });
      }),
      reconcile: vi.fn(async () => undefined),
      clearEphemeral: vi.fn(),
    };
    const operations = {
      read: vi.fn(async () => {
        events.push("canonical-readback");
        return priceSnapshot(14.99);
      }),
      previewStandard: vi.fn(async () => {
        throw new Error("preview route must not run during commit");
      }),
      commitStandard: vi.fn(async (_input, fence) => {
        events.push("commit-once");
        await fence?.assertCurrent();
        return accepted;
      }),
      previewSale: vi.fn(async () => {
        throw new Error("sale preview must not run");
      }),
      commitSale: vi.fn(async () => {
        throw new Error("sale commit must not run");
      }),
    } satisfies ListingPriceMutationOperations;
    const owner = new ListingPriceMutations({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-w02-standard-commit",
      })),
      writeGate,
      operations,
    });
    const request = {
      requestId: "w02-standard-commit-once-001",
      method: "PATCH",
      path: "/api/sp-api/listings",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "AFA-TRKY-4OZ",
          expectedPrice: 13.99,
          newPrice: 14.99,
          idempotencyKey: "w02-standard-commit-001",
        },
      },
    } satisfies ApiRequest;

    const response = await owner.handle({
      family: "standard-price",
      operation: "commit",
      request,
    });

    expect(response.status).toBe(200);
    expect(response.body.kind === "json" ? response.body.value : null)
      .toMatchObject({
        requestedPrice: { amount: 14.99, currencyCode: "USD" },
        writeLifecycle: { state: "verified", verified: true },
      });
    expect(operations.commitStandard).toHaveBeenCalledOnce();
    expect(operations.read).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "native-approved",
      "durable-attempt",
      "commit-once",
      "accepted-recorded",
      "canonical-readback",
    ]);
    expect(approvalReason).toBe(
      "確認調價｜US AFA-TRKY-4OZ｜13.99 → 14.99 USD",
    );
    expect(executedBinding).toMatchObject({
      family: "standard-price",
      previewKey: "w02-standard-commit-001",
      intents: [{
        operation: "price",
        proposalFingerprint:
          "41c0fdfc3d3cab99f9cb751b1da1cc234b7c5ad6b572545d2a0b6652f21823d6",
      }],
    });
  });

  it("rejects a 20% Standard Price change without the full SKU before any write", async () => {
    const execute = vi.fn(async () => {
      throw new Error("the Write Gate must not run");
    });
    const commitStandard = vi.fn(async () => {
      throw new Error("Amazon commit must not run");
    });
    const owner = new ListingPriceMutations({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-w02-standard-magnitude",
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute,
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      },
      operations: {
        read: vi.fn(async () => priceSnapshot(12)),
        previewStandard: vi.fn(async () => {
          throw new Error("preview must not run");
        }),
        commitStandard,
        previewSale: vi.fn(async () => {
          throw new Error("sale preview must not run");
        }),
        commitSale: vi.fn(async () => {
          throw new Error("sale commit must not run");
        }),
      },
    });

    const response = await owner.handle({
      family: "standard-price",
      operation: "commit",
      request: {
        requestId: "w02-standard-magnitude-001",
        method: "PATCH",
        path: "/api/sp-api/listings",
        query: {},
        headers: {},
        body: {
          kind: "json",
          value: {
            marketplaceId: US,
            sellerSku: "AFA-TRKY-4OZ",
            expectedPrice: 10,
            newPrice: 12,
            idempotencyKey: "w02-standard-magnitude-001",
          },
        },
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      kind: "json",
      value: {
        code: "CONFIRMATION_REQUIRED",
        message: "價格變動達 20%，請重新輸入完整 SKU 才能送出。",
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(commitStandard).not.toHaveBeenCalled();
  });

  it("stages the exact Sale Price binding with canonical dates after preview", async () => {
    let staged: WriteBinding | null = null;
    const validation = {
      mode: "demo" as const,
      status: "SIMULATED" as const,
      action: "set" as const,
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      standardPrice: { amount: 20, currencyCode: "USD" },
      previousDiscountedPrice: null,
      requestedDiscountedPrice: {
        price: { amount: 15.99, currencyCode: "USD" },
        startAt: "2026-09-01",
        endAt: "2026-09-30",
      },
      validatedAt: "2026-08-26T06:10:00.000Z",
      issues: [],
      notice: "sale preview sentinel",
    };
    const previewSale = vi.fn(async () => validation);
    const owner = new ListingPriceMutations({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "demo",
        accountScope: "opaque-w02-sale-preview",
      })),
      writeGate: {
        stagePreview: vi.fn(async (binding) => {
          staged = binding;
        }),
        execute: vi.fn(async () => {
          throw new Error("commit must not run during preview");
        }),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      },
      operations: {
        read: vi.fn(async () => {
          throw new Error("read must not run during preview");
        }),
        previewStandard: vi.fn(async () => {
          throw new Error("standard preview must not run");
        }),
        commitStandard: vi.fn(async () => {
          throw new Error("standard commit must not run");
        }),
        previewSale,
        commitSale: vi.fn(async () => {
          throw new Error("sale commit must not run during preview");
        }),
      },
    });

    const request = {
      requestId: "w02-sale-preview-binding-001",
      method: "POST",
      path: "/api/sp-api/sale-price",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "AFA-TRKY-4OZ",
          action: "set",
          expectedPrice: 20,
          expectedDiscountedPrice: null,
          expectedStartAt: null,
          expectedEndAt: null,
          salePrice: 15.99,
          startAt: "2026-09-01",
          endAt: "2026-09-30",
          idempotencyKey: "w02-sale-preview-001",
        },
      },
    } satisfies ApiRequest;

    const response = await owner.handle({
      family: "sale-price",
      operation: "preview",
      request,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ kind: "json", value: validation });
    expect(previewSale).toHaveBeenCalledWith({
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      action: "set",
      expectedPrice: 20,
      expectedDiscountedPrice: null,
      expectedStartAt: null,
      expectedEndAt: null,
      salePrice: 15.99,
      startAt: "2026-09-01",
      endAt: "2026-09-30",
    });
    expect(staged).toMatchObject({
      family: "sale-price",
      previewKey: "w02-sale-preview-001",
      intents: [{
        operation: "sale_price",
        proposalFingerprint:
          "23dd947004ce7c154aa1c4372423d951bdfc5981f65c8da8417b1c8204419528",
      }],
    });
  });

  it("commits Sale Price once after native approval and verifies canonical readback", async () => {
    const events: string[] = [];
    let executedBinding: WriteBinding | null = null;
    let approvalReason = "";
    const accepted = {
      mode: "live" as const,
      status: "ACCEPTED" as const,
      action: "set" as const,
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      standardPrice: { amount: 20, currencyCode: "USD" },
      previousDiscountedPrice: null,
      requestedDiscountedPrice: {
        price: { amount: 15.99, currencyCode: "USD" },
        startAt: "2026-09-01",
        endAt: "2026-09-30",
      },
      acceptedAt: "2026-08-26T06:14:00.000Z",
      submissionId: "sale-submission-safe-001",
      requestId: "sale-commit-safe-request",
      issues: [],
      notice: "Amazon accepted sale",
    };
    const commitSale = vi.fn(async (_input, fence) => {
      events.push("commit-once");
      await fence?.assertCurrent();
      return accepted;
    });
    const read = vi.fn(async () => {
      events.push("canonical-readback");
      return saleSnapshot(20, 15.99);
    });
    const owner = new ListingPriceMutations({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-w02-sale-commit",
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute: vi.fn(async (input) => {
          executedBinding = input.binding;
          approvalReason = typeof input.approvalReason === "string"
            ? input.approvalReason
            : input.approvalReason("unused");
          events.push("native-approved");
          return input.run({
            attempt: async (attempt: MainWriteAttemptInput<unknown>) => {
              events.push("durable-attempt");
              return attempt.execute({
                recordAccepted: async () => {
                  events.push("accepted-recorded");
                },
                assertCurrent: async () => undefined,
              });
            },
          });
        }),
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      },
      operations: {
        read,
        previewStandard: vi.fn(async () => {
          throw new Error("standard preview must not run");
        }),
        commitStandard: vi.fn(async () => {
          throw new Error("standard commit must not run");
        }),
        previewSale: vi.fn(async () => {
          throw new Error("sale preview route must not run during commit");
        }),
        commitSale,
      },
    });

    const response = await owner.handle({
      family: "sale-price",
      operation: "commit",
      request: {
        requestId: "w02-sale-commit-once-001",
        method: "PATCH",
        path: "/api/sp-api/sale-price",
        query: {},
        headers: {},
        body: {
          kind: "json",
          value: {
            marketplaceId: US,
            sellerSku: "AFA-TRKY-4OZ",
            action: "set",
            expectedPrice: 20,
            expectedDiscountedPrice: null,
            expectedStartAt: null,
            expectedEndAt: null,
            salePrice: 15.99,
            startAt: "2026-09-01",
            endAt: "2026-09-30",
            confirmationSku: "AFA-TRKY-4OZ",
            idempotencyKey: "w02-sale-commit-001",
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.kind === "json" ? response.body.value : null)
      .toMatchObject({
        action: "set",
        requestedDiscountedPrice: {
          price: { amount: 15.99, currencyCode: "USD" },
          startAt: "2026-09-01",
          endAt: "2026-09-30",
        },
        writeLifecycle: { state: "verified", verified: true },
      });
    expect(commitSale).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "native-approved",
      "durable-attempt",
      "commit-once",
      "accepted-recorded",
      "canonical-readback",
    ]);
    expect(approvalReason).toBe(
      "確認折扣｜US AFA-TRKY-4OZ｜20 → 15.99 USD｜2026-09-01～2026-09-30",
    );
    expect(executedBinding).toMatchObject({
      family: "sale-price",
      previewKey: "w02-sale-commit-001",
      intents: [{
        operation: "sale_price",
        proposalFingerprint:
          "23dd947004ce7c154aa1c4372423d951bdfc5981f65c8da8417b1c8204419528",
      }],
    });
  });

  it("cancels a Sale Price only with the full SKU and otherwise performs zero writes", async () => {
    const execute = vi.fn(async () => {
      throw new Error("the Write Gate must not run");
    });
    const commitSale = vi.fn(async () => {
      throw new Error("Amazon commit must not run");
    });
    const owner = new ListingPriceMutations({
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-w02-sale-cancel",
      })),
      writeGate: {
        stagePreview: vi.fn(async () => undefined),
        execute,
        reconcile: vi.fn(async () => undefined),
        clearEphemeral: vi.fn(),
      },
      operations: {
        read: vi.fn(async () => priceSnapshot(20)),
        previewStandard: vi.fn(async () => {
          throw new Error("standard preview must not run");
        }),
        commitStandard: vi.fn(async () => {
          throw new Error("standard commit must not run");
        }),
        previewSale: vi.fn(async () => {
          throw new Error("sale preview must not run");
        }),
        commitSale,
      },
    });

    const response = await owner.handle({
      family: "sale-price",
      operation: "commit",
      request: {
        requestId: "w02-sale-cancel-confirmation-001",
        method: "PATCH",
        path: "/api/sp-api/sale-price",
        query: {},
        headers: {},
        body: {
          kind: "json",
          value: {
            marketplaceId: US,
            sellerSku: "AFA-TRKY-4OZ",
            action: "cancel",
            expectedPrice: 20,
            expectedDiscountedPrice: 15.99,
            expectedStartAt: "2026-09-01",
            expectedEndAt: "2026-09-30",
            salePrice: null,
            startAt: null,
            endAt: null,
            idempotencyKey: "w02-sale-cancel-001",
          },
        },
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      kind: "json",
      value: {
        code: "CONFIRMATION_REQUIRED",
        message: "取消折扣前，請重新輸入完整 SKU。",
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(commitSale).not.toHaveBeenCalled();
  });

  it("reconciles an accepted unknown on a later canonical read without replaying the PATCH", async () => {
    const store = await testStore();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "live",
      accountScope: "opaque-w02-reconcile-account",
    }));
    const approveWrite = vi.fn(async () => undefined);
    const writeGate = new MainWriteGate({ store, context, approveWrite });
    const accepted: PriceUpdateResult = {
      mode: "live",
      status: "ACCEPTED",
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      previousPrice: { amount: 13.99, currencyCode: "USD" },
      requestedPrice: { amount: 14.99, currencyCode: "USD" },
      acceptedAt: "2026-08-26T06:20:00.000Z",
      submissionId: "w02-unknown-submission",
      requestId: "w02-unknown-request",
      issues: [],
      notice: "Amazon accepted",
    };
    let canonicalPrice = 13.99;
    const read = vi.fn(async () => priceSnapshot(canonicalPrice));
    const commitStandard = vi.fn(async (_input, fence) => {
      await fence?.assertCurrent();
      context.invalidate("mode-changed");
      return accepted;
    });
    const previewStandard = vi.fn(async () => ({
      mode: "live" as const,
      status: "VALID" as const,
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      previousPrice: { amount: 13.99, currencyCode: "USD" },
      requestedPrice: { amount: 14.99, currencyCode: "USD" },
      validatedAt: "2026-08-26T06:19:00.000Z",
      issues: [],
      notice: "Amazon preview valid",
    }));
    const owner = new ListingPriceMutations({
      context,
      writeGate,
      operations: {
        read,
        previewStandard,
        commitStandard,
        previewSale: vi.fn(async () => {
          throw new Error("sale preview must not run");
        }),
        commitSale: vi.fn(async () => {
          throw new Error("sale commit must not run");
        }),
      },
    });
    const previewRequest = {
      requestId: "w02-reconcile-preview-001",
      method: "POST",
      path: "/api/sp-api/listings",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "AFA-TRKY-4OZ",
          expectedPrice: 13.99,
          newPrice: 14.99,
          idempotencyKey: "w02-reconcile-key-001",
        },
      },
    } satisfies ApiRequest;
    const commitRequest = {
      ...previewRequest,
      requestId: "w02-reconcile-commit-001",
      method: "PATCH",
    } satisfies ApiRequest;

    expect((await owner.handle({
      family: "standard-price",
      operation: "preview",
      request: previewRequest,
    })).status).toBe(200);
    const unknown = await owner.handle({
      family: "standard-price",
      operation: "commit",
      request: commitRequest,
    });

    expect(unknown.status).toBe(503);
    expect(unknown.body.kind === "json" ? unknown.body.value : null)
      .toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(commitStandard).toHaveBeenCalledOnce();

    canonicalPrice = 14.99;
    const canonicalRead = await owner.handle({
      family: "standard-price",
      operation: "read",
      request: {
        requestId: "w02-reconcile-read-001",
        method: "GET",
        path: "/api/sp-api/listings",
        query: { marketplaceId: US, sku: "AFA-TRKY-4OZ" },
        headers: {},
      },
    });
    expect(canonicalRead.status).toBe(200);

    expect((await owner.handle({
      family: "standard-price",
      operation: "preview",
      request: previewRequest,
    })).status).toBe(200);
    const replay = await owner.handle({
      family: "standard-price",
      operation: "commit",
      request: commitRequest,
    });

    expect(replay.status).toBe(200);
    expect(replay.body.kind === "json" ? replay.body.value : null)
      .toMatchObject({
        requestedPrice: { amount: 14.99, currencyCode: "USD" },
        writeLifecycle: { state: "verified", verified: true },
      });
    expect(commitStandard).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledTimes(2);
  });

  it("keeps an unrecognized successful PATCH response unknown and blocks resubmission", async () => {
    const store = await testStore();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "live",
      accountScope: "opaque-w02-unrecognized-status",
    }));
    const writeGate = new MainWriteGate({
      store,
      context,
      approveWrite: async () => undefined,
    });
    const commitOnce = vi.fn<ListingPriceGateway["commitOnce"]>(async () => ({
      ok: true,
      status: 200,
      requestId: "w02-unrecognized-status-request",
      retryAfter: null,
      payload: { status: "PROCESSING", issues: [] },
    }));
    const gateway: ListingPriceGateway = {
      mode: () => "live",
      read: vi.fn(async () => priceSnapshot(13.99)),
      setDemoStandardPrice: vi.fn(),
      setDemoSalePrice: vi.fn(),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w02-unrecognized-preview-request",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce,
    };
    const owner = createListingPriceMutations({ context, writeGate, gateway });
    const previewRequest = {
      requestId: "w02-unrecognized-preview-001",
      method: "POST",
      path: "/api/sp-api/listings",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "AFA-TRKY-4OZ",
          expectedPrice: 13.99,
          newPrice: 14.99,
          idempotencyKey: "w02-unrecognized-key-001",
        },
      },
    } satisfies ApiRequest;
    const commitRequest = {
      ...previewRequest,
      requestId: "w02-unrecognized-commit-001",
      method: "PATCH",
    } satisfies ApiRequest;

    expect((await owner.handle({
      family: "standard-price",
      operation: "preview",
      request: previewRequest,
    })).status).toBe(200);
    const first = await owner.handle({
      family: "standard-price",
      operation: "commit",
      request: commitRequest,
    });
    expect(first.status).toBe(503);
    expect(first.body.kind === "json" ? first.body.value : null)
      .toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    expect((await owner.handle({
      family: "standard-price",
      operation: "preview",
      request: previewRequest,
    })).status).toBe(200);
    const second = await owner.handle({
      family: "standard-price",
      operation: "commit",
      request: commitRequest,
    });
    expect(second.status).toBe(409);
    expect(second.body.kind === "json" ? second.body.value : null)
      .toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(commitOnce).toHaveBeenCalledOnce();
  });
});
