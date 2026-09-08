import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsIntelligenceCoordinator } from "../src/main/operations-intelligence-coordinator";
import { createOperationsSourceReaders } from "../src/main/operations-source-readers";
import { FbaCatalogReports } from "../src/main/amazon/fba-catalog-reports";
import { FixedReportBroker } from "../src/main/amazon/report-broker";
import { reportsAdapterIdentity, type ReportsAdapter } from "../src/main/amazon/reports-runtime";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { createScriptedListingsReadAdapter } from "../src/main/amazon/listings-reads";
import { ListingsExport } from "../src/main/amazon/listings-export";
import { SalesAndTrafficReports } from "../src/main/amazon/sales-and-traffic-reports";
import { ReadOnlyAdvertisingCoordinator } from "../src/main/advertising-read-coordinator";
import { SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID, type AdvertisingGateway } from "../src/main/amazon/ads-api";
import { PromotionsReads } from "../src/main/amazon/promotions-reads";
import { AwdInventoryReads } from "../src/main/amazon/awd-inventory-reads";
import { PriceHealthReads } from "../src/main/amazon/price-health-reads";
import { LocalStore } from "../src/main/local-store";
import { parseOperationsIntelligence } from "../src/renderer/src/operations-intelligence";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const INSTANT = "2026-09-08T12:00:00.000Z";
const unused = async (): Promise<never> => { throw new Error("Unexpected external fixture operation"); };
const cleanups: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(INSTANT); });
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.useRealTimers(); });

function request(method: "GET" | "POST", path: string, body?: Record<string, unknown>): ApiRequest {
  return { requestId: crypto.randomUUID(), method, path, headers: {},
    query: method === "GET" ? { marketplaceId: US } : {},
    ...(body ? { body: { kind: "json" as const, value: { marketplaceId: US, ...body } } } : {}) };
}
function projected(response: ApiResponse) {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON");
  return parseOperationsIntelligence(response.body.value, US);
}

