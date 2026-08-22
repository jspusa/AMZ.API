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
    offers: [{
      marketplaceId: MARKETPLACE_ID,
      offerType: "B2B",
      price: { currency: "USD", amount: "28.00" },
      audience: { value: "B2B", displayName: "Amazon Business" },
    }],
    issues: [],
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 12,
    }],
  });
}

function businessSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      purchasable_offer: {
        type: "array",
        editable: true,
        items: {
          type: "object",
          properties: {
            audience: { type: "string", enum: ["ALL", "B2B"] },
            currency: { type: "string", enum: ["USD"] },
            marketplace_id: { type: "string", enum: [MARKETPLACE_ID] },
            our_price: { type: "array", editable: true },
            quantity_discount_plan: { type: "array", editable: true },
          },
        },
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
    const schema = businessSchema() as {
      properties: {
        purchasable_offer: {
          editable?: boolean;
          items: { properties: { our_price: { editable?: boolean } } };
        };
      };
    };
    delete schema.properties.purchasable_offer.editable;
    delete schema.properties.purchasable_offer.items.properties.our_price.editable;
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

  it("does not call B2B missing when the offers view contradicts attributes", async () => {
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
    expect(snapshot.businessOfferPresence).toBe("ambiguous");
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
      missing: snapshot.rows.filter((row) => row.status === "missing").length,
      unsupported: snapshot.rows.filter((row) => row.status === "unsupported").length,
      incomplete: snapshot.rows.filter((row) => row.status === "incomplete").length,
    });
    expect(snapshot.rows.every((row) =>
      row.reason.length > 0 &&
      (row.status === "configured" || row.status === "missing") === row.editable
    )).toBe(true);
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
      "INCOMPLETE\tB000000004\tIncomplete item\tAMAZON_NA",
      "AMBIGUOUS-UNSUPPORTED\tB000000006\tAmbiguous unsupported item\tAMAZON_NA",
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
          offers: unknown[] = [],
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
          offers,
          issues: [],
          fulfillmentAvailability: [{
            fulfillmentChannelCode: "AMAZON_NA",
            quantity: 3,
          }],
        });
        return jsonResponse(200, {
          numberOfResults: 5,
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
            listing("INCOMPLETE", "B000000004", "PET_FOOD", [{
              audience: "ALL",
              currency: "USD",
              marketplace_id: MARKETPLACE_ID,
              our_price: [{ schedule: [{ value_with_tax: 15 }] }],
            }], [{
              marketplaceId: MARKETPLACE_ID,
              offerType: "B2B",
              price: { currency: "USD", amount: "13.50" },
              audience: { value: "B2B", displayName: "Amazon Business" },
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
        ["INCOMPLETE", "incomplete", false],
        ["MISSING", "missing", true],
        ["UNSUPPORTED", "unsupported", false],
      ]);
    expect(snapshot.rows.find((row) => row.sellerSku === "CONFIGURED"))
      .toMatchObject({
        standardPrice: { amount: 30, currencyCode: "USD" },
        businessPrice: { amount: 27, currencyCode: "USD" },
        businessOfferPresence: "present",
      });
    expect(snapshot.summary).toEqual({
      totalFbaSkuCount: 5,
      configured: 1,
      missing: 1,
      unsupported: 1,
      incomplete: 2,
    });
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
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: previewCount === 1 ? [] : [{
            code: "NEW_BUSINESS_PRICE_WARNING",
            severity: "WARNING",
            message: "Amazon returned a new warning after the visible preview.",
            attributeNames: ["purchasable_offer"],
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

  it.each([undefined, "A-DIFFERENT-SKU"])(
    "treats an ACCEPTED receipt with SKU %s as unknown without resending",
    async (receiptSku) => {
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
            identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
            issues: [],
          });
        }
        if (url.pathname.startsWith("/listings/2021-08-01/") && method === "PATCH") {
          commitCount += 1;
          return jsonResponse(200, {
            ...(receiptSku === undefined ? {} : { sku: receiptSku }),
            status: "ACCEPTED",
            submissionId: "UNTRUSTED-SUBMISSION",
            issues: [],
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
