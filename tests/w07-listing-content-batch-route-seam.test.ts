import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

type ListingContentBatchMutationCommand = Readonly<{
  operation: "preview" | "commit";
  request: ApiRequest;
}>;

describe("W07 Listing Content batch mutation public route seam", () => {
  it.each([
    ["POST", "preview"],
    ["PATCH", "commit"],
  ] as const)(
    "delegates %s /api/sp-api/listing-content/import to the batch mutation owner",
    async (method, operation) => {
      const request: ApiRequest = {
        requestId: `w07-listing-content-batch-${operation}-001`,
        method,
        path: "/api/sp-api/listing-content/import",
        query: {},
        headers: {},
        ...(method === "POST"
          ? {
              body: {
                kind: "multipart" as const,
                fields: {},
                file: {
                  name: "invalid.xlsx",
                  type:
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  bytes: new Uint8Array([0]),
                },
              },
            }
          : {
              body: {
                kind: "json" as const,
                value: {},
              },
            }),
      };
      const sentinel: ApiResponse = {
        status: 207,
        headers: { "x-w07-owner": "listing-content-batch-mutations" },
        body: { kind: "json", value: { delegated: true } },
      };
      const handle = vi.fn(
        async (_command: ListingContentBatchMutationCommand) => sentinel,
      );
      const router = new ApiRouter({
        store: {} as LocalStore,
        vault: {} as CredentialVault,
        approveWrite: async () => undefined,
        listingContentBatchMutations: { handle, clear: vi.fn() },
      } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

      const response = await router.handle(request);

      expect(handle).toHaveBeenCalledOnce();
      expect(handle).toHaveBeenCalledWith({ operation, request });
      expect(handle.mock.calls[0]?.[0].request).toBe(request);
      expect(response).toBe(sentinel);
    },
  );
});
