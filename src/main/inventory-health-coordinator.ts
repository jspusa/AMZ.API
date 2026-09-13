import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { InventoryHealthSnapshot } from "../shared/inventory-health";
import { throwIfAborted } from "./abort-utils";
import { bodyRecord, isPlainRecord, parseMarketplace } from "./route-input";
import { invalid, json, routeError } from "./route-response";
import type { PrivateLocalJsonPort } from "./private-local-json";
import type { InventoryHealthReportSnapshot } from "./amazon/aged-inventory-reads";
import { parseFbaExpiryCheckpoint, type FbaExpiryCheckpoint, type FbaExpiryEvidence } from "./amazon/fba-expiry-reads";
import { assessInventoryHealth, type InventoryHealthEvidence, type InventoryExpiryRecord } from "./amazon/inventory-health";
import { isDateOnly, marketplaceCalendar } from "./amazon/marketplace-calendar";
import { SpExecutionContextError, type SpExecutionContext, type SpExecutionContextAdapter } from "./amazon/sp-execution-context";

type Profile = InventoryHealthEvidence & { expiryCheckpoint?: FbaExpiryCheckpoint | null };
type HealthRefreshInput = { context: SpExecutionContext; snapshot: InventoryHealthReportSnapshot; signal: AbortSignal; onProgress?: (records: number) => void; onSourceError?: (error: unknown) => void };
type Saved = { schemaVersion: 1; profiles: Record<string, Profile> };
const scopeKey = (context: SpExecutionContext) => createHash("sha256").update(JSON.stringify([context.accountScope, context.mode, context.marketplaceId])).digest("hex");
const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 100000000;
const nullableCount = (n: unknown) => n === null || count(n);
const nullableDate = (n: unknown) => n === null || (typeof n === "string" && isDateOnly(n));
const timestamp = (n: unknown) => typeof n === "string" && n.length <= 40 && Number.isFinite(Date.parse(n));
const shortText = (n: unknown, max: number) => typeof n === "string" && n.length <= max && !/[\p{Cc}\p{Cf}]/u.test(n);
const money = (n: unknown) => n === null || (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1000000000);

function parseSaved(value: unknown): Saved {
  if (value === null) return { schemaVersion: 1, profiles: {} };
  if (!isPlainRecord(value) || value.schemaVersion !== 1 || !isPlainRecord(value.profiles) || Object.keys(value.profiles).length > 10) throw new Error("PRIVATE_LOCAL_INVALID");
  for (const [key, raw] of Object.entries(value.profiles)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !isPlainRecord(raw) || !parseMarketplace(raw.marketplaceId) || !["live", "demo"].includes(String(raw.mode)) || !timestamp(raw.fetchedAt) || typeof raw.sourceComplete !== "boolean" || !Array.isArray(raw.rows) || raw.rows.length > 10000 || !Array.isArray(raw.lots) || raw.lots.length > 10000) throw new Error("PRIVATE_LOCAL_INVALID");
    const checkpoint = parseFbaExpiryCheckpoint(raw.expiryCheckpoint);
    if (checkpoint && checkpoint.scopeFingerprint !== key) throw new Error("PRIVATE_LOCAL_INVALID");
    const ids = new Set<string>();
    for (const lot of raw.lots) {
      if (!isPlainRecord(lot) || !shortText(lot.id, 100) || ids.has(String(lot.id)) || !shortText(lot.sellerSku, 40) || !shortText(lot.asin, 10) || !nullableDate(lot.expiryDate) || !nullableDate(lot.stopSaleDate) || !(lot.manualExpiryDate === undefined || nullableDate(lot.manualExpiryDate)) || !nullableCount(lot.declaredQuantity) || !nullableCount(lot.confirmedRemaining) || !nullableDate(lot.confirmedForSnapshot) || !shortText(lot.sourceRef, 100) || !timestamp(lot.sourceUpdatedAt) || !timestamp(lot.observedAt)) throw new Error("PRIVATE_LOCAL_INVALID");
      if (lot.sourceLabel !== undefined && !shortText(lot.sourceLabel, 512)) throw new Error("PRIVATE_LOCAL_INVALID");
      ids.add(String(lot.id));
    }
    const skus = new Set<string>();
    for (const row of raw.rows) {
      if (!isPlainRecord(row) || !shortText(row.sellerSku, 40) || skus.has(String(row.sellerSku)) || !shortText(row.asin, 10) || !shortText(row.title, 4000) || !nullableCount(row.available) || !nullableCount(row.agedOver180) || !nullableCount(row.estimatedExcessQuantity) || !(row.currencyCode === null || (typeof row.currencyCode === "string" && /^[A-Z]{3}$/.test(row.currencyCode))) || !money(row.estimatedStorageCostNextMonth) || !money(row.estimatedAgedSurcharge) || !nullableDate(row.snapshotDate) || !(row.unitsShipped === undefined || (isPlainRecord(row.unitsShipped) && ["t7", "t30", "t60", "t90"].every(k => nullableCount((row.unitsShipped as Record<string, unknown>)[k]))))) throw new Error("PRIVATE_LOCAL_INVALID");
      skus.add(String(row.sellerSku));
    }
  }
  return structuredClone(value) as Saved;
}

