import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const previousMode = process.env.SP_API_MODE;
const MARKETPLACE_ID = "ATVPDKIKX0DER";
const REPORT_ID = `demo-${MARKETPLACE_ID}`;

function request(query: Record<string, string>): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path: "/api/sp-api/listing-content/export",
    query,
    headers: {},
  };
}

describe("FBA image audit snapshot export route", () => {
  let router: ApiRouter;

  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
    router = new ApiRouter({
      store: {} as LocalStore,
      vault: {
        getAccountScope: async () => "demo-account-scope",
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("downloads all FBA rows from the same marketplace/report snapshot", async () => {
    const baseQuery = {
      marketplaceId: MARKETPLACE_ID,
      reportId: REPORT_ID,
      documentId: REPORT_ID,
      imageAudit: "1",
    };
    const audit = await router.handle(request(baseQuery));
    expect(audit.status).toBe(200);
    expect(audit.body.kind).toBe("json");
    if (audit.body.kind !== "json") throw new Error("Expected audit JSON");
    const snapshot = audit.body.value as {
      exportId: string;
      rows: Array<{ sellerSku: string }>;
      summary: { total: number; underMinimum: number; incomplete: number };
    };

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
    expect(notes).toContain("不含 FBM");
  });

  it("binds the download to the stored marketplace snapshot instead of report ids", async () => {
    const audit = await router.handle(
      request({
        marketplaceId: MARKETPLACE_ID,
        reportId: REPORT_ID,
        documentId: REPORT_ID,
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
        reportId: REPORT_ID,
        documentId: REPORT_ID,
        imageAudit: "1",
        download: "1",
      }),
    );
    expect(reportOnly.status).toBe(400);
  });
});
