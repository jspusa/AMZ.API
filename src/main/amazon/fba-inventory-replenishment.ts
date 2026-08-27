import {
  throwIfAborted as assertNotAborted,
} from "../abort-utils";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES,
  assertReplenishmentRequestBody,
  buildReplenishmentOfferMetricsPageRequest,
  buildReplenishmentOffersPageRequest,
  fetchFbaSubscriptionAuditHistory,
  officialCompleteMonthlyIntervals,
  type FbaSubscriptionAuditHistorySnapshot,
  type OfficialMonthlyInterval,
  type ReplenishmentPageRequest,
} from "./replenishment-audit";
import { SpApiError } from "./sp-api-error";

export type FbaInventorySummary = {
  asin?: string;
  fnSku?: string;
  sellerSku?: string;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    inboundReceivingQuantity?: number;
    reservedQuantity?: { totalReservedQuantity?: number };
    unfulfillableQuantity?: { totalUnfulfillableQuantity?: number };
    researchingQuantity?: { totalResearchingQuantity?: number };
  };
};

export type RestockPlanSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  fnSku: string | null;
  title: string;
  targetDays: number;
  leadTimeDays: number;
  safetyDays: number;
  casePack: number;
  inventory: {
    fulfillable: number;
    reserved: number;
    inboundWorking: number;
    inboundShipped: number;
    inboundReceiving: number;
    unfulfillable: number;
    researching: number;
    inventoryPosition: number;
  };
  demand: {
    lookbackDays: number;
    units: number;
    averageDailyUnits: number;
    ordersScanned: number;
    partial: boolean;
  };
  daysOfCover: number | null;
  reorderPoint: number;
  recommendedUnits: number;
  forecastStockoutAt: string | null;
  action: "RESTOCK_NOW" | "WATCH" | "HEALTHY" | "NO_DEMAND";
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string;
  skillConnected: boolean;
};

export type SubscriptionAuditSnapshot = Omit<
  FbaSubscriptionAuditHistorySnapshot,
  "marketplaceId"
> & Readonly<{
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  requestedMonths: number;
  fetchedAt: string;
  inventoryEvidence: Readonly<{
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION";
    coverage: "complete" | "partial";
    returnedInventoryRows: number;
    provenSkuCount: number;
    unrecognizedSellerSkuRows: number;
    verifiableReplenishmentOfferCount: number;
    unverifiedFbaSkuCount: number;
  }>;
  notice: string;
}>;

export type FbaInventoryReadPlan =
  | Readonly<{
      intent: "item";
      marketplaceId: MarketplaceId;
      sellerSku: string;
      signal?: AbortSignal;
    }>
  | Readonly<{
      intent: "catalog-page";
      marketplaceId: MarketplaceId;
      nextToken: string | null;
      signal?: AbortSignal;
    }>;

export type ReplenishmentReadPlan =
  | Readonly<{
      intent: "single-offer";
      marketplaceId: MarketplaceId;
      sellerSku: string;
      signal?: AbortSignal;
    }>
  | Readonly<{
      intent: "offers-page";
      marketplaceId: MarketplaceId;
      offset: number;
      signal?: AbortSignal;
    }>
  | Readonly<{
      intent: "metrics-page";
      marketplaceId: MarketplaceId;
      interval: OfficialMonthlyInterval;
      offset: number;
      signal?: AbortSignal;
    }>;

export type FbaInventoryReadIdentity =
  | Readonly<{
      operation: "inventory";
      intent: "item";
      marketplaceId: MarketplaceId;
      sellerSku: string;
    }>
  | Readonly<{
      operation: "inventory";
      intent: "catalog-page";
      marketplaceId: MarketplaceId;
      nextToken: string | null;
    }>;

export type ReplenishmentReadIdentity =
  | Readonly<{
      operation: "replenishment";
      intent: "single-offer";
      marketplaceId: MarketplaceId;
      sellerSku: string;
    }>
  | Readonly<{
      operation: "replenishment";
      intent: "offers-page";
      marketplaceId: MarketplaceId;
      offset: number;
    }>
  | Readonly<{
      operation: "replenishment";
      intent: "metrics-page";
      marketplaceId: MarketplaceId;
      interval: OfficialMonthlyInterval;
      offset: number;
    }>;

export type FbaInventoryReplenishmentRequest =
  | FbaInventoryReadIdentity
  | ReplenishmentReadIdentity;

