import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { createScriptedSpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;

describe("R04 stateless capability route seam", () => {
  it("keeps the exact public switch while delegating batch Listings semantics", async () => {
    const delegated: ApiResponse = {
      status: 207,
      headers: { "x-r04-route": "batch-listings" },
      body: { kind: "json", value: { delegated: true } },
    };
    const batchListings = vi.fn(async () => delegated);
    const statelessCapabilities = {
      orders: vi.fn(),
      batchListings,
      subscribeSave: vi.fn(),
      variationFamily: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(
        (marketplaceId) => ({
          marketplaceId,
          mode: "demo",
          accountScope: "opaque-r04-account",
        }),
      ),
      statelessCapabilities,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);
    const request: ApiRequest = {
      requestId: "r04-batch-route-001",
      method: "POST",
      path: "/api/sp-api/listings/batch",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          skus: [" FIRST-SKU ", "SECOND-SKU", "FIRST-SKU"],
        },
      },
    };

    const response = await router.handle(request as unknown as ApiRequest);

    expect(batchListings).toHaveBeenCalledOnce();
    expect(batchListings).toHaveBeenCalledWith(request);
    expect(response).toEqual(delegated);
  });

  it.each([
    {
      name: "Orders",
      operation: "orders" as const,
      request: {
        requestId: "r04-orders-route-001",
        method: "GET",
        path: "/api/sp-api/orders",
        query: { marketplaceId: US, days: "30" },
        headers: {},
      } satisfies ApiRequest,
    },
    {
      name: "single subscription read",
      operation: "subscribeSave" as const,
      request: {
        requestId: "r04-subscribe-route-001",
        method: "GET",
        path: "/api/sp-api/subscribe-save",
        query: { marketplaceId: US, sku: "SUBSCRIBE-SKU" },
        headers: {},
      } satisfies ApiRequest,
    },
    {
      name: "variation-family read",
      operation: "variationFamily" as const,
      request: {
        requestId: "r04-variation-route-001",
        method: "GET",
        path: "/api/sp-api/variation-family",
        query: { marketplaceId: US, asin: "B012345678" },
        headers: {},
      } satisfies ApiRequest,
    },
  ])("delegates $name through its explicit named operation", async ({
    operation,
    request,
  }) => {
    const delegated: ApiResponse = {
      status: 200,
      headers: { "x-r04-route": operation },
      body: { kind: "json", value: { operation } },
    };
    const statelessCapabilities = {
      orders: vi.fn(async () => delegated),
      batchListings: vi.fn(),
      subscribeSave: vi.fn(async () => delegated),
      variationFamily: vi.fn(async () => delegated),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(
        (marketplaceId) => ({
          marketplaceId,
          mode: "demo",
          accountScope: "opaque-r04-account",
        }),
      ),
      statelessCapabilities,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request as unknown as ApiRequest);

    expect(statelessCapabilities[operation]).toHaveBeenCalledOnce();
    expect(statelessCapabilities[operation]).toHaveBeenCalledWith(
      request as unknown as ApiRequest,
    );
    expect(response).toEqual(delegated);
  });
});
