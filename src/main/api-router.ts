import type {
  ApiRequest,
  ApiResponse,
  ConnectionTestResult,
} from "../shared/contracts";
import type { MarketplaceId } from "../shared/marketplaces";
import type { AdvertisingGateway } from "./amazon/ads-api";
import { CredentialVault } from "./credential-vault";
import { LocalStore } from "./local-store";
import {
  MainWriteGate,
  type MainWriteGatePort,
} from "./write-gate";
import {
  publicSpApiError,
  SpApiError,
} from "./amazon/sp-api-error";
import {
  createProductionSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContextAdapter,
  type SpExecutionContextInvalidationReason,
} from "./amazon/sp-execution-context";
import {
  createRouterRequestContextAdapter,
  type RouterRequestContextAdapter,
} from "./router-request-context";
import {
  StatelessCapabilityRoutes,
  type StatelessCapabilityRoutesPort,
} from "./stateless-capability-routes";
import {
  LocalImageUpload,
  type LocalImageUploadPort,
} from "./local-image-upload";
import {
  SystemHealthRoute,
  type SystemHealthRoutePort,
} from "./system-health-route";
import {
  PlanningCapabilityRoutes,
  type PlanningCapabilityRoutesPort,
} from "./planning-capability-routes";
import {
  ProductMasterRoutes,
  type ProductMasterRoutesPort,
} from "./product-master-routes";
import { SkuCommand } from "./amazon/sku-command";
import {
  SkuCommandRoute,
  type SkuCommandRoutePort,
} from "./sku-command-route";
import { isPlainRecord } from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  createListingPriceMutations,
  type ListingPriceMutationsPort,
} from "./listing-price-mutations";
import {
  createListingImageMutations,
  type ListingImageMutationsPort,
} from "./listing-image-mutations";
import {
  createVariationMoveMutations,
  type VariationMoveMutationsPort,
} from "./variation-move-mutations";
import {
  createBusinessPricingMutations,
  type BusinessPricingMutationsPort,
} from "./business-pricing-mutations";
import {
  createListingContentMutations,
  type ListingContentMutationsPort,
} from "./listing-content-mutations";
import {
  createListingContentBatchMutations,
  type ListingContentBatchMutationsPort,
} from "./listing-content-batch-mutations";
import {
  FbaSalesMetricsRoutes,
  type FbaSalesMetricsRoutesPort,
} from "./fba-sales-metrics-routes";
import {
  createBrandSalesCoordinator,
  type BrandSalesCoordinatorPort,
  type BrandSalesDemoSource,
} from "./brand-sales-coordinator";
import {
  catalogListingsReadAdapterProduction,
  catalogReportsDemoSource,
  getFbaVariationGroupingData,
  aplusContentPageAdapterProduction,
  businessPricingGatewayProduction,
  customerFeedbackPageAdapterProduction,
  isConfiguredForMarketplace,
  getRestockPlan,
  getSalesTrend,
  getFbaSubscriptionAudit,
  getSubscribeAndSaveOffer,
  getVariationFamilyPlanner,
  getOperationsBoardFbaInventory,
  invalidateSpApiCredentialCaches,
  listingImageGatewayProduction,
  listingContentGatewayProduction,
  listingPriceGatewayProduction,
  variationMoveGatewayProduction,
  fbaInboundExternalReadAdapterProduction,
  reportsRuntimeProductionAdapter,
  ordersPageAdapterProduction,
  searchListingsBySku,
  usesDemoMode,
  verifyListingsAccess,
} from "./amazon/sp-api";
import {
  AgedInventoryReads,
  type AgedInventoryReadsPort,
} from "./amazon/aged-inventory-reads";
import { FbaInboundReads } from "./amazon/fba-inbound-reads";
import {
  FbaInboundCoordinator,
  type FbaInboundCoordinatorPort,
  type FbaInboundReadsPort,
} from "./fba-inbound-coordinator";
import {
  ReviewAuditCoordinator,
  type ReviewAuditCandidateSource,
  type ReviewAuditCoordinatorPort,
} from "./review-audit-coordinator";
import {
  ReadOnlyAdvertisingCoordinator,
  type AdvertisingCoordinatorPort,
  type AdvertisingStrategySourceGateway,
} from "./advertising-read-coordinator";
import {
  StandaloneAuditCoordinator,
  type StandaloneAuditCoordinatorPort,
} from "./standalone-audit-coordinator";
import {
  SalesAndTrafficReports,
  type SalesAndTrafficDemoSource,
  type SalesAndTrafficDocumentReader,
} from "./amazon/sales-and-traffic-reports";
import { createSalesAndTrafficDemoSource } from
  "./amazon/sales-and-traffic-demo";
import { createBrandSalesDemoSource } from "./amazon/brand-sales-demo";
import {
  FbaCatalogReports,
  type FbaCatalogReportsDemoSource,
} from "./amazon/fba-catalog-reports";
import type { CatalogListingsReadAdapter } from
  "./amazon/catalog-report-reads";