type RawReadResult = Readonly<{
  envelope: unknown;
  requestId: string | null;
  rateLimit: string | null;
}>;

export type FbaInventoryReadResult = RawReadResult &
  Readonly<{ identity: FbaInventoryReadIdentity }>;

export type ReplenishmentReadResult = RawReadResult &
  Readonly<{ identity: ReplenishmentReadIdentity }>;

export interface FbaInventoryReplenishmentAdapter {
  readInventory(plan: FbaInventoryReadPlan): Promise<FbaInventoryReadResult>;
  readReplenishment(
    plan: ReplenishmentReadPlan,
  ): Promise<ReplenishmentReadResult>;
}

type ScriptedInventoryStep = Readonly<{
  operation: "inventory";
  result: Omit<FbaInventoryReadResult, "identity"> & {
    identity?: FbaInventoryReadIdentity;
  };
}>;

type ScriptedReplenishmentStep = Readonly<{
  operation: "replenishment";
  result: Omit<ReplenishmentReadResult, "identity"> & {
    identity?: ReplenishmentReadIdentity;
  };
}>;

export type ScriptedFbaInventoryReplenishmentStep =
  | ScriptedInventoryStep
  | ScriptedReplenishmentStep;

export type ScriptedFbaInventoryReplenishmentAdapter =
  FbaInventoryReplenishmentAdapter &
  Readonly<{ requests: FbaInventoryReplenishmentRequest[] }>;

export type CurrentFbaSkuEvidence = {
  knownFbaSkus: Set<string>;
  returnedInventoryRows: number;
  unrecognizedSellerSkuRows: number;
};

export type SubscriptionInventoryEvidence = {
  source: "FBA_INVENTORY_API_COMPLETE_PAGINATION";
  coverage: "complete" | "partial";
  returnedInventoryRows: number;
  provenSkuCount: number;
  unrecognizedSellerSkuRows: number;
  verifiableReplenishmentOfferCount: number;
  unverifiedFbaSkuCount: number;
};

export type FbaSubscriptionAuditInputs = {
  intervals: OfficialMonthlyInterval[];
  currentFba: CurrentFbaSkuEvidence;
  audit: FbaSubscriptionAuditHistorySnapshot;
  inventoryEvidence: SubscriptionInventoryEvidence;
};

export type ReplenishmentInventoryInputs = {
  sellerSku: string;
  fnSku: string | null;
  inventory: {
    fulfillable: number;
    reserved: number;
    inboundWorking: number;
    inboundShipped: number;
    inboundReceiving: number;
    unfulfillable: number;
    researching: number;
  };
  requestId: string | null;
  rateLimit: string | null;
};

export type SubscribeAndSaveOfferSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  found: boolean;
  asin: string | null;
  eligibility: string | null;
  enrollmentMethod: string | null;
  autoEnrollment: string | null;
  sellerFundedBaseDiscount: number | null;
  sellerFundedTieredDiscount: number | null;
  amazonFundedBaseDiscount: number | null;
  amazonFundedTieredDiscount: number | null;
  price: { amount: number; currencyCode: string } | null;
  inventory: number | null;
  subscriptions: number | null;
  stockRisk: string | null;
  forecastDeliveries: {
    next15Days: number | null;
    next30Days: number | null;
    next60Days: number | null;
    next90Days: number | null;
  } | null;
  deliveryConditions: Array<{
    condition: string;
    next30DaysDeliveries: number | null;
  }>;
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string;
  writable: false;
};

type AmazonReplenishmentOffer = {
  sku?: string;
  asin?: string;
  marketplaceId?: string;
  eligibility?: string;
  programType?: string;
  offerProgramConfiguration?: {
    preferences?: { autoEnrollment?: string };
    promotions?: {
      sellingPartnerFundedBaseDiscount?: { percentage?: number };
      sellingPartnerFundedTieredDiscount?: { percentage?: number };
      amazonFundedBaseDiscount?: { percentage?: number };
      amazonFundedTieredDiscount?: { percentage?: number };
    };
    enrollmentMethod?: string;
  };
  price?: number;
  priceCurrencyCode?: string;
  inventory?: number;
  subscriptions?: number;
  stockRisk?: string;
  forecastDeliveries?: {
    next15DaysDeliveries?: number;
    next30DaysDeliveries?: number;
    next60DaysDeliveries?: number;
    next90DaysDeliveries?: number;
  };
  deliveriesConditions?: Array<{
    condition?: string;
    next30DaysDeliveries?: number;
  }>;
};

