import type { MarketplaceId } from "../../shared/marketplaces";
import { abortableDelay } from "../abort-utils";
import {
  readFbaBusinessPricingAudit,
  readFbaCatalogExport,
  readFbaCatalogIdentity,
  readFbaCatalogSeeds,
  type BusinessPricingAuditSnapshot,
  type CatalogExportProgress,
  type CatalogListingsReadAdapter,
  type FbaCatalogExport,
  type FbaCatalogIdentitySnapshot,
  type FbaCatalogSeed,
} from "./catalog-report-reads";
import type {
  ReportsRuntime,
  ReportsRuntimeReceipt,
} from "./reports-runtime";
import { SpApiError } from "./sp-api-error";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "./sp-execution-context";

export type FbaCatalogReportsPurpose =
  | "catalog"
  | "business-pricing-audit";

export interface FbaCatalogReportsDemoSource {
  export(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>): FbaCatalogExport | Promise<FbaCatalogExport>;
  identity(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>): FbaCatalogIdentitySnapshot | Promise<FbaCatalogIdentitySnapshot>;
  seeds(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>): FbaCatalogSeed[] | Promise<FbaCatalogSeed[]>;
  businessPricingAudit(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>): BusinessPricingAuditSnapshot | Promise<BusinessPricingAuditSnapshot>;
}

export type FbaCatalogExistingExport =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "pending"; receipt: ReportsRuntimeReceipt }>
  | Readonly<{ state: "ready"; data: FbaCatalogExport }>;

type ReportsPort = Pick<
  ReportsRuntime,
  "start" | "read" | "status" | "readDocument"
>;

type CatalogReadBase = Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
  signal?: AbortSignal;
  expectedContext?: SpExecutionContext;
}>;

export type FbaCatalogReportsReadInput =
  | CatalogReadBase & Readonly<{
      view: "export";
      onProgress?: (
        progress: CatalogExportProgress,
      ) => void | Promise<void>;
    }>
  | CatalogReadBase & Readonly<{ view: "identity" | "seeds" }>
  | CatalogReadBase & Readonly<{
      view: "business-pricing-audit";
      heartbeat?: () => void;
    }>;

