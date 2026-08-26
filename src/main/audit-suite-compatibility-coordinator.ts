import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../shared/marketplaces";
import type { AplusAuditCoordinatorPort } from
  "./a-plus-audit-coordinator";
import type { AdvertisingCoordinatorPort } from
  "./advertising-read-coordinator";
import { throwIfAborted } from "./abort-utils";
import {
  AuditSuiteCoordinator,
  AuditSuiteCoordinatorError,
} from "./amazon/audit-suite-coordinator";
import type { AuditSuiteCatalogResourcesPort } from
  "./amazon/audit-suite-resources";
import {
  createAuditSuiteWorkbook,
  type AuditSuiteWorkbookInput,
} from "./amazon/audit-suite-xlsx";
import type { BusinessPricingAuditPort } from
  "./amazon/business-pricing-audit";
import type { ContentAuditOwnerPort } from
  "./amazon/content-audit-owner";
import type { ImageAuditOwnerPort } from
  "./amazon/image-audit-owner";
import {
  publicSpApiError,
  SpApiError,
} from "./amazon/sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import type { SubscriptionAuditOwnerPort } from
  "./amazon/subscription-audit-owner";
import type { UnboundVariationAuditOwnerPort } from
  "./amazon/unbound-variation-audit-owner";
import { bodyRecord, parseMarketplace, reportIdentifier } from "./route-input";
import { invalid, json } from "./route-response";

export interface AuditSuiteCompatibilityCoordinatorPort {
  start(request: ApiRequest): Promise<ApiResponse>;
  observe(request: ApiRequest): Promise<ApiResponse>;
  download(request: ApiRequest): Promise<ApiResponse>;
  clear(): void;
}

export type AuditSuiteCompatibilityCoordinatorDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  resources: AuditSuiteCatalogResourcesPort;
  content: Pick<ContentAuditOwnerPort, "runAuditSuite">;
  image: Pick<ImageAuditOwnerPort, "runAuditSuite">;
  aplus: Pick<AplusAuditCoordinatorPort, "runAuditSuite">;
  variation: Pick<UnboundVariationAuditOwnerPort, "runAuditSuite">;
  subscription: Pick<SubscriptionAuditOwnerPort, "runAuditSuite">;
  businessPricing: Pick<BusinessPricingAuditPort, "runAuditSuite">;
  advertising: Pick<AdvertisingCoordinatorPort, "runAuditSuite">;
  createWorkbook?: (input: AuditSuiteWorkbookInput) => Uint8Array;
  now?: () => Date;
  ttlMs?: number;
}>;

function bytes(
  value: Uint8Array,
  contentType: string,
  headers: Record<string, string> = {},
): ApiResponse {
  return {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      ...headers,
    },
    body: { kind: "bytes", value },
  };
}

function coordinatorErrorResponse(
  error: AuditSuiteCoordinatorError,
  fallback: string,
): ApiResponse {
  const publicError = publicSpApiError(new SpApiError(error.message, {
    status: error.status,
    code: error.code,
  }), fallback);
  return json(
    { code: publicError.code, message: publicError.message },
    publicError.status,
  );
}

/**
 * Main-only owner of the three unreachable legacy Audit Suite routes. It
 * composes existing read-only semantic owners around one shared Listings and
 * grouping resource, and never participates in the current home run-all flow.
 */
