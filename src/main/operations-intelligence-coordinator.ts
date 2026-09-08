import { randomUUID } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import { OPERATIONS_SOURCES, type OperationsFbaIdentity, type OperationsIntelligenceSnapshot, type OperationsSource, type OperationsSourceState } from "../shared/operations-intelligence";
import { SpExecutionContextError, type SpExecutionContext, type SpExecutionContextAdapter } from "./amazon/sp-execution-context";
import { OperationsEvents } from "./operations-events";
import type { OperationsSourceReaders } from "./operations-source-readers";
import { bodyRecord, parseMarketplace } from "./route-input";
import { invalid, json } from "./route-response";
import { publicSpApiError, SpApiError } from "./amazon/sp-api-error";
import { throwIfAborted, waitForPromiseWithSignal } from "./abort-utils";

type Session = {
  id: string;
  context: SpExecutionContext;
  controller: AbortController;
  sources: Record<OperationsSource, OperationsSourceState>;
  events: OperationsEvents;
  autoSync: boolean;
  fbaFlight?: Promise<readonly OperationsFbaIdentity[]>;
  jobs: Map<OperationsSource, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>;
  schedule: Map<OperationsSource, ReturnType<typeof setTimeout>>;
};
export interface OperationsIntelligencePort {
  observe(request: ApiRequest): Promise<ApiResponse>;
  start(request: ApiRequest): Promise<ApiResponse>;
  acknowledge(request: ApiRequest): Promise<ApiResponse>;
  clear(): void;
}

/** Owns only local observation jobs and events; report lifecycles stay upstream. */
export class OperationsIntelligenceCoordinator implements OperationsIntelligencePort {
  private readonly sessions = new Map<string, Session>();
  private revision = 0;
  private readonly context: SpExecutionContextAdapter;
  private readonly readers: OperationsSourceReaders;
  private readonly now: () => number;
  constructor(input: { context: SpExecutionContextAdapter; readers: OperationsSourceReaders; now?: () => number }) {
    this.context = input.context;
    this.readers = input.readers;
    this.now = input.now ?? Date.now;
  }

