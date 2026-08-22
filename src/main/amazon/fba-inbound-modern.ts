import { throwIfAborted } from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import { FbaInboundSnapshotError } from "./fba-inbound-shipments";

const MAX_PLAN_PAGES = 200;
const MAX_PLANS = 6_000;
const MAX_SHIPMENTS = 10_000;
const MAX_TOKEN_LENGTH = 1_024;
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SHIPMENT_STATUSES = new Set([
  "ABANDONED",
  "CANCELLED",
  "CHECKED_IN",
  "CLOSED",
  "DELETED",
  "DELIVERED",
  "ERROR",
  "IN_TRANSIT",
  "MIXED",
  "READY_TO_SHIP",
  "RECEIVING",
  "SHIPPED",
  "UNCONFIRMED",
  "WORKING",
]);

export type ModernFbaInboundTransportRequest =
  | { kind: "plans"; paginationToken: string | null }
  | { kind: "plan"; inboundPlanId: string }
  | { kind: "shipment"; inboundPlanId: string; shipmentId: string };

export type ModernFbaInboundTransportResult = {
  payload: unknown;
  requestId: string | null;
};

type ModernShipmentListInput = {
  marketplaceId: MarketplaceId;
  startAt: string;
  endAt: string;
  transport: (
    request: ModernFbaInboundTransportRequest,
  ) => Promise<ModernFbaInboundTransportResult>;
  signal?: AbortSignal;
  onProgress?: (completed: number) => void;
};

type PlanSummary = {
  inboundPlanId: string;
  lastUpdatedAt: string;
  lastUpdatedTime: number;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FbaInboundSnapshotError(
      `Amazon 新版 FBA 入庫資料缺少可辨識的${label}。`,
    );
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    UNSAFE_TEXT.test(value) ||
    !SAFE_ID.test(value)
  ) {
    throw new FbaInboundSnapshotError(
      `Amazon 新版 FBA 入庫資料含有無法原樣辨識的${label}。`,
    );
  }
  return value;
}

function optionalText(
  value: unknown,
  maximum: number,
  label: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value !== value.trim() ||
    UNSAFE_TEXT.test(value)
  ) {
    throw new FbaInboundSnapshotError(
      `Amazon 新版 FBA 入庫資料含有無法原樣辨識的${label}。`,
    );
  }
  return value;
}

function timestamp(value: unknown, label: string): { raw: string; time: number } {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > 64 ||
    UNSAFE_TEXT.test(value)
  ) {
    throw new FbaInboundSnapshotError(
      `Amazon 新版 FBA 入庫資料的${label}無法辨識。`,
    );
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new FbaInboundSnapshotError(
      `Amazon 新版 FBA 入庫資料的${label}無法辨識。`,
    );
  }
  return { raw: value, time };
}

function marketplaceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new FbaInboundSnapshotError(
      "Amazon 新版 FBA 入庫計畫缺少可核對的站點。",
    );
  }
  return value.map((entry) => identifier(entry, 20, "Marketplace ID"));
}

function nextToken(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return optionalText(value, MAX_TOKEN_LENGTH, "分頁 token");
}

function planPage(value: unknown): {
  plans: Array<PlanSummary & { marketplaceIds: string[] }>;
  nextToken: string | null;
} {
  const root = record(value, "計畫清單");
  if (!Array.isArray(root.inboundPlans)) {
    throw new FbaInboundSnapshotError(
      "Amazon 新版 FBA 入庫計畫清單缺少 inboundPlans。",
    );
  }
  const plans = root.inboundPlans.map((entry) => {
    const row = record(entry, "計畫列");
    const updated = timestamp(row.lastUpdatedAt, "計畫最後更新時間");
    return {
      inboundPlanId: identifier(row.inboundPlanId, 64, "Inbound Plan ID"),
      lastUpdatedAt: updated.raw,
      lastUpdatedTime: updated.time,
      marketplaceIds: marketplaceIds(row.marketplaceIds),
    };
  });
  const pagination = root.pagination === undefined || root.pagination === null
    ? null
    : record(root.pagination, "分頁資訊");
  return {
    plans,
    nextToken: nextToken(pagination?.nextToken),
  };
}