import {
  getDemoFbaReviewAuditCandidates,
  verifyFbaReviewAuditSeeds,
} from "./amazon/variation-catalog-reads";
import {
  CustomerFeedbackReads,
  type CustomerFeedbackReadsPort,
} from "./amazon/customer-feedback-reads";
import { OrdersReads, type OrdersReadsPort } from "./amazon/orders-reads";
import { ReplenishmentAuditError } from "./amazon/replenishment-audit";
import {
  AplusContentReads,
  type AplusContentReadsPort,
} from "./amazon/a-plus-content-reads";
import { AuditSuiteCatalogResources } from
  "./amazon/audit-suite-resources";
import {
  AuditSuiteCompatibilityCoordinator,
  type AuditSuiteCompatibilityCoordinatorPort,
} from "./audit-suite-compatibility-coordinator";
import {
  AplusAuditCoordinator,
  type AplusAuditCoordinatorPort,
} from "./a-plus-audit-coordinator";
import {
  BusinessPricingAudit,
  type BusinessPricingAuditPort,
} from "./amazon/business-pricing-audit";
import {
  SubscriptionAuditOwner,
  type SubscriptionAuditOwnerPort,
} from "./amazon/subscription-audit-owner";
import {
  UnboundVariationAuditOwner,
  type UnboundVariationAuditOwnerPort,
} from "./amazon/unbound-variation-audit-owner";
import {
  AgedInventoryAudit,
  type AgedInventoryAuditPort,
} from "./amazon/aged-inventory-audit";
import {
  ContentAuditOwner,
  type ContentAuditOwnerPort,
} from "./amazon/content-audit-owner";
import {
  ImageAuditOwner,
  type ImageAuditOwnerPort,
} from "./amazon/image-audit-owner";
import {
  ListingsExport,
  type ListingsExportPort,
} from "./amazon/listings-export";
import {
  ListingsExportRoutes,
  type ListingsExportRoutesPort,
} from "./listings-export-routes";
import type { ReportsAdapter } from "./amazon/reports-runtime";
import { createDemoReportsAdapter } from
  "./amazon/reports-runtime-demo";
import { FixedReportBroker } from "./amazon/report-broker";
import { testRegionConnections } from "./amazon/connection-health";
import { marketplaceByCode, marketplaceById } from "../shared/marketplaces";
import { abortableDelay as waitMilliseconds } from "./abort-utils";
import {
  OperationsBoard,
  type OperationsBoardPort,
} from "./operations-board";
import {
  OperationsBoardFacts,
  type OperationsBoardFactsPort,
} from "./operations-board-facts";

type WriteApproval = (reason: string) => Promise<void>;

function publicRouterError(
  error: Readonly<{
    message: string;
    status: number;
    code: string;
    requestId?: string | null;
    retryAfter?: string | null;
  }>,
  fallback: string,
) {
  return publicSpApiError(new SpApiError(error.message, {
    status: error.status,
    code: error.code,
    requestId: error.requestId ?? null,
    retryAfter: error.retryAfter ?? null,
  }), fallback);
}

function apiError(error: unknown, fallback: string): ApiResponse {
  if (error instanceof SpApiError) {
    return routeError(error, fallback);
  }
  if (error instanceof ReplenishmentAuditError) {
    const status = error.code === "MARKETPLACE_UNSUPPORTED" || error.code === "REQUEST_INVALID"
      ? 422
      : error.code === "PAGINATION_CHANGED" || error.code === "DUPLICATE_SKU"
        ? 409
        : 502;
    const publicError = publicRouterError({
      status,
      code: `REPLENISHMENT_${error.code}`,
      message: error.message,
    }, fallback);
    return json(
      { code: publicError.code, message: publicError.message },
      publicError.status,
    );
  }
  return json({ code: "INTERNAL_ERROR", message: fallback }, 500);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string");
}

function validApiBody(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.kind === "json") return isPlainRecord(value.value);
  if (
    value.kind !== "multipart" ||
    !isStringRecord(value.fields) ||
    !isPlainRecord(value.file)
  ) {
    return false;
  }
  return (
    typeof value.file.name === "string" &&
    typeof value.file.type === "string" &&
    value.file.bytes instanceof Uint8Array
  );
}

