import { throwIfAborted } from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import { DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT } from
  "./inbound-noncompliance";
import type { DurableReportGatewayStatus } from "./report-lifecycle";
import {
  reportsAdapterIdentity,
  type ReportsAdapter,
  type ReportsIntentPlan,
} from "./reports-runtime";
import { SpApiError } from "./sp-api-error";

type DemoFixedReportStart = (input: Readonly<{
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>) => Promise<DurableReportGatewayStatus>;

type DemoFixedReportStatus = (input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
}>) => Promise<DurableReportGatewayStatus>;

export type DemoAllListingsReportGateway = Readonly<{
  start: DemoFixedReportStart;
  status: DemoFixedReportStatus;
}>;

export type BusinessPricingActiveListingsReportGateway = Readonly<{
  start: DemoFixedReportStart;
  status: DemoFixedReportStatus;
}>;

export type InboundNoncomplianceDemoReportGateway = Readonly<{
  start(input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>): Promise<DurableReportGatewayStatus>;
  status(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
  }>): Promise<DurableReportGatewayStatus>;
  document(input: Readonly<{
    marketplaceId: MarketplaceId;
    reportId: string;
    documentId: string;
    signal?: AbortSignal;
  }>): Promise<string>;
}>;

/**
 * Narrow deterministic seams retained for focused composition tests. Each
 * override is merged into a complete demo gateway, so callers only replace
 * the operation whose behavior they need to observe.
 */
export type DemoReportsAdapterOverrides = Readonly<{
  allListingsDemoReports?: Partial<DemoAllListingsReportGateway>;
  businessPricingActiveListingsReports?: Partial<
    BusinessPricingActiveListingsReportGateway
  >;
  inboundNoncomplianceDemoReports?: Partial<
    InboundNoncomplianceDemoReportGateway
  >;
}>;

type FixedReportIntent =
  | "all-listings"
  | "active-business-listings"
  | "aged-inventory";

function demoReportReference(
  intent: FixedReportIntent,
  marketplaceId: MarketplaceId,
): string {
  switch (intent) {
    case "all-listings":
      return `demo-${marketplaceId}`;
    case "active-business-listings":
      return `demo-b2b-active-${marketplaceId}`;
    case "aged-inventory":
      return `demo-aged-${marketplaceId}`;
  }
}

function fixedReportNotice(intent: FixedReportIntent): string {
  switch (intent) {
    case "all-listings":
      return "展示報表已準備完成。";
    case "active-business-listings":
      return "展示 Active Listings 報表已準備完成。";
    case "aged-inventory":
      return "展示用 FBA 庫齡報表已準備完成。";
  }
}

