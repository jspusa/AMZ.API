import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import { parseVineImport, validVineEnrollment, VineInputError, type VineRecord, type VineSnapshot } from "../shared/vine";
import { throwIfAborted, waitForPromiseWithSignal } from "./abort-utils";
import { marketplaceCalendar } from "./amazon/marketplace-calendar";
import { SpApiError } from "./amazon/sp-api-error";
import { SpExecutionContextError, type SpExecutionContext, type SpExecutionContextAdapter } from "./amazon/sp-execution-context";
import type { PrivateLocalJsonPort } from "./private-local-json";
import { bodyRecord } from "./route-input";
import { invalid, json } from "./route-response";
const US = "ATVPDKIKX0DER" as const;
type Persisted = { schemaVersion: 1; profiles: Record<string, VineRecord[]> };
type Dependencies = { context: SpExecutionContextAdapter; fba(context: SpExecutionContext, signal: AbortSignal): Promise<readonly { sellerSku: string; asin: string }[]>; store?: PrivateLocalJsonPort; now?: () => number };
const isUnavailable = (error: unknown) => error instanceof Error && error.message === "PRIVATE_LOCAL_UNAVAILABLE";
const keyOf = (row: VineRecord) => JSON.stringify([row.sellerSku, row.asin, row.enrollmentDate]);