export class ApiRouter {
  private readonly vault: CredentialVault;
  private readonly spExecutionContext: RouterRequestContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly priceMutations: ListingPriceMutationsPort;
  private readonly listingImageMutations: ListingImageMutationsPort;
  private readonly listingContentMutations: ListingContentMutationsPort;
  private readonly listingContentBatchMutations:
    ListingContentBatchMutationsPort;
  private readonly variationMoveMutations: VariationMoveMutationsPort;
  private readonly businessPricingMutations: BusinessPricingMutationsPort;
  private readonly ordersReads: OrdersReadsPort;
  private readonly statelessCapabilities: StatelessCapabilityRoutesPort;
  private readonly imageUpload: LocalImageUploadPort;
  private readonly health: SystemHealthRoutePort;
  private readonly planningCapabilities: PlanningCapabilityRoutesPort;
  private readonly productMasterRoutes: ProductMasterRoutesPort;
  private readonly skuCommandRoute: SkuCommandRoutePort;
  private readonly operationsBoard: OperationsBoardPort;
  private readonly operationsBoardFacts: OperationsBoardFactsPort;
  private readonly fbaSalesMetricsRoutes: FbaSalesMetricsRoutesPort;
  private readonly fbaInboundCoordinator: FbaInboundCoordinatorPort;
  private readonly reportBroker: FixedReportBroker;
  private readonly brandSalesCoordinator: BrandSalesCoordinatorPort;
  private readonly businessPricingAuditOwner: BusinessPricingAuditPort;
  private readonly subscriptionAuditOwner: SubscriptionAuditOwnerPort;
  private readonly unboundVariationAuditOwner: UnboundVariationAuditOwnerPort;
  private readonly agedInventoryAuditOwner: AgedInventoryAuditPort;
  private readonly contentAuditOwner: ContentAuditOwnerPort;
  private readonly imageAuditOwner: ImageAuditOwnerPort;
  private readonly listingsExportOwner: ListingsExportPort;
  private readonly listingsExportRoutes: ListingsExportRoutesPort;
  private readonly reviewAuditCoordinator: ReviewAuditCoordinatorPort;
  private readonly advertisingCoordinator: AdvertisingCoordinatorPort;
  private readonly legacyAuditSuiteCompatibility:
    AuditSuiteCompatibilityCoordinatorPort;
  private readonly aPlusAuditCoordinator: AplusAuditCoordinatorPort;
  private readonly standaloneAuditCoordinator: StandaloneAuditCoordinatorPort;
  private contextStateRevision = 0;

