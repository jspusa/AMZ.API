import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../shared/marketplaces";
import type {
  BusinessPricePrecommitEvidence,
  BusinessPriceUpdateResult,
  BusinessPriceValidationResult,
  BusinessPricingListingSnapshot,
  BusinessQuantityDiscountLevel,
  BusinessQuantityDiscountPlan,
  UpdateBusinessPriceInput,
} from "./amazon/business-pricing-types";
import {
  businessPricingPatchBody,
  type BusinessPricePatch,
  type BusinessPricingGateway,
} from "./amazon/business-pricing-gateway";
import {
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
  SpApiError,
  SpApiPreCommitError,
  type ListingIssue,
} from "./amazon/sp-api-error";
import {
  businessPriceReadbackDecision,
  commitWithCanonicalReadback,
  reconcileBusinessPriceWrite,
} from "./amazon/listing-write-readback";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import {
  bodyRecord,
  isPlainRecord,
  parseMarketplace,
  parseSellerSku,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  MainWriteGateError,
  type MainWriteGatePort,
  type WriteBinding,
} from "./write-gate";

export type BusinessPricingMutationCommand = Readonly<{
  operation: "read" | "preview" | "commit";
  request: ApiRequest;
}>;

export interface BusinessPricingMutationsPort {
  handle(command: BusinessPricingMutationCommand): Promise<ApiResponse>;
}

export interface BusinessPricingMutationOperations {
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): Promise<BusinessPricingListingSnapshot>;
  preview(
    input: UpdateBusinessPriceInput,
  ): Promise<BusinessPriceValidationResult>;
  commit(
    input: UpdateBusinessPriceInput,
    evidence: BusinessPricePrecommitEvidence,
    fence: ListingWriteExecutionFence,
  ): Promise<BusinessPriceUpdateResult>;
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
    const unitPrice = Number((
      input.newBusinessPrice * (1 - tier.percent / 100)
    ).toFixed(precision));
    const previousUnitPrice = previous
      ? Number((
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
  const requestedPlan = requestedQuantityDiscountPlan(listing, input);
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
    if (sameBusinessPrice && (!requestedPlan || samePlan)) {
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
  return { ...base, kind: "price-only", quantityDiscountPlan: null };
}

type PreparedBusinessPriceMutation = Readonly<{
  listing: BusinessPricingListingSnapshot;
  patch: BusinessPricePatch;
  verified: VerifiedBusinessPriceChange;
  issues: ListingIssue[];
  evidence: BusinessPricePrecommitEvidence;
}>;

function precommitEvidence(
  listing: BusinessPricingListingSnapshot,
  patch: BusinessPricePatch,
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
    previousQuantityDiscountPlanHash: listing.quantityDiscountPlanHash,
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
    actual.previousQuantityDiscountPlanHash !==
      expected.previousQuantityDiscountPlanHash ||
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
  if (
    listing.mode !== gateway.mode(input.marketplaceId) ||
    listing.marketplaceId !== input.marketplaceId ||
    listing.sellerSku !== input.sellerSku ||
    typeof listing.asin !== "string" || !/^[A-Z0-9]{10}$/u.test(listing.asin) ||
    !listing.productType || listing.productType !== listing.productType.trim() ||
    listing.productType.toUpperCase() === "PRODUCT" ||
    !listing.fulfillmentAvailability.some((entry) =>
      entry.fulfillment === "FBA"
    )
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

async function prepareBusinessPriceMutation(
  gateway: BusinessPricingGateway,
  input: UpdateBusinessPriceInput,
  expectedEvidence?: BusinessPricePrecommitEvidence,
): Promise<PreparedBusinessPriceMutation> {
  const listing = await gateway.read(input, "mutation");
  assertCanonicalSnapshot(gateway, listing, input);
  const verified = verifyBusinessPriceChange(listing, input);
  const patch = patchDescriptor(listing, verified);
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
    const reply = await gateway.validationPreview(patch);
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
          ? "Amazon B2B 價格預檢的 issues 證據格式無法辨識，尚未寫入。"
          : "Amazon 回傳了無法辨識的 B2B 價格預檢結果。",
        {
          status: 502,
          code: "VALIDATION_STATUS_UNKNOWN",
          requestId: reply.requestId,
          operation: "patchListingsItemPreview",
        },
      );
    }
    issues = normalizeListingIssues(payload.issues);
    if (
      payload.status === "INVALID" ||
      issues.some((issue) => issue.severity === "ERROR")
    ) {
      throw new SpApiError(
        issues.find((issue) => issue.severity === "ERROR")?.message ||
          "Amazon B2B 價格 Validation Preview 未通過。",
        {
          status: 422,
          code: "VALIDATION_FAILED",
          requestId: reply.requestId,
          issues,
          operation: "patchListingsItemPreview",
        },
      );
    }
    const identifiers = Array.isArray(payload.identifiers)
      ? payload.identifiers
      : [];
    const identifier = identifiers[0];
    if (
      payload.status !== "VALID" ||
      payload.sku !== input.sellerSku ||
      typeof payload.submissionId !== "string" ||
      !payload.submissionId.trim() ||
      identifiers.length !== 1 ||
      !isRecord(identifier) ||
      identifier.marketplaceId !== input.marketplaceId ||
      identifier.asin !== listing.asin
    ) {
      throw new SpApiError(
        "Amazon B2B 價格預檢沒有回傳 exact SKU／ASIN／站點的 VALID 證據。",
        {
          status: 502,
          code: "VALIDATION_STATUS_UNKNOWN",
          requestId: reply.requestId,
          issues,
          operation: "patchListingsItemPreview",
        },
      );
    }
  }
  const evidence = precommitEvidence(listing, patch, issues);
  if (expectedEvidence) assertPrecommitEvidence(evidence, expectedEvidence);
  return { listing, patch, verified, issues, evidence };
}

type BusinessPriceWriteEvidence = Readonly<{
  version: 1;
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string;
  productType: string;
  standardPrice: Money;
  requestedBusinessPrice: Money;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanChange: "preserve" | "replace";
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  schemaChecksum: string;
}>;

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
    standardPrice: structuredClone(prepared.verified.standardPrice),
    requestedBusinessPrice: structuredClone(
      prepared.verified.requestedBusinessPrice,
    ),
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
    acceptedAt: input.acceptedAt,
    submissionId: input.submissionId,
    requestId: input.requestId,
    issues: input.issues,
    notice: input.notice,
    _writeEvidence: writeEvidence(prepared),
  };
}

