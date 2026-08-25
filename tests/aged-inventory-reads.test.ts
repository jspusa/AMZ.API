import { describe, expect, it, vi } from "vitest";
import {
  AgedInventoryReads,
} from "../src/main/amazon/aged-inventory-reads";
import type {
  ReportsRuntime,
  ReportsRuntimeReceipt,
} from "../src/main/amazon/reports-runtime";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type { MarketplaceId } from "../src/shared/marketplaces";

const US = "ATVPDKIKX0DER" as const;
const JP = "A1VC38T7YXB528" as const;
const REPORT_ID = "report-lease.aged-test";
const DOCUMENT_ID = "report-document.aged-test";
const NOW = new Date("2026-08-25T12:00:00.000Z");

const DETAILED_AGE_HEADERS = [
  "inv-age-0-to-30-days",
  "inv-age-31-to-60-days",
  "inv-age-61-to-90-days",
  "inv-age-91-to-180-days",
  "inv-age-181-to-270-days",
  "inv-age-271-to-365-days",
  "inv-age-366-to-455-days",
  "inv-age-456-plus-days",
] as const;

const GLOBAL_AGE_HEADERS = [
  "sku",
  "inv-age-0-to-90-days",
  "inv-age-91-to-180-days",
  "inv-age-181-to-270-days",
  "inv-age-271-to-365-days",
  "inv-age-365-plus-days",
] as const;

const COMMON_AIS_KEYS = [
  "181-210",
  "211-240",
  "241-270",
  "271-300",
  "301-330",
  "331-365",
] as const;
const GLOBAL_AIS_KEYS = [...COMMON_AIS_KEYS, "365-plus"] as const;

type ReportRecord = Record<string, string | number>;

function reportText(
  headers: readonly string[],
  records: readonly ReportRecord[],
): string {
  return [
    headers.join("\t"),
    ...records.map((record) =>
      headers.map((header) => String(record[header] ?? "")).join("\t"),
    ),
  ].join("\n");
}

function globalAgeRecord(
  sellerSku: string,
  overrides: ReportRecord = {},
): ReportRecord {
  return {
    sku: sellerSku,
    "inv-age-0-to-90-days": 1,
    "inv-age-91-to-180-days": 0,
    "inv-age-181-to-270-days": 0,
    "inv-age-271-to-365-days": 0,
    "inv-age-365-plus-days": 0,
    ...overrides,
  };
}

function aisHeaders(keys: readonly string[]): string[] {
  return keys.flatMap((key) => [
    `quantity-to-be-charged-ais-${key}-days`,
    `estimated-ais-${key}-days`,
  ]);
}

function receipt(mode: "live" | "demo"): ReportsRuntimeReceipt {
  return {
    mode,
    ready: true,
    reportId: REPORT_ID,
    documentId: DOCUMENT_ID,
    status: "DONE",
    notice: "ready",
  };
}

function build(input: Readonly<{
  document: string;
  mode?: "live" | "demo";
  readReceipt?: ReportsRuntimeReceipt | null;
}>) {
  const mode = input.mode ?? "live";
  const context = createScriptedSpExecutionContextAdapter((marketplaceId) => ({
    marketplaceId,
    mode,
    accountScope: "aged-inventory-test-scope",
  }));
  const start = vi.fn<ReportsRuntime["start"]>(async () => receipt(mode));
  const status = vi.fn<ReportsRuntime["status"]>(async () => receipt(mode));
  const read = vi.fn<ReportsRuntime["read"]>(async () =>
    input.readReceipt === undefined ? receipt(mode) : input.readReceipt
  );
  const readDocument = vi.fn<ReportsRuntime["readDocument"]>(async () => ({
    mode,
    text: input.document,
  }));
  const reports = {
    start,
    status,
    read,
    readDocument,
  } as unknown as ReportsRuntime;
  return {
    context,
    start,
    status,
    read,
    readDocument,
    subject: new AgedInventoryReads({
      reports,
      context,
      now: () => new Date(NOW),
    }),
  };
}

async function readLive(
  document: string,
  marketplaceId: MarketplaceId = JP,
) {
  const built = build({ document });
  const snapshot = await built.subject.read({
    marketplaceId,
    reportId: REPORT_ID,
    documentId: DOCUMENT_ID,
  });
  return { ...built, snapshot };
}