function isIdentityFenceError(error: unknown): boolean {
  return error instanceof SpApiError && [
    "ACCOUNT_SCOPE_CHANGED",
    "REPORT_MISMATCH",
    "REPORT_MODE_CHANGED",
    "SP_CONTEXT_INVALIDATED",
  ].includes(error.code);
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function rethrowReadFence(error: unknown): void {
  if (
    isIdentityFenceError(error) ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    throw error;
  }
}

/**
 * Main-process coordinator for the fixed All Listings and Active Listings
 * read families. It owns no HTTP transport, credential, workbook or write
 * capability; those stay in ReportsRuntime, ListingsReadAdapter and ApiRouter.
 */
export class FbaCatalogReports {
  private readonly reports: ReportsPort;
  private readonly context: SpExecutionContextAdapter;
  private readonly listings: CatalogListingsReadAdapter;
  private readonly demo: FbaCatalogReportsDemoSource;
  private readonly pace: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly now: () => Date;

  constructor(input: Readonly<{
    reports: ReportsPort;
    context: SpExecutionContextAdapter;
    listings: CatalogListingsReadAdapter;
    demo: FbaCatalogReportsDemoSource;
    pace?: (
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void>;
    now?: () => Date;
  }>) {
    this.reports = input.reports;
    this.context = input.context;
    this.listings = input.listings;
    this.demo = input.demo;
    this.pace = input.pace ?? abortableDelay;
    this.now = input.now ?? (() => new Date());
  }

  private async executionContext(
    marketplaceId: MarketplaceId,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    if (!expected) return this.context.capture(marketplaceId);
    if (expected.marketplaceId !== marketplaceId) {
      throw new SpApiError("Catalog 報表與固定執行站點不一致。", {
        status: 409,
        code: "SP_CONTEXT_INVALIDATED",
      });
    }
    await this.context.assertCurrent(expected);
    return expected;
  }

  async begin(input: Readonly<{
    purpose: FbaCatalogReportsPurpose;
    marketplaceId: MarketplaceId;
    explicitRetry: boolean;
    freshCompleted?: boolean;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt> {
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const allListings = this.reports.start(
      {
        intent: "all-listings",
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      },
      {
        explicitRetry: input.explicitRetry,
        freshCompleted: input.freshCompleted,
        expectedContext: context,
      },
    );
    if (input.purpose === "catalog") {
      const receipt = await allListings;
      await this.context.assertCurrent(context);
      return receipt;
    }

    const [allResult, activeResult] = await Promise.allSettled([
      allListings,
      this.reports.start(
        {
          intent: "active-business-listings",
          marketplaceId: input.marketplaceId,
          signal: input.signal,
        },
        { explicitRetry: input.explicitRetry, expectedContext: context },
      ),
    ]);
    const rejectedReasons = [allResult, activeResult].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    const identityFence = rejectedReasons.find(isIdentityFenceError);
    if (identityFence) throw identityFence;
    const cancellation = rejectedReasons.find(isAbortError);
    if (cancellation) throw cancellation;
    if (allResult.status === "rejected") {
      throw allResult.reason;
    }
    await this.context.assertCurrent(context);
    return allResult.value;
  }

  async status(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt> {
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const receipt = await this.reports.status(
      {
        intent: "all-listings",
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      },
      input.reportId,
      context,
    );
    await this.context.assertCurrent(context);
    return receipt;
  }

  /**
   * Data-GET seam for legacy consumers. Demo data has no report lifecycle;
   * live mode may read or poll one existing lease but can never create one.
   */
  async readExistingExport(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<FbaCatalogExistingExport> {
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    if (context.mode === "demo") {
      const data = await this.demo.export({
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      });
      await this.context.assertCurrent(context);
      return { state: "ready", data };
    }
    const plan = {
      intent: "all-listings" as const,
      marketplaceId: input.marketplaceId,
      signal: input.signal,
    };
    let receipt = await this.reports.read(plan, context);
    await this.context.assertCurrent(context);
    if (!receipt) return { state: "missing" };
    if (!receipt.ready) {
      receipt = await this.reports.status(plan, receipt.reportId, context);
      await this.context.assertCurrent(context);
    }
    if (!receipt.ready || !receipt.documentId) {
      return { state: "pending", receipt };
    }
    const data = await this.read({
      view: "export",
      marketplaceId: input.marketplaceId,
      reportId: receipt.reportId,
      documentId: receipt.documentId,
      signal: input.signal,
      expectedContext: context,
    });
    await this.context.assertCurrent(context);
    return { state: "ready", data };
  }

  async read(
    input: CatalogReadBase & Readonly<{ view: "export"; onProgress?: (
      progress: CatalogExportProgress,
    ) => void | Promise<void> }>,
  ): Promise<FbaCatalogExport>;
  async read(
    input: CatalogReadBase & Readonly<{ view: "identity" }>,
  ): Promise<FbaCatalogIdentitySnapshot>;
  async read(
    input: CatalogReadBase & Readonly<{ view: "seeds" }>,
  ): Promise<FbaCatalogSeed[]>;
  async read(
    input: CatalogReadBase & Readonly<{
      view: "business-pricing-audit";
      heartbeat?: () => void;
    }>,
  ): Promise<BusinessPricingAuditSnapshot>;
  async read(
    input: FbaCatalogReportsReadInput,
  ): Promise<
    | FbaCatalogExport
    | FbaCatalogIdentitySnapshot
    | FbaCatalogSeed[]
    | BusinessPricingAuditSnapshot
  > {
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const plan = {
      intent: "all-listings" as const,
      marketplaceId: input.marketplaceId,
      signal: input.signal,
    };
    if (context.mode === "demo") {
      const receipt = await this.reports.read(plan, context);
      await this.context.assertCurrent(context);
      if (
        !receipt ||
        !receipt.ready ||
        receipt.mode !== "demo" ||
        receipt.reportId !== input.reportId ||
        receipt.documentId !== input.documentId
      ) {
        throw new SpApiError("展示用 Catalog 報表資訊不相符。", {
          status: 409,
          code: "REPORT_MISMATCH",
        });
      }
      const demoInput = {
        marketplaceId: input.marketplaceId,
        signal: input.signal,
      };
      const result = input.view === "export"
        ? await this.demo.export(demoInput)
        : input.view === "identity"
          ? await this.demo.identity(demoInput)
          : input.view === "seeds"
            ? await this.demo.seeds(demoInput)
            : await this.demo.businessPricingAudit(demoInput);
      await this.context.assertCurrent(context);
      return result;
    }
    const document = await this.reports.readDocument(
      plan,
      { reportId: input.reportId, documentId: input.documentId },
      context,
    );
    await this.context.assertCurrent(context);
    if (document.mode !== context.mode) {
      throw new SpApiError("Catalog 報表模式與目前 App 設定不一致。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }

    if (input.view === "export") {
      const result = await readFbaCatalogExport(this.listings, {
        marketplaceId: input.marketplaceId,
        mode: "live",
        document: document.text,
        signal: input.signal,
        onProgress: input.onProgress,
        pace: this.pace,
        now: this.now,
      });
      await this.context.assertCurrent(context);
      return result;
    }
    if (input.view === "identity") {
      const result = readFbaCatalogIdentity({
        marketplaceId: input.marketplaceId,
        mode: "live",
        document: document.text,
        signal: input.signal,
        now: this.now,
      });
      await this.context.assertCurrent(context);
      return result;
    }
    if (input.view === "seeds") {
      const result = readFbaCatalogSeeds(document.text, input.signal);
      await this.context.assertCurrent(context);
      return result;
    }

    const activeListingsDocument = await this.readExistingActiveDocument(
      input.marketplaceId,
      context.mode,
      context,
      input.signal,
      "heartbeat" in input ? input.heartbeat : undefined,
    );
    await this.context.assertCurrent(context);
    const result = await readFbaBusinessPricingAudit(this.listings, {
      marketplaceId: input.marketplaceId,
      mode: "live",
      allListingsDocument: document.text,
      activeListingsDocument,
      signal: input.signal,
      pace: this.pace,
      now: this.now,
    });
    await this.context.assertCurrent(context);
    return result;
  }

  private async readExistingActiveDocument(
    marketplaceId: MarketplaceId,
    expectedMode: "live" | "demo",
    context: SpExecutionContext,
    signal?: AbortSignal,
    heartbeat?: () => void,
  ): Promise<string | null> {
    const plan = {
      intent: "active-business-listings" as const,
      marketplaceId,
      signal,
    };
    try {
      heartbeat?.();
      let receipt = await this.reports.read(plan, context);
      heartbeat?.();
      if (!receipt) return null;
      for (let attempt = 0; !receipt.ready && attempt < 180; attempt += 1) {
        if (
          receipt.status !== "IN_QUEUE" &&
          receipt.status !== "IN_PROGRESS"
        ) {
          return null;
        }
        await this.pace(1_000, signal);
        heartbeat?.();
        receipt = await this.reports.status(plan, receipt.reportId, context);
        heartbeat?.();
      }
      if (
        !receipt.ready ||
        !receipt.documentId ||
        receipt.mode !== expectedMode
      ) {
        return null;
      }
      const document = await this.reports.readDocument(plan, {
        reportId: receipt.reportId,
        documentId: receipt.documentId,
      }, context);
      heartbeat?.();
      if (document.mode !== expectedMode) {
        throw new SpApiError("B2B 報表模式與全商品報表不一致。", {
          status: 409,
          code: "REPORT_MODE_CHANGED",
        });
      }
      return document.text;
    } catch (error) {
      rethrowReadFence(error);
      return null;
    }
  }
}
