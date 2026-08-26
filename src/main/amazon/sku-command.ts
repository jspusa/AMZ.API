import type { ProductMasterState } from "../local-store";
import type { MarketplaceId } from "../../shared/marketplaces";
import {
  publicSpApiError,
  SpApiError,
  type SpApiOperation,
} from "./sp-api-error";
import type {
  ListingContentSnapshot,
  ListingImageSnapshot,
  ListingPriceSnapshot,
  RestockPlanSnapshot,
  SubscribeAndSaveOfferSnapshot,
} from "./sp-api";
import type {
  OpaqueAccountScope,
  SpExecutionContext,
} from "./sp-execution-context";

const SOURCE_UNAVAILABLE_MESSAGE =
  "這項 Amazon 資料暫時無法讀取，其他結果仍可使用。";

export type SkuCommandIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

export type SkuCommandRestockInput = SkuCommandIdentity & Readonly<{
  targetDays: number;
  leadTimeDays: number;
  safetyDays: number;
  casePack: number;
}>;

export type SkuCommandSourceError = Readonly<{
  code: string;
  message: string;
  requestId: string | null;
  operation?: SpApiOperation | null;
  upstreamCode?: string | null;
}>;

export type SkuCommandSource<T> = Readonly<
  | { data: T; error: null }
  | { data: null; error: SkuCommandSourceError }
>;

export type SkuCommandTask = Readonly<{
  id: string;
  title: string;
  detail: string;
  automation: "automatic" | "one_click" | "manual";
  severity: "info" | "warning" | "critical";
  tool: "restock" | "copy" | "images" | "price" | "promotion" | null;
}>;

export type SkuCommandSnapshot = Readonly<{
  mode: SpExecutionContext["mode"];
  marketplaceId: MarketplaceId;
  sellerSku: string;
  fetchedAt: string;
  profile: ProductMasterState;
  price: SkuCommandSource<ListingPriceSnapshot>;
  content: SkuCommandSource<ListingContentSnapshot>;
  images: SkuCommandSource<ListingImageSnapshot>;
  subscribeSave: SkuCommandSource<SubscribeAndSaveOfferSnapshot>;
  restock: SkuCommandSource<RestockPlanSnapshot>;
  tasks: SkuCommandTask[];
  summary: Readonly<{
    score: number;
    sourceReady: number;
    sourceTotal: number;
    critical: number;
    warning: number;
    manual: number;
    overall: "ready" | "attention" | "critical";
  }>;
  notice: string;
}>;

export type SkuCommandDependencies = Readonly<{
  context: Readonly<{
    capture(marketplaceId: MarketplaceId): Promise<SpExecutionContext>;
    assertCurrent(context: SpExecutionContext): Promise<void>;
  }>;
  productMaster: Readonly<{
    get(
      accountScope: OpaqueAccountScope,
      marketplaceId: MarketplaceId,
      sellerSku: string,
    ): Promise<ProductMasterState>;
    syncIdentity(input: Readonly<{
      accountScope: OpaqueAccountScope;
      marketplaceId: MarketplaceId;
      sellerSku: string;
      displayName: string | null;
      asin: string | null;
      fnSku: string | null;
    }>): Promise<ProductMasterState>;
  }>;
  reads: Readonly<{
    price(identity: SkuCommandIdentity): Promise<ListingPriceSnapshot>;
    content(identity: SkuCommandIdentity): Promise<ListingContentSnapshot>;
    images(identity: SkuCommandIdentity): Promise<ListingImageSnapshot>;
    subscribeSave(
      identity: SkuCommandIdentity,
    ): Promise<SubscribeAndSaveOfferSnapshot>;
    restock(input: SkuCommandRestockInput): Promise<RestockPlanSnapshot>;
  }>;
  now?(): Date;
}>;

function sourceResult<T>(result: PromiseSettledResult<T>): SkuCommandSource<T> {
  if (result.status === "fulfilled") {
    return { data: result.value, error: null };
  }
  const error = result.reason;
  const publicError = error instanceof SpApiError
    ? publicSpApiError(error, SOURCE_UNAVAILABLE_MESSAGE)
    : null;
  return {
    data: null,
    error: publicError
      ? {
          code: publicError.code,
          message: publicError.message,
          requestId: publicError.requestId,
          operation: publicError.operation,
          upstreamCode: publicError.upstreamCode,
        }
      : {
          code: "UPSTREAM_UNAVAILABLE",
          message: SOURCE_UNAVAILABLE_MESSAGE,
          requestId: null,
        },
  };
}

