import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOperationsSourceReaders } from "../src/main/operations-source-readers";
import { FbaCatalogReports } from "../src/main/amazon/fba-catalog-reports";
import { FixedReportBroker } from "../src/main/amazon/report-broker";
import { createScriptedReportsAdapter, reportsAdapterIdentity, type ReportsAdapter } from "../src/main/amazon/reports-runtime";
import { SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID, type AdvertisingGateway } from "../src/main/amazon/ads-api";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { createScriptedListingsReadAdapter } from "../src/main/amazon/listings-reads";
import { ListingsExport } from "../src/main/amazon/listings-export";
import { SalesAndTrafficReports } from "../src/main/amazon/sales-and-traffic-reports";
import { ReadOnlyAdvertisingCoordinator } from "../src/main/advertising-read-coordinator";
import { PromotionsReads, type PromotionsReadAdapter } from "../src/main/amazon/promotions-reads";
import { AwdInventoryReads, type AwdInventoryReadAdapter } from "../src/main/amazon/awd-inventory-reads";
import { PriceHealthReads, type PriceHealthReadAdapter } from "../src/main/amazon/price-health-reads";
import { LocalStore } from "../src/main/local-store";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const US = "ATVPDKIKX0DER" as const;
const INSTANT = Date.parse("2026-09-08T12:00:00.000Z");
const unused = async (): Promise<never> => { throw new Error("Unexpected external fixture operation"); };
const cleanups: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(INSTANT); });
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.useRealTimers(); });

async function fixture(options: {
  document?: string;
  reportsAdapter?: ReportsAdapter;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  promotionsAdapter?: PromotionsReadAdapter;
  awdAdapter?: AwdInventoryReadAdapter;
  priceAdapter?: PriceHealthReadAdapter;
  advertisingGateway?: AdvertisingGateway;
  catalogNow?: () => Date;
} = {}) {
  let accountScope = "fixture-operations-account";
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope }));
  const store = new LocalStore(join(await mkdtemp(join(tmpdir(), "amz-operations-sources-")), "data.json"));
  await store.initialize();
  const reportsAdapter = options.reportsAdapter ?? createScriptedReportsAdapter([
    { operation: "create", result: { mode: "live", ready: true, reportId: "fixture-report", documentId: "fixture-document", status: "DONE", notice: "ready" } },
    { operation: "document", result: { text: options.document ?? "seller-sku\tasin1\titem-name\tfulfillment-channel\nSKU-ONE\tB000000001\tOne\tAMAZON_NA\nFBM-ONE\tB000000002\tOther\tDEFAULT" } },
  ]);
  const broker = new FixedReportBroker({ store, context, reportsAdapter, advertising: options.advertisingGateway });
  const catalog = new FbaCatalogReports({ reports: broker, context, listings: createScriptedListingsReadAdapter([]), demo: { export: unused, identity: unused, seeds: unused, businessPricingAudit: unused }, now: options.catalogNow ?? (() => new Date(options.now?.() ?? INSTANT)) });
  const listingsExport = new ListingsExport({ context, startReport: (input) => catalog.begin({ ...input, purpose: "catalog" }), statusReport: (input) => catalog.status(input), readReport: (input) => catalog.read({ ...input, view: "export" }) });
  const advertising = new ReadOnlyAdvertisingCoordinator({ context, advertising: options.advertisingGateway ?? null, reports: broker, catalog, salesAndTraffic: new SalesAndTrafficReports({ reports: broker, context, demo: { read: unused } }), listingsExport, loadAuditSuiteListings: unused, wait: options.wait, now: options.now ?? (() => INSTANT) });
  const readers = createOperationsSourceReaders({
    context, catalog, advertising,
    promotions: new PromotionsReads({ context, adapter: options.promotionsAdapter ?? { searchPromotions: unused, getPromotion: unused, getSelection: unused } }),
    awd: new AwdInventoryReads({ context, adapter: options.awdAdapter ?? { listInventory: unused, listInboundShipments: unused, getInboundShipment: unused } }),
    priceHealth: new PriceHealthReads({ context, adapter: options.priceAdapter ?? { readCompetitiveSummary: unused } }),
    now: options.now ?? (() => INSTANT), wait: options.wait ?? (async () => undefined),
  });
  cleanups.push(() => { broker.clear(); advertising.clear(); listingsExport.clear(); });
  return { readers, context, switchAccount: () => { accountScope = "fixture-operations-account-b"; } };
}

