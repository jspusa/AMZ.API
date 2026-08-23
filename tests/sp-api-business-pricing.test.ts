import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBusinessPricingAuditData,
  getBusinessPricing,
  invalidateSpApiCredentialCaches,
  previewBusinessPriceUpdate,
  updateBusinessPrice,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const SELLER_ID = "FAKE_B2B_SELLER_NA";
const SELLER_SKU = "B2B-FBA-SKU-01";
const ASIN = "B012345678";
const SCHEMA_URL =
  "https://selling-partner-definitions-prod-na.s3.amazonaws.com/business-pricing.json";
const SCHEMA_CHECKSUM = createHash("md5")
  .update(JSON.stringify(businessSchema()))
  .digest("base64");
const savedEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
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

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function listingResponse(): Response {
  return jsonResponse(200, {
    sku: SELLER_SKU,
    summaries: [{
      marketplaceId: MARKETPLACE_ID,
      asin: ASIN,
      productType: "PET_FOOD",
      status: ["BUYABLE"],
      itemName: "Business price FBA fixture",
    }],
    attributes: {
      purchasable_offer: [
        {
          audience: "ALL",
          currency: "USD",
          marketplace_id: MARKETPLACE_ID,
          our_price: [{ schedule: [{ value_with_tax: 30 }] }],
        },
        {
          audience: "B2B",
          currency: "USD",
          marketplace_id: MARKETPLACE_ID,
          our_price: [{ schedule: [{ value_with_tax: 28 }] }],
          quantity_discount_plan: [{
            schedule: [{
              discount_type: "fixed",
              levels: [{ lower_bound: 5, value: 25 }],
            }],
          }],
        },
      ],
    },
    offers: [
      {
        marketplaceId: MARKETPLACE_ID,
        offerType: "B2C",
        price: { currencyCode: "USD", amount: "30.00" },
      },
      {
        marketplaceId: MARKETPLACE_ID,
        offerType: "B2B",
        price: { currencyCode: "USD", amount: "28.00" },
        audience: { value: "B2B", displayName: "Amazon Business" },
      },
    ],
    issues: [],
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 12,
    }],
  });
}

function businessOfferItemSchema(
  audiences: readonly string[] = ["ALL", "B2B"],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      audience: { type: "string", enum: [...audiences] },
      currency: { type: "string", enum: ["USD"] },
      marketplace_id: { type: "string", enum: [MARKETPLACE_ID] },
      our_price: {
        type: "array",
        items: {
          type: "object",
          properties: {
            schedule: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  value_with_tax: {
                    type: "number",
                    editable: true,
                  },
                },
              },
            },
          },
        },
      },
      quantity_discount_plan: {
        type: "array",
        editable: true,
        minItems: 0,
        maxItems: 1,
        items: {
          type: "object",
          properties: {
            schedule: {
              type: "array",
              minItems: 1,
              maxItems: 1,
              items: {
                type: "object",
                properties: {
                  discount_type: {
                    type: "string",
                    enum: ["fixed", "percent"],
                    editable: true,
                  },
                  levels: {
                    type: "array",
                    editable: true,
                    minItems: 1,
                    maxItems: 5,
                    items: {
                      type: "object",
                      properties: {
                        lower_bound: {
                          type: "integer",
                          minimum: 1,
                          editable: true,
                        },
                        value: {
                          type: "number",
                          exclusiveMinimum: 0,
                          maximum: 100,
                          editable: true,
                        },
                      },
                      required: ["lower_bound", "value"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["discount_type", "levels"],
                additionalProperties: false,
              },
            },
          },
          required: ["schedule"],
          additionalProperties: false,
        },
      },
    },
  };
}

function businessSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      purchasable_offer: {
        type: "array",
        items: businessOfferItemSchema(),
      },
    },
  };
}

function unsupportedBusinessSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      purchasable_offer: {
        type: "array",
        items: {
          type: "object",
          properties: {
            audience: { type: "string", enum: ["ALL"] },
            our_price: { type: "array" },
          },
        },
      },
    },
  };
}

function stubBusinessPricingSchema(schema: Record<string, unknown>): void {
  const checksum = createHash("md5")
    .update(JSON.stringify(schema))
    .digest("base64");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url.origin === "https://api.amazon.com") {
      return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
    }
    if (url.href === SCHEMA_URL) return jsonResponse(200, schema);
    if (url.pathname.startsWith("/definitions/2020-09-01/")) {
      return jsonResponse(200, {
        schema: {
          link: { resource: SCHEMA_URL, verb: "GET" },
          checksum,
        },
      });
    }
    if (url.pathname.startsWith("/listings/2021-08-01/")) {
      return listingResponse();
    }
    throw new Error(`Unexpected request: ${url.href}`);
  }));
}

