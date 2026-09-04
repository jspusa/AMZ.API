import { createHash } from "node:crypto";
import {
  marketplaceById,
  type MarketplaceId,
  type MarketplaceRegion,
} from "../../shared/marketplaces";
import type { ListingImageFieldCapability } from "./listing-image-types";
import type {
  ListingContentFieldCapability,
  ListingContentSnapshot,
} from "./listing-content-types";
import {
  readProductTypeDefinition,
  type ListingsReadAdapter,
} from "./listings-reads";
import { throwListingsReadError } from "./listings-response-error";
import { SpApiError } from "./sp-api-error";

export type ContentCapabilities = ListingContentSnapshot["capabilities"];

export type ContentCapabilityResult = Readonly<{
  capabilities: ContentCapabilities;
  degradedReason: string | null;
}>;

export type ListingContentCapabilitiesRead = Readonly<{
  marketplaceId: MarketplaceId;
  productType: string;
  allowGenericFallback?: boolean;
  forceRefresh?: boolean;
  /** Main-owned phase token used to reuse one exact seller PTD per product type. */
  refreshScope?: object;
}>;

export interface ListingContentCapabilitiesPort {
  read(input: ListingContentCapabilitiesRead): Promise<ContentCapabilityResult>;
  clear(): void;
}

type ListingContentCapabilitiesDependencies = Readonly<{
  listingsReadAdapter: Pick<ListingsReadAdapter, "readDefinition">;
  getCredentialGeneration(): number;
  getSellerId(region: MarketplaceRegion): string | null | undefined;
}>;

type JsonRecord = Record<string, unknown>;

type AmazonProductTypeDefinition = {
  schema?: {
    link?: { resource?: string };
    checksum?: string;
  };
};

const CACHE_TTL_MS = 15 * 60_000;

const IMAGE_ATTRIBUTE_NAMES = [
  "main_product_image_locator",
  "other_product_image_locator_1",
  "other_product_image_locator_2",
  "other_product_image_locator_3",
  "other_product_image_locator_4",
  "other_product_image_locator_5",
  "other_product_image_locator_6",
  "other_product_image_locator_7",
  "other_product_image_locator_8",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sellerScope(sellerId: string | null): string {
  return sellerId
    ? createHash("sha256").update(sellerId).digest("hex").slice(0, 24)
    : "unconfigured";
}

function readOnlyCapabilities(
  reason: string,
  source?: ContentCapabilities,
): ContentCapabilities {
  const field = (
    capability?: ListingContentFieldCapability,
  ): ListingContentFieldCapability => ({
    supported: capability?.supported ?? true,
    editable: false,
    required: capability?.required ?? false,
    minItems: capability?.minItems ?? null,
    maxItems: capability?.maxItems ?? null,
    minLength: capability?.minLength ?? null,
    maxLength: capability?.maxLength ?? null,
    maxUtf8Bytes: capability?.maxUtf8Bytes ?? null,
    languageTags: capability?.languageTags ?? [],
    reason,
  });
  return {
    title: field(source?.title),
    itemHighlight: field(source?.itemHighlight),
    bulletPoints: field(source?.bulletPoints),
    productDescription: field(source?.productDescription),
    ingredients: field(source?.ingredients),
    images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) => {
      const capability = source?.images[index];
      return {
        attributeName,
        label: index === 0 ? "主圖" : `副圖 ${index}`,
        supported: capability?.supported ?? true,
        editable: false,
        required: capability?.required ?? false,
        reason,
      };
    }),
    schemaChecksum: source?.schemaChecksum ?? null,
  };
}

function jsonPointer(root: JsonRecord, ref: string): unknown {
  if (!ref.startsWith("#/")) return null;
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, part) =>
      isRecord(current) ? current[part] : undefined, root);
}

function schemaCandidates(
  root: JsonRecord,
  value: unknown,
  seen = new Set<string>(),
): JsonRecord[] {
  if (!isRecord(value)) return [];
  const candidates: JsonRecord[] = [value];
  if (typeof value.$ref === "string" && !seen.has(value.$ref)) {
    const nextSeen = new Set(seen).add(value.$ref);
    candidates.push(
      ...schemaCandidates(root, jsonPointer(root, value.$ref), nextSeen),
    );
  }
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    if (!Array.isArray(value[key])) continue;
    for (const branch of value[key]) {
      candidates.push(...schemaCandidates(root, branch, new Set(seen)));
    }
  }
  return candidates;
}

