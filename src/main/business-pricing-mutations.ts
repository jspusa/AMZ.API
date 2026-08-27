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
  UpdateBusinessPriceInput,
} from "./amazon/sp-api";
import type { ListingWriteExecutionFence } from
  "./amazon/listing-write-execution-fence";
import { SpApiError } from "./amazon/sp-api-error";
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
      if (result.sellerSku !== input.sellerSku) {
        throw new SpApiError(
          "Amazon B2B 預檢結果不屬於這次要求的 Seller SKU，已停止使用。",
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
  operations: BusinessPricingMutationOperations;
  priceObserver: BusinessPricingCanonicalPriceObserver;
}>): BusinessPricingMutationsPort {
  return new BusinessPricingMutations(input);
}
