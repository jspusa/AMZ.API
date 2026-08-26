import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import { marketplaceById, type MarketplaceId } from "../shared/marketplaces";
import type {
  ListingPriceSnapshot,
  PriceUpdateResult,
  PriceValidationResult,
  SalePriceUpdateResult,
  SalePriceValidationResult,
  UpdateListingPriceInput,
  UpdateListingSalePriceInput,
} from "./amazon/listing-price-types";
import type { ListingWriteExecutionFence } from
  "./amazon/listing-write-execution-fence";
import type {
  ListingPriceGateway,
  ListingPriceGatewayReply,
  ListingPricePatch,
} from "./amazon/listing-price-gateway";
import { isDateOnly } from "./amazon/marketplace-calendar";
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
  commitWithCanonicalReadback,
} from "./amazon/listing-write-readback";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import {
  bodyRecord,
  optionalDate,
  parseMarketplace,
  parseSellerSku,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  MainWriteGateError,
  type MainWriteGatePort,
  type WriteBinding,
} from "./write-gate";

export type ListingPriceMutationCommand =
  | Readonly<{
      family: "standard-price";
      operation: "read" | "preview" | "commit";
      request: ApiRequest;
    }>
  | Readonly<{
      family: "sale-price";
      operation: "preview" | "commit";
      request: ApiRequest;
    }>;

export interface ListingPriceMutationsPort {
  handle(command: ListingPriceMutationCommand): Promise<ApiResponse>;
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>, context: SpExecutionContext): Promise<ListingPriceSnapshot>;
  observeCanonical(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      sellerSku: string;
    }>,
    snapshot: ListingPriceSnapshot,
    context: SpExecutionContext,
  ): Promise<void>;
}

export type StandardPriceMutationInput = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
  newPrice: number;
  expectedPrice: number;
}>;

export interface ListingPriceMutationOperations {
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): Promise<ListingPriceSnapshot>;
  previewStandard(
    input: StandardPriceMutationInput,
  ): Promise<PriceValidationResult>;
  commitStandard(
    input: StandardPriceMutationInput,
    fence: ListingWriteExecutionFence,
  ): Promise<PriceUpdateResult>;
  previewSale(
    input: UpdateListingSalePriceInput,
  ): Promise<SalePriceValidationResult>;
  commitSale(
    input: UpdateListingSalePriceInput,
    fence: ListingWriteExecutionFence,
  ): Promise<SalePriceUpdateResult>;
}

export type ListingPriceMutationsDependencies = Readonly<{
  context: SpExecutionContextAdapter;
  writeGate: MainWriteGatePort;
  operations: ListingPriceMutationOperations;
}>;

type StandardPriceRouteInput = StandardPriceMutationInput & Readonly<{
  confirmationSku: string;
  idempotencyKey: string;
}>;

type SalePriceRouteInput = UpdateListingSalePriceInput & Readonly<{
  confirmationSku: string;
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

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function optionalPrice(
  value: unknown,
  currencyCode: string,
): number | null | undefined {
  if (value === null || value === "" || value === undefined) return null;
  const parsed = parsePrice(value, currencyCode);
  return parsed === null ? undefined : parsed;
}

function validIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/u.test(value)
    ? value
    : null;
}

function marketplaceCode(marketplaceId: MarketplaceId): string {
  const code = marketplaceById(marketplaceId)?.code ?? "";
  return code === "UK" ? "GB" : code;
}

