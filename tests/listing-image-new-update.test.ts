import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ListingImageBatchMutations } from "../src/main/listing-image-batch-mutations";
import { createListingImageMutationOperations, createListingImageMutations } from "../src/main/listing-image-mutations";
import type { ListingImageGateway, ListingImageSourceEvidence } from "../src/main/amazon/listing-image-gateway";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { MainWriteGate } from "../src/main/write-gate";
import { LocalStore, type LedgerOperationType } from "../src/main/local-store";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import type { ListingImageBatchSnapshot } from "../src/shared/listing-image-batch";

const marketplaceId = "ATVPDKIKX0DER";
const sellerSku = "SYNTHETIC-SHARED-IMAGE";
const attributes = ["main_product_image_locator", ...Array.from({ length: 9 }, (_, index) => `other_product_image_locator_${index + 1}`)];
const previousUpload = [...Array.from({ length: 9 }, (_, index) => `https://images.example.com/previous-set-${index + 1}.jpg`), null];
const amazonCanonical = [...Array.from({ length: 9 }, (_, index) => `https://m.media-amazon.com/images/I/SYNTHETIC-CDN-${index + 1}.jpg`), null];
const newImage = "https://images.example.com/new-shared-slot-9.jpg";
const selectedSlot9 = [null, null, null, null, null, null, null, null, newImage, null];

function request(method: "GET" | "POST" | "PATCH", body: Record<string, unknown> = {}, query: Record<string, string> = {}): ApiRequest {
  return { requestId: "new-image-update-test", method, path: "/api/sp-api/listing-images-batch", query, headers: {},
    ...(method === "GET" ? {} : { body: { kind: "json" as const, value: body } }) };
}

function snapshot(response: ApiResponse): ListingImageBatchSnapshot {
  expect(response.body.kind).toBe("json");
  return response.body.kind === "json" ? response.body.value as ListingImageBatchSnapshot : {} as ListingImageBatchSnapshot;
}

async function preview(owner: ListingImageBatchMutations, replacementMode: "complete" | "selected-slots", urls: readonly (string | null)[]) {
  const response = await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode, rows: [{ sellerSku, urls }] }) });
  expect(response.status).toBe(200);
  return snapshot(response);
}

function commit(owner: ListingImageBatchMutations, review: ListingImageBatchSnapshot) {
  return owner.handle({ operation: "commit", request: request("PATCH", { marketplaceId, batchId: review.batchId, reviewToken: review.reviewToken,
    ...(review.replacementMode === "complete" ? { completeReplacementAcknowledged: true } : { selectedSlotsAcknowledged: true }) }) });
}

