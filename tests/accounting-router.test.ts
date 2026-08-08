import { describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER";

function request(input: {
  method: ApiRequest["method"];
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: input.method,
    path: input.path,
    query: input.query ?? {},
    headers: {},
    ...(input.body
      ? { body: { kind: "json" as const, value: input.body } }
      : {}),
  };
}

function jsonValue(response: Awaited<ReturnType<ApiRouter["handle"]>>): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

describe("FBA accounting capability routes", () => {
  const router = new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite: async () => undefined,
  });

  it("returns a flat, renderer-safe catalog with honest FBA states", async () => {
    const response = await router.handle(request({
      method: "GET",
      path: "/api/sp-api/accounting/capabilities",
      query: { marketplaceId: US },
    }));
    expect(response.status).toBe(200);
    const value = jsonValue(response);
    expect(value).toMatchObject({
      marketplaceId: US,
      fetchedAt: expect.any(String),
      notice: expect.stringMatching(/尚未建立、輪詢或下載/u),
    });
    const capabilities = value.capabilities as Array<Record<string, unknown>>;
    expect(capabilities).toHaveLength(11);
    expect(capabilities.find(({ id }) => id === "FBA_STORAGE_FEES")).toMatchObject({
      artifact: "TAB_DELIMITED_REPORT",
      fbaSafety: "OFFICIAL_FBA_ONLY",
      state: "READY_CREATE_REPORT",
    });
    expect(capabilities.find(({ id }) => id === "FINANCES_TRANSACTIONS")).toMatchObject({
      artifact: "JSON",
      state: "MAIN_FBA_FILTER_REQUIRED",
    });
    expect(capabilities.find(({ id }) => id === "SETTLEMENT_V2")).toMatchObject({
      state: "FBA_FILTER_NOT_IMPLEMENTED",
    });
    expect(capabilities.find(({ id }) => id === "FINANCIAL_HOLDS")).toMatchObject({
      state: "MANUAL_PREREQUISITE",
    });
    expect(capabilities.find(({ id }) => id === "SELLER_ACCOUNT_BILLS")).toMatchObject({
      state: "UNAVAILABLE",
    });
  });

  it("returns only a safe plan summary and never exposes an upstream request", async () => {
    const response = await router.handle(request({
      method: "POST",
      path: "/api/sp-api/accounting/access-plan",
      body: {
        marketplaceId: US,
        capabilityId: "FBA_FEE_PREVIEW",
        dataStartTime: "2026-07-01T00:00:00.000Z",
      },
    }));
    expect(response.status).toBe(200);
    const value = jsonValue(response);
    expect(value).toEqual({
      capabilityId: "FBA_FEE_PREVIEW",
      marketplaceId: US,
      state: "READY_CREATE_REPORT",
      notice: expect.stringContaining("估算"),
      nextStep: expect.stringMatching(/尚未建立、輪詢或下載/u),
    });
    expect(Object.keys(value).sort()).toEqual([
      "capabilityId",
      "marketplaceId",
      "nextStep",
      "notice",
      "state",
    ]);
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("/finances/");
    expect(serialized).not.toMatch(/sellercentral\.amazon\./iu);
  });

  it("keeps unfiltered transaction totals blocked even after validating dates", async () => {
    const response = await router.handle(request({
      method: "POST",
      path: "/api/sp-api/accounting/access-plan",
      body: {
        marketplaceId: US,
        capabilityId: "FINANCES_TRANSACTIONS",
        dataStartTime: "2026-01-01T00:00:00.000Z",
        dataEndTime: "2026-06-29T00:00:00.000Z",
      },
    }));
    expect(response.status).toBe(200);
    expect(jsonValue(response)).toMatchObject({
      state: "MAIN_FBA_FILTER_REQUIRED",
      nextStep: expect.stringMatching(/不會把帳戶總額送到畫面/u),
    });
  });

  it("rejects invalid marketplaces, capability IDs, JSON and canonical dates with 400", async () => {
    const cases: ApiRequest[] = [
      request({
        method: "GET",
        path: "/api/sp-api/accounting/capabilities",
        query: { marketplaceId: "UNKNOWN" },
      }),
      request({
        method: "POST",
        path: "/api/sp-api/accounting/access-plan",
        body: { marketplaceId: US, capabilityId: "PRIVATE_SELLER_CENTRAL_BILL" },
      }),
      request({
        method: "POST",
        path: "/api/sp-api/accounting/access-plan",
      }),
      request({
        method: "POST",
        path: "/api/sp-api/accounting/access-plan",
        body: {
          marketplaceId: US,
          capabilityId: "FBA_FEE_PREVIEW",
          dataStartTime: "2099-07-01T00:00:00.000Z",
        },
      }),
      request({
        method: "POST",
        path: "/api/sp-api/accounting/access-plan",
        body: {
          marketplaceId: US,
          capabilityId: "FBA_FEE_PREVIEW",
          dataStartTime: "2026-07-01T00:00:00.000Z",
          dataEndTime: "2026-07-04T00:00:00.000Z",
        },
      }),
      request({
        method: "POST",
        path: "/api/sp-api/accounting/access-plan",
        body: {
          marketplaceId: US,
          capabilityId: "FBA_LONG_TERM_STORAGE_FEES",
          dataStartTime: "2026-06-01T00:00:00.000Z",
          dataEndTime: "2026-06-30T00:00:00.000Z",
        },
      }),
    ];
    for (const item of cases) {
      const response = await router.handle(item);
      expect(response.status).toBe(400);
      expect(jsonValue(response)).toMatchObject({ code: expect.any(String) });
    }
  });
});