async function application(sellerSku: string) {
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "fixture-private-sp-scope" }));
  const store = new LocalStore(join(await mkdtemp(join(tmpdir(), "amz-operations-e2e-")), "data.json"));
  await store.initialize();
  const reportsAdapter: ReportsAdapter = {
    create: async (input) => ({ identity: reportsAdapterIdentity(input, input.mode), mode: "live", ready: true, reportId: `fixture-private-report-${input.intent}`, documentId: `fixture-private-document-${input.intent}`, status: "DONE", notice: "ready" }),
    status: unused,
    readDocument: async (input) => ({ identity: reportsAdapterIdentity(input, input.mode), reportId: input.reportId, documentId: input.documentId, text: input.intent === "all-listings"
      ? `seller-sku\tasin1\titem-name\tfulfillment-channel\n${sellerSku}\tB000000001\tExample\tAMAZON_NA\nFBM-PRIVATE\tB000000002\tNot FBA\tDEFAULT`
      : input.intent === "sales-and-traffic-daily-sku" ? JSON.stringify({ reportSpecification: { reportType: "GET_SALES_AND_TRAFFIC_REPORT", reportOptions: { dateGranularity: "DAY", asinGranularity: "SKU" }, marketplaceIds: [US], dataStartTime: input.startDate, dataEndTime: input.endDate }, salesAndTrafficByAsin: [{ sku: sellerSku, childAsin: "B000000001", salesByAsin: { unitsOrdered: 10, orderedProductSales: { amount: 100, currencyCode: "USD" } } }] }) : "" }),
  };
  const advertisingGateway: AdvertisingGateway = {
    getCredentialSummary: async () => ({ encryptionAvailable: true, hasVault: true, configured: true, lwaConfigured: true, refreshTokenConfigured: true, oauthRegion: "na", updatedAt: null }),
    getCombinedAccountIdentity: async () => ({ combinedAccountScope: "fixture-private-ads-scope", adsProfileFingerprint: "a".repeat(64) }),
    probeMarketplace: unused, listEnabledSponsoredProductCampaigns: unused, invalidate: () => undefined,
    createSponsoredProductsAdvertisedProductReport: async (input) => ({ marketplaceId: US, combinedAccountScope: "fixture-private-ads-scope", reportId: "fixture-private-ads-report", startDate: input.startDate, endDate: input.endDate, configurationId: SP_ADVERTISED_PRODUCT_REPORT_CONFIGURATION_ID }),
    getSponsoredProductsAdvertisedProductReportStatus: async (reference) => ({ reference, status: "COMPLETED", ready: true, updatedAt: INSTANT }),
    downloadSponsoredProductsAdvertisedProductReport: async (reference) => ({ reference, rows: [{ campaignId: "fixture-private-campaign", campaignName: "Example", adGroupId: "fixture-private-ad-group", adGroupName: "Example", advertisedSku: sellerSku, advertisedAsin: "B000000001", impressions: 200, clicks: 10, cost: 40, sales14d: 20, purchases14d: 1 }] }),
  };
  const broker = new FixedReportBroker({ store, context, reportsAdapter, advertising: advertisingGateway });
  const catalog = new FbaCatalogReports({ reports: broker, context, listings: createScriptedListingsReadAdapter([]), demo: { export: unused, identity: unused, seeds: unused, businessPricingAudit: unused } });
  const listingsExport = new ListingsExport({ context, startReport: (input) => catalog.begin({ ...input, purpose: "catalog" }), statusReport: (input) => catalog.status(input), readReport: (input) => catalog.read({ ...input, view: "export" }) });
  const wait = async () => new Promise<void>((resolve) => setTimeout(resolve, 1));
  const advertising = new ReadOnlyAdvertisingCoordinator({ context, advertising: advertisingGateway, reports: broker, catalog, salesAndTraffic: new SalesAndTrafficReports({ reports: broker, context, demo: { read: unused } }), listingsExport, loadAuditSuiteListings: unused, wait });
  const promotion = {
    promotionId: "fixture-private-promotion", marketplaceId: US, promotionTitle: "September coupon", promotionType: "COUPON", status: "RUNNING",
    schedule: { startDate: "2026-09-01T00:00:00Z", endDate: "2026-09-30T23:59:59Z" },
    selection: { type: "ITEMS", selectionId: "fixture-private-selection", revisionId: 1 }, issues: [],
  };
  const rawPromotion = { ...promotion, latestRevision: { ...promotion, status: undefined, revisionStatus: "FAILED", selection: { ...promotion.selection, revisionId: 2 }, issues: [{ code: "INVALID_INPUT", severity: "ERROR", message: "Do not disclose raw Amazon issue text" }] } };
  const promotions = new PromotionsReads({ context, adapter: {
    searchPromotions: async () => ({ totalResults: 1, promotions: [rawPromotion] }),
    getPromotion: async () => rawPromotion,
    getSelection: async (input) => ({ selection: { type: "ITEMS", selectionId: input.selectionId, revisionId: input.revisionId, selectionDetails: { items: [{ sku: sellerSku, asin: "B000000001" }], issues: [] } } }),
  } });
  const awd = new AwdInventoryReads({ context, adapter: {
    listInventory: async () => ({ inventory: [{ sku: sellerSku, totalOnhandQuantity: 120, totalInboundQuantity: 24, inventoryDetails: { availableDistributableQuantity: 90, reservedDistributableQuantity: 30, replenishmentQuantity: 12 }, expirationDetails: [{ expiration: "2026-09-01T00:00:00Z", onhandQuantity: 120 }] }] }),
    listInboundShipments: async () => ({ shipments: [{ shipmentId: "fixture-private-shipment", shipmentStatus: "CLOSED" }] }),
    getInboundShipment: async () => ({ shipmentId: "fixture-private-shipment", shipmentStatus: "CLOSED", updatedAt: INSTANT, shipmentSkuQuantities: [{ sku: sellerSku, expectedQuantity: { quantity: 4, unitOfMeasurement: "CASES" }, receivedQuantity: { quantity: 2, unitOfMeasurement: "CASES" } }] }),
  } });
  const priceHealth = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => ({ ownSellerId: "fixture-private-own-seller", payload: { responses: [{ status: { statusCode: 200 }, body: { asin: "B000000001", marketplaceId: US, featuredBuyingOptions: [{ buyingOptionType: "New", segmentedFeaturedOffers: [{ sellerId: "fixture-private-other-seller", condition: "New", fulfillmentType: "AFN", listingPrice: { amount: 18, currencyCode: "USD" }, featuredOfferSegments: [{ customerMembership: "PRIME", segmentDetails: {} }] }] }], referencePrices: [{ name: "CompetitivePriceThreshold", price: { amount: 17, currencyCode: "USD" } }] } }] } }) } });
  const readers = createOperationsSourceReaders({ context, catalog, promotions, awd, priceHealth, advertising, wait });
  const owner = new OperationsIntelligenceCoordinator({ context, readers });
  cleanups.push(() => { owner.clear(); broker.clear(); advertising.clear(); listingsExport.clear(); });
  return owner;
}

