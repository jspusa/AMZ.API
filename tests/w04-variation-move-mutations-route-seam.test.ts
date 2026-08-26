import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

type VariationMoveMutationCommand = Readonly<{
  operation: "prepare" | "preview" | "commit";
  request: ApiRequest;
}>;

function routerWithSentinel(
  handle: (command: VariationMoveMutationCommand) => Promise<ApiResponse>,
): ApiRouter {
  return new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite: async () => undefined,
    variationMoveMutations: { handle },
  } as unknown as ConstructorParameters<typeof ApiRouter>[0]);
}

function sentinel(): ApiResponse {
  return {
    status: 207,
    headers: { "x-w04-owner": "variation-move-mutations" },
    body: { kind: "json", value: { delegated: true } },
  };
}

describe("W04 Variation Move mutation public route seam", () => {
  it("delegates preparation to the Variation Move mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w04-variation-prepare-001",
      method: "GET",
      path: "/api/sp-api/variation-move",
      query: {},
      headers: {},
    };
    const responseSentinel = sentinel();
    const handle = vi.fn(
      async (_command: VariationMoveMutationCommand) => responseSentinel,
    );

    const response = await routerWithSentinel(handle).handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "prepare", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(responseSentinel);
  });

  it("delegates preview to the Variation Move mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w04-variation-preview-001",
      method: "POST",
      path: "/api/sp-api/variation-move",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: "invalid" } },
    };
    const responseSentinel = sentinel();
    const handle = vi.fn(
      async (_command: VariationMoveMutationCommand) => responseSentinel,
    );

    const response = await routerWithSentinel(handle).handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "preview", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(responseSentinel);
  });

  it("delegates commit to the Variation Move mutation owner", async () => {
    const request: ApiRequest = {
      requestId: "w04-variation-commit-001",
      method: "PATCH",
      path: "/api/sp-api/variation-move",
      query: {},
      headers: {},
      body: { kind: "json", value: { marketplaceId: "invalid" } },
    };
    const responseSentinel = sentinel();
    const handle = vi.fn(
      async (_command: VariationMoveMutationCommand) => responseSentinel,
    );

    const response = await routerWithSentinel(handle).handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ operation: "commit", request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(responseSentinel);
  });
});
