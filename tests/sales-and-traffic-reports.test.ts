import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReportsRuntime,
  ReportsRuntimeReceipt,
} from "../src/main/amazon/reports-runtime";
import {
  SalesAndTrafficReports,
  type SalesAndTrafficDocumentReader,
} from "../src/main/amazon/sales-and-traffic-reports";
import type { SalesAndTrafficSnapshot } from
  "../src/main/amazon/sales-and-traffic-reads";
import {
  createScriptedSpExecutionContextAdapter,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const START_DATE = "2026-08-01";
const END_DATE = "2026-08-20";

function receipt(): ReportsRuntimeReceipt {
  return {
    mode: "live",
    ready: true,
    reportId: "report-lease.sales",
    documentId: "report-document.sales",
    status: "DONE",
    notice: "ready",
  };
}

function snapshot(): SalesAndTrafficSnapshot {
  return {
    mode: "live",
    marketplaceId: MARKETPLACE_ID,
    startDate: START_DATE,
    endDate: END_DATE,
    fetchedAt: "2026-08-21T12:00:00.000Z",
    rows: [{
      sellerSku: "SAFE-SKU-1",
      childAsin: "B000000001",
      unitsOrdered: 3,
      orderedProductSales: 45,
      currencyCode: "USD",
    }],
    notice: "synthetic",
  };
}

function build(input: Readonly<{
  context?: SpExecutionContextAdapter;
  readDocument?: () => Promise<{ mode: "live"; text: string }>;
  liveReader?: SalesAndTrafficDocumentReader;
}> = {}) {
  const context = input.context ?? createScriptedSpExecutionContextAdapter(
    (marketplaceId) => ({
      marketplaceId,
      mode: "live",
      accountScope: "sales-and-traffic-scope",
    }),
  );
  const start = vi.fn(async () => receipt());
  const status = vi.fn(async () => receipt());
  const read = vi.fn(async () => receipt());
  const readDocument = vi.fn(input.readDocument ?? (async () => ({
    mode: "live" as const,
    text: "synthetic report document",
  })));
  const liveReader = vi.fn<SalesAndTrafficDocumentReader>(
    input.liveReader ?? (async () => snapshot()),
  );
  const demoRead = vi.fn(async () => ({ ...snapshot(), mode: "demo" as const }));
  const reports = {
    start,
    status,
    read,
    readDocument,
  } as unknown as ReportsRuntime;
  const coordinator = new SalesAndTrafficReports({
    reports,
    context,
    liveReader,
    demo: { read: demoRead },
  });
  return {
    context,
    coordinator,
    demoRead,
    liveReader,
    read,
    readDocument,
    start,
    status,
  };
}

describe("SalesAndTrafficReports", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("owns the fixed daily SKU intent and forwards explicit lifecycle flags", async () => {
    const built = build();

    await expect(built.coordinator.begin({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      explicitRetry: true,
      freshCompleted: true,
    })).resolves.toEqual(receipt());

    expect(built.start).toHaveBeenCalledOnce();
    expect(built.start).toHaveBeenCalledWith({
      intent: "sales-and-traffic-daily-sku",
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      signal: undefined,
    }, {
      explicitRetry: true,
      freshCompleted: true,
      expectedContext: expect.objectContaining({
        marketplaceId: MARKETPLACE_ID,
        mode: "live",
        accountScope: "sales-and-traffic-scope",
      }),
    });
  });

  it("uses existing handles for status and document reads without an implicit create", async () => {
    const built = build();

    await built.coordinator.status({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      reportId: "report-lease.sales",
    });
    await expect(built.coordinator.read({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      reportId: "report-lease.sales",
      documentId: "report-document.sales",
    })).resolves.toEqual(snapshot());

    expect(built.start).not.toHaveBeenCalled();
    expect(built.status).toHaveBeenCalledWith({
      intent: "sales-and-traffic-daily-sku",
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      signal: undefined,
    }, "report-lease.sales", expect.objectContaining({
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      accountScope: "sales-and-traffic-scope",
    }));
    expect(built.readDocument).toHaveBeenCalledOnce();
    expect(built.liveReader).toHaveBeenCalledWith({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      document: "synthetic report document",
      signal: undefined,
    });
    expect(built.read).not.toHaveBeenCalled();
    expect(built.demoRead).not.toHaveBeenCalled();
  });

  it("keeps an accepted boundary lease readable after marketplace midnight advances the 95-day window", async () => {
    vi.setSystemTime(new Date("2026-08-21T06:59:59.000Z"));
    const startDate = "2026-05-17";
    const boundarySnapshot = {
      ...snapshot(),
      startDate,
      endDate: startDate,
    };
    const built = build({ liveReader: async () => boundarySnapshot });

    await built.coordinator.begin({
      marketplaceId: MARKETPLACE_ID,
      startDate,
      endDate: startDate,
      explicitRetry: false,
    });
    vi.setSystemTime(new Date("2026-08-21T07:00:00.000Z"));

    await expect(built.coordinator.status({
      marketplaceId: MARKETPLACE_ID,
      startDate,
      endDate: startDate,
      reportId: "report-lease.sales",
    })).resolves.toEqual(receipt());
    await expect(built.coordinator.read({
      marketplaceId: MARKETPLACE_ID,
      startDate,
      endDate: startDate,
      reportId: "report-lease.sales",
      documentId: "report-document.sales",
    })).resolves.toEqual(boundarySnapshot);
    expect(built.start).toHaveBeenCalledOnce();
    expect(built.status).toHaveBeenCalledOnce();
    expect(built.readDocument).toHaveBeenCalledOnce();
  });

  it("rejects a reader result from another selection and strips non-DTO fields", async () => {
    const mismatched = build({
      liveReader: async () => ({
        ...snapshot(),
        startDate: "2026-07-31",
      }),
    });
    await expect(mismatched.coordinator.read({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      reportId: "report-lease.sales",
      documentId: "report-document.sales",
    })).rejects.toMatchObject({ code: "REPORT_MISMATCH" });

    const projected = build({
      liveReader: async () => ({
        ...snapshot(),
        internalOnly: "must-not-cross",
        rows: snapshot().rows.map((row) => ({
          ...row,
          internalOnly: "must-not-cross",
        })),
      } as never),
    });
    await expect(projected.coordinator.read({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      reportId: "report-lease.sales",
      documentId: "report-document.sales",
    })).resolves.toEqual(snapshot());
  });

  it("stops before projection when execution context changes after the document read", async () => {
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "sales-and-traffic-scope",
      }),
    );
    const built = build({
      context,
      readDocument: async () => {
        context.invalidate("account-changed");
        return { mode: "live", text: "stale report document" };
      },
    });

    await expect(built.coordinator.read({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      reportId: "report-lease.sales",
      documentId: "report-document.sales",
    })).rejects.toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(built.liveReader).not.toHaveBeenCalled();
    expect(built.start).not.toHaveBeenCalled();
  });

  it("preserves the context fence when an injected reader rejects after invalidation", async () => {
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "sales-and-traffic-scope",
      }),
    );
    const built = build({
      context,
      liveReader: async () => {
        context.invalidate("account-changed");
        throw new Error("reader failed after invalidation");
      },
    });

    await expect(built.coordinator.read({
      marketplaceId: MARKETPLACE_ID,
      startDate: START_DATE,
      endDate: END_DATE,
      reportId: "report-lease.sales",
      documentId: "report-document.sales",
    })).rejects.toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
  });
});
