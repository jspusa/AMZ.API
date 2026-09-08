import { createHash } from "node:crypto";
import type { AmazonPromotion, AmazonPromotionIssue, AmazonPromotionRevision, AmazonPromotionStatus, AmazonPromotionsSnapshot } from "../../shared/amazon-promotions";
import type { OperationsFbaIdentity, OperationsFinding } from "../../shared/operations-intelligence";
import type { OperationsReadInput } from "./operations-read-context";
import type { SpExecutionContext, SpExecutionContextAdapter } from "./sp-execution-context";
import { throwIfAborted } from "../abort-utils";
import { publicSpApiError, publicSpApiIssueIdentifier, SpApiError } from "./sp-api-error";

// Independent implementation against Amazon Models 3659f968 (Apache-2.0).
// Bizon 1a340fd1 is a client-shape reference only; no third-party code copied.
// Exact sources: docs/research/2026-09-08-amazon-operations-sources.md.
const MAX_SEARCH_PAGES = 20;
const MAX_PROMOTIONS = 100;
const MAX_SELECTION_PAGES = 50;
const MAX_REQUESTS = 300;
const MAX_ITEMS = 5_000;
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
function invalid(): SpApiError {
  return new SpApiError("Amazon 促銷資料結構或身分不一致，已停止合併。", { status: 502, code: "PROMOTIONS_INVALID_RESPONSE" });
}
function privateId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\u0000-\u0020\u007f]/u.test(value);
}
function date(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? value : null;
}
function nextToken(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const pagination = object(value);
  if (!pagination || typeof pagination.nextToken !== "string" || pagination.nextToken.length < 1 || pagination.nextToken.length > 8192 || pagination.nextToken !== pagination.nextToken.trim() || /[\u0000-\u0020\u007f]/u.test(pagination.nextToken)) throw invalid();
  return pagination.nextToken;
}
function issues(value: unknown): readonly AmazonPromotionIssue[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const output: AmazonPromotionIssue[] = [];
  for (const raw of value) {
    const issue = object(raw);
    if (!issue) return null;
    output.push({ code: publicSpApiIssueIdentifier(issue.code), severity: issue.severity === "ERROR" || issue.severity === "WARNING" ? issue.severity : "UNKNOWN" });
  }
  return output;
}
function publicTitle(value: unknown, privateValues: readonly string[]): string {
  if (typeof value !== "string" || value.length > 180) return "Amazon 促銷（名稱未提供）";
  if (privateValues.some((privateValue) => privateValue.length > 0 && value.includes(privateValue))) return "Amazon 促銷（名稱已隱去）";
  const safe = publicSpApiError(new SpApiError(value, { status: 502, code: "PROMOTIONS_TITLE" }), "Amazon 促銷（名稱已隱去）").message;
  return safe === value ? safe : "Amazon 促銷（名稱已隱去）";
}
function status(value: unknown): AmazonPromotionStatus {
  return ["PROCESSING", "UPCOMING", "RUNNING", "EXPIRED", "FAILED", "CANCELLING", "CANCELLED"].includes(String(value)) ? value as AmazonPromotionStatus : "UNKNOWN";
}

export type PromotionsReadPlan = Readonly<{
  context: SpExecutionContext;
  signal: AbortSignal;
  assertCurrent(): Promise<void>;
}>;
export type PromotionsSearchPlan = PromotionsReadPlan & Readonly<{ paginationToken?: string }>;
export type PromotionDetailPlan = PromotionsReadPlan & Readonly<{ promotionId: string }>;
export type PromotionSelectionPlan = PromotionDetailPlan & Readonly<{ selectionId: string; revisionId: number; paginationToken?: string }>;
/** Main-only semantic Amazon boundary. Raw IDs and responses never leave this owner. */
export interface PromotionsReadAdapter {
  searchPromotions(input: PromotionsSearchPlan): Promise<unknown>;
  getPromotion(input: PromotionDetailPlan): Promise<unknown>;
  getSelection(input: PromotionSelectionPlan): Promise<unknown>;
}

export class PromotionsReads {
  constructor(private readonly dependencies: Readonly<{ adapter: PromotionsReadAdapter; context: SpExecutionContextAdapter }>) {}

