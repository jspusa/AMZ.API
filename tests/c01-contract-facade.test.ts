import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const DELEGATED_RESPONSE: ApiResponse = {
  status: 200,
  headers: {
    "cache-control": "private, no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  },
  body: {
    kind: "json",
    value: { owner: "listings-export-routes" },
  },
};

describe("C01 contract facade", () => {
  it("delegates the exact Listings export status route without owning its workflow", async () => {
    const request: ApiRequest = {
      requestId: "c01-export-route-001",
      method: "GET",
      path: "/api/sp-api/listing-content/export",
      query: { deliberatelyInvalidLegacyQuery: "1" },
      headers: {},
    };
    const listingsExportRoutes = {
      start: vi.fn(async () => DELEGATED_RESPONSE),
      observe: vi.fn(async () => DELEGATED_RESPONSE),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      listingsExportRoutes,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(response).toBe(DELEGATED_RESPONSE);
    expect(listingsExportRoutes.observe).toHaveBeenCalledOnce();
    expect(listingsExportRoutes.observe).toHaveBeenCalledWith(request);
    expect(listingsExportRoutes.start).not.toHaveBeenCalled();
  });
});
