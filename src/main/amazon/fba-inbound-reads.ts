import {
  abortableDelay,
  throwIfAborted as assertNotAborted,
} from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import {
  buildDemoFbaInboundShipmentSnapshot,
  collectFbaInboundShipmentSnapshot,
  FbaInboundSnapshotError,
  type FbaInboundProgress,
  type FbaInboundShipmentSnapshot,
  type FbaInboundTransportRequest,
  type FbaInboundTransportResult,
} from "./fba-inbound-shipments";
import {
  collectModernFbaInboundShipmentList,
  type ModernFbaInboundTransportRequest,
  type ModernFbaInboundTransportResult,
} from "./fba-inbound-modern";
import {
  parseInboundNoncomplianceReport,
  type ParsedInboundNoncomplianceReport,
} from "./inbound-noncompliance";
import {
  isDateOnly,
  marketplaceCalendar,
} from "./marketplace-calendar";
import type {
  ReportsRuntime,
  ReportsRuntimeReceipt,
} from "./reports-runtime";
import { SpApiError } from "./sp-api-error";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "./sp-execution-context";
import {
  SpExecutionContextAfterAdapterError,
  SpExecutionContextError,
} from "./sp-execution-context";

const ACTIVE_SHIPMENT_STATUSES = [
  "WORKING",
  "READY_TO_SHIP",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CHECKED_IN",
  "RECEIVING",
  "ERROR",
] as const;
const NONCOMPLIANCE_POLL_LIMIT = 150;
const NONCOMPLIANCE_POLL_INTERVAL_MS = 2_000;

export type FbaInboundExternalReadPlan =
  | Readonly<{
      source: "v0";
      request: FbaInboundTransportRequest;
      signal?: AbortSignal;
    }>
  | Readonly<{
      source: "modern";
      marketplaceId: MarketplaceId;
      request: ModernFbaInboundTransportRequest;
      signal?: AbortSignal;
    }>;

export type FbaInboundExternalReadIdentity =
  | Readonly<{
      source: "v0";
      request: FbaInboundTransportRequest;
    }>
  | Readonly<{
      source: "modern";
      marketplaceId: MarketplaceId;
      request: ModernFbaInboundTransportRequest;
    }>;

export type FbaInboundExternalReadResult = Readonly<{
  identity: FbaInboundExternalReadIdentity;
  envelope: unknown;
  requestId: string | null;
}>;

export interface FbaInboundExternalReadAdapter {
  read(
    plan: FbaInboundExternalReadPlan,
  ): Promise<FbaInboundExternalReadResult>;
}

export type FbaInboundShipmentReadResult = Readonly<{
  state: "complete" | "partial";
  snapshot: FbaInboundShipmentSnapshot;
}>;

export type FbaInboundNoncomplianceReadResult = Readonly<{
  parsed: ParsedInboundNoncomplianceReport;
  fetchedAt: string;
}>;

type ReportsPort = Pick<
  ReportsRuntime,
  "readDocument" | "start" | "status"
>;

function cloneV0Request(
  request: FbaInboundTransportRequest,
): FbaInboundTransportRequest {
  return request.kind === "shipments" && request.queryType === "SHIPMENT"
    ? { ...request, shipmentStatuses: [...request.shipmentStatuses] }
    : { ...request };
}

function cloneModernRequest(
  request: ModernFbaInboundTransportRequest,
): ModernFbaInboundTransportRequest {
  return { ...request };
}

export function fbaInboundExternalReadIdentity(
  plan: FbaInboundExternalReadPlan,
): FbaInboundExternalReadIdentity {
  return plan.source === "v0"
    ? Object.freeze({ source: "v0", request: cloneV0Request(plan.request) })
    : Object.freeze({
        source: "modern",
        marketplaceId: plan.marketplaceId,
        request: cloneModernRequest(plan.request),
      });
}