export class AuditSuiteCompatibilityCoordinator
  implements AuditSuiteCompatibilityCoordinatorPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly resources: AuditSuiteCatalogResourcesPort;
  private readonly content:
    AuditSuiteCompatibilityCoordinatorDependencies["content"];
  private readonly image:
    AuditSuiteCompatibilityCoordinatorDependencies["image"];
  private readonly aplus: AuditSuiteCompatibilityCoordinatorDependencies["aplus"];
  private readonly variation:
    AuditSuiteCompatibilityCoordinatorDependencies["variation"];
  private readonly subscription:
    AuditSuiteCompatibilityCoordinatorDependencies["subscription"];
  private readonly businessPricing:
    AuditSuiteCompatibilityCoordinatorDependencies["businessPricing"];
  private readonly advertising:
    AuditSuiteCompatibilityCoordinatorDependencies["advertising"];
  private readonly createWorkbook:
    NonNullable<AuditSuiteCompatibilityCoordinatorDependencies["createWorkbook"]>;
  private readonly now: NonNullable<
    AuditSuiteCompatibilityCoordinatorDependencies["now"]
  >;
  private readonly suite: AuditSuiteCoordinator;
  private lifecycleRevision = 0;

  constructor(input: AuditSuiteCompatibilityCoordinatorDependencies) {
    this.context = input.context;
    this.resources = input.resources;
    this.content = input.content;
    this.image = input.image;
    this.aplus = input.aplus;
    this.variation = input.variation;
    this.subscription = input.subscription;
    this.businessPricing = input.businessPricing;
    this.advertising = input.advertising;
    this.createWorkbook = input.createWorkbook ?? createAuditSuiteWorkbook;
    this.now = input.now ?? (() => new Date());
    this.suite = new AuditSuiteCoordinator({
      runners: {
        content: async (context, control) => this.content.runAuditSuite({
          context,
          control,
          listings: await this.resources.listings(context, control),
        }),
        image: async (context, control) => this.image.runAuditSuite({
          context,
          control,
          listings: await this.resources.listings(context, control),
        }),
        aplus: async (context, control) => this.aplus.runAuditSuite({
          context,
          control,
          grouping: await this.resources.grouping(context, control),
        }),
        variation: async (context, control) =>
          this.variation.runAuditSuite({
            context,
            control,
            grouping: await this.resources.grouping(context, control),
          }),
        subscription: (context, control) =>
          this.subscription.runAuditSuite(context, control),
        businessPricing: (context, control) =>
          this.businessPricing.runAuditSuite({
            context,
            control,
            loadListings: () => this.resources.listings(context, control),
          }),
        advertising: (context, control) =>
          this.advertising.runAuditSuite(context, control),
      },
      ttlMs: input.ttlMs,
    });
  }

  clear(): void {
    this.lifecycleRevision += 1;
    this.suite.clear();
  }

  async start(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body || Object.keys(body).length !== 1 || !("marketplaceId" in body)) {
      return invalid(
        "綜合健檢只接受 marketplaceId；帳號、模式與快照由 main process 綁定。",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    if (!marketplaceId) return invalid("請選擇支援的 Amazon 站點。");
    const revision = this.lifecycleRevision;
    const context = await this.captureCurrent(marketplaceId, revision);
    this.assertLifecycleRevision(revision);
    const started = this.suite.start({
      marketplaceId,
      accountScope: String(context.accountScope),
      generation: context.generation,
      mode: context.mode,
    });
    return json(started.run, 202, { "retry-after": "1" });
  }

  async observe(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.requestIdentity(request);
    if (!identity) return invalid("綜合健檢工作資訊無效。");
    try {
      const revision = this.lifecycleRevision;
      const context = await this.captureCurrent(
        identity.marketplaceId,
        revision,
      );
      this.assertLifecycleRevision(revision);
      return json(this.suite.get({
        ...identity,
        accountScope: String(context.accountScope),
        generation: context.generation,
        mode: context.mode,
      }));
    } catch (error) {
      if (error instanceof AuditSuiteCoordinatorError) {
        return coordinatorErrorResponse(
          error,
          "查詢綜合健檢進度時發生未預期的錯誤。",
        );
      }
      throw error;
    }
  }

  async download(request: ApiRequest): Promise<ApiResponse> {
    const identity = this.requestIdentity(request);
    if (!identity) return invalid("綜合健檢 Excel 工作資訊無效。");
    try {
      const revision = this.lifecycleRevision;
      const context = await this.captureCurrent(
        identity.marketplaceId,
        revision,
      );
      this.assertLifecycleRevision(revision);
      const marketplace = marketplaceById(identity.marketplaceId)!;
      const generatedAt = this.now();
      const input = this.suite.workbookInput({
        ...identity,
        accountScope: String(context.accountScope),
        generation: context.generation,
        mode: context.mode,
        marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
        generatedAt,
      });
      this.assertLifecycleRevision(revision);
      const workbook = this.createWorkbook(input);
      this.assertLifecycleRevision(revision);
      const filename =
        `amazon-fba-audit-suite-${marketplace.shortLabel.toLowerCase()}-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
      return bytes(
        workbook,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        { "content-disposition": `attachment; filename="${filename}"` },
      );
    } catch (error) {
      if (error instanceof AuditSuiteCoordinatorError) {
        return coordinatorErrorResponse(
          error,
          "建立綜合健檢 Excel 時發生未預期的錯誤。",
        );
      }
      throw error;
    }
  }

  private requestIdentity(request: ApiRequest): Readonly<{
    marketplaceId: MarketplaceId;
    runId: string;
    contextId: string;
  }> | null {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const runId = reportIdentifier(request.query.runId);
    const contextId = reportIdentifier(request.query.contextId);
    return marketplaceId && runId && contextId
      ? { marketplaceId, runId, contextId }
      : null;
  }

  private async captureCurrent(
    marketplaceId: MarketplaceId,
    revision = this.lifecycleRevision,
    signal?: AbortSignal,
  ): Promise<SpExecutionContext> {
    throwIfAborted(signal);
    const context = await this.context.capture(marketplaceId);
    throwIfAborted(signal);
    this.assertLifecycleRevision(revision);
    if (context.marketplaceId !== marketplaceId) {
      throw this.contextInvalidated("綜合健檢站點已改變。");
    }
    await this.context.assertCurrent(context);
    throwIfAborted(signal);
    this.assertLifecycleRevision(revision);
    if (context.marketplaceId !== marketplaceId) {
      throw this.contextInvalidated("綜合健檢站點已改變。");
    }
    return context;
  }

  private assertLifecycleRevision(expected: number): void {
    if (expected === this.lifecycleRevision) return;
    throw this.contextInvalidated(
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  private contextInvalidated(message: string): SpExecutionContextError {
    return new SpExecutionContextError("SP_CONTEXT_INVALIDATED", message);
  }
}
