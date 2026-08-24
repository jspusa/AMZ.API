import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readListingsItem,
  readProductTypeDefinition,
  searchListingsItems,
} from "../src/main/amazon/listings-reads";
import { createListingsReadProductionAdapter } from "../src/main/amazon/listings-reads-production";
import type { MarketplaceRegion } from "../src/shared/marketplaces";

const US = "ATVPDKIKX0DER" as const;
const SELLER_ID = "FAKE_SELLER_ID_NA";
const SCHEMA_URL = "https://schemas.example.test/PET_FOOD.json";

function jsonResponse(
  status: number,
  envelope: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function createAdapter(options: {
  forceRefreshes?: boolean[];
  invalidations?: MarketplaceRegion[];
  delays?: number[];
} = {}) {
  return createListingsReadProductionAdapter({
    getAccessToken: async (_region, forceRefresh) => {
      options.forceRefreshes?.push(forceRefresh);
      return forceRefresh ? "REFRESHED_TOKEN" : "CACHED_TOKEN";
    },
    invalidateAccessToken: (region) => options.invalidations?.push(region),
    getSellerId: () => SELLER_ID,
    userAgent: () => "AMZ.API/test",
    now: () => new Date("2026-08-24T00:00:00.000Z"),
    random: () => 0,
    sleep: async (milliseconds) => {
      options.delays?.push(milliseconds);
    },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function listingEnvelope(sellerSku: string, asin: string) {
  return {
    sku: sellerSku,
    summaries: [{
      marketplaceId: US,
      asin,
      productType: "PET_FOOD",
    }],
  };
}

describe("Listings reads production adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a semantic listing item to one fixed GET and ignores smuggled transport fields", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        requests.push({ url: requestUrl(input), init });
        return jsonResponse(
          200,
          { ...listingEnvelope("SKU A/1", "B000000001"), unknown: null },
          {
            "x-amzn-requestid": "request-item",
            "x-amzn-ratelimit-limit": "5",
          },
        );
      }),
    );
    const plan = {
      intent: "listing" as const,
      marketplaceId: US,
      sellerSku: "SKU A/1",
      method: "PATCH",
      url: "https://evil.example/collect",
      query: { includedData: "everything" },
      body: { patches: [] },
    };

    const result = await readListingsItem(createAdapter(), plan);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.origin).toBe(
      "https://sellingpartnerapi-na.amazon.com",
    );
    expect(requests[0]!.url.pathname).toBe(
      "/listings/2021-08-01/items/FAKE_SELLER_ID_NA/SKU%20A%2F1",
    );
    expect([...requests[0]!.url.searchParams.keys()].sort()).toEqual(
      ["includedData", "issueLocale", "marketplaceIds"].sort(),
    );
    expect(requests[0]!.url.searchParams.get("includedData")).toBe(
      "summaries,attributes,offers,issues,fulfillmentAvailability",
    );
    expect(requests[0]!.url.href).not.toContain("evil.example");
    expect(requests[0]!.init?.method).toBe("GET");
    expect(requests[0]!.init?.body).toBeUndefined();
    expect(result).toMatchObject({
      status: 200,
      envelope: { ...listingEnvelope("SKU A/1", "B000000001"), unknown: null },
      requestId: "request-item",
      rateLimit: "5",
      profile: "full",
    });
  });

  it("keeps the item 400 fallback bounded and fails when only minimal fields work", async () => {
    const urls: URL[] = [];
    const responses = [
      jsonResponse(400, { errors: [{ code: "FULL_REJECTED" }] }),
      jsonResponse(400, { errors: [{ code: "ESSENTIAL_REJECTED" }] }),
      jsonResponse(
        200,
        { sku: "EXACT-SKU" },
        { "x-amzn-requestid": "minimal-ok" },
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        urls.push(requestUrl(input));
        return responses.shift()!;
      }),
    );

    await expect(
      readListingsItem(createAdapter(), {
        intent: "listing",
        marketplaceId: US,
        sellerSku: "EXACT-SKU",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "LISTINGS_REQUIRED_DATA_UNAVAILABLE",
      requestId: "minimal-ok",
      operation: "getListingsItem",
    });
    expect(urls).toHaveLength(3);
    expect(urls[0]!.searchParams.get("includedData")).toContain("offers");
    expect(urls[1]!.searchParams.get("includedData")).toBe(
      "summaries,attributes,fulfillmentAvailability",
    );
    expect([...urls[2]!.searchParams.entries()]).toEqual([
      ["marketplaceIds", US],
    ]);
  });

  it("uses the fixed relationship fallback for variation reads without exposing it to listing reads", async () => {
    const urls: URL[] = [];
    const responses = [
      jsonResponse(400, { errors: [{ code: "RELATIONSHIPS_REJECTED" }] }),
      jsonResponse(200, listingEnvelope("CHILD-SKU", "B000000002")),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        urls.push(requestUrl(input));
        return responses.shift()!;
      }),
    );

    const result = await readListingsItem(createAdapter(), {
      intent: "variation-evidence",
      marketplaceId: US,
      sellerSku: "CHILD-SKU",
    });

    expect(result.profile).toBe("attributes");
    expect(urls).toHaveLength(2);
    expect(urls[0]!.searchParams.get("includedData")).toContain(
      "relationships",
    );
    expect(urls[1]!.searchParams.get("includedData")).not.toContain(
      "relationships",
    );
  });

  it("reports the full profile when a transient fallback response retries the fixed full read", async () => {
    const urls: URL[] = [];
    const responses = [
      jsonResponse(400, { errors: [{ code: "FULL_REJECTED" }] }),
      jsonResponse(503, { errors: [{ code: "TEMPORARY" }] }),
      jsonResponse(200, listingEnvelope("EXACT-SKU", "B000000003")),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        urls.push(requestUrl(input));
        return responses.shift()!;
      }),
    );

    const result = await readListingsItem(createAdapter(), {
      intent: "listing",
      marketplaceId: US,
      sellerSku: "EXACT-SKU",
    });

    expect(result.profile).toBe("full");
    expect(urls.map((url) => url.searchParams.get("includedData"))).toEqual([
      "summaries,attributes,offers,issues,fulfillmentAvailability",
      "summaries,attributes,fulfillmentAvailability",
      "summaries,attributes,offers,issues,fulfillmentAvailability",
    ]);
  });

  it("maps all search intents to fixed GET profiles", async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        urls.push(requestUrl(input));
        return jsonResponse(200, { items: [] });
      }),
    );
    const adapter = createAdapter();

    await searchListingsItems(adapter, {
      intent: "sku-batch",
      marketplaceId: US,
      sellerSkus: ["SKU-A", "SKU-B"],
    });
    await searchListingsItems(adapter, {
      intent: "variation-sku-batch",
      marketplaceId: US,
      sellerSkus: ["SKU-A"],
    });
    await searchListingsItems(adapter, {
      intent: "asin-identity",
      marketplaceId: US,
      asin: "B000000001",
    });
    await searchListingsItems(adapter, {
      intent: "variation-children",
      marketplaceId: US,
      parentSku: "PARENT-SKU",
      pageToken: "opaque-token",
    });

    expect(urls).toHaveLength(4);
    expect(urls.every((url) => url.pathname.endsWith(SELLER_ID))).toBe(true);
    expect(urls[0]!.searchParams.get("identifiers")).toBe("SKU-A,SKU-B");
    expect(urls[0]!.searchParams.get("identifiersType")).toBe("SKU");
    expect(urls[0]!.searchParams.get("includedData")).toContain("offers");
    expect(urls[1]!.searchParams.get("includedData")).toBe(
      "relationships,summaries,fulfillmentAvailability,productTypes",
    );
    expect(urls[2]!.searchParams.get("identifiers")).toBe("B000000001");
    expect(urls[2]!.searchParams.get("identifiersType")).toBe("ASIN");
    expect(urls[3]!.searchParams.get("variationParentSku")).toBe("PARENT-SKU");
    expect(urls[3]!.searchParams.get("pageToken")).toBe("opaque-token");
    expect(urls.every((url) => !url.searchParams.has("method"))).toBe(true);
  });

  it("limits access-probe compatibility fallback to standard then minimal", async () => {
    const urls: URL[] = [];
    const responses = [
      jsonResponse(400, { errors: [{ code: "STANDARD_REJECTED" }] }),
      jsonResponse(
        200,
        { items: [] },
        { "x-amzn-requestid": "minimal-probe" },
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        urls.push(requestUrl(input));
        return responses.shift()!;
      }),
    );

    const result = await searchListingsItems(createAdapter(), {
      intent: "access-probe",
      marketplaceId: US,
    });

    expect(result).toMatchObject({
      status: 200,
      profile: "minimal",
      requestId: "minimal-probe",
    });
    expect(urls).toHaveLength(2);
    expect(urls[0]!.searchParams.get("includedData")).toBe("summaries");
    expect([...urls[1]!.searchParams.entries()]).toEqual([
      ["marketplaceIds", US],
    ]);
  });

  it("does not turn a variation batch 400 into item requests or generic retries", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(400, { errors: [{ code: "INVALID_PARAMETERS" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchListingsItems(createAdapter(), {
      intent: "variation-sku-batch",
      marketplaceId: US,
      sellerSkus: ["SKU-A", "SKU-B"],
    });

    expect(result.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes a regional token once and shares two bounded transient retries", async () => {
    const forceRefreshes: boolean[] = [];
    const invalidations: MarketplaceRegion[] = [];
    const delays: number[] = [];
    const responses = [
      jsonResponse(401, {}),
      jsonResponse(429, {}, { "retry-after": "0" }),
      jsonResponse(500, {}),
      jsonResponse(200, { items: [] }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => responses.shift()!),
    );

    const result = await searchListingsItems(
      createAdapter({ forceRefreshes, invalidations, delays }),
      {
        intent: "sku-batch",
        marketplaceId: US,
        sellerSkus: ["SKU-A"],
      },
    );

    expect(result.status).toBe(200);
    expect(forceRefreshes).toEqual([false, true, false, false]);
    expect(invalidations).toEqual(["na"]);
    expect(delays).toEqual([0, 1_000]);
  });

  it("allows a generic PTD fallback only for content-read and follows only Amazon's schema link", async () => {
    const urls: URL[] = [];
    const responses = [
      jsonResponse(400, { errors: [{ code: "SELLER_SPECIFIC_REJECTED" }] }),
      jsonResponse(200, {
        productType: "PET_FOOD",
        marketplaceIds: [US],
        schema: { link: { resource: SCHEMA_URL }, checksum: "checksum" },
      }),
      jsonResponse(200, {
        type: "object",
        properties: { item_name: { type: "array" } },
      }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        urls.push(requestUrl(input));
        return responses.shift()!;
      }),
    );
    const plan = {
      intent: "content-read" as const,
      marketplaceId: US,
      productType: "PET_FOOD",
      schemaUrl: "https://evil.example/schema.json",
      method: "PATCH",
    };

    const result = await readProductTypeDefinition(createAdapter(), plan);

    expect(urls).toHaveLength(3);
    expect(urls[0]!.searchParams.get("sellerId")).toBe(SELLER_ID);
    expect(urls[1]!.searchParams.has("sellerId")).toBe(false);
    expect(urls[2]!.href).toBe(SCHEMA_URL);
    expect(urls.every((url) => url.origin !== "https://evil.example")).toBe(true);
    expect(result.sellerSpecific).toBe(false);
    expect(result.schemaEnvelope).toEqual({
      type: "object",
      properties: { item_name: { type: "array" } },
    });
  });

  it("rejects a mismatched PTD envelope before following its schema link", async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = requestUrl(input);
        urls.push(url);
        if (url.pathname.startsWith("/definitions/")) {
          return jsonResponse(200, {
            productType: "OTHER",
            marketplaceIds: [US],
            schema: { link: { resource: SCHEMA_URL } },
          });
        }
        return jsonResponse(200, { type: "object", properties: {} });
      }),
    );

    await expect(readProductTypeDefinition(createAdapter(), {
      intent: "content-write",
      marketplaceId: US,
      productType: "PET_FOOD",
    })).rejects.toMatchObject({
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]!.pathname).toContain("/productTypes/PET_FOOD");
  });

  it.each([
    ["content-write", "LISTING_PRODUCT_ONLY", "NOT_ENFORCED", null],
    ["business-offer", "LISTING_OFFER_ONLY", "NOT_ENFORCED", null],
    ["variation-child", "LISTING", "ENFORCED", "CHILD"],
  ] as const)(
    "keeps %s seller-specific with its fixed PTD vocabulary and no 400 fallback",
    async (intent, requirements, enforcement, parentageLevel) => {
      const urls: URL[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input) => {
          urls.push(requestUrl(input));
          return jsonResponse(400, { errors: [{ code: "REJECTED" }] });
        }),
      );

      const result = await readProductTypeDefinition(createAdapter(), {
        intent,
        marketplaceId: US,
        productType: "PET_FOOD",
      });

      expect(result.status).toBe(400);
      expect(urls).toHaveLength(1);
      expect(urls[0]!.searchParams.get("sellerId")).toBe(SELLER_ID);
      expect(urls[0]!.searchParams.get("requirements")).toBe(requirements);
      expect(urls[0]!.searchParams.get("requirementsEnforced")).toBe(
        enforcement,
      );
      expect(urls[0]!.searchParams.get("parentageLevel")).toBe(parentageLevel);
    },
  );
});
