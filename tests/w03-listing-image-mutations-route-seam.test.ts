import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

type ListingImageMutationCommand = Readonly<{
  operation: "read" | "preview" | "commit";
  request: ApiRequest;
}>;

describe("W03 listing image mutation public route seam", () => {
  it("delegates Listing Images read to the listing image mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w03-image-read-001",
      method: "GET",
      path: "/api/sp-api/listing-images",
      query: {},
      headers: {},
    };
    const sentinel: ApiResponse = {
      status: 207,
      headers: { "x-w03-owner": "listing-image-mutations" },
      body: { kind: "json", value: { delegated: true } },
    };
    const handle = vi.fn(
      async (_command: ListingImageMutationCommand) => sentinel,
    );
    const listingImageMutations = { handle };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      listingImageMutations,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "read", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(sentinel);
  });

  it("delegates Listing Images preview to the listing image mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w03-image-preview-001",
      method: "POST",
      path: "/api/sp-api/listing-images",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: "invalid" } },
    };
    const sentinel: ApiResponse = {
      status: 207,
      headers: { "x-w03-owner": "listing-image-mutations" },
      body: { kind: "json", value: { delegated: true } },
    };
    const handle = vi.fn(
      async (_command: ListingImageMutationCommand) => sentinel,
    );
    const listingImageMutations = { handle };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      listingImageMutations,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "preview", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(sentinel);
  });

  it("delegates Listing Images commit to the listing image mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w03-image-commit-001",
      method: "PATCH",
      path: "/api/sp-api/listing-images",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: "invalid" } },
    };
    const sentinel: ApiResponse = {
      status: 207,
      headers: { "x-w03-owner": "listing-image-mutations" },
      body: { kind: "json", value: { delegated: true } },
    };
    const handle = vi.fn(
      async (_command: ListingImageMutationCommand) => sentinel,
    );
    const listingImageMutations = { handle };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      listingImageMutations,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "commit", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(sentinel);
  });
});
