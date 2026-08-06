import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getListingContent,
  getListingPrice,
  invalidateSpApiCredentialCaches,
  previewListingContentUpdate,
  SpApiError,
  verifyListingsAccess,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const FAKE_SELLER_ID = "FAKE_SELLER_ID_NA";
const FAKE_SKU = "FAKE SKU/01";
const SP_ENV_KEYS = Object.keys(process.env).filter((key) =>
  key.startsWith("SP_API_"),
);
const savedEnvironment = new Map(
  SP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeTokenResponse(): Response {
  return jsonResponse(200, {
    access_token: "FAKE_ACCESS_TOKEN",
    expires_in: 3_600,
  });
}

function fakeListingItemResponse(): Response {
  return jsonResponse(
    200,
    {
      sku: FAKE_SKU,
      summaries: [
        {
          marketplaceId: MARKETPLACE_ID,
          asin: "FAKE_ASIN",
          productType: "FAKE_PRODUCT_TYPE",
          status: ["BUYABLE"],
          itemName: "Fake FBA item",
        },
      ],
      attributes: {
        item_name: [
          {
            value: "Fake FBA item",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        purchasable_offer: [
          {
            marketplace_id: MARKETPLACE_ID,
            currency: "USD",
            our_price: [{ schedule: [{ value_with_tax: 12.34 }] }],
          },
        ],
      },
      offers: [],
      issues: [],
      fulfillmentAvailability: [
        { fulfillmentChannelCode: "AMAZON_NA", quantity: 7 },
      ],
    },
    { "x-amzn-requestid": "FAKE_REQUEST_ID_LISTING_OK" },
  );
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function expectTokenRequest(url: URL): void {
  expect(url.href).toBe("https://api.amazon.com/auth/o2/token");
}

function expectGetListingsItemUrl(url: URL): void {
  expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
  expect(url.pathname).toBe(
    `/listings/2021-08-01/items/${FAKE_SELLER_ID}/FAKE%20SKU%2F01`,
  );
  expect([...url.searchParams.keys()].sort()).toEqual(
    ["includedData", "issueLocale", "marketplaceIds"].sort(),
  );
  expect(url.searchParams.get("marketplaceIds")).toBe(MARKETPLACE_ID);
  expect(url.searchParams.get("issueLocale")).toBe("en_US");
  expect(url.searchParams.get("includedData")?.split(",")).toEqual([
    "summaries",
    "attributes",
    "offers",
    "issues",
    "fulfillmentAvailability",
  ]);
  expect(url.searchParams.get("includedData")).not.toContain("productTypes");
}

async function captureSpApiError(
  action: () => Promise<unknown>,
): Promise<SpApiError> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SpApiError);
  return caught as SpApiError;
}

describe("SP-API live wire contracts", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_LWA_CLIENT_ID";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_LWA_CLIENT_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REFRESH_TOKEN_NA";
    process.env.SP_API_SELLER_ID_NA = FAKE_SELLER_ID;
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

  it("rejects a Marketplace ID pasted into the Seller ID field", async () => {
    process.env.SP_API_SELLER_ID_NA = MARKETPLACE_ID;
    invalidateSpApiCredentialCaches();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureSpApiError(() =>
      getListingPrice({ marketplaceId: MARKETPLACE_ID, sellerSku: FAKE_SKU }),
    );

    expect(error).toMatchObject({
      status: 422,
      code: "INVALID_SELLER_ID",
      operation: null,
    });
    expect(error.message).toContain("Merchant Token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the public price read to getListingsItem without productTypes", async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      urls.push(url);
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      return fakeListingItemResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const listing = await getListingPrice({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: FAKE_SKU,
    });

    expect(listing.mode).toBe("live");
    expect(urls).toHaveLength(2);
    expectTokenRequest(urls[0]);
    expectGetListingsItemUrl(urls[1]);
  });

  it("uses the minimal search probe and preserves a 400 request ID", async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      urls.push(url);
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      const isMinimalProbe = !url.searchParams.has("includedData");
      return jsonResponse(
        400,
        {
          errors: [
            {
              code: isMinimalProbe
                ? "FAKE_INVALID_MINIMAL_SEARCH_PARAMETERS"
                : "FAKE_INVALID_STANDARD_SEARCH_PARAMETERS",
              message: isMinimalProbe
                ? "Fake invalid minimal search parameters"
                : "Fake invalid standard search parameters",
            },
          ],
        },
        {
          "x-amzn-requestid": isMinimalProbe
            ? "FAKE_REQUEST_ID_MINIMAL_SEARCH_400"
            : "FAKE_REQUEST_ID_STANDARD_SEARCH_400",
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureSpApiError(() =>
      verifyListingsAccess(MARKETPLACE_ID),
    );

    expect(urls).toHaveLength(3);
    expectTokenRequest(urls[0]);
    expect(urls[1].origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(urls[1].pathname).toBe(
      `/listings/2021-08-01/items/${FAKE_SELLER_ID}`,
    );
    expect([...urls[1].searchParams.keys()].sort()).toEqual(
      ["includedData", "issueLocale", "marketplaceIds", "pageSize"].sort(),
    );
    expect(urls[1].searchParams.get("marketplaceIds")).toBe(MARKETPLACE_ID);
    expect(urls[1].searchParams.get("issueLocale")).toBe("en_US");
    expect(urls[1].searchParams.get("includedData")).toBe("summaries");
    expect(urls[1].searchParams.get("pageSize")).toBe("1");
    expect(urls[1].searchParams.has("identifiers")).toBe(false);
    expect(urls[1].searchParams.has("identifiersType")).toBe(false);
    expect(urls[2].origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(urls[2].pathname).toBe(
      `/listings/2021-08-01/items/${FAKE_SELLER_ID}`,
    );
    expect([...urls[2].searchParams.entries()]).toEqual([
      ["marketplaceIds", MARKETPLACE_ID],
    ]);
    expect(error).toMatchObject({
      status: 400,
      requestId: "FAKE_REQUEST_ID_MINIMAL_SEARCH_400",
      operation: "searchListingsItems",
      upstreamCode: "FAKE_INVALID_MINIMAL_SEARCH_PARAMETERS",
    });
  });

  it("labels a getListingsItem failure before the PTD request starts", async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      urls.push(url);
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      const profile = !url.searchParams.has("includedData")
        ? "minimal"
        : !url.searchParams.has("issueLocale")
          ? "essential"
          : "full";
      return jsonResponse(
        400,
        {
          errors: [
            {
              code: `FAKE_INVALID_${profile.toUpperCase()}_ITEM_PARAMETERS`,
              message: `Fake invalid ${profile} item parameters`,
            },
          ],
        },
        {
          "x-amzn-requestid": `FAKE_REQUEST_ID_${profile.toUpperCase()}_ITEM_400`,
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureSpApiError(() =>
      getListingContent({ marketplaceId: MARKETPLACE_ID, sellerSku: FAKE_SKU }),
    );

    expect(urls).toHaveLength(4);
    expectGetListingsItemUrl(urls[1]);
    expect(urls[2].origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(urls[2].pathname).toBe(
      `/listings/2021-08-01/items/${FAKE_SELLER_ID}/FAKE%20SKU%2F01`,
    );
    expect([...urls[2].searchParams.keys()].sort()).toEqual(
      ["includedData", "marketplaceIds"].sort(),
    );
    expect(urls[2].searchParams.get("marketplaceIds")).toBe(MARKETPLACE_ID);
    expect(urls[2].searchParams.get("includedData")?.split(",")).toEqual([
      "summaries",
      "attributes",
      "fulfillmentAvailability",
    ]);
    expect(urls[2].searchParams.get("includedData")).not.toContain(
      "productTypes",
    );
    expect(urls[3].origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(urls[3].pathname).toBe(
      `/listings/2021-08-01/items/${FAKE_SELLER_ID}/FAKE%20SKU%2F01`,
    );
    expect([...urls[3].searchParams.entries()]).toEqual([
      ["marketplaceIds", MARKETPLACE_ID],
    ]);
    expect(error).toMatchObject({
      status: 400,
      requestId: "FAKE_REQUEST_ID_MINIMAL_ITEM_400",
      operation: "getListingsItem",
      upstreamCode: "FAKE_INVALID_MINIMAL_ITEM_PARAMETERS",
    });
  });

  it("stops safely when only the required getListingsItem parameters work", async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      urls.push(url);
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      if (!url.searchParams.has("includedData")) {
        return jsonResponse(
          200,
          { sku: FAKE_SKU, summaries: [] },
          { "x-amzn-requestid": "FAKE_REQUEST_ID_MINIMAL_ITEM_OK" },
        );
      }
      return jsonResponse(400, {
        errors: [
          {
            code: "FAKE_DATASET_REJECTED",
            message: "Fake dataset rejected",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureSpApiError(() =>
      getListingContent({ marketplaceId: MARKETPLACE_ID, sellerSku: FAKE_SKU }),
    );

    expect(urls).toHaveLength(4);
    expect([...urls[3].searchParams.entries()]).toEqual([
      ["marketplaceIds", MARKETPLACE_ID],
    ]);
    expect(error).toMatchObject({
      status: 409,
      code: "LISTINGS_REQUIRED_DATA_UNAVAILABLE",
      requestId: "FAKE_REQUEST_ID_MINIMAL_ITEM_OK",
      operation: "getListingsItem",
    });
  });

  it("keeps listing content read-only when seller-specific PTD is unavailable", async () => {
    const urls: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      urls.push(url);
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      if (url.pathname.startsWith("/listings/")) {
        return fakeListingItemResponse();
      }
      return jsonResponse(
        400,
        {
          errors: [
            {
              code: "FAKE_INVALID_PTD_PARAMETERS",
              message: "Fake invalid PTD parameters",
            },
          ],
        },
        { "x-amzn-requestid": "FAKE_REQUEST_ID_PTD_400" },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const listing = await getListingContent({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: FAKE_SKU,
    });

    expect(urls).toHaveLength(4);
    expectGetListingsItemUrl(urls[1]);
    expect(urls[2].origin).toBe("https://sellingpartnerapi-na.amazon.com");
    expect(urls[2].pathname).toBe(
      "/definitions/2020-09-01/productTypes/FAKE_PRODUCT_TYPE",
    );
    expect(urls[2].searchParams.get("sellerId")).toBe(FAKE_SELLER_ID);
    expect(urls[3].pathname).toBe(
      "/definitions/2020-09-01/productTypes/FAKE_PRODUCT_TYPE",
    );
    expect(urls[3].searchParams.has("sellerId")).toBe(false);
    expect(listing).toMatchObject({
      mode: "live",
      sellerSku: FAKE_SKU,
      title: "Fake FBA item",
    });
    expect(listing.capabilities.title.editable).toBe(false);
    expect(listing.capabilities.bulletPoints.editable).toBe(false);
    expect(listing.capabilities.ingredients.editable).toBe(false);
    expect(listing.capabilities.images.every((item) => !item.editable)).toBe(
      true,
    );
    expect(listing.notice).toContain("所有寫入已停用");
  });

  it("labels PTD failures and blocks content preview before PATCH", async () => {
    const urls: URL[] = [];
    const methods: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      urls.push(url);
      methods.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      if (url.pathname.startsWith("/listings/")) {
        return fakeListingItemResponse();
      }
      return jsonResponse(
        400,
        {
          errors: [
            {
              code: "FAKE_INVALID_PTD_PARAMETERS",
              message: "Fake invalid PTD parameters",
            },
          ],
        },
        { "x-amzn-requestid": "FAKE_REQUEST_ID_PTD_400" },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureSpApiError(() =>
      previewListingContentUpdate({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: FAKE_SKU,
        expectedTitle: "Fake FBA item",
        expectedBulletPoints: [],
        expectedIngredients: "",
        title: "Updated fake FBA item",
        bulletPoints: [],
        ingredients: "",
      }),
    );

    expect(urls).toHaveLength(3);
    expectGetListingsItemUrl(urls[1]);
    expect(urls[2].pathname).toBe(
      "/definitions/2020-09-01/productTypes/FAKE_PRODUCT_TYPE",
    );
    expect(urls[2].searchParams.get("sellerId")).toBe(FAKE_SELLER_ID);
    expect(error).toMatchObject({
      status: 400,
      requestId: "FAKE_REQUEST_ID_PTD_400",
      operation: "getDefinitionsProductType",
      upstreamCode: "FAKE_INVALID_PTD_PARAMETERS",
    });
    expect(methods).not.toContain("PATCH");
  });
});
