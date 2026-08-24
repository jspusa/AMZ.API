import {
  marketplaceById,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
} from "../abort-utils";
import {
  assertProductTypeDefinitionEnvelopeIdentity,
  listingItemReadIdentity,
  listingsSearchIdentity,
  productTypeDefinitionReadIdentity,
  type ListingItemReadPlan,
  type ListingItemReadResult,
  type ListingsReadAdapter,
  type ListingsSearchPlan,
  type ListingsSearchReadResult,
  type ProductTypeDefinitionReadPlan,
  type ProductTypeDefinitionReadResult,
} from "./listings-reads";
import { SpApiError } from "./sp-api-error";
import { spApiUserAgent } from "./sp-api-runtime";

const REGION_ENDPOINTS: Record<MarketplaceRegion, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const LISTING_ITEM_INCLUDED_DATA =
  "summaries,attributes,offers,issues,fulfillmentAvailability";
const LISTING_SEARCH_INCLUDED_DATA =
  `${LISTING_ITEM_INCLUDED_DATA},productTypes`;
const VARIATION_SEARCH_INCLUDED_DATA =
  "relationships,summaries,fulfillmentAvailability,productTypes";
const BUSINESS_PTD_SCHEMA_MAX_BYTES = 16 * 1024 * 1024;

export type ListingsReadProductionDependencies = Readonly<{
  getAccessToken(
    region: MarketplaceRegion,
    forceRefresh: boolean,
  ): Promise<string>;
  invalidateAccessToken(region: MarketplaceRegion): void;
  getSellerId(region: MarketplaceRegion): string | null;
  userAgent?: () => string;
  now?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}>;

type ItemProfile = ListingItemReadResult["profile"];
type SearchProfile = ListingsSearchReadResult["profile"];

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function retryDelayMs(
  response: Response,
  attempt: number,
  random: () => number,
): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 8_000);
  }
  return Math.min(500 * 2 ** attempt + random() * 250, 5_000);
}

function resultMetadata(response: Response) {
  return {
    status: response.status,
    requestId: response.headers.get("x-amzn-requestid"),
    rateLimit: response.headers.get("x-amzn-ratelimit-limit"),
    retryAfter: response.headers.get("retry-after"),
  } as const;
}

function marketplaceFor(plan: {
  marketplaceId: Parameters<typeof marketplaceById>[0];
}) {
  const marketplace = marketplaceById(plan.marketplaceId);
  if (!marketplace) {
    throw new SpApiError("Amazon 站點無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  return marketplace;
}

function trustedBusinessSchemaUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SpApiError("Amazon B2B seller-specific PTD schema URL 無效。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      operation: "getDefinitionsProductType",
    });
  }
  const officialHost =
    url.hostname === "amazonaws.com" ||
    url.hostname.endsWith(".amazonaws.com") ||
    url.hostname.endsWith(".amazonaws.com.cn") ||
    url.hostname.endsWith(".cloudfront.net");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !officialHost
  ) {
    throw new SpApiError(
      "Amazon B2B seller-specific PTD schema URL 未通過官方 AWS host 安全檢查。",
      {
        status: 502,
        code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
        operation: "getDefinitionsProductType",
      },
    );
  }
  return url;
}

function schemaResource(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }
  const schema = (envelope as Record<string, unknown>).schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }
  const link = (schema as Record<string, unknown>).link;
  if (!link || typeof link !== "object" || Array.isArray(link)) return null;
  const resource = (link as Record<string, unknown>).resource;
  return typeof resource === "string" && resource ? resource : null;
}

