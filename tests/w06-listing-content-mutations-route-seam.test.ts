import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

type ListingContentMutationCommand = Readonly<{
  operation: "read" | "preview" | "commit";
  request: ApiRequest;
}>;

describe("W06 Listing Content mutation public route seam", () => {
  it.each([
    ["GET", "read"],
    ["POST", "preview"],
    ["PATCH", "commit"],
  ] as const)(
    "delegates %s /api/sp-api/listing-content to the Listing Content mutation owner",
    async (method, operation) => {
      const request: ApiRequest = {
        requestId: `w06-listing-content-${operation}-001`,
        method,
        path: "/api/sp-api/listing-content",
        query: {},
        headers: {},
        ...(method === "GET"
          ? {}
          : {
              body: {
                kind: "json" as const,
                value: { marketplaceId: "invalid" },
              },
            }),
      };
      const sentinel: ApiResponse = {
        status: 207,
        headers: { "x-w06-owner": "listing-content-mutations" },
        body: { kind: "json", value: { delegated: true } },
      };
      const handle = vi.fn(
        async (_command: ListingContentMutationCommand) => sentinel,
      );
      const router = new ApiRouter({
        store: {} as LocalStore,
        vault: {} as CredentialVault,
        approveWrite: async () => undefined,
        listingContentMutations: { handle },
      } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

      const response = await router.handle(request);

      expect(handle).toHaveBeenCalledOnce();
      expect(handle).toHaveBeenCalledWith({ operation, request });
      expect(handle.mock.calls[0]?.[0].request).toBe(request);
      expect(response).toBe(sentinel);
    },
  );
});
