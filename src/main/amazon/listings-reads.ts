import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { SpApiError } from "./sp-api-error";

export type ListingItemReadPlan = Readonly<{
  intent: "listing" | "variation-evidence";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  signal?: AbortSignal;
}>;

export type ListingsSearchPlan =
  | Readonly<{
      intent: "sku-batch" | "variation-sku-batch";
      marketplaceId: MarketplaceId;
      sellerSkus: readonly string[];
      signal?: AbortSignal;
    }>
  | Readonly<{
      intent: "asin-identity";
      marketplaceId: MarketplaceId;
      asin: string;
      signal?: AbortSignal;
    }>
  | Readonly<{
      intent: "variation-children";
      marketplaceId: MarketplaceId;
      parentSku: string;
      pageToken?: string | null;
      signal?: AbortSignal;
    }>
  | Readonly<{
      intent: "access-probe";
      marketplaceId: MarketplaceId;
      signal?: AbortSignal;
    }>;

export type ProductTypeDefinitionReadPlan = Readonly<{
  intent:
    | "content-read"
    | "content-write"
    | "business-offer"
    | "variation-child";
  marketplaceId: MarketplaceId;
  productType: string;
  signal?: AbortSignal;
}>;

export type ListingItemReadIdentity = Readonly<{
  operation: "item";
  intent: ListingItemReadPlan["intent"];
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

export type ListingsSearchIdentity =
  | Readonly<{
      operation: "search";
      intent: "sku-batch" | "variation-sku-batch";
      marketplaceId: MarketplaceId;
      sellerSkus: readonly string[];
    }>
  | Readonly<{
      operation: "search";
      intent: "asin-identity";
      marketplaceId: MarketplaceId;
      asin: string;
    }>
  | Readonly<{
      operation: "search";
      intent: "variation-children";
      marketplaceId: MarketplaceId;
      parentSku: string;
      pageToken: string | null;
    }>
  | Readonly<{
      operation: "search";
      intent: "access-probe";
      marketplaceId: MarketplaceId;
    }>;

export type ProductTypeDefinitionReadIdentity = Readonly<{
  operation: "definition";
  intent: ProductTypeDefinitionReadPlan["intent"];
  marketplaceId: MarketplaceId;
  productType: string;
}>;

export type ListingsReadRequest =
  | ListingItemReadIdentity
  | ListingsSearchIdentity
  | ProductTypeDefinitionReadIdentity;

type RawReadResult = Readonly<{
  status: number;
  envelope: unknown;
  requestId: string | null;
  rateLimit: string | null;
  retryAfter: string | null;
}>;

export type ListingItemReadResult = RawReadResult &
  Readonly<{
    identity: ListingItemReadIdentity;
    profile: "full" | "essential" | "minimal" | "relationships" | "attributes";
  }>;

export type ListingsSearchReadResult = RawReadResult &
  Readonly<{
    identity: ListingsSearchIdentity;
    profile: "listing" | "variation" | "relationships" | "attributes" | "standard" | "minimal";
  }>;

type ProductTypeDefinitionReadResultBase = RawReadResult &
  Readonly<{
    schemaEnvelope: unknown | null;
    schemaBytes: Uint8Array | null;
  }>;

export type ProductTypeDefinitionReadResult =
  | ProductTypeDefinitionReadResultBase &
    Readonly<{
      identity: ProductTypeDefinitionReadIdentity &
        Readonly<{ intent: "content-read" }>;
      sellerSpecific: boolean;
    }>
  | ProductTypeDefinitionReadResultBase &
    Readonly<{
      identity: ProductTypeDefinitionReadIdentity &
        Readonly<{
          intent: "content-write" | "business-offer" | "variation-child";
        }>;
      sellerSpecific: true;
    }>;

export interface ListingsReadAdapter {
  readItem(plan: ListingItemReadPlan): Promise<ListingItemReadResult>;
  searchItems(plan: ListingsSearchPlan): Promise<ListingsSearchReadResult>;
  readDefinition(
    plan: ProductTypeDefinitionReadPlan,
  ): Promise<ProductTypeDefinitionReadResult>;
}

type ScriptedItemStep = Readonly<{
  operation: "item";
  result: Omit<ListingItemReadResult, "identity"> & {
    identity?: ListingItemReadIdentity;
  };
}>;

type ScriptedSearchStep = Readonly<{
  operation: "search";
  result: Omit<ListingsSearchReadResult, "identity"> & {
    identity?: ListingsSearchIdentity;
  };
}>;

type ScriptedDefinitionStep = Readonly<{
  operation: "definition";
  result: Omit<ProductTypeDefinitionReadResult, "identity"> & {
    identity?: ProductTypeDefinitionReadIdentity;
  };
}>;

export type ScriptedListingsReadStep =
  | ScriptedItemStep
  | ScriptedSearchStep
  | ScriptedDefinitionStep;

export type ScriptedListingsReadAdapter = ListingsReadAdapter &
  Readonly<{ requests: ListingsReadRequest[] }>;

const EXACT_TEXT =
  /^(?!.*[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]).+$/u;

function assertMarketplace(marketplaceId: MarketplaceId): void {
  if (!marketplaceById(marketplaceId)) {
    throw new SpApiError("Amazon 站點無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
}

function invalidIntent(operation: "item" | "search" | "definition"): never {
  throw new SpApiError(`Listings ${operation} 讀取意圖不在允許清單內。`, {
    status: 400,
    code: "INVALID_INPUT",
  });
}

function assertExactText(
  value: string,
  label: string,
  maximumLength: number,
): void {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximumLength ||
    !EXACT_TEXT.test(value)
  ) {
    throw new SpApiError(`${label} 必須原樣且不可含控制字元。`, {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

export function exactListingEnvelopeIdentity(
  envelope: unknown,
  marketplaceId: MarketplaceId,
  sellerSku: string,
  expectedAsin?: string,
): boolean {
  if (!isRecord(envelope) || envelope.sku !== sellerSku) return false;
  if (!isRecordArray(envelope.summaries)) return false;
  const summaries = envelope.summaries.filter(
    (summary) => summary.marketplaceId === marketplaceId,
  );
  if (summaries.length !== 1) return false;
  const summary = summaries[0]!;
  const asin = summary.asin;
  const productType = summary.productType;
  if (
    typeof asin !== "string" ||
    !/^[A-Z0-9]{10}$/u.test(asin) ||
    (expectedAsin !== undefined && asin !== expectedAsin) ||
    typeof productType !== "string" ||
    !productType ||
    productType !== productType.trim() ||
    productType.toUpperCase() === "PRODUCT"
  ) return false;
  if (envelope.productTypes !== undefined) {
    if (!isRecordArray(envelope.productTypes)) return false;
    const productTypes = envelope.productTypes.filter(
      (entry) => entry.marketplaceId === marketplaceId,
    );
    if (
      productTypes.length === 0 ||
      productTypes.some((entry) => entry.productType !== productType)
    ) return false;
  }
  return true;
}

function throwListingIdentityMismatch(requestId: string | null): never {
  throw new SpApiError(
    "Amazon Listing 回應的 SKU、ASIN、商品類型或站點身分不完整，已停止使用。",
    {
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
      requestId,
    },
  );
}

function exactParentEvidence(
  envelope: Record<string, unknown>,
  marketplaceId: MarketplaceId,
  parentSku: string,
): boolean {
  if (isRecordArray(envelope.relationships)) {
    const relationshipGroups = envelope.relationships.filter(
      (group) => group.marketplaceId === marketplaceId,
    );
    for (const group of relationshipGroups) {
      if (!isRecordArray(group.relationships)) continue;
      for (const relationship of group.relationships) {
        if (
          Array.isArray(relationship.parentSkus) &&
          relationship.parentSkus.every((value) => typeof value === "string") &&
          relationship.parentSkus.includes(parentSku)
        ) return true;
      }
    }
  }
  if (!isRecord(envelope.attributes)) return false;
  const relations = envelope.attributes.child_parent_sku_relationship;
  if (!isRecordArray(relations)) return false;
  return relations.some((relation) =>
    relation.marketplace_id === marketplaceId &&
    relation.parent_sku === parentSku
  );
}

function assertSearchEnvelopeIdentity(
  envelope: unknown,
  identity: ListingsSearchIdentity,
  requestId: string | null,
): void {
  if (identity.intent === "access-probe") return;
  if (!isRecord(envelope) || !isRecordArray(envelope.items)) {
    throwListingIdentityMismatch(requestId);
  }
  const seen = new Set<string>();
  for (const item of envelope.items) {
    const sellerSku = typeof item.sku === "string" ? item.sku : "";
    const requested =
      identity.intent === "sku-batch" ||
        identity.intent === "variation-sku-batch"
        ? identity.sellerSkus.includes(sellerSku)
        : true;
    const expectedAsin = identity.intent === "asin-identity"
      ? identity.asin
      : undefined;
    if (
      !requested ||
      seen.has(sellerSku) ||
      !exactListingEnvelopeIdentity(
        item,
        identity.marketplaceId,
        sellerSku,
        expectedAsin,
      ) ||
      (identity.intent === "variation-children" &&
        !exactParentEvidence(
          item,
          identity.marketplaceId,
          identity.parentSku,
        ))
    ) {
      throwListingIdentityMismatch(requestId);
    }
    seen.add(sellerSku);
  }
}

export function assertProductTypeDefinitionEnvelopeIdentity(
  envelope: unknown,
  identity: ProductTypeDefinitionReadIdentity,
  requestId: string | null,
): void {
  if (
    !isRecord(envelope) ||
    envelope.productType !== identity.productType ||
    !Array.isArray(envelope.marketplaceIds) ||
    envelope.marketplaceIds.length !== 1 ||
    envelope.marketplaceIds[0] !== identity.marketplaceId
  ) {
    throw new SpApiError(
      "Amazon Product Type Definition 回應的商品類型或站點身分不一致，已停止使用。",
      {
        status: 409,
        code: "LISTING_IDENTITY_MISMATCH",
        requestId,
        operation: "getDefinitionsProductType",
      },
    );
  }
}

export function listingItemReadIdentity(
  plan: ListingItemReadPlan,
): ListingItemReadIdentity {
  assertMarketplace(plan.marketplaceId);
  if (plan.intent !== "listing" && plan.intent !== "variation-evidence") {
    invalidIntent("item");
  }
  assertExactText(plan.sellerSku, "Seller SKU", 256);
  return Object.freeze({
    operation: "item",
    intent: plan.intent,
    marketplaceId: plan.marketplaceId,
    sellerSku: plan.sellerSku,
  });
}

export function listingsSearchIdentity(
  plan: ListingsSearchPlan,
): ListingsSearchIdentity {
  assertMarketplace(plan.marketplaceId);
  if (plan.intent === "sku-batch" || plan.intent === "variation-sku-batch") {
    if (plan.sellerSkus.length < 1 || plan.sellerSkus.length > 20) {
      throw new SpApiError("Listings 批次必須包含 1 到 20 個 Seller SKU。", {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    const sellerSkus = [...plan.sellerSkus];
    for (const sellerSku of sellerSkus) {
      assertExactText(sellerSku, "Seller SKU", 256);
      if (sellerSku.includes(",")) {
        throw new SpApiError("Seller SKU 無法不失真地放入 Listings 批次。", {
          status: 400,
          code: "INVALID_INPUT",
        });
      }
    }
    if (new Set(sellerSkus).size !== sellerSkus.length) {
      throw new SpApiError("Listings 批次含有重複 Seller SKU。", {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    return Object.freeze({
      operation: "search",
      intent: plan.intent,
      marketplaceId: plan.marketplaceId,
      sellerSkus: Object.freeze(sellerSkus),
    });
  }
  if (plan.intent === "asin-identity") {
    if (!/^[A-Z0-9]{10}$/u.test(plan.asin)) {
      throw new SpApiError("ASIN 必須是原樣 10 碼大寫英數字。", {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    return Object.freeze({
      operation: "search",
      intent: plan.intent,
      marketplaceId: plan.marketplaceId,
      asin: plan.asin,
    });
  }
  if (plan.intent === "variation-children") {
    assertExactText(plan.parentSku, "Parent Seller SKU", 256);
    if (plan.pageToken !== undefined && plan.pageToken !== null) {
      assertExactText(plan.pageToken, "Listings page token", 4_096);
    }
    return Object.freeze({
      operation: "search",
      intent: plan.intent,
      marketplaceId: plan.marketplaceId,
      parentSku: plan.parentSku,
      pageToken: plan.pageToken ?? null,
    });
  }
  if (plan.intent !== "access-probe") invalidIntent("search");
  return Object.freeze({
    operation: "search",
    intent: "access-probe",
    marketplaceId: plan.marketplaceId,
  });
}

export function productTypeDefinitionReadIdentity(
  plan: ProductTypeDefinitionReadPlan,
): ProductTypeDefinitionReadIdentity {
  assertMarketplace(plan.marketplaceId);
  if (
    plan.intent !== "content-read" &&
    plan.intent !== "content-write" &&
    plan.intent !== "business-offer" &&
    plan.intent !== "variation-child"
  ) {
    invalidIntent("definition");
  }
  assertExactText(plan.productType, "Product Type", 256);
  if (plan.productType === "PRODUCT") {
    throw new SpApiError("Amazon 商品類型不完整，已停止讀取 PTD。", {
      status: 409,
      code: "LISTING_IDENTITY_MISMATCH",
    });
  }
  return Object.freeze({
    operation: "definition",
    intent: plan.intent,
    marketplaceId: plan.marketplaceId,
    productType: plan.productType,
  });
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sameIdentity(
  actual: ListingsReadRequest,
  expected: ListingsReadRequest,
): boolean {
  if (
    actual.operation !== expected.operation ||
    actual.intent !== expected.intent ||
    actual.marketplaceId !== expected.marketplaceId
  ) return false;
  if (actual.operation === "item" && expected.operation === "item") {
    return actual.sellerSku === expected.sellerSku;
  }
  if (actual.operation === "definition" && expected.operation === "definition") {
    return actual.productType === expected.productType;
  }
  if (actual.operation !== "search" || expected.operation !== "search") {
    return false;
  }
  if (
    (actual.intent === "sku-batch" ||
      actual.intent === "variation-sku-batch") &&
    (expected.intent === "sku-batch" ||
      expected.intent === "variation-sku-batch")
  ) {
    return sameStringArray(actual.sellerSkus, expected.sellerSkus);
  }
  if (actual.intent === "asin-identity" && expected.intent === "asin-identity") {
    return actual.asin === expected.asin;
  }
  if (
    actual.intent === "variation-children" &&
    expected.intent === "variation-children"
  ) {
    return actual.parentSku === expected.parentSku &&
      actual.pageToken === expected.pageToken;
  }
  return actual.intent === "access-probe" && expected.intent === "access-probe";
}

function assertResultIdentity(
  actual: ListingsReadRequest,
  expected: ListingsReadRequest,
): void {
  if (sameIdentity(actual, expected)) return;
  throw new SpApiError(
    "Listings read adapter 回傳了不同語意身分的結果，已停止使用。",
    { status: 502, code: "UPSTREAM_UNAVAILABLE" },
  );
}

export async function readListingsItem(
  adapter: ListingsReadAdapter,
  plan: ListingItemReadPlan,
): Promise<ListingItemReadResult> {
  const expected = listingItemReadIdentity(plan);
  const result = await adapter.readItem(plan);
  assertResultIdentity(result.identity, expected);
  if (result.status >= 200 && result.status < 300) {
    if (
      !exactListingEnvelopeIdentity(
        result.envelope,
        expected.marketplaceId,
        expected.sellerSku,
      )
    ) throwListingIdentityMismatch(result.requestId);
  }
  return result;
}

export async function searchListingsItems(
  adapter: ListingsReadAdapter,
  plan: ListingsSearchPlan,
): Promise<ListingsSearchReadResult> {
  const expected = listingsSearchIdentity(plan);
  const result = await adapter.searchItems(plan);
  assertResultIdentity(result.identity, expected);
  if (result.status >= 200 && result.status < 300) {
    assertSearchEnvelopeIdentity(result.envelope, expected, result.requestId);
  }
  return result;
}

export async function readProductTypeDefinition(
  adapter: ListingsReadAdapter,
  plan: ProductTypeDefinitionReadPlan,
): Promise<ProductTypeDefinitionReadResult> {
  const expected = productTypeDefinitionReadIdentity(plan);
  const result = await adapter.readDefinition(plan);
  assertResultIdentity(result.identity, expected);
  if (result.status >= 200 && result.status < 300) {
    if (expected.intent !== "content-read" && !result.sellerSpecific) {
      throw new SpApiError(
        "Listings read adapter 對寫入相關 PTD 回傳了 generic schema，已停止使用。",
        { status: 502, code: "UPSTREAM_UNAVAILABLE" },
      );
    }
    assertProductTypeDefinitionEnvelopeIdentity(
      result.envelope,
      expected,
      result.requestId,
    );
  }
  return result;
}

function cloneUnknown<T>(value: T): T {
  return structuredClone(value);
}

export function createScriptedListingsReadAdapter(
  scriptedSteps: readonly ScriptedListingsReadStep[],
): ScriptedListingsReadAdapter {
  const steps = [...scriptedSteps];
  const requests: ListingsReadRequest[] = [];

  function take(operation: ScriptedListingsReadStep["operation"]): ScriptedListingsReadStep {
    const step = steps.shift();
    if (!step) throw new Error(`Missing scripted Listings ${operation} result.`);
    if (step.operation !== operation) {
      throw new Error(
        `Expected scripted Listings ${step.operation} result, received ${operation}.`,
      );
    }
    return step;
  }

  return {
    requests,
    async readItem(plan) {
      const identity = listingItemReadIdentity(plan);
      requests.push(identity);
      const step = take("item") as ScriptedItemStep;
      return {
        ...step.result,
        identity: step.result.identity ?? identity,
        envelope: cloneUnknown(step.result.envelope),
      };
    },
    async searchItems(plan) {
      const identity = listingsSearchIdentity(plan);
      requests.push(identity);
      const step = take("search") as ScriptedSearchStep;
      return {
        ...step.result,
        identity: step.result.identity ?? identity,
        envelope: cloneUnknown(step.result.envelope),
      };
    },
    async readDefinition(plan) {
      const identity = productTypeDefinitionReadIdentity(plan);
      requests.push(identity);
      const step = take("definition") as ScriptedDefinitionStep;
      return {
        ...step.result,
        identity: step.result.identity ?? identity,
        envelope: cloneUnknown(step.result.envelope),
        schemaEnvelope: cloneUnknown(step.result.schemaEnvelope),
        schemaBytes: step.result.schemaBytes
          ? new Uint8Array(step.result.schemaBytes)
          : null,
      } as ProductTypeDefinitionReadResult;
    },
  };
}
