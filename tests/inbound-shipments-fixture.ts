export const US_MARKETPLACE_ID = "ATVPDKIKX0DER";

export function inboundShipmentSnapshotFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    mode: "live",
    marketplaceId: US_MARKETPLACE_ID,
    fetchedAt: "2026-08-21T08:00:00.000Z",
    shipmentListScope: "selected-date-range",
    dateRange: {
      startDate: "2026-05-24",
      endDate: "2026-08-21",
      lastUpdatedAfter: "2026-05-24T07:00:00.000Z",
      lastUpdatedBefore: "2026-08-22T07:00:00.000Z",
    },
    coverage: {
      state: "complete",
      shipmentsWithCompleteItems: 2,
      shipmentsWithPartialItems: 0,
      incompleteShipmentCount: 0,
      issues: [],
    },
    summary: {
      shipmentCount: 2,
      itemCount: 3,
      incompleteShipmentCount: 0,
      totals: {
        expectedUnits: 448,
        receivedUnits: 430,
        pendingUnits: 20,
        overReceivedUnits: 2,
      },
      verifiedTotals: {
        expectedUnits: 448,
        receivedUnits: 430,
        pendingUnits: 20,
        overReceivedUnits: 2,
      },
    },
    shipments: [
      {
        shipmentId: "FBA15TEST0001",
        shipmentName: null,
        status: "RECEIVING",
        destinationFulfillmentCenterId: null,
        labelPrepType: null,
        boxContentsSource: null,
        itemCoverage: "complete",
        itemCount: 2,
        totals: {
          expectedUnits: 348,
          receivedUnits: 328,
          pendingUnits: 20,
          overReceivedUnits: 0,
        },
        verifiedTotals: {
          expectedUnits: 348,
          receivedUnits: 328,
          pendingUnits: 20,
          overReceivedUnits: 0,
        },
      },
      {
        shipmentId: "FBA15TEST0002",
        shipmentName: "August closed shipment",
        status: "CLOSED",
        destinationFulfillmentCenterId: "ONT8",
        labelPrepType: "SELLER_LABEL",
        boxContentsSource: "FEED",
        itemCoverage: "complete",
        itemCount: 1,
        totals: {
          expectedUnits: 100,
          receivedUnits: 102,
          pendingUnits: 0,
          overReceivedUnits: 2,
        },
        verifiedTotals: {
          expectedUnits: 100,
          receivedUnits: 102,
          pendingUnits: 0,
          overReceivedUnits: 2,
        },
      },
    ],
    items: [
      {
        shipmentId: "FBA15TEST0001",
        sellerSku: "TEST-SKU-001",
        fulfillmentNetworkSku: null,
        asin: null,
        title: null,
        quantityInCase: null,
        expectedUnits: 48,
        receivedUnits: 48,
        pendingUnits: 0,
        overReceivedUnits: 0,
      },
      {
        shipmentId: "FBA15TEST0001",
        sellerSku: "TEST-SKU-002",
        fulfillmentNetworkSku: "B000TEST02",
        asin: "B000TEST02",
        title: "Example Dog Treats",
        quantityInCase: 12,
        expectedUnits: 300,
        receivedUnits: 280,
        pendingUnits: 20,
        overReceivedUnits: 0,
      },
      {
        shipmentId: "FBA15TEST0002",
        sellerSku: "=FORMULA-SAFE",
        fulfillmentNetworkSku: "B000000001",
        asin: "B000000001",
        title: "+Formula-like title",
        quantityInCase: null,
        expectedUnits: 100,
        receivedUnits: 102,
        pendingUnits: 0,
        overReceivedUnits: 2,
      },
    ],
    issueReport: {
      state: "partial",
      fetchedAt: "2026-08-21T07:55:00.000Z",
      dataThrough: null,
      excludedShipmentCount: 2,
      notice: "Amazon 每日報表已讀取，但部分欄位未完成。",
      shipment: [],
      carton: [],
      product: [
        {
          level: "product",
          shipmentId: "FBA15TEST0001",
          sellerSku: "TEST-SKU-002",
          fnsku: "B000TEST02",
          asin: "B000TEST02",
          productName: "Example Dog Treats",
          cartonId: null,
          problemType: "Barcode cannot be scanned",
          problemQuantity: 1,
          expectedUnits: 300,
          receivedUnits: 280,
          reportedAt: "2026-08-20T00:00:00.000Z",
          alertStatus: "OPEN",
          notice: "每日問題報表列，可能落後即時狀態。",
        },
      ],
    },
    notice: "全部貨件商品列已完成；每日問題報表部分完成。",
  };
}

export function inboundShipmentJobFixture(input: {
  state?: "running" | "completed" | "partial" | "failed";
  snapshot?: Record<string, unknown> | null;
} = {}): Record<string, unknown> {
  const state = input.state ?? "partial";
  return {
    jobId: "inbound-job-12345678",
    marketplaceId: US_MARKETPLACE_ID,
    dateRange: { startDate: "2026-05-24", endDate: "2026-08-21" },
    state,
    progress: {
      phase: state === "running" ? "items" : "issues",
      completed: state === "running" ? 1 : 2,
      total: 2,
    },
    snapshot: input.snapshot === undefined
      ? (state === "running" || state === "failed" ? null : inboundShipmentSnapshotFixture())
      : input.snapshot,
    notice: state === "running" ? "正在讀取全部貨件商品。" : "同步已收斂。",
  };
}

export function completedInboundShipmentJobFixture(): Record<string, unknown> {
  const snapshot = inboundShipmentSnapshotFixture();
  (snapshot.issueReport as Record<string, unknown>).state = "completed";
  (snapshot.issueReport as Record<string, unknown>).notice = "Amazon 每日報表已完成讀取。";
  return inboundShipmentJobFixture({ state: "completed", snapshot });
}