describe("AgedInventoryReads", () => {
  it("selects one complete non-overlapping regional schema", async () => {
    const headers = [
      "seller-sku",
      "inv-age-0-to-90-days",
      ...DETAILED_AGE_HEADERS,
      "inv-age-181-to-330-days",
      "inv-age-331-to-365-days",
      "inv-age-365-plus-days",
      "estimated-excess-quantity",
    ];
    const { snapshot } = await readLive(reportText(headers, [{
      "seller-sku": "AGED-FBA-01",
      "inv-age-0-to-90-days": 999,
      "inv-age-0-to-30-days": 80,
      "inv-age-31-to-60-days": 30,
      "inv-age-61-to-90-days": 22,
      "inv-age-91-to-180-days": 9,
      "inv-age-181-to-270-days": 12,
      "inv-age-271-to-365-days": 10,
      "inv-age-366-to-455-days": 7,
      "inv-age-456-plus-days": 2,
      "inv-age-181-to-330-days": 999,
      "inv-age-331-to-365-days": 999,
      "inv-age-365-plus-days": 999,
      "estimated-excess-quantity": 25,
    }]), US);

    expect(snapshot.rows[0]).toMatchObject({
      sellerSku: "AGED-FBA-01",
      totalAgedUnits: 172,
      agedOver180: 31,
      ageBuckets: [
        { key: "0-30", units: 80, over180: false },
        { key: "31-60", units: 30, over180: false },
        { key: "61-90", units: 22, over180: false },
        { key: "91-180", units: 9, over180: false },
        { key: "181-270", units: 12, over180: true },
        { key: "271-365", units: 10, over180: true },
        { key: "366-455", units: 7, over180: true },
        { key: "456-plus", units: 2, over180: true },
      ],
    });
    expect(snapshot.summary).toMatchObject({
      totalAgedUnits: 172,
      agedOver180: 31,
      excessAvailability: "complete",
      estimatedExcessQuantity: 25,
    });
  });

  it("accepts the global 365-plus tail only for a matching marketplace", async () => {
    const document = reportText(GLOBAL_AGE_HEADERS, [
      globalAgeRecord("GLOBAL-AGED", {
        "inv-age-0-to-90-days": 4,
        "inv-age-91-to-180-days": 3,
        "inv-age-365-plus-days": 11,
      }),
    ]);

    await expect(readLive(document, US)).rejects.toMatchObject({
      code: "REPORT_MISMATCH",
      message: expect.stringContaining("區域庫齡欄位與目前站點不一致"),
    });
    await expect(readLive(document, JP)).resolves.toMatchObject({
      snapshot: {
        rows: [{
          sellerSku: "GLOBAL-AGED",
          agedOver180: 11,
          ageBuckets: expect.arrayContaining([
            expect.objectContaining({ key: "365-plus", units: 11 }),
          ]),
        }],
      },
    });
  });

  it("fails closed when a required selected bucket is blank", async () => {
    const document = reportText(GLOBAL_AGE_HEADERS, [{
      ...globalAgeRecord("MISSING-BUCKET"),
      "inv-age-365-plus-days": "",
    }]);

    await expect(readLive(document)).rejects.toMatchObject({
      code: "REPORT_FORMAT_UNSUPPORTED",
      message: expect.stringContaining("「365 天以上（Amazon 欄位）」缺值"),
    });
  });

  it("keeps partial row evidence and counts without partial marketplace totals", async () => {
    const headers = [
      ...GLOBAL_AGE_HEADERS,
      "estimated-excess-quantity",
      "currency",
      "storage-volume",
      "estimated-storage-cost-next-month",
      ...aisHeaders(GLOBAL_AIS_KEYS),
    ];
    const known = globalAgeRecord("KNOWN-EVIDENCE", {
      "estimated-excess-quantity": 7,
      currency: "JPY",
      "storage-volume": 1,
      "estimated-storage-cost-next-month": 1.5,
    });
    const partial = globalAgeRecord("PARTIAL-EVIDENCE", {
      currency: "JPY",
      "storage-volume": 1.25,
    });
    for (const key of GLOBAL_AIS_KEYS) {
      known[`quantity-to-be-charged-ais-${key}-days`] =
        key === "181-210" ? 1 : 0;
      known[`estimated-ais-${key}-days`] = key === "181-210" ? 2 : 0;
      partial[`quantity-to-be-charged-ais-${key}-days`] =
        key === "181-210" ? 1 : 0;
      if (key !== "181-210") partial[`estimated-ais-${key}-days`] = 0;
    }

    const { snapshot } = await readLive(reportText(headers, [known, partial]));

    expect(snapshot.summary).toMatchObject({
      excessAvailability: "partial",
      estimatedExcessQuantity: null,
      excessReportedSkuCount: 1,
      storageCostAvailability: "partial",
      estimatedStorageCostNextMonth: null,
      storageCostReportedSkuCount: 1,
      agedSurchargeAvailability: "partial",
      estimatedAgedSurcharge: null,
      agedSurchargeReportedSkuCount: 1,
      currencyCode: "JPY",
    });
    expect(snapshot.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sellerSku: "KNOWN-EVIDENCE",
        estimatedExcessQuantity: 7,
        estimatedStorageCostNextMonth: 1.5,
        estimatedAgedSurcharge: 2,
      }),
      expect.objectContaining({
        sellerSku: "PARTIAL-EVIDENCE",
        estimatedExcessQuantity: null,
        estimatedStorageCostNextMonth: null,
        estimatedAgedSurcharge: null,
        agedSurchargeBuckets: expect.arrayContaining([
          expect.objectContaining({
            key: "181-210",
            quantity: 1,
            estimatedCharge: null,
          }),
        ]),
      }),
    ]));
  });

  it("uses zero only with an explicit zero basis and never for a missing cost column", async () => {
    const headers = [
      ...GLOBAL_AGE_HEADERS,
      "storage-volume",
      "estimated-storage-cost-next-month",
      ...aisHeaders(GLOBAL_AIS_KEYS),
    ];
    const zeroBasis = globalAgeRecord("ZERO-BASIS", {
      "storage-volume": 0,
    });
    for (const key of GLOBAL_AIS_KEYS) {
      zeroBasis[`quantity-to-be-charged-ais-${key}-days`] = 0;
    }

    const { snapshot } = await readLive(reportText(headers, [zeroBasis]));
    expect(snapshot.rows[0]).toMatchObject({
      estimatedStorageCostNextMonth: 0,
      estimatedAgedSurcharge: 0,
      currencyCode: null,
    });
    expect(snapshot.summary).toMatchObject({
      storageCostAvailability: "complete",
      estimatedStorageCostNextMonth: 0,
      agedSurchargeAvailability: "complete",
      estimatedAgedSurcharge: 0,
    });

    const withoutCostColumn = await readLive(reportText(
      [...GLOBAL_AGE_HEADERS, "storage-volume"],
      [globalAgeRecord("NO-COST-COLUMN", { "storage-volume": 0 })],
    ));
    expect(withoutCostColumn.snapshot.rows[0]?.estimatedStorageCostNextMonth)
      .toBeNull();
    expect(withoutCostColumn.snapshot.summary).toMatchObject({
      storageCostAvailability: "unavailable",
      estimatedStorageCostNextMonth: null,
      storageCostReportedSkuCount: 0,
    });
  });

  it("does not infer a storage or AIS rate from a positive basis", async () => {
    const headers = [
      ...GLOBAL_AGE_HEADERS,
      "currency",
      "storage-volume",
      "estimated-storage-cost-next-month",
      ...aisHeaders(GLOBAL_AIS_KEYS),
    ];
    const record = globalAgeRecord("UNKNOWN-RATE", {
      currency: "JPY",
      "storage-volume": 1.25,
    });
    for (const key of GLOBAL_AIS_KEYS) {
      record[`quantity-to-be-charged-ais-${key}-days`] =
        key === "181-210" ? 1 : 0;
    }

    const { snapshot } = await readLive(reportText(headers, [record]));
    expect(snapshot.rows[0]).toMatchObject({
      estimatedStorageCostNextMonth: null,
      estimatedAgedSurcharge: null,
      agedSurchargeBuckets: expect.arrayContaining([
        expect.objectContaining({
          key: "181-210",
          quantity: 1,
          estimatedCharge: null,
        }),
      ]),
    });
    expect(snapshot.summary).toMatchObject({
      storageCostAvailability: "partial",
      estimatedStorageCostNextMonth: null,
      agedSurchargeAvailability: "partial",
      estimatedAgedSurcharge: null,
    });
  });

  it("preserves missing available as null and rejects rewritten SKU identity", async () => {
    const missingAvailable = reportText(
      [...GLOBAL_AGE_HEADERS, "available"],
      [globalAgeRecord("MISSING-AVAILABLE")],
    );
    await expect(readLive(missingAvailable)).resolves.toMatchObject({
      snapshot: { rows: [{ available: null }] },
    });

    const paddedSku = reportText(GLOBAL_AGE_HEADERS, [
      globalAgeRecord(" PADDED-SKU"),
    ]);
    await expect(readLive(paddedSku)).rejects.toMatchObject({
      code: "REPORT_FORMAT_UNSUPPORTED",
      message: expect.stringContaining("無法原樣辨識 Seller SKU"),
    });
  });

  it("rejects incomplete AIS generations and mixed official currencies", async () => {
    const incompleteAis = reportText(
      [...GLOBAL_AGE_HEADERS, "quantity-to-be-charged-ais-181-210-days"],
      [globalAgeRecord("INCOMPLETE-AIS", {
        "quantity-to-be-charged-ais-181-210-days": 1,
      })],
    );
    await expect(readLive(incompleteAis)).rejects.toMatchObject({
      code: "REPORT_FORMAT_UNSUPPORTED",
      message: expect.stringContaining("AIS 預估附加費欄位不完整"),
    });

    const mixedCurrency = reportText(
      [...GLOBAL_AGE_HEADERS, "currency", "estimated-storage-cost-next-month"],
      [
        globalAgeRecord("USD-ROW", {
          currency: "USD",
          "estimated-storage-cost-next-month": 1,
        }),
        globalAgeRecord("CAD-ROW", {
          currency: "CAD",
          "estimated-storage-cost-next-month": 1,
        }),
      ],
    );
    await expect(readLive(mixedCurrency)).rejects.toMatchObject({
      code: "REPORT_FORMAT_UNSUPPORTED",
      message: expect.stringContaining("包含多種幣別"),
    });
  });

  it("validates demo opaque handles before returning a handle-free snapshot", async () => {
    const mismatched = build({
      document: "",
      mode: "demo",
      readReceipt: {
        ...receipt("demo"),
        reportId: "report-lease.other",
      },
    });
    await expect(mismatched.subject.read({
      marketplaceId: US,
      reportId: REPORT_ID,
      documentId: DOCUMENT_ID,
    })).rejects.toMatchObject({ code: "REPORT_MISMATCH" });
    expect(mismatched.readDocument).not.toHaveBeenCalled();

    const valid = build({ document: "", mode: "demo" });
    const snapshot = await valid.subject.read({
      marketplaceId: US,
      reportId: REPORT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(snapshot).toMatchObject({
      mode: "demo",
      marketplaceId: US,
      fetchedAt: NOW.toISOString(),
      summary: { skuCount: 1, totalAgedUnits: 240 },
    });
    expect(JSON.stringify(snapshot)).not.toContain(REPORT_ID);
    expect(JSON.stringify(snapshot)).not.toContain(DOCUMENT_ID);
    expect(JSON.stringify(snapshot)).not.toContain("aged-inventory-test-scope");
    expect(valid.readDocument).not.toHaveBeenCalled();
  });

  it("owns the fixed intent and forwards the same expected context", async () => {
    const document = reportText(GLOBAL_AGE_HEADERS, [
      globalAgeRecord("CONTEXT-ROW"),
    ]);
    const built = build({ document });
    const expectedContext = await built.context.capture(JP);
    const capture = vi.spyOn(built.context, "capture");

    await built.subject.begin({
      marketplaceId: JP,
      explicitRetry: true,
      freshCompleted: true,
      expectedContext,
    });
    await built.subject.status({
      marketplaceId: JP,
      reportId: REPORT_ID,
      expectedContext,
    });
    await built.subject.read({
      marketplaceId: JP,
      reportId: REPORT_ID,
      documentId: DOCUMENT_ID,
      expectedContext,
    });

    expect(capture).not.toHaveBeenCalled();
    expect(built.start).toHaveBeenCalledWith(
      {
        intent: "aged-inventory",
        marketplaceId: JP,
        signal: undefined,
      },
      {
        explicitRetry: true,
        freshCompleted: true,
        expectedContext,
      },
    );
    expect(built.status.mock.calls[0]?.[2]).toBe(expectedContext);
    expect(built.readDocument.mock.calls[0]?.[2]).toBe(expectedContext);
    expect(built.status.mock.calls[0]?.[0]).toEqual({
      intent: "aged-inventory",
      marketplaceId: JP,
      signal: undefined,
    });
    expect(built.readDocument.mock.calls[0]?.[0]).toEqual({
      intent: "aged-inventory",
      marketplaceId: JP,
      signal: undefined,
    });
  });
});
