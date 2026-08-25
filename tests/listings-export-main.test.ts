import { describe, expect, it, vi } from "vitest";
import { ListingsExport } from "../src/main/amazon/listings-export";
import type { FbaCatalogExport } from
  "../src/main/amazon/catalog-report-reads";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContextErrorCode,
} from "../src/main/amazon/sp-execution-context";
import { marketplaceByCode } from "../src/shared/marketplaces";

const US = marketplaceByCode("US").id;
const DIRECT_ID = "00000000-0000-4000-8000-000000000020";
const DOWNLOAD_ID = "00000000-0000-4000-8000-000000000021";
const STANDALONE_ID = "00000000-0000-4000-8000-000000000022";

function snapshot(): FbaCatalogExport {
  return {
    fetchedAt: "2026-08-26T02:03:04.000Z",
    rows: [{
      marketplace: "US",
      sellerSku: "FBA-LISTING-01",
      asin: "B000000001",
      productType: "PET_FOOD",
      title: "FBA listing",
      itemHighlight: "Highlight",
      bulletPoints: ["One", "Two", "Three", "Four", "Five"],
      productDescription: "Description",
      ingredients: "Turkey",
      imageUrls: ["https://images.example.test/one.jpg"],
      status: "BUYABLE",
      updatedAt: "2026-08-25T00:00:00.000Z",
      readStatus: "incomplete",
      readErrors: [{
        code: "LISTING_CONTENT_NOT_RETURNED",
        message: "Ingredients were unavailable.",
      }],
    }],
    errors: [{
      sellerSku: "FBA-LISTING-01",
      kind: "LISTING_CONTENT_NOT_RETURNED",
      message: "Ingredients were unavailable.",
    }],
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

describe("ListingsExport main owner", () => {
  it("owns direct report semantics and exact workbook headers without implicit start", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "listings-direct-scope",
    }));
    const startReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: false,
      reportId: "listings-report-1",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "pending",
    }));
    const statusReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: true,
      reportId: "listings-report-1",
      documentId: "listings-document-1",
      status: "DONE" as const,
      notice: "done",
    }));
    const readReport = vi.fn(async () => snapshot());
    const ids = [DIRECT_ID, DOWNLOAD_ID];
    const owner = new ListingsExport({
      context,
      startReport,
      statusReport,
      readReport,
      createId: () => ids.shift()!,
    });

    await expect(owner.start({ marketplaceId: US })).resolves.toMatchObject({
      ready: false,
      reportId: "listings-report-1",
    });
    expect(startReport).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      explicitRetry: true,
      expectedContext: expect.objectContaining({ marketplaceId: US }),
    }));
    startReport.mockClear();

    await expect(owner.status({
      marketplaceId: US,
      reportId: "listings-report-1",
    })).resolves.toMatchObject({ ready: true, status: "DONE" });
    await expect(owner.data({
      marketplaceId: US,
      reportId: "listings-report-1",
      documentId: "listings-document-1",
    })).resolves.toEqual(snapshot());
    const downloaded = await owner.download({
      marketplaceId: US,
      reportId: "listings-report-1",
      documentId: "listings-document-1",
    });

    expect(downloaded.status).toBe(200);
    expect(downloaded.body.kind).toBe("bytes");
    if (downloaded.body.kind !== "bytes") throw new Error("Expected bytes");
    expect([...downloaded.body.value.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(downloaded.headers["content-disposition"]).toContain(
      "amazon-listing-content-us-2026-08-26.xlsx",
    );
    expect(downloaded.headers["x-exported-listing-count"]).toBe("1");
    expect(downloaded.headers["x-export-warning-count"]).toBe("1");
    expect(startReport).not.toHaveBeenCalled();
  });

  it("runs one context-bound standalone source with 30-minute retention and no identifiers", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "listings-standalone-scope",
    }));
    const startReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: false,
      reportId: "private-listings-report",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "pending",
    }));
    const statusReport = vi.fn(async () => ({
      mode: "demo" as const,
      ready: true,
      reportId: "private-listings-report",
      documentId: "private-listings-document",
      status: "DONE" as const,
      notice: "done",
    }));
    const readReport = vi.fn(async () => snapshot());
    let now = 0;
    const owner = new ListingsExport({
      context,
      startReport,
      statusReport,
      readReport,
      wait: async () => undefined,
      now: () => now,
      createId: () => STANDALONE_ID,
    });

    const captured = await owner.runStandalone({
      context: await boundContext(context),
      signal: new AbortController().signal,
      heartbeat: vi.fn(),
      updateProgress: vi.fn(),
    });
    expect(startReport).toHaveBeenCalledWith(expect.objectContaining({
      explicitRetry: false,
    }));
    expect(captured).toMatchObject({
      exportId: STANDALONE_ID,
      snapshot: { fetchedAt: "2026-08-26T02:03:04.000Z" },
      context: { marketplaceId: US, mode: "demo" },
    });
    expect(JSON.stringify({
      exportId: captured.exportId,
      snapshot: captured.snapshot,
    })).not.toMatch(/reportId|documentId/u);

    startReport.mockClear();
    statusReport.mockClear();
    readReport.mockClear();
    now = 11 * 60 * 1_000;
    const downloaded = await owner.download({
      marketplaceId: US,
      exportId: STANDALONE_ID,
    });
    expect(downloaded.status).toBe(200);
    expect(startReport).not.toHaveBeenCalled();
    expect(statusReport).not.toHaveBeenCalled();
    expect(readReport).not.toHaveBeenCalled();
  });

  it("rejects a late read after clear even when its adapter ignores abort", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "listings-clear-scope",
    }));
    let resolveRead!: (value: FbaCatalogExport) => void;
    const readReport = vi.fn(() => new Promise<FbaCatalogExport>((resolve) => {
      resolveRead = resolve;
    }));
    const owner = new ListingsExport({
      context,
      startReport: vi.fn(),
      statusReport: vi.fn(),
      readReport,
      createId: () => DIRECT_ID,
    });
    const flight = owner.capture({
      marketplaceId: US,
      reportId: "late-report",
      documentId: "late-document",
    });
    await vi.waitFor(() => expect(readReport).toHaveBeenCalledOnce());
    owner.clear();
    resolveRead(snapshot());

    await expect(flight).rejects.toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
      status: 409,
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
        accountScope: "listings-context-error-scope",
      }));
      let owner!: ListingsExport;
      const startReport = vi.fn(async () => {
        owner.clear();
        throw new SpExecutionContextError(
          code as SpExecutionContextErrorCode,
          message,
        );
      });
      owner = new ListingsExport({
        context,
        startReport,
        statusReport: vi.fn(),
        readReport: vi.fn(),
      });

      await expect(owner.start({ marketplaceId: US })).rejects.toMatchObject({
        code,
        message,
        status: 409,
      });
    },
  );
});