async function terminal(owner: ListingImageBatchMutations, review: ListingImageBatchSnapshot) {
  let result!: ListingImageBatchSnapshot;
  await vi.waitFor(async () => {
    result = snapshot(await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: review.batchId }) }));
    expect(["completed", "stopped"]).toContain(result.phase);
  }, { timeout: 5_000, interval: 10 });
  return result;
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "amz-image-new-update-"));
  const storePath = join(directory, "store.json");
  let now = Date.now();
  let canonical: readonly (string | null)[] = ["https://images.example.com/original-main.jpg", ...Array<null>(9).fill(null)];
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId, mode: "live", accountScope: "synthetic-new-image-account" }));
  const approveWrite = vi.fn(async (_reason: string) => undefined);
  const gateway: ListingImageGateway = {
    mode: () => "live",
    read: vi.fn<ListingImageGateway["read"]>(async identity => ({ fulfillment: "FBA", sourceEvidence: {} as ListingImageSourceEvidence,
      snapshot: { mode: "live", marketplaceId, sellerSku: identity.sellerSku, asin: "B000000021", productType: "PET_FOOD", title: "Synthetic image target", attributesPresent: true,
        images: attributes.map((attributeName, index) => ({ attributeName, label: String(index + 1), url: canonical[index],
          capability: { attributeName, label: String(index + 1), supported: true, editable: true, required: index === 0, reason: null } })),
        fetchedAt: new Date(now).toISOString(), requestId: null, issues: [], notice: "" } })),
    validationPreview: vi.fn(async () => ({ ok: true, status: 200, requestId: "synthetic-validation", retryAfter: null, payload: { status: "VALID", issues: [] } })),
    commitOnce: vi.fn(async (patch, fence) => {
      await fence.assertCurrent();
      const fresh = patch.requestedUrls[8] === newImage;
      if (fresh) canonical = patch.requestedUrls;
      return { ok: true, status: 200, requestId: fresh ? "synthetic-new-request" : "synthetic-prior-request", retryAfter: null,
        payload: { status: "ACCEPTED", issues: [], submissionId: fresh ? "synthetic-new-submission" : "synthetic-prior-submission" } };
    }),
    replaceDemoImages: vi.fn(async () => undefined),
  };
  const owners: ListingImageBatchMutations[] = [];
  async function openOwner() {
    const store = new LocalStore(storePath);
    await store.initialize();
    const writeGate = new MainWriteGate({ store, context, approveWrite, now: () => now });
    const owner = new ListingImageBatchMutations({ context, writeGate, operations: createListingImageMutationOperations(gateway),
      assertPreparedImageUrls: async () => now + 60 * 60_000, now: () => now, readbackDelaysMs: [0] });
    owners.push(owner);
    const inspect = async (operations: readonly LedgerOperationType[] = ["images"]) => writeGate.inspect({ context: await context.capture(marketplaceId), marketplaceId, sellerSku,
      operations, requireComplete: true, project: entry => entry });
    return { owner, writeGate, inspect, store };
  }
  return { openOwner, gateway, approveWrite, context,
    setCanonical: (urls: readonly (string | null)[]) => { canonical = urls; },
    advanceDay: () => { now += 24 * 60 * 60_000; },
    close: async () => { for (const owner of owners) owner.clear(); await rm(directory, { recursive: true, force: true }); },
  };
}

async function acceptedReceipt(): Promise<Record<string, unknown>> {
  const fixture = await setup();
  try {
    const prior = await fixture.openOwner();
    const review = await preview(prior.owner, "complete", previousUpload);
    await commit(prior.owner, review);
    expect(await terminal(prior.owner, review)).toMatchObject({ rows: [{ state: "accepted" }] });
    const [evidence] = await prior.inspect();
    return structuredClone(evidence.response) as Record<string, unknown>;
  } finally { await fixture.close(); }
}