function marketplaceCurrency(marketplaceId: MarketplaceId): string {
  return marketplaceById(marketplaceId)!.currency;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validMoney(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    typeof value.currencyCode === "string" &&
    value.currencyCode.length === 3;
}

function acceptedPriceWrite(value: unknown): value is Record<string, unknown> & {
  mode: "live";
  status: "ACCEPTED";
  marketplaceId: string;
  sellerSku: string;
} {
  return isRecord(value) &&
    value.mode === "live" &&
    value.status === "ACCEPTED" &&
    typeof value.marketplaceId === "string" &&
    typeof value.sellerSku === "string" &&
    stringOrNull(value.submissionId) &&
    stringOrNull(value.requestId) &&
    Array.isArray(value.issues) &&
    typeof value.notice === "string";
}

function verifiedPriceWrite<T extends {
  acceptedAt?: string;
  completedAt?: string;
  notice?: string;
}>(result: T, attempts: number, now: () => Date): unknown | null {
  const acceptedAt = result.acceptedAt ?? result.completedAt;
  if (typeof acceptedAt !== "string") return null;
  return {
    ...result,
    ...(typeof result.notice === "string"
      ? { notice: `${result.notice} 主程序唯讀回查已確認此次目標值。` }
      : {}),
    writeLifecycle: {
      state: "verified",
      verified: true,
      authoritative: true,
      acceptedAt,
      verifiedAt: now().toISOString(),
      attempts,
    },
  };
}

function exactPriceIdentity(
  result: PriceUpdateResult | SalePriceUpdateResult,
  snapshot: ListingPriceSnapshot,
): boolean {
  return result.mode === "live" &&
    snapshot.mode === "live" &&
    result.marketplaceId === snapshot.marketplaceId &&
    result.sellerSku === snapshot.sellerSku;
}

function sameMoney(
  left: { amount: number; currencyCode: string } | null,
  right: { amount: number; currencyCode: string } | null,
): boolean {
  return left !== null &&
    right !== null &&
    left.currencyCode === right.currencyCode &&
    left.amount === right.amount;
}

function canonicalDate(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/u.exec(value);
  return match?.[1] ?? null;
}

function offerFieldHasError(snapshot: ListingPriceSnapshot): boolean {
  const offerAttributes = new Set([
    "purchasable_offer",
    "our_price",
    "discounted_price",
    "quantity_discount_plan",
    "audience",
    "currency",
  ]);
  return snapshot.issues.some((issue) =>
    issue.severity === "ERROR" &&
    (issue.attributeNames.length === 0 ||
      issue.attributeNames.some((name) => offerAttributes.has(name))),
  );
}

function assertCanonicalPriceSnapshot(
  snapshot: ListingPriceSnapshot,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
    mode: "live" | "demo";
  }>,
): void {
  if (
    snapshot.marketplaceId !== input.marketplaceId ||
    snapshot.sellerSku !== input.sellerSku ||
    snapshot.mode !== input.mode ||
    typeof snapshot.asin !== "string" ||
    !/^[A-Z0-9]{10}$/u.test(snapshot.asin) ||
    !snapshot.productType ||
    snapshot.productType !== snapshot.productType.trim() ||
    snapshot.productType.toUpperCase() === "PRODUCT"
  ) {
    throw new SpApiError(
      "Amazon 價格回應的站點、SKU、ASIN、商品類型或執行模式不一致，已停止使用。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
  if (!snapshot.fulfillmentAvailability.some(
    (availability) => availability.fulfillment === "FBA"
  )) {
    throw new SpApiError(
      "此 SKU 無法確認為 FBA 商品；純 FBA 管理台不會讀取或修改它。",
      { status: 422, code: "FBA_ONLY" },
    );
  }
}

async function readCanonicalPrice(
  gateway: ListingPriceGateway,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>,
): Promise<ListingPriceSnapshot> {
  const snapshot = await gateway.read(input);
  assertCanonicalPriceSnapshot(snapshot, {
    ...input,
    mode: gateway.mode(input.marketplaceId),
  });
  return snapshot;
}

export function priceReadbackDecision(
  result: PriceUpdateResult,
  snapshot: ListingPriceSnapshot,
): "verified" | "pending" {
  return exactPriceIdentity(result, snapshot) &&
      snapshot.purchasableOfferPresence === "present" &&
      !offerFieldHasError(snapshot) &&
      sameMoney(result.requestedPrice, snapshot.standardPrice)
    ? "verified"
    : "pending";
}

export function salePriceReadbackDecision(
  result: SalePriceUpdateResult,
  snapshot: ListingPriceSnapshot,
): "verified" | "pending" {
  if (!exactPriceIdentity(result, snapshot) || offerFieldHasError(snapshot)) {
    return "pending";
  }
  if (
    snapshot.purchasableOfferPresence !== "present" ||
    !sameMoney(result.standardPrice, snapshot.standardPrice)
  ) return "pending";
  if (result.action === "cancel") {
    return snapshot.discountedPricePresence === "absent" &&
        snapshot.hasDiscountedPrice === false &&
        snapshot.discountedPrice === null
      ? "verified"
      : "pending";
  }
  const requested = result.requestedDiscountedPrice;
  const actual = snapshot.discountedPrice;
  return requested && actual &&
      sameMoney(requested.price, actual.price) &&
      canonicalDate(requested.startAt) === canonicalDate(actual.startAt) &&
      canonicalDate(requested.endAt) === canonicalDate(actual.endAt)
    ? "verified"
    : "pending";
}

export function reconcilePriceWrite(
  response: unknown,
  snapshot: ListingPriceSnapshot,
  now: () => Date = () => new Date(),
): unknown | null {
  if (
    !acceptedPriceWrite(response) ||
    !validMoney(response.previousPrice) ||
    !validMoney(response.requestedPrice) ||
    typeof response.acceptedAt !== "string"
  ) return null;
  const result = response as unknown as PriceUpdateResult;
  return priceReadbackDecision(result, snapshot) === "verified"
    ? verifiedPriceWrite(result, 0, now)
    : null;
}

export function reconcileSalePriceWrite(
  response: unknown,
  snapshot: ListingPriceSnapshot,
  now: () => Date = () => new Date(),
): unknown | null {
  if (
    !acceptedPriceWrite(response) ||
    (response.action !== "set" && response.action !== "cancel") ||
    !validMoney(response.standardPrice) ||
    typeof response.acceptedAt !== "string" ||
    !(response.requestedDiscountedPrice === null ||
      isRecord(response.requestedDiscountedPrice))
  ) return null;
  const result = response as unknown as SalePriceUpdateResult;
  return salePriceReadbackDecision(result, snapshot) === "verified"
    ? verifiedPriceWrite(result, 0, now)
    : null;
}

function samePrice(
  left: number,
  right: number,
  currencyCode: string,
): boolean {
  const precision = currencyCode === "JPY" ? 0 : 2;
  const factor = 10 ** precision;
  return Math.round(left * factor) === Math.round(right * factor);
}

function throwGatewayError(
  reply: ListingPriceGatewayReply,
  operation: "read" | "write",
  apiOperation: "patchListingsItemPreview" | "patchListingsItem",
): never {
  return throwListingsPayloadError({
    status: reply.status,
    operation,
    apiOperation,
    requestId: reply.requestId,
    retryAfter: reply.retryAfter,
    payload: isRecord(reply.payload) ? reply.payload : null,
  });
}

async function preparePriceCommit<T>(
  prepare: () => Promise<T>,
  fallbackMessage: string,
): Promise<T> {
  try {
    return await prepare();
  } catch (error) {
    if (error instanceof SpApiPreCommitError) throw error;
    const cause = error instanceof SpApiError
      ? error
      : new SpApiError(fallbackMessage, {
          status: 500,
          code: "PRECOMMIT_FAILED",
          operation: "patchListingsItemPreview",
        });
    throw new SpApiPreCommitError(cause);
  }
}

function buildPricePatch(
  listing: ListingPriceSnapshot,
  newPrice: number,
): ListingPricePatch {
  return {
    kind: "standard-price",
    marketplaceId: listing.marketplaceId,
    sellerSku: listing.sellerSku,
    productType: listing.productType,
    currencyCode: marketplaceCurrency(listing.marketplaceId),
    amount: newPrice,
  };
}

function verifyPriceChange(
  listing: ListingPriceSnapshot,
  input: UpdateListingPriceInput,
) {
  const standardPrice = listing.standardPrice;
  const currencyCode = marketplaceCurrency(input.marketplaceId);
  if (!standardPrice) {
    throw new SpApiError(
      "這個 Listing 沒有可核對的標準售價，為避免誤改，本次不允許直接寫入。",
      { status: 422, code: "PRICE_UNAVAILABLE" },
    );
  }
  if (standardPrice.currencyCode !== currencyCode) {
    throw new SpApiError("Listing 幣別與站點幣別不一致，已停止調價。", {
      status: 409,
      code: "CURRENCY_MISMATCH",
    });
  }
  if (!samePrice(standardPrice.amount, input.expectedPrice, currencyCode)) {
    throw new SpApiError(
      "目前價格已在查詢後發生變動。請重新查詢 SKU，再確認一次新價格。",
      { status: 409, code: "PRICE_CHANGED" },
    );
  }
  if (samePrice(standardPrice.amount, input.newPrice, currencyCode)) {
    throw new SpApiError("新價格與目前標準售價相同。", {
      status: 400,
      code: "PRICE_UNCHANGED",
    });
  }
  if (listing.minimumPrice && input.newPrice < listing.minimumPrice.amount) {
    throw new SpApiError("新價格低於此 Listing 的最低允許售價。", {
      status: 422,
      code: "BELOW_MINIMUM_PRICE",
    });
  }
  if (listing.maximumPrice && input.newPrice > listing.maximumPrice.amount) {
    throw new SpApiError("新價格高於此 Listing 的最高允許售價。", {
      status: 422,
      code: "ABOVE_MAXIMUM_PRICE",
    });
  }
  return standardPrice;
}

async function prepareLivePriceUpdate(
  gateway: ListingPriceGateway,
  input: UpdateListingPriceInput,
): Promise<{
  listing: ListingPriceSnapshot;
  previousPrice: NonNullable<ListingPriceSnapshot["standardPrice"]>;
  requestedPrice: NonNullable<ListingPriceSnapshot["standardPrice"]>;
  patch: ListingPricePatch;
  issues: ListingIssue[];
}> {
  const listing = await readCanonicalPrice(gateway, input);
  const previousPrice = verifyPriceChange(listing, input);
  const requestedPrice = {
    amount: input.newPrice,
    currencyCode: marketplaceCurrency(input.marketplaceId),
  };
  const patch = buildPricePatch(listing, input.newPrice);
  const reply = await gateway.validationPreview(patch);
  if (!reply.ok) {
    return throwGatewayError(reply, "read", "patchListingsItemPreview");
  }
  if (!isRecord(reply.payload)) {
    throw new SpApiError("Amazon 回傳了無法辨識的價格預檢結果。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: reply.requestId,
    });
  }
  const issues = normalizeListingIssues(reply.payload.issues);
  if (
    reply.payload.status === "INVALID" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 價格預檢未通過，尚未寫入任何變更。",
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: reply.requestId,
        issues,
      },
    );
  }
  if (reply.payload.status !== "VALID") {
    throw new SpApiError(
      "Amazon 價格預檢沒有回傳明確的 VALID 狀態，為避免誤改，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: reply.requestId,
        issues,
      },
    );
  }
  return { listing, previousPrice, requestedPrice, patch, issues };
}