const EXACT_TEXT =
  /^(?!.*[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]).+$/u;
const FBA_INVENTORY_AUDIT_MAX_PAGES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertMarketplace(marketplaceId: MarketplaceId): void {
  if (!marketplaceById(marketplaceId)) {
    throw new SpApiError("Amazon 站點無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
}

function assertSellerSku(sellerSku: string): void {
  if (
    typeof sellerSku !== "string" ||
    !sellerSku ||
    sellerSku !== sellerSku.trim() ||
    sellerSku.length > 256 ||
    !EXACT_TEXT.test(sellerSku)
  ) {
    throw new SpApiError("Seller SKU 必須原樣且不可含控制字元。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
}

function assertNextToken(nextToken: string | null): void {
  if (
    nextToken !== null &&
    (typeof nextToken !== "string" ||
      !nextToken ||
      nextToken.length > 4_096 ||
      /[\u0000-\u001f\u007f]/u.test(nextToken))
  ) {
    throw new SpApiError("FBA Inventory nextToken 無效。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
}

export function assertSellerReplenishmentMarketplace(
  marketplaceId: MarketplaceId,
): void {
  assertMarketplace(marketplaceId);
  if (
    !Object.prototype.hasOwnProperty.call(
      OFFICIAL_SELLER_REPLENISHMENT_MARKETPLACES,
      marketplaceId,
    )
  ) {
    const marketplace = marketplaceById(marketplaceId)!;
    throw new SpApiError(
      `${marketplace.label}站目前不在 Amazon 公開的 Seller Replenishment API 支援清單。`,
      { status: 422, code: "REPLENISHMENT_MARKETPLACE_UNSUPPORTED" },
    );
  }
}

function invalidIntent(operation: "inventory" | "replenishment"): never {
  throw new SpApiError(`${operation} 讀取意圖不在允許清單內。`, {
    status: 400,
    code: "INVALID_INPUT",
  });
}

export function fbaInventoryReadIdentity(
  plan: FbaInventoryReadPlan,
): FbaInventoryReadIdentity {
  assertMarketplace(plan.marketplaceId);
  if (plan.intent === "item") {
    assertSellerSku(plan.sellerSku);
    return {
      operation: "inventory",
      intent: "item",
      marketplaceId: plan.marketplaceId,
      sellerSku: plan.sellerSku,
    };
  }
  if (plan.intent === "catalog-page") {
    assertNextToken(plan.nextToken);
    return {
      operation: "inventory",
      intent: "catalog-page",
      marketplaceId: plan.marketplaceId,
      nextToken: plan.nextToken,
    };
  }
  return invalidIntent("inventory");
}

export function replenishmentReadIdentity(
  plan: ReplenishmentReadPlan,
): ReplenishmentReadIdentity {
  assertSellerReplenishmentMarketplace(plan.marketplaceId);
  if (plan.intent === "single-offer") {
    assertSellerSku(plan.sellerSku);
    return {
      operation: "replenishment",
      intent: "single-offer",
      marketplaceId: plan.marketplaceId,
      sellerSku: plan.sellerSku,
    };
  }
  if (plan.intent === "offers-page") {
    const request = buildReplenishmentOffersPageRequest(
      plan.marketplaceId,
      plan.offset,
    );
    assertReplenishmentRequestBody(request);
    return {
      operation: "replenishment",
      intent: "offers-page",
      marketplaceId: plan.marketplaceId,
      offset: plan.offset,
    };
  }
  if (plan.intent === "metrics-page") {
    const request = buildReplenishmentOfferMetricsPageRequest(
      plan.marketplaceId,
      plan.interval,
      plan.offset,
    );
    assertReplenishmentRequestBody(request);
    return {
      operation: "replenishment",
      intent: "metrics-page",
      marketplaceId: plan.marketplaceId,
      interval: { ...plan.interval },
      offset: plan.offset,
    };
  }
  return invalidIntent("replenishment");
}

function sameInterval(
  left: OfficialMonthlyInterval,
  right: OfficialMonthlyInterval,
): boolean {
  return left.month === right.month &&
    left.startDate === right.startDate &&
    left.endDate === right.endDate;
}

function sameIdentity(
  actual: FbaInventoryReplenishmentRequest,
  expected: FbaInventoryReplenishmentRequest,
): boolean {
  if (
    actual.operation !== expected.operation ||
    actual.intent !== expected.intent ||
    actual.marketplaceId !== expected.marketplaceId
  ) return false;
  if (actual.operation === "inventory" && expected.operation === "inventory") {
    if (actual.intent === "item" && expected.intent === "item") {
      return actual.sellerSku === expected.sellerSku;
    }
    return actual.intent === "catalog-page" &&
      expected.intent === "catalog-page" &&
      actual.nextToken === expected.nextToken;
  }
  if (
    actual.operation === "replenishment" &&
    expected.operation === "replenishment"
  ) {
    if (actual.intent === "single-offer" && expected.intent === "single-offer") {
      return actual.sellerSku === expected.sellerSku;
    }
    if (actual.intent === "offers-page" && expected.intent === "offers-page") {
      return actual.offset === expected.offset;
    }
    return actual.intent === "metrics-page" &&
      expected.intent === "metrics-page" &&
      actual.offset === expected.offset &&
      sameInterval(actual.interval, expected.interval);
  }
  return false;
}

function assertResultIdentity(
  actual: FbaInventoryReplenishmentRequest,
  expected: FbaInventoryReplenishmentRequest,
): void {
  if (sameIdentity(actual, expected)) return;
  throw new SpApiError(
    "FBA Inventory/Replenishment adapter 回傳了不同語意身分的結果，已停止使用。",
    { status: 502, code: "UPSTREAM_UNAVAILABLE" },
  );
}

async function readInventoryRaw(
  adapter: FbaInventoryReplenishmentAdapter,
  plan: FbaInventoryReadPlan,
): Promise<FbaInventoryReadResult> {
  const identity = fbaInventoryReadIdentity(plan);
  const result = await adapter.readInventory(plan);
  assertResultIdentity(result.identity, identity);
  return result;
}

async function readReplenishmentRaw(
  adapter: FbaInventoryReplenishmentAdapter,
  plan: ReplenishmentReadPlan,
): Promise<ReplenishmentReadResult> {
  const identity = replenishmentReadIdentity(plan);
  const result = await adapter.readReplenishment(plan);
  assertResultIdentity(result.identity, identity);
  return result;
}

function finiteNumericValue(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  const number = finiteNumericValue(value);
  return number !== null && Number.isInteger(number) && number >= 0
    ? number
    : null;
}

function finitePercentage(value: unknown): number | null {
  const number = finiteNumericValue(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
}

function hasValidOptionalInventoryQuantity(
  record: Record<string, unknown>,
  key: string,
): boolean {
  return record[key] === undefined || finiteNonNegativeInteger(record[key]) !== null;
}

function hasValidOptionalInventoryGroup(
  record: Record<string, unknown>,
  key: string,
  totalKey: string,
): boolean {
  const group = record[key];
  return group === undefined ||
    (isRecord(group) && hasValidOptionalInventoryQuantity(group, totalKey));
}

function isFbaInventorySummary(value: unknown): value is FbaInventorySummary {
  if (!isRecord(value)) return false;
  const details = value.inventoryDetails;
  return isRecord(details) &&
    [
      "fulfillableQuantity",
      "inboundWorkingQuantity",
      "inboundShippedQuantity",
      "inboundReceivingQuantity",
    ].every((key) => hasValidOptionalInventoryQuantity(details, key)) &&
    hasValidOptionalInventoryGroup(
      details,
      "reservedQuantity",
      "totalReservedQuantity",
    ) &&
    hasValidOptionalInventoryGroup(
      details,
      "unfulfillableQuantity",
      "totalUnfulfillableQuantity",
    ) &&
    hasValidOptionalInventoryGroup(
      details,
      "researchingQuantity",
      "totalResearchingQuantity",
    );
}

function exactInventorySellerSku(value: unknown): string | null {
  return typeof value === "string" &&
      Boolean(value) &&
      value.length <= 256 &&
      value === value.trim() &&
      !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
    ? value
    : null;
}

function inventorySummariesFromResponse(
  response: unknown,
): FbaInventorySummary[] | null {
  if (!isRecord(response)) return null;
  if (Array.isArray(response.errors) && response.errors.length) return null;
  const payload = response.payload;
  if (!isRecord(payload)) return null;
  const summaries = payload.inventorySummaries;
  return Array.isArray(summaries) && summaries.every(isFbaInventorySummary)
    ? summaries
    : null;
}

function findExactInventorySummary(
  summaries: FbaInventorySummary[],
  sellerSku: string,
): FbaInventorySummary | null {
  return summaries.find((item) => item.sellerSku === sellerSku) ?? null;
}

export async function readFbaInventoryItem(
  input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
    signal?: AbortSignal;
  },
  context: { adapter: FbaInventoryReplenishmentAdapter },
): Promise<{
  summary: FbaInventorySummary;
  requestId: string | null;
  rateLimit: string | null;
}> {
  assertNotAborted(input.signal);
  const result = await readInventoryRaw(context.adapter, {
    intent: "item",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    signal: input.signal,
  });
  assertNotAborted(input.signal);
  const summaries = inventorySummariesFromResponse(result.envelope);
  if (!summaries) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 庫存資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: result.requestId,
    });
  }
  const summary = findExactInventorySummary(summaries, input.sellerSku);
  if (!summary) {
    throw new SpApiError("Amazon FBA 庫存中找不到這個 SKU。", {
      status: 404,
      code: "FBA_SKU_NOT_FOUND",
      requestId: result.requestId,
    });
  }
  return {
    summary,
    requestId: result.requestId,
    rateLimit: result.rateLimit,
  };
}

function inventoryNextTokenFromResponse(value: unknown): string | null {
  if (!isRecord(value)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 庫存分頁資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  if (value.pagination === undefined || value.pagination === null) return null;
  if (!isRecord(value.pagination)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 FBA 庫存分頁資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  const nextToken = value.pagination.nextToken;
  if (nextToken === undefined || nextToken === null || nextToken === "") return null;
  if (
    typeof nextToken !== "string" ||
    nextToken.length > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(nextToken)
  ) {
    throw new SpApiError("Amazon 回傳了無效的 FBA 庫存 nextToken。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  return nextToken;
}

export async function readCurrentFbaEvidence(
  input: { marketplaceId: MarketplaceId; signal?: AbortSignal },
  context: { adapter: FbaInventoryReplenishmentAdapter },
): Promise<CurrentFbaSkuEvidence> {
  const sellerSkus = new Set<string>();
  const seenTokens = new Set<string>();
  let returnedInventoryRows = 0;
  let unrecognizedSellerSkuRows = 0;
  let nextToken: string | null = null;
  for (let page = 0; page < FBA_INVENTORY_AUDIT_MAX_PAGES; page += 1) {
    assertNotAborted(input.signal);
    const result = await readInventoryRaw(context.adapter, {
      intent: "catalog-page",
      marketplaceId: input.marketplaceId,
      nextToken,
      signal: input.signal,
    });
    assertNotAborted(input.signal);
    const summaries = inventorySummariesFromResponse(result.envelope);
    if (!summaries) {
      throw new SpApiError("Amazon 回傳了無法辨識的 FBA 全站庫存資料。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    for (const summary of summaries) {
      returnedInventoryRows += 1;
      if (!Number.isSafeInteger(returnedInventoryRows)) {
        throw new SpApiError("FBA Inventory 回傳列數超過安全上限。", {
          status: 502,
          code: "UPSTREAM_UNAVAILABLE",
        });
      }
      const sellerSku = exactInventorySellerSku(summary.sellerSku);
      if (!sellerSku) {
        unrecognizedSellerSkuRows += 1;
        continue;
      }
      if (sellerSkus.has(sellerSku)) {
        throw new SpApiError("FBA Inventory 分頁重複回傳同一 SKU，已停止健檢。", {
          status: 409,
          code: "PAGINATION_CHANGED",
        });
      }
      sellerSkus.add(sellerSku);
    }
    const returnedNextToken = inventoryNextTokenFromResponse(result.envelope);
    if (!returnedNextToken) {
      return {
        knownFbaSkus: sellerSkus,
        returnedInventoryRows,
        unrecognizedSellerSkuRows,
      };
    }
    if (summaries.length === 0) {
      throw new SpApiError("FBA Inventory 回傳空白分頁但仍有 nextToken，已停止健檢。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    if (seenTokens.has(returnedNextToken)) {
      throw new SpApiError("FBA Inventory 分頁 nextToken 重複，已停止健檢。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    seenTokens.add(returnedNextToken);
    nextToken = returnedNextToken;
  }
  throw new SpApiError("FBA Inventory 分頁超過安全上限，無法證明已完整讀取。", {
    status: 409,
    code: "PAGINATION_LIMIT_EXCEEDED",
  });
}

function inventoryQuantity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export async function readReplenishmentInventoryInputs(
  input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
    signal?: AbortSignal;
  },
  context: { adapter: FbaInventoryReplenishmentAdapter },
): Promise<ReplenishmentInventoryInputs> {
  const result = await readFbaInventoryItem(input, context);
  const details = result.summary.inventoryDetails;
  return {
    sellerSku: input.sellerSku,
    fnSku: result.summary.fnSku?.trim() || null,
    inventory: {
      fulfillable: inventoryQuantity(details?.fulfillableQuantity),
      reserved: inventoryQuantity(
        details?.reservedQuantity?.totalReservedQuantity,
      ),
      inboundWorking: inventoryQuantity(details?.inboundWorkingQuantity),
      inboundShipped: inventoryQuantity(details?.inboundShippedQuantity),
      inboundReceiving: inventoryQuantity(details?.inboundReceivingQuantity),
      unfulfillable: inventoryQuantity(
        details?.unfulfillableQuantity?.totalUnfulfillableQuantity,
      ),
      researching: inventoryQuantity(
        details?.researchingQuantity?.totalResearchingQuantity,
      ),
    },
    requestId: result.requestId,
    rateLimit: result.rateLimit,
  };
}

function invalidSingleOfferEnvelope(requestId: string | null): never {
  throw new SpApiError("Amazon 回傳了無法辨識的 Subscribe & Save 資料。", {
    status: 502,
    code: "UPSTREAM_UNAVAILABLE",
    requestId,
  });
}

function inventoryAsinForSingleOffer(
  value: unknown,
  requestId: string | null,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalidSingleOfferEnvelope(requestId);
  return value.trim() || null;
}

function normalizeSubscribeAndSaveOffer(input: {
  marketplaceId: MarketplaceId;
  sellerSku: string;
  offer: AmazonReplenishmentOffer | undefined;
  inventoryAsin: string | null;
  requestId: string | null;
  rateLimit: string | null;
  fetchedAt: string;
}): SubscribeAndSaveOfferSnapshot {
  const { offer } = input;
  if (
    offer?.marketplaceId !== undefined &&
    offer.marketplaceId !== input.marketplaceId
  ) invalidSingleOfferEnvelope(input.requestId);
  if (
    offer?.programType !== undefined &&
    offer.programType !== "SUBSCRIBE_AND_SAVE"
  ) invalidSingleOfferEnvelope(input.requestId);
  const offerAsin = offer?.asin?.trim() || null;
  if (input.inventoryAsin && offerAsin && input.inventoryAsin !== offerAsin) {
    invalidSingleOfferEnvelope(input.requestId);
  }
  const promotions = offer?.offerProgramConfiguration?.promotions;
  const forecast = offer?.forecastDeliveries;
  const rawPrice = finiteNumericValue(offer?.price);
  const priceCurrency =
    typeof offer?.priceCurrencyCode === "string" && offer.priceCurrencyCode
      ? offer.priceCurrencyCode
      : marketplaceById(input.marketplaceId)!.currency;
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    found: Boolean(offer),
    asin: offerAsin,
    eligibility: offer?.eligibility?.trim() || null,
    enrollmentMethod:
      offer?.offerProgramConfiguration?.enrollmentMethod?.trim() || null,
    autoEnrollment:
      offer?.offerProgramConfiguration?.preferences?.autoEnrollment?.trim() ||
      null,
    sellerFundedBaseDiscount: finitePercentage(
      promotions?.sellingPartnerFundedBaseDiscount?.percentage,
    ),
    sellerFundedTieredDiscount: finitePercentage(
      promotions?.sellingPartnerFundedTieredDiscount?.percentage,
    ),
    amazonFundedBaseDiscount: finitePercentage(
      promotions?.amazonFundedBaseDiscount?.percentage,
    ),
    amazonFundedTieredDiscount: finitePercentage(
      promotions?.amazonFundedTieredDiscount?.percentage,
    ),
    price: rawPrice !== null
      ? { amount: rawPrice, currencyCode: priceCurrency }
      : null,
    inventory: finiteNonNegativeInteger(offer?.inventory),
    subscriptions: finiteNonNegativeInteger(offer?.subscriptions),
    stockRisk: offer?.stockRisk?.trim() || null,
    forecastDeliveries: forecast
      ? {
          next15Days: finiteNonNegativeInteger(forecast.next15DaysDeliveries),
          next30Days: finiteNonNegativeInteger(forecast.next30DaysDeliveries),
          next60Days: finiteNonNegativeInteger(forecast.next60DaysDeliveries),
          next90Days: finiteNonNegativeInteger(forecast.next90DaysDeliveries),
        }
      : null,
    deliveryConditions: (offer?.deliveriesConditions ?? [])
      .filter(
        (condition) =>
          typeof condition.condition === "string" &&
          Boolean(condition.condition.trim()),
      )
      .map((condition) => ({
        condition: condition.condition!.trim(),
        next30DaysDeliveries: finiteNonNegativeInteger(
          condition.next30DaysDeliveries,
        ),
      })),
    fetchedAt: input.fetchedAt,
    requestId: input.requestId,
    rateLimit: input.rateLimit,
    notice: offer
      ? "Replenishment API 是唯讀查詢；啟用、停用與折扣調整仍需在 Seller Central 完成。"
      : "Amazon 未回傳此 SKU 的 Subscribe & Save offer；不代表一定不符合資格。",
    writable: false,
  };
}

export async function readSubscribeAndSaveOffer(
  input: {
    marketplaceId: MarketplaceId;
    sellerSku: string;
    signal?: AbortSignal;
  },
  context: {
    adapter: FbaInventoryReplenishmentAdapter;
    clock?: () => Date;
  },
): Promise<SubscribeAndSaveOfferSnapshot> {
  assertSellerReplenishmentMarketplace(input.marketplaceId);
  const inventory = await readFbaInventoryItem(input, context);
  const inventoryAsin = inventoryAsinForSingleOffer(
    inventory.summary.asin,
    inventory.requestId,
  );
  assertNotAborted(input.signal);
  const result = await readReplenishmentRaw(context.adapter, {
    intent: "single-offer",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    signal: input.signal,
  });
  assertNotAborted(input.signal);
  if (!isRecord(result.envelope) || !Array.isArray(result.envelope.offers)) {
    invalidSingleOfferEnvelope(result.requestId);
  }
  if (!result.envelope.offers.every(isRecord)) {
    invalidSingleOfferEnvelope(result.requestId);
  }
  const exactOffers = result.envelope.offers.filter(
    (offer) => offer.sku === input.sellerSku,
  );
  if (exactOffers.length > 1) {
    throw new SpApiError(
      "Amazon Replenishment 重複回傳同一 Seller SKU，已停止使用。",
      {
        status: 409,
        code: "PAGINATION_CHANGED",
        requestId: result.requestId,
      },
    );
  }
  const fetchedAt = (context.clock ?? (() => new Date()))().toISOString();
  return normalizeSubscribeAndSaveOffer({
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    offer: exactOffers[0] as AmazonReplenishmentOffer | undefined,
    inventoryAsin,
    requestId: result.requestId,
    rateLimit: result.rateLimit,
    fetchedAt,
  });
}

export function subscriptionInventoryEvidence(
  currentFba: CurrentFbaSkuEvidence,
  verifiableReplenishmentOfferCount: number,
): SubscriptionInventoryEvidence {
  if (
    !Number.isSafeInteger(verifiableReplenishmentOfferCount) ||
    verifiableReplenishmentOfferCount < 0 ||
    verifiableReplenishmentOfferCount > currentFba.knownFbaSkus.size ||
    !Number.isSafeInteger(currentFba.returnedInventoryRows) ||
    !Number.isSafeInteger(currentFba.unrecognizedSellerSkuRows) ||
    currentFba.returnedInventoryRows < 0 ||
    currentFba.unrecognizedSellerSkuRows < 0 ||
    currentFba.returnedInventoryRows !==
      currentFba.knownFbaSkus.size + currentFba.unrecognizedSellerSkuRows
  ) {
    throw new SpApiError(
      "Subscribe & Save offer 範圍與同次 FBA Inventory 證據不一致。",
      { status: 502, code: "UPSTREAM_UNAVAILABLE" },
    );
  }
  return {
    source: "FBA_INVENTORY_API_COMPLETE_PAGINATION",
    coverage:
      currentFba.unrecognizedSellerSkuRows === 0 ? "complete" : "partial",
    returnedInventoryRows: currentFba.returnedInventoryRows,
    provenSkuCount: currentFba.knownFbaSkus.size,
    unrecognizedSellerSkuRows: currentFba.unrecognizedSellerSkuRows,
    verifiableReplenishmentOfferCount,
    unverifiedFbaSkuCount:
      currentFba.knownFbaSkus.size - verifiableReplenishmentOfferCount,
  };
}

function replenishmentPlanFromRequest(
  marketplaceId: MarketplaceId,
  request: ReplenishmentPageRequest,
  signal?: AbortSignal,
): ReplenishmentReadPlan {
  assertReplenishmentRequestBody(request);
  if (request.operation === "listOffers") {
    return {
      intent: "offers-page",
      marketplaceId,
      offset: request.offset,
      signal,
    };
  }
  const filters = request.body.filters;
  if (!isRecord(filters) || !isRecord(filters.timeInterval)) {
    throw new SpApiError(
      "Replenishment monthly metric request 無法辨識。",
      { status: 502, code: "UPSTREAM_UNAVAILABLE" },
    );
  }
  const startDate = String(filters.timeInterval.startDate ?? "");
  const endDate = String(filters.timeInterval.endDate ?? "");
  return {
    intent: "metrics-page",
    marketplaceId,
    interval: {
      month: startDate.slice(0, 7),
      startDate,
      endDate,
    },
    offset: request.offset,
    signal,
  };
}

export async function readFbaSubscriptionAuditInputs(
  input: {
    marketplaceId: MarketplaceId;
    months: number;
    now?: Date;
    signal?: AbortSignal;
  },
  context: { adapter: FbaInventoryReplenishmentAdapter },
): Promise<FbaSubscriptionAuditInputs> {
  assertNotAborted(input.signal);
  assertSellerReplenishmentMarketplace(input.marketplaceId);
  const now = input.now ? new Date(input.now.getTime()) : new Date();
  const intervals = officialCompleteMonthlyIntervals(input.months, now);
  const currentFba = await readCurrentFbaEvidence(
    { marketplaceId: input.marketplaceId, signal: input.signal },
    context,
  );
  assertNotAborted(input.signal);
  const audit = await fetchFbaSubscriptionAuditHistory({
    marketplaceId: input.marketplaceId,
    metricIntervals: intervals,
    knownFbaSkus: currentFba.knownFbaSkus,
    knownFbaSkuCoverage:
      currentFba.unrecognizedSellerSkuRows === 0 ? "complete" : "partial",
    now,
    transport: async (request) => {
      assertNotAborted(input.signal);
      const plan = replenishmentPlanFromRequest(
        input.marketplaceId,
        request,
        input.signal,
      );
      const result = await readReplenishmentRaw(context.adapter, plan);
      assertNotAborted(input.signal);
      return result.envelope;
    },
  });
  assertNotAborted(input.signal);
  return {
    intervals,
    currentFba,
    audit,
    inventoryEvidence: subscriptionInventoryEvidence(
      currentFba,
      audit.offers.length,
    ),
  };
}

function cloneUnknown<T>(value: T): T {
  return structuredClone(value);
}

export function createScriptedFbaInventoryReplenishmentAdapter(
  scriptedSteps: readonly ScriptedFbaInventoryReplenishmentStep[],
): ScriptedFbaInventoryReplenishmentAdapter {
  const steps = [...scriptedSteps];
  const requests: FbaInventoryReplenishmentRequest[] = [];

  function take(
    operation: ScriptedFbaInventoryReplenishmentStep["operation"],
  ): ScriptedFbaInventoryReplenishmentStep {
    const step = steps.shift();
    if (!step) {
      throw new Error(
        `Missing scripted FBA Inventory/Replenishment ${operation} result.`,
      );
    }
    if (step.operation !== operation) {
      throw new Error(
        `Expected scripted ${step.operation} result, received ${operation}.`,
      );
    }
    return step;
  }

  return {
    requests,
    async readInventory(plan) {
      const identity = fbaInventoryReadIdentity(plan);
      requests.push(identity);
      const step = take("inventory") as ScriptedInventoryStep;
      return {
        ...step.result,
        identity: step.result.identity ?? identity,
        envelope: cloneUnknown(step.result.envelope),
      };
    },
    async readReplenishment(plan) {
      const identity = replenishmentReadIdentity(plan);
      requests.push(identity);
      const step = take("replenishment") as ScriptedReplenishmentStep;
      return {
        ...step.result,
        identity: step.result.identity ?? identity,
        envelope: cloneUnknown(step.result.envelope),
      };
    },
  };
}
