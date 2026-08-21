import { describe, expect, it, vi } from "vitest";
import {
  buildDemoFbaInboundShipmentSnapshot,
  collectFbaInboundShipmentSnapshot,
  type FbaInboundTransportRequest,
  type FbaInboundTransportResult,
} from "../src/main/amazon/fba-inbound-shipments";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const BASE_INPUT = {
  marketplaceId: MARKETPLACE_ID,
  startDate: "2026-08-01",
  endDate: "2026-08-20",
  lastUpdatedAfter: "2026-08-01T00:00:00-07:00",
  lastUpdatedBefore: "2026-08-21T00:00:00-07:00",
};

function shipment(
  shipmentId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ShipmentId: shipmentId,
    ShipmentName: `Shipment ${shipmentId}`,
    ShipmentStatus: "RECEIVING",
    DestinationFulfillmentCenterId: "ONT8",
    LabelPrepType: "SELLER_LABEL",
    BoxContentsSource: "FEED",
    ...overrides,
  };
}

function item(
  shipmentId: string,
  sellerSku: string,
  expectedUnits: number,
  receivedUnits: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ShipmentId: shipmentId,
    SellerSKU: sellerSku,
    FulfillmentNetworkSKU: `X00${sellerSku}`,
    QuantityShipped: expectedUnits,
    QuantityReceived: receivedUnits,
    QuantityInCase: 12,
    ...overrides,
  };
}

function result(payload: unknown, requestId: string): FbaInboundTransportResult {
  return { payload, requestId };
}