function adsGateway(): AdvertisingGateway {
  return {
    getCredentialSummary: async () => ({ encryptionAvailable: true, hasVault: true, configured: true, lwaConfigured: true, refreshTokenConfigured: true, oauthRegion: "na", updatedAt: null }),
    getCombinedAccountIdentity: async () => ({ combinedAccountScope: "fixture-ads-account", adsProfileFingerprint: "a".repeat(64) }),
    probeMarketplace: unused, listEnabledSponsoredProductCampaigns: unused, invalidate: () => undefined,
    createSponsoredProductsAdvertisedProductReport: async (input) => ({ marketplaceId: US, combinedAccountScope: "fixture-ads-account", reportId: "fixture-private-ads-report", startDate: input.startDate, endDate: input.endDate, configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID }),
    getSponsoredProductsAdvertisedProductReportStatus: async (reference) => ({ reference, status: "COMPLETED", ready: true, updatedAt: "2026-09-08T12:00:00.000Z" }),
    downloadSponsoredProductsAdvertisedProductReport: async (reference) => ({ reference, rows: [{ campaignId: "fixture-private-campaign", campaignName: "Synthetic", adGroupId: "fixture-private-group", adGroupName: "Synthetic", advertisedSku: "SKU-ONE", advertisedAsin: "B000000001", impressions: 200, clicks: 10, cost: 40, sales14d: 20, purchases14d: 1 }] }),
  };
}

function adsReportsAdapter(): ReportsAdapter {
  return {
    create: async (request) => ({ identity: reportsAdapterIdentity(request, request.mode), mode: "live", ready: true, reportId: `fixture-${request.intent}`, documentId: `fixture-document-${request.intent}`, status: "DONE", notice: "ready" }),
    status: unused,
    readDocument: async (request) => ({ identity: reportsAdapterIdentity(request, request.mode), reportId: request.reportId, documentId: request.documentId, text: request.intent === "all-listings"
      ? "seller-sku\tasin1\titem-name\tfulfillment-channel\nSKU-ONE\tB000000001\tOne\tAMAZON_NA"
      : request.intent === "sales-and-traffic-daily-sku" ? JSON.stringify({ reportSpecification: { reportType: "GET_SALES_AND_TRAFFIC_REPORT", reportOptions: { dateGranularity: "DAY", asinGranularity: "SKU" }, marketplaceIds: [US], dataStartTime: request.startDate, dataEndTime: request.endDate }, salesAndTrafficByAsin: [{ sku: "SKU-ONE", childAsin: "B000000001", salesByAsin: { unitsOrdered: 10, orderedProductSales: { amount: 100, currencyCode: "USD" } } }] }) : "" }),
  };
}

