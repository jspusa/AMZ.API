import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ListingImageBatchMutations, type ListingImageBatchDependencies } from "../src/main/listing-image-batch-mutations";
import { createListingImageMutationOperations, createListingImageMutations } from "../src/main/listing-image-mutations";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { ListingImageGateway, ListingImageSourceEvidence } from "../src/main/amazon/listing-image-gateway";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { MainWriteGate } from "../src/main/write-gate";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import type { ListingImageBatchSnapshot } from "../src/shared/listing-image-batch";

const marketplaceId = "ATVPDKIKX0DER";
const attributes = ["main_product_image_locator", ...Array.from({ length: 9 }, (_, index) => `other_product_image_locator_${index + 1}`)];
const old = ["https://images.example.com/old-main.jpg", "https://images.example.com/old-second.jpg", ...Array<string | null>(8).fill(null)];
function proposed(sku: string): Array<string | null> { return [`https://images.example.com/${sku}-main.jpg`, ...Array<null>(9).fill(null)]; }
function request(method: "GET" | "POST" | "PATCH", value: Record<string, unknown> = {}, query: Record<string, string> = {}): ApiRequest {
  return { requestId: "batch-test", method, path: "/api/sp-api/listing-images-batch", query, headers: {}, ...(method === "GET" ? {} : { body: { kind: "json" as const, value } }) };
}
function value(response: ApiResponse): ListingImageBatchSnapshot {
  expect(response.body.kind).toBe("json");
  return response.body.kind === "json" ? response.body.value as ListingImageBatchSnapshot : {} as ListingImageBatchSnapshot;
}
async function setup(overrides: Partial<Pick<ListingImageBatchDependencies, "readbackDelaysMs" | "now" | "assertPreparedImageUrls">> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "amz-image-batch-"));
  const store = new LocalStore(join(directory, "store.json"));
  await store.initialize();
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId, mode: "live", accountScope: "image-batch-test-account" }));
  const approveWrite = vi.fn(async (_reason: string) => undefined);
  const writeGate = new MainWriteGate({ store, context, approveWrite, now: overrides.now });
  const canonical = new Map<string, readonly (string | null)[]>();
  const gateway: ListingImageGateway = {
    mode: () => "live",
    read: vi.fn<ListingImageGateway["read"]>(async identity => ({
      fulfillment: "FBA", sourceEvidence: {} as ListingImageSourceEvidence,
      snapshot: { mode: "live", marketplaceId, sellerSku: identity.sellerSku, asin: "B09S5VY2JS", productType: "PET_FOOD", title: "Turkey treats", attributesPresent: true,
        images: attributes.map((attributeName, index) => ({ attributeName, label: String(index + 1), url: (canonical.get(identity.sellerSku) ?? old)[index] ?? null,
          capability: { attributeName, label: String(index + 1), supported: true, editable: true, required: index === 0, reason: null } })),
        fetchedAt: new Date().toISOString(), requestId: null, issues: [], notice: "" },
    })),
    validationPreview: vi.fn(async () => ({ ok: true, status: 200, requestId: null, retryAfter: null, payload: { status: "VALID", issues: [] } })),
    commitOnce: vi.fn(async (patch, fence) => { await fence.assertCurrent(); canonical.set(patch.sellerSku, patch.requestedUrls); return { ok: true, status: 200, requestId: "batch-commit", retryAfter: null, payload: { status: "ACCEPTED", issues: [], submissionId: "batch-submission" } }; }),
    replaceDemoImages: vi.fn(),
  };
  const assertPreparedImageUrls = vi.fn(async (_input: Parameters<ListingImageBatchDependencies["assertPreparedImageUrls"]>[0]) => undefined);
  const owner = new ListingImageBatchMutations({ context, writeGate, operations: createListingImageMutationOperations(gateway), assertPreparedImageUrls, readbackDelaysMs: [0], ...overrides });
  return { owner, gateway, approveWrite, canonical, context, writeGate, assertPreparedImageUrls };
}

