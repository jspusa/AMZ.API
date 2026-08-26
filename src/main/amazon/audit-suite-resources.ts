import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { abortableDelay, throwIfAborted } from "../abort-utils";
import type { AuditSuiteContext } from "./audit-suite-context";
import {
  createAuditSuiteResourceKey,
  type AuditSuiteRunControl,
} from "./audit-suite-coordinator";
import type {
  CatalogExportRow,
  FbaCatalogExport,
} from "./catalog-report-reads";
import type { FbaCatalogReports } from "./fba-catalog-reports";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";
import type { FbaVariationGroupingData } from
  "./variation-catalog-reads";

const REPORT_POLL_LIMIT = 180;
const REPORT_POLL_INTERVAL_MS = 1_000;

export type AuditSuiteListingsResource = Readonly<{
  reportId: string;
  documentId: string;
  data: FbaCatalogExport;
}>;

export type AuditSuiteGroupingResource = AuditSuiteListingsResource & Readonly<{
  grouping: FbaVariationGroupingData<CatalogExportRow>;
}>;

export type AuditSuiteGroupingReader = (input: Readonly<{
  marketplaceId: MarketplaceId;
  rows: readonly CatalogExportRow[];
  signal: AbortSignal;
  onProgress?: (progress: Readonly<{
    completedBatches: number;
    totalBatches: number;
  }>) => void | Promise<void>;
}>) => Promise<FbaVariationGroupingData<CatalogExportRow>>;

export interface AuditSuiteCatalogResourcesPort {
  listings(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): Promise<AuditSuiteListingsResource>;
  grouping(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): Promise<AuditSuiteGroupingResource>;
}

export type AuditSuiteCatalogResourcesDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  catalog: Pick<FbaCatalogReports, "begin" | "status" | "read">;
  readGrouping: AuditSuiteGroupingReader;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}>;

type BoundResource<T> = Readonly<{
  context: AuditSuiteContext;
  exactContext: SpExecutionContext;
  value: T;
}>;

const LISTINGS_RESOURCE = createAuditSuiteResourceKey<
  BoundResource<AuditSuiteListingsResource>
>("audit-suite-verified-listings");
const GROUPING_RESOURCE = createAuditSuiteResourceKey<
  BoundResource<AuditSuiteGroupingResource>
>("audit-suite-fba-relationship-grouping");

function contextInvalidated(message: string): SpExecutionContextError {
  return new SpExecutionContextError("SP_CONTEXT_INVALIDATED", message);
}

/**
 * Main-only owner of the legacy Audit Suite's shared FBA Listings and
 * relationship resources. The run control remains the only cache owner;
 * this module fixes report reuse, polling, context fences and grouping reuse.
 */