function schemaProperty(
  root: JsonRecord,
  node: unknown,
  propertyName: string,
): unknown {
  for (const candidate of schemaCandidates(root, node)) {
    if (
      isRecord(candidate.properties) &&
      propertyName in candidate.properties
    ) {
      return candidate.properties[propertyName];
    }
  }
  return undefined;
}

function schemaValue(
  root: JsonRecord,
  node: unknown,
  key: string,
): unknown {
  for (const candidate of schemaCandidates(root, node)) {
    if (key in candidate) return candidate[key];
  }
  return undefined;
}

function schemaNumber(
  root: JsonRecord,
  node: unknown,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = schemaValue(root, node, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function contentCapability(
  root: JsonRecord,
  attributeName: string,
): ListingContentFieldCapability {
  const attribute = schemaProperty(root, root, attributeName);
  if (!attribute) {
    return {
      supported: false,
      editable: false,
      required: false,
      minItems: null,
      maxItems: null,
      minLength: null,
      maxLength: null,
      maxUtf8Bytes: null,
      languageTags: [],
      reason: `此商品類型不提供 ${attributeName} 欄位。`,
    };
  }
  const itemSchema = schemaValue(root, attribute, "items");
  const valueSchema = schemaProperty(root, itemSchema, "value");
  const languageSchema = schemaProperty(root, itemSchema, "language_tag");
  const editableFlags = [attribute, itemSchema, valueSchema]
    .flatMap((node) => schemaCandidates(root, node))
    .map((node) => node.editable)
    .filter((value): value is boolean => typeof value === "boolean");
  const editable = !editableFlags.includes(false);
  const languageTags = schemaCandidates(root, languageSchema)
    .flatMap((node) => (Array.isArray(node.enum) ? node.enum : []))
    .filter((value): value is string => typeof value === "string");
  const rootRequired = Array.isArray(root.required) ? root.required : [];
  const minItems = schemaNumber(root, attribute, "minItems");
  return {
    supported: true,
    editable,
    required: rootRequired.includes(attributeName) || (minItems ?? 0) > 0,
    minItems,
    maxItems: schemaNumber(root, attribute, "maxItems"),
    minLength: schemaNumber(root, valueSchema, "minLength"),
    maxLength: schemaNumber(root, valueSchema, "maxLength"),
    maxUtf8Bytes: schemaNumber(
      root,
      valueSchema,
      "maxUtf8ByteLength",
      "maxUtf8Bytes",
    ),
    languageTags: [...new Set(languageTags)],
    reason: editable ? null : `Amazon 將 ${attributeName} 標示為唯讀。`,
  };
}

function imageCapability(
  root: JsonRecord,
  attributeName: string,
  index: number,
): ListingImageFieldCapability {
  const attribute = schemaProperty(root, root, attributeName);
  const label = index === 0 ? "主圖" : `副圖 ${index}`;
  if (!attribute) {
    return {
      attributeName,
      label,
      supported: false,
      editable: false,
      required: false,
      reason: `此商品類型不提供 ${label}欄位。`,
    };
  }
  const itemSchema = schemaValue(root, attribute, "items");
  const mediaSchema = schemaProperty(root, itemSchema, "media_location");
  const editableFlags = [attribute, itemSchema, mediaSchema]
    .flatMap((node) => schemaCandidates(root, node))
    .map((node) => node.editable)
    .filter((value): value is boolean => typeof value === "boolean");
  const editable = !editableFlags.includes(false);
  const rootRequired = Array.isArray(root.required) ? root.required : [];
  const minItems = schemaNumber(root, attribute, "minItems");
  return {
    attributeName,
    label,
    supported: true,
    editable,
    required: rootRequired.includes(attributeName) || (minItems ?? 0) > 0,
    reason: editable ? null : `Amazon 將 ${label}標示為唯讀。`,
  };
}

export function createListingContentCapabilities(
  dependencies: ListingContentCapabilitiesDependencies,
): ListingContentCapabilitiesPort {
  const cache = new Map<
    string,
    { expiresAt: number; capabilities: ContentCapabilities }
  >();
  let scopedRefreshes = new WeakMap<
    object,
    Map<string, Promise<ContentCapabilityResult>>
  >();

  function scopedRefreshKey(input: ListingContentCapabilitiesRead): string {
    const marketplace = marketplaceById(input.marketplaceId)!;
    return [
      dependencies.getCredentialGeneration(),
      sellerScope(dependencies.getSellerId(marketplace.region) ?? null),
      input.marketplaceId,
      input.productType,
      input.allowGenericFallback === true ? "read" : "write",
    ].join(":");
  }

  async function fetchCapabilities(
    input: ListingContentCapabilitiesRead,
  ): Promise<ContentCapabilityResult> {
    const marketplace = marketplaceById(input.marketplaceId)!;
    const startedGeneration = dependencies.getCredentialGeneration();
    const startedSellerId = dependencies.getSellerId(marketplace.region) ?? null;
    const cacheKey = [
      startedGeneration,
      sellerScope(startedSellerId),
      input.marketplaceId,
      input.productType,
    ].join(":");
    const cached = cache.get(cacheKey);
    if (!input.forceRefresh && cached && cached.expiresAt > Date.now()) {
      return { capabilities: cached.capabilities, degradedReason: null };
    }

    const result = await readProductTypeDefinition(
      dependencies.listingsReadAdapter,
      {
        intent: input.allowGenericFallback ? "content-read" : "content-write",
        marketplaceId: input.marketplaceId,
        productType: input.productType,
      },
    );
    if (result.status < 200 || result.status >= 300) {
      return throwListingsReadError(result, "getDefinitionsProductType");
    }
    const definition = isRecord(result.envelope)
      ? result.envelope as AmazonProductTypeDefinition
      : null;
    if (!definition?.schema?.link?.resource) {
      throw new SpApiError("Amazon 沒有回傳可用的商品欄位規格。", {
        status: 502,
        code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
        requestId: result.requestId,
        operation: "getDefinitionsProductType",
      });
    }
    if (
      !isRecord(result.schemaEnvelope) ||
      !isRecord(result.schemaEnvelope.properties)
    ) {
      throw new SpApiError("Amazon 商品欄位規格格式無法辨識。", {
        status: 502,
        code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
        operation: "getDefinitionsProductType",
      });
    }
    const schema = result.schemaEnvelope;
    let capabilities: ContentCapabilities = {
      title: contentCapability(schema, "item_name"),
      itemHighlight: contentCapability(schema, "title_differentiation"),
      bulletPoints: contentCapability(schema, "bullet_point"),
      productDescription: contentCapability(schema, "product_description"),
      ingredients: contentCapability(schema, "ingredients"),
      images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) =>
        imageCapability(schema, attributeName, index)
      ),
      schemaChecksum: definition.schema.checksum ?? null,
    };
    if (!result.sellerSpecific) {
      const reason =
        "Amazon 目前只提供通用商品欄位規格；內容可唯讀，所有寫入已停用。";
      capabilities = readOnlyCapabilities(reason, capabilities);
      return { capabilities, degradedReason: reason };
    }
    if (
      startedGeneration !== dependencies.getCredentialGeneration() ||
      startedSellerId !==
        (dependencies.getSellerId(marketplace.region) ?? null)
    ) {
      throw new SpApiError(
        "Amazon 憑證已在商品欄位規格查詢期間改變；舊結果已丟棄。",
        { status: 409, code: "CREDENTIALS_CHANGED" },
      );
    }
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      capabilities,
    });
    return { capabilities, degradedReason: null };
  }

  return {
    async read(input) {
      try {
        if (input.forceRefresh && input.refreshScope) {
          let refreshes = scopedRefreshes.get(input.refreshScope);
          if (!refreshes) {
            refreshes = new Map();
            scopedRefreshes.set(input.refreshScope, refreshes);
          }
          const key = scopedRefreshKey(input);
          let refresh = refreshes.get(key);
          if (!refresh) {
            refresh = fetchCapabilities(input);
            refreshes.set(key, refresh);
          }
          return await refresh;
        }
        return await fetchCapabilities(input);
      } catch (error) {
        if (!input.allowGenericFallback || !(error instanceof SpApiError)) {
          throw error;
        }
        const reason =
          "Amazon 商品欄位規格暫時不可用；Listing 內容可唯讀，所有寫入已停用。";
        return {
          capabilities: readOnlyCapabilities(reason),
          degradedReason: reason,
        };
      }
    },
    clear() {
      cache.clear();
      scopedRefreshes = new WeakMap();
    },
  };
}
