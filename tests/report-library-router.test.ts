import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
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
    ...(input.body ? { body: { kind: "json" as const, value: input.body } } : {}),
  };
}

function jsonValue(response: Awaited<ReturnType<ApiRouter["handle"]>>): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

describe("public report document library routes", () => {
  const router = new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite: async () => undefined,
  });

  it("returns 109 current official types and a separate existing-export section", async () => {
    const response = await router.handle(request({
      method: "GET",
      path: "/api/sp-api/report-library",
      query: { marketplaceId: US },
    }));
    expect(response.status).toBe(200);
    const value = jsonValue(response);
    expect(value).toMatchObject({
      schemaVersion: 1,
      marketplaceId: US,
      officialCatalog: {
        uniqueReportTypeCount: 109,
        verifiedAt: "2026-08-09",
        source: "https://developer-docs.amazon.com/sp-api/docs/report-type-values",
        changeNotice: expect.stringMatching(/可能隨時更新/u),
      },
      notice: expect.stringMatching(/FBA-only/u),
    });
    expect(value.currentAppExports).toHaveLength(6);
    const reports = value.reports as Array<Record<string, unknown>>;
    expect(reports).toHaveLength(109);
    expect(reports.every(({ appDownloadImplemented }) => appDownloadImplemented === false)).toBe(true);
    expect(reports.find(({ reportType }) => reportType === "GET_AFN_INVENTORY_DATA"))
      .toMatchObject({
        state: "READY_TO_PLAN",
        amazonPublicArtifactAvailable: true,
        appDownloadImplemented: false,
        stateNotice: expect.stringMatching(/尚未接線/u),
      });
    expect(value.reviewAuditCapability).toMatchObject({
      supportedForMarketplace: true,
      nonParentFbaAsinsOnly: true,
      relationshipsEvidenceRequired: true,
      parentContainersExcluded: true,
      fullReviewTextAvailable: false,
      topicLanguage: "ENGLISH_ONLY",
    });
  });

  it("returns a safe plan without an upstream path or request body", async () => {
    const response = await router.handle(request({
      method: "POST",
      path: "/api/sp-api/report-library/access-plan",
      body: { marketplaceId: US, reportType: "GET_AFN_INVENTORY_DATA" },
    }));
    expect(response.status).toBe(200);
    const value = jsonValue(response);
    expect(value).toEqual({
      reportType: "GET_AFN_INVENTORY_DATA",
      marketplaceId: US,
      state: "READY_TO_PLAN",
      amazonPublicArtifactAvailable: true,
      appDownloadImplemented: false,
      notice: expect.stringMatching(/尚未接線/u),
      nextStep: expect.stringMatching(/parser/u),
    });
    expect(JSON.stringify(value)).not.toMatch(/\/reports\/|sellercentral\.amazon|marketplaceIds|reportOptions/iu);
  });

  it("rejects unknown report types and marketplaces", async () => {
    for (const item of [
      request({
        method: "POST",
        path: "/api/sp-api/report-library/access-plan",
        body: { marketplaceId: US, reportType: "PRIVATE_SELLER_CENTRAL_REPORT" },
      }),
      request({
        method: "GET",
        path: "/api/sp-api/report-library",
        query: { marketplaceId: "UNKNOWN" },
      }),
    ]) {
      const response = await router.handle(item);
      expect(response.status).toBe(400);
      expect(jsonValue(response)).toMatchObject({ code: expect.any(String) });
    }
  });
});

describe("review topic audit routes", () => {
  const previousMode = process.env.SP_API_MODE;
  let store: LocalStore;
  const fetchSpy = vi.fn(async () => {
    throw new Error("A demo review audit must not call the network.");
  });

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    const directory = await mkdtemp(join(tmpdir(), "report-library-router-"));
    store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockClear();
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
    vi.unstubAllGlobals();
  });

  function router(scope = "account-scope") {
    return new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => scope),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
  }

  it("builds a cached non-parent-ASIN snapshot and exports all topic evidence", async () => {
    const api = router();
    const started = await api.handle(request({
      method: "POST",
      path: "/api/sp-api/review-audit",
      body: { marketplaceId: US },
    }));
    expect(started.status).toBe(202);
    const jobId = jsonValue(started).jobId as string;
    expect(jobId).toMatch(/^[a-f0-9-]{36}$/u);

    const completed = await api.handle(request({
      method: "GET",
      path: "/api/sp-api/review-audit",
      query: { marketplaceId: US, jobId },
    }));
    expect(completed.status).toBe(200);
    const snapshot = jsonValue(completed);
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      mode: "demo",
      marketplaceId: US,
      exportId: jobId,
      summary: {
        uniqueFbaNonParentAsins: 6,
        verifiedChildListings: 3,
        verifiedStandaloneListings: 3,
        excludedParentContainers: 0,
        relationshipIncomplete: 0,
        completed: 5,
        noTopics: 1,
        totalIncomplete: 0,
      },
      availability: {
        nonParentFbaAsinsOnly: true,
        relationshipsEvidenceRequired: true,
        parentContainersExcluded: true,
        fullReviewTextAvailable: false,
        averageProductRatingAvailable: false,
        totalReviewCountAvailable: false,
      },
      notice: expect.stringMatching(/主題影響值.*星等下降方向的影響值.*不是商品負星等/u),
    });
    expect(snapshot.topFivePositive).toHaveLength(5);
    expect(snapshot.bottomFiveNegative).toHaveLength(5);
    expect((snapshot.rows as unknown[])).toHaveLength(6);

    const exported = await api.handle(request({
      method: "GET",
      path: "/api/sp-api/review-audit/export",
      query: { marketplaceId: US, exportId: jobId },
    }));
    expect(exported.status).toBe(200);
    expect(exported.body.kind).toBe("bytes");
    if (exported.body.kind === "bytes") {
      expect(Array.from(exported.body.value.slice(0, 2))).toEqual([0x50, 0x4b]);
    }
    expect(exported.headers["content-disposition"]).toMatch(/amazon-fba-review-topic-audit-us/u);
    expect(exported.headers["x-exported-fba-non-parent-asin-count"]).toBe("6");
    expect(exported.headers["x-exported-fba-child-asin-count"]).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects configured stores outside the official Customer Feedback list", async () => {
    const response = await router().handle(request({
      method: "POST",
      path: "/api/sp-api/review-audit",
      body: { marketplaceId: "A2EUQ1WTGCTBG2" },
    }));
    expect(response.status).toBe(422);
    expect(jsonValue(response)).toMatchObject({
      code: "MARKETPLACE_UNSUPPORTED",
      message: expect.stringMatching(/US.*JP.*UK.*DE/u),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