  async read(input: OperationsReadInput): Promise<AmazonPromotionsSnapshot> {
    const fence = async (): Promise<void> => {
      await this.dependencies.context.assertCurrent(input.context);
      throwIfAborted(input.signal);
    };
    await fence();
    if (input.context.mode !== "live") throw new SpApiError("促銷同步尚無展示資料；請使用已授權的真實模式。", { status: 422, code: "DEMO_UNAVAILABLE" });
    const plan: PromotionsReadPlan = { context: input.context, signal: input.signal, assertCurrent: fence };
    const fba = new Map<string, string>();
    for (const identity of input.fba) {
      if (typeof identity.sellerSku !== "string" || !identity.sellerSku || identity.sellerSku.length > 40 || identity.sellerSku !== identity.sellerSku.trim() || /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u.test(identity.sellerSku) || !/^[A-Z0-9]{10}$/u.test(identity.asin) || fba.has(identity.sellerSku)) throw invalid();
      fba.set(identity.sellerSku, identity.asin);
    }
    const warnings = new Set<string>();
    const findings: OperationsFinding[] = [];
    const promotions: AmazonPromotion[] = [];
    const seenPromotions = new Set<string>();
    const searchTokens = new Set<string>();
    let reportedTotal: number | null = null;
    let excludedPromotionCount = 0;
    let requests = 0;
    let itemCount = 0;
    const call = async (read: () => Promise<unknown>): Promise<RecordValue> => {
      await fence();
      if (++requests > MAX_REQUESTS) throw new SpApiError("促銷同步已達安全讀取上限，請縮小範圍後重新查詢。", { status: 422, code: "PROMOTIONS_READ_LIMIT" });
      let raw: unknown;
      try { raw = await read(); } catch (error) {
        await fence();
        if (error instanceof SpApiError) {
          const safe = publicSpApiError(error, "Amazon 促銷目前無法讀取。");
          throw new SpApiError(safe.message, { status: safe.status, code: safe.code, requestId: safe.requestId, retryAfter: safe.retryAfter });
        }
        throw new SpApiError("Amazon 促銷目前無法讀取。", { status: 502, code: "UPSTREAM_UNAVAILABLE" });
      }
      await fence();
      const result = object(raw);
      if (!result) throw invalid();
      return result;
    };
    const projectRevision = async (raw: RecordValue, promotionId: string, latest: boolean): Promise<AmazonPromotionRevision> => {
      if (raw.marketplaceId !== input.context.marketplaceId || raw.promotionId !== promotionId) throw invalid();
      const schedule = object(raw.schedule);
      const startDate = date(schedule?.startDate);
      const endDate = date(schedule?.endDate);
      const revisionStatus = status(latest ? raw.revisionStatus : raw.status);
      let complete = !!startDate && !!endDate && Date.parse(startDate) <= Date.parse(endDate) && revisionStatus !== "UNKNOWN";
      let allIssues = issues(raw.issues);
      if (!allIssues || allIssues.some((issue) => issue.severity === "UNKNOWN")) complete = false;
      const selection = object(raw.selection);
      const selectionType = selection?.type === "ITEMS" || selection?.type === "CATALOG" ? selection.type : "UNKNOWN";
      const accepted = new Map<string, OperationsFbaIdentity>();
      const selections = [selection];
      const purchaseRequirements = object(raw.purchaseRequirements);
      if (purchaseRequirements) selections.push(object(purchaseRequirements.selection));
      for (const selected of selections) {
        if (selected?.type !== "ITEMS") { complete = false; continue; }
        if (!privateId(selected.selectionId) || !Number.isSafeInteger(selected.revisionId) || Number(selected.revisionId) < 1) { complete = false; continue; }
        const selectionId = selected.selectionId;
        const revisionId = Number(selected.revisionId);
        let paginationToken: string | undefined;
        const tokens = new Set<string>();
        const seenItems = new Set<string>();
        for (let page = 0; page < MAX_SELECTION_PAGES; page += 1) {
          const response = await call(() => this.dependencies.adapter.getSelection({ ...plan, promotionId, selectionId, revisionId, ...(paginationToken ? { paginationToken } : {}) }));
          const received = object(response.selection);
          const details = object(received?.selectionDetails);
          // Selection only requires `type` in the pinned model. The fixed GET
          // path + revision query bind absent echoes; present echoes must match.
          if (received?.type !== "ITEMS" || (received.selectionId !== undefined && received.selectionId !== selectionId) || (received.revisionId !== undefined && received.revisionId !== revisionId) || !details || !Array.isArray(details.items) || details.items.length > 100) throw invalid();
          const itemIssues = Array.isArray(details.issues) ? details.issues.filter((candidate) => {
            const identifier = object(object(candidate)?.identifier);
            const matches = identifier && typeof identifier.sku === "string" && typeof identifier.asin === "string" && fba.has(identifier.sku) && fba.get(identifier.sku) === identifier.asin;
            if (!matches) complete = false;
            return matches;
          }) : null;
          const pageIssues = issues(itemIssues);
          if (!pageIssues || pageIssues.some((issue) => issue.severity === "UNKNOWN")) complete = false;
          if (pageIssues?.length) allIssues = [...(allIssues ?? []), ...pageIssues];
          for (const candidate of details.items) {
            if (++itemCount > MAX_ITEMS) throw invalid();
            const current = object(candidate);
            if (!current || typeof current.sku !== "string" || typeof current.asin !== "string" || !fba.has(current.sku) || fba.get(current.sku) !== current.asin) { complete = false; continue; }
            if (seenItems.has(current.sku)) { complete = false; continue; }
            seenItems.add(current.sku);
            accepted.set(current.sku, { sellerSku: current.sku, asin: current.asin as string });
          }
          paginationToken = nextToken(details.pagination);
          if (!paginationToken) break;
          if (tokens.has(paginationToken) || page === MAX_SELECTION_PAGES - 1) { complete = false; break; }
          tokens.add(paginationToken);
        }
      }
      return { status: revisionStatus, startDate, endDate, selectionType, items: [...accepted.values()], issues: allIssues, coverage: complete ? "complete" : "partial" };
    };
    let paginationToken: string | undefined;
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const response = await call(() => this.dependencies.adapter.searchPromotions({ ...plan, ...(paginationToken ? { paginationToken } : {}) }));
      if (!Array.isArray(response.promotions) || response.promotions.length > 100 || !Number.isSafeInteger(response.totalResults) || Number(response.totalResults) < 0) throw invalid();
      if (reportedTotal !== null && reportedTotal !== response.totalResults) warnings.add("Amazon 搜尋總數於分頁期間改變，範圍尚未完整。");
      reportedTotal = Number(response.totalResults);
      for (const summary of response.promotions) {
        const rawSummary = object(summary);
        if (!rawSummary || !privateId(rawSummary.promotionId) || rawSummary.marketplaceId !== input.context.marketplaceId) throw invalid();
        const promotionId = rawSummary.promotionId;
        if (seenPromotions.has(promotionId)) { warnings.add("Amazon 回傳重複促銷，範圍尚未完整。"); continue; }
        if (seenPromotions.size >= MAX_PROMOTIONS) { warnings.add("促銷數量已達本次安全上限，尚未完整同步。"); break; }
        seenPromotions.add(promotionId);
        const raw = await call(() => this.dependencies.adapter.getPromotion({ ...plan, promotionId }));
        const published = await projectRevision(raw, promotionId, false);
        const latestRaw = object(raw.latestRevision);
        if (raw.latestRevision !== undefined && !latestRaw) throw invalid();
        const latestRevision = latestRaw ? await projectRevision(latestRaw, promotionId, true) : null;
        if (published.coverage !== "complete" || latestRevision?.coverage === "partial") warnings.add("部分促銷的參與商品、修訂或驗證問題尚未完整；僅顯示同次 exact FBA SKU／ASIN。");
        if (!published.items.length && !latestRevision?.items.length) {
          excludedPromotionCount += 1;
          warnings.add("CATALOG 或無法證明屬於目前 FBA 的促銷已隔離，只保留數量提示。");
          continue;
        }
        const key = `promotion.${createHash("sha256").update(promotionId).digest("hex").slice(0, 24)}`;
        const promotionType = ["BASKET_BUILDING", "DEAL", "PRICE_DISCOUNT", "COUPON"].includes(String(raw.promotionType)) ? raw.promotionType as AmazonPromotion["promotionType"] : "UNKNOWN";
        if (promotionType === "UNKNOWN") warnings.add("Amazon 回傳未識別的促銷類型。");
        const privateValues = [
          promotionId,
          raw.trackingId,
          object(raw.selection)?.selectionId,
          object(object(raw.purchaseRequirements)?.selection)?.selectionId,
          latestRaw?.trackingId,
          object(latestRaw?.selection)?.selectionId,
          object(object(latestRaw?.purchaseRequirements)?.selection)?.selectionId,
        ].filter((value): value is string => typeof value === "string");
        promotions.push({ key, title: publicTitle(raw.promotionTitle, privateValues), promotionType, published, latestRevision });
        if (published.status === "FAILED" || latestRevision?.status === "FAILED" || [published, latestRevision].some((revision) => revision?.issues?.some((issue) => issue.severity === "ERROR" || issue.severity === "WARNING"))) {
          findings.push({ key: `${key}.validation`, source: "promotions", sellerSku: null, severity: "warning", title: "Amazon 促銷需要核對", detail: "已讀到促銷驗證問題或失敗修訂；已發布版本與最新修訂分開保留，請至促銷同步核對。" });
        }
      }
      paginationToken = nextToken(response.pagination);
      if (!paginationToken) break;
      if (searchTokens.has(paginationToken) || page === MAX_SEARCH_PAGES - 1 || seenPromotions.size >= MAX_PROMOTIONS) { warnings.add("促銷分頁未完成，已停止重複或超限游標。"); break; }
      searchTokens.add(paginationToken);
    }
    if (reportedTotal !== seenPromotions.size) warnings.add("Amazon 搜尋總數與實際取得記錄不符，不能宣稱完整同步。");
    await fence();
    return { marketplaceId: input.context.marketplaceId, mode: input.context.mode, fetchedAt: new Date().toISOString(), coverage: warnings.size ? "partial" : "complete", warnings: [...warnings], findings, promotions, reportedTotal, excludedPromotionCount };
  }
}
