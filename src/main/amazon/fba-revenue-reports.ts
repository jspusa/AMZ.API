import { randomUUID } from "node:crypto";
import type { MarketplaceId } from "../../shared/marketplaces";
import {
  isBrandSalesIncompatibleJob,
  type BrandSalesIncompatibleJobRecord,
  type BrandSalesJobRecord,
  type BrandSalesReportLeg,
  type LocalStore,
} from "../local-store";
import {
  projectBrandSalesSnapshot,
  readBrandSalesShipmentDocument,
  type BrandSalesReadInput,
} from "./brand-sales-reads";
import type { BrandSalesSnapshot } from "./brand-sales";
import type { FbaCatalogReports } from "./fba-catalog-reports";
import type { FixedReportBroker } from "./report-broker";
import type { ReportsIntentPlan } from "./reports-runtime";
import {
  assertFbaShipmentSalesWindow,
  planFbaShipmentSalesWindow,
  type FbaShipmentSalesWindow,
} from "./revenue-report-windows";
import { SpApiError } from "./sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";

const REUSE_WINDOW_MS = 30 * 60 * 1_000;
const NEAR_REUSE_BOUNDARY_MS = 2 * 60 * 1_000;
const JOB_RETENTION_MS = 60 * 60 * 1_000;

type FbaRevenueReportsPort = Pick<
  FixedReportBroker,
  | "adopt"
  | "canRebindPersistedSpLeg"
  | "projectDurableLeg"
  | "readDocument"
  | "start"
  | "status"
>;

type FbaRevenueCatalogPort = Pick<
  FbaCatalogReports,
  "begin" | "read" | "status"
>;

type BrandSalesJobStore = Pick<
  LocalStore,
  | "createBrandSalesJobIfAbsent"
  | "deleteBrandSalesJob"
  | "getBrandSalesJob"
  | "getBrandSalesJobById"
  | "replaceIncompatibleBrandSalesJob"
  | "updateBrandSalesJobLeg"
>;

type BrandSalesRuntimeJob = BrandSalesJobRecord & {
  snapshot: BrandSalesSnapshot | null;
  snapshotGeneration: number | null;
};

export type FbaRevenueJobView = Readonly<{
  jobId: string;
  mode: "live" | "demo";
  marketplaceId: string;
  startDate: string;
  endDate: string;
  expiresAt: string;
  ready: boolean;
  status: "IN_QUEUE" | "IN_PROGRESS" | "DONE";
  message: string;
}>;

export type FbaRevenueJobResult = Readonly<{
  view: FbaRevenueJobView;
  snapshot: BrandSalesSnapshot | null;
}>;

export type BrandSalesLiveReader = (
  input: BrandSalesReadInput,
) => BrandSalesSnapshot | Promise<BrandSalesSnapshot>;

export interface BrandSalesDemoSource {
  read(input: Readonly<FbaShipmentSalesWindow & {
    signal?: AbortSignal;
  }>): BrandSalesSnapshot | Promise<BrandSalesSnapshot>;
}

export type FbaRevenueReportsDependencies = Readonly<{
  store: BrandSalesJobStore;
  reports: FbaRevenueReportsPort;
  catalog: FbaRevenueCatalogPort;
  context: SpExecutionContextAdapter;
  demo: BrandSalesDemoSource;
  liveReader?: BrandSalesLiveReader;
  now?: () => number;
  newId?: () => string;
}>;

export class FbaRevenueReportsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = "FbaRevenueReportsError";
  }
}

function emptyLeg(): BrandSalesReportLeg {
  return {
    reportId: null,
    documentId: null,
    status: "NOT_STARTED",
    createdAt: null,
    terminal: null,
    terminalAt: null,
    leaseBinding: null,
    handleBinding: null,
  };
}

function throwSemanticError(
  message: string,
  status: number,
  code: string,
  retryAfter?: string,
): never {
  throw new FbaRevenueReportsError(
    message,
    status,
    code,
    retryAfter ?? null,
  );
}

function throwRuntimeError(
  message: string,
  status: number,
  code: string,
): never {
  throw new SpApiError(message, { status, code });
}

