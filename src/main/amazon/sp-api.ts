import { MARKETPLACES } from "./sp-marketplaces";
import {
  createFbaSalesTrend,
} from "./fba-sales-trend";
import {
  createRestockPlanPort,
} from "./restock-plan";
import { createSubscriptionReads } from "./subscription-reads";
import { createFbaInventoryReplenishmentProductionAdapter } from "./fba-inventory-replenishment-production";
import { readReplenishmentInventoryInputs } from "./fba-inventory-replenishment";
import type { MarketplaceId } from "../../shared/marketplaces";
import { createFbaInboundReadsProductionAdapter } from "./fba-inbound-reads-production";
import { createReportsRuntimeProductionAdapter } from "./reports-runtime-production";
import type { ReportsAdapter } from "./reports-runtime";
import { createAplusContentReadProductionAdapter } from
  "./a-plus-content-reads-production";
import { createCustomerFeedbackReadProductionAdapter } from
  "./customer-feedback-reads-production";
import { createOrdersReadProductionAdapter } from
  "./orders-reads-production";
import { createListingsReadProductionAdapter } from "./listings-reads-production";
import {
  createListingItemReads,
} from "./listing-item-reads";
import {
  type CatalogListingsReadAdapter,
} from "./catalog-report-reads";
import {
  readFbaVariationGroupingData as readLiveFbaVariationGroupingData,
  readVariationFamily,
  resolveVariationSellerSkuByAsin,
} from "./variation-catalog-reads";
import { createSpCredentialRuntime } from "./sp-credential-runtime";
import { createListingsWriteProduction } from
  "./listings-write-production";
import { createListingPriceGatewayProduction } from
  "./listing-price-gateway-production";
import { createBusinessPricingCapabilities } from
  "./business-pricing-capabilities";
import { createBusinessPricingGatewayProduction } from
  "./business-pricing-gateway-production";
import { createVariationMoveGatewayProduction } from
  "./variation-move-gateway-production";
import { createListingImageGatewayProduction } from
  "./listing-image-gateway-production";
import { createListingContentCapabilities } from
  "./listing-content-capabilities";
import { createListingContentReadProduction } from
  "./listing-content-read-production";
import { createListingContentGatewayProduction } from
  "./listing-content-gateway-production";
import { createVariationDemoRuntime } from "./variation-demo-runtime";
import { createVariationQueryRuntime } from "./variation-query-runtime";
import { createVariationGroupingRuntime } from
  "./variation-grouping-runtime";
import { createCatalogReportsDemoSource } from
  "./catalog-reports-demo-source";

const credentialRuntime = createSpCredentialRuntime();

export const getSalesTrend = createFbaSalesTrend({
  usesDemoMode: credentialRuntime.usesDemoMode,
  isConfiguredForMarketplace: credentialRuntime.isConfiguredForMarketplace,
  marketplaceLabel: (marketplaceId) => MARKETPLACES[marketplaceId].label,
  getAccessToken: credentialRuntime.requestAccessToken,
  invalidateAccessToken: credentialRuntime.invalidateAccessToken,
});

export function invalidateSpApiCredentialCaches(
  options: Readonly<{ preserveRateLimitPacing?: boolean }> = {},
): void {
  credentialRuntime.clearCredentialCaches();
  if (!options.preserveRateLimitPacing) {
    aplusContentPageAdapterProduction.clearPacing();
  }
  listingContentCapabilities.clear();
  businessPricingCapabilities.clear();
  listingPriceGatewayRuntime.clear();
  businessPricingGatewayRuntime.clear();
  listingContentGatewayRuntime.clear();
  listingImageGatewayRuntime.clear();
}

export const isConfiguredForMarketplace =
  credentialRuntime.isConfiguredForMarketplace;
export const usesDemoMode = credentialRuntime.usesDemoMode;

const listingsReadAdapter = createListingsReadProductionAdapter({
  getAccessToken: credentialRuntime.requestAccessToken,
  invalidateAccessToken: credentialRuntime.invalidateAccessToken,
  getSellerId: (region) => credentialRuntime.getSellerId(region) ?? null,
});

const listingItemReads = createListingItemReads({
  listings: listingsReadAdapter,
  usesDemoMode: credentialRuntime.usesDemoMode,
});
const {
  fetchLiveListingBatch,
  fetchLiveListingPrice,
} = listingItemReads;