  private async session(marketplaceId: Parameters<SpExecutionContextAdapter["capture"]>[0]): Promise<Session> {
    const revision = this.revision;
    const context = await this.context.capture(marketplaceId);
    await this.context.assertCurrent(context);
    if (revision !== this.revision) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "營運資料安全脈絡已更新，請重新同步。");
    const previous = this.sessions.get(marketplaceId);
    if (previous && previous.context.accountScope === context.accountScope && previous.context.mode === context.mode && previous.context.generation === context.generation) return previous;
    if (previous) this.stopSession(previous);
    const session: Session = {
      id: `operations.${randomUUID()}`, context, controller: new AbortController(), autoSync: false, jobs: new Map(), schedule: new Map(),
      events: new OperationsEvents(context),
      sources: Object.fromEntries(OPERATIONS_SOURCES.map((source) => [source, {
        source, status: "never", startedAt: null, fetchedAt: null, nextSyncAt: null,
        message: "尚未同步；不代表沒有資料或異常。", snapshot: null,
      }])) as Record<OperationsSource, OperationsSourceState>,
    };
    this.sessions.set(marketplaceId, session);
    return session;
  }

  private snapshot(session: Session): OperationsIntelligenceSnapshot {
    return structuredClone({
      schemaVersion: 1, marketplaceId: session.context.marketplaceId, mode: session.context.mode,
      contextId: session.id, observedAt: new Date(this.now()).toISOString(), autoSync: session.autoSync,
      sources: session.sources, ...session.events.read(),
      notice: "Notebook Key 開啟期間的本機同步通知，非 Amazon 推播；關閉、鎖定、睡眠或切換安全脈絡後停止並清除。本機記憶體保留最多 5,000 筆事件、投影 500 筆；不是永久歷史記錄，不會上傳至人工公布欄。",
    });
  }

  async observe(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId || request.body || Object.keys(request.query).some((key) => key !== "marketplaceId")) return invalid("營運資料查詢格式無效。");
    return json(this.snapshot(await this.session(marketplaceId)));
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId || Object.keys(request.query).length ||
      Object.keys(body).some((key) => !["marketplaceId", "source", "autoSync"].includes(key)) ||
      (body.autoSync !== undefined && typeof body.autoSync !== "boolean") ||
      !(body.source === "all" || OPERATIONS_SOURCES.includes(body.source as OperationsSource) || (body.source === undefined && typeof body.autoSync === "boolean"))) {
      return invalid("營運同步請求格式無效。");
    }
    const session = await this.session(marketplaceId);
    if (session.context.mode !== "live") return invalid("請連接 Notebook Key 的真實 Amazon 帳號；本區不以展示資料冒充營運結果。", 422, "OPERATIONS_LIVE_REQUIRED");
    if (typeof body.autoSync === "boolean") {
      session.autoSync = body.autoSync;
      for (const source of OPERATIONS_SOURCES) this.schedule(session, source);
    }
    if (body.source !== undefined) for (const source of body.source === "all" ? OPERATIONS_SOURCES : [body.source as OperationsSource]) this.launch(session, source);
    return json(this.snapshot(session), body.source === undefined ? 200 : 202);
  }

  private async checkpoint(session: Session, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.context.assertCurrent(session.context);
    throwIfAborted(signal);
    if (this.sessions.get(session.context.marketplaceId) !== session) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "營運同步工作已失效。");
  }

  private launch(session: Session, source: OperationsSource): void {
    if (session.sources[source].status === "running" || session.controller.signal.aborted) return;
    clearTimeout(session.schedule.get(source));
    session.schedule.delete(source);
    const controller = new AbortController();
    const duration = source === "advertising" ? 195 * 60_000 : 30 * 60_000;
    const timer = setTimeout(() => controller.abort(new Error("營運同步等待逾時。")), duration);
    timer.unref?.();
    session.jobs.set(source, { controller, timer });
    session.sources[source] = { ...session.sources[source], status: "running", startedAt: new Date(this.now()).toISOString(), nextSyncAt: null, message: "正在核對 FBA 範圍並同步官方資料；可離開面板，主程序會繼續工作。" };
    void this.run(session, source, controller, timer);
  }

  private async run(session: Session, source: OperationsSource, controller: AbortController, timer: ReturnType<typeof setTimeout>): Promise<void> {
    const signal = AbortSignal.any([controller.signal, session.controller.signal]);
    try {
      await this.checkpoint(session, signal);
      let fba: readonly OperationsFbaIdentity[] = [];
      if (source !== "advertising") {
        if (!session.fbaFlight) {
          const flight = this.readers.fba(session.context, session.controller.signal);
          session.fbaFlight = flight;
          void flight.finally(() => { if (session.fbaFlight === flight) session.fbaFlight = undefined; }).catch(() => undefined);
        }
        fba = await waitForPromiseWithSignal(session.fbaFlight, signal);
      }
      await this.checkpoint(session, signal);
      const snapshot = structuredClone(await waitForPromiseWithSignal(this.readers.read(source, { context: session.context, fba, signal }), signal));
      await this.checkpoint(session, signal);
      const timestamp = Date.parse(snapshot.fetchedAt);
      const previousTime = Date.parse(session.sources[source].fetchedAt ?? "");
      if (snapshot.marketplaceId !== session.context.marketplaceId || snapshot.mode !== session.context.mode ||
        !Number.isFinite(timestamp) || timestamp > this.now() + 300_000 ||
        (Number.isFinite(previousTime) && timestamp < previousTime)) {
        throw new SpApiError("營運資料站點、模式或同步時間無法核對。", { status: 409, code: "OPERATIONS_SOURCE_MISMATCH" });
      }
      session.events.observe(source, snapshot);
      session.sources[source] = { ...session.sources[source], status: snapshot.coverage, fetchedAt: snapshot.fetchedAt, snapshot,
        message: snapshot.coverage === "complete" ? "同步完成；請依資料來源與觀察時間判讀。" : "部分資料未完成；缺值不代表零，也不會解除未確認的異常。" };
    } catch (error) {
      if (session.controller.signal.aborted || this.sessions.get(session.context.marketplaceId) !== session) return;
      try { await this.context.assertCurrent(session.context); } catch { this.clear(); return; }
      if (this.sessions.get(session.context.marketplaceId) !== session) return;
      const safeMessage = error instanceof SpApiError
        ? publicSpApiError(error, "官方資料暫時無法完成同步。").message
        : "同步未完成或已逾時；保留上次結果，缺值不會補零。";
      const message = safeMessage.length > 1_024 ? "官方資料暫時無法完成同步；請核對來源狀態後手動再試。" : safeMessage;
      session.sources[source] = { ...session.sources[source], status: "failed", message };
      session.events.observe(source, { marketplaceId: session.context.marketplaceId, mode: session.context.mode, fetchedAt: new Date(this.now()).toISOString(), coverage: "partial", warnings: [], findings: [{ source, key: `${source}-sync-failure`, sellerSku: null, severity: "warning", title: "同步未完成", detail: message }] });
    } finally {
      clearTimeout(timer);
      if (session.jobs.get(source)?.controller === controller) {
        session.jobs.delete(source);
        this.schedule(session, source);
      }
    }
  }

  private schedule(session: Session, source: OperationsSource): void {
    clearTimeout(session.schedule.get(source));
    session.schedule.delete(source);
    session.sources[source] = { ...session.sources[source], nextSyncAt: null };
    if (!session.autoSync || session.controller.signal.aborted || this.sessions.get(session.context.marketplaceId) !== session ||
      session.sources[source].status === "never" || session.sources[source].status === "running" || session.sources[source].status === "failed") return;
    const interval = source === "advertising" ? 60 * 60_000 : 15 * 60_000;
    session.sources[source] = { ...session.sources[source], nextSyncAt: new Date(this.now() + interval).toISOString() };
    const timer = setTimeout(() => { session.schedule.delete(source); this.launch(session, source); }, interval);
    timer.unref?.();
    session.schedule.set(source, timer);
  }
  async acknowledge(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    const marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId || Object.keys(request.query).length ||
      Object.keys(body).some((key) => !["marketplaceId", "eventId", "status"].includes(key)) ||
      typeof body.eventId !== "string" || !/^event\.[0-9a-f-]{36}$/u.test(body.eventId) ||
      (body.status !== "open" && body.status !== "acknowledged")) return invalid("通知處理請求格式無效。");
    const session = await this.session(marketplaceId);
    if (!session.events.acknowledge(body.eventId, body.status)) return invalid("找不到目前工作階段可處理的通知。", 404, "OPERATIONS_EVENT_NOT_FOUND");
    return json(this.snapshot(session));
  }

  clear(): void {
    this.revision += 1;
    for (const session of this.sessions.values()) this.stopSession(session);
    this.sessions.clear();
  }

  private stopSession(session: Session): void {
    session.controller.abort(); session.events.clear();
    for (const job of session.jobs.values()) { clearTimeout(job.timer); job.controller.abort(); }
    for (const timer of session.schedule.values()) clearTimeout(timer);
    session.jobs.clear(); session.schedule.clear();
  }
}
