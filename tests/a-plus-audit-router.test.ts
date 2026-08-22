import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { AplusAuditJobGateway } from "../src/main/amazon/a-plus-audit-job";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER";
const previousMode = process.env.SP_API_MODE;

function request(
  method: "GET" | "POST",
  input: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path: "/api/sp-api/a-plus-audit",
    query: method === "GET" ? input as Record<string, string> : {},
    headers: {},
    ...(method === "POST"
      ? { body: { kind: "json" as const, value: input } }
      : {}),
  };
}

function payload(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON");
  return response.body.value as Record<string, unknown>;
}

async function terminal(
  router: ApiRouter,
  receipt: Record<string, unknown>,
): Promise<ApiResponse> {
  const identity = {
    marketplaceId: String(receipt.marketplaceId),
    mode: String(receipt.mode),
    jobId: String(receipt.jobId),
    contextId: String(receipt.contextId),
  };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await router.handle(request("GET", identity));
    if (response.status !== 202) return response;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("A+ job did not finish");
}

describe("main-owned A+ audit routes", () => {
  let router: ApiRouter;
  let accountScope: string;
  let fetchPublishRecords: AplusAuditJobGateway["fetchPublishRecords"];

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    accountScope = "account-scope-a-plus-one";
    fetchPublishRecords = vi.fn(async ({ request: item }) => ({
      status: 200,
      payload: {
        publishRecordList: [{
          marketplaceId: US,
          asin: item.asin,
          contentReferenceKey: "internal-record-key-must-not-leak",
          contentType: "EBC",
          locale: "en-US",
        }],
      },
    }));
    const directory = await mkdtemp(join(tmpdir(), "a-plus-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => accountScope),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
      aplusAudit: {
        loadFbaSeeds: async () => ({
          fetchedAt: "2026-08-23T09:00:00.000Z",
          fbaSnapshotId: "internal-fba-snapshot-must-not-leak",
          rows: [
            { sellerSku: "A-PLUS-SKU-1", asin: "B000000001", title: "One" },
            { sellerSku: "A-PLUS-SKU-2", asin: "B000000001", title: "Two" },
            { sellerSku: "A-PLUS-SKU-3", asin: null, title: "Unknown" },
          ],
        }),
        fetchPublishRecords,
      },
    });
  });

  afterEach(() => {
    router?.clearPreviews();
    vi.unstubAllGlobals();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("single-flights a background scan, dedupes ASIN and exposes only the strict public snapshot", async () => {
    const first = await router.handle(request("POST", {
      marketplaceId: US,
      mode: "demo",
    }));
    const second = await router.handle(request("POST", {
      marketplaceId: US,
      mode: "demo",
    }));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(payload(second)).toMatchObject({
      jobId: payload(first).jobId,
      contextId: payload(first).contextId,
    });

    const completed = await terminal(router, payload(first));
    expect(completed.status).toBe(200);
    expect(payload(completed)).toMatchObject({
      ready: true,
      status: "completed",
      progress: { completedAsins: 1, totalAsins: 1 },
      snapshot: {
        mode: "demo",
        marketplaceId: US,
        summary: { published: 2, incomplete: 1, uniqueAsins: 1 },
      },
    });
    expect(fetchPublishRecords).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(payload(completed));
    expect(serialized).not.toMatch(/account-scope|fba-snapshot|record-key|reportId/iu);
  });

  it("rejects renderer context injection, mode drift, identity drift and account drift", async () => {
    const injected = await router.handle(request("POST", {
      marketplaceId: US,
      mode: "demo",
      accountScope: "renderer-supplied",
    }));
    expect(injected.status).toBe(400);

    const wrongMode = await router.handle(request("POST", {
      marketplaceId: US,
      mode: "live",
    }));
    expect(wrongMode.status).toBe(409);

    const started = await router.handle(request("POST", {
      marketplaceId: US,
      mode: "demo",
    }));
    const wrongContext = await router.handle(request("GET", {
      marketplaceId: US,
      mode: "demo",
      jobId: String(payload(started).jobId),
      contextId: crypto.randomUUID(),
    }));
    expect(wrongContext.status).toBe(410);

    accountScope = "account-scope-a-plus-two";
    const changedAccount = await router.handle(request("GET", {
      marketplaceId: US,
      mode: "demo",
      jobId: String(payload(started).jobId),
      contextId: String(payload(started).contextId),
    }));
    expect(changedAccount.status).toBe(409);
  });

  it("clears the main-owned job with credential lifecycle cleanup", async () => {
    const started = await router.handle(request("POST", {
      marketplaceId: US,
      mode: "demo",
    }));
    router.clearPreviews();
    const response = await router.handle(request("GET", {
      marketplaceId: US,
      mode: "demo",
      jobId: String(payload(started).jobId),
      contextId: String(payload(started).contextId),
    }));
    expect(response.status).toBe(410);
  });

  it("runs the production gateway in demo mode without any network request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const directory = await mkdtemp(join(tmpdir(), "a-plus-router-demo-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router.clearPreviews();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => accountScope),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });

    const started = await router.handle(request("POST", {
      marketplaceId: US,
      mode: "demo",
    }));
    const completed = await terminal(router, payload(started));

    expect(completed.status).toBe(200);
    expect(payload(completed)).toMatchObject({
      ready: true,
      status: "completed",
      snapshot: { mode: "demo", marketplaceId: US },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