/**
 * Verify the connection path that actually binds Seller ID and Product
 * Listing permissions. An Orders-only probe cannot prove this capability.
 */
export const verifyListingsAccess = listingItemReads.verifyListingsAccess;

const listingContentCapabilities = createListingContentCapabilities({
  listingsReadAdapter,
  getCredentialGeneration: credentialRuntime.credentialGeneration,
  getSellerId: (region) => credentialRuntime.getSellerId(region) ?? null,
});

const listingContentReadProduction = createListingContentReadProduction({
  listingItems: listingItemReads,
  contentCapabilities: listingContentCapabilities,
});

const businessPricingCapabilities = createBusinessPricingCapabilities({
  listingsReads: listingsReadAdapter,
  credentialGeneration: credentialRuntime.credentialGeneration,
  sellerId: (region) => credentialRuntime.getSellerId(region) ?? null,
  marketplace: (marketplaceId) => {
    const marketplace = MARKETPLACES[marketplaceId];
    return {
      label: marketplace.label,
      region: marketplace.region,
      currencyCode: marketplace.currency,
    };
  },
});

const listingsWriteProduction = createListingsWriteProduction({
  getAccessToken: credentialRuntime.requestAccessToken,
  invalidateAccessToken: credentialRuntime.invalidateAccessToken,
  getSellerId: (region) => credentialRuntime.getSellerId(region) ?? null,
});

const listingPriceGatewayRuntime = createListingPriceGatewayProduction({
  resolveMode: (marketplaceId) =>
    credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  readLive: (input) =>
    fetchLiveListingPrice(input.marketplaceId, input.sellerSku),
  write: listingsWriteProduction,
});

export const listingPriceGatewayProduction =
  listingPriceGatewayRuntime.gateway;

const variationDemoRuntime = createVariationDemoRuntime({
  readDemoListingPrice: listingPriceGatewayRuntime.readDemo,
});

const variationQueryRuntime = createVariationQueryRuntime({
  resolveMode: (marketplaceId) =>
    credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  demo: variationDemoRuntime,
  live: {
    readFamily: (input) => readVariationFamily(listingsReadAdapter, input),
    resolveSellerSkuByAsin: (input) =>
      resolveVariationSellerSkuByAsin(listingsReadAdapter, input),
    fetchListingBatch: (marketplaceId, sellerSkus) =>
      fetchLiveListingBatch(marketplaceId, sellerSkus),
  },
  readDemoListingPrice: listingPriceGatewayRuntime.readDemo,
});

export const getVariationFamilyPlanner = variationQueryRuntime.getFamily;
export const searchListingsBySku = variationQueryRuntime.searchBySku;

const variationGroupingRuntime = createVariationGroupingRuntime({
  resolveMode: (marketplaceId) =>
    credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  demo: variationDemoRuntime,
  readLive: (input) =>
    readLiveFbaVariationGroupingData(listingsReadAdapter, input),
});

export const getFbaVariationGroupingData = variationGroupingRuntime.read;

const listingContentGatewayRuntime = createListingContentGatewayProduction({
  contentReads: listingContentReadProduction,
  readDemoListing: listingPriceGatewayRuntime.readDemo,
  resolveMode: (marketplaceId) =>
    credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  credentialGeneration: credentialRuntime.credentialGeneration,
  write: listingsWriteProduction,
});

export const listingContentGatewayProduction =
  listingContentGatewayRuntime.gateway;

const businessPricingGatewayRuntime =
  createBusinessPricingGatewayProduction({
    listingItems: listingItemReads,
    capabilities: businessPricingCapabilities,
    readDemoPrice: listingPriceGatewayRuntime.readDemo,
    resolveMode: (marketplaceId) =>
      credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
    credentialGeneration: credentialRuntime.credentialGeneration,
    write: listingsWriteProduction,
  });

export const businessPricingGatewayProduction =
  businessPricingGatewayRuntime.gateway;

const listingImageGatewayRuntime = createListingImageGatewayProduction({
  contentReads: listingContentReadProduction,
  readDemoContent: listingContentGatewayRuntime.readDemo,
  resolveMode: (marketplaceId) =>
    credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  credentialGeneration: credentialRuntime.credentialGeneration,
  write: listingsWriteProduction,
});