async function startDemoFixedReport(input: Readonly<{
  intent: FixedReportIntent;
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>): Promise<DurableReportGatewayStatus> {
  throwIfAborted(input.signal);
  const reference = demoReportReference(input.intent, input.marketplaceId);
  return {
    mode: "demo",
    ready: true,
    reportId: reference,
    documentId: reference,
    status: "DONE",
    notice: fixedReportNotice(input.intent),
  };
}

async function statusDemoFixedReport(input: Readonly<{
  intent: FixedReportIntent;
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
}>): Promise<DurableReportGatewayStatus> {
  throwIfAborted(input.signal);
  return {
    mode: "demo",
    ready: true,
    reportId: input.reportId,
    documentId: demoReportReference(input.intent, input.marketplaceId),
    status: "DONE",
    notice: fixedReportNotice(input.intent),
  };
}

function assertDemoReportsRequest(
  request: Readonly<{ mode: "live" | "demo" }>,
): void {
  if (request.mode !== "demo") {
    throw new SpApiError("展示 Reports adapter 不接受正式 Amazon 請求。", {
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
  }
}

type DemoRevenuePlan = Extract<
  ReportsIntentPlan,
  { intent: "fba-shipment-sales" | "sales-and-traffic-daily-sku" }
>;

function demoRevenueReportReference(request: DemoRevenuePlan): string {
  return request.intent === "fba-shipment-sales"
    ? `demo-brand-${request.marketplaceId}-${request.startDate}-${request.endDate}`
    : `demo-sales-traffic-${request.marketplaceId}-${request.startDate}-${request.endDate}`;
}

function demoRevenueReportStatus(
  request: DemoRevenuePlan,
  reportId?: string,
): DurableReportGatewayStatus {
  const reference = demoRevenueReportReference(request);
  if (reportId !== undefined && reportId !== reference) {
    throw new SpApiError("展示營收報表與目前站點或日期不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  return {
    mode: "demo",
    ready: true,
    reportId: reference,
    documentId: reference,
    status: "DONE",
    notice: request.intent === "fba-shipment-sales"
      ? "展示用 FBA 品牌出貨報表已準備完成。"
      : "展示用銷售與流量報表已準備完成。",
  };
}

function demoInboundNoncomplianceReference(
  marketplaceId: MarketplaceId,
): string {
  return `demo-inbound-noncompliance-${marketplaceId}`;
}

async function startDemoInboundNoncomplianceReport(input: Readonly<{
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>): Promise<DurableReportGatewayStatus> {
  throwIfAborted(input.signal);
  const reference = demoInboundNoncomplianceReference(input.marketplaceId);
  return {
    mode: "demo",
    ready: true,
    reportId: reference,
    documentId: reference,
    status: "DONE",
    notice: "展示用 FBA 入庫瑕疵報表已準備完成。",
  };
}

async function statusDemoInboundNoncomplianceReport(input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  signal?: AbortSignal;
}>): Promise<DurableReportGatewayStatus> {
  throwIfAborted(input.signal);
  const reference = demoInboundNoncomplianceReference(input.marketplaceId);
  if (input.reportId !== reference) {
    throw new SpApiError("展示報表編號與目前站點不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  return startDemoInboundNoncomplianceReport(input);
}

async function readDemoInboundNoncomplianceDocument(input: Readonly<{
  marketplaceId: MarketplaceId;
  reportId: string;
  documentId: string;
  signal?: AbortSignal;
}>): Promise<string> {
  throwIfAborted(input.signal);
  const reference = demoInboundNoncomplianceReference(input.marketplaceId);
  if (input.reportId !== reference || input.documentId !== reference) {
    throw new SpApiError("展示報表文件與目前站點不一致。", {
      status: 409,
      code: "REPORT_MISMATCH",
    });
  }
  return DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT;
}

function defaultAllListingsGateway(): DemoAllListingsReportGateway {
  return {
    start: (request) => startDemoFixedReport({
      intent: "all-listings",
      ...request,
    }),
    status: (request) => statusDemoFixedReport({
      intent: "all-listings",
      ...request,
    }),
  };
}

function defaultActiveBusinessGateway():
  BusinessPricingActiveListingsReportGateway {
  return {
    start: (request) => startDemoFixedReport({
      intent: "active-business-listings",
      ...request,
    }),
    status: (request) => statusDemoFixedReport({
      intent: "active-business-listings",
      ...request,
    }),
  };
}

function defaultInboundNoncomplianceGateway():
  InboundNoncomplianceDemoReportGateway {
  return {
    start: startDemoInboundNoncomplianceReport,
    status: statusDemoInboundNoncomplianceReport,
    document: readDemoInboundNoncomplianceDocument,
  };
}

/**
 * Complete deterministic Reports adapter for demo mode. The adapter owns the
 * semantic intent-to-fixture mapping and never accepts a live request.
 */
export function createDemoReportsAdapter(
  overrides: DemoReportsAdapterOverrides = {},
): ReportsAdapter {
  const allListings = {
    ...defaultAllListingsGateway(),
    ...overrides.allListingsDemoReports,
  };
  const activeBusiness = {
    ...defaultActiveBusinessGateway(),
    ...overrides.businessPricingActiveListingsReports,
  };
  const inboundNoncompliance = {
    ...defaultInboundNoncomplianceGateway(),
    ...overrides.inboundNoncomplianceDemoReports,
  };
  const identity = (
    request: ReportsIntentPlan & { mode: "live" | "demo" },
    result?: Readonly<{ mode: "live" | "demo" }>,
  ) => reportsAdapterIdentity(
    request as unknown as ReportsIntentPlan,
    result?.mode ?? request.mode,
  );

  return {
    async create(request) {
      assertDemoReportsRequest(request);
      const result = request.intent === "all-listings"
        ? await allListings.start({
            marketplaceId: request.marketplaceId,
            signal: request.signal,
          })
        : request.intent === "active-business-listings"
          ? await activeBusiness.start({
              marketplaceId: request.marketplaceId,
              signal: request.signal,
            })
          : request.intent === "aged-inventory"
            ? await startDemoFixedReport({
                intent: "aged-inventory",
                marketplaceId: request.marketplaceId,
                signal: request.signal,
              })
            : request.intent === "inbound-noncompliance"
              ? await inboundNoncompliance.start({
                  marketplaceId: request.marketplaceId,
                  signal: request.signal,
                })
              : request.intent === "sales-and-traffic-daily-sku"
                ? demoRevenueReportStatus(request)
                : demoRevenueReportStatus(request);
      return { ...result, identity: identity(request, result) };
    },

    async status(request) {
      assertDemoReportsRequest(request);
      const result = request.intent === "all-listings"
        ? await allListings.status({
            marketplaceId: request.marketplaceId,
            reportId: request.reportId,
            signal: request.signal,
          })
        : request.intent === "active-business-listings"
          ? await activeBusiness.status({
              marketplaceId: request.marketplaceId,
              reportId: request.reportId,
              signal: request.signal,
            })
          : request.intent === "aged-inventory"
            ? await statusDemoFixedReport({
                intent: "aged-inventory",
                marketplaceId: request.marketplaceId,
                reportId: request.reportId,
                signal: request.signal,
              })
            : request.intent === "inbound-noncompliance"
              ? await inboundNoncompliance.status({
                  marketplaceId: request.marketplaceId,
                  reportId: request.reportId,
                  signal: request.signal,
                })
              : request.intent === "sales-and-traffic-daily-sku"
                ? demoRevenueReportStatus(request, request.reportId)
                : demoRevenueReportStatus(request, request.reportId);
      return { ...result, identity: identity(request, result) };
    },

    async readDocument(request) {
      assertDemoReportsRequest(request);
      return {
        identity: identity(request),
        reportId: request.reportId,
        documentId: request.documentId,
        text: request.intent === "inbound-noncompliance"
          ? await inboundNoncompliance.document({
              marketplaceId: request.marketplaceId,
              reportId: request.reportId,
              documentId: request.documentId,
              signal: request.signal,
            })
          : "",
      };
    },
  };
}
