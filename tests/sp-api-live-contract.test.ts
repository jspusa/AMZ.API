import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getListingContent,
  getListingImages,
  invalidateSpApiCredentialCaches,
  listingPriceGatewayProduction,
  previewListingContentUpdate,
  SpApiError,
  verifyListingsAccess,
} from "../src/main/amazon/sp-api";
import { SpExecutionContextError } from "../src/main/amazon/sp-execution-context";
import { createListingPriceMutationOperations } from
  "../src/main/listing-price-mutations";

const priceOperations = createListingPriceMutationOperations(
  listingPriceGatewayProduction,
);
const getListingPrice = priceOperations.read;
const updateListingPrice = priceOperations.commitStandard;

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const FAKE_SELLER_ID = "FAKE_SELLER_ID_NA";
const FAKE_SKU = "FAKE SKU/01";
const FAKE_SCHEMA_URL = "https://schemas.example.test/fake-product-type.json";
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
          asin: "B000000001",
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
        title_differentiation: [
          {
            value: "Fake item highlight",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
          {
            value: "既存の商品ハイライト",
            language_tag: "ja_JP",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        bullet_point: [
          {
            value: "First fake bullet",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
          {
            value: "Second fake bullet",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        product_description: [
          {
            value: "Fake product description",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
          {
            value: "既存の商品説明",
            language_tag: "ja_JP",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        special_feature: [
          {
            value: "Separate special feature",
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          },
        ],
        ingredients: [
          {
            value: "Turkey tendon",
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

function fakeContentSchema(): Record<string, unknown> {
  const textAttribute = (maxLength: number, options: {
    minItems?: number;
    maxItems?: number;
  } = {}) => ({
    type: "array",
    editable: true,
    minItems: options.minItems ?? 0,
    maxItems: options.maxItems ?? 1,
    items: {
      type: "object",
      properties: {
        value: { type: "string", minLength: 1, maxLength },
        language_tag: { type: "string", enum: ["en_US", "ja_JP"] },
        marketplace_id: { type: "string" },
      },
    },
  });
  return {
    type: "object",
    required: ["item_name"],
    properties: {
      item_name: textAttribute(75, { minItems: 1 }),
      title_differentiation: textAttribute(125),
      bullet_point: textAttribute(500, { minItems: 1, maxItems: 5 }),
      product_description: textAttribute(5_000),
      ingredients: textAttribute(5_000),
    },
  };
}

function fakeContentDefinitionResponse(): Response {
  return jsonResponse(200, {
    productType: "FAKE_PRODUCT_TYPE",
    marketplaceIds: [MARKETPLACE_ID],
    schema: {
      link: { resource: FAKE_SCHEMA_URL, verb: "GET" },
      checksum: "FAKE_CONTENT_SCHEMA_CHECKSUM",
    },
  });
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

  it("does not send a commit PATCH after context changes during price precommit", async () => {
    let contextCurrent = true;
    let previewPatches = 0;
    let commitPatches = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      const method = init?.method ?? "GET";
      if (method === "GET") return fakeListingItemResponse();
      if (method === "PATCH" && url.searchParams.get("mode") === "VALIDATION_PREVIEW") {
        previewPatches += 1;
        contextCurrent = false;
        return jsonResponse(200, { status: "VALID", issues: [] });
      }
      if (method === "PATCH") {
        commitPatches += 1;
        return jsonResponse(200, { status: "ACCEPTED", issues: [] });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureSpApiError(() => updateListingPrice({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: FAKE_SKU,
      expectedPrice: 12.34,
      newPrice: 13.34,
    }, {
      assertCurrent: async () => {
        if (!contextCurrent) {
          throw new SpExecutionContextError(
            "SP_CONTEXT_INVALIDATED",
            "Amazon 執行環境已更新；請重新開始這次操作。",
          );
        }
      },
    }));

    expect(error).toMatchObject({
      name: "SpApiPreCommitError",
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
      commitPatchSent: false,
    });
    expect(previewPatches).toBe(1);
    expect(commitPatches).toBe(0);
  });

  it("fails a public price read closed when Amazon returns a different Seller SKU", async () => {
    const envelope = await fakeListingItemResponse().json() as {
      sku: string;
    };
    envelope.sku = "OTHER-SKU";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = requestUrl(input);
        return url.origin === "https://api.amazon.com"
          ? fakeTokenResponse()
          : jsonResponse(200, envelope);
      }),
    );

    const error = await captureSpApiError(() =>
      getListingPrice({ marketplaceId: MARKETPLACE_ID, sellerSku: FAKE_SKU }),
    );

    expect(error).toMatchObject({
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
  });

  it("stops public content before PTD when the exact marketplace summary is missing", async () => {
    const envelope = await fakeListingItemResponse().json() as {
      summaries: Array<{ marketplaceId: string }>;
    };
    envelope.summaries[0]!.marketplaceId = "A2EUQ1WTGCTBG2";
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = requestUrl(input);
        urls.push(url);
        return url.origin === "https://api.amazon.com"
          ? fakeTokenResponse()
          : jsonResponse(200, envelope);
      }),
    );

    await expect(
      getListingContent({ marketplaceId: MARKETPLACE_ID, sellerSku: FAKE_SKU }),
    ).rejects.toMatchObject({
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(urls.some((url) => url.pathname.startsWith("/definitions/"))).toBe(
      false,
    );
  });

  it("stops public images before PTD when exact Product Type evidence conflicts", async () => {
    const envelope = await fakeListingItemResponse().json() as {
      productTypes?: Array<{ marketplaceId: string; productType: string }>;
    };
    envelope.productTypes = [
      { marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD" },
      { marketplaceId: MARKETPLACE_ID, productType: "CONFLICTING_TYPE" },
    ];
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = requestUrl(input);
        urls.push(url);
        return url.origin === "https://api.amazon.com"
          ? fakeTokenResponse()
          : jsonResponse(200, envelope);
      }),
    );

    await expect(
      getListingImages({ marketplaceId: MARKETPLACE_ID, sellerSku: FAKE_SKU }),
    ).rejects.toMatchObject({
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(urls.some((url) => url.pathname.startsWith("/definitions/"))).toBe(
      false,
    );
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

  it("maps the four product copy attributes separately and reads their PTD capabilities", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      if (url.href === FAKE_SCHEMA_URL) {
        return jsonResponse(200, fakeContentSchema());
      }
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return fakeContentDefinitionResponse();
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return fakeListingItemResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const listing = await getListingContent({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: FAKE_SKU,
    });

    expect(listing).toMatchObject({
      title: "Fake FBA item",
      itemHighlight: "Fake item highlight",
      bulletPoints: ["First fake bullet", "Second fake bullet"],
      productDescription: "Fake product description",
      ingredients: "Turkey tendon",
      languageTag: "en_US",
      attributePresence: {
        title: true,
        itemHighlight: true,
        bulletPoints: true,
        productDescription: true,
        ingredients: true,
      },
    });
    expect(listing.itemHighlight).not.toBe("Separate special feature");
    expect(listing.capabilities.title).toMatchObject({
      supported: true,
      editable: true,
      required: true,
      maxLength: 75,
    });
    expect(listing.capabilities.itemHighlight).toMatchObject({
      supported: true,
      editable: true,
      maxLength: 125,
    });
    expect(listing.capabilities.productDescription).toMatchObject({
      supported: true,
      editable: true,
      maxLength: 5_000,
    });
    expect(listing.capabilities.schemaChecksum).toBe(
      "FAKE_CONTENT_SCHEMA_CHECKSUM",
    );
  });

  it("previews Item Highlight and product description with their exact top-level paths", async () => {
    let previewBody: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      if (url.href === FAKE_SCHEMA_URL) {
        return jsonResponse(200, fakeContentSchema());
      }
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return fakeContentDefinitionResponse();
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return fakeListingItemResponse();
      }
      if (
        url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH" &&
        url.searchParams.get("mode") === "VALIDATION_PREVIEW"
      ) {
        previewBody = JSON.parse(String(init?.body));
        return jsonResponse(200, { status: "VALID", issues: [] });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const preview = await previewListingContentUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: FAKE_SKU,
      expectedTitle: "Fake FBA item",
      expectedItemHighlight: "Fake item highlight",
      expectedBulletPoints: ["First fake bullet", "Second fake bullet"],
      expectedProductDescription: "Fake product description",
      expectedIngredients: "Turkey tendon",
      title: "Fake FBA item",
      itemHighlight: "Updated fake item highlight",
      bulletPoints: ["First fake bullet", "Second fake bullet"],
      productDescription: "Updated fake product description",
      ingredients: "Turkey tendon",
    });

    expect(preview.changedFields).toEqual([
      "itemHighlight",
      "productDescription",
    ]);
    expect(previewBody).toEqual({
      productType: "FAKE_PRODUCT_TYPE",
      patches: [
        {
          op: "replace",
          path: "/attributes/title_differentiation",
          value: [
            {
              value: "既存の商品ハイライト",
              language_tag: "ja_JP",
              marketplace_id: MARKETPLACE_ID,
            },
            {
              value: "Updated fake item highlight",
              language_tag: "en_US",
              marketplace_id: MARKETPLACE_ID,
            },
          ],
        },
        {
          op: "replace",
          path: "/attributes/product_description",
          value: [
            {
              value: "既存の商品説明",
              language_tag: "ja_JP",
              marketplace_id: MARKETPLACE_ID,
            },
            {
              value: "Updated fake product description",
              language_tag: "en_US",
              marketplace_id: MARKETPLACE_ID,
            },
          ],
        },
      ],
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
    expect(listing.capabilities.itemHighlight.editable).toBe(false);
    expect(listing.capabilities.bulletPoints.editable).toBe(false);
    expect(listing.capabilities.productDescription.editable).toBe(false);
    expect(listing.capabilities.ingredients.editable).toBe(false);
    expect(listing.capabilities.images.every((item) => !item.editable)).toBe(
      true,
    );
    expect(listing.notice).toContain("所有寫入已停用");
  });

  it("discards a seller-specific content PTD that resolves after credential invalidation", async () => {
    let enterFirstSchema!: () => void;
    const firstSchemaEntered = new Promise<void>((resolve) => {
      enterFirstSchema = resolve;
    });
    let releaseFirstSchema!: () => void;
    const firstSchemaReleased = new Promise<void>((resolve) => {
      releaseFirstSchema = resolve;
    });
    let schemaReads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.origin === "https://api.amazon.com") return fakeTokenResponse();
      if (url.pathname.startsWith("/listings/")) {
        return fakeListingItemResponse();
      }
      if (url.pathname.startsWith("/definitions/")) {
        return fakeContentDefinitionResponse();
      }
      if (url.href === FAKE_SCHEMA_URL) {
        schemaReads += 1;
        if (schemaReads === 1) {
          enterFirstSchema();
          await firstSchemaReleased;
        }
        return jsonResponse(200, fakeContentSchema());
      }
      throw new Error(`Unexpected request: ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const stale = getListingContent({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: FAKE_SKU,
    });
    await firstSchemaEntered;
    invalidateSpApiCredentialCaches();
    releaseFirstSchema();

    const discarded = await stale;
    expect(discarded.capabilities.schemaChecksum).toBeNull();
    expect(discarded.capabilities.title.editable).toBe(false);
    await expect(getListingContent({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: FAKE_SKU,
    })).resolves.toMatchObject({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: FAKE_SKU,
      capabilities: {
        schemaChecksum: "FAKE_CONTENT_SCHEMA_CHECKSUM",
        title: { editable: true },
      },
    });
    expect(schemaReads).toBe(2);
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
        expectedItemHighlight: "",
        expectedBulletPoints: [],
        expectedProductDescription: "",
        expectedIngredients: "",
        title: "Updated fake FBA item",
        itemHighlight: "",
        bulletPoints: [],
        productDescription: "",
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
