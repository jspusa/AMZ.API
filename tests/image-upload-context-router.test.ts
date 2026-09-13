import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const s3Spies = vi.hoisted(() => ({
  send: vi.fn(async () => undefined),
  destroy: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: class PutObjectCommand {
    constructor(readonly input: unknown) {}
  },
  S3Client: class S3Client {
    readonly send = s3Spies.send;
    readonly destroy = s3Spies.destroy;
  },
}));

import { createScriptedSpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import { ApiRouter } from "../src/main/api-router";
import { HostedListingImages, LISTING_IMAGE_SERVICE_ORIGIN } from "../src/main/hosted-listing-images";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";

const US = "ATVPDKIKX0DER" as const;

function validPng(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1_000);
  view.setUint32(20, 1_000);
  return bytes;
}

describe("listing image upload execution context", () => {
  it.each([false, true])("prepares through the router without credentials or approval and rejects stale replies (drift=%s)", async drift => {
    s3Spies.send.mockClear();
    s3Spies.destroy.mockClear();
    const bytes = validPng();
    const id = "11111111-1111-4111-8111-111111111111";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const url = `${LISTING_IMAGE_SERVICE_ORIGIN}/listing-images/v2/${id}/${sha256}.png`;
    const mutation = vi.fn(async () => { throw new Error("Preparation must not enter Amazon mutations"); });
    const read = vi.fn(async () => { throw new Error("Preparation must not read Amazon listings"); });
    const clear = vi.fn();
    const approveWrite = vi.fn(async () => undefined);
    const getImageStorage = vi.fn(async () => { throw new Error("Preparation must not unlock credentials"); });
    let router!: ApiRouter;
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      if (init?.method === "PUT") {
        expect(String(input)).toBe(`${LISTING_IMAGE_SERVICE_ORIGIN}/api/listing-images/v2/${id}`);
        expect(Buffer.from(init.body as Uint8Array)).toEqual(Buffer.from(bytes));
        if (drift) router.invalidateContext("lock-screen");
        return Response.json({ operationId: id, sha256, url, width: 1000, height: 1000, size: bytes.length, contentType: "image/png" });
      }
      expect(String(input)).toBe(url);
      return new Response(Buffer.from(bytes), { headers: { "content-type": "image/png" } });
    });
    const service = new HostedListingImages({ fetch: transport, uuid: () => id });
    router = new ApiRouter({
      store: {} as LocalStore,
      vault: { getImageStorage } as unknown as CredentialVault,
      approveWrite, hostedImages: service,
      listingImageMutations: { handle: mutation, read, clear },
      spExecutionContext: createScriptedSpExecutionContextAdapter(marketplaceId => ({
        marketplaceId, mode: "live", accountScope: "opaque-image-upload-account",
      })),
    });
    try {
      const response = await router.handle({
        requestId: `image-preparation-${drift ? "changed" : "current"}`,
        method: "POST", path: "/api/uploads/listing-images", query: {}, headers: {},
        body: { kind: "multipart", fields: { marketplaceId: US, sellerSku: "IMAGE-CONTEXT-SKU" }, file: { name: "IMAGE-CONTEXT-SKU_01_主圖.png", type: "image/png", bytes } },
      });
      expect(response.status).toBe(drift ? 409 : 200);
      expect(response.body.kind).toBe("json");
      if (response.body.kind !== "json") throw new Error("Expected public JSON response");
      expect(response.body.value).toMatchObject(drift ? { code: "SP_CONTEXT_INVALIDATED" } : { amazonUrl: url, readyForAmazon: true });
      expect(transport).toHaveBeenCalledTimes(drift ? 1 : 2);
      expect(getImageStorage).not.toHaveBeenCalled();
      expect(mutation).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(approveWrite).not.toHaveBeenCalled();
      expect(s3Spies.send).not.toHaveBeenCalled();
      expect(clear).toHaveBeenCalledTimes(drift ? 1 : 0);
    } finally { router.dispose(); }
    expect(clear).toHaveBeenCalledTimes(drift ? 2 : 1);
  });

  it("does not write to object storage after lock invalidates a pending storage lookup", async () => {
    s3Spies.send.mockClear();
    s3Spies.destroy.mockClear();
    let storageEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      storageEntered = resolve;
    });
    let releaseStorage!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });
    const vault = {
      getImageStorage: vi.fn(async () => {
        storageEntered();
        await released;
        return {
          accountId: "fake-r2-account",
          accessKeyId: "fake-r2-access-key",
          secretAccessKey: "fake-r2-secret-key",
          bucket: "fake-listing-images",
          publicBaseUrl: "https://images.invalid",
        };
      }),
    } as unknown as CredentialVault;
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(
        (marketplaceId) => ({
          marketplaceId,
          mode: "demo",
          accountScope: "opaque-image-upload-account",
        }),
      ),
    });

    const pending = router.handle({
      requestId: "image-upload-context-lock-001",
      method: "POST",
      path: "/api/uploads/listing-images",
      query: {},
      headers: {},
      body: {
        kind: "multipart",
        fields: { marketplaceId: US, sellerSku: "IMAGE-CONTEXT-SKU" },
        file: { name: "image.png", type: "image/png", bytes: validPng() },
      },
    });
    await entered;
    router.invalidateContext("lock-screen");
    releaseStorage();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(response.body.kind === "json" ? response.body.value : null).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    expect(s3Spies.send).not.toHaveBeenCalled();
    router.dispose();
  });
});
