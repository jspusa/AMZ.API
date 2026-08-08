import { unzipSync } from "fflate";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { invalidateSpApiCredentialCaches } from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const savedMode = process.env.SP_API_MODE;

function request(input: {
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): ApiRequest {
  return {
    requestId: `unbound-variation-${input.method.toLowerCase()}-001`,
    method: input.method,
    path: "/api/sp-api/variation-audit",
    query: input.query ?? {},
    headers: input.body ? { "content-type": "application/json" } : {},
    body: input.body ? { kind: "json", value: input.body } : undefined,
  };
}

describe("unbound variation audit router", () => {
  let router: ApiRouter;

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
    const directory = await mkdtemp(join(tmpdir(), "unbound-router-store-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "unbound-variation-test-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = savedMode;
    invalidateSpApiCredentialCaches();
  });

  it("starts, scans and exports one account-scoped FBA-only snapshot", async () => {
    const start = await router.handle(request({
      method: "POST",
      body: { marketplaceId: MARKETPLACE_ID },
    }));
    expect(start.status).toBe(200);
    expect(start.body.kind).toBe("json");
    if (start.body.kind !== "json") throw new Error("Expected JSON start response");
    const report = start.body.value as { reportId: string; documentId: string };

    const data = await router.handle(request({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        reportId: report.reportId,
        documentId: report.documentId,
        data: "1",
      },
    }));
    expect(data.status).toBe(200);
    expect(data.body.kind).toBe("json");
    if (data.body.kind !== "json") throw new Error("Expected JSON data response");
    const snapshot = data.body.value as {
      exportId: string;
      summary: { totalFbaListings: number; unbound: number; incomplete: number };
    };
    expect(snapshot.exportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.summary.totalFbaListings).toBeGreaterThan(0);
    expect(snapshot.summary.unbound).toBeGreaterThan(0);
    expect(snapshot.summary.incomplete).toBe(0);

    const exported = await router.handle(request({
      method: "GET",
      query: {
        marketplaceId: MARKETPLACE_ID,
        exportId: snapshot.exportId,
        download: "1",
      },
    }));
    expect(exported.status).toBe(200);
    expect(exported.body.kind).toBe("bytes");
    if (exported.body.kind !== "bytes") throw new Error("Expected XLSX bytes");
    const archive = unzipSync(exported.body.value);
    const workbook = new TextDecoder().decode(archive["xl/workbook.xml"]);
    expect(workbook).toContain("未綁變體");
    expect(workbook).toContain("讀取未完成");
    expect(exported.headers["x-exported-unbound-fba-sku-count"]).toBe(
      String(snapshot.summary.unbound),
    );
  });

  it("rejects missing report and export identifiers", async () => {
    expect((await router.handle(request({
      method: "GET",
      query: { marketplaceId: MARKETPLACE_ID, data: "1" },
    }))).status).toBe(400);
    expect((await router.handle(request({
      method: "GET",
      query: { marketplaceId: MARKETPLACE_ID, download: "1" },
    }))).status).toBe(400);
  });
});