describe("Amazon Business pricing SP-API contract", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_CLIENT";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_REFRESH";
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

  it("reads the exact B2B offer and gates editing on a seller-specific offer PTD", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      urls.push(url);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(snapshot).toMatchObject({
      mode: "live",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      asin: ASIN,
      productType: "PET_FOOD",
      standardPrice: { amount: 30, currencyCode: "USD" },
      effectivePrice: { amount: 30, currencyCode: "USD" },
      businessPrice: { amount: 28, currencyCode: "USD" },
      businessOfferPresence: "present",
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        schemaChecksum: SCHEMA_CHECKSUM,
      },
    });
    const definitionUrl = urls.find((url) =>
      url.pathname.startsWith("/definitions/2020-09-01/"),
    );
    expect(definitionUrl?.searchParams.get("sellerId")).toBe(SELLER_ID);
    expect(definitionUrl?.searchParams.get("marketplaceIds")).toBe(MARKETPLACE_ID);
    expect(definitionUrl?.searchParams.get("requirements")).toBe("LISTING_OFFER_ONLY");
    expect(definitionUrl?.searchParams.get("requirementsEnforced")).toBe("NOT_ENFORCED");
  });

  it("canonicalizes one quantity-discount schedule with multiple levels", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: Array<Record<string, unknown>> };
        };
        const businessOffer = payload.attributes.purchasable_offer.find(
          (offer) => offer.audience === "B2B",
        )!;
        businessOffer.quantity_discount_plan = [{
          schedule: [{
            discount_type: "percent",
            levels: [
              { lower_bound: 5, value: 5 },
              { lower_bound: 10, value: 10 },
              { lower_bound: 15, value: 15 },
              { lower_bound: 20, value: 20 },
            ],
          }],
        }];
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(snapshot).toMatchObject({
      quantityDiscountPlanPresence: "canonical",
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [
          { lowerBound: 5, value: 5 },
          { lowerBound: 10, value: 10 },
          { lowerBound: 15, value: 15 },
          { lowerBound: 20, value: 20 },
        ],
      },
      quantityDiscountPlanHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("does not reject explicit B2B attributes when the derived view omits audience", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as {
          offers: Array<Record<string, unknown>>;
        };
        payload.offers = [{
          marketplaceId: MARKETPLACE_ID,
          offerType: "B2B",
          price: { currencyCode: "USD", amount: "28.00" },
        }];
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(snapshot.businessPrice).toEqual({
      amount: 28,
      currencyCode: "USD",
    });
    expect(snapshot.businessOfferPresence).toBe("present");
  });

  it("accepts optional-view omissions and duplicate matching product-type evidence", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as Record<string, unknown>;
        delete payload.offers;
        delete payload.issues;
        payload.productTypes = [
          { marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD" },
          { marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD" },
        ];
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      standardPrice: { amount: 30, currencyCode: "USD" },
      effectivePrice: null,
      businessPrice: { amount: 28, currencyCode: "USD" },
      businessOfferPresence: "present",
      businessPricingCapability: { supported: true, editable: true },
    });
  });

  it("rejects malformed Listing collection elements without throwing", async () => {
    let listingRead = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        listingRead += 1;
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: unknown[] };
          offers: unknown[];
          fulfillmentAvailability: unknown[];
        };
        if (listingRead === 1) payload.offers = [null];
        else if (listingRead === 2) {
          payload.attributes.purchasable_offer = [null];
        } else {
          payload.fulfillmentAvailability = [null];
        }
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(getBusinessPricing({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
      })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    }
  });

  it.each([
    "missing-summary",
    "mismatched-productTypes",
    "other-market-productTypes",
  ] as const)(
    "requires exact product type identity before B2B preview: %s",
    async (scenario) => {
      let previewPatchCount = 0;
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
        const url = urlOf(input);
        const method = init?.method ??
          (input instanceof Request ? input.method : "GET");
        if (url.origin === "https://api.amazon.com") {
          return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
        }
        if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
          const payload = await listingResponse().json() as {
            summaries: Array<Record<string, unknown>>;
            productTypes?: Array<Record<string, unknown>>;
          };
          if (scenario === "missing-summary") {
            delete payload.summaries[0]!.productType;
          } else if (scenario === "mismatched-productTypes") {
            payload.productTypes = [{
              marketplaceId: MARKETPLACE_ID,
              productType: "OTHER",
            }];
          } else {
            payload.productTypes = [{
              marketplaceId: "A2EUQ1WTGCTBG2",
              productType: "PET_FOOD",
            }];
          }
          return jsonResponse(200, payload);
        }
        if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
          previewPatchCount += 1;
          return jsonResponse(200, {});
        }
        throw new Error(`Unexpected request: ${method} ${url.href}`);
      }));

      await expect(previewBusinessPriceUpdate({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        expectedStandardPrice: 30,
        expectedBusinessPrice: 28,
        newBusinessPrice: 27.5,
      })).rejects.toMatchObject({ code: "LISTING_IDENTITY_MISMATCH" });
      expect(previewPatchCount).toBe(0);
    },
  );

  it("accepts a legacy offer currency but rejects conflicting currency fields", async () => {
    let listingRead = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        listingRead += 1;
        const payload = await listingResponse().json() as {
          offers: Array<{
            offerType?: string;
            price?: Record<string, unknown>;
          }>;
        };
        const consumerOffer = payload.offers.find(
          (offer) => offer.offerType === "B2C",
        )!;
        consumerOffer.price = listingRead === 1
          ? { currency: "USD", amount: "30.00" }
          : {
              currencyCode: "USD",
              currency: "CAD",
              amount: "30.00",
            };
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const legacy = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    const conflict = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(legacy.effectivePrice).toEqual({ amount: 30, currencyCode: "USD" });
    expect(conflict.effectivePrice).toBeNull();
  });

  it("rejects a seller-specific PTD whose schema bytes do not match its checksum", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: "AAAAAAAAAAAAAAAAAAAAAA==",
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).rejects.toMatchObject({
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
    });
  });

  it("rejects a non-AWS PTD schema URL before downloading it", async () => {
    const untrustedUrl = "https://169.254.169.254/latest/meta-data/iam";
    const seenUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      seenUrls.push(url.href);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: untrustedUrl, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).rejects.toMatchObject({ code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE" });
    expect(seenUrls).not.toContain(untrustedUrl);
  });

  it("rejects an oversized seller-specific PTD before buffering its body", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) {
        return new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/schema+json",
            "content-length": String(16 * 1024 * 1024 + 1),
          },
        });
      }
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).rejects.toMatchObject({ code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE" });
  });

  it("discards an in-flight PTD capability after Seller credentials change", async () => {
    let releaseFirstSchema!: (response: Response) => void;
    let markFirstSchemaStarted!: () => void;
    const firstSchema = new Promise<Response>((resolve) => {
      releaseFirstSchema = resolve;
    });
    const firstSchemaStarted = new Promise<void>((resolve) => {
      markFirstSchemaStarted = resolve;
    });
    let schemaCalls = 0;
    const requestedSellerIds: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) {
        schemaCalls += 1;
        if (schemaCalls === 1) {
          markFirstSchemaStarted();
          return firstSchema;
        }
        return jsonResponse(200, businessSchema());
      }
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        requestedSellerIds.push(url.searchParams.get("sellerId"));
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const stale = getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    await firstSchemaStarted;
    process.env.SP_API_SELLER_ID_NA = "FAKE_B2B_SELLER_REPLACEMENT";
    invalidateSpApiCredentialCaches();
    releaseFirstSchema(jsonResponse(200, businessSchema()));

    await expect(stale).rejects.toMatchObject({ code: "CREDENTIALS_CHANGED" });
    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: true },
    });
    expect(requestedSellerIds).toEqual([
      SELLER_ID,
      "FAKE_B2B_SELLER_REPLACEMENT",
    ]);
  });

  it("does not infer write access when the relevant PTD branch omits editable", async () => {
    const schema = businessSchema() as Record<string, unknown> & {
      properties: {
        purchasable_offer: {
          editable?: boolean;
          items: {
            properties: {
              our_price: {
                items: {
                  properties: {
                    schedule: {
                      items: {
                        properties: {
                          value_with_tax: { editable?: boolean };
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
    schema.properties.purchasable_offer.editable = true;
    delete schema.properties.purchasable_offer.items.properties.our_price.items
      .properties.schedule.items.properties.value_with_tax.editable;
    const checksum = createHash("md5")
      .update(JSON.stringify(schema))
      .digest("base64");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, schema);
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    expect(snapshot.businessPricingCapability).toMatchObject({
      supported: true,
      editable: false,
    });
  });

  it("fails price-only and combined capability closed when the exact offer requires an unsent property", async () => {
    const schema = businessSchema() as {
      properties: {
        purchasable_offer: {
          items: {
            properties: Record<string, unknown>;
            required?: string[];
            additionalProperties?: boolean;
          };
        };
      };
    };
    const offer = schema.properties.purchasable_offer.items;
    offer.properties.extra_required = { type: "string" };
    offer.required = [
      "audience",
      "currency",
      "marketplace_id",
      "our_price",
      "extra_required",
    ];
    offer.additionalProperties = false;
    stubBusinessPricingSchema(schema as unknown as Record<string, unknown>);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: {
        supported: true,
        editable: false,
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: false,
      },
    });
  });

  it("lets an explicit false on the B2B price path override an editable leaf", async () => {
    const schema = businessSchema() as Record<string, unknown> & {
      properties: {
        purchasable_offer: {
          items: {
            properties: {
              our_price: { editable?: boolean };
            };
          };
        };
      };
    };
    schema.properties.purchasable_offer.items.properties.our_price.editable = false;
    const checksum = createHash("md5")
      .update(JSON.stringify(schema))
      .digest("base64");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, schema);
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: false },
    });
  });

  it.each(["root", "attribute", "leaf"] as const)(
    "treats PTD readOnly on the selected %s as non-editable",
    async (target) => {
      const schema = businessSchema() as Record<string, unknown> & {
        properties: {
          purchasable_offer: Record<string, unknown> & {
            items: {
              properties: {
                our_price: {
                  items: {
                    properties: {
                      schedule: {
                        items: {
                          properties: {
                            value_with_tax: Record<string, unknown>;
                          };
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
      if (target === "root") {
        schema.readOnly = true;
      } else if (target === "attribute") {
        schema.properties.purchasable_offer.readOnly = true;
      } else {
        schema.properties.purchasable_offer.items.properties.our_price.items
          .properties.schedule.items.properties.value_with_tax.readOnly = true;
      }
      stubBusinessPricingSchema(schema);

      await expect(getBusinessPricing({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
      })).resolves.toMatchObject({
        businessPricingCapability: { supported: true, editable: false },
      });
    },
  );

  it("does not treat a shallow QDP array annotation as proof of tier editability", async () => {
    const offer = businessOfferItemSchema(["B2B"]) as {
      properties: Record<string, unknown>;
    };
    offer.properties.quantity_discount_plan = {
      type: "array",
      editable: true,
    };
    stubBusinessPricingSchema({
      type: "object",
      properties: {
        purchasable_offer: { type: "array", items: offer },
      },
    });

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: {
        supported: true,
        editable: true,
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: false,
      },
    });
  });

  it("fails QDP editability closed on a nested read-only leaf", async () => {
    const schema = businessSchema() as {
      properties: {
        purchasable_offer: {
          items: {
            properties: {
              quantity_discount_plan: {
                items: {
                  properties: {
                    schedule: {
                      items: {
                        properties: {
                          levels: {
                            items: {
                              properties: {
                                lower_bound: Record<string, unknown>;
                              };
                            };
                          };
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
    schema.properties.purchasable_offer.items.properties
      .quantity_discount_plan.items.properties.schedule.items.properties
      .levels.items.properties.lower_bound.readOnly = true;
    stubBusinessPricingSchema(schema as unknown as Record<string, unknown>);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: {
        editable: true,
        quantityDiscountsEditable: false,
      },
    });
  });

  it("fails QDP editability closed on a schema-valued additionalProperties constraint", async () => {
    const schema = businessSchema() as {
      properties: {
        purchasable_offer: {
          items: {
            properties: {
              quantity_discount_plan: {
                items: {
                  properties: {
                    schedule: {
                      items: {
                        properties: {
                          levels: {
                            items: Record<string, unknown>;
                          };
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
    schema.properties.purchasable_offer.items.properties
      .quantity_discount_plan.items.properties.schedule.items.properties
      .levels.items.additionalProperties = { type: "string" };
    stubBusinessPricingSchema(schema as unknown as Record<string, unknown>);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: {
        editable: true,
        quantityDiscountsEditable: false,
      },
    });
  });

  it("fails QDP editability closed on an unhandled nested applicator", async () => {
    const schema = businessSchema() as {
      properties: {
        purchasable_offer: {
          items: {
            properties: {
              quantity_discount_plan: {
                items: {
                  properties: { schedule: { items: Record<string, unknown> } };
                };
              };
            };
          };
        };
      };
    };
    schema.properties.purchasable_offer.items.properties
      .quantity_discount_plan.items.properties.schedule.items.if = {
        properties: { discount_type: { const: "percent" } },
      };
    stubBusinessPricingSchema(schema as unknown as Record<string, unknown>);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: {
        editable: true,
        quantityDiscountsEditable: false,
      },
    });
  });

  it("proves the complete QDP path through a bounded ref-only schema", async () => {
    const schema = businessSchema() as Record<string, unknown> & {
      properties: {
        purchasable_offer: {
          items: { properties: Record<string, unknown> };
        };
      };
    };
    const qdp = schema.properties.purchasable_offer.items.properties
      .quantity_discount_plan;
    schema.properties.purchasable_offer.items.properties.quantity_discount_plan = {
      $ref: "#/$defs/qdp",
      editable: true,
    };
    schema.$defs = { qdp };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: {
        editable: true,
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: true,
      },
    });
  });

  it("does not skip an editable false on an items wrapper", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            editable: false,
            oneOf: [businessOfferItemSchema()],
          },
        },
      },
    };
    const checksum = createHash("md5")
      .update(JSON.stringify(schema))
      .digest("base64");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, schema);
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: false },
    });
  });

  it("checks every path when two PTD branches share the same reference", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            oneOf: [
              { $ref: "#/$defs/businessOffer" },
              {
                editable: false,
                allOf: [{ $ref: "#/$defs/businessOffer" }],
              },
            ],
          },
        },
      },
      $defs: { businessOffer: businessOfferItemSchema() },
    };
    const checksum = createHash("md5")
      .update(JSON.stringify(schema))
      .digest("base64");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, schema);
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: false },
    });
  });

  it("does not let a read-only ALL sibling contaminate the editable B2B branch", async () => {
    const allOffer = {
      ...businessOfferItemSchema(["ALL"]),
      editable: false,
    };
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            oneOf: [allOffer, businessOfferItemSchema(["B2B"])],
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: true },
    });
  });

  it("fails closed on a conditional B2B price restriction in an allOf sibling", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            allOf: [
              businessOfferItemSchema(["B2B"]),
              {
                if: {
                  properties: {
                    audience: { const: "B2B" },
                  },
                },
                then: {
                  properties: {
                    our_price: { editable: false },
                  },
                },
              },
            ],
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: false },
    });
  });

  it("composes a partial read-only price restriction from an allOf sibling", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            allOf: [
              businessOfferItemSchema(["B2B"]),
              { properties: { our_price: { editable: false } } },
            ],
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: false },
    });
  });

  it("does not prove B2B when a selector pattern contradicts its enum", async () => {
    const offer = businessOfferItemSchema(["B2B"]) as {
      properties: Record<string, unknown>;
    };
    offer.properties.audience = {
      enum: ["B2B"],
      pattern: "^ALL$",
    };
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: { type: "array", items: offer },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: false, editable: false },
    });
  });

  it("fails closed when a generic oneOf sibling also matches B2B", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            oneOf: [
              businessOfferItemSchema(["B2B"]),
              { type: "object" },
            ],
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: false },
    });
  });

  it("fails closed when a generic anyOf sibling may add a read-only rule", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            anyOf: [
              businessOfferItemSchema(["B2B"]),
              { type: "object", editable: false },
            ],
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: false },
    });
  });

  it("fails closed when a ref sibling contradicts the direct B2B selector", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            ...businessOfferItemSchema(["B2B"]),
            $ref: "#/$defs/allOnly",
          },
        },
      },
      $defs: {
        allOnly: { properties: { audience: { const: "ALL" } } },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("fails closed when a ref sibling adds a read-only price restriction", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            ...businessOfferItemSchema(["B2B"]),
            $ref: "#/$defs/readOnlyPrice",
          },
        },
      },
      $defs: {
        readOnlyPrice: { properties: { our_price: { editable: false } } },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("fails closed when an object applicator contradicts the direct selector", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            ...businessOfferItemSchema(["B2B"]),
            patternProperties: {
              "^audience$": { const: "ALL" },
            },
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("fails closed when a direct offer has an adjacent selected disjunction", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            ...businessOfferItemSchema(["B2B"]),
            oneOf: [
              {
                properties: {
                  audience: { const: "B2B" },
                  currency: { const: "CAD" },
                },
              },
              { properties: { audience: { const: "ALL" } } },
            ],
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("fails closed on an unhandled applicator along the selected price path", async () => {
    const offer = businessOfferItemSchema(["B2B"]);
    const properties = offer.properties as Record<string, unknown>;
    const price = properties.our_price as Record<string, unknown>;
    const priceItem = price.items as Record<string, unknown>;
    priceItem.patternProperties = {
      "^schedule$": { editable: false },
    };
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: { type: "array", items: offer },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("requires the offer contribution to be an object schema", async () => {
    const offer = businessOfferItemSchema(["B2B"]);
    offer.type = "string";
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: { type: "array", items: offer },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("does not discover offer properties or items on the wrong structural type", async () => {
    const fakeOffer = businessOfferItemSchema(["B2B"]);
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          properties: fakeOffer.properties,
          items: {
            type: "object",
            items: fakeOffer,
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("requires each selected price container to accept one array item", async () => {
    const offer = businessOfferItemSchema(["B2B"]);
    const properties = offer.properties as Record<string, unknown>;
    const price = properties.our_price as Record<string, unknown>;
    price.type = "string";
    price.maxItems = 0;
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: { type: "array", items: offer },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("requires the editable Business Price leaf to accept a number", async () => {
    const offer = businessOfferItemSchema(["B2B"]);
    const properties = offer.properties as Record<string, unknown>;
    const price = properties.our_price as Record<string, unknown>;
    const priceItem = price.items as Record<string, unknown>;
    const priceProperties = priceItem.properties as Record<string, unknown>;
    const schedule = priceProperties.schedule as Record<string, unknown>;
    const scheduleItem = schedule.items as Record<string, unknown>;
    const scheduleProperties = scheduleItem.properties as Record<string, unknown>;
    const valueWithTax = scheduleProperties.value_with_tax as Record<string, unknown>;
    valueWithTax.type = "string";
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: { type: "array", items: offer },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("rejects adjacent ref constraints along the selected price path", async () => {
    const offer = businessOfferItemSchema(["B2B"]);
    const properties = offer.properties as Record<string, unknown>;
    const price = properties.our_price as Record<string, unknown>;
    const priceItem = price.items as Record<string, unknown>;
    priceItem.$ref = "#/$defs/priceItem";
    priceItem.additionalProperties = { editable: false };
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: { type: "array", items: offer },
      },
      $defs: {
        priceItem: {
          type: "object",
          properties: priceItem.properties,
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("accepts a ref-only numeric leaf with Amazon editability annotations", async () => {
    const offer = businessOfferItemSchema(["B2B"]);
    const properties = offer.properties as Record<string, unknown>;
    const price = properties.our_price as Record<string, unknown>;
    const priceItem = price.items as { properties: Record<string, unknown> };
    const schedule = priceItem.properties.schedule as Record<string, unknown>;
    const scheduleItem = schedule.items as { properties: Record<string, unknown> };
    scheduleItem.properties.value_with_tax = {
      $ref: "#/$defs/businessMoney",
      editable: true,
      hidden: false,
    };
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: { type: "array", items: offer },
      },
      $defs: { businessMoney: { type: "number" } },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: true },
    });
  });

  it.each(["array-const", "object-cardinality"] as const)(
    "fails closed on an unproved selected price assertion: %s",
    async (constraint) => {
      const offer = businessOfferItemSchema(["B2B"]);
      const properties = offer.properties as Record<string, unknown>;
      const price = properties.our_price as Record<string, unknown>;
      if (constraint === "array-const") {
        price.const = [];
      } else {
        const priceItem = price.items as Record<string, unknown>;
        priceItem.maxProperties = 0;
      }
      const schema = {
        type: "object",
        properties: {
          purchasable_offer: { type: "array", items: offer },
        },
      };
      stubBusinessPricingSchema(schema);

      await expect(getBusinessPricing({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
      })).resolves.toMatchObject({
        businessPricingCapability: { editable: false },
      });
    },
  );

  it("requires the PTD root to describe an object before discovering offers", async () => {
    const schema = businessSchema();
    schema.type = "string";
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("fails closed when a root ref sibling contradicts the direct offer schema", async () => {
    const schema = {
      ...businessSchema(),
      $ref: "#/$defs/nonObject",
      $defs: { nonObject: { type: "string" } },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("fails closed on an unhandled root dependency that can restrict offers", async () => {
    const schema = {
      ...businessSchema(),
      dependencies: {
        purchasable_offer: {
          properties: { purchasable_offer: { editable: false } },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("accepts Amazon lifecycle annotations and unique-selector array bounds", async () => {
    const schema = businessSchema() as Record<string, unknown> & {
      properties: {
        purchasable_offer: Record<string, unknown> & {
          items: { properties: Record<string, unknown> };
        };
      };
    };
    schema.$lifecycle = "active";
    schema.properties.purchasable_offer.minUniqueItems = 1;
    schema.properties.purchasable_offer.maxUniqueItems = 1;
    schema.properties.purchasable_offer.replacedBy = [];
    const offer = schema.properties.purchasable_offer.items;
    const audience = offer.properties.audience as Record<string, unknown>;
    audience.enumDeprecated = [false, false];
    const price = offer.properties.our_price as Record<string, unknown>;
    price.minUniqueItems = 1;
    price.maxUniqueItems = 1;
    const priceItem = price.items as { properties: Record<string, unknown> };
    const schedule = priceItem.properties.schedule as Record<string, unknown>;
    schedule.minUniqueItems = 1;
    schedule.maxUniqueItems = 1;
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: true },
    });
  });

  it("does not treat a negated B2B schema as positive write capability", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            not: businessOfferItemSchema(["B2B"]),
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: false, editable: false },
    });
  });

  it("does not treat an if predicate as positive B2B write capability", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            if: businessOfferItemSchema(["B2B"]),
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: false, editable: false },
    });
  });

  it("honors allOf intersections that exclude the B2B audience", async () => {
    const offer = businessOfferItemSchema(["ALL", "B2B"]) as {
      properties: Record<string, unknown>;
    };
    offer.properties.audience = {
      allOf: [
        { enum: ["ALL", "B2B"] },
        { enum: ["ALL"] },
      ],
    };
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: offer,
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: false, editable: false },
    });
  });

  it("applies a root allOf restriction to the B2B offer attribute", async () => {
    const schema = {
      ...businessSchema(),
      allOf: [{
        properties: {
          purchasable_offer: { editable: false },
        },
      }],
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { supported: true, editable: false },
    });
  });

  it("fails closed when an allOf conjunct is the false schema", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          items: {
            allOf: [businessOfferItemSchema(["B2B"]), false],
          },
        },
      },
    };
    stubBusinessPricingSchema(schema);

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPricingCapability: { editable: false },
    });
  });

  it("does not combine B2B audience and price from different PTD branches", async () => {
    const schema = {
      type: "object",
      properties: {
        purchasable_offer: {
          type: "array",
          editable: true,
          items: {
            oneOf: [{
              type: "object",
              properties: {
                audience: { type: "string", enum: ["B2B"] },
              },
            }, {
              type: "object",
              properties: {
                audience: { type: "string", enum: ["ALL"] },
                our_price: { type: "array", editable: true },
              },
            }],
          },
        },
      },
    };
    const checksum = createHash("md5")
      .update(JSON.stringify(schema))
      .digest("base64");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, schema);
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        return listingResponse();
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    expect(snapshot.businessPricingCapability).toMatchObject({
      supported: false,
      editable: false,
    });
  });

  it("fails closed when a B2B offer contains more than one price schedule", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: Array<Record<string, unknown>> };
        };
        const businessOffer = payload.attributes.purchasable_offer.find(
          (offer) => offer.audience === "B2B",
        )!;
        businessOffer.our_price = [{
          schedule: [
            { value_with_tax: 28 },
            { value_with_tax: 27, start_at: "2026-09-01" },
          ],
        }];
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(snapshot.businessPrice).toBeNull();
    expect(snapshot.businessOfferPresence).toBe("ambiguous");
  });

  it("fails closed when a B2B base-price schedule carries unpreserved metadata", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: Array<Record<string, unknown>> };
        };
        const businessOffer = payload.attributes.purchasable_offer.find(
          (offer) => offer.audience === "B2B",
        )!;
        businessOffer.our_price = [{
          schedule: [{ value_with_tax: 28, start_at: "2026-09-01" }],
        }];
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPrice: null,
      businessOfferPresence: "ambiguous",
    });
  });

  it("rejects an ambiguous standard-price schedule before B2B preview", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: Array<Record<string, unknown>> };
        };
        const standardOffer = payload.attributes.purchasable_offer.find(
          (offer) => offer.audience === "ALL",
        )!;
        standardOffer.our_price = [{
          schedule: [
            { value_with_tax: 30 },
            { value_with_tax: 29, start_at: "2026-09-01" },
          ],
        }];
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(previewBusinessPriceUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27.5,
    })).rejects.toMatchObject({ code: "B2B_PRICE_EVIDENCE_INCOMPLETE" });
  });

  it("uses explicit B2B attributes as presence truth when a derived B2B view remains", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: Array<Record<string, unknown>> };
        };
        payload.attributes.purchasable_offer =
          payload.attributes.purchasable_offer.filter(
            (offer) => offer.audience !== "B2B",
          );
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    expect(snapshot.businessPrice).toBeNull();
    expect(snapshot.businessOfferPresence).toBe("absent");
  });

  it("does not confuse an IVP derived offer with the explicit base B2B price", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as {
          offers: Array<Record<string, unknown>>;
        };
        payload.offers.push({
          marketplaceId: MARKETPLACE_ID,
          offerType: "B2B",
          price: { currencyCode: "USD", amount: "25.00" },
          audience: {
            value: "B2B_EDUCATION",
            displayName: "Education",
          },
        });
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(snapshot.businessPrice).toEqual({
      amount: 28,
      currencyCode: "USD",
    });
    expect(snapshot.businessOfferPresence).toBe("present");
  });

  it("ignores an explicit B2B contribution for another marketplace", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: Array<Record<string, unknown>> };
        };
        const businessOffer = payload.attributes.purchasable_offer.find(
          (offer) => offer.audience === "B2B",
        )!;
        businessOffer.marketplace_id = "A2EUQ1WTGCTBG2";
        businessOffer.currency = "CAD";
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    await expect(getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).resolves.toMatchObject({
      businessPrice: null,
      businessOfferPresence: "absent",
    });
  });

  it("guards every non-target offer field against readback drift", async () => {
    let listingRead = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/")) {
        listingRead += 1;
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: Array<Record<string, unknown>> };
        };
        if (listingRead === 2) {
          const standardOffer = payload.attributes.purchasable_offer.find(
            (offer) => offer.audience === "ALL",
          )!;
          standardOffer.discounted_price = [{
            schedule: [{ value_with_tax: 24, start_at: "2026-09-01" }],
          }];
        }
        return jsonResponse(200, payload);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const before = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    const after = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(before.businessPrice).toEqual(after.businessPrice);
    expect(before.standardPrice).toEqual(after.standardPrice);
    expect(before.businessOfferGuardHash).not.toBe(
      after.businessOfferGuardHash,
    );
  });

  it("returns a self-consistent FBA-only audit snapshot in demo mode", async () => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();

    const snapshot = await getBusinessPricingAuditData({
      marketplaceId: MARKETPLACE_ID,
      reportId: `demo-${MARKETPLACE_ID}`,
      documentId: `demo-${MARKETPLACE_ID}`,
    });

    expect(snapshot.mode).toBe("demo");
    expect(snapshot.marketplaceId).toBe(MARKETPLACE_ID);
    expect(snapshot.rows.length).toBeGreaterThan(0);
    expect(new Set(snapshot.rows.map((row) => row.sellerSku)).size).toBe(
      snapshot.rows.length,
    );
    expect(snapshot.summary).toEqual({
      totalFbaSkuCount: snapshot.rows.length,
      configured: snapshot.rows.filter((row) => row.status === "configured").length,
      aboveStandard: snapshot.rows.filter((row) =>
        row.status === "above_standard"
      ).length,
      missing: snapshot.rows.filter((row) => row.status === "missing").length,
      unsupported: snapshot.rows.filter((row) => row.status === "unsupported").length,
      incomplete: snapshot.rows.filter((row) => row.status === "incomplete").length,
    });
    expect(snapshot.rows.every((row) =>
      row.reason.length > 0 &&
      (row.status === "configured" || row.status === "above_standard" ||
        row.status === "missing") === row.editable
    )).toBe(true);
  });

  it("flags a canonical B2B base price above the canonical standard price", async () => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
    const initial = await getBusinessPricingAuditData({
      marketplaceId: MARKETPLACE_ID,
      reportId: `demo-${MARKETPLACE_ID}`,
      documentId: `demo-${MARKETPLACE_ID}`,
    });
    const configured = initial.rows.find((row) =>
      row.status === "configured" && row.standardPrice && row.businessPrice
    );
    if (!configured?.standardPrice || !configured.businessPrice) {
      throw new Error("Expected one configured demo B2B listing");
    }
    await updateBusinessPrice({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: configured.sellerSku,
      expectedStandardPrice: configured.standardPrice.amount,
      expectedBusinessPrice: configured.businessPrice.amount,
      newBusinessPrice: configured.standardPrice.amount + 1,
    });

    const audited = await getBusinessPricingAuditData({
      marketplaceId: MARKETPLACE_ID,
      reportId: `demo-${MARKETPLACE_ID}`,
      documentId: `demo-${MARKETPLACE_ID}`,
    });
    const row = audited.rows.find((item) =>
      item.sellerSku === configured.sellerSku
    );

    expect(row).toMatchObject({
      status: "above_standard",
      editable: true,
      reason: expect.stringMatching(/高於一般售價/u),
    });
    expect(audited.summary.aboveStandard).toBe(1);
  });

  it("round-trips explicit demo tiers while price-only preserves the canonical QDP", async () => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
    const sellerSku = "AFA-TRKY-4OZ";
    const before = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku,
    });
    if (!before.standardPrice) throw new Error("Expected demo standard price");
    expect(before.quantityDiscountPlanPresence).toBe("absent");
    const tiers = [
      { lowerBound: 5, percent: 5 },
      { lowerBound: 10, percent: 10 },
      { lowerBound: 15, percent: 15 },
      { lowerBound: 20, percent: 20 },
    ];
    const firstPrice = Number((before.standardPrice.amount - 1).toFixed(2));
    await updateBusinessPrice({
      marketplaceId: MARKETPLACE_ID,
      sellerSku,
      expectedStandardPrice: before.standardPrice.amount,
      expectedBusinessPrice: before.businessPrice?.amount ?? null,
      newBusinessPrice: firstPrice,
      expectedQuantityDiscountPlanHash: null,
      quantityDiscountTiers: tiers,
    });
    const combined = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku,
    });
    expect(combined.quantityDiscountPlan).toEqual({
      discountType: "percent",
      levels: tiers.map((tier) => ({
        lowerBound: tier.lowerBound,
        value: tier.percent,
      })),
    });
    expect(combined.quantityDiscountPlanPresence).toBe("canonical");
    expect(combined.quantityDiscountPlanHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(combined.businessOfferGuardHash).not.toBe(
      before.businessOfferGuardHash,
    );
    expect(combined.businessOfferProtectedHash).toBe(
      before.businessOfferProtectedHash,
    );

    const audited = await getBusinessPricingAuditData({
      marketplaceId: MARKETPLACE_ID,
      reportId: `demo-${MARKETPLACE_ID}`,
      documentId: `demo-${MARKETPLACE_ID}`,
    });
    expect(audited.rows.find((row) => row.sellerSku === sellerSku)).toMatchObject({
      quantityDiscountPlanPresence: "canonical",
      quantityDiscountPlan: {
        discountType: "percent",
        levels: tiers.map((tier) => ({
          lowerBound: tier.lowerBound,
          value: tier.percent,
        })),
      },
    });

    await updateBusinessPrice({
      marketplaceId: MARKETPLACE_ID,
      sellerSku,
      expectedStandardPrice: before.standardPrice.amount,
      expectedBusinessPrice: firstPrice,
      newBusinessPrice: Number((before.standardPrice.amount - 2).toFixed(2)),
    });
    const priceOnly = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku,
    });
    expect(priceOnly.quantityDiscountPlan).toEqual(
      combined.quantityDiscountPlan,
    );
    expect(priceOnly.quantityDiscountPlanHash).toBe(
      combined.quantityDiscountPlanHash,
    );
    await expect(previewBusinessPriceUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku,
      expectedStandardPrice: before.standardPrice.amount,
      expectedBusinessPrice: priceOnly.businessPrice!.amount,
      newBusinessPrice: priceOnly.businessPrice!.amount,
      expectedQuantityDiscountPlanHash: priceOnly.quantityDiscountPlanHash,
      quantityDiscountTiers: tiers,
    })).rejects.toMatchObject({ code: "BUSINESS_PRICE_UNCHANGED" });
  });

  it("uses ACTL05's exact report Business Price as read-only evidence when Listings omits B2B", async () => {
    const reportId = "B2B-REPORT-EVIDENCE-AUDIT";
    const documentId = "B2B-REPORT-EVIDENCE-DOCUMENT";
    const reportUrl =
      "https://reports.example.cloudfront.net/b2b-report-evidence.tsv";
    const report = [
      "seller-sku\tasin\titem-name\tfulfillment-channel\tbusiness-price",
      "ACTL05\tB000000021\tReport-only Business Price\tAMAZON_NA\t12.60",
      "MATCH\tB000000022\tMatching Business Price\tAMAZON_NA\t12.60",
      "CONFLICT\tB000000023\tConflicting Business Price\tAMAZON_NA\t12.60",
      "BLANK\tB000000024\tNo Business Price\tAMAZON_NA\t",
      "CANONICAL-WINS\tB000000025\tCanonical Business Price\tAMAZON_NA\tUSD 12.60",
    ].join("\n");
    const listing = (
      sku: string,
      asin: string,
      businessPrice?: number,
      offers?: unknown[],
    ) => ({
      sku,
      summaries: [{
        marketplaceId: MARKETPLACE_ID,
        asin,
        productType: "PET_FOOD",
        itemName: `${sku} listing`,
      }],
      productTypes: [{ marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD" }],
      attributes: {
        purchasable_offer: [
          {
            audience: "ALL",
            currency: "USD",
            marketplace_id: MARKETPLACE_ID,
            our_price: [{ schedule: [{ value_with_tax: 15 }] }],
          },
          ...(businessPrice === undefined
            ? []
            : [{
                audience: "B2B",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [{ value_with_tax: businessPrice }] }],
              }]),
        ],
      },
      ...(offers === undefined ? {} : { offers }),
      issues: [],
      fulfillmentAvailability: [{
        fulfillmentChannelCode: "AMAZON_NA",
        quantity: 3,
      }],
    });

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.pathname === `/reports/2021-06-30/reports/${reportId}`) {
        return jsonResponse(200, {
          reportId,
          reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
          marketplaceIds: [MARKETPLACE_ID],
          processingStatus: "DONE",
          reportDocumentId: documentId,
        });
      }
      if (url.pathname === `/reports/2021-06-30/documents/${documentId}`) {
        return jsonResponse(200, { url: reportUrl });
      }
      if (url.href === reportUrl) return new Response(report);
      if (url.href === SCHEMA_URL) {
        return jsonResponse(200, businessSchema());
      }
      if (url.pathname.endsWith("/productTypes/PET_FOOD")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname === `/listings/2021-08-01/items/${SELLER_ID}`) {
        return jsonResponse(200, {
          numberOfResults: 5,
          items: [
            listing("ACTL05", "B000000021"),
            listing("MATCH", "B000000022", 12.6),
            listing("CONFLICT", "B000000023", 12.5),
            listing("BLANK", "B000000024", undefined, [{
              marketplaceId: MARKETPLACE_ID,
              offerType: "B2B",
              price: { currencyCode: "USD", amount: "11.00" },
            }]),
            listing("CANONICAL-WINS", "B000000025", 12.6),
          ],
        });
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricingAuditData({
      marketplaceId: MARKETPLACE_ID,
      reportId,
      documentId,
    });

    expect(snapshot.rows.find((row) => row.sellerSku === "ACTL05"))
      .toMatchObject({
        businessPrice: { amount: 12.6, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "ambiguous",
        status: "configured",
        editable: false,
        reason: expect.stringMatching(/全商品報表.*Listings.*唯讀/u),
      });
    expect(snapshot.rows.find((row) => row.sellerSku === "MATCH"))
      .toMatchObject({
        businessPrice: { amount: 12.6, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlanPresence: "absent",
        status: "configured",
        editable: true,
      });
    expect(snapshot.rows.find((row) => row.sellerSku === "CONFLICT"))
      .toMatchObject({
        businessPrice: null,
        businessOfferPresence: "ambiguous",
        status: "incomplete",
        editable: false,
        reason: expect.stringMatching(/全商品報表.*Listings.*不一致/u),
      });
    expect(snapshot.rows.find((row) => row.sellerSku === "BLANK"))
      .toMatchObject({
        businessPrice: null,
        businessOfferPresence: "absent",
        status: "missing",
        editable: true,
      });
    expect(snapshot.rows.find((row) => row.sellerSku === "CANONICAL-WINS"))
      .toMatchObject({
        businessPrice: { amount: 12.6, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlanPresence: "absent",
        status: "configured",
        editable: true,
      });
    expect(snapshot.summary).toEqual({
      totalFbaSkuCount: 5,
      configured: 3,
      aboveStandard: 0,
      missing: 1,
      unsupported: 0,
      incomplete: 1,
    });
  });

  it("keeps supported, unsupported, and incomplete live rows distinct", async () => {
    const reportId = "B2B-AUDIT-REPORT";
    const documentId = "B2B-AUDIT-DOCUMENT";
    const reportUrl = "https://reports.example.cloudfront.net/b2b-audit.tsv";
    const report = [
      "seller-sku\tasin\titem-name\tfulfillment-channel",
      "CONFIGURED\tB000000001\tConfigured item\tAMAZON_NA",
      "MISSING\tB000000002\tMissing item\tAMAZON_NA",
      "UNSUPPORTED\tB000000003\tUnsupported item\tAMAZON_NA",
      "CONFIGURED-UNSUPPORTED\tB000000010\tConfigured read-only item\tAMAZON_NA",
      "INCOMPLETE\tB000000004\tIncomplete item\tAMAZON_NA",
      "AMBIGUOUS-UNSUPPORTED\tB000000006\tAmbiguous unsupported item\tAMAZON_NA",
      "INVALID-IMAGE\tB000000007\tImage issue item\tAMAZON_NA",
      "INVALID-PRICE\tB000000008\tPrice issue item\tAMAZON_NA",
      "MALFORMED-ISSUE\tB000000011\tMalformed issue item\tAMAZON_NA",
      "MALFORMED-SCOPE\tB000000012\tMalformed scope item\tAMAZON_NA",
      "MALFORMED-FULFILLMENT\tB000000013\tMalformed fulfillment item\tAMAZON_NA",
      "OTHER-MARKET-PRICE\tB000000009\tOther marketplace issue item\tAMAZON_NA",
      "FBM-IGNORED\tB000000005\tFBM item\tDEFAULT",
    ].join("\n");
    const supportedSchemaUrl =
      "https://selling-partner-definitions-prod-na.s3.amazonaws.com/pet-food-b2b.json";
    const unsupportedSchemaUrl =
      "https://selling-partner-definitions-prod-na.s3.amazonaws.com/other-no-b2b.json";
    const supportedChecksum = createHash("md5")
      .update(JSON.stringify(businessSchema()))
      .digest("base64");
    const unsupportedChecksum = createHash("md5")
      .update(JSON.stringify(unsupportedBusinessSchema()))
      .digest("base64");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.pathname === `/reports/2021-06-30/reports/${reportId}`) {
        return jsonResponse(200, {
          reportId,
          reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
          marketplaceIds: [MARKETPLACE_ID],
          processingStatus: "DONE",
          reportDocumentId: documentId,
        });
      }
      if (url.pathname === `/reports/2021-06-30/documents/${documentId}`) {
        return jsonResponse(200, { url: reportUrl });
      }
      if (url.href === reportUrl) return new Response(report);
      if (url.href === supportedSchemaUrl) {
        return jsonResponse(200, businessSchema());
      }
      if (url.href === unsupportedSchemaUrl) {
        return jsonResponse(200, unsupportedBusinessSchema());
      }
      if (url.pathname.endsWith("/productTypes/PET_FOOD")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: supportedSchemaUrl, verb: "GET" },
            checksum: supportedChecksum,
          },
        });
      }
      if (url.pathname.endsWith("/productTypes/OTHER")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: unsupportedSchemaUrl, verb: "GET" },
            checksum: unsupportedChecksum,
          },
        });
      }
      if (url.pathname === `/listings/2021-08-01/items/${SELLER_ID}`) {
        const listing = (
          sku: string,
          asin: string,
          productType: string,
          purchasableOffer: unknown,
          offers?: unknown[],
          issues?: unknown[],
        ) => ({
          sku,
          summaries: [{
            marketplaceId: MARKETPLACE_ID,
            asin,
            productType,
            itemName: `${sku} listing`,
          }],
          productTypes: [{ marketplaceId: MARKETPLACE_ID, productType }],
          ...(purchasableOffer === undefined
            ? {}
            : { attributes: { purchasable_offer: purchasableOffer } }),
          ...(offers === undefined ? {} : { offers }),
          ...(issues === undefined ? {} : { issues }),
          fulfillmentAvailability: [{
            fulfillmentChannelCode: "AMAZON_NA",
            quantity: 3,
          }],
        });
        return jsonResponse(200, {
          numberOfResults: 12,
          items: [
            listing("AMBIGUOUS-UNSUPPORTED", "B000000006", "OTHER", [
              {
                audience: "ALL",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [{ value_with_tax: 25 }] }],
              },
              {
                audience: "B2B",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [
                  { value_with_tax: 23 },
                  { value_with_tax: 22, start_at: "2026-09-01" },
                ] }],
              },
            ]),
            listing("CONFIGURED", "B000000001", "PET_FOOD", [
              {
                audience: "ALL",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [{ value_with_tax: 30 }] }],
              },
              {
                audience: "B2B",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [{ value_with_tax: 27 }] }],
              },
            ]),
            listing("MISSING", "B000000002", "PET_FOOD", [{
              audience: "ALL",
              currency: "USD",
              marketplace_id: MARKETPLACE_ID,
              our_price: [{ schedule: [{ value_with_tax: 20 }] }],
            }]),
            listing("UNSUPPORTED", "B000000003", "OTHER", [{
              audience: "ALL",
              currency: "USD",
              marketplace_id: MARKETPLACE_ID,
              our_price: [{ schedule: [{ value_with_tax: 18 }] }],
            }]),
            listing("CONFIGURED-UNSUPPORTED", "B000000010", "OTHER", [
              {
                audience: "ALL",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [{ value_with_tax: 19 }] }],
              },
              {
                audience: "B2B",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [{ value_with_tax: 17 }] }],
              },
            ]),
            listing("INCOMPLETE", "B000000004", "PET_FOOD", [
              {
                audience: "ALL",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [{ value_with_tax: 15 }] }],
              },
              {
                audience: "B2B",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [
                  { value_with_tax: 13.5 },
                  { value_with_tax: 12.5, start_at: "2026-09-01" },
                ] }],
              },
            ]),
            listing("INVALID-IMAGE", "B000000007", "PET_FOOD", [{
              audience: "ALL",
              currency: "USD",
              marketplace_id: MARKETPLACE_ID,
              our_price: [{ schedule: [{ value_with_tax: 17 }] }],
            }], [], [{
              code: "18027",
              severity: "ERROR",
              message: "Image is invalid.",
              categories: ["INVALID_IMAGE"],
            }]),
            listing("INVALID-PRICE", "B000000008", "PET_FOOD", [{
              audience: "ALL",
              currency: "USD",
              marketplace_id: MARKETPLACE_ID,
              our_price: [{ schedule: [{ value_with_tax: 16 }] }],
            }], [], [{
              code: "90220",
              severity: "ERROR",
              message: "Price is invalid.",
              categories: ["INVALID_PRICE"],
            }]),
            listing("MALFORMED-ISSUE", "B000000011", "PET_FOOD", [{
              audience: "ALL",
              currency: "USD",
              marketplace_id: MARKETPLACE_ID,
              our_price: [{ schedule: [{ value_with_tax: 15 }] }],
            }], [], [{ severity: "ERROR" }]),
            listing("MALFORMED-SCOPE", "B000000012", "PET_FOOD", [{
              audience: "ALL",
              currency: "USD",
              marketplace_id: MARKETPLACE_ID,
              our_price: [{ schedule: [{ value_with_tax: 15 }] }],
            }], [], [{
              code: "90220",
              severity: "ERROR",
              message: "Malformed marketplace scope.",
              categories: ["INVALID_PRICE"],
              marketplaceIds: [` ${MARKETPLACE_ID}`],
            }]),
            {
              ...listing("MALFORMED-FULFILLMENT", "B000000013", "PET_FOOD", [{
                audience: "ALL",
                currency: "USD",
                marketplace_id: MARKETPLACE_ID,
                our_price: [{ schedule: [{ value_with_tax: 15 }] }],
              }]),
              fulfillmentAvailability: [null],
            },
            listing("OTHER-MARKET-PRICE", "B000000009", "PET_FOOD", [{
              audience: "ALL",
              currency: "USD",
              marketplace_id: MARKETPLACE_ID,
              our_price: [{ schedule: [{ value_with_tax: 14 }] }],
            }], [], [{
              code: "90220",
              severity: "ERROR",
              message: "Price is invalid for another marketplace.",
              categories: ["INVALID_PRICE"],
              marketplaceIds: ["A2EUQ1WTGCTBG2"],
            }]),
          ],
        });
      }
      throw new Error(`Unexpected request: ${url.href}`);
    }));

    const snapshot = await getBusinessPricingAuditData({
      marketplaceId: MARKETPLACE_ID,
      reportId,
      documentId,
    });

    expect(snapshot.rows.map((row) => [row.sellerSku, row.status, row.editable]))
      .toEqual([
        ["AMBIGUOUS-UNSUPPORTED", "incomplete", false],
        ["CONFIGURED", "configured", true],
        ["CONFIGURED-UNSUPPORTED", "configured", false],
        ["INCOMPLETE", "incomplete", false],
        ["INVALID-IMAGE", "missing", true],
        ["INVALID-PRICE", "incomplete", false],
        ["MALFORMED-FULFILLMENT", "incomplete", false],
        ["MALFORMED-ISSUE", "incomplete", false],
        ["MALFORMED-SCOPE", "incomplete", false],
        ["MISSING", "missing", true],
        ["OTHER-MARKET-PRICE", "missing", true],
        ["UNSUPPORTED", "missing", false],
      ]);
    expect(snapshot.rows.find((row) => row.sellerSku === "CONFIGURED"))
      .toMatchObject({
        standardPrice: { amount: 30, currencyCode: "USD" },
        businessPrice: { amount: 27, currencyCode: "USD" },
        businessOfferPresence: "present",
      });
    expect(snapshot.summary).toEqual({
      totalFbaSkuCount: 12,
      configured: 2,
      aboveStandard: 0,
      missing: 4,
      unsupported: 0,
      incomplete: 6,
    });
    expect(snapshot.rows.find((row) => row.sellerSku === "UNSUPPORTED")?.reason)
      .toMatch(/尚未設定.*PTD/u);
    expect(snapshot.rows.find((row) =>
      row.sellerSku === "CONFIGURED-UNSUPPORTED"
    )?.reason).toMatch(/已設定.*PTD/u);
  });

  it("previews an exact B2B-only merge and validates the returned identifier", async () => {
    let previewBody: unknown = null;
    const previewUrls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (
        url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH" &&
        url.searchParams.get("mode") === "VALIDATION_PREVIEW"
      ) {
        previewUrls.push(url);
        previewBody = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: "B2B-PREVIEW-1",
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: [],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));

    const result = await previewBusinessPriceUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27.5,
    });

    expect(result).toMatchObject({
      mode: "live",
      status: "VALID",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      standardPrice: { amount: 30, currencyCode: "USD" },
      previousBusinessPrice: { amount: 28, currencyCode: "USD" },
      requestedBusinessPrice: { amount: 27.5, currencyCode: "USD" },
      schemaChecksum: SCHEMA_CHECKSUM,
    });
    expect(previewUrls).toHaveLength(1);
    expect(previewUrls[0]!.searchParams.get("includedData")).toBe(
      "identifiers,issues",
    );
    expect(previewBody).toEqual({
      productType: "PET_FOOD",
      patches: [{
        op: "merge",
        path: "/attributes/purchasable_offer",
        value: [{
          marketplace_id: MARKETPLACE_ID,
          currency: "USD",
          audience: "B2B",
          our_price: [{ schedule: [{ value_with_tax: 27.5 }] }],
        }],
      }],
    });
  });

  it("previews one explicit B2B contribution containing price and percent tiers", async () => {
    let previewBody: unknown = null;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (
        url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH" &&
        url.searchParams.get("mode") === "VALIDATION_PREVIEW"
      ) {
        previewBody = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: "B2B-PREVIEW-TIERS-1",
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: [],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));
    const expectedQuantityDiscountPlanHash = createHash("sha256")
      .update(JSON.stringify({
        discountType: "fixed",
        levels: [{ lowerBound: 5, value: 25 }],
      }))
      .digest("hex");

    const result = await previewBusinessPriceUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 29,
      expectedQuantityDiscountPlanHash,
      quantityDiscountTiers: [
        { lowerBound: 5, percent: 5 },
        { lowerBound: 10, percent: 10 },
        { lowerBound: 15, percent: 15 },
        { lowerBound: 20, percent: 20 },
      ],
    });

    expect(result).toMatchObject({
      quantityDiscountPlanChange: "replace",
      previousQuantityDiscountPlan: {
        discountType: "fixed",
        levels: [{ lowerBound: 5, value: 25 }],
      },
      requestedQuantityDiscountPlan: {
        discountType: "percent",
        levels: [
          { lowerBound: 5, value: 5 },
          { lowerBound: 10, value: 10 },
          { lowerBound: 15, value: 15 },
          { lowerBound: 20, value: 20 },
        ],
      },
    });
    expect(previewBody).toEqual({
      productType: "PET_FOOD",
      patches: [{
        op: "merge",
        path: "/attributes/purchasable_offer",
        value: [{
          marketplace_id: MARKETPLACE_ID,
          currency: "USD",
          audience: "B2B",
          our_price: [{ schedule: [{ value_with_tax: 29 }] }],
          quantity_discount_plan: [{
            schedule: [{
              discount_type: "percent",
              levels: [
                { lower_bound: 5, value: 5 },
                { lower_bound: 10, value: 10 },
                { lower_bound: 15, value: 15 },
                { lower_bound: 20, value: 20 },
              ],
            }],
          }],
        }],
      }],
    });
  });

  it("rejects custom tiers that violate the exact selected QDP numeric constraints before Amazon Preview", async () => {
    const schema = businessSchema() as {
      properties: {
        purchasable_offer: {
          items: {
            properties: {
              quantity_discount_plan: {
                items: {
                  properties: {
                    schedule: {
                      items: {
                        properties: {
                          levels: {
                            items: {
                              properties: {
                                lower_bound: Record<string, unknown>;
                                value: Record<string, unknown>;
                              };
                            };
                          };
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
    const levelProperties = schema.properties.purchasable_offer.items.properties
      .quantity_discount_plan.items.properties.schedule.items.properties.levels
      .items.properties;
    levelProperties.lower_bound.multipleOf = 5;
    levelProperties.value.multipleOf = 5;
    const checksum = createHash("md5")
      .update(JSON.stringify(schema))
      .digest("base64");
    let previewCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, schema);
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
        previewCount += 1;
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: "MUST-NOT-PREVIEW",
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: [],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));
    const expectedQuantityDiscountPlanHash = createHash("sha256")
      .update(JSON.stringify({
        discountType: "fixed",
        levels: [{ lowerBound: 5, value: 25 }],
      }))
      .digest("hex");

    await expect(previewBusinessPriceUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 29,
      expectedQuantityDiscountPlanHash,
      quantityDiscountTiers: [{ lowerBound: 6, percent: 7 }],
    })).rejects.toMatchObject({
      code: "INVALID_QUANTITY_DISCOUNT",
    });
    expect(previewCount).toBe(0);
  });

  it("stops a combined tier proposal when the seller-specific PTD does not expose QDP", async () => {
    const schema = businessSchema() as {
      properties: {
        purchasable_offer: {
          items: { properties: Record<string, unknown> };
        };
      };
    };
    delete schema.properties.purchasable_offer.items.properties
      .quantity_discount_plan;
    const checksum = createHash("md5")
      .update(JSON.stringify(schema))
      .digest("base64");
    let previewCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, schema);
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
        previewCount += 1;
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: "MUST-NOT-PREVIEW",
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: [],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));
    const expectedQuantityDiscountPlanHash = createHash("sha256")
      .update(JSON.stringify({
        discountType: "fixed",
        levels: [{ lowerBound: 5, value: 25 }],
      }))
      .digest("hex");

    await expect(previewBusinessPriceUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 29,
      expectedQuantityDiscountPlanHash,
      quantityDiscountTiers: [{ lowerBound: 5, percent: 5 }],
    })).rejects.toMatchObject({
      code: "BUSINESS_QUANTITY_DISCOUNTS_UNSUPPORTED",
    });
    expect(previewCount).toBe(0);
  });

  it("stops before preview when the exact B2B contribution is automation-managed", async () => {
    let previewCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        const payload = await listingResponse().json() as {
          attributes: { purchasable_offer: Array<Record<string, unknown>> };
        };
        payload.attributes.purchasable_offer.find(
          (offer) => offer.audience === "B2B",
        )!.automated_pricing_merchandising_rule_plan = [{
          merchandising_rule_id: "AUTOMATION-RULE",
        }];
        return jsonResponse(200, payload);
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
        previewCount += 1;
        return jsonResponse(200, { status: "VALID" });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));

    const snapshot = await getBusinessPricing({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    expect(snapshot.businessPricingManagedByAutomation).toBe(true);
    await expect(previewBusinessPriceUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27,
    })).rejects.toMatchObject({
      code: "BUSINESS_PRICING_MANAGED_BY_AUTOMATION",
    });
    expect(previewCount).toBe(0);
  });

  it.each([
    ["malformed issues", {
      submissionId: "B2B-PREVIEW-MALFORMED-ISSUES",
      issues: [{ severity: "ERROR" }],
    }],
    ["missing submissionId", { issues: [] }],
  ] as const)(
    "rejects a Validation Preview with %s before any B2B write",
    async (_scenario, previewReceipt) => {
    let formalCommitCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (
        url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH" &&
        url.searchParams.get("mode") === "VALIDATION_PREVIEW"
      ) {
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          ...previewReceipt,
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
        formalCommitCount += 1;
        return jsonResponse(200, { sku: SELLER_SKU, status: "ACCEPTED" });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));

    await expect(previewBusinessPriceUpdate({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27.5,
    })).rejects.toMatchObject({ code: "VALIDATION_STATUS_UNKNOWN" });
    expect(formalCommitCount).toBe(0);
    },
  );

  it("stops before formal commit when preview-bound evidence drifted", async () => {
    let previewCount = 0;
    let formalCommitCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
        if (url.searchParams.get("mode") === "VALIDATION_PREVIEW") {
          previewCount += 1;
          return jsonResponse(200, {
            sku: SELLER_SKU,
            status: "VALID",
            submissionId: `B2B-PREVIEW-${previewCount}`,
            identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
            issues: [],
          });
        }
        formalCommitCount += 1;
        return jsonResponse(200, { sku: SELLER_SKU, status: "ACCEPTED" });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));

    await expect(updateBusinessPrice({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27.5,
    }, {
      asin: ASIN,
      productType: "PET_FOOD",
      businessOfferGuardHash: "preview-bound-guard-that-no-longer-matches",
      businessOfferProtectedHash: "preview-protected-offer",
      previousQuantityDiscountPlanHash: null,
      schemaChecksum: SCHEMA_CHECKSUM,
      fbaEvidenceHash: "preview-fba-evidence",
      canonicalPatchHash: "preview-patch-evidence",
      validationIssuesHash: "preview-issues-evidence",
    })).rejects.toMatchObject({
      code: "PREVIEW_CHANGED",
      commitPatchSent: false,
    });
    expect(previewCount).toBe(1);
    expect(formalCommitCount).toBe(0);
  });

  it("requires a new approval when Amazon preview warnings drift", async () => {
    let previewCount = 0;
    let formalCommitCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (
        url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH" &&
        url.searchParams.get("mode") === "VALIDATION_PREVIEW"
      ) {
        previewCount += 1;
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: `B2B-PREVIEW-${previewCount}`,
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: previewCount === 1 ? [] : [{
            code: "NEW_BUSINESS_PRICE_WARNING",
            severity: "WARNING",
            message: "Amazon returned a new warning after the visible preview.",
            attributeNames: ["purchasable_offer"],
            categories: ["INVALID_ATTRIBUTE"],
          }],
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
        formalCommitCount += 1;
        return jsonResponse(200, { sku: SELLER_SKU, status: "ACCEPTED" });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));
    const input = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27.5,
    };
    const visiblePreview = await previewBusinessPriceUpdate(input);

    await expect(updateBusinessPrice(input, visiblePreview)).rejects.toMatchObject({
      code: "PREVIEW_CHANGED",
      commitPatchSent: false,
    });
    expect(previewCount).toBe(2);
    expect(formalCommitCount).toBe(0);
  });

  it("sends the formal B2B PATCH exactly once after a fresh preview", async () => {
    let commitCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (
        url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH" &&
        url.searchParams.get("mode") === "VALIDATION_PREVIEW"
      ) {
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: "B2B-PREVIEW-COMMIT",
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: [],
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
        commitCount += 1;
        expect(url.searchParams.has("mode")).toBe(false);
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "ACCEPTED",
          submissionId: "B2B-SUBMISSION-1",
          issues: [],
        }, { "x-amzn-requestid": "B2B-COMMIT-REQUEST-1" });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));

    const result = await updateBusinessPrice({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27.5,
    });

    expect(commitCount).toBe(1);
    expect(result).toMatchObject({
      mode: "live",
      status: "ACCEPTED",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      standardPrice: { amount: 30, currencyCode: "USD" },
      previousBusinessPrice: { amount: 28, currencyCode: "USD" },
      requestedBusinessPrice: { amount: 27.5, currencyCode: "USD" },
      schemaChecksum: SCHEMA_CHECKSUM,
      submissionId: "B2B-SUBMISSION-1",
      requestId: "B2B-COMMIT-REQUEST-1",
    });
  });

  it("treats malformed issues in an ACCEPTED B2B receipt as unknown", async () => {
    let commitCount = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, {
          schema: {
            link: { resource: SCHEMA_URL, verb: "GET" },
            checksum: SCHEMA_CHECKSUM,
          },
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
        return listingResponse();
      }
      if (
        url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH" &&
        url.searchParams.get("mode") === "VALIDATION_PREVIEW"
      ) {
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: "B2B-PREVIEW-MALFORMED-RECEIPT",
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: [],
        });
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
        commitCount += 1;
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "ACCEPTED",
          issues: [null],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.href}`);
    }));

    await expect(updateBusinessPrice({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedStandardPrice: 30,
      expectedBusinessPrice: 28,
      newBusinessPrice: 27.5,
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(commitCount).toBe(1);
  });

  it.each([
    [undefined, "UNTRUSTED-SUBMISSION", "ACCEPTED", []],
    ["A-DIFFERENT-SKU", "UNTRUSTED-SUBMISSION", "ACCEPTED", []],
    [SELLER_SKU, undefined, "ACCEPTED", []],
    [SELLER_SKU, " ", "ACCEPTED", []],
    [SELLER_SKU, "UNTRUSTED-SUBMISSION", undefined, []],
    [SELLER_SKU, "UNTRUSTED-SUBMISSION", "VALID", []],
    [SELLER_SKU, "UNTRUSTED-SUBMISSION", "ACCEPTED ", []],
    [SELLER_SKU, "UNTRUSTED-SUBMISSION", "ACCEPTED", [{
      code: "B2B_PRICE_REJECTED_AFTER_ACCEPT",
      severity: "ERROR",
      message: "The accepted receipt also contains a price error.",
      categories: ["INVALID_PRICE"],
    }]],
  ] as const)(
    "treats an untrusted receipt with SKU %s, submission %s, and status %s as unknown without resending",
    async (receiptSku, receiptSubmissionId, receiptStatus, receiptIssues) => {
      let commitCount = 0;
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
        const url = urlOf(input);
        const method = init?.method ??
          (input instanceof Request ? input.method : "GET");
        if (url.origin === "https://api.amazon.com") {
          return jsonResponse(200, { access_token: "TOKEN", expires_in: 3_600 });
        }
        if (url.href === SCHEMA_URL) return jsonResponse(200, businessSchema());
        if (url.pathname.startsWith("/definitions/2020-09-01/")) {
          return jsonResponse(200, {
            schema: {
              link: { resource: SCHEMA_URL, verb: "GET" },
              checksum: SCHEMA_CHECKSUM,
            },
          });
        }
        if (url.pathname.startsWith("/listings/2021-08-01/") && method === "GET") {
          return listingResponse();
        }
        if (
          url.pathname.startsWith("/listings/2021-08-01/") &&
          method === "PATCH" &&
          url.searchParams.get("mode") === "VALIDATION_PREVIEW"
        ) {
          return jsonResponse(200, {
            sku: SELLER_SKU,
            status: "VALID",
            submissionId: "B2B-PREVIEW-UNTRUSTED-RECEIPT",
            identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
            issues: [],
          });
        }
        if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
          commitCount += 1;
          return jsonResponse(200, {
            ...(receiptSku === undefined ? {} : { sku: receiptSku }),
            ...(receiptStatus === undefined ? {} : { status: receiptStatus }),
            ...(receiptSubmissionId === undefined
              ? {}
              : { submissionId: receiptSubmissionId }),
            issues: receiptIssues,
          });
        }
        throw new Error(`Unexpected request: ${method} ${url.href}`);
      }));

      await expect(updateBusinessPrice({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        expectedStandardPrice: 30,
        expectedBusinessPrice: 28,
        newBusinessPrice: 27.5,
      })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
      expect(commitCount).toBe(1);
    },
  );
});