describe("FBA inbound shipment snapshot collector", () => {
  it("paginates shipment rows, reads exact shipment items, and preserves over-receipts", async () => {
    const progress: unknown[] = [];
    const transport = vi.fn(
      async (request: FbaInboundTransportRequest): Promise<FbaInboundTransportResult> => {
        if (request.kind === "shipments" && request.queryType === "DATE_RANGE") {
          expect(request).toMatchObject({
            marketplaceId: MARKETPLACE_ID,
            lastUpdatedAfter: BASE_INPUT.lastUpdatedAfter,
            lastUpdatedBefore: BASE_INPUT.lastUpdatedBefore,
            nextToken: null,
          });
          return result(
            {
              payload: {
                ShipmentData: [shipment("FBA0001")],
                NextToken: "TOKEN-2",
              },
            },
            "LIST-1",
          );
        }
        if (request.kind === "shipments") {
          expect(request).toMatchObject({
            queryType: "NEXT_TOKEN",
            nextToken: "TOKEN-2",
            lastUpdatedAfter: null,
            lastUpdatedBefore: null,
          });
          return result(
            { payload: { ShipmentData: [shipment("FBA0002", { ShipmentStatus: "CLOSED" })] } },
            "LIST-2",
          );
        }
        if (request.shipmentId === "FBA0001") {
          return result(
            { payload: { ItemData: [item("FBA0001", "SKU-1", 48, 48)] } },
            "ITEM-1",
          );
        }
        return result(
          { payload: { ItemData: [item("FBA0002", "SKU-2", 10, 11)] } },
          "ITEM-2",
        );
      },
    );

    const snapshot = await collectFbaInboundShipmentSnapshot({
      ...BASE_INPUT,
      transport,
      onProgress: (value) => progress.push(value),
      now: () => new Date("2026-08-21T01:02:03.000Z"),
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      coverage: {
        state: "complete",
        shipmentPages: 2,
        itemPages: 2,
        shipmentCount: 2,
        shipmentsWithCompleteItems: 2,
        incompleteShipmentCount: 0,
        itemCount: 2,
        issues: [],
      },
      summary: {
        shipmentCount: 2,
        itemCount: 2,
        incompleteShipmentCount: 0,
        totals: {
          expectedUnits: 58,
          receivedUnits: 59,
          pendingUnits: 0,
          overReceivedUnits: 1,
        },
      },
    });
    expect(snapshot.items[1]).toMatchObject({
      shipmentId: "FBA0002",
      sellerSku: "SKU-2",
      asin: null,
      title: null,
      expectedUnits: 10,
      receivedUnits: 11,
      pendingUnits: 0,
      overReceivedUnits: 1,
    });
    expect(progress).toEqual([
      { phase: "shipments", completed: 1, total: null },
      { phase: "shipments", completed: 2, total: null },
      { phase: "shipments", completed: 2, total: 2 },
      { phase: "items", completed: 1, total: 2 },
      { phase: "items", completed: 2, total: 2 },
    ]);
  });

  it("fails closed when shipment pagination repeats an identifier", async () => {
    const transport = vi.fn(
      async (request: FbaInboundTransportRequest): Promise<FbaInboundTransportResult> =>
        request.kind === "shipments" && request.queryType === "DATE_RANGE"
          ? result(
              {
                payload: {
                  ShipmentData: [shipment("FBA-DUP")],
                  NextToken: "TOKEN-2",
                },
              },
              "LIST-1",
            )
          : result(
              { payload: { ShipmentData: [shipment("FBA-DUP")] } },
              "LIST-2",
            ),
    );

    await expect(
      collectFbaInboundShipmentSnapshot({ ...BASE_INPUT, transport }),
    ).rejects.toMatchObject({
      code: "PAGINATION_CHANGED",
      requestId: "LIST-2",
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("fails closed before item reads when Amazon returns a malformed shipment identifier", async () => {
    const transport = vi.fn(
      async (): Promise<FbaInboundTransportResult> =>
        result(
          { payload: { ShipmentData: [shipment("FBA/UNSAFE")] } },
          "LIST-BAD-ID",
        ),
    );

    await expect(
      collectFbaInboundShipmentSnapshot({ ...BASE_INPUT, transport }),
    ).rejects.toMatchObject({
      code: "FBA_INBOUND_FORMAT_UNSUPPORTED",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("marks a shipment partial instead of treating a malformed received quantity as zero", async () => {
    const transport = vi.fn(
      async (request: FbaInboundTransportRequest): Promise<FbaInboundTransportResult> =>
        request.kind === "shipments"
          ? result(
              { payload: { ShipmentData: [shipment("FBA-BAD-ITEM")] } },
              "LIST",
            )
          : result(
              {
                payload: {
                  ItemData: [item("FBA-BAD-ITEM", "SKU-BAD", 24, -1)],
                },
              },
              "ITEM",
            ),
    );

    const snapshot = await collectFbaInboundShipmentSnapshot({
      ...BASE_INPUT,
      transport,
    });

    expect(snapshot.coverage).toMatchObject({
      state: "partial",
      incompleteShipmentCount: 1,
      itemCount: 0,
    });
    expect(snapshot.summary.totals).toBeNull();
    expect(snapshot.summary.verifiedTotals).toEqual({
      expectedUnits: 0,
      receivedUnits: 0,
      pendingUnits: 0,
      overReceivedUnits: 0,
    });
    expect(snapshot.shipments[0]).toMatchObject({
      itemCoverage: "partial",
      itemCount: 0,
      totals: null,
    });
    expect(snapshot.coverage.issues[0]).toMatchObject({
      stage: "items",
      shipmentId: "FBA-BAD-ITEM",
      code: "FBA_INBOUND_FORMAT_UNSUPPORTED",
      completedItemPages: 0,
    });
  });

  it("stops the scan after global auth, throttle, service, credential or network failures", async () => {
    const failures = [
      Object.assign(new Error("unauthorized"), {
        status: 401,
        code: "FBA_INBOUND_UNAUTHORIZED",
      }),
      Object.assign(new Error("forbidden"), {
        status: 403,
        code: "FBA_INBOUND_UNAUTHORIZED",
      }),
      Object.assign(new Error("throttled"), {
        status: 429,
        code: "RATE_LIMITED",
      }),
      Object.assign(new Error("service unavailable"), {
        status: 503,
        code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE",
      }),
      Object.assign(new Error("credential changed"), {
        status: 409,
        code: "CREDENTIALS_CHANGED",
      }),
      new Error("network disconnected"),
    ];

    for (const failure of failures) {
      const requestedItems: string[] = [];
      const transport = vi.fn(
        async (request: FbaInboundTransportRequest): Promise<FbaInboundTransportResult> => {
          if (request.kind === "shipments") {
            return result(
              {
                payload: {
                  ShipmentData: [
                    shipment("FBA-GLOBAL-1"),
                    shipment("FBA-GLOBAL-2"),
                  ],
                },
              },
              "LIST",
            );
          }
          requestedItems.push(request.shipmentId);
          throw failure;
        },
      );

      await expect(
        collectFbaInboundShipmentSnapshot({ ...BASE_INPUT, transport }),
      ).rejects.toBe(failure);
      expect(requestedItems).toEqual(["FBA-GLOBAL-1"]);
      expect(transport).toHaveBeenCalledTimes(2);
    }
  });

  it("stops after three consecutive local failures but returns a partial snapshot", async () => {
    const requestedItems: string[] = [];
    const transport = vi.fn(
      async (request: FbaInboundTransportRequest): Promise<FbaInboundTransportResult> => {
        if (request.kind === "shipments") {
          return result(
            {
              payload: {
                ShipmentData: [
                  shipment("FBA-LOCAL-1"),
                  shipment("FBA-LOCAL-2"),
                  shipment("FBA-LOCAL-3"),
                  shipment("FBA-LOCAL-4"),
                ],
              },
            },
            "LIST",
          );
        }
        requestedItems.push(request.shipmentId);
        if (request.shipmentId === "FBA-LOCAL-1") {
          throw Object.assign(new Error("item not found"), {
            status: 404,
            code: "FBA_INBOUND_ITEM_NOT_FOUND",
          });
        }
        if (request.shipmentId === "FBA-LOCAL-2") {
          return result(
            {
              payload: {
                ItemData: [item(request.shipmentId, "SKU-BAD", 12, -1)],
              },
            },
            "ITEM-2",
          );
        }
        return result(
          {
            payload: {
              ItemData: [item(request.shipmentId, "SKU-PAGED", 12, 12)],
              NextToken: "UNSUPPORTED-CONTINUATION",
            },
          },
          "ITEM-3",
        );
      },
    );

    const snapshot = await collectFbaInboundShipmentSnapshot({
      ...BASE_INPUT,
      transport,
    });

    expect(snapshot.coverage).toMatchObject({
      state: "partial",
      shipmentCount: 4,
      shipmentsWithCompleteItems: 0,
      shipmentsWithPartialItems: 4,
      incompleteShipmentCount: 4,
      itemCount: 1,
    });
    expect(snapshot.summary.totals).toBeNull();
    expect(snapshot.coverage.issues).toHaveLength(4);
    expect(snapshot.coverage.issues.at(-1)).toMatchObject({
      shipmentId: "FBA-LOCAL-4",
      code: "FBA_INBOUND_SCAN_STOPPED",
      requestId: null,
    });
    expect(snapshot.coverage.issues.at(-1)?.message).not.toContain("FBA-LOCAL");
    expect(requestedItems).toEqual([
      "FBA-LOCAL-1",
      "FBA-LOCAL-2",
      "FBA-LOCAL-3",
    ]);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("resets the local failure circuit after a complete shipment item response", async () => {
    const requestedItems: string[] = [];
    const transport = vi.fn(
      async (request: FbaInboundTransportRequest): Promise<FbaInboundTransportResult> => {
        if (request.kind === "shipments") {
          return result(
            {
              payload: {
                ShipmentData: [
                  shipment("FBA-RESET-1"),
                  shipment("FBA-RESET-2"),
                  shipment("FBA-RESET-3"),
                  shipment("FBA-RESET-4"),
                ],
              },
            },
            "LIST",
          );
        }
        requestedItems.push(request.shipmentId);
        const complete = request.shipmentId === "FBA-RESET-3";
        return result(
          {
            payload: {
              ItemData: [item(
                request.shipmentId,
                `SKU-${request.shipmentId}`,
                12,
                complete ? 12 : -1,
              )],
            },
          },
          `ITEM-${request.shipmentId}`,
        );
      },
    );

    const snapshot = await collectFbaInboundShipmentSnapshot({
      ...BASE_INPUT,
      transport,
    });

    expect(requestedItems).toEqual([
      "FBA-RESET-1",
      "FBA-RESET-2",
      "FBA-RESET-3",
      "FBA-RESET-4",
    ]);
    expect(snapshot.coverage).toMatchObject({
      state: "partial",
      shipmentsWithCompleteItems: 1,
      incompleteShipmentCount: 3,
      itemCount: 1,
    });
    expect(snapshot.items).toHaveLength(1);
  });

  it("keeps a verified first item page but fences totals when by-shipment continuation appears", async () => {
    const transport = vi.fn(
      async (request: FbaInboundTransportRequest): Promise<FbaInboundTransportResult> =>
        request.kind === "shipments"
          ? result(
              { payload: { ShipmentData: [shipment("FBA-CONTINUED")] } },
              "LIST",
            )
          : result(
              {
                payload: {
                  ItemData: [item("FBA-CONTINUED", "SKU-1", 12, 10)],
                  NextToken: "NO-OFFICIAL-CONTINUATION-INPUT",
                },
              },
              "ITEM",
            ),
    );

    const snapshot = await collectFbaInboundShipmentSnapshot({
      ...BASE_INPUT,
      transport,
    });

    expect(snapshot.summary.totals).toBeNull();
    expect(snapshot.summary.verifiedTotals).toEqual({
      expectedUnits: 12,
      receivedUnits: 10,
      pendingUnits: 2,
      overReceivedUnits: 0,
    });
    expect(snapshot.shipments[0]).toMatchObject({
      itemCoverage: "partial",
      totals: null,
      verifiedTotals: {
        expectedUnits: 12,
        receivedUnits: 10,
        pendingUnits: 2,
        overReceivedUnits: 0,
      },
    });
    expect(snapshot.coverage.issues[0]).toMatchObject({
      code: "UNSUPPORTED_ITEM_CONTINUATION",
      completedItemPages: 1,
      requestId: "ITEM",
    });
  });

  it("checks AbortSignal before the first item follow-on request", async () => {
    const controller = new AbortController();
    const transport = vi.fn(
      async (request: FbaInboundTransportRequest): Promise<FbaInboundTransportResult> => {
        if (request.kind === "shipments") {
          controller.abort(new Error("stop-after-list"));
          return result(
            { payload: { ShipmentData: [shipment("FBA-ABORT")] } },
            "LIST",
          );
        }
        throw new Error("item request should not start");
      },
    );

    await expect(
      collectFbaInboundShipmentSnapshot({
        ...BASE_INPUT,
        transport,
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop-after-list");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("provides a same-schema demo snapshot with explicit over-received units", () => {
    const snapshot = buildDemoFbaInboundShipmentSnapshot({
      ...BASE_INPUT,
      now: new Date("2026-08-21T01:02:03.000Z"),
    });

    expect(snapshot.mode).toBe("demo");
    expect(snapshot.coverage.state).toBe("complete");
    expect(snapshot.summary.totals?.overReceivedUnits).toBe(1);
    expect(snapshot.items.some((row) => row.overReceivedUnits === 1)).toBe(true);
  });
});
