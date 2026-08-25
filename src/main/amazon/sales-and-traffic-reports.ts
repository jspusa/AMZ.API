import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  ReportsRuntime,
  ReportsRuntimeReceipt,
} from "./reports-runtime";
import {
  assertSalesAndTrafficDateSelection,
  planCompletedSalesAndTrafficWindow,
} from "./revenue-report-windows";
import {
  projectSalesAndTrafficSnapshot,
  readSalesAndTrafficDocument,
  type SalesAndTrafficSnapshot,
} from "./sales-and-traffic-reads";
import { SpApiError } from "./sp-api-error";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "./sp-execution-context";

type ReportsPort = Pick<
  ReportsRuntime,
  "start" | "read" | "status" | "readDocument"
>;

export type SalesAndTrafficDocumentReader = (
  input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    document: string;
    signal?: AbortSignal;
  }>,
) => SalesAndTrafficSnapshot | Promise<SalesAndTrafficSnapshot>;

export interface SalesAndTrafficDemoSource {
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    signal?: AbortSignal;
  }>): SalesAndTrafficSnapshot | Promise<SalesAndTrafficSnapshot>;
}

type SalesAndTrafficSelection = Readonly<{
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  signal?: AbortSignal;
}>;

function fixedPlan(
  input: SalesAndTrafficSelection,
  range: Readonly<{ startDate: string; endDate: string }>,
) {
  return {
    intent: "sales-and-traffic-daily-sku" as const,
    marketplaceId: input.marketplaceId,
    startDate: range.startDate,
    endDate: range.endDate,
    signal: input.signal,
  };
}

function beginPlan(input: SalesAndTrafficSelection) {
  return fixedPlan(input, planCompletedSalesAndTrafficWindow(input));
}

function acceptedPlan(input: SalesAndTrafficSelection) {
  return fixedPlan(input, assertSalesAndTrafficDateSelection(input));
}

/**
 * Semantic owner of the fixed DAY + SKU Business Report. Callers provide a
 * marketplace range and opaque runtime handles; report type/options,
 * lifecycle, download and document validation stay behind this boundary.
 */
export class SalesAndTrafficReports {
  private readonly reports: ReportsPort;
  private readonly context: SpExecutionContextAdapter;
  private readonly liveReader: SalesAndTrafficDocumentReader;
  private readonly demo: SalesAndTrafficDemoSource;

  constructor(input: Readonly<{
    reports: ReportsPort;
    context: SpExecutionContextAdapter;
    liveReader?: SalesAndTrafficDocumentReader;
    demo: SalesAndTrafficDemoSource;
  }>) {
    this.reports = input.reports;
    this.context = input.context;
    this.liveReader = input.liveReader ?? readSalesAndTrafficDocument;
    this.demo = input.demo;
  }

  private async executionContext(
    marketplaceId: MarketplaceId,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    if (!expected) return this.context.capture(marketplaceId);
    if (expected.marketplaceId !== marketplaceId) {
      throw new SpApiError("銷售與流量報表與固定執行站點不一致。", {
        status: 409,
        code: "SP_CONTEXT_INVALIDATED",
      });
    }
    await this.context.assertCurrent(expected);
    return expected;
  }

  private async settleInContext<T>(
    context: SpExecutionContext,
    operation: Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation;
      await this.context.assertCurrent(context);
      return result;
    } catch (error) {
      if (
        error instanceof SpApiError &&
        [
          "ACCOUNT_SCOPE_CHANGED",
          "REPORT_MODE_CHANGED",
          "SP_CONTEXT_INVALIDATED",
        ].includes(error.code)
      ) {
        throw error;
      }
      await this.context.assertCurrent(context);
      throw error;
    }
  }

  async begin(input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    explicitRetry: boolean;
    freshCompleted?: boolean;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt> {
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const receipt = await this.reports.start(beginPlan(input), {
      explicitRetry: input.explicitRetry,
      freshCompleted: input.freshCompleted,
      expectedContext: context,
    });
    await this.context.assertCurrent(context);
    return receipt;
  }

  async status(input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    reportId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<ReportsRuntimeReceipt> {
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const receipt = await this.reports.status(
      acceptedPlan(input),
      input.reportId,
      context,
    );
    await this.context.assertCurrent(context);
    return receipt;
  }

  async read(input: Readonly<{
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
    expectedContext?: SpExecutionContext;
  }>): Promise<SalesAndTrafficSnapshot> {
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const reportPlan = acceptedPlan(input);
    if (context.mode === "demo") {
      const receipt = await this.reports.read(reportPlan, context);
      await this.context.assertCurrent(context);
      if (
        !receipt ||
        !receipt.ready ||
        receipt.mode !== "demo" ||
        receipt.reportId !== input.reportId ||
        receipt.documentId !== input.documentId
      ) {
        throw new SpApiError("展示銷售與流量報表資訊不相符。", {
          status: 409,
          code: "REPORT_MISMATCH",
        });
      }
      const result = await this.settleInContext(
        context,
        Promise.resolve(this.demo.read(input)),
      );
      return projectSalesAndTrafficSnapshot(result, {
        mode: context.mode,
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }
    const document = await this.reports.readDocument(reportPlan, {
      reportId: input.reportId,
      documentId: input.documentId,
    }, context);
    await this.context.assertCurrent(context);
    if (document.mode !== context.mode) {
      throw new SpApiError("銷售與流量報表模式與目前 App 設定不一致。", {
        status: 409,
        code: "REPORT_MODE_CHANGED",
      });
    }
    const result = await this.settleInContext(
      context,
      Promise.resolve(this.liveReader({
        marketplaceId: input.marketplaceId,
        startDate: input.startDate,
        endDate: input.endDate,
        document: document.text,
        signal: input.signal,
      })),
    );
    return projectSalesAndTrafficSnapshot(result, {
      mode: context.mode,
      marketplaceId: input.marketplaceId,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  }
}
