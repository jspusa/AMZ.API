import { randomUUID } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { InventoryHealthSyncJob } from "../shared/inventory-health-sync";
import { isInventoryHealthSnapshot } from "../shared/inventory-health";
import type { AgedInventoryReadsPort } from "./amazon/aged-inventory-reads";
import { publicSpApiError, SpApiError } from "./amazon/sp-api-error";
import { SpExecutionContextError, type SpExecutionContext, type SpExecutionContextAdapter } from "./amazon/sp-execution-context";
import { abortableDelay, throwIfAborted } from "./abort-utils";
import type { InventoryHealthCoordinator } from "./inventory-health-coordinator";
import { bodyRecord, isPlainRecord, parseMarketplace } from "./route-input";
import { invalid, json, routeError } from "./route-response";

type Job = { public: InventoryHealthSyncJob; context: SpExecutionContext; revision: number; controller: AbortController; expiresAt: number };
const sameContext = (a: SpExecutionContext, b: SpExecutionContext) => a.accountScope === b.accountScope && a.marketplaceId === b.marketplaceId && a.mode === b.mode && a.generation === b.generation;

/** User-started inventory health work. GET only observes; ReportsRuntime owns all report leases and transport. */
export class InventoryHealthSync {
  private revision = 0;
  private readonly jobs = new Map<string, Job>();
  constructor(private readonly input: Readonly<{
    context: SpExecutionContextAdapter;
    reads: AgedInventoryReadsPort;
    health: Pick<InventoryHealthCoordinator, "refresh" | "read">;
    now?: () => number;
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
    pollLimit?: number;
  }>) {
    if (input.pollLimit !== undefined && (!Number.isSafeInteger(input.pollLimit) || input.pollLimit < 1 || input.pollLimit > 900)) throw new Error("Inventory health poll limit must be between 1 and 900.");
  }
  clear(): void {
    this.revision += 1;
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
  }
  private now() { return this.input.now?.() ?? Date.now(); }
  private async fence(job: Job) {
    await this.input.context.assertCurrent(job.context);
    throwIfAborted(job.controller.signal);
    if (job.revision !== this.revision || this.jobs.get(job.context.marketplaceId) !== job) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "庫存健康環境已更新，請重新同步。");
  }
  private current(context: SpExecutionContext): Job | null {
    const job = this.jobs.get(context.marketplaceId);
    if (!job) return null;
    if (!sameContext(job.context, context) || (job.public.status !== "running" && job.expiresAt < this.now())) {
      job.controller.abort(); this.jobs.delete(context.marketplaceId); return null;
    }
    return job;
  }
  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request), marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId || Object.keys(body).some(k => k !== "marketplaceId")) return invalid("請選擇庫存健康站點。");
    const revision = this.revision;
    try {
      const context = await this.input.context.capture(marketplaceId);
      if (revision !== this.revision) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "執行環境已更新。");
      await this.input.context.assertCurrent(context);
      if (revision !== this.revision) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "執行環境已更新。");
      const existing = this.current(context);
      if (existing?.public.status === "running") return json({ job: { ...existing.public } }, 202);
      const job: Job = { context, revision, controller: new AbortController(), expiresAt: Infinity,
        public: { id: randomUUID(), marketplaceId, mode: context.mode, status: "running", stage: "report", message: "正在讀取全部 FBA 庫存與銷量報表…", error: null } };
      this.jobs.set(marketplaceId, job);
      const response = json({ job: { ...job.public } }, 202);
      void this.run(job);
      return response;
    } catch (error) { return routeError(error, "無法啟動庫存健康同步。"); }
  }
  async observe(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId || request.body || Object.keys(request.query).some(k => !["marketplaceId", "jobId"].includes(k)) || (request.query.jobId !== undefined && (typeof request.query.jobId !== "string" || request.query.jobId.length > 64))) return invalid("庫存健康工作資訊無效。");
    const revision = this.revision;
    try {
      const context = await this.input.context.capture(marketplaceId);
      await this.input.context.assertCurrent(context);
      if (revision !== this.revision) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "執行環境已更新。");
      const job = this.current(context);
      if (request.query.jobId && job?.public.id !== request.query.jobId) return invalid("庫存健康工作已更新或過期，請重新讀取。", 409, "INVENTORY_HEALTH_JOB_CHANGED");
      return json({ job: job ? { ...job.public } : null });
    } catch (error) { return routeError(error, "無法讀取庫存健康工作狀態。"); }
  }
  private async run(job: Job): Promise<void> {
    try {
      await this.fence(job);
      const request = { marketplaceId: job.context.marketplaceId, expectedContext: job.context, signal: job.controller.signal };
      let report = await this.input.reads.begin({ ...request, explicitRetry: true, freshCompleted: true });
      for (let attempt = 0; !report.ready && attempt < (this.input.pollLimit ?? 900); attempt += 1) {
        await this.fence(job);
        if (!["IN_QUEUE", "IN_PROGRESS"].includes(report.status)) throw new SpApiError("Amazon 未完成庫存健康報表，請檢查報表權限後再明確重試。", { code: "INVENTORY_REPORT_NOT_READY", status: 502 });
        await (this.input.wait ?? abortableDelay)(2000, job.controller.signal);
        report = await this.input.reads.status({ ...request, reportId: report.reportId });
      }
      await this.fence(job);
      if (!report.ready || !report.documentId || report.mode !== job.context.mode) throw new SpApiError("庫存與銷量報表尚未完成，稍後可再次同步以接續既有報表。", { code: "INVENTORY_REPORT_NOT_READY", status: 504 });
      const snapshot = await this.input.reads.read({ ...request, reportId: report.reportId, documentId: report.documentId });
      await this.fence(job);
      job.public = { ...job.public, stage: "expiry", message: `已取得 ${snapshot.rows.length} 個 FBA 品項，正在整理入庫申報效期…` };
      let sourceError: InventoryHealthSyncJob["error"] = null;
      await this.input.health.refresh({ context: job.context, snapshot, signal: job.controller.signal,
        onProgress: records => { if (!job.controller.signal.aborted && job.revision === this.revision) job.public = { ...job.public, message: `正在整理入庫申報效期（已讀取 ${records} 筆）…` }; },
        onSourceError: error => {
          const safe = error instanceof SpApiError ? publicSpApiError(error, "入庫效期來源讀取未完成，可稍後接續。") : { code: "INBOUND_EXPIRY_UNAVAILABLE", message: "入庫效期來源讀取未完成，可稍後接續。" };
          sourceError = { code: safe.code, message: safe.message };
        },
      });
      await this.fence(job);
      const response = await this.input.health.read({ requestId: job.public.id, method: "GET", path: "/api/inventory-health", query: { marketplaceId: job.context.marketplaceId }, headers: {} });
      await this.fence(job);
      const value = response.body.value;
      if (response.status !== 200 || !isPlainRecord(value) || !isInventoryHealthSnapshot(value.snapshot)) throw new SpApiError("本機庫存健康資料未能安全保存，請檢查儲存空間及解鎖狀態。", { code: "INVENTORY_HEALTH_UNAVAILABLE", status: 503 });
      job.public = { ...job.public, status: value.snapshot.sourceComplete && !value.snapshot.stale ? "completed" : "partial", stage: "complete",
        error: sourceError,
        message: value.snapshot.sourceComplete && !value.snapshot.stale ? "全部 FBA 庫存與可取得的入庫效期已整理。" : "已保留 FBA 庫存估算；效期來源尚未完整，可再次同步接續。" };
    } catch (error) {
      if (job.controller.signal.aborted || job.revision !== this.revision || this.jobs.get(job.context.marketplaceId) !== job) return;
      try { await this.fence(job); } catch { if (this.jobs.get(job.context.marketplaceId) === job) this.jobs.delete(job.context.marketplaceId); return; }
      const fallback = job.public.stage === "report" ? "庫存與銷量報表未完成，請稍後明確重試。" : "入庫效期整理未完成，請稍後明確重試。";
      const failure = error instanceof SpApiError ? publicSpApiError(error, fallback) : { code: "INVENTORY_HEALTH_SYNC_FAILED", message: fallback };
      job.public = { ...job.public, status: "failed", message: failure.message, error: { code: failure.code, message: failure.message } };
    } finally { if (job.public.status !== "running") job.expiresAt = this.now() + 30 * 60000; }
  }
}
