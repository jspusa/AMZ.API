import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import {
  buildBrandSalesSnapshot,
  type BrandSalesSnapshot,
} from "../src/main/amazon/brand-sales";
import type { DurableReportGatewayStatus } from "../src/main/amazon/report-lifecycle";
import type { MarketplaceId } from "../src/shared/marketplaces";
import {
  reportsAdapterIdentity,
  type ReportsAdapter,
} from "../src/main/amazon/reports-runtime";
import type { CredentialVault } from "../src/main/credential-vault";
import {
  createScriptedSpExecutionContextAdapter,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import { planFbaShipmentSalesWindow } from
  "../src/main/amazon/revenue-report-windows";
import {
  LocalStore,
  sharedFbaShipmentSalesOptionsKey,
} from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const ACCOUNT_SCOPE = "account-scope-brand-dedupe";
const previousMode = process.env.SP_API_MODE;
const previousLiveEnvironment = {
  clientId: process.env.SP_API_LWA_CLIENT_ID,
  clientSecret: process.env.SP_API_LWA_CLIENT_SECRET,
  refreshToken: process.env.SP_API_REFRESH_TOKEN_NA,
};

function request(input: {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: input.method,
    path: input.path,
    query: input.query ?? {},
    headers: {},
    body: input.body ? { kind: "json", value: input.body } : undefined,
  };
}

function body(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json" || !response.body.value ||
      typeof response.body.value !== "object" || Array.isArray(response.body.value)) {
    throw new Error("Expected JSON object response");
  }
  return response.body.value as Record<string, unknown>;
}

async function store(): Promise<LocalStore> {
  const directory = await mkdtemp(join(tmpdir(), "brand-sales-dedupe-"));
  const value = new LocalStore(join(directory, "data.json"));
  await value.initialize();
  return value;
}

async function legacyWindowStore(
  status: "IN_QUEUE" | "DONE" | "CREATION_UNKNOWN",
): Promise<LocalStore> {
  const directory = await mkdtemp(join(tmpdir(), "brand-sales-legacy-window-"));
  const filePath = join(directory, "data.json");
  const createdAt = new Date("2026-08-09T00:00:00.000Z").getTime();
  const leg = (name: "listing" | "shipment") => ({
    reportId: `${name}-legacy-report`,
    documentId: status === "DONE" ? `${name}-legacy-document` : null,
    status,
    createdAt,
    terminal: status === "CREATION_UNKNOWN" ? "CREATION_UNKNOWN" : null,
    terminalAt: status === "CREATION_UNKNOWN" ? createdAt + 1 : null,
  });
  const key = `${ACCOUNT_SCOPE}:${MARKETPLACE_ID}:2026-08-01:2026-08-07`;
  await writeFile(filePath, JSON.stringify({
    version: 2,
    profiles: {},
    ledger: {},
    brandSalesJobs: {
      [key]: {
        jobId: `legacy-window-${status.toLowerCase()}`,
        accountScope: ACCOUNT_SCOPE,
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        mode: "demo",
        listing: leg("listing"),
        shipment: leg("shipment"),
        createdAt,
        updatedAt: createdAt + 2,
        expiresAt: createdAt + 60 * 60 * 1_000,
      },
    },
    sharedAllListingsReports: {},
  }));
  const value = new LocalStore(filePath);
  await value.initialize();
  return value;
}

type ShipmentStatus = DurableReportGatewayStatus & {
  dataStartTime: string;
  dataEndTime: string;
};

type GatewayOverrides = {
  spExecutionContext?: SpExecutionContextAdapter;
  startListing?(input: {
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }): Promise<DurableReportGatewayStatus>;
  getListingStatus?(input: {
    marketplaceId: MarketplaceId;
    reportId: string;
    signal?: AbortSignal;
  }): Promise<DurableReportGatewayStatus>;
  startShipment?(input: {
    marketplaceId: MarketplaceId;
    startDate: string;
    endDate: string;
    dataStartTime: string;
    dataEndTime: string;
    windowCreatedAt: number;
    signal?: AbortSignal;
  }): Promise<ShipmentStatus>;
  getShipmentStatus?(input: {
    marketplaceId: MarketplaceId;
    reportId: string;
    startDate: string;
    endDate: string;
    dataStartTime: string;
    dataEndTime: string;
    windowCreatedAt: number;
    signal?: AbortSignal;
  }): Promise<ShipmentStatus>;
  getDataFromDocuments?(input: {
    marketplaceId: MarketplaceId;
    mode: "demo";
    startDate: string;
    endDate: string;
    shipmentDataStartTime: string;
    shipmentDataEndTime: string;
    windowCreatedAt: number;
    listingDocument: string;
    shipmentDocument: string;
    signal?: AbortSignal;
  }): Promise<BrandSalesSnapshot>;
};

function liveReportsAdapter(overrides: GatewayOverrides): ReportsAdapter {
  return {
    async create(request) {
      const result = request.intent === "all-listings"
        ? await overrides.startListing?.({
            marketplaceId: request.marketplaceId,
            signal: request.signal,
          })
        : request.intent === "fba-shipment-sales"
          ? await overrides.startShipment?.({
              marketplaceId: request.marketplaceId,
              startDate: request.startDate,
              endDate: request.endDate,
              dataStartTime: request.dataStartTime,
              dataEndTime: request.dataEndTime,
              windowCreatedAt: request.windowCreatedAt,
              signal: request.signal,
            })
          : null;
      if (!result) throw new Error(`Unexpected live Reports intent: ${request.intent}`);
      const identity = reportsAdapterIdentity(request, result.mode);
      return {
        ...result,
        identity: request.intent === "fba-shipment-sales"
          ? {
              ...identity,
              dataStartTime: "dataStartTime" in result ? String(result.dataStartTime) : "",
              dataEndTime: "dataEndTime" in result ? String(result.dataEndTime) : "",
            }
          : identity,
      };
    },
    async status(request) {
      const result = request.intent === "all-listings"
        ? await overrides.getListingStatus?.({
            marketplaceId: request.marketplaceId,
            reportId: request.reportId,
            signal: request.signal,
          })
        : request.intent === "fba-shipment-sales"
          ? await overrides.getShipmentStatus?.({
              marketplaceId: request.marketplaceId,
              reportId: request.reportId,
              startDate: request.startDate,
              endDate: request.endDate,
              dataStartTime: request.dataStartTime,
              dataEndTime: request.dataEndTime,
              windowCreatedAt: request.windowCreatedAt,
              signal: request.signal,
            })
          : null;
      if (!result) throw new Error(`Unexpected live Reports status: ${request.intent}`);
      const identity = reportsAdapterIdentity(request, result.mode);
      return {
        ...result,
        identity: request.intent === "fba-shipment-sales"
          ? {
              ...identity,
              dataStartTime: "dataStartTime" in result ? String(result.dataStartTime) : "",
              dataEndTime: "dataEndTime" in result ? String(result.dataEndTime) : "",
            }
          : identity,
      };
    },
    async readDocument(request) {
      throw new Error(`Unexpected live Reports document: ${request.intent}`);
    },
  };
}

