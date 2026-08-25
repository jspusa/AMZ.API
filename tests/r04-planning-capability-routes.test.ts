import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanningCapabilityRoutes } from
  "../src/main/planning-capability-routes";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

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

function jsonValue(response: ApiResponse): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

describe("R04 planning capability route owner", () => {
  const routes = new PlanningCapabilityRoutes();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("projects the accounting catalog without owning broker behavior", () => {
    const response = routes.accountingCapabilities(request({
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
    expect(capabilities.find(({ id }) => id === "FINANCES_TRANSACTIONS"))
      .toMatchObject({ state: "MAIN_FBA_FILTER_REQUIRED" });
    expect(capabilities.find(({ id }) => id === "FBA_STORAGE_FEES"))
      .toMatchObject({ state: "READY_CREATE_REPORT" });
    expect(capabilities.find(({ id }) => id === "SETTLEMENT_V2"))
      .toMatchObject({ state: "FBA_FILTER_NOT_IMPLEMENTED" });
  });

  it("returns only the renderer-safe accounting plan projection", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = routes.accountingAccessPlan(request({
      method: "POST",
      path: "/api/sp-api/accounting/access-plan",
      body: {
        marketplaceId: US,
        capabilityId: "FBA_STORAGE_FEES",
      },
    }));

    expect(response.status).toBe(200);
    const value = jsonValue(response);
    expect(value).toEqual({
      capabilityId: "FBA_STORAGE_FEES",
      marketplaceId: US,
      state: "READY_CREATE_REPORT",
      notice: expect.any(String),
      nextStep: expect.stringMatching(/尚未建立、輪詢或下載/u),
    });
    expect(Object.keys(value).sort()).toEqual([
      "capabilityId",
      "marketplaceId",
      "nextStep",
      "notice",
      "state",
    ]);
    expect(JSON.stringify(value)).not.toMatch(
      /\/reports\/|\/finances\/|sellercentral\.amazon\./iu,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("projects the report catalog with every download remaining disabled", () => {
    const response = routes.reportLibrary(request({
      method: "GET",
      path: "/api/sp-api/report-library",
      query: { marketplaceId: US },
    }));

    expect(response.status).toBe(200);
    const value = jsonValue(response);
    expect(value).toMatchObject({
      schemaVersion: 1,
      marketplaceId: US,
      officialCatalog: { uniqueReportTypeCount: 109 },
      notice: expect.stringMatching(/FBA-only/u),
    });
    const reports = value.reports as Array<Record<string, unknown>>;
    expect(reports).toHaveLength(109);
    expect(reports.every(
      ({ appDownloadImplemented }) => appDownloadImplemented === false,
    )).toBe(true);
    expect(reports.find(({ reportType }) => reportType === "GET_AFN_INVENTORY_DATA"))
      .toMatchObject({
        state: "READY_TO_PLAN",
        amazonPublicArtifactAvailable: true,
        appDownloadImplemented: false,
        stateNotice: expect.stringMatching(/尚未接線/u),
      });
  });

  it("returns a plan only and rejects non-allowlisted report requests", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = routes.reportLibraryAccessPlan(request({
      method: "POST",
      path: "/api/sp-api/report-library/access-plan",
      body: {
        marketplaceId: US,
        reportType: "GET_AFN_INVENTORY_DATA",
      },
    }));
    expect(response.status).toBe(200);
    expect(jsonValue(response)).toEqual({
      reportType: "GET_AFN_INVENTORY_DATA",
      marketplaceId: US,
      state: "READY_TO_PLAN",
      amazonPublicArtifactAvailable: true,
      appDownloadImplemented: false,
      notice: expect.stringMatching(/尚未接線/u),
      nextStep: expect.stringMatching(/parser/u),
    });
    expect(JSON.stringify(jsonValue(response))).not.toMatch(
      /\/reports\/|sellercentral\.amazon|marketplaceIds|reportOptions/iu,
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    const invalid = routes.reportLibraryAccessPlan(request({
      method: "POST",
      path: "/api/sp-api/report-library/access-plan",
      body: {
        marketplaceId: US,
        reportType: "PRIVATE_SELLER_CENTRAL_REPORT",
      },
    }));
    expect(invalid.status).toBe(400);
    expect(jsonValue(invalid)).toMatchObject({ code: "INVALID_REPORT_PLAN" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