function publicBusinessPriceResult<T>(value: T): T {
  if (!isRecord(value)) return value;
  const { _writeEvidence: _internal, ...publicValue } = value;
  return publicValue as T;
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

export function createBusinessPricingMutationOperations(
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
    commit: async (input, expectedEvidence, fence) => {
      const prepared = await prepareCommit(() =>
        prepareBusinessPriceMutation(gateway, input, expectedEvidence)
      );
      if (prepared.listing.mode === "demo") {
        await gateway.replaceDemoContribution(prepared.patch, fence);
        return durableResult(prepared, {
          status: "SIMULATED",
          acceptedAt: new Date().toISOString(),
          submissionId: null,
          requestId: null,
          issues: [],
          notice: "模擬 Amazon Business 調價完成；Amazon 真實價格沒有變更。",
        }) as BusinessPriceAcceptedDurableResult;
      }
      const reply = await gateway.commitOnce(
        prepared.patch,
        fence,
        async () => undefined,
      );
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
            ? "Amazon 已回傳 B2B 價格接受狀態，但 issues 格式無法辨識。請重新查詢確認，勿盲目重送。"
            : "Amazon 已收到 B2B 價格請求，但回應無法辨識。請重新查詢 SKU 確認，勿盲目重送。",
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
        payload.sku !== input.sellerSku ||
        typeof payload.submissionId !== "string" ||
        !payload.submissionId.trim()
      ) {
        throw new SpApiError(
          "Amazon 已回傳 B2B 價格接受狀態，但 SKU 或 submissionId 缺失／不一致。請重新查詢確認，勿盲目重送。",
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
            "Amazon 未接受這次 B2B 價格更新。",
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
          "Amazon B2B 價格正式回應的狀態互相矛盾或無法辨識。請重新查詢確認，勿盲目重送。",
          {
            status: 502,
            code: "UPDATE_STATUS_UNKNOWN",
            requestId: reply.requestId,
            issues,
            operation: "patchListingsItem",
          },
        );
      }
      return durableResult(prepared, {
        status: "ACCEPTED",
        acceptedAt: new Date().toISOString(),
        submissionId: payload.submissionId,
        requestId: reply.requestId,
        issues,
        notice:
          "Amazon 已接受 B2B 調價請求，正在處理；重新查詢確認後才代表 Business Price 已生效。",
      }) as BusinessPriceAcceptedDurableResult;
    },
  };
}

