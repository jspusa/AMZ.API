import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { invalidateSpApiCredentialCaches } from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import AgedInventoryPanel, {
  AgedInventoryTierOverview,
  aggregateAgeBuckets,
  aggregateAgedSurchargeBuckets,
  formatAgedInventoryMoney,
  parseAgedInventorySnapshot,
} from "../src/renderer/src/components/aged-inventory-panel";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const savedSpEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);

function clearSpEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SP_API_")) delete process.env[key];
  }
}

function request(input: {
  method: ApiRequest["method"];
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): ApiRequest {
  return {
    requestId: `aged-${input.method.toLowerCase()}-001`,
    method: input.method,
    path: "/api/sp-api/aged-inventory",
    query: input.query ?? {},
    headers: {},
    body: input.body ? { kind: "json", value: input.body } : undefined,
  };
}

describe("FBA aged inventory renderer and read-only route", () => {
  let router: ApiRouter;

  beforeEach(async () => {
    clearSpEnvironment();
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
    const directory = await mkdtemp(join(tmpdir(), "aged-inventory-route-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    router = new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => "demo-aged-account"),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
  });

  afterEach(() => {
    clearSpEnvironment();
    for (const [key, value] of savedSpEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
    invalidateSpApiCredentialCaches();
  });

  it("shows a visible compact main-page entry for every age bucket, official fees, and Excel", () => {
    const markup = renderToStaticMarkup(
      <AgedInventoryPanel marketplaceId={MARKETPLACE_ID} marketplaceShort="US" />,
    );

    expect(markup).toContain("FBA 庫齡、冗餘與官方預估費用");
    expect(markup).toContain("開始 FBA 180 天以上庫齡健檢");
    expect(markup).toContain("全部非重疊庫齡桶");
    expect(markup).toContain(
      "任一 SKU 缺值時只保留逐列證據，不顯示部分全站合計",
    );
    expect(formatAgedInventoryMoney(1.5, "JPY")).toMatch(/1[.,]5/u);
  });

  it("aggregates every US age and AIS tier while preserving partial quantity and fee coverage", () => {
    const ageDefinitions = [
      ["0-30", "0–30 天", false],
      ["31-60", "31–60 天", false],
      ["61-90", "61–90 天", false],
      ["91-180", "91–180 天", false],
      ["181-270", "181–270 天", true],
      ["271-365", "271–365 天", true],
      ["366-455", "366–455 天", true],
      ["456-plus", "456 天以上", true],
    ] as const;
    const surchargeDefinitions = [
      ["181-210", "AIS 181–210 天"],
      ["211-240", "AIS 211–240 天"],
      ["241-270", "AIS 241–270 天"],
      ["271-300", "AIS 271–300 天"],
      ["301-330", "AIS 301–330 天"],
      ["331-365", "AIS 331–365 天"],
      ["366-455", "AIS 366–455 天"],
      ["456-plus", "AIS 456 天以上"],
    ] as const;
    const rows = [
      {
        ageBuckets: ageDefinitions.map(([key, label, over180], index) => ({
          key,
          label,
          over180,
          units: 8 - index,
        })),
        agedSurchargeBuckets: surchargeDefinitions.map(([key, label], index) => ({
          key,
          label,
          quantity: index === 0 ? 3 : index === 1 ? null : 0,
          estimatedCharge: index === 0 ? 1.2 : index === 1 ? null : 0,
        })),
      },
      {
        ageBuckets: ageDefinitions.map(([key, label, over180], index) => ({
          key,
          label,
          over180,
          units: index + 2,
        })),
        agedSurchargeBuckets: surchargeDefinitions.map(([key, label], index) => ({
          key,
          label,
          quantity: index === 0 ? 2 : index === 1 ? 1 : null,
          estimatedCharge: index === 0 ? 0.8 : null,
        })),
      },
    ];

    expect(aggregateAgeBuckets(rows)).toEqual(
      ageDefinitions.map(([key, label, over180]) => ({
        key,
        label,
        over180,
        units: 10,
        reportedSkuCount: 2,
        totalSkuCount: 2,
      })),
    );
    const surchargeOverview = aggregateAgedSurchargeBuckets(rows);
    expect(surchargeOverview).toHaveLength(8);
    expect(surchargeOverview[0]).toEqual({
      key: "181-210",
      label: "AIS 181–210 天",
      quantity: 5,
      quantityReportedSkuCount: 2,
      estimatedCharge: 2,
      chargeReportedSkuCount: 2,
      totalSkuCount: 2,
    });
    expect(surchargeOverview[1]).toEqual({
      key: "211-240",
      label: "AIS 211–240 天",
      quantity: null,
      quantityReportedSkuCount: 1,
      estimatedCharge: null,
      chargeReportedSkuCount: 0,
      totalSkuCount: 2,
    });
    expect(surchargeOverview[2]).toMatchObject({
      quantity: null,
      quantityReportedSkuCount: 1,
      estimatedCharge: null,
      chargeReportedSkuCount: 1,
      totalSkuCount: 2,
    });

    const markup = renderToStaticMarkup(
      <AgedInventoryTierOverview rows={rows} currencyCode="USD" />,
    );
    expect(markup).toContain("全部 FBA 庫齡分層");
    expect(markup).toContain("AIS 官方預估計費分層");
    expect(markup).toContain("已回傳 1／2 SKU");
    expect(markup).toContain("不反推或猜測每件費率");
    expect(markup).toContain("部分回傳只保留逐 SKU 證據與回傳筆數");
    expect(markup).toContain("US$2.00");
  });

  it("fails closed on unsafe complete tier aggregates", () => {
    const surchargeRow = (
      quantity: number | null,
      estimatedCharge: number | null,
    ) => ({
      agedSurchargeBuckets: [{
        key: "181-210",
        label: "AIS 181–210 天",
        quantity,
        estimatedCharge,
      }],
    });

    expect(() => aggregateAgedSurchargeBuckets([
      surchargeRow(Number.MAX_SAFE_INTEGER, 0),
      surchargeRow(1, 0),
    ])).toThrow("安全範圍");

    expect(() => aggregateAgedSurchargeBuckets([
      surchargeRow(0, 90_071_992_547_409),
      surchargeRow(0, 0.01),
    ])).toThrow("安全範圍");

    expect(aggregateAgedSurchargeBuckets([
      surchargeRow(Number.MAX_SAFE_INTEGER, 90_071_992_547_409),
      surchargeRow(1, 1),
      surchargeRow(null, null),
    ])).toEqual([expect.objectContaining({
      quantity: null,
      quantityReportedSkuCount: 2,
      estimatedCharge: null,
      chargeReportedSkuCount: 2,
      totalSkuCount: 3,
    })]);
  });

  it("validates every row, accepts the installed old-main export reference, and verifies the server summary", () => {
    const raw = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-08T00:00:00.000Z",
      exportId: "11111111-1111-4111-8111-111111111111",
      rows: [
        {
          sellerSku: "AGED-FBA-01",
          fnSku: "X001AGED01",
          asin: "B0AGED0001",
          title: "Aged FBA product",
          condition: "New",
          available: 240,
          totalAgedUnits: 50,
          agedOver180: 31,
          ageBuckets: [
            { key: "0-90", label: "0–90 天", units: 10, over180: false },
            { key: "91-180", label: "91–180 天", units: 9, over180: false },
            { key: "181-270", label: "181–270 天", units: 12, over180: true },
            { key: "271-365", label: "271–365 天", units: 10, over180: true },
            { key: "366-455", label: "366–455 天", units: 7, over180: true },
            { key: "456-plus", label: "456 天以上", units: 2, over180: true },
          ],
          estimatedExcessQuantity: 25,
          recommendedRemovalQuantity: 5,
          daysOfSupply: 220.5,
          currencyCode: "USD",
          estimatedStorageCostNextMonth: 15.25,
          estimatedAgedSurcharge: 3.6,
          agedSurchargeBuckets: [
            {
              key: "181-210",
              label: "AIS 181–210 天",
              quantity: 3,
              estimatedCharge: 1.2,
            },
            {
              key: "211-240",
              label: "AIS 211–240 天",
              quantity: 4,
              estimatedCharge: 2.4,
            },
          ],
          alert: "Amazon raw alert",
          recommendedAction: "Create sale",
          snapshotDate: "2026-08-07",
        },
      ],
      summary: {
        skuCount: 1,
        agedOver180SkuCount: 1,
        totalAgedUnits: 50,
        agedOver180: 31,
        excessAvailability: "complete",
        estimatedExcessQuantity: 25,
        excessReportedSkuCount: 1,
        currencyCode: "USD",
        storageCostAvailability: "complete",
        estimatedStorageCostNextMonth: 15.25,
        storageCostReportedSkuCount: 1,
        agedSurchargeAvailability: "complete",
        estimatedAgedSurcharge: 3.6,
        agedSurchargeReportedSkuCount: 1,
      },
      expiration: {
        currentFbaExpirationDatesAvailable: false,
        nearExpiryUnits: null,
        expiredUnits: null,
        inboundPlanExpirationDatesAvailable: true,
        notice: "Inbound dates cannot prove current FC batches.",
      },
      notice: "FBA only",
    };

    expect(parseAgedInventorySnapshot(raw, MARKETPLACE_ID)).toMatchObject({
      workbookDownloadUrl:
        "/api/sp-api/aged-inventory?marketplaceId=ATVPDKIKX0DER&exportId=11111111-1111-4111-8111-111111111111&download=1",
      summary: {
        skuCount: 1,
        totalAgedUnits: 50,
        agedOver180: 31,
        estimatedExcessQuantity: 25,
        estimatedStorageCostNextMonth: 15.25,
        estimatedAgedSurcharge: 3.6,
      },
    });
    const installedMainSnapshot = parseAgedInventorySnapshot({
      ...raw,
      exportId: undefined,
      reportId: "legacy-report-1",
      documentId: "amzn1.spdoc.legacy-document-1",
    }, MARKETPLACE_ID);
    expect(installedMainSnapshot).toMatchObject({
      workbookDownloadUrl:
        "/api/sp-api/aged-inventory?marketplaceId=ATVPDKIKX0DER&reportId=legacy-report-1&documentId=amzn1.spdoc.legacy-document-1&download=1",
    });
    expect(installedMainSnapshot).not.toHaveProperty("reportId");
    expect(installedMainSnapshot).not.toHaveProperty("documentId");
    expect(() =>
      parseAgedInventorySnapshot(
        { ...raw, summary: { ...raw.summary, agedOver180: 30 } },
        MARKETPLACE_ID,
      ),
    ).toThrow("摘要與商品列不一致");
    expect(() =>
      parseAgedInventorySnapshot(
        {
          ...raw,
          rows: [{ ...raw.rows[0], estimatedAgedSurcharge: 3.5 }],
        },
        MARKETPLACE_ID,
      ),
    ).toThrow("AIS 預估附加費分層與合計不一致");

    const partialExcess = {
      ...raw,
      rows: [
        raw.rows[0],
        {
          ...raw.rows[0],
          sellerSku: "AGED-FBA-UNKNOWN",
          fnSku: "X001UNKNOWN",
          asin: "B0UNKNOWN01",
          estimatedExcessQuantity: null,
          estimatedStorageCostNextMonth: null,
          estimatedAgedSurcharge: null,
          agedSurchargeBuckets: raw.rows[0].agedSurchargeBuckets.map(
            (bucket, index) => ({
              ...bucket,
              estimatedCharge: index === 0 ? null : bucket.estimatedCharge,
            }),
          ),
        },
      ],
      summary: {
        ...raw.summary,
        skuCount: 2,
        agedOver180SkuCount: 2,
        totalAgedUnits: 100,
        agedOver180: 62,
        excessAvailability: "partial",
        estimatedExcessQuantity: null,
        excessReportedSkuCount: 1,
        storageCostAvailability: "partial",
        estimatedStorageCostNextMonth: null,
        storageCostReportedSkuCount: 1,
        agedSurchargeAvailability: "partial",
        estimatedAgedSurcharge: null,
        agedSurchargeReportedSkuCount: 1,
      },
    };
    expect(parseAgedInventorySnapshot(partialExcess, MARKETPLACE_ID)).toMatchObject({
      summary: {
        excessAvailability: "partial",
        estimatedExcessQuantity: null,
        storageCostAvailability: "partial",
        estimatedStorageCostNextMonth: null,
        agedSurchargeAvailability: "partial",
        estimatedAgedSurcharge: null,
      },
    });
    expect(() =>
      parseAgedInventorySnapshot(
        {
          ...partialExcess,
          summary: {
            ...partialExcess.summary,
            estimatedExcessQuantity: 25,
          },
        },
        MARKETPLACE_ID,
      ),
    ).toThrow("摘要與商品列不一致");
    expect(() =>
      parseAgedInventorySnapshot(
        {
          ...partialExcess,
          summary: {
            ...partialExcess.summary,
            estimatedStorageCostNextMonth: 15.25,
          },
        },
        MARKETPLACE_ID,
      ),
    ).toThrow("摘要與商品列不一致");
    expect(() =>
      parseAgedInventorySnapshot(
        {
          ...partialExcess,
          summary: {
            ...partialExcess.summary,
            estimatedAgedSurcharge: 3.6,
          },
        },
        MARKETPLACE_ID,
      ),
    ).toThrow("摘要與商品列不一致");
  });

  it("starts, reads, and rejects mutations through the local FBA-only API", async () => {
    const started = await router.handle(
      request({ method: "POST", body: { marketplaceId: MARKETPLACE_ID } }),
    );
    expect(started.status).toBe(200);
    expect(started.body.kind).toBe("json");
    if (started.body.kind !== "json") throw new Error("Expected JSON response");
    const report = started.body.value as { reportId: string; documentId: string };

    const loaded = await router.handle(
      request({
        method: "GET",
        query: {
          marketplaceId: MARKETPLACE_ID,
          reportId: report.reportId,
          documentId: report.documentId,
          data: "1",
        },
      }),
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body.kind).toBe("json");
    if (loaded.body.kind !== "json") throw new Error("Expected JSON response");
    expect(loaded.body.value).toMatchObject({
      mode: "demo",
      marketplaceId: MARKETPLACE_ID,
      summary: {
        skuCount: 1,
        totalAgedUnits: 240,
        agedOver180: 108,
        excessAvailability: "complete",
        storageCostAvailability: "unavailable",
        agedSurchargeAvailability: "unavailable",
      },
      expiration: {
        currentFbaExpirationDatesAvailable: false,
        nearExpiryUnits: null,
        expiredUnits: null,
      },
      notice: expect.stringContaining("不會自動建立促銷或移除訂單"),
    });

    const exported = await router.handle(
      request({
        method: "GET",
        query: {
          marketplaceId: MARKETPLACE_ID,
          reportId: report.reportId,
          documentId: report.documentId,
          download: "1",
        },
      }),
    );
    expect(exported.status).toBe(200);
    expect(exported.body.kind).toBe("bytes");
    if (exported.body.kind !== "bytes") throw new Error("Expected XLSX bytes");
    expect(Array.from(exported.body.value.slice(0, 2))).toEqual([0x50, 0x4b]);
    expect(exported.headers?.["content-disposition"]).toContain(
      "amazon-fba-inventory-age-us-",
    );
    expect(exported.headers?.["x-exported-fba-sku-count"]).toBe("1");

    const mutation = await router.handle(request({ method: "PATCH" }));
    expect(mutation.status).toBe(404);
  });
});
