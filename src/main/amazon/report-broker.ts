import { createHash, randomUUID } from "node:crypto";
import type { MarketplaceId } from "../../shared/marketplaces";
import {
  LocalStore,
  type DurableReportLeg,
  type SharedReportLease,
  type SharedReportOptionsKey,
} from "../local-store";
import {
  AdvertisingApiError,
  AdvertisingReportAcceptedError,
  SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
  parseSponsoredProductsAdvertisedProductRows,
  type AdvertisingCombinedAccountIdentity,
  type AdvertisingGateway,
  type SponsoredProductsAdvertisedProductReport,
  type SponsoredProductsAdvertisedProductReportReference,
} from "./ads-api";
import { advertisedProductReportDateViolation } from
  "./advertised-product-report-policy";
import {
  DurableReportLifecycle,
  type DurableReportGatewayStatus,
  type DurableReportIdentity,
  type DurableReportStatus,
} from "./report-lifecycle";
import {
  ReportsRuntime,
  type ReportsAdapter,
  type ReportsIntentPlan,
  type ReportsRuntimeDocument,
  type ReportsRuntimeReceipt,
  type ReportsRuntimeStartOptions,
} from "./reports-runtime";
import { SpApiError } from "./sp-api-error";
import {
  SpExecutionContextAfterAdapterError,
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";

export type AdvertisedProductReportPlan = Readonly<{
  intent: "ads-sp-advertised-product";
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  signal?: AbortSignal;
}>;

export type AdvertisedProductReportData = Readonly<{
  rows: SponsoredProductsAdvertisedProductReport["rows"];
}>;

export type FixedSpDurableLeg = DurableReportLeg & Readonly<{
  leaseBinding: string | null;
  handleBinding: string | null;
}>;

declare const ADVERTISED_PRODUCT_BINDING: unique symbol;
export type AdvertisedProductAccountBinding = string & Readonly<{
  [ADVERTISED_PRODUCT_BINDING]: true;
}>;

type AdvertisedProductBindingRecord = Readonly<{
  generation: number;
  marketplaceId: MarketplaceId;
  mode: "live";
  spAccountScope: string;
  combinedAccountScope: string;
  adsProfileFingerprint: string;
}>;

type BoundAdvertisedProductOptions = Readonly<{
  binding: AdvertisedProductAccountBinding;
  expectedContext?: SpExecutionContext;
}>;

type StartAdvertisedProductOptions = BoundAdvertisedProductOptions &
  Readonly<{
    explicitRetry: boolean;
    freshCompleted?: boolean;
  }>;

type AdvertisedProductGateway = AdvertisingGateway & Required<Pick<
  AdvertisingGateway,
  | "getCombinedAccountIdentity"
  | "createSponsoredProductsAdvertisedProductReport"
  | "getSponsoredProductsAdvertisedProductReportStatus"
  | "downloadSponsoredProductsAdvertisedProductReport"
>>;

const ADS_REPORT_HANDLE_PREFIX = "report-broker.ads.";
const ADS_DOCUMENT_HANDLE_PREFIX = "report-broker.ads-document.";
const SP_REPORT_HANDLE_PREFIX = "report-lease.";
const SP_DOCUMENT_HANDLE_PREFIX = "report-document.";
const BROKER_HANDLE_MARKER = "broker.";
const SP_RUNTIME_HANDLE_ID = /^[A-Za-z0-9._-]{1,120}$/u;
const ADS_PENDING_NOTICE = "Amazon Ads 正在準備 Sponsored Products 商品報表。";
const ADS_DONE_NOTICE = "Amazon Ads Sponsored Products 商品報表已就緒。";

type BrokerHandleKind =
  | "sp-report"
  | "sp-document"
  | "ads-report"
  | "ads-document";

type BrokerHandleRecord = Readonly<{
  generation: number;
  kind: BrokerHandleKind;
  internalValue: string;
  leaseBinding: string | null;
}>;

function assertAdvertisedProductPlan(
  plan: AdvertisedProductReportPlan,
  now: Date,
  enforceCurrentWindow: boolean,
): void {
  if (plan.intent !== "ads-sp-advertised-product") {
    throw new SpApiError("Amazon Ads 固定報表日期或意圖無效。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  const violation = advertisedProductReportDateViolation({
    marketplaceId: plan.marketplaceId,
    startDate: plan.startDate,
    endDate: plan.endDate,
    now,
    enforceCurrentWindow,
  });
  if (violation) {
    throw new SpApiError(violation.message, {
      status: violation.status,
      code: violation.code,
    });
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function advertisedProductOptionsKey(
  plan: AdvertisedProductReportPlan,
): SharedReportOptionsKey {
  return `reportTypeId=spAdvertisedProduct;timeUnit=SUMMARY;version=1;start=${plan.startDate};end=${plan.endDate}`;
}

function advertisedProductIdentity(
  context: SpExecutionContext,
  combinedAccountScope: string,
  plan: AdvertisedProductReportPlan,
): DurableReportIdentity {
  return {
    // Preserve the pre-broker durable key so an upgrade reuses active and
    // completed evidence instead of issuing a duplicate Ads report POST.
    accountScope: fingerprint(["ads-strategy", combinedAccountScope]),
    marketplaceId: context.marketplaceId,
    mode: context.mode,
    reportType: "ADS_SP_ADVERTISED_PRODUCT",
    optionsKey: advertisedProductOptionsKey(plan),
  };
}

function advertisedProductReference(
  plan: AdvertisedProductReportPlan,
  combinedAccountScope: string,
  reportId: string,
): SponsoredProductsAdvertisedProductReportReference {
  return {
    reportId,
    marketplaceId: plan.marketplaceId,
    combinedAccountScope,
    startDate: plan.startDate,
    endDate: plan.endDate,
    configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID,
  };
}

function sameReference(
  actual: SponsoredProductsAdvertisedProductReportReference,
  expected: SponsoredProductsAdvertisedProductReportReference,
): boolean {
  return actual.reportId === expected.reportId &&
    actual.marketplaceId === expected.marketplaceId &&
    actual.combinedAccountScope === expected.combinedAccountScope &&
    actual.startDate === expected.startDate &&
    actual.endDate === expected.endDate &&
    actual.configurationId === expected.configurationId;
}

function mismatch(message = "固定 Amazon Ads 報表 reference 不一致。"): never {
  throw new SpApiError(message, { status: 409, code: "REPORT_MISMATCH" });
}

function advertisingError(error: unknown): never {
  if (error instanceof AdvertisingApiError) {
    throw new SpApiError(error.message, {
      status: error.status,
      code: error.status >= 500 ? "UPSTREAM_UNAVAILABLE" : error.code,
      requestId: error.requestId,
    });
  }
  throw error;
}

function brokerHandlePrefix(kind: BrokerHandleKind): string {
  if (kind === "sp-report") return SP_REPORT_HANDLE_PREFIX;
  if (kind === "sp-document") return SP_DOCUMENT_HANDLE_PREFIX;
  if (kind === "ads-report") return ADS_REPORT_HANDLE_PREFIX;
  return ADS_DOCUMENT_HANDLE_PREFIX;
}

function spRuntimeHandleId(
  value: string,
  kind: "sp-report" | "sp-document",
): string {
  const prefix = brokerHandlePrefix(kind);
  if (!value.startsWith(prefix)) {
    return mismatch("Amazon Reports runtime handle 格式無效。");
  }
  const runtimeId = value.slice(prefix.length);
  if (!SP_RUNTIME_HANDLE_ID.test(runtimeId)) {
    return mismatch("Amazon Reports runtime handle 格式無效。");
  }
  return runtimeId;
}

function spLeaseBinding(
  internalId: string,
): string {
  return fingerprint(["fixed-report-broker-sp-lease-v1", internalId]);
}

function spHandleBinding(input: Readonly<{
  leaseBinding: string;
  reportId: string;
  documentId: string | null;
}>): string {
  return fingerprint([
    "fixed-report-broker-sp-projection-v1",
    input.leaseBinding,
    input.reportId,
    input.documentId,
  ]);
}

/**
 * Main-process composition root for every durable report lifecycle.
 *
 * Six SP report families retain the closed ReportsRuntime intent union. The
 * Ads surface accepts only one semantic plan; account scope, report type,
 * options, configuration and raw Amazon references are all broker-owned.
 */
export class FixedReportBroker {
  private readonly store: LocalStore;
  private readonly context: SpExecutionContextAdapter;
  private readonly advertising: AdvertisingGateway | null;
  private readonly now: () => Date;
  private readonly lifecycle: DurableReportLifecycle;
  private readonly reports: ReportsRuntime;
  private readonly advertisedProductBindings = new Map<
    AdvertisedProductAccountBinding,
    AdvertisedProductBindingRecord
  >();
  private readonly brokerHandles = new Map<string, BrokerHandleRecord>();
  private readonly brokerHandlesByIdentity = new Map<string, string>();
  private generation = 0;

  constructor(input: Readonly<{
    store: LocalStore;
    context: SpExecutionContextAdapter;
    reportsAdapter: ReportsAdapter;
    advertising?: AdvertisingGateway | null;
    now?: () => Date;
  }>) {
    this.store = input.store;
    this.context = input.context;
    this.advertising = input.advertising ?? null;
    this.now = input.now ?? (() => new Date());
    this.lifecycle = new DurableReportLifecycle(input.store);
    this.reports = new ReportsRuntime({
      store: input.store,
      lifecycle: this.lifecycle,
      context: input.context,
      adapter: input.reportsAdapter,
    });
  }

  clear(): void {
    this.generation += 1;
    this.advertisedProductBindings.clear();
    this.brokerHandles.clear();
    this.brokerHandlesByIdentity.clear();
    this.reports.clear();
  }

  canRebindPersistedSpLeg(
    persisted: Readonly<{
      reportId: string | null;
      documentId: string | null;
      status: DurableReportLeg["status"];
      createdAt: number | null;
      terminal: DurableReportLeg["terminal"];
      leaseBinding?: string | null;
      handleBinding?: string | null;
    }>,
    projected: FixedSpDurableLeg,
  ): boolean {
    const storedLeaseBinding = typeof persisted.leaseBinding === "string" &&
        /^[a-f0-9]{64}$/u.test(persisted.leaseBinding)
      ? persisted.leaseBinding
      : null;
    const storedHandleBinding = typeof persisted.handleBinding === "string" &&
        /^[a-f0-9]{64}$/u.test(persisted.handleBinding)
      ? persisted.handleBinding
      : null;
    if (storedLeaseBinding || storedHandleBinding) {
      const storedHandleIsIntact = Boolean(
        storedLeaseBinding &&
        storedHandleBinding &&
        persisted.reportId &&
        storedHandleBinding === spHandleBinding({
          leaseBinding: storedLeaseBinding,
          reportId: persisted.reportId,
          documentId: persisted.documentId,
        }),
      );
      if (!storedHandleIsIntact) return false;
      if (projected.leaseBinding === storedLeaseBinding) return true;

      // A long-running Brand job can outlive a completed shared report lease.
      // Rebind only to a newer, already-complete lease for the same broker-owned
      // intent. No pending, terminal, incomplete, or tampered leg is accepted.
      return Boolean(
        persisted.status === "DONE" &&
        persisted.terminal === null &&
        persisted.documentId &&
        persisted.createdAt !== null &&
        projected.status === "DONE" &&
        projected.terminal === null &&
        projected.reportId &&
        projected.documentId &&
        projected.leaseBinding &&
        projected.handleBinding &&
        projected.createdAt !== null &&
        projected.createdAt > persisted.createdAt
      );
    }
    if (!persisted.reportId || !projected.leaseBinding) return false;
    const reportBinding = this.legacySpHandleBinding(
      "report",
      persisted.reportId,
    );
    const documentBinding = persisted.documentId
      ? this.legacySpHandleBinding("document", persisted.documentId)
      : reportBinding;
    return reportBinding !== null &&
      reportBinding === documentBinding &&
      projected.leaseBinding === reportBinding;
  }

  private legacySpHandleBinding(
    kind: "report" | "document",
    value: string,
  ): string | null {
    const brokerKind = kind === "report" ? "sp-report" : "sp-document";
    const prefix = brokerHandlePrefix(brokerKind);
    if (
      !value.startsWith(prefix) ||
      value.slice(prefix.length).startsWith(BROKER_HANDLE_MARKER)
    ) return null;
    try {
      return spLeaseBinding(spRuntimeHandleId(value, brokerKind));
    } catch (error) {
      if (error instanceof SpApiError && error.code === "REPORT_MISMATCH") {
        return null;
      }
      throw error;
    }
  }

  private issueBrokerHandle(
    kind: BrokerHandleKind,
    internalValue: string,
  ): string {
    const internalId = kind === "sp-report" || kind === "sp-document"
      ? spRuntimeHandleId(internalValue, kind)
      : SP_RUNTIME_HANDLE_ID.test(internalValue)
        ? internalValue
        : mismatch("Amazon Report Broker durable identity 格式無效。");
    const leaseBinding = kind === "sp-report" || kind === "sp-document"
      ? spLeaseBinding(internalId)
      : null;
    const identityKey = `${this.generation}:${kind}:${internalId}`;
    const existing = this.brokerHandlesByIdentity.get(identityKey);
    if (existing) return existing;
    let handle: string;
    do {
      handle = `${brokerHandlePrefix(kind)}${BROKER_HANDLE_MARKER}${randomUUID()}`;
    } while (this.brokerHandles.has(handle));
    this.brokerHandles.set(handle, {
      generation: this.generation,
      kind,
      internalValue,
      leaseBinding,
    });
    this.brokerHandlesByIdentity.set(identityKey, handle);
    return handle;
  }

  private resolveBrokerHandle(
    value: string,
    kind: BrokerHandleKind,
  ): string {
    const record = this.brokerHandles.get(value);
    if (
      !record ||
      record.generation !== this.generation ||
      record.kind !== kind
    ) return mismatch("Amazon Report Broker handle 已失效。");
    return record.internalValue;
  }

  private spReceipt(receipt: ReportsRuntimeReceipt): ReportsRuntimeReceipt {
    const reportBinding = spLeaseBinding(
      spRuntimeHandleId(receipt.reportId, "sp-report"),
    );
    if (
      receipt.documentId &&
      spLeaseBinding(spRuntimeHandleId(receipt.documentId, "sp-document")) !==
        reportBinding
    ) return mismatch("Amazon Reports runtime lease 綁定不一致。");
    return {
      ...receipt,
      reportId: this.issueBrokerHandle("sp-report", receipt.reportId),
      documentId: receipt.documentId
        ? this.issueBrokerHandle("sp-document", receipt.documentId)
        : null,
    };
  }

  private spDurableLeg(leg: DurableReportLeg): FixedSpDurableLeg {
    if (!leg.reportId) {
      if (leg.documentId) {
        return mismatch("Amazon Reports runtime lease 綁定不一致。");
      }
      return { ...leg, leaseBinding: null, handleBinding: null };
    }
    const reportBinding = spLeaseBinding(
      spRuntimeHandleId(leg.reportId, "sp-report"),
    );
    if (
      leg.documentId &&
      spLeaseBinding(spRuntimeHandleId(leg.documentId, "sp-document")) !==
        reportBinding
    ) return mismatch("Amazon Reports runtime lease 綁定不一致。");
    const reportId = this.issueBrokerHandle("sp-report", leg.reportId);
    const documentId = leg.documentId
      ? this.issueBrokerHandle("sp-document", leg.documentId)
      : null;
    return {
      ...leg,
      reportId,
      documentId,
      leaseBinding: reportBinding,
      handleBinding: spHandleBinding({
        leaseBinding: reportBinding,
        reportId,
        documentId,
      }),
    };
  }

  async start(
    plan: ReportsIntentPlan,
    options: ReportsRuntimeStartOptions,
  ): Promise<ReportsRuntimeReceipt> {
    const generation = this.generation;
    const receipt = await this.reports.start(plan, options);
    this.assertGeneration(generation);
    return this.spReceipt(receipt);
  }

  async read(
    plan: ReportsIntentPlan,
    expectedContext?: SpExecutionContext,
  ): Promise<ReportsRuntimeReceipt | null> {
    const generation = this.generation;
    const receipt = await this.reports.read(plan, expectedContext);
    this.assertGeneration(generation);
    return receipt ? this.spReceipt(receipt) : null;
  }

  async status(
    plan: ReportsIntentPlan,
    opaqueReportId: string,
    expectedContext?: SpExecutionContext,
  ): Promise<ReportsRuntimeReceipt> {
    const generation = this.generation;
    const receipt = await this.reports.status(
      plan,
      this.resolveBrokerHandle(opaqueReportId, "sp-report"),
      expectedContext,
    );
    this.assertGeneration(generation);
    return this.spReceipt(receipt);
  }

  async readDocument(
    plan: ReportsIntentPlan,
    input: Readonly<{ reportId: string; documentId: string }>,
    expectedContext?: SpExecutionContext,
  ): Promise<ReportsRuntimeDocument> {
    const generation = this.generation;
    const document = await this.reports.readDocument(plan, {
      reportId: this.resolveBrokerHandle(input.reportId, "sp-report"),
      documentId: this.resolveBrokerHandle(input.documentId, "sp-document"),
    }, expectedContext);
    this.assertGeneration(generation);
    return document;
  }

  async projectDurableLeg(
    plan: ReportsIntentPlan,
    expectedContext?: SpExecutionContext,
  ) {
    const generation = this.generation;
    const leg = await this.reports.projectDurableLeg(plan, expectedContext);
    this.assertGeneration(generation);
    if (!leg) return null;
    return this.spDurableLeg(leg);
  }

  async adopt(
    plan: ReportsIntentPlan,
    input: Parameters<ReportsRuntime["adopt"]>[1],
    expectedContext?: SpExecutionContext,
  ) {
    const generation = this.generation;
    const receipt = await this.reports.adopt(plan, input, expectedContext);
    this.assertGeneration(generation);
    return receipt ? this.spReceipt(receipt) : null;
  }

  private gateway(): AdvertisedProductGateway {
    const gateway = this.advertising;
    if (
      !gateway?.getCombinedAccountIdentity ||
      !gateway.createSponsoredProductsAdvertisedProductReport ||
      !gateway.getSponsoredProductsAdvertisedProductReportStatus ||
      !gateway.downloadSponsoredProductsAdvertisedProductReport
    ) {
      throw new SpApiError(
        "目前 Notebook 鑰匙版本尚未提供 Sponsored Products 報表；更新後才可產生策略。",
        { status: 422, code: "ADS_STRATEGY_APP_UPDATE_REQUIRED" },
      );
    }
    return gateway as AdvertisedProductGateway;
  }

  private async executionContext(
    marketplaceId: MarketplaceId,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    if (!expected) return this.context.capture(marketplaceId);
    if (expected.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境與固定 Ads 報表站點不一致；請重新開始。",
      );
    }
    await this.context.assertCurrent(expected);
    return expected;
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

  private async advertisingAdapterCall<T>(
    context: SpExecutionContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.context.assertCurrent(context);
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      await this.assertContextAfterAdapter(context);
      advertisingError(error);
    }
    await this.assertContextAfterAdapter(context);
    return result;
  }

  private async lifecycleCall<T>(
    context: SpExecutionContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await this.context.assertCurrent(context);
      throw error;
    }
  }

  private async combinedAccountIdentity(
    marketplaceId: MarketplaceId,
    context: SpExecutionContext,
    signal: AbortSignal | undefined,
    refreshProfile: boolean,
  ): Promise<AdvertisingCombinedAccountIdentity> {
    await this.context.assertCurrent(context);
    const identity = await this.advertisingAdapterCall(context, () =>
      this.gateway().getCombinedAccountIdentity(
        marketplaceId,
        signal,
        { refreshProfile },
      ));
    if (
      !identity ||
      typeof identity.combinedAccountScope !== "string" ||
      identity.combinedAccountScope.length === 0 ||
      identity.combinedAccountScope.length > 512 ||
      typeof identity.adsProfileFingerprint !== "string" ||
      identity.adsProfileFingerprint.length === 0 ||
      identity.adsProfileFingerprint.length > 512
    ) mismatch("Amazon Ads 固定帳號 scope 無效。");
    return identity;
  }

  async bindAdvertisedProductAccount(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<AdvertisedProductAccountBinding> {
    const generation = this.generation;
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    if (context.mode !== "live") {
      throw new SpApiError("Amazon Ads 固定報表只允許真實帳號模式。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }
    const identity = await this.combinedAccountIdentity(
      input.marketplaceId,
      context,
      input.signal,
      true,
    );
    this.assertGeneration(generation);
    const binding = fingerprint([
      "fixed-report-broker-ads-binding-v1",
      generation,
      context.accountScope,
      context.marketplaceId,
      context.mode,
      identity.combinedAccountScope,
      identity.adsProfileFingerprint,
    ]) as AdvertisedProductAccountBinding;
    this.advertisedProductBindings.set(binding, {
      generation,
      marketplaceId: input.marketplaceId,
      mode: "live",
      spAccountScope: context.accountScope,
      combinedAccountScope: identity.combinedAccountScope,
      adsProfileFingerprint: identity.adsProfileFingerprint,
    });
    return binding;
  }

  private bindingRecord(
    binding: AdvertisedProductAccountBinding,
    marketplaceId: MarketplaceId,
    context: SpExecutionContext,
  ): AdvertisedProductBindingRecord {
    const record = this.advertisedProductBindings.get(binding);
    if (
      !record ||
      record.generation !== this.generation ||
      record.marketplaceId !== marketplaceId ||
      record.mode !== context.mode ||
      record.spAccountScope !== context.accountScope
    ) return mismatch("Amazon Ads 固定帳號 binding 已失效。");
    return record;
  }

  private async validatedBinding(input: Readonly<{
    binding: AdvertisedProductAccountBinding;
    marketplaceId: MarketplaceId;
    context: SpExecutionContext;
    signal?: AbortSignal;
  }>): Promise<AdvertisedProductBindingRecord> {
    const record = this.bindingRecord(
      input.binding,
      input.marketplaceId,
      input.context,
    );
    await this.assertCurrentAdvertisedProductBinding(
      record,
      input.marketplaceId,
      input.context,
      input.signal,
    );
    return record;
  }

  private async assertCurrentAdvertisedProductBinding(
    record: AdvertisedProductBindingRecord,
    marketplaceId: MarketplaceId,
    context: SpExecutionContext,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = await this.combinedAccountIdentity(
      marketplaceId,
      context,
      signal,
      true,
    );
    if (record.generation !== this.generation) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon Ads 固定帳號 binding 已因 broker 更新而失效。",
      );
    }
    if (
      current.combinedAccountScope !== record.combinedAccountScope ||
      current.adsProfileFingerprint !== record.adsProfileFingerprint
    ) {
      throw new SpApiError(
        "Amazon Ads 或 SP-API 帳號與固定報表 binding 不一致。",
        { status: 409, code: "ADS_REPORT_ACCOUNT_CHANGED" },
      );
    }
  }

  async assertAdvertisedProductBinding(input: Readonly<{
    binding: AdvertisedProductAccountBinding;
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<void> {
    const generation = this.generation;
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    await this.validatedBinding({
      binding: input.binding,
      marketplaceId: input.marketplaceId,
      context,
      signal: input.signal,
    });
    this.assertGeneration(generation);
  }

  private assertGeneration(expected: number): void {
    if (this.generation !== expected) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 報表 broker 已更新；舊操作不會產生可用 handle。",
      );
    }
  }

  private assertGenerationAfterAdapter(expected: number): void {
    try {
      this.assertGeneration(expected);
    } catch (error) {
      if (error instanceof SpExecutionContextError) {
        throw new SpExecutionContextAfterAdapterError(error);
      }
      throw error;
    }
  }

  private async receipt(
    identity: DurableReportIdentity,
    generation: number,
    context: SpExecutionContext,
    binding: AdvertisedProductBindingRecord,
    marketplaceId: MarketplaceId,
    signal?: AbortSignal,
  ): Promise<DurableReportStatus> {
    this.assertGeneration(generation);
    const lease = await this.store.getSharedReport(identity);
    this.assertGeneration(generation);
    await this.context.assertCurrent(context);
    await this.assertCurrentAdvertisedProductBinding(
      binding,
      marketplaceId,
      context,
      signal,
    );
    this.assertGeneration(generation);
    if (!lease || !lease.report.reportId) return mismatch();
    if (lease.mode !== identity.mode) {
      throw new SpApiError("Amazon Ads 報表模式已改變。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }
    if (lease.report.status === "CANCELLED" || lease.report.status === "FATAL") {
      throw new SpApiError("Amazon Ads 未能產生這份報表；系統不會自動重建。", {
        status: 409,
        code: lease.report.status === "CANCELLED"
          ? "REPORT_CANCELLED"
          : "REPORT_FATAL",
      });
    }
    const status = lease.report.status;
    if (
      lease.report.terminal !== null ||
      (status !== "IN_QUEUE" && status !== "IN_PROGRESS" && status !== "DONE")
    ) {
      throw new SpApiError("上次 Ads 報表建立結果不完整；系統不會自動重送。", {
        status: 409,
        code: "SHARED_REPORT_RETRY_REQUIRED",
      });
    }
    const ready = status === "DONE";
    if (
      (ready && !lease.report.documentId) ||
      (!ready && lease.report.documentId !== null)
    ) return mismatch("Amazon Ads durable 報表狀態不一致。");
    return {
      mode: lease.mode,
      ready,
      reportId: this.issueBrokerHandle("ads-report", lease.leaseId),
      documentId: ready
        ? this.issueBrokerHandle("ads-document", lease.leaseId)
        : null,
      status,
      notice: ready ? ADS_DONE_NOTICE : ADS_PENDING_NOTICE,
    };
  }

  private async leaseForHandle(
    identity: DurableReportIdentity,
    opaqueReportId: string,
    generation: number,
  ): Promise<SharedReportLease> {
    this.assertGeneration(generation);
    const lease = await this.store.getSharedReport(identity);
    this.assertGeneration(generation);
    const leaseId = this.resolveBrokerHandle(opaqueReportId, "ads-report");
    if (
      !lease ||
      leaseId !== lease.leaseId ||
      lease.mode !== identity.mode
    ) return mismatch();
    return lease;
  }

  async startAdvertisedProduct(
    plan: AdvertisedProductReportPlan,
    options: StartAdvertisedProductOptions,
  ): Promise<DurableReportStatus> {
    assertAdvertisedProductPlan(plan, this.now(), true);
    const generation = this.generation;
    const context = await this.executionContext(
      plan.marketplaceId,
      options.expectedContext,
    );
    if (context.mode !== "live") {
      throw new SpApiError("Amazon Ads 固定報表只允許真實帳號模式。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }
    const binding = await this.validatedBinding({
      binding: options.binding,
      marketplaceId: plan.marketplaceId,
      context,
      signal: plan.signal,
    });
    this.assertGeneration(generation);
    const identity = advertisedProductIdentity(
      context,
      binding.combinedAccountScope,
      plan,
    );
    let acceptedReference: SponsoredProductsAdvertisedProductReportReference | null = null;
    let acceptedFence: unknown = null;
    await this.lifecycleCall(context, () => this.lifecycle.start({
      identity,
      explicitRetry: options.explicitRetry,
      freshCompleted: options.freshCompleted,
      signal: plan.signal,
      notices: { pending: ADS_PENDING_NOTICE, done: ADS_DONE_NOTICE },
      create: async ({ signal }): Promise<DurableReportGatewayStatus> => {
        await this.context.assertCurrent(context);
        await this.assertCurrentAdvertisedProductBinding(
          binding,
          plan.marketplaceId,
          context,
          signal,
        );
        this.assertGeneration(generation);
        try {
          acceptedReference = await this.gateway()
            .createSponsoredProductsAdvertisedProductReport({
              marketplaceId: plan.marketplaceId,
              startDate: plan.startDate,
              endDate: plan.endDate,
              expectedCombinedAccountScope: binding.combinedAccountScope,
              signal,
            });
        } catch (error) {
          if (error instanceof AdvertisingReportAcceptedError) {
            acceptedReference = error.reference;
            acceptedFence = error.reason;
          } else {
            await this.assertContextAfterAdapter(context);
            this.assertGenerationAfterAdapter(generation);
            advertisingError(error);
          }
        }
        return {
          mode: "live",
          ready: false,
          reportId: acceptedReference.reportId,
          documentId: null,
          status: "IN_QUEUE",
          notice: ADS_PENDING_NOTICE,
        };
      },
      validate: async (status) => {
        this.assertGenerationAfterAdapter(generation);
        await this.assertContextAfterAdapter(context);
        if (!acceptedReference) return mismatch();
        const expected = advertisedProductReference(
          plan,
          binding.combinedAccountScope,
          status.reportId,
        );
        if (!sameReference(acceptedReference, expected)) return mismatch();
        if (acceptedFence !== null) advertisingError(acceptedFence);
        const current = await this.combinedAccountIdentity(
          plan.marketplaceId,
          context,
          plan.signal,
          true,
        );
        this.assertGeneration(generation);
        if (
          current.combinedAccountScope !== binding.combinedAccountScope ||
          current.adsProfileFingerprint !== binding.adsProfileFingerprint
        ) {
          throw new SpApiError(
            "Amazon Ads 或 SP-API 帳號在報表建立期間已改變。",
            { status: 409, code: "ADS_REPORT_ACCOUNT_CHANGED" },
          );
        }
      },
    }));
    this.assertGeneration(generation);
    await this.context.assertCurrent(context);
    return this.receipt(
      identity,
      generation,
      context,
      binding,
      plan.marketplaceId,
      plan.signal,
    );
  }

  async readAdvertisedProduct(
    plan: AdvertisedProductReportPlan,
    options: BoundAdvertisedProductOptions,
  ): Promise<DurableReportStatus | null> {
    assertAdvertisedProductPlan(plan, this.now(), false);
    const generation = this.generation;
    const context = await this.executionContext(
      plan.marketplaceId,
      options.expectedContext,
    );
    const binding = await this.validatedBinding({
      binding: options.binding,
      marketplaceId: plan.marketplaceId,
      context,
      signal: plan.signal,
    });
    this.assertGeneration(generation);
    const identity = advertisedProductIdentity(
      context,
      binding.combinedAccountScope,
      plan,
    );
    const lease = await this.store.getSharedReport(identity);
    this.assertGeneration(generation);
    await this.context.assertCurrent(context);
    await this.assertCurrentAdvertisedProductBinding(
      binding,
      plan.marketplaceId,
      context,
      plan.signal,
    );
    this.assertGeneration(generation);
    if (!lease) return null;
    if (
      lease.expiresAt <= Date.now() &&
      (lease.report.status === "DONE" || lease.report.status === "NOT_STARTED")
    ) return null;
    if (lease.report.status === "CANCELLED" || lease.report.status === "FATAL") {
      throw new SpApiError("Amazon Ads 未能產生這份報表；系統不會自動重建。", {
        status: 409,
        code: lease.report.status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL",
      });
    }
    if (!lease.report.reportId || lease.report.terminal) {
      throw new SpApiError("上次 Ads 報表建立結果不完整；系統不會自動重送。", {
        status: 409,
        code: "SHARED_REPORT_RETRY_REQUIRED",
      });
    }
    return this.receipt(
      identity,
      generation,
      context,
      binding,
      plan.marketplaceId,
      plan.signal,
    );
  }

  async statusAdvertisedProduct(
    plan: AdvertisedProductReportPlan,
    opaqueReportId: string,
    options: BoundAdvertisedProductOptions,
  ): Promise<DurableReportStatus> {
    assertAdvertisedProductPlan(plan, this.now(), false);
    const generation = this.generation;
    const context = await this.executionContext(
      plan.marketplaceId,
      options.expectedContext,
    );
    const binding = await this.validatedBinding({
      binding: options.binding,
      marketplaceId: plan.marketplaceId,
      context,
      signal: plan.signal,
    });
    this.assertGeneration(generation);
    const identity = advertisedProductIdentity(
      context,
      binding.combinedAccountScope,
      plan,
    );
    const lease = await this.leaseForHandle(
      identity,
      opaqueReportId,
      generation,
    );
    const rawReportId = lease.report.reportId;
    if (!rawReportId) return mismatch();
    await this.lifecycleCall(context, () => this.lifecycle.status({
      identity,
      reportId: rawReportId,
      signal: plan.signal,
      notices: { pending: ADS_PENDING_NOTICE, done: ADS_DONE_NOTICE },
      poll: async ({ reportId, signal }): Promise<DurableReportGatewayStatus> => {
        const expected = advertisedProductReference(
          plan,
          binding.combinedAccountScope,
          reportId,
        );
        const result = await this.advertisingAdapterCall(context, () =>
          this.gateway().getSponsoredProductsAdvertisedProductReportStatus(
            expected,
            signal,
        ));
        this.assertGeneration(generation);
        if (!sameReference(result.reference, expected)) return mismatch();
        await this.assertCurrentAdvertisedProductBinding(
          binding,
          plan.marketplaceId,
          context,
          signal,
        );
        this.assertGeneration(generation);
        if (
          result.status !== "PENDING" &&
          result.status !== "PROCESSING" &&
          result.status !== "COMPLETED" &&
          result.status !== "FAILURE"
        ) return mismatch("Amazon Ads 報表狀態不在固定 allowlist。");
        const mapped = result.status === "PENDING"
          ? "IN_QUEUE"
          : result.status === "PROCESSING"
            ? "IN_PROGRESS"
            : result.status === "COMPLETED"
              ? "DONE"
              : "FATAL";
        if (result.ready !== (mapped === "DONE")) return mismatch();
        return {
          mode: "live",
          ready: mapped === "DONE",
          reportId,
          documentId: mapped === "DONE" ? reportId : null,
          status: mapped,
          notice: mapped === "DONE" ? ADS_DONE_NOTICE : ADS_PENDING_NOTICE,
        };
      },
    }));
    this.assertGeneration(generation);
    await this.context.assertCurrent(context);
    return this.receipt(
      identity,
      generation,
      context,
      binding,
      plan.marketplaceId,
      plan.signal,
    );
  }

  async readAdvertisedProductData(
    plan: AdvertisedProductReportPlan,
    input: Readonly<{ reportId: string; documentId: string }>,
    options: BoundAdvertisedProductOptions,
  ): Promise<AdvertisedProductReportData> {
    assertAdvertisedProductPlan(plan, this.now(), false);
    const generation = this.generation;
    const context = await this.executionContext(
      plan.marketplaceId,
      options.expectedContext,
    );
    const binding = await this.validatedBinding({
      binding: options.binding,
      marketplaceId: plan.marketplaceId,
      context,
      signal: plan.signal,
    });
    this.assertGeneration(generation);
    const identity = advertisedProductIdentity(
      context,
      binding.combinedAccountScope,
      plan,
    );
    const lease = await this.leaseForHandle(
      identity,
      input.reportId,
      generation,
    );
    const documentLeaseId = this.resolveBrokerHandle(
      input.documentId,
      "ads-document",
    );
    if (
      documentLeaseId !== lease.leaseId ||
      !lease.report.reportId ||
      !lease.report.documentId ||
      lease.report.status !== "DONE" ||
      lease.report.terminal !== null
    ) return mismatch("Amazon Ads 報表尚未完成，或文件 handle 已失效。");
    const expected = advertisedProductReference(
      plan,
      binding.combinedAccountScope,
      lease.report.reportId,
    );
    const report = await this.advertisingAdapterCall(context, () =>
      this.gateway().downloadSponsoredProductsAdvertisedProductReport(
        expected,
        plan.signal,
      ));
    this.assertGeneration(generation);
    if (!sameReference(report.reference, expected)) return mismatch();
    await this.assertCurrentAdvertisedProductBinding(
      binding,
      plan.marketplaceId,
      context,
      plan.signal,
    );
    this.assertGeneration(generation);
    let rows: SponsoredProductsAdvertisedProductReport["rows"];
    try {
      rows = parseSponsoredProductsAdvertisedProductRows(report.rows);
    } catch (error) {
      advertisingError(error);
    }
    return Object.freeze({ rows });
  }
}
