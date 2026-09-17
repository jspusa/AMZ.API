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
async function setup(overrides: Partial<Pick<ListingImageBatchDependencies, "readbackDelaysMs" | "now" | "assertPreparedImageUrls">> & { mode?: () => "live" | "demo" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "amz-image-batch-"));
  const store = new LocalStore(join(directory, "store.json"));
  await store.initialize();
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId, mode: overrides.mode?.() ?? "live", accountScope: "image-batch-test-account" }));
  const approveWrite = vi.fn(async (_reason: string) => undefined);
  const writeGate = new MainWriteGate({ store, context, approveWrite, now: overrides.now });
  const canonical = new Map<string, readonly (string | null)[]>();
  const demoCanonical = new Map<string, readonly (string | null)[]>();
  const gateway: ListingImageGateway = {
    mode: () => overrides.mode?.() ?? "live",
    read: vi.fn<ListingImageGateway["read"]>(async identity => ({
      fulfillment: "FBA", sourceEvidence: {} as ListingImageSourceEvidence,
      snapshot: { mode: overrides.mode?.() ?? "live", marketplaceId, sellerSku: identity.sellerSku, asin: "B09S5VY2JS", productType: "PET_FOOD", title: "Turkey treats", attributesPresent: true,
        images: attributes.map((attributeName, index) => ({ attributeName, label: String(index + 1), url: ((overrides.mode?.() === "demo" ? demoCanonical : canonical).get(identity.sellerSku) ?? old)[index] ?? null,
          capability: { attributeName, label: String(index + 1), supported: true, editable: true, required: index === 0, reason: null } })),
        fetchedAt: new Date().toISOString(), requestId: null, issues: [], notice: "" },
    })),
    validationPreview: vi.fn(async () => ({ ok: true, status: 200, requestId: null, retryAfter: null, payload: { status: "VALID", issues: [] } })),
    commitOnce: vi.fn(async (patch, fence) => { await fence.assertCurrent(); canonical.set(patch.sellerSku, patch.requestedUrls); return { ok: true, status: 200, requestId: "batch-commit", retryAfter: null, payload: { status: "ACCEPTED", issues: [], submissionId: "batch-submission" } }; }),
    replaceDemoImages: vi.fn(async (patch, fence) => { await fence.assertCurrent(); demoCanonical.set(patch.sellerSku, patch.requestedUrls); }),
  };
  const assertPreparedImageUrls = vi.fn(async (_input: Parameters<ListingImageBatchDependencies["assertPreparedImageUrls"]>[0]) => (overrides.now ?? Date.now)() + 60 * 60_000);
  const owner = new ListingImageBatchMutations({ context, writeGate, operations: createListingImageMutationOperations(gateway), assertPreparedImageUrls, readbackDelaysMs: [0], ...overrides });
  return { owner, gateway, approveWrite, canonical, context, writeGate, assertPreparedImageUrls, directory };
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
  it("advertises selected-position support while retaining the complete-replacement capability", async () => {
    const { owner, gateway, assertPreparedImageUrls } = await setup();
    const response = await owner.handle({ operation: "capabilities", request: request("GET") });
    expect(response).toMatchObject({ status: 200, body: { kind: "json", value: {
      capability: "listing-image-batch-v1", replacementMode: "complete", selectedSlotReplacement: true,
      maxSkus: 30, maxImagesPerSku: 10, confirmationMode: "native", readbackRecovery: "exact-sku-v1",
    } } });
    expect(gateway.read).not.toHaveBeenCalled();
    expect(assertPreparedImageUrls).not.toHaveBeenCalled();
  });

  it("merges a sparse selected position into each fresh canonical image set without deleting other images", async () => {
    const { owner, gateway, canonical, assertPreparedImageUrls, approveWrite } = await setup();
    const original = Array.from({ length: 10 }, (_, index) => `https://images.example.com/original-${index + 1}.jpg`);
    canonical.set("AFA21AM", original);
    const sharedImage = "https://images.example.com/prepared-series.jpg";
    const selected = [null, null, null, null, null, null, null, null, sharedImage, null];
    const response = await owner.handle({ operation: "preview", request: request("POST", {
      marketplaceId, replacementMode: "selected-slots", rows: [{ sellerSku: "AFA21AM", urls: selected }],
    }) });
    expect(response.status).toBe(200);
    expect(value(response)).toMatchObject({ replacementMode: "selected-slots", totals: { ready: 1, deletedSlots: 0 }, rows: [{
      previousUrls: original, requestedUrls: [...original.slice(0, 8), sharedImage, original[9]],
      changedSlots: [9], deletedSlots: [], state: "ready",
    }] });
    expect(assertPreparedImageUrls).toHaveBeenCalled();
    for (const [input] of assertPreparedImageUrls.mock.calls) {
      expect(input).toMatchObject({ sellerSku: "AFA21AM", urls: selected });
    }
    expect(gateway.validationPreview).toHaveBeenCalledOnce();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
    expect(approveWrite).not.toHaveBeenCalled();
  });

  it("updates only selected slots for multiple SKUs after one mode-specific native approval", async () => {
    const { owner, gateway, approveWrite, canonical, assertPreparedImageUrls } = await setup();
    const skus = ["AFA21AM", "AFA22AM"];
    const rows = skus.map(sellerSku => ({ sellerSku, urls: [null, null, null, null, null, null, null, null,
      `https://images.example.com/${sellerSku}-shared.jpg`, null] }));
    const review = value(await owner.handle({ operation: "preview", request: request("POST", { marketplaceId, replacementMode: "selected-slots", rows }) }));
    const body = { marketplaceId, batchId: review.batchId, reviewToken: review.reviewToken, selectedSlotsAcknowledged: true };
    expect((await owner.handle({ operation: "commit", request: request("PATCH", body) })).status).toBe(202);
    const result = await terminal(owner, review);
    expect(result).toMatchObject({ replacementMode: "selected-slots", totals: { submitted: 2, accepted: 2, verified: 2, deletedSlots: 0 } });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(approveWrite.mock.calls[0][0]).toContain("指定位置");
    expect(approveWrite.mock.calls[0][0]).toContain("其他圖片保留");
    expect(gateway.commitOnce).toHaveBeenCalledTimes(2);
    for (const row of rows) {
      expect(canonical.get(row.sellerSku)).toEqual([old[0], old[1], null, null, null, null, null, null, row.urls[8], null]);
    }
    for (const [input] of assertPreparedImageUrls.mock.calls) {
      expect(input.urls).toEqual(rows.find(row => row.sellerSku === input.sellerSku)!.urls);
    }
    expect((await owner.handle({ operation: "commit", request: request("PATCH", body) })).status).toBe(200);
    await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: review.batchId, refresh: "true" }) });
    expect(gateway.commitOnce).toHaveBeenCalledTimes(2);
  });

  it.each(["complete", "selected-slots"] as const)("rejects missing, mixed, and other-mode acknowledgements for %s", async replacementMode => {
    const { owner, gateway, approveWrite } = await setup();
    const review = value(await owner.handle({ operation: "preview", request: request("POST", {
      marketplaceId, replacementMode, rows: [{ sellerSku: "AFA21AM", urls: proposed("AFA21AM") }],
    }) }));
    const body = { marketplaceId, batchId: review.batchId, reviewToken: review.reviewToken };
    const other = replacementMode === "complete" ? { selectedSlotsAcknowledged: true } : { completeReplacementAcknowledged: true };
    for (const acknowledgement of [{}, other, { completeReplacementAcknowledged: true, selectedSlotsAcknowledged: true }]) {
      expect((await owner.handle({ operation: "commit", request: request("PATCH", { ...body, ...acknowledgement }) })).status).toBe(422);
    }
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("rejects a selected-slot row when a preserved canonical image changes after review", async () => {
    const { owner, gateway, canonical, approveWrite } = await setup();
    const selected = [null, "https://images.example.com/new-shared.jpg", ...Array<null>(8).fill(null)];
    const review = value(await owner.handle({ operation: "preview", request: request("POST", {
      marketplaceId, replacementMode: "selected-slots", rows: [{ sellerSku: "AFA21AM", urls: selected }],
    }) }));
    canonical.set("AFA21AM", ["https://images.example.com/changed-main.jpg", ...old.slice(1)]);
    expect((await owner.handle({ operation: "commit", request: request("PATCH", {
      marketplaceId, batchId: review.batchId, reviewToken: review.reviewToken, selectedSlotsAcknowledged: true,
    }) })).status).toBe(202);
    expect(await terminal(owner, review)).toMatchObject({ phase: "stopped", totals: { submitted: 0 }, rows: [{ state: "blocked", code: "STALE_LISTING" }] });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("rechecks selected sources at the final send fence and keeps expired sources from being sent", async () => {
    const { owner, gateway, assertPreparedImageUrls } = await setup();
    const selected = [null, "https://images.example.com/shared.jpg", ...Array<null>(8).fill(null)];
    assertPreparedImageUrls.mockImplementation(async input => {
      expect(input.urls).toEqual(selected);
      if (vi.mocked(gateway.validationPreview).mock.calls.length >= 3) throw new SpApiError("圖片已過期。", { status: 409, code: "IMAGE_PREPARATION_EXPIRED" });
      return Date.now() + 60 * 60_000;
    });
    const review = value(await owner.handle({ operation: "preview", request: request("POST", {
      marketplaceId, replacementMode: "selected-slots", rows: [{ sellerSku: "AFA21AM", urls: selected }],
    }) }));
    await owner.handle({ operation: "commit", request: request("PATCH", {
      marketplaceId, batchId: review.batchId, reviewToken: review.reviewToken, selectedSlotsAcknowledged: true,
    }) });
    expect(await terminal(owner, review)).toMatchObject({ totals: { submitted: 0 }, rows: [{ state: "not-started", code: "IMAGE_PREPARATION_EXPIRED" }] });
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("keeps an uncertain selected-slot write non-replayable through a new complete-replacement plan", async () => {
    const { owner, gateway, approveWrite } = await setup();
    vi.mocked(gateway.commitOnce).mockRejectedValue(new SpApiError("Unknown transport outcome", { status: 503, code: "UPDATE_STATUS_UNKNOWN" }));
    const review = value(await owner.handle({ operation: "preview", request: request("POST", {
      marketplaceId, replacementMode: "selected-slots", rows: ["AFA12AM", "AFA13AM"].map(sellerSku => ({
        sellerSku, urls: [null, `https://images.example.com/${sellerSku}-shared.jpg`, ...Array<null>(8).fill(null)],
      })),
    }) }));
    await owner.handle({ operation: "commit", request: request("PATCH", {
      marketplaceId, batchId: review.batchId, reviewToken: review.reviewToken, selectedSlotsAcknowledged: true,
    }) });
    expect(await terminal(owner, review)).toMatchObject({ phase: "stopped", rows: [{ state: "unknown" }, { state: "not-started" }] });
    const another = await previewSkus(owner);
    await submit(owner, another);
    expect(await terminal(owner, another)).toMatchObject({ phase: "stopped", totals: { submitted: 0 } });
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledOnce();
  });

  it("retains FBA, current MAIN, duplicate-image, and editable-slot validation for selected replacements", async () => {
    const { owner, gateway, canonical, approveWrite } = await setup();
    canonical.set("EMPTYMAIN", [null, old[1], ...Array<null>(8).fill(null)]);
    const read = vi.mocked(gateway.read).getMockImplementation()!;
    vi.mocked(gateway.read).mockImplementation(async (...args) => {
      const result = await read(...args);
      if (args[0].sellerSku === "FBM") return { ...result, fulfillment: "FBM" } as unknown as Awaited<ReturnType<ListingImageGateway["read"]>>;
      if (args[0].sellerSku !== "READONLY") return result;
      return { ...result, snapshot: { ...result.snapshot, images: result.snapshot.images.map((image, index) => index === 8
        ? { ...image, capability: { ...image.capability, editable: false } } : image) } };
    });
    const select = (url: string) => [null, null, null, null, null, null, null, null, url, null];
    const response = await owner.handle({ operation: "preview", request: request("POST", {
      marketplaceId, replacementMode: "selected-slots", rows: [
        { sellerSku: "EMPTYMAIN", urls: select("https://images.example.com/a.jpg") },
        { sellerSku: "DUPLICATE", urls: select(old[0]!) },
        { sellerSku: "READONLY", urls: select("https://images.example.com/b.jpg") },
        { sellerSku: "FBM", urls: select("https://images.example.com/c.jpg") },
      ],
    }) });
    expect(response.status).toBe(200);
    expect(value(response).rows.map(row => [row.state, row.code])).toEqual([
      ["blocked", "MAIN_IMAGE_REQUIRED"], ["blocked", "DUPLICATE_IMAGE_URL"],
      ["blocked", "IMAGE_FIELD_READ_ONLY"], ["blocked", "LISTING_IDENTITY_MISMATCH"],
    ]);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it.each([
    ["all-preserve", Array<null>(10).fill(null)],
    ["short", [null, "https://images.example.com/shared.jpg"]],
    ["duplicate selected URL", [null, "https://images.example.com/shared.jpg", "https://images.example.com/shared.jpg", ...Array<null>(7).fill(null)]],
  ])("rejects an invalid %s selected-slot request before image preparation or Amazon reads", async (_label, urls) => {
    const { owner, gateway, assertPreparedImageUrls } = await setup();
    expect((await owner.handle({ operation: "preview", request: request("POST", {
      marketplaceId, replacementMode: "selected-slots", rows: [{ sellerSku: "AFA21AM", urls }],
    }) })).status).toBe(400);
    expect(gateway.read).not.toHaveBeenCalled();
    expect(assertPreparedImageUrls).not.toHaveBeenCalled();
  });


  it("ends review ten minutes before the earliest source expires even when the normal ticket is longer", async () => {
    let now = Date.parse("2026-09-14T00:48:00.000Z");
    const {owner,gateway,approveWrite} = await setup({now:()=>now,assertPreparedImageUrls:async()=>Date.parse("2026-09-14T01:00:00.000Z")});
    const review = await previewSkus(owner);
    expect(review.expiresAt).toBe("2026-09-14T00:50:00.000Z");
    now = Date.parse("2026-09-14T00:50:00.000Z");
    expect((await submit(owner,review)).status).toBe(410);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });
  it("isolates every expired source after a slow thirty-SKU preview without native approval", async () => {
    let now = Date.parse("2026-09-14T00:00:00.000Z");
    const expiry = now + 60 * 60_000;
    const {owner,gateway,approveWrite} = await setup({now:()=>now,assertPreparedImageUrls:async()=>expiry});
    vi.mocked(gateway.validationPreview).mockImplementation(async()=>{
      now += 2 * 60_000;
      return {ok:true,status:200,requestId:null,retryAfter:null,payload:{status:"VALID",issues:[]}};
    });
    const review = await previewSkus(owner,Array.from({length:30},(_,index)=>`SKU${index}`));
    expect(review.totals).toMatchObject({skus:30,ready:0,blocked:30});
    expect(review.rows.every(row=>row.code === "IMAGE_PREPARATION_EXPIRED")).toBe(true);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it("checks expiry again for each submitted SKU and skips a newly expired source without another PATCH", async () => {
    let now = Date.parse("2026-09-14T00:40:00.000Z");
    const {owner,gateway,approveWrite} = await setup({now:()=>now,assertPreparedImageUrls:async()=>Date.parse("2026-09-14T01:00:00.000Z")});
    const original = vi.mocked(gateway.commitOnce).getMockImplementation()!;
    vi.mocked(gateway.commitOnce).mockImplementation(async(patch,fence)=>{
      const result = await original(patch,fence);
      now = Date.parse("2026-09-14T00:50:00.000Z");
      return result;
    });
    const review = await previewSkus(owner);
    expect((await submit(owner,review)).status).toBe(202);
    const result = await terminal(owner,review);
    expect(result.totals).toMatchObject({submitted:1,accepted:1});
    expect(result.rows[1]).toMatchObject({state:"not-started",code:"IMAGE_PREPARATION_EXPIRED"});
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    await owner.handle({operation:"observe",request:request("GET",{},{marketplaceId,batchId:review.batchId})});
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
  });

  it("does not ask for native approval if source validity expires during fresh preapproval previews", async () => {
    let now = Date.parse("2026-09-14T00:40:00.000Z");
    const {owner,gateway,approveWrite} = await setup({now:()=>now,assertPreparedImageUrls:async()=>Date.parse("2026-09-14T01:00:00.000Z")});
    const review = await previewSkus(owner);
    vi.mocked(gateway.validationPreview).mockImplementation(async()=>{
      now += 5 * 60_000;
      return {ok:true,status:200,requestId:null,retryAfter:null,payload:{status:"VALID",issues:[]}};
    });
    expect((await submit(owner,review)).status).toBe(202);
    const result = await terminal(owner,review);
    expect(result).toMatchObject({phase:"stopped",totals:{submitted:0,ready:0,blocked:2}});
    expect(approveWrite).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

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

  it("refreshes an accepted terminal batch from fresh canonical GET after Amazon finishes later", async () => {
    const { owner, gateway, approveWrite, canonical } = await setup();
    vi.mocked(gateway.commitOnce).mockImplementation(async (_patch, fence) => {
      await fence.assertCurrent();
      return { ok: true, status: 200, requestId: null, retryAfter: null,
        payload: { status: "ACCEPTED", issues: [], submissionId: "processing" } };
    });
    const preview = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, preview);
    expect(await terminal(owner, preview)).toMatchObject({ phase: "completed", totals: { accepted: 1, verified: 0 } });
    canonical.set("AFA12AM", proposed("AFA12AM"));
    const previousReads = vi.mocked(gateway.read).mock.calls.length;
    const observed = value(await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: preview.batchId }) }));
    expect(observed.totals.verified).toBe(0);
    expect(gateway.read).toHaveBeenCalledTimes(previousReads);
    const refreshed = value(await owner.handle({ operation: "observe", request: request("GET", {}, {
      marketplaceId, batchId: preview.batchId, refresh: "true",
    }) }));
    expect(refreshed.phase).toBe("readback");
    expect(await terminal(owner, preview)).toMatchObject({ phase: "completed", totals: { accepted: 1, verified: 1 }, rows: [{ state: "verified" }] });
    expect(gateway.read).toHaveBeenCalledTimes(previousReads + 1);
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledOnce();
  });

  it("explains pending from the same fresh GET without exposing URLs or upstream issue text", async () => {
    const { owner, gateway, approveWrite, canonical } = await setup();
    vi.mocked(gateway.commitOnce).mockImplementation(async (_patch, fence) => {
      await fence.assertCurrent();
      return { ok: true, status: 200, requestId: null, retryAfter: null, payload: { status: "ACCEPTED", issues: [] } };
    });
    const review = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, review);
    const initial = await terminal(owner, review);
    expect(initial.rows[0]).toMatchObject({ readbackDiagnostics: {
      version: 1, decision: "pending", blockers: ["url-mismatch"],
      issues: { errorCount: 0, imageErrorCount: 0, nonImageErrorCount: 0, unscopedErrorCount: 0 },
      slots: { compared: true, targetCount: 10, matchedCount: 8, differentUrlCount: 1, deletionPendingCount: 1, unchangedPreviousCount: 2 },
    } });
    canonical.set("AFA12AM", proposed("AFA12AM"));
    const read = vi.mocked(gateway.read).getMockImplementation()!;
    vi.mocked(gateway.read).mockImplementation(async (identity, purpose) => {
      const observation = await read(identity, purpose);
      observation.snapshot.issues = [{ code: "PRIVATE-CODE", severity: "ERROR", message: "PRIVATE-ISSUE https://private.invalid/token", attributeNames: ["ingredients"] }];
      return observation;
    });
    const before = vi.mocked(gateway.read).mock.calls.length;
    await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: review.batchId, refresh: "true" }) });
    const latest = await terminal(owner, review);
    expect(latest.rows[0].message).toBe("已讀取 Amazon，尚未符合回查確認條件；請查看本次回查原因，勿重送。");
    expect(latest.rows[0]).toMatchObject({ state: "accepted", readbackDiagnostics: {
      version: 1, decision: "pending", blockers: ["error-issues"],
      issues: { errorCount: 1, imageErrorCount: 0, nonImageErrorCount: 1, unscopedErrorCount: 0 },
      slots: { compared: true, targetCount: 10, matchedCount: 10, differentUrlCount: 0, deletionPendingCount: 0, unchangedPreviousCount: 0 },
    } });
    expect(JSON.stringify((latest.rows[0] as unknown as { readbackDiagnostics: unknown }).readbackDiagnostics)).not.toMatch(/PRIVATE|https:|ingredients|AFA12AM|B09S5VY2JS/u);
    expect(gateway.read).toHaveBeenCalledTimes(before + 1);
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledOnce();
  });

  it("recovers exact accepted targets after restart without preparing, previewing, approving, or resending", async () => {
    const { owner, gateway, canonical, context, approveWrite, directory } = await setup();
    vi.mocked(gateway.commitOnce).mockImplementation(async (_patch, fence) => {
      await fence.assertCurrent();
      return { ok: true, status: 200, requestId: null, retryAfter: null,
        payload: { status: "ACCEPTED", issues: [], submissionId: "processing" } };
    });
    const review = await previewSkus(owner);
    await submit(owner, review);
    expect((await terminal(owner, review)).totals).toMatchObject({ accepted: 2, verified: 0 });
    owner.clear();
    const store = new LocalStore(join(directory, "store.json"));
    await store.initialize();
    const resumed = new ListingImageBatchMutations({ context,
      writeGate: new MainWriteGate({ store, context, approveWrite }),
      operations: createListingImageMutationOperations(gateway),
      assertPreparedImageUrls: vi.fn(async () => { throw new Error("Recovery must never prepare sources"); }),
      readbackDelaysMs: [0],
    });
    const previews = vi.mocked(gateway.validationPreview).mock.calls.length;
    canonical.set("AFA12AM", proposed("AFA12AM"));
    canonical.set("AFA13AM", proposed("AFA13AM"));
    const recovered = value(await resumed.handle({ operation: "recover", request: request("GET", {}, {
      marketplaceId, recoverSkus: JSON.stringify(["AFA12AM", "AFA13AM"]),
    }) }));
    expect(recovered.phase).toBe("readback");
    expect(JSON.stringify(recovered)).not.toMatch(/imageWriteEvidence|accountScope|proposalFingerprint|submissionId|idempotencyKey/u);
    expect((await terminal(resumed, recovered)).totals).toMatchObject({ accepted: 2, verified: 2 });
    expect((await submit(resumed, recovered)).status).toBe(200);
    expect(gateway.validationPreview).toHaveBeenCalledTimes(previews);
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(gateway.commitOnce).toHaveBeenCalledTimes(2);
  });

  it("coalesces overlapping manual reads and preserves pending rows when canonical values still differ", async () => {
    const { owner, gateway, approveWrite } = await setup();
    vi.mocked(gateway.commitOnce).mockImplementation(async (_patch, fence) => {
      await fence.assertCurrent();
      return { ok: true, status: 200, requestId: null, retryAfter: null, payload: { status: "ACCEPTED", issues: [] } };
    });
    const review = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, review);
    await terminal(owner, review);
    const read = vi.mocked(gateway.read).getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(gateway.read).mockImplementation(async (identity, purpose) => { await held; return read(identity, purpose); });
    const before = vi.mocked(gateway.read).mock.calls.length;
    const refresh = () => owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: review.batchId, refresh: "true" }) });
    const refreshing = value(await refresh());
    expect(refreshing.phase).toBe("readback");
    expect(refreshing.rows[0].readbackDiagnostics).toBeUndefined();
    expect(value(await refresh()).phase).toBe("readback");
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(before + 1));
    release();
    const latest = await terminal(owner, review);
    expect(latest).toMatchObject({ totals: { accepted: 1, verified: 0 }, rows: [{ state: "accepted", code: "IMAGE_READBACK_PENDING" }] });
    expect(latest.lastReadbackAt).toEqual(expect.any(String));
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledOnce();
  });

  it("keeps the owner's readback limit at two even when another terminal plan is refreshed", async () => {
    const { owner, gateway } = await setup();
    vi.mocked(gateway.commitOnce).mockImplementation(async (_patch, fence) => {
      await fence.assertCurrent();
      return { ok: true, status: 200, requestId: null, retryAfter: null, payload: { status: "ACCEPTED", issues: [] } };
    });
    const first = await previewSkus(owner, ["AFA12AM", "AFA13AM"]);
    await submit(owner, first);
    await terminal(owner, first);
    const second = await previewSkus(owner, ["AFA14AM"]);
    await submit(owner, second);
    await terminal(owner, second);
    const read = vi.mocked(gateway.read).getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(gateway.read).mockImplementation(async (identity, purpose) => { await held; return read(identity, purpose); });
    const before = vi.mocked(gateway.read).mock.calls.length;
    const refresh = (batchId: string) => owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId, refresh: "true" }) });
    expect((await refresh(first.batchId)).status).toBe(202);
    expect((await refresh(second.batchId)).status).toBe(409);
    await vi.waitFor(() => expect(gateway.read).toHaveBeenCalledTimes(before + 2));
    release();
    await terminal(owner, first);
    expect(gateway.commitOnce).toHaveBeenCalledTimes(3);
  });

  it("discards a late manual read after the security context clears and leaves its accepted evidence intact", async () => {
    const { owner, gateway, context, writeGate } = await setup();
    vi.mocked(gateway.commitOnce).mockImplementation(async (_patch, fence) => {
      await fence.assertCurrent();
      return { ok: true, status: 200, requestId: null, retryAfter: null, payload: { status: "ACCEPTED", issues: [] } };
    });
    const review = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, review);
    await terminal(owner, review);
    const read = vi.mocked(gateway.read).getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(gateway.read).mockImplementation(async (identity, purpose) => { await held; return read(identity, purpose); });
    await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: review.batchId, refresh: "true" }) });
    context.invalidate("lock-screen"); writeGate.clearEphemeral(); owner.clear(); release();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: review.batchId }) })).status).toBe(410);
    const inspections = await writeGate.inspect({ context: await context.capture(marketplaceId), marketplaceId, sellerSku: "AFA12AM", operations: ["images"], project: entry => entry });
    expect(inspections).toMatchObject([{ state: "unknown", response: { status: "ACCEPTED" } }]);
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
  });

  it("recovers the live accepted target when a newer same-account demo simulation exists", async () => {
    let mode: "live" | "demo" = "live";
    const { owner, gateway, context, writeGate, approveWrite } = await setup({ mode: () => mode });
    const liveReview = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, liveReview);
    expect((await terminal(owner, liveReview)).rows[0].state).toBe("verified");
    mode = "demo"; context.invalidate("mode-changed"); writeGate.clearEphemeral(); owner.clear();
    const demoReview = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, demoReview);
    expect((await terminal(owner, demoReview)).rows[0].state).toBe("simulated");
    mode = "live"; context.invalidate("mode-changed"); writeGate.clearEphemeral(); owner.clear();
    const before = vi.mocked(gateway.read).mock.calls.length;
    const recovered = value(await owner.handle({ operation: "recover", request: request("GET", {}, {
      marketplaceId, recoverSkus: JSON.stringify(["AFA12AM"]),
    }) }));
    expect((await terminal(owner, recovered)).rows[0].state).toBe("verified");
    expect(gateway.read).toHaveBeenCalledTimes(before + 1);
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
    expect(gateway.replaceDemoImages).toHaveBeenCalledOnce();
    expect(approveWrite).toHaveBeenCalledTimes(2);
  });

  it.each(["unknown", "malformed-demo", "unresolved-demo", "contradictory-demo"] as const)("does not hide a newer %s attempt behind an older accepted receipt during recovery", async kind => {
    const { owner, gateway, context, writeGate } = await setup();
    const review = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, review);
    await terminal(owner, review);
    const current = await context.capture(marketplaceId);
    const [older] = await writeGate.inspect({ context: current, marketplaceId, sellerSku: "AFA12AM", operations: ["images"], project: entry => entry });
    const response = kind === "unknown" ? null : {
      ...(older.response as Record<string, unknown>), mode: "demo", status: kind === "contradictory-demo" ? "ACCEPTED" : "SIMULATED",
      ...(kind === "malformed-demo" ? { imageWriteEvidence: null } : {}),
    };
    vi.spyOn(writeGate, "inspect").mockResolvedValue([
      { ...older, state: kind === "malformed-demo" || kind === "contradictory-demo" ? "completed" : "unknown", response, createdAt: older.createdAt + 1 }, older,
    ]);
    const before = vi.mocked(gateway.read).mock.calls.length;
    const recovered = value(await owner.handle({ operation: "recover", request: request("GET", {}, {
      marketplaceId, recoverSkus: JSON.stringify(["AFA12AM"]),
    }) }));
    expect(recovered).toMatchObject({ phase: "completed", totals: { accepted: 0, verified: 0 }, rows: [{ state: "unknown", code: "IMAGE_WRITE_EVIDENCE_UNAVAILABLE" }] });
    expect(gateway.read).toHaveBeenCalledTimes(before);
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
  });

  it("does not recover another account's target or invent a receipt when none exists", async () => {
    const { owner, gateway, context, writeGate } = await setup();
    const inspect = vi.spyOn(writeGate, "inspect");
    const result = value(await owner.handle({ operation: "recover", request: request("GET", {}, { marketplaceId, recoverSkus: JSON.stringify(["AFA12AM"]) }) }));
    expect(result.rows[0]).toMatchObject({ state: "blocked", code: "IMAGE_WRITE_NOT_FOUND", acceptedAt: null });
    expect(inspect.mock.calls[0][0]).toMatchObject({ context: await context.capture(marketplaceId), marketplaceId, sellerSku: "AFA12AM", operations: ["images"], requireComplete: true });
    expect(gateway.read).not.toHaveBeenCalled();
    expect(gateway.commitOnce).not.toHaveBeenCalled();
  });

  it.each([
    [], ["AFA12AM", "AFA12AM"], [" AFA12AM"], [null], Array.from({ length: 31 }, (_, index) => `SKU${index}`),
  ].map(skus => ({ skus })))("rejects invalid recovery selections $skus before touching the ledger or Amazon", async ({ skus }) => {
    const { owner, gateway, writeGate } = await setup();
    const inspect = vi.spyOn(writeGate, "inspect");
    expect((await owner.handle({ operation: "recover", request: request("GET", {}, { marketplaceId, recoverSkus: JSON.stringify(skus) }) })).status).toBe(400);
    expect(inspect).not.toHaveBeenCalled();
    expect(gateway.read).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and mixed recovery authority", async () => {
    const { owner, gateway, writeGate } = await setup();
    const inspect = vi.spyOn(writeGate, "inspect");
    const queries: Record<string, string>[] = [
      { marketplaceId, recoverSkus: "not-json" },
      { marketplaceId, recoverSkus: '["AFA12AM"]', batchId: "other" },
      { marketplaceId, recoverSkus: '["AFA12AM"]', accountScope: "other-account" },
    ];
    for (const query of queries) expect((await owner.handle({ operation: "recover", request: request("GET", {}, query) })).status).toBe(400);
    expect(inspect).not.toHaveBeenCalled();
    expect(gateway.read).not.toHaveBeenCalled();
  });

  it("keeps the readback unresolved when a GET fails and never reuses source expiry as write authority", async () => {
    let now = Date.now();
    const { owner, gateway, canonical, assertPreparedImageUrls } = await setup({ now: () => now });
    vi.mocked(gateway.commitOnce).mockImplementation(async (_patch, fence) => {
      await fence.assertCurrent();
      return { ok: true, status: 200, requestId: null, retryAfter: null, payload: { status: "ACCEPTED", issues: [] } };
    });
    const review = await previewSkus(owner, ["AFA12AM"]);
    await submit(owner, review);
    const initial = await terminal(owner, review);
    expect(initial.rows[0].readbackDiagnostics).toBeDefined();
    now += 2 * 60 * 60_000;
    const preparationCalls = assertPreparedImageUrls.mock.calls.length;
    vi.mocked(gateway.read).mockRejectedValueOnce(new SpApiError("Network error", { status: 503, code: "UPSTREAM_UNAVAILABLE" }));
    await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: review.batchId, refresh: "true" }) });
    const failed = await terminal(owner, review);
    expect(failed).toMatchObject({ totals: { accepted: 1, verified: 0 }, rows: [{ state: "accepted", code: "UPSTREAM_UNAVAILABLE" }], lastReadbackAt: new Date(now).toISOString() });
    expect(failed.rows[0].readbackDiagnostics).toBeUndefined();
    canonical.set("AFA12AM", proposed("AFA12AM"));
    await owner.handle({ operation: "observe", request: request("GET", {}, { marketplaceId, batchId: review.batchId, refresh: "true" }) });
    expect((await terminal(owner, review)).totals.verified).toBe(1);
    expect(assertPreparedImageUrls).toHaveBeenCalledTimes(preparationCalls);
    expect(gateway.commitOnce).toHaveBeenCalledOnce();
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
      return Date.now() + 60 * 60_000;
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
