import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ListingContentGateway,
  ListingContentGatewayRead,
  ListingContentPatchDescriptor,
  ListingContentPtdEvidence,
  ListingContentSourceEvidence,
} from "../src/main/amazon/listing-content-gateway";
import type {
  ListingContentSnapshot,
  UpdateListingContentInput,
} from
  "../src/main/amazon/listing-content-types";
import type { ListingWriteExecutionFence } from
  "../src/main/amazon/listing-write-execution-fence";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import {
  createListingContentMutations,
  LISTING_CONTENT_BATCH_VALIDATION_OVERRIDE_AUTHORITY,
} from "../src/main/listing-content-mutations";
import { LocalStore } from "../src/main/local-store";
import {
  MainWriteGate,
  type MainWriteGatePort,
  type MainWriteGateSession,
} from "../src/main/write-gate";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const SELLER_SKU = "AFA-CONTENT-001";
const ASIN = "B012345678";

function sha256Fixture(character: string): string {
  return character.repeat(64);
}

function contentSnapshot(
  mode: "live" | "demo" = "live",
): ListingContentSnapshot {
  const writable = {
    supported: true,
    editable: true,
    required: false,
    minItems: null,
    maxItems: null,
    minLength: 1,
    maxLength: 2_000,
    maxUtf8Bytes: 8_000,
    languageTags: ["en_US"],
    reason: null,
  };
  return {
    mode,
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SELLER_SKU,
    asin: ASIN,
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    title: "Original title",
    itemHighlight: "Original highlight",
    bulletPoints: ["Original bullet"],
    productDescription: "Original description",
    ingredients: "Turkey",
    languageTag: "en_US",
    attributePresence: {
      title: true,
      itemHighlight: true,
      bulletPoints: true,
      productDescription: true,
      ingredients: true,
    },
    capabilities: {
      title: { ...writable },
      itemHighlight: { ...writable },
      bulletPoints: {
        ...writable,
        minItems: 1,
        maxItems: 5,
      },
      productDescription: { ...writable },
      ingredients: { ...writable },
      images: [],
      schemaChecksum: "seller-specific-content-checksum",
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    fetchedAt: "2026-08-27T00:00:00.000Z",
    requestId: "REQ-W06-READ",
    issues: [],
    notice: null,
  };
}

function gatewayRead(
  snapshot: ListingContentSnapshot = contentSnapshot(),
): ListingContentGatewayRead {
  return {
    snapshot,
    fulfillment: "FBA",
    rawContentGuardHash: sha256Fixture("a"),
    capabilityGuardHash: sha256Fixture("b"),
    fbaEvidenceHash: sha256Fixture("c"),
    sourceEvidence: {} as ListingContentSourceEvidence,
    ptdEvidence: {} as ListingContentPtdEvidence,
  };
}

function mutationRequest(
  method: "POST" | "PATCH",
  idempotencyKey: string,
): ApiRequest {
  return {
    requestId: `w06-content-${method}-${idempotencyKey}`,
    method,
    path: "/api/sp-api/listing-content",
    query: {},
    headers: { "content-type": "application/json" },
    body: {
      kind: "json",
      value: {
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        title: "Updated title",
        expectedTitle: "Original title",
        itemHighlight: "Original highlight",
        expectedItemHighlight: "Original highlight",
        bulletPoints: ["Original bullet"],
        expectedBulletPoints: ["Original bullet"],
        productDescription: "Original description",
        expectedProductDescription: "Original description",
        ingredients: "Turkey",
        expectedIngredients: "Turkey",
        idempotencyKey,
        confirmationSku: SELLER_SKU,
      },
    },
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

describe("W06 Listing Content mutation owner", () => {
  it("exposes an INVALID Amazon preview only to an explicit batch override caller", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w06-content-validation-override-account",
    }));
    const issue = {
      code: "8541",
      severity: "ERROR",
      message: "Amazon Validation Preview rejected the requested title.",
      attributeNames: ["item_name"],
    };
    const gateway: ListingContentGateway = {
      mode: () => "live",
      read: async () => gatewayRead(),
      validationPreview: async () => ({
        status: "INVALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-INVALID-PREVIEW",
        issues: [issue],
      }),
      commitOnce: vi.fn(),
      replaceDemoContent: vi.fn(async () => undefined),
    };
    const owner = createListingContentMutations({
      context,
      writeGate: {} as MainWriteGatePort,
      gateway,
    });
    const input: UpdateListingContentInput = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      title: "Updated title",
      expectedTitle: "Original title",
      itemHighlight: "Original highlight",
      expectedItemHighlight: "Original highlight",
      bulletPoints: ["Original bullet"],
      expectedBulletPoints: ["Original bullet"],
      productDescription: "Original description",
      expectedProductDescription: "Original description",
      ingredients: "Turkey",
      expectedIngredients: "Turkey",
    };

    await expect(owner.previewOne(input)).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
    });

    const forgedRouteRequest = mutationRequest(
      "POST",
      "content-route-cannot-force-preview",
    );
    if (forgedRouteRequest.body?.kind !== "json") {
      throw new Error("Expected JSON route body");
    }
    forgedRouteRequest.body.value.allowAmazonValidationFailure = true;
    const forgedRouteResponse = await owner.handle({
      operation: "preview",
      request: forgedRouteRequest,
    });
    expect(forgedRouteResponse.status).toBe(422);
    expect(bodyValue(forgedRouteResponse)).toMatchObject({
      code: "VALIDATION_FAILED",
    });

    const forced = await owner.previewOne(input, {
      validationOverrideAuthority:
        LISTING_CONTENT_BATCH_VALIDATION_OVERRIDE_AUTHORITY,
    });

    expect(forced).toMatchObject({
      status: "INVALID",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      issues: [issue],
    });
    expect(forced.evidence.validationIssuesHash).toHaveLength(64);
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("refuses an INVALID override when every ERROR is removed by the public sanitizer", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w06-content-private-validation-error-account",
    }));
    const gateway: ListingContentGateway = {
      mode: () => "live",
      read: async () => gatewayRead(),
      validationPreview: async () => ({
        status: "INVALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-PRIVATE-INVALID-PREVIEW",
        issues: [{
          code: "8541",
          severity: "ERROR",
          message:
            "See https://sellercentral.amazon.com/?seller_id=A1SELLERID1234",
          attributeNames: ["item_name"],
        }],
      }),
      commitOnce: vi.fn(),
      replaceDemoContent: vi.fn(async () => undefined),
    };
    const owner = createListingContentMutations({
      context,
      writeGate: {} as MainWriteGatePort,
      gateway,
    });
    const input: UpdateListingContentInput = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      title: "Updated title",
      expectedTitle: "Original title",
      itemHighlight: "Original highlight",
      expectedItemHighlight: "Original highlight",
      bulletPoints: ["Original bullet"],
      expectedBulletPoints: ["Original bullet"],
      productDescription: "Original description",
      expectedProductDescription: "Original description",
      ingredients: "Turkey",
      expectedIngredients: "Turkey",
    };

    await expect(owner.previewOne(input, {
      validationOverrideAuthority:
        LISTING_CONTENT_BATCH_VALIDATION_OVERRIDE_AUTHORITY,
    })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
    });
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "INVALID without an ERROR",
      mode: "live" as const,
      status: "INVALID" as const,
      issues: [],
    },
    {
      label: "VALID with an ERROR",
      mode: "live" as const,
      status: "VALID" as const,
      issues: [{
        code: "8541",
        severity: "ERROR",
        message: "Amazon rejected the requested title.",
        attributeNames: ["item_name"],
      }],
    },
    {
      label: "demo INVALID",
      mode: "demo" as const,
      status: "INVALID" as const,
      issues: [{
        code: "8541",
        severity: "ERROR",
        message: "Amazon rejected the requested title.",
        attributeNames: ["item_name"],
      }],
    },
  ])("hard-stops a forced $label receipt", async ({ mode, status, issues }) => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode,
      accountScope: `w06-content-${mode}-invalid-shape-account`,
    }));
    const gateway: ListingContentGateway = {
      mode: () => mode,
      read: async () => gatewayRead(contentSnapshot(mode)),
      validationPreview: async () => ({
        status,
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-UNSAFE-OVERRIDE-PREVIEW",
        issues,
      }),
      commitOnce: vi.fn(),
      replaceDemoContent: vi.fn(async () => undefined),
    };
    const owner = createListingContentMutations({
      context,
      writeGate: {} as MainWriteGatePort,
      gateway,
    });
    const input: UpdateListingContentInput = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      title: "Updated title",
      expectedTitle: "Original title",
      itemHighlight: "Original highlight",
      expectedItemHighlight: "Original highlight",
      bulletPoints: ["Original bullet"],
      expectedBulletPoints: ["Original bullet"],
      productDescription: "Original description",
      expectedProductDescription: "Original description",
      ingredients: "Turkey",
      expectedIngredients: "Turkey",
    };

    await expect(owner.previewOne(input, {
      validationOverrideAuthority:
        LISTING_CONTENT_BATCH_VALIDATION_OVERRIDE_AUTHORITY,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("uses an exact INVALID preview for one explicit single-shot batch attempt", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w06-content-validation-override-attempt-account",
    }));
    let snapshot = contentSnapshot();
    const validationIssue = {
      code: "8541",
      severity: "ERROR",
      message: "Amazon Validation Preview rejected the requested title.",
      attributeNames: ["item_name"],
    };
    const commitOnce = vi.fn(async (
      patch: ListingContentPatchDescriptor,
      fence: ListingWriteExecutionFence,
      recordDispatch: () => Promise<void>,
    ) => {
      expect(patch.expectedCanonicalPatchHash).toBe(sha256Fixture("d"));
      await fence.assertCurrent();
      await recordDispatch();
      snapshot = { ...snapshot, title: "Updated title" };
      return {
        status: "ACCEPTED" as const,
        submissionId: "W06-OVERRIDE-SUBMISSION",
        requestId: "REQ-W06-OVERRIDE-COMMIT",
        issues: [],
      };
    });
    const gateway: ListingContentGateway = {
      mode: () => "live",
      read: async () => gatewayRead(snapshot),
      validationPreview: async () => ({
        status: "INVALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-INVALID-PREVIEW",
        issues: [validationIssue],
      }),
      commitOnce,
      replaceDemoContent: vi.fn(async () => undefined),
    };
    const owner = createListingContentMutations({
      context,
      writeGate: {} as MainWriteGatePort,
      gateway,
    });
    const input: UpdateListingContentInput = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      title: "Updated title",
      expectedTitle: "Original title",
      itemHighlight: "Original highlight",
      expectedItemHighlight: "Original highlight",
      bulletPoints: ["Original bullet"],
      expectedBulletPoints: ["Original bullet"],
      productDescription: "Original description",
      expectedProductDescription: "Original description",
      ingredients: "Turkey",
      expectedIngredients: "Turkey",
    };
    const prepared = await owner.previewOne(input, {
      validationOverrideAuthority:
        LISTING_CONTENT_BATCH_VALIDATION_OVERRIDE_AUTHORITY,
    });
    const session = {
      attempt: vi.fn(async ({ execute }) => execute({
        assertCurrent: async () => undefined,
        recordAccepted: async () => undefined,
        recordDurableEvidence: async () => undefined,
      })),
    } as unknown as MainWriteGateSession;

    await expect(owner.attemptOne(
      input,
      prepared.evidence,
      session,
      "primary",
    )).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(commitOnce).not.toHaveBeenCalled();

    const result = await owner.attemptOne(
      input,
      prepared.evidence,
      session,
      "primary",
      {
        validationOverrideAuthority:
          LISTING_CONTENT_BATCH_VALIDATION_OVERRIDE_AUTHORITY,
      },
    );

    expect(result).toMatchObject({
      status: "ACCEPTED",
      sellerSku: SELLER_SKU,
      requested: { title: "Updated title" },
    });
    expect(commitOnce).toHaveBeenCalledOnce();
  });

  it("rejects a malformed durable replay before exposing it to batch callers", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "demo",
      accountScope: "w06-content-malformed-replay-account",
    }));
    const gateway: ListingContentGateway = {
      mode: () => "demo",
      read: async () => gatewayRead(contentSnapshot("demo")),
      validationPreview: async () => ({
        status: "VALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-MALFORMED-PREVIEW",
        issues: [],
      }),
      commitOnce: vi.fn(),
      replaceDemoContent: vi.fn(async () => undefined),
    };
    const owner = createListingContentMutations({
      context,
      writeGate: {} as MainWriteGatePort,
      gateway,
    });
    const input: UpdateListingContentInput = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      title: "Updated title",
      expectedTitle: "Original title",
      itemHighlight: "Original highlight",
      expectedItemHighlight: "Original highlight",
      bulletPoints: ["Original bullet"],
      expectedBulletPoints: ["Original bullet"],
      productDescription: "Original description",
      expectedProductDescription: "Original description",
      ingredients: "Turkey",
      expectedIngredients: "Turkey",
    };
    const prepared = await owner.previewOne(input);
    const session = {
      attempt: vi.fn(async () => ({
        mode: "demo",
        status: "SIMULATED",
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        previous: structuredClone(prepared.previous),
        requested: structuredClone(prepared.requested),
        changedFields: [...prepared.changedFields],
        acceptedAt: new Date(0).toISOString(),
        submissionId: null,
        requestId: null,
        issues: [],
        notice: "raw durable receipt without canonical lifecycle proof",
        _writeEvidence: {
          ...structuredClone(prepared.evidence),
          previous: structuredClone(prepared.previous),
          requested: structuredClone(prepared.requested),
          proposalFingerprint: prepared.proposalFingerprint,
        },
      })),
    } as unknown as MainWriteGateSession;

    await expect(owner.attemptOne(
      input,
      prepared.evidence,
      session,
      "primary",
    )).rejects.toMatchObject({
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(session.attempt).toHaveBeenCalledOnce();
  });

  it("tolerates legacy confirmationSku and stops before dispatch when native approval is cancelled", async () => {
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w06-content-")),
      "store.json",
    );
    const store = new LocalStore(storePath);
    await store.initialize();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w06-content-cancel-account",
    }));
    const commitOnce = vi.fn(async (
      _patch: ListingContentPatchDescriptor,
      _fence: ListingWriteExecutionFence,
      _recordDispatch: () => Promise<void>,
    ) => ({
      status: "ACCEPTED" as const,
      submissionId: "W06-CONTENT-SUBMISSION",
      requestId: "REQ-W06-COMMIT",
      issues: [],
    }));
    const gateway: ListingContentGateway = {
      mode: () => "live",
      read: async () => gatewayRead(),
      validationPreview: async () => ({
        status: "VALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-PREVIEW",
        issues: [],
      }),
      commitOnce,
      replaceDemoContent: async () => undefined,
    };
    const owner = createListingContentMutations({
      context,
      writeGate: new MainWriteGate({
        store,
        context,
        approveWrite: async () => {
          throw new Error("user cancelled native approval");
        },
      }),
      gateway,
    });
    const idempotencyKey = "w06-content-native-cancel";

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", idempotencyKey),
    })).status).toBe(200);
    const response = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });

    expect(response.status).toBe(409);
    expect(bodyValue(response)).toMatchObject({ code: "ACTION_CANCELLED" });
    expect(commitOnce).not.toHaveBeenCalled();
  });

  it("revalidates exact source evidence after approval and never dispatches drifted content", async () => {
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w06-content-drift-")),
      "store.json",
    );
    const store = new LocalStore(storePath);
    await store.initialize();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w06-content-drift-account",
    }));
    let reads = 0;
    const approveWrite = vi.fn(async () => undefined);
    const commitOnce = vi.fn(async () => ({
      status: "ACCEPTED" as const,
      submissionId: "W06-CONTENT-SUBMISSION",
      requestId: "REQ-W06-COMMIT",
      issues: [],
    }));
    const gateway: ListingContentGateway = {
      mode: () => "live",
      read: async () => {
        reads += 1;
        return {
          ...gatewayRead(),
          rawContentGuardHash: reads >= 3
            ? sha256Fixture("e")
            : sha256Fixture("a"),
        };
      },
      validationPreview: async () => ({
        status: "VALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-PREVIEW",
        issues: [],
      }),
      commitOnce,
      replaceDemoContent: async () => undefined,
    };
    const owner = createListingContentMutations({
      context,
      writeGate: new MainWriteGate({ store, context, approveWrite }),
      gateway,
    });
    const idempotencyKey = "w06-content-source-drift";

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", idempotencyKey),
    })).status).toBe(200);
    const response = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });

    expect(response.status).toBe(409);
    expect(bodyValue(response)).toMatchObject({ code: "PREVIEW_CHANGED" });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(commitOnce).not.toHaveBeenCalled();
  });

  it("records exact DISPATCHED evidence before transport and does not blindly resend an unknown write", async () => {
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w06-content-unknown-")),
      "store.json",
    );
    const store = new LocalStore(storePath);
    await store.initialize();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w06-content-unknown-account",
    }));
    const approveWrite = vi.fn(async () => undefined);
    const commitOnce = vi.fn(async (
      _patch: ListingContentPatchDescriptor,
      fence: ListingWriteExecutionFence,
      recordDispatch: () => Promise<void>,
    ) => {
      await fence.assertCurrent();
      await recordDispatch();
      const durableStore = await readFile(storePath, "utf8");
      expect(durableStore).toContain('"status":"DISPATCHED"');
      expect(durableStore).toContain('"_writeEvidence"');
      expect(durableStore).toContain('"proposalFingerprint"');
      return {
        status: "UNKNOWN" as const,
        submissionId: null,
        requestId: "REQ-W06-UNKNOWN",
        issues: [],
      };
    });
    const gateway: ListingContentGateway = {
      mode: () => "live",
      read: async () => gatewayRead(),
      validationPreview: async () => ({
        status: "VALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-PREVIEW",
        issues: [],
      }),
      commitOnce,
      replaceDemoContent: async () => undefined,
    };
    const owner = createListingContentMutations({
      context,
      writeGate: new MainWriteGate({ store, context, approveWrite }),
      gateway,
    });
    const idempotencyKey = "w06-content-unknown-write";

    await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", idempotencyKey),
    });
    const first = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });
    const second = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });

    expect(first.status).toBe(503);
    expect(bodyValue(first)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(JSON.stringify(bodyValue(first))).not.toContain("_writeEvidence");
    expect(second.status).toBe(409);
    expect(commitOnce).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledOnce();
  });

  it("reconciles a dispatched write after restart and never commits the same idempotency key again", async () => {
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w06-content-restart-")),
      "store.json",
    );
    const accountScope = "w06-content-restart-account";
    let snapshot = contentSnapshot();
    const commitOnce = vi.fn(async (
      _patch: ListingContentPatchDescriptor,
      fence: ListingWriteExecutionFence,
      recordDispatch: () => Promise<void>,
    ) => {
      await fence.assertCurrent();
      await recordDispatch();
      snapshot = { ...snapshot, title: "Updated title" };
      return {
        status: "UNKNOWN" as const,
        submissionId: null,
        requestId: "REQ-W06-RESTART-UNKNOWN",
        issues: [],
      };
    });
    const gateway: ListingContentGateway = {
      mode: () => "live",
      read: async () => gatewayRead(snapshot),
      validationPreview: async () => ({
        status: "VALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-RESTART-PREVIEW",
        issues: [],
      }),
      commitOnce,
      replaceDemoContent: async () => undefined,
    };
    const firstStore = new LocalStore(storePath);
    await firstStore.initialize();
    const firstContext = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope,
    }));
    const firstGate = new MainWriteGate({
      store: firstStore,
      context: firstContext,
      approveWrite: async () => undefined,
    });
    const firstOwner = createListingContentMutations({
      context: firstContext,
      writeGate: firstGate,
      gateway,
    });
    const input = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      title: "Updated title",
      expectedTitle: "Original title",
      itemHighlight: "Original highlight",
      expectedItemHighlight: "Original highlight",
      bulletPoints: ["Original bullet"],
      expectedBulletPoints: ["Original bullet"],
      productDescription: "Original description",
      expectedProductDescription: "Original description",
      ingredients: "Turkey",
      expectedIngredients: "Turkey",
    } satisfies UpdateListingContentInput;
    const prepared = await firstOwner.previewOne(input);
    const idempotencyKey = "w06-content-restart-unknown";

    expect((await firstOwner.handle({
      operation: "preview",
      request: mutationRequest("POST", idempotencyKey),
    })).status).toBe(200);
    const uncertain = await firstOwner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });

    expect(uncertain.status).toBe(502);
    expect(bodyValue(uncertain)).toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(commitOnce).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(storePath, "utf8"))).toMatchObject({
      ledger: {
        [idempotencyKey]: {
          state: "unknown",
          response: {
            status: "DISPATCHED",
            marketplaceId: MARKETPLACE_ID,
            sellerSku: SELLER_SKU,
          },
        },
      },
    });

    const restartedStore = new LocalStore(storePath);
    await restartedStore.initialize();
    const restartedContext = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope,
    }));
    const restartedGate = new MainWriteGate({
      store: restartedStore,
      context: restartedContext,
      approveWrite: async () => undefined,
    });
    const restartedOwner = createListingContentMutations({
      context: restartedContext,
      writeGate: restartedGate,
      gateway,
    });
    const canonicalRead = await restartedOwner.handle({
      operation: "read",
      request: {
        requestId: "w06-content-read-after-restart",
        method: "GET",
        path: "/api/sp-api/listing-content",
        query: { marketplaceId: MARKETPLACE_ID, sku: SELLER_SKU },
        headers: {},
      },
    });

    expect(canonicalRead.status).toBe(200);
    expect(bodyValue(canonicalRead)).toMatchObject({ title: "Updated title" });
    expect(JSON.parse(await readFile(storePath, "utf8"))).toMatchObject({
      ledger: { [idempotencyKey]: { state: "completed" } },
    });

    const contextAfterRestart = await restartedContext.capture(MARKETPLACE_ID);
    const binding = {
      family: "content" as const,
      previewKey: idempotencyKey,
      context: contextAfterRestart,
      intents: [{
        intentId: "primary",
        operation: "content" as const,
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        idempotencyKey,
        proposalFingerprint: prepared.proposalFingerprint,
      }] as const,
    };
    await restartedGate.stagePreview(binding);
    const cached = await restartedGate.execute({
      binding,
      approvalReason: "verify reconciled content cache",
      run: (session) => restartedOwner.attemptOne(
        input,
        prepared.evidence,
        session,
        "primary",
      ),
    });

    expect(cached).toMatchObject({
      status: "ACCEPTED",
      requested: { title: "Updated title" },
      writeLifecycle: {
        state: "verified",
        verified: true,
        authoritative: true,
      },
    });
    expect(cached).not.toHaveProperty("_writeEvidence");
    expect(commitOnce).toHaveBeenCalledOnce();
  });

  it("returns a verified public result without leaking durable write evidence", async () => {
    const storePath = join(
      await mkdtemp(join(tmpdir(), "amz-api-w06-content-success-")),
      "store.json",
    );
    const store = new LocalStore(storePath);
    await store.initialize();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "w06-content-success-account",
    }));
    let snapshot = contentSnapshot();
    const commitOnce = vi.fn(async (
      _patch: ListingContentPatchDescriptor,
      fence: ListingWriteExecutionFence,
      recordDispatch: () => Promise<void>,
    ) => {
      await fence.assertCurrent();
      await recordDispatch();
      snapshot = { ...snapshot, title: "Updated title" };
      return {
        status: "ACCEPTED" as const,
        submissionId: "W06-CONTENT-SUBMISSION",
        requestId: "REQ-W06-COMMIT",
        issues: [],
      };
    });
    const gateway: ListingContentGateway = {
      mode: () => "live",
      read: async () => gatewayRead(snapshot),
      validationPreview: async () => ({
        status: "VALID",
        canonicalPatchHash: sha256Fixture("d"),
        requestId: "REQ-W06-PREVIEW",
        issues: [],
      }),
      commitOnce,
      replaceDemoContent: async () => undefined,
    };
    const owner = createListingContentMutations({
      context,
      writeGate: new MainWriteGate({
        store,
        context,
        approveWrite: async () => undefined,
      }),
      gateway,
    });
    const idempotencyKey = "w06-content-successful-write";

    await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", idempotencyKey),
    });
    const response = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", idempotencyKey),
    });
    const body = bodyValue(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ACCEPTED",
      changedFields: ["title"],
      writeLifecycle: { state: "verified", authoritative: true },
    });
    expect(body).not.toHaveProperty("_writeEvidence");
    expect(commitOnce).toHaveBeenCalledOnce();
    expect(await readFile(storePath, "utf8")).toContain('"_writeEvidence"');
  });
});
