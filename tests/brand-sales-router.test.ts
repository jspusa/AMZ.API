import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiRouter } from "../src/main/api-router";
import {
  reportsAdapterIdentity,
  type ReportsAdapter,
} from "../src/main/amazon/reports-runtime";
import { createScriptedSpExecutionContextAdapter } from
  "../src/main/amazon/sp-execution-context";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const previousMode = process.env.SP_API_MODE;
const MARKETPLACE_ID = "ATVPDKIKX0DER";

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

describe("FBA brand sales report route", () => {
  let accountScope: string;
  let router: ApiRouter;

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    accountScope = "demo-account-scope";
    const directory = await mkdtemp(join(tmpdir(), "brand-sales-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => accountScope,
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("binds FBA listings and shipment reports to one account-scoped date job", async () => {
    const started = await router.handle(
      request({
        method: "POST",
        path: "/api/sp-api/brand-sales",
        body: {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2026-08-01",
          endDate: "2026-08-07",
        },
      }),
    );
    expect(started.status).toBe(200);
    expect(started.body.kind).toBe("json");
    if (started.body.kind !== "json") throw new Error("Expected job JSON");
    const job = started.body.value as {
      jobId: string;
      ready: boolean;
      status: string;
      marketplaceId: string;
      startDate: string;
      endDate: string;
      expiresAt: string;
      listingReportId?: unknown;
    };
    expect(job).toMatchObject({
      ready: true,
      status: "DONE",
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
    expect(Date.parse(job.expiresAt)).toBeGreaterThan(0);
    expect(job.listingReportId).toBeUndefined();

    const data = await router.handle(
      request({
        method: "GET",
        path: "/api/sp-api/brand-sales",
        query: { marketplaceId: MARKETPLACE_ID, jobId: job.jobId, data: "1" },
      }),
    );
    expect(data.status).toBe(200);
    expect(data.body.kind).toBe("json");
    if (data.body.kind !== "json") throw new Error("Expected snapshot JSON");
    expect(data.body.value).toMatchObject({
      schemaVersion: 2,
      mode: "demo",
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT",
    });
    expect((data.body.value as { categorySegments: unknown[] }).categorySegments).toHaveLength(8);
  });

  it("rejects a different marketplace or account scope for the same job", async () => {
    const started = await router.handle(
      request({
        method: "POST",
        path: "/api/sp-api/brand-sales",
        body: {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2026-08-01",
          endDate: "2026-08-07",
        },
      }),
    );
    if (started.body.kind !== "json") throw new Error("Expected job JSON");
    const jobId = (started.body.value as { jobId: string }).jobId;

    const wrongMarket = await router.handle(
      request({
        method: "GET",
        path: "/api/sp-api/brand-sales",
        query: { marketplaceId: "A2EUQ1WTGCTBG2", jobId },
      }),
    );
    expect(wrongMarket.status).toBe(410);
    expect(wrongMarket.body).toEqual({
      kind: "json",
      value: {
        code: "SNAPSHOT_EXPIRED",
        message: "品牌營收工作已過期或站點不符，請重新同步。",
      },
    });

    accountScope = "different-account-scope";
    const wrongAccount = await router.handle(
      request({
        method: "GET",
        path: "/api/sp-api/brand-sales",
        query: { marketplaceId: MARKETPLACE_ID, jobId },
      }),
    );
    expect(wrongAccount.status).toBe(409);
  });

  it("rejects malformed dates before starting reports", async () => {
    const response = await router.handle(
      request({
        method: "POST",
        path: "/api/sp-api/brand-sales",
        body: {
          marketplaceId: MARKETPLACE_ID,
          startDate: "2026-02-30",
          endDate: "2026-08-07",
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("preserves one current-day shipment cutoff for both brand and category projections", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));
    const directory = await mkdtemp(join(tmpdir(), "brand-sales-current-day-"));
    const liveStore = new LocalStore(join(directory, "data.json"));
    await liveStore.initialize();
    const documentReads: string[] = [];
    const reportsAdapter: ReportsAdapter = {
      async create(reportRequest) {
        const reference = reportRequest.intent === "all-listings"
          ? "all-listings-current-day"
          : reportRequest.intent === "fba-shipment-sales"
            ? "shipment-current-day"
            : null;
        if (!reference) {
          throw new Error(`Unexpected report intent: ${reportRequest.intent}`);
        }
        return {
          mode: "live",
          ready: true,
          reportId: `${reference}-report`,
          documentId: `${reference}-document`,
          status: "DONE",
          notice: "ready",
          identity: reportsAdapterIdentity(reportRequest, "live"),
        };
      },
      async status(reportRequest) {
        throw new Error(`Unexpected status read: ${reportRequest.intent}`);
      },
      async readDocument(reportRequest) {
        documentReads.push(reportRequest.intent);
        const text = reportRequest.intent === "all-listings"
          ? [
              "item-name\tseller-sku\tasin1\tfulfillment-channel",
              "Afreschi Turkey Tendon Dog Treats\tSAFE-SKU-1\tB000000001\tAMAZON_NA",
              "Mystery Fish Treats\tSAFE-SKU-2\tB000000002\tAMAZON_NA",
            ].join("\n")
          : reportRequest.intent === "fba-shipment-sales"
            ? [
                "shipment-date\tsku\tquantity\titem-price-per-unit\tcurrency",
                "2026-08-09T04:30:00-07:00\tSAFE-SKU-1\t2\t10\tUSD",
                "2026-08-09T04:45:00-07:00\tSAFE-SKU-2\t1\t5\tUSD",
              ].join("\n")
            : null;
        if (text === null) {
          throw new Error(`Unexpected document intent: ${reportRequest.intent}`);
        }
        return {
          identity: reportsAdapterIdentity(reportRequest, "live"),
          reportId: reportRequest.reportId,
          documentId: reportRequest.documentId,
          text,
        };
      },
    };
    const liveRouter = new ApiRouter({
      store: liveStore,
      vault: {
        getAccountScope: async () => "brand-current-day-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      spExecutionContext: createScriptedSpExecutionContextAdapter(
        (marketplaceId) => ({
          marketplaceId,
          mode: "live",
          accountScope: "brand-current-day-scope",
        }),
      ),
      reportsAdapter,
    });

    const started = await liveRouter.handle(request({
      method: "POST",
      path: "/api/sp-api/brand-sales",
      body: {
        marketplaceId: MARKETPLACE_ID,
        startDate: "2026-08-01",
        endDate: "2026-08-09",
      },
    }));
    expect(started.status).toBe(200);
    if (started.body.kind !== "json") throw new Error("Expected job JSON");
    const jobId = String((started.body.value as { jobId: string }).jobId);

    vi.setSystemTime(new Date("2026-08-09T12:30:00.000Z"));
    const readData = () => liveRouter.handle(request({
        method: "GET",
        path: "/api/sp-api/brand-sales",
        query: { marketplaceId: MARKETPLACE_ID, jobId, data: "1" },
      }));
    const [data, concurrentData] = await Promise.all([readData(), readData()]);
    const cachedData = await readData();

    expect(data.status).toBe(200);
    expect(concurrentData.status).toBe(200);
    expect(cachedData.status).toBe(200);
    if (data.body.kind !== "json") throw new Error("Expected snapshot JSON");
    const snapshot = data.body.value as {
      dataThrough: string;
      rangeFreshness: string;
      summary: { amount: number };
      segments: Array<{ key: string; amount: number }>;
      categorySegments: Array<{ key: string; amount: number }>;
    };
    expect(snapshot).toMatchObject({
      dataThrough: "2026-08-09T05:00:00-07:00",
      rangeFreshness: "includes-current-day",
      summary: { amount: 25 },
    });
    expect(snapshot.segments.find(({ key }) => key === "unclassified"))
      .toMatchObject({ amount: 5 });
    expect(snapshot.categorySegments.find(({ key }) => key === "turkey-tendon"))
      .toMatchObject({ amount: 20 });
    expect(snapshot.categorySegments.find(({ key }) => key === "fish"))
      .toMatchObject({ amount: 5 });
    expect(snapshot.categorySegments.reduce((sum, row) => sum + row.amount, 0))
      .toBe(snapshot.summary.amount);
    expect([...documentReads].sort()).toEqual([
      "all-listings",
      "fba-shipment-sales",
    ].sort());
  });
});
