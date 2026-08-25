import { describe, expect, it, vi } from "vitest";
import { createScriptedSpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import { createRouterRequestContextAdapter } from
  "../src/main/router-request-context";
import {
  LocalImageUpload,
  type ImageObjectStorePort,
} from "../src/main/local-image-upload";
import type { StoredImageStorageCredentials } from
  "../src/main/credential-vault";
import type { ApiRequest } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;

function png(width = 1_000, height = 1_000): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function uploadRequest(
  bytes: Uint8Array,
  fields: Record<string, string> = {},
): ApiRequest {
  return {
    requestId: "r04-image-policy-001",
    method: "POST",
    path: "/api/uploads/listing-images",
    query: {},
    headers: {},
    body: {
      kind: "multipart",
      fields: {
        marketplaceId: US,
        sellerSku: "IMAGE-POLICY-SKU",
        ...fields,
      },
      file: { name: "listing.png", type: "image/png", bytes },
    },
  };
}

function storage(
  override: Partial<StoredImageStorageCredentials> = {},
): StoredImageStorageCredentials {
  return {
    accountId: "0123456789abcdef0123456789abcdef",
    accessKeyId: "fake-r2-access-key",
    secretAccessKey: "fake-r2-secret-key",
    bucket: "vault-owned-listing-images",
    publicBaseUrl: "https://images.example.test/catalog",
    ...override,
  };
}

function moduleWith(input: {
  stored?: StoredImageStorageCredentials | null;
  put?: ImageObjectStorePort["put"];
}) {
  const put = vi.fn(input.put ?? (async () => undefined));
  const route = new LocalImageUpload({
    context: createRouterRequestContextAdapter(
      createScriptedSpExecutionContextAdapter((marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: "opaque-r04-image-account",
      })),
    ),
    vault: { getImageStorage: async () => input.stored ?? null },
    objectStore: { put },
    uuid: () => "00000000-0000-4000-8000-000000000004",
  });
  return { route, put };
}

function valueOf(response: Awaited<ReturnType<LocalImageUpload["uploadImage"]>>) {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

describe("R04 restricted local image upload", () => {
  it("uses magic bytes and dimensions, not the renderer MIME label", async () => {
    const { route, put } = moduleWith({ stored: storage() });

    const spoofed = await route.uploadImage(uploadRequest(new Uint8Array(24)));
    const small = await route.uploadImage(uploadRequest(png(499, 1_000)));

    expect(spoofed.status).toBe(415);
    expect(valueOf(spoofed)).toMatchObject({ code: "INVALID_IMAGE" });
    expect(small.status).toBe(422);
    expect(valueOf(small)).toMatchObject({ code: "IMAGE_TOO_SMALL" });
    expect(put).not.toHaveBeenCalled();
  });

  it("enforces the 10 MiB body ceiling before object storage", async () => {
    const { route, put } = moduleWith({ stored: storage() });
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.set(png());

    const response = await route.uploadImage(uploadRequest(oversized));

    expect(response.status).toBe(413);
    expect(valueOf(response)).toMatchObject({ code: "IMAGE_TOO_LARGE" });
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps a validated local preview when no R2 vault exists", async () => {
    const { route, put } = moduleWith({ stored: null });

    const response = await route.uploadImage(uploadRequest(png()));
    const value = valueOf(response);

    expect(response.status).toBe(200);
    expect(value).toMatchObject({
      key: expect.stringMatching(
        /^listing-images\/ATVPDKIKX0DER\/[a-f0-9]{16}\/00000000-0000-4000-8000-000000000004\.png$/u,
      ),
      previewUrl: expect.stringMatching(/^data:image\/png;base64,/u),
      amazonUrl: null,
      width: 1_000,
      height: 1_000,
      contentType: "image/png",
      readyForAmazon: false,
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("ignores renderer destination fields and uses only vault-owned R2 policy", async () => {
    const vaultStorage = storage();
    const { route, put } = moduleWith({ stored: vaultStorage });
    const request = uploadRequest(png(), {
      bucket: "renderer-controlled-bucket",
      publicBaseUrl: "https://renderer-controlled.invalid",
      endpoint: "https://renderer-controlled.invalid",
      accessKeyId: "renderer-controlled-key",
    });

    const response = await route.uploadImage(request);
    const value = valueOf(response);

    expect(response.status).toBe(200);
    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      endpoint:
        "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/",
      credentials: {
        accessKeyId: vaultStorage.accessKeyId,
        secretAccessKey: vaultStorage.secretAccessKey,
      },
      bucket: vaultStorage.bucket,
      contentType: "image/png",
    }));
    expect(value.amazonUrl).toBe(
      `${vaultStorage.publicBaseUrl}/${value.key as string}`,
    );
    expect(JSON.stringify(put.mock.calls)).not.toContain("renderer-controlled");
  });

  it.each([
    ["account id", { accountId: "not-a-cloudflare-account" }],
    ["bucket", { bucket: "renderer/escape" }],
    ["public base", { publicBaseUrl: "http://images.example.test" }],
  ])("rejects invalid vault %s policy before upload", async (_label, override) => {
    const { route, put } = moduleWith({ stored: storage(override) });

    const response = await route.uploadImage(uploadRequest(png()));

    expect(response.status).toBe(422);
    expect(valueOf(response)).toMatchObject({ code: "INVALID_IMAGE_STORAGE" });
    expect(put).not.toHaveBeenCalled();
  });
});