  constructor(input: {
    store: LocalStore;
    vault: CredentialVault;
    approveWrite: WriteApproval;
    agedInventoryReads?: AgedInventoryReadsPort;
    salesAndTrafficRead?: SalesAndTrafficDocumentReader;
    salesAndTrafficDemo?: Partial<SalesAndTrafficDemoSource>;
    advertisingStrategySources?: Partial<AdvertisingStrategySourceGateway>;
    advertisingCoordinator?: AdvertisingCoordinatorPort;
    reviewAuditCoordinator?: ReviewAuditCoordinatorPort;
    reviewAuditCandidates?: ReviewAuditCandidateSource;
    customerFeedbackReads?: CustomerFeedbackReadsPort;
    ordersReads?: OrdersReadsPort;
    statelessCapabilities?: StatelessCapabilityRoutesPort;
    imageUpload?: LocalImageUploadPort;
    health?: SystemHealthRoutePort;
    planningCapabilities?: PlanningCapabilityRoutesPort;
    productMasterRoutes?: ProductMasterRoutesPort;
    skuCommandRoute?: SkuCommandRoutePort;
    operationsBoard?: OperationsBoardPort;
    operationsBoardFacts?: OperationsBoardFactsPort;
    fbaSalesMetricsRoutes?: FbaSalesMetricsRoutesPort;
    brandSalesCoordinator?: BrandSalesCoordinatorPort;
    fbaInboundCoordinator?: FbaInboundCoordinatorPort;
    businessPricingAudit?: BusinessPricingAuditPort;
    subscriptionAudit?: SubscriptionAuditOwnerPort;
    unboundVariationAudit?: UnboundVariationAuditOwnerPort;
    agedInventoryAudit?: AgedInventoryAuditPort;
    contentAudit?: ContentAuditOwnerPort;
    imageAudit?: ImageAuditOwnerPort;
    listingsExport?: ListingsExportPort;
    listingsExportRoutes?: ListingsExportRoutesPort;
    advertisingStrategyWait?: typeof waitMilliseconds;
    fbaInboundReads?: Partial<FbaInboundReadsPort>;
    reportsAdapter?: ReportsAdapter;
    demoReportsAdapter?: ReportsAdapter;
    catalogListings?: CatalogListingsReadAdapter;
    catalogDemo?: Partial<FbaCatalogReportsDemoSource>;
    brandSalesDemo?: Partial<BrandSalesDemoSource>;
    catalogPace?: (
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void>;
    catalogNow?: () => Date;
    aplusContentReads?: AplusContentReadsPort;
    aPlusAuditCoordinator?: AplusAuditCoordinatorPort;
    standaloneAuditCoordinator?: StandaloneAuditCoordinatorPort;
    legacyAuditSuiteCompatibility?: AuditSuiteCompatibilityCoordinatorPort;
    advertising?: AdvertisingGateway;
    spExecutionContext?: SpExecutionContextAdapter;
    writeGate?: MainWriteGatePort;
    priceMutations?: ListingPriceMutationsPort;
    listingImageMutations?: ListingImageMutationsPort;
    listingContentMutations?: ListingContentMutationsPort;
    listingContentBatchMutations?: ListingContentBatchMutationsPort;
    variationMoveMutations?: VariationMoveMutationsPort;
    businessPricingMutations?: BusinessPricingMutationsPort;
  }) {
    const store = input.store;
    this.vault = input.vault;
    this.operationsBoard = input.operationsBoard ?? new OperationsBoard({ vault: input.vault });
    const baseSpExecutionContext = input.spExecutionContext
      ?? createProductionSpExecutionContextAdapter({
        getOpaqueAccountScope: (region) => this.vault.getAccountScope(region),
        resolveMode: (marketplaceId) => usesDemoMode(marketplaceId) ? "demo" : "live",
        onContextChanged: (reason) => {
          this.invalidateContextBoundState(reason, true);
        },
      });
    this.spExecutionContext = createRouterRequestContextAdapter(
      baseSpExecutionContext,
    );
    this.writeGate = input.writeGate ?? new MainWriteGate({
      store,
      context: this.spExecutionContext,
      approveWrite: input.approveWrite,
    });
    this.priceMutations = input.priceMutations ?? createListingPriceMutations({
      context: this.spExecutionContext,
      writeGate: this.writeGate,
      gateway: listingPriceGatewayProduction,
    });
    this.operationsBoardFacts = input.operationsBoardFacts ?? new OperationsBoardFacts({
      context: baseSpExecutionContext,
      readPrice: (identity, context) => this.priceMutations.read(identity, context),
      readLiveInventory: (identity, _context, signal) =>
        getOperationsBoardFbaInventory({ ...identity, signal }),
    });
    this.listingImageMutations = input.listingImageMutations ??
      createListingImageMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        gateway: listingImageGatewayProduction,
      });
    this.listingContentMutations = input.listingContentMutations ??
      createListingContentMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        gateway: listingContentGatewayProduction,
      });
    this.listingContentBatchMutations = input.listingContentBatchMutations ??
      createListingContentBatchMutations({
        evidence: store,
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        content: this.listingContentMutations,
      });
    this.variationMoveMutations = input.variationMoveMutations ??
      createVariationMoveMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        gateway: variationMoveGatewayProduction,
      });
    this.businessPricingMutations = input.businessPricingMutations ??
      createBusinessPricingMutations({
        context: this.spExecutionContext,
        writeGate: this.writeGate,
        priceObserver: this.priceMutations,
        gateway: businessPricingGatewayProduction,
    });
    const advertising = input.advertising ?? null;
    const demoReportsAdapter = input.demoReportsAdapter ??
      createDemoReportsAdapter();
    const liveReportsAdapter = input.reportsAdapter ??
      reportsRuntimeProductionAdapter;
    const reportsAdapter: ReportsAdapter = {
      create: (request) => (request.mode === "live"
        ? liveReportsAdapter
        : demoReportsAdapter).create(request),
      status: (request) => (request.mode === "live"
        ? liveReportsAdapter
        : demoReportsAdapter).status(request),
      readDocument: (request) => (request.mode === "live"
        ? liveReportsAdapter
        : demoReportsAdapter).readDocument(request),
    };
    this.reportBroker = new FixedReportBroker({
      store,
      context: this.spExecutionContext,
      reportsAdapter,
      advertising,
    });
    const agedInventoryReads = input.agedInventoryReads ?? new AgedInventoryReads({
      reports: this.reportBroker,
      context: this.spExecutionContext,
    });
    const defaultFbaInboundReads = new FbaInboundReads({
      adapter: fbaInboundExternalReadAdapterProduction,
      reports: this.reportBroker,
      context: this.spExecutionContext,
    });
    const fbaInboundReads: FbaInboundReadsPort = {
      readShipments: (request) => defaultFbaInboundReads.readShipments(request),
      readNoncompliance: (request) =>
        defaultFbaInboundReads.readNoncompliance(request),
      ...input.fbaInboundReads,
    };
    this.fbaInboundCoordinator = input.fbaInboundCoordinator ??
      new FbaInboundCoordinator({
        reads: fbaInboundReads,
        context: this.spExecutionContext,
      });
    const defaultCatalogDemo: FbaCatalogReportsDemoSource = {
      ...catalogReportsDemoSource,
      ...input.catalogDemo,
    };
    const salesAndTraffic = new SalesAndTrafficReports({
      reports: this.reportBroker,
      context: this.spExecutionContext,
      liveReader: input.salesAndTrafficRead,
      demo: {
        ...createSalesAndTrafficDemoSource({
          listings: async ({ marketplaceId, signal }) =>
            (await defaultCatalogDemo.identity({ marketplaceId, signal })).rows,
        }),
        ...input.salesAndTrafficDemo,
      },
    });
    const catalogListings = input.catalogListings ??
      catalogListingsReadAdapterProduction;
    const fbaCatalogReports = new FbaCatalogReports({
      reports: this.reportBroker,
      context: this.spExecutionContext,
      listings: catalogListings,
      demo: defaultCatalogDemo,
      pace: input.catalogPace,
      now: input.catalogNow,
    });
    const auditSuiteResources = new AuditSuiteCatalogResources({
      context: this.spExecutionContext,
      catalog: fbaCatalogReports,
      readGrouping: (request) => getFbaVariationGroupingData(request),
    });
    this.subscriptionAuditOwner = input.subscriptionAudit ??
      new SubscriptionAuditOwner({
        context: this.spExecutionContext,
        readSnapshot: async ({ marketplaceId, months, signal }) =>
          getFbaSubscriptionAudit({ marketplaceId, months, signal }),
      });
    this.unboundVariationAuditOwner = input.unboundVariationAudit ??
      new UnboundVariationAuditOwner({
        context: this.spExecutionContext,
        source: {
          begin: (request) => fbaCatalogReports.begin({
            purpose: "catalog",
            ...request,
          }),
          status: (request) => fbaCatalogReports.status(request),
          read: (request) => fbaCatalogReports.read({
            view: "unbound-variation-audit",
            ...request,
          }),
        },
      });
    this.businessPricingAuditOwner = input.businessPricingAudit ??
      new BusinessPricingAudit({
        context: this.spExecutionContext,
        startReport: (request) => fbaCatalogReports.begin({
          purpose: "business-pricing-audit",
          ...request,
        }),
        statusReport: (request) => fbaCatalogReports.status(request),
        readReport: (request) => fbaCatalogReports.read({
          view: "business-pricing-audit",
          ...request,
        }),
        getStandaloneJob: (request) =>
          this.standaloneAuditCoordinator.getJob(request),
      });
    this.agedInventoryAuditOwner = input.agedInventoryAudit ??
      new AgedInventoryAudit({
        context: this.spExecutionContext,
        beginReport: (request) => agedInventoryReads.begin(request),
        statusReport: (request) => agedInventoryReads.status(request),
        readReport: (request) => agedInventoryReads.read(request),
      });
    this.listingsExportOwner = input.listingsExport ?? new ListingsExport({
      context: this.spExecutionContext,
      startReport: (request) => fbaCatalogReports.begin({
        purpose: "catalog",
        ...request,
      }),
      statusReport: (request) => fbaCatalogReports.status(request),
      readReport: (request) => fbaCatalogReports.read({
        view: "export",
        ...request,
      }),
    });
    this.contentAuditOwner = input.contentAudit ?? new ContentAuditOwner({
      context: this.spExecutionContext,
      readGrouping: (request) => getFbaVariationGroupingData(request),
      evidence: {
        saveContentAuditSnapshotEvidence: (evidence) =>
          store.saveContentAuditSnapshotEvidence(evidence),
      },
    });
    this.imageAuditOwner = input.imageAudit ?? new ImageAuditOwner({
      context: this.spExecutionContext,
      readGrouping: (request) => getFbaVariationGroupingData(request),
    });
    this.listingsExportRoutes = input.listingsExportRoutes ??
      new ListingsExportRoutes({
        listingsExport: this.listingsExportOwner,
        contentAudit: this.contentAuditOwner,
        imageAudit: this.imageAuditOwner,
      });
    this.brandSalesCoordinator = input.brandSalesCoordinator ??
      createBrandSalesCoordinator({
        store,
        reports: this.reportBroker,
        catalog: fbaCatalogReports,
        context: this.spExecutionContext,
        demo: {
          ...createBrandSalesDemoSource({
            listings: ({ marketplaceId, signal }) =>
              defaultCatalogDemo.seeds({ marketplaceId, signal }),
        }),
          ...input.brandSalesDemo,
        },
      });
    this.advertisingCoordinator = input.advertisingCoordinator ??
      new ReadOnlyAdvertisingCoordinator({
        context: this.spExecutionContext,
        advertising,
        reports: this.reportBroker,
        catalog: fbaCatalogReports,
        salesAndTraffic,
        listingsExport: this.listingsExportOwner,
        loadAuditSuiteListings: (context, control) =>
          auditSuiteResources.listings(context, control),
        strategySources: {
          fbaListings: (request) => fbaCatalogReports.read({
            view: "identity",
            ...request,
          }),
          ...input.advertisingStrategySources,
        },
        wait: input.advertisingStrategyWait,
      });
    const reviewAuditCandidates = input.reviewAuditCandidates ?? (async (request) =>
      request.mode === "demo"
        ? getDemoFbaReviewAuditCandidates({
            marketplaceId: request.marketplaceId,
            signal: request.signal,
          })
        : verifyFbaReviewAuditSeeds(catalogListings, {
            marketplaceId: request.marketplaceId,
            seeds: request.seeds,
            signal: request.signal,
          }));
    const customerFeedbackReads = input.customerFeedbackReads ??
      new CustomerFeedbackReads({
        context: this.spExecutionContext,
        live: customerFeedbackPageAdapterProduction,
      });
    this.reviewAuditCoordinator = input.reviewAuditCoordinator ??
      new ReviewAuditCoordinator({
        context: this.spExecutionContext,
        resolveMode: (marketplaceId) =>
          usesDemoMode(marketplaceId) ? "demo" : "live",
        listings: this.listingsExportOwner,
        readCatalogSeeds: (request) => fbaCatalogReports.read({
          view: "seeds",
          ...request,
        }),
        readCandidates: reviewAuditCandidates,
        customerFeedback: customerFeedbackReads,
      });
    this.ordersReads = input.ordersReads ?? new OrdersReads({
      context: this.spExecutionContext,
      live: ordersPageAdapterProduction,
      isConfiguredForMarketplace,
    });
    this.statelessCapabilities = input.statelessCapabilities ??
      new StatelessCapabilityRoutes({
        context: this.spExecutionContext,
        orders: this.ordersReads,
        searchListings: searchListingsBySku,
        readSubscription: getSubscribeAndSaveOffer,
        readVariationFamily: getVariationFamilyPlanner,
      });
    this.imageUpload = input.imageUpload ?? new LocalImageUpload({
      context: this.spExecutionContext,
      vault: this.vault,
    });
    this.health = input.health ?? new SystemHealthRoute({
      getCredentialSummary: () => this.vault.getSummary(),
      usesDemoMode,
    });
    this.planningCapabilities = input.planningCapabilities ??
      new PlanningCapabilityRoutes();
    this.productMasterRoutes = input.productMasterRoutes ??
      new ProductMasterRoutes({
        context: this.spExecutionContext,
        store,
      });
    this.skuCommandRoute = input.skuCommandRoute ?? new SkuCommandRoute({
      command: new SkuCommand({
        context: this.spExecutionContext,
        productMaster: {
          get: (accountScope, marketplaceId, sellerSku) =>
            store.getProductMaster(
              accountScope,
              marketplaceId,
              sellerSku,
            ),
          syncIdentity: (identity) => store.syncProductIdentity(identity),
        },
        reads: {
          price: (identity, context) =>
            this.priceMutations.read(identity, context),
          content: (identity, context) =>
            this.listingContentMutations.readOne(identity, context),
          images: (identity, context) =>
            this.listingImageMutations.read(identity, context),
          subscribeSave: getSubscribeAndSaveOffer,
          restock: getRestockPlan,
        },
      }),
    });
    this.fbaSalesMetricsRoutes = input.fbaSalesMetricsRoutes ??
      new FbaSalesMetricsRoutes({
        context: this.spExecutionContext,
        salesTrend: getSalesTrend,
        replenishment: getRestockPlan,
      });
    const aplusContentReads = input.aplusContentReads ?? new AplusContentReads({
      context: this.spExecutionContext,
      live: aplusContentPageAdapterProduction,
    });
    this.aPlusAuditCoordinator = input.aPlusAuditCoordinator ??
      new AplusAuditCoordinator({
        context: this.spExecutionContext,
        listingsExport: this.listingsExportOwner,
        readGrouping: (request) => getFbaVariationGroupingData(request),
        contentReads: aplusContentReads,
      });
    this.standaloneAuditCoordinator = input.standaloneAuditCoordinator ??
      new StandaloneAuditCoordinator({
        context: this.spExecutionContext,
        subscription: this.subscriptionAuditOwner,
        agedInventory: this.agedInventoryAuditOwner,
        listingsExport: this.listingsExportOwner,
        content: this.contentAuditOwner,
        image: this.imageAuditOwner,
        variation: this.unboundVariationAuditOwner,
        businessPricing: this.businessPricingAuditOwner,
        advertising: this.advertisingCoordinator,
      });
    this.legacyAuditSuiteCompatibility =
      input.legacyAuditSuiteCompatibility ??
        new AuditSuiteCompatibilityCoordinator({
          context: this.spExecutionContext,
          resources: auditSuiteResources,
          content: this.contentAuditOwner,
          image: this.imageAuditOwner,
          aplus: this.aPlusAuditCoordinator,
          variation: this.unboundVariationAuditOwner,
          subscription: this.subscriptionAuditOwner,
          businessPricing: this.businessPricingAuditOwner,
          advertising: this.advertisingCoordinator,
        });
  }

  private clearContextBoundState(): void {
    this.contextStateRevision += 1;
    this.reportBroker.clear();
    this.advertisingCoordinator.clear();
    this.brandSalesCoordinator.clear();
    this.businessPricingAuditOwner.clear();
    this.subscriptionAuditOwner.clear();
    this.unboundVariationAuditOwner.clear();
    this.agedInventoryAuditOwner.clear();
    this.contentAuditOwner.clear();
    this.imageAuditOwner.clear();
    this.reviewAuditCoordinator.clear();
    this.aPlusAuditCoordinator.clear();
    this.listingsExportOwner.clear();
    this.standaloneAuditCoordinator.clear();
    this.writeGate.clearEphemeral();
    this.listingContentBatchMutations.clear();
    this.fbaInboundCoordinator.clear();
    this.legacyAuditSuiteCompatibility.clear();
    // The long-lived Customer Feedback production adapter intentionally keeps
    // its pacing slot. A context change must not bypass the App-session-wide
    // one-request-per-second boundary.
  }

  private invalidateContextBoundState(
    reason: SpExecutionContextInvalidationReason,
    contextAlreadyInvalidated: boolean,
  ): void {
    if (!contextAlreadyInvalidated) this.spExecutionContext.invalidate(reason);
    invalidateSpApiCredentialCaches({ preserveRateLimitPacing: true });
    this.clearContextBoundState();
  }

  invalidateContext(reason: SpExecutionContextInvalidationReason): void {
    this.invalidateContextBoundState(reason, false);
  }

  cancel(requestId: string): void {
    this.operationsBoardFacts.cancel(requestId);
  }

  dispose(): void {
    this.clearContextBoundState();
  }

  private assertContextStateRevision(expected: number): void {
    if (expected === this.contextStateRevision) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    if (!this.validEnvelope(request)) {
      return invalid("App 內部請求格式無效。", 400, "INVALID_REQUEST");
    }
    const operationStateRevision = this.contextStateRevision;
    try {
      return await this.spExecutionContext.runOperation(async () => {
        let response: ApiResponse;
        try {
          response = await this.route(request);
        } catch (error) {
          try {
            await this.spExecutionContext.assertOperationCurrent();
          } catch (contextError) {
            if (
              contextError instanceof SpExecutionContextError &&
              this.contextStateRevision === operationStateRevision
            ) {
              this.clearContextBoundState();
            }
          }
          throw error;
        }
        if (response.status < 400) {
          await this.spExecutionContext.assertOperationCurrent();
        }
        return response;
      });
    } catch (error) {
      if (
        error instanceof SpExecutionContextError &&
        this.contextStateRevision === operationStateRevision
      ) {
        this.clearContextBoundState();
      }
      return apiError(error, "執行本機 Amazon 操作時發生未預期的錯誤。");
    }
  }

  async testConnections(
    marketplaceId?: MarketplaceId,
  ): Promise<ConnectionTestResult> {
    const operationStateRevision = this.contextStateRevision;
    const summary = await this.vault.getSummary();
    this.assertContextStateRevision(operationStateRevision);
    const representatives: Record<"na" | "fe" | "eu", MarketplaceId> = {
      na: marketplaceByCode("US").id,
      fe: marketplaceByCode("JP").id,
      eu: marketplaceByCode("UK").id,
    };
    const result: ConnectionTestResult = {
      ok: false,
      testedAt: new Date().toISOString(),
      marketplaceId: marketplaceId ?? null,
      regions: {},
    };
    const selectedMarketplace = marketplaceId
      ? marketplaceById(marketplaceId)
      : undefined;
    if (marketplaceId && !selectedMarketplace) {
      throw new TypeError("Amazon 站點無效。");
    }
    const targets = selectedMarketplace
      ? [{ region: selectedMarketplace.region, marketplaceId: selectedMarketplace.id }]
      : (["na", "fe", "eu"] as const).map((region) => ({
          region,
          marketplaceId: representatives[region],
        }));
    for (const target of targets) {
      this.assertContextStateRevision(operationStateRevision);
      const { region } = target;
      if (!summary.regions[region].configured) continue;
      result.regions[region] = await this.spExecutionContext.runOperation(async () => {
        this.assertContextStateRevision(operationStateRevision);
        const context = await this.spExecutionContext.capture(target.marketplaceId);
        const regionResult = await testRegionConnections({
          orders: () => this.ordersReads.read({
            intent: "connection-probe",
            marketplaceId: target.marketplaceId,
          }),
          listings: () => verifyListingsAccess(target.marketplaceId),
        });
        await this.spExecutionContext.assertCurrent(context);
        this.assertContextStateRevision(operationStateRevision);
        return regionResult;
      });
      this.assertContextStateRevision(operationStateRevision);
    }
    const tested = Object.values(result.regions);
    result.ok = tested.length > 0 && tested.every((item) => item?.ok);
    this.assertContextStateRevision(operationStateRevision);
    return result;
  }

  private validEnvelope(request: ApiRequest): boolean {
    return Boolean(
      request &&
        isPlainRecord(request) &&
        typeof request.requestId === "string" &&
        /^[A-Za-z0-9-]{8,100}$/.test(request.requestId) &&
        ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        typeof request.path === "string" &&
        request.path.startsWith("/api/") &&
        request.path.length <= 200 &&
        isStringRecord(request.query) &&
        isStringRecord(request.headers) &&
        (request.body === undefined || validApiBody(request.body)),
    );
  }

  private async route(request: ApiRequest): Promise<ApiResponse> {
    const key = `${request.method} ${request.path}`;
    switch (key) {
      case "GET /api/sp-api/orders":
        return this.statelessCapabilities.orders(request);
      case "GET /api/sp-api/sales-trend":
        return this.fbaSalesMetricsRoutes.salesTrend(request);
      case "POST /api/sp-api/brand-sales":
        return this.brandSalesCoordinator.start(request);
      case "GET /api/sp-api/brand-sales":
        return this.brandSalesCoordinator.observe(request);
      case "POST /api/sp-api/inbound-shipments":
        return this.fbaInboundCoordinator.start(request);
      case "GET /api/sp-api/inbound-shipments":
        return this.fbaInboundCoordinator.status(request);
      case "GET /api/sp-api/listings":
        return this.priceMutations.handle({
          family: "standard-price",
          operation: "read",
          request,
        });
      case "POST /api/sp-api/listings":
        return this.priceMutations.handle({
          family: "standard-price",
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/listings":
        return this.priceMutations.handle({
          family: "standard-price",
          operation: "commit",
          request,
        });
      case "POST /api/sp-api/business-pricing-audit":
        return this.businessPricingAuditOwner.start(request);
      case "GET /api/sp-api/business-pricing-audit":
        return this.businessPricingAuditOwner.statusOrData(request);
      case "GET /api/sp-api/business-pricing-audit/export":
        return this.businessPricingAuditOwner.download(request);
      case "GET /api/sp-api/business-pricing":
        return this.businessPricingMutations.handle({
          operation: "read",
          request,
        });
      case "POST /api/sp-api/business-pricing":
        return this.businessPricingMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/business-pricing":
        return this.businessPricingMutations.handle({
          operation: "commit",
          request,
        });
      case "POST /api/sp-api/listings/batch":
        return this.statelessCapabilities.batchListings(request);
      case "GET /api/sp-api/listing-content":
        return this.listingContentMutations.handle({
          operation: "read",
          request,
        });
      case "POST /api/sp-api/listing-content":
        return this.listingContentMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/listing-content":
        return this.listingContentMutations.handle({
          operation: "commit",
          request,
        });
      case "POST /api/sp-api/listing-content/import":
        return this.listingContentBatchMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/listing-content/import":
        return this.listingContentBatchMutations.handle({
          operation: "commit",
          request,
        });
      case "GET /api/sp-api/listing-images":
        return this.listingImageMutations.handle({
          operation: "read",
          request,
        });
      case "POST /api/sp-api/listing-images":
        return this.listingImageMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/listing-images":
        return this.listingImageMutations.handle({
          operation: "commit",
          request,
        });
      case "POST /api/sp-api/sale-price":
        return this.priceMutations.handle({
          family: "sale-price",
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/sale-price":
        return this.priceMutations.handle({
          family: "sale-price",
          operation: "commit",
          request,
        });
      case "GET /api/sp-api/subscribe-save":
        return this.statelessCapabilities.subscribeSave(request);
      case "GET /api/sp-api/subscription-audit":
        return this.subscriptionAuditOwner.read(request);
      case "GET /api/sp-api/subscription-audit/export":
        return this.subscriptionAuditOwner.download(request);
      case "GET /api/sp-api/accounting/capabilities":
        return this.planningCapabilities.accountingCapabilities(request);
      case "POST /api/sp-api/accounting/access-plan":
        return this.planningCapabilities.accountingAccessPlan(request);
      case "GET /api/sp-api/report-library":
        return this.planningCapabilities.reportLibrary(request);
      case "POST /api/sp-api/report-library/access-plan":
        return this.planningCapabilities.reportLibraryAccessPlan(request);
      case "POST /api/sp-api/review-audit":
        return this.reviewAuditCoordinator.start(request);
      case "GET /api/sp-api/review-audit":
        return this.reviewAuditCoordinator.observe(request);
      case "GET /api/sp-api/review-audit/export":
        return this.reviewAuditCoordinator.download(request);
      case "GET /api/sp-api/replenishment-plan":
        return this.fbaSalesMetricsRoutes.replenishment(request);
      case "POST /api/sp-api/aged-inventory":
        return this.agedInventoryAuditOwner.start(request);
      case "GET /api/sp-api/aged-inventory":
        return this.agedInventoryAuditOwner.statusDataOrDownload(request);
      case "GET /api/sp-api/variation-family":
        return this.statelessCapabilities.variationFamily(request);
      case "POST /api/sp-api/variation-audit":
        return this.unboundVariationAuditOwner.start(request);
      case "GET /api/sp-api/variation-audit":
        return this.unboundVariationAuditOwner.statusDataOrDownload(request);
      case "GET /api/sp-api/variation-move":
        return this.variationMoveMutations.handle({
          operation: "prepare",
          request,
        });
      case "POST /api/sp-api/variation-move":
        return this.variationMoveMutations.handle({
          operation: "preview",
          request,
        });
      case "PATCH /api/sp-api/variation-move":
        return this.variationMoveMutations.handle({
          operation: "commit",
          request,
        });
      case "GET /api/sp-api/sku-command":
        return this.skuCommandRoute.skuCommand(request);
      case "GET /api/operations-board":
        return json(await this.operationsBoard.read());
      case "POST /api/sp-api/operations-board-facts":
        return this.operationsBoardFacts.handle(request);
      case "GET /api/product-master":
        return this.productMasterRoutes.getProductMaster(request);
      case "PUT /api/product-master":
        return this.productMasterRoutes.putProductMaster(request);
      case "POST /api/uploads/listing-images":
        return this.imageUpload.uploadImage(request);
      case "POST /api/sp-api/listing-content/export":
        return this.listingsExportRoutes.start(request);
      case "GET /api/sp-api/listing-content/export":
        return this.listingsExportRoutes.observe(request);
      case "GET /api/system/health":
        return this.health.systemHealth(request);
      case "GET /api/amazon-ads/status":
        return this.advertisingCoordinator.status(request);
      case "GET /api/amazon-ads/coverage":
        return this.advertisingCoordinator.coverage(request);
      case "POST /api/amazon-ads/strategy":
        return this.advertisingCoordinator.startStrategy(request);
      case "GET /api/amazon-ads/strategy":
        return this.advertisingCoordinator.observeStrategy(request);
      case "POST /api/sp-api/a-plus-audit":
        return this.aPlusAuditCoordinator.start(request);
      case "GET /api/sp-api/a-plus-audit":
        return this.aPlusAuditCoordinator.observe(request);
      case "POST /api/sp-api/audit-suite":
        return this.legacyAuditSuiteCompatibility.start(request);
      case "GET /api/sp-api/audit-suite":
        return this.legacyAuditSuiteCompatibility.observe(request);
      case "GET /api/sp-api/audit-suite/export":
        return this.legacyAuditSuiteCompatibility.download(request);
      case "POST /api/sp-api/standalone-audit":
        return this.standaloneAuditCoordinator.start(request);
      case "GET /api/sp-api/standalone-audit":
        return this.standaloneAuditCoordinator.observe(request);
      default:
        return invalid("此 App 版本不支援這個操作。", 404, "NOT_FOUND");
    }
  }

}
