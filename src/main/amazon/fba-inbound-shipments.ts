import { throwIfAborted } from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";

const MAX_SHIPMENT_PAGES = 200;
const MAX_ITEM_PAGES_PER_SHIPMENT = 200;
const MAX_SHIPMENTS = 10_000;
const MAX_ITEMS = 250_000;
const MAX_NEXT_TOKEN_LENGTH = 4_096;
const MAX_CONSECUTIVE_ITEM_FAILURES = 3;
const UNSAFE_IDENTIFIER =
  /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

const SHIPMENT_STATUSES = new Set([
  "WORKING",
  "READY_TO_SHIP",
  "SHIPPED",
  "RECEIVING",
  "CANCELLED",
  "DELETED",
  "CLOSED",
  "ERROR",
  "IN_TRANSIT",
  "DELIVERED",
  "CHECKED_IN",
]);
const LABEL_PREP_TYPES = new Set([
  "NO_LABEL",
  "SELLER_LABEL",
  "AMAZON_LABEL",
]);
const BOX_CONTENTS_SOURCES = new Set([
  "NONE",
  "FEED",
  "2D_BARCODE",
  "INTERACTIVE",
]);

export type FbaInboundUnitTotals = {
  expectedUnits: number;
  receivedUnits: number;
  pendingUnits: number;
  overReceivedUnits: number;
};

export type FbaInboundShipmentItem = FbaInboundUnitTotals & {
  shipmentId: string;
  sellerSku: string;
  fulfillmentNetworkSku: string | null;
  asin: string | null;
  title: string | null;
  quantityInCase: number | null;
};

export type FbaInboundShipmentRow = {
  shipmentId: string;
  shipmentName: string | null;
  status: string | null;
  destinationFulfillmentCenterId: string | null;
  labelPrepType: string | null;
  boxContentsSource: string | null;
  itemCoverage: "complete" | "partial";
  itemCount: number;
  totals: FbaInboundUnitTotals | null;
  verifiedTotals: FbaInboundUnitTotals;
};

export type FbaInboundCoverageIssue = {
  stage: "shipments" | "items";
  shipmentId: string | null;
  code: string;
  message: string;
  requestId: string | null;
  completedItemPages: number;
};

export type FbaInboundShipmentSnapshot = {
  schemaVersion: 1;
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  dateRange: {
    startDate: string;
    endDate: string;
    lastUpdatedAfter: string;
    lastUpdatedBefore: string;
  };
  fetchedAt: string;
  shipmentListScope:
    | "selected-date-range"
    | "active-status-fallback"
    | "modern-plan-range";
  dataSource: {
    shipmentList:
      | "GET /fba/inbound/v0/shipments"
      | "GET /fba/inbound/v0/shipments?QueryType=SHIPMENT (active-status fallback)"
      | "GET /inbound/fba/2024-03-20/inboundPlans + getInboundPlan/getShipment";
    shipmentItems:
      "GET /fba/inbound/v0/shipments/{shipmentId}/items + GET /fba/inbound/v0/shipmentItems?QueryType=NEXT_TOKEN";
    startedAt: string;
    completedAt: string;
  };
  coverage: {
    state: "complete" | "partial";
    shipmentPages: number;
    itemPages: number;
    shipmentCount: number;
    shipmentsWithCompleteItems: number;
    shipmentsWithPartialItems: number;
    incompleteShipmentCount: number;
    itemCount: number;
    issues: FbaInboundCoverageIssue[];
  };
  summary: {
    shipmentCount: number;
    itemCount: number;
    incompleteShipmentCount: number;
    totals: FbaInboundUnitTotals | null;
    verifiedTotals: FbaInboundUnitTotals;
  };
  shipments: FbaInboundShipmentRow[];
  items: FbaInboundShipmentItem[];
  notice: string;
};

export type FbaInboundProgress = {
  phase: "shipments" | "items";
  completed: number;
  total: number | null;
};

