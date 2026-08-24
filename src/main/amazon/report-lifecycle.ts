import { randomUUID } from "node:crypto";
import {
  LocalStore,
  type DurableReportLeg,
  type SharedReportLease,
  type SharedReportOptionsKey,
  type SharedReportType,
} from "../local-store";
import { SpApiError } from "./sp-api-error";
import { SpExecutionContextAfterAdapterError } from
  "./sp-execution-context";
import {
  throwIfAborted,
  waitForPromiseWithSignal,
} from "../abort-utils";

export type DurableReportIdentity = {
  accountScope: string;
  marketplaceId: string;
  mode: "live" | "demo";
  reportType: SharedReportType;
  optionsKey: SharedReportOptionsKey;
};

export type DurableReportStatus = {
  mode: "live" | "demo";
  ready: boolean;
  reportId: string;
  documentId: string | null;
  status: "IN_QUEUE" | "IN_PROGRESS" | "DONE";
  notice: string;
};

export type DurableReportGatewayStatus = Omit<DurableReportStatus, "status"> & {
  status: DurableReportStatus["status"] | "CANCELLED" | "FATAL";
};

type ReportNotices = {
  pending: string;
  done: string;
};

type LifecycleOptions = {
  now?: () => number;
  retryGuardMs?: number;
  retentionMs?: number;
  nearExpiryMs?: number;
};

type CreateInput = {
  identity: DurableReportIdentity;
  explicitRetry: boolean;
  freshCompleted?: boolean;
  signal?: AbortSignal;
  create: (input: { signal: AbortSignal }) => Promise<DurableReportGatewayStatus>;
  validate?: (status: DurableReportGatewayStatus) => void | Promise<void>;
  notices?: Partial<ReportNotices>;
};

type CreateLeaseResult = Readonly<{
  lease: SharedReportLease;
  reusedCompleted: boolean;
}>;

type StatusInput = {
  identity: DurableReportIdentity;
  reportId: string;
  signal?: AbortSignal;
  poll: (input: {
    reportId: string;
    signal: AbortSignal;
  }) => Promise<DurableReportGatewayStatus>;
  notices?: Partial<ReportNotices>;
  classifyTerminal?: (error: unknown) => "CANCELLED" | "FATAL" | null;
};

const DEFAULT_RETRY_GUARD_MS = 30 * 60 * 1_000;
const DEFAULT_RETENTION_MS = 60 * 60 * 1_000;
const DEFAULT_NEAR_EXPIRY_MS = 2 * 60 * 1_000;

const DEFAULT_NOTICES: ReportNotices = {
  pending: "Amazon 正在準備報表。",
  done: "Amazon 報表已就緒。",
};

const assertActive = throwIfAborted;

function flightKey(identity: DurableReportIdentity): string {
  return JSON.stringify([
    identity.accountScope,
    identity.marketplaceId,
    identity.mode,
    identity.reportType,
    identity.optionsKey,
  ]);
}

function notices(input?: Partial<ReportNotices>): ReportNotices {
  return { ...DEFAULT_NOTICES, ...input };
}

function defaultTerminal(error: unknown): "CANCELLED" | "FATAL" | null {
  if (!(error instanceof SpApiError)) return null;
  if (error.code === "REPORT_CANCELLED") return "CANCELLED";
  if (error.code === "REPORT_FATAL") return "FATAL";
  return null;
}

/**
 * Main-process owner for durable Amazon Reports creation and polling.
 *
 * The small public surface deliberately owns all liveness rules: exact
 * account/market/mode/type/options identity, process single-flight, durable
 * restart reuse, guarded explicit retry, monotonic polling and lifecycle
 * cancellation. A caller abort only stops that waiter; `clear()` is the sole
 * operation that aborts the shared upstream request.
 */
export class DurableReportLifecycle {
  private readonly store: LocalStore;
  private readonly now: () => number;
  private readonly retryGuardMs: number;
  private readonly retentionMs: number;
  private readonly nearExpiryMs: number;
  private readonly createFlights = new Map<string, Promise<CreateLeaseResult>>();
  private readonly statusFlights = new Map<string, Promise<DurableReportStatus>>();
  private lifecycle = new AbortController();

  constructor(store: LocalStore, options: LifecycleOptions = {}) {
    this.store = store;
    this.now = options.now ?? Date.now;
    this.retryGuardMs = options.retryGuardMs ?? DEFAULT_RETRY_GUARD_MS;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.nearExpiryMs = options.nearExpiryMs ?? DEFAULT_NEAR_EXPIRY_MS;
  }

  clear(): void {
    this.lifecycle.abort(new Error("報表 lifecycle 已清除。"));
    this.lifecycle = new AbortController();
    this.createFlights.clear();
    this.statusFlights.clear();
  }