describe("all-source operations intelligence through real owners and renderer projection", () => {
  it.each(["FBA-ONE", "123456789012"])("preserves SKU %s across all four source snapshots and five findings, then acknowledges an event only locally", async (sellerSku) => {
    const owner = await application(sellerSku);
    const start = await owner.start(request("POST", "/api/operations-intelligence/sync", { source: "all" }));
    expect(start.status).toBe(202);
    expect(Object.values(projected(start).sources).map((source) => source.status)).toEqual(["running", "running", "running", "running"]);
    await vi.waitFor(async () => {
      const snapshot = projected(await owner.observe(request("GET", "/api/operations-intelligence")));
      expect(Object.fromEntries(Object.entries(snapshot.sources).map(([key, value]) => [key, { status: value.status, message: value.message }]))).toMatchObject({ promotions: { status: "complete" }, awd: { status: "complete" }, "price-health": { status: "complete" }, advertising: { status: "complete" } });
    }, { timeout: 3_000, interval: 20 });
    const snapshot = projected(await owner.observe(request("GET", "/api/operations-intelligence")));
    const identity = { sellerSku, asin: "B000000001" };
    expect(snapshot.sources.promotions.snapshot).toMatchObject({ promotions: [{ title: "September coupon", published: { status: "RUNNING", items: [identity] }, latestRevision: { status: "FAILED", items: [identity] } }] });
    expect(snapshot.sources.awd.snapshot).toMatchObject({ rows: [{ ...identity, totalOnhandQuantity: 120, totalInboundQuantity: 24, replenishmentQuantity: 12 }], shipments: [{ rows: [{ ...identity, outstandingQuantity: { quantity: 2, unitOfMeasurement: "CASES" } }] }] });
    expect(snapshot.sources["price-health"].snapshot).toMatchObject({ rows: [{ ...identity, overallEligibility: "unknown", featuredObservation: "other-observed", currentPrice: null }] });
    expect(snapshot.sources.advertising.snapshot).toMatchObject({ dateRange: { startDate: "2026-08-09", endDate: "2026-09-07" }, rows: [{ ...identity, spend: 40, attributedSales14d: 20, acos: 2 }] });
    expect(snapshot.events.map((event) => event.source).sort()).toEqual(["advertising", "awd", "awd", "price-health", "promotions"]);
    expect(snapshot.events.every((event) => event.status === "open" && event.observation === "local-sync")).toBe(true);
    expect(snapshot.events.filter((event) => event.source !== "promotions").map((event) => event.sellerSku)).toEqual([sellerSku, sellerSku, sellerSku, sellerSku]);
    expect(snapshot.events.find((event) => event.source === "promotions")?.sellerSku).toBe(null);
    for (const source of Object.values(snapshot.sources)) {
      expect(source.snapshot?.findings.map((finding) => finding.sellerSku)).toEqual(source.source === "promotions" ? [null] : source.source === "awd" ? [sellerSku, sellerSku] : [sellerSku]);
    }
    expect(JSON.stringify(snapshot)).not.toMatch(/fixture-private|FBM-PRIVATE|raw Amazon issue text|reportId|campaignId/);
    const target = snapshot.events.find((event) => event.source === "advertising")!;
    const acknowledged = projected(await owner.acknowledge(request("POST", "/api/operations-intelligence/events", { eventId: target.id, status: "acknowledged" })));
    expect(acknowledged.events.find((event) => event.id === target.id)?.status).toBe("acknowledged");
    expect(acknowledged.sources).toEqual(snapshot.sources);
    expect(acknowledged.events).toHaveLength(5);
    expect(acknowledged.events.map((event) => ({ ...event, status: "open" }))).toEqual(snapshot.events);
  });
});