export type FbaInboundTransportRequest =
  | {
      kind: "shipments";
      marketplaceId: MarketplaceId;
      queryType: "DATE_RANGE";
      lastUpdatedAfter: string;
      lastUpdatedBefore: string;
      nextToken: null;
    }
  | {
      kind: "shipments";
      marketplaceId: MarketplaceId;
      queryType: "SHIPMENT";
      shipmentStatuses: readonly string[];
      lastUpdatedAfter: null;
      lastUpdatedBefore: null;
      nextToken: null;
    }
  | {
      kind: "shipments";
      marketplaceId: MarketplaceId;
      queryType: "NEXT_TOKEN";
      lastUpdatedAfter: null;
      lastUpdatedBefore: null;
      nextToken: string;
    }
  | {
      kind: "items";
      marketplaceId: MarketplaceId;
      shipmentId: string;
      queryType: "SHIPMENT";
      nextToken: null;
    }
  | {
      kind: "items";
      marketplaceId: MarketplaceId;
      shipmentId: string;
      queryType: "NEXT_TOKEN";
      nextToken: string;
    };

export type FbaInboundTransportResult = {
  payload: unknown;
  requestId: string | null;
};

export class FbaInboundSnapshotError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      requestId?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "FbaInboundSnapshotError";
    this.status = options.status ?? 502;
    this.code = options.code ?? "FBA_INBOUND_FORMAT_UNSUPPORTED";
    this.requestId = options.requestId ?? null;
  }
}

type CollectorInput = {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  lastUpdatedAfter: string;
  lastUpdatedBefore: string;
  transport: (
    request: FbaInboundTransportRequest,
  ) => Promise<FbaInboundTransportResult>;
  signal?: AbortSignal;
  onProgress?: (progress: FbaInboundProgress) => void;
  now?: () => Date;
  shipmentListSource?: FbaInboundShipmentSnapshot["dataSource"]["shipmentList"];
};

type ParsedShipment = Omit<
  FbaInboundShipmentRow,
  "itemCoverage" | "itemCount" | "totals" | "verifiedTotals"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactString(
  value: unknown,
  maximumLength: number,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximumLength ||
    value !== value.trim() ||
    UNSAFE_IDENTIFIER.test(value)
  ) {
    throw new FbaInboundSnapshotError(
      `Amazon FBA 入庫資料含有無法原樣辨識的${label}。`,
    );
  }
  return value;
}

function optionalExactString(
  value: unknown,
  maximumLength: number,
  label: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return exactString(value, maximumLength, label);
}

function exactIdentifier(
  value: unknown,
  maximumLength: number,
  label: string,
): string {
  const parsed = exactString(value, maximumLength, label);
  if (!SAFE_IDENTIFIER.test(parsed)) {
    throw new FbaInboundSnapshotError(
      `Amazon FBA 入庫資料含有無法原樣辨識的${label}。`,
    );
  }
  return parsed;
}

function optionalExactIdentifier(
  value: unknown,
  maximumLength: number,
  label: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return exactIdentifier(value, maximumLength, label);
}

function enumOrNull(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = exactString(value, 64, label);
  if (!allowed.has(parsed)) {
    throw new FbaInboundSnapshotError(
      `Amazon FBA 入庫資料回傳了無法辨識的${label}。`,
    );
  }
  return parsed;
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FbaInboundSnapshotError(
      `Amazon FBA 入庫資料的${label}不是安全的非負整數。`,
    );
  }
  return value as number;
}

function optionalSafeNonNegativeInteger(
  value: unknown,
  label: string,
): number | null {
  if (value === undefined || value === null) return null;
  return safeNonNegativeInteger(value, label);
}

function safeAdd(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new FbaInboundSnapshotError(
      `Amazon FBA 入庫資料的${label}加總超過安全上限。`,
    );
  }
  return total;
}