export class BusinessPricingMutations implements BusinessPricingMutationsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly operations: BusinessPricingMutationOperations;
  private readonly priceObserver: BusinessPricingCanonicalPriceObserver;

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    writeGate: MainWriteGatePort;
    operations: BusinessPricingMutationOperations;
    priceObserver: BusinessPricingCanonicalPriceObserver;
  }>) {
    this.context = input.context;
    this.writeGate = input.writeGate;
    this.operations = input.operations;
    this.priceObserver = input.priceObserver;
  }

  async handle(command: BusinessPricingMutationCommand): Promise<ApiResponse> {
    if (command.operation === "read") return this.readRoute(command.request);
    if (command.operation === "preview") {
      return this.previewRoute(command.request);
    }
    return this.commitRoute(command.request);
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
        operations: ["business_price"],
        snapshot,
        project: (response, _operation, canonical) =>
          reconcileBusinessPriceWrite(response, canonical),
      });
      return json(snapshot);
    } catch (error) {
      return routeError(
        error,
        "查詢 Amazon Business 價格時發生未預期的錯誤。",
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
    if (hasExpectedPlanHash !== hasTiers) {
      return invalid(
        "數量折扣更新必須同時提供舊方案 hash 與完整 tiers；省略兩者才代表價格-only 並保留原方案。",
        400,
        "INVALID_QUANTITY_DISCOUNT",
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
    return {
      family: "business-price",
      previewKey: input.idempotencyKey,
      context,
      intents: [{
        intentId: "primary",
        operation: "business_price",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        idempotencyKey: input.idempotencyKey,
        proposalFingerprint: proposalFingerprint(input, evidence),
      }],
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
    try {
      const result = await this.writeGate.execute({
        binding: this.binding(input, evidence, context),
        approvalReason: `確認 B2B 調價｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜一般售價維持 ${input.expectedStandardPrice}｜B2B ${input.expectedBusinessPrice ?? "未設定"} → ${input.newBusinessPrice} ${marketplace.currency}｜數量折扣 ${evidence.quantityDiscountPlanChange === "preserve" ? "維持原方案" : `${evidence.previousQuantityDiscountPlan ? `${evidence.previousQuantityDiscountPlan.discountType} ${evidence.previousQuantityDiscountPlan.levels.map((level) => `${level.lowerBound}件=${level.value}`).join("、")}` : "未設定"} → ${evidence.requestedQuantityDiscountPlan?.levels.map((level) => `${level.lowerBound}件=${level.value}%`).join("、") ?? "未設定"}`}`,
        run: (session) => session.attempt({
          intentId: "primary",
          execute: ({ recordAccepted, assertCurrent }) =>
            commitWithCanonicalReadback({
              commit: () => this.operations.commit(input, evidence, {
                assertCurrent,
              }),
              onAccepted: recordAccepted,
              assertCurrent,
              read: () => this.operations.read({
                marketplaceId: input.marketplaceId,
                sellerSku: input.sellerSku,
              }),
              decide: businessPriceReadbackDecision,
            }),
        }),
      });
      return json(result);
    } catch (error) {
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
}>): BusinessPricingMutationsPort {
  return new BusinessPricingMutations({
    context: input.context,
    writeGate: input.writeGate,
    operations: createBusinessPricingMutationOperations(input.gateway),
    priceObserver: input.priceObserver,
  });
}
