import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;

function validPng(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1_000);
  view.setUint32(20, 1_000);
  return bytes;
}

describe("R04 local utility route seams", () => {
  it.each([
    {
      operation: "uploadImage" as const,
      request: {
        requestId: "r04-image-route-001",
        method: "POST",
        path: "/api/uploads/listing-images",
        query: {},
        headers: {},
        body: {
          kind: "multipart",
          fields: { marketplaceId: US, sellerSku: "LOCAL-IMAGE-SKU" },
          file: { name: "image.png", type: "image/png", bytes: validPng() },
        },
      } satisfies ApiRequest,
    },
    {
      operation: "systemHealth" as const,
      request: {
        requestId: "r04-health-route-001",
        method: "GET",
        path: "/api/system/health",
        query: { marketplaceId: US },
        headers: {},
      } satisfies ApiRequest,
    },
  ])("delegates $operation without generic method/path forwarding", async ({
    operation,
    request,
  }) => {
    const delegated: ApiResponse = {
      status: 200,
      headers: { "x-r04-local-route": operation },
      body: { kind: "json", value: { operation } },
    };
    const imageUpload = { uploadImage: vi.fn(async () => delegated) };
    const health = { systemHealth: vi.fn(async () => delegated) };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      imageUpload,
      health,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request as ApiRequest);

    const operationSpy = operation === "uploadImage"
      ? imageUpload.uploadImage
      : health.systemHealth;
    expect(operationSpy).toHaveBeenCalledOnce();
    expect(operationSpy).toHaveBeenCalledWith(request as ApiRequest);
    expect(response).toEqual(delegated);
  });
});