function emptyTotals(): FbaInboundUnitTotals {
  return {
    expectedUnits: 0,
    receivedUnits: 0,
    pendingUnits: 0,
    overReceivedUnits: 0,
  };
}

function addTotals(
  totals: FbaInboundUnitTotals,
  item: Pick<FbaInboundShipmentItem, "expectedUnits" | "receivedUnits">,
): void {
  totals.expectedUnits = safeAdd(
    totals.expectedUnits,
    item.expectedUnits,
    "預期單位",
  );
  totals.receivedUnits = safeAdd(
    totals.receivedUnits,
    item.receivedUnits,
    "已接收單位",
  );
  totals.pendingUnits = safeAdd(
    totals.pendingUnits,
    Math.max(item.expectedUnits - item.receivedUnits, 0),
    "尚未接收單位",
  );
  totals.overReceivedUnits = safeAdd(
    totals.overReceivedUnits,
    Math.max(item.receivedUnits - item.expectedUnits, 0),
    "超收單位",
  );
}

function parseNextToken(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return exactString(value, MAX_NEXT_TOKEN_LENGTH, "分頁 nextToken");
}

function parseShipmentsPage(value: unknown): {
  shipments: ParsedShipment[];
  nextToken: string | null;
} {
  if (!isRecord(value) || !isRecord(value.payload)) {
    throw new FbaInboundSnapshotError(
      "Amazon 回傳了無法辨識的 FBA 入庫貨件清單。",
    );
  }
  const rows = value.payload.ShipmentData;
  if (!Array.isArray(rows)) {
    throw new FbaInboundSnapshotError(
      "Amazon FBA 入庫貨件清單缺少 ShipmentData。",
    );
  }
  const shipments = rows.map((row): ParsedShipment => {
    if (!isRecord(row)) {
      throw new FbaInboundSnapshotError(
        "Amazon FBA 入庫貨件清單含有無法辨識的資料列。",
      );
    }
    return {
      shipmentId: exactIdentifier(row.ShipmentId, 64, "Shipment ID"),
      shipmentName: optionalExactString(row.ShipmentName, 256, "貨件名稱"),
      status: enumOrNull(row.ShipmentStatus, SHIPMENT_STATUSES, "貨件狀態"),
      destinationFulfillmentCenterId: optionalExactIdentifier(
        row.DestinationFulfillmentCenterId,
        64,
        "目的地 FC ID",
      ),
      labelPrepType: enumOrNull(row.LabelPrepType, LABEL_PREP_TYPES, "標籤類型"),
      boxContentsSource: enumOrNull(
        row.BoxContentsSource,
        BOX_CONTENTS_SOURCES,
        "箱內資訊來源",
      ),
    };
  });
  return {
    shipments,
    nextToken: parseNextToken(value.payload.NextToken),
  };
}

