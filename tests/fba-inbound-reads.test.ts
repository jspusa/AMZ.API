import { describe, expect, it, vi } from "vitest";
import {
  FbaInboundReads,
  fbaInboundExternalReadIdentity,
  type FbaInboundExternalReadAdapter,
  type FbaInboundExternalReadIdentity,
  type FbaInboundExternalReadPlan,
} from "../src/main/amazon/fba-inbound-reads";
import type { ReportsRuntime } from "../src/main/amazon/reports-runtime";
import { DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT } from
  "../src/main/amazon/inbound-noncompliance";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;

function v0Envelope(payload: Record<string, unknown>): unknown {
  return { payload };
}

describe("FbaInboundReads", () => {
  it("reaches modern only after exact 400/422 fallbacks and keeps item continuation bound", async () => {
    const requests: FbaInboundExternalReadIdentity[] = [];
    const adapter: FbaInboundExternalReadAdapter = {
      async read(plan: FbaInboundExternalReadPlan) {
        const identity = fbaInboundExternalReadIdentity(plan);
        requests.push(identity);

        if (identity.source === "v0") {
          const request = identity.request;
          if (request.kind === "shipments" && request.queryType === "DATE_RANGE") {
            throw new SpApiError("date range rejected", {
              status: 400,
              code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
            });
          }
          if (request.kind === "shipments" && request.queryType === "SHIPMENT") {
            throw new SpApiError("active list rejected", {
              status: 422,
              code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
            });
          }
          if (request.kind === "items" && request.queryType === "SHIPMENT") {
            return {
              identity,
              envelope: v0Envelope({
                ItemData: [{
                  ShipmentId: "FBA19SEMANTIC001",
                  SellerSKU: "SAFE-SKU-1",
                  FulfillmentNetworkSKU: "X00SAFE001",
                  QuantityShipped: 24,
                  QuantityReceived: 24,
                }],
                NextToken: "OPAQUE-ITEM-CONTINUATION",
              }),
              requestId: "ITEM-FIRST",
            };
          }
          if (request.kind === "items" && request.queryType === "NEXT_TOKEN") {
            return {
              identity,
              envelope: v0Envelope({
                ItemData: [{
                  ShipmentId: "FBA19SEMANTIC001",
                  SellerSKU: "SAFE-SKU-2",
                  FulfillmentNetworkSKU: "X00SAFE002",
                  QuantityShipped: 6,
                  QuantityReceived: 5,
                }],
              }),
              requestId: "ITEM-NEXT",
            };
          }
        } else if (identity.request.kind === "plans") {
          return {
            identity,
            envelope: {
              inboundPlans: [{
                inboundPlanId: "plan-safe-001",
                lastUpdatedAt: "2026-08-03T12:00:00Z",
                marketplaceIds: [MARKETPLACE_ID],
              }],
            },
            requestId: "MODERN-PLANS",
          };
        } else if (identity.request.kind === "plan") {
          return {
            identity,
            envelope: {
              inboundPlanId: "plan-safe-001",
              lastUpdatedAt: "2026-08-03T12:00:00Z",
              marketplaceIds: [MARKETPLACE_ID],
              shipments: [{ shipmentId: "shipment-safe-001" }],
            },
            requestId: "MODERN-PLAN",
          };
        } else {
          return {
            identity,
            envelope: {
              inboundPlanId: "plan-safe-001",
              shipmentId: "shipment-safe-001",
              shipmentConfirmationId: "FBA19SEMANTIC001",
              name: "Semantic shipment",
              status: "RECEIVING",
              destination: { warehouseId: "ONT8" },
            },
            requestId: "MODERN-SHIPMENT",
          };
        }
        throw new Error(`Unexpected inbound read: ${JSON.stringify(identity)}`);
      },
    };
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "synthetic-inbound-account",
      }),
    );
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const reads = new FbaInboundReads({
      adapter,
      context,
      reports: {} as ReportsRuntime,
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });

    const result = await reads.readShipments({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-03",
      endDate: "2026-08-04",
      expectedContext,
    });

    expect(result.state).toBe("partial");
    expect(result.snapshot).toMatchObject({
      shipmentListScope: "modern-plan-range",
      coverage: { state: "complete", itemPages: 2, itemCount: 2 },
      summary: {
        shipmentCount: 1,
        itemCount: 2,
        totals: {
          expectedUnits: 30,
          receivedUnits: 29,
          pendingUnits: 1,
          overReceivedUnits: 0,
        },
      },
    });
    expect(requests).toHaveLength(7);
    expect(requests[0]).toMatchObject({
      source: "v0",
      request: { kind: "shipments", queryType: "DATE_RANGE" },
    });
    expect(requests[1]).toMatchObject({
      source: "v0",
      request: { kind: "shipments", queryType: "SHIPMENT" },
    });
    expect(requests.slice(2, 5).map((request) =>
      request.source === "modern" ? request.request.kind : "v0"
    )).toEqual(["plans", "plan", "shipment"]);
    expect(requests[6]).toEqual({
      source: "v0",
      request: {
        kind: "items",
        marketplaceId: MARKETPLACE_ID,
        shipmentId: "FBA19SEMANTIC001",
        queryType: "NEXT_TOKEN",
        nextToken: "OPAQUE-ITEM-CONTINUATION",
      },
    });
    expect(JSON.stringify(result.snapshot)).not.toContain("plan-safe-001");
    expect(JSON.stringify(result.snapshot)).not.toContain("shipment-safe-001");
  });

  it("uses the bounded active list without opening modern reads", async () => {
    const requests: FbaInboundExternalReadIdentity[] = [];
    const adapter: FbaInboundExternalReadAdapter = {
      async read(plan) {
        const identity = fbaInboundExternalReadIdentity(plan);
        requests.push(identity);
        if (identity.source !== "v0") {
          throw new Error("Modern fallback must not start after active success.");
        }
        if (
          identity.request.kind === "shipments" &&
          identity.request.queryType === "DATE_RANGE"
        ) {
          throw new SpApiError("date range rejected", {
            status: 400,
            code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
          });
        }
        if (identity.request.kind === "shipments") {
          return {
            identity,
            envelope: v0Envelope({
              ShipmentData: [{
                ShipmentId: "FBA19ACTIVE001",
                ShipmentStatus: "RECEIVING",
              }],
            }),
            requestId: "ACTIVE-LIST",
          };
        }
        return {
          identity,
          envelope: v0Envelope({ ItemData: [] }),
          requestId: "ACTIVE-ITEMS",
        };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "active-inbound-account",
      }),
    );
    const reads = new FbaInboundReads({
      adapter,
      context,
      reports: {} as ReportsRuntime,
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });

    const result = await reads.readShipments({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-03",
      endDate: "2026-08-04",
      expectedContext: await context.capture(MARKETPLACE_ID),
    });

    expect(result.state).toBe("partial");
    expect(result.snapshot.shipmentListScope).toBe("active-status-fallback");
    expect(requests.map((request) => request.source)).toEqual([
      "v0",
      "v0",
      "v0",
    ]);
  });

  it.each([
    new SpApiError("unauthorized", {
      status: 403,
      code: "FBA_INBOUND_UNAUTHORIZED",
    }),
    new SpApiError("throttled", { status: 429, code: "RATE_LIMITED" }),
    new SpApiError("service unavailable", {
      status: 503,
      code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
    }),
    new TypeError("network unavailable"),
  ])("never opens a fallback for a non-400/422 first-list failure", async (failure) => {
    const requests: FbaInboundExternalReadIdentity[] = [];
    const adapter: FbaInboundExternalReadAdapter = {
      async read(plan) {
        requests.push(fbaInboundExternalReadIdentity(plan));
        throw failure;
      },
    };
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "fail-honest-inbound-account",
      }),
    );
    const reads = new FbaInboundReads({
      adapter,
      context,
      reports: {} as ReportsRuntime,
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });

    await expect(reads.readShipments({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-03",
      endDate: "2026-08-04",
      expectedContext: await context.capture(MARKETPLACE_ID),
    })).rejects.toBe(failure);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      source: "v0",
      request: { kind: "shipments", queryType: "DATE_RANGE" },
    });
  });

  it("accepts an exact 180-day marketplace window and rejects invalid ranges before transport", async () => {
    const requests: FbaInboundExternalReadIdentity[] = [];
    const adapter: FbaInboundExternalReadAdapter = {
      async read(plan) {
        const identity = fbaInboundExternalReadIdentity(plan);
        requests.push(identity);
        return {
          identity,
          envelope: v0Envelope({ ShipmentData: [] }),
          requestId: "EMPTY-LIST",
        };
      },
    };
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "date-window-inbound-account",
      }),
    );
    const reads = new FbaInboundReads({
      adapter,
      context,
      reports: {} as ReportsRuntime,
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });
    const expectedContext = await context.capture(MARKETPLACE_ID);

    const result = await reads.readShipments({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2023-01-01",
      endDate: "2023-06-29",
      expectedContext,
    });
    expect(result.snapshot.dateRange).toMatchObject({
      lastUpdatedAfter: "2023-01-01T00:00:00-08:00",
      lastUpdatedBefore: "2023-06-30T00:00:00-07:00",
    });
    expect(requests[0]).toMatchObject({
      source: "v0",
      request: {
        lastUpdatedAfter: "2023-01-01T00:00:00-08:00",
        lastUpdatedBefore: "2023-06-30T00:00:00-07:00",
      },
    });

    for (const range of [
      { startDate: "2026-02-22", endDate: "2026-08-21" },
      { startDate: "2026-08-01", endDate: "2026-08-22" },
    ]) {
      await expect(reads.readShipments({
        marketplaceId: MARKETPLACE_ID,
        ...range,
        expectedContext,
      })).rejects.toMatchObject({
        status: 400,
        code: "INVALID_FBA_INBOUND_RANGE",
      });
    }
    expect(requests).toHaveLength(1);
  });

  it("keeps noncompliance handles inside the module and reuses one expected context", async () => {
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "live",
        accountScope: "report-inbound-account",
      }),
    );
    const expectedContext = await context.capture(MARKETPLACE_ID);
    const start = vi.fn(async () => ({
      mode: "live" as const,
      ready: false,
      reportId: "opaque-report-handle",
      documentId: null,
      status: "IN_QUEUE" as const,
      notice: "pending",
    }));
    const status = vi.fn(async () => ({
      mode: "live" as const,
      ready: true,
      reportId: "opaque-report-handle",
      documentId: "opaque-document-handle",
      status: "DONE" as const,
      notice: "done",
    }));
    const readDocument = vi.fn(async () => ({
      mode: "live" as const,
      text: DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT,
    }));
    const progress: unknown[] = [];
    const reads = new FbaInboundReads({
      adapter: { read: vi.fn() },
      context,
      reports: { start, status, readDocument } as unknown as ReportsRuntime,
      wait: async () => undefined,
      now: () => new Date("2026-08-21T12:34:56.000Z"),
    });

    const result = await reads.readNoncompliance({
      marketplaceId: MARKETPLACE_ID,
      explicitRetry: true,
      expectedContext,
      onProgress: (value) => progress.push(value),
    });

    expect(result).toEqual({
      parsed: {
        issues: [],
        incompleteRowCount: 0,
        incompleteRows: [],
        latestIssueReportedDate: null,
      },
      fetchedAt: "2026-08-21T12:34:56.000Z",
    });
    expect(start).toHaveBeenCalledWith({
      intent: "inbound-noncompliance",
      marketplaceId: MARKETPLACE_ID,
      signal: undefined,
    }, {
      explicitRetry: true,
      freshCompleted: true,
      expectedContext,
    });
    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "inbound-noncompliance" }),
      "opaque-report-handle",
      expectedContext,
    );
    expect(readDocument).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "inbound-noncompliance" }),
      {
        reportId: "opaque-report-handle",
        documentId: "opaque-document-handle",
      },
      expectedContext,
    );
    expect(progress).toEqual([
      { phase: "issues", completed: 0, total: 1 },
      { phase: "issues", completed: 0, total: 1 },
      { phase: "issues", completed: 1, total: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain("opaque-report-handle");
    expect(JSON.stringify(result)).not.toContain("opaque-document-handle");
  });
});