/** Local manual Vine evidence only. FBA validation reuses the catalog owner; no Vine/Orders write or private endpoint. */
export class VineProgressOwner {
  private data: Persisted | null = null;
  private revision = 0;
  private busy = false;
  private controller = new AbortController();
  private storage: VineSnapshot["storage"];
  private readonly now: () => number;
  constructor(private readonly dependencies: Dependencies) {
    this.storage = dependencies.store ? "encrypted-local" : "session-only";
    this.now = dependencies.now ?? Date.now;
  }
  private async checkpoint(context: SpExecutionContext, revision: number): Promise<void> {
    await this.dependencies.context.assertCurrent(context);
    if (revision !== this.revision) throw new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "本次 Vine 資料環境已更新，請重新開啟。");
  }
  private scope(context: SpExecutionContext): string {
    return createHash("sha256").update(JSON.stringify(["vine-v1", context.accountScope, context.mode, context.marketplaceId])).digest("hex");
  }
  private async load(context: SpExecutionContext, revision: number): Promise<void> {
    if (this.data) return;
    let value: unknown = null;
    try { value = this.dependencies.store ? await this.dependencies.store.read() : null; }
    catch (error) {
      await this.checkpoint(context, revision);
      if (!isUnavailable(error)) throw new SpApiError("本機 Vine 加密資料無法讀取，原檔已保留；請先處理儲存問題。", { status: 409, code: "VINE_STORAGE_UNREADABLE" });
      this.storage = "session-only";
    }
    await this.checkpoint(context, revision);
    const today = marketplaceCalendar(US).dayAt(new Date(this.now()));
    if (value !== null && !this.validPersisted(value, today)) throw new SpApiError("本機 Vine 資料格式無法確認，原檔已保留。", { status: 409, code: "VINE_STORAGE_INVALID" });
    if (!this.data) this.data = value as Persisted | null ?? { schemaVersion: 1, profiles: {} };
  }
  private validPersisted(value: unknown, today: string): value is Persisted {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const data = value as Persisted;
    if (Object.keys(value).sort().join(",") !== "profiles,schemaVersion" || data.schemaVersion !== 1 || !data.profiles || typeof data.profiles !== "object" || Array.isArray(data.profiles) || Object.keys(data.profiles).length > 20) return false;
    return Object.entries(data.profiles).every(([key, rows]) =>
      /^[a-f0-9]{64}$/u.test(key) && Array.isArray(rows) && rows.length <= 1_000 &&
      rows.every((row) => validVineEnrollment(row, today) &&
        Object.keys(row).sort().join(",") === "asin,claimed,enrolled,enrollmentDate,importedAt,reviews,sellerSku" &&
        typeof row.importedAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.importedAt) &&
        Number.isFinite(Date.parse(row.importedAt)) &&
        new Date(row.importedAt).toISOString() === row.importedAt &&
        Date.parse(row.importedAt) <= this.now() + 1_000) &&
      new Set(rows.map(keyOf)).size === rows.length);
  }
  private snapshot(context: SpExecutionContext): VineSnapshot {
    const calendar = marketplaceCalendar(US);
    const endDate = calendar.dayAt(new Date(this.now()));
    const startDate = calendar.shiftDate(endDate, -59);
    const all = this.data!.profiles[this.scope(context)] ?? [];
    return {
      schemaVersion: 1, marketplaceId: US, source: "seller-central-manual", storage: this.storage,
      storageNotice: this.storage === "encrypted-local" ? "只保存在這台 Notebook Key 的加密檔案。" : "加密儲存目前不可用；資料只保留此工作階段，關閉、鎖定或切換帳號後需重新匯入。",
      window: { startDate, endDate }, rows: structuredClone(all.filter((row) => row.enrollmentDate >= startDate && row.enrollmentDate <= endDate).sort((a, b) => b.enrollmentDate.localeCompare(a.enrollmentDate) || a.sellerSku.localeCompare(b.sellerSku))),
      updatedAt: all.map((row) => row.importedAt).sort().at(-1) ?? null,
    };
  }
  async observe(request: ApiRequest): Promise<ApiResponse> {
    if (request.body || Object.keys(request.query).length) return invalid("Vine 查詢不接受帳號或商品參數。");
    const revision = this.revision;
    const context = await this.dependencies.context.capture(US);
    await this.checkpoint(context, revision);
    await this.load(context, revision);
    await this.checkpoint(context, revision);
    return json(this.snapshot(context));
  }
  async import(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body || Object.keys(body).length !== 1 || typeof body.text !== "string" || Object.keys(request.query).length) return invalid("請貼上或匯入 Vine CSV／TSV 文字。");
    if (this.busy) return invalid("另一份 Vine 資料正在核對，請等待完成。", 409, "VINE_BUSY");
    this.busy = true;
    const revision = this.revision;
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(240_000)]);
    try {
      const context = await this.dependencies.context.capture(US);
      await this.checkpoint(context, revision);
      if (context.mode !== "live") return invalid("請連接 US Amazon 真實帳號，才能核對 Vine 商品的 FBA 身分。", 422, "VINE_LIVE_REQUIRED");
      const parsed = parseVineImport(body.text, marketplaceCalendar(US).dayAt(new Date(this.now())));
      await this.load(context, revision);
      await this.checkpoint(context, revision);
      if (!parsed.rows.length) return json({ ...this.snapshot(context), importResult: { accepted: 0, rejected: parsed.rejected } });
      const fba = await waitForPromiseWithSignal(this.dependencies.fba(context, signal), signal);
      await this.checkpoint(context, revision);
      throwIfAborted(signal);
      const identities = new Map(fba.map((item) => [item.sellerSku, item.asin]));
      if (fba.length > 5_000 || identities.size !== fba.length) throw new SpApiError("FBA 身分資料無法唯一核對。", { status: 422, code: "VINE_FBA_INVALID" });
      const accepted = parsed.rows.filter(({ value, line }) => {
        if (identities.get(value.sellerSku) === value.asin) return true;
        parsed.rejected.push({ line, message: "目前 US FBA 清單找不到完全相同的 Seller SKU／ASIN；此列未匯入。" });
        return false;
      });
      if (accepted.length) {
        const next = structuredClone(this.data!);
        const scope = this.scope(context);
        const rows = new Map((next.profiles[scope] ?? []).map((row) => [keyOf(row), row]));
        const importedAt = new Date(this.now()).toISOString();
        for (const { value } of accepted) { const row = { ...value, importedAt }; rows.set(keyOf(row), row); }
        if (rows.size > 1_000 || (!next.profiles[scope] && Object.keys(next.profiles).length >= 20)) return invalid("本機 Vine 資料已達保存上限，未覆蓋既有資料。", 409, "VINE_CAPACITY");
        next.profiles[scope] = [...rows.values()];
        await this.checkpoint(context, revision);
        if (this.storage === "encrypted-local" && this.dependencies.store) {
          try { await this.dependencies.store.write(next, () => this.checkpoint(context, revision)); }
          catch (error) {
            await this.checkpoint(context, revision);
            if (!isUnavailable(error)) throw new SpApiError("Vine 加密保存未完成，既有資料保留；請重新讀取確認。", { status: 409, code: "VINE_STORAGE_WRITE_FAILED" });
            this.storage = "session-only";
          }
        }
        await this.checkpoint(context, revision);
        throwIfAborted(signal);
        this.data = next;
      }
      return json({ ...this.snapshot(context), importResult: { accepted: accepted.length, rejected: parsed.rejected.sort((a, b) => a.line - b.line) } });
    } catch (error) {
      if (error instanceof VineInputError) return invalid(error.message, 422, "VINE_IMPORT_INVALID");
      throw error;
    } finally { this.busy = false; }
  }
  clear(): void {
    this.revision++;
    this.controller.abort();
    this.controller = new AbortController();
    this.data = null;
    this.storage = this.dependencies.store ? "encrypted-local" : "session-only";
  }
}
