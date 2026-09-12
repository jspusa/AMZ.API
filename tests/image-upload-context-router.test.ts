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
import { NATIVE_CONFIRMATION_CANCELLED_MESSAGE } from "../src/main/native-confirmation";
import { HostedListingImages } from "../src/main/hosted-listing-images";
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
  it.each([false, true])("returns an actionable cancelled-login response while preserving context rejection (drift=%s)", async drift => {
    s3Spies.send.mockClear();
    s3Spies.destroy.mockClear();
    const transport = vi.fn<typeof fetch>(async () => { throw new Error("No network is expected after cancelling the login sheet"); });
    const mutation = vi.fn(async () => { throw new Error("Image preparation must not enter Amazon mutations"); });
    const read = vi.fn(async () => { throw new Error("Image preparation must not read Amazon listings"); });
    const approveWrite = vi.fn(async () => undefined);
    let router!: ApiRouter;
    const requestLogin = vi.fn(async () => {
      // Cancelling native approval rejects without creating a session.
      if (drift) router.invalidateContext("lock-screen");
      throw new Error(NATIVE_CONFIRMATION_CANCELLED_MESSAGE);
    });
    const service = new HostedListingImages({ requestLogin, fetch: transport });
    router = new ApiRouter({
      store: {} as LocalStore,
      vault: { getImageStorage: async () => null } as unknown as CredentialVault,
      approveWrite,
      hostedImages: service,
      listingImageMutations: { handle: mutation, read },
      spExecutionContext: createScriptedSpExecutionContextAdapter(marketplaceId => ({
        marketplaceId, mode: "live", accountScope: "opaque-image-upload-account",
      })),
    });
    try {
      const response = await router.handle({
        requestId: `image-login-cancel-${drift ? "changed" : "current"}`,
        method: "POST", path: "/api/uploads/listing-images", query: {}, headers: {},
        body: { kind: "multipart", fields: { marketplaceId: US, sellerSku: "IMAGE-CONTEXT-SKU" }, file: { name: "IMAGE-CONTEXT-SKU_01_主圖.png", type: "image/png", bytes: validPng() } },
      });
      expect(response.status).toBe(409);
      expect(response.body.kind).toBe("json");
      if (response.body.kind !== "json") throw new Error("Expected public JSON response");
      if (drift) expect(response.body.value).toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
      else expect(response.body.value).toEqual({
        code: "IMAGE_LOGIN_CANCELLED",
        message: "圖片服務身分驗證已取消或未通過；檔案仍保留在工作台。",
      });
      expect(requestLogin).toHaveBeenCalledOnce();
      expect(service.authenticated()).toBe(false);
      expect(transport).not.toHaveBeenCalled();
      expect(mutation).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(approveWrite).not.toHaveBeenCalled();
      expect(s3Spies.send).not.toHaveBeenCalled();
    } finally { router.dispose(); }
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
