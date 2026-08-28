import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingContentPatchDescriptor } from
  "../src/main/amazon/listing-content-gateway";
import {
  LISTING_CONTENT_BATCH_EXACT_BULLET_REPLACEMENT_AUTHORITY,
} from "../src/main/amazon/listing-content-gateway";
import {
  invalidateSpApiCredentialCaches,
  listingContentGatewayProduction,
} from "../src/main/amazon/sp-api";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const SELLER_ID = "FAKE_W06_SELLER_ID";
const SELLER_SKU = "W06 CONTENT SKU/01";
const ASIN = "B000000006";
const PRODUCT_TYPE = "PET_FOOD";
const SCHEMA_CHECKSUM = "W06_CONTENT_SCHEMA_CHECKSUM";
const SCHEMA_URL = "https://schemas.example.test/w06-content.json";

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJsonValue(value)))
    .digest("hex");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-amzn-requestid": "W06-RECEIPT-REQUEST",
    },
  });
}

function listingEnvelope(options: Readonly<{
  bulletPoints?: readonly Readonly<{ text: string; languageTag?: string }>[];
}> = {}): Record<string, unknown> {
  const value = (text: string, languageTag = "en_US") => ({
    value: text,
    language_tag: languageTag,
    marketplace_id: MARKETPLACE_ID,
  });
  return {
    sku: SELLER_SKU,
    summaries: [{
      marketplaceId: MARKETPLACE_ID,
      asin: ASIN,
      productType: PRODUCT_TYPE,
      status: ["BUYABLE"],
      itemName: "Original W06 title",
    }],
    attributes: {
      item_name: [
        value("Original W06 title"),
        value("既存の商品名", "ja_JP"),
      ],
      title_differentiation: [value("Original highlight")],
      bullet_point: options.bulletPoints?.map((bullet) =>
        value(bullet.text, bullet.languageTag)
      ) ?? [value("Original bullet")],
      product_description: [value("Original description")],
      ingredients: [value("Turkey")],
    },
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_NA",
      quantity: 5,
    }],
    issues: [],
  };
}

function contentSchema(): Record<string, unknown> {
  const textAttribute = (maxLength: number, maxItems = 1) => ({
    type: "array",
    editable: true,
    minItems: 0,
    maxItems,
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
      item_name: textAttribute(200),
      title_differentiation: textAttribute(500),
      bullet_point: textAttribute(2_000, 5),
      product_description: textAttribute(10_000),
      ingredients: textAttribute(10_000),
    },
  };
}

