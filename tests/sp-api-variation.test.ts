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

function childPayload(sku: string, channel = "AMAZON_NA") {
  return {
    sku,
    summaries: [
      {
        marketplaceId: MARKETPLACE_ID,
        asin: `ASIN-${sku}`,
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
        productType: "PET_FOOD",
        itemName: "Variation parent",
      },
    ],
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
});
