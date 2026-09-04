import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../shared/marketplaces";
import { NATIVE_CONFIRMATION_REASON_MAX_LENGTH } from
  "../shared/native-confirmation-limits";
import type {
  BusinessPricePrecommitEvidence,
  BusinessPriceWriteStatus,
  BusinessPriceUpdateResult,
  BusinessPriceValidationResult,
  BusinessPricingListingSnapshot,
  BusinessQuantityDiscountLevel,
  BusinessQuantityDiscountPlan,
  UpdateBusinessPriceInput,
} from "./amazon/business-pricing-types";
import type {
  BusinessPricingAuditRow,
  BusinessPricingAuditSnapshot,
} from "./amazon/catalog-report-reads";
import {
  RECOMMENDED_BUSINESS_PRICE_DISCOUNT_USD,
  RECOMMENDED_BUSINESS_QUANTITY_TIERS,
  businessPricingRecommendationFlags,
  recommendedBusinessPricingConfigurationState,
} from "../shared/business-pricing-recommendations";
import {
  businessPricingPatchBody,
  type BusinessMinimumPricePatch,
  type BusinessPricePatch,
  type BusinessPricingGateway,
  type BusinessPricingGatewayReply,
} from "./amazon/business-pricing-gateway";
import {
  isPricingListingError,
  listingSubmissionIssuesAreWellFormed,
} from "./amazon/business-pricing-evidence";
import type { ListingWriteExecutionFence } from
  "./amazon/listing-write-execution-fence";
import type { Money } from "./amazon/listing-price-types";
import {
  normalizeListingIssues,
  throwListingsPayloadError,
} from "./amazon/listings-response-error";
import {
  publicSpApiError,
  SpApiError,
  SpApiPreCommitError,
  type ListingIssue,
} from "./amazon/sp-api-error";
import {
  commitWithCanonicalReadback,
} from "./amazon/listing-write-readback";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import {
  bodyRecord,
  isPlainRecord,
  parseMarketplace,
  parseSellerSku,
  reportIdentifier,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  MainWriteGateError,
  type MainWriteGateInspection,
  type MainWriteGatePort,
  type WriteBinding,
} from "./write-gate";

export type BusinessPricingMutationCommand = Readonly<{
  operation:
    | "read"
    | "preview"
    | "commit"
    | "batchRead"
    | "batchPreview"
    | "batchCommit";
  request: ApiRequest;
}>;

export interface BusinessPricingMutationsPort {
  handle(command: BusinessPricingMutationCommand): Promise<ApiResponse>;
  clear?(): void;
}

interface BusinessPricingMutationOperations {
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): Promise<BusinessPricingListingSnapshot>;
  preview(
    input: UpdateBusinessPriceInput,
  ): Promise<BusinessPriceValidationResult>;
  commit(
    input: UpdateBusinessPriceInput,
    control: Readonly<{
      expectedEvidence?: BusinessPricePrecommitEvidence;
      fence: ListingWriteExecutionFence;
      recordDurableEvidence(result: BusinessPriceDurableResult): Promise<void>;
    }>,
  ): Promise<BusinessPriceUpdateResult>;
  commitMinimumPrice(
    input: UpdateBusinessPriceInput,
    control: Readonly<{
      expectedEvidence: BusinessPriceValidationResult;
      fence: ListingWriteExecutionFence;
      recordDurableEvidence(result: MinimumPriceDurableResult): Promise<void>;
    }>,
  ): Promise<MinimumPriceUpdateResult>;
  minimumPriceReadbackDecision(
    result: MinimumPriceUpdateResult,
    snapshot: BusinessPricingListingSnapshot,
  ): "verified" | "pending";
}

export interface BusinessPricingCanonicalPriceObserver {
  observeCanonical(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      sellerSku: string;
    }>,
    snapshot: BusinessPricingListingSnapshot,
    context: SpExecutionContext,
  ): Promise<void>;
}

type BusinessPricingRouteInput = UpdateBusinessPriceInput & Readonly<{
  idempotencyKey: string;
}>;

type BusinessPricingBatchStage = "minimum_price" | "business_price";

type BusinessPricingBatchAuditIdentity = Readonly<{
  sellerSku: string;
  asin: string;
  productType: string;
}>;

type BusinessPricingBatchChange = Readonly<{
  input: BusinessPricingRouteInput;
  evidence: BusinessPriceValidationResult;
  stage: BusinessPricingBatchStage;
  auditIdentity: BusinessPricingBatchAuditIdentity;
}>;

type BusinessPricingBatchRowResult = Readonly<{
  sellerSku: string;
  stage: BusinessPricingBatchStage;
  state:
    | "processing"
    | "verified"
    | "simulated"
    | "rejected"
    | "unknown"
    | "not-started";
  result: unknown | null;
  error: Readonly<{
    code: string;
    message: string;
    requestId: string | null;
  }> | null;
}>;

type BusinessPricingBatchPlan = {
  previewId: string;
  auditJobId: string;
  auditContextId: string;
  marketplaceId: MarketplaceId;
  context: SpExecutionContext;
  changes: BusinessPricingBatchChange[];
  expiresAt: number;
  state: "ready" | "committing" | "completed";
  stageResults: Map<BusinessPricingBatchStage, BusinessPricingBatchRowResult[]>;
  acceptedTargets: Map<
    string,
    BusinessPriceUpdateResult | MinimumPriceUpdateResult
  >;
};

type BusinessPricingBatchAuditJobReceipt = Readonly<{
  ready: boolean;
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  jobId: string;
  contextId: string;
  kind: string;
  marketplaceId: string;
  mode: "live" | "demo";
  snapshot?: unknown;
}>;

export type BusinessPricingBatchAuditJobReader = (
  input: Readonly<{
    kind: "businessPricing";
    marketplaceId: MarketplaceId;
    mode: "live" | "demo";
    jobId: string;
    contextId: string;
  }>,
) => Promise<BusinessPricingBatchAuditJobReceipt>;

type BusinessPricingReconciliationSchedule = (
  run: () => Promise<void>,
  delayMs: number,
) => void;

const BUSINESS_PRICING_BATCH_MAX_ITEMS = 100;
const BUSINESS_PRICING_BATCH_PREVIEW_TTL_MS = 2 * 60_000;
const BUSINESS_PRICING_BATCH_RESULT_TTL_MS = 30 * 60_000;
const BUSINESS_PRICING_RECONCILIATION_MAX_CONCURRENT_READS = 2;
const BUSINESS_PRICING_RECONCILIATION_DELAYS_MS = [
  1_000,
  4_000,
  10_000,
  20_000,
  30_000,
  45_000,
  60_000,
  90_000,
  100_000,
  120_000,
  120_000,
] as const;
const BUSINESS_PRICING_BATCH_ROW_LOCAL_PRECOMMIT_CODES = new Set([
  "BUSINESS_PRICE_AMBIGUOUS",
  "BUSINESS_PRICE_CHANGED",
  "BUSINESS_PRICE_UNCHANGED",
  "BUSINESS_PRICING_MANAGED_BY_AUTOMATION",
  "BUSINESS_PRICING_UNSUPPORTED",
  "BUSINESS_QUANTITY_DISCOUNTS_UNSUPPORTED",
  "CURRENCY_MISMATCH",
  "DUPLICATE_REPAIR_CHANGED",
  "INVALID_MINIMUM_PRICE",
  "INVALID_PRICE",
  "INVALID_QUANTITY_DISCOUNT",
  "LISTING_IDENTITY_MISMATCH",
  "MINIMUM_PRICE_AMBIGUOUS",
  "MINIMUM_PRICE_CHANGED",
  "MINIMUM_PRICE_REPAIR_CONFLICT",
  "MINIMUM_PRICE_UNSUPPORTED",
  "PREVIEW_CHANGED",
  "PRICE_CHANGED",
  "PRICE_UNAVAILABLE",
  "QUANTITY_DISCOUNT_CHANGED",
  "VALIDATION_FAILED",
]);

const defaultBusinessPricingReconciliationSchedule:
  BusinessPricingReconciliationSchedule = (run, delayMs) => {
    const timer = setTimeout(() => {
      void run();
    }, delayMs);
    timer.unref?.();
  };

function exactAuditMoney(
  value: unknown,
): Readonly<{ amount: number; currencyCode: string }> | null {
  if (!isRecord(value)) return null;
  return typeof value.amount === "number" && Number.isFinite(value.amount) &&
      value.amount > 0 && typeof value.currencyCode === "string"
    ? { amount: value.amount, currencyCode: value.currencyCode }
    : null;
}

function businessPricingAuditSnapshot(
  value: unknown,
  context: SpExecutionContext,
): BusinessPricingAuditSnapshot {
  if (!isRecord(value) ||
      value.mode !== context.mode ||
      value.marketplaceId !== context.marketplaceId ||
      typeof value.fetchedAt !== "string" ||
      !Array.isArray(value.rows) ||
      !isRecord(value.summary) ||
      typeof value.notice !== "string") {
    throw new SpApiError(
      "B2B 批次只能使用目前 main process 已完成且可核對的健檢快照。",
      { status: 409, code: "BATCH_AUDIT_EVIDENCE_INVALID" },
    );
  }
  return value as BusinessPricingAuditSnapshot;
}

function recommendedBatchTiers(
  row: BusinessPricingAuditRow,
): readonly Readonly<{ lowerBound: number; percent: number }>[] {
  if (
    row.quantityDiscountPlanPresence === "duplicate" &&
    row.quantityDiscountPlan?.discountType === "percent"
  ) {
    return row.quantityDiscountPlan.levels.map((level) => ({
      lowerBound: level.lowerBound,
      percent: level.value,
    }));
  }
  return RECOMMENDED_BUSINESS_QUANTITY_TIERS.map((tier) => ({
    lowerBound: tier.lowerBound,
    percent: tier.value,
  }));
}

function exactRequestedTiers(
  value: unknown,
  expected: readonly Readonly<{ lowerBound: number; percent: number }>[],
): boolean {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((candidate, index) => {
      const tier = expected[index];
      return isPlainRecord(candidate) &&
        Object.keys(candidate).length === 2 &&
        candidate.lowerBound === tier?.lowerBound &&
        candidate.percent === tier.percent;
    });
}

function assertSnapshotProvesBatchItem(
  snapshot: BusinessPricingAuditSnapshot,
  rawItem: Record<string, unknown>,
): BusinessPricingBatchAuditIdentity {
  const sellerSku = parseSellerSku(rawItem.sellerSku);
  const marketplaceId = parseMarketplace(rawItem.marketplaceId);
  const matches = sellerSku
    ? snapshot.rows.filter((row) => row.sellerSku === sellerSku)
    : [];
  const row = matches.length === 1 ? matches[0]! : null;
  const asin = row && typeof row.asin === "string" &&
      /^[A-Z0-9]{10}$/u.test(row.asin)
    ? row.asin
    : null;
  const productType = row && typeof row.productType === "string" &&
      /^[A-Z0-9_]{1,128}$/u.test(row.productType)
    ? row.productType
    : null;
  const standardPrice = row ? exactAuditMoney(row.standardPrice) : null;
  const businessPrice = row ? exactAuditMoney(row.businessPrice) : null;
  const recommendationFlags = row
    ? businessPricingRecommendationFlags({
        standardPrice: row.standardPrice,
        businessPrice: row.businessPrice,
        quantityDiscountPlan: row.quantityDiscountPlan,
        quantityDiscountPlanPresence: row.quantityDiscountPlanPresence,
      })
    : null;
  const eligible = Boolean(
    row &&
    standardPrice?.currencyCode === "USD" &&
    standardPrice.amount > RECOMMENDED_BUSINESS_PRICE_DISCOUNT_USD &&
    row.status !== "missing" &&
    row.status !== "unsupported" &&
    row.status !== "incomplete" &&
    recommendedBusinessPricingConfigurationState(row) === "needs_adjustment" &&
    recommendationFlags?.recommendedPriceMismatch ===
      row.recommendedPriceMismatch &&
    recommendationFlags?.recommendedQuantityDiscountMismatch ===
      row.recommendedQuantityDiscountMismatch
  );
  const expectedBusinessPrice = businessPrice?.amount ?? null;
  const requestedBusinessPrice = standardPrice
    ? Number((
        standardPrice.amount - RECOMMENDED_BUSINESS_PRICE_DISCOUNT_USD
      ).toFixed(2))
    : null;
  if (
    !eligible ||
    !asin ||
    !productType ||
    marketplaceId !== snapshot.marketplaceId ||
    rawItem.expectedStandardPrice !== standardPrice?.amount ||
    rawItem.expectedBusinessPrice !== expectedBusinessPrice ||
    rawItem.newBusinessPrice !== requestedBusinessPrice ||
    !exactRequestedTiers(
      rawItem.quantityDiscountTiers,
      recommendedBatchTiers(row!),
    )
  ) {
    throw new SpApiError(
      `SKU ${sellerSku ?? "?"} 不屬於這份已完成健檢的可處理問題列，或建議／Amazon 原值證據不一致。`,
      { status: 409, code: "BATCH_AUDIT_EVIDENCE_MISMATCH" },
    );
  }
  return { sellerSku: sellerSku!, asin, productType };
}