function saleScheduleMatches(
  current: ListingPriceSnapshot["discountedPrice"],
  input: UpdateListingSalePriceInput,
  currencyCode: string,
): boolean {
  if (!current) {
    return input.expectedDiscountedPrice === null &&
      input.expectedStartAt === null &&
      input.expectedEndAt === null;
  }
  return input.expectedDiscountedPrice !== null &&
    samePrice(
      current.price.amount,
      input.expectedDiscountedPrice,
      currencyCode,
    ) &&
    current.startAt === input.expectedStartAt &&
    current.endAt === input.expectedEndAt;
}

function verifySalePriceChange(
  listing: ListingPriceSnapshot,
  input: UpdateListingSalePriceInput,
) {
  const currencyCode = marketplaceCurrency(input.marketplaceId);
  const standardPrice = listing.standardPrice;
  if (!standardPrice) {
    throw new SpApiError(
      "這個 Listing 沒有可核對的標準售價，為避免誤設折扣，本次不允許寫入。",
      { status: 422, code: "PRICE_UNAVAILABLE" },
    );
  }
  if (standardPrice.currencyCode !== currencyCode) {
    throw new SpApiError("Listing 幣別與站點幣別不一致，已停止建立折扣。", {
      status: 409,
      code: "CURRENCY_MISMATCH",
    });
  }
  if (!samePrice(standardPrice.amount, input.expectedPrice, currencyCode)) {
    throw new SpApiError(
      "標準售價已在查詢後發生變動。請重新查詢 SKU，再確認一次折扣。",
      { status: 409, code: "PRICE_CHANGED" },
    );
  }
  if (!saleScheduleMatches(listing.discountedPrice, input, currencyCode)) {
    throw new SpApiError(
      "目前限時折扣已在查詢後發生變動。請重新查詢 SKU，避免覆蓋其他活動。",
      { status: 409, code: "SALE_PRICE_CHANGED" },
    );
  }
  if (input.action === "cancel") {
    if (!listing.discountedPrice) {
      throw new SpApiError("這個 SKU 目前沒有可取消的限時折扣。", {
        status: 400,
        code: "SALE_PRICE_UNAVAILABLE",
      });
    }
    return standardPrice;
  }
  if (
    input.salePrice === null ||
    !isDateOnly(input.startAt) ||
    !isDateOnly(input.endAt)
  ) {
    throw new SpApiError("請提供有效的折扣價、開始日期與結束日期。", {
      status: 400,
      code: "INVALID_SALE_PRICE",
    });
  }
  if (input.endAt <= input.startAt) {
    throw new SpApiError("折扣結束日期必須晚於開始日期。", {
      status: 400,
      code: "INVALID_SALE_DATES",
    });
  }
  if (input.salePrice >= standardPrice.amount) {
    throw new SpApiError("限時折扣價必須低於標準售價。", {
      status: 422,
      code: "SALE_PRICE_NOT_LOWER",
    });
  }
  if (listing.minimumPrice && input.salePrice < listing.minimumPrice.amount) {
    throw new SpApiError("限時折扣價低於此 Listing 的最低允許售價。", {
      status: 422,
      code: "BELOW_MINIMUM_PRICE",
    });
  }
  if (
    listing.discountedPrice &&
    samePrice(
      listing.discountedPrice.price.amount,
      input.salePrice,
      currencyCode,
    ) &&
    listing.discountedPrice.startAt === input.startAt &&
    listing.discountedPrice.endAt === input.endAt
  ) {
    throw new SpApiError("新折扣設定與目前限時折扣相同。", {
      status: 400,
      code: "SALE_PRICE_UNCHANGED",
    });
  }
  return standardPrice;
}

