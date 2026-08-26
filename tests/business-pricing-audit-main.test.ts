import { describe, expect, it, vi } from "vitest";
import { BusinessPricingAudit } from
  "../src/main/amazon/business-pricing-audit";
import type { AuditSuiteContext } from
  "../src/main/amazon/audit-suite-context";
import type { AuditSuiteRunControl } from
  "../src/main/amazon/audit-suite-coordinator";
import type { AuditSuiteListingsResource } from
  "../src/main/amazon/audit-suite-resources";
import type { BusinessPricingAuditSnapshot } from
  "../src/main/amazon/catalog-report-reads";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
} from "../src/main/amazon/sp-execution-context";
import type { ApiRequest } from "../src/shared/contracts";
import { marketplaceByCode } from "../src/shared/marketplaces";

const US = marketplaceByCode("US").id;

function request(
  method: "GET" | "POST",
  query: Record<string, string> = {},
  body?: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path: method === "POST"
      ? "/api/sp-api/business-pricing-audit"
      : "/api/sp-api/business-pricing-audit",
    query,
    headers: body ? { "content-type": "application/json" } : {},
    ...(body ? { body: { kind: "json" as const, value: body } } : {}),
  };
}

function snapshot(): BusinessPricingAuditSnapshot {
  return {
    mode: "demo",
    marketplaceId: US,
    fetchedAt: "2026-08-26T00:00:00.000Z",
    rows: [{
      sellerSku: "FBA-B2B-01",
      asin: "B000000001",
      title: "FBA item",
      productType: "PET_FOOD",
      standardPrice: { amount: 20, currencyCode: "USD" },
      businessPrice: { amount: 19, currencyCode: "USD" },
      businessOfferPresence: "present",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
      recommendedPriceMismatch: false,
      recommendedQuantityDiscountMismatch: true,
      status: "configured",
      editable: false,
      reason: "B2B tier missing",
    }],
    summary: {
      totalFbaSkuCount: 1,
      configured: 1,
      aboveStandard: 0,
      missing: 0,
      unsupported: 0,
      incomplete: 0,
      recommendedPriceMismatch: 0,
      recommendedQuantityDiscountMismatch: 1,
    },
    notice: "FBA only",
  };
}

async function boundContext(
  context: ReturnType<typeof createScriptedSpExecutionContextAdapter>,
) {
  const captured = await context.capture(US);
  return {
    accountScope: String(captured.accountScope),
    generation: captured.generation,
    marketplaceId: captured.marketplaceId,
    mode: captured.mode,
  };
}