  async start(input: CreateInput): Promise<DurableReportStatus> {
    assertActive(input.signal);
    const lifecycleSignal = this.lifecycle.signal;
    assertActive(lifecycleSignal);
    const key = flightKey(input.identity);
    let flight = this.createFlights.get(key);
    if (!flight) {
      flight = this.createLease({ ...input, signal: lifecycleSignal }).finally(() => {
        if (this.createFlights.get(key) === flight) this.createFlights.delete(key);
      });
      this.createFlights.set(key, flight);
    }
    const result = await waitForPromiseWithSignal(flight, input.signal);
    // A fresh caller may have joined a non-fresh flight that reused an older
    // completed report. The shared flight has been removed by `finally` here,
    // so one retry can safely replace that known-DONE lease without allowing
    // duplicate creation for active or ambiguous reports.
    if (input.freshCompleted && result.reusedCompleted) {
      return this.start(input);
    }
    return this.leaseStatus(result.lease, notices(input.notices));
  }

  async status(input: StatusInput): Promise<DurableReportStatus> {
    assertActive(input.signal);
    const lifecycleSignal = this.lifecycle.signal;
    assertActive(lifecycleSignal);
    const key = JSON.stringify([flightKey(input.identity), input.reportId]);
    let flight = this.statusFlights.get(key);
    if (!flight) {
      flight = this.pollLease({ ...input, signal: lifecycleSignal }).finally(() => {
        if (this.statusFlights.get(key) === flight) this.statusFlights.delete(key);
      });
      this.statusFlights.set(key, flight);
    }
    return waitForPromiseWithSignal(flight, input.signal);
  }

