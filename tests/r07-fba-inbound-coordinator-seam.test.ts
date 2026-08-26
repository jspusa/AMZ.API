import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const CASES: ReadonlyArray<{
  operation: "start" | "status";
  request: ApiRequest;
}> = [
  {
    operation: "start",
    request: {
      requestId: "r07-inbound-start-route-001",
      method: "POST",
      path: "/api/sp-api/inbound-shipments",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: "invalid-on-purpose",
          startDate: "2026-08-01",
          endDate: "2026-08-07",
        },
      },
    },
  },
  {
    operation: "status",
    request: {
      requestId: "r07-inbound-status-route-001",
      method: "GET",
      path: "/api/sp-api/inbound-shipments",
      query: {},
      headers: {},
    },
  },
];

describe("R07 FBA Inbound coordinator public route seam", () => {
  it.each(CASES)(
    "delegates $operation from the exact central switch",
    async ({ operation, request }) => {
      const delegated: ApiResponse = {
        status: 207,
        headers: { "x-r07-owner": operation },
        body: { kind: "json", value: { operation } },
      };
      const coordinator = {
        start: vi.fn(async () => delegated),
        status: vi.fn(async () => delegated),
        clear: vi.fn(),
      };
      const router = new ApiRouter({
        store: {} as LocalStore,
        vault: {} as CredentialVault,
        approveWrite: async () => undefined,
        fbaInboundCoordinator: coordinator,
      });

      const response = await router.handle(request);

      expect(coordinator[operation]).toHaveBeenCalledOnce();
      expect(coordinator[operation]).toHaveBeenCalledWith(request);
      const other = operation === "start" ? "status" : "start";
      expect(coordinator[other]).not.toHaveBeenCalled();
      expect(response).toEqual(delegated);
    },
  );

  it("clears the same coordinator used by both routes", () => {
    const coordinator = {
      start: vi.fn(),
      status: vi.fn(),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      fbaInboundCoordinator: coordinator,
    });

    router.dispose();

    expect(coordinator.clear).toHaveBeenCalledOnce();
  });
});