function router(localStore: LocalStore, overrides: GatewayOverrides = {}): ApiRouter {
  return new ApiRouter({
    store: localStore,
    vault: {
      getAccountScope: async () => ACCOUNT_SCOPE,
    } as unknown as CredentialVault,
    approveWrite: async () => undefined,
    spExecutionContext: overrides.spExecutionContext,
    demoReportsAdapter: liveReportsAdapter(overrides),
    ...(overrides.getDataFromDocuments
      ? {
          brandSalesDemo: {
            read: (window) => overrides.getDataFromDocuments!({
              marketplaceId: window.marketplaceId,
              mode: "demo",
              startDate: window.startDate,
              endDate: window.endDate,
              shipmentDataStartTime: window.dataStartTime,
              shipmentDataEndTime: window.dataEndTime,
              windowCreatedAt: window.windowCreatedAt,
              listingDocument: "",
              shipmentDocument: "",
              signal: window.signal,
            }),
          },
        }
      : {}),
    reportsAdapter: liveReportsAdapter(overrides),
  });
}

function brandStart(
  app: ApiRouter,
  input: { startDate?: string; endDate?: string; retry?: true } = {},
): Promise<ApiResponse> {
  return app.handle(request({
    method: "POST",
    path: "/api/sp-api/brand-sales",
    body: {
      marketplaceId: MARKETPLACE_ID,
      startDate: input.startDate ?? "2026-08-01",
      endDate: input.endDate ?? "2026-08-07",
      ...(input.retry ? { retry: true } : {}),
    },
  }));
}

function queuedListing(index: number) {
  return {
    mode: "demo" as const,
    ready: false,
    reportId: `listing-report-${index}`,
    documentId: null,
    status: "IN_QUEUE" as const,
    notice: "queued",
  };
}

function queuedShipment(index: number) {
  return {
    mode: "demo" as const,
    ready: false,
    reportId: `shipment-report-${index}`,
    documentId: null,
    status: "IN_QUEUE" as const,
    dataStartTime: "2026-08-01T00:00:00-07:00",
    dataEndTime: "2026-08-08T00:00:00-07:00",
    notice: "queued",
  };
}

function demoBrandSnapshot(input: Readonly<{
  marketplaceId: MarketplaceId;
  startDate: string;
  endDate: string;
  shipmentDataEndTime: string;
}>): BrandSalesSnapshot {
  return buildBrandSalesSnapshot({
    mode: "demo",
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
    currencyCode: "USD",
    listings: [],
    sales: [],
    dataThrough: input.shipmentDataEndTime,
    rangeFreshness: "complete-days",
    fetchedAt: "2026-08-09T00:00:00.000Z",
  });
}