function planShipmentIds(
  value: unknown,
  expected: PlanSummary,
  marketplaceId: MarketplaceId,
): string[] {
  const plan = record(value, "計畫內容");
  const returnedPlanId = identifier(plan.inboundPlanId, 64, "Inbound Plan ID");
  const updated = timestamp(plan.lastUpdatedAt, "計畫最後更新時間");
  if (
    returnedPlanId !== expected.inboundPlanId ||
    updated.raw !== expected.lastUpdatedAt ||
    !marketplaceIds(plan.marketplaceIds).includes(marketplaceId)
  ) {
    throw new FbaInboundSnapshotError(
      "Amazon 新版 FBA 入庫計畫在分頁後發生變更，已停止同步。",
      { status: 409, code: "PAGINATION_CHANGED" },
    );
  }
  if (plan.shipments === undefined || plan.shipments === null) return [];
  if (!Array.isArray(plan.shipments)) {
    throw new FbaInboundSnapshotError(
      "Amazon 新版 FBA 入庫計畫的貨件清單無法辨識。",
    );
  }
  return plan.shipments.map((entry) => {
    const summary = record(entry, "貨件摘要");
    return identifier(summary.shipmentId, 64, "Shipment ID");
  });
}

function shipmentRow(
  value: unknown,
  expectedPlanId: string,
  expectedShipmentId: string,
): Record<string, unknown> {
  const shipment = record(value, "貨件內容");
  const returnedShipmentId = identifier(
    shipment.shipmentId,
    64,
    "Shipment ID",
  );
  const returnedPlanId = shipment.inboundPlanId === undefined
    ? expectedPlanId
    : identifier(shipment.inboundPlanId, 64, "Inbound Plan ID");
  if (
    returnedShipmentId !== expectedShipmentId ||
    returnedPlanId !== expectedPlanId
  ) {
    throw new FbaInboundSnapshotError(
      "Amazon 新版 FBA 入庫貨件回傳了不同識別碼，已停止同步。",
      { status: 409, code: "PAGINATION_CHANGED" },
    );
  }
  const confirmationId = identifier(
    shipment.shipmentConfirmationId,
    64,
    "Shipment Confirmation ID",
  );
  const status = shipment.status === undefined || shipment.status === null
    ? null
    : identifier(shipment.status, 64, "貨件狀態");
  if (status !== null && !SHIPMENT_STATUSES.has(status)) {
    throw new FbaInboundSnapshotError(
      "Amazon 新版 FBA 入庫貨件回傳了無法辨識的狀態。",
    );
  }
  const destination = shipment.destination === undefined || shipment.destination === null
    ? null
    : record(shipment.destination, "貨件目的地");
  return {
    ShipmentId: confirmationId,
    ShipmentName: optionalText(shipment.name, 256, "貨件名稱"),
    ShipmentStatus: status,
    DestinationFulfillmentCenterId:
      destination?.warehouseId === undefined
        ? null
        : identifier(destination.warehouseId, 64, "目的地 FC ID"),
    LabelPrepType: null,
    BoxContentsSource: null,
  };
}

