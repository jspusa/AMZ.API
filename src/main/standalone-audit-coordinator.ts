import type { ApiRequest, ApiResponse } from "../shared/contracts";
import type { MarketplaceId } from "../shared/marketplaces";
import { throwIfAborted } from "./abort-utils";
import type { AdvertisingCoordinatorPort } from
  "./advertising-read-coordinator";
import type { AgedInventoryAuditPort } from
  "./amazon/aged-inventory-audit";
import type { BusinessPricingAuditPort } from
  "./amazon/business-pricing-audit";
import type { FbaCatalogExport } from "./amazon/catalog-report-reads";
import type { ContentAuditOwnerPort } from "./amazon/content-audit-owner";
import type { ImageAuditOwnerPort } from "./amazon/image-audit-owner";
import type { ListingsExportPort } from "./amazon/listings-export";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import {
  StandaloneAuditJobCoordinator,
  StandaloneAuditJobCoordinatorError,
  type StandaloneAuditJobBoundContext,
  type StandaloneAuditJobGateway,
  type StandaloneAuditJobReceipt,
  type StandaloneAuditKind,
} from "./amazon/standalone-audit-job";
import type { SubscriptionAuditOwnerPort } from
  "./amazon/subscription-audit-owner";
import type { UnboundVariationAuditOwnerPort } from
  "./amazon/unbound-variation-audit-owner";
import { publicSpApiError, SpApiError } from "./amazon/sp-api-error";
import { bodyRecord, parseMarketplace, reportIdentifier } from "./route-input";
import { invalid, json } from "./route-response";

type StandaloneAuditJobIdentity = Readonly<{
  jobId: string;
  contextId: string;
  kind: StandaloneAuditKind;
  marketplaceId: MarketplaceId;
  mode: "live" | "demo";
}>;

export interface StandaloneAuditCoordinatorPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  observe(request: ApiRequest): Promise<ApiResponse>;
  getJob(input: StandaloneAuditJobIdentity): Promise<StandaloneAuditJobReceipt>;
  clear(): void;
}

export type StandaloneAuditCoordinatorDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  subscription: Pick<SubscriptionAuditOwnerPort, "runStandalone">;
  agedInventory: Pick<AgedInventoryAuditPort, "runStandalone">;
  listingsExport: Pick<ListingsExportPort, "runStandalone">;
  content: Pick<ContentAuditOwnerPort, "captureStandaloneFromListings">;
  image: Pick<ImageAuditOwnerPort, "captureStandaloneFromListings">;
  variation: Pick<UnboundVariationAuditOwnerPort, "runStandalone">;
  businessPricing: Pick<BusinessPricingAuditPort, "runStandalone">;
  advertising: Pick<AdvertisingCoordinatorPort, "runStandalone">;
  ttlMs?: number;
}>;

function auditKind(value: unknown): StandaloneAuditKind | null {
  return value === "content" ||
      value === "image" ||
      value === "variation" ||
      value === "subscription" ||
      value === "businessPricing" ||
      value === "advertising" ||
      value === "agedInventory"
    ? value
    : null;
}

function coordinatorError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof StandaloneAuditJobCoordinatorError) {
    const publicError = publicSpApiError(new SpApiError(error.message, {
      status: error.status,
      code: error.code,
    }), fallback);
    return json(
      { code: publicError.code, message: publicError.message },
      publicError.status,
    );
  }
  return json({ code: "INTERNAL_ERROR", message: fallback }, 500);
}

/**
 * Main-only semantic owner for every generic Standalone Audit operation.
 * The nested job coordinator remains the only owner of jobs, selections,
 * timers, progress, TTL, and terminal receipts. Injected audit owners remain
 * the only owners of report lifecycle, snapshots, workbooks, and business
 * rules.
 */