function requestedSaleSchedule(input: UpdateListingSalePriceInput) {
  if (
    input.action === "cancel" ||
    input.salePrice === null ||
    !input.startAt ||
    !input.endAt
  ) return null;
  return {
    price: {
      amount: input.salePrice,
      currencyCode: marketplaceCurrency(input.marketplaceId),
    },
    startAt: input.startAt,
    endAt: input.endAt,
  };
}

function buildSalePricePatch(
  listing: ListingPriceSnapshot,
  input: UpdateListingSalePriceInput,
): ListingPricePatch {
  const nextSale = requestedSaleSchedule(input);
  return {
    kind: "sale-price",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    productType: listing.productType,
    currencyCode: marketplaceCurrency(input.marketplaceId),
    discountedPrice: nextSale
      ? {
          amount: nextSale.price.amount,
          startAt: nextSale.startAt,
          endAt: nextSale.endAt,
        }
      : null,
  };
}

async function prepareLiveSalePriceUpdate(
  gateway: ListingPriceGateway,
  input: UpdateListingSalePriceInput,
): Promise<{
  listing: ListingPriceSnapshot;
  standardPrice: NonNullable<ListingPriceSnapshot["standardPrice"]>;
  requestedDiscountedPrice: ListingPriceSnapshot["discountedPrice"];
  patch: ListingPricePatch;
  issues: ListingIssue[];
}> {
  const listing = await readCanonicalPrice(gateway, input);
  const standardPrice = verifySalePriceChange(listing, input);
  const requestedDiscountedPrice = requestedSaleSchedule(input);
  const patch = buildSalePricePatch(listing, input);
  const reply = await gateway.validationPreview(patch);
  if (!reply.ok) {
    return throwGatewayError(reply, "read", "patchListingsItemPreview");
  }
  if (!isRecord(reply.payload)) {
    throw new SpApiError("Amazon 回傳了無法辨識的折扣預檢結果。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: reply.requestId,
    });
  }
  const issues = normalizeListingIssues(reply.payload.issues);
  if (
    reply.payload.status === "INVALID" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 折扣預檢未通過，尚未寫入任何變更。",
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: reply.requestId,
        issues,
      },
    );
  }
  if (reply.payload.status !== "VALID") {
    throw new SpApiError(
      "Amazon 折扣預檢沒有回傳明確的 VALID 狀態，為避免誤改，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: reply.requestId,
        issues,
      },
    );
  }
  return {
    listing,
    standardPrice,
    requestedDiscountedPrice,
    patch,
    issues,
  };
}

function submissionId(payload: Record<string, unknown>): string | null {
  return typeof payload.submissionId === "string"
    ? payload.submissionId
    : null;
}

