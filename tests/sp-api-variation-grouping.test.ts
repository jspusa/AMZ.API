import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAllListingsExportData,
  getFbaVariationGroupingData,
  invalidateSpApiCredentialCaches,
  type ListingExportRow,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const FAKE_SELLER_ID = "FAKE_SELLER_ID_NA";
const SP_ENV_KEYS = Object.keys(process.env).filter((key) =>
  key.startsWith("SP_API_"),
);
const savedEnvironment = new Map(
  SP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function exportRow(
  sellerSku: string,
  asin: string,
): ListingExportRow {
  return {
    marketplace: "United States",
    sellerSku,
    asin,
    productType: "PET_SUPPLIES",
    title: `Title ${sellerSku}`,
    itemHighlight: "Highlight",
    bulletPoints: ["Bullet"],
    productDescription: "Description",
    ingredients: "Turkey",
    imageUrls: [],
    status: "BUYABLE",
    updatedAt: "2026-08-22T00:00:00.000Z",
    readStatus: "complete",
    readErrors: [],
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  requestId = "GROUPING-REQUEST",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-amzn-requestid": requestId,
    },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function listingItem(input: {
  sellerSku: string;
  asin: string;
  parentSku?: string;
  childSkus?: string[];
  theme?: string;
}) {
  return {
    sku: input.sellerSku,
    summaries: [{
      marketplaceId: MARKETPLACE_ID,
      asin: input.asin,
      itemName: `Live ${input.sellerSku}`,
      productType: "PET_SUPPLIES",
    }],
    productTypes: [{
      marketplaceId: MARKETPLACE_ID,
      productType: "PET_SUPPLIES",
    }],
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 1,
    }],
    relationships: input.parentSku || input.childSkus
      ? [{
          marketplaceId: MARKETPLACE_ID,
          relationships: [{
            ...(input.parentSku ? { parentSkus: [input.parentSku] } : {}),
            ...(input.childSkus ? { childSkus: input.childSkus } : {}),
            variationTheme: input.theme
              ? { theme: input.theme, attributes: ["size_name"] }
              : undefined,
          }],
        }]
      : [],
  };
}