function definitionEnvelope(): Record<string, unknown> {
  return {
    productType: PRODUCT_TYPE,
    marketplaceIds: [MARKETPLACE_ID],
    schema: {
      link: { resource: SCHEMA_URL, verb: "GET" },
      checksum: SCHEMA_CHECKSUM,
    },
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function errorIssue(message: string): Record<string, unknown> {
  return {
    code: "W06_CONTENT_REJECTED",
    severity: "ERROR",
    message,
    attributeNames: ["item_name"],
    categories: ["INVALID_ATTRIBUTE"],
    marketplaceIds: [MARKETPLACE_ID],
  };
}

type CommitCase = Readonly<{
  name: string;
  status: number;
  payload: unknown;
  expected: "ACCEPTED" | "INVALID" | "UNKNOWN";
}>;

async function exerciseCommitReceipt(testCase: CommitCase) {
  let previewBody: unknown = null;
  let commitBody: unknown = null;
  let commitCalls = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? (input instanceof Request
      ? input.method
      : "GET");
    if (url.origin === "https://api.amazon.com") {
      return jsonResponse(200, {
        access_token: "FAKE_W06_ACCESS_TOKEN",
        expires_in: 3_600,
      });
    }
    if (url.href === SCHEMA_URL) return jsonResponse(200, contentSchema());
    if (url.pathname.startsWith("/definitions/2020-09-01/")) {
      return jsonResponse(200, definitionEnvelope());
    }
    if (url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "GET") {
      return jsonResponse(200, listingEnvelope());
    }
    if (url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH" &&
        url.searchParams.get("mode") === "VALIDATION_PREVIEW") {
      expect(url.searchParams.get("includedData")).toBe("identifiers,issues");
      previewBody = JSON.parse(String(init?.body));
      return jsonResponse(200, {
        sku: SELLER_SKU,
        status: "VALID",
        submissionId: "W06-PREVIEW-SUBMISSION",
        identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
        issues: [],
      });
    }
    if (url.pathname.startsWith("/listings/2021-08-01/") &&
        method === "PATCH") {
      commitCalls += 1;
      commitBody = JSON.parse(String(init?.body));
      return jsonResponse(testCase.status, testCase.payload);
    }
    throw new Error(`Unexpected W06 request: ${method} ${url.href}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  const observation = await listingContentGatewayProduction.read({
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SELLER_SKU,
  }, "mutation");
  const previous = {
    title: observation.snapshot.title,
    itemHighlight: observation.snapshot.itemHighlight,
    bulletPoints: [...observation.snapshot.bulletPoints],
    productDescription: observation.snapshot.productDescription,
    ingredients: observation.snapshot.ingredients,
  };
  const previewPatch: ListingContentPatchDescriptor = {
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SELLER_SKU,
    asin: ASIN,
    productType: PRODUCT_TYPE,
    languageTag: "en_US",
    schemaChecksum: SCHEMA_CHECKSUM,
    expectedOldHash: canonicalSha256(previous),
    expectedCanonicalPatchHash: null,
    previous,
    requested: { ...previous, title: "Updated W06 title" },
    changedFields: ["title"],
    sourceEvidence: observation.sourceEvidence,
    ptdEvidence: observation.ptdEvidence,
  };
  const preview = await listingContentGatewayProduction.validationPreview(
    previewPatch,
  );
  const assertCurrent = vi.fn(async () => undefined);
  const recordDispatch = vi.fn(async () => undefined);
  const receipt = await listingContentGatewayProduction.commitOnce({
    ...previewPatch,
    expectedCanonicalPatchHash: preview.canonicalPatchHash,
  }, { assertCurrent }, recordDispatch);

  expect(preview).toMatchObject({ status: "VALID" });
  expect(previewBody).toEqual({
    productType: PRODUCT_TYPE,
    patches: [{
      op: "replace",
      path: "/attributes/item_name",
      value: [
        {
          value: "既存の商品名",
          language_tag: "ja_JP",
          marketplace_id: MARKETPLACE_ID,
        },
        {
          value: "Updated W06 title",
          language_tag: "en_US",
          marketplace_id: MARKETPLACE_ID,
        },
      ],
    }],
  });
  expect(commitBody).toEqual(previewBody);
  expect(commitCalls).toBe(1);
  expect(receipt.status).toBe(testCase.expected);
  expect(recordDispatch).toHaveBeenCalledTimes(1);
  expect(assertCurrent).toHaveBeenCalledTimes(2);
  return receipt;
}

describe("W06 Listing Content production gateway receipts", () => {
  beforeEach(() => {
    vi.stubEnv("SP_API_MODE", "live");
    vi.stubEnv("SP_API_LWA_CLIENT_ID", "FAKE_W06_LWA_CLIENT_ID");
    vi.stubEnv("SP_API_LWA_CLIENT_SECRET", "FAKE_W06_LWA_CLIENT_SECRET");
    vi.stubEnv("SP_API_REFRESH_TOKEN_NA", "FAKE_W06_REFRESH_TOKEN");
    vi.stubEnv("SP_API_SELLER_ID_NA", SELLER_ID);
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    invalidateSpApiCredentialCaches();
  });

  it.each<CommitCase>([
    {
      name: "non-2xx ACCEPTED",
      status: 422,
      payload: {
        sku: SELLER_SKU,
        status: "ACCEPTED",
        submissionId: "W06-NON-2XX-ACCEPTED",
        issues: [],
      },
      expected: "UNKNOWN",
    },
    {
      name: "ACCEPTED plus ERROR",
      status: 200,
      payload: {
        sku: SELLER_SKU,
        status: "ACCEPTED",
        submissionId: "W06-ACCEPTED-ERROR",
        issues: [errorIssue("Accepted response carried an ERROR.")],
      },
      expected: "UNKNOWN",
    },
    {
      name: "malformed issues",
      status: 200,
      payload: {
        sku: SELLER_SKU,
        status: "ACCEPTED",
        submissionId: "W06-MALFORMED",
        issues: "not-an-array",
      },
      expected: "UNKNOWN",
    },
    {
      name: "mismatched SKU",
      status: 200,
      payload: {
        sku: "ANOTHER-SKU",
        status: "ACCEPTED",
        submissionId: "W06-WRONG-SKU",
        issues: [],
      },
      expected: "UNKNOWN",
    },
    {
      name: "exact INVALID plus ERROR",
      status: 422,
      payload: {
        sku: SELLER_SKU,
        status: "INVALID",
        submissionId: "W06-INVALID",
        issues: [errorIssue("Amazon rejected the exact content patch.")],
      },
      expected: "INVALID",
    },
    {
      name: "INVALID without ERROR evidence",
      status: 422,
      payload: {
        sku: SELLER_SKU,
        status: "INVALID",
        submissionId: "W06-INVALID-NO-ERROR",
        issues: [],
      },
      expected: "UNKNOWN",
    },
    {
      name: "5xx INVALID plus ERROR",
      status: 503,
      payload: {
        sku: SELLER_SKU,
        status: "INVALID",
        submissionId: "W06-5XX-INVALID",
        issues: [errorIssue("Upstream failed while returning INVALID.")],
      },
      expected: "UNKNOWN",
    },
  ])("classifies $name without retrying the commit", async (testCase) => {
    const receipt = await exerciseCommitReceipt(testCase);
    expect(receipt.requestId).toBe("W06-RECEIPT-REQUEST");
  });

  it("lets an Excel batch replace more than five exact-language bullets while preserving other languages", async () => {
    let previewBody: unknown = null;
    const existingBullets = [
      ...Array.from({ length: 10 }, (_, index) => ({
        text: `Legacy English bullet ${index + 1}`,
        languageTag: "en_US",
      })),
      { text: "既存の日本語箇条書き", languageTag: "ja_JP" },
    ];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? (input instanceof Request
        ? input.method
        : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_W06_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, contentSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, definitionEnvelope());
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") &&
          method === "GET") {
        return jsonResponse(200, listingEnvelope({
          bulletPoints: existingBullets,
        }));
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") &&
          method === "PATCH" &&
          url.searchParams.get("mode") === "VALIDATION_PREVIEW") {
        previewBody = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          sku: SELLER_SKU,
          status: "VALID",
          submissionId: "W06-BULLET-REPLACEMENT-PREVIEW",
          identifiers: [{ marketplaceId: MARKETPLACE_ID, asin: ASIN }],
          issues: [],
        });
      }
      throw new Error(`Unexpected W06 request: ${method} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const observation = await listingContentGatewayProduction.read({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    }, "mutation");
    const previous = {
      title: observation.snapshot.title,
      itemHighlight: observation.snapshot.itemHighlight,
      bulletPoints: [...observation.snapshot.bulletPoints],
      productDescription: observation.snapshot.productDescription,
      ingredients: observation.snapshot.ingredients,
    };
    const requestedBullets = Array.from(
      { length: 5 },
      (_, index) => `Excel English bullet ${index + 1}`,
    );
    const preview = await listingContentGatewayProduction.validationPreview({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      asin: ASIN,
      productType: PRODUCT_TYPE,
      languageTag: "en_US",
      schemaChecksum: SCHEMA_CHECKSUM,
      expectedOldHash: canonicalSha256(previous),
      expectedCanonicalPatchHash: null,
      previous,
      requested: { ...previous, bulletPoints: requestedBullets },
      changedFields: ["bulletPoints"],
      exactLanguageBulletReplacementAuthority:
        LISTING_CONTENT_BATCH_EXACT_BULLET_REPLACEMENT_AUTHORITY,
      sourceEvidence: observation.sourceEvidence,
      ptdEvidence: observation.ptdEvidence,
    });

    expect(preview.status).toBe("VALID");
    expect(previewBody).toEqual({
      productType: PRODUCT_TYPE,
      patches: [{
        op: "replace",
        path: "/attributes/bullet_point",
        value: [
          {
            value: "既存の日本語箇条書き",
            language_tag: "ja_JP",
            marketplace_id: MARKETPLACE_ID,
          },
          ...requestedBullets.map((text) => ({
            value: text,
            language_tag: "en_US",
            marketplace_id: MARKETPLACE_ID,
          })),
        ],
      }],
    });
  });

  it("keeps the overflow guard for ordinary single-SKU bullet edits", async () => {
    const existingBullets = Array.from({ length: 6 }, (_, index) => ({
      text: `Legacy English bullet ${index + 1}`,
      languageTag: "en_US",
    }));
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? (input instanceof Request
        ? input.method
        : "GET");
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, {
          access_token: "FAKE_W06_ACCESS_TOKEN",
          expires_in: 3_600,
        });
      }
      if (url.href === SCHEMA_URL) return jsonResponse(200, contentSchema());
      if (url.pathname.startsWith("/definitions/2020-09-01/")) {
        return jsonResponse(200, definitionEnvelope());
      }
      if (url.pathname.startsWith("/listings/2021-08-01/") &&
          method === "GET") {
        return jsonResponse(200, listingEnvelope({
          bulletPoints: existingBullets,
        }));
      }
      throw new Error(`Unexpected W06 request: ${method} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const observation = await listingContentGatewayProduction.read({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    }, "mutation");
    const previous = {
      title: observation.snapshot.title,
      itemHighlight: observation.snapshot.itemHighlight,
      bulletPoints: [...observation.snapshot.bulletPoints],
      productDescription: observation.snapshot.productDescription,
      ingredients: observation.snapshot.ingredients,
    };

    await expect(
      listingContentGatewayProduction.validationPreview({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SELLER_SKU,
        asin: ASIN,
        productType: PRODUCT_TYPE,
        languageTag: "en_US",
        schemaChecksum: SCHEMA_CHECKSUM,
        expectedOldHash: canonicalSha256(previous),
        expectedCanonicalPatchHash: null,
        previous,
        requested: {
          ...previous,
          bulletPoints: ["Ordinary editor bullet"],
        },
        changedFields: ["bulletPoints"],
        sourceEvidence: observation.sourceEvidence,
        ptdEvidence: observation.ptdEvidence,
      }),
    ).rejects.toMatchObject({ code: "CONTENT_SELECTOR_UNSAFE" });
  });
});
