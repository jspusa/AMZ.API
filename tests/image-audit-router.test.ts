import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const previousMode = process.env.SP_API_MODE;
const MARKETPLACE_ID = "ATVPDKIKX0DER";

function request(query: Record<string, string>): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path: "/api/sp-api/listing-content/export",
    query,
    headers: {},
  };
}

async function startReadyReport(router: ApiRouter): Promise<{
  reportId: string;
  documentId: string;
}> {
  const response = await router.handle({
    requestId: crypto.randomUUID(),
    method: "POST",
    path: "/api/sp-api/listing-content/export",
    query: {},
    headers: {},
    body: {
      kind: "json",
      value: { marketplaceId: MARKETPLACE_ID },
    },
  });
  if (response.status !== 200 || response.body.kind !== "json") {
    throw new Error("Expected a ready demo report");
  }
  const value = response.body.value as Record<string, unknown>;
  if (typeof value.reportId !== "string" || typeof value.documentId !== "string") {
    throw new Error("Expected opaque report document handles");
  }
  return { reportId: value.reportId, documentId: value.documentId };
}

describe("FBA image audit snapshot export route", () => {
  let router: ApiRouter;

  beforeEach(async () => {
    process.env.SP_API_MODE = "demo";
    const directory = await mkdtemp(join(tmpdir(), "amz-image-audit-router-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: async () => "demo-account-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
  });

  afterEach(() => {
    router.clearPreviews();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("downloads all FBA rows from the same marketplace/report snapshot", async () => {
    const report = await startReadyReport(router);
    const baseQuery = {
      marketplaceId: MARKETPLACE_ID,
      reportId: report.reportId,
      documentId: report.documentId,
      imageAudit: "1",
    };
    const audit = await router.handle(request(baseQuery));
    expect(audit.status).toBe(200);
    expect(audit.body.kind).toBe("json");
    if (audit.body.kind !== "json") throw new Error("Expected audit JSON");
    const snapshot = audit.body.value as {
      exportId: string;
      minimumImages: number;
      rows: Array<{ sellerSku: string }>;
      summary: { total: number; underMinimum: number; incomplete: number };
    };
    expect(snapshot.minimumImages).toBe(6);

    const response = await router.handle(
      request({
        marketplaceId: MARKETPLACE_ID,
        imageAudit: "1",
        download: "1",
        exportId: snapshot.exportId,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(response.headers["x-exported-fba-sku-count"]).toBe(
      String(snapshot.summary.total),
    );
    expect(response.headers["x-image-audit-under-minimum-count"]).toBe(
      String(snapshot.summary.underMinimum),
    );
    expect(response.headers["x-image-audit-incomplete-count"]).toBe(
      String(snapshot.summary.incomplete),
    );
    expect(response.body.kind).toBe("bytes");
    if (response.body.kind !== "bytes") throw new Error("Expected XLSX bytes");
    const archive = unzipSync(response.body.value);
    const workbook = strFromU8(archive["xl/workbook.xml"]!);
    const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]!);
    const notes = strFromU8(archive["xl/worksheets/sheet2.xml"]!);
    expect(workbook).toContain("圖片健檢");
    for (const row of snapshot.rows) expect(sheet).toContain(row.sellerSku);
    expect(sheet).toContain(MARKETPLACE_ID);
    expect(notes).toContain("同一份 Amazon 全商品報表快照");
    expect(notes).toContain("至少 6 張圖片");
    expect(notes).toContain("不含 FBM");
  });

  it("binds the download to the stored marketplace snapshot instead of report ids", async () => {
    const report = await startReadyReport(router);
    const audit = await router.handle(
      request({
        marketplaceId: MARKETPLACE_ID,
        reportId: report.reportId,
        documentId: report.documentId,
        imageAudit: "1",
      }),
    );
    if (audit.body.kind !== "json") throw new Error("Expected audit JSON");
    const exportId = (audit.body.value as { exportId: string }).exportId;

    const wrongMarket = await router.handle(
      request({
        marketplaceId: "A2EUQ1WTGCTBG2",
        imageAudit: "1",
        download: "1",
        exportId,
      }),
    );
    expect(wrongMarket.status).toBe(410);

    const reportOnly = await router.handle(
      request({
        marketplaceId: MARKETPLACE_ID,
        reportId: report.reportId,
        documentId: report.documentId,
        imageAudit: "1",
        download: "1",
      }),
    );
    expect(reportOnly.status).toBe(400);
  });
});
