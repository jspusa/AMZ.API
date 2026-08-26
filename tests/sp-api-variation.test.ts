import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getVariationFamilyPlanner,
  invalidateSpApiCredentialCaches,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const SELLER_ID = "FAKE_VARIATION_SELLER";
const SOURCE_SKU = "CHILD SKU/4OZ";
const PARENT_SKU = "PARENT SKU/01";
const SP_ENV_KEYS = Object.keys(process.env).filter((key) =>
  key.startsWith("SP_API_"),
);
const savedEnvironment = new Map(
  SP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-amzn-requestid": requestId,
    },
  });
}

function asinForSku(sku: string): string {
  let value = 0;
  for (const character of sku) {
    value = (value * 31 + character.codePointAt(0)!) % 1_000_000_000;
  }
  return `B${String(value).padStart(9, "0")}`;
}

function childPayload(
  sku: string,
  channel = "AMAZON_NA",
  asin = asinForSku(sku),
) {
  return {
    sku,
    summaries: [
      {
        marketplaceId: MARKETPLACE_ID,
        asin,
        productType: "PET_FOOD",
        status: ["BUYABLE"],
        itemName: `Listing ${sku}`,
      },
    ],
    productTypes: [{ marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD" }],
    attributes: {
      parentage_level: [{ value: "child" }],
      child_parent_sku_relationship: [{ parent_sku: PARENT_SKU }],
      variation_theme: [{ name: "SIZE_NAME" }],
      size_name: [{ value: sku === SOURCE_SKU ? "4 oz" : "10 oz" }],
    },
    relationships: [
      {
        marketplaceId: MARKETPLACE_ID,
        relationships: [
          {
            parentSkus: [PARENT_SKU],
            variationTheme: {
              theme: "SIZE_NAME",
              attributes: ["size_name"],
            },
          },
        ],
      },
    ],
    fulfillmentAvailability: [
      { fulfillmentChannelCode: channel, quantity: 7 },
    ],
    issues: [],
  };
}

function parentPayload() {
  return {
    sku: PARENT_SKU,
    summaries: [
      {
        marketplaceId: MARKETPLACE_ID,
        asin: asinForSku(PARENT_SKU),
        productType: "PET_FOOD",
        itemName: "Variation parent",
      },
    ],
    productTypes: [{ marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD" }],
    attributes: {
      parentage_level: [{ value: "parent" }],
      variation_theme: [{ name: "SIZE_NAME" }],
    },
    relationships: [
      {
        marketplaceId: MARKETPLACE_ID,
        relationships: [
          {
            childSkus: [SOURCE_SKU, "CHILD-10OZ", "FBM-CHILD"],
            variationTheme: {
              theme: "SIZE_NAME",
              attributes: ["size_name"],
            },
          },
        ],
      },
    ],
    fulfillmentAvailability: [],
    issues: [],
  };
}

describe("SP-API variation family wire contract", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_VARIATION_CLIENT";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_VARIATION_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_VARIATION_REFRESH";
    process.env.SP_API_SELLER_ID_NA = SELLER_ID;
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("resolves one exact ASIN through official searchListingsItems before reading the family", async () => {
    const asin = "B000000001";
    const listingRequests: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(
          200,
          { access_token: "FAKE_ACCESS", expires_in: 3_600 },
          "TOKEN-REQUEST",
        );
      }
      listingRequests.push(url);
      if (url.searchParams.get("identifiersType") === "ASIN") {
        return jsonResponse(200, {
          numberOfResults: 1,
          items: [childPayload(SOURCE_SKU, "AMAZON_NA", asin)],
          pagination: {},
        }, "ASIN-SEARCH");
      }
      if (url.searchParams.has("variationParentSku")) {
        return jsonResponse(200, {
          items: [childPayload(SOURCE_SKU, "AMAZON_NA", asin)],
          pagination: {},
        }, "CHILDREN-SEARCH");
      }
      if (decodeURIComponent(url.pathname).endsWith(`/${PARENT_SKU}`)) {
        return jsonResponse(200, parentPayload(), "PARENT-REQUEST");
      }
      return jsonResponse(
        200,
        childPayload(SOURCE_SKU, "AMAZON_NA", asin),
        "SOURCE-REQUEST",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getVariationFamilyPlanner({
      marketplaceId: MARKETPLACE_ID,
      asin,
    });

    expect(result.queriedSku).toBe(SOURCE_SKU);
    expect(result.queried.asin).toBe(asin);
    const asinRequest = listingRequests[0]!;
    expect(asinRequest.searchParams.get("identifiers")).toBe(asin);
    expect(asinRequest.searchParams.get("identifiersType")).toBe("ASIN");
    expect(asinRequest.searchParams.get("pageSize")).toBe("20");
    expect(asinRequest.searchParams.get("includedData")).toBe(
      "relationships,summaries,fulfillmentAvailability,productTypes",
    );
    expect(listingRequests).toHaveLength(4);
  });

  it("fails closed when an ASIN has zero or multiple exact Seller SKU results", async () => {
    const asin = "B000000001";
    for (const items of [
      [],
      [
        childPayload(SOURCE_SKU, "AMAZON_NA", asin),
        childPayload("SECOND-SKU", "AMAZON_NA", asin),
      ],
    ]) {
      invalidateSpApiCredentialCaches();
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === "https://api.amazon.com") {
          return jsonResponse(
            200,
            { access_token: "FAKE_ACCESS", expires_in: 3_600 },
            "TOKEN-REQUEST",
          );
        }
        return jsonResponse(200, {
          numberOfResults: items.length,
          items,
          pagination: {},
        }, "ASIN-SEARCH");
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(getVariationFamilyPlanner({
        marketplaceId: MARKETPLACE_ID,
        asin,
      })).rejects.toMatchObject({
        status: items.length === 0 ? 404 : 409,
        code: items.length === 0 ? "ASIN_NOT_FOUND" : "ASIN_AMBIGUOUS",
      });
    }
  });

  it("uses only GET relationships/variationParentSku reads and excludes non-FBA children", async () => {
    const listingRequests: Array<{ url: URL; method: string }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(
          200,
          { access_token: "FAKE_ACCESS", expires_in: 3_600 },
          "TOKEN-REQUEST",
        );
      }
      listingRequests.push({ url, method: init?.method ?? "GET" });
      if (url.searchParams.has("variationParentSku")) {
        return jsonResponse(
          200,
          {
            items: [
              childPayload(SOURCE_SKU),
              childPayload("CHILD-10OZ"),
              childPayload("FBM-CHILD", "DEFAULT"),
            ],
            pagination: {},
          },
          "SEARCH-REQUEST",
        );
      }
      if (decodeURIComponent(url.pathname).endsWith(`/${PARENT_SKU}`)) {
        return jsonResponse(200, parentPayload(), "PARENT-REQUEST");
      }
      return jsonResponse(200, childPayload(SOURCE_SKU), "SOURCE-REQUEST");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getVariationFamilyPlanner({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
    });

    expect(listingRequests).toHaveLength(3);
    expect(listingRequests.every((request) => request.method === "GET")).toBe(true);
    expect(listingRequests[0].url.pathname).toContain("CHILD%20SKU%2F4OZ");
    expect(listingRequests[1].url.pathname).toContain("PARENT%20SKU%2F01");
    expect(listingRequests[2].url.searchParams.get("variationParentSku")).toBe(PARENT_SKU);
    expect(listingRequests[2].url.searchParams.get("pageSize")).toBe("20");
    for (const request of listingRequests) {
      expect(request.url.searchParams.get("includedData")).toContain("relationships");
    }
    expect(result.writable).toBe(false);
    expect(result.parent).toMatchObject({ sellerSku: PARENT_SKU, role: "parent", fba: false });
    expect(result.children.map((child) => child.sellerSku)).toEqual([
      "CHILD SKU/4OZ",
      "CHILD-10OZ",
    ]);
    expect(result.children.every((child) => child.fba)).toBe(true);
    expect(result.excludedChildren).toEqual([
      expect.objectContaining({ sellerSku: "FBM-CHILD", reason: expect.stringContaining("FBA") }),
    ]);
    expect(result.familyComplete).toBe(true);
  });

  it("marks the family incomplete when search omits a parent-declared child", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(
          200,
          { access_token: "FAKE_ACCESS", expires_in: 3_600 },
          "TOKEN-REQUEST",
        );
      }
      if (url.searchParams.has("variationParentSku")) {
        return jsonResponse(
          200,
          {
            items: [
              childPayload(SOURCE_SKU),
              childPayload("FBM-CHILD", "DEFAULT"),
            ],
            pagination: {},
          },
          "SEARCH-REQUEST",
        );
      }
      if (decodeURIComponent(url.pathname).endsWith(`/${PARENT_SKU}`)) {
        return jsonResponse(200, parentPayload(), "PARENT-REQUEST");
      }
      return jsonResponse(200, childPayload(SOURCE_SKU), "SOURCE-REQUEST");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getVariationFamilyPlanner({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
    });

    expect(result.children.map((child) => child.sellerSku)).toEqual([
      SOURCE_SKU,
    ]);
    expect(result.excludedChildren).toEqual([
      expect.objectContaining({ sellerSku: "FBM-CHILD" }),
    ]);
    expect(result.familyComplete).toBe(false);
  });

  it("fails closed when the queried child itself cannot be proven FBA", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(
          200,
          { access_token: "FAKE_ACCESS", expires_in: 3_600 },
          "TOKEN-REQUEST",
        );
      }
      return jsonResponse(
        200,
        childPayload(SOURCE_SKU, "DEFAULT"),
        "SOURCE-REQUEST",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getVariationFamilyPlanner({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SOURCE_SKU,
      }),
    ).rejects.toMatchObject({ status: 422, code: "FBA_ONLY" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed before family follow-ups when Amazon returns another Seller SKU", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(
          200,
          { access_token: "FAKE_ACCESS", expires_in: 3_600 },
          "TOKEN-REQUEST",
        );
      }
      const payload = childPayload(
        SOURCE_SKU,
        "AMAZON_NA",
        "B000000001",
      );
      payload.sku = "OTHER-SKU";
      return jsonResponse(200, payload, "WRONG-SKU");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getVariationFamilyPlanner({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
    })).rejects.toMatchObject({
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