it("allows a fresh slot-9 update after an accepted full-nine-image write without verifying or replaying the older receipt", async () => {
  const fixture = await setup();
  const { openOwner, gateway, approveWrite } = fixture;
  try {
    const previous = await openOwner();
    const older = await preview(previous.owner, "complete", previousUpload);
    expect((await commit(previous.owner, older)).status).toBe(202);
    expect(await terminal(previous.owner, older)).toMatchObject({ phase: "completed", totals: { accepted: 1, verified: 0 }, rows: [{ state: "accepted" }] });
    const oldEvidence = await previous.inspect();
    expect(oldEvidence).toMatchObject([{ state: "unknown", response: { status: "ACCEPTED", requestedUrls: previousUpload } }]);
    previous.owner.clear(); previous.writeGate.clearEphemeral();

    // Reopen the durable store the next day. Different CDN URLs do not prove the old write verified.
    fixture.advanceDay();
    fixture.setCanonical(amazonCanonical);
    const current = await openOwner();
    expect(await current.inspect()).toEqual(oldEvidence);
    approveWrite.mockClear(); vi.mocked(gateway.commitOnce).mockClear(); vi.mocked(gateway.validationPreview).mockClear();
    const fresh = await preview(current.owner, "selected-slots", selectedSlot9);
    expect(fresh).toMatchObject({ phase: "ready", totals: { ready: 1 }, rows: [{ previousUrls: amazonCanonical,
      requestedUrls: [...amazonCanonical.slice(0, 8), newImage, null], changedSlots: [9], deletedSlots: [] }] });
    expect(gateway.validationPreview).toHaveBeenCalledOnce();
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
    approveWrite.mockImplementation(async () => {
      expect(vi.mocked(gateway.validationPreview).mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(gateway.commitOnce).not.toHaveBeenCalled();
    });

    expect((await commit(current.owner, fresh)).status).toBe(202);
    const result = await terminal(current.owner, fresh);
    expect(result).toMatchObject({ phase: "completed", totals: { submitted: 1, accepted: 1, verified: 1 }, rows: [{ state: "verified" }] });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(vi.mocked(gateway.commitOnce).mock.calls[0][0]).toMatchObject({ sellerSku,
      previousUrls: amazonCanonical, requestedUrls: [...amazonCanonical.slice(0, 8), newImage, null],
      changes: [{ slot: 8, previousUrl: amazonCanonical[8], requestedUrl: newImage }] });
    const evidence = await current.inspect();
    expect(evidence).toHaveLength(2);
    expect(evidence).toContainEqual(oldEvidence[0]);
    expect((await commit(current.owner, fresh)).status).toBe(200);
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledOnce();
  } finally {
    await fixture.close();
  }
});

it("still blocks a new slot-9 proposal when the older response was lost, including after restart and repeated commits", async () => {
  const fixture = await setup();
  const { gateway, approveWrite } = fixture;
  try {
    const previous = await fixture.openOwner();
    vi.mocked(gateway.commitOnce).mockImplementationOnce(async (_patch, fence) => {
      await fence.assertCurrent();
      throw new SpApiError("Synthetic response lost", { status: 503, code: "UPDATE_STATUS_UNKNOWN" });
    });
    const older = await preview(previous.owner, "complete", previousUpload);
    await commit(previous.owner, older);
    expect(await terminal(previous.owner, older)).toMatchObject({ phase: "stopped", rows: [{ state: "unknown" }] });
    const oldEvidence = await previous.inspect();
    expect(oldEvidence).toMatchObject([{ state: "unknown", response: null }]);
    previous.owner.clear(); previous.writeGate.clearEphemeral();
    fixture.advanceDay(); fixture.setCanonical(amazonCanonical);
    const current = await fixture.openOwner();
    approveWrite.mockClear(); vi.mocked(gateway.commitOnce).mockClear();
    const fresh = await preview(current.owner, "selected-slots", selectedSlot9);
    expect(fresh.totals.ready).toBe(1);
    await commit(current.owner, fresh);
    expect(await terminal(current.owner, fresh)).toMatchObject({ phase: "stopped", totals: { submitted: 0 }, rows: [{ state: "not-started", code: "UPDATE_STATUS_UNKNOWN" }] });
    await commit(current.owner, fresh);
    await current.owner.handle({ operation: "recover", request: request("GET", {}, { marketplaceId, recoverSkus: JSON.stringify([sellerSku]) }) });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
    expect(await current.inspect()).toEqual(oldEvidence);
  } finally { await fixture.close(); }
});

it("blocks a genuinely in-flight image write and rejects its same operation key without another execution", async () => {
  const fixture = await setup();
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let pending: Promise<unknown> | undefined;
  try {
    const current = await fixture.openOwner();
    const identity = { idempotencyKey: "synthetic-in-flight-image", operationType: "images" as const, marketplaceId, sellerSku,
      accountScope: (await fixture.context.capture(marketplaceId)).accountScope, fingerprint: "synthetic-in-flight-proposal", executionMode: "live" as const };
    pending = current.store.runIdempotentOperation({ ...identity, execute: async () => {
      started(); await held;
      throw new SpApiError("Synthetic response not established", { status: 503, code: "UPDATE_STATUS_UNKNOWN" });
    } }).catch(error => error);
    await entered;
    const oldEvidence = await current.inspect();
    expect(oldEvidence).toMatchObject([{ state: "pending", response: null }]);
    fixture.setCanonical(amazonCanonical);
    const fresh = await preview(current.owner, "selected-slots", selectedSlot9);
    expect(fresh.totals.ready).toBe(1);
    await commit(current.owner, fresh);
    expect(await terminal(current.owner, fresh)).toMatchObject({ phase: "stopped", totals: { submitted: 0 }, rows: [{ state: "not-started", code: "OPERATION_IN_PROGRESS" }] });
    await commit(current.owner, fresh);
    const duplicate = vi.fn(async () => ({ status: "ACCEPTED" }));
    await expect(current.store.runIdempotentOperation({ ...identity, execute: duplicate })).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS" });
    expect(duplicate).not.toHaveBeenCalled();
    expect(fixture.approveWrite).not.toHaveBeenCalled();
    expect(fixture.gateway.commitOnce).not.toHaveBeenCalled();
    expect(await current.inspect()).toEqual(oldEvidence);
    release();
    expect(await pending).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    await expect(current.store.runIdempotentOperation({ ...identity, execute: duplicate })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(duplicate).not.toHaveBeenCalled();
  } finally { release?.(); await pending; await fixture.close(); }
});

it.each([
  "missing-evidence", "malformed-hash", "incomplete-vector", "malformed-issue-null", "malformed-issue-severity", "foreign-sku", "foreign-marketplace", "foreign-asin", "foreign-product-type", "legacy-account", "content-write",
] as const)("does not let a %s accepted record authorize an unrelated new image write", async scenario => {
  const receipt = await acceptedReceipt();
  const evidence = receipt.imageWriteEvidence as Record<string, unknown>;
  if (scenario === "missing-evidence") delete receipt.imageWriteEvidence;
  if (scenario === "malformed-hash") evidence.expectedOldHash = "0".repeat(64);
  if (scenario === "incomplete-vector") evidence.requestedUrls = previousUpload.slice(0, 8);
  if (scenario === "malformed-issue-null") receipt.issues = [null];
  if (scenario === "malformed-issue-severity") receipt.issues = [{ code: "SYNTHETIC", message: "Synthetic issue", severity: "anything", attributeNames: [] }];
  if (scenario === "foreign-sku") receipt.sellerSku = "SYNTHETIC-OTHER-SKU";
  if (scenario === "foreign-marketplace") receipt.marketplaceId = "A1VC38T7YXB528";
  if (scenario === "foreign-asin") evidence.asin = "B000000099";
  if (scenario === "foreign-product-type") evidence.productType = "PET_SUPPLIES";
  const fixture = await setup();
  try {
    const current = await fixture.openOwner();
    const operationType = scenario === "content-write" ? "content" : "images";
    const accountScope = scenario === "legacy-account" ? "legacy-unknown" : (await fixture.context.capture(marketplaceId)).accountScope;
    const inspectPrior = () => current.store.inspectIdempotentOperations({ marketplaceId, sellerSku, accountScope, operationTypes: [operationType] });
    await expect(current.store.runIdempotentOperation({ idempotencyKey: `synthetic-prior-${scenario}`, operationType, marketplaceId, sellerSku,
      accountScope,
      fingerprint: "synthetic-prior-proposal", executionMode: "live", execute: async ({ recordAccepted }) => {
        await recordAccepted(receipt);
        throw new SpApiError("Synthetic canonical readback pending", { status: 503, code: "UPDATE_STATUS_UNKNOWN" });
      },
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    const oldEvidence = await inspectPrior();
    expect(oldEvidence).toMatchObject([{ state: "unknown", response: receipt }]);
    fixture.setCanonical(amazonCanonical);
    const fresh = await preview(current.owner, "selected-slots", selectedSlot9);
    expect(fresh.totals.ready).toBe(1);
    await commit(current.owner, fresh);
    expect(await terminal(current.owner, fresh)).toMatchObject({ phase: "stopped", totals: { submitted: 0 }, rows: [{ state: "not-started" }] });
    expect(fixture.approveWrite).not.toHaveBeenCalled();
    expect(fixture.gateway.commitOnce).not.toHaveBeenCalled();
    expect(await inspectPrior()).toEqual(oldEvidence);
  } finally { await fixture.close(); }
});

it("requires separate native approvals and one PATCH for each fresh target while retaining all accepted receipts", async () => {
  const fixture = await setup();
  try {
    const current = await fixture.openOwner();
    fixture.setCanonical(amazonCanonical);
    vi.mocked(fixture.gateway.commitOnce).mockImplementation(async (_patch, fence) => {
      await fence.assertCurrent();
      return { ok: true, status: 200, requestId: "synthetic-successive-request", retryAfter: null,
        payload: { status: "ACCEPTED", issues: [], submissionId: "synthetic-successive-submission" } };
    });
    const targets = [newImage, "https://images.example.com/another-new-shared-slot-9.jpg"];
    for (const [index, target] of targets.entries()) {
      const priorEvidence = await current.inspect();
      const review = await preview(current.owner, "selected-slots", [...Array<null>(8).fill(null), target, null]);
      expect(fixture.approveWrite).toHaveBeenCalledTimes(index);
      expect(fixture.gateway.commitOnce).toHaveBeenCalledTimes(index);
      await commit(current.owner, review);
      expect(await terminal(current.owner, review)).toMatchObject({ phase: "completed", totals: { submitted: 1, accepted: 1, verified: 0 }, rows: [{ state: "accepted" }] });
      expect(fixture.approveWrite).toHaveBeenCalledTimes(index + 1);
      expect(fixture.gateway.commitOnce).toHaveBeenCalledTimes(index + 1);
      expect(vi.mocked(fixture.gateway.commitOnce).mock.calls[index][0]).toMatchObject({ previousUrls: amazonCanonical,
        requestedUrls: [...amazonCanonical.slice(0, 8), target, null], changes: [{ slot: 8, previousUrl: amazonCanonical[8], requestedUrl: target }] });
      const evidence = await current.inspect();
      expect(evidence).toHaveLength(index + 1);
      for (const old of priorEvidence) expect(evidence).toContainEqual(old);
      await commit(current.owner, review);
      expect(fixture.approveWrite).toHaveBeenCalledTimes(index + 1);
      expect(fixture.gateway.commitOnce).toHaveBeenCalledTimes(index + 1);
    }
  } finally { await fixture.close(); }
});

it.each(["accepted", "completed"] as const)("invalidates an older preview when another image write becomes %s after preview", async state => {
  const receipt = await acceptedReceipt();
  const fixture = await setup();
  try {
    const current = await fixture.openOwner();
    fixture.setCanonical(amazonCanonical);
    const fresh = await preview(current.owner, "selected-slots", selectedSlot9);
    expect(fresh.totals.ready).toBe(1);
    const intervening = current.store.runIdempotentOperation({ idempotencyKey: `synthetic-intervening-${state}`, operationType: "images", marketplaceId, sellerSku,
      accountScope: (await fixture.context.capture(marketplaceId)).accountScope, fingerprint: "synthetic-intervening-image", executionMode: "live",
      execute: async ({ recordAccepted }) => {
        if (state === "completed") return receipt;
        await recordAccepted(receipt);
        throw new SpApiError("Synthetic canonical readback pending", { status: 503, code: "UPDATE_STATUS_UNKNOWN" });
      },
    });
    if (state === "completed") await expect(intervening).resolves.toEqual(receipt);
    else await expect(intervening).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    const evidence = await current.inspect();
    await commit(current.owner, fresh);
    expect(await terminal(current.owner, fresh)).toMatchObject({ phase: "stopped", totals: { submitted: 0 }, rows: [{ state: "not-started", code: "PREVIEW_CHANGED" }] });
    expect(fixture.approveWrite).not.toHaveBeenCalled();
    expect(fixture.gateway.commitOnce).not.toHaveBeenCalled();
    expect(await current.inspect()).toEqual(evidence);
  } finally { await fixture.close(); }
});

it("reports zero submitted when a GET verifies the prior receipt during native approval and invalidates the new claim", async () => {
  const fixture = await setup();
  try {
    const current = await fixture.openOwner();
    const older = await preview(current.owner, "complete", previousUpload);
    await commit(current.owner, older);
    expect(await terminal(current.owner, older)).toMatchObject({ rows: [{ state: "accepted" }] });
    fixture.setCanonical(amazonCanonical);
    const fresh = await preview(current.owner, "selected-slots", selectedSlot9);
    const single = createListingImageMutations({ context: fixture.context, writeGate: current.writeGate, gateway: fixture.gateway });
    fixture.approveWrite.mockClear(); vi.mocked(fixture.gateway.commitOnce).mockClear();
    let readStatus: number | undefined;
    let observedStates: string[] = [];
    fixture.approveWrite.mockImplementationOnce(async () => {
      fixture.setCanonical(previousUpload);
      const observed = await single.handle({ operation: "read", request: request("GET", {}, { marketplaceId, sku: sellerSku }) });
      readStatus = observed.status;
      observedStates = (await current.inspect()).map(entry => entry.state);
      fixture.setCanonical(amazonCanonical);
    });
    await commit(current.owner, fresh);
    const result = await terminal(current.owner, fresh);
    expect(readStatus).toBe(200);
    expect(observedStates).toEqual(["completed"]);
    expect(result).toMatchObject({ phase: "stopped", totals: { submitted: 0, accepted: 0 }, rows: [{ state: "not-started", code: "PREVIEW_CHANGED" }] });
    expect(fixture.approveWrite).toHaveBeenCalledOnce();
    expect(fixture.gateway.commitOnce).not.toHaveBeenCalled();
    expect(await current.inspect()).toHaveLength(1);
  } finally { await fixture.close(); }
});

it("also permits a freshly previewed single-SKU update after a prior batch acceptance, with one new approval and PATCH", async () => {
  const fixture = await setup();
  try {
    const current = await fixture.openOwner();
    const older = await preview(current.owner, "complete", previousUpload);
    await commit(current.owner, older);
    expect(await terminal(current.owner, older)).toMatchObject({ rows: [{ state: "accepted" }] });
    const oldEvidence = await current.inspect();
    fixture.setCanonical(amazonCanonical);
    const single = createListingImageMutations({ context: fixture.context, writeGate: current.writeGate, gateway: fixture.gateway });
    const lookup = await single.handle({ operation: "read", request: request("GET", {}, { marketplaceId, sku: sellerSku }) });
    expect(lookup.status).toBe(200);
    const token = lookup.body.kind === "json" ? (lookup.body.value as Record<string, unknown>).snapshotToken : null;
    expect(token).toEqual(expect.stringMatching(/^image-snapshot\./));
    const body = { marketplaceId, sellerSku, snapshotToken: token, expectedUrls: amazonCanonical,
      urls: [...amazonCanonical.slice(0, 8), newImage, null], idempotencyKey: "synthetic-fresh-single-image" };
    fixture.approveWrite.mockClear(); vi.mocked(fixture.gateway.commitOnce).mockClear(); vi.mocked(fixture.gateway.validationPreview).mockClear();
    expect((await single.handle({ operation: "preview", request: request("POST", body) })).status).toBe(200);
    expect(fixture.gateway.validationPreview).toHaveBeenCalledOnce();
    expect(fixture.approveWrite).not.toHaveBeenCalled();
    expect(fixture.gateway.commitOnce).not.toHaveBeenCalled();
    const result = await single.handle({ operation: "commit", request: request("PATCH", body) });
    expect(result.status).toBe(200);
    expect(fixture.approveWrite).toHaveBeenCalledOnce();
    expect(fixture.gateway.commitOnce).toHaveBeenCalledOnce();
    expect(vi.mocked(fixture.gateway.commitOnce).mock.calls[0][0]).toMatchObject({ previousUrls: amazonCanonical, requestedUrls: body.urls,
      changes: [{ slot: 8, previousUrl: amazonCanonical[8], requestedUrl: newImage }] });
    const ledger = await current.inspect();
    expect(ledger).toHaveLength(2);
    expect(ledger).toContainEqual(oldEvidence[0]);
    await single.handle({ operation: "commit", request: request("PATCH", body) });
    expect(fixture.approveWrite).toHaveBeenCalledOnce();
    expect(fixture.gateway.commitOnce).toHaveBeenCalledOnce();
  } finally { await fixture.close(); }
});

it("captures the predecessor before the fresh GET so a write completed during that GET cannot authorize the older preview", async () => {
  const receipt = await acceptedReceipt();
  const fixture = await setup();
  try {
    const current = await fixture.openOwner();
    fixture.setCanonical(amazonCanonical);
    const read = vi.mocked(fixture.gateway.read).getMockImplementation()!;
    let intervened = false;
    vi.mocked(fixture.gateway.read).mockImplementation(async (identity, purpose) => {
      const observation = await read(identity, purpose);
      if (purpose === "mutation" && !intervened) {
        intervened = true;
        await current.store.runIdempotentOperation({ idempotencyKey: "synthetic-during-image-read", operationType: "images", marketplaceId, sellerSku,
          accountScope: (await fixture.context.capture(marketplaceId)).accountScope, fingerprint: "synthetic-concurrent-image", executionMode: "live", execute: async () => receipt });
      }
      return observation;
    });
    const fresh = await current.owner.handle({ operation: "preview", request: request("POST", {
      marketplaceId, replacementMode: "selected-slots", rows: [{ sellerSku, urls: selectedSlot9 }],
    }) });
    expect(fresh).toMatchObject({ status: 409, body: { kind: "json", value: { code: "PREVIEW_CHANGED" } } });
    expect(fixture.approveWrite).not.toHaveBeenCalled();
    expect(fixture.gateway.commitOnce).not.toHaveBeenCalled();
    expect(intervened).toBe(true);
    expect(await current.inspect()).toMatchObject([{ state: "completed", response: receipt }]);
  } finally { await fixture.close(); }
});

it.each(["broken-state", "missing-created-at", "missing-updated-at"] as const)("preserves and blocks a %s durable ledger envelope even when its receipt says ACCEPTED", async scenario => {
  const fixture = await setup();
  try {
    const previous = await fixture.openOwner();
    const older = await preview(previous.owner, "complete", previousUpload);
    await commit(previous.owner, older);
    expect(await terminal(previous.owner, older)).toMatchObject({ rows: [{ state: "accepted" }] });
    previous.owner.clear(); previous.writeGate.clearEphemeral();
    // Model a malformed prior-version disk record at the persistence boundary, using synthetic data only.
    const persisted = JSON.parse(await readFile(previous.store.filePath, "utf8")) as { ledger: Record<string, Record<string, unknown>> };
    expect(Object.values(persisted.ledger)).toHaveLength(1);
    const [record] = Object.values(persisted.ledger);
    if (scenario === "broken-state") record.state = "broken";
    if (scenario === "missing-created-at") delete record.createdAt;
    if (scenario === "missing-updated-at") delete record.updatedAt;
    await writeFile(previous.store.filePath, JSON.stringify(persisted), "utf8");
    fixture.setCanonical(amazonCanonical);
    const current = await fixture.openOwner();
    fixture.approveWrite.mockClear(); vi.mocked(fixture.gateway.commitOnce).mockClear();
    const fresh = await preview(current.owner, "selected-slots", selectedSlot9);
    await commit(current.owner, fresh);
    expect(await terminal(current.owner, fresh)).toMatchObject({ phase: "stopped", totals: { submitted: 0 }, rows: [{ state: "not-started" }] });
    expect(fixture.approveWrite).not.toHaveBeenCalled();
    expect(fixture.gateway.commitOnce).not.toHaveBeenCalled();
    const after = JSON.parse(await readFile(current.store.filePath, "utf8")) as { ledger: unknown };
    expect(after.ledger).toEqual(persisted.ledger);
  } finally { await fixture.close(); }
});
