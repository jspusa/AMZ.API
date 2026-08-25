import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const CASES: ReadonlyArray<{
  operation: "start" | "observe";
  request: ApiRequest;
}> = [
  {
    operation: "start",
    request: {
      requestId: "r06-brand-start-route-001",
      method: "POST",
      path: "/api/sp-api/brand-sales",
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
    operation: "observe",
    request: {
      requestId: "r06-brand-observe-route-001",
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: {},
      headers: {},
    },
  },
];

describe("R06 Brand Sales coordinator public route seam", () => {
  it.each(CASES)(
    "delegates $operation from the exact central switch",
    async ({ operation, request }) => {
      const delegated: ApiResponse = {
        status: 207,
        headers: { "x-r06-owner": operation },
        body: { kind: "json", value: { operation } },
      };
      const coordinator = {
        start: vi.fn(async () => delegated),
        observe: vi.fn(async () => delegated),
        clear: vi.fn(),
      };
      const router = new ApiRouter({
        store: {} as LocalStore,
        vault: {} as CredentialVault,
        approveWrite: async () => undefined,
        brandSalesCoordinator: coordinator,
      } as ConstructorParameters<typeof ApiRouter>[0] & {
        brandSalesCoordinator: typeof coordinator;
      });

      const response = await router.handle(request);

      expect(coordinator[operation]).toHaveBeenCalledOnce();
      expect(coordinator[operation]).toHaveBeenCalledWith(request);
      const other = operation === "start" ? "observe" : "start";
      expect(coordinator[other]).not.toHaveBeenCalled();
      expect(response).toEqual(delegated);
    },
  );

  it("uses one coordinator instance for start, observe, and lifecycle clear", async () => {
    const responses = {
      start: {
        status: 201,
        headers: { "x-r06-owner": "start" },
        body: { kind: "json", value: { operation: "start" } },
      },
      observe: {
        status: 208,
        headers: { "x-r06-owner": "observe" },
        body: { kind: "json", value: { operation: "observe" } },
      },
    } satisfies Record<"start" | "observe", ApiResponse>;
    const coordinator = {
      start: vi.fn(async () => responses.start),
      observe: vi.fn(async () => responses.observe),
      clear: vi.fn(),
    };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      brandSalesCoordinator: coordinator,
    });

    const started = await router.handle(CASES[0].request);
    const observed = await router.handle(CASES[1].request);
    router.dispose();

    expect(coordinator.start).toHaveBeenCalledWith(CASES[0].request);
    expect(coordinator.observe).toHaveBeenCalledWith(CASES[1].request);
    expect(started).toEqual(responses.start);
    expect(observed).toEqual(responses.observe);
    expect(coordinator.clear).toHaveBeenCalledOnce();
  });

  it("keeps the exact switch while removing the superseded root state owner", () => {
    const routerSource = readFileSync(
      new URL("../src/main/api-router.ts", import.meta.url),
      "utf8",
    );
    const coordinatorSource = readFileSync(
      new URL("../src/main/brand-sales-coordinator.ts", import.meta.url),
      "utf8",
    );

    expect(routerSource).toContain(
      "return this.brandSalesCoordinator.start(request);",
    );
    expect(routerSource).toContain(
      "return this.brandSalesCoordinator.observe(request);",
    );
    expect(routerSource).toContain("this.brandSalesCoordinator.clear();");
    expect(routerSource).not.toMatch(/private async startBrandSales\(/u);
    expect(routerSource).not.toMatch(/private async brandSalesStatusOrData\(/u);
    expect(routerSource).not.toContain("new FbaRevenueReports({");
    expect(coordinatorSource).toContain(
      "new BrandSalesCoordinator(new FbaRevenueReports(input))",
    );
    expect(coordinatorSource).not.toContain("fetch(");
    expect(coordinatorSource).not.toMatch(/renderer/u);
  });
});
