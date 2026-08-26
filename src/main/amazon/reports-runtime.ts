import { randomUUID } from "node:crypto";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  LocalStore,
  sharedFbaShipmentSalesOptionsKey,
  type DurableReportLeg,
  type SharedReportLease,
} from "../local-store";
import {
  DurableReportLifecycle,
  type DurableReportGatewayStatus,
  type DurableReportIdentity,
  type DurableReportStatus,
} from "./report-lifecycle";
import { SpApiError } from "./sp-api-error";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
  SpExecutionMode,
} from "./sp-execution-context";
import {
  SpExecutionContextAfterAdapterError,
  SpExecutionContextError,
} from "./sp-execution-context";

type ReportPlanBase = Readonly<{
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>;

export type ReportsIntentPlan =
  | ReportPlanBase & Readonly<{ intent: "all-listings" }>
  | ReportPlanBase & Readonly<{ intent: "active-business-listings" }>
  | ReportPlanBase & Readonly<{ intent: "aged-inventory" }>
  | ReportPlanBase & Readonly<{ intent: "inbound-noncompliance" }>
  | ReportPlanBase & Readonly<{
      intent: "sales-and-traffic-daily-sku";
      startDate: string;
      endDate: string;
    }>
  | ReportPlanBase & Readonly<{
      intent: "fba-shipment-sales";
      startDate: string;
      endDate: string;
      dataStartTime: string;
      dataEndTime: string;
      windowCreatedAt: number;
    }>;

type ReportsPlanIdentity = ReportsIntentPlan extends infer Plan
  ? Plan extends ReportsIntentPlan
    ? Readonly<Omit<Plan, "signal">>
    : never
  : never;

export type ReportsAdapterIdentity = ReportsPlanIdentity extends infer Identity
  ? Identity extends ReportsPlanIdentity
    ? Readonly<Identity & { mode: SpExecutionMode }>
    : never
  : never;

export type ReportsCreateRequest = ReportsAdapterIdentity & Readonly<{
  operation: "create";
  signal: AbortSignal;
}>;

export type ReportsStatusRequest = ReportsAdapterIdentity & Readonly<{
  operation: "status";
  reportId: string;
  signal: AbortSignal;
}>;

export type ReportsDocumentRequest = ReportsAdapterIdentity & Readonly<{
  operation: "document";
  reportId: string;
  documentId: string;
  signal: AbortSignal;
}>;

export type ReportsAdapterRequest =
  | ReportsCreateRequest
  | ReportsStatusRequest
  | ReportsDocumentRequest;

export type ReportsAdapterStatus = DurableReportGatewayStatus & Readonly<{
  identity: ReportsAdapterIdentity;
}>;

export type ReportsAdapterDocument = Readonly<{
  identity: ReportsAdapterIdentity;
  reportId: string;
  documentId: string;
  text: string;
}>;

export interface ReportsAdapter {
  create(request: ReportsCreateRequest): Promise<ReportsAdapterStatus>;
  status(request: ReportsStatusRequest): Promise<ReportsAdapterStatus>;
  readDocument(
    request: ReportsDocumentRequest,
  ): Promise<ReportsAdapterDocument>;
}

export type ReportsRuntimeReceipt = DurableReportStatus;

export type ReportsRuntimeDocument = Readonly<{
  mode: SpExecutionMode;
  text: string;
}>;

export type ReportsRuntimeStartOptions = Readonly<{
  explicitRetry: boolean;
  freshCompleted?: boolean;
  expectedContext?: SpExecutionContext;
}>;

type ScriptedCreateStep = Readonly<{
  operation: "create";
  result: Omit<ReportsAdapterStatus, "identity"> & {
    identity?: ReportsAdapterIdentity;
  };
}>;

type ScriptedStatusStep = Readonly<{
  operation: "status";
  result: Omit<ReportsAdapterStatus, "identity"> & {
    identity?: ReportsAdapterIdentity;
  };
}>;

type ScriptedDocumentStep = Readonly<{
  operation: "document";
  result: Omit<ReportsAdapterDocument, "identity" | "reportId" | "documentId"> & {
    identity?: ReportsAdapterIdentity;
    reportId?: string;
    documentId?: string;
  };
}>;

export type ScriptedReportsAdapterStep =
  | ScriptedCreateStep
  | ScriptedStatusStep
  | ScriptedDocumentStep;

export type ScriptedReportsAdapter = ReportsAdapter & Readonly<{
  requests: ReportsAdapterRequest[];
}>;

const REPORT_HANDLE_PREFIX = "report-lease.";
const DOCUMENT_HANDLE_PREFIX = "report-document.";
const HANDLE_ID = /^[A-Za-z0-9._-]{1,120}$/u;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u;

function validDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function invalidIntent(): never {
  throw new SpApiError("Reports runtime 讀取意圖不在允許清單內。", {
    status: 400,
    code: "INVALID_INPUT",
  });
}

function assertPlan(plan: ReportsIntentPlan): void {
  if (!marketplaceById(plan.marketplaceId)) {
    throw new SpApiError("Amazon 站點無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  switch (plan.intent) {
    case "all-listings":
    case "active-business-listings":
    case "aged-inventory":
    case "inbound-noncompliance":
      return;
    case "sales-and-traffic-daily-sku":
      if (
        validDateKey(plan.startDate) &&
        validDateKey(plan.endDate) &&
        plan.startDate <= plan.endDate
      ) return;
      break;
    case "fba-shipment-sales":
      try {
        sharedFbaShipmentSalesOptionsKey(plan);
        if (
          Number.isSafeInteger(plan.windowCreatedAt) &&
          plan.windowCreatedAt >= 0
        ) return;
      } catch {
        break;
      }
    default:
      return invalidIntent();
  }
  throw new SpApiError("Reports runtime 日期或固定時窗無效。", {
    status: 400,
    code: "INVALID_INPUT",
  });
}

function withoutSignal(plan: ReportsIntentPlan): ReportsPlanIdentity {
  switch (plan.intent) {
    case "all-listings":
    case "active-business-listings":
    case "aged-inventory":
    case "inbound-noncompliance":
      return { intent: plan.intent, marketplaceId: plan.marketplaceId };
    case "sales-and-traffic-daily-sku":
      return {
        intent: plan.intent,
        marketplaceId: plan.marketplaceId,
        startDate: plan.startDate,
        endDate: plan.endDate,
      };
    case "fba-shipment-sales":
      return {
        intent: plan.intent,
        marketplaceId: plan.marketplaceId,
        startDate: plan.startDate,
        endDate: plan.endDate,
        dataStartTime: plan.dataStartTime,
        dataEndTime: plan.dataEndTime,
        windowCreatedAt: plan.windowCreatedAt,
      };
    default:
      return invalidIntent();
  }
}

export function reportsAdapterIdentity(
  plan: ReportsIntentPlan,
  mode: SpExecutionMode,
): ReportsAdapterIdentity {
  assertPlan(plan);
  if (mode !== "live" && mode !== "demo") return invalidIntent();
  return Object.freeze({ ...withoutSignal(plan), mode }) as ReportsAdapterIdentity;
}

export function reportsDurableIdentity(
  context: Pick<SpExecutionContext, "accountScope" | "marketplaceId" | "mode">,
  plan: ReportsIntentPlan,
): DurableReportIdentity {
  const adapterIdentity = reportsAdapterIdentity(plan, context.mode);
  if (adapterIdentity.marketplaceId !== context.marketplaceId) {
    throw new SpApiError("Reports runtime context 與站點不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  switch (adapterIdentity.intent) {
    case "all-listings":
      return {
        accountScope: context.accountScope,
        marketplaceId: context.marketplaceId,
        mode: context.mode,
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
        optionsKey: "preferredReportDocumentLocale=en_US",
      };
    case "active-business-listings":
      return {
        accountScope: context.accountScope,
        marketplaceId: context.marketplaceId,
        mode: context.mode,
        reportType: "GET_MERCHANT_LISTINGS_DATA",
        optionsKey: "preferredReportDocumentLocale=en_US",
      };
    case "aged-inventory":
      return {
        accountScope: context.accountScope,
        marketplaceId: context.marketplaceId,
        mode: context.mode,
        reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
        optionsKey: "marketplaceIds=selected",
      };
    case "inbound-noncompliance":
      return {
        accountScope: context.accountScope,
        marketplaceId: context.marketplaceId,
        mode: context.mode,
        reportType: "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA",
        optionsKey: "marketplaceIds=selected;daily-inbound-noncompliance",
      };
    case "sales-and-traffic-daily-sku":
      return {
        accountScope: context.accountScope,
        marketplaceId: context.marketplaceId,
        mode: context.mode,
        reportType: "GET_SALES_AND_TRAFFIC_REPORT",
        optionsKey: `dateGranularity=DAY;asinGranularity=SKU;start=${adapterIdentity.startDate};end=${adapterIdentity.endDate}`,
      };
    case "fba-shipment-sales":
      return {
        accountScope: context.accountScope,
        marketplaceId: context.marketplaceId,
        mode: context.mode,
        reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
        optionsKey: sharedFbaShipmentSalesOptionsKey(adapterIdentity),
      };
    default:
      return invalidIntent();
  }
}

function reportNotices(intent: ReportsIntentPlan["intent"]): {
  pending: string;
  done: string;
} {
  switch (intent) {
    case "all-listings":
      return { pending: "Amazon 正在準備全商品清單。", done: "Amazon 全商品清單已就緒。" };
    case "active-business-listings":
      return {
        pending: "Amazon 正在準備 Active Listings Business Price 報表。",
        done: "Amazon Active Listings Business Price 報表已就緒。",
      };
    case "aged-inventory":
      return {
        pending: "Amazon 正在準備 FBA 庫齡資料；完成後會自動顯示。",
        done: "Amazon FBA 庫齡資料已就緒，正在整理 180 天以上庫存。",
      };
    case "inbound-noncompliance":
      return {
        pending: "Amazon 正在準備每日 FBA 入庫瑕疵報表。",
        done: "Amazon 每日 FBA 入庫瑕疵報表已就緒。",
      };
    case "sales-and-traffic-daily-sku":
      return {
        pending: "Amazon 正在準備 SKU 銷售與流量報表。",
        done: "Amazon SKU 銷售與流量報表已就緒。",
      };
    case "fba-shipment-sales":
      return {
        pending: "Amazon 正在準備 FBA 已出貨商品資料。",
        done: "Amazon FBA 已出貨商品資料已就緒。",
      };
    default:
      return invalidIntent();
  }
}

function sameIdentity(
  actual: ReportsAdapterIdentity,
  expected: ReportsAdapterIdentity,
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertAdapterIdentity(
  actual: ReportsAdapterIdentity,
  expected: ReportsAdapterIdentity,
): void {
  if (!sameIdentity(actual, expected)) {
    throw new SpApiError("Reports adapter 回應與固定意圖不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
}

function reportHandle(leaseId: string): string {
  return `${REPORT_HANDLE_PREFIX}${leaseId}`;
}

function documentHandle(leaseId: string): string {
  return `${DOCUMENT_HANDLE_PREFIX}${leaseId}`;
}

function handleLeaseId(value: string, prefix: string): string | null {
  if (!value.startsWith(prefix)) return null;
  const leaseId = value.slice(prefix.length);
  return HANDLE_ID.test(leaseId) ? leaseId : null;
}

function publicReceipt(lease: SharedReportLease, notices: {
  pending: string;
  done: string;
}): ReportsRuntimeReceipt {
  const ready = lease.report.status === "DONE" && Boolean(lease.report.documentId);
  if (!lease.report.reportId || (ready && !lease.report.documentId)) {
    throw new SpApiError("持久報表紀錄不完整。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  if (
    lease.report.status !== "IN_QUEUE" &&
    lease.report.status !== "IN_PROGRESS" &&
    lease.report.status !== "DONE"
  ) {
    throw new SpApiError("持久報表尚未形成可讀取的安全 reference。", {
      status: 409,
      code: "SHARED_REPORT_RETRY_REQUIRED",
    });
  }
  return {
    mode: lease.mode,
    ready,
    reportId: reportHandle(lease.leaseId),
    documentId: ready ? documentHandle(lease.leaseId) : null,
    status: lease.report.status,
    notice: ready ? notices.done : notices.pending,
  };
}

function cloneRequest(request: ReportsAdapterRequest): ReportsAdapterRequest {
  const { signal: _signal, ...identity } = request;
  return structuredClone(identity) as ReportsAdapterRequest;
}

function adapterIdentityFromRequest(
  request: ReportsAdapterRequest,
): ReportsAdapterIdentity {
  const {
    operation: _operation,
    signal: _signal,
    reportId: _reportId,
    documentId: _documentId,
    ...identity
  } = request as ReportsAdapterRequest & {
    reportId?: string;
    documentId?: string;
  };
  return identity as ReportsAdapterIdentity;
}

export function createScriptedReportsAdapter(
  scriptedSteps: readonly ScriptedReportsAdapterStep[],
): ScriptedReportsAdapter {
  const steps = [...scriptedSteps];
  const requests: ReportsAdapterRequest[] = [];
  const take = (operation: ScriptedReportsAdapterStep["operation"]) => {
    const step = steps.shift();
    if (!step) throw new Error(`Missing scripted Reports ${operation} result.`);
    if (step.operation !== operation) {
      throw new Error(
        `Expected scripted Reports ${step.operation} result, received ${operation}.`,
      );
    }
    return step;
  };
  return {
    requests,
    async create(request) {
      requests.push(cloneRequest(request));
      const step = take("create") as ScriptedCreateStep;
      return {
        ...structuredClone(step.result),
        identity: step.result.identity ?? adapterIdentityFromRequest(request),
      };
    },
    async status(request) {
      requests.push(cloneRequest(request));
      const step = take("status") as ScriptedStatusStep;
      return {
        ...structuredClone(step.result),
        identity: step.result.identity ?? adapterIdentityFromRequest(request),
      };
    },
    async readDocument(request) {
      requests.push(cloneRequest(request));
      const step = take("document") as ScriptedDocumentStep;
      return {
        ...structuredClone(step.result),
        identity: step.result.identity ?? adapterIdentityFromRequest(request),
        reportId: step.result.reportId ?? request.reportId,
        documentId: step.result.documentId ?? request.documentId,
      };
    },
  };
}

export class ReportsRuntime {
  private readonly store: LocalStore;
  private readonly lifecycle: DurableReportLifecycle;
  private readonly context: SpExecutionContextAdapter;
  private readonly adapter: ReportsAdapter;

  constructor(input: Readonly<{
    store: LocalStore;
    lifecycle: DurableReportLifecycle;
    context: SpExecutionContextAdapter;
    adapter: ReportsAdapter;
  }>) {
    this.store = input.store;
    this.lifecycle = input.lifecycle;
    this.context = input.context;
    this.adapter = input.adapter;
  }

  clear(): void {
    this.lifecycle.clear();
  }

  private async adapterCall<T>(
    context: SpExecutionContext,
    call: () => Promise<T>,
  ): Promise<T> {
    let result: T;
    try {
      result = await call();
    } catch (adapterError) {
      await this.assertContextAfterAdapter(context);
      throw adapterError;
    }
    await this.assertContextAfterAdapter(context);
    return result;
  }

  private async assertContextAfterAdapter(
    context: SpExecutionContext,
  ): Promise<void> {
    try {
      await this.context.assertCurrent(context);
    } catch (contextError) {
      if (contextError instanceof SpExecutionContextError) {
        throw new SpExecutionContextAfterAdapterError(contextError);
      }
      throw contextError;
    }
  }

  private async lifecycleCall<T>(
    context: SpExecutionContext,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (lifecycleError) {
      await this.context.assertCurrent(context);
      throw lifecycleError;
    }
  }

  private async executionContext(
    marketplaceId: MarketplaceId,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    if (!expected) return this.context.capture(marketplaceId);
    if (expected.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境與固定報表站點不一致；請重新開始。",
      );
    }
    await this.context.assertCurrent(expected);
    return expected;
  }

  async start(
    plan: ReportsIntentPlan,
    options: ReportsRuntimeStartOptions,
  ): Promise<ReportsRuntimeReceipt> {
    assertPlan(plan);
    const context = await this.executionContext(
      plan.marketplaceId,
      options.expectedContext,
    );
    const identity = reportsDurableIdentity(context, plan);
    const adapterIdentity = reportsAdapterIdentity(plan, context.mode);
    await this.lifecycleCall(context, () =>
      this.lifecycle.start({
        identity,
        explicitRetry: options.explicitRetry,
        freshCompleted: options.freshCompleted,
        signal: plan.signal,
        notices: reportNotices(plan.intent),
        create: async ({ signal }) => {
          await this.context.assertCurrent(context);
          return this.adapterCall(context, () =>
            this.adapter.create({
              ...adapterIdentity,
              operation: "create",
              signal,
            }));
        },
        validate: async (result) => {
          await this.context.assertCurrent(context);
          assertAdapterIdentity(
            (result as ReportsAdapterStatus).identity,
            adapterIdentity,
          );
        },
      }));
    await this.context.assertCurrent(context);
    const receipt = await this.receiptFor(identity, reportNotices(plan.intent));
    await this.context.assertCurrent(context);
    return receipt;
  }

  async read(
    plan: ReportsIntentPlan,
    expectedContext?: SpExecutionContext,
  ): Promise<ReportsRuntimeReceipt | null> {
    assertPlan(plan);
    const context = await this.executionContext(plan.marketplaceId, expectedContext);
    const identity = reportsDurableIdentity(context, plan);
    const lease = await this.store.getSharedReport(identity);
    await this.context.assertCurrent(context);
    if (!lease) return null;
    this.assertLeaseMode(lease, context.mode);
    if (
      lease.expiresAt <= Date.now() &&
      (lease.report.status === "DONE" || lease.report.status === "NOT_STARTED")
    ) return null;
    if (lease.report.status === "CANCELLED" || lease.report.status === "FATAL") {
      throw new SpApiError("Amazon 未能產生這份報表；系統不會自動重建。", {
        status: 409,
        code: lease.report.status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL",
      });
    }
    if (!lease.report.reportId || lease.report.terminal) {
      throw new SpApiError("上次報表建立結果不完整；系統不會自動重送。", {
        status: 409,
        code: "SHARED_REPORT_RETRY_REQUIRED",
      });
    }
    return publicReceipt(lease, reportNotices(plan.intent));
  }

  async status(
    plan: ReportsIntentPlan,
    opaqueReportId: string,
    expectedContext?: SpExecutionContext,
  ): Promise<ReportsRuntimeReceipt> {
    assertPlan(plan);
    const context = await this.executionContext(plan.marketplaceId, expectedContext);
    const identity = reportsDurableIdentity(context, plan);
    const adapterIdentity = reportsAdapterIdentity(plan, context.mode);
    const lease = await this.leaseForHandle(identity, context.mode, opaqueReportId);
    if (!lease.report.reportId) return this.mismatch();
    await this.lifecycleCall(context, () =>
      this.lifecycle.status({
        identity,
        reportId: lease.report.reportId!,
        signal: plan.signal,
        notices: reportNotices(plan.intent),
        poll: async ({ reportId, signal }) => {
          await this.context.assertCurrent(context);
          const result = await this.adapterCall(context, () =>
            this.adapter.status({
              ...adapterIdentity,
              operation: "status",
              reportId,
              signal,
            }));
          await this.context.assertCurrent(context);
          assertAdapterIdentity(result.identity, adapterIdentity);
          return result;
        },
      }));
    await this.context.assertCurrent(context);
    const receipt = await this.receiptFor(identity, reportNotices(plan.intent));
    await this.context.assertCurrent(context);
    return receipt;
  }

  async readDocument(
    plan: ReportsIntentPlan,
    input: Readonly<{ reportId: string; documentId: string }>,
    expectedContext?: SpExecutionContext,
  ): Promise<ReportsRuntimeDocument> {
    assertPlan(plan);
    const context = await this.executionContext(plan.marketplaceId, expectedContext);
    const identity = reportsDurableIdentity(context, plan);
    const adapterIdentity = reportsAdapterIdentity(plan, context.mode);
    const lease = await this.leaseForHandle(identity, context.mode, input.reportId);
    await this.context.assertCurrent(context);
    const expectedDocumentHandle = documentHandle(lease.leaseId);
    if (
      input.documentId !== expectedDocumentHandle ||
      !lease.report.reportId ||
      !lease.report.documentId ||
      lease.report.status !== "DONE" ||
      lease.report.terminal !== null
    ) {
      throw new SpApiError("報表尚未完成，或文件 reference 已失效。", {
        status: 409,
        code: "REPORT_NOT_READY",
      });
    }
    const result = await this.adapterCall(context, () =>
      this.adapter.readDocument({
        ...adapterIdentity,
        operation: "document",
        reportId: lease.report.reportId!,
        documentId: lease.report.documentId!,
        signal: plan.signal ?? new AbortController().signal,
      }));
    await this.context.assertCurrent(context);
    assertAdapterIdentity(result.identity, adapterIdentity);
    if (
      result.reportId !== lease.report.reportId ||
      result.documentId !== lease.report.documentId
    ) return this.mismatch();
    return Object.freeze({ mode: context.mode, text: result.text });
  }

  /**
   * Main-process projection for legacy coordinators. It exposes only opaque
   * handles while preserving terminal evidence needed to avoid blind creates.
   */
  async projectDurableLeg(
    plan: ReportsIntentPlan,
    expectedContext?: SpExecutionContext,
  ): Promise<DurableReportLeg | null> {
    const context = await this.executionContext(plan.marketplaceId, expectedContext);
    const identity = reportsDurableIdentity(context, plan);
    const lease = await this.store.getSharedReport(identity);
    await this.context.assertCurrent(context);
    if (!lease) return null;
    this.assertLeaseMode(lease, context.mode);
    return {
      ...lease.report,
      reportId: lease.report.reportId ? reportHandle(lease.leaseId) : null,
      documentId: lease.report.documentId
        ? documentHandle(lease.leaseId)
        : null,
    };
  }

  async adopt(
    plan: ReportsIntentPlan,
    input: Readonly<{
      report: DurableReportLeg;
      createdAt: number;
      updatedAt: number;
      expiresAt: number;
    }>,
    expectedContext?: SpExecutionContext,
  ): Promise<ReportsRuntimeReceipt | null> {
    const context = await this.executionContext(plan.marketplaceId, expectedContext);
    const identity = reportsDurableIdentity(context, plan);
    const claim = await this.store.createSharedReportIfAbsent({
      leaseId: randomUUID(),
      ...identity,
      report: input.report,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      expiresAt: input.expiresAt,
    });
    await this.context.assertCurrent(context);
    this.assertLeaseMode(claim.lease, context.mode);
    return claim.lease.report.reportId && !claim.lease.report.terminal
      ? publicReceipt(claim.lease, reportNotices(plan.intent))
      : null;
  }

  private async receiptFor(
    identity: DurableReportIdentity,
    notices: { pending: string; done: string },
  ): Promise<ReportsRuntimeReceipt> {
    const lease = await this.store.getSharedReport(identity);
    if (!lease) return this.mismatch();
    this.assertLeaseMode(lease, identity.mode);
    return publicReceipt(lease, notices);
  }

  private async leaseForHandle(
    identity: DurableReportIdentity,
    mode: SpExecutionMode,
    opaqueReportId: string,
  ): Promise<SharedReportLease> {
    const leaseId = handleLeaseId(opaqueReportId, REPORT_HANDLE_PREFIX);
    if (!leaseId) return this.mismatch();
    const lease = await this.store.getSharedReport(identity);
    if (!lease || lease.leaseId !== leaseId) return this.mismatch();
    this.assertLeaseMode(lease, mode);
    return lease;
  }

  private assertLeaseMode(lease: SharedReportLease, mode: SpExecutionMode): void {
    if (lease.mode !== mode) {
      throw new SpApiError("報表模式與目前 App 設定不一致。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }
  }

  private mismatch(): never {
    throw new SpApiError("這份報表不屬於目前帳號、站點、模式或功能。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
}
