import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  B2B_RECENT_WORK_LIMIT,
  type B2bRecentWorkItem,
  type B2bRecentWorkSnapshot,
} from "../shared/b2b-recent-work";
import type { SpExecutionContextAdapter } from "./amazon/sp-execution-context";
import { businessPricingWriteInspectionEvidence } from "./business-pricing-mutations";
import type { LocalStore, RecentBusinessPricingInspection } from "./local-store";
import { isPlainRecord, parseMarketplace, parseSellerSku } from "./route-input";
import { invalid, json, routeError } from "./route-response";

type RecentWorkStore = Pick<LocalStore, "inspectRecentBusinessPricingOperations">;

function project(entry: RecentBusinessPricingInspection): B2bRecentWorkItem | null {
  if (parseSellerSku(entry.sellerSku) !== entry.sellerSku ||
      entry.executionMode === "demo" ||
      (isPlainRecord(entry.response) && entry.response.mode === "demo")) return null;
  const evidence = businessPricingWriteInspectionEvidence(entry);
  if (evidence && (evidence.sellerSku !== entry.sellerSku ||
      evidence.marketplaceId !== entry.marketplaceId)) return null;
  // A historical null receipt has no mode proof. New claims carry a private
  // mode marker; older exact live DISPATCHED/ACCEPTED evidence also suffices.
  if (!evidence && (entry.operationType !== "business_price" ||
      entry.state === "completed" || entry.executionMode !== "live")) return null;
  const stage = evidence?.stage ?? "business_price";
  const status = evidence?.status === "VERIFIED"
    ? stage === "minimum_price" ? "MINIMUM_VERIFIED" : "VERIFIED"
    : evidence?.status ?? "UNKNOWN";
  const updatedAt = new Date(Math.max(entry.updatedAt, entry.createdAt));
  if (!Number.isFinite(updatedAt.getTime())) return null;
  return {
    sellerSku: entry.sellerSku, stage, status,
    acceptedAt: evidence?.acceptedAt ?? null,
    verifiedAt: evidence?.verifiedAt ?? null,
    updatedAt: updatedAt.toISOString(), canResend: false,
    nextAction: status === "MINIMUM_VERIFIED" ? "fresh_preview" : "readback",
    notice: status === "MINIMUM_VERIFIED"
      ? "最低價已回查確認；B2B 尚須讀取最新商品、重新預檢與新的本機確認。"
      : status === "VERIFIED"
        ? "這筆 B2B 更新已回查確認；查看結果只會讀取，不會重送。"
        : status === "PROCESSING"
          ? "Amazon 已接受，尚待回查；查看結果只會讀取，不會重送。"
          : "送出結果尚未確認；先唯讀回查，沒有可沿用的寫入授權，禁止重送。",
  };
}

/** Owns only a bounded local projection. It has no Amazon transport or Write Gate. */
export class BusinessPricingRecentWork {
  constructor(private readonly input: Readonly<{
    store: RecentWorkStore;
    context: SpExecutionContextAdapter;
    now?: () => Date;
  }>) {}

  async read(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    if (request.method !== "GET" || request.body !== undefined || !marketplaceId ||
        Object.keys(request.query).some((key) => key !== "marketplaceId")) {
      return invalid("最近 B2B 工作只接受目前站點的唯讀查詢。", 400, "INVALID_REQUEST");
    }
    try {
      const context = await this.input.context.capture(marketplaceId);
      const entries = context.mode === "live"
        ? await this.input.store.inspectRecentBusinessPricingOperations({
          accountScope: context.accountScope, marketplaceId,
        }) : [];
      await this.input.context.assertCurrent(context);
      const items: B2bRecentWorkItem[] = [];
      for (const entry of entries) {
        const item = project(entry);
        if (!item) continue;
        if (item.stage === "minimum_price" && entries.some((other) =>
          other.sellerSku === entry.sellerSku && other.operationType === "business_price" &&
          other.createdAt > entry.createdAt && other.executionMode !== "demo" &&
          !(isPlainRecord(other.response) && other.response.mode === "demo"))) continue;
        items.push(item);
      }
      const result: B2bRecentWorkSnapshot = {
        schemaVersion: 1, marketplaceId, mode: context.mode,
        checkedAt: (this.input.now?.() ?? new Date()).toISOString(),
        limit: B2B_RECENT_WORK_LIMIT,
        items: items.slice(0, B2B_RECENT_WORK_LIMIT),
      };
      return json(result);
    } catch (error) {
      return routeError(error, "無法讀取這台 Notebook Key 的最近 B2B 工作。");
    }
  }
}
