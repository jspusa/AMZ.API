import { describe, expect, it, vi } from "vitest";
import { AgedInventoryAudit } from
  "../src/main/amazon/aged-inventory-audit";
import type { AgedInventorySnapshot } from
  "../src/main/amazon/aged-inventory-reads";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
} from "../src/main/amazon/sp-execution-context";
import type { ApiRequest } from "../src/shared/contracts";
import { marketplaceByCode } from "../src/shared/marketplaces";

const US = marketplaceByCode("US").id;
const EXPORT_ID = "00000000-0000-4000-8000-000000000010";

function request(
  method: "GET" | "POST",
  query: Record<string, string> = {},
  body?: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path: "/api/sp-api/aged-inventory",
    query,
    headers: body ? { "content-type": "application/json" } : {},
    ...(body ? { body: { kind: "json" as const, value: body } } : {}),
  };
}

function snapshot(): AgedInventorySnapshot {
  return {
    mode: "demo",
    marketplaceId: US,
    fetchedAt: "2026-08-26T01:02:03.000Z",
    rows: [{
      sellerSku: "AGED-FBA-01",
      fnSku: "X001AGED01",
      asin: "B0AGED0001",
      title: "Aged item",
      condition: "New",
      available: 0,
      totalAgedUnits: 3,
      agedOver180: 3,
      ageBuckets: [{ key: "181-plus", label: "181 天以上", units: 3, over180: true }],
      estimatedExcessQuantity: null,
      recommendedRemovalQuantity: 0,
      daysOfSupply: null,
      currencyCode: null,
      estimatedStorageCostNextMonth: null,
      estimatedAgedSurcharge: 0,
      agedSurchargeBuckets: [],
      alert: "",
      recommendedAction: "",
      snapshotDate: "2026-08-25",
    }],
    summary: {
      skuCount: 1,
      agedOver180SkuCount: 1,
      totalAgedUnits: 3,
      agedOver180: 3,
      excessAvailability: "partial",
      estimatedExcessQuantity: null,
      excessReportedSkuCount: 0,
      currencyCode: null,
      storageCostAvailability: "unavailable",
      estimatedStorageCostNextMonth: null,
      storageCostReportedSkuCount: 0,
      agedSurchargeAvailability: "complete",
      estimatedAgedSurcharge: 0,
      agedSurchargeReportedSkuCount: 1,
    },
    expiration: {
      currentFbaExpirationDatesAvailable: false,
      nearExpiryUnits: null,
      expiredUnits: null,
      inboundPlanExpirationDatesAvailable: true,
      notice: "No current FC expiration API.",
    },
    notice: "FBA only; partial stays partial.",
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

describe("AgedInventoryAudit main owner", () => {
  it("preserves partial/unavailable/zero and status/data/download never begin", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "aged-direct-scope",
    }));
    const beginReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: false,
      reportId: "aged-report-1",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "pending",
    }));
    const statusReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: true,
      reportId: "aged-report-1",
      documentId: "aged-document-1",
      status: "DONE" as const,
      notice: "done",
    }));
    const readReport = vi.fn(async () => snapshot());
    const ids = [
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
    ];
    const owner = new AgedInventoryAudit({
      context,
      beginReport,
      statusReport,
      readReport,
      createId: () => ids.shift()!,
    });

    const started = await owner.start(request("POST", {}, { marketplaceId: US }));
    expect(started.status).toBe(202);
    expect(beginReport).toHaveBeenCalledWith(expect.objectContaining({
      explicitRetry: true,
      freshCompleted: true,
      expectedContext: expect.objectContaining({ marketplaceId: US }),
    }));
    beginReport.mockClear();

    const status = await owner.statusDataOrDownload(request("GET", {
      marketplaceId: US,
      reportId: "aged-report-1",
    }));
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      kind: "json",
      value: { status: "DONE", message: "done" },
    });

    const data = await owner.statusDataOrDownload(request("GET", {
      marketplaceId: US,
      reportId: "aged-report-1",
      documentId: "aged-document-1",
      data: "1",
    }));
    expect(data.body).toEqual({ kind: "json", value: snapshot() });
    expect(data.body).toMatchObject({
      kind: "json",
      value: {
        rows: [{ available: 0, recommendedRemovalQuantity: 0 }],
        summary: {
          excessAvailability: "partial",
          storageCostAvailability: "unavailable",
          agedSurchargeAvailability: "complete",
          estimatedAgedSurcharge: 0,
        },
      },
    });

    const download = await owner.statusDataOrDownload(request("GET", {
      marketplaceId: US,
      reportId: "aged-report-1",
      documentId: "aged-document-1",
      download: "1",
    }));
    expect(download.status).toBe(200);
    expect(download.body.kind).toBe("bytes");
    if (download.body.kind !== "bytes") throw new Error("Expected bytes");
    expect([...download.body.value.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(download.headers["content-disposition"]).toContain(
      "amazon-fba-inventory-age-us-2026-08-26.xlsx",
    );
    expect(download.headers["content-disposition"]).toContain(
      "filename*=UTF-8''FBA-%E5%BA%AB%E9%BD%A1%E8%88%87%E9%A0%90%E4%BC%B0%E5%86%97%E9%A4%98%E5%81%A5%E6%AA%A2-US-2026-08-26.xlsx",
    );
    expect(download.headers["x-exported-fba-sku-count"]).toBe("1");
    expect(beginReport).not.toHaveBeenCalled();
  });

  it("publishes an opaque standalone export without report identifiers", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "aged-standalone-scope",
    }));
    const beginReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: false,
      reportId: "private-aged-report",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "pending",
    }));
    const statusReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: true,
      reportId: "private-aged-report",
      documentId: "private-aged-document",
      status: "DONE" as const,
      notice: "done",
    }));
    const readReport = vi.fn(async () => snapshot());
    let now = 0;
    const owner = new AgedInventoryAudit({
      context,
      beginReport,
      statusReport,
      readReport,
      wait: async () => undefined,
      createId: () => EXPORT_ID,
      now: () => now,
    });

    const completed = await owner.runStandalone({
      context: await boundContext(context),
      signal: new AbortController().signal,
      heartbeat: vi.fn(),
      updateProgress: vi.fn(),
    });
    expect(beginReport).toHaveBeenCalledWith(expect.objectContaining({
      explicitRetry: false,
      expectedContext: expect.objectContaining({ marketplaceId: US }),
    }));
    expect(completed).toMatchObject({ marketplaceId: US, exportId: EXPORT_ID });
    expect(JSON.stringify(completed)).not.toMatch(
      /reportId|documentId|signedUrl|amazonaws\.com|cloudfront\.net/u,
    );

    beginReport.mockClear();
    statusReport.mockClear();
    readReport.mockClear();
    now = 11 * 60 * 1_000;
    const downloaded = await owner.statusDataOrDownload(request("GET", {
      marketplaceId: US,
      exportId: EXPORT_ID,
      download: "1",
    }));
    expect(downloaded.status).toBe(200);
    expect(beginReport).not.toHaveBeenCalled();
    expect(statusReport).not.toHaveBeenCalled();
    expect(readReport).not.toHaveBeenCalled();

    owner.clear();
    const expired = await owner.statusDataOrDownload(request("GET", {
      marketplaceId: US,
      exportId: EXPORT_ID,
      download: "1",
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
        accountScope: "aged-context-error-scope",
      }));
      let owner!: AgedInventoryAudit;
      const beginReport = vi.fn(async () => {
        owner.clear();
        throw new SpExecutionContextError(code, message);
      });
      owner = new AgedInventoryAudit({
        context,
        beginReport,
        statusReport: vi.fn(),
        readReport: vi.fn(),
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