describe("durable brand-sales report dedupe", () => {
  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
    for (const [key, value] of [
      ["SP_API_LWA_CLIENT_ID", previousLiveEnvironment.clientId],
      ["SP_API_LWA_CLIENT_SECRET", previousLiveEnvironment.clientSecret],
      ["SP_API_REFRESH_TOKEN_NA", previousLiveEnvironment.refreshToken],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("rebinds persisted report handles across broker clear and process restart", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const overrides: GatewayOverrides = {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
      getListingStatus: async () => queuedListing(listingStarts),
      getShipmentStatus: async () => queuedShipment(shipmentStarts),
    };
    const firstRouter = router(localStore, overrides);
    const first = await brandStart(firstRouter);
    expect(first.status).toBe(202);

    firstRouter.dispose();
    const reboundAfterClear = await brandStart(firstRouter);
    expect(reboundAfterClear.status).toBe(202);
    expect(body(reboundAfterClear).jobId).toBe(body(first).jobId);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);

    firstRouter.dispose();
    const restartedStore = new LocalStore(localStore.filePath);
    await restartedStore.initialize();
    const restartedRouter = router(restartedStore, overrides);
    const reboundAfterRestart = await brandStart(restartedRouter);
    expect(reboundAfterRestart.status).toBe(202);
    expect(body(reboundAfterRestart).jobId).toBe(body(first).jobId);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("migrates an R02 raw lease handle once without creating another report", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const overrides: GatewayOverrides = {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
      getListingStatus: async () => queuedListing(listingStarts),
      getShipmentStatus: async () => queuedShipment(shipmentStarts),
    };
    const firstRouter = router(localStore, overrides);
    expect((await brandStart(firstRouter)).status).toBe(202);
    const persisted = await localStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    const listingLease = await localStore.getSharedReport({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      optionsKey: "preferredReportDocumentLocale=en_US",
    });
    if (!persisted || !listingLease) {
      throw new Error("Expected persisted Brand job and All Listings lease");
    }
    await localStore.updateBrandSalesJobLeg({
      jobId: persisted.jobId,
      leg: "listing",
      value: {
        ...persisted.listing,
        reportId: `report-lease.${listingLease.leaseId}`,
        documentId: null,
        leaseBinding: null,
        handleBinding: null,
      },
      updatedAt: persisted.updatedAt + 1,
    });
    firstRouter.dispose();
    const restartedStore = new LocalStore(localStore.filePath);
    await restartedStore.initialize();

    const response = await brandStart(router(restartedStore, overrides));
    const migrated = await restartedStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });

    expect(response.status).toBe(202);
    expect(migrated?.listing.reportId).toMatch(/^report-lease\.broker\./u);
    expect(migrated?.listing.leaseBinding).toMatch(/^[a-f0-9]{64}$/u);
    expect(migrated?.listing.handleBinding).toMatch(/^[a-f0-9]{64}$/u);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("fails closed when a persisted broker handle loses its main-only bindings", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const overrides: GatewayOverrides = {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
      getListingStatus: async () => queuedListing(listingStarts),
      getShipmentStatus: async () => queuedShipment(shipmentStarts),
    };
    const firstRouter = router(localStore, overrides);
    const started = await brandStart(firstRouter);
    expect(started.status).toBe(202);
    const persisted = await localStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    if (!persisted) throw new Error("Expected persisted brand job");
    expect(persisted.listing.reportId).toMatch(/^report-lease\.broker\./u);
    await localStore.updateBrandSalesJobLeg({
      jobId: persisted.jobId,
      leg: "listing",
      value: {
        ...persisted.listing,
        leaseBinding: null,
        handleBinding: null,
      },
      updatedAt: persisted.updatedAt + 1,
    });

    firstRouter.dispose();
    const restartedStore = new LocalStore(localStore.filePath);
    await restartedStore.initialize();
    const response = await brandStart(router(restartedStore, overrides));

    expect(response.status).toBe(409);
    expect(body(response).code).toBe("REPORT_MISMATCH");
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("keeps legacy missing-window active, done, and unknown jobs as fail-closed tombstones", async () => {
    for (const status of ["IN_QUEUE", "DONE", "CREATION_UNKNOWN"] as const) {
      const localStore = await legacyWindowStore(status);
      let listingStarts = 0;
      let shipmentStarts = 0;
      const app = router(localStore, {
        startListing: async () => queuedListing(++listingStarts),
        startShipment: async () => queuedShipment(++shipmentStarts),
      });

      const automatic = await brandStart(app);
      expect(automatic.status).toBe(409);
      expect(body(automatic).code).toBe("BRAND_REPORT_WINDOW_INCOMPATIBLE");
      const guardedRetry = await brandStart(app, { retry: true });
      expect(guardedRetry.status).toBe(409);
      expect(body(guardedRetry).code).toBe("REPORT_RETRY_WAIT");
      expect(listingStarts).toBe(0);
      expect(shipmentStarts).toBe(0);

      const persisted = await localStore.getBrandSalesJob({
        accountScope: ACCOUNT_SCOPE,
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-07",
      });
      expect(persisted).toMatchObject({
        windowCompatibility: "MISSING_IMMUTABLE_WINDOW",
        shipmentDataStartTime: "legacy-missing-immutable-window",
        shipmentDataEndTime: "legacy-missing-immutable-window",
        expiresAt: Number.MAX_SAFE_INTEGER,
      });
      await localStore.syncProductIdentity({
        accountScope: ACCOUNT_SCOPE,
        marketplaceId: MARKETPLACE_ID,
        sellerSku: `SAFE-${status}`,
      });
      const raw = await readFile(localStore.filePath, "utf8");
      expect(raw).toContain("MISSING_IMMUTABLE_WINDOW");
      expect(raw).toContain("legacy-missing-immutable-window");
      expect(raw).not.toMatch(/refresh.?token|client.?secret|lwaClientSecret/iu);
    }
  });

  it("replaces every legacy missing-window state only after an explicit guarded retry", async () => {
    for (const status of ["IN_QUEUE", "DONE", "CREATION_UNKNOWN"] as const) {
      const localStore = await legacyWindowStore(status);
      let listingStarts = 0;
      let shipmentStarts = 0;
      const app = router(localStore, {
        startListing: async () => queuedListing(++listingStarts),
        startShipment: async () => queuedShipment(++shipmentStarts),
      });
      const deleteSpy = vi.spyOn(localStore, "deleteBrandSalesJob");

      vi.setSystemTime(new Date("2026-08-09T00:30:01.000Z"));
      const automatic = await brandStart(app);
      expect(automatic.status).toBe(409);
      expect(body(automatic).code).toBe("BRAND_REPORT_WINDOW_INCOMPATIBLE");
      expect(listingStarts).toBe(0);
      expect(shipmentStarts).toBe(0);

      const explicit = await brandStart(app, { retry: true });
      expect(explicit.status).toBe(202);
      expect(listingStarts).toBe(1);
      expect(shipmentStarts).toBe(1);
      const reused = await brandStart(app, { retry: true });
      expect(reused.status).toBe(202);
      expect(body(reused).jobId).toBe(body(explicit).jobId);
      expect(listingStarts).toBe(1);
      expect(shipmentStarts).toBe(1);
      expect(deleteSpy).not.toHaveBeenCalled();
    }
  });

  it("redetects the rollback-safe sentinel when an older v2 writer strips the marker", async () => {
    const originalStore = await legacyWindowStore("DONE");
    const raw = JSON.parse(await readFile(originalStore.filePath, "utf8")) as {
      brandSalesJobs: Record<string, Record<string, unknown>>;
    };
    const [job] = Object.values(raw.brandSalesJobs);
    delete job.windowCompatibility;
    delete job.originalExpiresAt;
    await writeFile(originalStore.filePath, JSON.stringify(raw));

    const reopened = new LocalStore(originalStore.filePath);
    await reopened.initialize();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(reopened, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
    });

    const automatic = await brandStart(app);
    expect(automatic.status).toBe(409);
    expect(body(automatic).code).toBe("BRAND_REPORT_WINDOW_INCOMPATIBLE");
    expect(listingStarts).toBe(0);
    expect(shipmentStarts).toBe(0);
  });

  it("single-flights concurrent starts and reuses the exact selection sequentially", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
    });

    const [first, concurrent] = await Promise.all([brandStart(app), brandStart(app)]);
    const sequential = await brandStart(app);
    expect(first.status, JSON.stringify(body(first))).toBe(202);
    expect(body(concurrent).jobId).toBe(body(first).jobId);
    expect(body(sequential).jobId).toBe(body(first).jobId);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("keeps the public status poll at 202 while either report leg is pending", async () => {
    const localStore = await store();
    const app = router(localStore, {
      startListing: async () => queuedListing(1),
      startShipment: async () => queuedShipment(1),
      getListingStatus: async ({ reportId }) => ({
        ...queuedListing(1),
        reportId,
      }),
      getShipmentStatus: async ({ reportId }) => ({
        ...queuedShipment(1),
        reportId,
      }),
    });
    const started = await brandStart(app);

    const status = await app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(body(started).jobId),
      },
    }));

    expect(status.status).toBe(202);
    expect(body(status)).toMatchObject({ ready: false, status: "IN_QUEUE" });
  });

  it("does not return a reusable job after the captured execution context is invalidated", async () => {
    const localStore = await store();
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      }),
    );
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      spExecutionContext: context,
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
    });
    expect((await brandStart(app)).status).toBe(202);
    const readStored = localStore.getBrandSalesJob.bind(localStore);
    vi.spyOn(localStore, "getBrandSalesJob").mockImplementationOnce(
      async (identity) => {
        const stored = await readStored(identity);
        context.invalidate("account-changed");
        return stored;
      },
    );

    const reused = await brandStart(app);

    expect(reused.status).toBe(409);
    expect(body(reused).code).toBe("SP_CONTEXT_INVALIDATED");
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("does not start or mirror either report leg after the captured context is invalidated", async () => {
    const localStore = await store();
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      }),
    );
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      spExecutionContext: context,
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
    });
    const readStored = localStore.getBrandSalesJob.bind(localStore);
    vi.spyOn(localStore, "getBrandSalesJob").mockImplementationOnce(
      async (identity) => {
        const stored = await readStored(identity);
        context.invalidate("account-changed");
        return stored;
      },
    );

    const response = await brandStart(app);

    expect(response.status).toBe(409);
    expect(body(response).code).toBe("SP_CONTEXT_INVALIDATED");
    expect(listingStarts).toBe(0);
    expect(shipmentStarts).toBe(0);
    const persisted = await readStored({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    expect(persisted).toBeNull();
  });

  it("does not mirror another account's compatible lease after a start-time context switch", async () => {
    const localStore = await store();
    const otherScope = `${ACCOUNT_SCOPE}-other`;
    let accountScope = otherScope;
    let switchDuringCreate = false;
    let switched = false;
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope,
      }),
    );
    let listingStarts = 0;
    let shipmentStarts = 0;
    const switchAccount = () => {
      if (!switchDuringCreate || switched) return;
      switched = true;
      accountScope = otherScope;
      context.invalidate("account-changed");
    };
    const app = router(localStore, {
      spExecutionContext: context,
      startListing: async () => {
        listingStarts += 1;
        switchAccount();
        return queuedListing(listingStarts);
      },
      startShipment: async () => {
        shipmentStarts += 1;
        switchAccount();
        return queuedShipment(shipmentStarts);
      },
    });
    expect((await brandStart(app)).status).toBe(202);
    const otherJob = await localStore.getBrandSalesJob({
      accountScope: otherScope,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    if (!otherJob) throw new Error("Expected other-account brand job");

    accountScope = ACCOUNT_SCOPE;
    context.invalidate("account-changed");
    switchDuringCreate = true;
    const response = await brandStart(app);

    expect(response.status).toBe(409);
    expect(body(response).code).toBe("SP_CONTEXT_INVALIDATED");
    const currentJob = await localStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    expect(currentJob?.listing.reportId).toBeNull();
    expect(currentJob?.shipment.reportId).toBeNull();
    expect(currentJob?.listing.reportId).not.toBe(otherJob.listing.reportId);
    expect(currentJob?.shipment.reportId).not.toBe(otherJob.shipment.reportId);
  });

  it("does not adopt legacy raw handles into another account during normalization", async () => {
    const localStore = await store();
    const otherScope = `${ACCOUNT_SCOPE}-other`;
    const window = planFbaShipmentSalesWindow({
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      now: new Date(Date.now()),
    });
    await localStore.createBrandSalesJobIfAbsent({
      jobId: "legacy-raw-brand-job",
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      mode: "demo",
      shipmentDataStartTime: window.dataStartTime,
      shipmentDataEndTime: window.dataEndTime,
      listing: {
        reportId: "legacy-listing-report-a",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: window.windowCreatedAt,
        terminal: null,
        terminalAt: null,
      },
      shipment: {
        reportId: "legacy-shipment-report-a",
        documentId: null,
        status: "IN_QUEUE",
        createdAt: window.windowCreatedAt,
        terminal: null,
        terminalAt: null,
      },
      createdAt: window.windowCreatedAt,
      updatedAt: window.windowCreatedAt,
      expiresAt: window.windowCreatedAt + 60 * 60 * 1_000,
    }, window.windowCreatedAt);
    let accountScope = ACCOUNT_SCOPE;
    const base = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({ marketplaceId, mode: "demo", accountScope }),
    );
    let captureCalls = 0;
    let assertCalls = 0;
    let switched = false;
    const switchAccount = () => {
      if (switched) return;
      switched = true;
      accountScope = otherScope;
      base.invalidate("account-changed");
    };
    const context: SpExecutionContextAdapter = {
      async capture(marketplaceId) {
        captureCalls += 1;
        if (captureCalls === 2) switchAccount();
        return base.capture(marketplaceId);
      },
      async assertCurrent(captured: SpExecutionContext) {
        assertCalls += 1;
        if (assertCalls === 2) switchAccount();
        return base.assertCurrent(captured);
      },
      invalidate: (reason) => base.invalidate(reason),
    };
    const app = router(localStore, { spExecutionContext: context });

    const response = await brandStart(app);

    expect(response.status).toBe(409);
    expect(body(response).code).toBe("SP_CONTEXT_INVALIDATED");
    const raw = JSON.parse(await readFile(localStore.filePath, "utf8")) as {
      sharedAllListingsReports: Record<string, { accountScope: string }>;
    };
    expect(Object.values(raw.sharedAllListingsReports).filter(
      (lease) => lease.accountScope === otherScope,
    )).toHaveLength(0);
    const persisted = await localStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    expect(persisted?.listing.reportId).toBe("legacy-listing-report-a");
    expect(persisted?.shipment.reportId).toBe("legacy-shipment-report-a");
  });

  it("reuses the account-scoped exact range when switching A to B and back to A", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async ({ startDate }) => ({
        ...queuedShipment(++shipmentStarts),
        reportId: `shipment-${startDate}`,
        dataStartTime: startDate === "2026-07-01"
          ? "2026-07-01T00:00:00-07:00"
          : "2026-08-01T00:00:00-07:00",
        dataEndTime: startDate === "2026-07-01"
          ? "2026-07-08T00:00:00-07:00"
          : "2026-08-08T00:00:00-07:00",
      }),
    });

    const rangeA = await brandStart(app);
    await brandStart(app, { startDate: "2026-07-01", endDate: "2026-07-07" });
    const rangeAAgain = await brandStart(app);

    expect(body(rangeAAgain).jobId).toBe(body(rangeA).jobId);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(2);
  });

  it("single-flights the same brand selection across automatic and explicit retry callers", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const app = router(localStore, {
      startListing: async () => {
        listingStarts += 1;
        await gate;
        return queuedListing(listingStarts);
      },
      startShipment: async () => {
        shipmentStarts += 1;
        await gate;
        return queuedShipment(shipmentStarts);
      },
    });

    const automatic = brandStart(app);
    const explicit = brandStart(app, { retry: true });
    await vi.waitFor(() => {
      expect(listingStarts).toBeGreaterThan(0);
      expect(shipmentStarts).toBeGreaterThan(0);
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);

    release();
    const responses = await Promise.all([automatic, explicit]);
    expect(responses.map(({ status }) => status)).toEqual([202, 202]);
    expect(body(responses[0]).jobId).toBe(body(responses[1]).jobId);
  });

  it("single-flights the shared all-listings POST across brand auto-load and an explicit audit", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    let releaseListing!: () => void;
    const listingGate = new Promise<void>((resolve) => { releaseListing = resolve; });
    const app = router(localStore, {
      startListing: async () => {
        listingStarts += 1;
        await listingGate;
        return queuedListing(listingStarts);
      },
      startShipment: async () => queuedShipment(++shipmentStarts),
    });

    const automatic = brandStart(app);
    const explicitAudit = app.handle(request({
      method: "POST",
      path: "/api/sp-api/variation-audit",
      body: { marketplaceId: MARKETPLACE_ID },
    }));
    await vi.waitFor(() => expect(listingStarts).toBeGreaterThan(0));
    await vi.advanceTimersByTimeAsync(1);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);

    releaseListing();
    const [brand, audit] = await Promise.all([automatic, explicitAudit]);
    expect(brand.status).toBe(202);
    expect(audit.status).toBe(202);
    expect(body(audit).reportId).toMatch(/^report-lease\./u);
    expect(body(audit).reportId).not.toBe("listing-report-1");
  });

  it("reuses active report IDs after an ApiRouter/App-main restart", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const gateway = {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
    };
    const first = await brandStart(router(localStore, gateway));
    const resumed = await brandStart(router(localStore, gateway));
    expect(body(resumed).jobId).toBe(body(first).jobId);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("shares the range-independent all-listings report across dates and audit/export consumers", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async ({ startDate }) => ({
        ...queuedShipment(++shipmentStarts),
        reportId: `shipment-${startDate}`,
        dataStartTime: startDate === "2026-07-01"
          ? "2026-07-01T00:00:00-07:00"
          : "2026-08-01T00:00:00-07:00",
        dataEndTime: startDate === "2026-07-01"
          ? "2026-07-08T00:00:00-07:00"
          : "2026-08-08T00:00:00-07:00",
      }),
    });

    await brandStart(app);
    await brandStart(app, { startDate: "2026-07-01", endDate: "2026-07-07" });
    const variation = await app.handle(request({
      method: "POST",
      path: "/api/sp-api/variation-audit",
      body: { marketplaceId: MARKETPLACE_ID },
    }));
    const exported = await app.handle(request({
      method: "POST",
      path: "/api/sp-api/listing-content/export",
      body: { marketplaceId: MARKETPLACE_ID },
    }));
    const review = await app.handle(request({
      method: "POST",
      path: "/api/sp-api/review-audit",
      body: { marketplaceId: MARKETPLACE_ID },
    }));

    expect(variation.status).toBe(202);
    expect(exported.status).toBe(202);
    expect(review.status).toBe(202);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(2);
  });

  it("persists partial success and explicit retry creates only the missing shipment leg", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => {
        shipmentStarts += 1;
        if (shipmentStarts === 1) {
          throw new SpApiError("rate limited", {
            status: 429,
            code: "RATE_LIMITED",
          });
        }
        return queuedShipment(shipmentStarts);
      },
    });

    expect((await brandStart(app)).status).toBe(429);
    const automatic = await brandStart(app);
    expect(automatic.status).toBe(409);
    expect(body(automatic).code).toBe("BRAND_REPORT_RETRY_REQUIRED");
    expect((await brandStart(app, { retry: true })).status).toBe(202);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(2);
  });

  it("persists partial success and explicit retry creates only the missing listing leg", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => {
        listingStarts += 1;
        if (listingStarts === 1) {
          throw new SpApiError("rate limited", {
            status: 429,
            code: "RATE_LIMITED",
          });
        }
        return queuedListing(listingStarts);
      },
      startShipment: async () => queuedShipment(++shipmentStarts),
    });

    expect((await brandStart(app)).status).toBe(429);
    expect((await brandStart(app)).status).toBe(409);
    expect((await brandStart(app, { retry: true })).status).toBe(202);
    expect(listingStarts).toBe(2);
    expect(shipmentStarts).toBe(1);
  });

  it("marks CANCELLED terminal, never auto-reposts, and retries only that leg after the guard", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
      getListingStatus: async ({ reportId }) => ({
        mode: "demo",
        ready: true,
        reportId,
        documentId: "listing-document-1",
        status: "DONE",
        notice: "done",
      }),
      getShipmentStatus: async () => {
        throw new SpApiError("cancelled", {
          status: 422,
          code: "REPORT_CANCELLED",
        });
      },
    });
    const started = await brandStart(app);
    const jobId = String(body(started).jobId);
    const polled = await app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: { marketplaceId: MARKETPLACE_ID, jobId },
    }));
    expect(polled.status).toBe(422);
    expect(body(polled).code).toBe("REPORT_CANCELLED");

    expect(body(await brandStart(app)).code).toBe("REPORT_CANCELLED");
    const earlyRetry = await brandStart(app, { retry: true });
    expect(body(earlyRetry).code).toBe("REPORT_RETRY_WAIT");
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);

    vi.setSystemTime(new Date("2026-08-09T00:30:01.000Z"));
    expect((await brandStart(app, { retry: true })).status).toBe(202);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(2);
  });

  it("does not turn transient poll failures into terminal state", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
      getListingStatus: async ({ reportId }) => ({
        mode: "demo",
        ready: false,
        reportId,
        documentId: null,
        status: "IN_PROGRESS",
        notice: "working",
      }),
      getShipmentStatus: async () => {
        throw new SpApiError("temporary", {
          status: 502,
          code: "REPORT_FAILED",
        });
      },
    });
    const started = await brandStart(app);
    const jobId = String(body(started).jobId);
    expect((await app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: { marketplaceId: MARKETPLACE_ID, jobId },
    }))).status).toBe(502);

    const persisted = await localStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    expect(persisted?.shipment.terminal).toBeNull();
    expect((await brandStart(app)).status).toBe(202);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("extends an active job past the local TTL without blindly creating a fresh pair", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
    });
    await brandStart(app);

    vi.setSystemTime(new Date("2026-08-09T00:58:30.000Z"));
    const nearExpiry = await brandStart(app);
    expect(nearExpiry.status).toBe(202);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);

    vi.setSystemTime(new Date("2026-08-09T02:00:01.000Z"));
    expect((await brandStart(app)).status).toBe(202);
    const audit = await app.handle(request({
      method: "POST",
      path: "/api/sp-api/variation-audit",
      body: { marketplaceId: MARKETPLACE_ID },
    }));
    expect(audit.status).toBe(202);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("rebinds an extended brand job when a same-identity DONE listing lease replaces the old DONE lease", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => {
        listingStarts += 1;
        return {
          ...queuedListing(listingStarts),
          ready: true,
          documentId: `listing-document-${listingStarts}`,
          status: "DONE",
        };
      },
      startShipment: async () => queuedShipment(++shipmentStarts),
    });

    const started = await brandStart(app);
    const jobId = String(body(started).jobId);
    const initialJob = await localStore.getBrandSalesJobById(jobId);
    if (!initialJob) throw new Error("Expected the initial Brand job");

    vi.setSystemTime(new Date("2026-08-09T00:58:30.000Z"));
    const extended = await brandStart(app);
    const extendedJob = await localStore.getBrandSalesJobById(jobId);
    if (!extendedJob) throw new Error("Expected the extended Brand job");
    expect(extended.status).toBe(202);
    expect(body(extended).jobId).toBe(jobId);
    expect(extendedJob.expiresAt).toBeGreaterThan(initialJob.expiresAt);

    const oldListingLease = await localStore.getSharedAllListingsReport({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
    });
    if (!oldListingLease) throw new Error("Expected the old All Listings lease");
    await localStore.deleteSharedAllListingsReport(oldListingLease.leaseId);

    const replacement = await app.handle(request({
      method: "POST",
      path: "/api/sp-api/variation-audit",
      body: { marketplaceId: MARKETPLACE_ID },
    }));
    expect(replacement.status).toBe(200);
    expect(listingStarts).toBe(2);

    const reopened = await brandStart(app);
    const reboundJob = await localStore.getBrandSalesJobById(jobId);

    expect(reopened.status).toBe(202);
    expect(body(reopened).jobId).toBe(jobId);
    expect(reboundJob?.listing).toMatchObject({
      reportId: body(replacement).reportId,
      documentId: body(replacement).documentId,
      status: "DONE",
    });
    expect(shipmentStarts).toBe(1);
  });

  it("preserves a returned report ID as CREATION_UNKNOWN after post-create validation mismatch", async () => {
    const localStore = await store();
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(1),
      startShipment: async () => ({
        ...queuedShipment(++shipmentStarts),
        dataEndTime: "2026-08-09T07:00:00.000Z",
      }),
    });
    expect((await brandStart(app)).status).toBe(409);
    const persisted = await localStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    expect(persisted?.shipment).toMatchObject({
      status: "CREATION_UNKNOWN",
      terminal: "CREATION_UNKNOWN",
    });
    expect(persisted?.shipment.reportId).toMatch(/^report-lease\./u);
    expect(persisted?.shipment.reportId).not.toBe("shipment-report-1");
    expect(body(await brandStart(app, { retry: true })).code).toBe("REPORT_RETRY_WAIT");
    expect(shipmentStarts).toBe(1);
  });

  it("rejects a bound handle changed to a raw-looking ID with a sanitized DTO", async () => {
    const localStore = await store();
    const overrides: GatewayOverrides = {
      startListing: async () => queuedListing(1),
      startShipment: async () => queuedShipment(1),
    };
    const started = await brandStart(router(localStore, overrides));
    const persisted = await localStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    if (!persisted) throw new Error("Expected persisted brand job");
    await localStore.updateBrandSalesJobLeg({
      jobId: persisted.jobId,
      leg: "listing",
      value: {
        ...persisted.listing,
        reportId: "listing-report-tampered",
      },
      updatedAt: persisted.updatedAt + 1,
    });

    const response = await brandStart(router(localStore, overrides));

    expect(started.status).toBe(202);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      kind: "json",
      value: {
        code: "REPORT_MISMATCH",
        message: "品牌營收工作與 Reports runtime 不一致。",
        requestId: null,
        issues: [],
        operation: null,
        upstreamCode: null,
      },
    });
  });

  it("keeps an expired CREATION_UNKNOWN tombstone until an explicit retry", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => {
        shipmentStarts += 1;
        return shipmentStarts === 1
          ? {
              ...queuedShipment(shipmentStarts),
              dataEndTime: "2026-08-09T07:00:00.000Z",
            }
          : queuedShipment(shipmentStarts);
      },
    });

    expect((await brandStart(app)).status).toBe(409);
    vi.setSystemTime(new Date("2026-08-09T01:00:01.000Z"));
    const automatic = await brandStart(app);
    expect(automatic.status).toBe(409);
    expect(body(automatic).code).toBe("BRAND_REPORT_RETRY_REQUIRED");
    expect(shipmentStarts).toBe(1);

    expect((await brandStart(app, { retry: true })).status).toBe(202);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(2);
  });

  it("keeps an expired shared-listings CREATION_UNKNOWN lease until explicit retry", async () => {
    const localStore = await store();
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => {
        listingStarts += 1;
        return listingStarts === 1
          ? {
              ...queuedListing(listingStarts),
              ready: true,
              status: "DONE" as const,
            }
          : queuedListing(listingStarts);
      },
      startShipment: async () => queuedShipment(++shipmentStarts),
    });

    expect((await brandStart(app)).status).toBe(409);
    expect((await localStore.getSharedAllListingsReport({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
    }))?.report).toMatchObject({
      reportId: "listing-report-1",
      status: "CREATION_UNKNOWN",
      terminal: "CREATION_UNKNOWN",
    });

    vi.setSystemTime(new Date("2026-08-09T01:00:01.000Z"));
    expect(body(await brandStart(app)).code).toBe("BRAND_REPORT_RETRY_REQUIRED");
    expect(listingStarts).toBe(1);

    expect((await brandStart(app, { retry: true })).status).toBe(202);
    expect(listingStarts).toBe(2);
    expect(shipmentStarts).toBe(1);
  });

  it("single-flights shared report status and prevents a stale CAS from replacing DONE", async () => {
    const localStore = await store();
    type DoneListingStatus = {
      mode: "demo";
      ready: true;
      reportId: string;
      documentId: string;
      status: "DONE";
      notice: string;
    };
    let resolveStatus!: (value: DoneListingStatus) => void;
    const statusPromise = new Promise<DoneListingStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const getListingStatus = vi.fn(async () => statusPromise);
    const app = router(localStore, {
      startListing: async () => queuedListing(1),
      getListingStatus,
    });
    const started = await app.handle(request({
      method: "POST",
      path: "/api/sp-api/variation-audit",
      body: { marketplaceId: MARKETPLACE_ID },
    }));
    const reportId = String(body(started).reportId);
    const statusRequest = () => app.handle(request({
      method: "GET",
      path: "/api/sp-api/variation-audit",
      query: { marketplaceId: MARKETPLACE_ID, reportId },
    }));
    const first = statusRequest();
    const second = statusRequest();
    await vi.waitFor(() => expect(getListingStatus).toHaveBeenCalledTimes(1));
    resolveStatus({
      mode: "demo",
      ready: true,
      reportId: "listing-report-1",
      documentId: "listing-document-1",
      status: "DONE",
      notice: "done",
    });
    const responses = await Promise.all([first, second]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);

    const completed = await localStore.getSharedAllListingsReport({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
    });
    expect(completed?.report.status).toBe("DONE");
    const stale = await localStore.updateSharedAllListingsReport({
      leaseId: completed!.leaseId,
      report: {
        ...completed!.report,
        status: "IN_PROGRESS",
        documentId: null,
      },
      updatedAt: completed!.updatedAt + 1,
      expectedUpdatedAt: completed!.updatedAt - 1,
    });
    expect(stale.report).toMatchObject({
      status: "DONE",
      documentId: "listing-document-1",
    });
  });

  it("keeps status and data response flights schema-separated", async () => {
    const localStore = await store();
    const getListingStatus = vi.fn(async ({ reportId }: { reportId: string }) => ({
      mode: "demo" as const,
      ready: true,
      reportId,
      documentId: "listing-document-1",
      status: "DONE" as const,
      notice: "done",
    }));
    type DoneShipmentStatus = Omit<
      ReturnType<typeof queuedShipment>,
      "ready" | "documentId" | "status"
    > & {
      ready: true;
      documentId: string;
      status: "DONE";
    };
    let resolveShipment!: (value: DoneShipmentStatus) => void;
    let observeShipmentTurn!: () => void;
    const shipmentStatus = new Promise<DoneShipmentStatus>((resolve) => {
      resolveShipment = resolve;
    });
    const shipmentTurn = new Promise<void>((resolve) => {
      observeShipmentTurn = resolve;
    });
    let shipmentCalls = 0;
    const getShipmentStatus = vi.fn(async () => {
      shipmentCalls += 1;
      if (shipmentCalls === 1) queueMicrotask(observeShipmentTurn);
      return shipmentStatus;
    });
    const app = router(localStore, {
      startListing: async () => queuedListing(1),
      startShipment: async () => queuedShipment(1),
      getListingStatus,
      getShipmentStatus,
      getDataFromDocuments: async (input) => {
        const snapshot = demoBrandSnapshot(input);
        return {
          ...snapshot,
          internalOnly: "must-not-cross",
          segments: snapshot.segments.map((segment) => ({
            ...segment,
            internalOnly: "must-not-cross",
          })),
          summary: {
            ...snapshot.summary,
            internalOnly: "must-not-cross",
          },
        } as never;
      },
    });
    const started = await brandStart(app);
    const jobId = String(body(started).jobId);
    const statusFlight = app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: { marketplaceId: MARKETPLACE_ID, jobId },
    }));
    const dataFlight = app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: { marketplaceId: MARKETPLACE_ID, jobId, data: "1" },
    }));
    await shipmentTurn;
    expect(getListingStatus).toHaveBeenCalledTimes(1);
    expect(getShipmentStatus).toHaveBeenCalledTimes(1);
    resolveShipment({
      ...queuedShipment(1),
      ready: true,
      documentId: "shipment-document-1",
      status: "DONE",
    });
    const [statusResponse, dataResponse] = await Promise.all([statusFlight, dataFlight]);
    expect(body(statusResponse)).toMatchObject({ jobId, ready: true });
    expect(body(statusResponse).schemaVersion).toBeUndefined();
    expect(body(dataResponse)).toMatchObject({
      schemaVersion: 2,
      source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT",
    });
    expect(body(dataResponse).internalOnly).toBeUndefined();
    expect((body(dataResponse).segments as Array<Record<string, unknown>>)[0]
      ?.internalOnly).toBeUndefined();
    expect((body(dataResponse).summary as Record<string, unknown>).internalOnly)
      .toBeUndefined();
  });

  it("aborts disposed start flights without joining or reposting them in the fresh lifecycle", async () => {
    const localStore = await store();
    let releaseListing!: () => void;
    let releaseShipment!: () => void;
    const listingGate = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    const shipmentGate = new Promise<void>((resolve) => {
      releaseShipment = resolve;
    });
    let listingStarts = 0;
    let shipmentStarts = 0;
    const listingSignals: AbortSignal[] = [];
    const shipmentSignals: AbortSignal[] = [];
    const app = router(localStore, {
      startListing: async ({ signal }) => {
        listingStarts += 1;
        if (signal) listingSignals.push(signal);
        await listingGate;
        return queuedListing(listingStarts);
      },
      startShipment: async ({ signal }) => {
        shipmentStarts += 1;
        if (signal) shipmentSignals.push(signal);
        await shipmentGate;
        return queuedShipment(shipmentStarts);
      },
    });

    const stale = brandStart(app);
    await vi.waitFor(() => {
      expect(listingStarts).toBe(1);
      expect(shipmentStarts).toBe(1);
    });
    app.dispose();

    const cancelled = await stale;
    expect(cancelled.status).toBe(409);
    expect(body(cancelled).code).toBe("SP_CONTEXT_INVALIDATED");
    expect(listingSignals[0]?.aborted).toBe(true);
    expect(shipmentSignals[0]?.aborted).toBe(true);

    const fresh = await brandStart(app);
    expect(fresh.status).toBe(409);
    expect(body(fresh).code).toBe("BRAND_REPORT_RETRY_REQUIRED");
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);

    releaseListing();
    releaseShipment();
    await vi.advanceTimersByTimeAsync(1);
    const afterStaleSettlement = await brandStart(app);
    expect(afterStaleSettlement.status).toBe(409);
    expect(body(afterStaleSettlement).code).toBe("BRAND_REPORT_RETRY_REQUIRED");
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
  });

  it("aborts a disposed poll flight without losing the fresh single-flight", async () => {
    const localStore = await store();
    let releaseStale!: () => void;
    let releaseFresh!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    const freshGate = new Promise<void>((resolve) => {
      releaseFresh = resolve;
    });
    let listingStarts = 0;
    let shipmentStarts = 0;
    let shipmentPolls = 0;
    const shipmentSignals: AbortSignal[] = [];
    const app = router(localStore, {
      startListing: async () => queuedListing(++listingStarts),
      startShipment: async () => queuedShipment(++shipmentStarts),
      getListingStatus: async ({ reportId }) => ({
        ...queuedListing(1),
        ready: true,
        reportId,
        documentId: "listing-document-1",
        status: "DONE",
      }),
      getShipmentStatus: async ({ reportId, signal }) => {
        shipmentPolls += 1;
        const call = shipmentPolls;
        if (signal) shipmentSignals.push(signal);
        await (call === 1 ? staleGate : freshGate);
        return {
          ...queuedShipment(1),
          ready: true,
          reportId,
          documentId: call === 1
            ? "stale-shipment-document"
            : "fresh-shipment-document",
          status: "DONE",
        };
      },
    });
    const started = await brandStart(app);
    const jobId = String(body(started).jobId);
    const observe = () => app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: { marketplaceId: MARKETPLACE_ID, jobId },
    }));

    const stale = observe();
    await vi.waitFor(() => expect(shipmentPolls).toBe(1));
    app.dispose();

    const cancelled = await stale;
    expect(cancelled.status).toBe(409);
    expect(body(cancelled).code).toBe("SP_CONTEXT_INVALIDATED");
    expect(shipmentSignals[0]?.aborted).toBe(true);

    const fresh = observe();
    await vi.waitFor(() => expect(shipmentPolls).toBe(2));
    expect(shipmentSignals[1]?.aborted).toBe(false);

    releaseStale();
    await vi.advanceTimersByTimeAsync(1);
    const joined = observe();
    await vi.advanceTimersByTimeAsync(1);
    expect(shipmentPolls).toBe(2);

    releaseFresh();
    const [freshResponse, joinedResponse] = await Promise.all([fresh, joined]);
    expect(freshResponse.status).toBe(200);
    expect(joinedResponse.status).toBe(200);
    expect(body(freshResponse)).toMatchObject({ jobId, ready: true });
    expect(body(joinedResponse)).toMatchObject({ jobId, ready: true });
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
    expect(shipmentPolls).toBe(2);
    const persisted = await localStore.getBrandSalesJobById(jobId);
    if (!persisted) throw new Error("Expected the fresh Brand job to persist");
    const shipmentLease = await localStore.getSharedReport({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
      optionsKey: sharedFbaShipmentSalesOptionsKey({
        startDate: persisted.startDate,
        endDate: persisted.endDate,
        dataStartTime: persisted.shipmentDataStartTime,
        dataEndTime: persisted.shipmentDataEndTime,
        windowCreatedAt: persisted.createdAt,
      }),
    });
    expect(shipmentLease?.report.documentId).toBe("fresh-shipment-document");
  });

  it("aborts a disposed data flight without joining or caching it in the fresh lifecycle", async () => {
    const localStore = await store();
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let listingStarts = 0;
    let shipmentStarts = 0;
    let reads = 0;
    const signals: AbortSignal[] = [];
    const app = router(localStore, {
      startListing: async () => ({
        ...queuedListing(++listingStarts),
        ready: true,
        documentId: "listing-document-1",
        status: "DONE",
      }),
      startShipment: async () => ({
        ...queuedShipment(++shipmentStarts),
        ready: true,
        documentId: "shipment-document-1",
        status: "DONE",
      }),
      getDataFromDocuments: async (input) => {
        reads += 1;
        if (input.signal) signals.push(input.signal);
        if (reads === 1) await staleGate;
        return demoBrandSnapshot(input);
      },
    });
    const started = await brandStart(app);
    const jobId = String(body(started).jobId);
    const readData = () => app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: { marketplaceId: MARKETPLACE_ID, jobId, data: "1" },
    }));

    const stale = readData();
    await vi.waitFor(() => expect(reads).toBe(1));
    app.dispose();

    const cancelled = await stale;
    expect(cancelled.status).toBe(409);
    expect(body(cancelled).code).toBe("SP_CONTEXT_INVALIDATED");
    expect(signals[0]?.aborted).toBe(true);

    const fresh = await readData();
    expect(fresh.status).toBe(200);
    expect(reads).toBe(2);
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);

    releaseStale();
    await Promise.resolve();
    const cached = await readData();
    expect(cached.status).toBe(200);
    expect(reads).toBe(2);
  });

  it("rejects a reader snapshot whose identity is not bound to the fixed job window", async () => {
    const localStore = await store();
    const app = router(localStore, {
      startListing: async () => queuedListing(1),
      startShipment: async () => queuedShipment(1),
      getListingStatus: async ({ reportId }) => ({
        ...queuedListing(1),
        ready: true,
        reportId,
        documentId: "listing-document-1",
        status: "DONE",
      }),
      getShipmentStatus: async ({ reportId }) => ({
        ...queuedShipment(1),
        ready: true,
        reportId,
        documentId: "shipment-document-1",
        status: "DONE",
      }),
      getDataFromDocuments: async (input) => ({
        ...demoBrandSnapshot(input),
        schemaVersion: 1,
      }) as never,
    });
    const started = await brandStart(app);

    const response = await app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(body(started).jobId),
        data: "1",
      },
    }));

    expect(response.status).toBe(502);
    expect(body(response).code).toBe("REPORT_FORMAT_UNSUPPORTED");
  });

  it("does not let a new context generation join or reuse an in-flight stale snapshot", async () => {
    const localStore = await store();
    const context = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: ACCOUNT_SCOPE,
      }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    const app = router(localStore, {
      spExecutionContext: context,
      startListing: async () => queuedListing(1),
      startShipment: async () => queuedShipment(1),
      getListingStatus: async ({ reportId }) => ({
        ...queuedListing(1),
        ready: true,
        reportId,
        documentId: "listing-document-1",
        status: "DONE",
      }),
      getShipmentStatus: async ({ reportId }) => ({
        ...queuedShipment(1),
        ready: true,
        reportId,
        documentId: "shipment-document-1",
        status: "DONE",
      }),
      getDataFromDocuments: async (input) => {
        reads += 1;
        if (reads === 1) await gate;
        return demoBrandSnapshot(input);
      },
    });
    const started = await brandStart(app);
    const dataRequest = () => app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: {
        marketplaceId: MARKETPLACE_ID,
        jobId: String(body(started).jobId),
        data: "1",
      },
    }));
    const oldGeneration = dataRequest();
    await vi.waitFor(() => expect(reads).toBe(1));
    context.invalidate("account-changed");
    const newGenerationJoined = dataRequest();
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toBe(1);
    release();

    const joined = await Promise.all([oldGeneration, newGenerationJoined]);
    expect(joined.map((response) => body(response).code)).toEqual([
      "SP_CONTEXT_INVALIDATED",
      "SP_CONTEXT_INVALIDATED",
    ]);
    const fresh = await dataRequest();
    expect(fresh.status).toBe(200);
    expect(reads).toBe(2);
  });

  it("discards demo report IDs before creating a live-mode job", async () => {
    const localStore = await store();
    let mode: "demo" | "live" = "demo";
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => ({
        ...queuedListing(++listingStarts),
        mode,
      }),
      startShipment: async () => ({
        ...queuedShipment(++shipmentStarts),
        mode,
      }),
    });
    const demo = await brandStart(app);
    const demoJobId = String(body(demo).jobId);

    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "TEST_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "TEST_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "TEST_REFRESH_TOKEN";
    mode = "live";
    const oldStatus = await app.handle(request({
      method: "GET",
      path: "/api/sp-api/brand-sales",
      query: { marketplaceId: MARKETPLACE_ID, jobId: demoJobId },
    }));
    expect(body(oldStatus).code).toBe("REPORT_MODE_CHANGED");

    const transition = await brandStart(app);
    expect(transition.status).toBe(409);
    expect(body(transition).code).toBe("REPORT_MODE_CHANGED");
    const live = await brandStart(app);
    expect(live.status).toBe(202);
    expect(body(live).jobId).not.toBe(demoJobId);
    expect(listingStarts).toBe(2);
    expect(shipmentStarts).toBe(2);
  });

  it("does not let demo fallback erase or repost an unresolved live job", async () => {
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "TEST_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "TEST_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "TEST_REFRESH_TOKEN";
    const localStore = await store();
    let mode: "demo" | "live" = "live";
    let listingStarts = 0;
    let shipmentStarts = 0;
    const app = router(localStore, {
      startListing: async () => ({
        ...queuedListing(++listingStarts),
        mode,
      }),
      startShipment: async () => ({
        ...queuedShipment(++shipmentStarts),
        mode,
      }),
    });
    expect((await brandStart(app)).status).toBe(202);

    process.env.SP_API_MODE = "demo";
    mode = "demo";
    const fallback = await brandStart(app);
    expect(fallback.status).toBe(409);
    expect(body(fallback).code).toBe("REPORT_MODE_CHANGED");
    expect(listingStarts).toBe(1);
    expect(shipmentStarts).toBe(1);
    expect((await localStore.getBrandSalesJob({
      accountScope: ACCOUNT_SCOPE,
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    }))?.mode).toBe("live");
  });
});