async function readBoundedSchemaBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > BUSINESS_PTD_SCHEMA_MAX_BYTES
  ) {
    throw new SpApiError(
      "Amazon B2B seller-specific PTD schema 超過安全大小上限。",
      {
        status: 502,
        code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
        operation: "getDefinitionsProductType",
      },
    );
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > BUSINESS_PTD_SCHEMA_MAX_BYTES) {
      throw new SpApiError(
        "Amazon B2B seller-specific PTD schema 超過安全大小上限。",
        {
          status: 502,
          code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
          operation: "getDefinitionsProductType",
        },
      );
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > BUSINESS_PTD_SCHEMA_MAX_BYTES) {
      await reader.cancel();
      throw new SpApiError(
        "Amazon B2B seller-specific PTD schema 超過安全大小上限。",
        {
          status: 502,
          code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
          operation: "getDefinitionsProductType",
        },
      );
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseSchemaBytes(bytes: Uint8Array): unknown | null {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export function createListingsReadProductionAdapter(
  dependencies: ListingsReadProductionDependencies,
): ListingsReadAdapter {
  const now = dependencies.now ?? (() => new Date());
  const random = dependencies.random ?? Math.random;
  const sleep = dependencies.sleep ?? abortableDelay;
  const userAgent = dependencies.userAgent ?? spApiUserAgent;

  function sellerIdFor(
    plan: ListingItemReadPlan | ListingsSearchPlan | ProductTypeDefinitionReadPlan,
  ): { sellerId: string; region: MarketplaceRegion; issueLocale: string } {
    const marketplace = marketplaceFor(plan);
    const sellerId = dependencies.getSellerId(marketplace.region);
    if (!sellerId) {
      const message =
        "intent" in plan && plan.intent === "variation-evidence"
          ? `${marketplace.label.replace(/站$/u, "")}站尚未設定 Seller ID，變體規劃查詢仍未啟用。`
          : "intent" in plan && plan.intent === "business-offer"
            ? `${marketplace.label.replace(/站$/u, "")}站尚未設定 Seller ID，無法取得 seller-specific B2B PTD。`
            : `${marketplace.label.replace(/站$/u, "")}站尚未設定 Seller ID，SKU 查詢功能仍未啟用。`;
      throw new SpApiError(message, {
        status: 503,
        code: "LISTINGS_NOT_CONFIGURED",
      });
    }
    return {
      sellerId,
      region: marketplace.region,
      issueLocale: marketplace.locale.replace("-", "_"),
    };
  }

  async function fixedFetch(input: {
    url: string | URL;
    region: MarketplaceRegion;
    forceTokenRefresh: boolean;
    signal?: AbortSignal;
    timeoutMilliseconds: number;
    timeoutMessage: string;
    connectionMessage: string;
    operation?: "getDefinitionsProductType";
  }): Promise<Response> {
    throwIfAborted(input.signal);
    const token = await dependencies.getAccessToken(
      input.region,
      input.forceTokenRefresh,
    );
    throwIfAborted(input.signal);
    const controller = new AbortController();
    const stopForwardingAbort = forwardAbort(controller, input.signal);
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMilliseconds,
    );
    try {
      return await fetch(input.url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-amz-access-token": token,
          "x-amz-date": toAmzDate(now()),
          "user-agent": userAgent(),
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      throwIfAborted(input.signal);
      if (error instanceof Error && error.name === "AbortError") {
        throw new SpApiError(input.timeoutMessage, {
          status: 504,
          code: "UPSTREAM_UNAVAILABLE",
          operation: input.operation,
        });
      }
      throw new SpApiError(input.connectionMessage, {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        operation: input.operation,
      });
    } finally {
      clearTimeout(timeout);
      stopForwardingAbort();
    }
  }

  async function callItem(
    plan: ListingItemReadPlan,
    forceTokenRefresh: boolean,
    profile: ItemProfile,
  ): Promise<Response> {
    const { sellerId, region, issueLocale } = sellerIdFor(plan);
    const query = new URLSearchParams({ marketplaceIds: plan.marketplaceId });
    if (profile === "full") {
      query.set("issueLocale", issueLocale);
      query.set("includedData", LISTING_ITEM_INCLUDED_DATA);
    } else if (profile === "essential") {
      query.set(
        "includedData",
        "summaries,attributes,fulfillmentAvailability",
      );
    } else if (profile === "relationships" || profile === "attributes") {
      query.set("issueLocale", issueLocale);
      query.set(
        "includedData",
        profile === "relationships"
          ? "summaries,attributes,issues,fulfillmentAvailability,relationships"
          : "summaries,attributes,issues,fulfillmentAvailability",
      );
    }
    return fixedFetch({
      url: `${REGION_ENDPOINTS[region]}/listings/2021-08-01/items/${encodeURIComponent(
        sellerId,
      )}/${encodeURIComponent(plan.sellerSku)}?${query}`,
      region,
      forceTokenRefresh,
      signal: plan.signal,
      timeoutMilliseconds: plan.intent === "listing" ? 12_000 : 15_000,
      timeoutMessage:
        plan.intent === "listing"
          ? "Amazon Listings API 回應逾時，請稍後再試。"
          : "Amazon 變體關係查詢逾時，請稍後再試。",
      connectionMessage: "目前無法連線至 Amazon Listings API。",
    });
  }

  function searchQuery(
    plan: ListingsSearchPlan,
    profile: SearchProfile,
    issueLocale: string,
  ): URLSearchParams {
    const query = new URLSearchParams({ marketplaceIds: plan.marketplaceId });
    if (plan.intent === "access-probe") {
      if (profile === "standard") {
        query.set("issueLocale", issueLocale);
        query.set("includedData", "summaries");
        query.set("pageSize", "1");
      }
      return query;
    }
    query.set("issueLocale", issueLocale);
    if (plan.intent === "variation-children") {
      query.set(
        "includedData",
        profile === "relationships"
          ? "summaries,attributes,issues,fulfillmentAvailability,relationships,productTypes"
          : "summaries,attributes,issues,fulfillmentAvailability,productTypes",
      );
      query.set("variationParentSku", plan.parentSku);
      query.set("pageSize", "20");
      if (plan.pageToken) query.set("pageToken", plan.pageToken);
      return query;
    }
    const identifiers =
      plan.intent === "asin-identity" ? [plan.asin] : [...plan.sellerSkus];
    query.set(
      "includedData",
      plan.intent === "sku-batch"
        ? LISTING_SEARCH_INCLUDED_DATA
        : VARIATION_SEARCH_INCLUDED_DATA,
    );
    query.set("pageSize", String(plan.intent === "asin-identity" ? 20 : identifiers.length));
    query.set("identifiers", identifiers.join(","));
    query.set(
      "identifiersType",
      plan.intent === "asin-identity" ? "ASIN" : "SKU",
    );
    return query;
  }

  async function callSearch(
    plan: ListingsSearchPlan,
    forceTokenRefresh: boolean,
    profile: SearchProfile,
  ): Promise<Response> {
    const { sellerId, region, issueLocale } = sellerIdFor(plan);
    const query = searchQuery(plan, profile, issueLocale);
    return fixedFetch({
      url: `${REGION_ENDPOINTS[region]}/listings/2021-08-01/items/${encodeURIComponent(
        sellerId,
      )}?${query}`,
      region,
      forceTokenRefresh,
      signal: plan.signal,
      timeoutMilliseconds: 15_000,
      timeoutMessage:
        plan.intent === "variation-children"
          ? "Amazon 變體關係查詢逾時，請稍後再試。"
          : "Amazon 批次 SKU 查詢逾時，請稍後再試。",
      connectionMessage: "目前無法連線至 Amazon Listings API。",
    });
  }

  function definitionVocabulary(plan: ProductTypeDefinitionReadPlan): {
    requirements: "LISTING" | "LISTING_PRODUCT_ONLY" | "LISTING_OFFER_ONLY";
    requirementsEnforced: "ENFORCED" | "NOT_ENFORCED";
    parentageLevel: "CHILD" | null;
  } {
    if (plan.intent === "business-offer") {
      return {
        requirements: "LISTING_OFFER_ONLY",
        requirementsEnforced: "NOT_ENFORCED",
        parentageLevel: null,
      };
    }
    if (plan.intent === "variation-child") {
      return {
        requirements: "LISTING",
        requirementsEnforced: "ENFORCED",
        parentageLevel: "CHILD",
      };
    }
    return {
      requirements: "LISTING_PRODUCT_ONLY",
      requirementsEnforced: "NOT_ENFORCED",
      parentageLevel: null,
    };
  }

  async function callDefinition(
    plan: ProductTypeDefinitionReadPlan,
    forceTokenRefresh: boolean,
    sellerSpecific: boolean,
  ): Promise<Response> {
    const { sellerId, region, issueLocale } = sellerIdFor(plan);
    const vocabulary = definitionVocabulary(plan);
    const query = new URLSearchParams({
      marketplaceIds: plan.marketplaceId,
      productTypeVersion: "LATEST",
      requirements: vocabulary.requirements,
      requirementsEnforced: vocabulary.requirementsEnforced,
      locale: issueLocale,
    });
    if (vocabulary.parentageLevel) {
      query.set("parentageLevel", vocabulary.parentageLevel);
    }
    if (sellerSpecific) query.set("sellerId", sellerId);
    return fixedFetch({
      url: `${REGION_ENDPOINTS[region]}/definitions/2020-09-01/productTypes/${encodeURIComponent(
        plan.productType,
      )}?${query}`,
      region,
      forceTokenRefresh,
      signal: plan.signal,
      timeoutMilliseconds: 12_000,
      timeoutMessage: "Amazon 商品欄位規格查詢逾時，請稍後再試。",
      connectionMessage: "目前無法讀取 Amazon 商品欄位規格。",
      operation: "getDefinitionsProductType",
    });
  }

  async function downloadSchema(
    plan: ProductTypeDefinitionReadPlan,
    resource: string,
  ): Promise<{ schemaEnvelope: unknown | null; schemaBytes: Uint8Array }> {
    const business = plan.intent === "business-offer";
    const url = business ? trustedBusinessSchemaUrl(resource) : resource;
    const controller = business ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), 12_000)
      : null;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/schema+json, application/json" },
        cache: "no-store",
        ...(business ? { redirect: "error" as const } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) {
        const message =
          plan.intent === "business-offer"
            ? "Amazon B2B seller-specific PTD schema 暫時無法下載。"
            : plan.intent === "variation-child"
              ? "Amazon CHILD PTD schema 暫時無法下載。"
              : "Amazon 商品欄位規格暫時無法下載。";
        throw new SpApiError(message, {
          status: 502,
          code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
          operation: "getDefinitionsProductType",
        });
      }
      const bytes = business
        ? await readBoundedSchemaBytes(response)
        : new Uint8Array(await response.arrayBuffer());
      return { schemaEnvelope: parseSchemaBytes(bytes), schemaBytes: bytes };
    } catch (error) {
      if (error instanceof SpApiError) throw error;
      const timedOut = error instanceof Error && error.name === "AbortError";
      const message =
        plan.intent === "business-offer"
          ? timedOut
            ? "Amazon B2B seller-specific PTD schema 下載逾時。"
            : "Amazon B2B seller-specific PTD schema 下載失敗或無法完整讀取。"
          : plan.intent === "variation-child"
            ? "Amazon CHILD PTD schema 下載失敗，已停止變體操作。"
            : "Amazon 商品欄位規格下載失敗，請稍後再試。";
      throw new SpApiError(message, {
        status: 502,
        code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
        operation: "getDefinitionsProductType",
      });
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }

  return {
    async readItem(plan): Promise<ListingItemReadResult> {
      const identity = listingItemReadIdentity(plan);
      const region = marketplaceFor(plan).region;
      let profile: ItemProfile =
        plan.intent === "listing" ? "full" : "relationships";
      let response = await callItem(plan, false, profile);
      throwIfAborted(plan.signal);
      if (response.status === 401) {
        dependencies.invalidateAccessToken(region);
        response = await callItem(plan, true, profile);
        throwIfAborted(plan.signal);
      }
      if (response.status === 400) {
        if (plan.intent === "listing") {
          profile = "essential";
          response = await callItem(plan, false, profile);
          throwIfAborted(plan.signal);
          if (response.status === 400) {
            profile = "minimal";
            response = await callItem(plan, false, profile);
            throwIfAborted(plan.signal);
            if (response.ok) {
              throw new SpApiError(
                "Amazon 已接受 Seller ID、SKU 與站點，但拒絕商品內容所需的 Listings 資料集；已停止在唯讀診斷階段。",
                {
                  status: 409,
                  code: "LISTINGS_REQUIRED_DATA_UNAVAILABLE",
                  requestId: response.headers.get("x-amzn-requestid"),
                  operation: "getListingsItem",
                },
              );
            }
          }
        } else {
          profile = "attributes";
          response = await callItem(plan, false, profile);
          throwIfAborted(plan.signal);
        }
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (![429, 500, 503].includes(response.status)) break;
        await sleep(retryDelayMs(response, attempt, random), plan.signal);
        throwIfAborted(plan.signal);
        if (plan.intent === "listing") profile = "full";
        response = await callItem(plan, false, profile);
        throwIfAborted(plan.signal);
      }
      return {
        identity,
        ...resultMetadata(response),
        envelope: await parseJson(response),
        profile,
      };
    },

    async searchItems(plan): Promise<ListingsSearchReadResult> {
      const identity = listingsSearchIdentity(plan);
      const region = marketplaceFor(plan).region;
      let profile: SearchProfile =
        plan.intent === "access-probe"
          ? "standard"
          : plan.intent === "variation-children"
            ? "relationships"
            : plan.intent === "sku-batch"
              ? "listing"
              : "variation";
      let response = await callSearch(plan, false, profile);
      throwIfAborted(plan.signal);
      if (response.status === 401) {
        dependencies.invalidateAccessToken(region);
        response = await callSearch(plan, true, profile);
        throwIfAborted(plan.signal);
      }
      if (response.status === 400) {
        if (plan.intent === "access-probe") {
          profile = "minimal";
          response = await callSearch(plan, false, profile);
          throwIfAborted(plan.signal);
        } else if (plan.intent === "variation-children") {
          profile = "attributes";
          response = await callSearch(plan, false, profile);
          throwIfAborted(plan.signal);
        }
      }
      if (plan.intent === "sku-batch" || plan.intent === "variation-children") {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (![429, 500, 503].includes(response.status)) break;
          await sleep(retryDelayMs(response, attempt, random), plan.signal);
          throwIfAborted(plan.signal);
          response = await callSearch(plan, false, profile);
          throwIfAborted(plan.signal);
        }
      }
      return {
        identity,
        ...resultMetadata(response),
        envelope: await parseJson(response),
        profile,
      };
    },

    async readDefinition(
      plan,
    ): Promise<ProductTypeDefinitionReadResult> {
      const identity = productTypeDefinitionReadIdentity(plan);
      const region = marketplaceFor(plan).region;
      let sellerSpecific = true;
      let response = await callDefinition(plan, false, sellerSpecific);
      if (response.status === 401) {
        dependencies.invalidateAccessToken(region);
        response = await callDefinition(plan, true, sellerSpecific);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (![429, 500, 503].includes(response.status)) break;
        await sleep(retryDelayMs(response, attempt, random), plan.signal);
        response = await callDefinition(plan, false, sellerSpecific);
      }
      if (response.status === 400 && plan.intent === "content-read") {
        sellerSpecific = false;
        response = await callDefinition(plan, false, sellerSpecific);
        if (response.status === 401) {
          dependencies.invalidateAccessToken(region);
          response = await callDefinition(plan, true, sellerSpecific);
        }
      }
      const envelope = await parseJson(response);
      if (response.ok) {
        assertProductTypeDefinitionEnvelopeIdentity(
          envelope,
          identity,
          response.headers.get("x-amzn-requestid"),
        );
      }
      let schemaEnvelope: unknown | null = null;
      let schemaBytes: Uint8Array | null = null;
      const resource = response.ok ? schemaResource(envelope) : null;
      if (resource) {
        const schema = await downloadSchema(plan, resource);
        schemaEnvelope = schema.schemaEnvelope;
        schemaBytes = schema.schemaBytes;
      }
      if (identity.intent !== "content-read" && !sellerSpecific) {
        throw new SpApiError(
          "寫入相關 PTD 不可使用 generic schema。",
          { status: 502, code: "UPSTREAM_UNAVAILABLE" },
        );
      }
      return {
        identity,
        ...resultMetadata(response),
        envelope,
        sellerSpecific,
        schemaEnvelope,
        schemaBytes,
      } as ProductTypeDefinitionReadResult;
    },
  };
}