async function commitListingPricePatch(
  gateway: ListingPriceGateway,
  patch: ListingPricePatch,
  fence: ListingWriteExecutionFence,
  messages: Readonly<{
    unrecognizedResponse: string;
    unknownStatus: string;
    rejected: string;
  }>,
) {
  const reply = await gateway.commitOnce(patch, fence);
  if (!reply.ok) {
    return throwGatewayError(reply, "write", "patchListingsItem");
  }
  if (!isRecord(reply.payload)) {
    throw new SpApiError(messages.unrecognizedResponse, {
      status: 502,
      code: "UPDATE_STATUS_UNKNOWN",
      requestId: reply.requestId,
    });
  }
  const issues = normalizeListingIssues(reply.payload.issues);
  if (reply.payload.status !== "ACCEPTED") {
    if (reply.payload.status !== "INVALID") {
      throw new SpApiError(messages.unknownStatus, {
        status: 503,
        code: "UPDATE_STATUS_UNKNOWN",
        requestId: reply.requestId,
        issues,
      });
    }
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        messages.rejected,
      {
        status: 422,
        code: "UPDATE_REJECTED",
        requestId: reply.requestId,
        issues,
      },
    );
  }
  return {
    submissionId: submissionId(reply.payload),
    requestId: reply.requestId,
    issues,
  };
}

export function createListingPriceMutationOperations(
  gateway: ListingPriceGateway,
): ListingPriceMutationOperations {
  return {
    read: (input) => readCanonicalPrice(gateway, input),
    previewStandard: async (input) => {
      if (gateway.mode(input.marketplaceId) === "demo") {
        const listing = await readCanonicalPrice(gateway, input);
        const previousPrice = verifyPriceChange(listing, input);
        return {
          mode: "demo",
          status: "SIMULATED",
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          previousPrice,
          requestedPrice: {
            amount: input.newPrice,
            currencyCode: marketplaceCurrency(input.marketplaceId),
          },
          validatedAt: new Date().toISOString(),
          issues: [],
          notice: "展示預檢已通過；最終按鈕只會模擬，不會寫入 Amazon。",
        };
      }
      const prepared = await prepareLivePriceUpdate(gateway, input);
      return {
        mode: "live",
        status: "VALID",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        previousPrice: prepared.previousPrice,
        requestedPrice: prepared.requestedPrice,
        validatedAt: new Date().toISOString(),
        issues: prepared.issues,
        notice: prepared.issues.length
          ? "Amazon 預檢通過，但有警告需要確認。"
          : "Amazon 預檢通過，尚未寫入價格。",
      };
    },
    commitStandard: async (input, fence) => {
      if (gateway.mode(input.marketplaceId) === "demo") {
        const listing = await readCanonicalPrice(gateway, input);
        const previousPrice = verifyPriceChange(listing, input);
        await fence.assertCurrent();
        gateway.setDemoStandardPrice({
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          amount: input.newPrice,
        });
        return {
          mode: "demo",
          status: "SIMULATED",
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          previousPrice,
          requestedPrice: {
            amount: input.newPrice,
            currencyCode: marketplaceCurrency(input.marketplaceId),
          },
          acceptedAt: new Date().toISOString(),
          submissionId: null,
          requestId: null,
          issues: [],
          notice: "模擬調價完成；Amazon 真實價格沒有變更。",
        };
      }
      const prepared = await preparePriceCommit(
        () => prepareLivePriceUpdate(gateway, input),
        "價格正式寫入前的重新讀取或 Validation Preview 失敗。",
      );
      const receipt = await commitListingPricePatch(
        gateway,
        prepared.patch,
        fence,
        {
          unrecognizedResponse:
            "Amazon 已收到請求，但回應無法辨識。請重新查詢 SKU 確認價格。",
          unknownStatus:
            "Amazon 已收到價格更新，但沒有回傳可確認的 ACCEPTED 或 INVALID 狀態。系統已禁止重送，請先回查 SKU。",
          rejected: "Amazon 未接受這次價格更新。",
        },
      );
      return {
        mode: "live",
        status: "ACCEPTED",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        previousPrice: prepared.previousPrice,
        requestedPrice: prepared.requestedPrice,
        acceptedAt: new Date().toISOString(),
        submissionId: receipt.submissionId,
        requestId: receipt.requestId,
        issues: receipt.issues,
        notice:
          "Amazon 已接受調價請求，正在處理；重新查詢確認後才代表價格已生效。",
      };
    },
    previewSale: async (input) => {
      if (gateway.mode(input.marketplaceId) === "demo") {
        const listing = await readCanonicalPrice(gateway, input);
        const standardPrice = verifySalePriceChange(listing, input);
        return {
          mode: "demo",
          status: "SIMULATED",
          action: input.action,
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          standardPrice,
          previousDiscountedPrice: listing.discountedPrice,
          requestedDiscountedPrice: requestedSaleSchedule(input),
          validatedAt: new Date().toISOString(),
          issues: [],
          notice: "展示預檢已通過；最終按鈕只會模擬，不會寫入 Amazon。",
        };
      }
      const prepared = await prepareLiveSalePriceUpdate(gateway, input);
      return {
        mode: "live",
        status: "VALID",
        action: input.action,
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        standardPrice: prepared.standardPrice,
        previousDiscountedPrice: prepared.listing.discountedPrice,
        requestedDiscountedPrice: prepared.requestedDiscountedPrice,
        validatedAt: new Date().toISOString(),
        issues: prepared.issues,
        notice: prepared.issues.length
          ? "Amazon 預檢通過，但有警告需要確認。"
          : "Amazon 預檢通過，尚未建立或取消折扣。",
      };
    },
    commitSale: async (input, fence) => {
      if (gateway.mode(input.marketplaceId) === "demo") {
        const listing = await readCanonicalPrice(gateway, input);
        const standardPrice = verifySalePriceChange(listing, input);
        const requestedDiscountedPrice = requestedSaleSchedule(input);
        await fence.assertCurrent();
        gateway.setDemoSalePrice({
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          schedule: requestedDiscountedPrice,
        });
        return {
          mode: "demo",
          status: "SIMULATED",
          action: input.action,
          marketplaceId: input.marketplaceId,
          sellerSku: input.sellerSku,
          standardPrice,
          previousDiscountedPrice: listing.discountedPrice,
          requestedDiscountedPrice,
          acceptedAt: new Date().toISOString(),
          submissionId: null,
          requestId: null,
          issues: [],
          notice: input.action === "cancel"
            ? "模擬取消折扣完成；Amazon 真實活動沒有變更。"
            : "模擬限時折扣建立完成；Amazon 真實活動沒有變更。",
        };
      }
      const prepared = await preparePriceCommit(
        () => prepareLiveSalePriceUpdate(gateway, input),
        "折扣正式寫入前的重新讀取或 Validation Preview 失敗。",
      );
      const receipt = await commitListingPricePatch(
        gateway,
        prepared.patch,
        fence,
        {
          unrecognizedResponse:
            "Amazon 已收到請求，但回應無法辨識。請重新查詢 SKU 確認折扣。",
          unknownStatus:
            "Amazon 已收到折扣更新，但沒有回傳可確認的 ACCEPTED 或 INVALID 狀態。系統已禁止重送，請先回查 SKU。",
          rejected: "Amazon 未接受這次折扣更新。",
        },
      );
      return {
        mode: "live",
        status: "ACCEPTED",
        action: input.action,
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        standardPrice: prepared.standardPrice,
        previousDiscountedPrice: prepared.listing.discountedPrice,
        requestedDiscountedPrice: prepared.requestedDiscountedPrice,
        acceptedAt: new Date().toISOString(),
        submissionId: receipt.submissionId,
        requestId: receipt.requestId,
        issues: receipt.issues,
        notice: input.action === "cancel"
          ? "Amazon 已接受取消折扣，正在處理；重新查詢確認後才代表完成。"
          : "Amazon 已接受限時折扣，正在處理；重新查詢看到新折扣後才代表生效。",
      };
    },
  };
}