export class InventoryHealthCoordinator {
  private saved: Saved | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private readonly failedScopes = new Set<string>();
  private readonly verifiedScopes = new Set<string>();
  private readonly verifiedStockScopes = new Set<string>();
  private readonly refreshOrder = new Map<string, number>();
  constructor(private readonly input: Readonly<{
    context: SpExecutionContextAdapter;
    expiry: { read(input: { context: SpExecutionContext; signal: AbortSignal; checkpoint?: unknown }): Promise<FbaExpiryEvidence> };
    store?: PrivateLocalJsonPort;
    now?: () => Date;
  }>) {}
  clear(): void {
    this.revision += 1;
    this.saved = null;
    this.refreshOrder.clear();
    this.verifiedScopes.clear();
    this.verifiedStockScopes.clear();
    // A security-context reset is not recovery from a failed health save.
    // Keep its scope marker until a new capture is safely saved.
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.queue.catch(() => undefined).then(operation);
    this.queue = work; return work;
  }
  private async fence(context: SpExecutionContext, revision: number): Promise<void> {
    await this.input.context.assertCurrent(context);
    if (revision !== this.revision) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "執行環境已更新，請重新讀取庫存健康。");
  }
  private async load(): Promise<Saved> {
    return this.saved ?? parseSaved(await this.input.store?.read() ?? null);
  }
  private async save(saved: Saved, context: SpExecutionContext, revision: number): Promise<void> {
    // Validate both source adapters and disk data at the same bounded persistence seam.
    const validated = parseSaved(saved);
    await this.fence(context, revision);
    try {
      await this.input.store?.write(validated, () => this.fence(context, revision));
    } catch (error) {
      await this.fence(context, revision);
      if (error instanceof SpExecutionContextError) throw error;
      // The file may already have been renamed before acknowledgement failed.
      // Discard the old cache and re-read disk during the next full capture.
      const key = scopeKey(context);
      this.verifiedScopes.delete(key);
      this.verifiedStockScopes.delete(key);
      this.failedScopes.add(key);
      this.saved = null;
      throw error;
    }
    await this.fence(context, revision);
    this.saved = validated;
  }
  private project(profile: Profile, key: string): InventoryHealthSnapshot {
    const snapshot = assessInventoryHealth({ ...profile, now: this.input.now?.() ?? new Date() });
    if (this.verifiedStockScopes.has(key)) return snapshot;
    const notice = "本次開啟尚未核對目前庫存，請同步全部 FBA 效期與銷速；原批次資料與確認仍保留，核對完成前暫停清售預估。";
    return {
      ...snapshot, stale: true, notice,
      rows: snapshot.rows.map(row => ({ ...row, status: "needs-review", reason: notice,
        calendarEligible: false, projectedShortfall: null, quantityDueByDate: null,
        minimumDailyUnits: null, wholeSkuClearanceDays: null, estimatedDailyUnits: null, stockRisk: "unknown" })),
    };
  }
  async refresh(input: HealthRefreshInput): Promise<void> {
    const revision = this.revision, key = scopeKey(input.context);
    const order = (this.refreshOrder.get(key) ?? 0) + 1;
    try { await this.performRefresh(input); }
    catch (error) {
      throwIfAborted(input.signal);
      await this.fence(input.context, revision);
      if (error instanceof SpExecutionContextError) throw error;
      // This optional source must not suppress a successfully read age report.
      // Its own GET/confirmation remains unavailable until a subsequent save succeeds.
      if (this.refreshOrder.get(key) === order) this.failedScopes.add(key);
    }
  }
  private async performRefresh(input: HealthRefreshInput): Promise<void> {
    const revision = this.revision;
    const refreshKey = scopeKey(input.context);
    const refreshOrder = (this.refreshOrder.get(refreshKey) ?? 0) + 1;
    this.refreshOrder.set(refreshKey, refreshOrder);
    this.verifiedScopes.delete(refreshKey);
    this.verifiedStockScopes.delete(refreshKey);
    await this.fence(input.context, revision);
    if (input.snapshot.marketplaceId !== input.context.marketplaceId || input.snapshot.mode !== input.context.mode) throw new Error("INVENTORY_HEALTH_CONTEXT");
    let checkpoint = await this.serial(async () => {
      const saved = await this.load();
      await this.fence(input.context, revision);
      return saved.profiles[refreshKey]?.expiryCheckpoint ?? null;
    });
    const startedAt = Date.now();
    for (let slice = 0; slice < 20; slice += 1) {
      await this.fence(input.context, revision); throwIfAborted(input.signal);
      if (this.refreshOrder.get(refreshKey) !== refreshOrder) return;
      let incoming: FbaExpiryEvidence = { records: [], complete: false };
      let failed = false;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 120000);
      timer.unref?.();
      try { incoming = await this.input.expiry.read({ context: input.context, signal: AbortSignal.any([input.signal, timeout.signal]), checkpoint }); }
      catch (error) {
        await this.fence(input.context, revision);
        throwIfAborted(input.signal);
        if (error instanceof SpExecutionContextError) throw error;
        failed = true;
        input.onSourceError?.(error);
        // Previously saved slices remain usable evidence, but failure suspends calendar forecasts.
      } finally { clearTimeout(timer); }
      checkpoint = incoming.checkpoint ?? checkpoint;
    await this.serial(async () => {
      await this.fence(input.context, revision); throwIfAborted(input.signal);
      if (this.refreshOrder.get(refreshKey) !== refreshOrder) return;
      const saved = structuredClone(await this.load());
      const key = scopeKey(input.context);
      const previous = saved.profiles[key];
      if (previous && Date.parse(previous.fetchedAt) > Date.parse(input.snapshot.fetchedAt)) return;
      const previousLots = new Map(previous?.lots.map(l => [l.id, l]) ?? []);
      const stocks = input.snapshot.rows.map(r => ({ sellerSku: r.sellerSku, asin: r.asin, title: r.title, available: r.available, agedOver180: r.agedOver180, estimatedExcessQuantity: r.estimatedExcessQuantity, currencyCode: r.currencyCode, estimatedStorageCostNextMonth: r.estimatedStorageCostNextMonth, estimatedAgedSurcharge: r.estimatedAgedSurcharge, snapshotDate: r.snapshotDate, unitsShipped: r.unitsShipped }));
      const oldStocks = new Map(previous?.rows.map(r => [r.sellerSku, r]) ?? []);
      const stockBySku = new Map(stocks.map(r => [r.sellerSku, r]));
      const lots = new Map<string, InventoryExpiryRecord>();
      for (const old of previousLots.values()) lots.set(old.id, { ...old, confirmedRemaining: null, confirmedForSnapshot: null });
      for (const record of incoming.records) {
        const old = previousLots.get(record.id);
        const same = old && old.sourceUpdatedAt === record.sourceUpdatedAt && old.declaredQuantity === record.declaredQuantity;
        lots.set(record.id, { ...record, manualExpiryDate: old?.manualExpiryDate ?? null, stopSaleDate: old?.stopSaleDate ?? null,
          confirmedRemaining: same ? old.confirmedRemaining : null, confirmedForSnapshot: same ? old.confirmedForSnapshot : null });
      }
      for (const old of previousLots.values()) if (old.sourceRef === "人工補登") lots.set(old.id, old);
      for (const [id, lot] of lots) {
        const stock = stockBySku.get(lot.sellerSku), oldStock = oldStocks.get(lot.sellerSku);
        if (!stock || !oldStock || stock.asin !== oldStock.asin || stock.available !== oldStock.available || stock.snapshotDate !== oldStock.snapshotDate || JSON.stringify(stock.unitsShipped) !== JSON.stringify(oldStock.unitsShipped)) lots.set(id, { ...lot, confirmedRemaining: null, confirmedForSnapshot: null });
      }
      saved.profiles[key] = { marketplaceId: input.context.marketplaceId, mode: input.context.mode, fetchedAt: input.snapshot.fetchedAt, sourceComplete: incoming.complete, rows: stocks, lots: [...lots.values()], expiryCheckpoint: checkpoint };
      await this.save(saved, input.context, revision);
      // Another refresh can begin while the encrypted write is awaiting I/O.
      if (this.revision !== revision || this.refreshOrder.get(refreshKey) !== refreshOrder) return;
      this.failedScopes.delete(key);
      this.verifiedStockScopes.add(key);
      if (incoming.complete) this.verifiedScopes.add(key);
      });
      input.onProgress?.(incoming.records.length);
      if (incoming.complete || failed || !checkpoint || Date.now() - startedAt >= 20 * 60000) return;
    }
  }
  async read(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (!marketplaceId || request.body || Object.keys(request.query).some(k => k !== "marketplaceId")) return invalid("請選擇庫存健康站點。");
    const revision = this.revision;
    try {
      const context = await this.input.context.capture(marketplaceId);
      return await this.serial(async () => {
        await this.fence(context, revision);
        if (this.failedScopes.has(scopeKey(context))) return invalid("庫存健康資料未能安全保存，自動清售提醒已暫停。請確認 Notebook Key 儲存空間與解鎖狀態後重新健檢；原庫齡報表仍可使用。", 503, "INVENTORY_HEALTH_UNAVAILABLE");
        const saved = await this.load();
        const profile = saved.profiles[scopeKey(context)];
        await this.fence(context, revision);
        return json({ snapshot: profile ? this.project(profile, scopeKey(context)) : null });
      });
    } catch (error) { return routeError(error, "無法讀取本機庫存健康資料。請確認 Notebook Key 儲存空間及解鎖狀態。"); }
  }
  async confirm(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request), marketplaceId = parseMarketplace(body?.marketplaceId);
    if (!body || !marketplaceId || Object.keys(body).some(k => !["marketplaceId", "id", "snapshotFetchedAt", "confirmedRemaining", "expiryDate", "stopSaleDate"].includes(k)) || !shortText(body.id, 100) || !timestamp(body.snapshotFetchedAt) || !nullableCount(body.confirmedRemaining) || !nullableDate(body.expiryDate) || !nullableDate(body.stopSaleDate) || (body.stopSaleDate !== null && (body.expiryDate === null || String(body.stopSaleDate) > String(body.expiryDate)))) return invalid("請填入有效效期、停售日與批次剩餘整數；未知數量請留空。");
    const revision = this.revision;
    try {
      const context = await this.input.context.capture(marketplaceId);
      return await this.serial(async () => {
        await this.fence(context, revision);
        if (this.failedScopes.has(scopeKey(context))) return invalid("本機庫存健康資料未能安全保存，請重新執行健檢。", 503, "INVENTORY_HEALTH_UNAVAILABLE");
        if (!this.verifiedScopes.has(scopeKey(context))) return invalid("請先同步全部 FBA 效期與銷速，核對目前庫存與入庫效期後再確認批次。", 409, "INVENTORY_HEALTH_REVALIDATION_REQUIRED");
        const saved = structuredClone(await this.load()), key = scopeKey(context), profile = saved.profiles[key];
        await this.fence(context, revision);
        if (!profile || profile.fetchedAt !== body.snapshotFetchedAt) return invalid("資料已更新，請重新開啟這筆確認。", 409, "INVENTORY_HEALTH_STALE");
        const snapshot = assessInventoryHealth({ ...profile, now: this.input.now?.() ?? new Date() });
        const row = snapshot.rows.find(r => r.id === body.id);
        if (!row || snapshot.stale || row.snapshotDate === null || !count(row.available)) return invalid("庫存資料不完整或已過期，請重新執行健檢。", 409, "INVENTORY_HEALTH_STALE");
        const calendar = marketplaceCalendar(marketplaceId);
        const age = calendar.inclusiveDayCount(row.snapshotDate, calendar.dayAt(this.input.now?.() ?? new Date()));
        if (age < 1 || age > 3) return invalid("報表日期已過期，請重新執行健檢。", 409, "INVENTORY_HEALTH_STALE");
        const existing = profile.lots.find(l => l.id === row.id);
        const total = profile.lots.filter(l => l.id !== row.id && l.sellerSku === row.sellerSku && l.asin === row.asin && l.confirmedForSnapshot === row.snapshotDate).reduce((sum, l) => sum + (l.confirmedRemaining ?? 0), 0) + (body.confirmedRemaining as number | null ?? 0);
        if (total > row.available) return invalid("所有已確認批次餘量的合計超過目前可售庫存，請核對後再儲存。");
        const now = (this.input.now?.() ?? new Date()).toISOString();
        const next: InventoryExpiryRecord = { ...(existing ?? { id: row.id, sellerSku: row.sellerSku, asin: row.asin, expiryDate: null, declaredQuantity: null, sourceRef: "人工補登", sourceUpdatedAt: now, observedAt: now }),
          manualExpiryDate: body.expiryDate as string | null, stopSaleDate: body.stopSaleDate as string | null,
          confirmedRemaining: body.confirmedRemaining as number | null, confirmedForSnapshot: body.confirmedRemaining === null ? null : row.snapshotDate };
        saved.profiles[key] = { ...profile, lots: [...profile.lots.filter(l => l.id !== row.id), next] };
        await this.save(saved, context, revision);
        return json({ snapshot: this.project(saved.profiles[key]!, key) });
      });
    } catch (error) { return routeError(error, "無法儲存本機批次確認。請確認 Notebook Key 儲存空間及解鎖狀態。"); }
  }
}
