import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { SpApiError } from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
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

type GatewayOverrides = NonNullable<
  ConstructorParameters<typeof ApiRouter>[0]["brandSalesReports"]
>;

function router(localStore: LocalStore, overrides: GatewayOverrides = {}): ApiRouter {
  return new ApiRouter({
    store: localStore,
    vault: {
      getAccountScope: async () => ACCOUNT_SCOPE,
    } as unknown as CredentialVault,
    approveWrite: async () => undefined,
    brandSalesReports: overrides,
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
    expect(body(audit).reportId).toBe("listing-report-1");
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
      reportWindow: ({ startDate }) => ({
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
      reportId: "shipment-report-1",
      status: "CREATION_UNKNOWN",
      terminal: "CREATION_UNKNOWN",
    });
    expect(body(await brandStart(app, { retry: true })).code).toBe("REPORT_RETRY_WAIT");
    expect(shipmentStarts).toBe(1);
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
      getData: async () => ({ schemaVersion: 1, responseKind: "data" }) as never,
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
    expect(body(statusResponse).responseKind).toBeUndefined();
    expect(body(dataResponse)).toMatchObject({
      schemaVersion: 1,
      responseKind: "data",
    });
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
