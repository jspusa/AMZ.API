import { mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createListingImageMutations,
  ListingImageMutations,
} from "../src/main/listing-image-mutations";
import type {
  ListingImageGateway,
  ListingImageSourceEvidence,
} from "../src/main/amazon/listing-image-gateway";
import type { ListingImageSnapshot, ListingImageUpdateResult } from
  "../src/main/amazon/listing-image-types";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { LocalStore } from "../src/main/local-store";
import { MainWriteGate } from "../src/main/write-gate";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const SELLER_SKU = "AFA-TRKY-4OZ";
const IMAGE_ATTRIBUTES = [
  "main_product_image_locator",
  ...Array.from({ length: 9 }, (_, index) => `other_product_image_locator_${index + 1}`),
];

const PREVIOUS_URLS = [
  "https://images.example.com/main.jpg",
  "https://images.example.com/side-1.jpg",
  ...Array.from({ length: 8 }, () => null),
];

async function testStore(): Promise<LocalStore> {
  const directory = await mkdtemp(join(tmpdir(), "amz-w03-images-"));
  const store = new LocalStore(join(directory, "data.json"));
  await store.initialize();
  return store;
}

function imageSnapshot(urls: readonly (string | null)[]): ListingImageSnapshot {
  return {
    mode: "live",
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SELLER_SKU,
    asin: "B09S5VY2JS",
    productType: "PET_FOOD",
    title: "AFreschi Turkey Tendon Twists",
    attributesPresent: true,
    images: IMAGE_ATTRIBUTES.map((attributeName, index) => ({
      attributeName,
      label: index === 0 ? "MAIN" : `PT${index}`,
      url: urls[index] ?? null,
      capability: {
        attributeName,
        label: index === 0 ? "MAIN" : `PT${index}`,
        supported: true,
        editable: true,
        required: index === 0,
        reason: null,
      },
    })),
    fetchedAt: "2026-08-26T00:00:00.000Z",
    requestId: "listing-image-read-001",
    issues: [],
    notice: "canonical image snapshot",
  };
}

function mutationRequest(
  method: "POST" | "PATCH",
  requestId: string,
  value: Record<string, unknown>,
): ApiRequest {
  return {
    requestId,
    method,
    path: "/api/sp-api/listing-images",
    query: {},
    headers: {},
    body: { kind: "json", value },
  };
}

async function lookupToken(owner: Pick<ListingImageMutations, "handle">, marketplaceId = MARKETPLACE_ID, sellerSku = SELLER_SKU): Promise<string> {
  const read = await owner.handle({ operation: "read", request: {
    requestId: "image-snapshot-lookup", method: "GET", path: "/api/sp-api/listing-images",
    query: { marketplaceId, sku: sellerSku }, headers: {},
  } });
  expect(read.status).toBe(200);
  const value = read.body.kind === "json" ? read.body.value as Record<string, unknown> : {};
  expect(value.snapshotToken).toEqual(expect.stringMatching(/^image-snapshot\./u));
  return value.snapshotToken as string;
}