function commandTasks(input: {
  profile: ProductMasterState;
  price: SkuCommandSource<ListingPriceSnapshot>;
  content: SkuCommandSource<ListingContentSnapshot>;
  images: SkuCommandSource<ListingImageSnapshot>;
  subscribeSave: SkuCommandSource<SubscribeAndSaveOfferSnapshot>;
  restock: SkuCommandSource<RestockPlanSnapshot>;
}): SkuCommandTask[] {
  const tasks: SkuCommandTask[] = [];
  const add = (task: SkuCommandTask) => {
    if (!tasks.some((item) => item.id === task.id)) tasks.push(task);
  };
  if (!input.profile.profile.settingsConfigured) {
    add({
      id: "profile-settings",
      title: "儲存一次商品補貨規格",
      detail: "設定箱入數、交期、安全天數與 AWD 緩衝後，之後會自動套用。",
      automation: "one_click",
      severity: "info",
      tool: null,
    });
  }
  const sourceEntries = [
    ["price", input.price, "價格", "price"],
    ["content", input.content, "文案", "copy"],
    ["images", input.images, "圖片", "images"],
    ["subscribe", input.subscribeSave, "訂閱", "price"],
    ["restock", input.restock, "補貨", "restock"],
  ] as const;
  for (const [id, source, label, tool] of sourceEntries) {
    if (!source.error) continue;
    add({
      id: `source-${id}`,
      title: `${label}資料未完成`,
      detail: source.error.message,
      automation: "automatic",
      severity: id === "price" || id === "restock" ? "warning" : "info",
      tool,
    });
  }
  if (input.content.data) {
    const content = input.content.data;
    const missing = [
      content.capabilities.title.supported && !content.title.trim() ? "標題" : null,
      content.capabilities.bulletPoints.supported &&
      content.bulletPoints.filter(Boolean).length <
        Math.min(5, content.capabilities.bulletPoints.maxItems ?? 5)
        ? `五大賣點（目前 ${content.bulletPoints.filter(Boolean).length}）`
        : null,
      content.capabilities.ingredients.supported && !content.ingredients.trim()
        ? "成分"
        : null,
    ].filter(Boolean);
    if (missing.length) {
      add({
        id: "content-missing",
        title: "商品內容不完整",
        detail: `缺少：${missing.join("、")}。可直接帶入文案工具修正。`,
        automation: "one_click",
        severity: "warning",
        tool: "copy",
      });
    }
    const errors = content.issues.filter(
      (issue) => issue.severity.toUpperCase() === "ERROR",
    );
    if (errors.length) {
      add({
        id: "listing-errors",
        title: `Amazon 回報 ${errors.length} 個 Listing 錯誤`,
        detail: errors[0]?.message || "請打開文案工具查看 Amazon issue。",
        automation: "manual",
        severity: "critical",
        tool: "copy",
      });
    }
  }
  if (input.images.data) {
    const count = input.images.data.images.filter((item) => item.url).length;
    const hasMain = Boolean(input.images.data.images[0]?.url);
    if (!hasMain || count < 6) {
      add({
        id: "images-incomplete",
        title: hasMain ? "商品圖片可以再補強" : "商品缺少主圖",
        detail: hasMain
          ? `目前 ${count} 張；可直接拖拉補到建議的 6 張以上。`
          : "主圖是必備欄位，系統已準備好拖拉上傳與格式檢查。",
        automation: "one_click",
        severity: hasMain ? "info" : "critical",
        tool: "images",
      });
    }
  }
  if (input.price.data && !input.price.data.standardPrice) {
    add({
      id: "price-missing",
      title: "查不到可核對的標準售價",
      detail: "為避免誤改，價格寫入已自動停止。",
      automation: "manual",
      severity: "critical",
      tool: "price",
    });
  }
  if (input.restock.data) {
    const restock = input.restock.data;
    if (restock.action === "RESTOCK_NOW" || restock.action === "WATCH") {
      add({
        id: restock.action === "RESTOCK_NOW" ? "restock-now" : "restock-watch",
        title: restock.action === "RESTOCK_NOW"
          ? `建議現在補貨 ${restock.recommendedUnits.toLocaleString()} 件`
          : `準備補貨 ${restock.recommendedUnits.toLocaleString()} 件`,
        detail: `目前可售約 ${restock.daysOfCover?.toFixed(1) ?? "—"} 天；已依每箱 ${restock.casePack} 件向上取整。`,
        automation: "one_click",
        severity: restock.action === "RESTOCK_NOW" ? "critical" : "warning",
        tool: "restock",
      });
    }
  }
  if (!tasks.length) {
    add({
      id: "all-clear",
      title: "這個 SKU 目前沒有明顯異常",
      detail: "價格、內容、圖片與 FBA 補貨訊號已完成掃描。",
      automation: "automatic",
      severity: "info",
      tool: null,
    });
  }
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return tasks.sort((left, right) => rank[left.severity] - rank[right.severity]);
}

