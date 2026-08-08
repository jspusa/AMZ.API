import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiRouter } from "../src/main/api-router";
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
      listingReportId?: unknown;
    };
    expect(job).toMatchObject({
      ready: true,
      status: "DONE",
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });
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
      schemaVersion: 1,
      mode: "demo",
      marketplaceId: MARKETPLACE_ID,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT",
    });
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
});
