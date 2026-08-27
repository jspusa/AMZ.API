import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

type BusinessPricingMutationCommand = Readonly<{
  operation: "read" | "preview" | "commit";
  request: ApiRequest;
}>;

describe("W05 Business Pricing mutation public route seam", () => {
  it("delegates the single-SKU B2B read to the Business Pricing mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w05-business-pricing-read-001",
      method: "GET",
      path: "/api/sp-api/business-pricing",
      query: {},
      headers: {},
    };
    const sentinel: ApiResponse = {
      status: 207,
      headers: { "x-w05-owner": "business-pricing-mutations" },
      body: { kind: "json", value: { delegated: true } },
    };
    const handle = vi.fn(
      async (_command: BusinessPricingMutationCommand) => sentinel,
    );
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      businessPricingMutations: { handle },
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "read", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(sentinel);
  });

  it("delegates the single-SKU B2B preview to the Business Pricing mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w05-business-pricing-preview-001",
      method: "POST",
      path: "/api/sp-api/business-pricing",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: "invalid" } },
    };
    const sentinel: ApiResponse = {
      status: 207,
      headers: { "x-w05-owner": "business-pricing-mutations" },
      body: { kind: "json", value: { delegated: true } },
    };
    const handle = vi.fn(
      async (_command: BusinessPricingMutationCommand) => sentinel,
    );
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      businessPricingMutations: { handle },
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "preview", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(sentinel);
  });

  it("delegates the single-SKU B2B commit to the Business Pricing mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w05-business-pricing-commit-001",
      method: "PATCH",
      path: "/api/sp-api/business-pricing",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: "invalid" } },
    };
    const sentinel: ApiResponse = {
      status: 207,
      headers: { "x-w05-owner": "business-pricing-mutations" },
      body: { kind: "json", value: { delegated: true } },
    };
    const handle = vi.fn(
      async (_command: BusinessPricingMutationCommand) => sentinel,
    );
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      businessPricingMutations: { handle },
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "commit", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(sentinel);
  });
});