function parseItemsPage(
  value: unknown,
  expectedShipmentId: string,
): { items: FbaInboundShipmentItem[]; nextToken: string | null } {
  if (!isRecord(value) || !isRecord(value.payload)) {
    throw new FbaInboundSnapshotError(
      "Amazon 回傳了無法辨識的 FBA 入庫商品明細。",
    );
  }
  const rows = value.payload.ItemData;
  if (!Array.isArray(rows)) {
    throw new FbaInboundSnapshotError(
      "Amazon FBA 入庫商品明細缺少 ItemData。",
    );
  }
  const items = rows.map((row): FbaInboundShipmentItem => {
    if (!isRecord(row)) {
      throw new FbaInboundSnapshotError(
        "Amazon FBA 入庫商品明細含有無法辨識的資料列。",
      );
    }
    const returnedShipmentId = optionalExactIdentifier(
      row.ShipmentId,
      64,
      "Shipment ID",
    );
    // ShipmentId is optional in Amazon's InboundShipmentItem model. A missing
    // value remains tied to the exact by-shipment request through its opaque
    // continuation token; any value Amazon does return must still match.
    if (returnedShipmentId !== null && returnedShipmentId !== expectedShipmentId) {
      throw new FbaInboundSnapshotError(
        "Amazon FBA 入庫商品明細回傳了不同的 Shipment ID。",
        { status: 409, code: "PAGINATION_CHANGED" },
      );
    }
    const sellerSku = exactString(row.SellerSKU, 40, "Seller SKU");
    const fulfillmentNetworkSku = optionalExactIdentifier(
      row.FulfillmentNetworkSKU,
      64,
      "FNSKU",
    );
    const expectedUnits = safeNonNegativeInteger(
      row.QuantityShipped,
      "預期單位數量",
    );
    const receivedUnits = safeNonNegativeInteger(
      row.QuantityReceived,
      "已接收單位數量",
    );
    return {
      shipmentId: expectedShipmentId,
      sellerSku,
      fulfillmentNetworkSku,
      asin: null,
      title: null,
      expectedUnits,
      receivedUnits,
      quantityInCase: optionalSafeNonNegativeInteger(
        row.QuantityInCase,
        "每箱單位數量",
      ),
      pendingUnits: Math.max(expectedUnits - receivedUnits, 0),
      overReceivedUnits: Math.max(receivedUnits - expectedUnits, 0),
    };
  });
  return {
    items,
    nextToken: parseNextToken(value.payload.NextToken),
  };
}

function issueFromError(
  error: unknown,
  shipmentId: string,
  completedItemPages = 0,
): FbaInboundCoverageIssue {
  const record = isRecord(error) ? error : null;
  const rawCode = record?.code;
  const rawRequestId = record?.requestId;
  const message = rawCode === "PAGINATION_CHANGED"
    ? "Amazon FBA 入庫商品明細分頁格式已改變；此貨件未計入完整總量。"
    : rawCode === "FBA_INBOUND_FORMAT_UNSUPPORTED"
      ? "Amazon FBA 入庫商品明細格式無法辨識；此貨件未計入完整總量。"
      : "Amazon FBA 入庫商品明細暫時無法完成；此貨件未計入完整總量。";
  return {
    stage: "items",
    shipmentId,
    code:
      typeof rawCode === "string" &&
      /^[A-Z][A-Z0-9_]{0,127}$/u.test(rawCode)
        ? rawCode
        : "FBA_INBOUND_ITEMS_INCOMPLETE",
    message,
    requestId:
      typeof rawRequestId === "string" &&
      rawRequestId.length <= 200 &&
      SAFE_IDENTIFIER.test(rawRequestId)
        ? rawRequestId
        : null,
    completedItemPages,
  };
}

function isShipmentLocalItemFailure(error: unknown): boolean {
  if (error instanceof FbaInboundSnapshotError) {
    return error.code === "FBA_INBOUND_FORMAT_UNSUPPORTED" ||
      error.code === "PAGINATION_CHANGED" ||
      error.code === "PAGINATION_LIMIT_EXCEEDED";
  }
  if (!(error instanceof Error) || !isRecord(error)) return false;
  // These non-retryable statuses came from the exact by-shipment item path and
  // can be isolated to that shipment. Authentication, throttling, service,
  // credential, timeout, network and unknown failures must stop the scan so a
  // global outage cannot fan out across every shipment.
  return [400, 404, 409, 422].includes(error.status as number) &&
    typeof error.code === "string" &&
    error.code.startsWith("FBA_INBOUND_");
}

function assertSafeCount(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new FbaInboundSnapshotError(
      `Amazon FBA 入庫${label}超過安全讀取上限。`,
      { status: 409, code: "PAGINATION_LIMIT_EXCEEDED" },
    );
  }
}