function parsePrice(value: unknown, currencyCode: string): number | null {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return null;
  const pattern = currencyCode === "JPY"
    ? /^\d{1,9}$/u
    : /^\d{1,9}(?:\.\d{1,2})?$/u;
  if (!pattern.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function validIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/u.test(value)
    ? value
    : null;
}

function isBatchRowLocalPrecommitError(
  error: unknown,
): error is SpApiPreCommitError {
  return error instanceof SpApiPreCommitError &&
    error.commitPatchSent === false &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 403 &&
    error.status !== 429 &&
    BUSINESS_PRICING_BATCH_ROW_LOCAL_PRECOMMIT_CODES.has(error.code);
}

function proposalFingerprint(
  input: UpdateBusinessPriceInput,
  evidence: BusinessPricePrecommitEvidence,
): string {
  return createHash("sha256").update(JSON.stringify([
    input.marketplaceId,
    input.sellerSku,
    input.expectedStandardPrice,
    input.expectedBusinessPrice,
    input.newBusinessPrice,
    input.expectedMinimumPrice === undefined
      ? "minimum-price:not-bound"
      : input.expectedMinimumPrice,
    input.quantityDiscountTiers === undefined
      ? "quantity-discount:preserve"
      : `quantity-discount:replace:${input.expectedQuantityDiscountPlanHash ?? "absent"}`,
    input.quantityDiscountTiers === undefined
      ? null
      : input.quantityDiscountTiers.map((tier) => [
          tier.lowerBound,
          tier.percent,
        ]),
    evidence.asin,
    evidence.productType,
    evidence.businessOfferGuardHash,
    evidence.businessOfferProtectedHash,
    evidence.previousQuantityDiscountPlanHash,
    evidence.quantityDiscountPlanPresence,
    evidence.quantityDiscountPlanChange,
    evidence.schemaChecksum,
    evidence.fbaEvidenceHash,
    evidence.canonicalPatchHash,
    evidence.validationIssuesHash,
  ])).digest("hex");
}

function marketplaceCode(marketplaceId: MarketplaceId): string {
  const code = marketplaceById(marketplaceId)?.code ?? "";
  return code === "UK" ? "GB" : code;
}

function writeError(error: unknown, fallback: string): ApiResponse {
  return error instanceof MainWriteGateError
    ? invalid(error.message, error.status, error.code)
    : routeError(error, fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
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

function samePrice(left: number, right: number, currencyCode: string): boolean {
  const precision = currencyCode === "JPY" ? 0 : 2;
  return left.toFixed(precision) === right.toFixed(precision);
}

function usdPercentTierAmount(
  businessPrice: number,
  percent: number,
): number {
  const businessCents = Math.round(businessPrice * 100);
  const percentBasisPoints = Math.round(percent * 100);
  return Math.round(
    businessCents * (10_000 - percentBasisPoints) / 10_000,
  ) / 100;
}

function requestedQuantityDiscountPlan(
  listing: BusinessPricingListingSnapshot,
  input: UpdateBusinessPriceInput,
): BusinessQuantityDiscountPlan | null {
  const tiers = input.quantityDiscountTiers;
  if (tiers === undefined) {
    if (input.expectedQuantityDiscountPlanHash !== undefined) {
      throw new SpApiError(
        "只調整 Business Price 時不可夾帶數量折扣 hash。",
        { status: 400, code: "INVALID_QUANTITY_DISCOUNT" },
      );
    }
    return null;
  }
  if (
    !listing.businessPricingCapability.quantityDiscountsSupported ||
    !listing.businessPricingCapability.quantityDiscountsEditable
  ) {
    throw new SpApiError(
      listing.businessPricingCapability.quantityDiscountsReason ||
        "Amazon seller-specific PTD 未開放 B2B 數量折扣寫入。",
      { status: 422, code: "BUSINESS_QUANTITY_DISCOUNTS_UNSUPPORTED" },
    );
  }
  if (
    listing.quantityDiscountPlanPresence === "ambiguous" ||
    (listing.quantityDiscountPlanPresence === "duplicate" &&
      listing.quantityDiscountPlan?.discountType !== "percent") ||
    tiers.length < 1 || tiers.length > 5 ||
    input.expectedQuantityDiscountPlanHash === undefined ||
    input.expectedQuantityDiscountPlanHash !== listing.quantityDiscountPlanHash
  ) {
    throw new SpApiError(
      "目前數量折扣不明、已改變，或請求未明確綁定舊方案。",
      { status: 409, code: "QUANTITY_DISCOUNT_CHANGED" },
    );
  }
  const currencyCode = marketplaceById(input.marketplaceId)!.currency;
  const precision = currencyCode === "JPY" ? 0 : 2;
  const levels: BusinessQuantityDiscountLevel[] = [];
  for (const tier of tiers) {
    const previous = levels.at(-1);
    if (
      !Number.isSafeInteger(tier.lowerBound) || tier.lowerBound <= 0 ||
      !Number.isFinite(tier.percent) || tier.percent <= 0 ||
      tier.percent >= 100 ||
      Math.round(tier.percent * 100) / 100 !== tier.percent ||
      (previous &&
        (tier.lowerBound <= previous.lowerBound ||
          tier.percent <= previous.value))
    ) {
      throw new SpApiError(
        "數量折扣必須是 1–5 階；件數為正整數，件數與百分比需嚴格遞增，百分比須大於 0 且小於 100。",
        { status: 400, code: "INVALID_QUANTITY_DISCOUNT" },
      );
    }
    const unitPrice = currencyCode === "USD"
      ? usdPercentTierAmount(input.newBusinessPrice, tier.percent)
      : Number((
          input.newBusinessPrice * (1 - tier.percent / 100)
        ).toFixed(precision));
    const previousUnitPrice = previous
      ? currencyCode === "USD"
        ? usdPercentTierAmount(input.newBusinessPrice, previous.value)
        : Number((
            input.newBusinessPrice * (1 - previous.value / 100)
          ).toFixed(precision))
      : input.newBusinessPrice;
    if (unitPrice <= 0 || unitPrice >= previousUnitPrice) {
      throw new SpApiError(
        "數量折扣依站點幣別精度換算後，必須逐階產生更低且大於 0 的單價。",
        { status: 400, code: "INVALID_QUANTITY_DISCOUNT" },
      );
    }
    levels.push({ lowerBound: tier.lowerBound, value: tier.percent });
  }
  return { discountType: "percent", levels };
}

type VerifiedBusinessPriceChange = Readonly<{
  standardPrice: Money;
  previousBusinessPrice: Money | null;
  requestedBusinessPrice: Money;
  previousMinimumPrice: Money | null;
  requestedMinimumPrice: Money | null;
  lowestTierUnitPrice: Money | null;
  minimumPriceChange: "preserve" | "lower";
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  previousQuantityDiscountPlanHash: string | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanChange: "preserve" | "replace";
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  schemaChecksum: string;
}>;

function verifyBusinessPriceChange(
  listing: BusinessPricingListingSnapshot,
  input: UpdateBusinessPriceInput,
): VerifiedBusinessPriceChange {
  const currencyCode = marketplaceById(input.marketplaceId)!.currency;
  const precision = currencyCode === "JPY" ? 0 : 2;
  const factor = 10 ** precision;
  if (
    !Number.isFinite(input.newBusinessPrice) ||
    input.newBusinessPrice <= 0 ||
    Math.round(input.newBusinessPrice * factor) / factor !==
      input.newBusinessPrice
  ) {
    throw new SpApiError("請提供符合站點幣別精度的 Amazon Business 價格。", {
      status: 400,
      code: "INVALID_PRICE",
    });
  }
  if (!listing.standardPrice) {
    throw new SpApiError("此 SKU 沒有可核對的標準售價，已停止 B2B 調價。", {
      status: 422,
      code: "PRICE_UNAVAILABLE",
    });
  }
  if (listing.standardPrice.currencyCode !== currencyCode) {
    throw new SpApiError("標準售價幣別與站點不一致，已停止 B2B 調價。", {
      status: 409,
      code: "CURRENCY_MISMATCH",
    });
  }
  if (!samePrice(
    listing.standardPrice.amount,
    input.expectedStandardPrice,
    currencyCode,
  )) {
    throw new SpApiError("標準售價已改變，請重新讀取後再預檢。", {
      status: 409,
      code: "PRICE_CHANGED",
    });
  }
  if (
    !listing.businessPricingCapability.supported ||
    !listing.businessPricingCapability.editable ||
    !listing.businessPricingCapability.schemaChecksum
  ) {
    throw new SpApiError(
      listing.businessPricingCapability.reason ||
        "Amazon seller-specific PTD 未開放 B2B 價格寫入。",
      { status: 422, code: "BUSINESS_PRICING_UNSUPPORTED" },
    );
  }
  if (listing.businessOfferPresence === "ambiguous") {
    throw new SpApiError("目前 B2B offer 不唯一或無法解析，已停止覆蓋。", {
      status: 409,
      code: "BUSINESS_PRICE_AMBIGUOUS",
    });
  }
  if (listing.businessPricingManagedByAutomation) {
    throw new SpApiError(
      "此 B2B contribution 由 Amazon Automate Pricing 管理；為避免 static value 被規則覆蓋，請先在 Seller Central 處理自動定價規則。",
      { status: 409, code: "BUSINESS_PRICING_MANAGED_BY_AUTOMATION" },
    );
  }
  if (
    listing.quantityDiscountPlanPresence === "ambiguous" ||
    (listing.quantityDiscountPlanPresence === "duplicate" &&
      input.quantityDiscountTiers === undefined)
  ) {
    throw new SpApiError(
      listing.quantityDiscountPlanPresence === "duplicate"
        ? "Amazon 回傳多份內容相同的數量折扣；本次必須一併送出目前階梯，才能用單一 contribution 修復，不能只改價格。"
        : "目前數量折扣無法完整辨識；為避免覆蓋既有階梯，價格與折扣都已停止修改。",
      { status: 409, code: "QUANTITY_DISCOUNT_CHANGED" },
    );
  }
  const requestedPlan = requestedQuantityDiscountPlan(listing, input);
  const minimumPricePresence = listing.minimumPricePresence ??
    (listing.minimumPrice ? "canonical" : "ambiguous");
  const hasExpectedMinimumPrice = input.expectedMinimumPrice !== undefined;
  const previousMinimumPrice = listing.minimumPrice;
  let requestedMinimumPrice = listing.minimumPrice;
  let lowestTierUnitPrice: Money | null = null;
  let minimumPriceChange: "preserve" | "lower" = "preserve";
  if (input.quantityDiscountTiers === undefined) {
    if (hasExpectedMinimumPrice) {
      throw new SpApiError(
        "只調整 Business Price 時不可夾帶最低允許售價綁定。",
        { status: 400, code: "INVALID_MINIMUM_PRICE" },
      );
    }
  } else {
    if (!hasExpectedMinimumPrice) {
      throw new SpApiError(
        "更新階梯折扣時必須綁定目前最低允許售價。",
        { status: 400, code: "INVALID_MINIMUM_PRICE" },
      );
    }
    if (minimumPricePresence === "ambiguous") {
      throw new SpApiError(
        "Amazon 回傳的最低允許售價不唯一或無法辨識，已停止自動調整。",
        { status: 409, code: "MINIMUM_PRICE_AMBIGUOUS" },
      );
    }
    const expectedMinimumPrice = input.expectedMinimumPrice;
    if (
      (minimumPricePresence === "absent" &&
        (listing.minimumPrice !== null || expectedMinimumPrice !== null)) ||
      (minimumPricePresence === "canonical" &&
        (!listing.minimumPrice || expectedMinimumPrice == null ||
          !samePrice(
            listing.minimumPrice.amount,
            expectedMinimumPrice,
            currencyCode,
          )))
    ) {
      throw new SpApiError(
        "Amazon 最低允許售價已改變，請重新讀取後再預檢。",
        { status: 409, code: "MINIMUM_PRICE_CHANGED" },
      );
    }
    const lastTier = input.quantityDiscountTiers.at(-1)!;
    const lowestAmount = currencyCode === "USD"
      ? usdPercentTierAmount(input.newBusinessPrice, lastTier.percent)
      : Number((
          input.newBusinessPrice * (1 - lastTier.percent / 100)
        ).toFixed(precision));
    lowestTierUnitPrice = { amount: lowestAmount, currencyCode };
    if (listing.minimumPrice && listing.minimumPrice.amount > lowestAmount) {
      if (
        input.marketplaceId !== "ATVPDKIKX0DER" ||
        currencyCode !== "USD"
      ) {
        throw new SpApiError(
          "自動降低最低允許售價目前只支援 Amazon 美國站 USD。",
          { status: 422, code: "MINIMUM_PRICE_UNSUPPORTED" },
        );
      }
      if (listing.quantityDiscountPlanPresence === "duplicate") {
        throw new SpApiError(
          "重複數量折扣修復不能同時降低最低允許售價；請先在 Seller Central 核對最低價。",
          { status: 409, code: "MINIMUM_PRICE_REPAIR_CONFLICT" },
        );
      }
      const targetAmount = (Math.round(lowestAmount * 100) - 100) / 100;
      if (targetAmount <= 0) {
        throw new SpApiError(
          "最低階 B2B 單價不足以再下調 US$1；已停止自動修改最低允許售價。",
          { status: 422, code: "MINIMUM_PRICE_UNSUPPORTED" },
        );
      }
      requestedMinimumPrice = { amount: targetAmount, currencyCode };
      minimumPriceChange = "lower";
    }
  }
  if (listing.businessOfferPresence === "absent") {
    if (input.expectedBusinessPrice !== null) {
      throw new SpApiError("目前尚未設定 B2B 價格，舊值核對不一致。", {
        status: 409,
        code: "BUSINESS_PRICE_CHANGED",
      });
    }
  } else {
    if (
      !listing.businessPrice ||
      input.expectedBusinessPrice === null ||
      listing.businessPrice.currencyCode !== currencyCode ||
      !samePrice(
        listing.businessPrice.amount,
        input.expectedBusinessPrice,
        currencyCode,
      )
    ) {
      throw new SpApiError("Amazon Business 價格已改變，請重新讀取後再預檢。", {
        status: 409,
        code: "BUSINESS_PRICE_CHANGED",
      });
    }
    const sameBusinessPrice = samePrice(
      listing.businessPrice.amount,
      input.newBusinessPrice,
      currencyCode,
    );
    const samePlan = requestedPlan !== null &&
      canonicalSha256(requestedPlan) === listing.quantityDiscountPlanHash;
    if (
      listing.quantityDiscountPlanPresence === "duplicate" &&
      (!sameBusinessPrice || !samePlan)
    ) {
      throw new SpApiError(
        "重複數量折扣修復只能重送目前 B2B 價格與完全相同的目前階梯；已停止任何價格或折扣變更。",
        { status: 409, code: "DUPLICATE_REPAIR_CHANGED" },
      );
    }
    if (
      sameBusinessPrice &&
      (!requestedPlan || samePlan) &&
      listing.quantityDiscountPlanPresence !== "duplicate"
    ) {
      throw new SpApiError("新 B2B contribution 與目前價格及數量折扣相同。", {
        status: 400,
        code: "BUSINESS_PRICE_UNCHANGED",
      });
    }
  }
  return {
    standardPrice: listing.standardPrice,
    previousBusinessPrice: listing.businessPrice,
    requestedBusinessPrice: {
      amount: input.newBusinessPrice,
      currencyCode,
    },
    previousMinimumPrice,
    requestedMinimumPrice,
    lowestTierUnitPrice,
    minimumPriceChange,
    previousQuantityDiscountPlan: listing.quantityDiscountPlan,
    previousQuantityDiscountPlanHash: listing.quantityDiscountPlanHash,
    requestedQuantityDiscountPlan: requestedPlan ?? listing.quantityDiscountPlan,
    quantityDiscountPlanChange: requestedPlan ? "replace" : "preserve",
    businessOfferGuardHash: listing.businessOfferGuardHash,
    businessOfferProtectedHash: listing.businessOfferProtectedHash,
    schemaChecksum: listing.businessPricingCapability.schemaChecksum,
  };
}

function patchDescriptor(
  listing: BusinessPricingListingSnapshot,
  verified: VerifiedBusinessPriceChange,
): BusinessPricePatch {
  const base = {
    marketplaceId: listing.marketplaceId,
    sellerSku: listing.sellerSku,
    asin: listing.asin!,
    productType: listing.productType,
    currencyCode: verified.requestedBusinessPrice.currencyCode,
    amount: verified.requestedBusinessPrice.amount,
  };
  if (verified.quantityDiscountPlanChange === "replace") {
    const plan = verified.requestedQuantityDiscountPlan;
    if (!plan || plan.discountType !== "percent") {
      throw new SpApiError(
        "B2B combined proposal 缺少 explicit percent tiers。",
        { status: 409, code: "INVALID_QUANTITY_DISCOUNT" },
      );
    }
    return {
      ...base,
      kind: "combined",
      quantityDiscountPlan: {
        discountType: "percent",
        levels: plan.levels.map((level) => ({ ...level })),
      },
    };
  }
  return {
    ...base,
    kind: "price-only",
    quantityDiscountPlan: verified.previousQuantityDiscountPlan
      ? structuredClone(verified.previousQuantityDiscountPlan)
      : null,
  };
}

type PreparedBusinessPriceMutation = Readonly<{
  listing: BusinessPricingListingSnapshot;
  patch: BusinessPricePatch;
  minimumPricePatch: BusinessMinimumPricePatch | null;
  verified: VerifiedBusinessPriceChange;
  issues: ListingIssue[];
  evidence: BusinessPricePrecommitEvidence;
}>;

type MinimumPriceUpdateResult = Readonly<{
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string;
  productType: string;
  standardPrice: Money;
  previousMinimumPrice: Money;
  requestedMinimumPrice: Money;
  lowestTierUnitPrice: Money;
  previousBusinessPrice: Money | null;
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  previousQuantityDiscountPlanHash: string | null;
  minimumPriceProtectedHash: string;
  minimumPriceCanonicalPatchHash: string;
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
}>;

type MinimumPriceWriteEvidence = Readonly<{
  version: 1;
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string;
  productType: string;
  fulfillment: "FBA";
  standardPrice: Money;
  previousMinimumPrice: Money;
  requestedMinimumPrice: Money;
  lowestTierUnitPrice: Money;
  previousBusinessPrice: Money | null;
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  previousQuantityDiscountPlanHash: string | null;
  minimumPriceProtectedHash: string;
  minimumPriceCanonicalPatchHash: string;
}>;

type MinimumPriceAcceptedDurableResult = MinimumPriceUpdateResult & Readonly<{
  _minimumWriteEvidence: MinimumPriceWriteEvidence;
}>;

type MinimumPriceDurableResult =
  | MinimumPriceAcceptedDurableResult
  | (Omit<MinimumPriceAcceptedDurableResult, "status"> & Readonly<{
      status: "DISPATCHED";
    }>);

const MINIMUM_PRICE_WRITE_EVIDENCE_KEYS = [
  "asin",
  "fulfillment",
  "lowestTierUnitPrice",
  "marketplaceId",
  "minimumPriceCanonicalPatchHash",
  "minimumPriceProtectedHash",
  "previousBusinessPrice",
  "previousMinimumPrice",
  "previousQuantityDiscountPlan",
  "previousQuantityDiscountPlanHash",
  "productType",
  "requestedMinimumPrice",
  "sellerSku",
  "standardPrice",
  "version",
] as const;

const MINIMUM_PRICE_DURABLE_RESULT_KEYS = [
  "_minimumWriteEvidence",
  "acceptedAt",
  "asin",
  "issues",
  "lowestTierUnitPrice",
  "marketplaceId",
  "minimumPriceCanonicalPatchHash",
  "minimumPriceProtectedHash",
  "mode",
  "notice",
  "previousBusinessPrice",
  "previousMinimumPrice",
  "previousQuantityDiscountPlan",
  "previousQuantityDiscountPlanHash",
  "productType",
  "requestId",
  "requestedMinimumPrice",
  "sellerSku",
  "standardPrice",
  "status",
  "submissionId",
] as const;

function precommitEvidence(
  listing: BusinessPricingListingSnapshot,
  patch: BusinessPricePatch,
  minimumPricePatch: BusinessMinimumPricePatch | null,
  issues: readonly ListingIssue[],
): BusinessPricePrecommitEvidence {
  if (!listing.asin || !listing.productType) {
    throw new SpApiError(
      "Amazon B2B 價格缺少可綁定預檢的 ASIN 或商品類型。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
  const schemaChecksum = listing.businessPricingCapability.schemaChecksum;
  if (!schemaChecksum) {
    throw new SpApiError(
      "Amazon B2B 價格缺少可綁定預檢的 PTD checksum。",
      { status: 409, code: "BUSINESS_PRICING_UNSUPPORTED" },
    );
  }
  return {
    asin: listing.asin,
    productType: listing.productType,
    businessOfferGuardHash: listing.businessOfferGuardHash,
    businessOfferProtectedHash: listing.businessOfferProtectedHash,
    minimumPriceProtectedHash: minimumPricePatch?.protectedHash ?? null,
    minimumPriceCanonicalPatchHash:
      minimumPricePatch?.canonicalPatchHash ?? null,
    businessPriceValidation: minimumPricePatch
      ? "final-state-validated"
      : "validated",
    previousQuantityDiscountPlanHash: listing.quantityDiscountPlanHash,
    quantityDiscountPlanPresence: listing.quantityDiscountPlanPresence,
    quantityDiscountPlanChange: patch.kind === "combined"
      ? "replace"
      : "preserve",
    schemaChecksum,
    fbaEvidenceHash: canonicalSha256(
      listing.fulfillmentAvailability
        .filter((entry) => entry.fulfillment === "FBA")
        .map((entry) => entry.channelCode)
        .sort(),
    ),
    canonicalPatchHash: canonicalSha256(businessPricingPatchBody(patch)),
    validationIssuesHash: canonicalSha256(
      issues
        .map((issue) => ({
          ...issue,
          attributeNames: [...issue.attributeNames].sort(),
        }))
        .sort((left, right) =>
          JSON.stringify(canonicalJsonValue(left)).localeCompare(
            JSON.stringify(canonicalJsonValue(right)),
          )
        ),
    ),
  };
}

function assertPrecommitEvidence(
  actual: BusinessPricePrecommitEvidence,
  expected: BusinessPricePrecommitEvidence,
): void {
  if (
    actual.asin !== expected.asin ||
    actual.productType !== expected.productType ||
    actual.businessOfferGuardHash !== expected.businessOfferGuardHash ||
    actual.businessOfferProtectedHash !== expected.businessOfferProtectedHash ||
    actual.minimumPriceProtectedHash !== expected.minimumPriceProtectedHash ||
    actual.minimumPriceCanonicalPatchHash !==
      expected.minimumPriceCanonicalPatchHash ||
    actual.businessPriceValidation !== expected.businessPriceValidation ||
    actual.previousQuantityDiscountPlanHash !==
      expected.previousQuantityDiscountPlanHash ||
    actual.quantityDiscountPlanPresence !==
      expected.quantityDiscountPlanPresence ||
    actual.quantityDiscountPlanChange !==
      expected.quantityDiscountPlanChange ||
    actual.schemaChecksum !== expected.schemaChecksum ||
    actual.fbaEvidenceHash !== expected.fbaEvidenceHash ||
    actual.canonicalPatchHash !== expected.canonicalPatchHash ||
    actual.validationIssuesHash !== expected.validationIssuesHash
  ) {
    throw new SpApiError(
      "Amazon B2B 預檢後的身分、FBA、offer、PTD、patch 或警告證據已改變，請重新預檢。",
      { status: 409, code: "PREVIEW_CHANGED" },
    );
  }
}

function assertCanonicalSnapshot(
  gateway: BusinessPricingGateway,
  listing: BusinessPricingListingSnapshot,
  input: Readonly<{ marketplaceId: MarketplaceId; sellerSku: string }>,
): void {
  const minimumPricePresence = listing.minimumPricePresence ??
    (listing.minimumPrice ? "canonical" : "ambiguous");
  if (
    listing.mode !== gateway.mode(input.marketplaceId) ||
    listing.marketplaceId !== input.marketplaceId ||
    listing.sellerSku !== input.sellerSku ||
    typeof listing.asin !== "string" || !/^[A-Z0-9]{10}$/u.test(listing.asin) ||
    !listing.productType || listing.productType !== listing.productType.trim() ||
    listing.productType.toUpperCase() === "PRODUCT" ||
    !listing.fulfillmentAvailability.some((entry) =>
      entry.fulfillment === "FBA"
    ) ||
    (minimumPricePresence === "absent" && listing.minimumPrice !== null) ||
    (minimumPricePresence === "canonical" && listing.minimumPrice === null)
  ) {
    throw new SpApiError(
      "Amazon B2B 價格回應的模式、站點、SKU、ASIN、商品類型或 FBA 身分不一致，已停止使用。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
}

function gatewayPayload(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function validatedPreviewIssues(
  reply: Awaited<ReturnType<BusinessPricingGateway["validationPreview"]>>,
  listing: BusinessPricingListingSnapshot,
  input: UpdateBusinessPriceInput,
  label: "B2B 價格" | "最低允許售價" | "最終價格狀態",
): ListingIssue[] {
  if (!reply.ok) {
    return throwListingsPayloadError({
      status: reply.status,
      operation: "read",
      apiOperation: "patchListingsItemPreview",
      requestId: reply.requestId,
      retryAfter: reply.retryAfter,
      payload: gatewayPayload(reply.payload),
    });
  }
  const payload = gatewayPayload(reply.payload);
  if (!payload || !listingSubmissionIssuesAreWellFormed(payload.issues)) {
    throw new SpApiError(
      payload
        ? `Amazon ${label}預檢的 issues 證據格式無法辨識，尚未寫入。`
        : `Amazon 回傳了無法辨識的${label}預檢結果。`,
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: reply.requestId,
        operation: "patchListingsItemPreview",
      },
    );
  }
  const issues = normalizeListingIssues(payload.issues);
  if (
    payload.status === "INVALID" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        `Amazon ${label} Validation Preview 未通過。`,
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: reply.requestId,
        issues,
        operation: "patchListingsItemPreview",
      },
    );
  }
  const identifiersMatch = payload.identifiers === undefined ||
    (Array.isArray(payload.identifiers) && (
      payload.identifiers.length === 0 ||
      (
        payload.identifiers.length === 1 &&
        isRecord(payload.identifiers[0]) &&
        payload.identifiers[0].marketplaceId === input.marketplaceId &&
        payload.identifiers[0].asin === listing.asin
      )
    ));
  if (
    payload.status !== "VALID" ||
    payload.sku !== input.sellerSku ||
    typeof payload.submissionId !== "string" ||
    !payload.submissionId.trim() ||
    !identifiersMatch
  ) {
    throw new SpApiError(
      `Amazon ${label}預檢沒有回傳 exact SKU／ASIN／站點的 VALID 證據。`,
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: reply.requestId,
        issues,
        operation: "patchListingsItemPreview",
      },
    );
  }
  return issues;
}

async function prepareBusinessPriceMutation(
  gateway: BusinessPricingGateway,
  input: UpdateBusinessPriceInput,
  expectedEvidence?: BusinessPricePrecommitEvidence,
): Promise<PreparedBusinessPriceMutation> {
  const listing = await gateway.read(input, "mutation");
  assertCanonicalSnapshot(gateway, listing, input);
  const verified = verifyBusinessPriceChange(listing, input);
  const patch = patchDescriptor(listing, verified);
  const minimumPricePatch = verified.minimumPriceChange === "lower"
    ? gateway.mintMinimumPricePatch(
        listing,
        verified.requestedMinimumPrice!.amount,
      )
    : null;
  if (verified.minimumPriceChange === "lower" && !minimumPricePatch) {
    throw new SpApiError(
      "目前 Amazon ALL offer 無法安全地只替換最低允許售價，已停止自動調整。",
      { status: 409, code: "MINIMUM_PRICE_UNSUPPORTED" },
    );
  }
  if (
    patch.kind === "combined" &&
    !gateway.quantityDiscountPlanSupported({
      marketplaceId: patch.marketplaceId,
      productType: patch.productType,
      schemaChecksum: verified.schemaChecksum,
      plan: patch.quantityDiscountPlan,
    })
  ) {
    throw new SpApiError(
      "自訂數量折扣不符合 exact B2B seller-specific PTD 的件數或折扣數值限制。",
      { status: 422, code: "INVALID_QUANTITY_DISCOUNT" },
    );
  }
  let issues: ListingIssue[] = [];
  if (listing.mode === "live") {
    const previewReplies = minimumPricePatch
      ? [
          {
            label: "最低允許售價" as const,
            reply: await gateway.minimumPriceValidationPreview(
              minimumPricePatch,
            ),
          },
          {
            label: "最終價格狀態" as const,
            reply: await gateway.finalStateValidationPreview(
              patch,
              minimumPricePatch,
            ),
          },
        ]
      : [{
          label: "B2B 價格" as const,
          reply: await gateway.validationPreview(patch),
        }];
    for (const preview of previewReplies) {
      issues.push(...validatedPreviewIssues(
        preview.reply,
        listing,
        input,
        preview.label,
      ));
    }
  }
  issues = [...new Map(issues.map((issue) => [
    JSON.stringify(canonicalJsonValue(issue)),
    issue,
  ])).values()];
  const evidence = precommitEvidence(
    listing,
    patch,
    minimumPricePatch,
    issues,
  );
  if (expectedEvidence) assertPrecommitEvidence(evidence, expectedEvidence);
  return { listing, patch, minimumPricePatch, verified, issues, evidence };
}

function minimumPriceWriteEvidence(
  prepared: PreparedBusinessPriceMutation,
): MinimumPriceWriteEvidence {
  const patch = prepared.minimumPricePatch;
  const previousMinimumPrice = prepared.verified.previousMinimumPrice;
  const requestedMinimumPrice = prepared.verified.requestedMinimumPrice;
  const lowestTierUnitPrice = prepared.verified.lowestTierUnitPrice;
  if (!patch || !previousMinimumPrice || !requestedMinimumPrice ||
      !lowestTierUnitPrice) {
    throw new SpApiError(
      "最低允許售價寫入缺少完整預檢證據。",
      { status: 409, code: "PREVIEW_CHANGED" },
    );
  }
  return {
    version: 1,
    marketplaceId: patch.marketplaceId,
    sellerSku: patch.sellerSku,
    asin: patch.asin,
    productType: patch.productType,
    fulfillment: "FBA",
    standardPrice: structuredClone(prepared.verified.standardPrice),
    previousMinimumPrice: structuredClone(previousMinimumPrice),
    requestedMinimumPrice: structuredClone(requestedMinimumPrice),
    lowestTierUnitPrice: structuredClone(lowestTierUnitPrice),
    previousBusinessPrice: structuredClone(
      prepared.verified.previousBusinessPrice,
    ),
    previousQuantityDiscountPlan: structuredClone(
      prepared.verified.previousQuantityDiscountPlan,
    ),
    previousQuantityDiscountPlanHash:
      prepared.verified.previousQuantityDiscountPlanHash,
    minimumPriceProtectedHash: patch.protectedHash,
    minimumPriceCanonicalPatchHash: patch.canonicalPatchHash,
  };
}

function minimumPriceDurableResult(
  prepared: PreparedBusinessPriceMutation,
  input: Readonly<{
    status: "ACCEPTED" | "SIMULATED" | "DISPATCHED";
    acceptedAt: string;
    submissionId: string | null;
    requestId: string | null;
    issues: ListingIssue[];
    notice: string;
  }>,
): MinimumPriceDurableResult {
  const evidence = minimumPriceWriteEvidence(prepared);
  return {
    mode: prepared.listing.mode,
    status: input.status,
    marketplaceId: evidence.marketplaceId,
    sellerSku: evidence.sellerSku,
    asin: evidence.asin,
    productType: evidence.productType,
    standardPrice: structuredClone(evidence.standardPrice),
    previousMinimumPrice: structuredClone(evidence.previousMinimumPrice),
    requestedMinimumPrice: structuredClone(evidence.requestedMinimumPrice),
    lowestTierUnitPrice: structuredClone(evidence.lowestTierUnitPrice),
    previousBusinessPrice: structuredClone(evidence.previousBusinessPrice),
    previousQuantityDiscountPlan: structuredClone(
      evidence.previousQuantityDiscountPlan,
    ),
    previousQuantityDiscountPlanHash:
      evidence.previousQuantityDiscountPlanHash,
    minimumPriceProtectedHash: evidence.minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash: evidence.minimumPriceCanonicalPatchHash,
    acceptedAt: input.acceptedAt,
    submissionId: input.submissionId,
    requestId: input.requestId,
    issues: input.issues,
    notice: input.notice,
    _minimumWriteEvidence: evidence,
  };
}

function dispatchedMinimumPriceResult(
  prepared: PreparedBusinessPriceMutation,
): MinimumPriceDurableResult {
  return minimumPriceDurableResult(prepared, {
    status: "DISPATCHED",
    acceptedAt: new Date().toISOString(),
    submissionId: null,
    requestId: null,
    issues: [],
    notice:
      "Amazon 最低允許售價 PATCH 已進入送出邊界；等待 receipt 與 canonical readback。",
  });
}

function minimumPriceReadbackDecision(
  gateway: BusinessPricingGateway,
  result: MinimumPriceUpdateResult,
  snapshot: BusinessPricingListingSnapshot,
): "verified" | "pending" {
  return result.mode === "live" &&
      snapshot.mode === "live" &&
      result.marketplaceId === snapshot.marketplaceId &&
      result.sellerSku === snapshot.sellerSku &&
      result.asin === snapshot.asin &&
      result.productType === snapshot.productType &&
      snapshot.minimumPricePresence === "canonical" &&
      sameMoney(result.standardPrice, snapshot.standardPrice) &&
      sameMoney(result.requestedMinimumPrice, snapshot.minimumPrice) &&
      sameOptionalMoney(result.previousBusinessPrice, snapshot.businessPrice) &&
      sameQuantityDiscountPlan(
        result.previousQuantityDiscountPlan,
        snapshot.quantityDiscountPlan,
      ) &&
      result.minimumPriceProtectedHash ===
        gateway.minimumPriceProtectedHash(snapshot) &&
      !snapshot.issues.some((issue) =>
        isPricingListingError(issue, snapshot.marketplaceId)
      )
    ? "verified"
    : "pending";
}

type BusinessPriceWriteEvidence = Readonly<{
  version: 1;
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string;
  productType: string;
  fulfillment: "FBA";
  standardPrice: Money;
  previousBusinessPrice: Money | null;
  requestedBusinessPrice: Money;
  previousMinimumPrice: Money | null;
  requestedMinimumPrice: Money | null;
  lowestTierUnitPrice: Money | null;
  minimumPriceChange: "preserve" | "lower";
  minimumPriceProtectedHash: string | null;
  minimumPriceCanonicalPatchHash: string | null;
  businessPriceValidation: "validated";
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  previousQuantityDiscountPlanHash: string | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanChange: "preserve" | "replace";
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  schemaChecksum: string;
}>;

const BUSINESS_PRICE_WRITE_EVIDENCE_KEYS = [
  "asin",
  "businessOfferGuardHash",
  "businessOfferProtectedHash",
  "fulfillment",
  "marketplaceId",
  "businessPriceValidation",
  "lowestTierUnitPrice",
  "minimumPriceCanonicalPatchHash",
  "minimumPriceChange",
  "minimumPriceProtectedHash",
  "previousBusinessPrice",
  "previousMinimumPrice",
  "previousQuantityDiscountPlan",
  "previousQuantityDiscountPlanHash",
  "productType",
  "quantityDiscountPlanChange",
  "requestedBusinessPrice",
  "requestedMinimumPrice",
  "requestedQuantityDiscountPlan",
  "schemaChecksum",
  "sellerSku",
  "standardPrice",
  "version",
] as const;

const BUSINESS_PRICE_DURABLE_RESULT_KEYS = [
  "_writeEvidence",
  "acceptedAt",
  "asin",
  "businessOfferGuardHash",
  "businessOfferProtectedHash",
  "issues",
  "marketplaceId",
  "businessPriceValidation",
  "lowestTierUnitPrice",
  "minimumPriceCanonicalPatchHash",
  "minimumPriceChange",
  "minimumPriceProtectedHash",
  "mode",
  "notice",
  "previousBusinessPrice",
  "previousMinimumPrice",
  "previousQuantityDiscountPlan",
  "previousQuantityDiscountPlanHash",
  "productType",
  "quantityDiscountPlanChange",
  "requestId",
  "requestedBusinessPrice",
  "requestedMinimumPrice",
  "requestedQuantityDiscountPlan",
  "schemaChecksum",
  "sellerSku",
  "standardPrice",
  "status",
  "submissionId",
] as const;

type BusinessPriceAcceptedDurableResult = BusinessPriceUpdateResult & Readonly<{
  _writeEvidence: BusinessPriceWriteEvidence;
}>;

type BusinessPriceDurableResult =
  | BusinessPriceAcceptedDurableResult
  | (Omit<BusinessPriceAcceptedDurableResult, "status"> & Readonly<{
      status: "DISPATCHED";
    }>);

function writeEvidence(
  prepared: PreparedBusinessPriceMutation,
): BusinessPriceWriteEvidence {
  return {
    version: 1,
    marketplaceId: prepared.patch.marketplaceId,
    sellerSku: prepared.patch.sellerSku,
    asin: prepared.patch.asin,
    productType: prepared.patch.productType,
    fulfillment: "FBA",
    standardPrice: structuredClone(prepared.verified.standardPrice),
    previousBusinessPrice: structuredClone(
      prepared.verified.previousBusinessPrice,
    ),
    requestedBusinessPrice: structuredClone(
      prepared.verified.requestedBusinessPrice,
    ),
    previousMinimumPrice: structuredClone(
      prepared.verified.previousMinimumPrice,
    ),
    requestedMinimumPrice: structuredClone(
      prepared.verified.requestedMinimumPrice,
    ),
    lowestTierUnitPrice: structuredClone(
      prepared.verified.lowestTierUnitPrice,
    ),
    minimumPriceChange: prepared.verified.minimumPriceChange,
    minimumPriceProtectedHash:
      prepared.evidence.minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash:
      prepared.evidence.minimumPriceCanonicalPatchHash,
    businessPriceValidation: "validated",
    previousQuantityDiscountPlan: structuredClone(
      prepared.verified.previousQuantityDiscountPlan,
    ),
    previousQuantityDiscountPlanHash:
      prepared.verified.previousQuantityDiscountPlanHash,
    requestedQuantityDiscountPlan: structuredClone(
      prepared.verified.requestedQuantityDiscountPlan,
    ),
    quantityDiscountPlanChange: prepared.verified.quantityDiscountPlanChange,
    businessOfferGuardHash: prepared.verified.businessOfferGuardHash,
    businessOfferProtectedHash: prepared.verified.businessOfferProtectedHash,
    schemaChecksum: prepared.verified.schemaChecksum,
  };
}

function durableResult(
  prepared: PreparedBusinessPriceMutation,
  input: Readonly<{
    status: "ACCEPTED" | "SIMULATED" | "DISPATCHED";
    acceptedAt: string;
    submissionId: string | null;
    requestId: string | null;
    issues: ListingIssue[];
    notice: string;
  }>,
): BusinessPriceDurableResult {
  return {
    mode: prepared.listing.mode,
    status: input.status,
    marketplaceId: prepared.patch.marketplaceId,
    sellerSku: prepared.patch.sellerSku,
    asin: prepared.patch.asin,
    productType: prepared.patch.productType,
    ...prepared.verified,
    minimumPriceProtectedHash:
      prepared.evidence.minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash:
      prepared.evidence.minimumPriceCanonicalPatchHash,
    businessPriceValidation: "validated",
    acceptedAt: input.acceptedAt,
    submissionId: input.submissionId,
    requestId: input.requestId,
    issues: input.issues,
    notice: input.notice,
    _writeEvidence: writeEvidence(prepared),
  };
}

function dispatchedResult(
  prepared: PreparedBusinessPriceMutation,
): BusinessPriceDurableResult {
  return durableResult(prepared, {
    status: "DISPATCHED",
    acceptedAt: new Date().toISOString(),
    submissionId: null,
    requestId: null,
    issues: [],
    notice:
      "Amazon 正式 B2B PATCH 已進入送出邊界；等待 receipt 與 canonical readback。",
  });
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function validMoney(value: unknown, currencyCode: string): value is Money {
  return isRecord(value) &&
    hasExactKeys(value, ["amount", "currencyCode"]) &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    value.amount > 0 &&
    value.currencyCode === currencyCode;
}

function validQuantityDiscountPlan(
  value: unknown,
): value is BusinessQuantityDiscountPlan | null {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["discountType", "levels"]) ||
    (value.discountType !== "percent" && value.discountType !== "fixed") ||
    !Array.isArray(value.levels) ||
    value.levels.length < 1 ||
    value.levels.length > 5
  ) return false;
  let previousLowerBound = 0;
  let previousValue: number | null = null;
  for (const level of value.levels) {
    if (
      !isRecord(level) ||
      !hasExactKeys(level, ["lowerBound", "value"]) ||
      !Number.isSafeInteger(level.lowerBound) ||
      Number(level.lowerBound) <= previousLowerBound ||
      typeof level.value !== "number" ||
      !Number.isFinite(level.value) ||
      level.value <= 0 ||
      (value.discountType === "percent" && level.value >= 100) ||
      (previousValue !== null &&
        (value.discountType === "percent"
          ? level.value <= previousValue
          : level.value >= previousValue))
    ) return false;
    previousLowerBound = Number(level.lowerBound);
    previousValue = level.value;
  }
  return true;
}

function sameMoney(
  left: Money | null | undefined,
  right: Money | null | undefined,
): boolean {
  return left != null && right != null &&
    left.currencyCode === right.currencyCode &&
    left.amount === right.amount;
}

function sameOptionalMoney(
  left: Money | null | undefined,
  right: Money | null | undefined,
): boolean {
  return left == null
    ? right == null
    : right != null && sameMoney(left, right);
}

function sameQuantityDiscountPlan(
  left: BusinessQuantityDiscountPlan | null,
  right: BusinessQuantityDiscountPlan | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.discountType === right.discountType &&
    left.levels.length === right.levels.length &&
    left.levels.every((level, index) => {
      const actual = right.levels[index];
      return actual?.lowerBound === level.lowerBound &&
        actual.value === level.value;
    });
}

function exactMoneyMatches(
  value: unknown,
  expected: Money | null,
): boolean {
  if (value === null || expected === null) return value === expected;
  return validMoney(value, expected.currencyCode) &&
    value.amount === expected.amount;
}

function exactQuantityDiscountPlanMatches(
  value: unknown,
  expected: BusinessQuantityDiscountPlan | null,
): boolean {
  return validQuantityDiscountPlan(value) &&
    sameQuantityDiscountPlan(value, expected);
}

export function businessPriceReadbackDecision(
  result: BusinessPriceUpdateResult,
  snapshot: BusinessPricingListingSnapshot,
): "verified" | "pending" {
  if (
    result.quantityDiscountPlanChange !== "preserve" &&
    result.quantityDiscountPlanChange !== "replace"
  ) return "pending";
  const common = result.mode === "live" &&
    snapshot.mode === "live" &&
    result.marketplaceId === snapshot.marketplaceId &&
    result.sellerSku === snapshot.sellerSku &&
    result.asin === snapshot.asin &&
    result.productType === snapshot.productType &&
    snapshot.businessOfferPresence === "present" &&
    !snapshot.issues.some((issue) =>
      isPricingListingError(issue, snapshot.marketplaceId)
    ) &&
    sameMoney(result.standardPrice, snapshot.standardPrice) &&
    sameOptionalMoney(result.requestedMinimumPrice, snapshot.minimumPrice) &&
    result.businessPriceValidation === "validated" &&
    sameMoney(result.requestedBusinessPrice, snapshot.businessPrice);
  if (!common) return "pending";
  if (result.quantityDiscountPlanChange === "replace") {
    return snapshot.quantityDiscountPlanPresence === "canonical" &&
        result.businessOfferProtectedHash ===
          snapshot.businessOfferProtectedHash &&
        sameQuantityDiscountPlan(
          result.requestedQuantityDiscountPlan,
          snapshot.quantityDiscountPlan,
        )
      ? "verified"
      : "pending";
  }
  return result.businessOfferGuardHash === snapshot.businessOfferGuardHash
    ? "verified"
    : "pending";
}

function exactWriteEvidence(
  value: unknown,
): value is BusinessPriceWriteEvidence {
  if (!isRecord(value) ||
      !hasExactKeys(value, BUSINESS_PRICE_WRITE_EVIDENCE_KEYS)) return false;
  const marketplace = typeof value.marketplaceId === "string"
    ? marketplaceById(value.marketplaceId)
    : null;
  if (!marketplace) return false;
  const previousPlan = value.previousQuantityDiscountPlan;
  const requestedPlan = value.requestedQuantityDiscountPlan;
  return value.version === 1 &&
    typeof value.sellerSku === "string" &&
    parseSellerSku(value.sellerSku) === value.sellerSku &&
    typeof value.asin === "string" &&
    /^[A-Z0-9]{10}$/u.test(value.asin) &&
    typeof value.productType === "string" &&
    value.productType.length > 0 &&
    value.productType === value.productType.trim() &&
    value.productType.toUpperCase() !== "PRODUCT" &&
    value.fulfillment === "FBA" &&
    validMoney(value.standardPrice, marketplace.currency) &&
    (value.previousBusinessPrice === null ||
      validMoney(value.previousBusinessPrice, marketplace.currency)) &&
    validMoney(value.requestedBusinessPrice, marketplace.currency) &&
    (value.previousMinimumPrice === null ||
      validMoney(value.previousMinimumPrice, marketplace.currency)) &&
    (value.requestedMinimumPrice === null ||
      validMoney(value.requestedMinimumPrice, marketplace.currency)) &&
    (value.lowestTierUnitPrice === null ||
      validMoney(value.lowestTierUnitPrice, marketplace.currency)) &&
    (value.minimumPriceChange === "preserve" ||
      value.minimumPriceChange === "lower") &&
    (value.minimumPriceChange !== "preserve" ||
      (value.previousMinimumPrice === null
        ? value.requestedMinimumPrice === null
        : exactMoneyMatches(
            value.requestedMinimumPrice,
            value.previousMinimumPrice as Money,
          ))) &&
    (value.minimumPriceChange !== "lower" ||
      (validMoney(value.previousMinimumPrice, marketplace.currency) &&
        validMoney(value.requestedMinimumPrice, marketplace.currency) &&
        value.requestedMinimumPrice.amount < value.previousMinimumPrice.amount &&
        validMoney(value.lowestTierUnitPrice, marketplace.currency) &&
        Math.round(value.requestedMinimumPrice.amount * 100) ===
          Math.round(value.lowestTierUnitPrice.amount * 100) - 100 &&
        validSha256(value.minimumPriceProtectedHash) &&
        validSha256(value.minimumPriceCanonicalPatchHash))) &&
    (value.minimumPriceChange !== "preserve" ||
      (value.minimumPriceProtectedHash === null &&
        value.minimumPriceCanonicalPatchHash === null)) &&
    value.businessPriceValidation === "validated" &&
    validQuantityDiscountPlan(previousPlan) &&
    validQuantityDiscountPlan(requestedPlan) &&
    (value.previousQuantityDiscountPlanHash === null ||
      validSha256(value.previousQuantityDiscountPlanHash)) &&
    (previousPlan === null) ===
      (value.previousQuantityDiscountPlanHash === null) &&
    (value.quantityDiscountPlanChange === "preserve" ||
      value.quantityDiscountPlanChange === "replace") &&
    (value.quantityDiscountPlanChange !== "preserve" ||
      JSON.stringify(previousPlan) === JSON.stringify(requestedPlan)) &&
    (value.quantityDiscountPlanChange !== "replace" ||
      (isRecord(requestedPlan) &&
        requestedPlan.discountType === "percent")) &&
    validSha256(value.businessOfferGuardHash) &&
    validSha256(value.businessOfferProtectedHash) &&
    typeof value.schemaChecksum === "string" &&
    value.schemaChecksum.length > 0 &&
    value.schemaChecksum === value.schemaChecksum.trim();
}

function safeOptionalIdentifier(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= 256 &&
      value === value.trim() &&
      !/[\u0000-\u001f\u007f]/u.test(value));
}

function safeNotice(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2_000 &&
    value === value.trim() &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function durableEnvelopeMatchesWriteEvidence(
  response: Record<string, unknown>,
  evidence: BusinessPriceWriteEvidence,
): boolean {
  return response.marketplaceId === evidence.marketplaceId &&
    response.sellerSku === evidence.sellerSku &&
    response.asin === evidence.asin &&
    response.productType === evidence.productType &&
    exactMoneyMatches(response.standardPrice, evidence.standardPrice) &&
    exactMoneyMatches(
      response.previousBusinessPrice,
      evidence.previousBusinessPrice,
    ) &&
    exactMoneyMatches(
      response.requestedBusinessPrice,
      evidence.requestedBusinessPrice,
    ) &&
    exactMoneyMatches(
      response.previousMinimumPrice,
      evidence.previousMinimumPrice,
    ) &&
    exactMoneyMatches(
      response.requestedMinimumPrice,
      evidence.requestedMinimumPrice,
    ) &&
    exactMoneyMatches(
      response.lowestTierUnitPrice,
      evidence.lowestTierUnitPrice,
    ) &&
    response.minimumPriceChange === evidence.minimumPriceChange &&
    response.minimumPriceProtectedHash ===
      evidence.minimumPriceProtectedHash &&
    response.minimumPriceCanonicalPatchHash ===
      evidence.minimumPriceCanonicalPatchHash &&
    response.businessPriceValidation === evidence.businessPriceValidation &&
    exactQuantityDiscountPlanMatches(
      response.previousQuantityDiscountPlan,
      evidence.previousQuantityDiscountPlan,
    ) &&
    response.previousQuantityDiscountPlanHash ===
      evidence.previousQuantityDiscountPlanHash &&
    exactQuantityDiscountPlanMatches(
      response.requestedQuantityDiscountPlan,
      evidence.requestedQuantityDiscountPlan,
    ) &&
    response.quantityDiscountPlanChange ===
      evidence.quantityDiscountPlanChange &&
    response.businessOfferGuardHash === evidence.businessOfferGuardHash &&
    response.businessOfferProtectedHash ===
      evidence.businessOfferProtectedHash &&
    response.schemaChecksum === evidence.schemaChecksum;
}

function validDurableStatusMetadata(
  response: Record<string, unknown>,
  allowReconciledDispatch = false,
): boolean {
  if (response.status === "DISPATCHED") {
    return response.submissionId === null &&
      response.requestId === null &&
      Array.isArray(response.issues) &&
      response.issues.length === 0;
  }
  if (response.status !== "ACCEPTED") return false;
  if (
    allowReconciledDispatch &&
    response.submissionId === null &&
    response.requestId === null &&
    Array.isArray(response.issues) &&
    response.issues.length === 0
  ) return true;
  return typeof response.submissionId === "string" &&
    safeOptionalIdentifier(response.submissionId) &&
    safeOptionalIdentifier(response.requestId) &&
    Array.isArray(response.issues) &&
    listingSubmissionIssuesAreWellFormed(response.issues);
}

function exactMinimumPriceWriteEvidence(
  value: unknown,
): value is MinimumPriceWriteEvidence {
  if (!isRecord(value) ||
      !hasExactKeys(value, MINIMUM_PRICE_WRITE_EVIDENCE_KEYS)) return false;
  const marketplace = typeof value.marketplaceId === "string"
    ? marketplaceById(value.marketplaceId)
    : null;
  if (!marketplace) return false;
  const previousPlan = value.previousQuantityDiscountPlan;
  return value.version === 1 &&
    typeof value.sellerSku === "string" &&
    parseSellerSku(value.sellerSku) === value.sellerSku &&
    typeof value.asin === "string" &&
    /^[A-Z0-9]{10}$/u.test(value.asin) &&
    typeof value.productType === "string" &&
    value.productType.length > 0 &&
    value.productType === value.productType.trim() &&
    value.productType.toUpperCase() !== "PRODUCT" &&
    value.fulfillment === "FBA" &&
    validMoney(value.standardPrice, marketplace.currency) &&
    validMoney(value.previousMinimumPrice, marketplace.currency) &&
    validMoney(value.requestedMinimumPrice, marketplace.currency) &&
    validMoney(value.lowestTierUnitPrice, marketplace.currency) &&
    value.previousMinimumPrice.amount > value.requestedMinimumPrice.amount &&
    Math.round(value.requestedMinimumPrice.amount * 100) ===
      Math.round(value.lowestTierUnitPrice.amount * 100) - 100 &&
    (value.previousBusinessPrice === null ||
      validMoney(value.previousBusinessPrice, marketplace.currency)) &&
    validQuantityDiscountPlan(previousPlan) &&
    (value.previousQuantityDiscountPlanHash === null ||
      validSha256(value.previousQuantityDiscountPlanHash)) &&
    (previousPlan === null) ===
      (value.previousQuantityDiscountPlanHash === null) &&
    validSha256(value.minimumPriceProtectedHash) &&
    validSha256(value.minimumPriceCanonicalPatchHash);
}

function durableMinimumEnvelopeMatchesEvidence(
  response: Record<string, unknown>,
  evidence: MinimumPriceWriteEvidence,
): boolean {
  return response.marketplaceId === evidence.marketplaceId &&
    response.sellerSku === evidence.sellerSku &&
    response.asin === evidence.asin &&
    response.productType === evidence.productType &&
    exactMoneyMatches(response.standardPrice, evidence.standardPrice) &&
    exactMoneyMatches(
      response.previousMinimumPrice,
      evidence.previousMinimumPrice,
    ) &&
    exactMoneyMatches(
      response.requestedMinimumPrice,
      evidence.requestedMinimumPrice,
    ) &&
    exactMoneyMatches(
      response.lowestTierUnitPrice,
      evidence.lowestTierUnitPrice,
    ) &&
    exactMoneyMatches(
      response.previousBusinessPrice,
      evidence.previousBusinessPrice,
    ) &&
    exactQuantityDiscountPlanMatches(
      response.previousQuantityDiscountPlan,
      evidence.previousQuantityDiscountPlan,
    ) &&
    response.previousQuantityDiscountPlanHash ===
      evidence.previousQuantityDiscountPlanHash &&
    response.minimumPriceProtectedHash ===
      evidence.minimumPriceProtectedHash &&
    response.minimumPriceCanonicalPatchHash ===
      evidence.minimumPriceCanonicalPatchHash;
}

function canonicalMatchesMinimumPriceEvidence(
  evidence: MinimumPriceWriteEvidence,
  snapshot: BusinessPricingListingSnapshot,
): boolean {
  // The minimum-price PATCH targets the ALL contribution only. Amazon may
  // normalize or independently update the B2B contribution while that PATCH
  // is becoming visible. Those unrelated B2B fields are rebound by the next
  // fresh B2B preview, so they must not keep an exact, canonical minimum-price
  // target stuck in PROCESSING. The immutable identity, FBA evidence and
  // requested minimum remain mandatory; the next preview rebinds the current
  // standard price and every B2B field before any second write is authorized.
  return snapshot.mode === "live" &&
    snapshot.marketplaceId === evidence.marketplaceId &&
    snapshot.sellerSku === evidence.sellerSku &&
    snapshot.asin === evidence.asin &&
    snapshot.productType === evidence.productType &&
    snapshot.fulfillmentAvailability.some((entry) =>
      entry.fulfillment === evidence.fulfillment
    ) &&
    snapshot.minimumPricePresence === "canonical" &&
    sameMoney(evidence.requestedMinimumPrice, snapshot.minimumPrice) &&
    !snapshot.issues.some((issue) =>
      isPricingListingError(issue, snapshot.marketplaceId)
    );
}

export function reconcileMinimumPriceWrite(
  response: unknown,
  snapshot: BusinessPricingListingSnapshot,
  now: () => Date = () => new Date(),
): unknown | null {
  if (!isRecord(response) ||
      !hasExactKeys(response, MINIMUM_PRICE_DURABLE_RESULT_KEYS) ||
      (response.status !== "DISPATCHED" && response.status !== "ACCEPTED") ||
      response.mode !== "live" ||
      !exactMinimumPriceWriteEvidence(response._minimumWriteEvidence) ||
      !durableMinimumEnvelopeMatchesEvidence(
        response,
        response._minimumWriteEvidence,
      ) ||
      !validIsoTimestamp(response.acceptedAt) ||
      !safeNotice(response.notice) ||
      !validDurableStatusMetadata(response) ||
      !canonicalMatchesMinimumPriceEvidence(
        response._minimumWriteEvidence,
        snapshot,
      )) {
    return null;
  }
  const evidence = response._minimumWriteEvidence;
  return {
    mode: "live",
    status: "ACCEPTED",
    marketplaceId: evidence.marketplaceId,
    sellerSku: evidence.sellerSku,
    asin: evidence.asin,
    productType: evidence.productType,
    standardPrice: structuredClone(evidence.standardPrice),
    previousMinimumPrice: structuredClone(evidence.previousMinimumPrice),
    requestedMinimumPrice: structuredClone(evidence.requestedMinimumPrice),
    lowestTierUnitPrice: structuredClone(evidence.lowestTierUnitPrice),
    previousBusinessPrice: structuredClone(evidence.previousBusinessPrice),
    previousQuantityDiscountPlan: structuredClone(
      evidence.previousQuantityDiscountPlan,
    ),
    previousQuantityDiscountPlanHash:
      evidence.previousQuantityDiscountPlanHash,
    minimumPriceProtectedHash: evidence.minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash:
      evidence.minimumPriceCanonicalPatchHash,
    acceptedAt: response.acceptedAt,
    submissionId: response.submissionId,
    requestId: response.requestId,
    issues: normalizeListingIssues(response.issues),
    notice:
      "Amazon 最低允許售價已由主程序唯讀回查確認；未重新送出 PATCH。",
    _minimumWriteEvidence: structuredClone(evidence),
    writeLifecycle: {
      state: "verified",
      verified: true,
      authoritative: true,
      acceptedAt: response.acceptedAt,
      verifiedAt: now().toISOString(),
      attempts: 0,
    },
  };
}

function canonicalMatchesWriteEvidence(
  evidence: BusinessPriceWriteEvidence,
  snapshot: BusinessPricingListingSnapshot,
): boolean {
  if (
    snapshot.mode !== "live" ||
    snapshot.marketplaceId !== evidence.marketplaceId ||
    snapshot.sellerSku !== evidence.sellerSku ||
    snapshot.asin !== evidence.asin ||
    snapshot.productType !== evidence.productType ||
    !snapshot.fulfillmentAvailability.some((entry) =>
      entry.fulfillment === evidence.fulfillment
    )
  ) return false;
  return businessPriceReadbackDecision({
    mode: "live",
    status: "ACCEPTED",
    marketplaceId: evidence.marketplaceId,
    sellerSku: evidence.sellerSku,
    asin: evidence.asin,
    productType: evidence.productType,
    standardPrice: structuredClone(evidence.standardPrice),
    previousBusinessPrice: structuredClone(evidence.previousBusinessPrice),
    requestedBusinessPrice: structuredClone(evidence.requestedBusinessPrice),
    previousMinimumPrice: structuredClone(evidence.previousMinimumPrice),
    requestedMinimumPrice: structuredClone(evidence.requestedMinimumPrice),
    lowestTierUnitPrice: structuredClone(evidence.lowestTierUnitPrice),
    minimumPriceChange: evidence.minimumPriceChange,
    minimumPriceProtectedHash: evidence.minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash:
      evidence.minimumPriceCanonicalPatchHash,
    businessPriceValidation: evidence.businessPriceValidation,
    previousQuantityDiscountPlan: structuredClone(
      evidence.previousQuantityDiscountPlan,
    ),
    previousQuantityDiscountPlanHash:
      evidence.previousQuantityDiscountPlanHash,
    requestedQuantityDiscountPlan: structuredClone(
      evidence.requestedQuantityDiscountPlan,
    ),
    quantityDiscountPlanChange: evidence.quantityDiscountPlanChange,
    businessOfferGuardHash: evidence.businessOfferGuardHash,
    businessOfferProtectedHash: evidence.businessOfferProtectedHash,
    schemaChecksum: evidence.schemaChecksum,
    acceptedAt: new Date(0).toISOString(),
    submissionId: null,
    requestId: null,
    issues: [],
    notice: "internal canonical comparison",
  }, snapshot) === "verified";
}

export function reconcileBusinessPriceWrite(
  response: unknown,
  snapshot: BusinessPricingListingSnapshot,
  now: () => Date = () => new Date(),
): unknown | null {
  if (!isRecord(response) ||
      !hasExactKeys(response, BUSINESS_PRICE_DURABLE_RESULT_KEYS) ||
      (response.status !== "DISPATCHED" && response.status !== "ACCEPTED") ||
      response.mode !== "live" ||
      !exactWriteEvidence(response._writeEvidence) ||
      !durableEnvelopeMatchesWriteEvidence(
        response,
        response._writeEvidence,
      ) ||
      !validIsoTimestamp(response.acceptedAt) ||
      !safeNotice(response.notice) ||
      !validDurableStatusMetadata(response) ||
      !canonicalMatchesWriteEvidence(response._writeEvidence, snapshot)) {
    return null;
  }
  const evidence = response._writeEvidence;
  const verifiedAt = now().toISOString();
  return {
    mode: "live",
    status: "ACCEPTED",
    marketplaceId: evidence.marketplaceId,
    sellerSku: evidence.sellerSku,
    asin: evidence.asin,
    productType: evidence.productType,
    standardPrice: structuredClone(evidence.standardPrice),
    previousBusinessPrice: structuredClone(evidence.previousBusinessPrice),
    requestedBusinessPrice: structuredClone(evidence.requestedBusinessPrice),
    previousMinimumPrice: structuredClone(evidence.previousMinimumPrice),
    requestedMinimumPrice: structuredClone(evidence.requestedMinimumPrice),
    lowestTierUnitPrice: structuredClone(evidence.lowestTierUnitPrice),
    minimumPriceChange: evidence.minimumPriceChange,
    minimumPriceProtectedHash: evidence.minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash:
      evidence.minimumPriceCanonicalPatchHash,
    businessPriceValidation: evidence.businessPriceValidation,
    previousQuantityDiscountPlan: structuredClone(
      evidence.previousQuantityDiscountPlan,
    ),
    previousQuantityDiscountPlanHash:
      evidence.previousQuantityDiscountPlanHash,
    requestedQuantityDiscountPlan: structuredClone(
      evidence.requestedQuantityDiscountPlan,
    ),
    quantityDiscountPlanChange: evidence.quantityDiscountPlanChange,
    businessOfferGuardHash: evidence.businessOfferGuardHash,
    businessOfferProtectedHash: evidence.businessOfferProtectedHash,
    schemaChecksum: evidence.schemaChecksum,
    acceptedAt: response.acceptedAt,
    submissionId: response.submissionId,
    requestId: response.requestId,
    issues: normalizeListingIssues(response.issues),
    notice:
      "Amazon Business 價格已由主程序唯讀回查確認；未重新送出 PATCH。",
    _writeEvidence: structuredClone(evidence),
    writeLifecycle: {
      state: "verified",
      verified: true,
      authoritative: true,
      acceptedAt: response.acceptedAt,
      verifiedAt,
      attempts: 0,
    },
  };
}

function publicBusinessPriceResult<T>(value: T): T {
  if (!isRecord(value)) return value;
  const {
    _writeEvidence: _businessPriceInternal,
    _minimumWriteEvidence: _minimumPriceInternal,
    ...publicValue
  } = value;
  return publicValue as T;
}

function processingBusinessPriceStatus(
  result: BusinessPriceUpdateResult,
): BusinessPriceWriteStatus {
  return {
    mode: "live",
    status: "PROCESSING",
    stage: "business_price",
    marketplaceId: result.marketplaceId,
    sellerSku: result.sellerSku,
    asin: result.asin,
    productType: result.productType,
    acceptedAt: result.acceptedAt,
    verifiedAt: null,
    requestId: result.requestId,
    submissionId: result.submissionId,
    verified: false,
    authoritative: false,
    canResend: false,
    businessPriceSubmitted: true,
    previousBusinessPrice: structuredClone(result.previousBusinessPrice),
    requestedBusinessPrice: structuredClone(result.requestedBusinessPrice),
    previousMinimumPrice: structuredClone(result.previousMinimumPrice),
    requestedMinimumPrice: structuredClone(result.requestedMinimumPrice),
    lowestTierUnitPrice: structuredClone(result.lowestTierUnitPrice),
    previousQuantityDiscountPlan: structuredClone(
      result.previousQuantityDiscountPlan,
    ),
    requestedQuantityDiscountPlan: structuredClone(
      result.requestedQuantityDiscountPlan,
    ),
    quantityDiscountPlanChange: result.quantityDiscountPlanChange,
    notice:
      "Amazon 已接受 B2B 價格更新，正在同步。主程序會自動只用 GET 受控回查；尚未相符時也絕不自動重送 PATCH。",
  };
}

function processingMinimumPriceStatus(
  result: MinimumPriceUpdateResult,
  expected?: BusinessPriceValidationResult,
): BusinessPriceWriteStatus {
  return {
    mode: "live",
    status: "PROCESSING",
    stage: "minimum_price",
    marketplaceId: result.marketplaceId,
    sellerSku: result.sellerSku,
    asin: result.asin,
    productType: result.productType,
    acceptedAt: result.acceptedAt,
    verifiedAt: null,
    requestId: result.requestId,
    submissionId: result.submissionId,
    verified: false,
    authoritative: false,
    canResend: false,
    businessPriceSubmitted: false,
    previousBusinessPrice: structuredClone(result.previousBusinessPrice),
    requestedBusinessPrice: expected
      ? structuredClone(expected.requestedBusinessPrice)
      : null,
    previousMinimumPrice: structuredClone(result.previousMinimumPrice),
    requestedMinimumPrice: structuredClone(result.requestedMinimumPrice),
    lowestTierUnitPrice: structuredClone(result.lowestTierUnitPrice),
    previousQuantityDiscountPlan: structuredClone(
      result.previousQuantityDiscountPlan,
    ),
    requestedQuantityDiscountPlan: expected
      ? structuredClone(expected.requestedQuantityDiscountPlan)
      : null,
    quantityDiscountPlanChange:
      expected?.quantityDiscountPlanChange ?? null,
    notice:
      "Amazon 已接受最低價更新，主程序會自動只用 GET 受控回查；B2B 價格與階梯尚未送出，最低價確認後仍須重新預檢並獨立授權，系統絕不背景續送或重送 PATCH。",
  };
}

function exactVerifiedLifecycle(
  value: unknown,
  acceptedAt: string,
): string | null {
  if (!isRecord(value) ||
      value.state !== "verified" ||
      value.verified !== true ||
      value.authoritative !== true ||
      value.acceptedAt !== acceptedAt ||
      !validIsoTimestamp(value.verifiedAt) ||
      !Number.isSafeInteger(value.attempts) ||
      Number(value.attempts) < 0 ||
      Number(value.attempts) > 100) {
    return null;
  }
  return value.verifiedAt;
}

function businessPriceWriteStatusFromInspection(
  inspection: MainWriteGateInspection,
): BusinessPriceWriteStatus | null {
  if (inspection.operationType !== "business_price" ||
      !isRecord(inspection.response)) return null;
  const response = inspection.response;
  const { writeLifecycle, ...durableResponse } = response;
  const verifiedAt = inspection.state === "completed" &&
      typeof response.acceptedAt === "string"
    ? exactVerifiedLifecycle(writeLifecycle, response.acceptedAt)
    : null;
  if (!hasExactKeys(durableResponse, BUSINESS_PRICE_DURABLE_RESULT_KEYS) ||
      response.status !== "ACCEPTED" ||
      response.mode !== "live" ||
      !exactWriteEvidence(response._writeEvidence) ||
      !durableEnvelopeMatchesWriteEvidence(
        durableResponse,
        response._writeEvidence,
      ) ||
      !validIsoTimestamp(response.acceptedAt) ||
      !safeNotice(response.notice) ||
      !validDurableStatusMetadata(response, verifiedAt !== null)) {
    return null;
  }
  const processing = processingBusinessPriceStatus(
    response as unknown as BusinessPriceUpdateResult,
  );
  if (inspection.state !== "completed") return processing;
  if (!verifiedAt) return null;
  return {
    ...processing,
    status: "VERIFIED",
    verifiedAt,
    verified: true,
    authoritative: true,
    notice:
      "Amazon Business 價格已由 Notebook Key 唯讀回查確認；沒有重新送出 PATCH。",
  };
}

function minimumPriceWriteStatusFromInspection(
  inspection: MainWriteGateInspection,
): BusinessPriceWriteStatus | null {
  if (inspection.operationType !== "price" ||
      !isRecord(inspection.response)) return null;
  const response = inspection.response;
  const { writeLifecycle, ...durableResponse } = response;
  const verifiedAt = inspection.state === "completed" &&
      typeof response.acceptedAt === "string"
    ? exactVerifiedLifecycle(writeLifecycle, response.acceptedAt)
    : null;
  if (!hasExactKeys(durableResponse, MINIMUM_PRICE_DURABLE_RESULT_KEYS) ||
      response.status !== "ACCEPTED" ||
      response.mode !== "live" ||
      !exactMinimumPriceWriteEvidence(response._minimumWriteEvidence) ||
      !durableMinimumEnvelopeMatchesEvidence(
        durableResponse,
        response._minimumWriteEvidence,
      ) ||
      !validIsoTimestamp(response.acceptedAt) ||
      !safeNotice(response.notice) ||
      !validDurableStatusMetadata(response, verifiedAt !== null)) {
    return null;
  }
  const processing = processingMinimumPriceStatus(
    response as unknown as MinimumPriceUpdateResult,
  );
  if (inspection.state !== "completed") return processing;
  if (!verifiedAt) return null;
  return {
    ...processing,
    status: "VERIFIED",
    verifiedAt,
    verified: true,
    authoritative: true,
    notice:
      "最低價已由 Notebook Key 唯讀回查確認；B2B 價格與階梯尚未送出，請重新預檢後再確認。",
  };
}

function writeStatusFromInspection(
  inspection: MainWriteGateInspection,
): BusinessPriceWriteStatus | null {
  return inspection.operationType === "business_price"
    ? businessPriceWriteStatusFromInspection(inspection)
    : minimumPriceWriteStatusFromInspection(inspection);
}

function latestWriteStatusProjection(
  inspection: MainWriteGateInspection,
): Readonly<{ writeStatus: BusinessPriceWriteStatus | null }> | null {
  try {
    const writeStatus = writeStatusFromInspection(inspection);
    if (writeStatus) return { writeStatus };
    return inspection.state === "completed" ? null : { writeStatus: null };
  } catch {
    return inspection.state === "completed" ? null : { writeStatus: null };
  }
}

function writeStatusStillMatchesCanonical(
  status: BusinessPriceWriteStatus,
  snapshot: BusinessPricingListingSnapshot,
): boolean {
  if (status.status === "PROCESSING") return true;
  if (status.stage === "minimum_price") {
    return snapshot.minimumPricePresence === "canonical" &&
      sameMoney(status.requestedMinimumPrice, snapshot.minimumPrice);
  }
  return snapshot.businessOfferPresence === "present" &&
    sameMoney(status.requestedBusinessPrice, snapshot.businessPrice) &&
    (status.requestedMinimumPrice === null ||
      (snapshot.minimumPricePresence === "canonical" &&
        sameMoney(status.requestedMinimumPrice, snapshot.minimumPrice))) &&
    (status.quantityDiscountPlanChange !== "replace" ||
      (snapshot.quantityDiscountPlanPresence === "canonical" &&
        sameQuantityDiscountPlan(
          status.requestedQuantityDiscountPlan,
          snapshot.quantityDiscountPlan,
        )));
}

type AcceptedListingSubmission = Readonly<{
  acceptedAt: string;
  submissionId: string;
  requestId: string | null;
  issues: ListingIssue[];
}>;

function acceptedListingSubmission(
  gateway: BusinessPricingGateway,
  reply: BusinessPricingGatewayReply,
  sellerSku: string,
  label: "B2B 價格" | "最低允許售價",
): AcceptedListingSubmission {
  if (!reply.ok) {
    return throwListingsPayloadError({
      status: reply.status,
      operation: "write",
      apiOperation: "patchListingsItem",
      requestId: reply.requestId,
      retryAfter: reply.retryAfter,
      payload: gatewayPayload(reply.payload),
    });
  }
  const payload = gatewayPayload(reply.payload);
  if (!payload || !listingSubmissionIssuesAreWellFormed(payload.issues)) {
    throw new SpApiError(
      payload
        ? `Amazon 已回傳${label}接受狀態，但 issues 格式無法辨識。請重新查詢確認，勿盲目重送。`
        : `Amazon 已收到${label}請求，但回應無法辨識。請重新查詢 SKU 確認，勿盲目重送。`,
      {
        status: 502,
        code: "UPDATE_STATUS_UNKNOWN",
        requestId: reply.requestId,
        operation: "patchListingsItem",
      },
    );
  }
  const issues = normalizeListingIssues(payload.issues);
  if (
    payload.sku !== sellerSku ||
    typeof payload.submissionId !== "string" ||
    !payload.submissionId.trim()
  ) {
    throw new SpApiError(
      `Amazon 已回傳${label}接受狀態，但 SKU 或 submissionId 缺失／不一致。請重新查詢確認，勿盲目重送。`,
      {
        status: 502,
        code: "UPDATE_STATUS_UNKNOWN",
        requestId: reply.requestId,
        issues,
        operation: "patchListingsItem",
      },
    );
  }
  if (payload.status === "INVALID") {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        `Amazon 未接受這次${label}更新。`,
      {
        status: 422,
        code: "UPDATE_REJECTED",
        requestId: reply.requestId,
        issues,
        operation: "patchListingsItem",
      },
    );
  }
  if (
    payload.status !== "ACCEPTED" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      `Amazon ${label}正式回應的狀態互相矛盾或無法辨識。請重新查詢確認，勿盲目重送。`,
      {
        status: 502,
        code: "UPDATE_STATUS_UNKNOWN",
        requestId: reply.requestId,
        issues,
        operation: "patchListingsItem",
      },
    );
  }
  return {
    acceptedAt: new Date().toISOString(),
    submissionId: payload.submissionId,
    requestId: reply.requestId,
    issues,
  };
}

async function commitPreparedBusinessPrice(
  gateway: BusinessPricingGateway,
  prepared: PreparedBusinessPriceMutation,
  control: Readonly<{
    fence: ListingWriteExecutionFence;
    recordDurableEvidence(result: BusinessPriceDurableResult): Promise<void>;
  }>,
): Promise<BusinessPriceUpdateResult> {
  if (prepared.listing.mode === "demo") {
    await gateway.replaceDemoContribution(prepared.patch, control.fence);
    return durableResult(prepared, {
      status: "SIMULATED",
      acceptedAt: new Date().toISOString(),
      submissionId: null,
      requestId: null,
      issues: [],
      notice: "模擬 Amazon Business 調價完成；Amazon 真實價格沒有變更。",
    }) as BusinessPriceAcceptedDurableResult;
  }
  const receipt = acceptedListingSubmission(
    gateway,
    await gateway.commitOnce(
      prepared.patch,
      control.fence,
      () => control.recordDurableEvidence(dispatchedResult(prepared)),
    ),
    prepared.patch.sellerSku,
    "B2B 價格",
  );
  return durableResult(prepared, {
    status: "ACCEPTED",
    ...receipt,
    notice:
      "Amazon 已接受 B2B 調價請求，正在處理；主程序會自動只用 GET 受控回查，相符後才代表 Business Price 已生效。",
  }) as BusinessPriceAcceptedDurableResult;
}

async function prepareCommit(
  work: () => Promise<PreparedBusinessPriceMutation>,
): Promise<PreparedBusinessPriceMutation> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SpApiPreCommitError) throw error;
    const cause = error instanceof SpApiError
      ? error
      : new SpApiError(
          "B2B 價格正式寫入前的重新讀取、PTD 或 Validation Preview 失敗。",
          { status: 500, code: "PRECOMMIT_FAILED" },
        );
    throw new SpApiPreCommitError(cause);
  }
}

