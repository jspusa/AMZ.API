import { describe, expect, it, vi } from "vitest";
import {
  collectModernFbaInboundShipmentList,
  type ModernFbaInboundTransportRequest,
  type ModernFbaInboundTransportResult,
} from "../src/main/amazon/fba-inbound-modern";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const PLAN_ID = "wf1234abcd-1234-abcd-5678-1234abcd5678";
const SHIPMENT_ID = "sh1234abcd-1234-abcd-5678-1234abcd5678";

function result(
  payload: unknown,
  requestId: string,
): ModernFbaInboundTransportResult {
  return { payload, requestId };
}

describe("modern FBA inbound shipment-list fallback", () => {
  it("filters exact marketplace plan updates and returns only confirmation shipment IDs", async () => {
    const requests: ModernFbaInboundTransportRequest[] = [];
    const transport = vi.fn(async (request: ModernFbaInboundTransportRequest) => {
      requests.push(request);
      if (request.kind === "plans") {
        return result({
          inboundPlans: [
            {
              inboundPlanId: PLAN_ID,
              lastUpdatedAt: "2026-08-20T12:00:00Z",
              marketplaceIds: [MARKETPLACE_ID],
            },
          ],
        }, "PLANS");
      }
      if (request.kind === "plan") {
        return result({
          inboundPlanId: PLAN_ID,
          lastUpdatedAt: "2026-08-20T12:00:00Z",
          marketplaceIds: [MARKETPLACE_ID],
          shipments: [{ shipmentId: SHIPMENT_ID, status: "RECEIVING" }],
        }, "PLAN");
      }
      return result({
        inboundPlanId: PLAN_ID,
        shipmentId: SHIPMENT_ID,
        shipmentConfirmationId: "FBA19MODERN001",
        name: "Modern inbound shipment",
        status: "RECEIVING",
        destination: {
          destinationType: "AMAZON_WAREHOUSE",
          warehouseId: "ONT8",
        },
      }, "SHIPMENT");
    });

    const snapshotPage = await collectModernFbaInboundShipmentList({
      marketplaceId: MARKETPLACE_ID,
      startAt: "2026-08-01T07:00:00Z",
      endAt: "2026-08-22T07:00:00Z",
      transport,
    });

    expect(snapshotPage).toEqual({
      payload: {
        payload: {
          ShipmentData: [
            {
              ShipmentId: "FBA19MODERN001",
              ShipmentName: "Modern inbound shipment",
              ShipmentStatus: "RECEIVING",
              DestinationFulfillmentCenterId: "ONT8",
              LabelPrepType: null,
              BoxContentsSource: null,
            },
          ],
        },
      },
      requestId: "SHIPMENT",
    });
    expect(requests).toEqual([
      { kind: "plans", paginationToken: null },
      { kind: "plan", inboundPlanId: PLAN_ID },
      { kind: "shipment", inboundPlanId: PLAN_ID, shipmentId: SHIPMENT_ID },
    ]);
    expect(JSON.stringify(snapshotPage)).not.toContain(PLAN_ID);
    expect(JSON.stringify(snapshotPage)).not.toContain(SHIPMENT_ID);
  });

  it("does not open plan details for another marketplace or an out-of-range update", async () => {
    const transport = vi.fn(async (request: ModernFbaInboundTransportRequest) => {
      if (request.kind !== "plans") throw new Error("unexpected detail read");
      return result({
        inboundPlans: [
          {
            inboundPlanId: PLAN_ID,
            lastUpdatedAt: "2026-08-20T12:00:00Z",
            marketplaceIds: ["A2EUQ1WTGCTBG2"],
          },
          {
            inboundPlanId: "wf2234abcd-1234-abcd-5678-1234abcd5678",
            lastUpdatedAt: "2026-07-01T12:00:00Z",
            marketplaceIds: [MARKETPLACE_ID],
          },
        ],
        pagination: { nextToken: "OPAQUE+/=TOKEN" },
      }, "PLANS");
    });

    const page = await collectModernFbaInboundShipmentList({
      marketplaceId: MARKETPLACE_ID,
      startAt: "2026-08-01T07:00:00Z",
      endAt: "2026-08-22T07:00:00Z",
      transport,
    });

    expect(page.payload).toEqual({ payload: { ShipmentData: [] } });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("fails closed when plan identity changes between list and detail", async () => {
    const transport = vi.fn(async (request: ModernFbaInboundTransportRequest) => {
      if (request.kind === "plans") {
        return result({
          inboundPlans: [
            {
              inboundPlanId: PLAN_ID,
              lastUpdatedAt: "2026-08-20T12:00:00Z",
              marketplaceIds: [MARKETPLACE_ID],
            },
          ],
        }, "PLANS");
      }
      return result({
        inboundPlanId: PLAN_ID,
        lastUpdatedAt: "2026-08-21T12:00:00Z",
        marketplaceIds: [MARKETPLACE_ID],
        shipments: [],
      }, "CHANGED");
    });

    await expect(collectModernFbaInboundShipmentList({
      marketplaceId: MARKETPLACE_ID,
      startAt: "2026-08-01T07:00:00Z",
      endAt: "2026-08-22T07:00:00Z",
      transport,
    })).rejects.toMatchObject({
      status: 409,
      code: "PAGINATION_CHANGED",
      message: expect.stringContaining("分頁後發生變更"),
    });
  });
});
