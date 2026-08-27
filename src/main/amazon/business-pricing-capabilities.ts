import { createHash } from "node:crypto";
import type {
  MarketplaceId,
  MarketplaceRegion,
} from "../../shared/marketplaces";
import { evaluateBusinessPricingCapabilitySchema } from
  "./business-pricing-capability-schema";
import type {
  BusinessPricingCapability,
  BusinessQuantityDiscountLevel,
} from "./business-pricing-types";
import {
  readProductTypeDefinition,
  type ListingsReadAdapter,
} from "./listings-reads";
import { throwListingsReadError } from "./listings-response-error";
import { SpApiError } from "./sp-api-error";

type JsonRecord = Record<string, unknown>;

type BusinessPricingMarketplace = Readonly<{
  label: string;
  region: MarketplaceRegion;
  currencyCode: string;
}>;

export type BusinessPricingCapabilityRead = Readonly<{
  marketplaceId: MarketplaceId;
  productType: string;
  forceRefresh?: boolean;
}>;

export type BusinessPricingQuantityDiscountProposal = Readonly<{
  marketplaceId: MarketplaceId;
  productType: string;
  schemaChecksum: string;
  levels: readonly BusinessQuantityDiscountLevel[];
}>;

/**
 * Seller-scoped PTD capability owner. The raw schema remains private so a
 * caller can only read its evaluated capability or ask one closed question
 * about a proposed percent quantity-discount plan.
 */
export interface BusinessPricingCapabilitiesPort {
  read(input: BusinessPricingCapabilityRead): Promise<BusinessPricingCapability>;
  quantityDiscountPlanSupported(
    input: BusinessPricingQuantityDiscountProposal,
  ): boolean;
  clear(): void;
}

export type BusinessPricingCapabilitiesDependencies = Readonly<{
  listingsReads: Pick<ListingsReadAdapter, "readDefinition">;
  credentialGeneration: () => number;
  sellerId: (region: MarketplaceRegion) => string | null;
  marketplace: (marketplaceId: MarketplaceId) => BusinessPricingMarketplace;
  now?: () => number;
}>;

type CachedBusinessPricingCapability = Readonly<{
  expiresAt: number;
  capability: BusinessPricingCapability;
  schema: JsonRecord;
}>;

const CAPABILITY_TTL_MS = 15 * 60_000;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cacheKey(
  generation: number,
  sellerId: string,
  marketplaceId: MarketplaceId,
  productType: string,
): string {
  const sellerScope = createHash("sha256")
    .update(sellerId)
    .digest("hex")
    .slice(0, 24);
  return `${generation}:${sellerScope}:${marketplaceId}:${productType}`;
}