export async function collectFbaInboundShipmentSnapshot(
  input: CollectorInput,
): Promise<FbaInboundShipmentSnapshot> {
  throwIfAborted(input.signal);
  const startedAt = (input.now?.() ?? new Date()).toISOString();
  const shipments: ParsedShipment[] = [];
  const shipmentIds = new Set<string>();
  const seenTokens = new Set<string>();
  let nextToken: string | null = null;
  let shipmentPages = 0;

  for (let pageIndex = 0; pageIndex < MAX_SHIPMENT_PAGES; pageIndex += 1) {
    throwIfAborted(input.signal);
    const result = await input.transport(
      nextToken
        ? {
            kind: "shipments",
            marketplaceId: input.marketplaceId,
            queryType: "NEXT_TOKEN",
            lastUpdatedAfter: null,
            lastUpdatedBefore: null,
            nextToken,
          }
        : {
            kind: "shipments",
            marketplaceId: input.marketplaceId,
            queryType: "DATE_RANGE",
            lastUpdatedAfter: input.lastUpdatedAfter,
            lastUpdatedBefore: input.lastUpdatedBefore,
            nextToken: null,
          },
    );
    throwIfAborted(input.signal);
    const parsed = parseShipmentsPage(result.payload);
    shipmentPages += 1;
    for (const shipment of parsed.shipments) {
      if (shipmentIds.has(shipment.shipmentId)) {
        throw new FbaInboundSnapshotError(
          "Amazon FBA 入庫分頁重複回傳同一 Shipment ID，已停止同步。",
          {
            status: 409,
            code: "PAGINATION_CHANGED",
            requestId: result.requestId,
          },
        );
      }
      shipmentIds.add(shipment.shipmentId);
      shipments.push(shipment);
      assertSafeCount(shipments.length, MAX_SHIPMENTS, "貨件數");
    }
    input.onProgress?.({
      phase: "shipments",
      completed: shipmentPages,
      total: null,
    });
    nextToken = parsed.nextToken;
    if (!nextToken) break;
    if (parsed.shipments.length === 0 || seenTokens.has(nextToken)) {
      throw new FbaInboundSnapshotError(
        "Amazon FBA 入庫貨件分頁 nextToken 重複或沒有前進，已停止同步。",
        {
          status: 409,
          code: "PAGINATION_CHANGED",
          requestId: result.requestId,
        },
      );
    }
    seenTokens.add(nextToken);
  }
  if (nextToken) {
    throw new FbaInboundSnapshotError(
      "Amazon FBA 入庫貨件分頁超過安全上限，無法證明已完整讀取。",
      { status: 409, code: "PAGINATION_LIMIT_EXCEEDED" },
    );
  }
  input.onProgress?.({
    phase: "shipments",
    completed: shipments.length,
    total: shipments.length,
  });

  const rows: FbaInboundShipmentRow[] = [];
  const items: FbaInboundShipmentItem[] = [];
  const issues: FbaInboundCoverageIssue[] = [];
  const verifiedTotals = emptyTotals();
  let itemPages = 0;
  let completeShipments = 0;
  let consecutiveItemFailures = 0;
  let itemScanStopped = false;

  for (const [shipmentIndex, shipment] of shipments.entries()) {
    throwIfAborted(input.signal);
    let parsedItems: FbaInboundShipmentItem[] = [];
    let itemCoverage: "complete" | "partial" = "complete";
    let issue: FbaInboundCoverageIssue | null = null;
    let completedShipmentItemPages = 0;
    try {
      const seenItemKeys = new Set<string>();
      const seenItemTokens = new Set<string>();
      let itemNextToken: string | null = null;
      for (
        let itemPageIndex = 0;
        itemPageIndex < MAX_ITEM_PAGES_PER_SHIPMENT;
        itemPageIndex += 1
      ) {
        throwIfAborted(input.signal);
        const result = await input.transport(
          itemNextToken
            ? {
                kind: "items",
                marketplaceId: input.marketplaceId,
                shipmentId: shipment.shipmentId,
                queryType: "NEXT_TOKEN",
                nextToken: itemNextToken,
              }
            : {
                kind: "items",
                marketplaceId: input.marketplaceId,
                shipmentId: shipment.shipmentId,
                queryType: "SHIPMENT",
                nextToken: null,
              },
        );
        throwIfAborted(input.signal);
        const parsed = parseItemsPage(result.payload, shipment.shipmentId);
        for (const item of parsed.items) {
          const itemKey = `${item.sellerSku}\u0000${
            item.fulfillmentNetworkSku ?? ""
          }`;
          if (seenItemKeys.has(itemKey)) {
            throw new FbaInboundSnapshotError(
              "Amazon FBA 入庫商品明細分頁重複回傳同一 SKU，已停止該貨件加總。",
              {
                status: 409,
                code: "PAGINATION_CHANGED",
                requestId: result.requestId,
              },
            );
          }
          seenItemKeys.add(itemKey);
          assertSafeCount(
            items.length + parsedItems.length + 1,
            MAX_ITEMS,
            "商品列數",
          );
          parsedItems.push(item);
        }
        completedShipmentItemPages += 1;
        itemPages += 1;
        itemNextToken = parsed.nextToken;
        if (!itemNextToken) break;
        if (parsed.items.length === 0 || seenItemTokens.has(itemNextToken)) {
          throw new FbaInboundSnapshotError(
            "Amazon FBA 入庫商品明細分頁 nextToken 重複或沒有前進，已停止該貨件加總。",
            {
              status: 409,
              code: "PAGINATION_CHANGED",
              requestId: result.requestId,
            },
          );
        }
        seenItemTokens.add(itemNextToken);
      }
      if (itemNextToken) {
        throw new FbaInboundSnapshotError(
          "Amazon FBA 入庫商品明細分頁超過安全上限，已停止該貨件加總。",
          { status: 409, code: "PAGINATION_LIMIT_EXCEEDED" },
        );
      }
      consecutiveItemFailures = 0;
    } catch (error) {
      throwIfAborted(input.signal);
      if (!isShipmentLocalItemFailure(error)) throw error;
      itemCoverage = "partial";
      issue = issueFromError(
        error,
        shipment.shipmentId,
        completedShipmentItemPages,
      );
      consecutiveItemFailures += 1;
    }
    if (issue) issues.push(issue);
    if (itemCoverage === "complete") completeShipments += 1;

    const shipmentVerifiedTotals = emptyTotals();
    for (const item of parsedItems) {
      items.push(item);
      assertSafeCount(items.length, MAX_ITEMS, "商品列數");
      addTotals(shipmentVerifiedTotals, item);
      addTotals(verifiedTotals, item);
    }
    rows.push({
      ...shipment,
      itemCoverage,
      itemCount: parsedItems.length,
      totals: itemCoverage === "complete" ? { ...shipmentVerifiedTotals } : null,
      verifiedTotals: shipmentVerifiedTotals,
    });
    input.onProgress?.({
      phase: "items",
      completed: shipmentIndex + 1,
      total: shipments.length,
    });
    if (consecutiveItemFailures >= MAX_CONSECUTIVE_ITEM_FAILURES) {
      itemScanStopped = true;
      for (const remaining of shipments.slice(shipmentIndex + 1)) {
        issues.push({
          stage: "items",
          shipmentId: remaining.shipmentId,
          code: "FBA_INBOUND_SCAN_STOPPED",
          message:
            "Amazon FBA 入庫商品明細已連續三票異常；這一票未再發出請求，未讀內容保持未知。",
          requestId: null,
          completedItemPages: 0,
        });
        rows.push({
          ...remaining,
          itemCoverage: "partial",
          itemCount: 0,
          totals: null,
          verifiedTotals: emptyTotals(),
        });
      }
      input.onProgress?.({
        phase: "items",
        completed: shipments.length,
        total: shipments.length,
      });
      break;
    }
  }

  const incompleteShipmentCount = shipments.length - completeShipments;
  const state = incompleteShipmentCount === 0 ? "complete" : "partial";
  const completedAt = (input.now?.() ?? new Date()).toISOString();
  const snapshot: FbaInboundShipmentSnapshot = {
    schemaVersion: 1,
    mode: "live",
    marketplaceId: input.marketplaceId,
    dateRange: {
      startDate: input.startDate,
      endDate: input.endDate,
      lastUpdatedAfter: input.lastUpdatedAfter,
      lastUpdatedBefore: input.lastUpdatedBefore,
    },
    fetchedAt: completedAt,
    shipmentListScope:
      input.shipmentListSource ===
      "GET /fba/inbound/v0/shipments?QueryType=SHIPMENT (active-status fallback)"
        ? "active-status-fallback"
        : input.shipmentListSource ===
            "GET /inbound/fba/2024-03-20/inboundPlans + getInboundPlan/getShipment"
          ? "modern-plan-range"
          : "selected-date-range",
    dataSource: {
      shipmentList:
        input.shipmentListSource ?? "GET /fba/inbound/v0/shipments",
      shipmentItems:
        "GET /fba/inbound/v0/shipments/{shipmentId}/items + GET /fba/inbound/v0/shipmentItems?QueryType=NEXT_TOKEN",
      startedAt,
      completedAt,
    },
    coverage: {
      state,
      shipmentPages,
      itemPages,
      shipmentCount: rows.length,
      shipmentsWithCompleteItems: completeShipments,
      shipmentsWithPartialItems: incompleteShipmentCount,
      incompleteShipmentCount,
      itemCount: items.length,
      issues,
    },
    summary: {
      shipmentCount: rows.length,
      itemCount: items.length,
      incompleteShipmentCount,
      totals: state === "complete" ? { ...verifiedTotals } : null,
      verifiedTotals,
    },
    shipments: rows,
    items,
    notice: `${
      input.shipmentListSource ===
      "GET /inbound/fba/2024-03-20/inboundPlans + getInboundPlan/getShipment"
        ? "Amazon 拒絕舊版貨件日期清單後，已自動改用 2024 新版入庫計畫最後更新時間篩選；逐貨件接收數量仍取自官方 QuantityReceived。"
        : input.shipmentListSource ===
            "GET /fba/inbound/v0/shipments?QueryType=SHIPMENT (active-status fallback)"
          ? "Amazon 拒絕舊版日期清單後，已改讀目前尚未關閉／需注意的貨件；這個備援範圍不受上方日期限制，已關閉、取消或刪除貨件可能未列入。逐貨件接收數量仍取自官方 QuantityReceived。"
        : ""
    }${
      state === "complete"
        ? input.shipmentListSource &&
            input.shipmentListSource !== "GET /fba/inbound/v0/shipments"
          ? "Fulfillment Inbound API 已完整讀取備援清單內每票貨件的全部商品分頁；貨件清單本身仍不是上方所選日期範圍的完整證據。數量只代表 Amazon 目前回傳的送出與已接收快照。"
          : "Fulfillment Inbound API 已完整讀取所選更新區間的貨件與逐貨件商品明細；數量只代表 Amazon 目前回傳的送出與已接收快照。"
        : `Fulfillment Inbound API 有 ${incompleteShipmentCount} 個貨件明細未完成；verifiedTotals 只加總已安全讀到的資料列，不能當作整個區間總量。${
            itemScanStopped
              ? " 因商品明細連續三票異常，後續貨件未再發出請求並保持未知。"
              : ""
          }`
    }`,
  };
  return snapshot;
}