function isExecutionContextFenceError(error: unknown): error is SpApiError {
  return error instanceof SpApiError && [
    "ACCOUNT_SCOPE_CHANGED",
    "REPORT_MODE_CHANGED",
    "SP_CONTEXT_INVALIDATED",
  ].includes(error.code);
}

/**
 * Complete semantic owner of the Brand/Category revenue read family. It owns
 * the durable two-leg state machine, immutable shipment cutoff, reuse,
 * polling, context fences and snapshot cache. Its owner lifecycle cancels and
 * fences volatile work without deleting durable report evidence.
 */
export class FbaRevenueReports {
  private readonly store: BrandSalesJobStore;
  private readonly reports: FbaRevenueReportsPort;
  private readonly catalog: FbaRevenueCatalogPort;
  private readonly context: SpExecutionContextAdapter;
  private readonly demo: BrandSalesDemoSource;
  private readonly liveReader: BrandSalesLiveReader;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly jobs = new Map<string, BrandSalesRuntimeJob>();
  private readonly startFlights = new Map<string, Promise<FbaRevenueJobView>>();
  private readonly pollFlights = new Map<string, Promise<void>>();
  private readonly dataFlights = new Map<string, Promise<BrandSalesSnapshot>>();
  private lifecycleRevision = 0;
  private lifecycleController = new AbortController();

  constructor(input: FbaRevenueReportsDependencies) {
    this.store = input.store;
    this.reports = input.reports;
    this.catalog = input.catalog;
    this.context = input.context;
    this.demo = input.demo;
    this.liveReader = input.liveReader ?? readBrandSalesShipmentDocument;
    this.now = input.now ?? Date.now;
    this.newId = input.newId ?? randomUUID;
  }