export function createBusinessPricingCapabilities(
  dependencies: BusinessPricingCapabilitiesDependencies,
): BusinessPricingCapabilitiesPort {
  const now = dependencies.now ?? Date.now;
  const cache = new Map<string, CachedBusinessPricingCapability>();

  function cachedSchema(
    input: BusinessPricingQuantityDiscountProposal,
  ): JsonRecord | null {
    const marketplace = dependencies.marketplace(input.marketplaceId);
    const sellerId = dependencies.sellerId(marketplace.region);
    if (!sellerId) return null;
    const cached = cache.get(cacheKey(
      dependencies.credentialGeneration(),
      sellerId,
      input.marketplaceId,
      input.productType,
    ));
    return cached && cached.expiresAt > now() &&
        cached.capability.schemaChecksum === input.schemaChecksum
      ? cached.schema
      : null;
  }

  return {
    async read(input) {
      const marketplace = dependencies.marketplace(input.marketplaceId);
      const startedGeneration = dependencies.credentialGeneration();
      const sellerId = dependencies.sellerId(marketplace.region);
      if (!sellerId) {
        throw new SpApiError(
          `${marketplace.label}站尚未設定 Seller ID，無法取得 seller-specific B2B PTD。`,
          { status: 503, code: "LISTINGS_NOT_CONFIGURED" },
        );
      }
      const key = cacheKey(
        startedGeneration,
        sellerId,
        input.marketplaceId,
        input.productType,
      );
      const cached = cache.get(key);
      if (!input.forceRefresh && cached && cached.expiresAt > now()) {
        return cached.capability;
      }

      const result = await readProductTypeDefinition(
        dependencies.listingsReads,
        {
          intent: "business-offer",
          marketplaceId: input.marketplaceId,
          productType: input.productType,
        },
      );
      if (result.status < 200 || result.status >= 300) {
        return throwListingsReadError(result, "getDefinitionsProductType");
      }
      const definition = isRecord(result.envelope) ? result.envelope : null;
      const definitionSchema = isRecord(definition?.schema)
        ? definition.schema
        : null;
      const definitionLink = isRecord(definitionSchema?.link)
        ? definitionSchema.link
        : null;
      const schemaUrl = typeof definitionLink?.resource === "string"
        ? definitionLink.resource
        : null;
      const checksum = typeof definitionSchema?.checksum === "string"
        ? definitionSchema.checksum
        : null;
      const schemaBytes = result.schemaBytes;
      if (!schemaUrl || !checksum || !schemaBytes) {
        throw new SpApiError(
          "Amazon B2B seller-specific PTD 沒有回傳可核對的 schema 與 checksum。",
          {
            status: 502,
            code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
            requestId: result.requestId,
            operation: "getDefinitionsProductType",
          },
        );
      }
      const actualChecksum = createHash("md5")
        .update(schemaBytes)
        .digest("base64");
      if (actualChecksum !== checksum) {
        throw new SpApiError(
          "Amazon B2B seller-specific PTD schema 與官方 checksum 不一致，已停止使用。",
          {
            status: 502,
            code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
            operation: "getDefinitionsProductType",
          },
        );
      }

      let schemaText: string;
      try {
        schemaText = new TextDecoder("utf-8", { fatal: true })
          .decode(schemaBytes);
      } catch {
        throw new SpApiError(
          "Amazon B2B seller-specific PTD schema 不是有效 UTF-8。",
          {
            status: 502,
            code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
            operation: "getDefinitionsProductType",
          },
        );
      }
      let parsedSchema: unknown;
      try {
        parsedSchema = JSON.parse(schemaText);
      } catch {
        parsedSchema = null;
      }
      if (!isRecord(parsedSchema) || !isRecord(parsedSchema.properties)) {
        throw new SpApiError(
          "Amazon B2B seller-specific PTD schema 格式無法辨識。",
          {
            status: 502,
            code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
            operation: "getDefinitionsProductType",
          },
        );
      }
      const capability = evaluateBusinessPricingCapabilitySchema(
        parsedSchema,
        checksum,
        {
          marketplaceId: input.marketplaceId,
          currencyCode: marketplace.currencyCode,
        },
      );
      if (
        startedGeneration !== dependencies.credentialGeneration() ||
        dependencies.sellerId(marketplace.region) !== sellerId
      ) {
        throw new SpApiError(
          "Amazon 憑證或 Seller ID 已在 B2B PTD 查詢期間改變；舊結果已丟棄。",
          { status: 409, code: "CREDENTIALS_CHANGED" },
        );
      }
      cache.set(key, {
        expiresAt: now() + CAPABILITY_TTL_MS,
        capability,
        schema: parsedSchema,
      });
      return capability;
    },

    quantityDiscountPlanSupported(input) {
      const schema = cachedSchema(input);
      if (!schema) return false;
      const marketplace = dependencies.marketplace(input.marketplaceId);
      return evaluateBusinessPricingCapabilitySchema(
        schema,
        input.schemaChecksum,
        {
          marketplaceId: input.marketplaceId,
          currencyCode: marketplace.currencyCode,
          proposedQuantityDiscountLevels: input.levels,
        },
      ).quantityDiscountsEditable;
    },

    clear() {
      cache.clear();
    },
  };
}