export async function collectModernFbaInboundShipmentList(
  input: ModernShipmentListInput,
): Promise<ModernFbaInboundTransportResult> {
  throwIfAborted(input.signal);
  const startTime = Date.parse(input.startAt);
  const endTime = Date.parse(input.endAt);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new FbaInboundSnapshotError(
      "FBA 入庫新版備援日期範圍無法安全辨識。",
      { status: 400, code: "INVALID_FBA_INBOUND_RANGE" },
    );
  }

  const selectedPlans: PlanSummary[] = [];
  const seenPlanIds = new Set<string>();
  const seenTokens = new Set<string>();
  let paginationToken: string | null = null;
  let previousUpdatedTime = Number.POSITIVE_INFINITY;
  let lastRequestId: string | null = null;
  let pageCount = 0;

  for (let pageIndex = 0; pageIndex < MAX_PLAN_PAGES; pageIndex += 1) {
    throwIfAborted(input.signal);
    const result = await input.transport({ kind: "plans", paginationToken });
    throwIfAborted(input.signal);
    lastRequestId = result.requestId;
    const parsed = planPage(result.payload);
    pageCount += 1;
    let reachedBeforeRange = false;
    for (const plan of parsed.plans) {
      if (plan.lastUpdatedTime > previousUpdatedTime) {
        throw new FbaInboundSnapshotError(
          "Amazon 新版 FBA 入庫計畫分頁未依最後更新時間排序。",
          { status: 409, code: "PAGINATION_CHANGED", requestId: result.requestId },
        );
      }
      previousUpdatedTime = plan.lastUpdatedTime;
      if (seenPlanIds.has(plan.inboundPlanId)) {
        throw new FbaInboundSnapshotError(
          "Amazon 新版 FBA 入庫計畫分頁重複，已停止同步。",
          { status: 409, code: "PAGINATION_CHANGED", requestId: result.requestId },
        );
      }
      seenPlanIds.add(plan.inboundPlanId);
      if (seenPlanIds.size > MAX_PLANS) {
        throw new FbaInboundSnapshotError(
          "Amazon 新版 FBA 入庫計畫超過安全讀取上限。",
          { status: 409, code: "PAGINATION_LIMIT_EXCEEDED" },
        );
      }
      if (plan.lastUpdatedTime < startTime) reachedBeforeRange = true;
      if (
        plan.lastUpdatedTime >= startTime &&
        plan.lastUpdatedTime < endTime &&
        plan.marketplaceIds.includes(input.marketplaceId)
      ) {
        selectedPlans.push(plan);
      }
    }
    input.onProgress?.(pageCount);
    paginationToken = parsed.nextToken;
    if (!paginationToken || reachedBeforeRange) break;
    if (parsed.plans.length === 0 || seenTokens.has(paginationToken)) {
      throw new FbaInboundSnapshotError(
        "Amazon 新版 FBA 入庫計畫分頁沒有前進，已停止同步。",
        { status: 409, code: "PAGINATION_CHANGED", requestId: result.requestId },
      );
    }
    seenTokens.add(paginationToken);
  }
  if (paginationToken && pageCount >= MAX_PLAN_PAGES) {
    throw new FbaInboundSnapshotError(
      "Amazon 新版 FBA 入庫計畫分頁超過安全上限。",
      { status: 409, code: "PAGINATION_LIMIT_EXCEEDED" },
    );
  }

  const shipmentRows: Record<string, unknown>[] = [];
  const confirmationIds = new Set<string>();
  let completedPlans = 0;
  for (const plan of selectedPlans) {
    throwIfAborted(input.signal);
    const detail = await input.transport({
      kind: "plan",
      inboundPlanId: plan.inboundPlanId,
    });
    lastRequestId = detail.requestId;
    const shipmentIds = planShipmentIds(
      detail.payload,
      plan,
      input.marketplaceId,
    );
    for (const shipmentId of shipmentIds) {
      throwIfAborted(input.signal);
      const shipment = await input.transport({
        kind: "shipment",
        inboundPlanId: plan.inboundPlanId,
        shipmentId,
      });
      lastRequestId = shipment.requestId;
      const row = shipmentRow(
        shipment.payload,
        plan.inboundPlanId,
        shipmentId,
      );
      const confirmationId = String(row.ShipmentId);
      if (confirmationIds.has(confirmationId)) {
        throw new FbaInboundSnapshotError(
          "Amazon 新版 FBA 入庫計畫重複回傳同一確認貨件，已停止同步。",
          { status: 409, code: "PAGINATION_CHANGED", requestId: shipment.requestId },
        );
      }
      confirmationIds.add(confirmationId);
      shipmentRows.push(row);
      if (shipmentRows.length > MAX_SHIPMENTS) {
        throw new FbaInboundSnapshotError(
          "Amazon 新版 FBA 入庫貨件超過安全讀取上限。",
          { status: 409, code: "PAGINATION_LIMIT_EXCEEDED" },
        );
      }
    }
    completedPlans += 1;
    input.onProgress?.(pageCount + completedPlans);
  }

  return {
    payload: { payload: { ShipmentData: shipmentRows } },
    requestId: lastRequestId,
  };
}