describe("listing image mutations", () => {
  it("commits a previewed image change without retyping SKU and verifies its canonical readback after one native approval", async () => {
    const store = await testStore();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "image-native-confirmation-account",
    }));
    const approveWrite = vi.fn(async (_reason: string) => undefined);
    const writeGate = new MainWriteGate({ store, context, approveWrite });
    const urls = [...PREVIOUS_URLS];
    urls[1] = "https://images.example.com/native-confirmed.jpg";
    urls[9] = "https://images.example.com/native-confirmed-tenth.jpg";
    let canonicalUrls = [...PREVIOUS_URLS];
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(canonicalUrls),
        sourceEvidence: {} as ListingImageSourceEvidence,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true, status: 200, requestId: "native-image-preview", retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce: vi.fn(async () => {
        canonicalUrls = [...urls];
        return { ok: true, status: 200, requestId: "native-image-commit", retryAfter: null,
          payload: { status: "ACCEPTED", submissionId: "native-image-submission", issues: [] } };
      }),
      replaceDemoImages: vi.fn(),
    };
    const owner = createListingImageMutations({ context, writeGate, gateway });
    const body = { marketplaceId: MARKETPLACE_ID, sellerSku: SELLER_SKU, snapshotToken: await lookupToken(owner),
      expectedUrls: [...PREVIOUS_URLS], urls, idempotencyKey: "image-native-confirmation-001" };
    expect((await owner.handle({ operation: "preview", request: mutationRequest("POST", "native-preview", body) })).status).toBe(200);
    expect(approveWrite).not.toHaveBeenCalled();
    const committed = await owner.handle({ operation: "commit", request: mutationRequest("PATCH", "native-commit", body) });
    expect(committed.status).toBe(200);
    expect(committed.body.kind === "json" ? committed.body.value : null).toMatchObject({
      status: "ACCEPTED", sellerSku: SELLER_SKU, changedSlots: [1, 9],
      writeLifecycle: { state: "verified", verified: true, authoritative: true },
    });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(approveWrite.mock.calls[0]?.[0]).toContain(`${SELLER_SKU}｜位置 2、10`);
    expect(gateway.validationPreview).toHaveBeenCalledTimes(2);
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    const read = await owner.handle({ operation: "read", request: {
      requestId: "native-read", method: "GET", path: "/api/sp-api/listing-images",
      query: { marketplaceId: MARKETPLACE_ID, sku: SELLER_SKU }, headers: {},
    } });
    expect(read.body.kind === "json" ? read.body.value : null).toMatchObject({ confirmationMode: "native" });
  });

  it("preserves GB in the UK native approval reason", async () => {
    const ukMarketplaceId = "A1F83G8C2ARO7P" as const;
    let approvalReason = "";
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: ukMarketplaceId,
      mode: "demo",
      accountScope: "opaque-w03-image-uk",
    }));
    const writeGate = {
      stagePreview: vi.fn(async () => undefined),
      execute: vi.fn(async (input: {
        approvalReason: string | ((verificationCode: string) => string);
      }) => {
        approvalReason = typeof input.approvalReason === "string"
          ? input.approvalReason
          : input.approvalReason("654321");
        return {
          mode: "demo",
          status: "SIMULATED",
          marketplaceId: ukMarketplaceId,
          sellerSku: SELLER_SKU,
          previousUrls: [...PREVIOUS_URLS],
          requestedUrls: [...PREVIOUS_URLS],
          changedSlots: [1],
          completedAt: "2026-08-26T00:00:00.000Z",
          submissionId: null,
          requestId: null,
          issues: [],
          notice: "simulated",
        };
      }),
      reconcile: vi.fn(async () => undefined),
      clearEphemeral: vi.fn(),
    };
    const owner = new ListingImageMutations({
      context,
      writeGate: writeGate as never,
      operations: {
        read: vi.fn(async () => ({ snapshot: { ...imageSnapshot(PREVIOUS_URLS), mode: "demo" as const, marketplaceId: ukMarketplaceId },
          sourceEvidence: {} as ListingImageSourceEvidence, fulfillment: "FBA" as const })),
        preview: vi.fn(),
        commit: vi.fn(),
      },
    });
    const requestedUrls = [...PREVIOUS_URLS];
    requestedUrls[1] = "https://images.example.com/uk-side-1.jpg";

    const response = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", "w03-image-uk-confirmation", {
        marketplaceId: ukMarketplaceId,
        sellerSku: SELLER_SKU,
        expectedUrls: [...PREVIOUS_URLS],
        urls: requestedUrls,
        confirmationSku: SELLER_SKU,
        snapshotToken: await lookupToken(owner, ukMarketplaceId),
        idempotencyKey: "w03-image-uk-001",
      }),
    });

    expect(response.status).toBe(200);
    expect(approvalReason).toBe(
      `確認圖片｜GB ${SELLER_SKU}｜位置 2｜驗證碼 654321`,
    );
  });

  it("sanitizes successful image read, preview, and commit metadata", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "opaque-w03-image-public-sanitize",
    }));
    const safeIssue = {
      code: "SAFE_IMAGE_WARNING",
      severity: "WARNING",
      message: "Image warning; verify in Seller Central.",
      attributeNames: ["other_product_image_locator_1"],
      categories: ["INVALID_ATTRIBUTE"],
      marketplaceIds: [MARKETPLACE_ID],
    };
    const hostileIssue = {
      code: "HOSTILE_IMAGE_WARNING",
      severity: "WARNING",
      message:
        "Bearer secret-token https://example.test/?access_token=secret-token",
      attributeNames: ["other_product_image_locator_1"],
      categories: ["INVALID_ATTRIBUTE"],
      marketplaceIds: [MARKETPLACE_ID],
    };
    const updateResult: ListingImageUpdateResult = {
      mode: "live",
      status: "ACCEPTED",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      previousUrls: [...PREVIOUS_URLS],
      requestedUrls: [...PREVIOUS_URLS],
      changedSlots: [1],
      completedAt: "2026-08-26T00:00:00.000Z",
      submissionId:
        "https://example.test/?refresh_token=private-submission",
      requestId: "unsafe\nrequest-id",
      issues: [safeIssue, hostileIssue],
      notice: "accepted",
    };
    const writeGate = {
      stagePreview: vi.fn(async () => undefined),
      execute: vi.fn(async () => updateResult),
      reconcile: vi.fn(async () => undefined),
      clearEphemeral: vi.fn(),
    };
    const snapshot = imageSnapshot(PREVIOUS_URLS);
    snapshot.requestId = "unsafe\nrequest-id";
    snapshot.issues = [safeIssue, hostileIssue];
    const owner = new ListingImageMutations({
      context,
      writeGate: writeGate as never,
      operations: {
        read: vi.fn(async () => ({
          snapshot,
          sourceEvidence: {} as ListingImageSourceEvidence,
          fulfillment: "FBA" as const,
        })),
        preview: vi.fn(async () => ({ ...updateResult, status: "VALID" as const })),
        commit: vi.fn(),
      },
    });
    const requestedUrls = [...PREVIOUS_URLS];
    requestedUrls[1] = "https://images.example.com/sanitized-side-1.jpg";
    const body = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedUrls: [...PREVIOUS_URLS],
      urls: requestedUrls,
      confirmationSku: SELLER_SKU,
      snapshotToken: "",
      idempotencyKey: "w03-image-public-sanitize-001",
    };

    const read = await owner.handle({
      operation: "read",
      request: {
        requestId: "w03-image-public-read",
        method: "GET",
        path: "/api/sp-api/listing-images",
        query: { marketplaceId: MARKETPLACE_ID, sku: SELLER_SKU },
        headers: {},
      },
    });
    body.snapshotToken = (read.body.value as { snapshotToken: string }).snapshotToken;
    const preview = await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", "w03-image-public-preview", body),
    });
    const commit = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", "w03-image-public-commit", body),
    });

    for (const response of [read, preview, commit]) {
      expect(response.status).toBe(200);
      const value = response.body.kind === "json"
        ? response.body.value as Record<string, unknown>
        : {};
      expect(value.requestId).toBeNull();
      expect(value.issues).toEqual([safeIssue]);
      expect(JSON.stringify(value)).not.toContain("secret-token");
    }
    expect(commit.body.kind === "json" ? commit.body.value : null)
      .toMatchObject({ submissionId: null });
  });

  it.each([undefined, "WRONG-LEGACY-SKU"])("returns ACTION_CANCELLED before dispatch without relying on legacy confirmationSku (%s)", async legacyConfirmation => {
    const previousUrls = [
      "https://images.example.com/main.jpg",
      ...Array.from({ length: 9 }, () => null),
    ];
    const requestedUrls = [
      previousUrls[0],
      "https://images.example.com/side-1.jpg",
      ...Array.from({ length: 8 }, () => null),
    ];
    const commitOnce = vi.fn(async () => {
      throw new Error("gateway commit must not run after approval cancellation");
    });
    const gateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: {
          mode: "live",
          marketplaceId: MARKETPLACE_ID,
          sellerSku: SELLER_SKU,
          asin: "B09S5VY2JS",
          productType: "PET_FOOD",
          title: "AFreschi Turkey Tendon Twists",
          attributesPresent: true,
          images: IMAGE_ATTRIBUTES.map((attributeName, index) => ({
            attributeName,
            label: index === 0 ? "MAIN" : `PT${index}`,
            url: previousUrls[index],
            capability: {
              attributeName,
              label: index === 0 ? "MAIN" : `PT${index}`,
              supported: true,
              editable: true,
              required: index === 0,
              reason: null,
            },
          })),
          fetchedAt: "2026-08-26T00:00:00.000Z",
          requestId: "listing-image-read-001",
          issues: [],
          notice: "canonical image snapshot",
        },
        sourceEvidence: {},
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "listing-image-preview-001",
        retryAfter: null,
        payload: { status: "VALID", submissionId: "preview-001", issues: [] },
      })),
      commitOnce,
      replaceDemoImages: vi.fn(async () => {
        throw new Error("demo replacement must not run in live mode");
      }),
    };
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "opaque-w03-image-cancel",
    }));
    const ledger = {
      runIdempotentOperation: vi.fn(async () => {
        throw new Error("ledger must not be claimed after approval cancellation");
      }),
      assertIdempotentOperationsAvailable: vi.fn(async () => undefined),
      reconcileIdempotentOperations: vi.fn(async () => undefined),
    };
    const approveWrite = vi.fn(async () => {
      throw new Error("native approval cancelled");
    });
    const writeGate = new MainWriteGate({
      store: ledger as never,
      context,
      approveWrite,
    });
    const mutations = createListingImageMutations({
      context,
      writeGate,
      gateway: gateway as never,
    });
    const body = {
      kind: "json" as const,
      value: {
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        expectedUrls: previousUrls,
        urls: requestedUrls,
        snapshotToken: await lookupToken(mutations),
        idempotencyKey: "w03-image-native-cancel-001",
      },
    };

    const preview = await mutations.handle({
      operation: "preview",
      request: {
        requestId: "w03-image-preview-native-cancel-001",
        method: "POST",
        path: "/api/sp-api/listing-images",
        query: {},
        headers: {},
        body,
      },
    });
    expect(preview.status).toBe(200);

    const cancelled = await mutations.handle({
      operation: "commit",
      request: {
        requestId: "w03-image-commit-native-cancel-001",
        method: "PATCH",
        path: "/api/sp-api/listing-images",
        query: {},
        headers: {},
        body: {
          ...body,
          value: { ...body.value, ...(legacyConfirmation === undefined ? {} : { confirmationSku: legacyConfirmation }) },
        },
      },
    });

    expect(cancelled.status).toBe(409);
    expect(cancelled.body).toEqual({
      kind: "json",
      value: expect.objectContaining({ code: "ACTION_CANCELLED" }),
    });
    expect(commitOnce).not.toHaveBeenCalled();
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(ledger.runIdempotentOperation).not.toHaveBeenCalled();
  });

  it.each([
    ["missing preview", "PREVIEW_EXPIRED", 0],
    ["expired preview", "PREVIEW_EXPIRED", 0],
    ["changed proposal", "PREVIEW_CHANGED", 0],
    ["changed context", "SP_CONTEXT_INVALIDATED", 0],
    ["changed context during approval", "SP_CONTEXT_INVALIDATED", 1],
    ["new lookup after preview", "IMAGE_SNAPSHOT_CHANGED", 0],
    ["replacement token without preview", "PREVIEW_CHANGED", 0],
    ["new lookup during approval", "IMAGE_SNAPSHOT_CHANGED", 1],
    ["stale images", "STALE_LISTING", 1],
    ["wrong canonical SKU", "LISTING_IDENTITY_MISMATCH", 1],
    ["changed canonical ASIN", "LISTING_IDENTITY_MISMATCH", 1],
    ["changed product type", "LISTING_IDENTITY_MISMATCH", 1],
    ["ASIN changed during approval", "LISTING_IDENTITY_MISMATCH", 1],
    ["product type changed during approval", "LISTING_IDENTITY_MISMATCH", 1],
    ["read-only PTD position", "IMAGE_FIELD_READ_ONLY", 1],
  ] as const)("blocks %s without typed SKU and sends no image write", async (failure, code, approvalCount) => {
    const store = await testStore();
    const claim = vi.spyOn(store, "runIdempotentOperation");
    let now = 0;
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID, mode: "live", accountScope: "image-native-safety-account",
    }));
    const approveWrite = vi.fn(async () => {
      if (failure === "changed context during approval") context.invalidate("lock-screen");
      if (failure === "new lookup during approval") await lookupToken(owner);
      if (failure === "ASIN changed during approval") canonical = { ...canonical, asin: "B000000002" };
      if (failure === "product type changed during approval") canonical = { ...canonical, productType: "PET_SUPPLIES" };
    });
    const writeGate = new MainWriteGate({ store, context, approveWrite, now: () => now });
    let canonical = imageSnapshot(PREVIOUS_URLS);
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({ snapshot: canonical, sourceEvidence: {} as ListingImageSourceEvidence, fulfillment: "FBA" as const })),
      validationPreview: vi.fn(async () => ({ ok: true, status: 200, requestId: "image-safety-preview", retryAfter: null,
        payload: { status: "VALID", issues: [] } })),
      commitOnce: vi.fn(async () => { throw new Error("unsafe image write must not dispatch"); }),
      replaceDemoImages: vi.fn(),
    };
    const owner = createListingImageMutations({ context, writeGate, gateway });
    const urls = [...PREVIOUS_URLS];
    urls[1] = "https://images.example.com/safety-new.jpg";
    const body = { marketplaceId: MARKETPLACE_ID, sellerSku: SELLER_SKU, snapshotToken: await lookupToken(owner),
      expectedUrls: [...PREVIOUS_URLS], urls, idempotencyKey: "image-native-safety-001" };
    if (failure !== "missing preview") {
      expect((await owner.handle({ operation: "preview", request: mutationRequest("POST", "safety-preview", body) })).status).toBe(200);
    }
    if (failure === "expired preview") now = 120001;
    if (failure === "changed proposal") body.urls = [urls[0], "https://images.example.com/different-proposal.jpg", ...urls.slice(2)];
    if (failure === "changed context") context.invalidate("lock-screen");
    if (failure === "new lookup after preview") await lookupToken(owner);
    if (failure === "replacement token without preview") body.snapshotToken = await lookupToken(owner);
    if (failure === "stale images") canonical = imageSnapshot([PREVIOUS_URLS[0], "https://images.example.com/changed-elsewhere.jpg", ...PREVIOUS_URLS.slice(2)]);
    if (failure === "wrong canonical SKU") canonical = { ...canonical, sellerSku: "OTHER-SKU" };
    if (failure === "changed canonical ASIN") canonical = { ...canonical, asin: "B000000002" };
    if (failure === "changed product type") canonical = { ...canonical, productType: "PET_SUPPLIES" };
    if (failure === "read-only PTD position") canonical.images[1].capability.editable = false;
    const response = await owner.handle({ operation: "commit", request: mutationRequest("PATCH", "safety-commit", body) });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.kind === "json" ? response.body.value : null).toMatchObject({ code });
    expect(approveWrite).toHaveBeenCalledTimes(approvalCount);
    expect(gateway.commitOnce).not.toHaveBeenCalled();
    expect(gateway.replaceDemoImages).not.toHaveBeenCalled();
    if (failure === "new lookup during approval") expect(claim).not.toHaveBeenCalled();
  });

  it.each(["ASIN", "product type"])("rejects %s drift between lookup and preview even when renderer supplies a replacement identity", async field => {
    const store = await testStore();
    const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: MARKETPLACE_ID, mode: "live", accountScope: "image-read-preview-identity" }));
    const approveWrite = vi.fn(async () => undefined);
    const writeGate = new MainWriteGate({ store, context, approveWrite });
    let canonical = imageSnapshot(PREVIOUS_URLS);
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({ snapshot: canonical, sourceEvidence: {} as ListingImageSourceEvidence, fulfillment: "FBA" as const })),
      validationPreview: vi.fn(), commitOnce: vi.fn(), replaceDemoImages: vi.fn(),
    };
    const owner = createListingImageMutations({ context, writeGate, gateway });
    const snapshotToken = await lookupToken(owner);
    canonical = field === "ASIN" ? { ...canonical, asin: "B000000002" } : { ...canonical, productType: "PET_SUPPLIES" };
    const response = await owner.handle({ operation: "preview", request: mutationRequest("POST", "drifted-image-preview", {
      marketplaceId: MARKETPLACE_ID, sellerSku: SELLER_SKU, snapshotToken,
      expectedUrls: [...PREVIOUS_URLS], urls: [PREVIOUS_URLS[0], "https://images.example.com/new.jpg", ...PREVIOUS_URLS.slice(2)],
      idempotencyKey: "image-drifted-preview-001",
      expectedImageIdentity: { asin: canonical.asin, productType: canonical.productType },
    }) });
    expect(response.status).toBe(409);
    expect(response.body.value).toMatchObject({ code: "LISTING_IDENTITY_MISMATCH" });
    expect(gateway.validationPreview).not.toHaveBeenCalled();
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", "IMAGE_SNAPSHOT_REQUIRED"],
    ["forged", "IMAGE_SNAPSHOT_CHANGED"],
    ["another SKU", "LISTING_IDENTITY_MISMATCH"],
    ["different old images", "STALE_LISTING"],
  ] as const)("rejects a %s lookup binding before Amazon preview or native approval", async (failure, code) => {
    const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: MARKETPLACE_ID, mode: "live", accountScope: "image-token-validation" }));
    const approveWrite = vi.fn(async () => undefined);
    const writeGate = new MainWriteGate({ store: await testStore(), context, approveWrite });
    const gateway: ListingImageGateway = {
      mode: () => "live", read: vi.fn(async () => ({ snapshot: imageSnapshot(PREVIOUS_URLS), sourceEvidence: {} as ListingImageSourceEvidence, fulfillment: "FBA" as const })),
      validationPreview: vi.fn(), commitOnce: vi.fn(), replaceDemoImages: vi.fn(),
    };
    const owner = createListingImageMutations({ context, writeGate, gateway });
    const body: Record<string, unknown> = { marketplaceId: MARKETPLACE_ID, sellerSku: SELLER_SKU,
      snapshotToken: await lookupToken(owner), expectedUrls: [...PREVIOUS_URLS],
      urls: [PREVIOUS_URLS[0], "https://images.example.com/new.jpg", ...PREVIOUS_URLS.slice(2)], idempotencyKey: "image-token-validation-001" };
    if (failure === "missing") delete body.snapshotToken;
    if (failure === "forged") body.snapshotToken = "image-snapshot.00000000-0000-4000-8000-000000000000";
    if (failure === "another SKU") body.sellerSku = "OTHER-SKU";
    if (failure === "different old images") body.expectedUrls = ["https://images.example.com/forged-old.jpg", ...PREVIOUS_URLS.slice(1)];
    const response = await owner.handle({ operation: "preview", request: mutationRequest("POST", "image-token-validation", body) });
    expect(response.status).toBe(409);
    expect(response.body.value).toMatchObject({ code });
    expect(gateway.validationPreview).not.toHaveBeenCalled();
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("keeps a contradictory PATCH receipt unknown and never sends it twice", async () => {
    const store = await testStore();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "opaque-w03-image-unknown",
    }));
    const writeGate = new MainWriteGate({
      store,
      context,
      approveWrite: async () => undefined,
    });
    const commitOnce = vi.fn<ListingImageGateway["commitOnce"]>(async () => ({
      ok: false,
      status: 400,
      requestId: "w03-image-contradictory-receipt",
      retryAfter: null,
      payload: {
        status: "ACCEPTED",
        submissionId: "w03-image-contradictory-submission",
        issues: [],
      },
    }));
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(PREVIOUS_URLS),
        sourceEvidence: {} as ListingImageSourceEvidence,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-image-preview-valid",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce,
      replaceDemoImages: vi.fn(async () => undefined),
    };
    const owner = createListingImageMutations({ context, writeGate, gateway });
    const requestedUrls = [...PREVIOUS_URLS];
    requestedUrls[1] = "https://images.example.com/new-side-1.jpg";
    const value = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedUrls: [...PREVIOUS_URLS],
      urls: requestedUrls,
      snapshotToken: await lookupToken(owner),
      idempotencyKey: "w03-image-unknown-001",
    };

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", "w03-image-preview-unknown-001", value),
    })).status).toBe(200);
    const first = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", "w03-image-commit-unknown-001", value),
    });
    expect(first.status).toBe(503);
    expect(first.body.kind === "json" ? first.body.value : null)
      .toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", "w03-image-preview-unknown-002", value),
    })).status).toBe(200);
    const second = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", "w03-image-commit-unknown-002", value),
    });
    expect(second.status).toBe(409);
    expect(second.body.kind === "json" ? second.body.value : null)
      .toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(commitOnce).toHaveBeenCalledOnce();
  });

  it("reconciles an accepted image write on a later exact canonical GET", async () => {
    const store = await testStore();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "opaque-w03-image-reconcile",
    }));
    const approveWrite = vi.fn(async () => undefined);
    const writeGate = new MainWriteGate({ store, context, approveWrite });
    const requestedUrls = [...PREVIOUS_URLS];
    requestedUrls[1] = "https://images.example.com/reconciled-side-1.jpg";
    let canonicalUrls = [...PREVIOUS_URLS];
    const commitOnce = vi.fn<ListingImageGateway["commitOnce"]>(async () => {
      context.invalidate("credentials-saved");
      return {
        ok: true,
        status: 200,
        requestId: "w03-image-accepted-request",
        retryAfter: null,
        payload: {
          status: "ACCEPTED",
          submissionId: "w03-image-accepted-submission",
          issues: [],
        },
      };
    });
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(canonicalUrls),
        sourceEvidence: {} as ListingImageSourceEvidence,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-image-preview-valid",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce,
      replaceDemoImages: vi.fn(async () => undefined),
    };
    const owner = createListingImageMutations({ context, writeGate, gateway });
    const idempotencyKey = "w03-image-reconcile-001";
    const value = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedUrls: [...PREVIOUS_URLS],
      urls: requestedUrls,
      snapshotToken: await lookupToken(owner),
      idempotencyKey,
    };

    expect((await owner.handle({
      operation: "preview",
      request: mutationRequest("POST", "w03-image-preview-reconcile", value),
    })).status).toBe(200);
    const unknown = await owner.handle({
      operation: "commit",
      request: mutationRequest("PATCH", "w03-image-commit-reconcile", value),
    });
    expect(unknown.status).toBe(503);
    expect(unknown.body.kind === "json" ? unknown.body.value : null)
      .toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(commitOnce).toHaveBeenCalledOnce();

    canonicalUrls = [...requestedUrls];
    const canonicalRead = await owner.handle({
      operation: "read",
      request: {
        requestId: "w03-image-read-reconcile",
        method: "GET",
        path: "/api/sp-api/listing-images",
        query: { marketplaceId: MARKETPLACE_ID, sku: SELLER_SKU },
        headers: {},
      },
    });
    expect(canonicalRead.status).toBe(200);

    const reconciledContext = await context.capture(MARKETPLACE_ID);
    const proposalFingerprint = createHash("sha256")
      .update(JSON.stringify([
        MARKETPLACE_ID,
        SELLER_SKU,
        PREVIOUS_URLS,
        requestedUrls,
        value.snapshotToken,
        "B09S5VY2JS",
        "PET_FOOD",
      ]))
      .digest("hex");
    const binding = {
      family: "images" as const,
      previewKey: idempotencyKey,
      context: reconciledContext,
      intents: [{
        intentId: "primary",
        operation: "images" as const,
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        idempotencyKey,
        proposalFingerprint,
      }] as const,
    };
    const unexpectedReplay = vi.fn(async () => {
      throw new Error("a reconciled image write must not replay the PATCH");
    });
    await writeGate.stagePreview(binding);
    const cached = await writeGate.execute({
      binding,
      approvalReason: "verify reconciled cache",
      run: (session) => session.attempt({
        intentId: "primary",
        execute: unexpectedReplay,
      }),
    });

    expect(cached).toMatchObject({
      status: "ACCEPTED",
      requestedUrls,
      writeLifecycle: {
        state: "verified",
        verified: true,
        authoritative: true,
      },
    });
    expect(unexpectedReplay).not.toHaveBeenCalled();
    expect(commitOnce).toHaveBeenCalledOnce();
  });
});
