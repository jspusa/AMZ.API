import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import {
  getAgedInventoryReportStatus,
  invalidateSpApiCredentialCaches,
  parseAgedInventoryReportData,
  parseAgedInventoryReportDocument,
  startAgedInventoryReport,
} from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import AgedInventoryPanel, {
  AgedInventoryTierOverview,
  aggregateAgeBuckets,
  aggregateAgedSurchargeBuckets,
  formatAgedInventoryMoney,
  parseAgedInventorySnapshot,
} from "../src/renderer/src/components/aged-inventory-panel";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const REPORT_ID = "TEST_AGED_REPORT_ID";
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input));
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

const COMMON_AIS_KEYS = [
  "181-210",
  "211-240",
  "241-270",
  "271-300",
  "301-330",
  "331-365",
] as const;
const REGIONAL_AIS_KEYS = [...COMMON_AIS_KEYS, "366-455", "456-plus"] as const;

function reportText(
  headers: readonly string[],
  records: Array<Record<string, string | number>>,
): string {
  return [
    headers.join("\t"),
    ...records.map((record) =>
      headers.map((header) => String(record[header] ?? "")).join("\t"),
    ),
  ].join("\n");
}

describe("official FBA 180+ day inventory report", () => {
  beforeEach(() => {
    clearSpEnvironment();
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSpEnvironment();
    for (const [key, value] of savedSpEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
    invalidateSpApiCredentialCaches();
  });

  it("parses every non-overlapping age bucket and official fee field without dropping fresh FBA rows", () => {
    const headers = [
      "seller-sku",
      "fnsku",
      "asin",
      "product-name",
      "condition",
      "available",
      "inv-age-0-to-90-days",
      ...DETAILED_AGE_HEADERS,
      "inv-age-181-to-330-days",
      "inv-age-331-to-365-days",
      "inv-age-365-plus-days",
      "estimated-excess-quantity",
      "recommended-removal-quantity",
      "days-of-supply",
      "currency",
      "estimated-storage-cost-next-month",
      ...REGIONAL_AIS_KEYS.flatMap((key) => [
        `quantity-to-be-charged-ais-${key}-days`,
        `estimated-ais-${key}-days`,
      ]),
      "alert",
      "recommended-action",
      "snapshot-date",
    ];
    const aged: Record<string, string | number> = {
      "seller-sku": "AGED-FBA-01",
      fnsku: "X001AGED01",
      asin: "B0AGED0001",
      "product-name": "Aged FBA product",
      condition: "New",
      available: 240,
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
      "recommended-removal-quantity": 5,
      "days-of-supply": 220.5,
      currency: "USD",
      "estimated-storage-cost-next-month": 15.25,
      alert: "Amazon raw alert",
      "recommended-action": "Create sale",
      "snapshot-date": "2026-08-07",
    };
    const fresh: Record<string, string | number> = {
      "seller-sku": "FRESH-FBA-01",
      fnsku: "X001FRESH1",
      asin: "B0FRESH001",
      "product-name": "Fresh FBA product",
      condition: "New",
      available: 80,
      "inv-age-0-to-90-days": 999,
      "inv-age-0-to-30-days": 80,
      "inv-age-31-to-60-days": 0,
      "inv-age-61-to-90-days": 0,
      "inv-age-91-to-180-days": 0,
      "inv-age-181-to-270-days": 0,
      "inv-age-271-to-365-days": 0,
      "inv-age-366-to-455-days": 0,
      "inv-age-456-plus-days": 0,
      "inv-age-181-to-330-days": 999,
      "inv-age-331-to-365-days": 999,
      "inv-age-365-plus-days": 999,
      "estimated-excess-quantity": 0,
      "recommended-removal-quantity": 0,
      "days-of-supply": 35,
      currency: "USD",
      "estimated-storage-cost-next-month": 5,
      alert: "",
      "recommended-action": "",
      "snapshot-date": "2026-08-07",
    };
    REGIONAL_AIS_KEYS.forEach((key, index) => {
      aged[`quantity-to-be-charged-ais-${key}-days`] = index + 1;
      aged[`estimated-ais-${key}-days`] = (index + 1) / 10;
      fresh[`quantity-to-be-charged-ais-${key}-days`] = 0;
      fresh[`estimated-ais-${key}-days`] = 0;
    });

    const parsed = parseAgedInventoryReportData(
      reportText(headers, [aged, fresh]),
    );

    expect(parsed).toMatchObject({
      ageBucketKeys: [
        "0-30",
        "31-60",
        "61-90",
        "91-180",
        "181-270",
        "271-365",
        "366-455",
        "456-plus",
      ],
      agedSurchargeBucketKeys: REGIONAL_AIS_KEYS,
      excessAvailability: "complete",
      storageCostAvailability: "complete",
      agedSurchargeAvailability: "complete",
      currencyCode: "USD",
    });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      sellerSku: "AGED-FBA-01",
      available: 240,
      totalAgedUnits: 172,
      agedOver180: 31,
      estimatedExcessQuantity: 25,
      recommendedRemovalQuantity: 5,
      daysOfSupply: 220.5,
      estimatedStorageCostNextMonth: 15.25,
      estimatedAgedSurcharge: 3.6,
      alert: "Amazon raw alert",
    });
    expect(parsed.rows[0].ageBuckets).toEqual([
      { key: "0-30", label: "0–30 天", units: 80, over180: false },
      { key: "31-60", label: "31–60 天", units: 30, over180: false },
      { key: "61-90", label: "61–90 天", units: 22, over180: false },
      { key: "91-180", label: "91–180 天", units: 9, over180: false },
      { key: "181-270", label: "181–270 天", units: 12, over180: true },
      { key: "271-365", label: "271–365 天", units: 10, over180: true },
      { key: "366-455", label: "366–455 天", units: 7, over180: true },
      { key: "456-plus", label: "456 天以上", units: 2, over180: true },
    ]);
    expect(parsed.rows[1]).toMatchObject({
      sellerSku: "FRESH-FBA-01",
      totalAgedUnits: 80,
      agedOver180: 0,
    });
  });

  it("selects one complete Amazon column generation instead of double-counting overlaps", () => {
    const headers = [
        "sku",
        "inv-age-0-to-90-days",
        "inv-age-91-to-180-days",
        "inv-age-181-to-270-days",
        "inv-age-271-to-365-days",
        "inv-age-366-to-455-days",
        "inv-age-456-plus-days",
        "inv-age-181-to-330-days",
        "inv-age-331-to-365-days",
        "inv-age-365-plus-days",
      ];
    const report = reportText(headers, [
      {
        sku: "AGED-FBA-02",
        "inv-age-0-to-90-days": 5,
        "inv-age-91-to-180-days": 6,
        "inv-age-181-to-270-days": 4,
        "inv-age-271-to-365-days": 3,
        "inv-age-366-to-455-days": 2,
        "inv-age-456-plus-days": 1,
        "inv-age-181-to-330-days": 999,
        "inv-age-331-to-365-days": 999,
        "inv-age-365-plus-days": 999,
      },
    ]);

    expect(parseAgedInventoryReportDocument(report)[0]).toMatchObject({
      totalAgedUnits: 21,
      agedOver180: 10,
      ageBuckets: [
        { key: "0-90", label: "0–90 天", units: 5, over180: false },
        { key: "91-180", label: "91–180 天", units: 6, over180: false },
        { key: "181-270", label: "181–270 天", units: 4, over180: true },
        { key: "271-365", label: "271–365 天", units: 3, over180: true },
        { key: "366-455", label: "366–455 天", units: 2, over180: true },
        { key: "456-plus", label: "456 天以上", units: 1, over180: true },
      ],
    });
    expect(() =>
      parseAgedInventoryReportDocument(
        reportText(
          [
            "sku",
            "inv-age-0-to-90-days",
            "inv-age-91-to-180-days",
            "inv-age-181-to-270-days",
            "inv-age-271-to-365-days",
            "inv-age-365-plus-days",
          ],
          [
            {
              sku: "BAD",
              "inv-age-0-to-90-days": 0,
              "inv-age-91-to-180-days": 0,
              "inv-age-181-to-270-days": -1,
              "inv-age-271-to-365-days": 0,
              "inv-age-365-plus-days": 0,
            },
          ],
        ),
      ),
    ).toThrow("不是有效數量");
  });

  it("keeps non-US 365-plus units when the regional tail columns are unavailable", () => {
    const report = reportText(
      [
        "sku",
        "inv-age-0-to-90-days",
        "inv-age-91-to-180-days",
        "inv-age-181-to-270-days",
        "inv-age-271-to-365-days",
        "inv-age-365-plus-days",
        "estimated-excess-quantity",
      ],
      [
        {
          sku: "NON-US-AGED-01",
          "inv-age-0-to-90-days": 4,
          "inv-age-91-to-180-days": 3,
          "inv-age-181-to-270-days": 0,
          "inv-age-271-to-365-days": 0,
          "inv-age-365-plus-days": 11,
          "estimated-excess-quantity": 7,
        },
      ],
    );

    expect(parseAgedInventoryReportDocument(report)).toEqual([
      expect.objectContaining({
        sellerSku: "NON-US-AGED-01",
        agedOver180: 11,
        estimatedExcessQuantity: 7,
        ageBuckets: [
          { key: "0-90", label: "0–90 天", units: 4, over180: false },
          { key: "91-180", label: "91–180 天", units: 3, over180: false },
          { key: "181-270", label: "181–270 天", units: 0, over180: true },
          { key: "271-365", label: "271–365 天", units: 0, over180: true },
          {
            key: "365-plus",
            label: "365 天以上（Amazon 欄位）",
            units: 11,
            over180: true,
          },
        ],
      }),
    ]);
    expect(
      parseAgedInventoryReportDocument(report, "A1VC38T7YXB528"),
    ).toHaveLength(1);
    expect(() =>
      parseAgedInventoryReportDocument(report, MARKETPLACE_ID),
    ).toThrow("區域庫齡欄位與目前站點不一致");
  });

  it("fails closed when a selected age bucket is blank instead of assuming zero", () => {
    expect(() =>
      parseAgedInventoryReportDocument(
        reportText(
          [
            "sku",
            "inv-age-0-to-90-days",
            "inv-age-91-to-180-days",
            "inv-age-181-to-270-days",
            "inv-age-271-to-365-days",
            "inv-age-365-plus-days",
          ],
          [
            {
              sku: "MISSING-BUCKET-01",
              "inv-age-0-to-90-days": 1,
              "inv-age-91-to-180-days": 0,
              "inv-age-181-to-270-days": 0,
              "inv-age-271-to-365-days": 0,
            },
          ],
        ),
      ),
    ).toThrow("「365 天以上（Amazon 欄位）」缺值");
  });

  it("marks estimated excess partial when Amazon leaves any SKU blank", () => {
    const parsed = parseAgedInventoryReportData(
      reportText(
        [
          "sku",
          "inv-age-0-to-90-days",
          "inv-age-91-to-180-days",
          "inv-age-181-to-270-days",
          "inv-age-271-to-365-days",
          "inv-age-365-plus-days",
          "estimated-excess-quantity",
        ],
        [
          {
            sku: "EXCESS-KNOWN",
            "inv-age-0-to-90-days": 1,
            "inv-age-91-to-180-days": 0,
            "inv-age-181-to-270-days": 0,
            "inv-age-271-to-365-days": 0,
            "inv-age-365-plus-days": 0,
            "estimated-excess-quantity": 7,
          },
          {
            sku: "EXCESS-UNKNOWN",
            "inv-age-0-to-90-days": 1,
            "inv-age-91-to-180-days": 0,
            "inv-age-181-to-270-days": 0,
            "inv-age-271-to-365-days": 0,
            "inv-age-365-plus-days": 0,
          },
        ],
      ),
    );

    expect(parsed.excessAvailability).toBe("partial");
    expect(parsed.rows.map((row) => row.estimatedExcessQuantity)).toEqual([
      7,
      null,
    ]);
  });

  it("treats blank official fees as zero only when the same row has a zero charge basis", () => {
    const aisKeys = [...COMMON_AIS_KEYS, "365-plus"] as const;
    const headers = [
      "sku",
      "inv-age-0-to-90-days",
      "inv-age-91-to-180-days",
      "inv-age-181-to-270-days",
      "inv-age-271-to-365-days",
      "inv-age-365-plus-days",
      "storage-volume",
      "estimated-storage-cost-next-month",
      ...aisKeys.flatMap((key) => [
        `quantity-to-be-charged-ais-${key}-days`,
        `estimated-ais-${key}-days`,
      ]),
    ];
    const record: Record<string, string | number> = {
      sku: "ZERO-BASIS-FBA",
      "inv-age-0-to-90-days": 8,
      "inv-age-91-to-180-days": 0,
      "inv-age-181-to-270-days": 0,
      "inv-age-271-to-365-days": 0,
      "inv-age-365-plus-days": 0,
      "storage-volume": 0,
    };
    for (const key of aisKeys) {
      record[`quantity-to-be-charged-ais-${key}-days`] = 0;
    }

    const parsed = parseAgedInventoryReportData(reportText(headers, [record]));
    expect(parsed.storageCostAvailability).toBe("complete");
    expect(parsed.agedSurchargeAvailability).toBe("complete");
    expect(parsed.rows[0]).toMatchObject({
      estimatedStorageCostNextMonth: 0,
      estimatedAgedSurcharge: 0,
      currencyCode: null,
    });
    expect(parsed.rows[0]!.agedSurchargeBuckets).toEqual(
      aisKeys.map((key) =>
        expect.objectContaining({ key, quantity: 0, estimatedCharge: 0 }),
      ),
    );
    expect(formatAgedInventoryMoney(0, null)).toBe("0");
  });

  it("preserves a missing available quantity instead of inventing zero", () => {
    const parsed = parseAgedInventoryReportData(
      reportText(
        [
          "sku",
          "available",
          "inv-age-0-to-90-days",
          "inv-age-91-to-180-days",
          "inv-age-181-to-270-days",
          "inv-age-271-to-365-days",
          "inv-age-365-plus-days",
        ],
        [
          {
            sku: "MISSING-AVAILABLE",
            "inv-age-0-to-90-days": 1,
            "inv-age-91-to-180-days": 0,
            "inv-age-181-to-270-days": 0,
            "inv-age-271-to-365-days": 0,
            "inv-age-365-plus-days": 0,
          },
        ],
      ),
    );

    expect(parsed.rows[0]?.available).toBeNull();
  });

  it("rejects Seller SKU whitespace instead of rewriting report identity", () => {
    expect(() =>
      parseAgedInventoryReportData(
        reportText(
          [
            "sku",
            "inv-age-0-to-90-days",
            "inv-age-91-to-180-days",
            "inv-age-181-to-270-days",
            "inv-age-271-to-365-days",
            "inv-age-365-plus-days",
          ],
          [
            {
              sku: " PADDED-SKU",
              "inv-age-0-to-90-days": 1,
              "inv-age-91-to-180-days": 0,
              "inv-age-181-to-270-days": 0,
              "inv-age-271-to-365-days": 0,
              "inv-age-365-plus-days": 0,
            },
          ],
        ),
      ),
    ).toThrow("無法原樣辨識 Seller SKU");
  });

  it("does not infer storage or AIS rates when the charge basis is positive or missing", () => {
    const aisKeys = [...COMMON_AIS_KEYS, "365-plus"] as const;
    const headers = [
      "sku",
      "inv-age-0-to-90-days",
      "inv-age-91-to-180-days",
      "inv-age-181-to-270-days",
      "inv-age-271-to-365-days",
      "inv-age-365-plus-days",
      "currency",
      "storage-volume",
      "estimated-storage-cost-next-month",
      ...aisKeys.flatMap((key) => [
        `quantity-to-be-charged-ais-${key}-days`,
        `estimated-ais-${key}-days`,
      ]),
    ];
    const record: Record<string, string | number> = {
      sku: "UNKNOWN-RATE-FBA",
      "inv-age-0-to-90-days": 0,
      "inv-age-91-to-180-days": 0,
      "inv-age-181-to-270-days": 1,
      "inv-age-271-to-365-days": 0,
      "inv-age-365-plus-days": 0,
      currency: "USD",
      "storage-volume": 1.25,
      "quantity-to-be-charged-ais-181-210-days": 1,
    };
    for (const key of aisKeys.slice(1)) {
      record[`quantity-to-be-charged-ais-${key}-days`] = 0;
    }

    const parsed = parseAgedInventoryReportData(reportText(headers, [record]));
    expect(parsed.storageCostAvailability).toBe("partial");
    expect(parsed.agedSurchargeAvailability).toBe("partial");
    expect(parsed.rows[0]).toMatchObject({
      estimatedStorageCostNextMonth: null,
      estimatedAgedSurcharge: null,
    });
    expect(parsed.rows[0]!.agedSurchargeBuckets[0]).toMatchObject({
      quantity: 1,
      estimatedCharge: null,
    });
  });

  it("fails closed when an Amazon report omits every complete long-age tail", () => {
    expect(() =>
      parseAgedInventoryReportDocument(
        [
          "sku\tinv-age-0-to-90-days\tinv-age-91-to-180-days\tinv-age-181-to-270-days\tinv-age-271-to-365-days",
          "INCOMPLETE-AGED-01\t0\t0\t2\t3",
        ].join("\n"),
      ),
    ).toThrow("缺少完整且不重疊的庫齡區間");
  });

  it("fails closed instead of summing an incomplete AIS column generation", () => {
    expect(() =>
      parseAgedInventoryReportDocument(
        reportText(
          [
            "sku",
            "inv-age-0-to-90-days",
            "inv-age-91-to-180-days",
            "inv-age-181-to-270-days",
            "inv-age-271-to-365-days",
            "inv-age-365-plus-days",
            "quantity-to-be-charged-ais-181-210-days",
          ],
          [
            {
              sku: "INCOMPLETE-AIS-01",
              "inv-age-0-to-90-days": 0,
              "inv-age-91-to-180-days": 0,
              "inv-age-181-to-270-days": 2,
              "inv-age-271-to-365-days": 3,
              "inv-age-365-plus-days": 4,
              "quantity-to-be-charged-ais-181-210-days": 1,
            },
          ],
        ),
      ),
    ).toThrow("AIS 預估附加費欄位不完整");
  });

  it("fails closed when official fee rows mix currencies", () => {
    const headers = [
      "sku",
      "inv-age-0-to-90-days",
      "inv-age-91-to-180-days",
      "inv-age-181-to-270-days",
      "inv-age-271-to-365-days",
      "inv-age-365-plus-days",
      "currency",
      "estimated-storage-cost-next-month",
    ];
    expect(() =>
      parseAgedInventoryReportDocument(
        reportText(headers, [
          {
            sku: "USD-FBA-01",
            "inv-age-0-to-90-days": 1,
            "inv-age-91-to-180-days": 0,
            "inv-age-181-to-270-days": 0,
            "inv-age-271-to-365-days": 0,
            "inv-age-365-plus-days": 0,
            currency: "USD",
            "estimated-storage-cost-next-month": 1,
          },
          {
            sku: "CAD-FBA-01",
            "inv-age-0-to-90-days": 1,
            "inv-age-91-to-180-days": 0,
            "inv-age-181-to-270-days": 0,
            "inv-age-271-to-365-days": 0,
            "inv-age-365-plus-days": 0,
            currency: "CAD",
            "estimated-storage-cost-next-month": 1,
          },
        ]),
      ),
    ).toThrow("包含多種幣別");
  });

  it("requests GET_FBA_INVENTORY_PLANNING_DATA for exactly one marketplace", async () => {
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "TEST_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "TEST_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "TEST_REFRESH_TOKEN";
    process.env.SP_API_SELLER_ID_NA = "TEST_SELLER_ID";
    invalidateSpApiCredentialCaches();
    let reportRequest: Record<string, unknown> | null = null;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "TEST_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.pathname === "/reports/2021-06-30/reports") {
        reportRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse(202, { reportId: REPORT_ID });
      }
      throw new Error(`Unexpected request: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await startAgedInventoryReport({ marketplaceId: MARKETPLACE_ID });

    expect(result).toMatchObject({
      mode: "live",
      ready: false,
      reportId: REPORT_ID,
      status: "IN_QUEUE",
    });
    expect(reportRequest).toEqual({
      reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
      marketplaceIds: [MARKETPLACE_ID],
    });
  });

  it("fails closed when Amazon returns a different report type or marketplace", async () => {
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "TEST_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "TEST_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "TEST_REFRESH_TOKEN";
    process.env.SP_API_SELLER_ID_NA = "TEST_SELLER_ID";
    invalidateSpApiCredentialCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = requestUrl(input);
        if (url.origin === "https://api.amazon.com") {
          return jsonResponse(200, {
            access_token: "TEST_ACCESS_TOKEN",
            expires_in: 3_600,
          });
        }
        if (url.pathname === `/reports/2021-06-30/reports/${REPORT_ID}`) {
          return jsonResponse(200, {
            reportId: REPORT_ID,
            reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
            marketplaceIds: [MARKETPLACE_ID],
            processingStatus: "DONE",
            reportDocumentId: "WRONG_DOCUMENT",
          });
        }
        throw new Error(`Unexpected request: ${url.href}`);
      }),
    );

    await expect(
      getAgedInventoryReportStatus({
        marketplaceId: MARKETPLACE_ID,
        reportId: REPORT_ID,
      }),
    ).rejects.toMatchObject({ code: "REPORT_MISMATCH", status: 409 });
  });
});

describe("FBA aged inventory renderer and read-only route", () => {
  const router = new ApiRouter({
    store: {} as LocalStore,
    vault: {} as CredentialVault,
    approveWrite: async () => undefined,
  });

  beforeEach(() => {
    clearSpEnvironment();
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
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
    expect(markup).toContain("費用缺欄或缺值時不套費率、不推算");
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
      quantity: 1,
      quantityReportedSkuCount: 1,
      estimatedCharge: null,
      chargeReportedSkuCount: 0,
      totalSkuCount: 2,
    });

    const markup = renderToStaticMarkup(
      <AgedInventoryTierOverview rows={rows} currencyCode="USD" />,
    );
    expect(markup).toContain("全部 FBA 庫齡分層");
    expect(markup).toContain("AIS 官方預估計費分層");
    expect(markup).toContain("已回傳 1／2 SKU");
    expect(markup).toContain("不反推或猜測每件費率");
    expect(markup).toContain("US$2.00");
  });

  it("validates every row and the server summary before displaying it", () => {
    const raw = {
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-08-08T00:00:00.000Z",
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
      summary: {
        skuCount: 1,
        totalAgedUnits: 50,
        agedOver180: 31,
        estimatedExcessQuantity: 25,
        estimatedStorageCostNextMonth: 15.25,
        estimatedAgedSurcharge: 3.6,
      },
    });
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
        },
      ],
      summary: {
        ...raw.summary,
        skuCount: 2,
        agedOver180SkuCount: 2,
        totalAgedUnits: 100,
        agedOver180: 62,
        excessAvailability: "partial",
        estimatedExcessQuantity: 25,
        excessReportedSkuCount: 1,
        estimatedStorageCostNextMonth: 30.5,
        storageCostReportedSkuCount: 2,
        estimatedAgedSurcharge: 7.2,
        agedSurchargeReportedSkuCount: 2,
      },
    };
    expect(parseAgedInventorySnapshot(partialExcess, MARKETPLACE_ID)).toMatchObject({
      summary: {
        excessAvailability: "partial",
        estimatedExcessQuantity: 25,
      },
    });
    expect(() =>
      parseAgedInventorySnapshot(
        {
          ...partialExcess,
          summary: {
            ...partialExcess.summary,
            estimatedExcessQuantity: 24,
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