export class ListingPriceMutations implements ListingPriceMutationsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly operations: ListingPriceMutationOperations;

  constructor(input: ListingPriceMutationsDependencies) {
    this.context = input.context;
    this.writeGate = input.writeGate;
    this.operations = input.operations;
  }

  async handle(command: ListingPriceMutationCommand): Promise<ApiResponse> {
    if (
      command.family === "standard-price" &&
      command.operation === "read"
    ) {
      return this.readStandard(command.request);
    }
    if (
      command.family === "standard-price" &&
      command.operation === "preview"
    ) {
      return this.previewStandard(command.request);
    }
    if (
      command.family === "standard-price" &&
      command.operation === "commit"
    ) {
      return this.commitStandard(command.request);
    }
    if (command.family === "sale-price" && command.operation === "preview") {
      return this.previewSale(command.request);
    }
    if (command.family === "sale-price" && command.operation === "commit") {
      return this.commitSale(command.request);
    }
    throw new Error("Listing Price mutation command is not implemented yet.");
  }

  async read(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>, context: SpExecutionContext): Promise<ListingPriceSnapshot> {
    const snapshot = await this.operations.read(input);
    await this.observeCanonical(input, snapshot, context);
    return snapshot;
  }

  async observeCanonical(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      sellerSku: string;
    }>,
    snapshot: ListingPriceSnapshot,
    context: SpExecutionContext,
  ): Promise<void> {
    assertCanonicalPriceSnapshot(snapshot, {
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      mode: context.mode,
    });
    await this.context.assertCurrent(context);
    await this.writeGate.reconcile({
      context,
      marketplaceId: snapshot.marketplaceId,
      sellerSku: snapshot.sellerSku,
      operations: ["price", "sale_price"],
      snapshot,
      project: (response, operation, canonical) =>
        operation === "price"
          ? reconcilePriceWrite(response, canonical)
          : reconcileSalePriceWrite(response, canonical),
    });
  }

  private async readStandard(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    if (!marketplaceId || !sellerSku) {
      return invalid("請選擇站點並輸入完整 SKU。");
    }
    try {
      const context = await this.context.capture(marketplaceId);
      const snapshot = await this.read({ marketplaceId, sellerSku }, context);
      return json(snapshot);
    } catch (error) {
      return routeError(error, "查詢 SKU 價格時發生未預期的錯誤。");
    }
  }

  private standardInput(request: ApiRequest): StandardPriceRouteInput | ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "價格請求必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    if (!marketplaceId || !sellerSku) {
      return invalid("請提供有效的 Amazon 站點與完整 SKU。");
    }
    const marketplace = marketplaceById(marketplaceId);
    if (!marketplace) {
      return invalid("請提供有效的 Amazon 站點與完整 SKU。");
    }
    const newPrice = parsePrice(body.newPrice, marketplace.currency);
    const expectedPrice = parsePrice(body.expectedPrice, marketplace.currency);
    if (newPrice === null || expectedPrice === null) {
      return invalid(
        marketplace.currency === "JPY"
          ? "日圓價格必須是大於 0 的整數。"
          : "價格必須大於 0，且最多只能有兩位小數。",
        400,
        "INVALID_PRICE",
      );
    }
    return {
      marketplaceId,
      sellerSku,
      newPrice,
      expectedPrice,
      confirmationSku: typeof body.confirmationSku === "string"
        ? body.confirmationSku
        : "",
      idempotencyKey: typeof body.idempotencyKey === "string"
        ? body.idempotencyKey
        : "",
    };
  }

  private async previewStandard(request: ApiRequest): Promise<ApiResponse> {
    const input = this.standardInput(request);
    if ("status" in input) return input;
    const proposal: StandardPriceMutationInput = {
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      newPrice: input.newPrice,
      expectedPrice: input.expectedPrice,
    };
    try {
      const context = await this.context.capture(input.marketplaceId);
      const result = await this.operations.previewStandard(proposal);
      await this.context.assertCurrent(context);
      const key = validIdempotencyKey(input.idempotencyKey);
      if (key) {
        const binding: WriteBinding = {
          family: "standard-price",
          previewKey: input.idempotencyKey,
          context,
          intents: [{
            intentId: "primary",
            operation: "price",
            marketplaceId: input.marketplaceId,
            sellerSku: input.sellerSku,
            idempotencyKey: input.idempotencyKey,
            proposalFingerprint: stableFingerprint([
              proposal.marketplaceId,
              proposal.sellerSku,
              proposal.expectedPrice,
              proposal.newPrice,
            ]),
          }],
        };
        await this.writeGate.stagePreview(binding);
      }
      return json(result);
    } catch (error) {
      return error instanceof MainWriteGateError
        ? invalid(error.message, error.status, error.code)
        : routeError(error, "價格預檢時發生未預期的錯誤。");
    }
  }

  private saleInput(request: ApiRequest): SalePriceRouteInput | ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "折扣請求必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const action = body.action === "set" || body.action === "cancel"
      ? body.action
      : null;
    if (!marketplaceId || !sellerSku || !action) {
      return invalid("請提供有效的站點、SKU 與折扣操作。");
    }
    const marketplace = marketplaceById(marketplaceId);
    if (!marketplace) {
      return invalid("請提供有效的站點、SKU 與折扣操作。");
    }
    const expectedPrice = parsePrice(body.expectedPrice, marketplace.currency);
    const expectedDiscountedPrice = optionalPrice(
      body.expectedDiscountedPrice,
      marketplace.currency,
    );
    const expectedStartAt = optionalDate(body.expectedStartAt);
    const expectedEndAt = optionalDate(body.expectedEndAt);
    const salePrice = optionalPrice(body.salePrice, marketplace.currency);
    const startAt = optionalDate(body.startAt);
    const endAt = optionalDate(body.endAt);
    if (
      expectedPrice === null ||
      expectedDiscountedPrice === undefined ||
      expectedStartAt === undefined ||
      expectedEndAt === undefined ||
      salePrice === undefined ||
      startAt === undefined ||
      endAt === undefined
    ) {
      return invalid(
        marketplace.currency === "JPY"
          ? "請確認折扣金額為整數，且日期格式正確。"
          : "請確認折扣金額最多兩位小數，且日期格式正確。",
      );
    }
    if (action === "set" && (salePrice === null || !startAt || !endAt)) {
      return invalid("建立折扣需要折扣價、開始日與結束日。");
    }
    return {
      marketplaceId,
      sellerSku,
      action,
      expectedPrice,
      expectedDiscountedPrice,
      expectedStartAt,
      expectedEndAt,
      salePrice: action === "set" ? salePrice : null,
      startAt: action === "set" ? startAt : null,
      endAt: action === "set" ? endAt : null,
      confirmationSku: typeof body.confirmationSku === "string"
        ? body.confirmationSku
        : "",
      idempotencyKey: typeof body.idempotencyKey === "string"
        ? body.idempotencyKey
        : "",
    };
  }

  private async previewSale(request: ApiRequest): Promise<ApiResponse> {
    const input = this.saleInput(request);
    if ("status" in input) return input;
    const proposal: UpdateListingSalePriceInput = {
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      action: input.action,
      expectedPrice: input.expectedPrice,
      expectedDiscountedPrice: input.expectedDiscountedPrice,
      expectedStartAt: input.expectedStartAt,
      expectedEndAt: input.expectedEndAt,
      salePrice: input.salePrice,
      startAt: input.startAt,
      endAt: input.endAt,
    };
    try {
      const context = await this.context.capture(input.marketplaceId);
      const result = await this.operations.previewSale(proposal);
      await this.context.assertCurrent(context);
      const key = validIdempotencyKey(input.idempotencyKey);
      if (key) {
        await this.writeGate.stagePreview({
          family: "sale-price",
          previewKey: key,
          context,
          intents: [{
            intentId: "primary",
            operation: "sale_price",
            marketplaceId: input.marketplaceId,
            sellerSku: input.sellerSku,
            idempotencyKey: key,
            proposalFingerprint: stableFingerprint([
              proposal.marketplaceId,
              proposal.sellerSku,
              proposal.action,
              proposal.expectedPrice,
              proposal.expectedDiscountedPrice,
              proposal.expectedStartAt,
              proposal.expectedEndAt,
              proposal.salePrice,
              proposal.startAt,
              proposal.endAt,
            ]),
          }],
        });
      }
      return json(result);
    } catch (error) {
      return error instanceof MainWriteGateError
        ? invalid(error.message, error.status, error.code)
        : routeError(error, "折扣預檢時發生未預期的錯誤。");
    }
  }

  private async commitStandard(request: ApiRequest): Promise<ApiResponse> {
    const input = this.standardInput(request);
    if ("status" in input) return input;
    const key = validIdempotencyKey(input.idempotencyKey);
    if (!key) {
      return invalid("這次調價的確認資訊已失效，請重新預檢。");
    }
    const changeRatio = Math.abs(input.newPrice - input.expectedPrice) /
      input.expectedPrice;
    if (changeRatio >= 0.2 && input.confirmationSku !== input.sellerSku) {
      return invalid(
        "價格變動達 20%，請重新輸入完整 SKU 才能送出。",
        400,
        "CONFIRMATION_REQUIRED",
      );
    }
    const proposal: StandardPriceMutationInput = {
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      newPrice: input.newPrice,
      expectedPrice: input.expectedPrice,
    };
    const context = await this.context.capture(input.marketplaceId);
    const marketplace = marketplaceById(input.marketplaceId)!;
    const binding: WriteBinding = {
      family: "standard-price",
      previewKey: key,
      context,
      intents: [{
        intentId: "primary",
        operation: "price",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        idempotencyKey: key,
        proposalFingerprint: stableFingerprint([
          proposal.marketplaceId,
          proposal.sellerSku,
          proposal.expectedPrice,
          proposal.newPrice,
        ]),
      }],
    };
    try {
      const result = await this.writeGate.execute({
        binding,
        approvalReason:
          `確認調價｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜${input.expectedPrice} → ${input.newPrice} ${marketplace.currency}`,
        run: (session) => session.attempt({
          intentId: "primary",
          execute: ({ recordAccepted, assertCurrent }) =>
            commitWithCanonicalReadback({
              commit: () => this.operations.commitStandard(proposal, {
                assertCurrent,
              }),
              onAccepted: recordAccepted,
              assertCurrent,
              read: () => this.operations.read({
                marketplaceId: proposal.marketplaceId,
                sellerSku: proposal.sellerSku,
              }),
              decide: priceReadbackDecision,
            }),
        }),
      });
      return json(result);
    } catch (error) {
      return error instanceof MainWriteGateError
        ? invalid(error.message, error.status, error.code)
        : routeError(error, "送出價格更新時發生未預期的錯誤。");
    }
  }

  private async commitSale(request: ApiRequest): Promise<ApiResponse> {
    const input = this.saleInput(request);
    if ("status" in input) return input;
    const key = validIdempotencyKey(input.idempotencyKey);
    if (!key) {
      return invalid("這次折扣的確認資訊已失效，請重新預檢。");
    }
    const discountRatio = input.action === "set" && input.salePrice !== null
      ? (input.expectedPrice - input.salePrice) / input.expectedPrice
      : 0;
    if (
      (input.action === "cancel" || discountRatio >= 0.2) &&
      input.confirmationSku !== input.sellerSku
    ) {
      return invalid(
        input.action === "cancel"
          ? "取消折扣前，請重新輸入完整 SKU。"
          : "折扣達 20%，請重新輸入完整 SKU 才能送出。",
        400,
        "CONFIRMATION_REQUIRED",
      );
    }
    const proposal: UpdateListingSalePriceInput = {
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      action: input.action,
      expectedPrice: input.expectedPrice,
      expectedDiscountedPrice: input.expectedDiscountedPrice,
      expectedStartAt: input.expectedStartAt,
      expectedEndAt: input.expectedEndAt,
      salePrice: input.salePrice,
      startAt: input.startAt,
      endAt: input.endAt,
    };
    const context = await this.context.capture(input.marketplaceId);
    const marketplace = marketplaceById(input.marketplaceId)!;
    const binding: WriteBinding = {
      family: "sale-price",
      previewKey: key,
      context,
      intents: [{
        intentId: "primary",
        operation: "sale_price",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        idempotencyKey: key,
        proposalFingerprint: stableFingerprint([
          proposal.marketplaceId,
          proposal.sellerSku,
          proposal.action,
          proposal.expectedPrice,
          proposal.expectedDiscountedPrice,
          proposal.expectedStartAt,
          proposal.expectedEndAt,
          proposal.salePrice,
          proposal.startAt,
          proposal.endAt,
        ]),
      }],
    };
    try {
      const result = await this.writeGate.execute({
        binding,
        approvalReason: input.action === "cancel"
          ? `確認取消折扣｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜目前 ${input.expectedDiscountedPrice ?? "—"}`
          : `確認折扣｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜${input.expectedPrice} → ${input.salePrice} ${marketplace.currency}｜${input.startAt}～${input.endAt}`,
        run: (session) => session.attempt({
          intentId: "primary",
          execute: ({ recordAccepted, assertCurrent }) =>
            commitWithCanonicalReadback({
              commit: () => this.operations.commitSale(proposal, {
                assertCurrent,
              }),
              onAccepted: recordAccepted,
              assertCurrent,
              read: () => this.operations.read({
                marketplaceId: proposal.marketplaceId,
                sellerSku: proposal.sellerSku,
              }),
              decide: salePriceReadbackDecision,
            }),
        }),
      });
      return json(result);
    } catch (error) {
      return error instanceof MainWriteGateError
        ? invalid(error.message, error.status, error.code)
        : routeError(error, "送出折扣更新時發生未預期的錯誤。");
    }
  }
}

export function createListingPriceMutations(input: Readonly<{
  context: SpExecutionContextAdapter;
  writeGate: MainWriteGatePort;
  gateway: ListingPriceGateway;
}>): ListingPriceMutationsPort {
  return new ListingPriceMutations({
    context: input.context,
    writeGate: input.writeGate,
    operations: createListingPriceMutationOperations(input.gateway),
  });
}