export const listingImageGatewayProduction =
  listingImageGatewayRuntime.gateway;

export const catalogReportsDemoSource = createCatalogReportsDemoSource({
  marketplaceDisplayName: (marketplaceId) => MARKETPLACES[marketplaceId].name,
  readDemoContent: listingContentGatewayRuntime.readDemo,
  readDemoBusinessPricing: businessPricingGatewayRuntime.readDemo,
  variationDemo: variationDemoRuntime,
});

export const catalogListingsReadAdapterProduction:
  CatalogListingsReadAdapter = listingsReadAdapter;

const fbaInventoryReplenishmentAdapter =
  createFbaInventoryReplenishmentProductionAdapter({
    getAccessToken: credentialRuntime.requestAccessToken,
    invalidateAccessToken: credentialRuntime.invalidateAccessToken,
  });

export const getOperationsBoardFbaInventory = async (input: Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
  signal?: AbortSignal;
}>): Promise<number> => (await readReplenishmentInventoryInputs(input, {
    adapter: fbaInventoryReplenishmentAdapter,
  })).inventory.fulfillable;

const subscriptionReads = createSubscriptionReads({
  resolveMode: (marketplaceId) =>
    credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  inventoryAdapter: fbaInventoryReplenishmentAdapter,
  readDemoListingPrice: (marketplaceId, sellerSku) =>
    listingPriceGatewayRuntime.readDemo({ marketplaceId, sellerSku }),
});

export const getSubscribeAndSaveOffer =
  subscriptionReads.getSubscribeAndSaveOffer;
export const getFbaSubscriptionAudit =
  subscriptionReads.getFbaSubscriptionAudit;

const restockPlanPort = createRestockPlanPort({
  resolveMode: (marketplaceId) =>
    credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  readDemoListingPrice: (marketplaceId, sellerSku) =>
    listingPriceGatewayRuntime.readDemo({ marketplaceId, sellerSku }),
  readLiveListingPrice: fetchLiveListingPrice,
  inventoryAdapter: fbaInventoryReplenishmentAdapter,
  getAccessToken: credentialRuntime.requestAccessToken,
  invalidateAccessToken: credentialRuntime.invalidateAccessToken,
  isSkillConnected: credentialRuntime.replenishmentSkillConnected,
});

export const getRestockPlan = restockPlanPort.get;

export const fbaInboundExternalReadAdapterProduction =
  createFbaInboundReadsProductionAdapter({
    getAccessToken: credentialRuntime.requestAccessToken,
    invalidateAccessToken: credentialRuntime.invalidateAccessToken,
  });

export const reportsRuntimeProductionAdapter: ReportsAdapter =
  createReportsRuntimeProductionAdapter({
    getAccessToken: credentialRuntime.requestAccessToken,
    invalidateAccessToken: credentialRuntime.invalidateAccessToken,
  });

export const aplusContentPageAdapterProduction =
  createAplusContentReadProductionAdapter({
    getAccessToken: credentialRuntime.requestAccessToken,
    invalidateAccessToken: credentialRuntime.invalidateAccessToken,
    resolveMode: (marketplaceId) =>
      credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  });

/** One long-lived adapter preserves the global Customer Feedback quota fence. */
export const customerFeedbackPageAdapterProduction =
  createCustomerFeedbackReadProductionAdapter({
    getAccessToken: credentialRuntime.requestAccessToken,
    invalidateAccessToken: credentialRuntime.invalidateAccessToken,
    resolveMode: (marketplaceId) =>
      credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  });

export const ordersPageAdapterProduction =
  createOrdersReadProductionAdapter({
    getAccessToken: credentialRuntime.requestAccessToken,
    invalidateAccessToken: credentialRuntime.invalidateAccessToken,
    resolveMode: (marketplaceId) =>
      credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
  });

export const variationMoveGatewayProduction =
  createVariationMoveGatewayProduction({
    listings: listingsReadAdapter,
    resolveMode: (marketplaceId) =>
      credentialRuntime.usesDemoMode(marketplaceId) ? "demo" : "live",
    credentialGeneration: credentialRuntime.credentialGeneration,
    readDemoFamily: variationDemoRuntime.readFamily,
    write: listingsWriteProduction,
  });