export class StandaloneAuditCoordinator
  implements StandaloneAuditCoordinatorPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly subscription:
    StandaloneAuditCoordinatorDependencies["subscription"];
  private readonly agedInventory:
    StandaloneAuditCoordinatorDependencies["agedInventory"];
  private readonly listingsExport:
    StandaloneAuditCoordinatorDependencies["listingsExport"];
  private readonly content: StandaloneAuditCoordinatorDependencies["content"];
  private readonly image: StandaloneAuditCoordinatorDependencies["image"];
  private readonly variation:
    StandaloneAuditCoordinatorDependencies["variation"];
  private readonly businessPricing:
    StandaloneAuditCoordinatorDependencies["businessPricing"];
  private readonly advertising:
    StandaloneAuditCoordinatorDependencies["advertising"];
  private readonly jobs: StandaloneAuditJobCoordinator;
  private lifecycleRevision = 0;

  constructor(input: StandaloneAuditCoordinatorDependencies) {
    this.context = input.context;
    this.subscription = input.subscription;
    this.agedInventory = input.agedInventory;
    this.listingsExport = input.listingsExport;
    this.content = input.content;
    this.image = input.image;
    this.variation = input.variation;
    this.businessPricing = input.businessPricing;
    this.advertising = input.advertising;
    this.jobs = new StandaloneAuditJobCoordinator({
      gateway: {
        bindContext: (identity) => this.bindContext(identity),
        run: (job) => this.run(job),
      },
      ttlMs: input.ttlMs,
    });
  }

  clear(): void {
    this.lifecycleRevision += 1;
    this.jobs.clear();
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (
      !body ||
      Object.keys(body).some((key) =>
        key !== "kind" &&
        key !== "marketplaceId" &&
        key !== "mode" &&
        key !== "options") ||
      !Object.hasOwn(body, "kind") ||
      !Object.hasOwn(body, "marketplaceId") ||
      !Object.hasOwn(body, "mode")
    ) {
      return invalid(
        "單項健檢只接受 kind、marketplaceId、mode 與受限 options；帳號由 main process 綁定。",
      );
    }
    const kind = auditKind(body.kind);
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const mode = body.mode === "live" || body.mode === "demo" ? body.mode : null;
    let options: { months?: 6 | 12 | 23 } | undefined;
    if (body.options !== undefined) {
      if (
        !body.options ||
        typeof body.options !== "object" ||
        Array.isArray(body.options)
      ) {
        return invalid("單項健檢 options 格式無效。");
      }
      const source = body.options as Record<string, unknown>;
      if (Object.keys(source).some((key) => key !== "months")) {
        return invalid("單項健檢 options 欄位無效。");
      }
      if (source.months !== undefined) {
        if (source.months !== 6 && source.months !== 12 && source.months !== 23) {
          return invalid("Subscribe & Save 月數只能選 6、12 或 23。");
        }
        options = { months: source.months };
      } else {
        options = {};
      }
    }
    if (!kind || !marketplaceId || !mode) {
      return invalid("單項健檢種類、站點或模式無效。");
    }
    try {
      const receipt = await this.jobs.start({
        kind,
        marketplaceId,
        mode,
        options,
      });
      return json(receipt, 202, { "retry-after": "1" });
    } catch (error) {
      return coordinatorError(error, "開始單項健檢時發生未預期的錯誤。");
    }
  }

  async observe(request: ApiRequest): Promise<ApiResponse> {
    const kind = auditKind(request.query.kind);
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const mode = request.query.mode === "live" || request.query.mode === "demo"
      ? request.query.mode
      : null;
    const jobId = reportIdentifier(request.query.jobId);
    const contextId = reportIdentifier(request.query.contextId);
    if (!kind || !marketplaceId || !mode || !jobId || !contextId) {
      return invalid("單項健檢工作資訊無效。");
    }
    try {
      const receipt = await this.getJob({
        kind,
        marketplaceId,
        mode,
        jobId,
        contextId,
      });
      return json(
        receipt,
        receipt.ready ? 200 : 202,
        receipt.ready ? {} : { "retry-after": "1" },
      );
    } catch (error) {
      return coordinatorError(error, "查詢單項健檢進度時發生未預期的錯誤。");
    }
  }

  getJob(
    input: StandaloneAuditJobIdentity,
  ): Promise<StandaloneAuditJobReceipt> {
    return this.jobs.get(input);
  }

  private async bindContext(input: Readonly<{
    marketplaceId: string;
    mode: "live" | "demo";
  }>): Promise<StandaloneAuditJobBoundContext> {
    const revision = this.lifecycleRevision;
    const marketplaceId = parseMarketplace(input.marketplaceId);
    if (!marketplaceId) {
      throw new StandaloneAuditJobCoordinatorError("單項健檢站點無效。", {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    const current = await this.context.capture(marketplaceId);
    if (current.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    await this.context.assertCurrent(current);
    this.assertLifecycleRevision(revision);
    return {
      accountScope: current.accountScope,
      generation: current.generation,
      marketplaceId,
      mode: current.mode,
    };
  }

  private async captureBoundContext(
    bound: StandaloneAuditJobBoundContext,
    signal: AbortSignal,
  ): Promise<SpExecutionContext> {
    const revision = this.lifecycleRevision;
    throwIfAborted(signal);
    const marketplaceId = parseMarketplace(bound.marketplaceId);
    if (!marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    const current = await this.context.capture(marketplaceId);
    throwIfAborted(signal);
    if (current.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    await this.context.assertCurrent(current);
    throwIfAborted(signal);
    this.assertLifecycleRevision(revision);
    if (current.accountScope !== bound.accountScope) {
      throw new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "Amazon 帳號範圍已改變；本次操作已停止。",
      );
    }
    if (current.mode !== bound.mode) {
      throw new SpExecutionContextError(
        "REPORT_MODE_CHANGED",
        "App 展示／真實模式已改變；本次操作已停止。",
      );
    }
    if (current.generation !== bound.generation) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    return current;
  }

  private assertLifecycleRevision(expected: number): void {
    if (expected === this.lifecycleRevision) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  private async standaloneListings(input: Parameters<
    StandaloneAuditJobGateway["run"]
  >[0]): Promise<Readonly<{
    context: SpExecutionContext;
    data: FbaCatalogExport;
  }>> {
    const captured = await this.listingsExport.runStandalone(input);
    input.updateProgress({
      stage: "listing_rows",
      message: `已取得 ${captured.snapshot.rows.length.toLocaleString()} 個 FBA 商品，正在執行健檢。`,
      completedUnits: 1,
      totalUnits: 1,
    });
    return {
      context: captured.context,
      data: captured.snapshot,
    };
  }

  private async run(
    input: Parameters<StandaloneAuditJobGateway["run"]>[0],
  ): Promise<unknown> {
    const context = await this.captureBoundContext(input.context, input.signal);
    const marketplaceId = context.marketplaceId;
    if (input.kind === "subscription") {
      input.updateProgress({
        stage: "subscription",
        message: "正在核對全站 FBA Subscribe & Save。",
        completedUnits: 0,
        totalUnits: null,
      });
      const snapshot = await this.subscription.runStandalone({
        marketplaceId,
        months: input.options.months ?? 6,
        signal: input.signal,
        expectedContext: context,
      });
      input.updateProgress({
        stage: "complete",
        message: "Subscribe & Save 健檢完成。",
        completedUnits: snapshot.offers.length,
        totalUnits: snapshot.offers.length,
      });
      return snapshot;
    }

    if (input.kind === "agedInventory") {
      return this.agedInventory.runStandalone(input);
    }

    if (input.kind === "content" || input.kind === "image") {
      const listing = await this.standaloneListings(input);
      await this.captureBoundContext(input.context, input.signal);
      input.updateProgress({
        stage: "relationships",
        message: "正在核對 FBA parent／child relationships。",
        completedUnits: 0,
        totalUnits: null,
      });
      const snapshot = input.kind === "content"
        ? await this.content.captureStandaloneFromListings({
            context: listing.context,
            marketplaceId,
            listings: listing.data,
            signal: input.signal,
            onGroupingProgress: ({ completedBatches, totalBatches }) =>
              input.updateProgress({
                stage: "relationships",
                message: `正在核對 FBA relationships（${completedBatches}／${totalBatches} 批）。`,
                completedUnits: completedBatches,
                totalUnits: totalBatches,
              }),
          })
        : await this.image.captureStandaloneFromListings({
            context: listing.context,
            marketplaceId,
            listings: listing.data,
            signal: input.signal,
            onGroupingProgress: ({ completedBatches, totalBatches }) =>
              input.updateProgress({
                stage: "relationships",
                message: `正在核對 FBA relationships（${completedBatches}／${totalBatches} 批）。`,
                completedUnits: completedBatches,
                totalUnits: totalBatches,
              }),
          });
      input.updateProgress({
        stage: "complete",
        message: input.kind === "content"
          ? "全站文案健檢完成。"
          : "全站圖片健檢完成。",
        completedUnits: snapshot.rows.length,
        totalUnits: snapshot.rows.length,
      });
      return snapshot;
    }

    if (input.kind === "variation") {
      return this.variation.runStandalone({
        marketplaceId,
        signal: input.signal,
        expectedContext: context,
        heartbeat: input.heartbeat,
        updateProgress: (progress) => input.updateProgress(progress),
      });
    }

    if (input.kind === "businessPricing") {
      return this.businessPricing.runStandalone(input);
    }

    if (input.kind === "advertising") {
      return this.advertising.runStandalone(input);
    }

    throw new Error("不支援這個單項健檢種類。");
  }
}