describe("BusinessPricingAudit main owner", () => {
  it("projects the legacy B2B suite section from shared Listings without polling or publishing another snapshot", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "b2b-suite-scope",
    }));
    const calls: string[] = [];
    const startReport = vi.fn(async () => {
      calls.push("start-active");
      return {
        mode: "demo" as const,
        ready: false,
        reportId: "private-active-listings-report",
        documentId: null,
        status: "IN_QUEUE" as const,
        notice: "Active Listings is being prepared.",
      };
    });
    const statusReport = vi.fn(async () => {
      throw new Error("Audit Suite must not poll a second report lifecycle.");
    });
    const readReport = vi.fn(async () => {
      calls.push("read-business-pricing");
      return snapshot();
    });
    const createId = vi.fn(() => "must-not-publish-an-export-id");
    const owner = new BusinessPricingAudit({
      context,
      startReport,
      statusReport,
      readReport,
      getStandaloneJob: vi.fn(),
      createId,
    });
    const exact = await context.capture(US);
    const suiteContext: AuditSuiteContext = {
      runId: "audit-suite-run-b2b",
      marketplaceId: US,
      accountScope: String(exact.accountScope),
      generation: exact.generation,
      mode: exact.mode,
    };
    const listings: AuditSuiteListingsResource = {
      reportId: "report-lease.shared-all-listings",
      documentId: "report-document.shared-all-listings",
      data: {
        fetchedAt: "2026-08-26T00:00:00.000Z",
        rows: [],
        errors: [],
      },
    };
    const loadListings = vi.fn(async () => {
      calls.push("load-shared-listings");
      return listings;
    });
    const heartbeat = vi.fn();
    const control: AuditSuiteRunControl = {
      signal: new AbortController().signal,
      heartbeat,
      resource: vi.fn(async (_key, load) => load()),
    };

    const result = await owner.runAuditSuite({
      context: suiteContext,
      control,
      loadListings,
    });

    expect(result).toEqual({
      ...suiteContext,
      status: "completed",
      fetchedAt: "2026-08-26T00:00:00.000Z",
      notice: "FBA only",
      payload: [{
        sellerSku: "FBA-B2B-01",
        title: "FBA item",
        asin: "B000000001",
        standardPrice: 20,
        businessPrice: 19,
        currencyCode: "USD",
        finding: "未正確設定階梯折扣",
        editable: false,
        notice: "B2B tier missing",
      }],
    });
    expect(calls).toEqual([
      "start-active",
      "load-shared-listings",
      "read-business-pricing",
    ]);
    expect(startReport).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      explicitRetry: false,
      expectedContext: exact,
      signal: expect.any(AbortSignal),
    }));
    expect(loadListings).toHaveBeenCalledTimes(1);
    expect(statusReport).not.toHaveBeenCalled();
    expect(readReport).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      reportId: listings.reportId,
      documentId: listings.documentId,
      expectedContext: exact,
      signal: expect.any(AbortSignal),
    }));
    expect(heartbeat).toHaveBeenCalled();
    expect(createId).not.toHaveBeenCalled();
    owner.clear();
  });

  it("preserves direct route responses while status and data never create a report", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "b2b-owner-scope",
    }));
    const startReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: false,
      reportId: "all-listings-1",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "Amazon 正在準備報表。",
    }));
    const statusReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: true,
      reportId: "all-listings-1",
      documentId: "all-listings-document-1",
      status: "DONE" as const,
      notice: "Amazon 報表已就緒。",
    }));
    const readReport = vi.fn(async () => snapshot());
    const owner = new BusinessPricingAudit({
      context,
      startReport,
      statusReport,
      readReport,
      getStandaloneJob: vi.fn(),
      createId: () => "00000000-0000-4000-8000-000000000001",
    });

    const rejected = await owner.start(request("POST", {}, {
      marketplaceId: US,
      host: "attacker.example",
    }));
    expect(rejected.status).toBe(400);
    expect(startReport).not.toHaveBeenCalled();

    const started = await owner.start(request("POST", {}, { marketplaceId: US }));
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({
      kind: "json",
      value: { reportId: "all-listings-1", message: "Amazon 正在準備報表。" },
    });
    expect(startReport).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      explicitRetry: true,
      expectedContext: expect.objectContaining({ marketplaceId: US }),
    }));
    startReport.mockClear();

    const status = await owner.statusOrData(request("GET", {
      marketplaceId: US,
      reportId: "all-listings-1",
    }));
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      kind: "json",
      value: { status: "DONE", message: "Amazon 報表已就緒。" },
    });

    const data = await owner.statusOrData(request("GET", {
      marketplaceId: US,
      reportId: "all-listings-1",
      documentId: "all-listings-document-1",
      data: "1",
    }));
    expect(data.status).toBe(200);
    expect(data.body).toEqual({ kind: "json", value: snapshot() });
    expect(startReport).not.toHaveBeenCalled();
    expect(readReport).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      reportId: "all-listings-1",
      documentId: "all-listings-document-1",
      expectedContext: expect.objectContaining({ marketplaceId: US }),
    }));
  });

  it("runs standalone without blind retry and downloads only its opaque stored snapshot", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "b2b-standalone-scope",
    }));
    const startReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: false,
      reportId: "private-report-id",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "pending",
    }));
    const statusReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: true,
      reportId: "private-report-id",
      documentId: "private-document-id",
      status: "DONE" as const,
      notice: "done",
    }));
    const readReport = vi.fn(async () => snapshot());
    let completedSnapshot: unknown;
    let now = 0;
    const owner = new BusinessPricingAudit({
      context,
      startReport,
      statusReport,
      readReport,
      getStandaloneJob: vi.fn(async () => ({
        ready: true,
        status: "completed" as const,
        snapshot: completedSnapshot,
      })),
      wait: async () => undefined,
      createId: () => "00000000-0000-4000-8000-000000000002",
      now: () => now,
    });
    const progress = vi.fn();
    completedSnapshot = snapshot();
    const legacyDownloaded = await owner.download(request("GET", {
      marketplaceId: US,
      mode: "demo",
      jobId: "legacy-standalone-job",
      contextId: "legacy-standalone-context",
    }));
    expect(legacyDownloaded.status).toBe(200);
    expect(startReport).not.toHaveBeenCalled();
    expect(statusReport).not.toHaveBeenCalled();
    expect(readReport).not.toHaveBeenCalled();

    completedSnapshot = await owner.runStandalone({
      context: await boundContext(context),
      signal: new AbortController().signal,
      heartbeat: vi.fn(),
      updateProgress: progress,
    });

    expect(startReport).toHaveBeenCalledWith(expect.objectContaining({
      explicitRetry: false,
      expectedContext: expect.objectContaining({ marketplaceId: US }),
    }));
    expect(JSON.stringify(completedSnapshot)).not.toMatch(/reportId|documentId/u);
    expect(completedSnapshot).toMatchObject({
      marketplaceId: US,
      exportId: "00000000-0000-4000-8000-000000000002",
    });
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: "complete",
      completedUnits: 1,
    }));

    startReport.mockClear();
    statusReport.mockClear();
    readReport.mockClear();
    now = 11 * 60 * 1_000;
    const downloaded = await owner.download(request("GET", {
      marketplaceId: US,
      mode: "demo",
      jobId: "standalone-job-1",
      contextId: "standalone-context-1",
    }));
    expect(downloaded.status).toBe(200);
    expect(downloaded.body.kind).toBe("bytes");
    if (downloaded.body.kind !== "bytes") throw new Error("Expected bytes");
    expect([...downloaded.body.value.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(downloaded.headers["content-disposition"]).toContain(
      "amazon-fba-business-pricing-audit-us-2026-08-26.xlsx",
    );
    expect(downloaded.headers["x-exported-fba-sku-count"]).toBe("1");
    expect(downloaded.headers["x-b2b-price-mismatch-count"]).toBe("0");
    expect(downloaded.headers["x-b2b-tier-mismatch-count"]).toBe("1");
    expect(startReport).not.toHaveBeenCalled();
    expect(statusReport).not.toHaveBeenCalled();
    expect(readReport).not.toHaveBeenCalled();

    owner.clear();
    const expired = await owner.download(request("GET", {
      marketplaceId: US,
      mode: "demo",
      jobId: "standalone-job-1",
      contextId: "standalone-context-1",
    }));
    expect(expired.status).toBe(410);
    expect(expired.body).toMatchObject({
      kind: "json",
      value: { code: "SNAPSHOT_EXPIRED" },
    });
  });

  it.each([
    ["ACCOUNT_SCOPE_CHANGED", "Amazon 帳號範圍已改變；本次操作已停止。"],
    ["REPORT_MODE_CHANGED", "App 展示／真實模式已改變；本次操作已停止。"],
  ] as const)(
    "preserves %s when the same transition clears the owner",
    async (code, message) => {
      const context = createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "demo",
        accountScope: "b2b-context-error-scope",
      }));
      let owner!: BusinessPricingAudit;
      const startReport = vi.fn(async () => {
        owner.clear();
        throw new SpExecutionContextError(code, message);
      });
      owner = new BusinessPricingAudit({
        context,
        startReport,
        statusReport: vi.fn(),
        readReport: vi.fn(),
        getStandaloneJob: vi.fn(),
      });

      const response = await owner.start(request("POST", {}, {
        marketplaceId: US,
      }));
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        kind: "json",
        value: { code, message },
      });
    },
  );
});