export class AuditSuiteCatalogResources
  implements AuditSuiteCatalogResourcesPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly catalog:
    AuditSuiteCatalogResourcesDependencies["catalog"];
  private readonly readGrouping:
    AuditSuiteCatalogResourcesDependencies["readGrouping"];
  private readonly wait:
    NonNullable<AuditSuiteCatalogResourcesDependencies["wait"]>;

  constructor(input: AuditSuiteCatalogResourcesDependencies) {
    this.context = input.context;
    this.catalog = input.catalog;
    this.readGrouping = input.readGrouping;
    this.wait = input.wait ?? abortableDelay;
  }

  async listings(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): Promise<AuditSuiteListingsResource> {
    const bound = await control.resource(LISTINGS_RESOURCE, () =>
      this.loadListings(context, control)
    );
    this.assertSameRunContext(context, bound.context);
    await this.assertExactContext(context, bound.exactContext, control.signal);
    return bound.value;
  }

  async grouping(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): Promise<AuditSuiteGroupingResource> {
    const bound = await control.resource(GROUPING_RESOURCE, async () => {
      const listing = await this.listings(context, control);
      const exactContext = await this.captureExactContext(
        context,
        control.signal,
      );
      throwIfAborted(control.signal);
      const grouping = await this.readGrouping({
        marketplaceId: exactContext.marketplaceId,
        rows: listing.data.rows,
        signal: control.signal,
        onProgress: ({ completedBatches, totalBatches }) => control.heartbeat({
          message:
            `正在核對 FBA relationships（${completedBatches}／${totalBatches} 批）。`,
        }),
      });
      throwIfAborted(control.signal);
      await this.assertExactContext(context, exactContext, control.signal);
      if (grouping.marketplaceId !== exactContext.marketplaceId) {
        throw contextInvalidated(
          "FBA relationships 與綜合健檢站點不一致。",
        );
      }
      return {
        context: { ...context },
        exactContext,
        value: { ...listing, grouping },
      };
    });
    this.assertSameRunContext(context, bound.context);
    await this.assertExactContext(context, bound.exactContext, control.signal);
    return bound.value;
  }

  private async loadListings(
    context: AuditSuiteContext,
    control: AuditSuiteRunControl,
  ): Promise<BoundResource<AuditSuiteListingsResource>> {
    const exactContext = await this.captureExactContext(
      context,
      control.signal,
    );
    let status = await this.catalog.begin({
      purpose: "catalog",
      marketplaceId: exactContext.marketplaceId,
      explicitRetry: false,
      signal: control.signal,
      expectedContext: exactContext,
    });
    await this.assertExactContext(context, exactContext, control.signal);
    this.assertReportMode(status.mode, exactContext);
    for (
      let attempt = 0;
      !status.ready && attempt < REPORT_POLL_LIMIT;
      attempt += 1
    ) {
      if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
        throw new Error("Amazon 未能產生本次共用 FBA 全商品報表。");
      }
      control.heartbeat({
        message: "Amazon 正在準備本次共用 FBA 全商品報表。",
        completedUnits: 0,
        totalUnits: 1,
      });
      await this.wait(REPORT_POLL_INTERVAL_MS, control.signal);
      throwIfAborted(control.signal);
      await this.assertExactContext(context, exactContext, control.signal);
      status = await this.catalog.status({
        marketplaceId: exactContext.marketplaceId,
        reportId: status.reportId,
        signal: control.signal,
        expectedContext: exactContext,
      });
      await this.assertExactContext(context, exactContext, control.signal);
      this.assertReportMode(status.mode, exactContext);
    }
    if (!status.ready || !status.documentId) {
      throw new Error("Amazon FBA 全商品報表等待逾時；未建立假快照。");
    }
    this.assertReportMode(status.mode, exactContext);
    const data = await this.catalog.read({
      view: "export",
      marketplaceId: exactContext.marketplaceId,
      reportId: status.reportId,
      documentId: status.documentId,
      signal: control.signal,
      expectedContext: exactContext,
    });
    throwIfAborted(control.signal);
    await this.assertExactContext(context, exactContext, control.signal);
    control.heartbeat({
      message: "本次共用 FBA 全商品報表已完成。",
      completedUnits: 1,
      totalUnits: 1,
    });
    return {
      context: { ...context },
      exactContext,
      value: {
        reportId: status.reportId,
        documentId: status.documentId,
        data,
      },
    };
  }

  private async captureExactContext(
    bound: AuditSuiteContext,
    signal: AbortSignal,
  ): Promise<SpExecutionContext> {
    throwIfAborted(signal);
    const marketplace = marketplaceById(bound.marketplaceId);
    if (!marketplace) {
      throw contextInvalidated("綜合健檢站點無效或已改變。");
    }
    const exact = await this.context.capture(marketplace.id);
    throwIfAborted(signal);
    this.assertBoundIdentity(bound, exact);
    await this.context.assertCurrent(exact);
    throwIfAborted(signal);
    this.assertBoundIdentity(bound, exact);
    return exact;
  }

  private async assertExactContext(
    bound: AuditSuiteContext,
    exact: SpExecutionContext,
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    this.assertBoundIdentity(bound, exact);
    await this.context.assertCurrent(exact);
    throwIfAborted(signal);
    this.assertBoundIdentity(bound, exact);
  }

  private assertSameRunContext(
    requested: AuditSuiteContext,
    loaded: AuditSuiteContext,
  ): void {
    if (
      requested.runId !== loaded.runId ||
      requested.marketplaceId !== loaded.marketplaceId ||
      requested.accountScope !== loaded.accountScope ||
      requested.generation !== loaded.generation ||
      requested.mode !== loaded.mode
    ) {
      throw contextInvalidated(
        "共用 FBA 健檢資源與本次綜合健檢 context 不一致。",
      );
    }
  }

  private assertBoundIdentity(
    bound: AuditSuiteContext,
    exact: SpExecutionContext,
  ): void {
    if (bound.marketplaceId !== exact.marketplaceId) {
      throw contextInvalidated("綜合健檢站點已改變。");
    }
    if (bound.accountScope !== String(exact.accountScope)) {
      throw new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "Amazon 帳號範圍已改變；本次綜合健檢已停止。",
      );
    }
    if (bound.mode !== exact.mode) {
      throw new SpExecutionContextError(
        "REPORT_MODE_CHANGED",
        "App 展示／真實模式已改變；本次綜合健檢已停止。",
      );
    }
    if (bound.generation !== exact.generation) {
      throw contextInvalidated(
        "Amazon 執行環境已更新；本次綜合健檢已停止。",
      );
    }
  }

  private assertReportMode(
    reportMode: "live" | "demo",
    exact: SpExecutionContext,
  ): void {
    if (reportMode !== exact.mode) {
      throw new SpExecutionContextError(
        "REPORT_MODE_CHANGED",
        "FBA 全商品報表與綜合健檢模式不一致。",
      );
    }
  }
}