describe("FBA variation grouping data", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  function enableLiveMode(): void {
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_LWA_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_LWA_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REFRESH_TOKEN_NA";
    process.env.SP_API_SELLER_ID_NA = FAKE_SELLER_ID;
    invalidateSpApiCredentialCaches();
  }

  it("uses the real demo parent families instead of making every SKU standalone", async () => {
    const reference = `demo-${MARKETPLACE_ID}`;
    const exported = await getAllListingsExportData({
      marketplaceId: MARKETPLACE_ID,
      reportId: reference,
      documentId: reference,
    });

    const grouped = await getFbaVariationGroupingData({
      marketplaceId: MARKETPLACE_ID,
      rows: exported.rows,
    });
    const bySku = new Map(grouped.rows.map((row) => [row.sellerSku, row]));

    expect(bySku.get("AFA-TRKY-4OZ")).toMatchObject({
      role: "child",
      parentSku: "DEMO-US-TURKEY-PARENT",
      familyKey: "DEMO-US-TURKEY-PARENT",
      theme: "SIZE_NAME",
      status: "complete",
    });
    expect(bySku.get("AFA-TRKY-285G")?.familyKey).toBe(
      "DEMO-US-TURKEY-PARENT",
    );
    expect(bySku.get("ACTL-TRAIN-8OZ")).toMatchObject({
      role: "standalone",
      parentSku: null,
      familyKey: "ACTL-TRAIN-8OZ",
      theme: null,
      status: "complete",
    });
  });

  it("groups verified child and standalone rows while keeping a missing row unknown", async () => {
    enableLiveMode();
    const rows = [
      exportRow("CHILD", "B000000001"),
      exportRow("STANDALONE", "B000000002"),
      exportRow("PARENT", "B000000003"),
      exportRow("MISSING", "B000000004"),
    ];
    const searchUrls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      searchUrls.push(url);
      return jsonResponse(200, {
        numberOfResults: 3,
        pagination: {},
        items: [
          listingItem({
            sellerSku: "CHILD",
            asin: "B000000001",
            parentSku: "PARENT-A",
            theme: "SIZE_NAME",
          }),
          listingItem({ sellerSku: "STANDALONE", asin: "B000000002" }),
          listingItem({
            sellerSku: "PARENT",
            asin: "B000000003",
            childSkus: ["CHILD"],
            theme: "SIZE_NAME",
          }),
        ],
      });
    }));

    const grouped = await getFbaVariationGroupingData({
      marketplaceId: MARKETPLACE_ID,
      rows,
    });

    expect(searchUrls).toHaveLength(1);
    expect(searchUrls[0]?.searchParams.get("identifiers")?.split(",")).toEqual([
      "CHILD",
      "STANDALONE",
      "PARENT",
      "MISSING",
    ]);
    expect(grouped.rows).toMatchObject([
      {
        sellerSku: "CHILD",
        role: "child",
        parentSku: "PARENT-A",
        familyKey: "PARENT-A",
        theme: "SIZE_NAME",
        status: "complete",
      },
      {
        sellerSku: "STANDALONE",
        role: "standalone",
        parentSku: null,
        familyKey: "STANDALONE",
        theme: null,
        status: "complete",
      },
      {
        sellerSku: "PARENT",
        role: "parent",
        parentSku: null,
        familyKey: "PARENT",
        theme: "SIZE_NAME",
        status: "complete",
      },
      {
        sellerSku: "MISSING",
        role: "unknown",
        parentSku: null,
        familyKey: "MISSING",
        theme: null,
        status: "incomplete",
      },
    ]);
    expect(grouped.rows[3]?.message).toMatch(/缺列|未回傳/u);
  });

  it("reports identity-free batch progress so a shared run can renew its active lease", async () => {
    vi.useFakeTimers();
    enableLiveMode();
    const rows = Array.from({ length: 21 }, (_, index) =>
      exportRow(
        `SKU-${String(index).padStart(2, "0")}`,
        `B${String(index).padStart(9, "0")}`,
      )
    );
    const bySku = new Map(rows.map((row) => [row.sellerSku, row]));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      const sellerSkus = url.searchParams.get("identifiers")!.split(",");
      return jsonResponse(200, {
        numberOfResults: sellerSkus.length,
        pagination: {},
        items: sellerSkus.map((sellerSku) => listingItem({
          sellerSku,
          asin: bySku.get(sellerSku)!.asin,
        })),
      });
    }));
    const progress: Array<{ completedBatches: number; totalBatches: number }> = [];

    const grouping = getFbaVariationGroupingData({
      marketplaceId: MARKETPLACE_ID,
      rows,
      onProgress: (update: { completedBatches: number; totalBatches: number }) => {
        progress.push(update);
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await grouping;

    expect(progress).toEqual([
      { completedBatches: 1, totalBatches: 2 },
      { completedBatches: 2, totalBatches: 2 },
    ]);
    expect(Object.keys(progress[0]!)).toEqual(["completedBatches", "totalBatches"]);
  });

  it("keeps every row unknown when Amazon rejects relationships with 400", async () => {
    enableLiveMode();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      return jsonResponse(400, { errors: [{ code: "INVALID_INPUT" }] });
    }));
    const rows = [
      exportRow("SKU-ONE", "B000000001"),
      exportRow("SKU-TWO", "B000000002"),
    ];

    const grouped = await getFbaVariationGroupingData({
      marketplaceId: MARKETPLACE_ID,
      rows,
    });

    expect(grouped.rows).toEqual(rows.map((row) => expect.objectContaining({
      sellerSku: row.sellerSku,
      role: "unknown",
      parentSku: null,
      familyKey: row.sellerSku,
      theme: null,
      status: "incomplete",
      message: expect.stringMatching(/400|拒絕/u),
    })));
  });

  it("marks conflicting relationship signatures for the same ASIN incomplete", async () => {
    enableLiveMode();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      return jsonResponse(200, {
        numberOfResults: 2,
        pagination: {},
        items: [
          listingItem({
            sellerSku: "ASIN-CHILD",
            asin: "B000000001",
            parentSku: "PARENT-A",
            theme: "SIZE_NAME",
          }),
          listingItem({ sellerSku: "ASIN-STANDALONE", asin: "B000000001" }),
        ],
      });
    }));
    const rows = [
      exportRow("ASIN-CHILD", "B000000001"),
      exportRow("ASIN-STANDALONE", "B000000001"),
    ];

    const grouped = await getFbaVariationGroupingData({
      marketplaceId: MARKETPLACE_ID,
      rows,
    });

    expect(grouped.rows).toEqual(rows.map((row) => expect.objectContaining({
      sellerSku: row.sellerSku,
      role: "unknown",
      parentSku: null,
      familyKey: row.sellerSku,
      theme: null,
      status: "incomplete",
      message: expect.stringMatching(/同一 ASIN.*衝突/u),
    })));
  });
});