export function buildDemoFbaInboundShipmentSnapshot(input: {
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  lastUpdatedAfter: string;
  lastUpdatedBefore: string;
  now?: Date;
}): FbaInboundShipmentSnapshot {
  const fetchedAt = (input.now ?? new Date()).toISOString();
  const shipmentA = "FBADEMO0001";
  const shipmentB = "FBADEMO0002";
  const items: FbaInboundShipmentItem[] = [
    {
      shipmentId: shipmentA,
      sellerSku: "DEMO-FBA-01",
      fulfillmentNetworkSku: "X00DEMO001",
      asin: null,
      title: null,
      expectedUnits: 48,
      receivedUnits: 48,
      quantityInCase: 12,
      pendingUnits: 0,
      overReceivedUnits: 0,
    },
    {
      shipmentId: shipmentA,
      sellerSku: "DEMO-FBA-02",
      fulfillmentNetworkSku: "X00DEMO002",
      asin: null,
      title: null,
      expectedUnits: 120,
      receivedUnits: 118,
      quantityInCase: 24,
      pendingUnits: 2,
      overReceivedUnits: 0,
    },
    {
      shipmentId: shipmentB,
      sellerSku: "DEMO-FBA-03",
      fulfillmentNetworkSku: "X00DEMO003",
      asin: null,
      title: null,
      expectedUnits: 60,
      receivedUnits: 61,
      quantityInCase: 12,
      pendingUnits: 0,
      overReceivedUnits: 1,
    },
  ];
  const totalsFor = (shipmentId: string): FbaInboundUnitTotals => {
    const totals = emptyTotals();
    for (const item of items.filter((row) => row.shipmentId === shipmentId)) {
      addTotals(totals, item);
    }
    return totals;
  };
  const firstTotals = totalsFor(shipmentA);
  const secondTotals = totalsFor(shipmentB);
  const totals = emptyTotals();
  for (const item of items) addTotals(totals, item);
  const shipments: FbaInboundShipmentRow[] = [
    {
      shipmentId: shipmentA,
      shipmentName: "展示貨件：接收中",
      status: "RECEIVING",
      destinationFulfillmentCenterId: "DEMO1",
      labelPrepType: "SELLER_LABEL",
      boxContentsSource: "FEED",
      itemCoverage: "complete",
      itemCount: 2,
      totals: firstTotals,
      verifiedTotals: { ...firstTotals },
    },
    {
      shipmentId: shipmentB,
      shipmentName: "展示貨件：已關閉",
      status: "CLOSED",
      destinationFulfillmentCenterId: "DEMO2",
      labelPrepType: "SELLER_LABEL",
      boxContentsSource: "FEED",
      itemCoverage: "complete",
      itemCount: 1,
      totals: secondTotals,
      verifiedTotals: { ...secondTotals },
    },
  ];
  return {
    schemaVersion: 1,
    mode: "demo",
    marketplaceId: input.marketplaceId,
    dateRange: {
      startDate: input.startDate,
      endDate: input.endDate,
      lastUpdatedAfter: input.lastUpdatedAfter,
      lastUpdatedBefore: input.lastUpdatedBefore,
    },
    fetchedAt,
    shipmentListScope: "selected-date-range",
    dataSource: {
      shipmentList: "GET /fba/inbound/v0/shipments",
      shipmentItems:
        "GET /fba/inbound/v0/shipments/{shipmentId}/items + GET /fba/inbound/v0/shipmentItems?QueryType=NEXT_TOKEN",
      startedAt: fetchedAt,
      completedAt: fetchedAt,
    },
    coverage: {
      state: "complete",
      shipmentPages: 1,
      itemPages: 2,
      shipmentCount: 2,
      shipmentsWithCompleteItems: 2,
      shipmentsWithPartialItems: 0,
      incompleteShipmentCount: 0,
      itemCount: items.length,
      issues: [],
    },
    summary: {
      shipmentCount: 2,
      itemCount: items.length,
      incompleteShipmentCount: 0,
      totals,
      verifiedTotals: { ...totals },
    },
    shipments,
    items,
    notice:
      "目前顯示展示用 FBA 入庫貨件；包含一筆暫時少收與一筆超收，用來驗證版面，不代表 Amazon 真實資料。",
  };
}