  clear(): void {
    const staleLifecycle = this.lifecycleController;
    this.lifecycleController = new AbortController();
    this.lifecycleRevision += 1;
    staleLifecycle.abort(new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    ));
    this.jobs.clear();
    this.startFlights.clear();
    this.pollFlights.clear();
    this.dataFlights.clear();
  }

  private async settleInContext<T>(
    context: SpExecutionContext,
    operation: Promise<T>,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): Promise<T> {
    try {
      const value = await this.waitForLifecycle(operation, signal);
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(lifecycleRevision, signal);
      return value;
    } catch (error) {
      if (
        error instanceof FbaRevenueReportsError &&
        (error.code === "ACCOUNT_SCOPE_CHANGED" ||
          error.code === "REPORT_MODE_CHANGED")
      ) {
        throw error;
      }
      if (
        isExecutionContextFenceError(error) &&
        error.code !== "SP_CONTEXT_INVALIDATED"
      ) {
        throw error;
      }
      await this.context.assertCurrent(context);
      this.assertLifecycleCurrent(lifecycleRevision, signal);
      throw error;
    }
  }

  private waitForLifecycle<T>(
    operation: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(signal.reason instanceof Error
        ? signal.reason
        : new SpExecutionContextError(
            "SP_CONTEXT_INVALIDATED",
            "Amazon 執行環境已更新；請重新開始這次操作。",
          ));
    }
    return new Promise<T>((resolve, reject) => {
      const rejectStale = () => reject(signal.reason instanceof Error
        ? signal.reason
        : new SpExecutionContextError(
            "SP_CONTEXT_INVALIDATED",
            "Amazon 執行環境已更新；請重新開始這次操作。",
          ));
      signal.addEventListener("abort", rejectStale, { once: true });
      void operation
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", rejectStale));
    });
  }

  private assertLifecycleCurrent(
    expected: number,
    signal: AbortSignal,
  ): void {
    if (expected === this.lifecycleRevision && !signal.aborted) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  private async assertCurrent(
    context: SpExecutionContext,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): Promise<void> {
    await this.context.assertCurrent(context);
    this.assertLifecycleCurrent(lifecycleRevision, signal);
  }

  async begin(input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    explicitRetry: boolean;
  }>): Promise<FbaRevenueJobView> {
    const lifecycleRevision = this.lifecycleRevision;
    const signal = this.lifecycleController.signal;
    const context = await this.context.capture(input.marketplaceId);
    this.assertLifecycleCurrent(lifecycleRevision, signal);
    const flightKey = [
      context.accountScope,
      input.marketplaceId,
      context.mode,
      context.generation,
      lifecycleRevision,
      input.startDate,
      input.endDate,
    ].join(":");
    const existing = this.startFlights.get(flightKey);
    const flight = existing ??
      this.beginSelection(
        context,
        input,
        lifecycleRevision,
        signal,
      ).finally(() => {
        if (this.startFlights.get(flightKey) === flight) {
          this.startFlights.delete(flightKey);
        }
      });
    if (!existing) this.startFlights.set(flightKey, flight);
    return this.settleInContext(
      context,
      flight,
      lifecycleRevision,
      signal,
    );
  }

  async get(input: Readonly<{
    marketplaceId: MarketplaceId;
    jobId: string;
    includeData: boolean;
  }>): Promise<FbaRevenueJobResult> {
    const lifecycleRevision = this.lifecycleRevision;
    const signal = this.lifecycleController.signal;
    const context = await this.context.capture(input.marketplaceId);
    this.assertLifecycleCurrent(lifecycleRevision, signal);
    this.prune();
    const job = await this.load(
      input.jobId,
      context,
      lifecycleRevision,
      signal,
    );
    if (!job || job.marketplaceId !== input.marketplaceId) {
      return throwSemanticError(
        "品牌營收工作已過期或站點不符，請重新同步。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    return this.settleInContext(
      context,
      this.getSelection(
        context,
        job,
        input,
        lifecycleRevision,
        signal,
      ),
      lifecycleRevision,
      signal,
    );
  }

  private async getSelection(
    context: SpExecutionContext,
    job: BrandSalesRuntimeJob,
    input: Readonly<{
      marketplaceId: MarketplaceId;
      jobId: string;
      includeData: boolean;
    }>,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): Promise<FbaRevenueJobResult> {
    await this.assertCurrent(context, lifecycleRevision, signal);
    if (job.mode !== context.mode) {
      if (job.mode === "demo" && context.mode === "live") {
        await this.store.deleteBrandSalesJob(job.jobId);
        this.jobs.delete(job.jobId);
      }
      return throwSemanticError(
        "App 展示／真實模式已改變，舊品牌營收工作不可繼續。",
        409,
        "REPORT_MODE_CHANGED",
      );
    }
    if (job.accountScope !== context.accountScope) {
      this.jobs.delete(job.jobId);
      return throwSemanticError(
        "Amazon 帳號範圍已改變，舊品牌營收工作不可繼續。",
        409,
        "ACCOUNT_SCOPE_CHANGED",
      );
    }
    await this.normalize(context, job, signal);
    await this.assertCurrent(context, lifecycleRevision, signal);
    const now = this.now();
    if (job.expiresAt <= now && this.ready(job)) {
      await this.store.deleteBrandSalesJob(job.jobId);
      this.jobs.delete(job.jobId);
      return throwSemanticError(
        "品牌營收快照已過期，請重新同步。",
        410,
        "SNAPSHOT_EXPIRED",
      );
    }
    if (job.expiresAt <= now) {
      const activeLeg = (["listing", "shipment"] as const).find((leg) =>
        job[leg].status === "IN_QUEUE" || job[leg].status === "IN_PROGRESS"
      );
      if (activeLeg) {
        await this.saveLeg(job, activeLeg, job[activeLeg], now, true);
      } else if (!job.listing.terminal && !job.shipment.terminal) {
        return throwSemanticError(
          "上次品牌營收工作狀態未完成；系統已禁止自動重送，請回到品牌區明確重試。",
          409,
          "BRAND_REPORT_RETRY_REQUIRED",
        );
      }
    }
    if (job.listing.terminal || job.shipment.terminal) {
      const terminal = job.shipment.terminal ?? job.listing.terminal;
      return throwSemanticError(
        terminal === "CANCELLED"
          ? "Amazon 已取消 FBA 品牌出貨報表；已保留另一側成功結果，不會自動重建。"
          : "Amazon 品牌營收報表工作未完成；已保留成功的一側，請明確重試。",
        409,
        terminal === "CANCELLED"
          ? "REPORT_CANCELLED"
          : terminal === "FATAL"
            ? "REPORT_FATAL"
            : "BRAND_REPORT_RETRY_REQUIRED",
      );
    }
    let pollFlight = this.pollFlights.get(job.jobId);
    if (!pollFlight) {
      pollFlight = this.poll(
        context,
        job,
        lifecycleRevision,
        signal,
      ).finally(() => {
        if (this.pollFlights.get(job.jobId) === pollFlight) {
          this.pollFlights.delete(job.jobId);
        }
      });
      this.pollFlights.set(job.jobId, pollFlight);
    }
    await pollFlight;
    await this.assertCurrent(context, lifecycleRevision, signal);
    if (!input.includeData) return { view: this.view(job), snapshot: null };
    let dataFlight = this.dataFlights.get(job.jobId);
    if (!dataFlight) {
      dataFlight = this.readSnapshot(
        context,
        job,
        lifecycleRevision,
        signal,
      ).finally(() => {
        if (this.dataFlights.get(job.jobId) === dataFlight) {
          this.dataFlights.delete(job.jobId);
        }
      });
      this.dataFlights.set(job.jobId, dataFlight);
    }
    const snapshot = await dataFlight;
    await this.assertCurrent(context, lifecycleRevision, signal);
    return { view: this.view(job), snapshot: structuredClone(snapshot) };
  }

  private prune(now = this.now()): void {
    for (const [jobId, job] of this.jobs) {
      if (job.expiresAt <= now) this.jobs.delete(jobId);
    }
  }

  private runtimeJob(
    record: BrandSalesJobRecord,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): BrandSalesRuntimeJob {
    this.assertLifecycleCurrent(lifecycleRevision, signal);
    const current = this.jobs.get(record.jobId);
    if (current) {
      const snapshot = current.snapshot;
      const snapshotGeneration = current.snapshotGeneration;
      Object.assign(current, structuredClone(record));
      current.snapshot = snapshot;
      current.snapshotGeneration = snapshotGeneration;
      return current;
    }
    const job: BrandSalesRuntimeJob = {
      ...structuredClone(record),
      snapshot: null,
      snapshotGeneration: null,
    };
    this.jobs.set(job.jobId, job);
    return job;
  }

  private legReusable(leg: BrandSalesReportLeg): boolean {
    return Boolean(leg.reportId) &&
      leg.terminal === null &&
      (leg.status === "IN_QUEUE" ||
        leg.status === "IN_PROGRESS" ||
        (leg.status === "DONE" && Boolean(leg.documentId)));
  }

  private ready(job: BrandSalesRuntimeJob): boolean {
    return job.listing.status === "DONE" &&
      Boolean(job.listing.reportId) &&
      Boolean(job.listing.documentId) &&
      job.shipment.status === "DONE" &&
      Boolean(job.shipment.reportId) &&
      Boolean(job.shipment.documentId);
  }

  private view(job: BrandSalesRuntimeJob): FbaRevenueJobView {
    const ready = this.ready(job);
    const status = ready
      ? "DONE"
      : job.listing.status === "IN_PROGRESS" || job.shipment.status === "IN_PROGRESS"
        ? "IN_PROGRESS"
        : "IN_QUEUE";
    return Object.freeze({
      jobId: job.jobId,
      mode: job.mode,
      marketplaceId: job.marketplaceId,
      startDate: job.startDate,
      endDate: job.endDate,
      expiresAt: new Date(job.expiresAt).toISOString(),
      ready,
      status,
      message: ready
        ? "Amazon FBA 品牌出貨資料已就緒。"
        : "Amazon 正在準備 FBA 品牌出貨與目前商品清單。",
    });
  }

  private incompatibleRetryWait(
    job: BrandSalesIncompatibleJobRecord,
    now: number,
  ): number {
    const lastPossibleCreateAt = Math.max(
      job.createdAt,
      job.listing.createdAt ?? 0,
      job.shipment.createdAt ?? 0,
    );
    return Math.max(0, lastPossibleCreateAt + REUSE_WINDOW_MS - now);
  }

  private throwRetryWait(milliseconds: number): never {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1_000));
    return throwSemanticError(
      `Amazon 報表建立仍在 30 分鐘安全間隔內；請約 ${Math.ceil(seconds / 60)} 分鐘後再重試，系統不會重複建立。`,
      409,
      "REPORT_RETRY_WAIT",
      String(seconds),
    );
  }

  private window(job: BrandSalesRuntimeJob): FbaShipmentSalesWindow {
    return assertFbaShipmentSalesWindow({
      marketplaceId: job.marketplaceId as MarketplaceId,
      startDate: job.startDate,
      endDate: job.endDate,
      dataStartTime: job.shipmentDataStartTime,
      dataEndTime: job.shipmentDataEndTime,
      windowCreatedAt: job.createdAt,
    }, this.now());
  }

  private plan(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    signal?: AbortSignal,
  ): ReportsIntentPlan {
    const marketplaceId = job.marketplaceId as MarketplaceId;
    return leg === "listing"
      ? { intent: "all-listings", marketplaceId, signal }
      : {
          intent: "fba-shipment-sales",
          marketplaceId,
          startDate: job.startDate,
          endDate: job.endDate,
          dataStartTime: job.shipmentDataStartTime,
          dataEndTime: job.shipmentDataEndTime,
          windowCreatedAt: job.createdAt,
          signal,
        };
  }

  private async saveLeg(
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    value: BrandSalesReportLeg,
    now = this.now(),
    extendRetention = false,
  ): Promise<void> {
    const snapshot = job.snapshot;
    const snapshotGeneration = job.snapshotGeneration;
    const persisted = await this.store.updateBrandSalesJobLeg({
      jobId: job.jobId,
      leg,
      value,
      updatedAt: now,
      ...(extendRetention
        ? { expiresAt: Math.max(job.expiresAt, now + JOB_RETENTION_MS) }
        : {}),
    });
    Object.assign(job, persisted);
    job.snapshot = snapshot;
    job.snapshotGeneration = snapshotGeneration;
  }

  private async saveProjectedLeg(
    context: SpExecutionContext,
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    signal: AbortSignal,
  ): Promise<void> {
    const projected = await this.reports.projectDurableLeg(
      this.plan(job, leg, signal),
      context,
    );
    if (!projected) {
      return throwRuntimeError(
        "Amazon 報表建立後缺少 durable lease。",
        409,
        "REPORT_MISMATCH",
      );
    }
    if (JSON.stringify(projected) !== JSON.stringify(job[leg])) {
      await this.saveLeg(job, leg, projected);
    }
  }

  private async normalizeLeg(
    context: SpExecutionContext,
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    signal: AbortSignal,
  ): Promise<void> {
    const legacy = job[leg];
    if (legacy.status === "NOT_STARTED" && !legacy.reportId && !legacy.terminal) {
      return;
    }
    const reportPlan = this.plan(job, leg, signal);
    const opaque = legacy.reportId?.startsWith("report-lease.") ?? false;
    const unboundLegacy = legacy.leaseBinding == null &&
      legacy.handleBinding == null;
    if (!opaque && !unboundLegacy) {
      return throwRuntimeError(
        "品牌營收工作與 Reports runtime 不一致。",
        409,
        "REPORT_MISMATCH",
      );
    }
    if (!opaque) {
      await this.reports.adopt(reportPlan, {
        report: legacy,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        expiresAt: job.expiresAt,
      }, context);
    }
    const projected = await this.reports.projectDurableLeg(reportPlan, context);
    if (!projected) {
      return throwRuntimeError(
        "品牌營收報表 lease 已失效。",
        409,
        "REPORT_MISMATCH",
      );
    }
    if (
      opaque &&
      (
        !projected.reportId ||
        !legacy.reportId ||
        !this.reports.canRebindPersistedSpLeg(legacy, projected)
      )
    ) {
      return throwRuntimeError(
        "品牌營收工作與 Reports runtime 不一致。",
        409,
        "REPORT_MISMATCH",
      );
    }
    if (JSON.stringify(projected) !== JSON.stringify(legacy)) {
      await this.saveLeg(job, leg, projected);
    }
  }

  private async normalize(
    context: SpExecutionContext,
    job: BrandSalesRuntimeJob,
    signal: AbortSignal,
  ): Promise<void> {
    await Promise.all([
      this.normalizeLeg(context, job, "listing", signal),
      this.normalizeLeg(context, job, "shipment", signal),
    ]);
  }

  private async startLeg(
    context: SpExecutionContext,
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    explicitRetry: boolean,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): Promise<unknown | null> {
    try {
      if (leg === "listing") {
        await this.catalog.begin({
          purpose: "catalog",
          marketplaceId: job.marketplaceId as MarketplaceId,
          explicitRetry,
          signal,
          expectedContext: context,
        });
      } else {
        await this.reports.start(this.plan(job, leg, signal), {
          explicitRetry,
          expectedContext: context,
        });
      }
      await this.assertCurrent(context, lifecycleRevision, signal);
      await this.saveProjectedLeg(context, job, leg, signal);
      await this.assertCurrent(context, lifecycleRevision, signal);
      return null;
    } catch (error) {
      if (isExecutionContextFenceError(error)) return error;
      try {
        await this.assertCurrent(context, lifecycleRevision, signal);
        const projected = await this.reports.projectDurableLeg(
          this.plan(job, leg, signal),
          context,
        );
        await this.assertCurrent(context, lifecycleRevision, signal);
        if (projected) {
          await this.saveLeg(job, leg, projected);
          await this.assertCurrent(context, lifecycleRevision, signal);
        }
      } catch (projectionError) {
        if (isExecutionContextFenceError(projectionError)) {
          return projectionError;
        }
        // The runtime lease remains authoritative; preserve the first failure.
      }
      return error;
    }
  }

  private async beginSelection(
    context: SpExecutionContext,
    input: Readonly<{
      marketplaceId: MarketplaceId;
      startDate: string;
      endDate: string;
      explicitRetry: boolean;
    }>,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): Promise<FbaRevenueJobView> {
    const now = this.now();
    this.prune(now);
    let stored = await this.store.getBrandSalesJob({
      accountScope: context.accountScope,
      marketplaceId: input.marketplaceId,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    await this.assertCurrent(context, lifecycleRevision, signal);
    let incompatibleToReplace: BrandSalesIncompatibleJobRecord | null = null;
    if (stored && stored.mode !== context.mode) {
      if (stored.mode === "demo" && context.mode === "live") {
        await this.store.deleteBrandSalesJob(stored.jobId);
        this.jobs.delete(stored.jobId);
        return throwSemanticError(
          "App 展示／真實模式已改變；已丟棄展示報表識別，請重新開始。",
          409,
          "REPORT_MODE_CHANGED",
        );
      } else {
        return throwSemanticError(
          "尚有真實 Amazon 品牌營收工作紀錄；展示模式不會覆蓋或重送它。",
          409,
          "REPORT_MODE_CHANGED",
        );
      }
    }
    if (stored && isBrandSalesIncompatibleJob(stored)) {
      if (!input.explicitRetry) {
        return throwSemanticError(
          "上次品牌營收工作缺少新版不可變時間窗；已保留 Amazon 報表識別，不會自動重建。請明確重試。",
          409,
          "BRAND_REPORT_WINDOW_INCOMPATIBLE",
        );
      }
      const wait = this.incompatibleRetryWait(stored, now);
      if (wait > 0) return this.throwRetryWait(wait);
      incompatibleToReplace = stored;
      stored = null;
    }
    if (
      stored &&
      stored.expiresAt <= now &&
      stored.listing.status === "DONE" &&
      stored.shipment.status === "DONE" &&
      this.legReusable(stored.listing) &&
      this.legReusable(stored.shipment)
    ) {
      await this.store.deleteBrandSalesJob(stored.jobId);
      this.jobs.delete(stored.jobId);
      stored = null;
    }
    let job = stored
      ? this.runtimeJob(stored, lifecycleRevision, signal)
      : null;
    if (job) {
      await this.normalize(context, job, signal);
      await this.assertCurrent(context, lifecycleRevision, signal);
      if (this.legReusable(job.listing) && this.legReusable(job.shipment)) {
        const remaining = job.expiresAt - now;
        const activeLeg = (["listing", "shipment"] as const).find((leg) =>
          job![leg].status === "IN_QUEUE" || job![leg].status === "IN_PROGRESS"
        );
        if (activeLeg && remaining <= NEAR_REUSE_BOUNDARY_MS) {
          await this.saveLeg(job, activeLeg, job[activeLeg], now, true);
          return this.view(job);
        }
        if (remaining > NEAR_REUSE_BOUNDARY_MS) return this.view(job);
        if (remaining > 0) return this.throwRetryWait(remaining);
      }
    }
    if (!job) {
      await this.assertCurrent(context, lifecycleRevision, signal);
      const window = planFbaShipmentSalesWindow({
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        now: new Date(now),
      });
      const candidate: BrandSalesJobRecord = {
        jobId: this.newId(),
        accountScope: context.accountScope,
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        mode: context.mode,
        shipmentDataStartTime: window.dataStartTime,
        shipmentDataEndTime: window.dataEndTime,
        listing: emptyLeg(),
        shipment: emptyLeg(),
        createdAt: window.windowCreatedAt,
        updatedAt: now,
        expiresAt: now + JOB_RETENTION_MS,
      };
      const claimed = incompatibleToReplace
        ? await this.store.replaceIncompatibleBrandSalesJob({
            expectedJobId: incompatibleToReplace.jobId,
            replacement: candidate,
          })
        : await this.store.createBrandSalesJobIfAbsent(candidate, now);
      await this.assertCurrent(context, lifecycleRevision, signal);
      job = this.runtimeJob(claimed.job, lifecycleRevision, signal);
      if (!claimed.created) {
        return this.beginSelection(
          context,
          input,
          lifecycleRevision,
          signal,
        );
      }
    }
    await this.assertCurrent(context, lifecycleRevision, signal);
    const results = await Promise.all([
      this.legReusable(job.listing)
        ? Promise.resolve(null)
        : this.startLeg(
            context,
            job,
            "listing",
            input.explicitRetry,
            lifecycleRevision,
            signal,
          ),
      this.legReusable(job.shipment)
        ? Promise.resolve(null)
        : this.startLeg(
            context,
            job,
            "shipment",
            input.explicitRetry,
            lifecycleRevision,
            signal,
          ),
    ]);
    await this.assertCurrent(context, lifecycleRevision, signal);
    const failure = results.find((value) => value !== null);
    if (failure) {
      if (
        failure instanceof SpApiError &&
        failure.code === "SHARED_REPORT_RETRY_REQUIRED"
      ) {
        return throwSemanticError(
          "上次品牌營收工作只完成一部分；已保留成功報表，請按重試只補齊缺少的一側。",
          409,
          "BRAND_REPORT_RETRY_REQUIRED",
        );
      }
      throw failure;
    }
    await this.context.assertCurrent(context);
    return this.view(job);
  }

  private async load(
    jobId: string,
    context: SpExecutionContext,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): Promise<BrandSalesRuntimeJob | null> {
    const cached = this.jobs.get(jobId);
    if (cached) return cached;
    const stored = await this.store.getBrandSalesJobById(jobId);
    await this.context.assertCurrent(context);
    this.assertLifecycleCurrent(lifecycleRevision, signal);
    return stored && !isBrandSalesIncompatibleJob(stored)
      ? this.runtimeJob(stored, lifecycleRevision, signal)
      : null;
  }

  private async markPollFailure(
    context: SpExecutionContext,
    job: BrandSalesRuntimeJob,
    leg: "listing" | "shipment",
    error: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      !(error instanceof SpApiError) ||
      (error.code !== "REPORT_CANCELLED" && error.code !== "REPORT_FATAL")
    ) {
      return;
    }
    await this.saveProjectedLeg(context, job, leg, signal);
  }

  private async poll(
    context: SpExecutionContext,
    job: BrandSalesRuntimeJob,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): Promise<void> {
    await this.assertCurrent(context, lifecycleRevision, signal);
    const marketplaceId = job.marketplaceId as MarketplaceId;
    if (
      (job.listing.status === "IN_QUEUE" || job.listing.status === "IN_PROGRESS") &&
      job.listing.reportId
    ) {
      try {
        const listing = await this.settleInContext(
          context,
          this.catalog.status({
            marketplaceId,
            reportId: job.listing.reportId,
            signal,
            expectedContext: context,
          }),
          lifecycleRevision,
          signal,
        );
        if (
          listing.status !== "IN_QUEUE" &&
          listing.status !== "IN_PROGRESS" &&
          listing.status !== "DONE"
        ) {
          return throwRuntimeError(
            "Amazon 未能產生目前 FBA 商品清單。",
            422,
            listing.status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL",
          );
        }
        if (listing.status === "DONE" && !listing.documentId) {
          return throwRuntimeError(
            "Amazon FBA 商品清單已完成但缺少文件編號。",
            502,
            "REPORT_FAILED",
          );
        }
        await this.saveProjectedLeg(context, job, "listing", signal);
        await this.assertCurrent(context, lifecycleRevision, signal);
      } catch (error) {
        await this.markPollFailure(context, job, "listing", error, signal);
        throw error;
      }
    }
    if (
      (job.shipment.status === "IN_QUEUE" || job.shipment.status === "IN_PROGRESS") &&
      job.shipment.reportId
    ) {
      try {
        const shipment = await this.settleInContext(
          context,
          this.reports.status(
            this.plan(job, "shipment", signal),
            job.shipment.reportId,
            context,
          ),
          lifecycleRevision,
          signal,
        );
        await this.saveProjectedLeg(context, job, "shipment", signal);
        await this.assertCurrent(context, lifecycleRevision, signal);
      } catch (error) {
        await this.markPollFailure(context, job, "shipment", error, signal);
        throw error;
      }
    }
  }

  private async readSnapshot(
    context: SpExecutionContext,
    job: BrandSalesRuntimeJob,
    lifecycleRevision: number,
    signal: AbortSignal,
  ): Promise<BrandSalesSnapshot> {
    await this.assertCurrent(context, lifecycleRevision, signal);
    if (
      !this.ready(job) ||
      !job.listing.reportId ||
      !job.listing.documentId ||
      !job.shipment.reportId ||
      !job.shipment.documentId
    ) {
      return throwSemanticError(
        "Amazon 品牌營收報表尚未完成。",
        409,
        "REPORT_NOT_READY",
      );
    }
    if (job.snapshot && job.snapshotGeneration === context.generation) {
      return structuredClone(job.snapshot);
    }
    job.snapshot = null;
    job.snapshotGeneration = null;
    const window = this.window(job);
    let candidate: BrandSalesSnapshot;
    if (job.mode === "demo") {
      candidate = await this.demo.read({ ...window, signal });
    } else {
      const marketplaceId = job.marketplaceId as MarketplaceId;
      const [listings, shipmentDocument] = await Promise.all([
        this.catalog.read({
          view: "seeds",
          marketplaceId,
          reportId: job.listing.reportId,
          documentId: job.listing.documentId,
          signal,
          expectedContext: context,
        }),
        this.reports.readDocument(
          this.plan(job, "shipment", signal),
          {
            reportId: job.shipment.reportId,
            documentId: job.shipment.documentId,
          },
          context,
        ),
      ]);
      if (shipmentDocument.mode !== job.mode) {
        return throwRuntimeError(
          "品牌營收報表模式已改變。",
          409,
          "REPORT_MODE_CHANGED",
        );
      }
      candidate = await this.liveReader({
        ...window,
        listings,
        shipmentDocument: shipmentDocument.text,
        signal,
      });
    }
    await this.assertCurrent(context, lifecycleRevision, signal);
    const projected = projectBrandSalesSnapshot(candidate, {
      ...window,
      mode: job.mode,
    });
    await this.assertCurrent(context, lifecycleRevision, signal);
    job.snapshot = projected;
    job.snapshotGeneration = context.generation;
    try {
      await this.assertCurrent(context, lifecycleRevision, signal);
    } catch (error) {
      if (job.snapshot === projected) {
        job.snapshot = null;
        job.snapshotGeneration = null;
      }
      throw error;
    }
    return structuredClone(projected);
  }
}