describe("operations source readers", () => {
  it("returns only exact current FBA identities through the existing report lifecycle", async () => {
    const app = await fixture();
    const identities = await app.readers.fba(await app.context.capture(US), new AbortController().signal);
    expect(identities).toEqual([{ sellerSku: "SKU-ONE", asin: "B000000001" }]);
  });

  it("waits for the same pending catalog report without issuing a replacement create", async () => {
    const adapter = createScriptedReportsAdapter([
      { operation: "create", result: { mode: "live", ready: false, reportId: "fixture-report", documentId: null, status: "IN_QUEUE", notice: "pending" } },
      { operation: "status", result: { mode: "live", ready: true, reportId: "fixture-report", documentId: "fixture-document", status: "DONE", notice: "ready" } },
      { operation: "document", result: { text: "seller-sku\tasin1\tfulfillment-channel\nSKU-ONE\tB000000001\tAMAZON_NA" } },
    ]);
    const app = await fixture({ reportsAdapter: adapter });
    expect(await app.readers.fba(await app.context.capture(US), new AbortController().signal)).toEqual([{ sellerSku: "SKU-ONE", asin: "B000000001" }]);
  });

  it("rejects a catalog exceeding the operations safety bound instead of truncating its FBA proof", async () => {
    const app = await fixture({ document: "seller-sku\tasin1\tfulfillment-channel\n" + Array.from({ length: 5_001 }, (_, index) => `SKU-${index}\tB000000001\tAMAZON_NA`).join("\n") });
    await expect(app.readers.fba(await app.context.capture(US), new AbortController().signal)).rejects.toMatchObject({ code: "OPERATIONS_FBA_IDENTITY_INVALID" });
  });

  it("projects a verified empty promotions search using the current FBA proof", async () => {
    const app = await fixture({ promotionsAdapter: { searchPromotions: async () => ({ totalResults: 0, promotions: [] }), getPromotion: unused, getSelection: unused } });
    const context = await app.context.capture(US);
    const signal = new AbortController().signal;
    const data = await app.readers.read("promotions", { context, signal, fba: await app.readers.fba(context, signal) });
    expect(data).toMatchObject({ marketplaceId: US, mode: "live", coverage: "complete", promotions: [], findings: [] });
  });

  it("exposes AWD quantities without inventing missing stock or combining supply stages", async () => {
    const app = await fixture({ awdAdapter: { listInventory: async () => ({ inventory: [{ sku: "SKU-ONE", totalInboundQuantity: 24 }] }), listInboundShipments: async () => ({ shipments: [] }), getInboundShipment: unused } });
    const context = await app.context.capture(US);
    const signal = new AbortController().signal;
    const data = await app.readers.read("awd", { context, signal, fba: await app.readers.fba(context, signal) });
    expect(data).toMatchObject({ coverage: "partial", stockScope: "AWD_SHARED_DOWNSTREAM", rows: [{ sellerSku: "SKU-ONE", totalInboundQuantity: 24, totalOnhandQuantity: null }] });
  });

  it("keeps missing price evidence unavailable rather than declaring healthy Buy Box eligibility", async () => {
    const app = await fixture({ priceAdapter: { readCompetitiveSummary: async () => ({ ownSellerId: "fixture-own-seller", payload: { responses: [] } }) } });
    const context = await app.context.capture(US);
    const signal = new AbortController().signal;
    const data = await app.readers.read("price-health", { context, signal, fba: await app.readers.fba(context, signal) });
    expect(data).toMatchObject({ coverage: "partial", rows: [{ sellerSku: "SKU-ONE", availability: "unavailable", overallEligibility: "unknown", currentPrice: null }] });
  });

  it("diagnoses the existing SP strategy using the last 30 completed Marketplace Days without exposing report identities", async () => {
    const app = await fixture({ advertisingGateway: adsGateway(), reportsAdapter: adsReportsAdapter(), wait: async () => new Promise((resolve) => setTimeout(resolve, 1)) });
    const data = await app.readers.read("advertising", { context: await app.context.capture(US), signal: new AbortController().signal, fba: [] });
    expect(data).toMatchObject({ marketplaceId: US, mode: "live", dateRange: { startDate: "2026-08-09", endDate: "2026-09-07" }, rows: [{ sellerSku: "SKU-ONE", spend: 40, attributedSales14d: 20, acos: 2, status: "needs-review" }] });
    expect(JSON.stringify(data)).not.toMatch(/fixture-private|fixture-ads-account|reportId|campaignId/);
  });

  it("does not publish Ads diagnostics using an older operation's account context", async () => {
    const app = await fixture({ advertisingGateway: adsGateway(), reportsAdapter: adsReportsAdapter(), wait: async () => new Promise((resolve) => setTimeout(resolve, 1)) });
    const context = await app.context.capture(US);
    app.switchAccount();
    await expect(app.readers.read("advertising", { context, signal: new AbortController().signal, fba: [] })).rejects.toMatchObject({ status: 409, code: "ACCOUNT_SCOPE_CHANGED" });
  });

  it("cancels an Ads sync promptly even while the shared Ads owner is awaiting its account lookup", async () => {
    const controller = new AbortController();
    const gateway = adsGateway();
    gateway.getCombinedAccountIdentity = async () => {
      controller.abort(new Error("fixture-private-abort-reason"));
      return new Promise(() => undefined);
    };
    const app = await fixture({ advertisingGateway: gateway, reportsAdapter: adsReportsAdapter() });
    const result = await Promise.race([
      app.readers.read("advertising", { context: await app.context.capture(US), signal: controller.signal, fba: [] }).then(() => "incorrect-success", (error: unknown) => error),
      new Promise((resolve) => setTimeout(() => resolve("still-waiting"), 30)),
    ]);
    expect(result).toMatchObject({ name: "AbortError", message: "營運來源讀取已停止。" });
  });

  it("ends Ads observation at its wall-clock deadline without refreshing the report", async () => {
    let time = INSTANT;
    const app = await fixture({ advertisingGateway: adsGateway(), reportsAdapter: adsReportsAdapter(), now: () => time, wait: async () => { time += 4 * 60 * 60 * 1_000; } });
    await expect(app.readers.read("advertising", { context: await app.context.capture(US), signal: new AbortController().signal, fba: [] })).rejects.toMatchObject({ status: 504, code: "OPERATIONS_ADS_TIMEOUT" });
  });

  it("rejects visually hidden FBA identity characters without normalizing the Seller SKU", async () => {
    const app = await fixture({ document: "seller-sku\tasin1\tfulfillment-channel\nSKU-ONE\u2066\tB000000001\tAMAZON_NA" });
    await expect(app.readers.fba(await app.context.capture(US), new AbortController().signal)).rejects.toMatchObject({ code: "OPERATIONS_FBA_IDENTITY_INVALID" });
  });

  it("eventually refreshes a completed same-day Ads selection after existing job and report retention expire", async () => {
    let time = INSTANT;
    let latestSpend = 40;
    let reportSpend = 0;
    const gateway = adsGateway();
    const create = gateway.createSponsoredProductsAdvertisedProductReport!;
    const download = gateway.downloadSponsoredProductsAdvertisedProductReport!;
    gateway.createSponsoredProductsAdvertisedProductReport = async (input) => { reportSpend = latestSpend; return create(input); };
    gateway.downloadSponsoredProductsAdvertisedProductReport = async (reference, signal) => {
      const result = await download(reference, signal);
      return { ...result, rows: result.rows.map((row) => ({ ...row, cost: reportSpend })) };
    };
    const app = await fixture({ advertisingGateway: gateway, reportsAdapter: adsReportsAdapter(), now: () => time, wait: async () => new Promise((resolve) => setTimeout(resolve, 1)) });
    const context = await app.context.capture(US);
    const input = { context, signal: new AbortController().signal, fba: [] };
    expect(await app.readers.read("advertising", input)).toMatchObject({ rows: [{ spend: 40 }] });
    latestSpend = 55;
    time += 61 * 60 * 1_000;
    vi.setSystemTime(time);
    expect(await app.readers.read("advertising", input)).toMatchObject({ rows: [{ spend: 55 }], fetchedAt: "2026-09-08T13:01:00.000Z" });
  });

  it("preserves catalog permission failures but never forwards private upstream error material", async () => {
    const app = await fixture({ reportsAdapter: { create: async () => { throw new SpApiError("access_token=fixture-private-material", { status: 403, code: "ACCESS_DENIED" }); }, status: unused, readDocument: unused } });
    const result = app.readers.fba(await app.context.capture(US), new AbortController().signal);
    await expect(result).rejects.toMatchObject({ status: 403, code: "ACCESS_DENIED" });
    await expect(result).rejects.not.toThrow("fixture-private-material");
  });

  it("does not silently accept an implausible future FBA document observation time", async () => {
    const app = await fixture({ catalogNow: () => new Date("2026-09-09T12:00:00.000Z") });
    await expect(app.readers.fba(await app.context.capture(US), new AbortController().signal)).rejects.toMatchObject({ code: "OPERATIONS_FBA_EVIDENCE_STALE" });
  });
});
