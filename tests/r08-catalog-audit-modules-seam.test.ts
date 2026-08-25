import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

function get(path: string, query: Record<string, string> = {}): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path,
    query,
    headers: {},
  };
}

describe("R08 catalog audit module public seam", () => {
  it("delegates the direct subscription route and clears every extracted owner", async () => {
    const delegated: ApiResponse = {
      status: 207,
      headers: { "x-r08-owner": "subscription" },
      body: {
        kind: "json",
        value: { exportId: "subscription-owner-snapshot" },
      },
    };
    const subscriptionAudit = {
      read: vi.fn(async () => delegated),
      download: vi.fn(),
      runStandalone: vi.fn(),
      clear: vi.fn(),
    };
    const businessPricingAudit = {
      start: vi.fn(),
      statusOrData: vi.fn(),
      download: vi.fn(),
      capture: vi.fn(),
      runStandalone: vi.fn(),
      clear: vi.fn(),
    };
    const unboundVariationAudit = {
      start: vi.fn(),
      statusDataOrDownload: vi.fn(),
      runStandalone: vi.fn(),
      clear: vi.fn(),
    };
    const agedInventoryAudit = {
      start: vi.fn(),
      statusDataOrDownload: vi.fn(),
      capture: vi.fn(),
      runStandalone: vi.fn(),
      clear: vi.fn(),
    };
    const contentAudit = {
      captureFromListings: vi.fn(),
      captureStandaloneFromListings: vi.fn(),
      read: vi.fn(),
      download: vi.fn(),
      clear: vi.fn(),
    };
    const imageAudit = {
      captureFromListings: vi.fn(),
      captureStandaloneFromListings: vi.fn(),
      read: vi.fn(),
      download: vi.fn(),
      clear: vi.fn(),
    };
    const listingsExport = {
      start: vi.fn(),
      status: vi.fn(),
      capture: vi.fn(),
      data: vi.fn(),
      read: vi.fn(),
      download: vi.fn(),
      runStandalone: vi.fn(),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      businessPricingAudit,
      subscriptionAudit,
      unboundVariationAudit,
      agedInventoryAudit,
      contentAudit,
      imageAudit,
      listingsExport,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);
    const request = get("/api/sp-api/subscription-audit", {
      deliberatelyInvalidLegacyQuery: "1",
    });

    const response = await router.handle(request);
    router.dispose();

    expect(subscriptionAudit.read).toHaveBeenCalledOnce();
    expect(subscriptionAudit.read).toHaveBeenCalledWith(request);
    expect(response).toEqual(delegated);
    expect(businessPricingAudit.clear).toHaveBeenCalledOnce();
    expect(subscriptionAudit.clear).toHaveBeenCalledOnce();
    expect(unboundVariationAudit.clear).toHaveBeenCalledOnce();
    expect(agedInventoryAudit.clear).toHaveBeenCalledOnce();
    expect(contentAudit.clear).toHaveBeenCalledOnce();
    expect(imageAudit.clear).toHaveBeenCalledOnce();
    expect(listingsExport.clear).toHaveBeenCalledOnce();
  });
});
