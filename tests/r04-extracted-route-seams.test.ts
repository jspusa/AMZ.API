import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;

type RouteCase = Readonly<{
  operation:
    | "accountingCapabilities"
    | "accountingAccessPlan"
    | "reportLibrary"
    | "reportLibraryAccessPlan"
    | "getProductMaster"
    | "putProductMaster"
    | "skuCommand";
  owner: "planning" | "productMaster" | "skuCommand";
  request: ApiRequest;
}>;

const CASES: RouteCase[] = [
  {
    operation: "accountingCapabilities",
    owner: "planning",
    request: {
      requestId: "r04-accounting-capabilities-001",
      method: "GET",
      path: "/api/sp-api/accounting/capabilities",
      query: { marketplaceId: US },
      headers: {},
    },
  },
  {
    operation: "accountingAccessPlan",
    owner: "planning",
    request: {
      requestId: "r04-accounting-plan-001",
      method: "POST",
      path: "/api/sp-api/accounting/access-plan",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: { marketplaceId: US, capabilityId: "FBA_FEE_PREVIEW" },
      },
    },
  },
  {
    operation: "reportLibrary",
    owner: "planning",
    request: {
      requestId: "r04-report-library-001",
      method: "GET",
      path: "/api/sp-api/report-library",
      query: { marketplaceId: US },
      headers: {},
    },
  },
  {
    operation: "reportLibraryAccessPlan",
    owner: "planning",
    request: {
      requestId: "r04-report-plan-001",
      method: "POST",
      path: "/api/sp-api/report-library/access-plan",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          reportType: "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA",
        },
      },
    },
  },
  {
    operation: "getProductMaster",
    owner: "productMaster",
    request: {
      requestId: "r04-product-master-get-001",
      method: "GET",
      path: "/api/product-master",
      query: { marketplaceId: US, sku: "PRODUCT-MASTER-SKU" },
      headers: {},
    },
  },
  {
    operation: "putProductMaster",
    owner: "productMaster",
    request: {
      requestId: "r04-product-master-put-001",
      method: "PUT",
      path: "/api/product-master",
      query: {},
      headers: {},
      body: {
        kind: "json",
        value: {
          marketplaceId: US,
          sellerSku: "PRODUCT-MASTER-SKU",
          casePack: 12,
          cartonsPerPallet: 20,
          leadTimeDays: 30,
          safetyDays: 14,
          targetDays: 60,
          supplyRoute: "DIRECT_FBA",
          awdBufferDays: 0,
        },
      },
    },
  },
  {
    operation: "skuCommand",
    owner: "skuCommand",
    request: {
      requestId: "r04-sku-command-route-001",
      method: "GET",
      path: "/api/sp-api/sku-command",
      query: { marketplaceId: US, sku: "COMMAND-SKU" },
      headers: {},
    },
  },
];

describe("R04 extracted route seams", () => {
  it.each(CASES)("delegates $operation through its named owner", async ({
    operation,
    owner,
    request,
  }) => {
    const delegated: ApiResponse = {
      status: 200,
      headers: { "x-r04-owner": owner },
      body: { kind: "json", value: { operation } },
    };
    const planningCapabilities = {
      accountingCapabilities: vi.fn(async () => delegated),
      accountingAccessPlan: vi.fn(async () => delegated),
      reportLibrary: vi.fn(async () => delegated),
      reportLibraryAccessPlan: vi.fn(async () => delegated),
    };
    const productMasterRoutes = {
      getProductMaster: vi.fn(async () => delegated),
      putProductMaster: vi.fn(async () => delegated),
    };
    const skuCommandRoute = {
      skuCommand: vi.fn(async () => delegated),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      planningCapabilities,
      productMasterRoutes,
      skuCommandRoute,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);
    const operationSpy = owner === "planning"
      ? planningCapabilities[operation as keyof typeof planningCapabilities]
      : owner === "productMaster"
        ? productMasterRoutes[operation as keyof typeof productMasterRoutes]
        : skuCommandRoute.skuCommand;

    expect(operationSpy).toHaveBeenCalledOnce();
    expect(operationSpy).toHaveBeenCalledWith(request);
    expect(response).toEqual(delegated);
  });
});