function createBusinessPricingMutationOperations(
  gateway: BusinessPricingGateway,
): BusinessPricingMutationOperations {
  return {
    read: async (identity) => {
      const snapshot = await gateway.read(identity, "read-only");
      assertCanonicalSnapshot(gateway, snapshot, identity);
      return snapshot;
    },
    preview: async (input) => {
      const prepared = await prepareBusinessPriceMutation(gateway, input);
      return {
        mode: prepared.listing.mode,
        status: prepared.listing.mode === "demo" ? "SIMULATED" : "VALID",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        ...prepared.evidence,
        ...prepared.verified,
        validatedAt: new Date().toISOString(),
        issues: prepared.issues,
        notice: prepared.listing.mode === "demo"
          ? "展示 B2B 價格預檢已通過；尚未寫入 Amazon，最終按鈕只會模擬。"
          : prepared.issues.length
            ? "Amazon B2B 價格預檢通過，但有警告需要確認；尚未寫入。"
            : "Amazon B2B 價格 Validation Preview 已通過，尚未寫入。",
      };
    },
    commit: async (input, control) => {
      const prepared = await prepareCommit(() =>
        prepareBusinessPriceMutation(
          gateway,
          input,
          control.expectedEvidence,
        )
      );
      return commitPreparedBusinessPrice(gateway, prepared, control);
    },
    commitMinimumPrice: async (input, control) => {
      const prepared = await prepareCommit(() =>
        prepareBusinessPriceMutation(
          gateway,
          input,
          control.expectedEvidence,
        )
      );
      const patch = prepared.minimumPricePatch;
      if (!patch) {
        throw new SpApiPreCommitError(new SpApiError(
          "這次預檢不需要調整最低允許售價，已停止不相符的寫入。",
          { status: 409, code: "PREVIEW_CHANGED" },
        ));
      }
      if (prepared.listing.mode === "demo") {
        await gateway.replaceDemoMinimumPrice(patch, control.fence);
        return minimumPriceDurableResult(prepared, {
          status: "SIMULATED",
          acceptedAt: new Date().toISOString(),
          submissionId: null,
          requestId: null,
          issues: [],
          notice: "模擬最低允許售價調整完成；Amazon 真實最低價沒有變更。",
        }) as MinimumPriceAcceptedDurableResult;
      }
      const receipt = acceptedListingSubmission(
        gateway,
        await gateway.commitMinimumPriceOnce(
          patch,
          control.fence,
          () => control.recordDurableEvidence(
            dispatchedMinimumPriceResult(prepared),
          ),
        ),
        patch.sellerSku,
        "最低允許售價",
      );
      return minimumPriceDurableResult(prepared, {
        status: "ACCEPTED",
        ...receipt,
        notice:
          "Amazon 已接受最低允許售價更新；完成唯讀回查前不會送出 B2B 價格。",
      }) as MinimumPriceAcceptedDurableResult;
    },
    minimumPriceReadbackDecision: (result, snapshot) =>
      minimumPriceReadbackDecision(gateway, result, snapshot),
  };
}