  private async createLease(
    input: Omit<CreateInput, "signal"> & { signal: AbortSignal },
  ): Promise<CreateLeaseResult> {
    assertActive(input.signal);
    const now = this.now();
    let lease = await this.store.getSharedReport(input.identity);
    assertActive(input.signal);

    if (lease && lease.mode !== input.identity.mode) {
      if (lease.mode === "demo" && input.identity.mode === "live") {
        await this.store.deleteSharedReport(lease.leaseId);
        lease = null;
      } else {
        throw new SpApiError(
          "尚有真實 Amazon 報表紀錄；展示模式不會覆蓋它。",
          { status: 409, code: "REPORT_MODE_CHANGED" },
        );
      }
    }

    if (lease && input.freshCompleted && lease.report.status === "DONE") {
      await this.store.deleteSharedReport(lease.leaseId);
      lease = null;
    }

    if (
      lease &&
      lease.expiresAt <= now &&
      (lease.report.status === "DONE" || lease.report.status === "NOT_STARTED")
    ) {
      await this.store.deleteSharedReport(lease.leaseId);
      lease = null;
    }

    let newlyClaimed = false;
    if (!lease) {
      const candidate: SharedReportLease = {
        leaseId: randomUUID(),
        ...input.identity,
        report: {
          reportId: null,
          documentId: null,
          status: "NOT_STARTED",
          createdAt: null,
          terminal: null,
          terminalAt: null,
        },
        createdAt: now,
        updatedAt: now,
        expiresAt: now + this.retentionMs,
      };
      const claim = await this.store.createSharedReportIfAbsent(candidate, now);
      lease = claim.lease;
      newlyClaimed = claim.created;
    }

    if (lease.mode !== input.identity.mode) {
      throw new SpApiError("報表模式與目前 App 設定不一致。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }

    if (!newlyClaimed && this.reusable(lease.report)) {
      const remaining = lease.expiresAt - now;
      if (
        lease.report.status === "IN_QUEUE" ||
        lease.report.status === "IN_PROGRESS"
      ) {
        if (remaining <= this.nearExpiryMs) {
          return {
            lease: await this.store.updateSharedReport({
              leaseId: lease.leaseId,
              report: lease.report,
              updatedAt: now,
              expiresAt: now + this.retentionMs,
            }),
            reusedCompleted: false,
          };
        }
        return { lease, reusedCompleted: false };
      }
      if (remaining > this.nearExpiryMs) {
        return { lease, reusedCompleted: true };
      }
      throw this.expiringError(remaining);
    }

    if (!newlyClaimed && lease.report.status !== "NOT_STARTED") {
      const wait = this.retryWait(lease.report, now);
      if (!input.explicitRetry) throw this.retryRequired(lease.report);
      if (wait > 0) throw this.retryWaitError(wait);
    }

    const createdAt = this.now();
    lease = await this.store.updateSharedReport({
      leaseId: lease.leaseId,
      report: {
        reportId: null,
        documentId: null,
        status: "CREATING",
        createdAt,
        terminal: null,
        terminalAt: null,
      },
      updatedAt: createdAt,
      expiresAt: createdAt + this.retentionMs,
    });
    let returned: DurableReportGatewayStatus | null = null;
    try {
      assertActive(input.signal);
      const status = await input.create({ signal: input.signal });
      returned = status;
      assertActive(input.signal);
      await input.validate?.(status);
      this.assertStatus(status, input.identity);
      return {
        lease: await this.store.updateSharedReport({
          leaseId: lease.leaseId,
          report: {
            reportId: status.reportId,
            documentId: status.documentId,
            status: status.status,
            createdAt,
            terminal: null,
            terminalAt: null,
          },
          updatedAt: this.now(),
        }),
        reusedCompleted: false,
      };
    } catch (error) {
      await this.store.updateSharedReport({
        leaseId: lease.leaseId,
        report: returned &&
          (returned.status === "CANCELLED" || returned.status === "FATAL")
          ? {
              reportId: returned.reportId,
              documentId: null,
              status: returned.status,
              createdAt,
              terminal: returned.status,
              terminalAt: this.now(),
            }
          : returned?.reportId
          ? {
              reportId: returned.reportId,
              documentId: null,
              status: "CREATION_UNKNOWN",
              createdAt,
              terminal: "CREATION_UNKNOWN",
              terminalAt: this.now(),
            }
          : this.creationFailure(error, createdAt),
        updatedAt: this.now(),
      });
      throw error;
    }
  }

  private async pollLease(
    input: Omit<StatusInput, "signal"> & { signal: AbortSignal },
  ): Promise<DurableReportStatus> {
    assertActive(input.signal);
    let lease = await this.store.getSharedReportById({
      ...input.identity,
      reportId: input.reportId,
    });
    if (!lease || lease.mode !== input.identity.mode) {
      throw new SpApiError("這份報表不屬於目前帳號、站點或功能。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    const existingTerminal = this.terminalError(lease.report);
    if (existingTerminal) throw existingTerminal;

    try {
      const status = await input.poll({
        reportId: input.reportId,
        signal: input.signal,
      });
      assertActive(input.signal);
      this.assertStatus(status, input.identity, input.reportId);
      lease = await this.store.getSharedReportById({
        ...input.identity,
        reportId: input.reportId,
      });
      if (!lease || lease.mode !== input.identity.mode) {
        throw new SpApiError("報表 lifecycle 已變更，舊狀態不會覆蓋新工作。", {
          status: 409,
          code: "REPORT_MISMATCH",
        });
      }
      const terminal = this.terminalError(lease.report);
      if (terminal) throw terminal;
      const reportNotices = notices(input.notices);
      if (this.statusRank(lease.report.status) > this.statusRank(status.status)) {
        return this.leaseStatus(lease, reportNotices);
      }
      if (
        lease.report.status === "DONE" &&
        status.status === "DONE" &&
        lease.report.documentId
      ) {
        return this.leaseStatus(lease, reportNotices);
      }

      const now = this.now();
      if (
        lease.report.status !== status.status ||
        lease.report.documentId !== status.documentId ||
        lease.expiresAt - now <= this.nearExpiryMs
      ) {
        const persisted = await this.store.updateSharedReport({
          leaseId: lease.leaseId,
          report: {
            ...lease.report,
            status: status.status,
            documentId: status.documentId,
          },
          updatedAt: now,
          expectedUpdatedAt: lease.updatedAt,
          ...(lease.expiresAt - now <= this.nearExpiryMs
            ? { expiresAt: now + this.retentionMs }
            : {}),
        });
        const persistedTerminal = this.terminalError(persisted.report);
        if (persistedTerminal) throw persistedTerminal;
        if (this.statusRank(persisted.report.status) >= this.statusRank(status.status)) {
          return this.leaseStatus(persisted, reportNotices);
        }
      }
      return status;
    } catch (error) {
      const terminal = input.classifyTerminal?.(error) ?? defaultTerminal(error);
      if (terminal) {
        const latest = await this.store.getSharedReportById({
          ...input.identity,
          reportId: input.reportId,
        });
        if (
          latest &&
          latest.mode === input.identity.mode &&
          latest.report.status !== "DONE" &&
          latest.report.status !== "CANCELLED" &&
          latest.report.status !== "FATAL"
        ) {
          const now = this.now();
          const persisted = await this.store.updateSharedReport({
            leaseId: latest.leaseId,
            report: {
              ...latest.report,
              documentId: null,
              status: terminal,
              terminal,
              terminalAt: now,
            },
            updatedAt: now,
            expectedUpdatedAt: latest.updatedAt,
            expiresAt: Math.max(latest.expiresAt, now + this.retentionMs),
          });
          if (persisted.report.status === "DONE") {
            return this.leaseStatus(persisted, notices(input.notices));
          }
        }
      }
      throw error;
    }
  }

  private assertStatus(
    status: DurableReportGatewayStatus,
    identity: DurableReportIdentity,
    expectedReportId?: string,
  ): asserts status is DurableReportStatus {
    if (
      status.mode !== identity.mode ||
      !status.reportId ||
      (expectedReportId !== undefined && status.reportId !== expectedReportId)
    ) {
      throw new SpApiError("Amazon 報表回應與固定 lifecycle 不一致，已停止重送。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    if (status.status === "CANCELLED" || status.status === "FATAL") {
      if (status.ready || status.documentId !== null) {
        throw new SpApiError("Amazon 報表 terminal 回應格式無效，已停止重送。", {
          status: 409,
          code: "REPORT_MISMATCH",
        });
      }
      throw new SpApiError("Amazon 未能產生這份報表。", {
        status: 422,
        code: status.status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL",
      });
    }
    if (
      (status.status === "DONE" && (!status.ready || !status.documentId)) ||
      (status.status !== "DONE" && (status.ready || status.documentId !== null))
    ) {
      throw new SpApiError("Amazon 報表回應與固定 lifecycle 不一致，已停止重送。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
  }

  private reusable(report: DurableReportLeg): boolean {
    return Boolean(report.reportId) && report.terminal === null && (
      report.status === "IN_QUEUE" ||
      report.status === "IN_PROGRESS" ||
      (report.status === "DONE" && Boolean(report.documentId))
    );
  }

  private statusRank(status: DurableReportLeg["status"]): number {
    return status === "DONE" ? 3 : status === "IN_PROGRESS" ? 2 : status === "IN_QUEUE" ? 1 : 0;
  }

  private leaseStatus(
    lease: SharedReportLease,
    reportNotices: ReportNotices,
  ): DurableReportStatus {
    if (!lease.report.reportId) {
      throw new SpApiError("持久報表紀錄缺少 Amazon report ID。", {
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
    const ready = lease.report.status === "DONE" && Boolean(lease.report.documentId);
    return {
      mode: lease.mode,
      ready,
      reportId: lease.report.reportId,
      documentId: lease.report.documentId,
      status: lease.report.status as DurableReportStatus["status"],
      notice: ready ? reportNotices.done : reportNotices.pending,
    };
  }

  private creationFailure(error: unknown, createdAt: number): DurableReportLeg {
    const unknown = error instanceof SpExecutionContextAfterAdapterError ||
      !(error instanceof SpApiError) ||
      error.status >= 500 ||
      error.code === "UPSTREAM_UNAVAILABLE";
    const status = unknown ? "CREATION_UNKNOWN" : "CREATE_FAILED";
    return {
      reportId: null,
      documentId: null,
      status,
      createdAt,
      terminal: status,
      terminalAt: this.now(),
    };
  }

  private retryWait(report: DurableReportLeg, now: number): number {
    if (!["CREATING", "CREATION_UNKNOWN", "CANCELLED", "FATAL"].includes(report.status)) {
      return 0;
    }
    return Math.max(0, (report.createdAt ?? now) + this.retryGuardMs - now);
  }

  private retryRequired(report: DurableReportLeg): SpApiError {
    const code = report.terminal === "CANCELLED"
      ? "REPORT_CANCELLED"
      : report.terminal === "FATAL"
        ? "REPORT_FATAL"
        : "SHARED_REPORT_RETRY_REQUIRED";
    const message = code === "REPORT_CANCELLED"
      ? "Amazon 已取消上次報表；系統不會自動重建。"
      : code === "REPORT_FATAL"
        ? "Amazon 無法完成上次報表；請明確重試。"
        : "上次報表建立結果不完整；系統不會自動重送。";
    return new SpApiError(message, { status: 409, code });
  }

  private retryWaitError(milliseconds: number): SpApiError {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1_000));
    return new SpApiError(
      `Amazon 報表建立仍在 30 分鐘安全間隔內；請約 ${Math.ceil(seconds / 60)} 分鐘後再重試，系統不會重複建立。`,
      { status: 409, code: "REPORT_RETRY_WAIT", retryAfter: String(seconds) },
    );
  }

  private expiringError(milliseconds: number): SpApiError {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1_000));
    return new SpApiError(
      "既有 Amazon 報表已接近本機安全保留期；系統不會重用或提前重建，請稍後再試。",
      { status: 409, code: "REPORT_JOB_EXPIRING", retryAfter: String(seconds) },
    );
  }

  private terminalError(report: DurableReportLeg): SpApiError | null {
    if (report.status !== "CANCELLED" && report.status !== "FATAL") return null;
    return new SpApiError("Amazon 未能產生這份報表，請明確重試。", {
      status: 422,
      code: report.status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL",
    });
  }
}