function sameIdentity(
  actual: FbaInboundExternalReadIdentity,
  expected: FbaInboundExternalReadIdentity,
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function invalidRange(message: string): never {
  throw new SpApiError(message, {
    status: 400,
    code: "INVALID_FBA_INBOUND_RANGE",
  });
}

function dateWindow(input: Readonly<{
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  now: Date;
}>): Readonly<{ startAt: string; endAt: string }> {
  if (
    Number.isNaN(input.now.getTime()) ||
    !isDateOnly(input.startDate) ||
    !isDateOnly(input.endDate)
  ) {
    return invalidRange("FBA 入庫貨件日期必須使用有效的 YYYY-MM-DD 格式。");
  }
  const calendar = marketplaceCalendar(input.marketplaceId);
  const dayCount = calendar.inclusiveDayCount(input.startDate, input.endDate);
  if (dayCount < 1 || dayCount > 180) {
    return invalidRange("FBA 入庫貨件日期範圍必須介於 1 到 180 天。");
  }
  const todayKey = calendar.dayAt(input.now);
  if (input.endDate > todayKey) {
    return invalidRange("FBA 入庫貨件結束日期不可晚於目前 Amazon 站點日期。");
  }
  return {
    startAt: calendar.formatInstant(calendar.midnight(input.startDate)),
    endAt: input.endDate === todayKey
      ? calendar.formatInstant(input.now)
      : calendar.formatInstant(
          calendar.midnight(calendar.shiftDate(input.endDate, 1)),
        ),
  };
}

function allowsListFallback(error: unknown): boolean {
  return error instanceof SpApiError &&
    (error.status === 400 || error.status === 422);
}

function shipmentReadState(
  snapshot: FbaInboundShipmentSnapshot,
): FbaInboundShipmentReadResult["state"] {
  return snapshot.shipmentListScope === "selected-date-range" &&
      snapshot.coverage.state === "complete"
    ? "complete"
    : "partial";
}

/**
 * Semantic owner of all FBA Inbound reads. Callers provide a fixed selection
 * and one immutable execution context; Amazon paths, fallbacks, cursors,
 * report handles, polling and document parsing stay behind this boundary.
 */
export class FbaInboundReads {
  private readonly adapter: FbaInboundExternalReadAdapter;
  private readonly reports: ReportsPort;
  private readonly context: SpExecutionContextAdapter;
  private readonly now: () => Date;
  private readonly wait: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  constructor(input: Readonly<{
    adapter: FbaInboundExternalReadAdapter;
    reports: ReportsPort;
    context: SpExecutionContextAdapter;
    now?: () => Date;
    wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  }>) {
    this.adapter = input.adapter;
    this.reports = input.reports;
    this.context = input.context;
    this.now = input.now ?? (() => new Date());
    this.wait = input.wait ?? abortableDelay;
  }

  private async assertExpectedContext(
    marketplaceId: MarketplaceId,
    expectedContext: SpExecutionContext,
  ): Promise<void> {
    if (expectedContext.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境與 FBA 入庫站點不一致；請重新開始。",
      );
    }
    await this.context.assertCurrent(expectedContext);
  }

  private async assertContextAfterAdapter(
    expectedContext: SpExecutionContext,
  ): Promise<void> {
    try {
      await this.context.assertCurrent(expectedContext);
    } catch (error) {
      if (error instanceof SpExecutionContextError) {
        throw new SpExecutionContextAfterAdapterError(error);
      }
      throw error;
    }
  }

  private async externalRead(
    plan: FbaInboundExternalReadPlan,
    expectedContext: SpExecutionContext,
  ): Promise<FbaInboundExternalReadResult> {
    assertNotAborted(plan.signal);
    await this.assertExpectedContext(
      plan.source === "v0" ? plan.request.marketplaceId : plan.marketplaceId,
      expectedContext,
    );
    const identity = fbaInboundExternalReadIdentity(plan);
    let result: FbaInboundExternalReadResult;
    try {
      result = await this.adapter.read(plan);
    } catch (adapterError) {
      await this.assertContextAfterAdapter(expectedContext);
      throw adapterError;
    }
    await this.assertContextAfterAdapter(expectedContext);
    if (!sameIdentity(result.identity, identity)) {
      throw new SpApiError(
        "FBA Inbound adapter 回傳了不同語意身分的結果，已停止使用。",
        { status: 502, code: "FBA_INBOUND_UPSTREAM_UNAVAILABLE" },
      );
    }
    return result;
  }

  private async readV0(
    request: FbaInboundTransportRequest,
    signal: AbortSignal | undefined,
    expectedContext: SpExecutionContext,
  ): Promise<FbaInboundTransportResult> {
    const result = await this.externalRead(
      { source: "v0", request, signal },
      expectedContext,
    );
    return { payload: result.envelope, requestId: result.requestId };
  }

  private async readModern(
    marketplaceId: MarketplaceId,
    request: ModernFbaInboundTransportRequest,
    signal: AbortSignal | undefined,
    expectedContext: SpExecutionContext,
  ): Promise<ModernFbaInboundTransportResult> {
    const result = await this.externalRead(
      { source: "modern", marketplaceId, request, signal },
      expectedContext,
    );
    return { payload: result.envelope, requestId: result.requestId };
  }

  async readShipments(input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    expectedContext: SpExecutionContext;
    signal?: AbortSignal;
    onProgress?: (progress: FbaInboundProgress) => void;
  }>): Promise<FbaInboundShipmentReadResult> {
    assertNotAborted(input.signal);
    await this.assertExpectedContext(input.marketplaceId, input.expectedContext);
    const now = this.now();
    const window = dateWindow({
      marketplaceId: input.marketplaceId,
      startDate: input.startDate,
      endDate: input.endDate,
      now,
    });
    if (input.expectedContext.mode === "demo") {
      const snapshot = buildDemoFbaInboundShipmentSnapshot({
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        lastUpdatedAfter: window.startAt,
        lastUpdatedBefore: window.endAt,
        now,
      });
      await this.context.assertCurrent(input.expectedContext);
      return { state: shipmentReadState(snapshot), snapshot };
    }

    try {
      const firstRequest: FbaInboundTransportRequest = {
        kind: "shipments",
        marketplaceId: input.marketplaceId,
        queryType: "DATE_RANGE",
        lastUpdatedAfter: window.startAt,
        lastUpdatedBefore: window.endAt,
        nextToken: null,
      };
      let firstShipmentPage: FbaInboundTransportResult;
      let shipmentListSource: FbaInboundShipmentSnapshot["dataSource"]["shipmentList"] =
        "GET /fba/inbound/v0/shipments";
      try {
        firstShipmentPage = await this.readV0(
          firstRequest,
          input.signal,
          input.expectedContext,
        );
      } catch (error) {
        if (!allowsListFallback(error)) throw error;
        try {
          firstShipmentPage = await this.readV0({
            kind: "shipments",
            marketplaceId: input.marketplaceId,
            queryType: "SHIPMENT",
            shipmentStatuses: ACTIVE_SHIPMENT_STATUSES,
            lastUpdatedAfter: null,
            lastUpdatedBefore: null,
            nextToken: null,
          }, input.signal, input.expectedContext);
          shipmentListSource =
            "GET /fba/inbound/v0/shipments?QueryType=SHIPMENT (active-status fallback)";
        } catch (fallbackError) {
          if (!allowsListFallback(fallbackError)) throw fallbackError;
          firstShipmentPage = await collectModernFbaInboundShipmentList({
            marketplaceId: input.marketplaceId,
            startAt: window.startAt,
            endAt: window.endAt,
            signal: input.signal,
            onProgress: (completed) =>
              input.onProgress?.({ phase: "shipments", completed, total: null }),
            transport: (request) => this.readModern(
              input.marketplaceId,
              request,
              input.signal,
              input.expectedContext,
            ),
          });
          shipmentListSource =
            "GET /inbound/fba/2024-03-20/inboundPlans + getInboundPlan/getShipment";
        }
      }

      const snapshot = await collectFbaInboundShipmentSnapshot({
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        lastUpdatedAfter: window.startAt,
        lastUpdatedBefore: window.endAt,
        signal: input.signal,
        onProgress: input.onProgress,
        shipmentListSource,
        firstShipmentPage,
        transport: (request) =>
          this.readV0(request, input.signal, input.expectedContext),
      });
      await this.context.assertCurrent(input.expectedContext);
      return { state: shipmentReadState(snapshot), snapshot };
    } catch (error) {
      if (error instanceof FbaInboundSnapshotError) {
        throw new SpApiError(error.message, {
          status: error.status,
          code: error.code,
          requestId: error.requestId,
        });
      }
      throw error;
    }
  }

  async readNoncompliance(input: Readonly<{
    marketplaceId: MarketplaceId;
    explicitRetry: boolean;
    expectedContext: SpExecutionContext;
    signal?: AbortSignal;
    onProgress?: (progress: Readonly<{
      phase: "issues";
      completed: 0 | 1;
      total: 1;
    }>) => void;
  }>): Promise<FbaInboundNoncomplianceReadResult> {
    assertNotAborted(input.signal);
    await this.assertExpectedContext(input.marketplaceId, input.expectedContext);
    const plan = {
      intent: "inbound-noncompliance" as const,
      marketplaceId: input.marketplaceId,
      signal: input.signal,
    };
    let report: ReportsRuntimeReceipt = await this.reports.start(plan, {
      explicitRetry: input.explicitRetry,
      freshCompleted: input.explicitRetry,
      expectedContext: input.expectedContext,
    });
    input.onProgress?.({ phase: "issues", completed: 0, total: 1 });
    for (
      let attempt = 0;
      !report.ready && attempt < NONCOMPLIANCE_POLL_LIMIT;
      attempt += 1
    ) {
      if (report.status !== "IN_QUEUE" && report.status !== "IN_PROGRESS") {
        throw new SpApiError("Amazon 未能完成每日 FBA 入庫瑕疵報表。", {
          status: 502,
          code: "INBOUND_NONCOMPLIANCE_UNAVAILABLE",
        });
      }
      await this.wait(NONCOMPLIANCE_POLL_INTERVAL_MS, input.signal);
      report = await this.reports.status(
        plan,
        report.reportId,
        input.expectedContext,
      );
      input.onProgress?.({ phase: "issues", completed: 0, total: 1 });
    }
    if (
      !report.ready ||
      !report.documentId ||
      report.mode !== input.expectedContext.mode
    ) {
      throw new SpApiError("Amazon 每日 FBA 入庫瑕疵報表仍在準備中。", {
        status: 504,
        code: "INBOUND_NONCOMPLIANCE_PENDING",
      });
    }
    const document = await this.reports.readDocument(plan, {
      reportId: report.reportId,
      documentId: report.documentId,
    }, input.expectedContext);
    await this.context.assertCurrent(input.expectedContext);
    if (document.mode !== input.expectedContext.mode) {
      throw new SpApiError("FBA 入庫瑕疵報表模式已改變。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }
    const result = {
      parsed: parseInboundNoncomplianceReport(document.text),
      fetchedAt: this.now().toISOString(),
    };
    await this.context.assertCurrent(input.expectedContext);
    input.onProgress?.({ phase: "issues", completed: 1, total: 1 });
    return result;
  }
}