export class BusinessPricingMutations implements BusinessPricingMutationsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly operations: BusinessPricingMutationOperations;
  private readonly priceObserver: BusinessPricingCanonicalPriceObserver;
  private readonly getBatchAuditJob: BusinessPricingBatchAuditJobReader | null;
  private readonly now: () => number;
  private readonly reconciliationDelaysMs: readonly number[];
  private readonly scheduleReconciliation:
    BusinessPricingReconciliationSchedule;
  private readonly batchPlans = new Map<string, BusinessPricingBatchPlan>();
  private readonly reconciliationJobs = new Map<string, symbol>();
  private reconciliationReadsInFlight = 0;
  private readonly reconciliationReadWaiters: Array<() => void> = [];

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    writeGate: MainWriteGatePort;
    operations: BusinessPricingMutationOperations;
    priceObserver: BusinessPricingCanonicalPriceObserver;
    getBatchAuditJob?: BusinessPricingBatchAuditJobReader;
    now?: () => number;
    reconciliationDelaysMs?: readonly number[];
    scheduleReconciliation?: BusinessPricingReconciliationSchedule;
  }>) {
    this.context = input.context;
    this.writeGate = input.writeGate;
    this.operations = input.operations;
    this.priceObserver = input.priceObserver;
    this.getBatchAuditJob = input.getBatchAuditJob ?? null;
    this.now = input.now ?? Date.now;
    this.reconciliationDelaysMs = input.reconciliationDelaysMs ??
      BUSINESS_PRICING_RECONCILIATION_DELAYS_MS;
    this.scheduleReconciliation = input.scheduleReconciliation ??
      defaultBusinessPricingReconciliationSchedule;
  }

  async handle(command: BusinessPricingMutationCommand): Promise<ApiResponse> {
    if (command.operation === "read") return this.readRoute(command.request);
    if (command.operation === "batchRead") {
      return this.batchReadRoute(command.request);
    }
    if (command.operation === "batchPreview") {
      return this.batchPreviewRoute(command.request);
    }
    if (command.operation === "batchCommit") {
      return this.batchCommitRoute(command.request);
    }
    if (command.operation === "preview") {
      return this.previewRoute(command.request);
    }
    return this.commitRoute(command.request);
  }

  clear(): void {
    this.batchPlans.clear();
    this.reconciliationJobs.clear();
  }

  private async acquireReconciliationReadSlot(): Promise<void> {
    if (
      this.reconciliationReadsInFlight <
        BUSINESS_PRICING_RECONCILIATION_MAX_CONCURRENT_READS
    ) {
      this.reconciliationReadsInFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.reconciliationReadWaiters.push(resolve);
    });
  }

  private releaseReconciliationReadSlot(): void {
    const next = this.reconciliationReadWaiters.shift();
    if (next) {
      next();
      return;
    }
    this.reconciliationReadsInFlight -= 1;
  }

  private async inspectAuthoritativeBatchWrite(
    input: Readonly<{
      context: SpExecutionContext;
      stage: BusinessPricingBatchStage;
      result: BusinessPriceUpdateResult | MinimumPriceUpdateResult;
    }>,
  ): Promise<BusinessPriceWriteStatus | null> {
    if (!this.writeGate.inspect) return null;
    const projected = await this.writeGate.inspect({
      context: input.context,
      marketplaceId: input.result.marketplaceId,
      sellerSku: input.result.sellerSku,
      operations: input.stage === "minimum_price"
        ? ["price"]
        : ["business_price"],
      project: latestWriteStatusProjection,
    });
    const expectedStage = input.stage === "minimum_price"
      ? "minimum_price"
      : "business_price";
    const businessResult = input.stage === "business_price"
      ? input.result as BusinessPriceUpdateResult
      : null;
    return projected
      .map((entry) => entry.writeStatus)
      .find((status): status is BusinessPriceWriteStatus => Boolean(
        status &&
        status.status === "VERIFIED" &&
        status.verified === true &&
        status.authoritative === true &&
        status.canResend === false &&
        status.stage === expectedStage &&
        status.mode === input.context.mode &&
        status.marketplaceId === input.result.marketplaceId &&
        status.sellerSku === input.result.sellerSku &&
        status.asin === input.result.asin &&
        status.productType === input.result.productType &&
        status.acceptedAt === input.result.acceptedAt &&
        status.requestId === input.result.requestId &&
        status.submissionId === input.result.submissionId &&
        (businessResult === null || sameOptionalMoney(
          status.requestedBusinessPrice,
          businessResult.requestedBusinessPrice,
        )) &&
        sameOptionalMoney(
          status.requestedMinimumPrice,
          input.result.requestedMinimumPrice,
        ) &&
        (businessResult === null || sameQuantityDiscountPlan(
          status.requestedQuantityDiscountPlan,
          businessResult.requestedQuantityDiscountPlan,
        ))
      )) ?? null;
  }

  private async readRoute(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    if (!marketplaceId || !sellerSku) {
      return invalid("請選擇站點並輸入完整 SKU。");
    }
    const identity = { marketplaceId, sellerSku };
    try {
      const context = await this.context.capture(marketplaceId);
      const snapshot = await this.operations.read(identity);
      await this.context.assertCurrent(context);
      await this.priceObserver.observeCanonical(identity, snapshot, context);
      await this.writeGate.reconcile({
        context,
        marketplaceId,
        sellerSku,
        operations: ["price", "business_price"],
        snapshot,
        project: (response, operation, canonical) =>
          operation === "price"
            ? reconcileMinimumPriceWrite(response, canonical)
            : reconcileBusinessPriceWrite(response, canonical),
      });
      const writeStatuses = await this.writeGate.inspect?.({
        context,
        marketplaceId,
        sellerSku,
        operations: ["price", "business_price"],
        project: latestWriteStatusProjection,
      }) ?? [];
      await this.context.assertCurrent(context);
      const latestWriteStatus = writeStatuses[0]?.writeStatus ?? null;
      return json({
        ...snapshot,
        writeStatus: latestWriteStatus &&
            writeStatusStillMatchesCanonical(latestWriteStatus, snapshot)
          ? latestWriteStatus
          : null,
      });
    } catch (error) {
      return routeError(
        error,
        "查詢 Amazon Business 價格時發生未預期的錯誤。",
      );
    }
  }

  private pruneBatchPlans(now = this.now()): void {
    for (const [previewId, plan] of this.batchPlans) {
      if (plan.state !== "committing" && plan.expiresAt <= now) {
        this.batchPlans.delete(previewId);
      }
    }
  }

  private requestWithBody(
    request: ApiRequest,
    body: Record<string, unknown>,
  ): ApiRequest {
    return {
      ...request,
      body: { kind: "json", value: body },
    };
  }

  private async batchRouteInput(
    request: ApiRequest,
    body: Record<string, unknown>,
  ): Promise<BusinessPricingRouteInput | ApiResponse> {
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    if (!marketplaceId || !sellerSku) {
      return invalid("批次 B2B 預檢包含無效的站點或 Seller SKU。");
    }
    if (!Object.prototype.hasOwnProperty.call(body, "quantityDiscountTiers")) {
      return this.routeInput(this.requestWithBody(request, body));
    }

    const canonical = await this.operations.read({ marketplaceId, sellerSku });
    if (
      canonical.marketplaceId !== marketplaceId ||
      canonical.sellerSku !== sellerSku
    ) {
      throw new SpApiError(
        "批次 B2B 的 Amazon 重新讀取結果不屬於指定 SKU，已停止。",
        { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
      );
    }
    const suppliedMinimumPrice = Object.prototype.hasOwnProperty.call(
      body,
      "expectedMinimumPrice",
    )
      ? body.expectedMinimumPrice
      : undefined;
    const canonicalMinimumPrice = canonical.minimumPrice?.amount ?? null;
    if (
      suppliedMinimumPrice !== undefined &&
      suppliedMinimumPrice !== canonicalMinimumPrice
    ) {
      throw new SpApiError(
        "批次 B2B 的最低允許售價已改變，請重新整理健檢結果。",
        { status: 409, code: "PREVIEW_CHANGED" },
      );
    }
    const suppliedPlanHash = Object.prototype.hasOwnProperty.call(
      body,
      "expectedQuantityDiscountPlanHash",
    )
      ? body.expectedQuantityDiscountPlanHash
      : undefined;
    if (
      suppliedPlanHash !== undefined &&
      suppliedPlanHash !== canonical.quantityDiscountPlanHash
    ) {
      throw new SpApiError(
        "批次 B2B 的數量折扣方案已改變，請重新整理健檢結果。",
        { status: 409, code: "PREVIEW_CHANGED" },
      );
    }
    return this.routeInput(this.requestWithBody(request, {
      ...body,
      expectedMinimumPrice: canonicalMinimumPrice,
      expectedQuantityDiscountPlanHash: canonical.quantityDiscountPlanHash,
    }));
  }

  private batchStage(
    evidence: BusinessPriceValidationResult,
  ): BusinessPricingBatchStage {
    return evidence.minimumPriceChange === "lower"
      ? "minimum_price"
      : "business_price";
  }

  private batchBinding(
    plan: BusinessPricingBatchPlan,
    stage: BusinessPricingBatchStage,
  ): WriteBinding {
    const changes = plan.changes.filter((change) => change.stage === stage);
    const intents = changes.map((change) => {
      const duplicateRepair =
        change.evidence.quantityDiscountPlanPresence === "duplicate" &&
        change.evidence.quantityDiscountPlanChange === "replace";
      const inputFingerprint = proposalFingerprint(
        change.input,
        change.evidence,
      );
      return {
        intentId: `${stage}:${change.input.sellerSku}`,
        operation: stage === "minimum_price"
          ? "price" as const
          : duplicateRepair
            ? "business_price_repair" as const
            : "business_price" as const,
        marketplaceId: plan.marketplaceId,
        sellerSku: change.input.sellerSku,
        idempotencyKey: stage === "minimum_price"
          ? `minimum-price-${canonicalSha256(change.input.idempotencyKey)
            .slice(0, 56)}`
          : change.input.idempotencyKey,
        proposalFingerprint: stage === "minimum_price"
          ? canonicalSha256([
              inputFingerprint,
              change.evidence.minimumPriceProtectedHash,
              change.evidence.minimumPriceCanonicalPatchHash,
            ])
          : inputFingerprint,
      };
    });
    const first = intents[0];
    if (!first) {
      throw new SpApiError("批次 B2B 寫入階段沒有可執行的 SKU。", {
        status: 409,
        code: "PREVIEW_CHANGED",
      });
    }
    return {
      family: "business-price",
      previewKey: `${plan.previewId}:${stage}`,
      context: plan.context,
      intents: [first, ...intents.slice(1)],
    };
  }

  private batchPreviewPayload(plan: BusinessPricingBatchPlan) {
    return {
      previewId: plan.previewId,
      marketplaceId: plan.marketplaceId,
      status: "READY",
      expiresAt: new Date(plan.expiresAt).toISOString(),
      rows: plan.changes.map((change) => ({
        sellerSku: change.input.sellerSku,
        stage: change.stage,
        validation: publicBusinessPriceResult(change.evidence),
      })),
      approvalStages: (["minimum_price", "business_price"] as const)
        .filter((stage) =>
          plan.changes.some((change) => change.stage === stage)
        ),
      notice:
        `已逐 SKU 完成 Amazon fresh read 與 Validation Preview；${plan.changes.length.toLocaleString()} 個勾選 SKU 尚未寫入。最低價與 B2B 會分開授權。`,
    };
  }

  private async assertCompletedBatchAudit(
    input: Readonly<{
      jobId: string;
      contextId: string;
      context: SpExecutionContext;
      rawItems: readonly Record<string, unknown>[];
    }>,
  ): Promise<readonly BusinessPricingBatchAuditIdentity[]> {
    if (!this.getBatchAuditJob) {
      throw new SpApiError(
        "Notebook 鑰匙無法取得本次 B2B 健檢的 main-owned 完成證據。",
        { status: 409, code: "BATCH_AUDIT_EVIDENCE_REQUIRED" },
      );
    }
    const receipt = await this.getBatchAuditJob({
      kind: "businessPricing",
      marketplaceId: input.context.marketplaceId,
      mode: input.context.mode,
      jobId: input.jobId,
      contextId: input.contextId,
    });
    if (
      !receipt.ready ||
      receipt.status !== "completed" ||
      receipt.jobId !== input.jobId ||
      receipt.contextId !== input.contextId ||
      receipt.kind !== "businessPricing" ||
      receipt.marketplaceId !== input.context.marketplaceId ||
      receipt.mode !== input.context.mode
    ) {
      throw new SpApiError(
        "B2B 價格健檢尚未完成，或工作／context 已改變。",
        { status: 409, code: "BATCH_AUDIT_EVIDENCE_INVALID" },
      );
    }
    const snapshot = businessPricingAuditSnapshot(
      receipt.snapshot,
      input.context,
    );
    const identities = input.rawItems.map((rawItem) =>
      assertSnapshotProvesBatchItem(snapshot, rawItem)
    );
    await this.context.assertCurrent(input.context);
    return identities;
  }

  private async batchPreviewRoute(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "批次 B2B 預檢必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const jobId = reportIdentifier(body.jobId);
    const contextId = reportIdentifier(body.contextId);
    if (
      Object.keys(body).some((key) =>
        key !== "jobId" && key !== "contextId" && key !== "items"
      ) ||
      !jobId ||
      !contextId ||
      !Array.isArray(body.items) ||
      body.items.length < 1 ||
      body.items.length > BUSINESS_PRICING_BATCH_MAX_ITEMS
    ) {
      return invalid(
        `批次 B2B 預檢必須包含 1–${BUSINESS_PRICING_BATCH_MAX_ITEMS} 個勾選 SKU。`,
      );
    }
    const rawItems = body.items;
    if (rawItems.some((item) => !isPlainRecord(item))) {
      return invalid("批次 B2B 預檢包含無效的商品資料。");
    }
    const firstMarketplaceId = parseMarketplace(rawItems[0]?.marketplaceId);
    if (
      !firstMarketplaceId ||
      rawItems.some((item) =>
        parseMarketplace(item.marketplaceId) !== firstMarketplaceId
      )
    ) {
      return invalid(
        "一次批次 B2B 預檢只能處理同一個 Amazon 站點。",
        409,
        "MARKETPLACE_CHANGED",
      );
    }
    const sellerSkus = rawItems.map((item) => parseSellerSku(item.sellerSku));
    if (
      sellerSkus.some((sellerSku) => !sellerSku) ||
      new Set(sellerSkus).size !== sellerSkus.length
    ) {
      return invalid(
        "批次 B2B 包含重複或無效的 Seller SKU，已停止送出。",
        409,
        "IDEMPOTENCY_CONFLICT",
      );
    }

    try {
      const context = await this.context.capture(firstMarketplaceId);
      const auditIdentities = await this.assertCompletedBatchAudit({
        jobId,
        contextId,
        context,
        rawItems,
      });
      const changes: BusinessPricingBatchChange[] = [];
      for (const [index, rawItem] of rawItems.entries()) {
        await this.context.assertCurrent(context);
        const input = await this.batchRouteInput(request, rawItem);
        if ("status" in input) return input;
        const evidence = await this.operations.preview(input);
        const auditIdentity = auditIdentities[index]!;
        if (
          evidence.mode !== context.mode ||
          evidence.marketplaceId !== input.marketplaceId ||
          evidence.sellerSku !== input.sellerSku ||
          evidence.sellerSku !== auditIdentity.sellerSku ||
          evidence.asin !== auditIdentity.asin ||
          evidence.productType !== auditIdentity.productType
        ) {
          throw new SpApiError(
            `SKU ${input.sellerSku} 的 ASIN 或 Product Type 已不同於完成健檢時的商品，已停止。`,
            { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
          );
        }
        changes.push({
          input,
          evidence,
          stage: this.batchStage(evidence),
          auditIdentity,
        });
      }
      await this.context.assertCurrent(context);
      const previewId = `business-pricing-batch-${canonicalSha256(
        [
          jobId,
          contextId,
          context.accountScope,
          context.generation,
          context.mode,
          firstMarketplaceId,
          changes.map((change) => [
            change.input.sellerSku,
            change.input.idempotencyKey,
            change.stage,
            proposalFingerprint(change.input, change.evidence),
          ]),
        ],
      ).slice(0, 40)}`;
      const plan: BusinessPricingBatchPlan = {
        previewId,
        auditJobId: jobId,
        auditContextId: contextId,
        marketplaceId: firstMarketplaceId,
        context,
        changes,
        expiresAt: this.now() + BUSINESS_PRICING_BATCH_PREVIEW_TTL_MS,
        state: "ready",
        stageResults: new Map(),
        acceptedTargets: new Map(),
      };
      this.pruneBatchPlans();
      for (const stage of ["minimum_price", "business_price"] as const) {
        if (changes.some((change) => change.stage === stage)) {
          await this.writeGate.stagePreview(this.batchBinding(plan, stage));
        }
      }
      this.batchPlans.set(previewId, plan);
      return json(this.batchPreviewPayload(plan));
    } catch (error) {
      return writeError(
        error,
        "Amazon Business 批次預檢時發生未預期的錯誤。",
      );
    }
  }

  private approvalReasonForBatchStage(
    plan: BusinessPricingBatchPlan,
    stage: BusinessPricingBatchStage,
    verificationCode: string,
  ): string {
    const changes = plan.changes.filter((change) => change.stage === stage);
    const shownSkus = changes.slice(0, 5)
      .map((change) => change.input.sellerSku)
      .join("、");
    const remaining = Math.max(0, changes.length - 5);
    const marketplace = marketplaceById(plan.marketplaceId)!;
    const label = stage === "minimum_price"
      ? "確認批次最低價"
      : "確認批次 B2B 調價";
    const separation = stage === "minimum_price"
      ? "｜B2B 本次不送出"
      : "";
    const detailed =
      `${label}｜${marketplaceCode(plan.marketplaceId)}｜${changes.length} SKU｜${shownSkus}${remaining ? ` 等另 ${remaining} 個` : ""}${separation}｜驗證碼 ${verificationCode}`;
    if (detailed.length <= NATIVE_CONFIRMATION_REASON_MAX_LENGTH) {
      return detailed;
    }
    return `${label}｜${marketplace.code}｜${changes.length} SKU${separation}｜已在 App 逐項核對｜驗證碼 ${verificationCode}`;
  }

  private async assertFreshBatchStage(
    plan: BusinessPricingBatchPlan,
    stage: BusinessPricingBatchStage,
  ): Promise<void> {
    const changes = plan.changes.filter((change) => change.stage === stage);
    for (const change of changes) {
      await this.context.assertCurrent(plan.context);
      const fresh = await this.operations.preview(change.input);
      if (
        fresh.mode !== plan.context.mode ||
        fresh.marketplaceId !== change.input.marketplaceId ||
        fresh.sellerSku !== change.input.sellerSku ||
        fresh.sellerSku !== change.auditIdentity.sellerSku ||
        fresh.asin !== change.auditIdentity.asin ||
        fresh.productType !== change.auditIdentity.productType ||
        this.batchStage(fresh) !== stage ||
        proposalFingerprint(change.input, fresh) !==
          proposalFingerprint(change.input, change.evidence)
      ) {
        throw new SpApiError(
          `SKU ${change.input.sellerSku} 的 Amazon 原值或 Validation Preview 已改變；本階段 Amazon 寫入數為 0。`,
          { status: 409, code: "PREVIEW_CHANGED" },
        );
      }
    }
    await this.context.assertCurrent(plan.context);
  }

  private scheduleCanonicalReconciliation(
    result: BusinessPriceUpdateResult | MinimumPriceUpdateResult,
    stage: BusinessPricingBatchStage,
    context: SpExecutionContext,
    onVerified?: (status: BusinessPriceWriteStatus) => void,
  ): void {
    if (result.mode !== "live" || result.status !== "ACCEPTED") return;
    const key = [
      context.accountScope,
      context.marketplaceId,
      result.sellerSku,
      stage,
    ].join("\u0000");
    const token = Symbol(key);
    this.reconciliationJobs.set(key, token);
    const scheduleAttempt = (index: number): void => {
      const delayMs = this.reconciliationDelaysMs[index];
      if (delayMs === undefined || this.reconciliationJobs.get(key) !== token) {
        if (this.reconciliationJobs.get(key) === token) {
          this.reconciliationJobs.delete(key);
        }
        return;
      }
      this.scheduleReconciliation(async () => {
        if (this.reconciliationJobs.get(key) !== token) return;
        await this.acquireReconciliationReadSlot();
        try {
          if (this.reconciliationJobs.get(key) !== token) return;
          try {
            await this.context.assertCurrent(context);
            const identity = {
              marketplaceId: result.marketplaceId,
              sellerSku: result.sellerSku,
            };
            const canonical = await this.operations.read(identity);
            await this.context.assertCurrent(context);
            if (
              canonical.mode !== context.mode ||
              canonical.marketplaceId !== result.marketplaceId ||
              canonical.sellerSku !== result.sellerSku
            ) {
              throw new SpApiError(
                "Amazon B2B 自動回查結果無法安全歸屬原 SKU。",
                { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
              );
            }
            await this.priceObserver.observeCanonical(
              identity,
              canonical,
              context,
            );
            await this.writeGate.reconcile({
              context,
              marketplaceId: result.marketplaceId,
              sellerSku: result.sellerSku,
              operations: stage === "minimum_price"
                ? ["price"]
                : ["business_price"],
              snapshot: canonical,
              project: (response, operation, snapshot) =>
                operation === "price"
                  ? reconcileMinimumPriceWrite(response, snapshot)
                  : reconcileBusinessPriceWrite(response, snapshot),
            });
            const authoritative = await this.inspectAuthoritativeBatchWrite({
              context,
              stage,
              result,
            });
            await this.context.assertCurrent(context);
            if (authoritative) {
              onVerified?.(authoritative);
              this.reconciliationJobs.delete(key);
              return;
            }
          } catch (error) {
            if (error instanceof SpExecutionContextError) {
              this.reconciliationJobs.delete(key);
              return;
            }
          }
        } finally {
          this.releaseReconciliationReadSlot();
        }
        scheduleAttempt(index + 1);
      }, delayMs);
    };
    scheduleAttempt(0);
  }

  private acceptedTargetKey(
    stage: BusinessPricingBatchStage,
    sellerSku: string,
  ): string {
    return `${stage}\u0000${sellerSku}`;
  }

  private markBatchRowVerified(
    plan: BusinessPricingBatchPlan,
    stage: BusinessPricingBatchStage,
    sellerSku: string,
    status: BusinessPriceWriteStatus,
  ): void {
    const reconciliationKey = [
      plan.context.accountScope,
      plan.context.marketplaceId,
      sellerSku,
      stage,
    ].join("\u0000");
    this.reconciliationJobs.delete(reconciliationKey);
    const rows = plan.stageResults.get(stage);
    if (!rows) return;
    plan.stageResults.set(stage, rows.map((row) =>
      row.sellerSku === sellerSku && row.state === "processing"
        ? {
            sellerSku,
            stage,
            state: "verified" as const,
            result: status,
            error: null,
          }
        : row
    ));
  }

  private scheduleBatchStageReconciliations(
    plan: BusinessPricingBatchPlan,
    stage: BusinessPricingBatchStage,
    rows: readonly BusinessPricingBatchRowResult[],
  ): void {
    for (const row of rows) {
      if (row.state !== "processing") continue;
      const result = plan.acceptedTargets.get(
        this.acceptedTargetKey(stage, row.sellerSku),
      );
      if (!result) continue;
      this.scheduleCanonicalReconciliation(
        result,
        stage,
        plan.context,
        (status) => this.markBatchRowVerified(
          plan,
          stage,
          row.sellerSku,
          status,
        ),
      );
    }
  }

  private async refreshBatchRowsFromLedger(
    plan: BusinessPricingBatchPlan,
  ): Promise<void> {
    for (const [key, result] of plan.acceptedTargets) {
      const separator = key.indexOf("\u0000");
      const stage = key.slice(0, separator) as BusinessPricingBatchStage;
      const sellerSku = key.slice(separator + 1);
      const current = plan.stageResults.get(stage)?.find((row) =>
        row.sellerSku === sellerSku
      );
      if (!current || current.state !== "processing") continue;
      const authoritative = await this.inspectAuthoritativeBatchWrite({
        context: plan.context,
        stage,
        result,
      });
      await this.context.assertCurrent(plan.context);
      if (authoritative) {
        this.markBatchRowVerified(
          plan,
          stage,
          sellerSku,
          authoritative,
        );
      }
    }
  }

  private async executeBatchStage(
    plan: BusinessPricingBatchPlan,
    stage: BusinessPricingBatchStage,
  ): Promise<BusinessPricingBatchRowResult[]> {
    const changes = plan.changes.filter((change) => change.stage === stage);
    return this.writeGate.execute({
      binding: this.batchBinding(plan, stage),
      approvalReason: (verificationCode) =>
        this.approvalReasonForBatchStage(plan, stage, verificationCode),
      beforeApproval: () => this.assertFreshBatchStage(plan, stage),
      run: async (session) => {
        const rows: BusinessPricingBatchRowResult[] = [];
        for (const change of changes) {
          let acceptedBusinessPrice: BusinessPriceUpdateResult | null = null;
          let acceptedMinimumPrice: MinimumPriceUpdateResult | null = null;
          try {
            await this.context.assertCurrent(plan.context);
            const result = stage === "minimum_price"
              ? await session.attempt({
                  intentId: `${stage}:${change.input.sellerSku}`,
                  execute: (control) =>
                    commitWithCanonicalReadback({
                      commit: async () => {
                        const accepted = await this.operations
                          .commitMinimumPrice(change.input, {
                            expectedEvidence: change.evidence,
                            fence: { assertCurrent: control.assertCurrent },
                            recordDurableEvidence:
                              control.recordDurableEvidence ??
                                control.recordAccepted,
                          });
                        if (
                          accepted.mode === "live" &&
                          accepted.status === "ACCEPTED"
                        ) {
                          acceptedMinimumPrice = accepted;
                        }
                        return accepted;
                      },
                      onAccepted: control.recordAccepted,
                      assertCurrent: control.assertCurrent,
                      read: () => this.operations.read({
                        marketplaceId: change.input.marketplaceId,
                        sellerSku: change.input.sellerSku,
                      }),
                      decide: this.operations.minimumPriceReadbackDecision,
                      delaysMs: [],
                    }),
                })
              : await session.attempt({
                  intentId: `${stage}:${change.input.sellerSku}`,
                  execute: (control) =>
                    commitWithCanonicalReadback({
                      commit: async () => {
                        const accepted = await this.operations.commit(
                          change.input,
                          {
                            expectedEvidence: change.evidence,
                            fence: { assertCurrent: control.assertCurrent },
                            recordDurableEvidence:
                              control.recordDurableEvidence ??
                                control.recordAccepted,
                          },
                        );
                        if (
                          accepted.mode === "live" &&
                          accepted.status === "ACCEPTED"
                        ) {
                          acceptedBusinessPrice = accepted;
                        }
                        return accepted;
                      },
                      onAccepted: control.recordAccepted,
                      assertCurrent: control.assertCurrent,
                      read: () => this.operations.read({
                        marketplaceId: change.input.marketplaceId,
                        sellerSku: change.input.sellerSku,
                      }),
                      decide: businessPriceReadbackDecision,
                      delaysMs: [],
                    }),
                });
            rows.push({
              sellerSku: change.input.sellerSku,
              stage,
              state: "simulated",
              result: publicBusinessPriceResult(result),
              error: null,
            });
          } catch (error) {
            const acceptedResult = acceptedMinimumPrice ??
              acceptedBusinessPrice;
            if (
              acceptedResult &&
              error instanceof SpApiError &&
              error.code === "UPDATE_STATUS_UNKNOWN"
            ) {
              const processing = stage === "minimum_price"
                ? processingMinimumPriceStatus(
                    acceptedResult as MinimumPriceUpdateResult,
                    change.evidence,
                  )
                : processingBusinessPriceStatus(
                    acceptedResult as BusinessPriceUpdateResult,
                  );
              rows.push({
                sellerSku: change.input.sellerSku,
                stage,
                state: "processing",
                result: processing,
                error: null,
              });
              plan.acceptedTargets.set(
                this.acceptedTargetKey(stage, change.input.sellerSku),
                acceptedResult,
              );
              continue;
            }
            const publicError = error instanceof SpApiError
              ? publicSpApiError(
                  error,
                  "Amazon 未完成這個 SKU 的價格更新。",
                )
              : {
                  code: "UPDATE_STATUS_UNKNOWN",
                  message: "Amazon 寫入結果尚未確認。",
                  requestId: null,
                };
            const rowLocalPrecommit = isBatchRowLocalPrecommitError(error);
            rows.push({
              sellerSku: change.input.sellerSku,
              stage,
              state: rowLocalPrecommit
                ? "rejected"
                : "unknown",
              result: null,
              error: publicError,
            });
            if (!rowLocalPrecommit) break;
          }
        }
        const attemptedSkus = new Set(rows.map((row) => row.sellerSku));
        for (const change of changes) {
          if (attemptedSkus.has(change.input.sellerSku)) continue;
          rows.push({
            sellerSku: change.input.sellerSku,
            stage,
            state: "not-started",
            result: null,
            error: {
              code: "BATCH_STOPPED",
              message:
                "前一筆寫入結果無法安全判定，本 SKU 未送出 Amazon。",
              requestId: null,
            },
          });
        }
        return rows;
      },
    });
  }

  private publicBatchCommitPayload(plan: BusinessPricingBatchPlan) {
    const rows = plan.changes.map((change) =>
      plan.stageResults.get(change.stage)?.find((row) =>
        row.sellerSku === change.input.sellerSku
      ) ?? {
        sellerSku: change.input.sellerSku,
        stage: change.stage,
        state: "not-started" as const,
        result: null,
        error: {
          code: "BATCH_STAGE_NOT_AUTHORIZED",
          message: "這個獨立授權階段尚未送出 Amazon。",
          requestId: null,
        },
      }
    );
    const processingCount = rows.filter((row) =>
      row.state === "processing"
    ).length;
    const verifiedCount = rows.filter((row) =>
      row.state === "verified"
    ).length;
    const issueCount = rows.filter((row) =>
      row.state === "rejected" ||
      row.state === "unknown" ||
      row.state === "not-started"
    ).length;
    return {
      previewId: plan.previewId,
      marketplaceId: plan.marketplaceId,
      status: issueCount
        ? "COMPLETED_WITH_ISSUES"
        : processingCount
          ? "PROCESSING"
          : "COMPLETED",
      rows,
      acceptedCount: processingCount + verifiedCount,
      verifiedCount,
      issueCount,
      verified: rows.length > 0 && rows.every((row) =>
        row.state === "verified" || row.state === "simulated"
      ),
      canResend: false,
      notice: processingCount
        ? `Amazon 已接受 ${processingCount.toLocaleString()} 個 SKU，主程序將只用 GET 受控回查；正式 PATCH 不會自動重送。`
        : verifiedCount
          ? `Amazon 已接受的 ${verifiedCount.toLocaleString()} 個 SKU 已由 Notebook Key 的 durable ledger 確認回查完成；沒有重新送出 PATCH。`
          : issueCount
            ? `批次 B2B 有 ${issueCount.toLocaleString()} 個項目未安全完成；請依各列狀態核對。結果不明時禁止重送。`
          : "批次 B2B 已完成展示模擬；Amazon 真實價格沒有變更。",
    };
  }

  private async batchCommitRoute(request: ApiRequest): Promise<ApiResponse> {
    const body = bodyRecord(request);
    if (
      !body ||
      Object.keys(body).some((key) => key !== "previewId") ||
      typeof body.previewId !== "string" ||
      !/^business-pricing-batch-[a-f0-9]{40}$/u.test(body.previewId)
    ) {
      return invalid(
        "批次 B2B 送出缺少有效的 previewId。",
        400,
        "PREVIEW_CHANGED",
      );
    }
    this.pruneBatchPlans();
    const plan = this.batchPlans.get(body.previewId);
    if (!plan || plan.expiresAt <= this.now()) {
      if (plan) this.batchPlans.delete(plan.previewId);
      return invalid(
        "批次 B2B 預檢已過期，請重新預檢。",
        410,
        "PREVIEW_EXPIRED",
      );
    }
    if (plan.state === "committing") {
      return invalid(
        "這份批次 B2B 正在處理，已阻止重複送出。",
        409,
        "OPERATION_IN_PROGRESS",
      );
    }
    if (plan.state === "completed") {
      const replay = this.publicBatchCommitPayload(plan);
      return json(replay, replay.status === "COMPLETED" ? 200 : 202);
    }
    try {
      const current = await this.context.capture(plan.marketplaceId);
      await this.context.assertCurrent(plan.context);
      if (
        current.accountScope !== plan.context.accountScope ||
        current.mode !== plan.context.mode ||
        current.generation !== plan.context.generation
      ) {
        this.batchPlans.delete(plan.previewId);
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "Amazon 執行環境已更新；請重新預檢批次 B2B。",
        );
      }
      plan.state = "committing";
      for (const stage of ["minimum_price", "business_price"] as const) {
        if (
          plan.stageResults.has(stage) ||
          !plan.changes.some((change) => change.stage === stage)
        ) continue;
        const rows = await this.executeBatchStage(plan, stage);
        plan.stageResults.set(stage, rows);
        this.scheduleBatchStageReconciliations(plan, stage, rows);
        if (rows.some((row) => row.state === "unknown")) break;
      }
      plan.state = "completed";
      plan.expiresAt = this.now() + BUSINESS_PRICING_BATCH_RESULT_TTL_MS;
      const payload = this.publicBatchCommitPayload(plan);
      return json(payload, payload.status === "COMPLETED" ? 200 : 202);
    } catch (error) {
      plan.state = "ready";
      if (plan.stageResults.size) {
        plan.expiresAt = this.now() + BUSINESS_PRICING_BATCH_RESULT_TTL_MS;
        const payload = this.publicBatchCommitPayload(plan);
        return json({
          ...payload,
          status: "COMPLETED_WITH_ISSUES",
          notice:
            `${payload.notice} 後續獨立授權階段尚未完成；已完成的 PATCH 不會重送。`,
        }, 207);
      }
      return writeError(
        error,
        "送出 Amazon Business 批次更新時發生未預期的錯誤。",
      );
    }
  }

  private async batchReadRoute(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const jobId = reportIdentifier(request.query.jobId);
    const contextId = reportIdentifier(request.query.contextId);
    const previewId = request.query.previewId === undefined
      ? null
      : typeof request.query.previewId === "string" &&
          /^business-pricing-batch-[a-f0-9]{40}$/u.test(
            request.query.previewId,
          )
        ? request.query.previewId
        : null;
    if (
      Object.keys(request.query).some((key) =>
        key !== "marketplaceId" && key !== "jobId" &&
        key !== "contextId" && key !== "previewId"
      ) ||
      !marketplaceId ||
      !jobId ||
      !contextId ||
      (request.query.previewId !== undefined && !previewId)
    ) {
      return invalid(
        "B2B 批次狀態缺少有效的站點、健檢工作或 context。",
      );
    }
    this.pruneBatchPlans();
    const matching = [...this.batchPlans.values()].filter((plan) =>
      plan.marketplaceId === marketplaceId &&
      plan.auditJobId === jobId &&
      plan.auditContextId === contextId &&
      (!previewId || plan.previewId === previewId)
    );
    const plan = matching.at(-1);
    if (!plan) {
      return invalid(
        "這份 B2B 批次狀態已過期或不屬於目前健檢工作。",
        410,
        "BATCH_STATUS_EXPIRED",
      );
    }
    try {
      const current = await this.context.capture(marketplaceId);
      await this.context.assertCurrent(plan.context);
      if (
        current.accountScope !== plan.context.accountScope ||
        current.mode !== plan.context.mode ||
        current.generation !== plan.context.generation
      ) {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "Amazon 執行環境已更新；請重新執行 B2B 健檢。",
        );
      }
      await this.assertCompletedBatchAudit({
        jobId,
        contextId,
        context: plan.context,
        rawItems: [],
      });
      await this.refreshBatchRowsFromLedger(plan);
      await this.context.assertCurrent(plan.context);
      return json(this.publicBatchCommitPayload(plan));
    } catch (error) {
      return writeError(
        error,
        "讀取 B2B 批次 durable 狀態時發生未預期的錯誤。",
      );
    }
  }

  private routeInput(request: ApiRequest): BusinessPricingRouteInput | ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "B2B 價格請求必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const allowedKeys = new Set([
      "marketplaceId",
      "sellerSku",
      "expectedStandardPrice",
      "expectedBusinessPrice",
      "newBusinessPrice",
      "expectedMinimumPrice",
      "expectedQuantityDiscountPlanHash",
      "quantityDiscountTiers",
      "idempotencyKey",
    ]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return invalid("B2B 價格請求包含不支援的欄位。");
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const key = validIdempotencyKey(body.idempotencyKey);
    if (!marketplaceId || !sellerSku || !key) {
      return invalid("請提供有效的 Amazon 站點、完整 SKU 與預檢識別碼。");
    }
    const currency = marketplaceById(marketplaceId)!.currency;
    const expectedStandardPrice = parsePrice(
      body.expectedStandardPrice,
      currency,
    );
    const expectedBusinessPrice = body.expectedBusinessPrice === null
      ? null
      : parsePrice(body.expectedBusinessPrice, currency);
    const newBusinessPrice = parsePrice(body.newBusinessPrice, currency);
    if (
      expectedStandardPrice === null ||
      (body.expectedBusinessPrice !== null && expectedBusinessPrice === null) ||
      newBusinessPrice === null
    ) {
      return invalid(
        currency === "JPY"
          ? "一般售價與 B2B 價格必須是大於 0 的整數。"
          : "一般售價與 B2B 價格必須大於 0，且最多只能有兩位小數。",
        400,
        "INVALID_PRICE",
      );
    }
    const hasExpectedPlanHash = Object.prototype.hasOwnProperty.call(
      body,
      "expectedQuantityDiscountPlanHash",
    );
    const hasTiers = Object.prototype.hasOwnProperty.call(
      body,
      "quantityDiscountTiers",
    );
    const hasExpectedMinimumPrice = Object.prototype.hasOwnProperty.call(
      body,
      "expectedMinimumPrice",
    );
    if (hasExpectedPlanHash !== hasTiers) {
      return invalid(
        "數量折扣更新必須同時提供舊方案 hash 與完整 tiers；省略兩者才代表價格-only 並保留原方案。",
        400,
        "INVALID_QUANTITY_DISCOUNT",
      );
    }
    if (hasExpectedMinimumPrice !== hasTiers) {
      return invalid(
        "階梯折扣更新必須同時綁定目前最低允許售價；價格-only 不可夾帶此欄位。",
        400,
        "INVALID_MINIMUM_PRICE",
      );
    }
    const expectedMinimumPrice = !hasExpectedMinimumPrice ||
        body.expectedMinimumPrice === null
      ? null
      : parsePrice(body.expectedMinimumPrice, currency);
    if (
      hasExpectedMinimumPrice &&
      body.expectedMinimumPrice !== null &&
      expectedMinimumPrice === null
    ) {
      return invalid(
        "目前最低允許售價必須大於 0，且符合站點幣別精度。",
        400,
        "INVALID_MINIMUM_PRICE",
      );
    }
    let expectedQuantityDiscountPlanHash: string | null | undefined;
    let quantityDiscountTiers: UpdateBusinessPriceInput["quantityDiscountTiers"];
    if (hasTiers) {
      expectedQuantityDiscountPlanHash = body.expectedQuantityDiscountPlanHash ===
          null
        ? null
        : typeof body.expectedQuantityDiscountPlanHash === "string" &&
            /^[a-f0-9]{64}$/u.test(body.expectedQuantityDiscountPlanHash)
          ? body.expectedQuantityDiscountPlanHash
          : undefined;
      if (
        expectedQuantityDiscountPlanHash === undefined ||
        !Array.isArray(body.quantityDiscountTiers) ||
        body.quantityDiscountTiers.length < 1 ||
        body.quantityDiscountTiers.length > 5
      ) {
        return invalid(
          "數量折扣必須提供 1–5 階完整方案與可核對的舊方案 hash。",
          400,
          "INVALID_QUANTITY_DISCOUNT",
        );
      }
      const parsedTiers: NonNullable<
        UpdateBusinessPriceInput["quantityDiscountTiers"]
      > = [];
      for (const rawTier of body.quantityDiscountTiers) {
        if (!isPlainRecord(rawTier) ||
            Object.keys(rawTier).length !== 2 ||
            !("lowerBound" in rawTier) || !("percent" in rawTier)) {
          return invalid(
            "每一階數量折扣只能包含 lowerBound 與 percent。",
            400,
            "INVALID_QUANTITY_DISCOUNT",
          );
        }
        const lowerBound = rawTier.lowerBound;
        const percent = rawTier.percent;
        const previous = parsedTiers.at(-1);
        if (
          !Number.isSafeInteger(lowerBound) || Number(lowerBound) <= 0 ||
          Number(lowerBound) > 999_999_999 ||
          typeof percent !== "number" || !Number.isFinite(percent) ||
          percent <= 0 || percent >= 100 ||
          Number(percent.toFixed(2)) !== percent ||
          (previous !== undefined &&
            (Number(lowerBound) <= previous.lowerBound ||
              percent <= previous.percent))
        ) {
          return invalid(
            "數量折扣件數與百分比必須合法且逐階嚴格遞增（百分比最多兩位小數）。",
            400,
            "INVALID_QUANTITY_DISCOUNT",
          );
        }
        parsedTiers.push({ lowerBound: Number(lowerBound), percent });
      }
      quantityDiscountTiers = parsedTiers;
    }
    return {
      marketplaceId,
      sellerSku,
      expectedStandardPrice,
      expectedBusinessPrice,
      newBusinessPrice,
      ...(hasExpectedMinimumPrice ? { expectedMinimumPrice } : {}),
      ...(hasTiers ? {
        expectedQuantityDiscountPlanHash,
        quantityDiscountTiers,
      } : {}),
      idempotencyKey: key,
    };
  }

  private binding(
    input: BusinessPricingRouteInput,
    evidence: BusinessPricePrecommitEvidence,
    context: SpExecutionContext,
  ): WriteBinding {
    const duplicateRepair =
      evidence.quantityDiscountPlanPresence === "duplicate" &&
      evidence.quantityDiscountPlanChange === "replace";
    const hasMinimumPriceIntent = Boolean(
      evidence.minimumPriceCanonicalPatchHash &&
      evidence.minimumPriceProtectedHash,
    );
    const businessPriceIntent = {
      intentId: "primary",
      operation: duplicateRepair
        ? "business_price_repair" as const
        : "business_price" as const,
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      idempotencyKey: input.idempotencyKey,
      proposalFingerprint: proposalFingerprint(input, evidence),
    };
    const intents = hasMinimumPriceIntent
      ? [{
          intentId: "minimum-price",
          operation: "price" as const,
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          idempotencyKey:
            `minimum-price-${canonicalSha256(input.idempotencyKey).slice(0, 56)}`,
          proposalFingerprint: canonicalSha256([
            proposalFingerprint(input, evidence),
            evidence.minimumPriceProtectedHash,
            evidence.minimumPriceCanonicalPatchHash,
          ]),
        }] as const
      : [businessPriceIntent] as const;
    return {
      family: "business-price",
      previewKey: input.idempotencyKey,
      context,
      intents,
    };
  }

  private async previewRoute(request: ApiRequest): Promise<ApiResponse> {
    const input = this.routeInput(request);
    if ("status" in input) return input;
    try {
      const context = await this.context.capture(input.marketplaceId);
      const result = await this.operations.preview(input);
      if (
        result.mode !== context.mode ||
        result.marketplaceId !== input.marketplaceId ||
        result.sellerSku !== input.sellerSku
      ) {
        throw new SpApiError(
          "Amazon B2B 預檢結果不屬於這次要求的執行模式、站點或 Seller SKU，已停止使用。",
          { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
        );
      }
      await this.context.assertCurrent(context);
      await this.writeGate.stagePreview(this.binding(input, result, context));
      return json(result);
    } catch (error) {
      return writeError(
        error,
        "Amazon Business 價格預檢時發生未預期的錯誤。",
      );
    }
  }

  private async commitRoute(request: ApiRequest): Promise<ApiResponse> {
    const input = this.routeInput(request);
    if ("status" in input) return input;
    let evidence: BusinessPriceValidationResult;
    let context: SpExecutionContext;
    try {
      context = await this.context.capture(input.marketplaceId);
      evidence = await this.operations.preview(input);
      await this.context.assertCurrent(context);
    } catch (error) {
      return routeError(
        error,
        "正式確認前重新執行 Amazon Business 價格預檢時發生未預期的錯誤。",
      );
    }
    const marketplace = marketplaceById(input.marketplaceId)!;
    const quantityDiscountSummary = evidence.quantityDiscountPlanChange ===
        "preserve"
      ? "維持原方案"
      : `${evidence.previousQuantityDiscountPlan
        ? `${evidence.previousQuantityDiscountPlan.discountType} ${evidence.previousQuantityDiscountPlan.levels.map((level) => `${level.lowerBound}件=${level.value}`).join("、")}`
        : "未設定"} → ${evidence.requestedQuantityDiscountPlan?.levels.map((level) => `${level.lowerBound}件=${level.value}%`).join("、") ?? "未設定"}`;
    const minimumPriceSummary = evidence.minimumPriceChange === "lower" &&
        evidence.previousMinimumPrice && evidence.requestedMinimumPrice &&
        evidence.lowestTierUnitPrice
      ? `確認只調整最低價｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜最低價 ${evidence.previousMinimumPrice.amount} → ${evidence.requestedMinimumPrice.amount} ${marketplace.currency}（ALL；影響一般售價／自動定價）｜最低階單價 ${evidence.lowestTierUnitPrice.amount} ${marketplace.currency}｜B2B 價格與數量折扣本次尚未送出`
      : "";
    if (
      minimumPriceSummary.length > NATIVE_CONFIRMATION_REASON_MAX_LENGTH
    ) {
      return json({
        code: "NATIVE_APPROVAL_SUMMARY_TOO_LONG",
        message:
          "最低價的高風險原生確認摘要超過 Notebook Key 可完整顯示的上限，App 無法安全送出；請改到 Seller Central 人工處理。Amazon 寫入數為 0。",
        sellerSkus: [input.sellerSku],
        writeCount: 0,
      }, 422);
    }
    const approvalReason = minimumPriceSummary
      ? minimumPriceSummary
      : `確認 B2B 調價｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜B2B ${input.expectedBusinessPrice ?? "未設定"} → ${input.newBusinessPrice} ${marketplace.currency}｜一般售價維持 ${input.expectedStandardPrice}｜數量折扣 ${quantityDiscountSummary}`;
    let acceptedMinimumPrice: MinimumPriceUpdateResult | null = null;
    let acceptedBusinessPrice: BusinessPriceUpdateResult | null = null;
    try {
      const result = await this.writeGate.execute({
        binding: this.binding(input, evidence, context),
        approvalReason,
        run: async (session) => {
          if (evidence.minimumPriceChange !== "lower") {
            return session.attempt({
              intentId: "primary",
              execute: (control) =>
                commitWithCanonicalReadback({
                  commit: async () => {
                    const accepted = await this.operations.commit(input, {
                      expectedEvidence: evidence,
                      fence: { assertCurrent: control.assertCurrent },
                      recordDurableEvidence:
                        control.recordDurableEvidence ?? control.recordAccepted,
                    });
                    if (accepted.mode === "live" &&
                        accepted.status === "ACCEPTED") {
                      acceptedBusinessPrice = accepted;
                    }
                    return accepted;
                  },
                  onAccepted: control.recordAccepted,
                  assertCurrent: control.assertCurrent,
                  read: () => this.operations.read({
                    marketplaceId: input.marketplaceId,
                    sellerSku: input.sellerSku,
                  }),
                  decide: businessPriceReadbackDecision,
                  delaysMs: [],
                }),
            });
          }
          try {
            return await session.attempt({
              intentId: "minimum-price",
              execute: (control) =>
                commitWithCanonicalReadback({
                  commit: async () => {
                    const accepted = await this.operations.commitMinimumPrice(
                      input,
                      {
                        expectedEvidence: evidence,
                        fence: { assertCurrent: control.assertCurrent },
                        recordDurableEvidence:
                          control.recordDurableEvidence ??
                            control.recordAccepted,
                      },
                    );
                    if (accepted.mode === "live" &&
                        accepted.status === "ACCEPTED") {
                      acceptedMinimumPrice = accepted;
                    }
                    return accepted;
                  },
                  onAccepted: control.recordAccepted,
                  assertCurrent: control.assertCurrent,
                  read: () => this.operations.read({
                    marketplaceId: input.marketplaceId,
                    sellerSku: input.sellerSku,
                  }),
                  decide: this.operations.minimumPriceReadbackDecision,
                  delaysMs: [],
                }),
            });
          } catch (error) {
            if (error instanceof SpApiError &&
                error.code === "UPDATE_STATUS_UNKNOWN") {
              throw new SpApiError(
                "最低價寫入結果尚未確認；B2B 價格與階梯折扣尚未送出。系統已禁止自動重送，請先重新讀取 Amazon。",
                {
                  status: error.status,
                  code: error.code,
                  requestId: error.requestId,
                  retryAfter: error.retryAfter,
                  issues: error.issues,
                  operation: error.operation,
                  upstreamCode: error.upstreamCode,
                },
              );
            }
            throw error;
          }
        },
      });
      return json(publicBusinessPriceResult(result));
    } catch (error) {
      if (error instanceof SpApiError &&
          error.code === "UPDATE_STATUS_UNKNOWN") {
        if (acceptedBusinessPrice) {
          this.scheduleCanonicalReconciliation(
            acceptedBusinessPrice,
            "business_price",
            context,
          );
          return json(
            processingBusinessPriceStatus(acceptedBusinessPrice),
            202,
          );
        }
        if (acceptedMinimumPrice) {
          this.scheduleCanonicalReconciliation(
            acceptedMinimumPrice,
            "minimum_price",
            context,
          );
          return json(
            processingMinimumPriceStatus(acceptedMinimumPrice, evidence),
            202,
          );
        }
      }
      return writeError(
        error,
        "送出 Amazon Business 價格更新時發生未預期的錯誤。",
      );
    }
  }
}

export function createBusinessPricingMutations(input: Readonly<{
  context: SpExecutionContextAdapter;
  writeGate: MainWriteGatePort;
  gateway: BusinessPricingGateway;
  priceObserver: BusinessPricingCanonicalPriceObserver;
  getBatchAuditJob?: BusinessPricingBatchAuditJobReader;
}>): BusinessPricingMutationsPort {
  return new BusinessPricingMutations({
    context: input.context,
    writeGate: input.writeGate,
    operations: createBusinessPricingMutationOperations(input.gateway),
    priceObserver: input.priceObserver,
    getBatchAuditJob: input.getBatchAuditJob,
  });
}