async function previewSkus(owner: ListingImageBatchMutations, skus = ["AFA12AM", "AFA13AM"]): Promise<ListingImageBatchSnapshot> {
  const response = await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode: "complete", rows: skus.map(sellerSku => ({ sellerSku, urls: proposed(sellerSku) })) }) });
  expect(response.status).toBe(200);
  return value(response);
}
async function submit(owner: ListingImageBatchMutations, preview: ListingImageBatchSnapshot): Promise<ApiResponse> {
  return owner.handle({ operation: "commit", request: request("PATCH", { marketplaceId, batchId: preview.batchId, reviewToken: preview.reviewToken, completeReplacementAcknowledged: true }) });
}
async function terminal(owner: ListingImageBatchMutations, preview: ListingImageBatchSnapshot): Promise<ListingImageBatchSnapshot> {
  let result!: ListingImageBatchSnapshot;
  await vi.waitFor(async () => {
    result = value(await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: preview.batchId }) }));
    expect(["completed", "stopped"]).toContain(result.phase);
  }, { timeout: 5_000, interval: 10 });
  return result;
}

describe("image folder batch main owner", () => {
  it("previews exact complete replacements and discloses omitted old positions without authorizing any write", async () => {
    const { owner, gateway, approveWrite } = await setup();
    const response = await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode: "complete", rows: [
      { sellerSku: "AFA12AM", urls: proposed("AFA12AM") }, { sellerSku: "AFA13AM", urls: proposed("AFA13AM") },
    ] }) });
    expect(response.status).toBe(200);
    expect(value(response)).toMatchObject({ phase: "ready", totals: { skus: 2, ready: 2, deletedSlots: 2 }, rows: [
      { sellerSku: "AFA12AM", asin: "B09S5VY2JS", changedSlots: [1, 2], deletedSlots: [2], state: "ready" },
      { sellerSku: "AFA13AM", changedSlots: [1, 2], deletedSlots: [2], state: "ready" },
    ] });
    expect(gateway.commitOnce).not.toHaveBeenCalled();
    expect(approveWrite).not.toHaveBeenCalled();
  });

  it("updates two reviewed SKUs after one native approval and exposes read-only terminal evidence", async () => {
    const { owner, gateway, approveWrite, canonical } = await setup();
    const preview = value(await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode: "complete", rows: [
      { sellerSku: "AFA12AM", urls: proposed("AFA12AM") }, { sellerSku: "AFA13AM", urls: proposed("AFA13AM") },
    ] }) }));
    const commit = await owner.handle({ operation: "commit", request: request("PATCH", { marketplaceId, batchId: preview.batchId, reviewToken: preview.reviewToken, completeReplacementAcknowledged: true }) });
    expect(commit.status).toBe(202);
    let latest = value(commit);
    await vi.waitFor(async () => {
      latest = value(await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: preview.batchId }) }));
      expect(["completed", "stopped"]).toContain(latest.phase);
    }, { timeout: 5_000, interval: 10 });
    expect(latest).toMatchObject({ phase: "completed", totals: { submitted: 2, accepted: 2, verified: 2 }, rows: [{ state: "verified" }, { state: "verified" }] });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(approveWrite.mock.calls[0][0]).toContain("2 SKU");
    expect(approveWrite.mock.calls[0][0]).toContain("清除 2");
    expect(gateway.commitOnce).toHaveBeenCalledTimes(2);
    expect(canonical.get("AFA12AM")).toEqual(proposed("AFA12AM"));
    await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: preview.batchId }) });
    expect(gateway.commitOnce).toHaveBeenCalledTimes(2);
  });

  it("isolates a rejected SKU and shows unchanged rows while allowing only the safe replacement", async () => {
    const { owner, gateway, canonical } = await setup();
    canonical.set("AFA14AM", proposed("AFA14AM"));
    vi.mocked(gateway.validationPreview).mockImplementation(async patch => ({ ok: true, status: 200, requestId: null, retryAfter: null,
      payload: patch.sellerSku === "AFA12AM" ? { status: "INVALID", issues: [{ code: "InvalidImage", severity: "ERROR", message: "Cannot use image", categories: [] }] } : { status: "VALID", issues: [] } }));
    const response = await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode: "complete", rows:
      ["AFA12AM", "AFA13AM", "AFA14AM"].map(sellerSku => ({ sellerSku, urls: proposed(sellerSku) })),
    }) });
    expect(response.status).toBe(200);
    expect(value(response)).toMatchObject({ totals: { ready: 1, blocked: 1, unchanged: 1 }, rows: [
      { sellerSku: "AFA12AM", state: "blocked", code: "VALIDATION_FAILED" }, { sellerSku: "AFA13AM", state: "ready" }, { sellerSku: "AFA14AM", state: "unchanged" },
    ] });
  });

  it("also refuses the existing single-SKU confirmation if prepared images expire after preview", async () => {
    const { context, writeGate, gateway, approveWrite } = await setup();
    let expired = false;
    const single = createListingImageMutations({ context, writeGate, gateway, assertImagePreparation: async () => {
      if (expired) throw new SpApiError("圖片已過期。", { status: 409, code: "IMAGE_PREPARATION_EXPIRED" });
    } });
    const snapshot = value(await single.handle({ operation: "read", request: request("GET", {}, { marketplaceId, sku: "AFA12AM" }) })) as unknown as { snapshotToken: string };
    const body = { marketplaceId, sellerSku: "AFA12AM", snapshotToken: snapshot.snapshotToken, expectedUrls: old, urls: proposed("AFA12AM"), idempotencyKey: "image-expiry-single-test" };
    expect((await single.handle({ operation: "preview", request: request("POST", body) })).status).toBe(200);
    expired = true;
    expect((await single.handle({ operation: "commit", request: request("PATCH", body) })).status).toBe(409);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it.each([
    ["too many SKU folders", Array.from({ length: 31 }, (_, index) => ({ sellerSku: `SKU${index}`, urls: proposed(`SKU${index}`) }))],
    ["duplicate exact SKU", [{ sellerSku: "AFA12AM", urls: proposed("AFA12AM") }, { sellerSku: "AFA12AM", urls: proposed("AFA12AM") }]],
    ["trimmed SKU alias", [{ sellerSku: " AFA12AM", urls: proposed("AFA12AM") }]],
    ["eleven image positions", [{ sellerSku: "AFA12AM", urls: [...proposed("AFA12AM"), null] }]],
    ["implicit omitted positions", [{ sellerSku: "AFA12AM", urls: proposed("AFA12AM").slice(0, 9) }]],
    ["noncontiguous image positions", [{ sellerSku: "AFA12AM", urls: [proposed("AFA12AM")[0], null, "https://images.example.com/third.jpg", ...Array<null>(7).fill(null)] }]],
    ["renderer identity authority", [{ sellerSku: "AFA12AM", urls: proposed("AFA12AM"), asin: "B09S5VY2JS" }]],
  ])("rejects %s before preparation or Amazon reads", async (_label, rows) => {
    const { owner, gateway, assertPreparedImageUrls } = await setup();
    expect((await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode: "complete", rows }) })).status).toBe(400);
    expect(gateway.read).not.toHaveBeenCalled();
    expect(assertPreparedImageUrls).not.toHaveBeenCalled();
  });

  it("accepts thirty exact SKUs and all three hundred requested image positions", async () => {
    const { owner, gateway } = await setup();
    const response = await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode: "complete", rows:
      Array.from({ length: 30 }, (_, index) => ({ sellerSku: `SKU${index}`, urls: Array.from({ length: 10 }, (_, slot) => `https://images.example.com/sku${index}-${slot}.jpg`) })),
    }) });
    expect(response.status).toBe(200);
    expect(value(response).totals).toMatchObject({ skus: 30, ready: 30 });
    expect(value(response).rows[29].changedSlots).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("requires the exact review token and complete-replacement disclosure acknowledgement", async () => {
    const { owner, gateway, approveWrite } = await setup();
    const preview = await previewSkus(owner);
    const body = { marketplaceId, batchId: preview.batchId, reviewToken: preview.reviewToken };
    expect((await owner.handle({ operation: "commit", request: request("PATCH", body) })).status).toBe(422);
    expect((await owner.handle({ operation: "commit", request: request("PATCH", { ...body, reviewToken: "wrong", completeReplacementAcknowledged: true }) })).status).toBe(409);
    expect(gateway.commitOnce).not.toHaveBeenCalled();
    expect(approveWrite).not.toHaveBeenCalled();
  });

  it("cancels the entire batch with zero writes if the native approval is declined", async () => {
    const { owner, gateway, approveWrite } = await setup();
    approveWrite.mockRejectedValue(new Error("User declined native approval"));
    const preview = await previewSkus(owner);
    expect((await submit(owner, preview)).status).toBe(202);
    expect(await terminal(owner, preview)).toMatchObject({ phase: "stopped", totals: { submitted: 0, accepted: 0 } });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("keeps accepted-but-pending writes non-replayable and never retries them from GET", async () => {
    const { owner, gateway, approveWrite } = await setup();
    vi.mocked(gateway.commitOnce).mockImplementation(async (_patch, fence) => { await fence.assertCurrent(); return { ok: true, status: 200, requestId: null, retryAfter: null,
      payload: { status: "ACCEPTED", issues: [], submissionId: "processing" } }; });
    const preview = await previewSkus(owner);
    await submit(owner, preview);
    expect(await terminal(owner, preview)).toMatchObject({ phase: "completed", totals: { accepted: 2, verified: 0 }, rows: [{ state: "accepted" }, { state: "accepted" }] });
    expect((await submit(owner, preview)).status).toBe(200);
    const again = await previewSkus(owner);
    await submit(owner, again);
    expect(await terminal(owner, again)).toMatchObject({ phase: "stopped", totals: { submitted: 0 } });
    expect(gateway.commitOnce).toHaveBeenCalledTimes(2);
    expect(approveWrite).toHaveBeenCalledOnce();
  });

  it("stops later SKUs after an uncertain PATCH and refuses replay under a fresh plan", async () => {
    const { owner, gateway, approveWrite } = await setup();
    vi.mocked(gateway.commitOnce).mockRejectedValue(new SpApiError("Request outcome unknown", { status: 503, code: "UPDATE_STATUS_UNKNOWN" }));
    const preview = await previewSkus(owner);
    await submit(owner, preview);
    expect(await terminal(owner, preview)).toMatchObject({ phase: "stopped", rows: [{ state: "unknown" }, { state: "not-started" }] });
    const again = await previewSkus(owner);
    await submit(owner, again);
    expect(await terminal(owner, again)).toMatchObject({ phase: "stopped", totals: { submitted: 0 } });
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledOnce();
  });

  it("isolates a SKU whose old image changed after review and approves only the surviving SKU", async () => {
    const { owner, gateway, canonical, approveWrite } = await setup();
    const preview = await previewSkus(owner);
    canonical.set("AFA12AM", ["https://images.example.com/changed-elsewhere.jpg", ...old.slice(1)]);
    await submit(owner, preview);
    expect(await terminal(owner, preview)).toMatchObject({ phase: "completed", rows: [{ state: "blocked", code: "STALE_LISTING" }, { state: "verified" }] });
    expect(approveWrite.mock.calls[0][0]).toContain("1 SKU");
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(vi.mocked(gateway.commitOnce).mock.calls[0][0].sellerSku).toBe("AFA13AM");
  });

  it("does not inherit a native approval across a lock or publish a late cleared result", async () => {
    const { owner, gateway, context, writeGate, approveWrite } = await setup();
    approveWrite.mockImplementation(async () => { context.invalidate("lock-screen"); writeGate.clearEphemeral(); owner.clear(); });
    const preview = await previewSkus(owner);
    await submit(owner, preview);
    await vi.waitFor(() => expect(approveWrite).toHaveBeenCalledOnce());
    expect((await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: preview.batchId }) })).status).toBe(410);
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("allows the batch review longer than a single-SKU ticket but expires it after fifteen minutes", async () => {
    let now = Date.now();
    const { owner, gateway } = await setup({ now: () => now });
    const preview = await previewSkus(owner);
    now += 3 * 60_000;
    await submit(owner, preview);
    expect(await terminal(owner, preview)).toMatchObject({ phase: "completed", totals: { verified: 2 } });
    const another = await previewSkus(owner, ["AFA14AM"]);
    now += 15 * 60_000;
    expect((await submit(owner, another)).status).toBe(410);
    expect(gateway.commitOnce).toHaveBeenCalledTimes(2);
  });

  it("rechecks prepared-image expiry at the final send fence without counting a prevented PATCH as rejected by Amazon", async () => {
    const { owner, gateway, assertPreparedImageUrls } = await setup();
    assertPreparedImageUrls.mockImplementation(async () => {
      if (vi.mocked(gateway.validationPreview).mock.calls.length >= 3) throw new SpApiError("圖片已過期。", { status: 409, code: "IMAGE_PREPARATION_EXPIRED" });
    });
    const preview = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, preview);
    expect(await terminal(owner, preview)).toMatchObject({ totals: { submitted: 0, accepted: 0 }, rows: [{ state: "not-started", code: "IMAGE_PREPARATION_EXPIRED" }] });
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it.each(["single-to-batch", "batch-to-single"] as const)("blocks unknown image replay across %s even with different preview keys", async direction => {
    const { owner, gateway, context, writeGate, approveWrite } = await setup();
    vi.mocked(gateway.commitOnce).mockRejectedValue(new SpApiError("Unknown transport outcome", { status: 503, code: "UPDATE_STATUS_UNKNOWN" }));
    const single = createListingImageMutations({ context, writeGate, gateway });
    const singlePreview = async () => {
      const lookup = value(await single.handle({ operation: "read", request: request("GET", {}, { marketplaceId, sku: "AFA12AM" }) })) as unknown as { snapshotToken: string };
      const body = { marketplaceId, sellerSku: "AFA12AM", snapshotToken: lookup.snapshotToken, expectedUrls: old, urls: proposed("AFA12AM"), idempotencyKey: "cross-surface-single-key" };
      expect((await single.handle({ operation: "preview", request: request("POST", body) })).status).toBe(200);
      return body;
    };
    if (direction === "single-to-batch") {
      expect((await single.handle({ operation: "commit", request: request("PATCH", await singlePreview()) })).status).toBe(503);
      const batch = await previewSkus(owner, ["AFA12AM"]);
      await submit(owner, batch);
      expect(await terminal(owner, batch)).toMatchObject({ phase: "stopped", totals: { submitted: 0 } });
    } else {
      const batch = await previewSkus(owner, ["AFA12AM"]);
      await submit(owner, batch);
      expect(await terminal(owner, batch)).toMatchObject({ phase: "stopped", rows: [{ state: "unknown" }] });
      expect((await single.handle({ operation: "commit", request: request("PATCH", await singlePreview()) })).status).toBe(409);
    }
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
  });

  it("stops globally when an Amazon read returns a different execution mode", async () => {
    const { owner, gateway, approveWrite } = await setup();
    const read = vi.mocked(gateway.read).getMockImplementation()!;
    vi.mocked(gateway.read).mockImplementationOnce(async (input, purpose) => {
      const observed = await read(input, purpose);
      return { ...observed, snapshot: { ...observed.snapshot, mode: "demo" } };
    });
    const response = await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode: "complete", rows: ["AFA12AM", "AFA13AM"].map(sellerSku => ({ sellerSku, urls: proposed(sellerSku) })) }) });
    expect(response.status).toBe(409);
    expect(gateway.read).toHaveBeenCalledOnce();
    expect(approveWrite).not.toHaveBeenCalled();
  });

  it("refuses a superseded review while a new preview is still being built", async () => {
    const { owner, gateway, approveWrite } = await setup();
    const first = await previewSkus(owner);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const read = vi.mocked(gateway.read).getMockImplementation()!;
    vi.mocked(gateway.read).mockImplementationOnce(async (input, purpose) => { await held; return read(input, purpose); });
    const rebuilding = previewSkus(owner, ["AFA14AM"]);
    expect((await submit(owner, first)).status).toBe(409);
    release();
    await rebuilding;
    expect((await submit(owner, first)).status).toBe(410);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("does not label a canonical match verified when its durable evidence cannot be inspected", async () => {
    const { owner, writeGate } = await setup();
    vi.spyOn(writeGate, "inspect").mockResolvedValue([]);
    const preview = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, preview);
    expect(await terminal(owner, preview)).toMatchObject({ totals: { accepted: 1, verified: 0 }, rows: [{ state: "accepted" }] });
  });
});