/**
 * Owns one read-only SKU command scan. The caller validates the public route;
 * this module owns the FBA read fan-out, account fence, identity sync, and DTO.
 */
export class SkuCommand {
  private readonly context: SkuCommandDependencies["context"];
  private readonly productMaster: SkuCommandDependencies["productMaster"];
  private readonly reads: SkuCommandDependencies["reads"];
  private readonly now: () => Date;

  constructor(dependencies: SkuCommandDependencies) {
    this.context = dependencies.context;
    this.productMaster = dependencies.productMaster;
    this.reads = dependencies.reads;
    this.now = dependencies.now ?? (() => new Date());
  }

  async read(identity: SkuCommandIdentity): Promise<SkuCommandSnapshot> {
    const { marketplaceId, sellerSku } = identity;
    const context = await this.context.capture(marketplaceId);
    const { accountScope } = context;
    const profileState = await this.productMaster.get(
      accountScope,
      marketplaceId,
      sellerSku,
    );
    const profile = profileState.profile;
    const effectiveLead = profile.leadTimeDays +
      (profile.supplyRoute === "AWD_TO_FBA" ? profile.awdBufferDays : 0);
    const settled = await Promise.allSettled([
      this.reads.price(identity),
      this.reads.content(identity),
      this.reads.images(identity),
      this.reads.subscribeSave(identity),
      this.reads.restock({
        marketplaceId,
        sellerSku,
        targetDays: profile.targetDays,
        leadTimeDays: effectiveLead,
        safetyDays: profile.safetyDays,
        casePack: profile.casePack,
      }),
    ] as const);
    await this.context.assertCurrent(context);
    const price = sourceResult<ListingPriceSnapshot>(settled[0]);
    const content = sourceResult<ListingContentSnapshot>(settled[1]);
    const images = sourceResult<ListingImageSnapshot>(settled[2]);
    const subscribeSave = sourceResult<SubscribeAndSaveOfferSnapshot>(settled[3]);
    const restock = sourceResult<RestockPlanSnapshot>(settled[4]);
    const identityData = {
      displayName: price.data?.title ?? content.data?.title ?? restock.data?.title ?? null,
      asin: price.data?.asin ?? content.data?.asin ?? restock.data?.asin ?? null,
      fnSku: restock.data?.fnSku ?? null,
    };
    const synced = await this.productMaster.syncIdentity({
      accountScope,
      marketplaceId,
      sellerSku,
      ...identityData,
    });
    const effectiveProfile: ProductMasterState = {
      ...synced,
      profile: {
        ...synced.profile,
        settingsConfigured: profile.settingsConfigured,
      },
    };
    const tasks = commandTasks({
      profile: effectiveProfile,
      price,
      content,
      images,
      subscribeSave,
      restock,
    });
    const sources = [price, content, images, subscribeSave, restock];
    const sourceReady = sources.filter((item) => item.data).length;
    return {
      mode: context.mode,
      marketplaceId,
      sellerSku,
      fetchedAt: this.now().toISOString(),
      profile: effectiveProfile,
      price,
      content,
      images,
      subscribeSave,
      restock,
      tasks,
      summary: {
        score: Math.round((sourceReady / sources.length) * 100),
        sourceReady,
        sourceTotal: sources.length,
        critical: tasks.filter((item) => item.severity === "critical").length,
        warning: tasks.filter((item) => item.severity === "warning").length,
        manual: tasks.filter((item) => item.automation === "manual").length,
        overall: tasks.some((item) => item.severity === "critical")
          ? "critical"
          : tasks.some((item) => item.severity === "warning")
            ? "attention"
            : "ready",
      },
      notice: "這是只讀整合掃描；只有完成預檢、確認與 Notebook 鑰匙（Touch ID／Windows Hello）本機授權後，才可能寫入 Amazon。",
    };
  }
}
