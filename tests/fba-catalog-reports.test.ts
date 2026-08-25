import { describe, expect, it, vi } from "vitest";
import { FbaCatalogReports } from "../src/main/amazon/fba-catalog-reports";
import { createScriptedListingsReadAdapter } from "../src/main/amazon/listings-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { ReportsRuntime } from "../src/main/amazon/reports-runtime";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const US = "ATVPDKIKX0DER" as const;

describe("FBA catalog Reports coordinator", () => {
  it("never downgrades an Active Listings cancellation after All Listings succeeds", async () => {
    const cancelled = new Error("cancelled");
    cancelled.name = "AbortError";
    const coordinator = new FbaCatalogReports({
      reports: {
        start: vi.fn(async (plan: { intent: string }) => {
          if (plan.intent === "active-business-listings") throw cancelled;
          return {
            mode: "live" as const,
            ready: true,
            reportId: "report-lease.all",
            documentId: "report-document.all",
            status: "DONE" as const,
            notice: "done",
          };
        }),
        read: vi.fn(),
        status: vi.fn(),
        readDocument: vi.fn(),
      } as unknown as Pick<
        ReportsRuntime,
        "start" | "read" | "status" | "readDocument"
      >,
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      })),
      listings: createScriptedListingsReadAdapter([]),
      demo: {
        export: vi.fn(),
        identity: vi.fn(),
        seeds: vi.fn(),
        businessPricingAudit: vi.fn(),
      },
    });

    await expect(coordinator.begin({
      purpose: "business-pricing-audit",
      marketplaceId: US,
      explicitRetry: false,
    })).rejects.toBe(cancelled);
  });

  it("prioritizes an Active identity fence over an ordinary All Listings failure", async () => {
    const allFailure = new Error("All Listings unavailable");
    const fence = new SpApiError("account changed", {
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    });
    const coordinator = new FbaCatalogReports({
      reports: {
        start: vi.fn(async (plan: { intent: string }) => {
          if (plan.intent === "active-business-listings") throw fence;
          throw allFailure;
        }),
        read: vi.fn(),
        status: vi.fn(),
        readDocument: vi.fn(),
      } as unknown as Pick<
        ReportsRuntime,
        "start" | "read" | "status" | "readDocument"
      >,
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      })),
      listings: createScriptedListingsReadAdapter([]),
      demo: {
        export: vi.fn(),
        identity: vi.fn(),
        seeds: vi.fn(),
        businessPricingAudit: vi.fn(),
      },
    });

    await expect(coordinator.begin({
      purpose: "business-pricing-audit",
      marketplaceId: US,
      explicitRetry: false,
    })).rejects.toBe(fence);
  });

  it("begins fixed All and Active reports only from an explicit B2B begin", async () => {
    const allReceipt = {
      mode: "live" as const,
      ready: false,
      reportId: "report-lease.all",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "queued",
    };
    const activeReceipt = {
      ...allReceipt,
      reportId: "report-lease.active",
    };
    const start = vi.fn(async (plan: { intent: string }) =>
      plan.intent === "all-listings" ? allReceipt : activeReceipt
    );
    const reports = {
      start,
      read: vi.fn(),
      status: vi.fn(),
      readDocument: vi.fn(),
    } as unknown as Pick<
      ReportsRuntime,
      "start" | "read" | "status" | "readDocument"
    >;
    const coordinator = new FbaCatalogReports({
      reports,
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      })),
      listings: createScriptedListingsReadAdapter([]),
      demo: {
        export: vi.fn(),
        identity: vi.fn(),
        seeds: vi.fn(),
        businessPricingAudit: vi.fn(),
      },
    });

    const receipt = await coordinator.begin({
      purpose: "business-pricing-audit",
      marketplaceId: US,
      explicitRetry: true,
    });

    expect(receipt).toEqual(allReceipt);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenNthCalledWith(
      1,
      { intent: "all-listings", marketplaceId: US, signal: undefined },
      {
        explicitRetry: true,
        freshCompleted: undefined,
        expectedContext: expect.objectContaining({
          marketplaceId: US,
          mode: "live",
          accountScope: "opaque-catalog-account",
        }),
      },
    );
    expect(start).toHaveBeenNthCalledWith(
      2,
      {
        intent: "active-business-listings",
        marketplaceId: US,
        signal: undefined,
      },
      {
        explicitRetry: true,
        expectedContext: expect.objectContaining({
          marketplaceId: US,
          mode: "live",
          accountScope: "opaque-catalog-account",
        }),
      },
    );
  });

  it("checks an existing All Listings receipt without creating a report", async () => {
    const receipt = {
      mode: "live" as const,
      ready: true,
      reportId: "report-lease.all",
      documentId: "report-document.all",
      status: "DONE" as const,
      notice: "done",
    };
    const start = vi.fn();
    const status = vi.fn(async () => receipt);
    const coordinator = new FbaCatalogReports({
      reports: {
        start,
        read: vi.fn(),
        status,
        readDocument: vi.fn(),
      } as unknown as Pick<
        ReportsRuntime,
        "start" | "read" | "status" | "readDocument"
      >,
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      })),
      listings: createScriptedListingsReadAdapter([]),
      demo: {
        export: vi.fn(),
        identity: vi.fn(),
        seeds: vi.fn(),
        businessPricingAudit: vi.fn(),
      },
    });

    await expect(coordinator.status({
      marketplaceId: US,
      reportId: "report-lease.all",
    })).resolves.toEqual(receipt);
    expect(start).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(
      { intent: "all-listings", marketplaceId: US, signal: undefined },
      "report-lease.all",
      expect.objectContaining({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      }),
    );
  });

  it("returns a missing live export without creating or polling a report", async () => {
    const start = vi.fn();
    const read = vi.fn(async () => null);
    const status = vi.fn();
    const readDocument = vi.fn();
    const coordinator = new FbaCatalogReports({
      reports: { start, read, status, readDocument } as unknown as Pick<
        ReportsRuntime,
        "start" | "read" | "status" | "readDocument"
      >,
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      })),
      listings: createScriptedListingsReadAdapter([]),
      demo: {
        export: vi.fn(),
        identity: vi.fn(),
        seeds: vi.fn(),
        businessPricingAudit: vi.fn(),
      },
    });

    await expect(coordinator.readExistingExport({ marketplaceId: US }))
      .resolves.toEqual({ state: "missing" });
    expect(read).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(readDocument).not.toHaveBeenCalled();
  });

  it("reads demo coverage data without creating a demo report lease", async () => {
    const exportData = {
      rows: [],
      errors: [],
      fetchedAt: "2026-08-25T00:00:00.000Z",
    };
    const reports = {
      start: vi.fn(),
      read: vi.fn(),
      status: vi.fn(),
      readDocument: vi.fn(),
    };
    const demo = {
      export: vi.fn(async () => exportData),
      identity: vi.fn(),
      seeds: vi.fn(),
      businessPricingAudit: vi.fn(),
    };
    const coordinator = new FbaCatalogReports({
      reports: reports as unknown as Pick<
        ReportsRuntime,
        "start" | "read" | "status" | "readDocument"
      >,
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "demo",
        accountScope: "opaque-demo-account",
      })),
      listings: createScriptedListingsReadAdapter([]),
      demo,
    });

    await expect(coordinator.readExistingExport({ marketplaceId: US }))
      .resolves.toEqual({ state: "ready", data: exportData });
    expect(demo.export).toHaveBeenCalledOnce();
    expect(reports.start).not.toHaveBeenCalled();
    expect(reports.read).not.toHaveBeenCalled();
    expect(reports.status).not.toHaveBeenCalled();
    expect(reports.readDocument).not.toHaveBeenCalled();
  });

  it("reads B2B data from existing All and Active documents without create", async () => {
    const start = vi.fn();
    const heartbeat = vi.fn();
    const read = vi.fn(async () => ({
      mode: "live" as const,
      ready: true,
      reportId: "report-lease.active",
      documentId: "report-document.active",
      status: "DONE" as const,
      notice: "done",
    }));
    const readDocument = vi.fn(async (plan: { intent: string }) => ({
      mode: "live" as const,
      text: plan.intent === "all-listings"
        ? "seller-sku\tasin\titem-name\tfulfillment-channel\tbusiness-price"
        : "seller-sku\tasin\tfulfillment-channel\tbusiness-price",
    }));
    const coordinator = new FbaCatalogReports({
      reports: {
        start,
        read,
        status: vi.fn(),
        readDocument,
      } as unknown as Pick<
        ReportsRuntime,
        "start" | "read" | "status" | "readDocument"
      >,
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      })),
      listings: createScriptedListingsReadAdapter([]),
      demo: {
        export: vi.fn(),
        identity: vi.fn(),
        seeds: vi.fn(),
        businessPricingAudit: vi.fn(),
      },
    });

    const snapshot = await coordinator.read({
      view: "business-pricing-audit",
      marketplaceId: US,
      reportId: "report-lease.all",
      documentId: "report-document.all",
      heartbeat,
    });

    expect(snapshot).toMatchObject({
      mode: "live",
      marketplaceId: US,
      rows: [],
      summary: { totalFbaSkuCount: 0 },
    });
    expect(start).not.toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith({
      intent: "active-business-listings",
      marketplaceId: US,
      signal: undefined,
    }, expect.objectContaining({
      marketplaceId: US,
      mode: "live",
      accountScope: "opaque-catalog-account",
    }));
    expect(readDocument).toHaveBeenNthCalledWith(
      1,
      { intent: "all-listings", marketplaceId: US, signal: undefined },
      { reportId: "report-lease.all", documentId: "report-document.all" },
      expect.objectContaining({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      }),
    );
    expect(readDocument).toHaveBeenNthCalledWith(
      2,
      {
        intent: "active-business-listings",
        marketplaceId: US,
        signal: undefined,
      },
      {
        reportId: "report-lease.active",
        documentId: "report-document.active",
      },
      expect.objectContaining({
        marketplaceId: US,
        mode: "live",
        accountScope: "opaque-catalog-account",
      }),
    );
  });

  it("validates a demo lease without asking the document adapter for text", async () => {
    const readDocument = vi.fn(async () => {
      throw new Error("demo must not read a runtime document");
    });
    const demoSeeds = [{
      sellerSku: "DEMO-SKU",
      asin: "B0DEMO0001",
      title: "Demo source title",
    }];
    const demo = {
      export: vi.fn(),
      identity: vi.fn(),
      seeds: vi.fn(async () => demoSeeds),
      businessPricingAudit: vi.fn(),
    };
    const coordinator = new FbaCatalogReports({
      reports: {
        start: vi.fn(),
        read: vi.fn(async () => ({
          mode: "demo" as const,
          ready: true,
          reportId: "report-lease.demo",
          documentId: "report-document.demo",
          status: "DONE" as const,
          notice: "done",
        })),
        status: vi.fn(),
        readDocument,
      } as unknown as Pick<
        ReportsRuntime,
        "start" | "read" | "status" | "readDocument"
      >,
      context: createScriptedSpExecutionContextAdapter(() => ({
        marketplaceId: US,
        mode: "demo",
        accountScope: "opaque-demo-account",
      })),
      listings: createScriptedListingsReadAdapter([]),
      demo,
    });

    await expect(coordinator.read({
      view: "seeds",
      marketplaceId: US,
      reportId: "report-lease.demo",
      documentId: "report-document.demo",
    })).resolves.toEqual(demoSeeds);
    expect(demo.seeds).toHaveBeenCalledOnce();
    expect(readDocument).not.toHaveBeenCalled();
  });
});
