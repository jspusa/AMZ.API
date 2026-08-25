import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type {
  OpaqueAccountScope,
  SpExecutionContext,
} from "../src/main/amazon/sp-execution-context";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const CASES: ReadonlyArray<{
  operation: "salesTrend" | "replenishment";
  request: ApiRequest;
}> = [
  {
    operation: "salesTrend",
    request: {
      requestId: "r05-sales-trend-route-001",
      method: "GET",
      path: "/api/sp-api/sales-trend",
      query: { marketplaceId: "invalid" },
      headers: {},
    },
  },
  {
    operation: "replenishment",
    request: {
      requestId: "r05-replenishment-route-001",
      method: "GET",
      path: "/api/sp-api/replenishment-plan",
      query: {},
      headers: {},
    },
  },
];

describe("R05 FBA Sales Metrics public route seam", () => {
  it.each(CASES)(
    "delegates $operation from the exact central switch",
    async ({ operation, request }) => {
      const delegated: ApiResponse = {
        status: 207,
        headers: { "x-r05-owner": operation },
        body: { kind: "json", value: { operation } },
      };
      const routes = {
        salesTrend: vi.fn(async () => delegated),
        replenishment: vi.fn(async () => delegated),
      };
      const router = new ApiRouter({
        store: {} as LocalStore,
        vault: {} as CredentialVault,
        approveWrite: async () => undefined,
        fbaSalesMetricsRoutes: routes,
      });

      const response = await router.handle(request);

      expect(routes[operation]).toHaveBeenCalledOnce();
      expect(routes[operation]).toHaveBeenCalledWith(request);
      const other = operation === "salesTrend"
        ? "replenishment"
        : "salesTrend";
      expect(routes[other]).not.toHaveBeenCalled();
      expect(response).toEqual(delegated);
    },
  );

  it("reuses one frozen request context for the owner and terminal fences", async () => {
    const savedMode = process.env.SP_API_MODE;
    process.env.SP_API_MODE = "demo";
    const context = Object.freeze({
      marketplaceId: "ATVPDKIKX0DER",
      region: "na",
      mode: "demo",
      accountScope: "opaque-r05-public" as OpaqueAccountScope,
      generation: 9,
    }) satisfies SpExecutionContext;
    const capture = vi.fn(async () => context);
    const assertCurrent = vi.fn(
      async (_current: SpExecutionContext) => undefined,
    );
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: {
        capture,
        assertCurrent,
        invalidate: vi.fn(),
      },
    });

    try {
      const response = await router.handle({
        requestId: "r05-public-context-001",
        method: "GET",
        path: "/api/sp-api/sales-trend",
        query: { marketplaceId: "ATVPDKIKX0DER", days: "7" },
        headers: {},
      });

      expect(response.status).toBe(200);
      expect(capture).toHaveBeenCalledOnce();
      expect(Object.isFrozen(context)).toBe(true);
      expect(assertCurrent).toHaveBeenCalledTimes(2);
      expect(assertCurrent.mock.calls[0]?.[0]).toBe(context);
      expect(assertCurrent.mock.calls[1]?.[0]).toBe(context);
    } finally {
      if (savedMode === undefined) delete process.env.SP_API_MODE;
      else process.env.SP_API_MODE = savedMode;
    }
  });

  it("keeps both exact switch cases and removes the superseded root handlers", () => {
    const routerSource = readFileSync(
      new URL("../src/main/api-router.ts", import.meta.url),
      "utf8",
    );
    const ownerSource = readFileSync(
      new URL("../src/main/fba-sales-metrics-routes.ts", import.meta.url),
      "utf8",
    );

    expect(routerSource).toContain(
      "return this.fbaSalesMetricsRoutes.salesTrend(request);",
    );
    expect(routerSource).toContain(
      "return this.fbaSalesMetricsRoutes.replenishment(request);",
    );
    expect(routerSource).not.toMatch(/private async salesTrend\(/u);
    expect(routerSource).not.toMatch(/private async replenishment\(/u);
    expect(ownerSource).not.toMatch(/from ["']\.\/amazon\/sp-api["']/u);
    expect(ownerSource).not.toContain("fetch(");
  });
});
